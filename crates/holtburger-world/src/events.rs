use crate::book::BookData;
use crate::entity::{Entity, EntityMotionSnapshot};
use crate::spatial::{RuntimeBodyResetCause, SpatialBodyId};
use crate::state;
use crate::stats;
use crate::vendor;
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::PropertyUpdate;
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::MovementEventData;
use holtburger_protocol::messages::magic::Enchantment;

#[derive(Debug, Clone)]
pub struct PlayerInfoData {
    /// Authoritative world/entity snapshot for the local player.
    pub entity: Box<Entity>,
    pub attributes: Vec<stats::Attribute>,
    pub vitals: Vec<stats::Vital>,
    pub skills: Vec<stats::Skill>,
    pub enchantments: Vec<Enchantment>,
    pub spells: Vec<u32>,
    pub level_info: stats::CharacterLevelInfo,
    pub resistances: stats::Resistances,
    pub armor: i32,
    pub vitae: f32,
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
pub enum FellowshipActivity {
    YouJoined { fellowship_name: String },
    MemberJoined { member_name: String },
    YouLeft,
    MemberLeft { member_name: String },
    YouWereDismissed,
    MemberWasDismissed { member_name: String },
    FellowshipDisbanded { fellowship_name: Option<String> },
}

#[derive(Debug, Clone)]
pub enum WorldEvent {
    EntitySpawned(Box<Entity>),
    EntityReplaced(Box<Entity>),
    EntityHealthUpdated {
        guid: Guid,
        health_fraction: f32,
    },
    EntityBookUpdated {
        guid: Guid,
        book: Box<BookData>,
    },
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
        snapshot: Option<EntityMotionSnapshot>,
    },
    RuntimeBodyChanged {
        body_id: SpatialBodyId,
    },
    RuntimeBodyRemoved {
        body_id: SpatialBodyId,
    },
    RuntimeBodiesReset {
        cause: RuntimeBodyResetCause,
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
    SelfUpdatePosition {
        teleport_sequence: u16,
        force_position_sequence: u16,
    },
    SelfAutonomousPosition {
        teleport_sequence: u16,
        force_position_sequence: u16,
        server_control_sequence: u16,
    },
    SpellUpdated {
        spell_id: u32,
        name: Option<String>,
        spell_ids: Vec<u32>,
    },
    SpellRemoved {
        spell_id: u32,
        spell_ids: Vec<u32>,
    },
    CombatModeUpdated(holtburger_protocol::messages::combat::CombatMode),
    ServerTimeUpdate(f64),
    TeleportStarted {
        sequence: u16,
    },
    DerivedStatsUpdated(Box<DerivedStatsData>),
    EntityStateUpdated {
        guid: Guid,
        physics_state: holtburger_common::properties::PhysicsState,
    },
    // Keep the full protocol payload for now: a future 3D client will likely need
    // richer server-authored movement detail than the current core/TUI consumer.
    SelfServerControlledMotion(Box<MovementEventData>),
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
    FellowshipStateUpdated(Option<state::FellowshipState>),
    FellowshipActivity(FellowshipActivity),
    TradeStateUpdated(Option<state::TradeState>),
}
