use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
    pub struct ImbuedEffectType: u32 {
        const Undef                           = 0;
        const CriticalStrike                  = 0x0001;
        const CripplingBlow                   = 0x0002;
        const ArmorRending                    = 0x0004;
        const SlashRending                    = 0x0008;
        const PierceRending                   = 0x0010;
        const BludgeonRending                 = 0x0020;
        const AcidRending                     = 0x0040;
        const ColdRending                     = 0x0080;
        const ElectricRending                 = 0x0100;
        const FireRending                     = 0x0200;
        const MeleeDefense                    = 0x0400;
        const MissileDefense                  = 0x0800;
        const MagicDefense                    = 0x1000;
        const Spellbook                       = 0x2000;
        const NetherRending                   = 0x4000;
        const IgnoreSomeMagicProjectileDamage = 0x20000000;
        const AlwaysCritical                  = 0x40000000;
        const IgnoreAllArmor                  = 0x80000000;
    }
}

impl ImbuedEffectType {
    pub fn name(&self) -> Option<&'static str> {
        match *self {
            Self::CriticalStrike => Some("Critical Strike"),
            Self::CripplingBlow => Some("Crippling Blow"),
            Self::ArmorRending => Some("Armor Rending"),
            Self::SlashRending => Some("Slash Rending"),
            Self::PierceRending => Some("Pierce Rending"),
            Self::BludgeonRending => Some("Bludgeon Rending"),
            Self::AcidRending => Some("Acid Rending"),
            Self::ColdRending => Some("Cold Rending"),
            Self::ElectricRending => Some("Electric Rending"),
            Self::FireRending => Some("Fire Rending"),
            Self::MeleeDefense => Some("Melee Defense"),
            Self::MissileDefense => Some("Missile Defense"),
            Self::MagicDefense => Some("Magic Defense"),
            Self::Spellbook => Some("Spellbook"),
            Self::NetherRending => Some("Nether Rending"),
            Self::IgnoreSomeMagicProjectileDamage => Some("Ignore Some Magic Projectile Damage"),
            Self::AlwaysCritical => Some("Always Critical"),
            Self::IgnoreAllArmor => Some("Ignore All Armor"),
            _ => None,
        }
    }

    pub fn names(&self) -> Vec<&'static str> {
        let mut names = Vec::new();
        if self.contains(Self::CriticalStrike) {
            names.push("Critical Strike");
        }
        if self.contains(Self::CripplingBlow) {
            names.push("Crippling Blow");
        }
        if self.contains(Self::ArmorRending) {
            names.push("Armor Rending");
        }
        if self.contains(Self::SlashRending) {
            names.push("Slash Rending");
        }
        if self.contains(Self::PierceRending) {
            names.push("Pierce Rending");
        }
        if self.contains(Self::BludgeonRending) {
            names.push("Bludgeon Rending");
        }
        if self.contains(Self::AcidRending) {
            names.push("Acid Rending");
        }
        if self.contains(Self::ColdRending) {
            names.push("Cold Rending");
        }
        if self.contains(Self::ElectricRending) {
            names.push("Electric Rending");
        }
        if self.contains(Self::FireRending) {
            names.push("Fire Rending");
        }
        if self.contains(Self::MeleeDefense) {
            names.push("Melee Defense");
        }
        if self.contains(Self::MissileDefense) {
            names.push("Missile Defense");
        }
        if self.contains(Self::MagicDefense) {
            names.push("Magic Defense");
        }
        if self.contains(Self::Spellbook) {
            names.push("Spellbook");
        }
        if self.contains(Self::NetherRending) {
            names.push("Nether Rending");
        }
        if self.contains(Self::IgnoreSomeMagicProjectileDamage) {
            names.push("Ignore Some Magic Projectile Damage");
        }
        if self.contains(Self::AlwaysCritical) {
            names.push("Always Critical");
        }
        if self.contains(Self::IgnoreAllArmor) {
            names.push("Ignore All Armor");
        }
        names
    }
}

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

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct ObjectDescriptionFlag: u32 {
        const NONE = 0x00000000;
        const OPENABLE = 0x00000001;
        const INSCRIBABLE = 0x00000002;
        const STUCK = 0x00000004;
        const PLAYER = 0x00000008;
        const ATTACKABLE = 0x00000010;
        const PLAYER_KILLER = 0x00000020;
        const HIDDEN_ADMIN = 0x00000040;
        const UI_HIDDEN = 0x00000080;
        const BOOK = 0x00000100;
        const VENDOR = 0x00000200;
        const PK_SWITCH = 0x00000400;
        const NPK_SWITCH = 0x00000800;
        const DOOR = 0x00001000;
        const CORPSE = 0x00002000;
        const LIFE_STONE = 0x00004000;
        const FOOD = 0x00008000;
        const HEALER = 0x00010000;
        const LOCKPICK = 0x00020000;
        const PORTAL = 0x00040000;
        const ADMIN = 0x00100000;
        const FREE_PK_STATUS = 0x00200000;
        const IMMUNE_CELL_RESTRICTIONS = 0x00400000;
        const REQUIRES_PACK_SLOT = 0x00800000;
        const RETAINED = 0x01000000;
        const PK_LITE_STATUS = 0x02000000;
        const INCLUDES_SECOND_HEADER = 0x04000000;
        const BIND_STONE = 0x08000000;
        const VOLATILE_RARE = 0x10000000;
        const WIELD_ON_USE = 0x20000000;
        const WIELD_LEFT = 0x40000000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct PhysicsState: u32 {
        const NONE                          = 0x00000000;
        const STATIC                        = 0x00000001;
        const UNUSED1                       = 0x00000002;
        const ETHEREAL                      = 0x00000004;
        const REPORT_COLLISIONS             = 0x00000008;
        const IGNORE_COLLISIONS             = 0x00000010;
        const NO_DRAW                       = 0x00000020;
        const MISSILE                       = 0x00000040;
        const PUSHABLE                      = 0x00000080;
        const ALIGN_PATH                    = 0x00000100;
        const PATH_CLIPPED                  = 0x00000200;
        const GRAVITY                       = 0x00000400;
        const LIGHTING_ON                   = 0x00000800;
        const PARTICLE_EMITTER              = 0x00001000;
        const UNUSED2                       = 0x00002000;
        const HIDDEN                        = 0x00004000;
        const SCRIPTED_COLLISION            = 0x00008000;
        const HAS_PHYSICS_BSP               = 0x00010000;
        const INELASTIC                     = 0x00020000;
        const HAS_DEFAULT_ANIM              = 0x00040000;
        const HAS_DEFAULT_SCRIPT            = 0x00080000;
        const CLOAKED                       = 0x00100000;
        const REPORT_COLLISIONS_AS_ENVIRONMENT = 0x00200000;
        const EDGE_SLIDE                    = 0x00400000;
        const SLEDDING                      = 0x00800000;
        const FROZEN                        = 0x01000000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct EnchantmentTypeFlags: u32 {
        const UNDEF                  = 0x0000000;
        const ATTRIBUTE              = 0x0000001;
        const SECOND_ATT             = 0x0000002;
        const INT                    = 0x0000004;
        const FLOAT                  = 0x0000008;
        const SKILL                  = 0x0000010;
        const BODY_DAMAGE_VALUE      = 0x0000020;
        const BODY_DAMAGE_VARIANCE   = 0x0000040;
        const BODY_ARMOR_VALUE       = 0x0000080;
        const SINGLE_STAT            = 0x0001000;
        const MULTIPLE_STAT          = 0x0002000;
        const MULTIPLICATIVE         = 0x0004000;
        const ADDITIVE               = 0x0008000;
        const ATTACK_SKILLS          = 0x0010000;
        const DEFENSE_SKILLS         = 0x0020000;
        const MULTIPLICATIVE_DEGRADE = 0x0100000;
        const ADDITIVE_DEGRADE       = 0x0200000;
        const VITAE                  = 0x0800000;
        const COOLDOWN               = 0x1000000;
        const BENEFICIAL             = 0x2000000;
        const STAT_TYPES             = 0x00000FF;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct WeenieHeaderFlag: u32 {
        const NONE = 0x00000000;
        const PLURAL_NAME = 0x00000001;
        const ITEMS_CAPACITY = 0x00000002;
        const CONTAINERS_CAPACITY = 0x00000004;
        const VALUE = 0x00000008;
        const USABLE = 0x00000010;
        const USE_RADIUS = 0x00000020;
        const MONARCH = 0x00000040;
        const UI_EFFECTS = 0x00000080;
        const AMMO_TYPE = 0x00000100;
        const COMBAT_USE = 0x00000200;
        const STRUCTURE = 0x00000400;
        const MAX_STRUCTURE = 0x00000800;
        const STACK_SIZE = 0x00001000;
        const MAX_STACK_SIZE = 0x00002000;
        const CONTAINER = 0x00004000;
        const WIELDER = 0x00008000;
        const VALID_LOCATIONS = 0x00010000;
        const CURRENTLY_WIELDED_LOCATION = 0x00020000;
        const PRIORITY = 0x00040000;
        const TARGET_TYPE = 0x00080000;
        const RADAR_BLIP_COLOR = 0x00100000;
        const BURDEN = 0x00200000;
        const SPELL = 0x00400000;
        const RADAR_BEHAVIOR = 0x00800000;
        const WORKMANSHIP = 0x01000000;
        const HOUSE_OWNER = 0x02000000;
        const HOUSE_RESTRICTIONS = 0x04000000;
        const PSCRIPT = 0x08000000;
        const HOOK_TYPE = 0x10000000;
        const HOOK_ITEM_TYPES = 0x20000000;
        const ICON_OVERLAY = 0x40000000;
        const MATERIAL_TYPE = 0x80000000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct WeenieHeaderFlag2: u32 {
        const NONE = 0x00;
        const ICON_UNDERLAY = 0x01;
        const COOLDOWN = 0x02;
        const COOLDOWN_DURATION = 0x04;
        const PET_OWNER = 0x08;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct PhysicsDescriptionFlag: u32 {
        const NONE = 0x000000;
        const CSETUP = 0x000001;
        const MTABLE = 0x000002;
        const VELOCITY = 0x000004;
        const ACCELERATION = 0x000008;
        const OMEGA = 0x000010;
        const PARENT = 0x000020;
        const CHILDREN = 0x000040;
        const OBJSCALE = 0x000080;
        const FRICTION = 0x000100;
        const ELASTICITY = 0x000200;
        const TIMESTAMPS = 0x000400;
        const STABLE = 0x000800;
        const PETABLE = 0x001000;
        const DEFAULT_SCRIPT = 0x002000;
        const DEFAULT_SCRIPT_INTENSITY = 0x004000;
        const POSITION = 0x008000;
        const MOVEMENT = 0x010000;
        const ANIMATION_FRAME = 0x020000;
        const TRANSLUCENCY = 0x040000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct IdentifyResponseFlags: u32 {
        const NONE = 0x0000;
        const INT_STATS_TABLE = 0x0001;
        const BOOL_STATS_TABLE = 0x0002;
        const FLOAT_STATS_TABLE = 0x0004;
        const STRING_STATS_TABLE = 0x0008;
        const SPELL_BOOK = 0x0010;
        const WEAPON_PROFILE = 0x0020;
        const HOOK_PROFILE = 0x0040;
        const ARMOR_PROFILE = 0x0080;
        const CREATURE_PROFILE = 0x0100;
        const ARMOR_ENCHANTMENT_BITFIELD = 0x0200;
        const RESIST_ENCHANTMENT_BITFIELD = 0x0400;
        const WEAPON_ENCHANTMENT_BITFIELD = 0x0800;
        const DID_STATS_TABLE = 0x1000;
        const INT64_STATS_TABLE = 0x2000;
        const ARMOR_LEVELS = 0x4000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct GfxObjFlags: u32 {
        const NONE = 0x00000000;
        const HAS_PHYSICS = 0x00000001;
        const HAS_DRAWING = 0x00000002;
        const UNKNOWN = 0x00000004;
        const HAS_DID_DEGRADE = 0x00000008;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WeenieType {
    Generic = 1,
    Clothing = 2,
    MissileLauncher = 3,
    Missile = 4,
    Ammunition = 5,
    MeleeWeapon = 6,
    Portal = 7,
    Book = 8,
    Coin = 9,
    Creature = 10,
    Admin = 11,
    Vendor = 12,
    HotSpot = 13,
    Corpse = 14,
    Cow = 15,
    AI = 16,
    Machine = 17,
    Food = 18,
    Door = 19,
    Chest = 20,
    Container = 21,
    Key = 22,
    Lockpick = 23,
    PressurePlate = 24,
    LifeStone = 25,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, FromRepr, Display)]
#[repr(u8)]
pub enum RadarColor {
    Default = 0x00,
    Blue = 0x01,
    Gold = 0x02,
    White = 0x03,
    Purple = 0x04,
    Red = 0x05,
    Pink = 0x06,
    Green = 0x07,
    Yellow = 0x08,
    Cyan = 0x09,
    BrightGreen = 0x10,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, FromRepr, Display, Default)]
#[repr(u8)]
pub enum RadarBehavior {
    #[default]
    Undefined = 0,
    ShowNever = 1,
    ShowMovement = 2,
    ShowAttacking = 3,
    ShowAlways = 4,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize, Default)]
#[repr(u8)]
pub enum CombatUse {
    #[default]
    None = 0,
    Melee = 1,
    Missile = 2,
    Ammo = 3,
    Shield = 4,
    TwoHanded = 5,
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