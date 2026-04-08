use super::test_support::*;
use super::*;

#[test]
fn enter_input_mode_tracks_previous_focus() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.view.focused_pane = FocusedPane::Context;
    state.view.previous_focused_pane = FocusedPane::Dashboard;

    let result = apply_queued_ui_action(&mut state, AppUiAction::EnterInputMode);

    assert!(result.redraw_requested());
    assert_eq!(state.view.focused_pane, FocusedPane::Input);
    assert_eq!(state.view.previous_focused_pane, FocusedPane::Context);
}

#[test]
fn finish_input_command_submission_restores_focus_and_records_history() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.view.focused_pane = FocusedPane::Input;
    state.view.previous_focused_pane = FocusedPane::Dashboard;
    state.chat_input.history_index = Some(0);

    let result = apply_queued_ui_action(
        &mut state,
        AppUiAction::FinishInputCommandSubmission {
            command: "/scoot 3.5".to_string(),
        },
    );

    assert!(result.redraw_requested());
    assert_eq!(state.view.focused_pane, FocusedPane::Dashboard);
    assert_eq!(state.chat_input.history_index, None);
    assert_eq!(
        state.chat_input.input_history.last().map(String::as_str),
        Some("/scoot 3.5")
    );
}