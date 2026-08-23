use std::fs::File;
use std::io;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::CATALOG_FORMAT_VERSION;
use crate::WeenieTemplate;
use crate::codec::{
    HEADER_LENGTH, Header, INDEX_ENTRY_LENGTH, IndexEntry, MAX_CATALOG_RECORDS, MAX_RECORD_BYTES,
    decode_template,
};

/// Fully validated catalog handle with only the fixed index retained in memory.
#[derive(Debug)]
pub struct WeenieCatalog {
    file: File,
    path: PathBuf,
    index: Vec<IndexEntry>,
}

/// Public census metadata for one catalog record; payload offsets remain an implementation detail.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatalogRecordInfo {
    /// WCID used for point lookup.
    pub wcid: u32,
    /// Encoded payload size in bytes.
    pub encoded_length: u32,
}

impl WeenieCatalog {
    /// Opens a catalog and validates its complete header, index, and file layout.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, CatalogOpenError> {
        let path = path.as_ref().to_path_buf();
        let file = File::open(&path).map_err(|source| CatalogOpenError::Unavailable {
            path: path.clone(),
            source,
        })?;
        let file_length = file
            .metadata()
            .map_err(|source| CatalogOpenError::Read {
                path: path.clone(),
                source,
            })?
            .len();
        if file_length < HEADER_LENGTH as u64 {
            return Err(corrupt(
                &path,
                format!("file length {file_length} is shorter than header length {HEADER_LENGTH}"),
            ));
        }

        let mut header_bytes = [0_u8; HEADER_LENGTH];
        read_exact_at(&file, &mut header_bytes, 0).map_err(|source| CatalogOpenError::Read {
            path: path.clone(),
            source,
        })?;
        let header =
            Header::decode(&header_bytes).map_err(|error| corrupt(&path, error.to_string()))?;
        if header.version != CATALOG_FORMAT_VERSION {
            return Err(CatalogOpenError::UnsupportedVersion {
                path,
                version: header.version,
            });
        }
        validate_header(&path, header, file_length)?;

        let index_length = usize::try_from(header.index_length)
            .map_err(|_| corrupt(&path, "index length does not fit usize"))?;
        let mut index_bytes = vec![0_u8; index_length];
        read_exact_at(&file, &mut index_bytes, header.index_offset).map_err(|source| {
            CatalogOpenError::Read {
                path: path.clone(),
                source,
            }
        })?;
        let mut index = Vec::with_capacity(header.record_count as usize);
        for bytes in index_bytes.chunks_exact(INDEX_ENTRY_LENGTH) {
            index.push(
                IndexEntry::decode(bytes).map_err(|error| corrupt(&path, error.to_string()))?,
            );
        }
        validate_index(&path, header, &index)?;

        Ok(Self { file, path, index })
    }

    /// Number of indexed WCID records.
    pub fn len(&self) -> usize {
        self.index.len()
    }

    /// Whether the catalog contains no WCID records.
    pub fn is_empty(&self) -> bool {
        self.index.is_empty()
    }

    /// Visits records in canonical WCID order without decoding their payloads.
    pub fn records(&self) -> impl ExactSizeIterator<Item = CatalogRecordInfo> + '_ {
        self.index.iter().map(|entry| CatalogRecordInfo {
            wcid: entry.wcid,
            encoded_length: entry.payload_length,
        })
    }

    /// Resolves one WCID with binary search and one positioned payload read.
    pub fn lookup(&self, wcid: u32) -> Result<Option<WeenieTemplate>, CatalogLookupError> {
        let Ok(position) = self.index.binary_search_by_key(&wcid, |entry| entry.wcid) else {
            return Ok(None);
        };
        let entry = self.index[position];
        let payload_length = usize::try_from(entry.payload_length).map_err(|_| {
            CatalogLookupError::MalformedRecord {
                path: self.path.clone(),
                wcid,
                reason: "record length does not fit usize".to_owned(),
            }
        })?;
        let mut payload = vec![0_u8; payload_length];
        read_exact_at(&self.file, &mut payload, entry.payload_offset).map_err(|source| {
            CatalogLookupError::Read {
                path: self.path.clone(),
                wcid,
                source,
            }
        })?;
        let template =
            decode_template(&payload).map_err(|error| CatalogLookupError::MalformedRecord {
                path: self.path.clone(),
                wcid,
                reason: error.to_string(),
            })?;
        if template.wcid != wcid {
            return Err(CatalogLookupError::MalformedRecord {
                path: self.path.clone(),
                wcid,
                reason: format!("record identity is WCID {}", template.wcid),
            });
        }
        Ok(Some(template))
    }
}

fn validate_header(path: &Path, header: Header, file_length: u64) -> Result<(), CatalogOpenError> {
    let record_count = usize::try_from(header.record_count)
        .map_err(|_| corrupt(path, "record count does not fit usize"))?;
    if record_count > MAX_CATALOG_RECORDS {
        return Err(corrupt(
            path,
            format!("record count {record_count} exceeds limit {MAX_CATALOG_RECORDS}"),
        ));
    }
    if header.payload_offset != HEADER_LENGTH as u64 {
        return Err(corrupt(
            path,
            format!(
                "payload offset {} does not follow the header at {HEADER_LENGTH}",
                header.payload_offset
            ),
        ));
    }
    let expected_index_offset = header
        .payload_offset
        .checked_add(header.payload_length)
        .ok_or_else(|| corrupt(path, "index offset overflow"))?;
    if header.index_offset != expected_index_offset {
        return Err(corrupt(
            path,
            format!(
                "index offset {} does not follow payload at {expected_index_offset}",
                header.index_offset
            ),
        ));
    }
    let expected_index_length = (record_count as u64)
        .checked_mul(INDEX_ENTRY_LENGTH as u64)
        .ok_or_else(|| corrupt(path, "index length overflow"))?;
    if header.index_length != expected_index_length {
        return Err(corrupt(
            path,
            format!(
                "index length {} does not equal {expected_index_length}",
                header.index_length
            ),
        ));
    }
    let expected_file_length = header
        .index_offset
        .checked_add(header.index_length)
        .ok_or_else(|| corrupt(path, "file length overflow"))?;
    if file_length != expected_file_length {
        return Err(corrupt(
            path,
            format!("file length {file_length} does not equal declared {expected_file_length}"),
        ));
    }
    Ok(())
}

