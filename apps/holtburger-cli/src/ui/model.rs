use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Write;
use std::sync::Mutex;
use std::time::Instant;

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::ItemType;
use holtburger_core::world::entity::Entity;
use holtburger_core::world::stats::{
    Attribute, AttributeType, CharacterLevelInfo, Skill, SkillType, Vital, VitalType,
};
use holtburger_core::{ClientState, RetryState};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::{CharacterEntry, EquipMask, magic::Enchantment};

use super::types::{
    ActiveInteraction, ChatMessage, ChatMessageKind, ContextView, DashboardTab, FocusedPane, Modal,
    NET_PULSE_HISTORY_SIZE,
};
use ratatui::style::Color;
use ratatui::text::Line;

#[derive(Debug, Default)]
pub struct SelectionState {
    /// List of available characters for selection.
    pub characters: Vec<CharacterEntry>,
    /// Index of character currently selected in selection screen.
    pub selected_character_index: usize,
}

pub struct GameState {
    /// Current character name once selected.
    pub character_name: Option<String>,
    /// Unique ID of the player character.
    pub player_guid: Option<Guid>,
    /// Info about level, luminance, and XP.
    pub level_info: Option<CharacterLevelInfo>,
    /// Base and current values for Strength, Endurance, etc.
    pub attributes: HashMap<AttributeType, Attribute>,
    /// Health, Stamina, and Mana values.
    pub vitals: HashMap<VitalType, Vital>,
    /// Skills like Sword, Mace, Magic Defense.
    pub skills: HashMap<SkillType, Skill>,
    /// Calculated damage resistance values.
    pub resistances: holtburger_core::world::stats::Resistances,
    /// Total armor value.
    pub armor: i32,
    /// Current vitae penalty (0.0 to 1.0, where 1.0 is no penalty).
    pub vitae: f32,
    /// Which area of the screen currently has focus.
    pub focused_pane: FocusedPane,
    /// Previous focus, used for returning from modals.
    pub previous_focused_pane: FocusedPane,
    /// Index of item currently selected in the dashboard.
    pub selected_dashboard_index: usize,
    /// Internal state for the dashboard's ratatui List widget.
    pub dashboard_list_state: ratatui::widgets::ListState,
    /// Used to keep track of height for scrolling.
    pub last_dashboard_height: usize,
    /// Current vertical scroll position of the chat.
    pub scroll_offset: usize,
    /// Cached total line count for chat.
    pub chat_total_lines: usize,
    /// Used to detect chat resizing.
    pub chat_last_total_lines: usize,
    /// Cached total line count for context/debug view.
    pub context_total_lines: usize,
    /// Used to detect context resizing.
    pub context_last_total_lines: usize,
    /// Current active tab in the dashboard.
    pub dashboard_tab: DashboardTab,
    /// Pre-wrapped lines of text for the right-hand panel.
    pub context_buffer: Vec<Line<'static>>,
    /// Current vertical scroll position of the context panel.
    pub context_scroll_offset: usize,
    /// What information should be displayed in the context panel.
    pub context_view: ContextView,
    /// GUID of the entity we are currently "debugging".
    pub current_debug_guid: Option<Guid>,
    /// State of current interaction like vendor transactions.
    pub active_interaction: Option<ActiveInteraction>,
    /// Current position in the world.
    pub player_pos: Option<WorldPosition>,
    /// Active enchantments on the player.
    pub player_enchantments: Vec<Enchantment>,
    /// List of learned spell IDs.
    pub player_spells: Vec<u32>,
    /// User-friendly names for spells.
    pub spell_names: HashMap<u32, String>,
    /// Details about spell effects.
    pub spell_info: HashMap<u32, Box<holtburger_dat::file_type::spell_table::SpellBase>>,
    /// Master skill system table.
    pub skill_table: Option<std::sync::Arc<holtburger_dat::file_type::skill_table::SkillTable>>,
    /// Local cache of nearby entities.
    pub entities: HashMap<Guid, Entity>,
    /// Current estimated server time and when it was last synced.
    pub server_time: Option<(f64, Instant)>,
    /// Server name (e.g. "Morningthaw").
    pub world_name: String,
    /// Current combat stances.
    pub combat_mode: CombatMode,
    /// Whether we can walk through walls (debug feature).
    pub noclip: bool,
    /// Every entity currently in player's pack.
    pub inventory: HashSet<Guid>,
    /// Map of GUIDs currently equipped on the character.
    pub equipment: HashMap<Guid, EquipMask>,
}

