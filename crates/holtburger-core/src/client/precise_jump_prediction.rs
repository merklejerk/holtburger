//! Static-environment first-landing prediction for precise jumps.

use std::time::{Duration, Instant};

use holtburger_common::position::METERS_PER_LANDBLOCK;
use holtburger_common::{Guid, Vector3};
use holtburger_world::state::SelfJumpCapabilities;
use holtburger_world::{
    CollisionQueryError, CollisionScene, ContactState, GroundState, GroundedBodyActuation,
    GroundedLaunch, PhysicalBodyActuation, PhysicalBodyDefinition, PhysicalBodyResponseState,
    PhysicalBodySceneResidency, PhysicalBodyTickStatus, SpatialBody, SpatialBodyId, SpatialScene,
    StaticSurfaceRayHit,
};
use thiserror::Error;

use super::character_jump::CharacterJumpReadiness;
use super::precise_jump::{
    PreciseJumpCandidateBudget, PreciseJumpCandidateRejection, PreciseJumpLaunchCandidate,
    PreciseJumpWorldDisplacement, generate_precise_jump_candidates,
};

/// The ordinary client physics quantum used for every speculative tick.
pub const PRECISE_JUMP_FIXED_TICK: Duration = Duration::from_millis(30);
const TARGET_NORMAL_TOLERANCE: f32 = 0.000_1;

/// Collision-backed static target retained in one normalized outdoor anchor frame.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpStaticTarget {
    anchor: Guid,
    hit: StaticSurfaceRayHit,
}

impl PreciseJumpStaticTarget {
    pub fn new(
        anchor: Guid,
        hit: StaticSurfaceRayHit,
    ) -> Result<Self, PreciseJumpStaticTargetError> {
        if anchor.0 & 0xffff != 0xffff {
            return Err(PreciseJumpStaticTargetError::InvalidAnchor);
        }
        let normal_length_squared = hit.normal.length_squared();
        if !hit.point.x.is_finite()
            || !hit.point.y.is_finite()
            || !hit.point.z.is_finite()
            || !hit.distance.is_finite()
            || hit.distance < 0.0
            || !normal_length_squared.is_finite()
            || (normal_length_squared - 1.0).abs() > TARGET_NORMAL_TOLERANCE
        {
            return Err(PreciseJumpStaticTargetError::InvalidHit);
        }
        Ok(Self { anchor, hit })
    }

    pub const fn anchor(&self) -> Guid {
        self.anchor
    }

    pub const fn hit(&self) -> &StaticSurfaceRayHit {
        &self.hit
    }
}

/// Invalid collision target rejected before speculative physics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PreciseJumpStaticTargetError {
    #[error("precise-jump target anchor must be a normalized outdoor collision owner")]
    InvalidAnchor,
    #[error("precise-jump target hit must contain finite geometry and a unit normal")]
    InvalidHit,
}

/// Explicit replaceable-work limits for one complete target evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreciseJumpPredictionBudget {
    candidate_budget: PreciseJumpCandidateBudget,
    maximum_ticks_per_candidate: u32,
}

impl PreciseJumpPredictionBudget {
    pub fn new(
        candidate_budget: PreciseJumpCandidateBudget,
        maximum_ticks_per_candidate: usize,
    ) -> Result<Self, PreciseJumpPredictionBudgetError> {
        if maximum_ticks_per_candidate == 0 {
            return Err(PreciseJumpPredictionBudgetError::ZeroTicks);
        }
        let maximum_ticks_per_candidate = u32::try_from(maximum_ticks_per_candidate)
            .map_err(|_| PreciseJumpPredictionBudgetError::TooManyTicks)?;
        Ok(Self {
            candidate_budget,
            maximum_ticks_per_candidate,
        })
    }

    pub const fn candidate_budget(self) -> PreciseJumpCandidateBudget {
        self.candidate_budget
    }

    pub const fn maximum_ticks_per_candidate(self) -> u32 {
        self.maximum_ticks_per_candidate
    }

    pub fn maximum_flight_duration(self) -> Duration {
        PRECISE_JUMP_FIXED_TICK * self.maximum_ticks_per_candidate
    }
}

/// Invalid speculative work limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PreciseJumpPredictionBudgetError {
    #[error("precise-jump prediction budget must permit at least one solver tick")]
    ZeroTicks,
    #[error("precise-jump prediction tick budget exceeds its representable duration")]
    TooManyTicks,
}

/// Immutable authority and target facts required by one replaceable prediction.
#[derive(Clone, Copy)]
pub struct PreciseJumpPredictionRequest<'a> {
    /// Canonical scene copied before any speculative mutation.
    pub spatial_scene: &'a SpatialScene,
    /// Immutable installed static collision snapshot.
    pub collision_scene: &'a CollisionScene,
    /// Player body to launch inside each private scene copy.
    pub body_id: SpatialBodyId,
    /// Fresh authority-resolved movement and jump facts.
    pub capabilities: &'a SelfJumpCapabilities,
    /// Collision-backed target retained from the static surface ray.
    pub target: &'a PreciseJumpStaticTarget,
    /// Evaluation work limits selected by the host policy.
    pub budget: PreciseJumpPredictionBudget,
    /// Stable time origin used only by cloned scene bookkeeping.
    pub start_time: Instant,
}

/// First walkable support acquired after a proven launch.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpPredictedLanding {
    candidate: PreciseJumpLaunchCandidate,
    contact_point: Vector3,
    normal: Vector3,
    flight_duration: Duration,
    solver_ticks: u32,
}

impl PreciseJumpPredictedLanding {
    pub const fn candidate(self) -> PreciseJumpLaunchCandidate {
        self.candidate
    }

    /// Support-sphere contact point in the target's anchor-local frame.
    pub const fn contact_point(self) -> Vector3 {
        self.contact_point
    }

