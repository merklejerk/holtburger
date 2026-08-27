//! App-local composition of explicit collision interest and generic spatial bodies.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, ensure};
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_content::LandblockCollisionAsset;
use holtburger_core::{
    ContentAssetService, DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError,
    DynamicEntityBodyRemovalOutcome, DynamicEntityBodyReplacementOutcome, DynamicEntityDefinition,
    DynamicEntityInitialState, DynamicEntityProjectionInput, SimulationSceneBatchCompletion,
    SimulationSceneInterest, SimulationSceneOwnerAvailability, SimulationSceneOwnerOutcome,
    SimulationSceneOwnerRequest, SimulationScenePublication, SimulationSceneRequest,
    SimulationSceneResidency, apply_dynamic_entity_physics_transition,
    dynamic_entity_projection_input, install_dynamic_entity_body, remove_dynamic_entity_body,
    replace_dynamic_entity_body,
};
use holtburger_world::{
    CollisionQueryError, CollisionReportOutcome, CollisionScene, DynamicBodyKinematics,
    DynamicBodyRelocationOutcome, DynamicPhysicalBodyDefinition, EntityPhysicsTransitionDecision,
    GroundedBodyActuation, PhysicalBodyActuation, PhysicalBodyDefinition,
    PhysicalBodyResponsePolicy, PhysicalBodySceneResidency, PhysicalBodyTickResult,
    PhysicalCollisionFilter, PlacedMotionPath, PlacementRecovery, RuntimeSpatialBodyView,
    SpatialBody, SpatialBodyId, SpatialScene, physical_body_scene_residency,
};
use serde::{Deserialize, Serialize};

/// Injectable source of complete, atomic landblock collision products.
pub trait CollisionSource: Send + Sync {
    /// Loads one normalized landblock owner, or `None` when no CellLandblock exists.
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>>;
}

impl CollisionSource for ContentAssetService {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        ContentAssetService::load_collision(self, landblock_id)
    }
}

/// Complete frontend-owned replacement of collision simulation interest.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationInterestRequest {
    /// Host-issued application-policy lifetime; requests from retired frontends are ignored.
    pub session: u64,
    /// Monotonic application-policy revision; stale replacements are ignored.
    pub revision: u64,
    /// Exact normalized outdoor landblock owners requested for collision simulation.
    pub landblock_ids: Vec<String>,
}

/// Result of accepting or discarding one simulation-interest replacement.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationInterestReceipt {
    /// Request revision supplied by application policy.
    pub revision: u64,
    /// Whether this revision was still current when the replacement committed.
    pub committed: bool,
    /// Requested owners without an available collision product.
    pub unavailable_landblock_ids: Vec<String>,
}

/// Fully validated app-local body registration passed atomically into simulation state.
///
/// This native layer is the diagnostics door: harness fixtures and fault injection construct it
/// (or a `PhysicalBodyDefinition`) directly, entering the same validators production profiles
/// resolve through.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedPhysicalBodyRegistration {
    /// Validated geometry and solver response kind.
    pub definition: PhysicalBodyDefinition,
    /// Body-owned optional collision-domain exclusions.
    pub collision_filter: PhysicalCollisionFilter,
    /// Initial mutable contact response.
    pub response_policy: PhysicalBodyResponsePolicy,
}

/// State that must change atomically with respect to every generic body tick.
struct HostSimulationState {
    /// Shared body-neutral desired, pending, and installed collision state.
    residency: SimulationSceneResidency,
    /// Canonical identity, pose, and physical state for every registered body.
    bodies: SpatialScene,
}

impl Default for HostSimulationState {
    fn default() -> Self {
        Self {
            residency: SimulationSceneResidency::default(),
            bodies: SpatialScene::new(),
        }
    }
}

#[derive(Debug, Default)]
/// Newest application request, independent from the slower staged scene build.
struct SimulationInterestTarget {
    /// Host-ordered frontend policy lifetime.
    session: u64,
    /// Newest revision accepted within `session`.
    revision: u64,
    /// Complete normalized owner set selected by that revision.
    owners: SimulationSceneInterest,
}

/// One atomic host tick epoch consumed by app-local adapters.
pub struct HostPhysicalBodyTick {
    /// Body state before the fixed tick.
    pub previous: SpatialBody,
    /// Body state after the fixed tick.
    pub current: SpatialBody,
    /// Generic placed-motion result and orthogonal scene residency.
    pub result: PhysicalBodyTickResult,
    /// Exact immutable topology snapshot used by the solve.
    pub collision: Arc<CollisionScene>,
}

