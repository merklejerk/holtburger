use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct CreatureSkill {
    /// The unique skill ID (e.g. Melee Defense, War Magic).
    pub sk_type: u32,
    /// Number of ranks purchased via XP or granted by level.
    pub ranks: u32,
    /// Skill status: 0=Undef, 1=Innate, 2=Trained, 3=Specialized.
    pub status: u32,
    /// Total experience points invested in this skill.
    pub xp: u32,
    /// Initial value before investment (e.g. formula based on attributes).
    pub init: u32,
    /// Resistance factor for specific skill-based attacks.
    pub resistance: u32,
    /// World time when the skill was last actively exercised.
    pub last_used: f64,
}

impl ProtocolUnpack for CreatureSkill {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 32 > data.len() {
            return None;
        }
        let sk_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let ranks = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]) as u32;
        let _const_one = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        let status = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let xp = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let init = LittleEndian::read_u32(&data[*offset + 16..*offset + 20]);
        let resistance = LittleEndian::read_u32(&data[*offset + 20..*offset + 24]);
        let last_used = LittleEndian::read_f64(&data[*offset + 24..*offset + 32]);
        *offset += 32;
        Some(CreatureSkill {
            sk_type,
            ranks,
            status,
            xp,
            init,
            resistance,
            last_used,
        })
    }
}

impl ProtocolPack for CreatureSkill {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.sk_type).unwrap();
        writer.write_u16::<LittleEndian>(self.ranks as u16).unwrap();
        writer.write_u16::<LittleEndian>(1).unwrap();
        writer.write_u32::<LittleEndian>(self.status).unwrap();
        writer.write_u32::<LittleEndian>(self.xp).unwrap();
        writer.write_u32::<LittleEndian>(self.init).unwrap();
        writer.write_u32::<LittleEndian>(self.resistance).unwrap();
        writer.write_f64::<LittleEndian>(self.last_used).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_creature_skill_fixture() {
        let expected = CreatureSkill {
            sk_type: 28,
            ranks: 10,
            status: 3,
            xp: 0,
            init: 10,
            resistance: 0,
            last_used: 0.0,
        };
        assert_pack_unpack_parity(test_fixtures::CREATURE_SKILL_MELEE_DEF, &expected);
    }
}
