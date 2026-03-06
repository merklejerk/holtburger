use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_core::ClientCommand;

use crate::state::AppState;
use crate::types::UpdateResult;

impl AppState {
    pub(super) fn handle_key_press(&mut self, key: KeyEvent, width: u16) -> UpdateResult {
        let mut result = UpdateResult::new();

        // Modal blocks all input except Quit
        if self.modal.is_some() {
            if let KeyCode::Char('q') | KeyCode::Char('Q') = key.code
                && key
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL)
            {
                result.commands.push(ClientCommand::Quit);
            }
            return result;
        }

        // Global shortcut: Ctrl-Q to Quit
        if let KeyCode::Char('q') | KeyCode::Char('Q') = key.code
            && key
                .modifiers
                .contains(crossterm::event::KeyModifiers::CONTROL)
        {
            result.commands.push(ClientCommand::Quit);
            return result;
        }

        // --- Delegation to Active Page ---
        let mut page_result = self.page.handle_input(key, width);

        while !page_result.actions.is_empty() {
            let actions: Vec<_> = page_result.actions.drain(..).collect();
            for action in actions {
                let action_result = self.handle_app_action(action);
                result.merge(action_result);
            }
        }
        result.merge(page_result);
        result
    }

    pub(super) fn handle_mouse_event(&mut self, mouse: MouseEvent) -> UpdateResult {
        let mut result = UpdateResult::new();

        if self.modal.is_some() {
            return result;
        }

        // --- Delegation to Active Page ---
        let mut page_result = self.page.handle_mouse(mouse);
        while !page_result.actions.is_empty() {
            let actions: Vec<_> = page_result.actions.drain(..).collect();
            for action in actions {
                let action_result = self.handle_app_action(action);
                result.merge(action_result);
            }
        }
        result.merge(page_result);

        result
    }
}
