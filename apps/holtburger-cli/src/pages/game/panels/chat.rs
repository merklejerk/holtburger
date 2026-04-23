use ratatui::Frame;
use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem};

use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::properties::DamageType;
use holtburger_core::client::types::{
    ChatChannelInfo, ChatChannelKind, ChatChannelSource, CombatFeedback,
};
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::combat::{AttackConditions, DamageLocation};
use holtburger_protocol::messages::{ChatMessageType, ChatMessageTypeId};
use holtburger_world::FellowshipActivity;
use std::fs::File;
use std::io::Write;
use std::sync::Mutex;

use crate::theme::{pane_block, pane_title_style};
use crate::types::ChatMessageTags;
use crate::utils::wrap_text;

pub const CHAT_HISTORY_WINDOW_SIZE: usize = 500;
const MAX_CHAT: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ChatView {
    #[default]
    Everything,
    Chat,
}

impl ChatView {
    const ALL: [Self; 2] = [Self::Everything, Self::Chat];

    fn shortcut(self) -> char {
        match self {
            Self::Everything => '1',
            Self::Chat => '2',
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Everything => "Everything",
            Self::Chat => "Chat",
        }
    }

    fn allows(self, chat_tags: ChatMessageTags) -> bool {
        match self {
            Self::Everything => true,
            Self::Chat => !chat_tags.intersects(ChatMessageTags::COMBAT | ChatMessageTags::MAGIC),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub text: String,
    pub channel: Option<ChatChannelInfo>,
    pub chat_tags: ChatMessageTags,
}

pub struct ChatState {
    pub messages: Vec<ChatMessage>,
    pub chat_log: Option<Mutex<File>>,
    pub wrapped_chat_cache: Vec<Vec<(String, Color)>>,
    pub active_view: ChatView,
    pub last_chat_width: usize,
    pub scroll_offsets: [usize; ChatView::ALL.len()],
    total_lines_per_view: [usize; ChatView::ALL.len()],
    pub last_incoming_tell_sender: Option<String>,
}

impl Default for ChatState {
    fn default() -> Self {
        Self {
            messages: Vec::with_capacity(4000),
            chat_log: None,
            wrapped_chat_cache: Vec::with_capacity(4000),
            active_view: ChatView::default(),
            last_chat_width: 0,
            scroll_offsets: [0; ChatView::ALL.len()],
            total_lines_per_view: [0; ChatView::ALL.len()],
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
        event: &holtburger_core::ClientViewEvent,
        local_player_name: Option<&str>,
    ) {
        use holtburger_core::ClientViewEvent;
        match event {
            ClientViewEvent::LogMessage(msg) => {
                let chat_tags = if msg.contains("[ERROR]") {
                    ChatMessageTags::error()
                } else if msg.contains("[WARN]") {
                    ChatMessageTags::warning()
                } else if msg.contains("[INFO]") {
                    ChatMessageTags::info()
                } else if msg.contains("[DEBUG]") || msg.contains("[TRACE]") {
                    ChatMessageTags::debug()
                } else {
                    ChatMessageTags::system()
                };
                self.log_with_channel(None, chat_tags, msg.clone(), false);
            }
            ClientViewEvent::ServerMessage { message, chat_type } => {
                self.log(chat_message_tags(*chat_type), message.clone());
            }
            ClientViewEvent::Chat {
                sender,
                message,
                chat_type,
            } => {
                self.log(
                    chat_message_tags(*chat_type),
                    format!("{}: {}", sender, message),
                );
            }
            ClientViewEvent::ChannelMessage {
                channel,
                sender,
                message,
            } => {
                self.log_channel(
                    *channel,
                    channel_tags(*channel),
                    format_channel_message(*channel, sender, message, local_player_name),
                );
            }
            ClientViewEvent::FellowshipActivity { activity } => {
                self.log(
                    ChatMessageTags::system().party(),
                    format_fellowship_activity(activity),
                );
            }
            ClientViewEvent::Tell { sender, message } => {
                self.last_incoming_tell_sender = Some(sender.clone());
                self.log(
                    ChatMessageTags::tell(),
                    format!("{} tells you: {}", sender, message),
                );
            }
            ClientViewEvent::Emote { sender, text } => {
                self.log(ChatMessageTags::emote(), format!("{} {}", sender, text));
            }
            ClientViewEvent::SoulEmote { sender, text, .. } => {
                self.log(ChatMessageTags::emote(), format!("{} {}", sender, text));
            }
            ClientViewEvent::CombatFeedback(feedback) => {
                self.log_combat_feedback(feedback);
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
                self.log(ChatMessageTags::error(), message);
            }
            _ => {}
        }
    }

    pub fn log(&mut self, chat_tags: ChatMessageTags, text: String) {
        self.log_with_channel(None, chat_tags, text, true);
    }

    pub fn capture_log(&mut self, chat_tags: ChatMessageTags, text: String) {
        self.log_with_channel(None, chat_tags, text, false);
    }

    pub fn log_channel(
        &mut self,
        channel: ChatChannelInfo,
        chat_tags: ChatMessageTags,
        text: String,
    ) {
        self.log_with_channel(
            Some(channel),
            ChatMessageTags::chat().with(chat_tags),
            text,
            true,
        );
    }

    fn log_with_channel(
        &mut self,
        channel: Option<ChatChannelInfo>,
        chat_tags: ChatMessageTags,
        text: String,
        echo_to_debug_log: bool,
    ) {
        if echo_to_debug_log {
            log::info!("{}", text);
        }

        if let Some(log_mutex) = &self.chat_log
            && let Ok(mut file) = log_mutex.lock()
        {
            let _ = writeln!(file, "{}", text);
            let _ = file.flush();
        }
        self.messages.push(ChatMessage {
            text,
            channel,
            chat_tags,
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
                    log::info!("Attack sequence finished.");
                } else {
                    log::warn!("Attack sequence finished with {:?}.", error);
                }
            }
            CombatFeedback::AttackCommenced => {
                log::info!("Attack sequence started.");
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
                    ChatMessageTags::info().combat(),
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
                    ChatMessageTags::info().combat(),
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
                    ChatMessageTags::info().combat(),
                    format!("{} evaded your attack.", defender_name),
                );
            }
            CombatFeedback::EvasionDefenderNotification { attacker_name } => {
                self.log(
                    ChatMessageTags::info().combat(),
                    format!("You evaded {}'s attack.", attacker_name),
                );
            }
            CombatFeedback::VictimNotification { death_message } => {
                self.log(ChatMessageTags::info().combat(), death_message.clone());
            }
            CombatFeedback::KillerNotification { death_message } => {
                self.log(ChatMessageTags::info().combat(), death_message.clone());
            }
            CombatFeedback::PlayerKilled { death_message, .. } => {
                self.log(ChatMessageTags::info().combat(), death_message.clone());
            }
        }
    }

    pub fn update_layout(&mut self, area: Rect) {
        let width = area.width.saturating_sub(2) as usize;
        let height = area.height.saturating_sub(2) as usize;

        let m_len = self.messages.len();

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
                let color = color_for_tags(m.chat_tags);

                let wrapped = wrap_text(&m.text, width);
                let mut msg_lines = Vec::new();
                for line in wrapped {
                    msg_lines.push((line, color));
                }
                self.wrapped_chat_cache.push(msg_lines);
            }
        }

