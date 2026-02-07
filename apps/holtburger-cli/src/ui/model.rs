use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Write;
use std::sync::Mutex;
use std::time::Instant;

use holtburger_core::protocol::messages::{CharacterEntry, Enchantment};
use holtburger_core::world::entity::Entity;
use holtburger_core::world::guid::Guid;
use holtburger_core::world::position::WorldPosition;
use holtburger_core::world::stats::{Attribute, AttributeType, Skill, SkillType, Vital, VitalType};
use holtburger_core::{ClientState, RetryState};

use super::types::{ChatMessage, ChatMessageKind, ContextView, DashboardTab, FocusedPane, UIState};
use crate::classification;
use crate::ui::widgets::effects::get_enchantment_name;

pub struct AppState {
    pub account_name: String,
    pub character_name: Option<String>,
    pub player_guid: Option<Guid>,
    pub attributes: HashMap<AttributeType, Attribute>,
    pub vitals: HashMap<VitalType, Vital>,
    pub skills: HashMap<SkillType, Skill>,
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
    pub context_buffer: Vec<String>,
    pub context_scroll_offset: usize,
    pub context_view: ContextView,
    pub account_password: String,
    pub logon_retry: RetryState,
    pub enter_retry: RetryState,
    pub core_state: ClientState,
    pub player_pos: Option<WorldPosition>,
    pub player_enchantments: Vec<Enchantment>,
    pub entities: HashMap<Guid, Entity>,
    pub inventory_entities: HashMap<Guid, Entity>,
    pub server_time: Option<(f64, Instant)>,
    pub chat_log: Option<Mutex<File>>,
    pub use_emojis: bool,
    pub verbosity: u8,
}

impl AppState {
    pub fn log_chat(&mut self, kind: ChatMessageKind, text: String) {
        if let Some(log_mutex) = &self.chat_log
            && let Ok(mut file) = log_mutex.lock()
        {
            let _ = writeln!(file, "{}", text);
            let _ = file.flush();
        }
        self.messages.push(ChatMessage { kind, text });
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
        if self.context_view == ContextView::Custom {
            return;
        }
        self.context_buffer.clear();
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
            DashboardTab::Entities => self
                .entities
                .values()
                .filter(|e| classification::is_targetable(e) && e.position.landblock_id != 0)
                .count(),
            DashboardTab::Inventory => self
                .entities
                .values()
                .filter(|e| e.position.landblock_id == 0 && !e.name.is_empty())
                .count(),
            DashboardTab::Effects => self.get_effects_list_enchantments().len(),
            DashboardTab::Character => {
                let attr_count = self.attributes.len();
                let skill_count = self
                    .skills
                    .values()
                    .filter(|s| s.skill_type.is_eor())
                    .count();
                attr_count + skill_count + 3 // 2 headers + 1 spacer
            }
        }
    }

    fn get_filtered_entities(&self, filter_inventory: bool) -> Vec<(&Entity, f32, usize)> {
        let candidates: Vec<_> = self
            .entities
            .values()
            .filter(|e| {
                if !filter_inventory {
                    classification::is_targetable(e) && e.position.landblock_id != 0
                } else {
                    e.position.landblock_id == 0 && !e.name.is_empty()
                }
            })
            .collect();

        if candidates.is_empty() {
            return Vec::new();
        }

        // Build parent-child mapping for the subset
        let mut children_map: HashMap<Guid, Vec<Guid>> = HashMap::new();
        let mut roots = Vec::new();

        let candidate_guids: HashSet<Guid> = candidates.iter().map(|e| e.guid).collect();

        for e in &candidates {
            let parent_id = if filter_inventory {
                e.container_id
            } else {
                e.container_id.or(e.wielder_id).or(e.physics_parent_id)
            };

            let is_root = if let Some(pid) = parent_id {
                if Some(pid) == self.player_guid {
                    true
                } else {
                    !candidate_guids.contains(&pid)
                }
            } else {
                true
            };

            if is_root {
                roots.push(e.guid);
            } else {
                children_map
                    .entry(parent_id.unwrap())
                    .or_default()
                    .push(e.guid);
            }
        }

        // Sort roots (by distance for Entities, by name for Inventory)
        roots.sort_by(|&a, &b| {
            let ea = &self.entities[&a];
            let eb = &self.entities[&b];
            if !filter_inventory {
                let da = if let Some(p) = &self.player_pos {
                    ea.position.distance_to(p)
                } else {
                    999.0
                };
                let db = if let Some(p) = &self.player_pos {
                    eb.position.distance_to(p)
                } else {
                    999.0
                };
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            } else {
                ea.name.cmp(&eb.name)
            }
        });

        // Flatten with depth using DFS
        let mut result = Vec::new();
        let mut stack: Vec<(Guid, usize)> = roots.into_iter().rev().map(|id| (id, 0)).collect();

        while let Some((guid, depth)) = stack.pop() {
            let e = &self.entities[&guid];
            let dist = if let Some(p) = &self.player_pos {
                e.position.distance_to(p)
            } else {
                0.0
            };
            result.push((e, dist, depth));

            if let Some(mut children) = children_map.remove(&guid) {
                children.sort_by(|&a, &b| self.entities[&a].name.cmp(&self.entities[&b].name));
                for child_guid in children.into_iter().rev() {
                    stack.push((child_guid, depth + 1));
                }
            }
        }

        result
    }

    pub fn get_filtered_nearby_tab(&self) -> Vec<(&Entity, f32, usize)> {
        self.get_filtered_entities(false)
    }

    pub fn get_filtered_inventory_tab(&self) -> Vec<(&Entity, f32, usize)> {
        self.get_filtered_entities(true)
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
            let a_name = get_enchantment_name(a_list[0]);
            let b_name = get_enchantment_name(b_list[0]);
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
}
