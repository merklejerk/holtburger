//! Versioned, bounded MessagePack protocol for the Electron sidecar.

use std::io;
use std::sync::{Arc, mpsc};
use std::thread;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::explorer_entity_delivery::ExplorerFixedTickEnvelope;
use crate::explorer_entity_driver::{
    ExplorerEntityLaunchRequest, ExplorerEntityRelocationRequest, ExplorerEntitySpawnRequest,
};
use crate::explorer_entity_runtime::PossessionEventOutcome;
use crate::explorer_weenie_catalog::ExplorerWeenieSearchRequest;
use crate::host_event_sink::HostEventSink;
use crate::host_kinematic_boom_runtime::{
    HostKinematicBoomClearanceRequest, HostKinematicBoomIdentity, HostKinematicBoomIntentRequest,
    HostKinematicBoomStartRequest,
};
use crate::host_physical_fly_runtime::{
    PhysicalFlyFailure, PhysicalFlyIntent, PhysicalFlyMotionPath, PhysicalFlyRegistration,
    PhysicalFlyStartReceipt,
};
use crate::host_simulation_runtime::SimulationInterestRequest;
use crate::runtime::HostRuntime;
use crate::{
    ExplorerEntityMutationReceipt, ExplorerPossessionEventWireRequest,
    ExplorerPossessionIntentWireRequest, ExplorerPossessionReceipt, LoadAnimationRequest,
    LoadAudioRequest, LoadDynamicEntityVisualRequest, LoadLandblockProfileRequest,
    LoadLandblockSourceBatchRequest, LoadParticleEmitterRequest, LoadParticleMeshesRequest,
    LoadPhysicsScriptRequest, LoadSoundTableRequest, LoadTexturePixelsRequest,
    MotionTableClosureRequest, PossessExplorerEntityRequest,
    ReplaceExplorerEntityPhysicsStateRequest,
};

/// Current sidecar protocol version.
pub const PROTOCOL_VERSION: u16 = 1;
/// Maximum encoded MessagePack payload, excluding the four-byte length prefix.
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
/// Bounded writer queue. Producers block at capacity; no event is silently discarded.
pub const WRITER_QUEUE_CAPACITY: usize = 256;

/// A closed command set; the host never dispatches arbitrary method names.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum HostCommand {
    HostStatus,
    ExplorerCatalogCapability,
    SearchExplorerWeenies {
        request: ExplorerWeenieSearchRequest,
    },
    RequestExplorerDynamicEntitySnapshot,
    ExplorerPossessionMotionProbe,
    SpawnExplorerEntity {
        request: ExplorerEntitySpawnRequest,
    },
    DespawnExplorerEntity {
        guid: holtburger_common::Guid,
        generation: u64,
    },
    ReplaceExplorerEntityPhysicsState {
        request: ReplaceExplorerEntityPhysicsStateRequest,
    },
    LaunchExplorerEntity {
        request: ExplorerEntityLaunchRequest,
    },
    RelocateExplorerEntity {
        request: ExplorerEntityRelocationRequest,
    },
    ResetExplorerEntities,
    LoadMotionTableClosure {
        request: MotionTableClosureRequest,
    },
    PossessExplorerEntity {
        request: PossessExplorerEntityRequest,
    },
    SetExplorerPossessionIntent {
        request: ExplorerPossessionIntentWireRequest,
    },
    QueueExplorerPossessionEvent {
        request: ExplorerPossessionEventWireRequest,
    },
    StartKinematicBoom {
        request: HostKinematicBoomStartRequest,
    },
    SetKinematicBoomIntent {
        request: HostKinematicBoomIntentRequest,
    },
    SetKinematicBoomClearance {
        request: HostKinematicBoomClearanceRequest,
    },
    StopKinematicBoom {
        request: HostKinematicBoomIdentity,
    },
    StartSimulationInterestSession,
    ReplaceSimulationInterest {
        request: SimulationInterestRequest,
    },
    StartPhysicalFly {
        registration: PhysicalFlyRegistration,
    },
    SetPhysicalFlyIntent {
        intent: PhysicalFlyIntent,
    },
    StopPhysicalFly {
        session: u64,
    },
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
}

