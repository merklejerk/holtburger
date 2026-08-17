use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use tempfile::NamedTempFile;
use thiserror::Error;

use crate::codec::{
    HEADER_LENGTH, Header, INDEX_ENTRY_LENGTH, IndexEntry, MAX_CATALOG_RECORDS,
    MAX_PROVENANCE_BYTES, MAX_RECORD_BYTES, encode_template,
};
use crate::{CATALOG_FORMAT_VERSION, WeenieCatalog, WeenieTemplate};

/// Writes, reopens, validates, and atomically publishes one deterministic catalog.
pub fn write_catalog_atomic(
    path: impl AsRef<Path>,
    provenance: &str,
    templates: &[WeenieTemplate],
) -> Result<(), CatalogWriteError> {
    let path = path.as_ref();
    validate_provenance(provenance)?;
    validate_record_count(templates.len())?;

    let mut templates = templates.to_vec();
    for template in &mut templates {
        template
            .sub_palettes
            .sort_by_key(|entry| (entry.offset, entry.length, entry.sub_palette_did));
        template.texture_changes.sort_by_key(|entry| {
            (
                entry.part_index,
                entry.old_texture_did,
                entry.new_texture_did,
            )
        });
        template
            .anim_part_changes
            .sort_by_key(|entry| entry.part_index);
    }
    templates.sort_by_key(|template| template.wcid);
    if let Some(pair) = templates
        .windows(2)
        .find(|pair| pair[0].wcid == pair[1].wcid)
    {
        return Err(CatalogWriteError::DuplicateWcid { wcid: pair[0].wcid });
    }

    let provenance_length =
        u32::try_from(provenance.len()).map_err(|_| CatalogWriteError::ProvenanceLength {
            length: provenance.len(),
            limit: MAX_PROVENANCE_BYTES,
        })?;
    let record_count =
        u32::try_from(templates.len()).map_err(|_| CatalogWriteError::RecordCount {
            count: templates.len(),
            limit: MAX_CATALOG_RECORDS,
        })?;
    let payload_offset = (HEADER_LENGTH as u64)
        .checked_add(u64::from(provenance_length))
        .ok_or(CatalogWriteError::FileLengthOverflow)?;

    let mut payloads = Vec::with_capacity(templates.len());
    let mut index = Vec::with_capacity(templates.len());
    let mut next_offset = payload_offset;
    for template in &templates {
        let payload = encode_template(template).map_err(|error| CatalogWriteError::Record {
            wcid: template.wcid,
            reason: error.to_string(),
        })?;
        validate_record_length(template.wcid, payload.len())?;
        let payload_length =
            u32::try_from(payload.len()).map_err(|_| CatalogWriteError::RecordLength {
                wcid: template.wcid,
                length: payload.len(),
                limit: MAX_RECORD_BYTES,
            })?;
        index.push(IndexEntry {
            wcid: template.wcid,
            payload_offset: next_offset,
            payload_length,
        });
        next_offset = next_offset
            .checked_add(u64::from(payload_length))
            .ok_or(CatalogWriteError::FileLengthOverflow)?;
        payloads.push(payload);
    }
    let index_offset = next_offset;
    let payload_length = index_offset
        .checked_sub(payload_offset)
        .ok_or(CatalogWriteError::FileLengthOverflow)?;
    let index_length = (index.len() as u64)
        .checked_mul(INDEX_ENTRY_LENGTH as u64)
        .ok_or(CatalogWriteError::FileLengthOverflow)?;
    let header = Header {
        version: CATALOG_FORMAT_VERSION,
        provenance_length,
        record_count,
        payload_offset,
        payload_length,
        index_offset,
        index_length,
    };

    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let mut temporary =
        NamedTempFile::new_in(parent).map_err(|source| CatalogWriteError::CreateTemporary {
            parent: parent.to_path_buf(),
            source,
        })?;
    temporary
        .write_all(&header.encode())
        .and_then(|()| temporary.write_all(provenance.as_bytes()))
        .map_err(|source| write_error(path, source))?;
    for payload in &payloads {
        temporary
            .write_all(payload)
            .map_err(|source| write_error(path, source))?;
    }
    for entry in index {
        temporary
            .write_all(&entry.encode())
            .map_err(|source| write_error(path, source))?;
    }
    temporary
        .flush()
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|source| write_error(path, source))?;

    let temporary_path = temporary.into_temp_path();
    let reopened = WeenieCatalog::open(&temporary_path).map_err(|source| {
        CatalogWriteError::ReopenValidation {
            path: path.to_path_buf(),
            reason: source.to_string(),
        }
    })?;
    if reopened.provenance() != provenance || reopened.len() != templates.len() {
        return Err(CatalogWriteError::ReopenValidation {
            path: path.to_path_buf(),
            reason: "reopened catalog metadata differs from the requested catalog".to_owned(),
        });
    }
    for expected in &templates {
        let actual = reopened
            .lookup(expected.wcid)
            .map_err(|source| CatalogWriteError::ReopenValidation {
                path: path.to_path_buf(),
                reason: source.to_string(),
            })?
            .ok_or_else(|| CatalogWriteError::ReopenValidation {
                path: path.to_path_buf(),
                reason: format!("reopened catalog is missing WCID {}", expected.wcid),
            })?;
        if actual != *expected {
            return Err(CatalogWriteError::ReopenValidation {
                path: path.to_path_buf(),
                reason: format!(
                    "reopened WCID {} differs from its source record",
                    expected.wcid
                ),
            });
        }
    }
    drop(reopened);

    temporary_path
        .persist(path)
        .map_err(|source| CatalogWriteError::Publish {
            path: path.to_path_buf(),
            source,
        })?;
    sync_parent(parent).map_err(|source| CatalogWriteError::SyncParent {
        parent: parent.to_path_buf(),
        source,
    })?;
    Ok(())
}

