//! App-local composition of explicit collision interest and generic spatial bodies.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_content::LandblockCollisionAsset;
use holtburger_core::ContentAssetService;
use holtburger_world::{
    CollisionScene, EdgeProtection, GroundedConfig, PhysicalBodyActuation, PhysicalBodyDefinition,
    PhysicalBodyResponsePolicy, PhysicalBodyTickResult, PhysicalCollisionExclusions,
    PhysicalCollisionFilter, PhysicalElasticity, PhysicalFlyConfig, PhysicalFriction,
    PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, PlacedMotionPath,
    PlacementRecovery, SpatialBody, SpatialBodyId, SpatialScene,
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

/// One explicit body-local sphere supplied by a setup adapter or frontend spawn.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalSphereRequest {
    /// Body-local AC-axis center `[east, north, up]` in meters.
    pub center: [f32; 3],
    /// Positive radius in meters.
    pub radius: f32,
}

/// Explicit free-sphere response configuration, independent from spawn provenance.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalFlyConfigRequest {
    /// Maximum distance covered by one anti-tunneling subdivision.
    pub maximum_substep_distance: f32,
    /// Finite subdivision budget for one fixed tick.
    pub maximum_substeps: usize,
    /// Finite contact-separation budget across the tick.
    pub maximum_contact_passes: usize,
    /// Small outward separation applied after an accepted contact.
    pub separation_epsilon: f32,
}

/// Explicit grounded response configuration, independent from shape production.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroundedConfigRequest {
    /// Downward acceleration integrated while the body is airborne.
    pub gravity: f32,
    /// Minimum upward contact-normal component accepted as walkable support.
    pub walkable_normal_z: f32,
    /// Minimum upward contact-normal component a body without walkable support accepts as a
    /// landing; landings between this and `walkable_normal_z` classify as contact-slide.
    pub landing_normal_z: f32,
    /// Step-down reach of the lenient landing probe for bodies without walkable support.
    pub airborne_step_down_height: f32,
    /// Maximum vertical rise attempted by step-up response.
    pub step_up_height: f32,
    /// Maximum downward support search after horizontal motion.
    pub step_down_height: f32,
    /// Policy for retaining support near finite authored edges.
    pub edge_protection: EdgeProtectionRequest,
    /// Maximum distance covered by one anti-tunneling subdivision.
    pub maximum_substep_distance: f32,
    /// Finite subdivision budget for one fixed tick.
    pub maximum_substeps: usize,
    /// Finite contact-separation budget across the tick.
    pub maximum_contact_passes: usize,
    /// Small outward separation applied after an accepted contact.
    pub separation_epsilon: f32,
}

/// Supported grounded edge policy at the serialized registration boundary.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeProtectionRequest {
    /// Accept unsupported poses, including walking over an authored edge.
    None,
    /// Protect only edges beyond the grounded short-drop policy.
    Creature,
}

/// Response semantics composed with caller-supplied geometry.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PhysicalResponseRequest {
    /// Collision-aware unrestricted three-dimensional motion.
    FreeSphere {
        /// Finite response configuration for the single supplied sphere.
        config: PhysicalFlyConfigRequest,
    },
    /// Gravity, support, step, and edge response.
    Grounded {
        /// Finite response configuration for the role-ordered sphere set.
        config: GroundedConfigRequest,
    },
}

/// Explicit eligible-impact behavior at the serialized registration boundary.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PhysicalRestitutionRequest {
    /// Retail normal-component reflection with a bounded coefficient.
    Elastic {
        /// Requested coefficient; the world type applies retail's `[0.0, 0.1]` clamp.
        elasticity: f32,
    },
    /// Zero complete velocity on an eligible impact.
    Inelastic,
}

/// Explicit stable-versus-Sledding surface response.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalSurfaceMotionRequest {
    /// Ordinary stable support response.
    Stable,
    /// Retail physics-state `Sledding` response.
    Sledding,
}

/// Complete mutable response policy required from every frontend-created body.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalBodyResponsePolicyRequest {
    /// Eligible impact behavior.
    pub restitution: PhysicalRestitutionRequest,
    /// Authored supported-surface friction in the inclusive unit interval.
    pub friction: f32,
    /// Stable or retail Sledding support behavior.
    pub surface_motion: PhysicalSurfaceMotionRequest,
    /// Whether path displacement supersedes Sledding velocity-facing.
    pub align_path: bool,
}