/// Events emitted by host-owned simulation and command publication.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "payload", rename_all = "kebab-case")]
pub enum HostEvent {
    DynamicEntity(holtburger_core::DynamicEntityEvent),
    FixedTick(ExplorerFixedTickEnvelope),
    PossessionEventOutcomes(Vec<PossessionEventOutcome>),
    PhysicalFlyMotion(PhysicalFlyMotionPath),
    PhysicalFlyFailure(PhysicalFlyFailure),
}

/// Successful command payload. Binary responses use MessagePack's native bin type.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum HostResponse {
    Unit,
    Json(Value),
    Binary(#[serde(with = "serde_bytes")] Vec<u8>),
}

/// Structured application/protocol failure returned without flattening to a shell string.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
}

/// One framed wire message.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProtocolFrame {
    Handshake {
        protocol_version: u16,
        host_name: String,
        host_version: String,
    },
    Response {
        id: u64,
        result: Result<HostResponse, ProtocolError>,
    },
    Event {
        event: HostEvent,
    },
    ShutdownAck {
        id: u64,
    },
    Rejected {
        error: ProtocolError,
    },
}

/// Frames accepted from Electron. Outbound-only payloads are intentionally not deserializable.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InboundFrame {
    HandshakeAck { protocol_version: u16 },
    Request { id: u64, command: HostCommand },
    Shutdown { id: u64 },
}

/// Errors raised while framing or decoding a protocol payload.
#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("protocol input ended before a complete frame")]
    UnexpectedEof,
    #[error(
        "protocol frame announced {announced} bytes, exceeding the {MAX_FRAME_BYTES}-byte limit"
    )]
    Oversize { announced: usize },
    #[error("protocol frame length does not fit in memory: {0}")]
    Length(#[from] std::num::TryFromIntError),
    #[error("protocol MessagePack encoding failed: {0}")]
    Encode(#[from] rmp_serde::encode::Error),
    #[error("protocol MessagePack decoding failed: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
    #[error("protocol I/O failed: {0}")]
    Io(#[from] io::Error),
}

/// Encodes one frame with a little-endian u32 length prefix.
pub fn encode_frame(frame: &ProtocolFrame) -> Result<Vec<u8>, FrameError> {
    let payload = rmp_serde::to_vec_named(frame)?;
    validate_payload_length(payload.len())?;
    let length = u32::try_from(payload.len())?;
    let mut framed = Vec::with_capacity(4 + payload.len());
    framed.extend(length.to_le_bytes());
    framed.extend(payload);
    Ok(framed)
}

/// Writes one complete frame to a synchronous stream.
pub fn write_frame<W: io::Write>(writer: &mut W, frame: &ProtocolFrame) -> Result<(), FrameError> {
    writer.write_all(&encode_frame(frame)?)?;
    writer.flush()?;
    Ok(())
}

/// Reads one complete frame from a synchronous stream.
pub fn read_frame<R: io::Read>(reader: &mut R) -> Result<Option<InboundFrame>, FrameError> {
    let mut length_bytes = [0_u8; 4];
    match reader.read(&mut length_bytes[..1])? {
        0 => return Ok(None),
        1 => {}
        _ => unreachable!("a one-byte read cannot return more than one byte"),
    }
    reader.read_exact(&mut length_bytes[1..])?;
    let length = usize::try_from(u32::from_le_bytes(length_bytes))?;
    validate_payload_length(length)?;
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(rmp_serde::from_slice(&payload)?))
}

/// Reads one complete frame from an asynchronous stream.
pub async fn read_frame_async<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<Option<InboundFrame>, FrameError> {
    let mut length_bytes = [0_u8; 4];
    match reader.read(&mut length_bytes[..1]).await? {
        0 => return Ok(None),
        1 => {}
        _ => unreachable!("a one-byte read cannot return more than one byte"),
    }
    reader.read_exact(&mut length_bytes[1..]).await?;
    let length = usize::try_from(u32::from_le_bytes(length_bytes))?;
    validate_payload_length(length)?;
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload).await?;
    Ok(Some(rmp_serde::from_slice(&payload)?))
}

