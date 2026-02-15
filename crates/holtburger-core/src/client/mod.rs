use crate::session::Session;
use crate::world::{WorldEvent, WorldState, state::ServerTimeSync};
use anyhow::Result;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

mod auth;
mod builder;
mod commands;
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
    event_tx: Option<mpsc::UnboundedSender<ClientEvent>>,
    client_view_event_tx: broadcast::Sender<ClientViewEvent>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    pub message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
    movement: MovementSystem,
    auth: AuthState,
}

impl Client {
    pub fn set_event_tx(&mut self, tx: mpsc::UnboundedSender<ClientEvent>) {
        self.event_tx = Some(tx);
    }

    pub fn set_command_rx(&mut self, rx: mpsc::UnboundedReceiver<ClientCommand>) {
        self.command_rx = Some(rx);
    }

    pub fn subscribe_client_view_events(&self) -> broadcast::Receiver<ClientViewEvent> {
        self.client_view_event_tx.subscribe()
    }

    fn send_status_event(&self) {
        self.emit_client_event(ClientEvent::StatusUpdate {
            state: self.state.clone(),
        });
    }

    pub fn emit_client_event(&self, event: ClientEvent) {
        // New ClientView stream projection (normalization)
        match &event {
            ClientEvent::StatusUpdate { state } => {
                let _ = self.client_view_event_tx.send(ClientViewEvent::StatusUpdate {
                    state: state.clone(),
                });
            }
            ClientEvent::WeenieError { error_id, message } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ErrorRaised {
                        source: ErrorSource::Wire,
                        kind: ErrorKind::Weenie,
                        code: Some(*error_id),
                        message: message
                            .clone()
                            .unwrap_or_else(|| format!("Weenie error {}", error_id)),
                        is_transient: true,
                    });
            }
            ClientEvent::CharacterError(err) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ErrorRaised {
                        source: ErrorSource::Wire,
                        kind: ErrorKind::Character,
                        code: Some(*err as u32),
                        message: format!("Character error: {:?}", err),
                        is_transient: true,
                    });
            }
            ClientEvent::ClientError(msg) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ErrorRaised {
                        source: ErrorSource::Client,
                        kind: ErrorKind::Client,
                        code: None,
                        message: msg.clone(),
                        is_transient: true,
                    });
            }
            ClientEvent::UseDone { error_id } if *error_id != 0 => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ErrorRaised {
                        source: ErrorSource::Wire,
                        kind: ErrorKind::Weenie,
                        code: Some(*error_id),
                        message: format!("Use failed: {}", error_id),
                        is_transient: true,
                    });
            }
            ClientEvent::World(event) => {
                self.emit_world_view_projection(event);
            }
            _ => {}
        }

        // Legacy stream
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(event);
        }
    }

    fn emit_world_view_projection(&self, event: &WorldEvent) {
        match event {
            WorldEvent::PlayerEnchantmentsUpdated { enchantments } => {
                let _ = self.client_view_event_tx.send(
                    ClientViewEvent::PlayerEnchantmentsUpdated {
                        enchantments: enchantments.clone(),
                        resolved_names: self.world.get_player_spell_names(),
                    },
                );
            }
            WorldEvent::EntitySpawned(entity) | WorldEvent::EntityIdentified(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityUpserted {
                        entity: entity.clone(),
                    });
            }
            WorldEvent::EntityDespawned(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityRemoved { guid: *guid });
            }
            WorldEvent::EntityMoved { guid, .. }
            | WorldEvent::EntityStateUpdated { guid, .. }
            | WorldEvent::EntityVectorUpdated { guid, .. } => {
                if let Some(entity) = self.world.entities.get(*guid) {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::EntityUpserted {
                            entity: Box::new(entity.clone()),
                        });
                }
            }
            _ => {}
        }
    }

    pub async fn run(&mut self) -> Result<()> {
        // Initial handshake: If this is an activation/logon session, the bin should send ClientCommand::Login
        self.send_status_event();

        let mut physics_tick = tokio::time::interval(Duration::from_millis(PHYSICS_TICK_MS));
        let mut last_physics_time = Instant::now();

        loop {
            if matches!(self.state, ClientState::Disconnected) {
                break;
            }

            tokio::select! {
                res = self.session.recv_message() => {
                    use crate::session::SessionEvent;
                    match res {
                        Ok(events) => {
                            for event in events {
                                match event {
                                    SessionEvent::Message(msg_data) => {
                                        let world_events = self.handle_message(&msg_data).await?;

                                        for event in world_events {
                                            if let WorldEvent::ForcedReposition { .. } = event
                                                && self.movement.move_target.is_some() {
                                                    log::warn!("Approach aborted: Forced reposition by server");
                                                    self.movement.move_target = None;
                                                    let events = self.world.set_player_velocity(holtburger_common::Vector3::zero());
                                                    for ev in events {
                                                        self.emit_client_event(ClientEvent::World(Box::new(ev)));
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
                                        self.emit_client_event(ClientEvent::World(Box::new(
                                            WorldEvent::ServerTimeUpdate(server_time),
                                        )));
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

                    if let Some(target_guid) = self.movement.move_target {
                        let Client { movement, world, session, .. } = self;
                        let events = movement.handle_approach_task(target_guid, dt, world, session).await?;
                        for event in events {
                            self.emit_client_event(event);
                        }
                    }

                    // TODO: Use actual player radius from DAT/Properties
                    let physics_events = self.world.tick(dt, 0.35);
                    let physics_events = crate::world::dedupe_world_events(physics_events);
                    for event in physics_events {
                        self.emit_client_event(ClientEvent::World(Box::new(event)));
                    }
                }
            }
        }

        Ok(())
    }
}
