//! Retail-shaped local-player server correction.
//!
//! `CPhysicsObj::MoveOrTeleport` (`acclient.c:311475-311523`) first decides whether an
//! authoritative position is ignored, directly placed, snapped, or interpolated. The accepted
//! interpolation is then an ordered movement-basis stage: `InterpolationManager::adjust_offset`
//! assigns the tick translation (`acclient.c:372004-372094`) and
//! `ConstraintManager::adjust_offset` scales that survivor (`acclient.c:372268-372296`).
//! Keeping the decision ladder and both cursor stages here means packet handling, physics, and
//! presentation do not each invent a slightly different correction policy.

use holtburger_common::Vector3;
use holtburger_common::position::WorldPosition;

/// Distance below which an interpolation node completes (`acclient.c:372040`).
pub(crate) const RETAIL_INTERPOLATION_TARGET_THRESHOLD_M: f32 = 0.05;
/// Distance at which `MoveOrTeleport` stops interpolation and uses a sliding snap
/// (`acclient.c:311508-311515`).
pub(crate) const RETAIL_INTERPOLATION_SNAP_DISTANCE_M: f32 = 96.0;
/// Fallback cap used when no motion interpreter supplies an adjusted maximum speed
/// (`acclient.c:372065-372067`).
pub(crate) const RETAIL_MAX_INTERPOLATED_VELOCITY_MPS: f32 = 7.5;
/// A stalled node closer than this completes rather than becoming a failed node
/// (`acclient.c:372088-372097`).
pub(crate) const RETAIL_INTERPOLATION_NEAR_COMPLETE_DISTANCE_M: f32 = 0.2;
/// Retail lets four failed nodes accumulate before `UseTime` falls back to the blip position
/// (`acclient.c:371736-371832`).
pub(crate) const RETAIL_INTERPOLATION_FAILURE_LIMIT: u8 = 4;
/// `InterpolationManager` checks progress every five frames (`acclient.c:372070-372077`).
const RETAIL_INTERPOLATION_WATCHDOG_FRAMES: u8 = 5;
const RETAIL_WATCHDOG_PROGRESS_RATIO: f32 = 0.3;
const EPSILON: f32 = 0.000_2;

/// What one accepted authoritative position does to the local runtime body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CorrectionDisposition {
    /// Discard a stale or airborne update.
    Ignored,
    /// Directly install a newer teleport epoch or recover a body with no cell.
    HardSet,
    /// Stop interpolation and directly install a far but current update.
    Snap,
    /// Queue a target for the ordered interpolation stages.
    Interpolate {
        /// `MoveTo` owns heading while the node is active.
        keep_heading: bool,
    },
}

/// Facts needed to classify one server position update.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ServerPositionUpdate {
    pub(crate) pose: WorldPosition,
    pub(crate) teleport_sequence: u16,
    /// The protocol's contact/grounded bit. Retail does not interpolate an airborne update.
    pub(crate) contact: bool,
    /// Retail's object-to-viewer distance used by the 96m snap branch.
    pub(crate) distance: f32,
    /// Whether a currently running MoveTo owns the target heading.
    pub(crate) is_moving_to: bool,
}

/// Retail's wraparound sequence comparison (`acclient.c:311488-311493`).
pub(crate) fn is_newer_sequence(candidate: u16, reference: u16) -> bool {
    let delta = i32::from(candidate) - i32::from(reference);
    if delta.abs() > 0x7FFF {
        candidate < reference
    } else {
        reference < candidate
    }
}

