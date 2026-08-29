//! Validated physical-body geometry and response definitions shared by every body source.

use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::position::outdoor_landblock_owner_at;
use holtburger_common::properties::PhysicsState;
use holtburger_common::{Guid, Quaternion, Sphere, Vector3};
use thiserror::Error;

use crate::{EffectiveEntityPhysicsState, LocalIntegrationDemand, LocalPhysicalDemand};

use super::{
    CellTransitRequest, CollisionQueryError, CollisionQueryPolicy, CollisionReportOutcome,
    CollisionScene, ContactState, DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyDefinition, FreeSphereBudget, FreeSphereConfig, FreeSphereOutcome,
    FreeSphereRequest, FreeSphereState, GroundState, GroundSupport, GroundedBody,
    GroundedBodySpheres, GroundedBudget, GroundedConfig, GroundedOutcome, GroundedRequest,
    GroundedSphere, MotionWaypoint, PlacedMotionPath, PlacedMotionPathRequest, SettlePermission,
    SpatialBody, SpatialMembership, solve_free_sphere, solve_grounded,
};

/// Retail's canonical velocity floor (`PhysicsGlobals.SmallVelocity`) squared.
const RETAIL_SMALL_VELOCITY_SQUARED: f32 = 0.25 * 0.25;
/// Retail compares the squared speed to the floor with its ordinary physics epsilon.
const RETAIL_PHYSICS_EPSILON: f32 = 0.000_2;

/// Invalid geometry rejected before a body enters authoritative world state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PhysicalBodyDefinitionError {
    /// A sphere center contains NaN or infinity.
    #[error("physical-body sphere center must be finite")]
    NonFiniteCenter,
    /// A sphere radius is non-finite or not positive.
    #[error("physical-body sphere radius must be finite and positive")]
    InvalidRadius,
    /// Free three-dimensional response currently supports exactly one sphere.
    #[error("free-sphere response cannot use an upper constraint sphere")]
    FreeSphereHasUpperConstraint,
    /// Solver response configuration contains a non-finite or unsupported value.
    #[error("physical-body response configuration is invalid")]
    InvalidResponseConfig,
}

/// Invalid authored or explicit physical response policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PhysicalBodyResponsePolicyError {
    /// Elasticity must be finite before retail's public clamp is applied.
    #[error("physical-body elasticity must be finite")]
    NonFiniteElasticity,
    /// Authored friction is accepted by retail only inside the inclusive unit interval.
    #[error("physical-body friction must be finite and between zero and one")]
    InvalidFriction,
}

/// Retail-bounded coefficient used by elastic normal response.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalElasticity(f32);

impl PhysicalElasticity {
    /// Retail constructor default (`acclient.c:307850`, `:318427`).
    pub const DEFAULT: Self = Self(0.05);
    /// No rebound while still preserving tangential velocity.
    pub const ZERO: Self = Self(0.0);
    /// Retail's public upper bound (`CPhysicsObj::set_elasticity`, `acclient.c:305519-305530`).
    pub const MAXIMUM: Self = Self(0.1);

    /// Applies retail's inclusive `[0.0, 0.1]` setter clamp.
    pub fn new(value: f32) -> std::result::Result<Self, PhysicalBodyResponsePolicyError> {
        if !value.is_finite() {
            return Err(PhysicalBodyResponsePolicyError::NonFiniteElasticity);
        }
        Ok(Self(value.clamp(Self::ZERO.0, Self::MAXIMUM.0)))
    }

    /// Valid bounded coefficient.
    pub const fn get(self) -> f32 {
        self.0
    }
}

/// Retail-validated authored surface friction.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalFriction(f32);

impl PhysicalFriction {
    /// Retail constructor default (`acclient.c:307853`, `:318424`).
    pub const DEFAULT: Self = Self(0.95);

    /// Accepts the same inclusive unit interval as `CPhysicsObj::set_description`.
    pub fn new(value: f32) -> std::result::Result<Self, PhysicalBodyResponsePolicyError> {
        if !value.is_finite() || !(0.0..=1.0).contains(&value) {
            return Err(PhysicalBodyResponsePolicyError::InvalidFriction);
        }
        Ok(Self(value))
    }

    /// Valid authored coefficient.
    pub const fn get(self) -> f32 {
        self.0
    }
}

/// Body-level static-contact response; zero elasticity remains distinct from inelasticity.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PhysicalRestitution {
    /// Reflect the incoming normal component using this bounded coefficient.
    Elastic(PhysicalElasticity),
    /// Stop all linear motion on an eligible impact.
    Inelastic,
}

/// Whether supported motion uses ordinary stable response or retail Sledding behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalSurfaceMotion {
    /// Ordinary support suppresses gravity and continuous-support restitution.
    Stable,
    /// Physics-state bit `0x0080_0000` retains gravity, bounce, and slope friction.
    Sledding,
}

/// Complete mutable physical response selected independently from collider geometry.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalBodyResponsePolicy {
    /// Eligible impact behavior.
    pub restitution: PhysicalRestitution,
    /// Authored supported-surface friction.
    pub friction: PhysicalFriction,
    /// Stable or retail Sledding support behavior.
    pub surface_motion: PhysicalSurfaceMotion,
    /// Physics-state `AlignPath`; this supersedes Sledding velocity-facing.
    pub align_path: bool,
}

bitflags::bitflags! {
    /// Optional collision domains excluded by one physical body.
    ///
    /// These flags affect contact participation only. Placement and portal traversal remain
    /// authoritative regardless of a body's filter.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub struct PhysicalCollisionExclusions: u8 {
        /// Retail's whole-water-landblock barrier does not obstruct this body.
        const ENTIRELY_WATER_BARRIER = 1 << 0;
    }
}

/// Typed body-owned collision participation, independent from geometry and response policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PhysicalCollisionFilter {
    exclusions: PhysicalCollisionExclusions,
}

impl PhysicalCollisionFilter {
    /// Participates in every supported collision domain.
    pub const ALL: Self = Self {
        exclusions: PhysicalCollisionExclusions::empty(),
    };

    /// Constructs a filter from explicit collision-domain exclusions.
    pub const fn excluding(exclusions: PhysicalCollisionExclusions) -> Self {
        Self { exclusions }
    }

    /// Whether this body ignores one optional collision domain.
    pub const fn excludes(self, exclusion: PhysicalCollisionExclusions) -> bool {
        self.exclusions.contains(exclusion)
    }
}

/// Invalid one-tick actuation rejected before collision simulation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PhysicalBodyActuationError {
    /// A requested velocity contains NaN or infinity.
    #[error("physical-body actuation velocity must be finite")]
    NonFiniteVelocity,
    /// Supported planar drive may not inject vertical velocity.
    #[error("grounded supported drive velocity must be horizontal")]
    VerticalGroundedDrive,
    /// A resolved grounded launch must leave support upward.
    #[error("grounded launch velocity must have a positive vertical component")]
    NonUpwardLaunch,
    /// A controller-supplied world heading contains NaN or infinity.
    #[error("grounded control heading must be finite")]
    NonFiniteControlHeading,
}

/// Validated one-shot launch velocity produced by an actor-specific resolver.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedLaunch {
    /// Full world-space velocity committed atomically when support is left.
    velocity: Vector3,
}

impl GroundedLaunch {
    pub fn new(velocity: Vector3) -> std::result::Result<Self, PhysicalBodyActuationError> {
        validate_finite_velocity(velocity)?;
        if velocity.z <= 0.0 {
            return Err(PhysicalBodyActuationError::NonUpwardLaunch);
        }
        Ok(Self { velocity })
    }

    pub const fn velocity(&self) -> Vector3 {
        self.velocity
    }
}

/// Grounded-character actuation with replaceable support drive and an optional launch edge.
#[derive(Debug, Clone, PartialEq)]
pub struct GroundedBodyActuation {
    /// Explicit controller drive or generic retained-velocity coasting while supported.
    supported_motion: GroundedSupportedMotion,
    /// One-shot resolved launch; callers must not replay it after this tick.
    launch: Option<GroundedLaunch>,
    /// Optional controller-selected world heading applied before body-policy facing overrides.
    control_heading: Option<f32>,
}

/// Source of planar velocity while a grounded body retains support.
#[derive(Debug, Clone, Copy, PartialEq)]
enum GroundedSupportedMotion {
    /// A character controller supplied the complete stable planar target for this tick.
    Driven(Vector3),
    /// Generic body response advances and damps retained canonical velocity.
    Coasting,
}

