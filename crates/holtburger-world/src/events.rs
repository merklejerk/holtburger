use crate::entity::{Entity, EntityMotionSnapshot};
use crate::state;
use crate::stats;
use crate::vendor;
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
    pub player_entity: Option<Box<Entity>>,
    pub attributes: Vec<stats::Attribute>,
    pub vitals: Vec<stats::Vital>,
    pub skills: Vec<stats::Skill>,
    pub enchantments: Vec<Enchantment>,
    pub spells: Vec<u32>,
    pub level_info: stats::CharacterLevelInfo,
    pub resistances: stats::Resistances,
    pub armor: i32,
    pub vitae: f32,
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
pub enum WorldEvent {
    EntitySpawned(Box<Entity>),
    EntityReplaced(Box<Entity>),
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
    EntityMotionUpdated {
        guid: Guid,
        snapshot: EntityMotionSnapshot,
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
    PlayerGroundedUpdated {
        grounded: bool,
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
    TeleportStarted {
        sequence: u16,
    },
    DerivedStatsUpdated(Box<DerivedStatsData>),
    EntityStateUpdated {
        guid: Guid,
        physics_state: holtburger_common::properties::PhysicsState,
    },
    SelfUpdateMotionProcessed {
        server_control_sequence: u16,
        movement_sequence: u16,
        accepted: bool,
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
    VendorItemIdentified(Box<vendor::CoreVendorItem>),
    TradeStateUpdated(Option<state::TradeState>),
}
