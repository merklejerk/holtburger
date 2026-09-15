//! Spell component definitions from portal table 0x0E00000F.

use super::spell_table::parse_obfuscated;
use crate::{EOR_PORTAL_NAMESPACE, ResourceKey, StaticResourceKey, utils::align_boundary};
use binrw::{BinRead, BinResult};
use std::{
    collections::HashMap,
    io::{Read, Seek},
};

/// Authored component names, graphics and casting metadata, keyed by component ID.
#[derive(Debug, Clone)]
pub struct SpellComponentsTable {
    /// Identity of the decoded table.
    pub id: u32,
    /// Component IDs are distinct from inventory object and class identities.
    pub components: HashMap<u32, SpellComponent>,
}

impl SpellComponentsTable {
    pub const FILE_ID: u32 = 0x0E00_000F;
}
impl StaticResourceKey for SpellComponentsTable {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(EOR_PORTAL_NAMESPACE, Self::FILE_ID);
}

/// Lossless authored record; presentation consumers select the fields they need.
#[binrw::binread]
#[derive(Debug, Clone)]
#[br(little)]
pub struct SpellComponent {
    #[br(temp, parse_with = parse_obfuscated)]
    name_bytes: Vec<u8>,
    /// Decoded Windows-1252 display name.
    #[br(calc = encoding_rs::WINDOWS_1252.decode(&name_bytes).0.into_owned())]
    pub name: String,
    #[br(temp, parse_with = aligned)]
    _name_alignment: (),
    /// Authored component category.
    pub category: u32,
    /// Component RenderSurface identity.
    pub icon: u32,
    /// Authored component type (scarab, herb, powder, and so on).
    pub component_type: u32,
    /// Casting gesture identity.
    pub gesture: u32,
    /// Authored gesture time.
    pub time: f32,
    #[br(temp, parse_with = parse_obfuscated)]
    text_bytes: Vec<u8>,
    /// Component's spoken syllable.
    #[br(calc = encoding_rs::WINDOWS_1252.decode(&text_bytes).0.into_owned())]
    pub text: String,
    #[br(temp, parse_with = aligned)]
    _text_alignment: (),
    /// Authored CDM value; its interpretation is not established.
    pub cdm: f32,
}

fn aligned<R: Read + Seek>(reader: &mut R, _: binrw::Endian, _: ()) -> BinResult<()> {
    align_boundary(reader, 4)?;
    Ok(())
}

impl BinRead for SpellComponentsTable {
    type Args<'a> = ();
    fn read_options<R: Read + Seek>(reader: &mut R, _: binrw::Endian, _: ()) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        if id != Self::FILE_ID {
            return Err(binrw::Error::AssertFail {
                pos: reader.stream_position()? - 4,
                message: format!("Expected spell component table, found {id:#010x}"),
            });
        }
        let count = u16::read_le(reader)?;
        align_boundary(reader, 4)?;
        let mut components = HashMap::with_capacity(usize::from(count));
        for _ in 0..count {
            let key = u32::read_le(reader)?;
            let value = SpellComponent::read_le(reader)?;
            if components.insert(key, value).is_some() {
                return Err(binrw::Error::AssertFail {
                    pos: reader.stream_position()?,
                    message: format!("Duplicate spell component ID {key}"),
                });
            }
        }
        Ok(Self { id, components })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn text(bytes: &mut Vec<u8>, value: &[u8]) {
        bytes.extend_from_slice(&(value.len() as u16).to_le_bytes());
        bytes.extend(value.iter().map(|b| b.rotate_left(4)));
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
    }
    fn fixture(ids: &[u32]) -> Vec<u8> {
        let mut bytes = SpellComponentsTable::FILE_ID.to_le_bytes().to_vec();
        bytes.extend_from_slice(&(ids.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&[0, 0]);
        for id in ids {
            bytes.extend_from_slice(&id.to_le_bytes());
            text(&mut bytes, b"Caf\xe9");
            for value in [1u32, 0x06000001, 2, 3] {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
            bytes.extend_from_slice(&1.5f32.to_le_bytes());
            text(&mut bytes, b"Word");
            bytes.extend_from_slice(&2.5f32.to_le_bytes());
        }
        bytes
    }
    #[test]
    fn decodes_aligned_extended_text_and_preserves_casting_metadata() {
        let table = SpellComponentsTable::read_le(&mut Cursor::new(fixture(&[1]))).unwrap();
        let component = &table.components[&1];
        assert_eq!(component.name, "Café");
        assert_eq!(component.text, "Word");
        assert_eq!(
            (
                component.category,
                component.icon,
                component.component_type,
                component.gesture
            ),
            (1, 0x06000001, 2, 3)
        );
        assert_eq!((component.time, component.cdm), (1.5, 2.5));
    }
    #[test]
    fn rejects_duplicate_truncated_and_wrong_table_records() {
        assert!(SpellComponentsTable::read_le(&mut Cursor::new(fixture(&[1, 1]))).is_err());
        let bytes = fixture(&[1]);
        for end in [0, 4, 8, bytes.len() - 1] {
            assert!(SpellComponentsTable::read_le(&mut Cursor::new(&bytes[..end])).is_err());
        }
        let mut bytes = bytes;
        bytes[0] = 0;
        assert!(SpellComponentsTable::read_le(&mut Cursor::new(bytes)).is_err());
    }
}
