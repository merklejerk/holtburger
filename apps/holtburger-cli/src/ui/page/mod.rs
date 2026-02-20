use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Borders};
use unicode_width::UnicodeWidthStr;

use crate::ui::get_layout;
use crate::ui::model::{AppState, GameState, Page, SelectionState};
use crate::ui::types::{FocusedPane, PULSE_PANEL_WIDTH, UpdateResult};
use crate::ui::widgets::chat::{render_chat_pane, render_context_pane};
use crate::ui::widgets::dashboard::render_dashboard_pane;
use crate::ui::widgets::dynamic::render_dynamic_pane;
use crate::ui::widgets::pulse::render_pulse_panel;
use crate::ui::widgets::selection::render_character_selection;
use crate::ui::widgets::status::render_status_bar;
use holtburger_core::ClientCommand;

impl Page {
    pub fn render(&mut self, f: &mut Frame, area: Rect, app: &mut AppState) {
        match self {
            Page::Selection(selection) => selection.render(f, area, app),
            Page::Game(game) => game.render(f, area, app),
        }
    }

    pub fn handle_input(
        &mut self,
        key: KeyEvent,
        app: &mut AppState,
        width: u16,
        main_chunks: &[Rect],
    ) -> UpdateResult {
        match self {
            Page::Selection(selection) => selection.handle_input(key),
            Page::Game(game) => game.handle_input(key, app, width, main_chunks),
        }
    }

    pub fn handle_mouse(
        &mut self,
        mouse: crossterm::event::MouseEvent,
        app: &mut AppState,
        main_chunks: &[Rect],
    ) -> UpdateResult {
        match self {
            Page::Selection(_) => UpdateResult::new(),
            Page::Game(game) => game.handle_mouse(mouse, app, main_chunks),
        }
    }
}

impl SelectionState {
    pub fn render(&mut self, f: &mut Frame, _area: Rect, _app: &mut AppState) {
        // Selection state doesn't need AppState, it renders its own characters.
        render_character_selection(f, self, _area);
    }

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
        _mouse: crossterm::event::MouseEvent,
        _app: &mut AppState,
        _main_chunks: &[Rect],
    ) -> UpdateResult {
        UpdateResult::new()
    }
}

