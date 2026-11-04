//! Localized string tables (0x23), following ACE.DatLoader/FileTypes/StringTable.cs.

use crate::utils::{read_compressed_u32, read_unicode_string};
use crate::{EOR_LANGUAGE_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::{BinRead, BinResult};
use std::io::{Read, Seek, SeekFrom};

/// One hash-addressed localized entry and its retained formatting metadata.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StringTableData {
    /// Retail string hash used to address this entry.
    pub id: u32,
    /// Authored substitution-variable names.
    pub variable_names: Vec<String>,
    /// Authored substitution-variable values.
    pub variables: Vec<String>,
    /// Localized variants; retail character titles use the first value.
    pub strings: Vec<String>,
    /// Authored comment identifiers retained losslessly.
    pub comments: Vec<u32>,
    /// Authored trailing byte whose interpretation remains unknown.
    pub unknown: u8,
}

/// A language-DAT string table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StringTable {
    /// Embedded resource identity.
    pub id: u32,
    /// Authored language identifier (`1` in the English DAT).
    pub language: u32,
    /// Authored header byte whose interpretation remains unknown.
    pub unknown: u8,
    /// Hash-addressed localized entries in authored order.
    pub entries: Vec<StringTableData>,
}

impl StringTable {
    /// Character-title localization table consumed by retail inspection.
    pub const FILE_ID: u32 = 0x2300_000E;
}

impl StaticResourceKey for StringTable {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(EOR_LANGUAGE_NAMESPACE, Self::FILE_ID);
}

impl BinRead for StringTable {
    type Args<'a> = ();

    fn read_options<R: Read + Seek>(
        reader: &mut R,
        _endian: binrw::Endian,
        _args: Self::Args<'_>,
    ) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        let language = u32::read_le(reader)?;
        let unknown = u8::read(reader)?;
        let count_position = reader.stream_position()?;
        let count = read_compressed_u32(reader)?;
        ensure_count_fits(reader, count_position, count, 17, "string table")?;

        let mut entries = Vec::with_capacity(count as usize);
        for _ in 0..count {
            entries.push(read_entry(reader)?);
        }

        Ok(Self {
            id,
            language,
            unknown,
            entries,
        })
    }
}

fn read_entry<R: Read + Seek>(reader: &mut R) -> BinResult<StringTableData> {
    let id = u32::read_le(reader)?;
    let variable_names = read_u16_string_vec(reader, "variable-name")?;
    let variables = read_u16_string_vec(reader, "variable")?;

    let string_count_position = reader.stream_position()?;
    let string_count = u32::read_le(reader)?;
    ensure_count_fits(
        reader,
        string_count_position,
        string_count,
        1,
        "localized string",
    )?;
    let mut strings = Vec::with_capacity(string_count as usize);
    for _ in 0..string_count {
        strings.push(read_unicode_string(reader)?);
    }

    let comment_count_position = reader.stream_position()?;
    let comment_count = u32::read_le(reader)?;
    ensure_count_fits(reader, comment_count_position, comment_count, 4, "comment")?;
    let mut comments = Vec::with_capacity(comment_count as usize);
    for _ in 0..comment_count {
        comments.push(u32::read_le(reader)?);
    }

    Ok(StringTableData {
        id,
        variable_names,
        variables,
        strings,
        comments,
        unknown: u8::read(reader)?,
    })
}

fn read_u16_string_vec<R: Read + Seek>(reader: &mut R, label: &str) -> BinResult<Vec<String>> {
    let count_position = reader.stream_position()?;
    let count = u32::from(u16::read_le(reader)?);
    ensure_count_fits(reader, count_position, count, 1, label)?;
    let mut values = Vec::with_capacity(count as usize);
    for _ in 0..count {
        values.push(read_unicode_string(reader)?);
    }
    Ok(values)
}

fn ensure_count_fits<R: Read + Seek>(
    reader: &mut R,
    count_position: u64,
    count: u32,
    minimum_item_bytes: u64,
    label: &str,
) -> BinResult<()> {
    let position = reader.stream_position()?;
    let end = reader.seek(SeekFrom::End(0))?;
    reader.seek(SeekFrom::Start(position))?;
    if u64::from(count) > end.saturating_sub(position) / minimum_item_bytes {
        return Err(binrw::Error::AssertFail {
            pos: count_position,
            message: format!("{label} count exceeds remaining record bytes"),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::write_compressed_u32;
    use binrw::BinWrite;
    use std::io::Cursor;

    fn unicode(out: &mut Cursor<Vec<u8>>, value: &str) {
        let units = value.encode_utf16().collect::<Vec<_>>();
        write_compressed_u32(out, units.len() as u32).unwrap();
        for unit in units {
            unit.write_le(out).unwrap();
        }
    }

    fn fixture() -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        StringTable::FILE_ID.write_le(&mut out).unwrap();
        1u32.write_le(&mut out).unwrap();
        7u8.write(&mut out).unwrap();
        write_compressed_u32(&mut out, 1).unwrap();
        0x1234_5678u32.write_le(&mut out).unwrap();
        1u16.write_le(&mut out).unwrap();
        unicode(&mut out, "target");
        1u16.write_le(&mut out).unwrap();
        unicode(&mut out, "value");
        2u32.write_le(&mut out).unwrap();
        unicode(&mut out, "Caf\u{e9}");
        unicode(&mut out, "\u{1f600}");
        1u32.write_le(&mut out).unwrap();
        99u32.write_le(&mut out).unwrap();
        3u8.write(&mut out).unwrap();
        out.into_inner()
    }

    #[test]
    fn decodes_localized_entries_and_retains_metadata() {
        let table = StringTable::read_le(&mut Cursor::new(fixture())).unwrap();

        assert_eq!(table.id, StringTable::FILE_ID);
        assert_eq!(table.language, 1);
        assert_eq!(table.unknown, 7);
        assert_eq!(table.entries[0].id, 0x1234_5678);
        assert_eq!(table.entries[0].variable_names, ["target"]);
        assert_eq!(table.entries[0].variables, ["value"]);
        assert_eq!(table.entries[0].strings, ["Caf\u{e9}", "\u{1f600}"]);
        assert_eq!(table.entries[0].comments, [99]);
        assert_eq!(table.entries[0].unknown, 3);
    }

    #[test]
    fn rejects_truncated_and_invalid_utf16_strings() {
        let bytes = fixture();
        assert!(StringTable::read_le(&mut Cursor::new(&bytes[..bytes.len() - 1])).is_err());

        let mut invalid = Cursor::new(Vec::new());
        StringTable::FILE_ID.write_le(&mut invalid).unwrap();
        1u32.write_le(&mut invalid).unwrap();
        0u8.write(&mut invalid).unwrap();
        write_compressed_u32(&mut invalid, 1).unwrap();
        1u32.write_le(&mut invalid).unwrap();
        0u16.write_le(&mut invalid).unwrap();
        0u16.write_le(&mut invalid).unwrap();
        1u32.write_le(&mut invalid).unwrap();
        write_compressed_u32(&mut invalid, 1).unwrap();
        0xD800u16.write_le(&mut invalid).unwrap();
        0u32.write_le(&mut invalid).unwrap();
        0u8.write(&mut invalid).unwrap();
        assert!(
            StringTable::read_le(&mut Cursor::new(invalid.into_inner()))
                .unwrap_err()
                .to_string()
                .contains("invalid UTF-16")
        );
    }
}
