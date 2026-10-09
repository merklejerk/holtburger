//! Allegiance wire records. Ground truth: ACE AllegianceData writer and retail
//! `acclient.c:459156` (including the legacy floating-point online-time branch).

use crate::messages::utils::{
    read_hashtable_header, read_string16, write_hashtable_header, write_string16,
};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::{Guid, position::WorldPosition};

/// ACE's current hierarchy version, also retail's newest supported version.
pub const ALLEGIANCE_HIERARCHY_VERSION: u16 = 11;

/// Request a profile. ACE reads this visibility flag but always responds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllegianceUpdateRequestActionData {
    /// Retail panel visibility; a refresh uses true.
    pub panel_open: bool,
}
impl ProtocolUnpack for AllegianceUpdateRequestActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            panel_open: u32::unpack(data, offset)? != 0,
        })
    }
}
impl ProtocolPack for AllegianceUpdateRequestActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        u32::from(self.panel_open).pack(buf);
    }
}

/// Presence notification may refer to a member absent from the partial profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AllegianceLoginNotificationEventData {
    /// Character identity.
    pub guid: Guid,
    /// Current online status.
    pub online: bool,
}
impl ProtocolUnpack for AllegianceLoginNotificationEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            guid: Guid::unpack(data, offset)?,
            online: u32::unpack(data, offset)? != 0,
        })
    }
}
impl ProtocolPack for AllegianceLoginNotificationEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        u32::from(self.online).pack(buf);
    }
}

/// Current-version administration metadata, retained for deterministic wire parity.
/// ACE blanks much of this; presence of a field does not imply management authority.
#[derive(Debug, Clone, PartialEq)]
pub struct AllegianceMetadata {
    /// Hash table bucket count.
    pub officer_buckets: usize,
    /// Officer GUID and level pairs.
    pub officers: Vec<(Guid, u32)>,
    /// Custom titles.
    pub officer_titles: Vec<String>,
    /// Monarch time/count followed by spokesperson time/count.
    pub broadcasts: [u32; 4],
    /// Message of the day.
    pub motd: String,
    /// Message author.
    pub motd_set_by: String,
    /// Allegiance chat identity.
    pub chat_room_id: u32,
    /// Allegiance bind location.
    pub bind_point: WorldPosition,
    /// Server-provided allegiance name.
    pub name: String,
    /// Name mutation timestamp.
    pub name_last_set_time: u32,
    /// Raw lock field, retained without assuming a bool encoding.
    pub locked: u32,
    /// Approved vassal field.
    pub approved_vassal: i32,
}

