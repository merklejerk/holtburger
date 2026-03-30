use holtburger_common::Guid;
use holtburger_common::Vector3;
use holtburger_common::Quaternion;
use holtburger_common::position::METERS_PER_LANDBLOCK;
use holtburger_common::position::WorldPosition;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use crate::entity::{EntityMotionDirective, EntityMotionSnapshot};
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
    /// Runtime pose is blending toward a newer authoritative correction.
    InterpolatingPosition,
    /// Runtime pose is being advanced from motion-state-driven heading simulation.
    SimulatingMotionState,
    /// Runtime pose is being advanced from linear and angular velocity.
    SimulatingVelocity,
    /// Runtime sampling is intentionally paused until a reset or resync resumes it.
    Suspended,
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
pub struct SpatialInterpolationState {
    /// Runtime pose at the moment interpolation began.
    pub start_pose: WorldPosition,
    /// Clock time when interpolation started.
    pub started_at: Instant,
    /// Intended interpolation duration.
    pub duration: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpatialSamplingState {
    /// Current runtime sampling mode for the body.
    pub mode: SpatialSampleMode,
    /// Time of the last authoritative pose update applied to the body.
    pub last_authoritative_update: Instant,
    /// Time the runtime pose was last derived or advanced.
    pub last_derived_at: Instant,
    /// Active interpolation state, if runtime pose is blending toward authority.
    pub interpolation: Option<SpatialInterpolationState>,
}

impl SpatialSamplingState {
    pub fn authoritative(now: Instant) -> Self {
        Self {
            mode: SpatialSampleMode::AuthoritativeOnly,
            last_authoritative_update: now,
            last_derived_at: now,
            interpolation: None,
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
    /// Runtime sampling metadata for interpolation and derivation.
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
}

impl SolvedBodyKinematics {
    pub fn from_actor_kinematics(kinematics: SolvedActorKinematics) -> Self {
        Self {
            body_id: SpatialBodyId::Entity(kinematics.actor_id),
            pose: kinematics.pose,
            velocity: kinematics.velocity,
            omega: kinematics.omega,
            contact: kinematics.contact,
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

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialSolveRequest {
    /// Duration of the solve step.
    pub dt: Duration,
    /// Actor inputs to advance during the solve step.
    pub actors: SmallVec<[SolveActorInput; 1]>,
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

fn interpolate_pose(start: WorldPosition, end: WorldPosition, progress: f32) -> WorldPosition {
    if start.landblock_id != end.landblock_id {
        return end;
    }

    let start_heading = start.rotation.to_heading();
    let end_heading = end.rotation.to_heading();
    let heading = normalize_heading(
        start_heading + (signed_heading_delta(start_heading, end_heading) * progress),
    );

    WorldPosition {
        landblock_id: end.landblock_id,
        coords: start.coords + ((end.coords - start.coords) * progress),
        rotation: Quaternion::from_heading(heading),
    }
}

fn project_pose_by_velocity(
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

fn planar_velocity_for_heading(heading: f32, speed: f32) -> Vector3 {
    Vector3::new(-heading.cos() * speed, heading.sin() * speed, 0.0)
}

fn projected_velocity_from_motion_state(
    snapshot: Option<EntityMotionSnapshot>,
    heading: f32,
) -> Option<Vector3> {
    let snapshot = snapshot?;
    let mut velocity = Vector3::zero();
    let mut has_translation = false;

    if let (Some(command), Some(speed)) = (snapshot.forward_command, snapshot.forward_speed) {
        let speed = speed.to_f32().abs();
        if speed > EPSILON {
            if command == InterpretedMotionCommand::WALK_FORWARD
                || command == InterpretedMotionCommand::RUN_FORWARD
            {
                velocity = velocity + planar_velocity_for_heading(heading, speed);
                has_translation = true;
            } else if command == InterpretedMotionCommand::WALK_BACKWARDS {
                velocity = velocity + planar_velocity_for_heading(normalize_heading(heading + PI), speed);
                has_translation = true;
            }
        }
    }

    if let (Some(command), Some(speed)) = (snapshot.sidestep_command, snapshot.sidestep_speed) {
        let speed = speed.to_f32().abs();
        if speed > EPSILON {
            if command == InterpretedMotionCommand::SIDESTEP_LEFT {
                velocity = velocity
                    + planar_velocity_for_heading(normalize_heading(heading - (PI / 2.0)), speed);
                has_translation = true;
            } else if command == InterpretedMotionCommand::SIDESTEP_RIGHT {
                velocity = velocity
                    + planar_velocity_for_heading(normalize_heading(heading + (PI / 2.0)), speed);
                has_translation = true;
            }
        }
    }

    has_translation.then_some(velocity)
}

fn should_snap_to_authoritative(
    projected: WorldPosition,
    authoritative: WorldPosition,
    snap_distance_m: f32,
    snap_heading_rad: f32,
) -> bool {
    if projected.landblock_id != authoritative.landblock_id {
        return true;
    }

    if projected.coords.distance(&authoritative.coords) > snap_distance_m {
        return true;
    }

    signed_heading_delta(
        projected.rotation.to_heading(),
        authoritative.rotation.to_heading(),
    )
    .abs()
        > snap_heading_rad
}

fn simulated_turn_directive(
    snapshot: Option<EntityMotionSnapshot>,
) -> Option<EntityMotionDirective> {
    match snapshot.and_then(|snapshot| snapshot.directive) {
        Some(EntityMotionDirective::TurnToHeading {
            desired_heading,
            speed,
        }) => Some(EntityMotionDirective::TurnToHeading {
            desired_heading,
            speed,
        }),
        Some(EntityMotionDirective::TurnToObject {
            target,
            desired_heading: Some(desired_heading),
            speed,
        }) => Some(EntityMotionDirective::TurnToObject {
            target,
            desired_heading: Some(desired_heading),
            speed,
        }),
        _ => None,
    }
}

fn advance_turn_toward_heading(
    pose: &mut WorldPosition,
    desired_heading: f32,
    speed: f32,
    dt_secs: f32,
) -> bool {
    let speed = speed.abs();
    if !desired_heading.is_finite() || !speed.is_finite() || speed <= 0.0 || dt_secs <= 0.0 {
        return false;
    }

    let current = pose.rotation.to_heading();
    let delta = signed_heading_delta(current, desired_heading);
    if delta.abs() <= EPSILON {
        pose.rotation = Quaternion::from_heading(normalize_heading(desired_heading));
        return true;
    }

    let max_step = speed * dt_secs;
    let step = delta.clamp(-max_step, max_step);
    pose.rotation = Quaternion::from_heading(normalize_heading(current + step));
    true
}

fn signed_turn_rate(snapshot: EntityMotionSnapshot) -> Option<f32> {
    let speed = snapshot.turn_speed?.to_f32();
    if !speed.is_finite() || speed.abs() <= EPSILON {
        return None;
    }

    if speed < 0.0 {
        return Some(speed);
    }

    match snapshot.turn_command {
        Some(InterpretedMotionCommand::TURN_LEFT) => Some(-speed),
        Some(InterpretedMotionCommand::TURN_RIGHT) | None => Some(speed),
        Some(_) => None,
    }
}

fn advance_heading_projection(body: &mut SpatialBody, dt: Duration) -> bool {
    let dt_secs = dt.as_secs_f32();
    if dt_secs <= 0.0 {
        return false;
    }

    if let Some(directive) = simulated_turn_directive(body.motion_state) {
        let advanced = match directive {
            EntityMotionDirective::TurnToHeading {
                desired_heading,
                speed,
            } => advance_turn_toward_heading(
                &mut body.pose,
                desired_heading.to_f32(),
                speed.to_f32(),
                dt_secs,
            ),
            EntityMotionDirective::TurnToObject {
                desired_heading: Some(desired_heading),
                speed,
                ..
            } => advance_turn_toward_heading(
                &mut body.pose,
                desired_heading.to_f32(),
                speed.to_f32(),
                dt_secs,
            ),
            EntityMotionDirective::TurnToObject {
                desired_heading: None,
                ..
            } => false,
        };

        if advanced {
            return true;
        }
    }

    if let Some(snapshot) = body.motion_state
        && let Some(turn_rate) = signed_turn_rate(snapshot)
    {
        let heading = body.pose.rotation.to_heading();
        body.pose.rotation = Quaternion::from_heading(normalize_heading(
            heading + (turn_rate * dt_secs),
        ));
        return true;
    }

    if body.omega.length_squared() > EPSILON {
        let heading = body.pose.rotation.to_heading();
        body.pose.rotation =
            Quaternion::from_heading(normalize_heading(heading + (body.omega.z * dt_secs)));
        return true;
    }

    false
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
    }
}

#[derive(Debug, Default)]
pub struct BasicSpatialPhysics;

impl SpatialPhysics for BasicSpatialPhysics {
    fn solve(
        &self,
        request: &SpatialSolveRequest,
        _scene: &mut SpatialScene,
    ) -> SpatialSolveBatch {
        let solved = request
            .actors
            .iter()
            .map(|actor| advance_actor_kinematics(actor, request.dt))
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

/// World-owned runtime sampling store for tracked `SpatialBody` sidecars.
///
/// This store is the canonical owner of client runtime body sampling state, including
/// interpolation, dead reckoning, suspension, and forced-reposition resets. Core or frontend
/// caches may mirror reads from this state during migration, but they must not become a second
/// independently advancing runtime body model.
#[derive(Debug, Clone)]
pub(crate) struct BodySamplingStore {
    /// Canonical runtime bodies tracked by the sampling store.
    bodies: HashMap<SpatialBodyId, SpatialBody>,
    /// Sampling policy for interpolation, dead reckoning, and snap thresholds.
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

    fn reconcile_authoritative_body(
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
            .bodies
            .remove(&body_id)
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
        body.sampling.interpolation = None;

        if !preserve_local_runtime_pose {
            body.pose = pose;
            body.sampling.mode = mode;
        }

        self.bodies.insert(body_id, body);
    }

    fn retire_authoritative_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.remove_body(body_id)
    }

    fn upsert_sampling_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        let mut body = self
            .bodies
            .remove(&body_id)
            .unwrap_or_else(|| SpatialBody::new(body_id, pose, now));

        body.authoritative_pose = Some(pose);
        body.pose = pose;
        body.velocity = velocity;
        body.omega = omega;
        body.motion_state = motion_state;
        body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        body.sampling.interpolation = None;

        self.bodies.insert(body_id, body);
    }

    fn seed_authoritative_body_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        self.upsert_sampling_snapshot(body_id, pose, velocity, omega, motion_state, now);
    }

    fn update_sampling_authoritative_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        bootstrap: bool,
        now: Instant,
    ) {
        if bootstrap {
            self.reset_sampling_body(body_id, pose, now, false);
            return;
        }

        let config = self.config;
        let body = self
            .bodies
            .entry(body_id)
            .or_insert_with(|| SpatialBody::new(body_id, pose, now));

        Self::advance_body_sampling_state(body, now, config);
        let should_snap = should_snap_to_authoritative(
            body.pose,
            pose,
            config.snap_distance_meters(),
            config.snap_heading_radians(),
        ) || config.max_position_interp == Duration::ZERO;

        body.authoritative_pose = Some(pose);
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;

        if should_snap {
            body.pose = pose;
            body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
            body.sampling.interpolation = None;
        } else {
            body.sampling.mode = SpatialSampleMode::InterpolatingPosition;
            body.sampling.interpolation = Some(SpatialInterpolationState {
                start_pose: body.pose,
                started_at: now,
                duration: config.max_position_interp,
            });
        }
    }

    fn correct_authoritative_body_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        bootstrap: bool,
        now: Instant,
    ) {
        self.update_sampling_authoritative_pose(body_id, pose, bootstrap, now);
    }

    fn update_sampling_kinematics(
        &mut self,
        body_id: SpatialBodyId,
        velocity: Vector3,
        omega: Vector3,
    ) {
        let Some(body) = self.bodies.get_mut(&body_id) else {
            return;
        };

        body.velocity = velocity;
        body.omega = omega;
    }

    fn update_runtime_body_kinematics(
        &mut self,
        body_id: SpatialBodyId,
        velocity: Vector3,
        omega: Vector3,
    ) {
        self.update_sampling_kinematics(body_id, velocity, omega);
    }

    fn update_sampling_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        let Some(body) = self.bodies.get_mut(&body_id) else {
            return;
        };

        body.motion_state = motion_state;
    }

    fn update_runtime_body_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        self.update_sampling_motion_state(body_id, motion_state);
    }

    fn reset_sampling_body(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
        clear_kinematics: bool,
    ) {
        let body = self
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
        body.sampling.interpolation = None;
    }

    fn reset_runtime_body_from_authoritative(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
        clear_kinematics: bool,
    ) {
        self.reset_sampling_body(body_id, pose, now, clear_kinematics);
    }

    fn apply_runtime_body_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        sample_mode: SpatialSampleMode,
    ) -> bool {
        let Some(body) = self.bodies.get_mut(&body_id) else {
            return false;
        };

        body.pose = pose;
        body.sampling.mode = sample_mode;
        body.sampling.interpolation = None;
        true
    }

