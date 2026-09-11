//! Stateful host-side third-person boom behavior over world-owned collision queries.

use crate::placed_motion::present_placed_motion_pose;
use anyhow::{Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_world::spatial::SphereCollisionQuery;
use holtburger_world::{
    CollisionQueryPolicy, FreeSphereSettleConfig, FreeSphereSettleOutcome, FreeSphereState,
    MotionWaypoint, MotionWaypointPlacement, PhysicalCollisionFilter, PlacedMotionPath,
    PlacedMotionPathRequest, StaticSphereSweepRequest, settle_free_sphere_with_policy,
};
use thiserror::Error;

const DIRECTION_EPSILON: f32 = 1.0e-6;

/// Point a third-person camera pivots on, in the body's own frame.
///
/// The rule is "look at the middle of the body". The best statement of where that is comes from the
/// motion sphere the boom already targets for collision, so the camera and the collision query agree
/// on what the body is. When a setup authors no motion sphere at all, retail substitutes a 0.1m
/// stand-in (`CPhysicsObj::transition`, acclient.c:308364-308369) that says nothing about the body's
/// size, and the authored setup height is the only remaining statement of it; half that height is
/// the body's midpoint. Taking the larger of the two applies one rule to both cases rather than
/// branching on which source happens to exist.
///
/// RETAIL DIVERGENCE: retail pivots at a fixed body-local `(0, 0, 1.5)` regardless of what the
/// camera is pivoting on (`SmartBox::set_viewer_home`, acclient.c:138183-138187, re-asserted by the
/// zoom path at acclient.c:142737-142739). It can afford that because `SetPivotObject` is only ever
/// called with the player's own id, and 1.5 is the human body's upper motion-sphere center (1.49 by
/// census). Possession makes the pivot object arbitrary, which retail never had to handle: a chair
/// would frame 1.04m of empty air above itself. Content cannot observe the pivot — it is a camera
/// placement, not a physics or gameplay quantity — and the human case is preserved to within a
/// centimetre, so the departure costs no compatibility. Census over the 9,030 self-propelled weenie
/// templates (`boom_pivot_height_census`): this rule lands within 0.25m of retail's constant for
/// 64.3% of them, against 4.8% for the sphere top and 5.2% for the authored height. 92.4% of those
/// templates author a motion sphere, and it is the sphere that decides the pivot for 86.2%; the
/// height fallback decides the rest, and for 1.3% neither source says anything.
pub fn resolve_camera_pivot_offset(target_sphere_center: Vector3, body_height: f32) -> Vector3 {
    Vector3 {
        x: target_sphere_center.x,
        y: target_sphere_center.y,
        z: target_sphere_center.z.max(body_height * 0.5),
    }
}

/// Validated comfort and finite-work policy for one kinematic boom session.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomProfile {
    minimum_reach: f32,
    maximum_reach: f32,
    vertical_pivot_half_life: f32,
    maximum_vertical_pivot_lag: f32,
    clearance_recovery_half_life: f32,
    clearance_hysteresis: f32,
    maximum_control_leg_displacement: f32,
    maximum_control_legs: usize,
    surface_clearance: f32,
    settled_position_tolerance: f32,
    settled_pivot_tolerance: f32,
    placement: FreeSphereSettleConfig,
}

/// Unvalidated values used to construct one [`KinematicBoomProfile`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomProfileDefinition {
    /// Closest operator-requested reach in meters.
    pub minimum_reach: f32,
    /// Farthest operator-requested radial target in meters.
    pub maximum_reach: f32,
    /// Exponential half-life for target-induced vertical pivot motion.
    pub vertical_pivot_half_life: f32,
    /// Maximum vertical distance the filtered pivot may trail its target.
    pub maximum_vertical_pivot_lag: f32,
    /// Exponential half-life used only while collision clearance grows.
    pub clearance_recovery_half_life: f32,
    /// Clearance growth required before outward recovery resumes.
    pub clearance_hysteresis: f32,
    /// Maximum target/orbit travel represented by one internal control leg.
    pub maximum_control_leg_displacement: f32,
    /// Maximum internal control legs per envelope attempt; failed growth retries once.
    pub maximum_control_legs: usize,
    /// Distance retained before the first obstructing surface.
    pub surface_clearance: f32,
    /// Maximum camera displacement between stationary solves that still counts as settled.
    pub settled_position_tolerance: f32,
    /// Maximum raw-to-filtered pivot error that still counts as settled.
    pub settled_pivot_tolerance: f32,
    /// Target-origin envelope settlement work and separation policy.
    pub placement: FreeSphereSettleConfig,
}

/// Standard third-person boom policy shared by every client presentation authority.
//
// The policy lives beside the controller rather than in either app adapter.  Explorer and client
// may still choose different reach requests, but they cannot silently drift on collision work or
// recovery budgets while consuming the same behavior.
pub fn standard_kinematic_boom_profile() -> Result<KinematicBoomProfile> {
    Ok(KinematicBoomProfile::new(KinematicBoomProfileDefinition {
        minimum_reach: 1.2,
        maximum_reach: 8.0,
        vertical_pivot_half_life: 0.08,
        maximum_vertical_pivot_lag: 0.30,
        clearance_recovery_half_life: 0.10,
        clearance_hysteresis: 0.05,
        maximum_control_leg_displacement: 0.50,
        maximum_control_legs: 64,
        surface_clearance: 0.000_5,
        settled_position_tolerance: 0.001,
        settled_pivot_tolerance: 0.001,
        placement: FreeSphereSettleConfig {
            maximum_contact_passes: 8,
            separation_epsilon: 0.000_5,
        },
    })?)
}

/// A camera path point expressed in the AC world frame without an orientation the renderer needs.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KinematicBoomWorldPoint {
    /// EnvCell or outdoor landblock selector anchoring `coords`.
    pub landblock_id: Guid,
    /// Point in the selected AC landblock frame.
    pub coords: Vector3,
}

/// Camera placement and filtered visual pivot at one path boundary.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KinematicBoomPathPoint {
    pub position: KinematicBoomWorldPoint,
    pub visual_pivot: KinematicBoomWorldPoint,
}

/// One placement-stable camera path leg.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KinematicBoomPathLeg {
    pub end_fraction: f32,
    pub end: KinematicBoomPathPoint,
}

/// Serializable camera path shared by client and Explorer host adapters.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KinematicBoomPlacedPath {
    pub initial: KinematicBoomPathPoint,
    pub legs: Vec<KinematicBoomPathLeg>,
}

/// Projects one canonical placed motion path for a camera consumer.
pub fn serialize_kinematic_boom_path(
    path: &PlacedMotionPath,
    initial_visual_pivot: WorldPosition,
    final_visual_pivot: WorldPosition,
) -> Result<KinematicBoomPlacedPath> {
    Ok(KinematicBoomPlacedPath {
        initial: KinematicBoomPathPoint {
            position: present_placed_motion_pose(
                path,
                path.initial(),
                holtburger_common::Quaternion::identity(),
            )?
            .into(),
            visual_pivot: initial_visual_pivot.into(),
        },
        legs: path
            .legs()
            .iter()
            .map(|leg| {
                Ok(KinematicBoomPathLeg {
                    end_fraction: leg.end_fraction(),
                    end: KinematicBoomPathPoint {
                        position: present_placed_motion_pose(
                            path,
                            leg.end(),
                            holtburger_common::Quaternion::identity(),
                        )?
                        .into(),
                        visual_pivot: interpolate_visual_pivot(
                            initial_visual_pivot,
                            final_visual_pivot,
                            leg.end_fraction(),
                        )?,
                    },
                })
            })
            .collect::<Result<Vec<_>>>()?,
    })
}

/// Builds the stationary path used by held and reseeded camera ticks.
pub fn stationary_kinematic_boom_path(
    placement: KinematicBoomPlacement,
    visual_pivot: WorldPosition,
) -> KinematicBoomPlacedPath {
    let point = KinematicBoomPathPoint {
        position: placement.pose.into(),
        visual_pivot: visual_pivot.into(),
    };
    KinematicBoomPlacedPath {
        initial: point,
        legs: vec![KinematicBoomPathLeg {
            end_fraction: 1.0,
            end: point,
        }],
    }
}

fn interpolate_visual_pivot(
    start: WorldPosition,
    end: WorldPosition,
    fraction: f32,
) -> Result<KinematicBoomWorldPoint> {
    ensure!(
        fraction.is_finite() && (0.0..=1.0).contains(&fraction),
        "kinematic boom pivot fraction must be finite and normalized"
    );
    let owner = landblock_key(start.landblock_id);
    let start_coords = reanchor_point(start.coords, landblock_key(start.landblock_id), owner);
    let end_coords = reanchor_point(end.coords, landblock_key(end.landblock_id), owner);
    let pose = WorldPosition {
        landblock_id: owner,
        coords: start_coords + (end_coords - start_coords) * fraction,
        rotation: holtburger_common::Quaternion::identity(),
    }
    .normalize_outdoor_landblock_frame()?;
    Ok(KinematicBoomWorldPoint {
        landblock_id: pose.landblock_id,
        coords: pose.coords,
    })
}

fn landblock_key(id: Guid) -> Guid {
    Guid((id.0 & 0xffff_0000) | 0xffff)
}

fn reanchor_point(point: Vector3, source_owner: Guid, target_owner: Guid) -> Vector3 {
    let source_x = ((source_owner.0 >> 24) & 0xff) as i32;
    let source_y = ((source_owner.0 >> 16) & 0xff) as i32;
    let target_x = ((target_owner.0 >> 24) & 0xff) as i32;
    let target_y = ((target_owner.0 >> 16) & 0xff) as i32;
    Vector3::new(
        point.x + (source_x - target_x) as f32 * holtburger_common::position::METERS_PER_LANDBLOCK,
        point.y + (source_y - target_y) as f32 * holtburger_common::position::METERS_PER_LANDBLOCK,
        point.z,
    )
}

impl From<WorldPosition> for KinematicBoomWorldPoint {
    fn from(value: WorldPosition) -> Self {
        Self {
            landblock_id: value.landblock_id,
            coords: value.coords,
        }
    }
}

impl KinematicBoomProfile {
    /// Validates all comfort and finite-work fields before a session can retain them.
    pub fn new(
        definition: KinematicBoomProfileDefinition,
    ) -> Result<Self, KinematicBoomProfileError> {
        let KinematicBoomProfileDefinition {
            minimum_reach,
            maximum_reach,
            vertical_pivot_half_life,
            maximum_vertical_pivot_lag,
            clearance_recovery_half_life,
            clearance_hysteresis,
            maximum_control_leg_displacement,
            maximum_control_legs,
            surface_clearance,
            settled_position_tolerance,
            settled_pivot_tolerance,
            placement,
        } = definition;
        if !minimum_reach.is_finite() || minimum_reach < 0.0 {
            return Err(KinematicBoomProfileError::InvalidMinimumReach);
        }
        if !maximum_reach.is_finite() || maximum_reach < minimum_reach {
            return Err(KinematicBoomProfileError::InvalidMaximumReach);
        }
        if !vertical_pivot_half_life.is_finite() || vertical_pivot_half_life <= 0.0 {
            return Err(KinematicBoomProfileError::InvalidVerticalPivotHalfLife);
        }
        if !maximum_vertical_pivot_lag.is_finite() || maximum_vertical_pivot_lag < 0.0 {
            return Err(KinematicBoomProfileError::InvalidMaximumVerticalPivotLag);
        }
        if !clearance_recovery_half_life.is_finite() || clearance_recovery_half_life <= 0.0 {
            return Err(KinematicBoomProfileError::InvalidClearanceRecoveryHalfLife);
        }
        if !clearance_hysteresis.is_finite() || clearance_hysteresis < 0.0 {
            return Err(KinematicBoomProfileError::InvalidClearanceHysteresis);
        }
        if !maximum_control_leg_displacement.is_finite() || maximum_control_leg_displacement <= 0.0
        {
            return Err(KinematicBoomProfileError::InvalidControlLegDisplacement);
        }
        if maximum_control_legs == 0 {
            return Err(KinematicBoomProfileError::EmptyControlLegBudget);
        }
        if !surface_clearance.is_finite() || surface_clearance <= 0.0 {
            return Err(KinematicBoomProfileError::InvalidSurfaceClearance);
        }
        if !settled_position_tolerance.is_finite() || settled_position_tolerance <= 0.0 {
            return Err(KinematicBoomProfileError::InvalidSettledPositionTolerance);
        }
        if !settled_pivot_tolerance.is_finite() || settled_pivot_tolerance <= 0.0 {
            return Err(KinematicBoomProfileError::InvalidSettledPivotTolerance);
        }
        validate_placement_config(placement)?;
        Ok(Self {
            minimum_reach,
            maximum_reach,
            vertical_pivot_half_life,
            maximum_vertical_pivot_lag,
            clearance_recovery_half_life,
            clearance_hysteresis,
            maximum_control_leg_displacement,
            maximum_control_legs,
            surface_clearance,
            settled_position_tolerance,
            settled_pivot_tolerance,
            placement,
        })
    }

