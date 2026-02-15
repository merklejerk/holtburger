pub mod input;
pub mod world;

use crate::ui::action::AppAction;
use crate::ui::model::AppState;
use crate::ui::types::ChatMessageKind;
use holtburger_core::ClientCommand;

impl AppState {
    pub fn handle_action(&mut self, action: AppAction) -> Vec<ClientCommand> {
        let mut commands = Vec::new();
        match action {
            AppAction::Tick(elapsed) => {
                commands.extend(self.update_tick(elapsed));
            }
            AppAction::KeyPress(key, width, height, main_chunks, dynamic_chunk) => {
                commands.extend(self.handle_key_press(
                    key,
                    width,
                    height,
                    main_chunks,
                    dynamic_chunk,
                ));
            }
            AppAction::Mouse(mouse, chunks, main_chunks, dynamic_chunk) => {
                commands.extend(self.handle_mouse_event(mouse, chunks, main_chunks, dynamic_chunk));
            }
            AppAction::ReceivedEvent(event) => {
                self.handle_received_event(event);
                self.refresh_context_buffer();
            }
            AppAction::ReceivedStateEvent(event) => {
                self.handle_received_state_event(event);
                self.refresh_context_buffer();
            }
            AppAction::ReceivedViewEvent(event) => {
                self.handle_client_view_event(event);
                self.refresh_context_buffer();
            }
        }

        // Track bytes_out for commands
        for _cmd in &commands {
            // Very rough estimate: ~64 bytes per command packet
            // In a real world we'd track the encoded length, but this is for rizz
            self.net_stats.bytes_out += 64;
        }

        commands
    }

    fn update_tick(&mut self, elapsed: f64) -> Vec<ClientCommand> {
        let mut commands = Vec::new();
        let now = std::time::Instant::now();

        // Update net stats
        let last_update = self.net_stats.last_update.get_or_insert(now);
        if now.duration_since(*last_update).as_secs() >= 1 {
            self.net_stats.history_in.push(self.net_stats.bytes_in);
            self.net_stats.bytes_in = 0;
            if self.net_stats.history_in.len() > 64 {
                self.net_stats.history_in.remove(0);
            }

            self.net_stats.history_out.push(self.net_stats.bytes_out);
            self.net_stats.bytes_out = 0;
            if self.net_stats.history_out.len() > 64 {
                self.net_stats.history_out.remove(0);
            }

            self.net_stats.last_update = Some(now);
        }

        if self.logon_retry.tick(now) {
            self.log_chat(
                ChatMessageKind::System,
                format!(
                    "* Retrying login (attempt {}/{})...",
                    self.logon_retry.attempts, self.logon_retry.max_attempts
                ),
            );
            commands.push(ClientCommand::Login(self.account_password.clone()));
        }
        if self.enter_retry.tick(now) {
            self.log_chat(
                ChatMessageKind::System,
                format!(
                    "* Retrying enter world (attempt {}/{})...",
                    self.enter_retry.attempts, self.enter_retry.max_attempts
                ),
            );
            commands.push(ClientCommand::EnterWorld);
        }

        // Enforce dashboard index bounds
        let dashboard_count = self.dashboard_item_count();
        if self.selected_dashboard_index >= dashboard_count && dashboard_count > 0 {
            self.selected_dashboard_index = dashboard_count - 1;
        } else if dashboard_count == 0 {
            self.selected_dashboard_index = 0;
        }

        // Proactive enchantment purge
        self.player_enchantments.retain(|e| {
            if e.duration < 0.0 {
                return true;
            }
            let expires_at = e.start_time + e.duration;
            expires_at > 0.0
        });

        // Update enchantment timers locally
        for enchant in &mut self.player_enchantments {
            if enchant.duration >= 0.0 {
                enchant.start_time -= elapsed;
            }
        }
        commands
    }
}
