use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};

/// Typed terminal failure for one exact physical-fly generation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyFailure {
    pub session: u64,
    pub message: String,
}

/// Retail sphere radius used to resolve the render viewer's portal placement independently.
///
/// The global `viewer_sphere` is initialized to 0.3 meters (`acclient.c:139301-139305`) and
/// transitioned on every normal draw (`acclient.c:138800-138918`).
pub const VIEWER_SPHERE_RADIUS: f32 = 0.300;

/// Explorer-owned translation response applied before generic physical-body solving.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PhysicalFlySpeedEnvelope {
    /// Apply requested speed immediately.
    Instant,
    /// Linearly ramp a held nonzero request from an initial fraction to full speed.
    LinearRamp {
        /// Seconds of uninterrupted movement input required to reach full speed.
        #[serde(rename = "accelerationSeconds")]
        acceleration_seconds: f32,
        /// Fraction of requested speed applied when movement begins.
        #[serde(rename = "initialSpeedMultiplier")]
        initial_speed_multiplier: f32,
    },
}

impl PhysicalFlySpeedEnvelope {
    pub(super) fn validate(self) -> Result<Self> {
        if let Self::LinearRamp {
            acceleration_seconds,
            initial_speed_multiplier,
        } = self
        {
            ensure!(
                acceleration_seconds.is_finite() && acceleration_seconds > 0.0,
                "physical fly acceleration duration must be finite and positive"
            );
            ensure!(
                initial_speed_multiplier.is_finite()
                    && (0.0..=1.0).contains(&initial_speed_multiplier),
                "physical fly initial speed multiplier must be finite and within [0, 1]"
            );
        }
        Ok(self)
    }
}

/// World-space velocity requested by Explorer policy, expressed in AC axes.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyIntent {
    /// Runtime generation this intent targets.
    pub session: u64,
    /// Monotonic input revision within `session`; stale async commands are ignored.
    pub sequence: u64,
    /// Monotonic nonzero-input generation used to preserve stop/start across async reordering.
    pub movement_epoch: u64,
    /// Cumulative one-shot AC-world displacement requested during this session.
    pub world_displacement_total: [f32; 3],
    /// Desired AC-world velocity `[east, north, up]` in meters per second.
    pub world_velocity: [f32; 3],
}

/// Ground classification of the camera body, mirroring the world's `ContactState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalFlyGroundState {
    /// No collision transaction has classified the body yet.
    Unknown,
    /// No contact plane.
    Airborne,
    /// A retained contact plane below the walkable threshold: descending along a surface the
    /// body cannot stand on.
    Sliding,
    /// Walkable lower-sphere support.
    Supported,
}

impl From<holtburger_world::ContactState> for PhysicalFlyGroundState {
    fn from(contact: holtburger_world::ContactState) -> Self {
        // The contract renames `Grounded` to `Supported`: the camera surface reports the ground
        // relationship, and "grounded" already names the walkable-only boolean elsewhere.
        match contact {
            holtburger_world::ContactState::Unknown => Self::Unknown,
            holtburger_world::ContactState::Airborne => Self::Airborne,
            holtburger_world::ContactState::Sliding => Self::Sliding,
            holtburger_world::ContactState::Grounded => Self::Supported,
        }
    }
}

impl Default for PhysicalFlyIntent {
    fn default() -> Self {
        Self {
            session: 0,
            sequence: 0,
            movement_epoch: 0,
            world_displacement_total: [0.0; 3],
            world_velocity: [0.0; 3],
        }
    }
}

/// Observable outcome attached to a solved fixed-tick path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalFlyTickStatus {
    /// The solver committed an accepted pose against the installed collision snapshot.
    Solved,
    /// The request exceeded its bounded anti-tunneling budget.
    SubstepBudgetExceeded,
    /// Contact separation did not converge inside the bounded pass budget.
    ContactBudgetExceeded,
}

/// Non-gating residency of the physical body's final primary-sphere owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum PhysicalFlySceneResidency {
    /// Collision products for the final canonical owner are installed.
    Resident,
    /// The final canonical owner is outside current collision interest.
    MissingOwner {
        /// Canonical owner a consumer may choose to request.
        landblock_id: String,
    },
    /// The final primary sphere is beyond AC's authored outdoor landscape.
    OutsideLandscape,
}

/// Authoritative scene residency committed with one physical-fly pose.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyResidency {
    /// Normalized owner of the landblock-local presented origin.
    pub landblock_id: String,
    /// Committed interior cell containing the presented viewer sphere.
    pub env_cell_id: Option<String>,
}

/// Complete frontend-presented placement used to register physical fly.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyRegistration {
    /// Canonical scene position `[east, up, south]` currently applied to the renderer.
    pub scene_position: [f32; 3],
    /// Portal-history seed currently applied to the renderer and revalidated against host topology.
    pub residency: PhysicalFlyResidency,
    /// Explorer translation response validated before the body is registered.
    pub speed_envelope: PhysicalFlySpeedEnvelope,
}

/// Registration generation for the active physical-fly camera.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyStartReceipt {
    pub session: u64,
}

impl PhysicalFlyStartReceipt {
    pub const fn new(session: u64) -> Self {
        Self { session }
    }
}

/// One frontend point whose position and portal residency become authoritative together.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyPathPoint {
    /// Portal-seeded placement valid at this exact point.
    pub residency: PhysicalFlyResidency,
    /// Presented viewer origin in `residency.landblock_id` local AC axes.
    pub origin: [f32; 3],
}

/// One placement-stable frontend leg ending at an authoritative point.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyPathLeg {
    /// Monotonic normalized fixed-tick fraction at this boundary.
    pub end_fraction: f32,
    /// Point and residency that become authoritative at the exact boundary.
    pub end: PhysicalFlyPathPoint,
}

/// One fixed-tick path evaluated by the frontend on every render frame.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyMotionPath {
    /// Runtime generation. Events from an older handoff are ignored by the frontend.
    pub session: u64,
    /// Monotonic path counter within `session`; gaps remain diagnostic evidence.
    pub sequence: u64,
    /// Fixed host-tick duration used to time the normalized legs.
    pub duration_ms: f64,
    /// Authoritative viewer placement at normalized tick fraction zero.
    pub initial: PhysicalFlyPathPoint,
    /// Non-empty accepted motion and placement transitions through the fixed tick.
    pub legs: Vec<PhysicalFlyPathLeg>,
    /// Solver completion or finite-budget result.
    pub status: PhysicalFlyTickStatus,
    /// Installed collision residency, independent from solver completion.
    pub scene_residency: PhysicalFlySceneResidency,
    /// Ground classification committed by the latest solve.
    pub ground_state: PhysicalFlyGroundState,
    /// Distinct non-walkable planes encountered during the latest grounded solve.
    pub constraint_count: usize,
    /// Collision substeps consumed by this tick.
    pub substeps: usize,
    /// Contact-separation passes consumed by this tick.
    pub contact_passes: usize,
    /// Host wall time spent solving the body and portal-transiting the viewer for this tick.
    pub solve_duration_ms: f64,
}
