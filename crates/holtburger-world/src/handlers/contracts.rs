//! Contract tracker reduction; character admission remains core-owned.

use crate::state::contracts::ContractMembershipChange;
use crate::{WorldEvent, WorldState};
use holtburger_protocol::messages::{GameEvent, GameEventMessage};
use std::time::Instant;

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    let now = Instant::now();
    let change = match &event.event {
        GameEvent::SendClientContractTrackerTable(table) => {
            state.contracts.get_or_insert_default().replace(table, now);
            None
        }
        GameEvent::SendClientContractTracker(update) => state
            .contracts
            .get_or_insert_default()
            .update(update, now)
            .map(|kind| ContractMembershipChange {
                kind,
                id: update.tracker.id,
                name: state
                    .contract_catalog
                    .get(update.tracker.id)
                    .map(|reference| reference.definition.name.clone()),
            }),
        _ => return false,
    };
    events.push(WorldEvent::ContractsStateUpdated);
    if let Some(change) = change {
        events.push(WorldEvent::ContractMembershipChanged(change));
    }
    true
}
