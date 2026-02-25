use ratatui::Frame;
use ratatui::layout::Rect;

use super::super::classification::{self, EntityClass};
use super::super::common::{Action, Verb};
use super::render::render_inventory_tab;
use crate::ui::Interaction;
use crate::ui::state::GameState;
use crate::ui::traits::TabController;
use crate::ui::types::CommandTarget;
use crate::ui::update::effect::UIEffect;
use crate::ui::widgets::dashboard::filter::{EntityFilter, filter_entities};
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::client::types::ClientCommand;
use holtburger_core::world::context::WorldContextExt;
use holtburger_core::world::entity::Entity;

pub struct InventoryTab;

pub fn get_entities(game: &GameState) -> Vec<(&Entity, f32, usize)> {
    filter_entities(
        &game.data.entities,
        &game.data.inventory,
        &game.data.equipment,
        game.data.player_pos.as_ref(),
        EntityFilter::Inventory,
    )
}

impl TabController for InventoryTab {
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect) {
        render_inventory_tab(f, game, area);
    }

    fn get_verbs(&self, game: &GameState, index: usize) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let target = self.get_target_at_index(game, index);
        let player_guid = game.data.player_guid;
        let active_interaction = game.view.active_interaction;

        if let CommandTarget::Entity(e, _) = target {
            let class = classification::classify_entity(e);

            match active_interaction {
                Some(Interaction::Healing { item_guid }) => {
                    if e.guid == item_guid {
                        verbs.push(Verb::new(
                            Action::ConfirmInteraction,
                            '\r',
                            "Heal yourself".to_string(),
                        ));
                    }
                    return verbs;
                }
                Some(Interaction::Moving { item_guid }) => {
                    let is_self = Some(e.guid) == player_guid;
                    let is_same_item = e.guid == item_guid;
                    let is_in_main_pack = game.data.is_in_main_pack(item_guid);
                    let is_container = matches!(class, EntityClass::Container | EntityClass::Chest);
                    let label = if is_self || is_same_item {
                        if !is_in_main_pack {
                            Some("Move to main pack".to_string())
                        } else {
                            // Already in main pack.
                            None
                        }
                    } else if is_container {
                        Some(format!("Move to {}", e.name))
                    } else {
                        None
                    };
                    if let Some(label) = label {
                        verbs.push(Verb::new(Action::ConfirmInteraction, '\r', label));
                    }
                    return verbs;
                }
                _ => {}
            }

            verbs.extend(vec![Verb::new(Action::Assess, 'a', "Assess")]);

            match class {
                EntityClass::Tool
                | EntityClass::Container
                | EntityClass::Consumable
                | EntityClass::Key
                | EntityClass::Writable
                | EntityClass::Money
                | EntityClass::Item => {
                    verbs.push(Verb::new(Action::Use, 'u', "Use"));
                }
                EntityClass::Apparel | EntityClass::Wand | EntityClass::Weapon => {
                    verbs.push(Verb::new(Action::Target, 't', "Target"));
                }
                _ => {}
            }

            if !e.is_attuned_sticky() {
                verbs.push(Verb::new(Action::Drop, 'd', "Drop"));
            }

            if e.stack_size() > 1 {
                verbs.push(Verb::new(Action::Split, 'p', "Split"));
            }

            if !e
                .flags
                .intersects(ObjectDescriptionFlag::REQUIRES_PACK_SLOT)
            {
                verbs.push(Verb::new(Action::Move, 'm', "Move"));
            }

            let is_equipped = if let (Some(pguid), Some(wielder)) = (player_guid, e.wielder_id()) {
                pguid == wielder
            } else {
                false
            };

            if let Some(trade) = &game.data.trade
                && !is_equipped
                && !trade.self_side.items.contains(&e.guid)
                && game.data.can_add_to_trade(e.guid)
            {
                verbs.push(Verb::new(Action::AddToTrade, 'o', "Offer"));
            } else if game.data.vendor.is_some() && game.data.can_sell_to_vendor(e.guid) {
                verbs.push(Verb::new(Action::Sell, 's', "Sell"));
            }

            verbs.push(Verb::new(Action::Debug, 'g', "Debug"));
        }

        verbs
    }

    fn handle_action(
        &self,
        action: &Action,
        index: usize,
        game: &mut GameState,
    ) -> Option<UIEffect> {
        let player_guid = game.data.player_guid;

        let target = self.get_target_at_index(game, index);

        match (action, &target) {
            (Action::Equip(slot), CommandTarget::Entity(e, _)) => {
                Some(UIEffect::Command(ClientCommand::GetAndWield {
                    item: e.guid,
                    slot: Some(*slot),
                }))
            }
            (Action::Unequip, CommandTarget::Entity(e, _)) => player_guid.map(|pguid| {
                UIEffect::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: pguid,
                    placement: 0,
                })
            }),
            (Action::MoveToSlot(slot_guid), CommandTarget::Entity(e, _)) => {
                Some(UIEffect::Command(ClientCommand::MoveItem {
                    item: e.guid,
                    container: *slot_guid,
                    placement: 0,
                }))
            }
            _ => super::super::common::handle_base_action(action, &target, game),
        }
    }

    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a> {
        let entities = get_entities(game);
        entities
            .get(index)
            .map(|(e, _, _)| CommandTarget::Entity(e, None))
            .unwrap_or(CommandTarget::None)
    }

    fn get_item_count(&self, game: &GameState) -> usize {
        get_entities(game).len()
    }
}
