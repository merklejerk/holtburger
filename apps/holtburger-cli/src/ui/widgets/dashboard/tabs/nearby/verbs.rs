use super::super::classification::{self, EntityClass};
use super::super::common::{Action, Verb, VerbSet};
use crate::ui::model::GameState;
use holtburger_common::properties::ObjectDescriptionFlag;
use holtburger_core::world::entity::Entity;

pub fn get_verbs(e: &Entity, game: &GameState) -> VerbSet {
    let mut verbs = vec![
        Verb::new(Action::Assess, 'a', "Assess"),
        Verb::new(Action::Target, 't', "Target"),
    ];
    if e.wielder_id.is_some() || e.physics_parent_id.is_some() {
        return verbs;
    }

    let is_player = game.player_guid == Some(e.guid);
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

    if !is_player {
        // Nearby entities allow Approach
        verbs.push(Verb::new(Action::Approach, 'r', "Approach"));

        if !e.flags.intersects(ObjectDescriptionFlag::STUCK) {
            verbs.push(Verb::new(Action::PickUp, 'p', "Pick up"));
        }
    }

    verbs.push(Verb::new(Action::Debug, 'b', "Debug"));
    verbs
}
