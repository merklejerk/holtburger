use super::object_interaction;
use super::*;

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::QueueSalvageItem { guid } => {
            if (state.view.active_interaction != Some(Interaction::Salvaging)
                || state.view.salvaging.is_none())
                && !reset_salvaging_state(state, &mut result)
            {
                return result;
            }

            if state.data.is_salvage_candidate(guid)
                && let Some(session) = state.view.salvaging.as_mut()
                && !session.queued_items.contains(&guid)
            {
                session.queued_items.push(guid);
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        AppAction::UnqueueSalvageItem { guid } => {
            if let Some(session) = state.view.salvaging.as_mut() {
                session
                    .queued_items
                    .retain(|queued_guid| *queued_guid != guid);

                if session.queued_items.is_empty() {
                    result.actions.push(AppAction::Notification {
                        notification: AppNotification::ActiveInteractionChanged {
                            interaction: None,
                        },
                    });
                    state.view.salvaging = None;
                }
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        AppAction::SalvageItems {
            ust_guid,
            item_guids,
        } => {
            if !item_guids.is_empty() {
                result.commands.push(ClientCommand::SalvageItemsWith {
                    tool: ust_guid,
                    items: item_guids,
                });
            }
            result.actions.push(AppAction::Notification {
                notification: AppNotification::ActiveInteractionChanged { interaction: None },
            });
            state.view.salvaging = None;
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::Drop { guid } => {
            result.commands.push(ClientCommand::Drop(guid));
        }
        AppAction::Equip { guid } => {
            if state.runtime.weapon_swap.is_active() {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::warning(),
                    message: "Already waiting on a weapon swap.".to_string(),
                });
            } else {
                handle_equip_request(state, guid, None, &mut result);
            }
        }
        AppAction::EquipInSlot { guid, slot } => {
            if state.runtime.weapon_swap.is_active() {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::warning(),
                    message: "Already waiting on a weapon swap.".to_string(),
                });
            } else {
                handle_equip_request(state, guid, Some(slot), &mut result);
            }
        }
        AppAction::Unequip { guid } => {
            if let Some(container) = state.data.find_non_full_pack(guid, None) {
                result.commands.push(ClientCommand::MoveItem {
                    item: guid,
                    container,
                    placement: 0,
                });
            } else {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::system(),
                    message: "No available inventory space to unequip item.".to_string(),
                });
            }
        }
        AppAction::MoveItem { item, container } => {
            result.commands.push(ClientCommand::MoveItem {
                item,
                container,
                placement: 0,
            });
            result.actions.push(AppAction::Notification {
                notification: AppNotification::ActiveInteractionChanged { interaction: None },
            });
        }
        AppAction::StackItems {
            source,
            destination,
            amount,
        } => {
            result.commands.push(ClientCommand::Stack {
                source,
                destination,
                amount,
            });
        }
        AppAction::SplitItem {
            item,
            container,
            amount,
        } => {
            result.commands.push(ClientCommand::Split {
                item,
                container,
                amount,
            });
        }
        AppAction::PickUp {
            item: guid,
            container: preferred_container_id,
        } => {
            if let Some(container_id) = state.data.find_non_full_pack(guid, preferred_container_id)
            {
                result.commands.push(ClientCommand::MoveItem {
                    item: guid,
                    container: container_id,
                    placement: 0,
                });
            } else {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::system(),
                    message: "No space left.".to_string(),
                });
            }
        }
        AppAction::Give {
            item,
            recipient,
            amount,
        } => {
            result.commands.push(ClientCommand::GiveObjectRequest {
                target: recipient,
                item,
                amount,
            });
        }
        AppAction::UseWith { item, target } => {
            result
                .commands
                .push(ClientCommand::UseWithTarget { item, target });
            if let Some(Interaction::Combining {
                item_guid: interact_guid,
            }) = state.view.active_interaction
                && interact_guid == item
            {
                state.view.active_interaction = None;
            }
        }
        _ => {}
    }

    result
}

