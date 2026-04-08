use super::*;

pub(super) fn reduce_lifecycle_event(
    state: &mut GameState,
    event: ClientViewEvent,
) -> UpdateResult {
    let mut result = UpdateResult::new();

    match event {
        event @ (ClientViewEvent::ActiveCharacterConfirmationUpdated { .. }
        | ClientViewEvent::BusyStateUpdated { .. }
        | ClientViewEvent::StatusUpdate { .. }) => {
            let redraw = !matches!(event, ClientViewEvent::StatusUpdate { .. });
            state.handle_game_lifecycle_event(event);
            if redraw {
                result.request_redraw(RedrawPriority::Immediate);
            }
        }
        ClientViewEvent::BusyOperationFinished { .. } => {
            result.request_redraw(RedrawPriority::Immediate);
        }
        ClientViewEvent::BootAccount(reason) => {
            state.chat.handle_event(
                ClientViewEvent::BootAccount(reason),
                state.data.character_name.as_deref(),
            );
        }
        ClientViewEvent::PingResponse
        | ClientViewEvent::NetPulse { .. }
        | ClientViewEvent::Disconnected => {}
        _ => {}
    }

    result
}