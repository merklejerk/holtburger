//! Public Live API wire contract shared across REST, OpenAPI 3.1, WebSocket, and V8 scripting.

use std::collections::BTreeMap;

use holtburger_common::Guid;
use holtburger_common::Vector3;
use holtburger_common::position::WorldPosition;
use holtburger_core::client::inventory_plan::InventoryIntent;
use holtburger_core::client::movement_types::{Gait, LateralMotion, LongitudinalMotion, Turn};
use holtburger_core::client::recall::RecallDestination;
use holtburger_core::client::steering::{
    LocalNavigationFinished, LocalSteeringRequest, LocalSteeringStatus,
};
use holtburger_core::client::trade::TradeRequest;
use holtburger_core::client::types::{
    BusyOperationKind, ChatChannelDestination, ChatChannelKind, ChatSpeakerKind, ChatTellTarget,
    ClientCharacterSummary, ClientCombatControlState, ClientWorldActivationCause, SpellCastAim,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::hooks::{
    ApiError, HudMarkersUpsertRequest, HudToastRequest, UiPrintRequest,
};

pub const LIVE_API_VERSION: &str = "1.0";
/// Hard upper bound for automation `drive-pulse` commands (5 seconds).
pub const MAX_DRIVE_PULSE_MS: u32 = 5_000;
/// Hard upper bound for `wait: settled` and long-poll `waitMs` (30 seconds).
pub const MAX_WAIT_TIMEOUT_MS: u32 = 30_000;

/// Coarse client lifecycle view advertised in `/v1/info` and `lifecycle` events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LifecyclePhaseView {
    Connecting,
    Authenticating,
    #[serde(rename_all = "camelCase")]
    CharacterSelection {
        max_slots: u32,
        characters: Vec<ClientCharacterSummary>,
        rejection: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    EnteringWorld {
        character_guid: Guid,
    },
    #[serde(rename_all = "camelCase")]
    PortalSpace {
        world_generation: u64,
        cause: ClientWorldActivationCause,
    },
    InWorld,
    LoggingOut,
    #[serde(rename_all = "camelCase")]
    Exiting {
        reason: String,
    },
}

impl LifecyclePhaseView {
    /// Kebab-case phase identifier matching the serialized `kind` tag.
    pub fn phase_label(&self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Authenticating => "authenticating",
            Self::CharacterSelection { .. } => "character-selection",
            Self::EnteringWorld { .. } => "entering-world",
            Self::PortalSpace { .. } => "portal-space",
            Self::InWorld => "in-world",
            Self::LoggingOut => "logging-out",
            Self::Exiting { .. } => "exiting",
        }
    }
}

/// Top-level metadata returned by `GET /v1/info`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiInfo {
    pub api_version: String,
    pub client: String,
    pub capabilities: Vec<String>,
    pub lifecycle: LifecyclePhaseView,
    pub world_generation: u64,
    pub world_name: Option<String>,
    pub account_name: String,
    pub character_guid: Option<Guid>,
    pub character_name: Option<String>,
    pub automation_paused: bool,
    /// Whether physical dynamic-entity obstruction (doors/creatures) is active for local movement.
    pub entity_collision_enabled: bool,
    pub latest_event_seq: u64,
}

/// Active server confirmation dialog requiring explicit acceptance or denial.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationView {
    pub request_id: u64,
    pub confirmation_type: holtburger_common::ConfirmationType,
    pub context: u32,
    pub text: String,
}

/// Outdoor AC map coordinates corresponding to an outdoor `WorldPosition`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OutdoorCoordsView {
    /// Signed unbiased latitude in degrees (North positive, South negative).
    pub lat: f32,
    /// Signed unbiased longitude in degrees (East positive, West negative).
    pub lon: f32,
    /// Elevation in world meters (`coords.z`).
    pub alt: f32,
    /// Standard AC map notation (e.g. `"42.3N, 15.8E"`).
    pub label: String,
}

/// Current local-player vitals, pose, combat stance, busy state, and economy summary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SelfView {
    pub guid: Guid,
    pub name: Option<String>,
    pub position: Option<WorldPosition>,
    /// Outdoor AC map coordinates when outdoors; `null` indoors or when position is unavailable.
    pub outdoor_coords: Option<OutdoorCoordsView>,
    pub heading: Option<f32>,
    pub health: u32,
    pub health_max: u32,
    pub stamina: u32,
    pub stamina_max: u32,
    pub mana: u32,
    pub mana_max: u32,
    pub pyreals: Option<u32>,
    pub burden: Option<f32>,
    pub combat_mode: String,
    pub busy: Option<BusyOperationKind>,
    pub confirmation: Option<ConfirmationView>,
    pub spell_cast_target: Option<Guid>,
    pub navigation: Option<LocalSteeringStatus>,
    pub server_time: Option<f64>,
}

/// Filter parameters for `GET /v1/entities` and `ApiQuery::Entities`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityFilter {
    /// Maximum distance in meters from the local player.
    #[serde(default)]
    pub max_distance: Option<f32>,
    /// Comma-separated entity categories to include: `player`, `npc`, `vendor`, `monster`,
    /// `weapon`, `apparel`, `container`, `item`, `consumable`, `money`, `key`, `writable`,
    /// `healing_kit`, `mana_stone`, `door`, `portal`, `life_stone`, `chest`, `wand`, `tool`,
    /// `static_object`, `unknown`. Note: puzzle levers, switches, and triggers do not have a
    /// dedicated category and often appear under `door`, `item`, `static_object`, or `unknown`.
    #[serde(default)]
    pub category: Option<String>,
    /// Case-insensitive substring match against the entity name.
    #[serde(default)]
    pub name: Option<String>,
    /// Exact Weenie Class ID (WCID) filter.
    #[serde(default)]
    pub wcid: Option<u32>,
    /// Restrict results to entities directly contained inside this container GUID (e.g. a backpack
    /// or `InventoryView.openWorldContainer`).
    #[serde(default)]
    pub container: Option<Guid>,
    /// Maximum number of nearest entities to return (results are sorted by ascending `distanceToSelf`).
    #[serde(default)]
    pub limit: Option<usize>,
}

/// Compact summary row returned by `GET /v1/entities`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntitySummary {
    pub guid: Guid,
    pub name: String,
    pub wcid: Option<u32>,
    pub category: String,
    pub is_hostile: bool,
    pub is_dead: bool,
    pub is_vendor: bool,
    pub position: WorldPosition,
    pub distance_to_self: Option<f32>,
    /// Target health fraction in `[0.0, 1.0]`; `null` on remote creatures until selected/targeted
    /// (retail AC only reports creature health on demand).
    pub health_fraction: Option<f32>,
    pub stack_count: Option<u32>,
    pub container: Option<Guid>,
    pub wielder: Option<Guid>,
}

