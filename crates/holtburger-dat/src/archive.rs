//! Holtburger Archive (HBA) format implementation.
//!
//! HBA v2 is a namespace-aware archive format designed for Asheron's Call data bundles.
//! It supports Zstd compression, 64-bit offsets, fixed-width namespace labels, and a
//! namespace lookup table for efficient two-stage binary search.

use crate::error::{DatError, Result};
use crate::utils::FileExtPolyfill;
use crate::{
    RESOURCE_NAMESPACE_LEN, ResourceKey, ResourceNamespace, ResourceProvider, ResourceSource,
};
use binrw::{BinRead, BinWrite, io::Cursor};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;

pub const HBA_MAGIC: [u8; 4] = *b"HBA\0";
pub const HBA_VERSION: u32 = 2;
const HBA_HEADER_SIZE: u64 = 24;

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

#[derive(BinRead, BinWrite, Debug, Clone, Copy)]
#[br(little)]
#[bw(little)]
struct HbaNamespaceIndexEntry {
    pub namespace: [u8; RESOURCE_NAMESPACE_LEN],
    pub start_index: u32,
    pub entry_count: u32,
}

impl HbaNamespaceIndexEntry {
    const SIZE: u32 = RESOURCE_NAMESPACE_LEN as u32 + 4 + 4;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HbaNamespaceSpan {
    pub namespace: ResourceNamespace,
    pub start_index: u32,
    pub entry_count: u32,
}

#[derive(BinRead, BinWrite, Debug, Clone)]
#[br(little)]
#[bw(little)]
pub struct HbaEntry {
    pub namespace: [u8; RESOURCE_NAMESPACE_LEN],
    pub file_id: u32,
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

    pub fn namespace_id(&self) -> Result<ResourceNamespace> {
        ResourceNamespace::from_bytes(self.namespace)
    }
}

#[derive(Debug)]
pub struct HbaReader {
    pub header: HbaHeader,
    file: File,
    file_len: u64,
    namespace_spans: Vec<HbaNamespaceSpan>,
}

impl HbaReader {
    pub const ENTRY_SIZE: u64 = RESOURCE_NAMESPACE_LEN as u64 + 28;

    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = File::open(&path).map_err(|error| DatError::PathError {
            path: path.as_ref().to_path_buf(),
            source: error,
        })?;
        let header = HbaHeader::read(&mut file)?;

        if header.magic != HBA_MAGIC {
            return Err(DatError::InvalidMagic("HBA".to_string()));
        }

        if header.version != HBA_VERSION {
            return Err(DatError::UnsupportedVersion(header.version));
        }

        let file_len = file.metadata()?.len();
        let index_size = header
            .entry_count
            .checked_mul(Self::ENTRY_SIZE as u32)
            .ok_or_else(|| DatError::Corruption("HBA index size overflow".into()))?;
        let index_end = header
            .index_offset
            .checked_add(index_size as u64)
            .ok_or_else(|| DatError::Corruption("HBA index range overflow".into()))?;

        if index_end > file_len {
            return Err(DatError::Corruption(format!(
                "HBA index extends beyond file size ({} > {})",
                index_end, file_len
            )));
        }

        let metadata_offset = header
            .index_offset
            .checked_sub(header.metadata_size as u64)
            .ok_or_else(|| DatError::Corruption("HBA metadata offset underflow".into()))?;

        if metadata_offset < HBA_HEADER_SIZE {
            return Err(DatError::Corruption(format!(
                "HBA metadata offset {} is within header area",
                metadata_offset
            )));
        }

        if header.metadata_size == 0 && header.entry_count > 0 {
            return Err(DatError::Corruption(
                "HBA v2 archives with entries must include namespace metadata".into(),
            ));
        }

        if header.metadata_size > 0 && header.index_offset > file_len {
            return Err(DatError::Corruption(format!(
                "HBA metadata extends beyond file size (index offset {} > {})",
                header.index_offset, file_len
            )));
        }

        let namespace_spans = Self::read_namespace_spans(
            &mut file,
            metadata_offset,
            header.metadata_size,
            header.entry_count,
        )?;

