use super::types::{AppAction, ContextView, DashboardTab, FocusedPane, UIState, WIDTH_BREAKPOINT};
use crate::actions::{self, ActionHandler, ActionTarget};
use crate::classification;
use crate::ui;
use crate::ui::widgets::effects::get_enchantment_name;
use crossterm::event::{KeyCode, MouseButton, MouseEventKind};
use holtburger_core::ClientEvent;
use holtburger_core::protocol::messages::{CharacterEntry, Enchantment};
use holtburger_core::world::entity::Entity;
use holtburger_core::world::position::WorldPosition;
use holtburger_core::world::stats::{Attribute, Skill, Vital};
use holtburger_core::world::WorldEvent;
use holtburger_core::{ChatMessage, ClientCommand, ClientState};
use std::collections::{HashMap, HashSet};
use std::time::Instant;

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
    pub context_total_lines: usize,
    pub dashboard_tab: DashboardTab,
    pub context_buffer: Vec<String>,
    pub context_scroll_offset: usize,
    pub context_view: ContextView,
    pub logon_retry: Option<(u32, u32, Option<Instant>)>,
    pub enter_retry: Option<(u32, u32, Option<Instant>)>,
    pub core_state: ClientState,
    pub player_pos: Option<WorldPosition>,
    pub player_enchantments: Vec<Enchantment>,
    pub entities: HashMap<u32, Entity>,
    pub server_time: Option<(f64, Instant)>,
    pub use_emojis: bool,
}

