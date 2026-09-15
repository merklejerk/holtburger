use crate::utils::align_boundary;
use crate::{EOR_PORTAL_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::{BinRead, BinResult};
use holtburger_common::legacy_hash::legacy_string_hash;
use std::collections::HashMap;
use std::io::{Read, Seek};

/// Spell Table from client_portal.dat (file 0x0E00000E).
#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SpellTable {
    pub id: u32,
    #[br(parse_with = parse_spell_hash_table)]
    pub spells: HashMap<u32, SpellBase>,
    #[br(parse_with = parse_spell_set_hash_table)]
    pub spell_sets: HashMap<u32, SpellSet>,
}

impl SpellTable {
    pub const FILE_ID: u32 = 0x0E00000E;
}

impl StaticResourceKey for SpellTable {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(EOR_PORTAL_NAMESPACE, Self::FILE_ID);
}

#[binrw::binread]
#[derive(Debug, Clone)]
#[br(little)]
pub struct SpellBase {
    #[br(temp, parse_with = parse_obfuscated)]
    name_bytes: Vec<u8>,
    #[br(calc = encoding_rs::WINDOWS_1252.decode(&name_bytes).0.into_owned())]
    pub name: String,
    #[br(parse_with = parse_align)]
    pub _align1: (),
    #[br(temp, parse_with = parse_obfuscated)]
    description_bytes: Vec<u8>,
    #[br(calc = encoding_rs::WINDOWS_1252.decode(&description_bytes).0.into_owned())]
    pub description: String,
    #[br(parse_with = parse_align)]
    pub _align2: (),
    pub school: u32,
    pub icon_id: u32,
    pub category: u32,
    pub bitfield: u32,
    pub base_mana: u32,
    pub base_range_constant: f32,
    pub base_range_mod: f32,
    pub power: u32,
    pub spell_economy_mod: f32,
    pub formula_version: u32,
    pub component_loss: f32,
    pub meta_spell_type: u32,
    pub meta_spell_id: u32,

    #[br(args(meta_spell_type))]
    pub extras: SpellExtras,

    /// Encoded slots retained for the spell-export diagnostic.
    pub raw_components: [u32; 8],
    /// Decoded component identities, preserving all eight authored slots.
    #[br(calc = decode_components(raw_components, &name_bytes, &description_bytes))]
    pub components: [u32; 8],

    pub caster_effect: u32,
    pub target_effect: u32,
    pub fizzle_effect: u32,
    pub recovery_interval: f64,
    pub recovery_amount: f32,
    pub display_order: u32,
    pub non_component_target_type: u32,
    pub mana_mod: u32,
}

impl Default for SpellBase {
    fn default() -> Self {
        Self {
            name: String::new(),
            _align1: (),
            description: String::new(),
            _align2: (),
            school: 0,
            icon_id: 0,
            category: 0,
            bitfield: 0,
            base_mana: 0,
            base_range_constant: 0.0,
            base_range_mod: 0.0,
            power: 0,
            spell_economy_mod: 0.0,
            formula_version: 0,
            component_loss: 0.0,
            meta_spell_type: 0,
            meta_spell_id: 0,
            extras: SpellExtras::None,
            raw_components: [0; 8],
            components: [0; 8],
            caster_effect: 0,
            target_effect: 0,
            fizzle_effect: 0,
            recovery_interval: 0.0,
            recovery_amount: 0.0,
            display_order: 0,
            non_component_target_type: 0,
            mana_mod: 0,
        }
    }
}

