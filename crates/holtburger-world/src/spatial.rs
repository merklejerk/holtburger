mod bsp_query;
mod collision;
#[cfg(test)]
mod differential_fixtures;
mod dynamic_body;
mod grounded;
mod physical_body;
mod physical_fly;
mod physics;
mod scene;
mod types;
mod volume_query;

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
pub use dynamic_body::{
    DynamicBodyCollisionDefinition, DynamicPhysicalBodyDefinition, PreparedEntityBspPart,
    PreparedEntityTargetGeometry,
};
pub use grounded::{
    EdgeProtection, GroundState, GroundSupport, GroundedBody, GroundedBodySpheres, GroundedBudget,
    GroundedConfig, GroundedOutcome, GroundedRequest, GroundedSphere,
    RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z, RETAIL_WALKABLE_NORMAL_Z,
    SettlePermission, solve_grounded,
};
pub use physical_body::{
    GroundedBodyActuation, GroundedLaunch, PhysicalBodyActuation, PhysicalBodyActuationError,
    PhysicalBodyDefinition, PhysicalBodyDefinitionError, PhysicalBodyMotion,
    PhysicalBodyParticipation, PhysicalBodyReconfiguration, PhysicalBodyReconfigurationOutcome,
    PhysicalBodyResponsePolicy, PhysicalBodyResponsePolicyError, PhysicalBodyResponseState,
    PhysicalBodySceneResidency, PhysicalBodyState, PhysicalBodyTickResult, PhysicalBodyTickStatus,
    PhysicalCollisionExclusions, PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction,
    PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, resolve_physical_body_cell,
};
pub use physical_fly::{
    PhysicalFlyBody, PhysicalFlyBudget, PhysicalFlyConfig, PhysicalFlyOutcome, PhysicalFlyRequest,
    solve_physical_fly,
};
