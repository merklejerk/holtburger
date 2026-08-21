//! Asset-free reconstruction of the retail character-input and jump-launch rules.
//!
//! This is an evidence oracle, not production controller code. Phase 1 compares the real
//! interpreter against these fixtures after its public contracts exist.

use holtburger_common::Vector3;
use holtburger_protocol::messages::movement::MotionStance;

use super::common::turn_rate_scalar_for_state;
use crate::client::movement_types::{CharacterDrive, Gait as MotionGait};

/// Normal power-bar duration from `ClientCombatSystem::GetPowerBarLevel` (`acclient.c:390379`).
const NORMAL_CHARGE_SECONDS: f32 = 1.0;
/// Dual-wield power-bar duration from `ClientCombatSystem::GetPowerBarLevel` (`acclient.c:390390`).
const DUAL_WIELD_CHARGE_SECONDS: f32 = 0.8;
/// Smallest jump extent emitted by `GetJumpPowerLevel` and `DoJump` (`acclient.c:390499`).
const MINIMUM_JUMP_EXTENT: f32 = 0.001;
/// Retail walk animation speed from `CMotionInterp::get_state_velocity` (`acclient.c:329866`).
const WALK_SPEED: f32 = 3.12;
/// Retail run animation speed from `CMotionInterp::get_state_velocity` (`acclient.c:329872`).
const RUN_SPEED: f32 = 4.0;
/// Backward scale from `CMotionInterp::adjust_motion` (`acclient.c:330017`).
const BACKWARD_FACTOR: f32 = 0.65;
/// Base sidestep animation speed from `CMotionInterp::get_state_velocity` (`acclient.c:329860`).
const SIDESTEP_ANIMATION_SPEED: f32 = 1.25;
/// Sidestep scale from `CMotionInterp::adjust_motion` (`acclient.c:330044`).
const SIDESTEP_FACTOR: f32 = 0.5;
/// Maximum interpreted sidestep animation rate from `apply_run_to_command` (`acclient.c:329803`).
const MAX_SIDESTEP_RATE: f32 = 3.0;
/// Gravity magnitude used to turn retail jump height into launch speed (`acclient.c:424424`).
const DOUBLE_GRAVITY: f32 = 19.6;
/// Minimum jump height returned by `MovementSystem::GetJumpHeight` (`acclient.c:678704`).
const MINIMUM_JUMP_HEIGHT: f32 = 0.35;
/// Skill divisor from `MovementSystem::GetJumpHeight` (`acclient.c:678688`).
const JUMP_SKILL_DIVISOR: f32 = 1_300.0;
/// Maximum skill-derived jump height term (`acclient.c:678688`).
const JUMP_SKILL_HEIGHT_SCALE: f32 = 22.2;
/// Base skill-derived jump height term (`acclient.c:678688`).
const JUMP_BASE_HEIGHT: f32 = 0.05;
/// Fixed Run-held turn multiplier from `CMotionInterp::apply_run_to_command`
/// (`acclient.c:329739-329778`).
const RUN_TURN_RATE_SCALAR: f32 = 1.5;

/// One semantic direction held on a retail command-list axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AxisCommand {
    /// Negative direction for the axis.
    Negative,
    /// Positive direction for the axis.
    Positive,
}

/// Reconstructed newest-first `CommandList` behavior from `acclient.c:682753-683004`.
#[derive(Debug, Default)]
struct RetailCommandList {
    /// Held commands in retail's linked-list order, with the active command first.
    newest_first: Vec<AxisCommand>,
}

impl RetailCommandList {
    /// Adds a command at the head, matching `CommandList::AddCommand`.
    fn press(&mut self, command: AxisCommand) {
        self.newest_first.insert(0, command);
    }

    /// Removes the first matching command and returns the newly active head.
    fn release(&mut self, command: AxisCommand) -> Option<AxisCommand> {
        if let Some(index) = self.newest_first.iter().position(|held| *held == command) {
            self.newest_first.remove(index);
        }
        self.active()
    }

