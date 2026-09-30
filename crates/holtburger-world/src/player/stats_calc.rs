use super::PlayerState;
use crate::enchantments::{
    EnchantmentChannel, EnchantmentKey, EnchantmentOperation, EnchantmentSelection,
};
use crate::stat_breakdown::{
    AttributeBreakdown, AttributeFormulaBreakdown, FormulaAttributeInput, ModifierBreakdown,
    ModifierContribution, SkillBonusContribution, SkillBonusSource, SkillBreakdown,
    SkillFormulaBreakdown, StatFinalization, VitalBreakdown,
};
use crate::stats;
use holtburger_common::properties::EnchantmentTypeFlags;
use holtburger_dat::file_type::skill_table::SkillFormula;
use holtburger_dat::file_type::{SecondaryAttributeTable, SkillTable};

/// Server-owned skill bonuses read from the local player's integer properties.
#[derive(Debug, Clone, Copy, Default)]
pub struct SkillAugmentations {
    /// Luminance augmentation applied to every base skill.
    pub all_skills: u32,
    /// Melee-family base bonus, in ten-point increments.
    pub skilled_melee: u32,
    /// Missile-family base bonus, in ten-point increments.
    pub skilled_missile: u32,
    /// Magic-family base bonus, in ten-point increments.
    pub skilled_magic: u32,
    /// Base bonus for trained and specialized skills.
    pub enlightenment: u32,
    /// Current-only bonus applied after vitae.
    pub jack_of_all_trades: u32,
    /// Current-only bonus for specialized skills.
    pub specialized_luminance: u32,
}

/// Immutable reference data and current player modifiers needed for a skill value.
#[derive(Clone, Copy)]
pub struct SkillCalculationContext<'a> {
    pub table: &'a SkillTable,
    pub augmentations: SkillAugmentations,
    pub vitae: f32,
}

impl SkillAugmentations {
    fn base_bonuses(
        self,
        skill: stats::SkillType,
        training: stats::TrainingLevel,
    ) -> Vec<SkillBonusContribution> {
        use stats::SkillType::*;
        let group = if matches!(
            skill,
            LightWeapons
                | HeavyWeapons
                | FinesseWeapons
                | DualWield
                | TwoHandedCombat
                | Axe
                | Dagger
                | Mace
                | Spear
                | Staff
                | Sword
                | UnarmedCombat
        ) {
            Some((SkillBonusSource::SkilledMelee, self.skilled_melee * 10))
        } else if matches!(
            skill,
            MissileWeapons | Bow | Crossbow | Sling | ThrownWeapon
        ) {
            Some((SkillBonusSource::SkilledMissile, self.skilled_missile * 10))
        } else if matches!(
            skill,
            CreatureEnchantment | ItemEnchantment | LifeMagic | VoidMagic | WarMagic
        ) {
            Some((SkillBonusSource::SkilledMagic, self.skilled_magic * 10))
        } else {
            None
        };
        let mut bonuses = Vec::new();
        push_bonus(&mut bonuses, SkillBonusSource::AllSkills, self.all_skills);
        if let Some((source, value)) = group {
            push_bonus(&mut bonuses, source, value);
        }
        if matches!(
            training,
            stats::TrainingLevel::Trained | stats::TrainingLevel::Specialized
        ) {
            push_bonus(
                &mut bonuses,
                SkillBonusSource::Enlightenment,
                self.enlightenment,
            );
        }
        bonuses
    }

    fn current_bonuses(self, training: stats::TrainingLevel) -> Vec<SkillBonusContribution> {
        let mut bonuses = Vec::new();
        push_bonus(
            &mut bonuses,
            SkillBonusSource::JackOfAllTrades,
            self.jack_of_all_trades * 5,
        );
        if training == stats::TrainingLevel::Specialized {
            push_bonus(
                &mut bonuses,
                SkillBonusSource::SpecializedLuminance,
                self.specialized_luminance * 2,
            );
        }
        bonuses
    }
}

fn push_bonus(bonuses: &mut Vec<SkillBonusContribution>, source: SkillBonusSource, value: u32) {
    if value != 0 {
        bonuses.push(SkillBonusContribution { source, value });
    }
}

fn bonus_total(bonuses: &[SkillBonusContribution]) -> u32 {
    bonuses.iter().map(|bonus| bonus.value).sum()
}

fn finalize(value: f32, minimum: f32) -> StatFinalization {
    let rounded = value.round();
    StatFinalization {
        before_rounding: value,
        rounded,
        minimum,
        result: rounded.max(minimum) as u32,
    }
}

