use super::*;
use super::super::interaction_policy;

pub(super) fn reduce_navigation_event(
    state: &mut GameState,
    event: ClientViewEvent,
) -> UpdateResult {
    let mut result = UpdateResult::new();

    if let ClientViewEvent::NoClipUpdated { .. } = event {
        result.merge(state.handle_navigation_event(event));
    }

    result
}

pub(super) fn apply_navigation_interrupt(
    state: &mut GameState,
    input: NavigationInput,
    result: &mut UpdateResult,
) {
    interaction_policy::handle_navigation_interrupt(state, input, result);
}
