use super::super::classification::{self, EntityClass};
use super::super::common::{Action, Verb};
use crate::ui::state::GameState;
use holtburger_core::world::entity::Entity;

pub fn get_verbs(e: &Entity, game: &GameState) -> Vec<Verb> {
    let mut verbs = vec![
        Verb::new(Action::Assess, 'a', "Assess"),
        Verb::new(Action::Target, 't', "Target"),
    ];
    let class = classification::classify_entity(e);

    match class {
        EntityClass::Npc
        | EntityClass::Vendor
        | EntityClass::Portal
        | EntityClass::Door
        | EntityClass::LifeStone
        | EntityClass::Chest => {
            verbs.push(Verb::new(Action::Use, 'u', "Use"));
        }
        EntityClass::Weapon
        | EntityClass::Apparel
        | EntityClass::Wand
        | EntityClass::Tool
        | EntityClass::Container
        | EntityClass::Consumable
        | EntityClass::Key
        | EntityClass::Writable
        | EntityClass::Money
        | EntityClass::Item => {
            verbs.push(Verb::new(Action::Use, 'u', "Use"));
        }
        _ => {}
    }

    verbs.push(Verb::new(Action::Drop, 'd', "Drop"));

    let is_equipped = if let (Some(pguid), Some(wielder)) = (game.data.player_guid, e.wielder_id) {
        pguid == wielder
    } else {
        false
    };

    if is_equipped {
        verbs.push(Verb::new(Action::Unequip, 'q', "Unequip"));
    }

    use holtburger_common::properties::ObjectDescriptionFlag;
    if !e
        .flags
        .intersects(ObjectDescriptionFlag::REQUIRES_PACK_SLOT)
    {
        verbs.push(Verb::new(Action::Move, 'm', "Move"));
    }

    if let Some(trade) = &game.data.trade
        && !is_equipped
        && !trade.self_side.items.contains(&e.guid)
        && game.data.can_add_to_trade(e.guid)
    {
        verbs.push(Verb::new(Action::AddToTrade, 'o', "Offer"));
    // If a vendor session is active, allow selling this item
    } else if game.data.vendor.is_some() && game.data.can_sell_to_vendor(e.guid) {
        verbs.push(Verb::new(Action::Sell, 's', "Sell"));
    }

    verbs.push(Verb::new(Action::Debug, 'g', "Debug"));

    verbs
}
