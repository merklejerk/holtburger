pub mod context;
pub mod entity;
pub mod hydration;
pub mod magic;
pub mod player;
pub mod spatial;
pub mod state;
pub mod stats;
pub mod vendor;

use crate::entity::Entity;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::PropertyUpdate;
use holtburger_protocol::errors::WeenieError;
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
    pub armor: i32,
    pub vitae: f32,
}

#[derive(Debug, Clone)]
pub enum StateEvent {
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
    PropertiesUpdated {
        guid: Guid,
        updates: Vec<PropertyUpdate>,
    },
    PlayerInfo(Box<PlayerInfoData>),
    PlayerEnchantmentsUpdated {
        enchantments: Vec<Enchantment>,
    },
    SpellUpdated {
        spell_id: u32,
        name: Option<String>,
    },
    SpellRemoved {
        spell_id: u32,
    },
    CombatModeUpdated(holtburger_protocol::messages::combat::CombatMode),
    NoClipUpdated(bool),
    ServerTimeUpdate(f64),
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
        error: WeenieError,
    },
    WeenieErrorWithString {
        error: WeenieError,
        parameter: String,
    },
    UseDone {
        error: WeenieError,
    },
    ContainerOpened(Guid),
    ContainerClosed(Guid),
    VendorStateUpdated(Option<vendor::VendorState>),
    TradeStateUpdated(Option<state::TradeState>),
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

impl holtburger_common::traits::Deduplicable for StateEvent {
    type Key = EventDedupeKey;

    fn dedupe_key(&self) -> Option<Self::Key> {
        match self {
            StateEvent::DerivedStatsUpdated(_) => Some(EventDedupeKey::DerivedStats),
            StateEvent::VitalUpdated(v) => Some(EventDedupeKey::Vital(v.vital_type)),
            StateEvent::AttributeUpdated(a) => Some(EventDedupeKey::Attribute(a.attr_type)),
            StateEvent::SkillUpdated(s) => Some(EventDedupeKey::Skill(s.skill_type)),
            StateEvent::CombatModeUpdated(_) => Some(EventDedupeKey::CombatMode),
            StateEvent::LevelInfoUpdated(_) => Some(EventDedupeKey::LevelInfo),
            StateEvent::ServerTimeUpdate(_) => Some(EventDedupeKey::ServerTime),
            StateEvent::EntityMoved { guid, .. } => Some(EventDedupeKey::EntityPosition(*guid)),
            StateEvent::EntityVectorUpdated { guid, .. } => {
                Some(EventDedupeKey::EntityVector(*guid))
            }
            StateEvent::EntityStateUpdated { guid, .. } => Some(EventDedupeKey::EntityState(*guid)),
            _ => None,
        }
    }
}

pub fn dedupe_state_events(events: Vec<StateEvent>) -> Vec<StateEvent> {
    holtburger_common::traits::dedupe_events(events)
}

pub use self::state::WorldState;
