//! Retail-adjusted semantic character axes shared by authored playback and physical launch.

use super::character_kinematics::CharacterMovementKinematics;
use super::movement_types::{CharacterDrive, Gait, LateralMotion, LongitudinalMotion, Turn};
use holtburger_common::Vector3;
use holtburger_world::motion::MotionCommand;
use thiserror::Error;

/// Retail walk animation speed from `CMotionInterp::get_state_velocity`
/// (`acclient.c:329860-329872`).
const RETAIL_WALK_ANIMATION_SPEED: f32 = 3.12;
/// Retail sidestep animation speed from `CMotionInterp::get_state_velocity`
/// (`acclient.c:329860`).
const RETAIL_SIDESTEP_ANIMATION_SPEED: f32 = 1.25;
/// Retail backward scaling from `CMotionInterp::adjust_motion` (`acclient.c:330017`).
const RETAIL_BACKWARD_FACTOR: f32 = 0.65;
/// Retail sidestep scaling from `CMotionInterp::adjust_motion` (`acclient.c:330044`).
const RETAIL_SIDESTEP_FACTOR: f32 = 0.5;
/// Retail cap applied to the interpreted sidestep animation rate (`acclient.c:329803`).
const RETAIL_MAXIMUM_SIDESTEP_RATE: f32 = 3.0;
/// Retail animation-rate multiplier applied to turn commands while Run is held
/// (`acclient.c:329739-329778`).
const RETAIL_RUN_TURN_RATE: f32 = 1.5;

/// Canonical forward command plus its signed playback-rate multiplier.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AdjustedForwardAxis {
    /// `WalkForward`, including negative playback for backward movement.
    Walk { speed_mod: f32 },
    /// `RunForward` at the actor's resolved run-rate scalar.
    Run { speed_mod: f32 },
}

impl AdjustedForwardAxis {
    /// Concrete motion-table order selected after retail adjustment.
    pub const fn ordered_motion(self) -> (MotionCommand, f32) {
        match self {
            Self::Walk { speed_mod } => (MotionCommand::WALK_FORWARD, speed_mod),
            Self::Run { speed_mod } => (MotionCommand::RUN_FORWARD, speed_mod),
        }
    }

    /// Base actor speed selected by this canonical command.
    fn base_speed(self, kinematics: CharacterMovementKinematics) -> f32 {
        match self {
            Self::Walk { .. } => kinematics.base_walk_forward_speed(),
            Self::Run { .. } => kinematics.base_run_forward_speed(),
        }
    }
}

/// Complete result of retail's signed command canonicalization and rate adjustment.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct AdjustedCharacterAxes {
    /// Canonical longitudinal substate and signed playback rate.
    forward: Option<AdjustedForwardAxis>,
    /// Signed `SideStepRight` playback rate.
    sidestep_rate: Option<f32>,
    /// Signed `TurnRight` playback rate.
    turn_rate: Option<f32>,
}

impl AdjustedCharacterAxes {
    pub const fn forward(self) -> Option<AdjustedForwardAxis> {
        self.forward
    }

    pub const fn sidestep(self) -> Option<(MotionCommand, f32)> {
        match self.sidestep_rate {
            Some(rate) => Some((MotionCommand::SIDESTEP, rate)),
            None => None,
        }
    }

    pub const fn turn(self) -> Option<(MotionCommand, f32)> {
        match self.turn_rate {
            Some(rate) => Some((MotionCommand::TURN, rate)),
            None => None,
        }
    }

    /// Release-time local planar velocity using actor-resolved jump movement facts.
    pub fn local_planar_velocity(self, kinematics: CharacterMovementKinematics) -> Vector3 {
        let forward_speed = self.forward.map_or(0.0, |forward| {
            let (_, speed_mod) = forward.ordered_motion();
            forward.base_speed(kinematics) * speed_mod
        });
        let sidestep_speed = self
            .sidestep_rate
            .map_or(0.0, |rate| RETAIL_SIDESTEP_ANIMATION_SPEED * rate);
        let mut velocity = Vector3::new(sidestep_speed, forward_speed, 0.0);
        let maximum_speed = kinematics.base_run_forward_speed() * kinematics.run_rate_scalar();
        if velocity.length() > maximum_speed {
            velocity = velocity.normalize() * maximum_speed;
        }
        velocity
    }
}

