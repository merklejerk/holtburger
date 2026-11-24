use crate::DynamicEntitySnapshot;
use holtburger_common::Guid;
use holtburger_common::properties::{
    PropertyInt, PropertyInt64, PropertyString, PropertyUpdate, WorldObjectExt as _,
};
use holtburger_protocol::errors::WeenieError;
use holtburger_session::Session;
use holtburger_world::player::PlayerCharacterOptions;
use holtburger_world::{SpatialBodyId, WorldEvent, WorldState};
use std::collections::{BTreeSet, HashMap};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

mod camera;
pub mod character;
pub mod combat;
pub mod entities;
pub mod inventory;
pub mod motion;
pub mod session;
pub mod social;
pub mod world_nav;

use camera::camera_service;
pub use character::barber;
use character::character_selection;
use character::character_sheet;
pub use character::object_preview;
pub use character::player_visual;
pub use character::progression;
pub use character::runtime_body_view_cache;
pub use character::spell_inspection;
use combat::combat_attribution;
use combat::combat_engagement;
pub use combat::combat_feedback;
pub use combat::combat_tuning;
use combat::server_combat_text;
pub use connection_failure::{
    CharacterErrorCode, ClientExitOutcome, ConnectionFailure, ConnectionFailureCause,
    ConnectionOperation,
};
#[cfg(test)]
use entities::dynamic_entity_view;
pub use entities::dynamic_script;
use entities::entity_cues;
pub use entities::entity_facts;
use entities::entity_visual_facts;
pub use entities::selection_envelope;
pub use entities::selection_query;
pub use inventory::appraisal;
pub use inventory::container_auto_merge;
pub use inventory::corpse;
pub use inventory::equipment_plan;
use inventory::equipment_runtime;
pub use inventory::equipment_set;
pub use inventory::inventory_merge;
pub use inventory::inventory_plan;
use inventory::inventory_runtime;
pub use inventory::inventory_storage;
pub use inventory::item_use;
pub use inventory::lock_feedback;
pub use inventory::salvage;
pub use inventory::trade;
pub use inventory::vendor_transaction;
use inventory::world_container;
pub use motion::character_axes;
pub use motion::character_jump;
pub use motion::character_kinematics;
pub use motion::character_motion;
pub use motion::collision;
use motion::movement;
pub use motion::movement_types;
use motion::navigation_body;
pub use motion::precise_jump;
pub use motion::precise_jump_prediction;
use motion::precise_jump_runtime;
use motion::rest_posture;
pub use motion::steering;
use session::builder;
use session::commands;
pub use session::connection;
pub use session::connection_failure;
pub use session::control;
use session::event_ordering;
#[cfg(feature = "runtime-fixture")]
pub use session::runtime_fixture;
pub use session::runtime_profile;
use session::simulation;
#[cfg(test)]
use session::test_support;
pub use session::types;
pub use social::allegiance;
pub use world_nav::housing;
pub use world_nav::housing_execution;
pub use world_nav::housing_management;
pub use world_nav::housing_payment;
pub use world_nav::housing_queries;
pub use world_nav::recall;

pub use builder::ClientRuntimeBuilder;
use camera::ClientCameraSettlement;
pub use camera::{
    ClientCameraClearance, ClientCameraClearanceRequest, ClientCameraCollisionProof,
    ClientCameraDiagnostics, ClientCameraFailureReason, ClientCameraIdentity,
    ClientCameraIntentRequest, ClientCameraReseedReason, ClientCameraStartReceipt,
    ClientCameraStartRequest, ClientCameraTargetSphereRole, ClientCameraTick,
    ClientCameraUpdateReceipt,
};
pub use camera_service::ClientCameraInputHandle;
use camera_service::ClientCameraService;
use character_selection::CharacterSelectionState;
pub use character_sheet::{
    ClientCharacterSheet, ClientCharacterSkill, ClientCharacterTitle, ClientCharacterTitleSelection,
};
use movement::MovementSystem;
pub use precise_jump_prediction::PreciseJumpTargetView;
pub use precise_jump_runtime::{
    PreciseJumpActionSequence, PreciseJumpAimRequest, PreciseJumpAimSequence,
    PreciseJumpCancelRequest, PreciseJumpCommitRequest, PreciseJumpEvaluation,
    PreciseJumpEvaluationStatus, PreciseJumpLaunchView, PreciseJumpPreviewCurve,
    PreciseJumpProgress, PreciseJumpResolvedLaunch, PreciseJumpTransactionFeedback,
    PreciseJumpTransactionOutcome, PreciseJumpTransactionRejection,
};
pub use progression::{
    ClientProgressionEvaluation, ClientProgressionFeedback, ClientProgressionQuote,
    ClientProgressionRejection, ClientProgressionUnavailable,
};
pub use selection_query::{
    EntitySelectionQueryOutcome, EntitySelectionQueryRequest, EntitySelectionQueryResult,
    EntitySelectionQuerySequence, EntitySelectionQueryUnavailable,
};
use types::*;

/// Physics tick interval in milliseconds.
const PHYSICS_TICK_MS: u64 = 30;
const BUSY_OPERATION_TIMEOUT: Duration = Duration::from_secs(10);

/// Operation context retained until completion, failure, timeout, or world reset.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum PendingOperation {
    /// Direct-use source retained until the server completes the operation.
    Use {
        source: Guid,
    },
    UseWithTarget {
        /// Resolved spell recipient, absent for ordinary targeted items.
        spell_target: Option<Guid>,
    },
    /// Guarded individual use retains frontend correlation, never a batch workflow.
    GuardedUse {
        /// Originating frontend identity, attached to terminal receipts.
        sequence: u32,
        /// Captured source/target used for kind and direct-use admission.
        intent: holtburger_world::item_use::ItemUseIntent,
        /// Resolved spell-bearing item recipient captured at dispatch.
        spell_target: Option<Guid>,
    },
    /// Resolved wire target; untargeted casts cannot correlate automatic turns.
    SpellCast {
        target: Option<Guid>,
    },
    Vendor(Box<vendor_transaction::VendorExecution>),
    /// Housing completion requires inventory plus profile authority, never UseDone.
    Housing(Box<housing_execution::HousingExecution>),
    /// Administrative completion uses HAR/home facts rather than UseDone.
    HousingManagement(Box<housing_management::HousingManagementExecution>),
}

impl PendingOperation {
    /// Direct-use target shared by lock feedback and server container-roster admission.
    fn direct_use_source(&self) -> Option<Guid> {
        match self {
            Self::Use { source }
            | Self::GuardedUse {
                intent: holtburger_world::item_use::ItemUseIntent::Direct { source, .. },
                ..
            } => Some(*source),
            _ => None,
        }
    }

