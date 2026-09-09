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
pub mod entity_scale;
pub mod events;
pub mod handlers;
pub mod hydration;
mod identify;
pub mod inspect;
pub mod magic;
pub mod motion;
pub mod player;
pub mod selection;
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
    EntityCollisionReportPolicy, EntityContactInteraction, EntityDynamicCollisionPolicy,
    EntityIntegrationEligibility, EntityPhysicsPresentation, EntityPhysicsResponse,
    EntityPhysicsRuntimeState, EntityPhysicsSetupFacts, EntityPhysicsStateInput,
    EntityPhysicsStateOverrides, LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand,
    PlayerCollisionStatus, calculate_effective_entity_physics_state,
    resolve_effective_entity_physics_state,
};
pub use entity_scale::{EntityScaleError, EntityScaleState, EntityScaleUpdate};
pub use events::{DerivedStatsData, FellowshipActivity, PlayerInfoData, WorldEvent};
pub use motion::{authored_grounded_actuation, grounded_character_actuation};
pub use selection::{SelectionEnvelope, SelectionEnvelopeError};
pub use spatial::{
    AcceptedBodyMotion, AuthoritativeBodyVectors, AuthoritativePoseEffect,
    AuthoritativePoseResetCause, AvailableEntitySelectionCandidates, CellTransitRequest,
    ChildSpatialBody, ChildSpatialBodyDefinition, ChildSpatialBodyDefinitionError,
    ChildSpatialBodyWaypoint, CollisionOwnerProof, CollisionQueryError, CollisionQueryPolicy,
    CollisionReportClassification, CollisionReportContact, CollisionReportOutcome,
    CollisionReportPhase, CollisionReportSource, CollisionReportTouch, CollisionScene,
    CollisionSceneUpdateError, CollisionSurfaceRayHit, ContactBodyPath, ContactBodyUpdate,
    ContactCollectionUpdate, ContactImpactPoint, ContactMobility, ContactMotionSegment,
    ContactState, ContactStepActuation, DynamicBodyCollisionDefinition, DynamicBodyKinematics,
    DynamicBodyPhysicsStateChange, DynamicBodyRelocationOutcome, DynamicEntityBodyOutcome,
    DynamicEntityBodyTick, DynamicEntityCollectionCoverageRejection, DynamicEntityCollectionTick,
    DynamicPhysicalBodyConfiguration, DynamicPhysicalBodyConfigurationError,
    DynamicPhysicalBodyDefinition, EdgeProtection, EntityCollisionProof, EntityCollisionSnapshot,
    EntityContactResponse, EntitySelectionCandidateResult, EntitySelectionQueryError,
    EntitySelectionRayRequest, EntitySelectionUnavailable, EntitySurfaceRayHit, FreeSphereBudget,
    FreeSphereConfig, FreeSphereOutcome, FreeSphereRequest, FreeSphereSettleOutcome,
    FreeSphereState, GroundState, GroundSupport, GroundedBody, GroundedBodyActuation,
    GroundedBodySpheres, GroundedBudget, GroundedConfig, GroundedContactState, GroundedLaunch,
    GroundedObstruction, GroundedObstructionRequest, GroundedOutcome, GroundedRequest,
    GroundedSphere, HardEntityShape, HardSphereSweep, HardSphereSweepHit, LocalDriveControl,
    LocalDriveGait, MOBILE_CONTACT_ANGULAR_CHORDS, MOBILE_CONTACT_CORRECTION_FRACTION,
    MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO, MOBILE_CONTACT_HARD_SLIDE_PASSES,
    MOBILE_CONTACT_PASSES, MOBILE_CONTACT_TICK_SECONDS, MOBILE_CONTACT_TOLERANCE_METERS,
    MOBILE_CONTACT_TOLERANCE_RADIUS_RATIO, MobileContactBody, MobileContactChange,
    MobileContactResponse, MotionWaypoint, MotionWaypointPlacement, MovementObstructionRequest,
    MovementRestrictionRequest, PASSIVE_MOTOR_ACCELERATION, PASSIVE_MOTOR_BRAKING,
    PHYSICAL_RETURN_GAIN, PhysicalBodyActuation, PhysicalBodyActuationError,
    PhysicalBodyDefinition, PhysicalBodyDefinitionError, PhysicalBodyInput, PhysicalBodyMotion,
    PhysicalBodyParticipation, PhysicalBodyReconfiguration, PhysicalBodyReconfigurationOutcome,
    PhysicalBodyResponsePolicy, PhysicalBodyResponsePolicyError, PhysicalBodyResponseState,
    PhysicalBodySceneResidency, PhysicalBodyState, PhysicalBodyTickResult,
    PhysicalCollisionExclusions, PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction,
    PhysicalReferenceInput, PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion,
    PlacedMotionLeg, PlacedMotionPath, PlacedMotionPathRequest, PlacedMotionPoint,
    PlacementRecovery, PlacementRequest, PlacementRestrictionRequest, PreparedBodyMovement,
    PreparedEntityBspPart, PreparedEntityTargetGeometry, RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
    RETAIL_LANDING_NORMAL_Z, RETAIL_WALKABLE_NORMAL_Z, RetainedBodyKinematics,
    RuntimeBodyAdvanceKind, RuntimeBodyResetCause, RuntimeSpatialBodyView,
    SelfPlayerDriveProjectionState, SettlePermission, SolveBodyInput, SolvedBodyKinematics,
    SpatialBody, SpatialBodyEvent, SpatialBodyId, SpatialEntitySample, SpatialMembership,
    SpatialSampleMode, SpatialSamplingConfig, SpatialSamplingState, SpatialScene, SphereSweep,
    StaticContact, StaticSphereSweepHit, StaticSphereSweepRequest, StaticSurfaceRayHit,
    StaticSurfaceRayRequest, StickyBodyTarget, SupportContact, SupportFeature, SupportRequest,
    SupportSource, UncoveredCollisionQuery, admit_physical_duration,
    advance_body_contact_collection, advance_body_contacts, advance_body_kinematics,
    gate_authored_offset, physical_body_scene_residency, project_pose_forward_distance,
    resolve_mobile_contact, resolve_physical_body_cell, settle_free_sphere,
    settle_free_sphere_with_policy, solve_free_sphere, solve_grounded,
};
pub use state::{
    AuthoredBodyMotionTick, AuthoredMotionDriveError, BodyProjectionResolver,
    MotionCommandKinematics, MotionTableMovementProfile, PlayerMotionTableLookupError,
    PlayerMotionTableResolution, PlayerMotionTableSource, RequiredSelfMovementKinematics,
    SelfMovementCapabilities, SelfMovementCapabilitiesError, SelfMovementKinematics,
    SelfMovementKinematicsError,
};

#[cfg(feature = "physics-profiling")]
pub use spatial::{PhysicsWork, take_physics_work};
