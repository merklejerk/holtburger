use super::movement::MovementSystem;
use super::movement_types::MotionState;
use crate::client::WireEvent;
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::{
    ContactState, SolveActorInput, SolveBodyInput, SolvedActorKinematics, SolvedBodyKinematics,
    SpatialBodyEvent, SpatialBodyId, SpatialEvent, SpatialSolveBatch, SpatialSolveRequest,
    WorldEvent, WorldState,
};
use smallvec::SmallVec;
use std::sync::Arc;
use std::time::{Duration, Instant};

const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;
const ACTIVE_SOLVE_RADIUS_M: f32 = 96.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct LocalMotionIntent {
    pub body_id: SpatialBodyId,
    pub locomotion: MotionState,
}

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

#[derive(Debug, Default)]
pub(super) struct ClientSimulationSystem {
    tracked_body_ids: SmallVec<[SpatialBodyId; 4]>,
}

impl ClientSimulationSystem {
    pub(super) fn new() -> Self {
        Self::default()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) fn track_actor(&mut self, actor_id: Guid) {
        let body_id = SpatialBodyId::Entity(actor_id);
        if actor_id != Guid::NULL && !self.tracked_body_ids.contains(&body_id) {
            self.tracked_body_ids.push(body_id);
        }
    }

    pub(super) fn untrack_actor(&mut self, actor_id: Guid) {
        self.tracked_body_ids
            .retain(|tracked| *tracked != SpatialBodyId::Entity(actor_id));
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
        self.apply_solve_batch(world, movement, solved)
    }

    pub(super) fn build_solve_request(
        &self,
        _now: Instant,
        dt: Duration,
        world: &WorldState,
        movement: &MovementSystem,
    ) -> Option<SpatialSolveRequest> {
        let local_intent = movement.current_local_intent(world);
        let local_body = local_intent
            .and_then(|intent| self.build_body_input(world, intent.body_id))
            .or_else(|| {
                (world.player.guid != Guid::NULL)
                    .then_some(SpatialBodyId::LocalPlayer(world.player.guid))
                    .and_then(|body_id| self.build_body_input(world, body_id))
            });
        let local_pose = local_body.map(|body| body.pose);
        let nearby_tracked = local_pose.map(|pose| {
            world
                .scene
                .get_entities_in_range(&pose, ACTIVE_SOLVE_RADIUS_M)
        });
        let mut actors = SmallVec::<[SolveActorInput; 1]>::new();

        if let Some(actor) = local_body.and_then(SolveBodyInput::into_actor_input)
        {
            actors.push(actor);
        }

        for body_id in self.tracked_body_ids.iter().copied() {
            if actors
                .iter()
                .any(|actor| Some(actor.actor_id) == body_id.authoritative_guid())
            {
                continue;
            }

            if nearby_tracked.as_ref().is_some_and(|guids| {
                body_id
                    .authoritative_guid()
                    .is_some_and(|guid| !guids.contains(&guid))
            }) {
                continue;
            }

            if let Some(actor) = self
                .build_body_input(world, body_id)
                .and_then(SolveBodyInput::into_actor_input)
            {
                actors.push(actor);
            }
        }

        if actors.is_empty() {
            return None;
        }

        Some(SpatialSolveRequest { dt, actors })
    }

    fn build_body_input(
        &self,
        world: &WorldState,
        body_id: SpatialBodyId,
    ) -> Option<SolveBodyInput> {
        let guid = body_id.authoritative_guid()?;
        let (resolved_body_id, pose, velocity, omega) = world.runtime_kinematics_for_guid(guid)?;

        Some(SolveBodyInput {
            body_id: if matches!(body_id, SpatialBodyId::LocalPlayer(_)) {
                body_id
            } else {
                resolved_body_id
            },
            pose,
            velocity,
            omega,
        })
    }

    fn solve_body_kinematics_for_actor(
        &self,
        world: &WorldState,
        solved: SolvedActorKinematics,
    ) -> SolvedBodyKinematics {
        let body_id = if solved.actor_id == world.player.guid {
            SpatialBodyId::LocalPlayer(solved.actor_id)
        } else {
            SpatialBodyId::Entity(solved.actor_id)
        };

        SolvedBodyKinematics {
            body_id,
            pose: solved.pose,
            velocity: solved.velocity,
            omega: solved.omega,
            contact: solved.contact,
        }
    }

    fn solve_body_event_for_actor(
        &self,
        world: &WorldState,
        event: SpatialEvent,
    ) -> SpatialBodyEvent {
        match event {
            SpatialEvent::ContactChanged { actor_id, contact } => {
                SpatialBodyEvent::ContactChanged {
                    body_id: if actor_id == world.player.guid {
                        SpatialBodyId::LocalPlayer(actor_id)
                    } else {
                        SpatialBodyId::Entity(actor_id)
                    },
                    contact,
                }
            }
            SpatialEvent::ForcedReposition { actor_id, pose } => {
                SpatialBodyEvent::ForcedReposition {
                    body_id: if actor_id == world.player.guid {
                        SpatialBodyId::LocalPlayer(actor_id)
                    } else {
                        SpatialBodyId::Entity(actor_id)
                    },
                    pose,
                }
            }
        }
    }

