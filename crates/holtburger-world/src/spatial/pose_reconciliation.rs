//! Actor-neutral authoritative-pose reconciliation composed inside a body's spatial tick.
//!
//! Retail orders these mechanics after ordinary motion has produced an offset:
//! `InterpolationManager::adjust_offset` may replace translation, then
//! `ConstraintManager::adjust_offset` damps the survivor (`acclient.c:371277-371292`). Authority
//! adapters decide whether a received pose confirms, interpolates, snaps, or resets; this module
//! only executes the selected spatial mechanics.

use super::ContactState;
use holtburger_common::Vector3;
use holtburger_common::position::WorldPosition;

/// Distance below which retail completes an interpolation node (`acclient.c:372039-372045`).
pub const RETAIL_INTERPOLATION_TARGET_THRESHOLD_M: f32 = 0.05;
/// Generic remote distance at which retail directly places instead of interpolating
/// (`acclient.c:311507-311521`).
pub const RETAIL_INTERPOLATION_SNAP_DISTANCE_M: f32 = 96.0;
/// Fallback cap when no motion interpreter supplies an adjusted speed
/// (`acclient.c:372048-372064`).
pub const RETAIL_MAX_INTERPOLATED_VELOCITY_MPS: f32 = 7.5;
/// A stalled target closer than this completes rather than failing (`acclient.c:372093-372097`).
pub const RETAIL_INTERPOLATION_NEAR_COMPLETE_DISTANCE_M: f32 = 0.2;
const RETAIL_INTERPOLATION_WATCHDOG_FRAMES: u8 = 5;
const RETAIL_WATCHDOG_PROGRESS_RATIO: f32 = 0.3;
const EPSILON: f32 = 0.000_2;

/// Why an authoritative pose establishes a new runtime-placement epoch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthoritativePoseResetCause {
    /// A received teleport sequence superseded the body's current epoch.
    Teleport,
    /// A force-position sequence explicitly invalidated the current runtime placement.
    ForcedReposition,
    /// World suspension or replacement invalidated every retained temporal fact.
    WorldReset,
    /// A valid received pose recovered an actor whose prior cell was unavailable.
    MissingCellRecovery,
}

/// One authority adapter's complete decision for an authoritative pose sample.
///
/// The selected variant carries the pose so scene consumers cannot pair a classified effect with
/// a different authoritative sample. Local and remote adapters choose the variant once; spatial
/// code executes it without re-deriving policy from body identity or update timing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum AuthoritativePoseEffect {
    /// Seed a body with no runtime timeline and discard any stale reconciliation allocation.
    Initialize {
        /// Authoritative pose installed as both authority and runtime placement.
        pose: WorldPosition,
    },
    /// Record authority and re-arm confirmed-travel damping without replacing runtime placement.
    Confirm {
        /// Latest producer-authoritative pose used to measure confirmed travel.
        pose: WorldPosition,
    },
    /// Record authority and replace the active interpolation target.
    Interpolate {
        /// Latest producer-authoritative pose used as the interpolation target.
        pose: WorldPosition,
        /// Whether authored heading survives while interpolation owns translation.
        keep_heading: bool,
        /// Motion-owner result consumed without re-deriving playback state in spatial code.
        adjusted_max_speed_mps: Option<f32>,
    },
    /// Record authority and schedule an ordinary far correction for the next fixed tick.
    Snap {
        /// Producer-authoritative pose installed at the fixed-tick boundary.
        pose: WorldPosition,
    },
    /// Establish a discontinuous authority epoch and install its pose immediately.
    Reset {
        /// Producer-authoritative pose that begins the new runtime epoch.
        pose: WorldPosition,
        /// Named lifecycle reason consumed by world and presentation routing.
        cause: AuthoritativePoseResetCause,
    },
}

impl AuthoritativePoseEffect {
    /// Returns the authoritative sample carried by this already-classified effect.
    pub const fn pose(self) -> WorldPosition {
        match self {
            Self::Initialize { pose }
            | Self::Confirm { pose }
            | Self::Interpolate { pose, .. }
            | Self::Snap { pose }
            | Self::Reset { pose, .. } => pose,
        }
    }