/// One body and the exact installed collision snapshot used to classify its residency.
pub struct HostPhysicalBodySceneSnapshot {
    /// Complete registered body state from the snapshot epoch.
    pub body: SpatialBody,
    /// Immutable collision topology paired with `scene_residency`.
    pub collision: Arc<CollisionScene>,
    /// Body placement relative to `collision`.
    pub scene_residency: PhysicalBodySceneResidency,
}

/// One non-committing collection member paired with its sampled immutable scene.
pub struct HostPhysicalBodyCoverageRejection {
    /// Complete unchanged body state from the collection epoch.
    pub body: SpatialBody,
    /// First normalized owner required by the body's actual transaction.
    pub owner: Guid,
    /// Exact immutable topology snapshot that could not prove `owner`.
    pub collision: Arc<CollisionScene>,
}

/// One committed collection epoch with body motion and report edges kept orthogonal.
pub struct HostDynamicEntityCollectionTick {
    /// Stable-ID directional body commits accepted during this epoch.
    pub bodies: Vec<HostPhysicalBodyTick>,
    /// Body-local coverage rejections that did not prevent independent commits.
    pub coverage_rejections: Vec<HostPhysicalBodyCoverageRejection>,
    /// First-touch and end edges; silent refreshes are intentionally absent.
    pub collision_reports: Vec<CollisionReportOutcome>,
}

struct HostPhysicalBodyTickRequest {
    scene: Arc<CollisionScene>,
    previous: SpatialBody,
    actuation: PhysicalBodyActuation,
    delta_seconds: f32,
    now: std::time::Instant,
    dynamic_contacts: bool,
}

/// Host service that realizes explicit application simulation interest into immutable scenes.
pub struct HostSimulationRuntime {
    /// Injectable producer of complete per-owner collision products.
    source: Arc<dyn CollisionSource>,
    /// Atomic simulation snapshot and registered-body authority.
    state: Mutex<HostSimulationState>,
    /// Serializes product loading and derived-index construction without blocking scene queries.
    update: Mutex<()>,
    /// Publishes the newest requested replacement independently from the slower build.
    target: Mutex<SimulationInterestTarget>,
}

impl HostSimulationRuntime {
    /// Composes the service over the production content source or a focused test source.
    pub fn new(source: Arc<dyn CollisionSource>) -> Self {
        Self {
            source,
            state: Mutex::new(HostSimulationState::default()),
            update: Mutex::new(()),
            target: Mutex::new(SimulationInterestTarget::default()),
        }
    }

    /// Returns the complete immutable collision snapshot current at this instant.
    pub fn snapshot(&self) -> Arc<CollisionScene> {
        self.state
            .lock()
            .expect("collision scene lock poisoned")
            .residency
            .snapshot()
            .scene
            .clone()
    }

    /// Allocates and registers one frontend-local generic body identity.
    pub fn register_ephemeral_body(
        &self,
        pose: WorldPosition,
        now: std::time::Instant,
    ) -> SpatialBodyId {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .register_ephemeral_body(pose, now)
    }

    /// Registers an already validated source-neutral body without re-deriving its policy.
    pub fn register_resolved_physical_body(
        &self,
        pose: WorldPosition,
        retained_cell: Option<Guid>,
        registration: ResolvedPhysicalBodyRegistration,
        now: std::time::Instant,
    ) -> Result<SpatialBodyId> {
        let body_id = self.register_ephemeral_body(pose, now);
        if let Err(error) = self.install_physical_body(body_id, registration, retained_cell) {
            self.remove_body(body_id);
            return Err(error);
        }
        Ok(body_id)
    }

    /// Installs one caller-identified dynamic entity into the canonical host body scene.
    pub fn install_dynamic_entity(
        &self,
        definition: &DynamicEntityDefinition,
        initial: DynamicEntityInitialState,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        install_dynamic_entity_body(&mut state.bodies, definition, initial, physical)
    }

    /// Replaces one same-GUID dynamic body while preserving the old body on failure.
    pub fn replace_dynamic_entity(
        &self,
        definition: &DynamicEntityDefinition,
        initial: DynamicEntityInitialState,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<DynamicEntityBodyReplacementOutcome, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        replace_dynamic_entity_body(&mut state.bodies, definition, initial, physical)
    }