pub enum Page {
    Selection(SelectionState),
    Game(Box<GameState>),
}

pub struct AppState {
    /// Account name used for login.
    pub account_name: String,
    /// Remembered password for potential reconnects.
    pub account_password: String,
    /// The active page holds its OWN exclusive state.
    pub page: Page,
    /// Active modal (blocks input if present).
    pub modal: Option<Modal>,
    /// Historical chat and system messages.
    pub messages: Vec<ChatMessage>,
    /// Current text being typed in the input field.
    pub input: String,
    /// History of previous commands.
    pub input_history: Vec<String>,
    /// Current position in the input history.
    pub history_index: Option<usize>,
    /// State tracking logon attempts.
    pub logon_retry: RetryState,
    /// State tracking world entry attempts.
    pub enter_retry: RetryState,
    /// The internal state from the client's core networking logic.
    pub core_state: ClientState,
    /// Trackers for bandwidth usage.
    pub net_stats: NetStats,
    /// Handle to a local file for persistent chat logging.
    pub chat_log: Option<Mutex<File>>,
    /// Whether to show emojis in the chat.
    pub use_emojis: bool,
    /// Log verbosity level for system messages.
    pub verbosity: u8,
    /// Pre-wrapped chat lines for rendering.
    pub wrapped_chat_cache: Vec<Vec<(String, Color)>>,
    /// Width of the chat pane during last wrap.
    pub last_chat_width: usize,
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

impl Default for GameState {
    fn default() -> Self {
        Self {
            character_name: None,
            player_guid: None,
            level_info: None,
            attributes: HashMap::new(),
            vitals: HashMap::new(),
            skills: HashMap::new(),
            resistances: holtburger_core::world::stats::Resistances::default(),
            armor: 0,
            vitae: 1.0,
            focused_pane: FocusedPane::Dashboard,
            previous_focused_pane: FocusedPane::Dashboard,
            selected_dashboard_index: 0,
            dashboard_list_state: ratatui::widgets::ListState::default(),
            last_dashboard_height: 0,
            scroll_offset: 0,
            chat_total_lines: 0,
            chat_last_total_lines: 0,
            context_total_lines: 0,
            context_last_total_lines: 0,
            dashboard_tab: DashboardTab::Nearby,
            context_buffer: Vec::new(),
            context_scroll_offset: 0,
            context_view: ContextView::Default,
            current_debug_guid: None,
            active_interaction: None,
            player_pos: None,
            player_enchantments: Vec::new(),
            player_spells: Vec::new(),
            spell_names: HashMap::new(),
            spell_info: HashMap::new(),
            skill_table: None,
            entities: HashMap::new(),
            server_time: None,
            world_name: "Dereth".to_string(),
            combat_mode: CombatMode::NonCombat,
            noclip: false,
            inventory: HashSet::new(),
            equipment: HashMap::new(),
        }
    }
}

impl GameState {
    pub fn is_wielding_caster(&self) -> bool {
        self.get_suggested_combat_mode() == CombatMode::Magic
    }

    pub fn get_suggested_combat_mode(&self) -> CombatMode {
        let mut best = CombatMode::Melee;
        for guid in self.equipment.keys() {
            if let Some(entity) = self.entities.get(guid)
                && let Some(it) = entity.item_type
            {
                if it.intersects(ItemType::CASTER) {
                    return CombatMode::Magic;
                }
                if it.intersects(ItemType::MISSILE_WEAPON) {
                    best = CombatMode::Missile;
                }
            }
        }
        best
    }

