use crate::damage::compute_damage_range;
use crate::entity::Entity;
use crate::entity_facts::EntityIconAppearance;
use crate::magic::calculate_mana_time_left;
use crate::vendor::CoreVendorItem;
use holtburger_common::Guid;
use holtburger_common::properties::{
    AttackType, AttunedStatus, DamageType, HasProperties, ImbuedEffectType, ItemType, MaterialType,
    ObjectDescriptionFlag, PropertyBool, PropertyFloat, PropertyInt, PropertyString, WeaponType,
    WorldObjectExt as _, WorldObjectProperties, WorldObjectPropertyAccessors,
};
use holtburger_common::stats::{CreatureType, SkillType};
use holtburger_content::CharacterTitleCatalog;
use holtburger_protocol::messages::object::types::{
    ArmorProfile, CreatureBuffs, CreatureProfile, WeaponProfile,
};
use strum_macros::{Display, FromRepr};

/// Borrowed entity/vendor surface shared by semantic inspection and TUI diagnostics.
#[derive(Debug, Clone, Copy)]
pub struct InspectionSource<'a> {
    /// Runtime object identity.
    pub guid: Guid,
    /// Static template identity when known.
    pub wcid: Option<u32>,
    /// Complete retained property tables.
    pub properties: &'a WorldObjectProperties,
    /// Live public-description flags used for semantics that retail does not read from appraisal properties.
    pub public_flags: ObjectDescriptionFlag,
    /// Appraised armor protection profile.
    pub armor_profile: Option<&'a ArmorProfile>,
    /// Appraised creature health and optional attribute profile.
    pub creature_profile: Option<&'a CreatureProfile>,
    /// Appraised weapon profile, intentionally absent for casters.
    pub weapon_profile: Option<&'a WeaponProfile>,
    /// Ordered raw appraisal spell IDs, including ACE's active-enchantment marker.
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
            public_flags: entity.flags,
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
            public_flags: ObjectDescriptionFlag::empty(),
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
    /// A player appraisal has not yet supplied the creature profile required by its presentation.
    #[error("player {guid} has no appraised creature profile")]
    MissingPlayerCreatureProfile { guid: holtburger_common::Guid },
}

/// Facts consumed only by item/object inspection presentations.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInspection {
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
    /// Stack count and maximum when the item is stackable.
    pub stack: Option<CountInfo>,
    /// Remaining and maximum structure/uses.
    pub uses: Option<CountInfo>,
    /// Effective armor level.
    pub armor: Option<EnchantedValue<i32>>,
    /// Weapon facts, including caster shapes with no disclosed speed.
    pub weapon: Option<WeaponInfo>,
    /// Eight appraised armor protection modifiers.
    pub protections: Option<Protections>,
    /// Typed item modifiers whose units are owned by their kind.
    pub bonuses: Vec<Bonus>,
    /// Up to four wield requirements plus the arcane-lore requirement.
    pub wield_requirements: Vec<WieldRequirement>,
    /// Optional player-authored inscription and disclosed scribe.
    pub inscription: Option<InscriptionInfo>,
    /// Direct imbue flags retained without converting them into display strings.
    #[serde(with = "imbued_effect_bits")]
    pub imbued_effects: ImbuedEffectType,
    /// Additional proven special item properties.
    pub effects: Vec<Effect>,
    /// Server-authored use text.
    pub use_text: Option<String>,
    /// Item and active-enchantment spells with the wire marker decoded.
    pub spells: Vec<InspectionSpell>,
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

/// Facts consumed only by creature inspection presentations.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureInspection {
    /// Retail-compatible creature or character-style identity derived once for every frontend.
    pub identity: CreatureIdentity,
    /// Effective current and maximum health with appraisal-supplied polarity.
    pub health: EnchantedValue<VitalRange>,
    /// Attributes, stamina, and mana disclosed as one optional profile block.
    pub attributes_and_vitals: Option<CreatureAttributesAndVitals>,
}

