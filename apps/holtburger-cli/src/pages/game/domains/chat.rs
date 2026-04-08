use super::*;

pub(super) fn reduce_view_event(state: &mut GameState, event: ClientViewEvent) -> UpdateResult {
    state
        .chat
        .handle_event(event, state.data.character_name.as_deref());

    UpdateResult::default()
}
