pub mod client;
pub mod combat;
pub mod effect;
pub mod input;
pub mod inventory;
pub mod navigation;
pub mod world;

use crate::ui::layout::NET_PULSE_HISTORY_SIZE;
use crate::ui::state::AppState;
use crate::ui::state::ChatMessageKind;
use crate::ui::types::AppAction;
use crate::ui::widgets::panels::modal::Modal;
use holtburger_core::client::types::ClientCommand;

pub use effect::{UpdateResult};

impl AppState {
    pub fn handle_action(&mut self, action: AppAction) -> UpdateResult {
        let mut result = UpdateResult::new();
        match action {
            AppAction::Tick(elapsed) => {
                result = self.update_tick(elapsed);
            }
            AppAction::KeyPress(key, width, height, main_chunks, dynamic_chunk) => {
                result = self.handle_key_press(key, width, height, main_chunks, dynamic_chunk);
                result.needs_redraw = true; // Input always redraws
            }
            AppAction::Mouse(mouse, chunks, main_chunks, dynamic_chunk) => {
                result = self.handle_mouse_event(mouse, chunks, main_chunks, dynamic_chunk);
                result.needs_redraw = true;
            }
            AppAction::ReceivedViewEvent(event) => {
                let should_redraw =
                    !matches!(event, holtburger_core::ClientViewEvent::LogMessage(_));
                self.handle_client_view_event(event);
                if should_redraw {
                    self.refresh_context_buffer();
                }
                result.needs_redraw = should_redraw;
            }
        }

        // Track bytes_out for commands
        for _cmd in &result.commands {
            // Very rough estimate: ~64 bytes per command packet
            // In a real world we'd track the encoded length, but this is for rizz
            self.net_stats.bytes_out += 64;
        }

        result
    }