/// Writes one complete frame to an asynchronous stream.
pub async fn write_frame_async<W: AsyncWrite + Unpin>(
    writer: &mut W,
    frame: &ProtocolFrame,
) -> Result<(), FrameError> {
    writer.write_all(&encode_frame(frame)?).await?;
    writer.flush().await?;
    Ok(())
}

fn validate_payload_length(length: usize) -> Result<(), FrameError> {
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::Oversize { announced: length });
    }
    Ok(())
}

fn application_error(error: impl std::fmt::Display) -> ProtocolError {
    ProtocolError {
        code: "application_error".to_string(),
        message: error.to_string(),
    }
}

fn encode_json<T: Serialize>(value: T) -> Result<HostResponse, ProtocolError> {
    serde_json::to_value(value)
        .map(HostResponse::Json)
        .map_err(application_error)
}

/// Dispatches one typed command against the shared shell-neutral host.
pub async fn dispatch(
    runtime: &HostRuntime,
    command: HostCommand,
) -> Result<HostResponse, ProtocolError> {
    use HostCommand::*;

    match command {
        HostStatus => encode_json(runtime.status()),
        ExplorerCatalogCapability => {
            encode_json(runtime.explorer_entity_driver.catalog_capability())
        }
        SearchExplorerWeenies { request } => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            tokio::task::spawn_blocking(move || driver.search_weenies(&request))
                .await
                .map_err(application_error)?
                .map_err(application_error)
                .and_then(encode_json)
        }
        RequestExplorerDynamicEntitySnapshot => {
            let event = runtime
                .explorer_entity_delivery
                .with_ordered_publication(|| runtime.explorer_entity_delivery.snapshot_event())
                .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            Ok(HostResponse::Unit)
        }
        ExplorerPossessionMotionProbe => {
            encode_json(runtime.explorer_entities.possession_motion_probe())
        }
        SpawnExplorerEntity { request } => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let receipt = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let outcome = driver.spawn_by_wcid(request)?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid: outcome.instance.definition.identity.guid,
                        generation: outcome.instance.generation,
                    };
                    let event = delivery.snapshot_event()?;
                    Ok::<_, anyhow::Error>((receipt, event))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(receipt.1)
                .map_err(application_error)?;
            encode_json(receipt.0)
        }
        DespawnExplorerEntity { guid, generation } => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let (receipt, event) = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let outcome = driver.despawn(guid, generation)?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid,
                        generation: outcome.instance.generation,
                    };
                    Ok::<_, anyhow::Error>((receipt, delivery.snapshot_event()?))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            encode_json(receipt)
        }
        ReplaceExplorerEntityPhysicsState { request } => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let (receipt, event) = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let outcome = driver.replace_physics_state(
                        request.guid,
                        request.generation,
                        holtburger_common::properties::PhysicsState::from_bits_retain(
                            request.semantic_mask,
                        ),
                        request.physical_intent,
                    )?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid: request.guid,
                        generation: outcome.instance.generation,
                    };
                    Ok::<_, anyhow::Error>((receipt, delivery.upserted(receipt.guid)?))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            encode_json(receipt)
        }
        LaunchExplorerEntity { request } => {
            let guid = request.guid;
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let (receipt, event) = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let outcome = driver.launch(request)?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid,
                        generation: outcome.instance.generation,
                    };
                    Ok::<_, anyhow::Error>((receipt, delivery.upserted(receipt.guid)?))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            encode_json(receipt)
        }
        RelocateExplorerEntity { request } => {
            let guid = request.guid;
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let (receipt, event) = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let kind = request.kind.advance_kind();
                    let outcome = driver.relocate(request)?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid,
                        generation: outcome.instance.generation,
                    };
                    Ok::<_, anyhow::Error>((receipt, delivery.corrected(receipt.guid, kind)?))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            encode_json(receipt)
        }
        ResetExplorerEntities => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let event = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    driver.reset().map_err(|error| anyhow::anyhow!("{error}"))?;
                    Ok::<_, anyhow::Error>(delivery.snapshot_event()?)
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            Ok(HostResponse::Unit)
        }
        LoadMotionTableClosure { request } => encode_json(
            crate::load_motion_table_closure_ids(&runtime.motion_catalog, &request.motion_table_id)
                .map_err(application_error)?,
        ),
        PossessExplorerEntity { request } => {
            let Some(guid) = request.guid else {
                let release = runtime
                    .explorer_entities
                    .release_possession(std::time::Instant::now())
                    .map_err(application_error)?;
                return encode_json(ExplorerPossessionReceipt::released(
                    release.possession_generation,
                ));
            };
            encode_json(ExplorerPossessionReceipt::active(
                runtime
                    .explorer_entities
                    .possess(guid)
                    .map_err(application_error)?,
            ))
        }
        SetExplorerPossessionIntent { request } => encode_json(
            runtime
                .explorer_entities
                .replace_possession_intent(request.resolve().map_err(application_error)?)
                .map_err(application_error)?,
        ),
        QueueExplorerPossessionEvent { request } => encode_json(
            runtime
                .explorer_entities
                .queue_possession_event(request.resolve().map_err(application_error)?)
                .map_err(application_error)?,
        ),
        StartKinematicBoom { request } => encode_json(
            runtime
                .kinematic_boom_runtime
                .start(request)
                .map_err(application_error)?,
        ),
        SetKinematicBoomIntent { request } => encode_json(
            runtime
                .kinematic_boom_runtime
                .set_intent(request)
                .map_err(application_error)?,
        ),
        SetKinematicBoomClearance { request } => encode_json(
            runtime
                .kinematic_boom_runtime
                .set_clearance(request)
                .map_err(application_error)?,
        ),
        StopKinematicBoom { request } => Ok(HostResponse::Json(
            serde_json::to_value(runtime.kinematic_boom_runtime.stop(request))
                .map_err(application_error)?,
        )),
        StartSimulationInterestSession => {
            encode_json(runtime.simulation.reserve_interest_session())
        }
        ReplaceSimulationInterest { request } => {
            let simulation = Arc::clone(&runtime.simulation);
            let receipt = tokio::task::spawn_blocking(move || simulation.replace_interest(request))
                .await
                .map_err(application_error)?
                .map_err(application_error)?;
            encode_json(receipt)
        }
        StartPhysicalFly { registration } => {
            let physical = Arc::clone(&runtime.physical_fly_runtime);
            let sink = Arc::clone(&runtime.physical_event_sink);
            let session = tokio::task::spawn_blocking(move || {
                let session = physical.start(registration)?;
                if !physical.schedule(sink, session) {
                    anyhow::bail!("physical camera registration was superseded before scheduling");
                }
                Ok::<_, anyhow::Error>(PhysicalFlyStartReceipt::new(session))
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            encode_json(session)
        }
        SetPhysicalFlyIntent { intent } => {
            runtime
                .physical_fly_runtime
                .set_intent(intent)
                .map_err(application_error)?;
            Ok(HostResponse::Unit)
        }
        StopPhysicalFly { session } => {
            runtime.physical_fly_runtime.stop(session);
            Ok(HostResponse::Unit)
        }
        LoadActiveRegionData => Ok(HostResponse::Binary(
            crate::load_active_region_data_bytes(&runtime.content.runtime)
                .await
                .map_err(application_error)?,
        )),
        LoadAnimation { request } => Ok(HostResponse::Binary(
            crate::load_animation_bytes(&runtime.content.runtime, &request.animation_id)
                .await
                .map_err(application_error)?,
        )),
        LoadDynamicEntityVisual { request } => Ok(HostResponse::Binary(
            crate::dynamic_entity_visual_source::load_dynamic_entity_visual_source_bytes(
                &runtime.content.runtime,
                request.setup_did,
                request.appearance,
            )
            .await
            .map_err(application_error)?,
        )),
        LoadAudio { request } => Ok(HostResponse::Binary(
            crate::load_audio_bytes(&runtime.content.runtime, &request.sound_id)
                .await
                .map_err(application_error)?,
        )),
        LoadSoundTable { request } => Ok(HostResponse::Binary(
            crate::load_sound_table_bytes(&runtime.content.runtime, &request.sound_table_id)
                .await
                .map_err(application_error)?,
        )),
        LoadParticleEmitter { request } => Ok(HostResponse::Binary(
            crate::load_particle_emitter_bytes(&runtime.content.runtime, &request.emitter_info_id)
                .await
                .map_err(application_error)?,
        )),
        LoadParticleMeshes { request } => Ok(HostResponse::Binary(
            crate::load_particle_meshes_bytes(&runtime.content.runtime, &request.hw_gfx_obj_ids)
                .await
                .map_err(application_error)?,
        )),
        LoadPhysicsScript { request } => Ok(HostResponse::Binary(
            crate::load_physics_script_bytes(&runtime.content.runtime, &request.script_id)
                .await
                .map_err(application_error)?,
        )),
        LoadLandblockSourceBatch { request } => Ok(HostResponse::Binary(
            crate::load_landblock_source_batch_bytes(
                &runtime.content.runtime,
                &request.landblock_id,
                request.layers,
            )
            .await
            .map_err(application_error)?,
        )),
        LoadLandblockProfile { request } => encode_json(
            crate::load_landblock_profile_response(&runtime.content.runtime, &request.landblock_id)
                .await
                .map_err(application_error)?,
        ),
        LoadSkySource => Ok(HostResponse::Binary(
            crate::load_sky_source_bytes(&runtime.content.runtime)
                .await
                .map_err(application_error)?,
        )),
        LoadTexturePixels { request } => Ok(HostResponse::Binary(
            crate::load_texture_pixels_bytes(&runtime.content.runtime, request)
                .await
                .map_err(application_error)?,
        )),
    }
}

