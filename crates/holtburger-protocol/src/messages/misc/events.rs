use crate::errors::WeenieError;
use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::ConfirmationType;

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorEventData {
    pub error: WeenieError,
}

impl ProtocolUnpack for WeenieErrorEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let error = WeenieError::from_repr(error_raw).unwrap_or(WeenieError::None);
        Some(WeenieErrorEventData { error })
    }
}

impl ProtocolPack for WeenieErrorEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.error as u32).to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorWithStringEventData {
    pub error: WeenieError,
    pub parameter: String,
}

impl ProtocolUnpack for WeenieErrorWithStringEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let error = WeenieError::from_repr(error_raw).unwrap_or(WeenieError::None);
        let parameter = read_string16(data, offset)?;
        Some(WeenieErrorWithStringEventData { error, parameter })
    }
}

impl ProtocolPack for WeenieErrorWithStringEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.error as u32).to_le_bytes());
        write_string16(buf, &self.parameter);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UseDoneEventData {
    pub error: WeenieError,
}

impl ProtocolUnpack for UseDoneEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let error = WeenieError::from_repr(error_raw).unwrap_or(WeenieError::None);
        Some(UseDoneEventData { error })
    }
}

impl ProtocolPack for UseDoneEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.error as u32).to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterConfirmationRequestEventData {
    pub confirmation_type: ConfirmationType,
    pub context: u32,
    pub text: String,
}

impl ProtocolUnpack for CharacterConfirmationRequestEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let confirmation_type =
            ConfirmationType::from_repr(LittleEndian::read_u32(&data[*offset..*offset + 4]))?;
        *offset += 4;
        let context = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let text = read_string16(data, offset)?;
        Some(Self {
            confirmation_type,
            context,
            text,
        })
    }
}

impl ProtocolPack for CharacterConfirmationRequestEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.confirmation_type as u32).to_le_bytes());
        buf.extend_from_slice(&self.context.to_le_bytes());
        write_string16(buf, &self.text);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterConfirmationDoneEventData {
    pub confirmation_type: ConfirmationType,
    pub context: u32,
}

impl ProtocolUnpack for CharacterConfirmationDoneEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let confirmation_type =
            ConfirmationType::from_repr(LittleEndian::read_u32(&data[*offset..*offset + 4]))?;
        *offset += 4;
        let context = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            confirmation_type,
            context,
        })
    }
}

impl ProtocolPack for CharacterConfirmationDoneEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.confirmation_type as u32).to_le_bytes());
        buf.extend_from_slice(&self.context.to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_event::{GameEvent, GameEventMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::ConfirmationType;
    use holtburger_common::Guid;

    #[test]
    fn test_weenie_error_fixture() {
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x0E,
            event: GameEvent::WeenieError(Box::new(WeenieErrorEventData {
                error: WeenieError::BadParam,
            })),
        }));
        let data = test_fixtures::WEENIE_ERROR;
        let mut offset = 0;
        let unpacked = GameMessage::unpack(data, &mut offset).unwrap();
        assert_eq!(unpacked, expected);

        // Verify parity now that we use a valid error ID
        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(packed, data);
    }

    #[test]
    fn test_weenie_error_with_string_fixture() {
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x0E,
            event: GameEvent::WeenieErrorWithString(Box::new(WeenieErrorWithStringEventData {
                error: WeenieError::BadParam,
                parameter: "Test error".to_string(),
            })),
        }));
        let data = test_fixtures::WEENIE_ERROR_WITH_STRING;
        let mut offset = 0;
        let unpacked = GameMessage::unpack(data, &mut offset).unwrap();
        assert_eq!(unpacked, expected);

        // Verify parity
        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(packed, data);
    }

    #[test]
    fn test_character_confirmation_request_fixture() {
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid::NULL,
            sequence: 0x0E,
            event: GameEvent::CharacterConfirmationRequest(Box::new(
                CharacterConfirmationRequestEventData {
                    confirmation_type: ConfirmationType::CraftInteraction,
                    context: 0xDEADBEEF,
                    text: "Craft this item? Success chance is 42%.".to_string(),
                },
            )),
        }));
        assert_pack_unpack_parity(test_fixtures::CHARACTER_CONFIRMATION_REQUEST, &expected);
    }

    #[test]
    fn test_character_confirmation_done_fixture() {
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid::NULL,
            sequence: 0x0F,
            event: GameEvent::CharacterConfirmationDone(Box::new(
                CharacterConfirmationDoneEventData {
                    confirmation_type: ConfirmationType::CraftInteraction,
                    context: 0xDEADBEEF,
                },
            )),
        }));
        assert_pack_unpack_parity(test_fixtures::CHARACTER_CONFIRMATION_DONE, &expected);
    }
}