impl ProtocolUnpack for AllegianceMetadata {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let (count, officer_buckets) = read_hashtable_header(data, offset)?;
        if count > data.len().checked_sub(*offset)? / 8 {
            return None;
        }
        let officers = (0..count)
            .map(|_| Some((Guid::unpack(data, offset)?, u32::unpack(data, offset)?)))
            .collect::<Option<Vec<_>>>()?;
        let count = u32::unpack(data, offset)? as usize;
        if count > data.len().checked_sub(*offset)? / 4 {
            return None;
        }
        let officer_titles = (0..count)
            .map(|_| read_string16(data, offset))
            .collect::<Option<Vec<_>>>()?;
        Some(Self {
            officer_buckets,
            officers,
            officer_titles,
            broadcasts: [
                u32::unpack(data, offset)?,
                u32::unpack(data, offset)?,
                u32::unpack(data, offset)?,
                u32::unpack(data, offset)?,
            ],
            motd: read_string16(data, offset)?,
            motd_set_by: read_string16(data, offset)?,
            chat_room_id: u32::unpack(data, offset)?,
            bind_point: WorldPosition::unpack(data, offset)?,
            name: read_string16(data, offset)?,
            name_last_set_time: u32::unpack(data, offset)?,
            locked: u32::unpack(data, offset)?,
            approved_vassal: i32::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for AllegianceMetadata {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_hashtable_header(buf, self.officers.len(), self.officer_buckets);
        for (guid, level) in &self.officers {
            guid.pack(buf);
            level.pack(buf);
        }
        (self.officer_titles.len() as u32).pack(buf);
        for title in &self.officer_titles {
            write_string16(buf, title);
        }
        for value in self.broadcasts {
            value.pack(buf);
        }
        write_string16(buf, &self.motd);
        write_string16(buf, &self.motd_set_by);
        self.chat_room_id.pack(buf);
        self.bind_point.pack(buf);
        write_string16(buf, &self.name);
        self.name_last_set_time.pack(buf);
        self.locked.pack(buf);
        self.approved_vassal.pack(buf);
    }
}

/// Non-monarch node with a display-tree parent. ACE's patron parent may be the
/// monarch even when intervening ancestors are not disclosed.
#[derive(Debug, Clone, PartialEq)]
pub struct AllegianceChild {
    /// Parent identity in the partial display tree.
    pub parent: Guid,
    /// Disclosed character facts.
    pub data: AllegianceData,
}

/// A hierarchy either has no nodes or one monarch followed by linked nodes.
#[derive(Debug, Clone, PartialEq)]
pub enum AllegianceNodes {
    /// Character has no allegiance.
    Empty,
    /// Nonempty partial relationship tree.
    Tree {
        monarch: AllegianceData,
        children: Vec<AllegianceChild>,
    },
}

/// Complete current-version profile update. Older hierarchy layouts are rejected
/// explicitly rather than decoded with the current layout.
#[derive(Debug, Clone, PartialEq)]
pub struct AllegianceUpdateEventData {
    /// Receiving player's numeric rank.
    pub rank: u32,
    /// Total allegiance members, including monarch.
    pub total_members: u32,
    /// All descendants of the receiving player, not just direct vassals.
    pub total_descendants: u32,
    /// Wire metadata independent of the disclosed tree.
    pub metadata: AllegianceMetadata,
    /// Partial relationship tree.
    pub nodes: AllegianceNodes,
}

impl ProtocolUnpack for AllegianceUpdateEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let rank = u32::unpack(data, offset)?;
        let total_members = u32::unpack(data, offset)?;
        let total_descendants = u32::unpack(data, offset)?;
        let count = u16::unpack(data, offset)? as usize;
        if u16::unpack(data, offset)? != ALLEGIANCE_HIERARCHY_VERSION {
            return None;
        }
        let metadata = AllegianceMetadata::unpack(data, offset)?;
        // Each node needs at least 36 bytes; bound allocation before decoding.
        if count > data.len().checked_sub(*offset)? / 36 {
            return None;
        }
        let nodes = if count == 0 {
            AllegianceNodes::Empty
        } else {
            let monarch = AllegianceData::unpack(data, offset)?;
            let children = (1..count)
                .map(|_| {
                    Some(AllegianceChild {
                        parent: Guid::unpack(data, offset)?,
                        data: AllegianceData::unpack(data, offset)?,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            AllegianceNodes::Tree { monarch, children }
        };
        Some(Self {
            rank,
            total_members,
            total_descendants,
            metadata,
            nodes,
        })
    }
}

impl ProtocolPack for AllegianceUpdateEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.rank.pack(buf);
        self.total_members.pack(buf);
        self.total_descendants.pack(buf);
        let count = match &self.nodes {
            AllegianceNodes::Empty => 0,
            AllegianceNodes::Tree { children, .. } => children.len() + 1,
        };
        u16::try_from(count)
            .expect("allegiance node count exceeds wire capacity")
            .pack(buf);
        ALLEGIANCE_HIERARCHY_VERSION.pack(buf);
        self.metadata.pack(buf);
        if let AllegianceNodes::Tree { monarch, children } = &self.nodes {
            monarch.pack(buf);
            for child in children {
                child.parent.pack(buf);
                child.data.pack(buf);
            }
        }
    }
}

/// Online-time encoding is selected by the allegiance-age flag.
#[derive(Debug, Clone, PartialEq)]
pub enum AllegianceTime {
    /// Current encoding; ACE currently sends zero for both values.
    Age {
        time_online: u32,
        allegiance_age: u32,
    },
    /// Historical encoding, interpreted as a double by retail.
    Legacy(f64),
}

/// One disclosed relationship node, not a complete allegiance member record.
#[derive(Debug, Clone, PartialEq)]
pub struct AllegianceData {
    /// Character identity.
    pub guid: Guid,
    /// Server-reported cached XP, capped to u32 by ACE.
    pub cached_xp: u32,
    /// Server-reported contributed XP, capped to u32 by ACE.
    pub contributed_xp: u32,
    /// Flags independent of the level/time encoding; unknown flags are preserved.
    pub flags: u32,
    /// Gender code, used by title lookup.
    pub gender: u8,
    /// Heritage code, used by title lookup.
    pub heritage: u8,
    /// Numeric allegiance rank.
    pub rank: u16,
    /// Level is absent in older records.
    pub level: Option<u32>,
    /// Current loyalty skill.
    pub loyalty: u16,
    /// Current leadership skill.
    pub leadership: u16,
    /// Online-time and age wire variant.
    pub time: AllegianceTime,
    /// Server-provided character name.
    pub name: String,
}

impl AllegianceData {
    /// Presence bit supplied in the last profile or login notification.
    pub const LOGGED_IN: u32 = 1;
    const HAS_AGE: u32 = 4;
    const HAS_LEVEL: u32 = 8;
}

impl ProtocolUnpack for AllegianceData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let cached_xp = u32::unpack(data, offset)?;
        let contributed_xp = u32::unpack(data, offset)?;
        let bits = u32::unpack(data, offset)?;
        let gender = u8::unpack(data, offset)?;
        let heritage = u8::unpack(data, offset)?;
        let rank = u16::unpack(data, offset)?;
        let level = if bits & Self::HAS_LEVEL != 0 {
            Some(u32::unpack(data, offset)?)
        } else {
            None
        };
        let loyalty = u16::unpack(data, offset)?;
        let leadership = u16::unpack(data, offset)?;
        let time = if bits & Self::HAS_AGE != 0 {
            AllegianceTime::Age {
                time_online: u32::unpack(data, offset)?,
                allegiance_age: u32::unpack(data, offset)?,
            }
        } else {
            AllegianceTime::Legacy(f64::unpack(data, offset)?)
        };
        Some(Self {
            guid,
            cached_xp,
            contributed_xp,
            flags: bits & !(Self::HAS_AGE | Self::HAS_LEVEL),
            gender,
            heritage,
            rank,
            level,
            loyalty,
            leadership,
            time,
            name: read_string16(data, offset)?,
        })
    }
}

