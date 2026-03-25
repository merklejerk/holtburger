//! Client-owned motion projection for render and presentation consumers.
//!
//! The world layer remains authoritative. Consumers feed [`ClientViewEvent`] deltas into an
//! [`EntityProjectionSystem`], tick it with their frame time, and then pull projected poses for
//! scene updates. Gameplay and authority checks should continue to read from authoritative world
//! state unless a caller deliberately opts into projected visuals.
//!
//! Typical render-loop usage:
//!
//! ```rust,ignore
//! use std::time::Instant;
//! use holtburger_core::client::projection::{EntityProjectionSystem, ProjectionConfig};
//! use holtburger_core::client::types::ClientViewEvent;
//!
//! struct SceneFrame {
//!     projection: EntityProjectionSystem,
//! }
//!
//! impl SceneFrame {
//!     fn on_view_event(&mut self, event: &ClientViewEvent) {
//!         self.projection.handle_view_event(event, Instant::now());
//!     }
//!
//!     fn render(&mut self, now: Instant) {
//!         self.projection.tick(now);
//!
//!         for entity in self.projection.iter_projected_entities() {
//!             self.update_scene_node(entity.guid, entity.projected_pose);
//!         }
//!     }
//!
//!     fn update_scene_node(
//!         &mut self,
//!         guid: holtburger_common::Guid,
//!         pose: holtburger_common::position::WorldPosition,
//!     ) {
//!         let _ = (guid, pose);
//!     }
//! }
//!
//! let _ = ProjectionConfig::default();
//! ```

use crate::client::types::ClientViewEvent;
use holtburger_common::math::Quaternion;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use holtburger_world::entity::{Entity, EntityMotionDirective, EntityMotionSnapshot};
use std::collections::HashMap;
use std::f32::consts::{PI, TAU};
use std::time::{Duration, Instant};

