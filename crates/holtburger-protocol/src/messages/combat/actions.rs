use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

use super::types::*;

#[derive(Debug, Clone, PartialEq)]
pub struct ChangeCombatModeData {
    pub mode: CombatMode,
}

impl ProtocolUnpack for ChangeCombatModeData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let mode_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            mode: CombatMode::from_repr(mode_raw).unwrap_or(CombatMode::Undef),
        })
    }
}

impl ProtocolPack for ChangeCombatModeData {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.mode as u32).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct CancelAttackData {}

impl ProtocolUnpack for CancelAttackData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self::default())
    }
}

impl ProtocolPack for CancelAttackData {
    fn pack(&self, _writer: &mut Vec<u8>) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::test_fixtures as fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use byteorder::{LittleEndian, WriteBytesExt};

    #[test]
    fn test_change_combat_mode_parity() {
        let action = GameActionMessage {
            sequence: 0,
            action: GameAction::ChangeCombatMode(Box::new(ChangeCombatModeData {
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
            action: GameAction::CancelAttack(Box::new(CancelAttackData {})),
        };

        // Hex from ACE: B7010000
        // Prepend sequence: 00000000
        let fixture = hex::decode("00000000B7010000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }
}
