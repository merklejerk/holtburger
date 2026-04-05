use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::ConfirmationType;

#[derive(Debug, Clone, PartialEq)]
pub struct PingRequestActionData;

impl ProtocolUnpack for PingRequestActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for PingRequestActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct LoginCompleteActionData;

impl ProtocolUnpack for LoginCompleteActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for LoginCompleteActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct TeleToLifestoneActionData;

impl ProtocolUnpack for TeleToLifestoneActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for TeleToLifestoneActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct TeleToPklArenaActionData;

impl ProtocolUnpack for TeleToPklArenaActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for TeleToPklArenaActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct TeleToMarketPlaceActionData;

impl ProtocolUnpack for TeleToMarketPlaceActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for TeleToMarketPlaceActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct TeleToMansionActionData;

impl ProtocolUnpack for TeleToMansionActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for TeleToMansionActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuicideActionData;

impl ProtocolUnpack for SuicideActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for SuicideActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct EnterPkLiteActionData;

impl ProtocolUnpack for EnterPkLiteActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for EnterPkLiteActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct ConfirmationResponseActionData {
    pub confirmation_type: ConfirmationType,
    pub context: u32,
    pub accepted: bool,
}

impl ProtocolUnpack for ConfirmationResponseActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let confirmation_type =
            ConfirmationType::from_repr(LittleEndian::read_u32(&data[*offset..*offset + 4]))?;
        *offset += 4;
        let context = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let accepted = LittleEndian::read_i32(&data[*offset..*offset + 4]) != 0;
        *offset += 4;
        Some(Self {
            confirmation_type,
            context,
            accepted,
        })
    }
}

impl ProtocolPack for ConfirmationResponseActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.confirmation_type as u32)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.context).unwrap();
        buf.write_i32::<LittleEndian>(i32::from(self.accepted))
            .unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::test_fixtures as fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_confirmation_response_parity() {
        let action = GameActionMessage {
            sequence: 0x55667788,
            action: GameAction::ConfirmationResponse(Box::new(ConfirmationResponseActionData {
                confirmation_type: ConfirmationType::CraftInteraction,
                context: 0xDEADBEEF,
                accepted: true,
            })),
        };
        assert_pack_unpack_parity(fixtures::ACTION_CONFIRMATION_RESPONSE, &action);
    }

    #[test]
    fn test_confirmation_response_fellowship_fixture() {
        let action = GameActionMessage {
            sequence: 0xCAFEBABE,
            action: GameAction::ConfirmationResponse(Box::new(ConfirmationResponseActionData {
                confirmation_type: ConfirmationType::Fellowship,
                context: 0xABCDEF01,
                accepted: true,
            })),
        };

        let fixture = hex::decode("BEBAFECA750200000400000001EFCDAB01000000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_tele_to_lifestone_fixture() {
        let action = GameActionMessage {
            sequence: 0x11111111,
            action: GameAction::TeleToLifestone(Box::new(TeleToLifestoneActionData)),
        };

        // Generated from ACE: SyntheticProtocolTests.GenerateChatAndRecallActionFixtures
        let fixture = hex::decode("1111111163000000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_tele_to_pkl_arena_fixture() {
        let action = GameActionMessage {
            sequence: 0x22222222,
            action: GameAction::TeleToPklArena(Box::new(TeleToPklArenaActionData)),
        };

        let fixture = hex::decode("2222222226000000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_tele_to_mansion_fixture() {
        let action = GameActionMessage {
            sequence: 0x22222222,
            action: GameAction::TeleToMansion(Box::new(TeleToMansionActionData)),
        };

        // Generated from ACE: SyntheticProtocolTests.GenerateChatAndRecallActionFixtures
        let fixture = hex::decode("2222222278020000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_tele_to_marketplace_fixture() {
        let action = GameActionMessage {
            sequence: 0x33333333,
            action: GameAction::TeleToMarketPlace(Box::new(TeleToMarketPlaceActionData)),
        };

        let fixture = hex::decode("333333338d020000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_suicide_fixture() {
        let action = GameActionMessage {
            sequence: 0x33333333,
            action: GameAction::Suicide(Box::new(SuicideActionData)),
        };

        // Generated from ACE: SyntheticProtocolTests.GenerateChatAndRecallActionFixtures
        let fixture = hex::decode("3333333379020000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_enter_pkl_fixture() {
        let action = GameActionMessage {
            sequence: 0x44444444,
            action: GameAction::EnterPkLite(Box::new(EnterPkLiteActionData)),
        };

        // Generated from ACE: SyntheticProtocolTests.GenerateChatAndRecallActionFixtures
        let fixture = hex::decode("444444448F020000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }
}