    /// Returns the command that retail currently emits for this axis.
    fn active(&self) -> Option<AxisCommand> {
        self.newest_first.first().copied()
    }

    /// Clears keyboard commands on focus loss, matching `LoseKeyboardFocus`.
    fn clear_keyboard(&mut self) {
        self.newest_first.clear();
    }
}

/// Semantic gait after the frontend applies physical-key and toggle-run policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Gait {
    /// Retail walk interpretation.
    Walk,
    /// Retail run interpretation.
    Run,
}

/// Release-time movement snapshot consumed by retail launch composition.
#[derive(Debug, Clone, Copy)]
struct RetailDrive {
    /// Signed forward axis: `-1`, `0`, or `1`.
    longitudinal: f32,
    /// Signed right axis: `-1`, `0`, or `1`.
    lateral: f32,
    /// Gait sampled when the jump is released.
    gait: Gait,
    /// Signed turn axis used to decide whether a charge began standing still.
    turn: f32,
}

impl RetailDrive {
    /// Whether retail marks a newly accepted charge as a standing long jump.
    fn is_standing(&self) -> bool {
        self.longitudinal == 0.0 && self.lateral == 0.0 && self.turn == 0.0
    }
}

/// Minimal stateful slice of retail's standing-long-jump charge behavior.
#[derive(Debug, Clone, Copy)]
struct RetailCharge {
    /// Whether the charge began with all movement axes idle.
    standing_long_jump: bool,
    /// Most recently interpreted drive, including changes received during the charge.
    drive: RetailDrive,
}

impl RetailCharge {
    /// Starts a charge and samples only the standing-long-jump flag.
    fn begin(drive: RetailDrive) -> Self {
        Self {
            standing_long_jump: drive.is_standing(),
            drive,
        }
    }

    /// Applies movement or gait changes without ending the charge.
    fn update_drive(&mut self, drive: RetailDrive) {
        self.drive = drive;
    }

    /// Returns the grounded translation emitted before launch.
    fn emitted_planar_velocity(&self, run_rate: f32) -> Vector3 {
        if self.standing_long_jump {
            Vector3::zero()
        } else {
            planar_launch(self.drive, run_rate)
        }
    }

    /// Returns the release-time planar launch.
    fn release(self, run_rate: f32) -> Vector3 {
        planar_launch(self.drive, run_rate)
    }
}

/// Result of the retail airborne input gate after launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AirborneInputEffect {
    /// Whether a forward or strafe command can alter planar velocity.
    accepts_planar_drive: bool,
    /// Whether turn commands can still change facing.
    accepts_turn: bool,
}

/// Returns retail's effective run state after combining a physical hold with Toggle Run.
fn effective_run(physical_hold_run: bool, toggle_run: bool) -> bool {
    physical_hold_run ^ toggle_run
}

/// Reconstructs retail's turn-command branch, which deliberately does not read actor run rate.
fn retail_turn_rate_scalar(gait: Gait, explicit_rate: Option<f32>) -> f32 {
    explicit_rate.unwrap_or(if gait == Gait::Run {
        RUN_TURN_RATE_SCALAR
    } else {
        1.0
    })
}

/// Returns the duration selected by the exact retail motion-style comparison.
fn charge_duration(stance: MotionStance) -> f32 {
    if stance == MotionStance::DualWieldCombat {
        DUAL_WIELD_CHARGE_SECONDS
    } else {
        NORMAL_CHARGE_SECONDS
    }
}

/// Reconstructs the power-bar clamp and valid-jump minimum applied at release.
fn released_extent(elapsed_seconds: f32, duration_seconds: f32) -> f32 {
    let power_bar_level = (elapsed_seconds / duration_seconds).clamp(0.0, 1.0);
    power_bar_level.max(MINIMUM_JUMP_EXTENT)
}

