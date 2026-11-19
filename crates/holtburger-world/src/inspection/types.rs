//! Shared appraisal primitives, enchantment polarity, armor coverage, and bitmask helpers.

use holtburger_common::properties::{
    PropertyInt, WorldObjectProperties, WorldObjectPropertyAccessors,
};
use strum_macros::{Display, FromRepr};

use super::creature::{CharacterDetails, CreatureRatings};
use super::item_details::{LockpickingInfo, PortalRestriction, portal_restrictions};

const UNENCHANTABLE_THRESHOLD: u32 = 9_999;

/// Facts whose absence must replace, rather than inherit from, an older appraisal.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionSupplement {
    /// Portal prohibitions from this response alone, including an explicitly empty set.
    pub portal_restrictions: Option<Vec<PortalRestriction>>,
    /// Lock facts classified from this response alone, never inherited from merged properties.
    pub lockpicking: Option<LockpickingInfo>,
    /// Equipment enchantability derived from the current response's ResistMagic property.
    pub equipment_unenchantable: Option<bool>,
    /// Raw armor-location values decoded into game meaning.
    pub armor_coverage: Option<ArmorCoverage>,
    /// Effective ratings copied only from the current response.
    pub ratings: Option<CreatureRatings>,
    /// Maximum-health bonus copied only from the current response.
    pub max_health_bonus: Option<i32>,
    /// Character facts copied only from the current response.
    pub character_details: Option<CharacterDetails>,
}

impl InspectionSupplement {
    /// Build the replaceable semantic facts from one complete successful response.
    pub(crate) fn from_response(
        properties: &WorldObjectProperties,
        armor_levels: Option<&holtburger_protocol::messages::object::types::ArmorLevels>,
    ) -> Self {
        let ratings = CreatureRatings::from_properties(properties);
        let character_details = CharacterDetails::from_properties(properties);

        Self {
            portal_restrictions: portal_restrictions(properties),
            lockpicking: LockpickingInfo::from_properties(properties),
            equipment_unenchantable: properties
                .get_int_prop(PropertyInt::ResistMagic)
                .map(|value| value >= UNENCHANTABLE_THRESHOLD as i32),
            armor_coverage: armor_levels.map(ArmorCoverage::from_wire),
            ratings: (!ratings.is_empty()).then_some(ratings),
            max_health_bonus: properties.get_int_prop(PropertyInt::GearMaxHealth),
            character_details: (!character_details.is_empty()).then_some(character_details),
        }
    }
}

/// Armor level and collective enchantability for one body location.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorCoverageValue {
    /// Effective armor level with the wire sentinel removed.
    pub level: u32,
    /// Whether the server omitted the all-covering-layers-unenchantable marker.
    pub enchantable: bool,
}

impl ArmorCoverageValue {
    fn from_wire(value: u32) -> Self {
        if value >= UNENCHANTABLE_THRESHOLD {
            Self {
                level: value - UNENCHANTABLE_THRESHOLD,
                enchantable: false,
            }
        } else {
            Self {
                level: value,
                enchantable: true,
            }
        }
    }
}

/// Complete nine-location armor appraisal block.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArmorCoverage {
    /// Head armor level.
    pub head: ArmorCoverageValue,
    /// Chest armor level.
    pub chest: ArmorCoverageValue,
    /// Abdomen/groin armor level.
    pub abdomen: ArmorCoverageValue,
    /// Upper-arm/bicep armor level.
    pub upper_arm: ArmorCoverageValue,
    /// Lower-arm/wrist armor level.
    pub lower_arm: ArmorCoverageValue,
    /// Hand armor level.
    pub hand: ArmorCoverageValue,
    /// Upper-leg/thigh armor level.
    pub upper_leg: ArmorCoverageValue,
    /// Lower-leg/shin armor level.
    pub lower_leg: ArmorCoverageValue,
    /// Foot armor level.
    pub foot: ArmorCoverageValue,
}

impl ArmorCoverage {
    fn from_wire(levels: &holtburger_protocol::messages::object::types::ArmorLevels) -> Self {
        Self {
            head: ArmorCoverageValue::from_wire(levels.head),
            chest: ArmorCoverageValue::from_wire(levels.chest),
            abdomen: ArmorCoverageValue::from_wire(levels.abdomen),
            upper_arm: ArmorCoverageValue::from_wire(levels.upper_arm),
            lower_arm: ArmorCoverageValue::from_wire(levels.lower_arm),
            hand: ArmorCoverageValue::from_wire(levels.hand),
            upper_leg: ArmorCoverageValue::from_wire(levels.upper_leg),
            lower_leg: ArmorCoverageValue::from_wire(levels.lower_leg),
            foot: ArmorCoverageValue::from_wire(levels.foot),
        }
    }
}

/// A typed item modifier and its source-unit value.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bonus {
    /// Determines the label and whether the value is a baseline-one multiplier.
    pub kind: BonusKind,
    /// Normalized multiplier delta or direct modifier, according to `kind`.
    pub value: EnchantedValue<f64>,
}

/// An appraised effective value with authoritative enchantment presentation metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnchantedValue<T> {
    /// Effective value rendered by retail and used by gameplay presentation.
    pub effective: T,
    /// Unenchanted value when the appraisal exposes enough information to prove it.
    pub unbuffed: Option<T>,
    /// Beneficial/harmful classification from the response color mask.
    pub enchantment: Option<EnchantmentPolarity>,
}

/// Retail appraisal color classification for an enchanted value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnchantmentPolarity {
    Beneficial,
    Harmful,
}

/// Semantic item modifier kinds; presentation owns labels and colors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BonusKind {
    Attack,
    Defense,
    MissileDefense,
    MagicDefense,
    ElementalDamage,
    ManaConversion,
    CriticalFrequency,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
#[serde(rename_all = "kebab-case")]
pub enum SecondaryAttribute {
    Undef = 0,
    MaxHealth = 1,
    Health = 2,
    MaxStamina = 3,
    Stamina = 4,
    MaxMana = 5,
    Mana = 6,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
#[serde(rename_all = "kebab-case")]
pub enum HeritageGroup {
    Invalid = 0,
    Aluvian = 1,
    Gharundim = 2,
    Sho = 3,
    Viamontian = 4,
    Shadowbound = 5,
    Gearknight = 6,
    Tumerok = 7,
    Lugian = 8,
    Empyrean = 9,
    Penumbraen = 10,
    Undead = 11,
    Olthoi = 12,
    OlthoiAcid = 13,
}

pub(super) fn enchanted_value<T: Copy>(
    effective: T,
    unbuffed: Option<T>,
    highlight: Option<u16>,
    color: Option<u16>,
    mask: u16,
) -> EnchantedValue<T> {
    let enchantment = mask_has(highlight, mask).then(|| {
        if mask_has(color, mask) {
            EnchantmentPolarity::Beneficial
        } else {
            EnchantmentPolarity::Harmful
        }
    });
    EnchantedValue {
        effective,
        unbuffed: enchantment.and(unbuffed),
        enchantment,
    }
}

pub(super) fn mask_has(bits: Option<u16>, mask: u16) -> bool {
    mask != 0 && bits.is_some_and(|bits| bits & mask != 0)
}
