//! Source-neutral frontend projection and dynamic-entity delivery values.

use crate::placed_motion::{interpolate_rotation, present_placed_motion_pose};
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::PhysicsState;
use holtburger_common::{Guid, ParentLocation, Placement, Quaternion};
use holtburger_world::motion::{
    MotionClipCompletion, MotionPlayback, MotionPlaybackLayer, MotionPresentation,
    OrdinaryMotionActivity,
};
use holtburger_world::{
    ContactState, EffectiveEntityPhysicsState, EntityAppearance, EntityPlacement,
    PhysicalBodyParticipation, SpatialSampleMode,
};
use holtburger_world::{PlacedMotionPath, PlacedMotionPoint};
use serde::{Deserialize, Serialize};

use crate::{
    DynamicEntityContent, DynamicEntityPresentationClass, DynamicEntityProjectionInput,
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
}

/// Producer-resolved facts presented to a person rather than used as entity identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityDisplayView {
    /// Authored display name; an empty string represents an unnamed entity.
    pub name: String,
    /// Optional nonnegative authored level.
    pub level: Option<u32>,
}

/// Immutable visual and behavior identities consumed by frontend realization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPresentationView {
    /// Producer-resolved entity class used by frontend presentation participation policy.
    pub entity_class: DynamicEntityPresentationClass,
    /// Setup, sound, and physics-effect identities.
    pub content: DynamicEntityContent,
    /// Lossless ordered material and part substitutions.
    pub appearance: EntityAppearance,
    /// Uniform root presentation scale.
    pub object_scale: f32,
    /// Requested setup placement, falling back to Default when the asset has no such key.
    pub placement_frame: u32,
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

/// Typed simulation-relevant physics flags projected once from `PhysicsState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPhysicsFlags {
    /// Emit collision notifications when contacting other bodies.
    pub report_collisions: bool,
    /// Integrate vertical gravitational acceleration.
    pub gravity: bool,
    /// Allow other bodies to pass through without blocking.
    pub ethereal: bool,
    /// Suppress collision response and peer collision reports.
    pub ignore_collisions: bool,
    /// Participate as a projectile body.
    pub missile: bool,
    /// Resolve impacts without elastic bounce.
    pub inelastic: bool,
    /// Apply creature cliff/ledge protection.
    pub edge_slide: bool,
    /// Pause physical integration.
    pub frozen: bool,
}

impl DynamicEntityPhysicsFlags {
    /// Projects the named simulation flags from an authoritative `PhysicsState` mask.
    pub const fn from_physics_state(state: PhysicsState) -> Self {
        Self {
            report_collisions: state.contains(PhysicsState::REPORT_COLLISIONS),
            gravity: state.contains(PhysicsState::GRAVITY),
            ethereal: state.contains(PhysicsState::ETHEREAL),
            ignore_collisions: state.contains(PhysicsState::IGNORE_COLLISIONS),
            missile: state.contains(PhysicsState::MISSILE),
            inelastic: state.contains(PhysicsState::INELASTIC),
            edge_slide: state.contains(PhysicsState::EDGE_SLIDE),
            frozen: state.contains(PhysicsState::FROZEN),
        }
    }

    /// Merges these typed flags into `base`, preserving unrelated bits (lighting, BSP, etc.).
    pub fn apply_to(self, mut base: PhysicsState) -> PhysicsState {
        base.set(PhysicsState::REPORT_COLLISIONS, self.report_collisions);
        base.set(PhysicsState::GRAVITY, self.gravity);
        base.set(PhysicsState::ETHEREAL, self.ethereal);
        base.set(PhysicsState::IGNORE_COLLISIONS, self.ignore_collisions);
        base.set(PhysicsState::MISSILE, self.missile);
        base.set(PhysicsState::INELASTIC, self.inelastic);
        base.set(PhysicsState::EDGE_SLIDE, self.edge_slide);
        base.set(PhysicsState::FROZEN, self.frozen);
        base
    }
}

