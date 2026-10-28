//! Versioned, independently compressed prepared-navigation blocks.
//!
//! The 56-byte little-endian header is magic[8], version:u32, entry_count:u32,
//! directory_offset:u64, bootstrap_sha256[32]. A sorted terminal directory addresses
//! cell-owner, shared-geometry, and terrain blocks. Each 28-byte entry is kind:u32, id:u32,
//! offset:u64, decoded_length:u32, stored_length:u32, encoding:u32 (0 raw, 1 zstd).
//! Typed payloads use the explicit version-one MessagePack schema in `payload`, retaining
//! f32 geometry and source identities. Schema field/variant order is part of the version.
//! Runtime reads are positioned, so existing content workers can share an opened archive.

use std::{
    collections::BTreeMap,
    fs::File,
    io::{BufReader, Cursor, Read, Seek, SeekFrom, Write},
    path::Path,
};

use binrw::{BinRead, BinWrite};
use holtburger_dat::utils::FileExtPolyfill;
use sha2::{Digest, Sha256};
use thiserror::Error;

mod payload;
pub use payload::{
    NavigationBuilding, NavigationBuildingPortal, NavigationCell, NavigationPortalConnection,
    NavigationPortalGeometry, NavigationRoomGeometry, NavigationTerrain,
};

const MAGIC: [u8; 8] = *b"HLTBNAV\0";
/// Prepared navigation format version, independent of the application's version.
pub const NAVIGATION_FORMAT_VERSION: u32 = 1;
/// Bootstrap companion filename in a generated content directory.
pub const BOOTSTRAP_FILE: &str = "bootstrap.hba";
/// Prepared scene companion filename in a generated content directory.
pub const NAVIGATION_FILE: &str = "navigation.hnav";
/// Generated provenance and component identities, read by inspection/release tooling.
pub const CONTENT_INFO_FILE: &str = "content-info.json";
const HEADER_BYTES: u64 = 56;
const DIRECTORY_ENTRY_BYTES: u64 = 28;

/// An independently loadable family of prepared navigation data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum NavigationBlockKind {
    /// Parsed cells indexed by normalized landblock owner.
    Cells = 1,
    /// Shared room structures indexed by their source Environment identity.
    SharedGeometry = 2,
    /// Resolved outdoor facts indexed by normalized landblock owner.
    Terrain = 3,
}

/// Stable directory identity; source cell and Environment identities remain authoritative.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct NavigationBlockKey {
    /// Selects the decoder for this prepared product.
    pub kind: NavigationBlockKind,
    /// Normalized owner or Environment ID, as defined by the block kind.
    pub id: u32,
}

/// Stored block sizes reported by generator/inspection tooling, including raw-block cases.
#[derive(Debug, Clone, Copy)]
pub struct NavigationBlockInfo {
    /// Product identity in the directory.
    pub key: NavigationBlockKey,
    /// Byte length of the typed payload before compression.
    pub decoded_bytes: u32,
    /// Payload bytes on disk, excluding the directory entry.
    pub stored_bytes: u32,
}

/// Fingerprints exact file bytes for generation, inspection, and companion selection.
pub fn sha256_file(path: impl AsRef<Path>) -> Result<[u8; 32]> {
    let mut source = File::open(path)?;
    let mut digest = Sha256::new();
    std::io::copy(&mut source, &mut digest)?;
    Ok(digest.finalize().into())
}

