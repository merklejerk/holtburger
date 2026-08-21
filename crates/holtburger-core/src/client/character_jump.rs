//! Actor-neutral conversion from interpreted jump intent to resolved launch kinematics.

use super::character_kinematics::{CharacterJumpKinematics, CharacterMovementKinematics};
use super::character_motion::{JumpAttempt, JumpChargeProfile, JumpExtent};
use super::movement_types::{CharacterDrive, Gait, LateralMotion, LongitudinalMotion};
use holtburger_common::Vector3;
use holtburger_protocol::messages::movement::MotionStance;
use thiserror::Error;

/// Retail backward scaling from `CMotionInterp::adjust_motion` (`acclient.c:330017`).
const RETAIL_BACKWARD_FACTOR: f32 = 0.65;
/// Retail sidestep scaling from `CMotionInterp::adjust_motion` (`acclient.c:330044`).
const RETAIL_SIDESTEP_FACTOR: f32 = 0.5;
/// Retail sidestep animation speed from `CMotionInterp::get_state_velocity`
/// (`acclient.c:329860`).
const RETAIL_SIDESTEP_ANIMATION_SPEED: f32 = 1.25;
/// Retail cap applied to the interpreted sidestep animation rate (`acclient.c:329803`).
const RETAIL_MAXIMUM_SIDESTEP_RATE: f32 = 3.0;
/// Retail's minimum resolved jump height (`MovementSystem::GetJumpHeight`,
/// `acclient.c:678688-678707`).
const RETAIL_MINIMUM_JUMP_HEIGHT: f32 = 0.35;
/// Twice retail gravity magnitude, used to convert jump height to launch speed.
const RETAIL_DOUBLE_GRAVITY: f32 = 19.6;

/// Selects the retail charge duration from an already resolved motion style.
pub const fn retail_jump_charge_profile(motion_style: MotionStance) -> JumpChargeProfile {
    if matches!(motion_style, MotionStance::DualWieldCombat) {
        JumpChargeProfile::RETAIL_DUAL_WIELD
    } else {
        JumpChargeProfile::RETAIL_STANDARD
    }
}

/// Body-owned readiness sampled when a jump attempt is resolved.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharacterJumpReadiness {
    /// Current walkable support permits launch.
    Supported,
    /// Collision has classified the body as airborne.
    Airborne,
    /// The body has contact but no walkable launch support.
    Unsupported,
    /// Current collision constraints prohibit leaving the pose.
    Constrained,
}

/// Why an interpreted attempt could not become resolved launch kinematics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum CharacterJumpRejection {
    #[error("an airborne body cannot jump")]
    Airborne,
    #[error("jump requires current walkable support")]
    Unsupported,
    #[error("a fully constrained body cannot jump")]
    Constrained,
    #[error("character heading must be finite")]
    InvalidHeading,
}

/// Invalid release-time orientation for continuous or launch motion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum CharacterDriveResolutionError {
    #[error("character heading must be finite")]
    InvalidHeading,
}

/// One computed launch shared by local physics and the later player packet bridge.
#[derive(Debug, PartialEq)]
pub struct ResolvedJump {
    /// Original validated power request sent on the player wire path later.
    extent: JumpExtent,
    /// Retail standing-long-jump flag sampled by the interpreter at charge start.
    standing_long_jump: bool,
    /// Retail body-local launch: X sidestep, Y forward, Z upward.
    local_velocity: Vector3,
    /// The same launch transformed once through the release-time world heading.
    world_velocity: Vector3,
}

impl ResolvedJump {
    pub const fn extent(&self) -> JumpExtent {
        self.extent
    }

    pub const fn standing_long_jump(&self) -> bool {
        self.standing_long_jump
    }

    pub const fn local_velocity(&self) -> Vector3 {
        self.local_velocity
    }

    pub const fn world_velocity(&self) -> Vector3 {
        self.world_velocity
    }
}