/// Presentation-owned consequences plus current local physical participation.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityPhysicsView {
    /// Named simulation-relevant flags derived from `PhysicsState`.
    pub flags: DynamicEntityPhysicsFlags,
    /// Whether the canonical pose body currently carries local physical state.
    pub participation: PhysicalBodyParticipationView,
    /// Ordinary rendering is disabled.
    pub no_draw: bool,
    /// Presentation and locally observable interaction are hidden.
    pub hidden: bool,
    /// Cloaked translucency policy is active.
    pub cloaked: bool,
    /// Current whole-object translucency in the inclusive unit interval.
    pub translucency: f32,
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
    /// Producer-resolved presentation class; the source-neutral projector never classifies.
    pub presentation_class: DynamicEntityPresentationClass,
    /// Frontend-relevant identity without solver-only template category.
    pub identity: DynamicEntityIdentityView,
    /// Producer-resolved display facts.
    pub display: DynamicEntityDisplayView,
    /// Immutable presentation and behavior identities.
    pub content: DynamicEntityContent,
    /// Lossless ordered appearance substitutions.
    pub appearance: EntityAppearance,
    /// Validated root scale.
    pub object_scale: f32,
    /// Requested setup placement, falling back to Default when the asset has no such key.
    pub placement_frame: u32,
    /// Validated current whole-object translucency in the inclusive unit interval.
    pub translucency: f32,
    /// Complete semantic physics state and once-derived consequences.
    pub physics: EffectiveEntityPhysicsState,
    /// Producer-resolved radar presentation facts consumed by overhead-map blips.
    pub radar: crate::DynamicEntityRadarFacts,
    /// Current mutually exclusive solver state or parent-owned attachment.
    pub placement: EntityPlacement<DynamicEntityWorldProjection>,
    /// Current motion-derived presentation level.
    pub motion: Option<MotionPlayback>,
}

