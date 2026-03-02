use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::{CharTabLine, get_char_tab_lines, render_character_tab};
use crate::types::AppAction;
use crate::pages::game::GameState;
use crate::types::Verb;
use crate::types::{CommandTarget, StatType};
use crate::ui::Interaction;
use crate::ui::traits::TabController;
use holtburger_core::client::types::ClientCommand;

#[derive(Default, Debug, Clone)]
pub struct CharacterTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}


impl TabController for CharacterTab {
    fn render(&mut self, f: &mut Frame, data: &crate::pages::game::GameData, view: &crate::pages::game::ViewState, area: Rect) {
        render_character_tab(f, game, area);
    }

    fn get_verbs(
        &self,
        game: &GameState,
        interaction: &Option<Interaction>,
        index: usize,
    ) -> Vec<Verb> {
        let target = self.get_target_at_index(game, index);
        let mut verbs = Vec::new();

        if let Some(interaction) = interaction {
            match interaction {
                Interaction::Targeting { .. } => {}
                _ => {
                    return verbs;
                }
            }
        }

        match target {
            CommandTarget::Stat(st, Some(xp_cost), sp_cost) => {
                let xp_spent = xp_cost as u32;
                let is_unassigned_xp_enough = game
                    .data
                    .level_info
                    .as_ref()
                    .map(|info| info.unspent_xp)
                    .unwrap_or(0)
                    >= xp_cost;

                if is_unassigned_xp_enough {
                    let cmd = match st.clone() {
                        StatType::Attribute(at) => ClientCommand::RaiseAttribute {
                            attribute: at,
                            xp_spent,
                        },
                        StatType::Vital(vt) => ClientCommand::RaiseVital {
                            vital: vt,
                            xp_spent,
                        },
                        StatType::Skill(sk) => ClientCommand::RaiseSkill {
                            skill: sk,
                            xp_spent,
                        },
                    };
                    verbs.push(Verb::new(
                        vec![AppAction::SendCommands(vec![cmd])],
                        'l',
                        "Level Up",
                    ));
                }

                if let (Some(credits_cost), StatType::Skill(skill)) = (sp_cost, st) {
                    let is_skill_credits_enough = game
                        .data
                        .level_info
                        .as_ref()
                        .map(|info| info.unspent_skill_points)
                        .unwrap_or(0)
                        >= credits_cost;
                    if is_skill_credits_enough {
                        verbs.push(Verb::new(
                            vec![AppAction::SendCommands(vec![ClientCommand::TrainSkill {
                                skill,
                                credits: credits_cost,
                            }])],
                            'n',
                            "Train",
                        ));
                    }
                }
            }
            CommandTarget::Stat(StatType::Skill(skill), None, Some(credits_cost)) => {
                let is_skill_credits_enough = game
                    .data
                    .level_info
                    .as_ref()
                    .map(|info| info.unspent_skill_points)
                    .unwrap_or(0)
                    >= credits_cost;
                if is_skill_credits_enough {
                    verbs.push(Verb::new(
                        vec![AppAction::SendCommands(vec![ClientCommand::TrainSkill {
                            skill,
                            credits: credits_cost,
                        }])],
                        'n',
                        "Train",
                    ));
                }
            }
            _ => {}
        }
        verbs
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        get_command_target_at_index(game, index).unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, data: &crate::pages::game::GameData, view: &crate::pages::game::ViewState) -> usize {
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