/// Resolves one supported attempt without consulting input devices, skills, resources, or physics.
pub fn resolve_character_jump(
    kinematics: CharacterJumpKinematics,
    attempt: JumpAttempt,
    heading: f32,
    readiness: CharacterJumpReadiness,
) -> Result<ResolvedJump, CharacterJumpRejection> {
    require_supported(readiness)?;
    let planar = resolve_local_planar_velocity(attempt.drive, kinematics.movement());
    let height = (kinematics.full_extent_jump_height() * attempt.extent.get())
        .max(RETAIL_MINIMUM_JUMP_HEIGHT);
    let local_velocity = Vector3::new(planar.x, planar.y, (height * RETAIL_DOUBLE_GRAVITY).sqrt());
    let world_planar = world_planar_velocity(planar, heading)
        .map_err(|_| CharacterJumpRejection::InvalidHeading)?;
    let world_velocity = world_planar + Vector3::new(0.0, 0.0, local_velocity.z);

    Ok(ResolvedJump {
        extent: attempt.extent,
        standing_long_jump: attempt.standing_long_jump,
        local_velocity,
        world_velocity,
    })
}

/// Resolves ordinary supported drive from the same axis composition sampled by a later jump.
pub fn resolve_character_drive(
    kinematics: CharacterMovementKinematics,
    drive: CharacterDrive,
    heading: f32,
) -> Result<Vector3, CharacterDriveResolutionError> {
    world_planar_velocity(resolve_local_planar_velocity(drive, kinematics), heading)
}

fn resolve_local_planar_velocity(
    drive: CharacterDrive,
    kinematics: CharacterMovementKinematics,
) -> Vector3 {
    let running = drive.gait == Gait::Run;
    let forward_speed = match drive.longitudinal {
        Some(LongitudinalMotion::Forward) if running => {
            kinematics.base_run_forward_speed() * kinematics.run_rate_scalar()
        }
        Some(LongitudinalMotion::Forward) => kinematics.base_walk_forward_speed(),
        Some(LongitudinalMotion::Backward) => {
            let run_scale = if running {
                kinematics.run_rate_scalar()
            } else {
                1.0
            };
            -(kinematics.base_walk_forward_speed() * RETAIL_BACKWARD_FACTOR * run_scale)
        }
        None => 0.0,
    };
    let sidestep_sign = match drive.lateral {
        Some(LateralMotion::Left) => -1.0,
        Some(LateralMotion::Right) => 1.0,
        None => 0.0,
    };
    let base_sidestep_rate = sidestep_sign
        * RETAIL_SIDESTEP_FACTOR
        * (kinematics.base_walk_forward_speed() / RETAIL_SIDESTEP_ANIMATION_SPEED);
    let sidestep_rate = if running {
        (base_sidestep_rate * kinematics.run_rate_scalar())
            .clamp(-RETAIL_MAXIMUM_SIDESTEP_RATE, RETAIL_MAXIMUM_SIDESTEP_RATE)
    } else {
        base_sidestep_rate
    };
    let mut velocity = Vector3::new(
        RETAIL_SIDESTEP_ANIMATION_SPEED * sidestep_rate,
        forward_speed,
        0.0,
    );
    let maximum_speed = kinematics.base_run_forward_speed() * kinematics.run_rate_scalar();
    if velocity.length() > maximum_speed {
        velocity = velocity.normalize() * maximum_speed;
    }
    velocity
}

fn world_planar_velocity(
    local_velocity: Vector3,
    heading: f32,
) -> Result<Vector3, CharacterDriveResolutionError> {
    if !heading.is_finite() {
        return Err(CharacterDriveResolutionError::InvalidHeading);
    }
    let forward = Vector3::new(-heading.cos(), heading.sin(), 0.0);
    let right = Vector3::new(heading.sin(), heading.cos(), 0.0);
    Ok(forward * local_velocity.y + right * local_velocity.x)
}