/// Full raw `WorldObject` property maps keyed by canonical property name.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityPropertiesView {
    pub ints: BTreeMap<String, i32>,
    pub int64s: BTreeMap<String, i64>,
    pub floats: BTreeMap<String, f64>,
    pub bools: BTreeMap<String, bool>,
    pub strings: BTreeMap<String, String>,
    pub dids: BTreeMap<String, Guid>,
    pub iids: BTreeMap<String, Guid>,
}

/// Public interaction capability derived from an entity's `ItemUseable` flags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ItemUseCapabilityView {
    /// Required public description facts have not arrived.
    Unavailable,
    /// Public useability explicitly disallows direct use (e.g. a lever-controlled door).
    Unsupported,
    /// Can be used directly without a second target object.
    Direct,
    /// Authored Ust salvage tool.
    SalvageTool,
    /// Requires a second compatible target object (`use-item` with `source` and `target`).
    Targeted,
}

/// Lock-tool classification on keys and lockpicks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LockToolView {
    Key,
    Lockpick { bonus: Option<i32> },
}

/// Derived client gameplay facts on an entity (`EntityDetail.facts`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityFactsView {
    pub use_capability: ItemUseCapabilityView,
    pub is_locked: Option<bool>,
    /// Server-reported open state on doors and containers (`PropertyBool::Open`), when present.
    pub is_open: Option<bool>,
    /// `true` when the entity is physically solid to dynamic collision; flips to `false` when a
    /// door opens or an object becomes ethereal/hidden.
    pub blocks_movement: bool,
    pub lock_tool: Option<LockToolView>,
    pub owned_by_player: bool,
    pub can_pick_up: bool,
    pub world_container_content: bool,
    pub can_receive_give: bool,
    pub can_trade: bool,
    pub can_offer_trade: bool,
    pub is_hostile: bool,
    pub is_corpse: bool,
    pub corpse_open: bool,
    pub item_capacity: Option<u32>,
    pub pack_capacity: Option<u32>,
    pub summon_owner: Option<Guid>,
}

/// Decoded weapon combat stats (`EntityDetail.weaponProfile`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WeaponProfileView {
    pub damage_type: u32,
    pub weapon_time: u32,
    /// Numeric `SkillType` ID from the server weapon profile.
    pub weapon_skill: u32,
    /// Decoded `SkillType` variant name matching `/v1/self/sheet` and appraisal (e.g. `"LightWeapons"`, `"MissileWeapons"`).
    pub weapon_skill_name: Option<String>,
    pub damage: u32,
    pub damage_variance: f64,
    pub damage_mod: f64,
    pub weapon_length: f64,
    pub max_velocity: f64,
    pub weapon_offense: f64,
    pub max_velocity_estimated: u32,
}

/// Detailed entity view returned by `GET /v1/entities/{guid}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EntityDetail {
    pub summary: EntitySummary,
    pub facts: Option<EntityFactsView>,
    pub armor_profile: Option<Value>,
    pub creature_profile: Option<Value>,
    pub weapon_profile: Option<WeaponProfileView>,
    pub spell_book: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub properties: Option<EntityPropertiesView>,
}

/// Carried container and its direct contents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ContainerView {
    pub guid: Guid,
    pub name: Option<String>,
    pub item_capacity: Option<u32>,
    pub pack_capacity: Option<u32>,
    pub items: Vec<Guid>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InventoryView {
    pub pyreals: Option<u32>,
    pub burden: Option<f32>,
    /// Carried containers plus the currently open world container (`openWorldContainer`), if any.
    pub containers: Vec<ContainerView>,
    pub open_world_container: Option<Guid>,
    pub projectile_supply: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquippedItemView {
    pub guid: Guid,
    pub name: Option<String>,
    pub equip_mask: u32,
    /// Decoded kebab-case `EquipMask` slot names (e.g. `["melee-weapon"]`, `["caster"]`, `["chest-armor"]`).
    pub slots: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentView {
    pub items: Vec<EquippedItemView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CombatView {
    pub combat_mode: String,
    pub state: ClientCombatControlState,
    pub target: Option<Guid>,
    pub profile: Option<AttackProfileSpec>,
}

/// One participant's side of an active player-to-player trade window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TradeSideView {
    pub guid: Guid,
    pub accepted: bool,
    pub items: Vec<Guid>,
}

/// Active player-to-player trade negotiation state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TradeSessionView {
    /// Monotonic client revision required by `trade` `add` and `accept` actions.
    pub revision: u32,
    pub initiator_guid: Guid,
    pub partner_guid: Guid,
    pub self_side: TradeSideView,
    pub partner_side: TradeSideView,
}

/// Player-to-player trade snapshot (`GET /v1/trade` and `TradeUpdated` events).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TradeView {
    /// Active trade session, or `null` when no trade window is open.
    pub trade: Option<TradeSessionView>,
    /// Offered item GUIDs still awaiting server acknowledgment.
    pub pending_items: Vec<Guid>,
}

/// Inclusive per-unit value bounds accepted by a vendor when buying from the player.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VendorValueLimitsView {
    pub minimum: Option<u32>,
    pub maximum: Option<u32>,
}

/// Agent-friendly summary of one item stocked by an open vendor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VendorItemView {
    pub guid: Guid,
    pub name: String,
    pub wcid: u32,
    pub category: String,
    /// Intrinsic per-unit value (pyreals or alternate currency base).
    pub value: u32,
    /// Quoted purchase price for 1 unit under the vendor's buy multiplier, when calculable.
    pub unit_buy_price: Option<u32>,
    pub stack_count: u32,
    pub max_stack_size: Option<u32>,
    /// Remaining vendor supply (`None` means unlimited stock).
    pub vendor_supply: Option<u32>,
}

/// Open vendor inventory and pricing parameters (`GET /v1/vendor` and `VendorUpdated` events).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VendorView {
    pub vendor_guid: Guid,
    pub buy_multiplier: f32,
    pub sell_multiplier: f32,
    pub merchandise_item_types: u32,
    pub value_limits: VendorValueLimitsView,
    pub alternate_currency_wcid: u32,
    pub alternate_currency_amount: u32,
    pub alternate_currency_name: String,
    pub items: Vec<VendorItemView>,
}

/// One active member in the local player's fellowship.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FellowshipMemberView {
    pub guid: Guid,
    pub name: String,
    pub level: u32,
    pub max_health: u32,
    pub max_stamina: u32,
    pub max_mana: u32,
    pub current_health: u32,
    pub current_stamina: u32,
    pub current_mana: u32,
    pub share_loot: bool,
}

