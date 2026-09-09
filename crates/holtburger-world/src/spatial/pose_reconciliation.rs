//! Actor-neutral authoritative-pose reconciliation composed inside a body's spatial tick.
//!
//! Retail orders these mechanics after ordinary motion has produced an offset:
//! `InterpolationManager::adjust_offset` may replace translation, then
//! `ConstraintManager::adjust_offset` damps the survivor (`acclient.c:371277-371292`). Authority
//! adapters decide whether a received pose confirms, interpolates, snaps, or resets; this module
//! only executes the selected spatial mechanics. Mobile physical bodies instead compose bounded
//! additive correction with ordinary motion and let collision determine accepted progress.

pub(super) mod recovery;

use super::ContactState;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};

/// Coordinates a physical return motor can correct; steering and completion share this domain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalReferenceDomain {
    /// RETAIL DIVERGENCE: retail tests full target distance (acclient.c:372039-372045).
    /// Grounded navigation owns height; restoring 3D completion leaves the two-step round-trip
    /// fixture correcting forever after a 0.6 m ascent. A different solid floor at the same XY
    /// is deliberately not repaired. The asset-free stair/slope cases cover the known failure;
    /// no census of multilevel placements has been performed.
    Horizontal,
    /// Free-flight return can correct all three coordinates.
    Spatial,
}

impl PhysicalReferenceDomain {
    /// Derives motor authority from the installed response, not its current grounded/falling pose.
    pub(crate) fn for_definition(definition: super::PhysicalBodyDefinition) -> Self {
        match definition {
            super::PhysicalBodyDefinition::Grounded { .. } => Self::Horizontal,
            _ => Self::Spatial,
        }
    }

    /// Keeps the position type's local-coordinate precision when measuring completion.
    fn distance(self, mut first: WorldPosition, mut second: WorldPosition) -> f32 {
        first.coords = self.project(first.coords);
        second.coords = self.project(second.coords);
        first.distance_to(&second)
    }

    /// Restricts a displacement or relative velocity to coordinates controlled by the motor.
    pub(crate) fn project(self, delta: Vector3) -> Vector3 {
        match self {
            Self::Horizontal => Vector3::new(delta.x, delta.y, 0.0),
            Self::Spatial => delta,
        }
    }
}

/// Distance below which retail completes an interpolation node (`acclient.c:372039-372045`).
pub const RETAIL_INTERPOLATION_TARGET_THRESHOLD_M: f32 = 0.05;
/// Remote supported characters ignore positional error until it exceeds this distance.
pub const PHYSICAL_RETURN_START_THRESHOLD_M: f32 = 0.20;
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
        /// Producer-authoritative target: mobile bodies correct through collision; pose-only bodies place.
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

/// One moving reference, separate from the body's canonical collision/presentation pose.
///
/// RETAIL DIVERGENCE: explicitly requested local displacement replaces physical interpolation
/// takeover and failed-node placement (`acclient.c:371277-371292,372070-372097,371736-371832`).
/// Restoring placement would move correcting mobs through the player. The synthetic 200-tick
/// blocked-return case covers repeated packets and later release; admission covers mobile
/// grounded and free-sphere bodies, while fixed-position/pose-only projection stays separate.
/// This changes client collision positions intentionally; server gameplay remains authoritative.
#[derive(Debug, Clone, Copy, PartialEq)]
struct PhysicalCorrection {
    /// Accepted-progress watchdog; survives equivalent authority updates.
    recovery: Option<recovery::RecoveryObservation>,
    /// Whether this reference is continuously corrected or uses supported-character hysteresis.
    activity: PhysicalReturnActivity,
    /// Reference position in its original landblock frame; it need not be a placed body.
    reference: WorldPosition,
    /// Fresh authority facing, consumed by one accepted physical tick independently
    /// of position return. Later ordinary turning must not replay this old facing.
    pending_heading: Option<holtburger_common::Quaternion>,
}

/// Positional work is independent of retaining a reference and pending authority heading.
#[derive(Debug, Clone, Copy, PartialEq)]
enum PhysicalReturnActivity {
    /// Existing flight/passive correction without a positional start band.
    Continuous,
    /// Preserve ordinary prediction and accumulated error without driving return.
    Watching,
    /// Return until position and relative velocity satisfy the completion band.
    Returning,
}

