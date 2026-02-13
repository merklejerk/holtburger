use crate::session::Session;
use crate::world::{WorldEvent, WorldState, state::ServerTimeSync};
use anyhow::Result;
use holtburger_common::Guid;
use holtburger_protocol::messages::CharacterEntry;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub mod types;
mod builder;
mod auth;
mod movement;
mod commands;
mod messages;
use types::*;
use movement::MovementSystem;

/// Physics tick interval in milliseconds.
const PHYSICS_TICK_MS: u64 = 30;

pub struct Client {
    pub session: Session,
    pub world: WorldState,
    account_name: String,
    characters: Vec<CharacterEntry>,
    character_id: Option<Guid>,
    character_preference: Option<String>,
    state: ClientState,
    event_tx: Option<mpsc::UnboundedSender<ClientEvent>>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    connection_cookie: u64,
    pub message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
    movement: MovementSystem,
}

impl Client {
    pub fn set_event_tx(&mut self, tx: mpsc::UnboundedSender<ClientEvent>) {
        self.event_tx = Some(tx);
    }

    pub fn set_command_rx(&mut self, rx: mpsc::UnboundedReceiver<ClientCommand>) {
        self.command_rx = Some(rx);
    }

    fn send_status_event(&self) {
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::StatusUpdate {
                state: self.state.clone(),
            });
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
                                                    if let Some(player) = self.world.entities.get_mut(self.world.player.guid) {
                                                        player.velocity = holtburger_common::Vector3::zero();
                                                    }
                                                }
                                        }

                                        if matches!(self.state, ClientState::Disconnected) {
                                            return Ok(());
                                        }
                                    }
                                    SessionEvent::HandshakeRequest(crd) => {
                                        self.handle_handshake_request(crd).await?;
                                    }
                                    SessionEvent::HandshakeResponse { cookie, client_id } => {
                                        self.handle_handshake_response(cookie, client_id).await?;
                                    }
                                    SessionEvent::TimeSync(server_time) => {
                                        self.world.server_time = Some(ServerTimeSync {
                                            server_time,
                                            local_time: Instant::now(),
                                        });
                                        if let Some(tx) = &self.event_tx {
                                            let _ = tx.send(ClientEvent::World(Box::new(WorldEvent::ServerTimeUpdate(server_time))));
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
                    let now = Instant::now();
                    let dt = now.duration_since(last_physics_time).as_secs_f32();
                    last_physics_time = now;

                    if let Some(target_guid) = self.movement.move_target {
                        let Client { movement, world, session, event_tx, .. } = self;
                        movement.handle_approach_task(target_guid, dt, world, session, event_tx).await?;
                    }

                    // TODO: Use actual player radius from DAT/Properties
                    let physics_events = self.world.tick(dt, 0.35);
                    for event in physics_events {
                        if let Some(tx) = &self.event_tx {
                            let _ = tx.send(ClientEvent::World(Box::new(event)));
                        }
                    }
                }
            }
        }

        Ok(())
    }
}
