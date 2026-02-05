use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16, write_string32};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct ServerMessageData {
    pub message: String,
}

impl MessageUnpack for ServerMessageData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        Some(ServerMessageData { message })
    }
}

impl MessagePack for ServerMessageData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrderingResetData;

impl MessageUnpack for OrderingResetData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(OrderingResetData)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct GameActionData {
    pub sequence: u32,
    pub action: u32,
    pub data: Vec<u8>,
}

impl MessageUnpack for GameActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let action = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let payload = data[*offset..].to_vec();
        *offset = data.len();
        Some(GameActionData {
            sequence,
            action,
            data: payload,
        })
    }
}

impl MessagePack for GameActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.sequence).unwrap();
        buf.write_u32::<LittleEndian>(self.action).unwrap();
        buf.extend_from_slice(&self.data);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterErrorData {
    pub error_code: u32,
}

impl MessageUnpack for CharacterErrorData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_code = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(CharacterErrorData { error_code })
    }
}

impl MessagePack for CharacterErrorData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.error_code).unwrap();
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

impl MostlyConsecutiveIntSet {
    pub fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
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

    pub fn pack(&self, buf: &mut Vec<u8>) {
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

impl TaggedIterationList {
    pub fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
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

    pub fn pack(&self, buf: &mut Vec<u8>) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_message_unpack() {
        let msg = ServerMessageData {
            message: "Welcome to Asheron's Call!".to_string(),
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);

        let mut offset = 0;
        let unpacked = ServerMessageData::unpack(&buf, &mut offset).unwrap();
        assert_eq!(unpacked, msg);
    }

    #[test]
    fn test_server_message_pack() {
        let msg = ServerMessageData {
            message: "Welcome to Asheron's Call!".to_string(),
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        // String16 length (2) + "Welcome to Asheron's Call!" (26) + pads (0) = 28
        assert_eq!(buf.len(), 28);
    }

    #[test]
    fn test_character_error_unpack() {
        let msg = CharacterErrorData {
            error_code: 0x80000001,
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);

        let mut offset = 0;
        let unpacked = CharacterErrorData::unpack(&buf, &mut offset).unwrap();
        assert_eq!(unpacked, msg);
    }

    #[test]
    fn test_character_error_pack() {
        let msg = CharacterErrorData {
            error_code: 0x80000001,
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        assert_eq!(buf.len(), 4);
    }

    #[test]
    fn test_game_action_unpack() {
        let msg = GameActionData {
            sequence: 123,
            action: crate::protocol::messages::actions::LOGIN_COMPLETE,
            data: vec![0x11, 0x22, 0x33],
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);

        let mut offset = 0;
        let unpacked = GameActionData::unpack(&buf, &mut offset).unwrap();
        assert_eq!(unpacked, msg);
    }

    #[test]
    fn test_game_action_pack() {
        let msg = GameActionData {
            sequence: 123,
            action: crate::protocol::messages::actions::LOGIN_COMPLETE,
            data: vec![0x11, 0x22, 0x33],
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        // seq(4) + action(4) + payload(3) = 11
        assert_eq!(buf.len(), 11);
    }

    #[test]
    fn test_ddd_interrogation_response_unpack() {
        use crate::protocol::fixtures;
        let data = fixtures::DDD_INTERROGATION_RESPONSE;
        let mut offset = 4; // Skip opcode
        let unpacked = DddInterrogationResponseData::unpack(data, &mut offset).unwrap();

        assert_eq!(unpacked.language, 1);
        assert_eq!(unpacked.lists.len(), 1);
        let list = &unpacked.lists[0];
        assert_eq!(list.dat_file_type, 1);
        assert_eq!(list.dat_file_id, 1);
        assert_eq!(list.list.iterations, 2);
        assert_eq!(list.list.values, vec![100, 101]);
    }

    #[test]
    fn test_ddd_interrogation_response_pack() {
        use crate::protocol::fixtures;
        let msg = DddInterrogationResponseData {
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
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        assert_eq!(buf, fixtures::DDD_INTERROGATION_RESPONSE[4..]);
    }

    #[test]
    fn test_mostly_consecutive_int_set_unpack() {
        // iterations=5, [1000, -5]
        let data = vec![
            0x05, 0x00, 0x00, 0x00, // count
            0xE8, 0x03, 0x00, 0x00, // 1000
            0xFB, 0xFF, 0xFF, 0xFF, // -5
        ];
        let mut offset = 0;
        let unpacked = MostlyConsecutiveIntSet::unpack(&data, &mut offset).unwrap();
        assert_eq!(unpacked.iterations, 5);
        assert_eq!(unpacked.values, vec![1000, -5]);
        assert_eq!(offset, 12);
    }

    #[test]
    fn test_mostly_consecutive_int_set_pack() {
        let set = MostlyConsecutiveIntSet {
            iterations: 5,
            values: vec![1000, -5],
        };
        let mut buf = Vec::new();
        set.pack(&mut buf);
        let expected = vec![
            0x05, 0x00, 0x00, 0x00, // count
            0xE8, 0x03, 0x00, 0x00, // 1000
            0xFB, 0xFF, 0xFF, 0xFF, // -5
        ];
        assert_eq!(buf, expected);
    }
}
