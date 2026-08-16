use anyhow::{Context, Result, ensure};
use holtburger_core::client::movement_types::{
    Gait, LateralMotion, LongitudinalMotion, MotionState, Turn,
};
use holtburger_core::{CharacterJumpKinematics, CharacterMovementKinematics, JumpChargeProfile};
use serde::{Deserialize, Serialize};

use crate::host_simulation_runtime::{PhysicalBodyDefinitionRequest, PhysicalResponseRequest};

/// Typed terminal failure for one exact physical-camera generation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraFailure {
    pub session: u64,
    pub message: String,
}

/// Retail first-person pivot height above the grounded body reference.
///
/// `SmartBox::set_viewer_home` authors this offset (`acclient.c:138168-138196`).
pub const HUMAN_EYE_HEIGHT: f32 = 1.500;

/// Retail first-person viewer offset along the complete pitched view direction.
///
/// `CameraSet::SetInHead` authors `(0, 0.18, 0)` (`acclient.c:142853-142880`).
pub const FIRST_PERSON_FORWARD_OFFSET: f32 = 0.180;

/// Retail sphere radius used to resolve the render viewer's portal placement independently.
///
/// The global `viewer_sphere` is initialized to 0.3 meters (`acclient.c:139301-139305`) and
/// transitioned on every normal draw (`acclient.c:138800-138918`).
pub const VIEWER_SPHERE_RADIUS: f32 = 0.300;

/// Explorer physical response selected for one host session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalCameraMode {
    /// Collision-aware free flight with a single camera sphere.
    PhysicalFly,
    /// Gravity, support, steps, and edge protection over the authored human pair.
    GroundedWalk,
}

pub(super) fn camera_mode_matches_response(
    mode: PhysicalCameraMode,
    response: PhysicalResponseRequest,
) -> bool {
    matches!(
        (mode, response),
        (
            PhysicalCameraMode::PhysicalFly,
            PhysicalResponseRequest::FreeSphere { .. }
        ) | (
            PhysicalCameraMode::GroundedWalk,
            PhysicalResponseRequest::Grounded { .. }
        )
    )
}

/// Mode-specific Explorer control policy supplied at registration.
///
/// The tagged contract makes a grounded body carrying physical-fly acceleration state
/// unrepresentable.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PhysicalCameraControlRequest {
    /// Collision-aware free flight with host-side translation acceleration.
    PhysicalFly {
        /// Explorer translation response applied to concrete fly velocity intent.
        #[serde(rename = "speedEnvelope")]
        speed_envelope: PhysicalCameraSpeedEnvelope,
    },
    /// Semantic grounded character control over owner-supplied numeric capabilities.
    GroundedCharacter {
        /// Capabilities resolved by the owner of this synthetic actor and validated by the host.
        capabilities: CharacterMotionCapabilitiesRequest,
    },
}

/// Source-neutral numeric capabilities supplied by the owner of a character controller.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CharacterMotionCapabilitiesRequest {
    /// Base forward speed selected by walking gait.
    pub base_walk_forward_speed: f32,
    /// Base forward speed selected by running gait.
    pub base_run_forward_speed: f32,
    /// Actor-specific run-rate scalar.
    pub run_rate_scalar: f32,
    /// Full-charge jump apex before retail's minimum-height floor.
    pub full_charge_jump_height: f32,
}

impl CharacterMotionCapabilitiesRequest {
    pub(super) fn resolve(self) -> Result<CharacterJumpKinematics> {
        let movement = CharacterMovementKinematics::new(
            self.base_walk_forward_speed,
            self.base_run_forward_speed,
            self.run_rate_scalar,
        )?;
        Ok(CharacterJumpKinematics::new(
            movement,
            self.full_charge_jump_height,
        )?)
    }
}

impl PhysicalCameraControlRequest {
    pub fn mode(self) -> PhysicalCameraMode {
        match self {
            Self::PhysicalFly { .. } => PhysicalCameraMode::PhysicalFly,
            Self::GroundedCharacter { .. } => PhysicalCameraMode::GroundedWalk,
        }
    }

    pub(super) fn validate(self) -> Result<ValidatedPhysicalCameraControl> {
        Ok(match self {
            Self::PhysicalFly { speed_envelope } => ValidatedPhysicalCameraControl::PhysicalFly {
                speed_envelope: speed_envelope.validate()?,
            },
            Self::GroundedCharacter { capabilities } => {
                ValidatedPhysicalCameraControl::GroundedCharacter {
                    kinematics: capabilities.resolve()?,
                }
            }
        })
    }
}