    /// Removes one caller-identified dynamic entity body from the canonical host scene.
    pub fn remove_dynamic_entity(
        &self,
        body_id: SpatialBodyId,
    ) -> Result<DynamicEntityBodyRemovalOutcome, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        remove_dynamic_entity_body(&mut state.bodies, body_id)
    }

    /// Removes a complete registry-owned entity set after validating that every body exists.
    pub fn remove_dynamic_entities(
        &self,
        body_ids: &[SpatialBodyId],
    ) -> Result<Vec<DynamicEntityBodyRemovalOutcome>, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        let mut unique = HashSet::with_capacity(body_ids.len());
        for &body_id in body_ids {
            if !unique.insert(body_id) || state.bodies.body(body_id).is_none() {
                return Err(DynamicEntityBodyOperationError::NotRegistered { body_id });
            }
        }
        Ok(body_ids
            .iter()
            .map(|&body_id| {
                remove_dynamic_entity_body(&mut state.bodies, body_id)
                    .expect("prevalidated body vanished while the host scene lock was held")
            })
            .collect())
    }

    /// Joins producer semantics with the current canonical body only at projection time.
    pub fn project_dynamic_entity(
        &self,
        definition: &DynamicEntityDefinition,
    ) -> Result<DynamicEntityProjectionInput, DynamicEntityBodyOperationError> {
        let state = self.state.lock().expect("host simulation lock poisoned");
        dynamic_entity_projection_input(definition, &state.bodies)
    }

    /// Applies one shared complete-state transition to an existing dynamic entity body.
    pub fn apply_dynamic_entity_physics(
        &self,
        body_id: SpatialBodyId,
        decision: EntityPhysicsTransitionDecision,
        replacement: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        apply_dynamic_entity_physics_transition(&mut state.bodies, body_id, decision, replacement)
    }

    /// Replaces one physical dynamic entity's live vectors and incompatible response memory.
    pub fn apply_dynamic_entity_kinematics(
        &self,
        body_id: SpatialBodyId,
        kinematics: DynamicBodyKinematics,
        now: std::time::Instant,
    ) -> Result<RuntimeSpatialBodyView, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        let body = state
            .bodies
            .body(body_id)
            .ok_or(DynamicEntityBodyOperationError::NotRegistered { body_id })?;
        if body.physical.is_none() {
            return Err(DynamicEntityBodyOperationError::NotPhysical { body_id });
        }
        Ok(state
            .bodies
            .apply_dynamic_body_kinematics(body_id, kinematics, now)
            .expect("prevalidated physical dynamic body lost its collision definition"))
    }

    /// Applies one discontinuous dynamic-entity relocation and clears pose-dependent state.
    pub fn relocate_dynamic_entity(
        &self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: std::time::Instant,
    ) -> Result<DynamicBodyRelocationOutcome, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        if state.bodies.body(body_id).is_none() {
            return Err(DynamicEntityBodyOperationError::NotRegistered { body_id });
        }
        Ok(state
            .bodies
            .relocate_dynamic_body(body_id, pose, now)
            .expect("prevalidated dynamic entity body lost its dynamic physical invariant"))
    }

    /// Installs a source-neutral physical definition, enabling solver participation.
    pub fn install_physical_body(
        &self,
        body_id: SpatialBodyId,
        registration: ResolvedPhysicalBodyRegistration,
        retained_cell: Option<Guid>,
    ) -> Result<()> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        state
            .bodies
            .install_physical_body(
                body_id,
                registration.definition,
                registration.collision_filter,
                registration.response_policy,
                retained_cell,
            )
            .with_context(|| format!("physical body {body_id:?} is not registered"))?;
        Ok(())
    }

    /// Commits one body tick only after an adapter validates its derived contract.
    pub fn tick_physical_body_transaction_with<T>(
        &self,
        body_id: SpatialBodyId,
        delta_seconds: f32,
        now: std::time::Instant,
        build_actuation: impl FnOnce(&SpatialBody) -> Result<PhysicalBodyActuation>,
        accept: impl FnOnce(&HostPhysicalBodyTick) -> Result<T>,
    ) -> Result<(HostPhysicalBodyTick, T)> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        let scene = state.residency.snapshot().scene.clone();
        let previous = state
            .bodies
            .body(body_id)
            .cloned()
            .with_context(|| format!("physical body {body_id:?} is not registered"))?;
        let actuation = build_actuation(&previous)?;
        tick_body_transaction(
            &mut state,
            HostPhysicalBodyTickRequest {
                scene,
                previous,
                actuation,
                delta_seconds,
                now,
                dynamic_contacts: false,
            },
            accept,
        )
    }

    /// Advances every state-eligible dynamic entity in one locked collection epoch.
    ///
    /// Identity order and body facts are captured before the first solve. Each accepted solve
    /// commits independently, while every body observes the same immutable static-collision scene.
    /// The later peer-collision phase can consume this same tick-start snapshot without changing
    /// registry ownership or introducing a whole-world rollback transaction.
    /// `actuation_for` chooses each scheduled body's drive for this tick. Callers that have nothing
    /// to say pass `dynamic_entity_coasting_actuation`; a possessed body's authored offset arrives
    /// this way rather than through registry state the simulation would have to know about.
    pub fn tick_dynamic_entity_collection(
        &self,
        delta_seconds: f32,
        now: std::time::Instant,
        mut actuation_for: impl FnMut(&SpatialBody) -> Result<PhysicalBodyActuation>,
    ) -> Result<HostDynamicEntityCollectionTick> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        let scene = state.residency.snapshot().scene.clone();
        let prepared = state.bodies.prepare_dynamic_entity_collection(
            &scene,
            delta_seconds,
            &mut actuation_for,
        )?;
        let mut coverage_rejections = prepared
            .coverage_rejections
            .into_iter()
            .map(|rejection| HostPhysicalBodyCoverageRejection {
                body: state
                    .bodies
                    .body(rejection.body_id)
                    .cloned()
                    .expect("coverage-rejected body vanished while collection lock was held"),
                owner: rejection.owner,
                collision: Arc::clone(&scene),
            })
            .collect::<Vec<_>>();
        let mut ticks = Vec::with_capacity(prepared.movers.len());
        for (body_id, actuation) in prepared.movers {
            let previous = state
                .bodies
                .body(body_id)
                .cloned()
                .expect("scheduled dynamic body vanished while collection lock was held");
            let solved = tick_body_transaction(
                &mut state,
                HostPhysicalBodyTickRequest {
                    scene: Arc::clone(&scene),
                    previous,
                    actuation,
                    delta_seconds,
                    now,
                    dynamic_contacts: true,
                },
                |_| Ok(()),
            );
            match solved {
                Ok((tick, ())) => ticks.push(tick),
                Err(error) => {
                    let Some(CollisionQueryError::UnavailableOwner { owner }) =
                        error.downcast_ref::<CollisionQueryError>()
                    else {
                        return Err(error);
                    };
                    coverage_rejections.push(HostPhysicalBodyCoverageRejection {
                        body: state
                            .bodies
                            .body(body_id)
                            .cloned()
                            .expect("coverage-rejected body vanished after its tentative solve"),
                        owner: Guid(*owner),
                        collision: Arc::clone(&scene),
                    });
                }
            }
        }
        coverage_rejections.sort_by_key(|rejection| rejection.body.id);
        let mut collision_reports = ticks
            .iter()
            .flat_map(|tick| tick.result.collision_reports.iter().copied())
            .collect::<Vec<_>>();
        collision_reports.extend(state.bodies.finish_dynamic_entity_collection(now)?);
        Ok(HostDynamicEntityCollectionTick {
            bodies: ticks,
            coverage_rejections,
            collision_reports,
        })
    }

    /// Reads one registered body's live view without taking ownership of it.
    pub fn physical_body_view(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .runtime_body_view(body_id)
    }

    /// Whether one registered body faces along its accepted path.
    pub fn physical_body_align_path(&self, body_id: SpatialBodyId) -> Option<bool> {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .body(body_id)?
            .physical
            .as_ref()
            .map(|physical| physical.response_policy.align_path)
    }

    /// Reads the installed physical response shape, or `None` for a pose-only/absent body.
    pub fn physical_body_definition(
        &self,
        body_id: SpatialBodyId,
    ) -> Option<holtburger_world::PhysicalBodyDefinition> {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .body(body_id)?
            .physical
            .as_ref()
            .map(|physical| physical.definition)
    }

    /// Reactivates one settled dynamic body so the next collection scan integrates it.
    ///
    /// A body that has proven stable support drops out of the scan until something disturbs it.
    /// Authored drive is such a disturbance, but it arrives through the actuation closure the scan
    /// itself invokes — so a possessed body has to be woken before the scan, not by it.
    pub fn wake_dynamic_body(&self, body_id: SpatialBodyId) -> bool {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .wake_dynamic_body(body_id)
    }

    /// Clones one complete registered body for an app-local transactional adapter.
    pub fn physical_body_snapshot(&self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .body(body_id)
            .cloned()
    }

    /// Snapshots one physical body together with its residency in the same collision epoch.
    pub fn physical_body_scene_snapshot(
        &self,
        body_id: SpatialBodyId,
    ) -> Option<HostPhysicalBodySceneSnapshot> {
        let state = self.state.lock().expect("host simulation lock poisoned");
        let body = state.bodies.body(body_id)?.clone();
        let physical = body.physical.as_ref()?;
        let collision = state.residency.snapshot().scene.clone();
        let scene_residency = physical_body_scene_residency(
            &collision,
            body.pose,
            physical.definition,
            physical.response.cell(),
        );
        Some(HostPhysicalBodySceneSnapshot {
            body,
            collision,
            scene_residency,
        })
    }

    /// Counts registered runtime bodies for tests that prove query-only adapters stay body-free.
    #[cfg(test)]
    pub(crate) fn registered_body_count(&self) -> usize {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .iter_runtime_body_views()
            .count()
    }

    /// Removes one generic body without changing simulation interest.
    pub fn remove_body(&self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .remove_body(body_id)
    }

    /// Opens a new frontend policy lifetime and invalidates work from every earlier lifetime.
    pub fn reserve_interest_session(&self) -> u64 {
        let mut target = self
            .target
            .lock()
            .expect("simulation interest target lock poisoned");
        target.session = target
            .session
            .checked_add(1)
            .expect("simulation interest session exhausted");
        target.revision = 0;
        target.owners = SimulationSceneInterest::default();
        target.session
    }

    /// Accepts a complete interest replacement and realizes it without blocking scene readers.
    pub fn replace_interest(
        &self,
        request: SimulationInterestRequest,
    ) -> Result<SimulationInterestReceipt> {
        let wanted = parse_owner_set(&request.landblock_ids)?;
        {
            let mut target = self
                .target
                .lock()
                .expect("simulation interest target lock poisoned");
            if request.session == 0
                || request.session != target.session
                || request.revision <= target.revision
            {
                return Ok(receipt(request.revision, false, &[]));
            }
            target.revision = request.revision;
            target.owners = wanted.clone();
        }

        let _update = self
            .update
            .lock()
            .expect("collision scene update lock poisoned");
        if !self.request_is_current(request.session, request.revision, &wanted) {
            return Ok(receipt(request.revision, false, &[]));
        }

        let (scene_request, staging_residency) = {
            let mut state = self.state.lock().expect("collision scene lock poisoned");
            let Some(scene_request) = state.residency.request_interest(wanted.clone()) else {
                let unavailable = unavailable_owners(state.residency.availability());
                return Ok(receipt(request.revision, true, &unavailable));
            };
            (scene_request, state.residency.clone())
        };
        let outcomes = resolve_scene_request(self.source.as_ref(), &scene_request);
        let unavailable = outcomes
            .iter()
            .filter_map(|outcome| match outcome {
                SimulationSceneOwnerOutcome::Absent { owner }
                | SimulationSceneOwnerOutcome::Failed { owner, .. } => Some(*owner),
                SimulationSceneOwnerOutcome::Resident(_)
                | SimulationSceneOwnerOutcome::Retained { .. } => None,
            })
            .collect::<Vec<_>>();
        let staged = staging_residency
            .stage(SimulationSceneBatchCompletion {
                content_source_generation: scene_request.content_source_generation,
                request_revision: scene_request.request_revision,
                outcomes,
            })?
            .expect("a completion staged from its exact request cannot already be stale");

        let target = self
            .target
            .lock()
            .expect("simulation interest target lock poisoned");
        if target.session != request.session
            || target.revision != request.revision
            || target.owners != wanted
        {
            return Ok(receipt(request.revision, false, &unavailable));
        }
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        let committed = matches!(
            state.residency.publish_staged(staged),
            SimulationScenePublication::Published { .. }
        );
        Ok(receipt(request.revision, committed, &unavailable))
    }

    fn request_is_current(
        &self,
        session: u64,
        revision: u64,
        owners: &SimulationSceneInterest,
    ) -> bool {
        let target = self
            .target
            .lock()
            .expect("simulation interest target lock poisoned");
        target.session == session && target.revision == revision && target.owners == *owners
    }
}

