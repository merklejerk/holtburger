//! Enum-to-string tables (0x22), following ACE.DatLoader/FileTypes/EnumMapper.cs.

use crate::utils::{read_compressed_u32, read_pstring};
use crate::{EOR_PORTAL_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::{BinRead, BinResult};
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};

/// A portal enum mapper with its authored numbering metadata and sparse identifiers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnumMapper {
    /// Embedded resource identity.
    pub id: u32,
    /// Optional mapper inherited by the retail resource.
    pub base_enum_map: u32,
    /// Authored NumberingType byte; lookup preserves the explicit keys regardless of its value.
    pub numbering: u8,
    /// Numeric enum value to its authored symbolic token.
    pub entries: BTreeMap<u32, String>,
}

impl EnumMapper {
    /// Character-title enum mapper consumed by retail title localization.
    pub const FILE_ID: u32 = 0x2200_0041;
}

impl StaticResourceKey for EnumMapper {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(EOR_PORTAL_NAMESPACE, Self::FILE_ID);
}

impl BinRead for EnumMapper {
    type Args<'a> = ();

    fn read_options<R: Read + Seek>(
        reader: &mut R,
        _endian: binrw::Endian,
        _args: Self::Args<'_>,
    ) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let base_enum_map = u32::read_le(reader)?;
        let numbering = u8::read(reader)?;
        let count_position = reader.stream_position()?;
        let count = read_compressed_u32(reader)?;
        let entries_position = reader.stream_position()?;
        let end = reader.seek(SeekFrom::End(0))?;
        reader.seek(SeekFrom::Start(entries_position))?;
        // Every entry needs a u32 key and at least the one-byte PString length.
        if u64::from(count) > end.saturating_sub(entries_position) / 5 {
            return Err(binrw::Error::AssertFail {
                pos: count_position,
                message: "enum mapper count exceeds remaining record bytes".to_string(),
            });
        }

        let mut entries = BTreeMap::new();
        for _ in 0..count {
            let entry_position = reader.stream_position()?;
            let key = u32::read_le(reader)?;
            let token = read_pstring(reader, 1)?;
            if entries.insert(key, token).is_some() {
                return Err(binrw::Error::AssertFail {
                    pos: entry_position,
                    message: format!("enum mapper contains duplicate key {key}"),
                });
            }
        }

        Ok(Self {
            id,
            base_enum_map,
            numbering,
            entries,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::write_compressed_u32;
    use binrw::BinWrite;
    use std::io::Cursor;

    fn fixture(entries: &[(u32, &[u8])]) -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        EnumMapper::FILE_ID.write_le(&mut out).unwrap();
        0x2200_0001u32.write_le(&mut out).unwrap();
        2u8.write(&mut out).unwrap();
        write_compressed_u32(&mut out, entries.len() as u32).unwrap();
        for (key, token) in entries {
            key.write_le(&mut out).unwrap();
            (token.len() as u8).write(&mut out).unwrap();
            out.get_mut().extend_from_slice(token);
            out.set_position(out.get_ref().len() as u64);
        }
        out.into_inner()
    }

    #[test]
    fn decodes_sparse_title_tokens_and_metadata() {
        let mapper = EnumMapper::read_le(&mut Cursor::new(fixture(&[
            (1, b"Adventurer"),
            (42, b"GemSeller"),
        ])))
        .unwrap();

        assert_eq!(mapper.id, EnumMapper::FILE_ID);
        assert_eq!(mapper.base_enum_map, 0x2200_0001);
        assert_eq!(mapper.numbering, 2);
        assert_eq!(mapper.entries[&42], "GemSeller");
    }

    #[test]
    fn rejects_duplicates_and_impossible_counts() {
        let duplicate = fixture(&[(1, b"First"), (1, b"Second")]);
        assert!(
            EnumMapper::read_le(&mut Cursor::new(duplicate))
                .unwrap_err()
                .to_string()
                .contains("duplicate key")
        );

        let mut impossible = fixture(&[]);
        *impossible.last_mut().unwrap() = 100;
        assert!(
            EnumMapper::read_le(&mut Cursor::new(impossible))
                .unwrap_err()
                .to_string()
                .contains("count exceeds")
        );
    }
}