/// Mutually exclusive identity presentations selected by retail's creature examination rules.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum CreatureIdentity {
    /// Ordinary creature presentation with its best available taxonomy label.
    Creature {
        /// Gender plus heritage, or creature type when heritage is absent.
        lineage: Option<String>,
    },
    /// Character-style presentation selected by `Template` or `CharacterTitleId`.
    Character {
        /// Gender plus heritage, or creature type when heritage is absent.
        lineage: Option<String>,
        /// Localized character title, falling back to the server-authored template role.
        role: Option<String>,
        /// Public-flag classification displayed by the retail character inspector.
        player_killer_status: PlayerKillerClassification,
    },
}

impl CreatureIdentity {
    /// Lineage text shared by compact creature headers in every frontend.
    pub fn lineage(&self) -> Option<&str> {
        match self {
            Self::Creature { lineage } | Self::Character { lineage, .. } => lineage.as_deref(),
        }
    }
}

/// Three labels exposed by retail's character inspector, derived from public object flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, Display)]
#[serde(rename_all = "kebab-case")]
pub enum PlayerKillerClassification {
    #[strum(serialize = "Non-Player Killer")]
    NonPlayerKiller,
    #[strum(serialize = "Player Killer Lite")]
    PlayerKillerLite,
    #[strum(serialize = "Player Killer")]
    PlayerKiller,
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
        vital: VitalType,
        difficulty: i32,
    },
    RawVital {
        vital: VitalType,
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

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
#[serde(rename_all = "kebab-case")]
pub enum AttributeType {
    Undef = 0,
    Strength = 1,
    Endurance = 2,
    Quickness = 3,
    Coordination = 4,
    Focus = 5,
    SelfAttr = 6,
}

#[derive(
    Debug, Clone, Copy, serde::Serialize, serde::Deserialize, Display, PartialEq, Eq, FromRepr,
)]
#[serde(rename_all = "kebab-case")]
pub enum VitalType {
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
pub enum TrainingLevel {
    Inactive = 0,
    Untrained = 1,
    Trained = 2,
    Specialized = 3,
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

/// One appraised spell with ACE's high-bit active-enchantment marker decoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionSpell {
    /// Underlying spell-table identifier with bit 31 cleared.
    pub id: u32,
    /// Whether ACE sourced this entry from an active item enchantment.
    pub active_enchantment: bool,
}

impl InspectionSpell {
    const ACTIVE_ENCHANTMENT_MASK: u32 = 0x8000_0000;

