pub mod archive;
pub mod error;
pub mod file_type;
pub mod graphics;
pub mod landblock;
pub mod manifest;
pub mod physics;
pub mod utils;
pub mod weenie;

use crate::utils::FileExtPolyfill;
pub use archive::{HbaReader, HbaStreamWriter, HbaWriter};
use binrw::{BinRead, io::Cursor};
pub use error::{DatError, Result};
pub use file_type::DatFileType;
pub use manifest::StripperManifest;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;

pub const DAT_HEADER_OFFSET: u64 = 0x140;
pub const DIRECTORY_NODE_SIZE: usize = 1716;
pub const DAT_MAGIC: u32 = 0x0000_5442;
pub const RESOURCE_NAMESPACE_LEN: usize = 32;
pub const EOR_PORTAL_NAMESPACE: &str = "eor/portal";
pub const EOR_CELL_NAMESPACE: &str = "eor/cell";
pub const HOLTBURGER_CORE_NAMESPACE: &str = "holtburger/core";

#[derive(Debug, Clone)]
pub struct FileMetadata {
    pub id: u32,
    pub size: u32,
    pub is_pruned: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ResourceNamespace {
    bytes: [u8; RESOURCE_NAMESPACE_LEN],
}

impl ResourceNamespace {
    pub fn new(label: &str) -> Result<Self> {
        let label_bytes = label.as_bytes();

        if label_bytes.is_empty() {
            return Err(DatError::InvalidNamespace(
                "namespace label cannot be empty".to_string(),
            ));
        }

        if label_bytes.len() > RESOURCE_NAMESPACE_LEN {
            return Err(DatError::InvalidNamespace(format!(
                "namespace label '{}' exceeds {} bytes",
                label, RESOURCE_NAMESPACE_LEN
            )));
        }

        if label_bytes.contains(&0) {
            return Err(DatError::InvalidNamespace(format!(
                "namespace label '{}' contains a NUL byte",
                label
            )));
        }

        let mut bytes = [0u8; RESOURCE_NAMESPACE_LEN];
        bytes[..label_bytes.len()].copy_from_slice(label_bytes);

        Ok(Self { bytes })
    }

    pub fn from_bytes(bytes: [u8; RESOURCE_NAMESPACE_LEN]) -> Result<Self> {
        let first_nul = bytes.iter().position(|byte| *byte == 0);
        if let Some(index) = first_nul
            && bytes[index..].iter().any(|byte| *byte != 0)
        {
            return Err(DatError::InvalidNamespace(
                "namespace bytes must be zero-padded without embedded trailing data".to_string(),
            ));
        }

        let label_bytes = match first_nul {
            Some(index) => &bytes[..index],
            None => &bytes[..],
        };

        if label_bytes.is_empty() {
            return Err(DatError::InvalidNamespace(
                "namespace label cannot be empty".to_string(),
            ));
        }

        std::str::from_utf8(label_bytes).map_err(|error| {
            DatError::InvalidNamespace(format!("namespace bytes are not valid UTF-8: {error}"))
        })?;

        Ok(Self { bytes })
    }

    pub fn as_bytes(&self) -> &[u8; RESOURCE_NAMESPACE_LEN] {
        &self.bytes
    }

    pub fn as_str(&self) -> &str {
        let length = self
            .bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(RESOURCE_NAMESPACE_LEN);
        std::str::from_utf8(&self.bytes[..length])
            .expect("validated resource namespace should remain valid UTF-8")
    }
}

impl std::fmt::Display for ResourceNamespace {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ResourceKey<'a> {
    pub namespace: &'a str,
    pub file_id: u32,
}

impl<'a> ResourceKey<'a> {
    pub const fn new(namespace: &'a str, file_id: u32) -> Self {
        Self { namespace, file_id }
    }
}

pub trait StaticResourceKey {
    const RESOURCE_KEY: ResourceKey<'static>;
}

pub trait ResourceSource: Send + Sync {
    fn get_file_by_key(&self, key: ResourceKey<'_>) -> Result<Vec<u8>>;

    fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<FileMetadata>;

    fn has_namespace(&self, namespace: &str) -> bool;

    fn exists_by_key(&self, key: ResourceKey<'_>) -> bool {
        self.get_metadata_by_key(key).is_some()
    }
}

pub trait ResourceProvider: Send + Sync {
    /// Retrieves the raw bytes of a file by its Asheron's Call ID.
    fn get_file(&self, id: u32) -> Result<Vec<u8>>;