impl PhysicalBodyResponsePolicyRequest {
    pub(crate) fn resolve(self) -> Result<PhysicalBodyResponsePolicy> {
        Ok(PhysicalBodyResponsePolicy {
            restitution: match self.restitution {
                PhysicalRestitutionRequest::Elastic { elasticity } => {
                    PhysicalRestitution::Elastic(PhysicalElasticity::new(elasticity)?)
                }
                PhysicalRestitutionRequest::Inelastic => PhysicalRestitution::Inelastic,
            },
            friction: PhysicalFriction::new(self.friction)?,
            surface_motion: match self.surface_motion {
                PhysicalSurfaceMotionRequest::Stable => PhysicalSurfaceMotion::Stable,
                PhysicalSurfaceMotionRequest::Sledding => PhysicalSurfaceMotion::Sledding,
            },
            align_path: self.align_path,
        })
    }
}

#[cfg(test)]
pub(crate) const fn stable_response_policy_request(
    elasticity: f32,
) -> PhysicalBodyResponsePolicyRequest {
    PhysicalBodyResponsePolicyRequest {
        restitution: PhysicalRestitutionRequest::Elastic { elasticity },
        friction: 0.95,
        surface_motion: PhysicalSurfaceMotionRequest::Stable,
        align_path: false,
    }
}

/// Source-neutral serialized physical definition used by app-local body registration adapters.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalBodyDefinitionRequest {
    /// Ordered role-bearing spheres; explicit registrations are never silently truncated.
    pub spheres: Vec<PhysicalSphereRequest>,
    /// Implemented response semantics and finite solver policy.
    pub response: PhysicalResponseRequest,
    /// Complete initial mutable response policy; no camera or entity defaults are inferred here.
    pub response_policy: PhysicalBodyResponsePolicyRequest,
    /// Explicit optional collision domains ignored by this body.
    pub collision_exclusions: Vec<PhysicalCollisionExclusionRequest>,
}

/// Optional collision domain excluded by a frontend-created body.
#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PhysicalCollisionExclusionRequest {
    /// Retail's whole-landblock ocean restriction does not obstruct this body.
    EntirelyWaterBarrier,
}

/// Fully validated app-local body registration passed atomically into simulation state.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedPhysicalBodyRegistration {
    /// Validated geometry and solver response kind.
    pub definition: PhysicalBodyDefinition,
    /// Body-owned optional collision-domain exclusions.
    pub collision_filter: PhysicalCollisionFilter,
    /// Initial mutable contact response.
    pub response_policy: PhysicalBodyResponsePolicy,
}

