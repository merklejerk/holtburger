use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{List, ListItem};

use crossterm::event::{KeyCode, KeyEvent};
use std::fs::File;
use std::io::Write;
use std::sync::Mutex;

use crate::ui::theme::{pane_block, pane_title_style};
use crate::ui::utils::wrap_text;

pub const CHAT_HISTORY_WINDOW_SIZE: usize = 2000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatMessageKind {
    Info,
    System,
    Chat,
    Tell,
    Emote,
    Error,
    Warning,
    Debug,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub kind: ChatMessageKind,
    pub text: String,
}

pub struct ChatState {
    pub messages: Vec<ChatMessage>,
    pub chat_log: Option<Mutex<File>>,
    pub wrapped_chat_cache: Vec<Vec<(String, Color)>>,
    pub last_chat_width: usize,
    pub scroll_offset: usize,
    pub total_lines: usize,
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

    pub fn handle_event(&mut self, event: &holtburger_core::ClientViewEvent) {
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
                self.log(kind, msg.clone());
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
                self.log(kind, message.clone());
            }
            ClientViewEvent::Chat { sender, message } => {
                self.log(ChatMessageKind::Chat, format!("{}: {}", sender, message));
            }
            ClientViewEvent::Emote { sender, text } => {
                self.log(ChatMessageKind::Emote, format!("{} {}", sender, text));
            }
            ClientViewEvent::PingResponse => {
                self.log(ChatMessageKind::System, "Pong!".to_string());
            }
            ClientViewEvent::BootAccount(reason) => {
                self.log(
                    ChatMessageKind::Error,
                    format!("Booted from server: {}", reason),
                );
            }
            _ => {}
        }
    }

    pub fn log(&mut self, kind: ChatMessageKind, text: String) {
        if let Some(log_mutex) = &self.chat_log {
            if let Ok(mut file) = log_mutex.lock() {
                let _ = writeln!(file, "{}", text);
                let _ = file.flush();
            }
        }
        self.messages.push(ChatMessage { kind, text });

        const MAX_CHAT: usize = 4000;
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

    pub fn handle_input(&mut self, key: KeyEvent, h: usize) -> bool {
        let mut needs_redraw = false;
        match key.code {
            KeyCode::Up => {
                self.scroll_offset = self.scroll_offset.saturating_add(1);
                let max_scroll = self.total_lines.saturating_sub(h);
                self.scroll_offset = self.scroll_offset.min(max_scroll);
                needs_redraw = true;
            }
            KeyCode::Down => {
                self.scroll_offset = self.scroll_offset.saturating_sub(1);
                needs_redraw = true;
            }
            KeyCode::PageUp => {
                let step = (h / 2) + 1;
                self.scroll_offset = self.scroll_offset.saturating_add(step);
                let max_scroll = self.total_lines.saturating_sub(h);
                self.scroll_offset = self.scroll_offset.min(max_scroll);
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

pub fn render_chat_pane(f: &mut Frame, chat: &mut ChatState, is_focused: bool, area: Rect) {
    let width = area.width.saturating_sub(2) as usize;
    let height = area.height.saturating_sub(2) as usize;

    let m_len = chat.messages.len();
    let window_size = CHAT_HISTORY_WINDOW_SIZE;

    // Guard: Ensure the cache is not longer than the current number of messages (stale cache fix)
    if chat.wrapped_chat_cache.len() > m_len {
        chat.wrapped_chat_cache.truncate(m_len);
    }

    // Check if we need to refresh the cache due to width change
    if width != chat.last_chat_width {
        chat.wrapped_chat_cache.clear();
        chat.last_chat_width = width;
    }

    // Add new messages to the cache
    if chat.wrapped_chat_cache.len() < m_len {
        let start_idx = chat.wrapped_chat_cache.len();
        for m in &chat.messages[start_idx..] {
            let color = match m.kind {
                ChatMessageKind::Chat => Color::White,
                ChatMessageKind::Tell => Color::Magenta,
                ChatMessageKind::Emote => Color::Green,
                ChatMessageKind::Info => Color::Cyan,
                ChatMessageKind::System => Color::Gray,
                ChatMessageKind::Error => Color::Red,
                ChatMessageKind::Warning => Color::Yellow,
                ChatMessageKind::Debug => Color::Indexed(242), // Greyish
            };

            let wrapped = wrap_text(&m.text, width);
            let mut msg_lines = Vec::new();
            for line in wrapped {
                msg_lines.push((line, color));
            }
            chat.wrapped_chat_cache.push(msg_lines);
        }
    }

    let window_start = m_len.saturating_sub(window_size);

    let total_lines: usize = chat.wrapped_chat_cache[window_start..]
        .iter()
        .map(|v| v.len())
        .sum();
    chat.total_lines = total_lines;

    // Bounds check scroll_offset
    let max_scroll = total_lines.saturating_sub(height);
    chat.scroll_offset = chat.scroll_offset.min(max_scroll);

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
}
