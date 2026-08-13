//! App-local composition of explicit collision interest and generic spatial bodies.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::LandblockCollisionAsset;
use holtburger_core::ContentAssetService;
use holtburger_world::{
    CollisionScene, EdgeProtection, GroundedConfig, InvalidPhysicalBodyPlacement,
    PhysicalBodyActivity, PhysicalBodyDefinition, PhysicalBodyTickResult, PhysicalFlyConfig,
    PhysicalSphereSet, PlacedMotionPath, PlacementRecovery, SpatialBody, SpatialBodyEvent,
    SpatialBodyId, SpatialScene,
};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

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

/// Source-neutral serialized physical definition used by every frontend registration path.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalBodyDefinitionRequest {
    /// Ordered role-bearing spheres; explicit registrations are never silently truncated.
    pub spheres: Vec<PhysicalSphereRequest>,
    /// Implemented response semantics and finite solver policy.
    pub response: PhysicalResponseRequest,
}

/// Explicit AC-world pose for a frontend-owned generic body registration.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalBodyPoseRequest {
    /// Exact outdoor cell or EnvCell identifier carrying the local frame.
    pub landblock_id: String,
    /// Landblock-local AC-axis body-reference coordinates.
    pub coords: [f32; 3],
    /// Unit quaternion `[w, x, y, z]`.
    pub rotation: [f32; 4],
}

/// Generic frontend-owned registration with an explicit pose and physical definition.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendPhysicalBodyRegistration {
    /// Initial authoritative body-reference pose.
    pub pose: PhysicalBodyPoseRequest,
    /// Prior EnvCell selected by portal history, or `None` while outdoors.
    pub retained_cell_id: Option<String>,
    /// Explicit geometry and response semantics to validate before registration.
    pub body: PhysicalBodyDefinitionRequest,
}

impl FrontendPhysicalBodyRegistration {
    fn resolve(&self) -> Result<(WorldPosition, Option<Guid>, PhysicalBodyDefinition)> {
        let landblock_id = parse_guid(&self.pose.landblock_id, "physical body landblock")?;
        let retained_cell = self
            .retained_cell_id
            .as_deref()
            .map(|cell| parse_guid(cell, "physical body retained EnvCell"))
            .transpose()?;
        if let Some(cell) = retained_cell {
            ensure!(
                cell.0 & 0xffff >= 0x0100 && cell.0 & 0xffff_0000 == landblock_id.0 & 0xffff_0000,
                "physical body retained EnvCell does not belong to its pose owner"
            );
        }
        let values = self.pose.coords.iter().chain(self.pose.rotation.iter());
        ensure!(
            values.clone().all(|value| value.is_finite()),
            "physical body pose must be finite"
        );
        let rotation = Quaternion {
            w: self.pose.rotation[0],
            x: self.pose.rotation[1],
            y: self.pose.rotation[2],
            z: self.pose.rotation[3],
        };
        let rotation_length_squared = rotation.w * rotation.w
            + rotation.x * rotation.x
            + rotation.y * rotation.y
            + rotation.z * rotation.z;
        ensure!(
            (rotation_length_squared - 1.0).abs() <= 0.001,
            "physical body rotation must be a unit quaternion"
        );
        Ok((
            WorldPosition {
                landblock_id,
                coords: Vector3::new(
                    self.pose.coords[0],
                    self.pose.coords[1],
                    self.pose.coords[2],
                ),
                rotation,
            },
            retained_cell,
            self.body.resolve()?,
        ))
    }
}

impl PhysicalBodyDefinitionRequest {
    /// Validates geometry, cardinality, response compatibility, and solver configuration.
    pub fn resolve(&self) -> Result<PhysicalBodyDefinition> {
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
        Ok(match self.response {
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
        })
    }
}

/// Generic event emitted when one body's collision availability changes.
pub const BODY_ACTIVITY_EVENT: &str = "host://physical-body-activity";

/// Transport-safe generic body identity; spawn provenance remains outside physical definitions.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum HostSpatialBodyId {
    /// Authoritative server/world entity.
    Entity {
        /// Hexadecimal entity GUID.
        guid: String,
    },
    /// Session-local authoritative player.
    LocalPlayer {
        /// Hexadecimal player GUID.
        guid: String,
    },
    /// Host-allocated frontend-local body.
    Ephemeral {
        /// Monotonic host-local identifier.
        id: u64,
    },
}

impl From<SpatialBodyId> for HostSpatialBodyId {
    fn from(body_id: SpatialBodyId) -> Self {
        match body_id {
            SpatialBodyId::Entity(guid) => Self::Entity {
                guid: format!("0x{:08x}", guid.0),
            },
            SpatialBodyId::LocalPlayer(guid) => Self::LocalPlayer {
                guid: format!("0x{:08x}", guid.0),
            },
            SpatialBodyId::Ephemeral(id) => Self::Ephemeral { id },
        }
    }
}

