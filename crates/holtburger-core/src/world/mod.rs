pub mod entity;
pub mod magic;
pub mod physics_types;
pub mod player;
pub mod spatial;
pub mod state;
pub mod stats;

use crate::world::entity::Entity;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::PropertyValue;
use holtburger_protocol::messages::magic::Enchantment;

#[derive(Debug, Clone)]
pub enum WorldEvent {
    EntitySpawned(Box<Entity>),
    EntityMoved {
        guid: Guid,
        pos: WorldPosition,
    },
    EntityIdentified(Box<Entity>),
    EntityVectorUpdated {
        guid: Guid,
        velocity: holtburger_common::math::Vector3,
        omega: holtburger_common::math::Vector3,
    },
    EntityDespawned(Guid),
    VitalUpdated(stats::Vital),
    AttributeUpdated(stats::Attribute),
    SkillUpdated(stats::Skill),
    LevelInfoUpdated(stats::CharacterLevelInfo),
    PropertyUpdated {
        guid: Guid,
        property_id: u32,
        value: PropertyValue,
    },
    PlayerInfo {
        guid: Guid,
        name: String,
        pos: Option<WorldPosition>,
        attributes: Vec<stats::Attribute>,
        vitals: Vec<stats::Vital>,
        skills: Vec<stats::Skill>,
        enchantments: Vec<Enchantment>,
        spells: Vec<u32>,
        vitae: f32,
        skill_table: Option<std::sync::Arc<holtburger_dat::file_type::skill_table::SkillTable>>,
        spell_names: std::collections::HashMap<u32, String>,
    },
    EnchantmentUpdated {
        enchantment: Enchantment,
        spell_name: Option<String>,
    },
    EnchantmentRemoved {
        spell_id: u16,
        layer: u16,
    },
    EnchantmentDispelled {
        spell_id: u16,
        layer: u16,
    },
    SpellUpdated {
        spell_id: u32,
    },
    SpellRemoved {
        spell_id: u32,
    },
    ServerTimeUpdate(f64),
    EnchantmentsPurged,
    DerivedStatsUpdated {
        attributes: Vec<stats::Attribute>,
        vitals: Vec<stats::Vital>,
        skills: Vec<stats::Skill>,
        resistances: stats::Resistances,
        armor: u32,
        vitae: f32,
    },
    EntityStateUpdated {
        guid: Guid,
        physics_state: holtburger_common::properties::PhysicsState,
    },
    ForcedReposition {
        guid: Guid,
        pos: WorldPosition,
        sequence: u16,
    },
    WeenieError {
        error_id: u32,
    },
    WeenieErrorWithString {
        error_id: u32,
        message: String,
    },
}

pub use self::state::WorldState;