        Ok(Self {
            header,
            file,
            file_len,
            namespace_spans,
        })
    }

    pub fn namespaces(&self) -> impl Iterator<Item = ResourceNamespace> + '_ {
        self.namespace_spans.iter().map(|span| span.namespace)
    }

    pub fn default_namespace(&self) -> Option<ResourceNamespace> {
        (self.namespace_spans.len() == 1).then_some(self.namespace_spans[0].namespace)
    }

    pub fn has_namespace(&self, namespace: &str) -> bool {
        let Ok(namespace_id) = ResourceNamespace::new(namespace) else {
            return false;
        };

        self.lookup_namespace_span(namespace_id).is_some()
    }

    pub fn find_entry_in_namespace(&self, namespace: &str, file_id: u32) -> Result<HbaEntry> {
        let namespace_id = ResourceNamespace::new(namespace)?;
        self.find_entry_with_namespace_id(namespace_id, file_id)
    }

    pub fn find_entry(&self, file_id: u32) -> Result<HbaEntry> {
        let namespace = self.default_namespace().ok_or_else(|| {
            DatError::Other(
                "HBA v2 archive contains multiple namespaces; explicit namespace lookup is required"
                    .to_string(),
            )
        })?;

        self.find_entry_with_namespace_id(namespace, file_id)
    }

    pub fn get_file_in_namespace(&self, namespace: &str, file_id: u32) -> Result<Vec<u8>> {
        let entry = self.find_entry_in_namespace(namespace, file_id)?;
        self.read_entry_data(&entry)
    }

    pub fn get_metadata_in_namespace(
        &self,
        namespace: &str,
        file_id: u32,
    ) -> Option<crate::FileMetadata> {
        self.find_entry_in_namespace(namespace, file_id)
            .ok()
            .map(|entry| crate::FileMetadata {
                id: entry.file_id,
                size: entry.size,
                is_pruned: entry.is_pruned(),
            })
    }

    pub fn entries(&self) -> HbaEntryIterator<'_> {
        HbaEntryIterator {
            reader: self,
            current: 0,
        }
    }

    fn find_entry_with_namespace_id(
        &self,
        namespace: ResourceNamespace,
        file_id: u32,
    ) -> Result<HbaEntry> {
        let Some(span) = self.lookup_namespace_span(namespace) else {
            return Err(DatError::NotFound(file_id));
        };

        if span.entry_count == 0 {
            return Err(DatError::NotFound(file_id));
        }

        let mut low = span.start_index;
        let mut high = span.start_index + span.entry_count - 1;

        while low <= high {
            let mid = low + (high - low) / 2;
            let entry = self.read_entry_at(mid)?;

            match entry.file_id.cmp(&file_id) {
                std::cmp::Ordering::Equal => return Ok(entry),
                std::cmp::Ordering::Less => low = mid + 1,
                std::cmp::Ordering::Greater => {
                    if mid == span.start_index {
                        break;
                    }
                    high = mid - 1;
                }
            }
        }

        Err(DatError::NotFound(file_id))
    }

    fn lookup_namespace_span(&self, namespace: ResourceNamespace) -> Option<&HbaNamespaceSpan> {
        self.namespace_spans
            .binary_search_by_key(&namespace, |span| span.namespace)
            .ok()
            .map(|index| &self.namespace_spans[index])
    }

    fn read_entry_at(&self, index: u32) -> Result<HbaEntry> {
        let offset = self.header.index_offset + (index as u64 * Self::ENTRY_SIZE);
        let mut buffer = [0u8; Self::ENTRY_SIZE as usize];
        self.file.read_exact_at_compat(&mut buffer, offset)?;
        Ok(HbaEntry::read(&mut Cursor::new(&buffer))?)
    }

    fn read_entry_data(&self, entry: &HbaEntry) -> Result<Vec<u8>> {
        let end = entry
            .offset
            .checked_add(entry.comp_size as u64)
            .ok_or_else(|| {
                DatError::Corruption(format!(
                    "Entry offset overflow for 0x{:08X}: offset {} + comp_size {}",
                    entry.file_id, entry.offset, entry.comp_size
                ))
            })?;

        if end > self.file_len {
            return Err(DatError::Corruption(format!(
                "Entry range out of bounds for 0x{:08X}: offset {} + comp_size {} > file_len {}",
                entry.file_id, entry.offset, entry.comp_size, self.file_len
            )));
        }

        let mut buffer = vec![0u8; entry.comp_size as usize];
        self.file.read_exact_at_compat(&mut buffer, entry.offset)?;

        if entry.is_compressed() {
            let decompressed = zstd::bulk::decompress(&buffer, entry.size as usize)
                .map_err(|_| DatError::DecompressionFailed(entry.file_id))?;

            if decompressed.len() != entry.size as usize {
                return Err(DatError::Corruption(format!(
                    "Decompressed size mismatch for 0x{:08X}: expected {}, got {}",
                    entry.file_id,
                    entry.size,
                    decompressed.len()
                )));
            }

            Ok(decompressed)
        } else {
            Ok(buffer)
        }
    }

    fn read_namespace_spans(
        file: &mut File,
        metadata_offset: u64,
        metadata_size: u32,
        total_entries: u32,
    ) -> Result<Vec<HbaNamespaceSpan>> {
        if metadata_size == 0 {
            return Ok(Vec::new());
        }

        let mut metadata = vec![0u8; metadata_size as usize];
        file.read_exact_at_compat(&mut metadata, metadata_offset)?;
        let mut cursor = Cursor::new(metadata);

        let namespace_count = u32::read_le(&mut cursor)?;
        let expected_size = 4 + namespace_count * HbaNamespaceIndexEntry::SIZE;
        if expected_size != metadata_size {
            return Err(DatError::Corruption(format!(
                "HBA metadata size mismatch: header says {}, metadata contents require {}",
                metadata_size, expected_size
            )));
        }

        let mut spans = Vec::with_capacity(namespace_count as usize);
        let mut expected_start_index = 0u32;
        let mut previous_namespace = None;

        for _ in 0..namespace_count {
            let metadata_entry = HbaNamespaceIndexEntry::read(&mut cursor)?;
            let namespace = ResourceNamespace::from_bytes(metadata_entry.namespace)?;

            if let Some(previous) = previous_namespace
                && previous >= namespace
            {
                return Err(DatError::Corruption(
                    "HBA namespace metadata is not strictly sorted".to_string(),
                ));
            }

            if metadata_entry.start_index != expected_start_index {
                return Err(DatError::Corruption(format!(
                    "HBA namespace metadata is not contiguous: expected start {}, found {}",
                    expected_start_index, metadata_entry.start_index
                )));
            }

            let end_index = metadata_entry
                .start_index
                .checked_add(metadata_entry.entry_count)
                .ok_or_else(|| DatError::Corruption("HBA namespace span overflow".into()))?;
            if end_index > total_entries {
                return Err(DatError::Corruption(format!(
                    "HBA namespace span exceeds total entry count ({} > {})",
                    end_index, total_entries
                )));
            }

            spans.push(HbaNamespaceSpan {
                namespace,
                start_index: metadata_entry.start_index,
                entry_count: metadata_entry.entry_count,
            });

            previous_namespace = Some(namespace);
            expected_start_index = end_index;
        }

        if expected_start_index != total_entries {
            return Err(DatError::Corruption(format!(
                "HBA namespace metadata covered {} entries but header declares {}",
                expected_start_index, total_entries
            )));
        }

        Ok(spans)
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

        let entry = self.reader.read_entry_at(self.current);
        self.current += 1;
        Some(entry)
    }
}

