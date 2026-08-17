//! Source-neutral frontend projection and recoverable dynamic-entity delivery values.

use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_world::entity::{EntityMotionDirective, EntityMotionSnapshot};
use holtburger_world::{
    ContactState, EffectiveEntityPhysicsState, EntityAppearance, PhysicalBodyParticipation,
    RuntimeSpatialBodyView, SpatialSampleMode,
};
use serde::{Deserialize, Serialize};

use crate::{DynamicEntityContent, DynamicEntityProjectionInput};

/// One monotonic host instant used to align snapshot/event facts with frontend time.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityHostTime {
    /// Seconds elapsed since the composition-local host origin.
    pub seconds: f64,
}

impl DynamicEntityHostTime {
    /// Accepts one finite nonnegative monotonic offset.
    pub fn new(seconds: f64) -> Option<Self> {
        (seconds.is_finite() && seconds >= 0.0).then_some(Self { seconds })
    }
}

/// Producer identity facts required by presentation and Explorer lifecycle UX.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityIdentityView {
    /// Live producer-owned identity.
    pub guid: Guid,
    /// Static template identity.
    pub wcid: u32,
    /// Producer-resolved display name.
    pub name: String,
}

/// Immutable visual and behavior identities consumed by frontend realization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPresentationView {
    /// Setup, motion, sound, and physics-effect identities.
    pub content: DynamicEntityContent,
    /// Lossless ordered material and part substitutions.
    pub appearance: EntityAppearance,
    /// Uniform root presentation scale.
    pub object_scale: f32,
}

/// Serializable projection of pose-only versus physical realization.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalBodyParticipationView {
    PoseOnly,
    Physical,
}

/// Presentation-owned consequences plus current local physical participation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPhysicsView {
    /// Complete semantic state mask retained without frontend reinterpretation.
    pub semantic_mask: u32,
    /// Whether the canonical pose body currently carries local physical state.
    pub participation: PhysicalBodyParticipationView,
    /// Ordinary rendering is disabled.
    pub no_draw: bool,
    /// Presentation and locally observable interaction are hidden.
    pub hidden: bool,
    /// Cloaked translucency policy is active.
    pub cloaked: bool,
    /// Authored lighting participates in presentation.
    pub lighting: bool,
    /// The setup's default animation should run.
    pub default_animation: bool,
    /// The setup's default physics script should run.
    pub default_script: bool,
}

/// Serializable support classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DynamicEntityContactView {
    Unknown,
    Airborne,
    Sliding,
    Grounded,
}

/// Serializable sparse-pose sampling classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DynamicEntitySampleModeView {
    AuthoritativeOnly,
    SimulatingMotionState,
    SimulatingVelocity,
    Suspended,
}

/// Canonical pose, kinematics, support, and sampling state owned by the solver scene.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPlacementView {
    /// Current accepted root pose; its cell ID is also the current residency.
    pub pose: WorldPosition,
    /// Current world-space linear velocity.
    pub velocity: Vector3,
    /// Current world-space linear acceleration.
    pub acceleration: Vector3,
    /// Current world-space angular velocity.
    pub omega: Vector3,
    /// Current solver/server support classification.
    pub contact: DynamicEntityContactView,
    /// Current sparse sampling behavior.
    pub sample_mode: DynamicEntitySampleModeView,
}

/// Semantic motion snapshot retained without exposing raw motion-table assets.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityMotionView {
    /// Current interpreted stance value.
    pub current_style: Option<u16>,
    /// Current interpreted forward command.
    pub forward_command: Option<u16>,
    /// Current interpreted sidestep command.
    pub sidestep_command: Option<u16>,
    /// Current interpreted turn command.
    pub turn_command: Option<u16>,
    /// Authored forward command scale.
    pub forward_speed: Option<f32>,
    /// Authored sidestep command scale.
    pub sidestep_speed: Option<f32>,
    /// Authored turn command scale.
    pub turn_speed: Option<f32>,
    /// Optional semantic turn directive.
    pub directive: Option<DynamicEntityMotionDirectiveView>,
}

/// Serializable semantic directive whose source identities remain producer-neutral.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DynamicEntityMotionDirectiveView {
    TurnToHeading {
        desired_heading: f32,
        speed: f32,
    },
    TurnToObject {
        target: Guid,
        desired_heading: Option<f32>,
        speed: f32,
    },
}