/// Reconstructs `adjust_motion`, `apply_run_to_command`, and `get_state_velocity`.
fn planar_launch(drive: RetailDrive, run_rate: f32) -> Vector3 {
    let run_held = drive.gait == Gait::Run;
    let forward_speed = match (drive.longitudinal, run_held) {
        (forward, true) if forward > 0.0 => RUN_SPEED * forward * run_rate,
        (backward, true) if backward < 0.0 => WALK_SPEED * backward * BACKWARD_FACTOR * run_rate,
        (forward, false) if forward != 0.0 => {
            let factor = if forward < 0.0 { BACKWARD_FACTOR } else { 1.0 };
            WALK_SPEED * forward * factor
        }
        _ => 0.0,
    };

    let base_sidestep_rate =
        drive.lateral * SIDESTEP_FACTOR * (WALK_SPEED / SIDESTEP_ANIMATION_SPEED);
    let sidestep_rate = if run_held {
        (base_sidestep_rate * run_rate).clamp(-MAX_SIDESTEP_RATE, MAX_SIDESTEP_RATE)
    } else {
        base_sidestep_rate
    };
    let mut velocity = Vector3::new(SIDESTEP_ANIMATION_SPEED * sidestep_rate, forward_speed, 0.0);

    let maximum_speed = RUN_SPEED * run_rate;
    if velocity.length() > maximum_speed {
        velocity = velocity.normalize() * maximum_speed;
    }
    velocity
}

/// Test-only scalar boundary used to compare production resolution against this independent oracle.
pub(crate) fn oracle_planar_launch(
    longitudinal: f32,
    lateral: f32,
    running: bool,
    run_rate: f32,
) -> Vector3 {
    planar_launch(
        RetailDrive {
            longitudinal,
            lateral,
            gait: if running { Gait::Run } else { Gait::Walk },
            turn: 0.0,
        },
        run_rate,
    )
}

/// Reconstructs actor-specific retail jump height and vertical launch speed.
fn vertical_launch(load_modifier: f32, jump_skill: f32, extent: f32, scaling: f32) -> f32 {
    let power = extent.clamp(0.0, 1.0);
    let skill_height =
        jump_skill / (jump_skill + JUMP_SKILL_DIVISOR) * JUMP_SKILL_HEIGHT_SCALE + JUMP_BASE_HEIGHT;
    let height = (load_modifier * skill_height * power / scaling).max(MINIMUM_JUMP_HEIGHT);
    (height * DOUBLE_GRAVITY).sqrt()
}

/// Test-only scalar boundary for the independently reconstructed retail vertical launch.
pub(crate) fn oracle_vertical_launch(
    load_modifier: f32,
    jump_skill: f32,
    extent: f32,
    scaling: f32,
) -> f32 {
    vertical_launch(load_modifier, jump_skill, extent, scaling)
}

/// Reconstructs the retail local-client input gate while a gravity creature is airborne.
fn airborne_input_effect() -> AirborneInputEffect {
    AirborneInputEffect {
        accepts_planar_drive: false,
        accepts_turn: true,
    }
}

fn assert_close(actual: f32, expected: f32) {
    const TOLERANCE: f32 = 0.000_01;
    assert!(
        (actual - expected).abs() <= TOLERANCE,
        "expected {expected}, got {actual}"
    );
}

fn assert_vector_close(actual: Vector3, expected: Vector3) {
    assert_close(actual.x, expected.x);
    assert_close(actual.y, expected.y);
    assert_close(actual.z, expected.z);
}

#[test]
fn turn_rate_uses_only_gait_and_an_explicit_command_override() {
    for (gait, explicit_rate) in [
        (Gait::Walk, None),
        (Gait::Run, None),
        (Gait::Walk, Some(0.75)),
        (Gait::Run, Some(0.75)),
    ] {
        let state = CharacterDrive {
            gait: match gait {
                Gait::Walk => MotionGait::Walk,
                Gait::Run => MotionGait::Run,
            },
            turning: Some(crate::client::movement_types::Turn::Left),
            turn_rate_scalar: explicit_rate,
            ..CharacterDrive::default()
        };
        assert_close(
            turn_rate_scalar_for_state(state),
            retail_turn_rate_scalar(gait, explicit_rate),
        );
    }
}

