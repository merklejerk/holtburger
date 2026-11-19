pub mod creature;
mod item;
pub mod item_details;
#[cfg(test)]
mod tests;
pub mod types;

pub use holtburger_common::stats::{AttributeType, TrainingLevel};
pub(crate) use item::GEAR_RATING_PROPERTIES;
pub use item::{
    ActivationTraining, EquipmentSetInfo, GearRating, GearRatingKind, GemInfo, ItemAttribution,
    ItemLifetime, ManaStoneInfo, PortalLevelLimits, PortalMaximumLevel, RemainingLifetime,
    SkillActivationRequirement,
};

pub use creature::{
    CharacterAllegianceRank, CharacterDetails, CreatureAttributesAndVitals, CreatureIdentity,
    CreatureInspection, CreatureInspectionAttributes, CreatureRatings, PlayerKillerClassification,
    VitalRange, character_title,
};
pub(crate) use item_details::decode_item_spell_book;
pub use item_details::{
    BondedStatus, CapacityInfo, CountInfo, DamageRangeInfo, Effect, InscriptionInfo,
    InspectionSpell, InspectionSpellRole, InspectionUseEffect, ItemCoverageRegion, ItemInspection,
    ItemInspectionArtwork, ItemManaKind, ItemStatus, LockpickingInfo, ManaInfo, MaterialInfo,
    PortalRestriction, Protections, TinkeringInfo, UseRequirement, WeaponInfo, WieldRequirement,
    WieldRequirementType,
};
pub use types::{
    ArmorCoverage, ArmorCoverageValue, Bonus, BonusKind, EnchantedValue, EnchantmentPolarity,
    HeritageGroup, InspectionSupplement, SecondaryAttribute,
};

use crate::entity::Entity;
use crate::vendor::CoreVendorItem;
use holtburger_common::Guid;
use holtburger_common::properties::{
    HasProperties, ObjectDescriptionFlag, PropertyInt, PropertyString, WorldObjectExt as _,
    WorldObjectProperties, WorldObjectPropertyAccessors,
};
use holtburger_content::CharacterTitleCatalog;
use holtburger_protocol::messages::object::types::{
    ArmorProfile, CreatureProfile, HookProfile, WeaponProfile,
};

/// Borrowed entity/vendor surface shared by semantic inspection and TUI diagnostics.
#[derive(Debug, Clone, Copy)]
pub struct InspectionSource<'a> {
    /// Runtime object identity.
    pub guid: Guid,
    /// Static template identity when known.
    pub wcid: Option<u32>,
    /// Complete retained property tables.
    pub properties: &'a WorldObjectProperties,
    /// Facts retained from exactly one successful appraisal response.
    pub supplement: Option<&'a InspectionSupplement>,
    /// Live public-description flags used for semantics that retail does not read from appraisal properties.
    pub public_flags: ObjectDescriptionFlag,
    /// Display average resolved from appraised totals or separately retained public evidence.
    pub display_workmanship: Option<f64>,
    /// Hooked-item classification supplied by appraisal, including healing-kit semantics.
    pub hook_profile: Option<&'a HookProfile>,
    /// Appraised armor protection profile.
    pub armor_profile: Option<&'a ArmorProfile>,
    /// Appraised creature health and optional attribute profile.
    pub creature_profile: Option<&'a CreatureProfile>,
    /// Appraised weapon profile, intentionally absent for casters.
    pub weapon_profile: Option<&'a WeaponProfile>,
    /// Ordered raw appraisal spell IDs, including the active-enchantment marker.
    pub spell_book: &'a [u32],
    /// Per-stat armor enchantment presence supplied by the appraisal response.
    pub armor_highlight: Option<u16>,
    /// Beneficial armor enchantments among `armor_highlight`.
    pub armor_color: Option<u16>,
    /// Per-stat weapon enchantment presence supplied by the appraisal response.
    pub weapon_highlight: Option<u16>,
    /// Beneficial weapon enchantments among `weapon_highlight`.
    pub weapon_color: Option<u16>,
    /// Per-stat resistance enchantment presence supplied by the appraisal response.
    pub resist_highlight: Option<u16>,
    /// Beneficial resistance enchantments among `resist_highlight`.
    pub resist_color: Option<u16>,
}

