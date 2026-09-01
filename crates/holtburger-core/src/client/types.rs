use crate::client::camera::{
    ClientCameraClearanceRequest, ClientCameraIdentity, ClientCameraIntentRequest,
    ClientCameraStartRequest,
};
use crate::client::character_motion::SequencedCharacterMotionEvent;
use crate::client::movement_types::PlayerDriveIntent;
use crate::client::precise_jump_runtime::{
    PreciseJumpAimRequest, PreciseJumpCancelRequest, PreciseJumpCommitRequest,
    PreciseJumpEvaluation, PreciseJumpTransactionFeedback,
};
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
use holtburger_world::entity::{Entity, EntityNetworkMotion};
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

use crate::{DynamicEntityEvent, DynamicEntitySnapshot};

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

/// Authoritative speaker category derived from the protocol sender GUID when available.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChatSpeakerKind {
    Player,
    NonPlayer,
    Unknown,
}

/// A chat speaker whose display name and known identity category travel together.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatSpeaker {
    /// Server-authored display name, including any suffix.
    name: String,
    /// GUID-derived speaker category; legacy packets without a sender GUID remain unknown.
    kind: ChatSpeakerKind,
}

impl ChatSpeaker {
    pub fn from_guid(name: String, guid: Guid) -> Self {
        let kind = if guid.is_null() {
            ChatSpeakerKind::Unknown
        } else if guid.is_player() {
            ChatSpeakerKind::Player
        } else if guid.is_static_object() || guid.is_dynamic_object() {
            ChatSpeakerKind::NonPlayer
        } else {
            ChatSpeakerKind::Unknown
        };
        Self { name, kind }
    }

    pub fn unknown(name: String) -> Self {
        Self {
            name,
            kind: ChatSpeakerKind::Unknown,
        }
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn into_name_and_kind(self) -> (String, ChatSpeakerKind) {
        (self.name, self.kind)
    }
}

#[cfg(test)]
mod chat_speaker_tests {
    use super::*;

    #[test]
    fn speaker_kind_uses_authoritative_guid_ranges_without_guessing_unknown_ids() {
        assert_eq!(
            ChatSpeaker::from_guid("Player".to_string(), Guid(0x5000_0001)).kind,
            ChatSpeakerKind::Player
        );
        assert_eq!(
            ChatSpeaker::from_guid("Drudge".to_string(), Guid(0x7000_0001)).kind,
            ChatSpeakerKind::NonPlayer
        );
        assert_eq!(
            ChatSpeaker::from_guid("Merchant".to_string(), Guid(0x8000_0001)).kind,
            ChatSpeakerKind::NonPlayer
        );
        assert_eq!(
            ChatSpeaker::from_guid("Unknown".to_string(), Guid::NULL).kind,
            ChatSpeakerKind::Unknown
        );
        assert_eq!(
            ChatSpeaker::from_guid("Invalid".to_string(), Guid(1)).kind,
            ChatSpeakerKind::Unknown
        );
        assert_eq!(
            ChatSpeaker::from_guid("Reserved".to_string(), Guid(0x5000_0000)).kind,
            ChatSpeakerKind::Unknown
        );
    }
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

/// The small lifecycle vocabulary a client shell can render and reconstruct.
///
/// The broad [`ClientState`] remains the authority-facing API used by the TUI. This value is the
/// deliberate, lossless-enough phase projection used by other shells. Exact local-player identity
/// is an independent session fact because it is established later by the server's `PlayerCreate`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientLifecycleState {
    Connecting,
    Authenticating,
    CharacterSelection {
        characters: Vec<ClientCharacterSummary>,
    },
    EnteringWorld {
        character_guid: Guid,
    },
    /// The authority has accepted an initial entry or teleport and is hydrating the destination
    /// behind the 3D application's portal-space presentation. Controls remain withdrawn until
    /// the core activation conjunction sends ACE's `LoginComplete` action.
    PortalSpace {
        /// One generation shared by world, collision, presentation, and handoff currentness.
        world_generation: u64,
        /// Why this replacement destination superseded the previous active scene.
        cause: ClientWorldActivationCause,
    },
    InWorld,
    Exiting {
        cause: ClientExitCause,
    },
}

/// Replacement activation causes proven by the protocol/retail trace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientWorldActivationCause {
    InitialEntry,
    Teleport,
}

