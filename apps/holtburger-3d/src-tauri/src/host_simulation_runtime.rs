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
    DynamicEntityProjectionInput, apply_dynamic_entity_physics_transition,
    dynamic_entity_projection_input, install_dynamic_entity_body, remove_dynamic_entity_body,
    replace_dynamic_entity_body,
};
use holtburger_world::{
    CollisionScene, DynamicBodyKinematics, DynamicContactBudgetExceeded,
    DynamicPhysicalBodyDefinition, EdgeProtection, EntityPhysicsTransitionDecision,
    GroundedBodyActuation, PhysicalBodyActuation, PhysicalBodyDefinition,
    PhysicalBodyResponsePolicy, PhysicalBodyTickResult, PhysicalCollisionExclusions,
    PhysicalCollisionFilter, PlacedMotionPath, PlacementRecovery, RuntimeSpatialBodyView,
    SpatialBody, SpatialBodyId, SpatialScene,
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

/// Serialized edge-protection policy choice.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeProtectionRequest {
    /// Accept the unsupported candidate and begin falling.
    None,
    /// Preserve the last supported pose when no supported edge slide is available.
    Creature,
}

/// Optional collision domain excluded by a frontend-created body.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalCollisionExclusionRequest {
    /// Retail's whole-landblock ocean restriction does not obstruct this body.
    EntirelyWaterBarrier,
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

/// Named body profile resolved host-side from `holtburger-core`.
///
/// The frontend names what it wants plus its app-policy knobs; every retail solver constant is
/// sourced from the core profile builders rather than mirrored across languages (contact-slide
/// plan, host-resolved body profiles addendum).
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(
    tag = "profile",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PhysicalBodyProfileRequest {
    /// The retail player as a grounded body; edge protection stays frontend/UX policy.
    RetailPlayerGrounded {
        /// Policy for retaining support near finite authored edges.
        edge_protection: EdgeProtectionRequest,
    },
    /// The retail render-viewer as a free-flying clip sphere.
    PhysicalFlyViewer,
}

/// Frontend-facing body registration: a named profile plus body-owned collision exclusions.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalBodyProfileBodyRequest {
    /// Named profile resolved by `holtburger-core`.
    #[serde(flatten)]
    pub profile: PhysicalBodyProfileRequest,
    /// Explicit optional collision domains ignored by this body.
    pub collision_exclusions: Vec<PhysicalCollisionExclusionRequest>,
}

impl PhysicalBodyProfileBodyRequest {
    /// Resolves the named profile and exclusions into one validated registration.
    pub fn resolve(&self) -> Result<ResolvedPhysicalBodyRegistration> {
        let profile = match self.profile {
            PhysicalBodyProfileRequest::RetailPlayerGrounded { edge_protection } => {
                holtburger_core::retail_player_grounded_profile(match edge_protection {
                    EdgeProtectionRequest::None => EdgeProtection::None,
                    EdgeProtectionRequest::Creature => EdgeProtection::Creature,
                })?
            }
            PhysicalBodyProfileRequest::PhysicalFlyViewer => {
                holtburger_core::physical_fly_viewer_profile()?
            }
        };
        Ok(ResolvedPhysicalBodyRegistration {
            definition: profile.definition,
            collision_filter: resolve_collision_filter(&self.collision_exclusions)?,
            response_policy: profile.response_policy,
        })
    }
}

fn resolve_collision_filter(
    requested: &[PhysicalCollisionExclusionRequest],
) -> Result<PhysicalCollisionFilter> {
    let mut exclusions = PhysicalCollisionExclusions::empty();
    for exclusion in requested {
        let bit = match exclusion {
            PhysicalCollisionExclusionRequest::EntirelyWaterBarrier => {
                PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER
            }
        };
        ensure!(
            !exclusions.contains(bit),
            "physical body collision exclusions contain a duplicate"
        );
        exclusions.insert(bit);
    }
    Ok(PhysicalCollisionFilter::excluding(exclusions))
}

/// State that must change atomically with respect to every generic body tick.
struct HostSimulationState {
    /// Complete immutable collision topology used by the next tick.
    scene: Arc<CollisionScene>,
    /// Normalized owners whose products are present in `scene`.
    resident: HashSet<Guid>,
    /// Canonical identity, pose, and physical state for every registered body.
    bodies: SpatialScene,
}

impl Default for HostSimulationState {
    fn default() -> Self {
        Self {
            scene: Arc::new(CollisionScene::new()),
            resident: HashSet::new(),
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
    owners: HashSet<Guid>,
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
        Arc::clone(
            &self
                .state
                .lock()
                .expect("collision scene lock poisoned")
                .scene,
        )
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
        if let Err(error) = self.attach_physical_body(body_id, registration, retained_cell) {
            self.remove_body(body_id);
            return Err(error);
        }
        Ok(body_id)
    }

    /// Installs one caller-identified dynamic entity into the canonical host body scene.
    pub fn install_dynamic_entity(
        &self,
        definition: &DynamicEntityDefinition,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        install_dynamic_entity_body(&mut state.bodies, definition, physical)
    }

    /// Replaces one same-GUID dynamic body while preserving the old body on failure.
    pub fn replace_dynamic_entity(
        &self,
        definition: &DynamicEntityDefinition,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<DynamicEntityBodyReplacementOutcome, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        replace_dynamic_entity_body(&mut state.bodies, definition, physical)
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
    ) -> Result<RuntimeSpatialBodyView, DynamicEntityBodyOperationError> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        if state.bodies.body(body_id).is_none() {
            return Err(DynamicEntityBodyOperationError::NotRegistered { body_id });
        }
        Ok(state
            .bodies
            .relocate_dynamic_body(body_id, pose, now)
            .expect("prevalidated dynamic entity body lost its dynamic physical invariant"))
    }