/// Shared static reference data required to turn retained entity facts into an inspection.
#[derive(Debug, Clone, Copy)]
pub struct InspectionContext<'a> {
    character_titles: &'a CharacterTitleCatalog,
}

impl<'a> InspectionContext<'a> {
    pub fn new(character_titles: &'a CharacterTitleCatalog) -> Self {
        Self { character_titles }
    }
}

impl<'a> InspectionSource<'a> {
    pub fn from_entity(entity: &'a Entity) -> Self {
        Self {
            guid: entity.guid,
            wcid: entity.wcid,
            properties: &entity.properties,
            supplement: entity.inspection_supplement.as_ref(),
            public_flags: entity.flags,
            display_workmanship: entity.display_workmanship(),
            hook_profile: entity.hook_profile.as_ref(),
            armor_profile: entity.armor_profile.as_ref(),
            creature_profile: entity.creature_profile.as_ref(),
            weapon_profile: entity.weapon_profile.as_ref(),
            spell_book: &entity.spell_book,
            armor_highlight: entity.armor_highlight,
            armor_color: entity.armor_color,
            weapon_highlight: entity.weapon_highlight,
            weapon_color: entity.weapon_color,
            resist_highlight: entity.resist_highlight,
            resist_color: entity.resist_color,
        }
    }

    pub fn from_vendor_item(item: &'a CoreVendorItem) -> Self {
        Self {
            guid: item.guid,
            wcid: Some(item.wcid),
            properties: &item.properties,
            supplement: item.inspection_supplement.as_ref(),
            public_flags: item.public_flags,
            display_workmanship: item
                .effective_workmanship()
                .or(item.public_workmanship.map(f64::from)),
            hook_profile: item.hook_profile.as_ref(),
            armor_profile: item.armor_profile.as_ref(),
            creature_profile: item.creature_profile.as_ref(),
            weapon_profile: item.weapon_profile.as_ref(),
            spell_book: &item.spell_book,
            armor_highlight: item.armor_highlight,
            armor_color: item.armor_color,
            weapon_highlight: item.weapon_highlight,
            weapon_color: item.weapon_color,
            resist_highlight: item.resist_highlight,
            resist_color: item.resist_color,
        }
    }
}

impl HasProperties for InspectionSource<'_> {
    fn properties(&self) -> &WorldObjectProperties {
        self.properties
    }
}

/// Immutable, world-derived result of successfully examining one object.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectInspection {
    /// Examined object identity and response-correlation key.
    pub guid: holtburger_common::Guid,
    /// Server-authored display name retained by the merged world object.
    pub name: String,
    /// Appraised long description, falling back to the appraised short description.
    pub description: Option<String>,
    /// Appraised level, absent when the server did not disclose one.
    pub level: Option<u32>,
    /// Subject-specific facts; item-only facts cannot occur on a creature.
    pub details: ObjectInspectionDetails,
}

/// Cold result of one server identify response after world resolution and merge.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectInspectionResult {
    /// Response target used by frontend latest-request filtering.
    pub guid: Guid,
    /// Complete and mutually exclusive result classification.
    pub outcome: ObjectInspectionOutcome,
}

/// Semantic outcomes that must remain distinct at presentation boundaries.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ObjectInspectionOutcome {
    /// Successfully merged and populated immutable inspection snapshot.
    Ready { inspection: Box<ObjectInspection> },
    /// Known target for which the server rejected appraisal.
    Rejected,
    /// Response target no longer resolves to an entity or vendor item.
    Missing,
    /// Appraisal succeeded, but its disclosed facts cannot be interpreted by this client.
    Unavailable {
        /// Concrete local failure, distinct from a server appraisal rejection.
        reason: String,
    },
}

impl From<Result<ObjectInspection, ObjectInspectionError>> for ObjectInspectionOutcome {
    fn from(result: Result<ObjectInspection, ObjectInspectionError>) -> Self {
        match result {
            Ok(inspection) => Self::Ready {
                inspection: Box::new(inspection),
            },
            Err(error) => Self::Unavailable {
                reason: error.to_string(),
            },
        }
    }
}

