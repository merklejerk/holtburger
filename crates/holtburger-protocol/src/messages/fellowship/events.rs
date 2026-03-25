use crate::messages::utils::{
    read_hashtable_header, read_string16, write_hashtable_header, write_string16,
};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use strum::FromRepr;

const FELLOW_BUCKETS: usize = 16;
const FELLOWSHIP_LOCK_BUCKETS: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr)]
#[repr(u32)]
pub enum FellowUpdateType {
    Undef = 0,
    Full = 1,
    Stats = 2,
    Vitals = 3,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FellowshipMemberData {
    pub guid: Guid,
    pub cached_cp: u32,
    pub cached_luminance: u32,
    pub level: u32,
    pub max_health: u32,
    pub max_stamina: u32,
    pub max_mana: u32,
    pub current_health: u32,
    pub current_stamina: u32,
    pub current_mana: u32,
    pub share_loot: u32,
    pub name: String,
}

impl FellowshipMemberData {
    pub fn share_loot_enabled(&self) -> bool {
        self.share_loot != 0
    }
}

impl ProtocolUnpack for FellowshipMemberData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 44 > data.len() {
            return None;
        }

        let guid = Guid(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        let cached_cp = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let cached_luminance = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let level = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let max_health = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]);
        let max_stamina = LittleEndian::read_u32(&data[*offset + 20..*offset + 24]);
        let max_mana = LittleEndian::read_u32(&data[*offset + 24..*offset + 28]);
        let current_health = LittleEndian::read_u32(&data[*offset + 28..*offset + 32]);
        let current_stamina = LittleEndian::read_u32(&data[*offset + 32..*offset + 36]);
        let current_mana = LittleEndian::read_u32(&data[*offset + 36..*offset + 40]);
        let share_loot = LittleEndian::read_u32(&data[*offset + 40..*offset + 44]);
        *offset += 44;

        let name = read_string16(data, offset)?;

        Some(Self {
            guid,
            cached_cp,
            cached_luminance,
            level,
            max_health,
            max_stamina,
            max_mana,
            current_health,
            current_stamina,
            current_mana,
            share_loot,
            name,
        })
    }
}

impl ProtocolPack for FellowshipMemberData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.guid.0).unwrap();
        buf.write_u32::<LittleEndian>(self.cached_cp).unwrap();
        buf.write_u32::<LittleEndian>(self.cached_luminance)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.level).unwrap();
        buf.write_u32::<LittleEndian>(self.max_health).unwrap();
        buf.write_u32::<LittleEndian>(self.max_stamina).unwrap();
        buf.write_u32::<LittleEndian>(self.max_mana).unwrap();
        buf.write_u32::<LittleEndian>(self.current_health).unwrap();
        buf.write_u32::<LittleEndian>(self.current_stamina).unwrap();
        buf.write_u32::<LittleEndian>(self.current_mana).unwrap();
        buf.write_u32::<LittleEndian>(self.share_loot).unwrap();
        write_string16(buf, &self.name);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FellowshipDepartedMemberData {
    pub guid: Guid,
    pub departed_timestamp: u32,
}

impl ProtocolUnpack for FellowshipDepartedMemberData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }

        let guid = Guid(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        let departed_timestamp = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;

        Some(Self {
            guid,
            departed_timestamp,
        })
    }
}

impl ProtocolPack for FellowshipDepartedMemberData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.guid.0).unwrap();
        buf.write_u32::<LittleEndian>(self.departed_timestamp)
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FellowshipLockData {
    pub unknown_1: u32,
    pub unknown_2: u32,
    pub unknown_3: u32,
    pub timestamp: u32,
    pub sequence: u32,
}

impl ProtocolUnpack for FellowshipLockData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 20 > data.len() {
            return None;
        }

        let unknown_1 = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let unknown_2 = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let unknown_3 = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let timestamp = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let sequence = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]);
        *offset += 20;

        Some(Self {
            unknown_1,
            unknown_2,
            unknown_3,
            timestamp,
            sequence,
        })
    }
}

impl ProtocolPack for FellowshipLockData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.unknown_1).unwrap();
        buf.write_u32::<LittleEndian>(self.unknown_2).unwrap();
        buf.write_u32::<LittleEndian>(self.unknown_3).unwrap();
        buf.write_u32::<LittleEndian>(self.timestamp).unwrap();
        buf.write_u32::<LittleEndian>(self.sequence).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FellowshipLockEntryData {
    pub name: String,
    pub lock: FellowshipLockData,
}

impl ProtocolUnpack for FellowshipLockEntryData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let name = read_string16(data, offset)?;
        let lock = FellowshipLockData::unpack(data, offset)?;
        Some(Self { name, lock })
    }
}

impl ProtocolPack for FellowshipLockEntryData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.name);
        self.lock.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FellowshipFullUpdateEventData {
    pub fellows: Vec<FellowshipMemberData>,
    pub fellowship_name: String,
    pub leader_guid: Guid,
    pub share_xp: bool,
    pub even_share: bool,
    pub open: bool,
    pub is_locked: bool,
    pub departed_members: Vec<FellowshipDepartedMemberData>,
    pub fellowship_locks: Vec<FellowshipLockEntryData>,
}

