pub mod entity;
pub mod physics_types;
pub mod position;
pub mod properties;
pub mod spatial;
pub mod stats;

use self::entity::{Entity, EntityManager};
use self::position::WorldPosition;
use self::properties::{ObjectDescriptionFlag, PropertyValue};
use self::spatial::SpatialScene;
use crate::dat::DatDatabase;
use crate::math::{Quaternion, Vector3};
use crate::protocol::properties::PropertyInstanceId;
use std::sync::Arc;

use crate::protocol::messages::{Enchantment, GameMessage};

#[derive(Debug, Clone)]
pub enum WorldEvent {
    EntitySpawned(Box<Entity>),
    EntityMoved {
        guid: u32,
        pos: WorldPosition,
    },
    EntityDespawned(u32),
    VitalUpdated(stats::Vital),
    AttributeUpdated(stats::Attribute),
    SkillUpdated(stats::Skill),
    PropertyUpdated {
        guid: u32,
        property_id: u32,
        value: PropertyValue,
    },
    PlayerInfo {
        guid: u32,
        name: String,
        pos: Option<WorldPosition>,
        attributes: Vec<stats::Attribute>,
        vitals: Vec<stats::Vital>,
        skills: Vec<stats::Skill>,
        enchantments: Vec<Enchantment>,
    },
    EnchantmentUpdated(Enchantment),
    EnchantmentRemoved {
        spell_id: u16,
        layer: u16,
    },
    ServerTimeUpdate(f64),
    EnchantmentsPurged,
    DerivedStatsUpdated {
        attributes: Vec<stats::Attribute>,
        vitals: Vec<stats::Vital>,
        skills: Vec<stats::Skill>,
    },
}

pub struct WorldState {
    pub entities: EntityManager,
    pub player_guid: u32,
    pub player_attributes: std::collections::HashMap<stats::AttributeType, u32>,
    pub player_vitals: std::collections::HashMap<stats::VitalType, stats::Vital>,
    pub player_skills: std::collections::HashMap<stats::SkillType, stats::Skill>,
    pub player_enchantments: Vec<Enchantment>,
    pub server_time: Option<(f64, std::time::Instant)>,
    pub dat: Option<Arc<DatDatabase>>,

    pub scene: SpatialScene,
}

impl WorldState {
    pub fn new(dat: Option<Arc<DatDatabase>>) -> Self {
        Self {
            entities: EntityManager::new(),
            player_guid: 0,
            player_attributes: std::collections::HashMap::new(),
            player_vitals: std::collections::HashMap::new(),
            player_skills: std::collections::HashMap::new(),
            player_enchantments: Vec::new(),
            server_time: None,
            dat,
            scene: SpatialScene::new(),
        }
    }

    pub fn get_effective_attribute(&self, attr: stats::AttributeType) -> u32 {
        use crate::world::properties::EnchantmentTypeFlags;

        let base = self.player_attributes.get(&attr).cloned().unwrap_or(0);
        let mut multiplier = 1.0f32;
        let mut additive = 0f32;

        // Multiplicative
        let mults = self.get_top_layer_enchantments(
            EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::MULTIPLICATIVE,
            attr as u32,
        );
        for e in mults {
            multiplier *= e.stat_mod_value;
        }

        // Additive
        let adds = self.get_top_layer_enchantments(
            EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE,
            attr as u32,
        );
        for e in adds {
            additive += e.stat_mod_value;
        }

        ((base as f32 * multiplier) + additive).max(0.0).round() as u32
    }

