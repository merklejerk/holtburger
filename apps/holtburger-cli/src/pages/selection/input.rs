use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_core::ClientCommand;

use crate::pages::selection::SelectionState;
use crate::types::UpdateResult;

impl SelectionState {
    pub fn handle_input(&mut self, key: KeyEvent) -> UpdateResult {
        let mut result = UpdateResult::new();
        match key.code {
            KeyCode::Up => {
                if self.selected_character_index > 0 {
                    self.selected_character_index -= 1;
                    result.needs_redraw = true;
                }
            }
            KeyCode::Down => {
                if !self.characters.is_empty()
                    && self.selected_character_index + 1 < self.characters.len()
                {
                    self.selected_character_index += 1;
                    result.needs_redraw = true;
                }
            }
            KeyCode::Enter => {
                if let Some(character) = self.characters.get(self.selected_character_index) {
                    result
                        .commands
                        .push(ClientCommand::SelectCharacter(character.guid));
                }
            }
            KeyCode::Char(c) => {
                if let Some(digit) = c.to_digit(10)
                    && digit > 0
                {
                    let idx = (digit as usize).saturating_sub(1);
                    if let Some(character) = self.characters.get(idx) {
                        self.selected_character_index = idx;
                        result
                            .commands
                            .push(ClientCommand::SelectCharacter(character.guid));
                        result.needs_redraw = true;
                    }
                }
            }
            KeyCode::Esc => {
                result.commands.push(ClientCommand::Quit);
            }
            _ => {}
        }
        result
    }

    pub fn handle_mouse(&mut self, _mouse: MouseEvent) -> UpdateResult {
        UpdateResult::new()
    }
}
