use crate::utils::{align_boundary, read_pstring};
use binrw::{BinRead, BinResult};
use std::collections::HashMap;
use std::io::{Read, Seek};

/// Skill Table from client_portal.dat (file 0x0E000004).
#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SkillTable {
    pub id: u32,
    #[br(parse_with = parse_skill_hash_table)]
    pub skill_base_hash: HashMap<u32, SkillBase>,
}

impl SkillTable {
    pub const FILE_ID: u32 = 0x0E000004;
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SkillBase {
    #[br(parse_with = parse_description)]
    pub description: String,
    #[br(parse_with = parse_align)]
    pub _align1: (),
    #[br(parse_with = parse_description)]
    pub name: String,
    #[br(parse_with = parse_align)]
    pub _align2: (),
    pub icon_id: u32,
    pub trained_cost: i32,
    pub specialized_cost: i32,
    pub category: u32,
    pub chargen_use: u32,
    pub min_level: u32,
    pub formula: SkillFormula,
    pub upper_bound: f64,
    pub lower_bound: f64,
    pub learn_mod: f64,
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SkillFormula {
    pub w: u32,
    pub x: u32,
    pub y: u32,
    pub z: u32,
    pub attr1: u32,
    pub attr2: u32,
}

fn parse_description<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<String> {
    read_pstring(reader, 2)
}

fn parse_align<R: Read + Seek>(reader: &mut R, _endian: binrw::Endian, _args: ()) -> BinResult<()> {
    align_boundary(reader, 4)?;
    Ok(())
}

fn parse_skill_hash_table<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<HashMap<u32, SkillBase>> {
    let count = u16::read_le(reader)?;
    let _bucket_size = u16::read_le(reader)?;

    let mut map = HashMap::with_capacity(count as usize + 16);

    for _ in 0..count {
        let key = u32::read_le(reader)?;
        let value = SkillBase::read(reader)?;
        map.insert(key, value);
    }

    // Add retired skills manually, as ACE does. These are not in the modern portal.dat
    // and would otherwise return None for costs.
    let retired_skills = [
        (1, "Axe", 3),
        (2, "Bow", 2),
        (3, "Crossbow", 2),
        (4, "Dagger", 3),
        (5, "Mace", 3),
        (8, "Sling", 2),
        (9, "Spear", 3),
        (10, "Staff", 3),
        (11, "Sword", 3),
        (12, "Thrown Weapon", 2),
        (13, "Unarmed Combat", 3),
    ];

    for (id, name, divisor) in retired_skills {
        map.entry(id).or_insert_with(|| SkillBase {
            name: name.to_string(),
            description: format!("Retired skill: {}", name),
            _align1: (),
            _align2: (),
            icon_id: 0,
            trained_cost: 0, // Cannot be trained in modern AC
            specialized_cost: 0,
            category: 1, // Combat
            chargen_use: 1,
            min_level: 1,
            formula: SkillFormula {
                w: 0,
                x: 1,
                y: 1,
                z: divisor,
                attr1: 0,
                attr2: 0,
            },
            upper_bound: 0.0,
            lower_bound: 0.0,
            learn_mod: 0.0,
        });
    }

    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_parse_skill_table_with_alignment() {
        let mut data = Vec::new();
        // Record ID
        data.extend_from_slice(&0x0E000004u32.to_le_bytes());
        // Hash Table Header: count=1, bucket_size=1
        data.extend_from_slice(&1u16.to_le_bytes());
        data.extend_from_slice(&1u16.to_le_bytes());

        // Entry 1: Key=1
        data.extend_from_slice(&1u32.to_le_bytes());

        // SkillBase
        // Description: "Desc" (len 4)
        data.extend_from_slice(&4u16.to_le_bytes());
        data.extend_from_slice(b"Desc");
        // Padding to 4 bytes boundary from START of record/stream?
        // Let's assume absolute position relative to start of reader.
        // POS: 4(id) + 2(count) + 2(bucket) + 4(key) + 2(len) + 4(bytes) = 18 bytes.
        // Alignment to 4 bytes: 2 bytes padding.
        data.extend_from_slice(&[0, 0]);

        // Name: "Name" (len 4)
        data.extend_from_slice(&4u16.to_le_bytes());
        data.extend_from_slice(b"Name");
        // POS: 18 + 2(pad) + 2(len) + 4(bytes) = 26 bytes.
        // Alignment to 4 bytes: 2 bytes padding.
        data.extend_from_slice(&[0, 0]);

        // Remaining fields
        data.extend_from_slice(&100u32.to_le_bytes()); // icon_id
        data.extend_from_slice(&8i32.to_le_bytes()); // trained_cost
        data.extend_from_slice(&16i32.to_le_bytes()); // specialized_cost
        data.extend_from_slice(&1u32.to_le_bytes()); // category
        data.extend_from_slice(&1u32.to_le_bytes()); // chargen_use
        data.extend_from_slice(&1u32.to_le_bytes()); // min_level

        // Formula (6 u32s)
        for _ in 0..6 {
            data.extend_from_slice(&0u32.to_le_bytes());
        }

        // f64s
        data.extend_from_slice(&0.0f64.to_le_bytes()); // upper
        data.extend_from_slice(&0.0f64.to_le_bytes()); // lower
        data.extend_from_slice(&1.0f64.to_le_bytes()); // learn_mod

        let mut cursor = Cursor::new(data);
        let table = SkillTable::read(&mut cursor).unwrap();

        assert_eq!(table.id, SkillTable::FILE_ID);
        let skill = table.skill_base_hash.get(&1).unwrap();
        assert_eq!(skill.name, "Name");
        assert_eq!(skill.trained_cost, 8);

        // Check retired (manual injection)
        // Let's check sword (11)
        assert!(table.skill_base_hash.contains_key(&11));
    }
}