    /// Returns metadata for the file if it exists.
    fn get_metadata(&self, id: u32) -> Option<FileMetadata>;

    /// Returns true if the file exists in this provider.
    fn exists(&self, id: u32) -> bool {
        self.get_metadata(id).is_some()
    }
}

#[derive(BinRead, Debug)]
#[br(little)]
pub struct DatHeader {
    pub magic: u32,
    pub block_size: u32,
    pub file_size: u32,
    pub dataset: u32,
    pub subset: u32,
    pub free_head: u32,
    pub free_tail: u32,
    pub free_count: u32,
    pub root_offset: u32,
    pub new_lru: u32,
    pub old_lru: u32,
    pub use_lru: u32,
    pub master_map_id: u32,
    pub engine_version: u32,
    pub game_version: u32,
    #[br(count = 16)]
    pub version_string: Vec<u8>,
    pub version_minor: u32,
}

impl DatHeader {
    pub fn retail_namespace_hint(&self) -> Option<&'static str> {
        match (self.magic, self.block_size, self.dataset) {
            (DAT_MAGIC, 1024, 1) => Some(EOR_PORTAL_NAMESPACE),
            (DAT_MAGIC, 256, 2) => Some(EOR_CELL_NAMESPACE),
            _ => None,
        }
    }
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct DatFileEntry {
    pub bit_flags: u32,
    pub id: u32,
    pub offset: u32,
    pub size: u32,
    pub timestamp: u32,
    pub version: u32,
}

impl DatFileEntry {
    pub fn file_type(&self) -> DatFileType {
        DatFileType::from_id(self.id)
    }

    pub fn is_compressed(&self) -> bool {
        (self.bit_flags & 0x01) != 0
    }
}

pub struct DatDatabase {
    pub header: DatHeader,
    pub files: HashMap<u32, DatFileEntry>,
    file: File,
}

impl DatDatabase {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = File::open(&path).map_err(|e| DatError::PathError {
            path: path.as_ref().to_path_buf(),
            source: e,
        })?;

        file.seek(SeekFrom::Start(DAT_HEADER_OFFSET))?;
        let header = DatHeader::read(&mut file)?;

        let mut db = DatDatabase {
            header,
            files: HashMap::new(),
            file,
        };

        db.read_directory()?;

        Ok(db)
    }

    fn read_directory(&mut self) -> Result<()> {
        let root_offset = self.header.root_offset;
        self.read_node(root_offset)?;
        Ok(())
    }

    fn read_node(&mut self, offset: u32) -> Result<()> {
        if offset == 0 {
            return Ok(());
        }

        // RootOffset and other addresses already point to the DATA start (at byte 4 of the sector)
        let data = self.read_file_data(offset, DIRECTORY_NODE_SIZE as u32)?;
        let mut cursor = Cursor::new(data);

        let mut branches = [0u32; 62];
        for b in &mut branches {
            *b = u32::read_le(&mut cursor)?;
        }

        let entry_count = u32::read_le(&mut cursor)?;

        // Add files in this node
        for _ in 0..entry_count {
            let entry = DatFileEntry::read(&mut cursor)?;
            self.files.insert(entry.id, entry);
        }

        // B-Tree recursion: if branches exist, read up to entry_count + 1 children
        if branches[0] != 0 {
            for &branch in branches.iter().take(entry_count as usize + 1) {
                if branch != 0 {
                    self.read_node(branch)?;
                }
            }
        }

        Ok(())
    }

    pub fn get_file(&self, id: u32) -> Result<Vec<u8>> {
        let entry = self.files.get(&id).ok_or(DatError::NotFound(id))?;
        let data = self.read_file_data(entry.offset, entry.size)?;

        if entry.is_compressed() {
            Ok(utils::decompress_lrs(&data))
        } else {
            Ok(data)
        }
    }

    pub fn retail_namespace_hint(&self) -> Option<&'static str> {
        self.header.retail_namespace_hint()
    }

