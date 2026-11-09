//! Shared grounded geometry, state, and response policy consumed by the contact runtime.

use super::SupportFeature;
#[cfg(test)]
use super::collision::CollisionOwnerProof;
#[cfg(test)]
use holtburger_common::Guid;
use holtburger_common::Vector3;

/// Retail's minimum upward surface-normal component for walkable support.
///
/// `RETAIL_WALKABLE_NORMAL_Z` is initialized once and consumed by retail object is valid
/// walkable.
pub const RETAIL_WALKABLE_NORMAL_Z: f32 = 0.664_174_14;

/// Retail's lenient landing allowance for bodies without walkable support.
///
/// A transition prepared while the body lacks `OnWalkable` writes `0.0871557` (cos 85°) into
/// `walkable_allowance`, so a falling body accepts nearly any upward-tilted surface as a
/// landing contact. The walking threshold above still decides whether that contact is walkable.
pub const RETAIL_LANDING_NORMAL_Z: f32 = 0.087_155_7;

/// Retail's step-down reach for bodies without walkable support.
pub const RETAIL_AIRBORNE_STEP_DOWN_HEIGHT: f32 = 0.04;

/// Retail stops continuation after two consecutive stationary falling transitions.
pub(crate) const STATIONARY_FALL_STOP_FRAMES: u8 = 2;
/// Retail supplies horizontal recovery support on the third stationary falling transition.
pub(crate) const STATIONARY_FALL_SUPPORT_FRAMES: u8 = 3;

/// Authored grounded-response policy used by the contact runtime.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedConfig {
    /// Downward world acceleration in meters per second squared.
    pub gravity: f32,
    /// Minimum upward normal component that may support the lower sphere while walking.
    pub walkable_normal_z: f32,
    /// Minimum upward normal component a body without walkable support accepts as a landing
    /// contact; landings between this and `walkable_normal_z` classify as contact-slide.
    pub landing_normal_z: f32,
    /// Step-down reach used by the lenient landing probe of a body without walkable support.
    pub airborne_step_down_height: f32,
    /// Authored step-search amount, excluding ordinary travel. Finite BSP faces apply retail's
    /// interpolation bound, which can admit a correction greater than this amount. Setup volumes
    /// require clearance over their full top before a step or upward standing recovery.
    pub step_up_height: f32,
    /// Maximum vertical distance used to retain or acquire support after movement.
    pub step_down_height: f32,
    /// Whether a previously supported body may leave its footing.
    pub edge_protection: EdgeProtection,
    /// Minimum net ascent that justifies a separate stair maneuver.
    pub minimum_stair_rise: f32,
}

/// Grounded response when requested motion leaves the current footing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeProtection {
    /// Accept the unsupported candidate and begin falling.
    None,
    /// Preserve the last supported pose when no supported edge slide is available.
    Creature,
}

/// One sphere center authored relative to the body's pose.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedSphere {
    /// Body-local center transformed by the pose rotation for every candidate.
    pub center: Vector3,
    /// Positive sphere radius in meters.
    pub radius: f32,
}

/// The asymmetric authored body shape consumed by grounded response.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedBodySpheres {
    /// Required lower sphere; this sphere alone may support or choose the committed cell.
    pub support: GroundedSphere,
    /// Optional upper sphere; it constrains placement but never provides support.
    pub upper: Option<GroundedSphere>,
}

/// Retained walkable support selected by the grounded response.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundSupport {
    /// Effective outward-facing unit normal; stationary-fall recovery supplies world up.
    pub normal: Vector3,
    /// Footprint classification retained for bounded edge guidance.
    pub feature: SupportFeature,
    /// World proof or hard entity identity controlling support revalidation.
    pub source: super::SupportSource,
}

#[cfg(test)]
impl GroundSupport {
    pub(crate) const fn fixture(normal: Vector3) -> Self {
        Self {
            feature: SupportFeature::Surface,
            normal,
            source: crate::spatial::SupportSource::World(CollisionOwnerProof::fixture(Guid(
                0xda55_ffff,
            ))),
        }
    }
}

/// The body's derived ground state, mirroring retail's observable transient combinations.
///
/// This is the solver-owned source; the lifecycle-facing [`ContactState`](super::ContactState)
/// (which adds `Unknown`) is projected from it at the grounded tick commit and must never be
/// written back over a solved body (see `SpatialScene::apply_runtime_body_contact`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GroundState {
    /// A contact plane at or above the walking threshold: retail `Contact && OnWalkable`.
    Supported(GroundSupport),
    /// A contact plane below the walking threshold: retail `Contact && !OnWalkable`. Gravity
    /// stays applied and no friction runs (`calc_acceleration`, `calc_friction`); motion is
    /// ballistic with the plane retained for classification and reporting.
    Sliding(GroundSupport),
    /// No contact plane.
    Airborne,
}

impl GroundState {
    /// The walkable support plane, when the body is supported.
    pub fn walkable_support(self) -> Option<GroundSupport> {
        match self {
            Self::Supported(support) => Some(support),
            Self::Sliding(_) | Self::Airborne => None,
        }
    }

    /// The retained contact plane, walkable or sliding.
    pub fn contact_plane(self) -> Option<GroundSupport> {
        match self {
            Self::Supported(support) | Self::Sliding(support) => Some(support),
            Self::Airborne => None,
        }
    }
}