    pub fn new(guid: Guid, name: String) -> Self {
        Self {
            character_name: Some(name),
            player_guid: Some(guid),
            level_info: None,
            attributes: HashMap::new(),
            vitals: HashMap::new(),
            skills: HashMap::new(),
            resistances: holtburger_core::world::stats::Resistances::default(),
            armor: 0,
            vitae: 1.0,
            focused_pane: FocusedPane::Dashboard,
            previous_focused_pane: FocusedPane::Dashboard,
            selected_dashboard_index: 0,
            dashboard_list_state: ratatui::widgets::ListState::default(),
            last_dashboard_height: 0,
            scroll_offset: 0,
            chat_total_lines: 0,
            chat_last_total_lines: 0,
            context_total_lines: 0,
            context_last_total_lines: 0,
            dashboard_tab: DashboardTab::Nearby,
            context_buffer: Vec::new(),
            context_scroll_offset: 0,
            context_view: ContextView::Default,
            current_debug_guid: None,
            active_interaction: None,
            player_pos: None,
            player_enchantments: Vec::new(),
            player_spells: Vec::new(),
            spell_names: HashMap::new(),
            spell_info: HashMap::new(),
            skill_table: None,
            entities: HashMap::new(),
            server_time: None,
            world_name: "Dereth".to_string(), // Default
            combat_mode: CombatMode::NonCombat,
            noclip: false,
            inventory: HashSet::new(),
            equipment: HashMap::new(),
        }
    }
}

impl AppState {
    pub fn game(&self) -> &GameState {
        match &self.page {
            Page::Game(game) => game,
            _ => panic!("Accessing GameState from non-game page!"),
        }
    }