/// Subject-specific inspection facts selected once by the authoritative world layer.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", content = "details", rename_all = "lowercase")]
pub enum ObjectInspectionDetails {
    /// Object and inventory-item presentation, selected when the appraisal omits a creature profile.
    Item(Box<ItemInspection>),
    /// Creature presentation, including players in the first slice.
    Creature(Box<CreatureInspection>),
}

/// Failure to populate a semantically valid inspection from retained world facts.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ObjectInspectionError {
    /// A disclosed healing-kit multiplier cannot be represented consistently by both clients.
    #[error("item {guid} has a non-finite healing-kit restoration multiplier")]
    NonFiniteHealingKitRestorationMultiplier {
        /// Identity of the item whose disclosed multiplier is invalid.
        guid: Guid,
    },
    /// A disclosed mana recovery efficiency is not a finite number.
    #[error("item {guid} has a non-finite mana-stone efficiency")]
    NonFiniteManaStoneEfficiency {
        /// Identity of the item whose disclosed efficiency is invalid.
        guid: Guid,
    },
    /// A disclosed stone destruction probability is not a finite number.
    #[error("item {guid} has a non-finite mana-stone destruction chance")]
    NonFiniteManaStoneDestructionChance {
        /// Identity of the item whose disclosed probability is invalid.
        guid: Guid,
    },
    /// A disclosed boost targets neither a current vital nor the explicit undefined value.
    #[error("item {guid} has invalid booster vital {value}")]
    InvalidBoosterVital {
        /// Identity of the item whose boost could not be interpreted.
        guid: Guid,
        /// Uninterpretable secondary-attribute identifier.
        value: i32,
    },
    /// A disclosed augmentation cost cannot consume a negative amount of player XP.
    #[error("item {guid} has negative augmentation XP cost {value}")]
    NegativeAugmentationCost {
        /// Identity of the item whose cost is invalid.
        guid: Guid,
        /// Invalid server-disclosed cost.
        value: i64,
    },
    /// Disclosed item progression cannot be interpreted safely.
    #[error("item {guid} has invalid progression: {source}")]
    ItemProgression {
        /// Identity of the item whose appraisal could not be populated.
        guid: Guid,
        /// Precise progression failure retained for the unavailable outcome.
        source: crate::item_progression::ItemProgressionError,
    },
    /// A player appraisal has not yet supplied the creature profile required by its presentation.
    #[error("player {guid} has no appraised creature profile")]
    MissingPlayerCreatureProfile { guid: holtburger_common::Guid },
}

impl ObjectInspection {
    /// Populate one immutable semantic snapshot from the successfully merged world object.
    pub fn from_object(
        object: &InspectionSource<'_>,
        context: InspectionContext<'_>,
    ) -> Result<Self, ObjectInspectionError> {
        let details = if object.guid.is_player() {
            if object.creature_profile.is_none() {
                return Err(ObjectInspectionError::MissingPlayerCreatureProfile {
                    guid: object.guid,
                });
            }
            ObjectInspectionDetails::Creature(Box::new(CreatureInspection::from_object(
                object, context,
            )))
        } else if object.creature_profile.is_some() {
            ObjectInspectionDetails::Creature(Box::new(CreatureInspection::from_object(
                object, context,
            )))
        } else {
            ObjectInspectionDetails::Item(Box::new(ItemInspection::from_object(object)?))
        };

        Ok(Self {
            guid: object.guid,
            name: object.name().to_string(),
            description: object
                .get_string_prop(PropertyString::LongDesc)
                .or_else(|| object.get_string_prop(PropertyString::ShortDesc))
                .map(|s| s.to_string()),
            level: object
                .get_int_prop(PropertyInt::Level)
                .and_then(|value| u32::try_from(value).ok()),
            details,
        })
    }

    pub fn from_entity(
        entity: &Entity,
        context: InspectionContext<'_>,
    ) -> Result<Self, ObjectInspectionError> {
        Self::from_object(&InspectionSource::from_entity(entity), context)
    }

    pub fn from_vendor_item(
        item: &CoreVendorItem,
        context: InspectionContext<'_>,
    ) -> Result<Self, ObjectInspectionError> {
        Self::from_object(&InspectionSource::from_vendor_item(item), context)
    }
}
