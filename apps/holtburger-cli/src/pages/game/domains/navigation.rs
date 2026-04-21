use super::inventory;
use super::object_interaction;
use super::*;
use crate::navigation::NavigationMode;
use crate::pages::game::combat as combat_model;
use holtburger_core::client::movement_types::PlayerDriveIntent;

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();
    let navigation_input = navigation_input_for_action(state, &action);

    match action {
        AppAction::Notification {
            notification: AppNotification::ActiveInteractionChanged { interaction: None },
        } => {
            clear_active_interaction(state, &mut result);
        }
        AppAction::Approach { .. } | AppAction::Follow { .. } | AppAction::Scoot { .. } => {
            apply_navigation_input(
                state,
                navigation_input.expect("navigation actions should project to navigation input"),
                &mut result,
            );
        }
        AppAction::SnapHeading { heading } => {
            result
                .commands
                .push(ClientCommand::DriveSelf(PlayerDriveIntent::SnapFacing {
                    heading,
                }));
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::BeginInteraction { interaction } => {
            if interaction == Interaction::Salvaging {
                if let Some(input) = navigation_input {
                    apply_navigation_input(state, input, &mut result);
                }
                if !inventory::begin_salvaging_interaction(state, &mut result) {
                    return result;
                }
            } else {
                if let Some(input) = navigation_input {
                    apply_navigation_input(state, input, &mut result);
                }
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::ActiveInteractionChanged {
                        interaction: Some(interaction),
                    },
                });
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::CancelInteraction => {
            if let Some(input) = navigation_input {
                apply_navigation_input(state, input, &mut result);
            } else {
                result.actions.push(AppAction::Notification {
                    notification: AppNotification::ActiveInteractionChanged { interaction: None },
                });
            }
            state.view.salvaging = None;
            result.request_redraw(RedrawPriority::Immediate);
        }
        _ => {}
    }

    result
}