/// Registration policy validated before any physical body is created.
#[derive(Debug, Clone, Copy)]
pub(super) enum ValidatedPhysicalCameraControl {
    PhysicalFly {
        speed_envelope: PhysicalCameraSpeedEnvelope,
    },
    GroundedCharacter {
        /// Static Explorer adapter input; playable actors resolve mutable facts per attempt.
        kinematics: CharacterJumpKinematics,
    },
}

/// Explorer-owned translation response applied before generic physical-body solving.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PhysicalCameraSpeedEnvelope {
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

impl PhysicalCameraSpeedEnvelope {
    pub(super) fn validate(self) -> Result<Self> {
        if let Self::LinearRamp {
            acceleration_seconds,
            initial_speed_multiplier,
        } = self
        {
            ensure!(
                acceleration_seconds.is_finite() && acceleration_seconds > 0.0,
                "physical camera acceleration duration must be finite and positive"
            );
            ensure!(
                initial_speed_multiplier.is_finite()
                    && (0.0..=1.0).contains(&initial_speed_multiplier),
                "physical camera initial speed multiplier must be finite and within [0, 1]"
            );
        }
        Ok(self)
    }
}

/// World-space velocity requested by Explorer policy, expressed in AC axes.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyCameraIntent {
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
    /// Unit first-person view direction in AC world axes.
    pub view_direction: [f32; 3],
}

/// Ground classification of the camera body, mirroring the world's `ContactState`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CameraGroundState {
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

impl From<holtburger_world::ContactState> for CameraGroundState {
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

/// Browser-independent semantic character drive submitted to grounded camera control.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundedCameraDriveRequest {
    pub gait: GroundedCameraGait,
    pub longitudinal: Option<GroundedCameraLongitudinal>,
    pub lateral: Option<GroundedCameraLateral>,
    pub turn: Option<GroundedCameraTurn>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GroundedCameraGait {
    Walk,
    Run,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GroundedCameraLongitudinal {
    Forward,
    Backward,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GroundedCameraLateral {
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GroundedCameraTurn {
    Left,
    Right,
}

impl GroundedCameraDriveRequest {
    pub(super) fn resolve(self) -> MotionState {
        MotionState {
            gait: match self.gait {
                GroundedCameraGait::Walk => Gait::Walk,
                GroundedCameraGait::Run => Gait::Run,
            },
            longitudinal: self.longitudinal.map(|axis| match axis {
                GroundedCameraLongitudinal::Forward => LongitudinalMotion::Forward,
                GroundedCameraLongitudinal::Backward => LongitudinalMotion::Backward,
            }),
            lateral: self.lateral.map(|axis| match axis {
                GroundedCameraLateral::Left => LateralMotion::Left,
                GroundedCameraLateral::Right => LateralMotion::Right,
            }),
            turning: self.turn.map(|axis| match axis {
                GroundedCameraTurn::Left => Turn::Left,
                GroundedCameraTurn::Right => Turn::Right,
            }),
            turn_rate_scalar: None,
        }
    }
}

/// Coalescible grounded drive and view snapshot.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundedCameraDriveIntent {
    pub session: u64,
    /// Monotonic revision shared with lifecycle edges in this ownership epoch.
    pub revision: u64,
    pub drive: GroundedCameraDriveRequest,
    /// Unit first-person view direction in AC world axes.
    pub view_direction: [f32; 3],
}

/// One ordered, non-coalescible grounded character lifecycle request.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum GroundedCameraEventKind {
    BeginJump {
        drive: GroundedCameraDriveRequest,
    },
    ReleaseJump {
        drive: GroundedCameraDriveRequest,
        extent: f32,
    },
    Reset,
}

/// Session, transport ordering, and semantic payload for one lifecycle edge.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundedCameraEventRequest {
    pub session: u64,
    /// Contiguous lifecycle sequence; unlike drive revisions, every value must be observed.
    pub sequence: u64,
    /// Monotonic revision shared with coalescible drive snapshots.
    pub revision: u64,
    /// View direction captured atomically with this lifecycle edge.
    pub view_direction: [f32; 3],
    #[serde(flatten)]
    pub event: GroundedCameraEventKind,
}

/// Immediate transport-level result; semantic acceptance is reported by the next fixed-tick path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GroundedCameraQueueResult {
    Queued,
    IgnoredStaleSession,
    RejectedWrongMode,
    IgnoredDuplicate,
}

/// Fixed-tick result for one character lifecycle edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundedCameraEventOutcome {
    pub sequence: u64,
    #[serde(flatten)]
    pub result: GroundedCameraEventOutcomeKind,
}

