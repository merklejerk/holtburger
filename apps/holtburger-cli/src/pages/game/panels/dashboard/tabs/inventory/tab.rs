use std::collections::{HashMap, HashSet};

use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::Guid;
use holtburger_common::properties::{ObjectDescriptionFlag, WorldObjectExt as _};
use holtburger_world::context::{WorldContext, WorldContextExt};
use holtburger_world::entity::Entity;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{EntityClass, classify_entity};
use super::render::render_inventory_tab;
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppAction, AppUiAction, ChatMessageTags, DashboardTab, FilterInputSession,
    FooterVerbVisibility, InspectTarget, Interaction, TabController, TabFilterState, UpdateResult,
    Verb, VerbInputEvent, VerbInputState,
};
use crate::utils::{
    format_item_name, fuzzy_subsequence_match, normalize_filter_tokens, retain_matching_hierarchy,
};

#[derive(Debug, Clone)]
struct SplitSession {
    item_guid: Guid,
    container_guid: Guid,
    input: VerbInputState,
}

#[derive(Default, Debug, Clone)]
pub struct InventoryTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
    split_session: Option<SplitSession>,
    active_filter: Option<TabFilterState>,
    filter_input: Option<FilterInputSession>,
}

pub fn get_entities(data: &GameData) -> Vec<(&Entity, usize)> {
    let entities = &data.entities;

    let candidates: Vec<_> = entities
        .values()
        .filter(|e| data.is_owned_by_player(e.guid) && !e.name().is_empty())
        .collect();

    if candidates.is_empty() {
        return Vec::new();
    }

    // Build parent-child mapping for the subset
    let mut children_map: HashMap<Guid, Vec<Guid>> = HashMap::new();
    let mut roots = Vec::new();

    let candidate_guids: HashSet<Guid> = candidates.iter().map(|e| e.guid).collect();

    for e in &candidates {
        let parent_id = e.container_id();

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

    // Precompute names for sorting to avoid repeated allocations
    let item_names: HashMap<Guid, String> = candidates
        .iter()
        .map(|&e| (e.guid, format_item_name(e, e.guid)))
        .collect();

    // Sort roots by name for Inventory
    roots.sort_by_key(|id| item_names.get(id).unwrap());

    // Flatten with depth using DFS
    let mut result = Vec::new();
    let mut stack: Vec<(Guid, usize)> = roots.into_iter().rev().map(|id| (id, 0)).collect();

    while let Some((guid, depth)) = stack.pop() {
        let e = &entities[&guid];
        result.push((e, depth));

        if let Some(mut children) = children_map.remove(&guid) {
            children.sort_by_key(|id| item_names.get(id).unwrap());
            for child_guid in children.into_iter().rev() {
                stack.push((child_guid, depth + 1));
            }
        }
    }

    result
}

impl InventoryTab {
    pub(crate) fn visible_entities<'a>(&self, data: &'a GameData) -> Vec<(&'a Entity, f32, usize)> {
        let entities = get_entities(data);
        let Some(active_filter) = &self.active_filter else {
            return entities
                .into_iter()
                .map(|(entity, depth)| (entity, 0.0, depth))
                .collect();
        };

        if active_filter.tokens.is_empty() {
            return entities
                .into_iter()
                .map(|(entity, depth)| (entity, 0.0, depth))
                .collect();
        }

        retain_matching_hierarchy(
            entities,
            |(entity, _)| entity.guid,
            |(_, depth)| *depth,
            |(entity, _)| {
                let display_name = format_item_name(*entity, entity.guid);
                active_filter
                    .tokens
                    .iter()
                    .any(|token| fuzzy_subsequence_match(token, &display_name))
            },
        )
        .into_iter()
        .map(|(entity, depth)| (entity, 0.0, depth))
        .collect()
    }

    fn clamp_selected_index(&mut self, data: &GameData) {
        let count = self.visible_entities(data).len();
        if count == 0 {
            self.selected_index = 0;
        } else {
            self.selected_index = self.selected_index.min(count - 1);
        }
    }

    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        self.visible_entities(data).len()
    }

    fn begin_split_session(
        &mut self,
        item_guid: Guid,
        max_amount: u32,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        if self.split_session.is_some()
            || self.filter_input.is_some()
            || view.active_interaction.is_some()
        {
            return None;
        }

        if max_amount <= 1 {
            return None;
        }

        let container_id = if let Some(item) = data.get_entity(item_guid)
            && let Some(container_id) = data.find_non_full_pack(item_guid, item.container_id())
        {
            Some(container_id)
        } else {
            None
        };

        if let Some(container_id) = container_id {
            self.split_session = Some(SplitSession {
                item_guid,
                container_guid: container_id,
                input: VerbInputState::quantity("Split amount", 1, max_amount),
            });
        } else {
            return Some(UpdateResult::new().with_action(AppAction::Log {
                chat_tags: ChatMessageTags::system(),
                message:
                    "Unable to split item: player inventory container is unavailable.".to_string(),
            }));
        }

        Some(UpdateResult::new().with_redraw(true))
    }

    fn begin_filter_input(&mut self, _view: &ViewState) -> Option<UpdateResult> {
        if self.split_session.is_some() {
            return None;
        }

        let mut input = VerbInputState::text("Filter");
        if let Some(active_filter) = &self.active_filter {
            input.input.set_text(&active_filter.raw_pattern);
        }

        self.filter_input = Some(FilterInputSession {
            input,
            clears_active_filter_on_cancel: self.active_filter.is_some(),
        });

        Some(UpdateResult::new().with_redraw(true))
    }

    fn apply_filter_input(&mut self, raw_pattern: String, data: &GameData) -> UpdateResult {
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
        self.clamp_selected_index(data);
        UpdateResult::new().with_redraw(true)
    }
}

