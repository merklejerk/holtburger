mod bsp_query;
mod collision;
mod grounded;
mod physical_body;
mod physical_fly;
mod physics;
mod scene;
mod types;

pub use physics::{
    BasicSpatialPhysics, NoopSpatialPhysics, SpatialPhysics, advance_body_kinematics,
    project_pose_forward_distance,
};
pub use scene::SpatialScene;
pub use types::*;

#[cfg(test)]
pub(crate) use physics::project_pose_by_velocity;

#[cfg(test)]
mod tests;
pub use collision::{
    CellTransitRequest, CollisionPlacement, CollisionQueryError, CollisionScene,
    CollisionSceneUpdateError, GroundedObstruction, GroundedObstructionRequest, MotionWaypoint,
    MotionWaypointPlacement, MovementObstructionRequest, MovementRestrictionRequest,
    PlacedMotionLeg, PlacedMotionPath, PlacedMotionPathRequest, PlacedMotionPoint,
    PlacementRecovery, PlacementRequest, PlacementRestrictionRequest, SphereSweep, StaticContact,
    SupportContact, SupportFeature, SupportRequest,
};
pub use grounded::{
    EdgeProtection, GroundSupport, GroundedBody, GroundedBodySpheres, GroundedBudget,
    GroundedConfig, GroundedOutcome, GroundedRequest, GroundedSphere, RETAIL_WALKABLE_NORMAL_Z,
    solve_grounded,
};
pub use physical_body::{
    GroundedBodyActuation, GroundedLaunch, PhysicalBodyActuation, PhysicalBodyActuationError,
    PhysicalBodyDefinition, PhysicalBodyDefinitionError, PhysicalBodyMotion,
    PhysicalBodyResponsePolicy, PhysicalBodyResponsePolicyError, PhysicalBodyResponseState,
    PhysicalBodySceneResidency, PhysicalBodyState, PhysicalBodyTickResult, PhysicalBodyTickStatus,
    PhysicalCollisionExclusions, PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction,
    PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, resolve_physical_body_cell,
};
pub use physical_fly::{
    PhysicalFlyBody, PhysicalFlyBudget, PhysicalFlyConfig, PhysicalFlyOutcome, PhysicalFlyRequest,
    solve_physical_fly,
};
