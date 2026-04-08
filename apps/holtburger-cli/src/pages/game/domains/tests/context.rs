use super::*;

#[test]
fn read_action_uses_generic_use_command_for_books() {
    let player_guid = Guid(0x50000001);
    let book_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let result = state
        .handle_action(AppAction::Read { guid: book_guid })
        .expect("read action should produce an update result");

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::Use(guid) if *guid == book_guid))
    );
    assert_eq!(state.view.context_view, ContextView::Book(book_guid));
}
