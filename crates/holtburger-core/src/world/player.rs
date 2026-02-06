use super::WorldEvent;
use super::stats;
use crate::protocol::messages::*;
use crate::world::properties::EnchantmentTypeFlags;
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone, Copy, Default)]
pub struct SkillBase {
    pub ranks: u32,
    pub init: u32,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct VitalBase {
    pub ranks: u32,
    pub start: u32,
}

#[derive(Debug, Clone)]
pub struct PlayerState {
    pub guid: u32,
    pub name: String,
    pub attributes: HashMap<stats::AttributeType, u32>,
    pub vitals: HashMap<stats::VitalType, stats::Vital>,
    /// Stores the raw ranks and start for vitals so they can be recalculated
    pub vital_bases: HashMap<stats::VitalType, VitalBase>,
    pub skills: HashMap<stats::SkillType, stats::Skill>,
    /// Stores the raw ranks and init for skills so they can be recalculated
    pub skill_bases: HashMap<stats::SkillType, SkillBase>,
    pub position: WorldPosition,
    pub enchantments: Vec<Enchantment>,
    pub spells: BTreeMap<u32, f32>,
    pub spell_lists: Vec<Vec<u32>>,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            guid: 0,
            name: "Unknown".to_string(),
            attributes: HashMap::new(),
            vitals: HashMap::new(),
            vital_bases: HashMap::new(),
            skills: HashMap::new(),
            skill_bases: HashMap::new(),
            position: WorldPosition::default(),
            enchantments: Vec::new(),
            spells: BTreeMap::new(),
            spell_lists: vec![Vec::new(); 8],
        }
    }

    pub fn get_attributes(&self) -> Vec<stats::Attribute> {
        let mut attr_objs: Vec<_> = self
            .attributes
            .iter()
            .map(|(&attr_type, &base)| stats::Attribute {
                attr_type,
                base,
                current: self.get_attribute_current(attr_type),
            })
            .collect();
        attr_objs.sort_by_key(|a| a.attr_type as u32);
        attr_objs
    }

    pub fn get_vitals(&self) -> Vec<stats::Vital> {
        let mut vitals: Vec<_> = self.vitals.values().cloned().collect();
        vitals.sort_by_key(|v| v.vital_type as u32);
        vitals
    }

    pub fn get_skills(&self) -> Vec<stats::Skill> {
        let mut skill_objs: Vec<_> = self.skills.values().cloned().collect();
        skill_objs.sort_by_key(|s| s.skill_type as u32);
        skill_objs
    }

    /// Returns the enchantments that are currently "winning" their categories.
    ///
    /// According to ACE source (PropertiesEnchantmentRegistryExtensions.cs),
    /// the winner is determined by PowerLevel, then StartTime. LayerId is
    /// preserved as a sequence number for the stack but isn't the primary arbiter.
    pub fn get_active_enchantments(&self) -> Vec<Enchantment> {
        let mut by_category: HashMap<u16, Enchantment> = HashMap::new();

        for e in &self.enchantments {
            let existing = by_category.get(&e.spell_category);
            match existing {
                Some(best) => {
                    if e.is_better_than(best) {
                        by_category.insert(e.spell_category, e.clone());
                    }
                }
                None => {
                    by_category.insert(e.spell_category, e.clone());
                }
            }
        }

        by_category.into_values().collect()
    }

    pub fn get_attribute_multiplier(&self, attr: stats::AttributeType) -> f32 {
        let active = self.get_active_enchantments();
        let mut mult = 1.0;

        for e in active {
            let flags = EnchantmentTypeFlags::from_bits_retain(e.stat_mod_type);
            if flags
                .contains(EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::MULTIPLICATIVE)
                && e.stat_mod_key == attr as u32
            {
                mult *= e.stat_mod_value;
            }
        }
        mult
    }

    pub fn get_attribute_additive(&self, attr: stats::AttributeType) -> f32 {
        let active = self.get_active_enchantments();
        let mut add = 0.0;

        for e in active {
            let flags = EnchantmentTypeFlags::from_bits_retain(e.stat_mod_type);
            if flags.contains(EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                && e.stat_mod_key == attr as u32
            {
                add += e.stat_mod_value;
            }
        }
        add
    }

    pub fn get_attribute_current(&self, attr: stats::AttributeType) -> u32 {
        let base = self.attributes.get(&attr).cloned().unwrap_or(0) as f32;
        let mult = self.get_attribute_multiplier(attr);
        let add = self.get_attribute_additive(attr);

        ((base * mult) + add).round() as u32
    }

    pub fn calculate_vital_attribute_contribution(
        &self,
        vital_type: stats::VitalType,
        use_current: bool,
    ) -> u32 {
        let get_val = |attr: stats::AttributeType| {
            if use_current {
                self.get_attribute_current(attr)
            } else {
                self.attributes.get(&attr).cloned().unwrap_or(0)
            }
        };

        match vital_type {
            stats::VitalType::Health => {
                (get_val(stats::AttributeType::EnduranceAttr) as f32 / 2.0).round() as u32
            }
            stats::VitalType::Stamina => get_val(stats::AttributeType::EnduranceAttr),
            stats::VitalType::Mana => get_val(stats::AttributeType::SelfAttr),
        }
    }

    pub fn get_vital_multiplier(&self, vital: stats::VitalType) -> f32 {
        let active = self.get_active_enchantments();
        let mut mult = 1.0;
        let world_id = match vital {
            stats::VitalType::Health => 1,  // MaxHealth is ID 1 for mods
            stats::VitalType::Stamina => 3, // MaxStamina is ID 3 for mods
            stats::VitalType::Mana => 5,    // MaxMana is ID 5 for mods
        };

        for e in active {
            let flags = EnchantmentTypeFlags::from_bits_retain(e.stat_mod_type);
            if flags
                .contains(EnchantmentTypeFlags::SECOND_ATT | EnchantmentTypeFlags::MULTIPLICATIVE)
                && e.stat_mod_key == world_id
            {
                mult *= e.stat_mod_value;
            }
        }
        mult
    }

    pub fn get_vital_additive(&self, vital: stats::VitalType) -> f32 {
        let active = self.get_active_enchantments();
        let mut add = 0.0;
        let world_id = match vital {
            stats::VitalType::Health => 1,
            stats::VitalType::Stamina => 3,
            stats::VitalType::Mana => 5,
        };

        for e in active {
            let flags = EnchantmentTypeFlags::from_bits_retain(e.stat_mod_type);
            if flags.contains(EnchantmentTypeFlags::SECOND_ATT | EnchantmentTypeFlags::ADDITIVE)
                && e.stat_mod_key == world_id
            {
                add += e.stat_mod_value;
            }
        }
        add
    }

    pub fn calculate_vital_base(&self, vital_type: stats::VitalType) -> u32 {
        let base_data = self
            .vital_bases
            .get(&vital_type)
            .cloned()
            .unwrap_or_default();
        let base_no_bonus = base_data.ranks + base_data.start;
        let bonus = self.calculate_vital_attribute_contribution(vital_type, false);
        base_no_bonus + bonus
    }

    pub fn calculate_vital_current(&self, vital_type: stats::VitalType) -> u32 {
        let base_data = self
            .vital_bases
            .get(&vital_type)
            .cloned()
            .unwrap_or_default();
        let base_no_bonus = base_data.ranks + base_data.start;
        let attr_bonus = self.calculate_vital_attribute_contribution(vital_type, true);

        let total_base = (base_no_bonus + attr_bonus) as f32;
        let mult = self.get_vital_multiplier(vital_type);
        let add = self.get_vital_additive(vital_type);

        ((total_base * mult) + add).round() as u32
    }

    pub fn get_skill_multiplier(&self, skill: stats::SkillType) -> f32 {
        let active = self.get_active_enchantments();
        let mut mult = 1.0;

        for e in active {
            let flags = EnchantmentTypeFlags::from_bits_retain(e.stat_mod_type);
            if flags.contains(EnchantmentTypeFlags::SKILL | EnchantmentTypeFlags::MULTIPLICATIVE)
                && e.stat_mod_key == skill as u32
            {
                mult *= e.stat_mod_value;
            }
        }
        mult
    }

    pub fn get_skill_additive(&self, skill: stats::SkillType) -> f32 {
        let active = self.get_active_enchantments();
        let mut add = 0.0;

        for e in active {
            let flags = EnchantmentTypeFlags::from_bits_retain(e.stat_mod_type);
            if flags.contains(EnchantmentTypeFlags::SKILL | EnchantmentTypeFlags::ADDITIVE)
                && e.stat_mod_key == skill as u32
            {
                add += e.stat_mod_value;
            }
        }
        add
    }

    pub fn derive_skill_value(
        &self,
        skill_type: stats::SkillType,
        ranks: u32,
        init: u32,
        use_current: bool,
    ) -> u32 {
        use stats::AttributeType::*;
        use stats::SkillType::*;

        let (a1, a2, div) = match skill_type {
            MeleeDefense | MissileDefense | FinesseWeapons | DualWield | Shield | Recklessness
            | DirtyFighting | SneakAttack => (Some(QuicknessAttr), Some(CoordinationAttr), 3),
            ArcaneLore | MagicDefense | ManaConversion | Spellcraft | CreatureEnchantment
            | ItemEnchantment | LifeMagic | WarMagic | VoidMagic | Summoning | Deception
            | AssessPerson | AssessCreature => (
                Some(FocusAttr),
                Some(SelfAttr),
                match skill_type {
                    MagicDefense => 7,
                    ManaConversion | ArcaneLore => 6,
                    Deception => 4,
                    AssessPerson | AssessCreature => 2,
                    _ => 4,
                },
            ),
            Axe | Dagger | Mace | Spear | Staff | Sword | UnarmedCombat | HeavyWeapons
            | LightWeapons | TwoHandedCombat => (Some(StrengthAttr), Some(CoordinationAttr), 3),
            Bow | Crossbow | MissileWeapons | ThrownWeapon | Sling => {
                (Some(CoordinationAttr), None, 2)
            }
            Healing | Lockpick | Fletching | Alchemy | Cooking | ItemTinkering
            | WeaponTinkering | ArmorTinkering | MagicItemTinkering | Gearcraft | Salvaging => {
                (Some(FocusAttr), Some(CoordinationAttr), 3)
            }
            Run => (Some(QuicknessAttr), None, 1),
            Jump => (Some(StrengthAttr), Some(QuicknessAttr), 2),
            Leadership | Loyalty | Awareness | ArmsAndArmorRepair => {
                (Some(FocusAttr), Some(SelfAttr), 4)
            }
            Challenge => (Some(StrengthAttr), Some(SelfAttr), 4),
        };

        let get_val = |attr: stats::AttributeType| {
            if use_current {
                self.get_attribute_current(attr)
            } else {
                self.attributes.get(&attr).cloned().unwrap_or(0)
            }
        };

        let val1 = a1.map(get_val).unwrap_or(0);
        let val2 = a2.map(get_val).unwrap_or(0);

        let bonus = (val1 + val2) as f32 / div as f32;
        let total_base = (bonus.round() as u32 + ranks + init) as f32;

        if use_current {
            let mult = self.get_skill_multiplier(skill_type);
            let add = self.get_skill_additive(skill_type);
            ((total_base * mult) + add).round() as u32
        } else {
            total_base as u32
        }
    }

    pub fn emit_derived_stats(&mut self, events: &mut Vec<WorldEvent>) {
        // Recalculate Vitals
        for vital_type in [
            stats::VitalType::Health,
            stats::VitalType::Stamina,
            stats::VitalType::Mana,
        ] {
            let base = self.calculate_vital_base(vital_type);
            let buffed_max = self.calculate_vital_current(vital_type);
            if let Some(vital) = self.vitals.get_mut(&vital_type) {
                vital.base = base;
                vital.buffed_max = buffed_max;
            }
        }

        // Recalculate Skills
        let skill_types: Vec<_> = self.skill_bases.keys().cloned().collect();
        for skill_type in skill_types {
            let base_data = self.skill_bases[&skill_type];
            let base_val =
                self.derive_skill_value(skill_type, base_data.ranks, base_data.init, false);
            let current_val =
                self.derive_skill_value(skill_type, base_data.ranks, base_data.init, true);
            if let Some(skill) = self.skills.get_mut(&skill_type) {
                skill.base = base_val;
                skill.current = current_val;
            }
        }

        events.push(WorldEvent::DerivedStatsUpdated {
            attributes: self.get_attributes(),
            vitals: self.get_vitals(),
            skills: self.get_skills(),
        });
    }

    pub fn handle_message(&mut self, msg: &GameMessage, events: &mut Vec<WorldEvent>) -> bool {
        match msg {
            GameMessage::UpdatePosition(data) => {
                if data.guid == self.guid && self.guid != 0 {
                    self.position = data.pos.pos;
                    events.push(WorldEvent::EntityMoved {
                        guid: self.guid,
                        pos: self.position,
                    });
                    return true;
                }
            }
            GameMessage::PrivateUpdatePosition(data) => {
                self.position = data.pos;
                events.push(WorldEvent::EntityMoved {
                    guid: self.guid,
                    pos: self.position,
                });
                return true;
            }
            GameMessage::PublicUpdatePosition(data) => {
                if data.guid == self.guid && self.guid != 0 {
                    self.position = data.pos;
                    events.push(WorldEvent::EntityMoved {
                        guid: self.guid,
                        pos: self.position,
                    });
                    return true;
                }
            }
            GameMessage::VectorUpdate(data) => {
                if data.guid == self.guid && self.guid != 0 {
                    events.push(WorldEvent::EntityVectorUpdated {
                        guid: data.guid,
                        velocity: data.velocity,
                        omega: data.omega,
                    });
                    return true;
                }
            }
            GameMessage::UpdateAttribute(data) => {
                let UpdateAttributeData {
                    attribute,
                    ranks,
                    start,
                    ..
                } = &**data;
                if let Some(attr_type) = stats::AttributeType::from_repr(*attribute) {
                    let base = start + ranks;
                    self.attributes.insert(attr_type, base);

                    events.push(WorldEvent::AttributeUpdated(stats::Attribute {
                        attr_type,
                        base,
                        current: self.get_attribute_current(attr_type),
                    }));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::UpdateSkill(data) => {
                let UpdateSkillData {
                    skill,
                    ranks,
                    status,
                    init,
                    ..
                } = &**data;
                if let Some(skill_type) = stats::SkillType::from_repr(*skill) {
                    let training = match status {
                        1 => stats::TrainingLevel::Untrained,
                        2 => stats::TrainingLevel::Trained,
                        3 => stats::TrainingLevel::Specialized,
                        _ => stats::TrainingLevel::Unusable,
                    };

                    self.skill_bases.insert(
                        skill_type,
                        SkillBase {
                            ranks: *ranks,
                            init: *init,
                        },
                    );

                    let base_val = self.derive_skill_value(skill_type, *ranks, *init, false);
                    let current_val = self.derive_skill_value(skill_type, *ranks, *init, true);

                    let skill_obj = stats::Skill {
                        skill_type,
                        base: base_val,
                        current: current_val,
                        training,
                    };
                    self.skills.insert(skill_type, skill_obj.clone());

                    events.push(WorldEvent::SkillUpdated(skill_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::UpdateVital(data) => {
                let UpdateVitalData {
                    vital,
                    ranks,
                    start,
                    current,
                    ..
                } = &**data;
                if let Some(vital_type) = stats::VitalType::from_repr(*vital) {
                    self.vital_bases.insert(
                        vital_type,
                        VitalBase {
                            ranks: *ranks,
                            start: *start,
                        },
                    );

                    let base = self.calculate_vital_base(vital_type);
                    let buffed_max = self.calculate_vital_current(vital_type);
                    let final_base = if base == 0 { *current } else { base };

                    let vital_obj = stats::Vital {
                        vital_type,
                        base: final_base,
                        buffed_max,
                        current: *current,
                    };
                    self.vitals.insert(vital_type, vital_obj.clone());

                    events.push(WorldEvent::VitalUpdated(vital_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::UpdateAttribute2ndLevel(data) => {
                let UpdateVitalCurrentData { vital, current, .. } = &**data;
                if let Some(vital_type) = stats::VitalType::from_repr(*vital)
                    && let Some(vital_obj) = self.vitals.get_mut(&vital_type)
                {
                    vital_obj.current = *current;
                    events.push(WorldEvent::VitalUpdated(vital_obj.clone()));
                    return true;
                }
            }
            GameMessage::GameEvent(ev) => {
                return match &ev.event {
                    GameEventData::MagicUpdateEnchantment(data) => {
                        let MagicUpdateEnchantmentData {
                            target,
                            enchantment,
                            ..
                        } = &**data;
                        if *target == self.guid {
                            if let Some(existing) = self.enchantments.iter_mut().find(|e| {
                                e.spell_id == enchantment.spell_id && e.layer == enchantment.layer
                            }) {
                                *existing = enchantment.clone();
                            } else {
                                self.enchantments.push(enchantment.clone());
                            }
                            events.push(WorldEvent::EnchantmentUpdated(enchantment.clone()));
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEventData::MagicUpdateMultipleEnchantments(data) => {
                        let MagicUpdateMultipleEnchantmentsData {
                            target,
                            enchantments,
                            ..
                        } = &**data;
                        if *target == self.guid {
                            for enchantment in enchantments {
                                if let Some(existing) = self.enchantments.iter_mut().find(|e| {
                                    e.spell_id == enchantment.spell_id
                                        && e.layer == enchantment.layer
                                }) {
                                    *existing = enchantment.clone();
                                } else {
                                    self.enchantments.push(enchantment.clone());
                                }
                                events.push(WorldEvent::EnchantmentUpdated(enchantment.clone()));
                            }
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEventData::MagicRemoveEnchantment(data) => {
                        let MagicRemoveEnchantmentData {
                            target,
                            spell_id,
                            layer,
                            ..
                        } = &**data;
                        if *target == self.guid {
                            self.enchantments
                                .retain(|e| e.spell_id != *spell_id || e.layer != *layer);
                            events.push(WorldEvent::EnchantmentRemoved {
                                spell_id: *spell_id,
                                layer: *layer,
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEventData::MagicRemoveMultipleEnchantments(data) => {
                        let MagicRemoveMultipleEnchantmentsData { target, spells, .. } = &**data;
                        if *target == self.guid {
                            for (spell_id, layer) in spells {
                                self.enchantments
                                    .retain(|e| e.spell_id != *spell_id || e.layer != *layer);
                                events.push(WorldEvent::EnchantmentRemoved {
                                    spell_id: *spell_id,
                                    layer: *layer,
                                });
                            }
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEventData::MagicPurgeEnchantments(data) => {
                        let MagicPurgeEnchantmentsData { target, .. } = &**data;
                        if *target == self.guid {
                            self.enchantments.clear();
                            events.push(WorldEvent::EnchantmentsPurged);
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEventData::MagicPurgeBadEnchantments(data) => {
                        let MagicPurgeBadEnchantmentsData { target, .. } = &**data;
                        if *target == self.guid {
                            self.enchantments.retain(|e| {
                                (e.stat_mod_type & EnchantmentTypeFlags::BENEFICIAL.bits()) != 0
                            });
                            events.push(WorldEvent::EnchantmentsPurged);
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    _ => false,
                };
            }
            GameMessage::UpdateHealth(data) => {
                let target = data.target;
                let health = data.health;
                let target_guid = if target == 0 { self.guid } else { target };

                if target_guid == self.guid
                    && target_guid != 0
                    && let Some(vital_obj) = self.vitals.get_mut(&stats::VitalType::Health)
                {
                    // UpdateHealth is a percentage float (0.0 to 1.0)
                    let new_current = (health * vital_obj.buffed_max as f32) as u32;
                    vital_obj.current = new_current;
                    events.push(WorldEvent::VitalUpdated(vital_obj.clone()));
                    return true;
                }
            }
            _ => {}
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stat_calculations() {
        let mut player = PlayerState::new();

        // Setup attributes
        player
            .attributes
            .insert(stats::AttributeType::StrengthAttr, 100);
        player
            .attributes
            .insert(stats::AttributeType::EnduranceAttr, 100);
        player
            .attributes
            .insert(stats::AttributeType::QuicknessAttr, 100);
        player
            .attributes
            .insert(stats::AttributeType::CoordinationAttr, 100);
        player
            .attributes
            .insert(stats::AttributeType::FocusAttr, 100);
        player
            .attributes
            .insert(stats::AttributeType::SelfAttr, 100);

        // Test Vital Bonuses
        assert_eq!(
            player.calculate_vital_attribute_contribution(stats::VitalType::Health, false),
            50
        );
        assert_eq!(
            player.calculate_vital_attribute_contribution(stats::VitalType::Stamina, false),
            100
        );
        assert_eq!(
            player.calculate_vital_attribute_contribution(stats::VitalType::Mana, false),
            100
        );

        // Test Vital Base Calculation
        player.vital_bases.insert(
            stats::VitalType::Health,
            VitalBase {
                ranks: 50,
                start: 0,
            },
        );
        assert_eq!(player.calculate_vital_base(stats::VitalType::Health), 100);

        // Test Skill Math
        assert_eq!(
            player.derive_skill_value(stats::SkillType::MeleeDefense, 10, 4, false),
            81
        );
        assert_eq!(
            player.derive_skill_value(stats::SkillType::Run, 5, 0, false),
            105
        );
    }

    #[test]
    fn test_buff_calculations() {
        let mut player = PlayerState::new();
        player
            .attributes
            .insert(stats::AttributeType::StrengthAttr, 100);
        player
            .attributes
            .insert(stats::AttributeType::CoordinationAttr, 100);

        // Add a Strength Buff (+20 additive)
        player.enchantments.push(Enchantment {
            spell_category: 1, // strength group
            power_level: 100,
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::StrengthAttr as u32,
            stat_mod_value: 20.0,
            ..Default::default()
        });

        // Add a Skill Multiplier (1.10x)
        player.enchantments.push(Enchantment {
            spell_category: 2, // axe group
            power_level: 100,
            stat_mod_type: (EnchantmentTypeFlags::SKILL | EnchantmentTypeFlags::MULTIPLICATIVE)
                .bits(),
            stat_mod_key: stats::SkillType::Axe as u32,
            stat_mod_value: 1.10,
            ..Default::default()
        });

        // Strength should be 120
        assert_eq!(
            player.get_attribute_current(stats::AttributeType::StrengthAttr),
            120
        );

        // Heavy Weapons skill: (Str + Coord) / 3 + Ranks + Init
        // (120 + 100) / 3 = 73.33 -> 73
        // Base was (100 + 100) / 3 = 66.66 -> 67
        player.skill_bases.insert(
            stats::SkillType::HeavyWeapons,
            SkillBase { ranks: 10, init: 0 },
        );

        let val = player.derive_skill_value(stats::SkillType::HeavyWeapons, 10, 0, true);
        assert_eq!(val, 73 + 10); // 83

        // Test Stacking: Add a weaker Strength buff
        player.enchantments.push(Enchantment {
            spell_category: 1, // same strength group
            power_level: 50,   // Lower power
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::StrengthAttr as u32,
            stat_mod_value: 10.0,
            ..Default::default()
        });

        // Should still be 120
        assert_eq!(
            player.get_attribute_current(stats::AttributeType::StrengthAttr),
            120
        );

        // Add a STRONGER Strength buff
        player.enchantments.push(Enchantment {
            spell_category: 1, // same group
            power_level: 200,  // Higher power
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::StrengthAttr as u32,
            stat_mod_value: 30.0,
            ..Default::default()
        });

        // Should now be 130
        assert_eq!(
            player.get_attribute_current(stats::AttributeType::StrengthAttr),
            130
        );
    }

    #[test]
    fn test_health_rounding() {
        let mut player = PlayerState::new();
        // Endurance 101 / 2 = 50.5 -> should be 51
        player
            .attributes
            .insert(stats::AttributeType::EnduranceAttr, 101);
        player.vital_bases.insert(
            stats::VitalType::Health,
            VitalBase {
                ranks: 0,
                start: 100,
            },
        );

        let health_base = player.calculate_vital_base(stats::VitalType::Health);
        assert_eq!(
            health_base, 151,
            "Base Health contribution from 101 Endurance should be 51 (rounded)"
        );

        // Add an Endurance buff of +10 (Total 111)
        player.enchantments.push(Enchantment {
            spell_category: 3, // endurance group
            stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE)
                .bits(),
            stat_mod_key: stats::AttributeType::EnduranceAttr as u32,
            stat_mod_value: 10.0,
            power_level: 100,
            ..Default::default()
        });

        // Current Endurance should be 111. 111 / 2 = 55.5 -> 56.
        // Total health should be 100 (start) + 56 (bonus) = 156.
        let health_current = player.calculate_vital_current(stats::VitalType::Health);
        assert_eq!(
            health_current, 156,
            "Current Health with 111 Endurance should be 156 (111/2=55.5 rounded to 56)"
        );
    }

    #[test]
    fn test_vector_update_routing() {
        use crate::math::Vector3;
        use crate::protocol::messages::GameMessage;
        use crate::protocol::messages::movement::VectorUpdateData;
        use crate::world::WorldEvent;

        let mut player = PlayerState::new();
        player.guid = 0x50000001;

        let data = VectorUpdateData {
            guid: 0x50000001,
            velocity: Vector3::new(1.0, 2.0, 3.0),
            omega: Vector3::new(0.1, 0.2, 0.3),
            instance_sequence: 123,
            vector_sequence: 456,
        };

        let msg = GameMessage::VectorUpdate(Box::new(data));
        let mut events = Vec::new();
        let handled = player.handle_message(&msg, &mut events);

        assert!(handled);
        assert_eq!(events.len(), 1);
        if let WorldEvent::EntityVectorUpdated {
            guid,
            velocity,
            omega,
        } = &events[0]
        {
            assert_eq!(*guid, 0x50000001);
            assert_eq!(velocity.x, 1.0);
            assert_eq!(omega.x, 0.1);
        } else {
            panic!("Expected EntityVectorUpdated event");
        }
    }
}