    /// Attaches a source-neutral physical definition.
    pub fn attach_physical_body(
        &self,
        body_id: SpatialBodyId,
        registration: ResolvedPhysicalBodyRegistration,
        retained_cell: Option<Guid>,
    ) -> Result<()> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        state
            .bodies
            .attach_physical_body(
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
        let scene = Arc::clone(&state.scene);
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
    pub fn tick_dynamic_entity_collection(
        &self,
        delta_seconds: f32,
        now: std::time::Instant,
    ) -> Result<Vec<HostPhysicalBodyTick>> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        let scene = Arc::clone(&state.scene);
        let tick_start =
            state
                .bodies
                .prepare_dynamic_entity_collection(&scene, delta_seconds, |previous| {
                    dynamic_entity_coasting_actuation(previous, delta_seconds)
                })?;
        let mut ticks = Vec::with_capacity(tick_start.len());
        for (body_id, actuation) in tick_start {
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
                Err(error)
                    if error
                        .downcast_ref::<DynamicContactBudgetExceeded>()
                        .is_some() =>
                {
                    eprintln!("Explorer dynamic-entity solve rejected: {error:#}");
                }
                Err(error) => return Err(error),
            }
        }
        Ok(ticks)
    }

    #[cfg(test)]
    pub fn physical_body_snapshot(&self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .body(body_id)
            .cloned()
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
        target.owners.clear();
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

        let (scene, resident) = {
            let state = self.state.lock().expect("collision scene lock poisoned");
            (Arc::clone(&state.scene), state.resident.clone())
        };
        let missing = wanted
            .iter()
            .copied()
            .filter(|owner| !resident.contains(owner))
            .collect::<Vec<_>>();
        let stale = resident
            .iter()
            .copied()
            .filter(|owner| !wanted.contains(owner))
            .collect::<Vec<_>>();

        let mut insertions = Vec::new();
        let mut next_resident = resident.clone();
        let mut unavailable = Vec::new();
        for owner in missing {
            match self
                .source
                .load_collision(owner.0)
                .with_context(|| format!("could not load collision owner 0x{:08X}", owner.0))?
            {
                Some(asset) => {
                    next_resident.insert(owner);
                    insertions.push(asset);
                }
                None => unavailable.push(owner),
            }
        }
        for owner in &stale {
            next_resident.remove(owner);
        }
        let next_scene = scene
            .staged_residency_change(insertions, &stale)
            .context("could not rebuild simulation-interest collision scene")?;
        let collision_changed = next_resident != resident;

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
        state.scene = Arc::new(next_scene);
        state.resident = next_resident;
        if collision_changed {
            // Support dependencies are intentionally not tracked. The 50-300 body target makes a
            // conservative wake cheaper and safer until Phase R2 supplies evidence otherwise.
            state.bodies.wake_all_settled_dynamic_bodies();
        }
        Ok(receipt(request.revision, true, &unavailable))
    }

    fn request_is_current(&self, session: u64, revision: u64, owners: &HashSet<Guid>) -> bool {
        let target = self
            .target
            .lock()
            .expect("simulation interest target lock poisoned");
        target.session == session && target.revision == revision && target.owners == *owners
    }
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

fn dynamic_entity_coasting_actuation(
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

fn parse_owner_set(values: &[String]) -> Result<HashSet<Guid>> {
    values
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
        PhysicalElasticity, PhysicalFlyConfig, PhysicalFriction, PhysicalRestitution,
        PhysicalSphereSet, PhysicalSurfaceMotion, RETAIL_WALKABLE_NORMAL_Z,
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
            state.resident,
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
        assert_eq!(
            service.state.lock().unwrap().resident,
            HashSet::from([Guid(0xdb55_ffff)])
        );
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
    fn profile_requests_resolve_both_camera_profiles() {
        let fly = PhysicalBodyProfileBodyRequest {
            profile: PhysicalBodyProfileRequest::PhysicalFlyViewer,
            collision_exclusions: vec![PhysicalCollisionExclusionRequest::EntirelyWaterBarrier],
        }
        .resolve()
        .unwrap();
        assert!(matches!(
            fly.definition,
            PhysicalBodyDefinition::FreeSphere { .. }
        ));

        let grounded = PhysicalBodyProfileBodyRequest {
            profile: PhysicalBodyProfileRequest::RetailPlayerGrounded {
                edge_protection: EdgeProtectionRequest::Creature,
            },
            collision_exclusions: Vec::new(),
        }
        .resolve()
        .unwrap();
        let PhysicalBodyDefinition::Grounded { config, .. } = grounded.definition else {
            panic!("retail player profile must resolve grounded");
        };
        assert_eq!(config.walkable_normal_z, RETAIL_WALKABLE_NORMAL_Z);
        assert_eq!(
            config.edge_protection,
            holtburger_world::EdgeProtection::Creature
        );
    }

    #[test]
    fn collision_filter_rejects_duplicate_exclusions() {
        let error = resolve_collision_filter(&[
            PhysicalCollisionExclusionRequest::EntirelyWaterBarrier,
            PhysicalCollisionExclusionRequest::EntirelyWaterBarrier,
        ])
        .unwrap_err();

        assert!(error.to_string().contains("duplicate"));
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
            PhysicalFlyConfig {
                maximum_substep_distance: 0.25,
                maximum_substeps: 8,
                maximum_contact_passes: 4,
                separation_epsilon: 0.001,
            },
        )
        .unwrap();
        service
            .attach_physical_body(
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
        assert!(!state.scene.contains_env_cell(Guid(0xda55_0100)));
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
        assert!(!state.scene.contains_landblock(Guid(0xda55_ffff)));
    }
}
