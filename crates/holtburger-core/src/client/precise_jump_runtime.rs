//! Replaceable precise-jump preview work and ordered commit authority.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

use holtburger_common::properties::WorldObjectExt as _;
use holtburger_common::{Guid, Vector3};
use holtburger_world::state::SelfJumpCapabilities;
use holtburger_world::{
    CollisionQueryError, ContactState, PhysicalBodyDefinition, PhysicalCollisionFilter,
    SpatialBodyId, SpatialScene, StaticSurfaceRayRequest, WorldState,
};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use super::camera::ClientCameraIdentity;
use super::character_jump::ResolvedJump;
use super::precise_jump::PreciseJumpCandidateBudget;
use super::precise_jump_prediction::{
    PreciseJumpPredictionBudget, PreciseJumpPredictionDiagnostics, PreciseJumpPredictionOutcome,
    PreciseJumpPredictionRequest, PreciseJumpTarget, PreciseJumpTrajectory, diagnose_precise_jump,
};
use crate::{DynamicEntityCategory, SimulationSceneSnapshot, semantic_dynamic_entity_category};

const PRECISE_JUMP_CANDIDATES: usize = 6;
const PRECISE_JUMP_MAXIMUM_TICKS: usize = 160;

/// Monotonic pointer sample within one precise-jump mode session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PreciseJumpAimSequence(pub u64);

/// Core-issued identity for one published target evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct PreciseJumpEvaluationId(u64);

impl PreciseJumpEvaluationId {
    /// Rehydrates an opaque renderer-returned identity; core still verifies retained ownership.
    pub const fn from_wire(value: u64) -> Self {
        Self(value)
    }

    /// Projects this identity through the narrow host wire boundary.
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// Monotonic non-coalescible commit/cancel edge within one precise-jump mode session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PreciseJumpActionSequence(pub u64);

/// Camera ray supplied by the presentation; collision filtering remains core-owned.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpAimRequest {
    pub camera: ClientCameraIdentity,
    pub sequence: PreciseJumpAimSequence,
    /// Normalized outdoor frame containing `start`.
    pub anchor: Guid,
    /// Camera-ray origin in `anchor`-local coordinates.
    pub start: Vector3,
    /// Finite unit world-axis ray direction.
    pub direction: Vector3,
    /// Finite non-negative ray length in metres.
    pub maximum_distance: f32,
    /// Camera's last committed interior cell, or `None` outdoors.
    pub previous_cell: Option<Guid>,
}

/// Explicit request to authorize one previously published reachable target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreciseJumpCommitRequest {
    pub sequence: PreciseJumpActionSequence,
    pub evaluation: PreciseJumpEvaluationId,
}

/// Explicit request to discard precise-jump state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreciseJumpCancelRequest {
    pub sequence: PreciseJumpActionSequence,
}

/// Renderer-safe target facts; launch velocity and collision source never cross this boundary.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpTargetView {
    pub anchor: Guid,
    pub point: Vector3,
    pub normal: Vector3,
    pub committed_cell: Option<Guid>,
}

/// Semantic marker state. `Unproven` is intentionally distinct from red/unreachable.
#[derive(Debug, Clone, PartialEq)]
pub enum PreciseJumpEvaluationStatus {
    NoSurface,
    Reachable(PreciseJumpTrajectory),
    Unreachable(super::precise_jump_prediction::PreciseJumpUnreachableReason),
    Unproven(super::precise_jump_prediction::PreciseJumpUnprovenReason),
    InvalidAim,
    SolverFailed,
}

/// One correlated replacement result for the latest accepted aim sample.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpEvaluation {
    pub id: PreciseJumpEvaluationId,
    pub camera: ClientCameraIdentity,
    pub sequence: PreciseJumpAimSequence,
    pub target: Option<PreciseJumpTargetView>,
    pub status: PreciseJumpEvaluationStatus,
    pub diagnostics: PreciseJumpPredictionDiagnostics,
}