    fn apply_runtime_body_vectors(
        &mut self,
        body_id: SpatialBodyId,
        velocity: Vector3,
        omega: Vector3,
        sample_mode: SpatialSampleMode,
    ) -> bool {
        let Some(body) = self.bodies.get_mut(&body_id) else {
            return false;
        };

        body.velocity = velocity;
        body.omega = omega;
        body.sampling.mode = sample_mode;
        body.sampling.interpolation = None;
        true
    }

    fn apply_runtime_body_contact(
        &mut self,
        body_id: SpatialBodyId,
        contact: ContactState,
    ) -> bool {
        let Some(body) = self.bodies.get_mut(&body_id) else {
            return false;
        };

        body.contact = contact;
        true
    }

    fn apply_solved_runtime_body_kinematics(
        &mut self,
        solved: &SolvedBodyKinematics,
    ) -> bool {
        let Some(body) = self.bodies.get_mut(&solved.body_id) else {
            return false;
        };

        body.pose = solved.pose;
        body.velocity = solved.velocity;
        body.omega = solved.omega;
        body.contact = solved.contact;
        body.sampling.mode = if solved.velocity.length_squared() > EPSILON
            || solved.omega.length_squared() > EPSILON
        {
            SpatialSampleMode::SimulatingVelocity
        } else {
            SpatialSampleMode::SimulatingMotionState
        };
        body.sampling.interpolation = None;
        true
    }

