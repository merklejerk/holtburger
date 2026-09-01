use crate::DynamicEntitySnapshot;
use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::movement::MotionStance;
use holtburger_session::Session;
use holtburger_world::{SpatialBodyId, WorldEvent, WorldState};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

mod builder;
mod camera;
pub mod character_axes;
pub mod character_jump;
pub mod character_kinematics;
pub mod character_motion;
mod character_selection;
pub mod collision;
pub mod combat_feedback;
mod commands;
mod dynamic_entity_view;
mod messages;
mod movement;
pub mod movement_types;
pub mod precise_jump;
pub mod precise_jump_prediction;
mod precise_jump_runtime;
mod runtime;
pub mod runtime_body_view_cache;
mod simulation;
pub mod types;
pub use builder::ClientRuntimeBuilder;
pub use camera::{
    ClientCameraClearance, ClientCameraClearanceRequest, ClientCameraCollisionProof,
    ClientCameraDiagnostics, ClientCameraFailureReason, ClientCameraIdentity,
    ClientCameraIntentRequest, ClientCameraReseedReason, ClientCameraStartReceipt,
    ClientCameraStartRequest, ClientCameraTargetSphereRole, ClientCameraTick,
    ClientCameraUpdateReceipt,
};
use camera::{ClientCameraRuntime, ClientCameraSettlement};
use character_selection::CharacterSelectionState;
use movement::MovementSystem;
pub use precise_jump_runtime::{
    PreciseJumpActionSequence, PreciseJumpAimRequest, PreciseJumpAimSequence,
    PreciseJumpCancelRequest, PreciseJumpCommitRequest, PreciseJumpEvaluation,
    PreciseJumpEvaluationId, PreciseJumpEvaluationStatus, PreciseJumpTargetView,
    PreciseJumpTransactionFeedback, PreciseJumpTransactionOutcome, PreciseJumpTransactionRejection,
};
use types::*;

/// Physics tick interval in milliseconds.
const PHYSICS_TICK_MS: u64 = 30;
const BUSY_OPERATION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingBusyOperation {
    operation: BusyOperationKind,
    deadline: Instant,
    pending_error: Option<(WeenieError, Option<String>)>,
}

/// Publication state distinguishes an unpublished baseline from a published unavailable value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PublishedCharacterMotionCapabilities {
    Unpublished,
    Published(Option<ClientCharacterMotionCapabilities>),
}

pub struct ClientRuntime {
    pub session: Session,
    pub world: WorldState,
    active_confirmation: Option<ActiveCharacterConfirmation>,
    active_busy_operation: Option<PendingBusyOperation>,
    state: ClientState,
    /// Distinguishes the initial connected socket from a login request in flight.
    authenticating: bool,
    /// Monotonic world-generation edge used to invalidate presentation interpolation.
    world_generation: u64,
    /// Latest server-provided world name retained for replacement application snapshots.
    world_name: Option<String>,
    /// Terminal cause selected by the authority before it publishes `Exiting`.
    exit_cause: Option<ClientExitCause>,
    client_view_event_tx: broadcast::Sender<ClientViewEvent>,
    /// Monotonic origin shared by focused dynamic-entity snapshots and deltas.
    dynamic_entity_time_origin: Instant,
    /// Last character-motion capability level projected on the current event baseline.
    published_character_motion_capabilities: PublishedCharacterMotionCapabilities,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
    movement: MovementSystem,
    /// Stages static collision and local-player body products outside the simulation turn.
    collision_coordinator: Option<collision::ClientCollisionCoordinator>,
    /// Whether the selected composition owns an asynchronous destination reveal product.
    requires_external_world_reveal: bool,
    /// One generation-scoped replacement transition. `None` means the active scene is continuous
    /// (or the client has not selected a character yet).
    activation: Option<ClientWorldActivationRuntime>,
    /// Client-local camera boom advanced inside the same authority clock as entity presentation.
    camera: ClientCameraRuntime,
    /// Replaceable speculative aim work and ordered precise-jump commit state.
    precise_jump: precise_jump_runtime::PreciseJumpRuntime,
    character_selection: CharacterSelectionState,
    turbine_chat: TurbineChatState,
}

/// Internal activation bookkeeping. Destination and prerequisite products stay private so a
/// frontend cannot manufacture authority facts or observe an intermediate collision transaction.
struct ClientWorldActivationRuntime {
    generation: u64,
    phase: ClientWorldActivationPhase,
    player_guid: Guid,
    destination: Option<ClientActivationDestination>,
    /// When the server's destination position became authoritative for this generation.
    destination_accepted_at: Option<Instant>,
    camera_settlement: ClientActivationCameraSettlement,
    external_reveal_generation: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClientActivationCameraSettlement {
    Pending,
    Settled,
    Exhausted,
}

/// Maximum retail tunnel completion after an authoritative destination position is accepted.
const RETAIL_PORTAL_COMPLETION_GRACE: Duration = Duration::from_secs(7);

/// Protocol progress needed to distinguish the pre-destination teleport gap from a destination
/// that is ready for activation convergence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClientWorldActivationPhase {
    InitialEntry,
    TeleportAwaitingDestination,
    TeleportDestinationInstalled,
}

/// Core-private authority guard pairing stable player identity with the exact destination cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ClientActivationDestination {
    player: collision::ClientPlayerIdentity,
    residency: Guid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ClientWorldActivationState {
    InitialEntry,
    Teleport,
}

impl ClientRuntime {
    /// Returns the complete lifecycle projection without exposing the internal world state.
    pub fn lifecycle(&self) -> ClientLifecycleState {
        match &self.state {
            ClientState::Connected if self.authenticating => ClientLifecycleState::Authenticating,
            ClientState::Connected => ClientLifecycleState::Connecting,
            ClientState::CharacterSelection(characters) => {
                ClientLifecycleState::CharacterSelection {
                    characters: characters
                        .iter()
                        .enumerate()
                        .map(|(slot, character)| ClientCharacterSummary {
                            guid: character.guid,
                            name: character.name.clone(),
                            slot: slot as u32,
                            delete_time: character.delete_time,
                        })
                        .collect(),
                }
            }
            ClientState::EnteringWorld => self
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
                .activation
                .as_ref()
                .map(|activation| activation.lifecycle())
                .unwrap_or(ClientLifecycleState::EnteringWorld {
                    character_guid: self.character_selection.character_id.unwrap_or(Guid::NULL),
                }),
            ClientState::Disconnected => ClientLifecycleState::Exiting {
                cause: self.exit_cause.unwrap_or(ClientExitCause::ServerDisconnect),
            },
        }
    }

    /// Builds one atomic replacement level for shells that lost their event baseline.
    pub fn application_snapshot(&self) -> ClientApplicationSnapshot {
        ClientApplicationSnapshot {
            lifecycle: self.lifecycle(),
            local_player_guid: (self.world.player.guid != Guid::NULL)
                .then_some(self.world.player.guid),
            server_time: self
                .world
                .server_time
                .as_ref()
                .map(|_| self.world.current_server_time()),
            world_generation: self.world_generation,
            world_name: self.world_name.clone(),
            player_name: self
                .world
                .player_entity()
                .map(|entity| entity.name().to_string()),
            vitals: self.world.player.vitals.clone(),
            character_motion: self.character_motion_capabilities(),
            dynamic: DynamicEntitySnapshot::new(
                self.dynamic_entity_host_time(),
                self.current_dynamic_entity_views(),
            ),
            runtime_bodies: self.world.runtime_body_views().into(),
        }
    }

    fn character_motion_capabilities(&self) -> Option<ClientCharacterMotionCapabilities> {
        let capabilities = self.world.resolve_self_jump_capabilities().ok()?;
        let stance = MotionStance::from_repr(capabilities.movement.stance())?;
        Some(ClientCharacterMotionCapabilities {
            full_charge_duration: character_jump::retail_jump_charge_profile(stance)
                .full_charge_duration(),
        })
    }

    fn publish_character_motion_capabilities_if_changed(&mut self) {
        let capabilities = self.character_motion_capabilities();
        let publication = PublishedCharacterMotionCapabilities::Published(capabilities);
        if self.published_character_motion_capabilities == publication {
            return;
        }
        self.published_character_motion_capabilities = publication;
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
            .map(collision::ClientCollisionCoordinator::body_readiness)
    }

    pub(crate) fn set_exit_cause(&mut self, cause: ClientExitCause) {
        self.exit_cause = Some(cause);
    }

    pub(crate) fn bump_world_generation(&mut self) -> u64 {
        self.world_generation = self.world_generation.saturating_add(1);
        self.precise_jump.invalidate();
        self.world_generation
    }

