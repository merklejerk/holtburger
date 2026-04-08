use super::*;
use super::super::interaction_policy;

pub(super) fn reduce_inventory_action(
    state: &mut GameState,
    action: AppAction,
) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::QueueSalvageItem { guid } => {
            if (state.view.active_interaction != Some(Interaction::Salvaging)
                || state.view.salvaging.is_none())
                && !state.reset_salvaging_state(&mut result)
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
                session.queued_items.retain(|queued_guid| *queued_guid != guid);

                if session.queued_items.is_empty() {
                    interaction_policy::clear_active_interaction(state, &mut result);
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
            interaction_policy::clear_active_interaction(state, &mut result);
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
                state.handle_equip_request(guid, None, &mut result);
            }
        }
        AppAction::EquipInSlot { guid, slot } => {
            if state.runtime.weapon_swap.is_active() {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::warning(),
                    message: "Already waiting on a weapon swap.".to_string(),
                });
            } else {
                state.handle_equip_request(guid, Some(slot), &mut result);
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
            interaction_policy::clear_active_interaction(state, &mut result);
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
        _ => unreachable!("unsupported inventory action"),
    }

    result
}