    pub const fn normal(self) -> Vector3 {
        self.normal
    }

    pub const fn flight_duration(self) -> Duration {
        self.flight_duration
    }

    pub const fn solver_ticks(self) -> u32 {
        self.solver_ticks
    }
}

/// Proven failure of one legal analytic candidate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreciseJumpCandidateFailure {
    LaunchDidNotLeaveSupport,
    Obstructed,
    SlidingContact,
    FirstLandingMissedTarget,
    LeftAuthoredLandscape,
}

/// Proven reason a target cannot be accepted by the evaluated envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreciseJumpUnreachableReason {
    Airborne,
    Unsupported,
    Overburdened,
    TargetOutsideEnvelope,
    TargetSurfaceNotWalkable,
    AllCandidatesFailed {
        /// Failure observed for the highest evaluated legal arc.
        final_failure: PreciseJumpCandidateFailure,
    },
}

/// Missing authority or exhausted work that cannot honestly become a red result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreciseJumpUnprovenReason {
    BodyUnavailable,
    BodyDefinitionChanged,
    InvalidCapabilities,
    StaleTargetCollision,
    CollisionUnavailable { owner: Guid },
    EnvCellUnavailable { cell: Guid },
    SolverBudgetExceeded,
    WorkBudgetExhausted,
}

/// One complete static-target evaluation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PreciseJumpPredictionOutcome {
    Reachable(PreciseJumpPredictedLanding),
    Unreachable(PreciseJumpUnreachableReason),
    Unproven(PreciseJumpUnprovenReason),
}

/// Aggregate work facts for reproducible predictor benchmarks and live diagnostics.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PreciseJumpPredictionDiagnostics {
    generated_candidates: usize,
    evaluated_candidates: usize,
    solver_ticks: u64,
}

impl PreciseJumpPredictionDiagnostics {
    /// Analytic candidates emitted before collision-backed search began.
    pub const fn generated_candidates(self) -> usize {
        self.generated_candidates
    }

    /// Candidates whose speculative scene entered the ordinary body solver.
    pub const fn evaluated_candidates(self) -> usize {
        self.evaluated_candidates
    }

    /// Total ordinary 30 Hz body ticks spent across every evaluated candidate.
    pub const fn solver_ticks(self) -> u64 {
        self.solver_ticks
    }
}

/// Prediction outcome paired with aggregate work facts, without retaining a speculative path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpPredictionEvaluation {
    outcome: PreciseJumpPredictionOutcome,
    diagnostics: PreciseJumpPredictionDiagnostics,
}

impl PreciseJumpPredictionEvaluation {
    /// Semantic blue/red/unproven result shared with the ordinary prediction API.
    pub const fn outcome(self) -> PreciseJumpPredictionOutcome {
        self.outcome
    }

    /// Aggregate bounded work performed to produce the outcome.
    pub const fn diagnostics(self) -> PreciseJumpPredictionDiagnostics {
        self.diagnostics
    }
}