impl GroundedBodyActuation {
    pub fn drive(
        supported_planar_velocity: Vector3,
    ) -> std::result::Result<Self, PhysicalBodyActuationError> {
        validate_finite_velocity(supported_planar_velocity)?;
        if supported_planar_velocity.z.abs() > f32::EPSILON {
            return Err(PhysicalBodyActuationError::VerticalGroundedDrive);
        }
        Ok(Self {
            supported_motion: GroundedSupportedMotion::Driven(supported_planar_velocity),
            launch: None,
            control_heading: None,
        })
    }

    /// Advances retained supported velocity without a character-drive override.
    pub fn coast() -> Self {
        Self {
            supported_motion: GroundedSupportedMotion::Coasting,
            launch: None,
            control_heading: None,
        }
    }

    pub fn with_launch(mut self, launch: GroundedLaunch) -> Self {
        self.launch = Some(launch);
        self
    }

    /// Planar drive this actuation supplies, or the zero vector while coasting.
    pub fn supported_planar_velocity(&self) -> Vector3 {
        match self.supported_motion {
            GroundedSupportedMotion::Driven(velocity) => velocity,
            GroundedSupportedMotion::Coasting => Vector3::zero(),
        }
    }

    /// Absolute world heading this actuation asks the body to face, if it asks at all.
    pub fn control_heading(&self) -> Option<f32> {
        self.control_heading
    }

    /// One-shot launch carried by this actuation, if any.
    pub fn launch(&self) -> Option<&GroundedLaunch> {
        self.launch.as_ref()
    }

    /// Applies the controller's absolute world heading without changing ballistic velocity.
    pub fn with_control_heading(
        mut self,
        heading: f32,
    ) -> std::result::Result<Self, PhysicalBodyActuationError> {
        if !heading.is_finite() {
            return Err(PhysicalBodyActuationError::NonFiniteControlHeading);
        }
        self.control_heading = Some(heading);
        Ok(self)
    }
}

/// Response-specific one-tick actuation for a registered physical body.
#[derive(Debug, Clone, PartialEq)]
pub enum PhysicalBodyActuation {
    /// Unrestricted collision-aware three-dimensional physical and kinematic motion.
    FreeFlight {
        /// World-space physical velocity eligible for retention and collision response.
        retained_velocity: Vector3,
        /// One-tick world-space drive added to the candidate path but never retained.
        kinematic_velocity: Vector3,
    },
    /// Grounded drive plus an optional supported launch edge.
    Grounded(GroundedBodyActuation),
}

impl PhysicalBodyActuation {
    pub fn free_flight(velocity: Vector3) -> std::result::Result<Self, PhysicalBodyActuationError> {
        validate_finite_velocity(velocity)?;
        Ok(Self::FreeFlight {
            retained_velocity: velocity,
            kinematic_velocity: Vector3::zero(),
        })
    }

    /// Adds one non-retained world-space contribution to a free body's candidate path.
    pub fn free_flight_with_kinematic_velocity(
        retained_velocity: Vector3,
        kinematic_velocity: Vector3,
    ) -> std::result::Result<Self, PhysicalBodyActuationError> {
        validate_finite_velocity(retained_velocity)?;
        validate_finite_velocity(kinematic_velocity)?;
        Ok(Self::FreeFlight {
            retained_velocity,
            kinematic_velocity,
        })
    }

    pub fn grounded_drive(
        supported_planar_velocity: Vector3,
    ) -> std::result::Result<Self, PhysicalBodyActuationError> {
        Ok(Self::Grounded(GroundedBodyActuation::drive(
            supported_planar_velocity,
        )?))
    }

    /// Whether this tick input contains no controller, launch, or flight work.
    pub(crate) fn permits_dynamic_settling(&self) -> bool {
        match self {
            Self::FreeFlight {
                retained_velocity,
                kinematic_velocity,
            } => *retained_velocity == Vector3::zero() && *kinematic_velocity == Vector3::zero(),
            Self::Grounded(actuation) => {
                matches!(
                    actuation.supported_motion,
                    GroundedSupportedMotion::Coasting
                ) && actuation.launch.is_none()
                    && actuation.control_heading.is_none()
            }
        }
    }
}

/// Response-owned state retained with a generic body's single authoritative pose.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PhysicalBodyResponseState {
    /// Placement state for collision-aware free three-dimensional motion.
    FreeSphere {
        /// Current interior cell, or `None` while outdoors.
        cell: Option<Guid>,
    },
    /// Placement, gravity, and ground-state memory owned by grounded response.
    Grounded {
        /// Current support-sphere interior cell, or `None` while outdoors.
        cell: Option<Guid>,
        /// Last committed ground state for the lower sphere.
        ground: GroundState,
        /// Retail's bounded consecutive stationary-fall transition stage.
        stationary_fall_frames: u8,
    },
}

impl PhysicalBodyResponseState {
    /// Current response-selected interior cell, or `None` while outdoors.
    pub const fn cell(&self) -> Option<Guid> {
        match self {
            Self::FreeSphere { cell } | Self::Grounded { cell, .. } => *cell,
        }
    }
}

/// Solver-owned integration activity for a physically participating dynamic body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DynamicBodyActivity {
    /// The collection participant must attempt this body's next eligible solve.
    Active,
    /// A completed tick proved no retained, authored, reconciliation, contact, or response work.
    /// Gravity-bearing grounded bodies additionally retain a valid stable-support proof.
    Settled,
    /// The body's retained collision topology is not in the current scene snapshot.
    ///
    /// The pose and authored EnvCell remain authoritative, but the body cannot be solved or
    /// offered as a dynamic-contact target until its collision product is resident again.
    Suspended,
}

/// Dynamic-only physical state kept as one invariant-bearing optional unit.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DynamicBodyRuntimeState {
    /// Prepared target geometry and effective directional collision policy.
    pub(crate) collision: DynamicBodyCollisionDefinition,
    /// Producer-owned target and integration demand consumed without reinterpretation.
    pub(crate) demand: LocalPhysicalDemand,
    /// Solver-owned activity, independent from semantic and presentation state.
    pub(crate) activity: DynamicBodyActivity,
    /// Complete collision-domain membership accepted for the current root pose.
    pub(crate) placement: SpatialMembership,
}

impl DynamicBodyRuntimeState {
    /// Wakes integration work without overriding a topology suspension.
    pub(crate) fn wake(&mut self) {
        if self.activity == DynamicBodyActivity::Suspended {
            return;
        }
        self.activity = if self.demand.integration == LocalIntegrationDemand::Eligible {
            DynamicBodyActivity::Active
        } else {
            DynamicBodyActivity::Settled
        };
    }

    /// Restores the activity implied by demand after collision topology returns.
    pub(crate) fn restore_from_suspension(&mut self) {
        if self.activity != DynamicBodyActivity::Suspended {
            return;
        }
        self.activity = if self.demand.integration == LocalIntegrationDemand::Eligible {
            DynamicBodyActivity::Active
        } else {
            DynamicBodyActivity::Settled
        };
    }
}

/// Physical definition and response memory owned by one spatial body.
#[derive(Debug, Clone, PartialEq)]
pub struct PhysicalBodyState {
    /// Validated geometry and response policy shared by every spawn source.
    pub definition: PhysicalBodyDefinition,
    /// Body-owned collision participation, separate from response and topology.
    pub collision_filter: PhysicalCollisionFilter,
    /// Mutable authored/network response state, independent from immutable geometry.
    pub response_policy: PhysicalBodyResponsePolicy,
    /// Entity-specific collision and activity state; absent for generic physical bodies.
    pub(crate) dynamic: Option<DynamicBodyRuntimeState>,
    /// Response-only state; the containing `SpatialBody` remains the sole pose owner.
    pub response: PhysicalBodyResponseState,
}

/// Whether a canonical spatial body currently carries solver/collision state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalBodyParticipation {
    PoseOnly,
    Physical,
}

/// Committed mutation performed by the reversible physical-state operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalBodyReconfiguration {
    Unchanged,
    /// The pose body gained collision/physics state.
    Installed,
    /// The pose body lost collision/physics state without retiring.
    Removed,
    Reconfigured,
}

/// Complete synchronous consequence of a committed physical-state replacement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PhysicalBodyReconfigurationOutcome {
    /// Participation immediately before the operation.
    pub before: PhysicalBodyParticipation,
    /// Participation immediately after the operation.
    pub after: PhysicalBodyParticipation,
    /// Exact scene mutation that committed.
    pub change: PhysicalBodyReconfiguration,
    /// Exact movement geometry matched, so contact/placement response memory remained valid.
    pub response_memory_preserved: bool,
    /// Forced report ends caused by directional contract or geometry invalidation.
    pub collision_reports: Vec<CollisionReportOutcome>,
}

