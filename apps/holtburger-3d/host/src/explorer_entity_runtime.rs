//! Explorer-local dynamic-entity identity, semantic lifetime, and ordered body orchestration.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::{Arc, Mutex};

use anyhow::Context;
use holtburger_common::{Guid, RigidTransform, Vector3};
use holtburger_content::MotionSequenceCatalog;
use holtburger_core::client::movement_types::CharacterDrive;
use holtburger_core::{
    AdjustedForwardAxis, CharacterJumpReadiness, CharacterJumpRejection, CharacterMotionContact,
    CharacterMotionEventResult, CharacterMotionRejection, CharacterMotionSequence,
    DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError,
    DynamicEntityBodyRemovalOutcome, DynamicEntityBodyReplacementOutcome, DynamicEntityDefinition,
    DynamicEntityInitialState, DynamicEntityLaunchPlan, DynamicEntityProjectionInput,
    SequencedCharacterMotionEvent, dynamic_entity_projection_input_from_body,
    resolve_character_jump,
};
use holtburger_world::motion::{
    BodyMotionRuntime, MotionCommand, MotionOrder, MotionRuntimeRegistry, PlayingMotionClip,
};
use holtburger_world::{
    CollisionReportOutcome, ContactState, DynamicPhysicalBodyDefinition, GroundedLaunch,
    PhysicalBodyActuation, PhysicalBodyDefinition, PhysicalBodyTickStatus, RuntimeSpatialBodyView,
    SpatialBody, SpatialBodyId, gate_authored_offset, grounded_character_actuation,
};
use holtburger_world::{
    EffectiveEntityPhysicsState, EntityPhysicalIntent, EntityPhysicsTransitionContext,
    EntityPhysicsTransitionDecision, EntityPlacement, decide_entity_physics_state_transition,
    resolve_effective_entity_physics_state,
};
use serde::Serialize;

use crate::explorer_possession_control::{
    ActivePossession, ExplorerPossessionControlProfile, PossessionEventQueueResult,
    PossessionIntentError, PossessionIntentReplaceResult, PossessionIntentSnapshot,
    PossessionLifecycleEvent, PossessionLocomotionSource, PossessionRunRateCapability,
    PossessionStanceCapability,
};
use crate::host_simulation_runtime::{
    HostPhysicalBodyCoverageRejection, HostPhysicalBodyTick, HostSimulationRuntime,
};

const EXPLORER_GUID_START: u32 = 0xf000_0001;
const EXPLORER_GUID_END: u32 = 0xffff_fffe;

/// Typed rejection from Explorer identity or instance-generation policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExplorerEntityRuntimeError {
    /// The app-local GUID range has no unallocated identity remaining.
    GuidExhausted,
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
    UnprojectedPossessionMotionTable { guid: Guid, motion_table_id: u32 },
    /// A possession target's authored collision owner is absent from current simulation interest.
    PossessionTargetMissingCollisionOwner { guid: Guid, owner: Guid },
    /// A possession target lies beyond AC's authored outdoor landscape.
    PossessionTargetOutsideLandscape { guid: Guid },
    /// Host validation rejected a stance, drive scalar, or target capability.
    PossessionIntent(PossessionIntentError),
    /// The canonical host scene rejected the corresponding body operation.
    Body(DynamicEntityBodyOperationError),
    /// Simulated intent reached publication without a prepared physical definition.
    MissingPreparedPhysics,
    /// Pose-only intent incorrectly carried a physical definition.
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
            Self::UnprojectedPossessionMotionTable {
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
            Self::MissingPreparedPhysics => {
                formatter.write_str("simulated Explorer entity requires prepared physics")
            }
            Self::UnexpectedPreparedPhysics => {
                formatter.write_str("pose-only Explorer entity cannot install prepared physics")
            }
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
    /// Producer policy retained independently from current solver participation.
    pub physical_intent: EntityPhysicalIntent,
    /// Current complete source-neutral semantic definition.
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
    /// Source-neutral semantic facts joined with the current canonical body view.
    pub input: DynamicEntityProjectionInput,
    /// Clip this entity is playing right now, read from the same locked registry transaction.
    pub playing_clip: Option<holtburger_world::motion::PlayingMotionClip>,
}

/// One accepted fixed-tick body path paired with its still-current semantic generation.
pub struct ExplorerEntityPhysicalTick {
    /// Whether frontend entity presentation consumes this tick; host-side followers ignore this.
    pub publish: bool,
    /// Clip this entity is playing at the end of this tick, changed or not.
    pub playing_clip: Option<holtburger_world::motion::PlayingMotionClip>,
    /// Possession lifecycle edges committed with this exact body solve.
    pub possession_event_outcomes: Vec<PossessionEventOutcome>,
    /// Current instance generation held stable across the collection transaction.
    pub generation: u64,
    /// Source-neutral semantic/body projection read from the committed body without relocking.
    pub input: DynamicEntityProjectionInput,
    /// Complete accepted solver path and immutable collision snapshot used by the solve.
    pub solved: HostPhysicalBodyTick,
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
    /// Unchanged bodies whose current transactions required unavailable static coverage.
    pub coverage_rejections: Vec<HostPhysicalBodyCoverageRejection>,
    /// Possessed identity for this epoch, absent after release or retirement.
    pub possession: Option<ExplorerPossessedBodyEpoch>,
}

/// Committed semantic/body facts from one complete effective-state replacement.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityPhysicsStateOutcome {
    /// Updated current semantic instance; identity generation is unchanged.
    pub instance: ExplorerEntityInstance,
    /// Pure shared transition decision applied to the canonical body.
    pub decision: EntityPhysicsTransitionDecision,
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

#[derive(Debug, Clone)]
struct ExplorerGuidAllocator {
    start: u32,
    end: u32,
    next: Option<u32>,
}

impl ExplorerGuidAllocator {
    fn new(start: u32, end: u32) -> Self {
        assert!(
            start != 0 && start <= end,
            "Explorer GUID range must be nonempty"
        );
        Self {
            start,
            end,
            next: Some(start),
        }
    }

    fn allocate(&mut self) -> Result<Guid, ExplorerEntityRuntimeError> {
        let value = self.next.ok_or(ExplorerEntityRuntimeError::GuidExhausted)?;
        self.next = (value < self.end).then_some(value + 1);
        Ok(Guid(value))
    }

    fn reset(&mut self) {
        self.next = Some(self.start);
    }
}

/// Explorer's sole semantic authority for live dynamic entities.
///
/// Physical state deliberately does not live here. The outer runtime joins each record with the
/// canonical `HostSimulationRuntime` body only while producing a snapshot or focused outcome.
#[derive(Debug)]
pub struct ExplorerEntityRegistry {
    entities: BTreeMap<Guid, ExplorerEntityInstance>,
    allocator: ExplorerGuidAllocator,
    next_generation: Option<u64>,
    /// Authored-motion playback and possession.
    ///
    /// Kept inside the registry rather than beside it so one lock covers both: the collection tick
    /// holds the registry across a whole simulation transaction, and a second lock would invite an
    /// ordering bug for no benefit. This is also the plan's rule — producer registries retain
    /// semantic state — and it is what keeps the Explorer and the client separate authorities over
    /// the same shared contract.
    motion: ExplorerMotionState,
}

/// Which entity is being driven, what it has been told to do, and where its playback is.
#[derive(Debug, Default)]
struct ExplorerMotionState {
    playback: MotionRuntimeRegistry,
    /// Exact entity/possession generation and all controller-owned input state.
    active: Option<ActivePossession>,
    /// Clip each body's most recent publication carried, so an unchanged level costs no traffic.
    published: BTreeMap<Guid, PlayingMotionClip>,
    /// Latest accepted physical result for the active possession, including bounded prefixes.
    last_physical_status: Option<ExplorerPossessionPhysicalStatus>,
    /// Planar speed achieved by the latest accepted body tick, for clamp diagnostics.
    last_effective_planar_speed: Option<f32>,
}

impl ExplorerMotionState {
    /// Forgets publication history for bodies that no longer exist.
    fn retain_published(&mut self, live: &BTreeSet<Guid>) {
        self.published.retain(|guid, _| live.contains(guid));
    }

    /// Whether one body's current clip has yet to reach a consumer.
    ///
    /// Read before the collection scan so a body whose only news is a clip change can be woken
    /// into it. Playback alone does not schedule a body: an idle contributes no motion, so a
    /// settled entity would otherwise have no tick to carry its level on.
    fn clip_awaits_publication(&self, guid: Guid) -> bool {
        self.playback.playing_clip(guid) != self.published.get(&guid).copied()
    }

    /// Commits the clip one body's publication carries, reporting whether it changed.
    ///
    /// Only a body that actually produced a tick commits. A body with no tick this epoch has
    /// nothing to carry its level, so it stays pending and re-offers the change on its next one.
    fn commit_published_clip(&mut self, guid: Guid) -> (Option<PlayingMotionClip>, bool) {
        let clip = self.playback.playing_clip(guid);
        let changed = match clip {
            Some(clip) => self.published.insert(guid, clip) != Some(clip),
            None => self.published.remove(&guid).is_some(),
        };
        (clip, changed)
    }

    fn release(&mut self) -> Option<Guid> {
        self.last_physical_status = None;
        self.last_effective_planar_speed = None;
        let active = self.active.take()?;
        self.playback.forget(active.guid);
        Some(active.guid)
    }

    fn retire_target(&mut self, guid: Guid, entity_generation: u64) -> bool {
        if self.active.as_ref().is_some_and(|active| {
            active.guid == guid && active.entity_generation == entity_generation
        }) {
            self.release();
            true
        } else {
            false
        }
    }
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
        presentation: crate::explorer_possession_control::PossessionJumpPresentation,
    },
    ChargeContinues {
        presentation: crate::explorer_possession_control::PossessionJumpPresentation,
    },
    JumpReleased {
        presentation: crate::explorer_possession_control::PossessionJumpPresentation,
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
}

/// Physical result retained with the possession probe after one fixed-tick body commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExplorerPossessionPhysicalStatus {
    Solved,
    SubstepBudgetExceeded,
}

