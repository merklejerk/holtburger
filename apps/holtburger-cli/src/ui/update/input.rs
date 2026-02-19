use crossterm::event::{KeyCode, KeyEvent, MouseEvent, MouseEventKind};
use holtburger_common::math::Quaternion;
use holtburger_core::ClientCommand;
use ratatui::layout::Rect;

use crate::ui;
use crate::ui::model::AppState;
use crate::ui::types::{ChatMessageKind, FocusedPane, UIState};
use crate::ui::utils::get_adjacent_pane;

impl AppState {
    pub(super) fn handle_key_press(
        &mut self,
        key: KeyEvent,
        width: u16,
        _height: u16,
        main_chunks: Vec<Rect>,
        _dynamic_chunk: Rect,
    ) -> Vec<ClientCommand> {
        let mut commands = Vec::new();

        // Modal blocks all input except Quit
        if self.modal.is_some() {
            if let KeyCode::Char('q') | KeyCode::Char('Q') = key.code
                && key
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL)
            {
                return vec![ClientCommand::Quit];
            }
            return vec![];
        }

        if matches!(self.state, UIState::Chat) && self.focused_pane == FocusedPane::Dashboard {
            let active_tab = crate::ui::widgets::dashboard::get_tab_controller(self.dashboard_tab);
            if let Some(mut tab_commands) = active_tab.handle_input(key, self) {
                commands.append(&mut tab_commands);
                self.refresh_context_buffer();
                return commands;
            }
        }

