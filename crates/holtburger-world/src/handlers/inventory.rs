use crate::WorldEvent;
use crate::book::BookData;
use crate::entity::Entity;
use crate::state::WorldState;
use crate::state::liveness::EntityUpsertKind;
use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_common::properties::{
    PropertyInstanceId, PropertyUpdate, WorldObjectPropertyAccessorsMut,
};
use holtburger_protocol::messages::{GameEvent, GameEventMessage, GameMessage};

pub(crate) fn handle_message(
    state: &mut WorldState,
    message: &GameMessage,
    events: &mut Vec<WorldEvent>,
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
            if state
                .entities
                .get(guid)
                .and_then(|entity| entity.container_id())
                .is_some_and(|container| state.open_containers.contains(&container))
            {
                state.mark_container_preview(guid);
            }
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
            } else {
                return false;
            }

            if data.parent_guid != Guid::NULL
                && data.child_guid != state.player.guid
                && let Some(pos) = state.clear_entity_world_presence(data.child_guid)
            {
                events.push(WorldEvent::EntityMoved {
                    guid: data.child_guid,
                    pos,
                });
            }

            let _ = state.reconcile_entity_retention(data.child_guid);

            true
        }
        GameMessage::PickupEvent(data) => {
            let guid = data.guid;
            let had_entity = state.entities.get(guid).is_some();
            if !had_entity {
                return false;
            }

            if let Some(pos) = state.clear_entity_world_presence(guid) {
                events.push(WorldEvent::EntityMoved { guid, pos });
            }
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
    events: &mut Vec<WorldEvent>,
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
            events.push(WorldEvent::ContainerOpened(data.container));

            for item in &data.items {
                let guid = item.guid;
                if let Some(entity) = state.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    if old_lb != Guid::NULL || entity.container_id() != Some(data.container) {
                        entity.set_iid_prop(PropertyInstanceId::Container, data.container);
                        entity.position.landblock_id = Guid::NULL;

                        if old_lb != Guid::NULL {
                            state.scene.remove_entity(guid, old_lb);
                            state.retire_authoritative_body_for_guid(guid);
                        }

                        events.push(WorldEvent::PropertiesUpdated {
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
            events.push(WorldEvent::ContainerClosed(data.container_guid));
            state.mark_container_preview_entities_for_prune(&item_guids);
            true
        }
        GameEvent::IdentifyObjectResponse(data) => {
            let guid = data.object_guid;
            if let Some(entity) = state.entities.get_mut(guid) {
                if entity.apply_identify_response(data) {
                    events.push(WorldEvent::EntityIdentified(Box::new(entity.clone())));
                    true
                } else {
                    false
                }
            } else if let Some(vendor) = state.vendor.as_mut()
                && let Some(item) = vendor.items.iter_mut().find(|item| item.guid == guid)
            {
                if item.apply_identify_response(data) {
                    events.push(WorldEvent::VendorItemIdentified(Box::new(item.clone())));
                    true
                } else {
                    false
                }
            } else {
                false
            }
        }
        GameEvent::BookDataResponse(data) => {
            let guid = data.object_guid;
            if let Some(entity) = state.entities.get_mut(guid) {
                let book = BookData::from_response(data);
                entity.book = Some(book.clone());
                events.push(WorldEvent::EntityBookUpdated {
                    guid,
                    book: Box::new(book),
                });
                true
            } else {
                false
            }
        }
        GameEvent::BookPageDataResponse(data) => {
            let guid = data.object_guid;
            if let Some(entity) = state.entities.get_mut(guid) {
                let book = {
                    let book = entity.book.get_or_insert_with(BookData::default);
                    book.apply_page_response(data);
                    book.clone()
                };

                events.push(WorldEvent::EntityBookUpdated {
                    guid,
                    book: Box::new(book),
                });
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
