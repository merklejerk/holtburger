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
    pub land_defs: LandDefs,
    pub game_time: GameTime,
    /// Raw record-presence mask from the DAT. Retained for provenance, including payload-free bits.
    pub parts_mask: u32,
    pub sky_info: Option<SkyDesc>,
    pub sound_info: Option<SoundDesc>,
    pub scene_info: Option<SceneDesc>,
    pub terrain_info: Option<TerrainDesc>,
    pub region_misc: Option<RegionMisc>,
}

impl RegionDesc {
    pub fn unpack(data: &[u8]) -> Result<Self> {
        let mut reader = Cursor::new(data);
        let id = u32::read_le(&mut reader)?;
        let region_number = u32::read_le(&mut reader)?;
        let version = u32::read_le(&mut reader)?;
        let region_name = read_aligned_pstring(&mut reader)?;

        let land_defs = read_land_defs(&mut reader)?;
        let game_time = read_game_time(&mut reader)?;

        let parts_mask = u32::read_le(&mut reader)?;
        let sky_info = (parts_mask & 0x10 != 0)
            .then(|| read_sky_desc(&mut reader))
            .transpose()?;
        let sound_info = (parts_mask & 0x01 != 0)
            .then(|| read_sound_desc(&mut reader))
            .transpose()?;
        let scene_info = (parts_mask & 0x02 != 0)
            .then(|| read_scene_desc(&mut reader))
            .transpose()?;
        let terrain_info = (parts_mask & 0x04 != 0)
            .then(|| read_terrain_desc(&mut reader))
            .transpose()?;
        let region_misc = (parts_mask & 0x0200 != 0)
            .then(|| read_region_misc(&mut reader))
            .transpose()?;

        if reader.position() != data.len() as u64 {
            return Err(binrw::Error::AssertFail {
                pos: reader.position(),
                message: format!(
                    "RegionDesc has {} trailing bytes after declared PartsMask sections",
                    data.len() as u64 - reader.position()
                ),
            }
            .into());
        }

        Ok(Self {
            id,
            region_number,
            version,
            region_name,
            land_defs,
            game_time,
            parts_mask,
            sky_info,
            sound_info,
            scene_info,
            terrain_info,
            region_misc,
        })
    }
}

/// Region-wide land geometry and authored height lookup data.
#[derive(Debug, Clone)]
pub struct LandDefs {
    pub num_block_length: i32,
    pub num_block_width: i32,
    pub square_length: f32,
    pub lblock_length: i32,
    pub vertex_per_cell: i32,
    pub max_obj_height: f32,
    pub sky_height: f32,
    pub road_width: f32,
    /// A `CellLandblock` stores a byte index into this table, rather than a height value.
    pub land_height_table: [f32; 256],
}

#[derive(Debug, Clone)]
pub struct GameTime {
    pub zero_time_of_year: f64,
    pub zero_year: u32,
    pub day_length: f32,
    pub days_per_year: u32,
    pub year_spec: String,
    pub times_of_day: Vec<TimeOfDay>,
    pub days_of_the_week: Vec<String>,
    pub seasons: Vec<Season>,
}

