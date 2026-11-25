//! Client-authority command types, wire deserializers, and validation.

use anyhow::{Result, ensure};
use holtburger_common::CharacterOption;
use holtburger_core::ClientCommand;
use holtburger_core::client::inventory_storage::EquipmentStoragePolicy;
use holtburger_core::client::types::{ChatChannelDestination, ChatTellTarget};
use serde::Deserialize;

use crate::host_mode::ClientLaunchConfiguration;

/// Explicit requested mode excludes the unknown observation used during character hydration.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequestedCombatMode {
    Peace,
    Melee,
    Missile,
    Magic,
}

impl From<RequestedCombatMode> for holtburger_protocol::messages::combat::CombatMode {
    fn from(mode: RequestedCombatMode) -> Self {
        match mode {
            RequestedCombatMode::Peace => Self::NonCombat,
            RequestedCombatMode::Melee => Self::Melee,
            RequestedCombatMode::Missile => Self::Missile,
            RequestedCombatMode::Magic => Self::Magic,
        }
    }
}

/// Typed chat intent; command spelling and destination selection remain frontend-owned.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ClientChatRequest {
    Speech {
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
    /// Catalog alias; core owns motion and broadcast phrase resolution.
    SoulEmote {
        token: String,
        /// Optional caller identity for local motion admission and completion results.
        #[serde(default, rename = "requestId")]
        request_id: Option<u32>,
    },
}

impl ClientChatRequest {
    /// Validate the independently callable host boundary before enqueueing a core command.
    pub(super) fn into_command(self) -> Result<ClientCommand> {
        let message = match &self {
            Self::Speech { message }
            | Self::Tell { message, .. }
            | Self::Channel { message, .. }
            | Self::Emote { message } => message,
            Self::SoulEmote { token, .. } => token,
        };
        ensure!(
            !message.trim().is_empty(),
            "Chat message must contain visible text."
        );
        Ok(match self {
            Self::Speech { message } => ClientCommand::Talk(message),
            Self::Tell { target, message } => {
                match &target {
                    ChatTellTarget::Player { name } => ensure!(
                        !name.trim().is_empty(),
                        "Tell recipient name must contain visible text."
                    ),
                    ChatTellTarget::Npc { guid, name } => {
                        ensure!(
                            guid.is_static_object() || guid.is_dynamic_object(),
                            "NPC tell target must be a creature entity ID."
                        );
                        ensure!(
                            !name.trim().is_empty(),
                            "NPC tell target label must contain visible text."
                        );
                    }
                }
                ClientCommand::Tell { target, message }
            }
            Self::Channel { channel, message } => {
                ClientCommand::ChannelMessage { channel, message }
            }
            Self::Emote { message } => ClientCommand::Emote(message),
            Self::SoulEmote { token, request_id } => ClientCommand::SoulEmote { token, request_id },
        })
    }
}

/// Canonical scene map-plane coordinates (X east, Z south), without an invented height.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClientMapPosition {
    pub x: f32,
    pub z: f32,
}

impl ClientMapPosition {
    /// Validate and convert the authored horizontal domain at its owning adapter boundary.
    pub(super) fn destination(self) -> Result<holtburger_common::position::WorldPosition> {
        let mut position =
            crate::placed_motion_presentation::scene_point_to_pose([self.x, 0.0, self.z])?;
        // Block 0000 with the converter's owner selector is also Guid::NULL. Seed a terrain
        // selector so normalization can derive a valid cell even at the southwest origin.
        position.landblock_id.0 |= 1;
        Ok(position.normalize_outdoor_cell())
    }
}

/// Strict renderer-owned camera identity reused by camera-ray commands.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientCameraIdentityRequest {
    pub camera_generation: u64,
    pub player_guid: holtburger_common::Guid,
    pub entity_generation: u64,
}

impl From<ClientCameraIdentityRequest> for holtburger_core::ClientCameraIdentity {
    fn from(identity: ClientCameraIdentityRequest) -> Self {
        Self {
            camera_generation: identity.camera_generation,
            player_guid: identity.player_guid,
            entity_generation: identity.entity_generation,
        }
    }
}