impl PhysicalBodyDefinitionRequest {
    /// Validates the complete body registration without permitting partially resolved consumers.
    pub fn resolve(&self) -> Result<ResolvedPhysicalBodyRegistration> {
        ensure!(
            (1..=2).contains(&self.spheres.len()),
            "physical body requires one or two spheres"
        );
        let sphere = |request: PhysicalSphereRequest| holtburger_common::Sphere {
            center: Vector3::new(request.center[0], request.center[1], request.center[2]),
            radius: request.radius,
        };
        let spheres = PhysicalSphereSet::new(
            sphere(self.spheres[0]),
            self.spheres.get(1).copied().map(sphere),
        )?;
        let definition = match self.response {
            PhysicalResponseRequest::FreeSphere { config } => PhysicalBodyDefinition::free_sphere(
                spheres,
                PhysicalFlyConfig {
                    maximum_substep_distance: config.maximum_substep_distance,
                    maximum_substeps: config.maximum_substeps,
                    maximum_contact_passes: config.maximum_contact_passes,
                    separation_epsilon: config.separation_epsilon,
                },
            )?,
            PhysicalResponseRequest::Grounded { config } => PhysicalBodyDefinition::grounded(
                spheres,
                GroundedConfig {
                    gravity: config.gravity,
                    walkable_normal_z: config.walkable_normal_z,
                    landing_normal_z: config.landing_normal_z,
                    airborne_step_down_height: config.airborne_step_down_height,
                    step_up_height: config.step_up_height,
                    step_down_height: config.step_down_height,
                    edge_protection: match config.edge_protection {
                        EdgeProtectionRequest::None => EdgeProtection::None,
                        EdgeProtectionRequest::Creature => EdgeProtection::Creature,
                    },
                    maximum_substep_distance: config.maximum_substep_distance,
                    maximum_substeps: config.maximum_substeps,
                    maximum_contact_passes: config.maximum_contact_passes,
                    separation_epsilon: config.separation_epsilon,
                },
            )?,
        };
        Ok(ResolvedPhysicalBodyRegistration {
            definition,
            collision_filter: resolve_collision_filter(&self.collision_exclusions)?,
            response_policy: self.response_policy.resolve()?,
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
        let (result, accepted) = state.bodies.tick_physical_body_transaction(
            body_id,
            &scene,
            actuation,
            delta_seconds,
            now,
            |current, result| {
                accept(&HostPhysicalBodyTick {
                    previous: previous.clone(),
                    current: current.clone(),
                    result: result.clone(),
                    collision: Arc::clone(&scene),
                })
            },
        )?;
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
        let mut next_resident = resident;
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
    use holtburger_common::{Quaternion, Sphere};
    use holtburger_content::{LandblockColliders, TerrainCollisionSurface};
    use holtburger_world::{
        PhysicalBodyDefinition, PhysicalFlyConfig, PhysicalSphereSet, RETAIL_WALKABLE_NORMAL_Z,
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
    fn body_definition_request_accepts_arbitrary_geometry_without_profiles() {
        let first = PhysicalBodyDefinitionRequest {
            collision_exclusions: Vec::new(),
            spheres: vec![PhysicalSphereRequest {
                center: [0.1, -0.2, 0.3],
                radius: 0.27,
            }],
            response: PhysicalResponseRequest::FreeSphere {
                config: PhysicalFlyConfigRequest {
                    maximum_substep_distance: 0.2,
                    maximum_substeps: 8,
                    maximum_contact_passes: 4,
                    separation_epsilon: 0.001,
                },
            },
            response_policy: stable_response_policy_request(0.0),
        }
        .resolve()
        .unwrap();
        let second = PhysicalBodyDefinitionRequest {
            collision_exclusions: Vec::new(),
            spheres: vec![PhysicalSphereRequest {
                center: [-0.4, 0.5, 0.6],
                radius: 0.73,
            }],
            response: PhysicalResponseRequest::FreeSphere {
                config: PhysicalFlyConfigRequest {
                    maximum_substep_distance: 0.2,
                    maximum_substeps: 8,
                    maximum_contact_passes: 4,
                    separation_epsilon: 0.001,
                },
            },
            response_policy: stable_response_policy_request(0.0),
        }
        .resolve()
        .unwrap();

        assert_ne!(first.definition, second.definition);
        assert!(
            matches!(first.definition, PhysicalBodyDefinition::FreeSphere { sphere, .. }
            if sphere.center == Vector3::new(0.1, -0.2, 0.3) && sphere.radius == 0.27)
        );
        assert!(
            matches!(second.definition, PhysicalBodyDefinition::FreeSphere { sphere, .. }
            if sphere.center == Vector3::new(-0.4, 0.5, 0.6) && sphere.radius == 0.73)
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
    fn body_definition_request_rejects_a_third_grounded_sphere_without_truncation() {
        let error = PhysicalBodyDefinitionRequest {
            collision_exclusions: Vec::new(),
            spheres: vec![
                PhysicalSphereRequest {
                    center: [0.0, 0.0, 0.4],
                    radius: 0.5,
                },
                PhysicalSphereRequest {
                    center: [0.0, 0.0, 1.2],
                    radius: 0.5,
                },
                PhysicalSphereRequest {
                    center: [0.0, 0.0, 2.0],
                    radius: 0.5,
                },
            ],
            response: PhysicalResponseRequest::Grounded {
                config: GroundedConfigRequest {
                    gravity: -9.8,
                    walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
                    landing_normal_z: holtburger_world::RETAIL_LANDING_NORMAL_Z,
                    airborne_step_down_height: holtburger_world::RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
                    step_up_height: 0.6,
                    step_down_height: 1.5,
                    edge_protection: EdgeProtectionRequest::Creature,
                    maximum_substep_distance: 0.25,
                    maximum_substeps: 8,
                    maximum_contact_passes: 4,
                    separation_epsilon: 0.001,
                },
            },
            response_policy: stable_response_policy_request(0.05),
        }
        .resolve()
        .unwrap_err();

        assert!(error.to_string().contains("one or two spheres"));
    }

    #[test]
    fn body_definition_request_rejects_response_shape_mismatch() {
        let error = PhysicalBodyDefinitionRequest {
            collision_exclusions: Vec::new(),
            spheres: vec![
                PhysicalSphereRequest {
                    center: [0.0, 0.0, 0.4],
                    radius: 0.5,
                },
                PhysicalSphereRequest {
                    center: [0.0, 0.0, 1.2],
                    radius: 0.5,
                },
            ],
            response: PhysicalResponseRequest::FreeSphere {
                config: PhysicalFlyConfigRequest {
                    maximum_substep_distance: 0.25,
                    maximum_substeps: 8,
                    maximum_contact_passes: 4,
                    separation_epsilon: 0.001,
                },
            },
            response_policy: stable_response_policy_request(0.0),
        }
        .resolve()
        .unwrap_err();

        assert!(error.to_string().contains("upper constraint"));
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
                    response_policy: stable_response_policy_request(0.0).resolve().unwrap(),
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