        let visible_wrapped_messages = visible_wrapped_message_slices(self);
        let old_total_lines = self.active_total_lines();
        let total_lines: usize = visible_wrapped_messages.iter().map(|v| v.len()).sum();

        // If we were at the bottom (scroll_offset == 0) and new lines were added,
        // we stay at the bottom by default.
        // If we were scrolled up, we increment scroll_offset to maintain the relative position.
        let total_lines_delta = total_lines.saturating_sub(old_total_lines);
        let active_scroll_offset = self.active_scroll_offset();
        if active_scroll_offset > 0 && total_lines_delta > 0 {
            *self.active_scroll_offset_mut() = active_scroll_offset + total_lines_delta;
        }

        *self.active_total_lines_mut() = total_lines;

        self.clamp_scroll(height);
    }

    fn clamp_scroll(&mut self, height: usize) {
        let max_scroll = self.active_total_lines().saturating_sub(height);
        *self.active_scroll_offset_mut() = self.active_scroll_offset().min(max_scroll);
    }

    pub fn handle_input(&mut self, key: KeyEvent, h: usize) -> bool {
        let mut needs_redraw = false;
        match key.code {
            KeyCode::Up => {
                *self.active_scroll_offset_mut() = self.active_scroll_offset().saturating_add(1);
                self.clamp_scroll(h);
                needs_redraw = true;
            }
            KeyCode::Down => {
                *self.active_scroll_offset_mut() = self.active_scroll_offset().saturating_sub(1);
                needs_redraw = true;
            }
            KeyCode::PageUp => {
                let step = (h / 2) + 1;
                *self.active_scroll_offset_mut() = self.active_scroll_offset().saturating_add(step);
                self.clamp_scroll(h);
                needs_redraw = true;
            }
            KeyCode::PageDown => {
                let step = (h / 2) + 1;
                *self.active_scroll_offset_mut() = self.active_scroll_offset().saturating_sub(step);
                needs_redraw = true;
            }
            _ => {}
        }
        needs_redraw
    }

    fn active_view_index(&self) -> usize {
        match self.active_view {
            ChatView::Everything => 0,
            ChatView::Chat => 1,
        }
    }

    pub fn active_scroll_offset(&self) -> usize {
        self.scroll_offsets[self.active_view_index()]
    }

    pub fn active_scroll_offset_mut(&mut self) -> &mut usize {
        let index = self.active_view_index();
        &mut self.scroll_offsets[index]
    }

    pub fn active_total_lines(&self) -> usize {
        self.total_lines_per_view[self.active_view_index()]
    }

    fn active_total_lines_mut(&mut self) -> &mut usize {
        let index = self.active_view_index();
        &mut self.total_lines_per_view[index]
    }

    pub fn active_scroll_offset_for(&self, view: ChatView) -> usize {
        match view {
            ChatView::Everything => self.scroll_offsets[0],
            ChatView::Chat => self.scroll_offsets[1],
        }
    }

    pub fn set_active_scroll_offset_for(&mut self, view: ChatView, offset: usize) {
        match view {
            ChatView::Everything => self.scroll_offsets[0] = offset,
            ChatView::Chat => self.scroll_offsets[1] = offset,
        }
    }
}

