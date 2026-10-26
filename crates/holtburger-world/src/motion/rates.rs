//! Stateless local compatibility rates. Playback always remains native.

use holtburger_common::{RigidTransform, Vector3};
use holtburger_content::{MotionSequence, MotionSequenceTable};

use super::MotionCommand;

/// Standard player table supplying rates for missing local locomotion components.
pub const PLAYER_LOCOMOTION_BASELINE_TABLE: u32 = 0x0900_0001;

/// Execution role selected by the native interpreter or a capability lookup. Modifier clips are
/// not played: only their explicit vectors contribute (`MotionTable.combine_motion` in ACE).
#[derive(Clone, Copy)]
pub(crate) enum MotionRow<'a> {
    /// Primary cyclic playback contributes both authored root travel and explicit vectors.
    Cycle(&'a MotionSequence),
    /// Additive modifier contributes explicit vectors only, even when its record contains clips.
    Modifier(&'a MotionSequence),
}

impl<'a> MotionRow<'a> {
    pub fn sequence(self) -> &'a MotionSequence {
        match self {
            Self::Cycle(row) | Self::Modifier(row) => row,
        }
    }

    pub fn rates(self) -> MotionRates {
        match self {
            Self::Cycle(row) => MotionRates::from_cycle(row),
            Self::Modifier(row) => MotionRates::explicit(row),
        }
    }
}

/// Native row precedence for velocity-shaped capability summaries, without state admission.
/// Physical playback uses the actual selector's result instead of repeating this lookup.
pub(crate) fn locomotion_row(
    table: &MotionSequenceTable,
    style: u32,
    command: MotionCommand,
) -> Option<MotionRow<'_>> {
    table
        .cycle(style, command.raw())
        .or_else(|| table.cycle(table.default_style, command.raw()))
        .map(MotionRow::Cycle)
        .or_else(|| {
            table
                .modifier(style, command.raw())
                .map(MotionRow::Modifier)
        })
        .or_else(|| table.modifier(0, command.raw()).map(MotionRow::Modifier))
}

/// Compatibility covers only canonical movement, never stances, actions, Ready, or Falling.
pub(crate) fn baseline_row(
    baseline: &MotionSequenceTable,
    command: MotionCommand,
) -> Option<MotionRow<'_>> {
    is_locomotion(command)
        .then(|| locomotion_row(baseline, baseline.default_style, command))
        .flatten()
}

pub(super) fn is_locomotion(command: MotionCommand) -> bool {
    matches!(
        command,
        MotionCommand::WALK_FORWARD
            | MotionCommand::RUN_FORWARD
            | MotionCommand::SIDESTEP
            | MotionCommand::TURN_RIGHT
    )
}

/// Body-local mean rates used for the whole physical interval when coverage is incomplete.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct MotionRates {
    /// Full native/baseline translation vector, without controller-axis projection.
    pub velocity: Vector3,
    /// Mean local angular velocity, including explicit motion-data omega.
    pub omega: Vector3,
}

impl MotionRates {
    /// Reduce one authored row without retaining any playback phase. Explicit rates add to root
    /// travel, as in native sequence physics. Root averages use each clip's actual duration.
    pub fn from_cycle(sequence: &MotionSequence) -> Self {
        let mut rates = Self::explicit(sequence);
        let mut duration = 0.0;
        let mut root = RigidTransform::identity();
        let mut angles = Vector3::zero();
        for clip in &sequence.clips {
            // A held clip prevents a full cyclic traversal; its long-term root rate is zero.
            // Explicit row velocity/omega still apply while frames are held.
            if clip.framerate == 0.0 {
                return rates;
            }
            duration += clip.frame_span() as f32 / clip.framerate.abs();
            let offset = clip
                .animation
                .root
                .composed_over(clip.low_frame, clip.high_frame);
            root = root.combine(&if clip.framerate < 0.0 {
                RigidTransform::identity().subtract(&offset)
            } else {
                offset
            });
            // Sum frame angles so a complete revolution does not collapse to identity. Mean
            // angular velocity is deliberately an approximation for non-collinear root turns.
            for frame in clip.low_frame..=clip.high_frame {
                if let Some(offset) = clip.animation.root.offset(frame) {
                    let q = offset.rotation;
                    let angle = glam::Quat::from_xyzw(q.x, q.y, q.z, q.w).to_scaled_axis();
                    angles =
                        angles + Vector3::new(angle.x, angle.y, angle.z) * clip.framerate.signum();
                }
            }
        }
        if !sequence.clips.is_empty() {
            rates.velocity = rates.velocity + root.translation / duration;
            rates.omega = rates.omega + angles / duration;
        }
        rates
    }

    /// Native modifiers combine only these vectors; their clip records never enter playback.
    fn explicit(sequence: &MotionSequence) -> Self {
        Self {
            velocity: sequence.velocity.unwrap_or_default(),
            omega: sequence.omega.unwrap_or_default(),
        }
    }

    /// One selected physical interval, entering the existing support/scale/collision path once.
    pub fn offset(self, quantum: f32) -> RigidTransform {
        RigidTransform {
            translation: self.velocity * quantum,
            ..RigidTransform::identity()
        }
        .rotate(self.omega * quantum)
    }

    pub fn add(&mut self, other: Self, speed: f32) {
        self.velocity = self.velocity + other.velocity * speed;
        self.omega = self.omega + other.omega * speed;
    }
}
