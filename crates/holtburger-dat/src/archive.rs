//! Holtburger Archive (HBA) format implementation.
//!
//! HBA is a simple, high-performance archive format designed for Asheron's Call mods.
//! It supports Zstd compression and 64-bit offsets.
//!
//! Format Layout:
//! - Header (28 bytes)
//! - File Data (sequential)
//! - Index (Entry Count * 28 bytes) - MUST be sorted by ID for binary search.
//!
//! File naming convention for packing: [ID].[TYPE] (both in hex).

use crate::ResourceProvider;
use crate::error::{DatError, Result};
use crate::utils::FileExtPolyfill;
use binrw::{BinRead, BinWrite, io::Cursor};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

pub const HBA_MAGIC: [u8; 4] = *b"HBA\0";
pub const HBA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum HbaProfile {
    Unspecified = 0,
    Full = 1,
    Pruned = 2,
    Micro = 3,
}

impl HbaProfile {
    pub fn from_u32(value: u32) -> Option<Self> {
        match value {
            0 => Some(Self::Unspecified),
            1 => Some(Self::Full),
            2 => Some(Self::Pruned),
            3 => Some(Self::Micro),
            _ => None,
        }
    }
}

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
    file: File,
    file_len: u64,
}

impl HbaReader {
    pub const ENTRY_SIZE: u64 = 28;

    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = File::open(&path).map_err(|e| DatError::PathError {
            path: path.as_ref().to_path_buf(),
            source: e,
        })?;
        let header = HbaHeader::read(&mut file)?;

        if header.magic != HBA_MAGIC {
            return Err(DatError::InvalidMagic("HBA".to_string()));
        }

        if header.version != HBA_VERSION {
            return Err(DatError::UnsupportedVersion(header.version));
        }

        let file_len = file.metadata()?.len();

        // Validate that the index range fits within the file.
        let index_end = header
            .index_offset
            .checked_add(header.entry_count as u64 * Self::ENTRY_SIZE)
            .ok_or_else(|| DatError::Corruption("HBA index range overflow".into()))?;

        if index_end > file_len {
            return Err(DatError::Corruption(format!(
                "HBA index extends beyond file size ({} > {})",
                index_end, file_len
            )));
        }

        // Basic sanity check: index shouldn't start within the header.
        if header.index_offset < 28 {
            return Err(DatError::Corruption(format!(
                "HBA index offset {} is within header area",
                header.index_offset
            )));
        }

        Ok(Self {
            header,
            file,
            file_len,
        })
    }

    /// Performs an on-disk binary search to find an entry by ID.
    /// This is O(log n) IO operations, which is memory-efficient for large archives.
    ///
    /// The index MUST be sorted by ID for this to work correctly.
    pub fn find_entry(&self, id: u32) -> Result<HbaEntry> {
        if self.header.entry_count == 0 {
            return Err(DatError::NotFound(id));
        }

        let mut low = 0;
        let mut high = self.header.entry_count - 1;

        while low <= high {
            let mid = low + (high - low) / 2;
            let offset = self.header.index_offset + (mid as u64 * Self::ENTRY_SIZE);

            let mut buffer = [0u8; Self::ENTRY_SIZE as usize];
            self.file.read_exact_at_compat(&mut buffer, offset)?;

            let entry = HbaEntry::read(&mut Cursor::new(&buffer))?;

            match entry.id.cmp(&id) {
                std::cmp::Ordering::Equal => return Ok(entry),
                std::cmp::Ordering::Less => low = mid + 1,
                std::cmp::Ordering::Greater => {
                    if mid == 0 {
                        break;
                    }
                    high = mid - 1;
                }
            }
        }

        Err(DatError::NotFound(id))
    }

    /// Returns an iterator over all entries.
    pub fn entries(&self) -> HbaEntryIterator<'_> {
        HbaEntryIterator {
            reader: self,
            current: 0,
        }
    }
}

pub struct HbaEntryIterator<'a> {
    reader: &'a HbaReader,
    current: u32,
}