fn visible_wrapped_message_slices(chat: &ChatState) -> Vec<&[(String, Color)]> {
    let window_start = chat.messages.len().saturating_sub(CHAT_HISTORY_WINDOW_SIZE);

    chat.messages[window_start..]
        .iter()
        .zip(chat.wrapped_chat_cache[window_start..].iter())
        .filter_map(|(message, wrapped)| {
            chat.active_view
                .allows(message.chat_tags)
                .then_some(wrapped.as_slice())
        })
        .collect()
}

fn chat_view_title_line(active_view: ChatView) -> Line<'static> {
    let mut spans = Vec::new();

    for (index, view) in ChatView::ALL.iter().enumerate() {
        if index > 0 {
            spans.push(Span::raw("|"));
        }

        let mut style = Style::default();
        if *view == active_view {
            style = style.add_modifier(Modifier::BOLD);
        }

        spans.push(Span::styled(
            format!(" [{}] {} ", view.shortcut(), view.label()),
            style,
        ));
    }

    Line::from(spans).alignment(Alignment::Right)
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

fn chat_message_tags(chat_type: ChatMessageTypeId) -> ChatMessageTags {
    match chat_type.known() {
        Some(ChatMessageType::Broadcast)
        | Some(ChatMessageType::AllChannels)
        | Some(ChatMessageType::System)
        | Some(ChatMessageType::x1A)
        | Some(ChatMessageType::x1B)
        | Some(ChatMessageType::x1C)
        | Some(ChatMessageType::x1D)
        | Some(ChatMessageType::x1E) => ChatMessageTags::system(),
        Some(ChatMessageType::Tell)
        | Some(ChatMessageType::OutgoingTell)
        | Some(ChatMessageType::AdminTell) => ChatMessageTags::tell(),
        Some(ChatMessageType::Speech)
        | Some(ChatMessageType::Channel)
        | Some(ChatMessageType::ChannelSend) => ChatMessageTags::chat(),
        Some(ChatMessageType::Combat)
        | Some(ChatMessageType::CombatEnemy)
        | Some(ChatMessageType::CombatSelf) => ChatMessageTags::COMBAT,
        Some(ChatMessageType::Spellcasting) | Some(ChatMessageType::Magic) => {
            ChatMessageTags::MAGIC
        }
        Some(ChatMessageType::Allegiance)
        | Some(ChatMessageType::Social)
        | Some(ChatMessageType::SocialSend) => ChatMessageTags::chat().guild(),
        Some(ChatMessageType::Fellowship) => ChatMessageTags::chat().party(),
        Some(ChatMessageType::Help) => ChatMessageTags::warning().help(),
        Some(ChatMessageType::Abuse) => ChatMessageTags::warning(),
        Some(ChatMessageType::Appraisal)
        | Some(ChatMessageType::Advancement)
        | Some(ChatMessageType::Recall)
        | Some(ChatMessageType::Craft)
        | Some(ChatMessageType::Salvaging)
        | Some(ChatMessageType::WorldBroadcast) => ChatMessageTags::info(),
        Some(ChatMessageType::Emote) => ChatMessageTags::emote(),
        None => ChatMessageTags::system(),
    }
}

