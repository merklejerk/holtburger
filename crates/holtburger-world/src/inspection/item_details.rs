//! Item, weapon, armor, portal, lockpicking, and spell inspection projection.

use holtburger_common::Guid;
use holtburger_common::properties::{
    AttackType, AttunedStatus, DamageType, ImbuedEffectType, ItemType, MaterialType,
    ObjectDescriptionFlag, PropertyBool, PropertyDataId, PropertyFloat, PropertyInt, PropertyInt64,
    PropertyString, WeaponType, WorldObjectExt as _, WorldObjectProperties,
    WorldObjectPropertyAccessors,
};
use holtburger_common::stats::{AttributeType, CreatureType, SkillType, TrainingLevel, VitalType};
use strum_macros::{Display, FromRepr};

use super::item::{
    EquipmentSetInfo, GearRating, GemInfo, ItemAttribution, ItemLifetime, ManaStoneInfo,
    PortalLevelLimits, SkillActivationRequirement, get_use_requirements,
};
use super::types::{
    Bonus, BonusKind, EnchantedValue, HeritageGroup, SecondaryAttribute, enchanted_value, mask_has,
};
use super::{InspectionSource, ObjectInspectionError};
use crate::damage::compute_damage_range;
use crate::entity_facts::{EntityIconAppearance, LockToolFacts, lock_tool_facts};
use crate::magic::calculate_mana_time_left;

/// Facts consumed only by item/object inspection presentations.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInspection {
    /// Unspent player XP consumed by augmentation, absent when undisclosed; transported exactly.
    #[serde(with = "crate::progression::optional_decimal_u64")]
    pub augmentation_cost: Option<u64>,
    /// Authored cooldown definition; live remaining time comes from the player's registry.
    pub cooldown: Option<crate::item_cooldowns::ItemCooldownDefinition>,
    /// Appraised on-use effect, distinguishing direct vital changes from healing-kit bonuses.
    pub use_effect: Option<InspectionUseEffect>,
    /// Earned item level and XP thresholds, absent for items without progression.
    pub progression: Option<crate::item_progression::ItemProgression>,
    /// Complete server-authored inputs for the existing UI icon compositor.
    pub artwork: ItemInspectionArtwork,
    /// Appraised pyreal value; absence remains distinct from zero.
    pub value: Option<u32>,
    /// Appraised burden units.
    pub burden: Option<u32>,
    /// Independently optional item and subcontainer capacity maxima.
    pub capacity: CapacityInfo,
    /// Appraised material and effective workmanship.
    pub material: Option<MaterialInfo>,
    /// Number of successful tinkers, omitted when zero or undisclosed.
    pub tinkering: Option<TinkeringInfo>,
    /// Item spellcraft difficulty.
    pub spellcraft: Option<i32>,
    /// Current item mana and independently optional maximum/lifetime.
    pub mana: Option<ManaInfo>,
    /// Independently optional item-state facts.
    pub status: ItemStatus,
    /// Latest server appraisal of a currently locked object.
    pub lockpicking: Option<LockpickingInfo>,
    /// Public tool identity and authored template bonus, shared with inventory facts.
    pub lock_tool: Option<LockToolFacts>,
    /// Stack count and maximum when the item is stackable.
    pub stack: Option<CountInfo>,
    /// Remaining and maximum structure/uses.
    pub uses: Option<CountInfo>,
    /// Mechanically covered body regions in retail appraisal order, with clothing layers merged.
    pub coverage: Vec<ItemCoverageRegion>,
    /// Effective armor level.
    pub armor: Option<EnchantedValue<i32>>,
    /// Weapon facts, including caster shapes with no disclosed speed.
    pub weapon: Option<WeaponInfo>,
    /// Eight appraised armor protection modifiers.
    pub protections: Option<Protections>,
    /// Typed item modifiers whose units are owned by their kind.
    pub bonuses: Vec<Bonus>,
    /// Disclosed wield requirements, including heritage and owner restrictions.
    pub wield_requirements: Vec<WieldRequirement>,
    /// Disclosed activation skill/training and character-level requirements.
    pub use_requirements: Vec<UseRequirement>,
    /// Disclosed equipment-set membership.
    pub equipment_set: Option<EquipmentSetInfo>,
    /// Item gear ratings, separate from percentage bonuses.
    pub gear_ratings: Vec<GearRating>,
    /// Disclosed portal character-level bounds.
    pub portal_levels: Option<PortalLevelLimits>,
    /// Expiration durations at appraisal time.
    pub lifetime: Option<ItemLifetime>,
    /// Mana-stone efficiency and use risk.
    pub mana_stone: Option<ManaStoneInfo>,
    /// Disclosed embedded gems.
    pub gems: Option<GemInfo>,
    /// Disclosed crafting/modification attribution.
    pub attribution: Option<ItemAttribution>,
    /// Optional player-authored inscription and disclosed scribe.
    pub inscription: Option<InscriptionInfo>,
    /// Direct imbue flags retained without converting them into display strings.
    #[serde(with = "imbued_effect_bits")]
    pub imbued_effects: ImbuedEffectType,
    /// Additional proven special item properties.
    pub effects: Vec<Effect>,
    /// Server-authored portal destination display text, absent when undisclosed.
    pub portal_destination: Option<String>,
    /// Restrictions disclosed by the latest successful appraisal; absence is unknown.
    pub portal_restrictions: Option<Vec<PortalRestriction>>,
    /// Server-authored use text.
    pub use_text: Option<String>,
    /// Appraisal spells classified as ordinary, on-use, triggered, or active enchantments.
    pub spells: Vec<InspectionSpell>,
}

