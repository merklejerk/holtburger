use super::*;

pub(super) fn reduce_combat_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::CastSpell { spell_id, target } => match state.try_enter_combat_mode(CombatMode::Magic) {
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
        },
        AppAction::CycleCombatProfileLevel => {
            state.data.combat_controls.cycle_profile_level();
            state.queue_auto_attack_for_mode(state.data.combat_mode, &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::CycleCombatAttackHeight => {
            state.data.combat_controls.cycle_attack_height();
            state.queue_auto_attack_for_mode(state.data.combat_mode, &mut result);
            result.request_redraw(RedrawPriority::Immediate);
        }
        AppAction::SetCombatMode { mode } => match state.try_enter_combat_mode(mode) {
            EnterCombatModeResult::Failed(res) => {
                result.merge(res);
            }
            EnterCombatModeResult::Success(res) => {
                result.merge(res);
                state.queue_auto_attack_for_mode(mode, &mut result);
            }
        },
        _ => unreachable!("unsupported combat action"),
    }

    result
}