fn validate_provenance(provenance: &str) -> Result<(), CatalogWriteError> {
    if provenance.is_empty() || provenance.len() > MAX_PROVENANCE_BYTES {
        return Err(CatalogWriteError::ProvenanceLength {
            length: provenance.len(),
            limit: MAX_PROVENANCE_BYTES,
        });
    }
    Ok(())
}

fn validate_record_count(count: usize) -> Result<(), CatalogWriteError> {
    if count > MAX_CATALOG_RECORDS {
        return Err(CatalogWriteError::RecordCount {
            count,
            limit: MAX_CATALOG_RECORDS,
        });
    }
    Ok(())
}

fn validate_record_length(wcid: u32, length: usize) -> Result<(), CatalogWriteError> {
    if length == 0 || length > MAX_RECORD_BYTES {
        return Err(CatalogWriteError::RecordLength {
            wcid,
            length,
            limit: MAX_RECORD_BYTES,
        });
    }
    Ok(())
}

fn write_error(path: &Path, source: io::Error) -> CatalogWriteError {
    CatalogWriteError::Write {
        path: path.to_path_buf(),
        source,
    }
}

#[cfg(unix)]
fn sync_parent(parent: &Path) -> io::Result<()> {
    fs::File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent(_parent: &Path) -> io::Result<()> {
    Ok(())
}

/// Failure while validating, encoding, or atomically publishing a catalog.
#[derive(Debug, Error)]
pub enum CatalogWriteError {
    /// Provenance must be nonempty and fit the portable header contract.
    #[error("catalog provenance encoded length {length} is outside 1..={limit}")]
    ProvenanceLength {
        /// UTF-8 encoded length.
        length: usize,
        /// Format limit.
        limit: usize,
    },
    /// The catalog contains more records than its validated runtime bound.
    #[error("catalog record count {count} exceeds limit {limit}")]
    RecordCount {
        /// Supplied record count.
        count: usize,
        /// Format/runtime limit.
        limit: usize,
    },
    /// Two source records use the same WCID.
    #[error("catalog source contains duplicate WCID {wcid}")]
    DuplicateWcid {
        /// Duplicated WCID.
        wcid: u32,
    },
    /// One semantic record violates the portable record contract.
    #[error("could not encode catalog WCID {wcid}: {reason}")]
    Record {
        /// Rejected WCID.
        wcid: u32,
        /// Exact violated invariant.
        reason: String,
    },
    /// One encoded record violates the runtime allocation bound.
    #[error("catalog WCID {wcid} encoded length {length} is outside 1..={limit}")]
    RecordLength {
        /// Rejected WCID.
        wcid: u32,
        /// Encoded payload length.
        length: usize,
        /// Format/runtime limit.
        limit: usize,
    },
    /// Header or record offset arithmetic overflowed.
    #[error("catalog file layout exceeds portable integer bounds")]
    FileLengthOverflow,
    /// A sibling temporary file could not be created.
    #[error("could not create catalog temporary file in {parent}: {source}")]
    CreateTemporary {
        /// Destination directory.
        parent: PathBuf,
        /// Underlying filesystem failure.
        #[source]
        source: io::Error,
    },
    /// Temporary catalog bytes could not be written or flushed.
    #[error("could not write catalog for {path}: {source}")]
    Write {
        /// Requested final path.
        path: PathBuf,
        /// Underlying filesystem failure.
        #[source]
        source: io::Error,
    },
    /// Reopening or exact source-record verification failed before publication.
    #[error("catalog for {path} failed reopen validation: {reason}")]
    ReopenValidation {
        /// Requested final path.
        path: PathBuf,
        /// Exact validation failure.
        reason: String,
    },
    /// The validated temporary file could not atomically replace the destination.
    #[error("could not publish catalog at {path}: {source}")]
    Publish {
        /// Requested final path.
        path: PathBuf,
        /// Underlying persistence failure.
        #[source]
        source: tempfile::PathPersistError,
    },
    /// The destination directory could not be synced after publication.
    #[error("could not sync catalog directory {parent}: {source}")]
    SyncParent {
        /// Destination directory.
        parent: PathBuf,
        /// Underlying filesystem failure.
        #[source]
        source: io::Error,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_writer_limits_have_reachable_distinct_rejections() {
        assert!(matches!(
            validate_provenance(""),
            Err(CatalogWriteError::ProvenanceLength { length: 0, .. })
        ));
        assert!(matches!(
            validate_provenance(&"x".repeat(MAX_PROVENANCE_BYTES + 1)),
            Err(CatalogWriteError::ProvenanceLength { .. })
        ));
        assert!(matches!(
            validate_record_count(MAX_CATALOG_RECORDS + 1),
            Err(CatalogWriteError::RecordCount { .. })
        ));
        assert!(matches!(
            validate_record_length(42, 0),
            Err(CatalogWriteError::RecordLength {
                wcid: 42,
                length: 0,
                ..
            })
        ));
        assert!(matches!(
            validate_record_length(42, MAX_RECORD_BYTES + 1),
            Err(CatalogWriteError::RecordLength { wcid: 42, .. })
        ));
    }
}