/// Body region protected by an apparel item, independent of its visible model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Display, serde::Serialize, serde::Deserialize)]
pub enum ItemCoverageRegion {
    /// Head.
    Head,
    /// Chest.
    Chest,
    /// Abdomen/groin.
    Abdomen,
    /// Both upper arms.
    #[strum(serialize = "Upper Arms")]
    UpperArms,
    /// Both lower arms.
    #[strum(serialize = "Lower Arms")]
    LowerArms,
    /// Both hands.
    Hands,
    /// Both upper legs.
    #[strum(serialize = "Upper Legs")]
    UpperLegs,
    /// Both lower legs.
    #[strum(serialize = "Lower Legs")]
    LowerLegs,
    /// Both feet.
    Feet,
}

// Retail behavior is to describe ClothingPriority coverage for apparel, merging the
// underwear and outerwear bits for each region. ValidLocations gates the description;
// it does not supply the body regions. Unknown priority bits have no region label.
const ITEM_COVERAGE_FLAGS: [(u32, ItemCoverageRegion); 9] = [
    (0x4000, ItemCoverageRegion::Head),
    (0x0008 | 0x0400, ItemCoverageRegion::Chest),
    (0x0010 | 0x0800, ItemCoverageRegion::Abdomen),
    (0x0020 | 0x1000, ItemCoverageRegion::UpperArms),
    (0x0040 | 0x2000, ItemCoverageRegion::LowerArms),
    (0x8000, ItemCoverageRegion::Hands),
    (0x0002 | 0x0100, ItemCoverageRegion::UpperLegs),
    (0x0004 | 0x0200, ItemCoverageRegion::LowerLegs),
    (0x10000, ItemCoverageRegion::Feet),
];

pub(super) fn item_coverage(object: &InspectionSource<'_>) -> Vec<ItemCoverageRegion> {
    if !object
        .valid_locations()
        .intersects(crate::equipment::APPAREL_LOCATIONS)
    {
        return Vec::new();
    }
    let Some(priority) = object.priority() else {
        return Vec::new();
    };
    ITEM_COVERAGE_FLAGS
        .into_iter()
        .filter_map(|(mask, region)| (priority & mask != 0).then_some(region))
        .collect()
}

/// Portal prohibitions displayed by retail inspection, independent of player eligibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PortalRestriction {
    /// Full player killers cannot enter.
    NoPlayerKillers,
    /// Lite player killers cannot enter.
    NoLitePlayerKillers,
    /// Non-player killers cannot enter.
    NoNonPlayerKillers,
    /// The portal cannot become a recall destination or either portal tie.
    NoRecallOrTie,
    /// The portal cannot be summoned.
    NoSummon,
}

// Retail behavior is that recall and tie deliberately share one prohibition bit in the portal bitmask.
pub(super) const PORTAL_RESTRICTION_FLAGS: [(i32, PortalRestriction); 5] = [
    (0x02, PortalRestriction::NoPlayerKillers),
    (0x04, PortalRestriction::NoLitePlayerKillers),
    (0x08, PortalRestriction::NoNonPlayerKillers),
    (0x20, PortalRestriction::NoRecallOrTie),
    (0x10, PortalRestriction::NoSummon),
];

pub(super) fn portal_restrictions(
    properties: &WorldObjectProperties,
) -> Option<Vec<PortalRestriction>> {
    properties
        .get_int_prop(PropertyInt::PortalBitmask)
        .map(|mask| {
            PORTAL_RESTRICTION_FLAGS
                .into_iter()
                .filter_map(|(flag, restriction)| (mask & flag != 0).then_some(restriction))
                .collect()
        })
}

/// Complete item-artwork identity consumed together by UI icon composition.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInspectionArtwork {
    /// Shared base/overlay/underlay/effect inputs retained from object properties.
    #[serde(flatten)]
    pub appearance: EntityIconAppearance,
    /// Item classification required to interpret retail UI-effect masks.
    pub item_type: u32,
}

/// Independently optional item and subcontainer capacity maxima.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapacityInfo {
    /// Maximum ordinary item slots.
    pub items: Option<u32>,
    /// Maximum subcontainer slots.
    pub containers: Option<u32>,
}

/// Independently disclosed lock facts from one successful server appraisal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LockpickingInfo {
    /// Effective resistance, including server-applied lock enchantments.
    pub difficulty: Option<i32>,
    /// Examiner-specific integer percentage points at appraisal time; not a live prediction.
    pub success_percent: Option<i32>,
}

impl LockpickingInfo {
    pub(super) fn from_properties(properties: &WorldObjectProperties) -> Option<Self> {
        // Retail behavior uses ResistLockpick as a skill bonus when Locked is absent. Only an
        // explicitly locked appraisal establishes difficulty with effective resistance.
        if properties.get_bool_prop_opt(PropertyBool::Locked) != Some(true) {
            return None;
        }
        let difficulty = properties.get_int_prop(PropertyInt::ResistLockpick);
        let success_percent = properties.get_int_prop(PropertyInt::AppraisalLockpickSuccessPercent);
        (difficulty.is_some() || success_percent.is_some()).then_some(Self {
            difficulty,
            success_percent,
        })
    }
}

/// Item status properties for which absence is semantically distinct from `false`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemStatus {
    /// Bonding behavior, absent for objects without a bonded property.
    pub bonded: Option<BondedStatus>,
    /// Attunement behavior, absent for objects without an attuned property.
    pub attuned: Option<AttunedStatus>,
    /// Whether the item is retained on death.
    pub retained: Option<bool>,
    /// Whether a door/container is open.
    pub is_open: Option<bool>,
    /// Whether a door/container is locked.
    pub is_locked: Option<bool>,
    /// Whether a vendor may buy the item.
    pub sellable: Option<bool>,
    /// Whether ivory can be applied.
    pub ivoryable: Option<bool>,
    /// Whether the server discloses that this item can be dyed.
    pub dyeable: Option<bool>,
    /// Whether magic cannot enchant the item, derived from appraised ResistMagic.
    pub unenchantable: Option<bool>,
}