    pub fn get_effective_vital_max(&self, vital_type: stats::VitalType) -> u32 {
        use crate::world::properties::EnchantmentTypeFlags;

        let base_max = self
            .player_vitals
            .get(&vital_type)
            .map(|v| v.base)
            .unwrap_or(0);
        let mut multiplier = 1.0f32;
        let mut additive = 0f32;

        // Multiplicative
        let mults = self.get_top_layer_enchantments(
            EnchantmentTypeFlags::SECOND_ATT | EnchantmentTypeFlags::MULTIPLICATIVE,
            vital_type as u32,
        );
        for e in mults {
            multiplier *= e.stat_mod_value;
        }

        // Additive
        let adds = self.get_top_layer_enchantments(
            EnchantmentTypeFlags::SECOND_ATT | EnchantmentTypeFlags::ADDITIVE,
            vital_type as u32,
        );
        for e in adds {
            additive += e.stat_mod_value;
        }

        // Also, vital maxes are derived from attributes.
        // If an attribute is buffed, the "Base" max of the vital increases.
        // Health = (Endurance / 2) + HealthBonus
        // Stamina = Endurance + StaminaBonus
        // Mana = Self + ManaBonus

        // To calculate this precisely, we'd need to know the 'bonus' part (HealthStep etc)
        // because we only have 'base_max' which is (BaseEnd / 2) + HealthStep.
        // EffectiveMax = (EffectiveEnd / 2) + HealthStep
        //              = base_max + (EffectiveEnd - BaseEnd) / 2

        let end_base = self
            .player_attributes
            .get(&stats::AttributeType::EnduranceAttr)
            .cloned()
            .unwrap_or(0);
        let end_eff = self.get_effective_attribute(stats::AttributeType::EnduranceAttr);

        let self_base = self
            .player_attributes
            .get(&stats::AttributeType::SelfAttr)
            .cloned()
            .unwrap_or(0);
        let self_eff = self.get_effective_attribute(stats::AttributeType::SelfAttr);

        let derived_bonus = match vital_type {
            stats::VitalType::Health => {
                (end_eff as f32 / 2.0).round() as i32 - (end_base as f32 / 2.0).round() as i32
            }
            stats::VitalType::Stamina => end_eff as i32 - end_base as i32,
            stats::VitalType::Mana => self_eff as i32 - self_base as i32,
        };

        let current_base_max = (base_max as i32 + derived_bonus).max(0) as u32;

        ((current_base_max as f32 * multiplier) + additive)
            .max(0.0)
            .round() as u32
    }

    pub fn get_effective_skill(&self, skill_type: stats::SkillType) -> u32 {
        use crate::world::properties::EnchantmentTypeFlags;

        let skill = match self.player_skills.get(&skill_type) {
            Some(s) => s,
            None => return 0,
        };

        let mut multiplier = 1.0f32;
        let mut additive = 0f32;

        // Multiplicative
        let mults = self.get_top_layer_enchantments(
            EnchantmentTypeFlags::SKILL | EnchantmentTypeFlags::MULTIPLICATIVE,
            skill_type as u32,
        );
        for e in mults {
            multiplier *= e.stat_mod_value;
        }

        // Additive
        let adds = self.get_top_layer_enchantments(
            EnchantmentTypeFlags::SKILL | EnchantmentTypeFlags::ADDITIVE,
            skill_type as u32,
        );
        for e in adds {
            additive += e.stat_mod_value;
        }

        // Skill Maxes are derived from attributes.
        // BaseMax = (Attr1 + Attr2) / Divisor + InvestedRanks.
        // If an attribute is buffed, the base part of the skill increases.
        let (a1, a2, div) = match skill_type {
            stats::SkillType::WarMagic
            | stats::SkillType::LifeMagic
            | stats::SkillType::CreatureEnchantment
            | stats::SkillType::ItemEnchantment
            | stats::SkillType::VoidMagic => (
                Some(stats::AttributeType::FocusAttr),
                Some(stats::AttributeType::SelfAttr),
                4,
            ),
            stats::SkillType::MeleeDefense => (
                Some(stats::AttributeType::QuicknessAttr),
                Some(stats::AttributeType::CoordinationAttr),
                3,
            ),
            stats::SkillType::MissileDefense => (
                Some(stats::AttributeType::QuicknessAttr),
                Some(stats::AttributeType::CoordinationAttr),
                5,
            ),
            stats::SkillType::MagicDefense => (
                Some(stats::AttributeType::FocusAttr),
                Some(stats::AttributeType::SelfAttr),
                7,
            ),
            stats::SkillType::ManaConversion => (
                Some(stats::AttributeType::FocusAttr),
                Some(stats::AttributeType::SelfAttr),
                6,
            ),
            stats::SkillType::ArcaneLore => (
                Some(stats::AttributeType::FocusAttr),
                Some(stats::AttributeType::SelfAttr),
                3,
            ),
            stats::SkillType::HeavyWeapons
            | stats::SkillType::LightWeapons
            | stats::SkillType::FinesseWeapons
            | stats::SkillType::TwoHandedCombat => (
                Some(stats::AttributeType::StrengthAttr),
                Some(stats::AttributeType::CoordinationAttr),
                3,
            ),
            stats::SkillType::MissileWeapons => (
                Some(stats::AttributeType::QuicknessAttr),
                Some(stats::AttributeType::CoordinationAttr),
                3,
            ),
            stats::SkillType::Healing => (
                Some(stats::AttributeType::FocusAttr),
                Some(stats::AttributeType::CoordinationAttr),
                3,
            ),
            stats::SkillType::Jump => (
                Some(stats::AttributeType::StrengthAttr),
                Some(stats::AttributeType::QuicknessAttr),
                2,
            ),
            stats::SkillType::Run => (Some(stats::AttributeType::QuicknessAttr), None, 1),
            _ => (None, None, 1),
        };

        let calculate_derived = |at1: Option<stats::AttributeType>,
                                 at2: Option<stats::AttributeType>,
                                 div: u32,
                                 eff: bool|
         -> i32 {
            let v1 = at1
                .map(|at| {
                    if eff {
                        self.get_effective_attribute(at)
                    } else {
                        self.player_attributes.get(&at).cloned().unwrap_or(0)
                    }
                })
                .unwrap_or(0);
            let v2 = at2
                .map(|at| {
                    if eff {
                        self.get_effective_attribute(at)
                    } else {
                        self.player_attributes.get(&at).cloned().unwrap_or(0)
                    }
                })
                .unwrap_or(0);
            ((v1 + v2) as f32 / div as f32).round() as i32
        };

        let base_derived = calculate_derived(a1, a2, div, false);
        let eff_derived = calculate_derived(a1, a2, div, true);
        let derived_bonus = eff_derived - base_derived;

        let current_base = (skill.base as i32 + derived_bonus).max(0) as u32;

        ((current_base as f32 * multiplier) + additive)
            .max(0.0)
            .round() as u32
    }

