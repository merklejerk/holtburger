use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize)]
#[repr(u32)]
pub enum CombatMode {
    Undef = 0x00,
    NonCombat = 0x01,
    Melee = 0x02,
    Missile = 0x04,
    Magic = 0x08,
}