impl ProtocolPack for AllegianceData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.cached_xp.pack(buf);
        self.contributed_xp.pack(buf);
        let mut bits = self.flags & !(Self::HAS_AGE | Self::HAS_LEVEL);
        if self.level.is_some() {
            bits |= Self::HAS_LEVEL;
        }
        if matches!(self.time, AllegianceTime::Age { .. }) {
            bits |= Self::HAS_AGE;
        }
        bits.pack(buf);
        self.gender.pack(buf);
        self.heritage.pack(buf);
        self.rank.pack(buf);
        if let Some(level) = self.level {
            level.pack(buf);
        }
        self.loyalty.pack(buf);
        self.leadership.pack(buf);
        match self.time {
            AllegianceTime::Age {
                time_online,
                allegiance_age,
            } => {
                time_online.pack(buf);
                allegiance_age.pack(buf);
            }
            AllegianceTime::Legacy(value) => value.pack(buf),
        }
        write_string16(buf, &self.name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{GameAction, GameActionMessage, GameEvent, GameEventMessage};
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn allegiance_control_envelopes_match_server_readers_and_writers() {
        assert_pack_unpack_parity(
            &hex::decode("010000001f00000001000000").unwrap(),
            &GameActionMessage {
                sequence: 1,
                action: GameAction::AllegianceUpdateRequest(Box::new(
                    AllegianceUpdateRequestActionData { panel_open: true },
                )),
            },
        );
        for (opcode, event, payload) in [
            (
                0x01c8u32,
                GameEvent::AllegianceUpdateDone(0),
                vec![0, 0, 0, 0],
            ),
            (
                0x0003,
                GameEvent::AllegianceUpdateAborted(0x414),
                vec![0x14, 4, 0, 0],
            ),
            (
                0x027a,
                GameEvent::AllegianceLoginNotification(Box::new(
                    AllegianceLoginNotificationEventData {
                        guid: Guid(0x50000002),
                        online: true,
                    },
                )),
                vec![2, 0, 0, 0x50, 1, 0, 0, 0],
            ),
        ] {
            let mut bytes = hex::decode("0100005002000000").unwrap();
            bytes.extend(opcode.to_le_bytes());
            bytes.extend(payload);
            assert_pack_unpack_parity(
                &bytes,
                &GameEventMessage {
                    target: Guid(0x50000001),
                    sequence: 2,
                    event,
                },
            );
            for end in 0..bytes.len() {
                assert!(GameEventMessage::unpack(&bytes[..end], &mut 0).is_none());
            }
        }
    }

    #[test]
    fn allegiance_empty_profile_and_partial_tree() {
        // Independently assembled ACE v11 empty hierarchy: zero totals, officers,
        // titles, broadcasts, MOTD, chat, position, name, lock and approved vassal.
        let mut bytes = vec![0; 12];
        bytes.extend([0, 0, 11, 0]);
        bytes.extend([0, 0, 0, 1]); // officer hash header: zero entries, 256 buckets
        bytes.extend(vec![0; 80]);
        let empty = AllegianceUpdateEventData::unpack(&bytes, &mut 0).unwrap();
        assert_eq!(empty.nodes, AllegianceNodes::Empty);
        assert_eq!(empty.total_members, 0);
        assert_pack_unpack_parity(&bytes, &empty);
        for end in 0..bytes.len() {
            assert!(AllegianceUpdateEventData::unpack(&bytes[..end], &mut 0).is_none());
        }

        let node_bytes = hex::decode("0100005002000000030000000d00008001020300040000000500060007000000080000000300416d79000000").unwrap();
        let monarch = AllegianceData::unpack(&node_bytes, &mut 0).unwrap();
        let child = AllegianceData {
            guid: Guid(0x50000002),
            name: "Bob".into(),
            ..monarch.clone()
        };
        bytes[0..4].copy_from_slice(&3u32.to_le_bytes());
        bytes[4..8].copy_from_slice(&20u32.to_le_bytes());
        bytes[8..12].copy_from_slice(&10u32.to_le_bytes());
        bytes[12..14].copy_from_slice(&2u16.to_le_bytes());
        bytes.extend(node_bytes);
        bytes.extend(monarch.guid.0.to_le_bytes());
        bytes.extend(hex::decode("0200005002000000030000000d00008001020300040000000500060007000000080000000300426f62000000").unwrap());
        let tree = AllegianceUpdateEventData {
            rank: 3,
            total_members: 20,
            total_descendants: 10,
            nodes: AllegianceNodes::Tree {
                monarch: monarch.clone(),
                children: vec![AllegianceChild {
                    parent: monarch.guid,
                    data: child,
                }],
            },
            ..empty
        };
        assert_pack_unpack_parity(&bytes, &tree);
        for end in 0..bytes.len() {
            assert!(AllegianceUpdateEventData::unpack(&bytes[..end], &mut 0).is_none());
        }
        bytes[14..16].copy_from_slice(&12u16.to_le_bytes());
        assert!(AllegianceUpdateEventData::unpack(&bytes, &mut 0).is_none());
    }

    #[test]
    fn allegiance_node_current_and_legacy_encodings() {
        let node = AllegianceData {
            guid: Guid(0x50000001),
            cached_xp: 2,
            contributed_xp: 3,
            flags: 0x80000001,
            gender: 1,
            heritage: 2,
            rank: 3,
            level: Some(4),
            loyalty: 5,
            leadership: 6,
            time: AllegianceTime::Age {
                time_online: 7,
                allegiance_age: 8,
            },
            name: "Amy".into(),
        };
        let bytes = hex::decode("0100005002000000030000000d00008001020300040000000500060007000000080000000300416d79000000").unwrap();
        assert_pack_unpack_parity(&bytes, &node);
        for end in 0..bytes.len() {
            assert!(AllegianceData::unpack(&bytes[..end], &mut 0).is_none());
        }
        let legacy = AllegianceData {
            level: None,
            time: AllegianceTime::Legacy(1.5),
            ..node
        };
        let bytes = hex::decode(
            "010000500200000003000000010000800102030005000600000000000000f83f0300416d79000000",
        )
        .unwrap();
        assert_pack_unpack_parity(&bytes, &legacy);
        for end in 0..bytes.len() {
            assert!(AllegianceData::unpack(&bytes[..end], &mut 0).is_none());
        }
    }
}