/// Why an ordered commit/cancel edge did not launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreciseJumpTransactionRejection {
    StaleAction,
    CommitPending,
    NoReachableEvaluation,
    EvaluationMismatch,
    AuthorityChanged,
    FreshResolutionRejected,
    LaunchRejected,
}

/// Core-owned result of one ordered precise-jump action.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreciseJumpTransactionOutcome {
    Cancelled,
    Committed,
    Rejected(PreciseJumpTransactionRejection),
}

/// Feedback used by presentation to leave or retain precise-jump mode deterministically.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreciseJumpTransactionFeedback {
    pub sequence: PreciseJumpActionSequence,
    pub outcome: PreciseJumpTransactionOutcome,
}

#[derive(Clone)]
struct PreciseJumpAuthority {
    world_generation: u64,
    camera: ClientCameraIdentity,
    player: Guid,
    instance_sequence: u16,
    collision_revision: u64,
    body_definition: PhysicalBodyDefinition,
    collision_filter: PhysicalCollisionFilter,
    contact: ContactState,
    pose: holtburger_common::position::WorldPosition,
    movement_tolerance: f32,
    capabilities: SelfJumpCapabilities,
}

struct PreciseJumpWork {
    generation: u64,
    evaluation_id: PreciseJumpEvaluationId,
    aim: PreciseJumpAimRequest,
    authority: PreciseJumpAuthority,
    spatial_scene: SpatialScene,
    targetable_entities: BTreeMap<SpatialBodyId, u16>,
    collision: Arc<SimulationSceneSnapshot>,
    start_time: Instant,
}

struct PreciseJumpCompletion {
    generation: u64,
    authority: PreciseJumpAuthority,
    retained: Option<RetainedPreciseJumpEvaluation>,
    evaluation: PreciseJumpEvaluation,
}

#[derive(Clone)]
struct RetainedPreciseJumpEvaluation {
    id: PreciseJumpEvaluationId,
    authority: PreciseJumpAuthority,
    target: PreciseJumpTarget,
    /// Server object generation owning an entity-backed target; absent for environment targets.
    target_entity: Option<(Guid, u16)>,
}

/// Fresh launch returned only after a retained target is solved again against current authority.
pub(super) struct PreparedPreciseJumpCommit {
    pub sequence: PreciseJumpActionSequence,
    pub resolved: ResolvedJump,
}

/// One blocking worker plus one replaceable latest sample; pointer history is never queued.
pub(super) struct PreciseJumpRuntime {
    completion_tx: UnboundedSender<PreciseJumpCompletion>,
    completion_rx: UnboundedReceiver<PreciseJumpCompletion>,
    worker: Option<tokio::task::JoinHandle<()>>,
    queued_latest: Option<PreciseJumpWork>,
    next_generation: u64,
    next_evaluation_id: u64,
    latest_aim: Option<(ClientCameraIdentity, PreciseJumpAimSequence)>,
    retained: Option<RetainedPreciseJumpEvaluation>,
    last_action: Option<PreciseJumpActionSequence>,
    pending_commit: Option<PreciseJumpCommitRequest>,
}

impl PreciseJumpRuntime {
    pub(super) fn new() -> Self {
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        Self {
            completion_tx,
            completion_rx,
            worker: None,
            queued_latest: None,
            next_generation: 0,
            next_evaluation_id: 0,
            latest_aim: None,
            retained: None,
            last_action: None,
            pending_commit: None,
        }
    }