fn clear_active_interaction(state: &mut GameState, result: &mut UpdateResult) {
    if matches!(
        state.runtime.navigation.navigation_mode(),
        Some(NavigationMode::Approach { .. }) | Some(NavigationMode::Follow { .. })
    ) {
        cancel_frontend_navigation(state, result);
    }
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();
    let navigation_interrupt = navigation_interrupt_for_view_event(state, event);

    match event {
        ClientViewEvent::PlayerGroundedUpdated { grounded } => {
            state.data.player_grounded = Some(*grounded);
        }
        ClientViewEvent::SelfMovementKinematicsUpdated { kinematics } => {
            state.data.self_movement_kinematics = kinematics.clone();
        }
        ClientViewEvent::RuntimeBodySnapshot { .. } => {
            object_interaction::refresh_context_buffer(state);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::RuntimeBodyUpserted { body } => {
            if let Some(guid) = body.body_id.authoritative_guid() {
                inventory::refresh_entity_context_if_visible(state, guid, &mut result);
            }
            result.request_redraw(RedrawPriority::Motion);
        }
        ClientViewEvent::RuntimeBodyRemoved { body_id } => {
            if let Some(guid) = body_id.authoritative_guid() {
                inventory::refresh_entity_context_if_visible(state, guid, &mut result);
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::RuntimeBodiesReset { .. } => {
            object_interaction::refresh_context_buffer(state);
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::TeleportStarted { .. } => {}
        _ => {}
    }

    if let Some(input) = navigation_interrupt {
        apply_navigation_interrupt(state, input, &mut result);
    }

    result
}

pub(super) fn apply_tick(
    state: &mut GameState,
    now: Instant,
    elapsed: f64,
    result: &mut UpdateResult,
) {
    let update = state
        .runtime
        .navigation
        .tick(navigation_tick(state, now, elapsed));
    apply_navigation_update(update, result);
}

pub(super) fn navigation_interrupt_for_view_event(
    state: &GameState,
    event: &ClientViewEvent,
) -> Option<NavigationInput> {
    match event {
        ClientViewEvent::ForcedReposition { guid, .. } if Some(*guid) == state.data.player_guid => {
            Some(NavigationInput::ForcedReposition)
        }
        ClientViewEvent::TeleportStarted { .. } => Some(NavigationInput::TeleportStarted),
        _ => None,
    }
}

pub(super) fn apply_navigation_interrupt(
    state: &mut GameState,
    input: NavigationInput,
    result: &mut UpdateResult,
) {
    apply_navigation_input(state, input, result);

    if input != NavigationInput::TeleportStarted {
        return;
    }

    if matches!(
        state.view.active_interaction,
        Some(Interaction::Approaching { .. }) | Some(Interaction::Following { .. })
    ) {
        result.actions.push(AppAction::Notification {
            notification: AppNotification::ActiveInteractionChanged { interaction: None },
        });
        result.request_redraw(RedrawPriority::Immediate);
    }

    if matches!(
        state.view.active_interaction,
        Some(Interaction::Targeting { .. })
    ) {
        if matches!(
            state.data.combat_mode,
            CombatMode::Melee | CombatMode::Missile
        ) {
            result.commands.push(ClientCommand::CancelAttack);
            state.data.combat_runtime.cancel_attack();
            state.clear_combat_drive();
        }
        result.actions.push(AppAction::Notification {
            notification: AppNotification::ActiveInteractionChanged { interaction: None },
        });
        result.request_redraw(RedrawPriority::Immediate);
    }
}

pub(super) fn cancel_frontend_navigation(state: &mut GameState, result: &mut UpdateResult) {
    let update = state.runtime.navigation.handle_input(
        NavigationInput::Cancel,
        navigation_snapshot(state, navigation_tick_target_guid(state)),
    );
    apply_navigation_update(update, result);
}

#[cfg(test)]
pub(in super::super) fn navigation_snapshot_for_tests(
    state: &GameState,
    target_guid: Option<Guid>,
) -> NavigationSnapshot {
    navigation_snapshot(state, target_guid)
}

fn apply_navigation_input(
    state: &mut GameState,
    input: NavigationInput,
    result: &mut UpdateResult,
) {
    let target_guid = match input {
        NavigationInput::StartApproach { target } | NavigationInput::StartFollow { target } => {
            Some(target)
        }
        NavigationInput::StartScoot { .. } => None,
        NavigationInput::Cancel
        | NavigationInput::ForcedReposition
        | NavigationInput::TeleportStarted => navigation_tick_target_guid(state),
    };

    let update = state
        .runtime
        .navigation
        .handle_input(input, navigation_snapshot(state, target_guid));
    apply_navigation_update(update, result);
}

fn is_frontend_navigation_interaction(interaction: Option<Interaction>) -> bool {
    matches!(
        interaction,
        Some(Interaction::Approaching { .. }) | Some(Interaction::Following { .. })
    )
}

fn navigation_input_for_action(state: &GameState, action: &AppAction) -> Option<NavigationInput> {
    match action {
        AppAction::Approach { guid } => Some(NavigationInput::StartApproach { target: *guid }),
        AppAction::Follow { guid } => Some(NavigationInput::StartFollow { target: *guid }),
        AppAction::Scoot { distance_m } => Some(NavigationInput::StartScoot {
            distance_m: *distance_m,
        }),
        AppAction::CancelInteraction
            if is_frontend_navigation_interaction(state.view.active_interaction) =>
        {
            Some(NavigationInput::Cancel)
        }
        AppAction::BeginInteraction { interaction }
            if is_frontend_navigation_interaction(state.view.active_interaction)
                && !is_frontend_navigation_interaction(Some(*interaction)) =>
        {
            Some(NavigationInput::Cancel)
        }
        _ => None,
    }
}

fn navigation_snapshot(state: &GameState, target_guid: Option<Guid>) -> NavigationSnapshot {
    let target_entity = target_guid.and_then(|guid| state.data.entities.get(&guid));
    let target_sample = target_guid.and_then(|guid| state.data.runtime_sample_for_guid(guid));
    let target_use_radius = target_entity
        .and_then(|entity| entity.use_radius())
        .map(|radius| radius as f32);
    NavigationSnapshot {
        player_position: state.data.runtime_player_position(),
        self_movement_kinematics: state.data.self_movement_kinematics.clone(),
        run_rate_scalar: state.data.player_run_rate(),
        combat_request: combat_model::navigation_request(state),
        tracked_target: target_guid.zip(target_sample).map(|(guid, sample)| {
            ResolvedNavigationTarget {
                guid,
                sample,
                use_radius: target_use_radius,
            }
        }),
    }
}

fn navigation_tick(state: &GameState, now: Instant, elapsed: f64) -> NavigationTick {
    NavigationTick {
        now,
        dt: Duration::from_secs_f64(elapsed.max(0.0)),
        snapshot: navigation_snapshot(state, navigation_tick_target_guid(state)),
    }
}

fn navigation_tick_target_guid(state: &GameState) -> Option<Guid> {
    state
        .runtime
        .navigation
        .tracked_target_guid()
        .or_else(|| combat_model::navigation_request(state).map(|request| request.target_guid))
}

fn apply_navigation_update(update: NavigationUpdate, result: &mut UpdateResult) {
    if let Some(command) = update.drive_command {
        result.commands.push(ClientCommand::DriveSelf(command));
    }

    match update.interaction_change {
        NavigationInteractionChange::Unchanged => {}
        NavigationInteractionChange::Set(next_interaction) => {
            result.actions.push(AppAction::Notification {
                notification: AppNotification::ActiveInteractionChanged {
                    interaction: next_interaction,
                },
            });
            result.request_redraw(RedrawPriority::Immediate);
        }
    }
}