impl PhysicalCorrection {
    /// Measures same-instant error in the body's frame, then advances only nominal travel.
    fn advance_reference(
        &mut self,
        current: WorldPosition,
        ordinary: Vector3,
    ) -> anyhow::Result<Vector3> {
        let anchor = Guid(current.landblock_id.0 | 0xffff);
        let error = self.reference.reanchor_to_landblock_owner(anchor)?.coords - current.coords;
        self.reference.coords = self.reference.coords + ordinary;
        Ok(error)
    }
}

/// Reconciliation policy selected once at the physical/pose-only admission boundary.
/// Remote physical correction never inherits the local player's confirmed-travel budget.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct PoseReconciliationState {
    /// Mutually exclusive correction implementations; reset replaces the whole mode.
    mode: ReconciliationMode,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
enum ReconciliationMode {
    /// No pending reconciliation work or confirmation budget.
    #[default]
    Empty,
    /// Existing confirmation and pose-only retail projection mechanics.
    Retail(RetailPoseReconciliationState),
    /// Collision-respecting correction for a mobile physical body.
    Physical(PhysicalCorrection),
}

impl PoseReconciliationState {
    /// Discards all temporal state at an authority discontinuity.
    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Preserves the local player's confirmed-travel behavior.
    pub fn confirm(&mut self, confirmed: WorldPosition, current: WorldPosition) {
        let mut state = RetailPoseReconciliationState::default();
        state.confirm(confirmed, current);
        self.mode = ReconciliationMode::Retail(state);
    }

    /// Installs the existing pose-only interpolation policy.
    pub fn interpolate(
        &mut self,
        target: WorldPosition,
        current: WorldPosition,
        keep_heading: bool,
        adjusted_max_speed_mps: Option<f32>,
    ) {
        let mut state = RetailPoseReconciliationState::default();
        state.interpolate(target, current, keep_heading, adjusted_max_speed_mps);
        self.mode = ReconciliationMode::Retail(state);
    }

    /// Replaces only the reference when authority updates a mobile physical body.
    pub(crate) fn correct(&mut self, reference: WorldPosition, keep_heading: bool) {
        let activity = match self.mode {
            ReconciliationMode::Physical(target) => target.activity,
            _ => PhysicalReturnActivity::Continuous,
        };
        let recovery = match self.mode {
            ReconciliationMode::Physical(target) => target.recovery,
            _ => None,
        };
        self.mode = ReconciliationMode::Physical(PhysicalCorrection {
            recovery,
            activity,
            reference,
            pending_heading: (!keep_heading).then_some(reference.rotation),
        });
    }

    /// Captures the nominal origin before a remote mobile can receive contact displacement.
    /// Existing authority targets survive subsequent contact; local confirmation and pose-only
    /// interpolation must be classified by the caller instead of being silently overwritten.
    pub(crate) fn begin_contact_return(&mut self, current: WorldPosition) -> anyhow::Result<()> {
        match self.mode {
            ReconciliationMode::Empty => self.correct(current, true),
            ReconciliationMode::Physical(_) => {}
            ReconciliationMode::Retail(_) => {
                anyhow::bail!(
                    "contact return cannot replace local confirmation or pose-only reconciliation"
                );
            }
        }
        Ok(())
    }

    /// Reclassifies pending remote work when physics is installed or removed. A confirmation
    /// without a remote target keeps its local-player travel budget across that change.
    pub(crate) fn set_mobile_physical(&mut self, mobile: bool, current: WorldPosition) {
        match self.mode {
            ReconciliationMode::Retail(state) if mobile => {
                if let Some(target) = state.interpolation {
                    self.correct(target.pose, target.keep_heading);
                } else if let Some(target) = state.pending_snap {
                    self.correct(target, false);
                }
            }
            ReconciliationMode::Physical(target) if !mobile => {
                let mut reference = target.reference;
                if let Some(heading) = target.pending_heading {
                    reference.rotation = heading;
                }
                // A role change must not resurrect a heading already consumed by physics.
                self.interpolate(reference, current, target.pending_heading.is_none(), None);
            }
            _ => {}
        }
    }