    /// Rebuilds this effect with a validated pose while preserving its classified consequence.
    pub const fn with_pose(self, pose: WorldPosition) -> Self {
        match self {
            Self::Initialize { .. } => Self::Initialize { pose },
            Self::Confirm { .. } => Self::Confirm { pose },
            Self::Interpolate {
                keep_heading,
                adjusted_max_speed_mps,
                ..
            } => Self::Interpolate {
                pose,
                keep_heading,
                adjusted_max_speed_mps,
            },
            Self::Snap { .. } => Self::Snap { pose },
            Self::Reset { cause, .. } => Self::Reset { pose, cause },
        }
    }
}

/// Which translation source survived reconciliation for this tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PoseTranslationSource {
    /// The actor adapter's ordinary input, authored motion, or retained velocity survived.
    Ordinary,
    /// Interpolation replaced ordinary translation with movement toward the authoritative target.
    Interpolation,
}

/// One reconciliation result consumed by physical and pose-only body advancement.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PoseReconciliationComposition {
    /// Translation after interpolation replacement and confirmed-travel damping.
    pub translation: Vector3,
    /// Named owner of the translation, so callers never infer ownership from nonzero movement.
    pub source: PoseTranslationSource,
    /// Whether an active MoveTo requires the body's current heading to survive interpolation.
    pub keep_heading: bool,
}

/// One replacing interpolation target retained for the measured ACE update distribution.
///
/// RETAIL DIVERGENCE: retail queues up to 20 ordinary near targets
/// (`acclient.c:371885-371959`). Replacing the target can skip intermediate turns during burst or
/// stalled traffic. The 2026-08-28 census observed 190-217 ms packet intervals and corrections no
/// larger than 0.618 m, which converge within 82.4 ms at retail's 7.5 m/s fallback.
#[derive(Debug, Clone, Copy, PartialEq)]
struct InterpolationTarget {
    /// Latest producer-authoritative destination consumed by interpolation and watchdog snap.
    pose: WorldPosition,
    /// Heading policy returned while this target owns translation.
    keep_heading: bool,
    /// Retail motion-interpreter speed captured when this target was admitted.
    adjusted_max_speed_mps: Option<f32>,
    /// Distance at the start of the current watchdog window.
    original_distance: f32,
    /// Simulated time accumulated in the current watchdog window.
    progress_quantum: f32,
    /// Contacted interpolation ticks accumulated before the watchdog evaluates progress.
    frame_counter: u8,
}

impl InterpolationTarget {
    fn new(
        pose: WorldPosition,
        current: WorldPosition,
        keep_heading: bool,
        adjusted_max_speed_mps: Option<f32>,
    ) -> Self {
        Self {
            pose,
            keep_heading,
            adjusted_max_speed_mps,
            original_distance: current.distance_to(&pose),
            progress_quantum: 0.0,
            frame_counter: 0,
        }
    }
}

/// Confirmed-travel budget applied after interpolation chooses the tick translation.
#[derive(Debug, Clone, Copy, PartialEq)]
struct ConfirmedTravelConstraint {
    /// Admitted post-composition travel since the latest confirmation.
    accumulated_distance: f32,
    /// Distance budget below which translation survives without damping.
    start_distance: f32,
    /// Distance budget at which contacted translation is fully suppressed.
    maximum_distance: f32,
}

/// Body-owned temporal state for authoritative pose reconciliation.
///
/// The interpolation target and confirmed-travel constraint transition together on every received
/// pose effect. A reset clears the complete composite, preventing temporal state from crossing an
/// authority discontinuity.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct PoseReconciliationState {
    /// Target that may replace ordinary translation while contacted.
    interpolation: Option<InterpolationTarget>,
    /// Confirmation budget that modifies whichever translation basis survives.
    constraint: Option<ConfirmedTravelConstraint>,
    /// Ordinary far correction retained until the next fixed body tick installs it.
    pending_snap: Option<WorldPosition>,
    /// Whether the admitted position sample proved contact for a pose-only interpolation path.
    ///
    /// Physical bodies ignore this wire evidence and use their locally solved contact instead.
    received_contact: bool,
}

