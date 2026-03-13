use anyhow::Result;
use holtburger_protocol::errors::WeenieError;
use holtburger_session::Session;
use holtburger_world::{StateEvent, WorldState, state::ServerTimeSync};
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
pub mod types;
use auth::AuthState;
use movement::MovementSystem;
use types::*;

/// Physics tick interval in milliseconds.
const PHYSICS_TICK_MS: u64 = 30;

pub struct Client {
    pub session: Session,
    pub world: WorldState,
    state: ClientState,
    wire_event_tx: broadcast::Sender<WireEvent>,
    state_event_tx: broadcast::Sender<StateEvent>,
    client_view_event_tx: broadcast::Sender<ClientViewEvent>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    pub message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
    movement: MovementSystem,
    auth: AuthState,
}

impl Client {
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

    pub fn subscribe_state_events(&self) -> broadcast::Receiver<StateEvent> {
        self.state_event_tx.subscribe()
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

    pub fn emit_state_event(&self, event: StateEvent) {
        self.emit_world_view_projection(&event);
        let _ = self.state_event_tx.send(event);
    }

    fn emit_world_view_projection(&self, event: &StateEvent) {
        match event {
            StateEvent::PlayerEnchantmentsUpdated { enchantments } => {
                let _ =
                    self.client_view_event_tx
                        .send(ClientViewEvent::PlayerEnchantmentsUpdated {
                            enchantments: enchantments.clone(),
                            resolved_names: self.world.get_player_spell_names(),
                        });
            }
            StateEvent::DerivedStatsUpdated(data) => {
                let level_info = self.world.get_level_info().unwrap_or_default();
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
                        level_info,
                    });
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });
            }
            StateEvent::AttributeUpdated(_)
            | StateEvent::SkillUpdated(_)
            | StateEvent::LevelInfoUpdated(_) => {
                let level_info = self.world.get_level_info().unwrap_or_default();
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerStatsSkillsUpdated {
                        attributes: self.world.player.attributes.clone(),
                        skills: self.world.player.skills.clone(),
                        resistances: self.world.player.resistances(),
                        armor: self.world.player.armor(),
                        vitae: self.world.player.vitae(),
                        level_info: level_info.clone(),
                    });
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated {
                        vitals: self.world.player.vitals.clone(),
                    });
            }
            StateEvent::VitalUpdated(vital) => {
                let mut vitals = HashMap::new();
                vitals.insert(vital.vital_type, vital.clone());
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });
            }
            StateEvent::SpellUpdated { .. } | StateEvent::SpellRemoved { .. } => {
                let mut spell_ids: Vec<u32> = self.world.player.spells.keys().cloned().collect();
                spell_ids.sort();

                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerSpellsUpdated { spell_ids });
            }
            StateEvent::PlayerInfo(_) => {
                self.emit_spell_catalog_loaded();
                // Emit all snapshots
                self.emit_world_view_projection(&StateEvent::PlayerEnchantmentsUpdated {
                    enchantments: self.world.player.enchantments.clone(),
                });
                self.emit_world_view_projection(&StateEvent::LevelInfoUpdated(
                    self.world.get_level_info().unwrap_or_default(),
                ));
                self.emit_world_view_projection(&StateEvent::SpellUpdated {
                    spell_id: 0,
                    name: None,
                }); // Trigger spell sync

                // Emit player entity snapshot if available
                if let Some(entity) = self.world.entities.get(self.world.player.guid) {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::EntitySpawned {
                            entity: Box::new(entity.clone()),
                        });
                }
            }
            StateEvent::EntitySpawned(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntitySpawned {
                        entity: entity.clone(),
                    });
            }
            StateEvent::EntityReplaced(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityReplaced {
                        entity: entity.clone(),
                    });
            }
            StateEvent::EntityIdentified(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityIdentified {
                        entity: entity.clone(),
                    });
            }
            StateEvent::EntityDespawned(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityDespawned { guid: *guid });
            }
            StateEvent::PropertiesUpdated { guid, updates } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityPropertiesUpdated {
                        guid: *guid,
                        updates: updates.clone(),
                    });
            }
            StateEvent::EntityMoved { guid, pos } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityMoved {
                        guid: *guid,
                        pos: *pos,
                    });
            }
            StateEvent::EntityStateUpdated { .. } | StateEvent::EntityVectorUpdated { .. } => {}
            StateEvent::ServerTimeUpdate(time) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ServerTimeUpdated { time: *time });
            }
            StateEvent::CombatModeUpdated(mode) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CombatModeUpdated { mode: *mode });
            }
            StateEvent::NoClipUpdated(enabled) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::NoClipUpdated { enabled: *enabled });
            }
            StateEvent::VendorStateUpdated(vendor) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::VendorStateUpdated {
                        vendor: vendor.clone(),
                    });
            }
            StateEvent::VendorItemIdentified(item) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::VendorItemIdentified(item.clone()));
            }
            StateEvent::TradeStateUpdated(trade) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::TradeStateUpdated {
                        trade: trade.clone(),
                    });
            }
            StateEvent::ContainerOpened(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ContainerOpened { guid: *guid });
            }
            StateEvent::ContainerClosed(guid) => {
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
                }
                res = self.session.recv_message() => {
                    use holtburger_session::SessionEvent;
                    match res {
                        Ok(events) => {
                            for event in events {
                                match event {
                                    SessionEvent::Message(msg_data) => {
                                        let world_events = self.handle_message(&msg_data).await?;

                                        for event in world_events {
                                            if let StateEvent::ForcedReposition { .. } = event
                                                && let Some(events) = self.movement.cancel_approach_due_to_forced_reposition(&mut self.world).await? {
                                                    for ev in events {
                                                        self.emit_state_event(ev);
                                                    }
                                                }
                                        }

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
                                        self.world.server_time = Some(ServerTimeSync {
                                            server_time,
                                            local_time: Instant::now(),
                                        });
                                        self.emit_state_event(
                                            StateEvent::ServerTimeUpdate(server_time),
                                        );
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
                    last_physics_time = now;

                    if self.movement.has_active_approach() {
                        let Client { movement, world, session, .. } = self;
                        let (wire_events, state_events) = movement.tick_approach(world, session).await?;
                        for event in wire_events {
                            self.emit_wire_event(event);
                        }
                        for event in state_events {
                            self.emit_state_event(event);
                        }
                    }

                    // TODO: Use actual player radius from DAT/Properties
                    let physics_events = self.world.tick(dt, 0.35);
                    let physics_events = holtburger_world::dedupe_state_events(physics_events);
                    for event in physics_events {
                        self.emit_state_event(event);
                    }
                }
            }
        }

        Ok(())
    }
}
