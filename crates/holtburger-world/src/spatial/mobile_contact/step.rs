//! Bounded hard movement and fixed-pass mobile contacts over one tick's working poses.

mod targets;
use targets::HardTargets;

mod collection;
pub(crate) use collection::advance_body_contact_collection_without_reports;
mod report;
pub use collection::{ContactCollectionUpdate, advance_body_contact_collection};

mod admission;
mod angular;
pub use angular::MOBILE_CONTACT_ANGULAR_CHORDS;
mod recovery;
mod stairs;
pub(crate) use recovery::{checked_recovery_destination, has_player_contact};

use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Sphere, Vector3};
use holtburger_content::PlacedCollisionShape;

use super::*;
use crate::spatial::{
    CollisionQueryError, CollisionScene, GroundState, GroundedLaunch, GroundedSphere,
    HardEntityShape, HardSphereSweep, HardSphereSweepHit, PlacedMotionPath,
    StaticSphereSweepRequest, dynamic_index::placed_target_shapes, physical_body::impact_velocity,
};

/// Maximum stop/slide continuations for ordinary travel in one physical tick.
pub const MOBILE_CONTACT_HARD_SLIDE_PASSES: usize = 3;

/// Force and velocity input for one admitted physical tick.
#[derive(Debug, Clone, Copy)]
pub struct ContactStepActuation {
    /// Response-owned acceleration after support has suppressed or projected gravity.
    acceleration: Vector3,
    /// Mutually exclusive continuation, supported motor, or one-shot launch.
    motion: ContactStepMotion,
    /// Optional controller heading, below authored body-facing overrides.
    control_heading: Option<f32>,
}

/// Velocity operation preceding this tick's acceleration.
#[derive(Debug, Clone, Copy)]
enum ContactStepMotion {
    /// Continue retained velocity without a surface motor.
    Ballistic,
    /// Continue physical flight while sweeping a separate, non-retained authored contribution.
    FreeFlight {
        /// World-space authored travel rate for this interval; hard contacts may clip it.
        kinematic_velocity: Vector3,
    },
    /// Recover toward a controller target tangent to current support.
    Driven {
        /// Desired velocity, never an additive displacement guarantee.
        target: Vector3,
        /// Unit support normal preserving independent normal velocity.
        normal: Vector3,
        /// Prepared response: stable characters track commands directly; passive motors ramp.
        response: SupportedDriveResponse,
    },
    /// Replace velocity and leave proved support before force integration.
    Launch(GroundedLaunch),
}

/// Transient supported-drive policy; contacts still modify either result after integration.
#[derive(Debug, Clone, Copy)]
enum SupportedDriveResponse {
    /// Existing rate-limited response for passive bodies and sledding.
    Accelerated,
    /// Stable character locomotion already contains authored speed/timing.
    Direct,
}

impl ContactStepActuation {
    /// Integrates response-owned acceleration without a controller motor.
    pub fn ballistic(acceleration: Vector3) -> Result<Self> {
        ensure!(
            finite_vector(acceleration),
            "contact acceleration must be finite"
        );
        Ok(Self {
            acceleration,
            motion: ContactStepMotion::Ballistic,
            control_heading: None,
        })
    }

    /// Sweeps authored flight travel without adding it to physical continuation velocity.
    /// The collection seeds physical velocity once; subsequent intervals retain contact response.
    pub fn free_flight(acceleration: Vector3, kinematic_velocity: Vector3) -> Result<Self> {
        ensure!(
            finite_vector(kinematic_velocity),
            "contact flight kinematic velocity must be finite"
        );
        let mut input = Self::ballistic(acceleration)?;
        input.motion = ContactStepMotion::FreeFlight { kinematic_velocity };
        Ok(input)
    }

    /// Adds bounded motor recovery tangent to a proved support plane.
    /// The caller owns support eligibility, including disabling ordinary air steering.
    pub fn driven(acceleration: Vector3, target: Vector3, normal: Vector3) -> Result<Self> {
        let mut input = Self::ballistic(acceleration)?;
        ensure!(finite_vector(target), "contact motor target must be finite");
        ensure!(
            finite_vector(normal) && (normal.length_squared() - 1.0).abs() <= 0.0001,
            "contact motor requires a unit support normal"
        );
        input.motion = ContactStepMotion::Driven {
            target,
            normal,
            response: SupportedDriveResponse::Accelerated,
        };
        Ok(input)
    }

    /// Installs the movement owner's resolved supported velocity while preserving drive response
    /// and facing. The caller must have admitted support and excluded a one-shot launch.
    pub(crate) fn with_supported_drive(self, target: Vector3, normal: Vector3) -> Result<Self> {
        let mut input = Self::driven(self.acceleration, target, normal)?;
        if let (
            ContactStepMotion::Driven { response, .. },
            ContactStepMotion::Driven {
                response: prepared, ..
            },
        ) = (self.motion, &mut input.motion)
        {
            *prepared = response;
        }
        input.control_heading = self.control_heading;
        Ok(input)
    }

    /// Adds movement-owner travel without changing physical continuation. Free flight sweeps
    /// this contribution alongside retained velocity, but does not store it as momentum.
    pub(crate) fn with_free_travel_bias(mut self, bias: Vector3) -> Result<Self> {
        ensure!(finite_vector(bias), "flight travel bias must be finite");
        let ContactStepMotion::FreeFlight { kinematic_velocity } = &mut self.motion else {
            anyhow::bail!("flight travel bias requires free-flight actuation");
        };
        *kinematic_velocity = *kinematic_velocity + bias;
        Ok(self)
    }

    /// Applies the local player's existing confirmed-travel budget to interval command travel.
    /// Retained ballistic velocity and one-shot launches are outside that budget.
    /// Uses this tick's proved support, which may differ from the last published contact.
    pub(crate) fn with_confirmation(
        mut self,
        state: &mut crate::spatial::PoseReconciliationState,
        pose: WorldPosition,
        ground: GroundState,
        delta_seconds: f32,
    ) -> Self {
        let velocity = match self.motion {
            ContactStepMotion::Driven { target, .. } => target,
            ContactStepMotion::FreeFlight { kinematic_velocity } => kinematic_velocity,
            ContactStepMotion::Ballistic | ContactStepMotion::Launch(_) => Vector3::zero(),
        };
        let composition = state.compose_translation(
            pose,
            match ground {
                GroundState::Supported(_) => crate::spatial::ContactState::Grounded,
                GroundState::Sliding(_) => crate::spatial::ContactState::Sliding,
                GroundState::Airborne => crate::spatial::ContactState::Airborne,
            },
            velocity * delta_seconds,
            delta_seconds,
        );
        match &mut self.motion {
            ContactStepMotion::Driven { target, .. } => {
                *target = composition.translation / delta_seconds
            }
            ContactStepMotion::FreeFlight { kinematic_velocity } => {
                *kinematic_velocity = composition.translation / delta_seconds;
            }
            ContactStepMotion::Ballistic | ContactStepMotion::Launch(_) => {}
        }
        self
    }

    /// Selects direct character drive after physical preparation has proved its role and surface.
    /// Launches and airborne continuation have no supported drive to change.
    pub(crate) fn with_direct_character_drive(mut self) -> Self {
        if let ContactStepMotion::Driven { response, .. } = &mut self.motion {
            *response = SupportedDriveResponse::Direct;
        }
        self
    }

    /// Supplies a resolved launch; the step requires current walkable support.
    pub(crate) fn launching(acceleration: Vector3, launch: GroundedLaunch) -> Result<Self> {
        let mut input = Self::ballistic(acceleration)?;
        input.motion = ContactStepMotion::Launch(launch);
        Ok(input)
    }

