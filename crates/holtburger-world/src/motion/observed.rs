//! Locomotion presentation from accepted motion or explicit drive intent, never a source of physics.

use anyhow::{Result, ensure};
use holtburger_common::Quaternion;
use holtburger_content::MotionSequenceTable;

use super::{CharacterMotionPresentation, MotionCommand, MotionOrder};
use crate::spatial::AcceptedBodyMotion;

/// Mutually exclusive presentation input; commanded travel is never labelled accepted physics.
#[derive(Debug, Clone, Copy)]
pub enum LocomotionPresentationSource {
    /// Accepted supported travel and turning, used for remote entities and undriven local bodies.
    Observed(AcceptedBodyMotion),
    /// Controller-resolved locomotion channels, including their requested gait and rates.
    Command(MotionOrder),
}

/// Visual walk/backward/sidestep reference speed at object scale one; not a physical speed limit.
pub const OBSERVED_WALK_SPEED_MPS: f32 = 2.0;
/// Visual running reference speed and walk/run selection threshold at scale one.
pub const OBSERVED_RUN_SPEED_MPS: f32 = 4.0;
/// Visual standing-turn reference rate, independent of the actual body's angular integration.
pub const OBSERVED_TURN_RATE_RADIANS: f32 = std::f32::consts::FRAC_PI_2;
/// Small accepted linear motion is presented as idle to avoid gait changes while settling.
pub const OBSERVED_LINEAR_IDLE_SPEED_MPS: f32 = 0.05;
/// Small accepted yaw is presented without a turn animation.
pub const OBSERVED_ANGULAR_IDLE_RATE_RADIANS: f32 = 0.05;

/// Selects visual channels from final supported displacement rate and observed angular velocity.
/// `motion.velocity` includes accepted horizontal separation but excludes airborne travel,
/// stair lifts, and angular sphere chords. It is presentation-only. The caller supplies
/// resolved support/charge presentation; actions and special poses retain runtime priority.
/// Reference speeds approximate cadence instead of evaluating root tracks or altering body motion.
pub fn observed_locomotion_order(
    table: &MotionSequenceTable,
    style: MotionCommand,
    motion: AcceptedBodyMotion,
    orientation: Quaternion,
    presentation: CharacterMotionPresentation,
    object_scale: f32,
) -> Result<MotionOrder> {
    ensure!(
        object_scale.is_finite() && object_scale > 0.0,
        "observed locomotion requires positive finite object scale"
    );
    let local = orientation.conjugate().rotate_vector(motion.velocity);
    ensure!(
        local.length_squared().is_finite(),
        "observed locomotion requires finite local velocity"
    );
    ensure!(
        motion.omega.z.is_finite(),
        "observed locomotion requires finite yaw rate"
    );
    let mut order = MotionOrder {
        style: Some(style),
        ..MotionOrder::default()
    };
    let visible_cycle = |command: MotionCommand| {
        table
            .cycle(style.raw(), command.raw())
            .is_some_and(|row| !row.clips.is_empty())
    };
    match presentation {
        CharacterMotionPresentation::Ready | CharacterMotionPresentation::Falling => {
            let command = match presentation {
                CharacterMotionPresentation::Ready => MotionCommand::READY,
                _ => MotionCommand::FALLING,
            };
            // Missing support-specific content explicitly falls back to the stance default.
            if visible_cycle(command) {
                order.forward = Some((command, 1.0));
            }
            return Ok(order);
        }
        CharacterMotionPresentation::StanceDefault => return Ok(order),
        CharacterMotionPresentation::Grounded => {}
    }
    let speed = local.x.hypot(local.y);
    if speed > OBSERVED_LINEAR_IDLE_SPEED_MPS {
        let walk_rate = speed / (OBSERVED_WALK_SPEED_MPS * object_scale);
        let sideways = local.x.abs() > local.y.abs();
        if sideways && visible_cycle(MotionCommand::SIDESTEP) {
            order.sidestep = Some((MotionCommand::SIDESTEP, walk_rate * local.x.signum()));
        } else if !sideways && local.y < 0.0 && visible_cycle(MotionCommand::WALK_BACKWARDS) {
            order.forward = Some((MotionCommand::WALK_BACKWARDS, walk_rate));
        } else {
            let running = speed >= OBSERVED_RUN_SPEED_MPS * object_scale;
            let choices = if running {
                [MotionCommand::RUN_FORWARD, MotionCommand::WALK_FORWARD]
            } else {
                [MotionCommand::WALK_FORWARD, MotionCommand::RUN_FORWARD]
            };
            if let Some(command) = choices.into_iter().find(|command| visible_cycle(*command)) {
                let base = if command == MotionCommand::RUN_FORWARD {
                    OBSERVED_RUN_SPEED_MPS
                } else {
                    OBSERVED_WALK_SPEED_MPS
                };
                // A missing backward row reverses an available forward cycle. Missing side
                // content uses forward gait while the actual body keeps its physical facing.
                let direction = if !sideways && local.y < 0.0 {
                    -1.0
                } else {
                    1.0
                };
                order.forward = Some((command, direction * speed / (base * object_scale)));
            }
        }
    }
    if motion.omega.z.abs() > OBSERVED_ANGULAR_IDLE_RATE_RADIANS {
        let command = if motion.omega.z > 0.0 {
            MotionCommand::TURN_LEFT
        } else {
            MotionCommand::TURN_RIGHT
        };
        let stationary = order.forward.is_none() && order.sidestep.is_none();
        // The current renderer has one clip, so a standing turn must not replace a moving gait.
        if stationary && visible_cycle(command) {
            order.turn = Some((command, motion.omega.z.abs() / OBSERVED_TURN_RATE_RADIANS));
        }
    }
    Ok(order)
}