    pub fn read_file_data(&self, offset: u32, size: u32) -> Result<Vec<u8>> {
        let mut buffer = vec![0u8; size as usize];
        let mut buffer_offset = 0;
        let mut remaining_size = size;
        let mut current_offset = offset;

        while remaining_size > 0 {
            let mut ptr_bytes = [0u8; 4];
            self.file
                .read_exact_at_compat(&mut ptr_bytes, current_offset as u64)?;
            let next_address = u32::from_le_bytes(ptr_bytes);

            if next_address == 0 {
                self.file.read_exact_at_compat(
                    &mut buffer[buffer_offset..(buffer_offset + remaining_size as usize)],
                    (current_offset + 4) as u64,
                )?;
                remaining_size = 0;
            } else {
                let block_data_size = (self.header.block_size - 4) as usize;
                let to_read = (remaining_size as usize).min(block_data_size);

                self.file.read_exact_at_compat(
                    &mut buffer[buffer_offset..(buffer_offset + to_read)],
                    (current_offset + 4) as u64,
                )?;

                buffer_offset += to_read;
                remaining_size -= to_read as u32;
                current_offset = next_address;
            }
        }

        Ok(buffer)
    }
}

/// Helper function to get a weenie name from any resource provider.
pub fn get_weenie_name(provider: &dyn ResourceProvider, wcid: u32) -> Option<String> {
    if let Ok(data) = provider.get_file(wcid)
        && let Ok(weenie) = weenie::Weenie::unpack(&data)
    {
        return weenie.name().cloned();
    }
    None
}

impl ResourceProvider for DatDatabase {
    fn get_file(&self, id: u32) -> Result<Vec<u8>> {
        DatDatabase::get_file(self, id)
    }

    fn get_metadata(&self, id: u32) -> Option<FileMetadata> {
        self.files.get(&id).map(|entry| FileMetadata {
            id: entry.id,
            size: entry.size,
            is_pruned: false, // Legacy DATs are always "full" in our context
        })
    }
}

impl ResourceSource for DatDatabase {
    fn get_file_by_key(&self, key: ResourceKey<'_>) -> Result<Vec<u8>> {
        if !self.has_namespace(key.namespace) {
            return Err(DatError::NotFound(key.file_id));
        }

        self.get_file(key.file_id)
    }

    fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<FileMetadata> {
        self.has_namespace(key.namespace)
            .then(|| self.get_metadata(key.file_id))
            .flatten()
    }

    fn has_namespace(&self, namespace: &str) -> bool {
        self.retail_namespace_hint() == Some(namespace)
    }
}

/// Helper to open a resource provider from a path, automatically handling .hba vs .dat extensions.
///
/// If the path has no extension, it will probe for `.hba` first (optimized) then `.dat`.
pub fn open_provider<P: AsRef<Path>>(path: P) -> Result<Arc<dyn ResourceProvider>> {
    let path = path.as_ref();

    // If it has an extension, just open it directly
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        let ext = ext.to_lowercase();
        if ext == "hba" {
            return Ok(Arc::new(archive::HbaReader::open(path)?));
        } else if ext == "dat" {
            return Ok(Arc::new(DatDatabase::new(path)?));
        }
    }

    // Otherwise, probe
    let hba = path.with_extension("hba");
    if hba.exists() {
        return Ok(Arc::new(archive::HbaReader::open(&hba)?));
    }

    let dat = path.with_extension("dat");
    if dat.exists() {
        return Ok(Arc::new(DatDatabase::new(&dat)?));
    }

    Err(DatError::PathError {
        path: path.to_path_buf(),
        source: std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not find .hba or .dat file at this location",
        ),
    })
}

#[derive(Default, Clone)]
pub struct LayeredResourceResolver {
    sources: Vec<Arc<dyn ResourceSource>>,
}

impl LayeredResourceResolver {
    pub fn new() -> Self {
        Self {
            sources: Vec::new(),
        }
    }

    pub fn from_sources<I>(sources: I) -> Self
    where
        I: IntoIterator<Item = Arc<dyn ResourceSource>>,
    {
        Self {
            sources: sources.into_iter().collect(),
        }
    }

    pub fn add_source(&mut self, source: Arc<dyn ResourceSource>) {
        self.sources.push(source);
    }

    pub fn is_empty(&self) -> bool {
        self.sources.is_empty()
    }

    pub fn has_namespace(&self, namespace: &str) -> bool {
        self.sources
            .iter()
            .any(|source| source.has_namespace(namespace))
    }

