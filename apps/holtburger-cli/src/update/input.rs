use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_common::Guid;
use holtburger_core::ClientCommand;
use holtburger_world::context::WorldContextExt;
use ratatui::layout::Rect;

use crate::pages::{game::GameState, selection::SelectionState};
use crate::state::AppState;
use crate::types::Page;
use crate::types::{FocusedPane, SCROLL_STEP, UpdateResult};

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

        // Global shortcut: Esc on selection screen
        if key.code == KeyCode::Esc && matches!(self.page, Page::Selection(_)) {
            return result;
        }

        // --- Delegation to Active Page ---
        let mut page_result = self.page.handle_input(key, width, &main_chunks);

        while !page_result.actions.is_empty() {
            let actions: Vec<_> = page_result.actions.drain(..).collect();
            for action in actions {
                let action_result = self.handle_app_action(action);
                result.merge(action_result);
            }
        }
        result.merge(page_result);

        self.refresh_context_buffer();
        // Eagerly transition to GameState when a character is selected
        // This ensures we are listening for character data (vitals, skills)
        // that the server sends *before* the final PlayerEntered event.
        for cmd in &result.commands {
            if let ClientCommand::SelectCharacterByIndex(idx) = cmd
                && let Page::Selection(sel) = &self.page
                && *idx > 0
                && *idx <= sel.characters.len()
            {
                let char_info = &sel.characters[idx - 1];
                self.page = Page::Game(Box::new(crate::pages::game::GameState::new(
                    char_info.guid,
                    char_info.name.clone(),
                    self.world_name.clone(),
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
        let mut page_result = self.page.handle_mouse(mouse, &main_chunks);
        while !page_result.actions.is_empty() {
            let actions: Vec<_> = page_result.actions.drain(..).collect();
            for action in actions {
                let action_result = self.handle_app_action(action);
                result.merge(action_result);
            }
        }
        result.merge(page_result);

        self.refresh_context_buffer();
        result
    }
}

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
                if !self.characters.is_empty() {
                    result.commands.push(ClientCommand::SelectCharacterByIndex(
                        self.selected_character_index + 1,
                    ));
                }
            }
            KeyCode::Char(c) => {
                if let Some(digit) = c.to_digit(10)
                    && digit > 0
                {
                    let idx = (digit as usize).saturating_sub(1);
                    if idx < self.characters.len() {
                        self.selected_character_index = idx;
                        result
                            .commands
                            .push(ClientCommand::SelectCharacterByIndex(idx + 1));
                        result.needs_redraw = true;
                    }
                }
            }
            _ => {}
        }
        result
    }

    pub fn handle_mouse(
        &mut self,
        _mouse: MouseEvent,
        _app: &mut AppState,
        _main_chunks: &[Rect],
    ) -> UpdateResult {
        UpdateResult::new()
    }
}

