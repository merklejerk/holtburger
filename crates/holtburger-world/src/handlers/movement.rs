use crate::WorldEvent;
use crate::entity::{EntityMotionSnapshot, EntityMovementAdmission};
use crate::motion::MotionCommand;
use crate::state::WorldState;
use holtburger_common::Guid;
use holtburger_protocol::messages::GameMessage;

fn publish_entity_motion_update(
    state: &mut WorldState,
    guid: Guid,
    snapshot: EntityMotionSnapshot,
    events: &mut Vec<WorldEvent>,
) {
    if let Some(body_id) = state.update_runtime_body_motion_snapshot_for_guid(guid, Some(snapshot))
    {
        events.push(WorldEvent::RuntimeBodyChanged { body_id });
    }
    events.push(WorldEvent::EntityMotionUpdated {
        guid,
        motion: crate::entity::EntityNetworkMotion::Initialized(snapshot),
    });
}

/// Reports an admitted wire command retail cannot expand before playback silently loses it.
fn report_unsupported_interpreted_commands(
    state: &WorldState,
    guid: Guid,
    snapshot: EntityMotionSnapshot,
) {
    let motion_table_id = state.effective_motion_table_id_for_guid(guid);
    let style = snapshot.current_style.map_or(0, |style| style as u32);
    for (channel, command) in [
        ("forward", snapshot.forward_command),
        ("sidestep", snapshot.sidestep_command),
        ("turn", snapshot.turn_command),
    ] {
        let Some(command) = command else {
            continue;
        };
        if MotionCommand::from_interpreted(command).is_some() {
            continue;
        }
        match motion_table_id {
            Some(motion_table_id) => log::warn!(
                "entity 0x{guid:08X} admitted unsupported interpreted {channel} command 0x{:04X} for motion table 0x{motion_table_id:08X} in style 0x{style:08X}",
                command.raw(),
            ),
            None => log::warn!(
                "entity 0x{guid:08X} admitted unsupported interpreted {channel} command 0x{:04X} with no effective motion table in style 0x{style:08X}",
                command.raw(),
            ),
        }
    }
}

fn report_rejected_motion_actions(
    guid: Guid,
    rejected: impl IntoIterator<Item = crate::entity::EntityMotionActionRejection>,
) {
    for rejection in rejected {
        log::warn!("entity 0x{guid:08X} rejected transient motion action: {rejection:?}");
    }
}

pub(crate) fn handle_message(
    state: &mut WorldState,
    message: &GameMessage,
    events: &mut Vec<WorldEvent>,
) -> bool {
    match message {
        GameMessage::UpdatePosition(data) => {
            if data.guid == state.player.guid {
                events.extend(state.set_player_position(data.pos.pos));
                true
            } else {
                state.apply_entity_position_pack(data.guid, &data.pos, events)
            }
        }
        GameMessage::PrivateUpdatePosition(data) => {
            state.apply_private_position_update(data.position_type, data.pos, events);
            true
        }
        GameMessage::PublicUpdatePosition(data) => {
            state.apply_public_position_update(data.guid, data.position_type, data.pos, events)
        }
        GameMessage::AutonomousPosition(data) => {
            if data.guid == state.player.guid {
                events.extend(state.apply_player_autonomous_position(data));
                true
            } else {
                state.apply_entity_autonomous_position(data, events)
            }
        }
        GameMessage::UpdateMotion(data) => {
            let guid = data.guid;
            let is_local = guid == state.player.guid && !guid.is_null();
            if is_local && !state.player.apply_self_update_motion(data) {
                return true;
            }
            if is_local && !data.is_autonomous {
                events.push(WorldEvent::SelfServerControlledMotion(Box::new(
                    (**data).clone(),
                )));
            }
            let admission = match state.entities.get_mut(guid) {
                Some(entity) if is_local => entity.apply_locally_admitted_movement(data),
                Some(entity) => entity.admit_movement_with_action_policy(data, true),
                None => return false,
            };
            let (snapshot, motion_changed, actions, rejected_actions) = match admission {
                EntityMovementAdmission::Rejected
                | EntityMovementAdmission::MovementSequenceAdvanced => return true,
                EntityMovementAdmission::Applied {
                    snapshot,
                    motion_changed,
                    actions,
                    rejected_actions,
                    ..
                } => (snapshot, motion_changed, actions, rejected_actions),
            };

            report_unsupported_interpreted_commands(state, guid, snapshot);
            report_rejected_motion_actions(guid, rejected_actions);
            state.enqueue_entity_motion_actions(guid, actions);

            if motion_changed {
                publish_entity_motion_update(state, guid, snapshot, events);
            }

            if snapshot.indicates_death_motion() {
                state.update_health_fraction(guid, 0.0, events);
            }

            true
        }
        GameMessage::VectorUpdate(data) => {
            if data.guid == state.player.guid {
                events.extend(state.record_player_server_vectors(data.velocity, data.omega));
                true
            } else {
                let Some(entity) = state.entities.get_mut(data.guid) else {
                    return false;
                };
                if !entity
                    .admit_remote_vector_sequences(data.instance_sequence, data.vector_sequence)
                {
                    return true;
                }
                state.update_entity_velocity(data.guid, data.velocity, data.omega, events)
            }
        }
        _ => false,
    }
}