fn require_supported(readiness: CharacterJumpReadiness) -> Result<(), CharacterJumpRejection> {
    match readiness {
        CharacterJumpReadiness::Supported => Ok(()),
        CharacterJumpReadiness::Airborne => Err(CharacterJumpRejection::Airborne),
        CharacterJumpReadiness::Unsupported => Err(CharacterJumpRejection::Unsupported),
        CharacterJumpReadiness::Constrained => Err(CharacterJumpRejection::Constrained),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::character_kinematics::{
        CharacterKinematicsError, jump_kinematics_from_movement_capabilities,
    };
    use crate::client::character_motion::{
        CharacterMotionContact, CharacterMotionController, CharacterMotionEvent,
        CharacterMotionEventResult, CharacterMotionSequence, SequencedCharacterMotionEvent,
    };
    use crate::client::movement::character_motion_retail_differential::{
        oracle_planar_launch, oracle_vertical_launch,
    };
    use holtburger_world::{
        PlayerMotionTableSource, SelfMovementCapabilities, SelfMovementKinematics,
    };

    fn kinematics() -> CharacterJumpKinematics {
        let movement = CharacterMovementKinematics::new(3.12, 4.0, 1.0).unwrap();
        CharacterJumpKinematics::new(movement, 4.2125).unwrap()
    }

    fn attempt(drive: CharacterDrive) -> JumpAttempt {
        JumpAttempt {
            drive,
            extent: JumpExtent::MAXIMUM,
            standing_long_jump: false,
        }
    }

    fn assert_close(actual: f32, expected: f32) {
        assert!(
            (actual - expected).abs() < 0.000_01,
            "{actual} != {expected}"
        );
    }

    #[test]
    fn kinematics_reject_each_invalid_numeric_input() {
        for (values, expected) in [
            (
                [f32::NAN, 4.0, 1.0],
                CharacterKinematicsError::InvalidWalkSpeed,
            ),
            ([3.12, 0.0, 1.0], CharacterKinematicsError::InvalidRunSpeed),
            ([3.12, 4.0, -1.0], CharacterKinematicsError::InvalidRunRate),
        ] {
            assert_eq!(
                CharacterMovementKinematics::new(values[0], values[1], values[2]),
                Err(expected),
            );
        }

        let movement = CharacterMovementKinematics::new(3.12, 4.0, 1.0).unwrap();
        assert_eq!(
            CharacterJumpKinematics::new(movement, f32::INFINITY),
            Err(CharacterKinematicsError::InvalidJumpHeight),
        );
    }

    #[test]
    fn numeric_player_adapter_reuses_existing_motion_capabilities_and_style_charge() {
        let movement = SelfMovementCapabilities {
            kinematics: SelfMovementKinematics {
                source: PlayerMotionTableSource::DirectProperty {
                    motion_table_id: 0x0900_0020,
                },
                motion_table_id: 0x0900_0020,
                stance: MotionStance::DualWieldCombat as u32,
                base_walk_forward_velocity: Vector3::new(3.12, 0.0, 0.0),
                base_run_forward_velocity: Vector3::new(4.0, 0.0, 0.0),
                base_turn_left_omega: Vector3::new(0.0, 0.0, -1.0),
                base_turn_right_omega: Vector3::new(0.0, 0.0, 1.0),
            },
            run_rate_scalar: 1.5,
        };

        let kinematics = jump_kinematics_from_movement_capabilities(&movement, 4.2125).unwrap();
        assert_eq!(kinematics.movement().base_walk_forward_speed(), 3.12);
        assert_eq!(kinematics.movement().base_run_forward_speed(), 4.0);
        assert_eq!(kinematics.movement().run_rate_scalar(), 1.5);
        assert_eq!(kinematics.full_extent_jump_height(), 4.2125);
        assert_eq!(
            retail_jump_charge_profile(MotionStance::DualWieldCombat),
            JumpChargeProfile::RETAIL_DUAL_WIELD
        );
        assert_eq!(
            retail_jump_charge_profile(MotionStance::NonCombat),
            JumpChargeProfile::RETAIL_STANDARD
        );
    }

    #[test]
    fn readiness_and_heading_failures_are_distinct() {
        let attempt = attempt(CharacterDrive::default());
        for (readiness, expected) in [
            (
                CharacterJumpReadiness::Airborne,
                CharacterJumpRejection::Airborne,
            ),
            (
                CharacterJumpReadiness::Unsupported,
                CharacterJumpRejection::Unsupported,
            ),
            (
                CharacterJumpReadiness::Constrained,
                CharacterJumpRejection::Constrained,
            ),
        ] {
            assert_eq!(
                resolve_character_jump(kinematics(), attempt, 0.0, readiness),
                Err(expected)
            );
        }
        assert_eq!(
            resolve_character_jump(
                kinematics(),
                attempt,
                f32::NAN,
                CharacterJumpReadiness::Supported,
            ),
            Err(CharacterJumpRejection::InvalidHeading)
        );
    }

    #[test]
    fn supported_drive_uses_the_same_planar_kinematics_without_jump_height() {
        let movement = kinematics().movement();
        let drive = resolve_character_drive(
            movement,
            CharacterDrive::builder().run().forward().build(),
            0.0,
        )
        .unwrap();
        assert_close(drive.x, -4.0);
        assert_close(drive.y, 0.0);
        assert_eq!(drive.z, 0.0);
        assert_eq!(
            resolve_character_drive(movement, CharacterDrive::default(), f32::NAN),
            Err(CharacterDriveResolutionError::InvalidHeading)
        );
    }

    #[test]
    fn walk_run_backward_strafe_and_diagonal_share_one_axis_composition() {
        let walk = resolve_character_jump(
            kinematics(),
            attempt(CharacterDrive::builder().walk().forward().build()),
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        let run = resolve_character_jump(
            kinematics(),
            attempt(CharacterDrive::builder().run().forward().build()),
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        assert_close(walk.local_velocity().y, 3.12);
        assert_close(run.local_velocity().y, 4.0);
        assert!(walk.local_velocity().y < run.local_velocity().y);

        let backward = resolve_character_jump(
            kinematics(),
            attempt(CharacterDrive::builder().walk().backstep().build()),
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        assert_close(backward.local_velocity().y, -(3.12 * 0.65));

        let strafe = resolve_character_jump(
            kinematics(),
            attempt(CharacterDrive::builder().walk().strafe_right().build()),
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        assert_close(strafe.local_velocity().x, 3.12 * 0.5);

        let diagonal = resolve_character_jump(
            kinematics(),
            attempt(
                CharacterDrive::builder()
                    .run()
                    .forward()
                    .strafe_right()
                    .build(),
            ),
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        assert_close(
            Vector3::new(
                diagonal.local_velocity().x,
                diagonal.local_velocity().y,
                0.0,
            )
            .length(),
            4.0,
        );
    }

    #[test]
    fn one_local_launch_is_transformed_once_for_world_physics() {
        let resolved = resolve_character_jump(
            kinematics(),
            attempt(
                CharacterDrive::builder()
                    .run()
                    .forward()
                    .strafe_right()
                    .build(),
            ),
            90.0_f32.to_radians(),
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        assert_close(resolved.world_velocity().x, resolved.local_velocity().x);
        assert_close(resolved.world_velocity().y, resolved.local_velocity().y);
        assert_close(resolved.world_velocity().z, resolved.local_velocity().z);
    }

    #[test]
    fn requested_extent_scales_height_before_the_retail_floor() {
        let minimum_attempt = JumpAttempt {
            drive: CharacterDrive::default(),
            extent: JumpExtent::MINIMUM,
            standing_long_jump: true,
        };
        let minimum = resolve_character_jump(
            kinematics(),
            minimum_attempt,
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        assert_close(minimum.local_velocity().z, (0.35_f32 * 19.6).sqrt());

        let full = resolve_character_jump(
            kinematics(),
            attempt(CharacterDrive::default()),
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        assert_close(full.local_velocity().z, (4.2125_f32 * 19.6).sqrt());
        assert!(minimum.standing_long_jump());
    }

    #[test]
    fn one_controller_resolves_successive_attempts_with_fresh_kinematics() {
        let mut controller = CharacterMotionController::new();
        let release_attempt = |controller: &mut CharacterMotionController, sequence: u64| {
            let begin = controller.apply_event(
                SequencedCharacterMotionEvent {
                    sequence: CharacterMotionSequence(sequence),
                    event: CharacterMotionEvent::BeginJump {
                        drive: CharacterDrive::default(),
                    },
                },
                CharacterMotionContact::Walkable,
            );
            assert_eq!(begin, CharacterMotionEventResult::ChargeAccepted);
            let released = controller.apply_event(
                SequencedCharacterMotionEvent {
                    sequence: CharacterMotionSequence(sequence + 1),
                    event: CharacterMotionEvent::ReleaseJump {
                        drive: CharacterDrive::default(),
                        extent: JumpExtent::MAXIMUM,
                    },
                },
                CharacterMotionContact::Walkable,
            );
            let CharacterMotionEventResult::JumpReleased(attempt) = released else {
                panic!("accepted release must emit one jump attempt");
            };
            attempt
        };
        let first_attempt = release_attempt(&mut controller, 0);
        let second_attempt = release_attempt(&mut controller, 2);
        let movement = kinematics().movement();
        let first_kinematics = CharacterJumpKinematics::new(movement, 4.2125).unwrap();
        let second_kinematics = CharacterJumpKinematics::new(movement, 8.425).unwrap();

        let first = resolve_character_jump(
            first_kinematics,
            first_attempt,
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        let second = resolve_character_jump(
            second_kinematics,
            second_attempt,
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();

        assert_eq!(first.extent(), second.extent());
        assert!(second.local_velocity().z > first.local_velocity().z);
        assert_close(first.local_velocity().z, (4.2125_f32 * 19.6).sqrt());
        assert_close(second.local_velocity().z, (8.425_f32 * 19.6).sqrt());
    }

    #[test]
    fn production_launch_matches_the_independent_retail_oracle_matrix() {
        let cases = [
            (
                CharacterDrive::builder().walk().forward().build(),
                1.0,
                0.0,
                false,
            ),
            (
                CharacterDrive::builder().run().forward().build(),
                1.0,
                0.0,
                true,
            ),
            (
                CharacterDrive::builder().run().backstep().build(),
                -1.0,
                0.0,
                true,
            ),
            (
                CharacterDrive::builder().walk().strafe_left().build(),
                0.0,
                -1.0,
                false,
            ),
            (
                CharacterDrive::builder()
                    .run()
                    .forward()
                    .strafe_right()
                    .build(),
                1.0,
                1.0,
                true,
            ),
        ];
        for (drive, longitudinal, lateral, running) in cases {
            let resolved = resolve_character_jump(
                kinematics(),
                attempt(drive),
                0.0,
                CharacterJumpReadiness::Supported,
            )
            .unwrap();
            let expected = oracle_planar_launch(longitudinal, lateral, running, 1.0);
            assert_close(resolved.local_velocity().x, expected.x);
            assert_close(resolved.local_velocity().y, expected.y);
        }

        let expected_vertical = oracle_vertical_launch(1.0, 300.0, 1.0, 1.0);
        let resolved = resolve_character_jump(
            kinematics(),
            attempt(CharacterDrive::default()),
            0.0,
            CharacterJumpReadiness::Supported,
        )
        .unwrap();
        assert_close(resolved.local_velocity().z, expected_vertical);
    }
}
