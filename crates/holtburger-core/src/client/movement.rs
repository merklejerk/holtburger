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
const WALK_FORWARD_MOTION_COMMAND: u32 = 0x4500_0005;
const WALK_BACKWARD_MOTION_COMMAND: u32 = 0x4500_0006;
const TURN_RIGHT_MOTION_COMMAND: u32 = 0x6500_000d;
const TURN_LEFT_MOTION_COMMAND: u32 = 0x6500_000e;
const SIDESTEP_RIGHT_MOTION_COMMAND: u32 = 0x6500_000f;
const SIDESTEP_LEFT_MOTION_COMMAND: u32 = 0x6500_0010;
const RUN_HELD_TURN_SPEED_RAD_PER_SEC: f32 = 1.5;
const WALK_HELD_TURN_SPEED_RAD_PER_SEC: f32 = 1.0;

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

fn turn_motion_command(control: Option<MovementControl>) -> Option<u32> {
    match control {
        Some(MovementControl::TurnRight) => Some(TURN_RIGHT_MOTION_COMMAND),
        Some(MovementControl::TurnLeft) => Some(TURN_LEFT_MOTION_COMMAND),
        _ => None,
    }
}

fn locomotion_motion_command(control: MovementControl) -> (u32, f32) {
    match control {
        MovementControl::Run => (WALK_FORWARD_MOTION_COMMAND, SERVER_RUN_SPEED),
        MovementControl::Walk => (WALK_FORWARD_MOTION_COMMAND, 1.0),
        MovementControl::Backstep => (WALK_BACKWARD_MOTION_COMMAND, 1.0),
        MovementControl::StrafeRight => (SIDESTEP_RIGHT_MOTION_COMMAND, 1.0),
        MovementControl::StrafeLeft => (SIDESTEP_LEFT_MOTION_COMMAND, 1.0),
        MovementControl::TurnLeft | MovementControl::TurnRight => {
            unreachable!("turn controls are not locomotion commands")
        }
    }
}

fn current_hold_key_for_controls(
    locomotion: Option<MovementControl>,
    turning: Option<MovementControl>,
) -> HoldKey {
    match locomotion {
        Some(MovementControl::Run) => HoldKey::Run,
        Some(
            MovementControl::Walk
            | MovementControl::Backstep
            | MovementControl::StrafeLeft
            | MovementControl::StrafeRight,
        ) => HoldKey::None,
        Some(MovementControl::TurnLeft | MovementControl::TurnRight) => HoldKey::None,
        None if turning.is_some() => HoldKey::Run,
        None => HoldKey::None,
    }
}

