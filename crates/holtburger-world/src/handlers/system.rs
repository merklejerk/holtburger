use crate::WorldEvent;
use crate::state::WorldState;
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::{GameEvent, GameEventMessage, GameMessage};

pub(crate) fn handle_message(
    state: &mut WorldState,
    message: &GameMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    match message {
        GameMessage::SetState(data) => state.apply_set_state_update(data, events),
        GameMessage::GameEvent(event) => handle_event(state, event, events),
        _ => false,
    }
}

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    match &event.event {
        GameEvent::UseDone(data) => {
            events.push(WorldEvent::UseDone { error: data.error });
            true
        }
        GameEvent::WeenieError(data) => {
            events.push(WorldEvent::WeenieError { error: data.error });
            if data.error == WeenieError::TradeComplete {
                state.handle_trade_complete(events);
            }
            true
        }
        GameEvent::WeenieErrorWithString(data) => {
            events.push(WorldEvent::WeenieErrorWithString {
                error: data.error,
                parameter: data.parameter.clone(),
            });
            true
        }
        _ => false,
    }
}