impl TabController for InventoryTab {
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
        render_inventory_tab(self, f, data, view, area);
    }

    fn get_verbs(
        &self,
        data: &GameData,
        view: &ViewState,
        interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let entities = self.visible_entities(data);
        let mut verbs = vec![
            Verb::new(
                AppAction::UiAction {
                    action: AppUiAction::BeginTabFilterInput {
                        tab: DashboardTab::Inventory,
                    },
                },
                'f',
                "Filter",
            )
            .with_footer_visibility(if self.active_filter.is_some() {
                FooterVerbVisibility::Hidden
            } else {
                FooterVerbVisibility::Visible
            }),
        ];

        if let Some((cur_entity, _, _)) = entities.get(self.selected_index) {
            verbs.extend([
                Verb::new(
                    vec![AppAction::Assess {
                        target: InspectTarget::Entity(cur_entity.guid),
                    }],
                    'a',
                    "Assess",
                ),
                Verb::new(
                    vec![AppAction::QueryDebugInfo {
                        target: InspectTarget::Entity(cur_entity.guid),
                    }],
                    'g',
                    "Debug",
                ),
            ]);

            let class = classify_entity(cur_entity);
            let player_guid = data.player_guid;

            if let Some(active_interaction) = interaction {
                match active_interaction {
                    Interaction::Combining {
                        item_guid: interact_guid,
                    } => {
                        if cur_entity.guid == *interact_guid
                            && let Some(pguid) = player_guid
                            && data.can_use_with(*interact_guid, pguid)
                        {
                            verbs.push(Verb::new(
                                vec![
                                    AppAction::UseWith {
                                        item: *interact_guid,
                                        target: pguid,
                                    },
                                    AppAction::CancelInteraction,
                                ],
                                '\r',
                                "Use on self",
                            ));
                        } else if data.can_use_with(*interact_guid, cur_entity.guid) {
                            verbs.push(Verb::new(
                                vec![
                                    AppAction::UseWith {
                                        item: *interact_guid,
                                        target: cur_entity.guid,
                                    },
                                    AppAction::CancelInteraction,
                                ],
                                '\r',
                                "Use with target",
                            ));
                        }
                        return verbs;
                    }
                    Interaction::Salvaging => {
                        let Some(session) = view.salvaging.as_ref() else {
                            return verbs;
                        };
                        let is_queued = session.queued_items.contains(&cur_entity.guid);

                        if is_queued && !session.queued_items.is_empty() {
                            verbs.push(Verb::new(
                                AppAction::SalvageItems {
                                    ust_guid: session.ust_guid,
                                    item_guids: session.queued_items.clone(),
                                },
                                '\r',
                                "Confirm salvage",
                            ));

                            verbs.push(Verb::new(
                                AppAction::UnqueueSalvageItem {
                                    guid: cur_entity.guid,
                                },
                                'v',
                                "Unsalvage",
                            ));
                        }

                        if !is_queued && data.is_salvage_candidate(cur_entity.guid) {
                            verbs.push(Verb::new(
                                AppAction::QueueSalvageItem {
                                    guid: cur_entity.guid,
                                },
                                'v',
                                "Salvage",
                            ));
                        }

                        return verbs;
                    }
                    Interaction::Moving {
                        item_guid: interact_guid,
                    } => {
                        let _is_self = Some(cur_entity.guid) == player_guid;
                        let is_same_item = cur_entity.guid == *interact_guid;
                        let is_in_main_pack = data.is_in_main_pack(cur_entity.guid);

                        // Stop if already inside the current item.
                        if data
                            .entities
                            .get(interact_guid)
                            .and_then(|e| e.container_id())
                            == Some(cur_entity.guid)
                        {
                            return verbs;
                        }
                        // If selecting interaction item, allow moving it to main pack if it's not already there.
                        if is_same_item {
                            if !is_in_main_pack {
                                verbs.push(Verb::new(
                                    vec![
                                        AppAction::MoveItem {
                                            item: *interact_guid,
                                            container: player_guid.unwrap_or_default(),
                                        },
                                        AppAction::CancelInteraction,
                                    ],
                                    '\r',
                                    "Move to main pack",
                                ));
                            }
                            return verbs;
                        }
                        if data.can_move_item_into_container(*interact_guid, cur_entity.guid) {
                            verbs.push(Verb::new(
                                vec![AppAction::MoveItem {
                                    item: *interact_guid,
                                    container: cur_entity.guid,
                                }],
                                '\r',
                                "Move into container",
                            ));
                            return verbs;
                        }
                        // If can merge with current item, show merge option.
                        if let Some(merge_amount) =
                            data.resolve_merge_stack_amount(*interact_guid, cur_entity.guid, None)
                            && merge_amount > 0
                        {
                            verbs.push(Verb::new(
                                vec![
                                    AppAction::StackItems {
                                        source: *interact_guid,
                                        destination: cur_entity.guid,
                                        amount: merge_amount,
                                    },
                                    AppAction::CancelInteraction,
                                ],
                                '\r',
                                "Merge",
                            ));
                            return verbs;
                        }
                        return verbs;
                    }
                    _ => {}
                }
            }

            match class {
                EntityClass::Apparel | EntityClass::Wand | EntityClass::Weapon => {
                    verbs.push(Verb::new(
                        vec![AppAction::BeginInteraction {
                            interaction: Interaction::Targeting {
                                target_guid: cur_entity.guid,
                            },
                        }],
                        't',
                        "Target",
                    ));
                }
                _ => {}
            }

            if class == EntityClass::HealingKit
                && let Some(pguid) = player_guid
                && data.can_use_with(cur_entity.guid, pguid)
            {
                verbs.push(Verb::new(
                    vec![AppAction::UseWith {
                        item: cur_entity.guid,
                        target: pguid,
                    }],
                    'h',
                    "Heal self",
                ));
            }

            if class == EntityClass::ManaStone
                && cur_entity.ui_effects().is_some_and(|effects| effects != 0)
                && let Some(pguid) = player_guid
                && data.can_use_with(cur_entity.guid, pguid)
            {
                verbs.push(Verb::new(
                    vec![AppAction::UseWith {
                        item: cur_entity.guid,
                        target: pguid,
                    }],
                    'r',
                    "Recharge all",
                ));
            }

            if data.can_begin_use_with(cur_entity.guid) {
                verbs.push(Verb::new(
                    vec![AppAction::BeginInteraction {
                        interaction: Interaction::Combining {
                            item_guid: cur_entity.guid,
                        },
                    }],
                    'c',
                    "Combine",
                ));
            } else if class == EntityClass::Writable {
                verbs.push(Verb::new(
                    vec![AppAction::Read {
                        guid: cur_entity.guid,
                    }],
                    'e',
                    "Read",
                ));
            } else if data.can_use(cur_entity.guid) {
                verbs.push(Verb::new(
                    vec![AppAction::Use {
                        guid: cur_entity.guid,
                    }],
                    'u',
                    "Use",
                ));
            }

            if data.find_salvage_tool_guid().is_some() && data.is_salvage_candidate(cur_entity.guid)
            {
                verbs.push(Verb::new(
                    vec![
                        AppAction::BeginInteraction {
                            interaction: Interaction::Salvaging,
                        },
                        AppAction::QueueSalvageItem {
                            guid: cur_entity.guid,
                        },
                    ],
                    'v',
                    "Salvage",
                ));
            }

            if !cur_entity.is_attuned_sticky() {
                verbs.push(Verb::new(
                    vec![AppAction::Drop {
                        guid: cur_entity.guid,
                    }],
                    'd',
                    "Drop",
                ));
            }

            if cur_entity.stack_size() > 1 {
                verbs.push(Verb::new(
                    AppAction::UiAction {
                        action: AppUiAction::InventoryBeginSplitInput {
                            item_guid: cur_entity.guid,
                            max_amount: cur_entity.stack_size(),
                        },
                    },
                    'p',
                    "Split",
                ));
            }

            if !cur_entity
                .flags
                .intersects(ObjectDescriptionFlag::REQUIRES_PACK_SLOT)
            {
                verbs.push(Verb::new(
                    vec![AppAction::BeginInteraction {
                        interaction: Interaction::Moving {
                            item_guid: cur_entity.guid,
                        },
                    }],
                    'm',
                    "Move",
                ));
            }

            let is_equipped =
                if let (Some(pguid), Some(wielder)) = (player_guid, cur_entity.wielder_id()) {
                    pguid == wielder
                } else {
                    false
                };

            if let Some(trade) = &data.trade {
                if !is_equipped
                    && !trade.self_side.items.contains(&cur_entity.guid)
                    && data.can_add_to_trade(cur_entity.guid)
                {
                    verbs.push(Verb::new(
                        vec![AppAction::AddToTrade {
                            guid: cur_entity.guid,
                        }],
                        'o',
                        "Offer",
                    ));
                }
            } else if let Some(vendor) = &view.vendor
                && data.can_sell_to_vendor(cur_entity.guid, view.vendor.as_ref())
            {
                verbs.push(Verb::new(
                    vec![AppAction::SellToVendor {
                        vendor: vendor.vendor_guid,
                        item: cur_entity.guid,
                        amount: 1,
                    }],
                    's',
                    "Sell",
                ));
            }
        }

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

    fn footer_input(&self) -> Option<&VerbInputState> {
        self.split_session
            .as_ref()
            .map(|session| &session.input)
            .or_else(|| self.filter_input.as_ref().map(|session| &session.input))
    }

    fn footer_header(&self) -> Option<String> {
        self.active_filter
            .as_ref()
            .map(|filter| format!("[F]ilter: {}", filter.raw_pattern))
    }

    fn handle_ui_action(
        &mut self,
        action: &AppUiAction,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        match action {
            AppUiAction::InventoryBeginSplitInput {
                item_guid,
                max_amount,
            } => self.begin_split_session(*item_guid, *max_amount, data, view),
            AppUiAction::BeginTabFilterInput {
                tab: DashboardTab::Inventory,
            } => self.begin_filter_input(view),
            _ => None,
        }
    }

    fn handle_footer_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        _view: &ViewState,
    ) -> Option<UpdateResult> {
        if let Some(session) = self.split_session.as_mut() {
            return match session.input.handle_key(key) {
                VerbInputEvent::Changed | VerbInputEvent::Ignored => {
                    Some(UpdateResult::new().with_redraw(true))
                }
                VerbInputEvent::Cancelled => {
                    self.split_session = None;
                    Some(UpdateResult::new().with_redraw(true))
                }
                VerbInputEvent::Invalid(err) => Some(
                    UpdateResult::new()
                        .with_redraw(true)
                        .with_action(AppAction::Log {
                            chat_tags: ChatMessageTags::system(),
                            message: err.message(),
                        }),
                ),
                VerbInputEvent::SubmittedQuantity(amount) => {
                    let item = session.item_guid;
                    let container = session.container_guid;
                    self.split_session = None;
                    Some(
                        UpdateResult::new()
                            .with_redraw(true)
                            .with_action(AppAction::SplitItem {
                                item,
                                container,
                                amount,
                            }),
                    )
                }
                VerbInputEvent::SubmittedText(_) => Some(UpdateResult::new().with_redraw(true)),
            };
        }

        let session = self.filter_input.as_mut()?;

        match session.input.handle_key(key) {
            VerbInputEvent::Changed | VerbInputEvent::Ignored => {
                Some(UpdateResult::new().with_redraw(true))
            }
            VerbInputEvent::Cancelled => {
                if session.clears_active_filter_on_cancel {
                    self.active_filter = None;
                    self.clamp_selected_index(data);
                }
                self.filter_input = None;
                Some(UpdateResult::new().with_redraw(true))
            }
            VerbInputEvent::SubmittedText(raw_pattern) => {
                Some(self.apply_filter_input(raw_pattern, data))
            }
            VerbInputEvent::Invalid(_) | VerbInputEvent::SubmittedQuantity(_) => {
                Some(UpdateResult::new().with_redraw(true))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::math::{Quaternion, Vector3};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ItemType, PropertyInt, Usable, WorldObjectPropertyAccessorsMut,
    };

    fn make_entity(guid: u32, name: &str, container_id: Option<Guid>) -> Entity {
        let mut entity = Entity::new(
            Guid(guid),
            name.to_string(),
            WorldPosition {
                landblock_id: Guid(0x0100_0000),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );
        if let Some(container_id) = container_id {
            entity.set_container_id(Some(container_id));
        }

        entity
    }

    fn make_player_entity(guid: Guid) -> Entity {
        let mut entity = Entity::new(guid, "Player".to_string(), WorldPosition::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        entity
    }

    fn make_mana_stone(guid: Guid, name: &str, ui_effects: i32) -> Entity {
        let mut entity = Entity::new(guid, name.to_string(), WorldPosition::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::MANA_STONE.bits() as i32);
        entity.set_int_prop(PropertyInt::UiEffects, ui_effects);
        entity
    }

    #[test]
    fn visible_entities_are_sorted_by_name_not_distance() {
        let player_guid = Guid(0x5000_0001);
        let far_guid = Guid(0x5000_0002);
        let near_guid = Guid(0x5000_0003);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(10.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        });
        data.entities
            .insert(far_guid, make_entity(0x5000_0002, "Zulu", None));
        data.entities
            .insert(near_guid, make_entity(0x5000_0003, "Alpha", None));
        data.inventory.insert(far_guid);
        data.inventory.insert(near_guid);

        let tab = InventoryTab::default();
        let visible = tab.visible_entities(&data);

        assert_eq!(
            visible
                .iter()
                .map(|(entity, _, _)| entity.name())
                .collect::<Vec<_>>(),
            vec!["Alpha", "Zulu"]
        );
    }

    #[test]
    fn recharge_all_is_hidden_for_uncharged_mana_stones() {
        let player_guid = Guid(0x5000_0001);
        let stone_guid = Guid(0x5000_0002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.entities
            .insert(player_guid, make_player_entity(player_guid));
        data.entities
            .insert(stone_guid, make_mana_stone(stone_guid, "Mana Stone", 0));
        data.inventory.insert(stone_guid);

        let tab = InventoryTab {
            selected_index: 0,
            ..InventoryTab::default()
        };

        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(!verbs.iter().any(|verb| verb.label == "Recharge all"));
    }

    #[test]
    fn recharge_all_is_shown_for_charged_mana_stones() {
        let player_guid = Guid(0x5000_0001);
        let stone_guid = Guid(0x5000_0002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.entities
            .insert(player_guid, make_player_entity(player_guid));
        let mut stone = make_mana_stone(stone_guid, "Mana Stone", 1);
        stone.set_container_id(Some(player_guid));
        stone.set_int_prop(
            PropertyInt::ItemUseable,
            Usable::SOURCE_CONTAINED_TARGET_SELF_OR_CONTAINED.bits() as i32,
        );
        stone.set_int_prop(PropertyInt::TargetType, ItemType::CREATURE.bits() as i32);
        data.entities.insert(stone_guid, stone);
        data.inventory.insert(stone_guid);

        let tab = InventoryTab {
            selected_index: 0,
            ..InventoryTab::default()
        };

        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(verbs.iter().any(|verb| verb.label == "Recharge all"));
    }
}