    pub fn game_mut(&mut self) -> &mut GameState {
        match &mut self.page {
            Page::Game(game) => game,
            _ => panic!("Accessing GameState from non-game page!"),
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

    pub(crate) fn update_inventory_recursive(&mut self, root: Guid, owned: bool) {
        if let Page::Game(ref mut game) = self.page {
            let mut stack = vec![root];
            while let Some(current) = stack.pop() {
                if owned {
                    game.inventory.insert(current);
                } else {
                    game.inventory.remove(&current);
                    game.equipment.remove(&current);
                }

                // Find children in game.entities
                let mut children = Vec::new();
                for (&guid, entity) in &game.entities {
                    if entity.container_id == Some(current) {
                        children.push(guid);
                    }
                }
                stack.extend(children);
            }
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

        // Memory Guard: Prune to 4000 messages (2x window size) to avoid unbounded growth
        const MAX_CHAT: usize = 4000;
        if self.messages.len() > MAX_CHAT {
            let drop_count = self.messages.len() - MAX_CHAT;
            self.messages.drain(0..drop_count);

            // Sync the wrapped cache too if it has been populated
            if self.wrapped_chat_cache.len() > drop_count {
                self.wrapped_chat_cache.drain(0..drop_count);
            } else {
                self.wrapped_chat_cache.clear();
            }
        }
    }

    pub fn maintain_scroll(&mut self, is_context: bool, current_total: usize, height: usize) {
        if let Some(game) = self.game_option_mut() {
            let (scroll_offset, old_total) = if is_context {
                (
                    &mut game.context_scroll_offset,
                    &mut game.context_total_lines,
                )
            } else {
                (&mut game.scroll_offset, &mut game.chat_total_lines)
            };

            if *old_total > 0 && current_total != *old_total {
                if current_total > *old_total {
                    let diff = current_total - *old_total;
                    if *scroll_offset > 0 {
                        *scroll_offset += diff;
                    }
                } else {
                    // Buffer shrank (pruning)
                    let diff = *old_total - current_total;
                    *scroll_offset = scroll_offset.saturating_sub(diff);
                }
            }

            let max_scroll = current_total.saturating_sub(height);
            *scroll_offset = (*scroll_offset).min(max_scroll);
            *old_total = current_total;
        }
    }

    pub fn get_container_counts(&self) -> HashMap<Guid, usize> {
        let mut counts = HashMap::new();
        if let Some(game) = self.game_option() {
            for e in game.entities.values() {
                if let Some(cid) = e.container_id {
                    *counts.entry(cid).or_default() += 1;
                }
            }
        }
        counts
    }

    pub fn refresh_context_buffer(&mut self) {
        let (tab, view_is_default) = if let Some(game) = self.game_option() {
            (
                game.dashboard_tab,
                game.context_view == ContextView::Default,
            )
        } else {
            return;
        };

        if view_is_default {
            if let Some(game) = self.game_option_mut() {
                game.context_buffer.clear();
            }
            return;
        }

        let active_tab = crate::ui::widgets::dashboard::get_tab_controller(tab);
        if let Some(game) = self.game_option() {
            let content = active_tab.get_context_panel_content(game, self);
            if let Some(game) = self.game_option_mut() {
                game.context_buffer = content;
            }
        }
    }

    pub fn current_server_time(&self) -> f64 {
        if let Some(game) = self.game_option() {
            match game.server_time {
                Some((server_val, local_then)) => {
                    let elapsed = local_then.elapsed().as_secs_f64();
                    server_val + elapsed
                }
                None => std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64(),
            }
        } else {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs_f64()
        }
    }

    pub fn dashboard_item_count(&self) -> usize {
        if let Some(game) = self.game_option() {
            let active_tab = crate::ui::widgets::dashboard::get_tab_controller(game.dashboard_tab);
            active_tab.get_item_count(game, self)
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

        // Character info
        logs.push((
            ChatMessageKind::System,
            format!("Account: {}", self.account_name),
        ));

        if let Some(game) = self.game_option() {
            if let Some(name) = &game.character_name {
                logs.push((ChatMessageKind::System, format!("Character: {}", name)));
            }
            if let Some(guid) = game.player_guid {
                logs.push((ChatMessageKind::System, format!("GUID: {:#010X}", guid.0)));
            }
        }

        // Client state
        let state_str = match &self.core_state {
            ClientState::Connected => "Connected",
            ClientState::CharacterSelection(_) => "Character Selection",
            ClientState::EnteringWorld => "Entering World",
            ClientState::InWorld => "In World",
            ClientState::Disconnected => "Disconnected",
        };
        logs.push((ChatMessageKind::System, format!("State: {}", state_str)));

        if let Some(game) = self.game_option() {
            // Position info - copy position first to avoid borrow issues
            let pos_copy = game.player_pos;
            if let Some(pos) = pos_copy {
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

                let world_coords = pos.to_world_coords();
                logs.push((
                    ChatMessageKind::System,
                    format!("Geographic: {}", world_coords),
                ));

                if pos.is_indoors() {
                    logs.push((ChatMessageKind::System, "Location: Indoors".to_string()));
                } else {
                    let (lb_x, lb_y) = pos.landblock_coords();
                    let (cell_x, cell_y) = pos.cell_coords();
                    logs.push((
                        ChatMessageKind::System,
                        format!("Landblock Coords: ({}, {})", lb_x, lb_y),
                    ));
                    logs.push((
                        ChatMessageKind::System,
                        format!("Cell Coords: ({}, {})", cell_x, cell_y),
                    ));
                }

                logs.push((
                    ChatMessageKind::System,
                    format!(
                        "Rotation: (w={:.3}, x={:.3}, y={:.3}, z={:.3})",
                        pos.rotation.w, pos.rotation.x, pos.rotation.y, pos.rotation.z
                    ),
                ));
            } else {
                logs.push((ChatMessageKind::System, "Position: Unknown".to_string()));
            }

            // Entity counts
            logs.push((ChatMessageKind::System, "".to_string()));
            logs.push((ChatMessageKind::System, "═══ ENTITIES ═══".to_string()));
            let world_entities = game
                .entities
                .values()
                .filter(|e| e.position.landblock_id != Guid::NULL)
                .count();
            let inventory_items = game
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
                format!("Total Entities: {}", game.entities.len()),
            ));

            // Effects
            if !game.player_enchantments.is_empty() {
                logs.push((
                    ChatMessageKind::System,
                    format!("Active Effects: {}", game.player_enchantments.len()),
                ));
            }

            // Server time
            if let Some((server_time, instant)) = game.server_time {
                logs.push((ChatMessageKind::System, "".to_string()));
                logs.push((ChatMessageKind::System, "═══ TIME ═══".to_string()));
                let current = server_time + instant.elapsed().as_secs_f64();
                logs.push((
                    ChatMessageKind::System,
                    format!("Server Time: {:.2}", current),
                ));
                let elapsed = instant.elapsed().as_secs_f64();
                logs.push((
                    ChatMessageKind::System,
                    format!("Sync Elapsed: {:.2}s", elapsed),
                ));
                logs.push((
                    ChatMessageKind::System,
                    format!("Original Sync: {:.2}", server_time),
                ));
            }
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
