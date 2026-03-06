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
    // Phase 1: Delegation to existing handlers via compatibility shims.
    // As we migrate handlers in Phase 4, we will move the logic from 
    // `state/messages/mod.rs` into the sub-modules of this area.
    state.handle_message_legacy(message, events);
}
