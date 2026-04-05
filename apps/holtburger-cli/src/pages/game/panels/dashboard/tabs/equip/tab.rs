use crossterm::event::{KeyCode, KeyEvent};
use holtburger_core::client::types::TargetSlot;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::{EquipTabLine, get_lines, render_equip_tab};
use crate::pages::game::{GameData, ViewState};
use crate::types::{AppAction, InspectTarget, Interaction, TabController, UpdateResult, Verb};

#[derive(Debug, Clone, Copy)]
enum EquipSelection {
    Item {
        guid: holtburger_common::Guid,
        slot: TargetSlot,
    },
    None,
}

#[derive(Default, Debug, Clone)]
pub struct EquipTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}

impl EquipTab {
    fn get_selection(&self, data: &GameData) -> EquipSelection {
        let lines = get_lines(data);
        match lines.get(self.selected_index) {
            Some(EquipTabLine::Item(e, _, _, slot)) => EquipSelection::Item {
                guid: e.guid,
                slot: *slot,
            },
            _ => EquipSelection::None,
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
        let selection = self.get_selection(data);
        let mut verbs = Vec::new();

        match selection {
            EquipSelection::Item { guid, slot } => {
                let is_here = if let Some(EquipTabLine::Item(_, here, _, _)) =
                    lines.get(self.selected_index)
                {
                    *here
                } else {
                    false
                };

                verbs.push(Verb::new(
                    vec![AppAction::Assess {
                        target: InspectTarget::Entity(guid),
                    }],
                    'a',
                    "Assess",
                ));

                if interaction.is_none()
                    || matches!(interaction, Some(Interaction::Targeting { target_guid }) if *target_guid != guid)
                {
                    verbs.push(Verb::new(
                        vec![AppAction::BeginInteraction {
                            interaction: Interaction::Targeting { target_guid: guid },
                        }],
                        't',
                        "Target",
                    ));
                }

                if is_here {
                    if let Some(_pguid) = data.player_guid {
                        verbs.push(Verb::new(vec![AppAction::Unequip { guid }], 'q', "Unequip"));
                    }
                } else {
                    verbs.push(Verb::new(
                        vec![AppAction::EquipInSlot { guid, slot }],
                        'e',
                        "Equip",
                    ));
                }

                verbs.push(Verb::new(
                    vec![AppAction::QueryDebugInfo {
                        target: InspectTarget::Entity(guid),
                    }],
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