/// Structural or I/O failure while opening, producing, or reading a navigation bundle.
#[derive(Debug, Error)]
pub enum NavigationArchiveError {
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Wire(#[from] binrw::Error),
    #[error("not a Holtburger navigation file")]
    Magic,
    #[error("unsupported navigation format {0}")]
    Version(u32),
    #[error("navigation directory does not occupy the end of the file")]
    DirectoryRange,
    #[error("unsupported navigation block kind {0}")]
    BlockKind(u32),
    #[error("unsupported navigation block encoding {0}")]
    Encoding(u32),
    #[error("navigation directory keys must be strictly increasing")]
    DirectoryOrder,
    #[error("navigation block {0:?} is outside the payload range")]
    BlockRange(NavigationBlockKey),
    #[error("raw navigation block {0:?} has inconsistent lengths")]
    RawLength(NavigationBlockKey),
    #[error("navigation block {0:?} does not decode to its declared length")]
    DecodedLength(NavigationBlockKey),
    #[error("duplicate navigation block {0:?}")]
    Duplicate(NavigationBlockKey),
    #[error("navigation data exceeds the wire representation")]
    Size,
    #[error(transparent)]
    Encode(#[from] rmp_serde::encode::Error),
    #[error(transparent)]
    Decode(#[from] rmp_serde::decode::Error),
    #[error("invalid navigation product: {0}")]
    Product(String),
    #[error("navigation bundle does not match its companion bootstrap HBA")]
    BootstrapMismatch,
}

type Result<T> = std::result::Result<T, NavigationArchiveError>;

#[derive(BinRead, BinWrite)]
#[brw(little)]
struct Header {
    magic: [u8; 8],
    version: u32,
    entry_count: u32,
    directory_offset: u64,
    bootstrap_sha256: [u8; 32],
}

#[derive(Clone, Copy, BinRead, BinWrite)]
#[brw(little)]
struct WireEntry {
    kind: u32,
    id: u32,
    offset: u64,
    decoded_length: u32,
    stored_length: u32,
    encoding: u32,
}

#[derive(Clone, Copy)]
enum Encoding {
    Raw,
    Zstd,
}

struct Entry {
    key: NavigationBlockKey,
    offset: u64,
    decoded_length: u32,
    stored_length: u32,
    encoding: Encoding,
}

impl Entry {
    fn from_wire(wire: WireEntry, directory_offset: u64) -> Result<Self> {
        let kind = match wire.kind {
            1 => NavigationBlockKind::Cells,
            2 => NavigationBlockKind::SharedGeometry,
            3 => NavigationBlockKind::Terrain,
            other => return Err(NavigationArchiveError::BlockKind(other)),
        };
        let key = NavigationBlockKey { kind, id: wire.id };
        let encoding = match wire.encoding {
            0 => Encoding::Raw,
            1 => Encoding::Zstd,
            other => return Err(NavigationArchiveError::Encoding(other)),
        };
        if wire.offset < HEADER_BYTES
            || wire
                .offset
                .checked_add(u64::from(wire.stored_length))
                .is_none_or(|end| end > directory_offset)
        {
            return Err(NavigationArchiveError::BlockRange(key));
        }
        if matches!(encoding, Encoding::Raw) && wire.decoded_length != wire.stored_length {
            return Err(NavigationArchiveError::RawLength(key));
        }
        Ok(Self {
            key,
            offset: wire.offset,
            decoded_length: wire.decoded_length,
            stored_length: wire.stored_length,
            encoding,
        })
    }
}

/// Opened immutable navigation directory, safe to share across content workers.
pub struct NavigationArchive {
    file: File,
    bootstrap_sha256: [u8; 32],
    entries: Vec<Entry>,
}

impl NavigationArchive {
    /// Opens a generated pair, rejecting accidentally mixed bootstrap/navigation generations.
    pub fn open_for_bootstrap(path: impl AsRef<Path>, bootstrap: impl AsRef<Path>) -> Result<Self> {
        let archive = Self::open(path)?;
        if archive.bootstrap_sha256 != sha256_file(bootstrap)? {
            return Err(NavigationArchiveError::BootstrapMismatch);
        }
        Ok(archive)
    }

    /// Validates the header and directory without reading or decoding world payloads.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let file = File::open(path)?;
        let mut reader = BufReader::new(&file);
        let header = Header::read(&mut reader)?;
        if header.magic != MAGIC {
            return Err(NavigationArchiveError::Magic);
        }
        if header.version != NAVIGATION_FORMAT_VERSION {
            return Err(NavigationArchiveError::Version(header.version));
        }
        let directory_end = header
            .directory_offset
            .checked_add(u64::from(header.entry_count) * DIRECTORY_ENTRY_BYTES)
            .ok_or(NavigationArchiveError::DirectoryRange)?;
        if header.directory_offset < HEADER_BYTES || directory_end != file.metadata()?.len() {
            return Err(NavigationArchiveError::DirectoryRange);
        }
        reader.seek(SeekFrom::Start(header.directory_offset))?;
        let mut entries = Vec::new();
        for _ in 0..header.entry_count {
            let entry = Entry::from_wire(WireEntry::read(&mut reader)?, header.directory_offset)?;
            if entries
                .last()
                .is_some_and(|previous: &Entry| previous.key >= entry.key)
            {
                return Err(NavigationArchiveError::DirectoryOrder);
            }
            entries.push(entry);
        }
        Ok(Self {
            file,
            bootstrap_sha256: header.bootstrap_sha256,
            entries,
        })
    }

    /// Digest checked against the companion bootstrap by the selected CLI-content loader.
    pub fn bootstrap_sha256(&self) -> &[u8; 32] {
        &self.bootstrap_sha256
    }

    /// Directory identities used for content inspection and archived-cell owner discovery.
    pub fn keys(&self) -> impl ExactSizeIterator<Item = NavigationBlockKey> + '_ {
        self.entries.iter().map(|entry| entry.key)
    }

    /// Describes stored payloads without decompressing or parsing world data.
    pub fn blocks(&self) -> impl ExactSizeIterator<Item = NavigationBlockInfo> + '_ {
        self.entries.iter().map(|entry| NavigationBlockInfo {
            key: entry.key,
            decoded_bytes: entry.decoded_length,
            stored_bytes: entry.stored_length,
        })
    }

