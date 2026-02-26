use crate::ui::state::AppState;
use crate::ui::state::ChatMessageKind;
use holtburger_core::WireEvent;
use holtburger_core::errors::format_weenie_error;
use holtburger_protocol::messages::ChatMessageType;

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
            WireEvent::ServerMessage { message, chat_type } => {
                let kind = match ChatMessageType::from_repr(chat_type) {
                    Some(ChatMessageType::Error) => ChatMessageKind::Error,
                    Some(ChatMessageType::Warning) => ChatMessageKind::Warning,
                    Some(ChatMessageType::Broadcast)
                    | Some(ChatMessageType::GeneralBroadcast)
                    | Some(ChatMessageType::AdminBroadcast)
                    | Some(ChatMessageType::WorldBroadcast)
                    | Some(ChatMessageType::DirectSpeech) => ChatMessageKind::Info,
                    _ => ChatMessageKind::System,
                };
                self.chat.log(kind, message);
            }
            WireEvent::Chat { sender, message } => {
                self.chat
                    .log(ChatMessageKind::Chat, format!("{}: {}", sender, message));
            }
            WireEvent::Emote { sender, text } => {
                self.chat
                    .log(ChatMessageKind::Emote, format!("{} {}", sender, text));
            }
            WireEvent::PingResponse => {
                self.chat.log(ChatMessageKind::System, "Pong!".to_string());
            }
            WireEvent::CharacterError(err) => {
                self.chat.log(
                    ChatMessageKind::Error,
                    format!("Character Error: {:?}", err),
                );
            }
            WireEvent::ClientError(msg) => {
                self.chat
                    .log(ChatMessageKind::Error, format!("Client Error: {}", msg));
            }
            WireEvent::WeenieError { error, parameter } => {
                let msg = format_weenie_error(error, parameter.as_deref());
                self.chat.log(ChatMessageKind::Error, msg);
            }
            WireEvent::InventoryServerSaveFailed {
                item_guid: _,
                error,
            } => {
                let msg = format_weenie_error(error, None);
                self.chat.log(ChatMessageKind::Error, msg);
            }
            WireEvent::BootAccount(reason) => {
                self.chat.log(
                    ChatMessageKind::Error,
                    format!("Booted from server: {}", reason),
                );
            }
            _ => {}
        }
    }
}
