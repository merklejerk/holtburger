use super::super::*;

impl WorldState {
    pub(crate) fn handle_property_message(
        &mut self,
        msg: &GameMessage,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        match msg {
            GameMessage::SetStackSize(data) => {
                let guid = data.object_guid;
                if let Some(entity) = self.entities.get_mut(guid) {
                    entity.set_property(PropertyUpdate::Int(
                        PropertyInt::StackSize,
                        data.stack_size as i32,
                    ));
                    entity.set_property(PropertyUpdate::Int(PropertyInt::Value, data.value as i32));
                }
                events.push(StateEvent::PropertiesUpdated {
                    guid,
                    updates: vec![
                        PropertyUpdate::Int(PropertyInt::StackSize, data.stack_size as i32),
                        PropertyUpdate::Int(PropertyInt::Value, data.value as i32),
                    ],
                });
            }
            GameMessage::PrivateUpdatePropertyInt(data) => {
                let update = PropertyUpdate::try_from_raw_int(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                if target_guid == self.player.guid {
                    match data.property {
                        p if p == PropertyInt::Level as u32
                            || p == PropertyInt::AvailableSkillCredits as u32 =>
                        {
                            self.emit_level_info(events);
                        }
                        p if p == PropertyInt::CombatMode as u32 => {
                            if let Some(mode) =
                                holtburger_protocol::messages::combat::CombatMode::from_repr(
                                    data.value as u32,
                                )
                            {
                                events.push(StateEvent::CombatModeUpdated(mode));
                            }
                        }
                        _ => {}
                    }
                    self.player.emit_derived_stats(events);
                }
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PublicUpdatePropertyInt(data) => {
                let update = PropertyUpdate::try_from_raw_int(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                if target_guid == self.player.guid {
                    if data.property == PropertyInt::CombatMode as u32 {
                        let maybe_mode =
                            holtburger_protocol::messages::combat::CombatMode::from_repr(
                                data.value as u32,
                            );

                        if let Some(mode) = maybe_mode {
                            events.push(StateEvent::CombatModeUpdated(mode));
                        }
                    }
                    self.player.emit_derived_stats(events);
                }
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PrivateUpdatePropertyInt64(data) => {
                let update = PropertyUpdate::try_from_raw_int64(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                if target_guid == self.player.guid {
                    match data.property {
                        p if p == PropertyInt64::TotalExperience as u32
                            || p == PropertyInt64::AvailableExperience as u32
                            || p == PropertyInt64::AvailableLuminance as u32 =>
                        {
                            self.emit_level_info(events);
                        }
                        _ => {}
                    }
                }
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PublicUpdatePropertyInt64(data) => {
                let update = PropertyUpdate::try_from_raw_int64(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, false);
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PrivateUpdatePropertyBool(data) => {
                let update = PropertyUpdate::try_from_raw_bool(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PublicUpdatePropertyBool(data) => {
                let update = PropertyUpdate::try_from_raw_bool(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PrivateUpdatePropertyFloat(data) => {
                let update = PropertyUpdate::try_from_raw_float(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                if target_guid == self.player.guid {
                    self.player.emit_derived_stats(events);
                }
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PublicUpdatePropertyFloat(data) => {
                let update = PropertyUpdate::try_from_raw_float(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                if target_guid == self.player.guid {
                    self.player.emit_derived_stats(events);
                }
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PrivateUpdatePropertyString(data) => {
                let update = PropertyUpdate::try_from_raw_string(data.property, data.value.clone());
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PublicUpdatePropertyString(data) => {
                let update = PropertyUpdate::try_from_raw_string(data.property, data.value.clone());
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PrivateUpdatePropertyDataId(data) => {
                let update = PropertyUpdate::try_from_raw_did(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PublicUpdatePropertyDataId(data) => {
                let update = PropertyUpdate::try_from_raw_did(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PrivateUpdatePropertyInstanceId(data) => {
                let update = PropertyUpdate::try_from_raw_iid(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
                    self.apply_instance_id_side_effect(target_guid, prop, data.value);
                }
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            GameMessage::PublicUpdatePropertyInstanceId(data) => {
                let update = PropertyUpdate::try_from_raw_iid(data.property, data.value);
                let target_guid = self.apply_property_update_to_target(data.guid, &update, true);
                if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
                    self.apply_instance_id_side_effect(target_guid, prop, data.value);
                }
                events.push(StateEvent::PropertiesUpdated {
                    guid: target_guid,
                    updates: vec![update],
                });
            }
            _ => return false,
        }
        true
    }
}