    fn from_wire_id(value: u32) -> Self {
        Self {
            id: value & !Self::ACTIVE_ENCHANTMENT_MASK,
            active_enchantment: value & Self::ACTIVE_ENCHANTMENT_MASK != 0,
        }
    }
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
    // Unused by ACE
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
            // Unused by ACE
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

/// Current and maximum vital values.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VitalRange {
    /// Current vital value.
    pub current: u32,
    /// Maximum vital value.
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
    /// Weapon time; absent for casters because ACE omits their weapon profile.
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

/// Creature attributes and secondary vitals sent as one optional profile block.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureAttributesAndVitals {
    /// Six effective primary attributes with appraisal-supplied polarity.
    pub attributes: CreatureInspectionAttributes,
    /// Effective current and maximum stamina with appraisal-supplied polarity.
    pub stamina: EnchantedValue<VitalRange>,
    /// Effective current and maximum mana with appraisal-supplied polarity.
    pub mana: EnchantedValue<VitalRange>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatureInspectionAttributes {
    pub strength: EnchantedValue<u32>,
    pub endurance: EnchantedValue<u32>,
    pub coordination: EnchantedValue<u32>,
    pub quickness: EnchantedValue<u32>,
    pub focus: EnchantedValue<u32>,
    pub self_attr: EnchantedValue<u32>,
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
            ObjectInspectionDetails::Item(Box::new(ItemInspection::from_object(object)))
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

impl ItemInspection {
    fn from_object(object: &InspectionSource<'_>) -> Self {
        Self {
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
            },
            stack: CountInfo::stack_from_object(object),
            uses: CountInfo::uses_from_object(object),
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
            inscription: InscriptionInfo::from_object(object),
            imbued_effects: get_imbued_effects(object),
            effects: Effect::from_object(object),
            use_text: object
                .get_string_prop(PropertyString::Use)
                .map(|s| s.to_string()),
            spells: object
                .spell_book
                .iter()
                .copied()
                .map(InspectionSpell::from_wire_id)
                .collect(),
        }
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
        let Some(requirement_type) = object
            .get_int_prop(req_prop)
            .and_then(|value| WieldRequirementType::from_repr(value as usize))
        else {
            if skill_id.is_some() || difficulty.is_some() {
                log::warn!(
                    "object {:?} has an incomplete wield requirement at {req_prop:?}",
                    object.guid
                );
            }
            continue;
        };
        if requirement_type == WieldRequirementType::Invalid {
            continue;
        }

        // ACE compares creature and heritage requirements against WieldDifficulty; every other
        // typed requirement uses the fields indicated below. Never turn a missing field into zero.
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
                    AttributeType::from_repr(skill_id as usize).map(|attribute| {
                        WieldRequirement::Attribute {
                            attribute,
                            difficulty,
                        }
                    })
                })
            }
            WieldRequirementType::RawAttrib => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    AttributeType::from_repr(skill_id as usize).map(|attribute| {
                        WieldRequirement::RawAttribute {
                            attribute,
                            difficulty,
                        }
                    })
                })
            }
            WieldRequirementType::SecondaryAttrib => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    VitalType::from_repr(skill_id as usize)
                        .map(|vital| WieldRequirement::Vital { vital, difficulty })
                })
            }
            WieldRequirementType::RawSecondaryAttrib => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    VitalType::from_repr(skill_id as usize)
                        .map(|vital| WieldRequirement::RawVital { vital, difficulty })
                })
            }
            WieldRequirementType::Level => {
                difficulty.map(|level| WieldRequirement::Level { level })
            }
            WieldRequirementType::Training => {
                skill_id.zip(difficulty).and_then(|(skill_id, difficulty)| {
                    SkillType::from_repr(skill_id).and_then(|skill| {
                        TrainingLevel::from_repr(difficulty as usize)
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

    // Arcane Lore requirement from ItemDifficulty
    if let Some(difficulty) = object.get_int_prop(PropertyInt::ItemDifficulty)
        && difficulty > 0
    {
        reqs.push(WieldRequirement::Skill {
            skill: SkillType::ArcaneLore,
            difficulty,
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
        let workmanship = object.effective_workmanship()? as f32;

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

fn creature_identity(
    object: &InspectionSource<'_>,
    character_titles: &CharacterTitleCatalog,
) -> CreatureIdentity {
    let lineage = creature_lineage(object);
    let title_id = object.get_int_prop(PropertyInt::CharacterTitleId);
    let role = title_id
        .and_then(|value| u32::try_from(value).ok())
        .and_then(|value| character_titles.title(value))
        .map(str::to_owned)
        .or_else(|| {
            object
                .get_string_prop(PropertyString::Template)
                .map(str::to_owned)
        });

    // gmExaminationUI::SetAppraiseInfo selects the character inspector when either property is
    // present (acclient.c:218648-218662). Role text independently follows retail title resolution
    // and then the authored template fallback (acclient.c:223277-223318,474675-474715).
    if role.is_some() || title_id.is_some() {
        CreatureIdentity::Character {
            lineage,
            role,
            player_killer_status: player_killer_classification(object.public_flags),
        }
    } else {
        CreatureIdentity::Creature { lineage }
    }
}

fn creature_lineage(object: &InspectionSource<'_>) -> Option<String> {
    let gender = object
        .get_int_prop(PropertyInt::Gender)
        .and_then(gender_display_name);
    let ancestry = match object.get_int_prop(PropertyInt::HeritageGroup) {
        Some(heritage) if heritage != HeritageGroup::Invalid as i32 => {
            HeritageGroup::from_repr(heritage as usize).map(heritage_display_name)
        }
        _ => object
            .get_int_prop(PropertyInt::CreatureType)
            .and_then(|value| CreatureType::from_repr(value as u32))
            .map(|value| split_semantic_name(&value.to_string())),
    };

    match (gender, ancestry) {
        (Some(gender), Some(ancestry)) => Some(format!("{gender} {ancestry}")),
        (Some(gender), None) => Some(gender.to_owned()),
        (None, Some(ancestry)) => Some(ancestry),
        (None, None) => None,
    }
}

fn gender_display_name(value: i32) -> Option<&'static str> {
    match value {
        1 => Some("Male"),
        2 => Some("Female"),
        _ => None,
    }
}

fn heritage_display_name(value: HeritageGroup) -> String {
    match value {
        HeritageGroup::Gharundim => "Gharu'ndim".to_owned(),
        HeritageGroup::Shadowbound => "Umbraen".to_owned(),
        HeritageGroup::OlthoiAcid => "Olthoi".to_owned(),
        _ => split_semantic_name(&value.to_string()),
    }
}

fn split_semantic_name(value: &str) -> String {
    let mut display = String::with_capacity(value.len());
    let mut previous_was_lowercase_or_digit = false;
    for character in value.chars() {
        if character == '_' || character == '-' {
            display.push(' ');
            previous_was_lowercase_or_digit = false;
            continue;
        }
        if character.is_uppercase() && previous_was_lowercase_or_digit {
            display.push(' ');
        }
        previous_was_lowercase_or_digit = character.is_lowercase() || character.is_ascii_digit();
        display.push(character);
    }
    display
}

fn player_killer_classification(flags: ObjectDescriptionFlag) -> PlayerKillerClassification {
    // CharExamineUI reads the live object's IsPK/IsPKLite bits rather than the raw appraisal
    // property (acclient.c:223320-223341), with PK taking precedence if both are present.
    if flags.contains(ObjectDescriptionFlag::PLAYER_KILLER) {
        PlayerKillerClassification::PlayerKiller
    } else if flags.contains(ObjectDescriptionFlag::PK_LITE_STATUS) {
        PlayerKillerClassification::PlayerKillerLite
    } else {
        PlayerKillerClassification::NonPlayerKiller
    }
}

impl CreatureInspection {
    fn from_object(object: &InspectionSource<'_>, context: InspectionContext<'_>) -> Self {
        let profile = object
            .creature_profile
            .expect("creature inspection classification requires a creature profile");
        let buffs = profile.buffs.as_ref();
        Self {
            identity: creature_identity(object, context.character_titles),
            health: creature_enchanted_value(
                VitalRange {
                    current: profile.health,
                    max: profile.health_max,
                },
                buffs,
                0x40,
            ),
            attributes_and_vitals: profile.attributes.as_ref().map(|attributes| {
                CreatureAttributesAndVitals {
                    attributes: CreatureInspectionAttributes {
                        strength: creature_enchanted_value(attributes.strength, buffs, 0x1),
                        endurance: creature_enchanted_value(attributes.endurance, buffs, 0x2),
                        coordination: creature_enchanted_value(attributes.coordination, buffs, 0x8),
                        quickness: creature_enchanted_value(attributes.quickness, buffs, 0x4),
                        focus: creature_enchanted_value(attributes.focus, buffs, 0x10),
                        self_attr: creature_enchanted_value(attributes.self_attr, buffs, 0x20),
                    },
                    stamina: creature_enchanted_value(
                        VitalRange {
                            current: attributes.stamina,
                            max: attributes.stamina_max,
                        },
                        buffs,
                        0x80,
                    ),
                    mana: creature_enchanted_value(
                        VitalRange {
                            current: attributes.mana,
                            max: attributes.mana_max,
                        },
                        buffs,
                        0x100,
                    ),
                }
            }),
        }
    }
}

fn creature_enchanted_value<T: Copy>(
    effective: T,
    buffs: Option<&CreatureBuffs>,
    mask: u16,
) -> EnchantedValue<T> {
    enchanted_value(
        effective,
        None,
        buffs.map(|buffs| buffs.highlights),
        buffs.map(|buffs| buffs.colors),
        mask,
    )
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

fn enchanted_value<T: Copy>(
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

fn mask_has(bits: Option<u16>, mask: u16) -> bool {
    mask != 0 && bits.is_some_and(|bits| bits & mask != 0)
}

impl Effect {
    fn from_object(object: &InspectionSource<'_>) -> Vec<Self> {
        let mut effects = Vec::new();

        // ACE names IgnoreArmor as armor cleaving and treats presence as the behavior switch.
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::Entity;
    use holtburger_common::Guid;
    use holtburger_common::legacy_hash::legacy_string_hash;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ObjectDescriptionFlag, PropertyBool, PropertyFloat, PropertyInt, PropertyString,
        WorldObjectPropertyAccessorsMut,
    };
    use holtburger_dat::file_type::{EnumMapper, StringTable, StringTableData};
    use holtburger_protocol::messages::object::types::{
        ArmorProfile, CreatureAttributes, CreatureBuffs, CreatureProfile, CreatureProfileFlags,
        WeaponProfile,
    };

    fn inspect_entity(entity: &Entity) -> Result<ObjectInspection, ObjectInspectionError> {
        let titles = CharacterTitleCatalog::default();
        ObjectInspection::from_entity(entity, InspectionContext::new(&titles))
    }

    fn inspect_vendor_item(
        item: &CoreVendorItem,
    ) -> Result<ObjectInspection, ObjectInspectionError> {
        let titles = CharacterTitleCatalog::default();
        ObjectInspection::from_vendor_item(item, InspectionContext::new(&titles))
    }

    fn inspect_entity_with_title(
        entity: &Entity,
        title_id: u32,
        token: &str,
        display: &str,
    ) -> Result<ObjectInspection, ObjectInspectionError> {
        let mapper = EnumMapper {
            id: EnumMapper::FILE_ID,
            base_enum_map: 0,
            numbering: 0,
            entries: [(title_id, token.to_owned())].into_iter().collect(),
        };
        let strings = StringTable {
            id: StringTable::FILE_ID,
            language: 1,
            unknown: 0,
            entries: vec![StringTableData {
                id: legacy_string_hash(token.as_bytes()),
                variable_names: Vec::new(),
                variables: Vec::new(),
                strings: vec![display.to_owned()],
                comments: Vec::new(),
                unknown: 0,
            }],
        };
        let titles = CharacterTitleCatalog::from_assets(&mapper, &strings).unwrap();
        ObjectInspection::from_entity(entity, InspectionContext::new(&titles))
    }

    #[test]
    fn from_entity_captures_open_status_property() {
        let mut entity = Entity::new(
            Guid(0x60000001),
            "Door".to_string(),
            WorldPosition::default(),
        );
        entity.set_bool_prop(PropertyBool::Open, true);
        entity.set_bool_prop(PropertyBool::Locked, false);

        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Item(item) = inspection.details else {
            panic!("door should use item inspection");
        };

        assert_eq!(item.status.is_open, Some(true));
        assert_eq!(item.status.is_locked, Some(false));
    }

    #[test]
    fn ordinary_creature_identity_uses_creature_type_lineage() {
        let mut entity = Entity::new(
            Guid(0x60000003),
            "Test Creature".to_string(),
            WorldPosition::default(),
        );
        entity.set_int_prop(PropertyInt::CreatureType, CreatureType::Olthoi as i32);
        entity.creature_profile = Some(CreatureProfile {
            flags: CreatureProfileFlags::empty(),
            health: 100,
            health_max: 100,
            attributes: None,
            buffs: None,
        });

        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Creature(creature) = inspection.details else {
            panic!("profile-backed object should use creature inspection");
        };

        assert_eq!(
            creature.identity,
            CreatureIdentity::Creature {
                lineage: Some("Olthoi".to_owned()),
            }
        );
        assert_eq!(creature.attributes_and_vitals, None);
    }

    #[test]
    fn template_selects_character_identity_with_retail_fallbacks() {
        let mut entity = Entity::new(
            Guid(0x6000000B),
            "Drawohan the Gem Seller".to_string(),
            WorldPosition::default(),
        );
        entity.set_string_prop(PropertyString::Template, "Gem Seller".to_owned());
        entity.set_int_prop(PropertyInt::CharacterTitleId, 999);
        entity.set_int_prop(PropertyInt::CreatureType, CreatureType::Lugian as i32);
        entity.flags = ObjectDescriptionFlag::VENDOR;
        entity.creature_profile = Some(CreatureProfile {
            flags: CreatureProfileFlags::empty(),
            health: 100,
            health_max: 100,
            attributes: None,
            buffs: None,
        });

        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Creature(creature) = inspection.details else {
            panic!("profile-backed object should use creature inspection");
        };

        assert_eq!(
            creature.identity,
            CreatureIdentity::Character {
                lineage: Some("Lugian".to_owned()),
                role: Some("Gem Seller".to_owned()),
                player_killer_status: PlayerKillerClassification::NonPlayerKiller,
            }
        );
    }

    #[test]
    fn character_identity_prefers_localized_title_and_shared_character_facts() {
        let mut entity = Entity::new(
            Guid(0x6000000C),
            "Character".to_string(),
            WorldPosition::default(),
        );
        entity.set_int_prop(PropertyInt::CharacterTitleId, 42);
        entity.set_string_prop(PropertyString::Template, "Template Fallback".to_owned());
        entity.set_int_prop(PropertyInt::Gender, 2);
        entity.set_int_prop(PropertyInt::HeritageGroup, HeritageGroup::Gharundim as i32);
        entity.flags = ObjectDescriptionFlag::PLAYER_KILLER | ObjectDescriptionFlag::PK_LITE_STATUS;
        entity.creature_profile = Some(CreatureProfile {
            flags: CreatureProfileFlags::empty(),
            health: 100,
            health_max: 100,
            attributes: None,
            buffs: None,
        });

        let inspection =
            inspect_entity_with_title(&entity, 42, "DefenderOfDereth", "Defender of Dereth")
                .unwrap();
        let ObjectInspectionDetails::Creature(creature) = inspection.details else {
            panic!("profile-backed object should use creature inspection");
        };

        assert_eq!(
            creature.identity,
            CreatureIdentity::Character {
                lineage: Some("Female Gharu'ndim".to_owned()),
                role: Some("Defender of Dereth".to_owned()),
                player_killer_status: PlayerKillerClassification::PlayerKiller,
            }
        );
    }

    #[test]
    fn pk_lite_public_flag_selects_the_lite_character_label() {
        assert_eq!(
            player_killer_classification(ObjectDescriptionFlag::PK_LITE_STATUS),
            PlayerKillerClassification::PlayerKillerLite
        );
    }

    #[test]
    fn creature_enchantment_masks_classify_attributes_and_vitals_without_base_values() {
        let mut entity = Entity::new(
            Guid(0x60000008),
            "Enhanced Creature".to_string(),
            WorldPosition::default(),
        );
        entity.creature_profile = Some(CreatureProfile {
            flags: CreatureProfileFlags::SHOW_ATTRIBUTES | CreatureProfileFlags::HAS_BUFFS_DEBUFFS,
            health: 90,
            health_max: 120,
            attributes: Some(CreatureAttributes {
                strength: 300,
                endurance: 250,
                quickness: 200,
                coordination: 210,
                focus: 175,
                self_attr: 160,
                stamina: 80,
                mana: 70,
                stamina_max: 100,
                mana_max: 90,
            }),
            buffs: Some(CreatureBuffs {
                highlights: 0x1 | 0x2 | 0x40 | 0x80,
                colors: 0x1 | 0x80,
            }),
        });

        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Creature(creature) = inspection.details else {
            panic!("profile-backed object should use creature inspection");
        };
        assert_eq!(creature.health.unbuffed, None);
        assert_eq!(
            creature.health.enchantment,
            Some(EnchantmentPolarity::Harmful)
        );
        let profile = creature
            .attributes_and_vitals
            .expect("attributes and secondary vitals");
        assert_eq!(
            profile.attributes.strength.enchantment,
            Some(EnchantmentPolarity::Beneficial)
        );
        assert_eq!(
            profile.attributes.endurance.enchantment,
            Some(EnchantmentPolarity::Harmful)
        );
        assert_eq!(profile.attributes.coordination.enchantment, None);
        assert_eq!(profile.attributes.strength.unbuffed, None);
        assert_eq!(
            profile.stamina.enchantment,
            Some(EnchantmentPolarity::Beneficial)
        );
        assert_eq!(profile.mana.enchantment, None);
    }

    #[test]
    fn creature_without_profile_uses_item_shape() {
        let mut entity = Entity::new(
            Guid(0x70000001),
            "Object-like NPC".to_string(),
            WorldPosition::default(),
        );
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);

        let inspection = inspect_entity(&entity).unwrap();

        assert!(matches!(
            inspection.details,
            ObjectInspectionDetails::Item(_)
        ));
    }

    #[test]
    fn player_requires_creature_profile() {
        let entity = Entity::new(
            Guid(0x50000001),
            "Player".to_string(),
            WorldPosition::default(),
        );

        assert_eq!(
            inspect_entity(&entity),
            Err(ObjectInspectionError::MissingPlayerCreatureProfile { guid: entity.guid })
        );
    }

    #[test]
    fn item_spell_marker_is_decoded_without_losing_provenance() {
        let mut entity = Entity::new(
            Guid(0x60000004),
            "Magic Item".to_string(),
            WorldPosition::default(),
        );
        entity.spell_book = vec![42, 0x8000_002B];

        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Item(item) = inspection.details else {
            panic!("item should use item inspection");
        };

        assert_eq!(
            item.spells,
            vec![
                InspectionSpell {
                    id: 42,
                    active_enchantment: false,
                },
                InspectionSpell {
                    id: 43,
                    active_enchantment: true,
                },
            ]
        );
    }

    #[test]
    fn item_enchantment_masks_classify_effective_values_and_preserve_proven_base() {
        let mut entity = Entity::new(
            Guid(0x60000006),
            "Enchanted Sword".to_string(),
            WorldPosition::default(),
        );
        entity.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
        entity.set_int_prop(PropertyInt::Damage, 50);
        entity.set_float_prop(PropertyFloat::DamageVariance, 0.5);
        entity.set_int_prop(PropertyInt::DamageType, DamageType::SLASH.bits() as i32);
        entity.set_int_prop(PropertyInt::WeaponTime, 40);
        entity.set_float_prop(PropertyFloat::ArmorModVsSlash, 1.0);
        entity.weapon_profile = Some(WeaponProfile {
            damage_type: DamageType::SLASH.bits(),
            weapon_time: 32,
            weapon_skill: 0,
            damage: 60,
            damage_variance: 0.5,
            damage_mod: 1.0,
            weapon_length: 1.0,
            max_velocity: 1.0,
            weapon_offense: 1.0,
            max_velocity_estimated: 0,
        });
        entity.armor_profile = Some(ArmorProfile {
            slashing: 1.2,
            piercing: 1.0,
            bludgeoning: 1.0,
            cold: 1.0,
            fire: 1.0,
            acid: 1.0,
            nether: 1.0,
            lightning: 1.0,
        });
        entity.weapon_highlight = Some(0x8 | 0x4);
        entity.weapon_color = Some(0x8 | 0x4);
        entity.armor_highlight = Some(0x2);
        entity.armor_color = Some(0x2);

        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Item(item) = inspection.details else {
            panic!("weapon should use item inspection");
        };
        let weapon = item.weapon.expect("weapon details");
        assert_eq!(
            weapon.damage.effective,
            DamageRangeInfo {
                min: 30.0,
                max: 60.0
            }
        );
        assert_eq!(
            weapon.damage.unbuffed,
            Some(DamageRangeInfo {
                min: 25.0,
                max: 50.0
            })
        );
        assert_eq!(
            weapon.damage.enchantment,
            Some(EnchantmentPolarity::Beneficial)
        );
        assert_eq!(weapon.speed.and_then(|value| value.unbuffed), Some(40));
        let slashing = item.protections.expect("protections").slashing;
        assert_eq!(slashing.effective, 1.2);
        assert_eq!(slashing.unbuffed, Some(1.0));
        assert_eq!(slashing.enchantment, Some(EnchantmentPolarity::Beneficial));
    }

    #[test]
    fn item_enchantment_masks_do_not_fabricate_missing_base_values() {
        let mut entity = Entity::new(
            Guid(0x60000007),
            "Appraisal-only Sword".to_string(),
            WorldPosition::default(),
        );
        entity.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
        entity.weapon_profile = Some(WeaponProfile {
            damage_type: DamageType::ACID.bits(),
            weapon_time: 23,
            weapon_skill: 0,
            damage: 71,
            damage_variance: 0.56,
            damage_mod: 1.0,
            weapon_length: 1.0,
            max_velocity: 1.0,
            weapon_offense: 1.2,
            max_velocity_estimated: 0,
        });
        entity.armor_profile = Some(ArmorProfile {
            slashing: 1.2,
            piercing: 1.0,
            bludgeoning: 1.0,
            cold: 1.0,
            fire: 1.0,
            acid: 1.0,
            nether: 1.0,
            lightning: 1.0,
        });
        entity.weapon_highlight = Some(0x1 | 0x4 | 0x8);
        entity.weapon_color = Some(0);
        entity.armor_highlight = Some(0x2);
        entity.armor_color = Some(0);

        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Item(item) = inspection.details else {
            panic!("weapon should use item inspection");
        };
        let weapon = item.weapon.expect("weapon details");
        assert_eq!(weapon.damage.unbuffed, None);
        assert_eq!(
            weapon.damage.enchantment,
            Some(EnchantmentPolarity::Harmful)
        );
        let speed = weapon.speed.expect("weapon speed");
        assert_eq!(speed.unbuffed, None);
        assert_eq!(speed.enchantment, Some(EnchantmentPolarity::Harmful));
        let attack = item
            .bonuses
            .iter()
            .find(|bonus| bonus.kind == BonusKind::Attack)
            .expect("attack bonus");
        assert_eq!(attack.value.unbuffed, None);
        assert_eq!(attack.value.enchantment, Some(EnchantmentPolarity::Harmful));
        let slashing = item.protections.expect("protections").slashing;
        assert_eq!(slashing.unbuffed, None);
        assert_eq!(slashing.enchantment, Some(EnchantmentPolarity::Harmful));
    }

    #[test]
    fn wield_requirements_preserve_missing_fields_and_ace_value_slots() {
        let mut entity = Entity::new(
            Guid(0x60000009),
            "Requirement Test".to_string(),
            WorldPosition::default(),
        );
        entity.set_int_prop(
            PropertyInt::WieldRequirements,
            WieldRequirementType::Skill as i32,
        );
        entity.set_int_prop(
            PropertyInt::WieldRequirements2,
            WieldRequirementType::CreatureType as i32,
        );
        entity.set_int_prop(PropertyInt::WieldDifficulty2, CreatureType::Olthoi as i32);

        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Item(item) = inspection.details else {
            panic!("ordinary object should use item inspection");
        };

        assert_eq!(
            item.wield_requirements,
            vec![WieldRequirement::CreatureType {
                creature_type: CreatureType::Olthoi,
            }]
        );
    }

    #[test]
    fn special_effects_follow_ace_property_ownership_without_duplicate_imbues() {
        let mut entity = Entity::new(
            Guid(0x6000000A),
            "Effect Test".to_string(),
            WorldPosition::default(),
        );
        entity.set_float_prop(PropertyFloat::IgnoreArmor, 1.0);
        entity.set_float_prop(PropertyFloat::ResistanceModifier, 1.0);
        entity.set_int_prop(
            PropertyInt::ResistanceModifierType,
            DamageType::FIRE.bits() as i32,
        );
        entity.set_int_prop(
            PropertyInt::ImbuedEffect,
            ImbuedEffectType::AlwaysCritical.bits() as i32,
        );

        let inspection = inspect_entity(&entity).unwrap();
        let ObjectInspectionDetails::Item(item) = inspection.details else {
            panic!("ordinary object should use item inspection");
        };

        assert_eq!(
            item.effects,
            vec![Effect::ArmorCleaving, Effect::FireCleaving]
        );
        assert!(
            item.imbued_effects
                .contains(ImbuedEffectType::AlwaysCritical)
        );
    }

    #[test]
    fn entity_and_vendor_item_share_the_same_populator() {
        let mut entity = Entity::new(
            Guid(0x60000005),
            "Shared Item".to_string(),
            WorldPosition::default(),
        );
        entity.set_int_prop(PropertyInt::Value, 125);
        let mut vendor = CoreVendorItem {
            guid: entity.guid,
            wcid: 1,
            properties: entity.properties.clone(),
            ..Default::default()
        };
        vendor.spell_book = entity.spell_book.clone();

        assert_eq!(
            inspect_entity(&entity).unwrap(),
            inspect_vendor_item(&vendor).unwrap()
        );
    }
}
