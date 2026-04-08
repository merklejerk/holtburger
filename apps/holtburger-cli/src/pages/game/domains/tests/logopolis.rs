use super::test_support::*;
use super::*;

#[test]
fn logopolis_context_view_starts_and_clears_runtime_state() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let start_result = apply_queued_ui_action(
        &mut state,
        AppUiAction::ChangeContextView {
            view: ContextView::Logopolis,
        },
    );

    assert!(start_result.redraw_requested());
    assert_eq!(state.view.context_view, ContextView::Logopolis);
    assert!(super::super::logopolis_state(&state).is_some());
    assert_eq!(state.view.focused_pane, FocusedPane::Context);
    assert_eq!(state.view.previous_focused_pane, FocusedPane::Context);

    let stop_result = apply_queued_ui_action(
        &mut state,
        AppUiAction::ChangeContextView {
            view: ContextView::Default,
        },
    );

    assert!(stop_result.redraw_requested());
    assert_eq!(state.view.context_view, ContextView::Default);
    assert!(super::super::logopolis_state(&state).is_none());
}
