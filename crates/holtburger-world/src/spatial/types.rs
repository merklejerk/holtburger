use super::PhysicalBodyState;
use crate::entity::EntityMotionSnapshot;
use anyhow::Context;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, RigidTransform, Vector3};
use std::cmp::Ordering;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
/// Body-lifecycle ground classification, including the pre-classification `Unknown` state.
///
/// For bodies with local physics this is a projection of the solver-owned
/// [`GroundState`](crate::GroundState), written at exactly one place (the grounded tick commit);
/// for motion-snapshot bodies it is a server projection applied through
/// `SpatialScene::apply_runtime_body_contact`. The planned unification (spawned-entity plan,
/// 2026-08-16 reconciliation) makes `GroundState` the single persisted source once entity
/// corrections flow through the solver.
pub enum ContactState {
    #[default]
    Unknown,
    Airborne,
    /// A retained contact plane below the walkable threshold: the body is on a surface it
    /// cannot stand on, descending ballistically along it (retail `Contact && !OnWalkable`).
    Sliding,
    Grounded,
}

impl ContactState {
    /// Whether the body has physical contact, once classified.
    pub const fn contact(self) -> Option<bool> {
        match self {
            Self::Unknown => None,
            Self::Airborne => Some(false),
            Self::Sliding | Self::Grounded => Some(true),
        }
    }

