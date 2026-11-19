//! Landblock terrain, static layer, EnvCell, and landblock profile response builders.

use anyhow::{Context, Result, bail, ensure};
use holtburger_content::LandblockTerrain;
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetRuntime};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{BINARY_ENVELOPE_HEADER_LEN, BinarySectionManifest, pad_binary_manifest};
use crate::binary_source_record::BinarySectionWriter;
use crate::env_cell_source::serialize_env_cell_source_record;
use crate::gfx_obj_geometry::build_gfx_obj_portal_apertures;
use crate::landblock_profile::{LandblockProfile, project_landblock_profile};
use crate::landblock_source_batch::{
    LandblockSourceBatchRecord, LandblockSourceBatchRequest, LandblockSourceLayer,
    LoadedLandblockSourceBatch, load_landblock_source_batch as load_landblock_source_batch_asset,
    serialize_landblock_source_batch,
};
use crate::map_geometry::build_blocker_silhouette_geometry;
use crate::object_resource_closure::ObjectResourceClosure;
use crate::outdoor_static_source::{
    OutdoorStaticSourceRecordManifest, serialize_outdoor_static_record_binary,
};
use crate::source_projection::dat_id;

pub(super) const TERRAIN_SOURCE_BINARY_MAGIC: &[u8; 4] = b"HBTR";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadLandblockSourceBatchRequest {
    pub landblock_id: String,
    pub layers: Vec<LandblockSourceLayer>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadLandblockProfileRequest {
    pub landblock_id: String,
}

pub async fn load_landblock_source_batch_bytes(
    runtime: &ContentAssetRuntime,
    raw_landblock_id: &str,
    layers: Vec<LandblockSourceLayer>,
) -> Result<Vec<u8>> {
    let landblock_id = parse_landblock_id(raw_landblock_id)?;
    let request = LandblockSourceBatchRequest::new(landblock_id, layers)?;
    build_landblock_source_batch_response(runtime, request).await
}

/// Builds the canonical profile response used by the sidecar and development HTTP host.
pub async fn load_landblock_profile_response(
    runtime: &ContentAssetRuntime,
    raw_landblock_id: &str,
) -> Result<Option<LandblockProfile>> {
    let landblock_id = parse_landblock_id(raw_landblock_id)?;
    let asset = runtime
        .load(ContentAssetRequest::Landblock(landblock_id))
        .await
        .with_context(|| {
            format!("Could not load shallow landblock profile for 0x{landblock_id:08X}")
        })?;
    let ContentAsset::Landblock(landblock) = asset else {
        bail!("landblock profile request returned a different content asset");
    };
    let Some(landblock) = landblock else {
        return Ok(None);
    };
    ensure!(
        landblock.landblock_id == landblock_id,
        "content runtime returned landblock 0x{:08X} for profile 0x{landblock_id:08X}",
        landblock.landblock_id
    );
    Ok(Some(project_landblock_profile(&landblock)))
}

/// Builds the canonical EnvCell source record for the browser-free portal trace evaluator.
pub async fn load_env_cell_source_record_bytes(
    runtime: &ContentAssetRuntime,
    raw_landblock_id: &str,
) -> Result<Vec<u8>> {
    let landblock_id = parse_landblock_id(raw_landblock_id)?;
    let request =
        LandblockSourceBatchRequest::new(landblock_id, vec![LandblockSourceLayer::EnvCells])?;
    let source_batch = load_landblock_source_batch_asset(runtime, request).await?;
    serialize_env_cell_source_record(runtime, &source_batch).await
}

async fn build_landblock_source_batch_response(
    runtime: &ContentAssetRuntime,
    request: LandblockSourceBatchRequest,
) -> Result<Vec<u8>> {
    let source_batch = load_landblock_source_batch_asset(runtime, request.clone()).await?;
    let mut records = Vec::new();
    for layer in request.layers() {
        let bytes = match layer {
            LandblockSourceLayer::Terrain => serialize_terrain_source_record(&source_batch)?,
            LandblockSourceLayer::Buildings
            | LandblockSourceLayer::Objects
            | LandblockSourceLayer::Generated => {
                serialize_outdoor_static_source_record(runtime, &source_batch, layer).await?
            }
            LandblockSourceLayer::EnvCells => {
                serialize_env_cell_source_record(runtime, &source_batch).await?
            }
        };
        records.push(LandblockSourceBatchRecord { layer, bytes });
    }
    serialize_landblock_source_batch(&request, records)
}

fn serialize_terrain_source_record(source_batch: &LoadedLandblockSourceBatch) -> Result<Vec<u8>> {
    let terrain = source_batch.terrain()?;
    let manifest = TerrainSourceManifest {
        transport: "holtburger-landblock-terrain-record",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        landblock_id: format!("0x{:08x}", source_batch.landblock_id()),
        terrain_availability: terrain_availability(terrain),
        sections: terrain.map(terrain_sections).unwrap_or_default(),
    };
    serialize_terrain_source_binary(&manifest, terrain)
}

async fn serialize_outdoor_static_source_record(
    runtime: &ContentAssetRuntime,
    source_batch: &LoadedLandblockSourceBatch,
    layer: LandblockSourceLayer,
) -> Result<Vec<u8>> {
    let statics = match layer {
        LandblockSourceLayer::Buildings => source_batch.buildings()?,
        LandblockSourceLayer::Objects => source_batch.objects()?,
        LandblockSourceLayer::Generated => source_batch.generated()?,
        LandblockSourceLayer::Terrain | LandblockSourceLayer::EnvCells => {
            anyhow::bail!("{layer:?} does not have an outdoor static source record")
        }
    };

    let mut closure = if layer == LandblockSourceLayer::Buildings {
        ObjectResourceClosure::for_buildings()
    } else {
        ObjectResourceClosure::default()
    };
    let mut residents = Vec::with_capacity(statics.len());
    for member in statics {
        let source = closure.add_resident(runtime, member.source_did).await?;
        residents.push(json!({
            "id": member.id,
            "source": source,
            "placement": {
                "origin": [member.placement.origin.x, member.placement.origin.y, member.placement.origin.z],
                "orientation": [
                    member.placement.orientation.w,
                    member.placement.orientation.x,
                    member.placement.orientation.y,
                    member.placement.orientation.z,
                ],
            },
            "scale": [member.scale.x, member.scale.y, member.scale.z],
        }));
    }
    closure.validate()?;
    let mut section_writer = BinarySectionWriter::default();
    closure.buffers.append_sections(&mut section_writer, "")?;
    let map_blockers = if layer == LandblockSourceLayer::Buildings {
        Some(append_building_map_blockers(runtime, statics, &mut section_writer).await?)
    } else {
        None
    };
    let (sections, section_bytes) = section_writer.finish();
    let manifest = OutdoorStaticSourceRecordManifest {
        transport: "holtburger-outdoor-static-record",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        landblock_id: dat_id(source_batch.landblock_id()),
        layer: match layer {
            LandblockSourceLayer::Buildings => "buildings",
            LandblockSourceLayer::Objects => "objects",
            LandblockSourceLayer::Generated => "generated",
            LandblockSourceLayer::Terrain | LandblockSourceLayer::EnvCells => {
                unreachable!("non-static layers were rejected above")
            }
        },
        residents,
        map_blockers,
        definitions: closure.definitions,
        geometries: closure.geometries,
        materials: closure.materials.into_values().collect(),
        texture_dependencies: closure.texture_dependencies.into_values().collect(),
        sections,
    };
    serialize_outdoor_static_record_binary(&manifest, section_bytes)
}

/// Derive and append per-building overhead-map blocker silhouettes for one buildings layer.
///
/// Doorways stay open on the map: physics polygons named by the building's authored portal
/// apertures are excluded from the silhouette. Silhouettes are deduplicated by source DID; the
/// frontend map composes them with each resident's placement.
async fn append_building_map_blockers(
    runtime: &ContentAssetRuntime,
    statics: &[crate::landblock_source_batch::OutdoorStaticResident],
    writer: &mut BinarySectionWriter,
) -> Result<Vec<serde_json::Value>> {
    let mut positions = Vec::<f32>::new();
    let mut indices = Vec::<u32>::new();
    let mut entries = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for member in statics {
        if !seen.insert(member.source_did) {
            continue;
        }
        anyhow::ensure!(
            member.source_did >> 24 == 0x01,
            "building 0x{:08X} is not a GfxObj source; map blockers only understand GfxObj buildings",
            member.source_did
        );
        let asset = runtime
            .load(ContentAssetRequest::GfxObj(member.source_did))
            .await?;
        let ContentAsset::GfxObj(gfx_obj) = asset else {
            unreachable!("GfxObj request must return a GfxObj")
        };
        let excluded = build_gfx_obj_portal_apertures(&gfx_obj)?
            .iter()
            .flat_map(|aperture| aperture.polygon_ids.iter().copied())
            .collect::<std::collections::HashSet<u16>>();
        let blocker = build_blocker_silhouette_geometry(
            &gfx_obj.vertex_array,
            &gfx_obj.physics_polygons,
            &excluded,
        )
        .with_context(|| {
            format!(
                "Could not derive map blocker for building GfxObj 0x{:08X}",
                member.source_did
            )
        })?;
        entries.push(json!({
            // Keyed by the presentation identity the resource closure gives this GfxObj, so the
            // frontend joins a resident to its silhouette by exact string rather than by parsing a
            // DAT id back out of one.
            "sourceAssetId": format!("gfx-obj/{:08x}", member.source_did),
            "positionOffset": positions.len(),
            "vertexCount": blocker.vertex_count(),
            "indexOffset": indices.len(),
            "indexCount": blocker.indices.len(),
        }));
        positions.extend(blocker.positions);
        indices.extend(blocker.indices);
    }
    writer.append_f32("mapBlockerPositions", positions)?;
    writer.append_u32("mapBlockerIndices", indices);
    Ok(entries)
}

pub(super) fn parse_landblock_id(raw_landblock_id: &str) -> Result<u32> {
    let raw_hex = raw_landblock_id
        .strip_prefix("0x")
        .or_else(|| raw_landblock_id.strip_prefix("0X"))
        .unwrap_or(raw_landblock_id);
    if raw_hex.len() != 8
        || !raw_hex
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("landblock id must be exactly eight hexadecimal digits")
    }
    let raw_id = u32::from_str_radix(raw_hex, 16).context("landblock id is not hexadecimal")?;
    Ok(raw_id & 0xFFFF_0000 | 0xFFFF)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TerrainSourceManifest {
    pub(super) transport: &'static str,
    pub(super) byte_order: &'static str,
    pub(super) section_byte_offset_base: &'static str,
    pub(super) landblock_id: String,
    /// Distinguishes an absent outdoor record from a source or assembly failure.
    pub(super) terrain_availability: TerrainAvailabilityManifest,
    pub(super) sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum TerrainAvailabilityManifest {
    Available,
    MissingCellLandblock,
}

pub(super) fn terrain_availability(
    terrain: Option<&LandblockTerrain>,
) -> TerrainAvailabilityManifest {
    match terrain {
        Some(_) => TerrainAvailabilityManifest::Available,
        None => TerrainAvailabilityManifest::MissingCellLandblock,
    }
}

pub(super) fn terrain_sections(terrain: &LandblockTerrain) -> Vec<BinarySectionManifest> {
    let height_indices_length = terrain.height_indices.len();
    let heights_offset =
        align_binary_section_offset(height_indices_length, std::mem::align_of::<f32>());
    let heights_length = terrain.heights.len() * std::mem::size_of::<f32>();
    let terrain_samples_offset =
        align_binary_section_offset(heights_offset + heights_length, std::mem::align_of::<u16>());
    let terrain_samples_length = terrain.terrain_samples.len() * std::mem::size_of::<u16>();
    let cell_diagonals_offset = terrain_samples_offset + terrain_samples_length;
    let cell_diagonals_length = terrain.cell_diagonals.to_cell_bytes().len();
    vec![
        BinarySectionManifest {
            name: "heightIndices",
            scalar_type: "u8",
            element_count: terrain.height_indices.len(),
            byte_offset: 0,
            byte_length: height_indices_length,
        },
        BinarySectionManifest {
            name: "resolvedHeights",
            scalar_type: "f32",
            element_count: terrain.heights.len(),
            byte_offset: heights_offset,
            byte_length: heights_length,
        },
        BinarySectionManifest {
            name: "terrainSamples",
            scalar_type: "u16",
            element_count: terrain.terrain_samples.len(),
            byte_offset: terrain_samples_offset,
            byte_length: terrain_samples_length,
        },
        BinarySectionManifest {
            name: "cellDiagonals",
            scalar_type: "u8",
            element_count: cell_diagonals_length,
            byte_offset: cell_diagonals_offset,
            byte_length: cell_diagonals_length,
        },
    ]
}

fn align_binary_section_offset(offset: usize, alignment: usize) -> usize {
    offset.next_multiple_of(alignment)
}

pub(super) fn serialize_terrain_source_binary(
    manifest: &TerrainSourceManifest,
    terrain: Option<&LandblockTerrain>,
) -> Result<Vec<u8>> {
    let manifest_bytes = pad_binary_manifest(serde_json::to_vec(&manifest)?);
    let manifest_length = manifest_bytes.len();
    let section_data_length = manifest
        .sections
        .iter()
        .map(|section| section.byte_offset + section.byte_length)
        .max()
        .unwrap_or_default();
    let total_length = BINARY_ENVELOPE_HEADER_LEN + manifest_bytes.len() + section_data_length;
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(TERRAIN_SOURCE_BINARY_MAGIC);
    bytes.extend(u32::try_from(manifest_length)?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    if let Some(terrain) = terrain {
        let mut section_data = vec![0; section_data_length];
        for section in &manifest.sections {
            let target =
                &mut section_data[section.byte_offset..section.byte_offset + section.byte_length];
            match section.name {
                "heightIndices" => target.copy_from_slice(&terrain.height_indices),
                "resolvedHeights" => {
                    for (chunk, height) in target
                        .as_chunks_mut::<4>()
                        .0
                        .iter_mut()
                        .zip(&terrain.heights)
                    {
                        chunk.copy_from_slice(&height.to_le_bytes());
                    }
                }
                "terrainSamples" => {
                    for (chunk, sample) in target
                        .as_chunks_mut::<2>()
                        .0
                        .iter_mut()
                        .zip(&terrain.terrain_samples)
                    {
                        chunk.copy_from_slice(&sample.to_le_bytes());
                    }
                }
                "cellDiagonals" => target.copy_from_slice(&terrain.cell_diagonals.to_cell_bytes()),
                _ => unreachable!("terrain sections are fixed"),
            }
        }
        bytes.extend(section_data);
    }
    Ok(bytes)
}