    /// Reads one block, returning `None` only when the identity is not in this directory.
    pub fn read_block(&self, key: NavigationBlockKey) -> Result<Option<Vec<u8>>> {
        let Ok(index) = self.entries.binary_search_by_key(&key, |entry| entry.key) else {
            return Ok(None);
        };
        let entry = &self.entries[index];
        let mut stored = vec![0; entry.stored_length as usize];
        self.file.read_exact_at_compat(&mut stored, entry.offset)?;
        let decoded = match entry.encoding {
            Encoding::Raw => stored,
            Encoding::Zstd => {
                let decoder = zstd::Decoder::new(Cursor::new(stored))?;
                let mut decoded = Vec::new();
                // Refuse a frame that expands past its declared size, not just a short frame.
                decoder
                    .take(u64::from(entry.decoded_length) + 1)
                    .read_to_end(&mut decoded)?;
                decoded
            }
        };
        if decoded.len() != entry.decoded_length as usize {
            return Err(NavigationArchiveError::DecodedLength(key));
        }
        Ok(Some(decoded))
    }
}

/// Streaming writer used inside the generator's unpublished staging directory.
pub struct NavigationArchiveWriter {
    file: File,
    bootstrap_sha256: [u8; 32],
    entries: BTreeMap<NavigationBlockKey, WireEntry>,
}

impl NavigationArchiveWriter {
    /// Creates a new staging file, refusing to overwrite an existing file.
    pub fn create(path: impl AsRef<Path>, bootstrap_sha256: [u8; 32]) -> Result<Self> {
        let mut file = File::create_new(path)?;
        file.write_all(&[0; HEADER_BYTES as usize])?;
        Ok(Self {
            file,
            bootstrap_sha256,
            entries: BTreeMap::new(),
        })
    }

    /// Writes a prepared block; generation supplies stable key order for reproducible payloads.
    pub fn add_block(&mut self, key: NavigationBlockKey, decoded: &[u8]) -> Result<()> {
        if self.entries.contains_key(&key) {
            return Err(NavigationArchiveError::Duplicate(key));
        }
        let decoded_length =
            u32::try_from(decoded.len()).map_err(|_| NavigationArchiveError::Size)?;
        let compressed = zstd::encode_all(Cursor::new(decoded), 3)?;
        let (stored, encoding) = if compressed.len() < decoded.len() {
            (compressed.as_slice(), 1)
        } else {
            (decoded, 0)
        };
        let entry = WireEntry {
            kind: key.kind as u32,
            id: key.id,
            offset: self.file.stream_position()?,
            decoded_length,
            stored_length: u32::try_from(stored.len()).map_err(|_| NavigationArchiveError::Size)?,
            encoding,
        };
        self.file.write_all(stored)?;
        self.entries.insert(key, entry);
        Ok(())
    }

    /// Completes the terminal directory and header before the caller publishes the staged pair.
    pub fn finish(mut self) -> Result<()> {
        let header = Header {
            magic: MAGIC,
            version: NAVIGATION_FORMAT_VERSION,
            entry_count: u32::try_from(self.entries.len())
                .map_err(|_| NavigationArchiveError::Size)?,
            directory_offset: self.file.stream_position()?,
            bootstrap_sha256: self.bootstrap_sha256,
        };
        for entry in self.entries.into_values() {
            entry.write(&mut self.file)?;
        }
        self.file.seek(SeekFrom::Start(0))?;
        header.write(&mut self.file)?;
        self.file.sync_all()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests;
