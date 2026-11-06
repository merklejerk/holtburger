use super::super::{SalvageAssessment, SalvagingPhase};
use super::object_interaction;
use super::*;
use holtburger_core::client::salvage::{
    SalvagePreviewRequest, SalvageSubmitOutcome, SalvageSubmitRequest, SalvageToolSelection,
};
use holtburger_world::crafting::salvage::SalvageEvaluation;
use holtburger_world::inspection::ObjectInspectionOutcome;
use std::collections::{HashMap, hash_map::Entry};

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::QueueSalvageItem { guid } => {
            if salvage_is_submitting(state) {
                return result;
            }
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
                request_salvage_preview(state, &mut result);
            }
        }
        AppAction::UnqueueSalvageItem { guid } => {
            if salvage_is_submitting(state) {
                return result;
            }
            if let Some(session) = state.view.salvaging.as_mut() {
                session.assessments.remove(&guid);
                session
                    .queued_items
                    .retain(|queued_guid| *queued_guid != guid);

                if session.queued_items.is_empty() {
                    close_salvaging(state, &mut result);
                }
                request_salvage_preview(state, &mut result);
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        AppAction::ConfirmSalvage => {
            if let Some(session) = state.view.salvaging.as_mut()
                && state.view.active_interaction == Some(Interaction::Salvaging)
                && let SalvagingPhase::Reviewed(SalvageEvaluation::Ready { review, .. }) =
                    &session.phase
                && !review.sources.is_empty()
            {
                result
                    .commands
                    .push(ClientCommand::SubmitSalvage(SalvageSubmitRequest {
                        sequence: session.sequence,
                        review: review.clone(),
                    }));
                session.phase = SalvagingPhase::Submitting;
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        AppAction::SalvageItems {
            ust_guid,
            item_guids,
        } if !item_guids.is_empty() => {
            result.commands.push(ClientCommand::SalvageItemsWith {
                tool: ust_guid,
                items: item_guids,
            });
        }
        AppAction::Drop { guid } => {
            result.commands.push(ClientCommand::Drop(guid));
        }
        AppAction::Equip { guid } => {
            result.commands.push(ClientCommand::GetAndWield {
                item: guid,
                slot: None,
            });
        }
        AppAction::EquipInSlot { guid, slot } => {
            result.commands.push(ClientCommand::GetAndWield {
                item: guid,
                slot: Some(slot),
            });
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
        AppAction::PickUp { item, container } => {
            result.commands.push(ClientCommand::SubmitInventory(
                holtburger_core::client::inventory_plan::InventoryIntent {
                    item,
                    target: holtburger_core::client::inventory_plan::InventoryTarget::Pickup {
                        container,
                    },
                },
            ));
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
    if salvage_is_submitting(state) || !reset_salvaging_state(state, result) {
        return false;
    }
    request_salvage_preview(state, result);
    true
}

pub(super) fn apply_tick(state: &mut GameState, now: Instant) {
    sync_inventory_notification_arming(state, now);
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
        state.view.object_inspection = None;
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
        if session.ust_guid == guid {
            close_salvaging(state, &mut result);
        } else if session.queued_items.contains(&guid)
            && !matches!(session.phase, SalvagingPhase::Submitting)
        {
            session
                .queued_items
                .retain(|queued_guid| *queued_guid != guid);
            session.assessments.remove(&guid);
            // Despawn and semantic-delta events are separate publications. Pruning the
            // draft must retire the old review regardless of which event arrives first.
            request_salvage_preview(state, &mut result);
        }
    }

    result
}

pub(super) fn handle_entity_identified(state: &mut GameState, entity: &Entity) {
    state.data.entities.insert(entity.guid, entity.clone());
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

fn close_salvaging(state: &mut GameState, result: &mut UpdateResult) {
    state.view.salvaging = None;
    if state.view.active_interaction == Some(Interaction::Salvaging) {
        result.actions.push(AppAction::Notification {
            notification: AppNotification::ActiveInteractionChanged { interaction: None },
        });
    }
    result.request_redraw(RedrawPriority::Immediate);
}

fn salvage_is_submitting(state: &GameState) -> bool {
    state
        .view
        .salvaging
        .as_ref()
        .is_some_and(|session| matches!(session.phase, SalvagingPhase::Submitting))
}

fn request_salvage_preview(state: &mut GameState, result: &mut UpdateResult) {
    let Some(player) = state.data.player_guid else {
        return;
    };
    let Some(session) = state.view.salvaging.as_mut() else {
        return;
    };
    if state.view.active_interaction != Some(Interaction::Salvaging)
        || matches!(session.phase, SalvagingPhase::Submitting)
    {
        return;
    }
    state.runtime.salvage_sequence = state
        .runtime
        .salvage_sequence
        .checked_add(1)
        .expect("salvage request sequence exhausted");
    session.sequence = state.runtime.salvage_sequence;
    session.phase = SalvagingPhase::Loading;
    result
        .commands
        .push(ClientCommand::PreviewSalvage(SalvagePreviewRequest {
            sequence: session.sequence,
            player,
            tool: SalvageToolSelection::Exact {
                guid: session.ust_guid,
            },
            items: session.queued_items.clone(),
        }));
    result.request_redraw(RedrawPriority::Immediate);
}

fn accept_salvage_evaluation(
    session: &mut SalvagingState,
    evaluation: &SalvageEvaluation,
    result: &mut UpdateResult,
) {
    let mut problem = None;
    if let SalvageEvaluation::PendingDetails { items, .. } = evaluation {
        for guid in items {
            match session.assessments.entry(*guid) {
                Entry::Vacant(entry) => {
                    entry.insert(SalvageAssessment::Waiting);
                    result.commands.push(ClientCommand::Identify(*guid));
                }
                Entry::Occupied(entry) => match entry.get() {
                    SalvageAssessment::Waiting => {}
                    SalvageAssessment::Received => {
                        problem.get_or_insert_with(|| {
                            "Assessment did not provide the details needed for salvage. Assess the item again or remove it from the batch.".into()
                        });
                    }
                    SalvageAssessment::Failed { reason } => {
                        problem.get_or_insert_with(|| reason.clone());
                    }
                },
            }
        }
    }
    session.phase = match problem {
        Some(reason) => SalvagingPhase::AssessmentFailed { reason },
        None => SalvagingPhase::Reviewed(evaluation.clone()),
    };
    result.request_redraw(RedrawPriority::Immediate);
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();
    if state.view.active_interaction != Some(Interaction::Salvaging) {
        return result;
    }
    let Some(session) = state.view.salvaging.as_mut() else {
        return result;
    };
    match event {
        ClientViewEvent::SalvagePreview(reply)
            if reply.sequence == session.sequence
                && matches!(session.phase, SalvagingPhase::Loading) =>
        {
            accept_salvage_evaluation(session, &reply.evaluation, &mut result);
        }
        ClientViewEvent::SalvageSubmitted(reply)
            if reply.sequence == session.sequence
                && matches!(session.phase, SalvagingPhase::Submitting) =>
        {
            match &reply.outcome {
                SalvageSubmitOutcome::Dispatched => close_salvaging(state, &mut result),
                SalvageSubmitOutcome::Changed { evaluation } => {
                    accept_salvage_evaluation(session, evaluation, &mut result);
                    result.actions.push(AppAction::Log {
                        chat_tags: ChatMessageTags::warning(),
                        message: "Salvage details changed. Review the batch and confirm again."
                            .into(),
                    });
                }
                SalvageSubmitOutcome::Rejected { reason } => {
                    session.phase = SalvagingPhase::Loading;
                    request_salvage_preview(state, &mut result);
                    result.actions.push(AppAction::Log {
                        chat_tags: ChatMessageTags::warning(),
                        message: reason.clone(),
                    });
                }
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::ObjectInspectionResult(inspection)
            if session.assessments.contains_key(&inspection.guid)
                && !matches!(session.phase, SalvagingPhase::Submitting) =>
        {
            let progress = match &inspection.outcome {
                ObjectInspectionOutcome::Ready { .. } => SalvageAssessment::Received,
                ObjectInspectionOutcome::Rejected => SalvageAssessment::Failed {
                    reason: "The server refused to assess a queued item. Assess it again or remove it from the batch.".into(),
                },
                ObjectInspectionOutcome::Missing => SalvageAssessment::Failed {
                    reason: "A queued item is no longer available for assessment.".into(),
                },
                ObjectInspectionOutcome::Unavailable { reason } => SalvageAssessment::Failed {
                    reason: reason.clone(),
                },
            };
            session.assessments.insert(inspection.guid, progress);
            request_salvage_preview(state, &mut result);
        }
        ClientViewEvent::StatusUpdate {
            state: client_state,
        } if *client_state != holtburger_core::ClientState::InWorld => {
            close_salvaging(state, &mut result);
        }
        ClientViewEvent::ApplicationSnapshot(_) => {
            request_salvage_preview(state, &mut result);
        }
        ClientViewEvent::EntityFactsChanged(delta)
            if delta.salvage.is_some()
                || delta.upserts.iter().any(|facts| {
                    session.queued_items.contains(&facts.guid) || session.ust_guid == facts.guid
                })
                || delta.removed.iter().any(|guid| {
                    session.queued_items.contains(guid) || session.ust_guid == *guid
                }) =>
        {
            request_salvage_preview(state, &mut result);
        }
        _ => {}
    }
    result
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
        sequence: 0,
        phase: SalvagingPhase::Loading,
        assessments: HashMap::new(),
    });
    true
}

fn push_missing_ust_warning(_state: &GameState, result: &mut UpdateResult) {
    result.actions.push(AppAction::Log {
        chat_tags: ChatMessageTags::warning(),
        message: "You do not have an Ust in your inventory.".to_string(),
    });
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