    /// Supplies controller facing without altering linear actuation.
    pub fn with_control_heading(mut self, heading: f32) -> Result<Self> {
        ensure!(
            heading.is_finite(),
            "contact control heading must be finite"
        );
        self.control_heading = Some(heading);
        Ok(self)
    }

    /// Arithmetic-only actual velocity integration before contact response.
    /// This performs no collision, placement, or support query and never applies positional correction.
    pub(crate) fn predict_velocity(
        self,
        incoming: Vector3,
        ground: GroundState,
        policy: crate::spatial::PhysicalBodyResponsePolicy,
        delta_seconds: f32,
    ) -> Vector3 {
        let ground = if matches!(self.motion, ContactStepMotion::Launch(_)) {
            GroundState::Airborne
        } else {
            ground
        };
        let mut velocity = incoming;
        // The stable motor owns acceleration and braking. Coasting and sledding retain
        // authored drag; damping stable drive too would impose an unintended speed ceiling.
        if (matches!(self.motion, ContactStepMotion::Ballistic)
            || policy.surface_motion == crate::spatial::PhysicalSurfaceMotion::Sledding)
            && let Some(support) = ground.walkable_support()
        {
            // Coasting must reach canonical rest instead of decaying forever into tiny
            // floating-point motion. Apply the existing floor before forces, so gravity and
            // the driven motor can still start movement in this same tick.
            velocity = crate::spatial::physical_body::surface_friction(
                crate::spatial::physical_body::canonical_retained_velocity(velocity),
                support.normal,
                policy.friction,
                delta_seconds,
                policy.surface_motion,
            );
        }
        let velocity = self.integrate(velocity, delta_seconds);
        // Sustained support absorbs inward force instead of manufacturing a new impact
        // from standing gravity. Launch has already released support above.
        match ground.contact_plane() {
            Some(support) => velocity - support.normal * velocity.dot(&support.normal).min(0.0),
            None => velocity,
        }
    }

    fn integrate(self, velocity: Vector3, delta_seconds: f32) -> Vector3 {
        let velocity = match self.motion {
            ContactStepMotion::Ballistic | ContactStepMotion::FreeFlight { .. } => velocity,
            ContactStepMotion::Launch(launch) => launch.velocity(),
            ContactStepMotion::Driven {
                target,
                normal,
                response,
            } => {
                let difference = target - velocity;
                let tangent = difference - normal * difference.dot(&normal);
                velocity
                    + match response {
                        SupportedDriveResponse::Direct => tangent,
                        SupportedDriveResponse::Accelerated => {
                            motor_velocity_change(velocity, tangent, delta_seconds)
                        }
                    }
            }
        };
        velocity + self.acceleration * delta_seconds
    }
}

/// Follows the straight velocity change toward the target: brake until speed stops decreasing,
/// then spend the remaining time accelerating. Reversals cannot borrow the faster braking rate
/// to accelerate in the opposite direction, and neither phase can overshoot the target.
fn motor_velocity_change(velocity: Vector3, difference: Vector3, seconds: f32) -> Vector3 {
    let distance = difference.length();
    if distance == 0.0 {
        return Vector3::zero();
    }
    let direction = difference / distance;
    let braking_distance = (-velocity.dot(&direction)).clamp(0.0, distance);
    let braked = braking_distance.min(PASSIVE_MOTOR_BRAKING * seconds);
    let remaining_seconds = (seconds - braked / PASSIVE_MOTOR_BRAKING).max(0.0);
    let accelerated = (distance - braked).min(PASSIVE_MOTOR_ACCELERATION * remaining_seconds);
    direction * (braked + accelerated)
}

fn finite_vector(vector: Vector3) -> bool {
    vector.x.is_finite() && vector.y.is_finite() && vector.z.is_finite()
}

/// Synchronized movement-sphere proofs for one geometric body translation.
#[derive(Debug)]
pub struct ContactBodyPath {
    /// Primary path owns the body's committed cell and root translation.
    primary: PlacedMotionPath,
    /// Upper clearance sphere, retained so clipping cannot lose its collision domains.
    upper: Option<PlacedMotionPath>,
    /// Final domains occupied by either sphere, with primary committed-cell ownership.
    membership: SpatialMembership,
    /// Domains reached by either sphere anywhere on this accepted translation.
    reached: SpatialMembership,
}

impl ContactBodyPath {
    fn new(primary: PlacedMotionPath, upper: Option<PlacedMotionPath>) -> Self {
        let mut membership = primary.final_point().placement().clone();
        if let Some(upper) = &upper {
            membership = membership.merge_reached(upper.final_point().placement().clone());
        }
        let mut reached = primary.initial().placement().clone();
        for path in std::iter::once(&primary).chain(upper.iter()) {
            reached = reached.merge_reached(path.initial().placement().clone());
            for leg in path.legs() {
                reached = reached.merge_reached(leg.end().placement().clone());
            }
        }
        Self {
            primary,
            upper,
            membership,
            reached,
        }
    }

    /// Primary-sphere geometry supplies root motion and committed-cell ownership.
    pub fn primary(&self) -> &PlacedMotionPath {
        &self.primary
    }

    /// Final collision domains, including upper-only reaches.
    pub fn membership(&self) -> &SpatialMembership {
        &self.membership
    }

    /// Union of collision domains touched by both sphere traversals.
    pub fn reached_membership(&self) -> &SpatialMembership {
        &self.reached
    }
}

/// Attempted two-sphere translation and the earliest hard blocker from either sphere.
struct BodySweep {
    /// One shared blocking fraction for both sphere paths.
    hit: Option<HardSphereSweepHit>,
    /// Both attempted proofs, clipped together when applying an accepted prefix.
    path: ContactBodyPath,
}

/// Primary-sphere location at an accepted impact, before the remainder of the tick moves it.
#[derive(Debug, Clone, Copy)]
pub struct ContactImpactPoint {
    /// Common landblock frame in which the center was solved.
    pub anchor: Guid,
    /// Primary movement-sphere center, consumed by first-landing prediction.
    pub center: Vector3,
    /// Primary sphere's accepted interior ownership, or outdoors.
    pub committed_cell: Option<Guid>,
}

/// One ordered accepted segment, separating physical travel from geometric adjustment.
#[derive(Debug)]
pub enum ContactMotionSegment {
    /// A hard impact already resolved by movement, without additional travel.
    Impact {
        /// World or entity contact retained for reporting without another query.
        hit: HardSphereSweepHit,
        /// Accepted primary-sphere location, independent of later slide or bounce.
        point: ContactImpactPoint,
        /// Normalized physical instant at the accepted endpoint.
        fraction: f32,
    },
    /// Ordinary movement consuming an interval of the admitted physical tick.
    Travel {
        /// Placement proof for accepted travel.
        path: ContactBodyPath,
        /// Walkable support admitted for this travel; final support may differ after contacts.
        supported: bool,
        /// Normalized start of this physical interval.
        start_fraction: f32,
        /// Normalized end of this physical interval.
        end_fraction: f32,
    },
    /// Angular clearance evaluated at the ordinary endpoint, without root translation.
    Rotation {
        /// Both sphere-center chords; this geometry does not translate the body root.
        path: ContactBodyPath,
        /// Accepted body orientation at the chord endpoint.
        rotation: Quaternion,
        /// Normalized physical instant, retimed when ticks are collected.
        fraction: f32,
    },
    /// Stair/support or contact adjustment, consuming no physical time or velocity.
    Adjustment {
        /// Placement proof for the accepted geometric adjustment.
        path: ContactBodyPath,
        /// Normalized physical instant at which the adjustment occurs.
        fraction: f32,
    },
}

impl ContactMotionSegment {
    /// Accepted geometry for placement consumers; an impact observes contact without a path.
    pub fn path(&self) -> Option<&ContactBodyPath> {
        match self {
            Self::Travel { path, .. }
            | Self::Adjustment { path, .. }
            | Self::Rotation { path, .. } => Some(path),
            Self::Impact { .. } => None,
        }
    }

