use crate::pages::game::layout::NET_PULSE_HISTORY_SIZE;
use crate::state::AppState;
use crate::types::{AppEvent, ChatMessageKind, Modal, UpdateResult};
use holtburger_core::client::types::ClientCommand;

impl AppState {
    pub fn handle_app_event(&mut self, action: AppEvent) -> UpdateResult {
        let mut result = match action {
            AppEvent::Tick(elapsed) => self.update_tick(elapsed),
            AppEvent::KeyPress(key) => {
                let mut res = self.handle_key_press(key);
                res.needs_redraw = true; // Input always redraws
                res
            }
            AppEvent::Mouse(mouse) => {
                let mut res = self.handle_mouse_event(mouse);
                res.needs_redraw = true;
                res
            }
            AppEvent::ReceivedViewEvent(event) => {
                let should_redraw =
                    !matches!(event, holtburger_core::ClientViewEvent::LogMessage(_));

                // Global routing must happen first for character lists/login
                let mut res = self.handle_client_view_event(event);
                res.needs_redraw = should_redraw;
                res
            }
        };

        // Standardized action draining across all event types
        self.drain_actions(&mut result);

        // Track bytes_out for commands
        for _cmd in &result.commands {
            // Very rough estimate: ~64 bytes per command packet
            // In a real world we'd track the encoded length, but this is for rizz
            self.net_stats.bytes_out += 64;
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
            self.log(
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
            self.log(
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

        // Delegate Page/GameState tick logic
        result.merge(self.page.handle_tick(elapsed));

        result
    }
}
