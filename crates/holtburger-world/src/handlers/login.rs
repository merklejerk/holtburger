use crate::WorldEvent;
use crate::state::WorldState;
use holtburger_protocol::messages::{GameEvent, GameEventMessage};

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    match &event.event {
        GameEvent::PlayerDescription(data) => {
            state.apply_player_description_world_state(data, events);
            true
        }
        _ => false,
    }
}
