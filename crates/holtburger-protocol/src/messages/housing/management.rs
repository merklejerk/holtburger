//! Dedicated implicit-home action bodies and available-area search replies.

use super::{pack_list, unpack_list};
use crate::{
    messages::utils::{read_string16, write_string16},
    traits::{ProtocolPack, ProtocolUnpack},
};
use serde::{Deserialize, Serialize};

/// Identical name body used by add/remove permanent guest and boot-specific-guest actions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseGuestActionData {
    /// Character name; ACE resolves the character rather than accepting a GUID here.
    pub name: String,
}
impl ProtocolUnpack for HouseGuestActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            name: read_string16(data, offset)?,
        })
    }
}
impl ProtocolPack for HouseGuestActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.name)
    }
}

/// Boolean u32 body shared by public entry, hook visibility, and allegiance permissions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseFlagActionData {
    /// Enable or revoke the explicitly named action's capability.
    pub enabled: bool,
}
impl ProtocolUnpack for HouseFlagActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            enabled: bool::unpack(data, offset)?,
        })
    }
}
impl ProtocolPack for HouseFlagActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.enabled.pack(buf)
    }
}

/// Per-character storage permission uses an aligned name followed by a u32 boolean.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseStoragePermissionActionData {
    /// Character name to resolve on the server.
    pub name: String,
    /// Grant storage access or retain entry permission alone.
    pub allowed: bool,
}
impl ProtocolUnpack for HouseStoragePermissionActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            name: read_string16(data, offset)?,
            allowed: bool::unpack(data, offset)?,
        })
    }
}
impl ProtocolPack for HouseStoragePermissionActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.name);
        self.allowed.pack(buf)
    }
}

/// Query by raw HouseType; admission of known types belongs to core, not wire decoding.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseSearchActionData {
    /// 1 cottage, 2 villa, 3 mansion, 4 apartment.
    pub house_type: u32,
}
impl ProtocolUnpack for HouseSearchActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            house_type: u32::unpack(data, offset)?,
        })
    }
}
impl ProtocolPack for HouseSearchActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.house_type.pack(buf)
    }
}

/// Search areas are deduplicated independently from the total number of available houses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseAvailableHouses {
    /// Raw searched HouseType.
    pub house_type: u32,
    /// Server location cells, not precise crystal identities or individual listings.
    pub locations: Vec<u32>,
    /// Signed ACE count, validated by world before exposing usable results.
    pub total_available: i32,
}
impl ProtocolUnpack for HouseAvailableHouses {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            house_type: u32::unpack(data, offset)?,
            locations: unpack_list(data, offset)?,
            total_available: i32::unpack(data, offset)?,
        })
    }
}
impl ProtocolPack for HouseAvailableHouses {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.house_type.pack(buf);
        pack_list(&self.locations, buf);
        self.total_available.pack(buf)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::{GameAction, GameActionMessage, GameEvent, GameEventMessage};
    use holtburger_common::Guid;

    #[test]
    fn named_storage_action_places_u32_permission_after_aligned_name() {
        let fixture = hex::decode("0100000049020000030041646100000001000000").unwrap();
        let expected = GameActionMessage {
            sequence: 1,
            action: GameAction::ChangeStoragePermission(Box::new(
                HouseStoragePermissionActionData {
                    name: "Ada".into(),
                    allowed: true,
                },
            )),
        };
        assert_eq!(
            GameActionMessage::unpack(&fixture, &mut 0),
            Some(expected.clone())
        );
        let mut packed = Vec::new();
        expected.pack(&mut packed);
        assert_eq!(packed, fixture);
        for length in 0..fixture.len() {
            assert!(GameActionMessage::unpack(&fixture[..length], &mut 0).is_none());
        }
    }

    #[test]
    fn dedicated_housing_actions_have_exact_opcodes_and_body_shapes() {
        let guest = || Box::new(HouseGuestActionData { name: "Ada".into() });
        let flag = || Box::new(HouseFlagActionData { enabled: true });
        let cases = [
            (0x021fu32, GameAction::AbandonHouse, ""),
            (
                0x0245,
                GameAction::AddPermanentGuest(guest()),
                "0300416461000000",
            ),
            (
                0x0246,
                GameAction::RemovePermanentGuest(guest()),
                "0300416461000000",
            ),
            (0x0247, GameAction::SetOpenHouseStatus(flag()), "01000000"),
            (
                0x024a,
                GameAction::BootSpecificHouseGuest(guest()),
                "0300416461000000",
            ),
            (0x024c, GameAction::RemoveAllStoragePermission, ""),
            (0x024d, GameAction::RequestFullGuestList, ""),
            (0x025c, GameAction::AddAllStoragePermission, ""),
            (0x025e, GameAction::RemoveAllPermanentGuests, ""),
            (0x025f, GameAction::BootEveryone, ""),
            (0x0266, GameAction::SetHooksVisibility(flag()), "01000000"),
            (
                0x0267,
                GameAction::ModifyAllegianceGuestPermission(flag()),
                "01000000",
            ),
            (
                0x0268,
                GameAction::ModifyAllegianceStoragePermission(flag()),
                "01000000",
            ),
            (
                0x0270,
                GameAction::ListAvailableHouses(Box::new(HouseSearchActionData { house_type: 4 })),
                "04000000",
            ),
        ];
        for (opcode, action, body) in cases {
            let mut fixture = 1u32.to_le_bytes().to_vec();
            fixture.extend(opcode.to_le_bytes());
            fixture.extend(hex::decode(body).unwrap());
            let expected = GameActionMessage {
                sequence: 1,
                action,
            };
            assert_eq!(
                GameActionMessage::unpack(&fixture, &mut 0),
                Some(expected.clone())
            );
            let mut packed = Vec::new();
            expected.pack(&mut packed);
            assert_eq!(packed, fixture);
        }
    }

    #[test]
    fn search_areas_and_total_house_count_are_distinct_wire_fields() {
        let fixture =
            hex::decode("0100005001000000710200000400000002000000400055aa400055bb07000000")
                .unwrap();
        let expected = GameEventMessage {
            target: Guid(0x50000001),
            sequence: 1,
            event: GameEvent::AvailableHouses(Box::new(HouseAvailableHouses {
                house_type: 4,
                locations: vec![0xaa550040, 0xbb550040],
                total_available: 7,
            })),
        };
        assert_eq!(
            GameEventMessage::unpack(&fixture, &mut 0),
            Some(expected.clone())
        );
        let mut packed = Vec::new();
        expected.pack(&mut packed);
        assert_eq!(packed, fixture);
        for length in 0..fixture.len() {
            assert!(GameEventMessage::unpack(&fixture[..length], &mut 0).is_none());
        }
    }
}