impl<'a> Iterator for HbaEntryIterator<'a> {
    type Item = Result<HbaEntry>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.current >= self.reader.header.entry_count {
            return None;
        }

        let offset =
            self.reader.header.index_offset + (self.current as u64 * HbaReader::ENTRY_SIZE);
        let mut buffer = [0u8; HbaReader::ENTRY_SIZE as usize];

        if let Err(e) = self.reader.file.read_exact_at_compat(&mut buffer, offset) {
            return Some(Err(e.into()));
        }

        let entry = match HbaEntry::read(&mut Cursor::new(&buffer)) {
            Ok(e) => e,
            Err(e) => return Some(Err(e.into())),
        };

        self.current += 1;
        Some(Ok(entry))
    }
}

impl ResourceProvider for HbaReader {
    fn get_file(&self, id: u32) -> Result<Vec<u8>> {
        let entry = self.find_entry(id)?;

        // Validate that the requested range fits within the underlying file.
        let file_len = self.file_len;
        let end = entry
            .offset
            .checked_add(entry.comp_size as u64)
            .ok_or_else(|| {
                DatError::Corruption(format!(
                    "Entry offset overflow for 0x{:08X}: offset {} + comp_size {}",
                    id, entry.offset, entry.comp_size
                ))
            })?;

        if end > file_len {
            return Err(DatError::Corruption(format!(
                "Entry range out of bounds for 0x{:08X}: offset {} + comp_size {} > file_len {}",
                id, entry.offset, entry.comp_size, file_len
            )));
        }

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
        self.find_entry(id).ok().map(|entry| crate::FileMetadata {
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

pub struct HbaStreamWriter {
    file: File,
    seen_ids: HashSet<u32>,
    entries: Vec<HbaEntry>,
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

    pub fn set_profile(&mut self, profile: HbaProfile) {
        self.profile = profile as u32;
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

    pub fn write<P: AsRef<Path>>(self, path: P) -> Result<()> {
        let mut writer = HbaStreamWriter::create(path)?;
        writer.set_compression(self.compress);
        writer.set_profile(HbaProfile::from_u32(self.profile).unwrap_or(HbaProfile::Unspecified));

        let mut entries: Vec<_> = self.entries.into_iter().collect();
        entries.sort_by_key(|(id, _)| *id);

        for (id, (type_id, data, is_pruned)) in entries {
            if is_pruned {
                writer.add_pruned(id, type_id, data)?;
            } else {
                writer.add(id, type_id, data)?;
            }
        }

        writer.finish()
    }
}

impl HbaStreamWriter {
    pub fn create<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = File::create(path)?;
        let dummy_header = HbaHeader {
            magic: HBA_MAGIC,
            version: HBA_VERSION,
            entry_count: 0,
            index_offset: 0,
            metadata_size: 0,
            profile: HbaProfile::Unspecified as u32,
        };
        dummy_header.write(&mut file)?;

        Ok(Self {
            file,
            seen_ids: HashSet::new(),
            entries: Vec::new(),
            compress: true,
            profile: HbaProfile::Unspecified as u32,
        })
    }

    pub fn set_compression(&mut self, compress: bool) {
        self.compress = compress;
    }

    pub fn set_profile(&mut self, profile: HbaProfile) {
        self.profile = profile as u32;
    }

    pub fn add(&mut self, id: u32, type_id: u32, data: Vec<u8>) -> Result<()> {
        self.write_entry(id, type_id, data, false)
    }

    pub fn add_pruned(&mut self, id: u32, type_id: u32, data: Vec<u8>) -> Result<()> {
        self.write_entry(id, type_id, data, true)
    }

    pub fn finish(mut self) -> Result<()> {
        self.entries.sort_by_key(|entry| entry.id);

        let index_offset = self.file.stream_position()?;
        {
            let mut buf_writer = std::io::BufWriter::new(&mut self.file);
            for entry in &self.entries {
                entry.write(&mut buf_writer)?;
            }
            buf_writer.flush()?;
        }

        self.file.seek(SeekFrom::Start(0))?;
        let final_header = HbaHeader {
            magic: HBA_MAGIC,
            version: HBA_VERSION,
            entry_count: self.entries.len() as u32,
            index_offset,
            metadata_size: 0,
            profile: self.profile,
        };
        final_header.write(&mut self.file)?;

        Ok(())
    }

    fn write_entry(&mut self, id: u32, type_id: u32, data: Vec<u8>, is_pruned: bool) -> Result<()> {
        if !self.seen_ids.insert(id) {
            return Err(DatError::DuplicateId(id));
        }

        let original_size = data.len() as u32;
        let mut flags = if is_pruned { HbaEntry::FLAG_PRUNED } else { 0 };
        let mut final_data = data;

        if self.compress {
            match zstd::encode_all(Cursor::new(&final_data), 3) {
                Ok(compressed) if compressed.len() < final_data.len() => {
                    final_data = compressed;
                    flags |= HbaEntry::FLAG_ZSTD;
                }
                Ok(_) => {}
                Err(e) => {
                    log::warn!("Compression failed for 0x{:08X}: {}", id, e);
                }
            }
        }

        let offset = self.file.stream_position()?;
        self.file.write_all(&final_data)?;

        self.entries.push(HbaEntry {
            id,
            type_id,
            offset,
            size: original_size,
            comp_size: final_data.len() as u32,
            flags,
            storage_id: 0,
            reserved: [0; 2],
        });

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
        assert_eq!(reader.find_entry(0x1111).unwrap().type_id, 0x01);
        assert_eq!(reader.find_entry(0x2222).unwrap().type_id, 0x02);

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
        let entry = reader.find_entry(0x9999).unwrap();
        assert!(entry.is_compressed());
        assert!(entry.comp_size < entry.size);
        assert_eq!(reader.get_file(0x9999)?, data);

        Ok(())
    }

    #[test]
    fn test_hba_profile_roundtrip() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("profile.hba");

        let mut writer = HbaWriter::new();
        writer.set_compression(false);
        writer.set_profile(HbaProfile::Micro);
        writer.add(0x1234, 0x0E, vec![1, 2, 3])?;
        writer.write(&path)?;

        let reader = HbaReader::open(&path)?;
        assert_eq!(
            HbaProfile::from_u32(reader.header.profile),
            Some(HbaProfile::Micro)
        );

        Ok(())
    }

    #[test]
    fn test_stream_writer_roundtrip_out_of_order_adds() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("stream.hba");

        let mut writer = HbaStreamWriter::create(&path)?;
        writer.set_compression(false);
        writer.set_profile(HbaProfile::Pruned);
        writer.add(0x2222, 0x02, vec![4, 5, 6])?;
        writer.add_pruned(0x1111, 0x01, vec![1, 2, 3])?;
        writer.finish()?;

        let reader = HbaReader::open(&path)?;
        let entries: Vec<_> = reader.entries().collect::<Result<Vec<_>>>()?;

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, 0x1111);
        assert!(entries[0].is_pruned());
        assert_eq!(entries[1].id, 0x2222);
        assert_eq!(reader.get_file(0x1111)?, vec![1, 2, 3]);
        assert_eq!(reader.get_file(0x2222)?, vec![4, 5, 6]);
        assert_eq!(
            HbaProfile::from_u32(reader.header.profile),
            Some(HbaProfile::Pruned)
        );

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

        Ok(())
    }

    #[test]
    fn test_hba_robustness_random() -> Result<()> {
        use rand::RngExt;
        let mut rng = rand::rng();
        let dir = tempdir()?;
        let path = dir.path().join("robust.hba");

        let mut expected = HashMap::new();
        let mut writer = HbaWriter::new();

        for _ in 0..50 {
            let id = rng.random::<u32>();
            let type_id = rng.random::<u32>();
            let size = rng.random_range(0..5000);
            let data: Vec<u8> = (0..size).map(|_| rng.random::<u8>()).collect();

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