    pub(in crate::client) fn kind(&self) -> BusyOperationKind {
        match self {
            Self::Use { .. } => BusyOperationKind::Use,
            Self::UseWithTarget { .. } => BusyOperationKind::UseWithTarget,
            Self::GuardedUse { intent, .. } => match intent {
                holtburger_world::item_use::ItemUseIntent::Direct { .. } => BusyOperationKind::Use,
                holtburger_world::item_use::ItemUseIntent::Targeted { .. } => {
                    BusyOperationKind::UseWithTarget
                }
            },
            Self::SpellCast { .. } => BusyOperationKind::SpellCast,
            Self::Vendor(execution) => execution.kind(),
            Self::Housing(execution) => execution.kind(),
            Self::HousingManagement(_) => BusyOperationKind::HousingManagement,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(in crate::client) struct PendingBusyOperation {
    operation: PendingOperation,
    deadline: Instant,
    pending_error: Option<(WeenieError, Option<String>)>,
}

/// Publication state distinguishes an unpublished baseline from a published unavailable value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::client) enum PublishedCharacterMotionCapabilities {
    Unpublished,
    Published(Option<ClientCharacterMotionCapabilities>),
}

/// Connection-lifetime session state retained across character logins and portal transitions.
pub(in crate::client) struct ConnectionSessionState {
    pub(in crate::client) state: ClientState,
    /// Distinguishes the initial connected socket from a login request in flight.
    pub(in crate::client) authenticating: bool,
    /// Monotonic world-generation edge used to invalidate presentation interpolation.
    pub(in crate::client) world_generation: u64,
    /// Latest server-provided world name retained for replacement application snapshots.
    pub(in crate::client) world_name: Option<String>,
    /// Terminal cause selected by the authority before it publishes `Exiting`.
    pub(in crate::client) exit_outcome: Option<ClientExitOutcome>,
    pub(in crate::client) message_counter: usize,
    /// Entity GUIDs queued for a single coalesced upsert while an active batch runs.
    pub(in crate::client) coalesced_dynamic_entity_upserts: Option<BTreeSet<Guid>>,
    /// Last published cold map-teleport admission, for edge-only notification.
    pub(in crate::client) published_map_teleport_capability: bool,
    /// Last published recall choices, used to suppress identical cold events.
    pub(in crate::client) published_recall_destinations: Vec<recall::RecallDestination>,
    /// Last published social admission level; snapshots read the world directly.
    pub(in crate::client) published_social_motion_ready: bool,
    /// Last character-motion capability level projected on the current event baseline.
    pub(in crate::client) published_character_motion_capabilities:
        PublishedCharacterMotionCapabilities,
}

impl ConnectionSessionState {
    pub(in crate::client) fn with_state(state: ClientState) -> Self {
        Self {
            state,
            authenticating: false,
            world_generation: 0,
            world_name: None,
            exit_outcome: None,
            message_counter: 0,
            coalesced_dynamic_entity_upserts: None,
            published_map_teleport_capability: false,
            published_recall_destinations: Vec::new(),
            published_social_motion_ready: false,
            published_character_motion_capabilities:
                PublishedCharacterMotionCapabilities::Unpublished,
        }
    }
}

/// Character-session state cleared atomically when a character retires or disconnects.
#[derive(Default)]
pub(in crate::client) struct CharacterSessionState {
    /// Character whose PlayerDescription established complete spell knowledge and options.
    pub(in crate::client) described_character: Option<Guid>,
    /// Character-scoped game-event delivery, before decoding and world mutation.
    pub(in crate::client) event_ordering: Option<event_ordering::GameEventOrdering>,
    /// Character advancement admission and duplicate suppression for this runtime.
    pub(in crate::client) progression: progression::ProgressionState,
    pub(in crate::client) active_confirmation: Option<ActiveCharacterConfirmation>,
    /// Pending complete home query, independent of inventory busy operations.
    pub(in crate::client) housing_query_deadline: Option<Instant>,
    /// Outstanding allegiance profile read; domain logic lives in allegiance.
    pub(in crate::client) allegiance_query_deadline: Option<Instant>,
    /// Serialized read-only access/search admission, independent of inventory mutation.
    pub(in crate::client) housing_queries: housing_queries::HousingQueries,
    /// Cached narrow entity records and pending semantic invalidation.
    pub(in crate::client) entity_facts: entity_facts::EntityFactsPublication,
    /// Retained complete player visual, invalidated only by cold accepted changes.
    pub(in crate::client) player_visual: player_visual::PlayerVisualPublication,
    /// Authority-retained salvage review bound to a monotonic preview revision.
    pub(in crate::client) salvage_approval: salvage::SalvageApproval,
    pub(in crate::client) active_busy_operation: Option<PendingBusyOperation>,
    /// Direct-use evidence outlives admission because sound and UseDone arrive independently.
    pub(in crate::client) lock_use: Option<lock_feedback::LockUse>,
    /// Close acknowledgements outstanding after local access has been revoked.
    pub(in crate::client) closing_containers: std::collections::BTreeMap<Guid, Instant>,
    /// Bounded successful-open history used only by corpse-selection conveniences.
    pub(in crate::client) opened_corpses: world_container::OpenedCorpseHistory,
    /// Bounded approximate death locations for this character session.
    pub(in crate::client) recent_deaths: corpse::RecentDeaths,
    /// Outstanding P2P item acknowledgments shared by all frontends.
    pub(in crate::client) trade_additions: HashMap<Guid, Instant>,
    /// Character-bound inspection inputs and their publication revision.
    pub(in crate::client) spell_inspection: spell_inspection::SpellInspectionState,
    /// Retains ordered script and sound cues that precede entity creation.
    pub(in crate::client) entity_cue_inbox: entity_cues::ClientEntityCueInbox,
}

/// Portal-epoch transient state cleared whenever a world activation or portal transition begins.
#[derive(Default)]
pub(in crate::client) struct PortalResyncState {
    /// One generation-scoped replacement transition. `None` means the active scene is continuous
    /// (or the client has not selected a character yet).
    pub(in crate::client) activation: Option<ClientWorldActivationRuntime>,
    /// Ordinary-use intent authorizing one crystal-opening receipt, never a snapshot replay.
    pub(in crate::client) housing_opening: Option<housing::HousingOpening>,
    /// Single-item replacement owner, retaining its existing receipt-dependent progression.
    pub(in crate::client) equipment_operation: Option<equipment_runtime::EquipmentOperation>,
    /// One peace prerequisite plus bounded recent equipment-set error attribution.
    pub(in crate::client) equipment_set: equipment_set::EquipmentSetState,
    /// Latest silent posture request waiting for a confirmed peace stance.
    pub(in crate::client) pending_rest_posture: Option<rest_posture::PendingRestPosture>,
    /// One successfully sent stance request; mode updates retire it, never equipment receipts.
    pub(in crate::client) pending_combat_mode:
        Option<holtburger_protocol::messages::combat::CombatMode>,
    /// Single-slot queued spell cast waiting for the active busy operation to finish.
    pub(in crate::client) queued_spell_cast: Option<combat::combat_runtime::QueuedSpellCast>,
    /// Single owner of dependent inventory requests and their local admission.
    pub(in crate::client) inventory_operation: Option<inventory_runtime::InventoryOperation>,
}

pub struct ClientRuntime {
    /// Optional authority profiling injected by a diagnostic consumer.
    runtime_profile: Option<runtime_profile::RuntimeProfileHandle>,
    /// Character-bound appearance editing and persistent local racial particle selection.
    barber: barber::BarberRuntime,
    /// Frontend-owned preference consumed by inventory and equipment planning.
    inventory_placement: inventory_storage::InventoryPlacementPolicy,
    /// Ordered diagnostic inputs; credentials and outgoing transport packets are excluded.
    #[cfg(feature = "runtime-fixture")]
    runtime_fixture: Option<runtime_fixture::RuntimeFixtureCapture>,
    pub session: Session,
    /// Shared traffic baseline and rates, independent of world replacement.
    connection: connection::ConnectionSampler,
    pub world: WorldState,
    /// Single owner of IdentifyObject queueing, cooldown pacing, and delivery filtering.
    appraisal: appraisal::AppraisalSystem,
    client_view_event_tx: broadcast::Sender<ClientViewEvent>,
    /// Monotonic origin shared by focused dynamic-entity snapshots and deltas.
    dynamic_entity_time_origin: Instant,
    command_rx: Option<mpsc::UnboundedReceiver<control::ClientCommandEnvelope>>,
    read_rx: Option<mpsc::UnboundedReceiver<control::ClientReadTask>>,
    automation_paused: std::sync::Arc<std::sync::atomic::AtomicBool>,
    next_correlation_id: u64,
    message_dump_dir: Option<std::path::PathBuf>,
    movement: MovementSystem,
    /// Single owner of desired targeted combat and ACE repeat-sequence requests.
    combat_engagement: combat_engagement::CombatEngagementRuntime,
    /// Correlates name-only outcomes with successfully sent attacks and casts.
    combat_attribution: combat_attribution::CombatOutcomeAttributor,
    /// Validated shared combat policy selected by the runtime composition.
    combat_tuning: combat_tuning::ClientCombatTuning,
    /// Stages static collision and local-player body products outside the simulation turn.
    collision_coordinator: Option<collision::ClientCollisionCoordinator>,
    /// Prepares object-state script timelines off-turn and joins them to exact entity instances.
    dynamic_script_coordinator: Option<dynamic_script::ClientDynamicScriptCoordinator>,
    /// Resolves immutable visual profiles off-turn and publishes exact-generation envelopes.
    selection_envelope_coordinator: Option<selection_envelope::ClientSelectionEnvelopeCoordinator>,
    /// Whether the selected composition owns an asynchronous destination reveal product.
    requires_external_world_reveal: bool,
    /// Independently serviced camera consuming immutable authority publications.
    camera: ClientCameraService,
    /// Replaceable speculative aim work and ordered precise-jump commit state.
    precise_jump: precise_jump_runtime::PreciseJumpRuntime,
    character_selection: CharacterSelectionState,
    turbine_chat: TurbineChatState,
    pub(in crate::client) conn: ConnectionSessionState,
    pub(in crate::client) character: CharacterSessionState,
    pub(in crate::client) portal: PortalResyncState,
}

/// Internal activation bookkeeping. Destination and prerequisite products stay private so a
/// frontend cannot manufacture authority facts or observe an intermediate collision transaction.
pub(in crate::client) struct ClientWorldActivationRuntime {
    generation: u64,
    phase: ClientWorldActivationPhase,
    player_guid: Guid,
    destination: Option<ClientActivationDestination>,
    /// World-owned physical placement has resolved before camera settlement and reveal.
    placement_resolved: bool,
    camera_settlement: ClientActivationCameraSettlement,
    external_reveal_generation: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClientActivationCameraSettlement {
    Pending,
    Settled,
}

/// Protocol progress needed to distinguish the pre-destination teleport gap from a destination
/// that is ready for activation convergence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClientWorldActivationPhase {
    InitialEntry,
    TeleportAwaitingDestination,
    TeleportDestinationInstalled,
}

/// Core-private authority guard pairing stable player identity with the exact server destination pose.
#[derive(Debug, Clone, Copy, PartialEq)]
struct ClientActivationDestination {
    player: collision::ClientPlayerIdentity,
    /// Full authority pose invalidates placement even for a second arrival in the same cell.
    position: holtburger_common::position::WorldPosition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ClientWorldActivationState {
    InitialEntry,
    Teleport,
}

impl ClientRuntime {
    /// Evaluate a semantic advancement against current world facts.
    pub fn quote_progression(
        &mut self,
        intent: holtburger_world::progression::ProgressionIntent,
    ) -> Result<ClientProgressionQuote, ClientProgressionUnavailable> {
        if !matches!(self.conn.state, ClientState::InWorld)
            || self.portal.activation.is_some()
            || self.character.described_character != Some(self.world.player.guid)
        {
            return Err(ClientProgressionUnavailable::CharacterNotReady);
        }
        if self.character.progression.reconcile(&self.world) {
            self.emit_character_sheet();
        }
        self.character.progression.quote(&self.world, intent)
    }

    /// Targets whose unchanged authoritative state already had one send attempt.
    pub fn guarded_progression_targets(&self) -> Vec<holtburger_world::progression::StatTarget> {
        self.character.progression.guarded_targets(&self.world)
    }

    /// Returns the complete lifecycle projection without exposing the internal world state.
    pub fn lifecycle(&self) -> ClientLifecycleState {
        match &self.conn.state {
            ClientState::Connected if self.conn.authenticating => {
                ClientLifecycleState::Authenticating
            }
            ClientState::Connected => ClientLifecycleState::Connecting,
            ClientState::CharacterSelection => ClientLifecycleState::CharacterSelection {
                rejection: self.character_selection.entry_rejection.clone(),
                max_slots: self.character_selection.max_slots,
                characters: self
                    .character_selection
                    .characters
                    .iter()
                    .enumerate()
                    .map(|(slot, character)| ClientCharacterSummary {
                        guid: character.guid,
                        name: character.name.clone(),
                        slot: slot as u32,
                        delete_time: character.delete_time,
                    })
                    .collect(),
            },
            ClientState::EnteringWorld => self
                .portal
                .activation
                .as_ref()
                .map(|activation| activation.lifecycle())
                .unwrap_or(ClientLifecycleState::EnteringWorld {
                    character_guid: self.character_selection.character_id.unwrap_or(Guid::NULL),
                }),
            ClientState::InWorld if self.world.player.guid != Guid::NULL => {
                ClientLifecycleState::InWorld
            }
            ClientState::InWorld => self
                .portal
                .activation
                .as_ref()
                .map(|activation| activation.lifecycle())
                .unwrap_or(ClientLifecycleState::EnteringWorld {
                    character_guid: self.character_selection.character_id.unwrap_or(Guid::NULL),
                }),
            ClientState::LoggingOut => ClientLifecycleState::LoggingOut,
            ClientState::Disconnected => ClientLifecycleState::Exiting {
                outcome: self.conn.exit_outcome.clone().unwrap_or(ClientExitOutcome {
                    cause: ClientExitCause::ServerDisconnect,
                    failure: None,
                }),
            },
        }
    }

    /// Availability is tied to description identity, never scene or lifecycle readiness.
    fn known_spell_ids(&self) -> Option<Vec<u32>> {
        self.character
            .described_character
            .filter(|&guid| guid == self.world.player.guid)
            .map(|_| self.world.player.spells.keys().copied().collect())
    }

    /// One coherent character level, stats, explanations, and guarded targets.
    fn character_sheet(&self) -> Option<Box<ClientCharacterSheet>> {
        self.character
            .described_character
            .filter(|&guid| guid == self.world.player.guid)
            .map(|_| {
                Box::new(ClientCharacterSheet::from_world(
                    &self.world,
                    self.guarded_progression_targets(),
                ))
            })
    }

    fn emit_character_sheet(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::CharacterSheetUpdated(
                self.character_sheet(),
            ));
    }

    /// Builds one atomic replacement level for shells that lost their event baseline.
    pub fn application_snapshot(&self) -> ClientApplicationSnapshot {
        ClientApplicationSnapshot {
            barber: self.barber.snapshot(),
            character_management: self.character_selection.management.clone(),
            player_visual_capture: self.character.player_visual.snapshot(),
            fellowship: self.world.fellowship.clone(),
            friends: self.world.friends.clone(),
            contracts: self.contracts_snapshot(),
            squelch: self.world.squelch.clone(),
            allegiance: self.allegiance_snapshot(),
            can_teleport_from_map: self.can_teleport_from_map(),
            recall_destinations: self.recall_destinations(),
            lifecycle: self.lifecycle(),
            connection: self.connection.snapshot(
                Instant::now(),
                self.session.last_recv_time,
                matches!(self.conn.state, ClientState::Disconnected),
                self.session.reliability().receive_gap,
            ),
            entity_collision_disabled: self
                .collision_coordinator
                .as_ref()
                .is_some_and(|owner| owner.entity_collision_disabled()),
            local_player_guid: (self.world.player.guid != Guid::NULL)
                .then_some(self.world.player.guid),
            server_time: self
                .world
                .server_time
                .as_ref()
                .map(|_| self.world.current_server_time()),
            world_generation: self.conn.world_generation,
            world_name: self.conn.world_name.clone(),
            account_name: self.character_selection.account_name.clone(),
            player_name: self
                .world
                .player_entity()
                .map(|entity| entity.name().to_string()),
            known_spells: self.known_spell_ids(),
            enchantments: self
                .character
                .described_character
                .filter(|&guid| guid == self.world.player.guid)
                .map(|_| {
                    self.world
                        .player
                        .enchantments
                        .resolved(std::time::Instant::now())
                }),
            character_options: self
                .character
                .described_character
                .filter(|&guid| guid == self.world.player.guid)
                .map(|_| self.player_character_options()),
            combat_mode: if self.world.player.guid == Guid::NULL {
                holtburger_protocol::messages::combat::CombatMode::Undef
            } else {
                self.world.player_combat_mode()
            },
            social_motion_ready: self.world.player_social_motion_ready(),
            combat: self.combat_engagement.status(),
            spell_cast_target: self.active_spell_cast_target(),
            vitals: self.world.player.vitals.clone(),
            character_sheet: self.character_sheet(),
            trade: self.trade_snapshot(),
            vendor: self.world.vendor.clone(),
            character_motion: self.character_motion_capabilities(),
            active_confirmation: self.character.active_confirmation.clone(),
            housing: self.housing_snapshot(),
            dynamic: DynamicEntitySnapshot::new(
                self.dynamic_entity_host_time(),
                self.current_dynamic_entity_views(),
            ),
            entities: entity_facts::ClientEntitySnapshot::from_world_with_opened_at_origin(
                &self.world,
                self.character.opened_corpses.ids(),
                self.dynamic_entity_time_origin,
            )
            .expect("accepted world relationships must produce an entity baseline"),
            runtime_bodies: self.world.runtime_body_views().into(),
        }
    }

    /// Publish the same management level recovered by the atomic application snapshot.
    fn emit_character_management(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::CharacterManagementChanged(
                self.character_selection.management.clone(),
            ));
    }

    fn character_motion_capabilities(&self) -> Option<ClientCharacterMotionCapabilities> {
        if self.movement.movement_policy() == movement_types::ClientMovementPolicy::Navigation {
            return None;
        }
        self.world.resolve_self_jump_capabilities().ok()?;
        let stance = self.world.resolve_player_motion_style().ok()?;
        Some(ClientCharacterMotionCapabilities {
            full_charge_duration: character_jump::retail_jump_charge_profile(stance)
                .full_charge_duration(),
        })
    }

    fn publish_character_motion_capabilities_if_changed(&mut self) {
        let capabilities = self.character_motion_capabilities();
        let publication = PublishedCharacterMotionCapabilities::Published(capabilities);
        if self.conn.published_character_motion_capabilities == publication {
            return;
        }
        self.conn.published_character_motion_capabilities = publication;
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::CharacterMotionCapabilitiesUpdated { capabilities });
    }

