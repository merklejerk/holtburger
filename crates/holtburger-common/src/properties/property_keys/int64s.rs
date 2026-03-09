use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, FromRepr, Display, Serialize, Deserialize,
)]
#[repr(u32)]
pub enum PropertyInt64 {
    TotalExperience = 1,
    AvailableExperience = 2,
    AugmentationCost = 3,
    ItemTotalXp = 4,
    ItemBaseXp = 5,
    AvailableLuminance = 6,
    MaximumLuminance = 7,
    InteractionReqs = 8,
}
