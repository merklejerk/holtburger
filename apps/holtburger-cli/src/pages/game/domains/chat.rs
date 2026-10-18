use super::*;
use holtburger_core::ActionResultReason;
use holtburger_core::client::types::CombatFeedback;
use holtburger_core::errors::format_action_result_message;
use holtburger_core::errors::is_actually_weenie_error;

pub(super) fn reduce_action(_state: &mut GameState, action: AppAction) -> UpdateResult {
    match action {
        AppAction::Suicide => UpdateResult::commands(vec![ClientCommand::Suicide]),
        AppAction::Emote { message } => UpdateResult::commands(vec![ClientCommand::Emote(message)]),
        AppAction::SoulEmote { token } => {
            UpdateResult::commands(vec![ClientCommand::SoulEmote(token)])
        }
        _ => UpdateResult::new(),
    }
}

pub(super) fn reduce_view_event(state: &mut GameState, event: &ClientViewEvent) -> UpdateResult {
    match event {
        ClientViewEvent::DeathLocations(result)
            if Some(result.character) == state.data.player_guid =>
        {
            for line in death_location_lines(&result.locations) {
                state.chat.log(ChatMessageTags::system(), line);
            }
        }

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

fn death_location_lines(
    locations: &holtburger_core::client::corpse::DeathLocations,
) -> Vec<String> {
    use holtburger_core::client::corpse::DeathLocations;
    fn location(position: Option<holtburger_common::position::WorldPosition>) -> String {
        match position {
            None => "Position unavailable".into(),
            Some(p) if p.is_indoors() => format!(
                "Indoors cell 0x{:08X}, position ({:.1}, {:.1}, {:.1})",
                p.landblock_id.0, p.coords.x, p.coords.y, p.coords.z
            ),
            Some(p) => format!("({})", p.to_world_coords()),
        }
    }
    match locations {
        DeathLocations::LastOutdoor { position } => vec![match position {
            Some(p) => format!("Last outdoor death: {}. This saved location does not confirm a corpse remains.", location(Some(*p))),
            None => "No saved last outdoor death location.".into(),
        }],
        DeathLocations::Recent { positions } if positions.is_empty() => vec!["No deaths observed this session.".into()],
        DeathLocations::Recent { positions } => std::iter::once("Recent deaths, newest first: approximate position samples may be stale or reflect a later position; corpses/items are unconfirmed.".into())
            .chain(positions.iter().enumerate().map(|(i, p)| format!("{}. {}", i + 1, location(*p)))).collect(),
    }
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