impl ResourceProvider for HbaReader {
    fn get_file(&self, file_id: u32) -> Result<Vec<u8>> {
        let entry = self.find_entry(file_id)?;
        self.read_entry_data(&entry)
    }

    fn get_metadata(&self, file_id: u32) -> Option<crate::FileMetadata> {
        self.find_entry(file_id)
            .ok()
            .map(|entry| crate::FileMetadata {
                id: entry.file_id,
                size: entry.size,
                is_pruned: entry.is_pruned(),
            })
    }
}

impl ResourceSource for HbaReader {
    fn get_file_by_key(&self, key: ResourceKey<'_>) -> Result<Vec<u8>> {
        self.get_file_in_namespace(key.namespace, key.file_id)
    }

    fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<crate::FileMetadata> {
        self.get_metadata_in_namespace(key.namespace, key.file_id)
    }

    fn has_namespace(&self, namespace: &str) -> bool {
        HbaReader::has_namespace(self, namespace)
    }
}

pub struct HbaWriter {
    entries: HashMap<(ResourceNamespace, u32), (u32, Vec<u8>, bool)>,
    compress: bool,
}

pub struct HbaStreamWriter {
    file: File,
    seen_keys: HashSet<(ResourceNamespace, u32)>,
    entries: Vec<HbaEntry>,
    compress: bool,
}

