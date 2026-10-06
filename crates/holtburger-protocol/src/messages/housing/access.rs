//! HAR layouts from ACE HouseAccess/GuestInfo writers and retail HAR::UnPack (acclient.c:452545).

use super::{pack_list, unpack_list};
use crate::{
    messages::utils::{read_string16, write_string16},
    traits::{ProtocolPack, ProtocolUnpack},
};
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};

/// Named guest entry in the packable hash table, not a list of guests currently indoors.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseGuest {
    /// Hash-table key identifying the permitted character.
    pub character: Guid,
    /// Entry permission is implicit; this adds access to house storage.
    pub storage_allowed: bool,
    /// Name disclosed by the server for management commands and display.
    pub name: String,
}

impl ProtocolUnpack for HouseGuest {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            character: Guid::unpack(data, offset)?,
            storage_allowed: bool::unpack(data, offset)?,
            name: read_string16(data, offset)?,
        })
    }
}

impl ProtocolPack for HouseGuest {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.character.pack(buf);
        self.storage_allowed.pack(buf);
        write_string16(buf, &self.name);
    }
}

/// ACE writes a u16 entry count and u16 bucket count, followed by keyed guest records.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseGuestTable {
    /// Retained hash-table header for deterministic wire reserialization.
    pub buckets: u16,
    /// Records in received wire order; the frontend may choose its own display ordering.
    pub entries: Vec<HouseGuest>,
}

impl ProtocolUnpack for HouseGuestTable {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let count = usize::from(u16::unpack(data, offset)?);
        let buckets = u16::unpack(data, offset)?;
        // Each entry needs GUID, u32 storage permission, and at least a String16 length.
        if count > data.len().checked_sub(*offset)? / 10 {
            return None;
        }
        let entries = (0..count)
            .map(|_| HouseGuest::unpack(data, offset))
            .collect::<Option<Vec<_>>>()?;
        Some(Self { buckets, entries })
    }
}

impl ProtocolPack for HouseGuestTable {
    fn pack(&self, buf: &mut Vec<u8>) {
        u16::try_from(self.entries.len())
            .expect("HAR guest count must fit its u16 header")
            .pack(buf);
        self.buckets.pack(buf);
        for guest in &self.entries {
            guest.pack(buf)
        }
    }
}

/// Wire format owns the fields present in each known HAR version.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum HouseAccessFormat {
    /// Pre-versioned HAR discloses public entry and a guest table only.
    Legacy {
        /// Legacy status word is retained; retail treats any nonzero value as open.
        open_status: u16,
    },
    /// 0x10000001 introduced raw access flags and monarch identity.
    Version1 {
        /// Raw HARBitfield, preserving unknown bits.
        flags: u32,
        /// Allegiance monarch, or null.
        monarch: Guid,
    },
    /// 0x10000002 adds account roommates, without identifying the home owner.
    Version2 {
        /// Raw HARBitfield, preserving unknown bits.
        flags: u32,
        /// Allegiance monarch, or null.
        monarch: Guid,
        /// Other characters on the owner's account, excluding the owner.
        roommates: Vec<Guid>,
    },
}

/// Version-aware access reply; it contains neither a house ID nor request correlation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseAccess {
    /// Format-specific flags/monarch/roommates; absent fields cannot be mistaken for disclosed zeroes.
    pub format: HouseAccessFormat,
    /// Packed guest-table metadata and named permissions.
    pub guests: HouseGuestTable,
}

impl ProtocolUnpack for HouseAccess {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let version = u32::unpack(data, offset)?;
        let (flags, monarch) = match version {
            0..=0xffff => (0, Guid::NULL),
            0x10000001 | 0x10000002 => (u32::unpack(data, offset)?, Guid::unpack(data, offset)?),
            _ => return None, // Unknown layouts need evidence before their fields can be decoded.
        };
        let guests = HouseGuestTable::unpack(data, offset)?;
        let format = match version {
            0x10000001 => HouseAccessFormat::Version1 { flags, monarch },
            0x10000002 => HouseAccessFormat::Version2 {
                flags,
                monarch,
                roommates: unpack_list(data, offset)?,
            },
            _ => HouseAccessFormat::Legacy {
                open_status: version as u16,
            },
        };
        Some(Self { format, guests })
    }
}

