use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::sync::Mutex;
use std::time::Instant;

use holtburger_common::Guid;
use holtburger_core::{ClientState, RetryState};
use holtburger_protocol::messages::CharacterEntry;
use ratatui::style::Color;

use crate::ui::layout::NET_PULSE_HISTORY_SIZE;
use crate::ui::widgets::panels::chat::{ChatMessage, ChatMessageKind};
use crate::ui::widgets::panels::modal::Modal;

pub mod game;
pub mod view;

pub use self::game::GameData;
pub use self::view::ViewState;

#[derive(Debug, Default)]
pub struct SelectionState {
    /// List of available characters for selection.
    pub characters: Vec<CharacterEntry>,
    /// Index of character currently selected in selection screen.
    pub selected_character_index: usize,
}

#[derive(Debug, Clone)]
pub struct GameState {
    pub data: GameData,
    pub view: ViewState,
}

impl GameState {
    pub fn new(guid: Guid, name: String) -> Self {
        Self {
            data: GameData::new(guid, name),
            view: ViewState::default(),
        }
    }
}

impl Default for GameState {
    fn default() -> Self {
        Self {
            data: GameData::default(),
            view: ViewState::default(),
        }
    }
}

pub enum Page {
    Selection(SelectionState),
    Game(Box<GameState>),
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
    pub page: Page,
    pub modal: Option<Modal>,
    pub messages: Vec<ChatMessage>,
    pub input: String,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
    pub logon_retry: RetryState,
    pub enter_retry: RetryState,
    pub core_state: ClientState,
    pub net_stats: NetStats,
    pub chat_log: Option<Mutex<File>>,
    pub use_emojis: bool,
    pub verbosity: u8,
    pub wrapped_chat_cache: Vec<Vec<(String, Color)>>,
    pub last_chat_width: usize,
}

impl AppState {
    pub fn game_data(&self) -> &GameData {
        match &self.page {
            Page::Game(game) => &game.data,
            _ => panic!("Accessing GameData from non-game page!"),
        }
    }

    pub fn game_data_mut(&mut self) -> &mut GameData {
        match &mut self.page {
            Page::Game(game) => &mut game.data,
            _ => panic!("Accessing GameData from non-game page!"),
        }
    }

    pub fn game_view(&self) -> &ViewState {
        match &self.page {
            Page::Game(game) => &game.view,
            _ => panic!("Accessing ViewState from non-game page!"),
        }
    }

    pub fn game_view_mut(&mut self) -> &mut ViewState {
        match &mut self.page {
            Page::Game(game) => &mut game.view,
            _ => panic!("Accessing ViewState from non-game page!"),
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

    pub fn log_chat(&mut self, kind: ChatMessageKind, text: String) {
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

    pub fn maintain_scroll(&mut self, is_context: bool, current_total: usize, height: usize) {
        if let Some(game) = self.game_option_mut() {
            game.view.maintain_scroll(is_context, current_total, height);
        }
    }

    pub fn refresh_context_buffer(&mut self) {
        let (tab, view_is_default) = if let Some(game) = self.game_option() {
            (
                game.view.dashboard_tab,
                game.view.context_view == crate::ui::ContextView::Default,
            )
        } else {
            return;
        };

        if view_is_default {
            if let Some(game) = self.game_option_mut() {
                game.view.context_buffer.clear();
            }
            return;
        }

        let active_tab = crate::ui::widgets::dashboard::get_tab_controller(tab);
        if let Some(game) = self.game_option() {
            let content = active_tab.get_context_panel_content(&game, self);
            if let Some(game) = self.game_option_mut() {
                game.view.context_buffer = content;
            }
        }
    }

    pub fn dashboard_item_count(&self) -> usize {
        if let Some(game) = self.game_option() {
            let active_tab =
                crate::ui::widgets::dashboard::get_tab_controller(game.view.dashboard_tab);
            active_tab.get_item_count(&game, self)
        } else {
            0
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

        let state_str = match &self.core_state {
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
            self.log_chat(kind, msg);
        }
    }
}

impl AppState {
    pub(crate) fn update_inventory_recursive(&mut self, root: Guid, owned: bool) {
        if let Page::Game(ref mut game) = self.page {
            let mut stack = vec![root];
            while let Some(current) = stack.pop() {
                if owned {
                    game.data.inventory.insert(current);
                } else {
                    game.data.inventory.remove(&current);
                    game.data.equipment.remove(&current);
                }

                // Find children in game.data.entities
                let mut children = Vec::new();
                for (&guid, entity) in &game.data.entities {
                    if entity.container_id == Some(current) {
                        children.push(guid);
                    }
                }
                stack.extend(children);
            }
        }
    }

    pub fn get_container_counts(&self) -> HashMap<Guid, usize> {
        let mut counts = HashMap::new();
        if let Some(game) = self.game_option() {
            for e in game.data.entities.values() {
                if let Some(cid) = e.container_id {
                    *counts.entry(cid).or_default() += 1;
                }
            }
        }
        counts
    }
}