const EPSILON: f32 = 1e-4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionMode {
    AuthoritativeOnly,
    InterpolatingPosition,
    SimulatingMotionState,
    SimulatingVelocity,
    Suspended,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProjectedEntityState {
    pub guid: Guid,
    pub authoritative_pose: WorldPosition,
    pub projected_pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionSnapshot>,
    pub projection_mode: ProjectionMode,
    pub last_authoritative_update: Instant,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EntitySpatialSample {
    pub guid: Guid,
    pub authoritative_pose: WorldPosition,
    pub projected_pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub motion_state: Option<EntityMotionSnapshot>,
    pub projection_mode: ProjectionMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectionConfig {
    pub max_position_interp: Duration,
    pub max_dead_reckon: Duration,
    pub snap_distance_m: u32,
    pub snap_heading_millirad: u32,
}

impl ProjectionConfig {
    pub fn snap_distance_meters(self) -> f32 {
        self.snap_distance_m as f32
    }

    pub fn snap_heading_radians(self) -> f32 {
        self.snap_heading_millirad as f32 / 1000.0
    }
}

impl Default for ProjectionConfig {
    fn default() -> Self {
        Self {
            max_position_interp: Duration::from_millis(150),
            max_dead_reckon: Duration::from_millis(250),
            snap_distance_m: 3,
            snap_heading_millirad: 785,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct EntityProjectionSystem {
    config: ProjectionConfig,
    entities: HashMap<Guid, TrackedEntityProjection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrackingState {
    AuthoritativeOnly,
    Projecting,
    Suspended,
}

#[derive(Debug, Clone)]
struct TrackedEntityProjection {
    tracking_state: TrackingState,
    inputs: ProjectionInputs,
    public_state: ProjectedEntityState,
    last_derived_at: Instant,
}

#[derive(Debug, Clone)]
struct ProjectionInputs {
    authoritative_pose: WorldPosition,
    last_authoritative_update: Instant,
    velocity: Vector3,
    omega: Vector3,
    motion_state: Option<EntityMotionSnapshot>,
    interpolation: Option<PositionInterpolation>,
}

#[derive(Debug, Clone, Copy)]
struct PositionInterpolation {
    start_pose: WorldPosition,
    started_at: Instant,
    duration: Duration,
}

#[derive(Debug, Clone, Copy)]
enum ProjectionInputEvent {
    Snapshot {
        guid: Guid,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
    },
    AuthoritativePose {
        guid: Guid,
        pose: WorldPosition,
        bootstrap: bool,
    },
    Kinematics {
        guid: Guid,
        velocity: Vector3,
        omega: Vector3,
    },
    MotionState {
        guid: Guid,
        snapshot: Option<EntityMotionSnapshot>,
    },
    Reset {
        guid: Guid,
        pose: WorldPosition,
        clear_kinematics: bool,
    },
    SuspendAll,
    Despawn {
        guid: Guid,
    },
}

impl EntityProjectionSystem {
    pub fn new(config: ProjectionConfig) -> Self {
        Self {
            config,
            entities: HashMap::new(),
        }
    }

    pub fn handle_view_event(&mut self, event: &ClientViewEvent, now: Instant) {
        let input = match event {
            ClientViewEvent::EntitySpawned { entity }
            | ClientViewEvent::EntityReplaced { entity }
            | ClientViewEvent::EntityIdentified { entity } => Some(ProjectionInputEvent::Snapshot {
                guid: entity.guid,
                pose: entity.position,
                velocity: entity.velocity,
                omega: entity.omega,
                motion_state: entity.motion_snapshot,
            }),
            ClientViewEvent::EntityMoved { guid, pos } => Some(ProjectionInputEvent::AuthoritativePose {
                guid: *guid,
                pose: *pos,
                bootstrap: !self.entities.contains_key(guid),
            }),
            ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity,
                omega,
            } => Some(ProjectionInputEvent::Kinematics {
                guid: *guid,
                velocity: *velocity,
                omega: *omega,
            }),
            ClientViewEvent::EntityMotionUpdated { guid, snapshot } => Some(ProjectionInputEvent::MotionState {
                guid: *guid,
                snapshot: *snapshot,
            }),
            ClientViewEvent::ForcedReposition { guid, pos, .. } => Some(ProjectionInputEvent::Reset {
                guid: *guid,
                pose: *pos,
                clear_kinematics: true,
            }),
            ClientViewEvent::TeleportStarted { .. } => Some(ProjectionInputEvent::SuspendAll),
            ClientViewEvent::EntityDespawned { guid } => Some(ProjectionInputEvent::Despawn { guid: *guid }),
            _ => None,
        };

        if let Some(input) = input {
            self.apply_projection_input(input, now);
        }
    }

    pub fn tick(&mut self, now: Instant) {
        let config = self.config;
        for tracked in self.entities.values_mut() {
            Self::advance_projection_state(tracked, now, config);
        }
    }

    pub fn reset_entity(&mut self, guid: Guid) {
        self.entities.remove(&guid);
    }

    pub fn clear(&mut self) {
        self.entities.clear();
    }

    pub fn projected_entity(&self, guid: Guid) -> Option<&ProjectedEntityState> {
        self.entities.get(&guid).map(|tracked| &tracked.public_state)
    }

    pub fn spatial_sample(&self, guid: Guid) -> Option<EntitySpatialSample> {
        self.projected_entity(guid).map(EntitySpatialSample::from)
    }

    pub fn spatial_sample_or_authoritative(&self, entity: &Entity) -> EntitySpatialSample {
        if let Some(sample) = self.spatial_sample(entity.guid) {
            EntitySpatialSample {
                authoritative_pose: entity.position,
                velocity: entity.velocity,
                omega: entity.omega,
                motion_state: entity.motion_snapshot,
                ..sample
            }
        } else {
            EntitySpatialSample {
                guid: entity.guid,
                authoritative_pose: entity.position,
                projected_pose: entity.position,
                velocity: entity.velocity,
                omega: entity.omega,
                motion_state: entity.motion_snapshot,
                projection_mode: ProjectionMode::AuthoritativeOnly,
            }
        }
    }

    pub fn projected_pose(&self, guid: Guid) -> Option<WorldPosition> {
        self.projected_entity(guid).map(|entity| entity.projected_pose)
    }

    pub fn authoritative_pose(&self, guid: Guid) -> Option<WorldPosition> {
        self.projected_entity(guid)
            .map(|entity| entity.authoritative_pose)
    }

    /// Returns the current projected scene view for batch consumers such as renderers.
    ///
    /// Each item retains both authoritative and projected poses so callers can update visual
    /// transforms from `projected_pose` without losing access to the last server-authored pose.
    pub fn iter_projected_entities(&self) -> impl Iterator<Item = &ProjectedEntityState> {
        self.entities.values().map(|tracked| &tracked.public_state)
    }

    fn ensure_entity(
        &mut self,
        guid: Guid,
        authoritative_pose: WorldPosition,
        now: Instant,
    ) -> &mut TrackedEntityProjection {
        self.entities
            .entry(guid)
            .or_insert_with(|| TrackedEntityProjection::new(guid, authoritative_pose, now))
    }

    fn apply_projection_input(&mut self, input: ProjectionInputEvent, now: Instant) {
        match input {
            ProjectionInputEvent::Snapshot {
                guid,
                pose,
                velocity,
                omega,
                motion_state,
            } => self.apply_authoritative_snapshot(guid, pose, velocity, omega, motion_state, now),
            ProjectionInputEvent::AuthoritativePose {
                guid,
                pose,
                bootstrap,
            } => self.apply_authoritative_pose(guid, pose, bootstrap, now),
            ProjectionInputEvent::Kinematics {
                guid,
                velocity,
                omega,
            } => {
                if let Some(tracked) = self.entities.get_mut(&guid) {
                    tracked.inputs.velocity = velocity;
                    tracked.inputs.omega = omega;
                    tracked.sync_public_inputs();
                }
            }
            ProjectionInputEvent::MotionState { guid, snapshot } => {
                if let Some(tracked) = self.entities.get_mut(&guid) {
                    tracked.inputs.motion_state = snapshot;
                    tracked.sync_public_inputs();
                }
            }
            ProjectionInputEvent::Reset {
                guid,
                pose,
                clear_kinematics,
            } => {
                let tracked = self.ensure_entity(guid, pose, now);
                Self::reset_tracking_state(tracked, pose, now, clear_kinematics);
            }
            ProjectionInputEvent::SuspendAll => {
                for tracked in self.entities.values_mut() {
                    Self::suspend_tracking_state(tracked, now);
                }
            }
            ProjectionInputEvent::Despawn { guid } => {
                self.entities.remove(&guid);
            }
        }
    }

    fn apply_authoritative_snapshot(
        &mut self,
        guid: Guid,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        let tracked = self.ensure_entity(guid, pose, now);
        Self::reset_tracking_state(tracked, pose, now, false);
        tracked.inputs.velocity = velocity;
        tracked.inputs.omega = omega;
        tracked.inputs.motion_state = motion_state;
        tracked.sync_public_inputs();
    }

    fn apply_authoritative_pose(&mut self, guid: Guid, pos: WorldPosition, bootstrap: bool, now: Instant) {
        if bootstrap {
            let tracked = self.ensure_entity(guid, pos, now);
            Self::reset_tracking_state(tracked, pos, now, false);
            return;
        }

        self.update_authoritative_pose(guid, pos, now);
    }

    fn update_authoritative_pose(&mut self, guid: Guid, pos: WorldPosition, now: Instant) {
        let config = self.config;
        let snap_distance = config.snap_distance_meters();
        let snap_heading = config.snap_heading_radians();
        let max_interp = config.max_position_interp;
        let tracked = self.ensure_entity(guid, pos, now);
        Self::advance_projection_state(tracked, now, config);
        let should_snap = should_snap_to_authoritative(
            tracked.public_state.projected_pose,
            pos,
            snap_distance,
            snap_heading,
        ) || max_interp == Duration::ZERO;

        tracked.inputs.authoritative_pose = pos;
        tracked.inputs.last_authoritative_update = now;
        tracked.sync_public_inputs();
        tracked.last_derived_at = now;

        if should_snap {
            tracked.tracking_state = TrackingState::AuthoritativeOnly;
            tracked.public_state.projected_pose = pos;
            tracked.public_state.projection_mode = ProjectionMode::AuthoritativeOnly;
            tracked.inputs.interpolation = None;
        } else {
            tracked.tracking_state = TrackingState::Projecting;
            tracked.public_state.projection_mode = ProjectionMode::InterpolatingPosition;
            tracked.inputs.interpolation = Some(PositionInterpolation {
                start_pose: tracked.public_state.projected_pose,
                started_at: now,
                duration: max_interp,
            });
        }
    }

    fn reset_tracking_state(
        tracked: &mut TrackedEntityProjection,
        pose: WorldPosition,
        now: Instant,
        clear_kinematics: bool,
    ) {
        tracked.inputs.authoritative_pose = pose;
        if clear_kinematics {
            tracked.inputs.velocity = Vector3::zero();
            tracked.inputs.omega = Vector3::zero();
            tracked.inputs.motion_state = None;
        }
        tracked.inputs.last_authoritative_update = now;
        tracked.inputs.interpolation = None;
        tracked.tracking_state = TrackingState::AuthoritativeOnly;
        tracked.sync_public_inputs();
        tracked.public_state.projected_pose = pose;
        tracked.public_state.projection_mode = ProjectionMode::AuthoritativeOnly;
        tracked.last_derived_at = now;
    }

    fn suspend_tracking_state(tracked: &mut TrackedEntityProjection, now: Instant) {
        tracked.public_state.projected_pose = tracked.inputs.authoritative_pose;
        tracked.tracking_state = TrackingState::Suspended;
        tracked.public_state.projection_mode = ProjectionMode::Suspended;
        tracked.inputs.interpolation = None;
        tracked.last_derived_at = now;
    }

    fn advance_projection_state(
        tracked: &mut TrackedEntityProjection,
        now: Instant,
        config: ProjectionConfig,
    ) {
        let dt = now
            .checked_duration_since(tracked.last_derived_at)
            .unwrap_or_default();
        tracked.last_derived_at = now;

        tracked.sync_public_inputs();

        if tracked.tracking_state == TrackingState::Suspended {
            tracked.public_state.projection_mode = ProjectionMode::Suspended;
            return;
        }

        if Self::advance_interpolation(tracked, now) {
            return;
        }

        let mut mode = ProjectionMode::AuthoritativeOnly;
        let authoritative_pose = tracked.inputs.authoritative_pose;
        tracked.public_state.projected_pose.landblock_id = authoritative_pose.landblock_id;

        let elapsed_since_authoritative = now
            .checked_duration_since(tracked.inputs.last_authoritative_update)
            .unwrap_or_default()
            .min(config.max_dead_reckon);

        if tracked.inputs.velocity.length_squared() > EPSILON
            && elapsed_since_authoritative > Duration::ZERO
        {
            tracked.public_state.projected_pose.coords = authoritative_pose.coords
                + tracked.inputs.velocity * elapsed_since_authoritative.as_secs_f32();
            mode = ProjectionMode::SimulatingVelocity;
        } else {
            tracked.public_state.projected_pose.coords = authoritative_pose.coords;
        }

        let simulated_heading = Self::advance_heading_projection(tracked, dt);
        if simulated_heading {
            tracked.tracking_state = TrackingState::Projecting;
            mode = ProjectionMode::SimulatingMotionState;
        } else {
            tracked.public_state.projected_pose.rotation = authoritative_pose.rotation;
            tracked.tracking_state = if mode == ProjectionMode::AuthoritativeOnly {
                TrackingState::AuthoritativeOnly
            } else {
                TrackingState::Projecting
            };
        }

        tracked.public_state.projection_mode = mode;
    }

    fn advance_interpolation(tracked: &mut TrackedEntityProjection, now: Instant) -> bool {
        let Some(interpolation) = tracked.inputs.interpolation else {
            return false;
        };

        let elapsed = now
            .checked_duration_since(interpolation.started_at)
            .unwrap_or_default();
        let progress = if interpolation.duration == Duration::ZERO {
            1.0
        } else {
            (elapsed.as_secs_f32() / interpolation.duration.as_secs_f32()).clamp(0.0, 1.0)
        };

        tracked.public_state.projected_pose = interpolate_pose(
            interpolation.start_pose,
            tracked.inputs.authoritative_pose,
            progress,
        );

        if progress >= 1.0 {
            tracked.inputs.interpolation = None;
            tracked.tracking_state = TrackingState::AuthoritativeOnly;
            tracked.public_state.projection_mode = ProjectionMode::AuthoritativeOnly;
        } else {
            tracked.tracking_state = TrackingState::Projecting;
            tracked.public_state.projection_mode = ProjectionMode::InterpolatingPosition;
        }

        true
    }

    fn advance_heading_projection(tracked: &mut TrackedEntityProjection, dt: Duration) -> bool {
        let dt_secs = dt.as_secs_f32();
        if dt_secs <= 0.0 {
            return false;
        }

        if let Some(snapshot) = &mut tracked.inputs.motion_state {
            if let Some(directive) = snapshot.directive {
                let advanced = match directive {
                    EntityMotionDirective::TurnToHeading {
                        desired_heading,
                        speed,
                    } => advance_turn_toward_heading(
                        &mut tracked.public_state.projected_pose,
                        desired_heading.to_f32(),
                        speed.to_f32(),
                        dt_secs,
                    ),
                    EntityMotionDirective::TurnToObject {
                        desired_heading: Some(desired_heading),
                        speed,
                        ..
                    } => advance_turn_toward_heading(
                        &mut tracked.public_state.projected_pose,
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
                    let desired_heading = match directive {
                        EntityMotionDirective::TurnToHeading { desired_heading, .. } => {
                            Some(desired_heading.to_f32())
                        }
                        EntityMotionDirective::TurnToObject {
                            desired_heading, ..
                        } => desired_heading.map(|heading| heading.to_f32()),
                    };

                    if desired_heading.is_some_and(|heading| {
                        signed_heading_delta(
                            tracked.public_state.projected_pose.rotation.to_heading(),
                            heading,
                        )
                        .abs()
                            <= EPSILON
                    }) {
                        snapshot.directive = None;
                    }

                    return true;
                }
            }

            if let (Some(command), Some(speed)) = (snapshot.turn_command, snapshot.turn_speed)
                && let Some(direction) = turn_direction(command)
            {
                let heading = tracked.public_state.projected_pose.rotation.to_heading();
                tracked.public_state.projected_pose.rotation =
                    Quaternion::from_heading(normalize_heading(
                        heading + (direction * speed.to_f32().abs() * dt_secs),
                    ));
                return true;
            }
        }

        if tracked.inputs.omega.length_squared() > EPSILON {
            let heading = tracked.public_state.projected_pose.rotation.to_heading();
            tracked.public_state.projected_pose.rotation =
                Quaternion::from_heading(normalize_heading(
                    heading + (tracked.inputs.omega.z * dt_secs),
                ));
            return true;
        }

        false
    }
}

impl TrackedEntityProjection {
    fn new(guid: Guid, authoritative_pose: WorldPosition, now: Instant) -> Self {
        Self {
            tracking_state: TrackingState::AuthoritativeOnly,
            inputs: ProjectionInputs {
                authoritative_pose,
                last_authoritative_update: now,
                velocity: Vector3::zero(),
                omega: Vector3::zero(),
                motion_state: None,
                interpolation: None,
            },
            public_state: ProjectedEntityState {
                guid,
                authoritative_pose,
                projected_pose: authoritative_pose,
                velocity: Vector3::zero(),
                omega: Vector3::zero(),
                motion_state: None,
                projection_mode: ProjectionMode::AuthoritativeOnly,
                last_authoritative_update: now,
            },
            last_derived_at: now,
        }
    }

    fn sync_public_inputs(&mut self) {
        self.public_state.authoritative_pose = self.inputs.authoritative_pose;
        self.public_state.velocity = self.inputs.velocity;
        self.public_state.omega = self.inputs.omega;
        self.public_state.motion_state = self.inputs.motion_state;
        self.public_state.last_authoritative_update = self.inputs.last_authoritative_update;
    }
}

impl From<&ProjectedEntityState> for EntitySpatialSample {
    fn from(value: &ProjectedEntityState) -> Self {
        Self {
            guid: value.guid,
            authoritative_pose: value.authoritative_pose,
            projected_pose: value.projected_pose,
            velocity: value.velocity,
            omega: value.omega,
            motion_state: value.motion_state,
            projection_mode: value.projection_mode,
        }
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

fn interpolate_pose(start: WorldPosition, end: WorldPosition, progress: f32) -> WorldPosition {
    if start.landblock_id != end.landblock_id {
        return end;
    }

    let start_heading = start.rotation.to_heading();
    let end_heading = end.rotation.to_heading();
    let heading = normalize_heading(start_heading + (signed_heading_delta(start_heading, end_heading) * progress));

    WorldPosition {
        landblock_id: end.landblock_id,
        coords: start.coords + ((end.coords - start.coords) * progress),
        rotation: Quaternion::from_heading(heading),
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

fn signed_heading_delta(current_heading: f32, desired_heading: f32) -> f32 {
    let mut delta = (desired_heading - current_heading) % TAU;
    if delta <= -PI {
        delta += TAU;
    } else if delta > PI {
        delta -= TAU;
    }
    delta
}

fn normalize_heading(heading: f32) -> f32 {
    heading.rem_euclid(TAU)
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};

    fn make_position(x: f32, y: f32, heading_rad: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x01_02_0000),
            coords: Vector3::new(x, y, 0.0),
            rotation: Quaternion::from_heading(heading_rad),
        }
    }

    fn make_entity(guid: Guid, position: WorldPosition) -> Entity {
        Entity::new(guid, "Drudge".to_string(), position)
    }

    #[test]
    fn authoritative_position_interpolates_toward_latest_pose() {
        let guid = Guid(0x5000_0001);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig {
            max_position_interp: Duration::from_millis(200),
            ..ProjectionConfig::default()
        });
        let entity = make_entity(guid, make_position(0.0, 0.0, 0.0));

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid,
                pos: make_position(2.0, 0.0, 0.5),
            },
            start,
        );
        system.tick(start + Duration::from_millis(100));

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.projection_mode, ProjectionMode::InterpolatingPosition);
        assert!((projected.projected_pose.coords.x - 1.0).abs() < 1e-4);
        assert!((projected.projected_pose.rotation.to_heading() - 0.25).abs() < 1e-4);
    }

    #[test]
    fn velocity_updates_drive_dead_reckoning_between_authoritative_moves() {
        let guid = Guid(0x5000_0002);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig::default());
        let entity = make_entity(guid, make_position(10.0, 20.0, 0.0));

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        system.handle_view_event(
            &ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity: Vector3::new(2.0, 0.0, 0.0),
                omega: Vector3::zero(),
            },
            start,
        );
        system.tick(start + Duration::from_millis(250));

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.projection_mode, ProjectionMode::SimulatingVelocity);
        assert!((projected.projected_pose.coords.x - 10.5).abs() < 1e-4);
    }

    #[test]
    fn continuous_turn_commands_advance_heading_over_time() {
        let guid = Guid(0x5000_0003);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig::default());
        let mut entity = make_entity(guid, make_position(0.0, 0.0, 0.0));
        entity.motion_snapshot = Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            turn_speed: Some(
                holtburger_world::entity::OrderedMotionSpeed::from_f32(1.0)
                    .expect("speed should encode"),
            ),
            ..Default::default()
        });

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        system.tick(start + Duration::from_secs(1));

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.projection_mode, ProjectionMode::SimulatingMotionState);
        assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn turn_to_heading_rotates_toward_target_without_snapping() {
        let guid = Guid(0x5000_0004);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig::default());
        let mut entity = make_entity(guid, make_position(0.0, 0.0, 0.0));
        entity.motion_snapshot = Some(EntityMotionSnapshot {
            directive: Some(EntityMotionDirective::TurnToHeading {
                desired_heading: holtburger_world::entity::OrderedMotionSpeed::from_f32(2.0)
                    .expect("heading should encode"),
                speed: holtburger_world::entity::OrderedMotionSpeed::from_f32(1.0)
                    .expect("speed should encode"),
            }),
            ..Default::default()
        });

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        system.tick(start + Duration::from_secs(1));

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.projection_mode, ProjectionMode::SimulatingMotionState);
        assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn large_authoritative_corrections_snap_instead_of_interpolating() {
        let guid = Guid(0x5000_0005);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig {
            snap_distance_m: 1,
            ..ProjectionConfig::default()
        });
        let entity = make_entity(guid, make_position(0.0, 0.0, 0.0));

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid,
                pos: make_position(10.0, 0.0, 0.0),
            },
            start,
        );

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(projected.projected_pose.coords.x, 10.0);
    }

    #[test]
    fn despawn_and_clear_remove_projection_state() {
        let guid = Guid(0x5000_0006);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig::default());
        let entity = make_entity(guid, make_position(0.0, 0.0, 0.0));

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        assert!(system.projected_entity(guid).is_some());

        system.handle_view_event(&ClientViewEvent::EntityDespawned { guid }, start);
        assert!(system.projected_entity(guid).is_none());

        let entity = make_entity(guid, make_position(1.0, 0.0, 0.0));
        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        assert!(system.projected_entity(guid).is_some());

        system.clear();
        assert!(system.projected_entity(guid).is_none());
        assert_eq!(system.iter_projected_entities().count(), 0);
    }

    #[test]
    fn forced_reposition_clears_stale_kinematics() {
        let guid = Guid(0x5000_0007);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig::default());
        let entity = make_entity(guid, make_position(10.0, 20.0, 0.5));

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        system.handle_view_event(
            &ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity: Vector3::new(2.0, 0.0, 0.0),
                omega: Vector3::new(0.0, 0.0, 1.0),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::ForcedReposition {
                guid,
                pos: make_position(100.0, 50.0, 1.5),
                sequence: 42,
            },
            start + Duration::from_millis(50),
        );

        system.tick(start + Duration::from_millis(200));

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.velocity, Vector3::zero());
        assert_eq!(projected.omega, Vector3::zero());
        assert_eq!(projected.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(projected.projected_pose, make_position(100.0, 50.0, 1.5));
    }

    #[test]
    fn first_authoritative_move_bootstraps_without_interpolation() {
        let guid = Guid(0x5000_0008);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig {
            max_position_interp: Duration::from_millis(200),
            ..ProjectionConfig::default()
        });

        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid,
                pos: make_position(3.0, 4.0, 0.5),
            },
            start,
        );

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(projected.authoritative_pose, make_position(3.0, 4.0, 0.5));
        assert_eq!(projected.projected_pose, make_position(3.0, 4.0, 0.5));
    }

    #[test]
    fn teleport_suspension_requires_authoritative_resume() {
        let guid = Guid(0x5000_0009);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig::default());
        let entity = make_entity(guid, make_position(1.0, 2.0, 0.25));

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        system.handle_view_event(&ClientViewEvent::TeleportStarted { sequence: 7 }, start + Duration::from_millis(10));

        system.handle_view_event(
            &ClientViewEvent::EntityMotionUpdated {
                guid,
                snapshot: Some(EntityMotionSnapshot {
                    turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                    turn_speed: Some(
                        holtburger_world::entity::OrderedMotionSpeed::from_f32(1.0)
                            .expect("speed should encode"),
                    ),
                    ..Default::default()
                }),
            },
            start + Duration::from_millis(20),
        );

        let suspended = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(suspended.projection_mode, ProjectionMode::Suspended);

        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid,
                pos: make_position(5.0, 6.0, 0.5),
            },
            start + Duration::from_millis(30),
        );

        let resumed = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(resumed.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(resumed.projected_pose, make_position(5.0, 6.0, 0.5));
    }

    #[test]
    fn authoritative_snapshot_resumes_suspended_projection() {
        let guid = Guid(0x5000_000A);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig::default());
        let entity = make_entity(guid, make_position(1.0, 2.0, 0.25));

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        system.handle_view_event(
            &ClientViewEvent::TeleportStarted { sequence: 7 },
            start + Duration::from_millis(10),
        );

        let mut resumed_entity = make_entity(guid, make_position(8.0, 9.0, 1.0));
        resumed_entity.velocity = Vector3::new(1.0, 0.0, 0.0);
        system.handle_view_event(
            &ClientViewEvent::EntityIdentified {
                entity: Box::new(resumed_entity),
            },
            start + Duration::from_millis(20),
        );

        let resumed = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(resumed.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(resumed.projected_pose, make_position(8.0, 9.0, 1.0));
        assert_eq!(resumed.velocity, Vector3::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn same_turn_spatial_sample_is_coherent_after_authoritative_move() {
        let guid = Guid(0x5000_000B);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig {
            max_position_interp: Duration::from_millis(200),
            ..ProjectionConfig::default()
        });

        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid,
                pos: make_position(4.0, 5.0, 0.75),
            },
            start,
        );

        let sample = system.spatial_sample(guid).expect("sample should exist");
        assert_eq!(sample.projection_mode, ProjectionMode::AuthoritativeOnly);
        assert_eq!(sample.authoritative_pose, make_position(4.0, 5.0, 0.75));
        assert_eq!(sample.projected_pose, make_position(4.0, 5.0, 0.75));
    }

    #[test]
    fn entity_moved_interpolates_from_current_simulated_pose() {
        let guid = Guid(0x5000_000C);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig {
            max_position_interp: Duration::from_millis(200),
            ..ProjectionConfig::default()
        });
        let entity = make_entity(guid, make_position(0.0, 0.0, 0.0));

        system.handle_view_event(&ClientViewEvent::EntitySpawned { entity: Box::new(entity) }, start);
        system.handle_view_event(
            &ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity: Vector3::new(2.0, 0.0, 0.0),
                omega: Vector3::zero(),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid,
                pos: make_position(1.0, 0.0, 0.0),
            },
            start + Duration::from_millis(100),
        );

        let projected = system.projected_entity(guid).expect("entity should exist");
        assert_eq!(projected.projection_mode, ProjectionMode::InterpolatingPosition);
        assert!((projected.projected_pose.coords.x - 0.2).abs() < 1e-4);
    }

    #[test]
    fn partial_kinematics_updates_do_not_create_projection_entries() {
        let guid = Guid(0x5000_000D);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig::default());

        system.handle_view_event(
            &ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity: Vector3::new(2.0, 0.0, 0.0),
                omega: Vector3::zero(),
            },
            start,
        );

        assert!(system.projected_entity(guid).is_none());
        assert_eq!(system.iter_projected_entities().count(), 0);
    }

    #[test]
    fn partial_motion_updates_do_not_create_projection_entries() {
        let guid = Guid(0x5000_000E);
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig::default());

        system.handle_view_event(
            &ClientViewEvent::EntityMotionUpdated {
                guid,
                snapshot: Some(EntityMotionSnapshot {
                    turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                    turn_speed: Some(
                        holtburger_world::entity::OrderedMotionSpeed::from_f32(1.0)
                            .expect("speed should encode"),
                    ),
                    ..Default::default()
                }),
            },
            start,
        );

        assert!(system.projected_entity(guid).is_none());
        assert_eq!(system.iter_projected_entities().count(), 0);
    }

    #[test]
    fn iter_projected_entities_supports_batch_scene_updates() {
        let start = Instant::now();
        let mut system = EntityProjectionSystem::new(ProjectionConfig {
            max_position_interp: Duration::from_millis(200),
            ..ProjectionConfig::default()
        });
        let first_guid = Guid(0x5000_000F);
        let second_guid = Guid(0x5000_0010);

        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(make_entity(first_guid, make_position(0.0, 0.0, 0.0))),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(make_entity(second_guid, make_position(10.0, 5.0, 0.25))),
            },
            start,
        );

        system.handle_view_event(
            &ClientViewEvent::EntityMoved {
                guid: first_guid,
                pos: make_position(2.0, 0.0, 0.5),
            },
            start,
        );
        system.handle_view_event(
            &ClientViewEvent::EntityKinematicsUpdated {
                guid: second_guid,
                velocity: Vector3::new(2.0, 0.0, 0.0),
                omega: Vector3::zero(),
            },
            start,
        );

        system.tick(start + Duration::from_millis(100));

        let scene_nodes: HashMap<Guid, (WorldPosition, WorldPosition, ProjectionMode)> = system
            .iter_projected_entities()
            .map(|entity| {
                (
                    entity.guid,
                    (
                        entity.projected_pose,
                        entity.authoritative_pose,
                        entity.projection_mode,
                    ),
                )
            })
            .collect();

        assert_eq!(scene_nodes.len(), 2);

        let first = scene_nodes
            .get(&first_guid)
            .expect("interpolated entity should be present");
        assert_eq!(first.1, make_position(2.0, 0.0, 0.5));
        assert_eq!(first.2, ProjectionMode::InterpolatingPosition);
        assert!((first.0.coords.x - 1.0).abs() < 1e-4);

        let second = scene_nodes
            .get(&second_guid)
            .expect("dead-reckoned entity should be present");
        assert_eq!(second.1, make_position(10.0, 5.0, 0.25));
        assert_eq!(second.2, ProjectionMode::SimulatingVelocity);
        assert!((second.0.coords.x - 10.2).abs() < 1e-4);
    }
}