fn channel_tags(channel: ChatChannelInfo) -> ChatMessageTags {
    match channel.kind {
        ChatChannelKind::Fellowship => ChatMessageTags::PARTY,
        ChatChannelKind::Allegiance
        | ChatChannelKind::Vassals
        | ChatChannelKind::Patron
        | ChatChannelKind::Monarch
        | ChatChannelKind::CoVassals => ChatMessageTags::GUILD,
        ChatChannelKind::Trade => ChatMessageTags::TRADE,
        ChatChannelKind::Society => ChatMessageTags::SOCIETY,
        ChatChannelKind::General
        | ChatChannelKind::Lfg
        | ChatChannelKind::Roleplay
        | ChatChannelKind::Olthoi
        | ChatChannelKind::Unknown => ChatMessageTags::empty(),
    }
}

fn color_for_tags(chat_tags: ChatMessageTags) -> Color {
    if chat_tags.contains(ChatMessageTags::ERROR) {
        Color::Red
    } else if chat_tags.contains(ChatMessageTags::WARNING) {
        Color::Yellow
    } else if chat_tags.contains(ChatMessageTags::TELL) {
        Color::Magenta
    } else if chat_tags.contains(ChatMessageTags::EMOTE) {
        Color::Green
    } else if chat_tags.contains(ChatMessageTags::INFO) {
        Color::Cyan
    } else if chat_tags.contains(ChatMessageTags::DEBUG) {
        Color::Indexed(242)
    } else if chat_tags.contains(ChatMessageTags::SYSTEM) {
        Color::LightBlue
    } else if chat_tags.contains(ChatMessageTags::COMBAT) {
        Color::LightRed
    } else if chat_tags.contains(ChatMessageTags::MAGIC) {
        Color::LightMagenta
    } else if chat_tags.contains(ChatMessageTags::PARTY) {
        Color::LightGreen
    } else if chat_tags.contains(ChatMessageTags::GUILD) {
        Color::LightCyan
    } else if chat_tags.contains(ChatMessageTags::TRADE) {
        Color::LightYellow
    } else if chat_tags.contains(ChatMessageTags::HELP) {
        Color::Yellow
    } else if chat_tags.contains(ChatMessageTags::SOCIETY) {
        Color::Blue
    } else {
        Color::White
    }
}

