//! Holtburger Archive (HBA) format implementation.
//! 
//! HBA is a simple, high-performance archive format designed for Asheron's Call mods.
//! It supports Zstd compression, arbitrary metadata, and 64-bit offsets.
//! 
//! Format Layout:
//! - Header (24 bytes)
//! - File Data (sequential)
//! - Index (Entry Count * 32 bytes)
//! 
//! File naming convention for packing: [ID].[TYPE] (both in hex).

use anyhow::{Context, Result};
use binrw::{BinRead, BinWrite, io::Cursor};
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use crate::ResourceProvider;

pub const HBA_MAGIC: [u8; 4] = *b"HBA\0";
pub const HBA_VERSION: u32 = 1;

#[derive(BinRead, BinWrite, Debug)]
#[br(little)]
#[bw(little)]
pub struct HbaHeader {
    pub magic: [u8; 4],
    pub version: u32,
    pub entry_count: u32,
    pub index_offset: u64,
    pub metadata_size: u32,
}

#[derive(BinRead, BinWrite, Debug, Clone)]
#[br(little)]
#[bw(little)]
pub struct HbaEntry {
    pub id: u32,
    pub type_id: u32,
    pub offset: u64,
    pub size: u32,
    pub comp_size: u32,
    pub flags: u8,
    pub storage_id: u8,
    pub reserved: [u8; 2],
}

impl HbaEntry {
    pub const FLAG_ZSTD: u8 = 0x01;
    pub const FLAG_EXTERNAL: u8 = 0x02;

    pub fn is_compressed(&self) -> bool {
        (self.flags & Self::FLAG_ZSTD) != 0
    }
}

pub struct HbaReader {
    pub header: HbaHeader,
    pub index: HashMap<u32, HbaEntry>,
    path: PathBuf,
}

impl HbaReader {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = File::open(&path)?;
        let header = HbaHeader::read(&mut file).context("Failed to read HBA header")?;
        
        if header.magic != HBA_MAGIC {
            anyhow::bail!("Invalid HBA magic");
        }

        file.seek(SeekFrom::Start(header.index_offset))?;
        let mut index = HashMap::new();
        for _ in 0..header.entry_count {
            let entry = HbaEntry::read(&mut file)?;
            index.insert(entry.id, entry);
        }

        Ok(Self {
            header,
            index,
            path: path.as_ref().to_path_buf(),
        })
    }
}

impl ResourceProvider for HbaReader {
    fn get_file(&self, id: u32) -> Result<Vec<u8>> {
        let entry = self.index.get(&id).context("File ID not found in HBA")?;
        
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(entry.offset))?;
        
        let mut buffer = vec![0u8; entry.comp_size as usize];
        file.read_exact(&mut buffer)?;

        if entry.is_compressed() {
            let decompressed = zstd::decode_all(Cursor::new(buffer))?;
            Ok(decompressed)
        } else {
            Ok(buffer)
        }
    }

    fn exists(&self, id: u32) -> bool {
        self.index.contains_key(&id)
    }
}

pub struct HbaWriter {
    entries: Vec<(u32, u32, Vec<u8>)>,
    compress: bool,
}

impl HbaWriter {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            compress: true,
        }
    }

    pub fn set_compression(&mut self, compress: bool) {
        self.compress = compress;
    }

    pub fn add(&mut self, id: u32, type_id: u32, data: Vec<u8>) {
        self.entries.push((id, type_id, data));
    }

    pub fn write<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let mut file = File::create(path)?;
        
        // Placeholder for header
        let dummy_header = HbaHeader {
            magic: HBA_MAGIC,
            version: HBA_VERSION,
            entry_count: self.entries.len() as u32,
            index_offset: 0,
            metadata_size: 0,
        };
        dummy_header.write(&mut file)?;

        let mut hba_entries = Vec::new();

        // Write blobs
        for (id, type_id, data) in &self.entries {
            let current_offset = file.stream_position()?;
            
            let (final_data, flags) = if self.compress {
                let compressed = zstd::encode_all(Cursor::new(data), 3)?;
                if compressed.len() < data.len() {
                    (compressed, HbaEntry::FLAG_ZSTD)
                } else {
                    (data.clone(), 0)
                }
            } else {
                (data.clone(), 0)
            };

            file.write_all(&final_data)?;

            hba_entries.push(HbaEntry {
                id: *id,
                type_id: *type_id,
                offset: current_offset,
                size: data.len() as u32,
                comp_size: final_data.len() as u32,
                flags,
                storage_id: 0,
                reserved: [0; 2],
            });
        }

        // Write index
        let index_offset = file.stream_position()?;
        for entry in hba_entries {
            entry.write(&mut file)?;
        }

        // Update header
        file.seek(SeekFrom::Start(0))?;
        let final_header = HbaHeader {
            index_offset,
            ..dummy_header
        };
        final_header.write(&mut file)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_hba_roundtrip() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("test.hba");

        let mut writer = HbaWriter::new();
        writer.add(0x1111, 0x01, vec![1, 2, 3]);
        writer.add(0x2222, 0x02, vec![4, 5, 6]);
        writer.write(&path)?;

        let reader = HbaReader::open(&path)?;
        assert_eq!(reader.header.entry_count, 2);
        assert!(reader.exists(0x1111));
        assert!(reader.exists(0x2222));
        assert_eq!(reader.get_file(0x1111)?, vec![1, 2, 3]);
        assert_eq!(reader.get_file(0x2222)?, vec![4, 5, 6]);
        assert_eq!(reader.index.get(&0x1111).unwrap().type_id, 0x01);
        assert_eq!(reader.index.get(&0x2222).unwrap().type_id, 0x02);

        Ok(())
    }

    #[test]
    fn test_hba_compression() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("compress.hba");

        let mut writer = HbaWriter::new();
        // Add some repetitive data that compresses well
        let data = vec![0xCC; 1000];
        writer.add(0x9999, 0x00, data.clone());
        writer.write(&path)?;

        let reader = HbaReader::open(&path)?;
        let entry = reader.index.get(&0x9999).unwrap();
        assert!(entry.is_compressed());
        assert!(entry.comp_size < entry.size);
        assert_eq!(reader.get_file(0x9999)?, data);

        Ok(())
    }
}
