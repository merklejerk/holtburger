use crossterm::event::{KeyCode, KeyEvent, KeyModifiers, MouseEvent};
use holtburger_core::ClientCommand;

use crate::state::AppState;
use crate::types::UpdateResult;

impl AppState {
    pub(super) fn handle_key_press(&mut self, key: KeyEvent) -> UpdateResult {
        if self.exit_confirmation_open {
            return match key.code {
                KeyCode::Enter | KeyCode::Char('y' | 'Y')
                    if !key
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
                {
                    self.exit_confirmation_open = false;
                    UpdateResult::commands(vec![ClientCommand::Quit])
                }
                KeyCode::Esc | KeyCode::Char('n' | 'N') => {
                    self.exit_confirmation_open = false;
                    UpdateResult::redraw()
                }
                _ => UpdateResult::new(),
            };
        }

        if let KeyCode::Char('d' | 'D' | 'q' | 'Q') = key.code
            && key.modifiers.contains(KeyModifiers::CONTROL)
        {
            self.exit_confirmation_open = true;
            return UpdateResult::redraw();
        }

        self.page.handle_input(key)
    }

    pub(super) fn handle_mouse_event(&mut self, mouse: MouseEvent) -> UpdateResult {
        if self.exit_confirmation_open {
            return UpdateResult::new();
        }
        self.page.handle_mouse(mouse)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AppEvent, Page};
    use crossterm::event::{MouseButton, MouseEventKind};
    use holtburger_core::ClientState;

    fn selection_app() -> AppState {
        AppState {
            account_name: String::new(),
            account_password: String::new(),
            character_preference: None,
            chat_log: None,
            page: Page::Selection(Box::default()),
            client_state: ClientState::Connected,
            net_stats: crate::state::NetStats::default(),
            world_name: String::new(),
            server_time: None,
            character_gen_catalog: None,
            spell_catalog: None,
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
            exit_confirmation_open: false,
            queued_script_startup: None,
            script_host_config: Default::default(),
            script_directories: Default::default(),
        }
    }

    #[test]
    fn exit_shortcuts_require_confirmation_before_emitting_quit() {
        for shortcut in ['d', 'D', 'q', 'Q'] {
            for confirm in [KeyCode::Enter, KeyCode::Char('y'), KeyCode::Char('Y')] {
                let mut app = selection_app();
                let result = app.handle_app_event(AppEvent::KeyPress(KeyEvent::new(
                    KeyCode::Char(shortcut),
                    KeyModifiers::CONTROL,
                )));
                assert!(app.exit_confirmation_open);
                assert!(result.commands.is_empty());

                let result = app.handle_key_press(KeyEvent::new(confirm, KeyModifiers::NONE));
                assert!(matches!(result.commands.as_slice(), [ClientCommand::Quit]));
            }
        }
    }

    #[test]
    fn cancelling_exit_preserves_the_page() {
        for cancel in [KeyCode::Esc, KeyCode::Char('n'), KeyCode::Char('N')] {
            let mut app = selection_app();
            app.handle_key_press(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL));
            let result = app.handle_key_press(KeyEvent::new(cancel, KeyModifiers::NONE));
            assert!(!app.exit_confirmation_open);
            assert!(result.commands.is_empty());
            assert!(result.actions.is_empty());
            assert!(matches!(app.page, Page::Selection(_)));
        }
    }

    #[test]
    fn exit_confirmation_captures_keyboard_and_mouse_input() {
        let mut app = selection_app();
        app.handle_key_press(KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL));
        for key in [
            KeyEvent::new(KeyCode::Char('d'), KeyModifiers::CONTROL),
            KeyEvent::new(KeyCode::Char('q'), KeyModifiers::CONTROL),
            KeyEvent::new(KeyCode::Char('y'), KeyModifiers::CONTROL),
            KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE),
        ] {
            let result = app.handle_key_press(key);
            assert!(app.exit_confirmation_open);
            assert!(result.commands.is_empty());
            assert!(result.actions.is_empty());
        }

        let result = app.handle_mouse_event(MouseEvent {
            kind: MouseEventKind::Down(MouseButton::Left),
            column: 0,
            row: 0,
            modifiers: KeyModifiers::NONE,
        });
        assert!(app.exit_confirmation_open);
        assert!(result.commands.is_empty());
        assert!(result.actions.is_empty());
    }
}