    pub(super) fn submit_aim(
        &mut self,
        aim: PreciseJumpAimRequest,
        world_generation: u64,
        active_camera: Option<ClientCameraIdentity>,
        world: &WorldState,
        collision: Option<Arc<SimulationSceneSnapshot>>,
    ) -> Option<PreciseJumpEvaluation> {
        if self.pending_commit.is_some() {
            return None;
        }
        if active_camera != Some(aim.camera)
            || self
                .latest_aim
                .is_some_and(|(camera, sequence)| camera == aim.camera && sequence >= aim.sequence)
        {
            return None;
        }
        self.latest_aim = Some((aim.camera, aim.sequence));
        let Some(collision) = collision else {
            self.retained = None;
            return Some(self.immediate_evaluation(aim, PreciseJumpEvaluationStatus::SolverFailed));
        };
        let Some(authority) = capture_authority(world_generation, aim.camera, world, &collision)
        else {
            self.retained = None;
            return Some(self.immediate_evaluation(aim, PreciseJumpEvaluationStatus::SolverFailed));
        };
        self.next_generation = self
            .next_generation
            .checked_add(1)
            .expect("precise-jump work generation exhausted");
        let evaluation_id = self.allocate_evaluation_id();
        let work = PreciseJumpWork {
            generation: self.next_generation,
            evaluation_id,
            aim,
            authority,
            spatial_scene: world.scene.clone(),
            targetable_entities: targetable_precise_jump_entities(world),
            collision,
            start_time: Instant::now(),
        };
        if self.worker.is_some() {
            self.queued_latest = Some(work);
        } else {
            self.start(work);
        }
        None
    }

    pub(super) fn poll(
        &mut self,
        world_generation: u64,
        active_camera: Option<ClientCameraIdentity>,
        world: &WorldState,
        collision: Option<&SimulationSceneSnapshot>,
    ) -> Vec<PreciseJumpEvaluation> {
        let mut published = Vec::new();
        let retained_is_fresh = self.retained.as_ref().is_some_and(|retained| {
            current_authority(
                &retained.authority,
                world_generation,
                active_camera,
                world,
                collision,
            ) && target_is_current(retained, world, collision)
        });
        if self.retained.is_some() && !retained_is_fresh {
            self.retained = None;
        }
        while let Ok(completion) = self.completion_rx.try_recv() {
            self.worker = None;
            let latest = self.latest_aim.is_some_and(|(camera, sequence)| {
                camera == completion.evaluation.camera
                    && sequence == completion.evaluation.sequence
                    && completion.generation == self.next_generation
            });
            if latest {
                let authority_is_current = current_authority(
                    &completion.authority,
                    world_generation,
                    active_camera,
                    world,
                    collision,
                ) && completion
                    .retained
                    .as_ref()
                    .is_none_or(|retained| target_is_current(retained, world, collision));
                if authority_is_current {
                    self.retained = completion.retained;
                    published.push(completion.evaluation);
                } else {
                    self.retained = None;
                    published.push(PreciseJumpEvaluation {
                        target: None,
                        status: PreciseJumpEvaluationStatus::Unproven(
                            super::precise_jump_prediction::PreciseJumpUnprovenReason::AuthorityChanged,
                        ),
                        ..completion.evaluation
                    });
                }
            }
            if let Some(work) = self.queued_latest.take() {
                self.start(work);
            }
        }
        published
    }

    pub(super) fn cancel(
        &mut self,
        request: PreciseJumpCancelRequest,
    ) -> PreciseJumpTransactionFeedback {
        if !self.accept_action(request.sequence) {
            return rejected(
                request.sequence,
                PreciseJumpTransactionRejection::StaleAction,
            );
        }
        self.invalidate();
        PreciseJumpTransactionFeedback {
            sequence: request.sequence,
            outcome: PreciseJumpTransactionOutcome::Cancelled,
        }
    }

    pub(super) fn queue_commit(
        &mut self,
        request: PreciseJumpCommitRequest,
    ) -> Option<PreciseJumpTransactionFeedback> {
        if !self.accept_action(request.sequence) {
            return Some(rejected(
                request.sequence,
                PreciseJumpTransactionRejection::StaleAction,
            ));
        }
        if self.pending_commit.is_some() {
            return Some(rejected(
                request.sequence,
                PreciseJumpTransactionRejection::CommitPending,
            ));
        }
        let Some(retained) = self.retained.as_ref() else {
            return Some(rejected(
                request.sequence,
                PreciseJumpTransactionRejection::NoReachableEvaluation,
            ));
        };
        if retained.id != request.evaluation {
            return Some(rejected(
                request.sequence,
                PreciseJumpTransactionRejection::EvaluationMismatch,
            ));
        }
        self.accept_valid_commit(request);
        None
    }