fn resolve_scene_request(
    source: &dyn CollisionSource,
    request: &SimulationSceneRequest,
) -> Vec<SimulationSceneOwnerOutcome> {
    request
        .owners
        .iter()
        .map(|operation| match operation {
            SimulationSceneOwnerRequest::Retain {
                owner,
                owner_revision,
            } => SimulationSceneOwnerOutcome::Retained {
                owner: *owner,
                owner_revision: *owner_revision,
            },
            SimulationSceneOwnerRequest::RetainAbsent { owner } => {
                SimulationSceneOwnerOutcome::Absent { owner: *owner }
            }
            SimulationSceneOwnerRequest::RetainFailed { owner, cause } => {
                SimulationSceneOwnerOutcome::Failed {
                    owner: *owner,
                    cause: cause.clone(),
                }
            }
            SimulationSceneOwnerRequest::Load { owner } => match source.load_collision(owner.0) {
                Ok(Some(asset)) => SimulationSceneOwnerOutcome::Resident(asset),
                Ok(None) => SimulationSceneOwnerOutcome::Absent { owner: *owner },
                Err(error) => SimulationSceneOwnerOutcome::Failed {
                    owner: *owner,
                    cause: format!("{error:#}"),
                },
            },
        })
        .collect()
}

fn tick_body_transaction<T>(
    state: &mut HostSimulationState,
    request: HostPhysicalBodyTickRequest,
    accept: impl FnOnce(&HostPhysicalBodyTick) -> Result<T>,
) -> Result<(HostPhysicalBodyTick, T)> {
    let HostPhysicalBodyTickRequest {
        scene,
        previous,
        actuation,
        delta_seconds,
        now,
        dynamic_contacts,
    } = request;
    let body_id = previous.id;
    let accept_tick = |current: &SpatialBody, result: &PhysicalBodyTickResult| {
        accept(&HostPhysicalBodyTick {
            previous: previous.clone(),
            current: current.clone(),
            result: result.clone(),
            collision: Arc::clone(&scene),
        })
    };
    let (result, accepted) = if dynamic_contacts {
        state.bodies.tick_dynamic_physical_body_transaction(
            body_id,
            &scene,
            actuation,
            delta_seconds,
            now,
            accept_tick,
        )?
    } else {
        state.bodies.tick_physical_body_transaction(
            body_id,
            &scene,
            actuation,
            delta_seconds,
            now,
            accept_tick,
        )?
    };
    report_body_placement_recoveries(body_id, &result);
    let current = state
        .bodies
        .body(body_id)
        .cloned()
        .expect("physical body vanished during a locked host tick");
    Ok((
        HostPhysicalBodyTick {
            previous,
            current,
            result,
            collision: scene,
        },
        accepted,
    ))
}

