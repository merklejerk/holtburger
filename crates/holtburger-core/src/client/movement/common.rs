use crate::client::movement_types::{
    CharacterDrive, Gait, LateralMotion, LongitudinalMotion, MotionStyle, MovementPacketMetadata,
    Turn,
};
use holtburger_common::Guid;
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::{RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::*;
use holtburger_world::WorldState;
use holtburger_world::context::WorldContextExt;
use std::f32::consts::{PI, TAU};
use std::time::Duration;

// ACE's movement packets carry a run-rate / speed scalar, not a standalone
// "already world-space" speed constant divorced from animation. In the retail
// math that scalar is applied against the run animation base speed, and after
// the engine's unit conversion it ends up numerically matching our meters/sec
// representation. That coincidence is useful, but it is also the trap: this
// value is the *maximum* run speed for a fully capped player, not the speed
// every character should emit or simulate.
const FALLBACK_RUN_RATE_SCALAR: f32 = 4.5;
pub(super) const AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
pub(super) const WALK_FORWARD_MOTION_COMMAND: u32 = 0x4500_0005;
const WALK_BACKWARD_MOTION_COMMAND: u32 = 0x4500_0006;
pub(super) const TURN_RIGHT_MOTION_COMMAND: u32 = 0x6500_000d;
pub(super) const TURN_LEFT_MOTION_COMMAND: u32 = 0x6500_000e;
const SIDESTEP_RIGHT_MOTION_COMMAND: u32 = 0x6500_000f;
const SIDESTEP_LEFT_MOTION_COMMAND: u32 = 0x6500_0010;
/// Retail animation-rate multiplier applied to turn commands while Run is held.
pub(super) const RUN_HELD_TURN_RATE_SCALAR: f32 = 1.5;
/// Retail animation-rate multiplier applied to turn commands without Run held.
const NON_RUN_HELD_TURN_RATE_SCALAR: f32 = 1.0;

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
        .or_else(|| {
            world
                .runtime_body_view(holtburger_world::SpatialBodyId::LocalPlayer(
                    world.player.guid,
                ))
                .and_then(|body| body.contact.contact())
        })
        .or(world.player.last_server_contact)
        .unwrap_or(true)
}

pub(super) fn encode_contact_long_jump(world: &WorldState, metadata: MovementPacketMetadata) -> u8 {
    u8::from(resolve_contact(world, metadata))
}

fn encode_last_contact(world: &WorldState, metadata: MovementPacketMetadata) -> u8 {
    u8::from(resolve_contact(world, metadata))
}