    /// Physical start of this segment; an adjustment starts and ends at the same instant.
    pub const fn start_fraction(&self) -> f32 {
        match self {
            Self::Travel { start_fraction, .. } => *start_fraction,
            Self::Adjustment { fraction, .. } => *fraction,
            Self::Rotation { fraction, .. } | Self::Impact { fraction, .. } => *fraction,
        }
    }

    /// Physical end of this segment, independently of geometric path fractions.
    pub const fn end_fraction(&self) -> f32 {
        match self {
            Self::Travel { end_fraction, .. } => *end_fraction,
            Self::Adjustment { fraction, .. } => *fraction,
            Self::Rotation { fraction, .. } | Self::Impact { fraction, .. } => *fraction,
        }
    }
}

/// One body's contact result, ready for locomotion refresh and canonical publication.
#[derive(Debug)]
pub struct ContactBodyUpdate {
    /// Canonical recipient of the update.
    pub body_id: SpatialBodyId,
    /// Total accepted translation in the common frame, including ordinary movement and correction.
    pub displacement: Vector3,
    /// Accepted orientation; rotation of an offset sphere never contributes to root displacement.
    pub rotation: Quaternion,
    /// Post-contact continuation velocity; positional separation is never divided by time.
    pub velocity: Vector3,
    /// Response-owned acceleration at final support, published with physical continuation.
    pub acceleration: Vector3,
    /// Observed ordinary travel and rotation rates, excluding positional adjustments.
    pub accepted_motion: crate::spatial::AcceptedBodyMotion,
    /// Supported translation, including final horizontal contact separation, divided by admitted
    /// time for locomotion presentation only. Stair lifts, airborne travel, and angular sphere
    /// chords contribute zero; this observation must never become retained physical velocity.
    pub supported_velocity: Vector3,
    /// Final world or hard-entity support; free-flight and projectile response remain airborne.
    pub ground: GroundState,
    /// Final movement-sphere domains with primary committed-cell ownership.
    pub membership: SpatialMembership,
    /// Accepted travel and zero-duration adjustments in their actual application order.
    pub motion: Vec<ContactMotionSegment>,
    /// Missing coverage that stopped this body's remaining local work in the tick.
    pub unavailable_owner: Option<Guid>,
    /// A one-shot supported launch entered velocity integration, independently of later impacts.
    /// The collection aggregates this event for jump packet/feedback publication.
    pub launch_admitted: bool,
    /// First projectile impact, consumed by impact reporting and projectile-state retirement.
    pub projectile_impact: Option<HardSphereSweepHit>,
}

/// Accepted translation observations with separate physical and visual consumers.
#[derive(Default)]
struct ContactTravelObservation {
    /// Timed root travel, consumed by facing and ordinary motion publication.
    ordinary: Vector3,
    /// Supported travel plus accepted horizontal contact adjustment, consumed only by gait.
    supported: Vector3,
}

/// Mutable local state for one participating mobile body.
struct WorkingBody<'a> {
    /// Immutable source for placing authored hard and projectile target geometry after motion.
    source: PreparedContactSource<'a>,
    /// Identity, filtering, and current collision-domain membership.
    contact: ContactParticipant,
    /// Current working geometry and continuation velocity.
    mobile: MobileContactBody,
    /// Authored free-flight drive for this tick, clipped by hard contacts and never retained.
    kinematic_velocity: Vector3,
    /// Definition-owned grounded policy and its current support state, absent for free flight.
    grounded: Option<GroundedContactState>,
    /// Authored response shared by grounded and free-flight hard impacts.
    policy: crate::spatial::PhysicalBodyResponsePolicy,
    /// Initial canonical root in the query frame, used for accepted displacement.
    initial_root: Vector3,
    /// Current canonical root; rotations change sphere offsets without changing this position.
    root: Vector3,
    /// Accepted body orientation used to distinguish sphere-center motion from root travel.
    rotation: Quaternion,
    /// Controller facing sampled once with this tick's linear input.
    control_heading: Option<f32>,
    /// Active input or invalid support requires ordinary integration; sleepers still take contacts.
    integrate_ordinary: bool,
    /// Whether this tick consumed a supported launch edge.
    launch_admitted: bool,
    /// Prepared cumulative crowd-relaxation allowance; navigation has its own stair limits.
    correction_limit: f32,
    /// Selected ordinary travel, shared by facing and publication without re-deriving it.
    observed_travel: ContactTravelObservation,
    /// Accepted travel and adjustments with explicit physical-time provenance.
    motion: Vec<ContactMotionSegment>,
    /// Local coverage failure preventing further movement or correction this tick.
    unavailable_owner: Option<Guid>,
}

impl<'a> WorkingBody<'a> {
    /// Supported publication constrains normal velocity; launches and rebounds release support.
    fn constrain_supported_velocity(&mut self) {
        if let Some(support) = self.ground().walkable_support() {
            self.mobile.velocity =
                self.mobile.velocity - support.normal * self.mobile.velocity.dot(&support.normal);
        }
    }

    fn new(
        source: PreparedContactSource<'a>,
        contact: ContactParticipant,
        mobile: MobileContactBody,
        grounded: Option<GroundedContactState>,
        policy: crate::spatial::PhysicalBodyResponsePolicy,
        anchor: Guid,
    ) -> Result<Self> {
        let radius = mobile
            .spheres
            .iter()
            .map(|sphere| sphere.radius)
            .fold(f32::INFINITY, f32::min);
        let root = source
            .body
            .pose
            .reanchor_to_landblock_owner(anchor)
            .context("could not reanchor contact body root")?
            .coords;
        let integrate_ordinary = source
            .physical
            .dynamic
            .as_ref()
            .is_none_or(|dynamic| dynamic.activity == DynamicBodyActivity::Active);
        Ok(Self {
            source,
            contact,
            mobile,
            kinematic_velocity: Vector3::zero(),
            grounded,
            policy,
            initial_root: root,
            root,
            rotation: source.body.pose.rotation,
            control_heading: None,
            integrate_ordinary,
            launch_admitted: false,
            correction_limit: radius * MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO,
            observed_travel: ContactTravelObservation::default(),
            motion: Vec::new(),
            unavailable_owner: None,
        })
    }

    fn record_impact(&mut self, hit: HardSphereSweepHit, fraction: f32, anchor: Guid) {
        self.motion.push(ContactMotionSegment::Impact {
            hit,
            point: ContactImpactPoint {
                anchor,
                center: self.mobile.spheres.primary().center,
                committed_cell: self.contact.membership.committed_cell(),
            },
            fraction,
        });
    }

    fn into_update(
        self,
        projectile_impact: Option<HardSphereSweepHit>,
        delta_seconds: f32,
    ) -> ContactBodyUpdate {
        let mut end = self.source.body.pose;
        end.rotation = self.rotation;
        let accepted_motion = crate::spatial::physical_body::accepted_motion(
            self.source.body.pose,
            end,
            self.observed_travel.ordinary / delta_seconds,
            delta_seconds,
        );
        ContactBodyUpdate {
            body_id: self.contact.body_id,
            displacement: self.displacement(),
            rotation: self.rotation,
            velocity: self.mobile.velocity,
            acceleration: self.grounded.map_or(
                self.source.body.retained.acceleration,
                |grounded| {
                    crate::spatial::physical_body::grounded_acceleration(
                        grounded.ground,
                        grounded.config,
                        self.policy,
                    )
                },
            ),
            accepted_motion,
            supported_velocity: self.observed_travel.supported / delta_seconds,
            ground: self.ground(),
            membership: self.contact.membership,
            motion: self.motion,
            unavailable_owner: self.unavailable_owner,
            projectile_impact,
            launch_admitted: self.launch_admitted,
        }
    }