    pub fn get_file_by_key(&self, key: ResourceKey<'_>) -> Result<Vec<u8>> {
        let mut first_pruned_source = None;

        for source in &self.sources {
            if let Some(meta) = source.get_metadata_by_key(key) {
                if !meta.is_pruned {
                    return source.get_file_by_key(key);
                }

                if first_pruned_source.is_none() {
                    first_pruned_source = Some(Arc::clone(source));
                }
            }
        }

        if let Some(source) = first_pruned_source {
            return source.get_file_by_key(key);
        }

        Err(DatError::NotFound(key.file_id))
    }

    pub fn get_file_in_namespace(&self, namespace: &str, id: u32) -> Result<Vec<u8>> {
        self.get_file_by_key(ResourceKey::new(namespace, id))
    }

    pub fn get_file_for<T: StaticResourceKey>(&self) -> Result<Vec<u8>> {
        self.get_file_by_key(T::RESOURCE_KEY)
    }

    pub fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<FileMetadata> {
        let mut first_pruned = None;

        for source in &self.sources {
            if let Some(meta) = source.get_metadata_by_key(key) {
                if !meta.is_pruned {
                    return Some(meta);
                }

                if first_pruned.is_none() {
                    first_pruned = Some(meta);
                }
            }
        }

        first_pruned
    }

    pub fn get_metadata_in_namespace(&self, namespace: &str, id: u32) -> Option<FileMetadata> {
        self.get_metadata_by_key(ResourceKey::new(namespace, id))
    }

    pub fn get_metadata_for<T: StaticResourceKey>(&self) -> Option<FileMetadata> {
        self.get_metadata_by_key(T::RESOURCE_KEY)
    }

    pub fn exists_in_namespace(&self, namespace: &str, id: u32) -> bool {
        self.get_metadata_in_namespace(namespace, id).is_some()
    }