    fn apply_solve_batch(
        &mut self,
        world: &mut WorldState,
        movement: &mut MovementSystem,
        solved: SpatialSolveBatch,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();

        for actor in solved.solved {
            let solved_body = self.solve_body_kinematics_for_actor(world, actor);
            events.extend(world.apply_solved_body_kinematics(&solved_body));
            events.extend(movement.handle_post_solve(world, &solved_body));
        }

        for event in solved.events {
            let body_event = self.solve_body_event_for_actor(world, event);
            events.extend(world.apply_spatial_body_event(&body_event));
        }

        events
    }

    pub(super) async fn handle_server_controlled_movement(
        &mut self,
        data: MovementEventData,
        world: &mut WorldState,
        movement: &mut MovementSystem,
        session: &mut Session,
    ) -> Result<(Vec<WireEvent>, Vec<WorldEvent>)> {
        let mut wire_events = Vec::new();
        log::info!(
            ">>> Processing server-initiated movement: {:?}. Control Sequence: {}",
            data.movement_type,
            data.server_control_sequence
        );

        let Some(solved) = self.build_server_controlled_result(&data, world, &mut wire_events)
        else {
            return Ok((wire_events, Vec::new()));
        };

        let mut world_events = world.apply_solved_body_kinematics(&solved);
        world_events.extend(movement.handle_post_solve(world, &solved));
        MovementSystem::send_autonomous_position_sync(
            world,
            session,
            super::movement_types::MovementPacketMetadata::default(),
        )
        .await?;

        Ok((wire_events, world_events))
    }

    fn build_server_controlled_result(
        &self,
        data: &MovementEventData,
        world: &WorldState,
        wire_events: &mut Vec<WireEvent>,
    ) -> Option<SolvedBodyKinematics> {
        let guid = world.player.guid;
        if guid == Guid::NULL {
            return None;
        }

        let mut next_pos = world.local_player_runtime_pose()?;

        match &data.data {
            MovementTypeData::MoveToObject(mto) => {
                next_pos.landblock_id = mto.origin.cell_id;
                next_pos.coords = mto.origin.position;

                let arrival_dist = mto.params.distance_to_object;

                if (next_pos.landblock_id >> 16) == (mto.origin.cell_id >> 16) {
                    next_pos.coords =
                        calculate_arrival_position(&next_pos, &next_pos.coords, arrival_dist);

                    if mto.params.desired_heading.abs() <= 1e-6 {
                        next_pos.rotation = Quaternion::from_heading(
                            next_pos.coords.heading_to(&mto.origin.position),
                        );
                    } else {
                        next_pos.rotation = Quaternion::from_heading(mto.params.desired_heading);
                    }
                } else {
                    next_pos.coords.x += arrival_dist;
                }
            }
            MovementTypeData::MoveToPosition(mtp) => {
                next_pos.landblock_id = mtp.origin.cell_id;
                next_pos.coords = mtp.origin.position;

                if mtp.params.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(mtp.params.desired_heading);
                } else {
                    next_pos.rotation =
                        Quaternion::from_heading(next_pos.coords.heading_to(&mtp.origin.position));
                }
            }
            MovementTypeData::TurnToHeading(tth) => {
                next_pos.rotation = Quaternion::from_heading(tth.params.desired_heading);
            }
            MovementTypeData::TurnToObject(tto) => {
                if tto.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(tto.desired_heading);
                } else if let Some(target) = world.get_visible_entity(tto.target) {
                    if target.position.landblock_id == next_pos.landblock_id {
                        next_pos.rotation = Quaternion::from_heading(
                            next_pos.coords.heading_to(&target.position.coords),
                        );
                    }
                }
            }
            _ => {}
        }

        let distance = if next_pos.landblock_id == Guid::NULL {
            0.0
        } else {
            world
                .local_player_runtime_pose()
                .map_or(0.0, |current| current.distance_to(&next_pos))
        };

        if distance > AUTO_MOVE_DISTANCE_LIMIT {
            log::warn!(
                "Aborting auto-move: target is {:.2}m away (limit {}m)",
                distance,
                AUTO_MOVE_DISTANCE_LIMIT
            );
            wire_events.push(WireEvent::ClientError(format!(
                "Item is too far away ({:.1}m). Move closer!",
                distance
            )));
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
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::movement::MovementSystem;
    use holtburger_common::position::WorldPosition;
    use holtburger_world::{SpatialEvent, entity::Entity};

    #[test]
    fn apply_solve_batch_applies_spatial_events() {
        let mut simulation = ClientSimulationSystem::new();
        let mut movement = MovementSystem::new();
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        let remote_guid = Guid(0x5000_0002);
        let remote_pose = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(9.0, 7.0, 0.0),
            rotation: Quaternion::identity(),
        };

        world.player.guid = player_guid;
        world.player.position = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            ..Default::default()
        };
        world.add_entity(Entity::new(
            player_guid,
            "Player".to_string(),
            world.player.position,
        ));
        world.add_entity(Entity::new(
            remote_guid,
            "Remote".to_string(),
            world.player.position,
        ));

        let events = simulation.apply_solve_batch(
            &mut world,
            &mut movement,
            SpatialSolveBatch {
                solved: SmallVec::new(),
                events: SmallVec::from_vec(vec![
                    SpatialEvent::ContactChanged {
                        actor_id: player_guid,
                        contact: ContactState::Grounded,
                    },
                    SpatialEvent::ForcedReposition {
                        actor_id: remote_guid,
                        pose: remote_pose,
                    },
                ]),
            },
        );

        assert_eq!(world.player.server_grounded, Some(true));
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
}
