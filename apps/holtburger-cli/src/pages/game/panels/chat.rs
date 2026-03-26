use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem};

use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::properties::DamageType;
use holtburger_core::client::types::{
    ChatChannelInfo, ChatChannelKind, ChatChannelSource, CombatFeedback,
};
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::combat::{AttackConditions, DamageLocation};
use holtburger_world::FellowshipActivity;
use std::fs::File;
use std::io::Write;
use std::sync::Mutex;

use crate::theme::{pane_block, pane_title_style};
use crate::types::ChatMessageKind;
use crate::utils::wrap_text;

pub const CHAT_HISTORY_WINDOW_SIZE: usize = 2000;
const MAX_CHAT: usize = 4000;

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub kind: ChatMessageKind,
    pub text: String,
    pub channel: Option<ChatChannelInfo>,
}

pub struct ChatState {
    pub messages: Vec<ChatMessage>,
    pub chat_log: Option<Mutex<File>>,
    pub wrapped_chat_cache: Vec<Vec<(String, Color)>>,
    pub last_chat_width: usize,
    pub scroll_offset: usize,
    pub total_lines: usize,
    pub last_incoming_tell_sender: Option<String>,
}

impl Default for ChatState {
    fn default() -> Self {
        Self {
            messages: Vec::with_capacity(4000),
            chat_log: None,
            wrapped_chat_cache: Vec::with_capacity(4000),
            last_chat_width: 0,
            scroll_offset: 0,
            total_lines: 0,
            last_incoming_tell_sender: None,
        }
    }
}

impl ChatState {
    pub fn new(chat_log: Option<Mutex<File>>) -> Self {
        Self {
            chat_log,
            ..Default::default()
        }
    }

