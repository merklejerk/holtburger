mod commands;

use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_common::ConfirmationType;
use holtburger_core::ClientCommand;
use holtburger_protocol::messages::combat::CombatMode;

use crate::pages::game::GameState;
use crate::pages::game::panels::chat::ChatView;
use crate::pages::game::state::domains;
use crate::types::{
    AppAction, AppUiAction, ContextView, FocusedPane, RedrawPriority, SCROLL_STEP, UpdateResult,
};

fn normalize_soul_emote_token(command: &str) -> Option<&str> {
    let token = command
        .strip_prefix('*')
        .and_then(|value| value.strip_suffix('*'))
        .filter(|token| !token.is_empty() && !token.contains('*'))?;

    Some(token)
}

impl GameState {
    pub fn handle_mouse(&mut self, mouse: MouseEvent) -> UpdateResult {
        let mut result = UpdateResult::new();

        if self.view.local_confirmation.is_some() || self.view.active_confirmation.is_some() {
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
                    *self.chat.active_scroll_offset_mut() =
                        self.chat.active_scroll_offset().saturating_add(SCROLL_STEP);

                    result.request_redraw(RedrawPriority::Immediate);
                } else if mouse.row >= main_chunks[2].y
                    && mouse.row < main_chunks[2].y + main_chunks[2].height
                    && mouse.column >= main_chunks[2].x
                    && mouse.column < main_chunks[2].x + main_chunks[2].width
                {
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_sub(SCROLL_STEP);

                    result.request_redraw(RedrawPriority::Immediate);
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
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            crossterm::event::MouseEventKind::ScrollDown => {
                if mouse.row >= main_chunks[1].y
                    && mouse.row < main_chunks[1].y + main_chunks[1].height
                    && mouse.column >= main_chunks[1].x
                    && mouse.column < main_chunks[1].x + main_chunks[1].width
                {
                    *self.chat.active_scroll_offset_mut() =
                        self.chat.active_scroll_offset().saturating_sub(SCROLL_STEP);
                    result.request_redraw(RedrawPriority::Immediate);
                } else if mouse.row >= main_chunks[2].y
                    && mouse.row < main_chunks[2].y + main_chunks[2].height
                    && mouse.column >= main_chunks[2].x
                    && mouse.column < main_chunks[2].x + main_chunks[2].width
                {
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_add(SCROLL_STEP);
                    result.request_redraw(RedrawPriority::Immediate);
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
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            _ => {}
        }
        result
    }

    pub fn handle_input(&mut self, key: KeyEvent) -> UpdateResult {
        let mut result = UpdateResult::new();

        if let Some(confirmation_result) = self.handle_local_confirmation_input(key) {
            return confirmation_result;
        }

        if let Some(confirmation_result) = self.handle_confirmation_input(key) {
            return confirmation_result;
        }

        let main_chunks = self.main_chunks();
        let chat_area = main_chunks[1];

        if self.view.focused_pane == FocusedPane::Chat {
            match key.code {
                KeyCode::Char('1') => {
                    if self.chat.active_view != ChatView::Everything {
                        self.chat.active_view = ChatView::Everything;
                        self.chat.update_layout(chat_area);
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                    return result;
                }
                KeyCode::Char('2') => {
                    if self.chat.active_view != ChatView::Chat {
                        self.chat.active_view = ChatView::Chat;
                        self.chat.update_layout(chat_area);
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                    return result;
                }
                _ => {}
            }
        }

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

        if self.view.context_view == ContextView::Logopolis
            && self.view.focused_pane == FocusedPane::Context
        {
            let mut handled = false;
            let paddle_delta = match key.code {
                KeyCode::Left => Some(-0.05),
                KeyCode::Right => Some(0.05),
                KeyCode::Char('a') | KeyCode::Char('A') => Some(-0.05),
                KeyCode::Char('d') | KeyCode::Char('D') => Some(0.05),
                _ => None,
            };

            if let Some(delta) = paddle_delta
                && let Some(game) = domains::logopolis_state_mut(self)
            {
                handled = game.nudge_player_paddle(delta);
            }

            if handled {
                result.request_redraw(RedrawPriority::Immediate);
                return result;
            }
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
                let delta = if key
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL)
                    || key.code == KeyCode::BackTab
                {
                    -1
                } else {
                    1
                };
                result
                    .actions
                    .push(AppUiAction::CycleFocusedPane { delta }.into());
            }
            KeyCode::Esc => {
                if self.view.context_view == ContextView::Logopolis
                    && self.view.focused_pane == FocusedPane::Context
                {
                    result.actions.push(
                        AppUiAction::ChangeContextView {
                            view: ContextView::Default,
                        }
                        .into(),
                    );
                    return result;
                }

                if self.view.focused_pane == FocusedPane::Input {
                    result.actions.push(AppUiAction::ExitInputMode.into());
                } else if self.view.active_interaction.is_some()
                    && let Some(action_result) = self.handle_action(AppAction::CancelInteraction)
                {
                    result.merge(action_result);
                }
            }
            KeyCode::Enter => {
                if self.view.focused_pane == FocusedPane::Input {
                    let command = self.chat_input.input.take_text();
                    if command.is_empty() {
                        result.actions.push(AppUiAction::ExitInputMode.into());
                        return result;
                    }
                    self.chat_input.record_history_submission(&command);
                    if command.starts_with('/') {
                        return self.handle_slash_command(&command);
                    }
                    if let Some(emote) = command.strip_prefix(':') {
                        result.actions.push(
                            AppUiAction::FinishInputCommandSubmission {
                                command: command.clone(),
                            }
                            .into(),
                        );
                        result.actions.push(AppAction::Emote {
                            message: emote.to_string(),
                        });
                        return result;
                    }
                    if let Some(token) = normalize_soul_emote_token(&command) {
                        result.actions.push(
                            AppUiAction::FinishInputCommandSubmission {
                                command: command.clone(),
                            }
                            .into(),
                        );
                        result.actions.push(AppAction::SoulEmote {
                            token: token.to_string(),
                        });
                        return result;
                    }
                    result.actions.push(
                        AppUiAction::FinishInputCommandSubmission {
                            command: command.clone(),
                        }
                        .into(),
                    );
                    result.commands.push(ClientCommand::Talk(command));
                    return result;
                } else {
                    result.actions.push(AppUiAction::EnterInputMode.into());
                    return result;
                }
            }
            KeyCode::Backspace | KeyCode::Delete
                if self.view.focused_pane == FocusedPane::Input
                    && self.chat_input.input.apply_key(key) =>
            {
                result.request_redraw(RedrawPriority::Immediate);
            }
            KeyCode::Left | KeyCode::Right => {
                if self.view.focused_pane == FocusedPane::Input {
                    if self.chat_input.input.apply_key(key) {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                } else {
                    let delta = if key.code == KeyCode::Right {
                        0.1
                    } else {
                        -0.1
                    };

                    let current_heading = self.data.runtime_heading().unwrap_or(0.0);
                    let mut new_heading = current_heading + delta;
                    let two_pi = 2.0 * std::f32::consts::PI;
                    new_heading = (new_heading % two_pi + two_pi) % two_pi;
                    result.actions.push(AppAction::SnapHeading {
                        heading: new_heading,
                    });
                    result.request_redraw(RedrawPriority::Immediate);
                }
            }
            KeyCode::Up => match self.view.focused_pane {
                FocusedPane::Input if !self.chat_input.input_history.is_empty() => {
                    self.chat_input.begin_history_navigation();
                    let idx = self
                        .chat_input
                        .history_index
                        .map(|i| i.saturating_sub(1))
                        .unwrap_or(self.chat_input.input_history.len().saturating_sub(1));
                    self.chat_input.history_index = Some(idx);
                    self.chat_input
                        .input
                        .set_text(&self.chat_input.input_history[idx]);
                    result.request_redraw(RedrawPriority::Immediate);
                }
                FocusedPane::Chat => {
                    *self.chat.active_scroll_offset_mut() =
                        self.chat.active_scroll_offset().saturating_add(1);

                    result.request_redraw(RedrawPriority::Immediate);
                }
                FocusedPane::Context => {
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_sub(1);

                    result.request_redraw(RedrawPriority::Immediate);
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
                            self.chat_input.restore_history_draft();
                        }
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                }
                FocusedPane::Chat => {
                    *self.chat.active_scroll_offset_mut() =
                        self.chat.active_scroll_offset().saturating_sub(1);
                    result.request_redraw(RedrawPriority::Immediate);
                }
                FocusedPane::Context => {
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_add(1);
                    result.request_redraw(RedrawPriority::Immediate);
                }
                _ => {}
            },
            KeyCode::PageUp => match self.view.focused_pane {
                FocusedPane::Chat => {
                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    *self.chat.active_scroll_offset_mut() =
                        self.chat.active_scroll_offset().saturating_add(step);
                    result.request_redraw(RedrawPriority::Immediate);
                }
                FocusedPane::Context => {
                    let h = main_chunks[2].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_sub(step);
                    result.request_redraw(RedrawPriority::Immediate);
                }
                _ => {}
            },
            KeyCode::PageDown => match self.view.focused_pane {
                FocusedPane::Chat => {
                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    *self.chat.active_scroll_offset_mut() =
                        self.chat.active_scroll_offset().saturating_sub(step);
                    result.request_redraw(RedrawPriority::Immediate);
                }
                FocusedPane::Context => {
                    let h = main_chunks[2].height.saturating_sub(2) as usize;
                    let step = (h / 2) + 1;
                    self.view.context_scroll_offset =
                        self.view.context_scroll_offset.saturating_add(step);
                    result.request_redraw(RedrawPriority::Immediate);
                }
                _ => {}
            },
            KeyCode::Char(c) => {
                if self.view.focused_pane == FocusedPane::Input {
                    if self.chat_input.input.apply_key(key) {
                        result.request_redraw(RedrawPriority::Immediate);
                    }
                } else if c == '`' {
                    result.actions.push(crate::types::AppAction::SetCombatMode {
                        on: !crate::pages::game::state::domains::is_in_combat_mode(self),
                    });
                    result.request_redraw(RedrawPriority::Immediate);
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
                            result.request_redraw(RedrawPriority::Immediate);
                        }
                        'h' if matches!(
                            self.data.combat_mode,
                            CombatMode::Melee | CombatMode::Missile
                        ) =>
                        {
                            result
                                .actions
                                .push(crate::types::AppAction::CycleCombatAttackHeight);
                            result.request_redraw(RedrawPriority::Immediate);
                        }
                        _ => {}
                    }
                }
            }
            KeyCode::Home => match self.view.focused_pane {
                FocusedPane::Input if self.chat_input.input.apply_key(key) => {
                    result.request_redraw(RedrawPriority::Immediate);
                }
                FocusedPane::Chat => {
                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                    *self.chat.active_scroll_offset_mut() =
                        self.chat.active_total_lines().saturating_sub(h);
                    result.request_redraw(RedrawPriority::Immediate);
                }
                FocusedPane::Context => {
                    self.view.context_scroll_offset = 0;
                    result.request_redraw(RedrawPriority::Immediate);
                }
                _ => {}
            },
            KeyCode::End => match self.view.focused_pane {
                FocusedPane::Input if self.chat_input.input.apply_key(key) => {
                    result.request_redraw(RedrawPriority::Immediate);
                }
                FocusedPane::Chat => {
                    *self.chat.active_scroll_offset_mut() = 0;
                    result.request_redraw(RedrawPriority::Immediate);
                }
                FocusedPane::Context => {
                    self.view.context_scroll_offset =
                        domains::context_buffer_len(self).saturating_sub(1);
                    result.request_redraw(RedrawPriority::Immediate);
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
            result.request_redraw(RedrawPriority::Immediate);
        }

        Some(result)
    }

    fn handle_local_confirmation_input(&mut self, key: KeyEvent) -> Option<UpdateResult> {
        self.view.local_confirmation.as_ref()?;

        match key.code {
            KeyCode::Enter => {
                let mut result = UpdateResult::new();
                result
                    .actions
                    .push(AppUiAction::ConfirmLocalConfirmation.into());
                Some(result)
            }
            KeyCode::Esc => {
                let mut result = UpdateResult::new();
                result
                    .actions
                    .push(AppUiAction::DismissLocalConfirmation.into());
                Some(result)
            }
            _ => Some(UpdateResult::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pages::game::GameState;
    use crate::types::{AppAction, AppUiAction, FocusedPane, Interaction};
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
            Some(AppAction::SetCombatMode { on: true })
        ));
        assert!(matches!(
            result.actions.get(1),
            Some(AppAction::UiAction {
                action: AppUiAction::FinishInputCommandSubmission { command }
            }) if command == "/combat"
        ));
        assert_eq!(state.view.focused_pane, FocusedPane::Input);
        assert!(state.chat_input.input.is_empty());
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
            Some(AppAction::SetCombatMode { on: false })
        ));
        assert!(matches!(
            result.actions.get(1),
            Some(AppAction::UiAction {
                action: AppUiAction::FinishInputCommandSubmission { command }
            }) if command == "/combat"
        ));
        assert_eq!(state.view.focused_pane, FocusedPane::Input);
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

        assert!(result.redraw_requested());
        assert!(matches!(
            result.actions.first(),
            Some(AppAction::SnapHeading { .. })
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
            Some(AppAction::SetCombatMode { on: true })
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
        state.data.combat_runtime.issue_state =
            crate::pages::game::combat::CombatIssueState::InFlight;
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));

        assert!(
            result
                .commands
                .iter()
                .any(|command| matches!(command, ClientCommand::CancelAttack))
        );
        assert_eq!(state.view.active_interaction, None);
        assert_ne!(
            state.data.combat_runtime.issue_state,
            crate::pages::game::combat::CombatIssueState::InFlight
        );
    }

