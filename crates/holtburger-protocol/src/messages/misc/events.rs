use crate::errors::WeenieError;
use crate::messages::utils::{read_string16, write_string16};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_event::{GameEvent, GameEventMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;
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
}
