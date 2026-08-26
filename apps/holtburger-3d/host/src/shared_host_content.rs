//! Shared static-content capability and its mode-neutral command dispatcher.

use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_core::{ContentAssetRuntime, ContentAssetService};
use holtburger_dat::file_type::{SkillTable, SpellTable, XpTable};
use holtburger_world::WorldBootstrap;
use serde::Deserialize;

use crate::protocol::{HostResponse, ProtocolError, application_error, encode_json};
use crate::{
    LoadAnimationRequest, LoadAudioRequest, LoadDynamicEntityVisualRequest,
    LoadLandblockProfileRequest, LoadLandblockSourceBatchRequest, LoadParticleEmitterRequest,
    LoadParticleMeshesRequest, LoadPhysicsScriptRequest, LoadSoundTableRequest,
    LoadTexturePixelsRequest, MotionTableClosureRequest,
};

/// Static content discovered once and owned by the selected host composition.
#[derive(Clone)]
pub struct SharedHostContent {
    /// Async content service used by request handlers.
    pub runtime: ContentAssetRuntime,
    /// Immutable repository used by entity preparation and client bootstrap assembly.
    pub repository: Arc<ContentRepository>,
    /// Synchronous service used to realize collision products outside the fixed tick.
    pub service: Arc<ContentAssetService>,
    /// Motion-table projection shared by Explorer and client authorities.
    pub motion_catalog: Arc<holtburger_content::MotionSequenceCatalog>,
    /// Lazily parsed client bootstrap, cached at the content owner rather than in either mode.
    client_bootstrap: Arc<Mutex<Option<Arc<WorldBootstrap>>>>,
}

impl SharedHostContent {
    /// Discovers the configured DAT repository and builds the shared services.
    pub fn discover() -> Result<Self> {
        let repository = Arc::new(ContentRepository::discover(None)?);
        Self::from_repository(repository)
    }

    /// Builds a shared content owner from an injected repository for tests and diagnostics.
    pub fn from_repository(repository: Arc<ContentRepository>) -> Result<Self> {
        let service =
            ContentAssetService::new(Arc::clone(&repository), Arc::new(ContentDecodeCache::new()));
        let motion_catalog = repository
            .read_motion_sequence_catalog()
            .context("failed to project the motion contract from configured content")?;
        Ok(Self {
            runtime: ContentAssetRuntime::new(service.clone()),
            repository,
            service: Arc::new(service),
            motion_catalog: Arc::new(motion_catalog),
            client_bootstrap: Arc::new(Mutex::new(None)),
        })
    }

    /// Loads the client bootstrap once while keeping DAT policy out of the core client runtime.
    pub fn client_world_bootstrap(&self) -> Result<Arc<WorldBootstrap>> {
        let mut cached = self
            .client_bootstrap
            .lock()
            .map_err(|_| anyhow::anyhow!("client bootstrap cache lock poisoned"))?;
        if let Some(bootstrap) = cached.as_ref() {
            return Ok(Arc::clone(bootstrap));
        }

        let skill_table = self
            .repository
            .read_asset::<SkillTable>("skill table")
            .context("failed to load skill table for client bootstrap")?;
        let spell_table = self
            .repository
            .read_asset::<SpellTable>("spell table")
            .context("failed to load spell table for client bootstrap")?;
        let xp_table = self
            .repository
            .read_asset::<XpTable>("XP table")
            .context("failed to load XP table for client bootstrap")?;
        let motion_catalog = self.motion_catalog.as_ref().clone();
        let soul_emote_catalog = self
            .repository
            .read_soul_emote_catalog()
            .context("failed to load soul emote catalog for client bootstrap")?;
        let bootstrap = Arc::new(WorldBootstrap::new(
            skill_table,
            spell_table,
            xp_table,
            motion_catalog,
            soul_emote_catalog,
        ));
        *cached = Some(Arc::clone(&bootstrap));
        Ok(bootstrap)
    }
}

