//! Bounded grounded motion for an authored lower sphere and optional upper sphere.

use anyhow::{Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};

#[cfg(test)]
use super::collision::CollisionOwnerProof;
use super::collision::{
    CellTransitRequest, CollisionScene, GroundedObstruction, GroundedObstructionRequest,
    MotionWaypoint, MovementRestrictionRequest, PlacementRequest, PlacementRestrictionRequest,
    SpatialMembership, SphereSweep, StaticContact, SupportContact, SupportFeature, SupportRequest,
    anchor_point_to_cell_position, anchor_point_to_outdoor_position, landblock_key,
    separating_displacement,
};

/// Retail's minimum upward surface-normal component for walkable support.
///
/// `PhysicsGlobals::floor_z` is initialized once and consumed by
/// `CPhysicsObj::is_valid_walkable` (`acclient.c:765983-765986`, `:304992-304995`).
pub const RETAIL_WALKABLE_NORMAL_Z: f32 = 0.664_174_14;

/// Retail's lenient landing allowance for bodies without walkable support.
///
/// A transition prepared while the body lacks `OnWalkable` writes `0.0871557` (cos 85°) into
/// `SPHEREPATH::walkable_allowance` (`acclient.c:301469-301474`, `:301563-301569`, `:302009`),
/// so a falling body accepts nearly any upward-tilted surface as a landing contact. The walking
/// threshold above still decides whether that contact is walkable.
pub const RETAIL_LANDING_NORMAL_Z: f32 = 0.087_155_7;

/// Retail's step-down reach for bodies without walkable support (`acclient.c:301468`, `:301562`).
pub const RETAIL_AIRBORNE_STEP_DOWN_HEIGHT: f32 = 0.04;

/// Explicit limits and grounded-response policy for one solve.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedConfig {
    /// Downward world acceleration in meters per second squared.
    pub gravity: f32,
    /// Minimum upward normal component that may support the lower sphere while walking.
    pub walkable_normal_z: f32,
    /// Minimum upward normal component a body without walkable support accepts as a landing
    /// contact; landings between this and `walkable_normal_z` classify as contact-slide.
    pub landing_normal_z: f32,
    /// Step-down reach used by the lenient landing probe of a body without walkable support.
    pub airborne_step_down_height: f32,
    /// Maximum non-recursive rise used by a lower-sphere step attempt.
    pub step_up_height: f32,
    /// Maximum vertical distance used to retain or acquire support after movement.
    pub step_down_height: f32,
    /// Whether a previously supported body may leave its footing.
    pub edge_protection: EdgeProtection,
    /// Maximum world-meter length of one collision substep.
    pub maximum_substep_distance: f32,
    /// Maximum number of substeps accepted for one tick.
    pub maximum_substeps: usize,
    /// Maximum separation passes per substep.
    pub maximum_contact_passes: usize,
    /// Small outward displacement added after contact separation.
    pub separation_epsilon: f32,
}

/// Grounded response when requested motion leaves the current footing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeProtection {
    /// Accept the unsupported candidate and begin falling.
    None,
    /// Preserve the last supported pose when no supported edge slide is available.
    Creature,
}

/// One sphere center authored relative to the body's pose.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedSphere {
    /// Body-local center transformed by the pose rotation for every candidate.
    pub center: Vector3,
    /// Positive sphere radius in meters.
    pub radius: f32,
}

/// The asymmetric authored body shape consumed by grounded response.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundedBodySpheres {
    /// Required lower sphere; this sphere alone may support or choose the committed cell.
    pub support: GroundedSphere,
    /// Optional upper sphere; it constrains placement but never provides support.
    pub upper: Option<GroundedSphere>,
}

/// Retained walkable support selected by the grounded response.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GroundSupport {
    /// Authored outward-facing unit normal.
    pub normal: Vector3,
    /// Exact static owner product that proved this support.
    pub proof: super::CollisionOwnerProof,
}

#[cfg(test)]
impl GroundSupport {
    pub(crate) const fn fixture(normal: Vector3) -> Self {
        Self {
            normal,
            proof: CollisionOwnerProof::fixture(Guid(0xda55_ffff)),
        }
    }
}

/// The body's derived ground state, mirroring retail's observable transient combinations
/// (`CPhysicsObj::SetPositionInternal`, `acclient.c:310624-310760`).
///
/// This is the solver-owned source; the lifecycle-facing [`ContactState`](super::ContactState)
/// (which adds `Unknown`) is projected from it at the grounded tick commit and must never be
/// written back over a solved body (see `SpatialScene::apply_runtime_body_contact`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum GroundState {
    /// A contact plane at or above the walking threshold: retail `Contact && OnWalkable`.
    Supported(GroundSupport),
    /// A contact plane below the walking threshold: retail `Contact && !OnWalkable`. Gravity
    /// stays applied and no friction runs (`calc_acceleration` acclient.c:306176,
    /// `calc_friction` :304541); motion is ballistic with the plane retained for
    /// classification and reporting.
    Sliding(GroundSupport),
    /// No contact plane.
    Airborne,
}

impl GroundState {
    /// The walkable support plane, when the body is supported.
    pub fn walkable_support(self) -> Option<GroundSupport> {
        match self {
            Self::Supported(support) => Some(support),
            Self::Sliding(_) | Self::Airborne => None,
        }
    }

    /// The retained contact plane, walkable or sliding.
    pub fn contact_plane(self) -> Option<GroundSupport> {
        match self {
            Self::Supported(support) | Self::Sliding(support) => Some(support),
            Self::Airborne => None,
        }
    }

    /// The settle transaction a non-launching tick of this resolved state permits.
    ///
    /// Launch ticks and the not-yet-classified lifecycle state are owned by
    /// `grounded_settle_permission`, which projects from `ContactState`; this is the resolved
    /// counterpart every request builder over a solved body should use.
    pub fn settle_permission(self) -> SettlePermission {
        match self {
            Self::Supported(_) => SettlePermission::Walking,
            Self::Sliding(_) | Self::Airborne => SettlePermission::Landing,
        }
    }
}

/// Last safely committed grounded body state.
#[derive(Debug, Clone, PartialEq)]
pub struct GroundedBody {
    /// Current solved pose of the authored body reference point.
    pub pose: WorldPosition,
    /// Current interior cell, or `None` while outdoors.
    pub cell: Option<Guid>,
    /// Canonical full world-space linear velocity at the committed pose.
    pub velocity: Vector3,
    /// Derived ground state committed with `pose`.
    pub ground: GroundState,
}

/// One desired grounded-motion tick.
#[derive(Debug, Clone, PartialEq)]
pub struct GroundedRequest {
    /// Last safely committed body state.
    pub body: GroundedBody,
    /// Authored lower and optional upper sphere pair.
    pub spheres: GroundedBodySpheres,
    /// Finite world-space velocity used while supported; explicit controller drive is horizontal,
    /// while generic surface response may supply a full support-tangent vector.
    pub supported_velocity: Vector3,
    /// Which settle transaction this tick's contact state permits.
    pub settle: SettlePermission,
    /// Whether supported motion retains canonical velocity and gravity for retail Sledding.
    pub retain_supported_gravity: bool,
    /// Positive simulation interval in seconds.
    pub delta_seconds: f32,
    /// Body-owned optional collision-domain exclusions.
    pub filter: super::PhysicalCollisionFilter,
}

/// Which settle transaction retail's per-transition state permits.
///
/// Retail gates the ordinary walking step-down on the contact bit
/// (`CTransition::transitional_insert`, `acclient.c:301550-301599`) and prepares the lenient
/// 0.04m landing step-down for every other gravity-bound transition; a launch tick suppresses
/// both until the body has left the ground.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettlePermission {
    /// Launch tick: no settle transaction; only a direct walkable strike may reacquire ground.
    Denied,
    /// Airborne or sliding body: the lenient landing probe runs each tick.
    Landing,
    /// Walkable or not-yet-classified body: the full walking step-down transaction runs.
    Walking,
}

/// Which finite grounded-solver budget refused a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroundedBudget {
    /// The requested tick requires too many anti-tunneling substeps.
    Substeps,
}

