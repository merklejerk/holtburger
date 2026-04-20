use crate::WorldEvent;
use crate::events::FellowshipActivity;
use crate::state::{FellowshipMemberState, FellowshipState, WorldState};
use holtburger_protocol::messages::{GameEvent, GameEventMessage};

pub(crate) fn handle_event(
    state: &mut WorldState,
    event: &GameEventMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    match &event.event {
        GameEvent::FellowshipFullUpdate(data) => {
            let previous_fellowship = state.fellowship.clone();
            state.fellowship = Some(FellowshipState::from(data.as_ref()));

            if previous_fellowship.is_none()
                && let Some(fellowship) = state.fellowship.as_ref()
                && fellowship
                    .members
                    .iter()
                    .any(|member| member.guid == state.player.guid)
            {
                events.push(WorldEvent::FellowshipActivity(
                    FellowshipActivity::YouJoined {
                        fellowship_name: fellowship.name.clone(),
                    },
                ));
            }

            events.push(WorldEvent::FellowshipStateUpdated(state.fellowship.clone()));
            true
        }
        GameEvent::FellowshipUpdateFellow(data) => {
            let member = FellowshipMemberState::from(&data.fellow);
            let member_is_new = state.fellowship.as_ref().is_none_or(|fellowship| {
                !fellowship
                    .members
                    .iter()
                    .any(|existing| existing.guid == member.guid)
            });

            match state.fellowship.as_mut() {
                Some(fellowship) => fellowship.upsert_member(member.clone()),
                None => {
                    state.fellowship = Some(FellowshipState::unknown_with_member(member.clone()))
                }
            }

            if member_is_new {
                if member.guid == state.player.guid {
                    let fellowship_name = state
                        .fellowship
                        .as_ref()
                        .map(|fellowship| fellowship.name.clone())
                        .unwrap_or_default();
                    events.push(WorldEvent::FellowshipActivity(
                        FellowshipActivity::YouJoined { fellowship_name },
                    ));
                } else {
                    events.push(WorldEvent::FellowshipActivity(
                        FellowshipActivity::MemberJoined {
                            member_name: member.name.clone(),
                        },
                    ));
                }
            }

            events.push(WorldEvent::FellowshipStateUpdated(state.fellowship.clone()));
            true
        }
        GameEvent::FellowshipQuit(data) => {
            apply_member_departure(state, data.player_guid, false, events);
            true
        }
        GameEvent::FellowshipDismiss(data) => {
            apply_member_departure(state, data.player_guid, true, events);
            true
        }
        GameEvent::FellowshipDisband => {
            let fellowship_name = state
                .fellowship
                .as_ref()
                .map(|fellowship| fellowship.name.clone());
            state.fellowship = None;
            events.push(WorldEvent::FellowshipActivity(
                FellowshipActivity::FellowshipDisbanded { fellowship_name },
            ));
            events.push(WorldEvent::FellowshipStateUpdated(None));
            true
        }
        GameEvent::FellowshipFellowUpdateDone | GameEvent::FellowshipFellowStatsDone => true,
        _ => false,
    }
}

fn apply_member_departure(
    state: &mut WorldState,
    player_guid: holtburger_common::Guid,
    dismissed: bool,
    events: &mut Vec<WorldEvent>,
) {
    let member_name = state
        .fellowship
        .as_ref()
        .and_then(|fellowship| {
            fellowship
                .members
                .iter()
                .find(|member| member.guid == player_guid)
                .map(|member| member.name.clone())
        })
        .unwrap_or_else(|| format!("0x{:08X}", player_guid.0));

    let mut clear_fellowship = player_guid == state.player.guid;

    if let Some(fellowship) = state.fellowship.as_mut() {
        fellowship.remove_member(player_guid);
        fellowship.reassess_leader_after_departure(player_guid);
        clear_fellowship = clear_fellowship || fellowship.members.is_empty();
    }

    if clear_fellowship {
        state.fellowship = None;
    }

    let activity = match (player_guid == state.player.guid, dismissed) {
        (true, true) => FellowshipActivity::YouWereDismissed,
        (true, false) => FellowshipActivity::YouLeft,
        (false, true) => FellowshipActivity::MemberWasDismissed { member_name },
        (false, false) => FellowshipActivity::MemberLeft { member_name },
    };
    events.push(WorldEvent::FellowshipActivity(activity));
    events.push(WorldEvent::FellowshipStateUpdated(state.fellowship.clone()));
}