impl PhysicalBodyState {
    /// Builds response memory whose variant is guaranteed to match the definition.
    pub fn new(
        definition: PhysicalBodyDefinition,
        collision_filter: PhysicalCollisionFilter,
        response_policy: PhysicalBodyResponsePolicy,
        cell: Option<Guid>,
    ) -> Self {
        let response = initial_response(definition, cell);
        Self {
            definition,
            collision_filter,
            response_policy,
            dynamic: None,
            response,
        }
    }

    /// Builds a dynamic entity body while retaining one canonical generic response state.
    pub fn new_dynamic(
        configuration: DynamicPhysicalBodyConfiguration,
        collision_filter: PhysicalCollisionFilter,
        cell: Option<Guid>,
    ) -> Self {
        let (definition, demand) = configuration.into_parts();
        let DynamicPhysicalBodyDefinition {
            movement,
            response_policy,
            entity_collision,
        } = definition;
        let mut state = Self::new(movement, collision_filter, response_policy, cell);
        state.dynamic = Some(DynamicBodyRuntimeState {
            collision: entity_collision,
            demand,
            activity: if demand.integration == LocalIntegrationDemand::Eligible {
                DynamicBodyActivity::Active
            } else {
                DynamicBodyActivity::Settled
            },
            placement: cell.map_or_else(SpatialMembership::outdoor, SpatialMembership::interior),
        });
        state
    }

    /// Rebases dynamic placement after an authoritative runtime pose changes resident cell.
    ///
    /// The cell selector is trusted authority, but no collision query has yet proved wider sphere
    /// reach in the destination. Retain immutable policy and kinematics while clearing response
    /// memory and publishing only the exact minimum membership the next ordinary solve may expand.
    pub(crate) fn rebase_dynamic_residency(&mut self, cell: Option<Guid>) -> bool {
        let Some(dynamic) = self.dynamic.as_mut() else {
            return false;
        };
        if self.response.cell() == cell {
            return false;
        }
        self.response = initial_response(self.definition, cell);
        dynamic.placement =
            cell.map_or_else(SpatialMembership::outdoor, SpatialMembership::interior);
        dynamic.wake();
        true
    }

    /// Rebuilds immutable dynamic policy from a complete state while retaining authored geometry.
    pub fn dynamic_configuration_for_state(
        &self,
        state: EffectiveEntityPhysicsState,
        demand: LocalPhysicalDemand,
    ) -> Option<DynamicPhysicalBodyConfiguration> {
        if !state.supports_local_simulation() || !demand.requires_physical_body() {
            return None;
        }
        let mut entity_collision = self.dynamic.as_ref()?.collision.clone();
        if (state.presentation.default_animation && !entity_collision.default_animation_available)
            || (state.presentation.default_script && !entity_collision.default_script_available)
        {
            return None;
        }
        let movement = match self.definition {
            PhysicalBodyDefinition::FreeSphere { .. } => self.definition,
            PhysicalBodyDefinition::Grounded {
                spheres,
                mut config,
            } => {
                config.gravity = if state.response.gravity { -9.8 } else { 0.0 };
                config.edge_protection = if state.response.edge_slide {
                    super::EdgeProtection::Creature
                } else {
                    super::EdgeProtection::None
                };
                PhysicalBodyDefinition::Grounded { spheres, config }
            }
        };
        let response_policy = PhysicalBodyResponsePolicy {
            restitution: if state.response.inelastic {
                PhysicalRestitution::Inelastic
            } else {
                PhysicalRestitution::Elastic(entity_collision.elasticity)
            },
            friction: self.response_policy.friction,
            surface_motion: PhysicalSurfaceMotion::Stable,
            align_path: state.response.align_path,
        };
        entity_collision.dynamic_collision = state.dynamic_collision;
        entity_collision.reporting = state.reporting;
        entity_collision.uses_physics_bsp = state.uses_physics_bsp;
        Some(
            DynamicPhysicalBodyConfiguration::new(
                DynamicPhysicalBodyDefinition {
                    movement,
                    response_policy,
                    entity_collision,
                },
                demand,
            )
            .expect("non-empty retained demand must produce a physical configuration"),
        )
    }
}

fn initial_response(
    definition: PhysicalBodyDefinition,
    cell: Option<Guid>,
) -> PhysicalBodyResponseState {
    match definition {
        PhysicalBodyDefinition::FreeSphere { .. } => PhysicalBodyResponseState::FreeSphere { cell },
        PhysicalBodyDefinition::Grounded { .. } => PhysicalBodyResponseState::Grounded {
            cell,
            ground: GroundState::Airborne,
            stationary_fall_frames: 0,
        },
    }
}

/// One or two validated motion spheres in authored role order.
///
/// The primary sphere is sphere zero. Grounded response interprets it as the support sphere and the
/// optional secondary sphere as the upper constraint; free response accepts only the primary.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalSphereSet {
    primary: GroundedSphere,
    upper_constraint: Option<GroundedSphere>,
}

impl PhysicalSphereSet {
    /// Validates one required primary sphere and one optional upper constraint.
    pub fn new(
        primary: Sphere,
        upper_constraint: Option<Sphere>,
    ) -> Result<Self, PhysicalBodyDefinitionError> {
        Ok(Self {
            primary: validate_sphere(primary)?,
            upper_constraint: upper_constraint.map(validate_sphere).transpose()?,
        })
    }

    /// Required sphere zero in body-local coordinates.
    pub const fn primary(self) -> GroundedSphere {
        self.primary
    }

    /// Optional sphere one in body-local coordinates.
    pub const fn upper_constraint(self) -> Option<GroundedSphere> {
        self.upper_constraint
    }

    /// Authored mover spheres in retail role order.
    pub fn iter(self) -> impl Iterator<Item = GroundedSphere> {
        [Some(self.primary), self.upper_constraint]
            .into_iter()
            .flatten()
    }

    fn require_single(self) -> Result<GroundedSphere, PhysicalBodyDefinitionError> {
        if self.upper_constraint.is_some() {
            return Err(PhysicalBodyDefinitionError::FreeSphereHasUpperConstraint);
        }
        Ok(self.primary)
    }

    fn grounded(self) -> GroundedBodySpheres {
        GroundedBodySpheres {
            support: self.primary,
            upper: self.upper_constraint,
        }
    }
}

/// Parameterized physical response consumed by the static collision simulator.
///
/// Entity category and spawn provenance do not belong here. Producers resolve their geometry and
/// policy into one of these implemented response-bearing variants.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PhysicalBodyDefinition {
    /// Collision-aware motion in three dimensions over exactly one sphere.
    FreeSphere {
        /// Validated body-local collision sphere.
        sphere: GroundedSphere,
        /// Finite solver budgets and separation policy.
        config: FreeSphereConfig,
    },
    /// Gravity, support, steps, and edge response over an asymmetric sphere set.
    Grounded {
        /// Required support sphere and optional upper constraint.
        spheres: GroundedBodySpheres,
        /// Grounded response and finite solver policy.
        config: GroundedConfig,
    },
}

impl PhysicalBodyDefinition {
    /// Combines a validated single-sphere shape with free three-dimensional response.
    pub fn free_sphere(
        spheres: PhysicalSphereSet,
        config: FreeSphereConfig,
    ) -> Result<Self, PhysicalBodyDefinitionError> {
        validate_physical_fly_config(config)?;
        Ok(Self::FreeSphere {
            sphere: spheres.require_single()?,
            config,
        })
    }

    /// Combines a validated one-or-two-sphere shape with grounded response.
    pub fn grounded(
        spheres: PhysicalSphereSet,
        config: GroundedConfig,
    ) -> Result<Self, PhysicalBodyDefinitionError> {
        validate_grounded_config(config)?;
        Ok(Self::Grounded {
            spheres: spheres.grounded(),
            config,
        })
    }

    /// Ordered validated spheres used by the selected response.
    pub fn spheres(self) -> PhysicalSphereSet {
        match self {
            Self::FreeSphere { sphere, .. } => PhysicalSphereSet {
                primary: sphere,
                upper_constraint: None,
            },
            Self::Grounded { spheres, .. } => PhysicalSphereSet {
                primary: spheres.support,
                upper_constraint: spheres.upper,
            },
        }
    }
}

/// Result category for one generic physical-body fixed tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalBodyTickStatus {
    /// Collision response accepted and committed the tick.
    Solved,
    /// Anti-tunneling subdivision exceeded the configured finite budget.
    SubstepBudgetExceeded,
    /// Contact separation exceeded the configured finite pass budget.
    ContactBudgetExceeded,
}