/// Observable result of one grounded solve.
#[derive(Debug, Clone, PartialEq)]
pub enum GroundedOutcome {
    /// The tick completed and the latest finite body state was committed.
    Solved {
        /// New committed state.
        body: GroundedBody,
        /// Achieved world-space velocity derived from committed displacement.
        achieved_velocity: Vector3,
        /// Strongest unit contact normal opposing this tick's active velocity, if any.
        collision_normal: Option<Vector3>,
        /// Ordered accepted substep endpoints spanning the normalized solve interval.
        motion: Vec<MotionWaypoint>,
        /// Anti-tunneling substeps evaluated.
        substeps: usize,
        /// Contact passes evaluated across all substeps.
        contact_passes: usize,
        /// Distinct non-walkable planes encountered during this solve.
        constraint_count: usize,
        /// Whether the final committed body placement still intersects static environment geometry.
        residual_contacts: bool,
    },
    /// A finite safety budget was reached after committing the safe prefix it could evaluate.
    BudgetExceeded {
        /// Body state at the end of the evaluated safe prefix.
        body: GroundedBody,
        /// Achieved velocity across the full tick interval.
        achieved_velocity: Vector3,
        /// Strongest unit contact normal opposing this tick's active velocity, if any.
        collision_normal: Option<Vector3>,
        /// Evaluated motion followed by a stationary leg through the remainder of the tick.
        motion: Vec<MotionWaypoint>,
        /// Budget that stopped the solve.
        budget: GroundedBudget,
        /// Completed substeps before the stop.
        substeps: usize,
        /// Contact passes evaluated before the stop.
        contact_passes: usize,
        /// Distinct non-walkable planes encountered before the stop.
        constraint_count: usize,
        /// Whether the final committed body placement still intersects static geometry.
        residual_contacts: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SphereRole {
    Support,
    Upper,
}

#[derive(Debug)]
struct RoleContacts {
    role: SphereRole,
    contacts: Vec<GroundedObstruction>,
}

/// One tentative grounded move with its inseparable placement and obstruction facts.
struct MovementCandidate {
    center: Vector3,
    placement: SpatialMembership,
    contacts: Vec<RoleContacts>,
}

#[derive(Debug, Clone)]
struct SupportedPlacement {
    body_center: Vector3,
    placement: SpatialMembership,
    support: GroundSupport,
}

/// Result of one settle transaction (walking step-down or lenient landing).
#[derive(Debug, Clone)]
enum SettleResult {
    /// A face at or above the walking threshold accepted the candidate.
    Supported(SupportedPlacement),
    /// A face admitted by the lenient landing allowance but below the walking threshold
    /// accepted the candidate: retail `Contact && !OnWalkable`.
    Sliding(SupportedPlacement),
    /// Only a finite edge was reachable, so creature response must use precipice sliding.
    Edge { inward_normal: Vector3 },
    /// No admissible face or edge was reachable within the configured probe.
    Unsupported,
}

#[derive(Debug, Clone, Copy)]
struct GroundedSolveContext<'a> {
    scene: &'a CollisionScene,
    config: GroundedConfig,
    anchor: Guid,
    pose: WorldPosition,
    spheres: GroundedBodySpheres,
    /// Body-owned optional collision-domain exclusions.
    filter: super::PhysicalCollisionFilter,
}

/// Advances one bounded grounded tick.
pub fn solve_grounded(
    scene: &CollisionScene,
    config: GroundedConfig,
    request: GroundedRequest,
) -> Result<GroundedOutcome> {
    validate(config, &request)?;

    let anchor = landblock_key(request.body.pose.landblock_id);
    let start = request.body.pose.coords;
    let reference_pose = request.body.pose;
    let context = GroundedSolveContext {
        scene,
        config,
        anchor,
        pose: reference_pose,
        spheres: request.spheres,
        filter: request.filter,
    };
    let supported = request.body.ground.walkable_support().is_some();
    // Airborne and sliding bodies are ballistic: retail keeps gravity and skips friction for any
    // state other than `Contact && OnWalkable` (`acclient.c:306176`, `:304541`). Sledding
    // likewise retains canonical velocity while supported.
    let active_velocity = if supported && !request.retain_supported_gravity {
        request.supported_velocity
    } else {
        request.body.velocity
    };
    let accelerated = !supported || request.retain_supported_gravity;
    // Retail chooses whether to integrate position from the incoming velocity before applying
    // SmallVelocity (acclient.c:306114-306159). A small falling velocity still gets the
    // acceleration displacement; truncating it before this gate leaves 60 Hz bodies hovering.
    let had_velocity = active_velocity != Vector3::zero();
    let active_velocity = if !supported {
        super::physical_body::canonical_retained_velocity(active_velocity)
    } else {
        active_velocity
    };
    let vertical_displacement = if !(had_velocity || supported && request.retain_supported_gravity)
    {
        0.0
    } else if accelerated {
        active_velocity.z * request.delta_seconds
            + 0.5 * config.gravity * request.delta_seconds * request.delta_seconds
    } else {
        active_velocity.z * request.delta_seconds
    };
    // Authored walking contributes displacement, never physical momentum. Keep it out of
    // contact eligibility and the returned velocity even when this transition leaves support
    // (CPhysicsObj::UpdatePositionInternal, acclient.c:308275-308304).
    let physical_velocity = if supported {
        request.body.velocity
    } else {
        active_velocity
    };
    let next_velocity = if accelerated {
        physical_velocity + Vector3::new(0.0, 0.0, config.gravity * request.delta_seconds)
    } else {
        physical_velocity
    };

    // Retail checks the integrated physical velocity against the previous contact before
    // granting a transition contact/walkable state (check_contact, acclient.c:305016-305028;
    // get_object_info, :307403-307421). Otherwise outward momentum can skip friction forever
    // while support projection and walking step-down keep pinning the body to the slope.
    let releases_contact = request.body.ground.contact_plane().is_some_and(|support| {
        next_velocity.dot(&support.normal) > super::physical_body::RETAIL_PHYSICS_EPSILON
    });
    let (transition_ground, settle) = if releases_contact {
        let settle = match request.settle {
            SettlePermission::Walking => SettlePermission::Landing,
            other => other,
        };
        (GroundState::Airborne, settle)
    } else {
        (request.body.ground, request.settle)
    };
    let mut displacement = active_velocity * request.delta_seconds;
    displacement.z = vertical_displacement;
    if let Some(support) = transition_ground.walkable_support() {
        displacement = project_into_plane(displacement, support.normal);
    }
    // Retail updates velocity/rotation but skips the collision transition when the proposed
    // origin is unchanged (CPhysicsObj::UpdateObjectInternal, acclient.c:310864-310879).
    // In particular, a stationary gravity-free door must not acquire the floor below its pivot.
    if displacement == Vector3::zero() {
        let mut body = request.body;
        body.velocity = next_velocity;
        return Ok(GroundedOutcome::Solved {
            motion: vec![MotionWaypoint {
                center: start,
                end_fraction: 1.0,
                placement: super::collision::MotionWaypointPlacement::Committed(body.cell),
            }],
            body,
            achieved_velocity: Vector3::zero(),
            collision_normal: None,
            substeps: 0,
            contact_passes: 0,
            constraint_count: 0,
            residual_contacts: false,
        });
    }
    let distance = displacement.length();
    let required_substeps = if distance <= f32::EPSILON {
        1
    } else {
        (distance / config.maximum_substep_distance).ceil() as usize
    };
    let substep = displacement / required_substeps as f32;
    let evaluated_substeps = required_substeps.min(config.maximum_substeps);
    let mut body = request.body;
    body.velocity = next_velocity;
    body.ground = transition_ground;
    // Retail carries one collision normal into the next substep, then clears it before collision
    // is recomputed (`acclient.c:301897-301919`). Keeping an arbitrary plane set for the whole
    // solve wedges finite walls and stair risers long after their authored geometry has ended.
    let mut sliding_normal = None;
    // Diagnostics retain distinct planes encountered by this solve, but never feed motion.
    let mut encountered_constraints = Vec::new();
    let mut current = start;
    let mut motion = Vec::with_capacity(evaluated_substeps + 1);
    let mut contact_passes = 0;
    let mut collision_normal = None;

    'substeps: for completed_substeps in 0..evaluated_substeps {
        let prior_ground = body.ground;
        let prior_support = prior_ground.walkable_support();
        let mut constrained_substep = apply_sliding_normal(substep, sliding_normal.take());
        let MovementCandidate {
            center: mut candidate,
            placement: mut candidate_placement,
            contacts: mut role_contacts,
        } = movement_candidate(context, &body, current, constrained_substep)?;
        let mut contacted_walkable_support =
            has_walkable_support_contact(&role_contacts, config.walkable_normal_z);
        let mut lower_step_retried = false;

        for _ in 0..config.maximum_contact_passes {
            contact_passes += 1;
            contacted_walkable_support |=
                has_walkable_support_contact(&role_contacts, config.walkable_normal_z);
            if role_contacts.iter().all(|entry| entry.contacts.is_empty()) {
                break;
            }

            remember_collision_normal(&mut collision_normal, &role_contacts, active_velocity);

            let lower_blocked = role_contacts
                .iter()
                .any(|entry| entry.role == SphereRole::Support && !entry.contacts.is_empty());
            if lower_blocked
                && !lower_step_retried
                && body.ground.walkable_support().is_some()
                && config.step_up_height > 0.0
            {
                if let Some(stepped) = step_up_candidate(context, &body, current, candidate)? {
                    current = stepped.body_center;
                    body.cell = stepped.placement.committed_cell();
                    body.pose = pose_for_commit(
                        anchor,
                        current,
                        reference_pose,
                        stepped.placement.committed_cell(),
                    );
                    body.ground = GroundState::Supported(stepped.support);
                    motion.push(MotionWaypoint {
                        center: current,
                        end_fraction: (completed_substeps + 1) as f32 / required_substeps as f32,
                        placement: super::collision::MotionWaypointPlacement::Committed(body.cell),
                    });
                    continue 'substeps;
                }

                let mut retry_normal = None;
                remember_next_sliding_normal(
                    &mut retry_normal,
                    &role_contacts,
                    config.walkable_normal_z,
                    constrained_substep,
                );
                let retry_substep = apply_sliding_normal(constrained_substep, retry_normal);
                // Retail restores the pre-step pose before applying the lower collision normal,
                // then retries the transition (`CTransition::step_up` and
                // `BSPTREE::step_sphere_up`, acclient.c:301457-301489, :346436-346492). The
                // aggregate endpoint solver needs this ordering only when the failed trial also
                // selected another containing cell; ordinary same-cell walls retain radial
                // separation so their exact tangent remains stable.
                if candidate_placement.committed_cell() != body.cell
                    && retry_substep != constrained_substep
                {
                    remember_encountered_constraints(
                        &mut encountered_constraints,
                        &role_contacts,
                        config.walkable_normal_z,
                    );
                    sliding_normal = retry_normal;
                    lower_step_retried = true;
                    constrained_substep = retry_substep;
                    let retry = movement_candidate(context, &body, current, retry_substep)?;
                    candidate = retry.center;
                    candidate_placement = retry.placement;
                    role_contacts = retry.contacts;
                    continue;
                }
            }

            remember_encountered_constraints(
                &mut encountered_constraints,
                &role_contacts,
                config.walkable_normal_z,
            );
            remember_next_sliding_normal(
                &mut sliding_normal,
                &role_contacts,
                config.walkable_normal_z,
                constrained_substep,
            );
            let contacts = role_contacts
                .iter()
                .flat_map(|entry| {
                    entry.contacts.iter().map(|contact| StaticContact {
                        normal: contact.separation_normal,
                        depth: contact.depth,
                    })
                })
                .collect::<Vec<_>>();
            candidate = candidate + separating_displacement(&contacts, config.separation_epsilon);
            candidate_placement = transit_pair(
                scene,
                anchor,
                &body,
                reference_pose,
                request.spheres,
                candidate,
            )?;
            role_contacts = placement_contacts(
                scene,
                anchor,
                candidate,
                reference_pose,
                request.spheres,
                &candidate_placement,
                request.filter,
            )?;
            if role_contacts.iter().all(|entry| entry.contacts.is_empty()) {
                break;
            }
        }

        // RETAIL DIVERGENCE: Retail restores `check_pos` to `curr_pos` after an adjusted or slid
        // transition (`CTransition::validate_transition`, acclient.c:300941-300972), then lets the
        // outer substep loop continue (acclient.c:301938-301946). We retain the latest finite
        // corrected candidate instead. Restoring retail's hold behavior makes one WCID 1 body in
        // the representative 300-body census retry the same thin building-shell edge forever;
        // the representative 50-body census otherwise converged without this edge case.

        // Retail's zero-step transitional path rebuilds placement but does not run step-down
        // (`CTransition::find_transitional_position`, acclient.c:301820-301996). Reacquiring
        // support at rest makes adjacent authored faces alternately win at seams. Retain the
        // committed support only when neither collision response nor placement traversal moved
        // the body; both changes require ordinary support validation below.
        let stationary_support = prior_support.filter(|_| {
            constrained_substep.length_squared() <= f32::EPSILON
                && (candidate - current).length_squared() <= f32::EPSILON
                && body.cell == candidate_placement.committed_cell()
        });
        let settle_result = if let Some(support) = stationary_support {
            SettleResult::Supported(SupportedPlacement {
                body_center: current,
                placement: candidate_placement.clone(),
                support,
            })
        } else {
            match settle {
                // Retail reaches its ordinary step-down branch only while OBJECTINFO state
                // retains contact (`CTransition::transitional_insert`, acclient.c:301550-301599).
                // Running the full walking probe after `LeaveGround` snaps an upward launch back
                // to the floor.
                SettlePermission::Walking => {
                    step_down_candidate(context, &body, candidate, candidate_placement.clone())?
                }
                // A body without walkable support runs retail's lenient 0.04m landing step-down
                // every transition (`acclient.c:301563-301569`).
                SettlePermission::Landing => {
                    landing_candidate(context, &body, candidate, candidate_placement.clone())?
                }
                SettlePermission::Denied if contacted_walkable_support => {
                    // A launch sweep that actually struck a walkable lower contact may acquire
                    // that exact surface, but it does not inherit any step-down reach.
                    settle_candidate(
                        context,
                        &body,
                        candidate,
                        candidate_placement.clone(),
                        config.separation_epsilon * 2.0,
                        config.walkable_normal_z,
                    )?
                }
                SettlePermission::Denied => SettleResult::Unsupported,
            }
        };
        match settle_result {
            SettleResult::Supported(settled) => {
                remember_support_collision_normal(
                    &mut collision_normal,
                    settled.support.normal,
                    active_velocity,
                );
                candidate = settled.body_center;
                candidate_placement = settled.placement;
                body.ground = GroundState::Supported(settled.support);
            }
            SettleResult::Sliding(settled) => {
                candidate = settled.body_center;
                candidate_placement = settled.placement;
                body.ground = GroundState::Sliding(settled.support);
            }
            result @ (SettleResult::Edge { .. } | SettleResult::Unsupported)
                if config.edge_protection == EdgeProtection::Creature =>
            {
                // Retail restores both the saved check position and saved cell before precipice
                // response (`CTransition::edge_slide`, acclient.c:301354-301440). Rolling back the
                // whole candidate keeps protection independent of whether this substep happened
                // to cross a portal before support failed. Because the protected body holds at
                // its walkable pose, it stays `OnWalkable` and the lenient landing threshold can
                // never reach it — matching retail's threshold selection by that same state.
                if let Some(prior_support) = prior_support {
                    let inward_normal = match result {
                        SettleResult::Edge { inward_normal } => Some(inward_normal),
                        SettleResult::Unsupported => None,
                        SettleResult::Supported(_) | SettleResult::Sliding(_) => unreachable!(),
                    };
                    match edge_slide_candidate(
                        context,
                        &body,
                        current,
                        constrained_substep,
                        inward_normal,
                    )? {
                        Some(slid) => {
                            candidate = slid.body_center;
                            candidate_placement = slid.placement;
                            body.ground = GroundState::Supported(slid.support);
                        }
                        None => {
                            candidate = current;
                            candidate_placement = transit_pair(
                                scene,
                                anchor,
                                &body,
                                reference_pose,
                                request.spheres,
                                current,
                            )?;
                            body.ground = GroundState::Supported(prior_support);
                        }
                    }
                } else {
                    body.ground = GroundState::Airborne;
                }
            }
            SettleResult::Edge { .. } | SettleResult::Unsupported => {
                // Retail selects the walkable allowance at transition entry, so a failed walking
                // step-down ends with an invalid contact plane and a cleared contact bit
                // (`CPhysicsObj::SetPositionInternal`, acclient.c:310697-310719); the lenient
                // landing rules apply only from the next transition. A crest walk-off therefore
                // passes through a brief genuine airborne gap before the slide acquires.
                body.ground = GroundState::Airborne;
            }
        }

        current = candidate;
        body.cell = candidate_placement.committed_cell();
        body.pose = pose_for_commit(
            anchor,
            current,
            reference_pose,
            candidate_placement.committed_cell(),
        );
        motion.push(MotionWaypoint {
            center: current,
            end_fraction: (completed_substeps + 1) as f32 / required_substeps as f32,
            placement: super::collision::MotionWaypointPlacement::Committed(body.cell),
        });
    }

