use super::*;
use crate::DynamicEntityEvent;
use crate::DynamicEntityPlacementAdvanceKind;
use anyhow::Result;
use holtburger_protocol::messages::game_action::{GameAction, JumpActionData};
use std::sync::Arc;
use std::time::{Duration, Instant};

impl ClientRuntime {
    fn should_send_keepalive_ping(&self, now: Instant) -> bool {
        matches!(self.state, ClientState::InWorld)
            && now.duration_since(self.session.last_send_time) > Duration::from_secs(5)
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

    pub(super) fn handle_runtime_world_event(&mut self, event: &WorldEvent) {
        self.handle_runtime_world_event_with_context(event, false);
    }

    pub(super) fn handle_runtime_world_event_with_context(
        &mut self,
        event: &WorldEvent,
        teleport_batch: bool,
    ) {
        match event {
            WorldEvent::RuntimeBodiesReset { .. } => {
                self.movement.clear_server_controlled_motion();
                self.reset_camera();
                if let Some(coordinator) = self.collision_coordinator.as_mut() {
                    coordinator.invalidate();
                }
                // PlayerTeleport emits this reset as an effect before its identifying edge. The
                // batch handler lets the TeleportStarted event own the one generation increment;
                // a standalone reset remains an in-place presentation discontinuity.
                if !teleport_batch && self.activation.is_none() {
                    self.bump_world_generation();
                    let _ = self.client_view_event_tx.send(
                        ClientViewEvent::PresentationDiscontinuity {
                            world_generation: self.world_generation,
                            kind: ClientPresentationDiscontinuityKind::Reset,
                        },
                    );
                }
            }
            WorldEvent::ForcedReposition { guid, .. } if *guid == self.world.player.guid => {
                self.movement.clear_server_controlled_motion();
                self.reset_camera();
                if let Some(coordinator) = self.collision_coordinator.as_mut() {
                    coordinator.invalidate();
                }
                if self.activation.is_none() {
                    self.bump_world_generation();
                    let _ = self.client_view_event_tx.send(
                        ClientViewEvent::PresentationDiscontinuity {
                            world_generation: self.world_generation,
                            kind: ClientPresentationDiscontinuityKind::ForcedReposition,
                        },
                    );
                }
            }
            WorldEvent::TeleportStarted { .. } => {
                self.start_world_activation(
                    ClientWorldActivationState::Teleport,
                    self.world.player.guid,
                );
            }
            _ => {}
        }
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
                        self.set_exit_cause(ClientExitCause::ServerDisconnect);
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
                    self.dynamic_script_inbox.expire(now);
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
                            self.set_exit_cause(ClientExitCause::RuntimeFailure);
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
                    if let Err(error) = self.handle_command(cmd).await {
                        self.set_exit_cause(ClientExitCause::RuntimeFailure);
                        self.state = ClientState::Disconnected;
                        self.send_status_event();
                        return Err(error);
                    }
                }
                _ = physics_tick.tick() => {
                    let now = Instant::now();
                    let dt = now.duration_since(last_physics_time).as_secs_f32();
                    let dt_duration = Duration::from_secs_f32(dt.max(0.0));
                    last_physics_time = now;

                    let active_world = self.activation.is_none()
                        && matches!(self.state, ClientState::InWorld);
                    if active_world {
                        self.advance_dynamic_scale(self.dynamic_scale_time())?;
                        self.poll_selection_envelopes();
                    }
                    if active_world {
                        let movement_events = self
                            .movement
                            .tick(now, &mut self.world, &mut self.session)
                            .await
                            .inspect_err(|_| {
                                self.set_exit_cause(ClientExitCause::RuntimeFailure);
                            })?;
                        for event in movement_events {
                            self.handle_runtime_world_event(&event);
                        }
                        for feedback in self.movement.take_character_motion_feedback() {
                            let _ = self
                                .client_view_event_tx
                                .send(ClientViewEvent::CharacterMotionFeedback(feedback));
                        }
                    }

                    let physics_events = self.world.tick();
                    for event in physics_events {
                        self.handle_runtime_world_event(&event);
                    }

                    if let Some(coordinator) = self.collision_coordinator.as_mut() {
                        let mut collision_events = coordinator.observe(&mut self.world);
                        collision_events.extend(coordinator.poll(&mut self.world, now));
                        for event in collision_events {
                            self.handle_runtime_world_event(&event);
                        }
                    }

                    let precise_collision = self
                        .collision_coordinator
                        .as_ref()
                        .map(super::collision::ClientCollisionCoordinator::snapshot);
                    for evaluation in self.precise_jump.poll(
                        self.world_generation,
                        self.camera.identity(),
                        &self.world,
                        precise_collision.as_deref(),
                    ) {
                        let _ = self
                            .client_view_event_tx
                            .send(ClientViewEvent::PreciseJumpEvaluation(evaluation));
                    }

                    self.try_complete_world_activation().await?;

                    let active_world = self.activation.is_none()
                        && matches!(self.state, ClientState::InWorld);
                    let before_dynamic = if active_world {
                        self.current_dynamic_entity_views()
                    } else {
                        Default::default()
                    };
                    let collision_snapshot = self
                        .collision_coordinator
                        .as_ref()
                        .map(super::collision::ClientCollisionCoordinator::snapshot);
                    let mut placement_kind_overrides = std::collections::HashMap::new();
                    if active_world {
                        let prepared_precise_jump = match self.precise_jump.prepare_queued_commit(
                            self.world_generation,
                            self.camera.identity(),
                            &self.world,
                            collision_snapshot.as_deref(),
                            now,
                        ) {
                            Some(Ok(prepared)) => Some(prepared),
                            Some(Err(feedback)) => {
                                let _ = self.client_view_event_tx.send(
                                    ClientViewEvent::PreciseJumpTransactionFeedback(feedback),
                                );
                                None
                            }
                            None => None,
                        };
                        let simulation_tick = super::simulation::tick_with_precise_jump(
                            now,
                            dt_duration,
                            &mut self.world,
                            &mut self.movement,
                            collision_snapshot.as_deref(),
                            prepared_precise_jump,
                        ).inspect_err(|_| {
                            self.set_exit_cause(ClientExitCause::RuntimeFailure);
                        })?;
                        let mut advanced_runtime_bodies = Vec::new();
                        for event in simulation_tick.events {
                            if let WorldEvent::RuntimeBodyAdvanced { body_id, kind } = event {
                                if let Some(guid) = body_id.authoritative_guid() {
                                    placement_kind_overrides.insert(
                                        guid,
                                        match kind {
                                            holtburger_world::RuntimeBodyAdvanceKind::Integrated => {
                                                DynamicEntityPlacementAdvanceKind::Integrated
                                            }
                                            holtburger_world::RuntimeBodyAdvanceKind::CorrectionSnap => {
                                                DynamicEntityPlacementAdvanceKind::CorrectionSnap
                                            }
                                        },
                                    );
                                }
                                if let Some(body) = self.world.runtime_body_view(body_id) {
                                    advanced_runtime_bodies.push(body);
                                }
                            }
                            self.handle_runtime_world_event(&event);
                        }
                        advanced_runtime_bodies.sort_by_key(|body| body.body_id);
                        if !advanced_runtime_bodies.is_empty() {
                            let _ = self.client_view_event_tx.send(
                                ClientViewEvent::RuntimeBodiesAdvanced {
                                    bodies: advanced_runtime_bodies.into(),
                                },
                            );
                        }
                        if let Some(jump) = simulation_tick.committed_jump {
                            self.session
                                .send_action(GameAction::Jump(Box::new(JumpActionData {
                                extent: jump.resolved.extent().get(),
                                velocity: jump.resolved.local_velocity(),
                                position: jump.position,
                                instance_sequence: jump.instance_sequence,
                                server_control_sequence: jump.server_control_sequence,
                                teleport_sequence: jump.teleport_sequence,
                                force_position_sequence: jump.force_position_sequence,
                                })))
                                .await?;
                        }
                        if let Some(feedback) = simulation_tick.character_motion_feedback {
                            let _ = self
                                .client_view_event_tx
                                .send(ClientViewEvent::CharacterMotionFeedback(feedback));
                        }
                        if let Some(feedback) = simulation_tick.precise_jump_feedback {
                            let _ = self.client_view_event_tx.send(
                                ClientViewEvent::PreciseJumpTransactionFeedback(feedback),
                            );
                        }
                    }

                    self.publish_character_motion_capabilities_if_changed();

                    let dynamic_event = if !before_dynamic.is_empty() {
                        self.dynamic_entity_tick_event(
                            before_dynamic,
                            self.current_dynamic_entity_views(),
                            self.dynamic_entity_host_time(),
                            dt_duration.as_secs_f64() * 1_000.0,
                            &placement_kind_overrides,
                        )
                    } else {
                        None
                    };
                    let dynamic_batch = dynamic_event.as_ref().and_then(|event| match event {
                        DynamicEntityEvent::Ticked { batch } => Some(batch),
                        _ => None,
                    });
                    let camera_tick = if active_world {
                        self.advance_camera(
                            collision_snapshot.as_deref(),
                            dynamic_batch,
                            dt_duration,
                        )?
                    } else {
                        None
                    };
                    if let Some(event) = dynamic_event {
                        let _ = self
                            .client_view_event_tx
                            .send(ClientViewEvent::DynamicEntity(event));
                    }
                    if let Some(tick) = camera_tick {
                        self.emit_camera_event(tick);
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