/// Strict renderer camera-ray request; authority and launch facts are intentionally absent.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientPreciseJumpAimRequest {
    pub camera: ClientCameraIdentityRequest,
    pub sequence: u64,
    pub anchor: holtburger_common::Guid,
    pub start: [f32; 3],
    pub direction: [f32; 3],
    pub maximum_distance: f32,
    pub previous_cell: Option<holtburger_common::Guid>,
    /// User-selected normalized jump power.
    pub power: f32,
}

/// Strict selection ray; its one-landblock maximum remains world-owned.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientEntitySelectionQueryRequest {
    pub camera: ClientCameraIdentityRequest,
    pub sequence: u64,
    pub anchor: holtburger_common::Guid,
    pub start: [f32; 3],
    pub direction: [f32; 3],
    pub previous_cell: Option<holtburger_common::Guid>,
}

impl ClientEntitySelectionQueryRequest {
    pub(super) fn into_core(self) -> Result<holtburger_core::EntitySelectionQueryRequest> {
        let finite = |vector: [f32; 3]| vector.into_iter().all(f32::is_finite);
        ensure!(
            finite(self.start),
            "entity-selection ray start must be finite"
        );
        ensure!(
            finite(self.direction),
            "entity-selection ray direction must be finite"
        );
        Ok(holtburger_core::EntitySelectionQueryRequest {
            camera: self.camera.into(),
            sequence: holtburger_core::EntitySelectionQuerySequence(self.sequence),
            anchor: self.anchor,
            start: holtburger_common::Vector3::new(self.start[0], self.start[1], self.start[2]),
            direction: holtburger_common::Vector3::new(
                self.direction[0],
                self.direction[1],
                self.direction[2],
            ),
            previous_cell: self.previous_cell,
        })
    }
}

impl ClientPreciseJumpAimRequest {
    pub(super) fn into_core(self) -> Result<holtburger_core::PreciseJumpAimRequest> {
        let finite = |vector: [f32; 3]| vector.into_iter().all(f32::is_finite);
        ensure!(finite(self.start), "precise-jump ray start must be finite");
        ensure!(
            finite(self.direction),
            "precise-jump ray direction must be finite"
        );
        ensure!(
            self.maximum_distance.is_finite() && self.maximum_distance >= 0.0,
            "precise-jump ray distance must be finite and non-negative"
        );
        Ok(holtburger_core::PreciseJumpAimRequest {
            camera: self.camera.into(),
            sequence: holtburger_core::PreciseJumpAimSequence(self.sequence),
            power: holtburger_core::JumpExtent::new(self.power).map_err(|_| {
                anyhow::anyhow!("precise-jump power must be finite and within 0.001 to 1")
            })?,
            anchor: self.anchor,
            start: holtburger_common::Vector3::new(self.start[0], self.start[1], self.start[2]),
            direction: holtburger_common::Vector3::new(
                self.direction[0],
                self.direction[1],
                self.direction[2],
            ),
            maximum_distance: self.maximum_distance,
            previous_cell: self.previous_cell,
        })
    }
}

/// Strict click-time target and power, independent of preview work.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientPreciseJumpCommitRequest {
    pub sequence: u64,
    pub camera: ClientCameraIdentityRequest,
    pub target: crate::client_projection::ClientPreciseJumpTargetWire,
    pub power: f32,
}

