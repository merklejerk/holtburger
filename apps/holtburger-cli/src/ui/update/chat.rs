use crate::ui::state::AppState;
use crate::ui::state::ChatMessageKind;
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
                self.chat.log(kind, msg);
            }
            WireEvent::ServerMessage(message) => {
                self.chat.log(ChatMessageKind::System, message);
            }
            WireEvent::Chat { sender, message } => {
                self.chat.log(ChatMessageKind::Chat, format!("{}: {}", sender, message));
            }
            WireEvent::Emote { sender, text } => {
                self.chat.log(ChatMessageKind::Emote, format!("{} {}", sender, text));
            }
            WireEvent::PingResponse => {
                self.chat.log(ChatMessageKind::System, "Pong!".to_string());
            }
            _ => {}
        }
    }
}
