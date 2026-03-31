use crate::entity::EntityMotionSnapshot;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use smallvec::SmallVec;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ContactState {
    #[default]
    Unknown,
    Airborne,
    Grounded,
}

impl ContactState {
    pub const fn grounded(self) -> Option<bool> {
        match self {
            Self::Unknown => None,
            Self::Airborne => Some(false),
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
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionSnapshot>,
    pub contact: ContactState,
    pub sampling: SpatialSamplingState,
}

impl SpatialBody {
    pub fn new(id: SpatialBodyId, pose: WorldPosition, now: Instant) -> Self {
        Self {
            id,
            authoritative_pose: Some(pose),
            pose,
            velocity: Vector3::zero(),
            omega: Vector3::zero(),
            motion_state: None,
            contact: ContactState::Unknown,
            sampling: SpatialSamplingState::authoritative(now),
        }
    }

    pub fn new_ephemeral(id: SpatialBodyId, pose: WorldPosition, now: Instant) -> Self {
        Self {
            id,
            authoritative_pose: None,
            pose,
            velocity: Vector3::zero(),
            omega: Vector3::zero(),
            motion_state: None,
            contact: ContactState::Unknown,
            sampling: SpatialSamplingState::authoritative(now),
        }
    }

    pub fn spatial_sample(&self) -> Option<SpatialEntitySample> {
        let guid = self.id.authoritative_guid()?;
        let authoritative_pose = self.authoritative_pose.unwrap_or(self.pose);
        Some(SpatialEntitySample {
            guid,
            authoritative_pose,
            projected_pose: self.pose,
            velocity: self.velocity,
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
            omega: self.omega,
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
    pub velocity: Vector3,
    pub omega: Vector3,
}

impl SolveBodyInput {
    pub fn from_actor_input(input: SolveActorInput) -> Self {
        Self {
            body_id: SpatialBodyId::Entity(input.actor_id),
            pose: input.pose,
            velocity: input.velocity,
            omega: input.omega,
        }
    }

    pub fn into_actor_input(self) -> Option<SolveActorInput> {
        self.body_id.authoritative_guid().map(|actor_id| SolveActorInput {
            actor_id,
            pose: self.pose,
            velocity: self.velocity,
            omega: self.omega,
        })
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

impl SolvedBodyKinematics {
    pub fn from_actor_kinematics(kinematics: SolvedActorKinematics) -> Self {
        Self {
            body_id: SpatialBodyId::Entity(kinematics.actor_id),
            pose: kinematics.pose,
            velocity: kinematics.velocity,
            omega: kinematics.omega,
            contact: kinematics.contact,
            projection_state: kinematics.projection_state,
        }
    }

    pub fn into_actor_kinematics(self) -> Option<SolvedActorKinematics> {
        self.body_id.authoritative_guid().map(|actor_id| SolvedActorKinematics {
            actor_id,
            pose: self.pose,
            velocity: self.velocity,
            omega: self.omega,
            contact: self.contact,
            projection_state: self.projection_state,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SpatialBodyEvent {
    ContactChanged { body_id: SpatialBodyId, contact: ContactState },
    ForcedReposition { body_id: SpatialBodyId, pose: WorldPosition },
}

impl SpatialBodyEvent {
    pub fn from_spatial_event(event: SpatialEvent) -> Self {
        match event {
            SpatialEvent::ContactChanged { actor_id, contact } => Self::ContactChanged {
                body_id: SpatialBodyId::Entity(actor_id),
                contact,
            },
            SpatialEvent::ForcedReposition { actor_id, pose } => Self::ForcedReposition {
                body_id: SpatialBodyId::Entity(actor_id),
                pose,
            },
        }
    }

    pub fn into_spatial_event(self) -> Option<SpatialEvent> {
        match self {
            Self::ContactChanged { body_id, contact } => body_id.authoritative_guid().map(|actor_id| SpatialEvent::ContactChanged { actor_id, contact }),
            Self::ForcedReposition { body_id, pose } => body_id.authoritative_guid().map(|actor_id| SpatialEvent::ForcedReposition { actor_id, pose }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolveActorInput {
    pub actor_id: Guid,
    pub pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
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
    pub gait: LocalDriveGait,
    pub force_grounded: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialSolveRequest {
    pub dt: Duration,
    pub actors: SmallVec<[SolveActorInput; 1]>,
    pub local_drive: Option<LocalDriveControl>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolvedActorKinematics {
    pub actor_id: Guid,
    pub pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub contact: ContactState,
    pub projection_state: Option<SelfPlayerDriveProjectionState>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SpatialEvent {
    ContactChanged { actor_id: Guid, contact: ContactState },
    ForcedReposition { actor_id: Guid, pose: WorldPosition },
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialSolveBatch {
    pub solved: SmallVec<[SolvedActorKinematics; 1]>,
    pub events: SmallVec<[SpatialEvent; 4]>,
}