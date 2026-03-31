use crate::entity::EntityMotionSnapshot;
use holtburger_common::position::METERS_PER_LANDBLOCK;
use holtburger_common::position::WorldPosition;
use holtburger_common::Guid;
use holtburger_common::Quaternion;
use holtburger_common::Vector3;
use smallvec::SmallVec;
use std::collections::{HashMap, HashSet};
use std::f32::consts::{PI, TAU};
use std::sync::Arc;
use std::time::{Duration, Instant};

const EPSILON: f32 = 1e-4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ContactState {
    /// The body contact state is not currently known.
    #[default]
    Unknown,
    /// The body is not in ground contact.
    Airborne,
    /// The body is in ground contact.
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
    /// A world entity body keyed by the entity guid.
    Entity(Guid),
    /// The local player's runtime body keyed by the player guid.
    LocalPlayer(Guid),
    /// A runtime-only body with no authoritative guid backing.
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
    /// Runtime pose currently matches authoritative pose with no extra derivation.
    #[default]
    AuthoritativeOnly,
    /// Runtime pose was realized by solve-owned direct-drive control.
    SimulatingMotionState,
    /// Runtime pose was realized by solve-owned velocity or angular velocity.
    SimulatingVelocity,
    /// Runtime sampling is intentionally paused until a reset or resync resumes it.
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
    /// Apply the authoritative update as a normal snapshot/reconciliation step.
    Snapshot,
    /// Apply the authoritative update as a hard reset/reposition.
    Reset,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeBodyResetCause {
    /// Initial world/bootstrap hydration populated or replaced the runtime bodies.
    InitialHydration,
    /// A teleport or broader world reset invalidated current runtime advancement.
    TeleportOrWorldReset,
    /// The frontend or bridge requested an explicit resynchronization.
    Resync,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpatialSamplingState {
    /// Current runtime sampling mode for the body.
    pub mode: SpatialSampleMode,
    /// Time of the last authoritative pose update applied to the body.
    pub last_authoritative_update: Instant,
    /// Time the runtime pose was last derived or advanced.
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
    /// Maximum duration allowed for authoritative position interpolation.
    pub max_position_interp: Duration,
    /// Maximum amount of time to dead reckon from the last authoritative update.
    pub max_dead_reckon: Duration,
    /// Distance threshold, in meters, beyond which corrections snap immediately.
    pub snap_distance_m: u32,
    /// Heading threshold, in milliradians, beyond which corrections snap immediately.
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

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialProjectedEntityState {
    /// Entity guid for this projected sample.
    pub guid: Guid,
    /// Latest authoritative pose known for the entity.
    pub authoritative_pose: WorldPosition,
    /// Runtime/projected pose derived from the authoritative state.
    pub projected_pose: WorldPosition,
    /// Current linear velocity used by runtime derivation.
    pub velocity: Vector3,
    /// Current angular velocity used by runtime derivation.
    pub omega: Vector3,
    /// Latest motion snapshot associated with the entity.
    pub motion_state: Option<EntityMotionSnapshot>,
    /// Runtime derivation mode that produced the projected pose.
    pub projection_mode: SpatialSampleMode,
    /// Time of the authoritative update that the sample is based on.
    pub last_authoritative_update: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpatialEntitySample {
    /// Entity guid for this spatial sample.
    pub guid: Guid,
    /// Latest authoritative pose known for the entity.
    pub authoritative_pose: WorldPosition,
    /// Runtime/projected pose exposed to consumers.
    pub projected_pose: WorldPosition,
    /// Current linear velocity associated with the sample.
    pub velocity: Vector3,
    /// Current angular velocity associated with the sample.
    pub omega: Vector3,
    /// Latest motion snapshot associated with the sample.
    pub motion_state: Option<EntityMotionSnapshot>,
    /// Runtime derivation mode that produced the sample.
    pub projection_mode: SpatialSampleMode,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RuntimeSpatialBodyView {
    /// Stable runtime body identifier.
    pub body_id: SpatialBodyId,
    /// Latest authoritative pose when one exists for this body.
    pub authoritative_pose: Option<WorldPosition>,
    /// Current canonical runtime pose for the body.
    pub runtime_pose: WorldPosition,
    /// Current linear velocity for the runtime body.
    pub velocity: Vector3,
    /// Current angular velocity for the runtime body.
    pub omega: Vector3,
    /// Current motion snapshot driving runtime derivation, if any.
    pub motion_state: Option<EntityMotionSnapshot>,
    /// Current contact state for the body.
    pub contact: ContactState,
    /// Current runtime sampling mode for the body.
    pub sample_mode: SpatialSampleMode,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialBody {
    /// Stable runtime body identifier.
    pub id: SpatialBodyId,
    /// Latest authoritative pose when one exists for this body.
    pub authoritative_pose: Option<WorldPosition>,
    /// Current canonical runtime pose for the body.
    pub pose: WorldPosition,
    /// Current linear velocity for the body.
    pub velocity: Vector3,
    /// Current angular velocity for the body.
    pub omega: Vector3,
    /// Current motion snapshot associated with the body.
    pub motion_state: Option<EntityMotionSnapshot>,
    /// Current contact state for the body.
    pub contact: ContactState,
    /// Runtime sampling metadata for authority and solve-owned realization.
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

    pub fn projected_entity_state(&self) -> Option<SpatialProjectedEntityState> {
        let guid = self.id.authoritative_guid()?;
        let authoritative_pose = self.authoritative_pose.unwrap_or(self.pose);
        Some(SpatialProjectedEntityState {
            guid,
            authoritative_pose,
            projected_pose: self.pose,
            velocity: self.velocity,
            omega: self.omega,
            motion_state: self.motion_state,
            projection_mode: self.sampling.mode,
            last_authoritative_update: self.sampling.last_authoritative_update,
        })
    }

    pub fn spatial_sample(&self) -> Option<SpatialEntitySample> {
        self.projected_entity_state().map(|state| SpatialEntitySample {
            guid: state.guid,
            authoritative_pose: state.authoritative_pose,
            projected_pose: state.projected_pose,
            velocity: state.velocity,
            omega: state.omega,
            motion_state: state.motion_state,
            projection_mode: state.projection_mode,
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
    /// Body being submitted to physics or constraint solving.
    pub body_id: SpatialBodyId,
    /// Starting pose for this solve step.
    pub pose: WorldPosition,
    /// Starting linear velocity for this solve step.
    pub velocity: Vector3,
    /// Starting angular velocity for this solve step.
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
    /// Body whose kinematics were solved.
    pub body_id: SpatialBodyId,
    /// Solved pose after the physics step.
    pub pose: WorldPosition,
    /// Solved linear velocity after the physics step.
    pub velocity: Vector3,
    /// Solved angular velocity after the physics step.
    pub omega: Vector3,
    /// Solved contact state after the physics step.
    pub contact: ContactState,
    /// Optional self-player projection state used to classify local drive realization.
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
        self.body_id
            .authoritative_guid()
            .map(|actor_id| SolvedActorKinematics {
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
    /// Body contact state changed.
    ContactChanged {
        /// Body whose contact state changed.
        body_id: SpatialBodyId,
        /// New contact state for the body.
        contact: ContactState,
    },
    /// Body was forcibly repositioned.
    ForcedReposition {
        /// Body that was repositioned.
        body_id: SpatialBodyId,
        /// New pose applied to the body.
        pose: WorldPosition,
    },
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
            Self::ContactChanged { body_id, contact } => body_id
                .authoritative_guid()
                .map(|actor_id| SpatialEvent::ContactChanged { actor_id, contact }),
            Self::ForcedReposition { body_id, pose } => body_id
                .authoritative_guid()
                .map(|actor_id| SpatialEvent::ForcedReposition { actor_id, pose }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolveActorInput {
    /// Actor guid being solved.
    pub actor_id: Guid,
    /// Starting pose for this solve step.
    pub pose: WorldPosition,
    /// Starting linear velocity for this solve step.
    pub velocity: Vector3,
    /// Starting angular velocity for this solve step.
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
    /// Duration of the solve step.
    pub dt: Duration,
    /// Actor inputs to advance during the solve step.
    pub actors: SmallVec<[SolveActorInput; 1]>,
    /// Optional solver-facing direct-drive request for the local player.
    pub local_drive: Option<LocalDriveControl>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolvedActorKinematics {
    /// Actor guid whose kinematics were solved.
    pub actor_id: Guid,
    /// Solved pose after the physics step.
    pub pose: WorldPosition,
    /// Solved linear velocity after the physics step.
    pub velocity: Vector3,
    /// Solved angular velocity after the physics step.
    pub omega: Vector3,
    /// Solved contact state after the physics step.
    pub contact: ContactState,
    /// Optional self-player projection state used to classify local drive realization.
    pub projection_state: Option<SelfPlayerDriveProjectionState>,
}

fn sample_mode_for_projection_state(
    projection_state: Option<SelfPlayerDriveProjectionState>,
    velocity: Vector3,
    omega: Vector3,
) -> SpatialSampleMode {
    match projection_state {
        Some(SelfPlayerDriveProjectionState::AuthorityFrozen) => SpatialSampleMode::Suspended,
        Some(SelfPlayerDriveProjectionState::LocalGroundedDirectDrive) => {
            SpatialSampleMode::SimulatingMotionState
        }
        Some(SelfPlayerDriveProjectionState::LocalAirborne)
        | Some(SelfPlayerDriveProjectionState::ServerControlled)
        | None => {
            if velocity.length_squared() > EPSILON || omega.length_squared() > EPSILON {
                SpatialSampleMode::SimulatingVelocity
            } else {
                SpatialSampleMode::SimulatingMotionState
            }
        }
    }
}

fn desired_heading_for_local_drive(
    control: &LocalDriveControl,
    current_heading: f32,
) -> f32 {
    if let Some(desired_heading) = control.desired_heading {
        return normalize_heading(desired_heading);
    }

    let planar_delta = Vector3::new(
        control.desired_world_delta.x,
        control.desired_world_delta.y,
        0.0,
    );

    if planar_delta.length_squared() <= EPSILON {
        current_heading
    } else {
        Vector3::zero().heading_to(&planar_delta)
    }
}

fn derive_self_player_projection_state(
    scene: &SpatialScene,
    control: &LocalDriveControl,
) -> SelfPlayerDriveProjectionState {
    let Some(body) = scene.body(control.body_id) else {
        return if control.force_grounded {
            SelfPlayerDriveProjectionState::LocalGroundedDirectDrive
        } else {
            SelfPlayerDriveProjectionState::LocalAirborne
        };
    };

    if body.sampling.mode == SpatialSampleMode::Suspended {
        return SelfPlayerDriveProjectionState::AuthorityFrozen;
    }

    if !control.force_grounded && body.contact == ContactState::Airborne {
        return SelfPlayerDriveProjectionState::LocalAirborne;
    }

    SelfPlayerDriveProjectionState::LocalGroundedDirectDrive
}

fn solve_self_player_local_drive(
    input: &SolveActorInput,
    control: &LocalDriveControl,
    dt: Duration,
    scene: &SpatialScene,
) -> SolvedActorKinematics {
    let projection_state = derive_self_player_projection_state(scene, control);
    let dt_secs = dt.as_secs_f32().max(0.0);
    let current_contact = scene
        .body(control.body_id)
        .map(|body| body.contact)
        .unwrap_or(ContactState::Unknown);

    if dt_secs <= f32::EPSILON {
        return SolvedActorKinematics {
            actor_id: input.actor_id,
            pose: input.pose,
            velocity: input.velocity,
            omega: input.omega,
            contact: current_contact,
            projection_state: Some(projection_state),
        };
    }

    match projection_state {
        SelfPlayerDriveProjectionState::AuthorityFrozen => SolvedActorKinematics {
            actor_id: input.actor_id,
            pose: input.pose,
            velocity: Vector3::zero(),
            omega: Vector3::zero(),
            contact: current_contact,
            projection_state: Some(projection_state),
        },
        SelfPlayerDriveProjectionState::LocalAirborne => {
            let mut solved = advance_actor_kinematics(input, dt);
            solved.contact = current_contact;
            solved.projection_state = Some(projection_state);
            solved
        }
        SelfPlayerDriveProjectionState::LocalGroundedDirectDrive
        | SelfPlayerDriveProjectionState::ServerControlled => {
            let desired_velocity = control.desired_world_delta / dt_secs;
            let current_heading = input.pose.rotation.to_heading();
            let desired_heading = desired_heading_for_local_drive(control, current_heading);
            let mut next_pose = project_pose_by_velocity(input.pose, desired_velocity, dt_secs);
            next_pose.rotation = Quaternion::from_heading(desired_heading);

            SolvedActorKinematics {
                actor_id: input.actor_id,
                pose: next_pose,
                velocity: desired_velocity,
                omega: Vector3::new(
                    0.0,
                    0.0,
                    signed_heading_delta(current_heading, desired_heading) / dt_secs,
                ),
                contact: if control.force_grounded {
                    ContactState::Grounded
                } else {
                    current_contact
                },
                projection_state: Some(projection_state),
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SpatialEvent {
    /// Actor contact state changed.
    ContactChanged {
        /// Actor whose contact state changed.
        actor_id: Guid,
        /// New contact state for the actor.
        contact: ContactState,
    },
    /// Actor was forcibly repositioned.
    ForcedReposition {
        /// Actor that was repositioned.
        actor_id: Guid,
        /// New pose applied to the actor.
        pose: WorldPosition,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialSolveBatch {
    /// Solved kinematics for the actors that were advanced.
    pub solved: SmallVec<[SolvedActorKinematics; 1]>,
    /// Side-effect events emitted by the solve step.
    pub events: SmallVec<[SpatialEvent; 4]>,
}

pub trait SpatialPhysics: Send + Sync + 'static {
    fn solve(
        &self,
        request: &SpatialSolveRequest,
        scene: &mut SpatialScene,
    ) -> SpatialSolveBatch;
}

fn normalize_heading(heading: f32) -> f32 {
    heading.rem_euclid(TAU)
}

fn rotate_planar_velocity(velocity: Vector3, turn_step: f32) -> Vector3 {
    if turn_step.abs() <= f32::EPSILON {
        return velocity;
    }

    let sin = turn_step.sin();
    let cos = turn_step.cos();

    Vector3::new(
        (velocity.x * cos) + (velocity.y * sin),
        (-velocity.x * sin) + (velocity.y * cos),
        velocity.z,
    )
}

fn signed_heading_delta(current_heading: f32, desired_heading: f32) -> f32 {
    let mut delta = (desired_heading - current_heading) % TAU;
    if delta <= -PI {
        delta += TAU;
    } else if delta > PI {
        delta -= TAU;
    }
    delta
}

pub(super) fn project_pose_by_velocity(
    authoritative_pose: WorldPosition,
    velocity: Vector3,
    dt_secs: f32,
) -> WorldPosition {
    if dt_secs <= 0.0 {
        return authoritative_pose;
    }

    if authoritative_pose.is_indoors() {
        return WorldPosition {
            landblock_id: authoritative_pose.landblock_id,
            coords: authoritative_pose.coords + (velocity * dt_secs),
            rotation: authoritative_pose.rotation,
        };
    }

    let projected_global = authoritative_pose.global_coords() + (velocity * dt_secs);
    // Outdoor runtime projection currently reconstructs the high landblock bits
    // from global coordinates and preserves the low-word cell portion from the
    // authoritative pose. That is a deliberate fudge for now: we do not yet
    // have the cell/topology data needed to derive the fully correct advanced
    // cell or indoor/outdoor transition here.
    let landblock_x =
        (projected_global.x.div_euclid(METERS_PER_LANDBLOCK) as i32).clamp(0, 255) as u32;
    let landblock_y =
        (projected_global.y.div_euclid(METERS_PER_LANDBLOCK) as i32).clamp(0, 255) as u32;
    let low_word = authoritative_pose.landblock_id.0 & 0xFFFF;

    WorldPosition {
        landblock_id: Guid((landblock_x << 24) | (landblock_y << 16) | low_word),
        coords: Vector3::new(
            projected_global.x.rem_euclid(METERS_PER_LANDBLOCK),
            projected_global.y.rem_euclid(METERS_PER_LANDBLOCK),
            projected_global.z,
        ),
        rotation: authoritative_pose.rotation,
    }
}

pub fn advance_actor_kinematics(
    input: &SolveActorInput,
    dt: Duration,
) -> SolvedActorKinematics {
    let dt_secs = dt.as_secs_f32().max(0.0);
    if dt_secs <= f32::EPSILON {
        return SolvedActorKinematics {
            actor_id: input.actor_id,
            pose: input.pose,
            velocity: input.velocity,
            omega: input.omega,
            contact: ContactState::Unknown,
            projection_state: None,
        };
    }

    let turn_step = input.omega.z * dt_secs;
    let next_heading = normalize_heading(input.pose.rotation.to_heading() + turn_step);
    let next_velocity = rotate_planar_velocity(input.velocity, turn_step);

    let mut next_pose = input.pose;
    next_pose.rotation = Quaternion::from_heading(next_heading);
    next_pose.coords = next_pose.coords + (next_velocity * dt_secs);

    SolvedActorKinematics {
        actor_id: input.actor_id,
        pose: next_pose,
        velocity: next_velocity,
        omega: input.omega,
        contact: ContactState::Unknown,
        projection_state: None,
    }
}

#[derive(Debug, Default)]
pub struct BasicSpatialPhysics;

impl SpatialPhysics for BasicSpatialPhysics {
    fn solve(
        &self,
        request: &SpatialSolveRequest,
        scene: &mut SpatialScene,
    ) -> SpatialSolveBatch {
        let local_drive_guid = request
            .local_drive
            .and_then(|control| control.body_id.authoritative_guid());
        let solved = request
            .actors
            .iter()
            .map(|actor| {
                if Some(actor.actor_id) == local_drive_guid
                    && let Some(control) = request.local_drive.as_ref()
                {
                    solve_self_player_local_drive(actor, control, request.dt, scene)
                } else {
                    advance_actor_kinematics(actor, request.dt)
                }
            })
            .collect();

        SpatialSolveBatch {
            solved,
            events: SmallVec::new(),
        }
    }
}

#[derive(Debug, Default)]
pub struct NoopSpatialPhysics;

impl SpatialPhysics for NoopSpatialPhysics {
    fn solve(
        &self,
        _request: &SpatialSolveRequest,
        _scene: &mut SpatialScene,
    ) -> SpatialSolveBatch {
        SpatialSolveBatch {
            solved: SmallVec::new(),
            events: SmallVec::new(),
        }
    }
}

/// World-owned runtime body store for tracked `SpatialBody` sidecars.
///
/// This store owns runtime body records, sampling configuration, and body identity allocation.
/// Runtime body transitions and sampling policy are orchestrated by `SpatialScene`.
#[derive(Debug, Clone)]
pub(crate) struct BodySamplingStore {
    /// Canonical runtime bodies tracked by the sampling store.
    bodies: HashMap<SpatialBodyId, SpatialBody>,
    /// Runtime sampling configuration for interpolation, dead reckoning, and snap thresholds.
    config: SpatialSamplingConfig,
    /// Monotonic counter for allocating ephemeral runtime body ids.
    next_ephemeral_body_id: u64,
}

impl Default for BodySamplingStore {
    fn default() -> Self {
        Self {
            bodies: HashMap::new(),
            config: SpatialSamplingConfig::default(),
            next_ephemeral_body_id: 1,
        }
    }
}

impl BodySamplingStore {
    fn config(&self) -> SpatialSamplingConfig {
        self.config
    }

    fn set_config(&mut self, config: SpatialSamplingConfig) {
        self.config = config;
    }

    fn runtime_body_view(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        self.body(body_id).map(SpatialBody::runtime_view)
    }

    fn iter_runtime_body_views(&self) -> impl Iterator<Item = RuntimeSpatialBodyView> + '_ {
        self.bodies.values().map(SpatialBody::runtime_view)
    }

    fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.bodies.get(&body_id)
    }

    fn body_for_guid(&self, guid: Guid) -> Option<&SpatialBody> {
        self.body(SpatialBodyId::LocalPlayer(guid))
            .or_else(|| self.body(SpatialBodyId::Entity(guid)))
    }

    fn body_mut(&mut self, body_id: SpatialBodyId) -> Option<&mut SpatialBody> {
        self.bodies.get_mut(&body_id)
    }

    fn register_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.bodies.insert(body.id, body)
    }

    fn update_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        let existing = self.bodies.get_mut(&body.id)?;
        Some(std::mem::replace(existing, body))
    }

    fn remove_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.bodies.remove(&body_id)
    }

    fn allocate_ephemeral_body_id(&mut self) -> SpatialBodyId {
        let body_id = SpatialBodyId::Ephemeral(self.next_ephemeral_body_id);
        self.next_ephemeral_body_id += 1;
        body_id
    }

    fn register_ephemeral_body(&mut self, pose: WorldPosition, now: Instant) -> SpatialBodyId {
        let body_id = self.allocate_ephemeral_body_id();
        self.register_body(SpatialBody::new_ephemeral(body_id, pose, now));
        body_id
    }
}

/// The SpatialScene is responsible for managing the world-owned "where" of everything.
/// It tracks authoritative entity positions by landblock, hosts solve context, and composes the
/// canonical runtime body state exposed to read-model consumers.
#[derive(Clone)]
pub struct SpatialScene {
    /// Entities indexed by LandblockID for fast local queries.
    landblock_map: HashMap<Guid, HashSet<Guid>>,
    /// Latest authoritative pose snapshots for narrow spatial queries.
    entity_poses: HashMap<Guid, WorldPosition>,
    /// Canonical runtime body store owned by the world.
    body_store: BodySamplingStore,
    /// Physics implementation used to advance solve requests.
    physics: Arc<dyn SpatialPhysics>,
}

impl Default for SpatialScene {
    fn default() -> Self {
        Self::new()
    }
}

impl SpatialScene {
    pub fn new() -> Self {
        Self::new_with_physics(Arc::new(BasicSpatialPhysics))
    }

    pub fn new_with_physics(physics: Arc<dyn SpatialPhysics>) -> Self {
        Self {
            landblock_map: HashMap::new(),
            entity_poses: HashMap::new(),
            body_store: BodySamplingStore::default(),
            physics,
        }
    }

    pub fn physics(&self) -> &Arc<dyn SpatialPhysics> {
        &self.physics
    }

    pub fn runtime_sampling_config(&self) -> SpatialSamplingConfig {
        self.body_store.config()
    }

    pub fn set_runtime_sampling_config(&mut self, config: SpatialSamplingConfig) {
        self.body_store.set_config(config);
    }

    pub fn runtime_body_view(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        self.body_store.runtime_body_view(body_id)
    }

    pub fn iter_runtime_body_views(&self) -> impl Iterator<Item = RuntimeSpatialBodyView> + '_ {
        self.body_store.iter_runtime_body_views()
    }

    pub fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.body_store.body(body_id)
    }

    pub fn body_for_guid(&self, guid: Guid) -> Option<&SpatialBody> {
        self.body_store.body_for_guid(guid)
    }

    pub fn body_mut(&mut self, body_id: SpatialBodyId) -> Option<&mut SpatialBody> {
        self.body_store.body_mut(body_id)
    }

    pub fn register_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.body_store.register_body(body)
    }

    pub fn update_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.body_store.update_body(body)
    }

    pub fn remove_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.body_store.remove_body(body_id)
    }

    pub fn allocate_ephemeral_body_id(&mut self) -> SpatialBodyId {
        self.body_store.allocate_ephemeral_body_id()
    }

    pub fn register_ephemeral_body(&mut self, pose: WorldPosition, now: Instant) -> SpatialBodyId {
        self.body_store.register_ephemeral_body(pose, now)
    }

    pub fn reconcile_authoritative_body(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        sync: AuthoritativeBodySync,
        now: Instant,
    ) {
        let mode = match sync {
            AuthoritativeBodySync::Snapshot => SpatialSampleMode::AuthoritativeOnly,
            AuthoritativeBodySync::Reset => SpatialSampleMode::Suspended,
        };

        let mut body = self
            .body_store
            .remove_body(body_id)
            .unwrap_or_else(|| SpatialBody::new(body_id, pose, now));

        let preserve_local_runtime_pose = matches!(body_id, SpatialBodyId::LocalPlayer(_))
            && matches!(sync, AuthoritativeBodySync::Snapshot)
            && matches!(
                body.sampling.mode,
                SpatialSampleMode::SimulatingMotionState | SpatialSampleMode::SimulatingVelocity
            );

        body.authoritative_pose = Some(pose);
        body.velocity = velocity;
        body.omega = omega;
        body.motion_state = None;
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        if !preserve_local_runtime_pose {
            body.pose = pose;
            body.sampling.mode = mode;
        }

        self.body_store.register_body(body);
    }

    pub fn retire_authoritative_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.body_store.remove_body(body_id)
    }

    #[cfg(test)]
    pub(super) fn upsert_runtime_body_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        let mut body = self
            .body_store
            .remove_body(body_id)
            .unwrap_or_else(|| SpatialBody::new(body_id, pose, now));

        body.authoritative_pose = Some(pose);
        body.pose = pose;
        body.velocity = velocity;
        body.omega = omega;
        body.motion_state = motion_state;
        body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;

        self.body_store.register_body(body);
    }

    #[cfg(test)]
    pub(super) fn seed_authoritative_body_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        self.upsert_runtime_body_snapshot(body_id, pose, velocity, omega, motion_state, now);
    }

    fn set_body_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return;
        };

        body.motion_state = motion_state;
    }

    pub fn update_runtime_body_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        self.set_body_motion_state(body_id, motion_state);
    }

    fn reset_body_from_authority(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
        clear_kinematics: bool,
    ) {
        let body = self
            .body_store
            .bodies
            .entry(body_id)
            .or_insert_with(|| SpatialBody::new(body_id, pose, now));

        body.authoritative_pose = Some(pose);
        body.pose = pose;
        if clear_kinematics {
            body.velocity = Vector3::zero();
            body.omega = Vector3::zero();
            body.motion_state = None;
        }
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
    }

    pub fn apply_runtime_body_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        sample_mode: SpatialSampleMode,
    ) -> bool {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return false;
        };

        body.pose = pose;
        body.sampling.mode = sample_mode;
        true
    }

    pub fn apply_runtime_body_contact(
        &mut self,
        body_id: SpatialBodyId,
        contact: ContactState,
    ) -> bool {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return false;
        };

        body.contact = contact;
        true
    }

    pub fn apply_solved_runtime_body_kinematics(
        &mut self,
        solved: &SolvedBodyKinematics,
    ) -> bool {
        let Some(body) = self.body_store.body_mut(solved.body_id) else {
            return false;
        };

        body.pose = solved.pose;
        body.velocity = solved.velocity;
        body.omega = solved.omega;
        body.contact = solved.contact;
        body.sampling.mode = sample_mode_for_projection_state(
            solved.projection_state,
            solved.velocity,
            solved.omega,
        );
        true
    }

    pub fn apply_forced_reposition_reset(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
    ) {
        self.reset_body_from_authority(body_id, pose, now, true);
        if let Some(body) = self.body_store.body_mut(body_id) {
            body.sampling.mode = SpatialSampleMode::Suspended;
        }
    }

    pub fn suspend_runtime_bodies(&mut self, now: Instant) {
        for body in self.body_store.bodies.values_mut() {
            if let Some(authoritative_pose) = body.authoritative_pose {
                body.pose = authoritative_pose;
            }
            body.sampling.mode = SpatialSampleMode::Suspended;
            body.sampling.last_derived_at = now;
        }
    }

    pub fn update_entity(&mut self, guid: Guid, old_lb: Guid, pose: WorldPosition) {
        let new_lb = pose.landblock_id;
        if old_lb != new_lb
            && let Some(set) = self.landblock_map.get_mut(&old_lb)
        {
            set.remove(&guid);
        }
        self.landblock_map.entry(new_lb).or_default().insert(guid);
        self.entity_poses.insert(guid, pose);
    }

    pub fn remove_entity(&mut self, guid: Guid, lb: Guid) {
        if let Some(set) = self.landblock_map.get_mut(&lb) {
            set.remove(&guid);
        }
        self.entity_poses.remove(&guid);
    }

    /// Find all entities in a given landblock.
    pub fn get_in_landblock(&self, lb: Guid) -> Option<&HashSet<Guid>> {
        self.landblock_map.get(&lb)
    }

    /// Get all entities in the landblock and its 8 immediate neighbors.
    /// Useful for coarse filtering before doing fine-grained distance checks.
    pub fn get_nearby_entities(&self, lb: Guid) -> HashSet<Guid> {
        let mut nearby = HashSet::new();

        let x = (lb >> 24) & 0xFF;
        let y = (lb >> 16) & 0xFF;

        for dx in -1..=1 {
            for dy in -1..=1 {
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                // Outdoor bounds 0x01..0xFE
                if nx > 0 && nx < 255 && ny > 0 && ny < 255 {
                    // Try to add outdoor landblock (identifed by 0xFFFF)
                    let neighbor_lb = ((nx as u32) << 24) | ((ny as u32) << 16) | 0xFFFF;
                    if let Some(set) = self.landblock_map.get(&Guid(neighbor_lb)) {
                        for &guid in set {
                            nearby.insert(guid);
                        }
                    }
                }
            }
        }

        // Also check the specific lb passed (might be an indoor cell)
        if let Some(set) = self.landblock_map.get(&lb) {
            for &guid in set {
                nearby.insert(guid);
            }
        }

        nearby
    }

    /// Query entities within a certain radius.
    pub fn get_entities_in_range(&self, pos: &WorldPosition, radius: f32) -> Vec<Guid> {
        if pos.landblock_id == Guid::NULL || radius < 0.0 {
            return Vec::new();
        }

        self.get_nearby_entities(pos.landblock_id)
            .into_iter()
            .filter(|guid| {
                self.entity_poses
                    .get(guid)
                    .is_some_and(|candidate| pos.distance_to(candidate) <= radius)
            })
            .collect()
    }
}