#[derive(BinRead, Debug, Clone)]
#[br(little, import(meta_spell_type: u32))]
pub enum SpellExtras {
    #[br(pre_assert(meta_spell_type == 1 || meta_spell_type == 12))]
    Enchantment {
        duration: f64,
        degrade_modifier: f32,
        degrade_limit: f32,
    },
    #[br(pre_assert(meta_spell_type == 7))]
    PortalSummon { portal_lifetime: f64 },
    #[br(pre_assert(meta_spell_type != 1 && meta_spell_type != 12 && meta_spell_type != 7))]
    None,
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SpellSet {
    #[br(parse_with = parse_spell_set_tiers_hash_table)]
    pub tiers: HashMap<u32, SpellSetTiers>,
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SpellSetTiers {
    pub spell_count: i32,
    #[br(count = spell_count)]
    pub spells: Vec<u32>,
}

pub(super) fn parse_obfuscated<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<Vec<u8>> {
    let length = u16::read_le(reader)?;
    let mut bytes = vec![0; usize::from(length)];
    reader.read_exact(&mut bytes)?;
    for byte in &mut bytes {
        *byte = byte.rotate_left(4);
    }
    Ok(bytes)
}

/// acclient.c:429170 and :465015: zero slots remain zero, subtraction wraps.
fn decode_components(raw: [u32; 8], name: &[u8], description: &[u8]) -> [u32; 8] {
    let key = (legacy_string_hash(name) % 0x12107680)
        .wrapping_add(legacy_string_hash(description) % 0xbeadcf45);
    raw.map(|component| {
        if component == 0 {
            0
        } else {
            component.wrapping_sub(key)
        }
    })
}

/// Formula component tier used by static spell reference consumers (acclient.c:465529).
/// Unknown components retain retail's zero result; callers diagnose absent mappings.
pub fn component_power_tier(component: u32) -> u32 {
    match component {
        1..=6 => component,
        110 => 7,
        112 => 8,
        192 => 9,
        193 => 10,
        _ => 0,
    }
}

fn parse_align<R: Read + Seek>(reader: &mut R, _endian: binrw::Endian, _args: ()) -> BinResult<()> {
    align_boundary(reader, 4)?;
    Ok(())
}

fn parse_spell_hash_table<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<HashMap<u32, SpellBase>> {
    let count = u16::read_le(reader)?;
    let _bucket_size = u16::read_le(reader)?;

    let mut map = HashMap::with_capacity(count as usize);

    for _ in 0..count {
        let key = u32::read_le(reader)?;
        let value = SpellBase::read(reader)?;
        map.insert(key, value);
    }

    Ok(map)
}

fn parse_spell_set_hash_table<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<HashMap<u32, SpellSet>> {
    let count = u16::read_le(reader)?;
    let _bucket_size = u16::read_le(reader)?;

    let mut map = HashMap::with_capacity(count as usize);

    for _ in 0..count {
        let key = u32::read_le(reader)?;
        let value = SpellSet::read(reader)?;
        map.insert(key, value);
    }

    Ok(map)
}

fn parse_spell_set_tiers_hash_table<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<HashMap<u32, SpellSetTiers>> {
    let count = u16::read_le(reader)?;
    let _bucket_size = u16::read_le(reader)?;

    let mut map = HashMap::with_capacity(count as usize);

    for _ in 0..count {
        let key = u32::read_le(reader)?;
        let value = SpellSetTiers::read(reader)?;
        map.insert(key, value);
    }

    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn decoding_preserves_slots_and_wraps_without_corrective_masking() {
        assert_eq!(
            decode_components([66, 0, 175, 177, 257, 258, 1, 0], b"A", b""),
            [1, 0, 110, 112, 192, 193, u32::MAX - 63, 0]
        );
    }

    #[test]
    fn parsed_formula_uses_original_extended_character_bytes() {
        let mut bytes = Vec::new();
        for text in [&[b'A', 0x92][..], &[][..]] {
            bytes.extend_from_slice(&(text.len() as u16).to_le_bytes());
            bytes.extend(text.iter().map(|byte| byte.rotate_left(4)));
            while bytes.len() % 4 != 0 {
                bytes.push(0);
            }
        }
        bytes.extend_from_slice(&[0; 13 * 4]);
        let raw = [931u32, 0, 1040, 1042, 1122, 1123, 0, 0];
        for slot in raw {
            bytes.extend_from_slice(&slot.to_le_bytes());
        }
        bytes.extend_from_slice(&[0; 3 * 4 + 2 * 8 + 3 * 4]);
        let spell = SpellBase::read(&mut Cursor::new(bytes)).unwrap();
        assert_eq!(spell.name, "A’");
        assert_eq!(spell.raw_components, raw);
        assert_eq!(spell.components, [1, 0, 110, 112, 192, 193, 0, 0]);
    }

    #[test]
    fn component_tiers_preserve_all_retail_cases() {
        for tier in 1..=6 {
            assert_eq!(component_power_tier(tier), tier);
        }
        for (component, tier) in [(110, 7), (112, 8), (192, 9), (193, 10), (0, 0), (999, 0)] {
            assert_eq!(component_power_tier(component), tier);
        }
    }

    #[test]
    fn test_parse_spell_table_minimal() {
        let mut data = Vec::new();
        // ID
        data.extend_from_slice(&0x0E00000Eu32.to_le_bytes());

        // Spells Hash Table Header: count=0, bucket_size=0
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());

        // SpellSets Hash Table Header: count=0, bucket_size=0
        data.extend_from_slice(&0u16.to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());

        let mut cursor = Cursor::new(data);
        let table = SpellTable::read(&mut cursor).unwrap();
        assert_eq!(table.id, SpellTable::FILE_ID);
        assert!(table.spells.is_empty());
    }

    #[test]
    fn test_obfuscated_decode() {
        // Name "Test" (len 4)
        // 'T' = 0x54 -> swap -> 0x45
        // 'e' = 0x65 -> swap -> 0x56
        // 's' = 0x73 -> swap -> 0x37
        // 't' = 0x74 -> swap -> 0x47
        let raw = vec![0x45, 0x56, 0x37, 0x47];
        let mut data = Vec::new();
        data.extend_from_slice(&4u16.to_le_bytes());
        data.extend_from_slice(&raw);

        let mut cursor = Cursor::new(data);
        let decoded = crate::utils::read_obfuscated_string(&mut cursor).unwrap();
        assert_eq!(decoded, "Test");
    }
}