    let final_placement = transit_pair(
        scene,
        anchor,
        &body,
        reference_pose,
        request.spheres,
        current,
    )?;
    let residual_contacts = placement_contacts(
        scene,
        anchor,
        current,
        reference_pose,
        request.spheres,
        &final_placement,
        request.filter,
    )?
    .iter()
    .any(|entry| !entry.contacts.is_empty());
    let achieved_velocity = (current - start) / request.delta_seconds;
    if evaluated_substeps < required_substeps {
        motion.push(MotionWaypoint {
            center: current,
            end_fraction: 1.0,
            placement: super::collision::MotionWaypointPlacement::Committed(body.cell),
        });
        Ok(GroundedOutcome::BudgetExceeded {
            achieved_velocity,
            collision_normal,
            body,
            motion,
            budget: GroundedBudget::Substeps,
            substeps: evaluated_substeps,
            contact_passes,
            constraint_count: encountered_constraints.len(),
            residual_contacts,
        })
    } else {
        Ok(GroundedOutcome::Solved {
            achieved_velocity,
            collision_normal,
            body,
            motion,
            substeps: required_substeps,
            contact_passes,
            constraint_count: encountered_constraints.len(),
            residual_contacts,
        })
    }
}

fn remember_collision_normal(
    selected: &mut Option<Vector3>,
    contacts: &[RoleContacts],
    active_velocity: Vector3,
) {
    for contact in contacts.iter().flat_map(|entry| &entry.contacts) {
        remember_support_collision_normal(selected, contact.response_normal, active_velocity);
    }
}

fn has_walkable_support_contact(contacts: &[RoleContacts], walkable_normal_z: f32) -> bool {
    contacts.iter().any(|entry| {
        entry.role == SphereRole::Support
            && entry
                .contacts
                .iter()
                .any(|contact| contact.response_normal.z >= walkable_normal_z)
    })
}

fn remember_support_collision_normal(
    selected: &mut Option<Vector3>,
    normal: Vector3,
    active_velocity: Vector3,
) {
    let length_squared = normal.length_squared();
    if length_squared <= f32::EPSILON || !length_squared.is_finite() {
        return;
    }
    let normal = normal / length_squared.sqrt();
    let opposition = active_velocity.dot(&normal);
    if opposition >= 0.0 {
        return;
    }
    if selected.is_none_or(|current| opposition < active_velocity.dot(&current)) {
        *selected = Some(normal);
    }
}

/// `candidate_placement` must be the transit placement for `candidate`; every caller already
/// holds it, so the settle transaction does not repeat that query.
fn settle_candidate(
    context: GroundedSolveContext<'_>,
    body: &GroundedBody,
    candidate: Vector3,
    candidate_placement: SpatialMembership,
    maximum_drop: f32,
    acceptance_normal_z: f32,
) -> Result<SettleResult> {
    // Retail lowers the complete candidate body, invalidates its CELLARRAY, and rebuilds that
    // collision-domain set before evaluating walkable surfaces (`CTransition::step_down`,
    // acclient.c:301354-301437). The vertical transaction must retain the candidate domains as
    // well: an upper sphere can expose outdoor terrain before the lowered endpoint reaches it.
    let lowered = candidate - Vector3::new(0.0, 0.0, maximum_drop);
    let lowered_placement = transit_pair(
        context.scene,
        context.anchor,
        body,
        context.pose,
        context.spheres,
        lowered,
    )?;
    let support_placement = candidate_placement.clone().merge_reached(lowered_placement);
    let support_center = sphere_center(candidate, context.pose, context.spheres.support);
    let supports = context.scene.support_contacts(SupportRequest {
        anchor: context.anchor,
        center: support_center,
        radius: context.spheres.support.radius,
        maximum_drop,
        // Retail accepts negative `walk_interp` only down to -0.1 during step-down.
        maximum_rise: maximum_drop * 0.1,
        placement: &support_placement,
    })?;
    let mut surface: Option<SupportContact> = None;
    let mut edge: Option<SupportContact> = None;
    for support in supports
        .into_iter()
        .filter(|contact| contact.normal.z >= acceptance_normal_z)
    {
        match support.feature {
            SupportFeature::Surface
                if surface
                    .as_ref()
                    .is_none_or(|current| support.height_delta > current.height_delta) =>
            {
                surface = Some(support);
            }
            SupportFeature::Edge { .. }
                if edge
                    .as_ref()
                    .is_none_or(|current| support.height_delta > current.height_delta) =>
            {
                edge = Some(support);
            }
            _ => {}
        }
    }
    let Some(support) = surface else {
        return Ok(match edge {
            Some(support) => {
                let SupportFeature::Edge { inward_normal } = support.feature else {
                    unreachable!();
                };
                SettleResult::Edge { inward_normal }
            }
            None => SettleResult::Unsupported,
        });
    };
    let settled = candidate + Vector3::new(0.0, 0.0, support.height_delta);
    let settled_cells = transit_pair(
        context.scene,
        context.anchor,
        body,
        context.pose,
        context.spheres,
        settled,
    )?;
    let confirmation = placement_contacts(
        context.scene,
        context.anchor,
        settled,
        context.pose,
        context.spheres,
        &settled_cells,
        context.filter,
    )?;
    if confirmation.iter().any(|entry| !entry.contacts.is_empty()) {
        // Retail's single mutable step-down transaction can retain horizontal progress while a
        // reached lower face is still momentarily occluded by the finite edge being left. Preserve
        // that bridge at the candidate elevation only when the same bounded query proved a real
        // surface below. Edge reach by itself must not become ratcheting support.
        if let Some(edge) = edge {
            return Ok(classified_settle(
                context,
                SupportedPlacement {
                    body_center: candidate,
                    placement: candidate_placement,
                    support: GroundSupport {
                        normal: edge.normal,
                        proof: edge.proof,
                    },
                },
            ));
        }
        return Ok(SettleResult::Unsupported);
    }
    Ok(classified_settle(
        context,
        SupportedPlacement {
            body_center: settled,
            placement: settled_cells,
            support: GroundSupport {
                normal: support.normal,
                proof: support.proof,
            },
        },
    ))
}

/// Classifies an accepted settle by the walking threshold, mirroring retail's `OnWalkable`
/// derivation from the committed contact plane (`acclient.c:310712-310717`).
fn classified_settle(
    context: GroundedSolveContext<'_>,
    settled: SupportedPlacement,
) -> SettleResult {
    if settled.support.normal.z >= context.config.walkable_normal_z {
        SettleResult::Supported(settled)
    } else {
        SettleResult::Sliding(settled)
    }
}

/// Retail's lenient landing step-down for a body without walkable support: 0.04m reach, cos-85°
/// acceptance (`acclient.c:301563-301569`), classified against the walking threshold.
fn landing_candidate(
    context: GroundedSolveContext<'_>,
    body: &GroundedBody,
    candidate: Vector3,
    candidate_placement: SpatialMembership,
) -> Result<SettleResult> {
    settle_candidate(
        context,
        body,
        candidate,
        candidate_placement,
        context.config.airborne_step_down_height,
        context.config.landing_normal_z,
    )
}

fn step_up_candidate(
    context: GroundedSolveContext<'_>,
    body: &GroundedBody,
    current: Vector3,
    candidate: Vector3,
) -> Result<Option<SupportedPlacement>> {
    let raised = candidate + Vector3::new(0.0, 0.0, context.config.step_up_height);
    let raised_placement = transit_pair(
        context.scene,
        context.anchor,
        body,
        context.pose,
        context.spheres,
        raised,
    )?;
    match settle_candidate(
        context,
        body,
        raised,
        raised_placement,
        context.config.step_up_height,
        context.config.walkable_normal_z,
    )? {
        SettleResult::Supported(stepped)
            if stepped.body_center.z - current.z
                <= context.config.step_up_height + context.config.separation_epsilon =>
        {
            Ok(Some(stepped))
        }
        _ => Ok(None),
    }
}

fn step_down_candidate(
    context: GroundedSolveContext<'_>,
    body: &GroundedBody,
    candidate: Vector3,
    candidate_placement: SpatialMembership,
) -> Result<SettleResult> {
    settle_candidate(
        context,
        body,
        candidate,
        candidate_placement,
        context.config.step_down_height,
        context.config.walkable_normal_z,
    )
}

/// Applies retail's precipice ordering after the ordinary step-down path found no support
/// (`acclient.c:301550-301599`).
fn edge_slide_candidate(
    context: GroundedSolveContext<'_>,
    body: &GroundedBody,
    current: Vector3,
    requested_substep: Vector3,
    inward_normal: Option<Vector3>,
) -> Result<Option<SupportedPlacement>> {
    let Some(inward_normal) = inward_normal else {
        return Ok(None);
    };
    let edge_slide = project_into_plane(requested_substep, inward_normal);
    if edge_slide.length_squared() <= f32::EPSILON {
        return Ok(None);
    }
    let slid = current + edge_slide;
    let slid_placement = transit_pair(
        context.scene,
        context.anchor,
        body,
        context.pose,
        context.spheres,
        slid,
    )?;
    match settle_candidate(
        context,
        body,
        slid,
        slid_placement,
        context.config.step_down_height,
        context.config.walkable_normal_z,
    )? {
        SettleResult::Supported(settled) => Ok(Some(settled)),
        _ => Ok(None),
    }
}

fn movement_candidate(
    context: GroundedSolveContext<'_>,
    body: &GroundedBody,
    current: Vector3,
    displacement: Vector3,
) -> Result<MovementCandidate> {
    let center = current + displacement;
    let placement = transit_pair(
        context.scene,
        context.anchor,
        body,
        context.pose,
        context.spheres,
        center,
    )?;
    let contacts = movement_contacts(context, current, center, &placement)?;
    Ok(MovementCandidate {
        center,
        placement,
        contacts,
    })
}

fn movement_contacts(
    context: GroundedSolveContext<'_>,
    body_start: Vector3,
    body_end: Vector3,
    placement: &SpatialMembership,
) -> Result<Vec<RoleContacts>> {
    let mut result = Vec::new();
    for (role, sphere) in role_spheres(context.spheres) {
        let offset = context.pose.rotation.rotate_vector(sphere.center);
        let contacts = context
            .scene
            .grounded_obstructions(GroundedObstructionRequest {
                sweep: SphereSweep {
                    anchor: context.anchor,
                    start: body_start + offset,
                    end: body_end + offset,
                    radius: sphere.radius,
                },
                placement,
            })?;
        result.push(RoleContacts { role, contacts });
    }
    // Retail derives `global_low_point` from SPHEREPATH sphere zero and performs the whole-water
    // test once (`SPHEREPATH::init_sphere`, `CLandCell::find_env_collisions`, acclient.c:
    // 302242-302291, 340351-340399). Upper body spheres must not independently select a barrier.
    let support_offset = context
        .pose
        .rotation
        .rotate_vector(context.spheres.support.center);
    let restrictions = context
        .scene
        .movement_restrictions(MovementRestrictionRequest {
            sweep: SphereSweep {
                anchor: context.anchor,
                start: body_start + support_offset,
                end: body_end + support_offset,
                radius: context.spheres.support.radius,
            },
            placement,
            filter: context.filter,
        })?;
    result[0]
        .contacts
        .extend(restrictions.into_iter().map(static_grounded_obstruction));
    Ok(result)
}

fn placement_contacts(
    scene: &CollisionScene,
    anchor: Guid,
    body_center: Vector3,
    pose: WorldPosition,
    spheres: GroundedBodySpheres,
    placement: &SpatialMembership,
    filter: super::PhysicalCollisionFilter,
) -> Result<Vec<RoleContacts>> {
    let mut result = Vec::new();
    for (role, sphere) in role_spheres(spheres) {
        let contacts = scene
            .placement_contacts(PlacementRequest {
                anchor,
                center: sphere_center(body_center, pose, sphere),
                radius: sphere.radius,
                placement,
            })?
            .into_iter()
            .map(static_grounded_obstruction)
            .collect();
        result.push(RoleContacts { role, contacts });
    }
    let support_center = sphere_center(body_center, pose, spheres.support);
    let restrictions = scene.placement_restrictions(PlacementRestrictionRequest {
        anchor,
        center: support_center,
        radius: spheres.support.radius,
        placement,
        filter,
    })?;
    result[0]
        .contacts
        .extend(restrictions.into_iter().map(static_grounded_obstruction));
    Ok(result)
}

