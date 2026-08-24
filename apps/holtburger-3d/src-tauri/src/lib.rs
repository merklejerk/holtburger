use std::sync::Arc;

use anyhow::{Context, Result, bail, ensure};
use holtburger_content::{
    ActiveRegionData, ContentDecodeCache, ContentRepository, LandblockTerrain, TexturePixelFormat,
};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, ContentAssetService,
    SurfaceTexturePixelsRequest,
};
use holtburger_dat::file_type::region::{LandSurfType, TerrainDesc};
use holtburger_dat::file_type::{Palette, PaletteRange};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::Emitter;

pub use landblock_source_batch::LandblockSourceLayer;
pub use sky_source::load_sky_source_bytes;

mod animation_source;
mod audio_source;
mod behavior_hook_source;
mod binary_source_record;
pub mod cell_struct_projection;
pub mod dynamic_entity_visual_source;
mod env_cell_source;
pub mod explorer_entity_delivery;
pub mod explorer_entity_driver;
pub mod explorer_entity_runtime;
mod explorer_entity_simulation;
pub mod explorer_possession_control;
pub mod explorer_weenie_catalog;
pub mod gfx_obj_geometry;
mod host_fixed_tick_runtime;
pub mod host_kinematic_boom_runtime;
mod host_physical_fly_runtime;
pub mod host_simulation_runtime;
pub mod interior_seam;
mod landblock_profile;
mod landblock_source_batch;
mod map_geometry;
mod object_resource_closure;
mod object_texture;
mod outdoor_static_source;
mod particle_emitter_source;
mod particle_mesh_source;
mod physics_script_source;
pub mod placed_motion_presentation;
pub mod polygon_geometry;
pub mod portal_geometry;
pub mod portal_visibility;
mod sky_source;
mod sound_table_source;
mod source_projection;
mod weenie_appearance;

use animation_source::serialize_animation_record_binary;
use audio_source::serialize_audio_record_binary;
use binary_source_record::BinarySectionWriter;
use env_cell_source::serialize_env_cell_source_record;
use gfx_obj_geometry::build_gfx_obj_portal_apertures;
use landblock_profile::{LandblockProfile, project_landblock_profile};
use landblock_source_batch::{
    LandblockSourceBatchRecord, LandblockSourceBatchRequest, LoadedLandblockSourceBatch,
    load_landblock_source_batch as load_landblock_source_batch_asset,
    serialize_landblock_source_batch,
};
use map_geometry::build_blocker_silhouette_geometry;
use object_resource_closure::ObjectResourceClosure;
use object_texture::{
    ObjectTexturePurpose, PreparedObjectTexture, prepare_object_palette, prepare_object_surface,
};
use outdoor_static_source::{
    OutdoorStaticSourceRecordManifest, serialize_outdoor_static_record_binary,
};
use particle_emitter_source::serialize_particle_emitter_record_binary;
use particle_mesh_source::load_particle_mesh_bytes;
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
    /// Immutable repository used by app-local dynamic-entity preparation.
    repository: Arc<ContentRepository>,
    /// Shared synchronous service used to realize explicitly requested simulation collision.
    service: Arc<ContentAssetService>,
}

impl HostContentState {
    fn discover() -> Result<Self> {
        let repository = Arc::new(ContentRepository::discover(None)?);
        Self::from_repository(repository)
    }

