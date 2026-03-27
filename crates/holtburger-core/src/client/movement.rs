use crate::client::WireEvent;
use crate::client::movement_types::{
    MotionStyle, MovementControl, MovementInput, MovementPacketMetadata, MovementPrimitive,
    MovementRequest, RUN_ANIM_SPEED, planar_velocity_for_heading,
};
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::sequence::is_newer_u16;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::{RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use holtburger_world::{WorldEvent, WorldState};
use std::f32::consts::{PI, TAU};
use std::time::{Duration, Instant};
/// Maximum distance (in meters) to allow an automated server-controlled teleport.
const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;
pub(crate) const SERVER_RUN_SPEED: f32 = 4.5;
pub(crate) const SERVER_PULSE_PERIOD: Duration = Duration::from_millis(200);
const MIN_SERVER_RUN_DUTY_CYCLE: f32 = 0.15;
const WALK_FORWARD_MOTION_COMMAND: u32 = 0x4500_0005;
const TURN_RIGHT_MOTION_COMMAND: u32 = 0x6500_000d;
const TURN_LEFT_MOTION_COMMAND: u32 = 0x6500_000e;
const TURN_COMMAND_THRESHOLD_RAD: f32 = 10.0_f32.to_radians();
const LOCAL_TURN_RATE_RAD_PER_SEC: f32 = PI;

fn calculate_arrival_position(
    source: &WorldPosition,
    target_pos: &holtburger_common::Vector3,
    distance: f32,
) -> holtburger_common::Vector3 {
    let to_player = source.coords - *target_pos;
    if to_player.length_squared() > 1e-6 {
        *target_pos + (to_player.normalize() * distance)
    } else {
        let mut fallback = *target_pos;
        fallback.x += distance;
        fallback
    }
}

fn signed_heading_delta(current_heading: f32, desired_heading: f32) -> f32 {
    let mut delta = (desired_heading - current_heading) % TAU;
    if delta <= -PI {
        delta += TAU;
    } else if delta > PI {
        delta -= TAU;
    }
    delta
}

fn turn_motion_command(current_heading: f32, desired_heading: f32) -> Option<u32> {
    let delta = signed_heading_delta(current_heading, desired_heading);
    if delta.abs() <= TURN_COMMAND_THRESHOLD_RAD {
        None
    } else if delta.is_sign_positive() {
        Some(TURN_RIGHT_MOTION_COMMAND)
    } else {
        Some(TURN_LEFT_MOTION_COMMAND)
    }
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

fn build_autonomous_position_heartbeat(
    world: &WorldState,
    metadata: MovementPacketMetadata,
) -> Option<AutonomousPositionActionData> {
    let player_entity = world.entities.get(world.player.guid)?;
    if player_entity.velocity.length_squared() < 0.0001 {
        return None;
    }

    build_autonomous_position_sync(world, metadata)
}

fn build_autonomous_position_sync(
    world: &WorldState,
    metadata: MovementPacketMetadata,
) -> Option<AutonomousPositionActionData> {
    if world.player.guid == Guid::NULL || world.player.position.landblock_id == Guid::NULL {
        return None;
    }

    Some(AutonomousPositionActionData {
        position: world.player.position,
        instance_sequence: world.player.instance_sequence,
        server_control_sequence: world.player.server_control_sequence,
        teleport_sequence: world.player.teleport_sequence,
        force_position_sequence: world.player.force_position_sequence,
        last_contact: encode_last_contact(world, metadata),
    })
}

fn build_drive_raw_motion_state(
    world: &WorldState,
    current_heading: f32,
    desired_heading: f32,
    speed: f32,
    motion_style: MotionStyle,
) -> RawMotionState {
    let mut raw_motion_state = RawMotionState {
        flags: RawMotionFlags::CURRENT_HOLD_KEY
            | RawMotionFlags::FORWARD_COMMAND
            | RawMotionFlags::FORWARD_SPEED,
        current_hold_key: Some(HoldKey::Run as u32),
        forward_command: Some(WALK_FORWARD_MOTION_COMMAND),
        forward_speed: Some(speed),
        ..Default::default()
    };

    if let Some(turn_command) = turn_motion_command(current_heading, desired_heading) {
        raw_motion_state.flags |= RawMotionFlags::TURN_COMMAND;
        raw_motion_state.turn_command = Some(turn_command);
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
    queued_inputs: Vec<QueuedMovementCommand>,
    pending_snap_facing: Option<PendingSnapFacing>,
    active_public_locomotion: Option<ActiveBufferedControl>,
    active_public_turn: Option<ActiveBufferedControl>,
    local_motion: Option<LocalMotionIntent>,
    server_motion_active: bool,
    last_server_drive_intent: Option<ServerDriveIntent>,
    server_pulse_cycle_started_at: Option<Instant>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ActiveBufferedControl {
    control: MovementControl,
    until: Option<Instant>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct PendingSnapFacing {
    heading: f32,
    metadata: MovementPacketMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum QueuedMovementCommand {
    Public {
        input: MovementInput,
        metadata: MovementPacketMetadata,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MovementKinematics {
    /// Client-side approximation derived from the current actuator model.
    /// This is useful for navigation pulse planning, not an authoritative server guarantee.
    pub run_speed_mps: f32,
    /// Client-side approximation derived from the current actuator model.
    /// This is useful for navigation pulse planning, not an authoritative server guarantee.
    pub walk_speed_mps: f32,
    /// Local turn rate used by client-side prediction while aligning heading.
    /// This is a protocol-shaped approximation, not an authoritative server guarantee.
    pub turn_rate_rad_per_sec: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct LocalMotionIntent {
    kind: LocalMotionKind,
    desired_heading: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum LocalMotionKind {
    Ground { speed: f32 },
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ServerDriveIntent {
    turn_command: Option<u32>,
    motion_style: MotionStyle,
}

fn server_drive_intent(
    current_heading: f32,
    desired_heading: f32,
    motion_style: MotionStyle,
) -> ServerDriveIntent {
    ServerDriveIntent {
        turn_command: turn_motion_command(current_heading, desired_heading),
        motion_style,
    }
}

fn local_ground_motion_from_server_drive(
    server_drive: Option<(f32, f32)>,
    should_run_server_drive: bool,
) -> Option<LocalMotionIntent> {
    let (desired_heading, _) = server_drive?;

    Some(LocalMotionIntent {
        kind: LocalMotionKind::Ground {
            speed: if should_run_server_drive {
                SERVER_RUN_SPEED
            } else {
                0.0
            },
        },
        desired_heading: should_run_server_drive.then_some(desired_heading),
    })
}

impl MovementSystem {
    pub(super) fn new() -> Self {
        Self {
            sequence_diagnostics: MovementSequenceDiagnostics::default(),
            queued_inputs: Vec::new(),
            pending_snap_facing: None,
            active_public_locomotion: None,
            active_public_turn: None,
            local_motion: None,
            server_motion_active: false,
            last_server_drive_intent: None,
            server_pulse_cycle_started_at: None,
        }
    }

    /// Returns movement-planning constants derived from the current actuator model.
    /// These values are kept near movement execution so navigation does not hard-code
    /// locomotion math, but callers should treat them as approximations rather than
    /// authoritative server guarantees.
    pub fn kinematics(&self) -> MovementKinematics {
        MovementKinematics {
            run_speed_mps: RUN_ANIM_SPEED * SERVER_RUN_SPEED,
            walk_speed_mps: RUN_ANIM_SPEED,
            turn_rate_rad_per_sec: LOCAL_TURN_RATE_RAD_PER_SEC,
        }
    }

    /// Estimates the pulse duration needed to cover a planar distance for the given control.
    /// This is planning math based on the current client actuator model, not a server guarantee.
    pub fn estimate_duration_for_distance(
        &self,
        control: MovementControl,
        distance_m: f32,
    ) -> Duration {
        let speed = self.control_speed_mps(control);
        if speed <= 1e-6 {
            Duration::ZERO
        } else {
            Duration::from_secs_f32((distance_m.max(0.0) / speed).max(0.0))
        }
    }

    /// Estimates planar displacement for a control held for the given duration.
    /// This is planning math based on the current client actuator model, not a server guarantee.
    pub fn estimate_displacement(&self, control: MovementControl, duration: Duration) -> f32 {
        self.control_speed_mps(control) * duration.as_secs_f32().max(0.0)
    }

    pub(super) fn enqueue_input(&mut self, input: MovementInput, _now: Instant) {
        self.queued_inputs.push(QueuedMovementCommand::Public {
            input,
            metadata: MovementPacketMetadata::default(),
        });
    }

    fn control_speed_mps(&self, control: MovementControl) -> f32 {
        match control {
            MovementControl::Run { .. } => RUN_ANIM_SPEED * SERVER_RUN_SPEED,
            MovementControl::Walk { .. } => RUN_ANIM_SPEED,
            MovementControl::Backstep { .. } => RUN_ANIM_SPEED,
            MovementControl::StrafeLeft { .. } | MovementControl::StrafeRight { .. } => {
                RUN_ANIM_SPEED
            }
            MovementControl::TurnLeft | MovementControl::TurnRight => 0.0,
        }
    }

    fn ingest_public_input(
        &mut self,
        input: MovementInput,
        metadata: MovementPacketMetadata,
        now: Instant,
    ) {
        match input {
            MovementInput::Hold { control } => self.set_active_control(control, None),
            MovementInput::Pulse { control, duration } => {
                self.set_active_control(control, Some(now + duration))
            }
            MovementInput::SnapFacing { heading } => {
                self.pending_snap_facing = Some(PendingSnapFacing { heading, metadata });
            }
            MovementInput::Stop => {
                self.pending_snap_facing = None;
                self.active_public_locomotion = None;
                self.active_public_turn = None;
            }
            MovementInput::ReleaseLocomotion => {
                self.active_public_locomotion = None;
            }
            MovementInput::ReleaseTurning => {
                self.active_public_turn = None;
            }
        }
    }

    fn set_active_control(&mut self, control: MovementControl, until: Option<Instant>) {
        let next = Some(ActiveBufferedControl { control, until });
        match control {
            MovementControl::Run { .. }
            | MovementControl::Walk { .. }
            | MovementControl::Backstep { .. }
            | MovementControl::StrafeLeft { .. }
            | MovementControl::StrafeRight { .. } => self.active_public_locomotion = next,
            MovementControl::TurnLeft | MovementControl::TurnRight => {
                self.active_public_turn = next
            }
        }
    }

    fn expire_buffered_controls(&mut self, now: Instant) {
        if self
            .active_public_locomotion
            .is_some_and(|active| active.until.is_some_and(|until| now >= until))
        {
            self.active_public_locomotion = None;
        }

        if self
            .active_public_turn
            .is_some_and(|active| active.until.is_some_and(|until| now >= until))
        {
            self.active_public_turn = None;
        }
    }

    fn public_request_for_tick(&self) -> Option<MovementRequest> {
        match self.active_public_locomotion.map(|active| active.control) {
            Some(MovementControl::Run { heading }) => {
                Some(MovementRequest::new(MovementPrimitive::Drive {
                    heading,
                    speed: SERVER_RUN_SPEED,
                }))
            }
            Some(MovementControl::Walk { heading })
            | Some(MovementControl::Backstep { heading })
            | Some(MovementControl::StrafeLeft { heading })
            | Some(MovementControl::StrafeRight { heading }) => {
                Some(MovementRequest::new(MovementPrimitive::Drive {
                    heading,
                    speed: 1.0,
                }))
            }
            Some(MovementControl::TurnLeft) | Some(MovementControl::TurnRight) => None,
            None => None,
        }
    }

    pub(super) async fn tick(
        &mut self,
        now: Instant,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<WorldEvent>> {
        let queued = std::mem::take(&mut self.queued_inputs);
        for command in queued {
            match command {
                QueuedMovementCommand::Public { input, metadata } => {
                    self.ingest_public_input(input, metadata, now)
                }
            }
        }

        self.expire_buffered_controls(now);

        let mut events = Vec::new();
        if let Some(snap) = self.pending_snap_facing.take() {
            events.extend(
                self.execute_movement_request_at(
                    MovementRequest::new(MovementPrimitive::SnapFacing {
                        heading: snap.heading,
                    })
                    .with_metadata(snap.metadata),
                    world,
                    session,
                    now,
                )
                .await?,
            );
        }

        let request = self.public_request_for_tick();

        match request {
            Some(request) => events.extend(
                self.execute_movement_request_at(request, world, session, now)
                    .await?,
            ),
            None if self.local_motion.is_some() || self.server_motion_active => {
                events.extend(
                    self.execute_movement_request_at(
                        MovementRequest::new(MovementPrimitive::Stop),
                        world,
                        session,
                        now,
                    )
                    .await?,
                );
            }
            None => {}
        }

        Ok(events)
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

    fn should_send_drive_pulse(
        &self,
        current_heading: f32,
        desired_heading: f32,
        motion_style: MotionStyle,
    ) -> bool {
        if !self.server_motion_active {
            return true;
        }

        self.last_server_drive_intent
            != Some(server_drive_intent(
                current_heading,
                desired_heading,
                motion_style,
            ))
    }

    fn should_send_stop_pulse(&self) -> bool {
        self.server_motion_active
    }

    fn note_server_drive_sent(&mut self, intent: ServerDriveIntent) {
        self.server_motion_active = true;
        self.last_server_drive_intent = Some(intent);
    }

    fn note_server_motion_cleared(&mut self) {
        self.server_motion_active = false;
        self.last_server_drive_intent = None;
    }

    fn reset_server_pulse_schedule(&mut self) {
        self.server_pulse_cycle_started_at = None;
    }

    fn should_actuate_server_run(&mut self, now: Instant, desired_speed: f32) -> bool {
        let normalized_speed = (desired_speed.max(0.0) / SERVER_RUN_SPEED).clamp(0.0, 1.0);

        if normalized_speed <= 1e-6 {
            self.reset_server_pulse_schedule();
            return false;
        }

        if normalized_speed >= 1.0 - 1e-6 {
            self.reset_server_pulse_schedule();
            return true;
        }

        let duty_cycle = normalized_speed.max(MIN_SERVER_RUN_DUTY_CYCLE);
        let cycle_start = self.server_pulse_cycle_started_at.get_or_insert(now);
        let elapsed = now.saturating_duration_since(*cycle_start);

        if elapsed >= SERVER_PULSE_PERIOD {
            let period_secs = SERVER_PULSE_PERIOD.as_secs_f32();
            let completed_periods = (elapsed.as_secs_f32() / period_secs).floor();
            *cycle_start += SERVER_PULSE_PERIOD.mul_f32(completed_periods);
        }

        now.saturating_duration_since(*cycle_start) < SERVER_PULSE_PERIOD.mul_f32(duty_cycle)
    }

    #[cfg(test)]
    pub(super) async fn execute_movement_request(
        &mut self,
        request: MovementRequest,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<WorldEvent>> {
        self.execute_movement_request_at(request, world, session, Instant::now())
            .await
    }

    async fn execute_movement_request_at(
        &mut self,
        request: MovementRequest,
        world: &mut WorldState,
        session: &mut Session,
        now: Instant,
    ) -> Result<Vec<WorldEvent>> {
        let primitive = request.primitive;
        if let MovementPrimitive::SnapFacing { heading } = primitive {
            return self
                .execute_snap_facing(heading, world, session, request.metadata)
                .await;
        }

        let current_heading = world.player.position.rotation.to_heading();
        let server_drive = match primitive {
            MovementPrimitive::Drive { heading, speed } => Some((heading, speed)),
            _ => None,
        };
        let should_run_server_drive = match server_drive {
            Some((_, speed)) => self.should_actuate_server_run(now, speed),
            None => {
                self.reset_server_pulse_schedule();
                false
            }
        };
        let had_active_local_motion = self.local_motion.is_some();
        let state_events =
            self.apply_movement_primitive(primitive, server_drive, should_run_server_drive, world);

        match primitive {
            MovementPrimitive::Stop if self.should_send_stop_pulse() => {
                Self::send_stop_pulse(world, session, request.metadata).await?;
                if had_active_local_motion {
                    Self::send_autonomous_position_sync(world, session, request.metadata).await?;
                }
                self.note_server_motion_cleared();
                self.reset_server_pulse_schedule();
            }
            _ if server_drive.is_some_and(|(heading, _)| {
                should_run_server_drive
                    && self.should_send_drive_pulse(
                        current_heading,
                        heading,
                        request.metadata.motion_style,
                    )
            }) =>
            {
                let (heading, _) = server_drive.expect("guarded above");
                Self::send_drive_pulse(
                    world,
                    session,
                    current_heading,
                    heading,
                    SERVER_RUN_SPEED,
                    request.metadata,
                )
                .await?;
                self.note_server_drive_sent(server_drive_intent(
                    current_heading,
                    heading,
                    request.metadata.motion_style,
                ));
            }
            _ if !should_run_server_drive && self.should_send_stop_pulse() => {
                Self::send_stop_pulse(world, session, request.metadata).await?;
                self.note_server_motion_cleared();
            }
            _ => {}
        }

        Ok(state_events)
    }

    async fn execute_snap_facing(
        &mut self,
        desired_heading: f32,
        world: &mut WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<Vec<WorldEvent>> {
        let normalized_heading = normalize_heading(desired_heading);
        let current_heading = world.player.position.rotation.to_heading();

        if signed_heading_delta(current_heading, normalized_heading).abs() <= 1e-4 {
            return Ok(Vec::new());
        }

        let mut next_pos = world.player.position;
        next_pos.rotation = Quaternion::from_heading(normalized_heading);
        let mut world_events = world.set_player_position(next_pos);

        if let Some(intent) = &mut self.local_motion {
            if matches!(intent.kind, LocalMotionKind::Ground { .. }) {
                intent.desired_heading = Some(normalized_heading);
            }
            world_events.extend(self.sync_local_motion_vectors(world));
        }

        Self::send_autonomous_position_sync(world, session, metadata).await?;

        Ok(world_events)
    }

    fn apply_movement_primitive(
        &mut self,
        primitive: MovementPrimitive,
        server_drive: Option<(f32, f32)>,
        should_run_server_drive: bool,
        world: &mut WorldState,
    ) -> Vec<WorldEvent> {
        match primitive {
            MovementPrimitive::Drive { .. } => {
                self.local_motion =
                    local_ground_motion_from_server_drive(server_drive, should_run_server_drive);
                self.sync_local_motion_vectors(world)
            }
            MovementPrimitive::SnapFacing { heading } => {
                let mut next_pos = world.player.position;
                next_pos.rotation = Quaternion::from_heading(normalize_heading(heading));
                let mut events = world.set_player_position(next_pos);

                if let Some(intent) = &mut self.local_motion {
                    if matches!(intent.kind, LocalMotionKind::Ground { .. }) {
                        intent.desired_heading = Some(normalize_heading(heading));
                    }
                    events.extend(self.sync_local_motion_vectors(world));
                }

                events
            }
            MovementPrimitive::Stop => {
                self.local_motion = None;
                world.set_player_vector(Vector3::zero(), Vector3::zero())
            }
        }
    }

    fn sync_local_motion_vectors(&self, world: &mut WorldState) -> Vec<WorldEvent> {
        let Some(intent) = self.local_motion else {
            return world.set_player_vector(Vector3::zero(), Vector3::zero());
        };

        let current_heading = world.player.position.rotation.to_heading();
        let desired_heading = intent.desired_heading.unwrap_or(current_heading);
        let heading_delta = signed_heading_delta(current_heading, desired_heading);
        let speed = match intent.kind {
            LocalMotionKind::Ground { speed } => speed,
        };
        let velocity = if speed <= 1e-6 {
            Vector3::zero()
        } else {
            planar_velocity_for_heading(current_heading, speed)
        };
        let omega = if speed <= 1e-6
            || intent.desired_heading.is_none()
            || heading_delta.abs() <= TURN_COMMAND_THRESHOLD_RAD
        {
            Vector3::zero()
        } else {
            Vector3::new(
                0.0,
                0.0,
                heading_delta.signum() * LOCAL_TURN_RATE_RAD_PER_SEC,
            )
        };

        world.set_player_vector(velocity, omega)
    }

    pub(super) fn advance_local_motion_prediction(
        &mut self,
        dt: f32,
        world: &mut WorldState,
    ) -> Vec<WorldEvent> {
        let Some(intent) = self.local_motion else {
            return Vec::new();
        };

        let Some(_player_entity) = world.entities.get(world.player.guid) else {
            return Vec::new();
        };

        let dt = dt.max(0.0);
        if dt <= f32::EPSILON {
            return Vec::new();
        }

        let current_heading = world.player.position.rotation.to_heading();
        let desired_heading = intent.desired_heading.unwrap_or(current_heading);
        let heading_delta = signed_heading_delta(current_heading, desired_heading);
        let max_turn_step = LOCAL_TURN_RATE_RAD_PER_SEC * dt;
        let applied_turn = heading_delta.clamp(-max_turn_step, max_turn_step);
        let next_heading = normalize_heading(current_heading + applied_turn);
        let speed = match intent.kind {
            LocalMotionKind::Ground { speed } => speed,
        };
        let velocity = if speed <= 1e-6 {
            Vector3::zero()
        } else {
            planar_velocity_for_heading(next_heading, speed)
        };
        let omega = if speed <= 1e-6
            || intent.desired_heading.is_none()
            || heading_delta.abs() <= TURN_COMMAND_THRESHOLD_RAD
        {
            Vector3::zero()
        } else {
            Vector3::new(
                0.0,
                0.0,
                heading_delta.signum() * LOCAL_TURN_RATE_RAD_PER_SEC,
            )
        };

        let mut next_pos = world.player.position;
        next_pos.rotation = Quaternion::from_heading(next_heading);
        next_pos.coords = next_pos.coords + (velocity * dt);

        let mut events = world.set_player_position(next_pos);
        events.extend(world.set_player_vector(velocity, omega));
        events
    }

    pub(super) async fn send_autonomous_position_heartbeat(
        &mut self,
        world: &WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<bool> {
        let Some(pulse) = build_autonomous_position_heartbeat(world, metadata) else {
            return Ok(false);
        };

        log::debug!(
            ">>>> Sending AutonomousPosition heartbeat. ServerSeq: {}, Pos: {:?}",
            world.player.server_control_sequence,
            pulse.position
        );

        session
            .send_action(GameAction::AutonomousPosition(Box::new(pulse)))
            .await?;

        Ok(true)
    }

    async fn send_autonomous_position_sync(
        world: &WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<bool> {
        let Some(pulse) = build_autonomous_position_sync(world, metadata) else {
            return Ok(false);
        };

        log::debug!(
            ">>>> Sending AutonomousPosition sync. ServerSeq: {}, Pos: {:?}",
            world.player.server_control_sequence,
            pulse.position
        );

        session
            .send_action(GameAction::AutonomousPosition(Box::new(pulse)))
            .await?;

        Ok(true)
    }

    async fn send_drive_pulse(
        world: &WorldState,
        session: &mut Session,
        current_heading: f32,
        desired_heading: f32,
        speed: f32,
        metadata: MovementPacketMetadata,
    ) -> Result<()> {
        let mut position = world.player.position;
        position.rotation = Quaternion::from_heading(current_heading);

        let data = holtburger_protocol::messages::game_action::MoveToStateActionData {
            raw_motion_state: build_drive_raw_motion_state(
                world,
                current_heading,
                desired_heading,
                speed,
                metadata.motion_style,
            ),
            position,
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
            position: world.player.position,
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

    pub(super) async fn handle_server_controlled_movement(
        &mut self,
        data: MovementEventData,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<(Vec<WireEvent>, Vec<WorldEvent>)> {
        let mut wire_events = Vec::new();
        log::info!(
            ">>> Processing server-initiated movement: {:?}. Control Sequence: {}",
            data.movement_type,
            data.server_control_sequence
        );

        let mut next_pos = world.player.position;

        match &data.data {
            MovementTypeData::MoveToObject(mto) => {
                // We use the origin provided in the packet as the source of truth for the target's position.
                // This is more reliable than our local entity tracking which might be uninitialized (e.g. landblock 0).
                next_pos.landblock_id = mto.origin.cell_id;
                next_pos.coords = mto.origin.position;

                let arrival_dist = mto.params.distance_to_object;

                // Calculate arrival on the line between the player and the target
                if (world.player.position.landblock_id >> 16) == (next_pos.landblock_id >> 16) {
                    next_pos.coords = calculate_arrival_position(
                        &world.player.position,
                        &next_pos.coords,
                        arrival_dist,
                    );

                    // If desired_heading is 0.0, face the target
                    if mto.params.desired_heading.abs() <= 1e-6 {
                        next_pos.rotation = Quaternion::from_heading(
                            next_pos.coords.heading_to(&mto.origin.position),
                        );
                    } else {
                        next_pos.rotation = Quaternion::from_heading(mto.params.desired_heading);
                    }
                } else {
                    // Different landblocks, fallback to simple offset
                    next_pos.coords.x += arrival_dist;
                }
            }
            MovementTypeData::MoveToPosition(mtp) => {
                next_pos.landblock_id = mtp.origin.cell_id;
                next_pos.coords = mtp.origin.position;

                // If desired_heading is not zero, use it.
                if mtp.params.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(mtp.params.desired_heading);
                } else {
                    // Face the target position from our current position
                    next_pos.rotation = Quaternion::from_heading(
                        world.player.position.coords.heading_to(&next_pos.coords),
                    );
                }
            }
            MovementTypeData::TurnToHeading(tth) => {
                next_pos.rotation = Quaternion::from_heading(tth.params.desired_heading);
            }
            MovementTypeData::TurnToObject(tto) => {
                // If the turn has a heading, use it. Some TurnToObjects have 0.0 which means "compute it".
                if tto.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(tto.desired_heading);
                } else if let Some(target) = world.get_visible_entity(tto.target) {
                    // Try to compute heading to target (West = 0, North = 90, East = 180, South = 270)
                    // We only do this if they are in the same landblock for now.
                    if target.position.landblock_id == next_pos.landblock_id {
                        next_pos.rotation = Quaternion::from_heading(
                            next_pos.coords.heading_to(&target.position.coords),
                        );
                    }
                }
            }
            _ => {
                // For other movement types (like Stop), we just accept current position
            }
        }

        // Update local world state (Teleport)
        // Check distance safely - ignore check if we are uninitialized (landblock 0) or just logging in
        let distance = if world.player.position.landblock_id == Guid::NULL {
            0.0
        } else {
            world.player.position.distance_to(&next_pos)
        };

        if distance > AUTO_MOVE_DISTANCE_LIMIT {
            log::warn!(
                "Aborting auto-move: target is {:.2}m away (limit {}m)",
                distance,
                AUTO_MOVE_DISTANCE_LIMIT
            );
            wire_events.push(WireEvent::ClientError(format!(
                "Item is too far away ({:.1}m). Move closer!",
                distance
            )));
            return Ok((wire_events, Vec::new()));
        }

        let state_events = world.set_player_position(next_pos);

        Self::send_autonomous_position_sync(world, session, MovementPacketMetadata::default())
            .await?;

        Ok((wire_events, state_events))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Vector3;
    use holtburger_protocol::messages::movement::MotionStance;
    use holtburger_session::Session;
    use holtburger_world::WorldState;
    use holtburger_world::entity::Entity;

    #[test]
    fn test_calculate_heading_to() {
        let source = Vector3::new(0.0, 0.0, 0.0);
        // North (0, 1, 0) -> Math Rad: atan2(0, 1) = 0. Deg: 450 - 0 = 450 % 360 = 90 deg (1.57 rad)
        // Wait, let's verify AC heading convention.
        // My function says 90 deg for North.
        let heading = source.heading_to(&Vector3::new(0.0, 1.0, 0.0));
        assert!((heading.to_degrees() - 90.0).abs() < 1e-4);

        // West (-1, 0, 0) -> Math Rad: atan2(1, 0) = pi/2 (90 deg). Deg: 450 - 90 = 360 % 360 = 0 deg
        let heading = source.heading_to(&Vector3::new(-1.0, 0.0, 0.0));
        assert!((heading.to_degrees() - 0.0).abs() < 1e-4);

        // East (1, 0, 0) -> Math Rad: atan2(-1, 0) = -pi/2 (-90 deg). Deg: 450 - (-90) = 540 % 360 = 180 deg
        let heading = source.heading_to(&Vector3::new(1.0, 0.0, 0.0));
        assert!((heading.to_degrees() - 180.0).abs() < 1e-4);

        // South (0, -1, 0) -> Math Rad: atan2(0, -1) = pi (180 deg). Deg: 450 - 180 = 270 deg
        let heading = source.heading_to(&Vector3::new(0.0, -1.0, 0.0));
        assert!((heading.to_degrees() - 270.0).abs() < 1e-4);
    }

    #[test]
    fn test_calculate_arrival_position() {
        let source = WorldPosition {
            coords: Vector3::new(0.0, 0.0, 0.0),
            ..Default::default()
        };
        let target_pos = Vector3::new(10.0, 0.0, 0.0);
        let arrival_dist = 2.0;

        // Should stop at (8, 0, 0)
        let pos = calculate_arrival_position(&source, &target_pos, arrival_dist);
        assert!((pos.x - 8.0).abs() < 1e-4);
        assert!(pos.y.abs() < 1e-4);
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
    fn drive_raw_motion_state_adds_right_turn_when_heading_increases() {
        let world = WorldState::synthetic();

        let raw_motion_state = build_drive_raw_motion_state(
            &world,
            0.0,
            90.0_f32.to_radians(),
            4.5,
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
        assert_eq!(
            raw_motion_state.turn_command,
            Some(TURN_RIGHT_MOTION_COMMAND)
        );
    }

    #[test]
    fn drive_raw_motion_state_adds_left_turn_when_heading_decreases() {
        let world = WorldState::synthetic();

        let raw_motion_state = build_drive_raw_motion_state(
            &world,
            180.0_f32.to_radians(),
            90.0_f32.to_radians(),
            4.5,
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
    }

    #[test]
    fn drive_raw_motion_state_omits_turn_when_heading_is_aligned() {
        let world = WorldState::synthetic();

        let raw_motion_state = build_drive_raw_motion_state(
            &world,
            90.0_f32.to_radians(),
            95.0_f32.to_radians(),
            4.5,
            MotionStyle::PreserveServer,
        );

        assert!(
            !raw_motion_state
                .flags
                .contains(RawMotionFlags::TURN_COMMAND)
        );
        assert_eq!(raw_motion_state.turn_command, None);
    }

    #[test]
    fn local_motion_prediction_advances_player_position_from_velocity() {
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
        movement.apply_movement_primitive(
            MovementPrimitive::Drive {
                heading: 180.0_f32.to_radians(),
                speed: 1.0,
            },
            Some((180.0_f32.to_radians(), 1.0)),
            true,
            &mut world,
        );

        let events = movement.advance_local_motion_prediction(0.5, &mut world);

        assert!(
            events.iter().any(|event| matches!(event, WorldEvent::EntityMoved { guid, pos } if *guid == player_guid && (pos.coords.x - 19.0).abs() < 1e-5 && (pos.coords.y - 20.0).abs() < 1e-5))
        );
        assert!((world.player.position.coords.x - 19.0).abs() < 1e-5);
        assert!((world.player.position.coords.y - 20.0).abs() < 1e-5);
    }

    #[test]
    fn local_motion_prediction_ignores_missing_drive_intent() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x50000123);
        let position = WorldPosition {
            landblock_id: Guid(0x12340000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::identity(),
        };
        world.player.guid = player_guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(player_guid, "Player".to_string(), position));

        let events = MovementSystem::new().advance_local_motion_prediction(0.5, &mut world);

        assert!(events.is_empty());
        assert_eq!(world.player.position, position);
    }

    #[test]
    fn local_motion_prediction_turns_toward_desired_heading_without_snapping() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x50000123);
        let position = WorldPosition {
            landblock_id: Guid(0x12340000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::identity(),
        };
        world.player.guid = player_guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(player_guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let events = movement.apply_movement_primitive(
            MovementPrimitive::Drive {
                heading: 180.0_f32.to_radians(),
                speed: 1.0,
            },
            Some((180.0_f32.to_radians(), 1.0)),
            true,
            &mut world,
        );

        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, velocity, .. }
                if *guid == player_guid && velocity.length_squared() > 0.0
        )));
        assert_eq!(world.player.position.rotation, position.rotation);

        let _ = movement.advance_local_motion_prediction(0.25, &mut world);

        let new_heading = world.player.position.rotation.to_heading();
        assert!(new_heading > 0.0);
        assert!(new_heading < 180.0_f32.to_radians());
    }

    #[test]
    fn local_motion_prediction_uses_discretized_run_velocity_for_server_drive() {
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
        movement.apply_movement_primitive(
            MovementPrimitive::Drive {
                heading: 90.0_f32.to_radians(),
                speed: 0.5,
            },
            Some((90.0_f32.to_radians(), 0.5)),
            true,
            &mut world,
        );

        let events = movement.advance_local_motion_prediction(0.5, &mut world);

        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityMoved { guid, pos }
                if *guid == player_guid
                && (pos.coords.y - 29.0).abs() < 1e-5
                && (pos.coords.z - 0.0).abs() < 1e-5
        )));
        assert!((world.player.position.rotation.w - 1.0).abs() < 1e-5);
        assert!(world.player.position.rotation.x.abs() < 1e-5);
        assert!(world.player.position.rotation.y.abs() < 1e-5);
        assert!(world.player.position.rotation.z.abs() < 1e-5);
    }

    #[test]
    fn apply_drive_uses_discretized_planar_run_velocity() {
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
        let events = movement.apply_movement_primitive(
            MovementPrimitive::Drive {
                heading: 90.0_f32.to_radians(),
                speed: 0.5,
            },
            Some((90.0_f32.to_radians(), 0.5)),
            true,
            &mut world,
        );

        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, velocity, .. }
                if *guid == player_guid
                    && velocity.x.abs() < 1e-5
                    && (velocity.y - 18.0).abs() < 1e-5
                    && velocity.z.abs() < 1e-5
        )));
    }

    #[test]
    fn kinematics_expose_run_walk_and_turn_planning_constants() {
        let movement = MovementSystem::new();
        let kinematics = movement.kinematics();

        assert!((kinematics.run_speed_mps - (RUN_ANIM_SPEED * SERVER_RUN_SPEED)).abs() < 1e-5);
        assert!((kinematics.walk_speed_mps - RUN_ANIM_SPEED).abs() < 1e-5);
        assert!((kinematics.turn_rate_rad_per_sec - LOCAL_TURN_RATE_RAD_PER_SEC).abs() < 1e-5);
    }

    #[test]
    fn duration_and_displacement_helpers_share_one_run_vocabulary() {
        let movement = MovementSystem::new();
        let control = MovementControl::Run {
            heading: 90.0_f32.to_radians(),
        };
        let distance = 9.0;

        let duration = movement.estimate_duration_for_distance(control, distance);
        let displacement = movement.estimate_displacement(control, duration);

        assert!((duration.as_secs_f32() - 0.5).abs() < 1e-5);
        assert!((displacement - distance).abs() < 1e-4);
    }

    #[test]
    fn turn_controls_have_zero_displacement_and_duration_helpers() {
        let movement = MovementSystem::new();
        let control = MovementControl::TurnLeft;

        assert_eq!(
            movement.estimate_duration_for_distance(control, 5.0),
            Duration::ZERO
        );
        assert_eq!(
            movement.estimate_displacement(control, Duration::from_secs(1)),
            0.0
        );
    }

    #[test]
    fn off_phase_discretized_drive_zeroes_local_velocity_and_turn_rate() {
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
        let events = movement.apply_movement_primitive(
            MovementPrimitive::Drive {
                heading: 180.0_f32.to_radians(),
                speed: 1.0,
            },
            Some((180.0_f32.to_radians(), 1.0)),
            false,
            &mut world,
        );

        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, velocity, omega }
                if *guid == player_guid
                    && velocity.length_squared() <= 1e-6
                    && omega.length_squared() <= 1e-6
        )));
    }

    #[test]
    fn stop_pulse_is_still_required_when_server_motion_is_active() {
        let mut movement = MovementSystem::new();
        movement.note_server_drive_sent(server_drive_intent(
            0.0,
            std::f32::consts::PI,
            MotionStyle::PreserveServer,
        ));

        assert!(movement.should_send_stop_pulse());
    }

    #[test]
    fn note_server_motion_cleared_resets_drive_tracking() {
        let mut movement = MovementSystem::new();
        movement.note_server_drive_sent(server_drive_intent(
            0.0,
            std::f32::consts::PI,
            MotionStyle::PreserveServer,
        ));

        movement.note_server_motion_cleared();

        assert!(!movement.server_motion_active);
        assert!(movement.last_server_drive_intent.is_none());
    }

    #[test]
    fn unchanged_drive_intent_does_not_require_server_refresh() {
        let mut movement = MovementSystem::new();
        movement.note_server_drive_sent(server_drive_intent(
            0.0,
            std::f32::consts::PI,
            MotionStyle::PreserveServer,
        ));

        assert!(!movement.should_send_drive_pulse(
            0.0,
            std::f32::consts::PI,
            MotionStyle::PreserveServer,
        ));
    }

    #[test]
    fn partial_speed_requests_are_quantized_into_run_pulses_over_time() {
        let mut movement = MovementSystem::new();
        let now = Instant::now();

        assert!(movement.should_actuate_server_run(now, SERVER_RUN_SPEED * 0.25));
        assert!(
            !movement.should_actuate_server_run(
                now + Duration::from_millis(100),
                SERVER_RUN_SPEED * 0.25,
            )
        );
        assert!(
            movement.should_actuate_server_run(
                now + Duration::from_millis(220),
                SERVER_RUN_SPEED * 0.25,
            )
        );
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

        let heartbeat =
            build_autonomous_position_heartbeat(&world, MovementPacketMetadata::default())
                .expect("moving player should emit heartbeat");

        assert_eq!(heartbeat.position, position);
        assert_eq!(heartbeat.instance_sequence, 11);
        assert_eq!(heartbeat.server_control_sequence, 22);
        assert_eq!(heartbeat.teleport_sequence, 33);
        assert_eq!(heartbeat.force_position_sequence, 44);
        assert_eq!(heartbeat.last_contact, 1);
    }

    #[test]
    fn autonomous_position_heartbeat_uses_server_grounded_when_contact_unspecified() {
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

        let heartbeat =
            build_autonomous_position_heartbeat(&world, MovementPacketMetadata::default())
                .expect("moving player should emit heartbeat");

        assert_eq!(heartbeat.last_contact, 1);
    }

    #[test]
    fn autonomous_position_sync_can_be_built_for_stationary_player() {
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

        let sync = build_autonomous_position_sync(&world, MovementPacketMetadata::default())
            .expect("server-controlled sync should emit even when stationary");

        assert_eq!(sync.position, position);
        assert_eq!(sync.instance_sequence, 11);
        assert_eq!(sync.server_control_sequence, 22);
        assert_eq!(sync.teleport_sequence, 33);
        assert_eq!(sync.force_position_sequence, 44);
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
            .execute_movement_request(
                MovementRequest::new(MovementPrimitive::Drive {
                    heading: 90.0_f32.to_radians(),
                    speed: 1.0,
                }),
                &mut world,
                &mut session,
            )
            .await
            .expect("drive request should succeed");

        entity.velocity = Vector3::new(0.0, 4.0, 0.0);
        world.entities.insert(entity);

        movement
            .execute_movement_request(
                MovementRequest::new(MovementPrimitive::Stop),
                &mut world,
                &mut session,
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
        movement.note_server_drive_sent(server_drive_intent(
            0.0,
            std::f32::consts::PI,
            MotionStyle::PreserveServer,
        ));

        movement
            .execute_movement_request(
                MovementRequest::new(MovementPrimitive::Stop),
                &mut world,
                &mut session,
            )
            .await
            .expect("stop request should succeed");

        assert_eq!(session.packet_sequence, 2);
    }

    #[tokio::test]
    async fn partial_drive_requests_toggle_between_run_and_stop_pulses() {
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
        let request = MovementRequest::new(MovementPrimitive::Drive {
            heading: 90.0_f32.to_radians(),
            speed: SERVER_RUN_SPEED * 0.25,
        });

        movement
            .execute_movement_request_at(request, &mut world, &mut session, start)
            .await
            .expect("initial pulsed drive should send a run pulse");
        assert_eq!(session.packet_sequence, 2);

        movement
            .execute_movement_request_at(
                request,
                &mut world,
                &mut session,
                start + Duration::from_millis(100),
            )
            .await
            .expect("off-phase pulsed drive should send a stop pulse");
        assert_eq!(session.packet_sequence, 3);

        movement
            .execute_movement_request_at(
                request,
                &mut world,
                &mut session,
                start + Duration::from_millis(220),
            )
            .await
            .expect("next pulse window should resume running");
        assert_eq!(session.packet_sequence, 4);
    }

    #[tokio::test]
    async fn held_run_input_ticks_once_for_wire_and_keeps_local_vectors_consistent() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::identity(),
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let start = Instant::now();

        movement.enqueue_input(
            MovementInput::Hold {
                control: MovementControl::Run {
                    heading: 90.0_f32.to_radians(),
                },
            },
            start,
        );

        movement
            .tick(start, &mut world, &mut session)
            .await
            .expect("held run input should start moving");

        let player = world
            .entities
            .get(guid)
            .expect("synthetic player entity should exist");
        assert!(player.velocity.x.abs() < 1e-5);
        assert!((player.velocity.y - 18.0).abs() < 1e-5);
        assert_eq!(session.packet_sequence, 2);

        movement
            .tick(start + Duration::from_millis(30), &mut world, &mut session)
            .await
            .expect("steady held run should not resend unchanged drive intent");

        let player = world
            .entities
            .get(guid)
            .expect("synthetic player entity should exist");
        assert!(player.velocity.x.abs() < 1e-5);
        assert!((player.velocity.y - 18.0).abs() < 1e-5);
        assert_eq!(session.packet_sequence, 2);
    }

    #[tokio::test]
    async fn pulsed_run_input_expires_on_tick_and_sends_stop_transition() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let position = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, -4.0, 1.5),
            rotation: Quaternion::identity(),
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let start = Instant::now();

        movement.enqueue_input(
            MovementInput::Pulse {
                control: MovementControl::Run {
                    heading: 90.0_f32.to_radians(),
                },
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
            rotation: Quaternion::identity(),
        };

        world.player.guid = guid;
        world.player.position = position;
        world
            .entities
            .insert(Entity::new(guid, "Player".to_string(), position));

        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let start = Instant::now();

        movement.enqueue_input(
            MovementInput::Hold {
                control: MovementControl::Run {
                    heading: 90.0_f32.to_radians(),
                },
            },
            start,
        );
        movement
            .tick(start, &mut world, &mut session)
            .await
            .expect("held run should start");

        movement.enqueue_input(MovementInput::Stop, start + Duration::from_millis(30));
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
            rotation: Quaternion::identity(),
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
                90.0_f32.to_radians(),
                &mut world,
                &mut session,
                MovementPacketMetadata::default(),
            )
            .await
            .expect("snap facing should succeed");

        let _ = events;
        assert!((world.player.position.rotation.to_heading() - 90.0_f32.to_radians()).abs() < 1e-5);
        assert_eq!(session.packet_sequence, 1);
    }

    #[test]
    fn autonomous_position_heartbeat_skips_stationary_players() {
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

        assert!(
            build_autonomous_position_heartbeat(&world, MovementPacketMetadata::default())
                .is_none()
        );
    }
}
