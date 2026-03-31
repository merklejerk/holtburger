use crate::client::movement_types::{
    Gait, Locomotion, MotionState, MotionStyle, MovementPacketMetadata, Turn,
    planar_velocity_for_heading,
};
use holtburger_common::{Guid, Vector3};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::{RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::*;
use holtburger_world::context::WorldContextExt;
use holtburger_world::WorldState;
use std::f32::consts::{PI, TAU};
use std::time::Duration;

// ACE's movement packets carry a run-rate / speed scalar, not a standalone
// "already world-space" speed constant divorced from animation. In the retail
// math that scalar is applied against the run animation base speed, and after
// the engine's unit conversion it ends up numerically matching our meters/sec
// representation. That coincidence is useful, but it is also the trap: this
// value is the *maximum* run speed for a fully capped player, not the speed
// every character should emit or simulate.
const SERVER_RUN_SPEED: f32 = 4.5;
pub(super) const AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
pub(super) const WALK_FORWARD_MOTION_COMMAND: u32 = 0x4500_0005;
const WALK_BACKWARD_MOTION_COMMAND: u32 = 0x4500_0006;
pub(super) const TURN_RIGHT_MOTION_COMMAND: u32 = 0x6500_000d;
pub(super) const TURN_LEFT_MOTION_COMMAND: u32 = 0x6500_000e;
const SIDESTEP_RIGHT_MOTION_COMMAND: u32 = 0x6500_000f;
const SIDESTEP_LEFT_MOTION_COMMAND: u32 = 0x6500_0010;
pub(super) const RUN_HELD_TURN_SPEED_RAD_PER_SEC: f32 = 1.5;
const NON_RUN_HELD_TURN_SPEED_RAD_PER_SEC: f32 = 1.0;

pub(super) fn signed_heading_delta(current_heading: f32, desired_heading: f32) -> f32 {
    let mut delta = (desired_heading - current_heading) % TAU;
    if delta <= -PI {
        delta += TAU;
    } else if delta > PI {
        delta -= TAU;
    }
    delta
}

pub(super) fn normalize_heading(heading: f32) -> f32 {
    heading.rem_euclid(TAU)
}

pub(super) fn raw_motion_state_with_motion_style(
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

pub(super) fn encode_contact_long_jump(world: &WorldState, metadata: MovementPacketMetadata) -> u8 {
    u8::from(resolve_contact(world, metadata))
}

fn encode_last_contact(world: &WorldState, metadata: MovementPacketMetadata) -> u8 {
    u8::from(resolve_contact(world, metadata))
}

pub(super) fn has_active_autonomous_position_motion(world: &WorldState) -> bool {
    let Some((_, velocity, omega)) = world.local_player_runtime_kinematics() else {
        return false;
    };

    velocity.length_squared() >= 0.0001 || omega.length_squared() >= 0.0001
}

pub(super) fn build_autonomous_position(
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

pub(super) fn player_run_speed_mps(world: &WorldState) -> f32 {
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

pub(super) fn build_motion_state_raw_motion_state(
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

fn locomotion_speed_for_state(state: MotionState, run_speed_mps: f32) -> f32 {
    match (state.gait, state.locomotion) {
        (_, None) => 0.0,
        (Gait::Run, Some(Locomotion::Forward)) => run_speed_mps,
        (Gait::Walk, Some(Locomotion::Forward)) => 1.0,
        (_, Some(Locomotion::Backstep | Locomotion::StrafeLeft | Locomotion::StrafeRight)) => 1.0,
    }
}

pub(super) fn local_velocity_for_state(current_heading: f32, state: MotionState, run_speed_mps: f32) -> Vector3 {
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

pub(super) fn local_omega_for_state(state: MotionState) -> Vector3 {
    let turn_speed = turn_speed_for_state(state);

    match state.turning {
        Some(Turn::Right) => Vector3::new(0.0, 0.0, turn_speed),
        Some(Turn::Left) => Vector3::new(0.0, 0.0, -turn_speed),
        None => Vector3::zero(),
    }
}