use crate::world::stats;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct SkillBase {
    pub ranks: u32,
    pub init: u32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct VitalBase {
    pub ranks: u32,
    pub start: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct LastSentStats {
    pub attributes: Vec<stats::Attribute>,
    pub vitals: Vec<stats::Vital>,
    pub skills: Vec<stats::Skill>,
    pub resistances: stats::Resistances,
    pub armor: i32,
    pub vitae: f32,
}
