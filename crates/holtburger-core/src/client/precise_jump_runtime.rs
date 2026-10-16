//! Replaceable precise-jump preview work and ordered selected launches.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use holtburger_common::{Guid, Vector3};
use holtburger_world::state::SelfJumpCapabilities;
use holtburger_world::{
    CollisionQueryError, EntityCollisionSnapshot, PhysicalBodyDefinition, PhysicalCollisionFilter,
    SpatialBody, SpatialBodyId, StaticSurfaceRayRequest, WorldState,
};
use tokio::sync::Notify;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use super::camera::ClientCameraIdentity;
use super::character_jump::ResolvedJump;
use super::character_motion::JumpExtent;
use super::precise_jump::{
    PreciseJumpLaunchCandidate, PreciseJumpWorldDisplacement, resolve_selected_precise_jump,
};
use super::precise_jump_prediction::{
    PreciseJumpFlight, PreciseJumpFlightRequest, PreciseJumpPredictionControl,
    PreciseJumpPredictionIncompleteReason, PreciseJumpTarget, PreciseJumpTargetView,
    PreciseJumpTrajectory, desired_landing_body_point, predict_selected_precise_jump,
    selected_jump_curve,
};
use crate::SimulationSceneSnapshot;

const PRECISE_JUMP_MAXIMUM_TICKS: usize = 160;

/// Monotonic pointer sample within one precise-jump mode session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PreciseJumpAimSequence(pub u64);

/// Monotonic non-coalescible commit/cancel edge within one precise-jump mode session.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PreciseJumpActionSequence(pub u64);

/// Camera ray supplied by the presentation; collision filtering remains core-owned.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpAimRequest {
    pub camera: ClientCameraIdentity,
    pub sequence: PreciseJumpAimSequence,
    /// User-selected legal power; capability conversion remains core-owned.
    pub power: JumpExtent,
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

/// Ordered user choice, independent of replaceable preview ownership.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreciseJumpCommitRequest {
    pub sequence: PreciseJumpActionSequence,
    /// Actor/session identity; pose and velocity are read at release.
    pub camera: ClientCameraIdentity,
    /// Displayed surface captured by the click.
    pub target: PreciseJumpTargetView,
    /// User-selected legal power captured by the click.
    pub power: JumpExtent,
}

/// Explicit request to discard precise-jump state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreciseJumpCancelRequest {
    pub sequence: PreciseJumpActionSequence,
}

/// Analytic feedback for the selected power, independent of collision prediction.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpLaunchView {
    /// Desired picked surface, shared by both feedback phases.
    pub target: PreciseJumpTargetView,
    /// Selected power, unchanged by reachability or contacts.
    pub power: JumpExtent,
    /// The one analytic curve used before collision prediction completes.
    pub preview: PreciseJumpPreviewCurve,
}

/// Analytic intent when target height is reachable, or honest free-flight fallback otherwise.
#[derive(Debug, Clone, PartialEq)]
pub enum PreciseJumpPreviewCurve {
    /// Ideal connection; the actual launch can still be capped by horizontal speed.
    Desired(PreciseJumpTrajectory),
    /// Selected power cannot reach target height; show the capped free-flight curve.
    BelowHeight(PreciseJumpTrajectory),
}

/// Completed prediction or a terminal input/preparation outcome.
#[derive(Debug, Clone, PartialEq)]
pub enum PreciseJumpEvaluationStatus {
    NoSurface,
    Predicted {
        launch: PreciseJumpLaunchView,
        flight: PreciseJumpFlight,
    },
    PredictionFailed(PreciseJumpLaunchView),
    Unproven(PreciseJumpPredictionIncompleteReason),
    InvalidAim,
    SolverFailed,
}

/// One correlated completion for the latest selected ray and power.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpEvaluation {
    pub camera: ClientCameraIdentity,
    pub sequence: PreciseJumpAimSequence,
    pub status: PreciseJumpEvaluationStatus,
}

/// A chosen valid launch ready for activation while collision prediction runs.
#[derive(Debug, Clone, PartialEq)]
pub struct PreciseJumpResolvedLaunch {
    pub camera: ClientCameraIdentity,
    pub sequence: PreciseJumpAimSequence,
    pub launch: PreciseJumpLaunchView,
}

/// Ordered analytic feedback followed by collision completion for one selected input.
#[derive(Debug, Clone, PartialEq)]
pub enum PreciseJumpProgress {
    LaunchResolved(PreciseJumpResolvedLaunch),
    Completed(PreciseJumpEvaluation),
}

/// Why an ordered commit/cancel edge did not launch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreciseJumpTransactionRejection {
    StaleAction,
    CommitPending,
    SessionChanged,
    LaunchRejected,
    /// Current actor is airborne at release.
    Airborne,
    /// Current contact does not provide stable launch support.
    Unsupported,
    /// Current burden prevents jumping.
    Overburdened,
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
struct PreciseJumpContext {
    world_generation: u64,
    camera: ClientCameraIdentity,
    player: Guid,
    instance_sequence: u16,
    collision_filter: PhysicalCollisionFilter,
    capabilities: SelfJumpCapabilities,
}

struct PreciseJumpWork {
    generation: u64,
    aim: PreciseJumpAimRequest,
    context: Arc<PreciseJumpContext>,
    /// Private launch state paired with the shared obstacle publication.
    body: SpatialBody,
    /// Immutable peer geometry shared with other queries of this world publication.
    entities: Arc<EntityCollisionSnapshot>,
    collision: Arc<SimulationSceneSnapshot>,
    start_time: Instant,
}

