use crate::client::movement_types::{MovementCommand, PlayerDriveIntent};
use holtburger_common::properties::DamageType;
use holtburger_common::{
    CharacterOption, CharacterOptions1, CharacterOptions2, ConfirmationType, Guid,
};
use holtburger_protocol::errors::{CharacterError, WeenieError};
use holtburger_protocol::messages::combat::{
    AttackConditions, AttackHeight, CombatMode, DamageLocation,
};
use holtburger_protocol::messages::inventory::types::EquipMask;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_protocol::messages::{
    CharacterEntry, ChatChannel, ChatChannelId, GameMessage, SetTurbineChatChannelsEventData,
    TurbineChatChannel, TurbineChatChannelId, TurbineChatDispatchType, TurbineChatType,
    TurbineChatTypeId, ViewContentsEventItem,
};
use holtburger_world::FellowshipActivity;
use holtburger_world::entity::{Entity, EntityMotionSnapshot};
use holtburger_world::{RuntimeBodyResetCause, RuntimeSpatialBodyView, SpatialBodyId};
use holtburger_world::spell::SpellCatalog;
use holtburger_world::state::{FellowshipState, TradeState};
use holtburger_world::stats::{
    Attribute, AttributeType, CharacterLevelInfo, Resistances, Skill, SkillType, Vital, VitalType,
};
use holtburger_world::vendor::VendorState;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