/// Typed semantic or body-readiness result consumed by optimistic Explorer presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum GroundedCameraEventOutcomeKind {
    ChargeAccepted,
    ChargeContinues,
    JumpReleased,
    Reset,
    Rejected { reason: GroundedCameraRejection },
    IgnoredStale,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GroundedCameraRejection {
    ChargeNotActive,
    Unsupported,
    Airborne,
    Constrained,
    InvalidHeading,
}

impl Default for PhysicalFlyCameraIntent {
    fn default() -> Self {
        Self {
            session: 0,
            sequence: 0,
            movement_epoch: 0,
            world_displacement_total: [0.0; 3],
            world_velocity: [0.0; 3],
            view_direction: [0.0, 1.0, 0.0],
        }
    }
}

/// Observable outcome attached to a solved fixed-tick path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalCameraTickStatus {
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
pub enum PhysicalCameraSceneResidency {
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

/// Authoritative scene residency committed with one physical-camera pose.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraResidency {
    /// Normalized owner of the landblock-local presented origin.
    pub landblock_id: String,
    /// Committed interior cell containing the presented viewer sphere.
    pub env_cell_id: Option<String>,
}

/// Complete frontend-presented placement used to register one physical camera mode.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraRegistration {
    /// Canonical scene position `[east, up, south]` currently applied to the renderer.
    pub scene_position: [f32; 3],
    /// Portal-history seed currently applied to the renderer and revalidated against host topology.
    pub residency: PhysicalCameraResidency,
    /// Unit first-person view direction in AC world axes.
    pub view_direction: [f32; 3],
    /// Explicit input/controller regime, independent from physical body geometry and response.
    pub control: PhysicalCameraControlRequest,
    /// Explicit source-neutral geometry and response configuration for the generic body.
    pub body: PhysicalBodyDefinitionRequest,
}

/// Registration generation plus host-supplied charge presentation policy.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraStartReceipt {
    pub session: u64,
    /// Present only for the grounded character-control regime.
    pub jump_charge_duration_ms: Option<u64>,
}

impl PhysicalCameraStartReceipt {
    pub fn new(session: u64, mode: PhysicalCameraMode) -> Result<Self> {
        let jump_charge_duration_ms = match mode {
            PhysicalCameraMode::PhysicalFly => None,
            PhysicalCameraMode::GroundedWalk => Some(
                JumpChargeProfile::RETAIL_STANDARD
                    .full_charge_duration()
                    .as_millis()
                    .try_into()
                    .context("Explorer jump charge duration exceeds u64 milliseconds")?,
            ),
        };
        Ok(Self {
            session,
            jump_charge_duration_ms,
        })
    }
}

/// One frontend point whose position and portal residency become authoritative together.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraPathPoint {
    /// Portal-seeded placement valid at this exact point.
    pub residency: PhysicalCameraResidency,
    /// Presented viewer origin in `residency.landblock_id` local AC axes.
    pub origin: [f32; 3],
}

/// One placement-stable frontend leg ending at an authoritative point.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraPathLeg {
    /// Monotonic normalized fixed-tick fraction at this boundary.
    pub end_fraction: f32,
    /// Point and residency that become authoritative at the exact boundary.
    pub end: PhysicalCameraPathPoint,
}

/// One fixed-tick path evaluated by the frontend on every render frame.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalCameraMotionPath {
    /// Runtime generation. Events from an older handoff are ignored by the frontend.
    pub session: u64,
    /// Monotonic path counter within `session`; gaps remain diagnostic evidence.
    pub sequence: u64,
    /// Physical response that produced this path.
    pub mode: PhysicalCameraMode,
    /// Fixed host-tick duration used to time the normalized legs.
    pub duration_ms: f64,
    /// Authoritative viewer placement at normalized tick fraction zero.
    pub initial: PhysicalCameraPathPoint,
    /// Non-empty accepted motion and placement transitions through the fixed tick.
    pub legs: Vec<PhysicalCameraPathLeg>,
    /// Solver completion or finite-budget result.
    pub status: PhysicalCameraTickStatus,
    /// Installed collision residency, independent from solver completion.
    pub scene_residency: PhysicalCameraSceneResidency,
    /// Ground classification committed by the latest solve.
    pub ground_state: CameraGroundState,
    /// Distinct non-walkable planes encountered during the latest grounded solve.
    pub constraint_count: usize,
    /// Collision substeps consumed by this tick.
    pub substeps: usize,
    /// Contact-separation passes consumed by this tick.
    pub contact_passes: usize,
    /// Host wall time spent solving the body and portal-transiting the viewer for this tick.
    pub solve_duration_ms: f64,
    /// Ordered grounded lifecycle outcomes processed immediately before this solve.
    pub character_event_outcomes: Vec<GroundedCameraEventOutcome>,
}
