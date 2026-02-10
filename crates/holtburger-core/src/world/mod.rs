pub mod entity;
pub mod physics_types;
pub mod player;
pub mod spatial;
pub mod state;
pub mod stats;

use holtburger_protocol::messages::magic::Enchantment;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::PropertyValue;
use holtburger_common::Guid;
use crate::world::entity::Entity;

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
    EnchantmentDispelled {
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