impl PoseReconciliationState {
    /// Clears every temporal fact at an initialization or authority discontinuity.
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Applies a confirmation without granting interpolation ownership of translation.
    pub fn confirm(&mut self, confirmed: WorldPosition, current: WorldPosition) {
        self.interpolation = None;
        self.pending_snap = None;
        self.received_contact = false;
        self.constraint = Some(confirmed_travel_constraint(confirmed, current));
    }

    /// Applies an admitted near target and re-arms its confirmed-travel constraint atomically.
    pub fn interpolate(
        &mut self,
        target: WorldPosition,
        current: WorldPosition,
        keep_heading: bool,
        adjusted_max_speed_mps: Option<f32>,
    ) {
        self.constraint = Some(confirmed_travel_constraint(target, current));
        self.interpolation = Some(InterpolationTarget::new(
            target,
            current,
            keep_heading,
            adjusted_max_speed_mps,
        ));
        self.pending_snap = None;
        self.received_contact = true;
    }

    /// Retains an ordinary correction snap for fixed-tick installation.
    pub fn schedule_snap(&mut self, target: WorldPosition) {
        self.interpolation = None;
        self.constraint = None;
        self.pending_snap = Some(target);
        self.received_contact = false;
    }

    /// Takes the ordinary snap exactly once at the body tick boundary.
    pub fn take_pending_snap(&mut self) -> Option<WorldPosition> {
        self.pending_snap.take()
    }

    /// Whether this state can produce displacement without an ordinary actor basis.
    pub fn has_projection_work(&self) -> bool {
        self.interpolation.is_some() || self.pending_snap.is_some()
    }

    /// Whether no reconciliation fact remains and the body may release its optional allocation.
    pub fn is_empty(&self) -> bool {
        self.interpolation.is_none() && self.constraint.is_none() && self.pending_snap.is_none()
    }

    /// Composes one ordinary translation through retail's interpolation-then-constraint order.
    pub fn compose_translation(
        &mut self,
        current: WorldPosition,
        contact: ContactState,
        ordinary_translation: Vector3,
        quantum: f32,
    ) -> PoseReconciliationComposition {
        self.compose_translation_with_contact(
            current,
            has_physical_contact(contact),
            ordinary_translation,
            quantum,
        )
    }

    /// Composes a pose-only tick using contact evidence retained from the admitted wire sample.
    ///
    /// A pose-only body has no solver capable of producing [`ContactState`]. Keeping this evidence
    /// inside reconciliation prevents a protocol contact bit from masquerading as locally solved
    /// `Sliding` state merely to reach interpolation's contact gate.
    pub fn compose_pose_only_translation(
        &mut self,
        current: WorldPosition,
        ordinary_translation: Vector3,
        quantum: f32,
    ) -> PoseReconciliationComposition {
        self.compose_translation_with_contact(
            current,
            self.received_contact,
            ordinary_translation,
            quantum,
        )
    }

    fn compose_translation_with_contact(
        &mut self,
        current: WorldPosition,
        has_contact: bool,
        ordinary_translation: Vector3,
        quantum: f32,
    ) -> PoseReconciliationComposition {
        let interpolation = self.interpolation_translation(current, has_contact, quantum);
        let (translation, source, keep_heading) = match interpolation {
            Some((translation, keep_heading)) => (
                translation,
                PoseTranslationSource::Interpolation,
                keep_heading,
            ),
            None => (ordinary_translation, PoseTranslationSource::Ordinary, false),
        };
        PoseReconciliationComposition {
            translation: self.constrain_translation(translation, has_contact),
            source,
            keep_heading,
        }
    }

