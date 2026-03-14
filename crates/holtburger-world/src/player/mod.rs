pub mod magic;
pub mod movement;
pub mod mutations;
pub mod stats_calc;
pub mod types;

pub use types::{PlayerState, SkillBase, VitalBase};

#[cfg(test)]
pub(crate) use crate::stats;
#[cfg(test)]
pub(crate) use holtburger_common::Guid;
#[cfg(test)]
pub(crate) use holtburger_protocol::messages::magic::Enchantment;

#[cfg(test)]
mod tests;
