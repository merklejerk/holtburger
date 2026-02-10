pub mod file_type;
pub mod graphics;
pub mod landblock;
pub mod physics;
pub mod utils;
pub mod weenie;
pub mod archive;

use anyhow::{Context, Result};
use binrw::{BinRead, io::Cursor};
pub use file_type::DatFileType;
pub use archive::{HbaReader, HbaWriter};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub const DAT_HEADER_OFFSET: u64 = 0x140;
pub const DIRECTORY_NODE_SIZE: usize = 1716;

pub trait ResourceProvider: Send + Sync {
    /// Retrieves the raw bytes of a file by its Asheron's Call ID.
    fn get_file(&self, id: u32) -> Result<Vec<u8>>;
    
    /// Returns true if the file exists in this provider.
    fn exists(&self, id: u32) -> bool;
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
    path: PathBuf,
}

impl DatDatabase {
    pub fn new<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file =
            File::open(&path).context(format!("Failed to open DAT file: {:?}", path.as_ref()))?;

        file.seek(SeekFrom::Start(DAT_HEADER_OFFSET))?;
        let header = DatHeader::read(&mut file)?;

        let mut db = DatDatabase {
            header,
            files: HashMap::new(),
            path: path.as_ref().to_path_buf(),
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
        let entry = self
            .files
            .get(&id)
            .context(format!("File ID {:08X} not found in DAT", id))?;
        let data = self.read_file_data(entry.offset, entry.size)?;

        if entry.is_compressed() {
            Ok(utils::decompress_lrs(&data))
        } else {
            Ok(data)
        }
    }

    pub fn get_weenie_name(&self, wcid: u32) -> Option<String> {
        // Weenie support requires pulling in protocol structs, which we are decoupling.
        // For now, this convenience method might need to temporarily break or be refactored
        // if Weenie depends on crates not available here.
        // CHECK: weenie::Weenie is inside this crate (local module).
        // Does weenie::Weenie depend on core?
        if let Ok(data) = self.get_file(wcid)
            && let Ok(weenie) = weenie::Weenie::unpack(&data)
        {
            return weenie.name().cloned();
        }
        None
    }

    pub fn read_file_data(&self, offset: u32, size: u32) -> Result<Vec<u8>> {
        let mut file = File::open(&self.path)?;
        let mut buffer = vec![0u8; size as usize];
        let mut buffer_offset = 0;
        let mut remaining_size = size;
        let mut current_offset = offset;

        while remaining_size > 0 {
            file.seek(SeekFrom::Start(current_offset as u64))?;

            let mut ptr_bytes = [0u8; 4];
            file.read_exact(&mut ptr_bytes)?;
            let next_address = u32::from_le_bytes(ptr_bytes);

            if next_address == 0 {
                file.read_exact(
                    &mut buffer[buffer_offset..(buffer_offset + remaining_size as usize)],
                )?;
                remaining_size = 0;
            } else {
                let block_data_size = (self.header.block_size - 4) as usize;
                let to_read = (remaining_size as usize).min(block_data_size);

                file.read_exact(&mut buffer[buffer_offset..(buffer_offset + to_read)])?;

                buffer_offset += to_read;
                remaining_size -= to_read as u32;
                current_offset = next_address;
            }
        }

        Ok(buffer)
    }
}

impl ResourceProvider for DatDatabase {
    fn get_file(&self, id: u32) -> Result<Vec<u8>> {
        self.get_file(id)
    }

    fn exists(&self, id: u32) -> bool {
        self.files.contains_key(&id)
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
        for provider in &self.providers {
            if provider.exists(id) {
                return provider.get_file(id);
            }
        }
        anyhow::bail!("File ID {:08X} not found in any provider", id)
    }

    fn exists(&self, id: u32) -> bool {
        self.providers.iter().any(|p| p.exists(id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockProvider {
        files: HashMap<u32, Vec<u8>>,
    }

    impl ResourceProvider for MockProvider {
        fn get_file(&self, id: u32) -> Result<Vec<u8>> {
            self.files.get(&id).cloned().context("Not found")
        }
        fn exists(&self, id: u32) -> bool {
            self.files.contains_key(&id)
        }
    }

    #[test]
    fn test_composite_provider() {
        let mut p1 = MockProvider {
            files: HashMap::new(),
        };
        p1.files.insert(0x1234, vec![1, 2, 3]);

        let mut p2 = MockProvider {
            files: HashMap::new(),
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
