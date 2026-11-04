//! Replacement-only ignore reduction; core admits packets for the character lifetime.

use crate::{WorldEvent, WorldState};
use holtburger_protocol::messages::{GameEvent, GameEventMessage};

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    let GameEvent::SetSquelchDb(db) = &event.event else {
        return false;
    };
    state.squelch = Some(db.as_ref().into());
    events.push(WorldEvent::SquelchStateUpdated);
    true
}