    /// Whether the body has walkable support, once classified. `Sliding` answers `false`: the
    /// body is on a surface, but not one it can stand on.
    pub const fn walkable(self) -> Option<bool> {
        match self {
            Self::Unknown => None,
            Self::Airborne | Self::Sliding => Some(false),
            Self::Grounded => Some(true),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SpatialBodyId {
    Entity(Guid),
    LocalPlayer(Guid),
    Ephemeral(u64),
}

impl SpatialBodyId {
    pub const fn authoritative_guid(self) -> Option<Guid> {
        match self {
            Self::Entity(guid) | Self::LocalPlayer(guid) => Some(guid),
            Self::Ephemeral(_) => None,
        }
    }

    const fn ordering_key(self) -> (u8, u64) {
        match self {
            // Entity bodies precede the synthetic local-player body, which precedes app-owned
            // ephemeral bodies. This order is a fixed simulation contract, not enum declaration
            // order or hash-map iteration order.
            Self::Entity(guid) => (0, guid.0 as u64),
            Self::LocalPlayer(guid) => (1, guid.0 as u64),
            Self::Ephemeral(id) => (2, id),
        }
    }
}

impl PartialOrd for SpatialBodyId {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for SpatialBodyId {
    fn cmp(&self, other: &Self) -> Ordering {
        self.ordering_key().cmp(&other.ordering_key())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SpatialSampleMode {
    #[default]
    AuthoritativeOnly,
    SimulatingMotionState,
    SimulatingVelocity,
    Suspended,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelfPlayerDriveProjectionState {
    LocalGroundedDirectDrive,
    LocalAirborne,
    ServerControlled,
    AuthorityFrozen,
}

/// One complete producer-authoritative vector replacement.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct AuthoritativeBodyVectors {
    /// Producer-authoritative world-space linear velocity.
    pub velocity: Vector3,
    /// Producer-authoritative world-space linear acceleration.
    pub acceleration: Vector3,
    /// Producer-authoritative world-space angular velocity.
    pub omega: Vector3,
}

/// One producer sample shared by physical actuation and independent reference prediction.
#[derive(Debug, Clone, PartialEq)]
pub struct PhysicalBodyInput {
    /// Whether a remote body may capture a return target from contact alone. Server-classified
    /// projectiles stay excluded after local impact clears their current collision flags.
    capture_contact_return: bool,
    /// Authored target pose proposed with this input and committed with the body transaction.
    collision_pose: Option<crate::motion::AuthoredCollisionPose>,
    /// Source-owned suspension survives unavailable target geometry; consumed by recovery admission.
    pub(super) recovery_suspended: bool,
    /// Controller/response command for the actual body, sampled once per admitted collection.
    pub actuation: super::PhysicalBodyActuation,
    /// Independent authority/authored travel; absent when an autonomous input supplies neither.
    pub(super) reference: Option<PhysicalReferenceInput>,
}

/// One resolved ordinary/reconciled movement request and its independent nominal continuation.
pub struct PreparedBodyMovement {
    /// Actual forces, motor target or kinematic flight travel, launch, and heading for the step.
    pub actuation: super::ContactStepActuation,
    /// Nominal continuation rate: character drive includes authored travel; free flight excludes
    /// its non-retained kinematic travel. Compare this with actual retained velocity at completion.
    pub nominal_velocity: Vector3,
}

impl PhysicalBodyInput {
    /// Autonomous input has no server reference to restore after contact.
    pub fn autonomous(actuation: super::PhysicalBodyActuation) -> Self {
        Self {
            collision_pose: None,
            capture_contact_return: false,
            recovery_suspended: true,
            actuation,
            reference: None,
        }
    }

    /// Supplies independent reference motion, with an explicit policy for contact-only capture.
    /// Requiring the reference here prevents a capture request without its prediction input.
    pub fn referenced(
        actuation: super::PhysicalBodyActuation,
        reference: PhysicalReferenceInput,
        capture_contact_return: bool,
    ) -> Self {
        Self {
            actuation,
            reference: Some(reference),
            collision_pose: None,
            recovery_suspended: matches!(reference, PhysicalReferenceInput::Sticky(_)),
            capture_contact_return,
        }
    }

    /// Joins an authored target pose to the same acceptance boundary as its motion proposal.
    pub fn with_collision_pose(mut self, sample: crate::motion::AuthoredCollisionPose) -> Self {
        self.collision_pose = Some(sample);
        self
    }

    /// Suppresses placement recovery while a source command owns pursuit, including intervals
    /// where unavailable target geometry makes its physical input fall back to ordinary motion.
    pub fn suspend_recovery(mut self) -> Self {
        self.recovery_suspended = true;
        self
    }

    /// Composes fixed-body authored root motion once at the body boundary.
    /// Other response modes consume this same sample through their admitted tick.
    pub(crate) fn placement_actuation(&self, body: &SpatialBody) -> super::PhysicalBodyActuation {
        let mut actuation = self.actuation.clone();
        if let super::PhysicalBodyActuation::FixedPosition {
            translation,
            rotation,
        } = &mut actuation
            && let Some(offset) = self
                .reference
                .and_then(PhysicalReferenceInput::authored_offset)
        {
            *translation = *translation + body.pose.rotation.rotate_vector(offset.translation);
            *rotation = rotation.multiply(&offset.rotation);
        }
        actuation
    }

    /// The complete ordinary input owns wake/settle eligibility, including authored travel.
    /// An authored sample retains its playback-driven activity even when its current offset is
    /// stationary; callers must not reconstruct a redundant driven target to keep it awake.
    pub(crate) fn permits_dynamic_settling(&self) -> bool {
        self.actuation.permits_dynamic_settling()
            && self
                .reference
                .is_none_or(PhysicalReferenceInput::permits_settling)
    }

    /// Captures an eligible contact-return reference and seeds explicit free-flight continuation.
    /// This mutates only the scene's private working copy, never authority or the canonical body.
    pub(crate) fn prepare(
        &self,
        body: &mut SpatialBody,
        reconciliation: &mut Option<super::PoseReconciliationState>,
    ) -> anyhow::Result<bool> {
        let wake = !self.permits_dynamic_settling() || body.has_pose_reconciliation_work();
        let physical = body
            .physical
            .as_mut()
            .context("physical input requires body physics")?;
        let pose_changed = match (self.collision_pose, physical.dynamic.as_mut()) {
            (Some(sample), Some(dynamic)) => dynamic
                .collision_poses
                .apply(&dynamic.collision.target_geometry, sample)?,
            (Some(_), None) => anyhow::bail!("authored collision pose requires a dynamic body"),
            (None, _) => false,
        };
        let definition = physical.definition;
        // Direct ephemeral queries legitimately have no dynamic lifecycle. Collection bodies do;
        // fresh input wakes them before the kernel chooses which bodies receive ordinary forces.
        if wake && let Some(dynamic) = physical.dynamic.as_mut() {
            dynamic.wake();
        }
        if matches!(body.id, SpatialBodyId::Entity(_))
            && self.capture_contact_return
            && !matches!(
                definition,
                super::PhysicalBodyDefinition::FixedPosition { .. }
            )
        {
            reconciliation
                .get_or_insert_with(super::PoseReconciliationState::default)
                .begin_contact_return(body.pose)?;
        }
        if let super::PhysicalBodyActuation::FreeFlight {
            retained_velocity, ..
        } = self.actuation
        {
            body.retained.velocity = retained_velocity;
        }
        Ok(pose_changed)
    }
}

/// Independent ordinary movement source; sticky targeting replaces authored physical travel.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PhysicalReferenceInput {
    /// Ordinary playback with an explicit local or remote frame.
    Authored {
        /// Scaled/gated ordinary offset, never observed locomotion.
        offset: Option<RigidTransform>,
        /// Remote command orientation; local input uses the actual body frame.
        rotation: Option<Quaternion>,
    },
    /// Prepared target command in physical world units, never scaled again as an animation offset.
    Sticky(super::StickyBodyTarget),
}

impl PhysicalReferenceInput {
    /// Ordinary input whose controller uses the actual body's frame.
    pub fn body(offset: Option<RigidTransform>) -> Self {
        Self::Authored {
            offset,
            rotation: None,
        }
    }

    /// Interpreted remote input after scaling/gating the source offset.
    pub fn remote(offset: Option<RigidTransform>, rotation: Quaternion) -> Self {
        Self::Authored {
            offset,
            rotation: Some(rotation),
        }
    }

    pub(crate) fn authored_offset(self) -> Option<RigidTransform> {
        match self {
            Self::Authored { offset, .. } => offset,
            Self::Sticky(_) => None,
        }
    }

    fn permits_settling(self) -> bool {
        matches!(self, Self::Authored { offset: None, .. })
    }
}

/// Physical vectors retained across ticks and integrated independently from authored motion.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct RetainedBodyKinematics {
    /// World-space linear momentum used by physical integration and collision response.
    pub velocity: Vector3,
    /// World-space acceleration snapshot. A grounded solve replaces this with its own
    /// gravity/contact result; free-flight and pose projection integrate the supplied vector.
    pub acceleration: Vector3,
    /// World-space angular velocity integrated into physical orientation.
    pub omega: Vector3,
}

impl From<AuthoritativeBodyVectors> for RetainedBodyKinematics {
    fn from(vectors: AuthoritativeBodyVectors) -> Self {
        Self {
            velocity: vectors.velocity,
            acceleration: vectors.acceleration,
            omega: vectors.omega,
        }
    }
}

/// Observed derivative of the path accepted during the latest fixed tick.
///
/// This is retail's cached-motion role: callers may observe it, but it is never a future physical
/// integration basis.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct AcceptedBodyMotion {
    /// Accepted world-space displacement divided by the tick quantum.
    pub velocity: Vector3,
    /// Accepted angular displacement divided by the tick quantum.
    pub omega: Vector3,
}

/// Complete finite vector replacement for one locally simulated dynamic body.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DynamicBodyKinematics {
    velocity: Vector3,
    acceleration: Vector3,
    omega: Vector3,
    align_path: bool,
}

impl DynamicBodyKinematics {
    /// Validates the vector contract once before any scene mutation can observe it.
    pub fn new(
        velocity: Vector3,
        acceleration: Vector3,
        omega: Vector3,
        align_path: bool,
    ) -> Option<Self> {
        [velocity, acceleration, omega]
            .into_iter()
            .all(vector_is_finite)
            .then_some(Self {
                velocity,
                acceleration,
                omega,
                align_path,
            })
    }

    pub const fn velocity(self) -> Vector3 {
        self.velocity
    }

    pub const fn acceleration(self) -> Vector3 {
        self.acceleration
    }

    pub const fn omega(self) -> Vector3 {
        self.omega
    }

    pub const fn align_path(self) -> bool {
        self.align_path
    }
}

fn vector_is_finite(vector: Vector3) -> bool {
    vector.x.is_finite() && vector.y.is_finite() && vector.z.is_finite()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeBodyResetCause {
    InitialHydration,
    TeleportOrWorldReset,
    Resync,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpatialSamplingState {
    pub mode: SpatialSampleMode,
    pub last_authoritative_update: Instant,
    pub last_derived_at: Instant,
}

impl SpatialSamplingState {
    pub fn authoritative(now: Instant) -> Self {
        Self {
            mode: SpatialSampleMode::AuthoritativeOnly,
            last_authoritative_update: now,
            last_derived_at: now,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpatialSamplingConfig {
    pub max_position_interp: Duration,
    pub max_dead_reckon: Duration,
    pub snap_distance_m: u32,
    pub snap_heading_millirad: u32,
}

impl Default for SpatialSamplingConfig {
    fn default() -> Self {
        Self {
            max_position_interp: Duration::from_millis(150),
            max_dead_reckon: Duration::from_millis(1250),
            snap_distance_m: 3,
            snap_heading_millirad: 785,
        }
    }
}

impl SpatialSamplingConfig {
    pub fn snap_distance_meters(self) -> f32 {
        self.snap_distance_m as f32
    }

    pub fn snap_heading_radians(self) -> f32 {
        self.snap_heading_millirad as f32 / 1000.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpatialEntitySample {
    pub guid: Guid,
    pub authoritative_pose: WorldPosition,
    pub projected_pose: WorldPosition,
    /// Accepted displacement from the latest tick divided by its quantum; observational only.
    pub velocity: Vector3,
    /// Retained producer-authored world-space linear acceleration.
    pub acceleration: Vector3,
    /// Retained producer-authored world-space angular velocity.
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionSnapshot>,
    pub projection_mode: SpatialSampleMode,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RuntimeSpatialBodyView {
    pub body_id: SpatialBodyId,
    pub authoritative_pose: Option<WorldPosition>,
    pub runtime_pose: WorldPosition,
    /// Accepted displacement from the latest tick divided by its quantum; observational only.
    pub velocity: Vector3,
    /// Retained world-space linear acceleration used by physical integration.
    pub acceleration: Vector3,
    /// Retained world-space angular velocity used by physical integration.
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionSnapshot>,
    pub contact: ContactState,
    pub sample_mode: SpatialSampleMode,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialBody {
    pub id: SpatialBodyId,
    pub authoritative_pose: Option<WorldPosition>,
    pub pose: WorldPosition,
    /// Collision-free continuation seeded by fresh authority, never by accepted body motion.
    /// Survives correction completion and physical-definition changes; pose-only bodies retain
    /// it for later physical admission without integrating a second projection timeline.
    pub(crate) nominal: AuthoritativeBodyVectors,
    /// Physical vectors retained for future integration and collision response.
    pub retained: RetainedBodyKinematics,
    /// Observed derivative of the latest accepted path; never a future integration basis.
    pub accepted_motion: AcceptedBodyMotion,
    pub motion_state: Option<EntityMotionSnapshot>,
    pub contact: ContactState,
    pub sampling: SpatialSamplingState,
    /// Active authoritative-pose reconciliation, allocated only for bodies that receive it.
    pub(crate) reconciliation: Option<Box<super::PoseReconciliationState>>,
    /// Optional static-collision response attached without duplicating body identity or pose.
    pub physical: Option<PhysicalBodyState>,
}

impl SpatialBody {
    pub fn new(id: SpatialBodyId, pose: WorldPosition, now: Instant) -> Self {
        Self {
            id,
            authoritative_pose: Some(pose),
            pose,
            nominal: AuthoritativeBodyVectors::default(),
            retained: RetainedBodyKinematics::default(),
            accepted_motion: AcceptedBodyMotion::default(),
            motion_state: None,
            contact: ContactState::Unknown,
            sampling: SpatialSamplingState::authoritative(now),
            reconciliation: None,
            physical: None,
        }
    }

    pub fn new_ephemeral(id: SpatialBodyId, pose: WorldPosition, now: Instant) -> Self {
        Self {
            id,
            authoritative_pose: None,
            pose,
            nominal: AuthoritativeBodyVectors::default(),
            retained: RetainedBodyKinematics::default(),
            accepted_motion: AcceptedBodyMotion::default(),
            motion_state: None,
            contact: ContactState::Unknown,
            sampling: SpatialSamplingState::authoritative(now),
            reconciliation: None,
            physical: None,
        }
    }

    /// Source frame policy follows the prepared physical role, not animation availability.
    pub(crate) fn remote_frame_policy(&self) -> crate::motion::RemoteFramePolicy {
        if self.physical.as_ref().is_some_and(|physical| {
            physical.has_direct_character_drive()
                && matches!(
                    physical.definition,
                    super::PhysicalBodyDefinition::Grounded { .. }
                )
        }) {
            crate::motion::RemoteFramePolicy::Command
        } else {
            crate::motion::RemoteFramePolicy::Body
        }
    }

    /// Initial source pose for remote playback. Only a newly installed source uses this heading;
    /// its retained command frame subsequently follows ordinary source motion and fresh events.
    pub(crate) fn authored_source_pose(&self) -> WorldPosition {
        let rotation = self
            .reconciliation
            .as_deref()
            .and_then(super::PoseReconciliationState::pending_correction_heading)
            .unwrap_or(self.pose.rotation);
        WorldPosition {
            rotation,
            ..self.pose
        }
    }

    /// Whether this body has allocated authoritative-pose reconciliation state.
    pub fn has_pose_reconciliation_state(&self) -> bool {
        self.reconciliation.is_some()
    }

    /// Whether reconciliation can move this body without an ordinary actor-produced basis.
    pub fn has_pose_reconciliation_work(&self) -> bool {
        self.reconciliation
            .as_deref()
            .is_some_and(super::PoseReconciliationState::has_projection_work)
    }

    /// Complete source-domain membership accepted atomically with the current root pose.
    ///
    /// Physical entities retain the exact sphere-reached membership used by the
    /// accepted collision transaction. Pose-only bodies have no wider geometry to evaluate, so
    /// their authoritative cell selector is their complete known membership.
    pub fn spatial_membership(&self) -> super::SpatialMembership {
        self.physical
            .as_ref()
            .and_then(|physical| physical.dynamic.as_ref())
            .map(|dynamic| dynamic.placement.clone())
            .unwrap_or_else(|| {
                if self.pose.is_indoors() {
                    super::SpatialMembership::interior(self.pose.landblock_id)
                } else {
                    super::SpatialMembership::outdoor()
                }
            })
    }

    pub fn spatial_sample(&self) -> Option<SpatialEntitySample> {
        let guid = self.id.authoritative_guid()?;
        let authoritative_pose = self.authoritative_pose.unwrap_or(self.pose);
        Some(SpatialEntitySample {
            guid,
            authoritative_pose,
            projected_pose: self.pose,
            velocity: self.accepted_motion.velocity,
            acceleration: self.retained.acceleration,
            omega: self.retained.omega,
            motion_state: self.motion_state,
            projection_mode: self.sampling.mode,
        })
    }

    pub fn runtime_view(&self) -> RuntimeSpatialBodyView {
        RuntimeSpatialBodyView {
            body_id: self.id,
            authoritative_pose: self.authoritative_pose,
            runtime_pose: self.pose,
            velocity: self.accepted_motion.velocity,
            acceleration: self.retained.acceleration,
            omega: self.retained.omega,
            motion_state: self.motion_state,
            contact: self.contact,
            sample_mode: self.sampling.mode,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolveBodyInput {
    pub body_id: SpatialBodyId,
    pub pose: WorldPosition,
    pub contact: ContactState,
    /// One-tick authored contribution in body-local space, consumed without retention.
    pub authored_offset: Option<RigidTransform>,
    /// Physical vectors integrated independently from the authored contribution.
    pub retained: RetainedBodyKinematics,
}

impl SolveBodyInput {
    pub fn velocity(
        body_id: SpatialBodyId,
        pose: WorldPosition,
        contact: ContactState,
        velocity: Vector3,
        omega: Vector3,
    ) -> Self {
        Self {
            body_id,
            pose,
            contact,
            authored_offset: None,
            retained: RetainedBodyKinematics {
                velocity,
                acceleration: Vector3::zero(),
                omega,
            },
        }
    }

    /// Whether this tick has an authored or physical contribution worth scheduling.
    pub fn has_motion(self) -> bool {
        self.authored_offset.is_some() || self.retained != RetainedBodyKinematics::default()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolvedBodyKinematics {
    pub body_id: SpatialBodyId,
    pub pose: WorldPosition,
    /// Observed derivative of this solve's accepted path.
    pub accepted_motion: AcceptedBodyMotion,
    /// Physical vectors retained after this pose-only integration tick.
    pub retained: RetainedBodyKinematics,
    pub contact: ContactState,
    pub projection_state: Option<SelfPlayerDriveProjectionState>,
}

/// Placement consequence produced by one fixed body tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeBodyAdvanceKind {
    /// Ordinary authored, velocity, interpolation, or collision-resolved movement.
    Integrated,
    /// Ordinary far correction installed at the tick boundary without a lifecycle reset.
    CorrectionSnap,
}

#[derive(Debug, Clone, PartialEq)]
pub enum SpatialBodyEvent {
    ContactChanged {
        body_id: SpatialBodyId,
        contact: ContactState,
    },
    ForcedReposition {
        body_id: SpatialBodyId,
        pose: WorldPosition,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalDriveGait {
    Walk,
    Run,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LocalDriveControl {
    pub body_id: SpatialBodyId,
    pub desired_world_delta: Vector3,
    pub desired_heading: Option<f32>,
    pub target_hint: Option<WorldPosition>,
    pub gait: LocalDriveGait,
    pub force_grounded: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spatial_body_order_is_explicit_across_identity_authorities() {
        let mut ids = [
            SpatialBodyId::Ephemeral(1),
            SpatialBodyId::LocalPlayer(Guid(1)),
            SpatialBodyId::Entity(Guid(2)),
            SpatialBodyId::Entity(Guid(1)),
            SpatialBodyId::Ephemeral(0),
        ];

        ids.sort();

        assert_eq!(
            ids,
            [
                SpatialBodyId::Entity(Guid(1)),
                SpatialBodyId::Entity(Guid(2)),
                SpatialBodyId::LocalPlayer(Guid(1)),
                SpatialBodyId::Ephemeral(0),
                SpatialBodyId::Ephemeral(1),
            ]
        );
    }
}
