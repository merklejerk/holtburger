use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_core::ClientCommand;
use ratatui::layout::Rect;

use crate::ui::model::{AppState, Page};
use crate::ui::types::UpdateResult;

impl AppState {
    pub(super) fn handle_key_press(
        &mut self,
        key: KeyEvent,
        width: u16,
        _height: u16,
        main_chunks: Vec<Rect>,
        _dynamic_chunk: Rect,
    ) -> UpdateResult {
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

        // Global shortcut: Esc on selection screen (placeholder logic)
        if key.code == KeyCode::Esc && matches!(self.page, Page::Selection(_)) {
            self.page = Page::Game(Box::default());
            return result;
        }

        // --- Delegation to Active Page ---
        // We use mem::replace to avoid borrow conflict between self.page and self.
        let mut page = std::mem::replace(&mut self.page, Page::Selection(Default::default()));
        result = page.handle_input(key, self, width, &main_chunks);
        self.page = page;

        // Apply UIEffect while we have ownership of self back
        if let Some(effect) = result.effect.take() {
            let effect_cmds = crate::ui::update::effect::apply_ui_effect(self, effect);
            result.commands.extend(effect_cmds);
            self.refresh_context_buffer();
        }

        // Eagerly transition to GameState when a character is selected
        // This ensures we are listening for character data (vitals, skills)
        // that the server sends *before* the final PlayerEntered event.
        for cmd in &result.commands {
            if let ClientCommand::SelectCharacterByIndex(idx) = cmd
                && let Page::Selection(sel) = &self.page
                && *idx > 0
                && *idx <= sel.characters.len()
            {
                let char_info = &sel.characters[*idx - 1];
                self.page = Page::Game(Box::new(crate::ui::model::GameState::new(
                    char_info.guid,
                    char_info.name.clone(),
                )));
            }
        }

        result
    }

    pub(super) fn handle_mouse_event(
        &mut self,
        mouse: MouseEvent,
        _chunks: Vec<Rect>,
        main_chunks: Vec<Rect>,
        _dynamic_chunk: Rect,
    ) -> UpdateResult {
        let mut result = UpdateResult::new();

        if self.modal.is_some() {
            return result;
        }

        // --- Delegation to Active Page ---
        let mut page = std::mem::replace(&mut self.page, Page::Selection(Default::default()));
        result = page.handle_mouse(mouse, self, &main_chunks);
        self.page = page;

        // Apply UIEffect while we have ownership of self back
        if let Some(effect) = result.effect.take() {
            let effect_cmds = crate::ui::update::effect::apply_ui_effect(self, effect);
            result.commands.extend(effect_cmds);
            self.refresh_context_buffer();
        }

        result
    }
}
