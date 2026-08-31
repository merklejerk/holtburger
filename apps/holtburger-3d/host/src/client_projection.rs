//! Client-specific projection from core view events to the renderer contract.

use std::collections::HashMap;

use holtburger_common::{Guid, stats::VitalType};
use holtburger_core::{
    ClientApplicationSnapshot, ClientCameraStartReceipt, ClientCameraTick,
    ClientCharacterMotionCapabilities, ClientCharacterMotionFeedback, ClientCharacterMotionOutcome,
    ClientCharacterMotionRejection, ClientExitCause, ClientLifecycleState, ClientViewEvent,
    ClientWorldActivationCause, DynamicEntityEvent, PreciseJumpEvaluation,
    PreciseJumpEvaluationStatus, PreciseJumpTransactionFeedback, PreciseJumpTransactionOutcome,
    PreciseJumpTransactionRejection,
};
use holtburger_world::stats::Vital;
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientVitalKind {
    Health,
    Stamina,
    Mana,
}

/// One local-player vital level, projected without exposing world stat internals.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientVitalWire {
    pub kind: ClientVitalKind,
    pub current: u32,
    pub maximum: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientChatKind {
    Speech,
    Tell,
    Channel,
    System,
    Emote,
}

/// One already-interpreted chat line for the combined client buffer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientChatMessageWire {
    pub kind: ClientChatKind,
    pub sender: Option<String>,
    pub channel: Option<String>,
    pub message: String,
}

