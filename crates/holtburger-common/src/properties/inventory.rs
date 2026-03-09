use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct ItemType: u32 {
        const MELEE_WEAPON = 0x00000001;
        const ARMOR = 0x00000002;
        const CLOTHING = 0x00000004;
        const JEWELRY = 0x00000008;
        const CREATURE = 0x00000010;
        const FOOD = 0x00000020;
        const MONEY = 0x00000040;
        const MISC = 0x00000080;
        const MISSILE_WEAPON = 0x00000100;
        const CONTAINER = 0x00000200;
        const USELESS = 0x00000400;
        const GEM = 0x00000800;
        const SPELL_COMPONENTS = 0x00001000;
        const WRITABLE = 0x00002000;
        const KEY = 0x00004000;
        const CASTER = 0x00008000;
        const PORTAL = 0x00010000;
        const LOCKABLE = 0x00020000;
        const PROMISSORY_NOTE = 0x00040000;
        const MANA_STONE = 0x00080000;
        const SERVICE = 0x00100000;
        const MAGIC_WIELDABLE = 0x00200000;
        const CRAFT_COOKING_BASE = 0x00400000;
        const CRAFT_ALCHEMY_BASE = 0x00800000;
        const CRAFT_FLETCHING_BASE = 0x02000000;
        const CRAFT_ALCHEMY_INTERMEDIATE = 0x04000000;
        const CRAFT_FLETCHING_INTERMEDIATE = 0x08000000;
        const LIFE_STONE = 0x10000000;
        const TINKERING_TOOL = 0x20000000;
        const TINKERING_MATERIAL = 0x40000000;
        const GAMEBOARD = 0x80000000;
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, FromRepr, Display, Serialize, Deserialize,
)]
#[repr(u32)]
pub enum MaterialType {
    Unknown = 0,
    Ceramic = 1,
    Porcelain = 2,
    Cloth = 3,
    Linen = 4,
    Satin = 5,
    Silk = 6,
    Velvet = 7,
    Wool = 8,
    Gem = 9,
    Agate = 10,
    Amber = 11,
    Amethyst = 12,
    Aquamarine = 13,
    Azurite = 14,
    #[strum(serialize = "Black Garnet")]
    BlackGarnet = 15,
    #[strum(serialize = "Black Opal")]
    BlackOpal = 16,
    Bloodstone = 17,
    Carnelian = 18,
    Citrine = 19,
    Diamond = 20,
    Emerald = 21,
    #[strum(serialize = "Fire Opal")]
    FireOpal = 22,
    #[strum(serialize = "Green Garnet")]
    GreenGarnet = 23,
    #[strum(serialize = "Green Jade")]
    GreenJade = 24,
    Hematite = 25,
    #[strum(serialize = "Imperial Topaz")]
    ImperialTopaz = 26,
    Jet = 27,
    #[strum(serialize = "Lapis Lazuli")]
    LapisLazuli = 28,
    #[strum(serialize = "Lavender Jade")]
    LavenderJade = 29,
    Malachite = 30,
    Moonstone = 31,
    Onyx = 32,
    Opal = 33,
    Peridot = 34,
    #[strum(serialize = "Red Garnet")]
    RedGarnet = 35,
    #[strum(serialize = "Red Jade")]
    RedJade = 36,
    #[strum(serialize = "Rose Quartz")]
    RoseQuartz = 37,
    Ruby = 38,
    Sapphire = 39,
    #[strum(serialize = "Smokey Quartz")]
    SmokeyQuartz = 40,
    Sunstone = 41,
    #[strum(serialize = "Tiger Eye")]
    TigerEye = 42,
    Tourmaline = 43,
    Turquoise = 44,
    #[strum(serialize = "White Jade")]
    WhiteJade = 45,
    #[strum(serialize = "White Quartz")]
    WhiteQuartz = 46,
    #[strum(serialize = "White Sapphire")]
    WhiteSapphire = 47,
    #[strum(serialize = "Yellow Garnet")]
    YellowGarnet = 48,
    #[strum(serialize = "Yellow Topaz")]
    YellowTopaz = 49,
    Zircon = 50,
    Ivory = 51,
    Leather = 52,
    #[strum(serialize = "Armoredillo Hide")]
    ArmoredilloHide = 53,
    #[strum(serialize = "Gromnie Hide")]
    GromnieHide = 54,
    #[strum(serialize = "Reed Shark Hide")]
    ReedSharkHide = 55,
    Metal = 56,
    Brass = 57,
    Bronze = 58,
    Copper = 59,
    Gold = 60,
    Iron = 61,
    Pyreal = 62,
    Silver = 63,
    Steel = 64,
    Stone = 65,
    Alabaster = 66,
    Granite = 67,
    Marble = 68,
    Obsidian = 69,
    Sandstone = 70,
    Serpentine = 71,
    Wood = 72,
    Ebony = 73,
    Mahogany = 74,
    Oak = 75,
    Pine = 76,
    Teak = 77,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize)]
