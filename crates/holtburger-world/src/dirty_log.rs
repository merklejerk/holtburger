use holtburger_common::Guid;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};

/// Maximum per-mutation entries retained in a [`DirtyGuidLog`] before slow
/// readers fall back to a full resync.
pub const MAX_DIRTY_LOG_ENTRIES: usize = 512;

static NEXT_DIRTY_LOG_STORE_ID: AtomicU64 = AtomicU64::new(1);

fn next_store_id() -> u64 {
    let id = NEXT_DIRTY_LOG_STORE_ID.fetch_add(1, Ordering::Relaxed);
    assert_ne!(id, u64::MAX, "dirty log store lineage exhausted");
    id
}

/// Opaque reader cursor pairing one [`DirtyGuidLog`] instance lineage with a monotonic revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirtyGuidCursor {
    store_id: u64,
    revision: u64,
}

/// One dirty entity entry recorded in a bounded revision journal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirtyGuidEntry {
    /// Entity GUID whose observed state may have changed.
    pub guid: Guid,
    /// Whether the recorded change may have modified the entity's placement.
    pub pose_may_have_changed: bool,
}

/// Incremental change set returned by [`DirtyGuidLog::changes_since`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GuidChanges {
    /// No relevant mutations occurred since the reader's cursor.
    UpToDate,
    /// Bounded deduplicated set of entity GUIDs changed since the cursor.
    Delta(Vec<DirtyGuidEntry>),
    /// Reader cursor predates retained history, belongs to another store, or hit full invalidation.
    FullResync,
}

/// Bounded multi-reader revision journal tracking dirty [`Guid`] values.
///
/// Each mutation increments a monotonic revision without clearing state when an
/// individual reader reads its delta, so independent consumers (such as the
/// world tick, collision coordinator, and dynamic-entity view bridge) can track
/// their own cursors concurrently. Each journal instance carries a unique lineage
/// identifier so store replacement (such as character retirement) never aliases an
/// earlier cursor at the same numerical revision.
#[derive(Debug, Clone)]
pub struct DirtyGuidLog {
    store_id: u64,
    revision: u64,
    min_delta_cursor: u64,
    entries: VecDeque<(u64, DirtyGuidEntry)>,
}

impl Default for DirtyGuidLog {
    fn default() -> Self {
        Self::new()
    }
}

impl DirtyGuidLog {
    /// Creates an empty dirty log with a fresh store lineage at revision `0`.
    pub fn new() -> Self {
        Self {
            store_id: next_store_id(),
            revision: 0,
            min_delta_cursor: 0,
            entries: VecDeque::new(),
        }
    }

    /// Captures an opaque cursor at the current store lineage and monotonic revision.
    pub fn cursor(&self) -> DirtyGuidCursor {
        DirtyGuidCursor {
            store_id: self.store_id,
            revision: self.revision,
        }
    }

    /// Records a mutation affecting `guid`.
    pub fn record(&mut self, guid: Guid, pose_may_have_changed: bool) {
        self.revision += 1;
        self.entries.push_back((
            self.revision,
            DirtyGuidEntry {
                guid,
                pose_may_have_changed,
            },
        ));
        while self.entries.len() > MAX_DIRTY_LOG_ENTRIES {
            if let Some((evicted_rev, _)) = self.entries.pop_front() {
                self.min_delta_cursor = self.min_delta_cursor.max(evicted_rev);
            }
        }
    }

    /// Forces all readers with prior cursors onto [`GuidChanges::FullResync`].
    pub fn record_all(&mut self) {
        self.revision += 1;
        self.entries.clear();
        self.min_delta_cursor = self.revision;
    }