/// Content and status commands available in every host mode.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum SharedContentCommand {
    HostStatus,
    LoadActiveRegionData,
    LoadAnimation {
        request: LoadAnimationRequest,
    },
    LoadDynamicEntityVisual {
        request: LoadDynamicEntityVisualRequest,
    },
    LoadAudio {
        request: LoadAudioRequest,
    },
    LoadSoundTable {
        request: LoadSoundTableRequest,
    },
    LoadParticleEmitter {
        request: LoadParticleEmitterRequest,
    },
    LoadParticleMeshes {
        request: LoadParticleMeshesRequest,
    },
    LoadPhysicsScript {
        request: LoadPhysicsScriptRequest,
    },
    LoadLandblockSourceBatch {
        request: LoadLandblockSourceBatchRequest,
    },
    LoadLandblockProfile {
        request: LoadLandblockProfileRequest,
    },
    LoadSkySource,
    LoadTexturePixels {
        request: LoadTexturePixelsRequest,
    },
    LoadMotionTableClosure {
        request: MotionTableClosureRequest,
    },
}

/// Exact wire names owned by the shared-content dispatcher.
pub const SHARED_CONTENT_COMMAND_NAMES: &[&str] = &[
    "host_status",
    "load_active_region_data",
    "load_animation",
    "load_dynamic_entity_visual",
    "load_audio",
    "load_sound_table",
    "load_particle_emitter",
    "load_particle_meshes",
    "load_physics_script",
    "load_landblock_source_batch",
    "load_landblock_profile",
    "load_sky_source",
    "load_texture_pixels",
    "load_motion_table_closure",
];

/// Dispatches one shared-content command without exposing either authority's runtime.
pub async fn dispatch_shared_content(
    runtime: &crate::runtime::HostRuntime,
    command: SharedContentCommand,
) -> Result<HostResponse, ProtocolError> {
    use SharedContentCommand::*;

    match command {
        HostStatus => encode_json(runtime.status()),
        LoadActiveRegionData => Ok(HostResponse::Binary(
            crate::load_active_region_data_bytes(&runtime.content().runtime)
                .await
                .map_err(application_error)?,
        )),
        LoadAnimation { request } => Ok(HostResponse::Binary(
            crate::load_animation_bytes(&runtime.content().runtime, &request.animation_id)
                .await
                .map_err(application_error)?,
        )),
        LoadDynamicEntityVisual { request } => Ok(HostResponse::Binary(
            crate::dynamic_entity_visual_source::load_dynamic_entity_visual_source_bytes(
                &runtime.content().runtime,
                request.setup_did,
                request.appearance,
            )
            .await
            .map_err(application_error)?,
        )),
        LoadAudio { request } => Ok(HostResponse::Binary(
            crate::load_audio_bytes(&runtime.content().runtime, &request.sound_id)
                .await
                .map_err(application_error)?,
        )),
        LoadSoundTable { request } => Ok(HostResponse::Binary(
            crate::load_sound_table_bytes(&runtime.content().runtime, &request.sound_table_id)
                .await
                .map_err(application_error)?,
        )),
        LoadParticleEmitter { request } => Ok(HostResponse::Binary(
            crate::load_particle_emitter_bytes(
                &runtime.content().runtime,
                &request.emitter_info_id,
            )
            .await
            .map_err(application_error)?,
        )),
        LoadParticleMeshes { request } => Ok(HostResponse::Binary(
            crate::load_particle_meshes_bytes(&runtime.content().runtime, &request.hw_gfx_obj_ids)
                .await
                .map_err(application_error)?,
        )),
        LoadPhysicsScript { request } => Ok(HostResponse::Binary(
            crate::load_physics_script_bytes(&runtime.content().runtime, &request.script_id)
                .await
                .map_err(application_error)?,
        )),
        LoadLandblockSourceBatch { request } => Ok(HostResponse::Binary(
            crate::load_landblock_source_batch_bytes(
                &runtime.content().runtime,
                &request.landblock_id,
                request.layers,
            )
            .await
            .map_err(application_error)?,
        )),
        LoadLandblockProfile { request } => encode_json(
            crate::load_landblock_profile_response(
                &runtime.content().runtime,
                &request.landblock_id,
            )
            .await
            .map_err(application_error)?,
        ),
        LoadSkySource => Ok(HostResponse::Binary(
            crate::load_sky_source_bytes(&runtime.content().runtime)
                .await
                .map_err(application_error)?,
        )),
        LoadTexturePixels { request } => Ok(HostResponse::Binary(
            crate::load_texture_pixels_bytes(&runtime.content().runtime, request)
                .await
                .map_err(application_error)?,
        )),
        LoadMotionTableClosure { request } => encode_json(
            crate::load_motion_table_closure_ids(
                &runtime.content().motion_catalog,
                &request.motion_table_id,
            )
            .map_err(application_error)?,
        ),
    }
}