impl ClientPreciseJumpCommitRequest {
    pub(super) fn into_core(self) -> Result<holtburger_core::PreciseJumpCommitRequest> {
        ensure!(
            self.target.point.into_iter().all(f32::is_finite),
            "precise-jump target point must be finite"
        );
        ensure!(
            self.target.normal.into_iter().all(f32::is_finite),
            "precise-jump target normal must be finite"
        );
        ensure!(
            self.target.anchor.0 & 0xffff == 0xffff,
            "precise-jump target anchor must be normalized"
        );
        let [x, y, z] = self.target.point;
        let [nx, ny, nz] = self.target.normal;
        Ok(holtburger_core::PreciseJumpCommitRequest {
            sequence: holtburger_core::PreciseJumpActionSequence(self.sequence),
            camera: self.camera.into(),
            target: holtburger_core::PreciseJumpTargetView {
                anchor: self.target.anchor,
                point: holtburger_common::Vector3::new(x, y, z),
                normal: holtburger_common::Vector3::new(nx, ny, nz),
                committed_cell: self.target.committed_cell,
            },
            power: holtburger_core::JumpExtent::new(self.power).map_err(|_| {
                anyhow::anyhow!("precise-jump power must be finite and within 0.001 to 1")
            })?,
        })
    }
}

/// Browser object keys remain strings in MessagePack; convert them only at the app boundary.
fn deserialize_equipment_storage<'de, D>(
    deserializer: D,
) -> std::result::Result<EquipmentStoragePolicy, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    struct Wire {
        preferred: std::collections::BTreeMap<String, holtburger_common::Guid>,
        fallback: Vec<holtburger_common::Guid>,
    }
    let wire = Wire::deserialize(deserializer)?;
    let preferred = wire
        .preferred
        .into_iter()
        .map(|(key, container)| {
            let item = key.parse::<u32>().map_err(serde::de::Error::custom)?;
            // Canonical keys prevent aliases such as "01" from replacing another entry.
            if item == 0 || item.to_string() != key {
                return Err(serde::de::Error::custom(
                    "Equipment item GUID must be a positive canonical decimal string",
                ));
            }
            Ok((holtburger_common::Guid(item), container))
        })
        .collect::<std::result::Result<_, D::Error>>()?;
    Ok(EquipmentStoragePolicy {
        preferred,
        fallback: wire.fallback,
    })
}

/// Keep the browser's container-key codec out of the shared preview contract.
fn deserialize_inventory_preview<'de, D>(
    deserializer: D,
) -> std::result::Result<holtburger_core::client::inventory_plan::InventoryPreviewRequest, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    struct Wire {
        sequence: u32,
        intent: holtburger_core::client::inventory_plan::InventoryIntent,
        #[serde(deserialize_with = "deserialize_equipment_storage")]
        storage: EquipmentStoragePolicy,
    }
    let wire = Wire::deserialize(deserializer)?;
    Ok(
        holtburger_core::client::inventory_plan::InventoryPreviewRequest {
            sequence: wire.sequence,
            intent: wire.intent,
            storage: wire.storage,
        },
    )
}

/// JSON uses JavaScript's exact integer range; the shared controller only owns durations.
fn deserialize_auto_merge_policy<'de, D>(
    deserializer: D,
) -> std::result::Result<holtburger_core::client::container_auto_merge::AutoMergePolicy, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let policy =
        holtburger_core::client::container_auto_merge::AutoMergePolicy::deserialize(deserializer)?;
    const SAFE_MILLISECONDS: std::ops::RangeInclusive<u64> = 1..=((1_u64 << 53) - 1);
    if !SAFE_MILLISECONDS.contains(&policy.step_timeout_ms)
        || !SAFE_MILLISECONDS.contains(&policy.operation_timeout_ms)
    {
        return Err(serde::de::Error::custom(
            "Auto-merge timeouts must be positive safe integer milliseconds",
        ));
    }
    Ok(policy)
}