    fn apply_forced_reposition_reset(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
    ) {
        self.reset_runtime_body_from_authoritative(body_id, pose, now, true);
        if let Some(body) = self.bodies.get_mut(&body_id) {
            body.sampling.mode = SpatialSampleMode::Suspended;
        }
    }

    fn suspend_all_sampling(&mut self, now: Instant) {
        for body in self.bodies.values_mut() {
            if let Some(authoritative_pose) = body.authoritative_pose {
                body.pose = authoritative_pose;
            }
            body.sampling.mode = SpatialSampleMode::Suspended;
            body.sampling.interpolation = None;
            body.sampling.last_derived_at = now;
        }
    }

    fn suspend_runtime_bodies(&mut self, now: Instant) {
        self.suspend_all_sampling(now);
    }

    fn tick_sampling(&mut self, now: Instant) {
        let config = self.config;
        for body in self.bodies.values_mut() {
            Self::advance_body_sampling_state(body, now, config);
        }
    }

    fn tick_runtime_bodies(&mut self, now: Instant) {
        self.tick_sampling(now);
    }

    #[cfg(test)]
    fn projected_entity_state(&self, guid: Guid) -> Option<SpatialProjectedEntityState> {
        self.body_for_guid(guid)
            .and_then(SpatialBody::projected_entity_state)
    }

    #[cfg(test)]
    fn spatial_sample(&self, guid: Guid) -> Option<SpatialEntitySample> {
        self.body_for_guid(guid).and_then(SpatialBody::spatial_sample)
    }

    fn advance_body_sampling_state(
        body: &mut SpatialBody,
        now: Instant,
        config: SpatialSamplingConfig,
    ) {
        let previous_mode = body.sampling.mode;
        let previous_pose = body.pose;
        let dt = now
            .checked_duration_since(body.sampling.last_derived_at)
            .unwrap_or_default();
        body.sampling.last_derived_at = now;

        if body.sampling.mode == SpatialSampleMode::Suspended {
            return;
        }

        if Self::advance_body_interpolation(body, now) {
            return;
        }

        let authoritative_pose = body.authoritative_pose.unwrap_or(body.pose);
        body.pose.landblock_id = authoritative_pose.landblock_id;

        let elapsed_since_authoritative = now
            .checked_duration_since(body.sampling.last_authoritative_update)
            .unwrap_or_default()
            .min(config.max_dead_reckon);
        let preserve_projected_pose = elapsed_since_authoritative > Duration::ZERO
            && matches!(previous_mode, SpatialSampleMode::SimulatingMotionState | SpatialSampleMode::SimulatingVelocity);

        let mut mode = SpatialSampleMode::AuthoritativeOnly;
        if body.velocity.length_squared() > EPSILON && elapsed_since_authoritative > Duration::ZERO {
            body.pose = project_pose_by_velocity(
                authoritative_pose,
                body.velocity,
                elapsed_since_authoritative.as_secs_f32(),
            );
            mode = SpatialSampleMode::SimulatingVelocity;
        } else if elapsed_since_authoritative > Duration::ZERO
            && let Some(projected_velocity) = projected_velocity_from_motion_state(
                body.motion_state,
                body.pose.rotation.to_heading(),
            )
        {
            body.pose = project_pose_by_velocity(
                authoritative_pose,
                projected_velocity,
                elapsed_since_authoritative.as_secs_f32(),
            );
            mode = SpatialSampleMode::SimulatingMotionState;
        } else if preserve_projected_pose {
            body.pose = previous_pose;
            mode = previous_mode;
        } else {
            body.pose = authoritative_pose;
        }

        if advance_heading_projection(body, dt) {
            mode = SpatialSampleMode::SimulatingMotionState;
        } else if !preserve_projected_pose {
            body.pose.rotation = authoritative_pose.rotation;
        }

        body.sampling.mode = mode;
    }

