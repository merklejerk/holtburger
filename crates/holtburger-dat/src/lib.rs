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
pub use archive::{HbaReader, HbaWriter};
use binrw::{BinRead, io::Cursor};
pub use error::{DatError, Result};
pub use file_type::DatFileType;
pub use manifest::StripperManifest;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Seek, SeekFrom};
use std::path::Path;

pub const DAT_HEADER_OFFSET: u64 = 0x140;
pub const DIRECTORY_NODE_SIZE: usize = 1716;

#[derive(Debug, Clone)]
pub struct FileMetadata {
    pub id: u32,
    pub size: u32,
    pub is_pruned: bool,
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
        self.get_file(id)
    }

    fn get_metadata(&self, id: u32) -> Option<FileMetadata> {
        self.files.get(&id).map(|entry| FileMetadata {
            id: entry.id,
            size: entry.size,
            is_pruned: false, // Legacy DATs are always "full" in our context
        })
    }
}

pub struct CompositeProvider {
    providers: Vec<Box<dyn ResourceProvider>>,
}

impl Default for CompositeProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl CompositeProvider {
    pub fn new() -> Self {
        Self {
            providers: Vec::new(),
        }
    }

    pub fn add(&mut self, provider: impl ResourceProvider + 'static) {
        self.providers.push(Box::new(provider));
    }
}

impl ResourceProvider for CompositeProvider {
    fn get_file(&self, id: u32) -> Result<Vec<u8>> {
        let mut first_pruned_provider = None;

        for provider in &self.providers {
            if let Some(meta) = provider.get_metadata(id) {
                if !meta.is_pruned {
                    // Gold standard found! Return immediately.
                    return provider.get_file(id);
                }

                // Keep track of the first provider that has even a pruned version
                if first_pruned_provider.is_none() {
                    first_pruned_provider = Some(provider);
                }
            }
        }

        // Fallback to the first pruned version if no full one found
        if let Some(provider) = first_pruned_provider {
            return provider.get_file(id);
        }

        Err(DatError::NotFound(id))
    }

    fn get_metadata(&self, id: u32) -> Option<FileMetadata> {
        let mut first_pruned = None;

        for provider in &self.providers {
            if let Some(meta) = provider.get_metadata(id) {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockProvider {
        files: HashMap<u32, Vec<u8>>,
        pruned_ids: Vec<u32>,
    }

    impl ResourceProvider for MockProvider {
        fn get_file(&self, id: u32) -> Result<Vec<u8>> {
            self.files.get(&id).cloned().ok_or(DatError::NotFound(id))
        }

        fn get_metadata(&self, id: u32) -> Option<FileMetadata> {
            self.files.get(&id).map(|data| FileMetadata {
                id,
                size: data.len() as u32,
                is_pruned: self.pruned_ids.contains(&id),
            })
        }
    }

    #[test]
    fn test_composite_quality_prioritization() {
        // Provider 1 has a PRUNED version of 0x1111
        let mut p1 = MockProvider {
            files: HashMap::new(),
            pruned_ids: vec![0x1111],
        };
        p1.files.insert(0x1111, vec![0xDE, 0xAD]); // Pruned data

        // Provider 2 has a FULL version of 0x1111
        let mut p2 = MockProvider {
            files: HashMap::new(),
            pruned_ids: vec![],
        };
        p2.files.insert(0x1111, vec![0xBE, 0xEF]); // Full data

        let mut composite = CompositeProvider::new();
        // Add p1 (pruned) first. In a "dumb" VFS, this would always win.
        composite.add(p1);
        composite.add(p2);

        // Should find the FULL version from p2 even though it was added second!
        let data = composite.get_file(0x1111).unwrap();
        assert_eq!(data, vec![0xBE, 0xEF]);

        // Metadata should also reflect the non-pruned status
        let meta = composite.get_metadata(0x1111).unwrap();
        assert!(!meta.is_pruned);
    }

    #[test]
    fn test_composite_pruned_fallback() {
        // If only pruned versions exist, we should still get one
        let mut p1 = MockProvider {
            files: HashMap::new(),
            pruned_ids: vec![0x2222],
        };
        p1.files.insert(0x2222, vec![1, 2, 3]);

        let mut composite = CompositeProvider::new();
        composite.add(p1);

        let data = composite.get_file(0x2222).unwrap();
        assert_eq!(data, vec![1, 2, 3]);
        assert!(composite.get_metadata(0x2222).unwrap().is_pruned);
    }

    #[test]
    fn test_composite_provider() {
        let mut p1 = MockProvider {
            files: HashMap::new(),
            pruned_ids: vec![],
        };
        p1.files.insert(0x1234, vec![1, 2, 3]);

        let mut p2 = MockProvider {
            files: HashMap::new(),
            pruned_ids: vec![],
        };
        p2.files.insert(0x5678, vec![4, 5, 6]);

        let mut composite = CompositeProvider::new();
        composite.add(p1);
        composite.add(p2);

        assert!(composite.exists(0x1234));
        assert!(composite.exists(0x5678));
        assert!(!composite.exists(0x9999));

        assert_eq!(composite.get_file(0x1234).unwrap(), vec![1, 2, 3]);
        assert_eq!(composite.get_file(0x5678).unwrap(), vec![4, 5, 6]);
    }
}
