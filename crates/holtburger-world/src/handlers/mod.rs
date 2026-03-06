pub mod login;
pub mod movement;
pub mod inventory;
pub mod properties;
pub mod trade;
pub mod player;
pub mod system;

use crate::state::WorldState;
use crate::StateEvent;
use holtburger_protocol::messages::GameMessage;

/// Top-level dispatcher for protocol messages.
/// 
/// This is the entry point for all game messages received from the server.
/// It orchestrates mutations across [PlayerState] and [WorldState].
pub fn handle_message(
    state: &mut WorldState,
    message: &GameMessage,
    events: &mut Vec<StateEvent>,
) {
    if state.player.handle_message(
        message,
        events,
        state.xp_table.as_ref(),
        state.skill_table.as_deref(),
    ) {
        for event in events.iter_mut() {
            match event {
                StateEvent::SpellUpdated { spell_id, name } if name.is_none() => {
                    *name = state.resolve_spell_name(*spell_id);
                }
                _ => {}
            }
        }
        return;
    }

    if system::handle_message(state, message, events) {
        return;
    }

    if let GameMessage::GameEvent(event) = message {
        if login::handle_event(state, event, events)
            || trade::handle_event(state, event, events)
            || system::handle_event(state, event, events)
        {
            return;
        }
    }

    state.handle_message_legacy(message, events);
}