fn static_grounded_obstruction(contact: StaticContact) -> GroundedObstruction {
    GroundedObstruction {
        separation_normal: contact.normal,
        response_normal: contact.normal,
        depth: contact.depth,
    }
}

fn remember_encountered_constraints(
    encountered: &mut Vec<Vector3>,
    contacts: &[RoleContacts],
    walkable_normal_z: f32,
) {
    for entry in contacts {
        for contact in &entry.contacts {
            if entry.role == SphereRole::Support && contact.response_normal.z >= walkable_normal_z {
                continue;
            }
            if !encountered
                .iter()
                .any(|normal| normal.dot(&contact.response_normal) > 0.999)
            {
                encountered.push(contact.response_normal);
            }
        }
    }
}

/// Selects the one obstruction normal that may redirect the next substep.
///
/// Retail exposes one `sliding_normal`, not a persistent manifold. When one collision pass sees
/// several planes, the most opposing plane is the deterministic equivalent for this aggregate
/// contact query; simultaneous penetration is still resolved from every contact above.
fn remember_next_sliding_normal(
    sliding_normal: &mut Option<Vector3>,
    contacts: &[RoleContacts],
    walkable_normal_z: f32,
    displacement: Vector3,
) {
    for entry in contacts {
        for contact in &entry.contacts {
            if entry.role == SphereRole::Support && contact.response_normal.z >= walkable_normal_z {
                continue;
            }
            let Some(response_normal) = horizontal_response_normal(contact.response_normal) else {
                continue;
            };
            let opposition = displacement.dot(&response_normal);
            if opposition > 0.0 {
                continue;
            }
            if sliding_normal.is_none_or(|current| opposition < displacement.dot(&current)) {
                *sliding_normal = Some(response_normal);
            }
        }
    }
}

/// Reproduces retail's horizontal-only durable sliding normal (`acclient.c:300478-300493`).
fn horizontal_response_normal(normal: Vector3) -> Option<Vector3> {
    const RETAIL_VECTOR_EPSILON: f32 = 0.000_2;

    let horizontal = Vector3::new(normal.x, normal.y, 0.0);
    (horizontal.length() >= RETAIL_VECTOR_EPSILON).then(|| horizontal.normalize())
}

fn apply_sliding_normal(displacement: Vector3, sliding_normal: Option<Vector3>) -> Vector3 {
    match sliding_normal {
        Some(normal) if displacement.dot(&normal) < 0.0 => project_into_plane(displacement, normal),
        _ => displacement,
    }
}

fn project_into_plane(vector: Vector3, normal: Vector3) -> Vector3 {
    vector - normal * vector.dot(&normal)
}

#[cfg(test)]
#[path = "grounded_retail_differential.rs"]
mod retail_differential;

#[cfg(test)]
#[path = "grounded_landing_retail_differential.rs"]
mod landing_retail_differential;

fn transit_pair(
    scene: &CollisionScene,
    anchor: Guid,
    body: &GroundedBody,
    pose: WorldPosition,
    spheres: GroundedBodySpheres,
    body_center: Vector3,
) -> Result<SpatialMembership> {
    let lower = scene.transit_cell(CellTransitRequest {
        previous_cell: body.cell,
        anchor,
        center: sphere_center(body_center, pose, spheres.support),
        radius: spheres.support.radius,
    })?;
    let placement = if let Some(upper) = spheres.upper {
        lower.merge_reached(scene.transit_cell(CellTransitRequest {
            previous_cell: body.cell,
            anchor,
            center: sphere_center(body_center, pose, upper),
            radius: upper.radius,
        })?)
    } else {
        lower
    };
    Ok(placement)
}

fn sphere_center(body_center: Vector3, pose: WorldPosition, sphere: GroundedSphere) -> Vector3 {
    body_center + pose.rotation.rotate_vector(sphere.center)
}

fn sphere_entries(spheres: GroundedBodySpheres) -> impl Iterator<Item = GroundedSphere> {
    std::iter::once(spheres.support).chain(spheres.upper)
}

fn role_spheres(
    spheres: GroundedBodySpheres,
) -> impl Iterator<Item = (SphereRole, GroundedSphere)> {
    std::iter::once((SphereRole::Support, spheres.support))
        .chain(spheres.upper.map(|sphere| (SphereRole::Upper, sphere)))
}

fn pose_for_commit(
    anchor: Guid,
    point: Vector3,
    original: WorldPosition,
    cell: Option<Guid>,
) -> WorldPosition {
    cell.map_or_else(
        || anchor_point_to_outdoor_position(anchor, point, original.rotation),
        |cell| anchor_point_to_cell_position(anchor, point, cell, original.rotation),
    )
}

