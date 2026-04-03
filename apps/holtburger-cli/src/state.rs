use std::time::Instant;
use std::{fs::File, sync::Mutex};

use holtburger_common::Guid;
use holtburger_content::ContentRepository;
use holtburger_core::ClientState;

use crate::pages::game::layout::NET_PULSE_HISTORY_SIZE;
use crate::types::{ChatMessageKind, Page};

use crate::pages::game::GameState;
use std::sync::Arc;

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
    pub verbosity: u8,
    pub quit_on_disconnect: bool,
    pub disconnect_reason: Option<String>,
    pub pending_exit_message: Option<String>,
}

pub struct RenderContext<'a> {
    pub account_name: &'a str,
    pub client_state: &'a ClientState,
    pub net_stats: &'a NetStats,
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

    pub fn display_client_info(&mut self) {
        let mut logs = Vec::new();
        logs.push((
            ChatMessageKind::System,
            "═══ CLIENT DEBUG INFO ═══".to_string(),
        ));
        logs.push((
            ChatMessageKind::System,
            format!("Account: {}", self.account_name),
        ));

        if let Some(game) = self.game_option() {
            if let Some(name) = &game.data.character_name {
                logs.push((ChatMessageKind::System, format!("Character: {}", name)));
            }
            if let Some(guid) = game.data.player_guid {
                logs.push((ChatMessageKind::System, format!("GUID: {:#010X}", guid.0)));
            }
        }

        let state_str = match &self.client_state {
            ClientState::Connected => "Connected",
            ClientState::CharacterSelection(_) => "Character Selection",
            ClientState::EnteringWorld => "Entering World",
            ClientState::InWorld => "In World",
            ClientState::Disconnected => "Disconnected",
        };
        logs.push((ChatMessageKind::System, format!("State: {}", state_str)));

        if let Some(game) = self.game_option() {
            if let Some(pos) = game.data.runtime_player_position() {
                logs.push((ChatMessageKind::System, "".to_string()));
                logs.push((ChatMessageKind::System, "═══ POSITION ═══".to_string()));
                logs.push((
                    ChatMessageKind::System,
                    format!("Landblock: {:#010X}", pos.landblock_id),
                ));
                logs.push((
                    ChatMessageKind::System,
                    format!(
                        "Euclidean: ({:.2}, {:.2}, {:.2})",
                        pos.coords.x, pos.coords.y, pos.coords.z
                    ),
                ));
                logs.push((
                    ChatMessageKind::System,
                    format!("Geographic: {}", pos.to_world_coords()),
                ));
            }

            // Entity counts
            logs.push((ChatMessageKind::System, "".to_string()));
            logs.push((ChatMessageKind::System, "═══ ENTITIES ═══".to_string()));
            let world_entities = game
                .data
                .entities
                .values()
                .filter(|e| e.position.landblock_id != Guid::NULL)
                .count();
            let inventory_items = game
                .data
                .entities
                .values()
                .filter(|e| e.position.landblock_id == Guid::NULL)
                .count();
            logs.push((
                ChatMessageKind::System,
                format!("World Entities: {}", world_entities),
            ));
            logs.push((
                ChatMessageKind::System,
                format!("Inventory Items: {}", inventory_items),
            ));
            logs.push((
                ChatMessageKind::System,
                format!("Total Entities: {}", game.data.entities.len()),
            ));
        }

        logs.push((
            ChatMessageKind::System,
            "══════════════════════════".to_string(),
        ));
        for (kind, msg) in logs {
            self.log(kind, msg);
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
    pub fn log(&mut self, kind: ChatMessageKind, msg: impl Into<String>) {
        if let Some(game) = self.game_option_mut() {
            game.chat.log(kind, msg.into());
        }
    }
}
