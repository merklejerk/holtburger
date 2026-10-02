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
                let should_redraw = !matches!(
                    event.as_ref(),
                    holtburger_core::ClientViewEvent::LogMessage(_)
                );

                // Global routing must happen first for character lists/login
                let mut res = self.handle_client_view_event(*event);
                if should_redraw && !res.redraw_requested() {
                    res.request_redraw(RedrawPriority::Immediate);
                }
                res
            }
        };

        // Standardized action draining across all event types
        self.drain_actions(&mut result);

        result
    }

    fn update_tick(&mut self, elapsed: f64) -> UpdateResult {
        let mut result = UpdateResult::new();
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
