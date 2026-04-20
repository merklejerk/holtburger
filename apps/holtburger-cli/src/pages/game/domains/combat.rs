use super::*;
use crate::pages::game::combat as combat_model;
use holtburger_core::ActionResultReason;
use holtburger_core::client::movement_types::PlayerDriveIntent;

pub(super) enum EnterCombatModeResult {
    Success(UpdateResult),
    Failed(UpdateResult),
}

pub(crate) fn is_in_combat_mode(state: &GameState) -> bool {
    state.data.combat_mode != CombatMode::NonCombat
}

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::Attack { guid } => {
            result.merge(start_explicit_attack(state, guid));
        }
        AppAction::CastSpell { spell_id, target } => {
            match try_enter_combat_mode(state, CombatMode::Magic) {
                EnterCombatModeResult::Failed(res) => {
                    result.merge(res);
                }
                EnterCombatModeResult::Success(res) => {
                    result.merge(res);
                    if let Some(target) = target {
                        if let Some(heading) = targeted_spell_heading(state, target) {
                            result.commands.push(ClientCommand::DriveSelf(
                                PlayerDriveIntent::SnapFacing { heading },
                            ));
                        }
                        result
                            .commands
                            .push(ClientCommand::CastTargetedSpell { spell_id, target });
                    } else {
                        result
                            .commands
                            .push(ClientCommand::CastUntargetedSpell { spell_id });
                    }
                }
            }
        }
        AppAction::CycleCombatProfileLevel => {
            state.data.combat_controls.cycle_profile_level();
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::CycleCombatAttackHeight => {
            state.data.combat_controls.cycle_attack_height();
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::SetCombatMode { on } => {
            let desired_mode = if on {
                if state.data.combat_mode != CombatMode::NonCombat {
                    None
                } else {
                    Some(state.data.get_suggested_combat_mode())
                }
            } else {
                Some(CombatMode::NonCombat)
            };

            if let Some(mode) = desired_mode {
                match try_enter_combat_mode(state, mode) {
                    EnterCombatModeResult::Failed(res) => {
                        result.merge(res);
                    }
                    EnterCombatModeResult::Success(res) => {
                        result.merge(res);
                    }
                }
            }
        }
        _ => {}
    }

    result
}

fn targeted_spell_heading(state: &GameState, target_guid: Guid) -> Option<f32> {
    if Some(target_guid) == state.data.player_guid {
        return None;
    }

    let player_position = state.data.runtime_player_position()?;
    let target_position = state.data.runtime_position_for_guid(target_guid)?;

    Some(player_position.heading_to(&target_position))
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::CombatFeedback(feedback) => {
            result.merge(combat_model::handle_combat_feedback(state, feedback));
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::ActionResult {
            reason: ActionResultReason::Weenie(_, _),
            ..
        } if combat_model::combat_feedback_context_active(state) => {
            if let ClientViewEvent::ActionResult { reason, .. } = event {
                state.data.combat_runtime.note_action_result(reason);
            }
        }
        ClientViewEvent::ServerMessage { message, .. }
            if combat_model::combat_feedback_context_active(state) =>
        {
            state.data.combat_runtime.note_server_message(message);
        }
        ClientViewEvent::SelfServerControlledMotion { data }
            if state.data.combat_mode == CombatMode::Melee
                && combat_model::combat_feedback_context_active(state) =>
        {
            state
                .data
                .combat_runtime
                .note_self_server_controlled_motion(data);
        }
        _ => {}
    }

    result
}

pub(super) fn apply_tick(state: &mut GameState, now: Instant, result: &mut UpdateResult) {
    combat_model::advance_combat_drive(state, now, result);
}

pub(super) fn try_enter_combat_mode(
    state: &mut GameState,
    mode: CombatMode,
) -> EnterCombatModeResult {
    let mut result = UpdateResult::new();
    if state.data.combat_mode == mode {
        return EnterCombatModeResult::Success(result);
    }
    if mode != CombatMode::NonCombat && state.data.get_suggested_combat_mode() != mode {
        result.actions.push(AppAction::Log {
            chat_tags: ChatMessageTags::warning().combat(),
            message: "Wrong weapon equipped!".to_string(),
        });
        return EnterCombatModeResult::Failed(result);
    }
    result.commands.push(ClientCommand::SetCombatMode(mode));
    EnterCombatModeResult::Success(result)
}

fn start_explicit_attack(state: &mut GameState, target_guid: Guid) -> UpdateResult {
    let mut result = UpdateResult::new();

    if let Some(message) = combat_model::explicit_attack_failure_message(state, target_guid) {
        result.actions.push(AppAction::Log {
            chat_tags: ChatMessageTags::warning().combat(),
            message,
        });
        return result;
    }

    if matches!(
        state.view.active_interaction,
        Some(Interaction::Approaching { .. }) | Some(Interaction::Following { .. })
    ) {
        result.actions.push(AppAction::Notification {
            notification: AppNotification::ActiveInteractionChanged { interaction: None },
        });
    }

    result.actions.push(AppAction::Notification {
        notification: AppNotification::ActiveInteractionChanged {
            interaction: Some(Interaction::Targeting { target_guid }),
        },
    });

    let desired_mode = combat_model::explicit_attack_mode(state);
    let Some(desired_mode) = desired_mode else {
        result.actions.push(AppAction::Log {
            chat_tags: ChatMessageTags::warning().combat(),
            message: "Can't attack without a melee or missile weapon equipped!".to_string(),
        });
        result.request_redraw(RedrawPriority::Immediate);
        return result;
    };

    if state.data.combat_mode != desired_mode {
        match try_enter_combat_mode(state, desired_mode) {
            EnterCombatModeResult::Failed(res) => {
                result.merge(res);
                result.request_redraw(RedrawPriority::Immediate);
                return result;
            }
            EnterCombatModeResult::Success(res) => {
                result.merge(res);
            }
        }
    }

    state
        .data
        .combat_runtime
        .begin_explicit_engagement(target_guid, desired_mode);
    state.data.combat_runtime.arm_attack_drive();
    result.request_redraw(RedrawPriority::Immediate);

    if state.data.combat_mode == desired_mode {
        combat_model::run_combat_drive(state, Instant::now(), desired_mode, true, &mut result);
    }

    result
}