    /// Returns the staged spatial-product state, when this composition supplied a collision source.
    ///
    /// The value is intentionally core-facing. A frontend may show a loading/unavailable hint
    /// only after a named wire consumer exists; it must not infer readiness from entity poses.
    pub fn body_readiness(&self) -> Option<collision::ClientBodyReadiness> {
        self.collision_coordinator
            .as_ref()
            .filter(|_| {
                self.movement.movement_policy() == movement_types::ClientMovementPolicy::Physical
            })
            .map(collision::ClientCollisionCoordinator::body_readiness)
    }

    pub(crate) fn set_exit_cause(&mut self, cause: ClientExitCause) {
        if self
            .character_selection
            .management
            .pending_operation()
            .is_some()
        {
            self.character_selection.management = CharacterManagementState::Uncertain {
                message: "The session ended before the character operation was confirmed. Reconnect to refresh the roster.".into(),
            };
            self.emit_character_management();
        }
        self.stop_character_actions();
        if self
            .conn
            .exit_outcome
            .as_ref()
            .is_none_or(|outcome| outcome.failure.is_none())
        {
            self.conn.exit_outcome = Some(ClientExitOutcome {
                cause,
                failure: None,
            });
        }
    }

    pub(crate) fn bump_world_generation(&mut self) -> u64 {
        self.cancel_rest_posture();
        self.combat_attribution.clear();
        self.world
            .motion_runtimes
            .retire_local_requests(self.world.player.guid);
        self.conn.world_generation = self.conn.world_generation.saturating_add(1);
        self.precise_jump.invalidate();
        self.conn.world_generation
    }