/// Existing-character identity needed by the first-cut selection screen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientCharacterSummary {
    /// Server-assigned character identity used for world entry.
    pub guid: Guid,
    /// Server-provided character name.
    pub name: String,
    /// Stable ordinal in the server-provided character list.
    pub slot: u32,
    /// Server deletion timestamp; zero denotes an active character.
    pub delete_time: u32,
}

/// Terminal cause retained for diagnostics and process-exit policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientExitCause {
    ExplicitDisconnect,
    ServerDisconnect,
    StartupFailure,
    RuntimeFailure,
    HostShutdown,
}

/// Non-portal presentation edge that invalidates interpolation and camera history.
///
/// Portal replacement is represented by [`ClientLifecycleState::PortalSpace`] and never crosses
/// this event surface. Keeping only the two in-place producers here makes the host contract honest:
/// a consumer may discard presentation history without mistaking it for a destination activation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientPresentationDiscontinuityKind {
    ForcedReposition,
    Reset,
}

/// One atomic, core-owned replacement level for client shells.
///
/// Runtime bodies stay in the core value for the existing TUI and authority tests. Desktop
/// adapters deliberately project only local-player identity, the focused dynamic snapshot,
/// lifecycle, time, and generation rather than putting the broad body representation on their wire.
#[derive(Debug, Clone, PartialEq)]
pub struct ClientApplicationSnapshot {
    /// Complete shell-facing lifecycle level.
    pub lifecycle: ClientLifecycleState,
    /// Exact local-player identity established by the server's `PlayerCreate` message.
    pub local_player_guid: Option<Guid>,
    /// Synchronized server time, absent before the first time-sync event.
    pub server_time: Option<f64>,
    /// Monotonic presentation generation invalidating pre-discontinuity history.
    pub world_generation: u64,
    /// Latest server-provided world name, absent before the server-name message arrives.
    pub world_name: Option<String>,
    /// Current local-player display name, absent before its authoritative entity exists.
    pub player_name: Option<String>,
    /// Complete current/max local-player vitals used by client HUDs.
    pub vitals: HashMap<VitalType, Vital>,
    /// Current renderer-consumed jump timing, absent until authoritative capability is complete.
    pub character_motion: Option<ClientCharacterMotionCapabilities>,
    /// Complete focused dynamic-entity replacement level.
    pub dynamic: DynamicEntitySnapshot,
    /// Broad runtime-body replacement retained for authority-facing clients such as the TUI.
    pub runtime_bodies: Arc<[RuntimeSpatialBodyView]>,
}

/// Renderer-consumed timing facts derived from authoritative character motion state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientCharacterMotionCapabilities {
    /// Current retail full-charge duration; stance changes may replace it during a charge.
    pub full_charge_duration: Duration,
}

/// One ordered character-motion lifecycle outcome projected to the current input owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientCharacterMotionFeedback {
    /// Originating renderer sequence, used to ignore feedback for an older optimistic gesture.
    pub sequence: crate::client::character_motion::CharacterMotionSequence,
    /// Authority outcome without exposing the gameplay facts used to reach it.
    pub outcome: ClientCharacterMotionOutcome,
}

/// Renderer-reconstructible character-motion lifecycle outcomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientCharacterMotionOutcome {
    ChargeAccepted,
    ChargeContinues,
    JumpCommitted,
    Reset,
    Rejected(ClientCharacterMotionRejection),
}