/// Active fellowship state (`SocialView.fellowship`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FellowshipView {
    pub name: String,
    pub leader_guid: Option<Guid>,
    pub share_xp: bool,
    pub even_share: bool,
    pub open: bool,
    pub is_locked: bool,
    pub members: Vec<FellowshipMemberView>,
}

/// One member entry in an allegiance hierarchy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AllegianceMemberView {
    pub guid: Guid,
    pub name: String,
    pub title: Option<String>,
    pub rank: u16,
    pub level: Option<u32>,
    pub online: bool,
    pub contributed_xp: u32,
}

/// Resolved allegiance hierarchy profile (`AllegianceView.profile`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AllegianceProfileView {
    pub name: String,
    pub rank: u32,
    pub total_members: u32,
    pub total_descendants: u32,
    pub monarch: Option<AllegianceMemberView>,
    pub patron: Option<AllegianceMemberView>,
    #[serde(rename = "self")]
    pub self_member: Option<AllegianceMemberView>,
    pub direct_vassals: Vec<AllegianceMemberView>,
}

/// Current allegiance snapshot (`SocialView.allegiance`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AllegianceView {
    pub player_guid: Option<Guid>,
    pub refreshing: bool,
    pub can_swear: bool,
    pub profile: Option<AllegianceProfileView>,
}

/// One character entry on the friends list (`SocialView.friends`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FriendView {
    pub guid: Guid,
    pub name: String,
    pub online: bool,
}

/// One squelched character or account record (`SquelchView.characters`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SquelchCharacterView {
    pub guid: Guid,
    pub name: String,
    pub account: bool,
    pub coverage: String,
    pub removal_scope: Option<String>,
}

/// Global squelch filter summary (`SquelchView.globals`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SquelchGlobalView {
    pub name: String,
    pub coverage: String,
}

/// Squelch/ignore database summary (`SocialView.squelch`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SquelchView {
    pub accounts: BTreeMap<String, Guid>,
    pub characters: Vec<SquelchCharacterView>,
    pub globals: SquelchGlobalView,
}

/// Combined social state (`GET /v1/social`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SocialView {
    pub fellowship: Option<FellowshipView>,
    pub allegiance: AllegianceView,
    pub friends: Option<Vec<FriendView>>,
    pub squelch: Option<SquelchView>,
    pub contracts: Option<Value>,
}

/// Currently selected entity in the frontend UI (`GET /v1/selection`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SelectionView {
    /// Selected entity GUID in decimal, or `null` when nothing is selected.
    pub guid: Option<Guid>,
}

/// Known spells and active cast target (`GET /v1/self/spells`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpellbookView {
    /// Spell IDs known by the local character, or `null` before character login completes.
    pub known_spells: Option<Vec<u32>>,
    /// Current target GUID of an in-progress spell cast, if any.
    pub cast_target: Option<Guid>,
}

/// Server-stored character preference flags (`GET /v1/self/options`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CharacterOptionsView {
    /// Raw `CharacterOptions1` bitmask from `PlayerDescription`.
    pub options1_mask: u32,
    /// Raw `CharacterOptions2` bitmask from `PlayerDescription`.
    pub options2_mask: u32,
    /// Boolean value of every server-stored `CharacterOption` (keys match `set-character-option`).
    pub options: BTreeMap<String, bool>,
}

/// Recorded player death locations (`GET /v1/self/death-locations`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeathLocationsView {
    /// Most recent outdoor death location, if recorded.
    pub last_outdoor: Option<Value>,
    /// Recent death locations in reverse chronological order.
    pub recent: Option<Value>,
}

/// One doorway portal connecting an indoor EnvCell to an adjacent cell or the outdoor surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CellPortalView {
    /// Target indoor EnvCell GUID in the same landblock, or `null` when leading outdoors.
    pub other_cell_id: Option<Guid>,
    /// True when this doorway exits to the outdoor landblock surface.
    pub is_outdoor: bool,
    /// Centroid of the doorway polygon in landblock-local coordinates.
    pub center: Vector3,
    /// Ordered doorway polygon corners in landblock-local coordinates.
    pub vertices: Vec<Vector3>,
}

/// One indoor EnvCell's origin, visibility links, and doorway portals (`GET /v1/world/cells`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CellTopologyView {
    pub cell_id: Guid,
    pub origin: Vector3,
    pub seen_outside: bool,
    pub visible_cells: Vec<Guid>,
    pub portals: Vec<CellPortalView>,
}

/// Resident indoor cell-portal graph for a landblock (`GET /v1/world/cells`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorldCellsView {
    /// Normalized landblock owner GUID (`(id & 0xFFFF_0000) | 0xFFFF`).
    pub landblock_id: Guid,
    /// Local player's current indoor EnvCell GUID, or `null` when outdoors or in another landblock.
    pub current_cell_id: Option<Guid>,
    /// True when the local player is currently outdoors.
    pub is_outdoor: bool,
    /// All resident indoor cells in `landblockId` with their doorway portal connections.
    pub cells: Vec<CellTopologyView>,
}

/// One ray segment for batch static collision raycasting (`POST /v1/preview` `raycast`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RaycastSpec {
    /// Start position; defaults to the local player's position + 1.5m eye height when omitted.
    #[serde(default)]
    pub from: Option<WorldPosition>,
    /// End target position in world coordinates.
    pub to: WorldPosition,
}

/// Maximum number of rays accepted in a single `POST /v1/preview` `raycast` batch.
pub const MAX_RAYCAST_BATCH: usize = 64;
/// Default player-body sphere radius (meters) used by `sphere-sweep` previews when omitted.
pub const DEFAULT_SPHERE_SWEEP_RADIUS: f32 = 0.35;

/// Ordinary-cast targeting route for a spellbook spell.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SpellCastingRouteView {
    /// Targets the caster directly regardless of selection.
    SelfTarget,
    /// Requires no target object.
    Untargeted,
    /// Requires an explicit target selection (`aim.selection`).
    SelectedTarget,
}

/// Static spell metadata from `SpellCatalog`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpellDefinitionView {
    pub id: u32,
    pub name: String,
    pub description: String,
    pub school: String,
    pub icon_id: u32,
    pub category: u32,
    pub bitfield: u32,
    /// True when the spell is beneficial (buff/heal/etc.) rather than harmful.
    pub is_beneficial: bool,
    /// Decoded targeting route (`self-target`, `untargeted`, or `selected-target`).
    pub casting_route: SpellCastingRouteView,
    pub base_mana: u32,
    pub base_range_constant: f32,
    pub base_range_mod: f32,
    pub power: u32,
    pub components: Vec<u32>,
    pub duration: Option<f64>,
}

