use super::*;
use crate::utils::format_action_result_message;
use holtburger_core::motion_command_for_soul_emote_pose;
use holtburger_protocol::messages::movement::MotionStance;
use holtburger_core::ActionResultReason;
use holtburger_core::client::types::CombatFeedback;
use holtburger_core::errors::is_actually_weenie_error;
use holtburger_world::entity::EntityMotionSnapshot;

pub(super) fn reduce_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    match action {
        AppAction::Emote { message } => UpdateResult::commands(vec![ClientCommand::Emote(message)]),
        AppAction::SoulEmote { token } => {
            let mut result = UpdateResult::commands(vec![ClientCommand::SoulEmote(token.clone())]);
            project_local_soul_emote_pose(state, &token, &mut result);
            result
        }
        _ => UpdateResult::new(),
    }
}

fn project_local_soul_emote_pose(state: &mut GameState, token: &str, result: &mut UpdateResult) {
    let Some(player_guid) = state.data.player_guid else {
        return;
    };

    let Some(catalog) = state.data.soul_emote_catalog.as_ref() else {
        return;
    };

    let Some(command) = catalog
        .resolve(token)
        .and_then(|resolved| motion_command_for_soul_emote_pose(resolved.pose))
    else {
        return;
    };

    let snapshot = EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(command),
        ..EntityMotionSnapshot::default()
    };

    if let Some(entity) = state.data.entities.get_mut(&player_guid) {
        entity.motion_snapshot = Some(snapshot);
    }

    let cache_changed = state
        .data
        .runtime_body_cache
        .set_motion_state_for_guid(player_guid, Some(snapshot));

    if cache_changed || state.data.entities.contains_key(&player_guid) {
        result.request_redraw(RedrawPriority::Motion);
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
    use holtburger_content::{SoulEmoteCatalog, SoulEmotePose, SoulEmoteToken};
    use holtburger_core::client::types::ClientCommand;
    use holtburger_protocol::errors::WeenieError;
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::Entity;
    use holtburger_world::{ContactState, RuntimeSpatialBodyView, SpatialBodyId, SpatialSampleMode};
    use std::collections::BTreeMap;
    use std::sync::Arc;
    use std::time::Instant;

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
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.entities.insert(
            player_guid,
            Entity::new(player_guid, "Player".to_string(), WorldPosition::default()),
        );
        state.data.soul_emote_catalog = Some(Arc::new(SoulEmoteCatalog {
            tokens: BTreeMap::from([(
                "wave".to_string(),
                SoulEmoteToken {
                    token: "wave".to_string(),
                    pose: "Wave".to_string(),
                },
            )]),
            poses: BTreeMap::from([(
                "Wave".to_string(),
                SoulEmotePose {
                    pose: "Wave".to_string(),
                    my_emote: "wave.".to_string(),
                    other_emote: "waves.".to_string(),
                },
            )]),
        }));

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
        assert!(matches!(
            state
                .data
                .entities
                .get(&player_guid)
                .and_then(|entity| entity.motion_snapshot),
            Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                forward_command: Some(command),
                ..
            }) if command == InterpretedMotionCommand(0x0087)
        ));
    }

    #[test]
    fn soul_emote_action_updates_runtime_body_cache_motion_state() {
        let player_guid = Guid(0x50000001);
        let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
        state.data.soul_emote_catalog = Some(Arc::new(SoulEmoteCatalog {
            tokens: BTreeMap::from([(
                "wave".to_string(),
                SoulEmoteToken {
                    token: "wave".to_string(),
                    pose: "Wave".to_string(),
                },
            )]),
            poses: BTreeMap::from([(
                "Wave".to_string(),
                SoulEmotePose {
                    pose: "Wave".to_string(),
                    my_emote: "wave.".to_string(),
                    other_emote: "waves.".to_string(),
                },
            )]),
        }));
        state.data.runtime_body_cache.apply_view_event(
            &ClientViewEvent::RuntimeBodyUpserted {
                body: Box::new(RuntimeSpatialBodyView {
                    body_id: SpatialBodyId::LocalPlayer(player_guid),
                    authoritative_pose: Some(WorldPosition::default()),
                    runtime_pose: WorldPosition::default(),
                    velocity: Default::default(),
                    omega: Default::default(),
                    motion_state: None,
                    contact: ContactState::Grounded,
                    sample_mode: SpatialSampleMode::SimulatingMotionState,
                }),
            },
            Instant::now(),
        );

        let _ = reduce_action(
            &mut state,
            AppAction::SoulEmote {
                token: "wave".to_string(),
            },
        );

        assert!(matches!(
            state
                .data
                .runtime_body_cache
                .spatial_sample(player_guid)
                .and_then(|sample| sample.motion_state),
            Some(EntityMotionSnapshot {
                current_style: Some(MotionStance::NonCombat),
                forward_command: Some(command),
                ..
            }) if command == InterpretedMotionCommand(0x0087)
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
