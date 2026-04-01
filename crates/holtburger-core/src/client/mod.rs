use anyhow::Result;
use holtburger_protocol::errors::WeenieError;
use holtburger_session::Session;
use holtburger_world::{WorldEvent, WorldState};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

mod auth;
mod builder;
mod commands;
pub mod controllers;
mod messages;
mod movement;
pub mod movement_types;
pub mod runtime_body_view_cache;
mod simulation;
pub mod types;
use auth::AuthState;
pub use builder::ClientBuilder;
use movement::MovementSystem;
use simulation::ClientSimulationSystem;
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

pub struct Client {
    pub session: Session,
    pub world: WorldState,
    active_confirmation: Option<ActiveCharacterConfirmation>,
    active_busy_operation: Option<PendingBusyOperation>,
    state: ClientState,
    wire_event_tx: broadcast::Sender<WireEvent>,
    client_view_event_tx: broadcast::Sender<ClientViewEvent>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    pub message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
    movement: MovementSystem,
    simulation: ClientSimulationSystem,
    auth: AuthState,
    turbine_chat: TurbineChatState,
}

impl Client {
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

    fn poll_busy_timeout(&mut self, now: Instant) {
        let Some(pending) = self.active_busy_operation.as_ref() else {
            return;
        };

        if now < pending.deadline {
            return;
        }

        let pending = self
            .active_busy_operation
            .take()
            .expect("busy operation should still exist when timing out");
        self.emit_busy_state_updated();
        self.emit_busy_operation_finished(pending.operation, BusyOperationResult::TimedOut);
    }

