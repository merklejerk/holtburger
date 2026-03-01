use std::collections::HashMap;

use holtburger_common::Guid;
use holtburger_core::{ClientState, RetryState};

use crate::types::ContextView;
use crate::ui::widgets::panels::modal::Modal;

pub mod game;
mod net;
mod page;
mod selection;
pub mod view;

pub use self::game::GameData;
pub use self::net::NetStats;
pub use self::page::Page;
pub use self::selection::SelectionState;
pub use self::view::ViewState;
pub use crate::pages::game::panels::chat::{ChatMessage, ChatMessageKind, ChatState};

#[derive(Debug, Clone, Default)]
pub struct GameState {
    pub data: GameData,
    pub dashboard: crate::pages::game::dashboard::DashboardState,
    pub view: ViewState,
}

impl GameState {
    pub fn new(guid: Guid, name: String, world_name: String) -> Self {
        Self {
            data: GameData::new(guid, name, world_name),
            dashboard: crate::pages::game::dashboard::DashboardState::default(),
            view: ViewState::default(),
        }
    }
}

pub struct AppState {
    pub account_name: String,
    pub account_password: String,
    pub page: Page,
    pub modal: Option<Modal>,
    pub chat: ChatState,
    pub input: String,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
    pub logon_retry: RetryState,
    pub enter_retry: RetryState,
    pub core_state: ClientState,
    pub net_stats: NetStats,
    pub world_name: String,
    pub verbosity: u8,
    pub ui_message_tx: tokio::sync::mpsc::UnboundedSender<crate::ui::UiMessage>,
}

impl AppState {
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

    pub fn get_container_counts(&self) -> HashMap<Guid, usize> {
        let mut counts = HashMap::new();
        if let Page::Game(game) = &self.page {
            for e in game.data.entities.values() {
                if let Some(cid) = e.container_id() {
                    *counts.entry(cid).or_default() += 1;
                }
            }
        }
        counts
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

    pub fn refresh_context_buffer(&mut self) {
        let (tab, view_is_default) = if let Some(game) = self.game_option() {
            (
                game.dashboard.active_tab,
                game.view.context_view == ContextView::Default,
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

        let active_tab = crate::pages::game::dashboard::get_tab_controller(tab);
        if let Some(game) = self.game_option() {
            let content = active_tab.get_context_panel_content(game);
            if let Some(game) = self.game_option_mut() {
                game.view.context_buffer = content;
            }
        }
    }

    pub fn dashboard_item_count(&self) -> usize {
        if let Some(game) = self.game_option() {
            let active_tab =
                crate::pages::game::dashboard::get_tab_controller(game.dashboard.active_tab);
            active_tab.get_item_count(game)
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
            self.chat.log(kind, msg);
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
                    if entity.container_id() == Some(current) {
                        children.push(guid);
                    }
                }
                stack.extend(children);
            }
        }
    }
}