    /// Returns the incremental changes strictly after `cursor`.
    pub fn changes_since(&self, cursor: DirtyGuidCursor) -> GuidChanges {
        if cursor.store_id != self.store_id {
            return GuidChanges::FullResync;
        }
        let cursor = cursor.revision;
        if cursor == self.revision {
            return GuidChanges::UpToDate;
        }
        if cursor > self.revision || cursor < self.min_delta_cursor {
            return GuidChanges::FullResync;
        }

        let start = self.entries.partition_point(|(rev, _)| *rev <= cursor);
        let count = self.entries.len() - start;
        if count == 0 {
            return GuidChanges::UpToDate;
        }
        if count == 1 {
            return GuidChanges::Delta(vec![self.entries[start].1]);
        }

        let mut deduped: Vec<DirtyGuidEntry> = Vec::with_capacity(count.min(32));
        if count <= 16 {
            for (_, entry) in self.entries.range(start..) {
                if let Some(existing) = deduped.iter_mut().find(|item| item.guid == entry.guid) {
                    existing.pose_may_have_changed |= entry.pose_may_have_changed;
                } else {
                    deduped.push(*entry);
                }
            }
        } else {
            let mut index_by_guid: HashMap<Guid, usize> = HashMap::with_capacity(count.min(64));
            for (_, entry) in self.entries.range(start..) {
                if let Some(&idx) = index_by_guid.get(&entry.guid) {
                    deduped[idx].pose_may_have_changed |= entry.pose_may_have_changed;
                } else {
                    let idx = deduped.len();
                    index_by_guid.insert(entry.guid, idx);
                    deduped.push(*entry);
                }
            }
        }
        GuidChanges::Delta(deduped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn guid(n: u32) -> Guid {
        Guid::from(n)
    }

    #[test]
    fn delta_deduplicates_without_leaking_pre_cursor_pose_flag() {
        let mut log = DirtyGuidLog::new();
        let initial = log.cursor();
        assert_eq!(log.changes_since(initial), GuidChanges::UpToDate);

        log.record(guid(1), true);
        let cursor_after_pose = log.cursor();
        log.record(guid(1), false);
        log.record(guid(2), false);

        assert_eq!(
            log.changes_since(initial),
            GuidChanges::Delta(vec![
                DirtyGuidEntry {
                    guid: guid(1),
                    pose_may_have_changed: true,
                },
                DirtyGuidEntry {
                    guid: guid(2),
                    pose_may_have_changed: false,
                },
            ])
        );
        assert_eq!(
            log.changes_since(cursor_after_pose),
            GuidChanges::Delta(vec![
                DirtyGuidEntry {
                    guid: guid(1),
                    pose_may_have_changed: false,
                },
                DirtyGuidEntry {
                    guid: guid(2),
                    pose_may_have_changed: false,
                },
            ])
        );
        assert_eq!(log.changes_since(log.cursor()), GuidChanges::UpToDate);
    }

    #[test]
    fn overflow_record_all_and_store_replacement_require_full_resync() {
        let mut log = DirtyGuidLog::new();
        let mut cursors = vec![log.cursor()];
        for i in 1..=(MAX_DIRTY_LOG_ENTRIES as u32 + 5) {
            log.record(guid(i), false);
            cursors.push(log.cursor());
        }
        assert_eq!(log.changes_since(cursors[0]), GuidChanges::FullResync);
        assert_eq!(log.changes_since(cursors[4]), GuidChanges::FullResync);
        assert!(
            matches!(log.changes_since(cursors[5]), GuidChanges::Delta(ref d) if d.len() == MAX_DIRTY_LOG_ENTRIES)
        );

        let cur = log.cursor();
        log.record_all();
        assert_eq!(log.changes_since(cur), GuidChanges::FullResync);
        let after = log.cursor();
        assert_eq!(log.changes_since(after), GuidChanges::UpToDate);
        log.record(guid(999), true);
        assert_eq!(
            log.changes_since(after),
            GuidChanges::Delta(vec![DirtyGuidEntry {
                guid: guid(999),
                pose_may_have_changed: true,
            }])
        );

        let first_empty = DirtyGuidLog::new();
        let second_empty = DirtyGuidLog::new();
        assert_eq!(
            second_empty.changes_since(first_empty.cursor()),
            GuidChanges::FullResync
        );
    }
}
