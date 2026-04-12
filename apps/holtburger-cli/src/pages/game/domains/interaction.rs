use super::*;

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    if let AppAction::Notification {
        notification: AppNotification::ActiveInteractionChanged { interaction },
    } = action
    {
        set_active_interaction(state, interaction, &mut result);
    }

    result
}

fn set_active_interaction(
    state: &mut GameState,
    next_interaction: Option<Interaction>,
    result: &mut UpdateResult,
) {
    let previous_interaction = state.view.active_interaction;
    state.view.active_interaction = next_interaction;

    sync_combat_navigation_request(previous_interaction, next_interaction, state);
    sync_target_health_query(previous_interaction, next_interaction, result);

    if should_cancel_attack(state, previous_interaction, next_interaction) {
        result.commands.push(ClientCommand::CancelAttack);
        state.data.combat_runtime.cancel_attack();
        state.clear_combat_drive();
    }
}

fn sync_combat_navigation_request(
    previous_interaction: Option<Interaction>,
    next_interaction: Option<Interaction>,
    state: &mut GameState,
) {
    let desired_target = state.data.combat_runtime.desired_engagement_target();
    if desired_target.is_none() {
        return;
    }

    let previous_target = target_guid_for_interaction(previous_interaction);
    let next_target = target_guid_for_interaction(next_interaction);

    if desired_target == previous_target && desired_target != next_target {
        state.data.combat_runtime.clear_engagement();
    }
}

fn target_guid_for_interaction(interaction: Option<Interaction>) -> Option<Guid> {
    match interaction {
        Some(Interaction::Targeting { target_guid }) => Some(target_guid),
        _ => None,
    }
}

fn sync_target_health_query(
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
        Some(target_guid) => result
            .commands
            .push(ClientCommand::QueryHealth(target_guid)),
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
    matches!(
        state.data.combat_mode,
        CombatMode::Melee | CombatMode::Missile
    ) && match (previous_interaction, next_interaction) {
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
