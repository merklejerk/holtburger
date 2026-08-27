use super::movement::{MovementSystem, ServerControlledProjection};
use crate::SimulationSceneSnapshot;
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::WorldObjectExt;
use holtburger_common::{Guid, Quaternion, RigidTransform, Vector3};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::{
    ContactState, GroundedBodyActuation, PhysicalBodyActuation, PhysicalBodyDefinition,
    SolveBodyInput, SolvedBodyKinematics, SpatialBodyId, WorldEvent, WorldState,
    advance_authored_body_kinematics, advance_body_kinematics, authored_grounded_actuation,
};
use std::time::{Duration, Instant};

const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;
const ACTIVE_SOLVE_RADIUS_M: f32 = 96.0;

fn calculate_arrival_position(
    source: &WorldPosition,
    target_pos: &Vector3,
    distance: f32,
) -> Vector3 {
    let to_player = source.coords - *target_pos;
    if to_player.length_squared() > 1e-6 {
        *target_pos + (to_player.normalize() * distance)
    } else {
        let mut fallback = *target_pos;
        fallback.x += distance;
        fallback
    }
}

fn approximate_move_to_object_projection_target(
    source: &WorldPosition,
    target_pos: &Vector3,
    distance_to_object: f32,
    target_use_radius: Option<f32>,
) -> Vector3 {
    let conservative_center_distance = distance_to_object + target_use_radius.unwrap_or(0.0);
    calculate_arrival_position(source, target_pos, conservative_center_distance.max(0.0))
}

#[derive(Debug, Default)]
pub(super) struct ClientSimulationSystem {
    tracked_body_ids: Vec<SpatialBodyId>,
}

/// Pose-only projection inputs retained for diagnostic and remote dead-reckoning consumers.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct ClientProjectionRequest {
    pub bodies: Vec<SolveBodyInput>,
}

impl ClientSimulationSystem {
    pub(super) fn new() -> Self {
        Self::default()
    }

    pub(super) fn track_body(&mut self, body_id: SpatialBodyId) {
        if body_id.authoritative_guid() != Some(Guid::NULL)
            && !self.tracked_body_ids.contains(&body_id)
        {
            self.tracked_body_ids.push(body_id);
        }
    }

    pub(super) fn untrack_body(&mut self, body_id: SpatialBodyId) {
        self.tracked_body_ids.retain(|tracked| *tracked != body_id);
    }

    pub(super) fn tick(
        &mut self,
        now: Instant,
        dt: Duration,
        world: &mut WorldState,
        movement: &mut MovementSystem,
        collision: Option<&SimulationSceneSnapshot>,
    ) -> Result<Vec<WorldEvent>> {
        if dt.is_zero() {
            return Ok(Vec::new());
        }

        // Authored playback advances once per tick, before any basis is read from it. A held
        // local drive owns a separate predicted cursor; excluding that entity prevents the
        // authoritative snapshot playback from producing a second offset for the same tick.
        let local_guid = world.player.guid;
        let excluded = movement
            .has_active_manual_drive()
            .then_some(local_guid)
            .filter(|guid| !guid.is_null());
        world.advance_authored_motion_except(dt, excluded);
        // Server correction is another basis producer. Prepare it once so local actuation and
        // projection diagnostics consume the same interpolation/constraint result.
        let prepared_correction = movement.advance_server_interpolation(world, dt);

        let mut events = Vec::new();
        if let Some(snap_to) = prepared_correction.and_then(|step| step.snap_to) {
            events.extend(world.set_local_player_runtime_pose(snap_to));
            movement.clear_server_correction();
        }
        if let Some(collision) = collision {
            let manual_offset = movement.advance_local_manual_motion(world, dt)?;
            events.extend(self.tick_local_player(
                now,
                dt,
                world,
                movement,
                collision,
                manual_offset,
            )?);
        } else {
            movement.reset_manual_motion_playback();
        }
        events.extend(self.tick_remote_entities(now, dt, world, movement));
        Ok(events)
    }