struct PreciseJumpCompletion {
    generation: u64,
    context: Arc<PreciseJumpContext>,
    evaluation: PreciseJumpEvaluation,
}

/// Early launch ownership is admitted before expensive collision work finishes.
enum PreciseJumpWorkerEvent {
    LaunchResolved {
        generation: u64,
        retained: PreciseJumpPreviewSelection,
        progress: PreciseJumpResolvedLaunch,
    },
    Completed(PreciseJumpCompletion),
}

/// Retain the executing generation until it reports completion, including after cancellation.
struct PreciseJumpWorker {
    generation: u64,
    cancelled: Arc<AtomicBool>,
    handle: tokio::task::JoinHandle<()>,
}

#[derive(Clone)]
struct PreciseJumpPreviewSelection {
    launch: PreciseJumpLaunchView,
    context: Arc<PreciseJumpContext>,
}

/// Queued user choice bound to the world session in which it was accepted.
struct PendingPreciseJumpCommit {
    request: PreciseJumpCommitRequest,
    world_generation: u64,
}

/// Selected target and power consumed once at the next ordinary release tick.
pub(super) struct PreparedPreciseJumpCommit {
    sequence: PreciseJumpActionSequence,
    extent: JumpExtent,
    target: PreciseJumpTargetView,
}

impl PreparedPreciseJumpCommit {
    pub(super) fn sequence(&self) -> PreciseJumpActionSequence {
        self.sequence
    }

    /// Re-resolve the user's selected endpoint/power from admitted current actor facts.
    pub(super) fn resolve_at_release(
        self,
        body: &SpatialBody,
        capabilities: &SelfJumpCapabilities,
    ) -> Result<(PreciseJumpActionSequence, ResolvedJump), PreciseJumpTransactionFeedback> {
        let fail = || {
            rejected(
                self.sequence,
                PreciseJumpTransactionRejection::LaunchRejected,
            )
        };
        let physical = body.physical.as_ref().ok_or_else(fail)?;
        let destination =
            desired_landing_body_point(body, &self.target, physical.definition.spheres().primary());
        let delta = PreciseJumpWorldDisplacement::new(destination - body.pose.coords)
            .map_err(|_| fail())?;
        let selected = resolve_selected_precise_jump(
            super::precise_jump_prediction::PRECISE_JUMP_FIXED_TICK,
            capabilities,
            physical.definition,
            body.pose.rotation.to_heading(),
            delta,
            self.extent,
        )
        .map_err(|_| fail())?;
        Ok((
            self.sequence,
            ResolvedJump::from_precise_candidate(selected.candidate()),
        ))
    }
}

/// One blocking worker plus one replaceable latest sample; pointer history is never queued.
pub(super) struct PreciseJumpRuntime {
    /// Wake the client loop without waiting for its next physics tick.
    progress_notification: Arc<Notify>,
    completion_tx: UnboundedSender<PreciseJumpWorkerEvent>,
    completion_rx: UnboundedReceiver<PreciseJumpWorkerEvent>,
    worker: Option<PreciseJumpWorker>,
    queued_latest: Option<PreciseJumpWork>,
    next_generation: u64,
    latest_aim: Option<(ClientCameraIdentity, PreciseJumpAimSequence)>,
    /// Ray/power identity survives actor-only preview refreshes.
    last_input: Option<PreciseJumpAimRequest>,
    retained: Option<PreciseJumpPreviewSelection>,
    last_action: Option<PreciseJumpActionSequence>,
    pending_commit: Option<PendingPreciseJumpCommit>,
}

impl PreciseJumpRuntime {
    pub(super) fn new() -> Self {
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        Self {
            progress_notification: Arc::new(Notify::new()),
            completion_tx,
            completion_rx,
            worker: None,
            queued_latest: None,
            next_generation: 0,
            latest_aim: None,
            last_input: None,
            retained: None,
            last_action: None,
            pending_commit: None,
        }
    }

    pub(super) fn progress_notification(&self) -> Arc<Notify> {
        Arc::clone(&self.progress_notification)
    }

