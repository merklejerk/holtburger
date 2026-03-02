use holtburger_common::{Guid, Vector3};
use holtburger_dat::file_type::spell_table::SpellBase;
use holtburger_protocol::errors::{CharacterError, WeenieError};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::inventory::types::EquipMask;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_protocol::messages::{CharacterEntry, GameMessage, ViewContentsEventItem};
use holtburger_world::entity::Entity;
use holtburger_world::state::TradeState;
use holtburger_world::stats::{
    Attribute, AttributeType, CharacterLevelInfo, Resistances, Skill, SkillType, Vital, VitalType,
};
use holtburger_world::vendor::VendorState;
use std::collections::HashMap;
use std::time::{Duration, Instant};

pub use holtburger_world::StateEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetSlot {
    EquipMask(EquipMask),
    MainHand,
    OffHand,
    TopClothes,
    BottomClothes,
}

impl Default for TargetSlot {
    fn default() -> Self {
        Self::EquipMask(EquipMask::NONE)
    }
}

#[derive(Debug, PartialEq, Clone, Copy, Eq)]
pub enum ErrorSource {
    Wire,
    State,
    Client,
}

#[derive(Debug, PartialEq, Clone, Eq)]
pub enum ErrorReason {
    Weenie(WeenieError, Option<String>),
    Character(CharacterError),
    General(String),
    Transport(String),
}

#[derive(Debug, PartialEq, Clone)]
pub enum ClientState {
    Connected,
    CharacterSelection(Vec<CharacterEntry>),
    EnteringWorld,
    InWorld,
    Disconnected,
}

#[derive(Debug, Clone)]
pub enum WireEvent {
    CharacterList(Vec<CharacterEntry>),
    PlayerEntered {
        guid: Guid,
        name: String,
    },
    StatusUpdate {
        state: ClientState,
    },
    ServerMessage {
        message: String,
        chat_type: u32,
    },
    CharacterError(CharacterError),
    ClientError(String),
    WeenieError {
        error: WeenieError,
        parameter: Option<String>,
    },
    InventoryServerSaveFailed {
        item_guid: Guid,
        error: WeenieError,
    },
    BootAccount(String),
    GameMessage(Box<GameMessage>),
    Chat {
        sender: String,
        message: String,
    },
    Emote {
        sender: String,
        text: String,
    },
    PingResponse,
    ViewContents {
        container: Guid,
        items: Vec<ViewContentsEventItem>,
    },
    RawMessage(Vec<u8>),
    LogMessage(String),
    UseDone {
        error: WeenieError,
    },
}

#[derive(Debug, Clone)]
pub enum WorldViewEvent {
    StatusUpdate {
        state: ClientState,
    },
    PlayerStatsSkillsUpdated {
        attributes: HashMap<AttributeType, Attribute>,
        skills: HashMap<SkillType, Skill>,
        resistances: Resistances,
        armor: i32,
        vitae: f32,
        level_info: CharacterLevelInfo,
    },
    PlayerVitalsUpdated {
        vitals: HashMap<VitalType, Vital>,
    },
    PlayerSpellsUpdated {
        spell_ids: Vec<u32>,
        spells: HashMap<u32, SpellBase>,
    },
    PlayerEnchantmentsUpdated {
        enchantments: Vec<Enchantment>,
        resolved_names: HashMap<u32, String>,
    },
    ErrorRaised {
        source: ErrorSource,
        reason: ErrorReason,
        message: String,
    },
    EntitySpawned {
        entity: Box<Entity>,
    },
    EntityIdentified {
        entity: Box<Entity>,
    },
    EntityPropertiesUpdated {
        guid: Guid,
        updates: Vec<holtburger_common::properties::PropertyUpdate>,
    },
    EntityMoved {
        guid: Guid,
        pos: holtburger_common::position::WorldPosition,
    },
    EntityDespawned {
        guid: Guid,
    },
    ServerTimeUpdated {
        time: f64,
    },
    CombatModeUpdated {
        mode: CombatMode,
    },
    NoClipUpdated {
        enabled: bool,
    },
    VendorStateUpdated {
        vendor: Option<VendorState>,
    },
    TradeStateUpdated {
        trade: Option<TradeState>,
    },
    ContainerOpened {
        guid: Guid,
    },
    ContainerClosed {
        guid: Guid,
    },
    ServerMessage {
        message: String,
        chat_type: u32,
    },
    Chat {
        sender: String,
        message: String,
    },
    WeenieError {
        error: WeenieError,
        parameter: Option<String>,
    },
    CharacterList(Vec<CharacterEntry>),
    PlayerEntered {
        guid: Guid,
        name: String,
    },
    WorldNameUpdated(String),
    Emote {
        sender: String,
        text: String,
    },
    PingResponse,
    LogMessage(String),
    BootAccount(String),
    EntityDebugInfoSnapshot {
        entity: Box<Entity>,
    },
}