    pub fn handle_event(
        &mut self,
        event: holtburger_core::ClientViewEvent,
        local_player_name: Option<&str>,
    ) {
        use holtburger_core::ClientViewEvent;
        use holtburger_protocol::messages::ChatMessageType;
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
                self.log(kind, msg);
            }
            ClientViewEvent::ServerMessage { message, chat_type } => {
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
                self.log(kind, message);
            }
            ClientViewEvent::Chat { sender, message } => {
                self.log(ChatMessageKind::Chat, format!("{}: {}", sender, message));
            }
            ClientViewEvent::ChannelMessage {
                channel,
                sender,
                message,
            } => {
                self.log_channel(
                    ChatMessageKind::Chat,
                    channel,
                    format_channel_message(channel, &sender, &message, local_player_name),
                );
            }
            ClientViewEvent::FellowshipActivity { activity } => {
                self.log(
                    ChatMessageKind::System,
                    format_fellowship_activity(&activity),
                );
            }
            ClientViewEvent::Tell { sender, message } => {
                self.last_incoming_tell_sender = Some(sender.clone());
                self.log(
                    ChatMessageKind::Tell,
                    format!("{} tells you: {}", sender, message),
                );
            }
            ClientViewEvent::Emote { sender, text } => {
                self.log(ChatMessageKind::Emote, format!("{} {}", sender, text));
            }
            ClientViewEvent::CombatFeedback(feedback) => {
                self.log_combat_feedback(&feedback);
            }
            ClientViewEvent::PingResponse
            | ClientViewEvent::NetPulse { .. }
            | ClientViewEvent::Disconnected => {}
            ClientViewEvent::BootAccount(reason) => {
                let message = if reason.trim().is_empty() {
                    "Disconnected: Booted from server.".to_string()
                } else {
                    format!("Disconnected: Booted from server: {}", reason)
                };
                self.log(ChatMessageKind::Error, message);
            }
            _ => {}
        }
    }

    pub fn log(&mut self, kind: ChatMessageKind, text: String) {
        self.log_with_channel(kind, None, text);
    }

    pub fn log_channel(&mut self, kind: ChatMessageKind, channel: ChatChannelInfo, text: String) {
        self.log_with_channel(kind, Some(channel), text);
    }

    fn log_with_channel(
        &mut self,
        kind: ChatMessageKind,
        channel: Option<ChatChannelInfo>,
        text: String,
    ) {
        if let Some(log_mutex) = &self.chat_log
            && let Ok(mut file) = log_mutex.lock()
        {
            let _ = writeln!(file, "{}", text);
            let _ = file.flush();
        }
        self.messages.push(ChatMessage {
            kind,
            text,
            channel,
        });

        if self.messages.len() > MAX_CHAT {
            let drop_count = self.messages.len() - MAX_CHAT;
            self.messages.drain(0..drop_count);
            if self.wrapped_chat_cache.len() > drop_count {
                self.wrapped_chat_cache.drain(0..drop_count);
            } else {
                self.wrapped_chat_cache.clear();
            }
        }
    }

    fn log_combat_feedback(&mut self, feedback: &CombatFeedback) {
        match feedback {
            CombatFeedback::AttackDone { error } => {
                if *error == WeenieError::None {
                    self.log(
                        ChatMessageKind::Debug,
                        "Attack sequence finished.".to_string(),
                    );
                } else {
                    self.log(
                        ChatMessageKind::Warning,
                        format!("Attack sequence finished with {:?}.", error),
                    );
                }
            }
            CombatFeedback::AttackCommenced => {
                self.log(
                    ChatMessageKind::Debug,
                    "Attack sequence started.".to_string(),
                );
            }
            CombatFeedback::AttackerNotification {
                defender_name,
                damage_type,
                health_percent,
                damage,
                critical_hit,
                attack_conditions,
            } => {
                self.log(
                    ChatMessageKind::Info,
                    format!(
                        "You hit {} for {} {} damage ({}).{}{}",
                        defender_name,
                        damage,
                        format_damage_type(*damage_type),
                        format_percent(*health_percent),
                        if *critical_hit { " Critical hit." } else { "" },
                        format_attack_conditions_suffix(*attack_conditions),
                    ),
                );
            }
            CombatFeedback::DefenderNotification {
                attacker_name,
                damage_type,
                health_percent,
                damage,
                damage_location,
                critical_hit,
                attack_conditions,
            } => {
                self.log(
                    ChatMessageKind::Warning,
                    format!(
                        "{} hit you for {} {} damage to your {} ({}).{}{}",
                        attacker_name,
                        damage,
                        format_damage_type(*damage_type),
                        format_damage_location(*damage_location),
                        format_percent(*health_percent),
                        if *critical_hit { " Critical hit." } else { "" },
                        format_attack_conditions_suffix(*attack_conditions),
                    ),
                );
            }
            CombatFeedback::EvasionAttackerNotification { defender_name } => {
                self.log(
                    ChatMessageKind::Info,
                    format!("{} evaded your attack.", defender_name),
                );
            }
            CombatFeedback::EvasionDefenderNotification { attacker_name } => {
                self.log(
                    ChatMessageKind::Info,
                    format!("You evaded {}'s attack.", attacker_name),
                );
            }
            CombatFeedback::VictimNotification { death_message } => {
                self.log(ChatMessageKind::Error, death_message.clone());
            }
            CombatFeedback::KillerNotification { death_message } => {
                self.log(ChatMessageKind::Info, death_message.clone());
            }
        }
    }

    pub fn update_layout(&mut self, area: Rect) {
        let width = area.width.saturating_sub(2) as usize;
        let height = area.height.saturating_sub(2) as usize;

        let m_len = self.messages.len();
        let window_size = CHAT_HISTORY_WINDOW_SIZE;

        // Guard: Ensure the cache is not longer than the current number of messages (stale cache fix)
        if self.wrapped_chat_cache.len() > m_len {
            self.wrapped_chat_cache.truncate(m_len);
        }

        // Check if we need to refresh the cache due to width change
        if width != self.last_chat_width {
            self.wrapped_chat_cache.clear();
            self.last_chat_width = width;
        }

        // Add new messages to the cache
        if self.wrapped_chat_cache.len() < m_len {
            let start_idx = self.wrapped_chat_cache.len();
            for m in &self.messages[start_idx..] {
                let color = match m.kind {
                    ChatMessageKind::Chat => Color::White,
                    ChatMessageKind::Tell => Color::Magenta,
                    ChatMessageKind::Emote => Color::Green,
                    ChatMessageKind::Info => Color::Cyan,
                    ChatMessageKind::System => Color::LightBlue,
                    ChatMessageKind::Error => Color::Red,
                    ChatMessageKind::Warning => Color::Yellow,
                    ChatMessageKind::Debug => Color::Indexed(242), // Greyish
                };

                let wrapped = wrap_text(&m.text, width);
                let mut msg_lines = Vec::new();
                for line in wrapped {
                    msg_lines.push((line, color));
                }
                self.wrapped_chat_cache.push(msg_lines);
            }
        }

        let old_total_lines = self.total_lines;
        let window_start = m_len.saturating_sub(window_size);
        self.total_lines = self.wrapped_chat_cache[window_start..]
            .iter()
            .map(|v| v.len())
            .sum();

        // If we were at the bottom (scroll_offset == 0) and new lines were added,
        // we stay at the bottom by default.
        // If we were scrolled up, we increment scroll_offset to maintain the relative position.
        if self.scroll_offset > 0 && self.total_lines > old_total_lines {
            self.scroll_offset += self.total_lines - old_total_lines;
        }

        self.clamp_scroll(height);
    }

    fn clamp_scroll(&mut self, height: usize) {
        let max_scroll = self.total_lines.saturating_sub(height);
        self.scroll_offset = self.scroll_offset.min(max_scroll);
    }

    pub fn handle_input(&mut self, key: KeyEvent, h: usize) -> bool {
        let mut needs_redraw = false;
        match key.code {
            KeyCode::Up => {
                self.scroll_offset = self.scroll_offset.saturating_add(1);
                self.clamp_scroll(h);
                needs_redraw = true;
            }
            KeyCode::Down => {
                self.scroll_offset = self.scroll_offset.saturating_sub(1);
                needs_redraw = true;
            }
            KeyCode::PageUp => {
                let step = (h / 2) + 1;
                self.scroll_offset = self.scroll_offset.saturating_add(step);
                self.clamp_scroll(h);
                needs_redraw = true;
            }
            KeyCode::PageDown => {
                let step = (h / 2) + 1;
                self.scroll_offset = self.scroll_offset.saturating_sub(step);
                needs_redraw = true;
            }
            _ => {}
        }
        needs_redraw
    }
}