    /// Builds the pose-only projection inputs retained for server-authoritative remote entities.
    ///
    /// The returned values are consumed by the client projection lane, never by a collision
    /// callback. Local-player collision uses the transaction path in [`Self::tick`].
    pub(super) fn build_projection_request(
        &self,
        _now: Instant,
        dt: Duration,
        world: &WorldState,
        movement: &MovementSystem,
    ) -> Option<ClientProjectionRequest> {
        let local_body = movement
            .current_local_solve_body_input(world, dt)
            .or_else(|| {
                (world.player.guid != Guid::NULL)
                    .then_some(SpatialBodyId::LocalPlayer(world.player.guid))
                    .and_then(|body_id| world.resolve_body_projection_input(body_id))
            });
        let local_pose = local_body.map(|body| body.pose);
        let nearby_tracked = local_pose.map(|pose| {
            world
                .scene
                .get_entities_in_range(&pose, ACTIVE_SOLVE_RADIUS_M)
        });
        let mut bodies = Vec::<SolveBodyInput>::new();

        if let Some(body) = local_body {
            bodies.push(body);
        }

        for body_id in self.tracked_body_ids.iter().copied() {
            if bodies.iter().any(|body| body.body_id == body_id) {
                continue;
            }

            if nearby_tracked.as_ref().is_some_and(|guids| {
                body_id
                    .authoritative_guid()
                    .is_some_and(|guid| !guids.contains(&guid))
            }) {
                continue;
            }

            let Some(input) = world.resolve_body_projection_input(body_id) else {
                continue;
            };

            if input.basis.is_none() {
                continue;
            }

            bodies.push(input);
        }

        if bodies.is_empty() {
            return None;
        }

        Some(ClientProjectionRequest { bodies })
    }

    fn tick_local_player(
        &mut self,
        now: Instant,
        dt: Duration,
        world: &mut WorldState,
        movement: &mut MovementSystem,
        collision: &SimulationSceneSnapshot,
        manual_offset: Option<RigidTransform>,
    ) -> Result<Vec<WorldEvent>> {
        let guid = world.player.guid;
        if guid.is_null() {
            return Ok(Vec::new());
        }
        let body_id = SpatialBodyId::LocalPlayer(guid);
        let Some(body) = world.scene.body(body_id) else {
            return Ok(Vec::new());
        };
        if body.physical.is_none() {
            return Ok(Vec::new());
        }

        let actuation = self.local_player_actuation(body, dt, world, movement, manual_offset)?;
        let (result, ()) = world.scene.tick_physical_body_transaction(
            body_id,
            collision.scene.as_ref(),
            actuation,
            dt.as_secs_f32(),
            now,
            |_, _| Ok(()),
        )?;
        Ok(world.apply_physical_body_tick_result(body_id, &result))
    }

    fn local_player_actuation(
        &self,
        body: &holtburger_world::SpatialBody,
        dt: Duration,
        world: &WorldState,
        movement: &mut MovementSystem,
        manual_offset: Option<RigidTransform>,
    ) -> Result<PhysicalBodyActuation> {
        let dt_secs = dt.as_secs_f32();
        anyhow::ensure!(
            dt_secs.is_finite() && dt_secs > 0.0,
            "local client transaction interval must be finite and positive"
        );

        let definition = body
            .physical
            .as_ref()
            .expect("physical body was checked before actuation resolution")
            .definition;
        let object_scale = world
            .player_entity()
            .and_then(|entity| entity.obj_scale())
            .unwrap_or(1.0) as f32;
        let actuation = match definition {
            PhysicalBodyDefinition::FreeSphere { .. } => {
                let velocity = movement
                    .current_local_drive_control(world, dt)
                    .map(|control| control.desired_world_delta / dt_secs)
                    .or_else(|| {
                        manual_offset.map(|offset| {
                            body.pose.rotation.rotate_vector(offset.translation) / dt_secs
                        })
                    })
                    .unwrap_or(body.velocity);
                PhysicalBodyActuation::free_flight(velocity)?
            }
            PhysicalBodyDefinition::Grounded { .. } => {
                if let Some(offset) = manual_offset {
                    authored_grounded_actuation(
                        offset,
                        body.pose,
                        body.contact,
                        object_scale,
                        dt_secs,
                    )?
                } else if let Some(control) = movement.current_local_drive_control(world, dt) {
                    let planar_velocity = control.desired_world_delta / dt_secs;
                    let mut grounded =
                        if control.force_grounded || body.contact != ContactState::Airborne {
                            GroundedBodyActuation::drive(Vector3::new(
                                planar_velocity.x,
                                planar_velocity.y,
                                0.0,
                            ))?
                        } else {
                            GroundedBodyActuation::coast()
                        };
                    if let Some(heading) = control.desired_heading {
                        grounded = grounded.with_control_heading(heading)?;
                    }
                    PhysicalBodyActuation::Grounded(grounded)
                } else {
                    PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast())
                }
            }
        };