/// Static skill metadata from `SkillTable`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinitionView {
    pub id: u32,
    pub name: String,
    pub description: String,
    pub trained_cost: i32,
    pub specialized_cost: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CombatModeSpec {
    Peace,
    Melee,
    Missile,
    Magic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AttackHeightSpec {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AttackProfileSpec {
    Melee {
        height: AttackHeightSpec,
        /// Swing power fraction in `[0.0, 1.0]`.
        power: f32,
    },
    Missile {
        height: AttackHeightSpec,
        /// Aim accuracy fraction in `[0.0, 1.0]`.
        accuracy: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum RestPostureSpec {
    Standing,
    Crouching,
    Sitting,
    Lying,
}

/// Outgoing in-game chat action. In h3d clients (including recipients), outdoor coordinates
/// (e.g. `42.3N, 15.8E`) render as clickable waypoints and `[Label](0xHEX)` spans (1..=8
/// case-insensitive hex digits for a non-zero `u32`) render as clickable entity selection tags;
/// other clients display plain text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ChatCommandSpec {
    Say {
        message: String,
    },
    Tell {
        target: ChatTellTarget,
        message: String,
    },
    Channel {
        channel: ChatChannelDestination,
        message: String,
    },
    Emote {
        message: String,
    },
    SoulEmote {
        token: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum FellowshipCommandSpec {
    Create { name: String },
    Invite { target: Guid },
    Uninvite { target: Guid },
    PromoteLeader { target: Guid },
    Leave,
    Disband,
    SetOpen { open: bool },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum AllegianceCommandSpec {
    Query,
    Swear { target: Guid },
    Unswear { target: Guid },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum FriendsCommandSpec {
    Add { name: String },
    Remove { guid: Guid },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SquelchCommandSpec {
    Add { name: String },
    Remove { guid: Guid },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CorpseConsentCommandSpec {
    #[serde(rename_all = "camelCase")]
    Grant { player_name: String },
    #[serde(rename_all = "camelCase")]
    Revoke { player_name: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VendorLineSpec {
    pub item: Guid,
    pub amount: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VendorTradeSpec {
    pub vendor: Guid,
    #[serde(default)]
    pub buys: Vec<VendorLineSpec>,
    /// Owned item GUIDs to sell (whole stacks).
    #[serde(default)]
    pub sells: Vec<Guid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EquipmentBindingSpec {
    /// Item GUID to equip, or `null` to unequip/leave the slot empty.
    pub item: Option<Guid>,
    /// Raw AC `EquipMask` bitflags (copy from `GET /v1/equipment`; for single-item equipping without bitmasks, prefer `inventory` with `target.kind = "equip-preferred"`).
    pub equip_mask: u32,
}

/// Bounded manual drive pulse (auto-expires after `duration_ms`, capped at `MAX_DRIVE_PULSE_MS`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DrivePulseSpec {
    #[serde(default)]
    pub gait: Gait,
    #[serde(default)]
    pub longitudinal: Option<LongitudinalMotion>,
    #[serde(default)]
    pub lateral: Option<LateralMotion>,
    #[serde(default)]
    pub turning: Option<Turn>,
    /// Pulse duration in milliseconds (clamped to `[50, 5_000]`).
    pub duration_ms: u32,
}

/// Synchronous read-only world preview requests served by `POST /v1/preview`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ApiPreviewRequest {
    /// Checks whether `source` can be used on `target` and estimates lockpick success chance.
    #[serde(rename_all = "camelCase")]
    ItemUseTarget { source: Guid, target: Guid },
    /// Previews salvaging `items` with `tool` (or the first carried Ust if omitted).
    #[serde(rename_all = "camelCase")]
    Salvage {
        #[serde(default)]
        tool: Option<Guid>,
        items: Vec<Guid>,
    },
    /// Previews a vendor buy/sell transaction against the currently open vendor.
    #[serde(rename_all = "camelCase")]
    Vendor {
        #[serde(flatten)]
        trade: VendorTradeSpec,
    },
    /// Evaluates castability, components, mana cost, and range for `spellId`.
    #[serde(rename_all = "camelCase")]
    SpellInspection { spell_id: u32 },
    /// Casts up to 64 finite static-surface rays (terrain, dungeon shells, and in h3d static objects such as stairs/pillars/rocks; excludes dynamic entities like closed doors).
    #[serde(rename_all = "camelCase")]
    Raycast { rays: Vec<RaycastSpec> },
    /// Sweeps a collision sphere from `from` (defaults to player position + 0.5m) to `to` against static world geometry (terrain, shells, and in h3d static objects; excludes dynamic doors).
    #[serde(rename_all = "camelCase")]
    SphereSweep {
        #[serde(default)]
        from: Option<WorldPosition>,
        to: WorldPosition,
        /// Sphere radius in meters (default `0.35`; must be finite and in `(0.01, 5.0]`).
        #[serde(default)]
        radius: Option<f32>,
    },
    /// Converts between printed AC outdoor map coordinates (e.g. `"42.3N, 15.8E"`) and a
    /// `WorldPosition`, sampling exact terrain `z` when the target landblock is resident.
    /// Provide exactly one of `coords` or `position`.
    #[serde(rename_all = "camelCase")]
    OutdoorCoords {
        /// Printed AC outdoor map coordinates (e.g. `"42.3N, 15.8E"` or `"12.5S 8.2W"`).
        #[serde(default)]
        coords: Option<String>,
        /// Outdoor `WorldPosition` to convert to AC map coordinates.
        #[serde(default)]
        position: Option<WorldPosition>,
    },
}

/// Result of `ApiPreviewRequest::ItemUseTarget`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemUseTargetPreview {
    pub eligible: bool,
    pub lockpick_success_percent: Option<f64>,
}

/// Result of `ApiPreviewRequest::Salvage`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SalvagePreview {
    Ready { tool: Guid, bags: Value },
    PendingDetails { tool: Guid, items: Vec<Guid> },
    Rejected { reason: String },
}

/// One ray result within `RaycastPreview`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RaycastHitView {
    pub hit: bool,
    pub anchor: Guid,
    pub distance: Option<f32>,
    pub point: Option<holtburger_common::math::Vector3>,
    pub normal: Option<holtburger_common::math::Vector3>,
    pub cell_id: Option<Guid>,
    pub uncovered: bool,
}

/// Result of `ApiPreviewRequest::Raycast`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RaycastPreview {
    pub results: Vec<RaycastHitView>,
}

/// Result of `ApiPreviewRequest::SphereSweep`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SphereSweepPreview {
    pub blocked: bool,
    pub anchor: Guid,
    pub fraction: f32,
    pub point: holtburger_common::math::Vector3,
    pub normal: Option<holtburger_common::math::Vector3>,
    pub uncovered: bool,
}

/// Result of `ApiPreviewRequest::OutdoorCoords`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OutdoorCoordsPreview {
    /// Canonical outdoor `WorldPosition` (on `coords -> position` conversion, `coords.z` is sampled
    /// from resident terrain when `terrainResident` is `true`, otherwise `0.0`; on `position -> coords`,
    /// preserves the caller's `coords.z`).
    pub position: WorldPosition,
    /// Equivalent AC outdoor map coordinates (`lat`, `lon`, `alt`, and printed `label`).
    pub outdoor_coords: OutdoorCoordsView,
    /// `true` when `coords` was resolved against resident terrain and `position.coords.z` was sampled.
    pub terrain_resident: bool,
}

/// Formula availability inside `SpellInspectionPreview::Ready`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum SpellFormulaPreview {
    Pending,
    Ready { components: [u32; 8] },
    Failed { detail: String },
}

/// Live character prerequisites for casting an inspected spell right now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpellCastReadinessView {
    /// Whether the character knows this spell (`null` before spellbook login state arrives).
    pub known: Option<bool>,
    /// Whether a casting implement (`EquipMask::CASTER`) is currently equipped.
    pub has_caster_equipped: bool,
    /// Whether the character is currently in `"magic"` combat mode.
    pub in_magic_mode: bool,
    /// Whether current mana is at least the spell's `baseMana` (`null` if spell metadata is absent).
    pub sufficient_mana: Option<bool>,
}

/// Result of `ApiPreviewRequest::SpellInspection`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum SpellInspectionPreview {
    Pending,
    Missing,
    Ready {
        range_metres: f32,
        formula: SpellFormulaPreview,
        readiness: SpellCastReadinessView,
    },
}

/// Typed union of responses returned by `POST /v1/preview` and WS `preview` requests.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum ApiPreviewResponse {
    ItemUseTarget(ItemUseTargetPreview),
    Salvage(SalvagePreview),
    SpellInspection(SpellInspectionPreview),
    Raycast(RaycastPreview),
    SphereSweep(SphereSweepPreview),
    OutdoorCoords(OutdoorCoordsPreview),
    /// Vendor buy/sell preview object.
    Dynamic(Value),
}

/// Optional waiting behavior for `POST /v1/command` and WS `command` frames.
///
/// Commands with async runtime/server settlement under `until = "settled"` are `select-character`,
/// `logout`, `set-combat-mode`, `inventory`, `use-entity`, `use-item`, `request-appraisal`, `steer`
/// (`move-to`/`approach`/`face-heading`/`face-entity`), `cast-spell`, and `vendor-trade`; other
/// commands return `settled: false` immediately upon admission (`outcome: null`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WaitPolicy {
    #[serde(default)]
    pub until: WaitUntil,
    /// Timeout in milliseconds when `until = "settled"` (default `10_000`, capped at `30_000`).
    #[serde(default = "default_wait_timeout_ms")]
    pub timeout_ms: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WaitUntil {
    #[default]
    Accepted,
    Settled,
}

fn default_wait_timeout_ms() -> u32 {
    10_000
}

impl Default for WaitPolicy {
    fn default() -> Self {
        Self {
            until: WaitUntil::Accepted,
            timeout_ms: default_wait_timeout_ms(),
        }
    }
}

/// Unified mutation command accepted by `POST /v1/command`, `WS /v1/ws`, and TUI V8 scripting.
///
/// Flat commands carry their fields directly alongside `"kind"`. Sub-domain command unions
/// (`chat`, `fellowship`, `allegiance`, `friends`, `squelch`, `corpse-consent`, `trade`)
/// nest their tagged sub-command under `"action"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ApiCommand {
    // --- Session & Confirmations ---
    /// Enters the world with the character matching `guid` from character selection.
    #[serde(rename_all = "camelCase")]
    SelectCharacter { guid: Guid },
    /// Logs the current character out to character selection.
    Logout,
    /// Accepts or declines an active server confirmation dialog.
    #[serde(rename_all = "camelCase")]
    RespondConfirmation { request_id: u64, accepted: bool },

    // --- Chat & Social ---
    /// Sends a say, tell, channel message, emote, or soul emote (`action.kind`).
    /// In h3d clients (including recipients), outdoor coordinates (`42.3N, 15.8E`) become clickable
    /// waypoints and `[Label](0xHEX)` becomes a clickable entity tag (plain text elsewhere).
    Chat { action: ChatCommandSpec },
    /// Manages fellowship creation, invites, leadership, openness, or leaving (`action.kind`).
    Fellowship { action: FellowshipCommandSpec },
    /// Queries allegiance info or swears/unswears allegiance (`action.kind`).
    Allegiance { action: AllegianceCommandSpec },
    /// Adds or removes a friend (`action.kind`).
    Friends { action: FriendsCommandSpec },
    /// Adds or removes a squelch entry (`action.kind`).
    Squelch { action: SquelchCommandSpec },
    /// Grants, revokes, or toggles incoming corpse consent permissions (`action.kind`).
    CorpseConsent { action: CorpseConsentCommandSpec },
    /// Abandons an active quest contract by contract ID.
    #[serde(rename_all = "camelCase")]
    AbandonContract { id: u32 },
    /// Updates one server-stored character preference flag (e.g. `IgnoreFellowshipRequests`, `AutoRepeatAttacks`).
    #[serde(rename_all = "camelCase")]
    SetCharacterOption {
        option: holtburger_common::CharacterOption,
        value: bool,
    },

    // --- Combat & Magic ---
    /// Switches combat stance (`peace`, `melee`, `missile`, `magic`).
    #[serde(rename_all = "camelCase")]
    SetCombatMode { mode: CombatModeSpec },
    /// Begins attacking `target` with the specified melee or missile `profile` (requires `melee` or `missile` combat mode).
    #[serde(rename_all = "camelCase")]
    BeginCombat {
        target: Guid,
        profile: AttackProfileSpec,
    },
    /// Updates the active melee/missile attack height and power/accuracy profile.
    #[serde(rename_all = "camelCase")]
    UpdateCombatProfile { profile: AttackProfileSpec },
    /// Stops the current combat engagement.
    StopCombat,
    /// Casts `spellId` with `aim` (requires `magic` combat mode and a casting implement; use
    /// `POST /v1/preview` `spell-inspection` to verify readiness, components, mana, and range).
    /// With `wait.until = "settled"`, settles when spell invocation completes
    /// (`busy-operation-finished`); projectile flight, damage, and kill notifications arrive
    /// asynchronously via `entities_health` and `combat` events.
    #[serde(rename_all = "camelCase")]
    CastSpell { spell_id: u32, aim: SpellCastAim },
    /// Changes resting posture (`standing`, `crouching`, `sitting`, `lying`).
    #[serde(rename_all = "camelCase")]
    SetRestPosture { posture: RestPostureSpec },
    /// Cancels the current resting posture and stands up.
    CancelRestPosture,
    /// Initiates a recall spell to the specified `destination`.
    #[serde(rename_all = "camelCase")]
    Recall { destination: RecallDestination },

    // --- World Interaction & Appraisal ---
    /// Uses a world entity (door, portal, chest, NPC, corpse, etc.).
    #[serde(rename_all = "camelCase")]
    UseEntity {
        guid: Guid,
        /// When `true`, bypasses local client-side `useCapability` pre-checks and sends the use
        /// packet anyway (the game server still enforces actual rules).
        #[serde(default)]
        unrestricted: bool,
    },
    /// Requests server appraisal of `guid` (`factsOnly: true` refreshes background facts only).
    #[serde(rename_all = "camelCase")]
    RequestAppraisal {
        guid: Guid,
        /// When true, fetches background facts only without inspector output.
        #[serde(default)]
        facts_only: bool,
    },
    /// Requests a fresh health fraction update for creature `guid`.
    #[serde(rename_all = "camelCase")]
    QueryHealth { guid: Guid },
    /// Reads page `pageIndex` (0-based) from book `book`.
    #[serde(rename_all = "camelCase")]
    ReadBookPage { book: Guid, page_index: u32 },

    // --- Crafting & Salvage ---
    /// Uses carried item `source`, optionally targeting `target` (e.g. healing kit, mana stone, lockpick).
    #[serde(rename_all = "camelCase")]
    UseItem {
        source: Guid,
        #[serde(default)]
        target: Option<Guid>,
    },
    /// Salvages `items` using `tool` (or the first carried Ust when `tool` is omitted; use `POST /v1/preview` `salvage` first to check eligibility and pending appraisals).
    #[serde(rename_all = "camelCase")]
    Salvage {
        /// Optional explicit Ust GUID; discovers the first carried Ust when omitted.
        #[serde(default)]
        tool: Option<Guid>,
        items: Vec<Guid>,
    },

    // --- Inventory & Equipment ---
    /// Performs an inventory mutation (pickup, move, equip, unequip, split, stack, drop, give) on `item` toward `target`.
    #[serde(rename_all = "camelCase")]
    Inventory {
        #[serde(flatten)]
        intent: InventoryIntent,
    },
    /// Equips or clears a batch of equipment slots atomically.
    #[serde(rename_all = "camelCase")]
    ApplyEquipmentSet { bindings: Vec<EquipmentBindingSpec> },
    /// Automatically merges matching stackable items inside `container`.
    #[serde(rename_all = "camelCase")]
    AutoMergeContainer { container: Guid },
    /// Closes an open world container (chest/corpse).
    #[serde(rename_all = "camelCase")]
    CloseContainer { guid: Guid },

    // --- Trade & Vendor ---
    /// Performs a player-to-player trade action (`action.kind`).
    #[serde(rename_all = "camelCase")]
    Trade { action: TradeRequest },
    /// Executes a buy/sell transaction against the open `vendor`.
    #[serde(rename_all = "camelCase")]
    VendorTrade {
        #[serde(flatten)]
        trade: VendorTradeSpec,
    },

    // --- Shared Physics-Safe Steering & Bounded Drive ---
    /// Starts physics-safe local steering toward a goal (entity, point, or heading).
    #[serde(rename_all = "camelCase")]
    Steer {
        #[serde(flatten)]
        request: LocalSteeringRequest,
    },
    /// Immediately stops active local steering or drive movement.
    StopMovement,
    /// Applies a bounded manual movement pulse that auto-expires after `durationMs`.
    #[serde(rename_all = "camelCase")]
    DrivePulse {
        #[serde(flatten)]
        pulse: DrivePulseSpec,
    },
    /// Immediately turns the character to face `heading` (radians).
    #[serde(rename_all = "camelCase")]
    SnapFacing { heading: f32 },

    // --- Frontend Hooks (`ui.*` / `h3d.hud`) ---
    /// Selects entity `guid` in the frontend UI, or clears selection when `null`.
    #[serde(rename_all = "camelCase")]
    SetSelection { guid: Option<Guid> },
    /// Prints a local-only styled message to the client's chat/log window.
    /// In h3d, outdoor coordinates (`42.3N, 15.8E`) become clickable waypoints and `[Label](0xHEX)`
    /// becomes a clickable entity tag (plain text in TUI).
    #[serde(rename_all = "camelCase")]
    UiPrint {
        #[serde(flatten)]
        request: UiPrintRequest,
    },
    /// Displays a transient HUD toast notification (h3d only).
    #[serde(rename_all = "camelCase")]
    HudToast {
        #[serde(flatten)]
        request: HudToastRequest,
    },
    /// Upserts keyed 3D world-space overlay markers (rings or polylines) with TTL (h3d only).
    #[serde(rename_all = "camelCase")]
    HudUpsertMarkers {
        #[serde(flatten)]
        request: HudMarkersUpsertRequest,
    },
    /// Clears active 3D HUD markers (all markers when `namespace` is omitted/null) (h3d only).
    #[serde(rename_all = "camelCase")]
    HudClearMarkers {
        #[serde(default)]
        namespace: Option<String>,
    },
}