    /// Revalidates operator reach bounds while preserving the profile's collision and work policy.
    pub fn with_reach_limits(
        self,
        minimum_reach: f32,
        maximum_reach: f32,
    ) -> Result<Self, KinematicBoomProfileError> {
        Self::new(KinematicBoomProfileDefinition {
            minimum_reach,
            maximum_reach,
            vertical_pivot_half_life: self.vertical_pivot_half_life,
            maximum_vertical_pivot_lag: self.maximum_vertical_pivot_lag,
            clearance_recovery_half_life: self.clearance_recovery_half_life,
            clearance_hysteresis: self.clearance_hysteresis,
            maximum_control_leg_displacement: self.maximum_control_leg_displacement,
            maximum_control_legs: self.maximum_control_legs,
            surface_clearance: self.surface_clearance,
            settled_position_tolerance: self.settled_position_tolerance,
            settled_pivot_tolerance: self.settled_pivot_tolerance,
            placement: self.placement,
        })
    }
}

/// Invalid controller tuning rejected before it can affect retained state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum KinematicBoomProfileError {
    #[error("kinematic boom minimum reach must be finite and non-negative")]
    InvalidMinimumReach,
    #[error("kinematic boom maximum reach must be finite and at least the minimum")]
    InvalidMaximumReach,
    #[error("kinematic boom vertical pivot half-life must be finite and positive")]
    InvalidVerticalPivotHalfLife,
    #[error("kinematic boom maximum vertical pivot lag must be finite and non-negative")]
    InvalidMaximumVerticalPivotLag,
    #[error("kinematic boom clearance recovery half-life must be finite and positive")]
    InvalidClearanceRecoveryHalfLife,
    #[error("kinematic boom clearance hysteresis must be finite and non-negative")]
    InvalidClearanceHysteresis,
    #[error("kinematic boom control-leg displacement must be finite and positive")]
    InvalidControlLegDisplacement,
    #[error("kinematic boom requires at least one control leg")]
    EmptyControlLegBudget,
    #[error("kinematic boom surface clearance must be finite and positive")]
    InvalidSurfaceClearance,
    #[error("kinematic boom settled position tolerance must be finite and positive")]
    InvalidSettledPositionTolerance,
    #[error("kinematic boom settled pivot tolerance must be finite and positive")]
    InvalidSettledPivotTolerance,
    #[error("kinematic boom requires at least one placement contact pass")]
    EmptyPlacementBudget,
    #[error("kinematic boom placement separation epsilon must be finite and positive")]
    InvalidPlacementSeparationEpsilon,
}

/// One position paired with host-authoritative interior residency.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomPlacement {
    /// Camera or seed position in an AC landblock frame.
    pub pose: WorldPosition,
    /// Host-authoritative EnvCell, or `None` outdoors.
    pub cell: Option<Guid>,
}

/// Accepted target-sphere center used to author radial camera intent.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomTargetSeed {
    /// Accepted target-sphere center and residency.
    pub placement: KinematicBoomPlacement,
}

/// One validated projection-derived camera collision envelope.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomClearance {
    /// Positive monotonic projection revision authored by the camera frontend.
    pub revision: u64,
    /// Positive eye-centered radius containing the complete near-plane pyramid.
    pub radius: f32,
}

/// One exact target boundary sampled from the accepted possessed-body path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomTargetSample {
    /// Strictly increasing normalized tick fraction in `(0, 1]`.
    pub end_fraction: f32,
    /// Presentation pivot before controller-owned vertical damping.
    pub visual_pivot: WorldPosition,
    /// Accepted target sphere center, distinct from the visual pivot.
    pub target_seed: KinematicBoomTargetSeed,
}

/// Latest semantic boom input; zoom is the session's signed cumulative displacement in meters.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomIntent {
    /// Monotonic session-local latest-wins sequence.
    pub sequence: u64,
    /// Finite AC-world direction from the visual pivot toward the desired camera.
    pub view_direction: Vector3,
    /// Session-total signed zoom displacement, consumed by sequence delta.
    pub cumulative_zoom_displacement: f32,
}

/// Whether a latest-wins boom input changed its independently sequenced state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KinematicBoomUpdateAcceptance {
    Accepted,
    Stale,
}

/// Invalid session or tick input; these are caller contract failures, not collision outcomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum KinematicBoomInputError {
    #[error("kinematic boom view direction must be non-zero and finite")]
    InvalidViewDirection,
    #[error("kinematic boom cumulative zoom displacement must be finite")]
    InvalidCumulativeZoom,
    #[error("kinematic boom initial reach must be finite")]
    InvalidInitialReach,
    #[error("kinematic boom target pose must be finite and non-null")]
    InvalidTargetPose,
    #[error("kinematic boom projection clearance revision must be positive")]
    InvalidClearanceRevision,
    #[error("kinematic boom projection clearance radius must be finite and positive")]
    InvalidClearanceRadius,
    #[error("kinematic boom tick duration must be finite and positive")]
    InvalidTickDuration,
    #[error("kinematic boom tick requires a non-empty target path ending at one")]
    InvalidTargetPath,
}

/// Machine-readable reason one recoverable tick could not produce a new collision-safe placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KinematicBoomFailureReason {
    ClearanceSweep,
    FreeSphereQuery,
}

/// Why a tick published a safe camera placement without interpolating from its prior position.
/// Initialization settles near the target; subsequent discontinuities retain the radial solve.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KinematicBoomReseedReason {
    /// The generation's first tick, which proves projection clearance before any boom work.
    ///
    /// Not a recovery: it is reached exactly once per generation, because it is gated on a
    /// proven placement state that can only be unproven before initialization succeeds.
    InitialPlacement,
    /// Indoor path traversal could not connect otherwise proven radial endpoints.
    PlacedPath,
    /// Indoor path traversal required a discontinuous membership correction.
    PlacementRecovery,
    /// Geometry blocks interpolation from the previous camera to the radial placement.
    ObstructedPath,
}

/// Camera motion committed by one successful controller tick.
#[derive(Debug, Clone, PartialEq)]
pub enum KinematicBoomAdvance {
    /// Collision-safe motion connected continuously from the prior camera placement.
    Continuous { path: PlacedMotionPath },
    /// Explicit discontinuity to a full-envelope-safe camera placement.
    Reseeded {
        placement: KinematicBoomPlacement,
        reason: KinematicBoomReseedReason,
    },
}

/// Whether every static query contributing to a camera tick had complete collision coverage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum KinematicBoomCollisionProof {
    /// Every selected owner was resident in the sampled immutable scene.
    #[default]
    Covered,
    /// Installed topology was used despite at least one unavailable selected owner.
    Uncovered {
        /// First unavailable normalized owner in deterministic order.
        owner: Guid,
    },
}

impl KinematicBoomCollisionProof {
    fn include(&mut self, unavailable_owner: Option<Guid>) {
        let Some(candidate) = unavailable_owner else {
            return;
        };
        if matches!(self, Self::Covered)
            || matches!(self, Self::Uncovered { owner } if candidate < *owner)
        {
            *self = Self::Uncovered { owner: candidate };
        }
    }

    fn merge(&mut self, other: Self) {
        if let Self::Uncovered { owner } = other {
            self.include(Some(owner));
        }
    }
}

/// Finite work consumed by a successfully staged tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct KinematicBoomDiagnostics {
    /// Coverage proof for the static queries contributing to this result.
    pub collision_proof: KinematicBoomCollisionProof,
    /// Internal target/orbit control legs evaluated.
    pub control_legs: usize,
    /// Target-origin clearance sweeps executed; zero-length rays require no query.
    pub clearance_sweeps: usize,
    /// Sweeps proving whether radial endpoints may be interpolated continuously.
    pub continuity_sweeps: usize,
    /// Free-sphere contact-separation passes evaluated.
    pub contact_passes: usize,
}

/// Atomic result of one controller tick.
#[derive(Debug, Clone, PartialEq)]
pub enum KinematicBoomOutcome {
    Advanced {
        advance: KinematicBoomAdvance,
        /// Projection clearance proven by the published camera placement.
        clearance: KinematicBoomClearance,
        diagnostics: KinematicBoomDiagnostics,
        /// Whether the published placement has reached the profile's positional tolerances.
        convergence: KinematicBoomConvergence,
    },
    Held {
        reason: KinematicBoomFailureReason,
        held: KinematicBoomPlacement,
        /// Last projection clearance still proven by the held camera placement.
        clearance: KinematicBoomClearance,
        diagnostics: KinematicBoomDiagnostics,
    },
    /// Current target placement published before any projection-clearance proof exists.
    Fallback {
        reason: KinematicBoomFailureReason,
        placement: KinematicBoomPlacement,
        diagnostics: KinematicBoomDiagnostics,
    },
}

/// Controller-owned classification of whether another stationary solve can change presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum KinematicBoomConvergence {
    Converging,
    Settled,
}

/// Interdependent camera placement facts retained by one boom generation.
#[derive(Debug, Clone, Copy)]
enum KinematicBoomPlacementState {
    /// Generation-current target placement without projection-clearance proof.
    Unproven { placement: KinematicBoomPlacement },
    /// Camera placement proven for one projection envelope and its derived reach.
    Proven {
        placement: KinematicBoomPlacement,
        clearance: KinematicBoomClearance,
        rendered_reach: f32,
    },
}

/// Coordinate frame shared by every waypoint and the starting placement of one boom tick.
struct KinematicBoomTickFrame {
    /// Normalized outdoor owner in which the complete placed path is authored.
    anchor: Guid,
    /// Prior camera pose reanchored into `anchor` coordinates.
    start: WorldPosition,
}

/// Stateful comfort policy; collision and placement remain delegated to the injected scene.
#[derive(Debug, Clone)]
pub struct KinematicBoomController {
    profile: KinematicBoomProfile,
    raw_visual_pivot: WorldPosition,
    filtered_visual_pivot: WorldPosition,
    target_seed: KinematicBoomTargetSeed,
    requested_clearance: KinematicBoomClearance,
    desired_reach: f32,
    sampled_view_direction: Vector3,
    intent: KinematicBoomIntent,
    placement_state: KinematicBoomPlacementState,
}

impl KinematicBoomController {
    /// Starts at an accepted target seed that remains unpresentable until the first clearance proof.
    pub fn new(
        profile: KinematicBoomProfile,
        visual_pivot: WorldPosition,
        target_seed: KinematicBoomTargetSeed,
        initial_clearance: KinematicBoomClearance,
        initial_reach: f32,
        intent: KinematicBoomIntent,
    ) -> Result<Self, KinematicBoomInputError> {
        validate_pose(visual_pivot)?;
        validate_seed(target_seed)?;
        validate_clearance(initial_clearance)?;
        let view_direction = validate_direction(intent.view_direction)?;
        if !initial_reach.is_finite() {
            return Err(KinematicBoomInputError::InvalidInitialReach);
        }
        if !intent.cumulative_zoom_displacement.is_finite() {
            return Err(KinematicBoomInputError::InvalidCumulativeZoom);
        }
        let desired_reach = initial_reach.clamp(profile.minimum_reach, profile.maximum_reach);
        Ok(Self {
            profile,
            raw_visual_pivot: visual_pivot,
            filtered_visual_pivot: visual_pivot,
            target_seed,
            requested_clearance: initial_clearance,
            desired_reach,
            sampled_view_direction: view_direction,
            intent: KinematicBoomIntent {
                view_direction,
                ..intent
            },
            placement_state: KinematicBoomPlacementState::Unproven {
                placement: target_seed.placement,
            },
        })
    }

    /// Retains only the latest valid projection-clearance request for this boom session.
    pub fn request_clearance(
        &mut self,
        clearance: KinematicBoomClearance,
    ) -> Result<KinematicBoomUpdateAcceptance, KinematicBoomInputError> {
        validate_clearance(clearance)?;
        if clearance.revision <= self.requested_clearance.revision {
            return Ok(KinematicBoomUpdateAcceptance::Stale);
        }
        self.requested_clearance = clearance;
        Ok(KinematicBoomUpdateAcceptance::Accepted)
    }

