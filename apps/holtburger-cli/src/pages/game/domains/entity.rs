use super::inventory;
use super::*;

pub(super) fn reduce_view_event(
    state: &mut GameState,
    event: &ClientViewEvent,
    now: Instant,
) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
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
            inventory::sync_weapon_swap_controller(state, now, &mut result);
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
                inventory::sync_weapon_swap_controller(state, now, &mut result);
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
        ClientViewEvent::EntityMotionUpdated { guid, snapshot } => {
            if let Some(entity) = state.data.entities.get_mut(guid) {
                entity.motion_snapshot = *snapshot;
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
            inventory::sync_weapon_swap_controller(state, now, &mut result);
            if !was_ready && state.player_entity_is_ready() {
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::PlayerEntityReady {
                        guid: entity_ref.guid,
                    },
                });
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::ContainerOpened { guid } => {
            state.data.track_container_opened(*guid);
        }
        ClientViewEvent::ContainerClosed { guid } => {
            state.data.track_container_closed(*guid);
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
    use std::time::Instant;

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
            Instant::now(),
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
            Instant::now(),
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
            Instant::now(),
        );

        assert!(result.commands.iter().any(|command| {
            matches!(command, ClientCommand::QueryHealth(guid) if *guid == target_guid)
        }));
    }
}
