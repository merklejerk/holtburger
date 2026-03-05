use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::{EquipTabLine, get_lines, render_equip_tab};
use crate::pages::game::{GameData, ViewState};
use crate::types::{AppAction, CommandTarget, Interaction, TabController, UpdateResult, Verb};

#[derive(Default, Debug, Clone)]
pub struct EquipTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}

impl EquipTab {
    fn get_target(&self, data: &GameData) -> CommandTarget {
        let lines = get_lines(data);
        match lines.get(self.selected_index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => CommandTarget::EntityWithSlot(e.guid, *slot),
            _ => CommandTarget::None,
        }
    }

    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        get_lines(data).len()
    }
}

impl TabController for EquipTab {
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
        render_equip_tab(self, f, data, view, area);
    }

    fn get_verbs(
        &self,
        data: &GameData,
        _view: &ViewState,
        interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let lines = get_lines(data);
        let target = self.get_target(data);
        let mut verbs = Vec::new();

        if let Some(interaction) = interaction
            && matches!(&target, CommandTarget::EntityWithSlot(_, _))
        {
            match interaction {
                Interaction::Targeting { .. } => {}
                _ => {
                    return verbs;
                }
            }
        }

        match target {
            CommandTarget::EntityWithSlot(guid, slot) => {
                let is_here = if let Some(EquipTabLine::Item(_, here, _, _)) =
                    lines.get(self.selected_index)
                {
                    *here
                } else {
                    false
                };

                verbs.push(Verb::new(vec![AppAction::Assess(guid)], 'a', "Assess"));

                if interaction.is_none()
                    || matches!(interaction, Some(Interaction::Targeting { target_guid }) if *target_guid != guid)
                {
                    verbs.push(Verb::new(
                        vec![AppAction::BeginInteraction(Interaction::Targeting {
                            target_guid: guid,
                        })],
                        't',
                        "Target",
                    ));
                }

                if is_here {
                    if let Some(_pguid) = data.player_guid {
                        verbs.push(Verb::new(vec![AppAction::Unequip(guid)], 'q', "Unequip"));
                    }
                } else {
                    verbs.push(Verb::new(
                        vec![AppAction::EquipInSlot(guid, slot)],
                        'e',
                        "Equip",
                    ));
                }

                verbs.push(Verb::new(
                    vec![AppAction::QueryDebugInfo(CommandTarget::Entity(guid))],
                    'g',
                    "Debug",
                ));
                verbs
            }
            _ => vec![],
        }
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        let count = self.item_count(data, view);
        match key.code {
            KeyCode::Down => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 1).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Up => {
                self.selected_index = self.selected_index.saturating_sub(1);
                Some(UpdateResult::new())
            }
            KeyCode::Home => {
                self.selected_index = 0;
                Some(UpdateResult::new())
            }
            KeyCode::End => {
                if count > 0 {
                    self.selected_index = count - 1;
                }
                Some(UpdateResult::new())
            }
            KeyCode::PageUp => {
                self.selected_index = self.selected_index.saturating_sub(10);
                Some(UpdateResult::new())
            }
            KeyCode::PageDown => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 10).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Enter | KeyCode::Char(_) => {
                let shortcut = match key.code {
                    KeyCode::Enter => '\r',
                    KeyCode::Char(c) => c,
                    _ => return None,
                };
                let verbs = self.get_verbs(data, view, &view.active_interaction);
                let verb = verbs.into_iter().find(|v| v.shortcut == shortcut)?;
                Some(UpdateResult::new().with_action(verb.action))
            }
            _ => None,
        }
    }
}
