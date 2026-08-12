//! Validated physical-body geometry and response definitions shared by every body source.

use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Sphere, Vector3};
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
        /// Current vertical velocity integrated only while the body is active.
        fall_velocity: f32,
        /// Last committed walkable support for the lower sphere.
        support: Option<GroundSupport>,
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
    /// Response-only state; the containing `SpatialBody` remains the sole pose owner.
    pub response: PhysicalBodyResponseState,
    /// Whether the body may receive a fixed simulation tick.
    pub activity: PhysicalBodyActivity,
}

impl PhysicalBodyState {
    /// Builds response memory whose variant is guaranteed to match the definition.
    pub fn new(definition: PhysicalBodyDefinition, cell: Option<Guid>) -> Self {
        let response = match definition {
            PhysicalBodyDefinition::FreeSphere { .. } => {
                PhysicalBodyResponseState::FreeSphere { cell }
            }
            PhysicalBodyDefinition::Grounded { .. } => PhysicalBodyResponseState::Grounded {
                cell,
                fall_velocity: 0.0,
                support: None,
            },
        };
        Self {
            definition,
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
    /// Prior support-sphere interior cell.
    cell: Option<Guid>,
    /// Prior downward velocity integrated only while active.
    fall_velocity: f32,
    /// Prior committed walkable support.
    support: Option<GroundSupport>,
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
    desired_velocity: Vector3,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    ensure!(
        delta_seconds.is_finite() && delta_seconds > 0.0,
        "physical-body tick interval must be finite and positive"
    );
    ensure!(
        desired_velocity.x.is_finite()
            && desired_velocity.y.is_finite()
            && desired_velocity.z.is_finite(),
        "physical-body desired velocity must be finite"
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
        ) => solve_free_sphere_tick(
            scene,
            body,
            sphere,
            config,
            *cell,
            desired_velocity,
            delta_seconds,
        ),
        (
            PhysicalBodyDefinition::Grounded { spheres, config },
            PhysicalBodyResponseState::Grounded {
                cell,
                fall_velocity,
                support,
            },
        ) => solve_grounded_body_tick(
            scene,
            body,
            GroundedTickState {
                spheres,
                config,
                cell: *cell,
                fall_velocity: *fall_velocity,
                support: *support,
            },
            desired_velocity,
            delta_seconds,
        ),
        _ => anyhow::bail!("physical body definition and response state variants diverged"),
    }
}

fn solve_free_sphere_tick(
    scene: &CollisionScene,
    body: &SpatialBody,
    sphere: GroundedSphere,
    config: PhysicalFlyConfig,
    cell: Option<Guid>,
    desired_velocity: Vector3,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    let response = PhysicalBodyResponseState::FreeSphere { cell };
    let offset = body.pose.rotation.rotate_vector(sphere.center);
    let mut sphere_pose = body.pose;
    sphere_pose.coords = sphere_pose.coords + offset;
    let outcome = solve_physical_fly(
        scene,
        config,
        PhysicalFlyRequest {
            body: PhysicalFlyBody {
                pose: sphere_pose,
                cell,
                radius: sphere.radius,
            },
            displacement: desired_velocity * delta_seconds,
        },
    )?;
    match outcome {
        PhysicalFlyOutcome::Solved {
            body: solved,
            achieved_displacement,
            motion,
            substeps,
            contact_passes,
        } => {
            let pose = body_reference_pose(solved.pose, solved.cell, offset)?;
            let path = trace_body_reference_path(scene, body.pose, cell, sphere, &motion, true)?;
            let achieved_velocity = achieved_displacement / delta_seconds;
            Ok(PhysicalBodyTickCommit {
                pose,
                velocity: achieved_velocity,
                contact: ContactState::Airborne,
                response: PhysicalBodyResponseState::FreeSphere { cell: solved.cell },
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
            sphere,
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
    desired_velocity: Vector3,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    let response = PhysicalBodyResponseState::Grounded {
        cell: state.cell,
        fall_velocity: state.fall_velocity,
        support: state.support,
    };
    let outcome = solve_grounded(
        scene,
        state.config,
        GroundedRequest {
            body: GroundedBody {
                pose: body.pose,
                cell: state.cell,
                fall_velocity: state.fall_velocity,
                support: state.support,
            },
            spheres: state.spheres,
            drive_velocity: desired_velocity,
            delta_seconds,
        },
    )?;
    match outcome {
        GroundedOutcome::Solved {
            body: solved,
            achieved_velocity,
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
            let grounded = solved.support.is_some();
            Ok(PhysicalBodyTickCommit {
                pose: solved.pose,
                velocity: achieved_velocity,
                contact: if grounded {
                    ContactState::Grounded
                } else {
                    ContactState::Airborne
                },
                response: PhysicalBodyResponseState::Grounded {
                    cell: solved.cell,
                    fall_velocity: solved.fall_velocity,
                    support: solved.support,
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
        }],
        false,
    )?;
    Ok(PhysicalBodyTickCommit {
        pose: body.pose,
        velocity: Vector3::zero(),
        contact: body.contact,
        response,
        activity: PhysicalBodyActivity::Active,
        outcome: PhysicalBodyTickOutcome::Motion(PhysicalBodyMotion {
            path,
            status: diagnostics.status,
            grounded: diagnostics.grounded,
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

/// Initial registration checks coverage only; the first ordinary response solve establishes a safe
/// pose. Restoration uses `evaluate_physical_body_activity` because an already-safe retained pose
/// may neither settle nor relabel itself when content returns.
pub fn initial_physical_body_activity(
    scene: &CollisionScene,
    pose: WorldPosition,
    definition: PhysicalBodyDefinition,
) -> Result<PhysicalBodyActivity, CollisionQueryError> {
    Ok(
        match physical_body_missing_coverage(scene, pose, definition)? {
            Some(missing) => PhysicalBodyActivity::AwaitingCoverage(missing),
            None => PhysicalBodyActivity::Active,
        },
    )
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
mod tests {
    use super::*;
    use crate::{EdgeProtection, GroundedConfig, PhysicalFlyConfig};

    const FLY_CONFIG: PhysicalFlyConfig = PhysicalFlyConfig {
        maximum_substep_distance: 0.25,
        maximum_substeps: 8,
        maximum_contact_passes: 4,
        separation_epsilon: 0.001,
    };
    const GROUNDED_CONFIG: GroundedConfig = GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: 0.7,
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
}
