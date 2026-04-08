use super::*;
use super::inventory;

pub(super) fn reduce_view_event(
    state: &mut GameState,
    event: ClientViewEvent,
    now: Instant,
) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::EntityDebugInfoSnapshot { entity } => {
            let entity_ref = entity.as_ref();
            state
                .data
                .entities
                .insert(entity_ref.guid, entity_ref.clone());
        }
        ClientViewEvent::EntitySpawned { entity } | ClientViewEvent::EntityReplaced { entity } => {
            let entity_ref = entity.as_ref();
            if inventory::update_inventory_and_equipment(state, entity_ref) {
                result.request_redraw(RedrawPriority::Immediate);
            }
            inventory::refresh_entity_context_if_visible(state, entity_ref.guid, &mut result);
            inventory::sync_weapon_swap_controller(state, now, &mut result);
        }
        ClientViewEvent::EntityPropertiesUpdated { guid, mut updates } => {
            let mut needs_update = false;
            if let Some(entity) = state.data.entities.get_mut(&guid) {
                for update in updates.drain(..) {
                    entity.properties.apply(update);
                }
                needs_update = true;
            }
            if needs_update && let Some(entity) = state.data.entities.get(&guid).cloned() {
                inventory::refresh_entity_context_if_visible(state, guid, &mut result);
                if inventory::update_inventory_and_equipment(state, &entity) {
                    result.request_redraw(RedrawPriority::Immediate);
                }
                inventory::sync_weapon_swap_controller(state, now, &mut result);
            }
        }
        ClientViewEvent::EntityMoved { guid, pos } => {
            let is_player_move = Some(guid) == state.data.player_guid;
            if let Some(entity) = state.data.entities.get_mut(&guid) {
                entity.position = pos;
                if is_player_move {
                    state.data.player_pos = Some(pos);
                }
            }
            inventory::refresh_entity_context_if_visible(state, guid, &mut result);
            result.request_redraw(RedrawPriority::Motion);
        }
        ClientViewEvent::EntityKinematicsUpdated {
            guid,
            velocity,
            omega,
        } => {
            if let Some(entity) = state.data.entities.get_mut(&guid) {
                entity.velocity = velocity;
                entity.omega = omega;
                inventory::refresh_entity_context_if_visible(state, guid, &mut result);
                result.request_redraw(RedrawPriority::Motion);
            }
        }
        ClientViewEvent::EntityMotionUpdated { guid, snapshot } => {
            if let Some(entity) = state.data.entities.get_mut(&guid) {
                entity.motion_snapshot = snapshot;
                inventory::refresh_entity_context_if_visible(state, guid, &mut result);
                result.request_redraw(RedrawPriority::Motion);
            }
        }
        ClientViewEvent::ForcedReposition { guid, pos, .. } => {
            let is_player_move = Some(guid) == state.data.player_guid;
            if let Some(entity) = state.data.entities.get_mut(&guid) {
                entity.position = pos;
                if is_player_move {
                    state.data.player_pos = Some(pos);
                }
            }
            inventory::refresh_entity_context_if_visible(state, guid, &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::EntityDespawned { guid } => {
            result.merge(inventory::handle_entity_removed(state, guid));
        }
        ClientViewEvent::EntityIdentified { entity } => {
            let entity_ref = entity.as_ref();
            if inventory::update_inventory_and_equipment(state, entity_ref) {
                result.request_redraw(RedrawPriority::Immediate);
            }
            inventory::handle_entity_identified(state, entity_ref);
            inventory::sync_weapon_swap_controller(state, now, &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::ContainerOpened { guid } => {
            state.data.track_container_opened(guid);
        }
        ClientViewEvent::ContainerClosed { guid } => {
            state.data.track_container_closed(guid);
        }
        _ => {}
    }

    result
}