fn channel_label(channel: ChatChannelInfo) -> String {
    match channel.kind {
        ChatChannelKind::Fellowship => "Party".to_string(),
        ChatChannelKind::Allegiance => "Guild".to_string(),
        ChatChannelKind::Vassals => "Vassals".to_string(),
        ChatChannelKind::Patron => "Patron".to_string(),
        ChatChannelKind::Monarch => "Monarch".to_string(),
        ChatChannelKind::CoVassals => "Co-Vassals".to_string(),
        ChatChannelKind::General => "General".to_string(),
        ChatChannelKind::Trade => "Trade".to_string(),
        ChatChannelKind::Lfg => "LFG".to_string(),
        ChatChannelKind::Roleplay => "Roleplay".to_string(),
        ChatChannelKind::Society => "Society".to_string(),
        ChatChannelKind::Olthoi => "Olthoi".to_string(),
        ChatChannelKind::Unknown => match channel.source {
            ChatChannelSource::Legacy { channel } => format!("Legacy 0x{:08X}", channel.raw()),
            ChatChannelSource::Turbine { room_id, .. } => {
                format!("Room 0x{:08X}", room_id.raw())
            }
        },
    }
}

fn is_self_echo_channel(channel: ChatChannelInfo) -> bool {
    matches!(
        channel.source,
        ChatChannelSource::Legacy { channel }
            if matches!(
                channel.known(),
                Some(
                    holtburger_protocol::messages::ChatChannel::Fellow
                        | holtburger_protocol::messages::ChatChannel::Vassals
                        | holtburger_protocol::messages::ChatChannel::Patron
                        | holtburger_protocol::messages::ChatChannel::Monarch
                        | holtburger_protocol::messages::ChatChannel::CoVassals
                )
            )
    )
}

fn format_channel_message(
    channel: ChatChannelInfo,
    sender: &str,
    message: &str,
    local_player_name: Option<&str>,
) -> String {
    let label = channel_label(channel);

    if sender.is_empty() {
        if is_self_echo_channel(channel) {
            let display_name = local_player_name
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .unwrap_or("You");
            format!("[{}] {}: {}", label, display_name, message)
        } else {
            format!("[{}] {}", label, message)
        }
    } else {
        format!("[{}] {}: {}", label, sender, message)
    }
}