/// Request envelope for `POST /v1/command`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommandRequest {
    pub command: ApiCommand,
    #[serde(default)]
    pub wait: WaitPolicy,
}

/// Settlement outcome of a busy operation (`use-entity`, `cast-spell`, `recall`, `salvage`, etc.).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BusyOperationOutcome {
    pub operation: BusyOperationKind,
    pub succeeded: bool,
    pub error: Option<String>,
    pub timed_out: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub teleported: Option<bool>,
}

/// Settlement outcome of `request-appraisal`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AppraisalOutcome {
    pub guid: Guid,
    pub facts_only: bool,
    pub status: AppraisalStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inspection: Option<Value>,
}

/// Settlement outcome of `select-character` or `logout`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleOutcome {
    pub lifecycle: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejection: Option<String>,
}

/// Settlement outcome of `set-combat-mode`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CombatModeOutcome {
    /// Confirmed server combat mode (`"peace"`, `"melee"`, `"missile"`, or `"magic"`).
    pub mode: String,
    /// `true` when the confirmed mode matches the requested mode (`false` if the server fell back to `"peace"`).
    pub matched: bool,
}

/// Settlement outcome of `inventory` moves/equips/drops/pickups.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct InventoryOutcome {
    pub item: Guid,
    /// `"updated"`, `"despawned"`, `"already-in-target"`, or `"rejected"`.
    pub settled_by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Typed settlement outcome carried by `CommandResponse.outcome` when `wait.until = "settled"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum CommandOutcome {
    Busy(BusyOperationOutcome),
    Appraisal(AppraisalOutcome),
    Navigation(LocalNavigationFinished),
    Lifecycle(LifecycleOutcome),
    CombatMode(CombatModeOutcome),
    Inventory(InventoryOutcome),
    /// Item-use or vendor-trade outcome payload.
    Dynamic(Value),
}

/// Response returned by `POST /v1/command` and WS `command` requests.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommandResponse {
    pub accepted: bool,
    pub correlation_id: Option<u64>,
    pub settled: bool,
    pub timed_out: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<CommandOutcome>,
    pub latest_event_seq: u64,
}

/// Unified read query enum shared by WebSocket (`WS /v1/ws`) and V8 scripting (`op_query`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ApiQuery {
    Info,
    Characters,
    SelfState,
    CharacterSheet,
    Enchantments,
    Spellbook,
    Recalls,
    CharacterOptions,
    DeathLocations,
    #[serde(rename_all = "camelCase")]
    Entities {
        #[serde(default)]
        filter: EntityFilter,
    },
    #[serde(rename_all = "camelCase")]
    EntityDetail {
        guid: Guid,
        #[serde(default)]
        include_properties: bool,
    },
    Inventory,
    Equipment,
    Combat,
    Trade,
    Vendor,
    Social,
    Selection,
    #[serde(rename_all = "camelCase")]
    WorldCells {
        #[serde(default)]
        landblock: Option<Guid>,
    },
    #[serde(rename_all = "camelCase")]
    ContentSpells {
        #[serde(default)]
        search: Option<String>,
        #[serde(default)]
        school: Option<String>,
        #[serde(default)]
        known: bool,
    },
    #[serde(rename_all = "camelCase")]
    ContentSpell { id: u32 },
    ContentSkills,
}

/// Subscription topics for `GET /v1/events` and `WS /v1/ws`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiEventTopic {
    Lifecycle,
    Busy,
    Confirmations,
    Errors,
    Vitals,
    Enchantments,
    Spellbook,
    CharacterSheet,
    EntitiesLifecycle,
    EntitiesFacts,
    EntitiesHealth,
    Appraisal,
    Combat,
    Magic,
    Crafting,
    Trade,
    Vendor,
    Chat,
    Social,
    Movement,
    Selection,
    Automation,
}

impl ApiEventTopic {
    pub fn parse_name(name: &str) -> Option<Self> {
        match name.trim() {
            "lifecycle" => Some(Self::Lifecycle),
            "busy" => Some(Self::Busy),
            "confirmations" => Some(Self::Confirmations),
            "errors" => Some(Self::Errors),
            "vitals" => Some(Self::Vitals),
            "enchantments" => Some(Self::Enchantments),
            "spellbook" => Some(Self::Spellbook),
            "character_sheet" => Some(Self::CharacterSheet),
            "entities.lifecycle" | "entities_lifecycle" => Some(Self::EntitiesLifecycle),
            "entities.facts" | "entities_facts" => Some(Self::EntitiesFacts),
            "entities.health" | "entities_health" => Some(Self::EntitiesHealth),
            "appraisal" => Some(Self::Appraisal),
            "combat" => Some(Self::Combat),
            "magic" => Some(Self::Magic),
            "crafting" => Some(Self::Crafting),
            "trade" => Some(Self::Trade),
            "vendor" => Some(Self::Vendor),
            "chat" => Some(Self::Chat),
            "social" => Some(Self::Social),
            "movement" => Some(Self::Movement),
            "selection" => Some(Self::Selection),
            "automation" => Some(Self::Automation),
            _ => None,
        }
    }
}

/// Speaker identity attached to chat/tell/emote events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventSpeaker {
    pub name: String,
    pub kind: ChatSpeakerKind,
    pub reply_target: Option<ChatTellTarget>,
}

/// Typed combat feedback payload emitted by `ApiEvent::CombatFeedback`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum CombatFeedbackDetail {
    AttackDone {
        error: String,
        ok: bool,
    },
    AttackCommenced,
    AttackerNotification {
        defender_name: String,
        damage_type: String,
        health_percent: f64,
        damage: u32,
        critical_hit: bool,
    },
    DefenderNotification {
        attacker_name: String,
        damage_type: String,
        health_percent: f64,
        damage: u32,
        damage_location: String,
        critical_hit: bool,
    },
    EvasionAttacker {
        defender_name: String,
    },
    EvasionDefender {
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

/// Flattened outcome status of an appraisal (`request-appraisal` / `AppraisalCompleted`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppraisalStatus {
    /// Facts-only appraisal settled without requesting full object inspection.
    FactsOnly,
    /// Full object inspection snapshot is attached in `inspection`.
    Ready,
    /// Server rejected the appraisal request.
    Rejected,
    /// Target entity or vendor item no longer resolves.
    Missing,
    /// Disclosed facts could not be interpreted (details in `reason`).
    Unavailable,
}

/// Semantic event payload stored in the `seq`-indexed ring buffer and pushed to subscribers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ApiEvent {
    LifecycleChanged {
        lifecycle: LifecyclePhaseView,
    },
    #[serde(rename_all = "camelCase")]
    BusyStateChanged {
        busy: Option<BusyOperationKind>,
    },
    #[serde(rename_all = "camelCase")]
    BusyOperationFinished {
        operation: BusyOperationKind,
        succeeded: bool,
        error: Option<String>,
        timed_out: bool,
    },
    #[serde(rename_all = "camelCase")]
    ConfirmationChanged {
        confirmation: Option<ConfirmationView>,
    },
    #[serde(rename_all = "camelCase")]
    ErrorNotice {
        source: String,
        message: String,
    },
    VitalsUpdated,
    EnchantmentsUpdated,
    #[serde(rename_all = "camelCase")]
    SpellbookUpdated {
        spell_ids: Vec<u32>,
    },
    CharacterSheetUpdated,
    #[serde(rename_all = "camelCase")]
    EntitySpawned {
        guid: Guid,
        name: String,
        wcid: Option<u32>,
    },
    #[serde(rename_all = "camelCase")]
    EntityDespawned {
        guid: Guid,
    },
    #[serde(rename_all = "camelCase")]
    EntityFactsChanged {
        upserted: Vec<Guid>,
        removed: Vec<Guid>,
    },
    #[serde(rename_all = "camelCase")]
    EntityHealthUpdated {
        guid: Guid,
        health_fraction: f32,
    },
    #[serde(rename_all = "camelCase")]
    AppraisalCompleted {
        guid: Guid,
        facts_only: bool,
        status: AppraisalStatus,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        inspection: Option<Value>,
    },
    #[serde(rename_all = "camelCase")]
    CombatModeUpdated {
        mode: String,
    },
    #[serde(rename_all = "camelCase")]
    CombatFeedback {
        detail: CombatFeedbackDetail,
    },
    #[serde(rename_all = "camelCase")]
    CombatStatusUpdated {
        state: ClientCombatControlState,
        target: Option<Guid>,
    },
    #[serde(rename_all = "camelCase")]
    SpellCastTargetUpdated {
        target: Option<Guid>,
    },
    #[serde(rename_all = "camelCase")]
    ItemUseFinished {
        sequence: u32,
        outcome: Value,
    },
    #[serde(rename_all = "camelCase")]
    SalvageSubmitted {
        sequence: u32,
        outcome: Value,
    },
    #[serde(rename_all = "camelCase")]
    TradeUpdated {
        trade: TradeView,
    },
    #[serde(rename_all = "camelCase")]
    VendorUpdated {
        vendor: Option<VendorView>,
    },
    #[serde(rename_all = "camelCase")]
    VendorTradeFinished {
        sequence: u32,
        result: Value,
    },
    #[serde(rename_all = "camelCase")]
    Chat {
        channel: String,
        speaker: Option<EventSpeaker>,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Tell {
        speaker: EventSpeaker,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    ChannelMessage {
        channel: ChatChannelKind,
        speaker: EventSpeaker,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    SocialUpdated {
        section: String,
    },
    #[serde(rename_all = "camelCase")]
    NavigationFinished {
        finished: LocalNavigationFinished,
    },
    #[serde(rename_all = "camelCase")]
    TeleportStarted {
        sequence: u16,
    },
    #[serde(rename_all = "camelCase")]
    ForcedReposition {
        guid: Guid,
        position: WorldPosition,
    },
    #[serde(rename_all = "camelCase")]
    SelectionChanged {
        guid: Option<Guid>,
    },
    #[serde(rename_all = "camelCase")]
    AutomationPausedChanged {
        paused: bool,
    },
}

/// Ordered event envelope returned by `GET /v1/events` and pushed on `WS /v1/ws`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiEventEnvelope {
    pub seq: u64,
    pub timestamp_ms: u64,
    pub topic: ApiEventTopic,
    pub event: ApiEvent,
}

/// Cursor-paginated response from `GET /v1/events`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EventsPage {
    pub events: Vec<ApiEventEnvelope>,
    pub next_seq: u64,
    /// Non-null when events older than the requested `since` cursor were evicted from the ring buffer.
    pub dropped_before: Option<u64>,
}

/// Opt-in live-only motion sample pushed over WebSocket when `includeMotionHz` is enabled.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MotionEventFrame {
    pub guid: Guid,
    pub position: WorldPosition,
    pub timestamp_ms: u64,
}

/// Client-to-server WebSocket message (`WS /v1/ws`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WsClientFrame {
    #[serde(rename_all = "camelCase")]
    Query { id: u64, query: ApiQuery },
    #[serde(rename_all = "camelCase")]
    Preview { id: u64, preview: ApiPreviewRequest },
    #[serde(rename_all = "camelCase")]
    Command {
        id: u64,
        command: ApiCommand,
        #[serde(default)]
        wait: WaitPolicy,
    },
    #[serde(rename_all = "camelCase")]
    Subscribe {
        id: u64,
        /// Empty subscribes to all semantic topics.
        #[serde(default)]
        topics: Vec<ApiEventTopic>,
        /// Optional starting sequence cursor for catch-up replay from the ring buffer.
        #[serde(default)]
        since: Option<u64>,
        /// Optional live throttled motion feed rate in Hz (1..=15); never stored in the ring buffer.
        #[serde(default)]
        include_motion_hz: Option<u8>,
    },
}

/// Server-to-client WebSocket message (`WS /v1/ws`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum WsServerFrame {
    /// Reply correlated to a client `query`, `preview`, `command`, or `subscribe` frame.
    /// `result` matches the corresponding REST response shape, or `{ "subscribed": [...],
    /// "latestEventSeq": u64, "nextSeq": u64, "replayed": usize, "droppedBefore": u64 | null }`
    /// for `subscribe`.
    #[serde(rename_all = "camelCase")]
    Response { id: u64, result: Value },
    #[serde(rename_all = "camelCase")]
    Error { id: u64, error: ApiError },
    #[serde(rename_all = "camelCase")]
    Event { envelope: ApiEventEnvelope },
    #[serde(rename_all = "camelCase")]
    Motion { motion: MotionEventFrame },
}