    pub fn handle_ui_message(&mut self, msg: crate::ui::UiMessage) -> UpdateResult {
        let mut result = UpdateResult::new();
        match msg {
            crate::ui::UiMessage::BeginInteraction(interaction) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.active_interaction = Some(interaction);
                }
                result.needs_redraw = true;
            }
            crate::ui::UiMessage::ConfirmInteractionTarget(_guid) => {
                // We will implement this as we phase out UIEffect
            }
            crate::ui::UiMessage::ConfirmInteractionSplit(_guid, _amount) => {
                // We will implement this as we phase out UIEffect
            }
            crate::ui::UiMessage::ConfirmInteractionText(_text) => {
                // We will implement this as we phase out UIEffect
            }
            crate::ui::UiMessage::CancelInteraction => {
                if let Some(game) = self.game_option_mut() {
                    game.view.active_interaction = None;
                }
                result.needs_redraw = true;
            }
            crate::ui::UiMessage::AddLog(kind, text) => {
                self.chat.log(kind, text);
                result.needs_redraw = true;
            }
            crate::ui::UiMessage::SendCommands(cmds) => {
                result.commands.extend(cmds);
            }
            crate::ui::UiMessage::ChangeContextView(view) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.context_view = view;
                    game.view.focused_pane = crate::ui::FocusedPane::Context;
                    result.needs_redraw = true;
                    self.refresh_context_buffer();
                }
            }
            crate::ui::UiMessage::RequestDebugContext(guid) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.current_debug_guid = guid;
                    game.view.context_view = crate::ui::ContextView::Custom;
                    game.view.focused_pane = crate::ui::FocusedPane::Context;
                    result.needs_redraw = true;
                    self.refresh_context_buffer();
                }
            }
            crate::ui::UiMessage::ClearVendor => {
                if let Some(game) = self.game_option_mut() {
                    game.data.vendor = None;
                }
            }
            crate::ui::UiMessage::DisplayClientInfo => {
                self.display_client_info();
            }
        }
        result
    }

    fn update_tick(&mut self, elapsed: f64) -> UpdateResult {
        let mut result = UpdateResult::new();
        let now = std::time::Instant::now();

        // Update net stats
        let last_update = self.net_stats.last_update.get_or_insert(now);
        if now.duration_since(*last_update).as_secs() >= 1 {
            self.net_stats.history_in.push(self.net_stats.bytes_in);
            self.net_stats.bytes_in = 0;
            if self.net_stats.history_in.len() > NET_PULSE_HISTORY_SIZE {
                self.net_stats.history_in.remove(0);
            }

            self.net_stats.history_out.push(self.net_stats.bytes_out);
            self.net_stats.bytes_out = 0;
            if self.net_stats.history_out.len() > NET_PULSE_HISTORY_SIZE {
                self.net_stats.history_out.remove(0);
            }

            self.net_stats.last_update = Some(now);
            result.needs_redraw = true;
        }

        if self.logon_retry.tick(now) {
            self.chat.log(
                ChatMessageKind::System,
                format!(
                    "* Retrying login (attempt {}/{})...",
                    self.logon_retry.attempts, self.logon_retry.max_attempts
                ),
            );
            result
                .commands
                .push(ClientCommand::Login(self.account_password.clone()));
            result.needs_redraw = true;
        }
        if self.enter_retry.tick(now) {
            self.chat.log(
                ChatMessageKind::System,
                format!(
                    "* Retrying enter world (attempt {}/{})...",
                    self.enter_retry.attempts, self.enter_retry.max_attempts
                ),
            );
            result.commands.push(ClientCommand::EnterWorld);
            result.needs_redraw = true;
        }

        // Manage Modal State for Retries
        if self.logon_retry.active {
            if let Some(next_time) = self.logon_retry.next_time {
                if next_time > now {
                    self.modal = Some(Modal::Retry {
                        message: "Failed to login.".to_string(),
                        end_time: next_time,
                    });
                    result.needs_redraw = true;
                } else if let Some(Modal::Retry { .. }) = self.modal {
                    // Retry is active but the next_time has passed; clear any stale retry modal
                    self.modal = None;
                    result.needs_redraw = true;
                }
            }
        } else if self.enter_retry.active {
            if let Some(next_time) = self.enter_retry.next_time {
                if next_time > now {
                    self.modal = Some(Modal::Retry {
                        message: "Failed to enter world.".to_string(),
                        end_time: next_time,
                    });
                    result.needs_redraw = true;
                } else if let Some(Modal::Retry { .. }) = self.modal {
                    // Retry is active but the next_time has passed; clear any stale retry modal
                    self.modal = None;
                    result.needs_redraw = true;
                }
            }
        } else {
            // If we are showing a retry modal, but retry is no longer active (attempt underway), clear it
            if let Some(Modal::Retry { .. }) = self.modal {
                self.modal = None;
                result.needs_redraw = true;
            }
        }

        // GameState logic
        let dashboard_count = self.dashboard_item_count();
        if let Some(game) = self.game_option_mut() {
            // Enforce dashboard index bounds
            if game.dashboard.selected_index() >= dashboard_count && dashboard_count > 0 {
                game.dashboard.set_selected_index(dashboard_count - 1);
                result.needs_redraw = true;
            } else if dashboard_count == 0 && game.dashboard.selected_index() != 0 {
                game.dashboard.set_selected_index(0);
                result.needs_redraw = true;
            }

            // Proactive enchantment purge
            let old_count = game.data.player_enchantments.len();
            game.data.player_enchantments.retain(|e| {
                if e.duration < 0.0 {
                    return true;
                }
                let expires_at = e.start_time + e.duration;
                expires_at > 0.0
            });
            if game.data.player_enchantments.len() != old_count {
                result.needs_redraw = true;
            }

            // Update enchantment timers locally
            for enchant in &mut game.data.player_enchantments {
                if enchant.duration >= 0.0 {
                    enchant.start_time -= elapsed;
                }
            }
        }

        result
    }
}