    /// Capture only the selected path, after optional stair/edge alternatives have committed.
    fn observe_travel(&mut self) {
        let mut observed = ContactTravelObservation::default();
        for segment in &self.motion {
            if let ContactMotionSegment::Travel {
                path, supported, ..
            } = segment
            {
                let delta =
                    path.primary().final_point().center() - path.primary().initial().center();
                observed.ordinary = observed.ordinary + delta;
                if *supported {
                    observed.supported = observed.supported + delta;
                }
            }
        }
        self.observed_travel = observed;
    }

    fn displacement(&self) -> Vector3 {
        self.root - self.initial_root
    }

    fn ground(&self) -> GroundState {
        match self.grounded {
            Some(grounded) => grounded.ground,
            None => GroundState::Airborne,
        }
    }
}

/// Immutable authored geometry admitted as a one-way sweep target.
struct SweepTarget {
    /// Identity, filtering, and current collision-domain membership.
    contact: ContactParticipant,
    /// Authored hard-target shapes placed once in the collection’s common frame.
    shapes: Vec<PlacedCollisionShape>,
}

/// Integrates local force/motor inputs, then advances hard movement and mobile contacts.
///
/// The caller refreshes residency and supplies response-owned acceleration/support-motor inputs,
/// then publishes the results. The step supplies current response-owned support to the input
/// callback, querying when its proof is stale/absent, and reclassifies after contact movement.
/// Settled bodies with valid support skip ordinary input and travel but retain contact mobility.
/// Input owners must wake bodies when supplying new commands. Inputs are sampled once per active mobile body,
/// never once per contact pass. The caller supplies a launch only on its first admitted tick;
/// the step reports actual support admission for collection-level packet/feedback publication.
pub fn advance_body_contacts(
    collision: &CollisionScene,
    bodies: &[SpatialBody],
    anchor: Guid,
    delta_seconds: f32,
    mut actuation_for: impl FnMut(&SpatialBody, GroundState) -> Result<ContactStepActuation>,
) -> Result<Vec<ContactBodyUpdate>> {
    ensure!(
        delta_seconds.is_finite()
            && delta_seconds > 0.0
            && delta_seconds <= MOBILE_CONTACT_TICK_SECONDS,
        "contact advance requires one positive admitted physical tick"
    );
    let mut identities = bodies.iter().map(|body| body.id).collect::<Vec<_>>();
    identities.sort_unstable();
    ensure!(
        identities.windows(2).all(|pair| pair[0] != pair[1]),
        "contact collection contains duplicate body IDs"
    );
    let mut moving = Vec::new();
    let mut hard = Vec::new();
    let mut projectiles = Vec::new();
    for body in bodies {
        let Some(contact) = PreparedBodyContact::from_body(body, anchor)? else {
            continue;
        };
        if let PreparedContactTarget::Hard(geometry) = contact.source.target {
            hard.push(SweepTarget {
                shapes: placed_target_shapes(geometry, body.pose, anchor)?,
                contact: contact.participant.clone(),
            });
        }
        match contact.role {
            PreparedContactRole::Hard => {}
            PreparedContactRole::Mover {
                body: mobile,
                grounded,
                policy,
            } => {
                let working = WorkingBody::new(
                    contact.source,
                    contact.participant,
                    mobile,
                    grounded,
                    policy,
                    anchor,
                )?;
                moving.push(working);
            }
            PreparedContactRole::Projectile {
                body: mobile,
                policy,
            } => {
                let actuation = actuation_for(body, GroundState::Airborne)?;
                ensure!(
                    matches!(
                        actuation.motion,
                        ContactStepMotion::Ballistic | ContactStepMotion::FreeFlight { .. }
                    ),
                    "projectile actuation requires flight input"
                );
                let mut working = WorkingBody::new(
                    contact.source,
                    contact.participant,
                    mobile,
                    None,
                    policy,
                    anchor,
                )?;
                integrate_mobile_actuation(&mut working, actuation, delta_seconds)?;
                ensure!(
                    finite_vector(working.mobile.velocity),
                    "projectile integration produced non-finite velocity"
                );
                projectiles.push(working);
            }
        }
    }
    // Advance nonyielding bodies first, then expose their accepted authored target pose to characters.
    moving.sort_unstable_by_key(|body| {
        (
            body.mobile.response_mobility.is_some(),
            body.contact.body_id,
        )
    });
    let mut hard = HardTargets::new(hard)?;
    // Prepare all hard targets before any body validates support or consumes its input.
    for body in &mut moving {
        if let Some(grounded) = body.grounded {
            let valid = match grounded.ground {
                GroundState::Supported(support) | GroundState::Sliding(support) => {
                    matches!(support.source, crate::spatial::SupportSource::World(proof) if collision.proves(proof))
                        && body.mobile.velocity.dot(&support.normal)
                            <= crate::spatial::bsp_query::CONTACT_EPSILON
                }
                GroundState::Airborne => false,
            };
            if !valid {
                refresh_support(collision, &hard, anchor, body, SupportRefresh::Recover)?;
                // Entity support is re-queried even while sleeping using the ordinary query.
                // Gameplay concession: retaining grounded state after support removal is also
                // acceptable if it simplifies this path. Immediate falling is not a requirement;
                // do not add removal notifications or dependency tracking solely to preserve it.
                // Only changed footing or unsupported motion wakes ordinary integration.
                body.integrate_ordinary |= body.ground() != grounded.ground
                    || matches!(body.ground(), GroundState::Airborne);
            }
        }
        if body.integrate_ordinary && body.unavailable_owner.is_none() {
            let actuation = actuation_for(body.source.body, body.ground())?;
            integrate_mobile_actuation(body, actuation, delta_seconds)?;
            ensure!(
                finite_vector(body.mobile.velocity),
                "contact integration produced non-finite velocity"
            );
            if body.mobile.response_mobility.is_none() {
                advance_ordinary_motion(collision, &hard, anchor, body, delta_seconds)?;
            }
        }
        if let PreparedContactTarget::Hard(geometry) = body.source.target {
            let mut pose = body.source.body.pose;
            pose.coords = pose.coords + body.displacement();
            pose.rotation = body.rotation;
            let shapes = placed_target_shapes(geometry, pose, anchor)?;
            hard.replace(SweepTarget {
                contact: body.contact.clone(),
                shapes,
            })?;
        }
    }
    // All yielding intent is sampled before mobile admission. Hard authored targets above
    // already expose their accepted poses; no neighbor can cause another input sample.
    admission::admit_character_movement(&mut moving, delta_seconds);
    for body in &mut moving {
        if body.mobile.response_mobility.is_some()
            && body.integrate_ordinary
            && body.unavailable_owner.is_none()
        {
            advance_ordinary_motion(collision, &hard, anchor, body, delta_seconds)?;
        }
    }
    let mut tentative = moving.iter().map(|body| body.mobile).collect::<Vec<_>>();
    let mut remaining = moving
        .iter()
        .map(|body| body.correction_limit)
        .collect::<Vec<_>>();
    let mut corrections = vec![Vector3::zero(); moving.len()];
    // Each body's total correction path length is bounded by its initial allowance.
    // Later positions plus remaining travel therefore stay inside these initial envelopes.
    // Keep pair order stable while rechecking actual overlap on every pass.
    let pairs = candidate_pairs(&tentative, &remaining);
    for _ in 0..MOBILE_CONTACT_PASSES {
        corrections.fill(Vector3::zero());
        for &(first, second) in &pairs {
            let Some(response) = resolve_participant_pair(
                &moving[first].contact,
                tentative[first],
                &moving[second].contact,
                tentative[second],
            ) else {
                continue;
            };
            for (index, change) in [(first, response.first), (second, response.second)] {
                if moving[index].unavailable_owner.is_none() {
                    corrections[index] = corrections[index] + change.displacement;
                    tentative[index].velocity = tentative[index].velocity + change.velocity_change;
                }
            }
        }
        for ((mobile, remaining), correction) in
            tentative.iter_mut().zip(&mut remaining).zip(&corrections)
        {
            let displacement = limited(*correction, *remaining);
            mobile.spheres = translated_spheres(mobile.spheres, displacement)?;
            *remaining = (*remaining - displacement.length()).max(0.0);
        }
    }
    // Hard geometry has the final say. Tentative yielding may be clipped or rejected;
    // residual mobile overlap is accepted until a later tick, without a feedback solve.
    for (body, tentative) in moving.iter_mut().zip(tentative) {
        let correction = tentative.spheres.primary().center - body.mobile.spheres.primary().center;
        body.mobile.velocity = tentative.velocity;
        let correction_start = body.root;
        let was_supported = body.ground().walkable_support().is_some();
        apply_correction(collision, &hard, anchor, body, correction)?;
        if was_supported && body.ground().walkable_support().is_some() {
            // The gait must follow accepted displacement, not walk toward the reference
            // while separation carries the body the other way. Observe only the final
            // hard-clipped correction; neither tentative motion nor stair lift is a gait.
            let accepted = body.root - correction_start;
            body.observed_travel.supported =
                body.observed_travel.supported + Vector3::new(accepted.x, accepted.y, 0.0);
        }
    }
    for body in &mut moving {
        if body.unavailable_owner.is_none() && matches!(body.ground(), GroundState::Airborne) {
            refresh_support(collision, &hard, anchor, body, SupportRefresh::Confirm)?;
        }
        // Crowd velocity can change even when its combined correction is zero.
        body.constrain_supported_velocity();
    }
    let mut updates = Vec::new();
    let mut projectile_targets = hard;
    for body in moving {
        let displacement = body.displacement();
        if !projectiles.is_empty()
            && let PreparedContactTarget::Mobile(geometry) = body.source.target
        {
            // Projectile targets use accepted crowd end poses, without trajectory negotiation.
            let mut pose = body.source.body.pose;
            pose.coords = pose.coords + displacement;
            pose.rotation = body.rotation;
            projectile_targets.push(SweepTarget {
                contact: body.contact.clone(),
                shapes: placed_target_shapes(geometry, pose, anchor)?,
            })?;
        }
        updates.push(body.into_update(None, delta_seconds));
    }
    if !projectiles.is_empty() {
        for projectile in projectiles {
            updates.push(advance_projectile(
                collision,
                &projectile_targets,
                anchor,
                projectile,
                delta_seconds,
            )?);
        }
    }
    updates.sort_unstable_by_key(|update| update.body_id);
    Ok(updates)
}

