//! Active region manifest projection and binary envelope serialization.

use anyhow::{Context, Result};
use holtburger_content::ActiveRegionData;
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetRuntime};
use holtburger_dat::file_type::region::{LandSurfType, TerrainDesc};
use serde::Serialize;
use serde_json::{Value, json};

use super::{BINARY_ENVELOPE_HEADER_LEN, BinarySectionManifest, pad_binary_manifest};
use crate::source_projection::dat_id;

pub(super) const ACTIVE_REGION_BINARY_MAGIC: &[u8; 4] = b"HBAR";

/// Build the canonical active-region response used by the sidecar and headless browser harness.
pub async fn load_active_region_data_bytes(runtime: &ContentAssetRuntime) -> Result<Vec<u8>> {
    let asset = runtime
        .load(ContentAssetRequest::ActiveRegionData)
        .await
        .context("Could not load active-region static data")?;
    let ContentAsset::ActiveRegionData(active_region) = asset else {
        unreachable!("active-region request must return active-region data")
    };
    serialize_active_region_binary(&active_region)
}

/// App-local transport envelope for the active RegionDesc projection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveRegionManifest {
    transport: &'static str,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    provenance: ActiveRegionProvenanceManifest,
    /// Complete semantic RegionDesc projection.
    data: Value,
    sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveRegionProvenanceManifest {
    source_record_id: String,
    number: u32,
    version: u32,
    name: String,
    parts_mask: u32,
}