    /// Projection clearance currently proven by the committed camera placement.
    pub fn committed_clearance(&self) -> Option<KinematicBoomClearance> {
        match self.placement_state {
            KinematicBoomPlacementState::Unproven { .. } => None,
            KinematicBoomPlacementState::Proven { clearance, .. } => Some(clearance),
        }
    }

    /// Accepts only a newer sequence and consumes its cumulative zoom delta exactly once.
    pub fn accept_intent(
        &mut self,
        intent: KinematicBoomIntent,
    ) -> Result<KinematicBoomUpdateAcceptance, KinematicBoomInputError> {
        if intent.sequence <= self.intent.sequence {
            return Ok(KinematicBoomUpdateAcceptance::Stale);
        }
        let view_direction = validate_direction(intent.view_direction)?;
        if !intent.cumulative_zoom_displacement.is_finite() {
            return Err(KinematicBoomInputError::InvalidCumulativeZoom);
        }
        let zoom_delta =
            intent.cumulative_zoom_displacement - self.intent.cumulative_zoom_displacement;
        if !zoom_delta.is_finite() {
            return Err(KinematicBoomInputError::InvalidCumulativeZoom);
        }
        self.desired_reach = (self.desired_reach + zoom_delta)
            .clamp(self.profile.minimum_reach, self.profile.maximum_reach);
        self.intent = KinematicBoomIntent {
            view_direction,
            ..intent
        };
        Ok(KinematicBoomUpdateAcceptance::Accepted)
    }

    /// Generation-current camera placement, whether fallback or collision-proven.
    pub fn camera(&self) -> KinematicBoomPlacement {
        match self.placement_state {
            KinematicBoomPlacementState::Unproven { placement }
            | KinematicBoomPlacementState::Proven { placement, .. } => placement,
        }
    }

    /// Filtered presentation pivot paired with the committed camera state.
    pub fn visual_pivot(&self) -> WorldPosition {
        self.filtered_visual_pivot
    }

    /// Latest operator-requested reach after cumulative zoom and profile clamping.
    pub fn desired_reach(&self) -> f32 {
        self.desired_reach
    }

    /// Collision-constrained reach committed with the current camera placement.
    pub fn rendered_reach(&self) -> f32 {
        match self.placement_state {
            KinematicBoomPlacementState::Unproven { .. } => 0.0,
            KinematicBoomPlacementState::Proven { rendered_reach, .. } => rendered_reach,
        }
    }

    /// Retire a missing or discontinuous target route while preserving operator intent.
    /// The next advance proves placement at its target seed instead of sweeping invented travel.
    pub(crate) fn invalidate_target_path(&mut self) {
        self.placement_state = KinematicBoomPlacementState::Unproven {
            placement: self.camera(),
        };
    }

    /// Advances a complete fixed tick transaction over exact target path boundaries.
    pub fn advance(
        &mut self,
        scene: &dyn SphereCollisionQuery,
        duration_seconds: f32,
        target_samples: &[KinematicBoomTargetSample],
    ) -> Result<KinematicBoomOutcome, KinematicBoomInputError> {
        validate_tick(duration_seconds, target_samples)?;
        let Some(committed) = self.committed_clearance() else {
            return self.initialize_clearance(scene, target_samples);
        };
        let attempted = self.advance_with_clearance(
            scene,
            duration_seconds,
            target_samples,
            self.requested_clearance,
        )?;
        // Admit a larger projection only after the complete sampled path succeeds. A target
        // can enter a corridor during this tick even though the old target origin had room.
        // Failed growth gets one bounded retry at the committed radius and remains pending.
        if self.requested_clearance.radius > committed.radius
            && let KinematicBoomOutcome::Held {
                diagnostics: attempted_work,
                ..
            } = attempted
        {
            let mut retried =
                self.advance_with_clearance(scene, duration_seconds, target_samples, committed)?;
            let (KinematicBoomOutcome::Advanced { diagnostics, .. }
            | KinematicBoomOutcome::Held { diagnostics, .. }
            | KinematicBoomOutcome::Fallback { diagnostics, .. }) = &mut retried;
            diagnostics.control_legs += attempted_work.control_legs;
            diagnostics.clearance_sweeps += attempted_work.clearance_sweeps;
            diagnostics.continuity_sweeps += attempted_work.continuity_sweeps;
            diagnostics.contact_passes += attempted_work.contact_passes;
            diagnostics
                .collision_proof
                .merge(attempted_work.collision_proof);
            return Ok(retried);
        }
        Ok(attempted)
    }

    /// Attempts one envelope atomically, so failed growth cannot commit partial target progress.
    fn advance_with_clearance(
        &mut self,
        scene: &dyn SphereCollisionQuery,
        duration_seconds: f32,
        target_samples: &[KinematicBoomTargetSample],
        tick_clearance: KinematicBoomClearance,
    ) -> Result<KinematicBoomOutcome, KinematicBoomInputError> {
        let (camera, current_clearance) = match self.placement_state {
            KinematicBoomPlacementState::Unproven { .. } => {
                return self.initialize_clearance(scene, target_samples);
            }
            KinematicBoomPlacementState::Proven {
                placement,
                clearance,
                ..
            } => (placement, clearance),
        };
        let mut staged = self.clone();
        let tick_anchor = owner(camera.pose.landblock_id);
        let tick_frame = KinematicBoomTickFrame {
            anchor: tick_anchor,
            start: reanchor(camera.pose, tick_anchor)?,
        };
        let start_direction = self.sampled_view_direction;
        let mut waypoints = Vec::new();
        let mut diagnostics = KinematicBoomDiagnostics::default();
        let mut segment_start_fraction = 0.0;
        let mut obstructed_path = false;

        'samples: for sample in target_samples {
            let raw_start = staged.raw_visual_pivot;
            let seed_start = staged.target_seed;
            let segment_fraction = sample.end_fraction - segment_start_fraction;
            let segment_seconds = duration_seconds * segment_fraction;
            let legs = required_control_legs(ControlLegSpan {
                maximum_displacement: staged.profile.maximum_control_leg_displacement,
                desired_reach: staged.desired_reach,
                pivot_start: raw_start,
                pivot_end: sample.visual_pivot,
                seed_start: seed_start.placement.pose,
                seed_end: sample.target_seed.placement.pose,
                direction_start: start_direction,
                direction_end: self.intent.view_direction,
                tick_fraction: segment_fraction,
            })?;
            let remaining_legs = self.profile.maximum_control_legs - diagnostics.control_legs;
            let evaluated_legs = legs.min(remaining_legs);

            for leg in 1..=evaluated_legs {
                let local_fraction = leg as f32 / legs as f32;
                let end_fraction = segment_start_fraction + segment_fraction * local_fraction;
                let step_seconds = segment_seconds / legs as f32;
                let raw_pivot = interpolate_pose(raw_start, sample.visual_pivot, local_fraction)?;
                let seed_pose = interpolate_pose(
                    seed_start.placement.pose,
                    sample.target_seed.placement.pose,
                    local_fraction,
                )?;
                let seed = KinematicBoomTargetSeed {
                    placement: KinematicBoomPlacement {
                        pose: seed_pose,
                        cell: if leg == legs {
                            sample.target_seed.placement.cell
                        } else {
                            seed_start.placement.cell
                        },
                    },
                };
                let direction = spherical_interpolate(
                    start_direction,
                    self.intent.view_direction,
                    end_fraction,
                );
                staged.filter_pivot(raw_pivot, step_seconds);
                staged.raw_visual_pivot = raw_pivot;
                staged.target_seed = seed;
                staged.sampled_view_direction = direction;
                diagnostics.control_legs += 1;

                let motion = match staged.advance_control_leg(
                    scene,
                    direction,
                    step_seconds,
                    tick_clearance,
                    &mut diagnostics,
                ) {
                    Ok(motion) => motion,
                    Err(reason) => {
                        return Ok(held(self.camera(), current_clearance, reason, diagnostics));
                    }
                };
                obstructed_path |= !motion.continuous;
                waypoints.push(MotionWaypoint {
                    center: reanchor(motion.placement.pose, tick_anchor)?.coords,
                    end_fraction,
                    placement: MotionWaypointPlacement::Committed(motion.placement.cell),
                });
            }
            if evaluated_legs < legs {
                let staged_camera = staged.camera();
                let held = reanchor(staged_camera.pose, tick_anchor)?;
                waypoints.push(MotionWaypoint {
                    center: held.coords,
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Committed(staged_camera.cell),
                });
                break 'samples;
            }
            segment_start_fraction = sample.end_fraction;
        }