impl GameState {
    pub fn render(&mut self, f: &mut Frame, area: Rect, app: &mut AppState) {
        // The game view uses the shared status bar and the complex multi-pane layout.
        let (chunks, main_chunks_vec, dynamic_chunk) = get_layout(area);
        let chunks = &chunks;

        // Status Area
        render_status_bar(f, self, app, chunks[0]);

        let main_chunks = &main_chunks_vec;

        // Dashboard Pane
        render_dashboard_pane(f, self, app, main_chunks[0]);

        // Chat Pane
        render_chat_pane(f, self, app, main_chunks[1]);

        // Context Pane
        render_context_pane(f, self, app, main_chunks[2]);

        // Dynamic Pane
        render_dynamic_pane(f, self, app, dynamic_chunk);

        // Pulse Panel (Input Area)
        let input_chunks = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Min(0), Constraint::Length(PULSE_PANEL_WIDTH)])
            .split(chunks[2]);

        let focused_pane = self.focused_pane;

        let input_style = if focused_pane == FocusedPane::Input {
            Style::default().fg(Color::Yellow)
        } else {
            Style::default()
        };
        let input_title = if focused_pane == FocusedPane::Input {
            ">> Input ([ENTER] to focus) <<"
        } else {
            "Input ([ENTER] to focus)"
        };
        let input_block = Block::default()
            .borders(Borders::ALL)
            .title(input_title)
            .border_style(input_style)
            .title_style(if focused_pane == FocusedPane::Input {
                Style::default()
                    .fg(Color::Yellow)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            });
        let input_width = app.input.as_str().width() as u16;
        let max_visible_width = input_chunks[0].width.saturating_sub(2);

        let display_input = if input_width > max_visible_width {
            let mut width = 0;
            let mut start_index = app.input.len();
            for (i, c) in app.input.char_indices().rev() {
                let c_width = UnicodeWidthStr::width(c.to_string().as_str());
                if width + c_width > max_visible_width as usize {
                    break;
                }
                width += c_width;
                start_index = i;
            }
            &app.input[start_index..]
        } else {
            app.input.as_str()
        };

        let input_para = ratatui::widgets::Paragraph::new(display_input).block(input_block);
        f.render_widget(input_para, input_chunks[0]);

        // Pulse Panel
        render_pulse_panel(f, app, input_chunks[1]);

        if app.modal.is_none() && focused_pane == FocusedPane::Input {
            let display_width = UnicodeWidthStr::width(display_input) as u16;
            f.set_cursor(input_chunks[0].x + 1 + display_width, input_chunks[0].y + 1);
        }
    }

    pub fn handle_mouse(
        &mut self,
        mouse: crossterm::event::MouseEvent,
        _app: &mut AppState,
        main_chunks: &[Rect],
    ) -> UpdateResult {
        let mut result = UpdateResult::new();
        match mouse.kind {
            crossterm::event::MouseEventKind::ScrollUp => {
                if mouse.row >= main_chunks[1].y
                    && mouse.row < main_chunks[1].y + main_chunks[1].height
                    && mouse.column >= main_chunks[1].x
                    && mouse.column < main_chunks[1].x + main_chunks[1].width
                {
                    self.scroll_offset = self.scroll_offset.saturating_add(crate::ui::SCROLL_STEP);
                    result.needs_redraw = true;
                } else if mouse.row >= main_chunks[2].y
                    && mouse.row < main_chunks[2].y + main_chunks[2].height
                    && mouse.column >= main_chunks[2].x
                    && mouse.column < main_chunks[2].x + main_chunks[2].width
                {
                    self.context_scroll_offset = self
                        .context_scroll_offset
                        .saturating_add(crate::ui::SCROLL_STEP);
                    result.needs_redraw = true;
                } else if mouse.row >= main_chunks[0].y
                    && mouse.row < main_chunks[0].y + main_chunks[0].height
                    && mouse.column >= main_chunks[0].x
                    && mouse.column < main_chunks[0].x + main_chunks[0].width
                {
                    self.selected_dashboard_index = self.selected_dashboard_index.saturating_sub(1);
                    result.needs_redraw = true;
                }
            }
            crossterm::event::MouseEventKind::ScrollDown => {
                if mouse.row >= main_chunks[1].y
                    && mouse.row < main_chunks[1].y + main_chunks[1].height
                    && mouse.column >= main_chunks[1].x
                    && mouse.column < main_chunks[1].x + main_chunks[1].width
                {
                    self.scroll_offset = self.scroll_offset.saturating_sub(crate::ui::SCROLL_STEP);
                    result.needs_redraw = true;
                } else if mouse.row >= main_chunks[2].y
                    && mouse.row < main_chunks[2].y + main_chunks[2].height
                    && mouse.column >= main_chunks[2].x
                    && mouse.column < main_chunks[2].x + main_chunks[2].width
                {
                    self.context_scroll_offset = self
                        .context_scroll_offset
                        .saturating_sub(crate::ui::SCROLL_STEP);
                    result.needs_redraw = true;
                } else if mouse.row >= main_chunks[0].y
                    && mouse.row < main_chunks[0].y + main_chunks[0].height
                    && mouse.column >= main_chunks[0].x
                    && mouse.column < main_chunks[0].x + main_chunks[0].width
                {
                    self.selected_dashboard_index = self.selected_dashboard_index.saturating_add(1);
                    result.needs_redraw = true;
                }
            }
            _ => {}
        }
        result
    }

    pub fn handle_input(
        &mut self,
        key: KeyEvent,
        app: &mut AppState,
        width: u16,
        main_chunks: &[Rect],
    ) -> UpdateResult {
        let mut result = UpdateResult::new();

        if self.focused_pane == FocusedPane::Dashboard {
            let active_tab = crate::ui::widgets::dashboard::get_tab_controller(self.dashboard_tab);
            if let Some(tab_result) = active_tab.handle_input(key, self, app) {
                result.merge(tab_result);
                return result;
            }
        }

        match key.code {
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
                self.focused_pane =
                    crate::ui::utils::get_adjacent_pane(self.focused_pane, width, active, delta);
                result.needs_redraw = true;
            }
            KeyCode::Esc => {
                self.active_interaction = None;
                if self.focused_pane == FocusedPane::Input {
                    self.focused_pane = self.previous_focused_pane;
                }
                result.needs_redraw = true;
            }
            KeyCode::Enter => {
                if self.focused_pane == FocusedPane::Input {
                    let input = app.input.drain(..).collect::<String>();
                    if input.is_empty() {
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if input == "/quit" || input == "/exit" {
                        result.commands.push(ClientCommand::Quit);
                        return result;
                    }
                    if input == "/clear" {
                        app.messages.clear();
                        app.wrapped_chat_cache.clear();
                        app.input.clear();
                        return result.with_redraw(true);
                    }
                    if input == "/ping" {
                        result.commands.push(ClientCommand::Ping);
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if input == "/jump" {
                        result.commands.push(ClientCommand::Jump {
                            extent: 10.0,
                            velocity: holtburger_common::Vector3::default(),
                        });
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if input.starts_with("/tell ") {
                        let parts: Vec<&str> = input.splitn(3, ' ').collect();
                        if parts.len() == 3 {
                            result.commands.push(ClientCommand::Tell {
                                target: parts[1].to_string(),
                                message: parts[2].to_string(),
                            });
                        }
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if input == "/sit" {
                        result.commands.push(ClientCommand::SetState(0x13));
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if input == "/stand" {
                        result.commands.push(ClientCommand::SetState(0x04));
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if let Some(args) = input.strip_prefix("/turn ") {
                        if let Ok(heading) = args.parse::<f32>() {
                            result.commands.push(ClientCommand::TurnTo { heading });
                        }
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if input == "/sync" {
                        result.commands.push(ClientCommand::SyncPosition);
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if input == "/combat" {
                        use holtburger_protocol::messages::combat::CombatMode;
                        let mode = if self.combat_mode != CombatMode::NonCombat {
                            CombatMode::NonCombat
                        } else {
                            self.get_suggested_combat_mode()
                        };

                        result.commands.push(ClientCommand::SetCombatMode(mode));
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
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
                        result.commands.push(ClientCommand::SetNoClip(enabled));
                        self.noclip = enabled;
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if input == "/info" {
                        // Special handling for client info display
                        app.display_client_info();
                        app.input_history.push(input.clone());
                        app.history_index = None;
                        self.focused_pane = self.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if input == "/help" {
                        use crate::ui::types::ChatMessageKind;
                        app.log_chat(
                            ChatMessageKind::System,
                            "Available commands: /quit, /exit, /clear, /help, /info, /ping, /jump, /sit, /stand, /tell <name> <msg>, /turn <heading>, /sync, /combat, /noclip <on|off>".to_string()
                        );
                        app.log_chat(
                            ChatMessageKind::System,
                            "Shortcuts: 1-4 (Tabs), Tab (Cycle Focus), a/u/d/p/s/b (Actions)"
                                .to_string(),
                        );
                        app.input.clear();
                        return result.with_redraw(true);
                    }
                    app.input_history.push(input.clone());
                    app.history_index = None;
                    result.commands.push(ClientCommand::Talk(input));
                    self.focused_pane = self.previous_focused_pane;
                    result.needs_redraw = true;
                } else {
                    self.previous_focused_pane = self.focused_pane;
                    self.focused_pane = FocusedPane::Input;
                    result.needs_redraw = true;
                }
            }
            KeyCode::Backspace => {
                if self.focused_pane == FocusedPane::Input {
                    app.input.pop();
                    result.needs_redraw = true;
                }
            }
            KeyCode::Left | KeyCode::Right => {
                if self.focused_pane != FocusedPane::Input {
                    let mut pos = self.player_pos.unwrap_or_default();
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

                    self.player_pos = Some(pos);
                    result.commands.push(ClientCommand::TurnTo {
                        heading: new_heading,
                    });
                    result.needs_redraw = true;
                }
            }
            KeyCode::Up => match self.focused_pane {
                FocusedPane::Input => {
                    if !app.input_history.is_empty() {
                        let idx = app
                            .history_index
                            .map(|i| i.saturating_sub(1))
                            .unwrap_or(app.input_history.len() - 1);
                        app.history_index = Some(idx);
                        app.input = app.input_history[idx].clone();
                        result.needs_redraw = true;
                    }
                }
                FocusedPane::Chat => {
                    self.scroll_offset = self.scroll_offset.saturating_add(1);
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    self.context_scroll_offset = self.context_scroll_offset.saturating_add(1);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::Down => match self.focused_pane {
                FocusedPane::Input => {
                    if let Some(idx) = app.history_index {
                        if idx + 1 < app.input_history.len() {
                            let next = idx + 1;
                            app.history_index = Some(next);
                            app.input = app.input_history[next].clone();
                        } else {
                            app.history_index = None;
                            app.input.clear();
                        }
                        result.needs_redraw = true;
                    }
                }
                FocusedPane::Chat => {
                    self.scroll_offset = self.scroll_offset.saturating_sub(1);
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    self.context_scroll_offset = self.context_scroll_offset.saturating_sub(1);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::PageUp => match self.focused_pane {
                FocusedPane::Chat => {
                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.scroll_offset = self.scroll_offset.saturating_add(step);
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    let h = main_chunks[2].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.context_scroll_offset = self.context_scroll_offset.saturating_add(step);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::PageDown => match self.focused_pane {
                FocusedPane::Chat => {
                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.scroll_offset = self.scroll_offset.saturating_sub(step);
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    let h = main_chunks[2].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.context_scroll_offset = self.context_scroll_offset.saturating_sub(step);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::Char(c) => {
                if self.focused_pane == FocusedPane::Input {
                    app.input.push(c);
                    result.needs_redraw = true;
                }
            }
            KeyCode::Home => match self.focused_pane {
                FocusedPane::Chat => {
                    let max_scroll = self.chat_total_lines.saturating_sub(1);
                    self.scroll_offset = max_scroll;
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    let max_scroll = self.context_buffer.len().saturating_sub(1);
                    self.context_scroll_offset = max_scroll;
                    result.needs_redraw = true;
                }
                _ => {}
            },
            KeyCode::End => match self.focused_pane {
                FocusedPane::Chat => {
                    self.scroll_offset = 0;
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    self.context_scroll_offset = 0;
                    result.needs_redraw = true;
                }
                _ => {}
            },
            _ => {}
        }
        result
    }
}