pub(super) fn has_autonomous_position_sync_target(world: &WorldState) -> bool {
    let Some(position) = world.local_player_runtime_pose() else {
        return false;
    };

    world.player.guid != Guid::NULL && position.landblock_id != Guid::NULL
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

fn hold_key_for_motion_state(state: CharacterDrive) -> HoldKey {
    match state.gait {
        Gait::Run => HoldKey::Run,
        Gait::Walk => HoldKey::None,
    }
}

pub(super) fn player_run_rate_scalar(world: &WorldState) -> f32 {
    world.player_run_rate().unwrap_or(FALLBACK_RUN_RATE_SCALAR)
}

fn longitudinal_command_for_state(
    longitudinal: LongitudinalMotion,
    gait: Gait,
    run_rate_scalar: f32,
) -> (u32, f32) {
    match (gait, longitudinal) {
        (Gait::Run, LongitudinalMotion::Forward) => (WALK_FORWARD_MOTION_COMMAND, run_rate_scalar),
        (Gait::Walk, LongitudinalMotion::Forward) => (WALK_FORWARD_MOTION_COMMAND, 1.0),
        (_, LongitudinalMotion::Backward) => (WALK_BACKWARD_MOTION_COMMAND, 1.0),
    }
}

fn lateral_command_for_state(lateral: LateralMotion) -> u32 {
    match lateral {
        LateralMotion::Left => SIDESTEP_LEFT_MOTION_COMMAND,
        LateralMotion::Right => SIDESTEP_RIGHT_MOTION_COMMAND,
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
    state: CharacterDrive,
    motion_style: MotionStyle,
) -> RawMotionState {
    let run_rate_scalar = player_run_rate_scalar(world);
    let axis_hold_key = hold_key_for_motion_state(state) as u32;
    let mut raw_motion_state = RawMotionState {
        flags: RawMotionFlags::CURRENT_HOLD_KEY,
        current_hold_key: Some(axis_hold_key),
        ..Default::default()
    };

    if let Some(longitudinal) = state.longitudinal {
        let (command, speed) =
            longitudinal_command_for_state(longitudinal, state.gait, run_rate_scalar);
        raw_motion_state.flags |= RawMotionFlags::FORWARD_COMMAND
            | RawMotionFlags::FORWARD_HOLD_KEY
            | RawMotionFlags::FORWARD_SPEED;
        raw_motion_state.forward_command = Some(command);
        raw_motion_state.forward_hold_key = Some(axis_hold_key);
        raw_motion_state.forward_speed = Some(speed);
    }

    if let Some(lateral) = state.lateral {
        raw_motion_state.flags |= RawMotionFlags::SIDE_STEP_COMMAND
            | RawMotionFlags::SIDE_STEP_HOLD_KEY
            | RawMotionFlags::SIDE_STEP_SPEED;
        raw_motion_state.sidestep_command = Some(lateral_command_for_state(lateral));
        raw_motion_state.sidestep_hold_key = Some(axis_hold_key);
        raw_motion_state.sidestep_speed = Some(1.0);
    }

    if let Some(turn) = state.turning {
        raw_motion_state.flags |= RawMotionFlags::TURN_COMMAND | RawMotionFlags::TURN_HOLD_KEY;
        raw_motion_state.turn_command = Some(turn_motion_command_for_state(turn));
        raw_motion_state.turn_hold_key = Some(axis_hold_key);
        let raw_turn_rate = raw_turn_rate_scalar_for_state(state);
        // Retail packs speed only when it differs bitwise from the raw default 1.0
        // (`RawMotionState::Pack`, `acclient.c:319879-320015`). Omitting the default also lets ACE's
        // raw-to-interpreted broadcast path derive the Run-held 1.5 rate instead of overriding it.
        if raw_turn_rate != 1.0 {
            raw_motion_state.flags |= RawMotionFlags::TURN_SPEED;
            raw_motion_state.turn_speed = Some(raw_turn_rate);
        }
    }

    raw_motion_state_with_motion_style(world, raw_motion_state, motion_style)
}

pub(super) fn turn_rate_scalar_for_state(state: CharacterDrive) -> f32 {
    state.turn_rate_scalar.unwrap_or(match state.gait {
        Gait::Run => RUN_HELD_TURN_RATE_SCALAR,
        Gait::Walk => NON_RUN_HELD_TURN_RATE_SCALAR,
    })
}

/// Encodes the pre-hold-key turn rate carried by retail's `RawMotionState`.
///
/// `CMotionInterp::apply_raw_movement` applies the axis hold key after unpacking, and
/// `apply_run_to_command` multiplies a Run-held turn by 1.5 (`acclient.c:329739-330067`). Sending
/// the already-adjusted playback rate would therefore apply the Run multiplier twice.
fn raw_turn_rate_scalar_for_state(state: CharacterDrive) -> f32 {
    let hold_key_multiplier = match state.gait {
        Gait::Run => RUN_HELD_TURN_RATE_SCALAR,
        Gait::Walk => NON_RUN_HELD_TURN_RATE_SCALAR,
    };
    turn_rate_scalar_for_state(state) / hold_key_multiplier
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_motion_state_encodes_longitudinal_and_lateral_axes_together() {
        let world = WorldState::synthetic();
        let raw = build_motion_state_raw_motion_state(
            &world,
            CharacterDrive::builder()
                .walk()
                .forward()
                .strafe_left()
                .build(),
            MotionStyle::Omit,
        );

        assert!(raw.flags.contains(RawMotionFlags::FORWARD_COMMAND));
        assert!(raw.flags.contains(RawMotionFlags::SIDE_STEP_COMMAND));
        assert_eq!(raw.forward_command, Some(WALK_FORWARD_MOTION_COMMAND));
        assert_eq!(raw.sidestep_command, Some(SIDESTEP_LEFT_MOTION_COMMAND));
    }
}