fn modifier_contribution(
    selection: EnchantmentSelection<'_>,
    operation: EnchantmentOperation,
    channel: EnchantmentChannel,
) -> ModifierContribution {
    ModifierContribution {
        operation,
        channel,
        effective: EnchantmentKey::from(selection.effective),
        overridden: selection
            .overridden
            .into_iter()
            .map(EnchantmentKey::from)
            .collect(),
        value: selection.effective.stat_mod_value,
    }
}

impl PlayerState {
    fn direct_modifiers(&self, flags: EnchantmentTypeFlags, key: u32) -> ModifierBreakdown {
        let mut result = ModifierBreakdown::default();
        for operation in [
            EnchantmentOperation::Multiplicative,
            EnchantmentOperation::Additive,
        ] {
            let operation_flag = match operation {
                EnchantmentOperation::Multiplicative => EnchantmentTypeFlags::MULTIPLICATIVE,
                EnchantmentOperation::Additive => EnchantmentTypeFlags::ADDITIVE,
                EnchantmentOperation::Other => unreachable!(),
            };
            for selection in
                self.enchantments
                    .selections_for((flags | operation_flag).bits(), key, true, false)
            {
                let contribution =
                    modifier_contribution(selection, operation, EnchantmentChannel::Ordinary);
                match operation {
                    EnchantmentOperation::Multiplicative => {
                        result.multiplier *= contribution.value;
                    }
                    EnchantmentOperation::Additive => {
                        result.additive += contribution.value;
                    }
                    EnchantmentOperation::Other => unreachable!(),
                }
                result.contributions.push(contribution);
            }
        }
        result
    }

    pub(super) fn evaluate_attribute(
        &self,
        attr: stats::AttributeType,
        base: u32,
    ) -> AttributeBreakdown {
        let modifiers = self.direct_modifiers(EnchantmentTypeFlags::ATTRIBUTE, attr as u32);
        // ACE permits a minimum of one only for characters starting below ten.
        let minimum = if base >= 10 { 10.0 } else { 1.0 };
        let finalization = finalize(
            base as f32 * modifiers.multiplier + modifiers.additive,
            minimum,
        );
        AttributeBreakdown {
            modifiers,
            finalization,
        }
    }

    pub fn get_attribute_multiplier(&self, attr: stats::AttributeType) -> f32 {
        crate::magic::get_enchantment_multiplier(
            &self.enchantments,
            EnchantmentTypeFlags::ATTRIBUTE.bits(),
            attr as u32,
        )
    }

    pub fn get_attribute_additive(&self, attr: stats::AttributeType) -> f32 {
        crate::magic::get_enchantment_additive(
            &self.enchantments,
            EnchantmentTypeFlags::ATTRIBUTE.bits(),
            attr as u32,
        )
    }

    pub fn get_attribute_base(&self, attr: stats::AttributeType) -> u32 {
        self.attributes.get(&attr).map(|a| a.base).unwrap_or(0)
    }

    pub fn get_attribute_current(&self, attr: stats::AttributeType) -> u32 {
        self.evaluate_attribute(attr, self.get_attribute_base(attr))
            .finalization
            .result
    }

    /// Evaluate ACE's attribute formula against base or enchanted primary attributes.
    /// The local portal-table census found only `w=0`, `x=1`, and relevant `y=1`
    /// records; ACE uses `x` as the no-formula gate and sums both named attributes.
    fn evaluate_attribute_formula(
        &self,
        formula: &SkillFormula,
    ) -> Option<AttributeFormulaBreakdown> {
        if formula.x == 0 {
            return None;
        }
        let first = stats::AttributeType::from_repr(formula.attr1)
            .expect("authored formula references an unknown first attribute");
        let second = (formula.attr2 != 0).then(|| {
            stats::AttributeType::from_repr(formula.attr2)
                .expect("authored formula references an unknown second attribute")
        });
        assert_ne!(formula.z, 0, "authored attribute formula has zero divisor");
        let input = |attribute| {
            let base = self.get_attribute_base(attribute);
            let breakdown = self.evaluate_attribute(attribute, base);
            FormulaAttributeInput {
                attribute,
                base,
                effective: breakdown.finalization.result,
                modifiers: breakdown.modifiers.contributions,
            }
        };
        let first = input(first);
        let second = second.map(input);
        let base_sum = first.base + second.as_ref().map_or(0, |input| input.base);
        let effective_sum = first.effective + second.as_ref().map_or(0, |input| input.effective);
        let divisor = formula.z;
        let base_before_rounding = base_sum as f32 / divisor as f32;
        let effective_before_rounding = effective_sum as f32 / divisor as f32;
        Some(AttributeFormulaBreakdown {
            first,
            second,
            divisor,
            base_before_rounding,
            effective_before_rounding,
            base_result: base_before_rounding.round() as u32,
            effective_result: effective_before_rounding.round() as u32,
        })
    }

