use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct RaiseAttributeData {
    pub attribute_type: u32,
    pub xp_spent: u32,
}

impl ProtocolUnpack for RaiseAttributeData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let attribute_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let xp_spent = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            attribute_type,
            xp_spent,
        })
    }
}

impl ProtocolPack for RaiseAttributeData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer
            .write_u32::<LittleEndian>(self.attribute_type)
            .unwrap();
        writer.write_u32::<LittleEndian>(self.xp_spent).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RaiseVitalData {
    pub vital_type: u32,
    pub xp_spent: u32,
}

impl ProtocolUnpack for RaiseVitalData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let vital_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let xp_spent = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            vital_type,
            xp_spent,
        })
    }
}

impl ProtocolPack for RaiseVitalData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.vital_type).unwrap();
        writer.write_u32::<LittleEndian>(self.xp_spent).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RaiseSkillData {
    pub skill_type: u32,
    pub xp_spent: u32,
}

impl ProtocolUnpack for RaiseSkillData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let skill_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let xp_spent = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            skill_type,
            xp_spent,
        })
    }
}

impl ProtocolPack for RaiseSkillData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.skill_type).unwrap();
        writer.write_u32::<LittleEndian>(self.xp_spent).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrainSkillData {
    pub skill_type: u32,
    pub credits_spent: i32,
}

impl ProtocolUnpack for TrainSkillData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let skill_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let credits_spent = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            skill_type,
            credits_spent,
        })
    }
}

impl ProtocolPack for TrainSkillData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.skill_type).unwrap();
        writer
            .write_i32::<LittleEndian>(self.credits_spent)
            .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::test_fixtures as fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use byteorder::{LittleEndian, WriteBytesExt};

    #[test]
    fn test_raise_attribute_parity() {
        let action = GameActionMessage {
            sequence: 0x55,
            action: GameAction::RaiseAttribute(Box::new(RaiseAttributeData {
                attribute_type: 1, // Strength
                xp_spent: 1000,
            })),
        };
        assert_pack_unpack_parity(fixtures::ACTION_RAISE_ATTRIBUTE, &action);
    }

    #[test]
    fn test_raise_vital_parity() {
        let action = GameActionMessage {
            sequence: 0x66,
            action: GameAction::RaiseVital(Box::new(RaiseVitalData {
                vital_type: 2, // Health
                xp_spent: 500,
            })),
        };
        assert_pack_unpack_parity(fixtures::ACTION_RAISE_VITAL, &action);
    }

    #[test]
    fn test_raise_skill_parity() {
        let action = GameActionMessage {
            sequence: 0x77,
            action: GameAction::RaiseSkill(Box::new(RaiseSkillData {
                skill_type: 6, // Melee Defense
                xp_spent: 2500,
            })),
        };
        assert_pack_unpack_parity(fixtures::ACTION_RAISE_SKILL, &action);
    }

    #[test]
    fn test_train_skill_parity() {
        let action = GameActionMessage {
            sequence: 0x88,
            action: GameAction::TrainSkill(Box::new(TrainSkillData {
                skill_type: 14, // Arcane Lore
                credits_spent: 4,
            })),
        };
        let mut expected = Vec::new();
        expected.write_u32::<LittleEndian>(0x88).unwrap(); // sequence
        expected.write_u32::<LittleEndian>(0x0047).unwrap(); // action_type
        expected.write_u32::<LittleEndian>(14).unwrap(); // skill_type
        expected.write_i32::<LittleEndian>(4).unwrap(); // credits_spent

        let mut packed = Vec::new();
        action.pack(&mut packed);
        assert_eq!(packed, expected);

        let mut offset = 0;
        let unpacked = GameActionMessage::unpack(&packed, &mut offset).unwrap();
        assert_eq!(unpacked, action);
    }
}