impl GameState {
    pub fn handle_mouse(&mut self, mouse: MouseEvent, main_chunks: &[Rect]) -> UpdateResult {
        let mut result = UpdateResult::new();
        match mouse.kind {
            crossterm::event::MouseEventKind::ScrollUp => {
                if mouse.row >= main_chunks[1].y
                    && mouse.row < main_chunks[1].y + main_chunks[1].height
                    && mouse.column >= main_chunks[1].x
                    && mouse.column < main_chunks[1].x + main_chunks[1].width
                {
                    self.chat.scroll_offset = self.chat.scroll_offset.saturating_add(SCROLL_STEP);

                    result.needs_redraw = true;
                } else if mouse.row >= main_chunks[2].y
                    && mouse.row < main_chunks[2].y + main_chunks[2].height
                    && mouse.column >= main_chunks[2].x
                    && mouse.column < main_chunks[2].x + main_chunks[2].width
                {
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_add(SCROLL_STEP);

                    result.needs_redraw = true;
                } else if mouse.row >= main_chunks[0].y
                    && mouse.row < main_chunks[0].y + main_chunks[0].height
                    && mouse.column >= main_chunks[0].x
                    && mouse.column < main_chunks[0].x + main_chunks[0].width
                {
                    let data = &self.data;
                    let view = &self.view;
                    self.dashboard.active_tab_mut().handle_input(
                        KeyEvent::new(KeyCode::Up, crossterm::event::KeyModifiers::NONE),
                        data,
                        view,
                    );
                    result.needs_redraw = true;
                }
            }
            crossterm::event::MouseEventKind::ScrollDown => {
                if mouse.row >= main_chunks[1].y
                    && mouse.row < main_chunks[1].y + main_chunks[1].height
                    && mouse.column >= main_chunks[1].x
                    && mouse.column < main_chunks[1].x + main_chunks[1].width
                {
                    self.chat.scroll_offset = self.chat.scroll_offset.saturating_sub(SCROLL_STEP);
                    result.needs_redraw = true;
                } else if mouse.row >= main_chunks[2].y
                    && mouse.row < main_chunks[2].y + main_chunks[2].height
                    && mouse.column >= main_chunks[2].x
                    && mouse.column < main_chunks[2].x + main_chunks[2].width
                {
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_sub(SCROLL_STEP);
                    result.needs_redraw = true;
                } else if mouse.row >= main_chunks[0].y
                    && mouse.row < main_chunks[0].y + main_chunks[0].height
                    && mouse.column >= main_chunks[0].x
                    && mouse.column < main_chunks[0].x + main_chunks[0].width
                {
                    let data = &self.data;
                    let view = &self.view;
                    self.dashboard.active_tab_mut().handle_input(
                        KeyEvent::new(KeyCode::Down, crossterm::event::KeyModifiers::NONE),
                        data,
                        view,
                    );
                    result.needs_redraw = true;
                }
            }
            _ => {}
        }
        result
    }

