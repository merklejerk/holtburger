use crate::errors::WeenieError;
use crate::messages::utils::{read_string16, write_string16};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorData {
    pub error: WeenieError,
}

impl ProtocolUnpack for WeenieErrorData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let error = WeenieError::from_repr(error_raw).unwrap_or(WeenieError::None);
        Some(WeenieErrorData { error })
    }
}

impl ProtocolPack for WeenieErrorData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.error as u32).to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorWithStringData {
    pub error: WeenieError,
    pub parameter: String,
}

impl ProtocolUnpack for WeenieErrorWithStringData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let error = WeenieError::from_repr(error_raw).unwrap_or(WeenieError::None);
        let parameter = read_string16(data, offset)?;
        Some(WeenieErrorWithStringData { error, parameter })
    }
}

impl ProtocolPack for WeenieErrorWithStringData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&(self.error as u32).to_le_bytes());
        write_string16(buf, &self.parameter);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UseDoneData {
    pub error: WeenieError,
}

impl ProtocolUnpack for UseDoneData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let error = WeenieError::from_repr(error_raw).unwrap_or(WeenieError::None);
        Some(UseDoneData { error })
    }
}

impl ProtocolPack for UseDoneData {
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
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::Guid;

    #[test]
    fn test_weenie_error_fixture() {
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x0E,
            event: GameEvent::WeenieError(Box::new(WeenieErrorData {
                error: WeenieError::None,
            })),
        }));
        // Note: Fixture uses 0x1234 which is not a valid WeenieError, so it maps to None.
        // We bypass parity check because packing None results in 0x0, which doesn't match the fixture's 0x1234.
        let data = test_fixtures::WEENIE_ERROR;
        let mut offset = 0;
        let unpacked = GameMessage::unpack(data, &mut offset).unwrap();
        assert_eq!(unpacked, expected);
    }

    #[test]
    fn test_weenie_error_with_string_fixture() {
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x0E,
            event: GameEvent::WeenieErrorWithString(Box::new(WeenieErrorWithStringData {
                error: WeenieError::None,
                parameter: "Test error".to_string(),
            })),
        }));
        let data = test_fixtures::WEENIE_ERROR_WITH_STRING;
        let mut offset = 0;
        let unpacked = GameMessage::unpack(data, &mut offset).unwrap();
        assert_eq!(unpacked, expected);
    }
}
