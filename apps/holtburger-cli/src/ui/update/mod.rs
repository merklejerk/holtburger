pub mod input;
pub mod world;

use holtburger_core::ClientCommand;
use crate::ui::action::AppAction;
use crate::ui::model::AppState;

impl AppState {
    pub fn handle_action(&mut self, action: AppAction) -> Vec<ClientCommand> {
        let mut commands = Vec::new();
        match action {
            AppAction::Tick(elapsed) => self.update_tick(elapsed),
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

    fn update_tick(&mut self, elapsed: f64) {
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
    }
}
