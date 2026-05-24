use crate::Result;
use crate::utils::{align_boundary, read_pstring};
use binrw::{BinRead, io::Cursor};
use std::io::{Read, Seek};

pub const REGION_DESC_FILE_ID: u32 = 0x1300_0000;

#[derive(Debug, Clone)]
pub struct RegionDesc {
    pub id: u32,
    pub region_number: u32,
    pub version: u32,
    pub region_name: String,
    pub scene_info: SceneDesc,
    pub terrain_info: TerrainDesc,
}

impl RegionDesc {
    pub fn unpack(data: &[u8]) -> Result<Self> {
        let mut reader = Cursor::new(data);
        let id = u32::read_le(&mut reader)?;
        let region_number = u32::read_le(&mut reader)?;
        let version = u32::read_le(&mut reader)?;
        let region_name = read_aligned_pstring(&mut reader)?;

        skip_land_defs(&mut reader)?;
        skip_game_time(&mut reader)?;

        let parts_mask = u32::read_le(&mut reader)?;
        if (parts_mask & 0x10) != 0 {
            skip_sky_desc(&mut reader)?;
        }
        if (parts_mask & 0x01) != 0 {
            skip_sound_desc(&mut reader)?;
        }

        let scene_info = if (parts_mask & 0x02) != 0 {
            read_scene_desc(&mut reader)?
        } else {
            SceneDesc::default()
        };
        let terrain_info = read_terrain_desc(&mut reader)?;

        Ok(Self {
            id,
            region_number,
            version,
            region_name,
            scene_info,
            terrain_info,
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct SceneDesc {
    pub scene_types: Vec<SceneType>,
}

#[derive(Debug, Clone)]
pub struct SceneType {
    pub stb_index: u32,
    pub scenes: Vec<u32>,
}

#[derive(Debug, Clone, Default)]
pub struct TerrainDesc {
    pub terrain_types: Vec<TerrainType>,
    pub land_surfaces: LandSurf,
}

#[derive(Debug, Clone)]
pub struct TerrainType {
    pub name: String,
    pub color: u32,
    pub scene_types: Vec<u32>,
}

#[derive(Debug, Clone, Default)]
pub struct LandSurf {
    pub tex_merge: TexMerge,
}

#[derive(Debug, Clone, Default)]
pub struct TexMerge {
    pub base_tex_size: u32,
    pub corner_terrain_maps: Vec<TerrainAlphaMap>,
    pub side_terrain_maps: Vec<TerrainAlphaMap>,
    pub road_maps: Vec<RoadAlphaMap>,
    pub terrain_desc: Vec<TMTerrainDesc>,
}

#[derive(Debug, Clone)]
pub struct TerrainAlphaMap {
    pub terrain_code: u32,
    pub tex_gid: u32,
}

#[derive(Debug, Clone)]
pub struct RoadAlphaMap {
    pub road_code: u32,
    pub road_tex_gid: u32,
}

#[derive(Debug, Clone)]
pub struct TMTerrainDesc {
    pub terrain_type: u32,
    pub terrain_tex: TerrainTex,
}

#[derive(Debug, Clone)]
pub struct TerrainTex {
    pub tex_gid: u32,
    pub tex_tiling: u32,
    pub max_vert_bright: u32,
    pub min_vert_bright: u32,
    pub max_vert_saturate: u32,
    pub min_vert_saturate: u32,
    pub max_vert_hue: u32,
    pub min_vert_hue: u32,
    pub detail_tex_tiling: u32,
    pub detail_tex_gid: u32,
}

fn read_scene_desc<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<SceneDesc> {
    let scene_type_count = u32::read_le(reader)? as usize;
    let mut scene_types = Vec::with_capacity(scene_type_count);
    for _ in 0..scene_type_count {
        let stb_index = u32::read_le(reader)?;
        scene_types.push(SceneType {
            stb_index,
            scenes: read_u32_list(reader)?,
        });
    }
    Ok(SceneDesc { scene_types })
}

fn read_terrain_desc<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<TerrainDesc> {
    let terrain_type_count = u32::read_le(reader)? as usize;
    let mut terrain_types = Vec::with_capacity(terrain_type_count);
    for _ in 0..terrain_type_count {
        terrain_types.push(TerrainType {
            name: read_aligned_pstring(reader)?,
            color: u32::read_le(reader)?,
            scene_types: read_u32_list(reader)?,
        });
    }

    let land_surfaces = read_land_surf(reader)?;
    Ok(TerrainDesc {
        terrain_types,
        land_surfaces,
    })
}

fn read_u32_list<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<Vec<u32>> {
    let count = i32::read_le(reader)?;
    if count < 0 {
        return Err(binrw::Error::AssertFail {
            pos: reader.stream_position()?,
            message: format!("negative list length {count}"),
        });
    }

    let mut values = Vec::with_capacity(count as usize);
    for _ in 0..count {
        values.push(u32::read_le(reader)?);
    }
    Ok(values)
}

fn read_aligned_pstring<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<String> {
    let value = read_pstring(reader, 2)?;
    align_boundary(reader, 4)?;
    Ok(value)
}

fn skip_land_defs<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_bytes(reader, 32 + 256 * 4)
}

fn skip_game_time<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_bytes(reader, 8 + 4 + 4 + 4)?;
    let _year_spec = read_aligned_pstring(reader)?;

    skip_unpackable_list(reader, skip_time_of_day)?;

    let weekday_count = u32::read_le(reader)?;
    for _ in 0..weekday_count {
        let _weekday = read_aligned_pstring(reader)?;
    }

    skip_unpackable_list(reader, skip_season)
}

fn skip_time_of_day<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_bytes(reader, 4 + 4)?;
    let _name = read_aligned_pstring(reader)?;
    Ok(())
}

fn skip_season<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_bytes(reader, 4)?;
    let _name = read_aligned_pstring(reader)?;
    Ok(())
}