/// One source-neutral placed body-reference path produced by the generic simulator.
#[derive(Debug, Clone, PartialEq)]
pub struct PhysicalBodyMotion {
    /// Body-reference geometry paired with support-sphere placement transitions.
    pub path: PlacedMotionPath,
    /// Result category for this fixed tick.
    pub status: PhysicalBodyTickStatus,
    /// Distinct non-walkable planes encountered by grounded response.
    pub constraint_count: usize,
    /// Collision substeps consumed by the solve.
    pub substeps: usize,
    /// Contact-separation passes consumed by the solve.
    pub contact_passes: usize,
}

/// Residency of the final primary-sphere owner in the installed collision snapshot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalBodySceneResidency {
    /// The primary sphere ends in an installed authored outdoor owner.
    Resident,
    /// The primary sphere ends in a canonical authored owner absent from the scene.
    MissingOwner {
        /// Canonical owner a consumer may choose to load or use for teardown policy.
        owner: Guid,
    },
    /// The primary sphere ends beyond AC's finite authored outdoor lattice.
    OutsideLandscape,
}

/// One fixed-tick motion plus orthogonal installed-scene residency.
#[derive(Debug, Clone, PartialEq)]
pub struct PhysicalBodyTickResult {
    /// Authoritative placed motion produced by the request.
    pub motion: PhysicalBodyMotion,
    /// Non-gating final primary-sphere collision residency.
    pub scene_residency: PhysicalBodySceneResidency,
    /// Named semantic consequence committed with a confirmed dynamic-body impact.
    pub dynamic_state_change: Option<DynamicBodyPhysicsStateChange>,
    /// First-touch report edges committed by this body transaction; refreshes remain silent.
    pub collision_reports: Vec<CollisionReportOutcome>,
}

/// Source-neutral complete-state mutation a producer applies to its semantic authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DynamicBodyPhysicsStateChange {
    /// Physics-state bits cleared by the accepted collision consequence.
    pub cleared: PhysicsState,
}

#[derive(Debug, Clone)]
/// Complete tentative body state committed only after every query succeeds.
pub(super) struct PhysicalBodyTickCommit {
    /// Accepted body-reference pose.
    pub pose: WorldPosition,
    /// Physical linear momentum retained for the next integration tick.
    pub retained_velocity: Vector3,
    /// Observed derivative of the complete path accepted during this tick.
    pub accepted_motion: super::AcceptedBodyMotion,
    /// Coarse support state derived by the selected response.
    pub contact: ContactState,
    /// Response-only state matching the physical definition variant.
    pub response: PhysicalBodyResponseState,
    /// Placed motion returned to the caller.
    pub motion: PhysicalBodyMotion,
    /// Whether the accepted static-environment solve confirmed contact this tick.
    pub environment_contact: bool,
    /// Whether the final accepted placement still requires bounded contact correction.
    pub residual_contacts: bool,
}

#[derive(Debug, Clone, Copy)]
/// Inputs retained by grounded response while a generic tick is evaluated.
struct GroundedTickState {
    /// Role-ordered support and optional upper sphere.
    spheres: GroundedBodySpheres,
    /// Finite grounded solver and response policy.
    config: GroundedConfig,
    /// Retained mutable contact and facing response.
    response_policy: PhysicalBodyResponsePolicy,
    /// Body-owned optional collision-domain exclusions.
    collision_filter: PhysicalCollisionFilter,
    /// Prior support-sphere interior cell.
    cell: Option<Guid>,
    /// Prior committed walkable support.
    ground: GroundState,
    /// Prior stationary-fall transition stage.
    stationary_fall_frames: u8,
}

#[derive(Debug, Clone, Copy)]
/// Inputs retained by free-sphere response while a generic tick is evaluated.
struct FreeSphereTickState {
    /// Body-local collision sphere.
    sphere: GroundedSphere,
    /// Finite free-flight solver policy.
    config: FreeSphereConfig,
    /// Retained mutable collision and facing response.
    response_policy: PhysicalBodyResponsePolicy,
    /// Body-owned optional collision-domain exclusions.
    collision_filter: PhysicalCollisionFilter,
    /// Prior sphere-center interior cell.
    cell: Option<Guid>,
}

/// Solves one registered body without mutating the canonical store until every query completes.
pub(super) fn solve_physical_body_tick(
    scene: &CollisionScene,
    body: &SpatialBody,
    actuation: &PhysicalBodyActuation,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    ensure!(
        delta_seconds.is_finite() && delta_seconds > 0.0,
        "physical-body tick interval must be finite and positive"
    );
    let physical = body
        .physical
        .as_ref()
        .context("spatial body has no physical definition")?;
    let mut commit = solve_physical_body_response(scene, body, physical, actuation, delta_seconds)?;

    // Retained physical omega rotates the *accepted world frame*, globally, after the response has
    // chosen the body's facing — retail's `Frame::grotate` on the already-composed frame
    // (`acclient.c:306106-306153`). Authored rotation is the opposite case and has already been
    // applied locally, as the body's control heading.
    //
    // Derived here so the accepted pose is final. Both the scene commit and dynamic contact used to
    // re-integrate it from retained omega themselves, which made the tick's end orientation a fact
    // computed in three places.
    commit.pose.rotation = super::scene::integrate_angular_velocity(
        commit.pose.rotation,
        body.retained.omega,
        delta_seconds,
    );
    Ok(commit)
}

fn solve_physical_body_response(
    scene: &CollisionScene,
    body: &SpatialBody,
    physical: &PhysicalBodyState,
    actuation: &PhysicalBodyActuation,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    match (physical.definition, &physical.response) {
        (
            PhysicalBodyDefinition::FreeSphere { sphere, config },
            PhysicalBodyResponseState::FreeSphere { cell },
        ) => {
            let PhysicalBodyActuation::FreeFlight {
                retained_velocity,
                kinematic_velocity,
            } = actuation
            else {
                anyhow::bail!("grounded actuation cannot drive a free-sphere physical body")
            };
            solve_free_sphere_tick(
                scene,
                body,
                FreeSphereTickState {
                    sphere,
                    config,
                    response_policy: physical.response_policy,
                    collision_filter: physical.collision_filter,
                    cell: *cell,
                },
                *retained_velocity,
                *kinematic_velocity,
                delta_seconds,
            )
        }
        (
            PhysicalBodyDefinition::Grounded { spheres, config },
            PhysicalBodyResponseState::Grounded {
                cell,
                ground,
                stationary_fall_frames,
            },
        ) => {
            let PhysicalBodyActuation::Grounded(actuation) = actuation else {
                anyhow::bail!("free-flight actuation cannot drive a grounded physical body")
            };
            solve_grounded_body_tick(
                scene,
                body,
                GroundedTickState {
                    spheres,
                    config,
                    response_policy: physical.response_policy,
                    collision_filter: physical.collision_filter,
                    cell: *cell,
                    ground: *ground,
                    stationary_fall_frames: *stationary_fall_frames,
                },
                actuation,
                delta_seconds,
            )
        }
        _ => anyhow::bail!("physical body definition and response state variants diverged"),
    }
}