/// Requirements for activating an item, independent of equipping it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "type",
    content = "data",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum UseRequirement {
    /// Current skill threshold and/or training class required for activation.
    Skill {
        /// Skill checked by the server.
        skill: SkillType,
        /// Complete disclosed constraint, including threshold-only requirements.
        requirement: SkillActivationRequirement,
    },
    /// Minimum current primary attribute.
    Attribute {
        /// Attribute checked on the activating character.
        attribute: AttributeType,
        /// Required current value.
        minimum: i32,
    },
    /// Minimum maximum vital value.
    Vital {
        /// Secondary attribute checked by the server.
        vital: SecondaryAttribute,
        /// Required maximum value, not the current depleted value.
        minimum: i32,
    },
    /// Required activating character heritage.
    Heritage {
        /// Required heritage group.
        heritage: HeritageGroup,
    },
    /// Disclosed allegiance rank; does not predict server enforcement.
    AllegianceRank {
        /// Required rank recorded by the item.
        rank: i32,
    },
    /// Disclosed restriction to the original owner.
    Owner {
        /// Disclosed owner name; absent means the original owner is unnamed.
        name: Option<String>,
    },
    /// Minimum character level for activation.
    Level {
        /// Required character level.
        level: i32,
    },
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "type",
    content = "data",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WieldRequirement {
    Skill {
        skill: SkillType,
        difficulty: i32,
    },
    RawSkill {
        skill: SkillType,
        difficulty: i32,
    },
    Attribute {
        attribute: AttributeType,
        difficulty: i32,
    },
    RawAttribute {
        attribute: AttributeType,
        difficulty: i32,
    },
    Vital {
        vital: SecondaryAttribute,
        difficulty: i32,
    },
    RawVital {
        vital: SecondaryAttribute,
        difficulty: i32,
    },
    Level {
        level: i32,
    },
    Training {
        skill: SkillType,
        level: TrainingLevel,
    },
    IntStat {
        property: PropertyInt,
        value: i32,
    },
    BoolStat {
        property: PropertyBool,
        value: bool,
    },
    CreatureType {
        creature_type: CreatureType,
    },
    Heritage {
        heritage: HeritageGroup,
    },
    /// Disclosed restriction to the original owner.
    Owner {
        /// Owner name when disclosed by appraisal.
        name: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InscriptionInfo {
    pub text: String,
    pub scribe: Option<String>,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
pub enum WieldRequirementType {
    Invalid = 0,
    Skill = 1,
    RawSkill = 2,
    Attrib = 3,
    RawAttrib = 4,
    SecondaryAttrib = 5,
    RawSecondaryAttrib = 6,
    Level = 7,
    Training = 8,
    IntStat = 9,
    BoolStat = 10,
    CreatureType = 11,
    HeritageType = 12,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, Display)]
#[serde(
    tag = "type",
    content = "data",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum Effect {
    #[strum(serialize = "Armor Cleaving")]
    ArmorCleaving,
    #[strum(serialize = "Slash Cleaving")]
    SlashCleaving,
    #[strum(serialize = "Pierce Cleaving")]
    PierceCleaving,
    #[strum(serialize = "Bludgeon Cleaving")]
    BludgeonCleaving,
    #[strum(serialize = "Acid Cleaving")]
    AcidCleaving,
    #[strum(serialize = "Cold Cleaving")]
    ColdCleaving,
    #[strum(serialize = "Electric Cleaving")]
    ElectricCleaving,
    #[strum(serialize = "Fire Cleaving")]
    FireCleaving,
    #[strum(serialize = "Nether Cleaving")]
    NetherCleaving,
    #[strum(serialize = "Magic Absorption")]
    MagicAbsorption,
    #[strum(serialize = "Biting Strike")]
    BitingStrike(f64),
    #[strum(serialize = "Crushing Blow")]
    CrushingBlow(f64),
    Slayer {
        creature_type: CreatureType,
        bonus: f64,
    },
    Multistrike,
    Cleaving(i32),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialInfo {
    pub material_type: MaterialType,
    pub workmanship: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TinkeringInfo {
    pub count: i32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManaInfo {
    /// Whether the item presents its reserve as mana or a mana-stone charge.
    pub kind: ItemManaKind,
    pub current: i32,
    pub max: Option<i32>,
    pub seconds_left: Option<f64>,
}

/// User-facing meaning of an item's mana reserve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemManaKind {
    Mana,
    Charge,
}

/// Mutually exclusive on-use semantics, classified once for both inspector presentations.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum InspectionUseEffect {
    /// Direct base points, independent of player ratings and remaining vital capacity.
    VitalChange {
        /// Current vital affected; maximum-vital attribute IDs are not accepted.
        vital: VitalType,
        /// Signed base points: nonnegative restores, negative depletes.
        amount: i32,
    },
    /// Healing-kit modifiers, independently absent when appraisal does not disclose them.
    HealingKit {
        /// Additive healing-skill modifier applied during healer skill checks.
        skill_bonus: Option<i32>,
        /// Authored healing-amount multiplier; retail displays 1.3 as 130%, not +30%.
        restoration_multiplier: Option<f64>,
    },
}

impl InspectionUseEffect {
    // Retail hook flag bit identifying healing-kit behavior.
    pub(super) const HOOK_IS_HEALER: u32 = 0x2;

    fn from_object(object: &InspectionSource<'_>) -> Result<Option<Self>, ObjectInspectionError> {
        // Retail distinguishes healing skill bonuses from vital changes; hooked healer
        // classification is decoded from the hook flags bitmask.
        if object.public_flags.contains(ObjectDescriptionFlag::HEALER)
            || object
                .hook_profile
                .is_some_and(|hook| hook.flags & Self::HOOK_IS_HEALER != 0)
        {
            // Retail shows only disclosed values, with no default multiplier.
            let skill_bonus = object.get_int_prop(PropertyInt::BoostValue);
            let restoration_multiplier = object.get_float_prop(PropertyFloat::HealkitMod);
            // JSON turns non-finite floats into null, which would disguise invalid data as
            // an undisclosed modifier while the TUI still renders the invalid number.
            if restoration_multiplier.is_some_and(|multiplier| !multiplier.is_finite()) {
                return Err(
                    ObjectInspectionError::NonFiniteHealingKitRestorationMultiplier {
                        guid: object.guid,
                    },
                );
            }
            return Ok(
                (skill_bonus.is_some() || restoration_multiplier.is_some()).then_some(
                    Self::HealingKit {
                        skill_bonus,
                        restoration_multiplier,
                    },
                ),
            );
        }
        let (Some(value), Some(amount)) = (
            object.get_int_prop(PropertyInt::BoosterEnum),
            object.get_int_prop(PropertyInt::BoostValue),
        ) else {
            return Ok(None);
        };
        let vital = match value {
            0 => return Ok(None),
            2 => VitalType::Health,
            4 => VitalType::Stamina,
            6 => VitalType::Mana,
            _ => {
                return Err(ObjectInspectionError::InvalidBoosterVital {
                    guid: object.guid,
                    value,
                });
            }
        };
        Ok(Some(Self::VitalChange { vital, amount }))
    }
}

/// Meaning of an appraisal spell, derived once before frontend grouping or cantrip summaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InspectionSpellRole {
    /// Ordinary item spell; the appraisal does not establish an activation trigger.
    Item,
    /// Primary activation spell of food/drink.
    OnUse,
    /// High-bit marker identifies an enchantment currently applied to the item.
    ActiveEnchantment,
    /// Disclosed proc spell activated by a combat trigger.
    Triggered,
}

/// One appraised spell with its activation meaning and wire marker decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionSpell {
    /// Underlying spell-table identifier with bit 31 cleared.
    pub id: u32,
    /// Authoritative grouping consumed by inspection renderers and cantrip summaries.
    pub role: InspectionSpellRole,
}

impl InspectionSpell {
    const ACTIVE_ENCHANTMENT_MASK: u32 = 0x8000_0000;

    fn from_wire_id(value: u32, on_use_spell: Option<u32>, proc_spell: Option<u32>) -> Self {
        let id = value & !Self::ACTIVE_ENCHANTMENT_MASK;
        Self {
            id,
            role: if value & Self::ACTIVE_ENCHANTMENT_MASK != 0 {
                InspectionSpellRole::ActiveEnchantment
            } else if proc_spell == Some(id) {
                InspectionSpellRole::Triggered
            } else if on_use_spell == Some(id) {
                InspectionSpellRole::OnUse
            } else {
                InspectionSpellRole::Item
            },
        }
    }
}

/// Decodes wire spell-book entries using retail's item-spell vs activation-role precedence.
pub(crate) fn decode_item_spell_book<'a>(
    public_flags: ObjectDescriptionFlag,
    spell_id: Option<Guid>,
    proc_spell_id: Option<Guid>,
    spell_book: &'a [u32],
) -> impl Iterator<Item = InspectionSpell> + 'a {
    let on_use_spell = public_flags
        .contains(ObjectDescriptionFlag::FOOD)
        .then(|| spell_id.filter(|id| *id != Guid::NULL).map(|id| id.0))
        .flatten();
    let proc_spell = proc_spell_id.map(|id| id.0);
    spell_book
        .iter()
        .copied()
        .map(move |value| InspectionSpell::from_wire_id(value, on_use_spell, proc_spell))
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Display)]
#[serde(rename_all = "kebab-case")]
pub enum BondedStatus {
    #[strum(serialize = "Destroy")]
    Destroy = -2,
    #[strum(serialize = "Slippery")]
    Slippery = -1,
    #[strum(serialize = "Normal")]
    Normal = 0,
    #[strum(serialize = "Bonded")]
    Bonded = 1,
    // Unused on retail servers
    // #[strum(serialize = "Sticky")]
    // Sticky = 2,
}

