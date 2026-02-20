use crate::ui::model::AppState;
use crate::ui::types::{ActiveInteraction, ContextView, InteractionMode, UIEffect};
use holtburger_core::client::types::ClientCommand;

/// Applies a UI effect to the app state and returns any resulting client commands.
pub fn apply_ui_effect(state: &mut AppState, effect: UIEffect) -> Vec<ClientCommand> {
    match effect {
        UIEffect::Command(cmd) => vec![cmd],
        UIEffect::Commands(cmds) => cmds,
        UIEffect::Assess(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.context_view = ContextView::Assess(guid);
                game.context_scroll_offset = 0;
            }
            vec![ClientCommand::Identify(guid)]
        }
        UIEffect::ActivateDebugSpell(spell_id) => {
            if let Some(game) = state.game_option_mut() {
                game.context_view = ContextView::Spell(spell_id);
                game.context_scroll_offset = 0;
            }
            vec![]
        }
        UIEffect::ActivateDebugEntity(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.current_debug_guid = Some(guid);
                game.context_view = ContextView::Custom;
                game.context_scroll_offset = 0;
            }
            vec![]
        }
        UIEffect::Heal(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.active_interaction = Some(ActiveInteraction {
                    guid,
                    mode: InteractionMode::Healing,
                });
            }
            vec![]
        }
        UIEffect::Move(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.active_interaction = Some(ActiveInteraction {
                    guid,
                    mode: InteractionMode::Moving,
                });
            }
            vec![]
        }
        UIEffect::Target(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.active_interaction = Some(ActiveInteraction {
                    guid,
                    mode: InteractionMode::Target,
                });
            }
            vec![]
        }
        UIEffect::Give(target_guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(ActiveInteraction {
                    guid: item_guid,
                    mode: InteractionMode::Moving,
                }) = game.active_interaction
            {
                let cmd = ClientCommand::GiveObjectRequest {
                    target: target_guid,
                    item: item_guid,
                    amount: 1, // Assume 1 for now.
                };
                game.active_interaction = None;
                return vec![cmd];
            }
            vec![]
        }
        UIEffect::ApplyHealing(guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(interaction) = game.active_interaction
            {
                let cmd = ClientCommand::UseWithTarget {
                    item: interaction.guid,
                    target: guid,
                };
                game.active_interaction = None;
                return vec![cmd];
            }
            vec![]
        }
        UIEffect::ApplyMoving(container_guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(interaction) = game.active_interaction
            {
                let cmd = ClientCommand::MoveItem {
                    item: interaction.guid,
                    container: container_guid,
                    placement: 0,
                };
                game.active_interaction = None;
                return vec![cmd];
            }
            vec![]
        }
        UIEffect::CancelInteraction => {
            if let Some(game) = state.game_option_mut() {
                game.active_interaction = None;
            }
            vec![]
        }
    }
}
