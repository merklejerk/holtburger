use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterEntry {
    pub guid: Guid,
    pub name: String,
    pub delete_time: u32,
}

impl ProtocolUnpack for CharacterEntry {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
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

impl ProtocolPack for CharacterEntry {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
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

impl ProtocolUnpack for CharacterListData {
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

impl ProtocolPack for CharacterListData {
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
    pub guid: Guid,
}

impl ProtocolUnpack for CharacterEnterWorldRequestData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        Some(CharacterEnterWorldRequestData { guid })
    }
}

impl ProtocolPack for CharacterEnterWorldRequestData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterEnterWorldData {
    pub guid: Guid,
    pub account: String,
}

impl ProtocolUnpack for CharacterEnterWorldData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let account = read_string16(data, offset)?;
        Some(CharacterEnterWorldData { guid, account })
    }
}

impl ProtocolPack for CharacterEnterWorldData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        write_string16(buf, &self.account);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServerNameData {
    pub current_connections: u32,
    pub max_connections: i32,
    pub name: String,
}

impl ProtocolUnpack for ServerNameData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let current_connections = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let max_connections = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        let name = read_string16(data, offset)?;
        Some(ServerNameData {
            name,
            current_connections,
            max_connections,
        })
    }
}

impl ProtocolPack for ServerNameData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.current_connections)
            .unwrap();
        buf.write_i32::<LittleEndian>(self.max_connections).unwrap();
        write_string16(buf, &self.name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use crate::traits::{ProtocolPack, ProtocolUnpack};

    #[test]
    fn test_character_list_fixture() {
        let data = test_fixtures::CHARACTER_LIST;
        let mut offset = 0;
        let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack character list");

        assert!(matches!(msg, GameMessage::CharacterList(_)));
        assert_pack_unpack_parity(data, &msg);
    }

    #[test]
    fn test_character_enter_world_request_fixture() {
        let data = test_fixtures::CHARACTER_ENTER_WORLD_REQUEST;
        let mut offset = 0;
        let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack enter world req");

        assert!(matches!(msg, GameMessage::CharacterEnterWorldRequest(_)));
        assert_pack_unpack_parity(data, &msg);
    }

    #[test]
    fn test_character_enter_world_fixture() {
        let data = test_fixtures::CHARACTER_ENTER_WORLD;
        let mut offset = 0;
        let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack enter world");

        assert!(matches!(msg, GameMessage::CharacterEnterWorld(_)));
        assert_pack_unpack_parity(data, &msg);
    }

    #[test]
    fn test_server_name_parity() {
        let expected = ServerNameData {
            current_connections: 123,
            max_connections: 1000,
            name: "Frostfell".to_string(),
        };
        let mut buf = Vec::new();
        expected.pack(&mut buf);
        assert_pack_unpack_parity(&buf, &expected);
    }

    #[test]
    fn test_gamemessage_routing_character_request() {
        use crate::messages::game_message::GameMessage;
        let packed = vec![0xC8, 0xF7, 0x00, 0x00, 0x12, 0x34, 0x56, 0x78];
        let mut offset = 0;
        let unpacked = GameMessage::unpack(&packed, &mut offset).expect("Routing failed");
        assert!(matches!(
            unpacked,
            GameMessage::CharacterEnterWorldRequest(_)
        ));
    }
}
