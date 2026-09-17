use crate::WorldEvent;
use crate::book::BookData;
use crate::entity::Entity;
use crate::state::WorldState;
use crate::state::liveness::EntityCreateDisposition;
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
        GameMessage::ObjDescEvent(data) => {
            state.apply_object_visual_description(data, events);
            true
        }
        // Retail HandleUpdateObject forces HandleCreateObject recreation
        // (acclient.c:140101,139601), matching this replacement/admission path.
        // Semantic-only property updates use their own mutation path and keep motion.
        GameMessage::ObjectCreate(data) | GameMessage::UpdateObject(data) => {
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
            let sticky_target = entity.apply_description(data);

            let guid = entity.guid;
            if state.entities.get(guid).is_some() {
                state.withdraw_replaced_parent_children(guid, data.children.as_deref());
            }
            let create_disposition = state.upsert_entity_from_create(entity, events);
            if create_disposition == EntityCreateDisposition::DeleteRequested {
                return true;
            }
            state.admit_entity_sticky_target(guid, sticky_target);
            state.retain_announced_children(guid, data.children.as_deref());
            state.resolve_announced_attachment(guid, data.animation_frame.unwrap_or(0));
            if state.is_world_container_content(guid) {
                state.mark_container_preview(guid);
            }
            if state
                .entities
                .get(guid)
                .is_some_and(|entity| entity.can_hold_items())
            {
                state.storage.establish_container(guid);
            }
            // Containment accepted before a late description still withdraws its old world pose.
            if matches!(
                state.storage_location(guid),
                Some(crate::state::storage::StorageLocation::Contained { .. })
            ) {
                state.clear_entity_world_presence(guid);
            }
            let _ = state.reconcile_entity_retention(guid);

            true
        }
        GameMessage::ObjectDelete(data) => {
            state.request_entity_instance_delete(data.guid, data.instance_sequence);
            true
        }
        GameMessage::InventoryRemoveObject(data) => {
            state.mark_entity_explicit_delete(data.object_guid);
            true
        }
        GameMessage::ParentEvent(data) => {
            state.receive_placement_message(
                crate::state::attachment_lifecycle::DeferredPlacementMessage::Parent(
                    (**data).clone(),
                ),
                events,
            );
            true
        }
        GameMessage::PickupEvent(data) => {
            state.receive_placement_message(
                crate::state::attachment_lifecycle::DeferredPlacementMessage::Pickup(
                    (**data).clone(),
                ),
                events,
            );
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
            state.storage.place(
                data.item_guid,
                data.container_guid,
                crate::state::storage::StorageSlot::from_entry(data.container_type, data.slot),
            );
            let handled =
                state.move_entity_into_container(data.item_guid, data.container_guid, events);
            state.finish_inventory_transfer(data.item_guid);
            handled
        }
        GameEvent::InventoryServerSaveFailed(data) => {
            state.finish_inventory_transfer(data.item_guid);
            false
        }
        GameEvent::InventoryPutObjectIn3D(data) => {
            state.move_entity_into_world(data.object_guid, events)
        }
        GameEvent::ViewContents(data) => {
            // Replacing a roster can revoke access to an entire formerly nested pack.
            let previous: Vec<_> = state.storage.owned_items(data.container).collect();
            let entries: Vec<_> = data
                .items
                .iter()
                .map(|item| (item.guid, item.container_type))
                .collect();
            state.storage.replace_contents(data.container, &entries);

            for item in &data.items {
                let guid = item.guid;
                state.mark_container_preview(guid);
                if let Some(entity) = state.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    if old_lb != Guid::NULL || entity.container_id() != Some(data.container) {
                        entity.set_iid_prop(PropertyInstanceId::Container, data.container);
                        entity.position.landblock_id = Guid::NULL;

                        if old_lb != Guid::NULL {
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

                    let _ = state.reconcile_entity_retention(guid);
                }
            }
            state.mark_container_preview_entities_for_prune(&previous);
            let announced: Vec<_> = data.items.iter().map(|item| item.guid).collect();
            state.mark_container_preview_entities_for_prune(&announced);

            true
        }
        GameEvent::CloseGroundContainer(data) => {
            if state.world_container().root() == Some(data.container_guid) {
                state.close_world_container();
            }
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
