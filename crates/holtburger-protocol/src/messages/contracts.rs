//! Contract tracking wire layouts from ACE ContractTracker.cs and retail acclient.c:431336.

use crate::messages::utils::{read_hashtable_header, write_hashtable_header};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use std::collections::BTreeMap;

/// A progress count whose stage encoding (`count + 4`) fits in a wire u32.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ContractProgressCount(u32);

impl ContractProgressCount {
    /// Reject counts that cannot be represented by the protocol stage field.
    pub fn new(count: u32) -> Option<Self> {
        (count <= u32::MAX - 4).then_some(Self(count))
    }

    /// Completed units, independent of any authored target.
    pub fn get(self) -> u32 {
        self.0
    }
}

/// Wire stage with its embedded progress count decoded exactly once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContractStage {
    /// Contract can be started.
    Available,
    /// Contract has started without a counter.
    InProgress,
    /// Completion or repeat gating; static content and durations determine meaning.
    DoneOrPendingRepeat,
    /// Wire stage 4 plus the completed-unit counter.
    Progress {
        /// Validated completed-unit counter.
        count: ContractProgressCount,
    },
}

impl ProtocolUnpack for ContractStage {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        match u32::unpack(data, offset)? {
            0 => None,
            1 => Some(Self::Available),
            2 => Some(Self::InProgress),
            3 => Some(Self::DoneOrPendingRepeat),
            stage => Some(Self::Progress {
                count: ContractProgressCount(stage - 4),
            }),
        }
    }
}

impl ProtocolPack for ContractStage {
    fn pack(&self, buf: &mut Vec<u8>) {
        match *self {
            Self::Available => 1,
            Self::InProgress => 2,
            Self::DoneOrPendingRepeat => 3,
            Self::Progress { count } => count.get() + 4,
        }
        .pack(buf);
    }
}

/// Complete 28-byte server tracker. Timer names on the wire disguise remaining durations.
#[derive(Debug, Clone, PartialEq)]
pub struct ContractTracker {
    /// Definition version supplied by the server.
    pub version: u32,
    /// Stable contract identity.
    pub id: u32,
    /// Server-computed stage and optional counter.
    pub stage: ContractStage,
    /// Seconds remaining on the quest deadline; finite negatives indicate expiry.
    pub deadline_seconds: f64,
    /// Seconds remaining before repeat; finite negatives indicate availability.
    pub repeat_seconds: f64,
}

impl ProtocolUnpack for ContractTracker {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let tracker = Self {
            version: u32::unpack(data, offset)?,
            id: u32::unpack(data, offset)?,
            stage: ContractStage::unpack(data, offset)?,
            deadline_seconds: f64::unpack(data, offset)?,
            repeat_seconds: f64::unpack(data, offset)?,
        };
        (tracker.deadline_seconds.is_finite() && tracker.repeat_seconds.is_finite())
            .then_some(tracker)
    }
}

impl ProtocolPack for ContractTracker {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.version.pack(buf);
        self.id.pack(buf);
        self.stage.pack(buf);
        self.deadline_seconds.pack(buf);
        self.repeat_seconds.pack(buf);
    }
}

/// Complete keyed replacement of the character registry.
#[derive(Debug, Clone, PartialEq)]
pub struct ContractTrackerTable {
    /// Original hash-table bucket count, preserved for deterministic round trips.
    pub buckets: u16,
    /// Trackers keyed by contract identity.
    pub trackers: BTreeMap<u32, ContractTracker>,
}

impl ProtocolUnpack for ContractTrackerTable {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let (count, buckets) = read_hashtable_header(data, offset)?;
        if count > data.len().checked_sub(*offset)? / 32 {
            return None;
        }
        let mut trackers = BTreeMap::new();
        for _ in 0..count {
            let id = u32::unpack(data, offset)?;
            let tracker = ContractTracker::unpack(data, offset)?;
            if id != tracker.id || trackers.insert(id, tracker).is_some() {
                return None;
            }
        }
        Some(Self {
            buckets: buckets as u16,
            trackers,
        })
    }
}

impl ProtocolPack for ContractTrackerTable {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_hashtable_header(buf, self.trackers.len(), self.buckets as usize);
        for (id, tracker) in &self.trackers {
            id.pack(buf);
            tracker.pack(buf);
        }
    }
}

