use crate::client::WireEvent;
use anyhow::Result;
use super::movement::MovementSystem;
use super::movement_types::MotionState;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::{
    ContactState, SolveActorInput, SolvedActorKinematics, SpatialSolveBatch,
    SpatialSolveRequest, WorldEvent, WorldState,
};
use smallvec::SmallVec;
use std::sync::Arc;
use std::time::{Duration, Instant};

const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;
const ACTIVE_SOLVE_RADIUS_M: f32 = 96.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct LocalMotionIntent {
    pub actor_id: Guid,
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
    tracked_actor_ids: SmallVec<[Guid; 4]>,
}

impl ClientSimulationSystem {
    pub(super) fn new() -> Self {
        Self::default()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) fn track_actor(&mut self, actor_id: Guid) {
        if actor_id != Guid::NULL && !self.tracked_actor_ids.contains(&actor_id) {
            self.tracked_actor_ids.push(actor_id);
        }
    }

    pub(super) fn untrack_actor(&mut self, actor_id: Guid) {
        self.tracked_actor_ids.retain(|tracked| *tracked != actor_id);
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

        let physics = Arc::clone(&world.scene.physics);
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
        let local_pose = local_intent
            .and_then(|intent| self.build_actor_input(world, intent.actor_id))
            .map(|actor| actor.pose);
        let nearby_tracked = local_pose
            .map(|pose| world.scene.get_entities_in_range(&pose, ACTIVE_SOLVE_RADIUS_M));
        let mut actors = SmallVec::<[SolveActorInput; 1]>::new();

        if let Some(intent) = local_intent
            && let Some(actor) = self.build_actor_input(world, intent.actor_id)
        {
            actors.push(actor);
        }

        for actor_id in self.tracked_actor_ids.iter().copied() {
            if actors.iter().any(|actor| actor.actor_id == actor_id) {
                continue;
            }

            if nearby_tracked
                .as_ref()
                .is_some_and(|guids| !guids.contains(&actor_id))
            {
                continue;
            }

            if let Some(actor) = self.build_actor_input(world, actor_id) {
                actors.push(actor);
            }
        }

        if actors.is_empty() {
            return None;
        }

        Some(SpatialSolveRequest {
            dt,
            actors,
        })
    }

    fn build_actor_input(&self, world: &WorldState, actor_id: Guid) -> Option<SolveActorInput> {
        let entity = world.entities.get(actor_id)?;

        Some(SolveActorInput {
            actor_id,
            pose: if actor_id == world.player.guid {
                world.player.position
            } else {
                entity.position
            },
            velocity: entity.velocity,
            omega: entity.omega,
        })
    }

    fn apply_solve_batch(
        &mut self,
        world: &mut WorldState,
        movement: &mut MovementSystem,
        solved: SpatialSolveBatch,
    ) -> Vec<WorldEvent> {
        let mut events = Vec::new();

        for actor in solved.solved {
            events.extend(world.apply_solved_actor_kinematics(&actor));
            events.extend(movement.handle_post_solve(world, &actor));
        }

        for event in solved.events {
            events.extend(world.apply_spatial_event(&event));
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

        let mut world_events = world.apply_solved_actor_kinematics(&solved);
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
    ) -> Option<SolvedActorKinematics> {
        let guid = world.player.guid;
        if guid == Guid::NULL {
            return None;
        }

        let mut next_pos = world.player.position;

        match &data.data {
            MovementTypeData::MoveToObject(mto) => {
                next_pos.landblock_id = mto.origin.cell_id;
                next_pos.coords = mto.origin.position;

                let arrival_dist = mto.params.distance_to_object;

                if (world.player.position.landblock_id >> 16) == (next_pos.landblock_id >> 16) {
                    next_pos.coords = calculate_arrival_position(
                        &world.player.position,
                        &next_pos.coords,
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
                        world.player.position.coords.heading_to(&next_pos.coords),
                    );
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

        let distance = if world.player.position.landblock_id == Guid::NULL {
            0.0
        } else {
            world.player.position.distance_to(&next_pos)
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

        let (velocity, omega) = world
            .entities
            .get(guid)
            .map(|entity| (entity.velocity, entity.omega))
            .unwrap_or((Vector3::zero(), Vector3::zero()));

        Some(SolvedActorKinematics {
            actor_id: guid,
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
        world.add_entity(Entity::new(player_guid, "Player".to_string(), world.player.position));
        world.add_entity(Entity::new(remote_guid, "Remote".to_string(), world.player.position));

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
                .entities
                .get(remote_guid)
                .expect("remote should still exist")
                .position,
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