    fn get_top_layer_enchantments(
        &self,
        stat_mod_type_mask: crate::world::properties::EnchantmentTypeFlags,
        stat_mod_key: u32,
    ) -> Vec<&Enchantment> {
        let mut best: std::collections::HashMap<u16, &Enchantment> =
            std::collections::HashMap::new();

        for e in &self.player_enchantments {
            if (e.stat_mod_type & stat_mod_type_mask.bits()) == stat_mod_type_mask.bits()
                && e.stat_mod_key == stat_mod_key
            {
                let entry = best.entry(e.spell_category).or_insert(e);
                if e.power_level > entry.power_level {
                    *entry = e;
                }
            }
        }
        best.into_values().collect()
    }

    pub fn current_server_time(&self) -> f64 {
        match self.server_time {
            Some((server_val, local_then)) => {
                let elapsed = local_then.elapsed().as_secs_f64();
                server_val + elapsed
            }
            None => {
                // Fallback to wall clock if no sync yet
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs_f64()
            }
        }
    }

    pub fn get_all_effective_stats(
        &self,
    ) -> (Vec<stats::Attribute>, Vec<stats::Vital>, Vec<stats::Skill>) {
        let mut attributes = Vec::new();
        for i in 1..=6 {
            if let Some(attr_type) = stats::AttributeType::from_repr(i) {
                attributes.push(stats::Attribute {
                    attr_type,
                    base: self.get_effective_attribute(attr_type),
                });
            }
        }

        let mut vitals = Vec::new();
        for vt in [
            stats::VitalType::Health,
            stats::VitalType::Stamina,
            stats::VitalType::Mana,
        ] {
            if let Some(v) = self.player_vitals.get(&vt) {
                vitals.push(stats::Vital {
                    vital_type: vt,
                    base: self.get_effective_vital_max(vt),
                    current: v.current,
                });
            }
        }

        let mut skills = Vec::new();
        let mut skill_types: Vec<_> = self.player_skills.keys().cloned().collect();
        skill_types.sort_by_key(|s| *s as u32);
        for st in skill_types {
            if let Some(s) = self.player_skills.get(&st) {
                let effective = self.get_effective_skill(st);
                skills.push(stats::Skill {
                    skill_type: st,
                    base: s.base, // Keep invested ranks + base attributes as "base"
                    current: effective,
                    training: s.training,
                });
            }
        }

        (attributes, vitals, skills)
    }

    /// Primary entry point for messages reassembled by the Session.
    /// Returns a list of side-effects/events for the UI to consume.
    pub fn handle_message(&mut self, msg: GameMessage) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let mut stats_changed = false;

