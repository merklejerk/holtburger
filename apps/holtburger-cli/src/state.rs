use std::time::Instant;
use std::{fs::File, sync::Mutex};

use holtburger_content::ContentRepository;
use holtburger_core::ClientState;
use holtburger_dat::file_type::SkillTable;
use holtburger_scripting::ScriptHostConfig;
use holtburger_world::spell::SpellCatalog;

use crate::pages::game::layout::NET_PULSE_HISTORY_SIZE;
use crate::types::{ChatMessageTags, Page};

use crate::pages::game::GameState;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueuedScriptStartup {
    pub basename: String,
    pub args: String,
}

impl QueuedScriptStartup {
    pub fn new(basename: impl Into<String>, args: impl Into<String>) -> Self {
        Self {
            basename: basename.into(),
            args: args.into(),
        }
    }
}

pub struct NetStats {
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub history_in: Vec<u64>,
    pub history_out: Vec<u64>,
    pub last_update: Option<Instant>,
}

impl Default for NetStats {
    fn default() -> Self {
        Self {
            bytes_in: 0,
            bytes_out: 0,
            history_in: vec![0; NET_PULSE_HISTORY_SIZE],
            history_out: vec![0; NET_PULSE_HISTORY_SIZE],
            last_update: None,
        }
    }
}

pub struct AppState {
    pub account_name: String,
    pub account_password: String,
    pub character_preference: Option<String>,
    pub chat_log: Option<Mutex<File>>,
    pub page: Page,
    pub client_state: ClientState,
    pub net_stats: NetStats,
    pub world_name: String,
    pub server_time: Option<(f64, Instant)>,
    pub content: Option<Arc<ContentRepository>>,
    pub spell_catalog: Option<Arc<SpellCatalog>>,
    pub skill_table: Option<Arc<SkillTable>>,
    pub verbosity: u8,
    pub quit_on_disconnect: bool,
    pub disconnect_reason: Option<String>,
    pub pending_exit_message: Option<String>,
    pub queued_script_startup: Option<QueuedScriptStartup>,
    pub script_host_config: ScriptHostConfig,
}

pub struct RenderContext<'a> {
    pub client_state: &'a ClientState,
    pub net_stats: &'a NetStats,
    pub server_time: Option<(f64, Instant)>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct EventContext {
    pub server_time: Option<(f64, Instant)>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TickContext {
    pub server_time: Option<(f64, Instant)>,
}

impl AppState {
    pub const DEFAULT_DISCONNECT_MESSAGE: &str = "Lost connection to server.";

    pub fn current_server_time(&self) -> f64 {
        match self.server_time {
            Some((server_val, local_then)) => {
                let elapsed = local_then.elapsed().as_secs_f64();
                server_val + elapsed
            }
            None => std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64(),
        }
    }

    pub fn game_option(&self) -> Option<&GameState> {
        match &self.page {
            Page::Game(game) => Some(game),
            _ => None,
        }
    }

    pub fn game_option_mut(&mut self) -> Option<&mut GameState> {
        match &mut self.page {
            Page::Game(game) => Some(game),
            _ => None,
        }
    }

    pub fn clear_disconnect_reason(&mut self) {
        self.disconnect_reason = None;
    }

    pub fn remember_disconnect_reason(&mut self, reason: impl Into<String>) {
        let reason = reason.into();
        if reason.trim().is_empty() {
            return;
        }

        self.disconnect_reason = Some(reason);
    }

    pub fn current_disconnect_message(&self) -> String {
        self.disconnect_reason
            .clone()
            .unwrap_or_else(|| Self::DEFAULT_DISCONNECT_MESSAGE.to_string())
    }

    pub fn current_disconnect_chat_message(&self) -> String {
        format!("Disconnected: {}", self.current_disconnect_message())
    }

    pub fn should_exit_on_disconnect(&self) -> bool {
        self.quit_on_disconnect || self.game_option().is_none()
    }

    pub fn request_disconnect_exit(&mut self) {
        if !self.should_exit_on_disconnect() || self.pending_exit_message.is_some() {
            return;
        }

        self.pending_exit_message = Some(self.current_disconnect_message());
    }

    pub fn has_pending_exit(&self) -> bool {
        self.pending_exit_message.is_some()
    }

    pub fn take_pending_exit_message(&mut self) -> Option<String> {
        self.pending_exit_message.take()
    }
}

impl AppState {
    pub fn log(&mut self, chat_tags: ChatMessageTags, msg: impl Into<String>) {
        if let Some(game) = self.game_option_mut() {
            game.chat.log(chat_tags, msg.into());
        }
    }

    pub fn capture_log(&mut self, chat_tags: ChatMessageTags, msg: impl Into<String>) {
        if let Some(game) = self.game_option_mut() {
            game.chat.capture_log(chat_tags, msg.into());
        }
    }
}
