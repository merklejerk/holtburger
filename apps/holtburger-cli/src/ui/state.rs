use std::time::Instant;
use std::collections::{HashMap, HashSet};
use holtburger_core::{ChatMessage, ClientState};
use holtburger_core::world::position::WorldPosition;
use holtburger_core::world::stats::{Attribute, Vital, Skill};
use holtburger_core::protocol::messages::Enchantment;
use holtburger_core::world::entity::Entity;
use crate::classification;
use super::types::{NearbyTab, UIState, FocusedPane, WIDTH_BREAKPOINT};

pub struct AppState {
    pub account_name: String,
    pub character_name: Option<String>,
    pub player_guid: Option<u32>,
    pub attributes: Vec<Attribute>,
    pub vitals: Vec<Vital>,
    pub skills: Vec<Skill>,
    pub messages: Vec<ChatMessage>,
    pub input: String,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
    pub characters: Vec<(u32, String)>,
    pub state: UIState,
    pub focused_pane: FocusedPane,
    pub previous_focused_pane: FocusedPane,
    pub selected_character_index: usize,
    pub selected_nearby_index: usize,
    pub nearby_list_state: ratatui::widgets::ListState,
    pub scroll_offset: usize,
    pub chat_total_lines: usize,
    pub nearby_tab: NearbyTab,
    pub context_buffer: Vec<String>,
    pub context_scroll_offset: usize,
    pub logon_retry: Option<(u32, u32, Option<Instant>)>,
    pub enter_retry: Option<(u32, u32, Option<Instant>)>,
    pub core_state: ClientState,
    pub player_pos: Option<WorldPosition>,
    pub player_enchantments: Vec<Enchantment>,
    pub entities: HashMap<u32, Entity>,
    pub server_time: Option<(f64, Instant)>,
}

impl AppState {
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

    pub fn nearby_item_count(&self) -> usize {
        match self.nearby_tab {
            NearbyTab::Entities => self
                .entities
                .values()
                .filter(|e| classification::is_targetable(e) && e.position.landblock_id != 0)
                .count(),
            NearbyTab::Inventory => self
                .entities
                .values()
                .filter(|e| e.position.landblock_id == 0 && !e.name.is_empty())
                .count(),
            NearbyTab::Effects => self.player_enchantments.len(),
            NearbyTab::Character => {
                let attr_count = self.attributes.len();
                let skill_count = self.skills.iter().filter(|s| s.skill_type.is_eor()).count();
                attr_count + skill_count + 3 // 2 headers + 1 spacer
            }
        }
    }

    pub fn get_filtered_nearby_entities(
        &self,
    ) -> Vec<(&Entity, f32, usize)> {
        let candidates: Vec<_> = self
            .entities
            .values()
            .filter(|e| {
                if self.nearby_tab == NearbyTab::Entities {
                    classification::is_targetable(e) && e.position.landblock_id != 0
                } else if self.nearby_tab == NearbyTab::Inventory {
                    e.position.landblock_id == 0 && !e.name.is_empty()
                } else {
                    false
                }
            })
            .collect();

        if candidates.is_empty() {
            return Vec::new();
        }

        // Build parent-child mapping for the subset
        let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut roots = Vec::new();

        let candidate_guids: HashSet<u32> = candidates.iter().map(|e| e.guid).collect();

        for e in &candidates {
            let parent_id = match self.nearby_tab {
                NearbyTab::Inventory => e.container_id,
                NearbyTab::Entities => e.container_id.or(e.wielder_id).or(e.physics_parent_id),
                _ => None,
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
            if self.nearby_tab == NearbyTab::Entities {
                let da = if let Some(p) = &self.player_pos {
                    ea.position.distance_to(p)
                } else {
                    0.0
                };
                let db = if let Some(p) = &self.player_pos {
                    eb.position.distance_to(p)
                } else {
                    0.0
                };
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            } else {
                ea.name.cmp(&eb.name)
            }
        });

        // Flatten with depth using DFS
        let mut result = Vec::new();
        let mut stack: Vec<(u32, usize)> = roots.into_iter().rev().map(|id| (id, 0)).collect();

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
}

pub fn get_next_pane(current: FocusedPane, width: u16) -> FocusedPane {
    if width < WIDTH_BREAKPOINT {
        // Narrow: Nearby -> Context -> Chat
        match current {
            FocusedPane::Nearby => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Nearby,
            _ => FocusedPane::Nearby,
        }
    } else {
        // Wide: Nearby -> Chat -> Context
        match current {
            FocusedPane::Nearby => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Nearby,
            _ => FocusedPane::Nearby,
        }
    }
}

pub fn get_prev_pane(current: FocusedPane, width: u16) -> FocusedPane {
    if width < WIDTH_BREAKPOINT {
        // Narrow reverse: Nearby -> Chat -> Context
        match current {
            FocusedPane::Nearby => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Nearby,
            _ => FocusedPane::Nearby,
        }
    } else {
        // Wide reverse: Nearby -> Context -> Chat
        match current {
            FocusedPane::Nearby => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Nearby,
            _ => FocusedPane::Nearby,
        }
    }
}