/// Advances a dynamic body on retained velocity alone, which is what an uncommanded entity does.
pub(crate) fn dynamic_entity_coasting_actuation(
    previous: &SpatialBody,
    delta_seconds: f32,
) -> Result<PhysicalBodyActuation> {
    let definition = previous
        .physical
        .as_ref()
        .context("scheduled dynamic body lost its physical definition")?
        .definition;
    match definition {
        PhysicalBodyDefinition::FreeSphere { .. } => PhysicalBodyActuation::free_flight(
            previous.velocity + previous.acceleration * delta_seconds,
        )
        .map_err(Into::into),
        PhysicalBodyDefinition::Grounded { .. } => Ok(PhysicalBodyActuation::Grounded(
            GroundedBodyActuation::coast().with_external_acceleration(previous.acceleration)?,
        )),
    }
}

fn report_body_placement_recoveries(body_id: SpatialBodyId, result: &PhysicalBodyTickResult) {
    let motion = &result.motion;
    if !motion.path.has_recovery() {
        return;
    }
    report_placed_motion_recoveries(&format!("physical body {body_id:?}"), &motion.path);
}

/// Reports an exceptional placement repair at the host boundary that owns runtime diagnostics.
pub(crate) fn report_placed_motion_recoveries(subject: &str, path: &PlacedMotionPath) {
    for (fraction, point) in std::iter::once((0.0, path.initial())).chain(
        path.legs()
            .iter()
            .map(|leg| (leg.end_fraction(), leg.end())),
    ) {
        let Some(recovery) = point.recovery() else {
            continue;
        };
        match recovery {
            PlacementRecovery::Recovered {
                previous_cell,
                recovered_cell,
            } => eprintln!(
                "{subject} repaired placement at path fraction {fraction:.6}: 0x{:08x} -> {}",
                previous_cell.0,
                recovered_cell
                    .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08x}", cell.0),),
            ),
            PlacementRecovery::Ambiguous {
                previous_cell,
                candidates,
                selected_cell,
            } => eprintln!(
                "{subject} found ambiguous placement recovery at path fraction {fraction:.6} from 0x{:08x}; selected {}; candidates: {}",
                previous_cell.0,
                selected_cell
                    .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08x}", cell.0),),
                candidates
                    .iter()
                    .map(|cell| format!("0x{:08x}", cell.0))
                    .collect::<Vec<_>>()
                    .join(", "),
            ),
        }
    }
}