    #[allow(clippy::too_many_arguments)]
    pub fn handle_input(
        &mut self,
        key: KeyEvent,
        width: u16,
        main_chunks: &[Rect],
    ) -> UpdateResult {
        let mut result = UpdateResult::new();

        if self.view.focused_pane == FocusedPane::Dashboard {
            if let Some(tab_result) = self.dashboard.handle_input(key) {
                result.merge(tab_result);
                return result;
            }
            let data = &self.data;
            let view = &self.view;
            if let Some(tab_result) = self.dashboard.active_tab_mut().handle_input(key, data, view) {
                result.merge(tab_result);
                return result;
            }
        }

        match key.code {
            KeyCode::Tab | KeyCode::BackTab => {
                let active = self.view.active_interaction.is_some();
                let delta = if key
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL)
                    || key.code == KeyCode::BackTab
                {
                    -1
                } else {
                    1
                };
                self.view.focused_pane = crate::ui::utils::get_adjacent_pane(
                    self.view.focused_pane,
                    width,
                    active,
                    delta,
                );
                result.needs_redraw = true;
            }
            KeyCode::Esc => {
                self.view.active_interaction = None;
                if self.view.focused_pane == FocusedPane::Input {
                    self.view.focused_pane = self.view.previous_focused_pane;
                }
                result.needs_redraw = true;
            }
            KeyCode::Enter => {
                if self.view.focused_pane == FocusedPane::Input {
                    let command = std::mem::take(&mut self.chat_input.input);
                    if command.is_empty() {
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command == "/quit" || command == "/exit" {
                        result.commands.push(ClientCommand::Quit);
                        return result;
                    }
                    if command == "/clear" {
                        self.chat.messages.clear();
                        self.chat.wrapped_chat_cache.clear();
                        self.chat_input.input.clear();
                        return result.with_redraw(true);
                    }
                    if command == "/ping" {
                        result.commands.push(ClientCommand::Ping);
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command == "/jump" {
                        result.commands.push(ClientCommand::Jump {
                            extent: 10.0,
                            velocity: holtburger_common::Vector3::default(),
                        });
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command.starts_with("/tell ") {
                        let parts: Vec<&str> = command.splitn(3, ' ').collect();
                        if parts.len() == 3 {
                            result.commands.push(ClientCommand::Tell {
                                target: parts[1].to_string(),
                                message: parts[2].to_string(),
                            });
                        }
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command == "/sit" {
                        result.commands.push(ClientCommand::SetState(0x13));
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command == "/stand" {
                        result.commands.push(ClientCommand::SetState(0x04));
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if let Some(args) = command.strip_prefix("/turn ") {
                        if let Ok(heading) = args.parse::<f32>() {
                            result.commands.push(ClientCommand::TurnTo { heading });
                        }
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command == "/sync" {
                        result.commands.push(ClientCommand::SyncPosition);
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command == "/combat" {
                        use holtburger_protocol::messages::combat::CombatMode;
                        let mode = if self.data.combat_mode != CombatMode::NonCombat {
                            CombatMode::NonCombat
                        } else {
                            self.data.get_suggested_combat_mode()
                        };

                        result.commands.push(ClientCommand::SetCombatMode(mode));
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command == "/noclip" || command.starts_with("/noclip ") {
                        let enabled = if command == "/noclip" {
                            !self.data.noclip
                        } else {
                            match command.strip_prefix("/noclip ").unwrap_or("").trim() {
                                "on" => true,
                                "off" => false,
                                _ => !self.data.noclip,
                            }
                        };
                        result.commands.push(ClientCommand::SetNoClip(enabled));
                        self.data.noclip = enabled;
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command.starts_with("/stack ") {
                        let parts: Vec<&str> = command.split_whitespace().collect();
                        if parts.len() >= 3 {
                            let source = parts[1].strip_prefix("0x").unwrap_or(parts[1]);
                            let dest = parts[2].strip_prefix("0x").unwrap_or(parts[2]);
                            let amount = if parts.len() > 3 {
                                parts[3].parse::<i32>().unwrap_or(1)
                            } else {
                                1
                            };

                            if let (Ok(s), Ok(d)) = (
                                u32::from_str_radix(source, 16),
                                u32::from_str_radix(dest, 16),
                            ) {
                                result.commands.push(ClientCommand::Stack {
                                    source: Guid(s),
                                    destination: Guid(d),
                                    amount,
                                });
                            }
                        }
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command.starts_with("/split ") {
                        let parts: Vec<&str> = command.split_whitespace().collect();
                        if parts.len() >= 3 {
                            let item_str = parts[1].strip_prefix("0x").unwrap_or(parts[1]);
                            let amount = parts[2].parse::<i32>().unwrap_or(1);

                            if let Ok(item) = u32::from_str_radix(item_str, 16)
                                && let Some(player_guid) = self.data.player_guid
                            {
                                result.commands.push(ClientCommand::Split {
                                    item: Guid(item),
                                    container: player_guid,
                                    amount,
                                });
                            }
                        }
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command == "/info" {
                        result
                            .actions
                            .push(crate::types::AppAction::DisplayClientInfo);

                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command == "/help" {
                        use crate::pages::game::panels::chat::ChatMessageKind;
                        self.chat.log(
                            ChatMessageKind::System,
                            "Available commands: /quit, /exit, /clear, /help, /info, /ping, /jump, /sit, /stand, /tell <name> <msg>, /turn <heading>, /sync, /combat, /noclip <on|off>, /stack <src> <dst> [amount], /split <item> <amount>".to_string()
                        );
                        self.chat.log(
                            ChatMessageKind::System,
                            "Shortcuts: 1-4 (Tabs), Tab (Cycle Focus), a/u/d/p/s/b (Actions)"
                                .to_string(),
                        );
                        self.chat_input.input.clear();
                        return result.with_redraw(true);
                    }
                    self.chat_input.input_history.push(command.clone());
                    self.chat_input.history_index = None;
                    result.commands.push(ClientCommand::Talk(command));
                    self.view.focused_pane = self.view.previous_focused_pane;
                    result.needs_redraw = true;
                } else {
                    self.view.previous_focused_pane = self.view.focused_pane;
                    self.view.focused_pane = FocusedPane::Input;
                    result.needs_redraw = true;
                }
            }
            KeyCode::Backspace => {
                if self.view.focused_pane == FocusedPane::Input {
                    self.chat_input.input.pop();
                    result.needs_redraw = true;
                }
            }
            KeyCode::Left | KeyCode::Right => {
                if self.view.focused_pane != FocusedPane::Input {
                    let mut pos = self.data.player_pos.unwrap_or_default();
                    let delta = if key.code == KeyCode::Right {
                        0.1
                    } else {
                        -0.1
                    };

                    let current_heading = pos.rotation.to_heading();
                    let mut new_heading = current_heading + delta;
                    let two_pi = 2.0 * std::f32::consts::PI;
                    new_heading = (new_heading % two_pi + two_pi) % two_pi;
                    pos.rotation = holtburger_common::Quaternion::from_heading(new_heading);

                    self.data.player_pos = Some(pos);
                    result.commands.push(ClientCommand::TurnTo {
                        heading: new_heading,
                    });
                    result.needs_redraw = true;
                }
            }
            KeyCode::Up => match self.view.focused_pane {
                FocusedPane::Input => {
                    if !self.chat_input.input_history.is_empty() {
                        let idx = self
                            .chat_input
                            .history_index
                            .map(|i| i.saturating_sub(1))
                            .unwrap_or(self.chat_input.input_history.len().saturating_sub(1));
                        self.chat_input.history_index = Some(idx);
                        self.chat_input.input = self.chat_input.input_history[idx].clone();
                        result.needs_redraw = true;
                    }
                }
                FocusedPane::Chat => {
                    self.chat.scroll_offset = self.chat.scroll_offset.saturating_add(1);

                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_add(1);

                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::Down => match self.view.focused_pane {
                FocusedPane::Input => {
                    if let Some(idx) = self.chat_input.history_index {
                        if idx + 1 < self.chat_input.input_history.len() {
                            let next = idx + 1;
                            self.chat_input.history_index = Some(next);
                            self.chat_input.input = self.chat_input.input_history[next].clone();
                        } else {
                            self.chat_input.history_index = None;
                            self.chat_input.input.clear();
                        }
                        result.needs_redraw = true;
                    }
                }
                FocusedPane::Chat => {
                    self.chat.scroll_offset = self.chat.scroll_offset.saturating_sub(1);
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_sub(1);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::PageUp => match self.view.focused_pane {
                FocusedPane::Chat => {
                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.chat.scroll_offset = self.chat.scroll_offset.saturating_add(step);
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    let h = main_chunks[2].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_add(step);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::PageDown => match self.view.focused_pane {
                FocusedPane::Chat => {
                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.chat.scroll_offset = self.chat.scroll_offset.saturating_sub(step);
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    let h = main_chunks[2].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_sub(step);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::Char(c) => {
                if self.view.focused_pane == FocusedPane::Input {
                    self.chat_input.input.push(c);
                    result.needs_redraw = true;
                }
            }
            KeyCode::Home => match self.view.focused_pane {
                FocusedPane::Chat => {
                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                    self.chat.scroll_offset = self.chat.wrapped_chat_cache.len().saturating_sub(h);
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    let h = main_chunks[2].height.saturating_sub(2) as usize;
                    self.view.context_scroll_offset =
                        self.view.context_buffer.len().saturating_sub(h);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::End => match self.view.focused_pane {
                FocusedPane::Chat => {
                    self.chat.scroll_offset = 0;
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    self.view.context_scroll_offset = 0;
                    result.needs_redraw = true;
                }
                _ => {}
            },
            _ => {}
        }
        result
    }
}