    fn advance_body_interpolation(body: &mut SpatialBody, now: Instant) -> bool {
        let Some(interpolation) = body.sampling.interpolation else {
            return false;
        };
        let authoritative_pose = body.authoritative_pose.unwrap_or(body.pose);
        let elapsed = now
            .checked_duration_since(interpolation.started_at)
            .unwrap_or_default();
        let progress = if interpolation.duration == Duration::ZERO {
            1.0
        } else {
            (elapsed.as_secs_f32() / interpolation.duration.as_secs_f32()).clamp(0.0, 1.0)
        };

        body.pose = interpolate_pose(interpolation.start_pose, authoritative_pose, progress);

        if progress >= 1.0 {
            body.sampling.interpolation = None;
            body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
        } else {
            body.sampling.mode = SpatialSampleMode::InterpolatingPosition;
        }

        true
    }
}

/// The SpatialScene is responsible for managing the world-owned "where" of everything.
/// It tracks authoritative entity positions by landblock, hosts solve context, and composes the
/// canonical runtime body-sampling state used to derive projected/read-model spatial samples.
#[derive(Clone)]
pub struct SpatialScene {
    /// Entities indexed by LandblockID for fast local queries.
    landblock_map: HashMap<Guid, HashSet<Guid>>,
    /// Latest authoritative pose snapshots for narrow spatial queries.
    entity_poses: HashMap<Guid, WorldPosition>,
    /// Canonical runtime body sampling store owned by the world.
    body_sampling: BodySamplingStore,
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
            body_sampling: BodySamplingStore::default(),
            physics,
        }
    }

    pub fn physics(&self) -> &Arc<dyn SpatialPhysics> {
        &self.physics
    }

    pub fn runtime_sampling_config(&self) -> SpatialSamplingConfig {
        self.body_sampling.config()
    }

    pub fn set_runtime_sampling_config(&mut self, config: SpatialSamplingConfig) {
        self.body_sampling.set_config(config);
    }

    pub fn runtime_body_view(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        self.body_sampling.runtime_body_view(body_id)
    }

    pub fn iter_runtime_body_views(&self) -> impl Iterator<Item = RuntimeSpatialBodyView> + '_ {
        self.body_sampling.iter_runtime_body_views()
    }

    pub fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.body_sampling.body(body_id)
    }

    pub fn body_for_guid(&self, guid: Guid) -> Option<&SpatialBody> {
        self.body_sampling.body_for_guid(guid)
    }

    pub fn body_mut(&mut self, body_id: SpatialBodyId) -> Option<&mut SpatialBody> {
        self.body_sampling.body_mut(body_id)
    }

    pub fn register_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.body_sampling.register_body(body)
    }

    pub fn update_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.body_sampling.update_body(body)
    }

    pub fn remove_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.body_sampling.remove_body(body_id)
    }

    pub fn allocate_ephemeral_body_id(&mut self) -> SpatialBodyId {
        self.body_sampling.allocate_ephemeral_body_id()
    }

    pub fn register_ephemeral_body(&mut self, pose: WorldPosition, now: Instant) -> SpatialBodyId {
        self.body_sampling.register_ephemeral_body(pose, now)
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
        self.body_sampling
            .reconcile_authoritative_body(body_id, pose, velocity, omega, sync, now);
    }

    pub fn retire_authoritative_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.body_sampling.retire_authoritative_body(body_id)
    }

    pub fn upsert_sampling_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        self.body_sampling
            .upsert_sampling_snapshot(body_id, pose, velocity, omega, motion_state, now);
    }

    pub fn seed_authoritative_body_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        self.body_sampling
            .seed_authoritative_body_snapshot(body_id, pose, velocity, omega, motion_state, now);
    }

    pub fn update_sampling_authoritative_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        bootstrap: bool,
        now: Instant,
    ) {
        self.body_sampling
            .update_sampling_authoritative_pose(body_id, pose, bootstrap, now);
    }

    pub fn correct_authoritative_body_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        bootstrap: bool,
        now: Instant,
    ) {
        self.body_sampling
            .correct_authoritative_body_pose(body_id, pose, bootstrap, now);
    }

    pub fn update_sampling_kinematics(
        &mut self,
        body_id: SpatialBodyId,
        velocity: Vector3,
        omega: Vector3,
    ) {
        self.body_sampling
            .update_sampling_kinematics(body_id, velocity, omega);
    }

    pub fn update_runtime_body_kinematics(
        &mut self,
        body_id: SpatialBodyId,
        velocity: Vector3,
        omega: Vector3,
    ) {
        self.body_sampling
            .update_runtime_body_kinematics(body_id, velocity, omega);
    }

    pub fn update_sampling_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        self.body_sampling
            .update_sampling_motion_state(body_id, motion_state);
    }

    pub fn update_runtime_body_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        self.body_sampling
            .update_runtime_body_motion_state(body_id, motion_state);
    }

    pub fn reset_sampling_body(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
        clear_kinematics: bool,
    ) {
        self.body_sampling
            .reset_sampling_body(body_id, pose, now, clear_kinematics);
    }

    pub fn reset_runtime_body_from_authoritative(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
        clear_kinematics: bool,
    ) {
        self.body_sampling
            .reset_runtime_body_from_authoritative(body_id, pose, now, clear_kinematics);
    }

    pub fn apply_runtime_body_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        sample_mode: SpatialSampleMode,
    ) -> bool {
        self.body_sampling
            .apply_runtime_body_pose(body_id, pose, sample_mode)
    }

    pub fn apply_runtime_body_vectors(
        &mut self,
        body_id: SpatialBodyId,
        velocity: Vector3,
        omega: Vector3,
        sample_mode: SpatialSampleMode,
    ) -> bool {
        self.body_sampling
            .apply_runtime_body_vectors(body_id, velocity, omega, sample_mode)
    }

    pub fn apply_runtime_body_contact(
        &mut self,
        body_id: SpatialBodyId,
        contact: ContactState,
    ) -> bool {
        self.body_sampling.apply_runtime_body_contact(body_id, contact)
    }

    pub fn apply_solved_runtime_body_kinematics(
        &mut self,
        solved: &SolvedBodyKinematics,
    ) -> bool {
        self.body_sampling.apply_solved_runtime_body_kinematics(solved)
    }

    pub fn apply_forced_reposition_reset(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
    ) {
        self.body_sampling
            .apply_forced_reposition_reset(body_id, pose, now);
    }

    pub fn suspend_all_sampling(&mut self, now: Instant) {
        self.body_sampling.suspend_all_sampling(now);
    }

    pub fn suspend_runtime_bodies(&mut self, now: Instant) {
        self.body_sampling.suspend_runtime_bodies(now);
    }

    pub fn tick_sampling(&mut self, now: Instant) {
        self.body_sampling.tick_sampling(now);
    }

    pub fn tick_runtime_bodies(&mut self, now: Instant) {
        self.body_sampling.tick_runtime_bodies(now);
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

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::movement::MotionStance;
    use std::time::{Duration, Instant};

    fn make_position(x: f32, y: f32, heading_rad: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x0102_0000),
            coords: Vector3::new(x, y, 0.0),
            rotation: Quaternion::from_heading(heading_rad),
        }
    }

    #[test]
    fn test_spatial_neighbors() {
        let mut scene = SpatialScene::new();
        let guid_a = Guid(0x11223344);
        let guid_b = Guid(0x55667788);

        // Landblock (10, 10)
        let lb_a = (10 << 24) | (10 << 16) | 0xFFFF;
        // Landblock (11, 10) - direct neighbor to the east
        let lb_b = (11 << 24) | (10 << 16) | 0xFFFF;

        scene.update_entity(
            guid_a,
            Guid(lb_a),
            WorldPosition {
                landblock_id: Guid(lb_a),
                ..Default::default()
            },
        );
        scene.update_entity(
            guid_b,
            Guid(lb_b),
            WorldPosition {
                landblock_id: Guid(lb_b),
                ..Default::default()
            },
        );

        let nearby_a = scene.get_nearby_entities(Guid(lb_a));
        assert!(nearby_a.contains(&guid_a));
        assert!(
            nearby_a.contains(&guid_b),
            "Should find neighbor in adjacent landblock"
        );

        // Random landblock (50, 50) - far away
        let lb_far = (50 << 24) | (50 << 16) | 0xFFFF;
        let nearby_far = scene.get_nearby_entities(Guid(lb_far));
        assert!(nearby_far.is_empty());
    }

    #[test]
    fn get_entities_in_range_uses_pose_index() {
        let mut scene = SpatialScene::new();
        let center_guid = Guid(0x1000_0001);
        let near_guid = Guid(0x1000_0002);
        let far_guid = Guid(0x1000_0003);
        let landblock = Guid(0x0A0A_FFFF);
        let center = WorldPosition {
            landblock_id: landblock,
            coords: Vector3::new(10.0, 10.0, 0.0),
            ..Default::default()
        };

        scene.update_entity(center_guid, landblock, center);
        scene.update_entity(
            near_guid,
            landblock,
            WorldPosition {
                landblock_id: landblock,
                coords: Vector3::new(13.0, 14.0, 0.0),
                ..Default::default()
            },
        );
        scene.update_entity(
            far_guid,
            landblock,
            WorldPosition {
                landblock_id: landblock,
                coords: Vector3::new(40.0, 40.0, 0.0),
                ..Default::default()
            },
        );

        let in_range = scene.get_entities_in_range(&center, 6.0);

        assert!(in_range.contains(&center_guid));
        assert!(in_range.contains(&near_guid));
        assert!(!in_range.contains(&far_guid));
    }

    #[test]
    fn project_pose_by_velocity_keeps_indoor_landblock_stable() {
        let authoritative = WorldPosition {
            landblock_id: Guid(0x016C_0155),
            coords: Vector3::new(12.108355, -60.660404, 0.004999995),
            rotation: Quaternion::identity(),
        };

        let projected = project_pose_by_velocity(
            authoritative,
            Vector3::new(8.345838, 15.9404335, 0.0),
            1.0,
        );

        assert_eq!(projected.landblock_id, authoritative.landblock_id);
        assert_eq!(
            projected.coords,
            Vector3::new(20.454193, -44.71997, 0.004999995)
        );
    }

    #[test]
    fn noop_spatial_physics_returns_empty_batch() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(NoopSpatialPhysics));
        let request = SpatialSolveRequest {
            dt: Duration::from_millis(30),
            actors: SmallVec::new(),
        };

        let batch = Arc::clone(scene.physics()).solve(&request, &mut scene);

        assert!(batch.solved.is_empty());
        assert!(batch.events.is_empty());
    }

    #[test]
    fn advance_actor_kinematics_rotates_velocity_with_turn_rate() {
        let input = SolveActorInput {
            actor_id: Guid(0x5000_0001),
            pose: WorldPosition {
                landblock_id: Guid(0x1234_0000),
                coords: Vector3::zero(),
                rotation: Quaternion::from_heading(90.0f32.to_radians()),
            },
            velocity: Vector3::new(0.0, 18.0, 0.0),
            omega: Vector3::new(0.0, 0.0, 90.0f32.to_radians()),
        };

        let solved = advance_actor_kinematics(&input, Duration::from_secs(1));

        assert!((solved.pose.rotation.to_heading().to_degrees() - 180.0).abs() < 1e-4);
        assert!((solved.velocity.x - 18.0).abs() < 1e-4);
        assert!(solved.velocity.y.abs() < 1e-4);
        assert!((solved.pose.coords.x - 18.0).abs() < 1e-4);
        assert!(solved.pose.coords.y.abs() < 1e-4);
        assert_eq!(solved.contact, ContactState::Unknown);
    }

    #[test]
    fn basic_spatial_physics_solves_full_batch() {
        let mut scene = SpatialScene::new();
        let request = SpatialSolveRequest {
            dt: Duration::from_millis(500),
            actors: SmallVec::from_buf([SolveActorInput {
                actor_id: Guid(0x5000_0001),
                pose: WorldPosition {
                    landblock_id: Guid(0x1234_0000),
                    coords: Vector3::new(10.0, 20.0, 30.0),
                    rotation: Quaternion::from_heading(0.0),
                },
                velocity: Vector3::new(-18.0, 0.0, 0.0),
                omega: Vector3::zero(),
            }]),
        };

        let batch = BasicSpatialPhysics.solve(&request, &mut scene);

        assert_eq!(batch.events.len(), 0);
        assert_eq!(batch.solved.len(), 1);
        let solved = batch.solved[0];
        assert_eq!(solved.actor_id, Guid(0x5000_0001));
        assert_eq!(solved.pose.landblock_id, Guid(0x1234_0000));
        assert_eq!(solved.pose.coords, Vector3::new(1.0, 20.0, 30.0));
        assert_eq!(solved.velocity, Vector3::new(-18.0, 0.0, 0.0));
        assert_eq!(solved.omega, Vector3::zero());
        assert_eq!(solved.contact, ContactState::Unknown);
    }

    #[test]
    fn spatial_scene_tracks_body_registration_update_and_removal() {
        let mut scene = SpatialScene::new();
        let now = Instant::now();
        let body_id = SpatialBodyId::Entity(Guid(0x7000_0001));
        let initial_pose = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(1.0, 2.0, 3.0),
            ..Default::default()
        };

        let body = SpatialBody::new(body_id, initial_pose, now);
        assert!(scene.register_body(body.clone()).is_none());

        let stored = scene.body(body_id).expect("body should be registered");
        assert_eq!(stored.pose, initial_pose);
        assert_eq!(stored.authoritative_pose, Some(initial_pose));
        assert_eq!(stored.sampling.mode, SpatialSampleMode::AuthoritativeOnly);

        let mut updated = body;
        updated.pose.coords = Vector3::new(4.0, 5.0, 6.0);
        updated.velocity = Vector3::new(7.0, 8.0, 0.0);
        updated.sampling.mode = SpatialSampleMode::SimulatingVelocity;

        let previous = scene
            .update_body(updated.clone())
            .expect("registered body should update");
        assert_eq!(previous.pose, initial_pose);

        let stored = scene.body(body_id).expect("updated body should remain present");
        assert_eq!(stored.pose.coords, Vector3::new(4.0, 5.0, 6.0));
        assert_eq!(stored.velocity, Vector3::new(7.0, 8.0, 0.0));
        assert_eq!(stored.sampling.mode, SpatialSampleMode::SimulatingVelocity);

        let removed = scene
            .remove_body(body_id)
            .expect("registered body should remove cleanly");
        assert_eq!(removed, updated);
        assert!(scene.body(body_id).is_none());
    }

    #[test]
    fn spatial_scene_allocates_ephemeral_bodies_monotonically() {
        let mut scene = SpatialScene::new();
        let now = Instant::now();
        let pose = WorldPosition {
            landblock_id: Guid(0x4321_0000),
            coords: Vector3::new(9.0, 8.0, 7.0),
            ..Default::default()
        };

        let first = scene.register_ephemeral_body(pose, now);
        let second = scene.register_ephemeral_body(pose, now);

        assert_eq!(first, SpatialBodyId::Ephemeral(1));
        assert_eq!(second, SpatialBodyId::Ephemeral(2));
        assert_eq!(scene.body(first).and_then(|body| body.authoritative_pose), None);
        assert_eq!(scene.body(second).map(|body| body.pose), Some(pose));
    }

    #[test]
    fn body_solver_bridge_supports_guid_backed_inputs_and_rejects_ephemeral_events() {
        let pose = WorldPosition {
            landblock_id: Guid(0x9876_0000),
            coords: Vector3::new(1.0, 1.0, 1.0),
            ..Default::default()
        };

        let entity_body_input = SolveBodyInput {
            body_id: SpatialBodyId::Entity(Guid(0x7000_0001)),
            pose,
            velocity: Vector3::new(2.0, 0.0, 0.0),
            omega: Vector3::new(0.0, 0.0, 3.0),
        };

        let entity_actor_input = entity_body_input
            .into_actor_input()
            .expect("entity body should bridge to Guid-backed actor input");
        assert_eq!(SolveBodyInput::from_actor_input(entity_actor_input), entity_body_input);

        let body_input = SolveBodyInput {
            body_id: SpatialBodyId::LocalPlayer(Guid(0x7000_0002)),
            pose,
            velocity: Vector3::new(2.0, 0.0, 0.0),
            omega: Vector3::new(0.0, 0.0, 3.0),
        };

        let actor_input = body_input
            .into_actor_input()
            .expect("local player should bridge to Guid-backed actor input");
        assert_eq!(actor_input.actor_id, Guid(0x7000_0002));
        assert_eq!(
            SolveBodyInput::from_actor_input(actor_input).body_id,
            SpatialBodyId::Entity(Guid(0x7000_0002))
        );

        let event = SpatialBodyEvent::ForcedReposition {
            body_id: SpatialBodyId::Ephemeral(99),
            pose,
        };
        assert!(event.into_spatial_event().is_none());
    }

    #[test]
    fn reconcile_authoritative_body_resets_sampling_on_forced_reposition() {
        let mut scene = SpatialScene::new();
        let body_id = SpatialBodyId::Entity(Guid(0x7000_0010));
        let start = Instant::now();
        let start_pose = WorldPosition {
            landblock_id: Guid(0x1111_0000),
            coords: Vector3::new(1.0, 2.0, 3.0),
            ..Default::default()
        };
        let reset_pose = WorldPosition {
            landblock_id: Guid(0x2222_0000),
            coords: Vector3::new(9.0, 8.0, 7.0),
            ..Default::default()
        };

        scene.register_body(SpatialBody::new(body_id, start_pose, start));
        scene.reconcile_authoritative_body(
            body_id,
            reset_pose,
            Vector3::new(4.0, 5.0, 6.0),
            Vector3::new(0.0, 0.0, 1.0),
            AuthoritativeBodySync::Reset,
            start + Duration::from_secs(1),
        );

        let body = scene.body(body_id).expect("body should exist after reconcile");
        assert_eq!(body.authoritative_pose, Some(reset_pose));
        assert_eq!(body.pose, reset_pose);
        assert_eq!(body.velocity, Vector3::new(4.0, 5.0, 6.0));
        assert_eq!(body.omega, Vector3::new(0.0, 0.0, 1.0));
        assert_eq!(body.motion_state, None);
        assert_eq!(body.sampling.mode, SpatialSampleMode::Suspended);
        assert_eq!(body.sampling.last_derived_at, start + Duration::from_secs(1));
        assert_eq!(body.sampling.interpolation, None);
    }

    #[test]
    fn body_sampling_store_interpolates_authoritative_corrections() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0001);
        let start_pose = WorldPosition {
            landblock_id: Guid(0x0102_0000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::from_heading(0.0),
        };
        let target_pose = WorldPosition {
            landblock_id: Guid(0x0102_0000),
            coords: Vector3::new(2.0, 0.0, 0.0),
            rotation: Quaternion::from_heading(0.5),
        };

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            start_pose,
            Vector3::zero(),
            Vector3::zero(),
            None,
            now,
        );
        store.update_sampling_authoritative_pose(
            SpatialBodyId::Entity(guid),
            target_pose,
            false,
            now,
        );
        store.tick_sampling(now + Duration::from_millis(75));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::InterpolatingPosition);
        assert!((projected.projected_pose.coords.x - 1.0).abs() < 1e-4);
        assert!((projected.projected_pose.rotation.to_heading() - 0.25).abs() < 1e-4);
    }

    #[test]
    fn body_sampling_store_dead_reckons_and_turns_from_motion_state() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0002);
        let pose = WorldPosition {
            landblock_id: Guid(0x0102_0000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::from_heading(0.0),
        };

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            pose,
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::zero(),
            Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                turn_speed: Some(
                    crate::entity::OrderedMotionSpeed::from_f32(1.0)
                        .expect("speed should encode"),
                ),
                ..Default::default()
            }),
            now,
        );
        store.tick_sampling(now + Duration::from_millis(250));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
        assert!((projected.projected_pose.coords.x - 10.5).abs() < 1e-4);
        assert!((projected.projected_pose.rotation.to_heading() - 0.25).abs() < 1e-4);
    }

    #[test]
    fn body_sampling_store_projects_forward_motion_state_without_velocity() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0002);

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            make_position(10.0, 20.0, PI),
            Vector3::zero(),
            Vector3::zero(),
            Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
                forward_speed: Some(
                    crate::entity::OrderedMotionSpeed::from_f32(4.5)
                        .expect("speed should encode"),
                ),
                ..Default::default()
            }),
            now,
        );

        store.tick_sampling(now + Duration::from_secs(1));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
        assert!((projected.projected_pose.coords.x - 14.5).abs() < 1e-4);
        assert!((projected.projected_pose.coords.y - 20.0).abs() < 1e-4);
    }

    #[test]
    fn body_sampling_store_preserves_projected_translation_across_turn_only_update() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0102);

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            make_position(10.0, 20.0, PI),
            Vector3::zero(),
            Vector3::zero(),
            Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
                forward_speed: Some(
                    crate::entity::OrderedMotionSpeed::from_f32(4.5)
                        .expect("speed should encode"),
                ),
                turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                turn_speed: Some(
                    crate::entity::OrderedMotionSpeed::from_f32(1.0)
                        .expect("speed should encode"),
                ),
                ..Default::default()
            }),
            now,
        );

        let projected_at_run = now + Duration::from_millis(800);
        store.tick_sampling(projected_at_run);
        let projected_before_turn_only = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert!(projected_before_turn_only.projected_pose.coords.x > 13.0);

        store.update_runtime_body_motion_state(
            SpatialBodyId::Entity(guid),
            Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                turn_speed: Some(
                    crate::entity::OrderedMotionSpeed::from_f32(1.0)
                        .expect("speed should encode"),
                ),
                ..Default::default()
            }),
        );

        store.tick_sampling(projected_at_run + Duration::from_millis(30));

        let projected_after_turn_only = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(
            projected_after_turn_only.projection_mode,
            SpatialSampleMode::SimulatingMotionState
        );
        assert!(
            projected_after_turn_only.projected_pose.coords.x > 13.0,
            "turn-only updates should not snap projected translation back to authority"
        );
        assert!(
            projected_after_turn_only.projected_pose.coords.x
                >= projected_before_turn_only.projected_pose.coords.x - 0.2
        );
        assert!(
            projected_after_turn_only.projected_pose.rotation.to_heading()
                > projected_before_turn_only.projected_pose.rotation.to_heading()
        );
    }

    #[test]
    fn body_sampling_store_velocity_updates_drive_dead_reckoning_between_authoritative_moves() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0003);

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            make_position(10.0, 20.0, 0.0),
            Vector3::zero(),
            Vector3::zero(),
            None,
            now,
        );
        store.update_sampling_kinematics(
            SpatialBodyId::Entity(guid),
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::zero(),
        );

        store.tick_sampling(now + Duration::from_millis(250));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingVelocity);
        assert!((projected.projected_pose.coords.x - 10.5).abs() < 1e-4);
    }

    #[test]
    fn body_sampling_store_velocity_dead_reckoning_crosses_landblock_boundaries_in_global_space() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0004);

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            WorldPosition {
                landblock_id: Guid(0x0102_0000),
                coords: Vector3::new(191.8, 20.0, 0.0),
                rotation: Quaternion::identity(),
            },
            Vector3::zero(),
            Vector3::zero(),
            None,
            now,
        );
        store.update_sampling_kinematics(
            SpatialBodyId::Entity(guid),
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::zero(),
        );

        store.tick_sampling(now + Duration::from_millis(250));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingVelocity);
        assert_eq!(projected.projected_pose.landblock_id, Guid(0x0202_0000));
        assert!((projected.projected_pose.coords.x - 0.3).abs() < 1e-4);
        assert!((projected.projected_pose.coords.y - 20.0).abs() < 1e-4);
    }

    #[test]
    fn body_sampling_store_continuous_turn_commands_advance_heading_over_time() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0005);

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            make_position(0.0, 0.0, 0.0),
            Vector3::zero(),
            Vector3::zero(),
            Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                turn_speed: Some(
                    crate::entity::OrderedMotionSpeed::from_f32(1.0)
                        .expect("speed should encode"),
                ),
                ..Default::default()
            }),
            now,
        );

        store.tick_sampling(now + Duration::from_secs(1));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
        assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn body_sampling_store_negative_turn_speed_rotates_left_from_canonical_turn_command() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0007);

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            make_position(0.0, 0.0, 0.0),
            Vector3::zero(),
            Vector3::zero(),
            Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                turn_speed: Some(
                    crate::entity::OrderedMotionSpeed::from_f32(-1.0)
                        .expect("speed should encode"),
                ),
                ..Default::default()
            }),
            now,
        );

        store.tick_sampling(now + Duration::from_secs(1));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
        assert!((projected.projected_pose.rotation.to_heading() - normalize_heading(TAU - 1.0)).abs() < 1e-4);
    }

    #[test]
    fn body_sampling_store_turn_to_heading_rotates_toward_target_without_snapping() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0006);

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            make_position(0.0, 0.0, 0.0),
            Vector3::zero(),
            Vector3::zero(),
            Some(EntityMotionSnapshot {
                directive: Some(EntityMotionDirective::TurnToHeading {
                    desired_heading: crate::entity::OrderedMotionSpeed::from_f32(2.0)
                        .expect("heading should encode"),
                    speed: crate::entity::OrderedMotionSpeed::from_f32(1.0)
                        .expect("speed should encode"),
                }),
                ..Default::default()
            }),
            now,
        );

        store.tick_sampling(now + Duration::from_secs(1));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
        assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn body_sampling_store_completed_turn_keeps_authoritative_directive_visible() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0007);
        let directive = EntityMotionDirective::TurnToHeading {
            desired_heading: crate::entity::OrderedMotionSpeed::from_f32(1.0)
                .expect("heading should encode"),
            speed: crate::entity::OrderedMotionSpeed::from_f32(1.0)
                .expect("speed should encode"),
        };

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            make_position(0.0, 0.0, 0.0),
            Vector3::zero(),
            Vector3::zero(),
            Some(EntityMotionSnapshot {
                directive: Some(directive),
                ..Default::default()
            }),
            now,
        );

        store.tick_sampling(now + Duration::from_secs(1));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(
            projected.motion_state.and_then(|snapshot| snapshot.directive),
            Some(directive)
        );
        assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);

        store.tick_sampling(now + Duration::from_secs(2));

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(
            projected.motion_state.and_then(|snapshot| snapshot.directive),
            Some(directive)
        );
        assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
        assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn body_sampling_store_large_authoritative_corrections_snap_instead_of_interpolating() {
        let mut store = BodySamplingStore::default();
        store.set_config(SpatialSamplingConfig {
            snap_distance_m: 1,
            ..SpatialSamplingConfig::default()
        });
        let now = Instant::now();
        let guid = Guid(0x7100_0008);

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            make_position(0.0, 0.0, 0.0),
            Vector3::zero(),
            Vector3::zero(),
            None,
            now,
        );
        store.update_sampling_authoritative_pose(
            SpatialBodyId::Entity(guid),
            make_position(10.0, 0.0, 0.0),
            false,
            now,
        );

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::AuthoritativeOnly);
        assert_eq!(projected.projected_pose.coords.x, 10.0);
    }

    #[test]
    fn body_sampling_store_spatial_sample_is_coherent_after_bootstrap_move() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let guid = Guid(0x7100_0009);

        store.update_sampling_authoritative_pose(
            SpatialBodyId::Entity(guid),
            make_position(4.0, 5.0, 0.75),
            true,
            now,
        );

        let sample = store.spatial_sample(guid).expect("sample should exist");
        assert_eq!(sample.projection_mode, SpatialSampleMode::AuthoritativeOnly);
        assert_eq!(sample.authoritative_pose, make_position(4.0, 5.0, 0.75));
        assert_eq!(sample.projected_pose, make_position(4.0, 5.0, 0.75));
    }

    #[test]
    fn body_sampling_store_authoritative_move_interpolates_from_current_simulated_pose() {
        let mut store = BodySamplingStore::default();
        store.set_config(SpatialSamplingConfig {
            max_position_interp: Duration::from_millis(200),
            ..SpatialSamplingConfig::default()
        });
        let start = Instant::now();
        let guid = Guid(0x7100_000A);

        store.upsert_sampling_snapshot(
            SpatialBodyId::Entity(guid),
            make_position(0.0, 0.0, 0.0),
            Vector3::zero(),
            Vector3::zero(),
            None,
            start,
        );
        store.update_sampling_kinematics(
            SpatialBodyId::Entity(guid),
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::zero(),
        );
        store.update_sampling_authoritative_pose(
            SpatialBodyId::Entity(guid),
            make_position(1.0, 0.0, 0.0),
            false,
            start + Duration::from_millis(100),
        );

        let projected = store
            .projected_entity_state(guid)
            .expect("entity should have projected state");
        assert_eq!(projected.projection_mode, SpatialSampleMode::InterpolatingPosition);
        assert!((projected.projected_pose.coords.x - 0.2).abs() < 1e-4);
    }

    #[test]
    fn spatial_scene_runtime_body_views_include_entity_local_player_and_ephemeral_bodies() {
        let mut scene = SpatialScene::new();
        let now = Instant::now();
        let entity_id = SpatialBodyId::Entity(Guid(0x7100_0010));
        let player_id = SpatialBodyId::LocalPlayer(Guid(0x7100_0011));

        scene.register_body(SpatialBody::new(entity_id, make_position(1.0, 2.0, 0.0), now));
        scene.register_body(SpatialBody::new(player_id, make_position(3.0, 4.0, 0.5), now));
        let ephemeral_id = scene.register_ephemeral_body(make_position(5.0, 6.0, 1.0), now);

        let views: Vec<_> = scene.iter_runtime_body_views().collect();

        assert_eq!(views.len(), 3);
        assert!(views.iter().any(|view| view.body_id == entity_id));
        assert!(views.iter().any(|view| view.body_id == player_id));
        assert!(views.iter().any(|view| view.body_id == ephemeral_id));
    }

    #[test]
    fn forced_reposition_reset_clears_runtime_motion_and_suspends_body() {
        let mut store = BodySamplingStore::default();
        let now = Instant::now();
        let body_id = SpatialBodyId::Entity(Guid(0x7100_0012));

        store.seed_authoritative_body_snapshot(
            body_id,
            make_position(1.0, 2.0, 0.0),
            Vector3::new(3.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 1.0),
            Some(EntityMotionSnapshot {
                turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                ..Default::default()
            }),
            now,
        );

        store.apply_forced_reposition_reset(body_id, make_position(8.0, 9.0, 0.25), now);

        let body = store.body(body_id).expect("body should remain tracked");
        assert_eq!(body.pose, make_position(8.0, 9.0, 0.25));
        assert_eq!(body.authoritative_pose, Some(make_position(8.0, 9.0, 0.25)));
        assert_eq!(body.velocity, Vector3::zero());
        assert_eq!(body.omega, Vector3::zero());
        assert_eq!(body.motion_state, None);
        assert_eq!(body.sampling.mode, SpatialSampleMode::Suspended);
    }
}