    pub(super) fn submit_aim(
        &mut self,
        aim: PreciseJumpAimRequest,
        world_generation: u64,
        active_camera: Option<ClientCameraIdentity>,
        world: &WorldState,
        collision: Option<Arc<SimulationSceneSnapshot>>,
    ) -> Option<PreciseJumpProgress> {
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
        let same_choice = self.last_input.is_some_and(|previous| {
            previous
                == PreciseJumpAimRequest {
                    sequence: previous.sequence,
                    ..aim
                }
        });
        self.latest_aim = Some((aim.camera, aim.sequence));
        if !same_choice {
            self.retained = None;
        }
        let Some(collision) = collision else {
            return Some(self.immediate_evaluation(aim, PreciseJumpEvaluationStatus::SolverFailed));
        };
        let Some(context) = capture_context(world_generation, aim.camera, world) else {
            return Some(self.immediate_evaluation(aim, PreciseJumpEvaluationStatus::SolverFailed));
        };
        self.next_generation = self
            .next_generation
            .checked_add(1)
            .expect("precise-jump work generation exhausted");
        self.last_input = Some(aim);
        let Some(body) = world
            .scene
            .body(SpatialBodyId::LocalPlayer(world.player.guid))
            .cloned()
        else {
            return Some(self.immediate_evaluation(aim, PreciseJumpEvaluationStatus::SolverFailed));
        };
        let entities = match world.scene.entity_collision_snapshot() {
            Ok(entities) => entities,
            Err(error) => {
                log::error!("precise-jump collision capture failed: {error:#}");
                return Some(
                    self.immediate_evaluation(aim, PreciseJumpEvaluationStatus::SolverFailed),
                );
            }
        };
        let work = PreciseJumpWork {
            generation: self.next_generation,
            aim,
            context,
            body,
            entities,
            collision,
            start_time: Instant::now(),
        };
        if let Some(worker) = &self.worker {
            worker.cancelled.store(true, Ordering::Relaxed);
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
    ) -> Vec<PreciseJumpProgress> {
        let mut published = Vec::new();
        while let Ok(event) = self.completion_rx.try_recv() {
            match event {
                PreciseJumpWorkerEvent::LaunchResolved {
                    generation,
                    retained,
                    progress,
                } => {
                    if generation == self.next_generation
                        && self.latest_aim == Some((progress.camera, progress.sequence))
                        && current_context(
                            &retained.context,
                            world_generation,
                            active_camera,
                            world,
                        )
                    {
                        self.retained = Some(retained);
                        published.push(PreciseJumpProgress::LaunchResolved(progress));
                    }
                }
                PreciseJumpWorkerEvent::Completed(completion) => {
                    // Only the running generation can retire its slot. Partial and stale
                    // messages cannot release a newer worker or create overlapping solves.
                    if self
                        .worker
                        .as_ref()
                        .is_some_and(|worker| worker.generation == completion.generation)
                    {
                        self.worker = None;
                    }
                    let latest = self.latest_aim
                        == Some((completion.evaluation.camera, completion.evaluation.sequence))
                        && completion.generation == self.next_generation;
                    if latest {
                        let evaluation = if current_context(
                            &completion.context,
                            world_generation,
                            active_camera,
                            world,
                        ) {
                            let mut evaluation = completion.evaluation;
                            if matches!(
                                evaluation.status,
                                PreciseJumpEvaluationStatus::SolverFailed
                            ) && let Some(retained) = &self.retained
                            {
                                evaluation.status = PreciseJumpEvaluationStatus::PredictionFailed(
                                    retained.launch.clone(),
                                );
                            }
                            evaluation
                        } else {
                            self.retained = None;
                            PreciseJumpEvaluation {
                                status: PreciseJumpEvaluationStatus::Unproven(
                                    PreciseJumpPredictionIncompleteReason::SessionChanged,
                                ),
                                ..completion.evaluation
                            }
                        };
                        published.push(PreciseJumpProgress::Completed(evaluation));
                    }
                    if self.worker.is_none()
                        && let Some(work) = self.queued_latest.take()
                    {
                        self.start(work);
                    }
                }
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
        world_generation: u64,
        active_camera: Option<ClientCameraIdentity>,
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
        if active_camera != Some(request.camera) {
            return Some(rejected(
                request.sequence,
                PreciseJumpTransactionRejection::SessionChanged,
            ));
        }
        self.pending_commit = Some(PendingPreciseJumpCommit {
            request,
            world_generation,
        });
        // The click owns its target and power. Cancel obsolete prediction work without
        // depending on its completion or retained selection.
        self.discard_preview_work();
        None
    }

    /// Consume the clicked choice once, independently of preview replacement or completion.
    pub(super) fn prepare_queued_commit(
        &mut self,
        world_generation: u64,
        active_camera: Option<ClientCameraIdentity>,
    ) -> Option<Result<PreparedPreciseJumpCommit, PreciseJumpTransactionFeedback>> {
        let pending = self.pending_commit.take()?;
        let request = pending.request;
        if world_generation != pending.world_generation || active_camera != Some(request.camera) {
            return Some(Err(rejected(
                request.sequence,
                PreciseJumpTransactionRejection::SessionChanged,
            )));
        }
        Some(Ok(PreparedPreciseJumpCommit {
            sequence: request.sequence,
            extent: request.power,
            target: request.target,
        }))
    }

    pub(super) fn invalidate(&mut self) {
        self.discard_preview_work();
        self.retained = None;
        self.last_input = None;
        self.pending_commit = None;
    }

    fn discard_preview_work(&mut self) {
        self.next_generation = self.next_generation.saturating_add(1);
        self.queued_latest = None;
        self.latest_aim = None;
        if let Some(worker) = &self.worker {
            worker.cancelled.store(true, Ordering::Relaxed);
        }
    }

    fn accept_action(&mut self, sequence: PreciseJumpActionSequence) -> bool {
        if self.last_action.is_some_and(|last| sequence <= last) {
            return false;
        }
        self.last_action = Some(sequence);
        true
    }

    fn immediate_evaluation(
        &mut self,
        aim: PreciseJumpAimRequest,
        status: PreciseJumpEvaluationStatus,
    ) -> PreciseJumpProgress {
        let status = match &self.retained {
            Some(retained) if matches!(status, PreciseJumpEvaluationStatus::SolverFailed) => {
                PreciseJumpEvaluationStatus::PredictionFailed(retained.launch.clone())
            }
            _ => status,
        };
        PreciseJumpProgress::Completed(PreciseJumpEvaluation {
            camera: aim.camera,
            sequence: aim.sequence,
            status,
        })
    }

    fn start(&mut self, work: PreciseJumpWork) {
        assert!(
            self.worker.is_none(),
            "precise-jump worker must retire before replacement starts"
        );
        let generation = work.generation;
        let fallback = PreciseJumpCompletion {
            generation,
            context: Arc::clone(&work.context),
            evaluation: base_evaluation(&work, PreciseJumpEvaluationStatus::SolverFailed),
        };
        let tx = self.completion_tx.clone();
        let notification = Arc::clone(&self.progress_notification);
        let cancelled = Arc::new(AtomicBool::new(false));
        let worker_cancelled = Arc::clone(&cancelled);
        let handle = tokio::spawn(async move {
            let solve_tx = tx.clone();
            let solve_notification = Arc::clone(&notification);
            let completion = match tokio::task::spawn_blocking(move || {
                evaluate(work, &worker_cancelled, &solve_tx, &solve_notification)
            })
            .await
            {
                Ok(completion) => completion,
                Err(error) => {
                    log::error!("precise-jump worker failed: {error}");
                    fallback
                }
            };
            // Closing the receiver is normal when its runtime is disposed.
            let _ = tx.send(PreciseJumpWorkerEvent::Completed(completion));
            notification.notify_one();
        });
        self.worker = Some(PreciseJumpWorker {
            generation,
            cancelled,
            handle,
        });
    }
}

impl Drop for PreciseJumpRuntime {
    fn drop(&mut self) {
        if let Some(worker) = &self.worker {
            worker.cancelled.store(true, Ordering::Relaxed);
            // The blocking closure checks cancellation; dropping the wrapper only
            // retires delivery after the runtime itself no longer has a receiver.
            worker.handle.abort();
        }
    }
}

impl PreciseJumpContext {
    fn is_current(
        &self,
        world_generation: u64,
        camera: Option<ClientCameraIdentity>,
        world: &WorldState,
    ) -> bool {
        self.world_generation == world_generation
            && camera == Some(self.camera)
            && self.player == world.player.guid
            && self.instance_sequence == world.player.instance_sequence
    }
}

fn capture_context(
    world_generation: u64,
    camera: ClientCameraIdentity,
    world: &WorldState,
) -> Option<Arc<PreciseJumpContext>> {
    let player = world.player.guid;
    let body = world.scene.body(SpatialBodyId::LocalPlayer(player))?;
    let physical = body.physical.as_ref()?;
    let PhysicalBodyDefinition::Grounded { .. } = physical.definition else {
        return None;
    };
    Some(Arc::new(PreciseJumpContext {
        world_generation,
        camera,
        player,
        instance_sequence: world.player.instance_sequence,
        collision_filter: physical.collision_filter,
        capabilities: world.resolve_self_jump_capabilities().ok()?,
    }))
}

fn evaluate(
    work: PreciseJumpWork,
    cancelled: &AtomicBool,
    tx: &UnboundedSender<PreciseJumpWorkerEvent>,
    notification: &Notify,
) -> PreciseJumpCompletion {
    let complete = |evaluation| PreciseJumpCompletion {
        generation: work.generation,
        context: Arc::clone(&work.context),
        evaluation,
    };
    if cancelled.load(Ordering::Relaxed) {
        return complete(base_evaluation(
            &work,
            PreciseJumpEvaluationStatus::Unproven(PreciseJumpPredictionIncompleteReason::Cancelled),
        ));
    }
    let hit = match work.collision.scene.cast_surface_ray(
        &work.entities,
        StaticSurfaceRayRequest {
            anchor: work.aim.anchor,
            start: work.aim.start,
            direction: work.aim.direction,
            maximum_distance: work.aim.maximum_distance,
            previous_cell: work.aim.previous_cell,
            filter: work.context.collision_filter,
        },
        |body| matches!(body, SpatialBodyId::Entity(guid) if guid != work.context.player),
    ) {
        Ok(Some(hit)) => hit,
        Ok(None) => {
            return complete(base_evaluation(
                &work,
                PreciseJumpEvaluationStatus::NoSurface,
            ));
        }
        Err(error) => {
            let status = match error.downcast_ref::<CollisionQueryError>() {
                Some(
                    CollisionQueryError::NonFiniteCenter
                    | CollisionQueryError::InvalidDistance
                    | CollisionQueryError::NonFiniteDirection
                    | CollisionQueryError::UnnormalizedDirection,
                ) => PreciseJumpEvaluationStatus::InvalidAim,
                _ => {
                    log::error!("precise-jump target pick failed: {error:#}");
                    PreciseJumpEvaluationStatus::SolverFailed
                }
            };
            return complete(base_evaluation(&work, status));
        }
    };
    let target = match PreciseJumpTarget::new(work.aim.anchor, hit) {
        Ok(target) => target,
        Err(_) => {
            return complete(base_evaluation(
                &work,
                PreciseJumpEvaluationStatus::InvalidAim,
            ));
        }
    };
    let target_view = *target.view();
    let resolve = || -> anyhow::Result<(PreciseJumpLaunchView, PreciseJumpLaunchCandidate)> {
        let physical = work
            .body
            .physical
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("precise jump body has no physics"))?;
        let point = desired_landing_body_point(
            &work.body,
            &target_view,
            physical.definition.spheres().primary(),
        );
        let selected = resolve_selected_precise_jump(
            super::precise_jump_prediction::PRECISE_JUMP_FIXED_TICK,
            &work.context.capabilities,
            physical.definition,
            work.body.pose.rotation.to_heading(),
            PreciseJumpWorldDisplacement::new(point - work.body.pose.coords)?,
            work.aim.power,
        )?;
        let candidate = selected.candidate();
        // Only the displayed analytic curve needs cell traversal. The capped candidate
        // independently supplies the collision simulation and actual release velocity.
        let velocity = selected
            .desired_velocity()
            .unwrap_or(candidate.world_velocity());
        let curve = selected_jump_curve(
            &work.body,
            &work.collision.scene,
            target.anchor(),
            velocity,
            candidate.flight_duration_seconds(),
        )?;
        let preview = match selected.desired_velocity() {
            Some(_) => PreciseJumpPreviewCurve::Desired(curve),
            None => PreciseJumpPreviewCurve::BelowHeight(curve),
        };
        Ok((
            PreciseJumpLaunchView {
                target: target_view,
                power: work.aim.power,
                preview,
            },
            candidate,
        ))
    };
    let (launch, candidate) = match resolve() {
        Ok(launch) => launch,
        Err(error) => {
            log::error!("precise-jump selected launch resolution failed: {error:#}");
            return complete(base_evaluation(
                &work,
                PreciseJumpEvaluationStatus::SolverFailed,
            ));
        }
    };
    let retained = PreciseJumpPreviewSelection {
        launch: launch.clone(),

        context: Arc::clone(&work.context),
    };
    if !cancelled.load(Ordering::Relaxed) {
        let _ = tx.send(PreciseJumpWorkerEvent::LaunchResolved {
            generation: work.generation,
            retained,
            progress: PreciseJumpResolvedLaunch {
                camera: work.aim.camera,
                sequence: work.aim.sequence,
                launch: launch.clone(),
            },
        });
        notification.notify_one();
    }
    let status = match predict_selected_precise_jump(
        PreciseJumpFlightRequest {
            body: &work.body,
            collision_scene: &work.collision.scene,
            entity_collision: &work.entities,
            target: &target,
            candidate,
            maximum_ticks: std::num::NonZeroU32::new(PRECISE_JUMP_MAXIMUM_TICKS as u32)
                .expect("nonzero flight horizon"),
            start_time: work.start_time,
        },
        PreciseJumpPredictionControl { cancelled },
    ) {
        Ok(flight) => PreciseJumpEvaluationStatus::Predicted { launch, flight },
        Err(error) => {
            log::error!("precise-jump selected flight failed: {error:#}");
            PreciseJumpEvaluationStatus::PredictionFailed(launch)
        }
    };
    complete(PreciseJumpEvaluation {
        camera: work.aim.camera,
        sequence: work.aim.sequence,
        status,
    })
}

fn current_context(
    expected: &PreciseJumpContext,
    world_generation: u64,
    active_camera: Option<ClientCameraIdentity>,
    world: &WorldState,
) -> bool {
    expected.is_current(world_generation, active_camera, world)
}

fn base_evaluation(
    work: &PreciseJumpWork,
    status: PreciseJumpEvaluationStatus,
) -> PreciseJumpEvaluation {
    PreciseJumpEvaluation {
        camera: work.aim.camera,
        sequence: work.aim.sequence,
        status,
    }
}

fn rejected(
    sequence: PreciseJumpActionSequence,
    reason: PreciseJumpTransactionRejection,
) -> PreciseJumpTransactionFeedback {
    log::warn!("precise-jump action {} rejected: {reason:?}", sequence.0);
    PreciseJumpTransactionFeedback {
        sequence,
        outcome: PreciseJumpTransactionOutcome::Rejected(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::MovementSystem;
    use std::collections::BTreeMap;
    fn work(generation: u64) -> PreciseJumpWork {
        let fixture =
            super::super::precise_jump_prediction::tests::flat_dynamic_prediction_fixture();
        let body = fixture.scene.body(fixture.body_id).unwrap().clone();
        let physical = body.physical.as_ref().unwrap();
        let camera = ClientCameraIdentity {
            camera_generation: 1,
            player_guid: Guid(1),
            entity_generation: 1,
        };
        let owner = fixture.target.anchor();
        PreciseJumpWork {
            generation,

            aim: PreciseJumpAimRequest {
                camera,
                sequence: PreciseJumpAimSequence(generation),
                power: JumpExtent::new(0.5).unwrap(),
                anchor: owner,
                start: fixture.target.view().point + Vector3::new(0.0, 0.0, 5.0),
                direction: Vector3::new(0.0, 0.0, -1.0),
                maximum_distance: 10.0,
                previous_cell: None,
            },
            context: Arc::new(PreciseJumpContext {
                world_generation: 1,
                camera,
                player: camera.player_guid,
                instance_sequence: 1,
                collision_filter: physical.collision_filter,
                capabilities: fixture.capabilities,
            }),
            body,
            entities: fixture.scene.entity_collision_snapshot().unwrap(),
            collision: Arc::new(SimulationSceneSnapshot {
                revision: 1,
                content_source_generation: 1,
                interest: crate::SimulationSceneInterest::new([owner]).unwrap(),
                availability: BTreeMap::new(),
                scene: Arc::new(fixture.collision),
            }),
            start_time: fixture.now,
        }
    }
    fn ready_commit_fixture() -> (
        PreciseJumpRuntime,
        WorldState,
        Arc<SimulationSceneSnapshot>,
        ClientCameraIdentity,
        PreciseJumpResolvedLaunch,
        PreciseJumpCompletion,
    ) {
        use holtburger_world::stats::{
            Attribute, AttributeType, Skill, SkillType, TrainingLevel, Vital, VitalType,
        };
        let mut preview = work(1);
        let mut world = WorldState::synthetic();
        let camera = preview.aim.camera;
        world.seed_local_player_entity(camera.player_guid, "Player", preview.body.pose);
        world.player.instance_sequence = preview.context.instance_sequence;
        world
            .set_self_movement_capabilities_override(preview.context.capabilities.movement.clone());
        world.player.attributes.insert(
            AttributeType::StrengthAttr,
            Attribute {
                attr_type: AttributeType::StrengthAttr,
                ranks: 0,
                start: 100,
                spent_xp: 0,
                next_rank_xp: None,
                base: 100,
                current: 100,
                breakdown: Default::default(),
            },
        );
        world.player.skills.insert(
            SkillType::Jump,
            Skill {
                skill_type: SkillType::Jump,
                ranks: 0,
                init: 300,
                spent_xp: 0,
                next_rank_xp: None,
                base: 300,
                current: 300,
                training: TrainingLevel::Trained,
                trained_cost: 0,
                specialized_cost: 0,
                breakdown: Default::default(),
            },
        );
        world.player.vitals.insert(
            VitalType::Stamina,
            Vital {
                vital_type: VitalType::Stamina,
                ranks: 0,
                start: 100,
                spent_xp: 0,
                next_rank_xp: None,
                base: 100,
                buffed_max: 100,
                current: 100,
                breakdown: Default::default(),
            },
        );
        preview.body.id = SpatialBodyId::LocalPlayer(camera.player_guid);
        world.scene.register_body(preview.body.clone());
        preview.context = capture_context(1, camera, &world).unwrap();
        preview.entities = world.scene.entity_collision_snapshot().unwrap();
        let collision = Arc::clone(&preview.collision);
        let (tx, mut rx) = mpsc::unbounded_channel();
        let completion = evaluate(preview, &AtomicBool::new(false), &tx, &Notify::new());
        let PreciseJumpWorkerEvent::LaunchResolved {
            retained, progress, ..
        } = rx.try_recv().unwrap()
        else {
            panic!("expected early launch");
        };
        let mut runtime = PreciseJumpRuntime::new();
        runtime.next_generation = 1;
        runtime.retained = Some(retained);
        (runtime, world, collision, camera, progress, completion)
    }

    fn click(
        runtime: &mut PreciseJumpRuntime,
        camera: ClientCameraIdentity,
        launch: &PreciseJumpLaunchView,
    ) -> PreparedPreciseJumpCommit {
        assert!(
            runtime
                .queue_commit(
                    PreciseJumpCommitRequest {
                        sequence: PreciseJumpActionSequence(1),
                        camera,
                        target: launch.target,
                        power: launch.power,
                    },
                    1,
                    Some(camera)
                )
                .is_none()
        );
        let chosen = runtime
            .prepare_queued_commit(1, Some(camera))
            .unwrap()
            .unwrap();
        assert!(runtime.prepare_queued_commit(1, Some(camera)).is_none());
        chosen
    }
    #[tokio::test]
    async fn release_uses_current_rotation_and_preserves_power_despite_existing_motion() {
        let (mut runtime, mut world, collision, camera, progress, _) = ready_commit_fixture();
        let mut body = world
            .scene
            .body(SpatialBodyId::LocalPlayer(camera.player_guid))
            .unwrap()
            .clone();
        body.pose.rotation =
            holtburger_common::Quaternion::from_heading(std::f32::consts::FRAC_PI_2);
        body.retained.velocity = Vector3::new(12.0, -8.0, 0.0);
        world.scene.update_body(body).unwrap();
        let chosen = click(&mut runtime, camera, &progress.launch);
        let tick = super::super::simulation::tick_with_precise_jump(
            Instant::now(),
            super::super::precise_jump_prediction::PRECISE_JUMP_FIXED_TICK,
            &mut world,
            &mut MovementSystem::new(),
            Some(&collision),
            Some(chosen),
        )
        .unwrap();
        assert_eq!(
            tick.precise_jump_feedback.unwrap().outcome,
            PreciseJumpTransactionOutcome::Committed
        );
        let jump = tick.committed_jump.unwrap();
        assert_eq!(jump.resolved.extent(), progress.launch.power);
        let v = jump.resolved.local_velocity();
        let h = jump.position.rotation.to_heading();
        let reconstructed = Vector3::new(-h.cos(), h.sin(), 0.0) * v.y
            + Vector3::new(h.sin(), h.cos(), 0.0) * v.x
            + Vector3::new(0.0, 0.0, v.z);
        assert!((reconstructed - jump.resolved.world_velocity()).length() < 0.00001);
    }
    #[tokio::test]
    async fn release_rejects_current_airborne_unstable_contact_and_overburden() {
        for (contact, burden, expected) in [
            (
                holtburger_world::ContactState::Airborne,
                false,
                PreciseJumpTransactionRejection::Airborne,
            ),
            (
                holtburger_world::ContactState::Sliding,
                false,
                PreciseJumpTransactionRejection::Unsupported,
            ),
            (
                holtburger_world::ContactState::Unknown,
                false,
                PreciseJumpTransactionRejection::Unsupported,
            ),
            (
                holtburger_world::ContactState::Grounded,
                true,
                PreciseJumpTransactionRejection::Overburdened,
            ),
        ] {
            let (mut runtime, mut world, collision, camera, progress, _) = ready_commit_fixture();
            let chosen = click(&mut runtime, camera, &progress.launch);
            let mut body = world
                .scene
                .body(SpatialBodyId::LocalPlayer(camera.player_guid))
                .unwrap()
                .clone();
            body.contact = contact;
            body.pose.coords.z += 2.0;
            world.scene.update_body(body).unwrap();
            if burden {
                world
                    .player
                    .attributes
                    .get_mut(&holtburger_world::stats::AttributeType::StrengthAttr)
                    .unwrap()
                    .current = 0;
            }
            let tick = super::super::simulation::tick_with_precise_jump(
                Instant::now(),
                super::super::precise_jump_prediction::PRECISE_JUMP_FIXED_TICK,
                &mut world,
                &mut MovementSystem::new(),
                Some(&collision),
                Some(chosen),
            )
            .unwrap();
            assert_eq!(
                tick.precise_jump_feedback.unwrap().outcome,
                PreciseJumpTransactionOutcome::Rejected(expected)
            );
            assert!(tick.committed_jump.is_none());
        }
    }
    #[tokio::test]
    async fn early_launch_can_commit_before_flight_completion_without_another_solve() {
        let (mut runtime, world, _collision, camera, progress, completion) = ready_commit_fixture();
        let retained = runtime.retained.take().unwrap();
        runtime.latest_aim = Some((camera, PreciseJumpAimSequence(1)));
        runtime.worker = Some(PreciseJumpWorker {
            generation: 1,
            cancelled: Arc::new(AtomicBool::new(false)),
            handle: tokio::spawn(std::future::pending()),
        });
        runtime
            .completion_tx
            .send(PreciseJumpWorkerEvent::LaunchResolved {
                generation: 1,
                retained,
                progress: progress.clone(),
            })
            .unwrap();
        assert!(matches!(
            runtime.poll(1, Some(camera), &world).as_slice(),
            [PreciseJumpProgress::LaunchResolved(_)]
        ));
        assert!(runtime.worker.is_some());
        let chosen = click(&mut runtime, camera, &progress.launch);
        assert!(
            chosen
                .resolve_at_release(
                    world
                        .scene
                        .body(SpatialBodyId::LocalPlayer(camera.player_guid))
                        .unwrap(),
                    &world.resolve_self_jump_capabilities().unwrap()
                )
                .is_ok()
        );
        runtime
            .completion_tx
            .send(PreciseJumpWorkerEvent::Completed(completion))
            .unwrap();
        assert!(runtime.poll(1, Some(camera), &world).is_empty());
        assert!(runtime.worker.is_none());
    }
    #[test]
    fn cancel_and_session_changes_retire_selected_launch_ownership() {
        for cancel in [true, false] {
            let (mut runtime, _, _, camera, progress, _) = ready_commit_fixture();
            runtime.queue_commit(
                PreciseJumpCommitRequest {
                    sequence: PreciseJumpActionSequence(1),
                    camera,
                    target: progress.launch.target,
                    power: progress.launch.power,
                },
                1,
                Some(camera),
            );
            if cancel {
                runtime.cancel(PreciseJumpCancelRequest {
                    sequence: PreciseJumpActionSequence(2),
                });
                assert!(runtime.prepare_queued_commit(1, Some(camera)).is_none());
            } else {
                assert_eq!(
                    runtime
                        .prepare_queued_commit(2, Some(camera))
                        .unwrap()
                        .err()
                        .unwrap()
                        .outcome,
                    PreciseJumpTransactionOutcome::Rejected(
                        PreciseJumpTransactionRejection::SessionChanged
                    )
                );
            }
        }
    }
    #[tokio::test]
    async fn clicked_choice_survives_pending_or_completed_preview_replacement() {
        for replacement_completed in [false, true] {
            let (mut runtime, world, collision, camera, displayed, _) = ready_commit_fixture();
            let mut input = work(1).aim;
            input.camera = camera;
            input.sequence = PreciseJumpAimSequence(2);
            input.power = JumpExtent::new(0.8).unwrap();
            runtime.submit_aim(input, 1, Some(camera), &world, Some(collision));
            if replacement_completed {
                runtime.worker.take().unwrap().handle.await.unwrap();
                runtime.poll(1, Some(camera), &world);
            }
            let chosen = click(&mut runtime, camera, &displayed.launch);
            assert_eq!(chosen.extent, displayed.launch.power);
            assert_eq!(chosen.target, displayed.launch.target);
            assert!(
                chosen
                    .resolve_at_release(
                        world
                            .scene
                            .body(SpatialBodyId::LocalPlayer(camera.player_guid))
                            .unwrap(),
                        &world.resolve_self_jump_capabilities().unwrap(),
                    )
                    .is_ok()
            );
        }
    }

    #[tokio::test]
    async fn identical_ray_and_power_preserve_selection_during_actor_refresh() {
        let (mut runtime, mut world, collision, camera, progress, _) = ready_commit_fixture();
        let input = work(1).aim;
        runtime.last_input = Some(input);
        runtime.latest_aim = Some((camera, input.sequence));
        let mut body = world
            .scene
            .body(SpatialBodyId::LocalPlayer(camera.player_guid))
            .unwrap()
            .clone();
        body.pose.coords.x += 1.0;
        world.scene.update_body(body).unwrap();
        assert!(
            runtime
                .submit_aim(
                    PreciseJumpAimRequest {
                        sequence: PreciseJumpAimSequence(2),
                        ..input
                    },
                    1,
                    Some(camera),
                    &world,
                    Some(collision)
                )
                .is_none()
        );
        assert_eq!(runtime.retained.as_ref().unwrap().launch, progress.launch);
        let chosen = click(&mut runtime, camera, &progress.launch);
        assert!(
            chosen
                .resolve_at_release(
                    world
                        .scene
                        .body(SpatialBodyId::LocalPlayer(camera.player_guid))
                        .unwrap(),
                    &world.resolve_self_jump_capabilities().unwrap()
                )
                .is_ok()
        );
    }

    #[tokio::test]
    async fn failed_prediction_retains_the_known_selected_launch() {
        let (mut runtime, world, _, camera, displayed, mut completion) = ready_commit_fixture();
        runtime.latest_aim = Some((camera, PreciseJumpAimSequence(1)));
        completion.evaluation.status = PreciseJumpEvaluationStatus::SolverFailed;
        runtime
            .completion_tx
            .send(PreciseJumpWorkerEvent::Completed(completion))
            .unwrap();
        let progress = runtime.poll(1, Some(camera), &world);
        assert!(matches!(
            &progress[0],
            PreciseJumpProgress::Completed(PreciseJumpEvaluation {
                status: PreciseJumpEvaluationStatus::PredictionFailed(_),
                ..
            })
        ));
        assert!(
            click(&mut runtime, camera, &displayed.launch)
                .resolve_at_release(
                    world
                        .scene
                        .body(SpatialBodyId::LocalPlayer(camera.player_guid))
                        .unwrap(),
                    &world.resolve_self_jump_capabilities().unwrap()
                )
                .is_ok()
        );
    }

    #[test]
    fn missing_prediction_scene_does_not_revoke_an_existing_choice() {
        let (mut runtime, world, _, camera, displayed, _) = ready_commit_fixture();
        let input = work(1).aim;
        runtime.last_input = Some(input);
        let progress = runtime
            .submit_aim(
                PreciseJumpAimRequest {
                    sequence: PreciseJumpAimSequence(2),
                    ..input
                },
                1,
                Some(camera),
                &world,
                None,
            )
            .unwrap();
        assert!(matches!(
            progress,
            PreciseJumpProgress::Completed(PreciseJumpEvaluation {
                status: PreciseJumpEvaluationStatus::PredictionFailed(_),
                ..
            })
        ));
        assert!(
            click(&mut runtime, camera, &displayed.launch)
                .resolve_at_release(
                    world
                        .scene
                        .body(SpatialBodyId::LocalPlayer(camera.player_guid))
                        .unwrap(),
                    &world.resolve_self_jump_capabilities().unwrap()
                )
                .is_ok()
        );
    }

    #[test]
    fn analytic_feedback_preserves_power_and_selects_desired_or_below_height_curve() {
        for (power, distance, source_height, desired) in [
            (0.15, 6.0, 0.005, true),
            (0.8, 1.0, 0.005, true),
            (0.15, 6.0, -20.0, false),
        ] {
            let mut input = work(1);
            input.aim.power = JumpExtent::new(power).unwrap();
            input.body.pose.coords.z = source_height;
            input.aim.start.x = input.body.pose.coords.x - distance;
            let target_point = input.aim.start - Vector3::new(0.0, 0.0, 5.0);
            let (tx, mut rx) = mpsc::unbounded_channel();
            let completion = evaluate(input, &AtomicBool::new(false), &tx, &Notify::new());
            let PreciseJumpWorkerEvent::LaunchResolved {
                progress, retained, ..
            } = rx.try_recv().unwrap()
            else {
                panic!("expected analytic feedback before completion");
            };
            assert_eq!(progress.launch.power.get(), power);
            assert_eq!(retained.launch, progress.launch);
            let curve = match progress.launch.preview {
                PreciseJumpPreviewCurve::Desired(curve) => {
                    assert!(desired);
                    // Intent reaches the picked point even when actual horizontal speed is capped.
                    let end = curve.position_at_fraction(1.0).unwrap();
                    assert!((end.x - target_point.x).abs() < 0.001);
                    assert!((end.y - target_point.y).abs() < 0.001);
                    curve
                }
                PreciseJumpPreviewCurve::BelowHeight(curve) => {
                    assert!(!desired);
                    assert!(curve.position_at_fraction(1.0).unwrap().z < target_point.z);
                    curve
                }
            };
            assert_eq!(curve.placements().first().unwrap().start_fraction(), 0.0);
            assert_eq!(curve.placements().last().unwrap().end_fraction(), 1.0);
            assert!(matches!(
                completion.evaluation.status,
                PreciseJumpEvaluationStatus::Predicted { .. }
            ));
        }
    }
}