    /// Builds the app-local host state from an already discovered or injected repository.
    fn from_repository(repository: Arc<ContentRepository>) -> Result<Self> {
        let service =
            ContentAssetService::new(Arc::clone(&repository), Arc::new(ContentDecodeCache::new()));
        Ok(Self {
            runtime: ContentAssetRuntime::new(service.clone()),
            repository,
            service: Arc::new(service),
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
struct LoadLandblockProfileRequest {
    landblock_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTexturePixelsRequest {
    kind: String,
    purpose: String,
    /// Identity of the requested texture, echoed back so a caller can match its response.
    ///
    /// For a composited palette this is the composition's identity rather than a DAT id, because
    /// several compositions share one base palette.
    source_asset_id: String,
    /// Recipe for a composited palette. Present only for a palette request whose material carries
    /// an ObjDesc composition; the host never derives it from `source_asset_id`.
    #[serde(default)]
    palette_composite: Option<LoadPaletteCompositeRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadPaletteCompositeRequest {
    base_palette_id: String,
    ranges: Vec<LoadPaletteRangeRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadPaletteRangeRequest {
    replacement_palette_id: String,
    offset: u32,
    color_count: u32,
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadParticleMeshesRequest {
    hw_gfx_obj_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadDynamicEntityVisualRequest {
    setup_did: u32,
    appearance: holtburger_world::EntityAppearance,
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

/// Loads the normalized shallow landblock profile used to choose scene-interest coverage.
#[tauri::command]
async fn load_landblock_profile(
    state: tauri::State<'_, HostContentState>,
    request: LoadLandblockProfileRequest,
) -> Result<Option<LandblockProfile>, String> {
    load_landblock_profile_response(&state.runtime, &request.landblock_id)
        .await
        .map_err(format_error)
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
    let bytes = load_texture_pixels_bytes(&state.runtime, request)
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

/// Loads one exact SetupModel appearance and its complete immutable render-resource closure.
#[tauri::command]
async fn load_dynamic_entity_visual(
    state: tauri::State<'_, HostContentState>,
    request: LoadDynamicEntityVisualRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = dynamic_entity_visual_source::load_dynamic_entity_visual_source_bytes(
        &state.runtime,
        request.setup_did,
        request.appearance,
    )
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

/// Loads the geometry and material closure for one batch of particle meshes.
#[tauri::command]
async fn load_particle_meshes(
    state: tauri::State<'_, HostContentState>,
    request: LoadParticleMeshesRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_particle_meshes_bytes(&state.runtime, &request.hw_gfx_obj_ids)
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

/// Builds the canonical profile response used by Tauri and the development HTTP host.
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

/// Build the canonical texture-pixel response used by Tauri and the headless browser harness.
///
/// Covers every request kind: terrain surfaces, object surfaces, and palettes both authored and
/// composited.
pub async fn load_texture_pixels_bytes(
    runtime: &ContentAssetRuntime,
    request: LoadTexturePixelsRequest,
) -> Result<Vec<u8>> {
    build_texture_pixels_response(runtime, request).await
}

/// Every animation one motion table can reach, as canonical dat ids in stable order.
///
/// Shared by the Tauri command and the dev content host so the browser harness stages the same
/// closure the app does; a harness that could not stage one could not exercise motion at all.
pub fn load_motion_table_closure_ids(
    motion: &holtburger_content::MotionSequenceCatalog,
    raw_motion_table_id: &str,
) -> Result<Vec<String>> {
    let motion_table_id = parse_typed_dat_id(raw_motion_table_id, 0x09)?;
    let table = motion
        .table(motion_table_id)
        .with_context(|| format!("Motion table 0x{motion_table_id:08X} is not in the contract."))?;
    let mut animations: Vec<u32> = table.reachable_animation_ids().collect();
    animations.sort_unstable();
    Ok(animations
        .into_iter()
        .map(source_projection::dat_id)
        .collect())
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
    if info.hw_gfx_obj_id == 0 {
        return serialize_particle_emitter_record_binary(&info, None);
    }
    ensure!(
        info.hw_gfx_obj_id >> 24 == 0x01,
        "ParticleEmitterInfo 0x{:08X} hardware mesh 0x{:08X} is not a GfxObj",
        info.id,
        info.hw_gfx_obj_id
    );
    let mesh_asset = runtime
        .load(ContentAssetRequest::GfxObj(info.hw_gfx_obj_id))
        .await
        .with_context(|| {
            format!(
                "Could not load ParticleEmitterInfo 0x{:08X} hardware mesh 0x{:08X}",
                info.id, info.hw_gfx_obj_id
            )
        })?;
    let ContentAsset::GfxObj(mesh) = mesh_asset else {
        unreachable!("GfxObj request must return a GfxObj")
    };
    serialize_particle_emitter_record_binary(&info, Some(&mesh))
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

/// Build the canonical typed particle-mesh response used by Tauri and focused host tests.
pub async fn load_particle_meshes_bytes(
    runtime: &ContentAssetRuntime,
    raw_hw_gfx_obj_ids: &[String],
) -> Result<Vec<u8>> {
    let gfx_obj_ids = raw_hw_gfx_obj_ids
        .iter()
        .map(|raw| parse_typed_dat_id(raw, 0x01))
        .collect::<Result<Vec<_>>>()?;
    load_particle_mesh_bytes(runtime, &gfx_obj_ids).await
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
    statics: &[landblock_source_batch::OutdoorStaticResident],
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
            match &request.palette_composite {
                None => {
                    let palette_id = parse_palette_asset_id(&request.source_asset_id)?;
                    let palette = load_palette(runtime, palette_id).await?;
                    let prepared = prepare_object_palette(&palette)?;
                    (palette_asset_id(palette_id), dat_id(palette.id), prepared)
                }
                Some(composite) => {
                    let palette = composite_palette(runtime, composite).await?;
                    let prepared = prepare_object_palette(&palette)?;
                    // The composition's identity, not the base palette's id: several compositions
                    // share one base, and the caller keyed its request on the identity.
                    (
                        request.source_asset_id.clone(),
                        dat_id(palette.id),
                        prepared,
                    )
                }
            }
        }
        _ => anyhow::bail!("unsupported texture request kind {:?}", request.kind),
    };
    let surface = TexturePixelsSurfaceFields {
        source_record_id,
        format: prepared.format.name(),
        width: prepared.width,
        height: prepared.height,
    };
    let surface = if request.purpose == "terrain-color" {
        TexturePixelsSurfaceManifest::TerrainColor {
            surface,
            mean_rgb: mean_rgb_rgba8(prepared.width, prepared.height, &prepared.pixels)?,
        }
    } else {
        TexturePixelsSurfaceManifest::Conventional(surface)
    };
    let manifest = TexturePixelsManifest {
        transport: "holtburger-texture-pixels",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        source_asset_id,
        purpose: request.purpose,
        surface,
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

async fn load_palette(runtime: &ContentAssetRuntime, palette_id: u32) -> Result<Arc<Palette>> {
    let asset = runtime
        .load(ContentAssetRequest::Palette(palette_id))
        .await?;
    let ContentAsset::Palette(palette) = asset else {
        unreachable!("palette request must return a palette")
    };
    Ok(palette)
}

/// Materialize one requested palette composition.
///
/// The decision to apply it was already made while resolving the appearance; this only realizes
/// the pixels for an identity that decision produced, so a refused range here means the request
/// and the resolution disagree.
async fn composite_palette(
    runtime: &ContentAssetRuntime,
    composite: &LoadPaletteCompositeRequest,
) -> Result<Palette> {
    let base_palette_id = parse_typed_dat_id(&composite.base_palette_id, 0x04)?;
    let base = load_palette(runtime, base_palette_id).await?;
    let mut replacements = Vec::with_capacity(composite.ranges.len());
    for range in &composite.ranges {
        let palette_id = parse_typed_dat_id(&range.replacement_palette_id, 0x04)?;
        replacements.push(load_palette(runtime, palette_id).await?);
    }
    let ranges = composite
        .ranges
        .iter()
        .zip(&replacements)
        .map(|(range, replacement)| PaletteRange {
            replacement,
            offset: range.offset,
            color_count: range.color_count,
        })
        .collect::<Vec<_>>();

    base.composite(&ranges).with_context(|| {
        format!("Could not composite palette 0x{base_palette_id:08X} for a requested appearance")
    })
}

fn parse_typed_asset_id(raw_asset_id: &str, prefix: &str, expected_type: u32) -> Result<u32> {
    let raw_id = raw_asset_id
        .strip_prefix(prefix)
        .with_context(|| format!("asset id must start with {prefix:?}"))?;
    parse_typed_dat_id(raw_id, expected_type)
}

fn parse_typed_dat_id(raw_id: &str, expected_type: u32) -> Result<u32> {
    let id = parse_hex_id(raw_id, "asset id")?;
    if id >> 24 != expected_type {
        anyhow::bail!("asset id must identify DAT family 0x{expected_type:02X}");
    }
    Ok(id)
}

/// Parse the common textual representation without imposing domain-specific bit semantics.
fn parse_hex_id(raw_id: &str, label: &str) -> Result<u32> {
    let raw_hex = raw_id
        .strip_prefix("0x")
        .or_else(|| raw_id.strip_prefix("0X"))
        .unwrap_or(raw_id);
    if raw_hex.len() != 8
        || !raw_hex
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("{label} must contain exactly eight hexadecimal digits");
    }
    let id =
        u32::from_str_radix(raw_hex, 16).with_context(|| format!("{label} is not hexadecimal"))?;
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

/// Registers one host-owned physical camera body at the currently presented Explorer pose.
#[tauri::command]
async fn start_physical_fly(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<host_physical_fly_runtime::HostPhysicalFlyRuntime>>,
    registration: host_physical_fly_runtime::PhysicalFlyRegistration,
) -> Result<host_physical_fly_runtime::PhysicalFlyStartReceipt, String> {
    let runtime = Arc::clone(&runtime);
    let registration_runtime = Arc::clone(&runtime);
    let session = tokio::task::spawn_blocking(move || registration_runtime.start(registration))
        .await
        .map_err(|error| format!("physical camera registration task failed: {error}"))?
        .map_err(format_error)?;
    if !runtime.schedule(app, session) {
        return Err("physical camera registration was superseded before scheduling".to_string());
    }
    Ok(host_physical_fly_runtime::PhysicalFlyStartReceipt::new(
        session,
    ))
}

/// Replaces the world-space velocity consumed by the next fixed host tick.
#[tauri::command]
fn set_physical_fly_intent(
    runtime: tauri::State<'_, Arc<host_physical_fly_runtime::HostPhysicalFlyRuntime>>,
    intent: host_physical_fly_runtime::PhysicalFlyIntent,
) -> Result<(), String> {
    runtime.set_intent(intent).map_err(format_error)
}

/// Returns position authority to frontend free fly and invalidates the old tick generation.
#[tauri::command]
fn stop_physical_fly(
    runtime: tauri::State<'_, Arc<host_physical_fly_runtime::HostPhysicalFlyRuntime>>,
    session: u64,
) {
    runtime.stop(session);
}

/// Replaces the complete frontend-owned collision simulation interest.
#[tauri::command]
async fn replace_simulation_interest(
    runtime: tauri::State<'_, Arc<host_simulation_runtime::HostSimulationRuntime>>,
    request: host_simulation_runtime::SimulationInterestRequest,
) -> Result<host_simulation_runtime::SimulationInterestReceipt, String> {
    let runtime = Arc::clone(&runtime);
    let receipt = tokio::task::spawn_blocking({
        let runtime = Arc::clone(&runtime);
        move || runtime.replace_interest(request)
    })
    .await
    .map_err(|error| format!("simulation-interest replacement task failed: {error}"))?
    .map_err(format_error)?;
    Ok(receipt)
}

/// Opens one frontend simulation-interest lifetime with host-ordered currentness.
#[tauri::command]
fn start_simulation_interest_session(
    runtime: tauri::State<'_, Arc<host_simulation_runtime::HostSimulationRuntime>>,
) -> u64 {
    runtime.reserve_interest_session()
}

/// Stable lifecycle identity returned after one focused Explorer mutation commits and publishes.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExplorerEntityMutationReceipt {
    /// App-local live identity.
    guid: holtburger_common::Guid,
    /// Monotonic instance generation guarding late frontend realization.
    generation: u64,
}

/// Complete effective-state replacement requested by one Explorer scenario.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplaceExplorerEntityPhysicsStateRequest {
    /// Exact current entity identity.
    guid: holtburger_common::Guid,
    /// Exact current instance generation.
    generation: u64,
    /// Complete semantic mask; individual bits are never patched at this boundary.
    semantic_mask: u32,
    /// Explicit local physical realization policy.
    physical_intent: holtburger_world::EntityPhysicalIntent,
}

/// Returns the optional app-local WCID catalog capability without touching entity state.
#[tauri::command]
fn explorer_catalog_capability(
    driver: tauri::State<'_, Arc<explorer_entity_driver::ExplorerEntityDriver>>,
) -> explorer_weenie_catalog::ExplorerCatalogCapability {
    driver.catalog_capability()
}

/// Returns one bounded host-ranked catalog result set without touching entity state.
#[tauri::command]
async fn search_explorer_weenies(
    driver: tauri::State<'_, Arc<explorer_entity_driver::ExplorerEntityDriver>>,
    request: explorer_weenie_catalog::ExplorerWeenieSearchRequest,
) -> Result<Vec<explorer_weenie_catalog::ExplorerWeenieSearchResult>, String> {
    let driver = Arc::clone(&driver);
    tokio::task::spawn_blocking(move || {
        driver
            .search_weenies(&request)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("Explorer weenie search task failed: {error}"))?
}

/// Emits one complete current snapshot after the frontend has installed its listener.
#[tauri::command]
fn request_explorer_dynamic_entity_snapshot(
    app: tauri::AppHandle,
    delivery: tauri::State<'_, Arc<explorer_entity_delivery::ExplorerEntityDelivery>>,
) -> Result<(), String> {
    delivery.with_ordered_publication(|| {
        let event = delivery
            .snapshot_event()
            .map_err(|error| error.to_string())?;
        app.emit(
            explorer_entity_delivery::EXPLORER_DYNAMIC_ENTITY_EVENT,
            event,
        )
        .map_err(|error| format!("failed to publish Explorer dynamic-entity snapshot: {error}"))
    })
}

/// Returns one pull-only possession playback/physical sample for the Inspector diagnostics.
#[tauri::command]
fn explorer_possession_motion_probe(
    entities: tauri::State<'_, Arc<explorer_entity_runtime::ExplorerEntityRuntime>>,
) -> Option<explorer_entity_runtime::ExplorerPossessionMotionProbe> {
    entities.possession_motion_probe()
}

/// Prepares one catalog WCID and publishes the complete wearer/child registry generation.
#[tauri::command]
async fn spawn_explorer_entity(
    app: tauri::AppHandle,
    driver: tauri::State<'_, Arc<explorer_entity_driver::ExplorerEntityDriver>>,
    delivery: tauri::State<'_, Arc<explorer_entity_delivery::ExplorerEntityDelivery>>,
    request: explorer_entity_driver::ExplorerEntitySpawnRequest,
) -> Result<ExplorerEntityMutationReceipt, String> {
    let driver = Arc::clone(&driver);
    let delivery = Arc::clone(&delivery);
    tokio::task::spawn_blocking(move || {
        delivery.with_ordered_publication(|| {
            let outcome = driver
                .spawn_by_wcid(request)
                .map_err(|error| error.to_string())?;
            let receipt = ExplorerEntityMutationReceipt {
                guid: outcome.instance.definition.identity.guid,
                generation: outcome.instance.generation,
            };
            // A held loadout is one lifecycle unit but several feed entities. One snapshot event
            // keeps the wearer and every child in the same ordered publication generation.
            let event = delivery
                .snapshot_event()
                .map_err(|error| error.to_string())?;
            app.emit(
                explorer_entity_delivery::EXPLORER_DYNAMIC_ENTITY_EVENT,
                event,
            )
            .map_err(|error| format!("Explorer entity spawned but publication failed: {error}"))?;
            Ok(receipt)
        })
    })
    .await
    .map_err(|error| format!("Explorer entity spawn task failed: {error}"))?
}

/// Removes one exact wearer generation and publishes the complete post-removal registry.
#[tauri::command]
async fn despawn_explorer_entity(
    app: tauri::AppHandle,
    driver: tauri::State<'_, Arc<explorer_entity_driver::ExplorerEntityDriver>>,
    delivery: tauri::State<'_, Arc<explorer_entity_delivery::ExplorerEntityDelivery>>,
    guid: holtburger_common::Guid,
    generation: u64,
) -> Result<ExplorerEntityMutationReceipt, String> {
    let driver = Arc::clone(&driver);
    let delivery = Arc::clone(&delivery);
    tokio::task::spawn_blocking(move || {
        delivery.with_ordered_publication(|| {
            let outcome = driver
                .despawn(guid, generation)
                .map_err(|error| error.to_string())?;
            let receipt = ExplorerEntityMutationReceipt {
                guid,
                generation: outcome.instance.generation,
            };
            let event = delivery
                .snapshot_event()
                .map_err(|error| error.to_string())?;
            app.emit(
                explorer_entity_delivery::EXPLORER_DYNAMIC_ENTITY_EVENT,
                event,
            )
            .map_err(|error| {
                format!("Explorer entity despawned but publication failed: {error}")
            })?;
            Ok(receipt)
        })
    })
    .await
    .map_err(|error| format!("Explorer entity despawn task failed: {error}"))?
}

/// Applies one complete semantic state and publishes the resulting current entity view.
#[tauri::command]
async fn replace_explorer_entity_physics_state(
    app: tauri::AppHandle,
    driver: tauri::State<'_, Arc<explorer_entity_driver::ExplorerEntityDriver>>,
    delivery: tauri::State<'_, Arc<explorer_entity_delivery::ExplorerEntityDelivery>>,
    request: ReplaceExplorerEntityPhysicsStateRequest,
) -> Result<ExplorerEntityMutationReceipt, String> {
    let driver = Arc::clone(&driver);
    let delivery = Arc::clone(&delivery);
    tokio::task::spawn_blocking(move || {
        delivery.with_ordered_publication(|| {
            let outcome = driver
                .replace_physics_state(
                    request.guid,
                    request.generation,
                    holtburger_common::properties::PhysicsState::from_bits_retain(
                        request.semantic_mask,
                    ),
                    request.physical_intent,
                )
                .map_err(|error| error.to_string())?;
            let receipt = ExplorerEntityMutationReceipt {
                guid: request.guid,
                generation: outcome.instance.generation,
            };
            let event = delivery
                .upserted(receipt.guid)
                .map_err(|error| error.to_string())?;
            app.emit(
                explorer_entity_delivery::EXPLORER_DYNAMIC_ENTITY_EVENT,
                event,
            )
            .map_err(|error| {
                format!("Explorer entity state changed but publication failed: {error}")
            })?;
            Ok(receipt)
        })
    })
    .await
    .map_err(|error| format!("Explorer entity state replacement task failed: {error}"))?
}

/// Applies one catalog-speed launch and publishes the complete resulting current view.
#[tauri::command]
async fn launch_explorer_entity(
    app: tauri::AppHandle,
    driver: tauri::State<'_, Arc<explorer_entity_driver::ExplorerEntityDriver>>,
    delivery: tauri::State<'_, Arc<explorer_entity_delivery::ExplorerEntityDelivery>>,
    request: explorer_entity_driver::ExplorerEntityLaunchRequest,
) -> Result<ExplorerEntityMutationReceipt, String> {
    let driver = Arc::clone(&driver);
    let delivery = Arc::clone(&delivery);
    tokio::task::spawn_blocking(move || {
        delivery.with_ordered_publication(|| {
            let outcome = driver.launch(request).map_err(|error| error.to_string())?;
            let receipt = ExplorerEntityMutationReceipt {
                guid: request.guid,
                generation: outcome.instance.generation,
            };
            let event = delivery
                .upserted(receipt.guid)
                .map_err(|error| error.to_string())?;
            app.emit(
                explorer_entity_delivery::EXPLORER_DYNAMIC_ENTITY_EVENT,
                event,
            )
            .map_err(|error| format!("Explorer entity launched but publication failed: {error}"))?;
            Ok(receipt)
        })
    })
    .await
    .map_err(|error| format!("Explorer entity launch task failed: {error}"))?
}

/// Applies one host-resolved teleport/reset and publishes a correction-only snap batch.
#[tauri::command]
async fn relocate_explorer_entity(
    app: tauri::AppHandle,
    driver: tauri::State<'_, Arc<explorer_entity_driver::ExplorerEntityDriver>>,
    delivery: tauri::State<'_, Arc<explorer_entity_delivery::ExplorerEntityDelivery>>,
    request: explorer_entity_driver::ExplorerEntityRelocationRequest,
) -> Result<ExplorerEntityMutationReceipt, String> {
    let driver = Arc::clone(&driver);
    let delivery = Arc::clone(&delivery);
    tokio::task::spawn_blocking(move || {
        delivery.with_ordered_publication(|| {
            let kind = request.kind.advance_kind();
            let outcome = driver
                .relocate(request)
                .map_err(|error| error.to_string())?;
            let receipt = ExplorerEntityMutationReceipt {
                guid: request.guid,
                generation: outcome.instance.generation,
            };
            let event = delivery
                .corrected(receipt.guid, kind)
                .map_err(|error| error.to_string())?;
            app.emit(
                explorer_entity_delivery::EXPLORER_DYNAMIC_ENTITY_EVENT,
                event,
            )
            .map_err(|error| {
                format!("Explorer entity relocated but publication failed: {error}")
            })?;
            Ok(receipt)
        })
    })
    .await
    .map_err(|error| format!("Explorer entity relocation task failed: {error}"))?
}

/// Every animation one motion table can reach, so a spawning entity can stage them as a closure.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MotionTableClosureRequest {
    motion_table_id: String,
}

/// Loads the animation closure of one motion table.
///
/// The set is read from the projected contract, which already resolved every reference, so this
/// cannot report an animation the archive lacks. An unknown table is an error rather than an empty
/// set: staging nothing for a table that should exist would activate an entity that silently never
/// animates.
#[tauri::command]
async fn load_motion_table_closure(
    motion: tauri::State<'_, Arc<holtburger_content::MotionSequenceCatalog>>,
    request: MotionTableClosureRequest,
) -> Result<Vec<String>, String> {
    load_motion_table_closure_ids(motion.inner(), &request.motion_table_id).map_err(format_error)
}

/// Frontend request naming which entity to possess, or releasing whatever is possessed.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PossessExplorerEntityRequest {
    /// Entity to possess. `None` releases.
    pub guid: Option<holtburger_common::Guid>,
}

/// What the frontend needs to render possession: identity and what the entity can actually do.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPossessionReceipt {
    pub guid: Option<holtburger_common::Guid>,
    pub entity_generation: Option<u64>,
    pub possession_generation: u64,
    pub motion_table_id: Option<String>,
    pub accepted_stance: Option<u32>,
    pub run_rate_capability: Option<explorer_possession_control::PossessionRunRateCapability>,
    pub stances: Vec<explorer_possession_control::PossessionStanceCapability>,
}

impl ExplorerPossessionReceipt {
    pub fn active(possession: explorer_entity_runtime::ExplorerPossession) -> Self {
        Self {
            guid: Some(possession.guid),
            entity_generation: Some(possession.entity_generation),
            possession_generation: possession.possession_generation,
            motion_table_id: Some(format!("0x{:08x}", possession.motion_table_id)),
            accepted_stance: Some(possession.accepted_stance),
            run_rate_capability: Some(possession.run_rate_capability),
            stances: possession.stances,
        }
    }

    pub fn released(possession_generation: u64) -> Self {
        Self {
            guid: None,
            entity_generation: None,
            possession_generation,
            motion_table_id: None,
            accepted_stance: None,
            run_rate_capability: None,
            stances: Vec::new(),
        }
    }
}

/// Replaceable semantic character intent targeted at one exact possession epoch.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPossessionIntentWireRequest {
    possession_generation: u64,
    revision: u64,
    stance: u32,
    drive: explorer_possession_control::CharacterDriveRequest,
    run_rate_scalar: f32,
}

impl ExplorerPossessionIntentWireRequest {
    pub fn resolve(
        self,
    ) -> Result<explorer_entity_runtime::ExplorerPossessionIntentRequest, String> {
        explorer_possession_control::PossessionRunRateScalar::new(self.run_rate_scalar)
            .map_err(|error| error.to_string())?;
        Ok(explorer_entity_runtime::ExplorerPossessionIntentRequest {
            possession_generation: self.possession_generation,
            revision: self.revision,
            stance: self.stance,
            drive: self.drive.resolve(),
            run_rate_scalar: self.run_rate_scalar,
        })
    }
}

/// Lifecycle payload whose drive and stance come from the enclosing semantic snapshot.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ExplorerPossessionEventKind {
    BeginJump,
    ReleaseJump { extent: f32 },
    Reset,
}

/// Ordered edge carrying its complete contemporaneous semantic intent.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPossessionEventWireRequest {
    possession_generation: u64,
    sequence: u64,
    revision: u64,
    stance: u32,
    drive: explorer_possession_control::CharacterDriveRequest,
    run_rate_scalar: f32,
    #[serde(flatten)]
    event: ExplorerPossessionEventKind,
}

impl ExplorerPossessionEventWireRequest {
    pub fn resolve(
        self,
    ) -> Result<explorer_entity_runtime::ExplorerPossessionEventRequest, String> {
        explorer_possession_control::PossessionRunRateScalar::new(self.run_rate_scalar)
            .map_err(|error| error.to_string())?;
        let event = match self.event {
            ExplorerPossessionEventKind::BeginJump => {
                explorer_possession_control::PossessionLifecycleEvent::BeginJump
            }
            ExplorerPossessionEventKind::ReleaseJump { extent } => {
                explorer_possession_control::PossessionLifecycleEvent::ReleaseJump {
                    extent: holtburger_core::JumpExtent::new(extent)
                        .map_err(|error| format!("invalid possession jump extent: {error:?}"))?,
                }
            }
            ExplorerPossessionEventKind::Reset => {
                explorer_possession_control::PossessionLifecycleEvent::Reset
            }
        };
        Ok(explorer_entity_runtime::ExplorerPossessionEventRequest {
            possession_generation: self.possession_generation,
            sequence: self.sequence,
            revision: self.revision,
            stance: self.stance,
            drive: self.drive.resolve(),
            run_rate_scalar: self.run_rate_scalar,
            event,
        })
    }
}

/// Possesses one spawned entity, or releases whatever is possessed.
#[tauri::command]
async fn possess_explorer_entity(
    entities: tauri::State<'_, Arc<explorer_entity_runtime::ExplorerEntityRuntime>>,
    request: PossessExplorerEntityRequest,
) -> Result<ExplorerPossessionReceipt, String> {
    let entities = Arc::clone(&entities);
    let Some(guid) = request.guid else {
        let release = entities
            .release_possession(std::time::Instant::now())
            .map_err(|error| error.to_string())?;
        return Ok(ExplorerPossessionReceipt::released(
            release.possession_generation,
        ));
    };
    let possession = entities.possess(guid).map_err(|error| error.to_string())?;
    Ok(ExplorerPossessionReceipt::active(possession))
}

/// Replaces semantic intent for one exact possession generation.
#[tauri::command]
async fn set_explorer_possession_intent(
    entities: tauri::State<'_, Arc<explorer_entity_runtime::ExplorerEntityRuntime>>,
    request: ExplorerPossessionIntentWireRequest,
) -> Result<explorer_possession_control::PossessionIntentReplaceResult, String> {
    entities
        .replace_possession_intent(request.resolve()?)
        .map_err(|error| error.to_string())
}

/// Queues one non-coalescible possession lifecycle edge.
#[tauri::command]
async fn queue_explorer_possession_event(
    entities: tauri::State<'_, Arc<explorer_entity_runtime::ExplorerEntityRuntime>>,
    request: ExplorerPossessionEventWireRequest,
) -> Result<explorer_entity_runtime::PossessionEventQueueReceipt, String> {
    entities
        .queue_possession_event(request.resolve()?)
        .map_err(|error| error.to_string())
}

/// Starts the host-owned boom against one exact active possession.
#[tauri::command]
async fn start_kinematic_boom(
    boom: tauri::State<'_, Arc<host_kinematic_boom_runtime::HostKinematicBoomRuntime>>,
    request: host_kinematic_boom_runtime::HostKinematicBoomStartRequest,
) -> Result<host_kinematic_boom_runtime::HostKinematicBoomStartReceipt, String> {
    boom.start(request).map_err(format_error)
}

/// Replaces semantic boom intent for one exact generation tuple.
#[tauri::command]
async fn set_kinematic_boom_intent(
    boom: tauri::State<'_, Arc<host_kinematic_boom_runtime::HostKinematicBoomRuntime>>,
    request: host_kinematic_boom_runtime::HostKinematicBoomIntentRequest,
) -> Result<host_kinematic_boom_runtime::HostKinematicBoomUpdateReceipt, String> {
    boom.set_intent(request).map_err(format_error)
}

/// Replaces projection clearance for one exact generation tuple.
#[tauri::command]
async fn set_kinematic_boom_clearance(
    boom: tauri::State<'_, Arc<host_kinematic_boom_runtime::HostKinematicBoomRuntime>>,
    request: host_kinematic_boom_runtime::HostKinematicBoomClearanceRequest,
) -> Result<host_kinematic_boom_runtime::HostKinematicBoomUpdateReceipt, String> {
    boom.set_clearance(request).map_err(format_error)
}

/// Stops exactly one boom generation without invalidating a replacement.
#[tauri::command]
async fn stop_kinematic_boom(
    boom: tauri::State<'_, Arc<host_kinematic_boom_runtime::HostKinematicBoomRuntime>>,
    request: host_kinematic_boom_runtime::HostKinematicBoomIdentity,
) -> Result<bool, String> {
    Ok(boom.stop(request))
}

/// Clears the Explorer registry/body population and publishes an empty reconstruction snapshot.
#[tauri::command]
async fn reset_explorer_entities(
    app: tauri::AppHandle,
    driver: tauri::State<'_, Arc<explorer_entity_driver::ExplorerEntityDriver>>,
    delivery: tauri::State<'_, Arc<explorer_entity_delivery::ExplorerEntityDelivery>>,
) -> Result<(), String> {
    let driver = Arc::clone(&driver);
    let delivery = Arc::clone(&delivery);
    tokio::task::spawn_blocking(move || {
        delivery.with_ordered_publication(|| {
            driver.reset().map_err(|error| error.to_string())?;
            let event = delivery
                .snapshot_event()
                .map_err(|error| error.to_string())?;
            app.emit(
                explorer_entity_delivery::EXPLORER_DYNAMIC_ENTITY_EVENT,
                event,
            )
            .map_err(|error| format!("Explorer entities reset but publication failed: {error}"))
        })
    })
    .await
    .map_err(|error| format!("Explorer entity reset task failed: {error}"))?
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
struct TexturePixelsSurfaceFields {
    source_record_id: String,
    format: &'static str,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
enum TexturePixelsSurfaceManifest {
    /// Terrain color alone carries the required source-surface mean used by the frontend palette.
    TerrainColor {
        #[serde(flatten)]
        surface: TexturePixelsSurfaceFields,
        #[serde(rename = "meanRgb")]
        mean_rgb: [f32; 3],
    },
    /// Every unrelated texture purpose preserves the existing surface manifest shape.
    Conventional(TexturePixelsSurfaceFields),
}

/// Compute one normalized RGB mean from complete RGBA8 level-zero pixels.
fn mean_rgb_rgba8(width: u32, height: u32, pixels: &[u8]) -> Result<[f32; 3]> {
    let texel_count = usize::try_from(u64::from(width) * u64::from(height))?;
    let expected_byte_length = texel_count
        .checked_mul(4)
        .context("terrain-color RGBA8 byte length overflowed")?;
    if texel_count == 0 || pixels.len() != expected_byte_length {
        anyhow::bail!("terrain-color mean requires complete non-empty RGBA8 pixels");
    }
    mean_rgb_from_rgba8_texels(
        texel_count,
        pixels
            .chunks_exact(4)
            .map(|texel| [texel[0], texel[1], texel[2], texel[3]]),
    )
}

fn mean_rgb_from_rgba8_texels(
    expected_texel_count: usize,
    texels: impl IntoIterator<Item = [u8; 4]>,
) -> Result<[f32; 3]> {
    let mut sums = [0_u64; 3];
    let mut texel_count = 0_usize;
    for texel in texels {
        sums[0] += u64::from(texel[0]);
        sums[1] += u64::from(texel[1]);
        sums[2] += u64::from(texel[2]);
        texel_count += 1;
    }
    if texel_count == 0 || texel_count != expected_texel_count {
        anyhow::bail!("terrain-color mean received an incompatible texel count");
    }
    let normalization = 1.0_f64 / (texel_count as f64 * f64::from(u8::MAX));
    Ok(sums.map(|sum| (sum as f64 * normalization) as f32))
}

fn terrain_sections(terrain: &LandblockTerrain) -> Vec<BinarySectionManifest> {
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
                "cellDiagonals" => target.copy_from_slice(&terrain.cell_diagonals.to_cell_bytes()),
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
    let collision_source: Arc<dyn host_simulation_runtime::CollisionSource> =
        content_state.service.clone();
    let simulation = Arc::new(host_simulation_runtime::HostSimulationRuntime::new(
        collision_source,
    ));
    // Projected once at startup. Measured at 222 ms against the full profile, which is the same
    // cost the client pays; lazy per-table resolution is the mitigation if that ever hurts.
    let motion_catalog = Arc::new(
        content_state
            .repository
            .read_motion_sequence_catalog()
            .expect("failed to project the motion contract from configured content"),
    );
    let explorer_entities = Arc::new(explorer_entity_runtime::ExplorerEntityRuntime::new(
        Arc::clone(&simulation),
        Arc::clone(&motion_catalog),
        explorer_possession_control::ExplorerPossessionControlProfile::standard()
            .expect("failed to construct standard Explorer possession control profile"),
    ));
    let catalog = Arc::new(
        explorer_weenie_catalog::ExplorerWeenieCatalog::discover_from_environment(
            content_state
                .repository
                .source_description()
                .map(std::path::Path::new),
        ),
    );
    let explorer_entity_driver = Arc::new(explorer_entity_driver::ExplorerEntityDriver::new(
        catalog,
        Arc::new(
            explorer_entity_driver::DatExplorerEntityContentPreparer::new(Arc::clone(
                &content_state.repository,
            )),
        ),
        Arc::new(explorer_entity_driver::SystemExplorerEntityClock),
        Arc::clone(&explorer_entities),
        Arc::clone(&simulation),
    ));
    let explorer_entity_delivery = Arc::new(explorer_entity_delivery::ExplorerEntityDelivery::new(
        Arc::clone(&explorer_entities),
    ));
    let kinematic_boom_runtime = Arc::new(
        host_kinematic_boom_runtime::HostKinematicBoomRuntime::new(
            Arc::clone(&explorer_entities),
            Arc::clone(&simulation),
        )
        .expect("failed to construct standard host kinematic boom profile"),
    );
    let fixed_tick_runtime = Arc::new(host_fixed_tick_runtime::HostFixedTickRuntime::new());
    let explorer_entity_tick_slot = fixed_tick_runtime.reserve_slot();
    let physical_fly_runtime = Arc::new(host_physical_fly_runtime::HostPhysicalFlyRuntime::new(
        Arc::clone(&simulation),
        Arc::clone(&fixed_tick_runtime),
    ));
    let fixed_tick_runtime_for_setup = Arc::clone(&fixed_tick_runtime);
    let explorer_entities_for_setup = Arc::clone(&explorer_entities);
    let explorer_entity_delivery_for_setup = Arc::clone(&explorer_entity_delivery);
    let kinematic_boom_runtime_for_setup = Arc::clone(&kinematic_boom_runtime);
    tauri::Builder::default()
        .setup(move |app| {
            fixed_tick_runtime_for_setup.install(
                explorer_entity_tick_slot,
                Arc::new(explorer_entity_simulation::ExplorerEntitySimulation::new(
                    explorer_entities_for_setup,
                    explorer_entity_delivery_for_setup,
                    kinematic_boom_runtime_for_setup,
                    Arc::new(
                        explorer_entity_simulation::TauriDynamicEntityEventSink::new(
                            app.handle().clone(),
                        ),
                    ),
                )),
            );
            fixed_tick_runtime_for_setup.spawn();
            Ok(())
        })
        .manage(content_state)
        .manage(simulation)
        .manage(motion_catalog)
        .manage(explorer_entities)
        .manage(explorer_entity_driver)
        .manage(explorer_entity_delivery)
        .manage(kinematic_boom_runtime)
        .manage(fixed_tick_runtime)
        .manage(physical_fly_runtime)
        .invoke_handler(tauri::generate_handler![
            host_status,
            explorer_catalog_capability,
            search_explorer_weenies,
            request_explorer_dynamic_entity_snapshot,
            explorer_possession_motion_probe,
            spawn_explorer_entity,
            despawn_explorer_entity,
            replace_explorer_entity_physics_state,
            launch_explorer_entity,
            relocate_explorer_entity,
            reset_explorer_entities,
            load_motion_table_closure,
            possess_explorer_entity,
            set_explorer_possession_intent,
            queue_explorer_possession_event,
            start_kinematic_boom,
            set_kinematic_boom_intent,
            set_kinematic_boom_clearance,
            stop_kinematic_boom,
            start_simulation_interest_session,
            replace_simulation_interest,
            start_physical_fly,
            set_physical_fly_intent,
            stop_physical_fly,
            load_active_region_data,
            load_animation,
            load_dynamic_entity_visual,
            load_audio,
            load_sound_table,
            load_particle_emitter,
            load_particle_meshes,
            load_physics_script,
            load_landblock_source_batch,
            load_landblock_profile,
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
    use holtburger_dat::{DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaWriter};
    use tempfile::tempdir;

    fn wire_drive() -> explorer_possession_control::CharacterDriveRequest {
        explorer_possession_control::CharacterDriveRequest {
            gait: explorer_possession_control::CharacterGaitRequest::Run,
            longitudinal: Some(explorer_possession_control::CharacterLongitudinalRequest::Forward),
            lateral: None,
            turn: None,
        }
    }

    #[test]
    fn possession_wire_requests_reject_non_finite_or_out_of_range_run_rates() {
        for run_rate_scalar in [f32::NAN, f32::INFINITY, 0.5, 10.001] {
            let request = ExplorerPossessionIntentWireRequest {
                possession_generation: 1,
                revision: 1,
                stance: 0x8000_003d,
                drive: wire_drive(),
                run_rate_scalar,
            };
            assert!(
                request.resolve().is_err(),
                "wire intent must reject {run_rate_scalar:?}"
            );

            let event = ExplorerPossessionEventWireRequest {
                possession_generation: 1,
                sequence: 0,
                revision: 1,
                stance: 0x8000_003d,
                drive: wire_drive(),
                run_rate_scalar,
                event: ExplorerPossessionEventKind::BeginJump,
            };
            assert!(
                event.resolve().is_err(),
                "wire lifecycle edge must reject {run_rate_scalar:?}"
            );
        }
    }

    #[test]
    fn terrain_source_binary_aligns_and_describes_each_grid_section() {
        let terrain = LandblockTerrain {
            grid_size: 3,
            tile_size: 24.0,
            height_indices: (0..9).collect(),
            heights: (0..9).map(|value| value as f32 + 0.5).collect(),
            terrain_samples: (10..19).collect(),
            cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(0x0102_ffff),
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
        assert_eq!(sections.len(), 4);
        assert_eq!(sections[1]["name"], "resolvedHeights");
        assert_eq!(sections[1]["byteOffset"], 12);
        assert_eq!(sections[2]["name"], "terrainSamples");
        assert_eq!(sections[2]["byteOffset"], 48);
        assert_eq!(sections[3]["name"], "cellDiagonals");
        assert_eq!(sections[3]["byteOffset"], 66);
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
        let expected_diagonals = terrain.cell_diagonals.to_cell_bytes();
        assert_eq!(
            &bytes[section_data_offset + 66..section_data_offset + 66 + expected_diagonals.len()],
            expected_diagonals
        );
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
            map_blockers: Some(Vec::new()),
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

    #[tokio::test]
    async fn landblock_profile_projects_classification_and_normalized_identity() {
        let directory = tempdir().expect("temporary directory should be created");
        let path = directory.path().join("landblock-profile.hba");
        write_profile_hba(&path);
        let repository = Arc::new(
            ContentRepository::from_hba_path(&path).expect("profile HBA should be readable"),
        );
        let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
        let runtime = ContentAssetRuntime::new(service);

        let dungeon = load_landblock_profile_response(&runtime, "0x00050123")
            .await
            .expect("dungeon profile should load")
            .expect("dungeon CellLandblock should exist");
        assert_eq!(dungeon.landblock_id, "0x0005ffff");
        assert_eq!(
            dungeon.traversal_class,
            landblock_profile::LandblockTraversalClassWire::DungeonOnly
        );

        let outdoor = load_landblock_profile_response(&runtime, "0x0102ffff")
            .await
            .expect("outdoor profile should load")
            .expect("outdoor CellLandblock should exist");
        assert_eq!(outdoor.landblock_id, "0x0102ffff");
        assert_eq!(
            outdoor.traversal_class,
            landblock_profile::LandblockTraversalClassWire::OutdoorOrMixed
        );
    }

    #[tokio::test]
    async fn landblock_profile_preserves_absence_and_content_failures() {
        let directory = tempdir().expect("temporary directory should be created");
        let path = directory.path().join("landblock-profile-errors.hba");
        write_profile_hba(&path);
        let repository = Arc::new(
            ContentRepository::from_hba_path(&path).expect("profile HBA should be readable"),
        );
        let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
        let runtime = ContentAssetRuntime::new(service);

        assert!(
            load_landblock_profile_response(&runtime, "0x0103ffff")
                .await
                .expect("absent profile should be a successful lookup")
                .is_none()
        );
        let error = load_landblock_profile_response(&runtime, "0x0104ffff")
            .await
            .expect_err("a promised LandblockInfo failure must propagate");
        assert!(format!("{error:#}").contains("promises required LandblockInfo"));
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
            surface: TexturePixelsSurfaceManifest::Conventional(TexturePixelsSurfaceFields {
                source_record_id: "0x06000001".to_string(),
                format: "r8",
                width: 2,
                height: 2,
            }),
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
        let encoded_manifest: serde_json::Value = serde_json::from_slice(
            &bytes[BINARY_ENVELOPE_HEADER_LEN..BINARY_ENVELOPE_HEADER_LEN + manifest_length],
        )
        .expect("texture manifest should remain JSON");
        assert!(encoded_manifest["surface"].get("meanRgb").is_none());
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
                palette_composite: None,
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
        let mean = manifest["surface"]["meanRgb"]
            .as_array()
            .expect("terrain color should carry a mean RGB");
        assert!((mean[0].as_f64().unwrap() - 9.0 / 255.0).abs() < 1.0e-6);
        assert!((mean[1].as_f64().unwrap() - 8.0 / 255.0).abs() < 1.0e-6);
        assert!((mean[2].as_f64().unwrap() - 7.0 / 255.0).abs() < 1.0e-6);
        assert_eq!(
            &bytes[section_data_offset..section_data_offset + 4],
            &[3, 2, 1, 4]
        );
    }

    #[test]
    fn texture_mean_uses_wide_rgba8_channel_sums_and_ignores_alpha() {
        let mean = mean_rgb_rgba8(
            3,
            2,
            &[
                255, 0, 127, 0, 0, 255, 127, 255, 255, 0, 127, 1, 0, 255, 127, 2, 255, 0, 127, 3,
                0, 255, 127, 4,
            ],
        )
        .expect("complete non-square RGBA8 pixels should have a mean");
        assert!((mean[0] - 0.5).abs() < f32::EPSILON);
        assert!((mean[1] - 0.5).abs() < f32::EPSILON);
        assert!((mean[2] - 127.0 / 255.0).abs() < f32::EPSILON);

        let wide_texel_count = usize::try_from(u64::from(u32::MAX) / u64::from(u8::MAX) + 1)
            .expect("wide fixture count should fit usize");
        let wide_mean = mean_rgb_from_rgba8_texels(
            wide_texel_count,
            std::iter::repeat_n([255, 1, 0, 255], wide_texel_count),
        )
        .expect("channel sums larger than u32 should remain exact");
        assert_eq!(wide_mean[0], 1.0);
        assert!((wide_mean[1] - 1.0 / 255.0).abs() < f32::EPSILON);
        assert_eq!(wide_mean[2], 0.0);

        assert!(mean_rgb_rgba8(0, 0, &[]).is_err());
        assert!(mean_rgb_rgba8(1, 1, &[1, 2, 3]).is_err());
    }

    #[tokio::test]
    async fn palette_pixel_response_composites_ranges_and_echoes_the_requested_identity() {
        let directory = tempdir().expect("temporary directory should be created");
        let path = directory.path().join("palette-composite.hba");
        let mut writer = HbaWriter::new();
        writer.set_compression(false);
        for (palette_id, colors) in [
            (0x0400_0001_u32, [0xFF11_1111_u32, 0xFF22_2222, 0xFF33_3333]),
            (0x0400_0002, [0xFF44_4444, 0xFF55_5555, 0xFF66_6666]),
        ] {
            writer
                .add(
                    EOR_PORTAL_NAMESPACE,
                    palette_id,
                    DatFileType::Palette as u32,
                    test_palette_bytes(palette_id, &colors),
                )
                .expect("palette should be added");
        }
        writer.write(&path).expect("test HBA should be written");

        let repository = Arc::new(
            ContentRepository::from_hba_path(&path).expect("test repository should be opened"),
        );
        let state = HostContentState::from_repository(repository)
            .expect("test content repository should initialize");
        let identity = "palette-composite:04000001:04000002+1+1".to_string();
        let bytes = build_texture_pixels_response(
            &state.runtime,
            LoadTexturePixelsRequest {
                kind: "prepared-object-palette".to_string(),
                purpose: "object-palette".to_string(),
                source_asset_id: identity.clone(),
                palette_composite: Some(LoadPaletteCompositeRequest {
                    base_palette_id: "0x04000001".to_string(),
                    ranges: vec![LoadPaletteRangeRequest {
                        replacement_palette_id: "0x04000002".to_string(),
                        offset: 1,
                        color_count: 1,
                    }],
                }),
            },
        )
        .await
        .expect("composited palette pixels should load");

        let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        let section_data_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_data_offset])
                .expect("response manifest should decode");
        // The caller keyed its request on the composition, so that is what must come back.
        assert_eq!(manifest["sourceAssetId"], identity);

        // Only the requested range changes, and it takes the replacement's color from the same
        // absolute index rather than from the replacement's start.
        let pixels = &bytes[section_data_offset..];
        assert_eq!(&pixels[..4], &[0x11, 0x11, 0x11, 0xFF]);
        assert_eq!(&pixels[4..8], &[0x55, 0x55, 0x55, 0xFF]);
        assert_eq!(&pixels[8..12], &[0x33, 0x33, 0x33, 0xFF]);
    }

    fn write_profile_hba(path: &std::path::Path) {
        let mut writer = HbaWriter::new();
        writer.set_compression(false);
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                holtburger_dat::file_type::REGION_DESC_FILE_ID,
                DatFileType::Region as u32,
                test_region_desc_bytes(),
            )
            .expect("profile region should be added");

        writer
            .add(
                EOR_CELL_NAMESPACE,
                0x0005_ffff,
                DatFileType::Landblock as u32,
                test_cell_landblock_bytes(0x0005_ffff, true, false),
            )
            .expect("dungeon CellLandblock should be added");
        writer
            .add(
                EOR_CELL_NAMESPACE,
                0x0005_fffe,
                DatFileType::LandblockInfo as u32,
                test_landblock_info_bytes(0x0005_fffe, 817),
            )
            .expect("dungeon LandblockInfo should be added");

        writer
            .add(
                EOR_CELL_NAMESPACE,
                0x0102_ffff,
                DatFileType::Landblock as u32,
                test_cell_landblock_bytes(0x0102_ffff, true, true),
            )
            .expect("outdoor CellLandblock should be added");
        writer
            .add(
                EOR_CELL_NAMESPACE,
                0x0102_fffe,
                DatFileType::LandblockInfo as u32,
                test_landblock_info_bytes(0x0102_fffe, 1),
            )
            .expect("outdoor LandblockInfo should be added");

        writer
            .add(
                EOR_CELL_NAMESPACE,
                0x0104_ffff,
                DatFileType::Landblock as u32,
                test_cell_landblock_bytes(0x0104_ffff, true, false),
            )
            .expect("failing CellLandblock should be added");
        writer.write(path).expect("profile HBA should be written");
    }

    fn test_cell_landblock_bytes(id: u32, has_objects: bool, nonzero_height: bool) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(252);
        bytes.extend(id.to_le_bytes());
        bytes.extend(u32::from(has_objects).to_le_bytes());
        bytes.extend(std::iter::repeat_n(0u16, 81).flat_map(u16::to_le_bytes));
        for index in 0..81 {
            bytes.push(u8::from(nonzero_height && index == 0));
        }
        while !bytes.len().is_multiple_of(4) {
            bytes.push(0);
        }
        bytes
    }

    fn test_landblock_info_bytes(id: u32, num_cells: u32) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(16);
        bytes.extend(id.to_le_bytes());
        bytes.extend(num_cells.to_le_bytes());
        bytes.extend(0u32.to_le_bytes());
        bytes.extend(0u16.to_le_bytes());
        bytes.extend(0u16.to_le_bytes());
        bytes
    }

    fn test_palette_bytes(id: u32, colors_argb: &[u32]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend(id.to_le_bytes());
        bytes.extend((colors_argb.len() as u32).to_le_bytes());
        for color in colors_argb {
            bytes.extend(color.to_le_bytes());
        }
        bytes
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
