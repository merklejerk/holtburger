use crate::WorldEvent;
use crate::entity::EntityMotionSnapshot;
use crate::state::WorldState;
use holtburger_common::Guid;
use holtburger_common::math::Quaternion;
use holtburger_protocol::messages::{GameMessage, MovementTypeData};

fn update_entity_motion_snapshot(
    state: &mut WorldState,
    guid: Guid,
    snapshot: Option<EntityMotionSnapshot>,
    events: &mut Vec<WorldEvent>,
) {
    let Some(entity) = state.entities.get_mut(guid) else {
        return;
    };

    if entity.motion_snapshot != snapshot {
        entity.motion_snapshot = snapshot;
        if let Some(body_id) = state.update_runtime_body_motion_snapshot_for_guid(guid, snapshot) {
            events.push(WorldEvent::RuntimeBodyChanged { body_id });
        }
        events.push(WorldEvent::EntityMotionUpdated { guid, snapshot });
    }
}

pub(crate) fn handle_message(
    state: &mut WorldState,
    message: &GameMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    match message {
        GameMessage::UpdatePosition(data) => {
            if data.guid == state.player.guid {
                events.extend(state.set_player_position(data.pos.pos));
                true
            } else {
                state.apply_entity_position_pack(data.guid, &data.pos, events)
            }
        }
        GameMessage::PrivateUpdatePosition(data) => {
            state.apply_private_position_update(data.position_type, data.pos, events);
            true
        }
        GameMessage::PublicUpdatePosition(data) => {
            state.apply_public_position_update(data.guid, data.position_type, data.pos, events)
        }
        GameMessage::AutonomousPosition(data) => {
            if data.guid == state.player.guid {
                events.extend(state.apply_player_autonomous_position(data));
                true
            } else {
                state.apply_entity_autonomous_position(data, events)
            }
        }
        GameMessage::UpdateMotion(data) => {
            let guid = data.guid;
            let snapshot = EntityMotionSnapshot::from_movement_event(data);

            update_entity_motion_snapshot(state, guid, snapshot, events);

            if snapshot.is_some_and(EntityMotionSnapshot::indicates_death_motion) {
                state.update_health_fraction(guid, 0.0, events);
            }

            let mut target_info = None;
            if let MovementTypeData::TurnToObject(turn) = &data.data
                && turn.desired_heading.abs() <= 1e-6
                && let Some(target) = state.entities.get(turn.target)
            {
                target_info = Some((target.position.landblock_id, target.position.coords));
            }

            let current_position = match state.entities.get(guid) {
                Some(entity) => entity.position,
                None => return false,
            };

            let maybe_rotation = match &data.data {
                MovementTypeData::TurnToHeading(turn)
                    if turn.params.desired_heading.is_finite() =>
                {
                    Some(Quaternion::from_heading(turn.params.desired_heading))
                }
                MovementTypeData::TurnToObject(turn) => {
                    if turn.desired_heading.is_finite() && turn.desired_heading.abs() > 1e-6 {
                        Some(Quaternion::from_heading(turn.desired_heading))
                    } else if let Some((target_lb, target_coords)) = target_info {
                        if target_lb == current_position.landblock_id {
                            Some(Quaternion::from_heading(
                                current_position.coords.heading_to(&target_coords),
                            ))
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                _ => None,
            };

            if let Some(rotation) = maybe_rotation {
                state.set_entity_rotation(guid, rotation, events)
            } else {
                false
            }
        }
        GameMessage::VectorUpdate(data) => {
            if data.guid == state.player.guid {
                events.extend(state.set_player_vector(data.velocity, data.omega));
                true
            } else {
                state.update_entity_velocity(data.guid, data.velocity, data.omega, events)
            }
        }
        _ => false,
    }
}