impl ProtocolPack for HouseAccess {
    fn pack(&self, buf: &mut Vec<u8>) {
        match &self.format {
            HouseAccessFormat::Legacy { open_status } => u32::from(*open_status).pack(buf),
            HouseAccessFormat::Version1 { flags, monarch } => {
                0x10000001u32.pack(buf);
                flags.pack(buf);
                monarch.pack(buf);
            }
            HouseAccessFormat::Version2 { flags, monarch, .. } => {
                0x10000002u32.pack(buf);
                flags.pack(buf);
                monarch.pack(buf);
            }
        }
        self.guests.pack(buf);
        if let HouseAccessFormat::Version2 { roommates, .. } = &self.format {
            pack_list(roommates, buf)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{GameEvent, GameEventMessage};

    #[test]
    fn ace_v2_fixture_preserves_hash_header_names_flags_and_roommates() {
        let fixture = hex::decode(
            "02000010050000800100005001004000020000500100000003004164610000000100000003000050",
        )
        .unwrap();
        let expected = HouseAccess {
            format: HouseAccessFormat::Version2 {
                flags: 0x80000005,
                monarch: Guid(0x50000001),
                roommates: vec![Guid(0x50000003)],
            },
            guests: HouseGuestTable {
                buckets: 64,
                entries: vec![HouseGuest {
                    character: Guid(0x50000002),
                    storage_allowed: true,
                    name: "Ada".into(),
                }],
            },
        };
        let mut offset = 0;
        assert_eq!(
            HouseAccess::unpack(&fixture, &mut offset),
            Some(expected.clone())
        );
        assert_eq!(offset, fixture.len());
        let mut packed = Vec::new();
        expected.pack(&mut packed);
        assert_eq!(packed, fixture);
        let mut event_fixture = hex::decode("010000500100000057020000").unwrap();
        event_fixture.extend(&fixture);
        let event = GameEventMessage {
            target: Guid(0x50000001),
            sequence: 1,
            event: GameEvent::UpdateHar(Box::new(expected)),
        };
        assert_eq!(
            GameEventMessage::unpack(&event_fixture, &mut 0),
            Some(event.clone())
        );
        let mut packed_event = Vec::new();
        event.pack(&mut packed_event);
        assert_eq!(packed_event, event_fixture);
        for length in 0..fixture.len() {
            assert!(
                HouseAccess::unpack(&fixture[..length], &mut 0).is_none(),
                "accepted truncated HAR of {length} bytes"
            );
        }
    }

    #[test]
    fn older_layouts_do_not_invent_disclosed_roommates_or_monarchs() {
        for (bytes, format) in [
            (
                "0200000000004000",
                HouseAccessFormat::Legacy { open_status: 2 },
            ),
            (
                "01000010030000000100005000004000",
                HouseAccessFormat::Version1 {
                    flags: 3,
                    monarch: Guid(0x50000001),
                },
            ),
        ] {
            let fixture = hex::decode(bytes).unwrap();
            let value = HouseAccess::unpack(&fixture, &mut 0).unwrap();
            assert_eq!(value.format, format);
            assert!(value.guests.entries.is_empty());
            let mut packed = Vec::new();
            value.pack(&mut packed);
            assert_eq!(packed, fixture);
        }
        assert!(
            HouseAccess::unpack(
                &hex::decode("0300001000000000000000000000400000000000").unwrap(),
                &mut 0
            )
            .is_none()
        );
        assert!(
            HouseAccess::unpack(
                &hex::decode("020000100000000000000000ffff4000").unwrap(),
                &mut 0
            )
            .is_none()
        );
    }
}