fn validate(config: GroundedConfig, request: &GroundedRequest) -> Result<()> {
    for sphere in sphere_entries(request.spheres) {
        ensure!(
            sphere.radius.is_finite() && sphere.radius > 0.0,
            "grounded sphere radius must be finite and positive"
        );
        ensure!(
            sphere.center.x.is_finite()
                && sphere.center.y.is_finite()
                && sphere.center.z.is_finite(),
            "grounded sphere center must be finite"
        );
    }
    ensure!(
        request.supported_velocity.x.is_finite()
            && request.supported_velocity.y.is_finite()
            && request.supported_velocity.z.is_finite(),
        "grounded supported velocity must be finite"
    );
    ensure!(
        request.body.velocity.x.is_finite()
            && request.body.velocity.y.is_finite()
            && request.body.velocity.z.is_finite(),
        "grounded body velocity must be finite"
    );
    ensure!(
        request.delta_seconds.is_finite() && request.delta_seconds > 0.0,
        "grounded delta seconds must be finite and positive"
    );
    ensure!(
        config.gravity.is_finite() && config.gravity <= 0.0,
        "grounded gravity must be finite and non-positive"
    );
    ensure!(
        config.walkable_normal_z.is_finite()
            && config.walkable_normal_z > 0.0
            && config.walkable_normal_z <= 1.0,
        "grounded walkable normal threshold must be in (0, 1]"
    );
    ensure!(
        config.step_up_height.is_finite() && config.step_up_height >= 0.0,
        "grounded step-up height must be finite and non-negative"
    );
    ensure!(
        config.step_down_height.is_finite() && config.step_down_height >= 0.0,
        "grounded step-down height must be finite and non-negative"
    );
    ensure!(
        config.maximum_substep_distance.is_finite() && config.maximum_substep_distance > 0.0,
        "grounded maximum substep distance must be finite and positive"
    );
    ensure!(
        config.maximum_substeps > 0,
        "grounded solve requires at least one substep"
    );
    ensure!(
        config.maximum_contact_passes > 0,
        "grounded solve requires at least one contact pass"
    );
    ensure!(
        config.separation_epsilon.is_finite() && config.separation_epsilon > 0.0,
        "grounded separation epsilon must be finite and positive"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use holtburger_common::{Plane, Quaternion, Sphere};
    use holtburger_content::{
        BspSolid, CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale,
        CollisionBox, CollisionPolygon, CollisionShape, LandblockColliders,
        LandblockCollisionAsset, LandblockPlacement, LandblockTerrain, PlacedCollider,
        StaticColliderPlacement, TerrainCellDiagonals, TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode};

    use super::*;
    use crate::{
        ContactState, GroundedBodyActuation, PhysicalBodyActuation, PhysicalBodyDefinition,
        PhysicalBodyResponsePolicy, PhysicalBodyResponseState, PhysicalCollisionFilter,
        PhysicalElasticity, PhysicalFriction, PhysicalRestitution, PhysicalSphereSet,
        PhysicalSurfaceMotion, SpatialScene,
    };

    const LANDBLOCK: u32 = 0xda55_ffff;
    const EAST: u32 = 0xdb55_ffff;
    const EPSILON: f32 = 0.003;

    fn config() -> GroundedConfig {
        GroundedConfig {
            gravity: -9.8,
            walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
            landing_normal_z: RETAIL_LANDING_NORMAL_Z,
            airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
            step_up_height: 0.6,
            step_down_height: 0.2,
            edge_protection: EdgeProtection::None,
            maximum_substep_distance: 0.25,
            maximum_substeps: 128,
            maximum_contact_passes: 8,
            separation_epsilon: 0.000_5,
        }
    }

    fn pose(coords: Vector3) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(LANDBLOCK),
            coords,
            rotation: Quaternion::identity(),
        }
        .normalize_outdoor_cell()
    }

    fn lower_sphere() -> GroundedSphere {
        GroundedSphere {
            center: Vector3::new(0.0, 0.0, 0.5),
            radius: 0.5,
        }
    }

    fn pair() -> GroundedBodySpheres {
        GroundedBodySpheres {
            support: lower_sphere(),
            upper: Some(GroundedSphere {
                center: Vector3::new(0.0, 0.0, 2.0),
                radius: 0.5,
            }),
        }
    }

    fn close_pair() -> GroundedBodySpheres {
        GroundedBodySpheres {
            support: GroundedSphere {
                center: Vector3::new(0.0, 0.0, 0.475),
                radius: 0.48,
            },
            upper: Some(GroundedSphere {
                center: Vector3::new(0.0, 0.0, 1.35),
                radius: 0.48,
            }),
        }
    }

    fn body(coords: Vector3, support: Option<Vector3>) -> GroundedBody {
        GroundedBody {
            pose: pose(coords),
            cell: None,
            velocity: Vector3::zero(),
            ground: match support {
                Some(normal) => GroundState::Supported(GroundSupport {
                    normal,
                    proof: CollisionOwnerProof::fixture(Guid(LANDBLOCK)),
                }),
                None => GroundState::Airborne,
            },
        }
    }

    fn polygon(id: u16, vertices: Vec<Vector3>, normal: Vector3, bounds: Sphere) -> PlacedCollider {
        let d = -normal.dot(&vertices[0]);
        let box_bounds = CollisionBox::from_points(vertices.iter().copied()).unwrap();
        let shape = Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: BspNode::Leaf(BspLeaf {
                index: 0,
                solid: 0,
                sphere: Some(bounds),
                poly_ids: vec![id],
            }),
            bounds,
            box_bounds,
            polygons: HashMap::from([(
                id,
                CollisionPolygon {
                    vertices,
                    normal,
                    d,
                },
            )]),
        }));
        PlacedCollider {
            geometry: holtburger_content::PlacedCollisionShape {
                shape,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                scale: ColliderScale::uniform(1.0).unwrap(),
                bounds: box_bounds,
            },
            source_placement: StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        }
    }

    fn floor() -> PlacedCollider {
        floor_region(1, 0.0, 192.0)
    }

    fn floor_region(id: u16, minimum_x: f32, maximum_x: f32) -> PlacedCollider {
        polygon(
            id,
            vec![
                Vector3::new(minimum_x, 0.0, 0.0),
                Vector3::new(maximum_x, 0.0, 0.0),
                Vector3::new(maximum_x, 192.0, 0.0),
                Vector3::new(minimum_x, 192.0, 0.0),
            ],
            Vector3::new(0.0, 0.0, 1.0),
            Sphere {
                center: Vector3::new((minimum_x + maximum_x) * 0.5, 96.0, 0.0),
                radius: 192.0,
            },
        )
    }

    fn ceiling(id: u16, z: f32) -> PlacedCollider {
        polygon(
            id,
            vec![
                Vector3::new(0.0, 0.0, z),
                Vector3::new(0.0, 192.0, z),
                Vector3::new(192.0, 192.0, z),
                Vector3::new(192.0, 0.0, z),
            ],
            Vector3::new(0.0, 0.0, -1.0),
            Sphere {
                center: Vector3::new(96.0, 96.0, z),
                radius: 192.0,
            },
        )
    }

    fn wall_x(id: u16, x: f32, minimum_z: f32, maximum_z: f32) -> PlacedCollider {
        wall_x_region(id, x, 0.0, 192.0, minimum_z, maximum_z)
    }

    fn wall_x_region(
        id: u16,
        x: f32,
        minimum_y: f32,
        maximum_y: f32,
        minimum_z: f32,
        maximum_z: f32,
    ) -> PlacedCollider {
        let middle_z = (minimum_z + maximum_z) * 0.5;
        polygon(
            id,
            vec![
                Vector3::new(x, minimum_y, minimum_z),
                Vector3::new(x, minimum_y, maximum_z),
                Vector3::new(x, maximum_y, maximum_z),
                Vector3::new(x, maximum_y, minimum_z),
            ],
            Vector3::new(-1.0, 0.0, 0.0),
            Sphere {
                center: Vector3::new(x, (minimum_y + maximum_y) * 0.5, middle_z),
                radius: Vector3::new(
                    0.0,
                    (maximum_y - minimum_y) * 0.5,
                    (maximum_z - minimum_z) * 0.5,
                )
                .length(),
            },
        )
    }

    fn wall_y(id: u16, y: f32, minimum_z: f32, maximum_z: f32) -> PlacedCollider {
        let middle_z = (minimum_z + maximum_z) * 0.5;
        polygon(
            id,
            vec![
                Vector3::new(192.0, y, minimum_z),
                Vector3::new(192.0, y, maximum_z),
                Vector3::new(0.0, y, maximum_z),
                Vector3::new(0.0, y, minimum_z),
            ],
            Vector3::new(0.0, -1.0, 0.0),
            Sphere {
                center: Vector3::new(96.0, y, middle_z),
                radius: 97.0,
            },
        )
    }

    fn wall_segment(
        id: u16,
        start: Vector3,
        end: Vector3,
        minimum_z: f32,
        maximum_z: f32,
    ) -> PlacedCollider {
        let tangent = end - start;
        let normal = Vector3::new(-tangent.y, tangent.x, 0.0).normalize();
        let center = (start + end) * 0.5 + Vector3::new(0.0, 0.0, (minimum_z + maximum_z) * 0.5);
        polygon(
            id,
            vec![
                Vector3::new(start.x, start.y, minimum_z),
                Vector3::new(start.x, start.y, maximum_z),
                Vector3::new(end.x, end.y, maximum_z),
                Vector3::new(end.x, end.y, minimum_z),
            ],
            normal,
            Sphere {
                center,
                radius: Vector3::new(
                    tangent.x * 0.5,
                    tangent.y * 0.5,
                    (maximum_z - minimum_z) * 0.5,
                )
                .length(),
            },
        )
    }

    fn box_obstacle(first_id: u16, x0: f32, x1: f32, height: f32) -> Vec<PlacedCollider> {
        vec![
            wall_x(first_id, x0, 0.0, height),
            polygon(
                first_id + 1,
                vec![
                    Vector3::new(x0, 0.0, height),
                    Vector3::new(x1, 0.0, height),
                    Vector3::new(x1, 192.0, height),
                    Vector3::new(x0, 192.0, height),
                ],
                Vector3::new(0.0, 0.0, 1.0),
                Sphere {
                    center: Vector3::new((x0 + x1) * 0.5, 96.0, height),
                    radius: 97.0,
                },
            ),
        ]
    }

    fn ramp(id: u16, x0: f32, x1: f32, y0: f32, y1: f32, rise: f32) -> PlacedCollider {
        let run = x1 - x0;
        let normal = Vector3::new(-rise / run, 0.0, 1.0).normalize();
        polygon(
            id,
            vec![
                Vector3::new(x0, y0, 0.0),
                Vector3::new(x1, y0, rise),
                Vector3::new(x1, y1, rise),
                Vector3::new(x0, y1, 0.0),
            ],
            normal,
            Sphere {
                center: Vector3::new((x0 + x1) * 0.5, (y0 + y1) * 0.5, rise * 0.5),
                radius: 30.0,
            },
        )
    }

    fn thin_sloped_shell_edge() -> Vec<PlacedCollider> {
        let bounds = Sphere {
            center: Vector3::new(41.745, 119.25, 23.25),
            radius: 6.0,
        };
        vec![
            polygon(
                1,
                vec![
                    Vector3::new(37.12, 119.75, 22.8),
                    Vector3::new(46.87, 119.75, 22.8),
                    Vector3::new(47.37, 119.25, 22.65),
                ],
                Vector3::new(0.0, 0.287348, -0.957826),
                bounds,
            ),
            polygon(
                2,
                vec![
                    Vector3::new(47.37, 119.25, 23.0),
                    Vector3::new(46.87, 119.75, 22.8),
                    Vector3::new(37.12, 119.75, 22.8),
                    Vector3::new(36.12, 118.75, 23.2),
                    Vector3::new(36.12, 116.75, 24.0),
                    Vector3::new(44.87, 116.75, 24.0),
                ],
                Vector3::new(0.0, 0.371391, 0.928477),
                bounds,
            ),
        ]
    }

    fn scene(colliders: Vec<PlacedCollider>) -> CollisionScene {
        let mut scene = CollisionScene::new();
        insert_test_coverage_neighborhood(&mut scene, &[LANDBLOCK]);
        scene
            .insert(artifact(LANDBLOCK, colliders, Vec::new()))
            .unwrap();
        scene
    }

    fn test_coverage_neighborhood_owners(touched: &[u32]) -> Vec<u32> {
        let mut owners = Vec::new();
        for owner in touched {
            let x = ((owner >> 24) & 0xff) as i32;
            let y = ((owner >> 16) & 0xff) as i32;
            for offset_x in -1..=1 {
                for offset_y in -1..=1 {
                    owners.push(
                        (((x + offset_x) as u32) << 24) | (((y + offset_y) as u32) << 16) | 0xffff,
                    );
                }
            }
        }
        owners.sort_unstable();
        owners.dedup();
        owners
    }

    fn insert_test_coverage_neighborhood(scene: &mut CollisionScene, touched: &[u32]) {
        for owner in test_coverage_neighborhood_owners(touched) {
            scene
                .insert(artifact(owner, Vec::new(), Vec::new()))
                .unwrap();
        }
    }

    fn artifact(
        landblock_id: u32,
        colliders: Vec<PlacedCollider>,
        cell_volumes: Vec<holtburger_content::CellVolume>,
    ) -> LandblockCollisionAsset {
        LandblockCollisionAsset {
            landblock_id,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::new(colliders, cell_volumes),
        }
    }

    fn solve(
        scene: &CollisionScene,
        body: GroundedBody,
        spheres: GroundedBodySpheres,
        supported_velocity: Vector3,
        delta_seconds: f32,
    ) -> GroundedOutcome {
        solve_with_config(
            scene,
            config(),
            body,
            spheres,
            supported_velocity,
            delta_seconds,
        )
    }

    fn solve_with_config(
        scene: &CollisionScene,
        config: GroundedConfig,
        body: GroundedBody,
        spheres: GroundedBodySpheres,
        supported_velocity: Vector3,
        delta_seconds: f32,
    ) -> GroundedOutcome {
        let settle = body.ground.settle_permission();
        solve_grounded(
            scene,
            config,
            GroundedRequest {
                body,
                spheres,
                supported_velocity,
                settle,
                retain_supported_gravity: false,
                delta_seconds,
                filter: crate::PhysicalCollisionFilter::ALL,
            },
        )
        .unwrap()
    }

    #[test]
    fn substep_budget_commits_the_evaluated_grounded_prefix() {
        let mut limited = config();
        limited.gravity = 0.0;
        limited.maximum_substeps = 2;
        let mut original = body(Vector3::new(20.0, 20.0, 5.0), None);
        original.velocity = Vector3::new(10.0, 0.0, 0.0);

        let outcome = solve_with_config(
            &scene(Vec::new()),
            limited,
            original,
            pair(),
            Vector3::zero(),
            1.0,
        );
        let GroundedOutcome::BudgetExceeded {
            body,
            achieved_velocity,
            motion,
            budget,
            substeps,
            ..
        } = outcome
        else {
            panic!("oversized grounded solve unexpectedly completed")
        };
        assert_eq!(budget, GroundedBudget::Substeps);
        assert_eq!(substeps, 2);
        assert_eq!(body.pose.coords, Vector3::new(20.5, 20.0, 5.0));
        assert_eq!(achieved_velocity, Vector3::new(0.5, 0.0, 0.0));
        assert_eq!(motion.len(), 3);
        assert_eq!(motion.last().unwrap().end_fraction, 1.0);
        assert_eq!(motion.last().unwrap().center, body.pose.coords);
    }

    #[test]
    fn zero_gravity_body_retains_linear_airborne_motion() {
        let mut zero_gravity = config();
        zero_gravity.gravity = 0.0;
        let mut moving = body(Vector3::new(10.0, 20.0, 30.0), None);
        moving.velocity = Vector3::new(3.0, 0.0, 0.0);

        let GroundedOutcome::Solved { body, .. } = solve_with_config(
            &scene(Vec::new()),
            zero_gravity,
            moving,
            pair(),
            Vector3::zero(),
            0.5,
        ) else {
            panic!("zero-gravity linear motion must remain inside the ordinary solver")
        };

        assert_eq!(body.pose.coords, Vector3::new(11.5, 20.0, 30.0));
        assert_eq!(body.velocity, Vector3::new(3.0, 0.0, 0.0));
    }

    #[test]
    fn thin_shell_residual_commits_and_finishes_the_requested_substeps() {
        let scene = scene(thin_sloped_shell_edge());
        let mut falling = body(Vector3::new(39.003_113, 120.106_17, 21.772_526), None);
        falling.velocity = Vector3::new(-0.000_000_648_894_3, -9.048_64, 3.934_283_7);

        let GroundedOutcome::Solved {
            mut body,
            motion,
            substeps,
            contact_passes,
            residual_contacts,
            ..
        } = solve(&scene, falling, close_pair(), Vector3::zero(), 1.0 / 30.0)
        else {
            panic!("bounded contact correction must still complete the ordinary tick")
        };

        assert_eq!(substeps, 2);
        assert_eq!(motion.len(), substeps);
        assert_eq!(motion.last().unwrap().end_fraction, 1.0);
        assert!(contact_passes >= config().maximum_contact_passes);
        assert!(residual_contacts);
        assert!(body.pose.coords.x.is_finite());
        assert!(body.pose.coords.y.is_finite());
        assert!(body.pose.coords.z.is_finite());

        let residual_y = body.pose.coords.y;
        body.velocity = Vector3::new(0.0, 5.0, 0.0);
        let GroundedOutcome::Solved {
            body: cleared,
            residual_contacts,
            ..
        } = solve(&scene, body, close_pair(), Vector3::zero(), 0.1)
        else {
            panic!("ordinary motion away from a residual contact must remain solvable")
        };
        assert!(!residual_contacts);
        assert!(cleared.pose.coords.y > residual_y);
    }

    #[test]
    fn whole_water_restriction_is_selected_only_by_primary_sphere() {
        let mut collision = CollisionScene::new();
        insert_test_coverage_neighborhood(&mut collision, &[LANDBLOCK, EAST]);
        collision
            .insert(artifact(LANDBLOCK, Vec::new(), Vec::new()))
            .unwrap();
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: EAST,
                terrain: TerrainCollisionSurface {
                    entirely_water: true,
                    ..TerrainCollisionSurface::empty()
                },
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();
        let spheres = GroundedBodySpheres {
            support: GroundedSphere {
                center: Vector3::zero(),
                radius: 0.25,
            },
            upper: Some(GroundedSphere {
                center: Vector3::new(1.0, 0.0, 1.0),
                radius: 0.25,
            }),
        };
        let context = GroundedSolveContext {
            scene: &collision,
            config: config(),
            anchor: Guid(LANDBLOCK),
            pose: pose(Vector3::zero()),
            spheres,
            filter: crate::PhysicalCollisionFilter::ALL,
        };

        let contacts = movement_contacts(
            context,
            Vector3::new(191.0, 96.0, 2.0),
            Vector3::new(191.2, 96.0, 2.0),
            &SpatialMembership::outdoor(),
        )
        .unwrap();

        assert!(contacts.iter().all(|entry| entry.contacts.is_empty()));
    }

    fn solved(outcome: GroundedOutcome) -> (GroundedBody, Vector3) {
        let (body, achieved_velocity, _) = solved_with_constraint_count(outcome);
        (body, achieved_velocity)
    }

    fn solved_with_constraint_count(outcome: GroundedOutcome) -> (GroundedBody, Vector3, usize) {
        match outcome {
            GroundedOutcome::Solved {
                body,
                achieved_velocity,
                constraint_count,
                ..
            } => (body, achieved_velocity, constraint_count),
            other => panic!("expected solved grounded body, got {other:?}"),
        }
    }

    #[test]
    fn airborne_integration_acquires_velocity_before_displacement() {
        let scene = scene(Vec::new());
        let original = body(Vector3::new(50.0, 50.0, 10.0), None);
        let (first, first_achieved) = solved(solve(
            &scene,
            original,
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            Vector3::zero(),
            0.1,
        ));
        assert_eq!(
            first.pose.coords.z, 10.0,
            "first gravity tick moved the pose"
        );
        assert_eq!(first_achieved.z, 0.0, "first gravity tick reported motion");
        assert!((first.velocity.z + 0.98).abs() < EPSILON);

        let (second, second_achieved) = solved(solve(
            &scene,
            first,
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            Vector3::zero(),
            0.1,
        ));
        assert!(
            second.pose.coords.z < 10.0,
            "second gravity tick did not fall"
        );
        assert!(
            second_achieved.z < 0.0,
            "second gravity tick reported no fall"
        );
    }

    #[test]
    fn lower_sphere_lands_and_reports_achieved_vertical_motion() {
        let scene = scene(vec![floor()]);
        let spheres = GroundedBodySpheres {
            support: lower_sphere(),
            upper: None,
        };
        let mut current = body(Vector3::new(50.0, 50.0, 3.0), None);
        let mut landing_velocities = None;
        for _ in 0..20 {
            let requested_vertical_velocity = if current.velocity.z.abs() <= f32::EPSILON {
                0.0
            } else {
                current.velocity.z + 0.5 * config().gravity * 0.1
            };
            let (next, achieved) = solved(solve(&scene, current, spheres, Vector3::zero(), 0.1));
            current = next;
            if current.ground.walkable_support().is_some() {
                landing_velocities = Some((requested_vertical_velocity, achieved.z));
                break;
            }
        }
        assert!(
            current.ground.walkable_support().is_some(),
            "lower sphere never acquired support"
        );
        assert!(
            current.pose.coords.z.abs() < EPSILON,
            "landing did not seat the body"
        );
        let (requested, achieved) = landing_velocities.expect("landing tick was not observed");
        assert!(
            achieved > requested,
            "landing reported requested descent velocity {requested} instead of achieved {achieved}"
        );
    }

    #[test]
    fn retained_support_remains_exact_at_rest() {
        let scene = scene(vec![floor()]);
        let spheres = GroundedBodySpheres {
            support: lower_sphere(),
            upper: None,
        };
        let mut current = body(
            Vector3::new(50.0, 50.0, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let landed = current.pose;
        for _ in 0..100 {
            (current, _) = solved(solve(&scene, current, spheres, Vector3::zero(), 0.1));
        }
        assert!(
            (current.pose.coords - landed.coords).length() < EPSILON,
            "retained support drifted from rest: {current:?}"
        );
        assert_eq!(current.velocity.z, 0.0);
    }

    #[test]
    fn flat_drive_preserves_support_and_requested_horizontal_motion() {
        let scene = scene(vec![floor()]);
        let (moved, achieved) = solved(solve(
            &scene,
            body(
                Vector3::new(20.0, 20.0, 0.0),
                Some(Vector3::new(0.0, 0.0, 1.0)),
            ),
            pair(),
            Vector3::new(3.0, 4.0, 0.0),
            1.0,
        ));
        assert!((moved.pose.coords - Vector3::new(23.0, 24.0, 0.0)).length() < EPSILON);
        assert!((achieved - Vector3::new(3.0, 4.0, 0.0)).length() < EPSILON);
        assert!(moved.ground.walkable_support().is_some());
    }

    #[test]
    fn released_slope_momentum_lands_and_decays_to_rest() {
        let shallow = ramp(2, 20.0, 80.0, 10.0, 30.0, 30.0);
        let normal = shallow.shape.as_bsp().unwrap().polygons[&2].normal;
        let collision = scene(vec![shallow]);
        let start = Vector3::new(
            60.0,
            20.0,
            20.0 + lower_sphere().radius / normal.z - lower_sphere().center.z,
        );
        let mut scene = SpatialScene::default();
        let now = Instant::now();
        let id = scene.register_ephemeral_body(pose(start), now);
        scene
            .install_physical_body(
                id,
                PhysicalBodyDefinition::grounded(
                    PhysicalSphereSet::new(
                        Sphere {
                            center: lower_sphere().center,
                            radius: lower_sphere().radius,
                        },
                        None,
                    )
                    .unwrap(),
                    config(),
                )
                .unwrap(),
                PhysicalCollisionFilter::ALL,
                PhysicalBodyResponsePolicy {
                    restitution: PhysicalRestitution::Elastic(
                        PhysicalElasticity::new(0.05).unwrap(),
                    ),
                    friction: PhysicalFriction::DEFAULT,
                    surface_motion: PhysicalSurfaceMotion::Stable,
                    align_path: false,
                },
                None,
            )
            .unwrap();
        let body = scene.body_mut(id).unwrap();
        body.contact = ContactState::Grounded;
        body.retained.velocity = Vector3::new(-3.6, 0.0, 0.0);
        body.physical.as_mut().unwrap().response = PhysicalBodyResponseState::Grounded {
            cell: None,
            ground: GroundState::Supported(GroundSupport {
                normal,
                proof: collision.owner_proof(Guid(LANDBLOCK)).unwrap(),
            }),
            stationary_fall_frames: 0,
        };
        let tick_duration = Duration::from_millis(30);
        for tick in 1..=200 {
            scene
                .tick_physical_body(
                    id,
                    &collision,
                    PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                    tick_duration.as_secs_f32(),
                    now + tick_duration * tick,
                )
                .unwrap();
        }
        let settled = scene.body(id).unwrap();
        assert_eq!(settled.contact, ContactState::Grounded);
        assert_eq!(settled.retained.velocity, Vector3::zero());
        assert_eq!(settled.accepted_motion.velocity, Vector3::zero());
    }

    #[test]
    fn outward_momentum_leaves_a_ramp_while_authored_walking_stays_on_it() {
        let shallow = ramp(2, 20.0, 40.0, 10.0, 30.0, 10.0);
        let normal = shallow.shape.as_bsp().unwrap().polygons[&2].normal;
        let scene = scene(vec![shallow]);
        let start = Vector3::new(
            30.0,
            20.0,
            5.0 + lower_sphere().radius / normal.z - lower_sphere().center.z,
        );
        let downhill = Vector3::new(-4.0, 0.0, 0.0);
        for physical_velocity in [Vector3::zero(), downhill] {
            let mut initial = body(start, Some(normal));
            initial.velocity = physical_velocity;
            let (moved, _) = solved(solve(&scene, initial, pair(), downhill, 0.1));
            assert_eq!(moved.velocity, physical_velocity);
            if physical_velocity == Vector3::zero() {
                assert!(moved.ground.walkable_support().is_some());
                assert!(moved.pose.coords.z < start.z);
            } else {
                assert_eq!(moved.ground, GroundState::Airborne);
                // Gravity was zero on the incoming walkable support; it starts next tick.
                assert!((moved.pose.coords - (start + downhill * 0.1)).length() < EPSILON);
            }
        }
    }

    #[test]
    fn tangential_and_inward_momentum_preserve_ramp_contact() {
        let shallow = ramp(2, 20.0, 40.0, 10.0, 30.0, 10.0);
        let normal = shallow.shape.as_bsp().unwrap().polygons[&2].normal;
        let scene = scene(vec![shallow]);
        let start = Vector3::new(
            30.0,
            20.0,
            5.0 + lower_sphere().radius / normal.z - lower_sphere().center.z,
        );
        for velocity in [Vector3::new(0.0, 2.0, 0.0), Vector3::new(4.0, 0.0, 0.0)] {
            let mut initial = body(start, Some(normal));
            initial.velocity = velocity;
            let (moved, _) = solved(solve(&scene, initial, pair(), velocity, 0.1));
            assert!(moved.ground.walkable_support().is_some());
            assert_eq!(moved.velocity, velocity);
        }
    }

    #[test]
    fn separating_slide_retains_gravity_while_leaving_contact() {
        let steep = ramp(2, 20.0, 40.0, 10.0, 30.0, 30.0);
        let normal = steep.shape.as_bsp().unwrap().polygons[&2].normal;
        let scene = scene(vec![steep]);
        let start = Vector3::new(
            30.0,
            20.0,
            15.0 + lower_sphere().radius / normal.z - lower_sphere().center.z,
        );
        let mut initial = body(start, Some(normal));
        initial.ground = GroundState::Sliding(initial.ground.contact_plane().unwrap());
        initial.velocity = Vector3::new(-4.0, 0.0, 0.0);
        let delta_seconds = 0.1;
        let expected_x = start.x + initial.velocity.x * delta_seconds;
        let expected_velocity =
            initial.velocity + Vector3::new(0.0, 0.0, config().gravity * delta_seconds);
        let (moved, _) = solved(solve(
            &scene,
            initial,
            pair(),
            Vector3::zero(),
            delta_seconds,
        ));
        assert_eq!(moved.ground, GroundState::Airborne);
        assert_eq!(moved.velocity, expected_velocity);
        assert!((moved.pose.coords.x - expected_x).abs() < EPSILON);
    }

    #[test]
    fn physics_generated_supported_velocity_may_follow_a_slope_tangent() {
        let shallow = ramp(2, 20.0, 30.0, 10.0, 30.0, 2.0);
        let normal = shallow.shape.as_bsp().unwrap().polygons[&2].normal;
        let scene = scene(vec![shallow]);
        let starting_height = 0.2 + lower_sphere().radius / normal.z - lower_sphere().center.z;
        let start = Vector3::new(21.0, 20.0, starting_height);
        let tangent_velocity = project_into_plane(Vector3::new(4.0, 0.0, 0.0), normal);
        assert!(tangent_velocity.z > 0.0);

        let (moved, achieved) = solved(solve(
            &scene,
            body(start, Some(normal)),
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            tangent_velocity,
            1.0,
        ));

        assert!((moved.pose.coords - (start + tangent_velocity)).length() < EPSILON);
        assert!((achieved - tangent_velocity).length() < EPSILON);
        assert_eq!(
            moved
                .ground
                .walkable_support()
                .map(|support| support.normal),
            Some(normal)
        );
    }

    #[test]
    fn wall_stops_normal_motion_preserves_slide_and_releases_on_retreat() {
        let scene = scene(vec![floor(), wall_x(2, 10.0, 0.0, 4.0)]);
        let supported = body(
            Vector3::new(7.0, 20.0, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let (blocked, achieved, blocked_constraints) = solved_with_constraint_count(solve(
            &scene,
            supported,
            pair(),
            Vector3::new(6.0, 4.0, 0.0),
            1.0,
        ));
        assert!(
            (blocked.pose.coords.x - 9.5).abs() < EPSILON,
            "wall did not block: {blocked:?}"
        );
        assert!(
            (blocked.pose.coords.y - 24.0).abs() < EPSILON,
            "wall ate tangent motion"
        );
        assert!(achieved.x < 3.0 && (achieved.y - 4.0).abs() < EPSILON);
        assert!(blocked_constraints > 0);

        let (slid_again, repeated_achieved, repeated_constraints) = solved_with_constraint_count(
            solve(&scene, blocked, pair(), Vector3::new(6.0, 4.0, 0.0), 1.0),
        );
        assert!(
            (slid_again.pose.coords.x - 9.5).abs() < EPSILON,
            "repeated angled intent penetrated the wall: {slid_again:?}"
        );
        assert!(
            (slid_again.pose.coords.y - 28.0).abs() < EPSILON,
            "repeated wall contact lost tangent motion: {slid_again:?}"
        );
        assert!((repeated_achieved.y - 4.0).abs() < EPSILON);
        assert!(repeated_constraints > 0);

        let (retreated, _) = solved(solve(
            &scene,
            slid_again,
            pair(),
            Vector3::new(-2.0, 0.0, 0.0),
            1.0,
        ));
        assert!((retreated.pose.coords.x - 7.5).abs() < EPSILON);
    }

    #[test]
    fn wall_collision_exports_the_transaction_normal_for_velocity_response() {
        let scene = scene(vec![floor(), wall_x(2, 10.0, 0.0, 4.0)]);
        let outcome = solve(
            &scene,
            body(
                Vector3::new(7.0, 20.0, 0.0),
                Some(Vector3::new(0.0, 0.0, 1.0)),
            ),
            pair(),
            Vector3::new(6.0, 4.0, 0.0),
            1.0,
        );
        let GroundedOutcome::Solved {
            collision_normal, ..
        } = outcome
        else {
            panic!("wall solve did not complete")
        };
        assert_eq!(collision_normal, Some(Vector3::new(-1.0, 0.0, 0.0)));
    }

    #[test]
    fn upper_sphere_ceiling_exports_normal_and_clips_launch_displacement() {
        let scene = scene(vec![ceiling(1, 3.0)]);
        let mut launched = body(Vector3::new(20.0, 20.0, 0.0), None);
        launched.velocity = Vector3::new(0.0, 0.0, 5.0);
        let outcome = solve(&scene, launched, pair(), Vector3::zero(), 0.2);
        let GroundedOutcome::Solved {
            body,
            achieved_velocity,
            collision_normal,
            ..
        } = outcome
        else {
            panic!("ceiling solve did not complete")
        };
        assert!(
            body.pose.coords.z < 0.51,
            "ceiling did not clip launch: {body:?}"
        );
        assert!(achieved_velocity.z < 2.55);
        assert_eq!(collision_normal, Some(Vector3::new(0.0, 0.0, -1.0)));
    }

    #[test]
    fn angled_intent_clears_a_finite_wall_without_a_retreat_tick() {
        let scene = scene(vec![floor(), wall_x_region(2, 10.0, 20.0, 21.0, 0.0, 4.0)]);
        let mut current = body(
            Vector3::new(9.5, 20.5, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let mut saw_constraint = false;
        let mut released_constraint = false;
        for _ in 0..8 {
            let (next, _, constraint_count) = solved_with_constraint_count(solve(
                &scene,
                current,
                pair(),
                Vector3::new(2.0, 2.0, 0.0),
                0.25,
            ));
            saw_constraint |= constraint_count > 0;
            released_constraint |= saw_constraint && constraint_count == 0;
            current = next;
        }
        assert!(saw_constraint, "finite wall never constrained the body");
        assert!(
            released_constraint,
            "wall constraint survived after the authored polygon ended"
        );
        assert!(
            current.pose.coords.x > 10.0,
            "body never cleared the finite wall without retreat: {current:?}"
        );
    }

    #[test]
    fn angled_intent_clears_a_finite_wall_within_one_multistep_solve() {
        let scene = scene(vec![floor(), wall_x_region(2, 10.0, 20.0, 22.0, 0.0, 4.0)]);
        let (cleared, achieved, constraint_count) = solved_with_constraint_count(solve(
            &scene,
            body(
                Vector3::new(9.5, 20.5, 0.0),
                Some(Vector3::new(0.0, 0.0, 1.0)),
            ),
            pair(),
            Vector3::new(2.0, 4.0, 0.0),
            1.0,
        ));
        assert!(
            constraint_count > 0,
            "finite wall never constrained the body"
        );
        assert!(
            cleared.pose.coords.x > 10.5,
            "wall plane survived later substeps after its polygon ended: {cleared:?}"
        );
        assert!(
            achieved.y > 3.9,
            "finite wall incorrectly consumed tangent travel: {achieved:?}"
        );
    }

    #[test]
    fn near_parallel_motion_does_not_wedge_on_divergent_wall_segments() {
        let scene = scene(vec![
            floor(),
            wall_segment(
                2,
                Vector3::new(10.0, 0.0, 0.0),
                Vector3::new(11.2, 20.0, 0.0),
                0.0,
                4.0,
            ),
            wall_segment(
                3,
                Vector3::new(11.2, 20.0, 0.0),
                Vector3::new(10.0, 40.0, 0.0),
                0.0,
                4.0,
            ),
        ]);
        let (slid, achieved, constraint_count) = solved_with_constraint_count(solve(
            &scene,
            body(
                Vector3::new(10.68, 18.0, 0.0),
                Some(Vector3::new(0.0, 0.0, 1.0)),
            ),
            pair(),
            Vector3::new(0.5, 4.0, 0.0),
            1.0,
        ));
        assert!(
            constraint_count >= 2,
            "wall seam did not exercise both planes"
        );
        assert!(
            achieved.y > 3.5,
            "slightly divergent wall planes accumulated into a wedge: {slid:?}"
        );
    }

    #[test]
    fn multistep_staircase_reaches_and_crosses_its_top_support() {
        let mut colliders = vec![floor()];
        colliders.extend(box_obstacle(2, 10.0, 11.0, 0.3));
        colliders.extend(box_obstacle(4, 11.0, 12.0, 0.6));
        colliders.extend(box_obstacle(6, 12.0, 20.0, 0.6));
        let scene = scene(colliders);
        let GroundedOutcome::Solved {
            body: crossed,
            achieved_velocity: achieved,
            motion,
            ..
        } = solve(
            &scene,
            body(
                Vector3::new(8.5, 20.0, 0.0),
                Some(Vector3::new(0.0, 0.0, 1.0)),
            ),
            pair(),
            Vector3::new(5.0, 0.0, 0.0),
            1.0,
        )
        else {
            panic!("expected solved grounded staircase traversal");
        };
        assert!(
            crossed.pose.coords.x > 13.0,
            "body stopped before crossing the stair crest: {crossed:?}"
        );
        assert!(
            (crossed.pose.coords.z - 0.6).abs() < EPSILON,
            "body did not retain top support: {crossed:?}"
        );
        assert!(achieved.x > 4.5, "stair crest consumed forward travel");
        assert!(
            motion.windows(2).any(|pair| {
                pair[1].center.x > pair[0].center.x && pair[1].center.z > pair[0].center.z
            }),
            "accepted path omitted the stair step-up bend: {motion:?}"
        );
        let final_waypoint = motion.last().expect("solved motion path was empty");
        assert_eq!(final_waypoint.end_fraction, 1.0);
        assert!((final_waypoint.center - crossed.pose.coords).length() < EPSILON);
    }

    #[test]
    fn shallow_ramp_is_support_while_steep_face_is_only_a_constraint() {
        let shallow = ramp(2, 20.0, 30.0, 10.0, 30.0, 2.0);
        let shallow_normal = shallow.shape.as_bsp().unwrap().polygons[&2].normal;
        let shallow_scene = scene(vec![shallow]);
        let starting_height =
            0.2 + lower_sphere().radius / shallow_normal.z - lower_sphere().center.z;
        let supported = body(
            Vector3::new(21.0, 20.0, starting_height),
            Some(shallow_normal),
        );
        let (uphill, _) = solved(solve(
            &shallow_scene,
            supported,
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            Vector3::new(4.0, 0.0, 0.0),
            1.0,
        ));
        let expected_height = 0.2 * (uphill.pose.coords.x - 20.0)
            + lower_sphere().radius / shallow_normal.z
            - lower_sphere().center.z;
        let expected_x = 21.0 + project_into_plane(Vector3::new(4.0, 0.0, 0.0), shallow_normal).x;
        assert!(
            (uphill.pose.coords.x - expected_x).abs() < EPSILON,
            "support plane did not redirect uphill intent: {uphill:?}"
        );
        assert!(
            (uphill.pose.coords.z - expected_height).abs() < EPSILON,
            "body left shallow ramp: {uphill:?}"
        );
        assert_eq!(
            uphill
                .ground
                .walkable_support()
                .map(|support| support.normal),
            Some(shallow_normal)
        );
        let (downhill, _) = solved(solve(
            &shallow_scene,
            uphill,
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            Vector3::new(-4.0, 0.0, 0.0),
            1.0,
        ));
        let expected_height = 0.2 * (downhill.pose.coords.x - 20.0)
            + lower_sphere().radius / shallow_normal.z
            - lower_sphere().center.z;
        assert!(
            (downhill.pose.coords.x - 21.0).abs() < EPSILON,
            "support plane did not redirect downhill intent: {downhill:?}"
        );
        assert!(
            (downhill.pose.coords.z - expected_height).abs() < EPSILON,
            "body left shallow ramp downhill: {downhill:?}"
        );

        let steep = ramp(3, 40.0, 42.0, 10.0, 30.0, 4.0);
        let steep_normal = steep.shape.as_bsp().unwrap().polygons[&3].normal;
        assert!(steep_normal.z < config().walkable_normal_z);
        let steep_scene = scene(vec![steep]);
        let mut steep_start = body(Vector3::new(39.0, 20.0, 0.0), None);
        steep_start.velocity = Vector3::new(4.0, 0.0, 0.0);
        let (constrained, _, constraint_count) = solved_with_constraint_count(solve(
            &steep_scene,
            steep_start,
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            Vector3::new(4.0, 0.0, 0.0),
            1.0,
        ));
        assert!(
            constrained.ground.walkable_support().is_none(),
            "steep face fabricated support"
        );
        assert!(constraint_count > 0, "steep face did not constrain motion");
    }

    #[test]
    fn upper_only_wall_constrains_pair_but_never_becomes_support() {
        let scene = scene(vec![floor(), wall_x(2, 10.0, 1.25, 3.0)]);
        let supported = body(
            Vector3::new(7.0, 20.0, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let (single, _) = solved(solve(
            &scene,
            supported.clone(),
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            Vector3::new(6.0, 0.0, 0.0),
            1.0,
        ));
        assert!(
            (single.pose.coords.x - 13.0).abs() < EPSILON,
            "one-sphere baseline was blocked"
        );

        let (blocked, _) = solved(solve(
            &scene,
            supported,
            pair(),
            Vector3::new(6.0, 0.0, 0.0),
            1.0,
        ));
        assert!(
            (blocked.pose.coords.x - 9.5).abs() < EPSILON,
            "upper sphere did not veto pose"
        );
        assert_eq!(
            blocked
                .ground
                .walkable_support()
                .map(|support| support.normal),
            Some(Vector3::new(0.0, 0.0, 1.0)),
            "upper sphere replaced lower support"
        );
        let (retreated, _) = solved(solve(
            &scene,
            blocked,
            pair(),
            Vector3::new(-2.0, 0.0, 0.0),
            1.0,
        ));
        assert!((retreated.pose.coords.x - 7.5).abs() < EPSILON);
    }

    #[test]
    fn upper_polygon_back_face_slides_and_releases_without_step_routing() {
        let scene = scene(vec![floor(), wall_x(2, 10.0, 1.25, 3.0)]);
        let supported = body(
            Vector3::new(13.0, 20.0, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let (single, _) = solved(solve(
            &scene,
            supported.clone(),
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            Vector3::new(-6.0, 0.0, 0.0),
            1.0,
        ));
        assert!(
            (single.pose.coords.x - 7.0).abs() < EPSILON,
            "one-sphere back-face baseline was blocked"
        );

        let (blocked, _) = solved(solve(
            &scene,
            supported,
            pair(),
            Vector3::new(-6.0, 0.0, 0.0),
            1.0,
        ));
        assert!(
            (blocked.pose.coords.x - 10.5).abs() < EPSILON,
            "upper back face was discarded"
        );
        assert!(
            blocked.pose.coords.z.abs() < EPSILON,
            "upper back face routed to step-up"
        );
        assert_eq!(
            blocked
                .ground
                .walkable_support()
                .map(|support| support.normal),
            Some(Vector3::new(0.0, 0.0, 1.0))
        );
        let (retreated, _) = solved(solve(
            &scene,
            blocked,
            pair(),
            Vector3::new(2.0, 0.0, 0.0),
            1.0,
        ));
        assert!((retreated.pose.coords.x - 12.5).abs() < EPSILON);
    }

    #[test]
    fn lower_sphere_steps_low_box_but_failed_high_step_restores_footing() {
        let mut low_colliders = vec![floor()];
        low_colliders.extend(box_obstacle(2, 10.0, 14.0, 0.4));
        let low_scene = scene(low_colliders);
        let supported = body(
            Vector3::new(9.0, 20.0, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let (stepped, _) = solved(solve(
            &low_scene,
            supported.clone(),
            pair(),
            Vector3::new(2.0, 0.0, 0.0),
            1.0,
        ));
        assert!(
            stepped.pose.coords.x > 10.5,
            "lower sphere did not step over the low face"
        );
        assert!(
            (stepped.pose.coords.z - 0.4).abs() < EPSILON,
            "step did not settle on box top: {stepped:?}"
        );
        assert!(stepped.ground.walkable_support().is_some());

        let mut high_colliders = vec![floor()];
        high_colliders.extend(box_obstacle(4, 10.0, 14.0, 0.8));
        let high_scene = scene(high_colliders);
        let (blocked, _) = solved(solve(
            &high_scene,
            supported,
            pair(),
            Vector3::new(2.0, 0.0, 0.0),
            1.0,
        ));
        assert!(
            blocked.pose.coords.x < 9.5 + EPSILON,
            "high step retained an invalid candidate: {blocked:?}"
        );
        assert!(
            blocked.pose.coords.z.abs() < EPSILON,
            "failed step lifted the body"
        );
        let blocked_x = blocked.pose.coords.x;
        let (retreated, _) = solved(solve(
            &high_scene,
            blocked,
            pair(),
            Vector3::new(-1.0, 0.0, 0.0),
            1.0,
        ));
        assert!(
            (retreated.pose.coords.x - (blocked_x - 1.0)).abs() < EPSILON,
            "failed step prevented retreat"
        );
    }

    #[test]
    fn creature_edge_protection_preserves_footing_and_tangent_slide() {
        let scene = scene(vec![floor_region(1, 0.0, 10.0)]);
        let supported = body(
            Vector3::new(8.5, 20.0, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let mut unprotected = config();
        unprotected.edge_protection = EdgeProtection::None;
        let (walked_off, _) = solved(solve_with_config(
            &scene,
            unprotected,
            supported.clone(),
            pair(),
            Vector3::new(3.0, 1.0, 0.0),
            1.0,
        ));
        assert!(
            walked_off.pose.coords.x > 11.0,
            "unprotected body did not leave the ledge"
        );
        assert!(walked_off.ground.walkable_support().is_none());

        let mut protected = config();
        protected.edge_protection = EdgeProtection::Creature;
        let (held, _) = solved(solve_with_config(
            &scene,
            protected,
            supported,
            pair(),
            Vector3::new(3.0, 1.0, 0.0),
            1.0,
        ));
        assert!(
            held.pose.coords.x <= 10.5 + EPSILON,
            "protected body crossed the ledge: {held:?}"
        );
        assert!(
            (held.pose.coords.y - 21.0).abs() < EPSILON,
            "edge protection ate tangent motion: {held:?}"
        );
        assert!(held.ground.walkable_support().is_some());
    }

    #[test]
    fn creature_edge_protection_accepts_a_short_step_down_before_protecting_the_edge() {
        let mut colliders = vec![floor()];
        colliders.extend(box_obstacle(2, 10.0, 14.0, 0.15));
        let scene = scene(colliders);
        let supported = body(
            Vector3::new(12.0, 20.0, 0.15),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let mut protected = config();
        protected.edge_protection = EdgeProtection::Creature;

        let (stepped_down, _) = solved(solve_with_config(
            &scene,
            protected,
            supported,
            pair(),
            Vector3::new(3.0, 0.0, 0.0),
            1.0,
        ));

        assert!(
            stepped_down.pose.coords.x > 14.5,
            "short drop was mistaken for a protected precipice: {stepped_down:?}"
        );
        assert!(
            stepped_down.pose.coords.z.abs() < EPSILON,
            "short drop did not settle on the lower floor: {stepped_down:?}"
        );
        assert!(stepped_down.ground.walkable_support().is_some());
    }

    #[test]
    fn portal_commit_expires_outdoor_support_and_settles_to_recessed_interior_floor() {
        let cell_id = 0xda55_0100;
        let volume = CellVolume {
            cell_selector: 0x0100,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -10.0,
            }],
            portals: vec![CellCollisionPortal {
                plane: Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -10.0,
                },
                positive_side: true,
                target: CellCollisionPortalTarget::Outdoor,
                outdoor_building: None,
            }],
        };
        let mut interior_floor = floor();
        interior_floor.placement.origin.z = -1.0;
        interior_floor.bounds = interior_floor
            .bounds
            .translated(Vector3::new(0.0, 0.0, -1.0));
        interior_floor.source_placement = StaticColliderPlacement::EnvCellShell { cell_id };
        let terrain = TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![0.0; 81],
            terrain_samples: vec![0; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(LANDBLOCK),
        })
        .unwrap();
        let mut collision = CollisionScene::new();
        insert_test_coverage_neighborhood(&mut collision, &[LANDBLOCK]);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: LANDBLOCK,
                terrain,
                static_geometry: LandblockColliders::new(vec![interior_floor], vec![volume]),
            })
            .unwrap();

        let start = body(
            Vector3::new(8.0, 20.0, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let (mut solved_body, _) = solved(solve(
            &collision,
            start,
            pair(),
            Vector3::new(4.0, 0.0, 0.0),
            1.0,
        ));

        assert_eq!(solved_body.cell, Some(Guid(cell_id)));
        assert_eq!(solved_body.pose.landblock_id, Guid(cell_id));
        assert!(solved_body.ground.walkable_support().is_none());
        for _ in 0..60 {
            (solved_body, _) = solved(solve(
                &collision,
                solved_body,
                pair(),
                Vector3::zero(),
                1.0 / 30.0,
            ));
            if solved_body.ground.walkable_support().is_some() {
                break;
            }
        }
        assert!(
            (solved_body.pose.coords.z + 1.0).abs() < EPSILON,
            "recessed interior settle ended at ({}, {}, {}) with support {:?}",
            solved_body.pose.coords.x,
            solved_body.pose.coords.y,
            solved_body.pose.coords.z,
            solved_body.ground.walkable_support()
        );
        assert!(solved_body.ground.walkable_support().is_some());
    }

    #[test]
    fn intersecting_grounded_constraints_converge_and_release_independently() {
        let scene = scene(vec![
            floor(),
            wall_x(2, 10.0, 0.0, 4.0),
            wall_y(3, 10.0, 0.0, 4.0),
        ]);
        let supported = body(
            Vector3::new(9.25, 9.25, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let mut corner_config = config();
        corner_config.maximum_substep_distance = 10.0;
        let (corner, _, corner_constraint_count) = solved_with_constraint_count(solve_with_config(
            &scene,
            corner_config,
            supported,
            pair(),
            Vector3::new(0.5, 0.5, 0.0),
            1.0,
        ));
        assert!(
            (corner.pose.coords.x - 9.5).abs() < EPSILON,
            "first corner plane was penetrated"
        );
        assert!(
            (corner.pose.coords.y - 9.5).abs() < EPSILON,
            "second corner plane was penetrated"
        );
        assert_eq!(corner_constraint_count, 2);

        let (retreated, _, retreat_constraint_count) =
            solved_with_constraint_count(solve_with_config(
                &scene,
                corner_config,
                corner,
                pair(),
                Vector3::new(-2.0, 0.0, 0.0),
                1.0,
            ));
        assert!((retreated.pose.coords.x - 7.5).abs() < EPSILON);
        assert!((retreated.pose.coords.y - 9.5).abs() < EPSILON);
        assert_eq!(retreat_constraint_count, 0);
    }

    #[test]
    fn grounded_pair_crosses_owners_with_complete_coverage_neighborhood() {
        let mut resident = CollisionScene::new();
        insert_test_coverage_neighborhood(&mut resident, &[LANDBLOCK, EAST]);
        resident
            .insert(artifact(LANDBLOCK, vec![floor()], Vec::new()))
            .unwrap();
        resident
            .insert(artifact(EAST, vec![floor()], Vec::new()))
            .unwrap();
        let supported = body(
            Vector3::new(191.0, 20.0, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        let (crossed, _) = solved(solve(
            &resident,
            supported,
            pair(),
            Vector3::new(2.0, 0.0, 0.0),
            1.0,
        ));
        assert_eq!(
            crossed.pose.landblock_id.0 & 0xffff_0000,
            EAST & 0xffff_0000
        );
        assert!((crossed.pose.coords.x - 1.0).abs() < EPSILON);
        assert!(crossed.ground.walkable_support().is_some());

        let mut falling = body(Vector3::new(191.0, 20.0, 3.0), None);
        falling.velocity = Vector3::new(2.0, 0.0, -1.0);
        let (crossed, _) = solved(solve(
            &resident,
            falling,
            pair(),
            Vector3::new(2.0, 0.0, 0.0),
            1.0,
        ));
        assert_eq!(
            crossed.pose.landblock_id.0 & 0xffff_0000,
            EAST & 0xffff_0000
        );
        assert!(crossed.pose.coords.z < 3.0);
    }

    #[test]
    fn grounded_body_rejects_motion_requiring_a_missing_owner() {
        let original = GroundedBody {
            pose: pose(Vector3::new(191.0, 20.0, 3.0)),
            cell: None,
            velocity: Vector3::new(20.0, 0.0, -1.0),
            ground: GroundState::Airborne,
        };
        let mut incomplete = CollisionScene::new();
        for owner in test_coverage_neighborhood_owners(&[LANDBLOCK, EAST]) {
            if owner != EAST {
                incomplete
                    .insert(artifact(owner, Vec::new(), Vec::new()))
                    .unwrap();
            }
        }
        incomplete
            .insert(artifact(LANDBLOCK, vec![floor()], Vec::new()))
            .unwrap();
        let error = solve_grounded(
            &incomplete,
            config(),
            GroundedRequest {
                body: original,
                spheres: pair(),
                supported_velocity: Vector3::new(20.0, 0.0, 0.0),
                retain_supported_gravity: false,
                settle: SettlePermission::Landing,
                delta_seconds: 0.1,
                filter: crate::PhysicalCollisionFilter::ALL,
            },
        )
        .unwrap_err();
        assert_eq!(
            error.downcast_ref::<crate::CollisionQueryError>(),
            Some(&crate::CollisionQueryError::UnavailableOwner { owner: EAST })
        );
    }

    #[test]
    fn lower_sphere_commits_linked_cells_while_upper_sphere_can_veto_transit() {
        let first = CellVolume {
            cell_selector: 0x0100,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![
                Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: 0.0,
                },
                Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 10.0,
                },
            ],
            portals: vec![CellCollisionPortal {
                plane: Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -10.0,
                },
                positive_side: true,
                target: CellCollisionPortalTarget::EnvCell(0x0101),
                outdoor_building: None,
            }],
        };
        let second = CellVolume {
            cell_selector: 0x0101,
            placement: first.placement,
            planes: vec![
                Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -10.0,
                },
                Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 20.0,
                },
            ],
            portals: vec![
                CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(-1.0, 0.0, 0.0),
                        d: 10.0,
                    },
                    positive_side: true,
                    target: CellCollisionPortalTarget::EnvCell(0x0100),
                    outdoor_building: None,
                },
                CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(1.0, 0.0, 0.0),
                        d: -20.0,
                    },
                    positive_side: true,
                    target: CellCollisionPortalTarget::Outdoor,
                    outdoor_building: None,
                },
            ],
        };
        let mut first_floor = floor();
        first_floor.source_placement = StaticColliderPlacement::EnvCellShell {
            cell_id: 0xda55_0100,
        };
        let mut second_floor = floor();
        second_floor.source_placement = StaticColliderPlacement::EnvCellShell {
            cell_id: 0xda55_0101,
        };
        let mut upper_wall = wall_x(2, 10.0, 1.25, 3.0);
        upper_wall.source_placement = StaticColliderPlacement::EnvCellShell {
            cell_id: 0xda55_0100,
        };
        let mut collision = CollisionScene::new();
        insert_test_coverage_neighborhood(&mut collision, &[LANDBLOCK]);
        collision
            .insert(artifact(
                LANDBLOCK,
                vec![first_floor, second_floor, upper_wall],
                vec![first, second],
            ))
            .unwrap();
        let mut in_first = body(
            Vector3::new(8.0, 20.0, 0.0),
            Some(Vector3::new(0.0, 0.0, 1.0)),
        );
        in_first.cell = Some(Guid(0xda55_0100));
        in_first.pose.landblock_id = Guid(0xda55_0100);

        let (lower_only, _) = solved(solve(
            &collision,
            in_first.clone(),
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            Vector3::new(4.0, 0.0, 0.0),
            1.0,
        ));
        assert_eq!(lower_only.cell, Some(Guid(0xda55_0101)));
        assert_eq!(lower_only.pose.landblock_id, Guid(0xda55_0101));

        let (outside, _) = solved(solve(
            &collision,
            lower_only,
            GroundedBodySpheres {
                support: lower_sphere(),
                upper: None,
            },
            Vector3::new(10.0, 0.0, 0.0),
            1.0,
        ));
        assert_eq!(outside.cell, None);
        assert!(outside.pose.landblock_id.0 & 0xffff < 0x0100);

        let (pair_blocked, _) = solved(solve(
            &collision,
            in_first,
            pair(),
            Vector3::new(4.0, 0.0, 0.0),
            1.0,
        ));
        assert_eq!(pair_blocked.cell, Some(Guid(0xda55_0100)));
        assert_eq!(pair_blocked.pose.landblock_id, Guid(0xda55_0100));
        assert!((pair_blocked.pose.coords.x - 9.5).abs() < EPSILON);
        assert!(pair_blocked.ground.walkable_support().is_some());
    }
}