fn solve_free_sphere_tick(
    scene: &CollisionScene,
    body: &SpatialBody,
    state: FreeSphereTickState,
    retained_velocity: Vector3,
    kinematic_velocity: Vector3,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    let offset = body.pose.rotation.rotate_vector(state.sphere.center);
    let integrated_velocity = retained_velocity + body.retained.acceleration * delta_seconds;
    let candidate_velocity =
        retained_velocity + body.retained.acceleration * (0.5 * delta_seconds) + kinematic_velocity;
    let mut sphere_pose = body.pose;
    sphere_pose.coords = sphere_pose.coords + offset;
    let outcome = solve_free_sphere(
        scene,
        state.config,
        FreeSphereRequest {
            body: FreeSphereState {
                pose: sphere_pose,
                cell: state.cell,
                radius: state.sphere.radius,
            },
            displacement: candidate_velocity * delta_seconds,
            filter: state.collision_filter,
            query_policy: CollisionQueryPolicy::RequireCollisionCoverage,
        },
    )?;
    let (solved, achieved_displacement, collision_normal, motion, substeps, contact_passes, status) =
        match outcome {
            FreeSphereOutcome::Solved {
                body: solved,
                achieved_displacement,
                collision_normal,
                motion,
                substeps,
                contact_passes,
                ..
            } => (
                solved,
                achieved_displacement,
                collision_normal,
                motion,
                substeps,
                contact_passes,
                PhysicalBodyTickStatus::Solved,
            ),
            FreeSphereOutcome::BudgetExceeded {
                body: solved,
                achieved_displacement,
                collision_normal,
                motion,
                budget,
                substeps,
                contact_passes,
                ..
            } => (
                solved,
                achieved_displacement,
                collision_normal,
                motion,
                substeps,
                contact_passes,
                free_budget_status(budget),
            ),
        };
    let path =
        trace_body_reference_path(scene, body.pose, state.cell, state.sphere, &motion, true)?;
    let committed_cell = path.final_point().placement().committed_cell();
    ensure!(
        committed_cell == solved.cell || path.has_recovery(),
        "free-sphere placed path ended in {committed_cell:?}, but collision response committed {:?}",
        solved.cell
    );
    let mut pose = body_reference_pose(solved.pose, committed_cell, offset)?;
    let velocity = collision_response(CollisionResponseInput {
        incoming: integrated_velocity,
        restitution: state.response_policy.restitution,
        collision_normal,
        current_support_normal: None,
        stationary_fall_frames: 0,
    })
    .velocity;
    apply_automatic_facing(
        &mut pose,
        achieved_displacement,
        velocity,
        state.response_policy,
    );
    Ok(PhysicalBodyTickCommit {
        pose,
        retained_velocity: velocity,
        accepted_motion: accepted_motion(
            body.pose,
            pose,
            achieved_displacement / delta_seconds,
            delta_seconds,
        ),
        contact: ContactState::Airborne,
        response: PhysicalBodyResponseState::FreeSphere {
            cell: committed_cell,
        },
        motion: PhysicalBodyMotion {
            path,
            status,
            constraint_count: 0,
            substeps,
            contact_passes,
        },
        environment_contact: collision_normal.is_some(),
        residual_contacts: false,
    })
}

fn solve_grounded_body_tick(
    scene: &CollisionScene,
    body: &SpatialBody,
    state: GroundedTickState,
    actuation: &GroundedBodyActuation,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    let retained_ground_is_current = match state.ground {
        GroundState::Supported(support) | GroundState::Sliding(support) => {
            scene.proves(support.proof)
        }
        GroundState::Airborne => true,
    };
    let initial_retained_velocity = canonical_retained_velocity(body.retained.velocity);
    let acceleration_step = body.retained.acceleration * delta_seconds;
    let mut candidate_retained_velocity = initial_retained_velocity + acceleration_step * 0.5;
    let mut retained_velocity = initial_retained_velocity + acceleration_step;
    let mut grounded_body = GroundedBody {
        pose: body.pose,
        cell: state.cell,
        // This field remains physical momentum. A kinematic drive may temporarily be supplied to
        // the solver below for first-contact path finding, but is never committed through it.
        velocity: candidate_retained_velocity,
        ground: if retained_ground_is_current {
            state.ground
        } else {
            GroundState::Airborne
        },
    };
    // A newly installed grounded body has not yet had a collision transaction classify its
    // contact. Let explicit planar drive participate in that first transaction so a body placed
    // on a floor does not discard one tick of input. Once a solve commits `Airborne`, canonical
    // velocity remains ballistic and later drive cannot steer it.
    if body.contact == ContactState::Unknown
        && grounded_body.ground.walkable_support().is_none()
        && let GroundedSupportedMotion::Driven(velocity) = actuation.supported_motion
    {
        grounded_body.velocity.x += velocity.x;
        grounded_body.velocity.y += velocity.y;
    }
    let retained_contact = if retained_ground_is_current {
        body.contact
    } else {
        ContactState::Airborne
    };
    let settle = grounded_settle_permission(retained_contact, actuation.launch.is_some());
    if let Some(launch) = actuation.launch.as_ref() {
        ensure!(
            grounded_body.ground.walkable_support().is_some(),
            "grounded launch requires current walkable support"
        );
        grounded_body.velocity = launch.velocity();
        candidate_retained_velocity = launch.velocity();
        retained_velocity = launch.velocity();
        grounded_body.ground = GroundState::Airborne;
    }
    let mut supported_velocity = match actuation.supported_motion {
        GroundedSupportedMotion::Driven(velocity) => velocity + candidate_retained_velocity,
        GroundedSupportedMotion::Coasting => candidate_retained_velocity,
    };
    if let Some(support) = grounded_body.ground.walkable_support() {
        match state.response_policy.surface_motion {
            PhysicalSurfaceMotion::Stable => {
                // Retail damps `m_velocityVector` before composing that physical contribution
                // with movement-manager output (`acclient.c:306114-306153`). Controller drive is
                // therefore not a reason to suspend friction on independently retained momentum.
                candidate_retained_velocity = surface_friction(
                    candidate_retained_velocity,
                    support.normal,
                    state.response_policy.friction,
                    delta_seconds,
                    PhysicalSurfaceMotion::Stable,
                );
                retained_velocity = surface_friction(
                    retained_velocity,
                    support.normal,
                    state.response_policy.friction,
                    delta_seconds,
                    PhysicalSurfaceMotion::Stable,
                );
                grounded_body.velocity = candidate_retained_velocity;
                supported_velocity = match actuation.supported_motion {
                    GroundedSupportedMotion::Driven(velocity) => {
                        velocity + candidate_retained_velocity
                    }
                    GroundedSupportedMotion::Coasting => candidate_retained_velocity,
                };
            }
            PhysicalSurfaceMotion::Sledding => {
                candidate_retained_velocity = surface_friction(
                    candidate_retained_velocity,
                    support.normal,
                    state.response_policy.friction,
                    delta_seconds,
                    PhysicalSurfaceMotion::Sledding,
                );
                retained_velocity = surface_friction(
                    retained_velocity,
                    support.normal,
                    state.response_policy.friction,
                    delta_seconds,
                    PhysicalSurfaceMotion::Sledding,
                );
                grounded_body.velocity = candidate_retained_velocity;
                supported_velocity = match actuation.supported_motion {
                    GroundedSupportedMotion::Driven(velocity) => {
                        velocity + candidate_retained_velocity
                    }
                    GroundedSupportedMotion::Coasting => candidate_retained_velocity,
                };
            }
        }
    }
    let outcome = solve_grounded(
        scene,
        state.config,
        GroundedRequest {
            body: grounded_body,
            spheres: state.spheres,
            supported_velocity,
            settle,
            retain_supported_gravity: physical_surface_retains_gravity(
                state.response_policy.surface_motion,
            ),
            delta_seconds,
            filter: state.collision_filter,
        },
    )?;
    let (
        solved,
        achieved_velocity,
        collision_normal,
        motion,
        substeps,
        contact_passes,
        constraint_count,
        residual_contacts,
        status,
    ) = match outcome {
        GroundedOutcome::Solved {
            body,
            achieved_velocity,
            collision_normal,
            motion,
            substeps,
            contact_passes,
            constraint_count,
            residual_contacts,
        } => (
            body,
            achieved_velocity,
            collision_normal,
            motion,
            substeps,
            contact_passes,
            constraint_count,
            residual_contacts,
            PhysicalBodyTickStatus::Solved,
        ),
        GroundedOutcome::BudgetExceeded {
            body,
            achieved_velocity,
            collision_normal,
            motion,
            budget,
            substeps,
            contact_passes,
            constraint_count,
            residual_contacts,
        } => (
            body,
            achieved_velocity,
            collision_normal,
            motion,
            substeps,
            contact_passes,
            constraint_count,
            residual_contacts,
            grounded_budget_status(budget),
        ),
    };
    let path = trace_body_reference_path(
        scene,
        body.pose,
        state.cell,
        state.spheres.support,
        &motion,
        false,
    )?;
    let committed_cell = path.final_point().placement().committed_cell();
    let recovered = path.has_recovery();
    ensure!(
        committed_cell == solved.cell || recovered,
        "grounded placed path ended in {committed_cell:?}, but collision response committed {:?}",
        solved.cell
    );
    let mut pose = body_reference_pose(solved.pose, committed_cell, Vector3::zero())?;
    // Ground identity belongs to the collision domain that produced it. A recovered placement
    // deliberately drops that memory so the next ordinary tick reacquires it.
    let mut ground = if recovered {
        GroundState::Airborne
    } else {
        solved.ground
    };
    let stationary_fall_frames = next_stationary_fall_frames(
        state.stationary_fall_frames,
        state.ground.walkable_support(),
        ground.walkable_support(),
        collision_normal,
        achieved_velocity,
    );
    let continuous_stable_support = state.ground.walkable_support().is_some()
        && solved.ground.walkable_support().is_some()
        && state.response_policy.surface_motion == PhysicalSurfaceMotion::Stable;
    let physical_incoming = if continuous_stable_support {
        retained_velocity
    } else {
        // Ballistic integration applies gravity to the retained vector inside `solve_grounded`.
        // Remove any temporary first-contact drive that was supplied only to discover support.
        let mut physical = solved.velocity;
        if body.contact == ContactState::Unknown
            && state.ground.walkable_support().is_none()
            && let GroundedSupportedMotion::Driven(drive) = actuation.supported_motion
        {
            physical.x -= drive.x;
            physical.y -= drive.y;
        }
        if actuation.launch.is_none() {
            physical + acceleration_step * 0.5
        } else {
            physical
        }
    };
    let collision_response = collision_response(CollisionResponseInput {
        incoming: physical_incoming,
        restitution: state.response_policy.restitution,
        // Retail suppresses restitution entirely while ordinary walkable support continues. The
        // accepted path may still be clipped, but that must not rewrite or separate retained
        // physical momentum (`CPhysicsObj::handle_all_collisions`, acclient.c:309982-310051).
        collision_normal: (!continuous_stable_support)
            .then_some(collision_normal)
            .flatten(),
        current_support_normal: (!continuous_stable_support)
            .then(|| ground.walkable_support().map(|current| current.normal))
            .flatten(),
        stationary_fall_frames,
    });
    if collision_response.separates_from_support {
        ground = GroundState::Airborne;
    }
    let velocity = collision_response.velocity;
    apply_grounded_facing(
        &mut pose,
        achieved_velocity * delta_seconds,
        velocity,
        state.response_policy,
        actuation.control_heading,
    );
    Ok(PhysicalBodyTickCommit {
        pose,
        retained_velocity: velocity,
        accepted_motion: accepted_motion(body.pose, pose, achieved_velocity, delta_seconds),
        contact: match ground {
            GroundState::Supported(_) => ContactState::Grounded,
            GroundState::Sliding(_) => ContactState::Sliding,
            GroundState::Airborne => ContactState::Airborne,
        },
        response: PhysicalBodyResponseState::Grounded {
            cell: committed_cell,
            ground,
            stationary_fall_frames,
        },
        motion: PhysicalBodyMotion {
            path,
            status,
            constraint_count,
            substeps,
            contact_passes,
        },
        environment_contact: collision_normal.is_some() || ground.contact_plane().is_some(),
        residual_contacts,
    })
}

