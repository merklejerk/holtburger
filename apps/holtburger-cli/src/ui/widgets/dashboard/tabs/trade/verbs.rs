use super::super::common::Verb;
use crate::ui::state::GameState;
use holtburger_core::world::entity::Entity;

pub fn get_verbs(_entity: &Entity, _game: &GameState) -> Vec<Verb> {
    // For now, no specific verbs for items inside a vendor or trade window
    // and rely on existing item verbs.
    vec![]
}
