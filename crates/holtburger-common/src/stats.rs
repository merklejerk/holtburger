use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    Display,
    FromRepr,
    Hash,
)]
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

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Serialize,
    Deserialize,
    Display,
    FromRepr,
    Hash,
)]
#[repr(u32)]
pub enum VitalType {
    Health = 1,
    Stamina = 3,
    Mana = 5,
}

impl VitalType {
    pub fn from_id(id: u32) -> Option<Self> {
        match id {
            1 | 2 => Some(VitalType::Health),
            3 | 4 => Some(VitalType::Stamina),
            5 | 6 => Some(VitalType::Mana),
            _ => None,
        }
    }
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Display,
    FromRepr,
)]
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

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Display,
    FromRepr,
)]
#[repr(u32)]
pub enum CreatureType {
    Invalid = 0,
    Olthoi = 1,
    Banderling = 2,
    Drudge = 3,
    Mosswart = 4,
    Lugian = 5,
    Tumerok = 6,
    Mite = 7,
    Tusker = 8,
    PhyntosWasp = 9,
    Rat = 10,
    Auroch = 11,
    Cow = 12,
    Golem = 13,
    Undead = 14,
    Gromnie = 15,
    Reedshark = 16,
    Armoredillo = 17,
    Fae = 18,
    Virindi = 19,
    Wisp = 20,
    Knathtead = 21,
    Shadow = 22,
    Mattekar = 23,
    Mumiyah = 24,
    Rabbit = 25,
    Sclavus = 26,
    ShallowsShark = 27,
    Monouga = 28,
    Zefir = 29,
    Skeleton = 30,
    Human = 31,
    Shreth = 32,
    Chittick = 33,
    Moarsman = 34,
    OlthoiLarvae = 35,
    Slithis = 36,
    Deru = 37,
    FireElemental = 38,
    Snowman = 39,
    Unknown = 40,
    Bunny = 41,
    LightningElemental = 42,
    Rockslide = 43,
    Grievver = 44,
    Niffis = 45,
    Ursuin = 46,
    Crystal = 47,
    HollowMinion = 48,
    Scarecrow = 49,
    Idol = 50,
    Empyrean = 51,
    Hopeslayer = 52,
    Doll = 53,
    Marionette = 54,
    Carenzi = 55,
    Siraluun = 56,
    AunTumerok = 57,
    HeaTumerok = 58,
    Simulacrum = 59,
    AcidElemental = 60,
    FrostElemental = 61,
    Elemental = 62,
    Statue = 63,
    Wall = 64,
    AlteredHuman = 65,
    Device = 66,
    Harbinger = 67,
    DarkSarcophagus = 68,
    Chicken = 69,
    GotrokLugian = 70,
    Margul = 71,
    BleachedRabbit = 72,
    NastyRabbit = 73,
    GrimacingRabbit = 74,
    Burun = 75,
    Target = 76,
    Ghost = 77,
    Fiun = 78,
    Eater = 79,
    Penguin = 80,
    Ruschk = 81,
    Thrungus = 82,
    ViamontianKnight = 83,
    Remoran = 84,
    Swarm = 85,
    Moar = 86,
    EnchantedArms = 87,
    Sleech = 88,
    Mukkir = 89,
    Merwart = 90,
    Food = 91,
    ParadoxOlthoi = 92,
    Harvest = 93,
    Energy = 94,
    Apparition = 95,
    Aerbax = 96,
    Touched = 97,
    BlightedMoarsman = 98,
    GearKnight = 99,
    Gurog = 100,
    Anekshay = 101,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Display, FromRepr)]
#[repr(u32)]
pub enum TrainingLevel {
    Unusable = 0,
    Untrained = 1,
    Trained = 2,
    Specialized = 3,
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