/// Commands accepted only by the client authority.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum ClientHostCommand {
    /// Control/read a bounded diagnostic capture independently of gameplay commands.
    ClientPerformance {
        request: crate::client_performance::ClientPerformanceRequest,
    },
    /// Submit a semantic barber preview, Apply, or cancellation to the shared owner.
    RequestClientBarber {
        request: holtburger_core::client::barber::BarberRequest,
    },
    /// Submit reusable equipment bindings, with one peace prerequisite if required.
    ApplyClientEquipmentSet {
        bindings: Vec<crate::client_projection::ClientEquipmentBindingWire>,
        /// Browser-selected outgoing-item preferences and fallback order.
        #[serde(deserialize_with = "deserialize_equipment_storage")]
        storage: EquipmentStoragePolicy,
    },
    /// Request authoritative examination facts for one selected entity.
    ExamineClientEntity {
        guid: holtburger_common::Guid,
        /// Periodic inspection refreshes allow suppressed identical creature previews.
        #[serde(default)]
        refresh: bool,
    },
    /// Request background facts-only appraisal without delivering inspector results to frontends.
    RequestClientFactsAppraisal {
        guid: holtburger_common::Guid,
    },
    /// Cancel a pending queued/inflight client appraisal demand for `guid`.
    CancelClientAppraisal {
        guid: holtburger_common::Guid,
        demand: holtburger_core::AppraisalOutputDemand,
    },
    /// Request one missing page for the character that opened the reader.
    ReadClientBookPage {
        /// Character identity checked by core before sending.
        player: holtburger_common::Guid,
        /// Book containing the page.
        book: holtburger_common::Guid,
        /// Zero-based page identity from the full response.
        #[serde(rename = "pageIndex")]
        page_index: u32,
    },
    /// Select a title for the captured character; eligibility remains server-owned.
    SetClientCharacterTitle {
        /// Character identity admitted by core.
        character: holtburger_common::Guid,
        /// Numeric selection, independent of local content resolution.
        #[serde(rename = "titleId")]
        title_id: u32,
    },
    /// Read-only spell examination against current character facts.
    QueryClientSpellInspection {
        query: holtburger_core::client::spell_inspection::SpellInspectionQuery,
    },
    /// Evaluate a current batch of character advancement intents.
    EvaluateClientProgression {
        #[serde(rename = "requestId")]
        request_id: u32,
        intents: Vec<holtburger_world::progression::ProgressionIntent>,
    },
    /// Submit one exact core quote through its character-scoped guard.
    SubmitClientProgression {
        quote: holtburger_core::ClientProgressionQuote,
    },
    /// Query compatibility without executing item use.
    QueryClientItemUseTarget {
        query: holtburger_core::client::item_use::ItemUseTargetQuery,
    },
    /// Read-only salvage tool discovery and ordered batch evaluation.
    PreviewClientSalvage {
        request: holtburger_core::client::salvage::SalvagePreviewRequest,
    },
    /// Revalidate reviewed sources before dispatching one salvage action.
    SubmitClientSalvage {
        request: holtburger_core::client::salvage::SalvageSubmitRequest,
    },
    /// Execute only while the supplied semantic use consequence still matches.
    SubmitClientItemUse {
        request: holtburger_core::client::item_use::ItemUseRequest,
    },
    /// Consolidate direct carried contents using the application's explicit timeout policy.
    AutoMergeClientContainer {
        /// Player root or real carried pack identity.
        container: holtburger_common::Guid,
        /// Finite budgets snapshotted by the browser at invocation.
        #[serde(deserialize_with = "deserialize_auto_merge_policy")]
        policy: holtburger_core::client::container_auto_merge::AutoMergePolicy,
    },
    /// Execute a semantic inventory gesture against the latest authoritative world.
    SubmitClientInventory {
        intent: holtburger_core::client::inventory_plan::InventoryIntent,
        /// Browser-selected destinations when this gesture removes equipment.
        #[serde(deserialize_with = "deserialize_equipment_storage")]
        storage: EquipmentStoragePolicy,
    },
    /// Close only the named confirmed external root through shared coordination.
    CloseClientContainer {
        guid: holtburger_common::Guid,
    },
    /// Shared, mutation-free evaluation of an inventory target.
    PreviewClientInventory {
        #[serde(deserialize_with = "deserialize_inventory_preview")]
        request: holtburger_core::client::inventory_plan::InventoryPreviewRequest,
    },
    /// Evaluate a candidate vendor draft using shared world semantics.
    PreviewClientVendor {
        request: holtburger_core::client::vendor_transaction::VendorTradeRequest,
    },
    /// Submit one sell-then-buy execution to core.
    SubmitClientVendor {
        request: holtburger_core::client::vendor_transaction::VendorTradeRequest,
    },
    /// Submit a guarded P2P negotiation command through the shared client path.
    SubmitClientTrade {
        request: holtburger_core::client::trade::TradeRequest,
    },
    /// Private Electron-main launch command; renderers never receive this inventory entry.
    StartClient {
        startup: ClientLaunchConfiguration,
    },
    /// Toggle peace and the current equipment-derived stance in core.
    ToggleClientCombatMode,
    /// Silent posture request; shared core establishes peace before resting.
    SetClientRestPosture {
        /// Gameplay resting target; social aliases are not accepted here.
        posture: holtburger_world::motion::RestPosture,
    },
    /// Cancel an uncompleted peace prerequisite without changing combat mode.
    CancelClientRestPosture,
    /// Explicit stance request for app-owned workflows; independent of toggle timing.
    SetClientCombatMode {
        /// Explicit family captured by the frontend; unknown hydration state is not an intent.
        mode: RequestedCombatMode,
    },
    /// Change one server-saved option exposed by Gameplay settings.
    SetClientGameplayOption {
        option: crate::client_gameplay::ClientGameplayOption,
        enabled: bool,
    },
    /// Change one server-backed appearance preference exposed by the client UI.
    SetClientAppearanceOption {
        option: ClientAppearanceOption,
        enabled: bool,
    },
    /// Submit a spellbook cast with caller-owned recipient intent.
    CastClientSpell {
        #[serde(rename = "spellId")]
        spell_id: u32,
        aim: holtburger_core::client::types::SpellCastAim,
    },
    BeginClientCombatEngagement {
        #[serde(rename = "intentSequence")]
        intent_sequence: u64,
        target: holtburger_common::Guid,
        profile: holtburger_core::ClientAttackProfile,
    },
    UpdateClientCombatProfile {
        profile: holtburger_core::ClientAttackProfile,
    },
    StopClientCombatEngagement {
        #[serde(rename = "intentSequence")]
        intent_sequence: u64,
    },
    RequestClientCurrentState,
    /// Refresh the active character/account effective home.
    RefreshClientHousing,
    /// Submit reviewed implicit-home administration.
    SubmitClientHousingManagement {
        request: holtburger_core::client::housing_management::HousingManagementRequest,
    },
    /// Read named permissions after effective-home initialization.
    QueryClientHousingAccess,
    /// Search available areas of a supported housing type.
    SearchClientHousing {
        #[serde(rename = "houseType")]
        house_type: u32,
    },
    /// Quote or edit a requirement-row draft without sending BuyHouse/RentHouse.
    PreviewClientHousingPayment {
        request: holtburger_core::client::housing_payment::HousingPreviewRequest,
    },
    /// Submit the housing profile and consumption accepted in confirmation.
    SubmitClientHousingPayment {
        request: holtburger_core::client::housing_execution::HousingPaymentRequest,
    },
    SelectClientCharacter {
        guid: holtburger_common::Guid,
    },
    /// Semantic build validated through shared creation rules before sending.
    CreateClientCharacter {
        draft: crate::character_creation::CharacterCreationDraft,
    },
    /// Delete a character at its current server roster slot.
    DeleteClientCharacter {
        slot: u32,
    },
    /// Restore a character still inside the server's recovery window.
    RestoreClientCharacter {
        guid: holtburger_common::Guid,
    },
    ReplaceClientDrive {
        request: crate::client_host::ClientDriveRequest,
    },
    QueueClientCharacterMotionEvent {
        request: crate::client_host::ClientCharacterMotionEventRequest,
    },
    /// Replace the server health subscription; null GUID cancels it.
    QueryClientEntityHealth {
        guid: holtburger_common::Guid,
    },
    /// Answer exactly the confirmation occurrence displayed by the renderer.
    RespondToClientConfirmation {
        request_id: String,
        accepted: bool,
    },
    /// Allegiance intents delegate to shared command/read coordination.
    SubmitClientAllegiance {
        action: crate::client_allegiance::ClientAllegianceAction,
    },
    /// Ignore intents delegate to focused shared command behavior.
    SubmitClientSquelch {
        action: crate::client_squelch::ClientSquelchAction,
    },
    /// Abandon journal contract without resetting quest progress.
    AbandonClientContract {
        /// Stable contract registry identity.
        id: u32,
    },
    /// Friends mutations use the focused shared command behavior.
    SubmitClientFriends {
        action: crate::client_friends::ClientFriendsAction,
    },
    /// Party management delegates to reusable core commands.
    SubmitClientParty {
        action: crate::client_party::ClientPartyAction,
    },
    /// Presentation demand controls fellowship update delivery.
    SetClientPartyUpdates {
        enabled: bool,
    },
    /// Standard recall attempt; the server validates binding and temporary blockers.
    RecallClient {
        destination: holtburger_core::client::recall::RecallDestination,
    },
    /// Read saved or session-observed death locations on demand.
    QueryClientDeathLocations {
        /// Which core-owned historical facts to return.
        query: holtburger_core::client::corpse::DeathLocationQuery,
    },
    /// Manage received corpse permissions; grammar and help are frontend-owned.
    ManageClientCorpseConsent {
        /// Incoming list operation, distinct from granting access to somebody else.
        action: holtburger_core::client::corpse::CorpseConsentAction,
    },
    /// Grant or revoke permission for a captured player name.
    SetClientCorpsePermission {
        /// Name captured when the frontend command or selected-player action runs.
        #[serde(rename = "playerName")]
        player_name: String,
        /// True grants access; false revokes it. This is intent, not known server state.
        granted: bool,
    },
    /// Change only whether this character accepts incoming corpse permits.
    SetClientCorpseConsent {
        /// Requested value for AcceptCorpseLootingPermissions only.
        enabled: bool,
    },
    /// Frontend has already confirmed the user's intent.
    KillClientCharacter,
    SendClientChat {
        request: ClientChatRequest,
    },
    /// Canonical horizontal map point; the server owns destination height.
    TeleportClientToMapPosition {
        position: ClientMapPosition,
    },
    StartClientCamera {
        request: holtburger_core::ClientCameraStartRequest,
    },
    /// Local-player entity obstruction override.
    SetClientEntityCollisionDisabled {
        disabled: bool,
    },
    SetClientCameraIntent {
        request: holtburger_core::ClientCameraIntentRequest,
    },
    SetClientCameraClearance {
        request: holtburger_core::ClientCameraClearanceRequest,
    },
    SetClientPreciseJumpAim {
        request: ClientPreciseJumpAimRequest,
    },
    QueryClientEntitySelectionCandidates {
        request: ClientEntitySelectionQueryRequest,
    },
    CommitClientPreciseJump {
        request: ClientPreciseJumpCommitRequest,
    },
    CancelClientPreciseJump {
        request: holtburger_core::PreciseJumpCancelRequest,
    },
    /// Renderer acknowledgement after the matching destination has been installed and revealed.
    AcknowledgeClientWorldReveal {
        /// Renderer wire contracts use camelCase; keep the inline enum field explicit.
        #[serde(rename = "worldGeneration")]
        world_generation: u64,
    },
    StopClientCamera {
        request: holtburger_core::ClientCameraIdentity,
    },
    /// Mirrors frontend target selection into the Live API `ui.selection` hook.
    ReportClientSelectedEntity {
        #[serde(default)]
        guid: Option<holtburger_common::Guid>,
    },
    /// Mirrors frontend outdoor navigation waypoint into the Live API `h3d.hud` hook.
    ReportClientNavigationWaypoint {
        #[serde(default)]
        waypoint: Option<ClientNavigationWaypointReport>,
    },
    /// Pauses or resumes Live API automation from the h3d HUD safety pill.
    SetClientAutomationPaused {
        paused: bool,
    },
    /// Emits a local user message into the Live API `automation` event stream.
    SendClientApiMessage {
        text: String,
    },
    /// Delivers a HUD-free WebGL2 viewport screenshot back to a pending Live API request.
    SubmitClientApiScreenshot {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(default, rename = "contentType")]
        content_type: Option<String>,
        #[serde(default, rename = "base64Data")]
        base64_data: Option<String>,
        #[serde(default)]
        error: Option<String>,
    },
    /// Graceful character logout, preserving the login session.
    LogoutClient,
    DisconnectClient,
}

