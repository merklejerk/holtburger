use crate::protocol::errors::{CharacterError, WeenieError};
use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16, write_string32};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct OrderingResetData;

impl MessageUnpack for OrderingResetData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(OrderingResetData)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterErrorData {
    pub error_id: u32,
}

impl CharacterErrorData {
    pub fn error(&self) -> Option<CharacterError> {
        CharacterError::from_repr(self.error_id)
    }
}

impl MessageUnpack for CharacterErrorData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(CharacterErrorData { error_id })
    }
}

impl MessagePack for CharacterErrorData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.error_id).unwrap();
    }
}

/// Data for a ping request (empty payload).
#[derive(Debug, Clone, PartialEq)]
pub struct PingRequestData;

impl MessageUnpack for PingRequestData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl MessagePack for PingRequestData {
    fn pack(&self, _buf: &mut Vec<u8>) {
        // No payload
    }
}

/// Data for a login complete (empty payload).
#[derive(Debug, Clone, PartialEq)]
pub struct LoginCompleteData;

impl MessageUnpack for LoginCompleteData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl MessagePack for LoginCompleteData {
    fn pack(&self, _buf: &mut Vec<u8>) {
        // No payload
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootAccountData {
    pub reason: Option<String>,
}

impl MessageUnpack for BootAccountData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        // BOOT_ACCOUNT can have an optional String16 reasoning.
        // If we've reached the end of the message, there's no reason provided.
        if *offset >= data.len() {
            return Some(BootAccountData { reason: None });
        }
        let reason = read_string16(data, offset)?;
        Some(BootAccountData {
            reason: Some(reason),
        })
    }
}

impl MessagePack for BootAccountData {
    fn pack(&self, buf: &mut Vec<u8>) {
        if let Some(reason) = &self.reason {
            write_string16(buf, reason);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AddEffectData {
    pub target: u32,
    pub effect: u32,
}

impl MessageUnpack for AddEffectData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let target = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let effect = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(AddEffectData { target, effect })
    }
}

pub fn build_login_payload(account: &str, password: &str, sequence: u32, version: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    write_string16(&mut payload, version); // ClientVersion

    // Placeholder for data_len
    let len_pos = payload.len();
    payload.extend_from_slice(&[0u8; 4]);

    let start_of_data = payload.len();

    payload.extend_from_slice(&0x02u32.to_le_bytes()); // NetAuthType: AccountPassword
    payload.extend_from_slice(&0x01u32.to_le_bytes()); // AuthFlags: EnableCrypto
    payload.extend_from_slice(&sequence.to_le_bytes()); // Timestamp
    write_string16(&mut payload, account);
    write_string16(&mut payload, ""); // AdminOverride
    write_string32(&mut payload, password);

    let data_len = (payload.len() - start_of_data) as u32;
    LittleEndian::write_u32(&mut payload[len_pos..len_pos + 4], data_len);

    payload
}

#[derive(Debug, Clone, PartialEq)]
pub struct MostlyConsecutiveIntSet {
    pub iterations: i32,
    pub values: Vec<i32>,
}

impl MessageUnpack for MostlyConsecutiveIntSet {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let iterations_count = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        *offset += 4;

        let mut values = Vec::new();
        let mut current_iters = 0;
        while current_iters < iterations_count {
            if *offset + 4 > data.len() {
                return None;
            }
            let x = LittleEndian::read_i32(&data[*offset..*offset + 4]);
            *offset += 4;

            if x < 0 {
                current_iters += x.abs() - 1;
            } else {
                current_iters += 1;
            }
            values.push(x);
        }
        Some(MostlyConsecutiveIntSet {
            iterations: iterations_count,
            values,
        })
    }
}

impl MessagePack for MostlyConsecutiveIntSet {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_i32::<LittleEndian>(self.iterations).unwrap();
        for &val in &self.values {
            buf.write_i32::<LittleEndian>(val).unwrap();
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TaggedIterationList {
    pub dat_file_type: i32,
    pub dat_file_id: i32,
    pub list: MostlyConsecutiveIntSet,
}

impl MessageUnpack for TaggedIterationList {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let dat_file_type = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        let dat_file_id = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        let list = MostlyConsecutiveIntSet::unpack(data, offset)?;
        Some(TaggedIterationList {
            dat_file_type,
            dat_file_id,
            list,
        })
    }
}

impl MessagePack for TaggedIterationList {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_i32::<LittleEndian>(self.dat_file_type).unwrap();
        buf.write_i32::<LittleEndian>(self.dat_file_id).unwrap();
        self.list.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DddInterrogationResponseData {
    pub language: u32,
    pub lists: Vec<TaggedIterationList>,
}

impl MessageUnpack for DddInterrogationResponseData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let language = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let count = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let mut lists = Vec::new();
        for _ in 0..count {
            lists.push(TaggedIterationList::unpack(data, offset)?);
        }
        Some(DddInterrogationResponseData { language, lists })
    }
}