fn active_region_manifest(active_region: &ActiveRegionData) -> ActiveRegionManifest {
    let region = &active_region.descriptor;
    ActiveRegionManifest {
        transport: "holtburger-active-region-data",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        provenance: ActiveRegionProvenanceManifest {
            source_record_id: dat_id(region.id),
            number: region.region_number,
            version: region.version,
            name: region.region_name.clone(),
            parts_mask: region.parts_mask,
        },
        data: json!({
            "land": {
                "numBlockLength": region.land_defs.num_block_length,
                "numBlockWidth": region.land_defs.num_block_width,
                "squareLength": region.land_defs.square_length,
                "landblockLength": region.land_defs.lblock_length,
                "verticesPerCell": region.land_defs.vertex_per_cell,
                "maxObjectHeight": region.land_defs.max_obj_height,
                "roadWidth": region.land_defs.road_width,
            },
            "calendar": {
                "zeroTimeOfYear": region.game_time.zero_time_of_year,
                "zeroYear": region.game_time.zero_year,
                "dayLength": region.game_time.day_length,
                "daysPerYear": region.game_time.days_per_year,
                "yearSpec": region.game_time.year_spec,
                "timesOfDay": region.game_time.times_of_day.iter().map(|time| json!({
                    "start": time.start,
                    "isNight": time.is_night,
                    "name": time.name,
                })).collect::<Vec<_>>(),
                "daysOfTheWeek": region.game_time.days_of_the_week,
                "seasons": region.game_time.seasons.iter().map(|season| json!({
                    "startDate": season.start_date,
                    "name": season.name,
                })).collect::<Vec<_>>(),
            },
            "sky": region.sky_info.as_ref().map(|sky| json!({
                "tickSize": sky.tick_size,
                "lightTickSize": sky.light_tick_size,
                "dayGroups": sky.day_groups.iter().map(|group| json!({
                    "chanceOfOccur": group.chance_of_occur,
                    "dayName": group.day_name,
                    "skyObjects": group.sky_objects.iter().map(|object| json!({
                        "beginTime": object.begin_time,
                        "endTime": object.end_time,
                        "beginAngle": object.begin_angle,
                        "endAngle": object.end_angle,
                        "textureVelocityX": object.tex_velocity_x,
                        "textureVelocityY": object.tex_velocity_y,
                        "defaultGfxObjectId": dat_id(object.default_gfx_object_id),
                        "defaultParticleEffectId": dat_id(object.default_pes_object_id),
                        "properties": object.properties,
                    })).collect::<Vec<_>>(),
                    "skyTimes": group.sky_times.iter().map(|time| json!({
                        "begin": time.begin,
                        "directionalBrightness": time.dir_bright,
                        "directionalHeading": time.dir_heading,
                        "directionalPitch": time.dir_pitch,
                        "directionalColor": time.dir_color,
                        "ambientBrightness": time.amb_bright,
                        "ambientColor": time.amb_color,
                        "minWorldFog": time.min_world_fog,
                        "maxWorldFog": time.max_world_fog,
                        "worldFogColor": time.world_fog_color,
                        "worldFog": time.world_fog,
                        "skyObjectReplacements": time.sky_object_replacements.iter().map(|replacement| json!({
                            "objectIndex": replacement.object_index,
                            "gfxObjectId": dat_id(replacement.gfx_object_id),
                            "rotate": replacement.rotate,
                            "transparent": replacement.transparent,
                            "luminosity": replacement.luminosity,
                            "maxBrightness": replacement.max_bright,
                        })).collect::<Vec<_>>(),
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })),
            "sound": region.sound_info.as_ref().map(|sound| json!({
                "tables": sound.tables.iter().map(|table| json!({
                    "soundTableId": dat_id(table.stb_id),
                    "sounds": table.sounds.iter().map(|sound| json!({
                        "soundType": sound.sound_type,
                        "volume": sound.volume,
                        "baseChance": sound.base_chance,
                        "minRate": sound.min_rate,
                        "maxRate": sound.max_rate,
                        "isContinuous": sound.is_continuous,
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })),
            "scenes": region.scene_info.as_ref().map(|scene| json!({
                "types": scene.scene_types.iter().map(|scene_type| json!({
                    "soundTableIndex": scene_type.stb_index,
                    "sceneIds": scene_type.scenes.iter().copied().map(dat_id).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })),
            "terrain": region.terrain_info.as_ref().map(active_region_terrain_value),
            "misc": region.region_misc.as_ref().map(|misc| json!({
                "version": misc.version,
                "gameMapId": dat_id(misc.game_map_id),
                "autotestMapId": dat_id(misc.autotest_map_id),
                "autotestMapSize": misc.autotest_map_size,
                "clearCellId": dat_id(misc.clear_cell_id),
                "clearMonsterId": dat_id(misc.clear_monster_id),
            })),
        }),
        sections: vec![BinarySectionManifest {
            name: "landHeightTable",
            scalar_type: "f32",
            element_count: region.land_defs.land_height_table.len(),
            byte_offset: 0,
            byte_length: std::mem::size_of_val(&region.land_defs.land_height_table),
        }],
    }
}

fn active_region_terrain_value(terrain: &TerrainDesc) -> Value {
    let land_surface = match &terrain.land_surfaces.surface_type {
        LandSurfType::TextureMerge(merge) => json!({
            "kind": "texture-merge",
            "baseTextureSize": merge.base_tex_size,
            "cornerTerrainMaps": merge.corner_terrain_maps.iter().map(|map| json!({
                "terrainCode": map.terrain_code,
                "surfaceTextureId": dat_id(map.tex_gid),
            })).collect::<Vec<_>>(),
            "sideTerrainMaps": merge.side_terrain_maps.iter().map(|map| json!({
                "terrainCode": map.terrain_code,
                "surfaceTextureId": dat_id(map.tex_gid),
            })).collect::<Vec<_>>(),
            "roadMaps": merge.road_maps.iter().map(|map| json!({
                "roadCode": map.road_code,
                "surfaceTextureId": dat_id(map.road_tex_gid),
            })).collect::<Vec<_>>(),
            "terrainTextures": merge.terrain_desc.iter().map(|description| {
                let texture = &description.terrain_tex;
                json!({
                    "terrainType": description.terrain_type,
                    "colorTextureId": dat_id(texture.tex_gid),
                    "tiling": texture.tex_tiling,
                    "maxVertexBrightness": texture.max_vert_bright,
                    "minVertexBrightness": texture.min_vert_bright,
                    "maxVertexSaturation": texture.max_vert_saturate,
                    "minVertexSaturation": texture.min_vert_saturate,
                    "maxVertexHue": texture.max_vert_hue,
                    "minVertexHue": texture.min_vert_hue,
                    "detailTiling": texture.detail_tex_tiling,
                    "detailTextureId": dat_id(texture.detail_tex_gid),
                })
            }).collect::<Vec<_>>(),
        }),
        LandSurfType::PaletteShift(shift) => json!({
            "kind": "palette-shift",
            "landTextures": shift.land_textures.iter().map(|texture| json!({
                "surfaceTextureId": dat_id(texture.texture_id),
                "subPalettes": texture.sub_palettes.iter().map(|palette| json!({
                    "index": palette.index,
                    "length": palette.length,
                })).collect::<Vec<_>>(),
                "roadCodes": texture.road_codes.iter().map(|road| json!({
                    "roadCode": road.road_code,
                    "subPaletteTypes": road.sub_palette_types,
                })).collect::<Vec<_>>(),
                "terrainPalettes": texture.terrain_palettes.iter().map(|palette| json!({
                    "terrainIndex": palette.terrain_index,
                    "paletteId": dat_id(palette.palette_id),
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        }),
    };
    json!({
        "types": terrain.terrain_types.iter().map(|terrain_type| json!({
            "name": terrain_type.name,
            "color": terrain_type.color,
            "sceneTypes": terrain_type.scene_types,
        })).collect::<Vec<_>>(),
        "landSurface": land_surface,
    })
}

pub(super) fn serialize_active_region_binary(active_region: &ActiveRegionData) -> Result<Vec<u8>> {
    let manifest = active_region_manifest(active_region);
    let manifest_bytes = pad_binary_manifest(serde_json::to_vec(&manifest)?);
    let total_length = BINARY_ENVELOPE_HEADER_LEN
        + manifest_bytes.len()
        + std::mem::size_of_val(&active_region.descriptor.land_defs.land_height_table);
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(ACTIVE_REGION_BINARY_MAGIC);
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    for height in &active_region.descriptor.land_defs.land_height_table {
        bytes.extend(height.to_le_bytes());
    }
    Ok(bytes)
}
