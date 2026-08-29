use super::common::{
    AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL, build_autonomous_position,
    build_motion_state_raw_motion_state, encode_contact_long_jump,
    has_autonomous_position_sync_target, normalize_heading, raw_motion_state_with_motion_style,
    signed_heading_delta,
};
use crate::client::movement_types::{
    AutonomousDriveIntent, CharacterDrive, LongitudinalMotion, MotionStyle, MovementPacketMetadata,
    PlayerDriveIntent, Turn,
};
use anyhow::Result;
use holtburger_common::sequence::is_newer_u16;
use holtburger_common::{Guid, Quaternion, RigidTransform, Vector3};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::RawMotionState;
use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionItem};
use holtburger_session::Session;
use holtburger_world::context::WorldContextExt as _;
use holtburger_world::motion::MotionCommand;
use holtburger_world::spatial::{
    ContactState, LocalDriveControl, LocalDriveGait, RETAIL_INTERPOLATION_TARGET_THRESHOLD_M,
    retail_interpolated_speed,
};
use holtburger_world::{SpatialBodyId, WorldEvent, WorldState};
use std::time::{Duration, Instant};

#[derive(Debug, Default)]
struct MovementSequenceDiagnostics {
    last_force_position_sequence: Option<u16>,
    last_teleport_sequence: Option<u16>,
    last_server_control_sequence: Option<u16>,
}

impl MovementSequenceDiagnostics {
    fn record_force_position_sequence(&mut self, force_position_sequence: u16) {
        if let Some(old_seq) = self.last_force_position_sequence {
            if is_newer_u16(force_position_sequence, old_seq) {
                log::warn!(
                    "Server forced reposition (rubber band): force seq {} -> {}",
                    old_seq,
                    force_position_sequence
                );
            } else if force_position_sequence != old_seq {
                log::debug!(
                    "Ignoring stale forced reposition: force seq {} after {}",
                    force_position_sequence,
                    old_seq
                );
            }
        }

        self.last_force_position_sequence = Some(force_position_sequence);
    }

    fn record_autonomous_position_sequences(
        &mut self,
        teleport_sequence: u16,
        force_position_sequence: u16,
        server_control_sequence: u16,
    ) {
        match self.last_teleport_sequence {
            Some(old_seq) if is_newer_u16(teleport_sequence, old_seq) => {
                log::info!(
                    "Server-forced resync teleport epoch advanced: teleport seq {} -> {} (force seq {}, server-control seq {})",
                    old_seq,
                    teleport_sequence,
                    force_position_sequence,
                    server_control_sequence
                );
            }
            Some(old_seq) if teleport_sequence != old_seq => {
                log::debug!(
                    "Ignoring stale server-forced resync: teleport seq {} after {} (force seq {}, server-control seq {})",
                    teleport_sequence,
                    old_seq,
                    force_position_sequence,
                    server_control_sequence
                );
            }
            None => {
                log::info!(
                    "Tracking teleport sequence {} for autonomous resync (force seq {}, server-control seq {})",
                    teleport_sequence,
                    force_position_sequence,
                    server_control_sequence
                );
            }
            _ => {}
        }

        self.last_teleport_sequence = Some(teleport_sequence);
        self.last_force_position_sequence = Some(force_position_sequence);
        self.last_server_control_sequence = Some(server_control_sequence);
    }

    fn record_server_control_sequence(&mut self, server_control_sequence: u16) {
        match self.last_server_control_sequence {
            Some(old_seq) if is_newer_u16(server_control_sequence, old_seq) => {
                log::debug!(
                    "Server-controlled motion epoch advanced: {} -> {}",
                    old_seq,
                    server_control_sequence
                );
            }
            Some(old_seq) if server_control_sequence != old_seq => {
                log::warn!(
                    "Server-controlled motion reordered/stale: {} after {}",
                    server_control_sequence,
                    old_seq
                );
            }
            None => {
                log::debug!(
                    "Tracking server-controlled motion sequence: {}",
                    server_control_sequence
                );
            }
            _ => {}
        }

        self.last_server_control_sequence = Some(server_control_sequence);
    }
}