#[derive(Debug, Clone)]
pub struct TimeOfDay {
    pub start: f32,
    pub is_night: bool,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct Season {
    pub start_date: u32,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct SkyDesc {
    pub tick_size: f64,
    pub light_tick_size: f64,
    pub day_groups: Vec<DayGroup>,
}

#[derive(Debug, Clone)]
pub struct DayGroup {
    pub chance_of_occur: f32,
    pub day_name: String,
    pub sky_objects: Vec<SkyObject>,
    pub sky_times: Vec<SkyTimeOfDay>,
}

#[derive(Debug, Clone)]
pub struct SkyObject {
    pub begin_time: f32,
    pub end_time: f32,
    pub begin_angle: f32,
    pub end_angle: f32,
    pub tex_velocity_x: f32,
    pub tex_velocity_y: f32,
    pub default_gfx_object_id: u32,
    pub default_pes_object_id: u32,
    pub properties: u32,
}

#[derive(Debug, Clone)]
pub struct SkyTimeOfDay {
    pub begin: f32,
    pub dir_bright: f32,
    pub dir_heading: f32,
    pub dir_pitch: f32,
    pub dir_color: u32,
    pub amb_bright: f32,
    pub amb_color: u32,
    pub min_world_fog: f32,
    pub max_world_fog: f32,
    pub world_fog_color: u32,
    pub world_fog: u32,
    pub sky_object_replacements: Vec<SkyObjectReplace>,
}

#[derive(Debug, Clone)]
pub struct SkyObjectReplace {
    pub object_index: u32,
    pub gfx_object_id: u32,
    pub rotate: f32,
    pub transparent: f32,
    pub luminosity: f32,
    pub max_bright: f32,
}

#[derive(Debug, Clone)]
pub struct SoundDesc {
    pub tables: Vec<AmbientSoundTable>,
}

#[derive(Debug, Clone)]
pub struct AmbientSoundTable {
    pub stb_id: u32,
    pub sounds: Vec<AmbientSound>,
}

#[derive(Debug, Clone)]
pub struct AmbientSound {
    pub sound_type: u32,
    pub volume: f32,
    /// Chance rolled each time this sound comes due; `0.0` marks it continuous instead.
    pub base_chance: f32,
    /// Seconds before it comes due again; the lower end of the interval roll, and the whole
    /// interval for a continuous sound, which does not roll.
    pub min_rate: f32,
    pub max_rate: f32,
    /// Whether this sound plays whenever it comes due rather than rolling `base_chance`.
    ///
    /// Derived, not stored: the client computes it at load as `base_chance == 0.0`
    /// (`AmbientSTBDesc::UnPack`, acclient.c:367786) and switches on it to build a `ConstantSound`
    /// rather than an `IntermitSound`. Computed here so no consumer re-tests the sentinel and
    /// mistakes a continuous sound for one that can never play.
    pub is_continuous: bool,
}

#[derive(Debug, Clone)]
pub struct RegionMisc {
    pub version: u32,
    pub game_map_id: u32,
    pub autotest_map_id: u32,
    pub autotest_map_size: u32,
    pub clear_cell_id: u32,
    pub clear_monster_id: u32,
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

#[derive(Debug, Clone)]
pub struct LandSurf {
    pub surface_type: LandSurfType,
}

impl Default for LandSurf {
    fn default() -> Self {
        Self {
            surface_type: LandSurfType::TextureMerge(TexMerge::default()),
        }
    }
}

#[derive(Debug, Clone)]
pub enum LandSurfType {
    PaletteShift(PalShift),
    TextureMerge(TexMerge),
}

impl LandSurf {
    pub fn texture_merge(&self) -> Option<&TexMerge> {
        match &self.surface_type {
            LandSurfType::PaletteShift(_) => None,
            LandSurfType::TextureMerge(tex_merge) => Some(tex_merge),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PalShift {
    pub land_textures: Vec<PalShiftTexture>,
}

#[derive(Debug, Clone)]
pub struct PalShiftTexture {
    pub texture_id: u32,
    pub sub_palettes: Vec<PalShiftSubPalette>,
    pub road_codes: Vec<PalShiftRoadCode>,
    pub terrain_palettes: Vec<PalShiftTerrainPalette>,
}

#[derive(Debug, Clone)]
pub struct PalShiftSubPalette {
    pub index: u32,
    pub length: u32,
}

#[derive(Debug, Clone)]
pub struct PalShiftRoadCode {
    pub road_code: u32,
    /// One authored palette type per `sub_palettes` entry.
    pub sub_palette_types: Vec<u32>,
}

#[derive(Debug, Clone)]
pub struct PalShiftTerrainPalette {
    pub terrain_index: u32,
    pub palette_id: u32,
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

fn read_land_defs<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<LandDefs> {
    let num_block_length = i32::read_le(reader)?;
    let num_block_width = i32::read_le(reader)?;
    let square_length = f32::read_le(reader)?;
    let lblock_length = i32::read_le(reader)?;
    let vertex_per_cell = i32::read_le(reader)?;
    let max_obj_height = f32::read_le(reader)?;
    let sky_height = f32::read_le(reader)?;
    let road_width = f32::read_le(reader)?;
    let mut land_height_table = [0.0; 256];
    for height in &mut land_height_table {
        *height = f32::read_le(reader)?;
    }
    Ok(LandDefs {
        num_block_length,
        num_block_width,
        square_length,
        lblock_length,
        vertex_per_cell,
        max_obj_height,
        sky_height,
        road_width,
        land_height_table,
    })
}

fn read_game_time<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<GameTime> {
    let zero_time_of_year = f64::read_le(reader)?;
    let zero_year = u32::read_le(reader)?;
    let day_length = f32::read_le(reader)?;
    let days_per_year = u32::read_le(reader)?;
    let year_spec = read_aligned_pstring(reader)?;
    let times_of_day = read_unpackable_list(reader, read_time_of_day)?;
    let weekday_count = u32::read_le(reader)?;
    let mut days_of_the_week = Vec::with_capacity(weekday_count as usize);
    for _ in 0..weekday_count {
        days_of_the_week.push(read_aligned_pstring(reader)?);
    }
    let seasons = read_unpackable_list(reader, read_season)?;
    Ok(GameTime {
        zero_time_of_year,
        zero_year,
        day_length,
        days_per_year,
        year_spec,
        times_of_day,
        days_of_the_week,
        seasons,
    })
}

fn read_time_of_day<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<TimeOfDay> {
    Ok(TimeOfDay {
        start: f32::read_le(reader)?,
        is_night: u32::read_le(reader)? == 1,
        name: read_aligned_pstring(reader)?,
    })
}

fn read_season<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<Season> {
    Ok(Season {
        start_date: u32::read_le(reader)?,
        name: read_aligned_pstring(reader)?,
    })
}

fn read_sky_desc<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<SkyDesc> {
    let tick_size = f64::read_le(reader)?;
    let light_tick_size = f64::read_le(reader)?;
    align_boundary(reader, 4)?;
    let day_groups = read_unpackable_list(reader, read_day_group)?;
    Ok(SkyDesc {
        tick_size,
        light_tick_size,
        day_groups,
    })
}

fn read_day_group<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<DayGroup> {
    let chance_of_occur = f32::read_le(reader)?;
    let day_name = read_aligned_pstring(reader)?;
    let sky_objects = read_unpackable_list(reader, read_sky_object)?;
    let sky_times = read_unpackable_list(reader, read_sky_time_of_day)?;
    Ok(DayGroup {
        chance_of_occur,
        day_name,
        sky_objects,
        sky_times,
    })
}

fn read_sky_object<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<SkyObject> {
    let sky_object = SkyObject {
        begin_time: f32::read_le(reader)?,
        end_time: f32::read_le(reader)?,
        begin_angle: f32::read_le(reader)?,
        end_angle: f32::read_le(reader)?,
        tex_velocity_x: f32::read_le(reader)?,
        tex_velocity_y: f32::read_le(reader)?,
        default_gfx_object_id: u32::read_le(reader)?,
        default_pes_object_id: u32::read_le(reader)?,
        properties: u32::read_le(reader)?,
    };
    align_boundary(reader, 4)?;
    Ok(sky_object)
}

fn read_sky_time_of_day<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<SkyTimeOfDay> {
    let begin = f32::read_le(reader)?;
    let dir_bright = f32::read_le(reader)?;
    let dir_heading = f32::read_le(reader)?;
    let dir_pitch = f32::read_le(reader)?;
    let dir_color = u32::read_le(reader)?;
    let amb_bright = f32::read_le(reader)?;
    let amb_color = u32::read_le(reader)?;
    let min_world_fog = f32::read_le(reader)?;
    let max_world_fog = f32::read_le(reader)?;
    let world_fog_color = u32::read_le(reader)?;
    let world_fog = u32::read_le(reader)?;
    align_boundary(reader, 4)?;
    let sky_object_replacements = read_unpackable_list(reader, read_sky_object_replace)?;
    Ok(SkyTimeOfDay {
        begin,
        dir_bright,
        dir_heading,
        dir_pitch,
        dir_color,
        amb_bright,
        amb_color,
        min_world_fog,
        max_world_fog,
        world_fog_color,
        world_fog,
        sky_object_replacements,
    })
}

fn read_sky_object_replace<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<SkyObjectReplace> {
    let replacement = SkyObjectReplace {
        object_index: u32::read_le(reader)?,
        gfx_object_id: u32::read_le(reader)?,
        rotate: f32::read_le(reader)?,
        transparent: f32::read_le(reader)?,
        luminosity: f32::read_le(reader)?,
        max_bright: f32::read_le(reader)?,
    };
    align_boundary(reader, 4)?;
    Ok(replacement)
}

fn read_sound_desc<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<SoundDesc> {
    Ok(SoundDesc {
        tables: read_unpackable_list(reader, |reader| {
            Ok(AmbientSoundTable {
                stb_id: u32::read_le(reader)?,
                sounds: read_unpackable_list(reader, |reader| {
                    let sound_type = u32::read_le(reader)?;
                    let volume = f32::read_le(reader)?;
                    let base_chance = f32::read_le(reader)?;
                    Ok(AmbientSound {
                        sound_type,
                        volume,
                        base_chance,
                        min_rate: f32::read_le(reader)?,
                        max_rate: f32::read_le(reader)?,
                        is_continuous: base_chance == 0.0,
                    })
                })?,
            })
        })?,
    })
}

fn read_region_misc<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<RegionMisc> {
    Ok(RegionMisc {
        version: u32::read_le(reader)?,
        game_map_id: u32::read_le(reader)?,
        autotest_map_id: u32::read_le(reader)?,
        autotest_map_size: u32::read_le(reader)?,
        clear_cell_id: u32::read_le(reader)?,
        clear_monster_id: u32::read_le(reader)?,
    })
}

fn read_land_surf<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<LandSurf> {
    let land_surf_type = u32::read_le(reader)?;
    let surface_type = match land_surf_type {
        0 => LandSurfType::TextureMerge(read_tex_merge(reader)?),
        1 => LandSurfType::PaletteShift(read_pal_shift(reader)?),
        unsupported => {
            return Err(binrw::Error::AssertFail {
                pos: reader.stream_position()?,
                message: format!("unsupported Region LandSurf type {unsupported}"),
            });
        }
    };
    Ok(LandSurf { surface_type })
}

fn read_tex_merge<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<TexMerge> {
    Ok(TexMerge {
        base_tex_size: u32::read_le(reader)?,
        corner_terrain_maps: read_terrain_alpha_maps(reader)?,
        side_terrain_maps: read_terrain_alpha_maps(reader)?,
        road_maps: read_road_alpha_maps(reader)?,
        terrain_desc: read_tm_terrain_descs(reader)?,
    })
}

fn read_pal_shift<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<PalShift> {
    Ok(PalShift {
        land_textures: read_unpackable_list(reader, read_pal_shift_texture)?,
    })
}

fn read_pal_shift_texture<R: Read + Seek>(reader: &mut R) -> binrw::BinResult<PalShiftTexture> {
    let texture_id = u32::read_le(reader)?;
    let sub_palettes = read_unpackable_list(reader, |reader| {
        let palette = PalShiftSubPalette {
            index: u32::read_le(reader)?,
            length: u32::read_le(reader)?,
        };
        align_boundary(reader, 4)?;
        Ok(palette)
    })?;
    let sub_palette_count = sub_palettes.len();
    let road_codes = read_unpackable_list(reader, |reader| {
        let road_code = u32::read_le(reader)?;
        let mut sub_palette_types = Vec::with_capacity(sub_palette_count);
        for _ in 0..sub_palette_count {
            sub_palette_types.push(u32::read_le(reader)?);
        }
        Ok(PalShiftRoadCode {
            road_code,
            sub_palette_types,
        })
    })?;
    let terrain_palettes = read_unpackable_list(reader, |reader| {
        let palette = PalShiftTerrainPalette {
            terrain_index: u32::read_le(reader)?,
            palette_id: u32::read_le(reader)?,
        };
        align_boundary(reader, 4)?;
        Ok(palette)
    })?;
    Ok(PalShiftTexture {
        texture_id,
        sub_palettes,
        road_codes,
        terrain_palettes,
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

fn read_unpackable_list<R, T, F>(reader: &mut R, mut read_item: F) -> binrw::BinResult<Vec<T>>
where
    R: Read + Seek,
    F: FnMut(&mut R) -> binrw::BinResult<T>,
{
    let count = u32::read_le(reader)?;
    let mut values = Vec::with_capacity(count as usize);
    for _ in 0..count {
        values.push(read_item(reader)?);
    }
    Ok(values)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FULL_PARTS_MASK: u32 = 0x01 | 0x02 | 0x04 | 0x10 | 0x0200;

    #[test]
    fn unpacks_all_proven_sections_and_palette_shift_land_surface() {
        let region = RegionDesc::unpack(&full_region_desc_bytes()).expect("region should unpack");

        assert_eq!(region.id, REGION_DESC_FILE_ID);
        assert_eq!(region.region_number, 7);
        assert_eq!(region.parts_mask, FULL_PARTS_MASK);
        assert_eq!(region.land_defs.square_length, 24.0);
        assert_eq!(region.land_defs.land_height_table[42], 42.25);
        assert_eq!(region.game_time.times_of_day[0].name, "Dawn");
        assert!(region.game_time.times_of_day[0].is_night);
        assert_eq!(region.game_time.seasons[0].start_date, 12);

        let sky = region.sky_info.expect("sky should be present");
        assert_eq!(sky.day_groups[0].day_name, "Clear");
        assert_eq!(
            sky.day_groups[0].sky_objects[0].default_gfx_object_id,
            0x0100_0001
        );
        assert_eq!(sky.day_groups[0].sky_times[0].world_fog, 1);
        assert_eq!(
            sky.day_groups[0].sky_times[0].sky_object_replacements[0].object_index,
            3
        );

        let sound = region.sound_info.expect("sound should be present");
        assert_eq!(sound.tables[0].stb_id, 9);
        assert_eq!(sound.tables[0].sounds[0].sound_type, 17);
        // `is_continuous` is derived rather than read, and a consumer that re-tested `base_chance`
        // as a probability would silence exactly the sounds meant never to stop.
        assert_eq!(sound.tables[0].sounds[0].base_chance, 0.25);
        assert!(!sound.tables[0].sounds[0].is_continuous);
        assert_eq!(sound.tables[0].sounds[1].base_chance, 0.0);
        assert!(sound.tables[0].sounds[1].is_continuous);

        let scene = region.scene_info.expect("scene should be present");
        assert_eq!(scene.scene_types[0].scenes, vec![0x1200_0001]);

        let terrain = region.terrain_info.expect("terrain should be present");
        let LandSurfType::PaletteShift(palette_shift) = terrain.land_surfaces.surface_type else {
            panic!("expected palette-shift land surface");
        };
        assert_eq!(palette_shift.land_textures[0].texture_id, 0x0500_0001);
        assert_eq!(
            palette_shift.land_textures[0].road_codes[0].sub_palette_types,
            vec![12]
        );

        let misc = region.region_misc.expect("misc should be present");
        assert_eq!(misc.clear_monster_id, 6);
    }

    #[test]
    fn honors_absent_optional_sections_and_rejects_trailing_data() {
        let bytes = required_region_desc_bytes(0);
        let region =
            RegionDesc::unpack(&bytes).expect("region without optional sections should unpack");
        assert!(region.sky_info.is_none());
        assert!(region.sound_info.is_none());
        assert!(region.scene_info.is_none());
        assert!(region.terrain_info.is_none());
        assert!(region.region_misc.is_none());

        let mut trailing = bytes;
        trailing.extend([0xCC, 0xDD]);
        let error = RegionDesc::unpack(&trailing).expect_err("trailing bytes must fail");
        assert!(error.to_string().contains("trailing bytes"));
    }

    fn full_region_desc_bytes() -> Vec<u8> {
        let mut bytes = required_region_desc_bytes(FULL_PARTS_MASK);
        write_f64(&mut bytes, 0.8);
        write_f64(&mut bytes, 15.0);
        align(&mut bytes);
        write_list(&mut bytes, 1, |bytes, _| {
            write_f32(bytes, 5.0);
            write_pstring(bytes, "Clear");
            write_list(bytes, 1, |bytes, _| {
                for value in [0.0, 1.0, 2.0, 3.0, 4.0, 5.0] {
                    write_f32(bytes, value);
                }
                for value in [0x0100_0001, 0x0A00_0001, 99] {
                    write_u32(bytes, value);
                }
                align(bytes);
            });
            write_list(bytes, 1, |bytes, _| {
                write_f32(bytes, 0.25);
                write_f32(bytes, 0.5);
                write_f32(bytes, 90.0);
                write_f32(bytes, 45.0);
                write_u32(bytes, 0x1122_3344);
                write_f32(bytes, 0.3);
                write_u32(bytes, 0x5566_7788);
                write_f32(bytes, 100.0);
                write_f32(bytes, 400.0);
                write_u32(bytes, 0xAABB_CCDD);
                write_u32(bytes, 1);
                align(bytes);
                write_list(bytes, 1, |bytes, _| {
                    write_u32(bytes, 3);
                    write_u32(bytes, 0x0100_0002);
                    for value in [1.0, 0.8, 0.7, 0.6] {
                        write_f32(bytes, value);
                    }
                    align(bytes);
                });
            });
        });

        write_list(&mut bytes, 1, |bytes, _| {
            write_u32(bytes, 9);
            // The first sound rolls a chance; the second authors zero, marking it continuous.
            write_list(bytes, 2, |bytes, index| {
                let (sound_type, fields) = if index == 0 {
                    (17, [0.5, 0.25, 3.0, 4.0])
                } else {
                    (18, [0.75, 0.0, 7.0, 7.0])
                };
                write_u32(bytes, sound_type);
                for value in fields {
                    write_f32(bytes, value);
                }
            });
        });

        write_list(&mut bytes, 1, |bytes, _| {
            write_u32(bytes, 9);
            write_list(bytes, 1, |bytes, _| write_u32(bytes, 0x1200_0001));
        });

        write_u32(&mut bytes, 1); // one TerrainType
        write_pstring(&mut bytes, "grass");
        write_u32(&mut bytes, 0x00FF_00FF);
        write_list(&mut bytes, 1, |bytes, _| write_u32(bytes, 0));
        write_u32(&mut bytes, 1); // palette-shift LandSurf
        write_list(&mut bytes, 1, |bytes, _| {
            write_u32(bytes, 0x0500_0001);
            write_list(bytes, 1, |bytes, _| {
                write_u32(bytes, 2);
                write_u32(bytes, 4);
                align(bytes);
            });
            write_list(bytes, 1, |bytes, _| {
                write_u32(bytes, 7);
                write_u32(bytes, 12);
            });
            write_list(bytes, 1, |bytes, _| {
                write_u32(bytes, 31);
                write_u32(bytes, 0x0400_0001);
                align(bytes);
            });
        });

        for value in 1..=6 {
            write_u32(&mut bytes, value);
        }
        bytes
    }

    fn required_region_desc_bytes(parts_mask: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        write_u32(&mut bytes, REGION_DESC_FILE_ID);
        write_u32(&mut bytes, 7);
        write_u32(&mut bytes, 3);
        write_pstring(&mut bytes, "Test Region");
        write_i32(&mut bytes, 255);
        write_i32(&mut bytes, 255);
        write_f32(&mut bytes, 24.0);
        write_i32(&mut bytes, 192);
        write_i32(&mut bytes, 1);
        write_f32(&mut bytes, 48.0);
        write_f32(&mut bytes, 400.0);
        write_f32(&mut bytes, 6.0);
        for index in 0..256 {
            write_f32(&mut bytes, index as f32 + 0.25);
        }
        write_f64(&mut bytes, 3600.0);
        write_u32(&mut bytes, 10);
        write_f32(&mut bytes, 7620.0);
        write_u32(&mut bytes, 360);
        write_pstring(&mut bytes, "P.Y.");
        write_list(&mut bytes, 1, |bytes, _| {
            write_f32(bytes, 0.0);
            write_u32(bytes, 1);
            write_pstring(bytes, "Dawn");
        });
        write_u32(&mut bytes, 1);
        write_pstring(&mut bytes, "Monday");
        write_list(&mut bytes, 1, |bytes, _| {
            write_u32(bytes, 12);
            write_pstring(bytes, "Spring");
        });
        write_u32(&mut bytes, parts_mask);
        bytes
    }

    /// Write a length-prefixed list, invoking `write_item` once per element with its index.
    fn write_list(bytes: &mut Vec<u8>, count: u32, mut write_item: impl FnMut(&mut Vec<u8>, u32)) {
        write_u32(bytes, count);
        for index in 0..count {
            write_item(bytes, index);
        }
    }

    fn write_pstring(bytes: &mut Vec<u8>, value: &str) {
        bytes.extend_from_slice(&(value.len() as u16).to_le_bytes());
        bytes.extend_from_slice(value.as_bytes());
        align(bytes);
    }

    fn align(bytes: &mut Vec<u8>) {
        bytes.resize(bytes.len().next_multiple_of(4), 0);
    }

    fn write_i32(bytes: &mut Vec<u8>, value: i32) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_u32(bytes: &mut Vec<u8>, value: u32) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_f32(bytes: &mut Vec<u8>, value: f32) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_f64(bytes: &mut Vec<u8>, value: f64) {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
}
