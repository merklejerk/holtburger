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
use holtburger_protocol::messages::CharacterEntry;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::{EquipMask, magic::Enchantment};

use super::types::{
    ActiveInteraction, ChatMessage, ChatMessageKind, ContextView, DashboardTab, FocusedPane, Modal,
    UIState,
};
use ratatui::style::Color;
use ratatui::text::Line;

pub struct AppState {
    /// Account name used for login.
    pub account_name: String,
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
    /// Historical chat and system messages.
    pub messages: Vec<ChatMessage>,
    /// Current text being typed in the input field.
    pub input: String,
    /// History of previous commands.
    pub input_history: Vec<String>,
    /// Current position in the input history.
    pub history_index: Option<usize>,
    /// List of available characters for selection.
    pub characters: Vec<CharacterEntry>,
    /// Overall UI state (Chat, Character selection, etc.).
    pub state: UIState,
    /// Active modal (blocks input if present).
    pub modal: Option<Modal>,
    /// Which area of the screen currently has focus.
    pub focused_pane: FocusedPane,
    /// Previous focus, used for returning from modals.
    pub previous_focused_pane: FocusedPane,
    /// Index of character currently selected in selection screen.
    pub selected_character_index: usize,
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
    /// Remembered password for potential reconnects.
    pub account_password: String,
    /// State tracking logon attempts.
    pub logon_retry: RetryState,
    /// State tracking world entry attempts.
    pub enter_retry: RetryState,
    /// The internal state from the client's core networking logic.
    pub core_state: ClientState,
    /// The current position of the player in the world.
    pub player_pos: Option<WorldPosition>,
    /// List of active enchantments affecting the player.
    pub player_enchantments: Vec<Enchantment>,
    /// List of spell IDs the character knows.
    pub player_spells: Vec<u32>,
    /// Lookup table from ID to name.
    pub spell_names: HashMap<u32, String>,
    /// Detailed spell data from dats.
    pub spell_info: HashMap<u32, Box<holtburger_dat::file_type::spell_table::SpellBase>>,
    /// Shared master skill information from dats.
    pub skill_table: Option<std::sync::Arc<holtburger_dat::file_type::skill_table::SkillTable>>,
    /// All game objects known to the client.
    pub entities: HashMap<Guid, Entity>,
    /// Latest server timestamp and local time sync point.
    pub server_time: Option<(f64, Instant)>,
    /// Handle to a local file for persistent chat logging.
    pub chat_log: Option<Mutex<File>>,
    /// Whether to show emojis in the chat.
    pub use_emojis: bool,
    /// Log verbosity level for system messages.
    pub verbosity: u8,
    /// Trackers for bandwidth usage.
    pub net_stats: NetStats,
    /// Name of the world we are on.
    pub world_name: String,
    /// Current combat stance.
    pub combat_mode: CombatMode,
    /// Debugging state for movement.
    pub noclip: bool,
    /// Set of GUIDs currently owned by the player.
    pub inventory: HashSet<Guid>,
    /// Map of GUIDs currently equipped by the player.
    pub equipment: HashMap<Guid, EquipMask>,
    /// Cached chat rendering with color/wrap info.
    pub wrapped_chat_cache: Vec<Vec<(String, Color)>>,
    /// Width used for the current chat cache.
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
            history_in: vec![0; 32],
            history_out: vec![0; 32],
            last_update: None,
        }
    }
}

