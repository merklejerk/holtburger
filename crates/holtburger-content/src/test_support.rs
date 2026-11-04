use std::collections::HashMap;
use std::sync::Mutex;

use holtburger_dat::{DatError, FileMetadata, ResourceKey, ResourceSource};

/// In-memory DAT source that records reads for cache and fanout assertions.
#[derive(Debug)]
pub(crate) struct CountingSource {
    files: HashMap<(String, u32), Vec<u8>>,
    reads: Mutex<HashMap<(String, u32), usize>>,
}

impl CountingSource {
    pub(crate) fn new(files: HashMap<(String, u32), Vec<u8>>) -> Self {
        Self {
            files,
            reads: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn read_count(&self, namespace: &str, file_id: u32) -> usize {
        self.reads
            .lock()
            .expect("counting source reads should not be poisoned")
            .get(&(namespace.to_string(), file_id))
            .copied()
            .unwrap_or_default()
    }
}

impl ResourceSource for CountingSource {
    fn get_file_by_key(&self, key: ResourceKey<'_>) -> holtburger_dat::Result<Vec<u8>> {
        let lookup_key = (key.namespace.to_string(), key.file_id);
        *self
            .reads
            .lock()
            .expect("counting source reads should not be poisoned")
            .entry(lookup_key.clone())
            .or_default() += 1;
        self.files
            .get(&lookup_key)
            .cloned()
            .ok_or(DatError::NotFound(key.file_id))
    }

    fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<FileMetadata> {
        self.files
            .get(&(key.namespace.to_string(), key.file_id))
            .map(|bytes| FileMetadata {
                id: key.file_id,
                size: bytes.len() as u32,
                is_pruned: false,
            })
    }

    fn has_namespace(&self, namespace: &str) -> bool {
        self.files
            .keys()
            .any(|(source_namespace, _)| source_namespace == namespace)
    }
}
