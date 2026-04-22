use std::collections::BTreeMap;
use std::path::Path;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, Result};
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    EquipMask, WorldObjectExt as _, WorldObjectPropertyAccessors as _,
};
use holtburger_core::ClientViewEvent;
use holtburger_core::client::types::{ActionResultReason, ChatChannelKind, CombatFeedback};
use holtburger_scripting::{
    ScriptBusyOperation, ScriptCharacterAttributeView, ScriptCharacterSheetView,
    ScriptCharacterSkillView, ScriptCharacterVitalView, ScriptChatChannelKind, ScriptChatEvent,
    ScriptClientInteraction, ScriptClientView, ScriptCombatFeedback, ScriptCombatInfo,
    ScriptConfirmation, ScriptContainerView, ScriptEnchantmentView, ScriptEntityKind,
    ScriptEntityProfile, ScriptEntityView, ScriptEquipmentSlotKind, ScriptEquipmentSlotView,
    ScriptEvent, ScriptJsonValue, ScriptLocalConfirmation, ScriptLocalConfirmationKind,
    ScriptMessageStyle, ScriptMotionCommand, ScriptPartyMemberView, ScriptPartyView,
    ScriptPositionRef, ScriptSelfView, ScriptSource, ScriptTradeInfo, ScriptWorkflowEvent,
};
use holtburger_world::context::WorldContextExt as _;
use holtburger_world::stats::{TrainingLevel, VitalType};
use std::ffi::OsStr;
use std::fs;
use std::io::ErrorKind;

use crate::pages::game::panels::dashboard::tabs::classification;
use crate::pages::game::{GameData, GameState, ViewState};
use crate::types::{AppAction, AppNotification, ChatMessageTags, Interaction, LocalConfirmation};

const SCRIPT_DIR_ENV_VAR: &str = "SCRIPT_DIR";
const SCRIPT_BUNDLE_DIR_ENV_VAR: &str = "SCRIPT_BUNDLE_DIR";
const DEFAULT_SCRIPT_DIR: &str = "scripts";

fn running_script_stem(script_name: &str) -> Option<&str> {
    Path::new(script_name).file_stem()?.to_str()
}

fn script_config_path_for_name(script_dir: &Path, script_name: &str) -> Option<PathBuf> {
    let stem = running_script_stem(script_name)?;
    Some(
        script_dir
            .join(".config")
            .join(format!("{stem}.config.json")),
    )
}

fn script_data_path_for_name(script_dir: &Path, script_name: &str) -> Option<PathBuf> {
    let stem = running_script_stem(script_name)?;
    Some(script_dir.join(format!("{stem}.data.json")))
}

fn script_data_bin_path_for_name(script_dir: &Path, script_name: &str) -> Option<PathBuf> {
    let stem = running_script_stem(script_name)?;
    Some(script_dir.join(format!("{stem}.data.bin")))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DiscoverableScriptSource {
    Local,
    System,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiscoverableScript {
    pub basename: String,
    pub source: DiscoverableScriptSource,
}

fn load_json_file(path: &Path) -> Option<ScriptJsonValue> {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == ErrorKind::NotFound => return None,
        Err(error) => {
            log::error!("failed to read JSON from {}: {error}", path.display());
            return None;
        }
    };

    match serde_json::from_str::<ScriptJsonValue>(&contents) {
        Ok(value) => Some(value),
        Err(error) => {
            log::error!("failed to parse JSON from {}: {error}", path.display());
            None
        }
    }
}

fn load_binary_file(path: &Path) -> Option<Vec<u8>> {
    match fs::read(path) {
        Ok(contents) => Some(contents),
        Err(error) if error.kind() == ErrorKind::NotFound => None,
        Err(error) => {
            log::error!(
                "failed to read binary data from {}: {error}",
                path.display()
            );
            None
        }
    }
}

fn first_existing_path(paths: impl IntoIterator<Item = Option<PathBuf>>) -> Option<PathBuf> {
    paths.into_iter().flatten().find(|path| path.exists())
}

fn write_json_file(path: &Path, contents: &str) -> bool {
    if let Some(parent) = path.parent()
        && let Err(error) = fs::create_dir_all(parent)
    {
        log::error!(
            "failed to create config directory {}: {error}",
            parent.display()
        );
        return false;
    }

    match fs::write(path, contents) {
        Ok(()) => true,
        Err(error) => {
            log::error!("failed to write JSON to {}: {error}", path.display());
            false
        }
    }
}

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
    pub script_name: Option<&'a str>,
}

