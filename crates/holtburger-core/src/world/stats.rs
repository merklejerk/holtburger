use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Display, FromRepr)]
#[repr(u32)]
pub enum AttributeType {
    #[strum(serialize = "Strength")]
    StrengthAttr = 1,
    #[strum(serialize = "Endurance")]
    EnduranceAttr = 2,
    #[strum(serialize = "Quickness")]
    QuicknessAttr = 3,
    #[strum(serialize = "Coordination")]
    CoordinationAttr = 4,
    #[strum(serialize = "Focus")]
    FocusAttr = 5,
    #[strum(serialize = "Self")]
    SelfAttr = 6,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Display, FromRepr)]
#[repr(u32)]
pub enum VitalType {
    Health = 1,
    Stamina = 2,
    Mana = 3,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attribute {
    pub attr_type: AttributeType,
    pub base: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vital {
    pub vital_type: VitalType,
    pub base: u32,
    pub current: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Display, FromRepr)]
#[repr(u32)]
pub enum SkillType {
    Axe = 1,
    Bow = 2,
    Crossbow = 3,
    Dagger = 4,
    Mace = 5,
    #[strum(serialize = "Melee Defense")]
    MeleeDefense = 6,
    #[strum(serialize = "Missile Defense")]
    MissileDefense = 7,
    Sling = 8,
    Spear = 9,
    Staff = 10,
    Sword = 11,
    #[strum(serialize = "Thrown Weapon")]
    ThrownWeapon = 12,
    #[strum(serialize = "Unarmed Combat")]
    UnarmedCombat = 13,
    #[strum(serialize = "Arcane Lore")]
    ArcaneLore = 14,
    #[strum(serialize = "Magic Defense")]
    MagicDefense = 15,
    #[strum(serialize = "Mana Conversion")]
    ManaConversion = 16,
    Spellcraft = 17,
    #[strum(serialize = "Item Tinkering")]
    ItemTinkering = 18,
    #[strum(serialize = "Assess Person")]
    AssessPerson = 19,
    Deception = 20,
    Healing = 21,
    Jump = 22,
    Lockpick = 23,
    Run = 24,
    Awareness = 25,
    #[strum(serialize = "Arms and Armor Repair")]
    ArmsAndArmorRepair = 26,
    #[strum(serialize = "Assess Creature")]
    AssessCreature = 27,
    #[strum(serialize = "Weapon Tinkering")]
    WeaponTinkering = 28,
    #[strum(serialize = "Armor Tinkering")]
    ArmorTinkering = 29,
    #[strum(serialize = "Magic Item Tinkering")]
    MagicItemTinkering = 30,
    #[strum(serialize = "Creature Enchantment")]
    CreatureEnchantment = 31,
    #[strum(serialize = "Item Enchantment")]
    ItemEnchantment = 32,
    #[strum(serialize = "Life Magic")]
    LifeMagic = 33,
    #[strum(serialize = "War Magic")]
    WarMagic = 34,
    Leadership = 35,
    Loyalty = 36,
    Fletching = 37,
    Alchemy = 38,
    Cooking = 39,
    Salvaging = 40,
    #[strum(serialize = "Two Handed Combat")]
    TwoHandedCombat = 41,
    Gearcraft = 42,
    #[strum(serialize = "Void Magic")]
    VoidMagic = 43,
    #[strum(serialize = "Heavy Weapons")]
    HeavyWeapons = 44,
    #[strum(serialize = "Light Weapons")]
    LightWeapons = 45,
    #[strum(serialize = "Finesse Weapons")]
    FinesseWeapons = 46,
    #[strum(serialize = "Missile Weapons")]
    MissileWeapons = 47,
    Shield = 48,
    #[strum(serialize = "Dual Wield")]
    DualWield = 49,
    Recklessness = 50,
    #[strum(serialize = "Sneak Attack")]
    SneakAttack = 51,
    #[strum(serialize = "Dirty Fighting")]
    DirtyFighting = 52,
    Challenge = 53,
    Summoning = 54,
}

impl SkillType {
    /// Returns true if the skill is part of the End of Retail (EOR) skill set.
    /// Many earlier skills were retired or supplanted (e.g., Axe/Sword/Mace -> Heavy/Light/Finesse).
    pub fn is_eor(&self) -> bool {
        matches!(
            self,
            SkillType::MeleeDefense
                | SkillType::MissileDefense
                | SkillType::ArcaneLore
                | SkillType::MagicDefense
                | SkillType::ManaConversion
                | SkillType::ItemTinkering
                | SkillType::AssessPerson
                | SkillType::Deception
                | SkillType::Healing
                | SkillType::Jump
                | SkillType::Lockpick
                | SkillType::Run
                | SkillType::AssessCreature
                | SkillType::WeaponTinkering
                | SkillType::ArmorTinkering
                | SkillType::MagicItemTinkering
                | SkillType::CreatureEnchantment
                | SkillType::ItemEnchantment
                | SkillType::LifeMagic
                | SkillType::WarMagic
                | SkillType::Leadership
                | SkillType::Loyalty
                | SkillType::Fletching
                | SkillType::Alchemy
                | SkillType::Cooking
                | SkillType::Salvaging
                | SkillType::TwoHandedCombat
                | SkillType::VoidMagic
                | SkillType::HeavyWeapons
                | SkillType::LightWeapons
                | SkillType::FinesseWeapons
                | SkillType::MissileWeapons
                | SkillType::Shield
                | SkillType::DualWield
                | SkillType::Recklessness
                | SkillType::SneakAttack
                | SkillType::DirtyFighting
                | SkillType::Summoning
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub skill_type: SkillType,
    pub base: u32,
    pub current: u32,
    pub training: TrainingLevel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Display, FromRepr)]
#[repr(u32)]
pub enum TrainingLevel {
    Unusable = 0,
    Untrained = 1,
    Trained = 2,
    Specialized = 3,
}