    fn attribute_formula(&self, formula: &SkillFormula, use_current: bool) -> u32 {
        self.evaluate_attribute_formula(formula)
            .map_or(0, |breakdown| {
                if use_current {
                    breakdown.effective_result
                } else {
                    breakdown.base_result
                }
            })
    }

    pub fn calculate_vital_attribute_contribution(
        &self,
        vital_type: stats::VitalType,
        use_current: bool,
        table: &SecondaryAttributeTable,
    ) -> u32 {
        let formula = match vital_type {
            stats::VitalType::Health => &table.max_health,
            stats::VitalType::Stamina => &table.max_stamina,
            stats::VitalType::Mana => &table.max_mana,
        };
        self.attribute_formula(formula, use_current)
    }

    pub fn get_vital_multiplier(&self, vital: stats::VitalType) -> f32 {
        crate::magic::get_enchantment_multiplier(
            &self.enchantments,
            EnchantmentTypeFlags::SECOND_ATT.bits(),
            vital as u32,
        )
    }

    pub fn get_vital_additive(&self, vital: stats::VitalType) -> f32 {
        crate::magic::get_enchantment_additive(
            &self.enchantments,
            EnchantmentTypeFlags::SECOND_ATT.bits(),
            vital as u32,
        )
    }

    pub fn calculate_vital_base(
        &self,
        vital_type: stats::VitalType,
        table: &SecondaryAttributeTable,
    ) -> u32 {
        self.evaluate_vital(vital_type, table).0
    }

    pub fn calculate_vital_current(
        &self,
        vital_type: stats::VitalType,
        table: &SecondaryAttributeTable,
    ) -> u32 {
        self.evaluate_vital(vital_type, table).1
    }

    pub(super) fn evaluate_vital(
        &self,
        vital_type: stats::VitalType,
        table: &SecondaryAttributeTable,
    ) -> (u32, u32, VitalBreakdown) {
        let base_data = self
            .vital_bases
            .get(&vital_type)
            .cloned()
            .unwrap_or_default();
        let base_no_bonus = base_data.ranks + base_data.start;
        let formula = match vital_type {
            stats::VitalType::Health => &table.max_health,
            stats::VitalType::Stamina => &table.max_stamina,
            stats::VitalType::Mana => &table.max_mana,
        };
        let formula = self.evaluate_attribute_formula(formula);
        let base = base_no_bonus + formula.as_ref().map_or(0, |value| value.base_result);
        let effective_input =
            base_no_bonus + formula.as_ref().map_or(0, |value| value.effective_result);
        let modifiers = self.direct_modifiers(EnchantmentTypeFlags::SECOND_ATT, vital_type as u32);

        // ACE: a creature cannot fall below 5 MaxVital from enchantments / vitae normally,
        // or 1 MaxVital for creatures with very low starting vitals
        let min_vital = if effective_input >= 5 { 5.0 } else { 1.0 };
        let finalization = finalize(
            effective_input as f32 * modifiers.multiplier + modifiers.additive,
            min_vital,
        );
        let buffed_max = finalization.result;
        (
            base,
            buffed_max,
            VitalBreakdown {
                formula,
                modifiers,
                finalization,
            },
        )
    }

    pub fn get_skill_multiplier(&self, skill: stats::SkillType) -> f32 {
        crate::magic::get_enchantment_multiplier(
            &self.enchantments,
            EnchantmentTypeFlags::SKILL.bits(),
            skill as u32,
        )
    }

    pub fn get_skill_additive(&self, skill: stats::SkillType) -> f32 {
        crate::magic::get_enchantment_additive(
            &self.enchantments,
            EnchantmentTypeFlags::SKILL.bits(),
            skill as u32,
        ) + self.enchantments.skill_wide_additive(skill)
    }

    pub fn derive_skill_value(
        &self,
        skill_type: stats::SkillType,
        ranks: u32,
        init: u32,
        training: stats::TrainingLevel,
        use_current: bool,
        context: SkillCalculationContext<'_>,
    ) -> u32 {
        let (base, current, _) = self.evaluate_skill(skill_type, ranks, init, training, context);
        if use_current { current } else { base }
    }

