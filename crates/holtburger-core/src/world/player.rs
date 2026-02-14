use super::WorldEvent;
use super::stats;
use holtburger_common::Guid;
use holtburger_common::properties::{EnchantmentTypeFlags, PropertyFloat, PropertyInt};
use holtburger_common::sequence::is_newer_u16;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_protocol::messages::*;
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

#[derive(Debug, Clone, PartialEq)]
struct LastSentStats {
    attributes: Vec<stats::Attribute>,
    vitals: Vec<stats::Vital>,
    skills: Vec<stats::Skill>,
    resistances: stats::Resistances,
    armor: u32,
    vitae: f32,
}

/// The localized state of the current player.
///
/// NOTE: This data is mirrored in the `WorldState.entities` map.
/// Authorities should update player state via `WorldState` mutation methods
/// to maintain the mirror invariant.
#[derive(Debug, Clone)]
pub struct PlayerState {
    pub guid: Guid,
    pub name: String,
    pub level: u32,
    pub total_experience: u64,
    pub available_experience: u64,
    pub unspent_skill_points: u32,
    pub attributes: HashMap<stats::AttributeType, stats::Attribute>,
    pub vitals: HashMap<stats::VitalType, stats::Vital>,
    /// Stores the raw ranks and start for vitals so they can be recalculated
    pub vital_bases: HashMap<stats::VitalType, VitalBase>,
    pub skills: HashMap<stats::SkillType, stats::Skill>,
    /// Stores the raw ranks and init for skills so they can be recalculated
    pub skill_bases: HashMap<stats::SkillType, SkillBase>,
    pub resistances: stats::Resistances,
    pub armor: u32,
    pub vitae: f32,
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub position_sequence: u16,
    pub movement_sequence: u16,
    pub enchantments: Vec<Enchantment>,
    pub spells: BTreeMap<u32, f32>,
    pub spell_lists: Vec<Vec<u32>>,
    pub int_properties: BTreeMap<u32, i32>,
    pub int64_properties: BTreeMap<u32, i64>,
    pub bool_properties: BTreeMap<u32, bool>,
    pub float_properties: BTreeMap<u32, f64>,
    pub string_properties: BTreeMap<u32, String>,
    pub did_properties: BTreeMap<u32, Guid>,
    pub iid_properties: BTreeMap<u32, Guid>,
    pub combat_mode: holtburger_protocol::messages::combat::CombatMode,