impl DynamicEntityViewSource {
    /// Adapts the shared Explorer/body join without leaking producer registry state.
    ///
    /// Playback is a third producer alongside semantics and the body, so it arrives beside the
    /// definition/body join rather than inside it.
    pub fn from_projection(
        generation: u64,
        presentation_class: DynamicEntityPresentationClass,
        input: DynamicEntityProjectionInput,
        motion: Option<MotionPlayback>,
    ) -> Self {
        Self {
            generation,
            presentation_class,
            identity: DynamicEntityIdentityView {
                guid: input.identity.guid,
                wcid: input.identity.wcid,
            },
            display: dynamic_entity_display_view(
                input.identity.name,
                input.level,
                input.identity.guid,
            ),
            content: input.content,
            appearance: input.appearance,
            object_scale: input.object_scale,
            // Explorer world objects retain their explicit resting-pose policy.
            placement_frame: match &input.placement {
                EntityPlacement::World(_) => holtburger_common::Placement::Resting as u32,
                EntityPlacement::Attached(attachment) => attachment.placement as u32,
            },
            translucency: input.translucency,
            physics: input.physics,
            radar: input.radar,
            placement: input.placement,
            motion,
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
    /// Person-facing name and optional authored level.
    pub display: DynamicEntityDisplayView,
    /// Immutable presentation inputs.
    pub presentation: DynamicEntityPresentationView,
    /// Complete semantic presentation consequences and physical status.
    pub physics: DynamicEntityPhysicsView,
    /// Current canonical placement and kinematics.
    pub placement: DynamicEntityPlacementView,
    /// Motion-derived presentation right now, or `None` when it animates nothing.
    ///
    /// A level, not an edge: every view states the current presentation, so a consumer that
    /// realizes an entity late — or re-realizes one from a snapshot — reconstructs it without
    /// having witnessed the transition that selected it. This is the shape the retail protocol
    /// uses, where `CreateObject` carries `PhysicsDescriptionFlag.Movement` with the object's
    /// current motion state (`WorldObject_Networking.cs:306`).
    pub motion: Option<DynamicEntityMotion>,
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

impl DynamicEntityPlacedPath {
    /// Projects every accepted physical boundary, preserving placement and the shared
    /// shortest-arc endpoint rotation interpolation used by both client adapters.
    pub fn from_motion(
        path: &PlacedMotionPath,
        previous_rotation: Quaternion,
        current_rotation: Quaternion,
    ) -> Result<DynamicEntityPlacedPath> {
        Ok(DynamicEntityPlacedPath {
            initial: serialize_entity_path_point(path, path.initial(), previous_rotation)?,
            legs: path
                .legs()
                .iter()
                .map(|leg| {
                    Ok(DynamicEntityPathLeg {
                        end_fraction: leg.end_fraction(),
                        end: serialize_entity_path_point(
                            path,
                            leg.end(),
                            interpolate_rotation(
                                previous_rotation,
                                current_rotation,
                                leg.end_fraction(),
                            )?,
                        )?,
                    })
                })
                .collect::<Result<Vec<_>>>()?,
        })
    }
}

fn serialize_entity_path_point(
    path: &PlacedMotionPath,
    point: &PlacedMotionPoint,
    rotation: Quaternion,
) -> Result<DynamicEntityPathPoint> {
    Ok(DynamicEntityPathPoint {
        pose: present_placed_motion_pose(path, point, rotation)?,
        spatial_membership: DynamicEntitySpatialMembership::from(point.placement()),
    })
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

/// Independent playback descriptions; visual priority and clocks remain frontend-owned.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityMotion {
    /// Accepted gameplay resting target, distinct from social emotes.
    pub rest_posture: Option<holtburger_world::motion::RestPosture>,
    /// Whether independent movement is commanded now, rather than merely retaining an idle/stop clip.
    pub locomotion_command_active: bool,
    /// Accepted ordinary command/action playback.
    pub ordinary: Option<DynamicEntityMotionLayer>,
    /// Independent locomotion, including while hidden by a gesture.
    pub locomotion: Option<DynamicEntityMotionLayer>,
    /// Semantic activity consumed by client policy and frontend visual priority.
    pub activity: DynamicEntityMotionActivity,
}

/// Source-owned meaning of the ordinary track, not a selected visual layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DynamicEntityMotionActivity {
    Locomotion,
    Gesture,
    /// Pickup/drop reach, retained through its authored return transition.
    Reach,
    /// Social action or retained pose, classified by the shared motion owner.
    Emote,
    Explicit,
}

/// One clip occurrence with receiver-owned phase.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityMotionLayer {
    /// Opaque decimal identity avoids narrowing a host u64 through JavaScript numbers.
    pub playback_id: String,
    /// Complete current clip description.
    pub clip: DynamicEntityClip,
}

impl From<MotionPlaybackLayer> for DynamicEntityMotionLayer {
    fn from(layer: MotionPlaybackLayer) -> Self {
        Self {
            playback_id: layer.playback_id.to_string(),
            clip: layer.clip.into(),
        }
    }
}

impl From<MotionPlayback> for DynamicEntityMotion {
    fn from(playback: MotionPlayback) -> Self {
        Self {
            rest_posture: playback.rest_posture,
            locomotion_command_active: playback.locomotion_command_active,
            ordinary: playback.ordinary.map(Into::into),
            locomotion: playback.locomotion.map(Into::into),
            activity: match playback.activity {
                OrdinaryMotionActivity::Locomotion => DynamicEntityMotionActivity::Locomotion,
                OrdinaryMotionActivity::Gesture => DynamicEntityMotionActivity::Gesture,
                OrdinaryMotionActivity::Reach => DynamicEntityMotionActivity::Reach,
                OrdinaryMotionActivity::Emote => DynamicEntityMotionActivity::Emote,
                OrdinaryMotionActivity::Explicit => DynamicEntityMotionActivity::Explicit,
            },
        }
    }
}

/// Current motion-derived presentation level.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum DynamicEntityClip {
    /// Advancing clip whose local phase is intentionally not synchronized frame-by-frame.
    Playing {
        animation_id: u32,
        /// Rate to advance at. Negative plays the window backwards.
        framerate: f32,
        /// Inclusive traversal bounds, already resolved against the animation's frame count.
        low_frame: i32,
        high_frame: i32,
        /// Host-owned terminal behavior derived from the sequence's cyclic-tail boundary.
        completion: DynamicEntityClipCompletion,
    },
    /// Exact stationary pose used for snapshots, late realization, and reconciliation.
    Settled { animation_id: u32, frame: i32 },
}

impl DynamicEntityClip {
    /// Animation shared by either the moving or settled presentation state.
    pub const fn animation_id(self) -> u32 {
        match self {
            Self::Playing { animation_id, .. } | Self::Settled { animation_id, .. } => animation_id,
        }
    }
}