/// Shared ordinary translation and orientation after the caller has admitted its velocity.
fn advance_ordinary_motion(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    delta_seconds: f32,
) -> Result<()> {
    advance_hard_motion(
        collision,
        hard,
        anchor,
        body,
        HardMovement::Timed(delta_seconds),
    )?;
    if body.unavailable_owner.is_none()
        && let Some(hit) =
            angular::advance_orientation(collision, hard, anchor, body, delta_seconds)?
    {
        body.record_impact(hit, 1.0, anchor);
    }
    Ok(())
}

fn integrate_mobile_actuation(
    body: &mut WorkingBody<'_>,
    actuation: ContactStepActuation,
    delta_seconds: f32,
) -> Result<()> {
    body.control_heading = actuation.control_heading;
    if let ContactStepMotion::FreeFlight { kinematic_velocity } = actuation.motion {
        ensure!(
            body.grounded.is_none(),
            "free-flight input requires a flight body"
        );
        body.kinematic_velocity = kinematic_velocity;
    }
    if matches!(actuation.motion, ContactStepMotion::Launch(_)) {
        let grounded = body
            .grounded
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("contact launch requires a grounded body"))?;
        ensure!(
            grounded.ground.walkable_support().is_some(),
            "contact launch requires current walkable support"
        );
        grounded.ground = GroundState::Airborne;
        body.launch_admitted = true;
    }
    body.mobile.velocity = actuation.predict_velocity(
        body.mobile.velocity,
        body.ground(),
        body.policy,
        delta_seconds,
    );
    Ok(())
}

fn advance_projectile(
    collision: &CollisionScene,
    targets: &HardTargets,
    anchor: Guid,
    mut projectile: WorkingBody<'_>,
    delta_seconds: f32,
) -> Result<ContactBodyUpdate> {
    let impact =
        advance_projectile_translation(collision, targets, anchor, &mut projectile, delta_seconds)?;
    projectile.observe_travel();
    let angular_impact = if projectile.unavailable_owner.is_none() {
        angular::advance_orientation(collision, targets, anchor, &mut projectile, delta_seconds)?
    } else {
        None
    };
    if let Some(hit) = angular_impact {
        projectile.record_impact(hit, 1.0, anchor);
    }
    // A rotating offset sphere may supply the projectile's first obstruction even with no
    // root travel. It retires the projectile just like a translational swept impact.
    if impact.is_none()
        && let Some(hit) = angular_impact
    {
        projectile.mobile.velocity = impact_velocity(
            projectile.mobile.velocity,
            hit.contact().normal,
            projectile.policy.restitution,
        );
    }
    Ok(projectile.into_update(impact.or(angular_impact), delta_seconds))
}

/// Projectile translation gets one full-speed sweep and first-impact response, with no slide loop.
fn advance_projectile_translation(
    collision: &CollisionScene,
    targets: &HardTargets,
    anchor: Guid,
    projectile: &mut WorkingBody<'_>,
    delta_seconds: f32,
) -> Result<Option<HardSphereSweepHit>> {
    let requested = (projectile.mobile.velocity + projectile.kinematic_velocity) * delta_seconds;
    if requested.length_squared() == 0.0 {
        return Ok(None);
    }
    let swept = match sweep_body_motion(
        collision,
        targets,
        anchor,
        &projectile.contact,
        projectile.mobile.spheres,
        requested,
    ) {
        Ok(swept) => swept,
        Err(CollisionQueryError::UnavailableOwner { owner }) => {
            projectile.unavailable_owner = Some(Guid(owner));
            projectile.mobile.velocity = Vector3::zero();
            return Ok(None);
        }
        Err(error) => return Err(error.into()),
    };
    let fraction = swept.hit.map_or(1.0, |hit| hit.contact().time_of_impact);
    if fraction > 0.0 {
        let path = accepted_prefix(swept.path, fraction)?;
        translate_to(projectile, &path)?;
        projectile.motion.push(ContactMotionSegment::Travel {
            path,
            supported: false,
            start_fraction: 0.0,
            end_fraction: fraction,
        });
    }
    if let Some(hit) = swept.hit {
        projectile.record_impact(hit, fraction, anchor);
        projectile.mobile.velocity = impact_velocity(
            projectile.mobile.velocity,
            hit.contact().normal,
            projectile.policy.restitution,
        );
    }
    Ok(swept.hit)
}

/// Preparation can correct a pose; final confirmation only observes accepted geometry.
#[derive(Clone, Copy)]
enum SupportRefresh {
    /// One bounded upward recovery before selecting the ordinary motor.
    Recover,
    /// No additional movement after the completed navigation passes.
    Confirm,
}

