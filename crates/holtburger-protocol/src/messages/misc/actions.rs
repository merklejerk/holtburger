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
}