/// Producer-neutral facts accepted by the pure view projector.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityViewSource {
    /// Producer-composition generation guarding async realization work.
    pub generation: u64,
    /// Frontend-relevant identity without solver-only template category.
    pub identity: DynamicEntityIdentityView,
    /// Immutable presentation and behavior identities.
    pub content: DynamicEntityContent,
    /// Lossless ordered appearance substitutions.
    pub appearance: EntityAppearance,
    /// Validated root scale.
    pub object_scale: f32,
    /// Complete semantic physics state and once-derived consequences.
    pub physics: EffectiveEntityPhysicsState,
    /// Current canonical body facts.
    pub body: RuntimeSpatialBodyView,
    /// Current local physical participation.
    pub participation: PhysicalBodyParticipation,
}

impl DynamicEntityViewSource {
    /// Adapts the shared Explorer/body join without leaking producer registry state.
    pub fn from_projection(generation: u64, input: DynamicEntityProjectionInput) -> Self {
        Self {
            generation,
            identity: DynamicEntityIdentityView {
                guid: input.identity.guid,
                wcid: input.identity.wcid,
                name: input.identity.name,
            },
            content: input.content,
            appearance: input.appearance,
            object_scale: input.object_scale,
            physics: input.physics,
            body: input.body,
            participation: input.participation,
        }
    }
}

/// Complete frontend-reconstructible view of one current dynamic entity generation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityView {
    /// Producer-composition generation guarding late asynchronous realization.
    pub generation: u64,
    /// Live identity and display facts.
    pub identity: DynamicEntityIdentityView,
    /// Immutable presentation inputs.
    pub presentation: DynamicEntityPresentationView,
    /// Complete semantic presentation consequences and physical status.
    pub physics: DynamicEntityPhysicsView,
    /// Current canonical placement and kinematics.
    pub placement: DynamicEntityPlacementView,
    /// Current semantic motion, if any.
    pub motion: Option<DynamicEntityMotionView>,
}

/// One complete replacement snapshot; no replay history is required to reconstruct it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntitySnapshot {
    /// Host instant paired with this atomic source snapshot.
    pub host_time: DynamicEntityHostTime,
    /// Current entities in stable GUID order.
    pub entities: Vec<DynamicEntityView>,
}

impl DynamicEntitySnapshot {
    /// Sorts one complete population by producer identity before publication.
    pub fn new(host_time: DynamicEntityHostTime, mut entities: Vec<DynamicEntityView>) -> Self {
        entities.sort_by_key(|entity| entity.identity.guid);
        Self {
            host_time,
            entities,
        }
    }
}

/// Why one accepted placement path supersedes frontend interpolation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DynamicEntityPlacementAdvanceKind {
    /// Ordinary fixed-tick integration; render frames interpolate the complete accepted path.
    Integrated,
    /// Explicit discontinuous relocation; consumers snap and clear the previous path.
    Teleport,
    /// Forced authority reset; consumers snap and clear all prior correction state.
    Reset,
}

/// One authoritative entity root pose at a placed-path boundary.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPathPoint {
    /// Root pose whose cell selector and coordinates become authoritative together.
    pub pose: WorldPosition,
}

/// One placement-stable entity path leg ending at an authoritative root pose.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPathLeg {
    /// Strictly increasing normalized fixed-tick fraction in `(0, 1]`.
    pub end_fraction: f32,
    /// Root pose committed at this exact boundary.
    pub end: DynamicEntityPathPoint,
}

/// Complete accepted entity root path through one host fixed tick.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPlacedPath {
    /// Authoritative root pose at normalized fraction zero.
    pub initial: DynamicEntityPathPoint,
    /// Nonempty placed geometry ending at normalized fraction one.
    pub legs: Vec<DynamicEntityPathLeg>,
}

/// One changed current entity plus the path that produced its accepted placement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityAdvance {
    /// Complete current semantic/body projection for snapshot convergence and UI state.
    pub entity: Box<DynamicEntityView>,
    /// Correction semantics applied before consuming `path`.
    pub kind: DynamicEntityPlacementAdvanceKind,
    /// Host-accepted path evaluated by presentation at render cadence.
    pub path: DynamicEntityPlacedPath,
}

/// At most one ordered changed-entity publication for one host fixed tick.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityAdvanceBatch {
    /// Host instant at which this fixed tick completed.
    pub host_time: DynamicEntityHostTime,
    /// Positive integrated playback duration, or zero for correction-only snap batches.
    pub duration_ms: f64,
    /// Changed current generations in stable GUID order.
    pub advances: Vec<DynamicEntityAdvance>,
}

