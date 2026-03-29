use super::simulation::LocalMotionIntent;
use crate::client::movement_types::{
    Gait, Locomotion, MotionState, MotionStyle, MovementCommand, MovementPacketMetadata,
    RUN_ANIM_SPEED, Turn, planar_velocity_for_heading,
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
use holtburger_world::{SolvedBodyKinematics, SpatialBodyId, WorldEvent, WorldState};
use std::f32::consts::{PI, TAU};
use std::time::{Duration, Instant};
pub(crate) const SERVER_RUN_SPEED: f32 = 4.5;
pub(crate) const SERVER_PULSE_PERIOD: Duration = Duration::from_millis(200);
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

fn build_autonomous_position_heartbeat(
    world: &WorldState,
    metadata: MovementPacketMetadata,
) -> Option<AutonomousPositionActionData> {
    let (_, velocity, omega) = world.local_player_runtime_kinematics()?;
    if velocity.length_squared() < 0.0001
        && omega.length_squared() < 0.0001
    {
        return None;
    }

    build_autonomous_position_sync(world, metadata)
}

fn build_autonomous_position_sync(
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

fn locomotion_command_for_state(locomotion: Locomotion, gait: Gait) -> (u32, f32) {
    match (gait, locomotion) {
        (Gait::Run, Locomotion::Forward) => (WALK_FORWARD_MOTION_COMMAND, SERVER_RUN_SPEED),
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
    let mut raw_motion_state = RawMotionState {
        flags: RawMotionFlags::CURRENT_HOLD_KEY,
        current_hold_key: Some(hold_key_for_motion_state(state) as u32),
        ..Default::default()
    };

    if let Some(locomotion) = state.locomotion {
        let (command, speed) = locomotion_command_for_state(locomotion, state.gait);
        match locomotion {
            Locomotion::Forward | Locomotion::Backstep => {
                raw_motion_state.flags |=
                    RawMotionFlags::FORWARD_COMMAND | RawMotionFlags::FORWARD_SPEED;
                raw_motion_state.forward_command = Some(command);
                raw_motion_state.forward_speed = Some(speed);
            }
            Locomotion::StrafeLeft | Locomotion::StrafeRight => {
                raw_motion_state.flags |=
                    RawMotionFlags::SIDE_STEP_COMMAND | RawMotionFlags::SIDE_STEP_SPEED;
                raw_motion_state.sidestep_command = Some(command);
                raw_motion_state.sidestep_speed = Some(speed);
            }
        }
    }

    if let Some(turn) = state.turning {
        raw_motion_state.flags |= RawMotionFlags::TURN_COMMAND | RawMotionFlags::TURN_SPEED;
        raw_motion_state.turn_command = Some(turn_motion_command_for_state(turn));
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
    queued_commands: Vec<MovementCommand>,
    pending_snap_facing: Option<f32>,
    active_public_motion: Option<ActivePublicMotion>,
    local_motion: Option<MotionState>,
    server_motion_active: bool,
    last_server_motion_intent: Option<ServerMotionIntent>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ActivePublicMotion {
    state: MotionState,
    until: Option<Instant>,
}

impl ActivePublicMotion {
    fn from_command(state: MotionState, until: Option<Instant>) -> Self {
        Self { state, until }
    }

    fn resolved_state(self) -> MotionState {
        self.state
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

fn locomotion_speed_for_state(state: MotionState) -> f32 {
    match (state.gait, state.locomotion) {
        (_, None) => 0.0,
        (Gait::Run, Some(Locomotion::Forward)) => SERVER_RUN_SPEED,
        (Gait::Walk, Some(Locomotion::Forward)) => 1.0,
        (_, Some(Locomotion::Backstep | Locomotion::StrafeLeft | Locomotion::StrafeRight)) => 1.0,
    }
}

fn local_velocity_for_state(current_heading: f32, state: MotionState) -> Vector3 {
    match state.locomotion {
        Some(Locomotion::Forward) => {
            planar_velocity_for_heading(current_heading, locomotion_speed_for_state(state))
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
            queued_commands: Vec::new(),
            pending_snap_facing: None,
            active_public_motion: None,
            local_motion: None,
            server_motion_active: false,
            last_server_motion_intent: None,
        }
    }

    /// Estimates the pulse duration needed to cover a planar distance for the given motion state.
    /// This is planning math based on the current client actuator model, not a server guarantee.
    pub fn estimate_duration_for_distance(&self, state: MotionState, distance_m: f32) -> Duration {
        let speed = self.motion_state_speed_mps(state);
        if speed <= 1e-6 {
            Duration::ZERO
        } else {
            Duration::from_secs_f32((distance_m.max(0.0) / speed).max(0.0))
        }
    }

    /// Estimates planar displacement for a motion state held for the given duration.
    /// This is planning math based on the current client actuator model, not a server guarantee.
    pub fn estimate_displacement(&self, state: MotionState, duration: Duration) -> f32 {
        self.motion_state_speed_mps(state) * duration.as_secs_f32().max(0.0)
    }

    pub(super) fn enqueue_command(&mut self, command: MovementCommand, _now: Instant) {
        self.queued_commands.push(command);
    }

    fn motion_state_speed_mps(&self, state: MotionState) -> f32 {
        RUN_ANIM_SPEED * locomotion_speed_for_state(state)
    }

    fn ingest_public_command(&mut self, command: MovementCommand, now: Instant) {
        match command {
            MovementCommand::SetMotion { state } => {
                self.active_public_motion = Some(ActivePublicMotion::from_command(state, None));
            }
            MovementCommand::PulseMotion { state, duration } => {
                self.active_public_motion = Some(ActivePublicMotion::from_command(
                    state,
                    Some(now + duration),
                ));
            }
            MovementCommand::SnapFacing { heading } => {
                self.pending_snap_facing = Some(heading);
            }
            MovementCommand::Stop => {
                self.pending_snap_facing = None;
                self.active_public_motion = None;
            }
        }
    }

    fn expire_public_motion(&mut self, now: Instant) {
        let Some(active) = self.active_public_motion else {
            return;
        };

        if active.until.is_some_and(|until| now >= until) {
            log::info!(
                "movement: expiring public motion {:?} at tick {:?}",
                active.state,
                now,
            );
            self.active_public_motion = None;
        }
    }

    fn public_motion_state_for_tick(&self) -> Option<MotionState> {
        self.active_public_motion
            .map(|active| active.resolved_state())
    }

    pub(super) async fn tick(
        &mut self,
        now: Instant,
        world: &mut WorldState,
        session: &mut Session,
    ) -> Result<Vec<WorldEvent>> {
        let queued = std::mem::take(&mut self.queued_commands);
        if !queued.is_empty() {
            log::info!(
                "movement: ingesting {} queued movement commands at tick {:?}: {:?}",
                queued.len(),
                now,
                queued,
            );
        }
        for command in queued {
            self.ingest_public_command(command, now);
        }

        self.expire_public_motion(now);

        let mut events = Vec::new();
        if let Some(heading) = self.pending_snap_facing.take() {
            events.extend(
                self.execute_snap_facing(
                    heading,
                    world,
                    session,
                    MovementPacketMetadata::default(),
                )
                .await?,
            );
        }

        let public_motion = self.public_motion_state_for_tick();
        if self.pending_snap_facing.is_some()
            || public_motion.is_some()
            || self.local_motion.is_some()
            || self.server_motion_active
        {
            log::info!(
                "movement: tick state active_public_motion={:?} snap={:?} public_motion={:?} local_motion={:?} server_motion_active={}",
                self.active_public_motion,
                self.pending_snap_facing,
                public_motion,
                self.local_motion,
                self.server_motion_active,
            );
        }

        match public_motion {
            Some(state) => events.extend(
                self.execute_motion_state_at(state, world, session, now)
                    .await?,
            ),
            None if self.local_motion.is_some() || self.server_motion_active => {
                events.extend(
                    self.execute_stop_at(world, session, MovementPacketMetadata::default())
                        .await?,
                );
            }
            None => {}
        }

        Ok(events)
    }

    pub(super) fn current_local_intent(&self, world: &WorldState) -> Option<LocalMotionIntent> {
        if world.player.guid == Guid::NULL {
            return None;
        }

        let locomotion = self.local_motion?;

        Some(LocalMotionIntent {
            body_id: SpatialBodyId::LocalPlayer(world.player.guid),
            locomotion,
        })
    }

    pub(super) fn handle_post_solve(
        &mut self,
        _world: &WorldState,
        _solved: &SolvedBodyKinematics,
    ) -> Vec<WorldEvent> {
        Vec::new()
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
        world: &mut WorldState,
        session: &mut Session,
        metadata: MovementPacketMetadata,
    ) -> Result<Vec<WorldEvent>> {
        let had_active_local_motion = self.local_motion.is_some();
        let state_events = self.apply_motion_state_stop(world);

        if self.should_send_stop_pulse() {
            log::info!(
                "movement: sending stop pulse (had_active_local_motion={}, server_motion_active={})",
                had_active_local_motion,
                self.server_motion_active,
            );
            Self::send_stop_pulse(world, session, metadata).await?;
            if had_active_local_motion {
                Self::send_autonomous_position_sync(world, session, metadata).await?;
            }
            self.note_server_motion_cleared();
        }

        Ok(state_events)
    }

    async fn execute_motion_state_with_metadata_at(
        &mut self,
        state: MotionState,
        metadata: MovementPacketMetadata,
        world: &mut WorldState,
        session: &mut Session,
        now: Instant,
    ) -> Result<Vec<WorldEvent>> {
        log::info!(
            "movement: resolved motion request state={:?} at tick {:?} (last_server_motion_intent={:?})",
            state,
            now,
            self.last_server_motion_intent,
        );

        let had_active_local_motion = self.local_motion.is_some();
        let state_events = self.apply_motion_state(state, world);

        if self.should_send_motion_state_pulse(state, metadata.motion_style) {
            log::info!("movement: sending resolved motion pulse state={:?}", state);
            Self::send_motion_state_pulse(world, session, state, metadata).await?;
            self.note_server_motion_sent(server_motion_intent(state, metadata.motion_style));
        }

        if had_active_local_motion && self.local_motion.is_none() && self.should_send_stop_pulse() {
            Self::send_stop_pulse(world, session, metadata).await?;
            self.note_server_motion_cleared();
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
        let mut world_events = world.set_local_player_runtime_pose(next_pos);

        if self.local_motion.is_some() {
            world_events.extend(self.sync_local_motion_vectors(world));
        }

        Self::send_autonomous_position_sync(world, session, metadata).await?;

        Ok(world_events)
    }

    fn apply_motion_state(
        &mut self,
        state: MotionState,
        world: &mut WorldState,
    ) -> Vec<WorldEvent> {
        self.local_motion = Some(state);
        self.sync_local_motion_vectors(world)
    }

    fn apply_motion_state_stop(&mut self, world: &mut WorldState) -> Vec<WorldEvent> {
        self.local_motion = None;
        world.set_local_player_runtime_vectors(Vector3::zero(), Vector3::zero())
    }

    fn sync_local_motion_vectors(&self, world: &mut WorldState) -> Vec<WorldEvent> {
        let Some(state) = self.local_motion else {
            return world.set_local_player_runtime_vectors(Vector3::zero(), Vector3::zero());
        };

        let Some(current_pose) = world.local_player_runtime_pose() else {
            return Vec::new();
        };
        let current_heading = current_pose.rotation.to_heading();
        let velocity = local_velocity_for_state(current_heading, state);
        let omega = local_omega_for_state(state);

        world.set_local_player_runtime_vectors(velocity, omega)
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

    pub(super) async fn send_autonomous_position_sync(
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
            position: world.local_player_runtime_pose().unwrap_or(world.player.position),
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
            position: world.local_player_runtime_pose().unwrap_or(world.player.position),
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
    fn current_local_intent_returns_none_without_guid_or_motion() {
        let world = WorldState::synthetic();
        let movement = MovementSystem::new();

        assert_eq!(movement.current_local_intent(&world), None);
    }

    #[test]
    fn current_local_intent_ignores_snap_only_state() {
        let mut world = WorldState::synthetic();
        world.player.guid = Guid(0x50000123);

        let mut movement = MovementSystem::new();
        movement.pending_snap_facing = Some(1.25);

        assert_eq!(movement.current_local_intent(&world), None);
    }

    #[test]
    fn handle_post_solve_is_currently_a_noop_for_local_player() {
        let mut world = WorldState::synthetic();
        let mut movement = MovementSystem::new();
        let guid = Guid(0x5000_0001);

        world.player.guid = guid;

        let events = movement.handle_post_solve(
            &world,
            &SolvedBodyKinematics {
                body_id: SpatialBodyId::LocalPlayer(guid),
                pose: world.player.position,
                velocity: Vector3::zero(),
                omega: Vector3::zero(),
                contact: holtburger_world::ContactState::Unknown,
            },
        );

        assert!(events.is_empty());
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
        let events =
            movement.apply_motion_state(MotionState::builder().run().forward().build(), &mut world);

        let body = world
            .scene
            .body(SpatialBodyId::LocalPlayer(player_guid))
            .expect("local player runtime body should exist");
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, velocity, .. }
                if *guid == player_guid
                    && velocity.x.abs() < 1e-5
                    && (velocity.y - 18.0).abs() < 1e-5
                    && velocity.z.abs() < 1e-5
        )));
        assert!(body.velocity.x.abs() < 1e-5);
        assert!((body.velocity.y - 18.0).abs() < 1e-5);
    }

    #[test]
    fn duration_and_displacement_helpers_share_one_run_vocabulary() {
        let movement = MovementSystem::new();
        let state = MotionState::builder().run().forward().build();
        let distance = 9.0;

        let duration = movement.estimate_duration_for_distance(state, distance);
        let displacement = movement.estimate_displacement(state, duration);

        assert!((duration.as_secs_f32() - 0.5).abs() < 1e-5);
        assert!((displacement - distance).abs() < 1e-4);
    }

    #[test]
    fn turn_only_motion_has_zero_displacement_and_duration_helpers() {
        let movement = MovementSystem::new();
        let state = MotionState::builder().walk().turn_left().build();

        assert_eq!(
            movement.estimate_duration_for_distance(state, 5.0),
            Duration::ZERO
        );
        assert_eq!(
            movement.estimate_displacement(state, Duration::from_secs(1)),
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
        movement.apply_motion_state(
            MotionState::builder().run().forward().turn_right().build(),
            &mut world,
        );
        let events = movement.apply_motion_state_stop(&mut world);

        let player = world
            .scene
            .body(SpatialBodyId::LocalPlayer(player_guid))
            .expect("local player runtime body should exist");
        assert!(
            events.is_empty()
                || events.iter().any(|event| matches!(
                    event,
                    WorldEvent::EntityVectorUpdated { guid, .. } if *guid == player_guid
                ))
        );
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
        let events = movement.apply_motion_state(
            MotionState::builder().walk().turn_left().build(),
            &mut world,
        );

        let body = world
            .scene
            .body(SpatialBodyId::LocalPlayer(player_guid))
            .expect("local player runtime body should exist");
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityVectorUpdated { guid, velocity, omega }
                if *guid == player_guid
                    && velocity.length_squared() <= 1e-6
                    && omega.z.abs() > 1e-6
        )));
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
            .execute_stop_at(&mut world, &mut session, MovementPacketMetadata::default())
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
            .execute_stop_at(&mut world, &mut session, MovementPacketMetadata::default())
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

        movement.enqueue_command(
            MovementCommand::SetMotion {
                state: MotionState::builder().run().forward().build(),
            },
            start,
        );

        movement
            .tick(start, &mut world, &mut session)
            .await
            .expect("held run input should start moving");

        let player = world
            .scene
            .body(SpatialBodyId::LocalPlayer(guid))
            .expect("local player runtime body should exist");
        assert!(player.velocity.x.abs() < 1e-5);
        assert!((player.velocity.y - 18.0).abs() < 1e-5);
        assert_eq!(session.packet_sequence, 2);

        movement
            .tick(start + Duration::from_millis(30), &mut world, &mut session)
            .await
            .expect("steady held run should not resend unchanged motion intent");

        let player = world
            .scene
            .body(SpatialBodyId::LocalPlayer(guid))
            .expect("local player runtime body should exist");
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

        movement.enqueue_command(
            MovementCommand::PulseMotion {
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

        movement.enqueue_command(
            MovementCommand::SetMotion {
                state: MotionState::builder().run().forward().build(),
            },
            start,
        );
        movement
            .tick(start, &mut world, &mut session)
            .await
            .expect("held run should start");

        movement.enqueue_command(MovementCommand::Stop, start + Duration::from_millis(30));
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