    pub(super) fn evaluate_skill(
        &self,
        skill_type: stats::SkillType,
        ranks: u32,
        init: u32,
        training: stats::TrainingLevel,
        context: SkillCalculationContext<'_>,
    ) -> (u32, u32, SkillBreakdown) {
        let definition = context.table.skill_base_hash.get(&(skill_type as u32));
        let usable = matches!(
            training,
            stats::TrainingLevel::Trained | stats::TrainingLevel::Specialized
        ) || (training == stats::TrainingLevel::Untrained
            && definition.is_some_and(|record| record.min_level == 1));
        let formula = if !usable {
            SkillFormulaBreakdown::Unusable
        } else {
            definition
                .and_then(|record| self.evaluate_attribute_formula(&record.formula))
                .map(SkillFormulaBreakdown::Applied)
                .unwrap_or(SkillFormulaBreakdown::NoFormula)
        };
        let (base_formula, effective_formula) = match &formula {
            SkillFormulaBreakdown::Applied(value) => (value.base_result, value.effective_result),
            SkillFormulaBreakdown::NoFormula | SkillFormulaBreakdown::Unusable => (0, 0),
        };
        let base_bonuses = context.augmentations.base_bonuses(skill_type, training);
        let current_bonuses = context.augmentations.current_bonuses(training);
        let base_bonus = bonus_total(&base_bonuses);
        let current_bonus = bonus_total(&current_bonuses);
        let base = base_formula + ranks + init + base_bonus;
        let effective_input = effective_formula + ranks + init + base_bonus;
        let modifiers = self.direct_modifiers(EnchantmentTypeFlags::SKILL, skill_type as u32);
        let (wide_modifiers, wide_additive_rounded) = self
            .enchantments
            .skill_wide_selections(skill_type)
            .map_or_else(
                || (Vec::new(), 0.0),
                |(channel, selections)| {
                    let contributions: Vec<_> = selections
                        .into_iter()
                        .map(|selection| {
                            modifier_contribution(
                                selection,
                                EnchantmentOperation::Additive,
                                channel,
                            )
                        })
                        .collect();
                    let rounded = contributions
                        .iter()
                        .map(|contribution| contribution.value)
                        .sum::<f32>()
                        .round_ties_even();
                    (contributions, rounded)
                },
            );
        let additive = modifiers.additive + wide_additive_rounded;
        let finalization = finalize(
            effective_input as f32 * modifiers.multiplier * context.vitae
                + current_bonus as f32
                + additive,
            0.0,
        );
        let current = finalization.result;
        (
            base,
            current,
            SkillBreakdown {
                formula,
                base_bonuses,
                current_bonuses,
                vitae: context.vitae,
                modifiers,
                wide_modifiers,
                wide_additive_rounded,
                finalization,
            },
        )
    }

    pub(crate) fn refresh_cached_derived_stat_inputs(
        &mut self,
        skill_context: SkillCalculationContext<'_>,
        secondary_attribute_table: &SecondaryAttributeTable,
    ) {
        // Recalculate Attributes
        let attr_types: Vec<_> = self.attributes.keys().cloned().collect();
        for attr_type in attr_types {
            let base = self.attributes[&attr_type].base;
            let breakdown = self.evaluate_attribute(attr_type, base);
            if let Some(attr) = self.attributes.get_mut(&attr_type) {
                attr.current = breakdown.finalization.result;
                attr.breakdown = breakdown;
            }
        }

        // Recalculate Vitals
        for vital_type in [
            stats::VitalType::Health,
            stats::VitalType::Stamina,
            stats::VitalType::Mana,
        ] {
            let (base, buffed_max, breakdown) =
                self.evaluate_vital(vital_type, secondary_attribute_table);
            if let Some(vital) = self.vitals.get_mut(&vital_type) {
                vital.base = base;
                vital.buffed_max = buffed_max;
                vital.breakdown = breakdown;
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
            let training = self.skills[&skill_type].training;
            let (base_val, current_val, breakdown) = self.evaluate_skill(
                skill_type,
                base_data.ranks,
                base_data.init,
                training,
                skill_context,
            );
            if let Some(skill) = self.skills.get_mut(&skill_type) {
                skill.base = base_val;
                skill.current = current_val;
                skill.breakdown = breakdown;
            }
        }
    }
}