fn turn_speed_for_controls(
    locomotion: Option<MovementControl>,
    turning: Option<MovementControl>,
) -> Option<f32> {
    turning.map(|_| match current_hold_key_for_controls(locomotion, turning) {
        HoldKey::Run => RUN_HELD_TURN_SPEED_RAD_PER_SEC,
        HoldKey::Invalid | HoldKey::None => WALK_HELD_TURN_SPEED_RAD_PER_SEC,
    })
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
    if player_entity.velocity.length_squared() < 0.0001
        && player_entity.omega.length_squared() < 0.0001
    {
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

fn build_controls_raw_motion_state(
    world: &WorldState,
    locomotion: Option<MovementControl>,
    turning: Option<MovementControl>,
    motion_style: MotionStyle,
) -> RawMotionState {
    let mut raw_motion_state = RawMotionState {
        flags: RawMotionFlags::CURRENT_HOLD_KEY,
        current_hold_key: Some(current_hold_key_for_controls(locomotion, turning) as u32),
        ..Default::default()
    };

    if let Some(control) = locomotion {
        let (command, speed) = locomotion_motion_command(control);
        match control {
            MovementControl::Run | MovementControl::Walk | MovementControl::Backstep => {
                raw_motion_state.flags |=
                    RawMotionFlags::FORWARD_COMMAND | RawMotionFlags::FORWARD_SPEED;
                raw_motion_state.forward_command = Some(command);
                raw_motion_state.forward_speed = Some(speed);
            }
            MovementControl::StrafeLeft | MovementControl::StrafeRight => {
                raw_motion_state.flags |=
                    RawMotionFlags::SIDE_STEP_COMMAND | RawMotionFlags::SIDE_STEP_SPEED;
                raw_motion_state.sidestep_command = Some(command);
                raw_motion_state.sidestep_speed = Some(speed);
            }
            MovementControl::TurnLeft | MovementControl::TurnRight => unreachable!(),
        }
    }

    if let Some(turn_command) = turn_motion_command(turning) {
        raw_motion_state.flags |= RawMotionFlags::TURN_COMMAND;
        raw_motion_state.turn_command = Some(turn_command);

        if let Some(turn_speed) = turn_speed_for_controls(locomotion, turning) {
            raw_motion_state.flags |= RawMotionFlags::TURN_SPEED;
            raw_motion_state.turn_speed = Some(turn_speed);
        }
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
    last_server_motion_intent: Option<ServerMotionIntent>,
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
struct LocalMotionIntent {
    locomotion: Option<MovementControl>,
    turning: Option<MovementControl>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ServerMotionIntent {
    locomotion: Option<MovementControl>,
    turning: Option<MovementControl>,
    motion_style: MotionStyle,
}

fn server_motion_intent(
    locomotion: Option<MovementControl>,
    turning: Option<MovementControl>,
    motion_style: MotionStyle,
) -> ServerMotionIntent {
    ServerMotionIntent {
        locomotion,
        turning,
        motion_style,
    }
}

fn local_motion_from_controls(
    locomotion: Option<MovementControl>,
    turning: Option<MovementControl>,
) -> Option<LocalMotionIntent> {
    if locomotion.is_none() && turning.is_none() {
        return None;
    }

    Some(LocalMotionIntent {
        locomotion,
        turning,
    })
}

fn local_velocity_for_control(current_heading: f32, locomotion: Option<MovementControl>) -> Vector3 {
    match locomotion {
        Some(MovementControl::Run) => planar_velocity_for_heading(current_heading, SERVER_RUN_SPEED),
        Some(MovementControl::Walk) => planar_velocity_for_heading(current_heading, 1.0),
        Some(MovementControl::Backstep) => {
            planar_velocity_for_heading(normalize_heading(current_heading + PI), 1.0)
        }
        Some(MovementControl::StrafeLeft) => {
            planar_velocity_for_heading(normalize_heading(current_heading - (PI / 2.0)), 1.0)
        }
        Some(MovementControl::StrafeRight) => {
            planar_velocity_for_heading(normalize_heading(current_heading + (PI / 2.0)), 1.0)
        }
        Some(MovementControl::TurnLeft | MovementControl::TurnRight) | None => Vector3::zero(),
    }
}

fn local_omega_for_control(
    locomotion: Option<MovementControl>,
    turning: Option<MovementControl>,
) -> Vector3 {
    let turn_speed = turn_speed_for_controls(locomotion, turning).unwrap_or(0.0);

    match turning {
        Some(MovementControl::TurnRight) => Vector3::new(0.0, 0.0, turn_speed),
        Some(MovementControl::TurnLeft) => Vector3::new(0.0, 0.0, -turn_speed),
        Some(
            MovementControl::Run
            | MovementControl::Walk
            | MovementControl::Backstep
            | MovementControl::StrafeLeft
            | MovementControl::StrafeRight,
        )
        | None => Vector3::zero(),
    }
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
            last_server_motion_intent: None,
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
            MovementControl::Run => RUN_ANIM_SPEED * SERVER_RUN_SPEED,
            MovementControl::Walk => RUN_ANIM_SPEED,
            MovementControl::Backstep => RUN_ANIM_SPEED,
            MovementControl::StrafeLeft | MovementControl::StrafeRight => {
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
            MovementControl::Run
            | MovementControl::Walk
            | MovementControl::Backstep
            | MovementControl::StrafeLeft
            | MovementControl::StrafeRight => self.active_public_locomotion = next,
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
            log::info!(
                "movement: expiring locomotion control {:?} at tick {:?}",
                self.active_public_locomotion,
                now,
            );
            self.active_public_locomotion = None;
        }

        if self
            .active_public_turn
            .is_some_and(|active| active.until.is_some_and(|until| now >= until))
        {
            log::info!(
                "movement: expiring turn control {:?} at tick {:?}",
                self.active_public_turn,
                now,
            );
            self.active_public_turn = None;
        }
    }

    fn public_request_for_tick(&self) -> Option<MovementRequest> {
        let locomotion = self.active_public_locomotion.map(|active| active.control);
        let turning = self.active_public_turn.map(|active| active.control);

        if locomotion.is_none() && turning.is_none() {
            None
        } else {
            Some(MovementRequest::new(MovementPrimitive::Controls {
                locomotion,
                turning,
            }))
        }
    }

    pub(super) async fn tick(
        &mut self,
        now: Instant,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<WorldEvent>> {
        let queued = std::mem::take(&mut self.queued_inputs);
        if !queued.is_empty() {
            log::info!(
                "movement: ingesting {} queued inputs at tick {:?}: {:?}",
                queued.len(),
                now,
                queued,
            );
        }
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
        if self.pending_snap_facing.is_some()
            || request.is_some()
            || self.local_motion.is_some()
            || self.server_motion_active
        {
            log::info!(
                "movement: tick state locomotion={:?} turn={:?} snap={:?} request={:?} local_motion={:?} server_motion_active={}",
                self.active_public_locomotion,
                self.active_public_turn,
                self.pending_snap_facing,
                request,
                self.local_motion,
                self.server_motion_active,
            );
        }

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

    fn should_send_motion_pulse(
        &self,
        locomotion: Option<MovementControl>,
        turning: Option<MovementControl>,
        motion_style: MotionStyle,
    ) -> bool {
        if !self.server_motion_active {
            return true;
        }

        self.last_server_motion_intent != Some(server_motion_intent(locomotion, turning, motion_style))
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

        let controls = match primitive {
            MovementPrimitive::Controls {
                locomotion,
                turning,
            } => Some((locomotion, turning)),
            _ => None,
        };
        if let Some((locomotion, turning)) = controls {
            log::info!(
                "movement: control request locomotion={:?} turning={:?} at tick {:?} (last_server_motion_intent={:?})",
                locomotion,
                turning,
                now,
                self.last_server_motion_intent,
            );
        }
        let had_active_local_motion = self.local_motion.is_some();
        let state_events = self.apply_movement_primitive(primitive, world);

        match primitive {
            MovementPrimitive::Stop if self.should_send_stop_pulse() => {
                log::info!(
                    "movement: sending stop pulse (had_active_local_motion={}, server_motion_active={})",
                    had_active_local_motion,
                    self.server_motion_active,
                );
                Self::send_stop_pulse(world, session, request.metadata).await?;
                if had_active_local_motion {
                    Self::send_autonomous_position_sync(world, session, request.metadata).await?;
                }
                self.note_server_motion_cleared();
            }
            MovementPrimitive::Controls {
                locomotion,
                turning,
            } if self.should_send_motion_pulse(locomotion, turning, request.metadata.motion_style) => {
                log::info!(
                    "movement: sending motion pulse locomotion={:?} turning={:?}",
                    locomotion,
                    turning,
                );
                Self::send_motion_pulse(world, session, locomotion, turning, request.metadata)
                    .await?;
                self.note_server_motion_sent(server_motion_intent(
                    locomotion,
                    turning,
                    request.metadata.motion_style,
                ));
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

        log::info!(
            "movement: snap facing from {:.3} rad to {:.3} rad",
            current_heading,
            normalized_heading,
        );

        if signed_heading_delta(current_heading, normalized_heading).abs() <= 1e-4 {
            return Ok(Vec::new());
        }

        let mut next_pos = world.player.position;
        next_pos.rotation = Quaternion::from_heading(normalized_heading);
        let mut world_events = world.set_player_position(next_pos);

        if self.local_motion.is_some() {
            world_events.extend(self.sync_local_motion_vectors(world));
        }

        Self::send_autonomous_position_sync(world, session, metadata).await?;

        Ok(world_events)
    }

    fn apply_movement_primitive(
        &mut self,
        primitive: MovementPrimitive,
        world: &mut WorldState,
    ) -> Vec<WorldEvent> {
        match primitive {
            MovementPrimitive::Controls {
                locomotion,
                turning,
            } => {
                self.local_motion = local_motion_from_controls(locomotion, turning);
                self.sync_local_motion_vectors(world)
            }
            MovementPrimitive::SnapFacing { heading } => {
                let mut next_pos = world.player.position;
                next_pos.rotation = Quaternion::from_heading(normalize_heading(heading));
                let mut events = world.set_player_position(next_pos);

                if self.local_motion.is_some() {
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
        let velocity = local_velocity_for_control(current_heading, intent.locomotion);
        let omega = local_omega_for_control(intent.locomotion, intent.turning);

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
        let turn_speed = turn_speed_for_controls(intent.locomotion, intent.turning).unwrap_or(0.0);
        let turn_step = match intent.turning {
            Some(MovementControl::TurnRight) => turn_speed * dt,
            Some(MovementControl::TurnLeft) => -turn_speed * dt,
            _ => 0.0,
        };
        let next_heading = normalize_heading(current_heading + turn_step);
        let velocity = local_velocity_for_control(next_heading, intent.locomotion);
        let omega = local_omega_for_control(intent.locomotion, intent.turning);

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

    async fn send_motion_pulse(
        world: &WorldState,
        session: &mut Session,
        locomotion: Option<MovementControl>,
        turning: Option<MovementControl>,
        metadata: MovementPacketMetadata,
    ) -> Result<()> {
        let data = holtburger_protocol::messages::game_action::MoveToStateActionData {
            raw_motion_state: build_controls_raw_motion_state(
                world,
                locomotion,
                turning,
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
    fn controls_raw_motion_state_adds_right_turn_when_requested() {
        let world = WorldState::synthetic();

        let raw_motion_state = build_controls_raw_motion_state(
            &world,
            Some(MovementControl::Run),
            Some(MovementControl::TurnRight),
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
        assert!(
            raw_motion_state
                .flags
                .contains(RawMotionFlags::TURN_SPEED)
        );
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
    fn controls_raw_motion_state_adds_left_turn_when_requested() {
        let world = WorldState::synthetic();

        let raw_motion_state = build_controls_raw_motion_state(
            &world,
            Some(MovementControl::Run),
            Some(MovementControl::TurnLeft),
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
    }

    #[test]
    fn controls_raw_motion_state_omits_turn_when_not_requested() {
        let world = WorldState::synthetic();

        let raw_motion_state = build_controls_raw_motion_state(
            &world,
            Some(MovementControl::Run),
            None,
            MotionStyle::PreserveServer,
        );

        assert!(
            !raw_motion_state
                .flags
                .contains(RawMotionFlags::TURN_COMMAND)
        );
        assert!(
            !raw_motion_state
                .flags
                .contains(RawMotionFlags::TURN_SPEED)
        );
        assert_eq!(raw_motion_state.turn_command, None);
        assert_eq!(raw_motion_state.turn_speed, None);
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
        world.player.position.rotation = Quaternion::from_heading(180.0_f32.to_radians());
        let _ = world.set_player_position(world.player.position);
        movement.apply_movement_primitive(
            MovementPrimitive::Controls {
                locomotion: Some(MovementControl::Run),
                turning: None,
            },
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
    fn local_motion_prediction_turns_under_turn_control_without_snapping() {
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
            MovementPrimitive::Controls {
                locomotion: None,
                turning: Some(MovementControl::TurnRight),
            },
            &mut world,
        );

        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, velocity, omega }
                if *guid == player_guid
                    && velocity.length_squared() <= 1e-6
                    && omega.z > 0.0
        )));
        assert_eq!(world.player.position.rotation, position.rotation);

        let _ = movement.advance_local_motion_prediction(0.25, &mut world);

        let new_heading = world.player.position.rotation.to_heading();
        assert!(new_heading > 0.0);
        assert!(new_heading < 180.0_f32.to_radians());
    }

    #[test]
    fn local_motion_prediction_uses_run_velocity_for_run_control() {
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
            MovementPrimitive::Controls {
                locomotion: Some(MovementControl::Run),
                turning: None,
            },
            &mut world,
        );

        world.player.position.rotation = Quaternion::from_heading(90.0_f32.to_radians());
        let _ = world.set_player_position(world.player.position);

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
    fn apply_controls_uses_planar_run_velocity() {
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

        world.player.position.rotation = Quaternion::from_heading(90.0_f32.to_radians());
        let _ = world.set_player_position(world.player.position);

        let mut movement = MovementSystem::new();
        let events = movement.apply_movement_primitive(
            MovementPrimitive::Controls {
                locomotion: Some(MovementControl::Run),
                turning: None,
            },
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
    fn duration_and_displacement_helpers_share_one_run_vocabulary() {
        let movement = MovementSystem::new();
        let control = MovementControl::Run;
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
    fn stop_clears_local_velocity_and_turn_rate() {
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
            MovementPrimitive::Controls {
                locomotion: Some(MovementControl::Run),
                turning: Some(MovementControl::TurnRight),
            },
            &mut world,
        );
        let events = movement.apply_movement_primitive(MovementPrimitive::Stop, &mut world);

        let player = world
            .entities
            .get(player_guid)
            .expect("synthetic player entity should exist");
        assert!(events.is_empty() || events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, .. } if *guid == player_guid
        )));
        assert!(player.velocity.length_squared() <= 1e-6);
        assert!(player.omega.length_squared() <= 1e-6);
    }

    #[test]
    fn combined_controls_can_turn_in_place_locally() {
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
            MovementPrimitive::Controls {
                locomotion: None,
                turning: Some(MovementControl::TurnLeft),
            },
            &mut world,
        );

        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, velocity, omega }
                if *guid == player_guid
                    && velocity.length_squared() <= 1e-6
                    && omega.z.abs() > 1e-6
        )));
    }

    #[test]
    fn stop_pulse_is_still_required_when_server_motion_is_active() {
        let mut movement = MovementSystem::new();
        movement.note_server_motion_sent(server_motion_intent(
            Some(MovementControl::Run),
            Some(MovementControl::TurnRight),
            MotionStyle::PreserveServer,
        ));

        assert!(movement.should_send_stop_pulse());
    }

    #[test]
    fn note_server_motion_cleared_resets_drive_tracking() {
        let mut movement = MovementSystem::new();
        movement.note_server_motion_sent(server_motion_intent(
            Some(MovementControl::Run),
            Some(MovementControl::TurnRight),
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
            Some(MovementControl::Run),
            Some(MovementControl::TurnRight),
            MotionStyle::PreserveServer,
        ));

        assert!(!movement.should_send_motion_pulse(
            Some(MovementControl::Run),
            Some(MovementControl::TurnRight),
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
    fn autonomous_position_heartbeat_includes_turn_only_motion() {
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

        let heartbeat =
            build_autonomous_position_heartbeat(&world, MovementPacketMetadata::default())
                .expect("turning player should emit heartbeat");

        assert_eq!(heartbeat.position, position);
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
                MovementRequest::new(MovementPrimitive::Controls {
                    locomotion: Some(MovementControl::Run),
                    turning: None,
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
        movement.note_server_motion_sent(server_motion_intent(
            Some(MovementControl::Run),
            Some(MovementControl::TurnRight),
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
    async fn unchanged_control_requests_do_not_resend_motion_pulses() {
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
        let request = MovementRequest::new(MovementPrimitive::Controls {
            locomotion: Some(MovementControl::Run),
            turning: Some(MovementControl::TurnRight),
        });

        movement
            .execute_movement_request_at(request, &mut world, &mut session, start)
            .await
            .expect("initial motion request should send a motion pulse");
        assert_eq!(session.packet_sequence, 2);

        movement
            .execute_movement_request_at(
                request,
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

        movement.enqueue_input(
            MovementInput::Hold {
                control: MovementControl::Run,
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
            .expect("steady held run should not resend unchanged motion intent");

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

        movement.enqueue_input(
            MovementInput::Pulse {
                control: MovementControl::Run,
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

        movement.enqueue_input(
            MovementInput::Hold {
                control: MovementControl::Run,
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