fn refresh_support(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    refresh: SupportRefresh,
) -> Result<()> {
    let Some(grounded) = body.grounded else {
        return Ok(());
    };
    let result = match refresh {
        SupportRefresh::Recover => {
            stairs::prepare_support(collision, hard, anchor, body, grounded.config)
        }
        SupportRefresh::Confirm => stairs::support_at(
            collision,
            hard,
            anchor,
            body.mobile,
            &body.contact,
            grounded.config,
        )
        .map_err(Into::into),
    };
    match result {
        Ok(ground) => body.grounded = Some(GroundedContactState { ground, ..grounded }),
        Err(error) => match error.downcast_ref::<CollisionQueryError>() {
            Some(CollisionQueryError::UnavailableOwner { owner }) => {
                body.unavailable_owner = Some(Guid(*owner));
                body.mobile.velocity = Vector3::zero();
            }
            _ => return Err(error),
        },
    }
    Ok(())
}

/// Movement provenance: timed travel consumes already-integrated velocity; correction is geometric.
#[derive(Clone, Copy)]
enum HardMovement {
    /// Admitted duration; this operation never integrates forces itself.
    Timed(f32),
    /// Combined crowd displacement, independent of retained or authored velocity.
    Correction(Vector3),
}

impl HardMovement {
    fn requested(self, body: &WorkingBody<'_>, elapsed: f32) -> Vector3 {
        match self {
            Self::Timed(dt) => {
                (body.mobile.velocity + body.kinematic_velocity) * dt * (1.0 - elapsed)
            }
            Self::Correction(displacement) => displacement * (1.0 - elapsed),
        }
    }

    fn impact_velocity(self, body: &WorkingBody<'_>, normal: Vector3, supported: bool) -> Vector3 {
        let incoming = body.mobile.velocity;
        match self {
            Self::Timed(_) => ordinary_impact_velocity(
                incoming,
                normal,
                body.policy,
                supported,
                body.grounded
                    .map_or(0.0, |grounded| -grounded.config.gravity * normal.z),
            ),
            Self::Correction(_) => incoming - normal * incoming.dot(&normal).min(0.0),
        }
    }
}

fn advance_hard_motion(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    movement: HardMovement,
) -> Result<()> {
    let motion_start = body.motion.len();
    let protected = stairs::ProtectedFooting::capture(body);
    let mut footing = advance_hard_candidate(collision, hard, anchor, body, movement)?;
    if matches!(footing, stairs::NavigationFooting::Unsupported)
        && let Some(start) = protected
    {
        footing = stairs::try_edge_slide(collision, hard, anchor, body, &start, movement)?;
        if matches!(footing, stairs::NavigationFooting::Unsupported) {
            start.restore(body);
            // A held timed move consumes its interval without banking inward velocity.
            if matches!(movement, HardMovement::Timed(_)) {
                body.mobile.velocity = Vector3::zero();
            }
            footing = stairs::NavigationFooting::Unchanged;
        }
    }
    if let Some(grounded) = &mut body.grounded {
        match footing {
            stairs::NavigationFooting::Unchanged => {}
            stairs::NavigationFooting::Unsupported => grounded.ground = GroundState::Airborne,
            stairs::NavigationFooting::Settled(ground) => grounded.ground = ground,
        }
    }
    // Every accepted navigation route (including stair and edge rollback) publishes
    // the same support/velocity contract before another contact stage can consume it.
    body.constrain_supported_velocity();
    match movement {
        HardMovement::Timed(_) => body.observe_travel(),
        HardMovement::Correction(_) => {
            // Navigation shares one geometry path; only ordinary travel consumes physical time.
            let correction_motion = body.motion.split_off(motion_start);
            body.motion
                .extend(correction_motion.into_iter().map(|segment| match segment {
                    ContactMotionSegment::Travel { path, .. }
                    | ContactMotionSegment::Adjustment { path, .. } => {
                        ContactMotionSegment::Adjustment {
                            path,
                            fraction: 1.0,
                        }
                    }
                    ContactMotionSegment::Impact { hit, point, .. } => {
                        ContactMotionSegment::Impact {
                            hit,
                            point,
                            fraction: 1.0,
                        }
                    }
                    ContactMotionSegment::Rotation { path, rotation, .. } => {
                        ContactMotionSegment::Rotation {
                            path,
                            rotation,
                            fraction: 1.0,
                        }
                    }
                }));
        }
    }
    Ok(())
}

fn advance_hard_candidate(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    mut movement: HardMovement,
) -> Result<stairs::NavigationFooting> {
    let mut elapsed = 0.0;
    let mut stair_attempted = false;
    for _ in 0..MOBILE_CONTACT_HARD_SLIDE_PASSES {
        let requested = movement.requested(body, elapsed);
        if requested.length_squared() == 0.0 {
            break;
        }
        let swept = match sweep_body_motion(
            collision,
            hard,
            anchor,
            &body.contact,
            body.mobile.spheres,
            requested,
        ) {
            Ok(swept) => swept,
            Err(CollisionQueryError::UnavailableOwner { owner }) => {
                body.unavailable_owner = Some(Guid(owner));
                // An unqueryable ordinary move stops locally. Do not retain force-advanced
                // velocity at a held pose and accumulate gravity across unavailable ticks.
                body.mobile.velocity = Vector3::zero();
                break;
            }
            Err(error) => return Err(error.into()),
        };
        if let Some(hit) = swept.hit
            && !stair_attempted
        {
            stair_attempted = true;
            let maneuver = stairs::try_stair_maneuver(
                collision,
                hard,
                anchor,
                body,
                requested,
                elapsed,
                hit.contact().normal,
            );
            match maneuver {
                Ok(Some(maneuver)) => {
                    body.root = body.root
                        + (maneuver.spheres.primary().center
                            - body.mobile.spheres.primary().center);
                    body.mobile.spheres = maneuver.spheres;
                    body.contact.membership = maneuver.membership;
                    body.motion.extend(maneuver.motion);
                    return Ok(stairs::NavigationFooting::Settled(GroundState::Supported(
                        maneuver.support,
                    )));
                }
                Ok(None) => {}
                // Coverage missing only on an optional stair route does not invalidate the
                // ordinary sweep already proved above. Decline that route and retain its slide.
                Err(error)
                    if matches!(
                        error.downcast_ref::<CollisionQueryError>(),
                        Some(CollisionQueryError::UnavailableOwner { .. })
                    ) => {}
                Err(error) => return Err(error),
            }
        }
        let fraction = swept.hit.map_or(1.0, |hit| hit.contact().time_of_impact);
        if fraction > 0.0 {
            let path = accepted_prefix(swept.path, fraction)?;
            translate_to(body, &path)?;
            let end_fraction = elapsed + (1.0 - elapsed) * fraction;
            body.motion.push(ContactMotionSegment::Travel {
                path,
                supported: body.ground().walkable_support().is_some(),
                start_fraction: elapsed,
                end_fraction,
            });
            elapsed = end_fraction;
        }
        let Some(hit) = swept.hit else {
            break;
        };
        body.record_impact(hit, elapsed, anchor);
        let normal = hit.contact().normal;
        body.kinematic_velocity =
            body.kinematic_velocity - normal * body.kinematic_velocity.dot(&normal).min(0.0);
        body.mobile.velocity =
            movement.impact_velocity(body, normal, body.ground().walkable_support().is_some());
        if let HardMovement::Correction(displacement) = &mut movement {
            *displacement = *displacement - normal * displacement.dot(&normal).min(0.0);
        }
        // Keep every accepted prefix when the fixed pass budget ends. Remaining physical
        // time is stationary; no geometric retry or catch-up displacement is queued.
    }
    if body.unavailable_owner.is_none() {
        // Successful stairs return above with support already settled. Ordinary travel
        // gets one settle here, before any mobile contact can push it off support.
        return stairs::settle_after_movement(collision, hard, anchor, body, movement);
    }
    Ok(stairs::NavigationFooting::Unchanged)
}

