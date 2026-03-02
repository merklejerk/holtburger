use crate::types::CommandTarget;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_spells_tab;
use crate::types::AppAction;
use crate::pages::game::GameState;
use crate::types::ContextView;
use crate::types::Verb;
use crate::ui::Interaction;
use crate::ui::traits::TabController;
use holtburger_core::client::types::ClientCommand;
use holtburger_world::context::WorldContextExt;

#[derive(Default, Debug, Clone)]
pub struct SpellsTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}


impl TabController for SpellsTab {
    fn render(&mut self, f: &mut Frame, data: &crate::pages::game::GameData, view: &crate::pages::game::ViewState, area: Rect) {
        render_spells_tab(f, game, area);
    }

    fn get_verbs(
        &self,
        game: &GameState,
        interaction: &Option<Interaction>,
        index: usize,
    ) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let target = self.get_target_at_index(game, index);

        if let Some(interaction) = interaction {
            if !matches!(interaction, Interaction::Targeting { .. }) {
                return verbs;
            }
        }

        if let CommandTarget::Spell(spell_id) = target {
            if !game.data.is_wielding_caster() {
                verbs.push(Verb::new(
                    vec![AppAction::Log(
                        crate::pages::game::panels::chat::ChatMessageKind::Error,
                        "You must be wielding a caster to cast spells!".to_string(),
                    )],
                    'c',
                    "Cast (Need Caster)",
                ));
            } else if game.data.combat_mode
                != holtburger_protocol::messages::combat::CombatMode::Magic
            {
                verbs.push(Verb::new(
                    vec![AppAction::SetCombatMode(
                        holtburger_protocol::messages::combat::CombatMode::Magic,
                    )],
                    'c',
                    "Switch to Magic",
                ));
            } else if let Some(Interaction::Targeting { target_guid }) = interaction {
                verbs.push(Verb::new(
                    vec![
                        AppAction::SendCommands(vec![ClientCommand::CastTargetedSpell {
                            spell_id,
                            target: *target_guid,
                        }]),
                        AppAction::CancelInteraction,
                    ],
                    'c',
                    "Cast on target",
                ));
            } else if let Some(player_guid) = game.data.player_guid {
                verbs.push(Verb::new(
                    vec![AppAction::CastSpell(spell_id, Some(player_guid))],
                    'c',
                    "Cast on self",
                ));
            } else {
                verbs.push(Verb::new(
                    vec![AppAction::CastSpell(spell_id, None)],
                    'c',
                    "Cast",
                ));
            }

            verbs.push(Verb::new(
                vec![AppAction::ViewDetails(ContextView::Spell(spell_id))],
                'd',
                "Details",
            ));
        }

        verbs
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        let mut spells = game.data.player_spells.clone();
        spells.sort_by_key(|&sid| {
            game.data
                .spell_names
                .get(&sid)
                .cloned()
                .unwrap_or_else(|| "".to_string())
        });
        if let Some(&sid) = spells.get(index) {
            CommandTarget::Spell(sid)
        } else {
            CommandTarget::None
        }
    }

    fn get_item_count(&self, data: &crate::pages::game::GameData, view: &crate::pages::game::ViewState) -> usize {
        game.data.player_spells.len()
    }
}
