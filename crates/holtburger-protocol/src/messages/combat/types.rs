use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use bitflags::bitflags;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize)]
#[repr(u32)]
pub enum AttackHeight {
    High = 0x01,
    Medium = 0x02,
    Low = 0x03,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize)]
#[repr(u32)]
pub enum CombatMode {
    Undef = 0x00,
    NonCombat = 0x01,
    Melee = 0x02,
    Missile = 0x04,
    Magic = 0x08,
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct AttackConditions: u64 {
        const NONE = 0x0;
        const CRITICAL_PROTECTION_AUGMENTATION = 0x1;
        const RECKLESSNESS = 0x2;
        const SNEAK_ATTACK = 0x4;
        const OVERPOWER = 0x8;
    }
}

impl AttackConditions {
    pub fn iter_display_names(&self) -> impl Iterator<Item = &'static str> {
        self.iter_names().map(|(name, _)| match name {
            "CRITICAL_PROTECTION_AUGMENTATION" => "Critical Protection Augmentation",
            "RECKLESSNESS" => "Recklessness",
            "SNEAK_ATTACK" => "Sneak Attack",
            "OVERPOWER" => "Overpower",
            _ => name,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize)]
#[repr(u32)]
pub enum DamageLocation {
    Head = 0x0,
    Chest = 0x1,
    Abdomen = 0x2,
    UpperArm = 0x3,
    LowerArm = 0x4,
    Hand = 0x5,
    UpperLeg = 0x6,
    LowerLeg = 0x7,
    Foot = 0x8,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerKilledData {
    pub death_message: String,
    pub victim_id: Guid,
    pub killer_id: Guid,
}

impl ProtocolUnpack for PlayerKilledData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let death_message = read_string16(data, offset)?;

        if *offset + 8 > data.len() {
            return None;
        }

        let victim_id = Guid(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;
        let killer_id = Guid(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;

        Some(Self {
            death_message,
            victim_id,
            killer_id,
        })
    }
}

impl ProtocolPack for PlayerKilledData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.death_message);
        buf.write_u32::<LittleEndian>(self.victim_id.0).unwrap();
        buf.write_u32::<LittleEndian>(self.killer_id.0).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_player_killed_fixture() {
        let expected = PlayerKilledData {
            death_message: "Test".to_string(),
            victim_id: Guid(0x12345678),
            killer_id: Guid(0x90ABCDEF),
        };

        let fixture = hex::decode("040054657374000078563412EFCDAB90").unwrap();
        assert_pack_unpack_parity(&fixture, &expected);
    }
}
