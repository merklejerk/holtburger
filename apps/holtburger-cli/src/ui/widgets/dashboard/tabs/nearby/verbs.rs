use super::super::common::{self, Action, Verb, VerbSet};
use super::super::classification;
use crate::ui::model::AppState;
use holtburger_core::world::entity::Entity;
use holtburger_common::properties::ObjectDescriptionFlag;

pub fn get_verbs(e: &Entity, state: &AppState) -> VerbSet {
    let mut verbs = common::get_base_entity_verbs(e);

    // Nearby entities allow Approach
    verbs.push(Verb::new(Action::Approach, 'r', "Approach"));

    if !e.flags.intersects(ObjectDescriptionFlag::STUCK) {
        verbs.push(Verb::new(Action::PickUp, 'p', "Pick up"));

        if let Some(pguid) = state.player_guid
            && matches!(classification::classify_entity(e), classification::EntityClass::Container)
        {
            verbs.push(Verb::new(Action::MoveToSlot(pguid), 's', "Secure"));
        }
    }

    verbs.push(Verb::new(Action::Debug, 'b', "Debug"));
    verbs
}
