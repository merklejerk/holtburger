use anyhow::Result;
use holtburger_protocol::errors::WeenieError;
use holtburger_session::Session;
use holtburger_world::{WorldEvent, WorldState};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

mod auth;
mod builder;
mod commands;
pub mod controllers;
pub mod locomotion;
mod messages;
mod movement;
pub mod navigation;
pub mod types;
use auth::AuthState;
pub use builder::ClientBuilder;
use movement::MovementSystem;
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
    auth: AuthState,
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
        if let Some(catalog) = &self.world.spell_catalog {
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::SpellCatalogLoaded {
                    catalog: catalog.clone(),
                });
        }
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
            WorldEvent::EntityStateUpdated { .. } | WorldEvent::EntityVectorUpdated { .. } => {}
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
                                        self.auth.handle_handshake_request(crd, &mut self.session).await?;
                                    }
                                    SessionEvent::HandshakeResponse { cookie, client_id } => {
                                        self.auth.handle_handshake_response(cookie, client_id, &mut self.session).await?;
                                    }
                                    SessionEvent::TimeSync(server_time) => {
                                        let world_events = self
                                            .world
                                            .set_server_time_sync(server_time, Instant::now());
                                        for event in world_events {
                                            self.handle_world_event(&event);
                                        }
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
                    let physics_events = self.world.tick();
                    for event in physics_events {
                        self.handle_world_event(&event);
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
}
