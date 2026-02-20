use crate::ui::state::AppState;
use crate::ui::widgets::panels::chat::ChatMessageKind;
use holtburger_core::WireEvent;

impl AppState {
    pub(super) fn handle_chat_event(&mut self, event: WireEvent) {
        match event {
            WireEvent::LogMessage(msg) => {
                let kind = if msg.contains("[ERROR]") {
                    ChatMessageKind::Error
                } else if msg.contains("[WARN]") {
                    ChatMessageKind::Warning
                } else if msg.contains("[INFO]") {
                    ChatMessageKind::Info
                } else if msg.contains("[DEBUG]") || msg.contains("[TRACE]") {
                    ChatMessageKind::Debug
                } else {
                    ChatMessageKind::System
                };
                self.log_chat(kind, msg);
            }
            WireEvent::ServerMessage(message) => {
                self.log_chat(ChatMessageKind::System, message);
            }
            WireEvent::Chat { sender, message } => {
                self.log_chat(ChatMessageKind::Chat, format!("{}: {}", sender, message));
            }
            WireEvent::Emote { sender, text } => {
                self.log_chat(ChatMessageKind::Emote, format!("{} {}", sender, text));
            }
            WireEvent::PingResponse => {
                self.log_chat(ChatMessageKind::System, "Pong!".to_string());
            }
            _ => {}
        }
    }
}