    pub(super) fn prepare_queued_commit(
        &mut self,
        world_generation: u64,
        active_camera: Option<ClientCameraIdentity>,
        world: &WorldState,
        collision: Option<&SimulationSceneSnapshot>,
        now: Instant,
    ) -> Option<Result<PreparedPreciseJumpCommit, PreciseJumpTransactionFeedback>> {
        let request = self.pending_commit.take()?;
        Some(self.prepare_accepted_commit(
            request,
            world_generation,
            active_camera,
            world,
            collision,
            now,
        ))
    }

    fn prepare_accepted_commit(
        &mut self,
        request: PreciseJumpCommitRequest,
        world_generation: u64,
        active_camera: Option<ClientCameraIdentity>,
        world: &WorldState,
        collision: Option<&SimulationSceneSnapshot>,
        now: Instant,
    ) -> Result<PreparedPreciseJumpCommit, PreciseJumpTransactionFeedback> {
        let reject = |reason| rejected(request.sequence, reason);
        let retained = self
            .retained
            .take()
            .ok_or_else(|| reject(PreciseJumpTransactionRejection::NoReachableEvaluation))?;
        if retained.id != request.evaluation {
            return Err(reject(PreciseJumpTransactionRejection::EvaluationMismatch));
        }
        let collision =
            collision.ok_or_else(|| reject(PreciseJumpTransactionRejection::AuthorityChanged))?;
        let current = capture_authority(
            world_generation,
            retained.authority.camera,
            world,
            collision,
        )
        .ok_or_else(|| reject(PreciseJumpTransactionRejection::AuthorityChanged))?;
        if active_camera != Some(retained.authority.camera)
            || !retained.authority.is_fresh(&current)
            || !target_is_current(&retained, world, Some(collision))
        {
            return Err(reject(PreciseJumpTransactionRejection::AuthorityChanged));
        }
        let entity_collision = world
            .scene
            .entity_collision_snapshot()
            .map_err(|_| reject(PreciseJumpTransactionRejection::FreshResolutionRejected))?;
        let evaluation = diagnose_precise_jump(PreciseJumpPredictionRequest {
            spatial_scene: &world.scene,
            collision_scene: collision.scene.as_ref(),
            entity_collision: &entity_collision,
            body_id: SpatialBodyId::LocalPlayer(world.player.guid),
            capabilities: &current.capabilities,
            target: &retained.target,
            budget: prediction_budget(),
            start_time: now,
        })
        .map_err(|_| reject(PreciseJumpTransactionRejection::FreshResolutionRejected))?;
        let PreciseJumpPredictionOutcome::Reachable(landing) = evaluation.outcome() else {
            return Err(reject(
                PreciseJumpTransactionRejection::FreshResolutionRejected,
            ));
        };
        Ok(PreparedPreciseJumpCommit {
            sequence: request.sequence,
            resolved: ResolvedJump::from_precise_candidate(landing.candidate()),
        })
    }

    pub(super) fn invalidate(&mut self) {
        self.discard_preview_work();
        self.retained = None;
        self.pending_commit = None;
    }

    fn discard_preview_work(&mut self) {
        self.next_generation = self.next_generation.saturating_add(1);
        self.queued_latest = None;
        self.latest_aim = None;
        self.worker.take().inspect(|worker| worker.abort());
    }

    fn accept_valid_commit(&mut self, request: PreciseJumpCommitRequest) {
        self.pending_commit = Some(request);
        // The displayed evaluation owns this commit. Retire replacement preview work so a newer
        // completion cannot replace its retained authority before the simulation tick consumes it.
        self.discard_preview_work();
    }

    fn accept_action(&mut self, sequence: PreciseJumpActionSequence) -> bool {
        if self.last_action.is_some_and(|last| sequence <= last) {
            return false;
        }
        self.last_action = Some(sequence);
        true
    }