/// Transport-safe exhaustive body availability state.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum HostPhysicalBodyActivity {
    /// Collision coverage and retained placement are valid.
    Active,
    /// Exact collision owners required before simulation may resume.
    AwaitingCoverage {
        /// Sorted normalized landblock owners absent from the collision snapshot.
        landblock_ids: Vec<String>,
        /// Whether the required source halo extends beyond the AC world grid.
        outside_world: bool,
    },
    /// Restored topology cannot accept the retained body placement.
    InvalidPlacement {
        /// Stable human-readable reason suitable for application diagnostics.
        reason: String,
    },
}

/// One body identity paired with its newly authoritative availability.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostPhysicalBodyActivityEvent {
    /// Stable identity whose activity changed.
    pub body_id: HostSpatialBodyId,
    /// Newly authoritative exhaustive activity.
    pub activity: HostPhysicalBodyActivity,
}

/// State that must change atomically with respect to every generic body tick.
struct HostSimulationState {
    /// Complete immutable collision topology used by the next tick.
    scene: Arc<CollisionScene>,
    /// Normalized owners whose products are present in `scene`.
    resident: HashSet<Guid>,
    /// Canonical identity, pose, and physical state for every registered body.
    bodies: SpatialScene,
    /// Availability transitions waiting for the app transport to drain them.
    body_events: Vec<SpatialBodyEvent>,
}