impl BondedStatus {
    fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let val = object.get_int_prop(PropertyInt::Bonded)?;
        match val {
            -2 => Some(BondedStatus::Destroy),
            -1 => Some(BondedStatus::Slippery),
            0 => Some(BondedStatus::Normal),
            1 => Some(BondedStatus::Bonded),
            // Unused on retail servers
            // 2 => Some(BondedStatus::Sticky),
            _ => None,
        }
    }
}

/// Presence-aware current and maximum count.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountInfo {
    /// Current count; absent when the producer disclosed only a maximum.
    pub current: Option<u32>,
    /// Disclosed meaningful maximum.
    pub max: u32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponInfo {
    /// Effective damage range and a provable base range when enchanted.
    pub damage: EnchantedValue<DamageRangeInfo>,
    #[serde(with = "damage_type_bits")]
    pub damage_type: DamageType,
    pub weapon_skill: Option<SkillType>,
    /// Weapon time; absent for casters because the server omits their weapon profile.
    pub speed: Option<EnchantedValue<u32>>,
    pub weapon_type: Option<WeaponType>,
}

/// Minimum and maximum damage belong together because variance changes the pair.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DamageRangeInfo {
    /// Minimum damage after variance.
    pub min: f64,
    /// Maximum disclosed damage.
    pub max: f64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Protections {
    pub slashing: EnchantedValue<f32>,
    pub piercing: EnchantedValue<f32>,
    pub bludgeoning: EnchantedValue<f32>,
    pub fire: EnchantedValue<f32>,
    pub cold: EnchantedValue<f32>,
    pub acid: EnchantedValue<f32>,
    pub lightning: EnchantedValue<f32>,
    pub nether: EnchantedValue<f32>,
}