        match msg {
            GameMessage::ObjectCreate {
                guid,
                name,
                wcid,
                pos,
                parent_id,
                container_id,
                wielder_id,
                flags,
                item_type,
                ..
            } => {
                let entity_name = name.unwrap_or_else(|| "Unknown".to_string());

                let mut entity = Entity::new(
                    guid,
                    entity_name,
                    pos.unwrap_or(WorldPosition {
                        landblock_id: 0,
                        coords: Vector3::zero(),
                        rotation: Quaternion::identity(),
                    }),
                );
                entity.wcid = wcid;
                entity.flags = flags;
                entity.item_type = Some(item_type);
                entity.physics_parent_id = parent_id;
                entity.container_id = container_id;
                entity.wielder_id = wielder_id;

                self.add_entity(entity.clone());
                events.push(WorldEvent::EntitySpawned(Box::new(entity)));
            }
            GameMessage::ObjectDelete { guid } => {
                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(WorldEvent::EntityDespawned(guid));
                }
            }
            GameMessage::ParentEvent {
                child_guid,
                parent_guid,
            } => {
                if let Some(entity) = self.entities.get_mut(child_guid) {
                    entity.physics_parent_id = Some(parent_guid);
                }

                if let Some(_entity) = self.remove_entity(child_guid) {
                    events.push(WorldEvent::EntityDespawned(child_guid));
                }
            }
            GameMessage::PickupEvent { guid } => {
                if let Some(_entity) = self.remove_entity(guid) {
                    events.push(WorldEvent::EntityDespawned(guid));
                }
            }
            GameMessage::UpdatePosition { guid, pos } => {
                if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = pos;
                    self.scene.update_entity(guid, old_lb, pos.landblock_id);
                    events.push(WorldEvent::EntityMoved { guid, pos });
                }
            }
            GameMessage::PlayerDescription {
                guid,
                name,
                wee_type: _,
                pos,
                attributes,
                skills,
                enchantments,
            } => {
                self.player_guid = guid;
                self.player_enchantments = enchantments;
                stats_changed = true;

                // Ensure player entity exists
                let mut player_entity = if let Some(entity) = self.entities.get(guid) {
                    entity.clone()
                } else {
                    let mut entity = Entity::new(
                        guid,
                        name.clone(),
                        pos.unwrap_or(WorldPosition {
                            landblock_id: 0,
                            coords: Vector3::zero(),
                            rotation: Quaternion::identity(),
                        }),
                    );
                    entity.flags = ObjectDescriptionFlag::PLAYER;
                    entity
                };

                if name != "Unknown" {
                    player_entity.name = name.clone();
                }

                if let Some(p) = pos {
                    player_entity.position = p;
                }
                self.add_entity(player_entity);

                let mut attr_objs = Vec::new();
                let mut vital_objs = Vec::new();

                // Sort attributes first so we have them for vitals
                let mut sorted_attrs = attributes;
                sorted_attrs.sort_by_key(|a| a.0);

                for (at_type, ranks, start, _xp, current) in sorted_attrs {
                    // IDs 1-6 are Attributes, 101-103 are Vitals (mapping to 2, 4, 6 in VitalType)
                    if at_type <= 6 {
                        if let Some(attr_type) = stats::AttributeType::from_repr(at_type) {
                            let base = ranks + start;
                            self.player_attributes.insert(attr_type, base);
                            attr_objs.push(stats::Attribute { attr_type, base });
                        }
                    } else if (101..=103).contains(&at_type) {
                        let vital_type = match at_type {
                            101 => stats::VitalType::Health,
                            102 => stats::VitalType::Stamina,
                            103 => stats::VitalType::Mana,
                            _ => continue,
                        };

                        let bonus = match vital_type {
                            stats::VitalType::Health => {
                                self.player_attributes
                                    .get(&stats::AttributeType::EnduranceAttr)
                                    .cloned()
                                    .unwrap_or(0)
                                    / 2
                            }
                            stats::VitalType::Stamina => self
                                .player_attributes
                                .get(&stats::AttributeType::EnduranceAttr)
                                .cloned()
                                .unwrap_or(0),
                            stats::VitalType::Mana => self
                                .player_attributes
                                .get(&stats::AttributeType::SelfAttr)
                                .cloned()
                                .unwrap_or(0),
                        };

                        let base = ranks + start + bonus;
                        let final_base = if base == 0 { current } else { base };

                        let vital = stats::Vital {
                            vital_type,
                            base: final_base,
                            current,
                        };
                        self.player_vitals.insert(vital_type, vital.clone());
                        vital_objs.push(vital);
                    }
                }

                let mut skill_objs = Vec::new();
                for (sk_id, ranks, status, _xp, init) in skills {
                    if let Some(skill_type) = stats::SkillType::from_repr(sk_id) {
                        let training = match status {
                            1 => stats::TrainingLevel::Untrained,
                            2 => stats::TrainingLevel::Trained,
                            3 => stats::TrainingLevel::Specialized,
                            _ => stats::TrainingLevel::Unusable,
                        };
                        let skill = stats::Skill {
                            skill_type,
                            base: init + ranks,
                            current: init + ranks, // Base current same as base initially
                            training,
                        };
                        self.player_skills.insert(skill_type, skill.clone());
                        skill_objs.push(skill);
                    }
                }

                events.push(WorldEvent::PlayerInfo {
                    guid,
                    name,
                    pos,
                    attributes: attr_objs,
                    vitals: vital_objs,
                    skills: skill_objs,
                    enchantments: self.player_enchantments.clone(),
                });
            }
            GameMessage::UpdateAttribute {
                attribute,
                ranks,
                start,
                xp: _,
            } => {
                let attr_type = match stats::AttributeType::from_repr(attribute) {
                    Some(a) => a,
                    None => return events,
                };
                let base = start + ranks;
                self.player_attributes.insert(attr_type, base);
                stats_changed = true;

                events.push(WorldEvent::AttributeUpdated(stats::Attribute {
                    attr_type,
                    base,
                }));
            }
            GameMessage::UpdateSkill {
                skill,
                ranks,
                status,
                xp: _,
                init,
            } => {
                let skill_type = match stats::SkillType::from_repr(skill) {
                    Some(s) => s,
                    None => return events,
                };
                let training = match status {
                    1 => stats::TrainingLevel::Untrained,
                    2 => stats::TrainingLevel::Trained,
                    3 => stats::TrainingLevel::Specialized,
                    _ => stats::TrainingLevel::Unusable,
                };
                let skill_obj = stats::Skill {
                    skill_type,
                    base: init + ranks,
                    current: init + ranks,
                    training,
                };
                self.player_skills.insert(skill_type, skill_obj.clone());
                stats_changed = true;

                events.push(WorldEvent::SkillUpdated(skill_obj));
            }
            GameMessage::UpdateVital {
                vital,
                ranks,
                start,
                xp: _,
                current,
            } => {
                log::debug!(
                    "UpdateVital: vital={}, ranks={}, start={}, current={}",
                    vital,
                    ranks,
                    start,
                    current
                );
                let vital_type = match stats::VitalType::from_repr(vital) {
                    Some(v) => v,
                    None => {
                        log::warn!("Unknown vital ID: {}", vital);
                        return events;
                    }
                };

                let bonus = match vital_type {
                    stats::VitalType::Health => {
                        self.player_attributes
                            .get(&stats::AttributeType::EnduranceAttr)
                            .cloned()
                            .unwrap_or(0)
                            / 2
                    }
                    stats::VitalType::Stamina => self
                        .player_attributes
                        .get(&stats::AttributeType::EnduranceAttr)
                        .cloned()
                        .unwrap_or(0),
                    stats::VitalType::Mana => self
                        .player_attributes
                        .get(&stats::AttributeType::SelfAttr)
                        .cloned()
                        .unwrap_or(0),
                };

                let base = start + ranks + bonus;
                let final_base = if base == 0 { current } else { base };

                let vital_obj = stats::Vital {
                    vital_type,
                    base: final_base,
                    current,
                };
                self.player_vitals.insert(vital_type, vital_obj.clone());
                stats_changed = true;

                events.push(WorldEvent::VitalUpdated(vital_obj));
            }
            GameMessage::UpdateVitalCurrent { vital, current } => {
                log::debug!("UpdateVitalCurrent: vital={}, current={}", vital, current);
                let vital_type = match stats::VitalType::from_repr(vital) {
                    Some(v) => v,
                    None => {
                        log::warn!("Unknown vital current ID: {}", vital);
                        return events;
                    }
                };

                if let Some(vital_obj) = self.player_vitals.get_mut(&vital_type) {
                    log::debug!(
                        "Updating vital {} from {} to {}",
                        vital_type,
                        vital_obj.current,
                        current
                    );
                    vital_obj.current = current;
                    stats_changed = true;
                    events.push(WorldEvent::VitalUpdated(vital_obj.clone()));
                } else {
                    log::warn!(
                        "Received UpdateVitalCurrent for {} but vital not in cache",
                        vital_type
                    );
                }
            }
            GameMessage::MagicUpdateEnchantment {
                target,
                enchantment,
            } => {
                if target == self.player_guid as u64 {
                    // Update or insert
                    if let Some(existing) = self.player_enchantments.iter_mut().find(|e| {
                        e.spell_id == enchantment.spell_id && e.layer == enchantment.layer
                    }) {
                        *existing = enchantment.clone();
                    } else {
                        self.player_enchantments.push(enchantment.clone());
                    }
                    stats_changed = true;
                    events.push(WorldEvent::EnchantmentUpdated(enchantment));
                }
            }
            GameMessage::MagicUpdateMultipleEnchantments {
                target,
                enchantments,
            } => {
                if target == self.player_guid as u64 {
                    for enchantment in enchantments {
                        if let Some(existing) = self.player_enchantments.iter_mut().find(|e| {
                            e.spell_id == enchantment.spell_id && e.layer == enchantment.layer
                        }) {
                            *existing = enchantment.clone();
                        } else {
                            self.player_enchantments.push(enchantment.clone());
                        }
                        events.push(WorldEvent::EnchantmentUpdated(enchantment));
                    }
                    stats_changed = true;
                }
            }
            GameMessage::MagicRemoveEnchantment {
                target,
                spell_id,
                layer,
            } => {
                if target == self.player_guid as u64 {
                    self.player_enchantments
                        .retain(|e| e.spell_id != spell_id || e.layer != layer);
                    stats_changed = true;
                    events.push(WorldEvent::EnchantmentRemoved { spell_id, layer });
                }
            }
            GameMessage::MagicRemoveMultipleEnchantments { target, spells } => {
                if target == self.player_guid as u64 {
                    for spell in spells {
                        self.player_enchantments
                            .retain(|e| e.spell_id != spell.spell_id || e.layer != spell.layer);
                        events.push(WorldEvent::EnchantmentRemoved {
                            spell_id: spell.spell_id,
                            layer: spell.layer,
                        });
                    }
                    stats_changed = true;
                }
            }
            GameMessage::MagicPurgeEnchantments { target } => {
                if target == self.player_guid as u64 {
                    self.player_enchantments.clear();
                    stats_changed = true;
                    events.push(WorldEvent::EnchantmentsPurged);
                }
            }
            GameMessage::MagicPurgeBadEnchantments { target } => {
                if target == self.player_guid as u64 {
                    use crate::world::properties::EnchantmentTypeFlags;
                    self.player_enchantments.retain(|e| {
                        (e.stat_mod_type & EnchantmentTypeFlags::BENEFICIAL.bits()) != 0
                    });
                    stats_changed = true;
                    events.push(WorldEvent::EnchantmentsPurged);
                }
            }
            GameMessage::MagicDispelEnchantment {
                target,
                spell_id,
                layer,
            } => {
                if target == self.player_guid as u64 {
                    self.player_enchantments
                        .retain(|e| e.spell_id != spell_id || e.layer != layer);
                    stats_changed = true;
                    events.push(WorldEvent::EnchantmentRemoved { spell_id, layer });
                }
            }
            GameMessage::MagicDispelMultipleEnchantments { target, spells } => {
                if target == self.player_guid as u64 {
                    for spell in spells {
                        self.player_enchantments
                            .retain(|e| e.spell_id != spell.spell_id || e.layer != spell.layer);
                        events.push(WorldEvent::EnchantmentRemoved {
                            spell_id: spell.spell_id,
                            layer: spell.layer,
                        });
                    }
                    stats_changed = true;
                }
            }
            GameMessage::UpdateHealth { target, health } => {
                let target_guid = if target == 0 {
                    self.player_guid
                } else {
                    target
                };

                if let Some(_entity) = self.entities.get_mut(target_guid) {
                    // Update health property if we want to track it on entities
                }

                if target_guid == self.player_guid
                    && target_guid != 0
                    && let Some(vital_obj) = self.player_vitals.get_mut(&stats::VitalType::Health)
                {
                    let new_current = (health * vital_obj.base as f32) as u32;
                    log::debug!(
                        "UpdateHealth (self): percent={}, new_current={}",
                        health,
                        new_current
                    );
                    vital_obj.current = new_current;
                    events.push(WorldEvent::VitalUpdated(vital_obj.clone()));
                }
            }
            GameMessage::SetState { guid, state } => {
                if let Some(entity) = self.entities.get_mut(guid) {
                    entity.physics_state =
                        crate::world::properties::PhysicsState::from_bits_retain(state);
                }
            }
            GameMessage::UpdatePropertyInt {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.int_properties.insert(property, value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::Int(value),
                });
            }
            GameMessage::UpdatePropertyInt64 {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.int_properties.insert(property, value as i32); // Cast for simplicity if needed, or use separate map
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::Int64(value),
                });
            }
            GameMessage::UpdatePropertyBool {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.bool_properties.insert(property, value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::Bool(value),
                });
            }
            GameMessage::UpdatePropertyFloat {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.float_properties.insert(property, value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::Float(value),
                });
            }
            GameMessage::UpdatePropertyString {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.string_properties.insert(property, value.clone());
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::String(value),
                });
            }
            GameMessage::UpdatePropertyDataId {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.did_properties.insert(property, value);
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::DID(value),
                });
            }
            GameMessage::UpdatePropertyInstanceId {
                guid,
                property,
                value,
            } => {
                let target_guid = if guid == 0 { self.player_guid } else { guid };
                if let Some(entity) = self.entities.get_mut(target_guid) {
                    entity.iid_properties.insert(property, value);

                    if property == PropertyInstanceId::Container as u32 {
                        entity.container_id = if value == 0 { None } else { Some(value) };
                    }
                    if property == PropertyInstanceId::Wielder as u32 {
                        entity.wielder_id = if value == 0 { None } else { Some(value) };
                    }
                }
                events.push(WorldEvent::PropertyUpdated {
                    guid,
                    property_id: property,
                    value: PropertyValue::IID(value),
                });
            }
            _ => {}
        }

        if stats_changed {
            let (attributes, vitals, skills) = self.get_all_effective_stats();
            events.push(WorldEvent::DerivedStatsUpdated {
                attributes,
                vitals,
                skills,
            });
        }

        events
    }

    fn add_entity(&mut self, entity: Entity) {
        let guid = entity.guid;
        let lb = entity.position.landblock_id;

        self.entities.insert(entity);
        self.scene.update_entity(guid, lb, lb);
    }

    fn remove_entity(&mut self, guid: u32) -> Option<Entity> {
        if let Some(entity) = self.entities.remove(guid) {
            self.scene.remove_entity(guid, entity.position.landblock_id);
            Some(entity)
        } else {
            None
        }
    }

    pub fn get_nearby_entities(&self) -> Vec<Entity> {
        if self.player_guid == 0 {
            return Vec::new();
        }

        let lb = if let Some(player) = self.entities.get(self.player_guid) {
            player.position.landblock_id
        } else {
            return Vec::new();
        };

        let nearby_guids = self.scene.get_nearby_entities(lb);
        nearby_guids
            .into_iter()
            .filter_map(|guid| self.entities.get(guid).cloned())
            .collect()
    }

    /// Check if a position collides with the environment.
    pub fn is_colliding(&mut self, pos: &Vector3, lb: u32, radius: f32) -> bool {
        // Get nearby entities
        let nearby = self.scene.get_nearby_entities(lb);
        for guid in nearby {
            if guid == self.player_guid {
                continue;
            }

            if let Some(entity) = self.entities.get(guid)
                && let Some(gfx_id) = entity.gfx_id
            {
                // Try to get from cache first
                let mut gfx = self
                    .scene
                    .object_geometry
                    .get(&gfx_id)
                    .map(|e| e.gfx_obj.clone());

                // If not in cache and we have a DAT, try loading
                if gfx.is_none()
                    && let Some(dat) = &self.dat
                {
                    gfx = self.scene.get_object_geometry(dat, gfx_id);
                }

                if let Some(gfx_obj) = gfx
                    && let Some(bsp) = &gfx_obj.physics_bsp
                {
                    // Simple AABB-style local transform for now
                    let local_pos = *pos - entity.position.coords;
                    if bsp.intersects_solid(&local_pos, radius) {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// Advance the world simulation by `dt` seconds.
    pub fn tick(&mut self, dt: f32, radius: f32) {
        if self.player_guid == 0 {
            return;
        }

        let (vel, coords, lb) = if let Some(player) = self.entities.get(self.player_guid) {
            (
                player.velocity,
                player.position.coords,
                player.position.landblock_id,
            )
        } else {
            return;
        };

        if vel.length_squared() < 0.0001 {
            return;
        }

        let step = vel * dt;
        let next_coords = coords + step;

        if !self.is_colliding(&next_coords, lb, radius) {
            if let Some(player) = self.entities.get_mut(self.player_guid) {
                player.position.coords = next_coords;
                // Update spatial index handles lb transitions if lb was different,
                // but for now we keep same lb.
                self.scene.update_entity(self.player_guid, lb, lb);
            }
        } else {
            // Bonk! Stop for now.
            if let Some(player) = self.entities.get_mut(self.player_guid) {
                player.velocity = Vector3::zero();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dat::file_type::gfx_obj::GfxObj;
    use crate::dat::graphics::CVertexArray;
    use crate::dat::physics::{BspLeaf, BspNode};
    use crate::protocol::messages::{Enchantment, LayeredSpell};
    use crate::world::physics_types::Sphere;
    use std::collections::HashMap;

    #[test]
    fn test_entity_tracking() {
        // ... existing test
    }

    #[test]
    fn test_movement_collision() {
        let mut world = WorldState::new(None);
        world.player_guid = 0x1;

        // Add player at origin
        let mut player = Entity::new(
            0x1,
            "Player".to_string(),
            WorldPosition {
                landblock_id: 1,
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );
        player.velocity = Vector3::new(2.0, 0.0, 0.0);
        player.flags = ObjectDescriptionFlag::PLAYER;
        world.add_entity(player);

        // Create a fake GfxObj with a solid sphere
        use crate::world::properties::GfxObjFlags;
        let wall_gfx = GfxObj {
            id: 0x99,
            flags: GfxObjFlags::HAS_PHYSICS,
            surfaces: Vec::new(),
            vertex_array: CVertexArray {
                vertex_type: 1,
                vertices: HashMap::new(),
            },
            physics_polygons: HashMap::new(),
            physics_bsp: Some(BspNode::Leaf(BspLeaf {
                index: 0,
                solid: 1,
                sphere: Some(Sphere {
                    center: Vector3::zero(),
                    radius: 1.0,
                }),
                poly_ids: Vec::new(),
            })),
            sort_center: Vector3::zero(),
            polygons: HashMap::new(),
            drawing_bsp: None,
            did_degrade: None,
        };

        // Add a "Wall" entity at (2.0, 0.0, 0.0)
        let mut wall = Entity::new(
            0x2,
            "Wall".to_string(),
            WorldPosition {
                landblock_id: 1,
                coords: Vector3::new(2.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        wall.gfx_id = Some(0x99);
        world.add_entity(wall);

        // Manually inject geometry into cache since we have no DAT
        world.scene.object_geometry.insert(
            0x99,
            Arc::new(crate::world::spatial::GeometryCacheEntry {
                gfx_obj: Arc::new(wall_gfx),
                last_accessed: std::time::Instant::now(),
            }),
        );

        // Tick 1: Still safe. Pos will move towards wall.
        // Moving at 2.0 m/s for 0.1s -> 0.2m move.
        world.tick(0.1, 0.5);
        let pos1 = world.entities.get(0x1).unwrap().position.coords;
        assert!(pos1.x > 0.0);
        assert!(pos1.x < 1.0);

        // Tick several times to hit the wall at (2.0, 0.0, 0.0) with radius 1.0
        // Wall boundary is at x=1.0. Player radius is 0.5.
        // Collision should trigger when player center x + 0.5 >= 1.0 (i.e. x >= 0.5)
        for _ in 0..10 {
            world.tick(0.1, 0.5);
        }

        let player = world.entities.get(0x1).unwrap();
        // Player should be stopped before they enter the wall's solid space
        assert!(player.position.coords.x < 1.0);
        assert_eq!(
            player.velocity.x, 0.0,
            "Player should have stopped due to collision"
        );
    }

    #[test]
    fn test_enchantment_management() {
        let mut world = WorldState::new(None);
        world.player_guid = 0x50000001;

        let e1 = Enchantment {
            spell_id: 1,
            layer: 1,
            power_level: 100,
            stat_mod_key: 1,
            stat_mod_value: 10.0,
            stat_mod_type: 1,
            ..Default::default()
        };
        let e2 = Enchantment {
            spell_id: 2,
            layer: 1,
            power_level: 100,
            stat_mod_key: 1,
            stat_mod_value: 10.0,
            stat_mod_type: 0x02000001, // Beneficial
            ..Default::default()
        };

        world.player_enchantments.push(e1.clone());
        world.player_enchantments.push(e2.clone());
        assert_eq!(world.player_enchantments.len(), 2);

        // Dispel e1
        world.handle_message(GameMessage::MagicDispelEnchantment {
            target: 0x50000001,
            spell_id: 1,
            layer: 1,
        });
        assert_eq!(world.player_enchantments.len(), 1);
        assert_eq!(world.player_enchantments[0].spell_id, 2);

        // DispelMultiple (e2)
        world.handle_message(GameMessage::MagicDispelMultipleEnchantments {
            target: 0x50000001,
            spells: vec![LayeredSpell {
                spell_id: 2,
                layer: 1,
            }],
        });
        assert_eq!(world.player_enchantments.len(), 0);

        // Refill
        world.player_enchantments.push(e1.clone());
        world.player_enchantments.push(e2.clone());

        // PurgeAll
        world.handle_message(GameMessage::MagicPurgeEnchantments { target: 0x50000001 });
        assert_eq!(world.player_enchantments.len(), 0);

        // Refill
        world.player_enchantments.push(e1.clone());
        world.player_enchantments.push(e2.clone());

        // PurgeBad
        world.handle_message(GameMessage::MagicPurgeBadEnchantments { target: 0x50000001 });
        assert_eq!(world.player_enchantments.len(), 1);
        assert_eq!(world.player_enchantments[0].spell_id, 2);
    }
}
