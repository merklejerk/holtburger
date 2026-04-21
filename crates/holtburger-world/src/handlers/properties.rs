use crate::WorldEvent;
use crate::state::WorldState;
use holtburger_common::properties::{PropertyInstanceId, PropertyInt, PropertyUpdate};
use holtburger_protocol::messages::GameMessage;

pub(crate) fn handle_message(
    state: &mut WorldState,
    message: &GameMessage,
    events: &mut Vec<WorldEvent>,
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
                events.push(WorldEvent::PropertiesUpdated {
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
        GameMessage::PrivateUpdatePropertyInt(data) => {
            let update = PropertyUpdate::try_from_raw_int(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            if target_guid == state.player.guid {
                match data.property {
                    p if p == PropertyInt::Level as u32
                        || p == PropertyInt::AvailableSkillCredits as u32 =>
                    {
                        state.emit_level_info(events);
                    }
                    p if p == PropertyInt::CombatMode as u32 => {
                        events.push(WorldEvent::CombatModeUpdated(state.player_combat_mode()));
                    }
                    _ => {}
                }
                state.emit_player_derived_stats(events);
            }
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PublicUpdatePropertyInt(data) => {
            let update = PropertyUpdate::try_from_raw_int(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            if target_guid == state.player.guid {
                if data.property == PropertyInt::CombatMode as u32 {
                    events.push(WorldEvent::CombatModeUpdated(state.player_combat_mode()));
                }
                state.emit_player_derived_stats(events);
            }
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PrivateUpdatePropertyInt64(data) => {
            let update = PropertyUpdate::try_from_raw_int64(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            if target_guid == state.player.guid {
                match data.property {
                    p if p
                        == holtburger_common::properties::PropertyInt64::TotalExperience as u32
                        || p == holtburger_common::properties::PropertyInt64::AvailableExperience
                            as u32
                        || p == holtburger_common::properties::PropertyInt64::AvailableLuminance
                            as u32 =>
                    {
                        state.emit_level_info(events);
                    }
                    _ => {}
                }
            }
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PublicUpdatePropertyInt64(data) => {
            let update = PropertyUpdate::try_from_raw_int64(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PrivateUpdatePropertyBool(data) => {
            let update = PropertyUpdate::try_from_raw_bool(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PublicUpdatePropertyBool(data) => {
            let update = PropertyUpdate::try_from_raw_bool(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PrivateUpdatePropertyFloat(data) => {
            let update = PropertyUpdate::try_from_raw_float(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            if target_guid == state.player.guid {
                state.emit_player_derived_stats(events);
            }
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PublicUpdatePropertyFloat(data) => {
            let update = PropertyUpdate::try_from_raw_float(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            if target_guid == state.player.guid {
                state.emit_player_derived_stats(events);
            }
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PrivateUpdatePropertyString(data) => {
            let update = PropertyUpdate::try_from_raw_string(data.property, data.value.clone());
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PublicUpdatePropertyString(data) => {
            let update = PropertyUpdate::try_from_raw_string(data.property, data.value.clone());
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PrivateUpdatePropertyDataId(data) => {
            let update = PropertyUpdate::try_from_raw_did(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PublicUpdatePropertyDataId(data) => {
            let update = PropertyUpdate::try_from_raw_did(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PrivateUpdatePropertyInstanceId(data) => {
            let prop = PropertyInstanceId::from_repr(data.property);
            let update = PropertyUpdate::try_from_raw_iid(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            if let Some(prop) = prop {
                state.apply_instance_id_side_effect(target_guid, prop, data.value, events);
            }
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        GameMessage::PublicUpdatePropertyInstanceId(data) => {
            let prop = PropertyInstanceId::from_repr(data.property);
            let update = PropertyUpdate::try_from_raw_iid(data.property, data.value);
            let target_guid = state.apply_property_update_to_target(data.guid, &update);
            if let Some(prop) = prop {
                state.apply_instance_id_side_effect(target_guid, prop, data.value, events);
            }
            events.push(WorldEvent::PropertiesUpdated {
                guid: target_guid,
                updates: vec![update],
            });
            true
        }
        _ => false,
    }
}