    fn allocate_evaluation_id(&mut self) -> PreciseJumpEvaluationId {
        self.next_evaluation_id = self
            .next_evaluation_id
            .checked_add(1)
            .expect("precise-jump evaluation identity exhausted");
        PreciseJumpEvaluationId(self.next_evaluation_id)
    }

    fn immediate_evaluation(
        &mut self,
        aim: PreciseJumpAimRequest,
        status: PreciseJumpEvaluationStatus,
    ) -> PreciseJumpEvaluation {
        PreciseJumpEvaluation {
            id: self.allocate_evaluation_id(),
            camera: aim.camera,
            sequence: aim.sequence,
            target: None,
            status,
            diagnostics: PreciseJumpPredictionDiagnostics::default(),
        }
    }

    fn start(&mut self, work: PreciseJumpWork) {
        let tx = self.completion_tx.clone();
        self.worker = Some(tokio::spawn(async move {
            let generation = work.generation;
            let fallback = PreciseJumpCompletion {
                generation,
                authority: work.authority.clone(),
                retained: None,
                evaluation: base_evaluation(&work, PreciseJumpEvaluationStatus::SolverFailed),
            };
            let completion = tokio::task::spawn_blocking(move || evaluate(work))
                .await
                .unwrap_or(fallback);
            let _ = tx.send(completion);
        }));
    }
}

impl PreciseJumpAuthority {
    /// All authority facts are exact except translation, whose named consumer is marker staleness.
    fn is_fresh(&self, current: &Self) -> bool {
        self.world_generation == current.world_generation
            && self.camera == current.camera
            && self.player == current.player
            && self.instance_sequence == current.instance_sequence
            && self.collision_revision == current.collision_revision
            && self.body_definition == current.body_definition
            && self.collision_filter == current.collision_filter
            && self.contact == current.contact
            && self.capabilities == current.capabilities
            && self.pose.landblock_id == current.pose.landblock_id
            && self.pose.rotation == current.pose.rotation
            && self.pose.coords.distance(&current.pose.coords) <= self.movement_tolerance
    }
}

fn capture_authority(
    world_generation: u64,
    camera: ClientCameraIdentity,
    world: &WorldState,
    collision: &SimulationSceneSnapshot,
) -> Option<PreciseJumpAuthority> {
    let player = world.player.guid;
    let body = world.scene.body(SpatialBodyId::LocalPlayer(player))?;
    let physical = body.physical.as_ref()?;
    let PhysicalBodyDefinition::Grounded { spheres, .. } = physical.definition else {
        return None;
    };
    Some(PreciseJumpAuthority {
        world_generation,
        camera,
        player,
        instance_sequence: world.player.instance_sequence,
        collision_revision: collision.revision,
        body_definition: physical.definition,
        collision_filter: physical.collision_filter,
        contact: body.contact,
        pose: body.pose,
        movement_tolerance: spheres.support.radius,
        capabilities: world.resolve_self_jump_capabilities().ok()?,
    })
}

fn targetable_precise_jump_entities(world: &WorldState) -> BTreeMap<SpatialBodyId, u16> {
    world
        .entities
        .iter()
        .filter(|entity| {
            semantic_dynamic_entity_category(entity.flags, entity.item_type())
                == DynamicEntityCategory::Other
        })
        .map(|entity| {
            (
                SpatialBodyId::Entity(entity.guid),
                entity.instance_sequence(),
            )
        })
        .collect()
}

fn target_is_current(
    retained: &RetainedPreciseJumpEvaluation,
    world: &WorldState,
    collision: Option<&SimulationSceneSnapshot>,
) -> bool {
    let target_entity_is_current = retained.target_entity.is_none_or(|(guid, generation)| {
        world
            .entities
            .get(guid)
            .is_some_and(|entity| entity.instance_sequence() == generation)
    });
    target_entity_is_current
        && collision.is_some_and(|collision| {
            retained
                .target
                .is_current(&world.scene, collision.scene.as_ref())
        })
}