/// Physical impact response shared by swept hits and accepted landing probes.
/// RETAIL DIVERGENCE: retail uses a stationary-fall frame counter when handling contacts
/// (acclient.c:309962-310051). Here negligible grounded rebounds use ballistic height,
/// and sustained support absorbs inward force; restoring frame-dependent settling would
/// make rest depend on tick frequency again. Scope: synthetic slope, sledding, landing,
/// launch and crowd conformance fixtures; no full authored-surface census is claimed.
fn ordinary_impact_velocity(
    incoming: Vector3,
    normal: Vector3,
    policy: crate::spatial::PhysicalBodyResponsePolicy,
    previously_supported: bool,
    inward_acceleration: f32,
) -> Vector3 {
    let mut velocity = if previously_supported
        && policy.surface_motion == crate::spatial::PhysicalSurfaceMotion::Stable
    {
        incoming - normal * incoming.dot(&normal).min(0.0)
    } else {
        impact_velocity(incoming, normal, policy.restitution)
    };
    let rebound = velocity.dot(&normal);
    if rebound > 0.0
        && inward_acceleration > 0.0
        && rebound * rebound
            <= 2.0 * inward_acceleration * crate::spatial::bsp_query::CONTACT_EPSILON
    {
        // A rebound whose ballistic height is below query resolution cannot establish
        // meaningful separation, independently of the producer timestep.
        // Remove only normal motion; tangential travel and visible bounces survive.
        velocity = velocity - normal * rebound;
    }
    velocity
}

fn accepted_prefix(path: ContactBodyPath, fraction: f32) -> Result<ContactBodyPath> {
    if fraction < 1.0 {
        let primary = path.primary.interval(0.0, fraction)?;
        let upper = path
            .upper
            .map(|upper| upper.interval(0.0, fraction))
            .transpose()?;
        Ok(ContactBodyPath::new(primary, upper))
    } else {
        Ok(path)
    }
}

fn translate_to(body: &mut WorkingBody<'_>, path: &ContactBodyPath) -> Result<Vector3> {
    let displacement = path.primary().final_point().center() - body.mobile.spheres.primary().center;
    body.mobile.spheres = translated_spheres(body.mobile.spheres, displacement)?;
    body.root = body.root + displacement;
    body.contact.membership = path.membership().clone();
    Ok(displacement)
}

fn translated_spheres(
    spheres: PhysicalSphereSet,
    displacement: Vector3,
) -> Result<PhysicalSphereSet> {
    let translated = |sphere: GroundedSphere| Sphere {
        center: sphere.center + displacement,
        radius: sphere.radius,
    };
    Ok(PhysicalSphereSet::new(
        translated(spheres.primary()),
        spheres.upper_constraint().map(translated),
    )?)
}

/// Sweep-and-prune envelope, expanded by the body's remaining correction travel this pass.
struct Envelope {
    /// Stable index into the working mobile-body array.
    index: usize,
    /// Lowest coordinate reachable by any sphere under remaining correction travel.
    minimum: Vector3,
    /// Highest coordinate reachable by any sphere under remaining correction travel.
    maximum: Vector3,
}

impl Envelope {
    /// Bounds starting and translated spheres, with optional correction travel in every direction.
    fn new(index: usize, spheres: PhysicalSphereSet, travel: Vector3, padding: f32) -> Self {
        let mut minimum = Vector3::new(f32::INFINITY, f32::INFINITY, f32::INFINITY);
        let mut maximum = minimum * -1.0;
        for sphere in spheres.iter() {
            let radius = sphere.radius + padding;
            let start = sphere.center;
            let end = start + travel;
            minimum.x = minimum.x.min(start.x.min(end.x) - radius);
            minimum.y = minimum.y.min(start.y.min(end.y) - radius);
            minimum.z = minimum.z.min(start.z.min(end.z) - radius);
            maximum.x = maximum.x.max(start.x.max(end.x) + radius);
            maximum.y = maximum.y.max(start.y.max(end.y) + radius);
            maximum.z = maximum.z.max(start.z.max(end.z) + radius);
        }
        Self {
            index,
            minimum,
            maximum,
        }
    }
}

fn candidate_pairs(bodies: &[MobileContactBody], remaining: &[f32]) -> Vec<(usize, usize)> {
    let envelopes = bodies
        .iter()
        .enumerate()
        .filter(|(_, body)| body.response_mobility.is_some())
        .map(|(index, body)| Envelope::new(index, body.spheres, Vector3::zero(), remaining[index]))
        .collect::<Vec<_>>();
    envelope_pairs(envelopes)
}

/// Shared sweep-and-prune over caller-prepared reachable bounds.
fn envelope_pairs(mut envelopes: Vec<Envelope>) -> Vec<(usize, usize)> {
    envelopes.sort_unstable_by(|a, b| {
        a.minimum
            .x
            .total_cmp(&b.minimum.x)
            .then(a.index.cmp(&b.index))
    });
    let mut pairs = Vec::new();
    for (offset, first) in envelopes.iter().enumerate() {
        for second in &envelopes[offset + 1..] {
            if second.minimum.x > first.maximum.x {
                break;
            }
            if first.minimum.y <= second.maximum.y
                && second.minimum.y <= first.maximum.y
                && first.minimum.z <= second.maximum.z
                && second.minimum.z <= first.maximum.z
            {
                pairs.push((first.index.min(second.index), first.index.max(second.index)));
            }
        }
    }
    pairs.sort_unstable();
    pairs
}

fn limited(vector: Vector3, maximum: f32) -> Vector3 {
    let length = vector.length();
    if length > maximum {
        vector * (maximum / length)
    } else {
        vector
    }
}

fn apply_correction(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
    correction: Vector3,
) -> Result<()> {
    if body.unavailable_owner.is_some() || correction.length_squared() == 0.0 {
        return Ok(());
    }
    advance_hard_motion(
        collision,
        hard,
        anchor,
        body,
        HardMovement::Correction(correction),
    )
}

/// Both movement spheres keep their proofs and share the earliest blocking fraction.
fn sweep_body_motion(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    contact: &ContactParticipant,
    spheres: PhysicalSphereSet,
    requested: Vector3,
) -> std::result::Result<BodySweep, CollisionQueryError> {
    sweep_body_chords(collision, hard, anchor, contact, spheres, |_| requested)
}

/// Shared hard admission for translation or independently moving rotational sphere centers.
fn sweep_body_chords(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    contact: &ContactParticipant,
    spheres: PhysicalSphereSet,
    displacement: impl Fn(GroundedSphere) -> Vector3,
) -> std::result::Result<BodySweep, CollisionQueryError> {
    let primary = sweep_motion_sphere(
        collision,
        hard,
        anchor,
        contact,
        displacement(spheres.primary()),
        spheres.primary(),
    )?;
    let upper = spheres
        .upper_constraint()
        .map(|sphere| {
            sweep_motion_sphere(
                collision,
                hard,
                anchor,
                contact,
                displacement(sphere),
                sphere,
            )
        })
        .transpose()?;
    let mut hit = primary.hit;
    if let Some(upper_hit) = upper.as_ref().and_then(|upper| upper.hit)
        && hit.is_none_or(|current| {
            upper_hit.contact().time_of_impact < current.contact().time_of_impact
        })
    {
        hit = Some(upper_hit);
    }
    Ok(BodySweep {
        hit,
        path: ContactBodyPath::new(primary.path, upper.map(|upper| upper.path)),
    })
}