impl HbaWriter {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            compress: true,
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

    pub fn add(
        &mut self,
        namespace: &str,
        file_id: u32,
        type_id: u32,
        data: Vec<u8>,
    ) -> Result<()> {
        self.insert(namespace, file_id, type_id, data, false)
    }

    pub fn add_pruned(
        &mut self,
        namespace: &str,
        file_id: u32,
        type_id: u32,
        data: Vec<u8>,
    ) -> Result<()> {
        self.insert(namespace, file_id, type_id, data, true)
    }

    pub fn write<P: AsRef<Path>>(self, path: P) -> Result<()> {
        let mut writer = HbaStreamWriter::create(path)?;
        writer.set_compression(self.compress);

        let mut entries: Vec<_> = self.entries.into_iter().collect();
        entries.sort_by(|left, right| {
            left.0
                .0
                .cmp(&right.0.0)
                .then_with(|| left.0.1.cmp(&right.0.1))
        });

        for ((namespace, file_id), (type_id, data, is_pruned)) in entries {
            if is_pruned {
                writer.add_pruned(namespace.as_str(), file_id, type_id, data)?;
            } else {
                writer.add(namespace.as_str(), file_id, type_id, data)?;
            }
        }

        writer.finish()
    }

    fn insert(
        &mut self,
        namespace: &str,
        file_id: u32,
        type_id: u32,
        data: Vec<u8>,
        is_pruned: bool,
    ) -> Result<()> {
        let namespace_id = ResourceNamespace::new(namespace)?;
        if self.entries.contains_key(&(namespace_id, file_id)) {
            return Err(DatError::DuplicateNamespacedId {
                namespace: namespace.to_string(),
                file_id,
            });
        }

        self.entries
            .insert((namespace_id, file_id), (type_id, data, is_pruned));
        Ok(())
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
        };
        dummy_header.write(&mut file)?;

