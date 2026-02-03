pub mod entity;
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

#[derive(Debug, Clone)]
pub enum WorldEvent {
    EntitySpawned(Box<Entity>),
    EntityMoved {
        guid: u32,
        pos: WorldPosition,
    },
    EntityDespawned(u32),
    VitalUpdated(stats::Vital),
    AttributeUpdated(stats::Attribute),
    SkillUpdated(stats::Skill),
    PropertyUpdated {
        guid: u32,
        property_id: u32,
        value: PropertyValue,
    },
    PlayerInfo {
        guid: u32,
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
}

pub use self::state::WorldState;