impl HostRuntime {
    fn publish_dynamic_entity(
        &self,
        event: holtburger_core::DynamicEntityEvent,
    ) -> anyhow::Result<()> {
        self.event_sink.publish_dynamic_entity(event)
    }
}

/// MessagePack event sink used by the stdio process.
pub struct StdioEventSink {
    sender: mpsc::SyncSender<ProtocolFrame>,
}

impl StdioEventSink {
    /// Creates a bounded sink that blocks producers when Electron is not draining output.
    pub fn new(sender: mpsc::SyncSender<ProtocolFrame>) -> Self {
        Self { sender }
    }

    fn send(&self, event: HostEvent) -> anyhow::Result<()> {
        self.sender
            .send(ProtocolFrame::Event { event })
            .context("sidecar writer stopped while publishing host event")
    }
}

impl HostEventSink for StdioEventSink {
    fn publish_dynamic_entity(
        &self,
        event: holtburger_core::DynamicEntityEvent,
    ) -> anyhow::Result<()> {
        self.send(HostEvent::DynamicEntity(event))
    }

    fn publish_fixed_tick(&self, envelope: ExplorerFixedTickEnvelope) -> anyhow::Result<()> {
        self.send(HostEvent::FixedTick(envelope))
    }

    fn publish_possession_outcomes(
        &self,
        outcomes: Vec<PossessionEventOutcome>,
    ) -> anyhow::Result<()> {
        self.send(HostEvent::PossessionEventOutcomes(outcomes))
    }

