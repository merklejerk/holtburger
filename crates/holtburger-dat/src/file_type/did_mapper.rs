//! Enum-to-DID tables (0x25), following ACE.DatLoader/FileTypes/DidMapper.cs.

use crate::utils::{read_compressed_u32, read_pstring};
use binrw::{BinRead, BinResult};
use std::{
    collections::BTreeMap,
    io::{Read, Seek, SeekFrom},
};

/// One authored enum map, retaining numbering metadata for format consumers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NumberedEnumMap<T> {
    /// Authored NumberingType byte; decoding does not reinterpret enum keys.
    pub numbering: u8,
    /// Explicit enum keys, which may be sparse or bit masks.
    pub entries: BTreeMap<u32, T>,
}

/// Lossless client/server enum maps and their descriptive names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DidMapper {
    /// Embedded resource identity.
    pub id: u32,
    /// Client enum-to-resource lookup used by UI artwork resolution.
    pub client_ids: NumberedEnumMap<u32>,
    /// Authored client enum names, independent of ID-map coverage.
    pub client_names: NumberedEnumMap<String>,
    /// Server enum-to-resource lookup retained for DAT consumers.
    pub server_ids: NumberedEnumMap<u32>,
    /// Authored server enum names, independent of ID-map coverage.
    pub server_names: NumberedEnumMap<String>,
}

impl DidMapper {
    /// Decode a bounded record without allocating from an untrusted count.
    pub fn unpack<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            id: u32::read_le(reader)?,
            client_ids: read_map(reader, 8, u32::read_le)?,
            client_names: read_map(reader, 5, |reader| read_pstring(reader, 1))?,
            server_ids: read_map(reader, 8, u32::read_le)?,
            server_names: read_map(reader, 5, |reader| read_pstring(reader, 1))?,
        })
    }
}

fn read_map<R: Read + Seek, T>(
    reader: &mut R,
    minimum_entry_bytes: u64,
    mut value: impl FnMut(&mut R) -> BinResult<T>,
) -> BinResult<NumberedEnumMap<T>> {
    let numbering = u8::read(reader)?;
    let count = read_compressed_u32(reader)?;
    let pos = reader.stream_position()?;
    let end = reader.seek(SeekFrom::End(0))?;
    reader.seek(SeekFrom::Start(pos))?;
    if u64::from(count) > end.saturating_sub(pos) / minimum_entry_bytes {
        return Err(binrw::Error::AssertFail {
            pos,
            message: "DID mapper count exceeds remaining record bytes".into(),
        });
    }
    let mut entries = BTreeMap::new();
    for _ in 0..count {
        let pos = reader.stream_position()?;
        let key = u32::read_le(reader)?;
        let item = value(reader)?;
        if entries.insert(key, item).is_some() {
            return Err(binrw::Error::AssertFail {
                pos,
                message: format!("DID mapper contains duplicate enum key {key:#010x}"),
            });
        }
    }
    Ok(NumberedEnumMap { numbering, entries })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::write_compressed_u32;
    use binrw::BinWrite;
    use std::io::Cursor;

    fn fixture() -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        0x25000000u32.write_le(&mut out).unwrap();
        1u8.write(&mut out).unwrap();
        // Exercise the two-byte compressed count and sparse keys.
        write_compressed_u32(&mut out, 128).unwrap();
        for key in 0..128u32 {
            (key * 3).write_le(&mut out).unwrap();
            (0x06000000 + key).write_le(&mut out).unwrap();
        }
        2u8.write(&mut out).unwrap();
        write_compressed_u32(&mut out, 1).unwrap();
        3u32.write_le(&mut out).unwrap();
        out.get_mut()
            .extend_from_slice(&[4, b'N', b'a', b'm', b'e']);
        // Appending directly does not advance Cursor position.
        out.set_position(out.get_ref().len() as u64);
        3u8.write(&mut out).unwrap();
        write_compressed_u32(&mut out, 1).unwrap();
        9u32.write_le(&mut out).unwrap();
        0x06001234u32.write_le(&mut out).unwrap();
        4u8.write(&mut out).unwrap();
        write_compressed_u32(&mut out, 0).unwrap();
        out.into_inner()
    }

    #[test]
    fn preserves_all_four_maps_and_numbering() {
        let parsed = DidMapper::unpack(&mut Cursor::new(fixture())).unwrap();
        assert_eq!(parsed.id, 0x25000000);
        assert_eq!(parsed.client_ids.numbering, 1);
        assert_eq!(parsed.client_ids.entries.len(), 128);
        assert_eq!(parsed.client_ids.entries[&381], 0x0600007f);
        assert_eq!(parsed.client_names.numbering, 2);
        assert_eq!(parsed.client_names.entries[&3], "Name");
        assert_eq!(parsed.server_ids.numbering, 3);
        assert_eq!(parsed.server_ids.entries[&9], 0x06001234);
        assert_eq!(parsed.server_names.numbering, 4);
        assert!(parsed.server_names.entries.is_empty());
    }

    #[test]
    fn rejects_truncated_records_and_impossible_counts() {
        let bytes = fixture();
        for end in [0, 5, 6, 10, bytes.len() - 1] {
            assert!(DidMapper::unpack(&mut Cursor::new(&bytes[..end])).is_err());
        }
        let mut bytes = Cursor::new(vec![0, 0, 0, 0, 0]);
        bytes.set_position(5);
        write_compressed_u32(&mut bytes, 0x3fffffff).unwrap();
        bytes.set_position(0);
        let error = DidMapper::unpack(&mut bytes).unwrap_err();
        assert!(error.to_string().contains("count exceeds"));
    }

    #[test]
    fn rejects_duplicate_keys() {
        let mut bytes = fixture();
        // First map starts after DID, numbering byte and two-byte count.
        bytes[15..19].copy_from_slice(&0u32.to_le_bytes());
        assert!(
            DidMapper::unpack(&mut Cursor::new(bytes))
                .unwrap_err()
                .to_string()
                .contains("duplicate enum key")
        );
    }
}