pub use holtburger_world::WorldEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChatChannelKind {
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
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChatChannelSource {
    Legacy {
        channel: ChatChannelId,
    },
    Turbine {
        room_id: TurbineChatChannelId,
        chat_type: TurbineChatTypeId,
        dispatch_type: TurbineChatDispatchType,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ChatChannelInfo {
    pub kind: ChatChannelKind,
    pub source: ChatChannelSource,
}

impl ChatChannelInfo {
    pub fn legacy(channel: ChatChannelId) -> Self {
        let kind = match channel {
            ChatChannelId::Known(ChatChannel::Fellow)
            | ChatChannelId::Known(ChatChannel::FellowBroadcast) => ChatChannelKind::Fellowship,
            ChatChannelId::Known(ChatChannel::AllegianceBroadcast) => ChatChannelKind::Allegiance,
            ChatChannelId::Known(ChatChannel::Vassals) => ChatChannelKind::Vassals,
            ChatChannelId::Known(ChatChannel::Patron) => ChatChannelKind::Patron,
            ChatChannelId::Known(ChatChannel::Monarch) => ChatChannelKind::Monarch,
            ChatChannelId::Known(ChatChannel::CoVassals) => ChatChannelKind::CoVassals,
            _ => ChatChannelKind::Unknown,
        };

        Self {
            kind,
            source: ChatChannelSource::Legacy { channel },
        }
    }

    pub fn turbine(
        room_id: TurbineChatChannelId,
        chat_type: TurbineChatTypeId,
        dispatch_type: TurbineChatDispatchType,
    ) -> Self {
        Self {
            kind: chat_kind_from_turbine(chat_type, room_id),
            source: ChatChannelSource::Turbine {
                room_id,
                chat_type,
                dispatch_type,
            },
        }
    }
}

fn chat_kind_from_turbine(
    chat_type: TurbineChatTypeId,
    room_id: TurbineChatChannelId,
) -> ChatChannelKind {
    match chat_type.known() {
        Some(TurbineChatType::Allegiance) => ChatChannelKind::Allegiance,
        Some(TurbineChatType::General) => ChatChannelKind::General,
        Some(TurbineChatType::Trade) => ChatChannelKind::Trade,
        Some(TurbineChatType::Lfg) => ChatChannelKind::Lfg,
        Some(TurbineChatType::Roleplay) => ChatChannelKind::Roleplay,
        Some(TurbineChatType::Society)
        | Some(TurbineChatType::SocietyCelHan)
        | Some(TurbineChatType::SocietyEldWeb)
        | Some(TurbineChatType::SocietyRadBlo) => ChatChannelKind::Society,
        Some(TurbineChatType::Olthoi) => ChatChannelKind::Olthoi,
        Some(TurbineChatType::Undef) | None => match room_id.known() {
            Some(TurbineChatChannel::Allegiance) => ChatChannelKind::Allegiance,
            Some(TurbineChatChannel::General) => ChatChannelKind::General,
            Some(TurbineChatChannel::Trade) => ChatChannelKind::Trade,
            Some(TurbineChatChannel::Lfg) => ChatChannelKind::Lfg,
            Some(TurbineChatChannel::Roleplay) => ChatChannelKind::Roleplay,
            Some(TurbineChatChannel::Society)
            | Some(TurbineChatChannel::SocietyCelestialHand)
            | Some(TurbineChatChannel::SocietyEldrytchWeb)
            | Some(TurbineChatChannel::SocietyRadiantBlood) => ChatChannelKind::Society,
            Some(TurbineChatChannel::Olthoi) => ChatChannelKind::Olthoi,
            None => ChatChannelKind::Unknown,
        },
    }
}

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
    ChannelMessage {
        channel: ChatChannelInfo,
        sender: String,
        message: String,
    },
    Tell {
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
    CombatFeedback(CombatFeedback),
}

#[derive(Debug, Clone, PartialEq)]
pub enum CombatFeedback {
    AttackDone {
        error: WeenieError,
    },
    AttackCommenced,
    AttackerNotification {
        defender_name: String,
        damage_type: DamageType,
        health_percent: f64,
        damage: u32,
        critical_hit: bool,
        attack_conditions: AttackConditions,
    },
    DefenderNotification {
        attacker_name: String,
        damage_type: DamageType,
        health_percent: f64,
        damage: u32,
        damage_location: DamageLocation,
        critical_hit: bool,
        attack_conditions: AttackConditions,
    },
    EvasionAttackerNotification {
        defender_name: String,
    },
    EvasionDefenderNotification {
        attacker_name: String,
    },
    VictimNotification {
        death_message: String,
    },
    KillerNotification {
        death_message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlayerCharacterOptions {
    pub options1: CharacterOptions1,
    pub options2: CharacterOptions2,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveCharacterConfirmation {
    pub confirmation_type: ConfirmationType,
    pub context: u32,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BusyOperationKind {
    Use,
    UseWithTarget,
    Salvage,
    SpellCast,
    Buy,
    Sell,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BusyOperationResult {
    Completed {
        error: WeenieError,
        parameter: Option<String>,
    },
    TimedOut,
}

#[derive(Debug, Clone)]
pub enum ClientViewEvent {
    StatusUpdate {
        state: ClientState,
    },
    PlayerStatsSkillsUpdated {
        attributes: HashMap<AttributeType, Attribute>,
        skills: HashMap<SkillType, Skill>,
        resistances: Resistances,
        armor: i32,
        vitae: f32,
    },
    PlayerLevelInfoUpdated {
        level_info: CharacterLevelInfo,
    },
    PlayerVitalsUpdated {
        vitals: HashMap<VitalType, Vital>,
    },
    SpellCatalogLoaded {
        catalog: Arc<SpellCatalog>,
    },
    PlayerSpellsUpdated {
        spell_ids: Vec<u32>,
    },
    PlayerOptionsUpdated {
        options: PlayerCharacterOptions,
    },
    PlayerEnchantmentsUpdated {
        enchantments: Vec<Enchantment>,
    },
    ActiveCharacterConfirmationUpdated {
        confirmation: Option<ActiveCharacterConfirmation>,
    },
    BusyStateUpdated {
        busy: Option<BusyOperationKind>,
    },
    BusyOperationFinished {
        operation: BusyOperationKind,
        result: BusyOperationResult,
    },
    ErrorRaised {
        source: ErrorSource,
        reason: ErrorReason,
        message: String,
    },
    EntitySpawned {
        entity: Box<Entity>,
    },
    EntityReplaced {
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
    EntityKinematicsUpdated {
        guid: Guid,
        velocity: holtburger_common::math::Vector3,
        omega: holtburger_common::math::Vector3,
    },
    EntityMotionUpdated {
        guid: Guid,
        snapshot: Option<EntityMotionSnapshot>,
    },
    RuntimeBodySnapshot {
        bodies: Arc<[RuntimeSpatialBodyView]>,
    },
    RuntimeBodyUpserted {
        body: Box<RuntimeSpatialBodyView>,
    },
    RuntimeBodyRemoved {
        body_id: SpatialBodyId,
    },
    RuntimeBodiesReset {
        cause: RuntimeBodyResetCause,
    },
    PlayerGroundedUpdated {
        grounded: bool,
    },
    ForcedReposition {
        guid: Guid,
        pos: holtburger_common::position::WorldPosition,
        sequence: u16,
    },
    TeleportStarted {
        sequence: u16,
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
    VendorItemIdentified(Box<holtburger_world::vendor::CoreVendorItem>),
    FellowshipStateUpdated {
        fellowship: Option<FellowshipState>,
    },
    FellowshipActivity {
        activity: FellowshipActivity,
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
    ChannelMessage {
        channel: ChatChannelInfo,
        sender: String,
        message: String,
    },
    Tell {
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
    CombatFeedback(CombatFeedback),
    BootAccount(String),
    EntityDebugInfoSnapshot {
        entity: Box<Entity>,
    },
    NetPulse {
        bytes_in: u64,
        bytes_out: u64,
    },
    Disconnected,
}

#[derive(Debug, Clone)]
pub enum ClientCommand {
    Login(String),
    SelectCharacter(Guid),
    EnterWorld,
    Talk(String),
    Tell {
        target: String,
        message: String,
    },
    ChannelMessage {
        channel: ChatChannelKind,
        message: String,
    },
    Emote(String),
    RecallLifestone,
    RecallAllegianceHousing,
    Suicide,
    EnterPkLite,
    Ping,
    RequestInitialViewState,
    SetFellowshipUpdatesSubscribed {
        enabled: bool,
    },
    Identify(Guid),
    QueryHealth(Guid),
    Use(Guid),
    Drop(Guid),
    Get(Guid),
    Stack {
        source: Guid,
        destination: Guid,
        amount: u32,
    },
    Split {
        item: Guid,
        container: Guid,
        amount: u32,
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
    DriveMovement(MovementCommand),
    DriveSelf(PlayerDriveIntent),
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
        amount: u32,
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
    CreateParty {
        name: String,
    },
    ShowPartyStatus,
    InviteToParty {
        player: String,
    },
    LeaveParty,
    UninviteFromParty {
        player: String,
    },
    CloseContainer(Guid),
    UseWithTarget {
        item: Guid,
        target: Guid,
    },
    SalvageItemsWith {
        tool: Guid,
        items: Vec<Guid>,
    },
    CastTargetedSpell {
        target: Guid,
        spell_id: u32,
    },
    CastUntargetedSpell {
        spell_id: u32,
    },
    TargetedMeleeAttack {
        target: Guid,
        attack_height: AttackHeight,
        power_level: f32,
    },
    TargetedMissileAttack {
        target: Guid,
        attack_height: AttackHeight,
        accuracy_level: f32,
    },
    SetCharacterOption {
        option: CharacterOption,
        value: bool,
    },
    RespondToConfirmation {
        accepted: bool,
    },
    SetCombatMode(CombatMode),
    CancelAttack,
    QueryEntityDebugInfo(Guid),
    Quit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurbineChatState {
    pub enabled: bool,
    pub channels: Option<SetTurbineChatChannelsEventData>,
    pub next_context_id: u32,
}

impl Default for TurbineChatState {
    fn default() -> Self {
        Self {
            enabled: false,
            channels: None,
            next_context_id: 1,
        }
    }
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