/// Unexpected solver failure outside the prediction's explicit semantic outcomes.
#[derive(Debug, Error)]
pub enum PreciseJumpPredictionError {
    #[error("precise-jump static solver failed")]
    Solver(#[source] anyhow::Error),
}

/// Searches legal arcs against the same static-environment solver used by ordinary body motion.
pub fn predict_precise_jump(
    request: PreciseJumpPredictionRequest<'_>,
) -> Result<PreciseJumpPredictionOutcome, PreciseJumpPredictionError> {
    Ok(diagnose_precise_jump(request)?.outcome())
}

/// Runs the same prediction while retaining only aggregate work measurements.
pub fn diagnose_precise_jump(
    request: PreciseJumpPredictionRequest<'_>,
) -> Result<PreciseJumpPredictionEvaluation, PreciseJumpPredictionError> {
    let mut diagnostics = PreciseJumpPredictionDiagnostics::default();
    let outcome = predict_precise_jump_inner(request, &mut diagnostics)?;
    Ok(PreciseJumpPredictionEvaluation {
        outcome,
        diagnostics,
    })
}

fn predict_precise_jump_inner(
    request: PreciseJumpPredictionRequest<'_>,
    diagnostics: &mut PreciseJumpPredictionDiagnostics,
) -> Result<PreciseJumpPredictionOutcome, PreciseJumpPredictionError> {
    let Some(body) = request.spatial_scene.body(request.body_id) else {
        return Ok(PreciseJumpPredictionOutcome::Unproven(
            PreciseJumpUnprovenReason::BodyUnavailable,
        ));
    };
    let Some(physical) = body.physical.as_ref() else {
        return Ok(PreciseJumpPredictionOutcome::Unproven(
            PreciseJumpUnprovenReason::BodyUnavailable,
        ));
    };
    let PhysicalBodyDefinition::Grounded { spheres, config } = physical.definition else {
        return Ok(PreciseJumpPredictionOutcome::Unproven(
            PreciseJumpUnprovenReason::BodyUnavailable,
        ));
    };
    if !request.collision_scene.proves(request.target.hit.proof) {
        return Ok(PreciseJumpPredictionOutcome::Unproven(
            PreciseJumpUnprovenReason::StaleTargetCollision,
        ));
    }
    if request.target.hit.normal.z < config.walkable_normal_z {
        return Ok(PreciseJumpPredictionOutcome::Unreachable(
            PreciseJumpUnreachableReason::TargetSurfaceNotWalkable,
        ));
    }

    let readiness = match body.contact {
        ContactState::Grounded => CharacterJumpReadiness::Supported,
        ContactState::Airborne => CharacterJumpReadiness::Airborne,
        ContactState::Sliding | ContactState::Unknown => CharacterJumpReadiness::Unsupported,
    };
    let desired_body_point = desired_landing_body_point(body, request.target, spheres.support);
    let displacement = desired_body_point - body.pose.coords;
    let displacement = PreciseJumpWorldDisplacement::new(displacement)
        .expect("validated body and collision target produce finite local displacement");
    let candidates = match generate_precise_jump_candidates(
        request.capabilities,
        physical.definition,
        body.pose.rotation.to_heading(),
        readiness,
        displacement,
        request.budget.candidate_budget(),
    ) {
        Ok(candidates) => candidates,
        Err(rejection) => return Ok(map_candidate_rejection(rejection)),
    };
    let mut final_failure = None;
    diagnostics.generated_candidates = candidates.candidates().len();
    for candidate in candidates.candidates() {
        diagnostics.evaluated_candidates += 1;
        match predict_candidate(
            request,
            spheres.support,
            candidates
                .envelope()
                .landing_tolerance()
                .support_sphere_radius(),
            *candidate,
            diagnostics,
        )? {
            CandidatePrediction::Reached(landing) => {
                return Ok(PreciseJumpPredictionOutcome::Reachable(landing));
            }
            CandidatePrediction::Failed(failure) => final_failure = Some(failure),
            CandidatePrediction::Unproven(reason) => {
                return Ok(PreciseJumpPredictionOutcome::Unproven(reason));
            }
        }
    }
    Ok(PreciseJumpPredictionOutcome::Unreachable(
        PreciseJumpUnreachableReason::AllCandidatesFailed {
            final_failure: final_failure.expect("a nonempty candidate set evaluated every arc"),
        },
    ))
}

enum CandidatePrediction {
    Reached(PreciseJumpPredictedLanding),
    Failed(PreciseJumpCandidateFailure),
    Unproven(PreciseJumpUnprovenReason),
}

fn predict_candidate(
    request: PreciseJumpPredictionRequest<'_>,
    support_sphere: holtburger_world::GroundedSphere,
    landing_tolerance: f32,
    candidate: PreciseJumpLaunchCandidate,
    diagnostics: &mut PreciseJumpPredictionDiagnostics,
) -> Result<CandidatePrediction, PreciseJumpPredictionError> {
    let mut scene = request.spatial_scene.clone();
    let launch = GroundedLaunch::new(candidate.world_velocity())
        .expect("analytic precise-jump candidates always launch upward with finite velocity");
    for tick in 1..=request.budget.maximum_ticks_per_candidate() {
        diagnostics.solver_ticks += 1;
        let grounded = if tick == 1 {
            GroundedBodyActuation::coast().with_launch(launch)
        } else {
            GroundedBodyActuation::coast()
        };
        let now = request.start_time + PRECISE_JUMP_FIXED_TICK * tick;
        let result = match scene.tick_physical_body(
            request.body_id,
            request.collision_scene,
            PhysicalBodyActuation::Grounded(grounded),
            PRECISE_JUMP_FIXED_TICK.as_secs_f32(),
            now,
        ) {
            Ok(result) => result,
            Err(error) => return classify_solver_error(error),
        };
        if result.motion.status != PhysicalBodyTickStatus::Solved {
            return Ok(CandidatePrediction::Unproven(
                PreciseJumpUnprovenReason::SolverBudgetExceeded,
            ));
        }
        match result.scene_residency {
            PhysicalBodySceneResidency::Resident => {}
            PhysicalBodySceneResidency::MissingOwner { owner } => {
                return Ok(CandidatePrediction::Unproven(
                    PreciseJumpUnprovenReason::CollisionUnavailable { owner },
                ));
            }
            PhysicalBodySceneResidency::OutsideLandscape => {
                return Ok(CandidatePrediction::Failed(
                    PreciseJumpCandidateFailure::LeftAuthoredLandscape,
                ));
            }
        }
        let solved = scene
            .body(request.body_id)
            .expect("speculative body cannot disappear during a single-body tick");
        if tick == 1 && solved.contact != ContactState::Airborne {
            return Ok(CandidatePrediction::Failed(
                PreciseJumpCandidateFailure::LaunchDidNotLeaveSupport,
            ));
        }
        match solved.contact {
            ContactState::Grounded => {
                let Some((normal, contact_point, committed_cell)) =
                    landing_contact(solved, support_sphere, request.target.anchor)
                else {
                    return Ok(CandidatePrediction::Unproven(
                        PreciseJumpUnprovenReason::BodyDefinitionChanged,
                    ));
                };
                if committed_cell == request.target.hit.placement.committed_cell()
                    && contact_point.distance(&request.target.hit.point) <= landing_tolerance
                {
                    return Ok(CandidatePrediction::Reached(PreciseJumpPredictedLanding {
                        candidate,
                        contact_point,
                        normal,
                        flight_duration: PRECISE_JUMP_FIXED_TICK * tick,
                        solver_ticks: tick,
                    }));
                }
                return Ok(CandidatePrediction::Failed(
                    PreciseJumpCandidateFailure::FirstLandingMissedTarget,
                ));
            }
            ContactState::Sliding => {
                return Ok(CandidatePrediction::Failed(
                    PreciseJumpCandidateFailure::SlidingContact,
                ));
            }
            ContactState::Airborne => {
                if result.motion.constraint_count > 0 {
                    return Ok(CandidatePrediction::Failed(
                        PreciseJumpCandidateFailure::Obstructed,
                    ));
                }
            }
            ContactState::Unknown => {
                return Ok(CandidatePrediction::Unproven(
                    PreciseJumpUnprovenReason::BodyDefinitionChanged,
                ));
            }
        }
    }
    Ok(CandidatePrediction::Unproven(
        PreciseJumpUnprovenReason::WorkBudgetExhausted,
    ))
}

fn classify_solver_error(
    error: anyhow::Error,
) -> Result<CandidatePrediction, PreciseJumpPredictionError> {
    match error.downcast_ref::<CollisionQueryError>() {
        Some(CollisionQueryError::UnavailableOwner { owner }) => Ok(CandidatePrediction::Unproven(
            PreciseJumpUnprovenReason::CollisionUnavailable {
                owner: Guid(*owner),
            },
        )),
        Some(CollisionQueryError::UnknownMotionCell { cell }) => Ok(CandidatePrediction::Unproven(
            PreciseJumpUnprovenReason::EnvCellUnavailable { cell: Guid(*cell) },
        )),
        Some(_) | None => Err(PreciseJumpPredictionError::Solver(error)),
    }
}

fn map_candidate_rejection(
    rejection: PreciseJumpCandidateRejection,
) -> PreciseJumpPredictionOutcome {
    match rejection {
        PreciseJumpCandidateRejection::Airborne => {
            PreciseJumpPredictionOutcome::Unreachable(PreciseJumpUnreachableReason::Airborne)
        }
        PreciseJumpCandidateRejection::Unsupported => {
            PreciseJumpPredictionOutcome::Unreachable(PreciseJumpUnreachableReason::Unsupported)
        }
        PreciseJumpCandidateRejection::Overburdened => {
            PreciseJumpPredictionOutcome::Unreachable(PreciseJumpUnreachableReason::Overburdened)
        }
        PreciseJumpCandidateRejection::TargetOutsideEnvelope => {
            PreciseJumpPredictionOutcome::Unreachable(
                PreciseJumpUnreachableReason::TargetOutsideEnvelope,
            )
        }
        PreciseJumpCandidateRejection::NonGroundedBody
        | PreciseJumpCandidateRejection::InvalidCapabilities
        | PreciseJumpCandidateRejection::InvalidHeading => {
            PreciseJumpPredictionOutcome::Unproven(PreciseJumpUnprovenReason::InvalidCapabilities)
        }
    }
}

fn desired_landing_body_point(
    body: &SpatialBody,
    target: &PreciseJumpStaticTarget,
    support_sphere: holtburger_world::GroundedSphere,
) -> Vector3 {
    let body_anchor = owner_for_position(body.pose.landblock_id);
    let target_in_body_frame = point_between_anchors(target.hit.point, target.anchor, body_anchor);
    target_in_body_frame + target.hit.normal * support_sphere.radius
        - body.pose.rotation.rotate_vector(support_sphere.center)
}

fn landing_contact(
    body: &SpatialBody,
    support_sphere: holtburger_world::GroundedSphere,
    target_anchor: Guid,
) -> Option<(Vector3, Vector3, Option<Guid>)> {
    let PhysicalBodyResponseState::Grounded {
        cell,
        ground: GroundState::Supported(support),
        ..
    } = body.physical.as_ref()?.response
    else {
        return None;
    };
    let body_anchor = owner_for_position(body.pose.landblock_id);
    let center = body.pose.coords + body.pose.rotation.rotate_vector(support_sphere.center);
    let contact = center - support.normal * support_sphere.radius;
    Some((
        support.normal,
        point_between_anchors(contact, body_anchor, target_anchor),
        cell,
    ))
}

fn owner_for_position(position: Guid) -> Guid {
    Guid((position.0 & 0xffff_0000) | 0xffff)
}

fn point_between_anchors(point: Vector3, source: Guid, target: Guid) -> Vector3 {
    Vector3::new(
        point.x
            + ((((source.0 >> 24) & 0xff) as i32 - ((target.0 >> 24) & 0xff) as i32) as f32
                * METERS_PER_LANDBLOCK),
        point.y
            + ((((source.0 >> 16) & 0xff) as i32 - ((target.0 >> 16) & 0xff) as i32) as f32
                * METERS_PER_LANDBLOCK),
        point.z,
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use holtburger_common::position::WorldPosition;
    use holtburger_common::{Quaternion, Sphere};
    use holtburger_content::{
        BspSolid, CellVolume, ColliderScale, CollisionBall, CollisionBox, CollisionPolygon,
        CollisionShape, LandblockColliders, LandblockCollisionAsset, LandblockPlacement,
        LandblockTerrain, PlacedCollider, StaticColliderPlacement, TerrainCellDiagonals,
        TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode};
    use holtburger_protocol::messages::movement::MotionStance;
    use holtburger_world::state::{
        PlayerMotionTableSource, SelfMovementCapabilities, SelfMovementKinematics,
    };
    use holtburger_world::{
        DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
        DynamicPhysicalBodyDefinition, EdgeProtection, EntityCollisionParticipation,
        EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, GroundSupport,
        LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand, PhysicalBodyResponseState,
        PhysicalBodyState, PhysicalCollisionFilter, PhysicalElasticity,
        PreparedEntityTargetGeometry, StaticSurfaceRayRequest,
    };

    use crate::retail_player_grounded_profile;

    use super::*;

    const OWNER: Guid = Guid(0xda55_ffff);

    fn capabilities() -> SelfJumpCapabilities {
        SelfJumpCapabilities {
            movement: SelfMovementCapabilities {
                kinematics: SelfMovementKinematics {
                    source: PlayerMotionTableSource::DirectProperty {
                        motion_table_id: 0x0900_0020,
                    },
                    motion_table_id: 0x0900_0020,
                    stance: MotionStance::NonCombat as u32,
                    base_walk_forward_velocity: Vector3::new(3.12, 0.0, 0.0),
                    base_run_forward_velocity: Vector3::new(4.0, 0.0, 0.0),
                    base_turn_left_omega: Vector3::new(0.0, 0.0, -1.0),
                    base_turn_right_omega: Vector3::new(0.0, 0.0, 1.0),
                },
                run_rate_scalar: 1.0,
            },
            full_extent_jump_height: 4.2125,
            burden: 0.0,
        }
    }

    fn flat_terrain(owner: Guid, height: f32) -> TerrainCollisionSurface {
        TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![height; 81],
            terrain_samples: vec![0; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(owner.0),
        })
        .unwrap()
    }

    fn collision_scene(terrain_height: f32, colliders: Vec<PlacedCollider>) -> CollisionScene {
        let mut collision = CollisionScene::new();
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: OWNER.0,
                terrain: flat_terrain(OWNER, terrain_height),
                static_geometry: LandblockColliders {
                    colliders,
                    cell_volumes: Vec::new(),
                },
            })
            .unwrap();
        collision
    }

    fn polygon_collider(
        vertices: Vec<Vector3>,
        normal: Vector3,
        source_index: usize,
    ) -> PlacedCollider {
        let center = vertices
            .iter()
            .copied()
            .fold(Vector3::zero(), |sum, vertex| sum + vertex)
            / vertices.len() as f32;
        let radius = vertices
            .iter()
            .map(|vertex| vertex.distance(&center))
            .fold(0.0_f32, f32::max);
        let bounds = Sphere { center, radius };
        PlacedCollider::new(
            Arc::new(CollisionShape::Bsp(BspSolid {
                bsp: BspNode::Leaf(BspLeaf {
                    index: 0,
                    solid: 0,
                    sphere: Some(bounds),
                    poly_ids: vec![1],
                }),
                bounds,
                box_bounds: CollisionBox::from_points(vertices.iter().copied()).unwrap(),
                polygons: HashMap::from([(
                    1,
                    CollisionPolygon {
                        d: -normal.dot(&vertices[0]),
                        vertices,
                        normal,
                    },
                )]),
            })),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index },
        )
        .unwrap()
    }

    fn horizontal_platform(
        minimum: Vector3,
        maximum: Vector3,
        source_index: usize,
    ) -> PlacedCollider {
        polygon_collider(
            vec![
                Vector3::new(minimum.x, minimum.y, minimum.z),
                Vector3::new(maximum.x, minimum.y, minimum.z),
                Vector3::new(maximum.x, maximum.y, maximum.z),
                Vector3::new(minimum.x, maximum.y, maximum.z),
            ],
            Vector3::new(0.0, 0.0, 1.0),
            source_index,
        )
    }

    fn body_scene(
        collision: &CollisionScene,
        coords: Vector3,
        now: Instant,
    ) -> (SpatialScene, SpatialBodyId) {
        body_scene_in_cell(collision, OWNER, coords, None, now)
    }

    fn body_scene_in_cell(
        collision: &CollisionScene,
        pose_landblock_id: Guid,
        coords: Vector3,
        cell: Option<Guid>,
        now: Instant,
    ) -> (SpatialScene, SpatialBodyId) {
        let profile = retail_player_grounded_profile(EdgeProtection::None).unwrap();
        let mut scene = SpatialScene::new();
        let pose = WorldPosition {
            landblock_id: pose_landblock_id,
            coords,
            rotation: Quaternion::from_heading(0.0),
        };
        let body_id = scene.allocate_ephemeral_body_id();
        let mut body = SpatialBody::new_ephemeral(body_id, pose, now);
        body.contact = ContactState::Grounded;
        body.physical = Some(PhysicalBodyState::new(
            profile.definition,
            PhysicalCollisionFilter::ALL,
            profile.response_policy,
            cell,
        ));
        let PhysicalBodyResponseState::Grounded { ground, .. } =
            &mut body.physical.as_mut().unwrap().response
        else {
            panic!("player profile must retain grounded response")
        };
        *ground = GroundState::Supported(GroundSupport {
            normal: Vector3::new(0.0, 0.0, 1.0),
            proof: collision.owner_proof(OWNER).unwrap(),
        });
        scene.register_body(body);
        (scene, body_id)
    }

    fn downward_target(collision: &CollisionScene, point: Vector3) -> PreciseJumpStaticTarget {
        downward_target_in_cell(collision, point, None)
    }

    fn downward_target_in_cell(
        collision: &CollisionScene,
        point: Vector3,
        previous_cell: Option<Guid>,
    ) -> PreciseJumpStaticTarget {
        let hit = collision
            .cast_static_surface_ray(StaticSurfaceRayRequest {
                anchor: OWNER,
                start: Vector3::new(point.x, point.y, point.z + 5.0),
                direction: Vector3::new(0.0, 0.0, -1.0),
                maximum_distance: 10.0,
                previous_cell,
                filter: PhysicalCollisionFilter::ALL,
            })
            .unwrap()
            .unwrap();
        PreciseJumpStaticTarget::new(OWNER, hit).unwrap()
    }

    fn prediction(
        scene: &SpatialScene,
        collision: &CollisionScene,
        body_id: SpatialBodyId,
        target: &PreciseJumpStaticTarget,
        now: Instant,
    ) -> PreciseJumpPredictionOutcome {
        predict_precise_jump(PreciseJumpPredictionRequest {
            spatial_scene: scene,
            collision_scene: collision,
            body_id,
            capabilities: &capabilities(),
            target,
            budget: PreciseJumpPredictionBudget::new(
                PreciseJumpCandidateBudget::new(6).unwrap(),
                160,
            )
            .unwrap(),
            start_time: now,
        })
        .unwrap()
    }

    fn add_solid_dynamic_peer(scene: &mut SpatialScene, now: Instant) {
        let profile = retail_player_grounded_profile(EdgeProtection::None).unwrap();
        let peer_id = SpatialBodyId::Entity(Guid(0x5000_0001));
        scene.register_body(SpatialBody::new(
            peer_id,
            WorldPosition {
                landblock_id: OWNER,
                coords: Vector3::new(116.0, 96.0, 2.5),
                rotation: Quaternion::identity(),
            },
            now,
        ));
        let configuration = DynamicPhysicalBodyConfiguration::new(
            DynamicPhysicalBodyDefinition {
                movement: profile.definition,
                response_policy: profile.response_policy,
                entity_collision: DynamicBodyCollisionDefinition {
                    target_geometry: Arc::new(PreparedEntityTargetGeometry {
                        physics_bsp_parts: Vec::new(),
                        fallback_setup_did: 0x0200_0001,
                        fallback_shapes: vec![Arc::new(CollisionShape::Ball(CollisionBall {
                            center: Vector3::zero(),
                            radius: 2.0,
                        }))],
                        fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                    }),
                    dynamic_collision: EntityDynamicCollisionPolicy {
                        target: EntityCollisionParticipation::Solid,
                        mover_accepts_response: true,
                        accepts_peer_reports: true,
                        missile: false,
                        path_clipped: false,
                    },
                    reporting: EntityCollisionReportPolicy {
                        enabled: true,
                        as_environment: false,
                    },
                    uses_physics_bsp: false,
                    elasticity: PhysicalElasticity::DEFAULT,
                    default_animation_available: false,
                    default_script_available: false,
                },
            },
            LocalPhysicalDemand {
                target: LocalTargetDemand::Retained,
                integration: LocalIntegrationDemand::Excluded,
            },
        )
        .unwrap();
        scene
            .set_dynamic_physical_body(
                peer_id,
                Some(configuration),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }

    #[test]
    fn flat_terrain_prediction_matches_an_actual_static_solve_without_mutating_source() {
        let collision = collision_scene(0.0, Vec::new());
        let now = Instant::now();
        let start = Vector3::new(120.0, 96.0, 0.005);
        let (scene, body_id) = body_scene(&collision, start, now);
        let initial = scene.body(body_id).unwrap().clone();
        let target = downward_target(&collision, Vector3::new(114.0, 96.0, 0.0));

        let PhysicalBodyDefinition::Grounded { spheres, .. } =
            initial.physical.as_ref().unwrap().definition
        else {
            unreachable!()
        };
        let desired = desired_landing_body_point(&initial, &target, spheres.support);
        let analytic = generate_precise_jump_candidates(
            &capabilities(),
            initial.physical.as_ref().unwrap().definition,
            initial.pose.rotation.to_heading(),
            CharacterJumpReadiness::Supported,
            PreciseJumpWorldDisplacement::new(desired - initial.pose.coords).unwrap(),
            PreciseJumpCandidateBudget::new(6).unwrap(),
        );
        assert!(
            analytic.is_ok(),
            "desired={desired:?}, analytic={analytic:?}"
        );

        let outcome = prediction(&scene, &collision, body_id, &target, now);
        let PreciseJumpPredictionOutcome::Reachable(landing) = outcome else {
            panic!("flat in-range target must be reachable: {outcome:?}, target={target:?}")
        };
        assert!(landing.contact_point().distance(&target.hit().point) <= 0.48);
        assert_eq!(scene.body(body_id).unwrap(), &initial);

        let mut actual = scene.clone();
        let launch = GroundedLaunch::new(landing.candidate().world_velocity()).unwrap();
        for tick in 1..=landing.solver_ticks() {
            actual
                .tick_physical_body(
                    body_id,
                    &collision,
                    PhysicalBodyActuation::Grounded(if tick == 1 {
                        GroundedBodyActuation::coast().with_launch(launch)
                    } else {
                        GroundedBodyActuation::coast()
                    }),
                    PRECISE_JUMP_FIXED_TICK.as_secs_f32(),
                    now + PRECISE_JUMP_FIXED_TICK * tick,
                )
                .unwrap();
        }
        let actual_body = actual.body(body_id).unwrap();
        assert_eq!(actual_body.contact, ContactState::Grounded);
        let (_, actual_contact, _) = landing_contact(
            actual_body,
            match actual_body.physical.as_ref().unwrap().definition {
                PhysicalBodyDefinition::Grounded { spheres, .. } => spheres.support,
                PhysicalBodyDefinition::FreeSphere { .. } => unreachable!(),
            },
            OWNER,
        )
        .unwrap();
        assert!(actual_contact.distance(&landing.contact_point()) < 0.000_1);
    }

    #[test]
    fn static_preview_explicitly_excludes_dynamic_peer_bodies() {
        let collision = collision_scene(0.0, Vec::new());
        let now = Instant::now();
        let start = Vector3::new(120.0, 96.0, 0.005);
        let (scene, body_id) = body_scene(&collision, start, now);
        let target = downward_target(&collision, Vector3::new(114.0, 96.0, 0.0));
        let without_peer = prediction(&scene, &collision, body_id, &target, now);

        let mut with_peer = scene;
        add_solid_dynamic_peer(&mut with_peer, now);

        assert!(matches!(
            without_peer,
            PreciseJumpPredictionOutcome::Reachable(_)
        ));
        assert_eq!(
            prediction(&with_peer, &collision, body_id, &target, now),
            without_peer
        );
    }

    #[test]
    fn non_walkable_target_is_proven_without_spending_solver_ticks() {
        let wall = polygon_collider(
            vec![
                Vector3::new(114.0, 94.0, 0.0),
                Vector3::new(114.0, 98.0, 0.0),
                Vector3::new(114.0, 98.0, 4.0),
                Vector3::new(114.0, 94.0, 4.0),
            ],
            Vector3::new(1.0, 0.0, 0.0),
            0,
        );
        let collision = collision_scene(0.0, vec![wall]);
        let now = Instant::now();
        let (scene, body_id) = body_scene(&collision, Vector3::new(120.0, 96.0, 0.005), now);
        let hit = collision
            .cast_static_surface_ray(StaticSurfaceRayRequest {
                anchor: OWNER,
                start: Vector3::new(120.0, 96.0, 2.0),
                direction: Vector3::new(-1.0, 0.0, 0.0),
                maximum_distance: 10.0,
                previous_cell: None,
                filter: PhysicalCollisionFilter::ALL,
            })
            .unwrap()
            .unwrap();
        let target = PreciseJumpStaticTarget::new(OWNER, hit).unwrap();

        assert_eq!(
            prediction(&scene, &collision, body_id, &target, now),
            PreciseJumpPredictionOutcome::Unreachable(
                PreciseJumpUnreachableReason::TargetSurfaceNotWalkable
            )
        );
    }

    #[test]
    fn exhausted_work_and_stale_collision_remain_unproven() {
        let collision = collision_scene(0.0, Vec::new());
        let now = Instant::now();
        let (scene, body_id) = body_scene(&collision, Vector3::new(120.0, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(114.0, 96.0, 0.0));
        let outcome = predict_precise_jump(PreciseJumpPredictionRequest {
            spatial_scene: &scene,
            collision_scene: &collision,
            body_id,
            capabilities: &capabilities(),
            target: &target,
            budget: PreciseJumpPredictionBudget::new(
                PreciseJumpCandidateBudget::new(1).unwrap(),
                1,
            )
            .unwrap(),
            start_time: now,
        })
        .unwrap();
        assert_eq!(
            outcome,
            PreciseJumpPredictionOutcome::Unproven(PreciseJumpUnprovenReason::WorkBudgetExhausted)
        );

        let replacement = collision_scene(0.0, Vec::new());
        assert_eq!(
            prediction(&scene, &replacement, body_id, &target, now),
            PreciseJumpPredictionOutcome::Unproven(PreciseJumpUnprovenReason::StaleTargetCollision)
        );
    }

    #[test]
    fn missing_static_coverage_is_unproven_instead_of_red() {
        let collision = collision_scene(0.0, Vec::new());
        let now = Instant::now();
        let (scene, body_id) = body_scene(&collision, Vector3::new(4.0, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(0.2, 96.0, 0.0));

        assert_eq!(
            prediction(&scene, &collision, body_id, &target, now),
            PreciseJumpPredictionOutcome::Unproven(
                PreciseJumpUnprovenReason::CollisionUnavailable {
                    owner: Guid(0xd955_ffff),
                }
            )
        );
    }

    #[test]
    fn env_cell_floor_uses_the_same_first_landing_solver() {
        let cell = Guid(0xda55_0100);
        let mut floor = horizontal_platform(
            Vector3::new(108.0, 92.0, 0.0),
            Vector3::new(124.0, 100.0, 0.0),
            0,
        );
        floor.source_placement = StaticColliderPlacement::EnvCellShell { cell_id: cell.0 };
        let mut collision = CollisionScene::new();
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: OWNER.0,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders {
                    colliders: vec![floor],
                    cell_volumes: vec![CellVolume {
                        cell_selector: cell.0 as u16,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: Vec::new(),
                        portals: Vec::new(),
                    }],
                },
            })
            .unwrap();
        let now = Instant::now();
        let (scene, body_id) = body_scene_in_cell(
            &collision,
            cell,
            Vector3::new(120.0, 96.0, 0.005),
            Some(cell),
            now,
        );
        let target =
            downward_target_in_cell(&collision, Vector3::new(114.0, 96.0, 0.0), Some(cell));

        let PreciseJumpPredictionOutcome::Reachable(landing) =
            prediction(&scene, &collision, body_id, &target, now)
        else {
            panic!("EnvCell floor target must be reachable")
        };
        assert_eq!(target.hit().placement.committed_cell(), Some(cell));
        assert!(landing.contact_point().distance(&target.hit().point) <= 0.48);
    }

    #[test]
    fn elevated_and_lower_static_ledges_are_reached_by_the_first_landing() {
        let elevated = horizontal_platform(
            Vector3::new(112.0, 94.0, 1.0),
            Vector3::new(116.0, 98.0, 1.0),
            0,
        );
        let collision = collision_scene(0.0, vec![elevated]);
        let now = Instant::now();
        let (scene, body_id) = body_scene(&collision, Vector3::new(120.0, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(114.0, 96.0, 1.0));
        let PreciseJumpPredictionOutcome::Reachable(elevated_landing) =
            prediction(&scene, &collision, body_id, &target, now)
        else {
            panic!("elevated ledge must be reachable")
        };
        assert!(elevated_landing.contact_point().z > 0.99);

        let start_platform = horizontal_platform(
            Vector3::new(118.0, 94.0, 2.0),
            Vector3::new(122.0, 98.0, 2.0),
            0,
        );
        let collision = collision_scene(0.0, vec![start_platform]);
        let (scene, body_id) = body_scene(&collision, Vector3::new(120.0, 96.0, 2.005), now);
        let target = downward_target(&collision, Vector3::new(114.0, 96.0, 0.0));
        let PreciseJumpPredictionOutcome::Reachable(lower_landing) =
            prediction(&scene, &collision, body_id, &target, now)
        else {
            panic!("lower ledge must be reachable")
        };
        assert!(lower_landing.contact_point().z.abs() < 0.001);
    }

    #[test]
    fn wall_and_low_ceiling_prove_every_legal_arc_obstructed() {
        let wall = polygon_collider(
            vec![
                Vector3::new(117.0, 94.0, 0.0),
                Vector3::new(117.0, 98.0, 0.0),
                Vector3::new(117.0, 98.0, 8.0),
                Vector3::new(117.0, 94.0, 8.0),
            ],
            Vector3::new(1.0, 0.0, 0.0),
            0,
        );
        let now = Instant::now();
        for (label, collision) in [
            ("wall", collision_scene(0.0, vec![wall])),
            (
                "ceiling",
                collision_scene(
                    0.0,
                    vec![polygon_collider(
                        vec![
                            Vector3::new(112.0, 94.0, 2.0),
                            Vector3::new(112.0, 98.0, 2.0),
                            Vector3::new(121.0, 98.0, 2.0),
                            Vector3::new(121.0, 94.0, 2.0),
                        ],
                        Vector3::new(0.0, 0.0, -1.0),
                        0,
                    )],
                ),
            ),
        ] {
            if label == "wall" {
                let sweep = collision
                    .sweep_static_sphere(holtburger_world::StaticSphereSweepRequest {
                        anchor: OWNER,
                        start: Vector3::new(120.0, 96.0, 2.5),
                        end: Vector3::new(114.0, 96.0, 2.5),
                        previous_cell: None,
                        radius: 0.48,
                        filter: PhysicalCollisionFilter::ALL,
                    })
                    .unwrap();
                assert!(
                    sweep.is_some(),
                    "wall fixture must obstruct a direct sphere sweep"
                );
            }
            let (scene, body_id) = body_scene(&collision, Vector3::new(120.0, 96.0, 0.005), now);
            let target = downward_target(&collision, Vector3::new(114.0, 96.0, 0.0));
            let outcome = prediction(&scene, &collision, body_id, &target, now);
            assert_eq!(
                outcome,
                PreciseJumpPredictionOutcome::Unreachable(
                    PreciseJumpUnreachableReason::AllCandidatesFailed {
                        final_failure: PreciseJumpCandidateFailure::Obstructed,
                    }
                ),
                "{label}: {outcome:?}"
            );
        }
    }

    #[test]
    fn candidate_stops_at_its_first_walkable_landing() {
        let platform = horizontal_platform(
            Vector3::new(114.0, 94.0, 2.5),
            Vector3::new(118.0, 98.0, 2.5),
            0,
        );
        let collision = collision_scene(0.0, vec![platform]);
        let now = Instant::now();
        let (scene, body_id) = body_scene(&collision, Vector3::new(120.0, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(113.0, 96.0, 0.0));

        let lowest_arc = predict_precise_jump(PreciseJumpPredictionRequest {
            spatial_scene: &scene,
            collision_scene: &collision,
            body_id,
            capabilities: &capabilities(),
            target: &target,
            budget: PreciseJumpPredictionBudget::new(
                PreciseJumpCandidateBudget::new(1).unwrap(),
                160,
            )
            .unwrap(),
            start_time: now,
        })
        .unwrap();
        assert_eq!(
            lowest_arc,
            PreciseJumpPredictionOutcome::Unreachable(
                PreciseJumpUnreachableReason::AllCandidatesFailed {
                    final_failure: PreciseJumpCandidateFailure::FirstLandingMissedTarget,
                }
            )
        );
        assert!(matches!(
            prediction(&scene, &collision, body_id, &target, now),
            PreciseJumpPredictionOutcome::Unreachable(_)
        ));
    }

    #[test]
    fn steep_intervening_contact_is_not_reported_as_a_landing() {
        let steep_face = polygon_collider(
            vec![
                Vector3::new(118.0, 94.0, 0.0),
                Vector3::new(118.0, 98.0, 0.0),
                Vector3::new(114.0, 98.0, 8.0),
                Vector3::new(114.0, 94.0, 8.0),
            ],
            Vector3::new(2.0 / 5.0_f32.sqrt(), 0.0, 1.0 / 5.0_f32.sqrt()),
            0,
        );
        let collision = collision_scene(0.0, vec![steep_face]);
        let now = Instant::now();
        let (scene, body_id) = body_scene(&collision, Vector3::new(120.0, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(113.0, 96.0, 0.0));
        let outcome = predict_precise_jump(PreciseJumpPredictionRequest {
            spatial_scene: &scene,
            collision_scene: &collision,
            body_id,
            capabilities: &capabilities(),
            target: &target,
            budget: PreciseJumpPredictionBudget::new(
                PreciseJumpCandidateBudget::new(1).unwrap(),
                160,
            )
            .unwrap(),
            start_time: now,
        })
        .unwrap();

        assert_eq!(
            outcome,
            PreciseJumpPredictionOutcome::Unreachable(
                PreciseJumpUnreachableReason::AllCandidatesFailed {
                    final_failure: PreciseJumpCandidateFailure::SlidingContact,
                }
            )
        );
    }

    #[test]
    fn body_sized_narrow_clearance_remains_reachable() {
        let walls = vec![
            polygon_collider(
                vec![
                    Vector3::new(112.0, 95.45, 0.0),
                    Vector3::new(112.0, 95.45, 4.0),
                    Vector3::new(121.0, 95.45, 4.0),
                    Vector3::new(121.0, 95.45, 0.0),
                ],
                Vector3::new(0.0, 1.0, 0.0),
                0,
            ),
            polygon_collider(
                vec![
                    Vector3::new(112.0, 96.55, 0.0),
                    Vector3::new(121.0, 96.55, 0.0),
                    Vector3::new(121.0, 96.55, 4.0),
                    Vector3::new(112.0, 96.55, 4.0),
                ],
                Vector3::new(0.0, -1.0, 0.0),
                1,
            ),
        ];
        let collision = collision_scene(0.0, walls);
        let now = Instant::now();
        let (scene, body_id) = body_scene(&collision, Vector3::new(120.0, 96.0, 0.005), now);
        let target = downward_target(&collision, Vector3::new(114.0, 96.0, 0.0));

        assert!(matches!(
            prediction(&scene, &collision, body_id, &target, now),
            PreciseJumpPredictionOutcome::Reachable(_)
        ));
    }
}
