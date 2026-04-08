use super::super::*;

pub(super) fn apply_navigation_input(
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
    apply_navigation_update(state, update, result);
}

pub(super) fn navigation_input_for_app_action(
    state: &GameState,
    action: &AppAction,
) -> Option<NavigationInput> {
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

pub(super) fn handle_navigation_interrupt(
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
        state.view.active_interaction = None;
        result.request_redraw(RedrawPriority::Immediate);
    }

    if matches!(
        state.view.active_interaction,
        Some(Interaction::Targeting { .. })
    ) {
        if matches!(state.data.combat_mode, CombatMode::Melee | CombatMode::Missile) {
            result.commands.push(ClientCommand::CancelAttack);
            state.data.combat_runtime.cancel_attack();
            state.runtime.combat_automation = None;
        }
        state.view.active_interaction = None;
        result.request_redraw(RedrawPriority::Immediate);
    }
}

pub(super) fn clear_active_interaction(state: &mut GameState, result: &mut UpdateResult) {
    if is_frontend_navigation_interaction(state.view.active_interaction) {
        let update = state.runtime.navigation.handle_input(
            NavigationInput::Cancel,
            navigation_snapshot(state, navigation_tick_target_guid(state)),
        );
        apply_navigation_update(state, update, result);
        return;
    }

    set_active_interaction(state, None, result);
}

pub(super) fn set_active_interaction(
    state: &mut GameState,
    next_interaction: Option<Interaction>,
    result: &mut UpdateResult,
) {
    let previous_interaction = state.view.active_interaction;
    state.view.active_interaction = next_interaction;

    sync_target_health_query(state, previous_interaction, next_interaction, result);

    if should_cancel_attack(state, previous_interaction, next_interaction) {
        result.commands.push(ClientCommand::CancelAttack);
        state.data.combat_runtime.cancel_attack();
        state.runtime.combat_automation = None;
    }

    if should_resume_attack(state, previous_interaction, next_interaction) {
        state.queue_auto_attack_for_mode(state.data.combat_mode, result);
    }
}

pub(super) fn apply_navigation_tick(
    state: &mut GameState,
    now: Instant,
    elapsed: f64,
    result: &mut UpdateResult,
) {
    let update = state.runtime.navigation.tick(navigation_tick(state, now, elapsed));
    apply_navigation_update(state, update, result);
}

#[cfg(test)]
pub(in super::super) fn navigation_snapshot_for_tests(
    state: &GameState,
    target_guid: Option<Guid>,
) -> NavigationSnapshot {
    navigation_snapshot(state, target_guid)
}

fn is_frontend_navigation_interaction(interaction: Option<Interaction>) -> bool {
    matches!(
        interaction,
        Some(Interaction::Approaching { .. }) | Some(Interaction::Following { .. })
    )
}

fn sync_target_health_query(
    _state: &GameState,
    previous_interaction: Option<Interaction>,
    next_interaction: Option<Interaction>,
    result: &mut UpdateResult,
) {
    let previous_target = match previous_interaction {
        Some(Interaction::Targeting { target_guid }) => Some(target_guid),
        _ => None,
    };
    let next_target = match next_interaction {
        Some(Interaction::Targeting { target_guid }) => Some(target_guid),
        _ => None,
    };

    if previous_target == next_target {
        return;
    }

    match next_target {
        Some(target_guid) => result.commands.push(ClientCommand::QueryHealth(target_guid)),
        None if previous_target.is_some() => {
            result.commands.push(ClientCommand::QueryHealth(Guid::NULL))
        }
        None => {}
    }
}

fn should_cancel_attack(
    state: &GameState,
    previous_interaction: Option<Interaction>,
    next_interaction: Option<Interaction>,
) -> bool {
    matches!(state.data.combat_mode, CombatMode::Melee | CombatMode::Missile)
        && match (previous_interaction, next_interaction) {
            (
                Some(Interaction::Targeting {
                    target_guid: previous_target,
                }),
                Some(Interaction::Targeting {
                    target_guid: next_target,
                }),
            ) => previous_target != next_target,
            (
                Some(Interaction::Targeting { .. }),
                None
                | Some(Interaction::Moving { .. })
                | Some(Interaction::Approaching { .. })
                | Some(Interaction::Following { .. })
                | Some(Interaction::Combining { .. })
                | Some(Interaction::Salvaging),
            ) => true,
            _ => false,
        }
}

fn should_resume_attack(
    state: &GameState,
    previous_interaction: Option<Interaction>,
    next_interaction: Option<Interaction>,
) -> bool {
    matches!(
        (previous_interaction, next_interaction, state.data.combat_mode),
        (
            None | Some(Interaction::Moving { .. })
                | Some(Interaction::Approaching { .. })
                | Some(Interaction::Following { .. })
                | Some(Interaction::Combining { .. })
                | Some(Interaction::Salvaging)
                | Some(Interaction::Targeting { .. }),
            Some(Interaction::Targeting { .. }),
            CombatMode::Melee | CombatMode::Missile
        )
    )
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
        combat_target_guid: state.current_target_guid(),
        combat_mode: state.data.combat_mode,
        attack_sequence_active: state
            .data
            .combat_runtime
            .attack_activity(state.data.combat_mode)
            .is_some(),
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
    state.runtime.navigation.tracked_target_guid().or_else(|| {
        state
            .current_target_guid()
            .filter(|guid| state.is_valid_combat_target(*guid))
    })
}

fn apply_navigation_update(
    state: &mut GameState,
    update: NavigationUpdate,
    result: &mut UpdateResult,
) {
    if let Some(command) = update.drive_command {
        result.commands.push(ClientCommand::DriveSelf(command));
    }

    match update.interaction_change {
        NavigationInteractionChange::Unchanged => {}
        NavigationInteractionChange::Set(next_interaction) => {
            set_active_interaction(state, next_interaction, result);
            result.request_redraw(RedrawPriority::Immediate);
        }
    }
}