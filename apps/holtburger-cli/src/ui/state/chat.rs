use ratatui::style::Color;
use std::fs::File;
use std::io::Write;
use std::sync::Mutex;

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
}

impl Default for ChatState {
    fn default() -> Self {
        Self {
            messages: Vec::with_capacity(4000),
            chat_log: None,
            wrapped_chat_cache: Vec::with_capacity(4000),
            last_chat_width: 0,
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

    pub fn log(&mut self, kind: ChatMessageKind, text: String) {
        if let Some(log_mutex) = &self.chat_log
            && let Ok(mut file) = log_mutex.lock()
        {
            let _ = writeln!(file, "{}", text);
            let _ = file.flush();
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
}