    /// Starts one generation-scoped replacement activation. The network/world authority keeps
    /// ingesting destination state while movement, local solving, and camera advancement remain
    /// withdrawn until the activation conjunction completes.
    pub(super) fn start_world_activation(
        &mut self,
        cause: ClientWorldActivationState,
        player_guid: Guid,
    ) {
        self.retire_portal_epoch("World lifecycle changed; the last request may still complete");
        let generation = self.bump_world_generation();
        let phase = match cause {
            ClientWorldActivationState::InitialEntry => ClientWorldActivationPhase::InitialEntry,
            ClientWorldActivationState::Teleport => {
                ClientWorldActivationPhase::TeleportAwaitingDestination
            }
        };
        self.portal.activation = Some(ClientWorldActivationRuntime {
            generation,
            phase,
            player_guid,
            destination: None,
            placement_resolved: false,
            camera_settlement: if self.requires_external_world_reveal {
                ClientActivationCameraSettlement::Pending
            } else {
                ClientActivationCameraSettlement::Settled
            },
            external_reveal_generation: (!self.requires_external_world_reveal)
                .then_some(generation),
        });
        self.set_state(ClientState::EnteringWorld);
    }

    /// Starts an initial-entry activation after retiring the previous runtime scene. The reset is
    /// projected under the new generation so reset and the later destination edge cannot create
    /// two replacement generations.
    pub(super) fn start_world_activation_with_reset(
        &mut self,
        cause: ClientWorldActivationState,
        player_guid: Guid,
    ) {
        self.start_world_activation(cause, player_guid);
        let reset_events = self
            .world
            .suspend_runtime_bodies(holtburger_world::RuntimeBodyResetCause::TeleportOrWorldReset);
        for event in &reset_events {
            self.handle_runtime_world_event_with_context(event, true);
        }
    }

