//! Authoritative world-state crate for the client.
//!
//! Ownership is split three ways:
//! - [`player`] owns the session-local player model and player-specific mutation helpers.
//! - [`state`] owns [`WorldState`](crate::state::WorldState), entity/spatial invariants, and
//!   world-facing mutation helpers.
//! - [`handlers`] owns feature-based protocol orchestration that translates decoded messages into
//!   narrow state mutations plus [`WorldEvent`] emission.

pub mod assessment;
pub mod book;
pub mod bootstrap;
pub mod context;
pub mod crafting;
pub mod damage;
pub mod entity;
pub mod events;
pub mod handlers;
pub mod hydration;
mod identify;
pub mod inspect;
pub mod magic;
pub mod player;
pub mod spatial;
pub mod spell;
pub mod state;
pub mod stats;
pub mod vendor;

pub use self::state::WorldState;
pub use bootstrap::WorldBootstrap;
pub use events::{DerivedStatsData, FellowshipActivity, PlayerInfoData, WorldEvent};
pub use spatial::{
    AuthoritativeBodySync, BasicSpatialPhysics, ContactState, LocalDriveControl, LocalDriveGait,
    NoopSpatialPhysics, RuntimeBodyResetCause, RuntimeSpatialBodyView,
    SelfPlayerDriveProjectionState, SolveBodyInput, SolveProjectionBasis, SolvedBodyKinematics,
    SpatialBody, SpatialBodyEvent, SpatialBodyId, SpatialEntitySample, SpatialPhysics,
    SpatialSampleMode, SpatialSamplingConfig, SpatialSamplingState, SpatialScene,
    SpatialSolveBatch, SpatialSolveRequest, advance_body_kinematics, project_pose_forward_distance,
};
pub use state::{
    PlayerMotionTableLookupError, PlayerMotionTableResolution, PlayerMotionTableSource,
    RequiredSelfMovementKinematics, SelfMovementCapabilities, SelfMovementCapabilitiesError,
    SelfMovementKinematics, SelfMovementKinematicsError,
};
