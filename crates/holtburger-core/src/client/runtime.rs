use super::*;
use anyhow::Result;
use holtburger_world::SpatialBodyId;
use std::sync::Arc;
use std::time::{Duration, Instant};

impl ClientRuntime {
    fn should_send_keepalive_ping(&self, now: Instant) -> bool {
        matches!(self.state, ClientState::InWorld)
            && now.duration_since(self.session.last_send_time) > Duration::from_secs(5)
    }

    fn sync_remote_body_tracking(&mut self, body_id: SpatialBodyId) {
        if matches!(body_id, SpatialBodyId::LocalPlayer(_)) {
            return;
        }

        if self.world.body_has_simulatable_projection_basis(body_id) {
            self.simulation.track_body(body_id);
        } else {
            self.simulation.untrack_body(body_id);
        }
    }

    pub(super) fn poll_busy_timeout(&mut self, now: Instant) {
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

    pub(super) fn emit_runtime_body_snapshot(&self) {
        let bodies: Arc<[_]> = self.world.runtime_body_views().into();
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::RuntimeBodySnapshot { bodies });
    }

    pub(super) fn sync_server_time(&mut self, server_time: f64, local_time: Instant) {
        let world_events = self.world.set_server_time_sync(server_time, local_time);
        for event in world_events {
            self.handle_world_event(&event);
        }
    }

    pub(super) fn observe_runtime_world_event(&mut self, event: &WorldEvent) {
        match event {
            WorldEvent::EntitySpawned(entity)
            | WorldEvent::EntityReplaced(entity)
            | WorldEvent::EntityIdentified(entity) => {
                if let Some(body_id) = self.world.runtime_body_id_for_guid(entity.guid) {
                    self.sync_remote_body_tracking(body_id);
                }
            }
            WorldEvent::EntityVectorUpdated { guid, .. } => {
                if let Some(body_id) = self.world.runtime_body_id_for_guid(*guid) {
                    self.sync_remote_body_tracking(body_id);
                }
            }
            WorldEvent::EntityDespawned(guid) => {
                self.simulation.untrack_body(SpatialBodyId::Entity(*guid));
            }
            WorldEvent::RuntimeBodyChanged { body_id } => {
                self.sync_remote_body_tracking(*body_id);
            }
            WorldEvent::RuntimeBodyRemoved { body_id }
                if !matches!(body_id, SpatialBodyId::LocalPlayer(_)) =>
            {
                self.simulation.untrack_body(*body_id);
            }
            WorldEvent::RuntimeBodiesReset { .. } => {}
            _ => {}
        }
    }

    pub(super) fn handle_runtime_world_event(&mut self, event: &WorldEvent) {
        self.observe_runtime_world_event(event);
        self.emit_world_view_projection(event);
    }

    pub async fn run(&mut self) -> Result<()> {
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

                    let _ = self.client_view_event_tx.send(ClientViewEvent::NetPulse {
                        bytes_in: self.session.bytes_in,
                        bytes_out: self.session.bytes_out,
                    });

                    if now.duration_since(self.session.last_recv_time) > Duration::from_secs(15) {
                        log::warn!("Connection timed out (no data for 15s)");
                        self.state = ClientState::Disconnected;
                        let _ = self.client_view_event_tx.send(ClientViewEvent::Disconnected);
                        self.send_status_event();
                        break;
                    }

                    if self.should_send_keepalive_ping(now) {
                        use holtburger_protocol::messages::misc::actions::PingRequestActionData;
                        self.session
                            .send_action(holtburger_protocol::messages::GameAction::PingRequest(
                                Box::new(PingRequestActionData),
                            ))
                            .await?;
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
    use crate::client::builder;

    #[test]
    fn keepalive_ping_requires_in_world_state() {
        let now = Instant::now();

        let mut connected = builder::build_test_client(ClientState::Connected);
        connected.session.last_send_time = now - Duration::from_secs(6);
        assert!(!connected.should_send_keepalive_ping(now));

        let mut entering_world = builder::build_test_client(ClientState::EnteringWorld);
        entering_world.session.last_send_time = now - Duration::from_secs(6);
        assert!(!entering_world.should_send_keepalive_ping(now));

        let mut in_world = builder::build_test_client(ClientState::InWorld);
        in_world.session.last_send_time = now - Duration::from_secs(6);
        assert!(in_world.should_send_keepalive_ping(now));
    }
}
