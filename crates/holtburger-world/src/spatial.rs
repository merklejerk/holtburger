mod bsp_query;
mod cell_index;
mod child_body;
mod collision;
mod collision_report;
mod dead_reckoning;
#[cfg(test)]
mod differential_fixtures;
mod dynamic_body;
mod dynamic_index;
mod free_sphere;
mod grounded;
mod mobile_contact;
#[cfg(test)]
mod motion_update_retail_differential;
mod physical_body;
mod physics_work;
#[cfg(feature = "physics-profiling")]
pub use physics_work::{PhysicsWork, take_physics_work};
mod body_movement;
mod pose_reconciliation;
#[cfg(test)]
mod pose_reconciliation_retail_differential;
mod scene;
mod types;
mod volume_query;

pub use mobile_contact::{
    ContactBodyPath, ContactBodyUpdate, ContactCollectionUpdate, ContactImpactPoint,
    ContactMobility, ContactMotionSegment, ContactStepActuation, GroundedContactState,
    MOBILE_CONTACT_ANGULAR_CHORDS, MOBILE_CONTACT_CORRECTION_FRACTION,
    MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO, MOBILE_CONTACT_HARD_SLIDE_PASSES,
    MOBILE_CONTACT_PASSES, MOBILE_CONTACT_TICK_SECONDS, MOBILE_CONTACT_TOLERANCE_METERS,
    MOBILE_CONTACT_TOLERANCE_RADIUS_RATIO, MobileContactBody, MobileContactChange,
    MobileContactResponse, PASSIVE_MOTOR_ACCELERATION, PASSIVE_MOTOR_BRAKING,
    admit_physical_duration, advance_body_contact_collection, advance_body_contacts,
    resolve_mobile_contact,
};

pub use body_movement::{PHYSICAL_RETURN_GAIN, StickyBodyTarget};

pub use child_body::{
    ChildSpatialBody, ChildSpatialBodyDefinition, ChildSpatialBodyDefinitionError,
    ChildSpatialBodyWaypoint,
};
pub use dead_reckoning::{
    advance_body_kinematics, gate_authored_offset, project_pose_forward_distance,
};
pub use pose_reconciliation::{
    AuthoritativePoseEffect, AuthoritativePoseResetCause, PHYSICAL_RETURN_START_THRESHOLD_M,
    PhysicalReferenceDomain, PoseReconciliationComposition, PoseReconciliationState,
    PoseTranslationSource, RETAIL_INTERPOLATION_NEAR_COMPLETE_DISTANCE_M,
    RETAIL_INTERPOLATION_SNAP_DISTANCE_M, RETAIL_INTERPOLATION_TARGET_THRESHOLD_M,
    RETAIL_MAX_INTERPOLATED_VELOCITY_MPS, damp_constraint_translation, retail_constraint_distances,
    retail_interpolated_speed,
};
pub(crate) use scene::integrate_angular_velocity;
pub use scene::{
    DynamicBodyRelocationOutcome, DynamicEntityBodyOutcome, DynamicEntityBodyTick,
    DynamicEntityCollectionCoverageRejection, DynamicEntityCollectionTick, SpatialScene,
};
pub use types::*;

#[cfg(test)]
pub(crate) use dead_reckoning::project_pose_by_velocity;

#[cfg(test)]
mod tests;
pub use collision::{
    AvailableEntitySelectionCandidates, CellTransitRequest, CollisionOwnerProof,
    CollisionQueryError, CollisionQueryPolicy, CollisionScene, CollisionSceneUpdateError,
    CollisionSurfaceRayHit, EntitySelectionCandidateResult, EntitySelectionQueryError,
    EntitySelectionRayRequest, EntitySelectionUnavailable, EntitySurfaceRayHit,
    GroundedObstruction, GroundedObstructionRequest, HardEntityShape, HardSphereSweep,
    HardSphereSweepHit, MotionWaypoint, MotionWaypointPlacement, MovementObstructionRequest,
    MovementRestrictionRequest, PlacedMotionLeg, PlacedMotionPath, PlacedMotionPathRequest,
    PlacedMotionPoint, PlacementRecovery, PlacementRequest, PlacementRestrictionRequest,
    SpatialMembership, SphereSweep, StaticContact, StaticSphereSweepHit, StaticSphereSweepRequest,
    StaticSurfaceRayHit, StaticSurfaceRayRequest, SupportContact, SupportFeature, SupportRequest,
    SupportSource, UncoveredCollisionQuery,
};
pub use collision_report::{
    CollisionReportClassification, CollisionReportContact, CollisionReportOutcome,
    CollisionReportPhase, CollisionReportSource, CollisionReportTouch,
};
pub use dynamic_body::{
    DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyConfigurationError, DynamicPhysicalBodyDefinition, EntityContactResponse,
    PreparedEntityBspPart, PreparedEntityTargetGeometry,
};
pub use dynamic_index::{EntityCollisionProof, EntityCollisionSnapshot};
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
    PhysicalBodyState, PhysicalBodyTickResult, PhysicalCollisionExclusions,
    PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction, PhysicalRestitution,
    PhysicalSphereSet, PhysicalSurfaceMotion, physical_body_scene_residency,
    resolve_physical_body_cell,
};
