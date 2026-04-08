use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_core::ClientCommand;

use crate::state::AppState;
use crate::types::UpdateResult;

impl AppState {
    pub(super) fn handle_key_press(&mut self, key: KeyEvent) -> UpdateResult {
        // Global shortcut: Ctrl-Q to Quit
        if let KeyCode::Char('q') | KeyCode::Char('Q') = key.code
            && key
                .modifiers
                .contains(crossterm::event::KeyModifiers::CONTROL)
        {
            return UpdateResult::commands(vec![ClientCommand::Quit]);
        }

        self.page.handle_input(key)
    }

    pub(super) fn handle_mouse_event(&mut self, mouse: MouseEvent) -> UpdateResult {
        self.page.handle_mouse(mouse)
    }
}
