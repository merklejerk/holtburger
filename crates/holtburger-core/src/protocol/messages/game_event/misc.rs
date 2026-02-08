use crate::protocol::errors::WeenieError;
use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16};
use byteorder::{ByteOrder, LittleEndian};

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorData {
    pub error_id: u32,
}

impl WeenieErrorData {
    pub fn error(&self) -> Option<WeenieError> {
        WeenieError::from_repr(self.error_id)
    }
}

impl ProtocolUnpack for WeenieErrorData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(WeenieErrorData { error_id })
    }
}

impl ProtocolPack for WeenieErrorData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.error_id.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorWithStringData {
    pub error_id: u32,
    pub message: String,
}

impl WeenieErrorWithStringData {
    pub fn error(&self) -> Option<WeenieError> {
        WeenieError::from_repr(self.error_id)
    }
}

impl ProtocolUnpack for WeenieErrorWithStringData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let message = read_string16(data, offset)?;
        Some(WeenieErrorWithStringData { error_id, message })
    }
}

impl ProtocolPack for WeenieErrorWithStringData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.error_id.to_le_bytes());
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UseDoneData {
    pub error_id: u32,
}

impl ProtocolUnpack for UseDoneData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(UseDoneData { error_id })
    }
}

impl ProtocolPack for UseDoneData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.error_id.to_le_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::game_event::{GameEvent, GameEventMessage};
    use crate::protocol::messages::game_message::GameMessage;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;
    use crate::world::Guid;

    #[test]
    fn test_weenie_error_fixture() {
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x0E,
            event: GameEvent::WeenieError(Box::new(WeenieErrorData { error_id: 0x1234 })),
        }));
        assert_pack_unpack_parity(fixtures::WEENIE_ERROR, &expected);
    }

    #[test]
    fn test_weenie_error_with_string_fixture() {
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x0E,
            event: GameEvent::WeenieErrorWithString(Box::new(WeenieErrorWithStringData {
                error_id: 0x1234,
                message: "Test error".to_string(),
            })),
        }));
        assert_pack_unpack_parity(fixtures::WEENIE_ERROR_WITH_STRING, &expected);
    }
}
