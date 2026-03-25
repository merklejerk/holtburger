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

#[derive(Debug, Clone)]
struct TrackedEntityProjection {
    public_state: ProjectedEntityState,
    interpolation: Option<PositionInterpolation>,
    last_simulated_at: Instant,
}

#[derive(Debug, Clone, Copy)]
struct PositionInterpolation {
    start_pose: WorldPosition,
    started_at: Instant,
    duration: Duration,
}

impl EntityProjectionSystem {
    pub fn new(config: ProjectionConfig) -> Self {
        Self {
            config,
            entities: HashMap::new(),
        }
    }

    pub fn handle_view_event(&mut self, event: &ClientViewEvent, now: Instant) {
        match event {
            ClientViewEvent::EntitySpawned { entity }
            | ClientViewEvent::EntityReplaced { entity }
            | ClientViewEvent::EntityIdentified { entity } => {
                self.upsert_from_entity(entity, now);
            }
            ClientViewEvent::EntityMoved { guid, pos } => {
                self.handle_entity_moved(*guid, *pos, now);
            }
            ClientViewEvent::EntityKinematicsUpdated {
                guid,
                velocity,
                omega,
            } => {
                let tracked = self.ensure_entity(*guid, WorldPosition::default(), now);
                tracked.public_state.velocity = *velocity;
                tracked.public_state.omega = *omega;
            }
            ClientViewEvent::EntityMotionUpdated { guid, snapshot } => {
                let tracked = self.ensure_entity(*guid, WorldPosition::default(), now);
                tracked.public_state.motion_state = *snapshot;
                if tracked.public_state.projection_mode == ProjectionMode::Suspended {
                    tracked.public_state.projection_mode = ProjectionMode::AuthoritativeOnly;
                }
            }
            ClientViewEvent::ForcedReposition { guid, pos, .. } => {
                let tracked = self.ensure_entity(*guid, *pos, now);
                tracked.public_state.authoritative_pose = *pos;
                tracked.public_state.projected_pose = *pos;
                tracked.public_state.motion_state = None;
                tracked.public_state.last_authoritative_update = now;
                tracked.public_state.projection_mode = ProjectionMode::AuthoritativeOnly;
                tracked.interpolation = None;
                tracked.last_simulated_at = now;
            }
            ClientViewEvent::TeleportStarted { .. } => {
                for tracked in self.entities.values_mut() {
                    tracked.public_state.projected_pose = tracked.public_state.authoritative_pose;
                    tracked.public_state.projection_mode = ProjectionMode::Suspended;
                    tracked.interpolation = None;
                    tracked.last_simulated_at = now;
                }
            }
            ClientViewEvent::EntityDespawned { guid } => {
                self.entities.remove(guid);
            }
            _ => {}
        }
    }

    pub fn tick(&mut self, now: Instant) {
        let config = self.config;
        for tracked in self.entities.values_mut() {
            let dt = now
                .checked_duration_since(tracked.last_simulated_at)
                .unwrap_or_default();
            tracked.last_simulated_at = now;

            if tracked.public_state.projection_mode == ProjectionMode::Suspended {
                continue;
            }

            if Self::advance_interpolation(tracked, now) {
                continue;
            }

            let mut mode = ProjectionMode::AuthoritativeOnly;
            let authoritative_pose = tracked.public_state.authoritative_pose;
            tracked.public_state.projected_pose.landblock_id = authoritative_pose.landblock_id;

            let elapsed_since_authoritative = now
                .checked_duration_since(tracked.public_state.last_authoritative_update)
                .unwrap_or_default()
                .min(config.max_dead_reckon);

            if tracked.public_state.velocity.length_squared() > EPSILON
                && elapsed_since_authoritative > Duration::ZERO
            {
                tracked.public_state.projected_pose.coords = authoritative_pose.coords
                    + tracked.public_state.velocity * elapsed_since_authoritative.as_secs_f32();
                mode = ProjectionMode::SimulatingVelocity;
            } else {
                tracked.public_state.projected_pose.coords = authoritative_pose.coords;
            }

            let simulated_heading = Self::advance_heading_projection(tracked, dt);
            if simulated_heading {
                mode = ProjectionMode::SimulatingMotionState;
            } else {
                tracked.public_state.projected_pose.rotation = authoritative_pose.rotation;
            }

            tracked.public_state.projection_mode = mode;
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

    fn upsert_from_entity(&mut self, entity: &Entity, now: Instant) {
        let tracked = self.ensure_entity(entity.guid, entity.position, now);
        tracked.public_state.authoritative_pose = entity.position;
        tracked.public_state.projected_pose = entity.position;
        tracked.public_state.velocity = entity.velocity;
        tracked.public_state.omega = entity.omega;
        tracked.public_state.motion_state = entity.motion_snapshot;
        tracked.public_state.projection_mode = ProjectionMode::AuthoritativeOnly;
        tracked.public_state.last_authoritative_update = now;
        tracked.interpolation = None;
        tracked.last_simulated_at = now;
    }

    fn handle_entity_moved(&mut self, guid: Guid, pos: WorldPosition, now: Instant) {
        let snap_distance = self.config.snap_distance_meters();
        let snap_heading = self.config.snap_heading_radians();
        let max_interp = self.config.max_position_interp;
        let tracked = self.ensure_entity(guid, pos, now);
        let should_snap = should_snap_to_authoritative(
            tracked.public_state.projected_pose,
            pos,
            snap_distance,
            snap_heading,
        ) || max_interp == Duration::ZERO;

        tracked.public_state.authoritative_pose = pos;
        tracked.public_state.last_authoritative_update = now;
        tracked.last_simulated_at = now;

        if should_snap {
            tracked.public_state.projected_pose = pos;
            tracked.public_state.projection_mode = ProjectionMode::AuthoritativeOnly;
            tracked.interpolation = None;
        } else {
            tracked.public_state.projection_mode = ProjectionMode::InterpolatingPosition;
            tracked.interpolation = Some(PositionInterpolation {
                start_pose: tracked.public_state.projected_pose,
                started_at: now,
                duration: max_interp,
            });
        }
    }

    fn advance_interpolation(tracked: &mut TrackedEntityProjection, now: Instant) -> bool {
        let Some(interpolation) = tracked.interpolation else {
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
            tracked.public_state.authoritative_pose,
            progress,
        );

        if progress >= 1.0 {
            tracked.interpolation = None;
            tracked.public_state.projection_mode = ProjectionMode::AuthoritativeOnly;
        } else {
            tracked.public_state.projection_mode = ProjectionMode::InterpolatingPosition;
        }

        true
    }

    fn advance_heading_projection(tracked: &mut TrackedEntityProjection, dt: Duration) -> bool {
        let dt_secs = dt.as_secs_f32();
        if dt_secs <= 0.0 {
            return false;
        }

        if let Some(snapshot) = &mut tracked.public_state.motion_state {
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

        if tracked.public_state.omega.length_squared() > EPSILON {
            let heading = tracked.public_state.projected_pose.rotation.to_heading();
            tracked.public_state.projected_pose.rotation =
                Quaternion::from_heading(normalize_heading(
                    heading + (tracked.public_state.omega.z * dt_secs),
                ));
            return true;
        }

        false
    }
}

impl TrackedEntityProjection {
    fn new(guid: Guid, authoritative_pose: WorldPosition, now: Instant) -> Self {
        Self {
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
            interpolation: None,
            last_simulated_at: now,
        }
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
}