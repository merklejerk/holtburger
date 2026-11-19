//! Error, outcome, projection, tick, and possession types for Explorer entity runtime.

use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::Arc;

use holtburger_common::Guid;
use holtburger_core::client::movement_types::CharacterDrive;
use holtburger_core::{
    DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError,
    DynamicEntityBodyRemovalOutcome, DynamicEntityBodyReplacementOutcome, DynamicEntityDefinition,
    DynamicEntityPresentationClass, DynamicEntityProjectionInput,
};
use holtburger_world::{CollisionReportOutcome, LocalPhysicalDemand, RuntimeSpatialBodyView};
use serde::Serialize;

use crate::explorer_possession_control::{
    PossessionEventQueueResult, PossessionIntentError, PossessionJumpPresentation,
    PossessionLifecycleEvent, PossessionRunRateCapability, PossessionStanceCapability,
};
use crate::host_simulation_runtime::{HostDynamicBodyTick, HostPhysicalBodyCoverageRejection};

/// Typed rejection from Explorer identity or instance-generation policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExplorerEntityRuntimeError {
    /// The app-local GUID range has no unallocated identity remaining.
    GuidExhausted,
    /// Prepared collision tracks could not supply the selected initial authored pose.
    InvalidCollisionPose { guid: Guid, cause: String },
    /// The monotonic instance-generation counter cannot advance.
    GenerationExhausted,
    /// A new spawn attempted to publish an already-live identity.
    AlreadyRegistered { guid: Guid },
    /// A lifecycle operation named an identity absent from the registry.
    NotRegistered { guid: Guid },
    /// Late work targeted a retired generation of a live identity.
    StaleGeneration {
        guid: Guid,
        expected: u64,
        actual: u64,
    },
    /// A possession target has no motion table from either entity or setup content.
    MissingPossessionMotionTable { guid: Guid },
    /// A target names a table absent from the projected runtime motion contract.
    UnprojectedMotionTable { guid: Guid, motion_table_id: u32 },
    /// A possession target's authored collision owner is absent from current simulation interest.
    PossessionTargetMissingCollisionOwner { guid: Guid, owner: Guid },
    /// A possession target lies beyond AC's authored outdoor landscape.
    PossessionTargetOutsideLandscape { guid: Guid },
    /// Host validation rejected a stance, drive scalar, or target capability.
    PossessionIntent(PossessionIntentError),
    /// The canonical host scene rejected the corresponding body operation.
    Body(DynamicEntityBodyOperationError),
    /// Non-empty local physical demand reached publication without a prepared definition.
    MissingPreparedPhysics,
    /// Empty local physical demand incorrectly carried a prepared definition.
    UnexpectedPreparedPhysics,
    /// A world-motion operation targeted an attached child at the untyped GUID boundary.
    AttachedOperation {
        guid: Guid,
        parent: Guid,
        /// Noun phrase naming the refused operation, e.g. `"independent despawn"`.
        operation: &'static str,
    },
    /// A published child's own attachment named a wearer other than the group it arrived in.
    ChildWearerMismatch {
        guid: Guid,
        /// Wearer whose group the child was published under.
        expected_parent: Guid,
        /// Wearer the child's own attachment names.
        declared_parent: Guid,
    },
    /// A published child carried world placement where the group requires an attachment.
    ChildNotAttached { guid: Guid, parent: Guid },
}

impl Display for ExplorerEntityRuntimeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidCollisionPose { guid, cause } => {
                write!(formatter, "entity {guid:?} collision pose: {cause}")
            }
            Self::GuidExhausted => {
                formatter.write_str("Explorer dynamic-entity GUID range exhausted")
            }
            Self::GenerationExhausted => {
                formatter.write_str("Explorer dynamic-entity generation counter exhausted")
            }
            Self::AlreadyRegistered { guid } => {
                write!(
                    formatter,
                    "Explorer entity 0x{:08X} is already registered",
                    guid.0
                )
            }
            Self::NotRegistered { guid } => {
                write!(
                    formatter,
                    "Explorer entity 0x{:08X} is not registered",
                    guid.0
                )
            }
            Self::StaleGeneration {
                guid,
                expected,
                actual,
            } => write!(
                formatter,
                "Explorer entity 0x{:08X} generation {expected} is retired; current generation is {actual}",
                guid.0
            ),
            Self::MissingPossessionMotionTable { guid } => write!(
                formatter,
                "Explorer entity 0x{:08X} has no motion table to possess",
                guid.0
            ),
            Self::UnprojectedMotionTable {
                guid,
                motion_table_id,
            } => write!(
                formatter,
                "Explorer entity 0x{:08X} names motion table 0x{motion_table_id:08X}, which is absent from the runtime contract",
                guid.0
            ),
            Self::PossessionTargetMissingCollisionOwner { guid, owner } => write!(
                formatter,
                "Explorer entity 0x{:08X} cannot be possessed because collision owner 0x{:08X} is outside current simulation interest",
                guid.0, owner.0
            ),
            Self::PossessionTargetOutsideLandscape { guid } => write!(
                formatter,
                "Explorer entity 0x{:08X} cannot be possessed outside AC's authored landscape",
                guid.0
            ),
            Self::PossessionIntent(source) => Display::fmt(source, formatter),
            Self::Body(source) => Display::fmt(source, formatter),
            Self::MissingPreparedPhysics => formatter
                .write_str("Explorer entity with physical demand requires prepared physics"),
            Self::UnexpectedPreparedPhysics => formatter.write_str(
                "Explorer entity without physical demand cannot install prepared physics",
            ),
            Self::AttachedOperation {
                guid,
                parent,
                operation,
            } => write!(
                formatter,
                "{operation} is not available for Explorer entity 0x{:08X}; it is attached to wearer 0x{:08X}",
                guid.0, parent.0
            ),
            Self::ChildWearerMismatch {
                guid,
                expected_parent,
                declared_parent,
            } => write!(
                formatter,
                "Explorer child 0x{:08X} declares wearer 0x{:08X}, but was published under wearer 0x{:08X}",
                guid.0, declared_parent.0, expected_parent.0
            ),
            Self::ChildNotAttached { guid, parent } => write!(
                formatter,
                "Explorer child 0x{:08X} published under wearer 0x{:08X} carries world placement instead of an attachment",
                guid.0, parent.0
            ),
        }
    }
}

impl Error for ExplorerEntityRuntimeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Body(source) => Some(source),
            Self::PossessionIntent(source) => Some(source),
            _ => None,
        }
    }
}

impl From<DynamicEntityBodyOperationError> for ExplorerEntityRuntimeError {
    fn from(value: DynamicEntityBodyOperationError) -> Self {
        Self::Body(value)
    }
}

impl From<PossessionIntentError> for ExplorerEntityRuntimeError {
    fn from(value: PossessionIntentError) -> Self {
        Self::PossessionIntent(value)
    }
}

/// One live Explorer-owned semantic instance generation.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityInstance {
    /// Monotonic composition-local generation guarding late outcomes.
    pub generation: u64,
    /// Final producer-owned target and integration demand.
    pub physical_demand: LocalPhysicalDemand,
    /// Explorer-resolved presentation class retained outside the source-neutral definition.
    pub presentation_class: DynamicEntityPresentationClass,
    /// Current complete source-neutral semantic definition.
    pub definition: DynamicEntityDefinition,
}

/// Prepared source-neutral definition paired with Explorer-owned presentation policy.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerPreparedEntity {
    /// Explorer-resolved presentation class computed while complete template facts are available.
    pub presentation_class: DynamicEntityPresentationClass,
    /// Validated definition consumed unchanged by shared simulation behavior.
    pub definition: DynamicEntityDefinition,
}

/// Semantic/body facts returned only after a new instance is fully publishable.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntitySpawnOutcome {
    /// Newly published semantic instance generation.
    pub instance: ExplorerEntityInstance,
    /// Body facts read after canonical scene installation committed.
    pub body: DynamicEntityBodyCommitOutcome,
    /// Attached child generations published in the same registry transaction.
    pub children: Vec<ExplorerEntityInstance>,
}

