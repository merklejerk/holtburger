use super::movement::{MovementSystem, ServerControlledProjection};
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::WorldObjectExt;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::{
    ContactState, SolveBodyInput, SolvedBodyKinematics, SpatialBodyId, SpatialSolveBatch,
    SpatialSolveRequest, WorldEvent, WorldState,
};
use std::sync::Arc;
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

impl ClientSimulationSystem {
    pub(super) fn new() -> Self {
        Self::default()
    }

    #[cfg_attr(not(test), allow(dead_code))]
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
    ) -> Vec<WorldEvent> {
        if dt.is_zero() {
            return Vec::new();
        }

        let Some(request) = self.build_solve_request(now, dt, world, movement) else {
            return Vec::new();
        };

        let physics = Arc::clone(world.scene.physics());
        let solved = physics.solve(&request, &mut world.scene);
        self.apply_solve_batch(world, solved)
    }

    pub(super) fn build_solve_request(
        &self,
        _now: Instant,
        dt: Duration,
        world: &WorldState,
        movement: &MovementSystem,
    ) -> Option<SpatialSolveRequest> {
        let local_body = movement.current_local_solve_body_input(world).or_else(|| {
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

        Some(SpatialSolveRequest {
            dt,
            bodies,
            local_drive: movement.current_local_drive_control(world, dt),
        })
    }

    fn apply_solve_batch(
        &mut self,
        world: &mut WorldState,
        solved: SpatialSolveBatch,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();

        for body in solved.solved {
            events.extend(world.apply_solved_body_kinematics(&body));
        }

        for event in solved.events {
            events.extend(world.apply_spatial_body_event(&event));
        }

        events
    }

    pub(super) async fn handle_server_controlled_movement(
        &mut self,
        data: MovementEventData,
        movement: &mut MovementSystem,
        world: &mut WorldState,
        session: &mut Session,
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

                movement.set_server_controlled_projection(ServerControlledProjection {
                    target_pose,
                    speed_mps: (mto.run_rate * mto.params.speed.max(0.1)).max(0.1),
                });
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

        let world_events = world.apply_solved_body_kinematics(&solved);
        let now = Instant::now();
        if should_send_immediate_server_controlled_sync(&data) {
            movement
                .send_autonomous_position_sync(
                    now,
                    world,
                    session,
                    super::movement_types::MovementPacketMetadata::default(),
                )
                .await?;
        } else {
            movement.arm_autonomous_position_heartbeat_schedule(now, world);
        }

        Ok(world_events)
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
    fn apply_solve_batch_applies_spatial_events() {
        let mut simulation = ClientSimulationSystem::new();
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

        let events = simulation.apply_solve_batch(
            &mut world,
            SpatialSolveBatch {
                solved: Vec::new(),
                events: vec![
                    SpatialBodyEvent::ContactChanged {
                        body_id: SpatialBodyId::LocalPlayer(player_guid),
                        contact: ContactState::Grounded,
                    },
                    SpatialBodyEvent::ForcedReposition {
                        body_id: SpatialBodyId::Entity(remote_guid),
                        pose: remote_pose,
                    },
                ],
            },
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
