use crate::utils::{align_boundary, read_pstring};
use crate::{EOR_PORTAL_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::{BinRead, BinResult};
use std::collections::HashMap;
use std::io::{Read, Seek};

/// Chat pose table from client_portal.dat (file 0x0E000007).
#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct ChatPoseTable {
    pub id: u32,
    #[br(parse_with = parse_chat_pose_hash)]
    pub chat_pose_hash: HashMap<String, String>,
    #[br(parse_with = parse_chat_emote_hash)]
    pub chat_emote_hash: HashMap<String, ChatEmoteData>,
}

impl ChatPoseTable {
    pub const FILE_ID: u32 = 0x0E00_0007;
}

impl Default for ChatPoseTable {
    fn default() -> Self {
        Self {
            id: Self::FILE_ID,
            chat_pose_hash: HashMap::new(),
            chat_emote_hash: HashMap::new(),
        }
    }
}

impl StaticResourceKey for ChatPoseTable {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(EOR_PORTAL_NAMESPACE, Self::FILE_ID);
}

#[derive(BinRead, Debug, Clone, PartialEq, Eq)]
#[br(little)]
pub struct ChatEmoteData {
    #[br(parse_with = parse_pstring_aligned)]
    pub my_emote: String,
    #[br(parse_with = parse_pstring_aligned)]
    pub other_emote: String,
}

fn parse_chat_pose_hash<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<HashMap<String, String>> {
    parse_string_map(reader)
}

fn parse_chat_emote_hash<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<HashMap<String, ChatEmoteData>> {
    let count = u16::read_le(reader)?;
    let _bucket_size = u16::read_le(reader)?;

    let mut map = HashMap::with_capacity(count as usize);
    for _ in 0..count {
        let key = parse_pstring_aligned(reader, binrw::Endian::Little, ())?;
        let value = ChatEmoteData::read(reader)?;
        map.insert(key, value);
    }

    Ok(map)
}

fn parse_string_map<R: Read + Seek>(reader: &mut R) -> BinResult<HashMap<String, String>> {
    let count = u16::read_le(reader)?;
    let _bucket_size = u16::read_le(reader)?;

    let mut map = HashMap::with_capacity(count as usize);
    for _ in 0..count {
        let key = parse_pstring_aligned(reader, binrw::Endian::Little, ())?;
        let value = parse_pstring_aligned(reader, binrw::Endian::Little, ())?;
        map.insert(key, value);
    }

    Ok(map)
}

fn parse_pstring_aligned<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<String> {
    let value = read_pstring(reader, 2)?;
    align_boundary(reader, 4)?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn push_pstring_aligned(buf: &mut Vec<u8>, value: &str) {
        let bytes = value.as_bytes();
        buf.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
        buf.extend_from_slice(bytes);

        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }
    }

    #[test]
    fn test_parse_chat_pose_table_minimal() {
        let mut data = Vec::new();
        data.extend_from_slice(&ChatPoseTable::FILE_ID.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());

        let mut cursor = Cursor::new(data);
        let table = ChatPoseTable::read(&mut cursor).unwrap();

        assert_eq!(table.id, ChatPoseTable::FILE_ID);
        assert!(table.chat_pose_hash.is_empty());
        assert!(table.chat_emote_hash.is_empty());
    }

    #[test]
    fn test_parse_chat_pose_table_with_entries() {
        let mut data = Vec::new();
        data.extend_from_slice(&ChatPoseTable::FILE_ID.to_le_bytes());

        data.extend_from_slice(&1u16.to_le_bytes());
        data.extend_from_slice(&1u16.to_le_bytes());
        push_pstring_aligned(&mut data, "*wave*");
        push_pstring_aligned(&mut data, "Wave");

        data.extend_from_slice(&1u16.to_le_bytes());
        data.extend_from_slice(&1u16.to_le_bytes());
        push_pstring_aligned(&mut data, "Wave");
        push_pstring_aligned(&mut data, "You wave.");
        push_pstring_aligned(&mut data, "waves.");

        let mut cursor = Cursor::new(data);
        let table = ChatPoseTable::read(&mut cursor).unwrap();

        assert_eq!(table.id, ChatPoseTable::FILE_ID);
        assert_eq!(
            table.chat_pose_hash.get("*wave*"),
            Some(&"Wave".to_string())
        );

        let emote = table.chat_emote_hash.get("Wave").unwrap();
        assert_eq!(emote.my_emote, "You wave.");
        assert_eq!(emote.other_emote, "waves.");
    }
}