/// Exact wire names owned by the client dispatcher.
pub const CLIENT_COMMAND_NAMES: &[&str] = &[
    "client_performance",
    "examine_client_entity",
    "request_client_facts_appraisal",
    "cancel_client_appraisal",
    "read_client_book_page",
    "close_client_container",
    "preview_client_inventory",
    "preview_client_vendor",
    "submit_client_vendor",
    "submit_client_trade",
    "request_client_barber",
    "submit_client_inventory",
    "auto_merge_client_container",
    "apply_client_equipment_set",
    "preview_client_salvage",
    "submit_client_salvage",
    "submit_client_item_use",
    "query_client_item_use_target",
    "query_client_spell_inspection",
    "evaluate_client_progression",
    "submit_client_progression",
    "set_client_character_title",
    "start_client",
    "request_client_current_state",
    "refresh_client_housing",
    "query_client_housing_access",
    "search_client_housing",
    "preview_client_housing_payment",
    "submit_client_housing_payment",
    "submit_client_housing_management",
    "select_client_character",
    "create_client_character",
    "delete_client_character",
    "restore_client_character",
    "replace_client_drive",
    "queue_client_character_motion_event",
    "submit_client_party",
    "submit_client_friends",
    "abandon_client_contract",
    "submit_client_squelch",
    "submit_client_allegiance",
    "set_client_party_updates",
    "query_client_death_locations",
    "manage_client_corpse_consent",
    "set_client_corpse_permission",
    "set_client_corpse_consent",
    "kill_client_character",
    "send_client_chat",
    "recall_client",
    "teleport_client_to_map_position",
    "toggle_client_combat_mode",
    "set_client_combat_mode",
    "set_client_rest_posture",
    "cancel_client_rest_posture",
    "set_client_appearance_option",
    "set_client_gameplay_option",
    "cast_client_spell",
    "begin_client_combat_engagement",
    "update_client_combat_profile",
    "stop_client_combat_engagement",
    "query_client_entity_health",
    "respond_to_client_confirmation",
    "start_client_camera",
    "set_client_camera_intent",
    "set_client_camera_clearance",
    "set_client_entity_collision_disabled",
    "set_client_precise_jump_aim",
    "query_client_entity_selection_candidates",
    "commit_client_precise_jump",
    "cancel_client_precise_jump",
    "acknowledge_client_world_reveal",
    "stop_client_camera",
    "report_client_selected_entity",
    "report_client_navigation_waypoint",
    "set_client_automation_paused",
    "send_client_api_message",
    "submit_client_api_screenshot",
    "logout_client",
    "disconnect_client",
];

/// Renderer-reported outdoor navigation waypoint synced into `H3dFrontendMirror`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientNavigationWaypointReport {
    pub scene_x: f32,
    pub scene_z: f32,
    pub label: String,
}

/// Appearance options intentionally exposed by the 3D client host boundary.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientAppearanceOption {
    Helmet,
    Cloak,
}

impl From<ClientAppearanceOption> for CharacterOption {
    fn from(option: ClientAppearanceOption) -> Self {
        match option {
            ClientAppearanceOption::Helmet => CharacterOption::ShowYourHelmOrHeadGear,
            ClientAppearanceOption::Cloak => CharacterOption::ShowYourCloak,
        }
    }
}
