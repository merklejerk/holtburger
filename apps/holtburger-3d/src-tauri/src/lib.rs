use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_content::{
    ActiveRegionData, ContentDecodeCache, ContentRepository, LandblockTerrain, TexturePixelFormat,
};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, ContentAssetService,
    SurfaceTexturePixelsRequest,
};
use holtburger_dat::file_type::region::{LandSurfType, TerrainDesc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub use landblock_source_batch::LandblockSourceLayer;
pub use sky_source::load_sky_source_bytes;

mod animation_source;
mod audio_source;
mod behavior_hook_source;
mod binary_source_record;
pub mod cell_struct_projection;
mod env_cell_source;
pub mod gfx_obj_geometry;
pub mod interior_seam;
mod landblock_source_batch;
mod object_resource_closure;
mod object_texture;
mod outdoor_static_source;
mod particle_emitter_source;
mod physics_script_source;
pub mod polygon_geometry;
pub mod portal_geometry;
pub mod portal_visibility;
mod sky_source;
mod sound_table_source;
mod source_projection;

use animation_source::serialize_animation_record_binary;
use audio_source::serialize_audio_record_binary;
use binary_source_record::BinarySectionWriter;
use env_cell_source::serialize_env_cell_source_record;
use landblock_source_batch::{
    LandblockSourceBatchRecord, LandblockSourceBatchRequest, LoadedLandblockSourceBatch,
    load_landblock_source_batch as load_landblock_source_batch_asset,
    serialize_landblock_source_batch,
};
use object_resource_closure::ObjectResourceClosure;
use object_texture::{
    ObjectTexturePurpose, PreparedObjectTexture, prepare_object_palette, prepare_object_surface,
};
use outdoor_static_source::{
    OutdoorStaticSourceRecordManifest, serialize_outdoor_static_record_binary,
};
use particle_emitter_source::serialize_particle_emitter_record_binary;
use physics_script_source::serialize_physics_script_record_binary;
use sound_table_source::serialize_sound_table_record_binary;
use source_projection::dat_id;

const TERRAIN_SOURCE_BINARY_MAGIC: &[u8; 4] = b"HBTR";
const BINARY_ENVELOPE_HEADER_LEN: usize = 12;
const TEXTURE_PIXELS_BINARY_MAGIC: &[u8; 4] = b"HBTP";
const ACTIVE_REGION_BINARY_MAGIC: &[u8; 4] = b"HBAR";

/// Managed static-content runtime shared by narrow Tauri commands.
#[derive(Clone)]
struct HostContentState {
    runtime: ContentAssetRuntime,
}

impl HostContentState {
    fn discover() -> Result<Self> {
        let repository = Arc::new(ContentRepository::discover(None)?);
        Self::from_repository(repository)
    }

    /// Builds the app-local host state from an already discovered or injected repository.
    fn from_repository(repository: Arc<ContentRepository>) -> Result<Self> {
        let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
        Ok(Self {
            runtime: ContentAssetRuntime::new(service),
        })
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
struct LoadLandblockSourceBatchRequest {
    landblock_id: String,
    layers: Vec<LandblockSourceLayer>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadTexturePixelsRequest {
    kind: String,
    purpose: String,
    source_asset_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadAnimationRequest {
    animation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadPhysicsScriptRequest {
    script_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadParticleEmitterRequest {
    emitter_info_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadAudioRequest {
    sound_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadSoundTableRequest {
    sound_table_id: String,
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
        status: "landblock-source-batch-host-ready",
    }
}

/// Loads the active content scope's immutable regional static data once per frontend runtime.
#[tauri::command]
async fn load_active_region_data(
    state: tauri::State<'_, HostContentState>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_active_region_data_bytes(&state.runtime)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads one normalized outdoor landblock's requested source records as a closed binary batch.
#[tauri::command]
async fn load_landblock_source_batch(
    state: tauri::State<'_, HostContentState>,
    request: LoadLandblockSourceBatchRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes =
        load_landblock_source_batch_bytes(&state.runtime, &request.landblock_id, request.layers)
            .await
            .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads the active region's closed celestial sky resource set as one binary record.
#[tauri::command]
async fn load_sky_source(
    state: tauri::State<'_, HostContentState>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_sky_source_bytes(&state.runtime)
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

/// Loads one immutable DAT animation as a compact typed binary record.
#[tauri::command]
async fn load_animation(
    state: tauri::State<'_, HostContentState>,
    request: LoadAnimationRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_animation_bytes(&state.runtime, &request.animation_id)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads one immutable DAT physics script as a compact typed binary record.
#[tauri::command]
async fn load_physics_script(
    state: tauri::State<'_, HostContentState>,
    request: LoadPhysicsScriptRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_physics_script_bytes(&state.runtime, &request.script_id)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads one immutable DAT particle-emitter definition as a compact typed binary record.
#[tauri::command]
async fn load_particle_emitter(
    state: tauri::State<'_, HostContentState>,
    request: LoadParticleEmitterRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_particle_emitter_bytes(&state.runtime, &request.emitter_info_id)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads one immutable DAT audio asset as a decoder-ready binary record.
#[tauri::command]
async fn load_audio(
    state: tauri::State<'_, HostContentState>,
    request: LoadAudioRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_audio_bytes(&state.runtime, &request.sound_id)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads one immutable DAT sound table as a compact typed binary record.
#[tauri::command]
async fn load_sound_table(
    state: tauri::State<'_, HostContentState>,
    request: LoadSoundTableRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_sound_table_bytes(&state.runtime, &request.sound_table_id)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Builds the canonical landblock source batch used by Tauri and the headless browser harness.
pub async fn load_landblock_source_batch_bytes(
    runtime: &ContentAssetRuntime,
    raw_landblock_id: &str,
    layers: Vec<LandblockSourceLayer>,
) -> Result<Vec<u8>> {
    let landblock_id = parse_landblock_id(raw_landblock_id)?;
    let request = LandblockSourceBatchRequest::new(landblock_id, layers)?;
    build_landblock_source_batch_response(runtime, request).await
}

/// Build the canonical active-region response used by Tauri and the headless browser harness.
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

/// Build the canonical typed animation response used by Tauri and focused host tests.
pub async fn load_animation_bytes(
    runtime: &ContentAssetRuntime,
    raw_animation_id: &str,
) -> Result<Vec<u8>> {
    let animation_id = parse_typed_dat_id(raw_animation_id, 0x03)?;
    let asset = runtime
        .load(ContentAssetRequest::Animation(animation_id))
        .await
        .with_context(|| format!("Could not load Animation 0x{animation_id:08X}"))?;
    let ContentAsset::Animation(animation) = asset else {
        unreachable!("Animation request must return an Animation")
    };
    serialize_animation_record_binary(&animation)
}

/// Build the canonical typed physics-script response used by Tauri and focused host tests.
pub async fn load_physics_script_bytes(
    runtime: &ContentAssetRuntime,
    raw_script_id: &str,
) -> Result<Vec<u8>> {
    let script_id = parse_typed_dat_id(raw_script_id, 0x33)?;
    let asset = runtime
        .load(ContentAssetRequest::PhysicsScript(script_id))
        .await
        .with_context(|| format!("Could not load PhysicsScript 0x{script_id:08X}"))?;
    let ContentAsset::PhysicsScript(script) = asset else {
        unreachable!("PhysicsScript request must return a PhysicsScript")
    };
    serialize_physics_script_record_binary(&script)
}

/// Build the canonical typed particle-emitter response used by Tauri and focused host tests.
pub async fn load_particle_emitter_bytes(
    runtime: &ContentAssetRuntime,
    raw_emitter_info_id: &str,
) -> Result<Vec<u8>> {
    let emitter_info_id = parse_typed_dat_id(raw_emitter_info_id, 0x32)?;
    let asset = runtime
        .load(ContentAssetRequest::ParticleEmitterInfo(emitter_info_id))
        .await
        .with_context(|| format!("Could not load ParticleEmitterInfo 0x{emitter_info_id:08X}"))?;
    let ContentAsset::ParticleEmitterInfo(info) = asset else {
        unreachable!("ParticleEmitterInfo request must return a ParticleEmitterInfo")
    };
    serialize_particle_emitter_record_binary(&info)
}

/// Build the canonical typed audio response used by Tauri and focused host tests.
pub async fn load_audio_bytes(
    runtime: &ContentAssetRuntime,
    raw_sound_id: &str,
) -> Result<Vec<u8>> {
    let sound_id = parse_typed_dat_id(raw_sound_id, 0x0A)?;
    let asset = runtime
        .load(ContentAssetRequest::Wave(sound_id))
        .await
        .with_context(|| format!("Could not load Wave 0x{sound_id:08X}"))?;
    let ContentAsset::Wave(wave) = asset else {
        unreachable!("Wave request must return a Wave")
    };
    serialize_audio_record_binary(&wave)
}

/// Build the canonical typed sound-table response used by Tauri and focused host tests.
pub async fn load_sound_table_bytes(
    runtime: &ContentAssetRuntime,
    raw_sound_table_id: &str,
) -> Result<Vec<u8>> {
    let sound_table_id = parse_typed_dat_id(raw_sound_table_id, 0x20)?;
    let asset = runtime
        .load(ContentAssetRequest::SoundTable(sound_table_id))
        .await
        .with_context(|| format!("Could not load SoundTable 0x{sound_table_id:08X}"))?;
    let ContentAsset::SoundTable(table) = asset else {
        unreachable!("SoundTable request must return a SoundTable")
    };
    serialize_sound_table_record_binary(&table)
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
            LandblockSourceLayer::Buildings => {
                serialize_outdoor_static_source_record(runtime, &source_batch, layer).await?
            }
            LandblockSourceLayer::Objects => {
                serialize_outdoor_static_source_record(runtime, &source_batch, layer).await?
            }
            LandblockSourceLayer::Generated => {
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

    let mut closure = ObjectResourceClosure::default();
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
        definitions: closure.definitions,
        geometries: closure.geometries,
        materials: closure.materials.into_values().collect(),
        texture_dependencies: closure.texture_dependencies.into_values().collect(),
        sections,
    };
    serialize_outdoor_static_record_binary(&manifest, section_bytes)
}

async fn build_texture_pixels_response(
    runtime: &ContentAssetRuntime,
    request: LoadTexturePixelsRequest,
) -> Result<Vec<u8>> {
    let (source_asset_id, source_record_id, prepared) = match request.kind.as_str() {
        "prepared-texture-surface" => {
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
            let format = match pixels.format {
                TexturePixelFormat::Rgba8 => object_texture::PreparedObjectTextureFormat::Rgba8,
                TexturePixelFormat::R8 => object_texture::PreparedObjectTextureFormat::R8,
            };
            (
                surface_texture_asset_id(surface_texture_id),
                dat_id(pixels.render_surface_id),
                PreparedObjectTexture {
                    format,
                    width: pixels.width,
                    height: pixels.height,
                    pixels: pixels.pixels,
                },
            )
        }
        "prepared-object-texture" => {
            let surface_texture_id = parse_surface_texture_asset_id(&request.source_asset_id)?;
            let purpose = object_texture_purpose(&request.purpose)?;
            let surface = load_object_render_surface(runtime, surface_texture_id).await?;
            let source_record_id = dat_id(surface.id);
            let prepared = prepare_object_surface(&surface, purpose)?;
            (
                surface_texture_asset_id(surface_texture_id),
                source_record_id,
                prepared,
            )
        }
        "prepared-object-palette" => {
            if request.purpose != "object-palette" {
                anyhow::bail!("prepared-object-palette requires object-palette purpose");
            }
            let palette_id = parse_palette_asset_id(&request.source_asset_id)?;
            let asset = runtime
                .load(ContentAssetRequest::Palette(palette_id))
                .await?;
            let ContentAsset::Palette(palette) = asset else {
                unreachable!("palette request must return a palette")
            };
            let prepared = prepare_object_palette(&palette)?;
            (palette_asset_id(palette_id), dat_id(palette.id), prepared)
        }
        _ => anyhow::bail!("unsupported texture request kind {:?}", request.kind),
    };
    let manifest = TexturePixelsManifest {
        transport: "holtburger-texture-pixels",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        source_asset_id,
        purpose: request.purpose,
        surface: TexturePixelsSurfaceManifest {
            source_record_id,
            format: prepared.format.name(),
            width: prepared.width,
            height: prepared.height,
        },
        sections: vec![BinarySectionManifest {
            name: "pixels",
            scalar_type: "u8",
            element_count: prepared.pixels.len(),
            byte_offset: 0,
            byte_length: prepared.pixels.len(),
        }],
    };
    serialize_texture_pixels_binary(&manifest, &prepared.pixels)
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
    parse_typed_asset_id(raw_asset_id, "surface-texture/", 0x05)
}

fn parse_palette_asset_id(raw_asset_id: &str) -> Result<u32> {
    parse_typed_asset_id(raw_asset_id, "palette/", 0x04)
}

fn parse_typed_asset_id(raw_asset_id: &str, prefix: &str, expected_type: u32) -> Result<u32> {
    let raw_id = raw_asset_id
        .strip_prefix(prefix)
        .with_context(|| format!("asset id must start with {prefix:?}"))?;
    parse_typed_dat_id(raw_id, expected_type)
}

fn parse_typed_dat_id(raw_id: &str, expected_type: u32) -> Result<u32> {
    let raw_hex = raw_id
        .strip_prefix("0x")
        .or_else(|| raw_id.strip_prefix("0X"))
        .unwrap_or(raw_id);
    if raw_hex.len() != 8
        || !raw_hex
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("asset id must contain exactly eight hexadecimal digits");
    }
    let id = u32::from_str_radix(raw_hex, 16).context("asset id is not hexadecimal")?;
    if id >> 24 != expected_type {
        anyhow::bail!("asset id must identify DAT family 0x{expected_type:02X}");
    }
    Ok(id)
}

fn object_texture_purpose(raw: &str) -> Result<ObjectTexturePurpose> {
    match raw {
        "object-direct-color" => Ok(ObjectTexturePurpose::DirectColor),
        "object-index-8" => Ok(ObjectTexturePurpose::Index8),
        "object-index-16" => Ok(ObjectTexturePurpose::Index16),
        "object-detail" => Ok(ObjectTexturePurpose::Detail),
        _ => anyhow::bail!("unsupported object texture purpose {raw:?}"),
    }
}

async fn load_object_render_surface(
    runtime: &ContentAssetRuntime,
    surface_texture_id: u32,
) -> Result<Box<holtburger_dat::file_type::RenderSurface>> {
    let texture_asset = runtime
        .load(ContentAssetRequest::SurfaceTexture(surface_texture_id))
        .await
        .with_context(|| format!("Could not load SurfaceTexture 0x{surface_texture_id:08X}"))?;
    let ContentAsset::SurfaceTexture(texture) = texture_asset else {
        unreachable!("surface texture request must return a surface texture")
    };
    for render_surface_id in texture.render_surface_ids {
        if let Ok(ContentAsset::RenderSurface(surface)) = runtime
            .load(ContentAssetRequest::RenderSurface(render_surface_id))
            .await
        {
            return Ok(surface);
        }
    }
    anyhow::bail!("SurfaceTexture 0x{surface_texture_id:08X} has no available RenderSurface level")
}

fn texture_output_format(purpose: &str) -> Result<TexturePixelFormat> {
    match purpose {
        "terrain-color" | "terrain-detail" => Ok(TexturePixelFormat::Rgba8),
        "terrain-blend-mask" | "terrain-road-mask" => Ok(TexturePixelFormat::R8),
        _ => anyhow::bail!("unsupported texture purpose {purpose:?} for terrain pixel loading"),
    }
}

fn format_error(error: anyhow::Error) -> String {
    format!("{error:#}")
}

fn surface_texture_asset_id(texture_id: u32) -> String {
    format!("surface-texture/0x{texture_id:08x}")
}

fn palette_asset_id(palette_id: u32) -> String {
    format!("palette/0x{palette_id:08x}")
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerrainSourceManifest {
    transport: &'static str,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    landblock_id: String,
    /// Distinguishes an absent outdoor record from a source or assembly failure.
    terrain_availability: TerrainAvailabilityManifest,
    sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TerrainAvailabilityManifest {
    Available,
    MissingCellLandblock,
}

fn terrain_availability(terrain: Option<&LandblockTerrain>) -> TerrainAvailabilityManifest {
    match terrain {
        Some(_) => TerrainAvailabilityManifest::Available,
        None => TerrainAvailabilityManifest::MissingCellLandblock,
    }
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
    source_record_id: String,
    format: &'static str,
    width: u32,
    height: u32,
}

fn terrain_sections(terrain: &LandblockTerrain) -> Vec<BinarySectionManifest> {
    let height_indices_length = terrain.height_indices.len();
    let heights_offset =
        align_binary_section_offset(height_indices_length, std::mem::align_of::<f32>());
    let heights_length = terrain.heights.len() * std::mem::size_of::<f32>();
    let terrain_samples_offset =
        align_binary_section_offset(heights_offset + heights_length, std::mem::align_of::<u16>());
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
    ]
}

fn align_binary_section_offset(offset: usize, alignment: usize) -> usize {
    offset.next_multiple_of(alignment)
}

fn serialize_terrain_source_binary(
    manifest: &TerrainSourceManifest,
    terrain: Option<&LandblockTerrain>,
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(&manifest)?;
    while !(BINARY_ENVELOPE_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
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
                    for (chunk, height) in target.chunks_exact_mut(4).zip(&terrain.heights) {
                        chunk.copy_from_slice(&height.to_le_bytes());
                    }
                }
                "terrainSamples" => {
                    for (chunk, sample) in target.chunks_exact_mut(2).zip(&terrain.terrain_samples)
                    {
                        chunk.copy_from_slice(&sample.to_le_bytes());
                    }
                }
                _ => unreachable!("terrain sections are fixed"),
            }
        }
        bytes.extend(section_data);
    }
    Ok(bytes)
}

fn serialize_active_region_binary(active_region: &ActiveRegionData) -> Result<Vec<u8>> {
    let manifest = active_region_manifest(active_region);
    let mut manifest_bytes = serde_json::to_vec(&manifest)?;
    while !(BINARY_ENVELOPE_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
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

fn serialize_texture_pixels_binary(
    manifest: &TexturePixelsManifest,
    pixels: &[u8],
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(BINARY_ENVELOPE_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length = BINARY_ENVELOPE_HEADER_LEN + manifest_bytes.len() + pixels.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(TEXTURE_PIXELS_BINARY_MAGIC);
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
            load_active_region_data,
            load_animation,
            load_audio,
            load_sound_table,
            load_particle_emitter,
            load_physics_script,
            load_landblock_source_batch,
            load_sky_source,
            load_texture_pixels
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Holtburger 3D host");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::landblock_source_batch::LANDBLOCK_SOURCE_BATCH_BINARY_MAGIC;
    use crate::object_resource_closure::StaticGeometryBuffers;
    use crate::outdoor_static_source::OUTDOOR_STATIC_RECORD_BINARY_MAGIC;
    use holtburger_dat::file_type::PixelFormatId;
    use holtburger_dat::file_type::region::{GameTime, LandDefs, RegionDesc};
    use holtburger_dat::{DatFileType, EOR_PORTAL_NAMESPACE, HbaWriter};
    use tempfile::tempdir;

    #[test]
    fn terrain_source_binary_aligns_and_describes_each_grid_section() {
        let terrain = LandblockTerrain {
            grid_size: 3,
            tile_size: 24.0,
            height_indices: (0..9).collect(),
            heights: (0..9).map(|value| value as f32 + 0.5).collect(),
            terrain_samples: (10..19).collect(),
        };
        let manifest = TerrainSourceManifest {
            transport: "holtburger-landblock-terrain-record",
            byte_order: "little-endian",
            section_byte_offset_base: "section-data",
            landblock_id: "0x0102ffff".to_string(),
            terrain_availability: TerrainAvailabilityManifest::Available,
            sections: terrain_sections(&terrain),
        };

        let bytes = serialize_terrain_source_binary(&manifest, Some(&terrain))
            .expect("terrain source binary should serialize");

        assert_eq!(&bytes[..4], TERRAIN_SOURCE_BINARY_MAGIC);
        let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        assert_eq!(
            u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize,
            bytes.len()
        );
        let section_data_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
        let decoded_manifest: serde_json::Value =
            serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_data_offset])
                .expect("padded manifest should remain JSON");
        let sections = decoded_manifest["sections"]
            .as_array()
            .expect("manifest should describe binary sections");
        assert_eq!(sections.len(), 3);
        assert_eq!(sections[1]["name"], "resolvedHeights");
        assert_eq!(sections[1]["byteOffset"], 12);
        assert_eq!(sections[2]["name"], "terrainSamples");
        assert_eq!(sections[2]["byteOffset"], 48);
        assert_eq!(bytes[section_data_offset], 0);
        assert_eq!(bytes[section_data_offset + 9], 0);
        assert_eq!(
            f32::from_le_bytes(
                bytes[section_data_offset + 12..section_data_offset + 16]
                    .try_into()
                    .unwrap()
            ),
            0.5
        );
        assert_eq!(bytes[section_data_offset + 48], 10);
    }

    #[test]
    fn outdoor_static_record_binary_aligns_and_describes_geometry_sections() {
        let buffers = StaticGeometryBuffers {
            positions: vec![0.0, 0.0, 0.0],
            normals: vec![0.0, 0.0, 1.0],
            texture_coordinates: vec![0.0, 0.0],
            indices: vec![0, 0, 0],
            material_slots: vec![0],
            material_wrap_modes: vec![1],
            material_side_kinds: vec![0],
            material_side_types: vec![0],
            material_stippling: vec![0],
        };
        let mut section_writer = BinarySectionWriter::default();
        buffers
            .append_sections(&mut section_writer, "")
            .expect("geometry sections should encode");
        let (sections, section_bytes) = section_writer.finish();
        let manifest = OutdoorStaticSourceRecordManifest {
            transport: "holtburger-outdoor-static-record",
            byte_order: "little-endian",
            section_byte_offset_base: "section-data",
            landblock_id: "0x0102ffff".to_string(),
            layer: "buildings",
            residents: Vec::new(),
            definitions: Vec::new(),
            geometries: Vec::new(),
            materials: Vec::new(),
            texture_dependencies: Vec::new(),
            sections,
        };
        let bytes = serialize_outdoor_static_record_binary(&manifest, section_bytes)
            .expect("outdoor static record should serialize");

        assert_eq!(&bytes[..4], OUTDOOR_STATIC_RECORD_BINARY_MAGIC);
        let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let section_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
        let decoded: serde_json::Value =
            serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_offset])
                .expect("outdoor static record manifest should remain JSON");
        assert_eq!(decoded["sections"][0]["name"], "positions");
        assert_eq!(decoded["sections"][4]["name"], "materialSlots");
        assert_eq!(
            u32::from_le_bytes(
                bytes[section_offset + 32..section_offset + 36]
                    .try_into()
                    .unwrap()
            ),
            0
        );
    }

    #[test]
    fn landblock_source_batch_serializes_exactly_the_requested_record_set() {
        let request = LandblockSourceBatchRequest::new(
            0x0102_ffff,
            [
                LandblockSourceLayer::Terrain,
                LandblockSourceLayer::Buildings,
                LandblockSourceLayer::Objects,
                LandblockSourceLayer::Generated,
                LandblockSourceLayer::EnvCells,
            ],
        )
        .expect("source batch request should be valid");
        let bytes = serialize_landblock_source_batch(
            &request,
            vec![
                LandblockSourceBatchRecord {
                    layer: LandblockSourceLayer::Terrain,
                    bytes: vec![1, 2, 3],
                },
                LandblockSourceBatchRecord {
                    layer: LandblockSourceLayer::Buildings,
                    bytes: vec![4, 5],
                },
                LandblockSourceBatchRecord {
                    layer: LandblockSourceLayer::Objects,
                    bytes: vec![6],
                },
                LandblockSourceBatchRecord {
                    layer: LandblockSourceLayer::Generated,
                    bytes: vec![7, 8],
                },
                LandblockSourceBatchRecord {
                    layer: LandblockSourceLayer::EnvCells,
                    bytes: vec![9, 10],
                },
            ],
        )
        .expect("source batch should serialize");

        assert_eq!(&bytes[..4], LANDBLOCK_SOURCE_BATCH_BINARY_MAGIC);
        let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let record_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..record_offset])
                .expect("batch manifest should remain JSON");
        assert_eq!(
            manifest["requestedLayers"],
            serde_json::json!(["terrain", "buildings", "objects", "generated", "env-cells"])
        );
        assert_eq!(manifest["records"].as_array().map(Vec::len), Some(5));
        assert_eq!(&bytes[record_offset..], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }

    #[test]
    fn active_region_binary_projects_semantic_records_and_height_table() {
        let mut land_height_table = [0.0; 256];
        let sample_height_index = land_height_table.len() / 2;
        let expected_height = 42.5;
        land_height_table[sample_height_index] = expected_height;
        let active_region = ActiveRegionData::new(Arc::new(RegionDesc {
            id: 0x1300_0000,
            region_number: 1,
            version: 3,
            region_name: "Dereth".to_owned(),
            land_defs: LandDefs {
                num_block_length: 255,
                num_block_width: 255,
                square_length: 24.0,
                lblock_length: 192,
                vertex_per_cell: 8,
                max_obj_height: 64.0,
                sky_height: 500.0,
                road_width: 1.0,
                land_height_table,
            },
            game_time: GameTime {
                zero_time_of_year: 0.0,
                zero_year: 0,
                day_length: 1.0,
                days_per_year: 365,
                year_spec: "year".to_owned(),
                times_of_day: Vec::new(),
                days_of_the_week: Vec::new(),
                seasons: Vec::new(),
            },
            parts_mask: 0x04,
            sky_info: None,
            sound_info: None,
            scene_info: None,
            terrain_info: Some(TerrainDesc::default()),
            region_misc: None,
        }));

        let bytes = serialize_active_region_binary(&active_region)
            .expect("active-region response should serialize");

        assert_eq!(&bytes[..4], ACTIVE_REGION_BINARY_MAGIC);
        let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let section_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_offset])
                .expect("active-region manifest should remain JSON");
        assert_eq!(manifest["provenance"]["sourceRecordId"], "0x13000000");
        assert_eq!(manifest["data"]["land"]["squareLength"], 24.0);
        assert_eq!(
            manifest["data"]["terrain"]["landSurface"]["kind"],
            "texture-merge"
        );
        assert_eq!(manifest["sections"][0]["name"], "landHeightTable");
        let scalar_size = std::mem::size_of::<f32>();
        let sample_offset = section_offset + sample_height_index * scalar_size;
        assert_eq!(
            f32::from_le_bytes(
                bytes[sample_offset..sample_offset + scalar_size]
                    .try_into()
                    .unwrap()
            ),
            expected_height
        );
    }

    #[test]
    fn landblock_parser_normalizes_cell_suffix() {
        assert_eq!(parse_landblock_id("0x0102abcd").unwrap(), 0x0102ffff);
        assert!(parse_landblock_id("not-a-landblock").is_err());
    }

    #[test]
    fn terrain_availability_represents_only_valid_absence() {
        assert!(matches!(
            terrain_availability(None),
            TerrainAvailabilityManifest::MissingCellLandblock
        ));
    }

    #[test]
    fn texture_pixel_binary_preserves_declared_pixel_section() {
        let manifest = TexturePixelsManifest {
            transport: "holtburger-texture-pixels",
            byte_order: "little-endian",
            section_byte_offset_base: "section-data",
            source_asset_id: "surface-texture/0x05000001".to_string(),
            purpose: "terrain-blend-mask".to_string(),
            surface: TexturePixelsSurfaceManifest {
                source_record_id: "0x06000001".to_string(),
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
        let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        assert_eq!(
            u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize,
            bytes.len()
        );
        assert_eq!(
            &bytes[BINARY_ENVELOPE_HEADER_LEN + manifest_length..],
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
                holtburger_dat::file_type::REGION_DESC_FILE_ID,
                DatFileType::Region as u32,
                test_region_desc_bytes(),
            )
            .expect("active region should be added");
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
        let state = HostContentState::from_repository(repository)
            .expect("test content repository should initialize");
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
        let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let section_data_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_data_offset])
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

    fn test_region_desc_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&holtburger_dat::file_type::REGION_DESC_FILE_ID.to_le_bytes());
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u32.to_le_bytes());
        push_test_pstring(&mut bytes, "");
        bytes.resize(bytes.len() + 32 + 256 * 4, 0);
        bytes.resize(bytes.len() + 8 + 4 + 4 + 4, 0);
        push_test_pstring(&mut bytes, "");
        bytes.extend_from_slice(&0_u32.to_le_bytes());
        bytes.extend_from_slice(&0_u32.to_le_bytes());
        bytes.extend_from_slice(&0_u32.to_le_bytes());
        bytes.extend_from_slice(&0_u32.to_le_bytes());
        bytes
    }

    fn push_test_pstring(bytes: &mut Vec<u8>, value: &str) {
        bytes.extend_from_slice(&(value.len() as u16).to_le_bytes());
        bytes.extend_from_slice(value.as_bytes());
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
    }
}
