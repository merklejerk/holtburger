use crate::client::movement_types::{
    Gait, LateralMotion, LongitudinalMotion, MotionState, MotionStyle, MovementPacketMetadata,
    Turn, planar_velocity_for_heading,
};
use holtburger_common::{Guid, Vector3};
use holtburger_protocol::messages::game_action::*;
use holtburger_protocol::messages::game_message::{RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::*;
use holtburger_world::context::WorldContextExt;
use holtburger_world::{SelfMovementCapabilities, WorldState};
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
        .or(world.player.last_server_grounded)
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

fn hold_key_for_motion_state(state: MotionState) -> HoldKey {
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
    state: MotionState,
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
        raw_motion_state.flags |= RawMotionFlags::TURN_COMMAND
            | RawMotionFlags::TURN_HOLD_KEY
            | RawMotionFlags::TURN_SPEED;
        raw_motion_state.turn_command = Some(turn_motion_command_for_state(turn));
        raw_motion_state.turn_hold_key = Some(axis_hold_key);
        raw_motion_state.turn_speed = Some(turn_rate_scalar_for_state(state));
    }

    raw_motion_state_with_motion_style(world, raw_motion_state, motion_style)
}

fn local_longitudinal_speed_for_state(
    state: MotionState,
    capabilities: &SelfMovementCapabilities,
) -> f32 {
    match (state.gait, state.longitudinal) {
        (_, None) => 0.0,
        (Gait::Run, Some(LongitudinalMotion::Forward)) => capabilities.resolved_manual_run_speed(),
        (Gait::Walk, Some(LongitudinalMotion::Forward)) => capabilities.base_walk_forward_speed(),
        (_, Some(LongitudinalMotion::Backward)) => 1.0,
    }
}

pub(super) fn local_velocity_for_state(
    current_heading: f32,
    state: MotionState,
    capabilities: &SelfMovementCapabilities,
) -> Vector3 {
    let longitudinal = match state.longitudinal {
        Some(LongitudinalMotion::Forward) => planar_velocity_for_heading(
            current_heading,
            local_longitudinal_speed_for_state(state, capabilities),
        ),
        Some(LongitudinalMotion::Backward) => {
            planar_velocity_for_heading(normalize_heading(current_heading + PI), 1.0)
        }
        None => Vector3::zero(),
    };
    let lateral = match state.lateral {
        Some(LateralMotion::Left) => {
            planar_velocity_for_heading(normalize_heading(current_heading - (PI / 2.0)), 1.0)
        }
        Some(LateralMotion::Right) => {
            planar_velocity_for_heading(normalize_heading(current_heading + (PI / 2.0)), 1.0)
        }
        None => Vector3::zero(),
    };
    let combined = longitudinal + lateral;
    let maximum_speed = capabilities.resolved_manual_run_speed();
    if combined.length() > maximum_speed {
        combined.normalize() * maximum_speed
    } else {
        combined
    }
}

pub(super) fn turn_rate_scalar_for_state(state: MotionState) -> f32 {
    state.turn_rate_scalar.unwrap_or(match state.gait {
        Gait::Run => RUN_HELD_TURN_RATE_SCALAR,
        Gait::Walk => NON_RUN_HELD_TURN_RATE_SCALAR,
    })
}

fn local_turn_omega(base_omega: Vector3, turn_rate_scalar: f32) -> Vector3 {
    base_omega * turn_rate_scalar
}

pub(super) fn local_omega_for_state(
    state: MotionState,
    capabilities: &SelfMovementCapabilities,
) -> Vector3 {
    match state.turning {
        Some(Turn::Right) => local_turn_omega(
            capabilities.kinematics().base_turn_right_omega,
            turn_rate_scalar_for_state(state),
        ),
        Some(Turn::Left) => local_turn_omega(
            capabilities.kinematics().base_turn_left_omega,
            turn_rate_scalar_for_state(state),
        ),
        None => Vector3::zero(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::movement::MotionStance;
    use holtburger_world::{
        PlayerMotionTableSource, SelfMovementCapabilities, SelfMovementKinematics,
    };

    fn test_capabilities() -> SelfMovementCapabilities {
        SelfMovementCapabilities {
            kinematics: SelfMovementKinematics {
                source: PlayerMotionTableSource::DirectProperty {
                    motion_table_id: 0x0900_0020,
                },
                motion_table_id: 0x0900_0020,
                stance: MotionStance::NonCombat as u32,
                base_walk_forward_velocity: Vector3::new(1.0, 0.0, 0.0),
                base_run_forward_velocity: Vector3::new(2.0, 0.0, 0.0),
                base_turn_left_omega: Vector3::new(0.0, 0.0, -1.5),
                base_turn_right_omega: Vector3::new(0.0, 0.0, 1.5),
            },
            run_rate_scalar: 1.0,
        }
    }

    #[test]
    fn local_omega_for_run_multiplies_authored_omega_by_retail_rate() {
        let capabilities = test_capabilities();

        assert_eq!(
            local_omega_for_state(
                MotionState {
                    gait: Gait::Run,
                    longitudinal: None,
                    lateral: None,
                    turning: Some(Turn::Left),
                    turn_rate_scalar: None,
                },
                &capabilities,
            ),
            Vector3::new(0.0, 0.0, -2.25)
        );
    }

    #[test]
    fn local_omega_for_state_applies_turn_rate_override_to_authored_omega() {
        let capabilities = test_capabilities();

        assert_eq!(
            local_omega_for_state(
                MotionState {
                    gait: Gait::Walk,
                    longitudinal: None,
                    lateral: None,
                    turning: Some(Turn::Left),
                    turn_rate_scalar: Some(0.75),
                },
                &capabilities,
            ),
            Vector3::new(0.0, 0.0, -1.125)
        );
    }

    #[test]
    fn raw_motion_state_encodes_longitudinal_and_lateral_axes_together() {
        let world = WorldState::synthetic();
        let raw = build_motion_state_raw_motion_state(
            &world,
            MotionState::builder()
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

    #[test]
    fn local_velocity_composes_longitudinal_and_lateral_axes() {
        let velocity = local_velocity_for_state(
            0.0,
            MotionState::builder()
                .walk()
                .forward()
                .strafe_left()
                .build(),
            &test_capabilities(),
        );

        assert!((velocity.x + 1.0).abs() < 1e-5);
        assert!((velocity.y + 1.0).abs() < 1e-5);
        assert_eq!(velocity.z, 0.0);
    }
}