fn evaluate(work: PreciseJumpWork) -> PreciseJumpCompletion {
    let ray = StaticSurfaceRayRequest {
        anchor: work.aim.anchor,
        start: work.aim.start,
        direction: work.aim.direction,
        maximum_distance: work.aim.maximum_distance,
        previous_cell: work.aim.previous_cell,
        filter: work.authority.collision_filter,
    };
    let entity_collision = match work.spatial_scene.entity_collision_snapshot() {
        Ok(snapshot) => snapshot,
        Err(_) => {
            return PreciseJumpCompletion {
                generation: work.generation,
                authority: work.authority.clone(),
                retained: None,
                evaluation: base_evaluation(&work, PreciseJumpEvaluationStatus::SolverFailed),
            };
        }
    };
    let hit = match work
        .collision
        .scene
        .cast_surface_ray(&entity_collision, ray, |body_id| {
            work.targetable_entities.contains_key(&body_id)
        }) {
        Ok(Some(hit)) => hit,
        Ok(None) => {
            return PreciseJumpCompletion {
                generation: work.generation,
                authority: work.authority.clone(),
                retained: None,
                evaluation: base_evaluation(&work, PreciseJumpEvaluationStatus::NoSurface),
            };
        }
        Err(error) => {
            let status = match error.downcast_ref::<CollisionQueryError>() {
                Some(
                    CollisionQueryError::NonFiniteCenter
                    | CollisionQueryError::InvalidDistance
                    | CollisionQueryError::NonFiniteDirection
                    | CollisionQueryError::UnnormalizedDirection,
                ) => PreciseJumpEvaluationStatus::InvalidAim,
                Some(_) | None => PreciseJumpEvaluationStatus::SolverFailed,
            };
            return PreciseJumpCompletion {
                generation: work.generation,
                authority: work.authority.clone(),
                retained: None,
                evaluation: base_evaluation(&work, status),
            };
        }
    };
    let target_entity = match &hit {
        holtburger_world::CollisionSurfaceRayHit::Environment(_) => None,
        holtburger_world::CollisionSurfaceRayHit::Entity(hit) => {
            let SpatialBodyId::Entity(guid) = hit.proof.body_id() else {
                unreachable!("entity collision proof must identify an entity body")
            };
            Some((
                guid,
                *work
                    .targetable_entities
                    .get(&hit.proof.body_id())
                    .expect("selected entity must have a captured server generation"),
            ))
        }
    };
    let target_view = PreciseJumpTargetView {
        anchor: work.aim.anchor,
        point: hit.point(),
        normal: hit.normal(),
        committed_cell: hit.placement().committed_cell(),
    };
    let target = match PreciseJumpTarget::new(work.aim.anchor, hit) {
        Ok(target) => target,
        Err(_) => {
            return PreciseJumpCompletion {
                generation: work.generation,
                authority: work.authority.clone(),
                retained: None,
                evaluation: base_evaluation(&work, PreciseJumpEvaluationStatus::InvalidAim),
            };
        }
    };
    let prediction = diagnose_precise_jump(PreciseJumpPredictionRequest {
        spatial_scene: &work.spatial_scene,
        collision_scene: work.collision.scene.as_ref(),
        entity_collision: &entity_collision,
        body_id: SpatialBodyId::LocalPlayer(work.authority.player),
        capabilities: &work.authority.capabilities,
        target: &target,
        budget: prediction_budget(),
        start_time: work.start_time,
    });
    let (status, diagnostics, retained) = match prediction {
        Ok(evaluation) => {
            let (outcome, diagnostics) = evaluation.into_parts();
            match outcome {
                PreciseJumpPredictionOutcome::Reachable(landing) => (
                    PreciseJumpEvaluationStatus::Reachable(landing.trajectory().clone()),
                    diagnostics,
                    Some(RetainedPreciseJumpEvaluation {
                        id: work.evaluation_id,
                        authority: work.authority.clone(),
                        target,
                        target_entity,
                    }),
                ),
                PreciseJumpPredictionOutcome::Unreachable(reason) => (
                    PreciseJumpEvaluationStatus::Unreachable(reason),
                    diagnostics,
                    None,
                ),
                PreciseJumpPredictionOutcome::Unproven(reason) => (
                    PreciseJumpEvaluationStatus::Unproven(reason),
                    diagnostics,
                    None,
                ),
            }
        }
        Err(_) => (
            PreciseJumpEvaluationStatus::SolverFailed,
            PreciseJumpPredictionDiagnostics::default(),
            None,
        ),
    };
    PreciseJumpCompletion {
        generation: work.generation,
        authority: work.authority,
        retained,
        evaluation: PreciseJumpEvaluation {
            id: work.evaluation_id,
            camera: work.aim.camera,
            sequence: work.aim.sequence,
            target: Some(target_view),
            status,
            diagnostics,
        },
    }
}

