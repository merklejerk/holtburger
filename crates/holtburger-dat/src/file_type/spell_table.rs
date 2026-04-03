use crate::utils::{align_boundary, read_obfuscated_string};
use crate::{EOR_PORTAL_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::{BinRead, BinResult};
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

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SpellBase {
    #[br(parse_with = parse_obfuscated)]
    pub name: String,
    #[br(parse_with = parse_align)]
    pub _align1: (),
    #[br(parse_with = parse_obfuscated)]
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

    #[br(count = 8)]
    pub raw_components: Vec<u32>,

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
            raw_components: vec![0; 8],
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

fn parse_obfuscated<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<String> {
    read_obfuscated_string(reader)
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