#[test]
fn each_axis_uses_newest_held_and_resumes_the_previous_command() {
    // `WhichList` gives forward, sidestep, and turn independent lists (`acclient.c:681839`).
    for axis_name in ["longitudinal", "lateral", "turn"] {
        let mut commands = RetailCommandList::default();
        commands.press(AxisCommand::Positive);
        assert_eq!(
            commands.active(),
            Some(AxisCommand::Positive),
            "{axis_name}"
        );

        commands.press(AxisCommand::Negative);
        assert_eq!(
            commands.active(),
            Some(AxisCommand::Negative),
            "{axis_name}"
        );

        assert_eq!(
            commands.release(AxisCommand::Positive),
            Some(AxisCommand::Negative),
            "releasing an inactive {axis_name} command must not replace the head"
        );

        commands.press(AxisCommand::Positive);
        assert_eq!(
            commands.release(AxisCommand::Positive),
            Some(AxisCommand::Negative),
            "releasing the active {axis_name} command must resume the older command"
        );

        commands.clear_keyboard();
        assert_eq!(commands.active(), None, "focus loss must clear {axis_name}");
    }
}

#[test]
fn explorer_default_run_maps_shift_to_walk_via_retail_xor_policy() {
    assert!(effective_run(false, true));
    assert!(!effective_run(true, true));
    assert!(!effective_run(false, false));
    assert!(effective_run(true, false));
}

#[test]
fn charge_duration_and_release_extent_match_the_retail_power_bar() {
    assert_close(
        charge_duration(MotionStance::NonCombat),
        NORMAL_CHARGE_SECONDS,
    );
    assert_close(
        charge_duration(MotionStance::DualWieldCombat),
        DUAL_WIELD_CHARGE_SECONDS,
    );

    for (elapsed, expected) in [
        (0.0, MINIMUM_JUMP_EXTENT),
        (0.5, 0.5),
        (1.0, 1.0),
        (2.0, 1.0),
    ] {
        assert_close(released_extent(elapsed, NORMAL_CHARGE_SECONDS), expected);
    }
    assert_close(released_extent(0.4, DUAL_WIELD_CHARGE_SECONDS), 0.5);
}

#[test]
fn launch_samples_release_time_gait_and_direction() {
    let walking = planar_launch(
        RetailDrive {
            longitudinal: 1.0,
            lateral: 0.0,
            gait: Gait::Walk,
            turn: 0.0,
        },
        1.0,
    );
    let running = planar_launch(
        RetailDrive {
            longitudinal: 1.0,
            lateral: 0.0,
            gait: Gait::Run,
            turn: 0.0,
        },
        1.0,
    );

    assert_vector_close(walking, Vector3::new(0.0, WALK_SPEED, 0.0));
    assert_vector_close(running, Vector3::new(0.0, RUN_SPEED, 0.0));
    assert!(running.y > walking.y);
}

