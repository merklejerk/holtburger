pub use holtburger_common::stats::{AttributeType, SkillType, TrainingLevel, VitalType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Attribute {
    pub attr_type: AttributeType,
    pub ranks: u32,
    pub start: u32,
    pub spent_xp: u32,
    pub next_rank_xp: Option<u32>,
    pub base: u32,
    pub current: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Vital {
    pub vital_type: VitalType,
    pub ranks: u32,
    pub start: u32,
    pub spent_xp: u32,
    pub next_rank_xp: Option<u32>,
    pub base: u32,       // Max Vital (unbuffed)
    pub buffed_max: u32, // Max Vital (including enchantments)
    pub current: u32,    // Current pool
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Skill {
    pub skill_type: SkillType,
    pub ranks: u32,
    pub init: u32,
    pub spent_xp: u32,
    pub next_rank_xp: Option<u32>,
    pub base: u32,
    pub current: u32,
    pub training: TrainingLevel,
    /// The cost to train this skill from Untrained to Trained.
    pub trained_cost: u32,
    /// The cost to train this skill from Trained to Specialized.
    pub specialized_cost: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Resistances {
    pub slash: f32,
    pub pierce: f32,
    pub bludgeon: f32,
    pub fire: f32,
    pub cold: f32,
    pub acid: f32,
    pub electric: f32,
    pub nether: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct CharacterLevelInfo {
    pub level: u32,
    pub current_xp: u64,
    pub unspent_xp: u64,
    pub unspent_skill_points: u32,
    pub available_luminance: u64,
    pub next_level_xp: u64,
    pub xp_into_level: u64,
    pub xp_for_next_level: u64,
}
