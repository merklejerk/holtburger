use crate::client::movement_types::{
    AutonomousDriveIntent, Gait, Locomotion, MotionState, MotionStyle,
    MovementPacketMetadata, PlayerDriveIntent, Turn, planar_velocity_for_heading,
};
use anyhow::Result;
#[cfg(test)]
use holtburger_common::position::WorldPosition;
use holtburger_common::sequence::is_newer_u16;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::{RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::context::WorldContextExt;
use holtburger_world::spatial::LocalDriveControl;
use holtburger_world::SolveBodyInput;
use holtburger_world::{SpatialBodyId, WorldEvent, WorldState};
use std::f32::consts::{PI, TAU};
use std::time::{Duration, Instant};

// ACE's movement packets carry a run-rate / speed scalar, not a standalone
// "already world-space" speed constant divorced from animation. In the retail
// math that scalar is applied against the run animation base speed, and after
// the engine's unit conversion it ends up numerically matching our meters/sec
// representation. That coincidence is useful, but it is also the trap: this
// value is the *maximum* run speed for a fully capped player, not the speed
// every character should emit or simulate.
const SERVER_RUN_SPEED: f32 = 4.5;
const AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
const WALK_FORWARD_MOTION_COMMAND: u32 = 0x4500_0005;
const WALK_BACKWARD_MOTION_COMMAND: u32 = 0x4500_0006;
const TURN_RIGHT_MOTION_COMMAND: u32 = 0x6500_000d;
const TURN_LEFT_MOTION_COMMAND: u32 = 0x6500_000e;
const SIDESTEP_RIGHT_MOTION_COMMAND: u32 = 0x6500_000f;
const SIDESTEP_LEFT_MOTION_COMMAND: u32 = 0x6500_0010;
const RUN_HELD_TURN_SPEED_RAD_PER_SEC: f32 = 1.5;
const NON_RUN_HELD_TURN_SPEED_RAD_PER_SEC: f32 = 1.0;

fn signed_heading_delta(current_heading: f32, desired_heading: f32) -> f32 {
    let mut delta = (desired_heading - current_heading) % TAU;
    if delta <= -PI {
        delta += TAU;
    } else if delta > PI {
        delta -= TAU;
    }
    delta
}

fn normalize_heading(heading: f32) -> f32 {
    heading.rem_euclid(TAU)
}

fn raw_motion_state_with_motion_style(
    world: &WorldState,
    mut raw_motion_state: RawMotionState,
    motion_style: MotionStyle,
) -> RawMotionState {
    match motion_style {
        MotionStyle::PreserveServer => {
            if let Some(current_style) = world.player.last_server_motion_style {
                raw_motion_state.set_current_stance(current_style);
            }
        }
        MotionStyle::Explicit(current_style) => {
            raw_motion_state.set_current_stance(current_style);
        }
        MotionStyle::Omit => {
            raw_motion_state.flags.remove(RawMotionFlags::CURRENT_STYLE);
            raw_motion_state.current_style = None;
        }
    }

    raw_motion_state
}

fn resolve_contact(world: &WorldState, metadata: MovementPacketMetadata) -> bool {
    metadata
        .contact
        .or(world.player.server_grounded)
        .unwrap_or(true)
}

fn encode_contact_long_jump(world: &WorldState, metadata: MovementPacketMetadata) -> u8 {
    u8::from(resolve_contact(world, metadata))
}

fn encode_last_contact(world: &WorldState, metadata: MovementPacketMetadata) -> u8 {
    u8::from(resolve_contact(world, metadata))
}

fn has_active_autonomous_position_motion(world: &WorldState) -> bool {
    let Some((_, velocity, omega)) = world.local_player_runtime_kinematics() else {
        return false;
    };

    velocity.length_squared() >= 0.0001 || omega.length_squared() >= 0.0001
}

fn build_autonomous_position(
    world: &WorldState,
    metadata: MovementPacketMetadata,
) -> Option<AutonomousPositionActionData> {
    let position = world.local_player_runtime_pose()?;
    if world.player.guid == Guid::NULL || position.landblock_id == Guid::NULL {
        return None;
    }

    Some(AutonomousPositionActionData {
        position,
        instance_sequence: world.player.instance_sequence,
        server_control_sequence: world.player.server_control_sequence,
        teleport_sequence: world.player.teleport_sequence,
        force_position_sequence: world.player.force_position_sequence,
        last_contact: encode_last_contact(world, metadata),
    })
}

fn hold_key_for_motion_state(state: MotionState) -> HoldKey {
    match state.gait {
        Gait::Run => HoldKey::Run,
        Gait::Walk => HoldKey::None,
    }
}

fn player_run_speed_mps(world: &WorldState) -> f32 {
    // Keep the outgoing ForwardSpeed/SidestepSpeed scalar and the local runtime
    // body on the same ACE-derived run-rate. Hardcoding 4.5 here causes high
    // run-skill characters to overdrive the local/runtime simulation and packet
    // stream until the server corrects them.
    world.player_run_rate().unwrap_or(SERVER_RUN_SPEED)
}

fn locomotion_command_for_state(
    locomotion: Locomotion,
    gait: Gait,
    run_speed_mps: f32,
) -> (u32, f32) {
    match (gait, locomotion) {
        (Gait::Run, Locomotion::Forward) => (WALK_FORWARD_MOTION_COMMAND, run_speed_mps),
        (Gait::Walk, Locomotion::Forward) => (WALK_FORWARD_MOTION_COMMAND, 1.0),
        (_, Locomotion::Backstep) => (WALK_BACKWARD_MOTION_COMMAND, 1.0),
        (_, Locomotion::StrafeLeft) => (SIDESTEP_LEFT_MOTION_COMMAND, 1.0),
        (_, Locomotion::StrafeRight) => (SIDESTEP_RIGHT_MOTION_COMMAND, 1.0),
    }
}

fn turn_motion_command_for_state(turn: Turn) -> u32 {
    match turn {
        Turn::Left => TURN_LEFT_MOTION_COMMAND,
        Turn::Right => TURN_RIGHT_MOTION_COMMAND,
    }
}

fn build_motion_state_raw_motion_state(
    world: &WorldState,
    state: MotionState,
    motion_style: MotionStyle,
) -> RawMotionState {
    let run_speed_mps = player_run_speed_mps(world);
    let axis_hold_key = hold_key_for_motion_state(state) as u32;
    let mut raw_motion_state = RawMotionState {
        flags: RawMotionFlags::CURRENT_HOLD_KEY,
        current_hold_key: Some(axis_hold_key),
        ..Default::default()
    };

    if let Some(locomotion) = state.locomotion {
        let (command, speed) = locomotion_command_for_state(locomotion, state.gait, run_speed_mps);
        match locomotion {
            Locomotion::Forward | Locomotion::Backstep => {
                raw_motion_state.flags |=
                    RawMotionFlags::FORWARD_COMMAND
                        | RawMotionFlags::FORWARD_HOLD_KEY
                        | RawMotionFlags::FORWARD_SPEED;
                raw_motion_state.forward_command = Some(command);
                raw_motion_state.forward_hold_key = Some(axis_hold_key);
                raw_motion_state.forward_speed = Some(speed);
            }
            Locomotion::StrafeLeft | Locomotion::StrafeRight => {
                raw_motion_state.flags |=
                    RawMotionFlags::SIDE_STEP_COMMAND
                        | RawMotionFlags::SIDE_STEP_HOLD_KEY
                        | RawMotionFlags::SIDE_STEP_SPEED;
                raw_motion_state.sidestep_command = Some(command);
                raw_motion_state.sidestep_hold_key = Some(axis_hold_key);
                raw_motion_state.sidestep_speed = Some(speed);
            }
        }
    }

    if let Some(turn) = state.turning {
        raw_motion_state.flags |=
            RawMotionFlags::TURN_COMMAND | RawMotionFlags::TURN_HOLD_KEY | RawMotionFlags::TURN_SPEED;
        raw_motion_state.turn_command = Some(turn_motion_command_for_state(turn));
        raw_motion_state.turn_hold_key = Some(axis_hold_key);
        raw_motion_state.turn_speed = Some(turn_speed_for_state(state));
    }

    raw_motion_state_with_motion_style(world, raw_motion_state, motion_style)
}

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

pub(super) struct MovementSystem {
    sequence_diagnostics: MovementSequenceDiagnostics,
    queued_drive_commands: Vec<QueuedDriveCommand>,
    pending_snap_facing: Option<f32>,
    active_drive: Option<ActiveDriveState>,
    server_motion_active: bool,
    last_server_motion_intent: Option<ServerMotionIntent>,
    next_autonomous_position_heartbeat_at: Option<Instant>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum QueuedDriveCommand {
    ManualSet(MotionState),
    ManualPulse {
        state: MotionState,
        duration: Duration,
    },
    Autonomous(AutonomousDriveIntent),
    SnapFacing {
        heading: f32,
    },
    Stop,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ActiveDriveIntent {
    Manual(MotionState),
    Autonomous(AutonomousDriveIntent),
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ActiveDriveState {
    intent: ActiveDriveIntent,
    until: Option<Instant>,
}

impl ActiveDriveState {
    fn manual(state: MotionState, until: Option<Instant>) -> Self {
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
    state: MotionState,
    motion_style: MotionStyle,
}

fn server_motion_intent(state: MotionState, motion_style: MotionStyle) -> ServerMotionIntent {
    ServerMotionIntent {
        state,
        motion_style,
    }
}

fn locomotion_speed_for_state(state: MotionState, run_speed_mps: f32) -> f32 {
    match (state.gait, state.locomotion) {
        (_, None) => 0.0,
        (Gait::Run, Some(Locomotion::Forward)) => run_speed_mps,
        (Gait::Walk, Some(Locomotion::Forward)) => 1.0,
        (_, Some(Locomotion::Backstep | Locomotion::StrafeLeft | Locomotion::StrafeRight)) => 1.0,
    }
}

fn local_velocity_for_state(current_heading: f32, state: MotionState, run_speed_mps: f32) -> Vector3 {
    match state.locomotion {
        Some(Locomotion::Forward) => {
            planar_velocity_for_heading(current_heading, locomotion_speed_for_state(state, run_speed_mps))
        }
        Some(Locomotion::Backstep) => {
            planar_velocity_for_heading(normalize_heading(current_heading + PI), 1.0)
        }
        Some(Locomotion::StrafeLeft) => {
            planar_velocity_for_heading(normalize_heading(current_heading - (PI / 2.0)), 1.0)
        }
        Some(Locomotion::StrafeRight) => {
            planar_velocity_for_heading(normalize_heading(current_heading + (PI / 2.0)), 1.0)
        }
        None => Vector3::zero(),
    }
}

fn turn_speed_for_state(state: MotionState) -> f32 {
    state.turn_speed.unwrap_or(match state.gait {
        Gait::Run => RUN_HELD_TURN_SPEED_RAD_PER_SEC,
        Gait::Walk => NON_RUN_HELD_TURN_SPEED_RAD_PER_SEC,
    })
}

fn local_omega_for_state(state: MotionState) -> Vector3 {
    let turn_speed = turn_speed_for_state(state);

    match state.turning {
        Some(Turn::Right) => Vector3::new(0.0, 0.0, turn_speed),
        Some(Turn::Left) => Vector3::new(0.0, 0.0, -turn_speed),
        None => Vector3::zero(),
    }
}

impl MovementSystem {
    pub(super) fn new() -> Self {
        Self {
            sequence_diagnostics: MovementSequenceDiagnostics::default(),
            queued_drive_commands: Vec::new(),
            pending_snap_facing: None,
            active_drive: None,
            server_motion_active: false,
            last_server_motion_intent: None,
            next_autonomous_position_heartbeat_at: None,
        }
    }

    fn clear_autonomous_position_heartbeat_schedule(&mut self) {
        self.next_autonomous_position_heartbeat_at = None;
    }

    fn refresh_autonomous_position_heartbeat_schedule(
        &mut self,
        now: Instant,
        world: &WorldState,
    ) {
        self.next_autonomous_position_heartbeat_at = has_active_autonomous_position_motion(world)
            .then_some(now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL);
    }

    pub(super) fn enqueue_drive_intent(&mut self, intent: PlayerDriveIntent, now: Instant) {
        let _ = now;
        let command = match intent {
            PlayerDriveIntent::ManualHeld(state) => QueuedDriveCommand::ManualSet(state),
            PlayerDriveIntent::ManualPulse { state, duration } => {
                QueuedDriveCommand::ManualPulse { state, duration }
            }
            PlayerDriveIntent::Autonomous(intent) => QueuedDriveCommand::Autonomous(intent),
            PlayerDriveIntent::SnapFacing { heading } => QueuedDriveCommand::SnapFacing { heading },
            PlayerDriveIntent::Stop => QueuedDriveCommand::Stop,
        };

        self.queued_drive_commands.push(command);
    }

    fn ingest_drive_command(&mut self, command: QueuedDriveCommand, now: Instant) {
        match command {
            QueuedDriveCommand::ManualSet(state) => {
                self.active_drive = Some(ActiveDriveState::manual(state, None));
            }
            QueuedDriveCommand::ManualPulse { state, duration } => {
                self.active_drive = Some(ActiveDriveState::manual(
                    state,
                    Some(now + duration),
                ));
            }
            QueuedDriveCommand::Autonomous(intent) => {
                self.active_drive = Some(ActiveDriveState::autonomous(intent));
            }
            QueuedDriveCommand::SnapFacing { heading } => {
                self.pending_snap_facing = Some(heading);
            }
            QueuedDriveCommand::Stop => {
                self.pending_snap_facing = None;
                self.active_drive = None;
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
        }
    }

    fn autonomous_wire_motion_state(
        world: &WorldState,
        intent: AutonomousDriveIntent,
    ) -> Option<MotionState> {
        let current_heading = world
            .local_player_runtime_pose()
            .unwrap_or(world.player.position)
            .rotation
            .to_heading();
        let planar_delta = Vector3::new(
            intent.desired_world_delta.x,
            intent.desired_world_delta.y,
            0.0,
        );
        let locomotion = (planar_delta.length_squared() > 1e-6)
            .then_some(Locomotion::Forward);
        let desired_heading = intent
            .desired_heading
            .map(normalize_heading)
            .or_else(|| {
                (planar_delta.length_squared() > 1e-6)
                    .then(|| Vector3::zero().heading_to(&planar_delta))
            });
        let turning = desired_heading.and_then(|desired_heading| {
            let delta = signed_heading_delta(current_heading, desired_heading);
            if delta.abs() <= 1e-4 {
                None
            } else if delta > 0.0 {
                Some(Turn::Right)
            } else {
                Some(Turn::Left)
            }
        });

        if locomotion.is_none() && turning.is_none() {
            return None;
        }

        // The shared solver owns local realization, but ACE still needs a
        // MoveToState edge so observers receive motion-state broadcasts.
        Some(MotionState {
            gait: intent.gait,
            locomotion,
            turning,
            turn_speed: None,
        })
    }

    pub(super) async fn tick(
        &mut self,
        now: Instant,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<WorldEvent>> {
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
        for command in queued {
            self.ingest_drive_command(command, now);
        }

        let mut events = Vec::new();
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

        match self.active_drive.map(|active| active.intent) {
            Some(ActiveDriveIntent::Manual(state)) => events.extend(
                self.execute_motion_state_at(state, world, session, now)
                    .await?,
            ),
            Some(ActiveDriveIntent::Autonomous(intent)) => events.extend(
                self.execute_autonomous_drive_intent(intent, world, session, now)
                    .await?,
            ),
            None if had_active_manual_motion || self.server_motion_active => {
                events.extend(
                    self.execute_stop_at(
                        now,
                        world,
                        session,
                        MovementPacketMetadata::default(),
                        had_active_manual_motion,
                    )
                    .await?,
                );
            }
            None => {}
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

    pub(super) fn current_local_drive_control(&self, world: &WorldState) -> Option<LocalDriveControl> {
        if world.player.guid == Guid::NULL {
            return None;
        }

        let body_id = SpatialBodyId::LocalPlayer(world.player.guid);
        let intent = match self.active_drive?.intent {
            ActiveDriveIntent::Autonomous(intent) => intent,
            ActiveDriveIntent::Manual(_) => return None,
        };

        Some(super::simulation::ClientSimulationSystem::to_local_drive_control(
            body_id,
            intent,
        ))
    }

    pub(super) fn current_local_solve_body_input(&self, world: &WorldState) -> Option<SolveBodyInput> {
        let guid = world.player.guid;
        if guid == Guid::NULL {
            return None;
        }

        let body_id = SpatialBodyId::LocalPlayer(guid);
        let pose = world.local_player_runtime_pose().unwrap_or(world.player.position);
        let (velocity, omega) = match self.active_drive.map(|active| active.intent) {
            Some(ActiveDriveIntent::Manual(state)) => {
                let heading = pose.rotation.to_heading();
                let run_speed_mps = player_run_speed_mps(world);
                (
                    local_velocity_for_state(heading, state, run_speed_mps),
                    local_omega_for_state(state),
                )
            }
            _ => (Vector3::zero(), Vector3::zero()),
        };

        Some(SolveBodyInput {
            body_id,
            pose,
            velocity,
            omega,
        })
    }

    pub(super) fn record_force_position_sequence(&mut self, force_position_sequence: u16) {
        self.sequence_diagnostics
            .record_force_position_sequence(force_position_sequence);
    }

    pub(super) fn record_autonomous_position_sequences(
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

    pub(super) fn record_server_control_sequence(&mut self, server_control_sequence: u16) {
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

    fn note_server_motion_cleared(&mut self) {
        self.server_motion_active = false;
        self.last_server_motion_intent = None;
    }

    async fn execute_motion_state_at(
        &mut self,
        state: MotionState,
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

        if !had_active_local_motion {
            self.clear_autonomous_position_heartbeat_schedule();
        }

        Ok(state_events)
    }

    async fn execute_motion_state_with_metadata_at(
        &mut self,
        state: MotionState,
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
            if has_active_autonomous_position_motion(world) {
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

        if has_active_autonomous_position_motion(world) {
            self.refresh_autonomous_position_heartbeat_schedule(now, world);
        } else {
            self.clear_autonomous_position_heartbeat_schedule();
        }

        Ok(true)
    }

    pub(super) async fn send_autonomous_position_sync(
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
        state: MotionState,
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
        state: MotionState,
        metadata: MovementPacketMetadata,
    ) -> Result<()> {
        let data = holtburger_protocol::messages::game_action::MoveToStateActionData {
            raw_motion_state: build_motion_state_raw_motion_state(
                world,
                state,
                metadata.motion_style,
            ),
            position: world
                .local_player_runtime_pose()
                .unwrap_or(world.player.position),
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
            position: world
                .local_player_runtime_pose()
                .unwrap_or(world.player.position),
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
mod tests {
    use super::*;
    use holtburger_common::Vector3;
    use holtburger_protocol::messages::movement::MotionStance;
    use holtburger_session::Session;
    use holtburger_world::stats::{Attribute, AttributeType, Skill, SkillType, TrainingLevel};
    use holtburger_world::WorldState;
    use holtburger_world::entity::Entity;

    fn seed_player_run_rate(world: &mut WorldState, run_skill: u32) -> f32 {
        world.player.attributes.insert(
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
        world.player.skills.insert(
            SkillType::Run,
            Skill {
                skill_type: SkillType::Run,
                ranks: 0,
                init: run_skill,
                spent_xp: 0,
                next_rank_xp: None,
                base: run_skill,
                current: run_skill,
                training: TrainingLevel::Trained,
                trained_cost: 0,
                specialized_cost: 0,
            },
        );

        player_run_speed_mps(world)
    }

    #[test]
    fn autonomous_wire_motion_state_adds_turn_when_heading_differs() {
        let mut world = WorldState::synthetic();
        world.player.position = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::from_heading(0.0),
        };

        let state = MovementSystem::autonomous_wire_motion_state(
            &world,
            AutonomousDriveIntent {
                desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
                desired_heading: Some(90.0_f32.to_radians()),
                gait: Gait::Run,
                force_grounded: true,
            },
        )
        .expect("moving autonomous drive should emit a wire motion state");

        assert_eq!(state.gait, Gait::Run);
        assert_eq!(state.locomotion, Some(Locomotion::Forward));
        assert_eq!(state.turning, Some(Turn::Right));
    }

    #[test]
    fn autonomous_wire_motion_state_can_turn_in_place() {
        let mut world = WorldState::synthetic();
        world.player.position = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::from_heading(0.0),
        };

        let state = MovementSystem::autonomous_wire_motion_state(
            &world,
            AutonomousDriveIntent {
                desired_world_delta: Vector3::zero(),
                desired_heading: Some(90.0_f32.to_radians()),
                gait: Gait::Walk,
                force_grounded: false,
            },
        )
        .expect("heading-only autonomous drive should still emit a turn edge");

        assert_eq!(state.gait, Gait::Walk);
        assert_eq!(state.locomotion, None);
        assert_eq!(state.turning, Some(Turn::Right));
    }

    #[test]
    fn autonomous_wire_motion_state_skips_idle_aligned_requests() {
        let mut world = WorldState::synthetic();
        world.player.position = WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::from_heading(0.0),
        };

        let state = MovementSystem::autonomous_wire_motion_state(
            &world,
            AutonomousDriveIntent {
                desired_world_delta: Vector3::zero(),
                desired_heading: Some(0.0),
                gait: Gait::Walk,
                force_grounded: false,
            },
        );

        assert_eq!(state, None);
    }

    #[tokio::test]
    async fn enqueue_drive_intent_exposes_autonomous_drive_for_current_tick_only() {
        let mut world = WorldState::synthetic();
        world.player.guid = Guid(0x5000_0123);
        world.player.position.landblock_id = Guid(0x1234_0000);
        world.entities.insert(Entity::new(
            world.player.guid,
            "Player".to_string(),
            world.player.position,
        ));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let now = Instant::now();
        movement.enqueue_drive_intent(
            PlayerDriveIntent::Autonomous(AutonomousDriveIntent {
                desired_world_delta: Vector3::new(1.0, 2.0, 3.0),
                desired_heading: Some(0.75),
                gait: Gait::Run,
                force_grounded: true,
            }),
            now,
        );

        assert_eq!(movement.current_local_drive_control(&world), None);

        movement
            .tick(now, &mut world, &mut session)
            .await
            .expect("autonomous drive should activate on movement tick");

        let drive = movement
            .current_local_drive_control(&world)
            .expect("autonomous drive should be exposed to simulation");

        assert_eq!(drive.body_id, SpatialBodyId::LocalPlayer(world.player.guid));
        assert_eq!(drive.desired_world_delta, Vector3::new(1.0, 2.0, 3.0));
        assert_eq!(drive.desired_heading, Some(0.75));
        assert_eq!(drive.gait, holtburger_world::spatial::LocalDriveGait::Run);
        assert!(drive.force_grounded);

        movement
            .tick(now + Duration::from_millis(30), &mut world, &mut session)
            .await
            .expect("tick-scoped autonomous drive should expire when not resent");

        assert_eq!(movement.current_local_drive_control(&world), None);
    }

    #[tokio::test]
    async fn later_manual_drive_wins_over_queued_autonomous_drive() {
        let mut world = WorldState::synthetic();
        world.player.guid = Guid(0x5000_0123);
        world.player.position.landblock_id = Guid(0x1234_0000);
        world.entities.insert(Entity::new(
            world.player.guid,
            "Player".to_string(),
            world.player.position,
        ));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let now = Instant::now();
        movement.enqueue_drive_intent(
            PlayerDriveIntent::Autonomous(AutonomousDriveIntent {
                desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
                desired_heading: None,
                gait: Gait::Walk,
                force_grounded: false,
            }),
            now,
        );
        movement.enqueue_drive_intent(
            PlayerDriveIntent::ManualHeld(MotionState::builder().run().forward().build()),
            now,
        );

        movement
            .tick(now, &mut world, &mut session)
            .await
            .expect("movement tick should arbitrate queued drive intents");

        assert_eq!(movement.current_local_drive_control(&world), None);
        assert!(matches!(
            movement.active_drive,
            Some(ActiveDriveState {
                intent: ActiveDriveIntent::Manual(MotionState {
                    gait: Gait::Run,
                    locomotion: Some(Locomotion::Forward),
                    ..
                }),
                ..
            })
        ));
    }

    #[test]
    fn test_raw_motion_state_preserves_cached_server_style_by_default() {
        let mut world = WorldState::synthetic();
        world.player.last_server_motion_style = Some(MotionStance::SwordCombat);

        let raw_motion_state = raw_motion_state_with_motion_style(
            &world,
            RawMotionState {
                flags: RawMotionFlags::CURRENT_HOLD_KEY
                    | RawMotionFlags::FORWARD_COMMAND
                    | RawMotionFlags::FORWARD_SPEED,
                current_hold_key: Some(HoldKey::Run as u32),
                forward_command: Some(WALK_FORWARD_MOTION_COMMAND),
                forward_speed: Some(7.0),
                ..Default::default()
            },
            MotionStyle::PreserveServer,
        );

        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::CURRENT_STYLE)
        );
        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::FORWARD_COMMAND)
        );
        assert_eq!(
            raw_motion_state.current_stance(),
            Some(MotionStance::SwordCombat)
        );
        assert_eq!(raw_motion_state.current_hold_key, Some(HoldKey::Run as u32));
        assert_eq!(
            raw_motion_state.forward_command,
            Some(WALK_FORWARD_MOTION_COMMAND)
        );
        assert_eq!(raw_motion_state.forward_speed, Some(7.0));
    }

    #[test]
    fn test_raw_motion_state_can_override_cached_server_style() {
        let mut world = WorldState::synthetic();
        world.player.last_server_motion_style = Some(MotionStance::SwordCombat);

        let raw_motion_state = raw_motion_state_with_motion_style(
            &world,
            RawMotionState::default(),
            MotionStyle::Explicit(MotionStance::Magic),
        );

        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::CURRENT_STYLE)
        );
        assert_eq!(raw_motion_state.current_stance(), Some(MotionStance::Magic));
    }

    #[test]
    fn test_raw_motion_state_can_omit_cached_server_style() {
        let mut world = WorldState::synthetic();
        world.player.last_server_motion_style = Some(MotionStance::SwordCombat);

        let raw_motion_state = raw_motion_state_with_motion_style(
            &world,
            RawMotionState {
                flags: RawMotionFlags::CURRENT_STYLE,
                current_style: Some(MotionStance::Magic as u32),
                ..Default::default()
            },
            MotionStyle::Omit,
        );

        assert!(
            !raw_motion_state
                .flags
                .contains(RawMotionFlags::CURRENT_STYLE)
        );
        assert_eq!(raw_motion_state.current_style, None);
    }

    #[test]
    fn motion_state_raw_motion_state_adds_right_turn_when_requested() {
        let world = WorldState::synthetic();

        let raw_motion_state = build_motion_state_raw_motion_state(
            &world,
            MotionState::builder().run().forward().turn_right().build(),
            MotionStyle::PreserveServer,
        );

        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::FORWARD_COMMAND)
        );
        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::TURN_COMMAND)
        );
        assert!(raw_motion_state.flags.contains(RawMotionFlags::TURN_SPEED));
        assert_eq!(
            raw_motion_state.turn_command,
            Some(TURN_RIGHT_MOTION_COMMAND)
        );
        assert_eq!(
            raw_motion_state.turn_speed,
            Some(RUN_HELD_TURN_SPEED_RAD_PER_SEC)
        );
    }

    #[test]
    fn motion_state_raw_motion_state_uses_player_run_rate_for_forward_speed() {
        let mut world = WorldState::synthetic();
        let expected_run_speed = seed_player_run_rate(&mut world, 300);

        let raw_motion_state = build_motion_state_raw_motion_state(
            &world,
            MotionState::builder().run().forward().build(),
            MotionStyle::PreserveServer,
        );

        assert_eq!(raw_motion_state.forward_command, Some(WALK_FORWARD_MOTION_COMMAND));
        assert_eq!(raw_motion_state.forward_hold_key, Some(HoldKey::Run as u32));
        assert_eq!(raw_motion_state.forward_speed, Some(expected_run_speed));
        assert!(raw_motion_state
            .flags
            .contains(RawMotionFlags::FORWARD_HOLD_KEY));
    }

    #[test]
    fn motion_state_raw_motion_state_adds_left_turn_when_requested() {
        let world = WorldState::synthetic();

        let raw_motion_state = build_motion_state_raw_motion_state(
            &world,
            MotionState::builder().run().forward().turn_left().build(),
            MotionStyle::PreserveServer,
        );

        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::TURN_COMMAND)
        );
        assert_eq!(
            raw_motion_state.turn_command,
            Some(TURN_LEFT_MOTION_COMMAND)
        );
        assert_eq!(
            raw_motion_state.turn_speed,
            Some(RUN_HELD_TURN_SPEED_RAD_PER_SEC)
        );
        assert_eq!(raw_motion_state.turn_hold_key, Some(HoldKey::Run as u32));
        assert!(raw_motion_state
            .flags
            .contains(RawMotionFlags::TURN_HOLD_KEY));
    }

    #[test]
    fn motion_state_raw_motion_state_omits_turn_when_not_requested() {
        let world = WorldState::synthetic();

        let raw_motion_state = build_motion_state_raw_motion_state(
            &world,
            MotionState::builder().run().forward().build(),
            MotionStyle::PreserveServer,
        );

        assert!(
            !raw_motion_state
                .flags
                .contains(RawMotionFlags::TURN_COMMAND)
        );
        assert!(!raw_motion_state.flags.contains(RawMotionFlags::TURN_SPEED));
        assert_eq!(raw_motion_state.turn_command, None);
        assert_eq!(raw_motion_state.turn_speed, None);
    }

    #[test]
    fn current_local_solve_body_input_uses_planar_run_velocity() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x50000123);
        world.player.guid = player_guid;
        let expected_run_speed = seed_player_run_rate(&mut world, 300);
        world.player.position = WorldPosition {
            landblock_id: Guid(0x12340000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::identity(),
        };
        world.entities.insert(Entity::new(
            player_guid,
            "Player".to_string(),
            world.player.position,
        ));

        world.player.position.rotation = Quaternion::from_heading(90.0_f32.to_radians());
        let _ = world.set_player_position(world.player.position);

        let mut movement = MovementSystem::new();
        movement.active_drive = Some(ActiveDriveState::manual(
            MotionState::builder().run().forward().build(),
            None,
        ));

        let body = movement
            .current_local_solve_body_input(&world)
            .expect("active manual drive should produce local solve input");
        assert_eq!(body.body_id, SpatialBodyId::LocalPlayer(player_guid));
        assert!(body.velocity.x.abs() < 1e-5);
        assert!((body.velocity.y - expected_run_speed).abs() < 1e-5);
    }


    #[test]
    fn current_local_solve_body_input_can_turn_in_place() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x50000123);
        world.player.guid = player_guid;
        world.player.position = WorldPosition {
            landblock_id: Guid(0x12340000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::identity(),
        };
        world.entities.insert(Entity::new(
            player_guid,
            "Player".to_string(),
            world.player.position,
        ));

        let mut movement = MovementSystem::new();
        movement.active_drive = Some(ActiveDriveState::manual(
            MotionState::builder().walk().turn_left().build(),
            None,
        ));

        let body = movement
            .current_local_solve_body_input(&world)
            .expect("turn-in-place manual drive should produce local solve input");
        assert!(body.velocity.length_squared() <= 1e-6);
        assert!(body.omega.z.abs() > 1e-6);
    }

    #[test]
    fn stop_pulse_is_still_required_when_server_motion_is_active() {
        let mut movement = MovementSystem::new();
        movement.note_server_motion_sent(server_motion_intent(
            MotionState::builder().run().forward().turn_right().build(),
            MotionStyle::PreserveServer,
        ));

        assert!(movement.should_send_stop_pulse());
    }

    #[test]
    fn note_server_motion_cleared_resets_drive_tracking() {
        let mut movement = MovementSystem::new();
        movement.note_server_motion_sent(server_motion_intent(
            MotionState::builder().run().forward().turn_right().build(),
            MotionStyle::PreserveServer,
        ));

        movement.note_server_motion_cleared();

        assert!(!movement.server_motion_active);
        assert!(movement.last_server_motion_intent.is_none());
    }

    #[test]
    fn unchanged_motion_intent_does_not_require_server_refresh() {
        let mut movement = MovementSystem::new();
        movement.note_server_motion_sent(server_motion_intent(
            MotionState::builder().run().forward().turn_right().build(),
            MotionStyle::PreserveServer,
        ));

        assert!(!movement.should_send_motion_state_pulse(
            MotionState::builder().run().forward().turn_right().build(),
            MotionStyle::PreserveServer,
        ));
    }

    #[test]
    fn autonomous_position_heartbeat_defaults_to_grounded_when_contact_unknown() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };
        let mut entity = Entity::new(guid, "Player".to_string(), position);
        entity.velocity = Vector3::new(2.0, 0.0, 0.0);

        world.player.guid = guid;
        world.player.position = position;
        world.player.instance_sequence = 11;
        world.player.server_control_sequence = 22;
        world.player.teleport_sequence = 33;
        world.player.force_position_sequence = 44;
        world.entities.insert(entity);

        let position_action =
            build_autonomous_position(&world, MovementPacketMetadata::default())
                .expect("moving player should emit autonomous position action");

        assert_eq!(position_action.position, position);
        assert_eq!(position_action.instance_sequence, 11);
        assert_eq!(position_action.server_control_sequence, 22);
        assert_eq!(position_action.teleport_sequence, 33);
        assert_eq!(position_action.force_position_sequence, 44);
        assert_eq!(position_action.last_contact, 1);
    }

    #[test]
    fn autonomous_position_uses_server_grounded_when_contact_unspecified() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };
        let mut entity = Entity::new(guid, "Player".to_string(), position);
        entity.velocity = Vector3::new(2.0, 0.0, 0.0);

        world.player.guid = guid;
        world.player.position = position;
        world.player.server_grounded = Some(true);
        world.entities.insert(entity);

        let position_action =
            build_autonomous_position(&world, MovementPacketMetadata::default())
                .expect("moving player should emit autonomous position action");

        assert_eq!(position_action.last_contact, 1);
    }

    #[test]
    fn autonomous_position_can_be_built_for_turn_only_motion() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };
        let mut entity = Entity::new(guid, "Player".to_string(), position);
        entity.omega = Vector3::new(0.0, 0.0, 1.0);

        world.player.guid = guid;
        world.player.position = position;
        world.entities.insert(entity);

        let position_action =
            build_autonomous_position(&world, MovementPacketMetadata::default())
                .expect("turning player should emit autonomous position action");

        assert_eq!(position_action.position, position);
    }

    #[test]
    fn autonomous_position_can_be_built_for_stationary_player() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };

        world.player.guid = guid;
        world.player.position = position;
        world.player.instance_sequence = 11;
        world.player.server_control_sequence = 22;
        world.player.teleport_sequence = 33;
        world.player.force_position_sequence = 44;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let position_action = build_autonomous_position(&world, MovementPacketMetadata::default())
            .expect("autonomous position action should emit even when stationary");

        assert_eq!(position_action.position, position);
        assert_eq!(position_action.instance_sequence, 11);
        assert_eq!(position_action.server_control_sequence, 22);
        assert_eq!(position_action.teleport_sequence, 33);
        assert_eq!(position_action.force_position_sequence, 44);
    }

    #[tokio::test]
    async fn stop_after_active_drive_sends_stop_pulse_then_final_position_sync() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };
        let mut entity = Entity::new(guid, "Player".to_string(), position);

        world.player.guid = guid;
        world.player.position = position;
        world.entities.insert(entity.clone());

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();

        movement
            .execute_motion_state_at(
                MotionState::builder().run().forward().build(),
                &mut world,
                &mut session,
                Instant::now(),
            )
            .await
            .expect("drive request should succeed");

        entity.velocity = Vector3::new(0.0, 4.0, 0.0);
        world.entities.insert(entity);

        movement
            .execute_stop_at(
                Instant::now(),
                &mut world,
                &mut session,
                MovementPacketMetadata::default(),
                true,
            )
            .await
            .expect("stop request should succeed");

        assert_eq!(session.packet_sequence, 4);
    }

    #[tokio::test]
    async fn stop_without_active_drive_does_not_send_final_position_sync() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        movement.note_server_motion_sent(server_motion_intent(
            MotionState::builder().run().forward().turn_right().build(),
            MotionStyle::PreserveServer,
        ));

        movement
            .execute_stop_at(
                Instant::now(),
                &mut world,
                &mut session,
                MovementPacketMetadata::default(),
                false,
            )
            .await
            .expect("stop request should succeed");

        assert_eq!(session.packet_sequence, 2);
    }

    #[tokio::test]
    async fn unchanged_motion_state_requests_do_not_resend_motion_pulses() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let start = Instant::now();
        let state = MotionState::builder().run().forward().turn_right().build();

        movement
            .execute_motion_state_with_metadata_at(
                state,
                MovementPacketMetadata::default(),
                &mut world,
                &mut session,
                start,
            )
            .await
            .expect("initial motion request should send a motion pulse");
        assert_eq!(session.packet_sequence, 2);

        movement
            .execute_motion_state_with_metadata_at(
                state,
                MovementPacketMetadata::default(),
                &mut world,
                &mut session,
                start + Duration::from_millis(100),
            )
            .await
            .expect("unchanged motion request should be deduplicated");
        assert_eq!(session.packet_sequence, 2);
    }

    #[tokio::test]
    async fn held_run_input_ticks_once_for_wire_and_keeps_local_vectors_consistent() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let start = Instant::now();

        movement.enqueue_drive_intent(
            PlayerDriveIntent::ManualHeld(MotionState::builder().run().forward().build()),
            start,
        );

        movement
            .tick(start, &mut world, &mut session)
            .await
            .expect("held run input should start moving");

        let player = movement
            .current_local_solve_body_input(&world)
            .expect("held run input should produce local solve input");
        assert!(player.velocity.x.abs() < 1e-5);
        assert!((player.velocity.y - 4.5).abs() < 1e-5);
        assert_eq!(session.packet_sequence, 2);

        movement
            .tick(start + Duration::from_millis(30), &mut world, &mut session)
            .await
            .expect("steady held run should not resend unchanged motion intent");

        let player = movement
            .current_local_solve_body_input(&world)
            .expect("steady held run should keep solve input active");
        assert!(player.velocity.x.abs() < 1e-5);
        assert!((player.velocity.y - 4.5).abs() < 1e-5);
        assert_eq!(session.packet_sequence, 2);
    }

    #[tokio::test]
    async fn pulsed_run_input_expires_on_tick_and_sends_stop_transition() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let start = Instant::now();

        movement.enqueue_drive_intent(
            PlayerDriveIntent::ManualPulse {
                state: MotionState::builder().run().forward().build(),
                duration: Duration::from_millis(50),
            },
            start,
        );

        movement
            .tick(start, &mut world, &mut session)
            .await
            .expect("pulse should start movement");
        assert_eq!(session.packet_sequence, 2);

        movement
            .tick(start + Duration::from_millis(60), &mut world, &mut session)
            .await
            .expect("expired pulse should stop movement on the next tick");

        let player = world
            .entities
            .get(guid)
            .expect("synthetic player entity should exist");
        assert!(player.velocity.length_squared() <= 1e-6);
        assert!(player.omega.length_squared() <= 1e-6);
        assert_eq!(session.packet_sequence, 4);
    }

    #[tokio::test]
    async fn stop_input_clears_held_run_and_sends_stop_transition() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let start = Instant::now();

        movement.enqueue_drive_intent(
            PlayerDriveIntent::ManualHeld(MotionState::builder().run().forward().build()),
            start,
        );
        movement
            .tick(start, &mut world, &mut session)
            .await
            .expect("held run should start");

        movement.enqueue_drive_intent(PlayerDriveIntent::Stop, start + Duration::from_millis(30));
        movement
            .tick(start + Duration::from_millis(30), &mut world, &mut session)
            .await
            .expect("stop input should end held movement");

        let player = world
            .entities
            .get(guid)
            .expect("synthetic player entity should exist");
        assert!(player.velocity.length_squared() <= 1e-6);
        assert!(player.omega.length_squared() <= 1e-6);
        assert_eq!(session.packet_sequence, 4);
    }

    #[tokio::test]
    async fn snap_facing_sends_autonomous_position_sync_with_updated_rotation() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(0.0),
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();

        let events = movement
            .execute_snap_facing(
                Instant::now(),
                90.0_f32.to_radians(),
                &mut world,
                &mut session,
                MovementPacketMetadata::default(),
            )
            .await
            .expect("snap facing should succeed");

        let _ = events;
        let body = world
            .scene
            .body(SpatialBodyId::LocalPlayer(guid))
            .expect("local player runtime body should exist");
        assert!((body.pose.rotation.to_heading() - 90.0_f32.to_radians()).abs() < 1e-5);
        assert_eq!(session.packet_sequence, 2);
    }

    #[tokio::test]
    async fn movement_heartbeat_arms_then_sends_when_local_velocity_is_nonzero() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);

        world.player.guid = guid;
        world.player.position.landblock_id = Guid(0x1000_0001);
        let mut entity = Entity::new(guid, "Player".to_string(), world.player.position);
        entity.velocity = Vector3::new(1.0, 0.0, 0.0);
        world.entities.insert(entity);

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let now = Instant::now();

        let sent = movement
            .maybe_send_autonomous_position_heartbeat(
                now,
                &world,
                &mut session,
                MovementPacketMetadata::default(),
            )
            .await
            .expect("movement heartbeat should arm successfully");

        assert!(!sent);
        assert_eq!(session.game_action_sequence, 0);

        let sent = movement
            .maybe_send_autonomous_position_heartbeat(
                now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL + Duration::from_millis(1),
                &world,
                &mut session,
                MovementPacketMetadata::default(),
            )
            .await
            .expect("movement heartbeat should send once armed");

        assert!(sent);
        assert_eq!(session.game_action_sequence, 1);
        assert!(session.bytes_out > 0);
    }

    #[tokio::test]
    async fn movement_heartbeat_skips_stationary_players_without_arming() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            ..Default::default()
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();

        let sent = movement
            .maybe_send_autonomous_position_heartbeat(
                Instant::now(),
                &world,
                &mut session,
                MovementPacketMetadata::default(),
            )
            .await
            .expect("stationary heartbeat check should succeed");

        assert!(!sent);
        assert_eq!(session.game_action_sequence, 0);
        assert!(movement.next_autonomous_position_heartbeat_at.is_none());
    }

    #[tokio::test]
    async fn armed_movement_heartbeat_sends_final_stationary_sync_then_disarms() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };
        let mut entity = Entity::new(guid, "Player".to_string(), position);
        entity.velocity = Vector3::new(1.0, 0.0, 0.0);

        world.player.guid = guid;
        world.player.position = position;
        world.entities.insert(entity);

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let now = Instant::now();

        let sent = movement
            .maybe_send_autonomous_position_heartbeat(
                now,
                &world,
                &mut session,
                MovementPacketMetadata::default(),
            )
            .await
            .expect("moving heartbeat check should arm successfully");

        assert!(!sent);
        assert!(movement.next_autonomous_position_heartbeat_at.is_some());

        let stationary_entity = world
            .entities
            .get_mut(guid)
            .expect("synthetic player entity should exist");
        stationary_entity.velocity = Vector3::zero();
        stationary_entity.omega = Vector3::zero();

        let sent = movement
            .maybe_send_autonomous_position_heartbeat(
                now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL + Duration::from_millis(1),
                &world,
                &mut session,
                MovementPacketMetadata::default(),
            )
            .await
            .expect("armed heartbeat should send one final stationary sync");

        assert!(sent);
        assert_eq!(session.game_action_sequence, 1);
        assert!(movement.next_autonomous_position_heartbeat_at.is_none());
    }

    #[tokio::test]
    async fn movement_tick_emits_autonomous_position_heartbeat_when_due() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::from_heading(90.0_f32.to_radians()),
        };
        let mut entity = Entity::new(guid, "Player".to_string(), position);
        entity.velocity = Vector3::new(2.0, 0.0, 0.0);

        world.player.guid = guid;
        world.player.position = position;
        world.entities.insert(entity);

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let start = Instant::now();

        movement
            .tick(start, &mut world, &mut session)
            .await
            .expect("first movement tick should arm the heartbeat");

        assert_eq!(session.game_action_sequence, 0);

        movement
            .tick(
                start + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL + Duration::from_millis(1),
                &mut world,
                &mut session,
            )
            .await
            .expect("second movement tick should emit the heartbeat");

        assert_eq!(session.game_action_sequence, 1);
    }

}
