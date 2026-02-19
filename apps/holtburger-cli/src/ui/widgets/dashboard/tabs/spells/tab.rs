use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::common::{Action, VerbSet};
use super::verbs;
use super::render::render_spells_tab;
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::{ActiveInteraction, CommandHandler, CommandTarget};
use holtburger_common::Guid;
use holtburger_core::client::types::ClientCommand;

pub struct SpellsTab;

impl TabController for SpellsTab {
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect) {
        render_spells_tab(f, state, area);
    }

    fn get_verbs(&self, state: &AppState, index: usize) -> VerbSet {
        let target = self.get_target_at_index(state, index);
        if let Some(interaction_verbs) =
            super::super::common::get_interaction_verbs(&target, state.player_guid, state.active_interaction)
        {
            return interaction_verbs;
        }

        verbs::get_verbs(false)
    }

    fn handle_action(
        &self,
        action: &Action,
        target: &CommandTarget,
        player_guid: Option<Guid>,
        active_interaction: Option<ActiveInteraction>,
    ) -> Option<CommandHandler> {
        match (action, target) {
            (Action::Cast(_), CommandTarget::Spell(spell_id)) => {
                use crate::ui::types::InteractionMode;
                if let Some(interaction) = active_interaction
                    && (interaction.mode == InteractionMode::Target
                        || interaction.mode == InteractionMode::Healing)
                {
                    Some(CommandHandler::Command(ClientCommand::CastTargetedSpell {
                        target: interaction.guid,
                        spell_id: *spell_id,
                    }))
                } else {
                    Some(CommandHandler::Command(ClientCommand::CastUntargetedSpell {
                        spell_id: *spell_id,
                    }))
                }
            }
            _ => super::super::common::handle_base_action(action, target, player_guid, active_interaction),
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
