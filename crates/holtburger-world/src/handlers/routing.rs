use crate::WorldEvent;
use crate::handlers::{
    contracts, fellowship, friends, housing, inventory, movement, player, properties, system, trade,
};
use crate::state::WorldState;
use holtburger_protocol::messages::GameMessage;

/// Top-level dispatcher for protocol messages.
///
/// This is the entry point for all game messages received from the server.
/// It orchestrates mutations across [PlayerState] and [WorldState].
pub fn handle_message(state: &mut WorldState, message: &GameMessage, events: &mut Vec<WorldEvent>) {
    handle_message_at(state, message, std::time::Instant::now(), events);
}

pub fn handle_message_at(
    state: &mut WorldState,
    message: &GameMessage,
    observed_at: std::time::Instant,
    events: &mut Vec<WorldEvent>,
) {
    if player::handle_message(state, message, events)
        || system::handle_message(state, message, events)
        || movement::handle_message(state, message, observed_at, events)
        || properties::handle_message(state, message, events)
        || inventory::handle_message(state, message, events)
    {
        return;
    }

    if let GameMessage::GameEvent(event) = message {
        let _handled = player::handle_event(state, event, observed_at, events)
            || housing::handle_event(state, event, events)
            || fellowship::handle_event(state, event, events)
            || friends::handle_event(state, event, events)
            || contracts::handle_event(state, event, events)
            || super::squelch::handle_event(state, event, events)
            || super::allegiance::handle_event(state, event, events)
            || trade::handle_event(state, event, events)
            || inventory::handle_event(state, event, observed_at, events)
            || system::handle_event(state, event, events);
    }
}