impl MessagePack for DddInterrogationResponseData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.language).unwrap();
        buf.write_u32::<LittleEndian>(self.lists.len() as u32)
            .unwrap();
        for list in &self.lists {
            list.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorData {
    pub error_id: u32,
}

impl WeenieErrorData {
    pub fn error(&self) -> Option<WeenieError> {
        WeenieError::from_repr(self.error_id)
    }
}

impl MessageUnpack for WeenieErrorData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(WeenieErrorData { error_id })
    }
}

impl MessagePack for WeenieErrorData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.error_id).unwrap();
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

impl MessageUnpack for WeenieErrorWithStringData {
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

impl MessagePack for WeenieErrorWithStringData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.error_id).unwrap();
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UseDoneData {
    pub error_id: u32,
}

impl UseDoneData {
    pub fn error(&self) -> Option<WeenieError> {
        WeenieError::from_repr(self.error_id)
    }
}

impl MessageUnpack for UseDoneData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(UseDoneData { error_id })
    }
}

impl MessagePack for UseDoneData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.error_id).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_character_error_fixture() {
        let expected = CharacterErrorData {
            error_id: 0x80000001,
        };
        let mut buf = Vec::new();
        expected.pack(&mut buf);
        assert_eq!(buf.len(), 4);

        assert_pack_unpack_parity(&buf, &expected);
    }

    #[test]
    fn test_boot_account_fixture() {
        let expected = BootAccountData {
            reason: Some(" because you're mid".to_string()),
        };
        let mut buf = Vec::new();
        expected.pack(&mut buf);
        assert_pack_unpack_parity(&buf, &expected);

        let empty = BootAccountData { reason: None };
        let mut buf2 = Vec::new();
        empty.pack(&mut buf2);
        assert_pack_unpack_parity(&buf2, &empty);
    }

    #[test]
    fn test_ddd_interrogation_response_fixture() {
        use crate::protocol::fixtures;
        let expected = DddInterrogationResponseData {
            language: 1,
            lists: vec![TaggedIterationList {
                dat_file_type: 1,
                dat_file_id: 1,
                list: MostlyConsecutiveIntSet {
                    iterations: 2,
                    values: vec![100, 101],
                },
            }],
        };
        let data = &fixtures::DDD_INTERROGATION_RESPONSE[4..];
        assert_pack_unpack_parity(data, &expected);
    }

    #[test]
    fn test_mostly_consecutive_int_set_fixture() {
        let expected = MostlyConsecutiveIntSet {
            iterations: 5,
            values: vec![1000, -5],
        };
        let data = vec![
            0x05, 0x00, 0x00, 0x00, // count
            0xE8, 0x03, 0x00, 0x00, // 1000
            0xFB, 0xFF, 0xFF, 0xFF, // -5
        ];
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_weenie_error_fixture() {
        use crate::protocol::fixtures;
        use crate::protocol::messages::{GameEvent, GameEventData, GameMessage};
        let expected = GameMessage::GameEvent(Box::new(GameEvent {
            target: 0x50000001,
            sequence: 0x0E,
            event: GameEventData::WeenieError(Box::new(WeenieErrorData { error_id: 0x1234 })),
        }));
        assert_pack_unpack_parity(fixtures::WEENIE_ERROR, &expected);
    }

    #[test]
    fn test_weenie_error_with_string_fixture() {
        use crate::protocol::fixtures;
        use crate::protocol::messages::{GameEvent, GameEventData, GameMessage};
        let expected = GameMessage::GameEvent(Box::new(GameEvent {
            target: 0x50000001,
            sequence: 0x0E,
            event: GameEventData::WeenieErrorWithString(Box::new(WeenieErrorWithStringData {
                error_id: 0x1234,
                message: "Test error".to_string(),
            })),
        }));
        assert_pack_unpack_parity(fixtures::WEENIE_ERROR_WITH_STRING, &expected);
    }

    #[test]
    fn test_ping_request_parity() {
        use crate::protocol::fixtures;
        use crate::protocol::messages::{GameAction, GameActionData, GameMessage};
        let action = GameMessage::GameAction(Box::new(GameAction {
            sequence: 3,
            data: GameActionData::PingRequest(Box::new(PingRequestData)),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_PING_REQUEST, &action);
    }

    #[test]
    fn test_login_complete_parity() {
        use crate::protocol::fixtures;
        use crate::protocol::messages::{GameAction, GameActionData, GameMessage};
        let action = GameMessage::GameAction(Box::new(GameAction {
            sequence: 8,
            data: GameActionData::LoginComplete(Box::new(LoginCompleteData)),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_LOGIN_COMPLETE, &action);
    }
}
