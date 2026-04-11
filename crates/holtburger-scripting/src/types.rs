use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_core::{ActiveCharacterConfirmation, BusyOperationKind};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptSource {
    pub name: String,
    pub source: String,
}

impl ScriptSource {
    pub fn new(name: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            source: source.into(),
        }
    }
}

/// Script-facing snapshot of client-visible state.
///
/// Implementations should project semantic frontend state and avoid leaking
/// widget-local concerns such as focus or scroll position.
pub trait ScriptClientView {
    fn self_entity(&self) -> Option<ScriptSelfView>;
    fn target_entity(&self) -> Option<ScriptEntityView>;
    fn entity(&self, guid: Guid) -> Option<ScriptEntityView>;
    fn nearby_entities(&self) -> Vec<ScriptEntityView>;
    fn inventory_items(&self) -> Vec<ScriptInventoryItemView>;
    fn fellowship(&self) -> Option<ScriptPartyView>;
    fn active_spells(&self) -> Vec<ScriptSpellEffectView>;
    fn server_time(&self) -> Option<f64>;
    fn pending_confirmation(&self) -> Option<ScriptConfirmation>;
    fn busy_operation(&self) -> ScriptBusyOperation;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptSelfView {
    pub guid: Guid,
    pub name: String,
    pub position: WorldPosition,
    pub health: u32,
    pub health_max: u32,
    pub stamina: u32,
    pub stamina_max: u32,
    pub mana: u32,
    pub mana_max: u32,
    pub encumbrance: f32,
    pub capacity: f32,
    pub busy_operation: ScriptBusyOperation,
    pub heading: f32,
    pub combat_mode: CombatMode,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptBusyOperation {
    #[default]
    None,
    Use,
    UseWithTarget,
    Salvage,
    SpellCast,
    Buy,
    Sell,
}

impl ScriptBusyOperation {
    pub const fn from_kind(kind: BusyOperationKind) -> Self {
        match kind {
            BusyOperationKind::Use => Self::Use,
            BusyOperationKind::UseWithTarget => Self::UseWithTarget,
            BusyOperationKind::Salvage => Self::Salvage,
            BusyOperationKind::SpellCast => Self::SpellCast,
            BusyOperationKind::Buy => Self::Buy,
            BusyOperationKind::Sell => Self::Sell,
        }
    }
}

impl From<BusyOperationKind> for ScriptBusyOperation {
    fn from(kind: BusyOperationKind) -> Self {
        Self::from_kind(kind)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptEntityView {
    pub guid: Guid,
    pub name: Option<String>,
    pub kind: ScriptEntityKind,
    pub position: WorldPosition,
    pub distance_to_self: f32,
    pub motion_command: ScriptMotionCommand,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "data")]
pub enum ScriptMotionCommand {
    #[default]
    None,
    Stop,
    WalkForward,
    WalkBackwards,
    RunForward,
    TurnRight,
    TurnLeft,
    SidestepRight,
    SidestepLeft,
    Dead,
    Other(u16),
}

impl ScriptMotionCommand {
    pub fn from_command(command: InterpretedMotionCommand) -> Self {
        match command {
            InterpretedMotionCommand::STOP => Self::Stop,
            InterpretedMotionCommand::WALK_FORWARD => Self::WalkForward,
            InterpretedMotionCommand::WALK_BACKWARDS => Self::WalkBackwards,
            InterpretedMotionCommand::RUN_FORWARD => Self::RunForward,
            InterpretedMotionCommand::TURN_RIGHT => Self::TurnRight,
            InterpretedMotionCommand::TURN_LEFT => Self::TurnLeft,
            InterpretedMotionCommand::SIDESTEP_RIGHT => Self::SidestepRight,
            InterpretedMotionCommand::SIDESTEP_LEFT => Self::SidestepLeft,
            InterpretedMotionCommand::DEAD => Self::Dead,
            other => Self::Other(other.raw()),
        }
    }
}

impl From<InterpretedMotionCommand> for ScriptMotionCommand {
    fn from(command: InterpretedMotionCommand) -> Self {
        Self::from_command(command)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScriptEntityKind {
    Player,
    Npc,
    Vendor,
    Monster,
    Weapon,
    Apparel,
    Container,
    Item,
    Consumable,
    Money,
    Key,
    Writable,
    HealingKit,
    ManaStone,
    Door,
    Portal,
    LifeStone,
    Chest,
    Wand,
    Tool,
    StaticObject,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptInventoryItemView {
    pub guid: Guid,
    pub name: Option<String>,
    pub stack_size: Option<u32>,
    pub container_guid: Option<Guid>,
    pub equipped: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptPartyView {
    pub members: Vec<ScriptPartyMemberView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptPartyMemberView {
    pub guid: Guid,
    pub name: Option<String>,
    pub health_percent: Option<f32>,
    pub stamina_percent: Option<f32>,
    pub mana_percent: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptSpellEffectView {
    pub spell_id: u32,
    pub name: Option<String>,
    pub remaining_seconds: Option<f64>,
    pub target_guid: Option<Guid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptEvent {
    ChatMessage(ScriptChatEvent),
    Lifecycle(ScriptLifecycleEvent),
    Workflow(ScriptWorkflowEvent),
    SelfVitalsChanged,
    EntityAppeared { guid: Guid },
    EntityDisappeared { guid: Guid },
    EntityUpdated { guid: Guid },
    InventoryChanged,
    SpellbookChanged,
    FellowshipChanged,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptChatEvent {
    pub channel: ScriptChatChannelKind,
    pub sender: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScriptChatChannelKind {
    Say,
    Tell,
    Emote,
    Fellowship,
    Allegiance,
    Vassals,
    Patron,
    Monarch,
    CoVassals,
    General,
    Trade,
    Lfg,
    Roleplay,
    Society,
    Olthoi,
    System,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptLifecycleEvent {
    Started,
    Stopped,
    Tick { elapsed_seconds: f64 },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptWorkflowEvent {
    ConfirmationOpened { confirmation: ScriptConfirmation },
    ConfirmationClosed,
    BusyOperationChanged { busy: ScriptBusyOperation },
    TargetEntityChanged { guid: Option<Guid> },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptConfirmation {
    Character(ActiveCharacterConfirmation),
    Local(ScriptLocalConfirmation),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptLocalConfirmation {
    pub kind: ScriptLocalConfirmationKind,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScriptLocalConfirmationKind {
    Unswear,
    Other(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptIntent {
    Log {
        level: ScriptLogLevel,
        message: String,
    },
    Say {
        message: String,
    },
    Tell {
        target: String,
        message: String,
    },
    Use {
        guid: Guid,
    },
    CastUntargetedSpell {
        spell_id: u32,
    },
    CastTargetedSpell {
        target: Guid,
        spell_id: u32,
    },
    RespondToConfirmation {
        accepted: bool,
    },
    Client(ScriptClientIntent),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data")]
pub enum ScriptClientIntent {
    TargetEntity { guid: Guid },
    Approach { guid: Guid },
    Follow { guid: Guid },
    Attack { guid: Guid },
    CancelInteraction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ScriptLogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}
