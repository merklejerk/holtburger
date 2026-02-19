use super::super::classification::{self, EntityClass};
use super::super::common::{Action, Verb, VerbSet};
use holtburger_core::client::types::TargetSlot;
use holtburger_core::world::entity::Entity;

pub fn get_verbs(e: &Entity, is_here: bool, slot: Option<TargetSlot>) -> VerbSet {
    let mut verbs = vec![
        Verb::new(Action::Assess, 'a', "Assess"),
        Verb::new(Action::Target, 't', "Target"),
    ];

    let class = classification::classify_entity(e);
    match class {
        EntityClass::Npc
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

    if is_here {
        verbs.push(Verb::new(Action::Unequip, 'q', "Unequip"));
    } else if let Some(s) = slot {
        verbs.push(Verb::new(Action::Equip(s), 'e', "Equip"));
    }

    verbs.push(Verb::new(Action::Drop, 'd', "Drop"));
    verbs.push(Verb::new(Action::Debug, 'b', "Debug"));
    verbs
}