impl DynamicEntityAdvanceBatch {
    /// Establishes stable publication order without creating retained delivery history.
    pub fn new(
        host_time: DynamicEntityHostTime,
        duration_ms: f64,
        mut advances: Vec<DynamicEntityAdvance>,
    ) -> Self {
        advances.sort_by_key(|advance| advance.entity.identity.guid);
        Self {
            host_time,
            duration_ms,
            advances,
        }
    }
}

/// Minimal focused delivery grammar repaired by requesting another complete snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DynamicEntityEvent {
    Snapshot { snapshot: DynamicEntitySnapshot },
    Upserted { entity: Box<DynamicEntityView> },
    Removed { guid: Guid, generation: u64 },
    Advanced { batch: DynamicEntityAdvanceBatch },
}

/// Projects one semantic/body join without consulting either producer registry.
pub fn project_dynamic_entity_view(source: DynamicEntityViewSource) -> DynamicEntityView {
    let presentation = source.physics.presentation;
    DynamicEntityView {
        generation: source.generation,
        identity: source.identity,
        presentation: DynamicEntityPresentationView {
            content: source.content,
            appearance: source.appearance,
            object_scale: source.object_scale,
        },
        physics: DynamicEntityPhysicsView {
            semantic_mask: source.physics.semantic.bits(),
            participation: source.participation.into(),
            no_draw: presentation.no_draw,
            hidden: presentation.hidden,
            cloaked: presentation.cloaked,
            lighting: presentation.lighting,
            default_animation: presentation.default_animation,
            default_script: presentation.default_script,
        },
        placement: DynamicEntityPlacementView {
            pose: source.body.runtime_pose,
            velocity: source.body.velocity,
            acceleration: source.body.acceleration,
            omega: source.body.omega,
            contact: source.body.contact.into(),
            sample_mode: source.body.sample_mode.into(),
        },
        motion: source.body.motion_state.map(Into::into),
    }
}

impl From<PhysicalBodyParticipation> for PhysicalBodyParticipationView {
    fn from(value: PhysicalBodyParticipation) -> Self {
        match value {
            PhysicalBodyParticipation::PoseOnly => Self::PoseOnly,
            PhysicalBodyParticipation::Physical => Self::Physical,
        }
    }
}

impl From<ContactState> for DynamicEntityContactView {
    fn from(value: ContactState) -> Self {
        match value {
            ContactState::Unknown => Self::Unknown,
            ContactState::Airborne => Self::Airborne,
            ContactState::Sliding => Self::Sliding,
            ContactState::Grounded => Self::Grounded,
        }
    }
}

impl From<SpatialSampleMode> for DynamicEntitySampleModeView {
    fn from(value: SpatialSampleMode) -> Self {
        match value {
            SpatialSampleMode::AuthoritativeOnly => Self::AuthoritativeOnly,
            SpatialSampleMode::SimulatingMotionState => Self::SimulatingMotionState,
            SpatialSampleMode::SimulatingVelocity => Self::SimulatingVelocity,
            SpatialSampleMode::Suspended => Self::Suspended,
        }
    }
}

impl From<EntityMotionSnapshot> for DynamicEntityMotionView {
    fn from(value: EntityMotionSnapshot) -> Self {
        Self {
            current_style: value.current_style.map(|style| style.interpreted()),
            forward_command: value.forward_command.map(|command| command.raw()),
            sidestep_command: value.sidestep_command.map(|command| command.raw()),
            turn_command: value.turn_command.map(|command| command.raw()),
            forward_speed: value.forward_speed.map(|speed| speed.to_f32()),
            sidestep_speed: value.sidestep_speed.map(|speed| speed.to_f32()),
            turn_speed: value.turn_speed.map(|speed| speed.to_f32()),
            directive: value.directive.map(Into::into),
        }
    }
}

impl From<EntityMotionDirective> for DynamicEntityMotionDirectiveView {
    fn from(value: EntityMotionDirective) -> Self {
        match value {
            EntityMotionDirective::TurnToHeading {
                desired_heading,
                speed,
            } => Self::TurnToHeading {
                desired_heading: desired_heading.to_f32(),
                speed: speed.to_f32(),
            },
            EntityMotionDirective::TurnToObject {
                target,
                desired_heading,
                speed,
            } => Self::TurnToObject {
                target,
                desired_heading: desired_heading.map(|heading| heading.to_f32()),
                speed: speed.to_f32(),
            },
        }
    }
}
