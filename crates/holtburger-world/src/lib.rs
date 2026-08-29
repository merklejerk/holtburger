//! Authoritative world-state crate for the client.
//!
//! Ownership is split three ways:
//! - [`player`] owns the session-local player model and player-specific mutation helpers.
//! - [`state`] owns [`WorldState`](crate::state::WorldState), entity/spatial invariants, and
//!   world-facing mutation helpers.
//! - [`handlers`] owns feature-based protocol orchestration that translates decoded messages into
//!   narrow state mutations plus [`WorldEvent`] emission.

pub mod assessment;
pub mod attachment;
pub mod book;
pub mod bootstrap;
pub mod context;
pub mod crafting;
pub mod damage;
pub mod entity;
pub mod entity_appearance;
pub mod entity_physics;
pub mod events;
pub mod handlers;
pub mod hydration;
mod identify;
pub mod inspect;
pub mod magic;
pub mod motion;
pub mod player;
pub mod spatial;
pub mod spell;
pub mod state;
pub mod stats;
pub mod vendor;

pub use self::state::WorldState;
pub use attachment::{AttachmentError, EntityPlacement, PhysicsAttachment};
pub use bootstrap::WorldBootstrap;
pub use entity_appearance::{
    EntityAppearance, EntityPartChange, EntitySubPalette, EntityTextureChange, HeldItemPlacement,
    PaintedWieldedItem, WieldedItemClassification, WieldedItemClassificationError,
    WieldedItemSlotFacts, classify_wielded_item,
};
pub use entity_physics::{
    DEFAULT_ENTITY_PHYSICS_STATE, EffectiveEntityPhysicsState, EntityCollisionParticipation,
    EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, EntityIntegrationEligibility,
    EntityPhysicsPresentation, EntityPhysicsResponse, EntityPhysicsSetupFacts,
    EntityPhysicsStateInput, EntityPhysicsStateOverrides, LocalIntegrationDemand,
    LocalPhysicalDemand, LocalTargetDemand, calculate_effective_entity_physics_state,
    resolve_effective_entity_physics_state,
};
pub use events::{DerivedStatsData, FellowshipActivity, PlayerInfoData, WorldEvent};
pub use motion::{authored_grounded_actuation, grounded_character_actuation};
pub use spatial::{
    AcceptedBodyMotion, AuthoritativeBodyVectors, AuthoritativePoseEffect,
    AuthoritativePoseResetCause, CellTransitRequest, ChildSpatialBody, ChildSpatialBodyDefinition,
    ChildSpatialBodyDefinitionError, ChildSpatialBodyWaypoint, CollisionOwnerProof,
    CollisionQueryError, CollisionQueryPolicy, CollisionReportClassification,
    CollisionReportContact, CollisionReportOutcome, CollisionReportPhase, CollisionReportSource,
    CollisionScene, CollisionSceneUpdateError, ContactState, DynamicBodyCollisionDefinition,
    DynamicBodyKinematics, DynamicBodyPhysicsStateChange, DynamicBodyRelocationOutcome,
    DynamicEntityCollectionCoverageRejection, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyConfigurationError, DynamicPhysicalBodyDefinition, EdgeProtection,
    FreeSphereBudget, FreeSphereConfig, FreeSphereOutcome, FreeSphereRequest,
    FreeSphereSettleOutcome, FreeSphereState, GroundState, GroundSupport, GroundedBody,
    GroundedBodyActuation, GroundedBodySpheres, GroundedBudget, GroundedConfig, GroundedLaunch,
    GroundedObstruction, GroundedObstructionRequest, GroundedOutcome, GroundedRequest,
    GroundedSphere, LocalDriveControl, LocalDriveGait, MAXIMUM_DYNAMIC_SLICE_DISTANCE,
    MAXIMUM_DYNAMIC_SLICES, MotionWaypoint, MotionWaypointPlacement, MovementObstructionRequest,
    MovementRestrictionRequest, PhysicalBodyActuation, PhysicalBodyActuationError,
    PhysicalBodyDefinition, PhysicalBodyDefinitionError, PhysicalBodyMotion,
    PhysicalBodyParticipation, PhysicalBodyReconfiguration, PhysicalBodyReconfigurationOutcome,
    PhysicalBodyResponsePolicy, PhysicalBodyResponsePolicyError, PhysicalBodyResponseState,
    PhysicalBodySceneResidency, PhysicalBodyState, PhysicalBodyTickResult, PhysicalBodyTickStatus,
    PhysicalCollisionExclusions, PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction,
    PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, PlacedMotionLeg,
    PlacedMotionPath, PlacedMotionPathRequest, PlacedMotionPoint, PlacementRecovery,
    PlacementRequest, PlacementRestrictionRequest, PreparedDynamicEntityCollection,
    PreparedEntityBspPart, PreparedEntityTargetGeometry, RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
    RETAIL_LANDING_NORMAL_Z, RETAIL_WALKABLE_NORMAL_Z, RetainedBodyKinematics,
    RuntimeBodyAdvanceKind, RuntimeBodyResetCause, RuntimeSpatialBodyView,
    SelfPlayerDriveProjectionState, SettlePermission, SolveBodyInput, SolvedBodyKinematics,
    SpatialBody, SpatialBodyEvent, SpatialBodyId, SpatialEntitySample, SpatialMembership,
    SpatialSampleMode, SpatialSamplingConfig, SpatialSamplingState, SpatialScene, SphereSweep,
    StaticContact, StaticSphereSweepHit, StaticSphereSweepRequest, SupportContact, SupportFeature,
    SupportRequest, UncoveredCollisionQuery, advance_body_kinematics, gate_authored_offset,
    physical_body_scene_residency, project_pose_forward_distance, resolve_physical_body_cell,
    settle_free_sphere, settle_free_sphere_with_policy, solve_free_sphere, solve_grounded,
};
pub use state::{
    AuthoredMotionDriveError, BodyProjectionResolver, MotionCommandKinematics,
    MotionTableMovementProfile, PlayerMotionTableLookupError, PlayerMotionTableResolution,
    PlayerMotionTableSource, RequiredSelfMovementKinematics, SelfMovementCapabilities,
    SelfMovementCapabilitiesError, SelfMovementKinematics, SelfMovementKinematicsError,
};