    /// Independent reference position and admitted authority heading. Only free flight evolves
    /// this orientation as a nominal movement frame; grounded travel uses the prepared source frame.
    pub(crate) fn physical_reference(&self) -> anyhow::Result<WorldPosition> {
        match self.mode {
            ReconciliationMode::Physical(target) => Ok(target.reference),
            _ => anyhow::bail!("physical reference requested outside physical reconciliation"),
        }
    }

    /// Initial source playback may precede the first physical admission of an authority heading.
    /// Existing source timelines consume pose events directly and never poll this pending value.
    pub(crate) fn pending_correction_heading(&self) -> Option<holtburger_common::Quaternion> {
        match self.mode {
            ReconciliationMode::Physical(target) => target.pending_heading,
            _ => None,
        }
    }

    /// Takes fresh authority facing once; ordinary turning owns subsequent ticks even
    /// while position return remains active. This mutates the transaction's working
    /// correction state, so a rejected transaction does not consume the update.
    pub(crate) fn take_correction_heading(&mut self) -> Option<holtburger_common::Quaternion> {
        match &mut self.mode {
            ReconciliationMode::Physical(target) => target.pending_heading.take(),
            _ => None,
        }
    }

    /// Whether ordinary physical motion must advance a retained reference this tick.
    pub(crate) fn has_physical_correction(&self) -> bool {
        matches!(self.mode, ReconciliationMode::Physical(_))
    }

    /// Advances a physical reference from independent nominal travel and returns pre-step error.
    /// The response adapter consumes the error; callers must not add it directly to the body's pose.
    /// Translation is world-aligned, so it does not inherit the physical body's corrected heading.
    pub fn advance_return_reference(
        &mut self,
        current: WorldPosition,
        ordinary: Vector3,
    ) -> anyhow::Result<Vector3> {
        match &mut self.mode {
            ReconciliationMode::Physical(target) => target.advance_reference(current, ordinary),
            _ => anyhow::bail!("return advancement requires a physical reference"),
        }
    }

    /// Select positional return without dropping a dormant reference or an authority heading.
    /// Called on the transaction copy after current support and ordinary error are resolved.
    pub(crate) fn select_return_error(&mut self, error: Vector3, hysteresis: bool) -> Vector3 {
        let ReconciliationMode::Physical(target) = &mut self.mode else {
            unreachable!("return selection requires an admitted physical reference");
        };
        target.activity = match (hysteresis, target.activity) {
            (false, _) => PhysicalReturnActivity::Continuous,
            (true, PhysicalReturnActivity::Returning) => PhysicalReturnActivity::Returning,
            (true, _) if error.length() > PHYSICAL_RETURN_START_THRESHOLD_M => {
                PhysicalReturnActivity::Returning
            }
            (true, _) => PhysicalReturnActivity::Watching,
        };
        if target.activity == PhysicalReturnActivity::Watching {
            Vector3::zero()
        } else {
            error
        }
    }

    /// Advances free-flight nominal orientation. Grounded authority heading stays an admitted
    /// target and is never advanced by ordinary body turning.
    pub(crate) fn advance_flight_reference_heading(
        &mut self,
        rotation: holtburger_common::Quaternion,
    ) {
        if let ReconciliationMode::Physical(target) = &mut self.mode {
            target.reference.rotation = rotation;
        }
    }

    /// Settle return after accepted position and relative velocity enter the completion band.
    /// Relative velocity is actual continuation minus independent nominal continuation, never a
    /// derivative of geometric separation. Supported hysteresis retains a dormant reference;
    /// continuous correction releases it. Proximity alone cannot retire a still-braking motor.
    pub fn finish_physical_tick(
        &mut self,
        accepted: WorldPosition,
        relative_velocity: Vector3,
        domain: PhysicalReferenceDomain,
    ) {
        if let ReconciliationMode::Physical(target) = &mut self.mode {
            let distance = domain.distance(target.reference, accepted);
            let settled = distance <= RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
                && domain.project(relative_velocity).length()
                    <= super::PHYSICAL_RETURN_GAIN * RETAIL_INTERPOLATION_TARGET_THRESHOLD_M;
            match target.activity {
                PhysicalReturnActivity::Continuous if settled => {
                    self.mode = ReconciliationMode::Empty
                }
                PhysicalReturnActivity::Returning if settled => {
                    target.activity = PhysicalReturnActivity::Watching;
                }
                // Sleeping bodies still publish contact displacement. Crossing the start band
                // wakes return on the next tick without forgetting earlier small displacements.
                PhysicalReturnActivity::Watching
                    if distance > PHYSICAL_RETURN_START_THRESHOLD_M =>
                {
                    target.activity = PhysicalReturnActivity::Returning;
                }
                _ => {}
            }
        }
    }

