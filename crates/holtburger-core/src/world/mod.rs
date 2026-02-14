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
pub struct PlayerInfoData {
    pub guid: Guid,
    pub name: String,
    pub pos: Option<WorldPosition>,
    pub attributes: Vec<stats::Attribute>,
    pub vitals: Vec<stats::Vital>,
    pub skills: Vec<stats::Skill>,
    pub enchantments: Vec<Enchantment>,
    pub spells: Vec<u32>,
    pub vitae: f32,
    pub skill_table: Option<std::sync::Arc<holtburger_dat::file_type::skill_table::SkillTable>>,
    pub spell_names: std::collections::HashMap<u32, String>,
    pub inventory: std::collections::HashSet<Guid>,
    pub equipment: std::collections::HashMap<Guid, holtburger_protocol::messages::EquipMask>,
}

#[derive(Debug, Clone)]
pub struct DerivedStatsData {
    pub attributes: Vec<stats::Attribute>,
    pub vitals: Vec<stats::Vital>,
    pub skills: Vec<stats::Skill>,
    pub resistances: stats::Resistances,
    pub armor: u32,
    pub vitae: f32,
}

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
    PlayerInfo(Box<PlayerInfoData>),
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
        name: Option<String>,
    },
    SpellRemoved {
        spell_id: u32,
    },
    CombatModeUpdated(holtburger_protocol::messages::combat::CombatMode),
    ServerTimeUpdate(f64),
    EnchantmentsPurged,
    DerivedStatsUpdated(Box<DerivedStatsData>),
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

#[derive(Debug, PartialEq, Eq, Hash)]
pub enum EventDedupeKey {
    DerivedStats,
    Vital(stats::VitalType),
    Attribute(stats::AttributeType),
    Skill(stats::SkillType),
    CombatMode,
    LevelInfo,
    ServerTime,
    EntityPosition(Guid),
    EntityVector(Guid),
    EntityState(Guid),
}

impl holtburger_common::traits::Deduplicable for WorldEvent {
    type Key = EventDedupeKey;

    fn dedupe_key(&self) -> Option<Self::Key> {
        match self {
            WorldEvent::DerivedStatsUpdated(_) => Some(EventDedupeKey::DerivedStats),
            WorldEvent::VitalUpdated(v) => Some(EventDedupeKey::Vital(v.vital_type)),
            WorldEvent::AttributeUpdated(a) => Some(EventDedupeKey::Attribute(a.attr_type)),
            WorldEvent::SkillUpdated(s) => Some(EventDedupeKey::Skill(s.skill_type)),
            WorldEvent::CombatModeUpdated(_) => Some(EventDedupeKey::CombatMode),
            WorldEvent::LevelInfoUpdated(_) => Some(EventDedupeKey::LevelInfo),
            WorldEvent::ServerTimeUpdate(_) => Some(EventDedupeKey::ServerTime),
            WorldEvent::EntityMoved { guid, .. } => Some(EventDedupeKey::EntityPosition(*guid)),
            WorldEvent::EntityVectorUpdated { guid, .. } => {
                Some(EventDedupeKey::EntityVector(*guid))
            }
            WorldEvent::EntityStateUpdated { guid, .. } => Some(EventDedupeKey::EntityState(*guid)),
            _ => None,
        }
    }
}

pub fn dedupe_world_events(events: Vec<WorldEvent>) -> Vec<WorldEvent> {
    holtburger_common::traits::dedupe_events(events)
}

pub use self::state::WorldState;
