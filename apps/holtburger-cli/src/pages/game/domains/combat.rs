use super::*;

pub(super) enum EnterCombatModeResult {
    Success(UpdateResult),
    Failed(UpdateResult),
}

pub(crate) fn toggled_combat_mode(state: &GameState) -> CombatMode {
    if state.data.combat_mode != CombatMode::NonCombat {
        CombatMode::NonCombat
    } else {
        state.data.get_suggested_combat_mode()
    }
}

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::CastSpell { spell_id, target } => {
            match try_enter_combat_mode(state, CombatMode::Magic) {
                EnterCombatModeResult::Failed(res) => {
                    result.merge(res);
                }
                EnterCombatModeResult::Success(res) => {
                    result.merge(res);
                    if let Some(target) = target {
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
            queue_auto_attack_for_mode(state, state.data.combat_mode, &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::CycleCombatAttackHeight => {
            state.data.combat_controls.cycle_attack_height();
            queue_auto_attack_for_mode(state, state.data.combat_mode, &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::SetCombatMode { mode } => match try_enter_combat_mode(state, mode) {
            EnterCombatModeResult::Failed(res) => {
                result.merge(res);
            }
            EnterCombatModeResult::Success(res) => {
                result.merge(res);
                queue_auto_attack_for_mode(state, mode, &mut result);
            }
        },
        _ => unreachable!("unsupported combat action"),
    }

    result
}

pub(super) fn reduce_view_event(state: &mut GameState, event: ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    if let ClientViewEvent::CombatFeedback(feedback) = event {
        result.merge(handle_combat_feedback(state, &feedback));
        state.chat.handle_event(
            ClientViewEvent::CombatFeedback(feedback),
            state.data.character_name.as_deref(),
        );
        result.request_redraw(RedrawPriority::Immediate);
    }

    result
}

pub(super) fn apply_tick(state: &mut GameState, now: Instant, result: &mut UpdateResult) {
    refresh_stale_attack_sequence(state, now, result);
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
            chat_tags: ChatMessageTags::warning(),
            message: "Wrong weapon equipped!".to_string(),
        });
        return EnterCombatModeResult::Failed(result);
    }
    result.commands.push(ClientCommand::SetCombatMode(mode));
    EnterCombatModeResult::Success(result)
}

pub(super) fn queue_auto_attack_for_mode(
    state: &mut GameState,
    mode: CombatMode,
    result: &mut UpdateResult,
) {
    sync_combat_automation(state, Instant::now(), mode, true, result);
}

pub(super) fn current_target_guid(state: &GameState) -> Option<Guid> {
    match state.view.active_interaction {
        Some(Interaction::Targeting { target_guid }) => Some(target_guid),
        _ => None,
    }
}

pub(super) fn is_valid_combat_target(state: &GameState, target_guid: Guid) -> bool {
    if !state.data.entities.contains_key(&target_guid) {
        return false;
    }

    if state
        .runtime
        .navigation
        .automation_target_position(
            state.data.runtime_player_position(),
            state.data.runtime_position_for_guid(target_guid),
        )
        .is_none()
    {
        return false;
    }

    state.data.combat_target_status(target_guid).is_available()
}

fn handle_combat_feedback(state: &mut GameState, feedback: &CombatFeedback) -> UpdateResult {
    let mut result = UpdateResult::new();
    let had_attack_activity = state
        .data
        .combat_runtime
        .attack_activity(state.data.combat_mode)
        .is_some();

    state.data.combat_runtime.handle_feedback(feedback);

    if should_rearm_auto_attack_after_cancel(state, feedback, had_attack_activity) {
        if let Some(target_guid) = current_target_guid(state) {
            log::info!(
                "sticky melee: re-arming auto attack after cancellation for target 0x{:08X}",
                target_guid.0
            );
        }
        queue_auto_attack_for_mode(state, state.data.combat_mode, &mut result);
    }

    result
}

fn should_rearm_auto_attack_after_cancel(
    state: &GameState,
    feedback: &CombatFeedback,
    had_attack_activity: bool,
) -> bool {
    had_attack_activity
        && matches!(
            feedback,
            CombatFeedback::AttackDone {
                error: WeenieError::ActionCancelled
            }
        )
        && should_rearm_sticky_auto_attack(state)
}

fn should_rearm_sticky_auto_attack(state: &GameState) -> bool {
    let Some(target_guid) = current_target_guid(state) else {
        return false;
    };

    state.data.combat_target_status(target_guid).is_available() && !player_is_dead(state)
}

fn player_is_dead(state: &GameState) -> bool {
    let Some(player_guid) = state.data.player_guid else {
        return false;
    };

    state
        .data
        .entities
        .get(&player_guid)
        .and_then(|entity| entity.motion_snapshot)
        .is_some_and(|snapshot| snapshot.indicates_death_motion())
}

pub(in super::super) fn refresh_stale_attack_sequence(
    state: &mut GameState,
    now: Instant,
    result: &mut UpdateResult,
) {
    sync_combat_automation(state, now, state.data.combat_mode, false, result);
}

pub(in super::super) fn sync_combat_automation(
    state: &mut GameState,
    now: Instant,
    mode: CombatMode,
    force_attack: bool,
    result: &mut UpdateResult,
) {
    let Some(input) = combat_automation_input(state, now, mode, force_attack) else {
        state.runtime.combat_automation = None;
        return;
    };

    let update = state
        .runtime
        .combat_automation
        .get_or_insert_with(CombatAutomationController::default)
        .handle(&input);

    for effect in update.effects {
        apply_combat_automation_effect(state, effect, result);
    }
}

fn combat_automation_input(
    state: &GameState,
    now: Instant,
    mode: CombatMode,
    force_attack: bool,
) -> Option<CombatAutomationInput> {
    if player_is_dead(state) {
        return None;
    }

    let target_guid = current_target_guid(state)?;
    let attack_profile = desired_attack_profile(state, mode)?;
    let target_position = state.runtime.navigation.automation_target_position(
        state.data.runtime_player_position(),
        state.data.runtime_position_for_guid(target_guid),
    );

    Some(CombatAutomationInput::Tick {
        now,
        target_guid,
        target_available: is_valid_combat_target(state, target_guid),
        player_position: state.data.runtime_player_position(),
        target_position,
        attack_profile,
        attack_sequence_active: state.data.combat_runtime.attack_sequence_active,
        force_attack,
    })
}

fn desired_attack_profile(state: &GameState, mode: CombatMode) -> Option<DesiredAttackProfile> {
    match mode {
        CombatMode::Melee | CombatMode::Missile => Some(DesiredAttackProfile {
            mode,
            attack_height: state.data.combat_controls.attack_height,
            charge_level: state.data.combat_controls.profile_level.wire_value(),
        }),
        CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
    }
}

fn apply_combat_automation_effect(
    state: &mut GameState,
    effect: CombatAutomationEffect,
    result: &mut UpdateResult,
) {
    match effect {
        CombatAutomationEffect::TurnTo { heading } => {
            state.data.combat_runtime.queue_attack();
            result.request_redraw(RedrawPriority::Immediate);
            result
                .commands
                .push(ClientCommand::DriveSelf(PlayerDriveIntent::SnapFacing {
                    heading,
                }));
        }
        CombatAutomationEffect::Attack(request) => {
            state.data.combat_runtime.queue_attack();
            result.request_redraw(RedrawPriority::Immediate);
            match request {
                TargetedAttackRequest::Melee {
                    target,
                    attack_height,
                    power_level,
                } => result.commands.push(ClientCommand::TargetedMeleeAttack {
                    target,
                    attack_height,
                    power_level,
                }),
                TargetedAttackRequest::Missile {
                    target,
                    attack_height,
                    accuracy_level,
                } => result.commands.push(ClientCommand::TargetedMissileAttack {
                    target,
                    attack_height,
                    accuracy_level,
                }),
            }
        }
    }
}
