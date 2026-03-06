use super::super::*;

impl WorldState {
    pub(crate) fn handle_inventory_message(
        &mut self,
        msg: &GameMessage,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        match msg {
            GameMessage::ObjectCreate(data) => {
                let entity_name = data
                    .public_weenie_desc
                    .name
                    .as_deref()
                    .unwrap_or("Unknown")
                    .to_string();

                let mut entity = Entity::new(
                    data.public_weenie_desc.guid,
                    entity_name,
                    data.pos.unwrap_or_default(),
                );
                entity.apply_description(data);

                // Update inventory tracking for new objects appearing in containers
                if let Some(cid) = entity.container_id()
                    && (cid == self.player.guid || self.player.inventory.contains(&cid))
                {
                    self.player.add_to_inventory(entity.guid);
                }
                if let Some(wid) = entity.wielder_id()
                    && wid == self.player.guid
                {
                    self.player.add_to_inventory(entity.guid);
                }

                self.add_entity(entity.clone());
                events.push(StateEvent::EntitySpawned(Box::new(entity)));
            }
            GameMessage::ObjectDelete(data) => {
                let guid = data.guid;

                // Sync inventory recursively before removing
                self.update_player_inventory_recursive(guid, false);

                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(StateEvent::EntityDespawned(guid));
                }
            }
            GameMessage::ParentEvent(data) => {
                if let Some(entity) = self.entities.get_mut(data.child_guid) {
                    entity.physics_parent_id = if data.parent_guid == Guid::NULL {
                        None
                    } else {
                        Some(data.parent_guid)
                    };

                    // When parented, we keep it in the entities list but it's no longer a root object in the world
                    if data.parent_guid != Guid::NULL && data.child_guid != self.player.guid {
                        entity.position.landblock_id = Guid::NULL;
                    }
                }
            }
            GameMessage::PickupEvent(data) => {
                let guid = data.guid;
                // If the entity is in a container or parented, we don't actually want to remove it from our knowledge,
                // just from the spatial scene (which remove_entity handles if we go that route, but here we might want to keep it).

                let mut should_remove = true;
                #[allow(clippy::collapsible_if)]
                if let Some(entity) = self.entities.get(guid) {
                    if entity.container_id().is_some()
                        || entity.wielder_id().is_some()
                        || entity.physics_parent_id.is_some()
                    {
                        should_remove = false;
                    }
                }

                if should_remove {
                    if let Some(_entity) = self.remove_entity(guid) {
                        events.push(StateEvent::EntityDespawned(guid));
                    }
                } else {
                    let _ = self.clear_entity_world_presence(guid);
                }
            }
            GameMessage::InventoryRemoveObject(data) => {
                let guid = data.object_guid;

                // Recursively remove from inventory tracking before deleting the entity
                self.update_player_inventory_recursive(guid, false);

                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(StateEvent::EntityDespawned(guid));
                }
            }
            _ => return false,
        }
        true
    }

    pub(crate) fn handle_inventory_event(
        &mut self,
        _msg: &GameMessage,
        ev: &GameEventMessage,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        match &ev.event {
            GameEvent::InventoryPutObjInContainer(data) => {
                let _ = self.move_entity_into_container(data.item_guid, data.container_guid, events);
            }
            GameEvent::InventoryPutObjectIn3D(data) => {
                let _ = self.move_entity_into_world(data.object_guid, events);
            }
            GameEvent::ViewContents(data) => {
                self.open_containers.insert(data.container);
                events.push(StateEvent::ContainerOpened(data.container));

                for item in &data.items {
                    let guid = item.guid;
                    // If we don't know the entity, create a placeholder
                    if self.entities.get(guid).is_none() {
                        let mut entity =
                            Entity::new(guid, "Unknown Item".to_string(), Default::default());
                        entity.set_iid_prop(PropertyInstanceId::Container, data.container);

                        self.add_entity(entity.clone());
                        events.push(StateEvent::EntitySpawned(Box::new(entity)));
                    } else if let Some(entity) = self.entities.get_mut(guid) {
                        // If existing entity, ensure container property is set and it is removed from world space
                        let old_lb = entity.position.landblock_id;
                        if old_lb != Guid::NULL || entity.container_id() != Some(data.container) {
                            entity.set_iid_prop(PropertyInstanceId::Container, data.container);
                            entity.position.landblock_id = Guid::NULL;

                            if old_lb != Guid::NULL {
                                self.scene.remove_entity(guid, old_lb);
                            }

                            events.push(StateEvent::PropertiesUpdated {
                                guid,
                                updates: vec![PropertyUpdate::InstanceId(
                                    PropertyInstanceId::Container,
                                    data.container,
                                )],
                            });
                        }
                    }
                }
            }
            GameEvent::CloseGroundContainer(data) => {
                self.open_containers.remove(&data.container_guid);
                events.push(StateEvent::ContainerClosed(data.container_guid));
            }
            GameEvent::IdentifyObjectResponse(data) => {
                let guid = data.object_guid;

                if let Some(entity) = self.entities.get_mut(guid) {
                    entity.properties.merge(data.properties.clone());

                    if data.armor_profile.is_some() {
                        entity.armor_profile = data.armor_profile.clone();
                    }
                    if data.creature_profile.is_some() {
                        entity.creature_profile = data.creature_profile.clone();
                    }
                    if data.weapon_profile.is_some() {
                        entity.weapon_profile = data.weapon_profile.clone();
                    }
                    if data.hook_profile.is_some() {
                        entity.hook_profile = data.hook_profile.clone();
                    }
                    if data.armor_levels.is_some() {
                        entity.armor_levels = data.armor_levels.clone();
                    }
                    if !data.spell_book.is_empty() {
                        entity.spell_book = data.spell_book.clone();
                    }

                    entity.armor_highlight = data.armor_highlight;
                    entity.armor_color = data.armor_color;
                    entity.weapon_highlight = data.weapon_highlight;
                    entity.weapon_color = data.weapon_color;
                    entity.resist_highlight = data.resist_highlight;
                    entity.resist_color = data.resist_color;

                    events.push(StateEvent::EntityIdentified(Box::new(entity.clone())));
                }
            }
            GameEvent::WieldObject(data) => {
                let _ = self.wield_entity_for(data.object_guid, ev.target, data.equip_mask, events);
            }
            GameEvent::UseDone(data) => {
                let _ = data;
                return false;
            }
            GameEvent::WeenieError(_) => return false,
            GameEvent::WeenieErrorWithString(_) => return false,
            _ => return false,
        }
        true
    }
}
