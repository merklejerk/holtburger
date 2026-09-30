//! Typed inputs retained with player stats so explanations match their calculation.

use crate::enchantments::{EnchantmentChannel, EnchantmentKey, EnchantmentOperation};
use crate::stats::AttributeType;
use serde::{Deserialize, Serialize};

/// One primary attribute read by an authored skill or vital formula.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FormulaAttributeInput {
    /// The primary attribute read by the formula.
    pub attribute: AttributeType,
    /// Unenchanted attribute value.
    pub base: u32,
    /// Enchanted attribute value after its own rounding and floor.
    pub effective: u32,
    /// Direct effects on this primary attribute, inherited through the formula.
    pub modifiers: Vec<ModifierContribution>,
}

/// ACE's supported sum-of-attributes formula, evaluated for both base and current values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AttributeFormulaBreakdown {
    /// First required attribute input.
    pub first: FormulaAttributeInput,
    /// Optional second attribute input.
    pub second: Option<FormulaAttributeInput>,
    /// Authored denominator applied to the sum of inputs.
    pub divisor: u32,
    /// Unrounded quotient from base attribute inputs.
    pub base_before_rounding: f32,
    /// Unrounded quotient from current attribute inputs.
    pub effective_before_rounding: f32,
    /// Rounded contribution from base inputs.
    pub base_result: u32,
    /// Rounded contribution from effective inputs.
    pub effective_result: u32,
}

/// Why an authored skill formula did or did not contribute to this skill.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SkillFormulaBreakdown {
    Applied(AttributeFormulaBreakdown),
    NoFormula,
    Unusable,
}

/// A server-owned bonus source that contributes to a skill's base or current value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SkillBonusSource {
    AllSkills,
    SkilledMelee,
    SkilledMissile,
    SkilledMagic,
    Enlightenment,
    JackOfAllTrades,
    SpecializedLuminance,
}

/// A nonzero bonus whose source and applied value are both explicit.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillBonusContribution {
    /// Server property or augmentation responsible for the bonus.
    pub source: SkillBonusSource,
    /// Applied skill points from that source.
    pub value: u32,
}

/// A spell category's applied modifier and overridden records for this stat query.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModifierContribution {
    /// Additive or multiplicative ACE query that selected this record.
    pub operation: EnchantmentOperation,
    /// Ordinary or skill-wide query channel.
    pub channel: EnchantmentChannel,
    /// Winning enchantment identity.
    pub effective: EnchantmentKey,
    /// Same-category enchantments suppressed by the winner.
    pub overridden: Vec<EnchantmentKey>,
    /// Winning wire modifier value used in arithmetic.
    pub value: f32,
}

/// Direct enchantment effects and their applied aggregate scalar values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModifierBreakdown {
    /// Selected direct modifiers in query order.
    pub contributions: Vec<ModifierContribution>,
    /// Product of selected multiplicative modifiers.
    pub multiplier: f32,
    /// Sum of selected additive modifiers.
    pub additive: f32,
}

impl Default for ModifierBreakdown {
    fn default() -> Self {
        Self {
            contributions: Vec::new(),
            multiplier: 1.0,
            additive: 0.0,
        }
    }
}

/// The exact rounding and lower-bound step used to obtain an effective value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct StatFinalization {
    /// Floating result before ACE's final round operation.
    pub before_rounding: f32,
    /// Result after rounding, before the lower bound.
    pub rounded: f32,
    /// ACE's lower bound for this stat.
    pub minimum: f32,
    /// Effective integer value after the lower bound.
    pub result: u32,
}

/// Attribute base plus direct enchantments; the parent stat carries base/current values.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AttributeBreakdown {
    /// Direct primary-attribute enchantments.
    pub modifiers: ModifierBreakdown,
    /// Rounding and floor applied to the enchanted attribute.
    pub finalization: StatFinalization,
}

/// Vital's authored inherited contribution and direct effects on its maximum.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct VitalBreakdown {
    /// Authored inherited contribution, absent when the formula is gated off.
    pub formula: Option<AttributeFormulaBreakdown>,
    /// Direct maximum-vital enchantments.
    pub modifiers: ModifierBreakdown,
    /// Rounding and floor applied to the enchanted maximum.
    pub finalization: StatFinalization,
}

/// Skill's authored input, augmentation bonuses, vitae, and direct/wide effects.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillBreakdown {
    /// Authored formula outcome and usability gate.
    pub formula: SkillFormulaBreakdown,
    /// Bonuses added before direct multipliers and vitae.
    pub base_bonuses: Vec<SkillBonusContribution>,
    /// Bonuses added after multipliers and vitae.
    pub current_bonuses: Vec<SkillBonusContribution>,
    /// Current vitae multiplier.
    pub vitae: f32,
    /// Direct skill enchantments.
    pub modifiers: ModifierBreakdown,
    /// Attack- or defense-wide additive enchantments.
    pub wide_modifiers: Vec<ModifierContribution>,
    /// ACE's tie-to-even rounded sum of wide modifiers.
    pub wide_additive_rounded: f32,
    /// Rounding and zero floor applied to the effective skill.
    pub finalization: StatFinalization,
}

impl Default for SkillBreakdown {
    fn default() -> Self {
        Self {
            formula: SkillFormulaBreakdown::NoFormula,
            base_bonuses: Vec::new(),
            current_bonuses: Vec::new(),
            vitae: 1.0,
            modifiers: ModifierBreakdown::default(),
            wide_modifiers: Vec::new(),
            wide_additive_rounded: 0.0,
            finalization: StatFinalization::default(),
        }
    }
}
