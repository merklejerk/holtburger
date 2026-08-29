//! Source-neutral frontend projection and dynamic-entity delivery values.

use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, ParentLocation, Placement};
use holtburger_world::motion::{MotionClipCompletion, PlayingMotionClip};
use holtburger_world::{
    ContactState, EffectiveEntityPhysicsState, EntityAppearance, EntityPlacement,
    PhysicalBodyParticipation, SpatialSampleMode,
};
use serde::{Deserialize, Serialize};

use crate::{
    DynamicEntityCategory, DynamicEntityContent, DynamicEntityProjectionInput,
    DynamicEntitySpatialMembership, DynamicEntityWorldProjection,
};

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
    /// Producer-resolved frontend category used by presentation participation policy.
    pub category: DynamicEntityCategory,
    /// Setup, sound, and physics-effect identities.
    pub content: DynamicEntityContent,
    /// Lossless ordered material and part substitutions.
    pub appearance: EntityAppearance,
    /// Uniform root presentation scale.
    pub object_scale: f32,
    /// Producer-resolved radar presentation facts consumed by overhead-map blips.
    pub radar: crate::DynamicEntityRadarFacts,
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

/// Serializable mutually exclusive world-motion or attachment placement.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DynamicEntityPlacementView {
    /// Canonical pose, support, and sampling state owned by the solver scene.
    World {
        /// Current accepted root pose; its cell ID is also the current residency.
        pose: WorldPosition,
        /// Complete source-domain membership accepted atomically with `pose`.
        spatial_membership: DynamicEntitySpatialMembership,
        /// Current solver/server support classification.
        contact: DynamicEntityContactView,
        /// Current sparse sampling behavior.
        sample_mode: DynamicEntitySampleModeView,
    },
    /// Parent-owned transform plus the held item's own placement pose.
    Attached {
        /// Live parent entity identity.
        parent: Guid,
        /// Named holding location on the parent's setup.
        parent_location: ParentLocation,
        /// Placement-frame key applied to the child's setup.
        placement: Placement,
    },
}

/// Producer-neutral facts accepted by the pure view projector.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityViewSource {
    /// Producer-composition generation guarding async realization work.
    pub generation: u64,
    /// Producer-resolved frontend category; the source-neutral projector never classifies.
    pub category: DynamicEntityCategory,
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
    /// Producer-resolved radar presentation facts consumed by overhead-map blips.
    pub radar: crate::DynamicEntityRadarFacts,
    /// Current mutually exclusive solver state or parent-owned attachment.
    pub placement: EntityPlacement<DynamicEntityWorldProjection>,
    /// Clip the producer's playback currently has this entity playing.
    pub playing_clip: Option<PlayingMotionClip>,
}

impl DynamicEntityViewSource {
    /// Adapts the shared Explorer/body join without leaking producer registry state.
    ///
    /// Playback is a third producer alongside semantics and the body, so it arrives beside the
    /// definition/body join rather than inside it.
    pub fn from_projection(
        generation: u64,
        category: DynamicEntityCategory,
        input: DynamicEntityProjectionInput,
        playing_clip: Option<PlayingMotionClip>,
    ) -> Self {
        Self {
            generation,
            category,
            identity: DynamicEntityIdentityView {
                guid: input.identity.guid,
                wcid: input.identity.wcid,
                name: input.identity.name,
            },
            content: input.content,
            appearance: input.appearance,
            object_scale: input.object_scale,
            physics: input.physics,
            radar: input.radar,
            placement: input.placement,
            playing_clip,
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
    /// Clip this entity is playing right now, or `None` when it animates nothing.
    ///
    /// A level, not an edge: every view that reaches a consumer states the current clip, so a
    /// consumer that realizes an entity late — or re-realizes one from a snapshot — starts it
    /// playing without having witnessed the transition that selected it. This is the shape the
    /// retail protocol uses, where `CreateObject` carries `PhysicsDescriptionFlag.Movement` with
    /// the object's current motion state (`WorldObject_Networking.cs:306`).
    pub playing_clip: Option<DynamicEntityPlayingClip>,
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
    /// Ordinary far correction; consumers snap without treating it as a lifecycle reset.
    CorrectionSnap,
    /// Explicit discontinuous relocation; consumers snap and clear the previous path.
    Teleport,
    /// Forced authority reset; consumers snap and clear all prior correction state.
    Reset,
}

/// One authoritative entity root pose at a placed-path boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPathPoint {
    /// Root pose whose cell selector and coordinates become authoritative together.
    pub pose: WorldPosition,
    /// Complete source-domain membership accepted atomically with `pose`.
    pub spatial_membership: DynamicEntitySpatialMembership,
}

/// One placement-stable entity path leg ending at an authoritative root pose.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

/// The clip the host has one entity playing, projected for presentation.
///
/// Carries no frame number. Host and receiver both advance by `framerate x dt`, so a phase offset
/// never accumulates, and entering a clip re-anchors both at the same frame regardless.
///
/// Deliberately narrow: the receiver advances within this clip's window at render rate and obeys
/// its projected completion behavior, but never selects the next clip. Which clip follows is link
/// resolution against host state the receiver does not have, so a successor arrives only as a
/// later view.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPlayingClip {
    pub animation_id: u32,
    /// Rate to advance at. Negative plays the window backwards.
    pub framerate: f32,
    /// Inclusive traversal bounds, already resolved against the animation's frame count.
    pub low_frame: i32,
    pub high_frame: i32,
    /// Host-owned terminal behavior derived from the sequence's cyclic-tail boundary.
    pub completion: DynamicEntityClipCompletion,
}