fn format_fellowship_activity(activity: &FellowshipActivity) -> String {
    match activity {
        FellowshipActivity::YouJoined { fellowship_name } => {
            if fellowship_name.is_empty() {
                "You joined the fellowship.".to_string()
            } else {
                format!("You joined the fellowship '{}'.", fellowship_name)
            }
        }
        FellowshipActivity::MemberJoined { member_name } => {
            format!("{} joined the fellowship.", member_name)
        }
        FellowshipActivity::YouLeft => "You left the fellowship.".to_string(),
        FellowshipActivity::MemberLeft { member_name } => {
            format!("{} left the fellowship.", member_name)
        }
        FellowshipActivity::YouWereDismissed => {
            "You were dismissed from the fellowship.".to_string()
        }
        FellowshipActivity::MemberWasDismissed { member_name } => {
            format!("{} was dismissed from the fellowship.", member_name)
        }
        FellowshipActivity::FellowshipDisbanded { fellowship_name } => match fellowship_name {
            Some(name) if !name.is_empty() => format!("The fellowship '{}' was disbanded.", name),
            _ => "The fellowship was disbanded.".to_string(),
        },
    }
}

fn format_damage_type(damage_type: DamageType) -> String {
    let names: Vec<_> = damage_type.iter_display_names().collect();
    if names.is_empty() {
        "unknown".to_string()
    } else {
        names.join("/").to_ascii_lowercase()
    }
}

fn format_percent(value: f64) -> String {
    format!("{:.1}%", value * 100.0)
}

fn format_damage_location(location: DamageLocation) -> &'static str {
    match location {
        DamageLocation::Head => "head",
        DamageLocation::Chest => "chest",
        DamageLocation::Abdomen => "abdomen",
        DamageLocation::UpperArm => "upper arm",
        DamageLocation::LowerArm => "lower arm",
        DamageLocation::Hand => "hand",
        DamageLocation::UpperLeg => "upper leg",
        DamageLocation::LowerLeg => "lower leg",
        DamageLocation::Foot => "foot",
    }
}

fn format_attack_conditions_suffix(attack_conditions: AttackConditions) -> String {
    let names: Vec<_> = attack_conditions.iter_display_names().collect();
    if names.is_empty() {
        String::new()
    } else {
        format!(" [{}]", names.join(", "))
    }
}