    /// Schedules placement only for pose-only consumers.
    pub fn schedule_snap(&mut self, target: WorldPosition) {
        let mut state = RetailPoseReconciliationState::default();
        state.schedule_snap(target);
        self.mode = ReconciliationMode::Retail(state);
    }

    /// Takes a pose-only placement once at the tick boundary.
    pub fn take_pending_snap(&mut self) -> Option<WorldPosition> {
        match &mut self.mode {
            ReconciliationMode::Retail(state) => state.take_pending_snap(),
            _ => None,
        }
    }

    /// Pending movement work keeps a blocked correction eligible for a later tick.
    pub fn has_projection_work(&self) -> bool {
        match self.mode {
            ReconciliationMode::Empty => false,
            ReconciliationMode::Retail(state) => state.has_projection_work(),
            ReconciliationMode::Physical(target) => {
                target.activity != PhysicalReturnActivity::Watching
                    || target.pending_heading.is_some()
            }
        }
    }

    /// Whether the owner can release its reconciliation allocation.
    pub fn is_empty(&self) -> bool {
        match self.mode {
            ReconciliationMode::Empty => true,
            ReconciliationMode::Retail(state) => state.is_empty(),
            ReconciliationMode::Physical(_) => false,
        }
    }

    /// Applies confirmation damping; physical correction is composed after ordinary prediction.
    pub fn compose_translation(
        &mut self,
        current: WorldPosition,
        contact: ContactState,
        ordinary_translation: Vector3,
        quantum: f32,
    ) -> PoseReconciliationComposition {
        match &mut self.mode {
            ReconciliationMode::Retail(state) => {
                state.compose_translation(current, contact, ordinary_translation, quantum)
            }
            _ => PoseReconciliationComposition {
                translation: ordinary_translation,
                source: PoseTranslationSource::Ordinary,
                keep_heading: false,
            },
        }
    }

    /// Executes pose-only interpolation using its received contact evidence.
    pub fn compose_pose_only_translation(
        &mut self,
        current: WorldPosition,
        ordinary_translation: Vector3,
        quantum: f32,
    ) -> PoseReconciliationComposition {
        match &mut self.mode {
            ReconciliationMode::Retail(state) => {
                state.compose_pose_only_translation(current, ordinary_translation, quantum)
            }
            ReconciliationMode::Empty => PoseReconciliationComposition {
                translation: ordinary_translation,
                source: PoseTranslationSource::Ordinary,
                keep_heading: false,
            },
            ReconciliationMode::Physical(_) => {
                panic!("physical correction requires a collision solve")
            }
        }
    }
}

/// Body-owned temporal state for authoritative pose reconciliation.
///
/// The interpolation target and confirmed-travel constraint transition together on every received
/// pose effect. A reset clears the complete composite, preventing temporal state from crossing an
/// authority discontinuity.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct RetailPoseReconciliationState {
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