pub(super) fn begin_salvaging_interaction(
    state: &mut GameState,
    result: &mut UpdateResult,
) -> bool {
    reset_salvaging_state(state, result)
}

pub(super) fn apply_tick(state: &mut GameState, now: Instant, result: &mut UpdateResult) {
    sync_inventory_notification_arming(state, now);
    sync_weapon_swap_controller(state, now, result);
}

pub(super) fn sync_weapon_swap_controller(
    state: &mut GameState,
    now: Instant,
    result: &mut UpdateResult,
) {
    let Some(item_guid) = state.runtime.weapon_swap.tracked_item_guid() else {
        return;
    };

    let equipped_mask = state
        .data
        .equipment
        .get(&item_guid)
        .copied()
        .unwrap_or(holtburger_protocol::messages::EquipMask::NONE);
    drive_weapon_swap(
        state,
        WeaponSwapInput::Tick {
            now,
            combat_mode: state.data.combat_mode,
            equipped_mask,
            suggested_mode: state.data.get_suggested_combat_mode(),
        },
        result,
    );
}

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
        object_interaction::refresh_context_buffer(state);
    }
    if matches!(
        state.view.active_interaction,
        Some(Interaction::Targeting { target_guid }) if target_guid == guid
    ) {
        result.actions.push(AppAction::Notification {
            notification: AppNotification::ActiveInteractionChanged { interaction: None },
        });
    }
    if let Some(session) = state.view.salvaging.as_mut() {
        session
            .queued_items
            .retain(|queued_guid| *queued_guid != guid);
        if session.ust_guid == guid {
            state.view.salvaging = None;
            if state.view.active_interaction == Some(Interaction::Salvaging) {
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::ActiveInteractionChanged { interaction: None },
                });
            }
        }
    }

    result
}

pub(super) fn handle_entity_identified(state: &mut GameState, entity: &Entity) {
    let guid = entity.guid;
    state.data.entities.insert(guid, entity.clone());
    state.view.context_view = ContextView::Assess(InspectTarget::Entity(guid));
    object_interaction::refresh_context_buffer(state);
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
        object_interaction::refresh_context_buffer(state);
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
        object_interaction::refresh_context_buffer(state);
    }
}

fn reset_salvaging_state(state: &mut GameState, result: &mut UpdateResult) -> bool {
    let Some(ust_guid) = state.data.find_salvage_tool_guid() else {
        push_missing_ust_warning(state, result);
        return false;
    };

    state.view.active_interaction = Some(Interaction::Salvaging);
    state.view.salvaging = Some(SalvagingState {
        ust_guid,
        queued_items: Vec::new(),
    });
    true
}

fn push_missing_ust_warning(_state: &GameState, result: &mut UpdateResult) {
    result.actions.push(AppAction::Log {
        chat_tags: ChatMessageTags::warning(),
        message: "You do not have an Ust in your inventory.".to_string(),
    });
}

fn handle_equip_request(
    state: &mut GameState,
    guid: Guid,
    slot: Option<holtburger_core::client::types::TargetSlot>,
    result: &mut UpdateResult,
) {
    drive_weapon_swap(
        state,
        WeaponSwapInput::Start {
            now: Instant::now(),
            item_guid: guid,
            slot,
            current_mode: state.data.combat_mode,
            item_mask: state
                .data
                .entities
                .get(&guid)
                .map(|entity| entity.valid_locations()),
        },
        result,
    );
}

fn drive_weapon_swap(state: &mut GameState, input: WeaponSwapInput, result: &mut UpdateResult) {
    for command in state.runtime.weapon_swap.advance(input) {
        result.commands.push(command);
    }
}

fn sync_inventory_notification_arming(state: &mut GameState, now: Instant) {
    state.runtime.inventory_notifications.sync(now);
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
