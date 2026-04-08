use super::*;

pub(super) fn apply_tick_logopolis(
    state: &mut GameState,
    elapsed: f64,
    result: &mut UpdateResult,
) {
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