fn skip_sky_desc<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_bytes(reader, 8 + 8)?;
    align_boundary(reader, 4)?;
    skip_unpackable_list(reader, skip_day_group)
}

fn skip_day_group<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_bytes(reader, 4)?;
    let _day_name = read_aligned_pstring(reader)?;
    skip_unpackable_list(reader, skip_sky_object)?;
    skip_unpackable_list(reader, skip_sky_time_of_day)
}

fn skip_sky_object<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_bytes(reader, 4 * 6 + 4 * 3)?;
    align_boundary(reader, 4)
}

fn skip_sky_time_of_day<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_bytes(reader, 4 * 11)?;
    align_boundary(reader, 4)?;
    skip_unpackable_list(reader, skip_sky_object_replace)
}

fn skip_sky_object_replace<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_bytes(reader, 4 + 4 + 4 * 4)?;
    align_boundary(reader, 4)
}

fn skip_sound_desc<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<()> {
    skip_unpackable_list(reader, |reader| {
        skip_bytes(reader, 4)?;
        skip_unpackable_list(reader, |reader| skip_bytes(reader, 4 + 4 * 4))
    })
}

fn read_land_surf<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<LandSurf> {
    let land_surf_type = u32::read_le(reader)?;
    if land_surf_type == 1 {
        return Err(binrw::Error::AssertFail {
            pos: reader.stream_position()?,
            message: "Region LandSurf palette-shift mode is not implemented".to_string(),
        });
    }

    Ok(LandSurf {
        tex_merge: TexMerge {
            base_tex_size: u32::read_le(reader)?,
            corner_terrain_maps: read_terrain_alpha_maps(reader)?,
            side_terrain_maps: read_terrain_alpha_maps(reader)?,
            road_maps: read_road_alpha_maps(reader)?,
            terrain_desc: read_tm_terrain_descs(reader)?,
        },
    })
}

fn read_terrain_alpha_maps<R: Read + Seek>(
    reader: &mut R,
) -> binrw::BinResult<Vec<TerrainAlphaMap>> {
    let count = u32::read_le(reader)? as usize;
    let mut maps = Vec::with_capacity(count);
    for _ in 0..count {
        maps.push(TerrainAlphaMap {
            terrain_code: u32::read_le(reader)?,
            tex_gid: u32::read_le(reader)?,
        });
    }
    Ok(maps)
}

fn read_road_alpha_maps<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<Vec<RoadAlphaMap>> {
    let count = u32::read_le(reader)? as usize;
    let mut maps = Vec::with_capacity(count);
    for _ in 0..count {
        maps.push(RoadAlphaMap {
            road_code: u32::read_le(reader)?,
            road_tex_gid: u32::read_le(reader)?,
        });
    }
    Ok(maps)
}

fn read_tm_terrain_descs<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<Vec<TMTerrainDesc>> {
    let count = u32::read_le(reader)? as usize;
    let mut descs = Vec::with_capacity(count);
    for _ in 0..count {
        descs.push(TMTerrainDesc {
            terrain_type: u32::read_le(reader)?,
            terrain_tex: read_terrain_tex(reader)?,
        });
    }
    Ok(descs)
}

fn read_terrain_tex<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<TerrainTex> {
    Ok(TerrainTex {
        tex_gid: u32::read_le(reader)?,
        tex_tiling: u32::read_le(reader)?,
        max_vert_bright: u32::read_le(reader)?,
        min_vert_bright: u32::read_le(reader)?,
        max_vert_saturate: u32::read_le(reader)?,
        min_vert_saturate: u32::read_le(reader)?,
        max_vert_hue: u32::read_le(reader)?,
        min_vert_hue: u32::read_le(reader)?,
        detail_tex_tiling: u32::read_le(reader)?,
        detail_tex_gid: u32::read_le(reader)?,
    })
}

fn skip_unpackable_list<R, F>(reader: &mut R, mut skip_item: F) -> binrw::BinResult<()>
where
    R: Read + Seek,
    F: FnMut(&mut R) -> binrw::BinResult<()>,
{
    let count = u32::read_le(reader)?;
    for _ in 0..count {
        skip_item(reader)?;
    }
    Ok(())
}

fn skip_bytes<R: Read + Seek>(reader: &mut R, byte_count: u64) -> binrw::BinResult<()> {
    let pos = reader.stream_position()?;
    let byte_count = i64::try_from(byte_count).map_err(|error| binrw::Error::Custom {
        pos,
        err: Box::new(error),
    })?;
    reader.seek(std::io::SeekFrom::Current(byte_count))?;
    Ok(())
}
