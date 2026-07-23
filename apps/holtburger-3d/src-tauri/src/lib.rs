use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockSceneLodLayer, LandblockSceneLodLevel,
    LandblockSceneLodRequest, ResolvedRegionDetailRoleKind, SourceRecordStatus, TerrainGridSource,
    TexturePixelFormat,
};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, ContentAssetService,
    SurfaceTexturePixelsRequest,
};
use serde::{Deserialize, Serialize};

const TERRAIN_SOURCE_BINARY_MAGIC: &[u8; 4] = b"HBTR";
const TERRAIN_SOURCE_BINARY_VERSION: u32 = 1;
const TERRAIN_SOURCE_BINARY_HEADER_LEN: usize = 16;
const TEXTURE_PIXELS_BINARY_MAGIC: &[u8; 4] = b"HBTP";
const TEXTURE_PIXELS_BINARY_VERSION: u32 = 1;

/// Managed static-content runtime shared by narrow Tauri commands.
#[derive(Clone)]
struct HostContentState {
    runtime: ContentAssetRuntime,
}

impl HostContentState {
    fn discover() -> Result<Self> {
        let repository = Arc::new(ContentRepository::discover(None)?);
        Ok(Self::from_repository(repository))
    }

    /// Builds the app-local host state from an already discovered or injected repository.
    fn from_repository(repository: Arc<ContentRepository>) -> Self {
        let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
        Self {
            runtime: ContentAssetRuntime::new(service),
        }
    }
}

