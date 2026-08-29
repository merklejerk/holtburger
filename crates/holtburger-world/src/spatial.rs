mod bsp_query;
mod cell_index;
mod child_body;
mod collision;
mod collision_report;
mod dead_reckoning;
#[cfg(test)]
mod differential_fixtures;
mod dynamic_body;
mod dynamic_contact;
mod dynamic_index;
mod free_sphere;
mod grounded;
#[cfg(test)]
mod motion_update_retail_differential;
mod physical_body;
mod pose_reconciliation;
#[cfg(test)]
mod pose_reconciliation_retail_differential;
mod scene;
mod types;
mod volume_query;

pub use child_body::{
    ChildSpatialBody, ChildSpatialBodyDefinition, ChildSpatialBodyDefinitionError,
    ChildSpatialBodyWaypoint,
};
pub use dead_reckoning::{
    advance_body_kinematics, gate_authored_offset, project_pose_forward_distance,
};
pub use pose_reconciliation::{
    AuthoritativePoseEffect, AuthoritativePoseResetCause, PoseReconciliationComposition,
    PoseReconciliationState, PoseTranslationSource, RETAIL_INTERPOLATION_NEAR_COMPLETE_DISTANCE_M,
    RETAIL_INTERPOLATION_SNAP_DISTANCE_M, RETAIL_INTERPOLATION_TARGET_THRESHOLD_M,
    RETAIL_MAX_INTERPOLATED_VELOCITY_MPS, damp_constraint_translation, retail_constraint_distances,
    retail_interpolated_speed,
};
pub use scene::{
    DynamicBodyRelocationOutcome, DynamicEntityCollectionCoverageRejection,
    PreparedDynamicEntityCollection, SpatialScene,
};
pub use types::*;

#[cfg(test)]
pub(crate) use dead_reckoning::project_pose_by_velocity;

#[cfg(test)]
mod tests;
pub use collision::{
    CellTransitRequest, CollisionOwnerProof, CollisionQueryError, CollisionQueryPolicy,
    CollisionScene, CollisionSceneUpdateError, GroundedObstruction, GroundedObstructionRequest,
    MotionWaypoint, MotionWaypointPlacement, MovementObstructionRequest,
    MovementRestrictionRequest, PlacedMotionLeg, PlacedMotionPath, PlacedMotionPathRequest,
    PlacedMotionPoint, PlacementRecovery, PlacementRequest, PlacementRestrictionRequest,
    SpatialMembership, SphereSweep, StaticContact, StaticSphereSweepHit, StaticSphereSweepRequest,
    SupportContact, SupportFeature, SupportRequest, UncoveredCollisionQuery,
};
pub use collision_report::{
    CollisionReportClassification, CollisionReportContact, CollisionReportOutcome,
    CollisionReportPhase, CollisionReportSource,
};
pub use dynamic_body::{
    DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyConfigurationError, DynamicPhysicalBodyDefinition, PreparedEntityBspPart,
    PreparedEntityTargetGeometry,
};
pub use dynamic_contact::{MAXIMUM_DYNAMIC_SLICE_DISTANCE, MAXIMUM_DYNAMIC_SLICES};
pub use free_sphere::{
    FreeSphereBudget, FreeSphereConfig, FreeSphereOutcome, FreeSphereRequest,
    FreeSphereSettleOutcome, FreeSphereState, settle_free_sphere, settle_free_sphere_with_policy,
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
    PhysicalSphereSet, PhysicalSurfaceMotion, physical_body_scene_residency,
    resolve_physical_body_cell,
};
