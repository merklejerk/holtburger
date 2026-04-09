use crate::pages::game::layout::NET_PULSE_HISTORY_SIZE;
use crate::state::AppState;
use crate::state::TickContext;
use crate::types::{AppEvent, RedrawPriority, UpdateResult};

impl AppState {
    pub fn handle_app_event(&mut self, action: AppEvent) -> UpdateResult {
        let mut result = match action {
            AppEvent::Tick(elapsed) => self.update_tick(elapsed),
            AppEvent::KeyPress(key) => {
                let mut res = self.handle_key_press(key);
                res.request_redraw(RedrawPriority::Immediate); // Input always redraws
                res
            }
            AppEvent::Mouse(mouse) => {
                let mut res = self.handle_mouse_event(mouse);
                res.request_redraw(RedrawPriority::Immediate);
                res
            }
            AppEvent::ReceivedViewEvent(event) => {
                let should_redraw =
                    !matches!(event, holtburger_core::ClientViewEvent::LogMessage(_));

                // Global routing must happen first for character lists/login
                let mut res = self.handle_client_view_event(event);
                if should_redraw && !res.redraw_requested() {
                    res.request_redraw(RedrawPriority::Immediate);
                }
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
            result.request_redraw(RedrawPriority::Immediate);
        }

        // Delegate Page/GameState tick logic
        result.merge(self.page.handle_tick(
            elapsed,
            &TickContext {
                server_time: self.server_time,
            },
        ));

        result
    }
}
