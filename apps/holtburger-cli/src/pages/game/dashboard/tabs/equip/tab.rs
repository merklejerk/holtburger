use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::{EquipTabLine, get_lines, render_equip_tab};
use crate::actions::AppAction;
use crate::state::GameState;
use crate::types::{CommandTarget, Verb};
use crate::ui::Interaction;
use crate::ui::traits::TabController;
use holtburger_core::client::types::ClientCommand;

pub struct EquipTab;

impl TabController for EquipTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_equip_tab(f, game, area);
    }

    fn get_verbs(
        &self,
        game: &GameState,
        interaction: &Option<Interaction>,
        index: usize,
    ) -> Vec<Verb> {
        let lines = get_lines(game);
        let target = self.get_target_at_index(game, index);
        let mut verbs = Vec::new();

        if let Some(interaction) = interaction
            && let CommandTarget::Entity(_e, _) = &target
        {
            match interaction {
                Interaction::Targeting { .. } => {}
                _ => {
                    return verbs;
                }
            }
        }

        match target {
            CommandTarget::Entity(e, slot) => {
                verbs.extend([
                    Verb::new(vec![AppAction::Assess(e.guid)], 'a', "Assess"),
                    Verb::new(
                        vec![AppAction::BeginInteraction(Interaction::Targeting {
                            target_guid: e.guid,
                        })],
                        't',
                        "Target",
                    ),
                ]);

                let is_here = if let Some(EquipTabLine::Item(_, here, _, _)) = lines.get(index) {
                    *here
                } else {
                    false
                };

                if is_here {
                    if let Some(_pguid) = game.data.player_guid {
                        verbs.push(Verb::new(vec![AppAction::Unequip(e.guid)], 'q', "Unequip"));
                    }
                } else if let Some(s) = slot {
                    verbs.push(Verb::new(
                        vec![AppAction::SendCommands(vec![ClientCommand::GetAndWield {
                            item: e.guid,
                            slot: Some(s),
                        }])],
                        'e',
                        "Equip",
                    ));
                }

                verbs.push(Verb::new(
                    vec![AppAction::QueryDebugInfo(e.guid)],
                    'g',
                    "Debug",
                ));
                verbs
            }
            _ => vec![],
        }
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        let lines = get_lines(game);
        match lines.get(index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => CommandTarget::Entity(e, *slot),
            _ => CommandTarget::None,
        }
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        get_lines(game).len()
    }
}
