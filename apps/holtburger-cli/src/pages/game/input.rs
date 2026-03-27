mod commands;

use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_common::ConfirmationType;
use holtburger_core::ClientCommand;
use holtburger_protocol::messages::combat::CombatMode;

use crate::pages::game::GameState;
use crate::types::{FocusedPane, SCROLL_STEP, UpdateResult};

impl GameState {
    pub fn handle_mouse(&mut self, mouse: MouseEvent) -> UpdateResult {
        let mut result = UpdateResult::new();

        if self.view.active_confirmation.is_some() {
            return result;
        }

        // Grab chunks from layout cache
        let main_chunks = self.main_chunks();

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

    pub fn handle_input(&mut self, key: KeyEvent) -> UpdateResult {
        let mut result = UpdateResult::new();

        if let Some(confirmation_result) = self.handle_confirmation_input(key) {
            return confirmation_result;
        }

        let main_chunks = self.main_chunks();

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
                self.view.focused_pane = crate::utils::get_adjacent_pane(
                    self.view.focused_pane,
                    self.layout_mode(),
                    active,
                    delta,
                );
                result.needs_redraw = true;
            }
            KeyCode::Esc => {
                if self.view.focused_pane == FocusedPane::Input {
                    self.view.focused_pane = self.view.previous_focused_pane;
                } else if self.view.active_interaction.is_some() {
                    self.clear_active_interaction(&mut result);
                    self.view.salvaging = None;
                }
                result.needs_redraw = true;
            }
            KeyCode::Enter => {
                if self.view.focused_pane == FocusedPane::Input {
                    let command = self.chat_input.input.take_text();
                    if command.is_empty() {
                        self.view.focused_pane = self.view.previous_focused_pane;
                        return result.with_redraw(true);
                    }
                    if command.starts_with('/') {
                        return self.handle_slash_command(&command);
                    }
                    if let Some(emote) = command.strip_prefix(':') {
                        self.chat_input.input_history.push(command.clone());
                        self.chat_input.history_index = None;
                        self.view.focused_pane = self.view.previous_focused_pane;
                        result
                            .commands
                            .push(ClientCommand::Emote(emote.to_string()));
                        result.needs_redraw = true;
                        return result;
                    }
                    self.chat_input.input_history.push(command.clone());
                    self.chat_input.history_index = None;
                    self.view.focused_pane = self.view.previous_focused_pane;
                    result.commands.push(ClientCommand::Talk(command));
                    result.needs_redraw = true;
                } else {
                    self.view.previous_focused_pane = self.view.focused_pane;
                    self.view.focused_pane = FocusedPane::Input;
                    result.needs_redraw = true;
                }
            }
            KeyCode::Backspace | KeyCode::Delete => {
                if self.view.focused_pane == FocusedPane::Input
                    && self.chat_input.input.apply_key(key)
                {
                    result.needs_redraw = true;
                }
            }
            KeyCode::Left | KeyCode::Right => {
                if self.view.focused_pane == FocusedPane::Input {
                    if self.chat_input.input.apply_key(key) {
                        result.needs_redraw = true;
                    }
                } else {
                    let delta = if key.code == KeyCode::Right {
                        0.1
                    } else {
                        -0.1
                    };

                    let current_heading = self
                        .data
                        .player_pos
                        .unwrap_or_default()
                        .rotation
                        .to_heading();
                    let mut new_heading = current_heading + delta;
                    let two_pi = 2.0 * std::f32::consts::PI;
                    new_heading = (new_heading % two_pi + two_pi) % two_pi;
                    result.commands.push(ClientCommand::EnqueueMovementInput(
                        holtburger_core::client::movement_types::MovementInput::SnapFacing {
                            heading: new_heading,
                        },
                    ));
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
                        self.chat_input
                            .input
                            .set_text(&self.chat_input.input_history[idx]);
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
                            self.chat_input
                                .input
                                .set_text(&self.chat_input.input_history[next]);
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
                    if self.chat_input.input.apply_key(key) {
                        result.needs_redraw = true;
                    }
                } else if c == '`' {
                    result.actions.push(crate::types::AppAction::SetCombatMode {
                        mode: self.toggled_combat_mode(),
                    });
                    result.needs_redraw = true;
                } else if self.view.focused_pane == FocusedPane::Dynamic {
                    match c.to_ascii_lowercase() {
                        'r' if matches!(
                            self.data.combat_mode,
                            CombatMode::Melee | CombatMode::Missile
                        ) =>
                        {
                            result
                                .actions
                                .push(crate::types::AppAction::CycleCombatProfileLevel);
                            result.needs_redraw = true;
                        }
                        'h' if matches!(
                            self.data.combat_mode,
                            CombatMode::Melee | CombatMode::Missile
                        ) =>
                        {
                            result
                                .actions
                                .push(crate::types::AppAction::CycleCombatAttackHeight);
                            result.needs_redraw = true;
                        }
                        _ => {}
                    }
                }
            }
            KeyCode::Home => match self.view.focused_pane {
                FocusedPane::Input => {
                    if self.chat_input.input.apply_key(key) {
                        result.needs_redraw = true;
                    }
                }
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
                FocusedPane::Input => {
                    if self.chat_input.input.apply_key(key) {
                        result.needs_redraw = true;
                    }
                }
                FocusedPane::Chat => {
                    self.chat.scroll_offset = 0;
                    result.needs_redraw = true;
                }
                FocusedPane::Context => {
                    self.view.context_scroll_offset = self.context_buffer_len().saturating_sub(1);
                    result.needs_redraw = true;
                }
                _ => {}
            },
            _ => {}
        }
        result
    }

    fn handle_confirmation_input(&mut self, key: KeyEvent) -> Option<UpdateResult> {
        let confirmation = self.view.active_confirmation.as_ref()?;

        let accepted = match key.code {
            KeyCode::Enter => Some(true),
            KeyCode::Esc => Some(false),
            _ => None,
        };

        let mut result = UpdateResult::new();
        if let Some(accepted) = accepted {
            result
                .commands
                .push(ClientCommand::RespondToConfirmation { accepted });
            if accepted && confirmation.confirmation_type == ConfirmationType::Fellowship {
                self.mark_fellowship_invite_accepted();
            }
            self.view.active_confirmation = None;
            result.needs_redraw = true;
        }

        Some(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::game::GameState;
    use crate::types::{AppAction, FocusedPane, Interaction};
    use crossterm::event::KeyModifiers;
    use holtburger_common::ConfirmationType;
    use holtburger_common::Guid;
    use holtburger_core::ActiveCharacterConfirmation;

    #[test]
    fn combat_command_dispatches_set_combat_mode_action() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/combat");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(matches!(
            result.actions.first(),
            Some(AppAction::SetCombatMode {
                mode: CombatMode::Melee
            })
        ));
        assert_eq!(state.view.focused_pane, FocusedPane::Dashboard);
    }

    #[test]
    fn combat_command_toggles_back_to_noncombat_action() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.data.combat_mode = CombatMode::Missile;
        state.chat_input.input.set_text("/combat");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::SetCombatMode {
                mode: CombatMode::NonCombat
            })
        ));
    }

    #[test]
    fn arrow_key_rotation_uses_snap_facing_command() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Dashboard;
        state.data.player_pos = Some(holtburger_common::position::WorldPosition {
            rotation: holtburger_common::Quaternion::from_heading(0.0),
            ..Default::default()
        });
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Right, KeyModifiers::NONE));

        assert!(result.needs_redraw);
        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::EnqueueMovementInput(
                holtburger_core::client::movement_types::MovementInput::SnapFacing { .. }
            ))
        ));
    }

    #[test]
    fn dynamic_focus_r_cycles_combat_profile() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Dynamic;
        state.view.active_interaction = Some(Interaction::Targeting {
            target_guid: Guid(0x60000001),
        });
        state.data.combat_mode = CombatMode::Melee;
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::NONE));

        assert_eq!(result.actions.len(), 1);
        assert!(matches!(
            result.actions.first(),
            Some(AppAction::CycleCombatProfileLevel)
        ));
    }

    #[test]
    fn dashboard_focus_p_does_not_cycle_combat_profile() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Dashboard;
        state.view.active_interaction = Some(Interaction::Targeting {
            target_guid: Guid(0x60000001),
        });
        state.data.combat_mode = CombatMode::Melee;
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::NONE));

        assert!(
            !result
                .actions
                .iter()
                .any(|action| matches!(action, AppAction::CycleCombatProfileLevel))
        );
    }

    #[test]
    fn backtick_toggles_combat_mode_globally() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Dashboard;
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Char('`'), KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::SetCombatMode {
                mode: CombatMode::Melee
            })
        ));
    }

    #[test]
    fn escape_cancels_attack_when_leaving_targeting() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Dashboard;
        state.view.active_interaction = Some(Interaction::Targeting {
            target_guid: Guid(0x60000001),
        });
        state.data.combat_mode = CombatMode::Melee;
        state.data.combat_runtime.attack_sequence_active = true;
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));

        assert!(
            result
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::CancelAttack))
        );
        assert_eq!(state.view.active_interaction, None);
        assert!(!state.data.combat_runtime.attack_sequence_active);
    }

    #[test]
    fn enter_accepts_active_confirmation_and_clears_overlay_state() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/options list");
        state.view.active_confirmation = Some(ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::CraftInteraction,
            context: 42,
            text: "Proceed with crafting?".to_string(),
        });
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::RespondToConfirmation { accepted: true }
            )
        }));
        assert!(result.actions.is_empty());
        assert!(result.needs_redraw);
        assert!(state.view.active_confirmation.is_none());
        assert_eq!(state.chat_input.input.text(), "/options list");
    }

    #[test]
    fn enter_submits_colon_prefixed_input_as_emote_without_required_space() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text(":waves");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::Emote(text)) if text == "waves"
        ));
    }

    #[test]
    fn enter_preserves_everything_after_colon_as_emote_content() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text(": hello there");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.first(),
            Some(ClientCommand::Emote(text)) if text == " hello there"
        ));
    }

    #[test]
    fn decline_confirmation_blocks_underlying_input_handling() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Dashboard;
        state.view.active_interaction = Some(Interaction::Targeting {
            target_guid: Guid(0x60000001),
        });
        state.data.combat_mode = CombatMode::Melee;
        state.view.active_confirmation = Some(ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::CraftInteraction,
            context: 99,
            text: "Proceed with crafting?".to_string(),
        });
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));

        assert!(result.commands.iter().any(|command| {
            matches!(
                command,
                ClientCommand::RespondToConfirmation { accepted: false }
            )
        }));
        assert!(state.view.active_interaction.is_some());
        assert!(state.view.active_confirmation.is_none());
    }

    #[test]
    fn unrelated_keys_are_swallowed_while_confirmation_is_active() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("hello");
        state.view.active_confirmation = Some(ActiveCharacterConfirmation {
            confirmation_type: ConfirmationType::CraftInteraction,
            context: 123,
            text: "Proceed with crafting?".to_string(),
        });
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Char('x'), KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(result.actions.is_empty());
        assert!(!result.needs_redraw);
        assert_eq!(state.chat_input.input.text(), "hello");
        assert!(state.view.active_confirmation.is_some());
    }
}