/// Stable renderer-facing reasons why a jump edge could not proceed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientCharacterMotionRejection {
    ChargeNotActive,
    Airborne,
    Unsupported,
    Overburdened,
    CapabilityUnavailable,
    BodyUnavailable,
    CollisionUnavailable,
    LaunchRejected,
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
    /// Complete application-level replacement state for a shell remount or receiver recovery.
    ApplicationSnapshot(ClientApplicationSnapshot),
    /// Source-neutral lifecycle projection emitted whenever the authoritative client state changes.
    LifecycleChanged(ClientLifecycleState),
    /// Ordered jump gesture result used only to reconcile optimistic client presentation.
    CharacterMotionFeedback(ClientCharacterMotionFeedback),
    /// Latest correlated precise-jump hover evaluation; older pointer samples are replaceable.
    PreciseJumpEvaluation(PreciseJumpEvaluation),
    /// Ordered result of an explicit precise-jump commit or cancellation request.
    PreciseJumpTransactionFeedback(PreciseJumpTransactionFeedback),
    /// Replacement timing capability emitted when authoritative stance/completeness changes.
    CharacterMotionCapabilitiesUpdated {
        capabilities: Option<ClientCharacterMotionCapabilities>,
    },
    /// First exact local-player identity established by the server for this world session.
    LocalPlayerEstablished {
        player_guid: Guid,
    },
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
        motion: EntityNetworkMotion,
    },
    RuntimeBodySnapshot {
        bodies: Arc<[RuntimeSpatialBodyView]>,
    },
    RuntimeBodyUpserted {
        body: Box<RuntimeSpatialBodyView>,
    },
    /// Complete runtime-body levels committed by one fixed tick, in stable body order.
    RuntimeBodiesAdvanced {
        bodies: Arc<[RuntimeSpatialBodyView]>,
    },
    RuntimeBodyRemoved {
        body_id: SpatialBodyId,
    },
    RuntimeBodiesReset {
        cause: RuntimeBodyResetCause,
    },
    /// Focused reconstructible entity presentation feed carried inside the broader client surface.
    DynamicEntity(DynamicEntityEvent),
    /// Client-owned collision-safe camera placement, published after the matching entity advance.
    Camera(crate::client::ClientCameraTick),
    /// Receipt for a newly registered client camera generation.
    CameraStarted(crate::client::ClientCameraStartReceipt),
    PresentationDiscontinuity {
        world_generation: u64,
        kind: ClientPresentationDiscontinuityKind,
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
        speaker: ChatSpeaker,
        message: String,
        chat_type: ChatMessageTypeId,
    },
    ChannelMessage {
        channel: ChatChannelInfo,
        speaker: ChatSpeaker,
        message: String,
    },
    Tell {
        speaker: ChatSpeaker,
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
        speaker: ChatSpeaker,
        text: String,
    },
    SoulEmote {
        speaker: ChatSpeaker,
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
    RequestCurrentApplicationState,
    /// Supplies the presentation-owned first-pure-destination acknowledgement for one
    /// generation. Non-rendering compositions use the immediate adapter and need not send it.
    AcknowledgeClientWorldReveal {
        world_generation: u64,
    },
    Disconnect,
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
    /// Applies one ordered, non-coalescible character-motion lifecycle edge.
    ControlCharacter(SequencedCharacterMotionEvent),
    /// Replaces any queued precise-jump hover sample for the same active camera generation.
    SetPreciseJumpAim(PreciseJumpAimRequest),
    /// Requests a fresh authoritative solve for one previously reachable evaluation.
    CommitPreciseJump(PreciseJumpCommitRequest),
    /// Explicitly leaves precise-jump mode without launching.
    CancelPreciseJump(PreciseJumpCancelRequest),
    StartClientCamera(ClientCameraStartRequest),
    SetClientCameraIntent(ClientCameraIntentRequest),
    SetClientCameraClearance(ClientCameraClearanceRequest),
    StopClientCamera(ClientCameraIdentity),
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