fn parse_owner_set(values: &[String]) -> Result<SimulationSceneInterest> {
    let owners = values
        .iter()
        .map(|value| {
            let hexadecimal = value
                .strip_prefix("0x")
                .or_else(|| value.strip_prefix("0X"))
                .context("simulation-interest landblock must start with 0x")?;
            let owner = Guid(
                u32::from_str_radix(hexadecimal, 16)
                    .context("simulation-interest landblock is not hexadecimal")?,
            );
            ensure!(
                owner.0 & 0xffff == 0xffff,
                "simulation-interest landblock must be a normalized 0xFFFF owner"
            );
            Ok(owner)
        })
        .collect::<Result<Vec<_>>>()?;
    SimulationSceneInterest::new(owners).map_err(Into::into)
}

fn unavailable_owners(
    availability: &std::collections::BTreeMap<Guid, SimulationSceneOwnerAvailability>,
) -> Vec<Guid> {
    availability
        .iter()
        .filter_map(|(&owner, status)| {
            matches!(
                status,
                SimulationSceneOwnerAvailability::Absent
                    | SimulationSceneOwnerAvailability::Failed { .. }
            )
            .then_some(owner)
        })
        .collect()
}

fn receipt(revision: u64, committed: bool, unavailable: &[Guid]) -> SimulationInterestReceipt {
    let mut unavailable_landblock_ids = unavailable
        .iter()
        .map(|owner| format!("0x{:08x}", owner.0))
        .collect::<Vec<_>>();
    unavailable_landblock_ids.sort();
    SimulationInterestReceipt {
        revision,
        committed,
        unavailable_landblock_ids,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Quaternion, Sphere, Vector3};
    use holtburger_content::{LandblockColliders, TerrainCollisionSurface};
    use holtburger_world::{
        FreeSphereConfig, PhysicalElasticity, PhysicalFriction, PhysicalRestitution,
        PhysicalSphereSet, PhysicalSurfaceMotion,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;

    #[derive(Default)]
    struct CountingSource {
        loads: AtomicUsize,
    }

    impl CollisionSource for CountingSource {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            self.loads.fetch_add(1, Ordering::SeqCst);
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::default(),
            }))
        }
    }

    fn request(session: u64, revision: u64, owners: &[&str]) -> SimulationInterestRequest {
        SimulationInterestRequest {
            session,
            revision,
            landblock_ids: owners.iter().map(|owner| (*owner).to_string()).collect(),
        }
    }

    fn resident_owners(state: &HostSimulationState) -> HashSet<Guid> {
        state
            .residency
            .snapshot()
            .availability
            .iter()
            .filter_map(|(&owner, status)| {
                matches!(status, SimulationSceneOwnerAvailability::Resident { .. }).then_some(owner)
            })
            .collect()
    }

    #[test]
    fn complete_interest_replacements_load_and_evict_exact_owners() {
        let source = Arc::new(CountingSource::default());
        let service = HostSimulationRuntime::new(source.clone());
        let session = service.reserve_interest_session();
        assert!(
            service
                .replace_interest(request(session, 1, &["0xda55ffff", "0xdb55ffff"],))
                .unwrap()
                .committed
        );
        assert_eq!(source.loads.load(Ordering::SeqCst), 2);

        assert!(
            service
                .replace_interest(request(session, 2, &["0xdb55ffff", "0xdc55ffff"],))
                .unwrap()
                .committed
        );
        assert_eq!(source.loads.load(Ordering::SeqCst), 3);
        let state = service.state.lock().unwrap();
        assert_eq!(
            resident_owners(&state),
            HashSet::from([Guid(0xdb55_ffff), Guid(0xdc55_ffff)])
        );
    }

    #[test]
    fn stale_interest_is_rejected_before_loading() {
        let source = Arc::new(CountingSource::default());
        let service = HostSimulationRuntime::new(source.clone());
        let session = service.reserve_interest_session();
        service
            .replace_interest(request(session, 2, &["0xda55ffff"]))
            .unwrap();
        let stale = service
            .replace_interest(request(session, 1, &["0xdb55ffff"]))
            .unwrap();
        assert!(!stale.committed);
        assert_eq!(source.loads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn new_frontend_session_restarts_revisions_and_rejects_retired_work() {
        let source = Arc::new(CountingSource::default());
        let service = HostSimulationRuntime::new(source.clone());
        let retired_session = service.reserve_interest_session();
        assert!(
            service
                .replace_interest(request(retired_session, 9, &["0xda55ffff"]))
                .unwrap()
                .committed
        );

        let current_session = service.reserve_interest_session();
        assert!(
            service
                .replace_interest(request(current_session, 1, &["0xdb55ffff"]))
                .unwrap()
                .committed
        );
        let retired = service
            .replace_interest(request(retired_session, 10, &["0xdc55ffff"]))
            .unwrap();

        assert!(!retired.committed);
        assert_eq!(source.loads.load(Ordering::SeqCst), 2);
        let state = service.state.lock().unwrap();
        assert_eq!(resident_owners(&state), HashSet::from([Guid(0xdb55_ffff)]));
    }

    #[test]
    fn invalid_owner_is_rejected_without_loading() {
        let source = Arc::new(CountingSource::default());
        let service = HostSimulationRuntime::new(source.clone());
        let session = service.reserve_interest_session();
        assert!(
            service
                .replace_interest(request(session, 1, &["0xda550100"]))
                .unwrap_err()
                .to_string()
                .contains("normalized")
        );
        assert_eq!(source.loads.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn scene_replacement_does_not_mutate_registered_body_state() {
        let service = HostSimulationRuntime::new(Arc::new(CountingSource::default()));
        let session = service.reserve_interest_session();
        let body_id = service.register_ephemeral_body(
            WorldPosition {
                landblock_id: Guid(0xda55_0020),
                coords: Vector3::new(96.0, 96.0, 20.0),
                rotation: Quaternion::identity(),
            },
            Instant::now(),
        );
        let definition = PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::zero(),
                    radius: 0.25,
                },
                None,
            )
            .unwrap(),
            FreeSphereConfig {
                maximum_substep_distance: 0.25,
                maximum_substeps: 8,
                maximum_contact_passes: 4,
                separation_epsilon: 0.001,
            },
        )
        .unwrap();
        service
            .install_physical_body(
                body_id,
                ResolvedPhysicalBodyRegistration {
                    definition,
                    collision_filter: PhysicalCollisionFilter::ALL,
                    response_policy: PhysicalBodyResponsePolicy {
                        restitution: PhysicalRestitution::Elastic(PhysicalElasticity::ZERO),
                        friction: PhysicalFriction::DEFAULT,
                        surface_motion: PhysicalSurfaceMotion::Stable,
                        align_path: false,
                    },
                },
                None,
            )
            .unwrap();
        let registered = service.physical_body_snapshot(body_id).unwrap();

        let mut owners = Vec::new();
        for y in 0x54u32..=0x56 {
            for x in 0xd9u32..=0xdb {
                owners.push(format!("0x{x:02x}{y:02x}ffff"));
            }
        }
        service
            .replace_interest(SimulationInterestRequest {
                session,
                revision: 1,
                landblock_ids: owners,
            })
            .unwrap();

        let state = service.state.lock().unwrap();
        assert!(
            !state
                .residency
                .snapshot()
                .scene
                .contains_env_cell(Guid(0xda55_0100))
        );
        assert_eq!(state.bodies.body(body_id).unwrap(), &registered);
        drop(state);

        service
            .replace_interest(SimulationInterestRequest {
                session,
                revision: 2,
                landblock_ids: Vec::new(),
            })
            .unwrap();
        let state = service.state.lock().unwrap();
        assert_eq!(state.bodies.body(body_id).unwrap(), &registered);
        assert!(
            !state
                .residency
                .snapshot()
                .scene
                .contains_landblock(Guid(0xda55_ffff))
        );
    }
}