/// Reproduces the complete `MoveOrTeleport` decision ladder.
pub(crate) fn classify_server_position(
    update: ServerPositionUpdate,
    known_teleport_sequence: u16,
    has_cell: bool,
) -> CorrectionDisposition {
    if is_newer_sequence(known_teleport_sequence, update.teleport_sequence) {
        return CorrectionDisposition::Ignored;
    }
    if is_newer_sequence(update.teleport_sequence, known_teleport_sequence) || !has_cell {
        return CorrectionDisposition::HardSet;
    }
    if !update.contact {
        return CorrectionDisposition::Ignored;
    }
    if update.distance >= RETAIL_INTERPOLATION_SNAP_DISTANCE_M {
        return CorrectionDisposition::Snap;
    }
    CorrectionDisposition::Interpolate {
        keep_heading: update.is_moving_to,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct InterpolationNode {
    target: WorldPosition,
    keep_heading: bool,
    original_distance: f32,
    progress_quantum: f32,
    frame_counter: u8,
    node_fail_counter: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ConstraintLeash {
    accumulated_distance: f32,
    start_distance: f32,
    maximum_distance: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum InterpolationOutcome {
    NotApplied,
    Completed,
    Abandoned,
    Assigned,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct InterpolationResult {
    outcome: InterpolationOutcome,
    translation: Vector3,
    heading_pinned: bool,
    target: Option<WorldPosition>,
    /// Retail's `UseTime` snaps to the last blip position after four failed nodes.
    snap_to: Option<WorldPosition>,
}

impl InterpolationResult {
    fn composed() -> Self {
        Self {
            outcome: InterpolationOutcome::NotApplied,
            translation: Vector3::zero(),
            heading_pinned: false,
            target: None,
            snap_to: None,
        }
    }
}

/// One prepared correction result consumed by the local physical actuation boundary.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ServerInterpolationStep {
    pub(crate) translation: Vector3,
    pub(crate) target: WorldPosition,
    pub(crate) failed: bool,
    pub(crate) assigned: bool,
    pub(crate) heading_pinned: bool,
    pub(crate) snap_to: Option<WorldPosition>,
}

/// Composite correction state for the local player.
///
/// The interpolation node and constraint leash are intentionally owned together. A new accepted
/// update re-arms both in one transition; direct placement and lifecycle reset clear both, so no
/// stale interpolation or drift budget can survive a discontinuity.
#[derive(Debug, Default)]
pub(crate) struct ServerCorrection {
    interpolation: Option<InterpolationNode>,
    constraint: Option<ConstraintLeash>,
    prepared_step: Option<ServerInterpolationStep>,
}

impl ServerCorrection {
    pub(crate) fn reset(&mut self) {
        self.interpolation = None;
        self.constraint = None;
        self.prepared_step = None;
    }

    /// Re-arms the dead-reckoning leash from the current drift to the confirmed pose.
    pub(crate) fn constrain_to(&mut self, confirmed: WorldPosition, current: WorldPosition) {
        let (start_distance, maximum_distance) = retail_constraint_distances(confirmed);
        let accumulated_distance = (current.global_coords() - confirmed.global_coords()).length();
        self.constraint = Some(ConstraintLeash {
            accumulated_distance,
            start_distance,
            maximum_distance,
        });
    }

    /// Queues one target, replacing the previous tail as the client has one local correction
    /// producer. Retail may queue multiple remote nodes; local-player updates are serialized here.
    pub(crate) fn interpolate_to(
        &mut self,
        target: WorldPosition,
        current: WorldPosition,
        keep_heading: bool,
    ) {
        let distance = (target.global_coords() - current.global_coords()).length();
        self.interpolation = Some(InterpolationNode {
            target,
            keep_heading,
            original_distance: distance,
            progress_quantum: 0.0,
            frame_counter: 0,
            node_fail_counter: 0,
        });
        self.prepared_step = None;
    }

    pub(crate) fn prepared_step(&self) -> Option<ServerInterpolationStep> {
        self.prepared_step
    }

    pub(crate) fn has_interpolation(&self) -> bool {
        self.interpolation.is_some()
    }

    pub(crate) fn has_work(&self) -> bool {
        self.interpolation.is_some()
            || self.constraint.as_ref().is_some_and(|constraint| {
                constraint.accumulated_distance > constraint.start_distance
            })
    }

    /// Runs interpolation assignment and then constraint damping once for this physics tick.
    pub(crate) fn prepare_tick(
        &mut self,
        current: WorldPosition,
        contact: bool,
        requested_speed_mps: Option<f32>,
        quantum: f32,
    ) -> Option<ServerInterpolationStep> {
        let interpolation = self.interpolation_step(current, contact, requested_speed_mps, quantum);
        let Some(target) = interpolation.target else {
            let has_work = self.constraint.is_some() || interpolation.snap_to.is_some();
            let step = has_work.then(|| ServerInterpolationStep {
                translation: Vector3::zero(),
                target: current,
                failed: matches!(interpolation.outcome, InterpolationOutcome::Abandoned),
                assigned: false,
                heading_pinned: false,
                snap_to: interpolation.snap_to,
            });
            self.prepared_step = step;
            return step;
        };

        let translation = self.constraint_step(interpolation.translation, contact);
        let step = ServerInterpolationStep {
            translation,
            target,
            failed: matches!(interpolation.outcome, InterpolationOutcome::Abandoned),
            assigned: matches!(interpolation.outcome, InterpolationOutcome::Assigned),
            heading_pinned: interpolation.heading_pinned,
            snap_to: interpolation.snap_to,
        };
        self.prepared_step = Some(step);
        Some(step)
    }

    /// Applies the prepared correction to a producer-composed translation.
    ///
    /// A prepared assignment has already passed through the leash and replaces the composed
    /// translation. If interpolation was gated (airborne, complete, or stalled), the authored
    /// translation survives and is damped exactly once. Rotation/omega are handled by the caller
    /// and are never touched here.
    pub(crate) fn apply_to_composed_translation(
        &mut self,
        composed: Vector3,
        contact: bool,
    ) -> CorrectionOverride {
        if let Some(step) = self.prepared_step
            && step.assigned
        {
            return CorrectionOverride {
                translation: step.translation,
                heading_pinned: step.heading_pinned,
                target: Some(step.target),
                snap_to: step.snap_to,
            };
        }

        // `prepare_tick` has consumed the interpolation stage. Only the leash remains to be
        // applied to authored/retained motion when interpolation did not assign an offset.
        let translation = self.constraint_step(composed, contact);
        CorrectionOverride {
            translation,
            heading_pinned: false,
            target: None,
            snap_to: self.prepared_step.and_then(|step| step.snap_to),
        }
    }

    fn interpolation_step(
        &mut self,
        current: WorldPosition,
        contact: bool,
        requested_speed_mps: Option<f32>,
        quantum: f32,
    ) -> InterpolationResult {
        let Some(mut node) = self.interpolation else {
            return InterpolationResult::composed();
        };
        if !contact {
            return InterpolationResult {
                outcome: InterpolationOutcome::NotApplied,
                translation: Vector3::zero(),
                heading_pinned: false,
                target: None,
                snap_to: None,
            };
        }

        let to_target = node.target.global_coords() - current.global_coords();
        let distance = to_target.length();
        if !distance.is_finite() || distance < RETAIL_INTERPOLATION_TARGET_THRESHOLD_M {
            self.interpolation = None;
            return InterpolationResult {
                outcome: InterpolationOutcome::Completed,
                translation: Vector3::zero(),
                heading_pinned: false,
                target: None,
                snap_to: None,
            };
        }

        let step_rate = retail_interpolated_speed(requested_speed_mps);
        let quantum = quantum.max(0.0);
        node.frame_counter = node.frame_counter.saturating_add(1);
        node.progress_quantum += quantum;

        if node.frame_counter >= RETAIL_INTERPOLATION_WATCHDOG_FRAMES {
            let progress = node.original_distance - distance;
            let progressing = progress >= EPSILON
                && node.progress_quantum > EPSILON
                && progress / node.progress_quantum / step_rate >= RETAIL_WATCHDOG_PROGRESS_RATIO;
            if !progressing {
                node.node_fail_counter = node
                    .node_fail_counter
                    .saturating_add(1)
                    .min(RETAIL_INTERPOLATION_FAILURE_LIMIT);
                let near_complete = distance < RETAIL_INTERPOLATION_NEAR_COMPLETE_DISTANCE_M;
                let snap_to = (node.node_fail_counter >= RETAIL_INTERPOLATION_FAILURE_LIMIT
                    && !near_complete)
                    .then_some(node.target);
                self.interpolation = if snap_to.is_some() || near_complete {
                    None
                } else {
                    Some(node)
                };
                return InterpolationResult {
                    outcome: if near_complete {
                        InterpolationOutcome::Completed
                    } else {
                        InterpolationOutcome::Abandoned
                    },
                    translation: Vector3::zero(),
                    heading_pinned: false,
                    target: Some(node.target),
                    snap_to,
                };
            }
            node.frame_counter = 0;
            node.progress_quantum = 0.0;
            node.original_distance = distance;
        }

        let cap = step_rate * quantum;
        let translation = if distance > cap && distance > EPSILON {
            to_target * (cap / distance)
        } else {
            to_target
        };
        self.interpolation = Some(node);
        InterpolationResult {
            outcome: InterpolationOutcome::Assigned,
            translation,
            heading_pinned: node.keep_heading,
            target: Some(node.target),
            snap_to: None,
        }
    }

    fn constraint_step(&mut self, translation: Vector3, contact: bool) -> Vector3 {
        let Some(constraint) = self.constraint.as_mut() else {
            return translation;
        };

        let (damped, next_distance) = if contact {
            damp_constraint_translation(
                translation,
                constraint.accumulated_distance,
                constraint.start_distance,
                constraint.maximum_distance,
            )
        } else {
            // Retail accumulates the post-damping magnitude even while airborne, but only gates
            // the scale/zero branch on contact.
            (
                translation,
                constraint.accumulated_distance + translation.length(),
            )
        };
        constraint.accumulated_distance = next_distance;
        damped
    }
}

/// The correction result needed by the physical actuation boundary.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CorrectionOverride {
    pub(crate) translation: Vector3,
    pub(crate) heading_pinned: bool,
    pub(crate) target: Option<WorldPosition>,
    pub(crate) snap_to: Option<WorldPosition>,
}

/// Retail's adjusted speed, including the `adjusted_max_speed * 2` rule and fallback
/// (`acclient.c:372051-372067`).
pub(crate) fn retail_interpolated_speed(requested_speed_mps: Option<f32>) -> f32 {
    let Some(speed) = requested_speed_mps else {
        return RETAIL_MAX_INTERPOLATED_VELOCITY_MPS;
    };
    let adjusted = speed * 2.0;
    if adjusted.is_finite() && adjusted >= EPSILON {
        adjusted
    } else {
        RETAIL_MAX_INTERPOLATED_VELOCITY_MPS
    }
}

/// `CPhysicsObj::Get{Start,Max}ConstraintDistance` for the local player
/// (`acclient.c:304336-304373`).
pub(crate) fn retail_constraint_distances(position: WorldPosition) -> (f32, f32) {
    if position.is_indoors() {
        (5.0, 20.0)
    } else {
        (10.0, 50.0)
    }
}

/// Standalone arithmetic helper retained for differential fixtures and non-stateful callers.
pub(crate) fn damp_constraint_translation(
    mut translation: Vector3,
    accumulated_distance: f32,
    start_distance: f32,
    maximum_distance: f32,
) -> (Vector3, f32) {
    if accumulated_distance < maximum_distance {
        if accumulated_distance > start_distance {
            let denominator = maximum_distance - start_distance;
            if denominator > EPSILON {
                let scale = (maximum_distance - accumulated_distance) / denominator;
                translation = translation * scale.max(0.0);
            }
        }
    } else {
        translation = Vector3::zero();
    }
    (translation, accumulated_distance + translation.length())
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Guid;
    use holtburger_common::Quaternion;

    fn position(x: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(x, 0.0, 0.0),
            rotation: Quaternion::identity(),
        }
    }

    #[test]
    fn sequence_comparison_wraps_like_retail() {
        assert!(is_newer_sequence(1, u16::MAX));
        assert!(!is_newer_sequence(u16::MAX, 1));
        assert!(!is_newer_sequence(4, 4));
    }

    #[test]
    fn classification_covers_retail_disposition_ladder() {
        let update = |sequence, contact, distance| ServerPositionUpdate {
            pose: position(10.0),
            teleport_sequence: sequence,
            contact,
            distance,
            is_moving_to: false,
        };
        assert_eq!(
            classify_server_position(update(3, true, 10.0), 4, true),
            CorrectionDisposition::Ignored
        );
        assert_eq!(
            classify_server_position(update(5, false, 10.0), 4, true),
            CorrectionDisposition::HardSet
        );
        assert_eq!(
            classify_server_position(update(4, false, 10.0), 4, false),
            CorrectionDisposition::HardSet
        );
        assert_eq!(
            classify_server_position(update(4, false, 10.0), 4, true),
            CorrectionDisposition::Ignored
        );
        assert_eq!(
            classify_server_position(
                update(4, true, RETAIL_INTERPOLATION_SNAP_DISTANCE_M),
                4,
                true
            ),
            CorrectionDisposition::Snap
        );
        assert_eq!(
            classify_server_position(update(4, true, 10.0), 4, true),
            CorrectionDisposition::Interpolate {
                keep_heading: false
            }
        );
    }

    #[test]
    fn interpolation_uses_twice_motion_speed_and_fallback() {
        assert_eq!(retail_interpolated_speed(Some(4.0)), 8.0);
        assert_eq!(retail_interpolated_speed(Some(f32::NAN)), 7.5);
        assert_eq!(retail_interpolated_speed(None), 7.5);
        let mut correction = ServerCorrection::default();
        correction.interpolate_to(position(10.0), position(0.0), false);
        let step = correction
            .prepare_tick(position(0.0), true, Some(4.0), 1.0)
            .expect("interpolation should prepare a tick");
        assert_eq!(step.translation, Vector3::new(8.0, 0.0, 0.0));
    }

    #[test]
    fn correction_assigns_then_damps_and_preserves_heading_policy() {
        let mut correction = ServerCorrection::default();
        correction.constrain_to(position(-20.0), position(0.0));
        correction.interpolate_to(position(10.0), position(0.0), true);
        let step = correction
            .prepare_tick(position(0.0), true, None, 1.0)
            .expect("interpolation should prepare a tick");
        assert!(step.assigned);
        assert!(step.heading_pinned);
        assert_eq!(step.translation, Vector3::new(5.625, 0.0, 0.0));
    }

    #[test]
    fn stalled_nodes_snap_after_four_failed_watchdog_windows() {
        let mut correction = ServerCorrection::default();
        correction.interpolate_to(position(10.0), position(0.0), false);
        let mut snap = None;
        for _ in 0..20 {
            let step = correction
                .prepare_tick(position(0.0), true, Some(1.0), 0.03)
                .expect("active correction should retain a step");
            snap = step.snap_to;
            if snap.is_some() {
                break;
            }
        }
        assert_eq!(snap, Some(position(10.0)));
    }

    #[test]
    fn airborne_interpolation_waits_but_constraint_accumulates() {
        let mut correction = ServerCorrection::default();
        correction.constrain_to(position(-10.0), position(0.0));
        correction.interpolate_to(position(1.0), position(0.0), false);
        let override_result =
            correction.apply_to_composed_translation(Vector3::new(1.0, 0.0, 0.0), false);
        assert_eq!(override_result.translation, Vector3::new(1.0, 0.0, 0.0));
    }

    #[test]
    fn standalone_constraint_damping_uses_post_damping_distance() {
        let (damped, accumulated) =
            damp_constraint_translation(Vector3::new(2.0, 0.0, 0.0), 5.0, 3.0, 7.0);
        assert_eq!(damped, Vector3::new(1.0, 0.0, 0.0));
        assert_eq!(accumulated, 6.0);
    }
}
