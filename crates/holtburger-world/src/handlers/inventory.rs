use crate::StateEvent;
use crate::entity::Entity;
use crate::state::liveness::EntityUpsertKind;
use crate::state::WorldState;
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

            let guid = entity.guid;
            let upsert_kind = state.upsert_entity_from_create(entity, events);
            state.sync_player_ownership_for_entity(guid);
            let _ = state.reconcile_entity_retention(guid);

            if matches!(upsert_kind, EntityUpsertKind::Inserted) {
                return true;
            }

            true
        }
        GameMessage::ObjectDelete(data) => {
            state.update_player_inventory_recursive(data.guid, false);
            state.mark_entity_explicit_delete(data.guid);
            true
        }
        GameMessage::InventoryRemoveObject(data) => {
            state.update_player_inventory_recursive(data.object_guid, false);
            state.mark_entity_explicit_delete(data.object_guid);
            true
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

                let _ = state.reconcile_entity_retention(data.child_guid);

                true
            } else {
                false
            }
        }
        GameMessage::PickupEvent(data) => {
            let guid = data.guid;
            let had_entity = state.entities.get(guid).is_some();
            if !had_entity {
                return false;
            }

            let _ = state.clear_entity_world_presence(guid);
            let snapshot = state.reconcile_entity_retention(guid);
            if snapshot.is_some_and(|retention| !retention.is_retained()) {
                state.mark_entity_explicit_delete(guid);
            }

            true
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
                if let Some(entity) = state.entities.get_mut(guid) {
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

                    state.mark_container_preview(guid);
                    state.sync_player_ownership_for_entity(guid);
                    let _ = state.reconcile_entity_retention(guid);
                }
            }

            true
        }
        GameEvent::CloseGroundContainer(data) => {
            let item_guids = state.current_container_preview_item_guids(data.container_guid);
            state.open_containers.remove(&data.container_guid);
            events.push(StateEvent::ContainerClosed(data.container_guid));
            state.mark_container_preview_entities_for_prune(&item_guids);
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
