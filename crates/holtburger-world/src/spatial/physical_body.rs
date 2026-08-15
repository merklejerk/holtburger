//! Validated physical-body geometry and response definitions shared by every body source.

use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Sphere, Vector3};
use thiserror::Error;

use super::{
    CellTransitRequest, CollisionQuery, CollisionQueryError, CollisionScene, ContactState,
    CoverageRequest, GroundSupport, GroundedBody, GroundedBodySpheres, GroundedBudget,
    GroundedConfig, GroundedOutcome, GroundedRequest, GroundedSphere, MissingCoverage,
    MotionWaypoint, PhysicalFlyBody, PhysicalFlyBudget, PhysicalFlyConfig, PhysicalFlyOutcome,
    PhysicalFlyRequest, PlacedMotionPath, PlacedMotionPathRequest, PlacementRequest, SpatialBody,
    solve_grounded, solve_physical_fly,
};

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
    /// These flags affect contact participation only. Placement, portal traversal, and collision
    /// coverage remain authoritative regardless of a body's filter.
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
#[derive(Debug, PartialEq)]
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
#[derive(Debug, PartialEq)]
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
    pub const fn coast() -> Self {
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
#[derive(Debug, PartialEq)]
pub enum PhysicalBodyActuation {
    /// Unrestricted collision-aware three-dimensional target velocity.
    FreeFlight {
        /// Desired world-space velocity for this tick.
        velocity: Vector3,
    },
    /// Grounded drive plus an optional supported launch edge.
    Grounded(GroundedBodyActuation),
}

impl PhysicalBodyActuation {
    pub fn free_flight(velocity: Vector3) -> std::result::Result<Self, PhysicalBodyActuationError> {
        validate_finite_velocity(velocity)?;
        Ok(Self::FreeFlight { velocity })
    }

    pub fn grounded_drive(
        supported_planar_velocity: Vector3,
    ) -> std::result::Result<Self, PhysicalBodyActuationError> {
        Ok(Self::Grounded(GroundedBodyActuation::drive(
            supported_planar_velocity,
        )?))
    }
}

/// Response-owned state retained with a generic body's single authoritative pose.
#[derive(Debug, Clone, PartialEq)]
pub enum PhysicalBodyResponseState {
    /// Placement state for collision-aware free three-dimensional motion.
    FreeSphere {
        /// Current interior cell, or `None` while outdoors.
        cell: Option<Guid>,
    },
    /// Placement, gravity, and support memory owned by grounded response.
    Grounded {
        /// Current support-sphere interior cell, or `None` while outdoors.
        cell: Option<Guid>,
        /// Last committed walkable support for the lower sphere.
        support: Option<GroundSupport>,
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

/// Why retained body placement cannot be resumed against the current topology.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InvalidPhysicalBodyPlacement {
    /// A retained EnvCell is absent from the restored collision snapshot.
    RetainedCellUnavailable(Guid),
    /// Restored topology selects a different placement for the unchanged body.
    PlacementChanged {
        /// Cell retained while coverage was absent.
        retained: Option<Guid>,
        /// Cell selected by restored topology.
        restored: Option<Guid>,
    },
    /// The unchanged retained shape overlaps restored authored collision.
    OverlapsStaticCollision,
    /// The body's center occupies a region forbidden by one participating collision domain.
    ForbiddenCollisionRegion,
}

/// Exhaustive collision-coverage lifecycle for a registered physical body.
#[derive(Debug, Clone, PartialEq)]
pub enum PhysicalBodyActivity {
    /// Required collision coverage and retained placement are valid for fixed ticks.
    Active,
    /// Exact required collision owners are absent; all body state is frozen.
    AwaitingCoverage(MissingCoverage),
    /// Coverage exists, but retained placement is incompatible with restored topology.
    InvalidPlacement(InvalidPhysicalBodyPlacement),
}

/// Physical definition, response memory, and coverage activity attached to one spatial body.
#[derive(Debug, Clone, PartialEq)]
pub struct PhysicalBodyState {
    /// Validated geometry and response policy shared by every spawn source.
    pub definition: PhysicalBodyDefinition,
    /// Body-owned collision participation, separate from response and topology.
    pub collision_filter: PhysicalCollisionFilter,
    /// Mutable authored/network response state, independent from immutable geometry.
    pub response_policy: PhysicalBodyResponsePolicy,
    /// Response-only state; the containing `SpatialBody` remains the sole pose owner.
    pub response: PhysicalBodyResponseState,
    /// Whether the body may receive a fixed simulation tick.
    pub activity: PhysicalBodyActivity,
}

impl PhysicalBodyState {
    /// Builds response memory whose variant is guaranteed to match the definition.
    pub fn new(
        definition: PhysicalBodyDefinition,
        collision_filter: PhysicalCollisionFilter,
        response_policy: PhysicalBodyResponsePolicy,
        cell: Option<Guid>,
    ) -> Self {
        let response = match definition {
            PhysicalBodyDefinition::FreeSphere { .. } => {
                PhysicalBodyResponseState::FreeSphere { cell }
            }
            PhysicalBodyDefinition::Grounded { .. } => PhysicalBodyResponseState::Grounded {
                cell,
                support: None,
                stationary_fall_frames: 0,
            },
        };
        Self {
            definition,
            collision_filter,
            response_policy,
            response,
            activity: PhysicalBodyActivity::Active,
        }
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
        config: PhysicalFlyConfig,
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
        config: PhysicalFlyConfig,
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

/// Result category for one active generic physical-body fixed tick.
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
    /// Whether grounded response committed walkable support.
    pub grounded: bool,
    /// Distinct non-walkable planes encountered by grounded response.
    pub constraint_count: usize,
    /// Collision substeps consumed by the solve.
    pub substeps: usize,
    /// Contact-separation passes consumed by the solve.
    pub contact_passes: usize,
}

/// Observable result of requesting one generic body tick.
#[derive(Debug, Clone, PartialEq)]
pub enum PhysicalBodyTickOutcome {
    /// The body was active and produced one authoritative placed path.
    Motion(PhysicalBodyMotion),
    /// The registered body remains frozen in an observable non-active state.
    Inactive {
        /// Exact retained coverage or placement state.
        activity: PhysicalBodyActivity,
    },
}

/// One fixed-tick result plus its optional coverage-activity transition.
#[derive(Debug, Clone, PartialEq)]
pub struct PhysicalBodyTickResult {
    /// Motion or retained inactive state produced by the request.
    pub outcome: PhysicalBodyTickOutcome,
    /// Emitted exactly once when this tick changes collision activity.
    pub activity_event: Option<super::SpatialBodyEvent>,
}

#[derive(Debug, Clone)]
/// Complete tentative body state committed only after every query succeeds.
pub(super) struct PhysicalBodyTickCommit {
    /// Accepted body-reference pose.
    pub pose: WorldPosition,
    /// Velocity achieved by the accepted displacement.
    pub velocity: Vector3,
    /// Coarse support state derived by the selected response.
    pub contact: ContactState,
    /// Response-only state matching the physical definition variant.
    pub response: PhysicalBodyResponseState,
    /// Collision-coverage activity after the solve.
    pub activity: PhysicalBodyActivity,
    /// Placed motion or explicit inactive result returned to the caller.
    pub outcome: PhysicalBodyTickOutcome,
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
    support: Option<GroundSupport>,
    /// Prior stationary-fall transition stage.
    stationary_fall_frames: u8,
}

#[derive(Debug, Clone, Copy)]
/// Inputs retained by free-sphere response while a generic tick is evaluated.
struct FreeSphereTickState {
    /// Body-local collision sphere.
    sphere: GroundedSphere,
    /// Finite free-flight solver policy.
    config: PhysicalFlyConfig,
    /// Retained mutable collision and facing response.
    response_policy: PhysicalBodyResponsePolicy,
    /// Body-owned optional collision-domain exclusions.
    collision_filter: PhysicalCollisionFilter,
    /// Prior sphere-center interior cell.
    cell: Option<Guid>,
}

#[derive(Debug, Clone, Copy)]
/// Observable result facts retained when a finite solver budget stops the tick.
struct HeldTickDiagnostics {
    /// Budget category that prevented ordinary completion.
    status: PhysicalBodyTickStatus,
    /// Whether the unchanged prior state retained walkable support.
    grounded: bool,
    /// Distinct non-walkable constraints encountered before the stop.
    constraint_count: usize,
    /// Completed anti-tunneling subdivisions.
    substeps: usize,
    /// Completed contact-separation passes.
    contact_passes: usize,
}

/// Solves one registered body without mutating the canonical store until every query completes.
pub(super) fn solve_physical_body_tick(
    scene: &CollisionScene,
    body: &SpatialBody,
    actuation: PhysicalBodyActuation,
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
    if physical.activity != PhysicalBodyActivity::Active {
        return Ok(PhysicalBodyTickCommit {
            pose: body.pose,
            velocity: body.velocity,
            contact: body.contact,
            response: physical.response.clone(),
            activity: physical.activity.clone(),
            outcome: PhysicalBodyTickOutcome::Inactive {
                activity: physical.activity.clone(),
            },
        });
    }
    match (physical.definition, &physical.response) {
        (
            PhysicalBodyDefinition::FreeSphere { sphere, config },
            PhysicalBodyResponseState::FreeSphere { cell },
        ) => {
            let PhysicalBodyActuation::FreeFlight { velocity } = actuation else {
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
                velocity,
                delta_seconds,
            )
        }
        (
            PhysicalBodyDefinition::Grounded { spheres, config },
            PhysicalBodyResponseState::Grounded {
                cell,
                support,
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
                    support: *support,
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
    desired_velocity: Vector3,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    let response = PhysicalBodyResponseState::FreeSphere { cell: state.cell };
    let offset = body.pose.rotation.rotate_vector(state.sphere.center);
    let mut sphere_pose = body.pose;
    sphere_pose.coords = sphere_pose.coords + offset;
    let outcome = solve_physical_fly(
        scene,
        state.config,
        PhysicalFlyRequest {
            body: PhysicalFlyBody {
                pose: sphere_pose,
                cell: state.cell,
                radius: state.sphere.radius,
            },
            displacement: desired_velocity * delta_seconds,
            filter: state.collision_filter,
        },
    )?;
    match outcome {
        PhysicalFlyOutcome::Solved {
            body: solved,
            achieved_displacement,
            collision_normal,
            motion,
            substeps,
            contact_passes,
        } => {
            let path = trace_body_reference_path(
                scene,
                body.pose,
                state.cell,
                state.sphere,
                &motion,
                true,
            )?;
            let committed_cell = path.final_point().placement().committed_cell();
            ensure!(
                committed_cell == solved.cell || path.has_recovery(),
                "free-sphere placed path ended in {committed_cell:?}, but collision response committed {:?}",
                solved.cell
            );
            let mut pose = body_reference_pose(solved.pose, committed_cell, offset)?;
            let velocity = collision_response(CollisionResponseInput {
                incoming: desired_velocity,
                achieved_velocity: achieved_displacement / delta_seconds,
                restitution: state.response_policy.restitution,
                collision_normal,
                previously_walkable: false,
                current_support_normal: None,
                surface_motion: state.response_policy.surface_motion,
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
                velocity,
                contact: ContactState::Airborne,
                response: PhysicalBodyResponseState::FreeSphere {
                    cell: committed_cell,
                },
                activity: PhysicalBodyActivity::Active,
                outcome: PhysicalBodyTickOutcome::Motion(PhysicalBodyMotion {
                    path,
                    status: PhysicalBodyTickStatus::Solved,
                    grounded: false,
                    constraint_count: 0,
                    substeps,
                    contact_passes,
                }),
            })
        }
        PhysicalFlyOutcome::MissingCoverage { missing, .. } => {
            inactive_commit(body, response, missing)
        }
        PhysicalFlyOutcome::BudgetExceeded {
            budget,
            substeps,
            contact_passes,
            ..
        } => held_motion_commit(
            scene,
            body,
            response,
            state.sphere,
            HeldTickDiagnostics {
                status: free_budget_status(budget),
                grounded: false,
                constraint_count: 0,
                substeps,
                contact_passes,
            },
        ),
    }
}

fn solve_grounded_body_tick(
    scene: &CollisionScene,
    body: &SpatialBody,
    state: GroundedTickState,
    actuation: GroundedBodyActuation,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    let response = PhysicalBodyResponseState::Grounded {
        cell: state.cell,
        support: state.support,
        stationary_fall_frames: state.stationary_fall_frames,
    };
    let mut grounded_body = GroundedBody {
        pose: body.pose,
        cell: state.cell,
        velocity: body.velocity,
        support: state.support,
    };
    // A newly attached grounded body has not yet had a collision transaction classify its
    // contact. Let explicit planar drive participate in that first transaction so a body placed
    // on a floor does not discard one tick of input. Once a solve commits `Airborne`, canonical
    // velocity remains ballistic and later drive cannot steer it.
    if body.contact == ContactState::Unknown
        && grounded_body.support.is_none()
        && let GroundedSupportedMotion::Driven(velocity) = actuation.supported_motion
    {
        grounded_body.velocity.x = velocity.x;
        grounded_body.velocity.y = velocity.y;
    }
    let may_step_down = grounded_step_down_enabled(body.contact, actuation.launch.is_some());
    if let Some(launch) = actuation.launch {
        ensure!(
            grounded_body.support.is_some(),
            "grounded launch requires current walkable support"
        );
        grounded_body.velocity = launch.velocity();
        grounded_body.support = None;
    }
    let mut supported_velocity = match actuation.supported_motion {
        GroundedSupportedMotion::Driven(velocity) => velocity,
        GroundedSupportedMotion::Coasting => grounded_body.velocity,
    };
    if let Some(support) = grounded_body.support {
        match (
            state.response_policy.surface_motion,
            actuation.supported_motion,
        ) {
            (PhysicalSurfaceMotion::Stable, GroundedSupportedMotion::Driven(_)) => {}
            (PhysicalSurfaceMotion::Stable, GroundedSupportedMotion::Coasting) => {
                supported_velocity = surface_friction(
                    supported_velocity,
                    support.normal,
                    state.response_policy.friction,
                    delta_seconds,
                    PhysicalSurfaceMotion::Stable,
                );
            }
            (PhysicalSurfaceMotion::Sledding, _) => {
                grounded_body.velocity = surface_friction(
                    supported_velocity,
                    support.normal,
                    state.response_policy.friction,
                    delta_seconds,
                    PhysicalSurfaceMotion::Sledding,
                );
                supported_velocity = grounded_body.velocity;
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
            may_step_down,
            retain_supported_gravity: physical_surface_retains_gravity(
                state.response_policy.surface_motion,
            ),
            delta_seconds,
            filter: state.collision_filter,
        },
    )?;
    match outcome {
        GroundedOutcome::Solved {
            body: solved,
            achieved_velocity,
            collision_normal,
            motion,
            substeps,
            contact_passes,
            constraint_count,
        } => {
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
            // Support identity belongs to the collision domain that produced it. A recovered
            // placement deliberately drops that memory so the next ordinary tick reacquires it.
            let support = if recovered { None } else { solved.support };
            let stationary_fall_frames = next_stationary_fall_frames(
                state.stationary_fall_frames,
                state.support,
                support,
                collision_normal,
                achieved_velocity,
            );
            let collision_response = collision_response(CollisionResponseInput {
                incoming: solved.velocity,
                achieved_velocity,
                restitution: state.response_policy.restitution,
                collision_normal,
                previously_walkable: state.support.is_some(),
                current_support_normal: support.map(|current| current.normal),
                surface_motion: state.response_policy.surface_motion,
                stationary_fall_frames,
            });
            let support = if collision_response.separates_from_support {
                None
            } else {
                support
            };
            let velocity = collision_response.velocity;
            apply_grounded_facing(
                &mut pose,
                achieved_velocity * delta_seconds,
                velocity,
                state.response_policy,
                actuation.control_heading,
            );
            let grounded = support.is_some();
            Ok(PhysicalBodyTickCommit {
                pose,
                velocity,
                contact: if grounded {
                    ContactState::Grounded
                } else {
                    ContactState::Airborne
                },
                response: PhysicalBodyResponseState::Grounded {
                    cell: committed_cell,
                    support,
                    stationary_fall_frames,
                },
                activity: PhysicalBodyActivity::Active,
                outcome: PhysicalBodyTickOutcome::Motion(PhysicalBodyMotion {
                    path,
                    status: PhysicalBodyTickStatus::Solved,
                    grounded,
                    constraint_count,
                    substeps,
                    contact_passes,
                }),
            })
        }
        GroundedOutcome::MissingCoverage { missing, .. } => {
            inactive_commit(body, response, missing)
        }
        GroundedOutcome::BudgetExceeded {
            budget,
            substeps,
            contact_passes,
            constraint_count,
            ..
        } => held_motion_commit(
            scene,
            body,
            response,
            state.spheres.support,
            HeldTickDiagnostics {
                status: grounded_budget_status(budget),
                grounded: state.support.is_some(),
                constraint_count,
                substeps,
                contact_passes,
            },
        ),
    }
}

/// Projects retained generic contact into retail's ordinary walking step-down eligibility.
pub(crate) const fn grounded_step_down_enabled(contact: ContactState, launching: bool) -> bool {
    !launching && !matches!(contact, ContactState::Airborne)
}

fn trace_body_reference_path(
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
    match scene.transit_motion_path(PlacedMotionPathRequest {
        previous_cell,
        anchor,
        start: initial_pose.coords + offset,
        radius: primary.radius,
        waypoints: &sphere_motion,
    })? {
        CollisionQuery::Complete(path) => Ok(path.translated(offset * -1.0)),
        CollisionQuery::MissingCoverage(missing) => {
            anyhow::bail!("coverage changed while placing accepted body motion: {missing:?}")
        }
    }
}

fn held_motion_commit(
    scene: &CollisionScene,
    body: &SpatialBody,
    response: PhysicalBodyResponseState,
    primary: GroundedSphere,
    diagnostics: HeldTickDiagnostics,
) -> Result<PhysicalBodyTickCommit> {
    let path = trace_body_reference_path(
        scene,
        body.pose,
        response.cell(),
        primary,
        &[MotionWaypoint {
            center: body.pose.coords,
            end_fraction: 1.0,
            placement: super::collision::MotionWaypointPlacement::Committed(response.cell()),
        }],
        false,
    )?;
    let committed_cell = path.final_point().placement().committed_cell();
    let recovered = path.has_recovery();
    let pose = if recovered {
        body_reference_pose(body.pose, committed_cell, Vector3::zero())?
    } else {
        body.pose
    };
    let response = match response {
        PhysicalBodyResponseState::FreeSphere { .. } => PhysicalBodyResponseState::FreeSphere {
            cell: committed_cell,
        },
        PhysicalBodyResponseState::Grounded {
            support,
            stationary_fall_frames,
            ..
        } => PhysicalBodyResponseState::Grounded {
            cell: committed_cell,
            support: if recovered { None } else { support },
            stationary_fall_frames: if recovered { 0 } else { stationary_fall_frames },
        },
    };
    let grounded = diagnostics.grounded && !recovered;
    Ok(PhysicalBodyTickCommit {
        pose,
        velocity: body.velocity,
        contact: if recovered {
            ContactState::Airborne
        } else {
            body.contact
        },
        response,
        activity: PhysicalBodyActivity::Active,
        outcome: PhysicalBodyTickOutcome::Motion(PhysicalBodyMotion {
            path,
            status: diagnostics.status,
            grounded,
            constraint_count: diagnostics.constraint_count,
            substeps: diagnostics.substeps,
            contact_passes: diagnostics.contact_passes,
        }),
    })
}

fn inactive_commit(
    body: &SpatialBody,
    response: PhysicalBodyResponseState,
    missing: MissingCoverage,
) -> Result<PhysicalBodyTickCommit> {
    let activity = PhysicalBodyActivity::AwaitingCoverage(missing);
    Ok(PhysicalBodyTickCommit {
        pose: body.pose,
        velocity: body.velocity,
        contact: body.contact,
        response,
        activity: activity.clone(),
        outcome: PhysicalBodyTickOutcome::Inactive { activity },
    })
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

fn free_budget_status(budget: PhysicalFlyBudget) -> PhysicalBodyTickStatus {
    match budget {
        PhysicalFlyBudget::Substeps => PhysicalBodyTickStatus::SubstepBudgetExceeded,
        PhysicalFlyBudget::Contacts => PhysicalBodyTickStatus::ContactBudgetExceeded,
    }
}

fn grounded_budget_status(budget: GroundedBudget) -> PhysicalBodyTickStatus {
    match budget {
        GroundedBudget::Substeps => PhysicalBodyTickStatus::SubstepBudgetExceeded,
        GroundedBudget::Contacts => PhysicalBodyTickStatus::ContactBudgetExceeded,
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
    /// Velocity measured from the displacement accepted by the geometry solver.
    achieved_velocity: Vector3,
    /// Authored body restitution behavior.
    restitution: PhysicalRestitution,
    /// Most relevant impact normal produced by the collision transaction.
    collision_normal: Option<Vector3>,
    /// Whether the preceding committed tick retained walkable support.
    previously_walkable: bool,
    /// Current support normal, independently from whether an impact normal was produced.
    current_support_normal: Option<Vector3>,
    /// Stable or Sledding supported-surface behavior.
    surface_motion: PhysicalSurfaceMotion,
    /// Retail's repeated stationary-fall escalation stage.
    stationary_fall_frames: u8,
}

fn physical_surface_retains_gravity(surface_motion: PhysicalSurfaceMotion) -> bool {
    surface_motion == PhysicalSurfaceMotion::Sledding
}

fn collision_response(input: CollisionResponseInput) -> CollisionResponse {
    let CollisionResponseInput {
        incoming,
        achieved_velocity,
        restitution,
        collision_normal,
        previously_walkable,
        current_support_normal,
        surface_motion,
        stationary_fall_frames,
    } = input;
    if stationary_fall_frames > MAXIMUM_BOUNCE_STATIONARY_FALL_FRAMES {
        return CollisionResponse {
            velocity: Vector3::zero(),
            separates_from_support: false,
        };
    }
    let currently_walkable = current_support_normal.is_some();
    let continuous_support = previously_walkable && currently_walkable;
    if continuous_support && surface_motion == PhysicalSurfaceMotion::Stable {
        // A grounded solve has already redirected ordinary drive along its support plane. The
        // original horizontal drive may point outward from a downhill plane, but retail retains
        // continuous stable contact and commits the achieved tangent instead of treating that
        // component as takeoff (`CTransition::adjust_offset`, acclient.c:300589-300730;
        // `CPhysicsObj::handle_all_collisions`, acclient.c:309982-310068).
        return CollisionResponse {
            velocity: achieved_velocity,
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
    config: PhysicalFlyConfig,
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

/// Evaluates whether an unchanged retained body can simulate against one collision snapshot.
pub fn evaluate_physical_body_activity(
    scene: &CollisionScene,
    pose: WorldPosition,
    physical: &PhysicalBodyState,
) -> Result<PhysicalBodyActivity, CollisionQueryError> {
    if let Some(missing) = physical_body_missing_coverage(scene, pose, physical.definition)? {
        return Ok(PhysicalBodyActivity::AwaitingCoverage(missing));
    }

    let anchor = Guid((pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let retained_cell = physical.response.cell();
    let spheres = physical.definition.spheres();
    if let Some(cell) = retained_cell
        && !scene.contains_env_cell(cell)
    {
        return Ok(PhysicalBodyActivity::InvalidPlacement(
            InvalidPhysicalBodyPlacement::RetainedCellUnavailable(cell),
        ));
    }

    for (index, sphere) in [Some(spheres.primary()), spheres.upper_constraint()]
        .into_iter()
        .flatten()
        .enumerate()
    {
        let center = pose.coords + pose.rotation.rotate_vector(sphere.center);
        let placement = match scene.transit_cell(CellTransitRequest {
            previous_cell: retained_cell,
            anchor,
            center,
            radius: sphere.radius,
        })? {
            CollisionQuery::Complete(placement) => placement,
            CollisionQuery::MissingCoverage(current) => {
                return Ok(PhysicalBodyActivity::AwaitingCoverage(current));
            }
        };
        if index == 0 && placement.committed_cell() != retained_cell {
            return Ok(PhysicalBodyActivity::InvalidPlacement(
                InvalidPhysicalBodyPlacement::PlacementChanged {
                    retained: retained_cell,
                    restored: placement.committed_cell(),
                },
            ));
        }
        if index == 0
            && scene.body_center_is_forbidden(anchor, center, &placement, physical.collision_filter)
        {
            return Ok(PhysicalBodyActivity::InvalidPlacement(
                InvalidPhysicalBodyPlacement::ForbiddenCollisionRegion,
            ));
        }
        let contacts = match scene.placement_contacts(PlacementRequest {
            anchor,
            center,
            radius: sphere.radius,
            placement: &placement,
        })? {
            CollisionQuery::Complete(contacts) => contacts,
            CollisionQuery::MissingCoverage(current) => {
                return Ok(PhysicalBodyActivity::AwaitingCoverage(current));
            }
        };
        if !contacts.is_empty() {
            return Ok(PhysicalBodyActivity::InvalidPlacement(
                InvalidPhysicalBodyPlacement::OverlapsStaticCollision,
            ));
        }
    }
    Ok(PhysicalBodyActivity::Active)
}

/// Initial registration checks coverage and center-forbidden domains; the first ordinary response
/// solve still establishes contact-safe placement. Restoration uses
/// `evaluate_physical_body_activity` because an already-safe retained pose may neither settle nor
/// relabel itself when content returns.
pub fn initial_physical_body_activity(
    scene: &CollisionScene,
    pose: WorldPosition,
    definition: PhysicalBodyDefinition,
    collision_filter: PhysicalCollisionFilter,
    retained_cell: Option<Guid>,
) -> Result<PhysicalBodyActivity, CollisionQueryError> {
    if let Some(missing) = physical_body_missing_coverage(scene, pose, definition)? {
        return Ok(PhysicalBodyActivity::AwaitingCoverage(missing));
    }
    let anchor = Guid((pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let sphere = definition.spheres().primary();
    let center = pose.coords + pose.rotation.rotate_vector(sphere.center);
    let placement = match scene.transit_cell(CellTransitRequest {
        previous_cell: retained_cell,
        anchor,
        center,
        radius: sphere.radius,
    })? {
        CollisionQuery::Complete(placement) => placement,
        CollisionQuery::MissingCoverage(missing) => {
            return Ok(PhysicalBodyActivity::AwaitingCoverage(missing));
        }
    };
    if scene.body_center_is_forbidden(anchor, center, &placement, collision_filter) {
        return Ok(PhysicalBodyActivity::InvalidPlacement(
            InvalidPhysicalBodyPlacement::ForbiddenCollisionRegion,
        ));
    }
    Ok(PhysicalBodyActivity::Active)
}

fn physical_body_missing_coverage(
    scene: &CollisionScene,
    pose: WorldPosition,
    definition: PhysicalBodyDefinition,
) -> Result<Option<MissingCoverage>, CollisionQueryError> {
    let anchor = Guid((pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let spheres = definition.spheres();
    let mut missing = MissingCoverage {
        landblocks: Vec::new(),
        outside_world: false,
    };
    for sphere in [Some(spheres.primary()), spheres.upper_constraint()]
        .into_iter()
        .flatten()
    {
        let center = pose.coords + pose.rotation.rotate_vector(sphere.center);
        if let CollisionQuery::MissingCoverage(current) = scene.coverage(CoverageRequest {
            anchor,
            start: center,
            end: center,
            radius: sphere.radius,
        })? {
            merge_missing(&mut missing, current);
        }
    }
    Ok((missing.outside_world || !missing.landblocks.is_empty()).then_some(missing))
}

/// Resolves initial response placement from one caller-provided portal-history seed.
///
/// Registration adapters use this only when collision coverage is available. Already registered
/// dormant bodies retain their resolved response cell and use `evaluate_physical_body_activity`
/// instead, so restoration can never silently relabel them.
pub fn resolve_physical_body_cell(
    scene: &CollisionScene,
    pose: WorldPosition,
    definition: PhysicalBodyDefinition,
    seed_cell: Option<Guid>,
) -> Result<CollisionQuery<Option<Guid>>, CollisionQueryError> {
    let primary = definition.spheres().primary();
    let anchor = Guid((pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let center = pose.coords + pose.rotation.rotate_vector(primary.center);
    Ok(
        match scene.transit_cell(CellTransitRequest {
            previous_cell: seed_cell,
            anchor,
            center,
            radius: primary.radius,
        })? {
            CollisionQuery::Complete(placement) => {
                CollisionQuery::Complete(placement.committed_cell())
            }
            CollisionQuery::MissingCoverage(missing) => CollisionQuery::MissingCoverage(missing),
        },
    )
}

fn merge_missing(merged: &mut MissingCoverage, current: MissingCoverage) {
    merged.outside_world |= current.outside_world;
    for owner in current.landblocks {
        if !merged.landblocks.contains(&owner) {
            merged.landblocks.push(owner);
        }
    }
    merged.landblocks.sort_unstable();
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
    use crate::{EdgeProtection, GroundedConfig, PhysicalFlyConfig, RETAIL_WALKABLE_NORMAL_Z};

    const FLY_CONFIG: PhysicalFlyConfig = PhysicalFlyConfig {
        maximum_substep_distance: 0.25,
        maximum_substeps: 8,
        maximum_contact_passes: 4,
        separation_epsilon: 0.001,
    };
    const GROUNDED_CONFIG: GroundedConfig = GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
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