impl RetailPoseReconciliationState {
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
    fn supported_hysteresis_preserves_reference_and_heading_across_small_updates() {
        let mut state = PoseReconciliationState::default();
        let origin = position(0.0);
        state.correct(origin, true);
        let small = PHYSICAL_RETURN_START_THRESHOLD_M * 0.5;
        assert_eq!(
            state.select_return_error(Vector3::new(small, 0.0, 0.0), true),
            Vector3::zero()
        );
        assert!(!state.has_projection_work());
        assert!(!state.is_empty());
        // Accepted small displacements accumulate against the original reference even asleep.
        state.finish_physical_tick(
            position(small),
            Vector3::zero(),
            PhysicalReferenceDomain::Horizontal,
        );
        assert!(!state.has_projection_work());
        state.finish_physical_tick(
            position(PHYSICAL_RETURN_START_THRESHOLD_M * 1.5),
            Vector3::zero(),
            PhysicalReferenceDomain::Horizontal,
        );
        assert!(state.has_projection_work());
        // Once returning, a fresh packet inside the start band cannot stop the return early.
        let target = position(small);
        state.correct(target, false);
        let error = state
            .advance_return_reference(origin, Vector3::zero())
            .unwrap();
        assert_eq!(state.select_return_error(error, true), error);
        assert_eq!(state.take_correction_heading(), Some(target.rotation));
        assert_eq!(state.take_correction_heading(), None);
        state.finish_physical_tick(target, Vector3::zero(), PhysicalReferenceDomain::Horizontal);
        assert!(!state.has_projection_work());
        assert_eq!(state.physical_reference().unwrap(), target);
        // Heading alone wakes its one-shot consumption, not positional return.
        state.correct(target, false);
        assert!(state.has_projection_work());
        assert_eq!(
            state.select_return_error(Vector3::zero(), true),
            Vector3::zero()
        );
        state.take_correction_heading();
        assert!(!state.has_projection_work());
        // Flight resumes the preexisting continuous correction policy.
        assert_eq!(
            state.select_return_error(Vector3::new(small, 0.0, 0.0), false),
            Vector3::new(small, 0.0, 0.0)
        );
        assert!(state.has_projection_work());
    }

    #[test]
    fn authority_heading_lifetime_survives_physical_role_changes() {
        for consumed in [false, true] {
            let mut state = PoseReconciliationState::default();
            let mut target = position(10.0);
            target.rotation = Quaternion::from_heading(1.0);
            state.correct(target, false);
            if consumed {
                assert_eq!(state.take_correction_heading(), Some(target.rotation));
            }
            state.set_mobile_physical(false, position(0.0));
            state.set_mobile_physical(true, position(0.0));
            assert_eq!(state.physical_reference().unwrap().coords, target.coords);
            assert_eq!(
                state.take_correction_heading(),
                (!consumed).then_some(target.rotation)
            );
            assert_eq!(state.take_correction_heading(), None);
            // A fresh packet renews the heading request even while position return persists.
            target.rotation = Quaternion::from_heading(2.0);
            state.correct(target, false);
            assert_eq!(state.take_correction_heading(), Some(target.rotation));
        }
    }

    #[test]
    fn contact_capture_preserves_authority_and_rejects_confirmation() {
        let mut state = PoseReconciliationState::default();
        state.correct(position(10.0), false);
        state.begin_contact_return(position(1.0)).unwrap();
        assert_eq!(state.physical_reference().unwrap(), position(10.0));
        assert_eq!(
            state.take_correction_heading(),
            Some(position(10.0).rotation)
        );
        assert_eq!(state.take_correction_heading(), None);
        state.confirm(position(2.0), position(3.0));
        let confirmed = state;
        assert!(state.begin_contact_return(position(4.0)).is_err());
        assert_eq!(state, confirmed);
    }

    #[test]
    fn moving_reference_follows_walking_turning_and_vertical_motion_once() {
        let separation = RETAIL_INTERPOLATION_TARGET_THRESHOLD_M * 8.0;
        let mut state = PoseReconciliationState::default();
        let mut current = position(0.0);
        state.correct(position(separation), true);
        // Reference ownership is arithmetic only; the contact motor owns all actual correction.
        for ordinary in [
            Vector3::new(0.0, 0.2, 0.0),
            Vector3::new(-0.2, 0.0, 0.0),
            Vector3::new(0.0, 0.0, -0.2),
            Vector3::zero(),
        ] {
            let error = state.advance_return_reference(current, ordinary).unwrap();
            assert!((error - Vector3::new(separation, 0.0, 0.0)).length() < 0.0001);
            current.coords = current.coords + ordinary;
            state.finish_physical_tick(current, Vector3::zero(), PhysicalReferenceDomain::Spatial);
            assert!(state.has_physical_correction());
        }
        current.coords.x += separation;
        state.finish_physical_tick(current, Vector3::zero(), PhysicalReferenceDomain::Spatial);
        assert!(state.is_empty());
    }