impl Default for HostSimulationState {
    fn default() -> Self {
        Self {
            scene: Arc::new(CollisionScene::new()),
            resident: HashSet::new(),
            bodies: SpatialScene::new(),
            body_events: Vec::new(),
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
    /// Body state after the fixed tick or retained inactive hold.
    pub current: SpatialBody,
    /// Generic placed-motion or inactive result.
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

    /// Validates and registers one arbitrary frontend-owned body definition.
    pub fn register_frontend_physical_body(
        &self,
        registration: &FrontendPhysicalBodyRegistration,
        now: std::time::Instant,
    ) -> Result<SpatialBodyId> {
        let (pose, retained_cell, definition) = registration.resolve()?;
        let body_id = self.register_ephemeral_body(pose, now);
        if let Err(error) = self.attach_physical_body(body_id, definition, retained_cell) {
            self.remove_body(body_id);
            return Err(error);
        }
        Ok(body_id)
    }

    /// Attaches a source-neutral physical definition and publishes its initial activity.
    pub fn attach_physical_body(
        &self,
        body_id: SpatialBodyId,
        definition: PhysicalBodyDefinition,
        retained_cell: Option<Guid>,
    ) -> Result<()> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        let scene = Arc::clone(&state.scene);
        let event = state
            .bodies
            .attach_physical_body(body_id, definition, retained_cell, &scene)?
            .with_context(|| format!("physical body {body_id:?} is not registered"))?;
        state.body_events.push(event);
        Ok(())
    }

    /// Advances one generic body against the scene snapshot committed under the same lock.
    pub fn tick_physical_body(
        &self,
        body_id: SpatialBodyId,
        desired_velocity: Vector3,
        delta_seconds: f32,
        now: std::time::Instant,
    ) -> Result<HostPhysicalBodyTick> {
        let mut state = self.state.lock().expect("host simulation lock poisoned");
        let scene = Arc::clone(&state.scene);
        let previous = state
            .bodies
            .body(body_id)
            .cloned()
            .with_context(|| format!("physical body {body_id:?} is not registered"))?;
        let result = state.bodies.tick_physical_body(
            body_id,
            &scene,
            desired_velocity,
            delta_seconds,
            now,
        )?;
        report_body_placement_recoveries(body_id, &result);
        if let Some(event) = result.activity_event.clone() {
            state.body_events.push(event);
        }
        let current = state
            .bodies
            .body(body_id)
            .cloned()
            .expect("physical body vanished during a locked host tick");
        Ok(HostPhysicalBodyTick {
            previous,
            current,
            result,
            collision: scene,
        })
    }

    /// Removes one generic body without changing simulation interest.
    pub fn remove_body(&self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.state
            .lock()
            .expect("host simulation lock poisoned")
            .bodies
            .remove_body(body_id)
    }

    /// Drains typed body-availability transitions for transport or application policy.
    pub fn take_body_events(&self) -> Vec<HostPhysicalBodyActivityEvent> {
        std::mem::take(
            &mut self
                .state
                .lock()
                .expect("host simulation lock poisoned")
                .body_events,
        )
        .into_iter()
        .filter_map(host_body_activity_event)
        .collect()
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
        let body_events = state
            .bodies
            .reevaluate_physical_bodies(&next_scene)
            .context("could not reevaluate physical bodies against replacement collision scene")?;
        state.scene = Arc::new(next_scene);
        state.resident = next_resident;
        state.body_events.extend(body_events);
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
    let holtburger_world::PhysicalBodyTickOutcome::Motion(motion) = &result.outcome else {
        return;
    };
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

fn host_body_activity_event(event: SpatialBodyEvent) -> Option<HostPhysicalBodyActivityEvent> {
    let SpatialBodyEvent::PhysicalActivityChanged { body_id, activity } = event else {
        return None;
    };
    Some(HostPhysicalBodyActivityEvent {
        body_id: body_id.into(),
        activity: match activity {
            PhysicalBodyActivity::Active => HostPhysicalBodyActivity::Active,
            PhysicalBodyActivity::AwaitingCoverage(missing) => {
                HostPhysicalBodyActivity::AwaitingCoverage {
                    landblock_ids: missing
                        .landblocks
                        .into_iter()
                        .map(|owner| format!("0x{:08x}", owner.0))
                        .collect(),
                    outside_world: missing.outside_world,
                }
            }
            PhysicalBodyActivity::InvalidPlacement(reason) => {
                HostPhysicalBodyActivity::InvalidPlacement {
                    reason: match reason {
                        InvalidPhysicalBodyPlacement::RetainedCellUnavailable(cell) => format!(
                            "retained EnvCell 0x{:08x} is unavailable in restored topology",
                            cell.0
                        ),
                        InvalidPhysicalBodyPlacement::PlacementChanged { retained, restored } => {
                            format!(
                                "restored placement changed from {} to {}",
                                optional_cell_name(retained),
                                optional_cell_name(restored)
                            )
                        }
                        InvalidPhysicalBodyPlacement::OverlapsStaticCollision => {
                            "retained body overlaps restored static collision".to_string()
                        }
                    },
                }
            }
        },
    })
}

fn optional_cell_name(cell: Option<Guid>) -> String {
    cell.map_or_else(
        || "outdoors".to_string(),
        |cell| format!("0x{:08x}", cell.0),
    )
}

fn parse_guid(value: &str, label: &str) -> Result<Guid> {
    let hexadecimal = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .with_context(|| format!("{label} must start with 0x"))?;
    Ok(Guid(
        u32::from_str_radix(hexadecimal, 16)
            .with_context(|| format!("{label} is not hexadecimal"))?,
    ))
}

/// Emits and drains every queued generic body-availability transition.
pub fn emit_body_activity_events(
    app: &tauri::AppHandle,
    runtime: &HostSimulationRuntime,
) -> Result<()> {
    for event in runtime.take_body_events() {
        app.emit(BODY_ACTIVITY_EVENT, event)
            .context("could not emit physical-body activity")?;
    }
    Ok(())
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
                terrain: TerrainCollisionSurface { cells: Vec::new() },
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
    fn explicit_registration_accepts_arbitrary_geometry_without_profiles() {
        let first = PhysicalBodyDefinitionRequest {
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
        }
        .resolve()
        .unwrap();
        let second = PhysicalBodyDefinitionRequest {
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
        }
        .resolve()
        .unwrap();

        assert_ne!(first, second);
        assert!(
            matches!(first, PhysicalBodyDefinition::FreeSphere { sphere, .. }
            if sphere.center == Vector3::new(0.1, -0.2, 0.3) && sphere.radius == 0.27)
        );
        assert!(
            matches!(second, PhysicalBodyDefinition::FreeSphere { sphere, .. }
            if sphere.center == Vector3::new(-0.4, 0.5, 0.6) && sphere.radius == 0.73)
        );
    }

    #[test]
    fn explicit_registration_rejects_a_third_grounded_sphere_without_truncation() {
        let error = PhysicalBodyDefinitionRequest {
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
                    step_up_height: 0.6,
                    step_down_height: 1.5,
                    edge_protection: EdgeProtectionRequest::Creature,
                    maximum_substep_distance: 0.25,
                    maximum_substeps: 8,
                    maximum_contact_passes: 4,
                    separation_epsilon: 0.001,
                },
            },
        }
        .resolve()
        .unwrap_err();

        assert!(error.to_string().contains("one or two spheres"));
    }

    #[test]
    fn explicit_registration_rejects_response_shape_mismatch() {
        let error = PhysicalBodyDefinitionRequest {
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
        }
        .resolve()
        .unwrap_err();

        assert!(error.to_string().contains("upper constraint"));
    }

    #[test]
    fn scene_replacement_and_body_availability_commit_under_one_lock() {
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
            .attach_physical_body(body_id, definition, None)
            .unwrap();
        assert!(matches!(
            service
                .state
                .lock()
                .unwrap()
                .bodies
                .body(body_id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .activity,
            PhysicalBodyActivity::AwaitingCoverage(_)
        ));

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
        assert_eq!(
            state
                .bodies
                .body(body_id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .activity,
            PhysicalBodyActivity::Active
        );
        drop(state);

        service
            .replace_interest(SimulationInterestRequest {
                session,
                revision: 2,
                landblock_ids: Vec::new(),
            })
            .unwrap();
        assert!(matches!(
            service
                .state
                .lock()
                .unwrap()
                .bodies
                .body(body_id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .activity,
            PhysicalBodyActivity::AwaitingCoverage(_)
        ));
    }
}