    /// Records the presentation-owned first-pure-destination acknowledgement for the current
    /// generation. Stale or duplicate acknowledgements are harmless and never activate a newer
    /// destination.
    pub(super) async fn acknowledge_world_reveal(&mut self, generation: u64) -> anyhow::Result<()> {
        let Some(activation) = self.portal.activation.as_mut() else {
            return Ok(());
        };
        if activation.generation != generation {
            return Ok(());
        }
        activation.external_reveal_generation = Some(generation);
        self.try_complete_world_activation().await
    }

    /// Re-evaluates the activation conjunction after a world/collision/content fact changes.
    /// This is deliberately the only path that can send ACE's `LoginComplete` action.
    pub(super) async fn try_complete_world_activation(&mut self) -> anyhow::Result<()> {
        let Some(mut activation) = self.portal.activation.take() else {
            return Ok(());
        };
        if matches!(
            activation.phase,
            ClientWorldActivationPhase::TeleportAwaitingDestination
        ) {
            self.portal.activation = Some(activation);
            return Ok(());
        }

        let Some(player) = self.world.player_entity() else {
            self.portal.activation = Some(activation);
            return Ok(());
        };
        if player.guid != activation.player_guid || player.position.landblock_id == Guid::NULL {
            self.portal.activation = Some(activation);
            return Ok(());
        }

        let destination = ClientActivationDestination {
            player: collision::ClientPlayerIdentity {
                guid: player.guid,
                instance_sequence: player.instance_sequence(),
            },
            position: player.position,
        };
        if activation.destination != Some(destination) {
            activation.destination = Some(destination);
            activation.placement_resolved = false;
            activation.camera_settlement = if self.requires_external_world_reveal {
                ClientActivationCameraSettlement::Pending
            } else {
                ClientActivationCameraSettlement::Settled
            };
        }

        let Some(coordinator) = self.collision_coordinator.as_ref() else {
            self.portal.activation = Some(activation);
            return Ok(());
        };
        let destination_scene_ready =
            coordinator.destination_scene_ready(destination.position.landblock_id)?;
        let collision_snapshot = coordinator.snapshot();
        let player_ready = match self.movement.movement_policy() {
            movement_types::ClientMovementPolicy::Physical => {
                coordinator.activation_body_ready(destination.player)?
                    && self
                        .world
                        .scene
                        .body(SpatialBodyId::LocalPlayer(destination.player.guid))
                        .is_some_and(|body| body.physical.is_some())
            }
            movement_types::ClientMovementPolicy::Navigation => {
                destination_scene_ready
                    && coordinator.activation_point_ready(destination.position)?
            }
        };
        let containment_ready = self.world.all_player_contained_objects_exist();
        let reveal_ready = activation.external_reveal_generation == Some(activation.generation);

        if !player_ready && activation.placement_resolved {
            activation.placement_resolved = false;
            if self.requires_external_world_reveal {
                activation.camera_settlement = ClientActivationCameraSettlement::Pending;
            }
        }
        if player_ready && destination_scene_ready && !activation.placement_resolved {
            if self.movement.movement_policy() == movement_types::ClientMovementPolicy::Physical {
                let body_id = SpatialBodyId::LocalPlayer(destination.player.guid);
                if !coordinator
                    .activation_placement_ready(&mut self.world, body_id)
                    .map_err(|error| {
                        error.context(format!(
                            "Could not place player at destination {:#010X}",
                            destination.position.landblock_id.0
                        ))
                    })?
                {
                    self.portal.activation = Some(activation);
                    return Ok(());
                }
                self.handle_runtime_world_event(&WorldEvent::RuntimeBodyChanged { body_id });
            }
            activation.placement_resolved = true;
        }

        // Player policy readiness and static residency complete independently. A registered camera may
        // arrive before either worker; seeding it against the retained prior/empty scene would
        // turn ordinary asynchronous loading into a terminal missing-cell failure.
        if player_ready
            && destination_scene_ready
            && activation.placement_resolved
            && activation.camera_settlement == ClientActivationCameraSettlement::Pending
        {
            let camera_input = camera::ClientCameraSceneInput::capture(
                &self.world,
                Some(collision_snapshot.as_ref()),
                None,
            );
            match self.camera.settle_for_activation(&camera_input)? {
                ClientCameraSettlement::Pending => {}
                ClientCameraSettlement::Settled(tick) => {
                    self.emit_camera_event(tick);
                    activation.camera_settlement = ClientActivationCameraSettlement::Settled;
                }
                ClientCameraSettlement::Exhausted => {
                    anyhow::bail!(
                        "Camera settlement exhausted its bounded work for world generation {} at destination {:#010X}",
                        activation.generation,
                        destination.position.landblock_id.0
                    );
                }
            }
        }

        let presentation_ready = player_ready
            && destination_scene_ready
            && activation.placement_resolved
            && containment_ready
            && activation.camera_settlement == ClientActivationCameraSettlement::Settled
            && reveal_ready;
        if !presentation_ready {
            self.portal.activation = Some(activation);
            return Ok(());
        }

        let initial_entry = activation.phase == ClientWorldActivationPhase::InitialEntry;
        if !initial_entry {
            // Replace ACE's retained pre-teleport motion before making the player visible.
            self.movement
                .publish_teleport_idle(&self.world, &mut self.session, Instant::now())
                .await?;
        }
        self.send_login_complete().await?;
        self.establish_attack_repeat_policy().await?;
        self.portal.activation = None;
        self.set_state(ClientState::InWorld);
        if initial_entry {
            self.query_home().await?;
            // Character entry retires the frontend's previous semantic baseline. Publish the
            // established player and inventory together before resuming ordinary deltas.
            self.emit_current_application_snapshot();
        }
        Ok(())
    }

    fn player_character_options(&self) -> PlayerCharacterOptions {
        self.world.player.character_options
    }

