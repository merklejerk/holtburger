use super::*;
use super::super::inventory_projection;

pub(super) fn reduce_runtime_body_event(
    state: &mut GameState,
    event: ClientViewEvent,
) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::PlayerGroundedUpdated { grounded } => {
            state.data.player_grounded = Some(grounded);
        }
        ClientViewEvent::SelfMovementKinematicsUpdated { kinematics } => {
            state.data.self_movement_kinematics = kinematics;
        }
        ClientViewEvent::RuntimeBodySnapshot { .. } => {
            state.refresh_context_buffer();
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::RuntimeBodyUpserted { body } => {
            if let Some(guid) = body.body_id.authoritative_guid() {
                inventory_projection::refresh_entity_context_if_visible(state, guid, &mut result);
            }
            result.request_redraw(RedrawPriority::Motion);
        }
        ClientViewEvent::RuntimeBodyRemoved { body_id } => {
            if let Some(guid) = body_id.authoritative_guid() {
                inventory_projection::refresh_entity_context_if_visible(state, guid, &mut result);
            }
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::RuntimeBodiesReset { .. } => {
            state.refresh_context_buffer();
            result.request_redraw(RedrawPriority::Immediate);
        }
        _ => {}
    }

    result
}