mod imbued_effect_bits {
    use super::ImbuedEffectType;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &ImbuedEffectType, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u32(value.bits())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<ImbuedEffectType, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(ImbuedEffectType::from_bits_retain(u32::deserialize(
            deserializer,
        )?))
    }
}

mod damage_type_bits {
    use super::DamageType;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &DamageType, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u32(value.bits())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<DamageType, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(DamageType::from_bits_retain(u32::deserialize(
            deserializer,
        )?))
    }
}

impl ItemInspection {
    pub(super) fn from_object(
        object: &InspectionSource<'_>,
    ) -> Result<Self, ObjectInspectionError> {
        // Server behavior applies SpellDID on food/drink consumption. Other item spells may be procs
        // or equipment spells, so neither appraisal order nor mere spell presence proves on-use.
        Ok(Self {
            augmentation_cost: object
                .get_int64_prop(PropertyInt64::AugmentationCost)
                .map(|value| {
                    u64::try_from(value).map_err(|_| {
                        ObjectInspectionError::NegativeAugmentationCost {
                            guid: object.guid,
                            value,
                        }
                    })
                })
                .transpose()?,
            cooldown: crate::item_cooldowns::ItemCooldownDefinition::from_properties(object),
            use_effect: InspectionUseEffect::from_object(object)?,
            progression: crate::item_progression::ItemProgression::from_properties(
                object.properties,
            )
            .map_err(|source| ObjectInspectionError::ItemProgression {
                guid: object.guid,
                source,
            })?,
            artwork: ItemInspectionArtwork {
                appearance: EntityIconAppearance::from_properties(object),
                item_type: object.item_type().unwrap_or_default().bits(),
            },
            value: object
                .get_int_prop(PropertyInt::Value)
                .and_then(|value| u32::try_from(value).ok()),
            burden: object.burden(),
            capacity: CapacityInfo {
                items: object.items_capacity(),
                containers: object.containers_capacity(),
            },
            material: MaterialInfo::from_object(object),
            tinkering: TinkeringInfo::from_object(object),
            spellcraft: object.get_int_prop(PropertyInt::ItemSpellcraft),
            mana: ManaInfo::from_object(object),
            status: ItemStatus {
                bonded: BondedStatus::from_object(object),
                attuned: object
                    .get_int_prop(PropertyInt::Attuned)
                    .and_then(|value| AttunedStatus::from_repr(value as u32)),
                retained: object.get_bool_prop_opt(PropertyBool::Retained),
                is_open: object.get_bool_prop_opt(PropertyBool::Open),
                is_locked: object.get_bool_prop_opt(PropertyBool::Locked),
                sellable: object.get_bool_prop_opt(PropertyBool::IsSellable),
                ivoryable: object.get_bool_prop_opt(PropertyBool::Ivoryable),
                dyeable: object.get_bool_prop_opt(PropertyBool::Dyable),
                unenchantable: object
                    .supplement
                    .and_then(|supplement| supplement.equipment_unenchantable),
            },
            lockpicking: object
                .supplement
                .and_then(|supplement| supplement.lockpicking)
                .filter(|_| object.get_bool_prop_opt(PropertyBool::Locked) == Some(true)),
            lock_tool: lock_tool_facts(object.public_flags, object.item_type(), object.wcid),
            stack: CountInfo::stack_from_object(object),
            uses: CountInfo::uses_from_object(object),
            coverage: item_coverage(object),
            armor: object
                .get_int_prop(PropertyInt::ArmorLevel)
                .map(|effective| {
                    enchanted_value(
                        effective,
                        None,
                        object.armor_highlight,
                        object.armor_color,
                        0x1,
                    )
                }),
            weapon: WeaponInfo::from_object(object),
            protections: Protections::from_object(object),
            bonuses: get_bonuses(object),
            wield_requirements: get_wield_requirements(object),
            use_requirements: get_use_requirements(object),
            equipment_set: EquipmentSetInfo::from_object(object),
            gear_ratings: GearRating::from_object(object),
            portal_levels: PortalLevelLimits::from_object(object),
            lifetime: ItemLifetime::from_object(object),
            mana_stone: ManaStoneInfo::from_object(object)?,
            gems: GemInfo::from_object(object),
            attribution: ItemAttribution::from_object(object),
            inscription: InscriptionInfo::from_object(object),
            imbued_effects: get_imbued_effects(object),
            effects: Effect::from_object(object),
            portal_restrictions: object
                .supplement
                .and_then(|supplement| supplement.portal_restrictions.clone()),
            portal_destination: object
                .get_string_prop(PropertyString::AppraisalPortalDestination)
                .map(str::to_owned),
            use_text: object
                .get_string_prop(PropertyString::Use)
                .map(|s| s.to_string()),
            spells: decode_item_spell_book(
                object.public_flags,
                object.spell(),
                object.get_data_prop(PropertyDataId::ProcSpell),
                object.spell_book,
            )
            .collect(),
        })
    }
}

