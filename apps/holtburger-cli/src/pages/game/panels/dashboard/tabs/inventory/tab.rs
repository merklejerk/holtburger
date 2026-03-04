use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_world::context::WorldContextExt;
use holtburger_world::entity::Entity;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{EntityClass, classify_entity};
use super::render::render_inventory_tab;
use crate::pages::game::panels::dashboard::filter::{EntityFilter, filter_entities};
use crate::pages::game::{GameData, ViewState};
use crate::types::{AppAction, Interaction, TabController, UpdateResult, Verb};

#[derive(Default, Debug, Clone)]
pub struct InventoryTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}

pub fn get_entities(data: &GameData) -> Vec<(&Entity, f32, usize)> {
    filter_entities(
        &data.entities,
        &data.inventory,
        &data.equipment,
        data.player_pos.as_ref(),
        Some(&data.open_containers),
        EntityFilter::Inventory,
    )
}

impl InventoryTab {
    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        get_entities(data).len()
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
        let entities = get_entities(data);
        let mut verbs = Vec::new();

        if let Some((cur_entity, _, _)) = entities.get(self.selected_index) {
            let class = classify_entity(cur_entity);
            let player_guid = data.player_guid;

            if let Some(active_interaction) = interaction {
                match active_interaction {
                    Interaction::Healing {
                        item_guid: interact_guid,
                    } => {
                        if cur_entity.guid == *interact_guid
                            && let Some(pguid) = player_guid
                        {
                            verbs.push(Verb::new(
                                vec![
                                    AppAction::UseWith(*interact_guid, pguid),
                                    AppAction::CancelInteraction,
                                ],
                                '\r',
                                "Heal yourself",
                            ));
                        }
                        return verbs;
                    }
                    Interaction::Combining {
                        item_guid: interact_guid,
                    } => {
                        if cur_entity.guid != *interact_guid
                            && data.can_use_with(*interact_guid, cur_entity.guid) {
                            verbs.push(Verb::new(
                                vec![
                                    AppAction::UseWith(*interact_guid, cur_entity.guid),
                                    AppAction::CancelInteraction,
                                ],
                                '\r',
                                "Use with target",
                            ));
                        }
                        return verbs;
                    }
                    Interaction::Moving {
                        item_guid: interact_guid,
                    } => {
                        let is_self = Some(cur_entity.guid) == player_guid;
                        let is_same_item = cur_entity.guid == *interact_guid;
                        let is_in_main_pack = data.is_in_main_pack(cur_entity.guid);

                        // Stop if already inside the current item.
                        if data.entities.get(interact_guid).and_then(|e| e.container_id()) == Some(cur_entity.guid) {
                            return verbs;
                        }
                        // If selecting interaction item, allow moving it to main pack if it's not already there.
                        if is_same_item {
                            if !is_in_main_pack {
                                verbs.push(Verb::new(
                                    vec![
                                        AppAction::MoveItem(*interact_guid, player_guid.unwrap_or_default()),
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
                                vec![AppAction::MoveItem(*interact_guid, cur_entity.guid)],
                                '\r',
                                "Move into container",
                            ));
                            return verbs;
                        }
                        // If can merge with current item, show merge option.
                        if let Some(merge_amount) = data.resolve_merge_stack_amount(*interact_guid, cur_entity.guid, None) && merge_amount > 0 {
                            verbs.push(Verb::new(
                                vec![
                                    AppAction::StackItems(*interact_guid, cur_entity.guid, merge_amount),
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

            verbs.push(Verb::new(
                vec![AppAction::Assess(cur_entity.guid)],
                'a',
                "Assess",
            ));

            match class {
                EntityClass::Tool
                | EntityClass::Container
                | EntityClass::Consumable
                | EntityClass::Key
                | EntityClass::Writable
                | EntityClass::Money
                | EntityClass::Item => {
                    if cur_entity.target_item_type().is_some() {
                        verbs.push(Verb::new(
                            vec![AppAction::BeginInteraction(Interaction::Combining {
                                item_guid: cur_entity.guid,
                            })],
                            'c',
                            "Combine",
                        ));
                    } else {
                        verbs.push(Verb::new(vec![AppAction::Use(cur_entity.guid)], 'u', "Use"));
                    }
                }
                EntityClass::Apparel | EntityClass::Wand | EntityClass::Weapon => {
                    verbs.push(Verb::new(
                        vec![AppAction::BeginInteraction(Interaction::Targeting {
                            target_guid: cur_entity.guid,
                        })],
                        't',
                        "Target",
                    ));
                }
                EntityClass::HealingKit => {
                    verbs.push(Verb::new(
                        vec![AppAction::BeginInteraction(Interaction::Healing {
                            item_guid: cur_entity.guid,
                        })],
                        'h',
                        "Heal",
                    ));
                }
                _ => {}
            }

            if !cur_entity.is_attuned_sticky() {
                verbs.push(Verb::new(
                    vec![AppAction::Drop(cur_entity.guid)],
                    'd',
                    "Drop",
                ));
            }

            if cur_entity.stack_size() > 1 {
                verbs.push(Verb::new(
                    vec![AppAction::BeginInteraction(Interaction::Splitting {
                        item_guid: cur_entity.guid,
                        max_amount: cur_entity.stack_size() as i32,
                    })],
                    'p',
                    "Split",
                ));
            }

            if !cur_entity
                .flags
                .intersects(ObjectDescriptionFlag::REQUIRES_PACK_SLOT)
            {
                verbs.push(Verb::new(
                    vec![AppAction::BeginInteraction(Interaction::Moving {
                        item_guid: cur_entity.guid,
                    })],
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
                        vec![AppAction::AddToTrade(cur_entity.guid)],
                        'o',
                        "Offer",
                    ));
                }
            } else if let Some(vendor) = &view.vendor
                && data.can_sell_to_vendor(cur_entity.guid, view.vendor.as_ref())
            {
                verbs.push(Verb::new(
                    vec![AppAction::SellToVendor(vendor.vendor_guid, cur_entity.guid, 1)],
                    's',
                    "Sell",
                ));
            }

            verbs.push(Verb::new(
                vec![AppAction::QueryDebugInfo(cur_entity.guid)],
                'g',
                "Debug",
            ));
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
}