    fn publish_physical_fly_motion(&self, path: PhysicalFlyMotionPath) -> anyhow::Result<()> {
        self.send(HostEvent::PhysicalFlyMotion(path))
    }

    fn publish_physical_fly_failure(&self, failure: PhysicalFlyFailure) -> anyhow::Result<()> {
        self.send(HostEvent::PhysicalFlyFailure(failure))
    }
}

/// Runs the framed sidecar protocol over stdin/stdout.
pub async fn run_stdio() -> anyhow::Result<()> {
    let (sender, receiver) = mpsc::sync_channel(WRITER_QUEUE_CAPACITY);
    let writer_thread = thread::spawn(move || -> anyhow::Result<()> {
        let stdout = io::stdout();
        let mut stdout = io::BufWriter::new(stdout.lock());
        for frame in receiver {
            write_frame(&mut stdout, &frame).context("sidecar stdout writer failed")?;
        }
        Ok(())
    });
    let event_sink = Arc::new(StdioEventSink::new(sender.clone()));
    let runtime = Arc::new(HostRuntime::discover(event_sink)?);
    sender
        .send(ProtocolFrame::Handshake {
            protocol_version: PROTOCOL_VERSION,
            host_name: "holtburger-3d-host".to_string(),
            host_version: env!("CARGO_PKG_VERSION").to_string(),
        })
        .context("sidecar writer stopped before handshake")?;

    let mut stdin = tokio::io::stdin();
    let Some(first) = read_frame_async(&mut stdin).await? else {
        drop(runtime);
        drop(sender);
        writer_thread
            .join()
            .map_err(|_| anyhow::anyhow!("sidecar writer thread panicked"))??;
        return Ok(());
    };
    match first {
        InboundFrame::HandshakeAck { protocol_version } if protocol_version == PROTOCOL_VERSION => {
        }
        InboundFrame::HandshakeAck { protocol_version } => {
            sender
                .send(ProtocolFrame::Rejected {
                    error: ProtocolError {
                        code: "incompatible_protocol".to_string(),
                        message: format!(
                            "host protocol {PROTOCOL_VERSION} cannot communicate with {protocol_version}"
                        ),
                    },
                })
                .ok();
            drop(sender);
            drop(runtime);
            writer_thread
                .join()
                .map_err(|_| anyhow::anyhow!("sidecar writer thread panicked"))??;
            return Ok(());
        }
        _ => {
            sender
                .send(ProtocolFrame::Rejected {
                    error: ProtocolError {
                        code: "handshake_required".to_string(),
                        message: "the first frame must acknowledge the host handshake".to_string(),
                    },
                })
                .ok();
            drop(sender);
            drop(runtime);
            writer_thread
                .join()
                .map_err(|_| anyhow::anyhow!("sidecar writer thread panicked"))??;
            return Ok(());
        }
    }

    let mut pending = tokio::task::JoinSet::new();
    let shutdown_id = loop {
        let Some(frame) = read_frame_async(&mut stdin).await? else {
            break None;
        };
        match frame {
            InboundFrame::Request { id, command } => {
                let runtime = Arc::clone(&runtime);
                let sender = sender.clone();
                pending.spawn(async move {
                    let result = dispatch(&runtime, command).await;
                    sender
                        .send(ProtocolFrame::Response { id, result })
                        .context("sidecar writer stopped while publishing response")
                });
            }
            InboundFrame::Shutdown { id } => {
                break Some(id);
            }
            other => {
                sender
                    .send(ProtocolFrame::Rejected {
                        error: ProtocolError {
                            code: "unexpected_frame".to_string(),
                            message: format!("frame {other:?} is not valid after handshake"),
                        },
                    })
                    .context("sidecar writer stopped while rejecting frame")?;
            }
        }
        // Completed joins are consumed continuously so a long-lived host retains only active work.
        while let Some(result) = pending.try_join_next() {
            result??;
        }
    };
    while let Some(result) = pending.join_next().await {
        result??;
    }
    if let Some(id) = shutdown_id {
        sender
            .send(ProtocolFrame::ShutdownAck { id })
            .context("sidecar writer stopped while acknowledging shutdown")?;
    }
    runtime.shutdown();
    drop(runtime);
    drop(sender);
    writer_thread
        .join()
        .map_err(|_| anyhow::anyhow!("sidecar writer thread panicked"))??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn fragmented_and_coalesced_frames_round_trip() {
        let first_payload = rmp_serde::to_vec_named(&serde_json::json!({
            "kind": "handshake_ack",
            "protocol_version": PROTOCOL_VERSION,
        }))
        .unwrap();
        let second_payload = rmp_serde::to_vec_named(&serde_json::json!({
            "kind": "shutdown",
            "id": 7,
        }))
        .unwrap();
        let first = framed_payload(first_payload);
        let second = framed_payload(second_payload);
        let mut bytes = first.clone();
        bytes.extend(second);
        let mut reader = Cursor::new(bytes);
        assert!(matches!(
            read_frame(&mut reader).unwrap(),
            Some(InboundFrame::HandshakeAck { .. })
        ));
        assert!(matches!(
            read_frame(&mut reader).unwrap(),
            Some(InboundFrame::Shutdown { id: 7 })
        ));
    }

    #[test]
    fn binary_response_uses_messagepack_bin_without_json_number_expansion() {
        let encoded = encode_frame(&ProtocolFrame::Response {
            id: 7,
            result: Ok(HostResponse::Binary(vec![0, 1, 255, 254])),
        })
        .unwrap();
        #[derive(Deserialize)]
        #[serde(tag = "kind", rename_all = "snake_case")]
        enum DecodedFrame {
            Response {
                id: u64,
                result: Result<DecodedResponse, ProtocolError>,
            },
        }
        #[derive(Deserialize)]
        #[serde(tag = "kind", content = "value", rename_all = "snake_case")]
        enum DecodedResponse {
            Binary(#[serde(with = "serde_bytes")] Vec<u8>),
        }
        let decoded: DecodedFrame = rmp_serde::from_slice(&encoded[4..]).unwrap();
        assert!(matches!(
            decoded,
            DecodedFrame::Response {
                id: 7,
                result: Ok(DecodedResponse::Binary(payload))
            } if payload == vec![0, 1, 255, 254]
        ));
    }

    #[test]
    fn event_content_has_exactly_one_payload_layer() {
        let encoded = encode_frame(&ProtocolFrame::Event {
            event: HostEvent::PhysicalFlyFailure(PhysicalFlyFailure {
                session: 7,
                message: "stopped".to_string(),
            }),
        })
        .unwrap();
        let decoded: Value = rmp_serde::from_slice(&encoded[4..]).unwrap();
        assert_eq!(
            decoded,
            serde_json::json!({
                "kind": "event",
                "event": {
                    "event": "physical-fly-failure",
                    "payload": {
                        "session": 7,
                        "message": "stopped",
                    },
                },
            })
        );
    }

    #[test]
    fn exact_frame_limit_is_accepted_and_one_byte_over_is_rejected() {
        assert!(validate_payload_length(MAX_FRAME_BYTES).is_ok());
        assert!(matches!(
            validate_payload_length(MAX_FRAME_BYTES + 1),
            Err(FrameError::Oversize { announced }) if announced == MAX_FRAME_BYTES + 1
        ));
    }

    #[test]
    fn malformed_and_truncated_input_fails_loudly() {
        let mut truncated = Cursor::new(vec![4, 0, 0]);
        assert!(matches!(read_frame(&mut truncated), Err(FrameError::Io(_))));
        let mut malformed = Cursor::new(vec![1, 0, 0, 0, 0xc1]);
        assert!(matches!(
            read_frame(&mut malformed),
            Err(FrameError::Decode(_))
        ));
    }

    fn framed_payload(payload: Vec<u8>) -> Vec<u8> {
        let mut framed = Vec::with_capacity(4 + payload.len());
        framed.extend(u32::try_from(payload.len()).unwrap().to_le_bytes());
        framed.extend(payload);
        framed
    }
}