    fn interpolation_translation(
        &mut self,
        current: WorldPosition,
        has_contact: bool,
        quantum: f32,
    ) -> Option<(Vector3, bool)> {
        let mut target = self.interpolation?;
        if !has_contact {
            return None;
        }

        let to_target = target.pose.global_coords() - current.global_coords();
        let distance = to_target.length();
        if !distance.is_finite() || distance < RETAIL_INTERPOLATION_TARGET_THRESHOLD_M {
            self.interpolation = None;
            return None;
        }

        let rate = retail_interpolated_speed(target.adjusted_max_speed_mps);
        let quantum = quantum.max(0.0);
        target.frame_counter = target.frame_counter.saturating_add(1);
        target.progress_quantum += quantum;

        if target.frame_counter >= RETAIL_INTERPOLATION_WATCHDOG_FRAMES {
            let progress = target.original_distance - distance;
            let progressing = progress >= EPSILON
                && target.progress_quantum > EPSILON
                && progress / target.progress_quantum / rate >= RETAIL_WATCHDOG_PROGRESS_RATIO;
            if !progressing {
                if distance < RETAIL_INTERPOLATION_NEAR_COMPLETE_DISTANCE_M {
                    self.interpolation = None;
                    return None;
                }
                // `NodeCompleted(false)` removes the failed head. With this component's measured
                // one-target history there is no successor, so retail `UseTime` installs the
                // retained blip immediately (`acclient.c:371736-371832,372070-372097`).
                self.schedule_snap(target.pose);
                return None;
            }
            target.frame_counter = 0;
            target.progress_quantum = 0.0;
            target.original_distance = distance;
        }

        let cap = rate * quantum;
        let translation = if distance > cap && distance > EPSILON {
            to_target * (cap / distance)
        } else {
            to_target
        };
        self.interpolation = Some(target);
        Some((translation, target.keep_heading))
    }

    fn constrain_translation(&mut self, translation: Vector3, has_contact: bool) -> Vector3 {
        let Some(constraint) = self.constraint.as_mut() else {
            return translation;
        };
        let (translation, accumulated_distance) = if has_contact {
            damp_constraint_translation(
                translation,
                constraint.accumulated_distance,
                constraint.start_distance,
                constraint.maximum_distance,
            )
        } else {
            (
                translation,
                constraint.accumulated_distance + translation.length(),
            )
        };
        constraint.accumulated_distance = accumulated_distance;
        translation
    }
}

/// Retail's interpolation speed cap: twice the motion interpreter's adjusted maximum speed.
pub fn retail_interpolated_speed(adjusted_max_speed_mps: Option<f32>) -> f32 {
    adjusted_max_speed_mps
        .map(|speed| speed * 2.0)
        .filter(|speed| speed.is_finite() && *speed >= EPSILON)
        .unwrap_or(RETAIL_MAX_INTERPOLATED_VELOCITY_MPS)
}

fn has_physical_contact(contact: ContactState) -> bool {
    matches!(contact, ContactState::Sliding | ContactState::Grounded)
}

fn confirmed_travel_constraint(
    confirmed: WorldPosition,
    current: WorldPosition,
) -> ConfirmedTravelConstraint {
    let (start_distance, maximum_distance) = retail_constraint_distances(confirmed);
    ConfirmedTravelConstraint {
        accumulated_distance: current.distance_to(&confirmed),
        start_distance,
        maximum_distance,
    }
}

/// Retail's local-player confirmed-travel thresholds for indoor and outdoor cells
/// (`acclient.c:304336-304373`).
pub fn retail_constraint_distances(position: WorldPosition) -> (f32, f32) {
    if position.is_indoors() {
        (5.0, 20.0)
    } else {
        (10.0, 50.0)
    }
}

