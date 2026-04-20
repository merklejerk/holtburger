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

#[test]
fn chat_history_navigation_restores_the_current_draft() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.view.focused_pane = FocusedPane::Input;
    state.view.previous_focused_pane = FocusedPane::Dashboard;
    state.chat_input.input.set_text("draft message");
    state.chat_input.input_history = vec!["first".to_string(), "second".to_string()];
    state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

    let up = state.handle_input(crossterm::event::KeyEvent::new(
        crossterm::event::KeyCode::Up,
        crossterm::event::KeyModifiers::NONE,
    ));
    assert!(up.redraw_requested());
    assert_eq!(state.chat_input.input.text(), "second");
    assert_eq!(state.chat_input.history_index, Some(1));
    assert_eq!(
        state.chat_input.history_draft.as_deref(),
        Some("draft message")
    );

    let down = state.handle_input(crossterm::event::KeyEvent::new(
        crossterm::event::KeyCode::Down,
        crossterm::event::KeyModifiers::NONE,
    ));
    assert!(down.redraw_requested());
    assert_eq!(state.chat_input.input.text(), "draft message");
    assert_eq!(state.chat_input.history_index, None);
    assert_eq!(state.chat_input.history_draft, None);
}
