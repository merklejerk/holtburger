use crate::client::movement_types::PlayerDriveIntent;
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
use holtburger_protocol::messages::movement::MovementEventData;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_protocol::messages::{
    CharacterCreateRequestData, CharacterCreateResponseData, CharacterEntry, ChatChannel,
    ChatChannelId, ChatMessageTypeId, SetTurbineChatChannelsEventData, TurbineChatChannel,
    TurbineChatChannelId, TurbineChatDispatchType, TurbineChatType, TurbineChatTypeId,
};
use holtburger_world::FellowshipActivity;
use holtburger_world::SelfMovementKinematics;
use holtburger_world::book::BookData;
use holtburger_world::entity::{Entity, EntityMotionSnapshot};
use holtburger_world::state::{FellowshipState, TradeState};
use holtburger_world::stats::{
    Attribute, AttributeType, CharacterLevelInfo, Resistances, Skill, SkillType, Vital, VitalType,
};
use holtburger_world::vendor::VendorState;
use holtburger_world::{RuntimeBodyResetCause, RuntimeSpatialBodyView, SpatialBodyId};
use serde::{Deserialize, Serialize};
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
pub enum ActionResultSource {
    Wire,
    State,
    Client,
}

#[derive(Debug, PartialEq, Clone, Eq)]
pub enum ActionResultReason {
    Weenie(WeenieError, Option<String>),
    InventoryServerSaveFailed { item_guid: Guid, error: WeenieError },
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharacterManagementOperation {
    Create,
    Delete,
    Restore,
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
    PlayerKilled {
        death_message: String,
        victim_id: Guid,
        killer_id: Guid,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlayerCharacterOptions {
    pub options1: CharacterOptions1,
    pub options2: CharacterOptions2,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveCharacterConfirmation {
    pub confirmation_type: ConfirmationType,
    pub context: u32,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    ActionResult {
        source: ActionResultSource,
        reason: ActionResultReason,
    },
    EntitySpawned {
        entity: Box<Entity>,
    },
    EntityReplaced {
        entity: Box<Entity>,
    },
    EntityHealthUpdated {
        guid: Guid,
        health_fraction: f32,
    },
    EntityBookUpdated {
        guid: Guid,
        book: Box<BookData>,
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
    SelfMovementKinematicsUpdated {
        kinematics: Option<SelfMovementKinematics>,
    },
    SelfServerControlledMotion {
        data: Box<MovementEventData>,
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
    ItemManaResponse {
        target: Guid,
        mana: f32,
        success: u32,
    },
    ServerMessage {
        message: String,
        chat_type: ChatMessageTypeId,
    },
    Chat {
        sender: String,
        message: String,
        chat_type: ChatMessageTypeId,
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
    CharacterManagementResponse {
        operation: Option<CharacterManagementOperation>,
        response: CharacterCreateResponseData,
    },
    CharacterDeleteResponse,
    CharacterEnterWorldServerReady,
    PlayerEntered {
        guid: Guid,
        name: String,
    },
    WorldNameUpdated(String),
    Emote {
        sender: String,
        text: String,
    },
    SoulEmote {
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
    SendCharacterEnterWorld {
        guid: Guid,
        account: String,
    },
    CreateCharacter(Box<CharacterCreateRequestData>),
    DeleteCharacter {
        slot: u32,
    },
    RestoreCharacter(Guid),
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
    SoulEmote(String),
    RecallLifestone,
    TeleportToPklArena,
    TeleportToMarketplace,
    RecallAllegianceHousing,
    SwearAllegiance {
        target: Guid,
    },
    Unswear {
        target: Guid,
    },
    Suicide,
    EnterPkLite,
    Ping,
    RequestInitialViewState,
    SetFellowshipUpdatesSubscribed {
        enabled: bool,
    },
    Identify(Guid),
    ReadBookPage {
        book: Guid,
        page_index: u32,
    },
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
        target: Guid,
    },
    PromotePartyLeader {
        target: Guid,
    },
    LeaveParty,
    UninviteFromParty {
        target: Guid,
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
    AddPlayerPermission {
        player_name: String,
    },
    RemovePlayerPermission {
        player_name: String,
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
