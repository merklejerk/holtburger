use crate::ui::state::AppState;
use crate::ui::widgets::panels::chat::ChatMessageKind;
use holtburger_core::ClientViewEvent;

impl AppState {
    pub(super) fn handle_navigation_event(&mut self, event: ClientViewEvent) {
        match event {
            ClientViewEvent::NoClipUpdated { enabled } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.noclip = enabled;
                    let status = if enabled { "ENABLED" } else { "DISABLED" };
                    self.log_chat(
                        ChatMessageKind::System,
                        format!(">> NoClip is now {}", status),
                    );
                }
            }
            ClientViewEvent::ServerTimeUpdated { time } => {
                if let Some(game) = self.game_option_mut() {
                    game.data.server_time = Some((time, std::time::Instant::now()));
                }
            }
            _ => {}
        }
    }
}