fn get_wield_requirements(object: &InspectionSource<'_>) -> Vec<WieldRequirement> {
    let mut reqs = Vec::new();

    // Regular Wield Requirements
    let configs = [
        (
            PropertyInt::WieldRequirements,
            PropertyInt::WieldSkillType,
            PropertyInt::WieldDifficulty,
        ),
        (
            PropertyInt::WieldRequirements2,
            PropertyInt::WieldSkillType2,
            PropertyInt::WieldDifficulty2,
        ),
        (
            PropertyInt::WieldRequirements3,
            PropertyInt::WieldSkillType3,
            PropertyInt::WieldDifficulty3,
        ),
        (
            PropertyInt::WieldRequirements4,
            PropertyInt::WieldSkillType4,
            PropertyInt::WieldDifficulty4,
        ),
    ];

    for (req_prop, skill_prop, diff_prop) in configs {
        let skill_id = object.get_int_prop(skill_prop).map(|value| value as u32);
        let difficulty = object.get_int_prop(diff_prop);
        let Some(raw_requirement_type) = object.get_int_prop(req_prop) else {
            if skill_id.is_some() || difficulty.is_some() {
                // An absent type means no requirement, even if companion fields remain.
                log::debug!(
                    "object {:?} has wield requirement fields without a type at {req_prop:?}",
                    object.guid
                );
            }
            continue;
        };
        let Some(requirement_type) = WieldRequirementType::from_repr(raw_requirement_type as usize)
        else {
            log::warn!(
                "object {:?} has an unknown wield requirement type {raw_requirement_type} at {req_prop:?}",
                object.guid
            );
            continue;
        };
        if requirement_type == WieldRequirementType::Invalid {
            continue;
        }

        // Server behavior compares creature and heritage requirements against WieldDifficulty; every
        // other typed requirement uses the fields indicated below. Never turn a missing field into zero.
        let requirement = match requirement_type {
            WieldRequirementType::Skill => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    SkillType::from_repr(skill_id)
                        .map(|skill| WieldRequirement::Skill { skill, difficulty })
                })
            }
            WieldRequirementType::RawSkill => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    SkillType::from_repr(skill_id)
                        .map(|skill| WieldRequirement::RawSkill { skill, difficulty })
                })
            }
            WieldRequirementType::Attrib => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    AttributeType::from_repr(skill_id).map(|attribute| {
                        WieldRequirement::Attribute {
                            attribute,
                            difficulty,
                        }
                    })
                })
            }
            WieldRequirementType::RawAttrib => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    AttributeType::from_repr(skill_id).map(|attribute| {
                        WieldRequirement::RawAttribute {
                            attribute,
                            difficulty,
                        }
                    })
                })
            }
            WieldRequirementType::SecondaryAttrib => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    SecondaryAttribute::from_repr(skill_id as usize)
                        .map(|vital| WieldRequirement::Vital { vital, difficulty })
                })
            }
            WieldRequirementType::RawSecondaryAttrib => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    SecondaryAttribute::from_repr(skill_id as usize)
                        .map(|vital| WieldRequirement::RawVital { vital, difficulty })
                })
            }
            WieldRequirementType::Level => {
                difficulty.map(|level| WieldRequirement::Level { level })
            }
            WieldRequirementType::Training => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    SkillType::from_repr(skill_id).and_then(|skill| {
                        u32::try_from(difficulty)
                            .ok()
                            .and_then(TrainingLevel::from_repr)
                            .map(|level| WieldRequirement::Training { skill, level })
                    })
                })
            }
            WieldRequirementType::IntStat => {
                skill_id.zip(difficulty).and_then(|(skill_id, value)| {
                    PropertyInt::from_repr(skill_id)
                        .map(|property| WieldRequirement::IntStat { property, value })
                })
            }
            WieldRequirementType::BoolStat => {
                skill_id.zip(difficulty).and_then(|(skill_id, value)| {
                    PropertyBool::from_repr(skill_id).map(|property| WieldRequirement::BoolStat {
                        property,
                        value: value != 0,
                    })
                })
            }
            WieldRequirementType::CreatureType => difficulty.and_then(|value| {
                CreatureType::from_repr(value as u32)
                    .map(|creature_type| WieldRequirement::CreatureType { creature_type })
            }),
            WieldRequirementType::HeritageType => difficulty.and_then(|value| {
                HeritageGroup::from_repr(value as usize)
                    .map(|heritage| WieldRequirement::Heritage { heritage })
            }),
            WieldRequirementType::Invalid => None,
        };

        if let Some(requirement) = requirement {
            reqs.push(requirement);
        } else {
            log::warn!(
                "object {:?} has a malformed {requirement_type} wield requirement at {req_prop:?}",
                object.guid
            );
        }
    }

    if let Some(heritage) = object
        .get_int_prop(PropertyInt::HeritageSpecificArmor)
        .and_then(|value| HeritageGroup::from_repr(value as usize))
        .filter(|heritage| *heritage != HeritageGroup::Invalid)
    {
        let requirement = WieldRequirement::Heritage { heritage };
        if !reqs.contains(&requirement) {
            reqs.push(requirement);
        }
    }
    if object.get_bool_prop_opt(PropertyBool::AppraisalHasAllowedWielder) == Some(true) {
        reqs.push(WieldRequirement::Owner {
            name: object
                .get_string_prop(PropertyString::CraftsmanName)
                .map(str::to_owned),
        });
    }

    reqs
}