#[repr(u32)]
pub enum AttunedStatus {
    Normal = 0,
    Attuned = 1,
    Sticky = 2,
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
    pub struct EquipMask: u32 {
        const NONE = 0x00000000;
        const HEAD_WEAR = 0x00000001;
        const CHEST_WEAR = 0x00000002;
        const ABDOMEN_WEAR = 0x00000004;
        const UPPER_ARM_WEAR = 0x00000008;
        const LOWER_ARM_WEAR = 0x00000010;
        const HAND_WEAR = 0x00000020;
        const UPPER_LEG_WEAR = 0x00000040;
        const LOWER_LEG_WEAR = 0x00000080;
        const FOOT_WEAR = 0x00000100;
        const CHEST_ARMOR = 0x00000200;
        const ABDOMEN_ARMOR = 0x00000400;
        const UPPER_ARM_ARMOR = 0x00000800;
        const LOWER_ARM_ARMOR = 0x00001000;
        const UPPER_LEG_ARMOR = 0x00002000;
        const LOWER_LEG_ARMOR = 0x00004000;
        const NECK_WEAR = 0x00008000;
        const WRIST_WEAR_LEFT = 0x00010000;
        const WRIST_WEAR_RIGHT = 0x00020000;
        const FINGER_WEAR_LEFT = 0x00040000;
        const FINGER_WEAR_RIGHT = 0x00080000;
        const MELEE_WEAPON = 0x00100000;
        const SHIELD = 0x00200000;
        const MISSILE_WEAPON = 0x00400000;
        const MISSILE_AMMO = 0x00800000;
        const CASTER = 0x01000000;
        const TWO_HANDED = 0x02000000;
        const TRINKET_ONE = 0x04000000;
        const CLOAK = 0x08000000;
        const SIGIL_ONE = 0x10000000;
        const SIGIL_TWO = 0x20000000;
        const SIGIL_THREE = 0x40000000;
    }
}