        let composed_translation = match &actuation {
            PhysicalBodyActuation::FreeFlight { velocity } => *velocity * dt_secs,
            PhysicalBodyActuation::Grounded(grounded) => {
                grounded.supported_planar_velocity() * dt_secs
            }
        };
        let correction = movement.apply_server_correction_to_translation(
            composed_translation,
            body.contact == ContactState::Grounded,
        );
        if correction.snap_to.is_some() {
            // The simulation tick consumes the snap before this function is called. Retaining a
            // defensive zero here prevents a stale prepared result from injecting movement.
            return Ok(PhysicalBodyActuation::Grounded(
                GroundedBodyActuation::coast(),
            ));
        }

        match actuation {
            PhysicalBodyActuation::FreeFlight { velocity } => {
                let corrected_velocity = if correction.translation == composed_translation {
                    velocity
                } else {
                    correction.translation / dt_secs
                };
                Ok(PhysicalBodyActuation::free_flight(corrected_velocity)?)
            }
            PhysicalBodyActuation::Grounded(grounded) => {
                let original_heading = grounded.control_heading();
                let launch = grounded.launch().cloned();
                let external_acceleration = grounded.external_acceleration();
                let has_drive = grounded.supported_planar_velocity() != Vector3::zero();
                let correction_assigns = movement
                    .prepared_server_correction()
                    .is_some_and(|step| step.assigned);
                let should_drive = has_drive || correction_assigns;
                let mut corrected = if should_drive {
                    GroundedBodyActuation::drive(Vector3::new(
                        correction.translation.x / dt_secs,
                        correction.translation.y / dt_secs,
                        0.0,
                    ))?
                } else {
                    GroundedBodyActuation::coast()
                };
                let heading = if correction.heading_pinned {
                    None
                } else if correction_assigns {
                    correction.target.map(|target| target.rotation.to_heading())
                } else {
                    original_heading
                };
                if let Some(heading) = heading {
                    corrected = corrected.with_control_heading(heading)?;
                }
                if let Some(launch) = launch {
                    corrected = corrected.with_launch(launch);
                }
                if external_acceleration != Vector3::zero() {
                    corrected = corrected.with_external_acceleration(external_acceleration)?;
                }
                Ok(PhysicalBodyActuation::Grounded(corrected))
            }
        }
    }

    fn tick_remote_entities(
        &self,
        now: Instant,
        dt: Duration,
        world: &mut WorldState,
        movement: &MovementSystem,
    ) -> Vec<WorldEvent> {
        let Some(request) = self.build_projection_request(now, dt, world, movement) else {
            return Vec::new();
        };
        let mut events = Vec::new();
        for input in request.bodies {
            if matches!(input.body_id, SpatialBodyId::LocalPlayer(_)) {
                continue;
            }
            let Some(basis) = input.basis else {
                continue;
            };
            let solved = match basis {
                holtburger_world::SolveProjectionBasis::AuthoredDrive { offset } => {
                    advance_authored_body_kinematics(&input, offset, dt)
                }
                holtburger_world::SolveProjectionBasis::Velocity { .. } => {
                    advance_body_kinematics(&input, dt)
                }
            };
            events.extend(world.apply_solved_body_kinematics(&solved));
        }
        events
    }

    pub(super) async fn handle_server_controlled_movement(
        &mut self,
        data: MovementEventData,
        movement: &mut MovementSystem,
        world: &mut WorldState,
        _session: &mut Session,
    ) -> Result<Vec<WorldEvent>> {
        log::info!(
            ">>> Processing server-initiated movement: {:?}. Control Sequence: {}",
            data.movement_type,
            data.server_control_sequence
        );
        movement.note_server_controlled_movement_started();

        match &data.data {
            MovementTypeData::MoveToObject(mto) => {
                let Some(current_pos) = world.local_player_runtime_pose() else {
                    return Ok(Vec::new());
                };

                let target_use_radius = world
                    .get_visible_entity(mto.target)
                    .and_then(|target| target.use_radius())
                    .map(|radius| radius as f32);
                let mut target_pose = current_pos;
                target_pose.landblock_id = mto.origin.cell_id;
                target_pose.coords = approximate_move_to_object_projection_target(
                    &current_pos,
                    &mto.origin.position,
                    mto.params.distance_to_object,
                    target_use_radius,
                );
                target_pose.rotation = if mto.params.desired_heading.abs() <= 1e-6 {
                    Quaternion::from_heading(target_pose.coords.heading_to(&mto.origin.position))
                } else {
                    Quaternion::from_heading(mto.params.desired_heading)
                };

                movement.set_server_controlled_projection_with_heading(
                    ServerControlledProjection {
                        target_pose,
                        speed_mps: (mto.run_rate * mto.params.speed.max(0.1)).max(0.1),
                    },
                    true,
                );
                movement.arm_autonomous_position_heartbeat_schedule(Instant::now(), world);
                return Ok(Vec::new());
            }
            MovementTypeData::Invalid(_) => {
                movement.clear_server_controlled_projection();
            }
            _ => {
                movement.clear_server_controlled_projection();
            }
        }

        let Some(solved) = self.build_server_controlled_result(&data, world) else {
            return Ok(Vec::new());
        };
        movement.set_server_controlled_projection(ServerControlledProjection {
            target_pose: solved.pose,
            speed_mps: server_controlled_speed(&data),
        });
        let now = Instant::now();
        movement.arm_autonomous_position_heartbeat_schedule(now, world);
        Ok(Vec::new())
    }

    fn build_server_controlled_result(
        &self,
        data: &MovementEventData,
        world: &WorldState,
    ) -> Option<SolvedBodyKinematics> {
        let guid = world.player.guid;
        if guid == Guid::NULL {
            return None;
        }

        let current_pos = world.local_player_runtime_pose()?;
        let mut next_pos = current_pos;

        match &data.data {
            MovementTypeData::MoveToObject(mto) => {
                next_pos.landblock_id = mto.origin.cell_id;

                let arrival_dist = mto.params.distance_to_object;

                if (current_pos.landblock_id >> 16) == (mto.origin.cell_id >> 16) {
                    next_pos.coords = calculate_arrival_position(
                        &current_pos,
                        &mto.origin.position,
                        arrival_dist,
                    );

                    if mto.params.desired_heading.abs() <= 1e-6 {
                        next_pos.rotation = Quaternion::from_heading(
                            next_pos.coords.heading_to(&mto.origin.position),
                        );
                    } else {
                        next_pos.rotation = Quaternion::from_heading(mto.params.desired_heading);
                    }
                } else {
                    next_pos.coords = mto.origin.position;
                    next_pos.coords.x += arrival_dist;
                }
            }
            MovementTypeData::MoveToPosition(mtp) => {
                next_pos.landblock_id = mtp.origin.cell_id;
                next_pos.coords = mtp.origin.position;

                if mtp.params.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(mtp.params.desired_heading);
                } else {
                    next_pos.rotation = Quaternion::from_heading(
                        current_pos.coords.heading_to(&mtp.origin.position),
                    );
                }
            }
            MovementTypeData::TurnToHeading(tth) => {
                next_pos.rotation = Quaternion::from_heading(tth.params.desired_heading);
            }
            MovementTypeData::TurnToObject(tto) => {
                if tto.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(tto.desired_heading);
                } else if let Some(target) = world.get_visible_entity(tto.target)
                    && target.position.landblock_id == next_pos.landblock_id
                {
                    next_pos.rotation = Quaternion::from_heading(
                        next_pos.coords.heading_to(&target.position.coords),
                    );
                }
            }
            _ => {}
        }

        let distance = if next_pos.landblock_id == Guid::NULL {
            0.0
        } else {
            current_pos.distance_to(&next_pos)
        };

        if distance > AUTO_MOVE_DISTANCE_LIMIT {
            log::warn!(
                "Aborting auto-move: target is {:.2}m away (limit {}m)",
                distance,
                AUTO_MOVE_DISTANCE_LIMIT
            );
            return None;
        }

        let (_, velocity, omega) = world.local_player_runtime_kinematics().unwrap_or((
            next_pos,
            Vector3::zero(),
            Vector3::zero(),
        ));

        Some(SolvedBodyKinematics {
            body_id: SpatialBodyId::LocalPlayer(guid),
            pose: next_pos,
            velocity,
            omega,
            contact: ContactState::Unknown,
            projection_state: Some(
                holtburger_world::SelfPlayerDriveProjectionState::ServerControlled,
            ),
        })
    }
}

