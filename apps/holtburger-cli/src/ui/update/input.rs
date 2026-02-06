use crossterm::event::{KeyCode, KeyEvent, MouseButton, MouseEvent, MouseEventKind};
use holtburger_core::ClientCommand;
use ratatui::layout::Rect;

use crate::actions::{self, ActionHandler, ActionTarget};
use crate::ui;
use crate::ui::model::AppState;
use crate::ui::types::{ChatMessageKind, ContextView, DashboardTab, FocusedPane, UIState};
use crate::ui::utils::{get_next_pane, get_prev_pane};

impl AppState {
    pub(super) fn handle_key_press(
        &mut self,
        key: KeyEvent,
        width: u16,
        _height: u16,
        main_chunks: Vec<Rect>,
    ) -> Vec<ClientCommand> {
        let mut commands = Vec::new();
        match key.code {
            KeyCode::Char('q') | KeyCode::Char('Q')
                if key
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL) =>
            {
                commands.push(ClientCommand::Quit);
            }
            KeyCode::Tab | KeyCode::BackTab => {
                if key
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL)
                    || key.code == KeyCode::BackTab
                {
                    self.focused_pane = get_prev_pane(self.focused_pane, width);
                } else {
                    self.focused_pane = get_next_pane(self.focused_pane, width);
                }
            }
            KeyCode::Esc => {
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
                                velocity: holtburger_core::math::Vector3::default(),
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
                        if input.starts_with("/turn ") {
                            if let Ok(heading) = input[6..].parse::<f32>() {
                                commands.push(ClientCommand::TurnTo { heading });
                            }
                            self.input_history.push(input.clone());
                            self.history_index = None;
                            self.focused_pane = self.previous_focused_pane;
                            return commands;
                        }
                        if input.starts_with("/autonomy ") {
                            if let Ok(level) = input[10..].parse::<u32>() {
                                commands.push(ClientCommand::SetAutonomyLevel(level));
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
                        if input == "/help" {
                            self.log_chat(
                                ChatMessageKind::System,
                                "Available commands: /quit, /exit, /clear, /help, /ping, /jump, /sit, /stand, /tell <name> <msg>, /turn <heading>, /autonomy <n>, /sync"
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
                    FocusedPane::Dashboard => {
                        if self.selected_dashboard_index > 0 {
                            self.selected_dashboard_index -= 1;
                        }
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
                    FocusedPane::Dashboard => {
                        let dashboard_count = self.dashboard_item_count();
                        if dashboard_count > 0
                            && self.selected_dashboard_index + 1 < dashboard_count
                        {
                            self.selected_dashboard_index += 1;
                        }
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
                        FocusedPane::Dashboard => {
                            let h = self.last_dashboard_height;
                            let step = (h / 2) + 1;
                            self.selected_dashboard_index =
                                self.selected_dashboard_index.saturating_sub(step);
                        }
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
                        FocusedPane::Dashboard => {
                            let h = self.last_dashboard_height;
                            let step = (h / 2) + 1;
                            let count = self.dashboard_item_count();
                            self.selected_dashboard_index =
                                (self.selected_dashboard_index + step).min(count.saturating_sub(1));
                        }
                        _ => {}
                    }
                }
            }
            KeyCode::Char(c) => {
                if let UIState::Chat = self.state {
                    match self.focused_pane {
                        FocusedPane::Input => {
                            self.input.push(c);
                        }
                        FocusedPane::Chat | FocusedPane::Context | FocusedPane::Dashboard => {
                            match c {
                                '1' => {
                                    self.dashboard_tab = DashboardTab::Entities;
                                    self.selected_dashboard_index = 0;
                                }
                                '2' => {
                                    self.dashboard_tab = DashboardTab::Inventory;
                                    self.selected_dashboard_index = 0;
                                }
                                '3' => {
                                    self.dashboard_tab = DashboardTab::Character;
                                    self.selected_dashboard_index = 0;
                                }
                                '4' => {
                                    self.dashboard_tab = DashboardTab::Effects;
                                    self.selected_dashboard_index = 0;
                                }
                                'x' | 'X' => {
                                    self.context_view = ContextView::Default;
                                    self.refresh_context_buffer();
                                }
                                _ => {
                                    // Action processing
                                    let target = match self.dashboard_tab {
                                        DashboardTab::Entities | DashboardTab::Inventory => {
                                            let entities = self.get_filtered_nearby_tab();
                                            entities
                                                .get(self.selected_dashboard_index)
                                                .map(|(e, _, _)| ActionTarget::Entity(e))
                                                .unwrap_or(ActionTarget::None)
                                        }
                                        DashboardTab::Effects => {
                                            let enchants = self.get_effects_list_enchantments();
                                            enchants
                                                .get(self.selected_dashboard_index)
                                                .map(|(e, _)| ActionTarget::Enchantment(e))
                                                .unwrap_or(ActionTarget::None)
                                        }
                                        DashboardTab::Character => ActionTarget::None,
                                    };

                                    let player_guid = self.player_guid;
                                    let actions = actions::get_actions_for_target(
                                        &target,
                                        &self.entities,
                                        player_guid,
                                    );
                                    if let Some(handler) = actions
                                        .iter()
                                        .find(|a| a.shortcut_char() == c.to_ascii_lowercase())
                                        .and_then(|action| action.handler(&target, player_guid))
                                    {
                                        match handler {
                                            ActionHandler::Command(cmd) => {
                                                commands.push(cmd);
                                            }
                                            ActionHandler::ToggleDebug => {
                                                let lines =
                                                    actions::get_debug_info(&target, |id| {
                                                        self.entities
                                                            .get(&id)
                                                            .map(|e| e.name.clone())
                                                            .or_else(|| {
                                                                if Some(id) == player_guid {
                                                                    Some("You".to_string())
                                                                } else {
                                                                    None
                                                                }
                                                            })
                                                    });
                                                self.context_view = ContextView::Custom;
                                                self.context_buffer = lines;
                                                self.context_scroll_offset = 0;
                                            }
                                        }
                                    }
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
                        FocusedPane::Dashboard => {
                            self.selected_dashboard_index = 0;
                        }
                        _ => {}
                    }
                }
            }
            KeyCode::End => {
                if let UIState::Chat = self.state {
                    match self.focused_pane {
                        FocusedPane::Chat => self.scroll_offset = 0,
                        FocusedPane::Context => self.context_scroll_offset = 0,
                        FocusedPane::Dashboard => {
                            let dashboard_count = self.dashboard_item_count();
                            self.selected_dashboard_index = dashboard_count.saturating_sub(1);
                        }
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
        chunks: Vec<Rect>,
        main_chunks: Vec<Rect>,
    ) -> Vec<ClientCommand> {
        let commands = Vec::new();
        match mouse.kind {
            MouseEventKind::Down(MouseButton::Left) => {
                if mouse.row >= chunks[2].y
                    && mouse.row < chunks[2].y + chunks[2].height
                    && mouse.column >= chunks[2].x
                    && mouse.column < chunks[2].x + chunks[2].width
                {
                    self.focused_pane = FocusedPane::Input;
                } else if mouse.row >= main_chunks[0].y
                    && mouse.row < main_chunks[0].y + main_chunks[0].height
                    && mouse.column >= main_chunks[0].x
                    && mouse.column < main_chunks[0].x + main_chunks[0].width
                {
                    self.focused_pane = FocusedPane::Dashboard;
                } else if mouse.row >= main_chunks[1].y
                    && mouse.row < main_chunks[1].y + main_chunks[1].height
                    && mouse.column >= main_chunks[1].x
                    && mouse.column < main_chunks[1].x + main_chunks[1].width
                {
                    self.focused_pane = FocusedPane::Chat;
                } else if mouse.row >= main_chunks[2].y
                    && mouse.row < main_chunks[2].y + main_chunks[2].height
                    && mouse.column >= main_chunks[2].x
                    && mouse.column < main_chunks[2].x + main_chunks[2].width
                {
                    self.focused_pane = FocusedPane::Context;
                }
            }
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
