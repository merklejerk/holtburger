use crate::StateEvent;
use crate::state::WorldState;
use holtburger_common::math::Quaternion;
use holtburger_protocol::messages::{GameMessage, MovementTypeData};

pub(crate) fn handle_message(
	state: &mut WorldState,
	message: &GameMessage,
	events: &mut Vec<StateEvent>,
) -> bool {
	match message {
		GameMessage::UpdatePosition(data) => {
			if data.guid == state.player.guid {
				events.extend(state.set_player_position(data.pos.pos));
				true
			} else {
				state.move_entity_to_position(data.guid, data.pos.pos, events)
			}
		}
		GameMessage::PrivateUpdatePosition(data) => {
			events.extend(state.set_player_position(data.pos));
			true
		}
		GameMessage::PublicUpdatePosition(data) => {
			if data.guid == state.player.guid {
				events.extend(state.set_player_position(data.pos));
				true
			} else {
				state.move_entity_to_position(data.guid, data.pos, events)
			}
		}
		GameMessage::AutonomousPosition(data) => {
			if data.guid == state.player.guid {
				events.extend(state.apply_player_autonomous_position(data));
				true
			} else {
				state.move_entity_to_position(data.guid, data.position, events)
			}
		}
		GameMessage::UpdateMotion(data) => {
			let guid = data.guid;

			let mut target_info = None;
			if let MovementTypeData::TurnToObject(turn) = &data.data
				&& turn.desired_heading.abs() <= 1e-6
				&& let Some(target) = state.entities.get(turn.target)
			{
				target_info = Some((target.position.landblock_id, target.position.coords));
			}

			let current_position = if guid == state.player.guid {
				state.player.position
			} else {
				match state.entities.get(guid) {
					Some(entity) => entity.position,
					None => return false,
				}
			};

			let maybe_rotation = match &data.data {
				MovementTypeData::TurnToHeading(turn) if turn.params.desired_heading.is_finite() => {
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
				if guid == state.player.guid {
					let mut pos = state.player.position;
					pos.rotation = rotation;
					events.extend(state.set_player_position(pos));
					true
				} else {
					state.set_entity_rotation(guid, rotation, events)
				}
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
