use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_world::context::WorldContextExt;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{EntityClass, classify_entity};
use super::render::render_inventory_tab;
use crate::actions::AppAction;
use crate::pages::game::dashboard::filter::{EntityFilter, filter_entities};
use crate::state::GameState;
use crate::types::{CommandTarget, Verb};
use crate::ui::Interaction;
use crate::ui::traits::TabController;
use holtburger_world::entity::Entity;

pub struct InventoryTab;

pub fn get_entities(game: &GameState) -> Vec<(&Entity, f32, usize)> {
    filter_entities(
        &game.data.entities,
        &game.data.inventory,
        &game.data.equipment,
        game.data.player_pos.as_ref(),
        Some(&game.data.open_containers),
        EntityFilter::Inventory,
    )
}

impl TabController for InventoryTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_inventory_tab(f, game, area);
    }

    fn get_verbs(
        &self,
        game: &GameState,
        interaction: &Option<Interaction>,
        index: usize,
    ) -> Vec<Verb> {
        let entities = get_entities(game);
        let mut verbs = Vec::new();

        if let Some((cur_entity, _, _)) = entities.get(index) {
            let class = classify_entity(cur_entity);
            let player_guid = game.data.player_guid;

            if let Some(active_interaction) = interaction {
                match active_interaction {
                    Interaction::Healing { item_guid: interact_guid } => {
                        if cur_entity.guid == *interact_guid && let Some(pguid) = player_guid {
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
                    Interaction::Combining { item_guid: interact_guid } => {
                        if let Some(source_e) = game.data.entities.get(interact_guid) {
                            if let (Some(target_type), Some(dest_item_type)) =
                                (source_e.target_item_type(), cur_entity.item_type())
                            {
                                if target_type.intersects(dest_item_type) {
                                    verbs.push(Verb::new(
                                        vec![
                                            AppAction::ApplyItem(*interact_guid, cur_entity.guid),
                                            AppAction::CancelInteraction,
                                        ],
                                        '\r',
                                        "Apply to target",
                                    ));
                                }
                            }
                        }
                        return verbs;
                    }
                    Interaction::Moving { item_guid: interact_guid } => {
                        let is_self = Some(cur_entity.guid) == player_guid;
                        let is_same_item = cur_entity.guid == *interact_guid;
                        let is_in_main_pack = game.data.is_in_main_pack(*interact_guid);
                        let is_container = matches!(
                            class,
                            EntityClass::Container | EntityClass::Chest
                        );

                        let merge_label = game.data.entities.get(interact_guid).and_then(|source_e| {
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
                                    actions.push(AppAction::MoveItem(*interact_guid, p));
                                }
                                label = Some("Move to main pack");
                            } else {
                                label = None;
                            }
                        } else if let Some(merge) = merge_label {
                            actions.push(AppAction::StackItems(*interact_guid, cur_entity.guid, -1));
                            label = Some(merge);
                        } else if is_container {
                            actions.push(AppAction::MoveItem(*interact_guid, cur_entity.guid));
                            label = Some("Move to container");
                        } else {
                            label = None;
                        };

                        if let Some(label) = label && !actions.is_empty() {
                            verbs.push(Verb::new(actions, '\r', label));
                        }
                        return verbs;
                    }
                    _ => {}
                }
            }

            verbs.push(Verb::new(vec![AppAction::Assess(cur_entity.guid)], 'a', "Assess"));

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
                EntityClass::Apparel
                | EntityClass::Wand
                | EntityClass::Weapon => {
                    verbs.push(Verb::new(
                        vec![AppAction::BeginInteraction(Interaction::Targeting {
                            target_guid: cur_entity.guid,
                        })],
                        't',
                        "Target",
                    ));
                }
                _ => {}
            }

            if !cur_entity.is_attuned_sticky() {
                verbs.push(Verb::new(vec![AppAction::Drop(cur_entity.guid)], 'd', "Drop"));
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

            if !cur_entity.flags.intersects(
                ObjectDescriptionFlag::REQUIRES_PACK_SLOT,
            ) {
                verbs.push(Verb::new(
                    vec![AppAction::BeginInteraction(Interaction::Moving {
                        item_guid: cur_entity.guid,
                    })],
                    'm',
                    "Move",
                ));
            }

            let is_equipped = if let (Some(pguid), Some(wielder)) = (player_guid, cur_entity.wielder_id()) {
                pguid == wielder
            } else {
                false
            };

            if let Some(trade) = &game.data.trade {
                if !is_equipped
                    && !trade.self_side.items.contains(&cur_entity.guid)
                    && game.data.can_add_to_trade(cur_entity.guid)
                {
                    verbs.push(Verb::new(vec![AppAction::AddToTrade(cur_entity.guid)], 'o', "Offer"));
                }
            } else if let Some(vendor) = &game.data.vendor {
                if game.data.can_sell_to_vendor(cur_entity.guid) {
                    verbs.push(Verb::new(
                        vec![AppAction::SellToVendor(cur_entity.guid, vendor.vendor_guid)],
                        's',
                        "Sell",
                    ));
                }
            }

            verbs.push(Verb::new(
                vec![AppAction::QueryDebugInfo(cur_entity.guid)],
                'g',
                "Debug",
            ));
        }

        verbs
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        let entities = get_entities(game);
        match entities.get(index) {
            Some((e, _, _)) => CommandTarget::Entity(e, None),
            _ => CommandTarget::None,
        }
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        get_entities(game).len()
    }
}