impl AppState {
    pub fn maintain_scroll(
        &mut self,
        is_context: bool,
        current_total: usize,
        height: usize,
    ) {
        let (scroll_offset, old_total) = if is_context {
            (&mut self.context_scroll_offset, &mut self.context_total_lines)
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

    pub fn handle_action(&mut self, action: AppAction) -> Vec<ClientCommand> {
        let mut commands = Vec::new();

        match action {
            AppAction::Tick(elapsed) => {
                // Enforce dashboard index bounds
                let dashboard_count = self.dashboard_item_count();
                if self.selected_dashboard_index >= dashboard_count && dashboard_count > 0 {
                    self.selected_dashboard_index = dashboard_count - 1;
                } else if dashboard_count == 0 {
                    self.selected_dashboard_index = 0;
                }

                // Proactive enchantment purge
                self.player_enchantments.retain(|e| {
                    if e.duration < 0.0 {
                        return true;
                    }
                    let expires_at = e.start_time + e.duration;
                    expires_at > 0.0
                });

                // Update enchantment timers locally
                for enchant in &mut self.player_enchantments {
                    if enchant.duration >= 0.0 {
                        enchant.start_time -= elapsed;
                    }
                }
            }
            AppAction::KeyPress(key, width, _height, main_chunks) => {
                match key.code {
                    KeyCode::Char('q') | KeyCode::Char('Q')
                        if key.modifiers.contains(crossterm::event::KeyModifiers::CONTROL) =>
                    {
                        commands.push(ClientCommand::Quit);
                    }
                    KeyCode::Tab | KeyCode::BackTab => {
                        if key.modifiers.contains(crossterm::event::KeyModifiers::CONTROL)
                            || key.code == KeyCode::BackTab
                        {
                            self.focused_pane = ui::get_prev_pane(self.focused_pane, width);
                        } else {
                            self.focused_pane = ui::get_next_pane(self.focused_pane, width);
                        }
                    }
                    KeyCode::Esc => {
                        if self.focused_pane == FocusedPane::Input {
                            self.focused_pane = self.previous_focused_pane;
                        } else if self.state == UIState::CharacterSelection {
                            self.state = UIState::Chat;
                        }
                    }
                    KeyCode::Enter => match self.state {
                        UIState::Chat => {
                            if self.focused_pane == FocusedPane::Input {
                                let input = self.input.drain(..).collect::<String>();
                                if input.is_empty() {
                                    self.focused_pane = self.previous_focused_pane;
                                    return commands;
                                }
                                if input == "/quit" || input == "/exit" {
                                    commands.push(ClientCommand::Quit);
                                    return commands;
                                }
                                if input == "/clear" {
                                    self.messages.clear();
                                    self.input.clear();
                                    return commands;
                                }
                                if input == "/help" {
                                    self.messages.push(ChatMessage {
                                        kind: holtburger_core::MessageKind::System,
                                        text: "Available commands: /quit, /exit, /clear, /help".to_string(),
                                    });
                                    self.messages.push(ChatMessage {
                                        kind: holtburger_core::MessageKind::System,
                                        text: "Shortcuts: 1-4 (Tabs), Tab (Cycle Focus), a/u/d/p/s/b (Actions)".to_string(),
                                    });
                                    self.input.clear();
                                    return commands;
                                }
                                self.input_history.push(input.clone());
                                self.history_index = None;
                                commands.push(ClientCommand::Talk(input));
                                self.focused_pane = self.previous_focused_pane;
                            } else {
                                self.previous_focused_pane = self.focused_pane;
                                self.focused_pane = FocusedPane::Input;
                            }
                        }
                        UIState::CharacterSelection => {
                            if !self.characters.is_empty() {
                                commands.push(ClientCommand::SelectCharacterByIndex(
                                    self.selected_character_index + 1,
                                ));
                                self.state = UIState::Chat;
                            }
                        }
                    },
                    KeyCode::Backspace => {
                        if self.state == UIState::Chat && self.focused_pane == FocusedPane::Input {
                            self.input.pop();
                        }
                    }
                    KeyCode::Up => match self.state {
                        UIState::Chat => match self.focused_pane {
                            FocusedPane::Input => {
                                if !self.input_history.is_empty() {
                                    let idx = self
                                        .history_index
                                        .map(|i| i.saturating_sub(1))
                                        .unwrap_or(self.input_history.len() - 1);
                                    self.history_index = Some(idx);
                                    self.input = self.input_history[idx].clone();
                                }
                            }
                            FocusedPane::Chat => {
                                self.scroll_offset = self.scroll_offset.saturating_add(1);
                            }
                            FocusedPane::Context => {
                                self.context_scroll_offset =
                                    self.context_scroll_offset.saturating_add(1);
                            }
                            FocusedPane::Dashboard => {
                                if self.selected_dashboard_index > 0 {
                                    self.selected_dashboard_index -= 1;
                                }
                            }
                        },
                        UIState::CharacterSelection => {
                            if self.selected_character_index > 0 {
                                self.selected_character_index -= 1;
                            }
                        }
                    },
                    KeyCode::Down => match self.state {
                        UIState::Chat => match self.focused_pane {
                            FocusedPane::Input => {
                                if let Some(idx) = self.history_index {
                                    if idx + 1 < self.input_history.len() {
                                        let next = idx + 1;
                                        self.history_index = Some(next);
                                        self.input = self.input_history[next].clone();
                                    } else {
                                        self.history_index = None;
                                        self.input.clear();
                                    }
                                }
                            }
                            FocusedPane::Chat => {
                                self.scroll_offset = self.scroll_offset.saturating_sub(1);
                            }
                            FocusedPane::Context => {
                                self.context_scroll_offset =
                                    self.context_scroll_offset.saturating_sub(1);
                            }
                            FocusedPane::Dashboard => {
                                let dashboard_count = self.dashboard_item_count();
                                if dashboard_count > 0
                                    && self.selected_dashboard_index + 1 < dashboard_count
                                {
                                    self.selected_dashboard_index += 1;
                                }
                            }
                        },
                        UIState::CharacterSelection => {
                            if !self.characters.is_empty()
                                && self.selected_character_index + 1 < self.characters.len()
                            {
                                self.selected_character_index += 1;
                            }
                        }
                    },
                    KeyCode::PageUp => {
                        if let UIState::Chat = self.state {
                            match self.focused_pane {
                                FocusedPane::Chat => {
                                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                                    let step = (h / 2) + 1;
                                    self.scroll_offset = self.scroll_offset.saturating_add(step);
                                }
                                FocusedPane::Context => {
                                    let h = main_chunks[2].height.saturating_sub(2) as usize;
                                    let step = (h / 2) + 1;
                                    self.context_scroll_offset =
                                        self.context_scroll_offset.saturating_add(step);
                                }
                                FocusedPane::Dashboard => {
                                    let h = self.last_dashboard_height;
                                    let step = (h / 2) + 1;
                                    self.selected_dashboard_index =
                                        self.selected_dashboard_index.saturating_sub(step);
                                }
                                _ => {}
                            }
                        }
                    }
                    KeyCode::PageDown => {
                        if let UIState::Chat = self.state {
                            match self.focused_pane {
                                FocusedPane::Chat => {
                                    let h = main_chunks[1].height.saturating_sub(2) as usize;
                                    let step = (h / 2) + 1;
                                    self.scroll_offset = self.scroll_offset.saturating_sub(step);
                                }
                                FocusedPane::Context => {
                                    let h = main_chunks[2].height.saturating_sub(2) as usize;
                                    let step = (h / 2) + 1;
                                    self.context_scroll_offset =
                                        self.context_scroll_offset.saturating_sub(step);
                                }
                                FocusedPane::Dashboard => {
                                    let h = self.last_dashboard_height;
                                    let step = (h / 2) + 1;
                                    let count = self.dashboard_item_count();
                                    self.selected_dashboard_index = (self.selected_dashboard_index
                                        + step)
                                        .min(count.saturating_sub(1));
                                }
                                _ => {}
                            }
                        }
                    }
                    KeyCode::Char(c) => {
                        if let UIState::Chat = self.state {
                            match self.focused_pane {
                                FocusedPane::Input => {
                                    self.input.push(c);
                                }
                                FocusedPane::Chat | FocusedPane::Context | FocusedPane::Dashboard =>
                                {
                                    match c {
                                        '1' => {
                                            self.dashboard_tab = DashboardTab::Entities;
                                            self.selected_dashboard_index = 0;
                                        }
                                        '2' => {
                                            self.dashboard_tab = DashboardTab::Inventory;
                                            self.selected_dashboard_index = 0;
                                        }
                                        '3' => {
                                            self.dashboard_tab = DashboardTab::Character;
                                            self.selected_dashboard_index = 0;
                                        }
                                        '4' => {
                                            self.dashboard_tab = DashboardTab::Effects;
                                            self.selected_dashboard_index = 0;
                                        }
                                        'x' | 'X' => {
                                            self.context_view = ContextView::Default;
                                            self.context_buffer.clear(); // equivalent to refresh_context_buffer
                                        }
                                        _ => {
                                            // Action processing
                                            let target = match self.dashboard_tab {
                                                DashboardTab::Entities
                                                | DashboardTab::Inventory => {
                                                    let entities = self.get_filtered_nearby_tab();
                                                    entities
                                                        .get(self.selected_dashboard_index)
                                                        .map(|(e, _, _)| ActionTarget::Entity(e))
                                                        .unwrap_or(ActionTarget::None)
                                                }
                                                DashboardTab::Effects => {
                                                    let enchants =
                                                        self.get_effects_list_enchantments();
                                                    enchants
                                                        .get(self.selected_dashboard_index)
                                                        .map(|(e, _)| ActionTarget::Enchantment(e))
                                                        .unwrap_or(ActionTarget::None)
                                                }
                                                DashboardTab::Character => ActionTarget::None,
                                            };

                                            let player_guid = self.player_guid;
                                            let actions = actions::get_actions_for_target(
                                                &target,
                                                &self.entities,
                                                player_guid,
                                            );
                                            if let Some(handler) = actions
                                                .iter()
                                                .find(|a| {
                                                    a.shortcut_char() == c.to_ascii_lowercase()
                                                })
                                                .and_then(|action| action.handler(&target, player_guid))
                                            {
                                                match handler {
                                                    ActionHandler::Command(cmd) => {
                                                        commands.push(cmd);
                                                    }
                                                    ActionHandler::ToggleDebug => {
                                                        let lines = actions::get_debug_info(
                                                            &target,
                                                            |id| {
                                                                self.entities
                                                                    .get(&id)
                                                                    .map(|e| e.name.clone())
                                                                    .or_else(|| {
                                                                        if Some(id) == player_guid {
                                                                            Some("You".to_string())
                                                                        } else {
                                                                            None
                                                                        }
                                                                    })
                                                            },
                                                        );
                                                        self.context_view = ContextView::Custom;
                                                        self.context_buffer = lines;
                                                        self.context_scroll_offset = 0;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    KeyCode::Home => {
                        if let UIState::Chat = self.state {
                            match self.focused_pane {
                                FocusedPane::Chat => {
                                    let max_scroll = self.chat_total_lines.saturating_sub(1);
                                    self.scroll_offset = max_scroll;
                                }
                                FocusedPane::Context => {
                                    let max_scroll = self.context_buffer.len().saturating_sub(1);
                                    self.context_scroll_offset = max_scroll;
                                }
                                FocusedPane::Dashboard => {
                                    self.selected_dashboard_index = 0;
                                }
                                _ => {}
                            }
                        }
                    }
                    KeyCode::End => {
                        if let UIState::Chat = self.state {
                            match self.focused_pane {
                                FocusedPane::Chat => self.scroll_offset = 0,
                                FocusedPane::Context => self.context_scroll_offset = 0,
                                FocusedPane::Dashboard => {
                                    let dashboard_count = self.dashboard_item_count();
                                    self.selected_dashboard_index =
                                        dashboard_count.saturating_sub(1);
                                }
                                _ => {}
                            }
                        }
                    }
                    _ => {}
                }
            }
            AppAction::Mouse(mouse, chunks, main_chunks) => {
                match mouse.kind {
                    MouseEventKind::Down(MouseButton::Left) => {
                        if mouse.row >= chunks[2].y
                            && mouse.row < chunks[2].y + chunks[2].height
                            && mouse.column >= chunks[2].x
                            && mouse.column < chunks[2].x + chunks[2].width
                        {
                            self.focused_pane = FocusedPane::Input;
                        } else if mouse.row >= main_chunks[0].y
                            && mouse.row < main_chunks[0].y + main_chunks[0].height
                            && mouse.column >= main_chunks[0].x
                            && mouse.column < main_chunks[0].x + main_chunks[0].width
                        {
                            self.focused_pane = FocusedPane::Dashboard;
                        } else if mouse.row >= main_chunks[1].y
                            && mouse.row < main_chunks[1].y + main_chunks[1].height
                            && mouse.column >= main_chunks[1].x
                            && mouse.column < main_chunks[1].x + main_chunks[1].width
                        {
                            self.focused_pane = FocusedPane::Chat;
                        } else if mouse.row >= main_chunks[2].y
                            && mouse.row < main_chunks[2].y + main_chunks[2].height
                            && mouse.column >= main_chunks[2].x
                            && mouse.column < main_chunks[2].x + main_chunks[2].width
                        {
                            self.focused_pane = FocusedPane::Context;
                        }
                    }
                    MouseEventKind::ScrollUp => {
                        if mouse.row >= main_chunks[1].y
                            && mouse.row < main_chunks[1].y + main_chunks[1].height
                            && mouse.column >= main_chunks[1].x
                            && mouse.column < main_chunks[1].x + main_chunks[1].width
                        {
                            self.scroll_offset = self.scroll_offset.saturating_add(ui::SCROLL_STEP);
                        } else if mouse.row >= main_chunks[2].y
                            && mouse.row < main_chunks[2].y + main_chunks[2].height
                            && mouse.column >= main_chunks[2].x
                            && mouse.column < main_chunks[2].x + main_chunks[2].width
                        {
                            self.context_scroll_offset =
                                self.context_scroll_offset.saturating_add(ui::SCROLL_STEP);
                        } else if mouse.row >= main_chunks[0].y
                            && mouse.row < main_chunks[0].y + main_chunks[0].height
                            && mouse.column >= main_chunks[0].x
                            && mouse.column < main_chunks[0].x + main_chunks[0].width
                        {
                            self.selected_dashboard_index =
                                self.selected_dashboard_index.saturating_sub(1);
                        }
                    }
                    MouseEventKind::ScrollDown => {
                        if mouse.row >= main_chunks[1].y
                            && mouse.row < main_chunks[1].y + main_chunks[1].height
                            && mouse.column >= main_chunks[1].x
                            && mouse.column < main_chunks[1].x + main_chunks[1].width
                        {
                            self.scroll_offset = self.scroll_offset.saturating_sub(ui::SCROLL_STEP);
                        } else if mouse.row >= main_chunks[2].y
                            && mouse.row < main_chunks[2].y + main_chunks[2].height
                            && mouse.column >= main_chunks[2].x
                            && mouse.column < main_chunks[2].x + main_chunks[2].width
                        {
                            self.context_scroll_offset =
                                self.context_scroll_offset.saturating_sub(ui::SCROLL_STEP);
                        } else if mouse.row >= main_chunks[0].y
                            && mouse.row < main_chunks[0].y + main_chunks[0].height
                            && mouse.column >= main_chunks[0].x
                            && mouse.column < main_chunks[0].x + main_chunks[0].width
                        {
                            self.selected_dashboard_index =
                                self.selected_dashboard_index.saturating_add(1);
                        }
                    }
                    _ => {}
                }
            }
            AppAction::ReceivedEvent(event) => {
                match event {
                    ClientEvent::LogMessage(_) => {}
                    ClientEvent::Message(msg) => {
                        self.messages.push(msg);
                    }
                    ClientEvent::CharacterList(chars) => {
                        self.characters = chars;
                        self.state = UIState::CharacterSelection;
                        self.selected_character_index = 0;
                    }
                    ClientEvent::PlayerEntered { guid, name } => {
                        self.player_guid = Some(guid);
                        self.character_name = Some(name);
                    }
                    ClientEvent::World(world_event) => {
                        match *world_event {
                            WorldEvent::PlayerInfo {
                                guid,
                                name,
                                pos,
                                attributes,
                                vitals,
                                skills,
                                enchantments,
                            } => {
                                self.player_guid = Some(guid);
                                self.character_name = Some(name);
                                if let Some(p) = pos {
                                    self.player_pos = Some(p);
                                }
                                self.attributes = attributes;
                                self.vitals = vitals;
                                self.skills = skills;
                                self.player_enchantments = enchantments;
                                self.refresh_context_buffer();
                            }
                            WorldEvent::AttributeUpdated(attr) => {
                                if let Some(existing) = self
                                    .attributes
                                    .iter_mut()
                                    .find(|a| a.attr_type == attr.attr_type)
                                {
                                    *existing = attr;
                                } else {
                                    self.attributes.push(attr);
                                }
                                self.refresh_context_buffer();
                            }
                            WorldEvent::VitalUpdated(vital) => {
                                if let Some(existing) = self
                                    .vitals
                                    .iter_mut()
                                    .find(|v| v.vital_type == vital.vital_type)
                                {
                                    *existing = vital;
                                } else {
                                    self.vitals.push(vital);
                                }
                                self.refresh_context_buffer();
                            }
                            WorldEvent::SkillUpdated(skill) => {
                                if let Some(existing) = self
                                    .skills
                                    .iter_mut()
                                    .find(|s| s.skill_type == skill.skill_type)
                                {
                                    *existing = skill;
                                } else {
                                    self.skills.push(skill);
                                }
                                self.refresh_context_buffer();
                            }
                            WorldEvent::PropertyUpdated { .. } => {}
                            WorldEvent::EntitySpawned(entity) => {
                                let guid = entity.guid;
                                if Some(guid) == self.player_guid {
                                    if entity.name != "Unknown" {
                                        self.character_name = Some(entity.name.clone());
                                    }
                                    self.player_pos = Some(entity.position);
                                }
                                self.entities.insert(guid, *entity);
                            }
                            WorldEvent::EntityDespawned(guid) => {
                                self.entities.remove(&guid);
                            }
                            WorldEvent::EntityMoved { guid, pos } => {
                                if let Some(entity) = self.entities.get_mut(&guid) {
                                    entity.position = pos;
                                }
                                if Some(guid) == self.player_guid {
                                    self.player_pos = Some(pos);
                                }
                            }
                            WorldEvent::EnchantmentUpdated(enchantment) => {
                                if let Some(existing) = self.player_enchantments.iter_mut().find(|e| {
                                    e.spell_id == enchantment.spell_id && e.layer == enchantment.layer
                                }) {
                                    *existing = enchantment;
                                } else {
                                    self.player_enchantments.push(enchantment);
                                }
                            }
                            WorldEvent::EnchantmentRemoved { spell_id, layer } => {
                                self.player_enchantments
                                    .retain(|e| e.spell_id != spell_id || e.layer != layer);
                            }
                            WorldEvent::EnchantmentsPurged => {
                                self.player_enchantments.clear();
                            }
                            WorldEvent::DerivedStatsUpdated {
                                attributes,
                                vitals,
                                skills,
                            } => {
                                self.attributes = attributes;
                                self.vitals = vitals;
                                self.skills = skills;
                                self.refresh_context_buffer();
                            }
                            WorldEvent::ServerTimeUpdate(t) => {
                                self.server_time = Some((t, Instant::now()));
                            }
                        }
                    }
                    ClientEvent::StatusUpdate {
                        state,
                        logon_retry,
                        enter_retry,
                    } => {
                        self.core_state = state;
                        self.logon_retry = logon_retry;
                        self.enter_retry = enter_retry;
                    }
                    _ => {}
                }
            }
        }

        commands
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
                let skill_count = self.skills.iter().filter(|s| s.skill_type.is_eor()).count();
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
        let mut children_map: HashMap<u32, Vec<u32>> = HashMap::new();
        let mut roots = Vec::new();

        let candidate_guids: HashSet<u32> = candidates.iter().map(|e| e.guid).collect();

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

pub fn get_next_pane(current: FocusedPane, width: u16) -> FocusedPane {
    if width < WIDTH_BREAKPOINT {
        // Narrow: Dashboard -> Context -> Chat
        match current {
            FocusedPane::Dashboard => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Dashboard,
            _ => FocusedPane::Dashboard,
        }
    } else {
        // Wide: Dashboard -> Chat -> Context
        match current {
            FocusedPane::Dashboard => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Dashboard,
            _ => FocusedPane::Dashboard,
        }
    }
}

pub fn get_prev_pane(current: FocusedPane, width: u16) -> FocusedPane {
    if width < WIDTH_BREAKPOINT {
        // Narrow reverse: Dashboard -> Chat -> Context
        match current {
            FocusedPane::Dashboard => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Dashboard,
            _ => FocusedPane::Dashboard,
        }
    } else {
        // Wide reverse: Dashboard -> Context -> Chat
        match current {
            FocusedPane::Dashboard => FocusedPane::Context,
            FocusedPane::Context => FocusedPane::Chat,
            FocusedPane::Chat => FocusedPane::Dashboard,
            _ => FocusedPane::Dashboard,
        }
    }
}
