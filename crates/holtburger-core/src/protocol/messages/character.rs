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
pub struct CharacterEnterWorldRequestData {}

impl MessageUnpack for CharacterEnterWorldRequestData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(CharacterEnterWorldRequestData {})
    }
}

impl MessagePack for CharacterEnterWorldRequestData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
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

    #[test]
    fn test_character_enter_world_request_unpack() {
        let data = fixtures::CHARACTER_ENTER_WORLD_REQUEST;
        // Skip opcode (4 bytes)
        let mut offset = 4;
        let _unpacked = CharacterEnterWorldRequestData::unpack(data, &mut offset).unwrap();

        // We don't read anything anymore
        assert_eq!(offset, 4);
    }

    #[test]
    fn test_character_enter_world_request_pack() {
        let msg = CharacterEnterWorldRequestData {};
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        assert!(buf.is_empty());
    }

    #[test]
    fn test_character_enter_world_unpack() {
        let data = fixtures::CHARACTER_ENTER_WORLD;
        // Skip opcode (4 bytes)
        let mut offset = 4;
        let unpacked = CharacterEnterWorldData::unpack(data, &mut offset).unwrap();

        assert_eq!(unpacked.guid, 0x12345678);
        assert_eq!(unpacked.account, "Alice");
        assert_eq!(offset, data.len());
    }

    #[test]
    fn test_character_enter_world_pack() {
        let msg = CharacterEnterWorldData {
            guid: 0x12345678,
            account: "Alice".to_string(),
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        assert_eq!(buf, fixtures::CHARACTER_ENTER_WORLD[4..]);
    }

    #[test]
    fn test_character_list_unpack() {
        let data = fixtures::CHARACTER_LIST;
        // Skip opcode (4 bytes)
        let mut offset = 4;
        let unpacked = CharacterListData::unpack(data, &mut offset).unwrap();

        assert_eq!(unpacked.characters.len(), 1);
        assert_eq!(unpacked.characters[0].guid, 0x12345678);
        assert_eq!(unpacked.characters[0].name, "Alice");
        assert_eq!(unpacked.max_slots, 3);
        assert_eq!(unpacked.account_name, "AliceAccount");
        assert!(unpacked.use_turbine_chat);
        assert!(unpacked.has_tod_expansion);
        assert_eq!(offset, data.len());
    }

    #[test]
    fn test_character_list_pack() {
        let entry = CharacterEntry {
            guid: 0x12345678,
            name: "Alice".to_string(),
            delete_time: 0,
        };
        let msg = CharacterListData {
            characters: vec![entry],
            max_slots: 3,
            account_name: "AliceAccount".to_string(),
            use_turbine_chat: true,
            has_tod_expansion: true,
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        assert_eq!(buf, fixtures::CHARACTER_LIST[4..]);
    }
}
