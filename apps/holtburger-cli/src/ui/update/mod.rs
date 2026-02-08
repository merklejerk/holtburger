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
            AppAction::KeyPress(key, width, height, main_chunks) => {
                commands.extend(self.handle_key_press(key, width, height, main_chunks));
            }
            AppAction::Mouse(mouse, chunks, main_chunks) => {
                commands.extend(self.handle_mouse_event(mouse, chunks, main_chunks));
            }
            AppAction::ReceivedEvent(event) => {
                self.handle_received_event(event);
            }
        }
        commands
    }

    fn update_tick(&mut self, elapsed: f64) -> Vec<ClientCommand> {
        let mut commands = Vec::new();
        let now = std::time::Instant::now();

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
