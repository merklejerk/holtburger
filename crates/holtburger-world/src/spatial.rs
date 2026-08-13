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
    CellTransitRequest, CollisionPlacement, CollisionQuery, CollisionQueryError, CollisionScene,
    CollisionSceneUpdateError, CoverageRequest, GroundedObstruction, GroundedObstructionRequest,
    MissingCoverage, MotionWaypoint, MovementObstructionRequest, PlacedMotionLeg, PlacedMotionPath,
    PlacedMotionPathRequest, PlacedMotionPoint, PlacementRequest, StaticContact, SupportContact,
    SupportFeature, SupportRequest,
};
pub use grounded::{
    EdgeProtection, GroundSupport, GroundedBody, GroundedBodySpheres, GroundedBudget,
    GroundedConfig, GroundedOutcome, GroundedRequest, GroundedSphere, solve_grounded,
};
pub use physical_body::{
    InvalidPhysicalBodyPlacement, PhysicalBodyActivity, PhysicalBodyDefinition,
    PhysicalBodyDefinitionError, PhysicalBodyMotion, PhysicalBodyResponseState, PhysicalBodyState,
    PhysicalBodyTickOutcome, PhysicalBodyTickResult, PhysicalBodyTickStatus, PhysicalSphereSet,
    evaluate_physical_body_activity, initial_physical_body_activity, resolve_physical_body_cell,
};
pub use physical_fly::{
    PhysicalFlyBody, PhysicalFlyBudget, PhysicalFlyConfig, PhysicalFlyOutcome, PhysicalFlyRequest,
    solve_physical_fly,
};