impl AppState {
    pub(crate) fn update_inventory_recursive(&mut self, root: Guid, owned: bool) {
        let mut stack = vec![root];
        while let Some(current) = stack.pop() {
            if owned {
                self.inventory.insert(current);
            } else {
                self.inventory.remove(&current);
                self.equipment.remove(&current);
            }

            // Find children in self.entities
            for (&guid, entity) in &self.entities {
                if entity.container_id == Some(current) {
                    stack.push(guid);
                }
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
        let (scroll_offset, old_total) = if is_context {
            (
                &mut self.context_scroll_offset,
                &mut self.context_total_lines,
            )
        } else {
            (&mut self.scroll_offset, &mut self.chat_total_lines)
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

    pub fn get_container_counts(&self) -> HashMap<Guid, usize> {
        let mut counts = HashMap::new();
        for e in self.entities.values() {
            if let Some(cid) = e.container_id {
                *counts.entry(cid).or_default() += 1;
            }
        }
        counts
    }

    pub fn refresh_context_buffer(&mut self) {
        if self.context_view == ContextView::Default {
            self.context_buffer.clear();
            return;
        }

        let active_tab = crate::ui::widgets::dashboard::get_tab_controller(self.dashboard_tab);
        self.context_buffer = active_tab.get_context_panel_content(self);
    }

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

    pub fn dashboard_item_count(&self) -> usize {
        let active_tab = crate::ui::widgets::dashboard::get_tab_controller(self.dashboard_tab);
        active_tab.get_item_count(self)
    }

    pub fn display_client_info(&mut self) {
        self.log_chat(
            ChatMessageKind::System,
            "═══ CLIENT DEBUG INFO ═══".to_string(),
        );

        // Character info
        self.log_chat(
            ChatMessageKind::System,
            format!("Account: {}", self.account_name),
        );
        if let Some(name) = &self.character_name {
            self.log_chat(ChatMessageKind::System, format!("Character: {}", name));
        }
        if let Some(guid) = self.player_guid {
            self.log_chat(ChatMessageKind::System, format!("GUID: {:#010X}", guid.0));
        }

        // Client state
        let state_str = match &self.core_state {
            ClientState::Connected => "Connected",
            ClientState::CharacterSelection(_) => "Character Selection",
            ClientState::EnteringWorld => "Entering World",
            ClientState::InWorld => "In World",
            ClientState::Disconnected => "Disconnected",
        };
        self.log_chat(ChatMessageKind::System, format!("State: {}", state_str));

        // Position info - copy position first to avoid borrow issues
        let pos_copy = self.player_pos;
        if let Some(pos) = pos_copy {
            self.log_chat(ChatMessageKind::System, "".to_string());
            self.log_chat(ChatMessageKind::System, "═══ POSITION ═══".to_string());
            self.log_chat(
                ChatMessageKind::System,
                format!("Landblock: {:#010X}", pos.landblock_id),
            );
            self.log_chat(
                ChatMessageKind::System,
                format!(
                    "Euclidean: ({:.2}, {:.2}, {:.2})",
                    pos.coords.x, pos.coords.y, pos.coords.z
                ),
            );

            let world_coords = pos.to_world_coords();
            self.log_chat(
                ChatMessageKind::System,
                format!("Geographic: {}", world_coords),
            );

            if pos.is_indoors() {
                self.log_chat(ChatMessageKind::System, "Location: Indoors".to_string());
            } else {
                let (lb_x, lb_y) = pos.landblock_coords();
                let (cell_x, cell_y) = pos.cell_coords();
                self.log_chat(
                    ChatMessageKind::System,
                    format!("Landblock Coords: ({}, {})", lb_x, lb_y),
                );
                self.log_chat(
                    ChatMessageKind::System,
                    format!("Cell Coords: ({}, {})", cell_x, cell_y),
                );
            }

            self.log_chat(
                ChatMessageKind::System,
                format!(
                    "Rotation: (w={:.3}, x={:.3}, y={:.3}, z={:.3})",
                    pos.rotation.w, pos.rotation.x, pos.rotation.y, pos.rotation.z
                ),
            );
        } else {
            self.log_chat(ChatMessageKind::System, "Position: Unknown".to_string());
        }

        // Entity counts
        self.log_chat(ChatMessageKind::System, "".to_string());
        self.log_chat(ChatMessageKind::System, "═══ ENTITIES ═══".to_string());
        let world_entities = self
            .entities
            .values()
            .filter(|e| e.position.landblock_id != Guid::NULL)
            .count();
        let inventory_items = self
            .entities
            .values()
            .filter(|e| e.position.landblock_id == Guid::NULL)
            .count();
        self.log_chat(
            ChatMessageKind::System,
            format!("World Entities: {}", world_entities),
        );
        self.log_chat(
            ChatMessageKind::System,
            format!("Inventory Items: {}", inventory_items),
        );
        self.log_chat(
            ChatMessageKind::System,
            format!("Total Entities: {}", self.entities.len()),
        );

        // Effects
        if !self.player_enchantments.is_empty() {
            self.log_chat(
                ChatMessageKind::System,
                format!("Active Effects: {}", self.player_enchantments.len()),
            );
        }

        // Server time
        if let Some((server_time, instant)) = self.server_time {
            self.log_chat(ChatMessageKind::System, "".to_string());
            self.log_chat(ChatMessageKind::System, "═══ TIME ═══".to_string());
            let current = self.current_server_time();
            self.log_chat(
                ChatMessageKind::System,
                format!("Server Time: {:.2}", current),
            );
            let elapsed = instant.elapsed().as_secs_f64();
            self.log_chat(
                ChatMessageKind::System,
                format!("Sync Elapsed: {:.2}s", elapsed),
            );
            self.log_chat(
                ChatMessageKind::System,
                format!("Original Sync: {:.2}", server_time),
            );
        }

        self.log_chat(ChatMessageKind::System, "═══════════════════".to_string());
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

    pub fn is_wielding_caster(&self) -> bool {
        self.get_suggested_combat_mode() == CombatMode::Magic
    }
}