/// Invalid semantic scalar rejected before it can reach playback or physics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum CharacterAxisAdjustmentError {
    #[error("character turn-rate scalar must be finite and positive")]
    InvalidTurnRate,
}

/// Applies retail's `adjust_motion` and `apply_run_to_command` rules once.
pub fn adjust_character_axes(
    drive: CharacterDrive,
    kinematics: CharacterMovementKinematics,
) -> Result<AdjustedCharacterAxes, CharacterAxisAdjustmentError> {
    let running = drive.gait == Gait::Run;
    let run_rate = kinematics.run_rate_scalar();
    let forward = match drive.longitudinal {
        Some(LongitudinalMotion::Forward) if running => Some(AdjustedForwardAxis::Run {
            speed_mod: run_rate,
        }),
        Some(LongitudinalMotion::Forward) => Some(AdjustedForwardAxis::Walk { speed_mod: 1.0 }),
        Some(LongitudinalMotion::Backward) => Some(AdjustedForwardAxis::Walk {
            speed_mod: -RETAIL_BACKWARD_FACTOR * if running { run_rate } else { 1.0 },
        }),
        None => None,
    };

    let sidestep_sign = match drive.lateral {
        Some(LateralMotion::Left) => -1.0,
        Some(LateralMotion::Right) => 1.0,
        None => 0.0,
    };
    let base_sidestep_rate = sidestep_sign
        * RETAIL_SIDESTEP_FACTOR
        * (RETAIL_WALK_ANIMATION_SPEED / RETAIL_SIDESTEP_ANIMATION_SPEED);
    let sidestep_rate = drive.lateral.map(|_| {
        if running {
            (base_sidestep_rate * run_rate)
                .clamp(-RETAIL_MAXIMUM_SIDESTEP_RATE, RETAIL_MAXIMUM_SIDESTEP_RATE)
        } else {
            base_sidestep_rate
        }
    });

    let turn_sign = match drive.turning {
        Some(Turn::Left) => -1.0,
        Some(Turn::Right) => 1.0,
        None => 0.0,
    };
    let turn_rate = if drive.turning.is_some() {
        let magnitude =
            drive
                .turn_rate_scalar
                .unwrap_or(if running { RETAIL_RUN_TURN_RATE } else { 1.0 });
        if !magnitude.is_finite() || magnitude <= 0.0 {
            return Err(CharacterAxisAdjustmentError::InvalidTurnRate);
        }
        Some(turn_sign * magnitude)
    } else {
        None
    };

    Ok(AdjustedCharacterAxes {
        forward,
        sidestep_rate,
        turn_rate,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinematics(run_rate: f32) -> CharacterMovementKinematics {
        CharacterMovementKinematics::new(3.12, 4.0, run_rate).expect("valid kinematics")
    }

    #[test]
    fn canonicalizes_every_signed_axis_and_preserves_independent_channels() {
        let axes = adjust_character_axes(
            CharacterDrive::builder()
                .run()
                .backstep()
                .strafe_left()
                .turn_left()
                .build(),
            kinematics(1.25),
        )
        .expect("valid drive");

        assert_eq!(
            axes.forward().map(AdjustedForwardAxis::ordered_motion),
            Some((MotionCommand::WALK_FORWARD, -0.8125))
        );
        assert_eq!(axes.sidestep(), Some((MotionCommand::SIDESTEP, -1.56)));
        assert_eq!(axes.turn(), Some((MotionCommand::TURN, -1.5)));
    }

    #[test]
    fn run_forward_selects_run_cycle_and_actor_rate() {
        let axes = adjust_character_axes(
            CharacterDrive::builder().run().forward().build(),
            kinematics(1.25),
        )
        .expect("valid drive");

        assert_eq!(
            axes.forward().map(AdjustedForwardAxis::ordered_motion),
            Some((MotionCommand::RUN_FORWARD, 1.25))
        );
    }

    #[test]
    fn explicit_turn_rate_must_be_positive_and_finite() {
        for scalar in [0.0, -1.0, f32::NAN, f32::INFINITY] {
            let drive = CharacterDrive {
                turning: Some(Turn::Right),
                turn_rate_scalar: Some(scalar),
                ..CharacterDrive::default()
            };
            assert_eq!(
                adjust_character_axes(drive, kinematics(1.0)),
                Err(CharacterAxisAdjustmentError::InvalidTurnRate)
            );
        }
    }
}