/// Incremental update with deletion and legacy display-selection flags.
#[derive(Debug, Clone, PartialEq)]
pub struct ContractTrackerUpdate {
    /// Complete replacement tracker for this identity.
    pub tracker: ContractTracker,
    /// Remove the registry entry instead of upserting it.
    pub delete: bool,
    /// Legacy server display request, preserved without introducing pinning UX.
    pub set_as_display: bool,
}

impl ProtocolUnpack for ContractTrackerUpdate {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            tracker: ContractTracker::unpack(data, offset)?,
            delete: u32::unpack(data, offset)? != 0,
            set_as_display: u32::unpack(data, offset)? != 0,
        })
    }
}

impl ProtocolPack for ContractTrackerUpdate {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.tracker.pack(buf);
        u32::from(self.delete).pack(buf);
        u32::from(self.set_as_display).pack(buf);
    }
}

/// Server action that removes tracking while retaining quest flags/progress.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AbandonContractActionData {
    /// Contract registry identity to remove.
    pub id: u32,
}

impl ProtocolUnpack for AbandonContractActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            id: u32::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for AbandonContractActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.id.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{GameAction, GameActionMessage, GameEvent, GameEventMessage};
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::Guid;

    fn tracker() -> ContractTracker {
        ContractTracker {
            version: 7,
            id: 42,
            stage: ContractStage::Progress {
                count: ContractProgressCount::new(9).unwrap(),
            },
            deadline_seconds: -12.0,
            repeat_seconds: 3600.0,
        }
    }

    #[test]
    fn counter_bounds_enforce_representable_stages() {
        for count in [0, u32::MAX - 4] {
            let stage = ContractStage::Progress {
                count: ContractProgressCount::new(count).unwrap(),
            };
            assert_pack_unpack_parity(&(count + 4).to_le_bytes(), &stage);
        }
        for count in [u32::MAX - 3, u32::MAX] {
            assert!(ContractProgressCount::new(count).is_none());
        }
    }

    #[test]
    fn ace_layout_and_envelopes_round_trip() {
        let mut bytes = Vec::new();
        for value in [7u32, 42, 13] {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes.extend_from_slice(&(-12.0f64).to_le_bytes());
        bytes.extend_from_slice(&3600.0f64.to_le_bytes());
        assert_pack_unpack_parity(&bytes, &tracker());
        let events = [
            GameEvent::SendClientContractTrackerTable(Box::new(ContractTrackerTable {
                buckets: 32,
                trackers: [(42, tracker())].into(),
            })),
            GameEvent::SendClientContractTracker(Box::new(ContractTrackerUpdate {
                tracker: tracker(),
                delete: true,
                set_as_display: true,
            })),
        ];
        for event in events {
            let event = GameEventMessage {
                target: Guid(1),
                sequence: 2,
                event,
            };
            let mut bytes = Vec::new();
            event.pack(&mut bytes);
            assert_pack_unpack_parity(&bytes, &event);
            for end in 0..bytes.len() {
                assert!(GameEventMessage::unpack(&bytes[..end], &mut 0).is_none());
            }
        }
        assert_pack_unpack_parity(
            &hex::decode("01000000160300002a000000").unwrap(),
            &GameActionMessage {
                sequence: 1,
                action: GameAction::AbandonContract(Box::new(AbandonContractActionData { id: 42 })),
            },
        );
    }

    #[test]
    fn rejects_invalid_stage_nonfinite_timer_and_table_identity() {
        let mut bytes = Vec::new();
        tracker().pack(&mut bytes);
        bytes[8..12].copy_from_slice(&0u32.to_le_bytes());
        assert!(ContractTracker::unpack(&bytes, &mut 0).is_none());
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            for at in [12, 20] {
                let mut bytes = Vec::new();
                tracker().pack(&mut bytes);
                bytes[at..at + 8].copy_from_slice(&value.to_le_bytes());
                assert!(ContractTracker::unpack(&bytes, &mut 0).is_none());
            }
        }
        let empty = ContractTrackerTable {
            buckets: 32,
            trackers: BTreeMap::new(),
        };
        assert_pack_unpack_parity(&hex::decode("00002000").unwrap(), &empty);
        let table = ContractTrackerTable {
            buckets: 32,
            trackers: [(42, tracker())].into(),
        };
        let mut bytes = Vec::new();
        table.pack(&mut bytes);
        bytes[4..8].copy_from_slice(&41u32.to_le_bytes());
        assert!(ContractTrackerTable::unpack(&bytes, &mut 0).is_none());
        bytes[0..2].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(ContractTrackerTable::unpack(&bytes, &mut 0).is_none());
    }
}
