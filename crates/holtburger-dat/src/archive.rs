//! Holtburger Archive (HBA) format implementation.
//!
//! HBA is a simple, high-performance archive format designed for Asheron's Call mods.
//! It supports Zstd compression, arbitrary metadata, and 64-bit offsets.
//!
//! Format Layout:
//! - Header (28 bytes)
//! - File Data (sequential)
//! - Index (Entry Count * 28 bytes)
//!
//! File naming convention for packing: [ID].[TYPE] (both in hex).

use crate::ResourceProvider;
use crate::error::{DatError, Result};
use binrw::{BinRead, BinWrite, io::Cursor};
use rayon::prelude::*;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;
use crate::utils::FileExtPolyfill;

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
    pub profile: u32,
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
    pub const FLAG_PRUNED: u8 = 0x04;

    pub fn is_compressed(&self) -> bool {
        (self.flags & Self::FLAG_ZSTD) != 0
    }

    pub fn is_pruned(&self) -> bool {
        (self.flags & Self::FLAG_PRUNED) != 0
    }
}

#[derive(Debug)]
pub struct HbaReader {
    pub header: HbaHeader,
    pub index: HashMap<u32, HbaEntry>,
    file: File,
}

impl HbaReader {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = File::open(&path)?;
        let header = HbaHeader::read(&mut file)?;

        if header.magic != HBA_MAGIC {
            return Err(DatError::InvalidMagic("HBA".to_string()));
        }

        if header.version != HBA_VERSION {
            return Err(DatError::UnsupportedVersion(header.version));
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
            file,
        })
    }
}

impl ResourceProvider for HbaReader {
    fn get_file(&self, id: u32) -> Result<Vec<u8>> {
        let entry = self.index.get(&id).ok_or(DatError::NotFound(id))?;

        let mut buffer = vec![0u8; entry.comp_size as usize];
        self.file.read_exact_at_compat(&mut buffer, entry.offset)?;

        if entry.is_compressed() {
            let decompressed = zstd::bulk::decompress(&buffer, entry.size as usize)
                .map_err(|_| DatError::DecompressionFailed(id))?;

            if decompressed.len() != entry.size as usize {
                return Err(DatError::Corruption(format!(
                    "Decompressed size mismatch for 0x{:08X}: expected {}, got {}",
                    id,
                    entry.size,
                    decompressed.len()
                )));
            }

            Ok(decompressed)
        } else {
            Ok(buffer)
        }
    }

    fn get_metadata(&self, id: u32) -> Option<crate::FileMetadata> {
        self.index.get(&id).map(|entry| crate::FileMetadata {
            id: entry.id,
            size: entry.size,
            is_pruned: entry.is_pruned(),
        })
    }
}

pub struct HbaWriter {
    entries: HashMap<u32, (u32, Vec<u8>, bool)>,
    compress: bool,
    profile: u32,
}

impl HbaWriter {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            compress: true,
            profile: 0,
        }
    }
}

impl Default for HbaWriter {
    fn default() -> Self {
        Self::new()
    }
}

impl HbaWriter {
    pub fn set_compression(&mut self, compress: bool) {
        self.compress = compress;
    }

    pub fn set_profile(&mut self, profile: u32) {
        self.profile = profile;
    }

    pub fn add(&mut self, id: u32, type_id: u32, data: Vec<u8>) -> Result<()> {
        if self.entries.contains_key(&id) {
            return Err(DatError::DuplicateId(id));
        }
        self.entries.insert(id, (type_id, data, false));
        Ok(())
    }

    pub fn add_pruned(&mut self, id: u32, type_id: u32, data: Vec<u8>) -> Result<()> {
        if self.entries.contains_key(&id) {
            return Err(DatError::DuplicateId(id));
        }
        self.entries.insert(id, (type_id, data, true));
        Ok(())
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
            profile: self.profile,
        };
        dummy_header.write(&mut file)?;

        // Parallel compression and preparation
        let processed: Vec<(u32, u32, Vec<u8>, u32, u8)> = self
            .entries
            .par_iter()
            .map(|(id, (type_id, data, is_pruned))| {
                let flags = if *is_pruned { HbaEntry::FLAG_PRUNED } else { 0 };
                let original_size = data.len() as u32;

                if self.compress {
                    match zstd::encode_all(Cursor::new(data), 3) {
                        Ok(compressed) if compressed.len() < data.len() => {
                            return (
                                *id,
                                *type_id,
                                compressed,
                                original_size,
                                flags | HbaEntry::FLAG_ZSTD,
                            );
                        }
                        Ok(_) => {} // Not smaller, use original
                        Err(e) => {
                            eprintln!("Warning: Compression failed for 0x{:08X}: {}", id, e);
                        }
                    }
                }

                (*id, *type_id, data.clone(), original_size, flags)
            })
            .collect();

        let mut hba_entries = Vec::new();

        // Sequential write to disk
        for (id, type_id, final_data, original_size, flags) in processed {
            let current_offset = file.stream_position()?;
            file.write_all(&final_data)?;

            hba_entries.push(HbaEntry {
                id,
                type_id,
                offset: current_offset,
                size: original_size,
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
        writer.add(0x1111, 0x01, vec![1, 2, 3])?;
        writer.add(0x2222, 0x02, vec![4, 5, 6])?;
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
        writer.add(0x9999, 0x00, data.clone())?;
        writer.write(&path)?;

        let reader = HbaReader::open(&path)?;
        let entry = reader.index.get(&0x9999).unwrap();
        assert!(entry.is_compressed());
        assert!(entry.comp_size < entry.size);
        assert_eq!(reader.get_file(0x9999)?, data);

        Ok(())
    }

    #[test]
    fn test_hba_invalid_magic() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("bad.hba");
        // Write enough bytes for header but wrong magic
        let mut bad_header = [0u8; 28];
        bad_header[0..4].copy_from_slice(b"BAD!");
        std::fs::write(&path, bad_header)?;

        let result = HbaReader::open(&path);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid magic"));

        Ok(())
    }

    #[test]
    fn test_hba_empty() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("empty.hba");

        let writer = HbaWriter::new();
        writer.write(&path)?;

        let reader = HbaReader::open(&path)?;
        assert_eq!(reader.header.entry_count, 0);
        assert_eq!(reader.index.len(), 0);

        Ok(())
    }

    #[test]
    fn test_hba_robustness_random() -> Result<()> {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let dir = tempdir()?;
        let path = dir.path().join("robust.hba");

        let mut expected = HashMap::new();
        let mut writer = HbaWriter::new();

        for _ in 0..50 {
            let id = rng.r#gen::<u32>();
            let type_id = rng.r#gen::<u32>();
            let size = rng.gen_range(0..5000);
            let data: Vec<u8> = (0..size).map(|_| rng.r#gen::<u8>()).collect();

            writer.add(id, type_id, data.clone())?;
            expected.insert(id, data);
        }

        writer.write(&path)?;

        let reader = HbaReader::open(&path)?;
        for (id, data) in expected {
            assert!(reader.exists(id));
            assert_eq!(reader.get_file(id)?, data);
        }

        Ok(())
    }
}