fn validate_index(
    path: &Path,
    header: Header,
    index: &[IndexEntry],
) -> Result<(), CatalogOpenError> {
    if index.len() != header.record_count as usize {
        return Err(corrupt(path, "decoded index count does not match header"));
    }
    if !index.is_sorted_by_key(|entry| entry.wcid) {
        return Err(corrupt(path, "index WCIDs are not strictly sorted"));
    }
    if index.windows(2).any(|pair| pair[0].wcid == pair[1].wcid) {
        return Err(corrupt(path, "index contains duplicate WCIDs"));
    }

    let mut expected_offset = header.payload_offset;
    for entry in index {
        let payload_length = entry.payload_length as usize;
        if payload_length == 0 || payload_length > MAX_RECORD_BYTES {
            return Err(corrupt(
                path,
                format!(
                    "WCID {} record length {payload_length} is outside 1..={MAX_RECORD_BYTES}",
                    entry.wcid
                ),
            ));
        }
        if entry.payload_offset != expected_offset {
            return Err(corrupt(
                path,
                format!(
                    "WCID {} payload offset {} does not equal contiguous offset {expected_offset}",
                    entry.wcid, entry.payload_offset
                ),
            ));
        }
        expected_offset = expected_offset
            .checked_add(u64::from(entry.payload_length))
            .ok_or_else(|| corrupt(path, "record range overflow"))?;
    }
    if expected_offset != header.index_offset {
        return Err(corrupt(
            path,
            format!(
                "record payloads end at {expected_offset}, not index offset {}",
                header.index_offset
            ),
        ));
    }
    Ok(())
}

fn corrupt(path: &Path, reason: impl Into<String>) -> CatalogOpenError {
    CatalogOpenError::Corrupt {
        path: path.to_path_buf(),
        reason: reason.into(),
    }
}

#[cfg(unix)]
fn read_exact_at(file: &File, mut buffer: &mut [u8], mut offset: u64) -> io::Result<()> {
    use std::os::unix::fs::FileExt;

    while !buffer.is_empty() {
        let count = file.read_at(buffer, offset)?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "positioned catalog read reached EOF",
            ));
        }
        offset = offset
            .checked_add(count as u64)
            .ok_or_else(|| io::Error::other("positioned catalog read offset overflow"))?;
        buffer = &mut buffer[count..];
    }
    Ok(())
}

#[cfg(windows)]
fn read_exact_at(file: &File, mut buffer: &mut [u8], mut offset: u64) -> io::Result<()> {
    use std::os::windows::fs::FileExt;

    while !buffer.is_empty() {
        let count = file.seek_read(buffer, offset)?;
        if count == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "positioned catalog read reached EOF",
            ));
        }
        offset = offset
            .checked_add(count as u64)
            .ok_or_else(|| io::Error::other("positioned catalog read offset overflow"))?;
        buffer = &mut buffer[count..];
    }
    Ok(())
}

/// Failure to open or validate a catalog.
#[derive(Debug, Error)]
pub enum CatalogOpenError {
    /// The configured catalog path cannot be opened.
    #[error("weenie catalog is unavailable at {path}: {source}")]
    Unavailable {
        /// Configured catalog path.
        path: PathBuf,
        /// Underlying filesystem failure.
        #[source]
        source: io::Error,
    },
    /// The file was opened but could not be read completely.
    #[error("could not read weenie catalog at {path}: {source}")]
    Read {
        /// Configured catalog path.
        path: PathBuf,
        /// Underlying filesystem failure.
        #[source]
        source: io::Error,
    },
    /// The catalog version is well-formed but unsupported.
    #[error("weenie catalog at {path} uses unsupported format version {version}")]
    UnsupportedVersion {
        /// Configured catalog path.
        path: PathBuf,
        /// Unsupported file-format version.
        version: u32,
    },
    /// The file violates the current format contract.
    #[error("weenie catalog at {path} is corrupt: {reason}")]
    Corrupt {
        /// Configured catalog path.
        path: PathBuf,
        /// Exact violated invariant.
        reason: String,
    },
}

/// Failure while reading or decoding one indexed template.
#[derive(Debug, Error)]
pub enum CatalogLookupError {
    /// The indexed payload could not be read.
    #[error("could not read WCID {wcid} from weenie catalog at {path}: {source}")]
    Read {
        /// Catalog path.
        path: PathBuf,
        /// Requested WCID.
        wcid: u32,
        /// Underlying filesystem failure.
        #[source]
        source: io::Error,
    },
    /// The indexed payload violates the record codec.
    #[error("WCID {wcid} in weenie catalog at {path} is malformed: {reason}")]
    MalformedRecord {
        /// Catalog path.
        path: PathBuf,
        /// Requested WCID.
        wcid: u32,
        /// Exact violated invariant.
        reason: String,
    },
}
