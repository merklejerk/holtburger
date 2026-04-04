use crossterm::event::{KeyCode, KeyEvent, MouseEvent};

use crate::pages::selection::SelectionState;
use crate::types::{RedrawPriority, UpdateResult};

impl SelectionState {
    pub fn handle_input(&mut self, key: KeyEvent) -> UpdateResult {
        if let Some(result) = self.handle_delete_confirmation_input(key) {
            return result;
        }

        let mut result = UpdateResult::new();
        if matches!(self.screen, super::state::CharacterScreen::Creation) {
            match key.code {
                KeyCode::Esc => {
                    return result.with_action(crate::types::AppUiAction::OpenCharacterDashboard.into());
                }
                _ => return result,
            }
        }

        match key.code {
            KeyCode::Up => {
                if self.selected_character_index > 0 {
                    self.selected_character_index -= 1;
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            KeyCode::Down => {
                if !self.characters.is_empty()
                    && self.selected_character_index + 1 < self.characters.len()
                {
                    self.selected_character_index += 1;
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            KeyCode::Home => {
                if !self.characters.is_empty() {
                    self.selected_character_index = 0;
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            KeyCode::End => {
                if !self.characters.is_empty() {
                    self.selected_character_index = self.characters.len() - 1;
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            KeyCode::PageUp => {
                if !self.characters.is_empty() {
                    self.selected_character_index = self.selected_character_index.saturating_sub(10);
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            KeyCode::PageDown => {
                if !self.characters.is_empty() {
                    self.selected_character_index =
                        (self.selected_character_index + 10).min(self.characters.len() - 1);
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            KeyCode::Enter => {
                if let Some(verb) = self
                    .dashboard_verbs()
                    .into_iter()
                    .find(|verb| verb.shortcut == '\r')
                {
                    result.actions.push(verb.action);
                }
            }
            KeyCode::Char(c) => {
                if let Some(digit) = c.to_digit(10)
                    && digit > 0
                {
                    let idx = (digit as usize).saturating_sub(1);
                    if self.characters.get(idx).is_some() {
                        self.selected_character_index = idx;
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                } else if let Some(verb) = self
                    .dashboard_verbs()
                    .into_iter()
                    .find(|verb| verb.shortcut.eq_ignore_ascii_case(&c))
                {
                    result.actions.push(verb.action);
                }
            }
            KeyCode::Esc => {
                result.commands.push(holtburger_core::ClientCommand::Quit);
            }
            _ => {}
        }
        result
    }

    fn handle_delete_confirmation_input(&mut self, key: KeyEvent) -> Option<UpdateResult> {
        let confirmation = self.delete_confirmation.as_mut()?;
        let mut result = UpdateResult::new();

        match key.code {
            KeyCode::Esc => {
                result.actions.push(
                    crate::types::AppUiAction::CancelDeleteCharacterConfirmation.into(),
                );
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::Enter => {
                if confirmation.expected_name_matches() {
                    result.actions.push(crate::types::AppAction::DeleteCharacterAtSlot {
                        slot: confirmation.slot,
                    });
                } else {
                    confirmation.error_message = Some(format!(
                        "Type '{}' to confirm delete.",
                        confirmation.character_name
                    ));
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            _ => {
                if confirmation.input.apply_key(key) {
                    confirmation.error_message = None;
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
        }

        Some(result)
    }

    pub fn handle_mouse(&mut self, _mouse: MouseEvent) -> UpdateResult {
        UpdateResult::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::selection::state::{CharacterDashboardEntry, CharacterScreen, DeleteCharacterConfirmation};
    use crossterm::event::KeyModifiers;
    use holtburger_common::Guid;
    use holtburger_protocol::messages::CharacterEntry;

    fn test_state() -> SelectionState {
        SelectionState {
            characters: vec![CharacterDashboardEntry {
                slot: 4,
                character: CharacterEntry {
                    guid: Guid(0x5000_0001),
                    name: "Sho Girl".to_string(),
                    delete_time: 0,
                },
            }],
            selected_character_index: 0,
            character_preference: None,
            screen: CharacterScreen::Dashboard,
            delete_confirmation: Some(DeleteCharacterConfirmation::new(
                4,
                "Sho Girl".to_string(),
            )),
        }
    }

    #[test]
    fn delete_confirmation_enter_with_matching_name_emits_delete_action() {
        let mut state = test_state();
        state
            .delete_confirmation
            .as_mut()
            .expect("confirmation should exist")
            .input
            .set_text("  shogirl ");

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.as_slice(),
            [crate::types::AppAction::DeleteCharacterAtSlot { slot: 4 }]
        ));
    }

    #[test]
    fn delete_confirmation_enter_with_wrong_name_shows_error_and_keeps_modal() {
        let mut state = test_state();
        state
            .delete_confirmation
            .as_mut()
            .expect("confirmation should exist")
            .input
            .set_text("wrong");

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.actions.is_empty());
        assert!(result.redraw_requested());
        assert!(state
            .delete_confirmation
            .as_ref()
            .and_then(|confirmation| confirmation.error_message.as_ref())
            .is_some());
    }
}
