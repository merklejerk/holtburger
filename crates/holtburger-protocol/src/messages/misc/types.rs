use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct OrderingResetData;

impl ProtocolUnpack for OrderingResetData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(OrderingResetData)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterErrorData {
    pub error_id: u32,
}

impl ProtocolUnpack for CharacterErrorData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(CharacterErrorData { error_id })
    }
}

impl ProtocolPack for CharacterErrorData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.error_id).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct BootAccountData {
    pub reason: Option<String>,
}

impl ProtocolUnpack for BootAccountData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset >= data.len() {
            return Some(BootAccountData { reason: None });
        }
        let reason = read_string16(data, offset)?;
        Some(BootAccountData {
            reason: Some(reason),
        })
    }
}

impl ProtocolPack for BootAccountData {
    fn pack(&self, buf: &mut Vec<u8>) {
        if let Some(reason) = &self.reason {
            write_string16(buf, reason);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MostlyConsecutiveIntSet {
    pub iterations: i32,
    pub values: Vec<i32>,
}

impl ProtocolUnpack for MostlyConsecutiveIntSet {
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

impl ProtocolPack for MostlyConsecutiveIntSet {
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

impl ProtocolUnpack for TaggedIterationList {
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

impl ProtocolPack for TaggedIterationList {
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

impl ProtocolUnpack for DddInterrogationResponseData {
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

impl ProtocolPack for DddInterrogationResponseData {
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
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;

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
        let data = &test_fixtures::DDD_INTERROGATION_RESPONSE[4..];
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
}
