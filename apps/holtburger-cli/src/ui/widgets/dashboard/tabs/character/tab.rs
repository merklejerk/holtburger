use ratatui::Frame;
use ratatui::layout::{Rect};

use super::super::common::{Action, Verb, VerbSet};
use super::verbs;
use super::render::{render_character_tab, CharTabLine, get_char_tab_lines};
use crate::ui::model::AppState;
use crate::ui::traits::TabController;
use crate::ui::types::{ActiveInteraction, CommandHandler, CommandTarget, StatType};
use holtburger_common::Guid;
use holtburger_core::client::types::ClientCommand;

pub struct CharacterTab;

impl TabController for CharacterTab {
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect) {
        render_character_tab(f, state, area);
    }

    fn get_verbs(&self, state: &AppState, index: usize) -> VerbSet {
        let target = self.get_target_at_index(state, index);
        if let Some(interaction_verbs) =
            super::super::common::get_interaction_verbs(&target, state.player_guid, state.active_interaction)
        {
            return interaction_verbs;
        }

        match target {
            CommandTarget::Stat(_, xp_cost, sp_cost) => {
                verbs::get_verbs(xp_cost.is_some(), sp_cost.is_some())
            }
            _ => vec![Verb::new(Action::Debug, 'b', "Debug")],
        }
    }

    fn handle_action(
        &self,
        action: &Action,
        target: &CommandTarget,
        player_guid: Option<Guid>,
        active_interaction: Option<ActiveInteraction>,
    ) -> Option<CommandHandler> {
        match (action, target) {
            (Action::LevelUp, CommandTarget::Stat(st, Some(cost), _)) => {
                let xp_spent = *cost as u32;
                match st {
                    StatType::Attribute(at) => {
                        Some(CommandHandler::Command(ClientCommand::RaiseAttribute {
                            attribute: *at,
                            xp_spent,
                        }))
                    }
                    StatType::Vital(vt) => Some(CommandHandler::Command(ClientCommand::RaiseVital {
                        vital: *vt,
                        xp_spent,
                    })),
                    StatType::Skill(st) => Some(CommandHandler::Command(ClientCommand::RaiseSkill {
                        skill: *st,
                        xp_spent,
                    })),
                }
            }
            (Action::Train, CommandTarget::Stat(st, _, Some(credits))) => {
                if let StatType::Skill(skill) = st {
                    Some(CommandHandler::Command(ClientCommand::TrainSkill {
                        skill: *skill,
                        credits: *credits,
                    }))
                } else {
                    None
                }
            }
            _ => super::super::common::handle_base_action(action, target, player_guid, active_interaction),
        }
    }

    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a> {
        get_command_target_at_index(state, index).unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, state: &AppState) -> usize {
        get_char_tab_lines(state).len()
    }
}

fn get_command_target_at_index<'a>(state: &'a AppState, index: usize) -> Option<CommandTarget<'a>> {
    let lines = get_char_tab_lines(state);
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
