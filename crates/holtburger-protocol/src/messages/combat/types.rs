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