impl From<MotionPresentation> for DynamicEntityClip {
    fn from(presentation: MotionPresentation) -> Self {
        match presentation {
            MotionPresentation::Playing(clip) => Self::Playing {
                animation_id: clip.animation_id,
                framerate: clip.framerate,
                low_frame: clip.low_frame,
                high_frame: clip.high_frame,
                completion: clip.completion.into(),
            },
            MotionPresentation::Settled(pose) => Self::Settled {
                animation_id: pose.animation_id,
                frame: pose.frame,
            },
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
    /// Pose-stable entity levels, including membership refreshes without physical travel.
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
        display: source.display,
        presentation: DynamicEntityPresentationView {
            entity_class: source.presentation_class,
            content: source.content,
            appearance: source.appearance,
            object_scale: source.object_scale,
            placement_frame: source.placement_frame,
            radar: source.radar,
        },
        physics: DynamicEntityPhysicsView {
            flags: DynamicEntityPhysicsFlags::from_physics_state(source.physics.semantic),
            participation: participation.into(),
            no_draw: presentation.no_draw,
            hidden: presentation.hidden,
            cloaked: presentation.cloaked,
            translucency: source.translucency,
            lighting: presentation.lighting,
            default_animation: presentation.default_animation,
            default_script: presentation.default_script,
        },
        placement,
        motion: source.motion.map(DynamicEntityMotion::from),
    }
}

/// Validates raw producer display facts once at the shared projection boundary.
pub fn dynamic_entity_display_view(
    name: String,
    raw_level: Option<i32>,
    guid: Guid,
) -> DynamicEntityDisplayView {
    let level = raw_level.and_then(|level| match u32::try_from(level) {
        Ok(level) => Some(level),
        Err(_) => {
            log::warn!(
                "dynamic entity 0x{:08X} has negative display level {level}; treating it as absent",
                guid.0
            );
            None
        }
    });
    DynamicEntityDisplayView { name, level }
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

#[cfg(test)]
mod tests {
    use holtburger_common::Guid;
    use holtburger_common::properties::PhysicsState;

    use super::{DynamicEntityPhysicsFlags, dynamic_entity_display_view};

    #[test]
    fn display_level_preserves_absence_and_zero() {
        assert_eq!(
            dynamic_entity_display_view("Absent".to_owned(), None, Guid(1)).level,
            None
        );
        assert_eq!(
            dynamic_entity_display_view("Zero".to_owned(), Some(0), Guid(2)).level,
            Some(0)
        );
    }

    #[test]
    fn negative_display_level_becomes_absent() {
        assert_eq!(
            dynamic_entity_display_view("Invalid".to_owned(), Some(-1), Guid(3)).level,
            None
        );
    }

    #[test]
    fn physics_flags_round_trip_and_preserve_unrelated_bits() {
        let base = PhysicsState::GRAVITY
            | PhysicsState::ETHEREAL
            | PhysicsState::EDGE_SLIDE
            | PhysicsState::LIGHTING_ON
            | PhysicsState::HAS_PHYSICS_BSP;
        let mut flags = DynamicEntityPhysicsFlags::from_physics_state(base);
        assert!(flags.gravity);
        assert!(flags.ethereal);
        assert!(flags.edge_slide);
        assert!(!flags.report_collisions);
        assert!(!flags.ignore_collisions);
        assert!(!flags.missile);
        assert!(!flags.inelastic);
        assert!(!flags.frozen);

        flags.report_collisions = true;
        flags.gravity = false;
        flags.ignore_collisions = true;
        flags.missile = true;
        flags.inelastic = true;
        flags.edge_slide = false;
        flags.frozen = true;
        let updated = flags.apply_to(base);
        assert!(updated.contains(PhysicsState::REPORT_COLLISIONS));
        assert!(!updated.contains(PhysicsState::GRAVITY));
        assert!(updated.contains(PhysicsState::ETHEREAL));
        assert!(updated.contains(PhysicsState::IGNORE_COLLISIONS));
        assert!(updated.contains(PhysicsState::MISSILE));
        assert!(updated.contains(PhysicsState::INELASTIC));
        assert!(!updated.contains(PhysicsState::EDGE_SLIDE));
        assert!(updated.contains(PhysicsState::FROZEN));
        assert!(updated.contains(PhysicsState::LIGHTING_ON));
        assert!(updated.contains(PhysicsState::HAS_PHYSICS_BSP));
    }
}