/// Old/new facts returned after a same-GUID complete replacement commits.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityReplacementOutcome {
    /// Retired semantic generation.
    pub removed: ExplorerEntityInstance,
    /// Newly published semantic generation.
    pub installed: ExplorerEntityInstance,
    /// Canonical old/new body replacement facts.
    pub body: DynamicEntityBodyReplacementOutcome,
    /// Attached child generations retired with the old wearer.
    pub removed_children: Vec<ExplorerEntityInstance>,
    /// Attached child generations published with the successor wearer.
    pub installed_children: Vec<ExplorerEntityInstance>,
}

/// Semantic/body facts returned after one exact generation is despawned.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityDespawnOutcome {
    /// Semantic generation removed from the registry.
    pub instance: ExplorerEntityInstance,
    /// Canonical body facts retired from the host scene.
    pub body: DynamicEntityBodyRemovalOutcome,
    /// Attached child generations retired in the same registry transaction.
    pub children: Vec<ExplorerEntityInstance>,
}

/// Current semantic/solver join built without copying physical state into the registry.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityProjection {
    /// Current semantic generation guarding consumers against stale work.
    pub generation: u64,
    /// Explorer-resolved presentation class carried without reclassification.
    pub presentation_class: DynamicEntityPresentationClass,
    /// Source-neutral semantic facts joined with the current canonical body view.
    pub input: DynamicEntityProjectionInput,
    /// Motion presentation held now, read from the same locked registry transaction.
    pub motion: Option<holtburger_world::motion::MotionPlayback>,
}

/// One accepted fixed-tick body path paired with its still-current semantic generation.
pub struct ExplorerEntityPhysicalTick {
    /// Whether frontend entity presentation consumes this tick; host-side followers ignore this.
    pub publish: bool,
    /// Motion presentation held at the end of this tick, changed or not.
    pub motion: Option<holtburger_world::motion::MotionPlayback>,
    /// Possession lifecycle edges committed with this exact body solve.
    pub possession_event_outcomes: Vec<PossessionEventOutcome>,
    /// Current instance generation held stable across the collection transaction.
    pub generation: u64,
    /// Explorer-resolved presentation class carried with this exact semantic generation.
    pub presentation_class: DynamicEntityPresentationClass,
    /// Source-neutral semantic/body projection read from the committed body without relocking.
    pub input: DynamicEntityProjectionInput,
    /// Complete accepted solver path and immutable collision snapshot used by the solve.
    pub solved: HostDynamicBodyTick,
}

/// Exact possessed identity whose accepted body path belongs to this collection epoch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExplorerPossessedBodyEpoch {
    /// Possessed entity identity.
    pub guid: Guid,
    /// Exact semantic generation protected by the registry lock for the whole solve.
    pub entity_generation: u64,
    /// Exact possession ownership generation protected by the same transaction.
    pub possession_generation: u64,
}

/// Complete host-facing entity collection result before frontend publication filtering.
pub struct ExplorerEntityCollectionTick {
    /// Every scheduled accepted body tick, including stable possessed-body evidence.
    pub ticks: Vec<ExplorerEntityPhysicalTick>,
    /// Frozen peers paired with this collection's target paths while possession is active.
    pub entity_collision: Option<Result<Arc<holtburger_world::EntityCollisionSnapshot>, String>>,
    /// Bodies whose physical steps reached unavailable static coverage.
    pub coverage_rejections: Vec<HostPhysicalBodyCoverageRejection>,
    /// Possessed identity for this epoch, absent after release or retirement.
    pub possession: Option<ExplorerPossessedBodyEpoch>,
}

/// Committed semantic/body facts from one complete effective-state replacement.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityPhysicsStateOutcome {
    /// Updated current semantic instance; identity generation is unchanged.
    pub instance: ExplorerEntityInstance,
    /// Canonical body facts read after the transition committed.
    pub body: DynamicEntityBodyCommitOutcome,
}

/// Current semantic/body facts after one exact-generation launch commits.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityLaunchOutcome {
    /// Updated current semantic instance; launch does not replace its generation.
    pub instance: ExplorerEntityInstance,
    /// Canonical body view after live kinematics and response memory were replaced.
    pub body: RuntimeSpatialBodyView,
}