/// Derives the observational path rate without making it a retained physical input.
pub(super) fn accepted_motion(
    start: WorldPosition,
    end: WorldPosition,
    velocity: Vector3,
    delta_seconds: f32,
) -> super::AcceptedBodyMotion {
    let delta = end.rotation.multiply(&start.rotation.conjugate());
    let canonical = if delta.w < 0.0 {
        Quaternion {
            w: -delta.w,
            x: -delta.x,
            y: -delta.y,
            z: -delta.z,
        }
    } else {
        delta
    };
    let half_sine = Vector3::new(canonical.x, canonical.y, canonical.z).length();
    let omega = if half_sine <= f32::EPSILON || delta_seconds <= f32::EPSILON {
        Vector3::zero()
    } else {
        let angle = 2.0 * half_sine.atan2(canonical.w);
        Vector3::new(canonical.x, canonical.y, canonical.z) / half_sine * (angle / delta_seconds)
    };
    super::AcceptedBodyMotion { velocity, omega }
}

fn canonical_retained_velocity(velocity: Vector3) -> Vector3 {
    if velocity.length_squared() - RETAIL_SMALL_VELOCITY_SQUARED < RETAIL_PHYSICS_EPSILON {
        Vector3::zero()
    } else {
        velocity
    }
}

/// Projects retained generic contact into retail's per-transition settle eligibility.
///
/// Retail's ordinary walking step-down requires the OBJECTINFO contact bit
/// (`CTransition::transitional_insert`, `acclient.c:301550-301599`); every other gravity-bound
/// transition prepares the lenient 0.04m landing step-down (`acclient.c:301563-301569`); a
/// launch tick suppresses both until the body has left the ground. `Unknown` classifies through
/// the walking probe so a newly registered body can acquire the floor beneath it.
pub(crate) const fn grounded_settle_permission(
    contact: ContactState,
    launching: bool,
) -> SettlePermission {
    if launching {
        SettlePermission::Denied
    } else {
        match contact {
            ContactState::Grounded | ContactState::Unknown => SettlePermission::Walking,
            ContactState::Sliding | ContactState::Airborne => SettlePermission::Landing,
        }
    }
}