    /// Starts one generation-scoped replacement activation. The network/world authority keeps
    /// ingesting destination state while movement, local solving, and camera advancement remain
    /// withdrawn until the activation conjunction completes.
    pub(super) fn start_world_activation(
        &mut self,
        cause: ClientWorldActivationState,
        player_guid: Guid,
    ) {
        let generation = self.bump_world_generation();
        let phase = match cause {
            ClientWorldActivationState::InitialEntry => ClientWorldActivationPhase::InitialEntry,
            ClientWorldActivationState::Teleport => {
                ClientWorldActivationPhase::TeleportAwaitingDestination
            }
        };
        self.activation = Some(ClientWorldActivationRuntime {
            generation,
            phase,
            player_guid,
            destination: None,
            destination_accepted_at: None,
            camera_settlement: if self.requires_external_world_reveal {
                ClientActivationCameraSettlement::Pending
            } else {
                ClientActivationCameraSettlement::Settled
            },
            external_reveal_generation: (!self.requires_external_world_reveal)
                .then_some(generation),
        });
        self.movement.retire_movement_epoch();
        self.reset_camera();
        if let Some(coordinator) = self.collision_coordinator.as_mut() {
            coordinator.invalidate();
        }
        self.state = ClientState::EnteringWorld;
        self.send_status_event();
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
        let Some(activation) = self.activation.as_mut() else {
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
        self.try_complete_world_activation_at(Instant::now()).await
    }

    /// Re-evaluates activation against one sampled clock for deterministic deadline policy.
    async fn try_complete_world_activation_at(&mut self, now: Instant) -> anyhow::Result<()> {
        let Some(mut activation) = self.activation.take() else {
            return Ok(());
        };
        if matches!(
            activation.phase,
            ClientWorldActivationPhase::TeleportAwaitingDestination
        ) {
            self.activation = Some(activation);
            return Ok(());
        }

        let Some(player) = self.world.player_entity() else {
            self.activation = Some(activation);
            return Ok(());
        };
        if player.guid != activation.player_guid || player.position.landblock_id == Guid::NULL {
            self.activation = Some(activation);
            return Ok(());
        }

        let destination = ClientActivationDestination {
            player: collision::ClientPlayerIdentity {
                guid: player.guid,
                instance_sequence: player.instance_sequence(),
            },
            residency: player.position.landblock_id,
        };
        if activation.destination != Some(destination) {
            activation.destination = Some(destination);
            activation.destination_accepted_at = Some(now);
            activation.camera_settlement = if self.requires_external_world_reveal {
                ClientActivationCameraSettlement::Pending
            } else {
                ClientActivationCameraSettlement::Settled
            };
        }

        let body_ready = self
            .collision_coordinator
            .as_ref()
            .is_some_and(|coordinator| {
                matches!(
                    coordinator.body_readiness(),
                    collision::ClientBodyReadiness::Ready { player }
                        if player == destination.player
                )
            })
            && self
                .world
                .scene
                .body(SpatialBodyId::LocalPlayer(player.guid))
                .is_some_and(|body| body.physical.is_some());
        let containment_ready = self.world.all_player_contained_objects_exist();
        let reveal_ready = activation.external_reveal_generation == Some(activation.generation);
        let destination_scene_ready = self
            .collision_coordinator
            .as_ref()
            .is_some_and(|coordinator| coordinator.destination_scene_ready(destination.residency));

        // Body preparation and static residency complete independently. A registered camera may
        // arrive before either worker; seeding it against the retained prior/empty scene would
        // turn ordinary asynchronous loading into a terminal missing-cell failure.
        if body_ready
            && destination_scene_ready
            && activation.camera_settlement == ClientActivationCameraSettlement::Pending
        {
            let collision_snapshot = self
                .collision_coordinator
                .as_ref()
                .map(collision::ClientCollisionCoordinator::snapshot);
            match self
                .camera
                .settle_for_activation(&self.world, collision_snapshot.as_deref())?
            {
                ClientCameraSettlement::Pending => {}
                ClientCameraSettlement::Settled(tick) => {
                    self.emit_camera_event(tick);
                    activation.camera_settlement = ClientActivationCameraSettlement::Settled;
                }
                ClientCameraSettlement::Exhausted => {
                    activation.camera_settlement = ClientActivationCameraSettlement::Exhausted;
                    log::warn!(
                        "Camera settlement exhausted its bounded work for world generation {}",
                        activation.generation
                    );
                }
            }
        }

        let presentation_ready = body_ready
            && destination_scene_ready
            && containment_ready
            && activation.camera_settlement == ClientActivationCameraSettlement::Settled
            && reveal_ready;
        // RETAIL QUIRK: `SmartBox::UseTime` completes a received position independently of scene
        // rendering (acclient.c:140024-140027), then `gmSmartBoxUI::UseTime` bounds tunnel exit and
        // sends LoginComplete (acclient.c:252754-252799). Requiring visual convergence forever
        // strands the shipped Town Network destination at 0x00070219. Live census: 0x0007 lacks a
        // usable destination scene; 0x0288 and outdoor 22S, 2W converge before this deadline.
        let completion_grace_elapsed = activation.destination_accepted_at.is_some_and(|accepted| {
            now.saturating_duration_since(accepted) >= RETAIL_PORTAL_COMPLETION_GRACE
        });
        if !presentation_ready && !completion_grace_elapsed {
            self.activation = Some(activation);
            return Ok(());
        }
        if completion_grace_elapsed && !presentation_ready {
            log::warn!(
                "Completing world generation {} at destination {:#010X} after presentation failed to converge",
                activation.generation,
                destination.residency.0
            );
        }

        self.send_login_complete().await?;
        self.activation = None;
        self.state = ClientState::InWorld;
        self.send_status_event();
        Ok(())
    }

    fn player_character_options(&self) -> PlayerCharacterOptions {
        PlayerCharacterOptions {
            options1: self.world.player.options1,
            options2: self.world.player.options2,
        }
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
                    confirmation: self.active_confirmation.clone(),
                });
    }

    fn active_busy_operation(&self) -> Option<BusyOperationKind> {
        self.active_busy_operation
            .as_ref()
            .map(|pending| pending.operation)
    }

    fn emit_busy_state_updated(&self) {
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
        &self,
        source: ActionResultSource,
        reason: ActionResultReason,
    ) {
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

    pub(super) fn arm_busy_operation(&mut self, operation: BusyOperationKind) -> bool {
        if let Some(active) = self.active_busy_operation.as_ref() {
            log::warn!(
                "Ignoring busy-tracked {:?} while {:?} is still pending.",
                operation,
                active.operation
            );
            return false;
        }

        self.active_busy_operation = Some(PendingBusyOperation {
            operation,
            deadline: Instant::now() + BUSY_OPERATION_TIMEOUT,
            pending_error: None,
        });
        self.emit_busy_state_updated();
        true
    }

    pub(super) fn note_busy_error(&mut self, error: WeenieError, parameter: Option<String>) {
        if let Some(pending) = &mut self.active_busy_operation {
            pending.pending_error = Some((error, parameter));
        }
    }

    pub(super) fn finish_busy_operation_from_use_done(&mut self, error: WeenieError) {
        let Some(pending) = self.active_busy_operation.take() else {
            return;
        };

        let (resolved_error, parameter) = if error == WeenieError::None {
            pending.pending_error.unwrap_or((error, None))
        } else {
            (error, None)
        };

        self.emit_busy_state_updated();
        self.emit_busy_operation_finished(
            pending.operation,
            BusyOperationResult::Completed {
                error: resolved_error,
                parameter,
            },
        );
    }

    fn emit_fellowship_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::FellowshipStateUpdated {
                fellowship: self.world.fellowship.clone(),
            });
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
            .send(ClientViewEvent::TradeStateUpdated {
                trade: self.world.trade.clone(),
            });
    }

    pub(super) fn emit_current_application_snapshot(&mut self) {
        self.emit_fellowship_state_updated();
        self.emit_vendor_state_updated();
        self.emit_trade_state_updated();
        self.emit_dynamic_entity_snapshot();
        self.emit_runtime_body_snapshot();
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::ApplicationSnapshot(
                self.application_snapshot(),
            ));
    }

    pub fn subscribe_client_view_events(&self) -> broadcast::Receiver<ClientViewEvent> {
        self.client_view_event_tx.subscribe()
    }

    pub fn set_command_rx(&mut self, rx: mpsc::UnboundedReceiver<ClientCommand>) {
        self.command_rx = Some(rx);
    }

    fn send_status_event(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::StatusUpdate {
                state: self.state.clone(),
            });
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::LifecycleChanged(self.lifecycle()));
    }

    pub fn handle_world_event(&self, event: &WorldEvent) {
        self.emit_world_view_projection(event);
    }

    fn emit_world_view_projection(&self, event: &WorldEvent) {
        match event {
            WorldEvent::PlayerEnchantmentsUpdated { enchantments } => {
                let _ =
                    self.client_view_event_tx
                        .send(ClientViewEvent::PlayerEnchantmentsUpdated {
                            enchantments: enchantments.clone(),
                        });
            }
            WorldEvent::DerivedStatsUpdated(data) => {
                let attributes = data
                    .attributes
                    .iter()
                    .cloned()
                    .map(|attribute| (attribute.attr_type, attribute))
                    .collect();
                let skills = data
                    .skills
                    .iter()
                    .cloned()
                    .map(|skill| (skill.skill_type, skill))
                    .collect();
                let vitals = data
                    .vitals
                    .iter()
                    .cloned()
                    .map(|vital| (vital.vital_type, vital))
                    .collect();

                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerStatsSkillsUpdated {
                        attributes,
                        skills,
                        resistances: data.resistances.clone(),
                        armor: data.armor,
                        vitae: data.vitae,
                    });
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });
            }
            WorldEvent::AttributeUpdated(_) | WorldEvent::SkillUpdated(_) => {}
            WorldEvent::LevelInfoUpdated(level_info) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerLevelInfoUpdated {
                        level_info: level_info.clone(),
                    });
            }
            WorldEvent::VitalUpdated(vital) => {
                let mut vitals = HashMap::new();
                vitals.insert(vital.vital_type, vital.clone());
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });
            }
            WorldEvent::SpellUpdated { spell_ids, .. }
            | WorldEvent::SpellRemoved { spell_ids, .. } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerSpellsUpdated {
                        spell_ids: spell_ids.clone(),
                    });
            }
            WorldEvent::PlayerInfo(data) => {
                self.emit_player_options_updated();
                let _ =
                    self.client_view_event_tx
                        .send(ClientViewEvent::PlayerEnchantmentsUpdated {
                            enchantments: data.enchantments.clone(),
                        });

                let attributes = data
                    .attributes
                    .iter()
                    .cloned()
                    .map(|attribute| (attribute.attr_type, attribute))
                    .collect();
                let skills = data
                    .skills
                    .iter()
                    .cloned()
                    .map(|skill| (skill.skill_type, skill))
                    .collect();
                let vitals = data
                    .vitals
                    .iter()
                    .cloned()
                    .map(|vital| (vital.vital_type, vital))
                    .collect();
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerStatsSkillsUpdated {
                        attributes,
                        skills,
                        resistances: data.resistances.clone(),
                        armor: data.armor,
                        vitae: data.vitae,
                    });
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerLevelInfoUpdated {
                        level_info: data.level_info.clone(),
                    });
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });

                let mut spell_ids = data.spells.clone();
                spell_ids.sort();
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerSpellsUpdated { spell_ids });

                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntitySpawned {
                        entity: data.entity.clone(),
                    });
                self.emit_dynamic_entity_upsert(data.entity.guid);
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
                if entity.guid == self.world.player.guid {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::EntityHealthUpdated {
                guid,
                health_fraction,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityHealthUpdated {
                        guid: *guid,
                        health_fraction: *health_fraction,
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
            }
            WorldEvent::EntityDespawned { guid, generation } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityDespawned { guid: *guid });
                self.emit_dynamic_entity_removed(*guid, *generation);
                if *guid == self.world.player.guid {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::PropertiesUpdated { guid, updates } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityPropertiesUpdated {
                        guid: *guid,
                        updates: updates.clone(),
                    });
                self.emit_dynamic_entity_upsert(*guid);
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
            WorldEvent::PlayerGroundedUpdated { grounded } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerGroundedUpdated {
                        grounded: *grounded,
                    });
            }
            WorldEvent::SelfServerControlledMotion(data) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::SelfServerControlledMotion { data: data.clone() });
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
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CombatModeUpdated { mode: *mode });
            }
            WorldEvent::VendorStateUpdated(vendor) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::VendorStateUpdated {
                        vendor: vendor.clone(),
                    });
            }
            WorldEvent::VendorItemIdentified(item) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::VendorItemIdentified(item.clone()));
            }
            WorldEvent::FellowshipStateUpdated(fellowship) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::FellowshipStateUpdated {
                        fellowship: fellowship.clone(),
                    });
            }
            WorldEvent::FellowshipActivity(activity) if self.state == ClientState::InWorld => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::FellowshipActivity {
                        activity: activity.clone(),
                    });
            }
            WorldEvent::TradeStateUpdated(trade) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::TradeStateUpdated {
                        trade: trade.clone(),
                    });
            }
            WorldEvent::ContainerOpened(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ContainerOpened { guid: *guid });
            }
            WorldEvent::ContainerClosed(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ContainerClosed { guid: *guid });
            }
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
mod tests {
    use super::*;
    use crate::{
        CharacterMotionEvent, CharacterMotionSequence, DynamicEntityEvent, DynamicEntityHostTime,
        JumpExtent, SequencedCharacterMotionEvent,
    };
    use std::collections::{BTreeMap, HashMap};
    use std::sync::Arc;

