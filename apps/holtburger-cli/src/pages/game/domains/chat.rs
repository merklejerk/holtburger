use super::*;
use crate::utils::format_action_result_message;
use holtburger_core::ActionResultReason;
use holtburger_core::client::types::CombatFeedback;
use holtburger_core::errors::is_actually_weenie_error;

pub(super) fn reduce_action(_state: &mut GameState, action: AppAction) -> UpdateResult {
    match action {
        AppAction::Emote { message } => UpdateResult::commands(vec![ClientCommand::Emote(message)]),
        AppAction::SoulEmote { token } => {
            UpdateResult::commands(vec![ClientCommand::SoulEmote(token)])
        }
        _ => UpdateResult::new(),
    }
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    match event {
        ClientViewEvent::CombatFeedback(CombatFeedback::PlayerKilled {
            death_message,
            victim_id,
            killer_id,
        }) => {
            let message =
                resolve_player_killed_message(&state.data, death_message, *victim_id, *killer_id);
            state.chat.log(ChatMessageTags::info().combat(), message);
        }
        _ => {
            state
                .chat
                .handle_event(event, state.data.character_name.as_deref());
        }
    }

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

fn resolve_player_killed_message(
    data: &GameData,
    death_message: &str,
    victim_id: Guid,
    killer_id: Guid,
) -> String {
    let mut resolved_message = death_message.to_string();

    if let Some(victim_name) = data
        .entities
        .get(&victim_id)
        .map(|entity| entity.name().trim())
        .filter(|name| !name.is_empty())
        && resolved_message.contains("{0}")
    {
        resolved_message = resolved_message.replace("{0}", victim_name);
    }

    if let Some(killer_name) = data
        .entities
        .get(&killer_id)
        .map(|entity| entity.name().trim())
        .filter(|name| !name.is_empty())
        && resolved_message.contains("{1}")
    {
        resolved_message = resolved_message.replace("{1}", killer_name);
    }

    resolved_message
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_common::position::WorldPosition;
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
    fn soul_emote_action_dispatches_soul_emote_command() {
        let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());

        let result = reduce_action(
            &mut state,
            AppAction::SoulEmote {
                token: "wave".to_string(),
            },
        );

        assert!(matches!(
            result.commands.as_slice(),
            [ClientCommand::SoulEmote(token)] if token == "wave"
        ));
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

    #[test]
    fn nearby_player_killed_feedback_replaces_template_placeholder_with_victim_name() {
        let player_guid = Guid(0x50000001);
        let victim_guid = Guid(0x60000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

        state.data.entities.insert(
            victim_guid,
            Entity::new(victim_guid, "Bestie".to_string(), WorldPosition::default()),
        );

        let _ = reduce_view_event(
            &mut state,
            &ClientViewEvent::CombatFeedback(CombatFeedback::PlayerKilled {
                death_message: "{0} died!".to_string(),
                victim_id: victim_guid,
                killer_id: Guid(0x90AB_CDEF),
            }),
        );

        let message = state
            .chat
            .messages
            .last()
            .expect("death message should log");

        assert!(message.chat_tags.contains(ChatMessageTags::COMBAT));
        assert_eq!(message.text, "Bestie died!");
    }
}
