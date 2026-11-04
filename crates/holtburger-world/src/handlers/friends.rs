//! Friend list event reduction; character admission is coordinated by core.

use crate::{WorldEvent, WorldState};
use holtburger_protocol::messages::{GameEvent, GameEventMessage};

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    let GameEvent::FriendsListUpdate(update) = &event.event else {
        return false;
    };
    state.friends.get_or_insert_default().apply(update);
    events.push(WorldEvent::FriendsStateUpdated);
    true
}