impl ProtocolUnpack for FellowshipFullUpdateEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let (fellow_count, _) = read_hashtable_header(data, offset)?;
        let mut fellows = Vec::with_capacity(fellow_count);
        for _ in 0..fellow_count {
            fellows.push(FellowshipMemberData::unpack(data, offset)?);
        }

        let fellowship_name = read_string16(data, offset)?;

        if *offset + 20 > data.len() {
            return None;
        }

        let leader_guid = Guid(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        let share_xp = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) != 0;
        let even_share = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]) != 0;
        let open = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]) != 0;
        let is_locked = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]) != 0;
        *offset += 20;

        let (departed_count, _) = read_hashtable_header(data, offset)?;
        let mut departed_members = Vec::with_capacity(departed_count);
        for _ in 0..departed_count {
            departed_members.push(FellowshipDepartedMemberData::unpack(data, offset)?);
        }

        let (lock_count, _) = read_hashtable_header(data, offset)?;
        let mut fellowship_locks = Vec::with_capacity(lock_count);
        for _ in 0..lock_count {
            fellowship_locks.push(FellowshipLockEntryData::unpack(data, offset)?);
        }

        Some(Self {
            fellows,
            fellowship_name,
            leader_guid,
            share_xp,
            even_share,
            open,
            is_locked,
            departed_members,
            fellowship_locks,
        })
    }
}

impl ProtocolPack for FellowshipFullUpdateEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_hashtable_header(buf, self.fellows.len(), FELLOW_BUCKETS);
        let mut fellows = self.fellows.clone();
        fellows.sort_by(|left, right| compare_guid_hash(left.guid, right.guid, FELLOW_BUCKETS));
        for fellow in fellows {
            fellow.pack(buf);
        }

        write_string16(buf, &self.fellowship_name);
        buf.write_u32::<LittleEndian>(self.leader_guid.0).unwrap();
        buf.write_u32::<LittleEndian>(u32::from(self.share_xp))
            .unwrap();
        buf.write_u32::<LittleEndian>(u32::from(self.even_share))
            .unwrap();
        buf.write_u32::<LittleEndian>(u32::from(self.open)).unwrap();
        buf.write_u32::<LittleEndian>(u32::from(self.is_locked))
            .unwrap();

        write_hashtable_header(buf, self.departed_members.len(), FELLOWSHIP_LOCK_BUCKETS);
        let mut departed = self.departed_members.clone();
        departed.sort_by(|left, right| {
            compare_guid_hash(left.guid, right.guid, FELLOWSHIP_LOCK_BUCKETS)
        });
        for member in departed {
            member.pack(buf);
        }

        write_hashtable_header(buf, self.fellowship_locks.len(), FELLOWSHIP_LOCK_BUCKETS);
        for lock in &self.fellowship_locks {
            lock.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FellowshipUpdateFellowEventData {
    pub fellow: FellowshipMemberData,
    pub update_type: FellowUpdateType,
}

impl ProtocolUnpack for FellowshipUpdateFellowEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let fellow = FellowshipMemberData::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }

        let update_type_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        Some(Self {
            fellow,
            update_type: FellowUpdateType::from_repr(update_type_raw)?,
        })
    }
}

impl ProtocolPack for FellowshipUpdateFellowEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.fellow.pack(buf);
        buf.write_u32::<LittleEndian>(self.update_type as u32)
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FellowshipQuitEventData {
    pub player_guid: Guid,
}

impl ProtocolUnpack for FellowshipQuitEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }

        let player_guid = Guid(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;
        Some(Self { player_guid })
    }
}

impl ProtocolPack for FellowshipQuitEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.player_guid.0).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FellowshipDismissEventData {
    pub player_guid: Guid,
}

impl ProtocolUnpack for FellowshipDismissEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }

        let player_guid = Guid(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;
        Some(Self { player_guid })
    }
}

impl ProtocolPack for FellowshipDismissEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.player_guid.0).unwrap();
    }
}

