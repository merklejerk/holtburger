use std::path::Path;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};
use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_core::ClientViewEvent;
use holtburger_core::client::types::ChatChannelKind;
use holtburger_world::context::WorldContextExt as _;
use holtburger_scripting::{
    ScriptBusyOperation, ScriptChatChannelKind, ScriptChatEvent,
    ScriptClientView, ScriptConfirmation, ScriptEntityView, ScriptEvent, ScriptInventoryItemView,
    ScriptLocalConfirmation, ScriptLocalConfirmationKind, ScriptLogLevel, ScriptPartyMemberView,
    ScriptPartyView, ScriptSelfView, ScriptSource, ScriptSpellEffectView, ScriptWorkflowEvent,
};
use holtburger_world::stats::VitalType;

use crate::pages::game::panels::dashboard::tabs::classification;
use crate::pages::game::{GameData, GameState, ViewState};
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
    busy_operation: ScriptBusyOperation,
}

pub struct TuiScriptClientView<'a> {
    pub data: &'a GameData,
    pub view: &'a ViewState,
    pub server_time: Option<(f64, Instant)>,
}

impl TuiScriptClientView<'_> {
    fn script_entity_view(&self, guid: Guid) -> Option<ScriptEntityView> {
        let entity = self.data.entities.get(&guid)?;
        let name = entity.name().trim();
        let self_position = self.data.runtime_player_position();
        let entity_position = self.data.runtime_position_for_guid(guid);
        let distance_to_self = match (self_position, self.data.distance_position_for_guid(guid)) {
            (Some(self_position), Some(entity_position)) => self_position.distance_to(&entity_position),
            _ => 0.0,
        };

        let is_dead = entity
            .health_fraction
            .is_some_and(|fraction| fraction <= 0.0)
            || entity
                .motion_snapshot
                .map(|snapshot| snapshot.indicates_death_motion())
                .unwrap_or(false);

        Some(ScriptEntityView {
            guid,
            name: (!name.is_empty()).then(|| name.to_string()),
            kind: classification::classify_entity(entity).kind(),
            position: entity_position.unwrap_or_default(),
            distance_to_self,
            is_dead,
        })
    }
}

