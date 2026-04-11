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
use crate::pages::game::combat::can_locally_attack_entity;
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppAction, AppUiAction, DashboardTab, FilterInputSession, FooterVerbVisibility, InspectTarget,
    Interaction, TabController, TabFilterState, UpdateResult, Verb, VerbInputEvent, VerbInputState,
};
use crate::utils::{
    format_item_name, fuzzy_subsequence_match, normalize_filter_tokens, retain_matching_hierarchy,
};

const MAX_NEARBY_LANDBLOCK_DISTANCE: u8 = 3;

#[derive(Default, Debug, Clone)]
pub struct NearbyTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
    active_filter: Option<TabFilterState>,
    filter_input: Option<FilterInputSession>,
}

pub fn get_entities(data: &GameData) -> Vec<(&Entity, f32, usize)> {
    let entities = &data.entities;
    let player_pos = data.runtime_player_position();
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

    if let Some(player_pos) = player_pos {
        roots.retain(|guid| {
            let entity = &entities[guid];
            let entity_pos = data
                .distance_position_for_guid(*guid)
                .unwrap_or(entity.position);

            entity_pos
                .landblock_chebyshev_distance_to(&player_pos)
                .is_some_and(|distance| distance <= MAX_NEARBY_LANDBLOCK_DISTANCE)
        });
    }

    // Sort roots by distance
    roots.sort_by(|&a, &b| {
        let ea = &entities[&a];
        let eb = &entities[&b];
        let da = if let Some(p) = player_pos {
            data.distance_position_for_guid(ea.guid)
                .unwrap_or(ea.position)
                .distance_to(&p)
        } else {
            999.0
        };
        let db = if let Some(p) = player_pos {
            data.distance_position_for_guid(eb.guid)
                .unwrap_or(eb.position)
                .distance_to(&p)
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
            data.distance_position_for_guid(guid)
                .unwrap_or(e.position)
                .distance_to(&p)
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
    pub(crate) fn visible_entities<'a>(&self, data: &'a GameData) -> Vec<(&'a Entity, f32, usize)> {
        let entities = get_entities(data);
        let Some(active_filter) = &self.active_filter else {
            return entities;
        };

        if active_filter.tokens.is_empty() {
            return entities;
        }

        retain_matching_hierarchy(
            entities,
            |(entity, _, _)| entity.guid,
            |(_, _, depth)| *depth,
            |(entity, _, _)| {
                let display_name = format_item_name(*entity, entity.guid);
                active_filter
                    .tokens
                    .iter()
                    .any(|token| fuzzy_subsequence_match(token, &display_name))
            },
        )
    }

    fn clamp_selected_index(&mut self, data: &GameData) {
        let count = self.visible_entities(data).len();
        if count == 0 {
            self.selected_index = 0;
        } else {
            self.selected_index = self.selected_index.min(count - 1);
        }
    }

    fn begin_filter_input(&mut self, _view: &ViewState) -> Option<UpdateResult> {
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

    fn get_selected_guid(&self, data: &GameData) -> Option<Guid> {
        let entities = self.visible_entities(data);
        entities.get(self.selected_index).map(|(e, _, _)| e.guid)
    }

    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        self.visible_entities(data).len()
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
        let target_guid = self.get_selected_guid(data);
        let mut verbs = vec![
            Verb::new(
                AppAction::UiAction {
                    action: AppUiAction::BeginTabFilterInput {
                        tab: DashboardTab::Nearby,
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

        if let (Some(interaction), Some(guid)) = (interaction, target_guid) {
            let e = data.entities.get(&guid).unwrap();
            let class = classification::classify_entity(e);

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
            let _is_open_container = data.open_containers.contains(&e.guid);

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

            if e.is_root() && class.is_creature() {
                verbs.push(Verb::new(
                    vec![AppAction::Follow { guid: e.guid }],
                    'w',
                    "Follow",
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
                    verbs.push(Verb::new(AppAction::Use { guid: e.guid }, 'k', "Talk"));
                }
                EntityClass::Monster
                    if can_locally_attack_entity(e, data.combat_target_status(e.guid)) =>
                {
                    verbs.push(Verb::new(AppAction::Attack { guid: e.guid }, 'k', "Attack"));
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
                    if can_locally_attack_entity(e, data.combat_target_status(e.guid)) {
                        verbs.push(Verb::new(
                            vec![AppAction::Attack { guid: e.guid }],
                            'k',
                            "Attack",
                        ));
                    }
                }
                _ => {
                    if data.can_use(e.guid) {
                        if class == EntityClass::Writable {
                            verbs.push(Verb::new(
                                vec![AppAction::Read { guid: e.guid }],
                                'e',
                                "Read",
                            ));
                        } else {
                            verbs.push(Verb::new(
                                vec![AppAction::Use { guid: e.guid }],
                                'u',
                                "Use",
                            ));
                        }
                    }
                }
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
        data: &GameData,
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
    use crate::pages::game::panels::dashboard::tabs::classification::EntityClass;
    use crate::types::AppAction;
    use holtburger_common::math::{Quaternion, Vector3};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ItemType, ObjectDescriptionFlag, PropertyBool, PropertyInt,
        WorldObjectPropertyAccessorsMut as _,
    };
    use holtburger_core::ClientViewEvent;
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::EntityMotionSnapshot;
    use holtburger_world::{
        ContactState, RuntimeSpatialBodyView, SpatialBodyId, SpatialSampleMode,
    };
    use std::time::Instant;

    fn make_entity(guid: u32, landblock_id: u32, name: &str) -> Entity {
        Entity::new(
            Guid(guid),
            name.to_string(),
            WorldPosition {
                landblock_id: Guid(landblock_id),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        )
    }

    fn seed_runtime_body(
        data: &mut GameData,
        body_id: SpatialBodyId,
        authoritative_pose: WorldPosition,
        runtime_pose: WorldPosition,
    ) {
        data.runtime_body_cache.apply_view_event(
            &ClientViewEvent::RuntimeBodyUpserted {
                body: Box::new(RuntimeSpatialBodyView {
                    body_id,
                    authoritative_pose: Some(authoritative_pose),
                    runtime_pose,
                    velocity: Vector3::zero(),
                    omega: Vector3::zero(),
                    motion_state: None,
                    contact: ContactState::Grounded,
                    sample_mode: SpatialSampleMode::SimulatingMotionState,
                }),
            },
            Instant::now(),
        );
    }

    #[test]
    fn nearby_verbs_offer_attack_for_monsters_and_talk_for_npcs() {
        let monster_guid = Guid(0x0200_0001);
        let npc_guid = Guid(0x0200_0002);
        let mut monster = make_entity(monster_guid.0, 0x0101_0000, "Drudge");
        monster.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        monster.set_bool_prop(PropertyBool::Attackable, true);
        monster.flags |= ObjectDescriptionFlag::ATTACKABLE;

        let mut npc = make_entity(npc_guid.0, 0x0101_0000, "Town Crier");
        npc.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);

        assert_eq!(
            classification::classify_entity(&monster),
            EntityClass::Monster
        );
        assert_eq!(classification::classify_entity(&npc), EntityClass::Npc);

        let mut monster_data = GameData::default();
        monster_data.entities.insert(monster_guid, monster);
        let monster_verbs =
            NearbyTab::default().get_verbs(&monster_data, &ViewState::default(), &None);
        assert!(monster_verbs.iter().any(|verb| {
            verb.shortcut == 'k'
                && verb.label == "Attack"
                && matches!(verb.action, AppAction::Attack { guid } if guid == monster_guid)
        }));

        let mut npc_data = GameData::default();
        npc_data.entities.insert(npc_guid, npc);
        let npc_verbs = NearbyTab::default().get_verbs(&npc_data, &ViewState::default(), &None);
        assert!(npc_verbs.iter().any(|verb| {
            verb.shortcut == 'k'
                && verb.label == "Talk"
                && matches!(verb.action, AppAction::Use { guid } if guid == npc_guid)
        }));
    }

    #[test]
    fn nearby_attack_affordance_hides_death_motion_targets() {
        let monster_guid = Guid(0x0200_0003);
        let mut monster = make_entity(monster_guid.0, 0x0101_0000, "Drudge");
        monster.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        monster.set_bool_prop(PropertyBool::Attackable, true);
        monster.flags |= ObjectDescriptionFlag::ATTACKABLE;
        monster.motion_snapshot = Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::DEAD),
            sidestep_command: None,
            turn_command: None,
            ..Default::default()
        });

        let mut data = GameData::default();
        data.entities.insert(monster_guid, monster);

        let verbs = NearbyTab::default().get_verbs(&data, &ViewState::default(), &None);
        assert!(!verbs.iter().any(|verb| {
            verb.shortcut == 'k'
                && verb.label == "Attack"
                && matches!(verb.action, AppAction::Attack { guid } if guid == monster_guid)
        }));
    }

    #[test]
    fn visible_entities_excludes_roots_beyond_three_landblocks() {
        let mut data = GameData::default();
        data.player_guid = Some(Guid(0x0100_0001));
        data.player_pos = Some(WorldPosition {
            landblock_id: Guid(0x0101_0000),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        });

        let near = make_entity(0x0200_0001, 0x0401_0000, "Near");
        let far = make_entity(0x0200_0002, 0x0501_0000, "Far");

        data.entities.insert(near.guid, near);
        data.entities.insert(far.guid, far);

        let tab = NearbyTab::default();
        let visible = tab.visible_entities(&data);

        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].0.guid, Guid(0x0200_0001));
    }

    #[test]
    fn visible_entities_orders_roots_by_authoritative_entity_pose_and_projected_player_pose() {
        let player_guid = Guid(0x0100_0001);
        let near_guid = Guid(0x0200_0001);
        let far_guid = Guid(0x0200_0002);
        let mut data = GameData::default();
        data.player_guid = Some(player_guid);
        let authoritative_player = WorldPosition {
            landblock_id: Guid(0x0101_0000),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        data.player_pos = Some(authoritative_player);

        let projected_player = WorldPosition {
            landblock_id: Guid(0x0101_0000),
            coords: Vector3::new(100.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let authoritative_near = WorldPosition {
            landblock_id: Guid(0x0101_0000),
            coords: Vector3::new(5.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let authoritative_far = WorldPosition {
            landblock_id: Guid(0x0101_0000),
            coords: Vector3::new(50.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };

        data.entities.insert(
            player_guid,
            Entity::new(player_guid, "Player".to_string(), authoritative_player),
        );
        data.entities.insert(
            near_guid,
            Entity::new(near_guid, "Near".to_string(), authoritative_near),
        );
        data.entities.insert(
            far_guid,
            Entity::new(far_guid, "Far".to_string(), authoritative_far),
        );

        seed_runtime_body(
            &mut data,
            SpatialBodyId::LocalPlayer(player_guid),
            authoritative_player,
            projected_player,
        );
        seed_runtime_body(
            &mut data,
            SpatialBodyId::Entity(near_guid),
            authoritative_near,
            WorldPosition {
                landblock_id: Guid(0x0101_0000),
                coords: Vector3::new(1.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        seed_runtime_body(
            &mut data,
            SpatialBodyId::Entity(far_guid),
            authoritative_far,
            WorldPosition {
                landblock_id: Guid(0x0101_0000),
                coords: Vector3::new(500.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );

        let visible = NearbyTab::default().visible_entities(&data);

        assert_eq!(visible[0].0.guid, player_guid);
        assert_eq!(visible[1].0.guid, far_guid);
        assert_eq!(visible[2].0.guid, near_guid);
        assert_eq!(visible[0].1, 0.0);
        assert_eq!(visible[1].1, 50.0);
        assert_eq!(visible[2].1, 95.0);
    }
}
