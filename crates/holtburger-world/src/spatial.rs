use holtburger_common::Guid;
use holtburger_common::Vector3;
use holtburger_common::Quaternion;
use holtburger_common::position::METERS_PER_LANDBLOCK;
use holtburger_common::position::WorldPosition;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use crate::entity::{Entity, EntityMotionDirective, EntityMotionSnapshot};
use smallvec::SmallVec;
use std::collections::{HashMap, HashSet};
use std::f32::consts::{PI, TAU};
use std::sync::Arc;
use std::time::{Duration, Instant};

const EPSILON: f32 = 1e-4;

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
    InterpolatingPosition,
    SimulatingMotionState,
    SimulatingVelocity,
    Suspended,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthoritativeBodySync {
    Snapshot,
    Reset,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpatialInterpolationState {
    pub start_pose: WorldPosition,
    pub started_at: Instant,
    pub duration: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpatialSamplingState {
    pub mode: SpatialSampleMode,
    pub last_authoritative_update: Instant,
    pub last_derived_at: Instant,
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
    pub max_position_interp: Duration,
    pub max_dead_reckon: Duration,
    pub snap_distance_m: u32,
    pub snap_heading_millirad: u32,
}

impl Default for SpatialSamplingConfig {
    fn default() -> Self {
        Self {
            max_position_interp: Duration::from_millis(150),
            max_dead_reckon: Duration::from_millis(250),
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
    pub guid: Guid,
    pub authoritative_pose: WorldPosition,
    pub projected_pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionSnapshot>,
    pub projection_mode: SpatialSampleMode,
    pub last_authoritative_update: Instant,
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
    ContactChanged {
        body_id: SpatialBodyId,
        contact: ContactState,
    },
    ForcedReposition {
        body_id: SpatialBodyId,
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
    pub actor_id: Guid,
    pub pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialSolveRequest {
    pub dt: Duration,
    pub actors: SmallVec<[SolveActorInput; 1]>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolvedActorKinematics {
    pub actor_id: Guid,
    pub pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub contact: ContactState,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SpatialEvent {
    ContactChanged {
        actor_id: Guid,
        contact: ContactState,
    },
    ForcedReposition {
        actor_id: Guid,
        pose: WorldPosition,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialSolveBatch {
    pub solved: SmallVec<[SolvedActorKinematics; 1]>,
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

fn turn_direction(command: InterpretedMotionCommand) -> Option<f32> {
    if command == InterpretedMotionCommand::TURN_RIGHT {
        Some(1.0)
    } else if command == InterpretedMotionCommand::TURN_LEFT {
        Some(-1.0)
    } else {
        None
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
        && let (Some(command), Some(speed)) = (snapshot.turn_command, snapshot.turn_speed)
        && let Some(direction) = turn_direction(command)
    {
        let heading = body.pose.rotation.to_heading();
        body.pose.rotation = Quaternion::from_heading(normalize_heading(
            heading + (direction * speed.to_f32().abs() * dt_secs),
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

/// The SpatialScene is responsible for managing the "where" of everything.
/// Shared runtime sampling state for tracked bodies.
#[derive(Debug, Clone)]
pub struct BodySamplingStore {
    bodies: HashMap<SpatialBodyId, SpatialBody>,
    config: SpatialSamplingConfig,
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
    pub fn config(&self) -> SpatialSamplingConfig {
        self.config
    }

    pub fn set_config(&mut self, config: SpatialSamplingConfig) {
        self.config = config;
    }

    pub fn clear(&mut self) {
        self.bodies.clear();
    }

    pub fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.bodies.get(&body_id)
    }

    pub fn body_for_guid(&self, guid: Guid) -> Option<&SpatialBody> {
        self.body(SpatialBodyId::LocalPlayer(guid))
            .or_else(|| self.body(SpatialBodyId::Entity(guid)))
    }

    pub fn body_mut(&mut self, body_id: SpatialBodyId) -> Option<&mut SpatialBody> {
        self.bodies.get_mut(&body_id)
    }

    pub fn register_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.bodies.insert(body.id, body)
    }

    pub fn update_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        let existing = self.bodies.get_mut(&body.id)?;
        Some(std::mem::replace(existing, body))
    }

    pub fn remove_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.bodies.remove(&body_id)
    }

    pub fn allocate_ephemeral_body_id(&mut self) -> SpatialBodyId {
        let body_id = SpatialBodyId::Ephemeral(self.next_ephemeral_body_id);
        self.next_ephemeral_body_id += 1;
        body_id
    }

    pub fn register_ephemeral_body(&mut self, pose: WorldPosition, now: Instant) -> SpatialBodyId {
        let body_id = self.allocate_ephemeral_body_id();
        self.register_body(SpatialBody::new_ephemeral(body_id, pose, now));
        body_id
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
            .bodies
            .remove(&body_id)
            .unwrap_or_else(|| SpatialBody::new(body_id, pose, now));

        body.authoritative_pose = Some(pose);
        body.pose = pose;
        body.velocity = velocity;
        body.omega = omega;
        body.motion_state = None;
        body.sampling.mode = mode;
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        body.sampling.interpolation = None;

        self.bodies.insert(body_id, body);
    }

    pub fn retire_authoritative_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.remove_body(body_id)
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

    pub fn update_sampling_authoritative_pose(
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

    pub fn update_sampling_kinematics(
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

    pub fn update_sampling_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        let Some(body) = self.bodies.get_mut(&body_id) else {
            return;
        };

        body.motion_state = motion_state;
    }

    pub fn reset_sampling_body(
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

    pub fn suspend_all_sampling(&mut self, now: Instant) {
        for body in self.bodies.values_mut() {
            if let Some(authoritative_pose) = body.authoritative_pose {
                body.pose = authoritative_pose;
            }
            body.sampling.mode = SpatialSampleMode::Suspended;
            body.sampling.interpolation = None;
            body.sampling.last_derived_at = now;
        }
    }

    pub fn tick_sampling(&mut self, now: Instant) {
        let config = self.config;
        for body in self.bodies.values_mut() {
            Self::advance_body_sampling_state(body, now, config);
        }
    }

    pub fn projected_entity_state(&self, guid: Guid) -> Option<SpatialProjectedEntityState> {
        self.body_for_guid(guid)
            .and_then(SpatialBody::projected_entity_state)
    }

    pub fn spatial_sample(&self, guid: Guid) -> Option<SpatialEntitySample> {
        self.body_for_guid(guid).and_then(SpatialBody::spatial_sample)
    }

    pub fn spatial_sample_or_authoritative(&self, entity: &Entity) -> SpatialEntitySample {
        self.spatial_sample(entity.guid)
            .map(|sample| SpatialEntitySample {
                authoritative_pose: entity.position,
                velocity: entity.velocity,
                omega: entity.omega,
                motion_state: entity.motion_snapshot,
                ..sample
            })
            .unwrap_or(SpatialEntitySample {
                guid: entity.guid,
                authoritative_pose: entity.position,
                projected_pose: entity.position,
                velocity: entity.velocity,
                omega: entity.omega,
                motion_state: entity.motion_snapshot,
                projection_mode: SpatialSampleMode::AuthoritativeOnly,
            })
    }

    pub fn remove_guid_bodies(&mut self, guid: Guid) {
        self.bodies.remove(&SpatialBodyId::Entity(guid));
        self.bodies.remove(&SpatialBodyId::LocalPlayer(guid));
    }

    pub fn iter_projected_entities(&self) -> impl Iterator<Item = SpatialProjectedEntityState> + '_ {
        self.bodies
            .values()
            .filter_map(SpatialBody::projected_entity_state)
    }

    fn advance_body_sampling_state(
        body: &mut SpatialBody,
        now: Instant,
        config: SpatialSamplingConfig,
    ) {
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

        let mut mode = SpatialSampleMode::AuthoritativeOnly;
        if body.velocity.length_squared() > EPSILON && elapsed_since_authoritative > Duration::ZERO {
            body.pose = project_pose_by_velocity(
                authoritative_pose,
                body.velocity,
                elapsed_since_authoritative.as_secs_f32(),
            );
            mode = SpatialSampleMode::SimulatingVelocity;
        } else {
            body.pose.coords = authoritative_pose.coords;
        }

        if advance_heading_projection(body, dt) {
            mode = SpatialSampleMode::SimulatingMotionState;
        } else {
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
/// It tracks authoritative entity positions by landblock, hosts solve context, and composes
/// runtime body-sampling state.
#[derive(Clone)]
pub struct SpatialScene {
    /// Entities indexed by LandblockID for fast local queries.
    pub landblock_map: HashMap<Guid, HashSet<Guid>>,
    /// Latest authoritative pose snapshots for narrow spatial queries.
    pub entity_poses: HashMap<Guid, WorldPosition>,
    body_sampling: BodySamplingStore,
    pub physics: Arc<dyn SpatialPhysics>,
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

    pub fn update_sampling_kinematics(
        &mut self,
        body_id: SpatialBodyId,
        velocity: Vector3,
        omega: Vector3,
    ) {
        self.body_sampling
            .update_sampling_kinematics(body_id, velocity, omega);
    }

    pub fn update_sampling_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        self.body_sampling
            .update_sampling_motion_state(body_id, motion_state);
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

    pub fn suspend_all_sampling(&mut self, now: Instant) {
        self.body_sampling.suspend_all_sampling(now);
    }

    pub fn tick_sampling(&mut self, now: Instant) {
        self.body_sampling.tick_sampling(now);
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
    fn noop_spatial_physics_returns_empty_batch() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(NoopSpatialPhysics));
        let request = SpatialSolveRequest {
            dt: Duration::from_millis(30),
            actors: SmallVec::new(),
        };

        let batch = Arc::clone(&scene.physics).solve(&request, &mut scene);

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
}