pub(super) fn trace_body_reference_path(
    scene: &CollisionScene,
    initial_pose: WorldPosition,
    previous_cell: Option<Guid>,
    primary: GroundedSphere,
    motion: &[MotionWaypoint],
    motion_is_sphere_center: bool,
) -> Result<PlacedMotionPath> {
    let anchor = Guid((initial_pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let offset = initial_pose.rotation.rotate_vector(primary.center);
    let sphere_motion = if motion_is_sphere_center {
        motion.to_vec()
    } else {
        motion
            .iter()
            .map(|waypoint| MotionWaypoint {
                center: waypoint.center + offset,
                end_fraction: waypoint.end_fraction,
                placement: waypoint.placement,
            })
            .collect()
    };
    Ok(scene
        .transit_motion_path(PlacedMotionPathRequest {
            previous_cell,
            anchor,
            start: initial_pose.coords + offset,
            radius: primary.radius,
            waypoints: &sphere_motion,
        })?
        .translated(offset * -1.0))
}

fn body_reference_pose(
    mut sphere_pose: WorldPosition,
    cell: Option<Guid>,
    offset: Vector3,
) -> Result<WorldPosition> {
    sphere_pose.coords = sphere_pose.coords - offset;
    if let Some(cell) = cell {
        sphere_pose.landblock_id = cell;
        return Ok(sphere_pose);
    }
    sphere_pose
        .normalize_outdoor_landblock_frame()
        .context("could not reanchor solved body reference")
}

fn free_budget_status(budget: FreeSphereBudget) -> PhysicalBodyTickStatus {
    match budget {
        FreeSphereBudget::Substeps => PhysicalBodyTickStatus::SubstepBudgetExceeded,
        FreeSphereBudget::Contacts => PhysicalBodyTickStatus::ContactBudgetExceeded,
    }
}

fn grounded_budget_status(budget: GroundedBudget) -> PhysicalBodyTickStatus {
    match budget {
        GroundedBudget::Substeps => PhysicalBodyTickStatus::SubstepBudgetExceeded,
    }
}

const MAXIMUM_BOUNCE_STATIONARY_FALL_FRAMES: u8 = 1;
const SLEDDING_STOP_SPEED_SQUARED: f32 = 1.5625;
const SLEDDING_FAST_SPEED_SQUARED: f32 = 6.25;
const SLEDDING_SLOPE_NORMAL_Z: f32 = 0.984_807_7;
const SLEDDING_SLOPE_FRICTION: f32 = 0.2;

#[derive(Debug, Clone, Copy, PartialEq)]
/// Canonical velocity and its support consequence from one collision response.
struct CollisionResponse {
    /// Velocity retained after stable support, restitution, or stationary-fall handling.
    velocity: Vector3,
    /// Whether the resolved velocity deliberately leaves the current walkable support.
    separates_from_support: bool,
}

#[derive(Debug, Clone, Copy)]
/// Complete collision and support facts consumed by one canonical response decision.
struct CollisionResponseInput {
    /// Velocity entering restitution handling.
    incoming: Vector3,
    /// Authored body restitution behavior.
    restitution: PhysicalRestitution,
    /// Most relevant impact normal produced by the collision transaction.
    collision_normal: Option<Vector3>,
    /// Current support normal, independently from whether an impact normal was produced.
    current_support_normal: Option<Vector3>,
    /// Retail's repeated stationary-fall escalation stage.
    stationary_fall_frames: u8,
}

fn physical_surface_retains_gravity(surface_motion: PhysicalSurfaceMotion) -> bool {
    surface_motion == PhysicalSurfaceMotion::Sledding
}

fn collision_response(input: CollisionResponseInput) -> CollisionResponse {
    let CollisionResponseInput {
        incoming,
        restitution,
        collision_normal,
        current_support_normal,
        stationary_fall_frames,
    } = input;
    if stationary_fall_frames > MAXIMUM_BOUNCE_STATIONARY_FALL_FRAMES {
        return CollisionResponse {
            velocity: Vector3::zero(),
            separates_from_support: false,
        };
    }
    let velocity = if let Some(normal) = collision_normal {
        match restitution {
            PhysicalRestitution::Inelastic => Vector3::zero(),
            PhysicalRestitution::Elastic(elasticity) => {
                let impact_speed = incoming.dot(&normal);
                if impact_speed >= 0.0 {
                    incoming
                } else {
                    incoming + normal * -(impact_speed * (elasticity.get() + 1.0))
                }
            }
        }
    } else {
        incoming
    };
    CollisionResponse {
        velocity,
        separates_from_support: current_support_normal
            .is_some_and(|normal| velocity.dot(&normal) > 0.0),
    }
}

fn surface_friction(
    incoming: Vector3,
    normal: Vector3,
    authored_friction: PhysicalFriction,
    quantum: f32,
    surface_motion: PhysicalSurfaceMotion,
) -> Vector3 {
    let normal_speed = incoming.dot(&normal);
    if normal_speed >= 0.25 {
        return incoming;
    }
    let projected = incoming - normal * normal_speed;
    let speed_squared = incoming.length_squared();
    let friction = match surface_motion {
        PhysicalSurfaceMotion::Stable => authored_friction.get(),
        PhysicalSurfaceMotion::Sledding if speed_squared < SLEDDING_STOP_SPEED_SQUARED => 1.0,
        PhysicalSurfaceMotion::Sledding
            if speed_squared >= SLEDDING_FAST_SPEED_SQUARED
                && normal.z < SLEDDING_SLOPE_NORMAL_Z =>
        {
            SLEDDING_SLOPE_FRICTION
        }
        PhysicalSurfaceMotion::Sledding => authored_friction.get(),
    };
    projected * (1.0 - friction).powf(quantum)
}

fn next_stationary_fall_frames(
    previous: u8,
    previous_support: Option<GroundSupport>,
    current_support: Option<GroundSupport>,
    collision_normal: Option<Vector3>,
    achieved_velocity: Vector3,
) -> u8 {
    let remained_stationary_fall = previous_support.is_none()
        && current_support.is_none()
        && collision_normal.is_some()
        && achieved_velocity.length_squared() <= f32::EPSILON;
    if remained_stationary_fall {
        previous.saturating_add(1).min(3)
    } else {
        0
    }
}

fn apply_automatic_facing(
    pose: &mut WorldPosition,
    displacement: Vector3,
    velocity: Vector3,
    policy: PhysicalBodyResponsePolicy,
) {
    let heading = if policy.align_path && displacement.length_squared() > f32::EPSILON {
        Some(Vector3::zero().heading_to(&displacement))
    } else if policy.surface_motion == PhysicalSurfaceMotion::Sledding
        && velocity.length_squared() > f32::EPSILON
    {
        Some(Vector3::zero().heading_to(&velocity))
    } else {
        None
    };
    if let Some(heading) = heading {
        pose.rotation = Quaternion::from_heading(heading);
    }
}

/// Applies character control first, then retail's later body-policy facing overrides.
fn apply_grounded_facing(
    pose: &mut WorldPosition,
    displacement: Vector3,
    velocity: Vector3,
    policy: PhysicalBodyResponsePolicy,
    control_heading: Option<f32>,
) {
    if let Some(heading) = control_heading {
        pose.rotation = Quaternion::from_heading(heading);
    }
    apply_automatic_facing(pose, displacement, velocity, policy);
}

fn validate_physical_fly_config(
    config: FreeSphereConfig,
) -> std::result::Result<(), PhysicalBodyDefinitionError> {
    if !config.maximum_substep_distance.is_finite()
        || config.maximum_substep_distance <= 0.0
        || config.maximum_substeps == 0
        || config.maximum_contact_passes == 0
        || !config.separation_epsilon.is_finite()
        || config.separation_epsilon < 0.0
    {
        return Err(PhysicalBodyDefinitionError::InvalidResponseConfig);
    }
    Ok(())
}

fn validate_grounded_config(
    config: GroundedConfig,
) -> std::result::Result<(), PhysicalBodyDefinitionError> {
    if !config.gravity.is_finite()
        || !config.walkable_normal_z.is_finite()
        || !(0.0..=1.0).contains(&config.walkable_normal_z)
        || !config.step_up_height.is_finite()
        || config.step_up_height < 0.0
        || !config.step_down_height.is_finite()
        || config.step_down_height < 0.0
        || !config.maximum_substep_distance.is_finite()
        || config.maximum_substep_distance <= 0.0
        || config.maximum_substeps == 0
        || config.maximum_contact_passes == 0
        || !config.separation_epsilon.is_finite()
        || config.separation_epsilon < 0.0
    {
        return Err(PhysicalBodyDefinitionError::InvalidResponseConfig);
    }
    Ok(())
}

fn validate_finite_velocity(
    velocity: Vector3,
) -> std::result::Result<(), PhysicalBodyActuationError> {
    if velocity.x.is_finite() && velocity.y.is_finite() && velocity.z.is_finite() {
        Ok(())
    } else {
        Err(PhysicalBodyActuationError::NonFiniteVelocity)
    }
}

/// Derives non-gating collision residency from the final primary-sphere owner exactly once.
pub fn physical_body_scene_residency(
    scene: &CollisionScene,
    pose: WorldPosition,
    definition: PhysicalBodyDefinition,
    committed_cell: Option<Guid>,
) -> PhysicalBodySceneResidency {
    if let Some(cell) = committed_cell {
        let owner = Guid((cell.0 & 0xffff_0000) | 0xffff);
        return if scene.contains_env_cell(cell) {
            PhysicalBodySceneResidency::Resident
        } else {
            PhysicalBodySceneResidency::MissingOwner { owner }
        };
    }

    let anchor = Guid((pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let primary = definition.spheres().primary();
    let center = pose.coords + pose.rotation.rotate_vector(primary.center);
    let Some(owner) = outdoor_landblock_owner_at(anchor, center) else {
        return PhysicalBodySceneResidency::OutsideLandscape;
    };
    if scene.contains_landblock(owner) {
        PhysicalBodySceneResidency::Resident
    } else {
        PhysicalBodySceneResidency::MissingOwner { owner }
    }
}

/// Resolves initial response placement from one caller-provided portal-history seed.
///
pub fn resolve_physical_body_cell(
    scene: &CollisionScene,
    pose: WorldPosition,
    definition: PhysicalBodyDefinition,
    seed_cell: Option<Guid>,
) -> Result<Option<Guid>, CollisionQueryError> {
    Ok(resolve_physical_body_placement(scene, pose, definition, seed_cell)?.committed_cell())
}

/// Resolves the complete initial collision-domain membership for every movement sphere.
pub(crate) fn resolve_physical_body_placement(
    scene: &CollisionScene,
    pose: WorldPosition,
    definition: PhysicalBodyDefinition,
    seed_cell: Option<Guid>,
) -> Result<SpatialMembership, CollisionQueryError> {
    let primary = definition.spheres().primary();
    let anchor = Guid((pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let center = pose.coords + pose.rotation.rotate_vector(primary.center);
    let mut placement = scene.transit_cell(CellTransitRequest {
        previous_cell: seed_cell,
        anchor,
        center,
        radius: primary.radius,
    })?;
    if let Some(upper) = definition.spheres().upper_constraint() {
        placement = placement.merge_reached(scene.transit_cell(CellTransitRequest {
            previous_cell: seed_cell,
            anchor,
            center: pose.coords + pose.rotation.rotate_vector(upper.center),
            radius: upper.radius,
        })?);
    }
    Ok(placement)
}

fn validate_sphere(sphere: Sphere) -> Result<GroundedSphere, PhysicalBodyDefinitionError> {
    if !vector_is_finite(sphere.center) {
        return Err(PhysicalBodyDefinitionError::NonFiniteCenter);
    }
    if !sphere.radius.is_finite() || sphere.radius <= 0.0 {
        return Err(PhysicalBodyDefinitionError::InvalidRadius);
    }
    Ok(GroundedSphere {
        center: sphere.center,
        radius: sphere.radius,
    })
}

fn vector_is_finite(vector: Vector3) -> bool {
    vector.x.is_finite() && vector.y.is_finite() && vector.z.is_finite()
}

#[cfg(test)]
#[path = "restitution_retail_differential.rs"]
mod restitution_retail_differential;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{EdgeProtection, FreeSphereConfig, GroundedConfig, RETAIL_WALKABLE_NORMAL_Z};
    use holtburger_content::{
        LandblockColliders, LandblockCollisionAsset, TerrainCollisionSurface,
    };

    const FLY_CONFIG: FreeSphereConfig = FreeSphereConfig {
        maximum_substep_distance: 0.25,
        maximum_substeps: 8,
        maximum_contact_passes: 4,
        separation_epsilon: 0.001,
    };
    const GROUNDED_CONFIG: GroundedConfig = GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        landing_normal_z: crate::RETAIL_LANDING_NORMAL_Z,
        airborne_step_down_height: crate::RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
        step_up_height: 0.6,
        step_down_height: 1.5,
        edge_protection: EdgeProtection::Creature,
        maximum_substep_distance: 0.25,
        maximum_substeps: 8,
        maximum_contact_passes: 4,
        separation_epsilon: 0.001,
    };

    fn sphere(z: f32, radius: f32) -> Sphere {
        Sphere {
            center: Vector3::new(0.0, 0.0, z),
            radius,
        }
    }

    fn empty_collision(owner: Guid) -> CollisionScene {
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: owner.0,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();
        scene
    }

    #[test]
    fn definitions_preserve_parameterized_geometry_and_response_roles() {
        let single = PhysicalSphereSet::new(sphere(0.2, 0.3), None).unwrap();
        assert_eq!(
            PhysicalBodyDefinition::free_sphere(single, FLY_CONFIG).unwrap(),
            PhysicalBodyDefinition::FreeSphere {
                sphere: GroundedSphere {
                    center: Vector3::new(0.0, 0.0, 0.2),
                    radius: 0.3,
                },
                config: FLY_CONFIG,
            }
        );

        let pair = PhysicalSphereSet::new(sphere(0.4, 0.5), Some(sphere(1.2, 0.6))).unwrap();
        assert_eq!(
            PhysicalBodyDefinition::grounded(pair, GROUNDED_CONFIG).unwrap(),
            PhysicalBodyDefinition::Grounded {
                spheres: GroundedBodySpheres {
                    support: GroundedSphere {
                        center: Vector3::new(0.0, 0.0, 0.4),
                        radius: 0.5,
                    },
                    upper: Some(GroundedSphere {
                        center: Vector3::new(0.0, 0.0, 1.2),
                        radius: 0.6,
                    }),
                },
                config: GROUNDED_CONFIG,
            }
        );
    }

    /// The tick's end orientation is produced once, by the solver, with retained physical omega
    /// already integrated into the accepted pose.
    ///
    /// It used to be reconstructed twice more — by the scene commit and by dynamic contact — each
    /// re-integrating omega from the body. Those reconstructions agreed only by coincidence of
    /// identical arithmetic; sampling the accepted rotation instead makes them the same fact.
    #[test]
    fn the_accepted_pose_carries_the_ticks_physical_rotation() {
        let scene = empty_collision(Guid(0x0101_FFFF));
        let definition = PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(sphere(0.0, 0.3), None).unwrap(),
            FLY_CONFIG,
        )
        .unwrap();
        let mut body = SpatialBody::new(
            crate::SpatialBodyId::Ephemeral(1),
            WorldPosition {
                landblock_id: Guid(0x0101_FFFF),
                coords: Vector3::new(10.0, 10.0, 10.0),
                rotation: Quaternion::identity(),
            },
            std::time::Instant::now(),
        );
        body.retained.omega = Vector3::new(0.0, 0.0, 1.0);
        body.physical = Some(PhysicalBodyState::new(
            definition,
            PhysicalCollisionFilter::ALL,
            PhysicalBodyResponsePolicy {
                restitution: PhysicalRestitution::Inelastic,
                friction: PhysicalFriction::DEFAULT,
                surface_motion: PhysicalSurfaceMotion::Stable,
                align_path: false,
            },
            None,
        ));

        let commit = solve_physical_body_tick(
            &scene,
            &body,
            &PhysicalBodyActuation::free_flight(Vector3::zero()).unwrap(),
            0.5,
        )
        .expect("a free sphere in an empty scene solves");

        let expected = super::super::scene::integrate_angular_velocity(
            Quaternion::identity(),
            body.retained.omega,
            0.5,
        );
        assert!((commit.pose.rotation.w - expected.w).abs() < 1e-6);
        assert!((commit.pose.rotation.z - expected.z).abs() < 1e-6);
        assert!(
            (commit.pose.rotation.to_heading() - Quaternion::identity().to_heading()).abs() > 1e-3,
            "a body with retained omega ends the tick rotated"
        );
    }

    #[test]
    fn definitions_reject_invalid_or_unsupported_geometry() {
        assert_eq!(
            PhysicalSphereSet::new(sphere(0.0, 0.0), None),
            Err(PhysicalBodyDefinitionError::InvalidRadius)
        );
        assert_eq!(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::new(f32::NAN, 0.0, 0.0),
                    radius: 1.0,
                },
                None,
            ),
            Err(PhysicalBodyDefinitionError::NonFiniteCenter)
        );
        let pair = PhysicalSphereSet::new(sphere(0.4, 0.5), Some(sphere(1.2, 0.6))).unwrap();
        assert_eq!(
            PhysicalBodyDefinition::free_sphere(pair, FLY_CONFIG),
            Err(PhysicalBodyDefinitionError::FreeSphereHasUpperConstraint)
        );
    }

    #[test]
    fn typed_actuation_rejects_invalid_velocity_domains() {
        assert_eq!(
            PhysicalBodyActuation::free_flight(Vector3::new(f32::NAN, 0.0, 0.0)),
            Err(PhysicalBodyActuationError::NonFiniteVelocity)
        );
        assert_eq!(
            PhysicalBodyActuation::grounded_drive(Vector3::new(1.0, 0.0, 0.01)),
            Err(PhysicalBodyActuationError::VerticalGroundedDrive)
        );
        assert_eq!(
            GroundedLaunch::new(Vector3::new(1.0, 0.0, 0.0)),
            Err(PhysicalBodyActuationError::NonUpwardLaunch)
        );
        assert_eq!(
            GroundedLaunch::new(Vector3::new(0.0, 0.0, f32::INFINITY)),
            Err(PhysicalBodyActuationError::NonFiniteVelocity)
        );
        assert_eq!(
            GroundedBodyActuation::coast().with_control_heading(f32::NAN),
            Err(PhysicalBodyActuationError::NonFiniteControlHeading)
        );
    }

    #[test]
    fn response_coefficients_preserve_retail_bounds_and_semantic_distinctions() {
        assert_eq!(
            PhysicalElasticity::new(-4.0).unwrap(),
            PhysicalElasticity::ZERO
        );
        assert_eq!(
            PhysicalElasticity::new(4.0).unwrap(),
            PhysicalElasticity::MAXIMUM
        );
        assert_eq!(
            PhysicalElasticity::new(f32::NAN),
            Err(PhysicalBodyResponsePolicyError::NonFiniteElasticity)
        );
        assert_eq!(
            PhysicalFriction::new(1.01),
            Err(PhysicalBodyResponsePolicyError::InvalidFriction)
        );
        assert_ne!(
            PhysicalRestitution::Elastic(PhysicalElasticity::ZERO),
            PhysicalRestitution::Inelastic
        );
    }

    #[test]
    fn controlled_facing_is_followed_by_sledding_then_align_path_precedence() {
        let mut pose = WorldPosition {
            landblock_id: Guid(0xda55_0020),
            coords: Vector3::zero(),
            rotation: Quaternion::from_heading(0.75),
        };
        let mut policy = PhysicalBodyResponsePolicy {
            restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
            friction: PhysicalFriction::DEFAULT,
            surface_motion: PhysicalSurfaceMotion::Sledding,
            align_path: true,
        };
        apply_grounded_facing(
            &mut pose,
            Vector3::new(0.0, 2.0, 0.0),
            Vector3::new(-2.0, 0.0, 0.0),
            policy,
            Some(-0.5),
        );
        assert!((pose.rotation.to_heading() - 90.0_f32.to_radians()).abs() < 0.000_01);

        policy.align_path = false;
        apply_grounded_facing(
            &mut pose,
            Vector3::zero(),
            Vector3::new(-2.0, 0.0, 0.0),
            policy,
            Some(-0.5),
        );
        assert!(pose.rotation.to_heading().abs() < 0.000_01);

        policy.surface_motion = PhysicalSurfaceMotion::Stable;
        apply_grounded_facing(
            &mut pose,
            Vector3::zero(),
            Vector3::new(-2.0, 0.0, 0.0),
            policy,
            Some(-0.5),
        );
        assert_eq!(pose.rotation, Quaternion::from_heading(-0.5));
    }
}