pub(crate) struct MovementSystem {
    sequence_diagnostics: MovementSequenceDiagnostics,
    queued_drive_commands: Vec<QueuedDriveCommand>,
    pending_transient_motion: Option<TransientMotionIntent>,
    pending_arrival_pose: Option<holtburger_common::position::WorldPosition>,
    pending_snap_facing: Option<f32>,
    active_drive: Option<ActiveDriveState>,
    /// One local authored stop order awaiting the simulation tick that owns cursor advancement.
    pending_manual_playback_stop: bool,
    server_motion_active: bool,
    last_server_motion_intent: Option<ServerMotionIntent>,
    suppress_frontend_autonomous_once: bool,
    server_controlled_projection: Option<ServerControlledProjection>,
    /// Whether the active server-controlled target is a MoveTo whose heading is owned by the
    /// movement manager (`CPhysicsObj::IsMovingTo`, `acclient.c:311519-311520`).
    server_controlled_keep_heading: bool,
    next_autonomous_position_heartbeat_at: Option<Instant>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum QueuedDriveCommand {
    ManualSet(CharacterDrive),
    ManualPulse {
        state: CharacterDrive,
        duration: Duration,
    },
    Autonomous(AutonomousDriveIntent),
    Transient(TransientMotionIntent),
    ArriveAtPose {
        pose: holtburger_common::position::WorldPosition,
    },
    SnapFacing {
        heading: f32,
    },
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ActiveDriveIntent {
    Manual(CharacterDrive),
    Autonomous(AutonomousDriveIntent),
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ActiveDriveState {
    intent: ActiveDriveIntent,
    until: Option<Instant>,
}

impl ActiveDriveState {
    fn manual(state: CharacterDrive, until: Option<Instant>) -> Self {
        Self {
            intent: ActiveDriveIntent::Manual(state),
            until,
        }
    }

    fn autonomous(intent: AutonomousDriveIntent) -> Self {
        Self {
            intent: ActiveDriveIntent::Autonomous(intent),
            until: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ServerMotionIntent {
    state: CharacterDrive,
    motion_style: MotionStyle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TransientMotionIntent {
    command: InterpretedMotionCommand,
    motion_style: MotionStyle,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ServerControlledProjection {
    pub target_pose: holtburger_common::position::WorldPosition,
    pub speed_mps: f32,
}

fn server_motion_intent(state: CharacterDrive, motion_style: MotionStyle) -> ServerMotionIntent {
    ServerMotionIntent {
        state,
        motion_style,
    }
}

impl MovementSystem {
    pub(crate) fn new() -> Self {
        Self {
            sequence_diagnostics: MovementSequenceDiagnostics::default(),
            queued_drive_commands: Vec::new(),
            pending_transient_motion: None,
            pending_arrival_pose: None,
            pending_snap_facing: None,
            active_drive: None,
            pending_manual_playback_stop: false,
            server_motion_active: false,
            last_server_motion_intent: None,
            suppress_frontend_autonomous_once: false,
            server_controlled_projection: None,
            server_controlled_keep_heading: false,
            next_autonomous_position_heartbeat_at: None,
        }
    }

    pub(crate) fn note_server_controlled_movement_started(&mut self) {
        self.suppress_frontend_autonomous_once = true;
        self.pending_manual_playback_stop = false;
    }

    pub(crate) fn set_server_controlled_projection(
        &mut self,
        projection: ServerControlledProjection,
    ) {
        self.set_server_controlled_projection_with_heading(projection, false);
    }

    pub(crate) fn set_server_controlled_projection_with_heading(
        &mut self,
        projection: ServerControlledProjection,
        keep_heading: bool,
    ) {
        self.server_controlled_projection = Some(projection);
        self.server_controlled_keep_heading = keep_heading;
        self.pending_manual_playback_stop = false;
    }

    pub(crate) fn clear_server_controlled_projection(&mut self) {
        self.server_controlled_projection = None;
        self.server_controlled_keep_heading = false;
    }

    /// Retires every movement product owned by the current world-placement epoch.
    ///
    /// World activation rejects frontend drive commands while the destination is hidden. Clearing
    /// authority state here prevents a pre-activation held drive or queued command from resuming
    /// after that rejection boundary. Protocol sequence diagnostics intentionally survive because
    /// the connected session and its server-authored ordering epochs remain continuous.
    pub(crate) fn retire_movement_epoch(&mut self) {
        self.queued_drive_commands.clear();
        self.pending_transient_motion = None;
        self.pending_arrival_pose = None;
        self.pending_snap_facing = None;
        self.active_drive = None;
        self.pending_manual_playback_stop = false;
        self.server_motion_active = false;
        self.last_server_motion_intent = None;
        self.suppress_frontend_autonomous_once = false;
        self.clear_server_controlled_projection();
        self.clear_autonomous_position_heartbeat_schedule();
    }

    pub(crate) fn has_active_manual_drive(&self) -> bool {
        matches!(
            self.active_drive,
            Some(ActiveDriveState {
                intent: ActiveDriveIntent::Manual(_),
                ..
            })
        ) && !self.has_server_controlled_projection()
    }

    /// Whether the local adapter, rather than the authoritative snapshot scan, drives this tick.
    pub(crate) fn drives_local_authored_playback_this_tick(&self) -> bool {
        self.has_active_manual_drive() || self.pending_manual_playback_stop
    }

    pub(crate) fn has_server_controlled_projection(&self) -> bool {
        self.server_controlled_projection.is_some()
    }

    fn clear_autonomous_position_heartbeat_schedule(&mut self) {
        self.next_autonomous_position_heartbeat_at = None;
    }

    pub(crate) fn arm_autonomous_position_heartbeat_schedule(
        &mut self,
        now: Instant,
        world: &WorldState,
    ) {
        self.refresh_autonomous_position_heartbeat_schedule(now, world);
    }

    fn refresh_autonomous_position_heartbeat_schedule(&mut self, now: Instant, world: &WorldState) {
        self.next_autonomous_position_heartbeat_at = has_autonomous_position_sync_target(world)
            .then_some(now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL);
    }

    pub(crate) fn enqueue_drive_intent(&mut self, intent: PlayerDriveIntent, now: Instant) {
        let _ = now;
        let command = match intent {
            PlayerDriveIntent::ManualHeld(state) => QueuedDriveCommand::ManualSet(state),
            PlayerDriveIntent::ManualPulse { state, duration } => {
                QueuedDriveCommand::ManualPulse { state, duration }
            }
            PlayerDriveIntent::Autonomous(intent) => QueuedDriveCommand::Autonomous(intent),
            PlayerDriveIntent::ArriveAtPose { pose } => QueuedDriveCommand::ArriveAtPose { pose },
            PlayerDriveIntent::SnapFacing { heading } => QueuedDriveCommand::SnapFacing { heading },
            PlayerDriveIntent::Stop => QueuedDriveCommand::Stop,
        };

        self.queued_drive_commands.push(command);
    }

    pub(crate) fn enqueue_transient_motion(
        &mut self,
        command: InterpretedMotionCommand,
        motion_style: MotionStyle,
    ) {
        self.queued_drive_commands
            .push(QueuedDriveCommand::Transient(TransientMotionIntent {
                command,
                motion_style,
            }));
    }

    fn ingest_drive_command(&mut self, command: QueuedDriveCommand, now: Instant) {
        let had_manual_drive = matches!(
            self.active_drive,
            Some(ActiveDriveState {
                intent: ActiveDriveIntent::Manual(_),
                ..
            })
        );
        match command {
            QueuedDriveCommand::ManualSet(state) => {
                self.active_drive = Some(ActiveDriveState::manual(state, None));
                self.pending_manual_playback_stop = false;
            }
            QueuedDriveCommand::ManualPulse { state, duration } => {
                self.active_drive = Some(ActiveDriveState::manual(state, Some(now + duration)));
                self.pending_manual_playback_stop = false;
            }
            QueuedDriveCommand::Autonomous(intent) => {
                self.active_drive = Some(ActiveDriveState::autonomous(intent));
                self.pending_manual_playback_stop = false;
            }
            QueuedDriveCommand::Transient(intent) => {
                self.pending_transient_motion = Some(intent);
            }
            QueuedDriveCommand::ArriveAtPose { pose } => {
                self.pending_arrival_pose = Some(pose);
                self.active_drive = None;
                self.pending_manual_playback_stop |= had_manual_drive;
            }
            QueuedDriveCommand::SnapFacing { heading } => {
                self.pending_snap_facing = Some(heading);
            }
            QueuedDriveCommand::Stop => {
                self.pending_arrival_pose = None;
                self.pending_snap_facing = None;
                self.active_drive = None;
                self.pending_manual_playback_stop |= had_manual_drive;
            }
        }
    }

    fn expire_active_drive(&mut self, now: Instant) {
        if self
            .active_drive
            .is_some_and(|active| matches!(active.intent, ActiveDriveIntent::Autonomous(_)))
        {
            self.active_drive = None;
        }

        let Some(active) = self.active_drive else {
            return;
        };

        if active.until.is_some_and(|until| now >= until) {
            log::info!(
                "movement: expiring active drive {:?} at tick {:?}",
                active.intent,
                now,
            );
            self.active_drive = None;
            self.pending_manual_playback_stop =
                matches!(active.intent, ActiveDriveIntent::Manual(_));
        }
    }

    fn autonomous_wire_motion_state(
        world: &WorldState,
        intent: AutonomousDriveIntent,
    ) -> Option<CharacterDrive> {
        let current_heading = world
            .local_player_runtime_pose()
            .unwrap_or_default()
            .rotation
            .to_heading();
        let planar_delta = Vector3::new(
            intent.desired_world_delta.x,
            intent.desired_world_delta.y,
            0.0,
        );
        let longitudinal =
            (planar_delta.length_squared() > 1e-6).then_some(LongitudinalMotion::Forward);
        let desired_heading = intent.desired_heading.map(normalize_heading).or_else(|| {
            (planar_delta.length_squared() > 1e-6)
                .then(|| Vector3::zero().heading_to(&planar_delta))
        });
        let turning = if longitudinal.is_some() {
            None
        } else {
            desired_heading.and_then(|desired_heading| {
                let delta = signed_heading_delta(current_heading, desired_heading);
                if delta.abs() <= 1e-4 {
                    None
                } else if delta > 0.0 {
                    Some(Turn::Right)
                } else {
                    Some(Turn::Left)
                }
            })
        };

        if longitudinal.is_none() && turning.is_none() {
            return None;
        }

        // The shared solver owns local realization, but ACE still needs a
        // MoveToState edge so observers receive motion-state broadcasts.
        Some(CharacterDrive {
            gait: intent.gait,
            longitudinal,
            lateral: None,
            turning,
            turn_rate_scalar: None,
        })
    }

    pub(crate) async fn tick(
        &mut self,
        now: Instant,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<WorldEvent>> {
        self.reconcile_server_controlled_projection(world);

        let had_active_manual_motion = matches!(
            self.active_drive,
            Some(ActiveDriveState {
                intent: ActiveDriveIntent::Manual(_),
                ..
            })
        );

        self.expire_active_drive(now);

        let queued = std::mem::take(&mut self.queued_drive_commands);
        if !queued.is_empty() {
            log::info!(
                "movement: ingesting {} queued drive commands at tick {:?}: {:?}",
                queued.len(),
                now,
                queued,
            );
        }
        let explicit_stop_requested = queued
            .iter()
            .any(|command| matches!(command, QueuedDriveCommand::Stop));
        for command in queued {
            self.ingest_drive_command(command, now);
        }

        if self.suppress_frontend_autonomous_once
            && matches!(
                self.active_drive,
                Some(ActiveDriveState {
                    intent: ActiveDriveIntent::Autonomous(_),
                    ..
                })
            )
        {
            log::info!(
                "movement: suppressing frontend autonomous wire motion during server-controlled movement"
            );
            self.active_drive = None;
        }
        self.suppress_frontend_autonomous_once = false;

        let mut events = Vec::new();
        if let Some(pose) = self.pending_arrival_pose.take() {
            events.extend(
                self.execute_arrival_pose(
                    now,
                    pose,
                    world,
                    session,
                    MovementPacketMetadata::default(),
                )
                .await?,
            );
        }
        if let Some(heading) = self.pending_snap_facing.take() {
            events.extend(
                self.execute_snap_facing(
                    now,
                    heading,
                    world,
                    session,
                    MovementPacketMetadata::default(),
                )
                .await?,
            );
        }

        let transient_sent = if let Some(intent) = self.pending_transient_motion.take() {
            self.execute_transient_motion_at(intent, world, session)
                .await?;
            true
        } else {
            false
        };

        if !transient_sent {
            match self.active_drive.map(|active| active.intent) {
                Some(ActiveDriveIntent::Manual(state)) => events.extend(
                    self.execute_motion_state_at(state, world, session, now)
                        .await?,
                ),
                Some(ActiveDriveIntent::Autonomous(intent)) => events.extend(
                    self.execute_autonomous_drive_intent(intent, world, session, now)
                        .await?,
                ),
                None if had_active_manual_motion || explicit_stop_requested => {
                    events.extend(
                        self.execute_stop_at(
                            now,
                            world,
                            session,
                            MovementPacketMetadata::default(),
                            had_active_manual_motion || explicit_stop_requested,
                        )
                        .await?,
                    );
                }
                None => {}
            }
        }

        let _ = self
            .maybe_send_autonomous_position_heartbeat(
                now,
                world,
                session,
                MovementPacketMetadata::default(),
            )
            .await?;

        Ok(events)
    }

    pub(crate) fn current_local_drive_control(
        &self,
        world: &WorldState,
        dt: Duration,
    ) -> Option<LocalDriveControl> {
        if world.player.guid == Guid::NULL {
            return None;
        }

        let body_id = SpatialBodyId::LocalPlayer(world.player.guid);

        if let Some(projection) = self.server_controlled_projection {
            let current_pose = world.local_player_runtime_pose().unwrap_or_default();
            let to_target = projection.target_pose.global_coords() - current_pose.global_coords();
            let max_speed = retail_interpolated_speed(Some(projection.speed_mps));
            let max_step = max_speed * dt.as_secs_f32().max(0.0);
            let desired_world_delta = if to_target.length_squared() <= 1e-6 {
                Vector3::zero()
            } else {
                let distance = to_target.length();
                if distance <= max_step {
                    to_target
                } else {
                    to_target.normalize() * max_step
                }
            };

            let desired_heading = if self.server_controlled_keep_heading {
                None
            } else if desired_world_delta.length_squared() > 1e-6 {
                Some(current_pose.heading_to(&projection.target_pose))
            } else {
                Some(projection.target_pose.rotation.to_heading())
            };

            return Some(LocalDriveControl {
                body_id,
                desired_world_delta,
                desired_heading,
                target_hint: Some(projection.target_pose),
                gait: if projection.speed_mps > 1.0 {
                    LocalDriveGait::Run
                } else {
                    LocalDriveGait::Walk
                },
                force_grounded: true,
            });
        }

        let intent = match self.active_drive?.intent {
            ActiveDriveIntent::Autonomous(intent) => intent,
            ActiveDriveIntent::Manual(_) => return None,
        };

        Some(LocalDriveControl {
            body_id,
            desired_world_delta: intent.desired_world_delta,
            desired_heading: intent.desired_heading,
            target_hint: intent.target_hint,
            gait: match intent.gait {
                crate::client::movement_types::Gait::Walk => LocalDriveGait::Walk,
                crate::client::movement_types::Gait::Run => LocalDriveGait::Run,
            },
            force_grounded: intent.force_grounded,
        })
    }

    /// Advances the held local drive's authored motion once and returns that exact tick offset.
    ///
    /// Local prediction begins immediately while the authoritative snapshot may arrive later, but
    /// both root actuation and presentation read the same world-owned cursor. No velocity is
    /// reconstructed here; the returned offset is consumed by the shared physical actuation
    /// boundary.
    pub(crate) fn advance_local_manual_motion(
        &mut self,
        world: &mut WorldState,
        dt: Duration,
    ) -> Result<Option<RigidTransform>> {
        // Server-directed movement owns the ordinary physical basis until its target is reached.
        // Keep the semantic held drive alive for one post-control handoff, but do not advance its
        // authored cursor while the server-directed drive is active.
        if self.has_server_controlled_projection() {
            return Ok(None);
        }
        let (state, run_rate) = match self.active_drive {
            Some(ActiveDriveState {
                intent: ActiveDriveIntent::Manual(state),
                ..
            }) => {
                let run_rate = world
                    .player_run_rate()
                    .ok_or_else(|| anyhow::anyhow!("manual local run-rate is unavailable"))?;
                (state, run_rate)
            }
            _ if std::mem::take(&mut self.pending_manual_playback_stop) => {
                (CharacterDrive::builder().walk().build(), 1.0)
            }
            _ => return Ok(None),
        };

        let guid = world.player.guid;
        if guid == Guid::NULL || dt.is_zero() {
            return Ok(None);
        }

        let resolution = world
            .resolve_player_motion_table_profile()
            .map_err(|error| anyhow::anyhow!("manual local motion table unavailable: {error}"))?;
        let stance = world
            .player_entity()
            .and_then(|entity| entity.motion_snapshot)
            .and_then(|snapshot| snapshot.current_style)
            .or(world.player.last_server_motion_style)
            .map(|style| MotionCommand(style as u32))
            .unwrap_or(MotionCommand(resolution.movement_profile.stance));
        let mut order = crate::motion_order_for_drive(state, run_rate, stance)
            .map_err(|error| anyhow::anyhow!("manual local motion order invalid: {error}"))?;
        let body_id = SpatialBodyId::LocalPlayer(guid);
        let contact = world
            .runtime_body_view(body_id)
            .map(|body| body.contact)
            .unwrap_or(ContactState::Unknown);
        if contact != ContactState::Grounded {
            // Retail accepts turn-in-place while unsupported but gates planar locomotion until a
            // walkable contact returns (`CMotionInterp::contact_allows_move`, `acclient.c:330443`).
            order.forward = None;
            order.sidestep = None;
        }

        let offset = world
            .drive_authored_motion_for_body(guid, order, dt)
            .map_err(|error| anyhow::anyhow!("manual local authored playback failed: {error}"))?;
        Ok(Some(offset))
    }

    fn reconcile_server_controlled_projection(&mut self, world: &WorldState) {
        let Some(projection) = self.server_controlled_projection else {
            return;
        };
        let Some(current_pose) = world.local_player_runtime_pose() else {
            return;
        };

        if current_pose.landblock_id != projection.target_pose.landblock_id {
            return;
        }

        if current_pose.distance_to(&projection.target_pose)
            <= RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
        {
            log::info!(
                "movement: completed server-controlled projection at {:?}",
                projection.target_pose
            );
            self.server_controlled_projection = None;
        }
    }

    pub(crate) fn record_force_position_sequence(&mut self, force_position_sequence: u16) {
        self.sequence_diagnostics
            .record_force_position_sequence(force_position_sequence);
    }

    pub(crate) fn record_autonomous_position_sequences(
        &mut self,
        teleport_sequence: u16,
        force_position_sequence: u16,
        server_control_sequence: u16,
    ) {
        self.sequence_diagnostics
            .record_autonomous_position_sequences(
                teleport_sequence,
                force_position_sequence,
                server_control_sequence,
            );
    }

    pub(crate) fn record_server_control_sequence(&mut self, server_control_sequence: u16) {
        self.sequence_diagnostics
            .record_server_control_sequence(server_control_sequence);
    }

    fn should_send_stop_pulse(&self) -> bool {
        self.server_motion_active
    }

    fn note_server_motion_sent(&mut self, intent: ServerMotionIntent) {
        self.server_motion_active = true;
        self.last_server_motion_intent = Some(intent);
    }

    fn note_transient_motion_sent(&mut self) {
        self.server_motion_active = true;
        self.last_server_motion_intent = None;
    }

    fn note_server_motion_cleared(&mut self) {
        self.server_motion_active = false;
        self.last_server_motion_intent = None;
    }

    async fn execute_motion_state_at(
        &mut self,
        state: CharacterDrive,
        world: &mut WorldState,
        session: &mut Session,
        now: Instant,
    ) -> Result<Vec<WorldEvent>> {
        self.execute_motion_state_with_metadata_at(
            state,
            MovementPacketMetadata::default(),
            world,
            session,
            now,
        )
        .await
    }

    async fn execute_stop_at(
        &mut self,
        now: Instant,
        world: &mut WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
        had_active_local_motion: bool,
    ) -> Result<Vec<WorldEvent>> {
        let state_events = Vec::new();

        if self.should_send_stop_pulse() {
            log::info!(
                "movement: sending stop pulse (had_active_local_motion={}, server_motion_active={})",
                had_active_local_motion,
                self.server_motion_active,
            );
            Self::send_stop_pulse(world, session, metadata).await?;
            if had_active_local_motion {
                self.send_autonomous_position_sync(now, world, session, metadata)
                    .await?;
            }
            self.note_server_motion_cleared();
        }

        Ok(state_events)
    }

    async fn execute_motion_state_with_metadata_at(
        &mut self,
        state: CharacterDrive,
        metadata: MovementPacketMetadata,
        world: &mut WorldState,
        session: &mut Session,
        _now: Instant,
    ) -> Result<Vec<WorldEvent>> {
        let state_events = Vec::new();

        if self.should_send_motion_state_pulse(state, metadata.motion_style) {
            log::info!("movement: sending resolved motion pulse state={:?}", state);
            Self::send_motion_state_pulse(world, session, state, metadata).await?;
            self.note_server_motion_sent(server_motion_intent(state, metadata.motion_style));
        }

        Ok(state_events)
    }

    async fn execute_transient_motion_at(
        &mut self,
        intent: TransientMotionIntent,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<()> {
        let movement_sequence = world.player.next_move_seq();
        let raw_motion_state = raw_motion_state_with_motion_style(
            world,
            RawMotionState {
                commands: vec![MotionItem::new(
                    intent.command,
                    movement_sequence,
                    true,
                    1.0,
                )],
                ..Default::default()
            },
            intent.motion_style,
        );
        Self::send_transient_motion_pulse(world, session, raw_motion_state).await?;
        self.note_transient_motion_sent();
        Ok(())
    }

    async fn execute_snap_facing(
        &mut self,
        now: Instant,
        desired_heading: f32,
        world: &mut WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<Vec<WorldEvent>> {
        let normalized_heading = normalize_heading(desired_heading);
        let Some(current_pose) = world.local_player_runtime_pose() else {
            return Ok(Vec::new());
        };
        let current_heading = current_pose.rotation.to_heading();

        log::info!(
            "movement: snap facing from {:.3} rad to {:.3} rad",
            current_heading,
            normalized_heading,
        );

        if signed_heading_delta(current_heading, normalized_heading).abs() <= 1e-4 {
            return Ok(Vec::new());
        }

        let mut next_pos = current_pose;
        next_pos.rotation = Quaternion::from_heading(normalized_heading);
        let world_events = world.set_local_player_runtime_pose(next_pos);

        self.send_autonomous_position_sync(now, world, session, metadata)
            .await?;

        Ok(world_events)
    }

    async fn execute_arrival_pose(
        &mut self,
        now: Instant,
        pose: holtburger_common::position::WorldPosition,
        world: &mut WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<Vec<WorldEvent>> {
        log::info!("movement: applying arrival pose {:?}", pose);

        let world_events = world.set_local_player_runtime_pose(pose);
        self.send_autonomous_position_sync(now, world, session, metadata)
            .await?;

        Self::send_stop_pulse(world, session, metadata).await?;
        self.note_server_motion_cleared();

        Ok(world_events)
    }

    async fn execute_autonomous_drive_intent(
        &mut self,
        intent: AutonomousDriveIntent,
        world: &mut WorldState,
        session: &mut Session,
        now: Instant,
    ) -> Result<Vec<WorldEvent>> {
        let world_events = Vec::new();

        if let Some(state) = Self::autonomous_wire_motion_state(world, intent) {
            self.execute_motion_state_with_metadata_at(
                state,
                MovementPacketMetadata::default(),
                world,
                session,
                now,
            )
            .await?;

            return Ok(world_events);
        }

        if self.should_send_stop_pulse() {
            self.execute_stop_at(
                now,
                world,
                session,
                MovementPacketMetadata::default(),
                false,
            )
            .await?;
        }

        Ok(world_events)
    }

    async fn maybe_send_autonomous_position_heartbeat(
        &mut self,
        now: Instant,
        world: &WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<bool> {
        let Some(next_heartbeat_at) = self.next_autonomous_position_heartbeat_at else {
            if has_autonomous_position_sync_target(world) {
                self.next_autonomous_position_heartbeat_at =
                    Some(now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL);
            }
            return Ok(false);
        };

        if now < next_heartbeat_at {
            return Ok(false);
        }

        let Some(pulse) = build_autonomous_position(world, metadata) else {
            self.clear_autonomous_position_heartbeat_schedule();
            return Ok(false);
        };

        session
            .send_action(GameAction::AutonomousPosition(Box::new(pulse)))
            .await?;

        if has_autonomous_position_sync_target(world) {
            self.refresh_autonomous_position_heartbeat_schedule(now, world);
        } else {
            self.clear_autonomous_position_heartbeat_schedule();
        }

        Ok(true)
    }

    pub(crate) async fn send_autonomous_position_sync(
        &mut self,
        now: Instant,
        world: &WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<bool> {
        let Some(pulse) = build_autonomous_position(world, metadata) else {
            self.clear_autonomous_position_heartbeat_schedule();
            return Ok(false);
        };

        session
            .send_action(GameAction::AutonomousPosition(Box::new(pulse)))
            .await?;

        self.refresh_autonomous_position_heartbeat_schedule(now, world);

        Ok(true)
    }

    fn should_send_motion_state_pulse(
        &self,
        state: CharacterDrive,
        motion_style: MotionStyle,
    ) -> bool {
        if !self.server_motion_active {
            return true;
        }

        self.last_server_motion_intent != Some(server_motion_intent(state, motion_style))
    }

    async fn send_motion_state_pulse(
        world: &WorldState,
        session: &mut Session,
        state: CharacterDrive,
        metadata: MovementPacketMetadata,
    ) -> Result<()> {
        let data = holtburger_protocol::messages::game_action::MoveToStateActionData {
            raw_motion_state: build_motion_state_raw_motion_state(
                world,
                state,
                metadata.motion_style,
            ),
            position: world.local_player_runtime_pose().unwrap_or_default(),
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(world, metadata),
        };

        session
            .send_action(GameAction::MoveToState(Box::new(data)))
            .await
    }

    async fn send_transient_motion_pulse(
        world: &WorldState,
        session: &mut Session,
        raw_motion_state: RawMotionState,
    ) -> Result<()> {
        let data = MoveToStateActionData {
            raw_motion_state,
            position: world.local_player_runtime_pose().unwrap_or_default(),
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(world, MovementPacketMetadata::default()),
        };

        session
            .send_action(GameAction::MoveToState(Box::new(data)))
            .await
    }

    async fn send_stop_pulse(
        world: &WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<()> {
        let data = holtburger_protocol::messages::game_action::MoveToStateActionData {
            raw_motion_state: raw_motion_state_with_motion_style(
                world,
                RawMotionState::default(),
                metadata.motion_style,
            ),
            position: world.local_player_runtime_pose().unwrap_or_default(),
            instance_sequence: world.player.instance_sequence,
            server_control_sequence: world.player.server_control_sequence,
            teleport_sequence: world.player.teleport_sequence,
            force_position_sequence: world.player.force_position_sequence,
            contact_long_jump: encode_contact_long_jump(world, metadata),
        };

        session
            .send_action(GameAction::MoveToState(Box::new(data)))
            .await
    }
}

#[cfg(test)]
mod tests;