        match key.code {
            KeyCode::Char('q') | KeyCode::Char('Q')
                if key
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL) =>
            {
                commands.push(ClientCommand::Quit);
            }
            KeyCode::Tab | KeyCode::BackTab => {
                let active = self.active_interaction.is_some();
                let delta = if key
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL)
                    || key.code == KeyCode::BackTab
                {
                    -1
                } else {
                    1
                };
                self.focused_pane = get_adjacent_pane(self.focused_pane, width, active, delta);
            }
            KeyCode::Esc => {
                self.active_interaction = None;
                if self.focused_pane == FocusedPane::Input {
                    self.focused_pane = self.previous_focused_pane;
                } else if self.state == UIState::CharacterSelection {
                    self.state = UIState::Chat;
                }
            }
            KeyCode::Enter => match self.state {
                UIState::Chat => {
                    if self.focused_pane == FocusedPane::Input {
                        let input = self.input.drain(..).collect::<String>();
                        if input.is_empty() {
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input == "/quit" || input == "/exit" {
                            commands.push(ClientCommand::Quit);
                            return commands;
                        }
                        if input == "/clear" {
                            self.messages.clear();
                            self.wrapped_chat_cache.clear();
                            self.input.clear();
                            return commands;
                        }
                        if input == "/ping" {
                            commands.push(ClientCommand::Ping);
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input == "/jump" {
                            commands.push(ClientCommand::Jump {
                                extent: 10.0, // Default jump extent
                                velocity: holtburger_common::Vector3::default(),
                            });
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input.starts_with("/tell ") {
                            let parts: Vec<&str> = input.splitn(3, ' ').collect();
                            if parts.len() == 3 {
                                commands.push(ClientCommand::Tell {
                                    target: parts[1].to_string(),
                                    message: parts[2].to_string(),
                                });
                            }
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input == "/sit" {
                            commands.push(ClientCommand::SetState(0x13)); // Sitting
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input == "/stand" {
                            commands.push(ClientCommand::SetState(0x04)); // Stop
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if let Some(args) = input.strip_prefix("/turn ") {
                            if let Ok(heading) = args.parse::<f32>() {
                                commands.push(ClientCommand::TurnTo { heading });
                            }
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input == "/sync" {
                            commands.push(ClientCommand::SyncPosition);
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input == "/combat" {
                            use holtburger_protocol::messages::combat::CombatMode;
                            let mode = if self.combat_mode != CombatMode::NonCombat {
                                CombatMode::NonCombat
                            } else {
                                self.get_suggested_combat_mode()
                            };

                            commands.push(ClientCommand::SetCombatMode(mode));
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input == "/noclip" || input.starts_with("/noclip ") {
                            let enabled = if input == "/noclip" {
                                !self.noclip
                            } else {
                                match input.strip_prefix("/noclip ").unwrap_or("").trim() {
                                    "on" => true,
                                    "off" => false,
                                    _ => !self.noclip,
                                }
                            };
                            commands.push(ClientCommand::SetNoClip(enabled));
                            self.noclip = enabled;
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input == "/info" {
                            self.display_client_info();
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input == "/help" {
                            self.log_chat(
                                ChatMessageKind::System,
                                "Available commands: /quit, /exit, /clear, /help, /info, /ping, /jump, /sit, /stand, /tell <name> <msg>, /turn <heading>, /sync, /combat, /noclip <on|off>"
                                    .to_string(),
                            );
                            self.log_chat(
                                ChatMessageKind::System,
                                "Shortcuts: 1-4 (Tabs), Tab (Cycle Focus), a/u/d/p/s/b (Actions)"
                                    .to_string(),
                            );
                            self.input.clear();
                            return commands;
                        }
                        self.input_history.push(input.clone());
                        self.history_index = None;
                        commands.push(ClientCommand::Talk(input));
                        self.focused_pane = self.previous_focused_pane;
                    } else {
                        self.previous_focused_pane = self.focused_pane;
                        self.focused_pane = FocusedPane::Input;
                    }
                }
                UIState::CharacterSelection => {
                    if !self.characters.is_empty() {
                        commands.push(ClientCommand::SelectCharacterByIndex(
                            self.selected_character_index + 1,
                        ));
                        self.state = UIState::Chat;
                    }
                }
            },
            KeyCode::Backspace => {
                if self.state == UIState::Chat && self.focused_pane == FocusedPane::Input {
                    self.input.pop();
                }
            }
            KeyCode::Left | KeyCode::Right => {
                if self.state == UIState::Chat && self.focused_pane != FocusedPane::Input {
                    let mut pos = self.player_pos.unwrap_or_default();
                    let delta = if key.code == KeyCode::Right {
                        0.1
                    } else {
                        -0.1
                    };

                    // Adjust yaw (rotation around Z)
                    let current_heading = pos.rotation.to_heading();
                    let mut new_heading = current_heading + delta;

                    // Normalize to [0, 2π)
                    let two_pi = 2.0 * std::f32::consts::PI;
                    new_heading = (new_heading % two_pi + two_pi) % two_pi;

                    // Rebuild quaternion from new heading
                    pos.rotation = Quaternion::from_heading(new_heading);

                    self.player_pos = Some(pos);
                    commands.push(ClientCommand::TurnTo {
                        heading: new_heading,
                    });
                }
            }
            KeyCode::Up => match self.state {
                UIState::Chat => match self.focused_pane {
                    FocusedPane::Input => {
                        if !self.input_history.is_empty() {
                            let idx = self
                                .history_index
                                .map(|i| i.saturating_sub(1))
                                .unwrap_or(self.input_history.len() - 1);
                            self.history_index = Some(idx);
                            self.input = self.input_history[idx].clone();
                        }
                    }
                    FocusedPane::Chat => {
                        self.scroll_offset = self.scroll_offset.saturating_add(1);
                    }
                    FocusedPane::Context => {
                        self.context_scroll_offset = self.context_scroll_offset.saturating_add(1);
                    }
                    FocusedPane::Dashboard => {}
                    FocusedPane::Dynamic => {
                        // TODO: Handle dynamic selection scroll/cycling
                    }
                },
                UIState::CharacterSelection => {
                    if self.selected_character_index > 0 {
                        self.selected_character_index -= 1;
                    }
                }
            },
            KeyCode::Down => match self.state {
                UIState::Chat => match self.focused_pane {
                    FocusedPane::Input => {
                        if let Some(idx) = self.history_index {
                            if idx + 1 < self.input_history.len() {
                                let next = idx + 1;
                                self.history_index = Some(next);
                                self.input = self.input_history[next].clone();
                            } else {
                                self.history_index = None;
                                self.input.clear();
                            }
                        }
                    }
                    FocusedPane::Chat => {
                        self.scroll_offset = self.scroll_offset.saturating_sub(1);
                    }
                    FocusedPane::Context => {
                        self.context_scroll_offset = self.context_scroll_offset.saturating_sub(1);
                    }
                    FocusedPane::Dashboard => {}
                    FocusedPane::Dynamic => {
                        // TODO: Handle dynamic selection scroll/cycling
                    }
                },
                UIState::CharacterSelection => {
                    if !self.characters.is_empty()
                        && self.selected_character_index + 1 < self.characters.len()
                    {
                        self.selected_character_index += 1;
                    }
                }
            },
            KeyCode::PageUp => {
                if let UIState::Chat = self.state {
                    match self.focused_pane {
                        FocusedPane::Chat => {
                            let h = main_chunks[1].height.saturating_sub(2) as usize;
                            let step = (h / 2) + 1;
                            self.scroll_offset = self.scroll_offset.saturating_add(step);
                        }
                        FocusedPane::Context => {
                            let h = main_chunks[2].height.saturating_sub(2) as usize;
                            let step = (h / 2) + 1;
                            self.context_scroll_offset =
                                self.context_scroll_offset.saturating_add(step);
                        }
                        FocusedPane::Dashboard => {}
                        _ => {}
                    }
                }
            }
            KeyCode::PageDown => {
                if let UIState::Chat = self.state {
                    match self.focused_pane {
                        FocusedPane::Chat => {
                            let h = main_chunks[1].height.saturating_sub(2) as usize;
                            let step = (h / 2) + 1;
                            self.scroll_offset = self.scroll_offset.saturating_sub(step);
                        }
                        FocusedPane::Context => {
                            let h = main_chunks[2].height.saturating_sub(2) as usize;
                            let step = (h / 2) + 1;
                            self.context_scroll_offset =
                                self.context_scroll_offset.saturating_sub(step);
                        }
                        FocusedPane::Dashboard => {}
                        _ => {}
                    }
                }
            }
            KeyCode::Char(c) => {
                if let UIState::CharacterSelection = self.state
                    && let Some(digit) = c.to_digit(10)
                    && digit > 0
                {
                    let idx = (digit as usize).saturating_sub(1);
                    if idx < self.characters.len() {
                        self.selected_character_index = idx;
                        commands.push(ClientCommand::SelectCharacterByIndex(idx + 1));
                        self.state = UIState::Chat;
                    }
                }

                if let UIState::Chat = self.state {
                    match self.focused_pane {
                        FocusedPane::Input => {
                            self.input.push(c);
                        }
                        FocusedPane::Chat
                        | FocusedPane::Context
                        | FocusedPane::Dashboard
                        | FocusedPane::Dynamic => {
                            match c {
                                'x' | 'X' => {
                                    // dashboard input is now handled by early return.
                                }
                                _ => {
                                    // dashboard actions are now handled by early return.
                                }
                            }
                        }
                    }
                }
            }
            KeyCode::Home => {
                if let UIState::Chat = self.state {
                    match self.focused_pane {
                        FocusedPane::Chat => {
                            let max_scroll = self.chat_total_lines.saturating_sub(1);
                            self.scroll_offset = max_scroll;
                        }
                        FocusedPane::Context => {
                            let max_scroll = self.context_buffer.len().saturating_sub(1);
                            self.context_scroll_offset = max_scroll;
                        }
                        FocusedPane::Dashboard => {}
                        _ => {}
                    }
                }
            }
            KeyCode::End => {
                if let UIState::Chat = self.state {
                    match self.focused_pane {
                        FocusedPane::Chat => self.scroll_offset = 0,
                        FocusedPane::Context => self.context_scroll_offset = 0,
                        FocusedPane::Dashboard => {}
                        _ => {}
                    }
                }
            }
            _ => {}
        }
        commands
    }

    pub(super) fn handle_mouse_event(
        &mut self,
        mouse: MouseEvent,
        _chunks: Vec<Rect>,
        main_chunks: Vec<Rect>,
        _dynamic_chunk: Rect,
    ) -> Vec<ClientCommand> {
        if self.modal.is_some() {
            return Vec::new();
        }

        let commands = Vec::new();
        match mouse.kind {
            MouseEventKind::ScrollUp => {
                if mouse.row >= main_chunks[1].y
                    && mouse.row < main_chunks[1].y + main_chunks[1].height
                    && mouse.column >= main_chunks[1].x
                    && mouse.column < main_chunks[1].x + main_chunks[1].width
                {
                    self.scroll_offset = self.scroll_offset.saturating_add(ui::SCROLL_STEP);
                } else if mouse.row >= main_chunks[2].y
                    && mouse.row < main_chunks[2].y + main_chunks[2].height
                    && mouse.column >= main_chunks[2].x
                    && mouse.column < main_chunks[2].x + main_chunks[2].width
                {
                    self.context_scroll_offset =
                        self.context_scroll_offset.saturating_add(ui::SCROLL_STEP);
                } else if mouse.row >= main_chunks[0].y
                    && mouse.row < main_chunks[0].y + main_chunks[0].height
                    && mouse.column >= main_chunks[0].x
                    && mouse.column < main_chunks[0].x + main_chunks[0].width
                {
                    self.selected_dashboard_index = self.selected_dashboard_index.saturating_sub(1);
                }
            }
            MouseEventKind::ScrollDown => {
                if mouse.row >= main_chunks[1].y
                    && mouse.row < main_chunks[1].y + main_chunks[1].height
                    && mouse.column >= main_chunks[1].x
                    && mouse.column < main_chunks[1].x + main_chunks[1].width
                {
                    self.scroll_offset = self.scroll_offset.saturating_sub(ui::SCROLL_STEP);
                } else if mouse.row >= main_chunks[2].y
                    && mouse.row < main_chunks[2].y + main_chunks[2].height
                    && mouse.column >= main_chunks[2].x
                    && mouse.column < main_chunks[2].x + main_chunks[2].width
                {
                    self.context_scroll_offset =
                        self.context_scroll_offset.saturating_sub(ui::SCROLL_STEP);
                } else if mouse.row >= main_chunks[0].y
                    && mouse.row < main_chunks[0].y + main_chunks[0].height
                    && mouse.column >= main_chunks[0].x
                    && mouse.column < main_chunks[0].x + main_chunks[0].width
                {
                    self.selected_dashboard_index = self.selected_dashboard_index.saturating_add(1);
                }
            }
            _ => {}
        }
        commands
    }
}