    fn emit_spell_catalog_loaded(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SpellCatalogLoaded {
                catalog: self.world.spell_catalog.clone(),
            });
    }

    fn emit_fellowship_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::FellowshipStateUpdated {
                fellowship: self.world.fellowship.clone(),
            });
    }

    fn emit_runtime_body_snapshot(&self) {
        let bodies: Arc<[_]> = self.world.runtime_body_views().into();
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::RuntimeBodySnapshot { bodies });
    }

    fn emit_initial_reference_data(&self) {
        self.emit_spell_catalog_loaded();
        self.emit_fellowship_state_updated();
        self.emit_runtime_body_snapshot();
    }

    pub fn subscribe_wire_events(&self) -> broadcast::Receiver<WireEvent> {
        self.wire_event_tx.subscribe()
    }

    pub fn subscribe_client_view_events(&self) -> broadcast::Receiver<ClientViewEvent> {
        self.client_view_event_tx.subscribe()
    }

    pub fn set_command_rx(&mut self, rx: mpsc::UnboundedReceiver<ClientCommand>) {
        self.command_rx = Some(rx);
    }

    fn send_status_event(&self) {
        self.emit_wire_event(WireEvent::StatusUpdate {
            state: self.state.clone(),
        });
    }

    pub fn emit_wire_event(&self, event: WireEvent) {
        // New ClientView stream projection (normalization)
        match &event {
            WireEvent::StatusUpdate { state } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::StatusUpdate {
                        state: state.clone(),
                    });
            }
            WireEvent::InventoryServerSaveFailed { item_guid, error } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ErrorRaised {
                        source: ErrorSource::Wire,
                        reason: ErrorReason::Weenie(*error, None),
                        message: format!(
                            "Inventory save failed for 0x{:08X}: {:?}",
                            item_guid.0, error
                        ),
                    });
            }
            WireEvent::WeenieError { error, parameter } => {
                let message = crate::errors::format_weenie_error(*error, parameter.as_deref());
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ErrorRaised {
                        source: ErrorSource::Wire,
                        reason: ErrorReason::Weenie(*error, parameter.clone()),
                        message,
                    });
            }
            WireEvent::CharacterError(err) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ErrorRaised {
                        source: ErrorSource::Wire,
                        reason: ErrorReason::Character(*err),
                        message: format!("Character error: {:?}", err),
                    });
            }
            WireEvent::ClientError(msg) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ErrorRaised {
                        source: ErrorSource::Client,
                        reason: ErrorReason::General(msg.clone()),
                        message: msg.clone(),
                    });
            }
            WireEvent::UseDone { error } if *error != WeenieError::None => {
                let message = crate::errors::format_weenie_error(*error, None);
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ErrorRaised {
                        source: ErrorSource::Wire,
                        reason: ErrorReason::Weenie(*error, None),
                        message,
                    });
            }
            WireEvent::CombatFeedback(feedback) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CombatFeedback(feedback.clone()));
            }
            WireEvent::ServerMessage { message, chat_type } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ServerMessage {
                        message: message.clone(),
                        chat_type: *chat_type,
                    });
            }
            WireEvent::Chat { sender, message } => {
                let _ = self.client_view_event_tx.send(ClientViewEvent::Chat {
                    sender: sender.clone(),
                    message: message.clone(),
                });
            }
            WireEvent::ChannelMessage {
                channel,
                sender,
                message,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ChannelMessage {
                        channel: *channel,
                        sender: sender.clone(),
                        message: message.clone(),
                    });
            }
            WireEvent::Tell { sender, message } => {
                let _ = self.client_view_event_tx.send(ClientViewEvent::Tell {
                    sender: sender.clone(),
                    message: message.clone(),
                });
            }
            WireEvent::CharacterList(list) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CharacterList(list.clone()));
            }
            WireEvent::PlayerEntered { guid, name } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerEntered {
                        guid: *guid,
                        name: name.clone(),
                    });
            }
            WireEvent::GameMessage(msg) => {
                if let holtburger_protocol::messages::GameMessage::ServerName(data) = &**msg {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::WorldNameUpdated(data.name.clone()));
                }
            }
            WireEvent::Emote { sender, text } => {
                let _ = self.client_view_event_tx.send(ClientViewEvent::Emote {
                    sender: sender.clone(),
                    text: text.clone(),
                });
            }
            WireEvent::PingResponse => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PingResponse);
            }
            WireEvent::LogMessage(msg) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::LogMessage(msg.clone()));
            }
            WireEvent::BootAccount(reason) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::BootAccount(reason.clone()));
            }
            _ => {}
        }

        let _ = self.wire_event_tx.send(event);
    }

    pub fn handle_world_event(&self, event: &WorldEvent) {
        self.emit_world_view_projection(event);
    }

    fn sync_server_time(&mut self, server_time: f64, local_time: Instant) {
        let world_events = self.world.set_server_time_sync(server_time, local_time);
        for event in world_events {
            self.handle_world_event(&event);
        }
    }

    fn observe_runtime_world_event(&mut self, event: &WorldEvent) {
        const EPSILON: f32 = 1e-6;

        match event {
            WorldEvent::EntitySpawned(entity)
            | WorldEvent::EntityReplaced(entity)
            | WorldEvent::EntityIdentified(entity) => {
                if entity.guid != self.world.player.guid
                    && (entity.velocity.length_squared() > EPSILON
                        || entity.omega.length_squared() > EPSILON)
                {
                    self.simulation.track_actor(entity.guid);
                }
            }
            WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega,
            } => {
                if *guid == self.world.player.guid {
                    return;
                }

                if velocity.length_squared() > EPSILON || omega.length_squared() > EPSILON {
                    self.simulation.track_actor(*guid);
                } else {
                    self.simulation.untrack_actor(*guid);
                }
            }
            WorldEvent::EntityDespawned(guid) => {
                self.simulation.untrack_actor(*guid);
            }
            WorldEvent::RuntimeBodyChanged { .. }
            | WorldEvent::RuntimeBodyRemoved { .. }
            | WorldEvent::RuntimeBodiesReset { .. } => {}
            _ => {}
        }
    }

    fn handle_runtime_world_event(&mut self, event: &WorldEvent) {
        self.observe_runtime_world_event(event);
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
                self.emit_spell_catalog_loaded();
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

                if let Some(entity) = &data.player_entity {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::EntitySpawned {
                            entity: entity.clone(),
                        });
                }
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
            }
            WorldEvent::EntityReplaced(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityReplaced {
                        entity: entity.clone(),
                    });
            }
            WorldEvent::EntityIdentified(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityIdentified {
                        entity: entity.clone(),
                    });
            }
            WorldEvent::EntityDespawned(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityDespawned { guid: *guid });
            }
            WorldEvent::PropertiesUpdated { guid, updates } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityPropertiesUpdated {
                        guid: *guid,
                        updates: updates.clone(),
                    });
            }
            WorldEvent::EntityMoved { guid, pos } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityMoved {
                        guid: *guid,
                        pos: *pos,
                    });
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
            }
            WorldEvent::EntityMotionUpdated { guid, snapshot } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityMotionUpdated {
                        guid: *guid,
                        snapshot: *snapshot,
                    });
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
            }
            WorldEvent::RuntimeBodyChanged { body_id } => {
                if let Some(body) = self.world.runtime_body_view(*body_id) {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::RuntimeBodyUpserted {
                            body: Box::new(body),
                        });
                }
            }
            WorldEvent::RuntimeBodyRemoved { body_id } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::RuntimeBodyRemoved { body_id: *body_id });
            }
            WorldEvent::RuntimeBodiesReset { cause } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::RuntimeBodiesReset { cause: *cause });
            }
            WorldEvent::EntityStateUpdated { .. } => {}
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
            WorldEvent::NoClipUpdated(enabled) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::NoClipUpdated { enabled: *enabled });
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
            WorldEvent::FellowshipActivity(activity) => {
                if self.state == ClientState::InWorld {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::FellowshipActivity {
                            activity: activity.clone(),
                        });
                }
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

    pub async fn run(&mut self) -> Result<()> {
        // Initial handshake: If this is an activation/logon session, the bin should send ClientCommand::Login
        self.send_status_event();

        let mut physics_tick = tokio::time::interval(Duration::from_millis(PHYSICS_TICK_MS));
        let mut net_tick = tokio::time::interval(Duration::from_secs(1));
        let mut last_physics_time = Instant::now();

        loop {
            if matches!(self.state, ClientState::Disconnected) {
                break;
            }

            tokio::select! {
                _ = net_tick.tick() => {
                    let now = Instant::now();

                    // 1. Broadcast NetPulse
                    let _ = self.client_view_event_tx.send(ClientViewEvent::NetPulse {
                        bytes_in: self.session.bytes_in,
                        bytes_out: self.session.bytes_out,
                    });

                    // 2. Disconnect Detection (15s timeout)
                    if now.duration_since(self.session.last_recv_time) > Duration::from_secs(15) {
                        log::warn!("Connection timed out (no data for 15s)");
                        self.state = ClientState::Disconnected;
                        let _ = self.client_view_event_tx.send(ClientViewEvent::Disconnected);
                        self.send_status_event();
                        break;
                    }

                    // 3. Keep-alive Heartbeat (5s idle)
                    if now.duration_since(self.session.last_send_time) > Duration::from_secs(5) {
                        use holtburger_protocol::messages::misc::actions::PingRequestActionData;
                        self.session.send_action(holtburger_protocol::messages::GameAction::PingRequest(Box::new(PingRequestActionData))).await?;
                    }

                    self.poll_busy_timeout(now);
                }
                res = self.session.recv_message() => {
                    use holtburger_session::SessionEvent;
                    match res {
                        Ok(events) => {
                            for event in events {
                                match event {
                                    SessionEvent::Message(msg_data) => {
                                        self.handle_message(&msg_data).await?;

                                        if matches!(self.state, ClientState::Disconnected) {
                                            return Ok(());
                                        }
                                    }
                                    SessionEvent::HandshakeRequest(crd) => {
                                        self.sync_server_time(crd.time, Instant::now());
                                        self.auth.handle_handshake_request(crd, &mut self.session).await?;
                                    }
                                    SessionEvent::HandshakeResponse { cookie, client_id } => {
                                        self.auth.handle_handshake_response(cookie, client_id, &mut self.session).await?;
                                    }
                                    SessionEvent::TimeSync(server_time) => {
                                        self.sync_server_time(server_time, Instant::now());
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("Session error: {}", e);
                            self.state = ClientState::Disconnected;
                            self.send_status_event();
                            return Err(e);
                        }
                    }
                }
                Some(cmd) = async {
                    if let Some(rx) = &mut self.command_rx {
                        rx.recv().await
                    } else {
                        None
                    }
                } => {
                    self.handle_command(cmd).await?;
                }
                _ = physics_tick.tick() => {
                    let now = Instant::now();
                    let dt = now.duration_since(last_physics_time).as_secs_f32();
                    let dt_duration = Duration::from_secs_f32(dt.max(0.0));
                    last_physics_time = now;

                    let movement_events = self
                        .movement
                        .tick(now, &mut self.world, &mut self.session)
                        .await?;
                    for event in movement_events {
                        self.handle_runtime_world_event(&event);
                    }

                    let physics_events = self.world.tick();
                    for event in physics_events {
                        self.handle_runtime_world_event(&event);
                    }

                    let simulation_events = self.simulation.tick(
                        now,
                        dt_duration,
                        &mut self.world,
                        &mut self.movement,
                    );
                    for event in simulation_events {
                        self.handle_runtime_world_event(&event);
                    }

                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::{Guid, Quaternion, Vector3};
    use holtburger_world::FellowshipActivity;
    use holtburger_world::entity::Entity;

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
    fn simulation_build_request_returns_none_without_local_intent() {
        let client = builder::build_test_client(ClientState::InWorld);

        let request = client.simulation.build_solve_request(
            Instant::now(),
            Duration::from_millis(PHYSICS_TICK_MS),
            &client.world,
            &client.movement,
        );

        assert!(request.is_none());
    }

    #[test]
    fn simulation_build_request_includes_idle_local_player_runtime_body() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);

        client.world.player.guid = guid;
        client.world.player.position.landblock_id = Guid(0x1000_0001);
        client.world.player.position.rotation = Quaternion::identity();
        client.world.entities.insert(Entity::new(
            guid,
            "Player".to_string(),
            client.world.player.position,
        ));

        let request = client
            .simulation
            .build_solve_request(
                Instant::now(),
                Duration::from_millis(PHYSICS_TICK_MS),
                &client.world,
                &client.movement,
            )
            .expect("idle local player should still be submitted to physics");

        assert_eq!(request.actors.len(), 1);
        let actor = request.actors[0];
        assert_eq!(actor.actor_id, guid);
        assert_eq!(actor.pose, client.world.player.position);
        assert_eq!(actor.velocity, Vector3::zero());
        assert_eq!(actor.omega, Vector3::zero());
        assert_eq!(request.local_drive, None);
    }

    #[tokio::test]
    async fn simulation_build_request_carries_active_autonomous_drive() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let now = Instant::now();

        client.world.player.guid = guid;
        client.world.player.position.landblock_id = Guid(0x1000_0001);
        client.world.player.position.rotation = Quaternion::identity();
        client.world.entities.insert(Entity::new(
            guid,
            "Player".to_string(),
            client.world.player.position,
        ));

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

        let request = client
            .simulation
            .build_solve_request(
                now,
                Duration::from_millis(PHYSICS_TICK_MS),
                &client.world,
                &client.movement,
            )
            .expect(
                "idle local player with active autonomous drive should produce a solve request",
            );

        let local_drive = request
            .local_drive
            .expect("active autonomous drive should be threaded into the solve request");
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
    async fn simulation_build_request_reads_player_state_after_movement_tick() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let now = Instant::now();

        client.world.player.guid = guid;
        client.world.player.position.landblock_id = Guid(0x1000_0001);
        client.world.player.position.rotation = Quaternion::identity();
        client.world.entities.insert(Entity::new(
            guid,
            "Player".to_string(),
            client.world.player.position,
        ));

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::MotionState::builder()
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

        let request = client
            .simulation
            .build_solve_request(
                now,
                Duration::from_millis(PHYSICS_TICK_MS),
                &client.world,
                &client.movement,
            )
            .expect("movement-backed local intent should produce a solve request");

        assert_eq!(request.actors.len(), 1);
        let actor = request.actors[0];
        assert_eq!(actor.actor_id, guid);
        assert_eq!(
            actor.pose,
            client
                .world
                .local_player_runtime_pose()
                .expect("local player runtime pose should be readable")
        );
        assert!(actor.velocity.x.abs() < 1e-5);
        assert!((actor.velocity.y - 4.5).abs() < 1e-5);
        assert_eq!(actor.omega, Vector3::zero());
    }

    #[tokio::test]
    async fn simulation_build_request_includes_tracked_nearby_actor() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);
        let now = Instant::now();

        client.world.player.guid = player_guid;
        client.world.player.position.landblock_id = Guid(0x1000_0001);
        client.world.player.position.rotation = Quaternion::identity();
        client.world.entities.insert(Entity::new(
            player_guid,
            "Player".to_string(),
            client.world.player.position,
        ));
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
            .expect("tracked remote entity should exist");
        remote.velocity = holtburger_common::Vector3::new(1.0, 0.0, 0.0);

        client.simulation.track_actor(remote_guid);
        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::MotionState::builder()
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

        let request = client
            .simulation
            .build_solve_request(
                now,
                Duration::from_millis(PHYSICS_TICK_MS),
                &client.world,
                &client.movement,
            )
            .expect("tracked nearby actor should join the solve set");

        assert_eq!(request.actors.len(), 2);
        assert!(
            request
                .actors
                .iter()
                .any(|actor| actor.actor_id == player_guid)
        );
        assert!(
            request
                .actors
                .iter()
                .any(|actor| actor.actor_id == remote_guid)
        );
    }

    #[tokio::test]
    async fn simulation_tick_advances_local_player_runtime_body_without_mutating_authoritative_pose()
     {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let now = Instant::now();

        client.world.player.guid = guid;
        client.world.player.position.landblock_id = Guid(0x1000_0001);
        client.world.player.position.rotation = Quaternion::identity();
        client.world.entities.insert(Entity::new(
            guid,
            "Player".to_string(),
            client.world.player.position,
        ));

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::MotionState::builder()
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

        let events = client.simulation.tick(
            now,
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
        );

        assert_eq!(client.world.player.position.landblock_id, Guid(0x1000_0001));
        assert!(client.world.player.position.coords.y.abs() <= f32::EPSILON);
        let body = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::LocalPlayer(guid))
            .expect("local player runtime body should exist after solve");
        assert!(body.pose.coords.y > 0.0);
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::RuntimeBodyChanged {
                body_id: holtburger_world::SpatialBodyId::LocalPlayer(event_guid)
            } if *event_guid == guid
        )));
    }

    #[tokio::test]
    async fn simulation_tick_advances_tracked_actor_alongside_local_player() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);
        let now = Instant::now();

        client.world.player.guid = player_guid;
        client.world.player.position.landblock_id = Guid(0x1000_0001);
        client.world.player.position.rotation = Quaternion::identity();
        client.world.entities.insert(Entity::new(
            player_guid,
            "Player".to_string(),
            client.world.player.position,
        ));
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
            .expect("tracked remote entity should exist before solve")
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
        client.world.remove_entity(remote_guid);
        client.world.add_entity(remote);

        client.simulation.track_actor(remote_guid);
        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::MotionState::builder()
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

        let events = client.simulation.tick(
            now,
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
        );

        let remote_after = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::Entity(remote_guid))
            .expect("tracked remote body should still exist after solve");
        let player_body = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::LocalPlayer(player_guid))
            .expect("local player runtime body should exist after solve");
        assert!(player_body.pose.coords.y > 0.0);
        assert!(remote_after.pose.coords.x > remote_start.x);
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::RuntimeBodyChanged {
                body_id: holtburger_world::SpatialBodyId::LocalPlayer(event_guid)
            } if *event_guid == player_guid
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityMoved { guid: event_guid, .. } if *event_guid == remote_guid
        )));
    }

    #[test]
    fn runtime_world_event_tracking_registers_remote_movers() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);

        client.world.player.guid = player_guid;
        client.world.player.position.landblock_id = Guid(0x1000_0001);
        client.world.entities.insert(Entity::new(
            player_guid,
            "Player".to_string(),
            client.world.player.position,
        ));
        client.world.add_entity(Entity::new(
            remote_guid,
            "Remote".to_string(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: holtburger_common::Vector3::new(12.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        ));

        client.observe_runtime_world_event(&WorldEvent::EntityVectorUpdated {
            guid: remote_guid,
            velocity: holtburger_common::Vector3::new(1.0, 0.0, 0.0),
            omega: holtburger_common::Vector3::zero(),
        });

        let request = client.simulation.build_solve_request(
            Instant::now(),
            Duration::from_millis(PHYSICS_TICK_MS),
            &client.world,
            &client.movement,
        );

        assert!(request.is_some());
        assert!(
            request
                .expect("tracked remote mover should produce a solve request")
                .actors
                .iter()
                .any(|actor| actor.actor_id == remote_guid)
        );
    }
}