pub fn render_chat_pane(f: &mut Frame, chat: &ChatState, is_focused: bool, area: Rect) {
    let height = area.height.saturating_sub(2) as usize;

    let all_lines: Vec<&(String, Color)> = visible_wrapped_message_slices(chat)
        .iter()
        .flat_map(|v| v.iter())
        .collect();

    let total_lines: usize = all_lines.len();

    let effective_scroll = chat.active_scroll_offset();
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
            .title(Line::from(chat_title).style(pane_title_style(is_focused)))
            .title_bottom(chat_view_title_line(chat.active_view)),
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
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use std::sync::Once;

    struct TestLogger;

    static TEST_LOGGER: TestLogger = TestLogger;
    static INIT_LOGGER: Once = Once::new();
    static CAPTURED_LOGS: Mutex<Vec<String>> = Mutex::new(Vec::new());

    impl log::Log for TestLogger {
        fn enabled(&self, metadata: &log::Metadata) -> bool {
            metadata.level() <= log::Level::Info
        }

        fn log(&self, record: &log::Record) {
            if self.enabled(record.metadata()) {
                CAPTURED_LOGS
                    .lock()
                    .expect("test logger should lock")
                    .push(format!("[{}] {}", record.level(), record.args()));
            }
        }

        fn flush(&self) {}
    }

    fn init_test_logger() {
        INIT_LOGGER.call_once(|| {
            let _ = log::set_logger(&TEST_LOGGER);
            log::set_max_level(log::LevelFilter::Info);
        });

        CAPTURED_LOGS
            .lock()
            .expect("test logger should lock")
            .clear();
    }

    #[test]
    fn channel_message_formats_party_self_echo_without_blank_sender() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::ChannelMessage {
                channel: ChatChannelInfo::legacy(
                    holtburger_protocol::messages::ChatChannel::Fellow.into(),
                ),
                sender: String::new(),
                message: "party check".to_string(),
            },
            Some("Player"),
        );

        let message = chat.messages.last().expect("channel message should log");
        assert!(message.chat_tags.contains(ChatMessageTags::CHAT));
        assert!(message.chat_tags.contains(ChatMessageTags::PARTY));
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
            &holtburger_core::ClientViewEvent::ChannelMessage {
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
        assert!(message.chat_tags.contains(ChatMessageTags::CHAT));
        assert!(message.chat_tags.contains(ChatMessageTags::GUILD));
        assert_eq!(message.text, "[Guild] Bestie: guild check");
    }

    #[test]
    fn turbine_general_message_formats_with_semantic_label() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::ChannelMessage {
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
        assert!(message.chat_tags.contains(ChatMessageTags::CHAT));
        assert_eq!(message.text, "[General] Bestie: world check");
    }

    #[test]
    fn channel_message_self_echo_falls_back_to_you_without_local_name() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::ChannelMessage {
                channel: ChatChannelInfo::legacy(
                    holtburger_protocol::messages::ChatChannel::Fellow.into(),
                ),
                sender: String::new(),
                message: "party check".to_string(),
            },
            None,
        );

        let message = chat.messages.last().expect("channel message should log");
        assert!(message.chat_tags.contains(ChatMessageTags::CHAT));
        assert!(message.chat_tags.contains(ChatMessageTags::PARTY));
        assert_eq!(message.text, "[Party] You: party check");
    }

    #[test]
    fn fellowship_activity_formats_member_join() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::FellowshipActivity {
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
        assert!(message.chat_tags.contains(ChatMessageTags::STATUS));
        assert!(message.chat_tags.contains(ChatMessageTags::SYSTEM));
        assert!(message.chat_tags.contains(ChatMessageTags::PARTY));
        assert_eq!(message.text, "Bravo joined the fellowship.");
    }

    #[test]
    fn fellowship_activity_formats_local_dismissal() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::FellowshipActivity {
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
    fn server_message_combat_type_gets_combat_tags() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::ServerMessage {
                message: "You enter combat.".to_string(),
                chat_type: holtburger_protocol::messages::ChatMessageType::Combat.into(),
            },
            Some("Player"),
        );

        let message = chat.messages.last().expect("server message should log");
        assert!(message.chat_tags.contains(ChatMessageTags::COMBAT));
        assert_eq!(message.text, "You enter combat.");
    }

    #[test]
    fn server_message_broadcast_type_gets_system_tags() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::ServerMessage {
                message: "Welcome to Asheron's Call.".to_string(),
                chat_type: holtburger_protocol::messages::ChatMessageType::Broadcast.into(),
            },
            Some("Player"),
        );

        let message = chat.messages.last().expect("server message should log");
        assert!(message.chat_tags.contains(ChatMessageTags::STATUS));
        assert!(message.chat_tags.contains(ChatMessageTags::SYSTEM));
        assert!(!message.chat_tags.contains(ChatMessageTags::INFO));
        assert_eq!(message.text, "Welcome to Asheron's Call.");
    }

    #[test]
    fn server_message_tell_type_gets_tell_tags() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::ServerMessage {
                message: "Buff Dude has granted you access to their home's storage.".to_string(),
                chat_type: holtburger_protocol::messages::ChatMessageType::Tell.into(),
            },
            Some("Player"),
        );

        let message = chat.messages.last().expect("server message should log");
        assert!(message.chat_tags.contains(ChatMessageTags::CHAT));
        assert!(message.chat_tags.contains(ChatMessageTags::TELL));
        assert!(!message.chat_tags.contains(ChatMessageTags::INFO));
        assert_eq!(
            message.text,
            "Buff Dude has granted you access to their home's storage."
        );
    }

    #[test]
    fn soul_emote_event_logs_raw_inbound_text() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::SoulEmote {
                sender: "Bestie".to_string(),
                text: "waves.".to_string(),
            },
            Some("Player"),
        );

        let message = chat.messages.last().expect("soul emote should log");
        assert!(message.chat_tags.contains(ChatMessageTags::EMOTE));
        assert_eq!(message.text, "Bestie waves.");
    }

    #[test]
    fn attacker_feedback_formats_damage_summary() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::CombatFeedback(
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

        assert!(message.chat_tags.contains(ChatMessageTags::COMBAT));
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
            &holtburger_core::ClientViewEvent::CombatFeedback(
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

        assert!(message.chat_tags.contains(ChatMessageTags::COMBAT));
        assert!(
            message
                .text
                .contains("Banderling hit you for 18 fire damage to your chest")
        );
        assert!(message.text.contains("12.5%"));
        assert!(message.text.contains("Overpower"));
    }

    #[test]
    fn player_killed_feedback_logs_broadcast_message() {
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::CombatFeedback(CombatFeedback::PlayerKilled {
                death_message: "A nearby player has fallen.".to_string(),
                victim_id: holtburger_common::Guid(0x12345678),
                killer_id: holtburger_common::Guid(0x90ABCDEF),
            }),
            Some("Player"),
        );

        let message = chat.messages.last().expect("combat feedback should log");

        assert!(message.chat_tags.contains(ChatMessageTags::COMBAT));
        assert_eq!(message.text, "A nearby player has fallen.");
    }

    #[test]
    fn chat_view_filters_combat_messages_and_renders_view_labels() {
        let area = Rect::new(0, 0, 80, 8);
        let mut chat = ChatState::new(None);

        chat.handle_event(
            &holtburger_core::ClientViewEvent::Chat {
                sender: "Bestie".to_string(),
                message: "hello world".to_string(),
                chat_type: holtburger_protocol::messages::ChatMessageType::Speech.into(),
            },
            Some("Player"),
        );

        chat.handle_event(
            &holtburger_core::ClientViewEvent::CombatFeedback(CombatFeedback::AttackCommenced),
            Some("Player"),
        );

        chat.active_view = ChatView::Chat;
        chat.update_layout(area);

        let backend = TestBackend::new(area.width, area.height);
        let mut terminal = Terminal::new(backend).expect("test terminal should initialize");
        terminal
            .draw(|frame| render_chat_pane(frame, &chat, true, area))
            .expect("chat pane should render");

        let rendered = terminal
            .backend()
            .buffer()
            .content
            .iter()
            .map(|cell| cell.symbol())
            .collect::<String>();

        assert!(rendered.contains("hello world"));
        assert!(!rendered.contains("Attack sequence started."));
        assert!(rendered.contains("[1] Everything"));
        assert!(rendered.contains("[2] Chat"));
    }

    #[test]
    fn chat_scroll_offsets_are_tracked_per_view() {
        let area = Rect::new(0, 0, 80, 8);
        let mut chat = ChatState::new(None);

        for index in 0..20 {
            chat.log(ChatMessageTags::chat(), format!("chat {}", index));
        }

        for index in 0..10 {
            chat.log(
                ChatMessageTags::info().combat(),
                format!("combat {}", index),
            );
        }

        chat.active_view = ChatView::Everything;
        chat.update_layout(area);

        chat.active_view = ChatView::Chat;
        chat.update_layout(area);

        chat.set_active_scroll_offset_for(ChatView::Everything, 3);
        chat.set_active_scroll_offset_for(ChatView::Chat, 2);

        chat.active_view = ChatView::Everything;
        chat.update_layout(area);

        assert_eq!(chat.active_scroll_offset_for(ChatView::Everything), 3);
        assert_eq!(chat.active_scroll_offset_for(ChatView::Chat), 2);
    }

    #[test]
    fn chat_log_is_echoed_to_debug_log() {
        init_test_logger();

        let mut chat = ChatState::new(None);
        chat.log(ChatMessageTags::chat(), "echo this chat line".to_string());

        let captured = CAPTURED_LOGS.lock().expect("test logger should lock");
        assert!(
            captured
                .iter()
                .any(|message| message.contains("echo this chat line")),
            "expected chat line to be echoed into the debug log, got {:?}",
            *captured
        );
    }

    #[test]
    fn rust_log_messages_do_not_re_echo_into_debug_log() {
        init_test_logger();

        let mut chat = ChatState::new(None);
        chat.handle_event(
            &holtburger_core::ClientViewEvent::LogMessage("[INFO] logger message".to_string()),
            None,
        );

        let captured = CAPTURED_LOGS.lock().expect("test logger should lock");
        assert!(
            captured.is_empty(),
            "expected no echoed debug log entries, got {:?}",
            *captured
        );
    }

    #[test]
    fn captured_log_entries_do_not_re_echo_into_debug_log() {
        init_test_logger();

        let mut chat = ChatState::new(None);
        chat.capture_log(
            ChatMessageTags::system(),
            "captured logger line".to_string(),
        );

        let captured = CAPTURED_LOGS.lock().expect("test logger should lock");
        assert!(
            captured.is_empty(),
            "expected no echoed debug log entries, got {:?}",
            *captured
        );
    }
}