/// Classifies physical results whose solved state possession is allowed to commit.
const fn committed_possession_physical_status(
    status: PhysicalBodyTickStatus,
) -> Option<ExplorerPossessionPhysicalStatus> {
    match status {
        PhysicalBodyTickStatus::Solved => Some(ExplorerPossessionPhysicalStatus::Solved),
        PhysicalBodyTickStatus::SubstepBudgetExceeded => {
            Some(ExplorerPossessionPhysicalStatus::SubstepBudgetExceeded)
        }
        PhysicalBodyTickStatus::ContactBudgetExceeded => None,
    }
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
    pub clip: Option<holtburger_core::DynamicEntityPlayingClip>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerPossessionActiveMotionProbe {
    pub command: u32,
    pub speed: f32,
}

/// Tentative possession/controller/playback state paired with one proposed body actuation.
struct PossessionTickProposal {
    active: ActivePossession,
    playback: BodyMotionRuntime,
    pre_solve_contact: ContactState,
    outcomes: Vec<PossessionEventOutcome>,
}

fn consume_nonphysical_possession_events(
    active: &mut ActivePossession,
) -> Result<Vec<PossessionEventOutcome>, PossessionIntentError> {
    let mut outcomes = Vec::new();
    while let Some(pending) = active.pending_events.remove(&active.next_event_sequence) {
        let sequence = active.next_event_sequence;
        active.next_event_sequence += 1;
        if pending.intent.revision >= active.applied_intent.revision {
            active.applied_intent = pending.intent;
        }
        let result = if matches!(pending.event, holtburger_core::CharacterMotionEvent::Reset) {
            active.controller.clear();
            active.applied_intent = active.resolve_effective_intent(CharacterDrive::default())?;
            PossessionEventOutcomeKind::Reset
        } else {
            PossessionEventOutcomeKind::Rejected {
                reason: PossessionEventRejection::NonphysicalResponse,
            }
        };
        outcomes.push(PossessionEventOutcome {
            possession_generation: active.generation,
            sequence,
            result,
        });
    }
    Ok(outcomes)
}

impl PossessionTickProposal {
    fn reconcile_playback(
        &mut self,
        table: &holtburger_content::MotionSequenceTable,
        contact: ContactState,
    ) -> anyhow::Result<()> {
        if contact == self.pre_solve_contact {
            return Ok(());
        }
        let order = effective_possession_order(&self.active, contact, false)?;
        self.playback.drive(table, order, 0.0);
        self.pre_solve_contact = contact;
        Ok(())
    }
}

fn propose_possession_tick(
    mut active: ActivePossession,
    previous_playback: Option<&BodyMotionRuntime>,
    table: &holtburger_content::MotionSequenceTable,
    body: &SpatialBody,
    object_scale: f32,
    profile: ExplorerPossessionControlProfile,
    delta_seconds: f32,
) -> anyhow::Result<(PossessionTickProposal, PhysicalBodyActuation)> {
    let grounded_response = body.physical.as_ref().is_some_and(|physical| {
        matches!(physical.definition, PhysicalBodyDefinition::Grounded { .. })
    });
    let mut outcomes = Vec::new();
    let mut launch = None;

    while let Some(pending) = active.pending_events.remove(&active.next_event_sequence) {
        let sequence = active.next_event_sequence;
        active.next_event_sequence += 1;
        if pending.intent.revision >= active.applied_intent.revision {
            active.applied_intent = pending.intent;
        }
        let result = if !grounded_response {
            if matches!(pending.event, holtburger_core::CharacterMotionEvent::Reset) {
                active.controller.clear();
            }
            PossessionEventOutcomeKind::Rejected {
                reason: PossessionEventRejection::NonphysicalResponse,
            }
        } else {
            let contact = if launch.is_some() {
                CharacterMotionContact::Unsupported
            } else if body.contact == ContactState::Grounded {
                CharacterMotionContact::Walkable
            } else {
                CharacterMotionContact::Unsupported
            };
            let event_result = active.controller.apply_event(
                SequencedCharacterMotionEvent {
                    sequence: CharacterMotionSequence(sequence),
                    event: pending.event,
                },
                contact,
            );
            let presentation = active
                .capabilities
                .get(pending.intent.stance)
                .expect("queued possession stance lost its capability")
                .jump_presentation;
            possession_event_result(
                event_result,
                body,
                pending.intent.kinematics.jump(),
                presentation,
                &mut launch,
            )?
        };
        if result == PossessionEventOutcomeKind::Reset {
            active.applied_intent = active.resolve_effective_intent(CharacterDrive::default())?;
        }
        outcomes.push(PossessionEventOutcome {
            possession_generation: active.generation,
            sequence,
            result,
        });
    }

    if active.latest_intent.revision > active.applied_intent.revision {
        active.applied_intent = active.latest_intent;
    }
    active.controller.replace_drive(active.applied_intent.drive);
    let order = effective_possession_order(&active, body.contact, launch.is_some())?;
    let mut playback = previous_playback
        .cloned()
        .unwrap_or_else(|| BodyMotionRuntime::new(table));
    let offset = playback.drive(table, order, delta_seconds).offset;
    let actuation = if grounded_response {
        possession_grounded_actuation(
            &active,
            offset,
            body,
            object_scale,
            profile,
            delta_seconds,
            launch,
        )?
    } else {
        crate::host_simulation_runtime::dynamic_entity_coasting_actuation(body, delta_seconds)?
    };
    Ok((
        PossessionTickProposal {
            active,
            playback,
            pre_solve_contact: body.contact,
            outcomes,
        },
        actuation,
    ))
}

fn possession_event_result(
    result: CharacterMotionEventResult,
    body: &SpatialBody,
    jump: holtburger_core::CharacterJumpKinematics,
    presentation: crate::explorer_possession_control::PossessionJumpPresentation,
    launch: &mut Option<GroundedLaunch>,
) -> anyhow::Result<PossessionEventOutcomeKind> {
    Ok(match result {
        CharacterMotionEventResult::ChargeAccepted => {
            PossessionEventOutcomeKind::ChargeAccepted { presentation }
        }
        CharacterMotionEventResult::ChargeContinues => {
            PossessionEventOutcomeKind::ChargeContinues { presentation }
        }
        CharacterMotionEventResult::Reset => PossessionEventOutcomeKind::Reset,
        CharacterMotionEventResult::IgnoredStale { .. } => {
            unreachable!("contiguous possession queue passed a stale edge to a fresh controller")
        }
        CharacterMotionEventResult::Rejected(reason) => PossessionEventOutcomeKind::Rejected {
            reason: match reason {
                CharacterMotionRejection::ChargeNotActive => {
                    PossessionEventRejection::ChargeNotActive
                }
                CharacterMotionRejection::Unsupported => {
                    PossessionEventRejection::UnsupportedContact
                }
            },
        },
        CharacterMotionEventResult::JumpReleased(attempt) => {
            let readiness = if launch.is_some() {
                CharacterJumpReadiness::Airborne
            } else {
                match body.contact {
                    ContactState::Grounded => CharacterJumpReadiness::Supported,
                    ContactState::Airborne => CharacterJumpReadiness::Airborne,
                    ContactState::Sliding | ContactState::Unknown => {
                        CharacterJumpReadiness::Unsupported
                    }
                }
            };
            match resolve_character_jump(jump, attempt, body.pose.rotation.to_heading(), readiness)
            {
                Ok(resolved) => {
                    *launch = Some(GroundedLaunch::new(resolved.world_velocity())?);
                    PossessionEventOutcomeKind::JumpReleased { presentation }
                }
                Err(CharacterJumpRejection::Airborne) => PossessionEventOutcomeKind::Rejected {
                    reason: PossessionEventRejection::Airborne,
                },
                Err(CharacterJumpRejection::Unsupported) => PossessionEventOutcomeKind::Rejected {
                    reason: PossessionEventRejection::UnsupportedContact,
                },
                Err(
                    error @ (CharacterJumpRejection::InvalidHeading
                    | CharacterJumpRejection::InvalidTurnRate
                    | CharacterJumpRejection::InvalidRunRate),
                ) => anyhow::bail!("host-owned possession jump invariant failed: {error}"),
            }
        }
    })
}

fn effective_possession_order(
    active: &ActivePossession,
    contact: ContactState,
    launching: bool,
) -> Result<MotionOrder, PossessionIntentError> {
    let effective = active.resolve_effective_intent(active.controller.effective_drive())?;
    let capability = active
        .capabilities
        .get(effective.stance)
        .expect("effective possession stance lost its capability");
    let mut order = effective.visible_order;
    // RETAIL DIVERGENCE: retail synchronously selects target `Ready`/`Falling` while charging and
    // crossing support (`acclient.c:330342-330453`). Possession still performs the physical jump
    // when either target row is absent, retaining only the target stance/default presentation;
    // requiring those clips would disable jump for content that cannot observe a borrowed player
    // animation. Census 2026-08-21: 4,999 of 7,788 projected creature templates lack at least one
    // effective standard non-combat jump-presentation state; the full stance matrix is in the plan.
    if launching || matches!(contact, ContactState::Airborne | ContactState::Sliding) {
        order.forward = capability
            .has_falling_presentation()
            .then_some((MotionCommand::FALLING, 1.0));
        order.sidestep = None;
    } else if active.controller.is_standing_long_jump() {
        order.forward = capability
            .has_ready_presentation()
            .then_some((MotionCommand::READY, 1.0));
        order.sidestep = None;
    }
    Ok(order)
}

fn possession_grounded_actuation(
    active: &ActivePossession,
    authored_offset: RigidTransform,
    body: &SpatialBody,
    object_scale: f32,
    profile: ExplorerPossessionControlProfile,
    delta_seconds: f32,
    launch: Option<GroundedLaunch>,
) -> anyhow::Result<PhysicalBodyActuation> {
    let effective = active.resolve_effective_intent(active.controller.effective_drive())?;
    let capability = active
        .capabilities
        .get(effective.stance)
        .expect("effective possession stance lost its capability");
    let gated = gate_authored_offset(authored_offset, body.contact, object_scale);
    let authored_velocity = if delta_seconds > 0.0 {
        gated.translation / delta_seconds
    } else {
        Vector3::zero()
    };
    let supported = body.contact == ContactState::Grounded;

    let local_forward = if !supported {
        0.0
    } else {
        match effective.axes.forward() {
            Some(axis)
                if capability.source_for_forward(axis)
                    == PossessionLocomotionSource::TargetAuthored =>
            {
                authored_velocity.y
            }
            Some(axis) => fallback_forward_velocity(axis, profile) * object_scale,
            None => 0.0,
        }
    };
    let local_sidestep = if !supported {
        0.0
    } else {
        match effective.axes.sidestep() {
            Some((_, _)) if capability.sidestep == PossessionLocomotionSource::TargetAuthored => {
                authored_velocity.x
            }
            Some((_, rate)) => profile.fallback.sidestep_speed() * rate * object_scale,
            None => 0.0,
        }
    };
    let local_planar = Vector3::new(local_sidestep, local_forward, 0.0);
    let world_planar = body.pose.rotation.rotate_vector(local_planar);
    let heading = match effective.axes.turn() {
        Some((_, _)) if capability.turn == PossessionLocomotionSource::TargetAuthored => {
            body.pose.rotation.multiply(&gated.rotation).to_heading()
        }
        Some((_, rate)) => {
            body.pose.rotation.to_heading() + profile.fallback.turn_rate() * rate * delta_seconds
        }
        None => body.pose.rotation.to_heading(),
    };
    Ok(grounded_character_actuation(
        world_planar,
        Some(heading),
        launch,
    )?)
}

fn fallback_forward_velocity(
    axis: AdjustedForwardAxis,
    profile: ExplorerPossessionControlProfile,
) -> f32 {
    match axis {
        AdjustedForwardAxis::Walk { speed_mod } => profile.fallback.walk_speed() * speed_mod,
        AdjustedForwardAxis::Run { speed_mod } => profile.fallback.run_speed() * speed_mod,
    }
}

impl Default for ExplorerEntityRegistry {
    fn default() -> Self {
        Self::with_guid_range(EXPLORER_GUID_START, EXPLORER_GUID_END)
    }
}

impl ExplorerEntityRegistry {
    fn with_guid_range(start: u32, end: u32) -> Self {
        Self {
            entities: BTreeMap::new(),
            allocator: ExplorerGuidAllocator::new(start, end),
            next_generation: Some(1),
            motion: ExplorerMotionState::default(),
        }
    }

    fn allocate_guid(&mut self) -> Result<Guid, ExplorerEntityRuntimeError> {
        self.allocator.allocate()
    }

    fn reserve_generation(&mut self) -> Result<u64, ExplorerEntityRuntimeError> {
        let generation = self
            .next_generation
            .ok_or(ExplorerEntityRuntimeError::GenerationExhausted)?;
        self.next_generation = generation.checked_add(1);
        Ok(generation)
    }

    fn require_absent(&self, guid: Guid) -> Result<(), ExplorerEntityRuntimeError> {
        if self.entities.contains_key(&guid) {
            return Err(ExplorerEntityRuntimeError::AlreadyRegistered { guid });
        }
        Ok(())
    }

    fn require_generation(
        &self,
        guid: Guid,
        expected: u64,
    ) -> Result<&ExplorerEntityInstance, ExplorerEntityRuntimeError> {
        let instance = self
            .entities
            .get(&guid)
            .ok_or(ExplorerEntityRuntimeError::NotRegistered { guid })?;
        if instance.generation != expected {
            return Err(ExplorerEntityRuntimeError::StaleGeneration {
                guid,
                expected,
                actual: instance.generation,
            });
        }
        Ok(instance)
    }

    fn publish(
        &mut self,
        definition: DynamicEntityDefinition,
        physical_intent: EntityPhysicalIntent,
        generation: u64,
    ) -> ExplorerEntityInstance {
        let instance = ExplorerEntityInstance {
            generation,
            physical_intent,
            definition,
        };
        let displaced = self
            .entities
            .insert(instance.definition.identity.guid, instance.clone());
        debug_assert!(
            displaced.is_none(),
            "prevalidated new entity displaced a live record"
        );
        instance
    }

    fn replace(
        &mut self,
        definition: DynamicEntityDefinition,
        physical_intent: EntityPhysicalIntent,
        generation: u64,
    ) -> (ExplorerEntityInstance, ExplorerEntityInstance) {
        let guid = definition.identity.guid;
        let installed = ExplorerEntityInstance {
            generation,
            physical_intent,
            definition,
        };
        let removed = self
            .entities
            .insert(guid, installed.clone())
            .expect("prevalidated replacement entity vanished while registry lock was held");
        (removed, installed)
    }

    fn remove(&mut self, guid: Guid) -> ExplorerEntityInstance {
        self.entities
            .remove(&guid)
            .expect("prevalidated entity vanished while registry lock was held")
    }

    fn reset(&mut self) -> Vec<ExplorerEntityInstance> {
        let removed = std::mem::take(&mut self.entities).into_values().collect();
        self.allocator.reset();
        self.motion = ExplorerMotionState::default();
        removed
    }
}

/// Ordered Explorer composition joining its semantic registry to its distinct host body scene.
pub struct ExplorerEntityRuntime {
    // Every operation acquires this registry lock before entering the simulation runtime. The
    // collection tick holds it across one simulation transaction, so instance generations cannot
    // retire between solve acceptance and projection and no callback inverts the lock order.
    registry: Mutex<ExplorerEntityRegistry>,
    simulation: Arc<HostSimulationRuntime>,
    /// Shared motion contract, projected once at startup and read by every possession.
    motion_catalog: Arc<MotionSequenceCatalog>,
    /// App-owned resolved numeric policy injected once and copied into fixed-tick decisions.
    possession_profile: ExplorerPossessionControlProfile,
}

impl ExplorerEntityRuntime {
    /// Composes an empty Explorer registry over the app's canonical host simulation runtime.
    pub fn new(
        simulation: Arc<HostSimulationRuntime>,
        motion_catalog: Arc<MotionSequenceCatalog>,
        possession_profile: ExplorerPossessionControlProfile,
    ) -> Self {
        Self {
            registry: Mutex::new(ExplorerEntityRegistry::default()),
            simulation,
            motion_catalog,
            possession_profile,
        }
    }

    #[cfg(test)]
    fn with_guid_range(simulation: Arc<HostSimulationRuntime>, start: u32, end: u32) -> Self {
        Self::with_guid_range_and_motion(simulation, start, end, Default::default())
    }

    #[cfg(test)]
    fn with_guid_range_and_motion(
        simulation: Arc<HostSimulationRuntime>,
        start: u32,
        end: u32,
        motion_catalog: Arc<MotionSequenceCatalog>,
    ) -> Self {
        Self {
            registry: Mutex::new(ExplorerEntityRegistry::with_guid_range(start, end)),
            simulation,
            motion_catalog,
            possession_profile: ExplorerPossessionControlProfile::standard()
                .expect("standard Explorer possession profile is valid"),
        }
    }

    /// Reserves one producer identity before content/definition preparation begins.
    ///
    /// Failed preparation may leave a harmless identity gap; it never publishes semantic state.
    pub fn reserve_guid(&self) -> Result<Guid, ExplorerEntityRuntimeError> {
        self.registry
            .lock()
            .expect("Explorer entity registry lock poisoned")
            .allocate_guid()
    }

    /// Installs a fully prepared body and publishes semantics only after installation succeeds.
    pub fn spawn_prepared(
        &self,
        definition: DynamicEntityDefinition,
        physical_intent: EntityPhysicalIntent,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntitySpawnOutcome, ExplorerEntityRuntimeError> {
        self.spawn_prepared_group(definition, physical_intent, physical, Vec::new())
    }

    /// Installs one world-placed wearer and publishes its bodyless attached children atomically.
    pub fn spawn_prepared_group(
        &self,
        definition: DynamicEntityDefinition,
        physical_intent: EntityPhysicalIntent,
        physical: Option<DynamicPhysicalBodyDefinition>,
        children: Vec<DynamicEntityDefinition>,
    ) -> Result<ExplorerEntitySpawnOutcome, ExplorerEntityRuntimeError> {
        validate_prepared_intent(physical_intent, physical.is_some())?;
        let guid = definition.identity.guid;
        validate_attached_children(guid, &children)?;
        let (definition, children) = self.resolve_group_motion_tables(definition, children);
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.require_absent(guid)?;
        for child in &children {
            registry.require_absent(child.identity.guid)?;
        }
        let generation = registry.reserve_generation()?;
        let child_generations = children
            .iter()
            .map(|_| registry.reserve_generation())
            .collect::<Result<Vec<_>, _>>()?;
        let initial = require_world_initial(&definition, "spawn")?;
        let body = self
            .simulation
            .install_dynamic_entity(&definition, initial, physical)?;
        let instance = registry.publish(definition, physical_intent, generation);
        let children = children
            .into_iter()
            .zip(child_generations)
            .map(|(child, generation)| {
                registry.publish(child, EntityPhysicalIntent::PoseOnly, generation)
            })
            .collect();
        Ok(ExplorerEntitySpawnOutcome {
            instance,
            body,
            children,
        })
    }

    /// Replaces one exact live generation and rejects late work before touching its body.
    pub fn replace_prepared(
        &self,
        definition: DynamicEntityDefinition,
        expected_generation: u64,
        physical_intent: EntityPhysicalIntent,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntityReplacementOutcome, ExplorerEntityRuntimeError> {
        self.replace_prepared_group(
            definition,
            expected_generation,
            physical_intent,
            physical,
            Vec::new(),
        )
    }

    /// Replaces one wearer and cleanly cuts over its complete attached-child set.
    pub fn replace_prepared_group(
        &self,
        definition: DynamicEntityDefinition,
        expected_generation: u64,
        physical_intent: EntityPhysicalIntent,
        physical: Option<DynamicPhysicalBodyDefinition>,
        children: Vec<DynamicEntityDefinition>,
    ) -> Result<ExplorerEntityReplacementOutcome, ExplorerEntityRuntimeError> {
        validate_prepared_intent(physical_intent, physical.is_some())?;
        let guid = definition.identity.guid;
        validate_attached_children(guid, &children)?;
        let (definition, children) = self.resolve_group_motion_tables(definition, children);
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.require_generation(guid, expected_generation)?;
        for child in &children {
            registry.require_absent(child.identity.guid)?;
        }
        let removed_child_guids = child_guids(&registry, guid);
        let generation = registry.reserve_generation()?;
        let child_generations = children
            .iter()
            .map(|_| registry.reserve_generation())
            .collect::<Result<Vec<_>, _>>()?;
        let initial = require_world_initial(&definition, "replacement")?;
        let body = self
            .simulation
            .replace_dynamic_entity(&definition, initial, physical)?;
        registry.motion.retire_target(guid, expected_generation);
        let (removed, installed) = registry.replace(definition, physical_intent, generation);
        let removed_children = removed_child_guids
            .into_iter()
            .map(|child| registry.remove(child))
            .collect();
        let installed_children = children
            .into_iter()
            .zip(child_generations)
            .map(|(child, generation)| {
                registry.publish(child, EntityPhysicalIntent::PoseOnly, generation)
            })
            .collect();
        Ok(ExplorerEntityReplacementOutcome {
            removed,
            installed,
            body,
            removed_children,
            installed_children,
        })
    }

    /// Removes one exact live generation from body and semantic authority exactly once.
    pub fn despawn(
        &self,
        guid: Guid,
        expected_generation: u64,
    ) -> Result<ExplorerEntityDespawnOutcome, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let current = registry.require_generation(guid, expected_generation)?;
        require_world_initial(&current.definition, "independent despawn")?;
        let children = child_guids(&registry, guid);
        let body = self
            .simulation
            .remove_dynamic_entity(SpatialBodyId::Entity(guid))?;
        registry.motion.retire_target(guid, expected_generation);
        let children = children
            .into_iter()
            .map(|child| registry.remove(child))
            .collect();
        let instance = registry.remove(guid);
        Ok(ExplorerEntityDespawnOutcome {
            instance,
            body,
            children,
        })
    }

    /// Applies a complete effective-state replacement without replacing semantic identity.
    pub fn replace_physics_state(
        &self,
        guid: Guid,
        expected_generation: u64,
        next: EffectiveEntityPhysicsState,
        next_intent: EntityPhysicalIntent,
        replacement: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntityPhysicsStateOutcome, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        let decision = transition_decision(
            &self.simulation,
            instance,
            next,
            next_intent,
            replacement.is_some(),
            "physics-state replacement",
        )?;
        validate_transition_replacement(decision.action, replacement.is_some())?;
        let outcome = self.simulation.apply_dynamic_entity_physics(
            SpatialBodyId::Entity(guid),
            decision,
            replacement,
        )?;
        let current = registry
            .entities
            .get_mut(&guid)
            .expect("prevalidated entity vanished while registry lock was held");
        current.definition.physics = next;
        current.physical_intent = next_intent;
        Ok(ExplorerEntityPhysicsStateOutcome {
            instance: current.clone(),
            decision,
            body: outcome,
        })
    }

    /// Applies one resolved launch while the exact semantic generation remains stable.
    pub fn launch(
        &self,
        guid: Guid,
        expected_generation: u64,
        launch: DynamicEntityLaunchPlan,
        now: std::time::Instant,
    ) -> Result<ExplorerEntityLaunchOutcome, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        require_world_initial(&instance.definition, "launch")?;
        let body = self.simulation.apply_dynamic_entity_kinematics(
            SpatialBodyId::Entity(guid),
            launch.kinematics,
            now,
        )?;
        let current = registry
            .entities
            .get_mut(&guid)
            .expect("prevalidated entity vanished while registry lock was held");
        current.definition.physics = launch.physics;
        Ok(ExplorerEntityLaunchOutcome {
            instance: current.clone(),
            body,
        })
    }

    /// Relocates one exact semantic generation without replacing its identity.
    pub fn relocate(
        &self,
        guid: Guid,
        expected_generation: u64,
        pose: holtburger_common::position::WorldPosition,
        now: std::time::Instant,
    ) -> Result<ExplorerEntityRelocationOutcome, ExplorerEntityRuntimeError> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        require_world_initial(&instance.definition, "relocation")?;
        let relocation =
            self.simulation
                .relocate_dynamic_entity(SpatialBodyId::Entity(guid), pose, now)?;
        Ok(ExplorerEntityRelocationOutcome {
            instance: instance.clone(),
            body: relocation.body,
            collision_reports: relocation.collision_reports,
        })
    }

    /// Preflights the exact shared state-transition action before content preparation.
    pub fn plan_physics_state(
        &self,
        guid: Guid,
        expected_generation: u64,
        next: EffectiveEntityPhysicsState,
        next_intent: EntityPhysicalIntent,
    ) -> Result<EntityPhysicsTransitionDecision, ExplorerEntityRuntimeError> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        transition_decision(
            &self.simulation,
            instance,
            next,
            next_intent,
            true,
            "physics-state planning",
        )
    }

    /// Returns one exact semantic generation without joining or copying solver state.
    pub fn instance(
        &self,
        guid: Guid,
        expected_generation: u64,
    ) -> Result<ExplorerEntityInstance, ExplorerEntityRuntimeError> {
        self.registry
            .lock()
            .expect("Explorer entity registry lock poisoned")
            .require_generation(guid, expected_generation)
            .cloned()
    }

    /// Removes every live generation and resets GUID allocation without reusing generations.
    pub fn reset(&self) -> Result<Vec<ExplorerEntityInstance>, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let body_ids = registry
            .entities
            .values()
            .filter(|instance| instance.definition.placement.world().is_some())
            .map(|instance| SpatialBodyId::Entity(instance.definition.identity.guid))
            .collect::<Vec<_>>();
        self.simulation.remove_dynamic_entities(&body_ids)?;
        Ok(registry.reset())
    }

    /// Builds one current semantic/body join while the instance generation remains stable.
    pub fn project(
        &self,
        guid: Guid,
    ) -> Result<ExplorerEntityProjection, ExplorerEntityRuntimeError> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry
            .entities
            .get(&guid)
            .ok_or(ExplorerEntityRuntimeError::NotRegistered { guid })?;
        let input = self
            .simulation
            .project_dynamic_entity(&instance.definition)?;
        Ok(ExplorerEntityProjection {
            generation: instance.generation,
            input,
            playing_clip: registry.motion.playback.playing_clip(guid),
        })
    }

    /// Builds a deterministic current snapshot without retaining solver state in the registry.
    pub fn snapshot(&self) -> Result<Vec<ExplorerEntityProjection>, ExplorerEntityRuntimeError> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry
            .entities
            .values()
            .map(|instance| {
                Ok(ExplorerEntityProjection {
                    generation: instance.generation,
                    input: self
                        .simulation
                        .project_dynamic_entity(&instance.definition)?,
                    playing_clip: registry
                        .motion
                        .playback
                        .playing_clip(instance.definition.identity.guid),
                })
            })
            .collect()
    }

    /// Advances every eligible physical instance in one generation-stable collection transaction.
    ///
    /// Every accepted body tick leaves this host boundary. `publish` records the existing frontend
    /// filter without deleting stable possessed-body evidence needed by same-epoch followers.
    /// Possesses one spawned entity, so commands and the follow camera target it.
    ///
    /// Possession is exclusive: taking a new entity releases the previous one and discards its
    /// playback, because a cursor means nothing once nothing is driving it.
    pub fn possess(&self, guid: Guid) -> Result<ExplorerPossession, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry
            .entities
            .get(&guid)
            .cloned()
            .ok_or(ExplorerEntityRuntimeError::NotRegistered { guid })?;
        let motion_table_id = instance
            .definition
            .content
            .motion_table_did
            .ok_or(ExplorerEntityRuntimeError::MissingPossessionMotionTable { guid })?;
        let table = self.motion_catalog.table(motion_table_id).ok_or(
            ExplorerEntityRuntimeError::UnprojectedPossessionMotionTable {
                guid,
                motion_table_id,
            },
        )?;
        if let Some(target) = self
            .simulation
            .physical_body_scene_snapshot(SpatialBodyId::Entity(guid))
        {
            match target.scene_residency {
                holtburger_world::PhysicalBodySceneResidency::Resident => {}
                holtburger_world::PhysicalBodySceneResidency::MissingOwner { owner } => {
                    return Err(
                        ExplorerEntityRuntimeError::PossessionTargetMissingCollisionOwner {
                            guid,
                            owner,
                        },
                    );
                }
                holtburger_world::PhysicalBodySceneResidency::OutsideLandscape => {
                    return Err(
                        ExplorerEntityRuntimeError::PossessionTargetOutsideLandscape { guid },
                    );
                }
            }
        }
        let possession_generation = registry.reserve_generation()?;
        let active = ActivePossession::new(
            guid,
            instance.generation,
            possession_generation,
            motion_table_id,
            table,
            self.possession_profile,
        )?;
        let accepted_stance = active.latest_intent.stance;
        let stances = active.capabilities.values().collect();

        registry.motion.release();
        registry.motion.active = Some(active);
        self.simulation
            .wake_dynamic_body(SpatialBodyId::Entity(guid));

        Ok(ExplorerPossession {
            guid,
            entity_generation: instance.generation,
            possession_generation,
            motion_table_id,
            accepted_stance,
            run_rate_capability: PossessionRunRateCapability::STANDARD,
            stances,
        })
    }

    /// Releases whatever is possessed, leaving the entity in the world under its own physics.
    ///
    /// The released entity's planar velocity is cleared. Authored drive is per-tick and is not
    /// momentum, so once authorship ends there is nothing for the horizontal motion to have come
    /// from; leaving it would let a walk cycle coast on after the command that produced it. Vertical
    /// velocity survives, because falling is real physical momentum the authored path never wrote.
    pub fn release_possession(
        &self,
        now: std::time::Instant,
    ) -> Result<ExplorerPossessionRelease, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let possession_generation = registry.reserve_generation()?;
        let released_guid = registry.motion.release();

        if let Some(guid) = released_guid {
            self.clear_authored_momentum(SpatialBodyId::Entity(guid), now);
        }
        Ok(ExplorerPossessionRelease {
            released_guid,
            possession_generation,
        })
    }

    fn clear_authored_momentum(&self, body_id: SpatialBodyId, now: std::time::Instant) {
        let Some(body) = self.simulation.physical_body_view(body_id) else {
            return;
        };
        // Align-path facing is a response policy, not a kinematic fact; the entity keeps whatever it
        // had, so this replacement carries the same answer the body already holds.
        let align_path = self
            .simulation
            .physical_body_align_path(body_id)
            .unwrap_or(false);
        let Some(kinematics) = holtburger_world::DynamicBodyKinematics::new(
            holtburger_common::Vector3::new(0.0, 0.0, body.velocity.z),
            body.acceleration,
            body.omega,
            align_path,
        ) else {
            return;
        };
        let _ = self
            .simulation
            .apply_dynamic_entity_kinematics(body_id, kinematics, now);
    }

    /// Replaces coalescible semantic intent after validating the exact possession generation.
    pub fn replace_possession_intent(
        &self,
        request: ExplorerPossessionIntentRequest,
    ) -> Result<PossessionIntentReplaceResult, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let Some(active) = registry.motion.active.as_mut() else {
            return Ok(PossessionIntentReplaceResult::IgnoredStalePossession);
        };
        if active.generation != request.possession_generation {
            return Ok(PossessionIntentReplaceResult::IgnoredStalePossession);
        }
        let result = active.replace_intent(
            PossessionIntentSnapshot {
                revision: request.revision,
                stance: request.stance,
                drive: request.drive,
                run_rate_scalar: request.run_rate_scalar,
            },
            self.possession_profile,
        )?;
        if result == PossessionIntentReplaceResult::Accepted {
            self.simulation
                .wake_dynamic_body(SpatialBodyId::Entity(active.guid));
        }
        Ok(result)
    }

    /// Queues one non-coalescible lifecycle edge without allowing async reordering.
    pub fn queue_possession_event(
        &self,
        request: ExplorerPossessionEventRequest,
    ) -> Result<PossessionEventQueueReceipt, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let Some(active) = registry.motion.active.as_mut() else {
            return Ok(PossessionEventQueueReceipt {
                result: PossessionEventQueueResult::IgnoredStalePossession,
                outcomes: Vec::new(),
            });
        };
        if active.generation != request.possession_generation {
            return Ok(PossessionEventQueueReceipt {
                result: PossessionEventQueueResult::IgnoredStalePossession,
                outcomes: Vec::new(),
            });
        }
        let result = active.queue_event(
            request.sequence,
            PossessionIntentSnapshot {
                revision: request.revision,
                stance: request.stance,
                drive: request.drive,
                run_rate_scalar: request.run_rate_scalar,
            },
            request.event,
            self.possession_profile,
        )?;
        let grounded_response = self
            .simulation
            .physical_body_definition(SpatialBodyId::Entity(active.guid))
            .is_some_and(|definition| {
                matches!(definition, PhysicalBodyDefinition::Grounded { .. })
            });
        let outcomes = if result == PossessionEventQueueResult::Queued && !grounded_response {
            consume_nonphysical_possession_events(active)?
        } else {
            Vec::new()
        };
        if result == PossessionEventQueueResult::Queued && grounded_response {
            self.simulation
                .wake_dynamic_body(SpatialBodyId::Entity(active.guid));
        }
        Ok(PossessionEventQueueReceipt { result, outcomes })
    }

    /// Snapshots the exact active possession playback without exposing mutable registry ownership.
    pub fn possession_motion_probe(&self) -> Option<ExplorerPossessionMotionProbe> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let active = registry.motion.active.as_ref()?;
        let state = registry.motion.playback.state(active.guid)?;
        let clip = registry
            .motion
            .playback
            .playing_clip(active.guid)
            .map(holtburger_core::DynamicEntityPlayingClip::from);
        Some(ExplorerPossessionMotionProbe {
            guid: active.guid,
            entity_generation: active.entity_generation,
            possession_generation: active.generation,
            requested_run_rate: active.applied_intent.kinematics.run_rate().value(),
            physical_status: registry.motion.last_physical_status,
            effective_planar_speed: registry.motion.last_effective_planar_speed,
            style: state.style.0,
            substate: ExplorerPossessionActiveMotionProbe {
                command: state.substate.0,
                speed: state.substate_mod,
            },
            modifiers: state
                .modifiers()
                .iter()
                .map(|motion| ExplorerPossessionActiveMotionProbe {
                    command: motion.command.0,
                    speed: motion.speed_mod,
                })
                .collect(),
            clip,
        })
    }

    /// Whether all identity dimensions still name the one active possession.
    pub fn has_possession(&self, expected: ExplorerPossessedBodyEpoch) -> bool {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.motion.active.as_ref().is_some_and(|active| {
            active.guid == expected.guid
                && active.entity_generation == expected.entity_generation
                && active.generation == expected.possession_generation
                && registry
                    .entities
                    .get(&active.guid)
                    .is_some_and(|entity| entity.generation == active.entity_generation)
        })
    }

    /// Authored body height of one live entity, at its own scale.
    ///
    /// Read by the possession camera when it seeds a boom generation: the pivot needs a statement of
    /// the body's size, and this is the only one that survives content resolution.
    pub fn body_height(&self, guid: Guid) -> Option<f32> {
        self.registry
            .lock()
            .expect("Explorer entity registry lock poisoned")
            .entities
            .get(&guid)
            .map(|entity| entity.definition.body_height)
    }

    /// Resolves each definition's setup-default motion table before the group becomes contract.
    ///
    /// The entity's own property is the override; absent, the setup's default is the table it
    /// really animates from. Resolving once here is what lets every consumer — including a frontend
    /// that stages a closure for this exact id and has no setup catalog to consult — read the table
    /// an entity animates from rather than repeat the lookup.
    fn resolve_group_motion_tables(
        &self,
        definition: DynamicEntityDefinition,
        children: Vec<DynamicEntityDefinition>,
    ) -> (DynamicEntityDefinition, Vec<DynamicEntityDefinition>) {
        let mut resolve = |mut definition: DynamicEntityDefinition| {
            definition.content.motion_table_did =
                definition.content.motion_table_did.or_else(|| {
                    self.motion_catalog
                        .default_motion_table_for_setup(definition.content.setup_did)
                });
            definition
        };
        let children = children.into_iter().map(&mut resolve).collect();
        (resolve(definition), children)
    }

    /// Advances unpossessed authored playback independently from controller/body acceptance.
    ///
    /// Every entity plays, not only the possessed one: an unpossessed entity idles from its motion
    /// table's default style and substate, which is what retail installs for any non-static object
    /// (`CPhysicsObj::InitDefaults`, `acclient.c:309099-309103`). Possessed playback is deliberately
    /// excluded because its proposal commits only with the exact body's accepted solve.
    ///
    /// An entity whose table is absent from the contract, or which declares none, simply has no
    /// playback. That is not a failure — it is an object that does not animate.
    fn advance_unpossessed_motion(
        &self,
        registry: &mut ExplorerEntityRegistry,
        delta_seconds: f32,
    ) {
        let target_is_retired = registry.motion.active.as_ref().is_some_and(|active| {
            registry
                .entities
                .get(&active.guid)
                .is_none_or(|instance| instance.generation != active.entity_generation)
        });
        if target_is_retired {
            // The possessed entity retired underneath us; drop the possession with it.
            registry.motion.release();
        }
        let possessed = registry.motion.active.as_ref().map(|active| active.guid);
        let driving: Vec<(Guid, u32)> = registry
            .entities
            .iter()
            .filter_map(|(guid, instance)| {
                if possessed == Some(*guid) {
                    return None;
                }
                Some((*guid, instance.definition.content.motion_table_did?))
            })
            .collect();

        let live: BTreeSet<Guid> = registry
            .entities
            .iter()
            .filter(|(_, instance)| instance.definition.content.motion_table_did.is_some())
            .map(|(guid, _)| *guid)
            .collect();
        registry
            .motion
            .playback
            .retain_bodies(|guid| live.contains(&guid));

        for (guid, motion_table_id) in driving {
            let Some(table) = self.motion_catalog.table(motion_table_id) else {
                continue;
            };
            registry
                .motion
                .playback
                .drive(table, guid, MotionOrder::default(), delta_seconds);

            // A body that proved stable support has dropped out of the collection scan. Whether it
            // should be back in is a property of what its playback installed, not of how large this
            // tick's offset came out — the same distinction Phase 3 settled for the client basis.
            //
            // An unpublished clip is the other reason to be in it. An idle contributes no motion,
            // so a settled entity would never be scanned again and its level would never reach a
            // consumer — the tick is the only carrier a scheduled body has.
            let moving = registry
                .motion
                .playback
                .get(guid)
                .is_some_and(|runtime| runtime.sequence().contributes_motion());
            if moving || registry.motion.clip_awaits_publication(guid) {
                self.simulation
                    .wake_dynamic_body(SpatialBodyId::Entity(guid));
            }
        }
    }

    pub fn tick_physical_collection(
        &self,
        delta_seconds: f32,
        now: std::time::Instant,
    ) -> anyhow::Result<ExplorerEntityCollectionTick> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        self.advance_unpossessed_motion(&mut registry, delta_seconds);
        let possession = registry.motion.active.clone().and_then(|active| {
            let instance = registry.entities.get(&active.guid)?;
            (instance.generation == active.entity_generation).then_some((
                active,
                instance.definition.object_scale,
                registry
                    .motion
                    .playback
                    .get(instance.definition.identity.guid)
                    .cloned(),
            ))
        });
        if let Some((active, _, _)) = &possession {
            // A possessed target is also a host-follow anchor. It must author a held path every
            // epoch even after ordinary dynamic settling would remove it from the active scan.
            self.simulation
                .wake_dynamic_body(SpatialBodyId::Entity(active.guid));
        }
        let mut proposal = None;
        let collection =
            self.simulation
                .tick_dynamic_entity_collection(delta_seconds, now, |body| {
                    match possession.as_ref() {
                        Some((active, object_scale, previous_playback))
                            if body.id == SpatialBodyId::Entity(active.guid) =>
                        {
                            let table = self
                                .motion_catalog
                                .table(active.motion_table_id)
                                .context("active possession motion table vanished")?;
                            let (next, actuation) = propose_possession_tick(
                                active.clone(),
                                previous_playback.as_ref(),
                                table,
                                body,
                                *object_scale,
                                self.possession_profile,
                                delta_seconds,
                            )?;
                            assert!(
                                proposal.replace(next).is_none(),
                                "possessed body scheduled twice"
                            );
                            Ok(actuation)
                        }
                        _ => crate::host_simulation_runtime::dynamic_entity_coasting_actuation(
                            body,
                            delta_seconds,
                        ),
                    }
                })?;

        let mut possession_outcomes = BTreeMap::new();
        if let (Some((expected, _, _)), Some(mut accepted)) = (possession.as_ref(), proposal)
            && let Some((solved, physical_status)) = collection.bodies.iter().find_map(|tick| {
                if tick.current.id != SpatialBodyId::Entity(expected.guid) {
                    return None;
                }
                committed_possession_physical_status(tick.result.motion.status)
                    .map(|status| (tick, status))
            })
            && registry.motion.active.as_ref().is_some_and(|active| {
                active.generation == expected.generation
                    && active.entity_generation == expected.entity_generation
            })
        {
            registry.motion.last_physical_status = Some(physical_status);
            registry.motion.last_effective_planar_speed =
                Some(solved.current.velocity.x.hypot(solved.current.velocity.y));
            let table = self
                .motion_catalog
                .table(expected.motion_table_id)
                .expect("active possession motion table vanished while registry lock was held");
            accepted.reconcile_playback(table, solved.current.contact)?;
            possession_outcomes.insert(expected.guid, accepted.outcomes);
            registry
                .motion
                .playback
                .replace_body(expected.guid, accepted.playback);
            registry.motion.active = Some(accepted.active);
        }

        let live: BTreeSet<Guid> = registry.entities.keys().copied().collect();
        registry.motion.retain_published(&live);
        let outcome_guids: BTreeSet<Guid> = possession_outcomes.keys().copied().collect();
        let ticks = collection
            .bodies
            .into_iter()
            .map(|solved| {
                let SpatialBodyId::Entity(guid) = solved.current.id else {
                    anyhow::bail!("dynamic-entity collection returned a non-entity body")
                };
                let instance = registry.entities.get_mut(&guid).with_context(|| {
                    format!(
                        "dynamic-entity body 0x{:08X} has no Explorer semantic instance",
                        guid.0
                    )
                })?;
                if let Some(change) = solved.result.dynamic_state_change {
                    instance.definition.physics = resolve_effective_entity_physics_state(
                        instance.definition.physics.semantic & !change.cleared,
                    );
                }
                let generation = instance.generation;
                let input = dynamic_entity_projection_input_from_body(
                    &instance.definition,
                    &solved.current,
                )?;
                // A clip change is worth publishing even when the body did not move. Possessed
                // playback is sampled only after its accepted proposal commits, so a held solve
                // cannot leak a clip.
                let (playing_clip, clip_changed) = registry.motion.commit_published_clip(guid);
                let publish =
                    physical_tick_changed(&solved) || clip_changed || outcome_guids.contains(&guid);
                Ok(ExplorerEntityPhysicalTick {
                    publish,
                    playing_clip,
                    possession_event_outcomes: possession_outcomes
                        .remove(&guid)
                        .unwrap_or_default(),
                    generation,
                    input,
                    solved,
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        let possession = possession.and_then(|(active, _, _)| {
            (ticks
                .iter()
                .any(|tick| tick.solved.current.id == SpatialBodyId::Entity(active.guid))
                || collection
                    .coverage_rejections
                    .iter()
                    .any(|rejection| rejection.body.id == SpatialBodyId::Entity(active.guid)))
            .then_some(ExplorerPossessedBodyEpoch {
                guid: active.guid,
                entity_generation: active.entity_generation,
                possession_generation: active.generation,
            })
        });
        Ok(ExplorerEntityCollectionTick {
            ticks,
            coverage_rejections: collection.coverage_rejections,
            possession,
        })
    }

    /// Tests whether an asynchronous outcome still targets the current live generation.
    pub fn is_current(&self, guid: Guid, generation: u64) -> bool {
        self.registry
            .lock()
            .expect("Explorer entity registry lock poisoned")
            .entities
            .get(&guid)
            .is_some_and(|instance| instance.generation == generation)
    }
}

fn physical_tick_changed(tick: &HostPhysicalBodyTick) -> bool {
    tick.result.dynamic_state_change.is_some()
        || tick.previous.runtime_view() != tick.current.runtime_view()
        || tick
            .result
            .motion
            .path
            .legs()
            .iter()
            .any(|leg| leg.end() != tick.result.motion.path.initial())
}

fn child_guids(registry: &ExplorerEntityRegistry, parent: Guid) -> Vec<Guid> {
    registry
        .entities
        .values()
        .filter_map(|instance| {
            instance
                .definition
                .placement
                .attachment()
                .filter(|attachment| attachment.parent == parent)
                .map(|_| instance.definition.identity.guid)
        })
        .collect()
}

fn validate_attached_children(
    parent: Guid,
    children: &[DynamicEntityDefinition],
) -> Result<(), ExplorerEntityRuntimeError> {
    let mut identities = BTreeSet::new();
    for child in children {
        if !identities.insert(child.identity.guid) {
            return Err(ExplorerEntityRuntimeError::AlreadyRegistered {
                guid: child.identity.guid,
            });
        }
        match child.placement.attachment().copied() {
            Some(attachment) if attachment.parent == parent => {}
            Some(attachment) => {
                return Err(ExplorerEntityRuntimeError::ChildWearerMismatch {
                    guid: child.identity.guid,
                    expected_parent: parent,
                    declared_parent: attachment.parent,
                });
            }
            None => {
                return Err(ExplorerEntityRuntimeError::ChildNotAttached {
                    guid: child.identity.guid,
                    parent,
                });
            }
        }
    }
    Ok(())
}

fn require_world_initial(
    definition: &DynamicEntityDefinition,
    operation: &'static str,
) -> Result<DynamicEntityInitialState, ExplorerEntityRuntimeError> {
    match definition.placement {
        EntityPlacement::World(initial) => Ok(initial),
        EntityPlacement::Attached(attachment) => {
            Err(ExplorerEntityRuntimeError::AttachedOperation {
                guid: definition.identity.guid,
                parent: attachment.parent,
                operation,
            })
        }
    }
}

fn validate_prepared_intent(
    intent: EntityPhysicalIntent,
    has_physical: bool,
) -> Result<(), ExplorerEntityRuntimeError> {
    match (intent, has_physical) {
        (EntityPhysicalIntent::Simulated, false) => {
            Err(ExplorerEntityRuntimeError::MissingPreparedPhysics)
        }
        (EntityPhysicalIntent::PoseOnly, true) => {
            Err(ExplorerEntityRuntimeError::UnexpectedPreparedPhysics)
        }
        _ => Ok(()),
    }
}

fn transition_decision(
    simulation: &HostSimulationRuntime,
    instance: &ExplorerEntityInstance,
    next: EffectiveEntityPhysicsState,
    next_intent: EntityPhysicalIntent,
    prepared_physics_available: bool,
    operation: &'static str,
) -> Result<EntityPhysicsTransitionDecision, ExplorerEntityRuntimeError> {
    let projection = simulation.project_dynamic_entity(&instance.definition)?;
    let world = match projection.placement {
        EntityPlacement::World(world) => world,
        EntityPlacement::Attached(attachment) => {
            return Err(ExplorerEntityRuntimeError::AttachedOperation {
                guid: instance.definition.identity.guid,
                parent: attachment.parent,
                operation,
            });
        }
    };
    let solver_participation_enabled = matches!(
        world.participation,
        holtburger_world::PhysicalBodyParticipation::Physical
    );
    Ok(decide_entity_physics_state_transition(
        Some(instance.definition.physics),
        next,
        EntityPhysicsTransitionContext {
            intent: next_intent,
            prepared_physics_available: prepared_physics_available || solver_participation_enabled,
            solver_participation_enabled,
            prepared_definition_changed: false,
        },
    ))
}

fn validate_transition_replacement(
    action: holtburger_world::EntityPhysicalTransitionAction,
    has_replacement: bool,
) -> Result<(), ExplorerEntityRuntimeError> {
    use holtburger_world::EntityPhysicalTransitionAction::{
        EnableSolverParticipation, Reconfigure,
    };
    match (
        matches!(action, EnableSolverParticipation | Reconfigure),
        has_replacement,
    ) {
        (true, false) => Err(ExplorerEntityRuntimeError::MissingPreparedPhysics),
        (false, true) => Err(ExplorerEntityRuntimeError::UnexpectedPreparedPhysics),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    /// Every scheduled body coasts, for tests that do not care about drive.
    fn coasting(
        delta_seconds: f32,
    ) -> impl Fn(&SpatialBody) -> anyhow::Result<holtburger_world::PhysicalBodyActuation> {
        move |body| {
            crate::host_simulation_runtime::dynamic_entity_coasting_actuation(body, delta_seconds)
        }
    }

    use super::*;
    use anyhow::Result;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PhysicsState, WeenieType};
    use holtburger_common::{ParentLocation, Placement, Quaternion, Sphere, Vector3};
    use holtburger_content::{
        ColliderScale, CollisionBall, CollisionShape, LandblockCollisionAsset,
    };
    use holtburger_core::{
        DynamicEntityContent, DynamicEntityDefinitionInput, DynamicEntityIdentity,
        DynamicEntityInitialState,
    };
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
    use holtburger_dat::file_type::setup_model::AnimationFrame;
    use holtburger_dat::file_type::{Animation, MotionTable};
    use holtburger_dat::graphics::Frame;
    use holtburger_world::{
        DynamicBodyCollisionDefinition, EdgeProtection, EntityAppearance,
        EntityCollisionParticipation, EntityCollisionReportPolicy, EntityDynamicCollisionPolicy,
        EntityPhysicsScheduling, FreeSphereConfig, PhysicalBodyDefinition,
        PhysicalBodyParticipation, PhysicalBodyResponsePolicy, PhysicalElasticity,
        PhysicalFriction, PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion,
        PhysicsAttachment, PreparedEntityTargetGeometry, resolve_effective_entity_physics_state,
    };
    use std::time::Instant;

    #[derive(Default)]
    struct EmptySpaceCollisionSource;

    impl crate::host_simulation_runtime::CollisionSource for EmptySpaceCollisionSource {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: holtburger_content::TerrainCollisionSurface::empty(),
                static_geometry: holtburger_content::LandblockColliders::default(),
            }))
        }
    }

    fn fixture_landblock_ids() -> Vec<String> {
        (0xd9..=0xdb)
            .flat_map(|x| (0x54..=0x56).map(move |y| format!("0x{x:02x}{y:02x}ffff")))
            .collect()
    }

    fn install_fixture_interest(simulation: &HostSimulationRuntime) -> u64 {
        let session = simulation.reserve_interest_session();
        let receipt = simulation
            .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
                session,
                revision: 1,
                landblock_ids: fixture_landblock_ids(),
            })
            .unwrap();
        assert!(receipt.committed);
        assert!(receipt.unavailable_landblock_ids.is_empty());
        session
    }

    fn runtime(start: u32, end: u32) -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime) {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(
            EmptySpaceCollisionSource,
        )));
        install_fixture_interest(&simulation);
        let runtime = ExplorerEntityRuntime::with_guid_range(Arc::clone(&simulation), start, end);
        (simulation, runtime)
    }

    /// Setup every fixture entity presents, and the one the fixture catalog defaults for.
    const FIXTURE_SETUP_DID: u32 = 0x0200_0001;

    fn definition(guid: Guid, wcid: u32, x: f32) -> DynamicEntityDefinition {
        DynamicEntityDefinition::prepare(DynamicEntityDefinitionInput {
            identity: DynamicEntityIdentity {
                guid,
                wcid,
                name: format!("WCID {wcid}"),
                weenie_type: WeenieType::Creature,
            },
            content: DynamicEntityContent {
                motion_table_did: None,
                setup_did: FIXTURE_SETUP_DID,
                sound_table_did: None,
                physics_effect_table_did: None,
            },
            appearance: EntityAppearance::default(),
            placement: EntityPlacement::World(DynamicEntityInitialState {
                pose: WorldPosition {
                    landblock_id: Guid(0xda55_0001),
                    coords: Vector3::new(x, 0.0, 0.0),
                    rotation: Quaternion::identity(),
                },
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
                created_at: Instant::now(),
            }),
            object_scale: 1.0,
            friction: None,
            elasticity: None,
            maximum_velocity: None,
            rotation_speed: None,
            radar: holtburger_core::DynamicEntityRadarFacts::default(),
            body_height: 2.05,
            physics: resolve_effective_entity_physics_state(PhysicsState::GRAVITY),
        })
        .unwrap()
    }

    /// Child definition whose transform is wholly owned by `parent`; it intentionally has no
    /// world-motion state or host body to accidentally keep alive.
    fn attached_definition(guid: Guid, wcid: u32, parent: Guid) -> DynamicEntityDefinition {
        let mut child = definition(guid, wcid, 0.0);
        child.placement = EntityPlacement::Attached(PhysicsAttachment {
            parent,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        });
        child
    }

    fn physical_with_upper(upper_constraint: Option<Sphere>) -> DynamicPhysicalBodyDefinition {
        let response_policy = PhysicalBodyResponsePolicy {
            restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
            friction: PhysicalFriction::DEFAULT,
            surface_motion: PhysicalSurfaceMotion::Stable,
            align_path: false,
        };
        let movement = holtburger_core::retail_grounded_body_with_policy(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::new(0.0, 0.0, 0.5),
                    radius: 0.5,
                },
                upper_constraint,
            )
            .unwrap(),
            EdgeProtection::Creature,
            -9.8,
            response_policy,
        )
        .unwrap()
        .definition;
        DynamicPhysicalBodyDefinition {
            movement,
            response_policy,
            entity_collision: DynamicBodyCollisionDefinition {
                target_geometry: PreparedEntityTargetGeometry {
                    physics_bsp_parts: Vec::new(),
                    fallback_setup_did: 0x0200_0001,
                    fallback_shapes: Vec::new(),
                    fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                },
                scheduling: EntityPhysicsScheduling::Eligible,
                dynamic_collision: EntityDynamicCollisionPolicy {
                    target: EntityCollisionParticipation::Solid,
                    mover_accepts_response: true,
                    accepts_peer_reports: true,
                    missile: false,
                    path_clipped: false,
                },
                reporting: EntityCollisionReportPolicy {
                    enabled: false,
                    as_environment: false,
                },
                uses_physics_bsp: false,
                elasticity: PhysicalElasticity::DEFAULT,
                default_animation_available: false,
                default_script_available: false,
            },
        }
    }

    fn physical() -> DynamicPhysicalBodyDefinition {
        physical_with_upper(None)
    }

    /// Uses the production grounded response while making its safe-prefix behavior observable in
    /// one deterministic tick. The lowered budget is test-only; production remains at 32.
    fn physical_with_maximum_substeps(maximum_substeps: usize) -> DynamicPhysicalBodyDefinition {
        let mut physical = physical();
        match &mut physical.movement {
            PhysicalBodyDefinition::Grounded { config, .. } => {
                config.maximum_substeps = maximum_substeps;
            }
            PhysicalBodyDefinition::FreeSphere { .. } => {
                panic!("the Explorer fixture must use grounded movement")
            }
        }
        physical
    }

    fn physical_with_ball_target() -> DynamicPhysicalBodyDefinition {
        let mut physical = physical();
        physical.entity_collision.target_geometry.fallback_shapes =
            vec![Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            }))];
        physical
    }

    fn report_only_physical() -> DynamicPhysicalBodyDefinition {
        let mut physical = physical_with_ball_target();
        physical.movement = PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::zero(),
                    radius: 0.5,
                },
                None,
            )
            .unwrap(),
            FreeSphereConfig {
                maximum_substep_distance: 0.25,
                maximum_substeps: 32,
                maximum_contact_passes: 8,
                separation_epsilon: 0.000_5,
            },
        )
        .unwrap();
        physical.entity_collision.reporting.enabled = true;
        physical
            .entity_collision
            .dynamic_collision
            .mover_accepts_response = false;
        physical
    }

    #[test]
    fn guid_allocator_is_bounded_and_resettable() {
        let (_simulation, runtime) = runtime(0xf000_0001, 0xf000_0002);
        assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0001));
        assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0002));
        assert_eq!(
            runtime.reserve_guid(),
            Err(ExplorerEntityRuntimeError::GuidExhausted)
        );
        runtime.reset().unwrap();
        assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0001));
    }

    #[test]
    fn repeated_same_wcid_spawns_have_independent_identity_and_optional_physics() {
        let (_simulation, runtime) = runtime(0xf000_0010, 0xf000_0011);
        let first_guid = runtime.reserve_guid().unwrap();
        let second_guid = runtime.reserve_guid().unwrap();
        let first = runtime
            .spawn_prepared(
                definition(first_guid, 42, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();
        let second = runtime
            .spawn_prepared(
                definition(second_guid, 42, 2.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();

        assert_ne!(
            first.instance.definition.identity.guid,
            second.instance.definition.identity.guid
        );
        assert_eq!(
            first.instance.definition.identity.wcid,
            second.instance.definition.identity.wcid
        );
        assert_eq!(
            first.body.participation,
            PhysicalBodyParticipation::PoseOnly
        );
        assert_eq!(
            second.body.participation,
            PhysicalBodyParticipation::Physical
        );
        assert_eq!(runtime.snapshot().unwrap().len(), 2);
    }

    #[test]
    fn collection_tick_visits_only_eligible_physical_instances_in_guid_order() {
        let (_simulation, runtime) = runtime(0xf000_0100, 0xf000_0103);
        let pose_only_guid = runtime.reserve_guid().unwrap();
        let frozen_guid = runtime.reserve_guid().unwrap();
        let first_active_guid = runtime.reserve_guid().unwrap();
        let second_active_guid = runtime.reserve_guid().unwrap();
        runtime
            .spawn_prepared(
                definition(pose_only_guid, 1, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();

        let mut frozen_definition = definition(frozen_guid, 2, 1.0);
        frozen_definition.physics =
            resolve_effective_entity_physics_state(PhysicsState::GRAVITY | PhysicsState::FROZEN);
        let mut frozen_physical = physical();
        frozen_physical.entity_collision.scheduling = EntityPhysicsScheduling::Frozen;
        runtime
            .spawn_prepared(
                frozen_definition,
                EntityPhysicalIntent::Simulated,
                Some(frozen_physical),
            )
            .unwrap();
        let first = runtime
            .spawn_prepared(
                definition(first_active_guid, 3, 2.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let second = runtime
            .spawn_prepared(
                definition(second_active_guid, 4, 3.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();

        let ticks = runtime
            .tick_physical_collection(1.0 / 30.0, Instant::now())
            .unwrap();

        assert_eq!(
            ticks
                .ticks
                .iter()
                .map(|tick| (tick.input.identity.guid, tick.generation))
                .collect::<Vec<_>>(),
            [
                (first_active_guid, first.instance.generation),
                (second_active_guid, second.instance.generation),
            ]
        );
        assert!(ticks.ticks.iter().all(|tick| {
            tick.solved.result.motion.path.anchor() == Guid(0xda55_ffff)
                && tick.solved.result.motion.path.legs().last().is_some()
        }));
    }

    #[test]
    fn missile_contact_updates_solver_and_explorer_semantics_in_one_collection_transaction() {
        let (_simulation, runtime) = runtime(0xf000_0110, 0xf000_0111);
        let mover_guid = runtime.reserve_guid().unwrap();
        let target_guid = runtime.reserve_guid().unwrap();
        let mut mover_definition = definition(mover_guid, 1499, 0.0);
        mover_definition.placement.world_mut().unwrap().velocity = Vector3::new(10.0, 0.0, 0.0);
        mover_definition.physics = resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY
                | PhysicsState::MISSILE
                | PhysicsState::ALIGN_PATH
                | PhysicsState::PATH_CLIPPED
                | PhysicsState::INELASTIC,
        );
        let mut mover_physical = physical_with_ball_target();
        mover_physical.response_policy.restitution = PhysicalRestitution::Inelastic;
        mover_physical.response_policy.align_path = true;
        mover_physical.entity_collision.dynamic_collision.missile = true;
        mover_physical
            .entity_collision
            .dynamic_collision
            .path_clipped = true;
        let mover = runtime
            .spawn_prepared(
                mover_definition,
                EntityPhysicalIntent::Simulated,
                Some(mover_physical),
            )
            .unwrap();
        runtime
            .spawn_prepared(
                definition(target_guid, 1, 1.2),
                EntityPhysicalIntent::Simulated,
                Some(physical_with_ball_target()),
            )
            .unwrap();

        let ticks = runtime
            .tick_physical_collection(0.1, Instant::now())
            .unwrap();
        let mover_tick = ticks
            .ticks
            .iter()
            .find(|tick| tick.input.identity.guid == mover_guid)
            .unwrap();
        assert!(mover_tick.solved.result.dynamic_state_change.is_some());
        assert_eq!(mover_tick.generation, mover.instance.generation);
        let physics = runtime.project(mover_guid).unwrap().input.physics;
        assert!(!physics.semantic.contains(PhysicsState::MISSILE));
        assert!(!physics.semantic.contains(PhysicsState::ALIGN_PATH));
        assert!(!physics.semantic.contains(PhysicsState::PATH_CLIPPED));
        assert!(physics.semantic.contains(PhysicsState::INELASTIC));
    }

    #[test]
    fn report_only_collection_outcomes_do_not_become_explorer_projection_ticks() {
        let (simulation, runtime) = runtime(0xf000_0120, 0xf000_0121);
        let mut guids = Vec::new();
        for (index, wcid) in [1, 2].into_iter().enumerate() {
            let guid = runtime.reserve_guid().unwrap();
            guids.push(guid);
            let mut definition = definition(guid, wcid, index as f32 * 2.0);
            definition.physics = resolve_effective_entity_physics_state(
                PhysicsState::GRAVITY | PhysicsState::REPORT_COLLISIONS,
            );
            runtime
                .spawn_prepared(
                    definition,
                    EntityPhysicalIntent::Simulated,
                    Some(report_only_physical()),
                )
                .unwrap();
        }

        let baseline_at = Instant::now();
        let baseline = simulation
            .tick_dynamic_entity_collection(0.1, baseline_at, coasting(0.1))
            .unwrap();
        assert!(baseline.collision_reports.is_empty());
        simulation
            .relocate_dynamic_entity(
                SpatialBodyId::Entity(guids[1]),
                WorldPosition {
                    landblock_id: Guid(0xda55_0001),
                    coords: Vector3::zero(),
                    rotation: Quaternion::identity(),
                },
                baseline_at + std::time::Duration::from_millis(100),
            )
            .unwrap();
        let collection = simulation
            .tick_dynamic_entity_collection(
                0.1,
                baseline_at + std::time::Duration::from_millis(200),
                coasting(0.1),
            )
            .unwrap();
        assert_eq!(collection.collision_reports.len(), 2);
        assert_eq!(collection.bodies.len(), 2);
        assert!(
            collection
                .bodies
                .iter()
                .all(|tick| !physical_tick_changed(tick))
        );
        assert_eq!(runtime.snapshot().unwrap().len(), 2);
    }

    #[test]
    fn failed_body_install_publishes_no_semantic_record() {
        let (simulation, runtime) = runtime(0xf000_0020, 0xf000_0020);
        let guid = runtime.reserve_guid().unwrap();
        let definition = definition(guid, 7, 0.0);
        simulation
            .install_dynamic_entity(
                &definition,
                require_world_initial(&definition, "test install").unwrap(),
                None,
            )
            .unwrap();

        assert_eq!(
            runtime.spawn_prepared(definition, EntityPhysicalIntent::PoseOnly, None),
            Err(ExplorerEntityRuntimeError::Body(
                DynamicEntityBodyOperationError::AlreadyRegistered {
                    body_id: SpatialBodyId::Entity(guid)
                }
            ))
        );
        assert_eq!(
            runtime.project(guid),
            Err(ExplorerEntityRuntimeError::NotRegistered { guid })
        );
    }

    #[test]
    fn replacement_retires_one_generation_and_late_work_cannot_touch_the_successor() {
        let (_simulation, runtime) = runtime(0xf000_0030, 0xf000_0030);
        let guid = runtime.reserve_guid().unwrap();
        let first = runtime
            .spawn_prepared(
                definition(guid, 8, 0.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let replacement = runtime
            .replace_prepared(
                definition(guid, 9, 5.0),
                first.instance.generation,
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();

        assert_eq!(replacement.removed, first.instance);
        assert!(replacement.installed.generation > replacement.removed.generation);
        assert_eq!(
            replacement.body.installed.participation,
            PhysicalBodyParticipation::PoseOnly
        );
        assert!(!runtime.is_current(guid, first.instance.generation));
        assert_eq!(
            runtime
                .project(guid)
                .unwrap()
                .input
                .placement
                .world()
                .unwrap()
                .body
                .runtime_pose
                .coords
                .x,
            5.0
        );

        let stale = runtime
            .replace_prepared(
                definition(guid, 10, 9.0),
                first.instance.generation,
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap_err();
        assert_eq!(
            stale,
            ExplorerEntityRuntimeError::StaleGeneration {
                guid,
                expected: first.instance.generation,
                actual: replacement.installed.generation,
            }
        );
        assert_eq!(runtime.project(guid).unwrap().input.identity.wcid, 9);
    }

    #[test]
    fn despawn_and_reset_remove_each_body_once_without_reusing_generations() {
        let (_simulation, runtime) = runtime(0xf000_0040, 0xf000_0041);
        let first_guid = runtime.reserve_guid().unwrap();
        let first = runtime
            .spawn_prepared(
                definition(first_guid, 11, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();
        let despawned = runtime
            .despawn(first_guid, first.instance.generation)
            .unwrap();
        assert_eq!(despawned.instance, first.instance);
        assert_eq!(
            runtime.despawn(first_guid, first.instance.generation),
            Err(ExplorerEntityRuntimeError::NotRegistered { guid: first_guid })
        );

        let second_guid = runtime.reserve_guid().unwrap();
        let second = runtime
            .spawn_prepared(
                definition(second_guid, 12, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();
        assert_eq!(runtime.reset().unwrap(), vec![second.instance.clone()]);
        assert!(runtime.snapshot().unwrap().is_empty());
        assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0040));
        let after_reset = runtime
            .spawn_prepared(
                definition(Guid(0xf000_0040), 13, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();
        assert!(after_reset.instance.generation > second.instance.generation);
    }

    /// Both malformed-child-set clauses are reachable and name every wearer involved, so a
    /// miswired producer learns which group it published under, not only what the child claims.
    #[test]
    fn a_malformed_child_set_is_refused_before_any_body_is_installed() {
        let (_simulation, runtime) = runtime(0xf000_0090, 0xf000_0095);
        let wearer_guid = runtime.reserve_guid().unwrap();
        let other_wearer_guid = runtime.reserve_guid().unwrap();
        let child_guid = runtime.reserve_guid().unwrap();

        assert_eq!(
            runtime
                .spawn_prepared_group(
                    definition(wearer_guid, 10, 0.0),
                    EntityPhysicalIntent::PoseOnly,
                    None,
                    vec![attached_definition(child_guid, 20, other_wearer_guid)],
                )
                .unwrap_err(),
            ExplorerEntityRuntimeError::ChildWearerMismatch {
                guid: child_guid,
                expected_parent: wearer_guid,
                declared_parent: other_wearer_guid,
            }
        );
        assert_eq!(
            runtime
                .spawn_prepared_group(
                    definition(wearer_guid, 10, 0.0),
                    EntityPhysicalIntent::PoseOnly,
                    None,
                    vec![definition(child_guid, 20, 0.0)],
                )
                .unwrap_err(),
            ExplorerEntityRuntimeError::ChildNotAttached {
                guid: child_guid,
                parent: wearer_guid,
            }
        );
        // A refused group leaves no wearer, no child, and no host body behind.
        assert!(runtime.snapshot().unwrap().is_empty());
    }

    #[test]
    fn attached_children_cut_over_with_their_wearer_and_reject_independent_despawn() {
        let (_simulation, runtime) = runtime(0xf000_0050, 0xf000_0055);
        let wearer_guid = runtime.reserve_guid().unwrap();
        let first_child_guid = runtime.reserve_guid().unwrap();
        let first = runtime
            .spawn_prepared_group(
                definition(wearer_guid, 10, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
                vec![attached_definition(first_child_guid, 20, wearer_guid)],
            )
            .unwrap();

        assert_eq!(first.children.len(), 1);
        let independent_error = runtime
            .despawn(first_child_guid, first.children[0].generation)
            .unwrap_err();
        assert_eq!(
            independent_error,
            ExplorerEntityRuntimeError::AttachedOperation {
                guid: first_child_guid,
                parent: wearer_guid,
                operation: "independent despawn",
            }
        );
        assert_eq!(
            runtime
                .plan_physics_state(
                    first_child_guid,
                    first.children[0].generation,
                    resolve_effective_entity_physics_state(PhysicsState::GRAVITY),
                    EntityPhysicalIntent::PoseOnly,
                )
                .unwrap_err(),
            ExplorerEntityRuntimeError::AttachedOperation {
                guid: first_child_guid,
                parent: wearer_guid,
                operation: "physics-state planning",
            }
        );

        let second_child_guid = runtime.reserve_guid().unwrap();
        let replacement = runtime
            .replace_prepared_group(
                definition(wearer_guid, 11, 1.0),
                first.instance.generation,
                EntityPhysicalIntent::PoseOnly,
                None,
                vec![attached_definition(second_child_guid, 21, wearer_guid)],
            )
            .unwrap();
        assert_eq!(replacement.removed_children, first.children);
        assert_eq!(replacement.installed_children.len(), 1);
        assert_eq!(
            runtime
                .snapshot()
                .unwrap()
                .into_iter()
                .map(|projection| projection.input.identity.guid)
                .collect::<Vec<_>>(),
            vec![wearer_guid, second_child_guid]
        );

        let removed = runtime
            .despawn(wearer_guid, replacement.installed.generation)
            .unwrap();
        assert_eq!(removed.children, replacement.installed_children);
        assert!(runtime.snapshot().unwrap().is_empty());

        let reset_wearer_guid = runtime.reserve_guid().unwrap();
        let reset_child_guid = runtime.reserve_guid().unwrap();
        runtime
            .spawn_prepared_group(
                definition(reset_wearer_guid, 12, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
                vec![attached_definition(reset_child_guid, 22, reset_wearer_guid)],
            )
            .unwrap();
        let reset = runtime.reset().unwrap();
        assert_eq!(reset.len(), 2);
        assert!(runtime.snapshot().unwrap().is_empty());
    }

    /// Both producer compositions must derive the same operation from one pair of masks. This
    /// walks the exact sequence the client `SetState` path asserts in
    /// `holtburger_world::state::tests::set_state_reconfigures_then_disables_dynamic_client_physics_without_losing_semantic_truth`
    /// (GRAVITY, then FROZEN, then PUSHABLE). If either producer's context construction drifts,
    /// one of the two tests fails rather than both silently agreeing on a new answer.
    #[test]
    fn explorer_derives_the_same_transition_actions_as_the_client_set_state_path() {
        let (_simulation, runtime) = runtime(0xf000_0070, 0xf000_0080);
        let guid = runtime.reserve_guid().unwrap();
        let spawned = runtime
            .spawn_prepared(
                definition(guid, 1, 0.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let generation = spawned.instance.generation;

        // FROZEN keeps a simulated body but changes scheduling: reconfigure, never retire.
        let frozen = runtime
            .plan_physics_state(
                guid,
                generation,
                resolve_effective_entity_physics_state(PhysicsState::FROZEN),
                EntityPhysicalIntent::Simulated,
            )
            .unwrap();
        assert_eq!(
            frozen.action,
            holtburger_world::EntityPhysicalTransitionAction::Reconfigure
        );

        // PUSHABLE has no reachable local simulation, so both producers disable participation
        // while the semantic mask survives.
        let pushable = runtime
            .plan_physics_state(
                guid,
                generation,
                resolve_effective_entity_physics_state(PhysicsState::PUSHABLE),
                EntityPhysicalIntent::Simulated,
            )
            .unwrap();
        assert_eq!(
            pushable.action,
            holtburger_world::EntityPhysicalTransitionAction::DisableSolverParticipation
        );
        assert!(
            matches!(
                pushable.disposition,
                holtburger_world::EntityPhysicalDisposition::UnsupportedState { .. }
            ),
            "the unsupported reason must stay typed rather than collapsing to pose-only"
        );
    }

    /// Serves flat ground so a fixture body can prove stable support.
    struct FlatGround;

    impl crate::host_simulation_runtime::CollisionSource for FlatGround {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: holtburger_content::TerrainCollisionSurface::from_terrain(
                    &holtburger_content::LandblockTerrain {
                        grid_size: 9,
                        tile_size: 24.0,
                        height_indices: vec![0; 81],
                        heights: vec![0.0; 81],
                        terrain_samples: vec![0; 81],
                        cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(
                            landblock_id,
                        ),
                    },
                )?,
                static_geometry: holtburger_content::LandblockColliders::default(),
            }))
        }
    }

    const WALK_TABLE: u32 = 0x0900_0001;
    const WALK_STYLE: u32 = 0x8000_003D;
    const WALK_STAND: u32 = 0x4500_0003;
    const WALK_FORWARD: u32 = 0x4500_0005;
    const RUN_FORWARD: u32 = 0x4400_0007;
    /// Default substate of the fixture's only style: what an unpossessed entity idles on.
    const STAND_ANIM: u32 = 0x0300_0001;
    const WALK_ANIM: u32 = 0x0300_0002;
    const RUN_ANIM: u32 = 0x0300_0006;
    const READY_ANIM: u32 = 0x0300_0003;
    const FALLING_ANIM: u32 = 0x0300_0004;
    /// Successor the idle cycle advances to on its own, with no input and no possession.
    const FIDGET_ANIM: u32 = 0x0300_0005;

    /// Four part frames with no hooks: the minimum an assembled animation needs.
    fn part_frames() -> Vec<AnimationFrame> {
        use holtburger_dat::file_type::setup_model::AnimationFrame;
        (0..4)
            .map(|_| AnimationFrame {
                frames: Vec::new(),
                hooks: Vec::new(),
            })
            .collect()
    }

    /// A clip that authors a per-frame root step, which is what a locomotion cycle does.
    fn travelling_animation(id: u32, step: f32) -> Animation {
        Animation {
            id,
            flags: AnimationFlags::POS_FRAMES,
            num_parts: 0,
            num_frames: 4,
            pos_frames: (0..4)
                .map(|_| Frame {
                    origin: Vector3::new(0.0, step, 0.0),
                    orientation: Quaternion::identity(),
                })
                .collect(),
            part_frames: part_frames(),
        }
    }

    /// A clip with no root track at all, which is what an idle or a presentation pose is.
    ///
    /// The distinction matters to scheduling, not just to travel: a stationary clip leaves its
    /// body settled out of the collection scan.
    fn stationary_animation(id: u32) -> Animation {
        Animation {
            id,
            flags: AnimationFlags::empty(),
            num_parts: 0,
            num_frames: 4,
            pos_frames: Vec::new(),
            part_frames: part_frames(),
        }
    }

    /// One cycle entry playing the named animations in order.
    fn cycle(anim_ids: impl IntoIterator<Item = u32>) -> MotionData {
        MotionData {
            bitfield: 0,
            flags: MotionDataFlags::empty(),
            anims: anim_ids
                .into_iter()
                .map(|anim_id| AnimData {
                    anim_id,
                    low_frame: 0,
                    high_frame: -1,
                    framerate: 4.0,
                })
                .collect(),
            velocity: None,
            omega: None,
        }
    }

    /// Assembles the single-table, single-style catalog every motion fixture here shares.
    fn motion_catalog(
        cycles: std::collections::HashMap<u32, MotionData>,
        animations: Vec<Animation>,
        setup_defaults: impl IntoIterator<Item = (u32, u32)>,
    ) -> Arc<MotionSequenceCatalog> {
        Arc::new(
            MotionSequenceCatalog::assemble(
                [MotionTable {
                    id: WALK_TABLE,
                    default_style: WALK_STYLE,
                    style_defaults: std::collections::HashMap::from([(WALK_STYLE, WALK_STAND)]),
                    cycles,
                    modifiers: std::collections::HashMap::new(),
                    links: std::collections::HashMap::new(),
                }],
                animations,
                setup_defaults,
            )
            .expect("motion fixture should assemble"),
        )
    }

    /// A table whose idle cycle advances between two stationary clips without any input, which is
    /// what a real fidget does and the only way an unpossessed clip changes on its own.
    fn fidgeting_catalog() -> Arc<MotionSequenceCatalog> {
        motion_catalog(
            std::collections::HashMap::from([(
                MotionTable::cycle_key(WALK_STYLE, WALK_STAND),
                cycle([STAND_ANIM, FIDGET_ANIM]),
            )]),
            vec![
                stationary_animation(STAND_ANIM),
                stationary_animation(FIDGET_ANIM),
            ],
            [],
        )
    }

    /// A table whose walk cycle authors root motion along local Y, which is what a real walk does.
    fn walking_catalog() -> Arc<MotionSequenceCatalog> {
        walking_catalog_with_jump_presentation(false)
    }

    /// A target-authored run cycle used to prove that a budgeted physical prefix still commits the
    /// matching playback proposal instead of replaying the previous clip on the next tick.
    fn running_catalog() -> Arc<MotionSequenceCatalog> {
        motion_catalog(
            std::collections::HashMap::from([
                (
                    MotionTable::cycle_key(WALK_STYLE, WALK_STAND),
                    cycle([STAND_ANIM]),
                ),
                (
                    MotionTable::cycle_key(WALK_STYLE, RUN_FORWARD),
                    cycle([RUN_ANIM]),
                ),
            ]),
            vec![
                stationary_animation(STAND_ANIM),
                travelling_animation(RUN_ANIM, 1.0),
            ],
            [(FIXTURE_SETUP_DID, WALK_TABLE)],
        )
    }

    fn walking_catalog_with_jump_presentation(
        include_jump_presentation: bool,
    ) -> Arc<MotionSequenceCatalog> {
        let mut cycles = std::collections::HashMap::from([
            (
                MotionTable::cycle_key(WALK_STYLE, WALK_STAND),
                cycle([STAND_ANIM]),
            ),
            (
                MotionTable::cycle_key(WALK_STYLE, WALK_FORWARD),
                cycle([WALK_ANIM]),
            ),
        ]);
        let mut animations = vec![
            stationary_animation(STAND_ANIM),
            travelling_animation(WALK_ANIM, 1.0),
        ];
        if include_jump_presentation {
            cycles.insert(
                MotionTable::cycle_key(WALK_STYLE, MotionCommand::READY.raw()),
                cycle([READY_ANIM]),
            );
            cycles.insert(
                MotionTable::cycle_key(WALK_STYLE, MotionCommand::FALLING.raw()),
                cycle([FALLING_ANIM]),
            );
            animations.extend([
                stationary_animation(READY_ANIM),
                stationary_animation(FALLING_ANIM),
            ]);
        }
        motion_catalog(cycles, animations, [(FIXTURE_SETUP_DID, WALK_TABLE)])
    }

    fn walking_runtime() -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime, Guid) {
        walking_runtime_with_catalog(walking_catalog())
    }

    fn walking_runtime_with_catalog(
        catalog: Arc<MotionSequenceCatalog>,
    ) -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime, Guid) {
        walking_runtime_with_body(catalog, physical())
    }

    fn walking_runtime_with_body(
        catalog: Arc<MotionSequenceCatalog>,
        body: DynamicPhysicalBodyDefinition,
    ) -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime, Guid) {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGround)));
        let runtime = ExplorerEntityRuntime::with_guid_range_and_motion(
            Arc::clone(&simulation),
            0xf000_0090,
            0xf000_00a0,
            catalog,
        );
        install_fixture_interest(&simulation);

        let guid = runtime.reserve_guid().unwrap();
        let mut definition = definition(guid, 1, 0.0);
        definition.content.motion_table_did = Some(WALK_TABLE);
        runtime
            .spawn_prepared(definition, EntityPhysicalIntent::Simulated, Some(body))
            .unwrap();
        (simulation, runtime, guid)
    }

    use std::time::Duration;

    fn settle(simulation: &HostSimulationRuntime, start: Instant) -> Instant {
        for step in 0..240 {
            let now = start + std::time::Duration::from_millis(step * 33);
            if simulation
                .tick_dynamic_entity_collection(1.0 / 30.0, now, coasting(1.0 / 30.0))
                .unwrap()
                .bodies
                .is_empty()
            {
                return now;
            }
        }
        panic!("the grounded fixture body must settle before possession");
    }

    fn set_walk_intent(
        runtime: &ExplorerEntityRuntime,
        possession: &ExplorerPossession,
        revision: u64,
    ) {
        assert_eq!(
            runtime
                .replace_possession_intent(ExplorerPossessionIntentRequest {
                    possession_generation: possession.possession_generation,
                    revision,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::builder().walk().forward().build(),
                    run_rate_scalar: 1.0,
                })
                .expect("walk intent is valid"),
            PossessionIntentReplaceResult::Accepted
        );
    }

    /// The payoff of the whole plan, at the Explorer boundary: a possessed entity commanded to walk
    /// travels under its animation's authored root motion, with no velocity stored anywhere.
    #[test]
    fn a_possessed_entity_walks_on_its_authored_root_motion() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let before = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("the possessed body must exist")
            .pose
            .coords;

        let possession = runtime.possess(guid).unwrap();
        assert_eq!(possession.motion_table_id, WALK_TABLE);
        assert_eq!(possession.accepted_stance, WALK_STYLE);
        set_walk_intent(&runtime, &possession, 1);

        for step in 1..=15 {
            runtime
                .tick_physical_collection(
                    1.0 / 30.0,
                    settled_at + std::time::Duration::from_millis(step * 33),
                )
                .unwrap();
        }

        let after = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("the possessed body must still exist")
            .pose
            .coords;
        assert!(
            (after - before).length() > 0.5,
            "a possessed entity ordered to walk must travel: {before:?} -> {after:?}"
        );
    }

    #[test]
    fn explorer_and_client_authored_grounded_adapters_resolve_equal_actuation() {
        let (simulation, runtime, guid) = walking_runtime_with_catalog(running_catalog());
        settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).expect("fixture is possessable");
        let table = runtime
            .motion_catalog
            .table(possession.motion_table_id)
            .expect("the possession table remains projected");
        let mut active = ActivePossession::new(
            guid,
            possession.entity_generation,
            possession.possession_generation,
            possession.motion_table_id,
            table,
            runtime.possession_profile,
        )
        .expect("fixture possession should resolve");
        let drive = CharacterDrive::builder().run().forward().build();
        active.controller.replace_drive(drive);
        let body = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("the possessed body must exist after settling");
        assert_eq!(body.contact, ContactState::Grounded);
        let offset = RigidTransform {
            translation: Vector3::new(0.0, 0.25, 0.0),
            rotation: Quaternion::identity(),
        };

        let explorer = possession_grounded_actuation(
            &active,
            offset,
            &body,
            1.0,
            runtime.possession_profile,
            1.0 / 30.0,
            None,
        )
        .expect("Explorer adapter should produce grounded actuation");
        let client = holtburger_world::authored_grounded_actuation(
            offset,
            body.pose,
            body.contact,
            1.0,
            1.0 / 30.0,
        )
        .expect("client adapter should produce grounded actuation");
        assert_eq!(explorer, client);
    }

    #[test]
    fn walk_rate_does_not_scale_authored_translation() {
        let measure = |run_rate_scalar: f32| {
            let (simulation, runtime, guid) = walking_runtime();
            let settled_at = settle(&simulation, Instant::now());
            let before = simulation
                .physical_body_snapshot(SpatialBodyId::Entity(guid))
                .expect("body")
                .pose
                .coords;
            let possession = runtime.possess(guid).expect("fixture is possessable");
            runtime
                .replace_possession_intent(ExplorerPossessionIntentRequest {
                    possession_generation: possession.possession_generation,
                    revision: 1,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::builder().walk().forward().build(),
                    run_rate_scalar,
                })
                .expect("walk intent");
            for step in 1..=15 {
                runtime
                    .tick_physical_collection(
                        1.0 / 30.0,
                        settled_at + Duration::from_millis(step * 33),
                    )
                    .expect("walk tick");
            }
            let after = simulation
                .physical_body_snapshot(SpatialBodyId::Entity(guid))
                .expect("body")
                .pose
                .coords;
            (after - before).length()
        };

        let rate_one = measure(1.0);
        let rate_ten = measure(10.0);
        assert!(
            (rate_ten - rate_one).abs() < 0.05,
            "walk rates diverged: {rate_one} vs {rate_ten}"
        );
    }

    #[test]
    fn fallback_run_translation_uses_the_resolved_run_rate() {
        let measure = |run_rate_scalar: f32| {
            let (simulation, runtime, guid) = walking_runtime();
            let settled_at = settle(&simulation, Instant::now());
            let before = simulation
                .physical_body_snapshot(SpatialBodyId::Entity(guid))
                .expect("body")
                .pose
                .coords;
            let possession = runtime.possess(guid).expect("fixture is possessable");
            runtime
                .replace_possession_intent(ExplorerPossessionIntentRequest {
                    possession_generation: possession.possession_generation,
                    revision: 1,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::builder().run().forward().build(),
                    run_rate_scalar,
                })
                .expect("run intent");
            for step in 1..=15 {
                runtime
                    .tick_physical_collection(
                        1.0 / 30.0,
                        settled_at + Duration::from_millis(step * 33),
                    )
                    .expect("run tick");
            }
            let after = simulation
                .physical_body_snapshot(SpatialBodyId::Entity(guid))
                .expect("body")
                .pose
                .coords;
            (after - before).y
        };

        let rate_one = measure(1.0);
        let rate_ten = measure(10.0);
        assert!(rate_one > 1.5, "rate-one fallback should move: {rate_one}");
        assert!(
            rate_ten > rate_one * 8.0,
            "fallback run rate did not scale: {rate_one} vs {rate_ten}"
        );
    }

    #[test]
    fn authored_run_translation_and_playback_rate_use_the_same_scalar() {
        let measure = |run_rate_scalar: f32| {
            let (simulation, runtime, guid) = walking_runtime_with_catalog(running_catalog());
            let settled_at = settle(&simulation, Instant::now());
            let before = simulation
                .physical_body_snapshot(SpatialBodyId::Entity(guid))
                .expect("body")
                .pose
                .coords;
            let possession = runtime.possess(guid).expect("fixture is possessable");
            runtime
                .replace_possession_intent(ExplorerPossessionIntentRequest {
                    possession_generation: possession.possession_generation,
                    revision: 1,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::builder().run().forward().build(),
                    run_rate_scalar,
                })
                .expect("run intent");
            for step in 1..=15 {
                runtime
                    .tick_physical_collection(
                        1.0 / 30.0,
                        settled_at + Duration::from_millis(step * 33),
                    )
                    .expect("run tick");
            }
            let after = simulation
                .physical_body_snapshot(SpatialBodyId::Entity(guid))
                .expect("body")
                .pose
                .coords;
            let probe = runtime.possession_motion_probe().expect("probe");
            ((after - before).y, probe.substate.speed)
        };

        let (rate_one_distance, rate_one_playback) = measure(1.0);
        let (rate_ten_distance, rate_ten_playback) = measure(10.0);
        assert!(
            rate_ten_distance > rate_one_distance * 8.0,
            "authored run translation did not scale: {rate_one_distance} vs {rate_ten_distance}"
        );
        assert_eq!(rate_one_playback, 1.0);
        assert_eq!(rate_ten_playback, 10.0);
    }

    #[test]
    fn reset_preserves_the_applied_run_rate_snapshot() {
        let (simulation, runtime, guid) = walking_runtime_with_catalog(running_catalog());
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).expect("fixture is possessable");
        assert_eq!(
            runtime
                .replace_possession_intent(ExplorerPossessionIntentRequest {
                    possession_generation: possession.possession_generation,
                    revision: 1,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::builder().run().forward().build(),
                    run_rate_scalar: 10.0,
                })
                .expect("run intent"),
            PossessionIntentReplaceResult::Accepted
        );
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
            .expect("run tick");
        assert_eq!(
            runtime
                .possession_motion_probe()
                .expect("run probe")
                .requested_run_rate,
            10.0
        );

        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 0,
                revision: 2,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 10.0,
                event: PossessionLifecycleEvent::Reset,
            })
            .expect("reset edge");
        let reset = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(66))
            .expect("reset tick");
        assert!(reset.ticks.iter().any(|tick| {
            tick.possession_event_outcomes
                .iter()
                .any(|outcome| outcome.result == PossessionEventOutcomeKind::Reset)
        }));
        assert_eq!(
            runtime
                .possession_motion_probe()
                .expect("reset probe")
                .requested_run_rate,
            10.0,
            "reset clears drive state without resetting the selected rate"
        );

        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 3,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().run().forward().build(),
                run_rate_scalar: 10.0,
            })
            .expect("restored run intent");
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(99))
            .expect("restored run tick");
        let restored = runtime.possession_motion_probe().expect("restored probe");
        assert_eq!(restored.requested_run_rate, 10.0);
        assert_eq!(restored.substate.speed, 10.0);
    }

    #[test]
    fn a_budgeted_possession_tick_commits_its_safe_prefix_and_playback() {
        let (simulation, runtime, guid) =
            walking_runtime_with_body(running_catalog(), physical_with_maximum_substeps(1));
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).expect("fixture is possessable");
        let result = runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().run().forward().build(),
                run_rate_scalar: 10.0,
            })
            .expect("run intent is valid");
        assert_eq!(result, PossessionIntentReplaceResult::Accepted);

        let tick = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
            .expect("the safe prefix still commits");
        let body_tick = tick
            .ticks
            .iter()
            .find(|tick| tick.input.identity.guid == guid)
            .expect("the possessed body must publish its committed tick");
        assert_eq!(
            body_tick.solved.result.motion.status,
            PhysicalBodyTickStatus::SubstepBudgetExceeded
        );

        let probe = runtime
            .possession_motion_probe()
            .expect("the possession remains active after a bounded tick");
        assert_eq!(probe.requested_run_rate, 10.0);
        assert_eq!(
            probe.physical_status,
            Some(ExplorerPossessionPhysicalStatus::SubstepBudgetExceeded)
        );
        assert_eq!(
            probe
                .clip
                .expect("run playback must be committed")
                .animation_id,
            RUN_ANIM
        );
        assert_eq!(probe.substate.speed, 10.0);
        assert!(
            probe
                .effective_planar_speed
                .expect("the committed body exposes achieved speed")
                < 40.0,
            "the one-substep fixture must expose its safe-prefix clamp"
        );
    }

    /// Every tick states the clip its entity is playing, changed or not, so a consumer never has
    /// to have witnessed the transition that selected it.
    #[test]
    fn every_tick_states_the_clip_its_entity_is_playing() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).unwrap();

        let first = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
            .unwrap();
        assert!(
            first.ticks.iter().any(|tick| {
                tick.publish && tick.playing_clip.map(|clip| clip.animation_id) == Some(STAND_ANIM)
            }),
            "the first tick publishes the idle the entity is already playing"
        );

        set_walk_intent(&runtime, &possession, 1);
        let mut levels = Vec::new();
        for step in 2..=20 {
            for tick in runtime
                .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
                .unwrap()
                .ticks
            {
                assert!(
                    tick.playing_clip.is_some(),
                    "a body driven by a motion table always has a clip to state"
                );
                if tick.publish {
                    levels.push(tick.playing_clip.expect("a stated clip").animation_id);
                }
            }
        }

        assert!(
            levels.contains(&WALK_ANIM),
            "commanding a walk moves the stated level onto the walk cycle: {levels:?}"
        );
    }

    /// The bug this contract exists to prevent: an entity that settles while a consumer is still
    /// realizing it must still be able to state what it is playing. The clip was previously an
    /// edge drained on publication, so a consumer that missed it never learned the entity idles.
    #[test]
    fn a_settled_unpossessed_entity_states_its_idle_to_a_late_consumer() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        for step in 1..=30 {
            runtime
                .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
                .unwrap();
        }

        assert_eq!(
            runtime
                .project(guid)
                .expect("the spawned entity must project")
                .playing_clip
                .map(|clip| clip.animation_id),
            Some(STAND_ANIM),
            "a projection taken long after spawn still states the idle"
        );
        assert_eq!(
            runtime
                .snapshot()
                .expect("the population must snapshot")
                .into_iter()
                .find(|projection| projection.input.identity.guid == guid)
                .expect("the spawned entity must appear in its snapshot")
                .playing_clip
                .map(|clip| clip.animation_id),
            Some(STAND_ANIM),
            "a complete snapshot reconstructs playback without replaying history"
        );
    }

    /// A frontend stages a clip closure for the table id its view names, and has no setup catalog
    /// to consult. Leaving the setup's default unresolved would publish an entity that states a
    /// clip it also claims to have no table for.
    #[test]
    fn an_entity_without_its_own_table_publishes_the_one_its_setup_defaults_to() {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGround)));
        let runtime = ExplorerEntityRuntime::with_guid_range_and_motion(
            Arc::clone(&simulation),
            0xf000_0090,
            0xf000_00a0,
            walking_catalog(),
        );
        let guid = runtime.reserve_guid().unwrap();
        let definition = definition(guid, 1, 0.0);
        assert_eq!(
            definition.content.motion_table_did, None,
            "the fixture weenie carries no table of its own"
        );

        runtime
            .spawn_prepared(definition, EntityPhysicalIntent::PoseOnly, None)
            .unwrap();

        assert_eq!(
            runtime
                .project(guid)
                .unwrap()
                .input
                .content
                .motion_table_did,
            Some(WALK_TABLE),
            "the published entity names the table it actually animates from"
        );
    }

    /// An idle contributes no root motion, so nothing else returns a settled body to the collection
    /// scan. Its own clip change has to, or the change has no tick to travel on and a consumer is
    /// left rendering the clip the body stopped playing.
    #[test]
    fn a_clip_change_wakes_a_settled_body_so_it_can_publish() {
        let (simulation, runtime, guid) = walking_runtime_with_catalog(fidgeting_catalog());
        let mut now = settle(&simulation, Instant::now());

        // Run until the idle's first clip leaves the body settled and out of the scan entirely.
        let mut quiet = false;
        for _ in 0..30 {
            now += Duration::from_millis(33);
            quiet = runtime
                .tick_physical_collection(1.0 / 30.0, now)
                .unwrap()
                .ticks
                .is_empty();
            if quiet {
                break;
            }
        }
        assert!(
            quiet,
            "a stationary idle must let the fixture body settle out of the scan"
        );
        assert_eq!(
            runtime
                .project(guid)
                .unwrap()
                .playing_clip
                .unwrap()
                .animation_id,
            STAND_ANIM,
            "the settled body is still on the first clip of its idle"
        );

        // Playback keeps advancing off the scan, so the successor clip eventually comes due.
        let mut published = None;
        for _ in 0..90 {
            now += Duration::from_millis(33);
            let tick = runtime.tick_physical_collection(1.0 / 30.0, now).unwrap();
            if let Some(clip) = tick
                .ticks
                .iter()
                .filter(|tick| tick.publish)
                .find_map(|tick| tick.playing_clip)
            {
                published = Some(clip.animation_id);
                break;
            }
        }
        assert_eq!(
            published,
            Some(FIDGET_ANIM),
            "the successor clip must wake its body back into the scan and publish there"
        );
    }

    /// Releasing possession stops the entity: authored drive is per-tick, so nothing survives it.
    #[test]
    fn releasing_possession_stops_authored_travel() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).unwrap();
        set_walk_intent(&runtime, &possession, 1);
        for step in 1..=15 {
            runtime
                .tick_physical_collection(
                    1.0 / 30.0,
                    settled_at + std::time::Duration::from_millis(step * 33),
                )
                .unwrap();
        }

        let released_at = settled_at + std::time::Duration::from_millis(600);
        let release = runtime.release_possession(released_at).unwrap();
        assert_eq!(release.released_guid, Some(guid));
        assert!(release.possession_generation > possession.possession_generation);
        let before = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .coords;
        for step in 1..=15 {
            runtime
                .tick_physical_collection(
                    1.0 / 30.0,
                    released_at + std::time::Duration::from_millis(step * 33),
                )
                .unwrap();
        }
        let after = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .coords;

        assert!(
            (after - before).length() < 0.05,
            "a released entity keeps no authored momentum: {before:?} -> {after:?}"
        );
    }

    /// Capability distinguishes authored physics from fallback with or without target presentation.
    #[test]
    fn possession_reports_composite_sources_for_every_canonical_family() {
        let (_simulation, runtime, guid) = walking_runtime();

        let possession = runtime.possess(guid).unwrap();
        let capability = possession
            .stances
            .iter()
            .find(|capability| capability.style == WALK_STYLE)
            .expect("non-combat capability");
        assert_eq!(
            capability.walk,
            crate::explorer_possession_control::PossessionLocomotionSource::TargetAuthored
        );
        for source in [capability.run, capability.sidestep, capability.turn] {
            assert_eq!(
                source,
                crate::explorer_possession_control::PossessionLocomotionSource::StandardFallbackWithoutTargetPresentation
            );
        }
    }

    #[test]
    fn mixed_authored_forward_and_fallback_sidestep_drive_once_per_axis() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let before = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .coords;
        let possession = runtime.possess(guid).unwrap();
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder()
                    .walk()
                    .forward()
                    .strafe_right()
                    .build(),
                run_rate_scalar: 1.0,
            })
            .unwrap();

        for step in 1..=30 {
            runtime
                .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
                .unwrap();
        }
        let after = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .coords;
        let travelled = after - before;

        assert!(
            travelled.y > 2.5,
            "target-authored forward was lost: {travelled:?}"
        );
        assert!(
            travelled.x > 1.0 && travelled.x < 2.0,
            "fallback sidestep should contribute once at about 1.5m/s: {travelled:?}"
        );
    }

    #[test]
    fn absent_turn_presentation_still_turns_the_possessed_body_with_fallback() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let before = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .rotation
            .to_heading();
        let possession = runtime.possess(guid).unwrap();
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().turn_right().build(),
                run_rate_scalar: 1.0,
            })
            .unwrap();

        for step in 1..=15 {
            runtime
                .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
                .unwrap();
        }
        let after = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .rotation
            .to_heading();
        assert!(
            after - before > 0.6,
            "fallback turn should rotate about 0.75rad in half a second: {before} -> {after}"
        );
    }

    #[test]
    fn jump_launches_without_ready_or_falling_target_presentation() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).unwrap();
        assert_eq!(
            possession.stances[0].jump_presentation,
            crate::explorer_possession_control::PossessionJumpPresentation::StanceDefault
        );
        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 0,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::BeginJump,
            })
            .unwrap();
        let charged = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
            .unwrap();
        assert!(charged.ticks.iter().any(|tick| {
            tick.possession_event_outcomes.iter().any(|outcome| {
                matches!(
                    outcome.result,
                    PossessionEventOutcomeKind::ChargeAccepted { .. }
                )
            })
        }));

        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 1,
                revision: 2,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().forward().turn_right().build(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::ReleaseJump {
                    extent: holtburger_core::JumpExtent::MAXIMUM,
                },
            })
            .unwrap();
        let launched = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(66))
            .unwrap();
        assert!(launched.ticks.iter().any(|tick| {
            tick.possession_event_outcomes.iter().any(|outcome| {
                matches!(
                    outcome.result,
                    PossessionEventOutcomeKind::JumpReleased { .. }
                )
            })
        }));
        let body = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap();
        assert!(body.velocity.z > 0.0, "accepted release must launch upward");

        let launch_planar_speed = body.velocity.x.hypot(body.velocity.y);
        assert_eq!(
            runtime
                .replace_possession_intent(ExplorerPossessionIntentRequest {
                    possession_generation: possession.possession_generation,
                    revision: 3,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::builder()
                        .walk()
                        .forward()
                        .turn_right()
                        .build(),
                    run_rate_scalar: 10.0,
                })
                .unwrap(),
            PossessionIntentReplaceResult::Accepted
        );
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(99))
            .unwrap();
        let airborne_body = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap();
        assert!(
            (airborne_body.velocity.x.hypot(airborne_body.velocity.y) - launch_planar_speed).abs()
                < 0.1,
            "changing rate in flight must not rescale retained planar velocity: {launch_planar_speed} -> {}",
            airborne_body.velocity.x.hypot(airborne_body.velocity.y)
        );

        let launch_heading = body.pose.rotation.to_heading();
        let mut saw_airborne_turn = false;
        let mut restored_walk_clip = false;
        let mut landed = false;
        for step in 4..=140 {
            let ticks = runtime
                .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
                .unwrap();
            assert!(
                ticks
                    .ticks
                    .iter()
                    .flat_map(|tick| &tick.possession_event_outcomes)
                    .all(|outcome| !matches!(
                        outcome.result,
                        PossessionEventOutcomeKind::JumpReleased { .. }
                    )),
                "one release edge must launch at most once"
            );
            let body = simulation
                .physical_body_snapshot(SpatialBodyId::Entity(guid))
                .unwrap();
            if body.contact == ContactState::Airborne
                && body.pose.rotation.to_heading() - launch_heading > 0.08
            {
                saw_airborne_turn = true;
            }
            restored_walk_clip |= ticks.ticks.iter().any(|tick| {
                tick.playing_clip
                    .is_some_and(|clip| clip.animation_id == WALK_ANIM)
            });
            if body.contact == ContactState::Grounded && step > 3 {
                landed = true;
                break;
            }
        }
        assert!(
            saw_airborne_turn,
            "turn intent must remain effective while airborne"
        );
        assert!(
            landed,
            "jump fixture must land within its bounded test horizon"
        );
        assert!(
            restored_walk_clip,
            "landing must restore retained authored locomotion without new input"
        );
    }

    #[test]
    fn queued_jump_release_keeps_its_rate_snapshot_when_a_newer_intent_arrives() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).expect("fixture is possessable");
        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 0,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::BeginJump,
            })
            .expect("begin edge queues");
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
            .expect("charge tick");

        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 1,
                revision: 2,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().run().forward().build(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::ReleaseJump {
                    extent: holtburger_core::JumpExtent::MAXIMUM,
                },
            })
            .expect("release edge queues");
        assert_eq!(
            runtime
                .replace_possession_intent(ExplorerPossessionIntentRequest {
                    possession_generation: possession.possession_generation,
                    revision: 3,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::builder().run().forward().build(),
                    run_rate_scalar: 10.0,
                })
                .expect("newer rate intent is accepted"),
            PossessionIntentReplaceResult::Accepted
        );

        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(66))
            .expect("release tick");
        let body = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("body remains registered");
        let planar_speed = body.velocity.x.hypot(body.velocity.y);
        assert!(
            planar_speed < 8.0,
            "release must use its captured 1x planar speed, not newer 10x intent: {planar_speed}"
        );
        assert!(
            body.velocity.z > 0.0,
            "the queued release must launch upward"
        );
    }

    #[test]
    fn target_jump_presentation_selects_ready_then_falling_on_accepted_edges() {
        let (simulation, runtime, guid) =
            walking_runtime_with_catalog(walking_catalog_with_jump_presentation(true));
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).unwrap();
        assert_eq!(
            possession.stances[0].jump_presentation,
            crate::explorer_possession_control::PossessionJumpPresentation::ReadyAndFalling
        );
        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 0,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::BeginJump,
            })
            .unwrap();
        let charged = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
            .unwrap();
        assert!(charged.ticks.iter().any(|tick| {
            tick.playing_clip
                .is_some_and(|clip| clip.animation_id == READY_ANIM)
        }));

        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 1,
                revision: 2,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::ReleaseJump {
                    extent: holtburger_core::JumpExtent::MINIMUM,
                },
            })
            .unwrap();
        let launched = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(66))
            .unwrap();
        assert!(launched.ticks.iter().any(|tick| {
            tick.playing_clip
                .is_some_and(|clip| clip.animation_id == FALLING_ANIM)
        }));
    }

    #[test]
    fn dynamic_contact_work_limit_does_not_defer_the_release_edge() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).unwrap();
        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 0,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::BeginJump,
            })
            .unwrap();
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
            .unwrap();

        let peer_guid = runtime.reserve_guid().unwrap();
        let mut peer = definition(peer_guid, 2, 0.0);
        let EntityPlacement::World(mut initial) = peer.placement else {
            unreachable!()
        };
        initial.pose.coords.z = 4.0;
        peer.placement = EntityPlacement::World(initial);
        let peer = runtime
            .spawn_prepared(
                peer,
                EntityPhysicalIntent::Simulated,
                Some(physical_with_ball_target()),
            )
            .unwrap();
        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 1,
                revision: 2,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::ReleaseJump {
                    extent: holtburger_core::JumpExtent::MAXIMUM,
                },
            })
            .unwrap();

        let limited = runtime
            .tick_physical_collection(1.0, settled_at + Duration::from_secs(1))
            .unwrap();
        assert!(
            limited.ticks.iter().any(|tick| {
                tick.possession_event_outcomes.iter().any(|outcome| {
                    matches!(
                        outcome.result,
                        PossessionEventOutcomeKind::JumpReleased { .. }
                    )
                })
            }),
            "a dynamic work limit must not roll back the accepted release edge"
        );

        runtime
            .despawn(peer_guid, peer.instance.generation)
            .unwrap();
        let next = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(1_033))
            .unwrap();
        assert!(next.ticks.iter().all(|tick| {
            tick.possession_event_outcomes.iter().all(|outcome| {
                !matches!(
                    outcome.result,
                    PossessionEventOutcomeKind::JumpReleased { .. }
                )
            })
        }));
    }

    #[test]
    fn nonphysical_possession_rejects_contiguous_jump_edges_without_wedging() {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGround)));
        let runtime = ExplorerEntityRuntime::with_guid_range_and_motion(
            simulation,
            0xf000_00d0,
            0xf000_00e0,
            walking_catalog(),
        );
        let guid = runtime.reserve_guid().unwrap();
        let mut target = definition(guid, 1, 0.0);
        target.content.motion_table_did = Some(WALK_TABLE);
        runtime
            .spawn_prepared(target, EntityPhysicalIntent::PoseOnly, None)
            .unwrap();
        let possession = runtime.possess(guid).unwrap();

        let queue = |sequence, event| {
            runtime
                .queue_possession_event(ExplorerPossessionEventRequest {
                    possession_generation: possession.possession_generation,
                    sequence,
                    revision: sequence + 1,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::default(),
                    run_rate_scalar: 1.0,
                    event,
                })
                .unwrap()
        };
        assert_eq!(
            queue(0, PossessionLifecycleEvent::BeginJump).outcomes[0].result,
            PossessionEventOutcomeKind::Rejected {
                reason: PossessionEventRejection::NonphysicalResponse
            }
        );
        assert_eq!(
            queue(1, PossessionLifecycleEvent::Reset).outcomes[0].result,
            PossessionEventOutcomeKind::Reset
        );
        assert_eq!(
            queue(2, PossessionLifecycleEvent::BeginJump).outcomes[0].sequence,
            2,
            "the reset and rejection both advance the contiguous queue"
        );
    }

    #[test]
    fn standing_charge_suppresses_new_translation_but_moving_charge_keeps_it() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let possession = runtime.possess(guid).unwrap();
        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 0,
                revision: 1,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::BeginJump,
            })
            .unwrap();
        runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
            .unwrap();
        runtime
            .replace_possession_intent(ExplorerPossessionIntentRequest {
                possession_generation: possession.possession_generation,
                revision: 2,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().forward().build(),
                run_rate_scalar: 1.0,
            })
            .unwrap();
        let before = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .coords;
        for step in 2..=10 {
            runtime
                .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
                .unwrap();
        }
        let held = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .coords;
        assert!(
            (held - before).length() < 0.01,
            "standing charge must retain but suppress later translation"
        );

        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 1,
                revision: 3,
                stance: WALK_STYLE,
                drive: CharacterDrive::default(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::Reset,
            })
            .unwrap();
        runtime
            .queue_possession_event(ExplorerPossessionEventRequest {
                possession_generation: possession.possession_generation,
                sequence: 2,
                revision: 4,
                stance: WALK_STYLE,
                drive: CharacterDrive::builder().forward().build(),
                run_rate_scalar: 1.0,
                event: PossessionLifecycleEvent::BeginJump,
            })
            .unwrap();
        for step in 11..=20 {
            runtime
                .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
                .unwrap();
        }
        let moved = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .coords;
        assert!(
            (moved - held).length() > 0.5,
            "a charge begun while moving must retain locomotion"
        );
    }

    #[test]
    fn same_guid_repossession_and_release_form_hard_input_generation_barriers() {
        let (_simulation, runtime, guid) = walking_runtime();
        let first = runtime.possess(guid).expect("first possession");
        let second = runtime.possess(guid).expect("same-guid repossession");
        assert!(second.possession_generation > first.possession_generation);

        let stale_intent = ExplorerPossessionIntentRequest {
            possession_generation: first.possession_generation,
            revision: 1,
            stance: WALK_STYLE,
            drive: CharacterDrive::builder().walk().forward().build(),
            run_rate_scalar: 1.0,
        };
        assert_eq!(
            runtime.replace_possession_intent(stale_intent).unwrap(),
            PossessionIntentReplaceResult::IgnoredStalePossession
        );
        assert_eq!(
            runtime
                .queue_possession_event(ExplorerPossessionEventRequest {
                    possession_generation: first.possession_generation,
                    sequence: 0,
                    revision: 1,
                    stance: WALK_STYLE,
                    drive: CharacterDrive::default(),
                    run_rate_scalar: 1.0,
                    event: PossessionLifecycleEvent::Reset,
                })
                .unwrap()
                .result,
            PossessionEventQueueResult::IgnoredStalePossession
        );

        let release = runtime.release_possession(Instant::now()).unwrap();
        assert!(release.possession_generation > second.possession_generation);
        assert_eq!(
            runtime
                .replace_possession_intent(ExplorerPossessionIntentRequest {
                    possession_generation: second.possession_generation,
                    ..stale_intent
                })
                .unwrap(),
            PossessionIntentReplaceResult::IgnoredStalePossession
        );
        let third = runtime.possess(guid).expect("possession after release");
        assert!(third.possession_generation > release.possession_generation);
    }

    #[test]
    fn target_despawn_replacement_and_reset_retire_possession_in_the_registry_transaction() {
        let assert_stale = |runtime: &ExplorerEntityRuntime, generation: u64| {
            assert_eq!(
                runtime
                    .replace_possession_intent(ExplorerPossessionIntentRequest {
                        possession_generation: generation,
                        revision: 1,
                        stance: WALK_STYLE,
                        drive: CharacterDrive::builder().forward().build(),
                        run_rate_scalar: 1.0,
                    })
                    .unwrap(),
                PossessionIntentReplaceResult::IgnoredStalePossession
            );
        };

        let (_simulation, runtime, guid) = walking_runtime();
        let generation = runtime.project(guid).unwrap().generation;
        let possession = runtime.possess(guid).unwrap();
        runtime.despawn(guid, generation).unwrap();
        assert_stale(&runtime, possession.possession_generation);

        let (_simulation, runtime, guid) = walking_runtime();
        let possession = runtime.possess(guid).unwrap();
        let generation = runtime.project(guid).unwrap().generation;
        let mut replacement = definition(guid, 2, 1.0);
        replacement.content.motion_table_did = Some(WALK_TABLE);
        runtime
            .replace_prepared(
                replacement,
                generation,
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        assert_stale(&runtime, possession.possession_generation);

        let (_simulation, runtime, guid) = walking_runtime();
        let possession = runtime.possess(guid).unwrap();
        runtime.reset().unwrap();
        assert_stale(&runtime, possession.possession_generation);
    }

    #[test]
    fn possession_rejects_a_target_without_a_resolved_motion_table() {
        let (_simulation, runtime) = runtime(0xf000_00b0, 0xf000_00c0);
        let guid = runtime.reserve_guid().unwrap();
        runtime
            .spawn_prepared(
                definition(guid, 1, 0.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();

        assert!(matches!(
            runtime.possess(guid),
            Err(ExplorerEntityRuntimeError::MissingPossessionMotionTable { guid: missing })
                if missing == guid
        ));
    }

    #[test]
    fn possession_rejects_a_target_outside_current_collision_interest() {
        let (simulation, runtime, guid) = walking_runtime();
        let session = simulation.reserve_interest_session();
        simulation
            .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
                session,
                revision: 1,
                landblock_ids: vec!["0xdb55ffff".to_owned()],
            })
            .unwrap();

        assert_eq!(
            runtime.possess(guid),
            Err(
                ExplorerEntityRuntimeError::PossessionTargetMissingCollisionOwner {
                    guid,
                    owner: Guid(0xda55_ffff),
                }
            )
        );
        assert_eq!(
            runtime
                .release_possession(Instant::now())
                .unwrap()
                .released_guid,
            None,
            "a rejected target must not mutate possession authority"
        );
    }

    /// A settled body lazily revalidates changed static support without publication-time mutation.
    #[test]
    fn loaded_collision_eviction_rejects_the_dependent_body_without_global_waking() {
        /// Serves flat ground so the fixture body can prove stable support and settle.
        struct FlatGroundSource;

        impl crate::host_simulation_runtime::CollisionSource for FlatGroundSource {
            fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
                Ok(Some(LandblockCollisionAsset {
                    landblock_id,
                    terrain: holtburger_content::TerrainCollisionSurface::from_terrain(
                        &holtburger_content::LandblockTerrain {
                            grid_size: 9,
                            tile_size: 24.0,
                            height_indices: vec![0; 81],
                            heights: vec![0.0; 81],
                            terrain_samples: vec![0; 81],
                            cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(
                                landblock_id,
                            ),
                        },
                    )?,
                    static_geometry: holtburger_content::LandblockColliders::default(),
                }))
            }
        }

        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGroundSource)));
        let runtime = ExplorerEntityRuntime::with_guid_range(
            Arc::clone(&simulation),
            0xf000_0050,
            0xf000_0060,
        );
        let session = install_fixture_interest(&simulation);

        let guid = runtime.reserve_guid().unwrap();
        runtime
            .spawn_prepared(
                definition(guid, 1, 0.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();

        // Integrate until the body proves stable support and settles out of the scan.
        let start = Instant::now();
        let mut settled_at = None;
        for step in 0..240 {
            let now = start + std::time::Duration::from_millis(step * 33);
            let tick = simulation
                .tick_dynamic_entity_collection(1.0 / 30.0, now, coasting(1.0 / 30.0))
                .unwrap();
            if tick.bodies.is_empty() {
                settled_at = Some(now);
                break;
            }
        }
        let settled_at = settled_at.expect("the grounded fixture body must settle");
        assert!(
            simulation
                .tick_dynamic_entity_collection(1.0 / 30.0, settled_at, coasting(1.0 / 30.0))
                .unwrap()
                .bodies
                .is_empty(),
            "a settled body must stay out of the integration scan"
        );

        let before = runtime.project(guid).unwrap();

        // Replacing interest with a different owner evicts the product that proved support.
        simulation
            .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
                session,
                revision: 2,
                landblock_ids: fixture_landblock_ids()
                    .into_iter()
                    .filter(|owner| owner != "0xda55ffff")
                    .collect(),
            })
            .unwrap();

        let collection = simulation
            .tick_dynamic_entity_collection(1.0 / 30.0, settled_at, coasting(1.0 / 30.0))
            .unwrap();
        assert!(collection.bodies.is_empty());
        assert_eq!(
            collection
                .coverage_rejections
                .iter()
                .map(|rejection| (rejection.body.id, rejection.owner))
                .collect::<Vec<_>>(),
            [(SpatialBodyId::Entity(guid), Guid(0xda55_ffff))]
        );
        assert_eq!(runtime.project(guid).unwrap(), before);
    }

    #[test]
    fn host_boom_follows_exact_possession_without_registering_a_camera_body() {
        use crate::host_kinematic_boom_runtime::{
            HostKinematicBoomCollisionProof, HostKinematicBoomHoldReason,
            HostKinematicBoomIntentRequest, HostKinematicBoomRuntime,
            HostKinematicBoomStartRequest, HostKinematicBoomTargetSphereRole,
            HostKinematicBoomTick, HostKinematicBoomUpdateReceipt,
        };

        let upper = Sphere {
            center: Vector3::new(0.0, 0.0, 1.2),
            radius: 0.20,
        };
        let (simulation, entities, guid) =
            walking_runtime_with_body(walking_catalog(), physical_with_upper(Some(upper)));
        let entities = Arc::new(entities);
        let possession = entities.possess(guid).unwrap();
        let boom =
            HostKinematicBoomRuntime::new(Arc::clone(&entities), Arc::clone(&simulation)).unwrap();
        let body_count = simulation.registered_body_count();
        assert_eq!(body_count, 1, "the fixture owns only its possessed body");

        let receipt = boom
            .start(HostKinematicBoomStartRequest {
                possession_generation: possession.possession_generation,
                guid,
                entity_generation: possession.entity_generation,
                initial_reach: 4.0,
                minimum_reach: 1.2,
                maximum_reach: 4.25,
                input_sequence: 1,
                view_direction: [0.0, -1.0, 0.0],
                cumulative_zoom_displacement: 0.0,
                projection_revision: 1,
                clearance_radius: 0.25,
            })
            .unwrap();
        assert_eq!(simulation.registered_body_count(), body_count);
        assert_eq!(
            boom.set_intent(HostKinematicBoomIntentRequest {
                identity: receipt.identity,
                input_sequence: 1,
                view_direction: [1.0, 0.0, 0.0],
                cumulative_zoom_displacement: 1.0,
            })
            .unwrap(),
            HostKinematicBoomUpdateReceipt::IgnoredStale
        );
        assert_eq!(
            boom.set_intent(HostKinematicBoomIntentRequest {
                identity: receipt.identity,
                input_sequence: 2,
                view_direction: [1.0, 0.0, 0.0],
                cumulative_zoom_displacement: 1.0,
            })
            .unwrap(),
            HostKinematicBoomUpdateReceipt::Accepted
        );

        let started_at = Instant::now();
        let collection = entities
            .tick_physical_collection(1.0 / 30.0, started_at)
            .unwrap();
        let initial_tick = boom.advance(&collection, 1.0 / 30.0).unwrap().unwrap();
        assert!(matches!(
            initial_tick,
            HostKinematicBoomTick::Reseeded {
                reason: crate::host_kinematic_boom_runtime::HostKinematicBoomReseedReason::InitialPlacement,
                ..
            }
        ));
        let tick = boom.advance(&collection, 1.0 / 30.0).unwrap().unwrap();
        let HostKinematicBoomTick::Advanced {
            identity,
            sequence,
            target_sphere_role,
            clearance,
            desired_reach,
            path,
            ..
        } = tick
        else {
            panic!("an empty flat scene must accept the first boom path")
        };
        assert_eq!(identity, receipt.identity);
        assert_eq!(sequence, 2);
        assert_eq!(
            target_sphere_role,
            HostKinematicBoomTargetSphereRole::UpperConstraint
        );
        assert_eq!(clearance.unwrap().radius, 0.25);
        assert_eq!(desired_reach, 4.25);
        assert_eq!(path.legs.last().unwrap().end_fraction, 1.0);
        assert!(path.initial.visual_pivot.coords.z.is_finite());
        assert_eq!(simulation.registered_body_count(), body_count);

        let target_tick = collection
            .ticks
            .iter()
            .find(|tick| tick.solved.current.id == SpatialBodyId::Entity(guid))
            .unwrap();
        let unavailable_owner = Guid(0xda55_ffff);
        let rejected_target = ExplorerEntityCollectionTick {
            ticks: Vec::new(),
            coverage_rejections: vec![
                crate::host_simulation_runtime::HostPhysicalBodyCoverageRejection {
                    body: target_tick.solved.current.clone(),
                    owner: unavailable_owner,
                    collision: Arc::clone(&target_tick.solved.collision),
                },
            ],
            possession: Some(ExplorerPossessedBodyEpoch {
                guid,
                entity_generation: possession.entity_generation,
                possession_generation: possession.possession_generation,
            }),
        };
        assert!(matches!(
            boom.advance(&rejected_target, 1.0 / 30.0).unwrap(),
            Some(HostKinematicBoomTick::Advanced {
                identity,
                sequence: 3,
                diagnostics,
                ..
            }) if identity == receipt.identity
                && diagnostics.collision_proof
                    == HostKinematicBoomCollisionProof::Uncovered {
                        owner: unavailable_owner,
                    }
        ));

        let missing_target = ExplorerEntityCollectionTick {
            ticks: Vec::new(),
            coverage_rejections: Vec::new(),
            possession: Some(ExplorerPossessedBodyEpoch {
                guid,
                entity_generation: possession.entity_generation,
                possession_generation: possession.possession_generation,
            }),
        };
        assert!(matches!(
            boom.advance(&missing_target, 1.0 / 30.0).unwrap(),
            Some(HostKinematicBoomTick::Held {
                identity,
                sequence: 4,
                reason: HostKinematicBoomHoldReason::TargetContract,
                ..
            }) if identity == receipt.identity
        ));

        assert_eq!(
            boom.set_intent(HostKinematicBoomIntentRequest {
                identity: receipt.identity,
                input_sequence: 3,
                view_direction: [0.0, 1.0, 0.0],
                cumulative_zoom_displacement: 1.0,
            })
            .unwrap(),
            HostKinematicBoomUpdateReceipt::Accepted
        );
        assert!(matches!(
            boom.advance(&collection, 1.0 / 30.0).unwrap(),
            Some(HostKinematicBoomTick::Advanced {
                identity,
                sequence: 5,
                ..
            }) if identity == receipt.identity
        ));

        let replacement_possession = entities.possess(guid).unwrap();
        let replacement = boom
            .start(HostKinematicBoomStartRequest {
                possession_generation: replacement_possession.possession_generation,
                guid,
                entity_generation: replacement_possession.entity_generation,
                initial_reach: 4.0,
                minimum_reach: 1.2,
                maximum_reach: 8.0,
                input_sequence: 1,
                view_direction: [0.0, -1.0, 0.0],
                cumulative_zoom_displacement: 0.0,
                projection_revision: 1,
                clearance_radius: 0.25,
            })
            .unwrap();
        assert!(replacement.identity.boom_generation > receipt.identity.boom_generation);
        assert!(
            !boom.stop(receipt.identity),
            "a stale stop must preserve the replacement"
        );
        let replacement_collection = entities
            .tick_physical_collection(
                1.0 / 30.0,
                started_at + std::time::Duration::from_millis(33),
            )
            .unwrap();
        assert!(matches!(
            boom.advance(&replacement_collection, 1.0 / 30.0).unwrap(),
            Some(HostKinematicBoomTick::Reseeded { identity, .. })
                if identity == replacement.identity
        ));

        entities
            .release_possession(started_at + std::time::Duration::from_millis(34))
            .unwrap();
        let released_collection = entities
            .tick_physical_collection(
                1.0 / 30.0,
                started_at + std::time::Duration::from_millis(66),
            )
            .unwrap();
        assert!(
            boom.advance(&released_collection, 1.0 / 30.0)
                .unwrap()
                .is_none()
        );
        assert!(
            boom.advance(&released_collection, 1.0 / 30.0)
                .unwrap()
                .is_none()
        );
        assert_eq!(simulation.registered_body_count(), body_count);
    }

    #[test]
    fn host_boom_rejects_a_possessed_target_after_collision_interest_moves() {
        use crate::host_kinematic_boom_runtime::{
            HostKinematicBoomRuntime, HostKinematicBoomStartRequest,
        };

        let (simulation, entities, guid) = walking_runtime();
        let entities = Arc::new(entities);
        let possession = entities.possess(guid).unwrap();
        let session = simulation.reserve_interest_session();
        simulation
            .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
                session,
                revision: 1,
                landblock_ids: vec!["0xdb55ffff".to_owned()],
            })
            .unwrap();
        let boom =
            HostKinematicBoomRuntime::new(Arc::clone(&entities), Arc::clone(&simulation)).unwrap();

        let error = boom
            .start(HostKinematicBoomStartRequest {
                possession_generation: possession.possession_generation,
                guid,
                entity_generation: possession.entity_generation,
                initial_reach: 4.0,
                minimum_reach: 1.2,
                maximum_reach: 4.25,
                input_sequence: 1,
                view_direction: [0.0, -1.0, 0.0],
                cumulative_zoom_displacement: 0.0,
                projection_revision: 1,
                clearance_radius: 0.25,
            })
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "kinematic boom target is outside current simulation interest"
        );
    }

    #[test]
    fn host_boom_retains_session_while_control_work_is_limited() {
        use crate::host_kinematic_boom_runtime::{
            HostKinematicBoomDiagnostics, HostKinematicBoomIntentRequest, HostKinematicBoomRuntime,
            HostKinematicBoomStartRequest, HostKinematicBoomTick, HostKinematicBoomUpdateReceipt,
        };
        use holtburger_core::{KinematicBoomProfile, KinematicBoomProfileDefinition};

        let (simulation, entities, guid) = walking_runtime();
        let entities = Arc::new(entities);
        let possession = entities.possess(guid).unwrap();
        let profile = KinematicBoomProfile::new(KinematicBoomProfileDefinition {
            minimum_reach: 1.2,
            maximum_reach: 8.0,
            vertical_pivot_half_life: 0.08,
            maximum_vertical_pivot_lag: 0.30,
            clearance_recovery_half_life: 0.10,
            clearance_hysteresis: 0.05,
            maximum_control_leg_displacement: 0.01,
            maximum_control_legs: 1,
            surface_clearance: 0.000_5,
            transit: FreeSphereConfig {
                maximum_substep_distance: 0.25,
                maximum_substeps: 64,
                maximum_contact_passes: 8,
                separation_epsilon: 0.000_5,
            },
        })
        .unwrap();
        let boom = HostKinematicBoomRuntime::with_profile(
            Arc::clone(&entities),
            Arc::clone(&simulation),
            profile,
        );
        let receipt = boom
            .start(HostKinematicBoomStartRequest {
                possession_generation: possession.possession_generation,
                guid,
                entity_generation: possession.entity_generation,
                initial_reach: 4.0,
                minimum_reach: 1.2,
                maximum_reach: 8.0,
                input_sequence: 1,
                view_direction: [0.0, -1.0, 0.0],
                cumulative_zoom_displacement: 0.0,
                projection_revision: 1,
                clearance_radius: 0.25,
            })
            .unwrap();
        assert_eq!(
            boom.set_intent(HostKinematicBoomIntentRequest {
                identity: receipt.identity,
                input_sequence: 2,
                view_direction: [0.0, 1.0, 0.0],
                cumulative_zoom_displacement: 0.0,
            })
            .unwrap(),
            HostKinematicBoomUpdateReceipt::Accepted
        );
        let collection = entities
            .tick_physical_collection(1.0 / 30.0, Instant::now())
            .unwrap();
        assert!(matches!(
            boom.advance(&collection, 1.0 / 30.0).unwrap(),
            Some(HostKinematicBoomTick::Reseeded {
                identity,
                sequence: 1,
                ..
            }) if identity == receipt.identity
        ));
        assert!(matches!(
            boom.advance(&collection, 1.0 / 30.0).unwrap(),
            Some(HostKinematicBoomTick::Advanced {
                identity,
                sequence: 2,
                diagnostics: HostKinematicBoomDiagnostics { control_legs: 1, .. },
                ..
            }) if identity == receipt.identity
        ));
        assert!(matches!(
            boom.advance(&collection, 1.0 / 30.0).unwrap(),
            Some(HostKinematicBoomTick::Advanced {
                identity,
                sequence: 3,
                ..
            }) if identity == receipt.identity
        ));
        assert_eq!(simulation.registered_body_count(), 1);
    }
}
