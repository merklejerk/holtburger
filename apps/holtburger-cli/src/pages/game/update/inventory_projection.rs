use super::super::*;

pub(super) fn update_inventory_and_equipment(state: &mut GameState, entity: &Entity) -> bool {
    let guid = entity.guid;
    let was_owned = state.data.is_owned_by_player(guid);
    let should_be_owned = should_track_entity_as_owned_by_player(state, entity);
    let mut logged_inventory_change = false;

    if Some(guid) == state.data.player_guid {
        state.data.player_pos = Some(entity.position);
    }

    if should_be_owned {
        delay_inventory_notification_arming(state);
    }

    if should_be_owned != was_owned {
        state.data.update_inventory_recursive(guid, should_be_owned);
    } else if should_be_owned {
        state.data.inventory.insert(guid);
    }

    if should_be_owned {
        if state.runtime.inventory_notifications.is_armed() && !was_owned {
            log_inventory_addition(state, entity);
            logged_inventory_change = true;
        }
    } else {
        if state.runtime.inventory_notifications.is_armed() && was_owned {
            log_inventory_removal(state, entity);
            logged_inventory_change = true;
        }
        state.data.inventory.remove(&guid);
    }

    if should_track_entity_as_equipped_by_player(state, entity) {
        let mask = entity.wield_location();
        if mask.is_empty() {
            state.data.equipment.remove(&guid);
        } else {
            state.data.equipment.insert(guid, mask);
        }
    } else {
        state.data.equipment.remove(&guid);
    }

    state.data.entities.insert(entity.guid, entity.clone());
    logged_inventory_change
}

pub(super) fn sync_inventory_notification_arming(state: &mut GameState, now: Instant) {
    state.runtime.inventory_notifications.sync(now);
}

pub(super) fn handle_entity_removed(state: &mut GameState, guid: Guid) -> UpdateResult {
    let mut result = UpdateResult::new();
    let removed_entity = state.data.entities.get(&guid).cloned();
    let was_owned = state.data.is_owned_by_player(guid);
    if state.runtime.inventory_notifications.is_armed()
        && was_owned
        && let Some(entity) = removed_entity.as_ref()
    {
        log_inventory_removal(state, entity);
        result.request_redraw(RedrawPriority::Immediate);
    }
    state.data.update_inventory_recursive(guid, false);
    state.data.entities.remove(&guid);
    state.data.equipment.remove(&guid);
    if matches!(
        state.view.context_view,
        ContextView::Assess(InspectTarget::Entity(target_guid))
            | ContextView::Debug(InspectTarget::Entity(target_guid))
            | ContextView::Book(target_guid)
            if target_guid == guid
    ) {
        state.view.context_view = ContextView::Default;
        state.refresh_context_buffer();
    }
    if matches!(
        state.view.active_interaction,
        Some(Interaction::Targeting { target_guid }) if target_guid == guid
    ) {
        super::interaction_policy::clear_active_interaction(state, &mut result);
    }
    if let Some(session) = state.view.salvaging.as_mut() {
        session.queued_items.retain(|queued_guid| *queued_guid != guid);
        if session.ust_guid == guid {
            state.view.salvaging = None;
            if state.view.active_interaction == Some(Interaction::Salvaging) {
                super::interaction_policy::clear_active_interaction(state, &mut result);
            }
        }
    }

    result
}

pub(super) fn handle_entity_identified(state: &mut GameState, entity: &Entity) {
    let guid = entity.guid;
    state.data.entities.insert(guid, entity.clone());
    state.view.context_view = ContextView::Assess(InspectTarget::Entity(guid));
    state.refresh_context_buffer();
}

pub(super) fn refresh_entity_context_if_visible(
    state: &mut GameState,
    guid: Guid,
    result: &mut UpdateResult,
) {
    if matches!(
        state.view.context_view,
        ContextView::Assess(InspectTarget::Entity(target_guid))
            | ContextView::Book(target_guid)
            if target_guid == guid
    ) {
        state.refresh_context_buffer();
        result.request_redraw(RedrawPriority::Immediate);
    }
}

pub(super) fn refresh_vendor_item_context_if_visible(state: &mut GameState, guid: Guid) {
    if matches!(
        state.view.context_view,
        ContextView::Assess(InspectTarget::VendorItem(target_guid))
            | ContextView::Debug(InspectTarget::VendorItem(target_guid))
            if target_guid == guid
    ) {
        state.refresh_context_buffer();
    }
}

fn should_track_entity_as_owned_by_player(state: &GameState, entity: &Entity) -> bool {
    let Some(player_guid) = state.data.player_guid else {
        return false;
    };

    entity.container_id().is_some_and(|container_guid| {
        container_guid == player_guid || state.data.is_in_player_inventory(container_guid)
    }) || should_track_entity_as_equipped_by_player(state, entity)
}

fn should_track_entity_as_equipped_by_player(state: &GameState, entity: &Entity) -> bool {
    state
        .data
        .player_guid
        .is_some_and(|player_guid| entity.wielder_id() == Some(player_guid))
}

fn log_inventory_addition(state: &mut GameState, entity: &Entity) {
    log_inventory_change(state, entity, "Added to inventory");
}

fn log_inventory_removal(state: &mut GameState, entity: &Entity) {
    log_inventory_change(state, entity, "Removed from inventory");
}

fn log_inventory_change(state: &mut GameState, entity: &Entity, action: &str) {
    let mut label = if entity.name().is_empty() {
        format!("0x{:08X}", entity.guid.0)
    } else {
        entity.name().to_string()
    };
    let stack_size = entity.stack_size();
    if stack_size > 1 {
        label = format!("{} ({}x)", label, stack_size);
    }
    state
        .chat
        .log(ChatMessageTags::system(), format!("{}: {}", action, label));
}

fn delay_inventory_notification_arming(state: &mut GameState) {
    state
        .runtime
        .inventory_notifications
        .extend_quiet_period(Instant::now());
}