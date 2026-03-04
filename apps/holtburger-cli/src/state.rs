
use std::time::Instant;

use holtburger_common::Guid;
use holtburger_core::{ClientState, RetryState};

use crate::pages::game::layout::NET_PULSE_HISTORY_SIZE;
use crate::types::{ChatMessageKind, Modal, Page};

use crate::pages::game::GameState;

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
    pub page: Page,
    pub modal: Option<Modal>,
    pub logon_retry: RetryState,
    pub enter_retry: RetryState,
    pub client_state: ClientState,
    pub net_stats: NetStats,
    pub world_name: String,
    pub verbosity: u8,
    pub app_action_tx: tokio::sync::mpsc::UnboundedSender<crate::types::AppAction>,
}

pub struct RenderContext<'a> {
    pub account_name: &'a str,
    pub client_state: &'a ClientState,
    pub net_stats: &'a NetStats,
    pub is_modal_active: bool,
    pub logon_retry: &'a RetryState,
    pub enter_retry: &'a RetryState,
}

impl AppState {
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
            if let Some(pos) = game.data.player_pos {
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
}

impl AppState {
    pub fn log(&mut self, kind: ChatMessageKind, msg: impl Into<String>) {
        if let Some(game) = self.game_option_mut() {
            game.chat.log(kind, msg.into());
        }
    }
}
