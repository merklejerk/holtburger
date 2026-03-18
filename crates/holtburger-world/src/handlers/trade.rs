use crate::WorldEvent;
use crate::state::WorldState;
use holtburger_protocol::messages::{GameEvent, GameEventMessage};

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    match &event.event {
        GameEvent::RegisterTrade(data) => {
            state.register_trade(data.initiator, data.partner, events);
            true
        }
        GameEvent::AddToTrade(data) => {
            state.add_trade_item(data.trade_side, data.object_guid, events);
            true
        }
        GameEvent::AcceptTrade(data) => {
            state.accept_trade(data.who_accepted, events);
            true
        }
        GameEvent::ResetTrade(_) => {
            state.reset_trade(events);
            true
        }
        GameEvent::DeclineTrade(_)
        | GameEvent::ClearTradeAcceptance
        | GameEvent::TradeFailure(_) => {
            state.clear_trade_acceptance(events);
            true
        }
        GameEvent::CloseTrade(_) => {
            state.close_trade(events);
            true
        }
        GameEvent::ApproachVendor(data) => {
            state.set_vendor_state(data, events);
            true
        }
        _ => false,
    }
}
