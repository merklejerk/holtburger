use super::PlayerState;
use crate::world::WorldEvent;
use crate::world::player::types::LastSentStats;
use crate::world::stats;
use holtburger_common::properties::{EnchantmentTypeFlags, PropertyFloat, PropertyInt};

impl PlayerState {
    pub fn get_attribute_multiplier(&self, attr: stats::AttributeType) -> f32 {
        crate::world::magic::get_enchantment_multiplier(
            &self.enchantments,
            EnchantmentTypeFlags::ATTRIBUTE.bits(),
            attr as u32,
        )
    }

    pub fn get_attribute_additive(&self, attr: stats::AttributeType) -> f32 {
        crate::world::magic::get_enchantment_additive(
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
        crate::world::magic::get_enchantment_multiplier(
            &self.enchantments,
            EnchantmentTypeFlags::SECOND_ATT.bits(),
            vital as u32,
        )
    }

    pub fn get_vital_additive(&self, vital: stats::VitalType) -> f32 {
        crate::world::magic::get_enchantment_additive(
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
        crate::world::magic::get_enchantment_multiplier(
            &self.enchantments,
            EnchantmentTypeFlags::SKILL.bits(),
            skill as u32,
        )
    }

    pub fn get_skill_additive(&self, skill: stats::SkillType) -> f32 {
        crate::world::magic::get_enchantment_additive(
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
        self.armor =
            crate::world::magic::get_enchanted_armor(base_armor, &self.enchantments) as u32;

        // Recalculate Resistances
        let get_r = |prop: PropertyFloat| {
            let base = self
                .float_properties
                .get(&(prop as u32))
                .cloned()
                .unwrap_or(1.0);
            crate::world::magic::get_enchanted_resistance(
                base as f32,
                &self.enchantments,
                prop as u32,
            )
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
        self.vitae = crate::world::magic::get_total_vitae(&self.enchantments);

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

        events.push(WorldEvent::DerivedStatsUpdated(Box::new(
            crate::world::DerivedStatsData {
                attributes: current.attributes,
                vitals: current.vitals,
                skills: current.skills,
                resistances: current.resistances,
                armor: current.armor,
                vitae: current.vitae,
            },
        )));
    }
}
