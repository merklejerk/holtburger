use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_core::ClientCommand;
use holtburger_world::context::WorldContextExt;

use crate::pages::game::GameState;
use crate::types::{FocusedPane, SCROLL_STEP, UpdateResult};

impl GameState {
    pub fn handle_mouse(&mut self, mouse: MouseEvent) -> UpdateResult {
        let mut result = UpdateResult::new();

        // Grab chunks from layout cache
        let main_chunks = std::rc::Rc::clone(&self.view.layout_cache.main_chunks);

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
    pub fn handle_input(&mut self, key: KeyEvent, width: u16) -> UpdateResult {
        let mut result = UpdateResult::new();
        let main_chunks = std::rc::Rc::clone(&self.view.layout_cache.main_chunks);

        if self.dashboard.active_tab_footer_input().is_some() {
            let data = &self.data;
            let view = &self.view;
            if let Some(tab_result) = self
                .dashboard
                .handle_active_tab_footer_input(key, data, view)
            {
                result.merge(tab_result);
            }
            return result;
        }

        if self.view.focused_pane == FocusedPane::Dashboard {
            if let Some(tab_result) = self.dashboard.handle_input(key) {
                result.merge(tab_result);
                return result;
            }
            let data = &self.data;
            let view = &self.view;
            if let Some(tab_result) = self
                .dashboard
                .active_tab_mut()
                .handle_input(key, data, view)
            {
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
                self.view.focused_pane =
                    crate::utils::get_adjacent_pane(self.view.focused_pane, width, active, delta);
                result.needs_redraw = true;
            }
            KeyCode::Esc => {
                if self.view.focused_pane == FocusedPane::Input {
                    self.view.focused_pane = self.view.previous_focused_pane;
                } else if self.view.active_interaction.is_some() {
                    self.view.active_interaction = None;
                    self.view.salvaging = None;
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
                    if command == "/help" {
                        use crate::types::ChatMessageKind;
                        self.chat.log(
                            ChatMessageKind::System,
                            "Available commands: /quit, /exit, /clear, /help, /combat".to_string(),
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
                        self.view.context_scroll_offset.saturating_sub(1);

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
                        self.view.context_scroll_offset.saturating_add(1);
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
                        self.view.context_scroll_offset.saturating_sub(step);
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
                        self.view.context_scroll_offset.saturating_add(step);
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
                    self.chat.scroll_offset = self.chat.total_lines.saturating_sub(h);
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    self.view.context_scroll_offset = 0;
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
                    self.view.context_scroll_offset =
                        self.view.context_buffer.len().saturating_sub(1);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            _ => {}
        }
        result
    }
}
