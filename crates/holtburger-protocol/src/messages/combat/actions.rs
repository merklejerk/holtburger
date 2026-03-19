use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;

use super::types::*;

#[derive(Debug, Clone, PartialEq)]
pub struct TargetedMeleeAttackActionData {
    pub target_guid: Guid,
    pub attack_height: AttackHeight,
    pub power_level: f32,
}

impl ProtocolUnpack for TargetedMeleeAttackActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }

        let target_guid = Guid::unpack(data, offset)?;
        let attack_height_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let power_level = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;

        Some(Self {
            target_guid,
            attack_height: AttackHeight::from_repr(attack_height_raw)
                .unwrap_or(AttackHeight::Medium),
            power_level,
        })
    }
}

impl ProtocolPack for TargetedMeleeAttackActionData {
    fn pack(&self, writer: &mut Vec<u8>) {
        self.target_guid.pack(writer);
        writer
            .write_u32::<LittleEndian>(self.attack_height as u32)
            .unwrap();
        writer.write_f32::<LittleEndian>(self.power_level).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TargetedMissileAttackActionData {
    pub target_guid: Guid,
    pub attack_height: AttackHeight,
    pub accuracy_level: f32,
}

impl ProtocolUnpack for TargetedMissileAttackActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }

        let target_guid = Guid::unpack(data, offset)?;
        let attack_height_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let accuracy_level = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;

        Some(Self {
            target_guid,
            attack_height: AttackHeight::from_repr(attack_height_raw)
                .unwrap_or(AttackHeight::Medium),
            accuracy_level,
        })
    }
}

impl ProtocolPack for TargetedMissileAttackActionData {
    fn pack(&self, writer: &mut Vec<u8>) {
        self.target_guid.pack(writer);
        writer
            .write_u32::<LittleEndian>(self.attack_height as u32)
            .unwrap();
        writer
            .write_f32::<LittleEndian>(self.accuracy_level)
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChangeCombatModeActionData {
    pub mode: CombatMode,
}

impl ProtocolUnpack for ChangeCombatModeActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let mode_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            mode: CombatMode::from_repr(mode_raw).unwrap_or(CombatMode::Undef),
        })
    }
}

impl ProtocolPack for ChangeCombatModeActionData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.mode as u32).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CancelAttackActionData {}

impl ProtocolUnpack for CancelAttackActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self::default())
    }
}

impl ProtocolPack for CancelAttackActionData {
    fn pack(&self, _writer: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryHealthActionData {
    pub target_guid: Guid,
}

impl ProtocolUnpack for QueryHealthActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target_guid = Guid::unpack(data, offset)?;
        Some(Self { target_guid })
    }
}

impl ProtocolPack for QueryHealthActionData {
    fn pack(&self, writer: &mut Vec<u8>) {
        self.target_guid.pack(writer);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_targeted_melee_attack_parity() {
        let action = GameActionMessage {
            sequence: 0,
            action: GameAction::TargetedMeleeAttack(Box::new(TargetedMeleeAttackActionData {
                target_guid: Guid(0x80000001),
                attack_height: AttackHeight::Medium,
                power_level: 0.5,
            })),
        };

        let fixture = hex::decode("000000000800000001000080020000000000003F").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_targeted_missile_attack_parity() {
        let action = GameActionMessage {
            sequence: 0,
            action: GameAction::TargetedMissileAttack(Box::new(TargetedMissileAttackActionData {
                target_guid: Guid(0x80000002),
                attack_height: AttackHeight::High,
                accuracy_level: 1.0,
            })),
        };

        let fixture = hex::decode("000000000A00000002000080010000000000803F").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_change_combat_mode_parity() {
        let action = GameActionMessage {
            sequence: 0,
            action: GameAction::ChangeCombatMode(Box::new(ChangeCombatModeActionData {
                mode: CombatMode::Melee,
            })),
        };

        // Hex from ACE: 5300000002000000
        // Prepend sequence: 00000000
        let fixture = hex::decode("000000005300000002000000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_cancel_attack_parity() {
        let action = GameActionMessage {
            sequence: 0,
            action: GameAction::CancelAttack(Box::new(CancelAttackActionData {})),
        };

        // Hex from ACE: B7010000
        // Prepend sequence: 00000000
        let fixture = hex::decode("00000000B7010000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_query_health_parity() {
        let action = GameActionMessage {
            sequence: 0,
            action: GameAction::QueryHealth(Box::new(QueryHealthActionData {
                target_guid: Guid(0x80000003),
            })),
        };

        // Hex from ACE SyntheticProtocolTests.GenerateCombatActionFixtures.
        let fixture = hex::decode("00000000BF01000003000080").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }
}
