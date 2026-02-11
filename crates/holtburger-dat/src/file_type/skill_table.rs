use binrw::{BinRead, BinResult};
use std::collections::HashMap;
use std::io::{Read, Seek};
use crate::utils::{read_pstring, align_boundary};

/// Skill Table from client_portal.dat (file 0x0E000004).
#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SkillTable {
    pub id: u32,
    #[br(parse_with = parse_skill_hash_table)]
    pub skill_base_hash: HashMap<u32, SkillBase>,
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
    pub upper_bound: u32,
    pub st_type: u32,
    pub group_id: u32,
}

#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SkillFormula {
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

fn parse_align<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<()> {
    align_boundary(reader, 4)?;
    Ok(())
}

fn parse_skill_hash_table<R: Read + Seek>(
    reader: &mut R,
    _endian: binrw::Endian,
    _args: (),
) -> BinResult<HashMap<u32, SkillBase>> {
    let count = u32::read_le(reader)?;
    let mut map = HashMap::with_capacity(count as usize);

    for _ in 0..count {
        let key = u32::read_le(reader)?;
        let value = SkillBase::read(reader)?;
        map.insert(key, value);
    }

    Ok(map)
}