impl EquipMask {
    pub fn iter_display_names(&self) -> impl Iterator<Item = &'static str> {
        self.iter_names().map(|(name, _)| match name {
            "HEAD_WEAR" => "Head wear",
            "CHEST_WEAR" => "Chest wear",
            "ABDOMEN_WEAR" => "Abdomen wear",
            "UPPER_ARM_WEAR" => "Upper arm wear",
            "LOWER_ARM_WEAR" => "Lower arm wear",
            "HAND_WEAR" => "Hand wear",
            "UPPER_LEG_WEAR" => "Upper leg wear",
            "LOWER_LEG_WEAR" => "Lower leg wear",
            "FOOT_WEAR" => "Foot wear",
            "CHEST_ARMOR" => "Chest armor",
            "ABDOMEN_ARMOR" => "Abdomen armor",
            "UPPER_ARM_ARMOR" => "Upper arm armor",
            "LOWER_ARM_ARMOR" => "Lower arm armor",
            "UPPER_LEG_ARMOR" => "Upper leg armor",
            "LOWER_LEG_ARMOR" => "Lower leg armor",
            "NECK_WEAR" => "Neck wear",
            "WRIST_WEAR_LEFT" => "Left wrist wear",
            "WRIST_WEAR_RIGHT" => "Right wrist wear",
            "FINGER_WEAR_LEFT" => "Left finger wear",
            "FINGER_WEAR_RIGHT" => "Right finger wear",
            "MELEE_WEAPON" => "Melee weapon",
            "SHIELD" => "Shield",
            "MISSILE_WEAPON" => "Missile weapon",
            "MISSILE_AMMO" => "Missile ammo",
            "CASTER" => "Caster",
            "TWO_HANDED" => "Two-handed",
            "TRINKET_ONE" => "Trinket 1",
            "CLOAK" => "Cloak",
            "SIGIL_ONE" => "Sigil 1",
            "SIGIL_TWO" => "Sigil 2",
            "SIGIL_THREE" => "Sigil 3",
            _ => name,
        })
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
    pub struct PseudoEquipMask: u32 {
        const TOP_CLOTHES = EquipMask::CHEST_WEAR.bits() | EquipMask::UPPER_ARM_WEAR.bits() | EquipMask::LOWER_ARM_WEAR.bits();
        const BOTTOM_CLOTHES = EquipMask::UPPER_LEG_WEAR.bits() | EquipMask::LOWER_LEG_WEAR.bits();
        const CLOTHES = Self::TOP_CLOTHES.bits() | Self::BOTTOM_CLOTHES.bits() | EquipMask::ABDOMEN_WEAR.bits();
        const COMBAT_IMPLEMENTS = EquipMask::MELEE_WEAPON.bits() | EquipMask::SHIELD.bits() | EquipMask::MISSILE_WEAPON.bits() | EquipMask::CASTER.bits() | EquipMask::TWO_HANDED.bits();
        const MAIN_HAND_EXCLUSIVE = EquipMask::TWO_HANDED.bits() | EquipMask::MISSILE_WEAPON.bits() | EquipMask::CASTER.bits();
        const MAIN_HAND_IMPLEMENTS = Self::COMBAT_IMPLEMENTS.bits() & !(EquipMask::SHIELD.bits());
        const OFF_HAND_IMPLEMENTS = Self::COMBAT_IMPLEMENTS.bits() & (EquipMask::SHIELD.bits() | EquipMask::MELEE_WEAPON.bits());
        const MAIN_HAND_ONLY = Self::MAIN_HAND_IMPLEMENTS.bits() & !(Self::OFF_HAND_IMPLEMENTS.bits());
        const OFF_HAND_ONLY = Self::OFF_HAND_IMPLEMENTS.bits() & !(Self::MAIN_HAND_IMPLEMENTS.bits());
        const OFF_HAND_SLOT = EquipMask::SHIELD.bits();
        const CLOTHING = 0x80000000 | EquipMask::HEAD_WEAR.bits() | EquipMask::CHEST_WEAR.bits() | EquipMask::ABDOMEN_WEAR.bits() | EquipMask::UPPER_ARM_WEAR.bits() | EquipMask::LOWER_ARM_WEAR.bits() | EquipMask::HAND_WEAR.bits() | EquipMask::UPPER_LEG_WEAR.bits() | EquipMask::LOWER_LEG_WEAR.bits() | EquipMask::FOOT_WEAR.bits();
        const ARMOR = EquipMask::CHEST_ARMOR.bits() | EquipMask::ABDOMEN_ARMOR.bits() | EquipMask::UPPER_ARM_ARMOR.bits() | EquipMask::LOWER_ARM_ARMOR.bits() | EquipMask::UPPER_LEG_ARMOR.bits() | EquipMask::LOWER_LEG_ARMOR.bits() | EquipMask::FOOT_WEAR.bits();
        const JEWELRY = EquipMask::NECK_WEAR.bits() | EquipMask::WRIST_WEAR_LEFT.bits() | EquipMask::WRIST_WEAR_RIGHT.bits() | EquipMask::FINGER_WEAR_LEFT.bits() | EquipMask::FINGER_WEAR_RIGHT.bits() | EquipMask::TRINKET_ONE.bits() | EquipMask::CLOAK.bits() | EquipMask::SIGIL_ONE.bits() | EquipMask::SIGIL_TWO.bits() | EquipMask::SIGIL_THREE.bits();
        const WRIST_WEAR = EquipMask::WRIST_WEAR_LEFT.bits() | EquipMask::WRIST_WEAR_RIGHT.bits();
        const FINGER_WEAR = EquipMask::FINGER_WEAR_LEFT.bits() | EquipMask::FINGER_WEAR_RIGHT.bits();
        const SIGIL = EquipMask::SIGIL_ONE.bits() | EquipMask::SIGIL_TWO.bits() | EquipMask::SIGIL_THREE.bits();
    }
}