        Ok(Self {
            file,
            seen_keys: HashSet::new(),
            entries: Vec::new(),
            compress: true,
        })
    }

    pub fn set_compression(&mut self, compress: bool) {
        self.compress = compress;
    }

    pub fn add(
        &mut self,
        namespace: &str,
        file_id: u32,
        type_id: u32,
        data: Vec<u8>,
    ) -> Result<()> {
        self.write_entry(namespace, file_id, type_id, data, false)
    }

    pub fn add_pruned(
        &mut self,
        namespace: &str,
        file_id: u32,
        type_id: u32,
        data: Vec<u8>,
    ) -> Result<()> {
        self.write_entry(namespace, file_id, type_id, data, true)
    }

    pub fn finish(mut self) -> Result<()> {
        self.entries.sort_by(|left, right| {
            left.namespace
                .cmp(&right.namespace)
                .then_with(|| left.file_id.cmp(&right.file_id))
        });

        let metadata = build_namespace_index(&self.entries);
        let metadata_offset = self.file.stream_position()?;
        {
            let mut buffer_writer = std::io::BufWriter::new(&mut self.file);
            (metadata.len() as u32).write_le(&mut buffer_writer)?;
            for metadata_entry in &metadata {
                metadata_entry.write(&mut buffer_writer)?;
            }
            buffer_writer.flush()?;
        }

        let index_offset = self.file.stream_position()?;
        {
            let mut buffer_writer = std::io::BufWriter::new(&mut self.file);
            for entry in &self.entries {
                entry.write(&mut buffer_writer)?;
            }
            buffer_writer.flush()?;
        }

        self.file.seek(SeekFrom::Start(0))?;
        let final_header = HbaHeader {
            magic: HBA_MAGIC,
            version: HBA_VERSION,
            entry_count: self.entries.len() as u32,
            index_offset,
            metadata_size: (index_offset - metadata_offset) as u32,
        };
        final_header.write(&mut self.file)?;

        Ok(())
    }

    fn write_entry(
        &mut self,
        namespace: &str,
        file_id: u32,
        type_id: u32,
        data: Vec<u8>,
        is_pruned: bool,
    ) -> Result<()> {
        let namespace_id = ResourceNamespace::new(namespace)?;
        if !self.seen_keys.insert((namespace_id, file_id)) {
            return Err(DatError::DuplicateNamespacedId {
                namespace: namespace.to_string(),
                file_id,
            });
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
                Err(error) => {
                    log::warn!(
                        "Compression failed for {}:0x{:08X}: {}",
                        namespace,
                        file_id,
                        error
                    );
                }
            }
        }

        let offset = self.file.stream_position()?;
        self.file.write_all(&final_data)?;

        self.entries.push(HbaEntry {
            namespace: *namespace_id.as_bytes(),
            file_id,
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

fn build_namespace_index(entries: &[HbaEntry]) -> Vec<HbaNamespaceIndexEntry> {
    if entries.is_empty() {
        return Vec::new();
    }

    let mut metadata = Vec::new();
    let mut current_namespace = entries[0].namespace;
    let mut start_index = 0u32;
    let mut count = 0u32;

    for (index, entry) in entries.iter().enumerate() {
        if entry.namespace != current_namespace {
            metadata.push(HbaNamespaceIndexEntry {
                namespace: current_namespace,
                start_index,
                entry_count: count,
            });
            current_namespace = entry.namespace;
            start_index = index as u32;
            count = 0;
        }
        count += 1;
    }

    metadata.push(HbaNamespaceIndexEntry {
        namespace: current_namespace,
        start_index,
        entry_count: count,
    });

    metadata
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE};
    use tempfile::tempdir;

    #[test]
    fn test_hba_roundtrip_across_namespaces() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("test.hba");

        let mut writer = HbaWriter::new();
        writer.add(EOR_PORTAL_NAMESPACE, 0x1111, 0x01, vec![1, 2, 3])?;
        writer.add(EOR_CELL_NAMESPACE, 0x1111, 0x02, vec![4, 5, 6])?;
        writer.write(&path)?;

        let reader = HbaReader::open(&path)?;
        assert_eq!(reader.header.entry_count, 2);
        assert_eq!(reader.namespaces().count(), 2);
        assert_eq!(
            reader.get_file_in_namespace(EOR_PORTAL_NAMESPACE, 0x1111)?,
            vec![1, 2, 3]
        );
        assert_eq!(
            reader.get_file_in_namespace(EOR_CELL_NAMESPACE, 0x1111)?,
            vec![4, 5, 6]
        );
        assert_eq!(
            reader
                .find_entry_in_namespace(EOR_PORTAL_NAMESPACE, 0x1111)?
                .type_id,
            0x01
        );
        assert_eq!(
            reader
                .find_entry_in_namespace(EOR_CELL_NAMESPACE, 0x1111)?
                .type_id,
            0x02
        );

        Ok(())
    }

    #[test]
    fn test_hba_compression() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("compress.hba");

        let mut writer = HbaWriter::new();
        let data = vec![0xCC; 1000];
        writer.add(EOR_PORTAL_NAMESPACE, 0x9999, 0x00, data.clone())?;
        writer.write(&path)?;

        let reader = HbaReader::open(&path)?;
        let entry = reader.find_entry_in_namespace(EOR_PORTAL_NAMESPACE, 0x9999)?;
        assert!(entry.is_compressed());
        assert!(entry.comp_size < entry.size);
        assert_eq!(
            reader.get_file_in_namespace(EOR_PORTAL_NAMESPACE, 0x9999)?,
            data
        );

        Ok(())
    }

    #[test]
    fn test_stream_writer_roundtrip_out_of_order_adds() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("stream.hba");

        let mut writer = HbaStreamWriter::create(&path)?;
        writer.set_compression(false);
        writer.add(EOR_CELL_NAMESPACE, 0x2222, 0x02, vec![4, 5, 6])?;
        writer.add_pruned(EOR_PORTAL_NAMESPACE, 0x1111, 0x01, vec![1, 2, 3])?;
        writer.finish()?;

        let reader = HbaReader::open(&path)?;
        let entries: Vec<_> = reader.entries().collect::<Result<Vec<_>>>()?;

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].file_id, 0x2222);
        assert_eq!(entries[0].namespace_id()?.as_str(), EOR_CELL_NAMESPACE);
        assert_eq!(entries[1].file_id, 0x1111);
        assert!(entries[1].is_pruned());
        assert_eq!(entries[1].namespace_id()?.as_str(), EOR_PORTAL_NAMESPACE);
        assert_eq!(
            reader.get_file_in_namespace(EOR_PORTAL_NAMESPACE, 0x1111)?,
            vec![1, 2, 3]
        );
        assert_eq!(
            reader.get_file_in_namespace(EOR_CELL_NAMESPACE, 0x2222)?,
            vec![4, 5, 6]
        );

        Ok(())
    }

    #[test]
    fn test_hba_invalid_magic() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("bad.hba");
        let mut bad_header = [0u8; HBA_HEADER_SIZE as usize];
        bad_header[0..4].copy_from_slice(b"BAD!");
        std::fs::write(&path, bad_header)?;

        let result = HbaReader::open(&path);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Invalid magic"));

        Ok(())
    }

    #[test]
    fn test_hba_rejects_invalid_namespace_metadata() -> Result<()> {
        let dir = tempdir()?;
        let path = dir.path().join("bad-namespace.hba");
        let metadata_size = 4 + HbaNamespaceIndexEntry::SIZE;

        let mut file = File::create(&path)?;
        HbaHeader {
            magic: HBA_MAGIC,
            version: HBA_VERSION,
            entry_count: 0,
            index_offset: HBA_HEADER_SIZE + metadata_size as u64,
            metadata_size,
        }
        .write(&mut file)?;
        1u32.write_le(&mut file)?;
        HbaNamespaceIndexEntry {
            namespace: {
                let mut bytes = [0u8; RESOURCE_NAMESPACE_LEN];
                bytes[0] = b'e';
                bytes[1] = 0;
                bytes[2] = b'x';
                bytes
            },
            start_index: 0,
            entry_count: 0,
        }
        .write(&mut file)?;
        file.flush()?;

        let error = HbaReader::open(&path).expect_err("invalid namespace metadata should fail");
        assert!(error.to_string().contains("Invalid namespace"));

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
        assert_eq!(reader.namespaces().count(), 0);

        Ok(())
    }

    #[test]
    fn test_hba_robustness_random() -> Result<()> {
        use rand::RngExt;

        let mut rng = rand::rng();
        let dir = tempdir()?;
        let path = dir.path().join("robust.hba");

        let mut expected: HashMap<(String, u32), Vec<u8>> = HashMap::new();
        let mut writer = HbaWriter::new();

        for index in 0..50 {
            let namespace = if index % 2 == 0 {
                EOR_PORTAL_NAMESPACE
            } else {
                EOR_CELL_NAMESPACE
            };
            let file_id = rng.random::<u32>();
            let type_id = rng.random::<u32>();
            let size = rng.random_range(0..5000);
            let data: Vec<u8> = (0..size).map(|_| rng.random::<u8>()).collect();

            writer.add(namespace, file_id, type_id, data.clone())?;
            expected.insert((namespace.to_string(), file_id), data);
        }

        writer.write(&path)?;

        let reader = HbaReader::open(&path)?;
        for ((namespace, file_id), data) in expected {
            assert_eq!(reader.get_file_in_namespace(&namespace, file_id)?, data);
        }

        Ok(())
    }
}
