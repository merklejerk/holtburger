use crate::WorldEvent;
use crate::handlers::{fellowship, inventory, login, movement, player, properties, system, trade};
use crate::state::WorldState;
use holtburger_protocol::messages::GameMessage;

fn resolve_spell_names(state: &WorldState, events: &mut [WorldEvent]) {
    for event in events.iter_mut() {
        match event {
            WorldEvent::SpellUpdated { spell_id, name, .. } if name.is_none() => {
                *name = state.resolve_spell_name(*spell_id);
            }
            _ => {}
        }
    }
}

/// Top-level dispatcher for protocol messages.
///
/// This is the entry point for all game messages received from the server.
/// It orchestrates mutations across [PlayerState] and [WorldState].
pub fn handle_message(state: &mut WorldState, message: &GameMessage, events: &mut Vec<WorldEvent>) {
    if player::handle_message(state, message, events) {
        resolve_spell_names(state, events);
        return;
    }

    if system::handle_message(state, message, events) {
        resolve_spell_names(state, events);
        return;
    }

    if movement::handle_message(state, message, events)
        || properties::handle_message(state, message, events)
        || inventory::handle_message(state, message, events)
    {
        resolve_spell_names(state, events);
        return;
    }

    if let GameMessage::GameEvent(event) = message {
        let player_handled = player::handle_event(state, event, events);

        if player_handled
            || login::handle_event(state, event, events)
            || fellowship::handle_event(state, event, events)
            || trade::handle_event(state, event, events)
            || inventory::handle_event(state, event, events)
            || system::handle_event(state, event, events)
        {
            resolve_spell_names(state, events);
        }
    }
}