fn server_controlled_speed(data: &MovementEventData) -> f32 {
    let speed = match &data.data {
        MovementTypeData::MoveToObject(move_to) => move_to.run_rate * move_to.params.speed.max(0.1),
        MovementTypeData::MoveToPosition(move_to) => {
            move_to.run_rate * move_to.params.speed.max(0.1)
        }
        MovementTypeData::TurnToObject(turn_to) => turn_to.params.speed,
        MovementTypeData::TurnToHeading(turn_to) => turn_to.params.speed,
        MovementTypeData::Invalid(_) => 0.0,
    };
    speed.max(0.1)
}

#[cfg(test)]
fn should_send_immediate_server_controlled_sync(data: &MovementEventData) -> bool {
    !matches!(data.data, MovementTypeData::Invalid(_))
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_protocol::messages::motion::{
        MoveToObject, MoveToParameters, MoveToPosition, Origin,
    };
    use holtburger_protocol::messages::{
        MotionStance, MovementEventData, MovementType, MovementTypeData,
    };
    use holtburger_world::{SpatialBodyEvent, entity::Entity};

    fn make_world_position(x: f32, y: f32, heading: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(x, y, 0.0),
            rotation: Quaternion::from_heading(heading),
        }
    }

    fn synthetic_player_world(start: WorldPosition) -> (WorldState, Guid) {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        world.seed_local_player_entity(player_guid, "Player", start);
        (world, player_guid)
    }

    #[test]
    fn applying_spatial_events_keeps_world_semantics() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        let remote_guid = Guid(0x5000_0002);
        let remote_pose = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(9.0, 7.0, 0.0),
            rotation: Quaternion::identity(),
        };

        let player_pose = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            ..Default::default()
        };
        world.seed_local_player_entity(player_guid, "Player", player_pose);
        world.add_entity(Entity::new(remote_guid, "Remote".to_string(), player_pose));

        let mut events = world.apply_spatial_body_event(&SpatialBodyEvent::ContactChanged {
            body_id: SpatialBodyId::LocalPlayer(player_guid),
            contact: ContactState::Grounded,
        });
        events.extend(
            world.apply_spatial_body_event(&SpatialBodyEvent::ForcedReposition {
                body_id: SpatialBodyId::Entity(remote_guid),
                pose: remote_pose,
            }),
        );

        assert_eq!(world.player.last_server_grounded, Some(true));
        assert_eq!(
            world
                .scene
                .body(SpatialBodyId::Entity(remote_guid))
                .expect("remote runtime body should still exist")
                .pose,
            remote_pose
        );
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::PlayerGroundedUpdated { grounded } if *grounded
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::ForcedReposition { guid, pos, sequence }
                if *guid == remote_guid && *pos == remote_pose && *sequence == 0
        )));
    }

    #[test]
    fn move_to_position_without_desired_heading_uses_current_pose_for_facing() {
        let simulation = ClientSimulationSystem::new();
        let start = make_world_position(10.0, 20.0, 1.25);
        let destination = make_world_position(32.0, 48.0, 0.0);
        let (world, player_guid) = synthetic_player_world(start);

        let solved = simulation
            .build_server_controlled_result(
                &MovementEventData {
                    guid: player_guid,
                    object_instance_sequence: 7,
                    movement_sequence: 20,
                    server_control_sequence: 10,
                    is_autonomous: false,
                    movement_type: MovementType::MoveToPosition,
                    motion_flags: 0,
                    current_style: MotionStance::SwordCombat.interpreted(),
                    data: MovementTypeData::MoveToPosition(MoveToPosition {
                        origin: Origin {
                            cell_id: destination.landblock_id,
                            position: destination.coords,
                        },
                        params: MoveToParameters {
                            desired_heading: 0.0,
                            ..Default::default()
                        },
                        run_rate: 1.0,
                    }),
                },
                &world,
            )
            .expect("server-controlled move should resolve");

        assert_eq!(solved.pose.landblock_id, destination.landblock_id);
        assert_eq!(solved.pose.coords, destination.coords);
        assert!(
            (solved.pose.rotation.to_heading() - start.coords.heading_to(&destination.coords))
                .abs()
                < 1e-5
        );
    }

    #[test]
    fn move_to_object_without_desired_heading_uses_current_pose_for_arrival_and_facing() {
        let simulation = ClientSimulationSystem::new();
        let start = make_world_position(10.0, 20.0, 1.25);
        let target = make_world_position(13.0, 24.0, 0.0);
        let arrival_distance = 2.0;
        let expected_coords = calculate_arrival_position(&start, &target.coords, arrival_distance);
        let (world, player_guid) = synthetic_player_world(start);

        let solved = simulation
            .build_server_controlled_result(
                &MovementEventData {
                    guid: player_guid,
                    object_instance_sequence: 7,
                    movement_sequence: 20,
                    server_control_sequence: 10,
                    is_autonomous: false,
                    movement_type: MovementType::MoveToObject,
                    motion_flags: 0,
                    current_style: MotionStance::SwordCombat.interpreted(),
                    data: MovementTypeData::MoveToObject(MoveToObject {
                        target: Guid(0x5000_00AA),
                        origin: Origin {
                            cell_id: target.landblock_id,
                            position: target.coords,
                        },
                        params: MoveToParameters {
                            desired_heading: 0.0,
                            distance_to_object: arrival_distance,
                            ..Default::default()
                        },
                        run_rate: 1.0,
                    }),
                },
                &world,
            )
            .expect("server-controlled move should resolve");

        assert_eq!(solved.pose.landblock_id, target.landblock_id);
        assert_eq!(solved.pose.coords, expected_coords);
        assert!(
            (solved.pose.rotation.to_heading() - expected_coords.heading_to(&target.coords)).abs()
                < 1e-5
        );
    }

    #[test]
    fn move_to_object_projection_target_adds_target_use_radius() {
        let start = make_world_position(10.0, 20.0, 0.0);
        let target = make_world_position(13.0, 24.0, 0.0);

        let projected =
            approximate_move_to_object_projection_target(&start, &target.coords, 0.6, Some(0.5));

        assert_eq!(
            projected,
            calculate_arrival_position(&start, &target.coords, 1.1)
        );
    }

    #[test]
    fn invalid_server_controlled_motion_skips_immediate_sync() {
        assert!(!should_send_immediate_server_controlled_sync(
            &MovementEventData {
                guid: Guid(0x5000_0001),
                object_instance_sequence: 7,
                movement_sequence: 20,
                server_control_sequence: 10,
                is_autonomous: false,
                movement_type: MovementType::Invalid,
                motion_flags: 0,
                current_style: MotionStance::SwordCombat.interpreted(),
                data: MovementTypeData::Invalid(Default::default()),
            }
        ));
    }

    #[test]
    fn move_to_position_server_controlled_motion_keeps_immediate_sync() {
        assert!(should_send_immediate_server_controlled_sync(
            &MovementEventData {
                guid: Guid(0x5000_0001),
                object_instance_sequence: 7,
                movement_sequence: 20,
                server_control_sequence: 10,
                is_autonomous: false,
                movement_type: MovementType::MoveToPosition,
                motion_flags: 0,
                current_style: MotionStance::SwordCombat.interpreted(),
                data: MovementTypeData::MoveToPosition(MoveToPosition {
                    origin: Origin {
                        cell_id: Guid(0x1234_0000),
                        position: Vector3::new(32.0, 48.0, 0.0),
                    },
                    params: MoveToParameters {
                        desired_heading: 0.0,
                        ..Default::default()
                    },
                    run_rate: 1.0,
                }),
            }
        ));
    }
}
