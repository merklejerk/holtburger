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
                                    AppAction::ApplyItem(*interact_guid, pguid),
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
                        if let Some(source_e) = data.entities.get(interact_guid)
                            && let (Some(target_type), Some(dest_item_type)) =
                                (source_e.target_item_type(), cur_entity.item_type())
                            && target_type.intersects(dest_item_type)
                        {
                            verbs.push(Verb::new(
                                vec![
                                    AppAction::ApplyItem(*interact_guid, cur_entity.guid),
                                    AppAction::CancelInteraction,
                                ],
                                '\r',
                                "Apply to target",
                            ));
                        }
                        return verbs;
                    }
                    Interaction::Moving {
                        item_guid: interact_guid,
                    } => {
                        let is_self = Some(cur_entity.guid) == player_guid;
                        let is_same_item = cur_entity.guid == *interact_guid;
                        let is_in_main_pack = data.is_in_main_pack(*interact_guid);
                        let is_container =
                            matches!(class, EntityClass::Container | EntityClass::Chest);

                        let merge_label = data.entities.get(interact_guid).and_then(|source_e| {
                            if !is_same_item
                                && source_e.is_stackable()
                                && source_e.wcid == cur_entity.wcid
                                && cur_entity.stack_size() < cur_entity.max_stack_size()
                            {
                                Some("Merge")
                            } else {
                                None
                            }
                        });

                        let label;
                        let mut actions = Vec::new();

                        if is_self || is_same_item {
                            if !is_in_main_pack {
                                if let Some(p) = player_guid {
                                    actions.extend_from_slice(&[
                                        AppAction::MoveItem(*interact_guid, p),
                                        AppAction::CancelInteraction,
                                    ]);
                                }
                                label = Some("Move to main pack");
                            } else {
                                label = None;
                            }
                        } else if let Some(merge) = merge_label {
                            actions.push(AppAction::StackItems(
                                *interact_guid,
                                cur_entity.guid,
                                -1,
                            ));
                            actions.push(AppAction::CancelInteraction);
                            label = Some(merge);
                        } else if is_container {
                            actions.extend_from_slice(&[
                                AppAction::MoveItem(*interact_guid, cur_entity.guid),
                                AppAction::CancelInteraction,
                            ]);
                            label = Some("Move to container");
                        } else {
                            label = None;
                        };

                        if let Some(label) = label
                            && !actions.is_empty()
                        {
                            verbs.push(Verb::new(actions, '\r', label));
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
                    vec![AppAction::SellToVendor(cur_entity.guid, vendor.vendor_guid)],
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