/// Converts a `snake_case` JSON key into `camelCase`; leaves PascalCase and ALL_CAPS keys intact.
fn snake_to_camel_key(key: &str) -> String {
    if !key.contains('_') || !key.bytes().any(|b| b.is_ascii_lowercase()) {
        return key.to_string();
    }
    let mut out = String::with_capacity(key.len());
    let mut capitalize_next = false;
    for ch in key.chars() {
        if ch == '_' {
            capitalize_next = !out.is_empty();
        } else if capitalize_next {
            out.push(ch.to_ascii_uppercase());
            capitalize_next = false;
        } else {
            out.push(ch);
        }
    }
    out
}

/// Recursively normalizes `snake_case` object keys to `camelCase` for internal world/protocol blobs.
pub(crate) fn camelize_json(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(camelize_json).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| (snake_to_camel_key(&k), camelize_json(v)))
                .collect(),
        ),
        other => other,
    }
}

/// Serializes an internal world/protocol value to JSON with `camelCase` object keys.
pub(crate) fn to_camel_json<T: Serialize>(value: T) -> Option<Value> {
    serde_json::to_value(value).ok().map(camelize_json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn camelize_json_converts_snake_case_and_preserves_pascal_and_caps() {
        let input = json!({
            "attr_type": "Strength",
            "nested_items": [{ "merge_key": 1, "alreadyCamel": true, "ItemType": 4, "ALL_CAPS": 9 }],
        });
        let actual = camelize_json(input);
        assert_eq!(
            actual,
            json!({
                "attrType": "Strength",
                "nestedItems": [{ "mergeKey": 1, "alreadyCamel": true, "ItemType": 4, "ALL_CAPS": 9 }],
            })
        );
    }
}
