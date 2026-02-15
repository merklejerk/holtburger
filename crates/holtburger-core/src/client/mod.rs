use crate::session::Session;
use crate::world::{StateEvent, WorldState, state::ServerTimeSync};
use anyhow::Result;
use std::collections::HashMap;
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
                        kind: ErrorKind::Weenie,
                        code: Some(*error as u32),
                        message: format!(
                            "Inventory save failed for 0x{:08X}: {:?}",
                            item_guid.0, error
                        ),
                        is_transient: true,
                    });
            }
            WireEvent::WeenieError { error_id, message } => {
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
            WireEvent::CharacterError(err) => {
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
            WireEvent::ClientError(msg) => {
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
            WireEvent::UseDone { error_id } if *error_id != 0 => {
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
            StateEvent::AttributeUpdated(_)
            | StateEvent::SkillUpdated(_)
            | StateEvent::LevelInfoUpdated(_)
            | StateEvent::DerivedStatsUpdated(_) => {
                let level_info = self.world.get_level_info().unwrap_or_default();
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerStatsSkillsUpdated {
                        attributes: self.world.player.attributes.clone(),
                        skills: self.world.player.skills.clone(),
                        resistances: self.world.player.resistances.clone(),
                        armor: self.world.player.armor,
                        vitae: self.world.player.vitae,
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

                let mut spells = HashMap::new();
                for &spell_id in &spell_ids {
                    if let Some(spell) = self.world.resolve_spell_info(spell_id) {
                        spells.insert(spell_id, spell);
                    }
                }

                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerSpellsUpdated {
                        spell_ids,
                        spells,
                    });
            }
            StateEvent::PlayerInfo(_) => {
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
                        .send(ClientViewEvent::EntityUpserted {
                            entity: Box::new(entity.clone()),
                        });
                }
            }
            StateEvent::EntitySpawned(entity) | StateEvent::EntityIdentified(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityUpserted {
                        entity: entity.clone(),
                    });
            }
            StateEvent::EntityDespawned(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityRemoved { guid: *guid });
            }
            StateEvent::EntityMoved { guid, .. }
            | StateEvent::EntityStateUpdated { guid, .. }
            | StateEvent::EntityVectorUpdated { guid, .. }
            | StateEvent::PropertyUpdated { guid, .. } => {
                if let Some(entity) = self.world.entities.get(*guid) {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::EntityUpserted {
                            entity: Box::new(entity.clone()),
                        });
                }
            }
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
                                            if let StateEvent::ForcedReposition { .. } = event
                                                && self.movement.move_target.is_some() {
                                                    log::warn!("Approach aborted: Forced reposition by server");
                                                    self.movement.move_target = None;
                                                    let events = self.world.set_player_velocity(holtburger_common::Vector3::zero());
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

                    if let Some(target_guid) = self.movement.move_target {
                        let Client { movement, world, session, .. } = self;
                        let (wire_events, state_events) = movement.handle_approach_task(target_guid, dt, world, session).await?;
                        for event in wire_events {
                            self.emit_wire_event(event);
                        }
                        for event in state_events {
                            self.emit_state_event(event);
                        }
                    }

                    // TODO: Use actual player radius from DAT/Properties
                    let physics_events = self.world.tick(dt, 0.35);
                    let physics_events = crate::world::dedupe_state_events(physics_events);
                    for event in physics_events {
                        self.emit_state_event(event);
                    }
                }
            }
        }

        Ok(())
    }
}