fn current_authority(
    expected: &PreciseJumpAuthority,
    world_generation: u64,
    active_camera: Option<ClientCameraIdentity>,
    world: &WorldState,
    collision: Option<&SimulationSceneSnapshot>,
) -> bool {
    if active_camera != Some(expected.camera) {
        return false;
    }
    collision
        .and_then(|collision| {
            capture_authority(world_generation, expected.camera, world, collision)
        })
        .is_some_and(|current| expected.is_fresh(&current))
}

fn base_evaluation(
    work: &PreciseJumpWork,
    status: PreciseJumpEvaluationStatus,
) -> PreciseJumpEvaluation {
    PreciseJumpEvaluation {
        id: work.evaluation_id,
        camera: work.aim.camera,
        sequence: work.aim.sequence,
        target: None,
        status,
        diagnostics: PreciseJumpPredictionDiagnostics::default(),
    }
}

fn prediction_budget() -> PreciseJumpPredictionBudget {
    PreciseJumpPredictionBudget::new(
        PreciseJumpCandidateBudget::new(PRECISE_JUMP_CANDIDATES)
            .expect("fixed precise-jump candidate budget is nonzero"),
        PRECISE_JUMP_MAXIMUM_TICKS,
    )
    .expect("fixed precise-jump tick budget is nonzero")
}

fn rejected(
    sequence: PreciseJumpActionSequence,
    reason: PreciseJumpTransactionRejection,
) -> PreciseJumpTransactionFeedback {
    PreciseJumpTransactionFeedback {
        sequence,
        outcome: PreciseJumpTransactionOutcome::Rejected(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_edges_are_strictly_monotonic_and_cancel_clears_preview_state() {
        let mut runtime = PreciseJumpRuntime::new();
        let first = runtime.cancel(PreciseJumpCancelRequest {
            sequence: PreciseJumpActionSequence(7),
        });
        assert_eq!(first.outcome, PreciseJumpTransactionOutcome::Cancelled);
        let duplicate = runtime.cancel(PreciseJumpCancelRequest {
            sequence: PreciseJumpActionSequence(7),
        });
        assert_eq!(
            duplicate.outcome,
            PreciseJumpTransactionOutcome::Rejected(PreciseJumpTransactionRejection::StaleAction)
        );
    }

    #[test]
    fn accepted_commit_fences_replacement_preview_work() {
        let mut runtime = PreciseJumpRuntime::new();
        let camera = ClientCameraIdentity {
            camera_generation: 3,
            player_guid: Guid(0x5000_0001),
            entity_generation: 7,
        };
        runtime.latest_aim = Some((camera, PreciseJumpAimSequence(11)));
        runtime.next_generation = 4;
        let request = PreciseJumpCommitRequest {
            sequence: PreciseJumpActionSequence(12),
            evaluation: PreciseJumpEvaluationId(9),
        };

        runtime.accept_valid_commit(request);

        assert_eq!(runtime.pending_commit, Some(request));
        assert_eq!(runtime.latest_aim, None);
        assert_eq!(runtime.next_generation, 5);
    }
}
