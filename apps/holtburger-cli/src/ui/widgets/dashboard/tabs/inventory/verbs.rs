use super::super::common::{self, Action, Verb, VerbSet};
use crate::ui::model::AppState;
use holtburger_core::world::entity::Entity;

pub fn get_verbs(e: &Entity, state: &AppState) -> VerbSet {
    let mut verbs = common::get_base_entity_verbs(e);

    let is_equipped = if let (Some(pguid), Some(wielder)) = (state.player_guid, e.wielder_id) {
        pguid == wielder
    } else {
        false
    };

    if is_equipped {
        verbs.push(Verb::new(Action::Unequip, 'q', "Unequip"));
    }

    verbs.push(Verb::new(Action::Drop, 'd', "Drop"));

    use holtburger_common::properties::ObjectDescriptionFlag;
    if !e.flags.intersects(ObjectDescriptionFlag::REQUIRES_PACK_SLOT) {
        verbs.push(Verb::new(Action::Move, 'm', "Move"));
    }

    verbs.push(Verb::new(Action::Debug, 'b', "Debug"));

    // Ensure uniqueness based on Action (not label/shortcut since they can be reused now)
    // But actually, we just want to make sure we don't have duplicate shortcuts in the final list.
    verbs
}