    use crate::{
        CLIENT_COLLISION_OWNER_RADIUS, SimulationSceneInterest, SimulationSceneOwnerAvailability,
        SimulationSceneSnapshot,
    };
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        PhysicsState, PropertyDataId, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_common::{Guid, Quaternion, Vector3};
    use holtburger_content::{
        ColliderScale, LandblockColliders, LandblockCollisionAsset, LandblockTerrain,
        MotionSequenceCatalog, TerrainCellDiagonals, TerrainCollisionSurface,
    };
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
    use holtburger_dat::file_type::setup_model::AnimationFrame;
    use holtburger_dat::file_type::{Animation, MotionTable};
    use holtburger_dat::graphics::Frame;
    use holtburger_protocol::messages::movement::{
        InterpretedMotionCommand, InterpretedMotionState, MotionStance, MovementEventData,
        MovementInvalid, MovementStateFlags, MovementType, MovementTypeData, PositionPack,
        UpdatePositionData, UpdatePositionFlag,
    };
    use holtburger_protocol::messages::{CharacterEntry, GameMessage, VectorUpdateData};
    use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};
    use holtburger_world::FellowshipActivity;
    use holtburger_world::entity::{
        Entity, EntityMotionSnapshot, EntityNetworkMotion, OrderedMotionScalar,
    };
    use holtburger_world::state::motion_resolution::test_support::FIXTURE_STAND_COMMAND;
    use holtburger_world::stats::{
        Attribute, AttributeType, Skill, SkillType, TrainingLevel, Vital, VitalType,
    };
    use holtburger_world::{
        AuthoritativeBodyVectors, CollisionScene, DynamicBodyCollisionDefinition,
        DynamicPhysicalBodyConfiguration, DynamicPhysicalBodyDefinition, EdgeProtection,
        EntityCollisionParticipation, EntityCollisionReportPolicy, EntityDynamicCollisionPolicy,
        FreeSphereConfig, GroundedConfig, LocalIntegrationDemand, LocalPhysicalDemand,
        LocalTargetDemand, PhysicalBodyDefinition, PhysicalBodyResponsePolicy,
        PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction, PhysicalRestitution,
        PhysicalSphereSet, PhysicalSurfaceMotion, PlayerMotionTableSource,
        PreparedEntityTargetGeometry, RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z,
        RETAIL_WALKABLE_NORMAL_Z, SelfMovementCapabilities, SelfMovementKinematics,
    };

    const JUMP_FIXTURE_STAND_ANIMATION: u32 = 0x0300_1001;
    const JUMP_FIXTURE_RUN_ANIMATION: u32 = 0x0300_1002;
    const JUMP_FIXTURE_TAKEOFF_ANIMATION: u32 = 0x0300_1004;
    const JUMP_FIXTURE_FALLING_ANIMATION: u32 = 0x0300_1005;
    const JUMP_FIXTURE_LANDING_ANIMATION: u32 = 0x0300_1006;
    const JUMP_FIXTURE_ACTION_ANIMATION: u32 = 0x0300_1007;
    const JUMP_FIXTURE_ACTION_COMMAND: u32 = 0x1000_004A;

    /// A real motion-table fixture for jump presentation tests.
    ///
    /// Explicit motion vectors keep physical expectations readable while actual animation records
    /// and authored links make clip identity independently observable. Production still selects
    /// content IDs from the actor's table; none of these fixture IDs cross the test boundary.
    fn jump_presentation_motion_catalog(motion_table_id: u32) -> MotionSequenceCatalog {
        let style = MotionStance::NonCombat as u32;
        let cycle = |animation_id: u32, velocity: Option<Vector3>, omega: Option<Vector3>| {
            let mut flags = MotionDataFlags::empty();
            flags.set(MotionDataFlags::HAS_VELOCITY, velocity.is_some());
            flags.set(MotionDataFlags::HAS_OMEGA, omega.is_some());
            MotionData {
                bitfield: 0,
                flags,
                anims: vec![AnimData {
                    anim_id: animation_id,
                    low_frame: 0,
                    high_frame: -1,
                    framerate: 10.0,
                }],
                velocity,
                omega,
            }
        };
        let link = |animation_id, framerate| MotionData {
            bitfield: 0,
            flags: MotionDataFlags::empty(),
            anims: vec![AnimData {
                anim_id: animation_id,
                low_frame: 0,
                high_frame: -1,
                framerate,
            }],
            velocity: None,
            omega: None,
        };
        let cycles = HashMap::from([
            (
                MotionTable::cycle_key(style, FIXTURE_STAND_COMMAND),
                cycle(JUMP_FIXTURE_STAND_ANIMATION, None, None),
            ),
            (
                MotionTable::cycle_key(style, MotionTable::WALK_FORWARD_COMMAND),
                cycle(
                    JUMP_FIXTURE_RUN_ANIMATION,
                    Some(Vector3::new(1.0, 0.0, 0.0)),
                    None,
                ),
            ),
            (
                MotionTable::cycle_key(style, MotionTable::RUN_FORWARD_COMMAND),
                cycle(
                    JUMP_FIXTURE_RUN_ANIMATION,
                    Some(Vector3::new(2.5, 0.0, 0.0)),
                    None,
                ),
            ),
            (
                MotionTable::cycle_key(style, MotionTable::TURN_LEFT_COMMAND),
                cycle(
                    JUMP_FIXTURE_STAND_ANIMATION,
                    None,
                    Some(Vector3::new(0.0, 0.0, -1.0)),
                ),
            ),
            (
                MotionTable::cycle_key(style, MotionTable::TURN_RIGHT_COMMAND),
                cycle(
                    JUMP_FIXTURE_STAND_ANIMATION,
                    None,
                    Some(Vector3::new(0.0, 0.0, 1.0)),
                ),
            ),
            (
                MotionTable::cycle_key(
                    style,
                    holtburger_world::motion::MotionCommand::FALLING.raw(),
                ),
                cycle(JUMP_FIXTURE_FALLING_ANIMATION, None, None),
            ),
        ]);
        let takeoff_targets = HashMap::from([(
            holtburger_world::motion::MotionCommand::FALLING.raw(),
            link(JUMP_FIXTURE_TAKEOFF_ANIMATION, 20.0),
        )]);
        let landing_targets = HashMap::from([
            (
                FIXTURE_STAND_COMMAND,
                link(JUMP_FIXTURE_LANDING_ANIMATION, 200.0),
            ),
            (
                MotionTable::RUN_FORWARD_COMMAND,
                link(JUMP_FIXTURE_LANDING_ANIMATION, 200.0),
            ),
        ]);
        let links = HashMap::from([
            (
                MotionTable::cycle_key(style, holtburger_world::motion::MotionCommand::READY.raw()),
                takeoff_targets.clone(),
            ),
            (
                MotionTable::cycle_key(style, MotionTable::RUN_FORWARD_COMMAND),
                takeoff_targets,
            ),
            (
                MotionTable::cycle_key(
                    style,
                    holtburger_world::motion::MotionCommand::FALLING.raw(),
                ),
                landing_targets,
            ),
        ]);
        let table = MotionTable {
            id: motion_table_id,
            default_style: style,
            style_defaults: HashMap::from([(style, FIXTURE_STAND_COMMAND)]),
            cycles,
            modifiers: HashMap::new(),
            links,
        };
        let animation = |id| Animation {
            id,
            flags: AnimationFlags::empty(),
            num_parts: 0,
            num_frames: 4,
            pos_frames: Vec::new(),
            part_frames: (0..4)
                .map(|_| AnimationFrame {
                    frames: Vec::new(),
                    hooks: Vec::new(),
                })
                .collect(),
        };
        MotionSequenceCatalog::assemble(
            [table],
            [
                animation(JUMP_FIXTURE_STAND_ANIMATION),
                animation(JUMP_FIXTURE_RUN_ANIMATION),
                animation(JUMP_FIXTURE_TAKEOFF_ANIMATION),
                animation(JUMP_FIXTURE_FALLING_ANIMATION),
                animation(JUMP_FIXTURE_LANDING_ANIMATION),
            ],
            [],
        )
        .expect("jump presentation fixture should assemble")
    }

    /// Minimal action fixture with a measurable root track for the local-adapter boundary.
    fn local_action_motion_catalog(motion_table_id: u32) -> MotionSequenceCatalog {
        let style = MotionStance::NonCombat as u32;
        let clip = |animation_id| MotionData {
            bitfield: 0,
            flags: MotionDataFlags::empty(),
            anims: vec![AnimData {
                anim_id: animation_id,
                low_frame: 0,
                high_frame: -1,
                framerate: 10.0,
            }],
            velocity: None,
            omega: None,
        };
        let animation = |id, step| Animation {
            id,
            flags: AnimationFlags::POS_FRAMES,
            num_parts: 0,
            num_frames: 4,
            pos_frames: (0..4)
                .map(|_| Frame {
                    origin: step,
                    orientation: Quaternion::identity(),
                })
                .collect(),
            part_frames: (0..4)
                .map(|_| AnimationFrame {
                    frames: Vec::new(),
                    hooks: Vec::new(),
                })
                .collect(),
        };
        let table = MotionTable {
            id: motion_table_id,
            default_style: style,
            style_defaults: HashMap::from([(style, FIXTURE_STAND_COMMAND)]),
            cycles: HashMap::from([(
                MotionTable::cycle_key(style, FIXTURE_STAND_COMMAND),
                clip(JUMP_FIXTURE_STAND_ANIMATION),
            )]),
            modifiers: HashMap::new(),
            links: HashMap::from([(
                MotionTable::cycle_key(style, FIXTURE_STAND_COMMAND),
                HashMap::from([(
                    JUMP_FIXTURE_ACTION_COMMAND,
                    clip(JUMP_FIXTURE_ACTION_ANIMATION),
                )]),
            )]),
        };
        MotionSequenceCatalog::assemble(
            [table],
            [
                animation(JUMP_FIXTURE_STAND_ANIMATION, Vector3::zero()),
                animation(JUMP_FIXTURE_ACTION_ANIMATION, Vector3::new(0.0, 0.25, 0.0)),
            ],
            [],
        )
        .expect("local action fixture should assemble")
    }

    /// Routes a constructed message through the same pack/unpack boundary as an ACE datagram.
    fn encoded_game_message(message: GameMessage) -> GameMessage {
        let mut bytes = Vec::new();
        message.pack(&mut bytes);
        let mut offset = 0;
        let decoded = GameMessage::unpack(&bytes, &mut offset)
            .expect("encoded movement fixture should decode");
        assert_eq!(offset, bytes.len());
        decoded
    }

    #[test]
    fn server_authored_local_action_uses_the_local_adapter_for_its_exact_root_offset() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_1007);
        let motion_table_id = 0x0900_1007;
        world.set_motion_sequences(local_action_motion_catalog(motion_table_id));
        world.seed_local_player_entity(guid, "Player", WorldPosition::default());
        world
            .entities
            .get_mut(guid)
            .unwrap()
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
        assert_eq!(
            world.effective_motion_table_id_for_guid(guid),
            Some(motion_table_id),
        );

        let message =
            encoded_game_message(GameMessage::UpdateMotion(Box::new(MovementEventData {
                guid,
                object_instance_sequence: 0,
                movement_sequence: 1,
                server_control_sequence: 1,
                is_autonomous: false,
                movement_type: MovementType::Invalid,
                motion_flags: 0,
                current_style: MotionStance::NonCombat.interpreted(),
                data: MovementTypeData::Invalid(MovementInvalid {
                    state: InterpretedMotionState {
                        flags: MovementStateFlags::CURRENT_STYLE
                            | MovementStateFlags::FORWARD_COMMAND,
                        current_style: Some(MotionStance::NonCombat.interpreted()),
                        forward_command: Some(InterpretedMotionCommand(74)),
                        ..Default::default()
                    },
                    sticky_object: None,
                }),
            })));
        let GameMessage::UpdateMotion(decoded) = &message else {
            panic!("encoded fixture changed message kind");
        };
        let MovementTypeData::Invalid(decoded) = &decoded.data else {
            panic!("encoded fixture changed movement kind");
        };
        assert_eq!(
            decoded.state.forward_command,
            Some(InterpretedMotionCommand(74)),
        );
        assert_eq!(
            holtburger_world::motion::MotionCommand::from_interpreted(
                decoded.state.forward_command.unwrap(),
            )
            .map(holtburger_world::motion::MotionCommand::raw),
            Some(JUMP_FIXTURE_ACTION_COMMAND),
        );
        world.handle_message(&message);

        assert!(world.has_authored_motion_actions(guid));
        assert_eq!(
            world
                .player_entity()
                .unwrap()
                .network_motion
                .snapshot()
                .unwrap()
                .forward_command,
            None,
            "the action edge must not become retained forward locomotion",
        );
        let offset = MovementSystem::new()
            .advance_local_authored_motion(&mut world, Duration::from_millis(150))
            .expect("local action playback should resolve")
            .expect("the local adapter must return the action's authored offset");
        assert_eq!(
            world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_ACTION_ANIMATION),
        );
        assert!(
            offset.offset.translation.length() > 0.0,
            "action root offset was {offset:?}",
        );
    }

    #[tokio::test]
    async fn client_authored_action_predicts_the_edge_filtered_from_its_autonomous_echo() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_1008);
        let motion_table_id = 0x0900_1008;
        world.set_motion_sequences(local_action_motion_catalog(motion_table_id));
        world.seed_local_player_entity(guid, "Player", WorldPosition::default());
        world
            .entities
            .get_mut(guid)
            .unwrap()
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));

        let mut movement = MovementSystem::new();
        movement.enqueue_transient_motion(
            InterpretedMotionCommand(74),
            crate::client::movement_types::MotionStyle::Explicit(MotionStance::NonCombat),
        );
        let mut session = holtburger_session::Session::new_test();
        movement
            .tick(Instant::now(), &mut world, &mut session)
            .await
            .expect("client-authored action pulse should send");

        assert!(world.has_authored_motion_actions(guid));
        movement
            .advance_local_authored_motion(&mut world, Duration::from_millis(150))
            .expect("predicted local action should advance")
            .expect("predicted local action should expose its authored offset");
        assert_eq!(
            world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_ACTION_ANIMATION),
        );
    }

    fn dynamic_definition(
        movement: PhysicalBodyDefinition,
        response_policy: PhysicalBodyResponsePolicy,
    ) -> DynamicPhysicalBodyConfiguration {
        let definition = DynamicPhysicalBodyDefinition {
            movement,
            response_policy,
            entity_collision: DynamicBodyCollisionDefinition {
                target_geometry: Arc::new(PreparedEntityTargetGeometry {
                    physics_bsp_parts: Vec::new(),
                    fallback_setup_did: 0,
                    fallback_shapes: Vec::new(),
                    fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                }),
                dynamic_collision: EntityDynamicCollisionPolicy {
                    target: EntityCollisionParticipation::Solid,
                    mover_accepts_response: true,
                    accepts_peer_reports: true,
                    missile: false,
                    path_clipped: false,
                },
                reporting: EntityCollisionReportPolicy {
                    enabled: false,
                    as_environment: false,
                },
                uses_physics_bsp: false,
                elasticity: PhysicalElasticity::DEFAULT,
                default_animation_available: false,
                default_script_available: false,
            },
        };
        DynamicPhysicalBodyConfiguration::new(
            definition,
            LocalPhysicalDemand {
                target: LocalTargetDemand::Retained,
                integration: LocalIntegrationDemand::Eligible,
            },
        )
        .unwrap()
    }

    fn test_self_movement_capabilities(
        run_rate_scalar: f32,
        walk_speed: f32,
        run_speed: f32,
        turn_speed_rad_per_sec: f32,
    ) -> SelfMovementCapabilities {
        SelfMovementCapabilities {
            kinematics: SelfMovementKinematics {
                source: PlayerMotionTableSource::DirectProperty {
                    motion_table_id: 0x0900_0020,
                },
                motion_table_id: 0x0900_0020,
                stance: 0x8000_003D,
                base_walk_forward_velocity: Vector3::new(walk_speed, 0.0, 0.0),
                base_run_forward_velocity: Vector3::new(run_speed, 0.0, 0.0),
                base_turn_left_omega: Vector3::new(0.0, 0.0, -turn_speed_rad_per_sec),
                base_turn_right_omega: Vector3::new(0.0, 0.0, turn_speed_rad_per_sec),
            },
            run_rate_scalar,
        }
    }

    fn collision_scene_for_interest(interest: &SimulationSceneInterest) -> CollisionScene {
        let mut scene = CollisionScene::new();
        for owner in interest.owners() {
            scene
                .insert(LandblockCollisionAsset {
                    landblock_id: owner.0,
                    terrain: TerrainCollisionSurface::empty(),
                    static_geometry: LandblockColliders::default(),
                })
                .unwrap();
        }
        scene
    }

    fn flat_collision_scene_for_interest(interest: &SimulationSceneInterest) -> CollisionScene {
        let mut scene = CollisionScene::new();
        for owner in interest.owners() {
            scene
                .insert(LandblockCollisionAsset {
                    landblock_id: owner.0,
                    terrain: TerrainCollisionSurface::from_terrain(&LandblockTerrain {
                        grid_size: 9,
                        tile_size: 24.0,
                        height_indices: vec![0; 81],
                        heights: vec![0.0; 81],
                        terrain_samples: vec![0; 81],
                        cell_diagonals: TerrainCellDiagonals::for_landblock(owner.0),
                    })
                    .unwrap(),
                    static_geometry: LandblockColliders::default(),
                })
                .unwrap();
        }
        scene
    }

    fn collision_snapshot(
        interest: SimulationSceneInterest,
        scene: CollisionScene,
    ) -> SimulationSceneSnapshot {
        let availability = interest
            .owners()
            .iter()
            .map(|&owner| {
                (
                    owner,
                    SimulationSceneOwnerAvailability::Resident { owner_revision: 1 },
                )
            })
            .collect::<BTreeMap<_, _>>();
        SimulationSceneSnapshot {
            revision: 1,
            content_source_generation: 1,
            interest,
            availability,
            scene: Arc::new(scene),
        }
    }

    fn test_grounded_body_definition() -> PhysicalBodyDefinition {
        PhysicalBodyDefinition::grounded(
            PhysicalSphereSet::new(
                holtburger_common::Sphere {
                    center: Vector3::new(0.0, 0.0, 0.5),
                    radius: 0.5,
                },
                None,
            )
            .unwrap(),
            GroundedConfig {
                gravity: -9.8,
                walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
                landing_normal_z: RETAIL_LANDING_NORMAL_Z,
                airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
                step_up_height: 0.6,
                step_down_height: 1.5,
                edge_protection: EdgeProtection::Creature,
                maximum_substep_distance: 0.24,
                maximum_substeps: 32,
                maximum_contact_passes: 8,
                separation_epsilon: 0.0005,
            },
        )
        .unwrap()
    }

    fn stable_dynamic_body_definition() -> DynamicPhysicalBodyConfiguration {
        dynamic_definition(
            test_grounded_body_definition(),
            PhysicalBodyResponsePolicy {
                restitution: PhysicalRestitution::Inelastic,
                friction: PhysicalFriction::DEFAULT,
                surface_motion: PhysicalSurfaceMotion::Stable,
                align_path: false,
            },
        )
    }

    fn seed_test_self_movement_capabilities(
        client: &mut ClientRuntime,
    ) -> SelfMovementCapabilities {
        let capabilities = test_self_movement_capabilities(2.25, 1.0, 2.0, 1.5);
        client
            .world
            .set_self_movement_capabilities_override(capabilities.clone());
        capabilities
    }

    fn seed_test_jump_authority(client: &mut ClientRuntime) {
        client.world.player.attributes.insert(
            AttributeType::StrengthAttr,
            Attribute {
                attr_type: AttributeType::StrengthAttr,
                ranks: 0,
                start: 100,
                spent_xp: 0,
                next_rank_xp: None,
                base: 100,
                current: 100,
            },
        );
        client.world.player.skills.insert(
            SkillType::Jump,
            Skill {
                skill_type: SkillType::Jump,
                ranks: 0,
                init: 400,
                spent_xp: 0,
                next_rank_xp: None,
                base: 400,
                current: 400,
                training: TrainingLevel::Trained,
                trained_cost: 0,
                specialized_cost: 0,
            },
        );
        client.world.player.skills.insert(
            SkillType::Run,
            Skill {
                skill_type: SkillType::Run,
                ranks: 0,
                init: 300,
                spent_xp: 0,
                next_rank_xp: None,
                base: 300,
                current: 300,
                training: TrainingLevel::Trained,
                trained_cost: 0,
                specialized_cost: 0,
            },
        );
        client.world.player.vitals.insert(
            VitalType::Stamina,
            Vital {
                vital_type: VitalType::Stamina,
                ranks: 0,
                start: 100,
                spent_xp: 0,
                next_rank_xp: None,
                base: 100,
                buffed_max: 100,
                current: 100,
            },
        );
    }

    #[tokio::test]
    async fn fixed_tick_commits_one_grounded_jump_from_the_release_origin() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let release_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(48.0, 48.0, 0.0),
            rotation: Quaternion::from_heading(0.5),
        };
        client
            .world
            .seed_local_player_entity(guid, "Player", release_pose);
        const MOTION_TABLE_ID: u32 = 0x0900_0020;
        client
            .world
            .set_motion_sequences(jump_presentation_motion_catalog(MOTION_TABLE_ID));
        client
            .world
            .player_entity_mut()
            .unwrap()
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(MOTION_TABLE_ID));
        seed_test_self_movement_capabilities(&mut client);
        seed_test_jump_authority(&mut client);
        client.world.player.instance_sequence = 11;
        client.world.player.server_control_sequence = 12;
        client.world.player.teleport_sequence = 13;
        client.world.player.force_position_sequence = 14;

        let body_id = holtburger_world::SpatialBodyId::LocalPlayer(guid);
        client
            .world
            .scene
            .set_dynamic_physical_body(
                body_id,
                Some(stable_dynamic_body_definition()),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let interest = SimulationSceneInterest::prefetch_neighborhood(
            release_pose,
            CLIENT_COLLISION_OWNER_RADIUS,
        )
        .unwrap();
        let collision = collision_snapshot(
            interest.clone(),
            flat_collision_scene_for_interest(&interest),
        );
        let now = Instant::now();
        simulation::tick(
            now,
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        assert_eq!(
            client.world.scene.body(body_id).unwrap().contact,
            holtburger_world::ContactState::Grounded
        );
        let idle_drive = movement_types::CharacterDrive::default();
        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(idle_drive),
            now,
        );
        client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .unwrap();
        simulation::tick(
            now + Duration::from_millis(1),
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        let clip_before_rejected_launch = client.world.motion_runtimes.playing_clip(guid);
        let grounded_release_pose = client.world.scene.body(body_id).unwrap().pose;

        client
            .movement
            .enqueue_character_motion_event(SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(1),
                event: CharacterMotionEvent::BeginJump { drive: idle_drive },
            });
        client
            .movement
            .enqueue_character_motion_event(SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(2),
                event: CharacterMotionEvent::ReleaseJump {
                    drive: idle_drive,
                    extent: JumpExtent::new(0.75).unwrap(),
                },
            });
        client
            .movement
            .tick(
                now + Duration::from_millis(PHYSICS_TICK_MS),
                &mut client.world,
                &mut client.session,
            )
            .await
            .unwrap();
        let unavailable = simulation::tick(
            now + Duration::from_millis(PHYSICS_TICK_MS * 2),
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            None,
        )
        .unwrap();
        assert!(unavailable.committed_jump.is_none());
        assert_eq!(
            unavailable.character_motion_feedback,
            Some(ClientCharacterMotionFeedback {
                sequence: CharacterMotionSequence(2),
                outcome: ClientCharacterMotionOutcome::Rejected(
                    ClientCharacterMotionRejection::CollisionUnavailable,
                ),
            })
        );
        let no_replay = simulation::tick(
            now + Duration::from_millis(PHYSICS_TICK_MS * 3),
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        assert!(no_replay.committed_jump.is_none());
        assert!(no_replay.character_motion_feedback.is_none());
        assert_eq!(
            client.world.motion_runtimes.playing_clip(guid),
            clip_before_rejected_launch,
            "a rejected launch must not replace the grounded clip"
        );

        client
            .movement
            .enqueue_character_motion_event(SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(3),
                event: CharacterMotionEvent::BeginJump { drive: idle_drive },
            });
        client
            .movement
            .tick(
                now + Duration::from_millis(PHYSICS_TICK_MS * 3),
                &mut client.world,
                &mut client.session,
            )
            .await
            .unwrap();
        let charging = simulation::tick(
            now + Duration::from_millis(PHYSICS_TICK_MS * 4),
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        assert!(charging.committed_jump.is_none());
        assert_eq!(
            client.world.motion_runtimes.state(guid).unwrap().substate,
            holtburger_world::motion::MotionCommand::READY
        );
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_STAND_ANIMATION),
            "retail Ready and Stand must resolve through their shared motion-table row"
        );

        client
            .movement
            .enqueue_character_motion_event(SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(4),
                event: CharacterMotionEvent::ReleaseJump {
                    drive: idle_drive,
                    extent: JumpExtent::new(0.75).unwrap(),
                },
            });
        client
            .movement
            .tick(
                now + Duration::from_millis(PHYSICS_TICK_MS * 4),
                &mut client.world,
                &mut client.session,
            )
            .await
            .unwrap();
        let tick = simulation::tick(
            now + Duration::from_millis(PHYSICS_TICK_MS * 5),
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        let committed = tick
            .committed_jump
            .expect("supported local launch should commit exactly once");

        assert_eq!(committed.position, grounded_release_pose);
        assert_eq!(committed.resolved.extent(), JumpExtent::new(0.75).unwrap());
        assert_eq!(
            (
                committed.instance_sequence,
                committed.server_control_sequence,
                committed.teleport_sequence,
                committed.force_position_sequence,
            ),
            (11, 12, 13, 14)
        );
        assert!(committed.resolved.world_velocity().z > 0.0);
        assert!(
            client
                .world
                .scene
                .body(body_id)
                .unwrap()
                .retained
                .velocity
                .z
                > 0.0
        );
        assert_eq!(
            client.world.motion_runtimes.state(guid).unwrap().substate,
            holtburger_world::motion::MotionCommand::FALLING,
            "accepted launch and airborne presentation must commit in the same fixed tick"
        );
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_TAKEOFF_ANIMATION),
            "accepted launch must begin the table-authored Ready-to-Falling transition"
        );

        let mut falling_step = None;
        for step in 6..=25 {
            let airborne = simulation::tick(
                now + Duration::from_millis(PHYSICS_TICK_MS * step),
                Duration::from_millis(PHYSICS_TICK_MS),
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            assert!(airborne.committed_jump.is_none());
            if client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .is_some_and(|clip| clip.animation_id == JUMP_FIXTURE_FALLING_ANIMATION)
            {
                assert_eq!(
                    client.world.scene.body(body_id).unwrap().contact,
                    holtburger_world::ContactState::Airborne
                );
                falling_step = Some(step);
                break;
            }
        }
        let falling_step = falling_step
            .expect("stationary takeoff must advance into Falling independently from the body arc");

        let mut landed = false;
        let mut landing_step = 0;
        for step in (falling_step + 1)..=400 {
            simulation::tick(
                now + Duration::from_millis(PHYSICS_TICK_MS * step),
                Duration::from_millis(PHYSICS_TICK_MS),
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            if client.world.scene.body(body_id).unwrap().contact
                == holtburger_world::ContactState::Grounded
            {
                landed = true;
                landing_step = step;
                break;
            }
        }
        assert!(landed, "local jump should return to flat support");
        assert_eq!(
            client.world.motion_runtimes.state(guid).unwrap().substate,
            holtburger_world::motion::MotionCommand(FIXTURE_STAND_COMMAND),
            "landing should reapply current grounded movement without another playback quantum"
        );
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_LANDING_ANIMATION),
            "support recovery must begin the table-authored landing transition"
        );
        simulation::tick(
            now + Duration::from_millis(PHYSICS_TICK_MS * (landing_step + 1)),
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_STAND_ANIMATION),
            "the authored landing transition must complete into idle"
        );

        let fixed_dt = Duration::from_millis(PHYSICS_TICK_MS);
        let moving_start = now + Duration::from_millis(PHYSICS_TICK_MS * (landing_step + 2));
        let moving_drive = movement_types::CharacterDrive::builder()
            .run()
            .forward()
            .build();
        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(moving_drive),
            moving_start,
        );
        client
            .movement
            .enqueue_character_motion_event(SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(5),
                event: CharacterMotionEvent::BeginJump {
                    drive: moving_drive,
                },
            });
        client
            .movement
            .tick(moving_start, &mut client.world, &mut client.session)
            .await
            .unwrap();
        simulation::tick(
            moving_start + fixed_dt,
            fixed_dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        assert_eq!(
            client.world.motion_runtimes.state(guid).unwrap().substate,
            holtburger_world::motion::MotionCommand::RUN_FORWARD,
            "moving charge must retain locomotion presentation rather than select Ready"
        );
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_RUN_ANIMATION)
        );

        client
            .movement
            .enqueue_character_motion_event(SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(6),
                event: CharacterMotionEvent::ReleaseJump {
                    drive: moving_drive,
                    extent: JumpExtent::new(0.75).unwrap(),
                },
            });
        client
            .movement
            .tick(
                moving_start + fixed_dt,
                &mut client.world,
                &mut client.session,
            )
            .await
            .unwrap();
        let moving_launch = simulation::tick(
            moving_start + fixed_dt * 2,
            fixed_dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap()
        .committed_jump
        .expect("held-run jump should commit from grounded support");
        let moving_velocity = moving_launch.resolved.world_velocity();
        assert!(moving_velocity.z > 0.0);
        assert!(
            moving_velocity.x * moving_velocity.x + moving_velocity.y * moving_velocity.y > 0.0,
            "moving launch must retain a horizontal velocity component"
        );
        assert_eq!(
            client.world.motion_runtimes.state(guid).unwrap().substate,
            holtburger_world::motion::MotionCommand::FALLING
        );
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_TAKEOFF_ANIMATION),
            "moving takeoff must use the authored run-to-Falling transition"
        );

        let mut moving_falling_step = None;
        for step in 3..=20 {
            simulation::tick(
                moving_start + fixed_dt * step,
                fixed_dt,
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            if client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .is_some_and(|clip| clip.animation_id == JUMP_FIXTURE_FALLING_ANIMATION)
            {
                assert_eq!(
                    client.world.scene.body(body_id).unwrap().contact,
                    holtburger_world::ContactState::Airborne
                );
                moving_falling_step = Some(step);
                break;
            }
        }
        let moving_falling_step =
            moving_falling_step.expect("moving takeoff must advance into Falling");
        let mut moving_landing_step = None;
        for step in (moving_falling_step + 1)..=400 {
            simulation::tick(
                moving_start + fixed_dt * step,
                fixed_dt,
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            if client.world.scene.body(body_id).unwrap().contact
                == holtburger_world::ContactState::Grounded
            {
                moving_landing_step = Some(step);
                break;
            }
        }
        let moving_landing_step =
            moving_landing_step.expect("moving jump should return to flat support");
        assert_eq!(
            client.world.motion_runtimes.state(guid).unwrap().substate,
            holtburger_world::motion::MotionCommand::RUN_FORWARD
        );
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_LANDING_ANIMATION)
        );
        simulation::tick(
            moving_start + fixed_dt * (moving_landing_step + 1),
            fixed_dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_RUN_ANIMATION),
            "held locomotion must resume after the authored landing transition"
        );
    }

    #[test]
    fn lifecycle_preserves_selection_slots_and_snapshot_owns_local_identity() {
        let characters = vec![
            CharacterEntry {
                guid: Guid(0x5000_0001),
                name: "Mira".to_string(),
                delete_time: 0,
            },
            CharacterEntry {
                guid: Guid(0x5000_0002),
                name: "Nox".to_string(),
                delete_time: 123,
            },
        ];
        let mut client =
            builder::build_test_client(ClientState::CharacterSelection(characters.clone()));

        assert_eq!(
            client.lifecycle(),
            ClientLifecycleState::CharacterSelection {
                characters: vec![
                    ClientCharacterSummary {
                        guid: Guid(0x5000_0001),
                        name: "Mira".to_string(),
                        slot: 0,
                        delete_time: 0,
                    },
                    ClientCharacterSummary {
                        guid: Guid(0x5000_0002),
                        name: "Nox".to_string(),
                        slot: 1,
                        delete_time: 123,
                    },
                ],
            }
        );

        client.state = ClientState::InWorld;
        client.world.player.guid = Guid(0x5000_0002);
        let snapshot = client.application_snapshot();
        assert_eq!(snapshot.lifecycle, ClientLifecycleState::InWorld);
        assert_eq!(snapshot.local_player_guid, Some(Guid(0x5000_0002)));
        assert_eq!(snapshot.world_generation, 0);
        assert!(snapshot.runtime_bodies.is_empty());
        assert_eq!(
            characters.len(),
            2,
            "selection source remains lossless in core"
        );
    }

    #[tokio::test]
    async fn authoritative_destination_completes_after_retail_presentation_grace() {
        let mut client = builder::build_test_client(ClientState::EnteringWorld);
        let player_guid = Guid(0x5000_0001);
        let destination = WorldPosition {
            landblock_id: Guid(0x0007_0219),
            coords: Vector3::new(160.0, -10.0, 12.01),
            rotation: Quaternion::identity(),
        };
        let accepted_at = Instant::now();
        client.requires_external_world_reveal = true;
        client
            .world
            .seed_local_player_entity(player_guid, "Player", destination);
        client.start_world_activation(ClientWorldActivationState::Teleport, player_guid);
        let activation = client
            .activation
            .as_mut()
            .expect("teleport should create an activation");
        activation.phase = ClientWorldActivationPhase::TeleportDestinationInstalled;

        client
            .try_complete_world_activation_at(accepted_at)
            .await
            .unwrap();
        assert!(client.activation.is_some());
        assert_eq!(client.session.bytes_out, 0);

        client
            .try_complete_world_activation_at(
                accepted_at + RETAIL_PORTAL_COMPLETION_GRACE - Duration::from_millis(1),
            )
            .await
            .unwrap();
        assert!(client.activation.is_some());
        assert_eq!(client.session.bytes_out, 0);

        client
            .try_complete_world_activation_at(accepted_at + RETAIL_PORTAL_COMPLETION_GRACE)
            .await
            .unwrap();

        assert!(client.activation.is_none());
        assert_eq!(client.state, ClientState::InWorld);
        assert!(client.session.bytes_out > 0);
    }

    #[tokio::test]
    async fn world_activation_retires_pre_portal_movement_epoch() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x5000_0001);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        client
            .world
            .seed_local_player_entity(player_guid, "Player", position);
        let started_at = Instant::now();
        let forward = movement_types::PlayerDriveIntent::ManualHeld(
            movement_types::CharacterDrive::builder()
                .run()
                .forward()
                .build(),
        );

        client.movement.enqueue_drive_intent(forward, started_at);
        client
            .movement
            .tick(started_at, &mut client.world, &mut client.session)
            .await
            .expect("pre-portal drive should become active");
        client
            .movement
            .enqueue_drive_intent(forward, started_at + Duration::from_millis(10));

        client.start_world_activation(ClientWorldActivationState::Teleport, player_guid);
        client
            .movement
            .tick(
                started_at + Duration::from_millis(30),
                &mut client.world,
                &mut client.session,
            )
            .await
            .expect("destination activation should leave movement idle");

        assert!(!client.movement.has_active_manual_drive());
        assert_eq!(
            client
                .movement
                .current_local_drive_control(&client.world, Duration::from_millis(30)),
            None
        );
    }

    #[tokio::test]
    async fn presentation_grace_never_completes_a_teleport_without_a_destination() {
        let mut client = builder::build_test_client(ClientState::EnteringWorld);
        let player_guid = Guid(0x5000_0001);
        let started_at = Instant::now();
        client
            .world
            .seed_local_player_entity(player_guid, "Player", WorldPosition::default());
        client.start_world_activation(ClientWorldActivationState::Teleport, player_guid);

        client
            .try_complete_world_activation_at(
                started_at + RETAIL_PORTAL_COMPLETION_GRACE + Duration::from_secs(60),
            )
            .await
            .unwrap();

        assert!(matches!(
            client
                .activation
                .as_ref()
                .map(|activation| activation.phase),
            Some(ClientWorldActivationPhase::TeleportAwaitingDestination)
        ));
        assert_eq!(client.session.bytes_out, 0);
    }

    fn test_remote_motion_catalog(motion_table_id: u32) -> MotionSequenceCatalog {
        jump_presentation_motion_catalog(motion_table_id)
    }

    #[test]
    fn remote_stop_and_landing_drive_initialized_idle_without_changing_placement() {
        let mut world = WorldState::synthetic();
        let remote_guid = Guid(0x0102_2201);
        let motion_table_id = 0x0900_0040;
        world.set_motion_sequences(jump_presentation_motion_catalog(motion_table_id));

        let mut remote = Entity::new(remote_guid, "Remote".to_owned(), WorldPosition::default());
        remote
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
        world.add_entity(remote);

        let run_events = world.handle_message(&encoded_game_message(GameMessage::UpdateMotion(
            Box::new(MovementEventData {
                guid: remote_guid,
                object_instance_sequence: 0,
                movement_sequence: 1,
                server_control_sequence: 0,
                is_autonomous: true,
                movement_type: MovementType::Invalid,
                motion_flags: 0,
                current_style: MotionStance::NonCombat.interpreted(),
                data: MovementTypeData::Invalid(MovementInvalid {
                    state: InterpretedMotionState {
                        flags: MovementStateFlags::CURRENT_STYLE
                            | MovementStateFlags::FORWARD_COMMAND,
                        current_style: Some(MotionStance::NonCombat.interpreted()),
                        forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
                        ..Default::default()
                    },
                    sticky_object: None,
                }),
            }),
        )));
        assert!(run_events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityMotionUpdated { guid, motion }
                if *guid == remote_guid
                    && motion.snapshot().is_some_and(|snapshot| {
                        snapshot.forward_command == Some(InterpretedMotionCommand::RUN_FORWARD)
                    })
        )));
        world.advance_authored_motion(Duration::from_millis(30));
        assert_eq!(
            world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_RUN_ANIMATION)
        );
        let pose_before_stop = world
            .entities
            .get(remote_guid)
            .expect("remote authority must remain registered")
            .position;

        world.handle_message(&encoded_game_message(GameMessage::UpdateMotion(Box::new(
            MovementEventData {
                guid: remote_guid,
                object_instance_sequence: 0,
                movement_sequence: 2,
                server_control_sequence: 0,
                is_autonomous: true,
                movement_type: MovementType::Invalid,
                motion_flags: 0,
                current_style: 0,
                data: MovementTypeData::Invalid(MovementInvalid::default()),
            },
        ))));
        world.advance_authored_motion(Duration::ZERO);
        assert_eq!(
            world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_STAND_ANIMATION),
            "an admitted empty update must retire the prior run cycle"
        );
        assert_eq!(
            world.entities.get(remote_guid).unwrap().position,
            pose_before_stop,
            "a clip-only stop must not reconstruct or move the runtime body"
        );

        world
            .drive_authored_motion_for_body(
                remote_guid,
                holtburger_world::motion::MotionOrder {
                    style: Some(holtburger_world::motion::MotionCommand(
                        MotionStance::NonCombat as u32,
                    )),
                    forward: Some((holtburger_world::motion::MotionCommand::FALLING, 1.0)),
                    ..Default::default()
                },
                Duration::from_millis(250),
            )
            .expect("fixture must model Falling");
        assert_eq!(
            world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_FALLING_ANIMATION),
            "fixture setup must reach the unsupported cycle before landing"
        );

        world.reconcile_authored_motion_support(
            remote_guid,
            holtburger_world::ContactState::Grounded,
        );
        assert_eq!(
            world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_LANDING_ANIMATION),
            "grounded support must actively retire Falling into authored landing"
        );

        world.advance_authored_motion(Duration::from_millis(30));
        assert_eq!(
            world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_STAND_ANIMATION),
            "initialized idle authority must complete landing into the stance default"
        );
    }

    #[test]
    fn remote_clip_only_stop_projects_as_a_path_stable_dynamic_update() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let remote_guid = Guid(0x0102_2202);
        let motion_table_id = 0x0900_0042;
        client
            .world
            .set_motion_sequences(jump_presentation_motion_catalog(motion_table_id));
        let mut remote = Entity::new(remote_guid, "Remote".to_owned(), WorldPosition::default());
        remote.wcid = Some(42);
        remote
            .properties
            .set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
        remote
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
        remote
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                PhysicsState::GRAVITY,
            ));
        client.world.add_entity(remote);
        client.world.scene.apply_authoritative_body_effect(
            holtburger_world::SpatialBodyId::Entity(remote_guid),
            holtburger_world::AuthoritativePoseEffect::Initialize {
                pose: WorldPosition::default(),
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            Instant::now(),
        );

        client
            .world
            .handle_message(&encoded_game_message(GameMessage::UpdateMotion(Box::new(
                MovementEventData {
                    guid: remote_guid,
                    object_instance_sequence: 0,
                    movement_sequence: 1,
                    server_control_sequence: 0,
                    is_autonomous: true,
                    movement_type: MovementType::Invalid,
                    motion_flags: 0,
                    current_style: MotionStance::NonCombat.interpreted(),
                    data: MovementTypeData::Invalid(MovementInvalid {
                        state: InterpretedMotionState {
                            flags: MovementStateFlags::CURRENT_STYLE
                                | MovementStateFlags::FORWARD_COMMAND,
                            current_style: Some(MotionStance::NonCombat.interpreted()),
                            forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
                            ..Default::default()
                        },
                        sticky_object: None,
                    }),
                },
            ))));
        client.world.advance_authored_motion(Duration::ZERO);
        let before = client.current_dynamic_entity_views();
        assert_eq!(
            before[0]
                .motion
                .map(crate::DynamicEntityMotion::animation_id),
            Some(JUMP_FIXTURE_RUN_ANIMATION)
        );

        client
            .world
            .handle_message(&encoded_game_message(GameMessage::UpdateMotion(Box::new(
                MovementEventData {
                    guid: remote_guid,
                    object_instance_sequence: 0,
                    movement_sequence: 2,
                    server_control_sequence: 0,
                    is_autonomous: true,
                    movement_type: MovementType::Invalid,
                    motion_flags: 0,
                    current_style: 0,
                    data: MovementTypeData::Invalid(MovementInvalid::default()),
                },
            ))));
        client.world.advance_authored_motion(Duration::ZERO);
        let after = client.current_dynamic_entity_views();
        assert_eq!(before[0].placement, after[0].placement);

        let event = client
            .dynamic_entity_tick_event(
                before,
                after,
                DynamicEntityHostTime::new(1.0).unwrap(),
                30.0,
                &Default::default(),
            )
            .expect("clip-only change must publish a path-stable update");
        let DynamicEntityEvent::Ticked { batch } = event else {
            panic!("expected a dynamic entity tick");
        };
        assert!(batch.advances.is_empty());
        assert_eq!(batch.updates.len(), 1);
        assert_eq!(
            batch.updates[0]
                .motion
                .map(crate::DynamicEntityMotion::animation_id),
            Some(JUMP_FIXTURE_STAND_ANIMATION)
        );
    }

    #[test]
    fn fixed_tick_remote_upward_vector_launches_once_and_selects_falling() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_2300);
        let remote_guid = Guid(0x0102_2301);
        let motion_table_id = 0x0900_0041;
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(48.0, 48.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let remote_pose = WorldPosition {
            coords: Vector3::new(52.0, 48.0, 0.0),
            ..player_pose
        };
        client
            .world
            .set_motion_sequences(jump_presentation_motion_catalog(motion_table_id));
        client
            .world
            .seed_local_player_entity(player_guid, "Player", player_pose);

        let mut remote = Entity::new(remote_guid, "Remote".to_string(), remote_pose);
        remote
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
        remote.acceleration = Vector3::new(0.0, 0.0, -9.8);
        client.world.add_entity(remote);
        let motion_events =
            client
                .world
                .handle_message(&encoded_game_message(GameMessage::UpdateMotion(Box::new(
                    MovementEventData {
                        guid: remote_guid,
                        object_instance_sequence: 0,
                        movement_sequence: 1,
                        server_control_sequence: 0,
                        is_autonomous: true,
                        movement_type: MovementType::Invalid,
                        motion_flags: 0,
                        current_style: MotionStance::NonCombat.interpreted(),
                        data: MovementTypeData::Invalid(MovementInvalid {
                            state: InterpretedMotionState {
                                flags: MovementStateFlags::CURRENT_STYLE
                                    | MovementStateFlags::FORWARD_COMMAND
                                    | MovementStateFlags::FORWARD_SPEED,
                                current_style: Some(MotionStance::NonCombat.interpreted()),
                                forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
                                forward_speed: Some(1.0),
                                ..Default::default()
                            },
                            sticky_object: None,
                        }),
                    },
                ))));
        assert!(motion_events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityMotionUpdated { guid, motion }
                if *guid == remote_guid
                    && motion.snapshot().is_some_and(|snapshot| {
                        snapshot.forward_command == Some(InterpretedMotionCommand::RUN_FORWARD)
                    })
        )));

        let body_id = holtburger_world::SpatialBodyId::Entity(remote_guid);
        client
            .world
            .scene
            .set_dynamic_physical_body(
                body_id,
                Some(stable_dynamic_body_definition()),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let interest = SimulationSceneInterest::prefetch_neighborhood(
            player_pose,
            CLIENT_COLLISION_OWNER_RADIUS,
        )
        .unwrap();
        let collision = collision_snapshot(
            interest.clone(),
            flat_collision_scene_for_interest(&interest),
        );
        let now = Instant::now();
        let dt = Duration::from_millis(PHYSICS_TICK_MS);
        simulation::tick(
            now,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        assert_eq!(
            client.world.scene.body(body_id).unwrap().contact,
            holtburger_world::ContactState::Grounded
        );

        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_RUN_ANIMATION)
        );

        let jump_velocity = Vector3::new(2.0, 1.0, 5.0);
        let jump_update =
            encoded_game_message(GameMessage::VectorUpdate(Box::new(VectorUpdateData {
                guid: remote_guid,
                velocity: jump_velocity,
                omega: Vector3::zero(),
                instance_sequence: 0,
                vector_sequence: 1,
            })));
        let jump_events = client.world.handle_message(&jump_update);
        assert!(jump_events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, velocity, .. }
                if *guid == remote_guid && *velocity == jump_velocity
        )));
        let ignored_duplicate =
            client
                .world
                .handle_message(&encoded_game_message(GameMessage::VectorUpdate(Box::new(
                    VectorUpdateData {
                        guid: remote_guid,
                        velocity: Vector3::new(99.0, 99.0, 99.0),
                        omega: Vector3::zero(),
                        instance_sequence: 0,
                        vector_sequence: 1,
                    },
                ))));
        assert!(ignored_duplicate.is_empty());
        assert_eq!(
            client.world.entities.get(remote_guid).unwrap().velocity,
            jump_velocity
        );
        assert_eq!(
            client.world.scene.body(body_id).unwrap().retained.velocity,
            jump_velocity
        );
        assert_eq!(
            client.world.entities.get(remote_guid).unwrap().acceleration,
            Vector3::new(0.0, 0.0, -9.8)
        );
        assert_eq!(
            client
                .world
                .resolve_body_projection_input(body_id)
                .unwrap()
                .retained,
            holtburger_world::RetainedBodyKinematics {
                velocity: jump_velocity,
                acceleration: Vector3::new(0.0, 0.0, -9.8),
                omega: Vector3::zero(),
            }
        );

        simulation::tick(
            now + dt,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        let launched = client.world.scene.body(body_id).unwrap().clone();
        assert_eq!(launched.contact, holtburger_world::ContactState::Airborne);
        assert!(launched.pose.coords.z > remote_pose.coords.z);
        assert!(launched.retained.velocity.z > 0.0);
        assert!(launched.retained.velocity.z < jump_velocity.z);
        assert_eq!(
            client
                .world
                .motion_runtimes
                .state(remote_guid)
                .unwrap()
                .substate,
            holtburger_world::motion::MotionCommand::FALLING
        );
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_TAKEOFF_ANIMATION),
            "the observer must enter the table-authored takeoff transition independently from its arc"
        );

        let duplicate_after_integration =
            client
                .world
                .handle_message(&encoded_game_message(GameMessage::VectorUpdate(Box::new(
                    VectorUpdateData {
                        guid: remote_guid,
                        velocity: jump_velocity,
                        omega: Vector3::zero(),
                        instance_sequence: 0,
                        vector_sequence: 1,
                    },
                ))));
        assert!(duplicate_after_integration.is_empty());
        assert_eq!(
            client.world.scene.body(body_id).unwrap().retained.velocity,
            launched.retained.velocity,
            "a duplicate observer packet must not reset gravity-integrated velocity"
        );
        for rejected in [
            VectorUpdateData {
                guid: remote_guid,
                velocity: Vector3::new(88.0, 88.0, 88.0),
                omega: Vector3::zero(),
                instance_sequence: 0,
                vector_sequence: 0,
            },
            VectorUpdateData {
                guid: remote_guid,
                velocity: Vector3::new(77.0, 77.0, 77.0),
                omega: Vector3::zero(),
                instance_sequence: 1,
                vector_sequence: 2,
            },
        ] {
            assert!(
                client
                    .world
                    .handle_message(&encoded_game_message(GameMessage::VectorUpdate(Box::new(
                        rejected,
                    ))))
                    .is_empty(),
                "stale or wrong-instance vector samples must be handled without mutation"
            );
        }
        assert_eq!(
            client.world.scene.body(body_id).unwrap().retained.velocity,
            launched.retained.velocity
        );

        simulation::tick(
            now + dt + dt,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        let continued = client.world.scene.body(body_id).unwrap();
        assert_eq!(continued.contact, holtburger_world::ContactState::Airborne);
        assert!(continued.pose.coords.z > launched.pose.coords.z);
        assert!(continued.retained.velocity.z < launched.retained.velocity.z);
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_TAKEOFF_ANIMATION)
        );

        let mut falling_step = None;
        for step in 3..=20 {
            simulation::tick(
                now + dt * step,
                dt,
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            if client
                .world
                .motion_runtimes
                .playing_clip(remote_guid)
                .is_some_and(|clip| clip.animation_id == JUMP_FIXTURE_FALLING_ANIMATION)
            {
                assert_eq!(
                    client.world.scene.body(body_id).unwrap().contact,
                    holtburger_world::ContactState::Airborne,
                    "the Falling clip must be observed during the physical arc"
                );
                falling_step = Some(step);
                break;
            }
        }
        let falling_step = falling_step.expect("takeoff must advance into the Falling cycle");
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_FALLING_ANIMATION),
            "the observer must visibly play Falling instead of sliding in its run cycle"
        );

        let mut landed = false;
        let mut landing_step = 0;
        for step in (falling_step + 1)..=240 {
            simulation::tick(
                now + dt * step,
                dt,
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
            if client.world.scene.body(body_id).unwrap().contact
                == holtburger_world::ContactState::Grounded
            {
                landed = true;
                landing_step = step;
                break;
            }
        }
        assert!(landed, "remote jump should return to flat support");
        assert_eq!(
            client
                .world
                .motion_runtimes
                .state(remote_guid)
                .unwrap()
                .substate,
            holtburger_world::motion::MotionCommand::RUN_FORWARD,
            "remote landing should restore the server-authored locomotion snapshot"
        );
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_LANDING_ANIMATION),
            "remote support recovery must start the authored landing transition"
        );
        simulation::tick(
            now + dt * (landing_step + 1),
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_RUN_ANIMATION),
            "the authored landing transition must complete into the server's held run"
        );

        client
            .world
            .handle_message(&encoded_game_message(GameMessage::UpdateMotion(Box::new(
                MovementEventData {
                    guid: remote_guid,
                    object_instance_sequence: 0,
                    movement_sequence: 2,
                    server_control_sequence: 0,
                    is_autonomous: true,
                    movement_type: MovementType::Invalid,
                    motion_flags: 0,
                    current_style: 0,
                    data: MovementTypeData::Invalid(MovementInvalid::default()),
                },
            ))));
        client.world.advance_authored_motion(Duration::ZERO);
        assert_eq!(
            client
                .world
                .motion_runtimes
                .playing_clip(remote_guid)
                .map(|clip| clip.animation_id),
            Some(JUMP_FIXTURE_STAND_ANIMATION),
            "the next launch must begin from initialized style-zero idle authority"
        );

        let correction_start = now + dt * (landing_step + 2);
        let second_jump_velocity = Vector3::new(-1.0, 2.0, 4.0);
        let second_jump_events =
            client
                .world
                .handle_message(&encoded_game_message(GameMessage::VectorUpdate(Box::new(
                    VectorUpdateData {
                        guid: remote_guid,
                        velocity: second_jump_velocity,
                        omega: Vector3::zero(),
                        instance_sequence: 0,
                        vector_sequence: 2,
                    },
                ))));
        assert!(second_jump_events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, velocity, .. }
                if *guid == remote_guid && *velocity == second_jump_velocity
        )));
        simulation::tick(
            correction_start,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        assert_eq!(
            client.world.scene.body(body_id).unwrap().contact,
            holtburger_world::ContactState::Airborne
        );

        let airborne_before_stop = client.world.scene.body(body_id).unwrap().retained.velocity;
        let stop_events =
            client
                .world
                .handle_message(&encoded_game_message(GameMessage::UpdateMotion(Box::new(
                    MovementEventData {
                        guid: remote_guid,
                        object_instance_sequence: 0,
                        movement_sequence: 3,
                        server_control_sequence: 0,
                        is_autonomous: true,
                        movement_type: MovementType::Invalid,
                        motion_flags: 0,
                        current_style: 0,
                        data: MovementTypeData::Invalid(MovementInvalid::default()),
                    },
                ))));
        assert!(
            stop_events.is_empty(),
            "repeating the retained idle order must not restart playback"
        );
        assert!(
            client
                .world
                .entities
                .get(remote_guid)
                .and_then(|entity| entity.network_motion.snapshot())
                .is_some_and(|snapshot| {
                    snapshot.current_style == Some(MotionStance::NonCombat)
                        && snapshot.motion_command().is_none()
                })
        );
        assert_eq!(
            client.world.scene.body(body_id).unwrap().retained.velocity,
            airborne_before_stop,
            "an airborne stop changes future grounded presentation, not committed ballistics"
        );

        let corrected_pose = WorldPosition {
            coords: Vector3::new(54.0, 48.0, 0.0),
            ..remote_pose
        };
        let correction_events =
            client
                .world
                .handle_message(&encoded_game_message(GameMessage::UpdatePosition(
                    Box::new(UpdatePositionData {
                        guid: remote_guid,
                        pos: PositionPack {
                            flags: UpdatePositionFlag::HAS_CONTACT,
                            pos: corrected_pose,
                            instance_sequence: 0,
                            position_sequence: 1,
                            teleport_sequence: 1,
                            force_position_sequence: 0,
                            ..PositionPack::default()
                        },
                    }),
                )));
        assert!(correction_events.iter().any(|event| matches!(
            event,
            WorldEvent::ForcedReposition { guid, pos, .. }
                if *guid == remote_guid && *pos == corrected_pose
        )));
        let corrected = client.world.scene.body(body_id).unwrap();
        assert_eq!(corrected.pose, corrected_pose);
        assert_eq!(corrected.retained.velocity, Vector3::zero());
        // Contact is a solver product. The reset clears the launch immediately, while the next
        // collision tick reclassifies support at the corrected pose.

        simulation::tick(
            correction_start + dt,
            dt,
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .unwrap();
        let settled_correction = client.world.scene.body(body_id).unwrap();
        assert_eq!(
            settled_correction.contact,
            holtburger_world::ContactState::Grounded
        );
        assert_eq!(settled_correction.pose.coords.z, corrected_pose.coords.z);
        assert_eq!(settled_correction.retained.velocity.x, 0.0);
        assert_eq!(settled_correction.retained.velocity.y, 0.0);
        assert!(
            settled_correction.retained.velocity.z <= 0.0,
            "support solve may retain its gravity sample but must not resurrect upward launch"
        );
    }

    #[test]
    fn busy_operation_timeout_clears_state_and_emits_completion() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let mut events = client.subscribe_client_view_events();

        assert!(client.arm_busy_operation(BusyOperationKind::Buy));
        client.poll_busy_timeout(Instant::now() + BUSY_OPERATION_TIMEOUT + Duration::from_secs(1));

        assert!(client.active_busy_operation.is_none());

        let mut saw_busy_clear = false;
        let mut saw_timeout = false;
        while let Ok(event) = events.try_recv() {
            match event {
                ClientViewEvent::BusyStateUpdated { busy: None } => saw_busy_clear = true,
                ClientViewEvent::BusyOperationFinished {
                    operation: BusyOperationKind::Buy,
                    result: BusyOperationResult::TimedOut,
                } => saw_timeout = true,
                _ => {}
            }
        }

        assert!(saw_busy_clear);
        assert!(saw_timeout);
    }

    #[test]
    fn arm_busy_operation_rejects_overlap_and_preserves_original_pending_state() {
        let mut client = builder::build_test_client(ClientState::Connected);

        assert!(client.arm_busy_operation(BusyOperationKind::Buy));
        assert!(!client.arm_busy_operation(BusyOperationKind::Sell));

        assert!(matches!(
            client.active_busy_operation,
            Some(PendingBusyOperation {
                operation: BusyOperationKind::Buy,
                ..
            })
        ));
    }

    #[test]
    fn fellowship_activity_is_only_projected_after_entering_world() {
        let client = builder::build_test_client(ClientState::EnteringWorld);
        let mut events = client.subscribe_client_view_events();

        client.handle_world_event(&WorldEvent::FellowshipActivity(
            FellowshipActivity::MemberJoined {
                member_name: "Bravo".to_string(),
            },
        ));

        assert!(events.try_recv().is_err());
    }

    #[test]
    fn fellowship_activity_projects_when_in_world() {
        let client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();

        client.handle_world_event(&WorldEvent::FellowshipActivity(
            FellowshipActivity::MemberLeft {
                member_name: "Bravo".to_string(),
            },
        ));

        let mut saw_activity = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::FellowshipActivity {
                    activity: FellowshipActivity::MemberLeft { member_name }
                } if member_name == "Bravo"
            ) {
                saw_activity = true;
                break;
            }
        }

        assert!(saw_activity);
    }

    #[test]
    fn inventory_server_save_failed_projection_preserves_item_guid() {
        let client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let item_guid = Guid(0x4000_0001);

        client.emit_action_result(
            ActionResultSource::Wire,
            ActionResultReason::InventoryServerSaveFailed {
                item_guid,
                error: holtburger_protocol::errors::WeenieError::YoureTooBusy,
            },
        );

        let mut saw_projected_event = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::ActionResult {
                source: ActionResultSource::Wire,
                reason:
                    ActionResultReason::InventoryServerSaveFailed {
                        item_guid: projected_item_guid,
                        error,
                    },
            } = event
            {
                assert_eq!(projected_item_guid, item_guid);
                assert_eq!(
                    error,
                    holtburger_protocol::errors::WeenieError::YoureTooBusy
                );
                saw_projected_event = true;
                break;
            }
        }

        assert!(saw_projected_event);
    }

    #[test]
    fn entity_vector_updates_project_to_client_view_kinematics() {
        let client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let guid = Guid(0x5000_0001);
        let velocity = Vector3::new(1.0, 2.0, 3.0);
        let omega = Vector3::new(0.0, 0.0, 4.0);

        client.handle_world_event(&WorldEvent::EntityVectorUpdated {
            guid,
            velocity,
            omega,
        });

        let mut saw_kinematics = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::EntityKinematicsUpdated {
                    guid: event_guid,
                    velocity: event_velocity,
                    omega: event_omega,
                } if event_guid == guid && event_velocity == velocity && event_omega == omega
            ) {
                saw_kinematics = true;
                break;
            }
        }

        assert!(saw_kinematics);
    }

    #[test]
    fn player_entity_projection_emits_self_movement_kinematics_update() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let player_guid = Guid(0x5000_0001);
        let capabilities = test_self_movement_capabilities(4.5, 1.0, 2.0, 1.5);
        let expected_kinematics = capabilities.kinematics().clone();

        client.world.player.guid = player_guid;
        client
            .world
            .set_self_movement_capabilities_override(capabilities.clone());

        client.handle_world_event(&WorldEvent::EntitySpawned(Box::new(Entity::new(
            player_guid,
            "Player".to_string(),
            WorldPosition::default(),
        ))));

        let mut saw_kinematics = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::SelfMovementKinematicsUpdated {
                    kinematics: Some(event_kinematics)
                } if event_kinematics == expected_kinematics
            ) {
                saw_kinematics = true;
                break;
            }
        }

        assert!(saw_kinematics);
    }

    #[test]
    fn player_entity_projection_emits_empty_self_movement_kinematics_when_resolution_fails() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let player_guid = Guid(0x5000_0001);

        client.world.player.guid = player_guid;

        client.handle_world_event(&WorldEvent::EntitySpawned(Box::new(Entity::new(
            player_guid,
            "Player".to_string(),
            WorldPosition::default(),
        ))));

        let mut saw_kinematics_none = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::SelfMovementKinematicsUpdated { kinematics: None } = event {
                saw_kinematics_none = true;
            }
        }

        assert!(saw_kinematics_none);
    }

    #[test]
    fn repeated_self_movement_capability_failures_do_not_emit_client_errors() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let player_guid = Guid(0x5000_0001);

        client.world.player.guid = player_guid;

        let entity = Box::new(Entity::new(
            player_guid,
            "Player".to_string(),
            WorldPosition::default(),
        ));
        client.handle_world_event(&WorldEvent::EntitySpawned(entity.clone()));
        client.handle_world_event(&WorldEvent::EntityReplaced(entity));

        while let Ok(event) = events.try_recv() {
            assert!(!matches!(event, ClientViewEvent::ActionResult { .. }));
        }
    }

    #[test]
    fn sync_server_time_updates_world_state_and_emits_client_view_event() {
        let mut client = builder::build_test_client(ClientState::EnteringWorld);
        let mut events = client.subscribe_client_view_events();
        let synced_at = Instant::now();
        let server_time = 289_184_283.365_664_66;

        client.sync_server_time(server_time, synced_at);

        let sync = client
            .world
            .server_time
            .as_ref()
            .expect("server time should be recorded");
        assert_eq!(sync.server_time, server_time);
        assert_eq!(sync.local_time, synced_at);

        let mut saw_event = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ClientViewEvent::ServerTimeUpdated { time } if time == server_time) {
                saw_event = true;
                break;
            }
        }

        assert!(saw_event);
    }

    #[test]
    fn simulation_build_projection_returns_none_without_projectable_remote() {
        let client = builder::build_test_client(ClientState::InWorld);

        let request = simulation::build_projection_request(&client.world);

        assert!(request.is_none());
    }

    #[tokio::test]
    async fn simulation_build_projection_carries_active_autonomous_drive() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        client
            .world
            .seed_local_player_entity(guid, "Player", player_pose);

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::Autonomous(movement_types::AutonomousDriveIntent {
                desired_world_delta: Vector3::new(3.0, 4.0, 0.0),
                desired_heading: Some(1.5),
                target_hint: Some(WorldPosition {
                    landblock_id: Guid(0x1000_0100),
                    coords: Vector3::new(30.0, 40.0, 0.0),
                    rotation: Quaternion::identity(),
                }),
                gait: movement_types::Gait::Run,
                force_grounded: true,
            }),
            now,
        );

        client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should activate autonomous drive for the current frame");

        let local_drive = client
            .movement
            .current_local_drive_control(&client.world, Duration::from_millis(PHYSICS_TICK_MS))
            .expect("active autonomous drive should remain a movement-owned actuation input");
        assert_eq!(
            local_drive.body_id,
            holtburger_world::SpatialBodyId::LocalPlayer(guid)
        );
        assert_eq!(local_drive.desired_world_delta, Vector3::new(3.0, 4.0, 0.0));
        assert_eq!(local_drive.desired_heading, Some(1.5));
        assert_eq!(
            local_drive.gait,
            holtburger_world::spatial::LocalDriveGait::Run
        );
        assert!(local_drive.force_grounded);
    }

    #[tokio::test]
    async fn simulation_build_projection_discovers_nearby_actor() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        seed_test_self_movement_capabilities(&mut client);

        client
            .world
            .seed_local_player_entity(player_guid, "Player", player_pose);
        client.world.add_entity(Entity::new(
            remote_guid,
            "Remote".to_string(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: holtburger_common::Vector3::new(8.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        ));
        let remote = client
            .world
            .entities
            .get_mut(remote_guid)
            .expect("remote entity should exist");
        remote.velocity = holtburger_common::Vector3::new(1.0, 0.0, 0.0);

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::CharacterDrive::builder()
                    .run()
                    .forward()
                    .build(),
            ),
            now,
        );

        let _ = client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should succeed");

        let request = simulation::build_projection_request(&client.world)
            .expect("nearby actor should join the solve set");

        assert_eq!(request.bodies.len(), 1);
        assert!(
            request
                .bodies
                .iter()
                .any(|body| body.body_id == holtburger_world::SpatialBodyId::Entity(remote_guid))
        );
    }

    #[test]
    fn simulation_build_projection_discovers_grounded_actor_without_vector_update() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_1304);
        let remote_guid = Guid(0x0102_1305);
        let motion_table_id = 0x0900_0040;

        client
            .world
            .set_motion_sequences(test_remote_motion_catalog(motion_table_id));
        client.world.seed_local_player_entity(
            player_guid,
            "Player",
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );

        let mut remote = Entity::new(
            remote_guid,
            "Remote".to_string(),
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::new(8.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        remote
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
        remote.network_motion = EntityNetworkMotion::Initialized(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
            sidestep_command: None,
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            forward_speed: OrderedMotionScalar::from_f32(3.5),
            sidestep_speed: None,
            turn_speed: OrderedMotionScalar::from_f32(0.75),
            directive: None,
        });
        client.world.add_entity(remote);

        let dt = Duration::from_millis(PHYSICS_TICK_MS);
        client.world.advance_authored_motion(dt);
        let request = simulation::build_projection_request(&client.world)
            .expect("grounded remote should join the solve set");

        let remote_body = request
            .bodies
            .iter()
            .find(|body| body.body_id == holtburger_world::SpatialBodyId::Entity(remote_guid))
            .expect("grounded remote should be present");

        assert!(
            remote_body.authored_offset.is_some(),
            "a grounded remote performing a motion drives from its authored offset"
        );
    }

    #[tokio::test]
    async fn simulation_tick_leaves_a_pose_only_local_player_authoritative() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        seed_test_self_movement_capabilities(&mut client);

        client
            .world
            .seed_local_player_entity(guid, "Player", player_pose);

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::CharacterDrive::builder()
                    .run()
                    .forward()
                    .build(),
            ),
            now,
        );

        let _ = client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should succeed");

        let events = simulation::tick(
            now,
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            None,
        )
        .expect("pose-only simulation should not fail");

        let authoritative_pose = client
            .world
            .player_position()
            .expect("local player entity should exist");
        assert_eq!(authoritative_pose.landblock_id, Guid(0x1000_0001));
        assert!(authoritative_pose.coords.y.abs() <= f32::EPSILON);
        let body = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::LocalPlayer(guid))
            .expect("local player runtime body should exist after solve");
        assert_eq!(body.pose, player_pose);
        assert!(!events.events.iter().any(|event| matches!(
            event,
            WorldEvent::RuntimeBodyChanged {
                body_id: holtburger_world::SpatialBodyId::LocalPlayer(_)
            }
        )));
    }

    #[tokio::test]
    async fn simulation_tick_uses_the_installed_scene_snapshot_for_local_transaction() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        client
            .world
            .seed_local_player_entity(guid, "Player", player_pose);
        let definition = PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(
                holtburger_common::Sphere {
                    center: Vector3::zero(),
                    radius: 0.5,
                },
                None,
            )
            .expect("test sphere should be valid"),
            FreeSphereConfig {
                maximum_substep_distance: 0.25,
                maximum_substeps: 32,
                maximum_contact_passes: 8,
                separation_epsilon: 0.0005,
            },
        )
        .expect("test physical definition should be valid");
        let body_id = holtburger_world::SpatialBodyId::LocalPlayer(guid);
        client
            .world
            .scene
            .set_dynamic_physical_body(
                body_id,
                Some(dynamic_definition(
                    definition,
                    PhysicalBodyResponsePolicy {
                        restitution: PhysicalRestitution::Inelastic,
                        friction: PhysicalFriction::DEFAULT,
                        surface_motion: PhysicalSurfaceMotion::Stable,
                        align_path: false,
                    },
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .expect("seeded local player should have a canonical body");

        let interest = SimulationSceneInterest::prefetch_neighborhood(
            player_pose,
            CLIENT_COLLISION_OWNER_RADIUS,
        )
        .expect("non-null player residency should demand collision");
        let scene = collision_scene_for_interest(&interest);
        let collision = collision_snapshot(interest, scene);

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::Autonomous(movement_types::AutonomousDriveIntent {
                desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
                desired_heading: Some(0.0),
                target_hint: None,
                gait: movement_types::Gait::Run,
                force_grounded: true,
            }),
            now,
        );
        client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should activate the autonomous drive");

        let events = simulation::tick(
            now,
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            Some(&collision),
        )
        .expect("ready collision products should permit the local transaction");

        let body = client
            .world
            .scene
            .body(body_id)
            .expect("local player body should remain registered");
        assert!(body.pose.coords.x > player_pose.coords.x);
        assert_eq!(
            client
                .world
                .player_position()
                .expect("authoritative player pose should remain available"),
            player_pose
        );
        assert!(events.events.iter().any(|event| matches!(
            event,
            WorldEvent::RuntimeBodyAdvanced {
                body_id: event_id,
                ..
            } if *event_id == body_id
        )));
    }

    #[tokio::test]
    async fn simulation_tick_advances_remote_projection_while_local_player_is_suspended() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        seed_test_self_movement_capabilities(&mut client);

        client
            .world
            .seed_local_player_entity(player_guid, "Player", player_pose);
        client.world.add_entity(Entity::new(
            remote_guid,
            "Remote".to_string(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: holtburger_common::Vector3::new(8.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        ));
        let remote_start = client
            .world
            .entities
            .get(remote_guid)
            .expect("remote entity should exist before solve")
            .position
            .coords;
        let mut remote = Entity::new(
            remote_guid,
            "Remote".to_string(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: holtburger_common::Vector3::new(8.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        remote.velocity = holtburger_common::Vector3::new(2.0, 0.0, 0.0);
        remote.wcid = Some(1);
        remote
            .properties
            .set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
        remote
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                PhysicsState::STATIC,
            ));
        client.world.remove_entity(remote_guid);
        client.world.add_entity(remote);

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::CharacterDrive::builder()
                    .run()
                    .forward()
                    .build(),
            ),
            now,
        );

        let _ = client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should succeed");

        let events = simulation::tick(
            now,
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
            None,
        )
        .expect("pose-only simulation should not fail");

        let remote_after = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::Entity(remote_guid))
            .expect("remote body should still exist after solve");
        let player_body = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::LocalPlayer(player_guid))
            .expect("local player runtime body should exist after solve");
        assert_eq!(player_body.pose, player_pose);
        assert!(remote_after.pose.coords.x > remote_start.x);
        assert!(!events.events.iter().any(|event| matches!(
            event,
            WorldEvent::RuntimeBodyChanged {
                body_id: holtburger_world::SpatialBodyId::LocalPlayer(_)
            }
        )));
        assert!(events.events.iter().any(|event| matches!(
            event,
            WorldEvent::RuntimeBodyAdvanced {
                body_id: holtburger_world::SpatialBodyId::Entity(event_guid),
                ..
            } if *event_guid == remote_guid
        )));
    }

    #[tokio::test]
    async fn prepared_remote_body_lands_on_terrain_instead_of_dead_reckoning_through_it() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);
        let pose = |z| WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(48.0, 48.0, z),
            rotation: Quaternion::identity(),
        };
        client
            .world
            .seed_local_player_entity(player_guid, "Player", pose(2.0));
        let mut remote = Entity::new(remote_guid, "Remote".to_owned(), pose(2.0));
        remote.velocity = Vector3::new(0.0, 0.0, -0.8);
        remote.acceleration = Vector3::new(0.0, 0.0, -9.8);
        client.world.add_entity(remote);

        let movement = PhysicalBodyDefinition::grounded(
            PhysicalSphereSet::new(
                holtburger_common::Sphere {
                    center: Vector3::new(0.0, 0.0, 0.5),
                    radius: 0.5,
                },
                None,
            )
            .unwrap(),
            GroundedConfig {
                gravity: -9.8,
                walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
                landing_normal_z: RETAIL_LANDING_NORMAL_Z,
                airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
                step_up_height: 0.6,
                step_down_height: 1.5,
                edge_protection: EdgeProtection::Creature,
                maximum_substep_distance: 0.24,
                maximum_substeps: 32,
                maximum_contact_passes: 8,
                separation_epsilon: 0.0005,
            },
        )
        .unwrap();
        let body_id = holtburger_world::SpatialBodyId::Entity(remote_guid);
        client
            .world
            .scene
            .set_dynamic_physical_body(
                body_id,
                Some(dynamic_definition(
                    movement,
                    PhysicalBodyResponsePolicy {
                        restitution: PhysicalRestitution::Inelastic,
                        friction: PhysicalFriction::DEFAULT,
                        surface_motion: PhysicalSurfaceMotion::Stable,
                        align_path: false,
                    },
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let interest = SimulationSceneInterest::prefetch_neighborhood(
            pose(2.0),
            CLIENT_COLLISION_OWNER_RADIUS,
        )
        .unwrap();
        let collision = collision_snapshot(
            interest.clone(),
            flat_collision_scene_for_interest(&interest),
        );
        let dt = Duration::from_millis(PHYSICS_TICK_MS);
        let started_at = Instant::now();
        for tick in 1..=50 {
            simulation::tick(
                started_at + dt * tick,
                dt,
                &mut client.world,
                &mut client.movement,
                Some(&collision),
            )
            .unwrap();
        }

        let landed = client.world.scene.body(body_id).unwrap();
        assert_eq!(landed.contact, holtburger_world::ContactState::Grounded);
        assert!(
            landed.pose.coords.z >= -0.001,
            "remote fell below terrain: {landed:?}"
        );
    }

    #[test]
    fn direct_projection_discovery_sees_remote_vector_changes() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);

        client.world.seed_local_player_entity(
            player_guid,
            "Player",
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );
        let mut remote = Entity::new(
            remote_guid,
            "Remote".to_string(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: holtburger_common::Vector3::new(12.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        remote.velocity = holtburger_common::Vector3::new(1.0, 0.0, 0.0);
        client.world.add_entity(remote);

        let runtime_events =
            client
                .world
                .apply_solved_body_kinematics(&holtburger_world::SolvedBodyKinematics {
                    body_id: holtburger_world::SpatialBodyId::Entity(remote_guid),
                    pose: holtburger_common::position::WorldPosition {
                        landblock_id: Guid(0x1000_0001),
                        coords: holtburger_common::Vector3::new(12.5, 0.0, 0.0),
                        rotation: Quaternion::identity(),
                    },
                    accepted_motion: holtburger_world::AcceptedBodyMotion::default(),
                    retained: holtburger_world::RetainedBodyKinematics {
                        velocity: holtburger_common::Vector3::new(1.0, 0.0, 0.0),
                        ..Default::default()
                    },
                    contact: holtburger_world::ContactState::Grounded,
                    projection_state: None,
                });
        assert!(!runtime_events.is_empty());

        let request = simulation::build_projection_request(&client.world);

        assert!(request.is_some());
        assert!(
            request
                .expect("remote mover should produce a solve request")
                .bodies
                .iter()
                .any(|body| body.body_id == holtburger_world::SpatialBodyId::Entity(remote_guid))
        );
    }

    #[test]
    fn direct_projection_discovery_sees_grounded_authored_motion() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_2304);
        let remote_guid = Guid(0x0102_2305);
        let motion_table_id = 0x0900_0050;

        client
            .world
            .set_motion_sequences(test_remote_motion_catalog(motion_table_id));
        client.world.seed_local_player_entity(
            player_guid,
            "Player",
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );

        let mut remote = Entity::new(
            remote_guid,
            "Remote".to_string(),
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::new(12.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        remote
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
        remote.network_motion = EntityNetworkMotion::Initialized(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
            sidestep_command: None,
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            forward_speed: OrderedMotionScalar::from_f32(3.5),
            sidestep_speed: None,
            turn_speed: OrderedMotionScalar::from_f32(0.75),
            directive: None,
        });
        client.world.add_entity(remote.clone());

        let dt = Duration::from_millis(PHYSICS_TICK_MS);
        client.world.advance_authored_motion(dt);
        let request = simulation::build_projection_request(&client.world);

        assert!(request.is_some());
        assert!(
            request
                .expect("grounded remote should produce a solve request")
                .bodies
                .iter()
                .any(|body| body.body_id == holtburger_world::SpatialBodyId::Entity(remote_guid))
        );
    }
}