        if obstructed_path {
            return Ok(self.commit_reseed(
                staged,
                KinematicBoomReseedReason::ObstructedPath,
                tick_clearance,
                diagnostics,
            ));
        }
        self.commit_staged_motion(
            scene,
            staged,
            tick_frame,
            waypoints,
            tick_clearance,
            diagnostics,
        )
    }

    /// Proves the first projection envelope before any camera placement is published.
    fn initialize_clearance(
        &mut self,
        scene: &dyn SphereCollisionQuery,
        target_samples: &[KinematicBoomTargetSample],
    ) -> Result<KinematicBoomOutcome, KinematicBoomInputError> {
        let Some(latest) = target_samples.last().copied() else {
            return Err(KinematicBoomInputError::InvalidTargetPath);
        };
        self.raw_visual_pivot = latest.visual_pivot;
        self.filtered_visual_pivot = latest.visual_pivot;
        self.target_seed = latest.target_seed;
        self.placement_state = KinematicBoomPlacementState::Unproven {
            placement: latest.target_seed.placement,
        };
        let requested = self.requested_clearance;
        let outcome = settle_free_sphere_with_policy(
            scene,
            self.profile.placement,
            FreeSphereState {
                pose: self.target_seed.placement.pose,
                cell: self.target_seed.placement.cell,
                radius: requested.radius,
            },
            PhysicalCollisionFilter::ALL,
            CollisionQueryPolicy::AllowUncoveredQuery,
        );
        let FreeSphereSettleOutcome::Settled {
            body,
            contact_passes,
            unavailable_owner,
            ..
        } = (match outcome {
            Ok(outcome) => outcome,
            Err(_) => {
                return Ok(fallback(
                    self.camera(),
                    KinematicBoomFailureReason::FreeSphereQuery,
                    KinematicBoomDiagnostics::default(),
                ));
            }
        })
        else {
            return Ok(fallback(
                self.camera(),
                KinematicBoomFailureReason::FreeSphereQuery,
                KinematicBoomDiagnostics {
                    contact_passes: self.profile.placement.maximum_contact_passes,
                    ..KinematicBoomDiagnostics::default()
                },
            ));
        };
        let camera = KinematicBoomPlacement {
            pose: body.pose,
            cell: body.cell,
        };
        let Ok(rendered_reach) = placement_distance(camera.pose, self.filtered_visual_pivot) else {
            return Ok(fallback(
                self.camera(),
                KinematicBoomFailureReason::FreeSphereQuery,
                KinematicBoomDiagnostics {
                    contact_passes,
                    ..KinematicBoomDiagnostics::default()
                },
            ));
        };
        let rendered_reach = rendered_reach.min(self.profile.maximum_reach);
        self.placement_state = KinematicBoomPlacementState::Proven {
            placement: camera,
            clearance: requested,
            rendered_reach,
        };
        let mut collision_proof = KinematicBoomCollisionProof::Covered;
        collision_proof.include(unavailable_owner);
        Ok(KinematicBoomOutcome::Advanced {
            advance: KinematicBoomAdvance::Reseeded {
                placement: camera,
                reason: KinematicBoomReseedReason::InitialPlacement,
            },
            clearance: requested,
            convergence: KinematicBoomConvergence::Converging,
            diagnostics: KinematicBoomDiagnostics {
                collision_proof,
                contact_passes,
                ..KinematicBoomDiagnostics::default()
            },
        })
    }

    /// Authors placement for one staged camera transaction and commits it atomically.
    fn commit_staged_motion(
        &mut self,
        scene: &dyn SphereCollisionQuery,
        staged: Self,
        frame: KinematicBoomTickFrame,
        waypoints: Vec<MotionWaypoint>,
        clearance: KinematicBoomClearance,
        diagnostics: KinematicBoomDiagnostics,
    ) -> Result<KinematicBoomOutcome, KinematicBoomInputError> {
        let camera = self.camera();
        let advance = match scene
            .environment()
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: camera.cell,
                anchor: frame.anchor,
                start: frame.start.coords,
                radius: clearance.radius,
                waypoints: &waypoints,
            }) {
            Ok(path) if !path.has_recovery() => KinematicBoomAdvance::Continuous { path },
            Ok(_) => {
                return Ok(self.commit_reseed(
                    staged,
                    KinematicBoomReseedReason::PlacementRecovery,
                    clearance,
                    diagnostics,
                ));
            }
            Err(_) => {
                return Ok(self.commit_reseed(
                    staged,
                    KinematicBoomReseedReason::PlacedPath,
                    clearance,
                    diagnostics,
                ));
            }
        };
        let convergence =
            staged.classify_convergence(camera, self.filtered_visual_pivot, clearance);
        *self = staged;
        Ok(KinematicBoomOutcome::Advanced {
            advance,
            clearance,
            diagnostics,
            convergence,
        })
    }

    /// A radial endpoint is already proven. Never force its correction through blocked space,
    /// or reset it to the target and discard the reach that the radial solve just established.
    fn commit_reseed(
        &mut self,
        staged: Self,
        reason: KinematicBoomReseedReason,
        clearance: KinematicBoomClearance,
        diagnostics: KinematicBoomDiagnostics,
    ) -> KinematicBoomOutcome {
        let placement = staged.camera();
        *self = staged;
        KinematicBoomOutcome::Advanced {
            advance: KinematicBoomAdvance::Reseeded { placement, reason },
            clearance,
            diagnostics,
            convergence: KinematicBoomConvergence::Converging,
        }
    }

    fn classify_convergence(
        &self,
        previous_camera: KinematicBoomPlacement,
        previous_pivot: WorldPosition,
        clearance: KinematicBoomClearance,
    ) -> KinematicBoomConvergence {
        let camera_error = placement_distance(previous_camera.pose, self.camera().pose);
        let pivot_motion = placement_distance(previous_pivot, self.filtered_visual_pivot);
        let pivot_error = placement_distance(self.filtered_visual_pivot, self.raw_visual_pivot);
        if clearance == self.requested_clearance
            && camera_error.is_ok_and(|error| error <= self.profile.settled_position_tolerance)
            && pivot_motion.is_ok_and(|error| error <= self.profile.settled_pivot_tolerance)
            && pivot_error.is_ok_and(|error| error <= self.profile.settled_pivot_tolerance)
        {
            KinematicBoomConvergence::Settled
        } else {
            KinematicBoomConvergence::Converging
        }
    }

    fn filter_pivot(&mut self, raw: WorldPosition, delta_seconds: f32) {
        let alpha = decay_fraction(delta_seconds, self.profile.vertical_pivot_half_life);
        let mut filtered_z = self.filtered_visual_pivot.coords.z
            + (raw.coords.z - self.filtered_visual_pivot.coords.z) * alpha;
        filtered_z = filtered_z.clamp(
            raw.coords.z - self.profile.maximum_vertical_pivot_lag,
            raw.coords.z + self.profile.maximum_vertical_pivot_lag,
        );
        self.filtered_visual_pivot = raw;
        self.filtered_visual_pivot.coords.z = filtered_z;
    }

    fn advance_control_leg(
        &mut self,
        scene: &dyn SphereCollisionQuery,
        direction: Vector3,
        delta_seconds: f32,
        clearance: KinematicBoomClearance,
        diagnostics: &mut KinematicBoomDiagnostics,
    ) -> Result<ControlLegMotion, KinematicBoomFailureReason> {
        let KinematicBoomPlacementState::Proven {
            placement: camera_start,
            mut rendered_reach,
            ..
        } = self.placement_state
        else {
            return Err(KinematicBoomFailureReason::FreeSphereQuery);
        };
        // The player's collision sphere can be smaller than the camera envelope (especially
        // after a projection resize). Prove the cast origin for this envelope before tracing it.
        let settled = settle_free_sphere_with_policy(
            scene,
            self.profile.placement,
            FreeSphereState {
                pose: self.target_seed.placement.pose,
                cell: self.target_seed.placement.cell,
                radius: clearance.radius,
            },
            PhysicalCollisionFilter::ALL,
            CollisionQueryPolicy::AllowUncoveredQuery,
        )
        .map_err(|_| KinematicBoomFailureReason::FreeSphereQuery)?;
        let body = match settled {
            FreeSphereSettleOutcome::Settled {
                body,
                contact_passes,
                unavailable_owner,
                ..
            } => {
                diagnostics.contact_passes += contact_passes;
                diagnostics.collision_proof.include(unavailable_owner);
                body
            }
            FreeSphereSettleOutcome::BudgetExceeded {
                contact_passes,
                unavailable_owner,
            } => {
                diagnostics.contact_passes += contact_passes;
                diagnostics.collision_proof.include(unavailable_owner);
                return Err(KinematicBoomFailureReason::FreeSphereQuery);
            }
        };
        let cast_seed = KinematicBoomPlacement {
            pose: body.pose,
            cell: body.cell,
        };
        let maximum = self.cast_to_reach(
            scene,
            cast_seed,
            direction,
            self.desired_reach,
            clearance.radius,
            diagnostics,
        )?;
        let clearance_reach = placement_distance(maximum.pose, self.filtered_visual_pivot)
            .map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
        if clearance_reach < rendered_reach {
            rendered_reach = clearance_reach;
        } else if self.desired_reach - clearance_reach <= self.profile.surface_clearance
            || clearance_reach >= rendered_reach + self.profile.clearance_hysteresis
        {
            let target = self.desired_reach.min(clearance_reach);
            rendered_reach += (target - rendered_reach)
                * decay_fraction(delta_seconds, self.profile.clearance_recovery_half_life);
        }
        rendered_reach = rendered_reach.min(self.profile.maximum_reach);

        let radial = self.cast_to_reach(
            scene,
            cast_seed,
            direction,
            rendered_reach,
            clearance.radius,
            diagnostics,
        )?;
        let displacement = placement_displacement(camera_start.pose, radial.pose)
            .map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
        // The target-origin cast owns placement. This sweep only proves whether presentation
        // can interpolate from the old camera; a blocked route must never retain that old body.
        let mut continuous = true;
        if displacement.length_squared() > 0.0 {
            // Cast both ways: movement sweeps intentionally admit separation from initial
            // overlap, but interpolation must not start inside a newly closed door either.
            for (start, displacement) in
                [(camera_start, displacement), (radial, displacement * -1.0)]
            {
                diagnostics.continuity_sweeps += 1;
                let sweep = scene
                    .sweep_sphere(
                        StaticSphereSweepRequest {
                            anchor: owner(start.pose.landblock_id),
                            start: start.pose.coords,
                            displacement,
                            previous_cell: start.cell,
                            radius: clearance.radius,
                            filter: PhysicalCollisionFilter::ALL,
                        },
                        CollisionQueryPolicy::AllowUncoveredQuery,
                    )
                    .map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
                diagnostics.collision_proof.include(sweep.unavailable_owner);
                if sweep.value.is_some() {
                    continuous = false;
                    break;
                }
            }
        }
        let placement = radial;
        rendered_reach = placement_distance(placement.pose, self.filtered_visual_pivot)
            .map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
        self.placement_state = KinematicBoomPlacementState::Proven {
            placement,
            clearance,
            rendered_reach,
        };
        Ok(ControlLegMotion {
            placement,
            continuous,
        })
    }

    fn cast_to_reach(
        &self,
        scene: &dyn SphereCollisionQuery,
        seed: KinematicBoomPlacement,
        direction: Vector3,
        reach: f32,
        clearance_radius: f32,
        diagnostics: &mut KinematicBoomDiagnostics,
    ) -> Result<KinematicBoomPlacement, KinematicBoomFailureReason> {
        let anchor = owner(seed.pose.landblock_id);
        let seed_pose =
            reanchor(seed.pose, anchor).map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
        let pivot = reanchor(self.filtered_visual_pivot, anchor)
            .map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
        let ray = pivot.coords + direction * reach - seed_pose.coords;
        let ray_length = ray.length();
        if ray_length <= DIRECTION_EPSILON {
            return Ok(seed);
        }
        diagnostics.clearance_sweeps += 1;
        let hit = scene
            .sweep_sphere(
                StaticSphereSweepRequest {
                    anchor,
                    start: seed_pose.coords,
                    displacement: ray,
                    previous_cell: seed.cell,
                    radius: clearance_radius,
                    filter: PhysicalCollisionFilter::ALL,
                },
                CollisionQueryPolicy::AllowUncoveredQuery,
            )
            .map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
        diagnostics.collision_proof.include(hit.unavailable_owner);
        let safe_distance = hit.value.map_or(ray_length, |hit| {
            (ray_length * hit.time_of_impact - self.profile.surface_clearance).max(0.0)
        });
        let safe = seed_pose.coords + ray * (safe_distance / ray_length);
        let path = scene
            .environment()
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: seed.cell,
                anchor,
                start: seed_pose.coords,
                radius: clearance_radius,
                waypoints: &[MotionWaypoint {
                    center: safe,
                    end_fraction: 1.0,
                    placement: holtburger_world::MotionWaypointPlacement::Traverse,
                }],
            })
            .map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
        let final_point = path.final_point();
        let cell = final_point.placement().committed_cell();
        // The path center is expressed in its outdoor comparison anchor. Reanchor it into the
        // committed cell owner's frame before pairing the selector, or an owner-crossing portal
        // would publish a valid EnvCell with coordinates from a different frame.
        let mut pose = WorldPosition {
            landblock_id: anchor,
            coords: final_point.center(),
            rotation: seed_pose.rotation,
        };
        if let Some(cell) = cell {
            pose = reanchor(pose, owner(cell))
                .map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
            pose.landblock_id = cell;
        } else {
            pose = pose
                .normalize_outdoor_landblock_frame()
                .map_err(|_| KinematicBoomFailureReason::ClearanceSweep)?;
        }
        Ok(KinematicBoomPlacement { pose, cell })
    }
}

/// Authoritative radial placement and the independent proof of presentation continuity.
struct ControlLegMotion {
    /// Endpoint whose full sphere was cast from the target.
    placement: KinematicBoomPlacement,
    /// Whether geometry admits interpolation from the previous endpoint.
    continuous: bool,
}

struct ControlLegSpan {
    maximum_displacement: f32,
    desired_reach: f32,
    pivot_start: WorldPosition,
    pivot_end: WorldPosition,
    seed_start: WorldPosition,
    seed_end: WorldPosition,
    direction_start: Vector3,
    direction_end: Vector3,
    tick_fraction: f32,
}

fn required_control_legs(span: ControlLegSpan) -> Result<usize, KinematicBoomInputError> {
    let target_travel = placement_distance(span.pivot_start, span.pivot_end)?
        .max(placement_distance(span.seed_start, span.seed_end)?);
    let angle = span
        .direction_start
        .dot(&span.direction_end)
        .clamp(-1.0, 1.0)
        .acos()
        * span.tick_fraction;
    let orbit_travel = angle * span.desired_reach;
    Ok(
        (target_travel.max(orbit_travel) / span.maximum_displacement)
            .ceil()
            .max(1.0) as usize,
    )
}

fn validate_tick(
    duration_seconds: f32,
    samples: &[KinematicBoomTargetSample],
) -> Result<(), KinematicBoomInputError> {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return Err(KinematicBoomInputError::InvalidTickDuration);
    }
    let mut previous = 0.0;
    for sample in samples {
        if !sample.end_fraction.is_finite()
            || sample.end_fraction <= previous
            || sample.end_fraction > 1.0
        {
            return Err(KinematicBoomInputError::InvalidTargetPath);
        }
        validate_pose(sample.visual_pivot)?;
        validate_seed(sample.target_seed)?;
        previous = sample.end_fraction;
    }
    if samples.is_empty() || previous != 1.0 {
        return Err(KinematicBoomInputError::InvalidTargetPath);
    }
    Ok(())
}

fn validate_pose(pose: WorldPosition) -> Result<(), KinematicBoomInputError> {
    let coords = pose.coords;
    if pose.landblock_id == Guid::NULL
        || !coords.x.is_finite()
        || !coords.y.is_finite()
        || !coords.z.is_finite()
    {
        return Err(KinematicBoomInputError::InvalidTargetPose);
    }
    Ok(())
}

fn validate_seed(seed: KinematicBoomTargetSeed) -> Result<(), KinematicBoomInputError> {
    validate_pose(seed.placement.pose)
}

