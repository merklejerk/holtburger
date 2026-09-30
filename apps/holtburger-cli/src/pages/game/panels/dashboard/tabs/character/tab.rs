use crossterm::event::{KeyCode, KeyEvent};
use holtburger_core::ClientProgressionQuote;
use holtburger_protocol::messages::magic::Enchantment;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::{CharTabLine, get_char_tab_lines, render_character_tab};
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppAction, AppUiAction, ContextView, Interaction, TabController, UpdateResult, Verb,
};

#[derive(Debug, Clone)]
enum CharacterSelection {
    Enchantment(Enchantment),
    Progression(ClientProgressionQuote),
    None,
}

#[derive(Default, Debug, Clone)]
pub struct CharacterTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}

impl CharacterTab {
    fn get_selection(&self, data: &GameData) -> CharacterSelection {
        get_selection_at_index(data, self.selected_index).unwrap_or(CharacterSelection::None)
    }

    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        get_char_tab_lines(data).len()
    }
}

impl TabController for CharacterTab {
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
        render_character_tab(self, f, data, view, area);
    }

    fn get_verbs(
        &self,
        data: &GameData,
        _view: &ViewState,
        _interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let target = self.get_selection(data);
        let mut verbs = Vec::new();

        match target {
            CharacterSelection::Enchantment(enchant) => {
                verbs.push(Verb::new(
                    vec![AppAction::ViewDetails {
                        view: ContextView::Enchantment(enchant),
                    }],
                    'd',
                    "Details",
                ));
                verbs.push(Verb::new(
                    vec![AppAction::UiAction {
                        action: AppUiAction::ChangeContextView {
                            view: ContextView::DebugEnchantment(enchant),
                        },
                    }],
                    'g',
                    "Debug",
                ));
            }
            CharacterSelection::Progression(quote) => {
                let (shortcut, label) = match quote.quote.intent {
                    holtburger_world::progression::ProgressionIntent::Train { .. } => {
                        ('t', "Train")
                    }
                    _ => ('l', "Level Up"),
                };
                verbs.push(Verb::new(
                    vec![AppAction::SubmitProgression { quote }],
                    shortcut,
                    label,
                ));
            }
            _ => {}
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

fn get_selection_at_index(data: &GameData, index: usize) -> Option<CharacterSelection> {
    let lines = get_char_tab_lines(data);
    lines.get(index).map(|line| match line {
        CharTabLine::Enchantment(e) | CharTabLine::Miscellaneous(e) => {
            let key = e.key();
            let enchantment = data
                .player_enchantments
                .iter()
                .find(|enchantment| {
                    enchantment.spell_id == key.spell_id && enchantment.layer == key.layer
                })
                .expect("displayed enchantment is missing its raw inspection record");
            CharacterSelection::Enchantment(*enchantment)
        }
        CharTabLine::Stat {
            progression: Some(evaluation),
            ..
        } => evaluation
            .result
            .map_or(CharacterSelection::None, CharacterSelection::Progression),
        _ => CharacterSelection::None,
    })
}