/// Current semantic/body facts after one discontinuous exact-generation relocation.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityRelocationOutcome {
    /// Unchanged current semantic generation.
    pub instance: ExplorerEntityInstance,
    /// Canonical relocated body with pose-dependent state cleared.
    pub body: RuntimeSpatialBodyView,
    /// Forced report ends returned to the composition but never relayed to the Explorer frontend.
    pub collision_reports: Vec<CollisionReportOutcome>,
}

/// What possessing an entity told the caller about it.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerPossession {
    pub guid: Guid,
    /// Exact semantic entity generation retired by same-GUID replacement.
    pub entity_generation: u64,
    /// Host-issued input ownership epoch changed by every possession and release.
    pub possession_generation: u64,
    pub motion_table_id: u32,
    /// Host-selected valid initial stance.
    pub accepted_stance: u32,
    /// Host-owned run-rate bounds and initial value for this possession generation.
    pub run_rate_capability: PossessionRunRateCapability,
    /// Every offered stance this target table can model, including physical/presentation sources.
    pub stances: Vec<PossessionStanceCapability>,
}

/// Release receipt carrying the new ownership barrier even when nothing was active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExplorerPossessionRelease {
    pub released_guid: Option<Guid>,
    pub possession_generation: u64,
}

/// Queue disposition plus any nonphysical outcomes consumed synchronously without a body tick.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PossessionEventQueueReceipt {
    pub result: PossessionEventQueueResult,
    pub outcomes: Vec<PossessionEventOutcome>,
}

/// Complete replaceable intent targeted at one possession ownership epoch.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExplorerPossessionIntentRequest {
    pub possession_generation: u64,
    pub revision: u64,
    pub stance: u32,
    pub drive: CharacterDrive,
    /// Host-validated run-rate snapshot applied to this complete intent.
    pub run_rate_scalar: f32,
}

/// Ordered lifecycle edge carrying its complete contemporaneous intent snapshot.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExplorerPossessionEventRequest {
    pub possession_generation: u64,
    pub sequence: u64,
    pub revision: u64,
    pub stance: u32,
    pub drive: CharacterDrive,
    /// Host-validated run-rate snapshot captured with this ordered lifecycle edge.
    pub run_rate_scalar: f32,
    pub event: PossessionLifecycleEvent,
}

/// Accepted result for one non-coalescible possession lifecycle edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PossessionEventOutcome {
    pub possession_generation: u64,
    pub sequence: u64,
    pub result: PossessionEventOutcomeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PossessionEventOutcomeKind {
    ChargeAccepted {
        presentation: PossessionJumpPresentation,
    },
    ChargeContinues {
        presentation: PossessionJumpPresentation,
    },
    JumpReleased {
        presentation: PossessionJumpPresentation,
    },
    Reset,
    Rejected {
        reason: PossessionEventRejection,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PossessionEventRejection {
    ChargeNotActive,
    NonphysicalResponse,
    UnsupportedContact,
    Airborne,
    Overburdened,
    CapabilityUnavailable,
}

/// Physical result retained with the possession probe after one fixed-tick body commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExplorerPossessionPhysicalStatus {
    Solved,
}

/// Machine-readable host playback state used by deterministic possession harnesses.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPossessionMotionProbe {
    pub guid: Guid,
    pub entity_generation: u64,
    pub possession_generation: u64,
    /// Rate requested by the currently applied semantic intent.
    pub requested_run_rate: f32,
    /// Last committed generic physical-body result, including bounded prefixes.
    pub physical_status: Option<ExplorerPossessionPhysicalStatus>,
    /// Planar speed achieved by the last committed body tick.
    pub effective_planar_speed: Option<f32>,
    pub style: u32,
    pub substate: ExplorerPossessionActiveMotionProbe,
    pub modifiers: Vec<ExplorerPossessionActiveMotionProbe>,
    pub motion: Option<holtburger_core::DynamicEntityMotion>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPossessionActiveMotionProbe {
    pub command: u32,
    pub speed: f32,
}
