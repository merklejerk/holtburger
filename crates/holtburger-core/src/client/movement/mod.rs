mod common;
mod system;

#[cfg(test)]
#[path = "character_motion_retail_differential.rs"]
pub(crate) mod character_motion_retail_differential;

pub(super) use system::{MovementSystem, PendingJumpAttempt};
