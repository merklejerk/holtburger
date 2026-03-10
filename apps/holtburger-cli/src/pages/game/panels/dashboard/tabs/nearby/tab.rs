use std::collections::{HashMap, HashSet};
use std::vec;

use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::Guid;
use holtburger_common::properties::{PseudoEquipMask, WorldObjectExt as _};
use holtburger_world::context::{WorldContext, WorldContextExt};
use holtburger_world::entity::Entity;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{self, EntityClass};
use super::render::render_nearby_tab;
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppAction, AppUiAction, DashboardTab, FilterInputSession, InspectTarget, Interaction,
    TabController, TabFilterState, UpdateResult, Verb, VerbInputEvent, VerbInputState,
};
use crate::utils::normalize_filter_tokens;

#[derive(Default, Debug, Clone)]
pub struct NearbyTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
    active_filter: Option<TabFilterState>,
    filter_input: Option<FilterInputSession>,
}

pub fn get_entities(data: &GameData) -> Vec<(&Entity, f32, usize)> {
    let entities = &data.entities;
    let player_pos = data.player_pos.as_ref();
    let open_containers = &data.open_containers;

    let candidates: Vec<_> = entities
        .values()
        .filter(|e| {
            let loc = e.valid_locations();
            let is_combat_implement = (loc.bits() & PseudoEquipMask::COMBAT_IMPLEMENTS.bits()) != 0;

            let in_open_container = if let Some(cid) = e.container_id() {
                // Container must be in world (not one of our pack slots).
                open_containers.contains(&cid)
                    && data
                        .get_entity(cid)
                        .is_some_and(|container| container.position.landblock_id != Guid::NULL)
            } else {
                false
            };

            (e.position.landblock_id != Guid::NULL
                || (e.wielder_id().is_some() && is_combat_implement)
                || e.physics_parent_id.is_some())
                || in_open_container
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
        let parent_id = e.container_id().or(e.wielder_id()).or(e.physics_parent_id);

        let is_root = if let Some(pid) = parent_id {
            !candidate_guids.contains(&pid)
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

    // Sort roots by distance
    roots.sort_by(|&a, &b| {
        let ea = &entities[&a];
        let eb = &entities[&b];
        let da = if let Some(p) = player_pos {
            ea.position.distance_to(p)
        } else {
            999.0
        };
        let db = if let Some(p) = player_pos {
            eb.position.distance_to(p)
        } else {
            999.0
        };
        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
    });

    // Flatten with depth using DFS
    let mut result = Vec::new();
    let mut stack: Vec<(Guid, usize)> = roots.into_iter().rev().map(|id| (id, 0)).collect();

    while let Some((guid, depth)) = stack.pop() {
        let e = &entities[&guid];
        let dist = if let Some(p) = player_pos {
            e.position.distance_to(p)
        } else {
            0.0
        };
        result.push((e, dist, depth));

        if let Some(mut children) = children_map.remove(&guid) {
            children.sort_by(|&a, &b| entities[&a].name().cmp(entities[&b].name()));
            for child_guid in children.into_iter().rev() {
                stack.push((child_guid, depth + 1));
            }
        }
    }

    result
}

impl NearbyTab {
    fn begin_filter_input(&mut self, view: &ViewState) -> Option<UpdateResult> {
        if view.active_interaction.is_some() {
            return None;
        }

        let mut input = VerbInputState::text("Filter");
        if let Some(active_filter) = &self.active_filter {
            input.input = active_filter.raw_pattern.clone();
        }

        self.filter_input = Some(FilterInputSession {
            input,
            clears_active_filter_on_cancel: self.active_filter.is_some(),
        });

        Some(UpdateResult::new().with_redraw(true))
    }

    fn apply_filter_input(&mut self, raw_pattern: String) -> UpdateResult {
        let trimmed = raw_pattern.trim().to_string();
        self.active_filter = if trimmed.is_empty() {
            None
        } else {
            Some(TabFilterState {
                tokens: normalize_filter_tokens(&trimmed),
                raw_pattern: trimmed,
            })
        };
        self.filter_input = None;
        UpdateResult::new().with_redraw(true)
    }

    fn get_selected_guid(&self, data: &GameData) -> Option<Guid> {
        let entities = get_entities(data);
        entities.get(self.selected_index).map(|(e, _, _)| e.guid)
    }

    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        get_entities(data).len()
    }
}

impl TabController for NearbyTab {
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
        render_nearby_tab(self, f, data, view, area);
    }

    fn get_verbs(
        &self,
        data: &GameData,
        _view: &ViewState,
        interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let target_guid = self.get_selected_guid(data);
        let player_guid = data.player_guid;

        if let (Some(interaction), Some(guid)) = (interaction, target_guid) {
            let e = data.entities.get(&guid).unwrap();
            let class = classification::classify_entity(e);
            let is_self = Some(e.guid) == player_guid;

            match *interaction {
                Interaction::Moving { item_guid } => {
                    if e.guid == item_guid {
                        return verbs; // No actions when selecting the item being moved
                    }
                    if data.can_move_item_into_container(item_guid, e.guid) {
                        verbs.push(Verb::new(
                            vec![
                                AppAction::MoveItem {
                                    item: item_guid,
                                    container: e.guid,
                                },
                                AppAction::CancelInteraction,
                            ],
                            '\r',
                            "Move to container",
                        ));
                        return verbs;
                    }
                    let is_givable_creature = matches!(
                        class,
                        EntityClass::Player | EntityClass::Npc | EntityClass::Vendor
                    );
                    if is_givable_creature {
                        verbs.push(Verb::new(
                            vec![
                                AppAction::Give {
                                    item: item_guid,
                                    recipient: e.guid,
                                    amount: e.stack_size().max(1),
                                },
                                AppAction::CancelInteraction,
                            ],
                            '\r',
                            "Give to target",
                        ));
                        return verbs;
                    }
                    return verbs;
                }
                Interaction::Healing { item_guid } => {
                    let is_healing_kit = e.guid == item_guid;
                    if data.can_use_with(item_guid, e.guid) {
                        let label = if is_self || is_healing_kit {
                            "Heal yourself".to_string()
                        } else {
                            "Heal target".to_string()
                        };
                        verbs.push(Verb::new(
                            vec![AppAction::UseWith {
                                item: item_guid,
                                target: e.guid,
                            }],
                            '\r',
                            label,
                        ));
                    }
                    return verbs;
                }
                Interaction::Combining { item_guid } => {
                    if data.can_use_with(item_guid, e.guid) {
                        verbs.push(Verb::new(
                            vec![AppAction::UseWith {
                                item: item_guid,
                                target: e.guid,
                            }],
                            '\r',
                            "Apply to target",
                        ));
                    }
                    return verbs;
                }
                _ => {}
            }
        }

        if let Some(guid) = target_guid {
            let e = data.entities.get(&guid).unwrap();
            let class = classification::classify_entity(e);
            let is_open_container = data.open_containers.contains(&e.guid);

            if is_open_container {
                verbs.push(Verb::new(
                    vec![AppAction::Close { guid: e.guid }],
                    'x',
                    "Close",
                ));
            }

            // Item must not be stuck and is either on the ground or in an open container to be pickable.
            if !e.is_stuck()
                && (e.is_root()
                    || e.container_id()
                        .is_some_and(|c| data.open_containers.contains(&c)))
            {
                verbs.push(Verb::new(
                    vec![AppAction::PickUp {
                        item: e.guid,
                        container: None,
                    }],
                    'p',
                    "Pick Up",
                ));
            }

            // We can approach root items.
            if e.is_root() {
                verbs.push(Verb::new(
                    vec![AppAction::Approach { guid: e.guid }],
                    'r',
                    "Approach",
                ));
            }

            verbs.extend([
                Verb::new(
                    vec![AppAction::Assess {
                        target: InspectTarget::Entity(e.guid),
                    }],
                    'a',
                    "Assess",
                ),
                Verb::new(
                    vec![AppAction::BeginInteraction {
                        interaction: Interaction::Targeting {
                            target_guid: e.guid,
                        },
                    }],
                    't',
                    "Target",
                ),
                Verb::new(
                    vec![AppAction::QueryDebugInfo {
                        target: InspectTarget::Entity(e.guid),
                    }],
                    'g',
                    "Debug",
                ),
            ]);

            match class {
                EntityClass::Vendor => {
                    verbs.push(Verb::new(
                        vec![AppAction::OpenShop { vendor: e.guid }],
                        's',
                        "Shop",
                    ));
                }
                EntityClass::Npc => {
                    verbs.push(Verb::new(
                        vec![AppAction::Use { guid: e.guid }],
                        'k',
                        "Talk",
                    ));
                }
                EntityClass::Chest | EntityClass::Container => {
                    if data.open_containers.contains(&e.guid) {
                        verbs.push(Verb::new(
                            vec![AppAction::Close { guid: e.guid }],
                            'o',
                            "Close",
                        ));
                    } else if data.can_use(e.guid) {
                        verbs.push(Verb::new(
                            vec![AppAction::Use { guid: e.guid }],
                            'o',
                            "Open",
                        ));
                    }
                }
                EntityClass::Player => {
                    verbs.push(Verb::new(
                        vec![AppAction::OpenTrade { guid: e.guid }],
                        'd',
                        "Trade",
                    ));
                }
                _ => {
                    if data.can_use(e.guid) {
                        verbs.push(Verb::new(vec![AppAction::Use { guid: e.guid }], 'u', "Use"));
                    }
                }
            }

        }

        verbs.push(Verb::new(
            AppAction::UiAction {
                action: AppUiAction::BeginTabFilterInput {
                    tab: DashboardTab::Nearby,
                },
            },
            'f',
            "Filter",
        ));

        verbs
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        let count = self.item_count(data, view);
        match key.code {
            KeyCode::Down => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 1).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Up => {
                self.selected_index = self.selected_index.saturating_sub(1);
                Some(UpdateResult::new())
            }
            KeyCode::Home => {
                self.selected_index = 0;
                Some(UpdateResult::new())
            }
            KeyCode::End => {
                if count > 0 {
                    self.selected_index = count - 1;
                }
                Some(UpdateResult::new())
            }
            KeyCode::PageUp => {
                self.selected_index = self.selected_index.saturating_sub(10);
                Some(UpdateResult::new())
            }
            KeyCode::PageDown => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 10).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Enter | KeyCode::Char(_) => {
                let shortcut = match key.code {
                    KeyCode::Enter => '\r',
                    KeyCode::Char(c) => c,
                    _ => return None,
                };
                let verbs = self.get_verbs(data, view, &view.active_interaction);
                let verb = verbs.into_iter().find(|v| v.shortcut == shortcut)?;
                Some(UpdateResult::new().with_action(verb.action))
            }
            _ => None,
        }
    }

    fn handle_ui_action(
        &mut self,
        action: &AppUiAction,
        _data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        match action {
            AppUiAction::BeginTabFilterInput {
                tab: DashboardTab::Nearby,
            } => self.begin_filter_input(view),
            _ => None,
        }
    }

    fn footer_input(&self) -> Option<&VerbInputState> {
        self.filter_input.as_ref().map(|session| &session.input)
    }

    fn footer_header(&self) -> Option<String> {
        self.active_filter
            .as_ref()
            .map(|filter| format!("[F]ilter: {}", filter.raw_pattern))
    }

    fn handle_footer_input(
        &mut self,
        key: KeyEvent,
        _data: &GameData,
        _view: &ViewState,
    ) -> Option<UpdateResult> {
        let session = self.filter_input.as_mut()?;

        match session.input.handle_key(key) {
            VerbInputEvent::Changed | VerbInputEvent::Ignored => {
                Some(UpdateResult::new().with_redraw(true))
            }
            VerbInputEvent::Cancelled => {
                if session.clears_active_filter_on_cancel {
                    self.active_filter = None;
                }
                self.filter_input = None;
                Some(UpdateResult::new().with_redraw(true))
            }
            VerbInputEvent::SubmittedText(raw_pattern) => Some(self.apply_filter_input(raw_pattern)),
            VerbInputEvent::Invalid(_) | VerbInputEvent::SubmittedQuantity(_) => {
                Some(UpdateResult::new().with_redraw(true))
            }
        }
    }
}
