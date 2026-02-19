use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::common::{Action, VerbSet};
use super::render::render_spells_tab;
use super::verbs;
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::{CommandTarget, UIEffect};
use holtburger_core::client::types::ClientCommand;

pub struct SpellsTab;

impl TabController for SpellsTab {
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect) {
        render_spells_tab(f, state, area);
    }

    fn get_verbs(&self, state: &AppState, index: usize) -> VerbSet {
        let target = self.get_target_at_index(state, index);
        if let Some(interaction_verbs) = super::super::common::get_interaction_verbs(
            &target,
            state.player_guid,
            state.active_interaction,
        ) {
            return interaction_verbs;
        }

        verbs::get_verbs(false)
    }

    fn handle_action(
        &self,
        action: &Action,
        index: usize,
        state: &mut AppState,
    ) -> Option<UIEffect> {
        let target = self.get_target_at_index(state, index);
        match (action, &target) {
            (Action::Cast(_), CommandTarget::Spell(spell_id)) => {
                use crate::ui::types::{ChatMessageKind, InteractionMode};
                use holtburger_protocol::messages::combat::CombatMode;

                if !state.is_wielding_caster() {
                    state.log_chat(
                        ChatMessageKind::Error,
                        "You must be wielding a caster to cast spells!".to_string(),
                    );
                    return Some(UIEffect::Commands(vec![]));
                }

                let mut cmds = Vec::new();
                if state.combat_mode != CombatMode::Magic {
                    cmds.push(ClientCommand::SetCombatMode(CombatMode::Magic));
                }

                if let Some(interaction) = state.active_interaction
                    && (interaction.mode == InteractionMode::Target
                        || interaction.mode == InteractionMode::Healing)
                {
                    cmds.push(ClientCommand::CastTargetedSpell {
                        target: interaction.guid,
                        spell_id: *spell_id,
                    });
                } else if let Some(player_guid) = state.player_guid {
                    cmds.push(ClientCommand::CastTargetedSpell {
                        target: player_guid,
                        spell_id: *spell_id,
                    });
                } else {
                    cmds.push(ClientCommand::CastUntargetedSpell {
                        spell_id: *spell_id,
                    });
                }

                Some(UIEffect::Commands(cmds))
            }
            _ => super::super::common::handle_base_action(
                action,
                &target,
                state.player_guid,
                state.active_interaction,
            ),
        }
    }

    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a> {
        let mut spells = state.player_spells.clone();
        spells.sort_by_key(|&sid| {
            state
                .spell_names
                .get(&sid)
                .cloned()
                .unwrap_or_else(|| "".to_string())
        });
        spells
            .get(index)
            .map(|&sid| CommandTarget::Spell(sid))
            .unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, state: &AppState) -> usize {
        state.player_spells.len()
    }
}
