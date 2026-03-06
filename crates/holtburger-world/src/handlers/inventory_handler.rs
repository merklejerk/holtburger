use crate::entity::Entity;
use crate::state::WorldState;
use crate::StateEvent;
use holtburger_common::Guid;
use holtburger_common::properties::{
    PropertyInstanceId, PropertyUpdate, WorldObjectPropertyAccessorsMut,
};
use holtburger_protocol::messages::{GameEvent, GameEventMessage, GameMessage};

pub(crate) fn handle_message(
    state: &mut WorldState,
    message: &GameMessage,
    events: &mut Vec<StateEvent>,
) -> bool {
    match message {
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

            if let Some(cid) = entity.container_id()
                && (cid == state.player.guid || state.player.inventory.contains(&cid))
            {
                state.player.add_to_inventory(entity.guid);
            }
            if let Some(wid) = entity.wielder_id()
                && wid == state.player.guid
            {
                state.player.add_to_inventory(entity.guid);
            }

            state.add_entity(entity.clone());
            events.push(StateEvent::EntitySpawned(Box::new(entity)));
            true
        }
        GameMessage::ObjectDelete(data) => {
            remove_entity_with_inventory_cleanup(state, data.guid, events)
        }
        GameMessage::InventoryRemoveObject(data) => {
            remove_entity_with_inventory_cleanup(state, data.object_guid, events)
        }
        GameMessage::ParentEvent(data) => {
            if let Some(entity) = state.entities.get_mut(data.child_guid) {
                entity.physics_parent_id = if data.parent_guid == Guid::NULL {
                    None
                } else {
                    Some(data.parent_guid)
                };

                if data.parent_guid != Guid::NULL && data.child_guid != state.player.guid {
                    entity.position.landblock_id = Guid::NULL;
                }

                true
            } else {
                false
            }
        }
        GameMessage::PickupEvent(data) => {
            let guid = data.guid;
            let mut should_remove = true;
            if let Some(entity) = state.entities.get(guid)
                && (entity.container_id().is_some()
                    || entity.wielder_id().is_some()
                    || entity.physics_parent_id.is_some())
            {
                should_remove = false;
            }

            if should_remove {
                if state.remove_entity(guid).is_some() {
                    events.push(StateEvent::EntityDespawned(guid));
                    true
                } else {
                    false
                }
            } else {
                state.clear_entity_world_presence(guid)
            }
        }
        _ => false,
    }
}

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<StateEvent>,
) -> bool {
    match &event.event {
        GameEvent::InventoryPutObjInContainer(data) => {
            state.move_entity_into_container(data.item_guid, data.container_guid, events)
        }
        GameEvent::InventoryPutObjectIn3D(data) => {
            state.move_entity_into_world(data.object_guid, events)
        }
        GameEvent::ViewContents(data) => {
            state.open_containers.insert(data.container);
            events.push(StateEvent::ContainerOpened(data.container));

            for item in &data.items {
                let guid = item.guid;
                if state.entities.get(guid).is_none() {
                    let mut entity =
                        Entity::new(guid, "Unknown Item".to_string(), Default::default());
                    entity.set_iid_prop(PropertyInstanceId::Container, data.container);
                    state.add_entity(entity.clone());
                    events.push(StateEvent::EntitySpawned(Box::new(entity)));
                } else if let Some(entity) = state.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    if old_lb != Guid::NULL || entity.container_id() != Some(data.container) {
                        entity.set_iid_prop(PropertyInstanceId::Container, data.container);
                        entity.position.landblock_id = Guid::NULL;

                        if old_lb != Guid::NULL {
                            state.scene.remove_entity(guid, old_lb);
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

            true
        }
        GameEvent::CloseGroundContainer(data) => {
            state.open_containers.remove(&data.container_guid);
            events.push(StateEvent::ContainerClosed(data.container_guid));
            true
        }
        GameEvent::IdentifyObjectResponse(data) => {
            let guid = data.object_guid;
            if let Some(entity) = state.entities.get_mut(guid) {
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
                true
            } else {
                false
            }
        }
        GameEvent::WieldObject(data) => {
            state.wield_entity_for(data.object_guid, event.target, data.equip_mask, events)
        }
        _ => false,
    }
}

fn remove_entity_with_inventory_cleanup(
    state: &mut WorldState,
    guid: Guid,
    events: &mut Vec<StateEvent>,
) -> bool {
    state.update_player_inventory_recursive(guid, false);
    if state.remove_entity(guid).is_some() {
        events.push(StateEvent::EntityDespawned(guid));
        true
    } else {
        false
    }
}