#[derive(Debug, Clone)]
pub enum ClientCommand {
    Login(String),
    SelectCharacter(Guid),
    SelectCharacterByIndex(usize),
    EnterWorld,
    Talk(String),
    Tell {
        target: String,
        message: String,
    },
    Ping,
    Identify(Guid),
    Use(Guid),
    Drop(Guid),
    Get(Guid),
    Stack {
        source: Guid,
        destination: Guid,
        amount: i32,
    },
    Split {
        item: Guid,
        container: Guid,
        amount: i32,
    },
    MoveItem {
        item: Guid,
        container: Guid,
        placement: u32,
    },
    GetAndWield {
        item: Guid,
        slot: Option<TargetSlot>,
    },
    SplitToWield {
        item: Guid,
        slot: Option<TargetSlot>,
        amount: u32,
    },
    Jump {
        extent: f32,
        velocity: Vector3,
    },
    SetState(u32),
    TurnTo {
        heading: f32,
    },
    MoveTo {
        target: Guid,
    },
    RaiseAttribute {
        attribute: AttributeType,
        xp_spent: u32,
    },
    RaiseVital {
        vital: VitalType,
        xp_spent: u32,
    },
    RaiseSkill {
        skill: SkillType,
        xp_spent: u32,
    },
    TrainSkill {
        skill: SkillType,
        credits: u32,
    },
    GiveObjectRequest {
        target: Guid,
        item: Guid,
        amount: i32,
    },
    Buy {
        vendor: Guid,
        items: Vec<ItemProfileActionData>,
    },
    Sell {
        vendor: Guid,
        items: Vec<ItemProfileActionData>,
    },
    OpenTrade(Guid),
    CloseTrade,
    AcceptTrade,
    DeclineTrade,
    ResetTrade,
    AddToTrade {
        item: Guid,
    },
    CloseContainer(Guid),
    UseWithTarget {
        item: Guid,
        target: Guid,
    },
    CastTargetedSpell {
        target: Guid,
        spell_id: u32,
    },
    CastUntargetedSpell {
        spell_id: u32,
    },
    SetCombatMode(CombatMode),
    SetNoClip(bool),
    CancelAttack,
    SyncPosition,
    QueryEntityDebugInfo(Guid),
    Quit,
}

#[derive(Debug, Clone)]
pub struct RetryState {
    pub active: bool,
    pub next_time: Option<Instant>,
    pub backoff_secs: u64,
    pub attempts: u32,
    pub max_attempts: u32,
}

impl RetryState {
    pub fn new(max_attempts: u32) -> Self {
        Self {
            active: false,
            next_time: None,
            backoff_secs: 5,
            attempts: 0,
            max_attempts,
        }
    }

    pub fn reset(&mut self) {
        self.active = false;
        self.next_time = None;
        self.attempts = 0;
        self.backoff_secs = 5;
    }

    pub fn schedule(&mut self) {
        if !self.active {
            self.active = true;
            self.attempts = 0;
            self.backoff_secs = 5;
            self.next_time = Some(Instant::now() + Duration::from_secs(self.backoff_secs));
        }
    }

    pub fn tick(&mut self, now: Instant) -> bool {
        if self.active && self.next_time.is_some_and(|t| now >= t) {
            if self.attempts >= self.max_attempts {
                self.active = false;
                self.next_time = None;
                false
            } else {
                self.attempts += 1;
                self.backoff_secs = std::cmp::min(self.backoff_secs * 2, 300);
                self.next_time = Some(now + Duration::from_secs(self.backoff_secs));
                true
            }
        } else {
            false
        }
    }
}
