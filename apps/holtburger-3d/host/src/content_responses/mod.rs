//! Shared static-content loaders, request contracts, and binary response builders.

pub mod active_region;
pub mod terrain;
#[cfg(test)]
mod tests;
pub mod textures;

use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, ContentAssetService,
};
use serde::{Deserialize, Serialize};

use crate::animation_source::serialize_animation_record_binary;
use crate::audio_source::serialize_audio_record_binary;
use crate::particle_emitter_source::serialize_particle_emitter_record_binary;
use crate::particle_mesh_source::load_particle_mesh_bytes;
use crate::physics_script_source::serialize_physics_script_record_binary;
use crate::physics_script_table_source::serialize_physics_script_table_record_binary;
use crate::sound_table_source::serialize_sound_table_record_binary;
use crate::source_projection::dat_id;

pub use active_region::load_active_region_data_bytes;
pub use terrain::{
    LoadLandblockProfileRequest, LoadLandblockSourceBatchRequest,
    load_env_cell_source_record_bytes, load_landblock_profile_response,
    load_landblock_source_batch_bytes,
};
pub use textures::{
    LoadPaletteCompositeRequest, LoadPaletteRangeRequest, LoadTexturePixelsRequest,
    load_texture_pixels_bytes,
};

const BINARY_ENVELOPE_HEADER_LEN: usize = 12;

/// Discover the app's configured static-content runtime for a non-desktop diagnostic host.
pub fn discover_content_runtime() -> Result<ContentAssetRuntime> {
    let repository = Arc::new(ContentRepository::select_installation(None)?);
    let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
    Ok(ContentAssetRuntime::new(service))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAnimationRequest {
    pub animation_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadPhysicsScriptRequest {
    pub script_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadPhysicsScriptTableRequest {
    pub physics_script_table_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadParticleEmitterRequest {
    pub emitter_info_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAudioRequest {
    pub sound_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSoundTableRequest {
    pub sound_table_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadParticleMeshesRequest {
    pub hw_gfx_obj_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSetupVisualRequest {
    pub setup_did: u32,
    pub appearance: holtburger_world::EntityAppearance,
}

/// Every animation one motion table can reach, so a spawning entity can stage them as a closure.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MotionTableClosureRequest {
    pub motion_table_id: String,
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

fn pad_binary_manifest(mut manifest_bytes: Vec<u8>) -> Vec<u8> {
    while !(BINARY_ENVELOPE_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    manifest_bytes
}

/// Every animation one motion table can reach, as canonical dat ids in stable order.
///
/// Shared by the sidecar command and dev content host so the browser harness stages the same
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
    Ok(animations.into_iter().map(dat_id).collect())
}

/// Build the canonical typed animation response used by the sidecar and focused host tests.
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

/// Build the canonical typed physics-script response used by the sidecar and focused host tests.
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

/// Build the canonical typed PhysicsScriptTable response used by browser cue resolution.
pub async fn load_physics_script_table_bytes(
    runtime: &ContentAssetRuntime,
    raw_table_id: &str,
) -> Result<Vec<u8>> {
    let table_id = parse_typed_dat_id(raw_table_id, 0x34)?;
    let asset = runtime
        .load(ContentAssetRequest::PhysicsScriptTable(table_id))
        .await
        .with_context(|| format!("Could not load PhysicsScriptTable 0x{table_id:08X}"))?;
    let ContentAsset::PhysicsScriptTable(table) = asset else {
        unreachable!("PhysicsScriptTable request must return a PhysicsScriptTable")
    };
    serialize_physics_script_table_record_binary(&table)
}

/// Build the canonical typed particle-emitter response used by the sidecar and focused host tests.
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

/// Build the canonical typed audio response used by the sidecar and focused host tests.
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

/// Build the canonical typed sound-table response used by the sidecar and focused host tests.
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

/// Build the canonical typed particle-mesh response used by the sidecar and focused host tests.
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

pub fn format_error(error: anyhow::Error) -> String {
    format!("{error:#}")
}
