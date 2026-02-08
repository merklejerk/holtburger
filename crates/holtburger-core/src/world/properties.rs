use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use crate::world::Guid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PropertyInt {
    ItemType = 1,
    CreatureType = 2,
    ItemUseable = 16,
    RadarBlipColor = 95,
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
        const REPORT_COLLISIONS              = 0x00000008;
        const IGNORE_COLLISIONS              = 0x00000010;
        const NO_DRAW                        = 0x00000020;
        const MISSILE                       = 0x00000040;
        const PUSHABLE                      = 0x00000080;
        const ALIGN_PATH                     = 0x00000100;
        const PATH_CLIPPED                   = 0x00000200;
        const GRAVITY                       = 0x00000400;
        const LIGHTING_ON                    = 0x00000800;
        const PARTICLE_EMITTER               = 0x00001000;
        const UNUSED2                       = 0x00002000;
        const HIDDEN                        = 0x00004000;
        const SCRIPTED_COLLISION             = 0x00008000;
        const HAS_PHYSICS_BSP                 = 0x00010000;
        const INELASTIC                     = 0x00020000;
        const HAS_DEFAULT_ANIM                = 0x00040000;
        const HAS_DEFAULT_SCRIPT              = 0x00080000;
        const CLOAKED                       = 0x00100000;
        const REPORT_COLLISIONS_AS_ENVIRONMENT = 0x00200000;
        const EDGE_SLIDE                     = 0x00400000;
        const SLEDDING                      = 0x00800000;
        const FROZEN                        = 0x01000000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct EnchantmentTypeFlags: u32 {
        const UNDEF                  = 0x0000000;
        const ATTRIBUTE              = 0x0000001;
        const SECOND_ATT              = 0x0000002;
        const INT                    = 0x0000004;
        const FLOAT                  = 0x0000008;
        const SKILL                  = 0x0000010;
        const BODY_DAMAGE_VALUE        = 0x0000020;
        const BODY_DAMAGE_VARIANCE     = 0x0000040;
        const BODY_ARMOR_VALUE         = 0x0000080;
        const SINGLE_STAT             = 0x0001000;
        const MULTIPLE_STAT           = 0x0002000;
        const MULTIPLICATIVE         = 0x0004000;
        const ADDITIVE               = 0x0008000;
        const ATTACK_SKILLS           = 0x0010000;
        const DEFENSE_SKILLS          = 0x0020000;
        const MULTIPLICATIVE_DEGRADE = 0x0100000;
        const ADDITIVE_DEGRADE       = 0x0200000;
        const VITAE                  = 0x0800000;
        const COOLDOWN               = 0x1000000;
        const BENEFICIAL             = 0x2000000;
        const STAT_TYPES              = 0x00000FF;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct WeenieHeaderFlag: u32 {
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
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct WeenieHeaderFlag2: u32 {
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
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct UpdatePositionFlag: u32 {
        const NONE = 0x00;
        const HAS_VELOCITY = 0x01;
        const HAS_PLACEMENT_ID = 0x02;
        const IS_GROUNDED = 0x04;
        const ORIENTATION_HAS_NO_W = 0x08;
        const ORIENTATION_HAS_NO_X = 0x10;
        const ORIENTATION_HAS_NO_Y = 0x20;
        const ORIENTATION_HAS_NO_Z = 0x40;
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
    Undef = 0,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PropertyValue {
    Int(i32),
    Int64(i64),
    Bool(bool),
    Float(f64),
    String(String),
    DID(Guid),
    IID(Guid),
}