fn sweep_motion_sphere(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    contact: &ContactParticipant,
    requested: Vector3,
    sphere: GroundedSphere,
) -> std::result::Result<HardSphereSweep, CollisionQueryError> {
    let center = sphere.center + requested * 0.5;
    let reach = sphere.radius + requested.length() * 0.5;
    let candidates = hard
        .sphere_candidates(center, reach)
        .filter(|target| contact.receives_response_from(&target.contact))
        .flat_map(|target| {
            target
                .shapes
                .iter()
                .filter(move |shape| shape.bounds.intersects_sphere(center, reach))
                .map(|shape| HardEntityShape {
                    body_id: target.contact.body_id,
                    shape,
                    membership: &target.contact.membership,
                })
        });
    collision.sweep_hard_sphere(
        StaticSphereSweepRequest {
            anchor,
            start: sphere.center,
            end: sphere.center + requested,
            previous_cell: contact.membership.committed_cell(),
            radius: sphere.radius,
            filter: contact.filter,
        },
        candidates,
    )
}

#[cfg(test)]
mod actuation_tests {
    use super::*;

    #[test]
    fn initial_pair_envelopes_cover_every_relaxation_pass() {
        // Include exact coincidence, a dense grid, and a loose chain whose gaps can close
        // under earlier corrections. Compare to rebuilding candidates at each current pose.
        let mut created_contact = false;
        let mut exhausted_budget = false;
        for spacing in [0.0, 0.7, 1.05] {
            let radius = 0.5;
            let mut initial = (0..45)
                .map(|index| {
                    MobileContactBody::new(
                        PhysicalSphereSet::new(
                            Sphere {
                                center: Vector3::new(
                                    (index % 9) as f32 * spacing,
                                    (index / 9) as f32 * spacing,
                                    0.0,
                                ),
                                radius,
                            },
                            None,
                        )
                        .unwrap(),
                        Vector3::new((index % 3) as f32 - 1.0, 0.0, 0.0),
                        Some(ContactMobility::new(1.0).unwrap()),
                    )
                    .unwrap()
                })
                .collect::<Vec<_>>();
            if spacing == 1.05 {
                for (index, x) in [(1, 0.8), (2, 1.82)] {
                    let shift =
                        Vector3::new(x - initial[index].spheres.primary().center.x, 0.0, 0.0);
                    initial[index].spheres =
                        translated_spheres(initial[index].spheres, shift).unwrap();
                }
            }
            let mut run = |reuse: bool| {
                let mut bodies = initial.clone();
                let mut remaining =
                    vec![radius * MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO; bodies.len()];
                let initial_pairs = candidate_pairs(&bodies, &remaining);
                for _ in 0..MOBILE_CONTACT_PASSES {
                    let current_pairs = candidate_pairs(&bodies, &remaining);
                    for pair in &current_pairs {
                        assert!(initial_pairs.binary_search(pair).is_ok());
                    }
                    let pairs = if reuse {
                        &initial_pairs
                    } else {
                        &current_pairs
                    };
                    let mut corrections = vec![Vector3::zero(); bodies.len()];
                    for &(first, second) in pairs {
                        if let Some(response) =
                            resolve_mobile_contact(&bodies[first], &bodies[second])
                        {
                            created_contact |=
                                resolve_mobile_contact(&initial[first], &initial[second]).is_none();
                            for (index, change) in
                                [(first, response.first), (second, response.second)]
                            {
                                corrections[index] = corrections[index] + change.displacement;
                                bodies[index].velocity =
                                    bodies[index].velocity + change.velocity_change;
                            }
                        }
                    }
                    for (index, correction) in corrections.into_iter().enumerate() {
                        let displacement = limited(correction, remaining[index]);
                        bodies[index].spheres =
                            translated_spheres(bodies[index].spheres, displacement).unwrap();
                        remaining[index] = (remaining[index] - displacement.length()).max(0.0);
                    }
                }
                exhausted_budget |= remaining.contains(&0.0);
                bodies
                    .into_iter()
                    .map(|body| (body.spheres.primary().center, body.velocity))
                    .collect::<Vec<_>>()
            };
            assert_eq!(run(true), run(false));
        }
        assert!(created_contact);
        assert!(exhausted_budget);
    }

    #[test]
    fn zero_weight_bodies_remain_mobile_pair_candidates() {
        let spheres = |x| {
            PhysicalSphereSet::new(
                holtburger_common::Sphere {
                    center: Vector3::new(x, 0.0, 0.0),
                    radius: 0.5,
                },
                None,
            )
            .unwrap()
        };
        let zero = Some(super::super::ContactMobility::ZERO);
        let bodies = [
            MobileContactBody::new(spheres(0.0), Vector3::new(1.0, 0.0, 0.0), zero).unwrap(),
            MobileContactBody::new(spheres(0.9), Vector3::zero(), zero).unwrap(),
            MobileContactBody::new(spheres(0.5), Vector3::zero(), None).unwrap(),
        ];
        assert_eq!(candidate_pairs(&bodies, &[0.0; 3]), vec![(0, 1)]);
        let response = super::super::resolve_mobile_contact(&bodies[0], &bodies[1]).unwrap();
        assert_eq!(response.first.displacement, Vector3::zero());
        assert_eq!(
            bodies[0].velocity + response.first.velocity_change,
            Vector3::zero()
        );
    }

    #[test]
    fn surface_motor_is_bounded_and_preserves_normal_velocity() {
        let normal = Vector3::new(0.0, 0.6, 0.8);
        let incoming = normal * 2.0;
        let input =
            ContactStepActuation::driven(Vector3::zero(), Vector3::new(10.0, 0.0, 0.0), normal)
                .unwrap();
        let result = input.integrate(incoming, MOBILE_CONTACT_TICK_SECONDS);
        let change = result - incoming;
        assert!(
            (change.length() - PASSIVE_MOTOR_ACCELERATION * MOBILE_CONTACT_TICK_SECONDS).abs()
                < 0.000001
        );
        assert!(change.dot(&normal).abs() < 0.000001);
    }
    #[test]
    fn grounded_rebounds_require_height_above_collision_resolution() {
        use crate::spatial::{
            PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction, PhysicalRestitution,
            PhysicalSurfaceMotion,
        };
        let elasticity = PhysicalElasticity::DEFAULT;
        let policy = PhysicalBodyResponsePolicy {
            restitution: PhysicalRestitution::Elastic(elasticity),
            friction: PhysicalFriction::DEFAULT,
            surface_motion: PhysicalSurfaceMotion::Stable,
            align_path: false,
        };
        let gravity = 9.8;
        let normal = Vector3::new(0.0, 0.0, 1.0);
        let impact_boundary =
            (2.0 * gravity * crate::spatial::bsp_query::CONTACT_EPSILON).sqrt() / elasticity.get();
        let small = ordinary_impact_velocity(
            Vector3::new(1.0, 0.0, -impact_boundary * 0.5),
            normal,
            policy,
            false,
            gravity,
        );
        let large = ordinary_impact_velocity(
            Vector3::new(1.0, 0.0, -impact_boundary * 2.0),
            normal,
            policy,
            false,
            gravity,
        );
        assert_eq!(small.z, 0.0);
        assert!(large.z > 0.0);
        assert_eq!(small.x, 1.0);
        assert_eq!(large.x, 1.0);
    }
    #[test]
    fn motor_brakes_then_accelerates_without_overshooting() {
        let velocity = Vector3::new(8.0, 0.0, 0.0);
        let stopping_time = velocity.x / PASSIVE_MOTOR_BRAKING;
        let stop = motor_velocity_change(velocity, velocity * -1.0, stopping_time * 2.0);
        assert!((velocity + stop).length() < 0.00001);
        let reverse_time = stopping_time + 0.05;
        let target = Vector3::new(-8.0, 0.0, 0.0);
        let reverse = velocity + motor_velocity_change(velocity, target - velocity, reverse_time);
        assert!((reverse.x + PASSIVE_MOTOR_ACCELERATION * 0.05).abs() < 0.00001);
        let start = motor_velocity_change(Vector3::zero(), velocity, 0.05);
        assert!((start.x - PASSIVE_MOTOR_ACCELERATION * 0.05).abs() < 0.00001);
    }
}
