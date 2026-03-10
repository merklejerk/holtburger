use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_spells_tab;
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppAction, ContextView, Interaction, TabController, UpdateResult, Verb,
};

#[derive(Default, Debug, Clone)]
pub struct SpellsTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}

impl SpellsTab {
    fn get_selected_spell_id(&self, data: &GameData) -> Option<u32> {
        let mut spells = data.player_spells.clone();
        spells.sort_by_key(|&sid| data.spell_name_or_fallback(sid));
        spells.get(self.selected_index).copied()
    }

    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        data.player_spells.len()
    }
}

impl TabController for SpellsTab {
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
        render_spells_tab(self, f, data, view, area);
    }

    fn get_verbs(
        &self,
        data: &GameData,
        _view: &ViewState,
        interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let spell_id = self.get_selected_spell_id(data);

        match interaction {
            Some(Interaction::Targeting { target_guid }) => {
                if let Some(spell_id) = spell_id {
                    verbs.push(Verb::new(
                        vec![AppAction::CastSpell {
                            spell_id,
                            target: Some(*target_guid),
                        }],
                        'c',
                        "Cast on target",
                    ));
                }
                return verbs;
            }
            Some(_) => {
                // No actions when there's an active interaction other than targeting
                return verbs;
            }
            _ => {}
        }

        if let Some(spell_id) = spell_id {
            if let Some(player_guid) = data.player_guid {
                verbs.push(Verb::new(
                    vec![AppAction::CastSpell {
                        spell_id,
                        target: Some(player_guid),
                    }],
                    'c',
                    "Cast on self",
                ));
            } else {
                verbs.push(Verb::new(
                    vec![AppAction::CastSpell {
                        spell_id,
                        target: None,
                    }],
                    'c',
                    "Cast",
                ));
            }

            verbs.push(Verb::new(
                vec![AppAction::ViewDetails {
                    view: ContextView::Spell(spell_id),
                }],
                'd',
                "Details",
            ));
            verbs.push(Verb::new(
                vec![AppAction::ChangeContextView {
                    view: ContextView::DebugSpell(spell_id),
                }],
                'g',
                "Debug",
            ));
        }

        verbs
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