impl From<PlayingMotionClip> for DynamicEntityPlayingClip {
    fn from(clip: PlayingMotionClip) -> Self {
        Self {
            animation_id: clip.animation_id,
            framerate: clip.framerate,
            low_frame: clip.low_frame,
            high_frame: clip.high_frame,
            completion: clip.completion.into(),
        }
    }
}

/// Presentation behavior when a projected motion clip reaches its far boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DynamicEntityClipCompletion {
    /// Retain the terminal pose until the host projects the successor clip.
    Hold,
    /// Re-enter the clip because it is part of the authoritative looping tail.
    Loop,
}

impl From<MotionClipCompletion> for DynamicEntityClipCompletion {
    fn from(completion: MotionClipCompletion) -> Self {
        match completion {
            MotionClipCompletion::Hold => Self::Hold,
            MotionClipCompletion::Loop => Self::Loop,
        }
    }
}

/// At most one ordered changed-entity publication for one host fixed tick.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityTickBatch {
    /// Host instant at which this fixed tick completed.
    pub host_time: DynamicEntityHostTime,
    /// Positive integrated playback duration, or zero for correction-only snap batches.
    pub duration_ms: f64,
    /// Entities whose accepted root path changed, in stable GUID order.
    pub advances: Vec<DynamicEntityAdvance>,
    /// Path-stable entities whose remaining frontend-reconstructible level changed.
    pub updates: Vec<Box<DynamicEntityView>>,
}

impl DynamicEntityTickBatch {
    /// Establishes one nonempty, disjoint, stable publication without retained delivery history.
    pub fn new(
        host_time: DynamicEntityHostTime,
        duration_ms: f64,
        mut advances: Vec<DynamicEntityAdvance>,
        mut updates: Vec<Box<DynamicEntityView>>,
    ) -> Option<Self> {
        advances.sort_by_key(|advance| advance.entity.identity.guid);
        updates.sort_by_key(|entity| entity.identity.guid);
        assert!(
            advances
                .windows(2)
                .all(|pair| pair[0].entity.identity.guid != pair[1].entity.identity.guid),
            "dynamic tick contains duplicate advance GUIDs"
        );
        assert!(
            updates
                .windows(2)
                .all(|pair| pair[0].identity.guid != pair[1].identity.guid),
            "dynamic tick contains duplicate update GUIDs"
        );
        assert!(
            !advances.iter().any(|advance| updates
                .binary_search_by_key(&advance.entity.identity.guid, |entity| {
                    entity.identity.guid
                })
                .is_ok()),
            "dynamic tick GUID cannot be both advanced and updated"
        );
        (!advances.is_empty() || !updates.is_empty()).then_some(Self {
            host_time,
            duration_ms,
            advances,
            updates,
        })
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
    Ticked { batch: DynamicEntityTickBatch },
}

/// Projects one semantic/body join without consulting either producer registry.
pub fn project_dynamic_entity_view(source: DynamicEntityViewSource) -> DynamicEntityView {
    let presentation = source.physics.presentation;
    let (placement, participation) = match source.placement {
        EntityPlacement::World(world) => (
            DynamicEntityPlacementView::World {
                pose: world.body.runtime_pose,
                spatial_membership: world.spatial_membership,
                contact: world.body.contact.into(),
                sample_mode: world.body.sample_mode.into(),
            },
            world.participation,
        ),
        EntityPlacement::Attached(attachment) => (
            DynamicEntityPlacementView::Attached {
                parent: attachment.parent,
                parent_location: attachment.location,
                placement: attachment.placement,
            },
            PhysicalBodyParticipation::PoseOnly,
        ),
    };
    DynamicEntityView {
        generation: source.generation,
        identity: source.identity,
        presentation: DynamicEntityPresentationView {
            category: source.category,
            content: source.content,
            appearance: source.appearance,
            object_scale: source.object_scale,
            radar: source.radar,
        },
        physics: DynamicEntityPhysicsView {
            semantic_mask: source.physics.semantic.bits(),
            participation: participation.into(),
            no_draw: presentation.no_draw,
            hidden: presentation.hidden,
            cloaked: presentation.cloaked,
            lighting: presentation.lighting,
            default_animation: presentation.default_animation,
            default_script: presentation.default_script,
        },
        placement,
        playing_clip: source.playing_clip.map(DynamicEntityPlayingClip::from),
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