impl From<PseudoEquipMask> for EquipMask {
    fn from(value: PseudoEquipMask) -> Self {
        Self::from_bits_truncate(value.bits())
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct Usable: u32 {
        const UNDEF       = 0x00;
        const NO          = 0x01;
        const SELF        = 0x02;
        const WIELDED     = 0x04;
        const CONTAINED   = 0x08;
        const VIEWED      = 0x10;
        const REMOTE      = 0x20;
        const NEVER_WALK  = 0x40;
        const OBJ_SELF    = 0x80;

        const SOURCE_MASK = 0x0000FFFF;
        const TARGET_MASK = 0xFFFF0000;

        const CONTAINED_VIEWED = 0x08 | 0x10;
        const CONTAINED_VIEWED_REMOTE = 0x08 | 0x10 | 0x20;
        const CONTAINED_VIEWED_REMOTE_NEVER_WALK = 0x08 | 0x10 | 0x20 | 0x40;

        const VIEWED_REMOTE = 0x10 | 0x20;
        const VIEWED_REMOTE_NEVER_WALK = 0x10 | 0x20 | 0x40;

        const REMOTE_NEVER_WALK = 0x20 | 0x40;

        const SOURCE_WIELDED_TARGET_WIELDED = 0x040004;
        const SOURCE_WIELDED_TARGET_CONTAINED = 0x080004;
        const SOURCE_WIELDED_TARGET_VIEWED = 0x100004;
        const SOURCE_WIELDED_TARGET_REMOTE = 0x200004;
        const SOURCE_WIELDED_TARGET_REMOTE_NEVER_WALK = 0x600004;

        const SOURCE_CONTAINED_TARGET_WIELDED = 0x040008;
        const SOURCE_CONTAINED_TARGET_CONTAINED = 0x080008;
        const SOURCE_CONTAINED_TARGET_OBJSELF_OR_CONTAINED = 0x880008;
        const SOURCE_CONTAINED_TARGET_SELF_OR_CONTAINED = 0x0A0008;
        const SOURCE_CONTAINED_TARGET_VIEWED = 0x100008;
        const SOURCE_CONTAINED_TARGET_REMOTE = 0x200008;
        const SOURCE_CONTAINED_TARGET_REMOTE_NEVER_WALK = 0x600008;
        const SOURCE_CONTAINED_TARGET_REMOTE_OR_SELF = 0x220008;

        const SOURCE_VIEWED_TARGET_WIELDED = 0x040010;
        const SOURCE_VIEWED_TARGET_CONTAINED = 0x080010;
        const SOURCE_VIEWED_TARGET_VIEWED = 0x100010;
        const SOURCE_VIEWED_TARGET_REMOTE = 0x200010;

        const SOURCE_REMOTE_TARGET_WIELDED = 0x040020;
        const SOURCE_REMOTE_TARGET_CONTAINED = 0x080020;
        const SOURCE_REMOTE_TARGET_VIEWED = 0x100020;
        const SOURCE_REMOTE_TARGET_REMOTE = 0x200020;
        const SOURCE_REMOTE_TARGET_REMOTE_NEVER_WALK = 0x600020;
    }
}

impl Usable {
    pub fn from_raw(bits: u32) -> Self {
        Self::from_bits_retain(bits)
    }

    pub fn source_flags(self) -> Self {
        self & Self::SOURCE_MASK
    }

    pub fn target_flags(self) -> Self {
        Self::from_bits_retain(self.bits() >> 16)
    }

    pub fn location_flags(self) -> Self {
        self & (Self::SELF
            | Self::WIELDED
            | Self::CONTAINED
            | Self::VIEWED
            | Self::REMOTE
            | Self::OBJ_SELF)
    }
}