fn get_bonuses(object: &InspectionSource<'_>) -> Vec<Bonus> {
    let mut bonuses = Vec::new();

    let mult_props = [
        (BonusKind::Defense, PropertyFloat::WeaponDefense, Some(0x2)),
        (
            BonusKind::MissileDefense,
            PropertyFloat::WeaponMissileDefense,
            None,
        ),
        (
            BonusKind::MagicDefense,
            PropertyFloat::WeaponMagicDefense,
            None,
        ),
        (
            BonusKind::ElementalDamage,
            PropertyFloat::ElementalDamageMod,
            None,
        ),
    ];

    for (kind, prop, weapon_mask) in mult_props {
        if let Some(val) = get_normalized_multiplier(object, prop) {
            let (highlight, color, mask) = if kind == BonusKind::ElementalDamage {
                (object.resist_highlight, object.resist_color, 0x2000)
            } else {
                (
                    object.weapon_highlight,
                    object.weapon_color,
                    weapon_mask.unwrap_or(0),
                )
            };
            bonuses.push(Bonus {
                kind,
                value: enchanted_value(val, None, highlight, color, mask),
            });
        }
    }

    // Weapon profile carries the effective offense while the property table retains its base.
    if let Some(profile) = object.weapon_profile {
        let effective = profile.weapon_offense - 1.0;
        let base = object
            .get_float_prop(PropertyFloat::WeaponOffense)
            .map(|value| value - 1.0);
        if effective.abs() > f64::EPSILON || base.is_some_and(|value| value.abs() > f64::EPSILON) {
            bonuses.push(Bonus {
                kind: BonusKind::Attack,
                value: enchanted_value(
                    effective,
                    base,
                    object.weapon_highlight,
                    object.weapon_color,
                    0x1,
                ),
            });
        }
    } else if let Some(value) = get_normalized_multiplier(object, PropertyFloat::WeaponOffense) {
        bonuses.push(Bonus {
            kind: BonusKind::Attack,
            value: EnchantedValue {
                effective: value,
                unbuffed: None,
                enchantment: None,
            },
        });
    }

    let mod_props = [
        (BonusKind::ManaConversion, PropertyFloat::ManaConversionMod),
        (
            BonusKind::CriticalFrequency,
            PropertyFloat::CriticalFrequency,
        ),
    ];

    for (kind, prop) in mod_props {
        if let Some(val) = get_nonzero_modifier(object, prop) {
            let mask = match kind {
                BonusKind::ManaConversion => 0x1000,
                _ => 0,
            };
            bonuses.push(Bonus {
                kind,
                value: enchanted_value(
                    val,
                    None,
                    object.resist_highlight,
                    object.resist_color,
                    mask,
                ),
            });
        }
    }

    bonuses
}

impl InscriptionInfo {
    fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let text = object.get_string_prop(PropertyString::Inscription)?;
        let scribe = object
            .get_string_prop(PropertyString::ScribeName)
            .map(|s| s.to_string());

        Some(InscriptionInfo {
            text: text.to_string(),
            scribe,
        })
    }
}

impl MaterialInfo {
    fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let mat_type = object.get_int_prop(PropertyInt::MaterialType)?;
        let workmanship = object.display_workmanship? as f32;

        Some(MaterialInfo {
            material_type: MaterialType::from_repr(mat_type as u32)?,
            workmanship,
        })
    }
}

impl TinkeringInfo {
    fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        object
            .get_int_prop(PropertyInt::NumTimesTinkered)
            .filter(|&t| t > 0)
            .map(|count| TinkeringInfo { count })
    }
}

impl ManaInfo {
    fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let current = object.get_int_prop(PropertyInt::ItemCurMana)?;
        let max = object.get_int_prop(PropertyInt::ItemMaxMana);
        let seconds_left = object
            .get_float_prop(PropertyFloat::ManaRate)
            .and_then(|rate| calculate_mana_time_left(current, rate));

        Some(ManaInfo {
            kind: if object
                .item_type()
                .is_some_and(|item_type| item_type.contains(ItemType::MANA_STONE))
            {
                ItemManaKind::Charge
            } else {
                ItemManaKind::Mana
            },
            current,
            max,
            seconds_left,
        })
    }
}

impl CountInfo {
    fn stack_from_object(object: &InspectionSource<'_>) -> Option<Self> {
        object
            .max_stack_size()
            .filter(|&max| max > 1)
            .map(|max| Self {
                current: object
                    .get_int_prop(PropertyInt::StackSize)
                    .and_then(|value| u32::try_from(value).ok()),
                max,
            })
    }

    fn uses_from_object(object: &InspectionSource<'_>) -> Option<Self> {
        object.max_structure().map(|max| Self {
            current: object.structure(),
            max,
        })
    }
}

impl WeaponInfo {
    fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        if !object.item_type().is_some_and(|it| {
            it.intersects(ItemType::MELEE_WEAPON | ItemType::CASTER | ItemType::MISSILE_WEAPON)
        }) {
            return None;
        }

        let weapon_skill = object
            .get_int_prop(PropertyInt::WeaponSkill)
            .and_then(|skill| SkillType::from_repr(skill as u32))
            .or_else(|| {
                object
                    .weapon_profile
                    .as_ref()
                    .and_then(|profile| SkillType::from_repr(profile.weapon_skill))
            });

        let effective_range = compute_damage_range(
            object
                .weapon_profile
                .map(|profile| profile.damage as i32)
                .or_else(|| object.get_int_prop(PropertyInt::Damage)),
            object
                .weapon_profile
                .map(|profile| profile.damage_variance)
                .or_else(|| object.get_float_prop(PropertyFloat::DamageVariance)),
            object
                .weapon_profile
                .map(|profile| profile.damage_type)
                .or_else(|| {
                    object
                        .get_int_prop(PropertyInt::DamageType)
                        .map(|value| value as u32)
                }),
            object.weapon_profile,
        )?;
        let damage_mask = if mask_has(object.weapon_highlight, 0x8) {
            0x8
        } else {
            0x10
        };
        let unbuffed_range = mask_has(object.weapon_highlight, 0x8 | 0x10)
            .then(|| {
                let damage = object.get_int_prop(PropertyInt::Damage)?;
                let variance = object.get_float_prop(PropertyFloat::DamageVariance)?;
                compute_damage_range(
                    Some(damage),
                    Some(variance),
                    object
                        .get_int_prop(PropertyInt::DamageType)
                        .map(|value| value as u32),
                    None,
                )
                .map(|range| DamageRangeInfo {
                    min: range.min,
                    max: range.max,
                })
            })
            .flatten();

        Some(WeaponInfo {
            damage: enchanted_value(
                DamageRangeInfo {
                    min: effective_range.min,
                    max: effective_range.max,
                },
                unbuffed_range,
                object.weapon_highlight,
                object.weapon_color,
                damage_mask,
            ),
            damage_type: effective_range.damage_type,
            weapon_skill,
            speed: object.weapon_profile.as_ref().map(|profile| {
                enchanted_value(
                    profile.weapon_time,
                    object
                        .get_int_prop(PropertyInt::WeaponTime)
                        .and_then(|value| u32::try_from(value).ok()),
                    object.weapon_highlight,
                    object.weapon_color,
                    0x4,
                )
            }),
            weapon_type: object
                .get_int_prop(PropertyInt::WeaponType)
                .and_then(|w| WeaponType::from_repr(w as u32)),
        })
    }
}

