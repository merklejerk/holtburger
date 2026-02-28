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
                events.push(StateEvent::PropertyUpdated {
                    guid,
                    update: PropertyUpdate::Int(PropertyInt::StackSize, data.stack_size as i32),
                });
                events.push(StateEvent::PropertyUpdated {
                    guid,
                    update: PropertyUpdate::Int(PropertyInt::Value, data.value as i32),
                });
            }
            GameMessage::PrivateUpdatePropertyInt(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_int(data.property, data.value);
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
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
                } else if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                } else if let Some(vendor) = self.vendor.as_mut()
                    && let Some(item) = vendor.items.iter_mut().find(|i| i.guid == target_guid)
                {
                    item.set_property(update.clone());
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: target_guid,
                    update,
                });
            }
            GameMessage::PublicUpdatePropertyInt(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_int(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                } else if let Some(vendor) = self.vendor.as_mut()
                    && let Some(item) = vendor.items.iter_mut().find(|i| i.guid == target_guid)
                {
                    item.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
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
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PrivateUpdatePropertyInt64(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_int64(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                } else if let Some(vendor) = self.vendor.as_mut()
                    && let Some(item) = vendor.items.iter_mut().find(|i| i.guid == target_guid)
                {
                    item.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
                    match data.property {
                        p if p == PropertyInt64::TotalExperience as u32
                            || p == PropertyInt64::AvailableExperience as u32 =>
                        {
                            self.emit_level_info(events);
                        }
                        _ => {}
                    }
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PublicUpdatePropertyInt64(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_int64(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                } else if let Some(vendor) = self.vendor.as_mut()
                    && let Some(item) = vendor.items.iter_mut().find(|i| i.guid == target_guid)
                {
                    item.set_property(update.clone());
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PrivateUpdatePropertyBool(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_bool(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                } else if let Some(vendor) = self.vendor.as_mut()
                    && let Some(item) = vendor.items.iter_mut().find(|i| i.guid == target_guid)
                {
                    item.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PublicUpdatePropertyBool(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_bool(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                } else if let Some(vendor) = self.vendor.as_mut()
                    && let Some(item) = vendor.items.iter_mut().find(|i| i.guid == target_guid)
                {
                    item.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PrivateUpdatePropertyFloat(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_float(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
                    self.player.emit_derived_stats(events);
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PublicUpdatePropertyFloat(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_float(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
                    self.player.emit_derived_stats(events);
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PrivateUpdatePropertyString(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_string(data.property, data.value.clone());
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PublicUpdatePropertyString(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_string(data.property, data.value.clone());
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                } else if let Some(vendor) = self.vendor.as_mut()
                    && let Some(item) = vendor.items.iter_mut().find(|i| i.guid == target_guid)
                {
                    item.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PrivateUpdatePropertyDataId(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_did(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PublicUpdatePropertyDataId(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_did(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                }
                if target_guid == self.player.guid {
                    self.player.set_property(update.clone());
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PrivateUpdatePropertyInstanceId(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_iid(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                    if target_guid == self.player.guid {
                        self.player.set_property(update.clone());
                    }

                    if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
                        match prop {
                            PropertyInstanceId::Container => {
                                if data.value != Guid::NULL && target_guid != self.player.guid {
                                    let mut pos = entity.position;
                                    pos.landblock_id = Guid::NULL;
                                    let old_lb = entity.position.landblock_id;
                                    entity.position = pos;
                                    self.scene.remove_entity(entity.guid, old_lb);
                                }
                            }
                            PropertyInstanceId::Wielder => {
                                if data.value == Guid::NULL {
                                    entity.physics_parent_id = None;
                                }

                                if data.value != Guid::NULL && target_guid != self.player.guid {
                                    let mut pos = entity.position;
                                    pos.landblock_id = Guid::NULL;
                                    let old_lb = entity.position.landblock_id;
                                    entity.position = pos;
                                    self.scene.remove_entity(entity.guid, old_lb);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::PublicUpdatePropertyInstanceId(data) => {
                let target_guid = if data.guid == Guid::NULL {
                    self.player.guid
                } else {
                    data.guid
                };
                let update = PropertyUpdate::try_from_raw_iid(data.property, data.value);
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.set_property(update.clone());
                    if target_guid == self.player.guid {
                        self.player.set_property(update.clone());
                    }

                    if let Some(prop) = PropertyInstanceId::from_repr(data.property) {
                        match prop {
                            PropertyInstanceId::Container => {
                                if data.value != Guid::NULL && target_guid != self.player.guid {
                                    let mut pos = entity.position;
                                    pos.landblock_id = Guid::NULL;
                                    let old_lb = entity.position.landblock_id;
                                    entity.position = pos;
                                    self.scene.remove_entity(entity.guid, old_lb);
                                }
                            }
                            PropertyInstanceId::Wielder => {
                                if data.value == Guid::NULL {
                                    entity.physics_parent_id = None;
                                }

                                if data.value != Guid::NULL && target_guid != self.player.guid {
                                    let mut pos = entity.position;
                                    pos.landblock_id = Guid::NULL;
                                    let old_lb = entity.position.landblock_id;
                                    entity.position = pos;
                                    self.scene.remove_entity(entity.guid, old_lb);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                events.push(StateEvent::PropertyUpdated {
                    guid: data.guid,
                    update,
                });
            }
            GameMessage::SetState(data) => {
                if let Some(entity) = self.entities.get_mut(data.guid) {
                    entity.physics_state = data.physics_state;
                    entity.properties.hydrate_from_set_state(data);
                    events.push(StateEvent::EntityStateUpdated {
                        guid: data.guid,
                        physics_state: data.physics_state,
                    });
                }
            }
            _ => return false,
        }
        true
    }
}