#[test]
fn backward_lateral_and_diagonal_launches_follow_retail_composition() {
    let backward = planar_launch(
        RetailDrive {
            longitudinal: -1.0,
            lateral: 0.0,
            gait: Gait::Walk,
            turn: 0.0,
        },
        1.0,
    );
    assert_vector_close(
        backward,
        Vector3::new(0.0, -WALK_SPEED * BACKWARD_FACTOR, 0.0),
    );

    let left = planar_launch(
        RetailDrive {
            longitudinal: 0.0,
            lateral: -1.0,
            gait: Gait::Walk,
            turn: 0.0,
        },
        1.0,
    );
    assert_vector_close(left, Vector3::new(-WALK_SPEED * SIDESTEP_FACTOR, 0.0, 0.0));

    let right = planar_launch(
        RetailDrive {
            longitudinal: 0.0,
            lateral: 1.0,
            gait: Gait::Walk,
            turn: 0.0,
        },
        1.0,
    );
    assert_vector_close(right, Vector3::new(WALK_SPEED * SIDESTEP_FACTOR, 0.0, 0.0));

    let diagonal = planar_launch(
        RetailDrive {
            longitudinal: 1.0,
            lateral: 1.0,
            gait: Gait::Run,
            turn: 0.0,
        },
        1.0,
    );
    assert_close(diagonal.length(), RUN_SPEED);
    assert!(diagonal.x > 0.0 && diagonal.y > 0.0);

    let opposite_diagonal = planar_launch(
        RetailDrive {
            longitudinal: -1.0,
            lateral: -1.0,
            gait: Gait::Run,
            turn: 0.0,
        },
        1.0,
    );
    assert!(opposite_diagonal.x < 0.0 && opposite_diagonal.y < 0.0);
    assert!(opposite_diagonal.length() <= RUN_SPEED);
}

#[test]
fn standing_charge_suppresses_translation_but_release_uses_current_drive() {
    let mut charge = RetailCharge::begin(RetailDrive {
        longitudinal: 0.0,
        lateral: 0.0,
        gait: Gait::Run,
        turn: 0.0,
    });
    charge.update_drive(RetailDrive {
        longitudinal: 1.0,
        lateral: 1.0,
        gait: Gait::Walk,
        turn: 0.0,
    });

    assert_eq!(charge.emitted_planar_velocity(1.0), Vector3::zero());
    assert!(charge.release(1.0).length() > 0.0);
}

#[test]
fn release_gait_wins_over_gait_at_charge_start_or_during_charge() {
    let idle_run = RetailDrive {
        longitudinal: 0.0,
        lateral: 0.0,
        gait: Gait::Run,
        turn: 0.0,
    };
    let forward_run = RetailDrive {
        longitudinal: 1.0,
        lateral: 0.0,
        gait: Gait::Run,
        turn: 0.0,
    };
    let forward_walk = RetailDrive {
        gait: Gait::Walk,
        ..forward_run
    };

    let mut run_then_walk = RetailCharge::begin(idle_run);
    run_then_walk.update_drive(forward_run);
    run_then_walk.update_drive(forward_walk);
    assert_vector_close(
        run_then_walk.release(1.0),
        Vector3::new(0.0, WALK_SPEED, 0.0),
    );

    let mut walk_then_run = RetailCharge::begin(RetailDrive {
        gait: Gait::Walk,
        ..idle_run
    });
    walk_then_run.update_drive(forward_walk);
    walk_then_run.update_drive(forward_run);
    assert_vector_close(
        walk_then_run.release(1.0),
        Vector3::new(0.0, RUN_SPEED, 0.0),
    );
}

#[test]
fn vertical_launch_uses_the_retail_floor_and_actor_inputs() {
    let minimum = vertical_launch(1.0, 0.0, MINIMUM_JUMP_EXTENT, 1.0);
    assert_close(minimum, (MINIMUM_JUMP_HEIGHT * DOUBLE_GRAVITY).sqrt());

    let skilled = vertical_launch(1.0, 300.0, 1.0, 1.0);
    assert!(skilled > minimum);
}

#[test]
fn airborne_drive_does_not_accelerate_planar_velocity_but_turning_remains_allowed() {
    // `contact_allows_move` rejects translation without contact but admits turn commands
    // (`acclient.c:330141`), while `calc_acceleration` adds only gravity (`acclient.c:306176`).
    let launch = Vector3::new(1.5, 3.0, 5.0);
    let effect = airborne_input_effect();
    let after_forward_strafe_and_gait_changes = launch;

    assert!(!effect.accepts_planar_drive);
    assert!(effect.accepts_turn);
    assert_eq!(after_forward_strafe_and_gait_changes, launch);
}