/// Extracts a multiplier-based property (baseline 1.0) and returns it normalized to 0.0.
fn get_normalized_multiplier(object: &InspectionSource<'_>, prop: PropertyFloat) -> Option<f64> {
    object
        .get_float_prop(prop)
        .map(|v| v - 1.0)
        .filter(|&v| v.abs() > f64::EPSILON)
}

/// Extracts a modifier-based property (baseline 0.0) and returns it if it is non-zero.
fn get_nonzero_modifier(object: &InspectionSource<'_>, prop: PropertyFloat) -> Option<f64> {
    object.get_float_prop(prop).filter(|&v| v != 0.0)
}

impl Protections {
    fn from_object(object: &InspectionSource<'_>) -> Option<Self> {
        let ap = object.armor_profile?;
        Some(Protections {
            slashing: protection(object, ap.slashing, PropertyFloat::ArmorModVsSlash, 0x2),
            piercing: protection(object, ap.piercing, PropertyFloat::ArmorModVsPierce, 0x4),
            bludgeoning: protection(
                object,
                ap.bludgeoning,
                PropertyFloat::ArmorModVsBludgeon,
                0x8,
            ),
            fire: protection(object, ap.fire, PropertyFloat::ArmorModVsFire, 0x20),
            cold: protection(object, ap.cold, PropertyFloat::ArmorModVsCold, 0x10),
            acid: protection(object, ap.acid, PropertyFloat::ArmorModVsAcid, 0x40),
            lightning: protection(
                object,
                ap.lightning,
                PropertyFloat::ArmorModVsElectric,
                0x80,
            ),
            // The appraisal armor mask has no Nether bit, so its value cannot be classified.
            nether: EnchantedValue {
                effective: ap.nether,
                unbuffed: None,
                enchantment: None,
            },
        })
    }
}

fn protection(
    object: &InspectionSource<'_>,
    effective: f32,
    property: PropertyFloat,
    mask: u16,
) -> EnchantedValue<f32> {
    enchanted_value(
        effective,
        object.get_float_prop(property).map(|value| value as f32),
        object.armor_highlight,
        object.armor_color,
        mask,
    )
}

impl Effect {
    fn from_object(object: &InspectionSource<'_>) -> Vec<Self> {
        let mut effects = Vec::new();

        // Server behavior treats IgnoreArmor presence as armor cleaving.
        if object.get_float_prop(PropertyFloat::IgnoreArmor).is_some() {
            effects.push(Effect::ArmorCleaving);
        }

        if object
            .get_float_prop(PropertyFloat::ResistanceModifier)
            .is_some()
            && let Some(damage_type) = object
                .get_int_prop(PropertyInt::ResistanceModifierType)
                .map(|bits| DamageType::from_bits_retain(bits as u32))
        {
            for (kind, effect) in [
                (DamageType::SLASH, Effect::SlashCleaving),
                (DamageType::PIERCE, Effect::PierceCleaving),
                (DamageType::BLUDGEON, Effect::BludgeonCleaving),
                (DamageType::ACID, Effect::AcidCleaving),
                (DamageType::COLD, Effect::ColdCleaving),
                (DamageType::ELECTRIC, Effect::ElectricCleaving),
                (DamageType::FIRE, Effect::FireCleaving),
                (DamageType::NETHER, Effect::NetherCleaving),
            ] {
                if damage_type.contains(kind) {
                    effects.push(effect);
                }
            }
        }

        if object
            .get_float_prop(PropertyFloat::AbsorbMagicDamage)
            .is_some_and(|value| value != 0.0)
        {
            effects.push(Effect::MagicAbsorption);
        }

        // Float Properties (Strength attached)
        if let Some(freq) = object.get_float_prop(PropertyFloat::CriticalFrequency)
            && freq > 0.0
        {
            effects.push(Effect::BitingStrike(freq));
        }
        if let Some(mult) = object.get_float_prop(PropertyFloat::CriticalMultiplier)
            && mult > 0.0
        {
            effects.push(Effect::CrushingBlow(mult));
        }
        if let Some(bonus) = object.get_float_prop(PropertyFloat::SlayerDamageBonus)
            && bonus > 0.0
            && let Some(creature_type) = object
                .get_int_prop(PropertyInt::SlayerCreatureType)
                .and_then(|t| CreatureType::from_repr(t as u32))
        {
            effects.push(Effect::Slayer {
                creature_type,
                bonus,
            });
        }

        // Int Properties
        if let Some(at) = object
            .get_int_prop(PropertyInt::AttackType)
            .map(|bits| AttackType::from_bits_truncate(bits as u32))
            && at.intersects(AttackType::DoubleStrike | AttackType::TripleStrike)
        {
            effects.push(Effect::Multistrike);
        }

        if let Some(cleave_targets) = object.get_int_prop(PropertyInt::Cleaving)
            && cleave_targets > 0
        {
            effects.push(Effect::Cleaving(cleave_targets));
        }

        effects
    }
}

fn get_imbued_effects(object: &InspectionSource<'_>) -> ImbuedEffectType {
    let bits = [
        PropertyInt::ImbuedEffect,
        PropertyInt::ImbuedEffect2,
        PropertyInt::ImbuedEffect3,
        PropertyInt::ImbuedEffect4,
        PropertyInt::ImbuedEffect5,
    ]
    .into_iter()
    .filter_map(|p| object.get_int_prop(p))
    .fold(0u32, |acc, val| acc | (val as u32));

    ImbuedEffectType::from_bits_retain(bits)
}
