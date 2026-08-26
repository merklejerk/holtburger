use super::PhysicalBodyState;
use crate::entity::EntityMotionSnapshot;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, RigidTransform, Vector3};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthoritativeBodySync {
    Snapshot,
    Reset,
}

/// One complete producer-authoritative pose and vector replacement.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AuthoritativeBodyKinematics {
    /// Producer-authoritative world pose.
    pub pose: WorldPosition,
    /// Producer-authoritative world-space linear velocity.
    pub velocity: Vector3,
    /// Producer-authoritative world-space linear acceleration.
    pub acceleration: Vector3,
    /// Producer-authoritative world-space angular velocity.
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
    pub velocity: Vector3,
    /// Current producer-authored world-space linear acceleration.
    pub acceleration: Vector3,
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionSnapshot>,
    pub projection_mode: SpatialSampleMode,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RuntimeSpatialBodyView {
    pub body_id: SpatialBodyId,
    pub authoritative_pose: Option<WorldPosition>,
    pub runtime_pose: WorldPosition,
    pub velocity: Vector3,
    /// Current canonical world-space linear acceleration.
    pub acceleration: Vector3,
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
    pub velocity: Vector3,
    /// Canonical world-space linear acceleration retained for dynamic integration.
    pub acceleration: Vector3,
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionSnapshot>,
    pub contact: ContactState,
    pub sampling: SpatialSamplingState,
    /// Optional static-collision response attached without duplicating body identity or pose.
    pub physical: Option<PhysicalBodyState>,
}

impl SpatialBody {
    pub fn new(id: SpatialBodyId, pose: WorldPosition, now: Instant) -> Self {
        Self {
            id,
            authoritative_pose: Some(pose),
            pose,
            velocity: Vector3::zero(),
            acceleration: Vector3::zero(),
            omega: Vector3::zero(),
            motion_state: None,
            contact: ContactState::Unknown,
            sampling: SpatialSamplingState::authoritative(now),
            physical: None,
        }
    }

    pub fn new_ephemeral(id: SpatialBodyId, pose: WorldPosition, now: Instant) -> Self {
        Self {
            id,
            authoritative_pose: None,
            pose,
            velocity: Vector3::zero(),
            acceleration: Vector3::zero(),
            omega: Vector3::zero(),
            motion_state: None,
            contact: ContactState::Unknown,
            sampling: SpatialSamplingState::authoritative(now),
            physical: None,
        }
    }

    /// Complete source-domain membership accepted atomically with the current root pose.
    ///
    /// Solver-participating entities retain the exact sphere-reached membership used by the
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
            velocity: self.velocity,
            acceleration: self.acceleration,
            omega: self.omega,
            motion_state: self.motion_state,
            projection_mode: self.sampling.mode,
        })
    }

    pub fn runtime_view(&self) -> RuntimeSpatialBodyView {
        RuntimeSpatialBodyView {
            body_id: self.id,
            authoritative_pose: self.authoritative_pose,
            runtime_pose: self.pose,
            velocity: self.velocity,
            acceleration: self.acceleration,
            omega: self.omega,
            motion_state: self.motion_state,
            contact: self.contact,
            sample_mode: self.sampling.mode,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SolveProjectionBasis {
    /// Retained physical momentum in world space.
    Velocity { velocity: Vector3, omega: Vector3 },
    /// The tick's authored contribution as one rigid offset in the body's own frame.
    ///
    /// This is the whole authored program for the tick, composed exactly from the frames the cursor
    /// departed plus the motion-data slice — not a rate sampled from it. It is consumed and
    /// discarded: blocked displacement is never retried, and nothing accumulates it as momentum.
    AuthoredDrive { offset: RigidTransform },
}

impl SolveProjectionBasis {
    pub const fn velocity(velocity: Vector3, omega: Vector3) -> Self {
        Self::Velocity { velocity, omega }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolveBodyInput {
    pub body_id: SpatialBodyId,
    pub pose: WorldPosition,
    pub contact: ContactState,
    pub basis: Option<SolveProjectionBasis>,
}

impl SolveBodyInput {
    pub const fn velocity(
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
            basis: Some(SolveProjectionBasis::Velocity { velocity, omega }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolvedBodyKinematics {
    pub body_id: SpatialBodyId,
    pub pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub contact: ContactState,
    pub projection_state: Option<SelfPlayerDriveProjectionState>,
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