/// Renderer-safe lifecycle state. Core's broad state and protocol packet values stop here.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ClientLifecycleWire {
    Connecting,
    Authenticating,
    CharacterSelection {
        characters: Vec<ClientCharacterWire>,
    },
    EnteringWorld {
        character_guid: Guid,
    },
    PortalSpace {
        /// Generation shared by the pending world replacement and its renderer products.
        world_generation: u64,
        /// Authority-proven reason for replacing the active scene.
        cause: ClientWorldActivationCauseWire,
    },
    InWorld,
    Exiting {
        cause: ClientExitCauseWire,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCharacterWire {
    /// Server-assigned character identity used by the entry command.
    pub guid: Guid,
    /// Server-provided display name.
    pub name: String,
    /// Stable ordinal in the server-provided character list.
    pub slot: u32,
    /// Server deletion timestamp; zero denotes an active character.
    pub delete_time: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientExitCauseWire {
    ExplicitDisconnect,
    ServerDisconnect,
    StartupFailure,
    RuntimeFailure,
    HostShutdown,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientPresentationDiscontinuityWire {
    ForcedReposition,
    Reset,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientWorldActivationCauseWire {
    InitialEntry,
    Teleport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCurrentState {
    /// Complete renderer-facing lifecycle level.
    pub lifecycle: ClientLifecycleWire,
    /// Exact local-player identity, absent until the server creates the player object.
    pub local_player_guid: Option<Guid>,
    /// Synchronized server time, absent until a server time-sync arrives.
    pub server_time: Option<f64>,
    /// Monotonic generation invalidating presentation history across discontinuities.
    pub world_generation: u64,
    /// Latest server-provided world name.
    pub world_name: Option<String>,
    /// Current local-player display name.
    pub player_name: Option<String>,
    /// Complete local-player vital replacement level.
    pub vitals: Vec<ClientVitalWire>,
    /// Current jump charge timing, absent until core has complete authority facts.
    pub character_motion: Option<ClientCharacterMotionCapabilitiesWire>,
    /// Complete focused dynamic-entity replacement level.
    pub dynamic: holtburger_core::DynamicEntitySnapshot,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCharacterMotionCapabilitiesWire {
    pub full_charge_duration_ms: u64,
}

impl From<ClientCharacterMotionCapabilities> for ClientCharacterMotionCapabilitiesWire {
    fn from(capabilities: ClientCharacterMotionCapabilities) -> Self {
        Self {
            full_charge_duration_ms: capabilities
                .full_charge_duration
                .as_millis()
                .try_into()
                .expect("character jump charge duration must fit the host wire contract"),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCharacterMotionFeedbackWire {
    pub sequence: u64,
    pub outcome: ClientCharacterMotionOutcomeWire,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ClientCharacterMotionOutcomeWire {
    ChargeAccepted,
    ChargeContinues,
    JumpCommitted,
    Reset,
    Rejected {
        reason: ClientCharacterMotionRejectionWire,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientCharacterMotionRejectionWire {
    ChargeNotActive,
    Airborne,
    Unsupported,
    Overburdened,
    CapabilityUnavailable,
    BodyUnavailable,
    CollisionUnavailable,
    LaunchRejected,
}

impl From<ClientCharacterMotionFeedback> for ClientCharacterMotionFeedbackWire {
    fn from(feedback: ClientCharacterMotionFeedback) -> Self {
        let outcome = match feedback.outcome {
            ClientCharacterMotionOutcome::ChargeAccepted => {
                ClientCharacterMotionOutcomeWire::ChargeAccepted
            }
            ClientCharacterMotionOutcome::ChargeContinues => {
                ClientCharacterMotionOutcomeWire::ChargeContinues
            }
            ClientCharacterMotionOutcome::JumpCommitted => {
                ClientCharacterMotionOutcomeWire::JumpCommitted
            }
            ClientCharacterMotionOutcome::Reset => ClientCharacterMotionOutcomeWire::Reset,
            ClientCharacterMotionOutcome::Rejected(reason) => {
                ClientCharacterMotionOutcomeWire::Rejected {
                    reason: reason.into(),
                }
            }
        };
        Self {
            sequence: feedback.sequence.0,
            outcome,
        }
    }
}

impl From<ClientCharacterMotionRejection> for ClientCharacterMotionRejectionWire {
    fn from(reason: ClientCharacterMotionRejection) -> Self {
        match reason {
            ClientCharacterMotionRejection::ChargeNotActive => Self::ChargeNotActive,
            ClientCharacterMotionRejection::Airborne => Self::Airborne,
            ClientCharacterMotionRejection::Unsupported => Self::Unsupported,
            ClientCharacterMotionRejection::Overburdened => Self::Overburdened,
            ClientCharacterMotionRejection::CapabilityUnavailable => Self::CapabilityUnavailable,
            ClientCharacterMotionRejection::BodyUnavailable => Self::BodyUnavailable,
            ClientCharacterMotionRejection::CollisionUnavailable => Self::CollisionUnavailable,
            ClientCharacterMotionRejection::LaunchRejected => Self::LaunchRejected,
        }
    }
}

/// Collision target placement in one explicit normalized outdoor anchor frame.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPreciseJumpTargetWire {
    pub anchor: Guid,
    pub point: [f32; 3],
    pub normal: [f32; 3],
    pub committed_cell: Option<Guid>,
}

/// Bounded speculative-work facts used by client diagnostics only.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPreciseJumpDiagnosticsWire {
    pub generated_candidates: usize,
    pub evaluated_candidates: usize,
    pub solver_ticks: u64,
}

/// One portal/render-domain interval over the trajectory's normalized time.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPreciseJumpTrajectoryPlacementWire {
    /// Inclusive start of this render-domain interval.
    pub start_fraction: f32,
    /// Exclusive interval end, except that the final interval includes one.
    pub end_fraction: f32,
    /// EnvCell identity, or `None` for the outdoor domain.
    pub committed_cell: Option<Guid>,
}

/// Compact read-only analytic curve authorized by the collision predictor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPreciseJumpTrajectoryWire {
    /// Normalized outdoor coordinate frame containing every coefficient.
    pub anchor: Guid,
    /// Body-reference launch point in anchor-local AC axes.
    pub origin: [f32; 3],
    /// Launch velocity in anchor-local AC axes.
    pub velocity: [f32; 3],
    /// Constant acceleration in anchor-local AC axes.
    pub acceleration: [f32; 3],
    /// Positive analytic curve duration.
    pub duration_seconds: f32,
    /// Gap-free render-domain partition over normalized curve time.
    pub placements: Vec<ClientPreciseJumpTrajectoryPlacementWire>,
}

/// Status-discriminated presentation result; only reachable can contain a trajectory.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ClientPreciseJumpResultWire {
    NoSurface,
    Reachable {
        /// Read-only presentation curve; commit authority never consumes it.
        trajectory: ClientPreciseJumpTrajectoryWire,
    },
    Unreachable,
    Unproven,
    InvalidAim,
    SolverFailed,
}

/// Narrow renderer-safe evaluation. Curve coefficients are one-way presentation evidence.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPreciseJumpEvaluationWire {
    pub evaluation_id: u64,
    pub camera: holtburger_core::ClientCameraIdentity,
    pub sequence: u64,
    pub target: Option<ClientPreciseJumpTargetWire>,
    #[serde(flatten)]
    pub result: ClientPreciseJumpResultWire,
    pub diagnostics: ClientPreciseJumpDiagnosticsWire,
}

impl From<PreciseJumpEvaluation> for ClientPreciseJumpEvaluationWire {
    fn from(evaluation: PreciseJumpEvaluation) -> Self {
        let result = match evaluation.status {
            PreciseJumpEvaluationStatus::NoSurface => ClientPreciseJumpResultWire::NoSurface,
            PreciseJumpEvaluationStatus::Reachable(trajectory) => {
                let origin = trajectory.origin();
                let velocity = trajectory.velocity();
                let acceleration = trajectory.acceleration();
                ClientPreciseJumpResultWire::Reachable {
                    trajectory: ClientPreciseJumpTrajectoryWire {
                        anchor: trajectory.anchor(),
                        origin: [origin.x, origin.y, origin.z],
                        velocity: [velocity.x, velocity.y, velocity.z],
                        acceleration: [acceleration.x, acceleration.y, acceleration.z],
                        duration_seconds: trajectory.duration_seconds(),
                        placements: trajectory
                            .placements()
                            .iter()
                            .map(|placement| ClientPreciseJumpTrajectoryPlacementWire {
                                start_fraction: placement.start_fraction(),
                                end_fraction: placement.end_fraction(),
                                committed_cell: placement.committed_cell(),
                            })
                            .collect(),
                    },
                }
            }
            PreciseJumpEvaluationStatus::Unreachable(_) => ClientPreciseJumpResultWire::Unreachable,
            PreciseJumpEvaluationStatus::Unproven(_) => ClientPreciseJumpResultWire::Unproven,
            PreciseJumpEvaluationStatus::InvalidAim => ClientPreciseJumpResultWire::InvalidAim,
            PreciseJumpEvaluationStatus::SolverFailed => ClientPreciseJumpResultWire::SolverFailed,
        };
        let target = evaluation.target.map(|target| ClientPreciseJumpTargetWire {
            anchor: target.anchor,
            point: [target.point.x, target.point.y, target.point.z],
            normal: [target.normal.x, target.normal.y, target.normal.z],
            committed_cell: target.committed_cell,
        });
        Self {
            evaluation_id: evaluation.id.get(),
            camera: evaluation.camera,
            sequence: evaluation.sequence.0,
            target,
            result,
            diagnostics: ClientPreciseJumpDiagnosticsWire {
                generated_candidates: evaluation.diagnostics.generated_candidates(),
                evaluated_candidates: evaluation.diagnostics.evaluated_candidates(),
                solver_ticks: evaluation.diagnostics.solver_ticks(),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientPreciseJumpTransactionRejectionWire {
    StaleAction,
    CommitPending,
    NoReachableEvaluation,
    EvaluationMismatch,
    AuthorityChanged,
    FreshResolutionRejected,
    LaunchRejected,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ClientPreciseJumpTransactionOutcomeWire {
    Cancelled,
    Committed,
    Rejected {
        reason: ClientPreciseJumpTransactionRejectionWire,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPreciseJumpTransactionFeedbackWire {
    pub sequence: u64,
    pub outcome: ClientPreciseJumpTransactionOutcomeWire,
}

impl From<PreciseJumpTransactionFeedback> for ClientPreciseJumpTransactionFeedbackWire {
    fn from(feedback: PreciseJumpTransactionFeedback) -> Self {
        let outcome = match feedback.outcome {
            PreciseJumpTransactionOutcome::Cancelled => {
                ClientPreciseJumpTransactionOutcomeWire::Cancelled
            }
            PreciseJumpTransactionOutcome::Committed => {
                ClientPreciseJumpTransactionOutcomeWire::Committed
            }
            PreciseJumpTransactionOutcome::Rejected(reason) => {
                ClientPreciseJumpTransactionOutcomeWire::Rejected {
                    reason: match reason {
                        PreciseJumpTransactionRejection::StaleAction => {
                            ClientPreciseJumpTransactionRejectionWire::StaleAction
                        }
                        PreciseJumpTransactionRejection::CommitPending => {
                            ClientPreciseJumpTransactionRejectionWire::CommitPending
                        }
                        PreciseJumpTransactionRejection::NoReachableEvaluation => {
                            ClientPreciseJumpTransactionRejectionWire::NoReachableEvaluation
                        }
                        PreciseJumpTransactionRejection::EvaluationMismatch => {
                            ClientPreciseJumpTransactionRejectionWire::EvaluationMismatch
                        }
                        PreciseJumpTransactionRejection::AuthorityChanged => {
                            ClientPreciseJumpTransactionRejectionWire::AuthorityChanged
                        }
                        PreciseJumpTransactionRejection::FreshResolutionRejected => {
                            ClientPreciseJumpTransactionRejectionWire::FreshResolutionRejected
                        }
                        PreciseJumpTransactionRejection::LaunchRejected => {
                            ClientPreciseJumpTransactionRejectionWire::LaunchRejected
                        }
                    },
                }
            }
        };
        Self {
            sequence: feedback.sequence.0,
            outcome,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPresentationDiscontinuity {
    /// Generation that becomes current after this edge.
    pub world_generation: u64,
    /// Authority-classified discontinuity kind.
    pub kind: ClientPresentationDiscontinuityWire,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientExitRequested {
    /// Typed terminal cause used by Electron exit policy.
    pub cause: ClientExitCauseWire,
    /// Redacted diagnostic suitable for the main-process error surface.
    pub diagnostic: String,
}

/// Narrow event vocabulary emitted by the client host. It is converted into the outer sidecar
/// frame only at the protocol writer, so core `ClientViewEvent` never becomes a wire contract.
#[derive(Debug, Clone)]
pub enum ClientHostEvent {
    CurrentState(ClientCurrentState),
    LifecycleChanged(ClientLifecycleWire),
    CharacterMotionCapabilitiesUpdated(Option<ClientCharacterMotionCapabilitiesWire>),
    CharacterMotionFeedback(ClientCharacterMotionFeedbackWire),
    PreciseJumpEvaluation(ClientPreciseJumpEvaluationWire),
    PreciseJumpTransactionFeedback(ClientPreciseJumpTransactionFeedbackWire),
    LocalPlayerEstablished { player_guid: Guid },
    ServerTimeUpdated { time: f64 },
    WorldNameUpdated { name: String },
    PlayerEntered { player_guid: Guid, name: String },
    PlayerVitalsUpdated { vitals: Vec<ClientVitalWire> },
    ChatMessage(ClientChatMessageWire),
    DynamicEntity(DynamicEntityEvent),
    Camera(ClientCameraTick),
    CameraStarted(ClientCameraStartReceipt),
    PresentationDiscontinuity(ClientPresentationDiscontinuity),
    ExitRequested(ClientExitRequested),
}

impl From<&ClientLifecycleState> for ClientLifecycleWire {
    fn from(state: &ClientLifecycleState) -> Self {
        match state {
            ClientLifecycleState::Connecting => Self::Connecting,
            ClientLifecycleState::Authenticating => Self::Authenticating,
            ClientLifecycleState::CharacterSelection { characters } => Self::CharacterSelection {
                characters: characters
                    .iter()
                    .map(|character| ClientCharacterWire {
                        guid: character.guid,
                        name: character.name.clone(),
                        slot: character.slot,
                        delete_time: character.delete_time,
                    })
                    .collect(),
            },
            ClientLifecycleState::EnteringWorld { character_guid } => Self::EnteringWorld {
                character_guid: *character_guid,
            },
            ClientLifecycleState::PortalSpace {
                world_generation,
                cause,
            } => Self::PortalSpace {
                world_generation: *world_generation,
                cause: (*cause).into(),
            },
            ClientLifecycleState::InWorld => Self::InWorld,
            ClientLifecycleState::Exiting { cause } => Self::Exiting {
                cause: (*cause).into(),
            },
        }
    }
}

impl From<ClientWorldActivationCause> for ClientWorldActivationCauseWire {
    fn from(cause: ClientWorldActivationCause) -> Self {
        match cause {
            ClientWorldActivationCause::InitialEntry => Self::InitialEntry,
            ClientWorldActivationCause::Teleport => Self::Teleport,
        }
    }
}

impl From<ClientExitCause> for ClientExitCauseWire {
    fn from(cause: ClientExitCause) -> Self {
        match cause {
            ClientExitCause::ExplicitDisconnect => Self::ExplicitDisconnect,
            ClientExitCause::ServerDisconnect => Self::ServerDisconnect,
            ClientExitCause::StartupFailure => Self::StartupFailure,
            ClientExitCause::RuntimeFailure => Self::RuntimeFailure,
            ClientExitCause::HostShutdown => Self::HostShutdown,
        }
    }
}

impl From<holtburger_core::ClientPresentationDiscontinuityKind>
    for ClientPresentationDiscontinuityWire
{
    fn from(kind: holtburger_core::ClientPresentationDiscontinuityKind) -> Self {
        match kind {
            holtburger_core::ClientPresentationDiscontinuityKind::ForcedReposition => {
                Self::ForcedReposition
            }
            holtburger_core::ClientPresentationDiscontinuityKind::Reset => Self::Reset,
        }
    }
}

impl From<&ClientApplicationSnapshot> for ClientCurrentState {
    fn from(snapshot: &ClientApplicationSnapshot) -> Self {
        Self {
            lifecycle: (&snapshot.lifecycle).into(),
            local_player_guid: snapshot.local_player_guid,
            server_time: snapshot.server_time,
            world_generation: snapshot.world_generation,
            world_name: snapshot.world_name.clone(),
            player_name: snapshot.player_name.clone(),
            vitals: project_vitals(&snapshot.vitals),
            character_motion: snapshot.character_motion.map(Into::into),
            dynamic: snapshot.dynamic.clone(),
        }
    }
}

/// Projects one broad core event into the renderer-safe client event surface.
pub fn project_client_event(event: ClientViewEvent) -> Option<ClientHostEvent> {
    match event {
        ClientViewEvent::ApplicationSnapshot(snapshot) => {
            Some(ClientHostEvent::CurrentState((&snapshot).into()))
        }
        ClientViewEvent::LifecycleChanged(lifecycle) => {
            Some(ClientHostEvent::LifecycleChanged((&lifecycle).into()))
        }
        ClientViewEvent::CharacterMotionCapabilitiesUpdated { capabilities } => Some(
            ClientHostEvent::CharacterMotionCapabilitiesUpdated(capabilities.map(Into::into)),
        ),
        ClientViewEvent::CharacterMotionFeedback(feedback) => {
            Some(ClientHostEvent::CharacterMotionFeedback(feedback.into()))
        }
        ClientViewEvent::PreciseJumpEvaluation(evaluation) => {
            Some(ClientHostEvent::PreciseJumpEvaluation(evaluation.into()))
        }
        ClientViewEvent::PreciseJumpTransactionFeedback(feedback) => Some(
            ClientHostEvent::PreciseJumpTransactionFeedback(feedback.into()),
        ),
        ClientViewEvent::LocalPlayerEstablished { player_guid } => {
            Some(ClientHostEvent::LocalPlayerEstablished { player_guid })
        }
        ClientViewEvent::ServerTimeUpdated { time } => {
            Some(ClientHostEvent::ServerTimeUpdated { time })
        }
        ClientViewEvent::WorldNameUpdated(name) => Some(ClientHostEvent::WorldNameUpdated { name }),
        ClientViewEvent::PlayerEntered { guid, name } => Some(ClientHostEvent::PlayerEntered {
            player_guid: guid,
            name,
        }),
        ClientViewEvent::PlayerVitalsUpdated { vitals } => {
            Some(ClientHostEvent::PlayerVitalsUpdated {
                vitals: project_vitals(&vitals),
            })
        }
        ClientViewEvent::ServerMessage { message, .. } => {
            Some(ClientHostEvent::ChatMessage(ClientChatMessageWire {
                kind: ClientChatKind::System,
                sender: None,
                channel: None,
                message,
            }))
        }
        ClientViewEvent::Chat {
            sender, message, ..
        } => Some(ClientHostEvent::ChatMessage(ClientChatMessageWire {
            kind: ClientChatKind::Speech,
            sender: Some(sender),
            channel: None,
            message,
        })),
        ClientViewEvent::Tell { sender, message } => {
            Some(ClientHostEvent::ChatMessage(ClientChatMessageWire {
                kind: ClientChatKind::Tell,
                sender: Some(sender),
                channel: None,
                message,
            }))
        }
        ClientViewEvent::ChannelMessage {
            channel,
            sender,
            message,
        } => Some(ClientHostEvent::ChatMessage(ClientChatMessageWire {
            kind: ClientChatKind::Channel,
            sender: Some(sender),
            channel: Some(format!("{:?}", channel.kind)),
            message,
        })),
        ClientViewEvent::Emote { sender, text } | ClientViewEvent::SoulEmote { sender, text } => {
            Some(ClientHostEvent::ChatMessage(ClientChatMessageWire {
                kind: ClientChatKind::Emote,
                sender: Some(sender),
                channel: None,
                message: text,
            }))
        }
        ClientViewEvent::DynamicEntity(event) => Some(ClientHostEvent::DynamicEntity(event)),
        ClientViewEvent::Camera(tick) => Some(ClientHostEvent::Camera(tick)),
        ClientViewEvent::CameraStarted(receipt) => Some(ClientHostEvent::CameraStarted(receipt)),
        ClientViewEvent::PresentationDiscontinuity {
            world_generation,
            kind,
        } => Some(ClientHostEvent::PresentationDiscontinuity(
            ClientPresentationDiscontinuity {
                world_generation,
                kind: kind.into(),
            },
        )),
        _ => None,
    }
}

fn project_vitals(vitals: &HashMap<VitalType, Vital>) -> Vec<ClientVitalWire> {
    [VitalType::Health, VitalType::Stamina, VitalType::Mana]
        .into_iter()
        .filter_map(|kind| {
            let vital = vitals.get(&kind)?;
            Some(ClientVitalWire {
                kind: match kind {
                    VitalType::Health => ClientVitalKind::Health,
                    VitalType::Stamina => ClientVitalKind::Stamina,
                    VitalType::Mana => ClientVitalKind::Mana,
                },
                current: vital.current,
                maximum: vital.buffed_max,
            })
        })
        .collect()
}

/// Converts an explicit task result into a redacted diagnostic without preserving credentials.
pub fn client_exit_requested(
    cause: ClientExitCause,
    diagnostic: impl Into<String>,
) -> ClientHostEvent {
    ClientHostEvent::ExitRequested(ClientExitRequested {
        cause: cause.into(),
        diagnostic: diagnostic.into(),
    })
}
