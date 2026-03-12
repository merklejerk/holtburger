use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize)]
#[repr(u32)]
pub enum AttackHeight {
    High = 0x01,
    Medium = 0x02,
    Low = 0x03,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize)]
#[repr(u32)]
pub enum CombatMode {
    Undef = 0x00,
    NonCombat = 0x01,
    Melee = 0x02,
    Missile = 0x04,
    Magic = 0x08,
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct AttackConditions: u64 {
        const NONE = 0x0;
        const CRITICAL_PROTECTION_AUGMENTATION = 0x1;
        const RECKLESSNESS = 0x2;
        const SNEAK_ATTACK = 0x4;
        const OVERPOWER = 0x8;
    }
}

impl AttackConditions {
    pub fn iter_display_names(&self) -> impl Iterator<Item = &'static str> {
        self.iter_names().map(|(name, _)| match name {
            "CRITICAL_PROTECTION_AUGMENTATION" => "Critical Protection Augmentation",
            "RECKLESSNESS" => "Recklessness",
            "SNEAK_ATTACK" => "Sneak Attack",
            "OVERPOWER" => "Overpower",
            _ => name,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize)]
#[repr(u32)]
pub enum DamageLocation {
    Head = 0x0,
    Chest = 0x1,
    Abdomen = 0x2,
    UpperArm = 0x3,
    LowerArm = 0x4,
    Hand = 0x5,
    UpperLeg = 0x6,
    LowerLeg = 0x7,
    Foot = 0x8,
}
