use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::common::{Action, Verb};
use super::render::{CharTabLine, get_char_tab_lines, render_character_tab};
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::{CommandTarget, InteractionMode, StatType};
use crate::ui::update::effect::UIEffect;
use holtburger_core::client::types::ClientCommand;

pub struct CharacterTab;

impl TabController for CharacterTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_character_tab(f, game, area);
    }

    fn get_verbs(&self, game: &GameState, index: usize) -> Vec<Verb> {
        let active_interaction = game.view.active_interaction;
        let target = self.get_target_at_index(game, index);

        if let Some(interaction) = active_interaction
            && interaction.mode != InteractionMode::Target
        {
            return vec![Verb::new(Action::Cancel, '\x1b', "Cancel")];
        }

        match target {
            CommandTarget::Stat(_, xp_cost, sp_cost) => {
                let mut verbs = Vec::new();

                if xp_cost.is_some() {
                    verbs.push(Verb::new(Action::LevelUp, 'l', "Level Up"));
                }

                if sp_cost.is_some() {
                    verbs.push(Verb::new(Action::Train, 'n', "Train"));
                }

                verbs
            }
            _ => vec![Verb::new(Action::Debug, 'g', "Debug")],
        }
    }

    fn handle_action(
        &self,
        action: &Action,
        index: usize,
        game: &mut GameState,
    ) -> Option<UIEffect> {
        let target = self.get_target_at_index(game, index);

        match (action, &target) {
            (Action::LevelUp, CommandTarget::Stat(st, Some(cost), _)) => {
                let xp_spent = *cost as u32;
                match st {
                    StatType::Attribute(at) => {
                        Some(UIEffect::Command(ClientCommand::RaiseAttribute {
                            attribute: *at,
                            xp_spent,
                        }))
                    }
                    StatType::Vital(vt) => Some(UIEffect::Command(ClientCommand::RaiseVital {
                        vital: *vt,
                        xp_spent,
                    })),
                    StatType::Skill(st) => Some(UIEffect::Command(ClientCommand::RaiseSkill {
                        skill: *st,
                        xp_spent,
                    })),
                }
            }
            (Action::Train, CommandTarget::Stat(st, _, Some(credits))) => {
                if let StatType::Skill(skill) = st {
                    Some(UIEffect::Command(ClientCommand::TrainSkill {
                        skill: *skill,
                        credits: *credits,
                    }))
                } else {
                    None
                }
            }
            _ => super::super::common::handle_base_action(action, &target, game),
        }
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        get_command_target_at_index(game, index).unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        get_char_tab_lines(game).len()
    }
}

fn get_command_target_at_index<'a>(game: &'a GameState, index: usize) -> Option<CommandTarget<'a>> {
    let lines = get_char_tab_lines(game);
    lines.get(index).map(|line| match line {
        CharTabLine::Enchantment(e) | CharTabLine::Miscellaneous(e) => {
            CommandTarget::Enchantment(*e)
        }
        CharTabLine::Stat {
            stat_type: Some(st),
            xp_cost,
            sp_cost,
            ..
        } => CommandTarget::Stat(st.clone(), *xp_cost, *sp_cost),
        _ => CommandTarget::None,
    })
}
