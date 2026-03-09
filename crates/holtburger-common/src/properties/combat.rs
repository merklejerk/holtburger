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
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
    pub struct DamageType: u32 {
        const UNDEF       = 0x0;
        const SLASH       = 0x1;
        const PIERCE      = 0x2;
        const BLUDGEON    = 0x4;
        const COLD        = 0x8;
        const FIRE        = 0x10;
        const ACID        = 0x20;
        const ELECTRIC    = 0x40;
        const HEALTH      = 0x80;
        const STAMINA     = 0x100;
        const MANA        = 0x200;
        const NETHER      = 0x400;
        const BASE        = 0x10000000;

        const PHYSICAL    = Self::SLASH.bits() | Self::PIERCE.bits() | Self::BLUDGEON.bits();
        const ELEMENTAL   = Self::COLD.bits() | Self::FIRE.bits() | Self::ACID.bits() | Self::ELECTRIC.bits();
    }
}

impl DamageType {
    pub fn name(&self) -> Option<&'static str> {
        if self.contains(Self::SLASH) {
            return Some("Slashing");
        }
        if self.contains(Self::PIERCE) {
            return Some("Piercing");
        }
        if self.contains(Self::BLUDGEON) {
            return Some("Bludgeoning");
        }
        if self.contains(Self::COLD) {
            return Some("Cold");
        }
        if self.contains(Self::FIRE) {
            return Some("Fire");
        }
        if self.contains(Self::ACID) {
            return Some("Acid");
        }
        if self.contains(Self::ELECTRIC) {
            return Some("Electric");
        }
        if self.contains(Self::HEALTH) {
            return Some("Health");
        }
        if self.contains(Self::STAMINA) {
            return Some("Stamina");
        }
        if self.contains(Self::MANA) {
            return Some("Mana");
        }
        if self.contains(Self::NETHER) {
            return Some("Nether");
        }
        if self.contains(Self::BASE) {
            return Some("Base");
        }
        None
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
    pub struct AttackType: u32 {
        const Undef               = 0;
        const Punch               = 0x0001;
        const Thrust              = 0x0002;
        const Slash               = 0x0004;
        const Kick                = 0x0008;
        const OffhandPunch        = 0x0010;
        const DoubleSlash         = 0x0020;
        const TripleSlash         = 0x0040;
        const DoubleThrust        = 0x0080;
        const TripleThrust        = 0x0100;
        const OffhandThrust       = 0x0200;
        const OffhandSlash        = 0x0400;
        const OffhandDoubleSlash  = 0x0800;
        const OffhandTripleSlash  = 0x1000;
        const OffhandDoubleThrust = 0x2000;
        const OffhandTripleThrust = 0x4000;

        const Unarmed             = Self::Punch.bits() | Self::Kick.bits() | Self::OffhandPunch.bits();

        const DoubleStrike        = Self::DoubleSlash.bits() | Self::DoubleThrust.bits() | Self::OffhandDoubleSlash.bits() | Self::OffhandDoubleThrust.bits();
        const TripleStrike        = Self::TripleSlash.bits() | Self::TripleThrust.bits() | Self::OffhandTripleSlash.bits() | Self::OffhandTripleThrust.bits();

        const Offhand             = Self::OffhandThrust.bits() | Self::OffhandSlash.bits() | Self::OffhandDoubleSlash.bits() | Self::OffhandTripleSlash.bits() | Self::OffhandDoubleThrust.bits() | Self::OffhandTripleThrust.bits();
        const Thrusts             = Self::Thrust.bits() | Self::DoubleThrust.bits() | Self::TripleThrust.bits() | Self::OffhandThrust.bits() | Self::OffhandDoubleThrust.bits() | Self::OffhandTripleThrust.bits();
        const Slashes             = Self::Slash.bits() | Self::DoubleSlash.bits() | Self::TripleSlash.bits() | Self::OffhandSlash.bits() | Self::OffhandDoubleSlash.bits() | Self::OffhandTripleSlash.bits();
        const Punches             = Self::Punch.bits() | Self::OffhandPunch.bits();

        const MultiStrike         = Self::DoubleStrike.bits() | Self::TripleStrike.bits();
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
    FromRepr,
    Display,
    Serialize,
    Deserialize,
    Default,
)]
#[repr(u32)]
pub enum WeaponType {
    #[default]
    Undef = 0,
    Unarmed = 1,
    Sword = 2,
    Axe = 3,
    Mace = 4,
    Spear = 5,
    Dagger = 6,
    Staff = 7,
    Bow = 8,
    Crossbow = 9,
    Thrown = 10,
    #[strum(serialize = "Two-Handed")]
    TwoHanded = 11,
    Magic = 12,
}
