use crate::ui::state::AppState;
use crate::ui::state::ChatMessageKind;
use holtburger_core::ClientViewEvent;
use holtburger_protocol::messages::ChatMessageType;

impl AppState {
    pub(super) fn handle_chat_event(&mut self, event: &ClientViewEvent) {
        match event {
            ClientViewEvent::LogMessage(msg) => {
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
                self.chat.log(kind, msg.clone());
            }
            ClientViewEvent::ServerMessage { message, chat_type } => {
                let kind = match ChatMessageType::from_repr(*chat_type) {
                    Some(ChatMessageType::Error) => ChatMessageKind::Error,
                    Some(ChatMessageType::Warning) => ChatMessageKind::Warning,
                    Some(ChatMessageType::Broadcast)
                    | Some(ChatMessageType::GeneralBroadcast)
                    | Some(ChatMessageType::AdminBroadcast)
                    | Some(ChatMessageType::WorldBroadcast)
                    | Some(ChatMessageType::DirectSpeech) => ChatMessageKind::Info,
                    _ => ChatMessageKind::System,
                };
                self.chat.log(kind, message.clone());
            }
            ClientViewEvent::Chat { sender, message } => {
                self.chat
                    .log(ChatMessageKind::Chat, format!("{}: {}", sender, message));
            }
            ClientViewEvent::Emote { sender, text } => {
                self.chat
                    .log(ChatMessageKind::Emote, format!("{} {}", sender, text));
            }
            ClientViewEvent::PingResponse => {
                self.chat.log(ChatMessageKind::System, "Pong!".to_string());
            }
            ClientViewEvent::BootAccount(reason) => {
                self.chat.log(
                    ChatMessageKind::Error,
                    format!("Booted from server: {}", reason),
                );
            }
            _ => {}
        }
    }
}
