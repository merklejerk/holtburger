use std::path::Path;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};
use holtburger_common::Guid;
use holtburger_common::properties::{
    PropertyBool, WorldObjectExt as _, WorldObjectPropertyAccessors,
};
use holtburger_core::ClientViewEvent;
use holtburger_core::client::types::ChatChannelKind;
use holtburger_scripting::{
    ScriptBusyOperation, ScriptChatChannelKind, ScriptChatEvent, ScriptClientView,
    ScriptConfirmation, ScriptEntityView, ScriptEvent, ScriptInventoryItemView,
    ScriptLocalConfirmation, ScriptLocalConfirmationKind, ScriptLogLevel, ScriptPartyMemberView,
    ScriptPartyView, ScriptSelfView, ScriptSource, ScriptSpellEffectView, ScriptWorkflowEvent,
};
use holtburger_world::stats::VitalType;

use crate::pages::game::{GameData, GameState};
use crate::types::{AppAction, ChatMessageTags, Interaction, LocalConfirmation};

const SCRIPT_DIR_ENV_VAR: &str = "SCRIPT_DIR";
const DEFAULT_SCRIPT_DIR: &str = "scripts";

#[derive(Clone)]
pub enum DeferredScriptSource {
    Path(PathBuf),
    Inline(ScriptSource),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct WorkflowProjection {
    target_guid: Option<Guid>,
    confirmation: Option<ScriptConfirmation>,
    busy_operation: Option<ScriptBusyOperation>,
}

pub struct TuiScriptClientView<'a> {
    pub game: Option<&'a GameState>,
    pub server_time: Option<(f64, Instant)>,
}

impl TuiScriptClientView<'_> {
    fn game(&self) -> Option<&GameState> {
        self.game
    }

    fn data(&self) -> Option<&GameData> {
        self.game().map(|game| &game.data)
    }

    fn script_entity_view(&self, guid: Guid) -> Option<ScriptEntityView> {
        let game = self.game()?;
        let entity = game.data.entities.get(&guid)?;
        let name = entity.name().trim();
        let self_position = game.data.runtime_player_position();
        let entity_position = game.data.runtime_position_for_guid(guid);
        let distance_to_self = match (self_position, game.data.distance_position_for_guid(guid)) {
            (Some(self_position), Some(entity_position)) => {
                Some(self_position.distance_to(&entity_position))
            }
            _ => None,
        };

        Some(ScriptEntityView {
            guid,
            name: (!name.is_empty()).then(|| name.to_string()),
            position: entity_position,
            distance_to_self,
            is_player: guid.is_player(),
            is_monster: entity.creature_profile.is_some() && !guid.is_player(),
            is_vendor: entity.get_bool_prop(PropertyBool::VendorService),
            is_dead: entity
                .health_fraction
                .is_some_and(|fraction| fraction <= 0.0),
        })
    }
}

