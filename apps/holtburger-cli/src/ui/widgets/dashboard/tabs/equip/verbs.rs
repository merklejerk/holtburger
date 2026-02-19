use super::super::common::{self, Action, Verb, VerbSet};
use holtburger_core::world::entity::Entity;
use holtburger_core::client::types::TargetSlot;

pub fn get_verbs(e: &Entity, is_here: bool, slot: Option<TargetSlot>) -> VerbSet {
    let mut verbs = common::get_base_entity_verbs(e);

    if is_here {
        verbs.push(Verb::new(Action::Unequip, 'q', "Unequip"));
    } else if let Some(s) = slot {
        verbs.push(Verb::new(Action::Equip(s), 'e', "Equip"));
    }

    verbs.push(Verb::new(Action::Drop, 'd', "Drop"));
    verbs.push(Verb::new(Action::Debug, 'b', "Debug"));
    verbs
}
