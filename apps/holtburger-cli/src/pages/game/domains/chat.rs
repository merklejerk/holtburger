use super::*;
use crate::utils::format_action_result_message;
use holtburger_core::ActionResultReason;
use holtburger_core::errors::is_actually_weenie_error;

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

    match event {
        ClientViewEvent::ActionResult { reason, .. } => {
            let message = format_action_result_message(reason);
            let chat_tags = match reason {
                ActionResultReason::Weenie(error, _) => {
                    if is_actually_weenie_error(*error) {
                        ChatMessageTags::error()
                    } else {
                        ChatMessageTags::info()
                    }
                }
                ActionResultReason::Transport(_) => ChatMessageTags::warning(),
                _ => ChatMessageTags::error(),
            };

            UpdateResult::new().with_action(AppAction::Log { chat_tags, message })
        }
        _ => UpdateResult::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_core::client::types::ClientCommand;
    use holtburger_protocol::errors::WeenieError;

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

    #[test]
    fn action_result_emits_chat_log_action() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());

        let result = reduce_view_event(
            &mut state,
            &ClientViewEvent::ActionResult {
                source: holtburger_core::client::types::ActionResultSource::Wire,
                reason: ActionResultReason::Weenie(WeenieError::YouDontHaveAllTheComponents, None),
            },
        );

        assert_eq!(result.actions.len(), 1);
        assert!(matches!(
            &result.actions[0],
            AppAction::Log { chat_tags, message }
                if *chat_tags == ChatMessageTags::error() && message == "You don't have all the components."
        ));
    }
}
