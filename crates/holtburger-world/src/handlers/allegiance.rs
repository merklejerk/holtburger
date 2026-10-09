//! Profile replacement and known-node presence reduction.

use crate::{WorldEvent, WorldState};
use holtburger_protocol::messages::{GameEvent, GameEventMessage};

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    match &event.event {
        GameEvent::AllegianceUpdate(profile) => {
            state.allegiance = Some(profile.as_ref().into());
            events.push(WorldEvent::AllegianceStateUpdated);
        }
        GameEvent::AllegianceLoginNotification(presence) => {
            if let Some(profile) = &mut state.allegiance
                && profile.update_presence(presence.guid, presence.online)
            {
                events.push(WorldEvent::AllegianceStateUpdated);
            }
        }
        _ => return false,
    }
    true
}