fn compare_guid_hash(left: Guid, right: Guid, buckets: usize) -> std::cmp::Ordering {
    let left_bucket = (left.0 as usize) % buckets;
    let right_bucket = (right.0 as usize) % buckets;
    left_bucket
        .cmp(&right_bucket)
        .then_with(|| left.0.cmp(&right.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{GameEvent, GameEventMessage};
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_fellowship_full_update_fixture() {
        let expected = GameEventMessage {
            target: Guid(0x5000_0001),
            sequence: 0x31,
            event: GameEvent::FellowshipFullUpdate(Box::new(FellowshipFullUpdateEventData {
                fellows: vec![
                    FellowshipMemberData {
                        guid: Guid(0x5000_0021),
                        cached_cp: 0,
                        cached_luminance: 0,
                        level: 12,
                        max_health: 180,
                        max_stamina: 150,
                        max_mana: 120,
                        current_health: 170,
                        current_stamina: 140,
                        current_mana: 118,
                        share_loot: 0x10,
                        name: "Alpha".to_string(),
                    },
                    FellowshipMemberData {
                        guid: Guid(0x5000_0032),
                        cached_cp: 0,
                        cached_luminance: 0,
                        level: 18,
                        max_health: 220,
                        max_stamina: 160,
                        max_mana: 140,
                        current_health: 215,
                        current_stamina: 150,
                        current_mana: 130,
                        share_loot: 0x10,
                        name: "Bravo".to_string(),
                    },
                ],
                fellowship_name: "Raid Bus".to_string(),
                leader_guid: Guid(0x5000_0021),
                share_xp: true,
                even_share: false,
                open: true,
                is_locked: true,
                departed_members: vec![FellowshipDepartedMemberData {
                    guid: Guid(0x5000_0044),
                    departed_timestamp: 1_712_345_678,
                }],
                fellowship_locks: vec![FellowshipLockEntryData {
                    name: "Leader Lock".to_string(),
                    lock: FellowshipLockData {
                        unknown_1: 0,
                        unknown_2: 0,
                        unknown_3: 0,
                        timestamp: 1_712_345_688,
                        sequence: 3,
                    },
                }],
            })),
        };

        assert_pack_unpack_parity(test_fixtures::FELLOWSHIP_FULL_UPDATE, &expected);
    }

    #[test]
    fn test_fellowship_update_fellow_full_fixture() {
        let expected = GameEventMessage {
            target: Guid(0x5000_0001),
            sequence: 0x32,
            event: GameEvent::FellowshipUpdateFellow(Box::new(FellowshipUpdateFellowEventData {
                fellow: FellowshipMemberData {
                    guid: Guid(0x5000_0055),
                    cached_cp: 0,
                    cached_luminance: 0,
                    level: 27,
                    max_health: 260,
                    max_stamina: 190,
                    max_mana: 175,
                    current_health: 244,
                    current_stamina: 181,
                    current_mana: 160,
                    share_loot: 2,
                    name: "Charlie".to_string(),
                },
                update_type: FellowUpdateType::Full,
            })),
        };

        assert_pack_unpack_parity(test_fixtures::FELLOWSHIP_UPDATE_FELLOW_FULL, &expected);
    }

    #[test]
    fn test_fellowship_update_fellow_vitals_fixture() {
        let expected = GameEventMessage {
            target: Guid(0x5000_0001),
            sequence: 0x33,
            event: GameEvent::FellowshipUpdateFellow(Box::new(FellowshipUpdateFellowEventData {
                fellow: FellowshipMemberData {
                    guid: Guid(0x5000_0055),
                    cached_cp: 0,
                    cached_luminance: 0,
                    level: 27,
                    max_health: 260,
                    max_stamina: 190,
                    max_mana: 175,
                    current_health: 199,
                    current_stamina: 140,
                    current_mana: 122,
                    share_loot: 0,
                    name: "Charlie".to_string(),
                },
                update_type: FellowUpdateType::Vitals,
            })),
        };

        assert_pack_unpack_parity(test_fixtures::FELLOWSHIP_UPDATE_FELLOW_VITALS, &expected);
    }

    #[test]
    fn test_fellowship_disband_fixture() {
        let expected = GameEventMessage {
            target: Guid(0x5000_0001),
            sequence: 0x34,
            event: GameEvent::FellowshipDisband,
        };

        assert_pack_unpack_parity(test_fixtures::FELLOWSHIP_DISBAND, &expected);
    }

    #[test]
    fn test_fellowship_quit_event_fixture() {
        let expected = GameEventMessage {
            target: Guid(0x5000_0001),
            sequence: 0x35,
            event: GameEvent::FellowshipQuit(Box::new(FellowshipQuitEventData {
                player_guid: Guid(0x5000_0055),
            })),
        };

        assert_pack_unpack_parity(test_fixtures::FELLOWSHIP_QUIT_EVENT, &expected);
    }

    #[test]
    fn test_fellowship_dismiss_event_fixture() {
        let expected = GameEventMessage {
            target: Guid(0x5000_0001),
            sequence: 0x36,
            event: GameEvent::FellowshipDismiss(Box::new(FellowshipDismissEventData {
                player_guid: Guid(0x5000_0066),
            })),
        };

        assert_pack_unpack_parity(test_fixtures::FELLOWSHIP_DISMISS_EVENT, &expected);
    }

    #[test]
    fn test_fellowship_fellow_update_done_fixture() {
        let expected = GameEventMessage {
            target: Guid(0x5000_0001),
            sequence: 0x37,
            event: GameEvent::FellowshipFellowUpdateDone,
        };

        assert_pack_unpack_parity(test_fixtures::FELLOWSHIP_FELLOW_UPDATE_DONE, &expected);
    }

    #[test]
    fn test_fellowship_fellow_stats_done_fixture() {
        let expected = GameEventMessage {
            target: Guid(0x5000_0001),
            sequence: 0x38,
            event: GameEvent::FellowshipFellowStatsDone,
        };

        assert_pack_unpack_parity(test_fixtures::FELLOWSHIP_FELLOW_STATS_DONE, &expected);
    }
}