impl ScriptClientView for TuiScriptClientView<'_> {
    fn self_entity(&self) -> Option<ScriptSelfView> {
        let game = self.game()?;
        let data = &game.data;
        let guid = data.player_guid?;
        let name = data.character_name.clone()?;

        Some(ScriptSelfView {
            guid,
            name,
            position: data.runtime_player_position(),
            health: data
                .vitals
                .get(&VitalType::Health)
                .map(|vital| vital.current),
            stamina: data
                .vitals
                .get(&VitalType::Stamina)
                .map(|vital| vital.current),
            mana: data.vitals.get(&VitalType::Mana).map(|vital| vital.current),
            combat_mode: data.combat_mode,
        })
    }

    fn target_entity(&self) -> Option<ScriptEntityView> {
        let target_guid = target_guid_from_interaction(self.game()?.view.active_interaction)?;
        self.script_entity_view(target_guid)
    }

    fn entity(&self, guid: Guid) -> Option<ScriptEntityView> {
        self.script_entity_view(guid)
    }

    fn nearby_entities(&self) -> Vec<ScriptEntityView> {
        let Some(data) = self.data() else {
            return Vec::new();
        };

        let player_guid = data.player_guid;
        let mut entities = data
            .entities
            .keys()
            .copied()
            .filter(|guid| Some(*guid) != player_guid)
            .filter(|guid| !data.inventory.contains(guid))
            .filter(|guid| data.runtime_position_for_guid(*guid).is_some())
            .filter_map(|guid| self.script_entity_view(guid))
            .collect::<Vec<_>>();

        entities.sort_by(|left, right| {
            left.distance_to_self
                .partial_cmp(&right.distance_to_self)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        entities
    }

    fn inventory_items(&self) -> Vec<ScriptInventoryItemView> {
        let Some(data) = self.data() else {
            return Vec::new();
        };

        let mut items = data
            .inventory
            .iter()
            .filter_map(|guid| {
                let entity = data.entities.get(guid)?;
                let name = entity.name().trim();
                Some(ScriptInventoryItemView {
                    guid: *guid,
                    name: (!name.is_empty()).then(|| name.to_string()),
                    stack_size: Some(entity.stack_size()),
                    container_guid: entity.container_id(),
                    equipped: data.equipment.contains_key(guid),
                })
            })
            .collect::<Vec<_>>();

        items.sort_by_key(|item| item.guid.0);
        items
    }

    fn fellowship(&self) -> Option<ScriptPartyView> {
        let party = &self.data()?.party;
        let members = party
            .as_ref()?
            .members
            .iter()
            .map(|member| {
                let percent = |current: u32, max: u32| {
                    if max == 0 {
                        None
                    } else {
                        Some(current as f32 / max as f32)
                    }
                };

                ScriptPartyMemberView {
                    guid: member.guid,
                    name: Some(member.name.clone()),
                    health_percent: percent(member.current_health, member.max_health),
                    stamina_percent: percent(member.current_stamina, member.max_stamina),
                    mana_percent: percent(member.current_mana, member.max_mana),
                }
            })
            .collect();

        Some(ScriptPartyView { members })
    }

    fn active_spells(&self) -> Vec<ScriptSpellEffectView> {
        let Some(data) = self.data() else {
            return Vec::new();
        };

        let Some((server_time, then)) = self.server_time else {
            return Vec::new();
        };

        let now = server_time + then.elapsed().as_secs_f64();

        data.player_enchantments
            .iter()
            .map(|enchantment| ScriptSpellEffectView {
                spell_id: u32::from(enchantment.spell_id),
                name: data.spell_name(u32::from(enchantment.spell_id)),
                expires_at_seconds: Some(enchantment.start_time + enchantment.duration - now),
                target_guid: data.player_guid,
            })
            .collect()
    }

    fn server_time(&self) -> Option<f64> {
        self.server_time
            .map(|(server_time, then)| server_time + then.elapsed().as_secs_f64())
    }

    fn pending_confirmation(&self) -> Option<ScriptConfirmation> {
        let game = self.game()?;

        if let Some(confirmation) = &game.view.active_confirmation {
            return Some(ScriptConfirmation::Character(confirmation.clone()));
        }

        game.view
            .local_confirmation
            .as_ref()
            .map(script_local_confirmation)
            .map(ScriptConfirmation::Local)
    }

    fn busy_operation(&self) -> Option<ScriptBusyOperation> {
        self.game()?
            .view
            .active_busy_operation
            .map(|kind| ScriptBusyOperation { kind })
    }
}

fn script_local_confirmation(local: &LocalConfirmation) -> ScriptLocalConfirmation {
    let kind = match local.action {
        AppAction::Unswear { .. } => ScriptLocalConfirmationKind::Unswear,
        _ => ScriptLocalConfirmationKind::Other(local.title.trim().to_string()),
    };

    ScriptLocalConfirmation {
        kind,
        text: local.text.clone(),
    }
}

fn target_guid_from_interaction(interaction: Option<Interaction>) -> Option<Guid> {
    match interaction {
        Some(Interaction::Targeting { target_guid }) => Some(target_guid),
        _ => None,
    }
}

pub(crate) fn workflow_projection(game: Option<&GameState>) -> WorkflowProjection {
    let Some(game) = game else {
        return WorkflowProjection::default();
    };

    WorkflowProjection {
        target_guid: target_guid_from_interaction(game.view.active_interaction),
        confirmation: if let Some(confirmation) = &game.view.active_confirmation {
            Some(ScriptConfirmation::Character(confirmation.clone()))
        } else {
            game.view
                .local_confirmation
                .as_ref()
                .map(script_local_confirmation)
                .map(ScriptConfirmation::Local)
        },
        busy_operation: game
            .view
            .active_busy_operation
            .map(|kind| ScriptBusyOperation { kind }),
    }
}

pub(crate) fn workflow_events(
    before: &WorkflowProjection,
    after: &WorkflowProjection,
) -> Vec<ScriptWorkflowEvent> {
    let mut events = Vec::new();

    if before.confirmation != after.confirmation {
        match &after.confirmation {
            Some(confirmation) => events.push(ScriptWorkflowEvent::ConfirmationOpened {
                confirmation: confirmation.clone(),
            }),
            None => events.push(ScriptWorkflowEvent::ConfirmationClosed),
        }
    }

    if before.busy_operation != after.busy_operation {
        events.push(ScriptWorkflowEvent::BusyOperationChanged {
            busy: after.busy_operation,
        });
    }

    if before.target_guid != after.target_guid {
        events.push(ScriptWorkflowEvent::TargetEntityChanged {
            guid: after.target_guid,
        });
    }

    events
}

fn map_chat_channel(kind: ChatChannelKind) -> ScriptChatChannelKind {
    match kind {
        ChatChannelKind::Fellowship => ScriptChatChannelKind::Fellowship,
        ChatChannelKind::Allegiance => ScriptChatChannelKind::Allegiance,
        ChatChannelKind::Vassals => ScriptChatChannelKind::Vassals,
        ChatChannelKind::Patron => ScriptChatChannelKind::Patron,
        ChatChannelKind::Monarch => ScriptChatChannelKind::Monarch,
        ChatChannelKind::CoVassals => ScriptChatChannelKind::CoVassals,
        ChatChannelKind::General => ScriptChatChannelKind::General,
        ChatChannelKind::Trade => ScriptChatChannelKind::Trade,
        ChatChannelKind::Lfg => ScriptChatChannelKind::Lfg,
        ChatChannelKind::Roleplay => ScriptChatChannelKind::Roleplay,
        ChatChannelKind::Society => ScriptChatChannelKind::Society,
        ChatChannelKind::Olthoi => ScriptChatChannelKind::Olthoi,
        ChatChannelKind::Unknown => ScriptChatChannelKind::Unknown,
    }
}

pub(crate) fn script_event_from_view_event(event: &ClientViewEvent) -> Option<ScriptEvent> {
    match event {
        ClientViewEvent::LogMessage(message) | ClientViewEvent::ServerMessage { message, .. } => {
            Some(ScriptEvent::ChatMessage(ScriptChatEvent {
                channel: ScriptChatChannelKind::System,
                sender: None,
                message: message.clone(),
            }))
        }
        ClientViewEvent::Chat {
            sender, message, ..
        } => Some(ScriptEvent::ChatMessage(ScriptChatEvent {
            channel: ScriptChatChannelKind::Say,
            sender: Some(sender.clone()),
            message: message.clone(),
        })),
        ClientViewEvent::Tell { sender, message } => {
            Some(ScriptEvent::ChatMessage(ScriptChatEvent {
                channel: ScriptChatChannelKind::Tell,
                sender: Some(sender.clone()),
                message: message.clone(),
            }))
        }
        ClientViewEvent::Emote { sender, text } => {
            Some(ScriptEvent::ChatMessage(ScriptChatEvent {
                channel: ScriptChatChannelKind::Emote,
                sender: Some(sender.clone()),
                message: text.clone(),
            }))
        }
        ClientViewEvent::ChannelMessage {
            channel,
            sender,
            message,
        } => Some(ScriptEvent::ChatMessage(ScriptChatEvent {
            channel: map_chat_channel(channel.kind),
            sender: Some(sender.clone()),
            message: message.clone(),
        })),
        ClientViewEvent::PlayerVitalsUpdated { .. } => Some(ScriptEvent::SelfVitalsChanged),
        ClientViewEvent::EntitySpawned { entity } | ClientViewEvent::EntityReplaced { entity } => {
            Some(ScriptEvent::EntityAppeared { guid: entity.guid })
        }
        ClientViewEvent::EntityIdentified { entity } => {
            Some(ScriptEvent::EntityUpdated { guid: entity.guid })
        }
        ClientViewEvent::EntityPropertiesUpdated { guid, .. }
        | ClientViewEvent::EntityMoved { guid, .. }
        | ClientViewEvent::EntityKinematicsUpdated { guid, .. }
        | ClientViewEvent::EntityMotionUpdated { guid, .. }
        | ClientViewEvent::ForcedReposition { guid, .. } => {
            Some(ScriptEvent::EntityUpdated { guid: *guid })
        }
        ClientViewEvent::EntityDespawned { guid } => {
            Some(ScriptEvent::EntityDisappeared { guid: *guid })
        }
        ClientViewEvent::PlayerSpellsUpdated { .. }
        | ClientViewEvent::PlayerEnchantmentsUpdated { .. } => Some(ScriptEvent::SpellbookChanged),
        ClientViewEvent::FellowshipStateUpdated { .. }
        | ClientViewEvent::FellowshipActivity { .. } => Some(ScriptEvent::FellowshipChanged),
        ClientViewEvent::ContainerOpened { .. } | ClientViewEvent::ContainerClosed { .. } => {
            Some(ScriptEvent::InventoryChanged)
        }
        _ => None,
    }
}

pub(crate) fn chat_tags_for_level(level: ScriptLogLevel) -> ChatMessageTags {
    match level {
        ScriptLogLevel::Trace | ScriptLogLevel::Debug => ChatMessageTags::debug(),
        ScriptLogLevel::Info => ChatMessageTags::info(),
        ScriptLogLevel::Warn => ChatMessageTags::warning(),
        ScriptLogLevel::Error => ChatMessageTags::error(),
    }
}

pub fn load_script_source_from_path(path: &Path) -> Result<ScriptSource> {
    let source = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read script source from {}", path.display()))?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    Ok(ScriptSource::new(name, source))
}

pub(crate) fn resolve_deferred_script_source(
    source: &DeferredScriptSource,
) -> Result<ScriptSource> {
    match source {
        DeferredScriptSource::Path(path) => load_script_source_from_path(path),
        DeferredScriptSource::Inline(source) => Ok(source.clone()),
    }
}

fn script_directory() -> PathBuf {
    std::env::var_os(SCRIPT_DIR_ENV_VAR)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_SCRIPT_DIR))
}