    /// Dirty tracking for events
    last_sent_stats: Option<LastSentStats>,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            guid: Guid::NULL,
            name: "Unknown".to_string(),
            level: 0,
            total_experience: 0,
            available_experience: 0,
            unspent_skill_points: 0,
            attributes: HashMap::new(),
            vitals: HashMap::new(),
            vital_bases: HashMap::new(),
            skills: HashMap::new(),
            skill_bases: HashMap::new(),
            resistances: stats::Resistances::default(),
            armor: 0,
            vitae: 1.0,
            position: WorldPosition::default(),
            instance_sequence: 0,
            server_control_sequence: 0,
            teleport_sequence: 0,
            force_position_sequence: 0,
            position_sequence: 0,
            movement_sequence: 0,
            enchantments: Vec::new(),
            spells: BTreeMap::new(),
            spell_lists: vec![Vec::new(); 8],
            int_properties: BTreeMap::new(),
            int64_properties: BTreeMap::new(),
            bool_properties: BTreeMap::new(),
            float_properties: BTreeMap::new(),
            string_properties: BTreeMap::new(),
            did_properties: BTreeMap::new(),
            iid_properties: BTreeMap::new(),
            combat_mode: holtburger_protocol::messages::combat::CombatMode::NonCombat,
            last_sent_stats: None,
        }
    }

    pub fn get_attributes(&self) -> Vec<stats::Attribute> {
        let mut attr_objs: Vec<_> = self.attributes.values().cloned().collect();
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

    /// Increments and returns the next movement sequence.
    pub fn next_move_seq(&mut self) -> u16 {
        self.movement_sequence = self.movement_sequence.wrapping_add(1);
        self.movement_sequence
    }

    /// Returns the current enchantments that are currently "winning" their categories.
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
                        by_category.insert(e.spell_category, *e);
                    }
                }
                None => {
                    by_category.insert(e.spell_category, *e);
                }
            }
        }

        by_category.into_values().collect()
    }

    pub fn get_attribute_multiplier(&self, attr: stats::AttributeType) -> f32 {
        super::magic::get_enchantment_multiplier(
            &self.enchantments,
            EnchantmentTypeFlags::ATTRIBUTE.bits(),
            attr as u32,
        )
    }

    pub fn get_attribute_additive(&self, attr: stats::AttributeType) -> f32 {
        super::magic::get_enchantment_additive(
            &self.enchantments,
            EnchantmentTypeFlags::ATTRIBUTE.bits(),
            attr as u32,
        )
    }

    pub fn get_attribute_base(&self, attr: stats::AttributeType) -> u32 {
        self.attributes.get(&attr).map(|a| a.base).unwrap_or(0)
    }

    pub fn get_attribute_current(&self, attr: stats::AttributeType) -> u32 {
        let base = self.get_attribute_base(attr) as f32;
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
                self.get_attribute_base(attr)
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
        super::magic::get_enchantment_multiplier(
            &self.enchantments,
            EnchantmentTypeFlags::SECOND_ATT.bits(),
            vital as u32,
        )
    }

    pub fn get_vital_additive(&self, vital: stats::VitalType) -> f32 {
        super::magic::get_enchantment_additive(
            &self.enchantments,
            EnchantmentTypeFlags::SECOND_ATT.bits(),
            vital as u32,
        )
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
        super::magic::get_enchantment_multiplier(
            &self.enchantments,
            EnchantmentTypeFlags::SKILL.bits(),
            skill as u32,
        )
    }

    pub fn get_skill_additive(&self, skill: stats::SkillType) -> f32 {
        super::magic::get_enchantment_additive(
            &self.enchantments,
            EnchantmentTypeFlags::SKILL.bits(),
            skill as u32,
        )
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
                self.get_attribute_base(attr)
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
        // Recalculate Attributes
        let attr_types: Vec<_> = self.attributes.keys().cloned().collect();
        for attr_type in attr_types {
            let current = self.get_attribute_current(attr_type);
            if let Some(attr) = self.attributes.get_mut(&attr_type) {
                attr.current = current;
            }
        }

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
                // Clamp current to buffed_max if it's higher
                if vital.current > buffed_max {
                    vital.current = buffed_max;
                }
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

        // Recalculate Armor
        let base_armor = self
            .int_properties
            .get(&(PropertyInt::ArmorLevel as u32))
            .cloned()
            .unwrap_or(0);
        self.armor = super::magic::get_enchanted_armor(base_armor, &self.enchantments) as u32;

        // Recalculate Resistances
        let get_r = |prop: PropertyFloat| {
            let base = self
                .float_properties
                .get(&(prop as u32))
                .cloned()
                .unwrap_or(1.0);
            super::magic::get_enchanted_resistance(base as f32, &self.enchantments, prop as u32)
        };
        self.resistances = stats::Resistances {
            slash: get_r(PropertyFloat::ResistSlash),
            pierce: get_r(PropertyFloat::ResistPierce),
            bludgeon: get_r(PropertyFloat::ResistBludgeon),
            fire: get_r(PropertyFloat::ResistFire),
            cold: get_r(PropertyFloat::ResistCold),
            acid: get_r(PropertyFloat::ResistAcid),
            electric: get_r(PropertyFloat::ResistElectric),
            nether: get_r(PropertyFloat::ResistNether),
        };

        // Recalculate Vitae
        self.vitae = super::magic::get_total_vitae(&self.enchantments);

        let current = LastSentStats {
            attributes: self.get_attributes(),
            vitals: self.get_vitals(),
            skills: self.get_skills(),
            resistances: self.resistances.clone(),
            armor: self.armor,
            vitae: self.vitae,
        };

        if self.last_sent_stats.as_ref() == Some(&current) {
            return;
        }

        self.last_sent_stats = Some(current.clone());

        events.push(WorldEvent::DerivedStatsUpdated {
            attributes: current.attributes,
            vitals: current.vitals,
            skills: current.skills,
            resistances: current.resistances,
            armor: current.armor,
            vitae: current.vitae,
        });
    }

    pub fn handle_message(
        &mut self,
        msg: &GameMessage,
        events: &mut Vec<WorldEvent>,
        xp_table: Option<&holtburger_dat::file_type::XpTable>,
    ) -> bool {
        match msg {
            GameMessage::ObjectCreate(data) => {
                if data.guid == self.guid && self.guid != Guid::NULL {
                    if let Some(pos) = data.pos {
                        self.position = pos;
                    }
                    return false;
                }
            }
            GameMessage::UpdatePosition(data) => {
                if data.guid == self.guid && self.guid != Guid::NULL {
                    let old_forced_seq = self.force_position_sequence;

                    self.position = data.pos.pos;
                    self.instance_sequence = data.pos.instance_sequence;
                    self.position_sequence = data.pos.position_sequence;
                    self.teleport_sequence = data.pos.teleport_sequence;
                    self.force_position_sequence = data.pos.force_position_sequence;

                    if is_newer_u16(self.force_position_sequence, old_forced_seq) {
                        events.push(WorldEvent::ForcedReposition {
                            guid: self.guid,
                            pos: self.position,
                            sequence: self.force_position_sequence,
                        });
                    }

                    return false;
                }
            }
            GameMessage::PrivateUpdatePosition(data) => {
                self.position = data.pos;
                return false;
            }
            GameMessage::PublicUpdatePosition(data) => {
                if data.guid == self.guid && self.guid != Guid::NULL {
                    self.position = data.pos;
                    return false;
                }
            }
            GameMessage::VectorUpdate(data) => {
                if data.guid == self.guid && self.guid != Guid::NULL {
                    self.instance_sequence = data.instance_sequence;
                    events.push(WorldEvent::EntityVectorUpdated {
                        guid: data.guid,
                        velocity: data.velocity,
                        omega: data.omega,
                    });
                    return true;
                }
            }
            GameMessage::UpdateMotion(data) => {
                if data.guid == self.guid && self.guid != Guid::NULL {
                    self.instance_sequence = data.object_instance_sequence;
                    self.server_control_sequence = data.server_control_sequence;
                    self.movement_sequence = data.movement_sequence;

                    // We don't update position here as it's just a request/animation
                    // But we emit an event if it's a non-autonomous move (server request)
                    if !data.is_autonomous {
                        // For MoveToObject/MoveToPosition, we might want a specific event
                        // but for now, the TUI can see the GameMessage if it wants.
                    }
                    return true;
                }
            }
            GameMessage::PlayerTeleport(data) => {
                self.teleport_sequence = data.teleport_sequence;
                return true;
            }
            GameMessage::PrivateUpdateAttribute(data) => {
                let UpdateAttribute {
                    attribute,
                    ranks,
                    start,
                    xp,
                    ..
                } = &**data;
                if let Some(attr_type) = stats::AttributeType::from_repr(*attribute) {
                    let base = start + ranks;
                    let mult = self.get_attribute_multiplier(attr_type);
                    let add = self.get_attribute_additive(attr_type);
                    let current = ((base as f32 * mult) + add).round() as u32;

                    let attr_obj = stats::Attribute {
                        attr_type,
                        ranks: *ranks,
                        start: *start,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| t.get_next_attribute_rank_xp(*ranks)),
                        base,
                        current,
                    };

                    self.attributes.insert(attr_type, attr_obj.clone());

                    events.push(WorldEvent::AttributeUpdated(attr_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::PublicUpdateAttribute(data) => {
                let UpdateAttribute {
                    attribute,
                    ranks,
                    start,
                    xp,
                    ..
                } = &**data;
                if let Some(attr_type) = stats::AttributeType::from_repr(*attribute) {
                    let base = start + ranks;
                    let mult = self.get_attribute_multiplier(attr_type);
                    let add = self.get_attribute_additive(attr_type);
                    let current = ((base as f32 * mult) + add).round() as u32;

                    let attr_obj = stats::Attribute {
                        attr_type,
                        ranks: *ranks,
                        start: *start,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| t.get_next_attribute_rank_xp(*ranks)),
                        base,
                        current,
                    };

                    self.attributes.insert(attr_type, attr_obj.clone());

                    events.push(WorldEvent::AttributeUpdated(attr_obj));

                    self.emit_derived_stats(events);
                    return true;
                }
            }
            GameMessage::PrivateUpdateSkill(data) => {
                let UpdateSkill {
                    skill,
                    ranks,
                    status,
                    init,
                    xp,
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
                        ranks: *ranks,
                        init: *init,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| {
                            t.get_next_skill_rank_xp(
                                *ranks,
                                training == stats::TrainingLevel::Specialized,
                            )
                        }),
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
            GameMessage::PublicUpdateSkill(data) => {
                let UpdateSkill {
                    skill,
                    ranks,
                    status,
                    init,
                    xp,
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
                        ranks: *ranks,
                        init: *init,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| {
                            t.get_next_skill_rank_xp(
                                *ranks,
                                training == stats::TrainingLevel::Specialized,
                            )
                        }),
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
            GameMessage::PrivateUpdateVital(data) => {
                let UpdateVital {
                    vital,
                    ranks,
                    start,
                    current,
                    xp,
                    ..
                } = &**data;
                if let Some(vital_type) = stats::VitalType::from_id(*vital) {
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
                        ranks: *ranks,
                        start: *start,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| t.get_next_vital_rank_xp(*ranks)),
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
            GameMessage::PublicUpdateVital(data) => {
                let UpdateVital {
                    vital,
                    ranks,
                    start,
                    current,
                    xp,
                    ..
                } = &**data;
                if let Some(vital_type) = stats::VitalType::from_id(*vital) {
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
                        ranks: *ranks,
                        start: *start,
                        spent_xp: *xp,
                        next_rank_xp: xp_table.and_then(|t| t.get_next_vital_rank_xp(*ranks)),
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
            GameMessage::PrivateUpdateVitalCurrent(data) => {
                let UpdateVitalCurrent { vital, current, .. } = &**data;
                if let Some(vital_type) = stats::VitalType::from_id(*vital)
                    && let Some(vital_obj) = self.vitals.get_mut(&vital_type)
                {
                    vital_obj.current = *current;
                    events.push(WorldEvent::VitalUpdated(vital_obj.clone()));
                    return true;
                }
            }
            GameMessage::GameEvent(ev) => {
                return match &ev.event {
                    GameEvent::MagicUpdateEnchantment(data) => {
                        let MagicUpdateEnchantmentData {
                            target,
                            enchantment,
                            ..
                        } = &**data;
                        if *target == self.guid {
                            if let Some(existing) = self.enchantments.iter_mut().find(|e| {
                                e.spell_id == enchantment.spell_id && e.layer == enchantment.layer
                            }) {
                                *existing = *enchantment;
                            } else {
                                self.enchantments.push(*enchantment);
                            }
                            events.push(WorldEvent::EnchantmentUpdated {
                                enchantment: *enchantment,
                                spell_name: None,
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicUpdateMultipleEnchantments(data) => {
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
                                    *existing = *enchantment;
                                } else {
                                    self.enchantments.push(*enchantment);
                                }
                                events.push(WorldEvent::EnchantmentUpdated {
                                    enchantment: *enchantment,
                                    spell_name: None,
                                });
                            }
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicRemoveEnchantment(data) => {
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
                    GameEvent::MagicRemoveMultipleEnchantments(data) => {
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
                    GameEvent::MagicDispelEnchantment(data) => {
                        let MagicDispelEnchantmentData {
                            target,
                            spell_id,
                            layer,
                            ..
                        } = &**data;
                        if *target == self.guid {
                            self.enchantments
                                .retain(|e| e.spell_id != *spell_id || e.layer != *layer);
                            events.push(WorldEvent::EnchantmentDispelled {
                                spell_id: *spell_id,
                                layer: *layer,
                            });
                            self.emit_derived_stats(events);
                            true
                        } else {
                            false
                        }
                    }
                    GameEvent::MagicDispelMultipleEnchantments(data) => {
                        let MagicDispelMultipleEnchantmentsData { target, spells, .. } = &**data;
                        if *target == self.guid {
                            for (spell_id, layer) in spells {
                                self.enchantments
                                    .retain(|e| e.spell_id != *spell_id || e.layer != *layer);
                                events.push(WorldEvent::EnchantmentDispelled {
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
                    GameEvent::MagicPurgeEnchantments(data) => {
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
                    GameEvent::MagicPurgeBadEnchantments(data) => {
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
                    GameEvent::MagicUpdateSpell(data) => {
                        let spell_id = data.spell_id as u32;
                        self.spells.insert(spell_id, 0.0);
                        events.push(WorldEvent::SpellUpdated { spell_id });
                        true
                    }
                    GameEvent::MagicRemoveSpell(data) => {
                        let spell_id = data.spell_id as u32;
                        self.spells.remove(&spell_id);
                        events.push(WorldEvent::SpellRemoved { spell_id });
                        true
                    }
                    GameEvent::UpdateHealth(data) => {
                        let UpdateHealthData { target, health } = &**data;
                        let target_guid = if *target == Guid::NULL {
                            self.guid
                        } else {
                            *target
                        };

                        if target_guid == self.guid
                            && target_guid != Guid::NULL
                            && let Some(vital_obj) = self.vitals.get_mut(&stats::VitalType::Health)
                        {
                            // UpdateHealth is a percentage float (0.0 to 1.0)
                            let new_current = (*health * vital_obj.buffed_max as f32) as u32;
                            vital_obj.current = new_current;
                            events.push(WorldEvent::VitalUpdated(vital_obj.clone()));
                            true
                        } else {
                            false
                        }
                    }
                    _ => false,
                };
            }
            _ => {}
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set_attr(player: &mut PlayerState, attr: stats::AttributeType, val: u32) {
        player.attributes.insert(
            attr,
            stats::Attribute {
                attr_type: attr,
                ranks: 0,
                start: val,
                spent_xp: 0,
                next_rank_xp: None,
                base: val,
                current: val,
            },
        );
    }

    #[test]
    fn test_stat_calculations() {
        let mut player = PlayerState::new();

        // Setup attributes
        set_attr(&mut player, stats::AttributeType::StrengthAttr, 100);
        set_attr(&mut player, stats::AttributeType::EnduranceAttr, 100);
        set_attr(&mut player, stats::AttributeType::QuicknessAttr, 100);
        set_attr(&mut player, stats::AttributeType::CoordinationAttr, 100);
        set_attr(&mut player, stats::AttributeType::FocusAttr, 100);
        set_attr(&mut player, stats::AttributeType::SelfAttr, 100);

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
        set_attr(&mut player, stats::AttributeType::StrengthAttr, 100);
        set_attr(&mut player, stats::AttributeType::CoordinationAttr, 100);

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
        set_attr(&mut player, stats::AttributeType::EnduranceAttr, 101);
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
        use crate::world::WorldEvent;
        use holtburger_common::Vector3;
        use holtburger_protocol::messages::GameMessage;
        use holtburger_protocol::messages::VectorUpdateData;

        let mut player = PlayerState::new();
        player.guid = Guid(0x50000001);

        let data = VectorUpdateData {
            guid: Guid(0x50000001),
            velocity: Vector3::new(1.0, 2.0, 3.0),
            omega: Vector3::new(0.1, 0.2, 0.3),
            instance_sequence: 123,
            vector_sequence: 456,
        };

        let msg = GameMessage::VectorUpdate(Box::new(data));
        let mut events = Vec::new();
        let handled = player.handle_message(&msg, &mut events, None);

        assert!(handled);
        assert_eq!(events.len(), 1);
        if let WorldEvent::EntityVectorUpdated {
            guid,
            velocity,
            omega,
        } = &events[0]
        {
            assert_eq!(*guid, Guid(0x50000001));
            assert_eq!(velocity.x, 1.0);
            assert_eq!(omega.x, 0.1);
        } else {
            panic!("Expected EntityVectorUpdated event");
        }
    }

    #[test]
    fn test_heal_command_updates() {
        use holtburger_protocol::messages::{
            GameMessage, PrivateUpdateVitalCurrentData, PrivateUpdateVitalData,
        };

        let mut player = PlayerState::new();
        player.guid = Guid(0x50000001);

        // 1. Initial login: PrivateUpdateVital for Health (ID 1), Stamina (ID 3), Mana (ID 5)
        let vitals_to_init = [(1, "Health"), (3, "Stamina"), (5, "Mana")];
        for (id, _name) in vitals_to_init {
            let msg = GameMessage::PrivateUpdateVital(Box::new(PrivateUpdateVitalData {
                sequence: 1,
                object_guid: None,
                vital: id,
                ranks: 0,
                start: 100,
                xp: 0,
                current: 50,
            }));
            player.handle_message(&msg, &mut Vec::new(), None);
        }

        // Verify they are in the map
        assert!(player.vitals.contains_key(&stats::VitalType::Health));
        assert!(player.vitals.contains_key(&stats::VitalType::Stamina));
        assert!(player.vitals.contains_key(&stats::VitalType::Mana));

        // 2. Simulate @heal: PrivateUpdateVitalCurrent for Health (ID 2), Stamina (ID 4), Mana (ID 6)
        let heal_updates = [(2, 100), (4, 100), (6, 100)];
        for (id, val) in heal_updates {
            let msg =
                GameMessage::PrivateUpdateVitalCurrent(Box::new(PrivateUpdateVitalCurrentData {
                    sequence: 2,
                    object_guid: None,
                    vital: id,
                    current: val,
                }));
            let mut events = Vec::new();
            let handled = player.handle_message(&msg, &mut events, None);
            assert!(handled, "Failed to handle vital update for ID {}", id);
            assert_eq!(events.len(), 1);
        }

        // 3. Verify final state
        assert_eq!(
            player
                .vitals
                .get(&stats::VitalType::Health)
                .unwrap()
                .current,
            100
        );
        assert_eq!(
            player
                .vitals
                .get(&stats::VitalType::Stamina)
                .unwrap()
                .current,
            100
        );
        assert_eq!(
            player.vitals.get(&stats::VitalType::Mana).unwrap().current,
            100
        );
    }
}
