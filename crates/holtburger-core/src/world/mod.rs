pub mod entity;
pub mod guid;
pub mod physics_types;
pub mod player;
pub mod position;
pub mod properties;
pub mod spatial;
pub mod state;
pub mod stats;

use crate::protocol::messages::Enchantment;
use crate::world::entity::Entity;
use crate::world::position::WorldPosition;
use crate::world::properties::PropertyValue;
pub use guid::Guid;

#[derive(Debug, Clone)]
pub enum WorldEvent {
    EntitySpawned(Box<Entity>),
    EntityMoved {
        guid: Guid,
        pos: WorldPosition,
    },
    EntityVectorUpdated {
        guid: Guid,
        velocity: crate::math::Vector3,
        omega: crate::math::Vector3,
    },
    EntityDespawned(Guid),
    VitalUpdated(stats::Vital),
    AttributeUpdated(stats::Attribute),
    SkillUpdated(stats::Skill),
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
    },
    EnchantmentUpdated(Enchantment),
    EnchantmentRemoved {
        spell_id: u16,
        layer: u16,
    },
    ServerTimeUpdate(f64),
    EnchantmentsPurged,
    DerivedStatsUpdated {
        attributes: Vec<stats::Attribute>,
        vitals: Vec<stats::Vital>,
        skills: Vec<stats::Skill>,
    },
    EntityStateUpdated {
        guid: Guid,
        physics_state: properties::PhysicsState,
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
