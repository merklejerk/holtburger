//! Bounded shared initialization for immutable records. Loaders run outside the LRU lock.

use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};

use anyhow::Result;
use lru::LruCache;
use once_cell::sync::OnceCell;

/// Retained same-key callers share initialization; independent keys never wait on a cache-wide load.
/// Eviction ends cache ownership but cannot invalidate Arc values or callers already using a cell.
#[derive(Debug)]
pub(crate) struct RecordCache<T> {
    /// Recency index; each retained key owns one independent initialization cell.
    entries: Mutex<LruCache<u32, Arc<OnceCell<Arc<T>>>>>,
}

impl<T> RecordCache<T> {
    pub(crate) fn new(capacity: usize) -> Self {
        Self {
            entries: Mutex::new(LruCache::new(
                NonZeroUsize::new(capacity).expect("record cache capacity must be positive"),
            )),
        }
    }

    pub(crate) fn load(&self, key: u32, load: impl FnOnce() -> Result<T>) -> Result<Arc<T>> {
        let cell = {
            let mut entries = self.entries.lock().expect("record cache lock poisoned");
            if let Some(cell) = entries.get(&key) {
                Arc::clone(cell)
            } else {
                let cell = Arc::new(OnceCell::new());
                entries.put(key, Arc::clone(&cell));
                cell
            }
        };
        // Errors leave the cell uninitialized, preserving typed failure and explicit retry.
        cell.get_or_try_init(|| load().map(Arc::new))
            .map(Arc::clone)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn concurrent_retained_key_loads_once_and_independent_keys_can_progress() {
        let cache = Arc::new(RecordCache::new(2));
        let loads = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            let (entered_tx, entered_rx) = std::sync::mpsc::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            let first_cache = Arc::clone(&cache);
            let load_count = &loads;
            let first = scope.spawn(move || {
                first_cache
                    .load(1, || {
                        load_count.fetch_add(1, Ordering::SeqCst);
                        entered_tx.send(()).unwrap();
                        release_rx.recv().unwrap();
                        Ok(10)
                    })
                    .unwrap()
            });
            entered_rx.recv().unwrap();
            let second = scope.spawn(|| {
                cache
                    .load(1, || {
                        loads.fetch_add(1, Ordering::SeqCst);
                        Ok(20)
                    })
                    .unwrap()
            });
            let (independent_tx, independent_rx) = std::sync::mpsc::channel();
            let independent_cache = Arc::clone(&cache);
            scope.spawn(move || {
                independent_tx
                    .send(independent_cache.load(2, || Ok(30)))
                    .unwrap();
            });
            let independent = independent_rx.recv_timeout(std::time::Duration::from_secs(5));
            release_tx.send(()).unwrap();
            assert_eq!(*independent.unwrap().unwrap(), 30);
            assert!(Arc::ptr_eq(&first.join().unwrap(), &second.join().unwrap()));
        });
        assert_eq!(loads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn failures_retry_and_eviction_preserves_outstanding_values() {
        let cache = RecordCache::new(1);
        assert!(cache.load(1, || anyhow::bail!("invalid source")).is_err());
        let first = cache.load(1, || Ok(10)).unwrap();
        cache.load(2, || Ok(20)).unwrap();
        let replacement = cache.load(1, || Ok(30)).unwrap();
        assert_eq!(*first, 10);
        assert_eq!(*replacement, 30);
        assert!(!Arc::ptr_eq(&first, &replacement));
    }
}