fn validate_clearance(clearance: KinematicBoomClearance) -> Result<(), KinematicBoomInputError> {
    if clearance.revision == 0 {
        return Err(KinematicBoomInputError::InvalidClearanceRevision);
    }
    if !clearance.radius.is_finite() || clearance.radius <= 0.0 {
        return Err(KinematicBoomInputError::InvalidClearanceRadius);
    }
    Ok(())
}

fn validate_direction(direction: Vector3) -> Result<Vector3, KinematicBoomInputError> {
    if !direction.x.is_finite()
        || !direction.y.is_finite()
        || !direction.z.is_finite()
        || direction.length() <= DIRECTION_EPSILON
    {
        return Err(KinematicBoomInputError::InvalidViewDirection);
    }
    Ok(direction.normalize())
}

fn validate_placement_config(
    config: FreeSphereSettleConfig,
) -> Result<(), KinematicBoomProfileError> {
    if config.maximum_contact_passes == 0 {
        return Err(KinematicBoomProfileError::EmptyPlacementBudget);
    }
    if !config.separation_epsilon.is_finite() || config.separation_epsilon <= 0.0 {
        return Err(KinematicBoomProfileError::InvalidPlacementSeparationEpsilon);
    }
    Ok(())
}

fn spherical_interpolate(start: Vector3, end: Vector3, fraction: f32) -> Vector3 {
    let dot = start.dot(&end).clamp(-1.0, 1.0);
    if dot > 0.999_5 {
        return (start + (end - start) * fraction).normalize();
    }
    if dot < -0.999_5 {
        let z_up = Vector3::new(0.0, 0.0, 1.0);
        let mut axis = z_up - start * start.dot(&z_up);
        if axis.length() <= DIRECTION_EPSILON {
            axis = Vector3::new(1.0, 0.0, 0.0) - start * start.x;
        }
        let axis = axis.normalize();
        let angle = std::f32::consts::PI * fraction;
        return start * angle.cos() + axis.cross(&start) * angle.sin();
    }
    let angle = dot.acos();
    let scale = angle.sin();
    (start * ((1.0 - fraction) * angle).sin() + end * (fraction * angle).sin()) / scale
}

pub(crate) fn interpolate_pose(
    start: WorldPosition,
    end: WorldPosition,
    fraction: f32,
) -> Result<WorldPosition, KinematicBoomInputError> {
    // This is a coordinate-only control path: the boom's collision sample supplies residency
    // separately, so interpolation deliberately uses one outdoor owner comparison frame and
    // never claims that the resulting point is an EnvCell placement.
    let anchor = owner(start.landblock_id);
    let end = reanchor(end, anchor)?;
    let mut pose = start;
    pose.landblock_id = anchor;
    pose.coords = start.coords + (end.coords - start.coords) * fraction;
    pose.rotation = end.rotation;
    pose.normalize_outdoor_landblock_frame()
        .map_err(|_| KinematicBoomInputError::InvalidTargetPose)
}

fn reanchor(pose: WorldPosition, anchor: Guid) -> Result<WorldPosition, KinematicBoomInputError> {
    pose.reanchor_to_landblock_owner(anchor)
        .map_err(|_| KinematicBoomInputError::InvalidTargetPose)
}

fn placement_displacement(
    start: WorldPosition,
    end: WorldPosition,
) -> Result<Vector3, KinematicBoomInputError> {
    let anchor = owner(start.landblock_id);
    let start = reanchor(start, anchor)?;
    let end = reanchor(end, anchor)?;
    Ok(end.coords - start.coords)
}

fn placement_distance(
    start: WorldPosition,
    end: WorldPosition,
) -> Result<f32, KinematicBoomInputError> {
    Ok(placement_displacement(start, end)?.length())
}

fn owner(id: Guid) -> Guid {
    Guid((id.0 & 0xffff_0000) | 0xffff)
}

fn decay_fraction(delta_seconds: f32, half_life: f32) -> f32 {
    1.0 - 2.0_f32.powf(-delta_seconds / half_life)
}

fn held(
    held: KinematicBoomPlacement,
    clearance: KinematicBoomClearance,
    reason: KinematicBoomFailureReason,
    diagnostics: KinematicBoomDiagnostics,
) -> KinematicBoomOutcome {
    KinematicBoomOutcome::Held {
        reason,
        held,
        clearance,
        diagnostics,
    }
}

