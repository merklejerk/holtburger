//! Validated physical-body geometry and response definitions shared by every body source.

use super::body_movement::ResolvedAuthoredMotion;
use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::position::outdoor_landblock_owner_at;
use holtburger_common::properties::PhysicsState;
use holtburger_common::{Guid, Quaternion, RigidTransform, Sphere, Vector3};
use thiserror::Error;

use crate::{EffectiveEntityPhysicsState, LocalIntegrationDemand, LocalPhysicalDemand};

use super::{
    CellTransitRequest, CollisionQueryError, CollisionReportOutcome, CollisionScene, ContactState,
    DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyDefinition, FreeSphereConfig, GroundState, GroundedBodySpheres,
    GroundedConfig, GroundedSphere, MotionWaypoint, PlacedMotionPath, PlacedMotionPathRequest,
    SpatialBody, SpatialMembership,
};

/// Retail's canonical velocity floor (`PhysicsGlobals.SmallVelocity`) squared.
const RETAIL_SMALL_VELOCITY_SQUARED: f32 = 0.25 * 0.25;
/// Retail's tolerance for the squared-speed floor and outward contact velocity.
pub(super) const RETAIL_PHYSICS_EPSILON: f32 = 0.000_2;

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
    /// Runtime whole-object scale must remain finite and positive.
    #[error("physical-body object scale must be finite and positive")]
    InvalidObjectScale,
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
    /// Stable characters actively stop when no authored/controller travel is supplied.
    /// RETAIL DIVERGENCE: retail composes authored travel separately from physical velocity
    /// (acclient.c:308262-308298,306094-306172). We intentionally stop external horizontal
    /// velocity too; restoring passive drag here restores idle character sliding because
    /// our motor retains one actual velocity. The synthetic local/remote, character/passive,
    /// three-speed matrix covers this policy; the earlier 43,913-template classification census
    /// sized the character/obstacle roles, not every possible externally driven trajectory.
    /// Passive bodies and sledding retain coast drag; launch/airborne admission remain separate.
    fn resolved_supported_motion(&self, physical: &PhysicalBodyState) -> GroundedSupportedMotion {
        if matches!(self.supported_motion, GroundedSupportedMotion::Coasting)
            && physical.has_direct_character_drive()
        {
            GroundedSupportedMotion::Driven(Vector3::zero())
        } else {
            self.supported_motion
        }
    }

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

    /// Resolves supported drive versus ballistic gravity for one contact tick.
    /// The collection supplies launch only once; heading accompanies linear input for angular admission.
    /// Positional authority return is supplied separately through the bounded contact motor.
    pub fn contact_step_input(
        &self,
        ground: GroundState,
        config: GroundedConfig,
        policy: PhysicalBodyResponsePolicy,
    ) -> Result<super::ContactStepActuation> {
        let supported = ground.walkable_support();
        let input = if let (Some(_), Some(launch)) = (supported, self.launch) {
            super::ContactStepActuation::launching(Vector3::new(0.0, 0.0, config.gravity), launch)?
        } else {
            let acceleration = grounded_acceleration(ground, config, policy);
            match (supported, self.supported_motion) {
                (Some(support), GroundedSupportedMotion::Driven(target)) => {
                    super::ContactStepActuation::driven(acceleration, target, support.normal)
                }
                _ => super::ContactStepActuation::ballistic(acceleration),
            }?
        };
        match self.control_heading {
            Some(heading) => input.with_control_heading(heading),
            None => Ok(input),
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
    /// Authored placement for a body without force-driven translation.
    FixedPosition {
        /// Explicit authored root displacement in world axes; never retained as velocity.
        translation: Vector3,
        /// Absolute authored world orientation before retained angular velocity is applied.
        rotation: Quaternion,
    },
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

    /// Resolves one interval of sampled mobile input against the current physical frame/support.
    /// Authored travel is already scaled, gated, and subdivided by the collection. Its local
    /// frame is independent of the nominal reference frame used by reference prediction.
    /// Free physical velocity must be seeded once before the collection, never replaced here:
    /// subsequent ticks continue the body's accepted contact response.
    pub fn contact_step_input(
        &self,
        physical: &PhysicalBodyState,
        rotation: Quaternion,
        acceleration: Vector3,
        ground: GroundState,
        authored: Option<RigidTransform>,
        delta_seconds: f32,
    ) -> Result<super::ContactStepActuation> {
        ensure!(
            delta_seconds.is_finite() && delta_seconds > 0.0,
            "contact input duration must be finite and positive"
        );
        let authored =
            authored.map(|offset| ResolvedAuthoredMotion::project(offset, rotation, delta_seconds));
        self.contact_step_from_authored(physical, acceleration, ground, authored)
    }

    /// Consumes the movement owner's projected source instead of rebuilding its world frame.
    pub(super) fn contact_step_from_authored(
        &self,
        physical: &PhysicalBodyState,
        acceleration: Vector3,
        ground: GroundState,
        authored: Option<ResolvedAuthoredMotion>,
    ) -> Result<super::ContactStepActuation> {
        let heading = authored.map(|motion| motion.heading);
        match (physical.definition, self) {
            (
                PhysicalBodyDefinition::FreeSphere { .. },
                Self::FreeFlight {
                    kinematic_velocity, ..
                },
            ) => {
                let travel = authored.map_or(*kinematic_velocity, |motion| motion.velocity);
                let input = super::ContactStepActuation::free_flight(acceleration, travel)?;
                match heading {
                    Some(heading) => input.with_control_heading(heading),
                    None => Ok(input),
                }
            }
            (PhysicalBodyDefinition::Grounded { config, .. }, Self::Grounded(sampled)) => {
                let mut input = sampled.clone();
                input.supported_motion = sampled.resolved_supported_motion(physical);
                if let Some(motion) = authored {
                    let travel = motion.velocity;
                    input.supported_motion =
                        GroundedSupportedMotion::Driven(Vector3::new(travel.x, travel.y, 0.0));
                    input.control_heading = heading;
                }
                let actuation =
                    input.contact_step_input(ground, config, physical.response_policy)?;
                if physical.has_direct_character_drive() {
                    Ok(actuation.with_direct_character_drive())
                } else {
                    Ok(actuation)
                }
            }
            (PhysicalBodyDefinition::FixedPosition { .. }, _) => {
                anyhow::bail!("fixed position requires placement instead of contact actuation")
            }
            _ => anyhow::bail!("contact actuation does not match the physical definition"),
        }
    }

    /// Whether this tick input contains no controller, launch, or flight work.
    pub(crate) fn permits_dynamic_settling(&self) -> bool {
        match self {
            Self::FixedPosition { translation, .. } => *translation == Vector3::zero(),
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
    /// Cell memory for responses without ground support (fixed position or free flight).
    Placement {
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
    /// Response-owned support; placement-only bodies have no grounded support.
    pub const fn ground(&self) -> GroundState {
        match self {
            Self::Grounded { ground, .. } => *ground,
            Self::Placement { .. } => GroundState::Airborne,
        }
    }

    /// Current response-selected interior cell, or `None` while outdoors.
    pub const fn cell(&self) -> Option<Guid> {
        match self {
            Self::Placement { cell } | Self::Grounded { cell, .. } => *cell,
        }
    }
}

/// Solver-owned integration activity for a physically participating dynamic body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DynamicBodyActivity {
    /// The collection participant must attempt this body's next eligible solve.
    Active,
    /// A completed tick proved no retained, authored, reconciliation, contact, or response work.
    /// Gravity-bearing grounded bodies additionally retain stable support for the next step to validate.
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
    /// Unit-scale movement definition retained across scale ramps.
    pub(crate) unit_movement: PhysicalBodyDefinition,
    /// Current absolute whole-object scale shared by movement and target geometry.
    pub(crate) object_scale: f32,
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
    /// Stable characters follow commanded tangent speed; passive bodies and sledding keep motors.
    pub(super) fn has_direct_character_drive(&self) -> bool {
        self.response_policy.surface_motion == PhysicalSurfaceMotion::Stable
            && self.dynamic.as_ref().is_some_and(|dynamic| {
                matches!(
                    dynamic.collision.contact_response,
                    super::EntityContactResponse::Character(_)
                )
            })
    }

    /// Whether the solver has settled this entity; movement-only bodies never enter that lifecycle.
    pub fn is_settled(&self) -> bool {
        self.dynamic
            .as_ref()
            .is_some_and(|dynamic| dynamic.activity == DynamicBodyActivity::Settled)
    }

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
        let (definition, demand, object_scale) = configuration.into_parts();
        let DynamicPhysicalBodyDefinition {
            movement,
            response_policy,
            entity_collision,
        } = definition;
        let scaled_movement = movement
            .uniformly_scaled(object_scale)
            .expect("dynamic configuration validated its object scale");
        let mut state = Self::new(scaled_movement, collision_filter, response_policy, cell);
        state.dynamic = Some(DynamicBodyRuntimeState {
            unit_movement: movement,
            object_scale,
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

    /// Discards contact and reached-cell memory after an authoritative placement replacement,
    /// including moves between two outdoor points in the same landblock.
    pub(crate) fn reset_placement(&mut self, cell: Option<Guid>) {
        self.response = initial_response(self.definition, cell);
        if let Some(dynamic) = self.dynamic.as_mut() {
            dynamic.placement =
                cell.map_or_else(SpatialMembership::outdoor, SpatialMembership::interior);
            dynamic.wake();
        }
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
        let dynamic = self.dynamic.as_ref()?;
        let movement = match dynamic.unit_movement {
            PhysicalBodyDefinition::FixedPosition { .. }
            | PhysicalBodyDefinition::FreeSphere { .. } => dynamic.unit_movement,
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
        entity_collision.contact_response = entity_collision.contact_response.with_physics(state);
        entity_collision.dynamic_collision = state.dynamic_collision;
        entity_collision.reporting = state.reporting;
        entity_collision.uses_physics_bsp = state.uses_physics_bsp;
        Some(
            DynamicPhysicalBodyConfiguration::with_object_scale(
                DynamicPhysicalBodyDefinition {
                    movement,
                    response_policy,
                    entity_collision,
                },
                demand,
                dynamic.object_scale,
            )
            .expect("non-empty retained demand must produce a physical configuration"),
        )
    }
}

pub(crate) fn initial_response(
    definition: PhysicalBodyDefinition,
    cell: Option<Guid>,
) -> PhysicalBodyResponseState {
    match definition {
        PhysicalBodyDefinition::FixedPosition { .. }
        | PhysicalBodyDefinition::FreeSphere { .. } => {
            PhysicalBodyResponseState::Placement { cell }
        }
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
    /// No authored movement spheres: ordinary physics preserves position while rotation and
    /// peer-target collision remain active (`CPhysicsObj::UpdateObjectInternal`, acclient.c:310930-310949).
    FixedPosition {
        /// Unscaled retail dummy sphere used only for placement and explicit transitions.
        placement_sphere: GroundedSphere,
    },
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
    /// Retains placement geometry without turning a missing movement sphere into simulated motion.
    pub fn fixed_position(spheres: PhysicalSphereSet) -> Result<Self, PhysicalBodyDefinitionError> {
        Ok(Self::FixedPosition {
            placement_sphere: spheres.require_single()?,
        })
    }

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
            Self::FixedPosition {
                placement_sphere: sphere,
            }
            | Self::FreeSphere { sphere, .. } => PhysicalSphereSet {
                primary: sphere,
                upper_constraint: None,
            },
            Self::Grounded { spheres, .. } => PhysicalSphereSet {
                primary: spheres.support,
                upper_constraint: spheres.upper,
            },
        }
    }

    /// Applies one absolute uniform root scale to an immutable unit movement definition.
    pub(crate) fn uniformly_scaled(self, scale: f32) -> Result<Self, PhysicalBodyDefinitionError> {
        if !scale.is_finite() || scale <= 0.0 {
            return Err(PhysicalBodyDefinitionError::InvalidObjectScale);
        }
        let scaled = |sphere: GroundedSphere| Sphere {
            center: sphere.center * scale,
            radius: sphere.radius * scale,
        };
        let spheres = self.spheres();
        let scaled_spheres = || {
            PhysicalSphereSet::new(
                scaled(spheres.primary()),
                spheres.upper_constraint().map(scaled),
            )
        };
        match self {
            Self::FixedPosition { .. } => Ok(self),
            Self::FreeSphere { config, .. } => Self::free_sphere(scaled_spheres()?, config),
            Self::Grounded { config, .. } => Self::grounded(scaled_spheres()?, config),
        }
    }
}

/// One source-neutral placed body-reference path produced by the generic simulator.
#[derive(Debug, Clone, PartialEq)]
pub struct PhysicalBodyMotion {
    /// Body-reference geometry paired with support-sphere placement transitions.
    pub path: PlacedMotionPath,
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
    /// Named effective-state consequence committed with a confirmed dynamic-body impact.
    pub dynamic_state_change: Option<DynamicBodyPhysicsStateChange>,
    /// First-touch report edges committed by this body transaction; refreshes remain silent.
    pub collision_reports: Vec<CollisionReportOutcome>,
    /// Strongest accepted static-environment contact normal for this tick, if any.
    pub static_contact_normal: Option<Vector3>,
}

/// Source-neutral collision mutation applied to effective state without rewriting server authority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DynamicBodyPhysicsStateChange {
    /// Physics-state bits cleared by the accepted collision consequence.
    pub cleared: PhysicsState,
}

impl DynamicBodyPhysicsStateChange {
    /// Existing accepted-impact retirement shared by physical and entity-state publication.
    pub(crate) fn projectile_impact() -> Self {
        Self {
            cleared: PhysicsState::MISSILE | PhysicsState::ALIGN_PATH | PhysicsState::PATH_CLIPPED,
        }
    }
}

#[derive(Debug, Clone)]
/// Complete tentative body state committed only after every query succeeds.
pub(super) struct PhysicalBodyTickCommit {
    /// Accepted body-reference pose.
    pub pose: WorldPosition,
    /// Physical linear momentum retained for the next integration tick.
    pub retained_velocity: Vector3,
    /// Response-owned acceleration: grounded gravity is derived from the committed contact.
    pub retained_acceleration: Vector3,
    /// Observed derivative of the complete path accepted during this tick.
    pub accepted_motion: super::AcceptedBodyMotion,
    /// Coarse support state derived by the selected response.
    pub contact: ContactState,
    /// Response-only state matching the physical definition variant.
    pub response: PhysicalBodyResponseState,
    /// Placed motion returned to the caller.
    pub motion: PhysicalBodyMotion,
    /// Strongest accepted static-environment contact normal for this tick, if any.
    pub static_contact_normal: Option<Vector3>,
    /// Effective-state consequence observed by the common step before projectile retirement.
    pub dynamic_state_change: Option<DynamicBodyPhysicsStateChange>,
}

/// Solves one registered body without mutating the canonical store until every query completes.
pub(super) fn solve_physical_body_tick(
    scene: &CollisionScene,
    body: &SpatialBody,
    actuation: &PhysicalBodyActuation,
    delta_seconds: f32,
    input_for: impl FnMut(&SpatialBody, GroundState, f32) -> Result<super::ContactStepActuation>,
) -> Result<PhysicalBodyTickCommit> {
    ensure!(
        delta_seconds.is_finite() && delta_seconds > 0.0,
        "physical-body tick interval must be finite and positive"
    );
    let physical = body
        .physical
        .as_ref()
        .context("spatial body has no physical definition")?;
    if let PhysicalBodyDefinition::FixedPosition { placement_sphere } = physical.definition {
        return solve_fixed_position_tick(
            scene,
            body,
            physical,
            actuation,
            delta_seconds,
            placement_sphere,
        );
    }
    let mut moving = body.clone();
    if let Some(dynamic) = moving
        .physical
        .as_mut()
        .and_then(|state| state.dynamic.as_mut())
    {
        dynamic.activity = super::DynamicBodyActivity::Active;
        dynamic.demand.integration = LocalIntegrationDemand::Eligible;
    }
    let mut collection = super::mobile_contact::advance_body_contact_collection_without_reports(
        scene,
        &[moving],
        Guid(body.pose.landblock_id.0 | 0xffff),
        delta_seconds,
        input_for,
    )?;
    ensure!(
        collection.bodies.len() == 1,
        "single-body solve must produce one result"
    );
    let update = collection
        .bodies
        .pop()
        .context("single-body solve lost its result")?;
    if let Some(owner) = update.unavailable_owner {
        // Direct probes are atomic transactions. Their caller can load missing coverage and
        // retry; unlike a crowd collection, they do not publish a partial-coverage result.
        return Err(CollisionQueryError::UnavailableOwner { owner: owner.0 }.into());
    }
    let mut current = body.clone();
    update.apply_physical_state(&mut current)?;
    let path = PlacedMotionPath::from_contact_motion(body, &current, &update.motion)?;
    let static_contact_normal = update
        .motion
        .iter()
        .filter_map(|segment| match segment {
            super::ContactMotionSegment::Impact {
                hit: super::HardSphereSweepHit::World(hit),
                ..
            } => Some(hit.normal),
            _ => None,
        })
        .max_by(|a, b| a.z.total_cmp(&b.z))
        .or_else(|| update.ground.contact_plane().map(|support| support.normal));
    let response = current
        .physical
        .as_ref()
        .context("solved body lost physics")?
        .response;
    Ok(PhysicalBodyTickCommit {
        pose: current.pose,
        retained_velocity: current.retained.velocity,
        retained_acceleration: current.retained.acceleration,
        accepted_motion: current.accepted_motion,
        contact: current.contact,
        response,
        motion: PhysicalBodyMotion { path },
        static_contact_normal,
        dynamic_state_change: update
            .projectile_impact
            .map(|_| DynamicBodyPhysicsStateChange::projectile_impact()),
    })
}

/// Applies explicit authored placement without entering the force/contact-response solver.
fn solve_fixed_position_tick(
    scene: &CollisionScene,
    body: &SpatialBody,
    physical: &PhysicalBodyState,
    actuation: &PhysicalBodyActuation,
    delta_seconds: f32,
    placement_sphere: GroundedSphere,
) -> Result<PhysicalBodyTickCommit> {
    let PhysicalBodyResponseState::Placement { cell } = &physical.response else {
        anyhow::bail!("fixed-position body requires placement response");
    };
    let PhysicalBodyActuation::FixedPosition {
        translation,
        rotation,
    } = actuation
    else {
        anyhow::bail!("fixed-position body requires authored placement actuation")
    };
    let mut pose = body.pose;
    pose.coords = pose.coords + *translation;
    pose.rotation =
        super::scene::integrate_angular_velocity(*rotation, body.retained.omega, delta_seconds);
    let offset = body.pose.rotation.rotate_vector(placement_sphere.center);
    let center = body.pose.coords + offset;
    let path = scene
        .transit_motion_path(PlacedMotionPathRequest {
            previous_cell: *cell,
            anchor: Guid(body.pose.landblock_id.0 | 0xffff),
            start: center,
            radius: placement_sphere.radius,
            waypoints: &[MotionWaypoint {
                center: center + *translation,
                end_fraction: 1.0,
                placement: super::MotionWaypointPlacement::Traverse,
            }],
        })?
        .translated(offset * -1.0);
    let cell = path.final_point().placement().committed_cell();
    pose = place_body_pose(pose, cell)?;
    Ok(PhysicalBodyTickCommit {
        pose,
        retained_velocity: Vector3::zero(),
        retained_acceleration: Vector3::zero(),
        accepted_motion: accepted_motion(body.pose, pose, Vector3::zero(), delta_seconds),
        contact: body.contact,
        response: PhysicalBodyResponseState::Placement { cell },
        motion: PhysicalBodyMotion { path },
        static_contact_normal: None,
        dynamic_state_change: None,
    })
}

/// Collision-free continuation of independent authority and ordinary authored input.
pub(super) struct PredictedReferenceMotion {
    /// Nominal continuation compared with actual velocity when deciding return completion.
    pub continuation_velocity: Vector3,
    /// Ordinary reference travel, excluding contact correction.
    pub displacement: Vector3,
    /// Free-flight reference orientation after ordinary motion; grounded facing belongs to the body.
    pub flight_rotation: Option<Quaternion>,
}

/// Advances an independent ordinary reference without collision response.
pub(super) fn predict_reference_motion(
    body: &super::SpatialBody,
    actuation: &PhysicalBodyActuation,
    delta_seconds: f32,
    nominal: super::AuthoritativeBodyVectors,
    authored: Option<ResolvedAuthoredMotion>,
    reference: WorldPosition,
    ground: GroundState,
) -> Result<PredictedReferenceMotion> {
    let physical = body
        .physical
        .as_ref()
        .context("reference prediction requires body physics")?;
    let (velocity, displacement, flight_rotation) = match (physical.definition, actuation) {
        (
            PhysicalBodyDefinition::FreeSphere { .. },
            PhysicalBodyActuation::FreeFlight {
                kinematic_velocity, ..
            },
        ) => {
            let velocity = nominal.velocity + nominal.acceleration * delta_seconds;
            let travel = authored.map_or(*kinematic_velocity * delta_seconds, |motion| {
                reference
                    .rotation
                    .rotate_vector(motion.source_offset.translation)
            });
            let displacement = velocity * delta_seconds + travel;
            let heading = authored.map(|motion| {
                reference
                    .rotation
                    .multiply(&motion.source_offset.rotation)
                    .to_heading()
            });
            let rotation = resolve_body_facing(
                reference.rotation,
                displacement,
                velocity,
                physical.response_policy,
                heading,
            );
            let rotation =
                super::scene::integrate_angular_velocity(rotation, nominal.omega, delta_seconds);
            (velocity, displacement, Some(rotation))
        }
        (
            PhysicalBodyDefinition::Grounded { config, .. },
            PhysicalBodyActuation::Grounded(input),
        ) => {
            let ground = if physical
                .dynamic
                .as_ref()
                .is_some_and(|dynamic| dynamic.collision.dynamic_collision.missile)
            {
                GroundState::Airborne
            } else {
                ground
            };
            let support = ground.walkable_support();
            // A nominal command is the requested travel, not another acceleration-limited
            // physical motor starting again from the last packet's velocity every tick.
            let mut velocity = match (
                support,
                input.launch,
                authored,
                input.resolved_supported_motion(physical),
            ) {
                (Some(_), Some(launch), _, _) => launch.velocity(),
                (Some(_), None, Some(motion), _) => {
                    let travel = motion.velocity;
                    Vector3::new(travel.x, travel.y, 0.0)
                }
                (Some(_), None, None, GroundedSupportedMotion::Driven(target)) => target,
                (Some(support), None, None, GroundedSupportedMotion::Coasting) => surface_friction(
                    canonical_retained_velocity(nominal.velocity),
                    support.normal,
                    physical.response_policy.friction,
                    delta_seconds,
                    physical.response_policy.surface_motion,
                ),
                (None, _, _, _) => nominal.velocity,
            };
            if support.is_none()
                || input.launch.is_some()
                || physical_surface_retains_gravity(physical.response_policy.surface_motion)
            {
                velocity.z += config.gravity * delta_seconds;
            }
            // Actual supported travel is tangent to this same prepared plane. Leaving nominal
            // drive horizontal makes the reference outrun the body and invent correction on slopes.
            // Launch explicitly leaves support and must retain its outward velocity.
            if input.launch.is_none()
                && let Some(support) = support
            {
                velocity = velocity - support.normal * velocity.dot(&support.normal);
            }
            // Pursuit commands are chosen in the actual body's frame. Grounded reference
            // position follows that intent; it must not simulate another character's facing.
            (velocity, velocity * delta_seconds, None)
        }
        (PhysicalBodyDefinition::FixedPosition { .. }, _) => {
            anyhow::bail!("fixed body cannot predict a mobile correction reference")
        }
        _ => anyhow::bail!("reference actuation does not match the physical definition"),
    };
    validate_finite_velocity(displacement)?;
    Ok(PredictedReferenceMotion {
        continuation_velocity: velocity,
        displacement,
        flight_rotation,
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

pub(super) fn canonical_retained_velocity(velocity: Vector3) -> Vector3 {
    if velocity.length_squared() - RETAIL_SMALL_VELOCITY_SQUARED < RETAIL_PHYSICS_EPSILON {
        Vector3::zero()
    } else {
        velocity
    }
}

/// Response-owned acceleration at the accepted support, shared by input and publication.
pub(super) fn grounded_acceleration(
    ground: GroundState,
    config: GroundedConfig,
    policy: PhysicalBodyResponsePolicy,
) -> Vector3 {
    if ground.walkable_support().is_some() && policy.surface_motion == PhysicalSurfaceMotion::Stable
    {
        Vector3::zero()
    } else {
        Vector3::new(0.0, 0.0, config.gravity)
    }
}

const SLEDDING_STOP_SPEED_SQUARED: f32 = 1.5625;
const SLEDDING_FAST_SPEED_SQUARED: f32 = 6.25;
const SLEDDING_SLOPE_NORMAL_Z: f32 = 0.984_807_7;
const SLEDDING_SLOPE_FRICTION: f32 = 0.2;

fn physical_surface_retains_gravity(surface_motion: PhysicalSurfaceMotion) -> bool {
    surface_motion == PhysicalSurfaceMotion::Sledding
}

/// Shared authored impact response for ordinary and one-way projectile contacts.
pub(super) fn impact_velocity(
    incoming: Vector3,
    normal: Vector3,
    restitution: PhysicalRestitution,
) -> Vector3 {
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
}

pub(super) fn surface_friction(
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

/// Resolves authored alignment and controller heading after accepted movement.
pub(super) fn resolve_body_facing(
    current: Quaternion,
    displacement: Vector3,
    velocity: Vector3,
    policy: PhysicalBodyResponsePolicy,
    control_heading: Option<f32>,
) -> Quaternion {
    let heading = if policy.align_path && displacement.length_squared() > f32::EPSILON {
        Some(Vector3::zero().heading_to(&displacement))
    } else if policy.surface_motion == PhysicalSurfaceMotion::Sledding
        && velocity.length_squared() > f32::EPSILON
    {
        Some(Vector3::zero().heading_to(&velocity))
    } else {
        control_heading
    };
    heading.map_or(current, Quaternion::from_heading)
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

/// Re-expresses a root pose in its accepted cell without changing the world-space point.
pub(crate) fn place_body_pose(
    mut pose: WorldPosition,
    cell: Option<Guid>,
) -> Result<WorldPosition> {
    let owner = Guid((cell.unwrap_or(pose.landblock_id).0 & 0xffff_0000) | 0xffff);
    pose = pose.reanchor_to_landblock_owner(owner)?;
    if let Some(cell) = cell {
        pose.landblock_id = cell;
    } else {
        pose = pose.normalize_outdoor_landblock_frame()?;
    }
    Ok(pose)
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
            |body, ground, interval| {
                PhysicalBodyActuation::free_flight(Vector3::zero())
                    .unwrap()
                    .contact_step_input(
                        body.physical.as_ref().ok_or_else(|| {
                            anyhow::anyhow!("contact input requires body physics")
                        })?,
                        body.pose.rotation,
                        body.retained.acceleration,
                        ground,
                        None,
                        interval,
                    )
            },
        )
        .expect("a free sphere in an empty scene solves");

        let expected = super::super::scene::integrate_angular_velocity(
            Quaternion::identity(),
            body.retained.omega,
            super::super::MOBILE_CONTACT_TICK_SECONDS,
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
        pose.rotation = resolve_body_facing(
            pose.rotation,
            Vector3::new(0.0, 2.0, 0.0),
            Vector3::new(-2.0, 0.0, 0.0),
            policy,
            Some(-0.5),
        );
        assert!((pose.rotation.to_heading() - 90.0_f32.to_radians()).abs() < 0.000_01);

        policy.align_path = false;
        pose.rotation = resolve_body_facing(
            pose.rotation,
            Vector3::zero(),
            Vector3::new(-2.0, 0.0, 0.0),
            policy,
            Some(-0.5),
        );
        assert!(pose.rotation.to_heading().abs() < 0.000_01);

        policy.surface_motion = PhysicalSurfaceMotion::Stable;
        pose.rotation = resolve_body_facing(
            pose.rotation,
            Vector3::zero(),
            Vector3::new(-2.0, 0.0, 0.0),
            policy,
            Some(-0.5),
        );
        assert_eq!(pose.rotation, Quaternion::from_heading(-0.5));
    }
}
