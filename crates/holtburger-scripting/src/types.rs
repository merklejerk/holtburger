use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_core::{ActiveCharacterConfirmation, BusyOperationKind};
use holtburger_protocol::messages::combat::CombatMode;
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
    fn busy_operation(&self) -> Option<ScriptBusyOperation>;
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptSelfView {
    pub guid: Guid,
    pub name: String,
    pub position: Option<WorldPosition>,
    pub health: Option<u32>,
    pub health_max: Option<u32>,
    pub stamina: Option<u32>,
    pub stamina_max: Option<u32>,
    pub mana: Option<u32>,
    pub mana_max: Option<u32>,
    pub encumbrance: Option<f32>,
    pub capacity: Option<f32>,
    pub busy_operation: Option<ScriptBusyOperation>,
    pub heading: Option<f32>,
    pub combat_mode: CombatMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScriptEntityView {
    pub guid: Guid,
    pub name: Option<String>,
    pub kind: ScriptEntityKind,
    pub position: Option<WorldPosition>,
    pub distance_to_self: Option<f32>,
    pub is_dead: bool,
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
    BusyOperationChanged { busy: Option<ScriptBusyOperation> },
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptBusyOperation {
    pub kind: BusyOperationKind,
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