impl TuiScriptClientView<'_> {
    fn resolve_position_reference(&self, reference: ScriptPositionRef) -> Option<WorldPosition> {
        match reference {
            ScriptPositionRef::Position(position) => Some(WorldPosition::from(position)),
            ScriptPositionRef::Guid(guid) => {
                if Some(guid) == self.data.player_guid {
                    self.data.runtime_player_position()
                } else {
                    self.data.entities.get(&guid).map(|entity| entity.position)
                }
            }
        }
    }

    fn script_entity_view(&self, guid: Guid) -> Option<ScriptEntityView> {
        let entity = self.data.entities.get(&guid)?;
        let name = entity.name().trim();
        let self_position = self.data.runtime_player_position();
        let entity_position = self.data.runtime_position_for_guid(guid);
        let distance_to_self = match (self_position, self.data.distance_position_for_guid(guid)) {
            (Some(self_position), Some(entity_position)) => {
                self_position.distance_to(&entity_position)
            }
            _ => 0.0,
        };

        let motion_command = entity
            .motion_command()
            .map(ScriptMotionCommand::from)
            .unwrap_or_default();

        let profile = entity
            .armor_profile
            .as_ref()
            .cloned()
            .map(ScriptEntityProfile::Armor)
            .or_else(|| {
                entity
                    .creature_profile
                    .as_ref()
                    .cloned()
                    .map(ScriptEntityProfile::Creature)
            })
            .or_else(|| {
                entity
                    .weapon_profile
                    .as_ref()
                    .cloned()
                    .map(ScriptEntityProfile::Weapon)
            });

        Some(ScriptEntityView {
            guid,
            name: (!name.is_empty()).then(|| name.to_string()),
            kind: classification::classify_entity(entity).kind(),
            weenie_id: entity.wcid,
            position: entity_position.unwrap_or_default().into(),
            profile,
            container: entity.container_id().unwrap_or(Guid::NULL),
            wielder: entity.wielder_id().unwrap_or(Guid::NULL),
            distance_to_self,
            motion_command,
        })
    }

    fn equipped_item_for_mask(&self, equip_mask: EquipMask) -> Option<Guid> {
        self.data
            .equipment
            .iter()
            .filter(|(_, equipped_mask)| equipped_mask.intersects(equip_mask))
            .min_by_key(|(guid, _)| guid.0)
            .map(|(guid, _)| *guid)
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
                .unwrap_or_default()
                .into(),
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

    fn character_sheet(&self) -> Option<ScriptCharacterSheetView> {
        self.data.player_guid?;

        let mut attributes = self
            .data
            .attributes
            .values()
            .map(|attribute| ScriptCharacterAttributeView {
                attribute_type: attribute.attr_type,
                base: attribute.base,
                effective: attribute.current,
            })
            .collect::<Vec<_>>();
        attributes.sort_by(|left, right| {
            left.attribute_type
                .to_string()
                .cmp(&right.attribute_type.to_string())
        });

        let mut vitals = self
            .data
            .vitals
            .values()
            .map(|vital| ScriptCharacterVitalView {
                vital_type: vital.vital_type,
                base: vital.base,
                effective: vital.buffed_max,
                current: vital.current,
            })
            .collect::<Vec<_>>();
        vitals.sort_by(|left, right| {
            left.vital_type
                .to_string()
                .cmp(&right.vital_type.to_string())
        });

        let mut skills = self
            .data
            .skills
            .values()
            .filter(|skill| skill.skill_type.is_eor())
            .map(|skill| ScriptCharacterSkillView {
                skill_type: skill.skill_type,
                base: skill.base,
                effective: skill.current,
                training: skill.training,
            })
            .collect::<Vec<_>>();
        skills.sort_by(|left, right| {
            let left_trained = matches!(
                left.training,
                TrainingLevel::Trained | TrainingLevel::Specialized
            );
            let right_trained = matches!(
                right.training,
                TrainingLevel::Trained | TrainingLevel::Specialized
            );

            right_trained.cmp(&left_trained).then_with(|| {
                left.skill_type
                    .to_string()
                    .cmp(&right.skill_type.to_string())
            })
        });

        Some(ScriptCharacterSheetView {
            attributes,
            vitals,
            skills,
        })
    }

    fn combat_info(&self) -> ScriptCombatInfo {
        ScriptCombatInfo {
            combat_mode: self.data.combat_mode,
            is_engaged: self.data.combat_runtime.desired_engagement().is_some(),
            target: self.data.combat_runtime.desired_engagement_target(),
            power: self.data.combat_controls.profile_level.wire_value(),
            height: self.data.combat_controls.attack_height,
            last_attack_time: self.server_time.and_then(|(server_time, now)| {
                self.data.combat_runtime.last_attack_attempt_at().and_then(
                    |last_attack_attempt_at| {
                        now.checked_duration_since(last_attack_attempt_at)
                            .map(|age| server_time - age.as_secs_f64())
                    },
                )
            }),
        }
    }

    fn current_interaction(&self) -> Option<ScriptClientInteraction> {
        if let Some(target) = self.data.combat_runtime.desired_engagement_target() {
            return Some(ScriptClientInteraction::Attack { guid: target });
        }

        match self.view.active_interaction {
            Some(Interaction::Targeting { target_guid }) => {
                Some(ScriptClientInteraction::TargetEntity { guid: target_guid })
            }
            Some(Interaction::Approaching { target_guid }) => {
                Some(ScriptClientInteraction::Approach { guid: target_guid })
            }
            Some(Interaction::Following { target_guid }) => {
                Some(ScriptClientInteraction::Follow { guid: target_guid })
            }
            _ => None,
        }
    }

    fn enchantments(&self) -> Vec<ScriptEnchantmentView> {
        let mut best_by_spell_id: BTreeMap<u32, (f64, u16, u32)> = BTreeMap::new();

        for enchantment in &self.data.player_enchantments {
            let spell_id = u32::from(enchantment.spell_id);
            let end_time = if enchantment.duration < 0.0 {
                f64::INFINITY
            } else {
                enchantment.start_time + enchantment.duration
            };
            let candidate = (end_time, enchantment.layer, enchantment.power_level);

            best_by_spell_id
                .entry(spell_id)
                .and_modify(|best| {
                    if candidate > *best {
                        *best = candidate;
                    }
                })
                .or_insert(candidate);
        }

        best_by_spell_id
            .into_iter()
            .map(|(spell_id, (end_time, _, _))| ScriptEnchantmentView { spell_id, end_time })
            .collect()
    }

    fn distance(&self, from: ScriptPositionRef, to: ScriptPositionRef) -> f32 {
        let Some(from) = self.resolve_position_reference(from) else {
            return 0.0;
        };

        let Some(to) = self.resolve_position_reference(to) else {
            return 0.0;
        };

        from.distance_to(&to)
    }

    fn heading_to(&self, from: ScriptPositionRef, to: ScriptPositionRef) -> f32 {
        let Some(from) = self.resolve_position_reference(from) else {
            return 0.0;
        };

        let Some(to) = self.resolve_position_reference(to) else {
            return 0.0;
        };

        from.heading_to(&to)
    }

    fn target_entity(&self) -> Option<ScriptEntityView> {
        let target_guid = target_guid_from_interaction(self.view.active_interaction)?;
        self.script_entity_view(target_guid)
    }

    fn entity(&self, guid: Guid) -> Option<ScriptEntityView> {
        self.script_entity_view(guid)
    }

    fn entity_bool_prop(
        &self,
        guid: Guid,
        prop: holtburger_common::properties::PropertyBool,
    ) -> Option<bool> {
        self.data.entities.get(&guid)?.get_bool_prop_opt(prop)
    }

    fn entity_int_prop(
        &self,
        guid: Guid,
        prop: holtburger_common::properties::PropertyInt,
    ) -> Option<i32> {
        self.data.entities.get(&guid)?.get_int_prop(prop)
    }

    fn entity_int64_prop(
        &self,
        guid: Guid,
        prop: holtburger_common::properties::PropertyInt64,
    ) -> Option<i64> {
        self.data.entities.get(&guid)?.get_int64_prop(prop)
    }

    fn entity_float_prop(
        &self,
        guid: Guid,
        prop: holtburger_common::properties::PropertyFloat,
    ) -> Option<f64> {
        self.data.entities.get(&guid)?.get_float_prop(prop)
    }

    fn entity_string_prop(
        &self,
        guid: Guid,
        prop: holtburger_common::properties::PropertyString,
    ) -> Option<String> {
        self.data
            .entities
            .get(&guid)?
            .get_string_prop(prop)
            .map(str::to_string)
    }

    fn entity_data_prop(
        &self,
        guid: Guid,
        prop: holtburger_common::properties::PropertyDataId,
    ) -> Option<Guid> {
        self.data.entities.get(&guid)?.get_data_prop(prop)
    }

    fn entity_instance_prop(
        &self,
        guid: Guid,
        prop: holtburger_common::properties::PropertyInstanceId,
    ) -> Option<Guid> {
        self.data.entities.get(&guid)?.get_instance_prop(prop)
    }

    fn load_config(&self) -> Option<ScriptJsonValue> {
        let script_name = self.script_name?;
        let path = script_config_path_for_name(&script_directory(), script_name)?;
        load_json_file(&path)
    }

    fn load_data(&self) -> Option<ScriptJsonValue> {
        let script_name = self.script_name?;
        let path = resolve_script_data_path_for_name_in_dirs(
            &script_directory(),
            script_bundle_directory().as_deref(),
            script_name,
        );
        let Some(path) = path else {
            log::warn!("missing script data for {script_name}");
            return None;
        };
        load_json_file(&path)
    }

    fn load_data_bin(&self) -> Option<Vec<u8>> {
        let script_name = self.script_name?;
        let path = first_existing_path([
            script_data_bin_path_for_name(&script_directory(), script_name),
            script_bundle_directory()
                .as_deref()
                .and_then(|script_dir| script_data_bin_path_for_name(script_dir, script_name)),
        ]);
        let Some(path) = path else {
            log::warn!("missing script binary data for {script_name}");
            return None;
        };
        load_binary_file(&path)
    }

    fn write_config(&self, contents: String) -> bool {
        let Some(script_name) = self.script_name else {
            log::error!("cannot write script config because no script is running");
            return false;
        };

        let Some(path) = script_config_path_for_name(&script_directory(), script_name) else {
            log::error!("cannot write script config because the running script name is invalid");
            return false;
        };

        write_json_file(&path, &contents)
    }

    fn nearby_entities(
        &self,
        max_distance: Option<f32>,
        classifications: Option<Vec<ScriptEntityKind>>,
    ) -> Vec<ScriptEntityView> {
        let player_guid = self.data.player_guid;
        let mut entities = self
            .data
            .entities
            .keys()
            .copied()
            .filter(|guid| Some(*guid) != player_guid)
            .filter(|guid| !self.data.inventory.contains(guid))
            .filter(|guid| self.data.runtime_position_for_guid(*guid).is_some())
            .filter_map(|guid| {
                let entity = self.script_entity_view(guid)?;

                if max_distance.is_some_and(|max_distance| entity.distance_to_self > max_distance) {
                    return None;
                }

                if classifications
                    .as_ref()
                    .is_some_and(|filters| !filters.contains(&entity.kind))
                {
                    return None;
                }

                Some(entity)
            })
            .collect::<Vec<_>>();

        entities.sort_by(|left, right| left.distance_to_self.total_cmp(&right.distance_to_self));

        entities
    }

    fn inventory(&self) -> Vec<ScriptContainerView> {
        let mut containers: BTreeMap<Guid, (u32, Vec<Guid>)> = BTreeMap::new();

        if let Some(player_guid) = self.data.player_guid
            && let Some(player) = self.data.entities.get(&player_guid)
        {
            containers.insert(
                player_guid,
                (player.items_capacity().unwrap_or(0), Vec::new()),
            );
        }

        for guid in self.data.inventory.iter().copied() {
            let Some(entity) = self.data.entities.get(&guid) else {
                continue;
            };

            if entity.items_capacity().unwrap_or(0) > 0 {
                containers
                    .entry(guid)
                    .or_insert_with(|| (entity.items_capacity().unwrap_or(0), Vec::new()));
            }

            if let Some(container_guid) = entity.container_id() {
                let slots = self
                    .data
                    .entities
                    .get(&container_guid)
                    .and_then(|container| container.items_capacity())
                    .unwrap_or(0);

                containers
                    .entry(container_guid)
                    .or_insert_with(|| (slots, Vec::new()))
                    .1
                    .push(guid);
            }
        }

        containers
            .into_iter()
            .map(|(container_guid, (slots, mut items))| {
                items.sort_unstable();
                ScriptContainerView {
                    container_guid,
                    slots,
                    items,
                }
            })
            .collect()
    }

    fn current_open_container(&self) -> Option<Guid> {
        self.data.current_open_container()
    }

    fn equipment(&self) -> Vec<ScriptEquipmentSlotView> {
        ScriptEquipmentSlotKind::ALL
            .iter()
            .copied()
            .map(|slot| {
                let equip_mask = slot.equip_mask();
                ScriptEquipmentSlotView {
                    slot,
                    equip_mask,
                    item_guid: self.equipped_item_for_mask(equip_mask),
                }
            })
            .collect()
    }

    fn current_trade_info(&self) -> Option<ScriptTradeInfo> {
        let trade = self.data.trade.as_ref()?;
        let partner_name = self
            .data
            .entities
            .get(&trade.partner_guid)
            .and_then(|entity| {
                let name = entity.name().trim();
                (!name.is_empty()).then(|| name.to_string())
            });

        Some(ScriptTradeInfo {
            partner_guid: trade.partner_guid,
            partner_name,
            our_items: trade.self_side.items.clone(),
            their_items: trade.partner_side.items.clone(),
        })
    }

    fn spellbook(&self) -> Vec<u32> {
        self.data.player_spells.clone()
    }

    fn in_spellbook(&self, spell_id: u32) -> bool {
        self.data.player_spells.contains(&spell_id)
    }

    fn entity_exists(&self, guid: Guid) -> bool {
        self.data.entities.contains_key(&guid)
    }

    fn party(&self) -> Option<ScriptPartyView> {
        let party = self.data.party.as_ref()?;
        let members = party
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

        Some(ScriptPartyView {
            leader_guid: party.leader_guid,
            members,
        })
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
        ClientViewEvent::SoulEmote { sender, text, .. } => {
            Some(ScriptEvent::ChatMessage(ScriptChatEvent {
                channel: ScriptChatChannelKind::SoulEmote,
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
        ClientViewEvent::ActionResult {
            reason: ActionResultReason::Weenie(error, _),
            ..
        } => Some(ScriptEvent::WeenieError { error: *error }),
        ClientViewEvent::CombatFeedback(CombatFeedback::AttackDone { error }) => Some(
            ScriptEvent::CombatFeedback(ScriptCombatFeedback::AttackDone { error: *error }),
        ),
        ClientViewEvent::CombatFeedback(CombatFeedback::AttackCommenced) => Some(
            ScriptEvent::CombatFeedback(ScriptCombatFeedback::AttackCommenced),
        ),
        ClientViewEvent::CombatFeedback(CombatFeedback::AttackerNotification {
            defender_name,
            damage_type,
            health_percent,
            damage,
            critical_hit,
            attack_conditions,
        }) => Some(ScriptEvent::CombatFeedback(
            ScriptCombatFeedback::AttackerNotification {
                defender_name: defender_name.clone(),
                damage_type: *damage_type,
                health_percent: *health_percent,
                damage: *damage,
                critical_hit: *critical_hit,
                attack_conditions: *attack_conditions,
            },
        )),
        ClientViewEvent::CombatFeedback(CombatFeedback::DefenderNotification {
            attacker_name,
            damage_type,
            health_percent,
            damage,
            damage_location,
            critical_hit,
            attack_conditions,
        }) => Some(ScriptEvent::CombatFeedback(
            ScriptCombatFeedback::DefenderNotification {
                attacker_name: attacker_name.clone(),
                damage_type: *damage_type,
                health_percent: *health_percent,
                damage: *damage,
                damage_location: *damage_location,
                critical_hit: *critical_hit,
                attack_conditions: *attack_conditions,
            },
        )),
        ClientViewEvent::CombatFeedback(CombatFeedback::EvasionAttackerNotification {
            defender_name,
        }) => Some(ScriptEvent::CombatFeedback(
            ScriptCombatFeedback::EvasionAttackerNotification {
                defender_name: defender_name.clone(),
            },
        )),
        ClientViewEvent::CombatFeedback(CombatFeedback::EvasionDefenderNotification {
            attacker_name,
        }) => Some(ScriptEvent::CombatFeedback(
            ScriptCombatFeedback::EvasionDefenderNotification {
                attacker_name: attacker_name.clone(),
            },
        )),
        ClientViewEvent::CombatFeedback(CombatFeedback::VictimNotification { death_message }) => {
            Some(ScriptEvent::CombatFeedback(
                ScriptCombatFeedback::VictimNotification {
                    death_message: death_message.clone(),
                },
            ))
        }
        ClientViewEvent::CombatFeedback(CombatFeedback::KillerNotification { death_message }) => {
            Some(ScriptEvent::CombatFeedback(
                ScriptCombatFeedback::KillerNotification {
                    death_message: death_message.clone(),
                },
            ))
        }
        ClientViewEvent::CombatFeedback(CombatFeedback::PlayerKilled {
            death_message,
            victim_id,
            killer_id,
        }) => Some(ScriptEvent::PlayerKilled {
            death_message: death_message.clone(),
            victim_id: *victim_id,
            killer_id: *killer_id,
        }),
        ClientViewEvent::TeleportStarted { sequence } => Some(ScriptEvent::TeleportStarted {
            sequence: *sequence,
        }),
        ClientViewEvent::PlayerVitalsUpdated { .. } => Some(ScriptEvent::SelfVitalsChanged),
        ClientViewEvent::EntitySpawned { entity } | ClientViewEvent::EntityReplaced { entity } => {
            Some(ScriptEvent::EntityAppeared { guid: entity.guid })
        }
        ClientViewEvent::EntityIdentified { entity } => {
            Some(ScriptEvent::EntityUpdated { guid: entity.guid })
        }
        ClientViewEvent::EntityHealthUpdated { guid, .. }
        | ClientViewEvent::EntityBookUpdated { guid, .. }
        | ClientViewEvent::EntityPropertiesUpdated { guid, .. }
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
        | ClientViewEvent::FellowshipActivity { .. } => Some(ScriptEvent::PartyChanged),
        _ => None,
    }
}

pub(crate) fn script_event_from_notification(
    notification: &AppNotification,
) -> Option<ScriptEvent> {
    match notification {
        AppNotification::InventoryChanged { removed, added } => {
            Some(ScriptEvent::InventoryChanged {
                added: added.clone(),
                removed: removed.clone(),
            })
        }
        AppNotification::ActiveInteractionChanged { .. } => None,
        AppNotification::PlayerEntityReady { .. } => None,
    }
}

pub(crate) fn chat_tags_for_style(style: ScriptMessageStyle) -> ChatMessageTags {
    match style {
        ScriptMessageStyle::Trace | ScriptMessageStyle::Debug => ChatMessageTags::debug(),
        ScriptMessageStyle::Info => ChatMessageTags::info(),
        ScriptMessageStyle::Warn => ChatMessageTags::warning(),
        ScriptMessageStyle::Error => ChatMessageTags::error(),
        ScriptMessageStyle::System => ChatMessageTags::system(),
        ScriptMessageStyle::Chat => ChatMessageTags::chat(),
        ScriptMessageStyle::Combat => ChatMessageTags::COMBAT,
        ScriptMessageStyle::Tell => ChatMessageTags::tell(),
        ScriptMessageStyle::Emote => ChatMessageTags::emote(),
        ScriptMessageStyle::Party => ChatMessageTags::PARTY,
        ScriptMessageStyle::Guild => ChatMessageTags::GUILD,
        ScriptMessageStyle::Trade => ChatMessageTags::TRADE,
        ScriptMessageStyle::Help => ChatMessageTags::HELP,
        ScriptMessageStyle::Society => ChatMessageTags::SOCIETY,
        ScriptMessageStyle::Magic => ChatMessageTags::MAGIC,
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

pub(crate) fn script_directory() -> PathBuf {
    std::env::var_os(SCRIPT_DIR_ENV_VAR)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_SCRIPT_DIR))
}

fn script_bundle_directory() -> Option<PathBuf> {
    std::env::var_os(SCRIPT_BUNDLE_DIR_ENV_VAR)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_script_source_path_for_basename_in_dirs(
    local_script_dir: &Path,
    system_script_dir: Option<&Path>,
    basename: &str,
) -> Result<PathBuf> {
    let local_script_path = script_path_for_basename_in_dir(local_script_dir, basename)?;
    if local_script_path.exists() {
        return Ok(local_script_path);
    }

    if let Some(script_dir) = system_script_dir {
        let system_script_path = script_path_for_basename_in_dir(script_dir, basename)?;
        if system_script_path.exists() {
            return Ok(system_script_path);
        }
    }

    Err(anyhow::anyhow!(
        "script {basename} was not found in the local or system scripts directories"
    ))
}

fn resolve_script_data_path_for_name_in_dirs(
    local_script_dir: &Path,
    system_script_dir: Option<&Path>,
    script_name: &str,
) -> Option<PathBuf> {
    first_existing_path([
        script_data_path_for_name(local_script_dir, script_name),
        system_script_dir.and_then(|script_dir| script_data_path_for_name(script_dir, script_name)),
    ])
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
    let path = resolve_script_source_path_for_basename_in_dirs(
        &script_directory(),
        script_bundle_directory().as_deref(),
        basename,
    )?;
    Ok(DeferredScriptSource::Path(path))
}

fn discoverable_script_basenames_in_dir(script_dir: &Path) -> Result<Vec<String>> {
    let entries = match fs::read_dir(script_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };

    let mut basenames = Vec::new();

    for entry in entries {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }

        let path = entry.path();
        let is_js_file =
            matches!(path.extension(), Some(extension) if extension == OsStr::new("js"));
        if !is_js_file {
            continue;
        }

        let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
            continue;
        };

        if validate_script_basename(stem).is_ok() {
            basenames.push(stem.to_string());
        }
    }

    basenames.sort_unstable();
    basenames.dedup();
    Ok(basenames)
}

fn discoverable_script_entries_in_dir(
    script_dir: &Path,
    source: DiscoverableScriptSource,
) -> Result<Vec<DiscoverableScript>> {
    Ok(discoverable_script_basenames_in_dir(script_dir)?
        .into_iter()
        .map(|basename| DiscoverableScript { basename, source })
        .collect())
}

pub(crate) fn discoverable_scripts() -> Result<Vec<DiscoverableScript>> {
    let mut entries = BTreeMap::new();

    for entry in
        discoverable_script_entries_in_dir(&script_directory(), DiscoverableScriptSource::Local)?
    {
        entries.insert(entry.basename.clone(), entry);
    }

    if let Some(script_dir) = script_bundle_directory() {
        for entry in
            discoverable_script_entries_in_dir(&script_dir, DiscoverableScriptSource::System)?
        {
            entries.entry(entry.basename.clone()).or_insert(entry);
        }
    }

    Ok(entries.into_values().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ItemType, ObjectDescriptionFlag, PropertyBool, PropertyDataId, PropertyFloat,
        PropertyInstanceId, PropertyInt, PropertyInt64, PropertyString,
        WorldObjectPropertyAccessorsMut,
    };
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_core::client::types::BusyOperationKind;
    use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
    use holtburger_protocol::messages::magic::Enchantment;
    use holtburger_protocol::messages::movement::InterpretedMotionCommand;
    use holtburger_protocol::messages::object::types::ArmorProfile;
    use holtburger_world::entity::{Entity, EntityMotionSnapshot};
    use holtburger_world::state::{TradeSide, TradeState};
    use holtburger_world::stats::{
        Attribute, AttributeType, Skill, SkillType, TrainingLevel, Vital, VitalType,
    };
    use std::fs;
    use std::fs::File;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    #[test]
    fn discoverable_script_basenames_reads_js_files_in_sorted_order() {
        let unique_dir = std::env::temp_dir().join(format!(
            "holtburger-script-discovery-{}",
            std::process::id()
        ));

        if unique_dir.exists() {
            fs::remove_dir_all(&unique_dir).expect("remove stale test directory");
        }

        fs::create_dir_all(unique_dir.join("nested")).expect("create test directory");
        File::create(unique_dir.join("beta.js")).expect("create beta.js");
        File::create(unique_dir.join("alpha.js")).expect("create alpha.js");
        File::create(unique_dir.join("notes.txt")).expect("create notes.txt");
        File::create(unique_dir.join("nested").join("gamma.js")).expect("create nested file");

        let basenames = discoverable_script_basenames_in_dir(&unique_dir)
            .expect("discoverable scripts should load");

        assert_eq!(basenames, vec!["alpha".to_string(), "beta".to_string()]);

        fs::remove_dir_all(&unique_dir).expect("clean up test directory");
    }

    #[test]
    fn discoverable_script_basenames_treats_missing_directory_as_empty() {
        let unique_dir = std::env::temp_dir().join(format!(
            "holtburger-missing-script-discovery-{}",
            std::process::id()
        ));

        if unique_dir.exists() {
            fs::remove_dir_all(&unique_dir).expect("remove stale test directory");
        }

        let basenames = discoverable_script_basenames_in_dir(&unique_dir)
            .expect("missing directories should be treated as empty");

        assert!(basenames.is_empty());
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

    #[test]
    fn script_persistence_paths_use_running_script_stem() {
        let script_dir = Path::new("/tmp/holtburger-scripts");

        assert_eq!(
            script_config_path_for_name(script_dir, "fighter.js"),
            Some(PathBuf::from(
                "/tmp/holtburger-scripts/.config/fighter.config.json"
            ))
        );

        assert_eq!(
            script_data_path_for_name(script_dir, "fighter.js"),
            Some(PathBuf::from("/tmp/holtburger-scripts/fighter.data.json"))
        );
    }

    #[test]
    fn script_resolution_prefers_local_roots_over_system_roots() {
        let local_dir = std::env::temp_dir().join(format!(
            "holtburger-local-script-resolution-{}",
            std::process::id()
        ));
        let system_dir = std::env::temp_dir().join(format!(
            "holtburger-system-script-resolution-{}",
            std::process::id()
        ));

        if local_dir.exists() {
            fs::remove_dir_all(&local_dir).expect("remove stale local test directory");
        }
        if system_dir.exists() {
            fs::remove_dir_all(&system_dir).expect("remove stale system test directory");
        }

        fs::create_dir_all(&local_dir).expect("create local test directory");
        fs::create_dir_all(&system_dir).expect("create system test directory");

        File::create(local_dir.join("fighter.js")).expect("create local fighter.js");
        File::create(local_dir.join("fighter.data.json")).expect("create local fighter.data.json");
        File::create(system_dir.join("fighter.js")).expect("create system fighter.js");
        File::create(system_dir.join("fighter.data.json"))
            .expect("create system fighter.data.json");

        let script_path = resolve_script_source_path_for_basename_in_dirs(
            &local_dir,
            Some(&system_dir),
            "fighter",
        )
        .expect("script path should resolve");
        let data_path =
            resolve_script_data_path_for_name_in_dirs(&local_dir, Some(&system_dir), "fighter.js")
                .expect("data path should resolve");

        assert_eq!(script_path, local_dir.join("fighter.js"));
        assert_eq!(data_path, local_dir.join("fighter.data.json"));

        fs::remove_dir_all(&local_dir).expect("clean up local test directory");
        fs::remove_dir_all(&system_dir).expect("clean up system test directory");
    }

    #[test]
    fn json_file_helpers_round_trip_and_create_parent_directories() {
        let unique_dir = std::env::temp_dir().join(format!(
            "holtburger-script-persistence-{}",
            std::process::id()
        ));

        if unique_dir.exists() {
            fs::remove_dir_all(&unique_dir).expect("remove stale test directory");
        }

        let path = unique_dir.join(".config").join("fighter.config.json");

        assert!(write_json_file(&path, r#"{"answer":42}"#));
        assert_eq!(
            load_json_file(&path),
            Some(serde_json::json!({"answer": 42}))
        );

        fs::remove_dir_all(&unique_dir).expect("clean up test directory");
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

        let view = ViewState {
            active_busy_operation: Some(BusyOperationKind::Buy),
            ..ViewState::default()
        };

        let script_view = TuiScriptClientView {
            data: &data,
            view: &view,
            server_time: None,
            script_name: None,
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
        assert_eq!(self_view.busy_operation, ScriptBusyOperation::Buy);
        assert!((self_view.heading - heading).abs() < 1e-6);
        assert_eq!(self_view.position, player_position.into());
    }

    #[test]
    fn character_sheet_projection_includes_sections_and_filters_to_eor_skills() {
        let player_guid = Guid(0x5000_0101);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());

        data.attributes.insert(
            AttributeType::StrengthAttr,
            Attribute {
                attr_type: AttributeType::StrengthAttr,
                ranks: 7,
                start: 100,
                spent_xp: 0,
                next_rank_xp: None,
                base: 100,
                current: 110,
            },
        );
        data.vitals.insert(
            VitalType::Health,
            Vital {
                vital_type: VitalType::Health,
                ranks: 4,
                start: 50,
                spent_xp: 0,
                next_rank_xp: None,
                base: 150,
                buffed_max: 175,
                current: 160,
            },
        );
        data.skills.insert(
            SkillType::MeleeDefense,
            Skill {
                skill_type: SkillType::MeleeDefense,
                ranks: 12,
                init: 5,
                spent_xp: 0,
                next_rank_xp: None,
                base: 35,
                current: 42,
                training: TrainingLevel::Trained,
                trained_cost: 0,
                specialized_cost: 0,
            },
        );
        data.skills.insert(
            SkillType::Axe,
            Skill {
                skill_type: SkillType::Axe,
                ranks: 12,
                init: 5,
                spent_xp: 0,
                next_rank_xp: None,
                base: 35,
                current: 42,
                training: TrainingLevel::Specialized,
                trained_cost: 0,
                specialized_cost: 0,
            },
        );

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: Some("fighter.js"),
        };

        let sheet = script_view
            .character_sheet()
            .expect("character sheet should be available");

        assert_eq!(sheet.attributes.len(), 1);
        assert_eq!(
            sheet.attributes[0].attribute_type,
            AttributeType::StrengthAttr
        );
        assert_eq!(sheet.attributes[0].base, 100);
        assert_eq!(sheet.attributes[0].effective, 110);

        assert_eq!(sheet.vitals.len(), 1);
        assert_eq!(sheet.vitals[0].vital_type, VitalType::Health);
        assert_eq!(sheet.vitals[0].base, 150);
        assert_eq!(sheet.vitals[0].effective, 175);
        assert_eq!(sheet.vitals[0].current, 160);

        assert_eq!(sheet.skills.len(), 1);
        assert_eq!(sheet.skills[0].skill_type, SkillType::MeleeDefense);
        assert_eq!(sheet.skills[0].base, 35);
        assert_eq!(sheet.skills[0].effective, 42);
        assert_eq!(sheet.skills[0].training, TrainingLevel::Trained);
    }

    #[test]
    fn combat_info_projection_exposes_current_mode_target_controls_and_timestamp() {
        let player_guid = Guid(0x5000_0002);
        let target_guid = Guid(0x8000_0002);

        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.combat_mode = CombatMode::Melee;
        data.combat_controls.attack_height = AttackHeight::High;
        data.combat_runtime
            .begin_explicit_engagement(target_guid, CombatMode::Melee);

        let now = Instant::now();
        data.combat_runtime
            .note_attack_attempt(now - Duration::from_secs(2));

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: Some((900.0, now)),
            script_name: None,
        };

        let combat_info = script_view.combat_info();

        assert_eq!(combat_info.combat_mode, CombatMode::Melee);
        assert!(combat_info.is_engaged);
        assert_eq!(combat_info.target, Some(target_guid));
        assert_eq!(combat_info.power, 0.5);
        assert_eq!(combat_info.height, AttackHeight::High);
        assert!((combat_info.last_attack_time.expect("timestamp") - 898.0).abs() < 1e-6);
    }

    #[test]
    fn current_interaction_projection_maps_targeting_to_target_entity() {
        let target_guid = Guid(0x8000_0003);
        let data = GameData::new(Guid(0x5000_0003), "Player".to_string(), "World".to_string());
        let view = ViewState {
            active_interaction: Some(Interaction::Targeting { target_guid }),
            ..ViewState::default()
        };

        let script_view = TuiScriptClientView {
            data: &data,
            view: &view,
            server_time: None,
            script_name: None,
        };

        assert_eq!(
            script_view.current_interaction(),
            Some(ScriptClientInteraction::TargetEntity { guid: target_guid })
        );
    }

    #[test]
    fn enchantments_projection_deduplicates_spell_ids_by_latest_end_time() {
        let mut data = GameData::new(Guid(0x5000_0004), "Player".to_string(), "World".to_string());
        data.player_enchantments = vec![
            Enchantment {
                spell_id: 10,
                layer: 1,
                power_level: 100,
                start_time: 100.0,
                duration: 20.0,
                ..Default::default()
            },
            Enchantment {
                spell_id: 10,
                layer: 2,
                power_level: 200,
                start_time: 120.0,
                duration: 15.0,
                ..Default::default()
            },
            Enchantment {
                spell_id: 42,
                layer: 1,
                power_level: 50,
                start_time: 300.0,
                duration: -1.0,
                ..Default::default()
            },
        ];

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        assert_eq!(
            script_view.enchantments(),
            vec![
                ScriptEnchantmentView {
                    spell_id: 10,
                    end_time: 135.0,
                },
                ScriptEnchantmentView {
                    spell_id: 42,
                    end_time: f64::INFINITY,
                },
            ]
        );
    }

    #[test]
    fn distance_and_heading_projection_accept_guid_or_position_inputs() {
        let data = GameData::new(Guid(0x5000_0003), "Player".to_string(), "World".to_string());

        let from_position = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let target_position = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(0.0, 10.0, 0.0),
            rotation: Quaternion::identity(),
        };

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        let distance = script_view.distance(from_position.into(), target_position.into());
        let heading = script_view.heading_to(from_position.into(), target_position.into());

        assert!((distance - 10.0).abs() < 1e-4, "distance was {distance}");
        assert!(
            (heading - 90.0_f32.to_radians()).abs() < 1e-4,
            "heading was {heading}"
        );
    }

    #[test]
    fn equipment_projection_exposes_slot_masks_and_guid() {
        let player_guid = Guid(0x5000_0004);
        let equipment_guid = Guid(0x8000_0004);

        let data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        let mut data = data;
        data.equipment.insert(
            equipment_guid,
            EquipMask::CHEST_WEAR | EquipMask::UPPER_ARM_WEAR,
        );

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        let equipment = script_view.equipment();

        assert_eq!(equipment.len(), ScriptEquipmentSlotKind::ALL.len());

        let chest_wear = equipment
            .iter()
            .find(|slot| slot.slot == ScriptEquipmentSlotKind::ChestWear)
            .expect("chest wear slot should exist");
        assert_eq!(chest_wear.equip_mask, EquipMask::CHEST_WEAR);
        assert_eq!(chest_wear.item_guid, Some(equipment_guid));

        let upper_arm_wear = equipment
            .iter()
            .find(|slot| slot.slot == ScriptEquipmentSlotKind::UpperArmWear)
            .expect("upper arm wear slot should exist");
        assert_eq!(upper_arm_wear.equip_mask, EquipMask::UPPER_ARM_WEAR);
        assert_eq!(upper_arm_wear.item_guid, Some(equipment_guid));

        let head_wear = equipment
            .iter()
            .find(|slot| slot.slot == ScriptEquipmentSlotKind::HeadWear)
            .expect("head wear slot should exist");
        assert_eq!(head_wear.equip_mask, EquipMask::HEAD_WEAR);
        assert_eq!(head_wear.item_guid, None);
    }

    #[test]
    fn current_trade_info_projection_exposes_partner_and_items() {
        let player_guid = Guid(0x5000_0006);
        let partner_guid = Guid(0x8000_0006);
        let our_item = Guid(0x9000_0006);
        let their_item = Guid(0x9000_0007);

        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.entities.insert(
            partner_guid,
            Entity::new(partner_guid, "Buddy".to_string(), WorldPosition::default()),
        );
        data.trade = Some(TradeState {
            partner_guid,
            initiator_guid: partner_guid,
            trade_stamp: 123.0,
            self_side: TradeSide {
                guid: player_guid,
                accepted: false,
                items: vec![our_item],
            },
            partner_side: TradeSide {
                guid: partner_guid,
                accepted: false,
                items: vec![their_item],
            },
        });

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        let trade_info = script_view
            .current_trade_info()
            .expect("trade info should be projected");

        assert_eq!(trade_info.partner_guid, partner_guid);
        assert_eq!(trade_info.partner_name.as_deref(), Some("Buddy"));
        assert_eq!(trade_info.our_items, vec![our_item]);
        assert_eq!(trade_info.their_items, vec![their_item]);
    }

    #[test]
    fn spellbook_projection_returns_player_spell_ids() {
        let mut data = GameData::new(Guid(0x5000_0007), "Player".to_string(), "World".to_string());
        data.player_spells = vec![3, 1, 2];

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        assert_eq!(script_view.spellbook(), vec![3, 1, 2]);
    }

    #[test]
    fn spellbook_membership_projection_checks_membership() {
        let mut data = GameData::new(Guid(0x5000_0009), "Player".to_string(), "World".to_string());
        data.player_spells = vec![10, 20, 30];

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        assert!(script_view.in_spellbook(20));
        assert!(!script_view.in_spellbook(99));
    }

    #[test]
    fn heading_to_projection_uses_world_position_math() {
        let from_guid = Guid(0x5000_0008);
        let target_guid = Guid(0x8000_0008);
        let mut data = GameData::new(from_guid, "Player".to_string(), "World".to_string());

        let from_position = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: holtburger_common::Vector3::new(0.0, 0.0, 0.0),
            rotation: holtburger_common::Quaternion::identity(),
        };
        let to_position = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: holtburger_common::Vector3::new(0.0, 10.0, 0.0),
            rotation: holtburger_common::Quaternion::identity(),
        };

        data.entities.insert(
            from_guid,
            Entity::new(from_guid, "Player".to_string(), from_position),
        );
        data.entities.insert(
            target_guid,
            Entity::new(target_guid, "Target".to_string(), to_position),
        );
        data.player_pos = Some(from_position);

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        let distance = script_view.distance(from_guid.into(), to_position.into());
        let heading = script_view.heading_to(from_guid.into(), target_guid.into());

        assert!((distance - 10.0).abs() < 1e-4, "distance was {distance}");
        assert!(
            (heading - 90.0_f32.to_radians()).abs() < 1e-4,
            "heading was {heading}"
        );
    }

    #[test]
    fn entity_exists_projection_checks_known_entities() {
        let player_guid = Guid(0x5000_0010);
        let entity_guid = Guid(0x5000_0011);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.entities.insert(
            entity_guid,
            Entity::new(entity_guid, "Goblin".to_string(), WorldPosition::default()),
        );

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        assert!(script_view.entity_exists(entity_guid));
        assert!(!script_view.entity_exists(Guid(0xDEAD_BEEF)));
    }

    #[test]
    fn inventory_projection_groups_items_by_container() {
        let player_guid = Guid(0x5000_0012);
        let pack_guid = Guid(0x8000_0012);
        let root_item_guid = Guid(0x8000_0013);
        let pack_item_guid = Guid(0x8000_0014);

        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());

        let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
        player.set_int_prop(PropertyInt::ItemsCapacity, 12);
        data.entities.insert(player_guid, player);

        let mut pack = Entity::new(pack_guid, "Pack".to_string(), WorldPosition::default());
        pack.set_int_prop(PropertyInt::ItemsCapacity, 6);
        pack.set_container_id(Some(player_guid));
        data.entities.insert(pack_guid, pack);

        let mut root_item = Entity::new(
            root_item_guid,
            "Torch".to_string(),
            WorldPosition::default(),
        );
        root_item.set_container_id(Some(player_guid));
        data.entities.insert(root_item_guid, root_item);

        let mut pack_item =
            Entity::new(pack_item_guid, "Gem".to_string(), WorldPosition::default());
        pack_item.set_container_id(Some(pack_guid));
        data.entities.insert(pack_item_guid, pack_item);

        data.inventory =
            std::collections::HashSet::from([pack_guid, root_item_guid, pack_item_guid]);

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        let inventory = script_view.inventory();
        assert_eq!(inventory.len(), 2);

        let player_container = inventory
            .iter()
            .find(|container| container.container_guid == player_guid)
            .expect("player container should exist");
        assert_eq!(player_container.slots, 12);
        assert_eq!(player_container.items, vec![pack_guid, root_item_guid]);

        let pack_container = inventory
            .iter()
            .find(|container| container.container_guid == pack_guid)
            .expect("pack container should exist");
        assert_eq!(pack_container.slots, 6);
        assert_eq!(pack_container.items, vec![pack_item_guid]);
    }
    #[test]
    fn script_event_from_view_event_projects_weenie_errors() {
        let action_result_event = ClientViewEvent::ActionResult {
            source: holtburger_core::client::types::ActionResultSource::Wire,
            reason: ActionResultReason::Weenie(
                holtburger_protocol::errors::WeenieError::YoureTooBusy,
                Some("ignored".to_string()),
            ),
        };

        assert!(matches!(
            script_event_from_view_event(&action_result_event),
            Some(ScriptEvent::WeenieError {
                error: holtburger_protocol::errors::WeenieError::YoureTooBusy,
            })
        ));

        let combat_feedback_event = ClientViewEvent::CombatFeedback(CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::YouAreTooTiredToDoThat,
        });

        assert!(matches!(
            script_event_from_view_event(&combat_feedback_event),
            Some(ScriptEvent::CombatFeedback(ScriptCombatFeedback::AttackDone {
                error,
            })) if error == holtburger_protocol::errors::WeenieError::YouAreTooTiredToDoThat
        ));

        let victim_notification =
            ClientViewEvent::CombatFeedback(CombatFeedback::VictimNotification {
                death_message: "Olthoi Noble is shattered by your assault!".to_string(),
            });

        assert!(matches!(
            script_event_from_view_event(&victim_notification),
            Some(ScriptEvent::CombatFeedback(ScriptCombatFeedback::VictimNotification {
                death_message,
            })) if death_message == "Olthoi Noble is shattered by your assault!"
        ));

        let killer_notification =
            ClientViewEvent::CombatFeedback(CombatFeedback::KillerNotification {
                death_message: "Olthoi Noble is shattered by your assault!".to_string(),
            });

        assert!(matches!(
            script_event_from_view_event(&killer_notification),
            Some(ScriptEvent::CombatFeedback(ScriptCombatFeedback::KillerNotification {
                death_message,
            })) if death_message == "Olthoi Noble is shattered by your assault!"
        ));

        let player_killed = ClientViewEvent::CombatFeedback(CombatFeedback::PlayerKilled {
            death_message: "A nearby player has fallen.".to_string(),
            victim_id: Guid(0x1234_5678),
            killer_id: Guid(0x90AB_CDEF),
        });

        assert!(matches!(
            script_event_from_view_event(&player_killed),
            Some(ScriptEvent::PlayerKilled {
                death_message,
                victim_id: Guid(0x1234_5678),
                killer_id: Guid(0x90AB_CDEF),
            }) if death_message == "A nearby player has fallen."
        ));

        let teleport_started = ClientViewEvent::TeleportStarted { sequence: 42 };

        assert!(matches!(
            script_event_from_view_event(&teleport_started),
            Some(ScriptEvent::TeleportStarted { sequence: 42 })
        ));
    }

    #[test]
    fn script_event_from_notification_projects_inventory_changes() {
        let notification = AppNotification::InventoryChanged {
            removed: vec![Guid(0x5000_0001), Guid(0x5000_0003)],
            added: vec![Guid(0x5000_0004)],
        };

        assert!(matches!(
            script_event_from_notification(&notification),
            Some(ScriptEvent::InventoryChanged {
                added,
                removed,
            }) if added == vec![Guid(0x5000_0004)] && removed == vec![Guid(0x5000_0001), Guid(0x5000_0003)]
        ));
    }

    #[test]
    fn nearby_entities_filters_by_distance_and_classification() {
        let player_guid = Guid(0x5000_0005);
        let monster_guid = Guid(0x8000_0005);
        let npc_guid = Guid(0x8000_0006);
        let far_monster_guid = Guid(0x8000_0007);
        let player_position = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };

        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(player_position);

        let mut monster = Entity::new(
            monster_guid,
            "Monster".to_string(),
            WorldPosition {
                landblock_id: player_position.landblock_id,
                coords: Vector3::new(3.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        monster.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        monster.set_bool_prop(PropertyBool::Attackable, true);
        monster.flags |= ObjectDescriptionFlag::ATTACKABLE;
        data.entities.insert(monster_guid, monster);

        let mut npc = Entity::new(
            npc_guid,
            "NPC".to_string(),
            WorldPosition {
                landblock_id: player_position.landblock_id,
                coords: Vector3::new(4.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        npc.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        data.entities.insert(npc_guid, npc);

        let mut far_monster = Entity::new(
            far_monster_guid,
            "Far Monster".to_string(),
            WorldPosition {
                landblock_id: player_position.landblock_id,
                coords: Vector3::new(20.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        far_monster.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        far_monster.set_bool_prop(PropertyBool::Attackable, true);
        far_monster.flags |= ObjectDescriptionFlag::ATTACKABLE;
        data.entities.insert(far_monster_guid, far_monster);

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        let nearby_monsters =
            script_view.nearby_entities(Some(10.0), Some(vec![ScriptEntityKind::Monster]));
        assert_eq!(nearby_monsters.len(), 1);
        assert_eq!(nearby_monsters[0].guid, monster_guid);
        assert_eq!(nearby_monsters[0].kind, ScriptEntityKind::Monster);

        let nearby_npcs = script_view.nearby_entities(None, Some(vec![ScriptEntityKind::Npc]));
        assert_eq!(nearby_npcs.len(), 1);
        assert_eq!(nearby_npcs[0].guid, npc_guid);
        assert_eq!(nearby_npcs[0].kind, ScriptEntityKind::Npc);
    }

    #[test]
    fn entity_projects_motion_command_without_derived_dead_flag() {
        let player_guid = Guid(0x5000_0002);
        let entity_guid = Guid(0x8000_0002);
        let player_position = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(10.0, 20.0, 30.0),
            rotation: Quaternion::identity(),
        };

        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(player_position);

        let mut entity = Entity::new(entity_guid, "Drudge".to_string(), player_position);
        entity.motion_snapshot = Some(EntityMotionSnapshot {
            forward_command: Some(InterpretedMotionCommand::DEAD),
            ..Default::default()
        });
        data.entities.insert(entity_guid, entity);

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        let entity_view = script_view
            .entity(entity_guid)
            .expect("entity snapshot should be available");

        assert_eq!(entity_view.motion_command, ScriptMotionCommand::Dead);
        assert_eq!(entity_view.position, player_position.into());
        assert_eq!(entity_view.distance_to_self, 0.0);
    }

    #[test]
    fn entity_projects_primitive_properties_and_profile() {
        let player_guid = Guid(0x5000_0003);
        let entity_guid = Guid(0x8000_0003);
        let player_position = WorldPosition {
            landblock_id: Guid(0x0100_0000),
            coords: Vector3::new(10.0, 20.0, 30.0),
            rotation: Quaternion::identity(),
        };

        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(player_position);

        let mut entity = Entity::new(entity_guid, "Olthoi".to_string(), player_position);
        entity.set_int_prop(PropertyInt::Damage, 42);
        entity.set_bool_prop(PropertyBool::Attackable, true);
        entity.set_int64_prop(PropertyInt64::AvailableExperience, 12_345);
        entity.set_float_prop(PropertyFloat::DefaultScale, 1.25);
        entity.set_string_prop(PropertyString::LongDesc, "A sturdy olthoi".to_string());
        entity.set_did_prop(PropertyDataId::MotionTable, Guid(0x1234_5678));
        entity.set_container_id(Some(player_guid));
        entity.set_wielder_id(Some(player_guid));
        entity.armor_profile = Some(ArmorProfile {
            slashing: 1.0,
            piercing: 2.0,
            bludgeoning: 3.0,
            cold: 4.0,
            fire: 5.0,
            acid: 6.0,
            nether: 7.0,
            lightning: 8.0,
        });
        data.entities.insert(entity_guid, entity);

        let script_view = TuiScriptClientView {
            data: &data,
            view: &ViewState::default(),
            server_time: None,
            script_name: None,
        };

        assert_eq!(
            script_view.entity_int_prop(entity_guid, PropertyInt::Damage),
            Some(42)
        );
        assert_eq!(
            script_view.entity_bool_prop(entity_guid, PropertyBool::Attackable),
            Some(true)
        );
        assert!(matches!(
            script_view.entity_int64_prop(entity_guid, PropertyInt64::AvailableExperience),
            Some(12_345)
        ));
        assert_eq!(
            script_view.entity_float_prop(entity_guid, PropertyFloat::DefaultScale),
            Some(1.25)
        );
        assert_eq!(
            script_view
                .entity_string_prop(entity_guid, PropertyString::LongDesc)
                .as_deref(),
            Some("A sturdy olthoi")
        );
        assert_eq!(
            script_view.entity_data_prop(entity_guid, PropertyDataId::MotionTable),
            Some(Guid(0x1234_5678))
        );
        assert_eq!(
            script_view.entity_instance_prop(entity_guid, PropertyInstanceId::Container),
            Some(player_guid)
        );
        let entity_view = script_view
            .entity(entity_guid)
            .expect("entity view should exist");
        assert_eq!(entity_view.container, player_guid);
        assert_eq!(entity_view.wielder, player_guid);
        assert!(matches!(
            entity_view.profile,
            Some(ScriptEntityProfile::Armor(ArmorProfile {
                slashing: 1.0,
                piercing: 2.0,
                bludgeoning: 3.0,
                cold: 4.0,
                fire: 5.0,
                acid: 6.0,
                nether: 7.0,
                lightning: 8.0,
            }))
        ));
    }
}
