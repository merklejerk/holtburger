use super::*;

pub(super) fn activate(state: &mut GameState) {
    state.runtime.logopolis = Some(LogopolisState::new());
}

pub(super) fn deactivate(state: &mut GameState) {
    state.runtime.logopolis = None;
}

pub(super) fn apply_tick(state: &mut GameState, elapsed: f64, result: &mut UpdateResult) {
    if state.view.context_view == ContextView::Logopolis {
        let game = state
            .runtime
            .logopolis
            .get_or_insert_with(LogopolisState::new);
        if elapsed.is_finite() && elapsed > 0.0 {
            game.tick(Duration::from_secs_f64(elapsed));
        }
        result.request_redraw(RedrawPriority::Immediate);
    } else if state.runtime.logopolis.is_some() {
        state.runtime.logopolis = None;
    }
}

pub(crate) fn logopolis_state(state: &GameState) -> Option<&LogopolisState> {
    state.runtime.logopolis.as_ref()
}

pub(crate) fn logopolis_state_mut(state: &mut GameState) -> Option<&mut LogopolisState> {
    state.runtime.logopolis.as_mut()
}