impl ScriptClientView for TuiScriptClientView<'_> {
    fn self_entity(&self) -> Option<ScriptSelfView> {
        let guid = self.data.player_guid?;
        let name = self.data.character_name.clone()?;

        Some(ScriptSelfView {
            guid,
            name,
            position: self
                .data
                .runtime_player_position()
                .unwrap_or_default(),
            health: self
                .data
                .vitals
                .get(&VitalType::Health)
                .map(|vital| vital.current)
                .unwrap_or_default(),
            health_max: self
                .data
                .vitals
                .get(&VitalType::Health)
                .map(|vital| vital.buffed_max)
                .unwrap_or_default(),
            stamina: self
                .data
                .vitals
                .get(&VitalType::Stamina)
                .map(|vital| vital.current)
                .unwrap_or_default(),
            stamina_max: self
                .data
                .vitals
                .get(&VitalType::Stamina)
                .map(|vital| vital.buffed_max)
                .unwrap_or_default(),
            mana: self
                .data
                .vitals
                .get(&VitalType::Mana)
                .map(|vital| vital.current)
                .unwrap_or_default(),
            mana_max: self
                .data
                .vitals
                .get(&VitalType::Mana)
                .map(|vital| vital.buffed_max)
                .unwrap_or_default(),
            encumbrance: self.data.player_encumbrance().unwrap_or_default(),
            capacity: self.data.player_capacity().unwrap_or_default(),
            busy_operation: self
                .view
                .active_busy_operation
                .map(ScriptBusyOperation::from_kind)
                .unwrap_or_default(),
            heading: self.data.runtime_heading().unwrap_or_default(),
            combat_mode: self.data.combat_mode,
        })
    }

    fn target_entity(&self) -> Option<ScriptEntityView> {
        let target_guid = target_guid_from_interaction(self.view.active_interaction)?;
        self.script_entity_view(target_guid)
    }

    fn entity(&self, guid: Guid) -> Option<ScriptEntityView> {
        self.script_entity_view(guid)
    }

    fn nearby_entities(&self) -> Vec<ScriptEntityView> {
        let player_guid = self.data.player_guid;
        let mut entities = self
            .data
            .entities
            .keys()
            .copied()
            .filter(|guid| Some(*guid) != player_guid)
            .filter(|guid| !self.data.inventory.contains(guid))
            .filter(|guid| self.data.runtime_position_for_guid(*guid).is_some())
            .filter_map(|guid| self.script_entity_view(guid))
            .collect::<Vec<_>>();

        entities.sort_by(|left, right| {
            left.distance_to_self
                .total_cmp(&right.distance_to_self)
        });

        entities
    }

    fn inventory_items(&self) -> Vec<ScriptInventoryItemView> {
        let mut items = self
            .data
            .inventory
            .iter()
            .filter_map(|guid| {
                let entity = self.data.entities.get(guid)?;
                let name = entity.name().trim();
                Some(ScriptInventoryItemView {
                    guid: *guid,
                    name: (!name.is_empty()).then(|| name.to_string()),
                    stack_size: Some(entity.stack_size()),
                    container_guid: entity.container_id(),
                    equipped: self.data.equipment.contains_key(guid),
                })
            })
            .collect::<Vec<_>>();

        items.sort_by_key(|item| item.guid.0);
        items
    }

    fn fellowship(&self) -> Option<ScriptPartyView> {
        let party = &self.data.party;
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
        let Some((server_time, then)) = self.server_time else {
            return Vec::new();
        };

        let now = server_time + then.elapsed().as_secs_f64();

        self.data
            .player_enchantments
            .iter()
            .map(|enchantment| ScriptSpellEffectView {
                spell_id: u32::from(enchantment.spell_id),
                name: self.data.spell_name(u32::from(enchantment.spell_id)),
                remaining_seconds: Some(enchantment.start_time + enchantment.duration - now),
                target_guid: self.data.player_guid,
            })
            .collect()
    }

    fn server_time(&self) -> Option<f64> {
        self.server_time
            .map(|(server_time, then)| server_time + then.elapsed().as_secs_f64())
    }

    fn pending_confirmation(&self) -> Option<ScriptConfirmation> {
        if let Some(confirmation) = &self.view.active_confirmation {
            return Some(ScriptConfirmation::Character(confirmation.clone()));
        }

        self.view
            .local_confirmation
            .as_ref()
            .map(script_local_confirmation)
            .map(ScriptConfirmation::Local)
    }

    fn busy_operation(&self) -> ScriptBusyOperation {
        self.view
            .active_busy_operation
            .map(ScriptBusyOperation::from_kind)
            .unwrap_or_default()
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
            .map(ScriptBusyOperation::from_kind)
            .unwrap_or_default(),
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
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        PropertyInt, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_core::client::types::BusyOperationKind;
    use holtburger_world::entity::Entity;
    use holtburger_world::stats::{Attribute, AttributeType, Vital, VitalType};

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

    #[test]
    fn self_entity_projects_max_vitals_burden_capacity_busy_state_and_heading() {
        let player_guid = Guid(0x5000_0001);
        let item_guid = Guid(0x8000_0001);
        let heading = 1.25_f32;
        let player_position = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(1.0, 2.0, 3.0),
            rotation: Quaternion::from_heading(heading),
        };

        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(player_position);
        data.vitals.insert(
            VitalType::Health,
            Vital {
                vital_type: VitalType::Health,
                ranks: 0,
                start: 0,
                spent_xp: 0,
                next_rank_xp: None,
                base: 111,
                buffed_max: 222,
                current: 99,
            },
        );
        data.vitals.insert(
            VitalType::Stamina,
            Vital {
                vital_type: VitalType::Stamina,
                ranks: 0,
                start: 0,
                spent_xp: 0,
                next_rank_xp: None,
                base: 333,
                buffed_max: 444,
                current: 333,
            },
        );
        data.vitals.insert(
            VitalType::Mana,
            Vital {
                vital_type: VitalType::Mana,
                ranks: 0,
                start: 0,
                spent_xp: 0,
                next_rank_xp: None,
                base: 555,
                buffed_max: 666,
                current: 444,
            },
        );
        data.attributes.insert(
            AttributeType::StrengthAttr,
            Attribute {
                attr_type: AttributeType::StrengthAttr,
                ranks: 0,
                start: 100,
                spent_xp: 0,
                next_rank_xp: None,
                base: 100,
                current: 100,
            },
        );

        let mut player = Entity::new(player_guid, "Player".to_string(), player_position);
        player.set_int_prop(PropertyInt::AugmentationIncreasedCarryingCapacity, 1);
        data.entities.insert(player_guid, player);

        let mut item = Entity::new(item_guid, "Pack Item".to_string(), WorldPosition::default());
        item.set_int_prop(PropertyInt::EncumbranceVal, 300);
        item.set_container_id(Some(player_guid));
        data.entities.insert(item_guid, item);
        data.inventory.insert(item_guid);

        let mut view = ViewState::default();
        view.active_busy_operation = Some(BusyOperationKind::Buy);

        let script_view = TuiScriptClientView {
            data: &data,
            view: &view,
            server_time: None,
        };

        let self_view = script_view
            .self_entity()
            .expect("player snapshot should be available");

        assert_eq!(self_view.guid, player_guid);
        assert_eq!(self_view.health, 99);
        assert_eq!(self_view.health_max, 222);
        assert_eq!(self_view.stamina, 333);
        assert_eq!(self_view.stamina_max, 444);
        assert_eq!(self_view.mana, 444);
        assert_eq!(self_view.mana_max, 666);
        assert_eq!(self_view.encumbrance, 300.0);
        assert_eq!(self_view.capacity, 18_000.0);
        assert_eq!(
            self_view.busy_operation,
            ScriptBusyOperation::Buy
        );
        assert!((self_view.heading - heading).abs() < 1e-6);
        assert_eq!(self_view.position, player_position);
    }
}