    pub fn exists_for<T: StaticResourceKey>(&self) -> bool {
        self.get_metadata_for::<T>().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    struct MockSource {
        files: HashMap<(String, u32), Vec<u8>>,
        pruned_keys: Vec<(String, u32)>,
    }

    impl ResourceSource for MockSource {
        fn get_file_by_key(&self, key: ResourceKey<'_>) -> Result<Vec<u8>> {
            self.files
                .get(&(key.namespace.to_string(), key.file_id))
                .cloned()
                .ok_or(DatError::NotFound(key.file_id))
        }

        fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<FileMetadata> {
            self.files
                .get(&(key.namespace.to_string(), key.file_id))
                .map(|data| FileMetadata {
                    id: key.file_id,
                    size: data.len() as u32,
                    is_pruned: self
                        .pruned_keys
                        .contains(&(key.namespace.to_string(), key.file_id)),
                })
        }

        fn has_namespace(&self, namespace: &str) -> bool {
            self.files
                .keys()
                .any(|(candidate, _)| candidate == namespace)
        }
    }

    #[test]
    fn test_layered_resource_resolver_keeps_portal_and_cell_separate() {
        let mut source = MockSource {
            files: HashMap::new(),
            pruned_keys: vec![],
        };
        source
            .files
            .insert((EOR_PORTAL_NAMESPACE.to_string(), 0x1234), vec![0xAA]);
        source
            .files
            .insert((EOR_CELL_NAMESPACE.to_string(), 0x1234), vec![0xBB]);

        let resolver =
            LayeredResourceResolver::from_sources([Arc::new(source) as Arc<dyn ResourceSource>]);

        assert_eq!(
            resolver
                .get_file_in_namespace(EOR_PORTAL_NAMESPACE, 0x1234)
                .unwrap(),
            vec![0xAA]
        );
        assert_eq!(
            resolver
                .get_file_in_namespace(EOR_CELL_NAMESPACE, 0x1234)
                .unwrap(),
            vec![0xBB]
        );
        assert_eq!(
            resolver
                .get_file_by_key(ResourceKey::new(EOR_PORTAL_NAMESPACE, 0x1234))
                .unwrap(),
            vec![0xAA]
        );
    }

    #[test]
    fn test_layered_resource_resolver_prefers_unpruned_entries_from_later_sources() {
        let mut pruned = MockSource {
            files: HashMap::new(),
            pruned_keys: vec![(EOR_PORTAL_NAMESPACE.to_string(), 0x4321)],
        };
        pruned
            .files
            .insert((EOR_PORTAL_NAMESPACE.to_string(), 0x4321), vec![0x01]);

        let mut full = MockSource {
            files: HashMap::new(),
            pruned_keys: vec![],
        };
        full.files
            .insert((EOR_PORTAL_NAMESPACE.to_string(), 0x4321), vec![0x02]);

        let resolver = LayeredResourceResolver::from_sources([
            Arc::new(pruned) as Arc<dyn ResourceSource>,
            Arc::new(full) as Arc<dyn ResourceSource>,
        ]);

        assert_eq!(
            resolver
                .get_file_in_namespace(EOR_PORTAL_NAMESPACE, 0x4321)
                .unwrap(),
            vec![0x02]
        );
    }

    #[test]
    fn test_layered_resource_resolver_falls_back_to_pruned_entries() {
        let mut pruned = MockSource {
            files: HashMap::new(),
            pruned_keys: vec![(EOR_PORTAL_NAMESPACE.to_string(), 0x2222)],
        };
        pruned
            .files
            .insert((EOR_PORTAL_NAMESPACE.to_string(), 0x2222), vec![1, 2, 3]);

        let resolver =
            LayeredResourceResolver::from_sources([Arc::new(pruned) as Arc<dyn ResourceSource>]);

        assert_eq!(
            resolver
                .get_file_in_namespace(EOR_PORTAL_NAMESPACE, 0x2222)
                .unwrap(),
            vec![1, 2, 3]
        );
        assert!(
            resolver
                .get_metadata_in_namespace(EOR_PORTAL_NAMESPACE, 0x2222)
                .unwrap()
                .is_pruned
        );
    }

    #[test]
    fn test_namespace_validation_rejects_invalid_padding() {
        let mut bytes = [0u8; RESOURCE_NAMESPACE_LEN];
        bytes[0] = b'e';
        bytes[1] = 0;
        bytes[2] = b'x';

        let error = ResourceNamespace::from_bytes(bytes)
            .expect_err("embedded data after zero padding should be rejected");

        assert!(error.to_string().contains("zero-padded"));
    }

    #[test]
    fn test_layered_resource_resolver_supports_explicit_namespaces() {
        let mut source = MockSource {
            files: HashMap::new(),
            pruned_keys: vec![],
        };
        source
            .files
            .insert(("derived/test".to_string(), 0xDEAD), vec![0xCC]);

        let resolver =
            LayeredResourceResolver::from_sources([Arc::new(source) as Arc<dyn ResourceSource>]);

        assert!(resolver.has_namespace("derived/test"));
        assert_eq!(
            resolver
                .get_file_by_key(ResourceKey::new("derived/test", 0xDEAD))
                .unwrap(),
            vec![0xCC]
        );
    }

    #[test]
    fn test_dat_header_retail_namespace_hint_for_portal() {
        let header = DatHeader {
            magic: DAT_MAGIC,
            block_size: 1024,
            file_size: 0,
            dataset: 1,
            subset: 0,
            free_head: 0,
            free_tail: 0,
            free_count: 0,
            root_offset: 0,
            new_lru: 0,
            old_lru: 0,
            use_lru: 0,
            master_map_id: 0,
            engine_version: 0,
            game_version: 0,
            version_string: vec![0; 16],
            version_minor: 0,
        };

        assert_eq!(header.retail_namespace_hint(), Some(EOR_PORTAL_NAMESPACE));
    }

    #[test]
    fn test_dat_header_retail_namespace_hint_for_cell() {
        let header = DatHeader {
            magic: DAT_MAGIC,
            block_size: 256,
            file_size: 0,
            dataset: 2,
            subset: 0,
            free_head: 0,
            free_tail: 0,
            free_count: 0,
            root_offset: 0,
            new_lru: 0,
            old_lru: 0,
            use_lru: 0,
            master_map_id: 0,
            engine_version: 0,
            game_version: 0,
            version_string: vec![0; 16],
            version_minor: 0,
        };

        assert_eq!(header.retail_namespace_hint(), Some(EOR_CELL_NAMESPACE));
    }

    #[test]
    fn test_dat_header_retail_namespace_hint_rejects_unknown_metadata() {
        let header = DatHeader {
            magic: DAT_MAGIC,
            block_size: 512,
            file_size: 0,
            dataset: 99,
            subset: 0,
            free_head: 0,
            free_tail: 0,
            free_count: 0,
            root_offset: 0,
            new_lru: 0,
            old_lru: 0,
            use_lru: 0,
            master_map_id: 0,
            engine_version: 0,
            game_version: 0,
            version_string: vec![0; 16],
            version_minor: 0,
        };

        assert_eq!(header.retail_namespace_hint(), None);
    }
}
