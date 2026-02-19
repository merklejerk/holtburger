use super::super::classification::{self, EntityClass};
use super::super::common::{Action, Verb, VerbSet};
use crate::ui::model::AppState;
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::world::entity::Entity;

pub fn get_verbs(e: &Entity, _state: &AppState) -> VerbSet {
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
        | EntityClass::Container => {
            verbs.push(Verb::new(Action::Use, 'u', "Use"));
        }
        _ => {}
    }

    // Nearby entities allow Approach
    verbs.push(Verb::new(Action::Approach, 'r', "Approach"));

    if !e.flags.intersects(ObjectDescriptionFlag::STUCK) {
        verbs.push(Verb::new(Action::PickUp, 'p', "Pick up"));
    }

    verbs.push(Verb::new(Action::Debug, 'b', "Debug"));
    verbs
}
