use super::inventory;
use super::*;

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::ApplicationSnapshot(snapshot) => {
            state.data.entity_facts = snapshot
                .entities
                .entities
                .iter()
                .map(|facts| (facts.guid, facts.clone()))
                .collect();
            state.data.world_container = snapshot.entities.world_container;
            if let Some(root) = state.data.world_container.root() {
                state.data.record_container_history(root);
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::EntityFactsChanged(delta) => {
            for guid in &delta.removed {
                state.data.entity_facts.remove(guid);
            }
            for facts in &delta.upserts {
                state.data.entity_facts.insert(facts.guid, facts.clone());
            }
            if let Some(access) = delta.world_container {
                state.data.world_container = access;
                if let Some(root) = access.root() {
                    state.data.record_container_history(root);
                }
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::EntityDebugInfoSnapshot { entity } => {
            let was_ready = state.player_entity_is_ready();
            let entity_ref = entity.as_ref();
            state
                .data
                .entities
                .insert(entity_ref.guid, entity_ref.clone());
            if !was_ready && state.player_entity_is_ready() {
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::PlayerEntityReady {
                        guid: entity_ref.guid,
                    },
                });
            }
        }
        ClientViewEvent::EntitySpawned { entity } | ClientViewEvent::EntityReplaced { entity } => {
            let was_ready = state.player_entity_is_ready();
            let entity_ref = entity.as_ref();
            if inventory::update_inventory_and_equipment(state, entity_ref) {
                result.request_redraw(RedrawPriority::Immediate);
            }
            inventory::refresh_entity_context_if_visible(state, entity_ref.guid, &mut result);
            if matches!(
                state.view.active_interaction,
                Some(Interaction::Targeting { target_guid }) if target_guid == entity_ref.guid
            ) {
                result
                    .commands
                    .push(ClientCommand::QueryHealth(entity_ref.guid));
            }
            if !was_ready && state.player_entity_is_ready() {
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::PlayerEntityReady {
                        guid: entity_ref.guid,
                    },
                });
            }
        }
        ClientViewEvent::EntityHealthUpdated {
            guid,
            health_fraction,
        } => {
            if let Some(entity) = state.data.entities.get_mut(guid) {
                entity.health_fraction = Some(*health_fraction);
            }
            inventory::refresh_entity_context_if_visible(state, *guid, &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::EntityBookUpdated { guid, book } => {
            if let Some(entity) = state.data.entities.get_mut(guid) {
                entity.book = Some(book.as_ref().clone());
            }
            inventory::refresh_entity_context_if_visible(state, *guid, &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::EntityPropertiesUpdated { guid, updates } => {
            let mut needs_update = false;
            if let Some(entity) = state.data.entities.get_mut(guid) {
                for update in updates.iter().cloned() {
                    entity.properties.apply(update);
                }
                needs_update = true;
            }
            if needs_update && let Some(entity) = state.data.entities.get(guid).cloned() {
                inventory::refresh_entity_context_if_visible(state, *guid, &mut result);
                if inventory::update_inventory_and_equipment(state, &entity) {
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
        }
        ClientViewEvent::EntityMoved { guid, pos } => {
            let is_player_move = Some(*guid) == state.data.player_guid;
            if let Some(entity) = state.data.entities.get_mut(guid) {
                entity.position = *pos;
                if is_player_move {
                    state.data.player_pos = Some(*pos);
                }
            }
            inventory::refresh_entity_context_if_visible(state, *guid, &mut result);
            result.request_redraw(RedrawPriority::Motion);
        }
        ClientViewEvent::EntityKinematicsUpdated {
            guid,
            velocity,
            omega,
        } => {
            if let Some(entity) = state.data.entities.get_mut(guid) {
                entity.velocity = *velocity;
                entity.omega = *omega;
                inventory::refresh_entity_context_if_visible(state, *guid, &mut result);
                result.request_redraw(RedrawPriority::Motion);
            }
        }
        ClientViewEvent::EntityMotionUpdated { guid, motion } => {
            if let Some(entity) = state.data.entities.get_mut(guid) {
                entity.network_motion = *motion;
                inventory::refresh_entity_context_if_visible(state, *guid, &mut result);
                result.request_redraw(RedrawPriority::Motion);
            }
        }
        ClientViewEvent::ForcedReposition { guid, pos, .. } => {
            let is_player_move = Some(*guid) == state.data.player_guid;
            if let Some(entity) = state.data.entities.get_mut(guid) {
                entity.position = *pos;
                if is_player_move {
                    state.data.player_pos = Some(*pos);
                }
            }
            inventory::refresh_entity_context_if_visible(state, *guid, &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::EntityDespawned { guid } => {
            result.merge(inventory::handle_entity_removed(state, *guid));
        }
        ClientViewEvent::EntityIdentified { entity } => {
            let was_ready = state.player_entity_is_ready();
            let entity_ref = entity.as_ref();
            if inventory::update_inventory_and_equipment(state, entity_ref) {
                result.request_redraw(RedrawPriority::Immediate);
            }
            inventory::handle_entity_identified(state, entity_ref);
            if !was_ready && state.player_entity_is_ready() {
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::PlayerEntityReady {
                        guid: entity_ref.guid,
                    },
                });
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        _ => {}
    }

    result
}

#[cfg(test)]
mod tests {
    use super::GameState;
    use super::reduce_view_event;
    use crate::types::{AppAction, AppNotification, Interaction};
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
    use holtburger_core::ClientCommand;
    use holtburger_core::ClientViewEvent;
    use holtburger_world::entity::Entity;

    #[test]
    fn nearby_projects_nested_contents_with_shared_pickup_and_root_owned_close() {
        use crate::pages::game::panels::dashboard::tabs::nearby::{NearbyTab, tab::get_entities};
        use crate::types::TabController;
        use holtburger_common::properties::InventoryEntryKind;
        use holtburger_common::properties::{
            ItemType, ObjectDescriptionFlag, PropertyInstanceId, PropertyInt,
        };
        use holtburger_core::{ClientEntityDelta, ClientEntitySnapshot};
        use holtburger_protocol::messages::{
            GameEvent, GameEventMessage, GameMessage, ViewContentsEventData, ViewContentsEventItem,
        };
        let player = Guid(0x50000001);
        let root = Guid(0x80000001);
        let pack = Guid(0x80000002);
        let item = Guid(0x80000003);
        let mut world = holtburger_world::WorldState::synthetic();
        world.player.guid = player;
        let mut state = GameState::new(player, "Player".into(), "World".into());
        for (guid, parent, item_type) in [
            (root, None, ItemType::CONTAINER),
            (pack, Some(root), ItemType::CONTAINER),
            (item, Some(pack), ItemType::MISC),
        ] {
            let mut entity = Entity::new(guid, format!("Item {guid}"), WorldPosition::default());
            entity
                .properties
                .ints
                .insert(PropertyInt::ItemType, item_type.bits() as i32);
            if let Some(parent) = parent {
                entity
                    .properties
                    .iids
                    .insert(PropertyInstanceId::Container, parent);
            } else {
                entity.position.landblock_id = Guid(0x01010001);
            }
            if item_type == ItemType::CONTAINER {
                entity.flags.insert(ObjectDescriptionFlag::OPENABLE);
            }
            world.add_entity(entity.clone());
            reduce_view_event(
                &mut state,
                &ClientViewEvent::EntitySpawned {
                    entity: Box::new(entity),
                },
            );
        }
        for (parent, child, kind) in [
            (root, pack, InventoryEntryKind::Container),
            (pack, item, InventoryEntryKind::Item),
        ] {
            world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
                target: player,
                sequence: 0,
                event: GameEvent::ViewContents(Box::new(ViewContentsEventData {
                    container: parent,
                    items: vec![ViewContentsEventItem {
                        guid: child,
                        container_type: kind,
                    }],
                })),
            })));
        }
        world.confirm_world_container(root);
        let snapshot = ClientEntitySnapshot::from_world(&world).unwrap();
        reduce_view_event(
            &mut state,
            &ClientViewEvent::EntityFactsChanged(ClientEntityDelta {
                world_container: Some(snapshot.world_container),
                upserts: snapshot.entities,
                removed: vec![],
            }),
        );
        assert_eq!(
            get_entities(&state.data)
                .iter()
                .map(|(e, _, depth)| (e.guid, *depth))
                .collect::<Vec<_>>(),
            vec![(root, 0), (pack, 1), (item, 2)]
        );
        assert_eq!(state.data.current_open_container(), Some(root));
        for (selected_index, guid) in [(1, pack), (2, item)] {
            let mut tab = NearbyTab::default();
            tab.selected_index = selected_index;
            let verbs = tab.get_verbs(&state.data, &state.view, &None);
            let pickup = verbs
                .iter()
                .find(|verb| verb.label == "Pick Up")
                .expect("shared pickup verb");
            let result =
                super::super::reduce::reduce_action(&mut state, pickup.action.clone()).unwrap();
            assert!(
                matches!(result.commands.as_slice(), [ClientCommand::SubmitInventory(intent)] if intent.item == guid && intent.target == holtburger_core::client::inventory_plan::InventoryTarget::Pickup { container: None })
            );
            assert!(
                !verbs
                    .iter()
                    .any(|verb| verb.label == "Open" || verb.label == "Close")
            );
        }
        let verbs = NearbyTab::default().get_verbs(&state.data, &state.view, &None);
        let close = verbs
            .iter()
            .find(|verb| verb.label == "Close")
            .expect("root close verb");
        let result = super::super::reduce::reduce_action(&mut state, close.action.clone()).unwrap();
        assert!(
            matches!(result.commands.as_slice(), [ClientCommand::CloseContainer(guid)] if *guid == root)
        );
        world.close_world_container();
        reduce_view_event(
            &mut state,
            &ClientViewEvent::EntityFactsChanged(ClientEntityDelta {
                world_container: Some(world.world_container()),
                upserts: vec![],
                removed: vec![pack, item],
            }),
        );
        assert_eq!(state.data.current_open_container(), None);
        assert_eq!(
            get_entities(&state.data)
                .iter()
                .map(|(e, _, _)| e.guid)
                .collect::<Vec<_>>(),
            vec![root]
        );
        assert!(state.data.has_opened_container_before(root));
    }

    #[test]
    fn entity_spawn_emits_player_ready_notification_when_player_appears() {
        let player_guid = Guid(0x5000_0004);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        let result = reduce_view_event(
            &mut state,
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(Entity::new(
                    player_guid,
                    "Player".to_string(),
                    WorldPosition::default(),
                )),
            },
        );

        assert!(matches!(
            result.actions.as_slice(),
            [AppAction::Notification {
                notification: AppNotification::PlayerEntityReady { guid }
            }] if *guid == player_guid
        ));
        assert!(state.data.entities.contains_key(&player_guid));
    }

    #[test]
    fn entity_spawn_requeries_target_health_when_target_is_active() {
        let player_guid = Guid(0x5000_0004);
        let target_guid = Guid(0x6000_0001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let result = reduce_view_event(
            &mut state,
            &ClientViewEvent::EntitySpawned {
                entity: Box::new(Entity::new(
                    target_guid,
                    "Drudge".to_string(),
                    WorldPosition::default(),
                )),
            },
        );

        assert!(result.commands.iter().any(|command| {
            matches!(command, ClientCommand::QueryHealth(guid) if *guid == target_guid)
        }));
    }

    #[test]
    fn entity_replaced_requeries_target_health_when_target_is_active() {
        let player_guid = Guid(0x5000_0004);
        let target_guid = Guid(0x6000_0001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.active_interaction = Some(Interaction::Targeting { target_guid });

        let result = reduce_view_event(
            &mut state,
            &ClientViewEvent::EntityReplaced {
                entity: Box::new(Entity::new(
                    target_guid,
                    "Drudge".to_string(),
                    WorldPosition::default(),
                )),
            },
        );

        assert!(result.commands.iter().any(|command| {
            matches!(command, ClientCommand::QueryHealth(guid) if *guid == target_guid)
        }));
    }
}
