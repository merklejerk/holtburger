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
    ActiveInteraction, ChatMessage, ChatMessageKind, ContextView, DashboardTab, FocusedPane,
    UIState,
};
use crate::ui::traits::TabController;
use crate::ui::widgets::dashboard::filter::{EntityFilter, filter_entities};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};

pub struct AppState {
    pub account_name: String,
    pub character_name: Option<String>,
    pub player_guid: Option<Guid>,
    pub level_info: Option<CharacterLevelInfo>,
    pub attributes: HashMap<AttributeType, Attribute>,
    pub vitals: HashMap<VitalType, Vital>,
    pub skills: HashMap<SkillType, Skill>,
    pub resistances: holtburger_core::world::stats::Resistances,
    pub armor: i32,
    pub vitae: f32,
    pub messages: Vec<ChatMessage>,
    pub input: String,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
    pub characters: Vec<CharacterEntry>,
    pub state: UIState,
    pub focused_pane: FocusedPane,
    pub previous_focused_pane: FocusedPane,
    pub selected_character_index: usize,
    pub selected_dashboard_index: usize,
    pub dashboard_list_state: ratatui::widgets::ListState,
    pub last_dashboard_height: usize,
    pub scroll_offset: usize,
    pub chat_total_lines: usize,
    pub chat_last_total_lines: usize,
    pub context_total_lines: usize,
    pub context_last_total_lines: usize,
    pub dashboard_tab: DashboardTab,
    pub context_buffer: Vec<Line<'static>>,
    pub context_scroll_offset: usize,
    pub context_view: ContextView,
    pub current_debug_guid: Option<Guid>,
    pub active_interaction: Option<ActiveInteraction>,
    pub account_password: String,
    pub logon_retry: RetryState,
    pub enter_retry: RetryState,
    pub core_state: ClientState,
    pub player_pos: Option<WorldPosition>,
    pub player_enchantments: Vec<Enchantment>,
    pub player_spells: Vec<u32>,
    pub spell_names: HashMap<u32, String>,
    pub spell_info: HashMap<u32, Box<holtburger_dat::file_type::spell_table::SpellBase>>,
    pub skill_table: Option<std::sync::Arc<holtburger_dat::file_type::skill_table::SkillTable>>,
    pub entities: HashMap<Guid, Entity>,
    pub server_time: Option<(f64, Instant)>,
    pub chat_log: Option<Mutex<File>>,
    pub use_emojis: bool,
    pub verbosity: u8,
    pub net_stats: NetStats,
    pub world_name: String,
    pub combat_mode: CombatMode,
    pub noclip: bool,
    pub inventory: HashSet<Guid>,
    pub equipment: HashMap<Guid, EquipMask>,
    pub wrapped_chat_cache: Vec<Vec<(String, Color)>>,
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
            history_in: vec![0; 64],
            history_out: vec![0; 64],
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

    pub fn refresh_context_buffer(&mut self) {
        match self.context_view {
            ContextView::Custom => {
                if let Some(guid) = self.current_debug_guid
                    && let Some(entity) = self.entities.get(&guid)
                {
                    let target = crate::ui::types::CommandTarget::Entity(entity, None);
                    let player_guid = self.player_guid;
                    let entities_ref = &self.entities;

                    let player_info = if Some(guid) == player_guid {
                        Some(crate::ui::widgets::dashboard::debug::PlayerDebugInfo {
                            attributes: &self.attributes,
                            vitals: &self.vitals,
                            skills: &self.skills,
                            enchantments: &self.player_enchantments,
                        })
                    } else {
                        None
                    };

                    self.context_buffer = crate::ui::widgets::dashboard::debug::get_debug_info(
                        &target,
                        |id| {
                            entities_ref.get(&id).map(|e| e.name.clone()).or_else(|| {
                                if Some(id) == player_guid {
                                    Some("You".to_string())
                                } else {
                                    None
                                }
                            })
                        },
                        Some(&self.spell_info),
                        player_info,
                    );
                }
            }
            ContextView::Assess(guid) => {
                if let Some(entity) = self.entities.get(&guid) {
                    self.context_buffer =
                        crate::ui::widgets::dashboard::assess::get_assess_info(entity);
                } else {
                    self.context_buffer = vec![Line::from(vec![
                        Span::styled("Error: ", Style::default().fg(Color::Red)),
                        Span::styled("Entity data missing", Style::default().fg(Color::Gray)),
                    ])];
                }
            }
            ContextView::Spell(spell_id) => {
                let target = crate::ui::types::CommandTarget::Spell(spell_id);
                self.context_buffer = crate::ui::widgets::dashboard::debug::get_debug_info(
                    &target,
                    |_| None,
                    Some(&self.spell_info),
                    None,
                );
            }
            ContextView::Default => {
                self.context_buffer.clear();
            }
        }
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
        match self.dashboard_tab {
            DashboardTab::Nearby => {
                use crate::ui::widgets::dashboard::NearbyTab;
                NearbyTab.get_item_count(self)
            }
            DashboardTab::Inventory => {
                use crate::ui::widgets::dashboard::InventoryTab;
                InventoryTab.get_item_count(self)
            }
            DashboardTab::Equip => {
                use crate::ui::widgets::dashboard::EquipTab;
                EquipTab.get_item_count(self)
            }
            DashboardTab::Spells => {
                use crate::ui::widgets::dashboard::SpellsTab;
                SpellsTab.get_item_count(self)
            }
            DashboardTab::Character => {
                use crate::ui::widgets::dashboard::CharacterTab;
                CharacterTab.get_item_count(self)
            }
        }
    }

    pub fn get_filtered_nearby_tab(&self) -> Vec<(&Entity, f32, usize)> {
        filter_entities(
            &self.entities,
            self.player_guid,
            &self.inventory,
            &self.equipment,
            self.player_pos.as_ref(),
            EntityFilter::World,
        )
    }

    pub fn get_filtered_inventory_tab(&self) -> Vec<(&Entity, f32, usize)> {
        filter_entities(
            &self.entities,
            self.player_guid,
            &self.inventory,
            &self.equipment,
            self.player_pos.as_ref(),
            EntityFilter::Inventory,
        )
    }

    pub fn get_effects_list_enchantments(&self) -> Vec<(&Enchantment, bool)> {
        let mut by_category: HashMap<u16, Vec<&Enchantment>> = HashMap::new();
        for e in &self.player_enchantments {
            by_category.entry(e.spell_category).or_default().push(e);
        }

        let mut categories: Vec<_> = by_category.into_iter().collect();

        // Sort enchantments within each category (winner first: Power -> StartTime)
        for (_, list) in categories.iter_mut() {
            list.sort_by(|a, b| b.compare_priority(a));
        }

        // Sort categories by the winner's mod name
        categories.sort_by(|(_, a_list), (_, b_list)| {
            let a_name =
                holtburger_core::world::magic::get_enchantment_name(a_list[0], &self.spell_names);
            let b_name =
                holtburger_core::world::magic::get_enchantment_name(b_list[0], &self.spell_names);
            a_name.cmp(&b_name)
        });

        let mut flattened = Vec::new();
        for (_, list) in categories {
            for (i, &enchant) in list.iter().enumerate() {
                flattened.push((enchant, i > 0));
            }
        }
        flattened
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

    pub fn is_wielding_caster(&self) -> bool {
        for guid in self.equipment.keys() {
            if let Some(entity) = self.entities.get(guid)
                && let Some(it) = entity.item_type
                && it.intersects(ItemType::CASTER)
            {
                return true;
            }
        }
        false
    }
}