fn fallback(
    placement: KinematicBoomPlacement,
    reason: KinematicBoomFailureReason,
    diagnostics: KinematicBoomDiagnostics,
) -> KinematicBoomOutcome {
    KinematicBoomOutcome::Fallback {
        reason,
        placement,
        diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use holtburger_common::Quaternion;
    use holtburger_world::CollisionScene;
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::*;
    use crate::RETAIL_DUMMY_MOTION_SPHERE;
    use holtburger_common::{Plane, Sphere};
    use holtburger_content::{
        BspSolid, CellVolume, ColliderScale, CollisionBox, CollisionPolygon, CollisionShape,
        LandblockColliders, LandblockCollisionAsset, LandblockPlacement, LandblockTerrain,
        PlacedCollider, StaticColliderPlacement, TerrainCellDiagonals, TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode, InternalNode};

    const LANDBLOCK: u32 = 0xda55_ffff;

    /// Human upper motion-sphere center and authored setup height, from the retail archive.
    const HUMAN_SPHERE_CENTER_Z: f32 = 1.49;
    const HUMAN_BODY_HEIGHT: f32 = 2.05;

    #[test]
    fn camera_pivot_follows_the_targeted_motion_sphere() {
        // The human is the one body retail's fixed 1.5 was authored against, so the generalized
        // rule has to land on it without being told about it.
        let pivot = resolve_camera_pivot_offset(
            Vector3::new(0.0, 0.0, HUMAN_SPHERE_CENTER_Z),
            HUMAN_BODY_HEIGHT,
        );
        assert_eq!(pivot.z, HUMAN_SPHERE_CENTER_Z);

        // A chair, whose pivot retail would have hung 1.04m above the body entirely.
        let chair = resolve_camera_pivot_offset(Vector3::new(0.0, 0.0, 0.23), 0.46);
        assert_eq!(chair.z, 0.23);
    }

    #[test]
    fn camera_pivot_falls_back_to_the_authored_height_without_a_motion_sphere() {
        // A 64m tree authors no motion sphere, so its collision geometry is retail's 0.1m stand-in
        // and says nothing about the body. Half the authored height frames the body instead.
        let pivot = resolve_camera_pivot_offset(RETAIL_DUMMY_MOTION_SPHERE.center, 64.0);
        assert_eq!(pivot.z, 32.0);
    }

    #[test]
    fn camera_pivot_keeps_the_body_lateral_center_of_an_offset_sphere() {
        let pivot = resolve_camera_pivot_offset(Vector3::new(0.4, -0.2, 1.1), 1.0);
        assert_eq!((pivot.x, pivot.y), (0.4, -0.2));
    }

    #[test]
    fn camera_pivot_survives_a_body_that_declares_no_size_at_all() {
        // Both sources degenerate: the pivot rests on the stand-in sphere rather than failing.
        let pivot = resolve_camera_pivot_offset(RETAIL_DUMMY_MOTION_SPHERE.center, 0.0);
        assert_eq!(pivot.z, RETAIL_DUMMY_MOTION_SPHERE.center.z);
    }

    fn profile_definition(maximum_control_legs: usize) -> KinematicBoomProfileDefinition {
        KinematicBoomProfileDefinition {
            minimum_reach: 1.2,
            maximum_reach: 8.0,
            vertical_pivot_half_life: 0.08,
            maximum_vertical_pivot_lag: 0.3,
            clearance_recovery_half_life: 0.1,
            clearance_hysteresis: 0.05,
            maximum_control_leg_displacement: 0.5,
            maximum_control_legs,
            surface_clearance: 0.000_5,
            settled_position_tolerance: 0.001,
            settled_pivot_tolerance: 0.001,
            placement: FreeSphereSettleConfig {
                maximum_contact_passes: 8,
                separation_epsilon: 0.000_5,
            },
        }
    }

    fn profile(maximum_control_legs: usize) -> KinematicBoomProfile {
        KinematicBoomProfile::new(profile_definition(maximum_control_legs)).unwrap()
    }

    fn pose(coords: Vector3) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(LANDBLOCK),
            coords,
            rotation: Quaternion::identity(),
        }
    }

    fn seed(coords: Vector3) -> KinematicBoomTargetSeed {
        KinematicBoomTargetSeed {
            placement: KinematicBoomPlacement {
                pose: pose(coords),
                cell: None,
            },
        }
    }

    fn clearance(revision: u64, radius: f32) -> KinematicBoomClearance {
        KinematicBoomClearance { revision, radius }
    }

    fn controller(maximum_control_legs: usize) -> KinematicBoomController {
        KinematicBoomController::new(
            profile(maximum_control_legs),
            pose(Vector3::new(20.0, 20.0, 2.0)),
            seed(Vector3::new(20.0, 20.0, 1.0)),
            clearance(1, 0.25),
            4.5,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap()
    }

    fn sample() -> KinematicBoomTargetSample {
        KinematicBoomTargetSample {
            end_fraction: 1.0,
            visual_pivot: pose(Vector3::new(20.0, 20.0, 2.0)),
            target_seed: seed(Vector3::new(20.0, 20.0, 1.0)),
        }
    }

    fn wall_sample() -> KinematicBoomTargetSample {
        KinematicBoomTargetSample {
            end_fraction: 1.0,
            visual_pivot: pose(Vector3::new(7.0, 20.0, 2.0)),
            target_seed: seed(Vector3::new(7.0, 20.0, 1.0)),
        }
    }

    fn wall_controller(direction: Vector3) -> KinematicBoomController {
        KinematicBoomController::new(
            profile(64),
            wall_sample().visual_pivot,
            wall_sample().target_seed,
            clearance(1, 0.25),
            4.5,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: direction,
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap()
    }

    fn flat_terrain(landblock: u32) -> TerrainCollisionSurface {
        TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![0.0; 81],
            terrain_samples: vec![0; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(landblock),
        })
        .unwrap()
    }

    fn collision_asset(landblock: u32, colliders: Vec<PlacedCollider>) -> LandblockCollisionAsset {
        LandblockCollisionAsset {
            landblock_id: landblock,
            terrain: flat_terrain(landblock),
            static_geometry: LandblockColliders::new(colliders, Vec::new()),
        }
    }

    fn wall_x(x: f32) -> PlacedCollider {
        wall(Plane {
            normal: Vector3::new(1.0, 0.0, 0.0),
            d: -x,
        })
    }

    fn wall(plane: Plane) -> PlacedCollider {
        let surface_point = plane.normal * (-plane.d / plane.normal.length_squared());
        let outward = plane.normal * -1.0;
        let tangent = outward.cross(&Vector3::new(0.0, 0.0, 1.0));
        let bitangent = outward.cross(&tangent);
        let extent = 200.0;
        let polygon = CollisionPolygon {
            vertices: vec![
                surface_point - tangent * extent - bitangent * extent,
                surface_point + tangent * extent - bitangent * extent,
                surface_point + tangent * extent + bitangent * extent,
                surface_point - tangent * extent + bitangent * extent,
            ],
            normal: outward,
            d: -outward.dot(&surface_point),
        };
        let box_bounds = CollisionBox::from_points(polygon.vertices.iter().copied()).unwrap();
        let solid = BspNode::Leaf(BspLeaf {
            index: 1,
            solid: 1,
            sphere: None,
            poly_ids: vec![1],
        });
        let empty = BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: None,
            poly_ids: Vec::new(),
        });
        let bounds = Sphere {
            center: Vector3::new(96.0, 96.0, 20.0),
            radius: 200.0,
        };
        let shape = Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: BspNode::Internal(InternalNode {
                tag: *b"BPnn",
                plane,
                pos: Some(Box::new(solid)),
                neg: Some(Box::new(empty)),
                sphere: Some(bounds),
                poly_ids: Vec::new(),
            }),
            bounds,
            box_bounds,
            polygons: HashMap::from([(1, polygon)]),
        }));
        PlacedCollider::new(
            shape,
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        )
        .unwrap()
    }

    /// Thin closed panel with opposing faces, so both target and camera sweeps encounter it.
    fn two_sided_panel(x: f32) -> PlacedCollider {
        let mut panel = wall_x(x);
        let CollisionShape::Bsp(solid) = Arc::get_mut(&mut panel.geometry.shape).unwrap() else {
            unreachable!()
        };
        let mut back = solid.polygons[&1].clone();
        back.vertices.reverse();
        back.normal = back.normal * -1.0;
        back.d = -back.d;
        solid.polygons.insert(2, back);
        solid.bsp = BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: Some(solid.bounds),
            poly_ids: vec![1, 2],
        });
        panel
    }

    fn wall_scene() -> CollisionScene {
        collision_scene(vec![wall_x(10.0)])
    }

    fn empty_scene() -> CollisionScene {
        collision_scene(Vec::new())
    }

    fn collision_scene(colliders: Vec<PlacedCollider>) -> CollisionScene {
        let mut scene = CollisionScene::new();
        let owner_x = (LANDBLOCK >> 24) as i32;
        let owner_y = ((LANDBLOCK >> 16) & 0xff) as i32;
        for x in owner_x - 1..=owner_x + 1 {
            for y in owner_y - 1..=owner_y + 1 {
                let landblock = ((x as u32) << 24) | ((y as u32) << 16) | 0xffff;
                scene
                    .insert(collision_asset(
                        landblock,
                        if landblock == LANDBLOCK {
                            colliders.clone()
                        } else {
                            Vec::new()
                        },
                    ))
                    .unwrap();
            }
        }
        scene
    }

    fn stationary_controller(
        center: Vector3,
        initial_clearance: KinematicBoomClearance,
    ) -> KinematicBoomController {
        let mut definition = profile_definition(64);
        definition.minimum_reach = 0.0;
        definition.maximum_reach = 0.0;
        KinematicBoomController::new(
            KinematicBoomProfile::new(definition).unwrap(),
            pose(center),
            seed(center),
            initial_clearance,
            0.0,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap()
    }

    fn stationary_sample(center: Vector3) -> KinematicBoomTargetSample {
        KinematicBoomTargetSample {
            end_fraction: 1.0,
            visual_pivot: pose(center),
            target_seed: seed(center),
        }
    }

    fn settle_reach(
        controller: &mut KinematicBoomController,
        scene: &CollisionScene,
        target: KinematicBoomTargetSample,
    ) {
        initialize(controller, scene, target);
        for _ in 0..60 {
            let outcome = controller.advance(scene, 1.0 / 30.0, &[target]).unwrap();
            assert!(matches!(outcome, KinematicBoomOutcome::Advanced { .. }));
        }
    }

    #[test]
    fn initial_placement_is_presentable_but_stationary_solves_own_settlement() {
        let scene = empty_scene();
        let target = sample();
        let mut controller = controller(64);
        let initial = controller.advance(&scene, 1.0 / 60.0, &[target]).unwrap();
        assert!(matches!(
            initial,
            KinematicBoomOutcome::Advanced {
                convergence: KinematicBoomConvergence::Converging,
                ..
            }
        ));

        let mut settled = false;
        for _ in 0..256 {
            let outcome = controller.advance(&scene, 0.016, &[target]).unwrap();
            if matches!(
                outcome,
                KinematicBoomOutcome::Advanced {
                    convergence: KinematicBoomConvergence::Settled,
                    ..
                }
            ) {
                settled = true;
                break;
            }
        }
        assert!(
            settled,
            "unobstructed boom did not settle within activation work"
        );
    }

    #[test]
    fn closing_panel_reseeds_to_the_target_side_even_when_it_engulfs_the_camera() {
        let target = wall_sample();
        let open = empty_scene();
        let mut initial = wall_controller(Vector3::new(1.0, 0.0, 0.0));
        settle_reach(&mut initial, &open, target);
        let camera_x = initial.camera().pose.coords.x;
        let radius = initial.committed_clearance().unwrap().radius;
        for panel_x in [
            10.0,
            camera_x,
            camera_x - radius * 0.5,
            camera_x + radius * 0.5,
        ] {
            for grow_projection in [false, true] {
                let mut controller = initial.clone();
                let envelope = if grow_projection {
                    clearance(2, radius * 2.0)
                } else {
                    clearance(1, radius)
                };
                controller.request_clearance(envelope).unwrap();
                let scene = collision_scene(vec![two_sided_panel(panel_x)]);
                let outcome = controller.advance(&scene, 1.0 / 30.0, &[target]).unwrap();
                let KinematicBoomOutcome::Advanced {
                    advance:
                        KinematicBoomAdvance::Reseeded {
                            placement,
                            reason: KinematicBoomReseedReason::ObstructedPath,
                        },
                    clearance,
                    ..
                } = outcome
                else {
                    panic!("closed panel must interrupt interpolation: {outcome:?}")
                };
                assert_eq!(clearance, envelope);
                assert!(placement.pose.coords.x < panel_x);
                assert!(
                    controller.rendered_reach() > 0.0,
                    "correction must retain the solved boom reach"
                );
                assert_sphere_fits(&scene, placement, envelope.radius);
                // Repeated stationary ticks cannot drift back through the closed panel.
                settle_reach(&mut controller, &scene, target);
                assert!(controller.camera().pose.coords.x < panel_x);
                assert_sphere_fits(&scene, controller.camera(), envelope.radius);
                let shortened = controller.rendered_reach();
                let reopened = controller.advance(&open, 1.0 / 30.0, &[target]).unwrap();
                assert_continuous_path_fits(&open, &reopened);
                assert!(controller.rendered_reach() > shortened);
                assert!(controller.rendered_reach() < controller.desired_reach());
            }
        }
    }

    /// Sample presentation chords independently with undirected full-envelope placement checks.
    fn assert_continuous_path_fits(scene: &CollisionScene, outcome: &KinematicBoomOutcome) {
        let KinematicBoomOutcome::Advanced {
            advance: KinematicBoomAdvance::Continuous { path },
            clearance,
            ..
        } = outcome
        else {
            panic!("expected ordinary continuous camera motion: {outcome:?}")
        };
        let mut start = path.initial().center();
        for leg in path.legs() {
            for sample in 0..=16 {
                let center = start + (leg.end().center() - start) * (sample as f32 / 16.0);
                assert_sphere_fits(
                    scene,
                    KinematicBoomPlacement {
                        pose: WorldPosition {
                            landblock_id: path.anchor(),
                            coords: center,
                            rotation: Quaternion::identity(),
                        },
                        cell: leg.end().placement().committed_cell(),
                    },
                    clearance.radius,
                );
            }
            start = leg.end().center();
        }
    }

    fn assert_sphere_fits(scene: &CollisionScene, placement: KinematicBoomPlacement, radius: f32) {
        let outcome = settle_free_sphere_with_policy(
            scene,
            profile(64).placement,
            FreeSphereState {
                pose: placement.pose,
                cell: placement.cell,
                radius,
            },
            PhysicalCollisionFilter::ALL,
            CollisionQueryPolicy::AllowUncoveredQuery,
        )
        .unwrap();
        assert!(
            matches!(outcome, FreeSphereSettleOutcome::Settled { separation, .. } if separation.length() == 0.0),
            "camera envelope intersects geometry: {outcome:?}"
        );
    }

    #[test]
    fn obstruction_limited_boom_settles_below_desired_reach() {
        let scene = wall_scene();
        let target = wall_sample();
        let mut controller = wall_controller(Vector3::new(1.0, 0.0, 0.0));
        initialize(&mut controller, &scene, target);
        let mut settled = false;
        for _ in 0..256 {
            let outcome = controller.advance(&scene, 0.016, &[target]).unwrap();
            if matches!(
                outcome,
                KinematicBoomOutcome::Advanced {
                    convergence: KinematicBoomConvergence::Settled,
                    ..
                }
            ) {
                settled = true;
                break;
            }
        }
        assert!(settled, "obstruction-limited boom did not settle");
        assert!(controller.rendered_reach() < controller.desired_reach());
    }

    fn initialize(
        controller: &mut KinematicBoomController,
        scene: &CollisionScene,
        target: KinematicBoomTargetSample,
    ) {
        if controller.committed_clearance().is_some() {
            return;
        }
        let outcome = controller.advance(scene, 1.0 / 30.0, &[target]).unwrap();
        assert!(matches!(
            outcome,
            KinematicBoomOutcome::Advanced {
                advance: KinematicBoomAdvance::Reseeded {
                    reason: KinematicBoomReseedReason::InitialPlacement,
                    ..
                },
                ..
            }
        ));
    }

    #[test]
    fn projection_clearance_grows_in_open_space_and_shrinks_without_camera_motion() {
        let center = Vector3::new(20.0, 20.0, 5.0);
        let target = stationary_sample(center);
        let scene = collision_scene(Vec::new());
        let mut controller = stationary_controller(center, clearance(1, 0.25));
        initialize(&mut controller, &scene, target);

        assert_eq!(
            controller.request_clearance(clearance(2, 0.5)).unwrap(),
            KinematicBoomUpdateAcceptance::Accepted
        );
        assert_eq!(
            controller.request_clearance(clearance(3, 0.9)).unwrap(),
            KinematicBoomUpdateAcceptance::Accepted
        );
        assert_eq!(
            controller.request_clearance(clearance(2, 0.4)).unwrap(),
            KinematicBoomUpdateAcceptance::Stale
        );
        let grown = controller.advance(&scene, 1.0 / 30.0, &[target]).unwrap();
        assert!(matches!(
            grown,
            KinematicBoomOutcome::Advanced {
                clearance: KinematicBoomClearance {
                    revision: 3,
                    radius: 0.9,
                },
                ..
            }
        ));

        let before_shrink = controller.camera();
        controller.request_clearance(clearance(4, 0.1)).unwrap();
        controller.advance(&scene, 1.0 / 30.0, &[target]).unwrap();
        assert_eq!(controller.camera(), before_shrink);
        assert_eq!(controller.committed_clearance(), Some(clearance(4, 0.1)));
    }

    #[test]
    fn projection_clearance_growth_separates_from_a_wall_and_corner() {
        let wall_y = wall(Plane {
            normal: Vector3::new(0.0, 1.0, 0.0),
            d: -10.0,
        });
        for (scene, center) in [
            (
                collision_scene(vec![wall_x(10.0)]),
                Vector3::new(9.7, 20.0, 5.0),
            ),
            (
                collision_scene(vec![wall_x(10.0), wall_y]),
                Vector3::new(9.7, 9.7, 5.0),
            ),
        ] {
            let target = stationary_sample(center);
            let mut controller = stationary_controller(center, clearance(1, 0.25));
            initialize(&mut controller, &scene, target);
            controller.request_clearance(clearance(2, 1.0)).unwrap();

            let outcome = controller.advance(&scene, 1.0 / 30.0, &[target]).unwrap();

            assert!(matches!(outcome, KinematicBoomOutcome::Advanced { .. }));

            assert_eq!(controller.committed_clearance(), Some(clearance(2, 1.0)));
            assert!(controller.camera().pose.coords.x <= 9.001);
            if center.y < 10.0 {
                assert!(controller.camera().pose.coords.y <= 9.001);
            }
        }
    }

    #[test]
    fn projection_growth_does_not_stall_a_target_entering_a_narrow_corridor() {
        let mut panels = vec![two_sided_panel(9.6), two_sided_panel(10.0)];
        for panel in &mut panels {
            let CollisionShape::Bsp(solid) = Arc::get_mut(&mut panel.geometry.shape).unwrap()
            else {
                unreachable!()
            };
            for polygon in solid.polygons.values_mut() {
                for vertex in &mut polygon.vertices {
                    vertex.y = if vertex.y < 0.0 { 20.0 } else { 30.0 };
                }
            }
        }
        let scene = collision_scene(panels);
        let start = stationary_sample(Vector3::new(9.8, 19.0, 5.0));
        let destination = stationary_sample(Vector3::new(9.8, 23.0, 5.0));
        let mut controller = stationary_controller(start.visual_pivot.coords, clearance(1, 0.1));
        initialize(&mut controller, &scene, start);
        controller.request_clearance(clearance(2, 0.3)).unwrap();
        for _ in 0..2 {
            let outcome = controller
                .advance(&scene, 1.0 / 30.0, &[destination])
                .unwrap();
            assert!(
                matches!(outcome, KinematicBoomOutcome::Advanced { .. }),
                "{outcome:?}"
            );
            assert_eq!(controller.committed_clearance(), Some(clearance(1, 0.1)));
            assert_eq!(
                controller.camera().pose.coords.y,
                destination.visual_pivot.coords.y
            );
        }
        assert_eq!(controller.requested_clearance, clearance(2, 0.3));
        controller.advance(&scene, 1.0 / 30.0, &[start]).unwrap();
        controller.advance(&scene, 1.0 / 30.0, &[start]).unwrap();
        assert_eq!(controller.committed_clearance(), Some(clearance(2, 0.3)));
    }

    #[test]
    fn impossible_growth_retains_latest_request_and_old_safe_clearance() {
        let west_wall = wall(Plane {
            normal: Vector3::new(-1.0, 0.0, 0.0),
            d: 9.6,
        });
        let scene = collision_scene(vec![west_wall, wall_x(10.0)]);
        let center = Vector3::new(9.8, 20.0, 5.0);
        let target = stationary_sample(center);
        let mut controller = stationary_controller(center, clearance(1, 0.1));
        initialize(&mut controller, &scene, target);
        controller.request_clearance(clearance(2, 0.3)).unwrap();

        for _ in 0..3 {
            let outcome = controller.advance(&scene, 1.0 / 30.0, &[target]).unwrap();
            assert!(matches!(outcome, KinematicBoomOutcome::Advanced { .. }));
            assert_eq!(controller.committed_clearance(), Some(clearance(1, 0.1)));
        }
        assert_eq!(controller.requested_clearance, clearance(2, 0.3));
    }

    #[test]
    fn unproven_camera_follows_the_latest_target_until_clearance_is_proven() {
        let west_wall = wall(Plane {
            normal: Vector3::new(-1.0, 0.0, 0.0),
            d: 9.6,
        });
        let blocked_scene = collision_scene(vec![west_wall, wall_x(10.0)]);
        let initial_center = Vector3::new(9.8, 20.0, 5.0);
        let mut controller = stationary_controller(initial_center, clearance(1, 0.3));

        let initial = controller
            .advance(
                &blocked_scene,
                1.0 / 30.0,
                &[stationary_sample(initial_center)],
            )
            .unwrap();
        assert_eq!(
            initial,
            KinematicBoomOutcome::Fallback {
                reason: KinematicBoomFailureReason::FreeSphereQuery,
                placement: seed(initial_center).placement,
                diagnostics: KinematicBoomDiagnostics {
                    contact_passes: controller.profile.placement.maximum_contact_passes,
                    ..KinematicBoomDiagnostics::default()
                },
            }
        );
        assert_eq!(controller.committed_clearance(), None);
        assert_eq!(controller.rendered_reach(), 0.0);

        let moved_center = Vector3::new(9.8, 21.0, 5.0);
        let moved = controller
            .advance(
                &blocked_scene,
                1.0 / 30.0,
                &[stationary_sample(moved_center)],
            )
            .unwrap();
        assert!(matches!(
            moved,
            KinematicBoomOutcome::Fallback {
                placement,
                ..
            } if placement == seed(moved_center).placement
        ));
        assert_eq!(controller.camera(), seed(moved_center).placement);

        let recovered = controller
            .advance(
                &empty_scene(),
                1.0 / 30.0,
                &[stationary_sample(moved_center)],
            )
            .unwrap();
        let KinematicBoomOutcome::Advanced {
            advance:
                KinematicBoomAdvance::Reseeded {
                    placement,
                    reason: KinematicBoomReseedReason::InitialPlacement,
                },
            clearance: proven_clearance,
            ..
        } = recovered
        else {
            panic!("a later successful solve must prove the initial placement")
        };
        assert_eq!(placement.pose.coords, moved_center);
        assert_eq!(placement.cell, None);
        assert_eq!(proven_clearance, clearance(1, 0.3));
        assert_eq!(controller.committed_clearance(), Some(clearance(1, 0.3)));
    }

    #[test]
    fn proven_camera_holds_its_last_safe_placement_when_the_retained_cell_is_unavailable() {
        let scene = empty_scene();
        let target = sample();
        let mut controller = controller(64);
        initialize(&mut controller, &scene, target);
        let unavailable_cell = Guid(0xda55_0100);
        let mut proven = controller.camera();
        proven.pose.landblock_id = unavailable_cell;
        proven.cell = Some(unavailable_cell);
        controller.placement_state = KinematicBoomPlacementState::Proven {
            placement: proven,
            clearance: clearance(1, 0.25),
            rendered_reach: controller.rendered_reach(),
        };

        let outcome = controller.advance(&scene, 1.0 / 30.0, &[target]).unwrap();

        let KinematicBoomOutcome::Held {
            reason,
            held,
            clearance: held_clearance,
            ..
        } = outcome
        else {
            panic!("an established camera must hold instead of publishing fallback")
        };
        assert_eq!(reason, KinematicBoomFailureReason::ClearanceSweep);
        assert_eq!(held, proven);
        assert_eq!(held_clearance, clearance(1, 0.25));
        assert_eq!(controller.camera(), proven);
    }

    #[test]
    fn stale_intent_cannot_replace_direction_or_reapply_cumulative_zoom() {
        let mut controller = controller(64);
        assert_eq!(
            controller
                .accept_intent(KinematicBoomIntent {
                    sequence: 2,
                    view_direction: Vector3::new(0.0, 1.0, 0.0),
                    cumulative_zoom_displacement: 2.0,
                })
                .unwrap(),
            KinematicBoomUpdateAcceptance::Accepted
        );
        assert_eq!(controller.desired_reach(), 6.5);
        assert_eq!(
            controller
                .accept_intent(KinematicBoomIntent {
                    sequence: 1,
                    view_direction: Vector3::new(-1.0, 0.0, 0.0),
                    cumulative_zoom_displacement: 7.0,
                })
                .unwrap(),
            KinematicBoomUpdateAcceptance::Stale
        );
        assert_eq!(controller.desired_reach(), 6.5);
    }

    #[test]
    fn profile_validation_reaches_each_distinct_failure_contract() {
        type InvalidProfileCase = (
            KinematicBoomProfileError,
            fn(&mut KinematicBoomProfileDefinition),
        );
        let cases: &[InvalidProfileCase] = &[
            (KinematicBoomProfileError::InvalidMinimumReach, |value| {
                value.minimum_reach = -1.0;
            }),
            (KinematicBoomProfileError::InvalidMaximumReach, |value| {
                value.maximum_reach = 1.0;
            }),
            (
                KinematicBoomProfileError::InvalidVerticalPivotHalfLife,
                |value| value.vertical_pivot_half_life = 0.0,
            ),
            (
                KinematicBoomProfileError::InvalidMaximumVerticalPivotLag,
                |value| value.maximum_vertical_pivot_lag = -1.0,
            ),
            (
                KinematicBoomProfileError::InvalidClearanceRecoveryHalfLife,
                |value| value.clearance_recovery_half_life = 0.0,
            ),
            (
                KinematicBoomProfileError::InvalidClearanceHysteresis,
                |value| value.clearance_hysteresis = -1.0,
            ),
            (
                KinematicBoomProfileError::InvalidControlLegDisplacement,
                |value| value.maximum_control_leg_displacement = 0.0,
            ),
            (KinematicBoomProfileError::EmptyControlLegBudget, |value| {
                value.maximum_control_legs = 0;
            }),
            (
                KinematicBoomProfileError::InvalidSurfaceClearance,
                |value| value.surface_clearance = 0.0,
            ),
            (KinematicBoomProfileError::EmptyPlacementBudget, |value| {
                value.placement.maximum_contact_passes = 0
            }),
            (
                KinematicBoomProfileError::InvalidPlacementSeparationEpsilon,
                |value| {
                    value.placement.separation_epsilon = 0.0;
                },
            ),
            (
                KinematicBoomProfileError::InvalidPlacementSeparationEpsilon,
                |value| {
                    value.placement.separation_epsilon = f32::NAN;
                },
            ),
        ];
        for (expected, mutate) in cases {
            let mut definition = profile_definition(64);
            mutate(&mut definition);
            assert_eq!(KinematicBoomProfile::new(definition), Err(*expected));
        }
    }

    #[test]
    fn session_and_tick_validation_reach_each_input_failure_contract() {
        let initial = KinematicBoomIntent {
            sequence: 0,
            view_direction: Vector3::new(1.0, 0.0, 0.0),
            cumulative_zoom_displacement: 0.0,
        };
        assert_eq!(
            KinematicBoomController::new(
                profile(64),
                pose(Vector3::new(f32::NAN, 0.0, 0.0)),
                seed(Vector3::zero()),
                clearance(1, 0.25),
                4.5,
                initial,
            )
            .unwrap_err(),
            KinematicBoomInputError::InvalidTargetPose
        );
        assert_eq!(
            KinematicBoomController::new(
                profile(64),
                pose(Vector3::zero()),
                seed(Vector3::zero()),
                clearance(1, 0.0),
                4.5,
                initial,
            )
            .unwrap_err(),
            KinematicBoomInputError::InvalidClearanceRadius
        );
        assert_eq!(
            KinematicBoomController::new(
                profile(64),
                pose(Vector3::zero()),
                seed(Vector3::zero()),
                clearance(1, 0.25),
                f32::NAN,
                initial,
            )
            .unwrap_err(),
            KinematicBoomInputError::InvalidInitialReach
        );

        let mut controller = controller(64);
        assert_eq!(
            controller
                .accept_intent(KinematicBoomIntent {
                    sequence: 1,
                    view_direction: Vector3::zero(),
                    cumulative_zoom_displacement: 0.0,
                })
                .unwrap_err(),
            KinematicBoomInputError::InvalidViewDirection
        );
        assert_eq!(
            controller
                .accept_intent(KinematicBoomIntent {
                    sequence: 1,
                    view_direction: Vector3::new(1.0, 0.0, 0.0),
                    cumulative_zoom_displacement: f32::NAN,
                })
                .unwrap_err(),
            KinematicBoomInputError::InvalidCumulativeZoom
        );
        assert_eq!(
            controller.request_clearance(clearance(2, 0.0)).unwrap_err(),
            KinematicBoomInputError::InvalidClearanceRadius
        );
        assert_eq!(
            controller
                .advance(&empty_scene(), 0.0, &[sample()])
                .unwrap_err(),
            KinematicBoomInputError::InvalidTickDuration
        );
        assert_eq!(
            controller
                .advance(&empty_scene(), 1.0 / 30.0, &[])
                .unwrap_err(),
            KinematicBoomInputError::InvalidTargetPath
        );
    }

    #[test]
    fn empty_scene_emits_a_nonempty_normalized_path_and_advances_recovery_monotonically() {
        let mut controller = controller(64);
        let scene = empty_scene();
        initialize(&mut controller, &scene, sample());
        let first = controller.advance(&scene, 1.0 / 30.0, &[sample()]).unwrap();
        let KinematicBoomOutcome::Advanced {
            advance: KinematicBoomAdvance::Continuous { path },
            ..
        } = first
        else {
            panic!("empty scene must solve")
        };
        assert_eq!(path.legs().last().unwrap().end_fraction(), 1.0);
        let first_reach = controller.rendered_reach();
        controller.advance(&scene, 1.0 / 30.0, &[sample()]).unwrap();
        assert!(controller.rendered_reach() > first_reach);
        assert!(controller.rendered_reach() < controller.desired_reach());
    }

    #[test]
    fn unavailable_scene_advances_with_an_uncovered_collision_proof() {
        let mut controller = controller(64);

        let outcome = controller
            .advance(&CollisionScene::new(), 1.0 / 30.0, &[sample()])
            .unwrap();

        assert!(matches!(
            outcome,
            KinematicBoomOutcome::Advanced {
                diagnostics: KinematicBoomDiagnostics {
                    collision_proof: KinematicBoomCollisionProof::Uncovered {
                        owner: Guid(LANDBLOCK),
                    },
                    ..
                },
                ..
            }
        ));
    }

    #[test]
    fn clearance_sweep_preserves_committed_indoor_cell_when_coordinates_cross_owner_square() {
        let cell = Guid(0xda55_0100);
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: LANDBLOCK,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::new(
                    Vec::new(),
                    vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: Vec::new(),
                        portals: Vec::new(),
                    }],
                ),
            })
            .unwrap();
        let indoor_pose = WorldPosition {
            landblock_id: cell,
            coords: Vector3::new(200.0, -40.0, 2.0),
            rotation: Quaternion::identity(),
        };
        let mut controller = KinematicBoomController::new(
            profile(64),
            indoor_pose,
            KinematicBoomTargetSeed {
                placement: KinematicBoomPlacement {
                    pose: indoor_pose,
                    cell: Some(cell),
                },
            },
            clearance(1, 0.25),
            4.5,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap();
        controller.placement_state = KinematicBoomPlacementState::Proven {
            placement: controller.camera(),
            clearance: clearance(1, 0.25),
            rendered_reach: 0.0,
        };

        let placement = controller
            .cast_to_reach(
                &scene,
                controller.target_seed.placement,
                Vector3::new(1.0, 0.0, 0.0),
                1.0,
                0.25,
                &mut KinematicBoomDiagnostics::default(),
            )
            .unwrap();

        assert_eq!(placement.cell, Some(cell));
        assert_eq!(placement.pose.landblock_id, cell);
        assert_eq!(placement.pose.coords, Vector3::new(201.0, -40.0, 2.0));
    }

    #[test]
    fn target_discontinuity_reproves_placement_and_preserves_operator_requests() {
        let mut controller = controller(64);
        let scene = empty_scene();
        settle_reach(&mut controller, &scene, sample());
        let intent = KinematicBoomIntent {
            sequence: 1,
            view_direction: Vector3::new(0.0, 1.0, 0.0),
            cumulative_zoom_displacement: 1.0,
        };
        controller.accept_intent(intent).unwrap();
        let requested = clearance(2, 0.4);
        controller.request_clearance(requested).unwrap();
        let desired_reach = controller.desired_reach();
        controller.invalidate_target_path();
        assert!(controller.committed_clearance().is_none());
        let mut destination = sample();
        destination.visual_pivot.coords.x += 20.0;
        destination.target_seed.placement.pose.coords.x += 20.0;
        let outcome = controller
            .advance(&scene, 1.0 / 60.0, &[destination])
            .unwrap();
        assert!(matches!(
            outcome,
            KinematicBoomOutcome::Advanced {
                advance: KinematicBoomAdvance::Reseeded { .. },
                ..
            }
        ));
        assert!(
            placement_distance(
                controller.camera().pose,
                destination.target_seed.placement.pose
            )
            .unwrap()
                < 1e-6
        );
        assert_eq!(
            controller.camera().cell,
            destination.target_seed.placement.cell
        );
        assert_eq!(controller.committed_clearance(), Some(requested));
        assert_eq!(controller.desired_reach(), desired_reach);
        assert_eq!(controller.intent, intent);
    }

    #[test]
    fn clearance_sweep_accepts_reach_beyond_the_removed_sample_budget() {
        let mut definition = profile_definition(64);
        definition.maximum_reach = 32.0;
        let mut controller = KinematicBoomController::new(
            KinematicBoomProfile::new(definition).unwrap(),
            sample().visual_pivot,
            sample().target_seed,
            clearance(1, 0.25),
            32.0,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap();

        assert!(matches!(
            controller
                .advance(&empty_scene(), 1.0 / 30.0, &[sample()])
                .unwrap(),
            KinematicBoomOutcome::Advanced { .. }
        ));
        assert_eq!(controller.desired_reach(), 32.0);
    }

    #[test]
    fn radial_reach_tracks_the_target_moving_sideways() {
        let mut definition = profile_definition(64);
        definition.maximum_reach = 32.0;
        let mut controller = KinematicBoomController::new(
            KinematicBoomProfile::new(definition).unwrap(),
            sample().visual_pivot,
            sample().target_seed,
            clearance(1, 0.25),
            32.0,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap();
        let scene = empty_scene();
        settle_reach(&mut controller, &scene, sample());

        let mut moved = sample();
        moved.visual_pivot.coords.y += 0.5;
        moved.target_seed.placement.pose.coords.y += 0.5;
        let outcome = controller.advance(&scene, 1.0 / 30.0, &[moved]).unwrap();

        assert!(matches!(outcome, KinematicBoomOutcome::Advanced { .. }));
        assert!((controller.rendered_reach() - 32.0).abs() < 1.0e-4);
    }

    #[test]
    fn overextended_camera_retracts_instead_of_invalidating_the_tick() {
        let mut definition = profile_definition(64);
        definition.maximum_reach = 32.0;
        let mut controller = KinematicBoomController::new(
            KinematicBoomProfile::new(definition).unwrap(),
            sample().visual_pivot,
            sample().target_seed,
            clearance(1, 0.25),
            32.0,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap();
        let scene = empty_scene();
        settle_reach(&mut controller, &scene, sample());
        let mut overextended = controller.camera();
        overextended.pose.coords.x += 0.25;
        controller.placement_state = KinematicBoomPlacementState::Proven {
            placement: overextended,
            clearance: clearance(1, 0.25),
            rendered_reach: 32.25,
        };

        let outcome = controller.advance(&scene, 1.0 / 30.0, &[sample()]).unwrap();

        assert!(matches!(outcome, KinematicBoomOutcome::Advanced { .. }));
        assert!(controller.rendered_reach() < 32.25);
        assert!(controller.rendered_reach() >= controller.desired_reach());
    }

    #[test]
    fn control_budget_commits_one_prefix_and_continues_next_tick() {
        let mut controller = controller(1);
        initialize(&mut controller, &empty_scene(), sample());
        let mut moved = sample();
        moved.visual_pivot.coords.x += 2.0;
        moved.target_seed.placement.pose.coords.x += 2.0;

        let first = controller
            .advance(&empty_scene(), 1.0 / 30.0, &[moved])
            .unwrap();
        assert!(matches!(
            first,
            KinematicBoomOutcome::Advanced {
                diagnostics: KinematicBoomDiagnostics {
                    control_legs: 1,
                    ..
                },
                ..
            }
        ));
        assert_eq!(controller.raw_visual_pivot.coords.x, 20.5);

        let second = controller
            .advance(&empty_scene(), 1.0 / 30.0, &[moved])
            .unwrap();
        assert!(matches!(second, KinematicBoomOutcome::Advanced { .. }));
        assert_eq!(controller.raw_visual_pivot.coords.x, 21.0);
    }

    #[test]
    fn orbit_inside_a_corner_keeps_every_interpolated_envelope_clear() {
        let scene = collision_scene(vec![
            wall_x(10.0),
            wall(Plane {
                normal: Vector3::new(0.0, 1.0, 0.0),
                d: -23.0,
            }),
        ]);
        let target = wall_sample();
        let mut controller = wall_controller(Vector3::new(1.0, 0.0, 0.0));
        settle_reach(&mut controller, &scene, target);
        controller
            .accept_intent(KinematicBoomIntent {
                sequence: 1,
                view_direction: Vector3::new(0.0, 1.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            })
            .unwrap();
        let outcome = controller.advance(&scene, 1.0 / 30.0, &[target]).unwrap();
        assert_continuous_path_fits(&scene, &outcome);
        assert_sphere_fits(
            &scene,
            controller.camera(),
            controller.committed_clearance().unwrap().radius,
        );
    }

    #[test]
    fn antipodal_direction_uses_one_deterministic_z_up_arc() {
        let halfway = spherical_interpolate(
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(-1.0, 0.0, 0.0),
            0.5,
        );
        assert!((halfway - Vector3::new(0.0, 1.0, 0.0)).length() < 1.0e-5);
    }

    #[test]
    fn equivalent_recovery_duration_is_independent_of_tick_splits() {
        let scene = empty_scene();
        let mut one = controller(64);
        initialize(&mut one, &scene, sample());
        let mut two = one.clone();
        one.advance(&scene, 1.0 / 15.0, &[sample()]).unwrap();
        two.advance(&scene, 1.0 / 30.0, &[sample()]).unwrap();
        two.advance(&scene, 1.0 / 30.0, &[sample()]).unwrap();
        assert!(
            (one.rendered_reach() - two.rendered_reach()).abs() < 1.0e-5,
            "one={} two={}",
            one.rendered_reach(),
            two.rendered_reach()
        );
    }

    #[test]
    fn equivalent_target_motion_is_independent_of_internal_sample_splits() {
        let scene = empty_scene();
        let mut one = controller(64);
        initialize(&mut one, &scene, sample());
        let mut two = one.clone();
        let mut end = sample();
        end.visual_pivot.coords.x += 1.0;
        end.target_seed.placement.pose.coords.x += 1.0;
        let mut midpoint = end;
        midpoint.end_fraction = 0.5;
        midpoint.visual_pivot.coords.x -= 0.5;
        midpoint.target_seed.placement.pose.coords.x -= 0.5;

        one.advance(&scene, 1.0 / 30.0, &[end]).unwrap();
        two.advance(&scene, 1.0 / 30.0, &[midpoint, end]).unwrap();
        assert!(placement_distance(one.camera().pose, two.camera().pose).unwrap() < 1.0e-5);
        assert!((one.rendered_reach() - two.rendered_reach()).abs() < 1.0e-5);
    }

    #[test]
    fn rapid_orbit_retracts_immediately_then_recovers_monotonically_after_clearance() {
        let scene = wall_scene();
        let mut controller = wall_controller(Vector3::new(0.0, 1.0, 0.0));
        settle_reach(&mut controller, &scene, wall_sample());
        assert!(
            controller.rendered_reach() > 4.49,
            "settled reach={}",
            controller.rendered_reach()
        );
        controller
            .accept_intent(KinematicBoomIntent {
                sequence: 1,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            })
            .unwrap();

        let outcome = controller
            .advance(&scene, 1.0 / 30.0, &[wall_sample()])
            .unwrap();
        assert_continuous_path_fits(&scene, &outcome);
        let KinematicBoomOutcome::Advanced {
            advance: KinematicBoomAdvance::Continuous { path },
            diagnostics,
            ..
        } = outcome
        else {
            panic!("rapid orbit must remain solvable")
        };
        assert!(diagnostics.control_legs > 1);
        assert!(controller.rendered_reach() < 3.0);
        assert!(
            path.legs().iter().all(|leg| leg.end().center().x <= 9.751),
            "every interpolated leg boundary must retain the radius before x=10"
        );

        let retracted_reach = controller.rendered_reach();
        controller
            .accept_intent(KinematicBoomIntent {
                sequence: 2,
                view_direction: Vector3::new(0.0, 1.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            })
            .unwrap();
        let mut previous = retracted_reach;
        for _ in 0..10 {
            controller
                .advance(&scene, 1.0 / 30.0, &[wall_sample()])
                .unwrap();
            let recovered = controller.rendered_reach();
            assert!(recovered >= previous);
            assert!(recovered <= controller.desired_reach());
            previous = recovered;
        }
        assert!(previous > retracted_reach);
    }

    #[test]
    fn wall_graze_preserves_tangential_target_motion_without_reach_chatter() {
        let scene = wall_scene();
        let mut controller = wall_controller(Vector3::new(1.0, 0.0, 0.0));
        settle_reach(&mut controller, &scene, wall_sample());
        let initial_reach = controller.rendered_reach();
        let initial_y = controller.camera().pose.coords.y;

        let mut previous_y = initial_y;
        let mut reaches = vec![initial_reach];
        for step in 1..=6 {
            let mut target = wall_sample();
            target.visual_pivot.coords.y += step as f32 * 0.1;
            target.target_seed.placement.pose.coords.y += step as f32 * 0.1;
            let outcome = controller.advance(&scene, 1.0 / 30.0, &[target]).unwrap();
            assert!(matches!(outcome, KinematicBoomOutcome::Advanced { .. }));
            let camera = controller.camera().pose.coords;
            assert!(camera.x <= 9.751);
            assert!(camera.y >= previous_y);
            previous_y = camera.y;
            reaches.push(controller.rendered_reach());
        }
        assert!(previous_y > initial_y + 0.5);
        assert!((controller.rendered_reach() - initial_reach).abs() < 0.02);
        let direction_reversals = reaches
            .windows(3)
            .filter(|window| {
                let before = window[1] - window[0];
                let after = window[2] - window[1];
                before.abs() > 1.0e-5 && after.abs() > 1.0e-5 && before.signum() != after.signum()
            })
            .count();
        assert_eq!(direction_reversals, 0);
    }

    #[test]
    fn vertical_step_is_lag_clamped_then_converges_monotonically() {
        let scene = empty_scene();
        let mut controller = controller(64);
        settle_reach(&mut controller, &scene, sample());
        let before = controller.camera().pose.coords.z;
        let mut stepped = sample();
        stepped.visual_pivot.coords.z += 0.6;
        stepped.target_seed.placement.pose.coords.z += 0.6;
        controller.advance(&scene, 1.0 / 30.0, &[stepped]).unwrap();
        let first = controller.camera().pose.coords.z;
        assert!(
            (first - before - 0.3).abs() < 0.01,
            "before={before} first={first}"
        );

        let mut previous = first;
        for _ in 0..12 {
            controller.advance(&scene, 1.0 / 30.0, &[stepped]).unwrap();
            let current = controller.camera().pose.coords.z;
            assert!(current >= previous);
            previous = current;
        }
        assert!(previous < before + 0.601);
        assert!(previous > before + 0.58);
    }
}