/// Discover the app's configured static-content runtime for a non-Tauri diagnostic host.
pub fn discover_content_runtime() -> Result<ContentAssetRuntime> {
    let repository = Arc::new(ContentRepository::discover(None)?);
    let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
    Ok(ContentAssetRuntime::new(service))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadTerrainSourceRequest {
    landblock_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadTexturePixelsRequest {
    kind: String,
    purpose: String,
    source_asset_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostStatus {
    /// Stable label used by the frontend to identify the active host shell.
    app_name: &'static str,
    /// Human-readable lifecycle state for diagnostics.
    status: &'static str,
}

#[tauri::command]
fn host_status() -> HostStatus {
    HostStatus {
        app_name: "holtburger-3d",
        status: "terrain-source-host-ready",
    }
}

/// Loads one normalized outdoor landblock's authored terrain source as a versioned binary response.
#[tauri::command]
async fn load_terrain_source(
    state: tauri::State<'_, HostContentState>,
    request: LoadTerrainSourceRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_terrain_source_bytes(&state.runtime, &request.landblock_id)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads one terrain source texture as semantic, normalized level-zero pixels.
#[tauri::command]
async fn load_texture_pixels(
    state: tauri::State<'_, HostContentState>,
    request: LoadTexturePixelsRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_texture_pixels_bytes(
        &state.runtime,
        &request.kind,
        &request.purpose,
        &request.source_asset_id,
    )
    .await
    .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Build the canonical terrain-source response used by Tauri and the headless browser harness.
pub async fn load_terrain_source_bytes(
    runtime: &ContentAssetRuntime,
    raw_landblock_id: &str,
) -> Result<Vec<u8>> {
    let landblock_id = parse_landblock_id(raw_landblock_id)?;
    build_terrain_source_response(runtime, landblock_id).await
}

/// Build the canonical terrain-pixel response used by Tauri and the headless browser harness.
pub async fn load_texture_pixels_bytes(
    runtime: &ContentAssetRuntime,
    kind: &str,
    purpose: &str,
    source_asset_id: &str,
) -> Result<Vec<u8>> {
    build_texture_pixels_response(
        runtime,
        LoadTexturePixelsRequest {
            kind: kind.to_owned(),
            purpose: purpose.to_owned(),
            source_asset_id: source_asset_id.to_owned(),
        },
    )
    .await
}

async fn build_terrain_source_response(
    runtime: &ContentAssetRuntime,
    landblock_id: u32,
) -> Result<Vec<u8>> {
    let scene_asset = runtime
        .load(ContentAssetRequest::LandblockSceneLod(
            LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level0),
        ))
        .await
        .with_context(|| format!("Could not load terrain scene source for 0x{landblock_id:08X}"))?;
    let ContentAsset::LandblockSceneLod {
        scene_lod,
        region_number,
        ..
    } = scene_asset
    else {
        unreachable!("terrain source request must return a landblock scene asset")
    };
    if scene_lod.landblock_id != landblock_id {
        anyhow::bail!(
            "content runtime returned landblock 0x{:08X} for terrain request 0x{landblock_id:08X}",
            scene_lod.landblock_id
        );
    }

    let material_asset = runtime
        .load(ContentAssetRequest::TerrainMaterial(region_number))
        .await
        .with_context(|| {
            format!("Could not load terrain material table for region {region_number}")
        })?;
    let ContentAsset::TerrainMaterial(material_table) = material_asset else {
        unreachable!("terrain material request must return a terrain material table")
    };
    let render_profile_asset = runtime
        .load(ContentAssetRequest::RegionRenderProfile(region_number))
        .await
        .with_context(|| {
            format!("Could not load terrain render profile for region {region_number}")
        })?;
    let ContentAsset::RegionRenderProfile(render_profile) = render_profile_asset else {
        unreachable!("region profile request must return a region render profile")
    };
    let landscape_detail = render_profile
        .detail_roles
        .iter()
        .find(|role| role.role == ResolvedRegionDetailRoleKind::Landscape)
        .context("region render profile has no landscape detail role")?;

    let terrain = scene_lod.layers.iter().find_map(|layer| match layer {
        LandblockSceneLodLayer::Terrain(layer) => layer.terrain.as_ref(),
        _ => None,
    });
    let terrain_availability = terrain_availability(terrain, &scene_lod.diagnostics);
    let manifest = TerrainSourceManifest {
        transport: "holtburger-terrain-source",
        version: TERRAIN_SOURCE_BINARY_VERSION,
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        landblock_id: format!("0x{landblock_id:08x}"),
        region_number,
        terrain: terrain.map(TerrainManifest::from),
        terrain_availability,
        composition: TerrainCompositionManifest {
            region_number,
            terrain_types: material_table
                .terrain_types
                .iter()
                .map(|terrain| TerrainMaterialManifest {
                    terrain_type: terrain.terrain_type,
                    color_texture_id: surface_texture_asset_id(terrain.texture_id),
                    tiling: terrain.tiling,
                    color_variation: TerrainColorVariationManifest {
                        min_vertex_brightness: terrain.min_vert_bright,
                        max_vertex_brightness: terrain.max_vert_bright,
                        min_vertex_saturation: terrain.min_vert_saturate,
                        max_vertex_saturation: terrain.max_vert_saturate,
                        min_vertex_hue: terrain.min_vert_hue,
                        max_vertex_hue: terrain.max_vert_hue,
                    },
                })
                .collect(),
            corner_terrain_alpha_maps: alpha_maps(&material_table.corner_terrain_alpha_maps),
            side_terrain_alpha_maps: alpha_maps(&material_table.side_terrain_alpha_maps),
            road_alpha_maps: material_table
                .road_alpha_maps
                .iter()
                .map(|map| TerrainRoadAlphaMapManifest {
                    road_code: map.selector,
                    road_mask_texture_id: surface_texture_asset_id(map.alpha_texture_id),
                })
                .collect(),
            landscape_detail: LandscapeDetailManifest {
                texture_id: surface_texture_asset_id(landscape_detail.detail_texture_id),
                tiling: landscape_detail.detail_tiling,
            },
        },
        sections: terrain.map(terrain_sections).unwrap_or_default(),
    };
    serialize_terrain_source_binary(&manifest, terrain)
}

async fn build_texture_pixels_response(
    runtime: &ContentAssetRuntime,
    request: LoadTexturePixelsRequest,
) -> Result<Vec<u8>> {
    if request.kind != "prepared-texture-surface" {
        anyhow::bail!("texture request kind must be prepared-texture-surface");
    }
    let output_format = texture_output_format(&request.purpose)?;
    let surface_texture_id = parse_surface_texture_asset_id(&request.source_asset_id)?;
    let asset = runtime
        .load(ContentAssetRequest::SurfaceTexturePixels(
            SurfaceTexturePixelsRequest {
                surface_texture_id,
                output_format,
            },
        ))
        .await
        .with_context(|| {
            format!(
                "Could not load {} pixels from {}",
                request.purpose, request.source_asset_id
            )
        })?;
    let ContentAsset::SurfaceTexturePixels(pixels) = asset else {
        unreachable!("texture pixel request must return normalized surface pixels")
    };
    let source_asset_id = surface_texture_asset_id(surface_texture_id);
    let manifest = TexturePixelsManifest {
        transport: "holtburger-texture-pixels",
        version: TEXTURE_PIXELS_BINARY_VERSION,
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        source_asset_id,
        purpose: request.purpose,
        surface: TexturePixelsSurfaceManifest {
            render_surface_id: format!("0x{:08x}", pixels.render_surface_id),
            format: texture_pixel_format_name(pixels.format),
            width: pixels.width,
            height: pixels.height,
        },
        sections: vec![BinarySectionManifest {
            name: "pixels",
            scalar_type: "u8",
            element_count: pixels.pixels.len(),
            byte_offset: 0,
            byte_length: pixels.pixels.len(),
        }],
    };
    serialize_texture_pixels_binary(&manifest, &pixels.pixels)
}

fn parse_landblock_id(raw_landblock_id: &str) -> Result<u32> {
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

fn parse_surface_texture_asset_id(raw_asset_id: &str) -> Result<u32> {
    let raw_id = raw_asset_id
        .strip_prefix("surface-texture/")
        .context("texture source asset id must start with surface-texture/")?;
    let raw_hex = raw_id
        .strip_prefix("0x")
        .or_else(|| raw_id.strip_prefix("0X"))
        .unwrap_or(raw_id);
    if raw_hex.len() != 8
        || !raw_hex
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("texture source asset id must contain exactly eight hexadecimal digits");
    }
    let id =
        u32::from_str_radix(raw_hex, 16).context("texture source asset id is not hexadecimal")?;
    if id >> 24 != 0x05 {
        anyhow::bail!("texture source asset id must identify a SurfaceTexture record");
    }
    Ok(id)
}

fn texture_output_format(purpose: &str) -> Result<TexturePixelFormat> {
    match purpose {
        "terrain-color" | "terrain-detail" => Ok(TexturePixelFormat::Rgba8),
        "terrain-blend-mask" | "terrain-road-mask" => Ok(TexturePixelFormat::R8),
        _ => anyhow::bail!("unsupported texture purpose {purpose:?} for terrain pixel loading"),
    }
}

fn texture_pixel_format_name(format: TexturePixelFormat) -> &'static str {
    match format {
        TexturePixelFormat::Rgba8 => "rgba8",
        TexturePixelFormat::R8 => "r8",
    }
}

fn format_error(error: anyhow::Error) -> String {
    format!("{error:#}")
}

fn surface_texture_asset_id(texture_id: u32) -> String {
    format!("surface-texture/0x{texture_id:08x}")
}

fn alpha_maps(
    maps: &[holtburger_content::ResolvedTerrainAlphaMap],
) -> Vec<TerrainAlphaMapManifest> {
    maps.iter()
        .map(|map| TerrainAlphaMapManifest {
            terrain_code: map.selector,
            blend_mask_texture_id: surface_texture_asset_id(map.texture_id),
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerrainSourceManifest {
    transport: &'static str,
    version: u32,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    landblock_id: String,
    region_number: u32,
    terrain: Option<TerrainManifest>,
    /// Distinguishes an absent outdoor record from a source or assembly failure.
    terrain_availability: TerrainAvailabilityManifest,
    composition: TerrainCompositionManifest,
    sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TerrainAvailabilityManifest {
    Available,
    MissingCellLandblock,
    CellLandblockDecodeFailed,
    TerrainAssemblyFailed,
}

fn terrain_availability(
    terrain: Option<&TerrainGridSource>,
    diagnostics: &holtburger_content::PreparedContentSourceDiagnostics,
) -> TerrainAvailabilityManifest {
    if terrain.is_some() {
        return TerrainAvailabilityManifest::Available;
    }

    match diagnostics
        .source_records
        .iter()
        .find(|record| record.role == "cell-landblock")
        .map(|record| record.status)
    {
        Some(SourceRecordStatus::Missing) => TerrainAvailabilityManifest::MissingCellLandblock,
        Some(SourceRecordStatus::DecodeFailed) => {
            TerrainAvailabilityManifest::CellLandblockDecodeFailed
        }
        Some(SourceRecordStatus::Loaded) | None => {
            TerrainAvailabilityManifest::TerrainAssemblyFailed
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerrainManifest {
    grid_size: usize,
    tile_size: f32,
}

impl From<&TerrainGridSource> for TerrainManifest {
    fn from(terrain: &TerrainGridSource) -> Self {
        Self {
            grid_size: terrain.grid_size,
            tile_size: terrain.tile_size,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerrainCompositionManifest {
    /// Region identity consumed by frontend texture-array ownership and composition lookup keys.
    region_number: u32,
    terrain_types: Vec<TerrainMaterialManifest>,
    corner_terrain_alpha_maps: Vec<TerrainAlphaMapManifest>,
    side_terrain_alpha_maps: Vec<TerrainAlphaMapManifest>,
    road_alpha_maps: Vec<TerrainRoadAlphaMapManifest>,
    landscape_detail: LandscapeDetailManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerrainMaterialManifest {
    terrain_type: u32,
    color_texture_id: String,
    tiling: u32,
    color_variation: TerrainColorVariationManifest,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerrainColorVariationManifest {
    min_vertex_brightness: u32,
    max_vertex_brightness: u32,
    min_vertex_saturation: u32,
    max_vertex_saturation: u32,
    min_vertex_hue: u32,
    max_vertex_hue: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerrainAlphaMapManifest {
    terrain_code: u32,
    blend_mask_texture_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerrainRoadAlphaMapManifest {
    road_code: u32,
    road_mask_texture_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LandscapeDetailManifest {
    texture_id: String,
    tiling: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BinarySectionManifest {
    name: &'static str,
    scalar_type: &'static str,
    element_count: usize,
    byte_offset: usize,
    byte_length: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TexturePixelsManifest {
    transport: &'static str,
    version: u32,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    source_asset_id: String,
    purpose: String,
    surface: TexturePixelsSurfaceManifest,
    sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TexturePixelsSurfaceManifest {
    render_surface_id: String,
    format: &'static str,
    width: u32,
    height: u32,
}

fn terrain_sections(terrain: &TerrainGridSource) -> Vec<BinarySectionManifest> {
    let height_indices_length = terrain.height_indices.len();
    let heights_offset =
        align_binary_section_offset(height_indices_length, std::mem::align_of::<f32>());
    let heights_length = terrain.heights.len() * std::mem::size_of::<f32>();
    let terrain_samples_offset = heights_offset + heights_length;
    let terrain_samples_length = terrain.terrain_samples.len() * std::mem::size_of::<u16>();
    vec![
        BinarySectionManifest {
            name: "heightIndices",
            scalar_type: "u8",
            element_count: terrain.height_indices.len(),
            byte_offset: 0,
            byte_length: height_indices_length,
        },
        BinarySectionManifest {
            name: "heights",
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
    ]
}

fn align_binary_section_offset(offset: usize, alignment: usize) -> usize {
    offset.next_multiple_of(alignment)
}

fn serialize_terrain_source_binary(
    manifest: &TerrainSourceManifest,
    terrain: Option<&TerrainGridSource>,
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(&manifest)?;
    while !(TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let manifest_length = manifest_bytes.len();
    let section_data_length = manifest
        .sections
        .iter()
        .map(|section| section.byte_offset + section.byte_length)
        .max()
        .unwrap_or_default();
    let total_length =
        TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len() + section_data_length;
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(TERRAIN_SOURCE_BINARY_MAGIC);
    bytes.extend(TERRAIN_SOURCE_BINARY_VERSION.to_le_bytes());
    bytes.extend(u32::try_from(manifest_length)?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    if let Some(terrain) = terrain {
        bytes.extend(&terrain.height_indices);
        bytes.resize(
            TERRAIN_SOURCE_BINARY_HEADER_LEN
                + manifest_length
                + align_binary_section_offset(
                    terrain.height_indices.len(),
                    std::mem::align_of::<f32>(),
                ),
            0,
        );
        for height in &terrain.heights {
            bytes.extend(height.to_le_bytes());
        }
        for terrain_sample in &terrain.terrain_samples {
            bytes.extend(terrain_sample.to_le_bytes());
        }
    }
    Ok(bytes)
}

fn serialize_texture_pixels_binary(
    manifest: &TexturePixelsManifest,
    pixels: &[u8],
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length = TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len() + pixels.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(TEXTURE_PIXELS_BINARY_MAGIC);
    bytes.extend(TEXTURE_PIXELS_BINARY_VERSION.to_le_bytes());
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(pixels);
    Ok(bytes)
}

pub fn run() {
    let content_state = HostContentState::discover()
        .expect("failed to initialize Holtburger 3D content repository from configured content");
    tauri::Builder::default()
        .manage(content_state)
        .invoke_handler(tauri::generate_handler![
            host_status,
            load_terrain_source,
            load_texture_pixels
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Holtburger 3D host");
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::PixelFormatId;
    use holtburger_dat::{DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaWriter};
    use tempfile::tempdir;

    #[test]
    fn terrain_source_binary_aligns_and_describes_each_grid_section() {
        let terrain = TerrainGridSource {
            grid_size: 3,
            tile_size: 24.0,
            height_indices: (0..9).collect(),
            heights: (0..9).map(|value| value as f32 + 0.5).collect(),
            terrain_samples: (10..19).collect(),
        };
        let manifest = TerrainSourceManifest {
            transport: "holtburger-terrain-source",
            version: TERRAIN_SOURCE_BINARY_VERSION,
            byte_order: "little-endian",
            section_byte_offset_base: "section-data",
            landblock_id: "0x0102ffff".to_string(),
            region_number: 1,
            terrain: Some(TerrainManifest::from(&terrain)),
            terrain_availability: TerrainAvailabilityManifest::Available,
            composition: TerrainCompositionManifest {
                region_number: 1,
                terrain_types: Vec::new(),
                corner_terrain_alpha_maps: Vec::new(),
                side_terrain_alpha_maps: Vec::new(),
                road_alpha_maps: Vec::new(),
                landscape_detail: LandscapeDetailManifest {
                    texture_id: "surface-texture/0x05000001".to_string(),
                    tiling: 1,
                },
            },
            sections: terrain_sections(&terrain),
        };

        let bytes = serialize_terrain_source_binary(&manifest, Some(&terrain))
            .expect("terrain source binary should serialize");

        assert_eq!(&bytes[..4], TERRAIN_SOURCE_BINARY_MAGIC);
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 1);
        let manifest_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(
            u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize,
            bytes.len()
        );
        let section_data_offset = TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_length;
        let decoded_manifest: serde_json::Value =
            serde_json::from_slice(&bytes[TERRAIN_SOURCE_BINARY_HEADER_LEN..section_data_offset])
                .expect("padded manifest should remain JSON");
        let sections = decoded_manifest["sections"]
            .as_array()
            .expect("manifest should describe binary sections");
        assert_eq!(decoded_manifest["composition"]["regionNumber"], 1);
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[1]["name"], "heights");
        assert_eq!(sections[1]["byteOffset"], 12);
        assert_eq!(sections[2]["byteOffset"], 48);
        assert_eq!(bytes[section_data_offset], 0);
        assert_eq!(bytes[section_data_offset + 8], 8);
    }

    #[test]
    fn landblock_parser_normalizes_cell_suffix() {
        assert_eq!(parse_landblock_id("0x0102abcd").unwrap(), 0x0102ffff);
        assert!(parse_landblock_id("not-a-landblock").is_err());
    }

    #[test]
    fn terrain_availability_keeps_missing_and_decode_failed_records_distinct() {
        let mut missing = holtburger_content::PreparedContentSourceDiagnostics::default();
        missing
            .source_records
            .push(holtburger_content::SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: 0x0102_ffff,
                role: "cell-landblock",
                status: SourceRecordStatus::Missing,
            });
        assert!(matches!(
            terrain_availability(None, &missing),
            TerrainAvailabilityManifest::MissingCellLandblock
        ));

        missing.source_records[0].status = SourceRecordStatus::DecodeFailed;
        assert!(matches!(
            terrain_availability(None, &missing),
            TerrainAvailabilityManifest::CellLandblockDecodeFailed
        ));
    }

    #[test]
    fn texture_pixel_binary_preserves_declared_pixel_section() {
        let manifest = TexturePixelsManifest {
            transport: "holtburger-texture-pixels",
            version: TEXTURE_PIXELS_BINARY_VERSION,
            byte_order: "little-endian",
            section_byte_offset_base: "section-data",
            source_asset_id: "surface-texture/0x05000001".to_string(),
            purpose: "terrain-blend-mask".to_string(),
            surface: TexturePixelsSurfaceManifest {
                render_surface_id: "0x06000001".to_string(),
                format: "r8",
                width: 2,
                height: 2,
            },
            sections: vec![BinarySectionManifest {
                name: "pixels",
                scalar_type: "u8",
                element_count: 4,
                byte_offset: 0,
                byte_length: 4,
            }],
        };
        let bytes = serialize_texture_pixels_binary(&manifest, &[1, 2, 3, 4])
            .expect("texture pixels should serialize");

        assert_eq!(&bytes[..4], TEXTURE_PIXELS_BINARY_MAGIC);
        assert_eq!(
            u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
            TEXTURE_PIXELS_BINARY_VERSION
        );
        let manifest_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(
            u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize,
            bytes.len()
        );
        assert_eq!(
            &bytes[TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_length..],
            &[1, 2, 3, 4]
        );
    }

    #[test]
    fn texture_request_rejects_untyped_or_non_surface_texture_ids() {
        assert_eq!(
            parse_surface_texture_asset_id("surface-texture/0x05001234").unwrap(),
            0x0500_1234
        );
        assert!(parse_surface_texture_asset_id("render-surface/0x06001234").is_err());
        assert!(parse_surface_texture_asset_id("surface-texture/0x06001234").is_err());
        assert_eq!(
            texture_output_format("terrain-road-mask").unwrap(),
            TexturePixelFormat::R8
        );
        assert!(texture_output_format("object-detail").is_err());
    }

    #[tokio::test]
    async fn texture_pixel_response_loads_normalized_content_through_the_runtime() {
        let directory = tempdir().expect("temporary directory should be created");
        let path = directory.path().join("texture-response.hba");
        let mut writer = HbaWriter::new();
        writer.set_compression(false);
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                0x0500_0001,
                DatFileType::SurfaceTexture as u32,
                test_surface_texture_bytes(0x0500_0001, &[0x0600_0001]),
            )
            .expect("surface texture should be added");
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                0x0600_0001,
                DatFileType::Texture as u32,
                test_render_surface_bytes(
                    0x0600_0001,
                    PixelFormatId::A8R8G8B8,
                    &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
                ),
            )
            .expect("render surface should be added");
        writer.write(&path).expect("test HBA should be written");

        let repository = Arc::new(
            ContentRepository::from_hba_path(&path).expect("test repository should be opened"),
        );
        let state = HostContentState::from_repository(repository);
        let bytes = build_texture_pixels_response(
            &state.runtime,
            LoadTexturePixelsRequest {
                kind: "prepared-texture-surface".to_string(),
                purpose: "terrain-color".to_string(),
                source_asset_id: "surface-texture/0x05000001".to_string(),
            },
        )
        .await
        .expect("texture pixels should load through the content runtime");

        assert_eq!(&bytes[..4], TEXTURE_PIXELS_BINARY_MAGIC);
        let manifest_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        let section_data_offset = TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_length;
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes[TERRAIN_SOURCE_BINARY_HEADER_LEN..section_data_offset])
                .expect("response manifest should decode");
        assert_eq!(manifest["surface"]["format"], "rgba8");
        assert_eq!(
            &bytes[section_data_offset..section_data_offset + 4],
            &[3, 2, 1, 4]
        );
    }

    fn test_surface_texture_bytes(id: u32, render_surface_ids: &[u32]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend(id.to_le_bytes());
        bytes.extend(0i32.to_le_bytes());
        bytes.push(1);
        bytes.extend(
            u32::try_from(render_surface_ids.len())
                .unwrap()
                .to_le_bytes(),
        );
        for render_surface_id in render_surface_ids {
            bytes.extend(render_surface_id.to_le_bytes());
        }
        bytes
    }

    fn test_render_surface_bytes(id: u32, format: PixelFormatId, source_data: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend(id.to_le_bytes());
        bytes.extend(0i32.to_le_bytes());
        bytes.extend(2u32.to_le_bytes());
        bytes.extend(2u32.to_le_bytes());
        bytes.extend(format.raw().to_le_bytes());
        bytes.extend(u32::try_from(source_data.len()).unwrap().to_le_bytes());
        bytes.extend(source_data);
        bytes
    }
}
