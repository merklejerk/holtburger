use crate::StateEvent;
use crate::state::WorldState;
use holtburger_common::Guid;
use holtburger_common::properties::{PropertyInstanceId, PropertyInt, PropertyUpdate};
use holtburger_protocol::messages::GameMessage;

fn is_player_target(state: &WorldState, guid: Guid) -> bool {
	state.resolve_property_target_guid(guid) == state.player.guid
}

pub(crate) fn handle_message(
	state: &mut WorldState,
	message: &GameMessage,
	events: &mut Vec<StateEvent>,
) -> bool {
	match message {
		GameMessage::SetStackSize(data) => {
			let guid = data.object_guid;
			if let Some(entity) = state.entities.get_mut(guid) {
				entity.set_property(PropertyUpdate::Int(
					PropertyInt::StackSize,
					data.stack_size as i32,
				));
				entity.set_property(PropertyUpdate::Int(PropertyInt::Value, data.value as i32));
				events.push(StateEvent::PropertiesUpdated {
					guid,
					updates: vec![
						PropertyUpdate::Int(PropertyInt::StackSize, data.stack_size as i32),
						PropertyUpdate::Int(PropertyInt::Value, data.value as i32),
					],
				});
				true
			} else {
				false
			}
		}
		GameMessage::PrivateUpdatePropertyInt(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_int(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PublicUpdatePropertyInt(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_int(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PrivateUpdatePropertyInt64(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_int64(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PublicUpdatePropertyInt64(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_int64(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PrivateUpdatePropertyBool(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_bool(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PublicUpdatePropertyBool(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_bool(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PrivateUpdatePropertyFloat(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_float(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PublicUpdatePropertyFloat(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_float(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PrivateUpdatePropertyString(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_string(data.property, data.value.clone());
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PublicUpdatePropertyString(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_string(data.property, data.value.clone());
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PrivateUpdatePropertyDataId(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_did(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PublicUpdatePropertyDataId(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_did(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PrivateUpdatePropertyInstanceId(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_iid(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
				state.apply_instance_id_side_effect(target_guid, prop, data.value);
			}
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		GameMessage::PublicUpdatePropertyInstanceId(data) if !is_player_target(state, data.guid) => {
			let update = PropertyUpdate::try_from_raw_iid(data.property, data.value);
			let target_guid = state.apply_property_update_to_target(data.guid, &update, false);
			if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
				state.apply_instance_id_side_effect(target_guid, prop, data.value);
			}
			events.push(StateEvent::PropertiesUpdated {
				guid: target_guid,
				updates: vec![update],
			});
			true
		}
		_ => false,
	}
}
