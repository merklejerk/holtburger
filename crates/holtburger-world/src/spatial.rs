mod bsp_query;
mod cell_index;
mod collision;
mod collision_report;
#[cfg(test)]
mod differential_fixtures;
mod dynamic_body;
mod dynamic_contact;
mod dynamic_index;
mod free_sphere;
mod grounded;
mod physical_body;
mod physics;
mod scene;
mod types;
mod volume_query;

pub use physics::{
    BasicSpatialPhysics, NoopSpatialPhysics, SpatialPhysics, advance_body_kinematics,
    gate_authored_offset, project_pose_forward_distance,
};
pub use scene::{DynamicBodyRelocationOutcome, SpatialScene};
pub use types::*;

#[cfg(test)]
pub(crate) use physics::project_pose_by_velocity;

#[cfg(test)]
mod tests;
pub use collision::{
    CellTransitRequest, CollisionQueryError, CollisionScene, CollisionSceneUpdateError,
    GroundedObstruction, GroundedObstructionRequest, MotionWaypoint, MotionWaypointPlacement,
    MovementObstructionRequest, MovementRestrictionRequest, PlacedMotionLeg, PlacedMotionPath,
    PlacedMotionPathRequest, PlacedMotionPoint, PlacementRecovery, PlacementRequest,
    PlacementRestrictionRequest, SpatialMembership, SphereSweep, StaticContact,
    StaticSphereSweepHit, StaticSphereSweepRequest, SupportContact, SupportFeature, SupportRequest,
};
pub use collision_report::{
    CollisionReportClassification, CollisionReportContact, CollisionReportOutcome,
    CollisionReportPhase, CollisionReportSource,
};
pub use dynamic_body::{
    DynamicBodyCollisionDefinition, DynamicPhysicalBodyDefinition, PreparedEntityBspPart,
    PreparedEntityTargetGeometry,
};
pub use dynamic_contact::{MAXIMUM_DYNAMIC_SLICE_DISTANCE, MAXIMUM_DYNAMIC_SLICES};
pub use free_sphere::{
    FreeSphereBudget, FreeSphereConfig, FreeSphereOutcome, FreeSphereRequest, FreeSphereState,
    solve_free_sphere,
};
pub use grounded::{
    EdgeProtection, GroundState, GroundSupport, GroundedBody, GroundedBodySpheres, GroundedBudget,
    GroundedConfig, GroundedOutcome, GroundedRequest, GroundedSphere,
    RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z, RETAIL_WALKABLE_NORMAL_Z,
    SettlePermission, solve_grounded,
};
pub(crate) use physical_body::DynamicBodyActivity;
pub use physical_body::{
    DynamicBodyPhysicsStateChange, GroundedBodyActuation, GroundedLaunch, PhysicalBodyActuation,
    PhysicalBodyActuationError, PhysicalBodyDefinition, PhysicalBodyDefinitionError,
    PhysicalBodyMotion, PhysicalBodyParticipation, PhysicalBodyReconfiguration,
    PhysicalBodyReconfigurationOutcome, PhysicalBodyResponsePolicy,
    PhysicalBodyResponsePolicyError, PhysicalBodyResponseState, PhysicalBodySceneResidency,
    PhysicalBodyState, PhysicalBodyTickResult, PhysicalBodyTickStatus, PhysicalCollisionExclusions,
    PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction, PhysicalRestitution,
    PhysicalSphereSet, PhysicalSurfaceMotion, resolve_physical_body_cell,
};
