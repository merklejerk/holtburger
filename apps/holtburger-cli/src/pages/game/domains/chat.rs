use super::*;

pub(super) fn reduce_action(_state: &mut GameState, action: AppAction) -> UpdateResult {
    match action {
        AppAction::Emote { message } => UpdateResult::commands(vec![ClientCommand::Emote(message)]),
        _ => UpdateResult::new(),
    }
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    state
        .chat
        .handle_event(event, state.data.character_name.as_deref());

    UpdateResult::default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_core::client::types::ClientCommand;

    #[test]
    fn emote_action_dispatches_emote_command() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());

        let result = reduce_action(
            &mut state,
            AppAction::Emote {
                message: "waves".to_string(),
            },
        );

        assert!(
            matches!(result.commands.as_slice(), [ClientCommand::Emote(text)] if text == "waves")
        );
    }
}