    fn emit_player_options_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::PlayerOptionsUpdated {
                options: self.player_character_options(),
            });
    }

    fn emit_active_character_confirmation_updated(&self) {
        let _ =
            self.client_view_event_tx
                .send(ClientViewEvent::ActiveCharacterConfirmationUpdated {
                    confirmation: self.character.active_confirmation.clone(),
                });
    }

    fn active_busy_operation(&self) -> Option<BusyOperationKind> {
        self.character
            .active_busy_operation
            .as_ref()
            .map(|pending| pending.operation.kind())
    }

    /// Spell operation owns the resolved recipient; consumers never reconstruct it from selection.
    fn active_spell_cast_target(&self) -> Option<Guid> {
        match self
            .character
            .active_busy_operation
            .as_ref()
            .map(|pending| &pending.operation)
        {
            Some(
                PendingOperation::SpellCast { target }
                | PendingOperation::UseWithTarget {
                    spell_target: target,
                }
                | PendingOperation::GuardedUse {
                    spell_target: target,
                    ..
                },
            ) => target.filter(|target| *target != Guid::NULL && *target != self.world.player.guid),
            _ => None,
        }
    }

    fn emit_busy_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SpellCastTargetUpdated {
                target: self.active_spell_cast_target(),
            });
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::BusyStateUpdated {
                busy: self.active_busy_operation(),
            });
    }

    fn emit_busy_operation_finished(
        &self,
        operation: BusyOperationKind,
        result: BusyOperationResult,
    ) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::BusyOperationFinished { operation, result });
    }

    pub(super) fn emit_action_result(
        &mut self,
        source: ActionResultSource,
        reason: ActionResultReason,
    ) {
        if source == ActionResultSource::Wire {
            if self.vendor_owns_feedback(&reason) {
                return;
            }
            self.observe_combat_action_result(&reason);
        }
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::ActionResult { source, reason });
    }

    pub(super) fn emit_log_message(&self, message: String) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::LogMessage(message));
    }

    fn emit_self_movement_kinematics_updated(&self) {
        let kinematics = match self.world.resolve_self_movement_kinematics() {
            Ok(kinematics) => Some(kinematics),
            Err(error) => {
                log::warn!("self movement kinematics unavailable: {error}");
                None
            }
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SelfMovementKinematicsUpdated { kinematics });
    }

    fn updates_affect_self_movement_kinematics(
        updates: &[holtburger_common::properties::PropertyUpdate],
    ) -> bool {
        updates.iter().any(|update| {
            matches!(
                update,
                holtburger_common::properties::PropertyUpdate::DataId(
                    holtburger_common::properties::PropertyDataId::MotionTable
                        | holtburger_common::properties::PropertyDataId::Setup,
                    _,
                )
            )
        })
    }

    pub(super) fn emit_settled_appraisal_facts(&mut self) {
        for guid in self.appraisal.drain_settled_facts() {
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::AppraisalFactsSettled { guid });
        }
    }

    fn emit_vendor_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::VendorStateUpdated {
                vendor: self.world.vendor.clone(),
            });
    }

    fn emit_trade_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::TradeStateUpdated(self.trade_snapshot()));
    }

    pub(super) fn emit_current_application_snapshot(&mut self) {
        self.refresh_spell_inspection_context();
        self.emit_spell_inspection_context();
        self.publish_entity_facts();
        self.emit_fellowship_state_updated();
        self.emit_friends_state_updated();
        self.emit_contracts_state_updated();
        self.emit_squelch_state_updated();
        self.emit_allegiance_snapshot();
        self.emit_trade_state_updated();
        self.emit_dynamic_entity_snapshot();
        self.emit_runtime_body_snapshot();
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::ApplicationSnapshot(Box::new(
                self.application_snapshot(),
            )));
    }

    pub fn subscribe_client_view_events(&self) -> broadcast::Receiver<ClientViewEvent> {
        self.client_view_event_tx.subscribe()
    }

    /// Direct camera input bypasses the entity simulation command queue.
    pub fn camera_input_handle(&self) -> ClientCameraInputHandle {
        self.camera.input_handle()
    }

    pub fn set_command_rx(&mut self, rx: mpsc::UnboundedReceiver<control::ClientCommandEnvelope>) {
        self.command_rx = Some(rx);
    }

    /// Installs the runtime's command and unicast read channels and returns a cloneable handle.
    pub fn create_handle(&mut self) -> control::ClientRuntimeHandle {
        let (command_tx, command_rx) = mpsc::unbounded_channel();
        let (read_tx, read_rx) = mpsc::unbounded_channel();
        self.command_rx = Some(command_rx);
        self.read_rx = Some(read_rx);
        control::ClientRuntimeHandle::new(
            command_tx,
            read_tx,
            self.client_view_event_tx.clone(),
            std::sync::Arc::clone(&self.automation_paused),
        )
    }

    pub fn is_automation_paused(&self) -> bool {
        self.automation_paused
            .load(std::sync::atomic::Ordering::Acquire)
    }

    pub(in crate::client) fn mint_correlation_id(&mut self) -> u64 {
        self.next_correlation_id = self.next_correlation_id.saturating_add(1);
        self.next_correlation_id
    }

    pub(super) fn publish_status_update(&mut self) {
        self.publish_map_teleport_capability();
        self.publish_recall_destinations();
        self.send_status_event();
    }

    pub(super) fn set_state(&mut self, next: ClientState) {
        self.conn.state = next;
        self.publish_status_update();
    }

    fn send_status_event(&self) {
        if matches!(self.conn.state, ClientState::Disconnected)
            && let Some(sample) = self.connection.snapshot(
                Instant::now(),
                self.session.last_recv_time,
                true,
                self.session.reliability().receive_gap,
            )
        {
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::ConnectionUpdated(sample));
        }
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::StatusUpdate {
                state: self.conn.state.clone(),
            });
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::LifecycleChanged(self.lifecycle()));
        // Swear admission includes lifecycle, so portal return must republish it
        // even when no new profile arrives and initial-entry recovery is skipped.
        self.emit_allegiance_snapshot();
        self.emit_character_sheet();
    }

    pub fn handle_world_event(&mut self, event: &WorldEvent) {
        self.project_world_event(event);
        self.finish_character_world_events(self.world_event_changes_character_sheet(event));
        self.publish_entity_facts();
    }

    /// Publish social admission before consumers observe the mode or motion that changed it.
    fn publish_social_motion_readiness(&mut self) {
        let ready = self.world.player_social_motion_ready();
        if ready != self.conn.published_social_motion_ready {
            self.conn.published_social_motion_ready = ready;
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::SocialMotionReadyUpdated { ready });
        }
    }

    /// Project one event without finalizing a packet's character replacement yet.
    fn project_world_event(&mut self, event: &WorldEvent) {
        let changes_social_admission = match event {
            WorldEvent::CombatModeUpdated(_)
            | WorldEvent::SelfServerControlledMotion(_)
            | WorldEvent::PlayerInfo(_) => true,
            WorldEvent::EntityMotionUpdated { guid, .. }
            | WorldEvent::EntityDespawned { guid, .. } => *guid == self.world.player.guid,
            WorldEvent::EntitySpawned(entity) | WorldEvent::EntityReplaced(entity) => {
                entity.guid == self.world.player.guid
            }
            _ => false,
        };
        if changes_social_admission {
            self.publish_social_motion_readiness();
        }
        self.observe_housing_world_event(event);
        if matches!(
            event,
            WorldEvent::PlayerInfo(_) | WorldEvent::DerivedStatsUpdated
        ) {
            self.refresh_spell_inspection_context();
        }
        self.emit_world_view_projection(event);
    }

    fn world_event_changes_character_sheet(&self, event: &WorldEvent) -> bool {
        match event {
            WorldEvent::PropertiesUpdated { guid, updates } if *guid == self.world.player.guid => {
                return updates.iter().any(|update| {
                    matches!(
                        update,
                        PropertyUpdate::String(PropertyString::Name | PropertyString::Template, _)
                            | PropertyUpdate::Int(
                                PropertyInt::CharacterTitleId
                                    | PropertyInt::AugmentationBonusSalvage
                                    | PropertyInt::Level
                                    | PropertyInt::AvailableSkillCredits,
                                _,
                            )
                            | PropertyUpdate::Int64(
                                PropertyInt64::TotalExperience
                                    | PropertyInt64::AvailableExperience
                                    | PropertyInt64::AvailableLuminance
                                    | PropertyInt64::MaximumLuminance,
                                _,
                            )
                    )
                });
            }
            WorldEvent::EntitySpawned(entity) | WorldEvent::EntityReplaced(entity)
                if entity.guid == self.world.player.guid =>
            {
                return true;
            }
            _ => {}
        }
        matches!(
            event,
            WorldEvent::PlayerTitlesUpdated
                | WorldEvent::PlayerInfo(_)
                | WorldEvent::DerivedStatsUpdated
                | WorldEvent::VitalUpdated(_)
        )
    }

    /// Reconcile once against final world facts after all events from one packet.
    fn finish_character_world_events(&mut self, sheet_changed: bool) {
        self.publish_map_teleport_capability();
        self.publish_recall_destinations();
        if self.character.progression.reconcile(&self.world) || sheet_changed {
            self.emit_character_sheet();
        }
    }

    fn emit_world_view_projection(&mut self, event: &WorldEvent) {
        self.appraisal.observe_world_event(event);
        self.emit_settled_appraisal_facts();
        self.character.entity_facts.observe(event);
        self.character.player_visual.observe(&self.world, event);
        match event {
            WorldEvent::PlayerEnchantmentsUpdated => {
                let _ =
                    self.client_view_event_tx
                        .send(ClientViewEvent::PlayerEnchantmentsUpdated {
                            resolved: self
                                .world
                                .player
                                .enchantments
                                .resolved(std::time::Instant::now()),
                        });
            }
            WorldEvent::DerivedStatsUpdated => {
                let vitals = self.world.player.vitals.clone();

                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });
            }
            WorldEvent::VitalUpdated(vital) => {
                let mut vitals = HashMap::new();
                vitals.insert(vital.vital_type, vital.clone());
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });
            }
            WorldEvent::PlayerSpellsChanged(spell_ids)
                if self.character.described_character == Some(self.world.player.guid) =>
            {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerSpellsUpdated {
                        spell_ids: spell_ids.clone(),
                    });
            }
            WorldEvent::PlayerInfo(entity) => {
                self.emit_player_options_updated();
                let _ =
                    self.client_view_event_tx
                        .send(ClientViewEvent::PlayerEnchantmentsUpdated {
                            resolved: self
                                .world
                                .player
                                .enchantments
                                .resolved(std::time::Instant::now()),
                        });

                if let Some(spell_ids) = self.known_spell_ids() {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::PlayerSpellsUpdated { spell_ids });
                }

                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntitySpawned {
                        entity: entity.clone(),
                    });
                self.emit_dynamic_entity_upsert(entity.guid);
                self.observe_dynamic_script_entity(entity.guid);
                self.observe_selection_envelope_entity(entity.guid);
                self.emit_self_movement_kinematics_updated();
            }
            WorldEvent::TeleportStarted { sequence } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::TeleportStarted {
                        sequence: *sequence,
                    });
            }
            WorldEvent::EntitySpawned(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntitySpawned {
                        entity: entity.clone(),
                    });
                self.emit_dynamic_entity_upsert(entity.guid);
                self.observe_dynamic_script_entity(entity.guid);
                self.observe_selection_envelope_entity(entity.guid);
                if entity.guid == self.world.player.guid {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::EntityReplaced(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityReplaced {
                        entity: entity.clone(),
                    });
                self.emit_dynamic_entity_upsert(entity.guid);
                self.observe_dynamic_script_entity(entity.guid);
                self.observe_selection_envelope_entity(entity.guid);
                if entity.guid == self.world.player.guid {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::SummonEnded {
                guid,
                instance_sequence,
                owner,
                cause,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::SummonEnded {
                        guid: *guid,
                        instance_sequence: *instance_sequence,
                        owner: *owner,
                        cause: *cause,
                    });
            }
            WorldEvent::EntityHealthUpdated {
                guid,
                instance_sequence,
                health_fraction,
                observed_at,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityHealthUpdated {
                        guid: *guid,
                        world_generation: self.conn.world_generation,
                        instance_sequence: *instance_sequence,
                        health_fraction: *health_fraction,
                        observed_at: self.dynamic_entity_host_time_at(*observed_at),
                    });
            }
            WorldEvent::EntityCombatObserved {
                guid,
                instance_sequence,
                observed_at,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityCombatObserved {
                        guid: *guid,
                        world_generation: self.conn.world_generation,
                        instance_sequence: *instance_sequence,
                        observed_at: self.dynamic_entity_host_time_at(*observed_at),
                    });
            }
            WorldEvent::EntityBookOpened { guid, name, book } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityBookOpened {
                        guid: *guid,
                        name: name.clone(),
                        book: book.clone(),
                    });
            }
            WorldEvent::EntityBookUpdated { guid, book } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityBookUpdated {
                        guid: *guid,
                        book: book.clone(),
                    });
            }
            WorldEvent::EntityIdentified(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityIdentified {
                        entity: entity.clone(),
                    });
                self.emit_dynamic_entity_upsert(entity.guid);
                self.observe_dynamic_script_entity(entity.guid);
                self.observe_selection_envelope_entity(entity.guid);
            }
            WorldEvent::ObjectInspectionResult(result) => {
                let policy = self.appraisal.complete_inspection(result.guid);
                self.emit_settled_appraisal_facts();
                if policy.deliver_full {
                    let preview = if matches!(
                        &result.outcome,
                        holtburger_world::inspection::ObjectInspectionOutcome::Ready { inspection }
                            if matches!(
                                inspection.details,
                                holtburger_world::inspection::ObjectInspectionDetails::Creature(_)
                            )
                    ) {
                        let inputs =
                            object_preview::capture_object_preview_inputs(&self.world, result.guid);
                        self.appraisal
                            .should_emit_creature_preview(
                                result.guid,
                                policy.allow_cached_preview,
                                inputs,
                            )
                            .then(|| {
                                object_preview::capture_object_preview(&self.world, result.guid)
                            })
                    } else {
                        None
                    };
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::ObjectInspectionResult(result.clone()));
                    if let Some(preview) = preview {
                        let _ = self
                            .client_view_event_tx
                            .send(ClientViewEvent::ObjectPreviewResult(preview));
                    }
                }
            }
            WorldEvent::EntityAppearanceUpdated { guid } => {
                self.emit_dynamic_entity_upsert(*guid);
                self.observe_selection_envelope_entity(*guid);
            }
            WorldEvent::EntityDespawned { guid, generation } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityDespawned { guid: *guid });
                self.emit_dynamic_entity_removed(*guid, *generation);
                self.remove_dynamic_script_entity(crate::DynamicScriptTarget {
                    guid: *guid,
                    instance_sequence: u16::try_from(*generation)
                        .expect("world entity generation is the protocol instance sequence"),
                });
                if *guid == self.world.player.guid {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::PropertiesUpdated { guid, updates } => {
                self.observe_lock_properties(*guid, updates);
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityPropertiesUpdated {
                        guid: *guid,
                        updates: updates.clone(),
                    });
                self.emit_dynamic_entity_upsert(*guid);
                self.observe_dynamic_script_entity(*guid);
                self.observe_selection_envelope_entity(*guid);
                if *guid == self.world.player.guid
                    && Self::updates_affect_self_movement_kinematics(updates.as_slice())
                {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::EntityMoved { guid, pos } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityMoved {
                        guid: *guid,
                        pos: *pos,
                    });
                self.emit_dynamic_entity_upsert(*guid);
            }
            WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityKinematicsUpdated {
                        guid: *guid,
                        velocity: *velocity,
                        omega: *omega,
                    });
                self.emit_dynamic_entity_upsert(*guid);
            }
            WorldEvent::EntityMotionUpdated { guid, motion } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityMotionUpdated {
                        guid: *guid,
                        motion: *motion,
                    });
                self.emit_dynamic_entity_upsert(*guid);
            }
            WorldEvent::EntityMotionPlaybackChanged { guid } => {
                self.emit_dynamic_entity_upsert(*guid);
            }
            WorldEvent::PlayerGroundedUpdated { grounded } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerGroundedUpdated {
                        grounded: *grounded,
                    });
            }
            WorldEvent::ForcedReposition {
                guid,
                pos,
                sequence,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ForcedReposition {
                        guid: *guid,
                        pos: *pos,
                        sequence: *sequence,
                    });
                self.emit_dynamic_entity_upsert(*guid);
            }
            WorldEvent::RuntimeBodyChanged { body_id } => {
                if let Some(body) = self.world.runtime_body_view(*body_id) {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::RuntimeBodyUpserted {
                            body: Box::new(body),
                        });
                }
                if let Some(guid) = body_id.authoritative_guid() {
                    self.emit_dynamic_entity_upsert(guid);
                }
            }
            WorldEvent::EntityScenePlacementChanged {
                guid,
                generation,
                previous_generation,
                placement,
            } => {
                if generation != previous_generation {
                    self.remove_dynamic_script_entity(crate::DynamicScriptTarget {
                        guid: *guid,
                        instance_sequence: *previous_generation,
                    });
                }
                match placement {
                    holtburger_world::ResolvedScenePlacement::Unresolved(_) => {
                        self.emit_dynamic_entity_removed(*guid, u64::from(*previous_generation))
                    }
                    _ => {
                        self.emit_dynamic_entity_upsert(*guid);
                        self.observe_dynamic_script_entity(*guid);
                        self.observe_selection_envelope_entity(*guid);
                    }
                }
            }
            WorldEvent::RuntimeBodyAdvanced { .. } => {}
            WorldEvent::RuntimeBodyRemoved { body_id } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::RuntimeBodyRemoved { body_id: *body_id });
            }
            WorldEvent::RuntimeBodiesReset { cause } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::RuntimeBodiesReset { cause: *cause });
                self.emit_dynamic_entity_snapshot();
            }
            WorldEvent::EntityStateUpdated { guid, .. } => {
                self.emit_dynamic_entity_upsert(*guid);
            }
            WorldEvent::ServerTimeUpdate(time) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ServerTimeUpdated { time: *time });
            }
            WorldEvent::CombatModeUpdated(mode) => {
                // ACE reports peace when a requested combat family is unavailable. Otherwise
                // only the requested mode settles admission; unrelated modes cannot retire it.
                if self.portal.pending_combat_mode == Some(*mode)
                    || *mode == holtburger_protocol::messages::combat::CombatMode::NonCombat
                {
                    self.portal.pending_combat_mode = None;
                }
                if *mode != holtburger_protocol::messages::combat::CombatMode::Magic
                    && self.portal.pending_combat_mode
                        != Some(holtburger_protocol::messages::combat::CombatMode::Magic)
                {
                    self.cancel_queued_spell_cast();
                }
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CombatModeUpdated { mode: *mode });
            }
            WorldEvent::VendorApproached(vendor) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::VendorApproached {
                        vendor: vendor.clone(),
                    });
            }
            WorldEvent::VendorCatalogUpdated => self.emit_vendor_state_updated(),
            WorldEvent::FriendsStateUpdated => self.emit_friends_state_updated(),
            WorldEvent::ContractsStateUpdated => self.emit_contracts_state_updated(),
            WorldEvent::ContractMembershipChanged(change)
                if self.conn.state == ClientState::InWorld =>
            {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ContractMembershipChanged(change.clone()));
            }
            WorldEvent::SquelchStateUpdated => self.emit_squelch_state_updated(),
            WorldEvent::AllegianceStateUpdated => self.emit_allegiance_snapshot(),
            WorldEvent::FellowshipStateUpdated(fellowship) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::FellowshipStateUpdated {
                        player_guid: (self.world.player.guid != Guid::NULL)
                            .then_some(self.world.player.guid),
                        fellowship: fellowship.clone(),
                    });
            }
            WorldEvent::FellowshipActivity(activity) if self.conn.state == ClientState::InWorld => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::FellowshipActivity {
                        activity: activity.clone(),
                    });
            }
            WorldEvent::TradeStateUpdated(_) => self.emit_trade_state_updated(),
            _ => {}
        }
    }
}

impl ClientWorldActivationRuntime {
    fn lifecycle(&self) -> ClientLifecycleState {
        let cause = match self.phase {
            ClientWorldActivationPhase::InitialEntry => ClientWorldActivationCause::InitialEntry,
            ClientWorldActivationPhase::TeleportAwaitingDestination
            | ClientWorldActivationPhase::TeleportDestinationInstalled => {
                ClientWorldActivationCause::Teleport
            }
        };

        ClientLifecycleState::PortalSpace {
            world_generation: self.generation,
            cause,
        }
    }
}

#[cfg(test)]
mod tests;