fn validate_script_basename(basename: &str) -> Result<&str> {
    let basename = basename.trim();
    anyhow::ensure!(!basename.is_empty(), "script basename cannot be empty");
    anyhow::ensure!(
        Path::new(basename)
            .file_name()
            .is_some_and(|name| name == basename),
        "script basename must not include path separators"
    );
    anyhow::ensure!(
        Path::new(basename).extension().is_none(),
        "script basename must not include a file extension"
    );
    anyhow::ensure!(
        basename != "." && basename != "..",
        "script basename is invalid"
    );
    Ok(basename)
}

fn script_path_for_basename_in_dir(script_dir: &Path, basename: &str) -> Result<PathBuf> {
    let basename = validate_script_basename(basename)?;
    Ok(script_dir.join(format!("{basename}.js")))
}

pub(crate) fn deferred_script_source_for_basename(basename: &str) -> Result<DeferredScriptSource> {
    let script_dir = script_directory();
    let path = script_path_for_basename_in_dir(&script_dir, basename)?;
    Ok(DeferredScriptSource::Path(path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{AppState, NetStats};
    use crate::types::{AppAction, AppEvent, Page};
    use holtburger_common::Vector3;
    use holtburger_common::position::WorldPosition;
    use holtburger_core::{ClientCommand, ClientState, ClientViewEvent};
    use holtburger_world::entity::Entity;

    fn build_test_app_state(script_source: ScriptSource) -> AppState {
        let mut game_state =
            GameState::new(Guid(0x5000_0001), "Player".to_string(), "World".to_string());
        game_state.data.entities.insert(
            Guid(0x5000_0001),
            Entity::new(
                Guid(0x5000_0001),
                "Player".to_string(),
                WorldPosition::default(),
            ),
        );
        game_state.script.pending_source = Some(DeferredScriptSource::Inline(script_source));

        AppState {
            account_name: "account".to_string(),
            account_password: "password".to_string(),
            character_preference: None,
            chat_log: None,
            page: Page::Game(Box::new(game_state)),
            client_state: ClientState::InWorld,
            net_stats: NetStats::default(),
            world_name: "World".to_string(),
            server_time: Some((1000.0, std::time::Instant::now())),
            content: None,
            spell_catalog: None,
            skill_table: None,
            verbosity: 0,
            quit_on_disconnect: false,
            disconnect_reason: None,
            pending_exit_message: None,
        }
    }

    #[test]
    fn script_can_react_to_chat_and_entity_events_through_app_shell() {
        let mut app_state = build_test_app_state(ScriptSource::new(
            "test.js",
            r#"
            Holtburger.onEvent((event) => {
                            if (event.kind === "Lifecycle") {
                                if (event.data.kind === "Started") {
                                    Holtburger.log("info", "lifecycle:started");
                                }

                                if (event.data.kind === "Tick") {
                                    Holtburger.log("info", `lifecycle:tick:${event.data.elapsed_seconds}`);
                                }

                                if (event.data.kind === "Stopped") {
                                    Holtburger.log("info", "lifecycle:stopped");
                                }
                            }

              if (event.kind === "ChatMessage" && event.data.message === "ping") {
                Holtburger.say("pong");
              }

              if (event.kind === "EntityAppeared") {
                Holtburger.targetEntity(event.data.guid);
              }
            });
            "#,
        ));

        let result = app_state.handle_app_event(AppEvent::ReceivedViewEvent(
            ClientViewEvent::LogMessage("ping".to_string()),
        ));

        assert!(result.commands.iter().any(|command| matches!(
            command,
            ClientCommand::Talk(message) if message == "pong"
        )));
        assert!(
            app_state
                .game_option()
                .expect("game page should exist")
                .chat
                .messages
                .iter()
                .any(|message| message.text == "lifecycle:started")
        );

        let target_guid = Guid(0x7000_0001);
        let position = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(5.0, 0.0, 0.0),
            ..WorldPosition::default()
        };

        let _ = app_state.handle_app_event(AppEvent::ReceivedViewEvent(
            ClientViewEvent::EntitySpawned {
                entity: Box::new(Entity::new(target_guid, "Target".to_string(), position)),
            },
        ));

        let game = app_state.game_option().expect("game page should exist");
        assert_eq!(
            game.view.active_interaction,
            Some(Interaction::Targeting { target_guid })
        );

        let _ = app_state.handle_app_event(AppEvent::Tick(0.25));
        assert!(
            app_state
                .game_option()
                .expect("game page should exist")
                .chat
                .messages
                .iter()
                .any(|message| message.text.starts_with("lifecycle:tick:"))
        );

        let _ = app_state.handle_app_action(AppAction::UnrunScript);

        assert!(
            app_state
                .game_option()
                .expect("game page should exist")
                .script
                .pending_source
                .is_none()
        );
        assert!(
            app_state
                .game_option()
                .expect("game page should exist")
                .script
                .host
                .is_none()
        );
        assert!(
            app_state
                .game_option()
                .expect("game page should exist")
                .chat
                .messages
                .iter()
                .any(|message| message.text == "lifecycle:stopped")
        );
    }

    #[test]
    fn script_path_for_basename_uses_js_extension() {
        let path = script_path_for_basename_in_dir(Path::new("scripts"), "farmer")
            .expect("valid script basename should resolve");

        assert_eq!(path, PathBuf::from("scripts/farmer.js"));
    }

    #[test]
    fn script_path_for_basename_rejects_path_segments_and_extensions() {
        assert!(script_path_for_basename_in_dir(Path::new("scripts"), "farm/bot").is_err());
        assert!(script_path_for_basename_in_dir(Path::new("scripts"), "bot.js").is_err());
    }
}
