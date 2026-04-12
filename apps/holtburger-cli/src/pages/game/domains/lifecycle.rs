use super::*;

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        ClientViewEvent::ActiveCharacterConfirmationUpdated { confirmation } => {
            state.view.active_confirmation = confirmation.clone();
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::StatusUpdate {
            state: client_state,
        } => {
            if matches!(
                client_state,
                holtburger_core::client::types::ClientState::InWorld
            ) {
                state
                    .runtime
                    .inventory_notifications
                    .begin_quiet_period(Instant::now());
            }
        }
        ClientViewEvent::BootAccount(..) => {}
        ClientViewEvent::PingResponse
        | ClientViewEvent::NetPulse { .. }
        | ClientViewEvent::Disconnected => {}
        _ => {}
    }

    result
}