    #[test]
    fn reference_completion_waits_for_relative_velocity_to_settle() {
        let mut state = PoseReconciliationState::default();
        let target = position(0.0);
        state.correct(target, false);
        let speed_tolerance =
            super::super::PHYSICAL_RETURN_GAIN * RETAIL_INTERPOLATION_TARGET_THRESHOLD_M;
        state.finish_physical_tick(
            target,
            Vector3::new(2.0 * speed_tolerance, 0.0, 0.0),
            PhysicalReferenceDomain::Spatial,
        );
        assert!(state.has_physical_correction());
        // Completion is based on motion relative to the reference, so the caller subtracts
        // ordinary travel even when both the target and body are moving quickly together.
        state.finish_physical_tick(target, Vector3::zero(), PhysicalReferenceDomain::Spatial);
        assert!(state.is_empty());
    }

    #[test]
    fn blocked_correction_retains_work_until_accepted_motion_reaches_reference() {
        let mut state = PoseReconciliationState::default();
        let current = position(0.0);
        let distance = super::super::PHYSICAL_RETURN_START_THRESHOLD_M * 10.0;
        state.correct(position(distance), false);
        for _ in 0..200 {
            let correction = state
                .advance_return_reference(current, Vector3::zero())
                .unwrap();
            assert_eq!(correction, Vector3::new(distance, 0.0, 0.0));
            state.finish_physical_tick(current, Vector3::zero(), PhysicalReferenceDomain::Spatial);
            assert!(state.has_projection_work());
            assert_eq!(state.take_pending_snap(), None);
        }
        state.finish_physical_tick(
            position(distance),
            Vector3::zero(),
            PhysicalReferenceDomain::Spatial,
        );
        assert!(state.is_empty());
    }

    #[test]
    fn physical_packet_replaces_reference_without_preserving_confirmation_damping() {
        let mut state = PoseReconciliationState::default();
        state.confirm(position(-100.0), position(0.0));
        state.correct(position(2.0), false);
        let ordinary = Vector3::new(0.0, 1.0, 0.0);
        assert_eq!(
            state
                .compose_translation(position(0.0), ContactState::Grounded, ordinary, 0.1)
                .translation,
            ordinary
        );
        state
            .advance_return_reference(position(0.0), ordinary)
            .unwrap();
        state.correct(position(-2.0), false);
        let correction = state
            .advance_return_reference(position(0.0), Vector3::zero())
            .unwrap();
        assert_eq!(correction, Vector3::new(-2.0, 0.0, 0.0));
    }

    #[test]
    fn physical_reference_preserves_small_motion_at_large_world_coordinates() {
        let current = WorldPosition {
            landblock_id: Guid(0xfefe_0001),
            ..position(0.0)
        };
        let mut target = current;
        target.coords.x += RETAIL_INTERPOLATION_TARGET_THRESHOLD_M * 2.0;
        let mut state = PoseReconciliationState::default();
        state.correct(target, true);
        let ordinary = Vector3::new(0.0003, 0.0, 0.0);
        for _ in 0..100 {
            state.advance_return_reference(current, ordinary).unwrap();
        }
        let ReconciliationMode::Physical(reference) = state.mode else {
            panic!("blocked reference remains active")
        };
        assert!(
            (reference.reference.coords.x - target.coords.x - ordinary.x * 100.0).abs() < 0.00001
        );
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
    #[test]
    fn physical_return_completion_uses_the_motor_coordinate_domain() {
        for domain in [
            PhysicalReferenceDomain::Horizontal,
            PhysicalReferenceDomain::Spatial,
        ] {
            let mut target = position(0.0);
            target.coords.z = RETAIL_INTERPOLATION_TARGET_THRESHOLD_M * 2.0;
            let mut state = PoseReconciliationState::default();
            state.correct(target, true);
            state.finish_physical_tick(position(0.0), Vector3::zero(), domain);
            assert_eq!(
                state.has_physical_correction(),
                domain == PhysicalReferenceDomain::Spatial
            );
            state.finish_physical_tick(target, Vector3::zero(), domain);
            assert!(!state.has_physical_correction());
        }
    }
}