/// Applies the contact-gated constraint scale and returns post-damping accumulated travel.
pub fn damp_constraint_translation(
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
    use holtburger_common::{Guid, Quaternion};

    fn position(x: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(x, 0.0, 0.0),
            rotation: Quaternion::identity(),
        }
    }

    #[test]
    fn confirmation_preserves_ordinary_translation_below_free_distance() {
        let mut state = PoseReconciliationState::default();
        state.confirm(position(0.0), position(1.0));
        let composed = state.compose_translation(
            position(1.0),
            ContactState::Grounded,
            Vector3::new(2.0, 0.0, 0.0),
            0.03,
        );
        assert_eq!(composed.source, PoseTranslationSource::Ordinary);
        assert_eq!(composed.translation, Vector3::new(2.0, 0.0, 0.0));
    }

    #[test]
    fn confirmation_above_free_distance_dampens_without_owning_translation() {
        let mut state = PoseReconciliationState::default();
        state.confirm(position(-20.0), position(0.0));
        let composed = state.compose_translation(
            position(0.0),
            ContactState::Grounded,
            Vector3::new(2.0, 0.0, 0.0),
            0.03,
        );
        assert_eq!(composed.source, PoseTranslationSource::Ordinary);
        assert_eq!(composed.translation, Vector3::new(1.5, 0.0, 0.0));
    }

    #[test]
    fn interpolation_replaces_ordinary_translation_then_constraint_damps() {
        let mut state = PoseReconciliationState::default();
        state.interpolate(position(-20.0), position(0.0), true, None);
        let composed = state.compose_translation(
            position(0.0),
            ContactState::Sliding,
            Vector3::new(0.0, 3.0, 0.0),
            1.0,
        );
        assert_eq!(composed.source, PoseTranslationSource::Interpolation);
        assert!(composed.keep_heading);
        assert_eq!(composed.translation, Vector3::new(-5.625, 0.0, 0.0));
    }

    #[test]
    fn newer_target_replaces_and_can_reverse_an_active_interpolation() {
        let mut state = PoseReconciliationState::default();
        state.interpolate(position(10.0), position(0.0), false, None);
        let forward =
            state.compose_translation(position(0.0), ContactState::Grounded, Vector3::zero(), 0.03);
        assert!(forward.translation.x > 0.0);

        state.interpolate(position(-10.0), position(0.0), false, None);
        let reversed =
            state.compose_translation(position(0.0), ContactState::Grounded, Vector3::zero(), 0.03);
        assert!(reversed.translation.x < 0.0);
    }

    #[test]
    fn interpolation_delta_is_landblock_aware() {
        let current = WorldPosition {
            landblock_id: Guid(0x0101_0001),
            coords: Vector3::new(191.0, 20.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let target = WorldPosition {
            landblock_id: Guid(0x0201_0001),
            coords: Vector3::new(1.0, 20.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let mut state = PoseReconciliationState::default();
        state.interpolate(target, current, false, None);
        let composed =
            state.compose_translation(current, ContactState::Grounded, Vector3::zero(), 1.0);
        assert_eq!(composed.translation, Vector3::new(2.0, 0.0, 0.0));
    }

    #[test]
    fn airborne_and_unknown_do_not_damp_but_accumulate_travel() {
        for contact in [ContactState::Airborne, ContactState::Unknown] {
            let mut state = PoseReconciliationState::default();
            state.confirm(position(-10.0), position(0.0));
            let first = state.compose_translation(
                position(0.0),
                contact,
                Vector3::new(2.0, 0.0, 0.0),
                0.03,
            );
            assert_eq!(first.translation, Vector3::new(2.0, 0.0, 0.0));
            let grounded = state.compose_translation(
                position(2.0),
                ContactState::Grounded,
                Vector3::new(2.0, 0.0, 0.0),
                0.03,
            );
            assert_eq!(grounded.translation, Vector3::new(1.9, 0.0, 0.0));
        }
    }

    #[test]
    fn stalled_interpolation_schedules_snap_after_one_failed_target() {
        let mut state = PoseReconciliationState::default();
        state.interpolate(position(10.0), position(0.0), false, Some(1.0));
        for _ in 0..5 {
            let _ = state.compose_translation(
                position(0.0),
                ContactState::Grounded,
                Vector3::zero(),
                0.03,
            );
        }
        assert_eq!(state.take_pending_snap(), Some(position(10.0)));
        assert_eq!(state.take_pending_snap(), None);
    }

    #[test]
    fn speed_uses_twice_adjusted_motion_rate_and_retail_fallback() {
        assert_eq!(retail_interpolated_speed(Some(4.0)), 8.0);
        assert_eq!(retail_interpolated_speed(Some(f32::NAN)), 7.5);
        assert_eq!(retail_interpolated_speed(None), 7.5);
    }
}
