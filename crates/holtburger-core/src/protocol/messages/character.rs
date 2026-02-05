use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterEntry {
    pub guid: u32,
    pub name: String,
    pub delete_time: u32,
}

impl MessageUnpack for CharacterEntry {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let name = read_string16(data, offset)?;

        if *offset + 4 > data.len() {
            return None;
        }
        let delete_time = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        Some(CharacterEntry {
            guid,
            name,
            delete_time,
        })
    }
}

impl MessagePack for CharacterEntry {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.guid.to_le_bytes());
        write_string16(buf, &self.name);
        buf.write_u32::<LittleEndian>(self.delete_time).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterListData {
    pub characters: Vec<CharacterEntry>,
    pub max_slots: u32,
    pub account_name: String,
    pub use_turbine_chat: bool,
    pub has_tod_expansion: bool,
}

impl MessageUnpack for CharacterListData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        // Skip leading padding (always 0)
        if *offset + 4 > data.len() {
            return None;
        }
        *offset += 4;

        if *offset + 4 > data.len() {
            return None;
        }
        let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut characters = Vec::new();
        for _ in 0..count {
            if let Some(entry) = CharacterEntry::unpack(data, offset) {
                characters.push(entry);
            }
        }

        // Post-character list padding
        if *offset + 4 > data.len() {
            return None;
        }
        *offset += 4;

        if *offset + 4 > data.len() {
            return None;
        }
        let max_slots = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let account_name = read_string16(data, offset)?;

        if *offset + 8 > data.len() {
            return None;
        }
        let use_turbine_chat = LittleEndian::read_u32(&data[*offset..*offset + 4]) != 0;
        let has_tod_expansion = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) != 0;
        *offset += 8;

        Some(CharacterListData {
            characters,
            max_slots,
            account_name,
            use_turbine_chat,
            has_tod_expansion,
        })
    }
}

impl MessagePack for CharacterListData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(0).unwrap(); // Leading padding
        buf.extend_from_slice(&(self.characters.len() as u32).to_le_bytes());
        for entry in &self.characters {
            entry.pack(buf);
        }
        buf.write_u32::<LittleEndian>(0).unwrap(); // Middle padding
        buf.write_u32::<LittleEndian>(self.max_slots).unwrap();
        write_string16(buf, &self.account_name);
        buf.write_u32::<LittleEndian>(self.use_turbine_chat as u32)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.has_tod_expansion as u32)
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterEnterWorldRequestData {
    pub guid: u32,
}

impl MessageUnpack for CharacterEnterWorldRequestData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(CharacterEnterWorldRequestData { guid })
    }
}

impl MessagePack for CharacterEnterWorldRequestData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.guid.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterEnterWorldData {
    pub guid: u32,
    pub account: String,
}

impl MessageUnpack for CharacterEnterWorldData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let account = read_string16(data, offset)?;
        Some(CharacterEnterWorldData { guid, account })
    }
}

impl MessagePack for CharacterEnterWorldData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.guid.to_le_bytes());
        write_string16(buf, &self.account);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServerNameData {
    pub online_count: u32,
    pub online_cap: u32,
    pub name: String,
}

impl MessageUnpack for ServerNameData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let online_count = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let online_cap = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        let name = read_string16(data, offset)?;
        Some(ServerNameData {
            name,
            online_count,
            online_cap,
        })
    }
}

impl MessagePack for ServerNameData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.online_count).unwrap();
        buf.write_u32::<LittleEndian>(self.online_cap).unwrap();
        write_string16(buf, &self.name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_character_enter_world_request_fixture() {
        let expected = CharacterEnterWorldRequestData { guid: 0x12345678 };
        // Skip opcode (4 bytes)
        assert_pack_unpack_parity(&fixtures::CHARACTER_ENTER_WORLD_REQUEST[4..], &expected);
    }

    #[test]
    fn test_character_enter_world_fixture() {
        let expected = CharacterEnterWorldData {
            guid: 0x12345678,
            account: "Alice".to_string(),
        };
        // Skip opcode (4 bytes)
        assert_pack_unpack_parity(&fixtures::CHARACTER_ENTER_WORLD[4..], &expected);
    }

    #[test]
    fn test_character_list_fixture() {
        let expected = CharacterListData {
            characters: vec![CharacterEntry {
                guid: 0x12345678,
                name: "Alice".to_string(),
                delete_time: 0,
            }],
            max_slots: 3,
            account_name: "AliceAccount".to_string(),
            use_turbine_chat: true,
            has_tod_expansion: true,
        };
        // Skip opcode (4 bytes)
        assert_pack_unpack_parity(&fixtures::CHARACTER_LIST[4..], &expected);
    }

    #[test]
    fn test_gamemessage_routing_character_request() {
        use crate::protocol::messages::GameMessage;
        let packed = vec![0xC8, 0xF7, 0x00, 0x00, 0x12, 0x34, 0x56, 0x78];
        let unpacked = GameMessage::unpack(&packed).expect("Routing failed");
        assert!(matches!(
            unpacked,
            GameMessage::CharacterEnterWorldRequest(_)
        ));
    }
}