    #[test]
    fn escape_clears_logopolis_context_view_when_focused() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.context_view = ContextView::Logopolis;
        state.view.focused_pane = FocusedPane::Context;
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(matches!(
            result.actions.first(),
            Some(AppAction::UiAction {
                action: AppUiAction::ChangeContextView {
                    view: ContextView::Default
                }
            })
        ));
        assert_eq!(state.view.context_view, ContextView::Logopolis);
        assert_eq!(state.view.focused_pane, FocusedPane::Context);
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
        assert!(result.redraw_requested());
        assert!(state.view.active_confirmation.is_none());
        assert_eq!(state.chat_input.input.text(), "/options list");
    }

    #[test]
    fn enter_accepts_unswear_confirmation_and_emits_unswear_action() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x50000042);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("/unswear");
        state.view.local_confirmation = Some(crate::types::LocalConfirmation {
            title: " Break Allegiance Confirmation ".to_string(),
            text: "Break allegiance with Bestie?".to_string(),
            action: AppAction::Unswear {
                target: target_guid,
            },
        });
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.actions.first(),
            Some(AppAction::UiAction {
                action: AppUiAction::ConfirmLocalConfirmation
            })
        ));
        assert!(result.commands.is_empty());
        assert!(!result.redraw_requested());
        assert!(state.view.local_confirmation.is_some());
        assert_eq!(state.chat_input.input.text(), "/unswear");
    }

    #[test]
    fn escape_clears_unswear_confirmation_without_dispatching() {
        let player_guid = Guid(0x50000001);
        let target_guid = Guid(0x50000042);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Dashboard;
        state.view.local_confirmation = Some(crate::types::LocalConfirmation {
            title: " Break Allegiance Confirmation ".to_string(),
            text: "Break allegiance with Bestie?".to_string(),
            action: AppAction::Unswear {
                target: target_guid,
            },
        });
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(matches!(
            result.actions.first(),
            Some(AppAction::UiAction {
                action: AppUiAction::DismissLocalConfirmation
            })
        ));
        assert!(!result.redraw_requested());
        assert!(state.view.local_confirmation.is_some());
    }

    #[test]
    fn enter_submits_colon_prefixed_input_as_emote_without_required_space() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text(":waves");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(matches!(
            result.actions.iter().find(|action| matches!(action, AppAction::Emote { .. })),
            Some(AppAction::Emote { message }) if message == "waves"
        ));
    }

    #[test]
    fn enter_preserves_everything_after_colon_as_emote_content() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text(": hello there");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(matches!(
            result.actions.iter().find(|action| matches!(action, AppAction::Emote { .. })),
            Some(AppAction::Emote { message }) if message == " hello there"
        ));
    }

    #[test]
    fn enter_submits_star_wrapped_input_as_soul_emote() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("*wave*");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(result.commands.is_empty());
        assert!(matches!(
            result.actions.iter().find(|action| matches!(action, AppAction::SoulEmote { .. })),
            Some(AppAction::SoulEmote { token }) if token == "wave"
        ));
    }

    #[test]
    fn enter_rejects_empty_wrapped_soul_emote_token() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        state.view.focused_pane = FocusedPane::Input;
        state.chat_input.input.set_text("**");
        state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

        let result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

        assert!(matches!(
            result.commands.as_slice(),
            [ClientCommand::Talk(message)] if message == "**"
        ));
        assert!(
            result
                .actions
                .iter()
                .all(|action| !matches!(action, AppAction::SoulEmote { .. }))
        );
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
        assert!(!result.redraw_requested());
        assert_eq!(state.chat_input.input.text(), "hello");
        assert!(state.view.active_confirmation.is_some());
    }
}