pub fn render_chat_pane(f: &mut Frame, chat: &ChatState, is_focused: bool, area: Rect) {
    let height = area.height.saturating_sub(2) as usize;

    let m_len = chat.messages.len();
    let window_size = CHAT_HISTORY_WINDOW_SIZE;

    let window_start = m_len.saturating_sub(window_size);

    let total_lines: usize = chat.total_lines;

    let all_lines: Vec<&(String, Color)> = chat.wrapped_chat_cache[window_start..]
        .iter()
        .flat_map(|v| v.iter())
        .collect();

    let effective_scroll = chat.scroll_offset;
    let end = total_lines.saturating_sub(effective_scroll);
    let start = end.saturating_sub(height);

    let mut messages: Vec<ListItem> = all_lines[start..end]
        .iter()
        .map(|item| {
            let (text, color) = *item;
            ListItem::new(Line::from(vec![Span::styled(
                text.as_str(),
                Style::default().fg(*color),
            )]))
        })
        .collect();

    if messages.len() < height && effective_scroll == 0 {
        let pad_count = height - messages.len();
        let mut padding: Vec<ListItem> = (0..pad_count).map(|_| ListItem::new(" ")).collect();
        padding.append(&mut messages);
        messages = padding;
    }

    let chat_title = if total_lines > height {
        format!(
            " World Chat [{}/{}] ",
            total_lines.saturating_sub(effective_scroll),
            total_lines
        )
    } else {
        " World Chat ".to_string()
    };

    let chat_list = List::new(messages).block(
        pane_block(is_focused)
            .title(chat_title)
            .title_style(pane_title_style(is_focused)),
    );
    f.render_widget(chat_list, area);

    crate::components::scroll::render_scrollbar(
        f,
        area.inner(ratatui::layout::Margin {
            vertical: 1,
            horizontal: 0,
        }),
        total_lines,
        start,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_message_formats_party_self_echo_without_blank_sender() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            holtburger_core::ClientViewEvent::ChannelMessage {
                channel: ChatChannelInfo::legacy(
                    holtburger_protocol::messages::ChatChannel::Fellow.into(),
                ),
                sender: String::new(),
                message: "party check".to_string(),
            },
            Some("Player"),
        );

        let message = chat.messages.last().expect("channel message should log");
        assert_eq!(message.kind, ChatMessageKind::Chat);
        assert_eq!(
            message.channel,
            Some(ChatChannelInfo::legacy(
                holtburger_protocol::messages::ChatChannel::Fellow.into()
            ))
        );
        assert_eq!(message.text, "[Party] Player: party check");
    }

    #[test]
    fn channel_message_formats_guild_sender_with_label() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            holtburger_core::ClientViewEvent::ChannelMessage {
                channel: ChatChannelInfo::legacy(
                    holtburger_protocol::messages::ChatChannel::AllegianceBroadcast.into(),
                ),
                sender: "Bestie".to_string(),
                message: "guild check".to_string(),
            },
            Some("Player"),
        );

        let message = chat.messages.last().expect("channel message should log");
        assert_eq!(
            message.channel,
            Some(ChatChannelInfo::legacy(
                holtburger_protocol::messages::ChatChannel::AllegianceBroadcast.into()
            ))
        );
        assert_eq!(message.text, "[Guild] Bestie: guild check");
    }

    #[test]
    fn turbine_general_message_formats_with_semantic_label() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            holtburger_core::ClientViewEvent::ChannelMessage {
                channel: ChatChannelInfo::turbine(
                    holtburger_protocol::messages::TurbineChatChannel::General.into(),
                    holtburger_protocol::messages::TurbineChatType::General.into(),
                    holtburger_protocol::messages::TurbineChatDispatchType::SendToRoomByName,
                ),
                sender: "Bestie".to_string(),
                message: "world check".to_string(),
            },
            Some("Player"),
        );

        let message = chat.messages.last().expect("channel message should log");
        assert_eq!(message.text, "[General] Bestie: world check");
    }

    #[test]
    fn channel_message_self_echo_falls_back_to_you_without_local_name() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            holtburger_core::ClientViewEvent::ChannelMessage {
                channel: ChatChannelInfo::legacy(
                    holtburger_protocol::messages::ChatChannel::Fellow.into(),
                ),
                sender: String::new(),
                message: "party check".to_string(),
            },
            None,
        );

        let message = chat.messages.last().expect("channel message should log");
        assert_eq!(message.text, "[Party] You: party check");
    }

    #[test]
    fn fellowship_activity_formats_member_join() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            holtburger_core::ClientViewEvent::FellowshipActivity {
                activity: FellowshipActivity::MemberJoined {
                    member_name: "Bravo".to_string(),
                },
            },
            Some("Player"),
        );

        let message = chat
            .messages
            .last()
            .expect("fellowship activity should log");
        assert_eq!(message.kind, ChatMessageKind::System);
        assert_eq!(message.text, "Bravo joined the fellowship.");
    }

    #[test]
    fn fellowship_activity_formats_local_dismissal() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            holtburger_core::ClientViewEvent::FellowshipActivity {
                activity: FellowshipActivity::YouWereDismissed,
            },
            Some("Player"),
        );

        let message = chat
            .messages
            .last()
            .expect("fellowship activity should log");
        assert_eq!(message.text, "You were dismissed from the fellowship.");
    }

    #[test]
    fn attacker_feedback_formats_damage_summary() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            holtburger_core::ClientViewEvent::CombatFeedback(
                CombatFeedback::AttackerNotification {
                    defender_name: "Drudge".to_string(),
                    damage_type: DamageType::SLASH,
                    health_percent: 0.25,
                    damage: 37,
                    critical_hit: true,
                    attack_conditions: AttackConditions::RECKLESSNESS
                        | AttackConditions::SNEAK_ATTACK,
                },
            ),
            Some("Player"),
        );

        let message = chat.messages.last().expect("combat feedback should log");

        assert_eq!(message.kind, ChatMessageKind::Info);
        assert!(
            message
                .text
                .contains("You hit Drudge for 37 slashing damage")
        );
        assert!(message.text.contains("25.0%"));
        assert!(message.text.contains("Critical hit."));
        assert!(message.text.contains("Recklessness"));
        assert!(message.text.contains("Sneak Attack"));
    }

    #[test]
    fn defender_feedback_formats_location_summary() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            holtburger_core::ClientViewEvent::CombatFeedback(
                CombatFeedback::DefenderNotification {
                    attacker_name: "Banderling".to_string(),
                    damage_type: DamageType::FIRE,
                    health_percent: 0.125,
                    damage: 18,
                    damage_location: DamageLocation::Chest,
                    critical_hit: false,
                    attack_conditions: AttackConditions::OVERPOWER,
                },
            ),
            Some("Player"),
        );

        let message = chat.messages.last().expect("combat feedback should log");

        assert_eq!(message.kind, ChatMessageKind::Warning);
        assert!(
            message
                .text
                .contains("Banderling hit you for 18 fire damage to your chest")
        );
        assert!(message.text.contains("12.5%"));
        assert!(message.text.contains("Overpower"));
    }
}
