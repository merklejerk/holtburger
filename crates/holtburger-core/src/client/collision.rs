//! Client-owned collision products and local-player body preparation.
//!
//! The client has one authoritative [`WorldState`](holtburger_world::WorldState), but static
//! collision is a content product that may take substantially longer to decode than a network
//! turn.  This module keeps those concerns separate: a coordinator stages a complete immutable
//! [`CollisionScene`](holtburger_world::CollisionScene) and a validated local-player physical
//! definition in independent jobs off the simulation clock. Static publication is body-neutral;
//! body completion is joined with live authoritative placement only on the simulation thread.

use std::sync::Arc;
use std::time::Instant;

use crate::{
    SimulationSceneBatchCompletion, SimulationSceneInterest, SimulationSceneOwnerOutcome,
    SimulationSceneOwnerRequest, SimulationSceneRequest, SimulationSceneResidency,
    SimulationSceneSnapshot,
};
use anyhow::{Context, Result, anyhow};
use holtburger_common::Guid;
#[cfg(test)]
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    PropertyDataId, PropertyFloat, WeenieType, WorldObjectPropertyAccessors as _,
};
use holtburger_content::{ContentRepository, LandblockCollisionAsset};
use holtburger_world::{
    DynamicPhysicalBodyDefinition, EffectiveEntityPhysicsState, EntityAppearance,
    PhysicalCollisionFilter, SpatialBodyId, WorldEvent, WorldState,
};
use thiserror::Error;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

/// One landblock of collision coverage on either side of the authoritative owner.
pub const CLIENT_COLLISION_OWNER_RADIUS: i8 = 1;

/// Exact authoritative player identity used to guard asynchronous completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientPlayerIdentity {
    /// Server-assigned local-player object identity.
    pub guid: Guid,
    /// Server instance sequence guarding reuse of the object identity.
    pub instance_sequence: u16,
}

/// Reusable local-player facts captured before content preparation leaves the simulation thread.
#[derive(Debug, Clone, PartialEq)]
pub struct ClientPlayerBodyFacts {
    /// Server-assigned local-player identity.
    pub guid: Guid,
    /// Server instance sequence captured with the definition facts.
    pub instance_sequence: u16,
    /// Weenie class identity used for content preparation.
    pub wcid: u32,
    /// Lossless appearance facts needed by dynamic definition preparation.
    pub appearance: EntityAppearance,
    /// Effective semantic physics flags controlling solver participation.
    pub physics: EffectiveEntityPhysicsState,
    /// Setup resource defining physical geometry.
    pub setup_did: u32,
    /// Authored object scale applied to prepared geometry.
    pub object_scale: f32,
    /// Optional authored surface friction.
    pub friction: Option<f32>,
    /// Optional authored elasticity.
    pub elasticity: Option<f32>,
}

impl ClientPlayerBodyFacts {
    /// Body-definition equality intentionally ignores live pose and kinematics.  A server motion
    /// update must not restart a DAT preparation job; a setup/appearance/physics replacement must.
    fn definition_eq(&self, other: &Self) -> bool {
        self.guid == other.guid
            && self.instance_sequence == other.instance_sequence
            && self.wcid == other.wcid
            && self.appearance == other.appearance
            && self.physics == other.physics
            && self.setup_did == other.setup_did
            && self.object_scale.to_bits() == other.object_scale.to_bits()
            && option_f32_eq(self.friction, other.friction)
            && option_f32_eq(self.elasticity, other.elasticity)
    }
}

fn option_f32_eq(left: Option<f32>, right: Option<f32>) -> bool {
    left.map(f32::to_bits) == right.map(f32::to_bits)
}

/// Rejections reached before a selected player can request content-backed body preparation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ClientPlayerBodyFactsError {
    #[error("local player entity is not hydrated")]
    MissingEntity,
    #[error("local player has no WCID")]
    MissingWcid,
    #[error("local player has no setup DID")]
    MissingSetup,
}

/// Extracts the complete body-preparation facts from the authoritative player entity.
pub fn client_player_body_facts(
    world: &WorldState,
) -> std::result::Result<ClientPlayerBodyFacts, ClientPlayerBodyFactsError> {
    let entity = world
        .player_entity()
        .ok_or(ClientPlayerBodyFactsError::MissingEntity)?;
    let wcid = entity.wcid.ok_or(ClientPlayerBodyFactsError::MissingWcid)?;
    let setup_did = entity
        .properties
        .get_data_prop(PropertyDataId::Setup)
        .map(|did| did.0)
        .ok_or(ClientPlayerBodyFactsError::MissingSetup)?;

    Ok(ClientPlayerBodyFacts {
        guid: entity.guid,
        instance_sequence: entity.instance_sequence(),
        wcid,
        appearance: entity.appearance.clone(),
        physics: entity.physics,
        setup_did,
        object_scale: entity
            .properties
            .get_float_prop(PropertyFloat::DefaultScale)
            .map(|value| value as f32)
            .unwrap_or(1.0),
        friction: property_f32(&entity.properties, PropertyFloat::Friction),
        elasticity: property_f32(&entity.properties, PropertyFloat::Elasticity),
    })
}

fn property_f32(
    properties: &holtburger_common::properties::WorldObjectProperties,
    property: PropertyFloat,
) -> Option<f32> {
    properties
        .get_float_prop(property)
        .map(|value| value as f32)
}

/// Injectable synchronous content source used by the asynchronous coordinator.
pub trait ClientCollisionSource: Send + Sync + 'static {
    /// Loads one normalized landblock owner, or `None` when no CellLandblock exists.
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>>;

    /// Prepares a complete local-player physical definition from captured entity facts.
    fn prepare_local_player(
        &self,
        facts: ClientPlayerBodyFacts,
    ) -> Result<DynamicPhysicalBodyDefinition>;
}

/// Production source over the shared content service and repository.
#[derive(Clone)]
pub struct ContentClientCollisionSource {
    service: Arc<crate::ContentAssetService>,
    content: Arc<ContentRepository>,
}

impl ContentClientCollisionSource {
    pub fn new(service: Arc<crate::ContentAssetService>, content: Arc<ContentRepository>) -> Self {
        Self { service, content }
    }
}

impl ClientCollisionSource for ContentClientCollisionSource {
    fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
        self.service.load_collision(landblock_id)
    }

    fn prepare_local_player(
        &self,
        facts: ClientPlayerBodyFacts,
    ) -> Result<DynamicPhysicalBodyDefinition> {
        crate::prepare_dynamic_entity_physical_definition(
            crate::DynamicEntityPhysicalPreparationInput {
                wcid: facts.wcid,
                setup_did: facts.setup_did,
                appearance: facts.appearance,
                object_scale: facts.object_scale,
                friction: facts.friction,
                elasticity: facts.elasticity,
                physics: facts.physics,
                // The selected local player is a Creature in ACE's client object path.
                weenie_type: WeenieType::Creature,
            },
            &self.content,
        )
        .context("could not prepare local-player collision geometry")
    }
}

/// Readiness of local-player physical-definition preparation, independent from static residency.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientBodyReadiness {
    Waiting,
    Preparing {
        player: ClientPlayerIdentity,
        request: u64,
    },
    Ready {
        player: ClientPlayerIdentity,
    },
    Unavailable {
        player: ClientPlayerIdentity,
        cause: String,
    },
}

#[derive(Clone)]
struct ClientSpatialTarget {
    player: ClientPlayerIdentity,
    interest: SimulationSceneInterest,
    facts: ClientPlayerBodyFacts,
}

#[derive(Clone)]
struct ClientBodyTarget {
    player: ClientPlayerIdentity,
    facts: ClientPlayerBodyFacts,
}

struct ClientSceneCompletion {
    generation: u64,
    batch: SimulationSceneBatchCompletion,
}

struct ClientBodyCompletion {
    generation: u64,
    request: u64,
    target: ClientBodyTarget,
    result: std::result::Result<DynamicPhysicalBodyDefinition, String>,
}

enum ClientSpatialCompletion {
    Scene(ClientSceneCompletion),
    Body(Box<ClientBodyCompletion>),
}

/// Core-owned coordinator shared by desktop and TUI client compositions.
pub struct ClientCollisionCoordinator {
    source: Arc<dyn ClientCollisionSource>,
    completion_tx: UnboundedSender<ClientSpatialCompletion>,
    completion_rx: UnboundedReceiver<ClientSpatialCompletion>,
    scene_worker: Option<tokio::task::JoinHandle<()>>,
    body_worker: Option<tokio::task::JoinHandle<()>>,
    residency: SimulationSceneResidency,
    body_target: Option<ClientBodyTarget>,
    body_readiness: ClientBodyReadiness,
    next_body_request: u64,
    body_generation: u64,
    scene_generation: u64,
}

impl ClientCollisionCoordinator {
    pub fn new(source: Arc<dyn ClientCollisionSource>) -> Self {
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        Self {
            source,
            completion_tx,
            completion_rx,
            scene_worker: None,
            body_worker: None,
            residency: SimulationSceneResidency::default(),
            body_target: None,
            body_readiness: ClientBodyReadiness::Waiting,
            next_body_request: 0,
            body_generation: 0,
            scene_generation: 0,
        }
    }

    pub fn from_content(
        service: Arc<crate::ContentAssetService>,
        content: Arc<ContentRepository>,
    ) -> Self {
        Self::new(Arc::new(ContentClientCollisionSource::new(
            service, content,
        )))
    }

    pub fn body_readiness(&self) -> ClientBodyReadiness {
        self.body_readiness.clone()
    }

    pub fn snapshot(&self) -> Arc<SimulationSceneSnapshot> {
        self.residency.snapshot()
    }

    /// Independently refreshes scene interest and immutable local-player definition demand.
    pub fn observe(&mut self, world: &WorldState) {
        let Some(target) = Self::target_from_world(world) else {
            self.clear();
            return;
        };
        if let Some(request) = self.residency.request_interest(target.interest) {
            self.start_scene_loading(request);
        }
        let body_target = ClientBodyTarget {
            player: target.player,
            facts: target.facts,
        };
        let same_body = self.body_target.as_ref().is_some_and(|current| {
            current.player == body_target.player && current.facts.definition_eq(&body_target.facts)
        });
        if !same_body {
            self.start_body_loading(body_target);
        }
    }

    /// Publishes only scene and body completions that still name their exact current revisions.
    pub fn poll(&mut self, world: &mut WorldState, _now: Instant) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        while let Ok(completion) = self.completion_rx.try_recv() {
            match completion {
                ClientSpatialCompletion::Scene(completion) => {
                    if completion.generation != self.scene_generation {
                        continue;
                    }
                    self.scene_worker = None;
                    self.residency
                        .publish(completion.batch)
                        .expect("client scene loader produced an invalid complete batch");
                }
                ClientSpatialCompletion::Body(completion) => {
                    if completion.generation != self.body_generation
                        || !matches!(
                            self.body_readiness,
                            ClientBodyReadiness::Preparing { request, .. }
                                if request == completion.request
                        )
                        || self.body_target.as_ref().is_none_or(|target| {
                            target.player != completion.target.player
                                || !target.facts.definition_eq(&completion.target.facts)
                        })
                    {
                        continue;
                    }
                    self.body_worker = None;
                    let Some(current) = Self::target_from_world(world) else {
                        self.body_target = None;
                        self.body_readiness = ClientBodyReadiness::Waiting;
                        continue;
                    };
                    if current.player != completion.target.player
                        || !current.facts.definition_eq(&completion.target.facts)
                    {
                        self.body_target = None;
                        self.body_readiness = ClientBodyReadiness::Waiting;
                        continue;
                    }
                    let body_id = SpatialBodyId::LocalPlayer(completion.target.player.guid);
                    let physical = match completion.result {
                        Ok(physical) => physical,
                        Err(cause) => {
                            self.body_readiness = ClientBodyReadiness::Unavailable {
                                player: completion.target.player,
                                cause,
                            };
                            continue;
                        }
                    };
                    let Some(body) = world.scene.body(body_id) else {
                        self.body_readiness = ClientBodyReadiness::Waiting;
                        self.body_target = None;
                        continue;
                    };
                    if body.authoritative_pose.is_none() {
                        self.body_readiness = ClientBodyReadiness::Waiting;
                        continue;
                    }
                    // Physical membership and the projected pose form one atomic spatial fact.
                    // Authoritative entity position may already name a portal destination while
                    // the runtime body still holds its pre-transition pose.
                    let live_residency = body.pose.landblock_id;
                    let initial_cell =
                        residency_is_indoors(live_residency).then_some(live_residency);
                    let Some(_outcome) = world.scene.set_dynamic_physical_body(
                        body_id,
                        Some(physical),
                        PhysicalCollisionFilter::ALL,
                        initial_cell,
                    ) else {
                        self.body_readiness = ClientBodyReadiness::Waiting;
                        self.body_target = None;
                        continue;
                    };
                    self.body_readiness = ClientBodyReadiness::Ready {
                        player: completion.target.player,
                    };
                    events.push(WorldEvent::RuntimeBodyChanged { body_id });
                }
            }
        }
        events
    }

    /// Retires in-flight work after a teleport/reset while retaining installed static topology.
    pub fn invalidate(&mut self) {
        self.scene_generation = self.scene_generation.saturating_add(1);
        self.body_generation = self.body_generation.saturating_add(1);
        self.scene_worker.take().inspect(|worker| worker.abort());
        self.body_worker.take().inspect(|worker| worker.abort());
        self.residency.retire_pending();
        self.body_target = None;
        self.body_readiness = ClientBodyReadiness::Waiting;
    }

    pub fn clear(&mut self) {
        if self.body_target.is_some()
            || self.residency.snapshot().revision != 0
            || !matches!(self.body_readiness, ClientBodyReadiness::Waiting)
        {
            self.invalidate();
            self.residency = SimulationSceneResidency::default();
        }
    }

    fn target_from_world(world: &WorldState) -> Option<ClientSpatialTarget> {
        let guid = world.player.guid;
        if guid == Guid::NULL {
            return None;
        }
        let entity = world.player_entity()?;
        let position = entity.position;
        let facts = client_player_body_facts(world).ok()?;
        let interest = SimulationSceneInterest::prefetch_neighborhood(
            position,
            CLIENT_COLLISION_OWNER_RADIUS,
        )?;
        Some(ClientSpatialTarget {
            player: ClientPlayerIdentity {
                guid,
                instance_sequence: facts.instance_sequence,
            },
            interest,
            facts,
        })
    }

    fn start_scene_loading(&mut self, request: SimulationSceneRequest) {
        self.scene_worker.take().inspect(|worker| worker.abort());
        self.scene_generation = self.scene_generation.saturating_add(1);
        let generation = self.scene_generation;
        let source = Arc::clone(&self.source);
        let completion_tx = self.completion_tx.clone();
        self.scene_worker = Some(tokio::spawn(async move {
            let request_for_worker = request.clone();
            let outcomes = tokio::task::spawn_blocking(move || {
                resolve_scene_request(source.as_ref(), &request_for_worker)
            })
            .await
            .unwrap_or_else(|error| {
                request
                    .owners
                    .iter()
                    .map(|operation| SimulationSceneOwnerOutcome::Failed {
                        owner: operation.owner(),
                        cause: format!("client collision worker failed: {error}"),
                    })
                    .collect()
            });
            let _ = completion_tx.send(ClientSpatialCompletion::Scene(ClientSceneCompletion {
                generation,
                batch: SimulationSceneBatchCompletion {
                    content_source_generation: request.content_source_generation,
                    request_revision: request.request_revision,
                    outcomes,
                },
            }));
        }));
    }

    fn start_body_loading(&mut self, target: ClientBodyTarget) {
        self.body_worker.take().inspect(|worker| worker.abort());
        self.body_generation = self.body_generation.saturating_add(1);
        self.next_body_request = self.next_body_request.saturating_add(1);
        let generation = self.body_generation;
        let request = self.next_body_request;
        let source = Arc::clone(&self.source);
        let completion_tx = self.completion_tx.clone();
        let completion_target = target.clone();
        let worker_target = target.clone();
        self.body_target = Some(target.clone());
        self.body_readiness = ClientBodyReadiness::Preparing {
            player: target.player,
            request,
        };
        self.body_worker = Some(tokio::spawn(async move {
            let result = tokio::task::spawn_blocking(move || {
                source
                    .prepare_local_player(worker_target.facts)
                    .context("could not prepare local-player physical body")
            })
            .await
            .map_err(|error| anyhow!("client body worker failed: {error}"))
            .and_then(|result| result)
            .map_err(|error| format!("{error:#}"));
            let _ = completion_tx.send(ClientSpatialCompletion::Body(Box::new(
                ClientBodyCompletion {
                    generation,
                    request,
                    target: completion_target,
                    result,
                },
            )));
        }));
    }
}

fn resolve_scene_request(
    source: &dyn ClientCollisionSource,
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

fn residency_is_indoors(residency: Guid) -> bool {
    residency.0 & 0xffff >= 0x0100
}

impl Drop for ClientCollisionCoordinator {
    fn drop(&mut self) {
        if let Some(worker) = self.scene_worker.take() {
            worker.abort();
        }
        if let Some(worker) = self.body_worker.take() {
            worker.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::WorldObjectPropertyAccessorsMut;
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_content::{LandblockCollisionAsset, TerrainCollisionSurface};
    use holtburger_world::{
        DynamicBodyCollisionDefinition, DynamicPhysicalBodyDefinition, EntityCollisionReportPolicy,
        EntityDynamicCollisionPolicy, EntityPhysicsScheduling, PhysicalBodyDefinition,
        PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction, PhysicalRestitution,
        PhysicalSphereSet, PhysicalSurfaceMotion, SpatialBodyId,
    };
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::{Receiver, SyncSender};

    #[derive(Default)]
    struct FakeSource {
        loaded: Mutex<Vec<u32>>,
        missing: Mutex<Vec<u32>>,
        prepared: AtomicUsize,
        body_gate: Mutex<Option<(SyncSender<()>, Receiver<()>)>>,
    }

    impl ClientCollisionSource for FakeSource {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            self.loaded.lock().unwrap().push(landblock_id);
            if self.missing.lock().unwrap().contains(&landblock_id) {
                return Ok(None);
            }
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: Default::default(),
            }))
        }

        fn prepare_local_player(
            &self,
            _facts: ClientPlayerBodyFacts,
        ) -> Result<DynamicPhysicalBodyDefinition> {
            self.prepared.fetch_add(1, Ordering::SeqCst);
            if let Some((started, release)) = self.body_gate.lock().unwrap().as_ref() {
                started.send(()).unwrap();
                release.recv().unwrap();
            }
            let spheres = PhysicalSphereSet::new(
                holtburger_common::Sphere {
                    center: Vector3::new(0.0, 0.0, 0.5),
                    radius: 0.5,
                },
                None,
            )?;
            let movement = PhysicalBodyDefinition::grounded(
                spheres,
                holtburger_world::GroundedConfig {
                    gravity: -9.8,
                    walkable_normal_z: holtburger_world::RETAIL_WALKABLE_NORMAL_Z,
                    landing_normal_z: holtburger_world::RETAIL_LANDING_NORMAL_Z,
                    airborne_step_down_height: holtburger_world::RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
                    step_up_height: 0.6,
                    step_down_height: 1.5,
                    edge_protection: holtburger_world::EdgeProtection::Creature,
                    maximum_substep_distance: 0.24,
                    maximum_substeps: 32,
                    maximum_contact_passes: 8,
                    separation_epsilon: 0.0005,
                },
            )?;
            Ok(DynamicPhysicalBodyDefinition {
                movement,
                response_policy: PhysicalBodyResponsePolicy {
                    restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
                    friction: PhysicalFriction::DEFAULT,
                    surface_motion: PhysicalSurfaceMotion::Stable,
                    align_path: false,
                },
                entity_collision: DynamicBodyCollisionDefinition {
                    target_geometry: holtburger_world::PreparedEntityTargetGeometry {
                        physics_bsp_parts: Vec::new(),
                        fallback_setup_did: 0,
                        fallback_shapes: Vec::new(),
                        fallback_scale: holtburger_content::ColliderScale::uniform(1.0).unwrap(),
                    },
                    scheduling: EntityPhysicsScheduling::Eligible,
                    dynamic_collision: EntityDynamicCollisionPolicy {
                        target: holtburger_world::EntityCollisionParticipation::Solid,
                        mover_accepts_response: true,
                        accepts_peer_reports: true,
                        missile: false,
                        path_clipped: false,
                    },
                    reporting: EntityCollisionReportPolicy {
                        enabled: false,
                        as_environment: false,
                    },
                    uses_physics_bsp: false,
                    weenie_type: WeenieType::Creature,
                    elasticity: PhysicalElasticity::DEFAULT,
                    default_animation_available: false,
                    default_script_available: false,
                },
            })
        }
    }

    fn position(owner: u32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(owner),
            coords: Vector3::new(96.0, 96.0, 0.0),
            rotation: Quaternion::identity(),
        }
    }

    #[test]
    fn collision_interest_is_bounded_and_normalized_at_edges() {
        let interest = SimulationSceneInterest::prefetch_neighborhood(
            position(0x0000_0001),
            CLIENT_COLLISION_OWNER_RADIUS,
        )
        .unwrap();
        assert_eq!(
            interest.owners(),
            &[
                Guid(0x0000_ffff),
                Guid(0x0001_ffff),
                Guid(0x0100_ffff),
                Guid(0x0101_ffff),
            ]
        );

        let center = SimulationSceneInterest::prefetch_neighborhood(
            position(0x1234_0100),
            CLIENT_COLLISION_OWNER_RADIUS,
        )
        .unwrap();
        assert_eq!(center.owners().len(), 9);
        assert!(center.owners().contains(&Guid(0x1233_ffff)));
        assert!(center.owners().contains(&Guid(0x1235_ffff)));
    }

    fn facts(world: &mut WorldState, guid: Guid) {
        let entity = world
            .entities
            .get_mut(guid)
            .expect("seeded player should exist");
        entity.wcid = Some(0x0100_0001);
        entity
            .properties
            .set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
        entity
            .properties
            .set_float_prop(PropertyFloat::DefaultScale, 1.0);
    }

    async fn wait_for_readiness(
        coordinator: &mut ClientCollisionCoordinator,
        world: &mut WorldState,
        predicate: impl Fn(&ClientBodyReadiness) -> bool,
    ) {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                let _ = coordinator.poll(world, Instant::now());
                if predicate(&coordinator.body_readiness()) {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("client collision worker did not publish readiness within one second");
    }

    async fn wait_for_scene_revision(
        coordinator: &mut ClientCollisionCoordinator,
        world: &mut WorldState,
        revision: u64,
    ) {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                let _ = coordinator.poll(world, Instant::now());
                if coordinator.snapshot().revision == revision {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("client collision worker did not publish the expected scene revision");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn exact_cell_motion_schedules_no_work_and_seam_loading_retains_the_snapshot() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        world.seed_local_player_entity(guid, "Player", position(0x1234_0001));
        facts(&mut world, guid);
        let source = Arc::new(FakeSource::default());
        let mut coordinator = ClientCollisionCoordinator::new(source.clone());
        coordinator.observe(&world);
        wait_for_readiness(&mut coordinator, &mut world, |readiness| {
            matches!(readiness, ClientBodyReadiness::Ready { .. })
        })
        .await;
        wait_for_scene_revision(&mut coordinator, &mut world, 1).await;
        assert_eq!(source.loaded.lock().unwrap().len(), 9);
        assert_eq!(source.prepared.load(Ordering::SeqCst), 1);

        world.entities.get_mut(guid).unwrap().position.landblock_id = Guid(0x1234_0002);
        coordinator.observe(&world);
        let same_owner = coordinator.snapshot();
        assert_eq!(same_owner.revision, 1);
        assert_eq!(source.loaded.lock().unwrap().len(), 9);
        assert_eq!(source.prepared.load(Ordering::SeqCst), 1);

        world.entities.get_mut(guid).unwrap().position.landblock_id = Guid(0x1334_0001);
        coordinator.observe(&world);
        assert!(Arc::ptr_eq(&same_owner, &coordinator.snapshot()));
        wait_for_scene_revision(&mut coordinator, &mut world, 2).await;
        assert_eq!(source.loaded.lock().unwrap().len(), 12);
        assert_eq!(source.prepared.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn delayed_body_completion_installs_against_the_live_pose() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        let requested = position(0x1234_0001);
        world.seed_local_player_entity(guid, "Player", requested);
        facts(&mut world, guid);
        let (started_tx, started_rx) = std::sync::mpsc::sync_channel(0);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
        let source = Arc::new(FakeSource {
            body_gate: Mutex::new(Some((started_tx, release_rx))),
            ..FakeSource::default()
        });
        let mut coordinator = ClientCollisionCoordinator::new(source);
        coordinator.observe(&world);
        started_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("body preparation did not reach the test gate");

        let live = position(0x1234_0002);
        world.entities.get_mut(guid).unwrap().position = live;
        assert!(!world.set_local_player_runtime_pose(live).is_empty());
        release_tx.send(()).unwrap();
        wait_for_readiness(&mut coordinator, &mut world, |readiness| {
            matches!(readiness, ClientBodyReadiness::Ready { .. })
        })
        .await;

        let body = world
            .scene
            .body(SpatialBodyId::LocalPlayer(guid))
            .expect("live local-player body must remain registered");
        assert_eq!(body.pose, live);
        assert!(body.physical.is_some());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runtime_env_cell_change_projects_membership_for_the_new_resident_cell() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        let initial = position(0x1234_0101);
        world.seed_local_player_entity(guid, "Player", initial);
        facts(&mut world, guid);
        let mut coordinator = ClientCollisionCoordinator::new(Arc::new(FakeSource::default()));
        coordinator.observe(&world);
        wait_for_readiness(&mut coordinator, &mut world, |readiness| {
            matches!(readiness, ClientBodyReadiness::Ready { .. })
        })
        .await;

        let destination = position(0x1234_0102);
        assert!(!world.set_local_player_runtime_pose(destination).is_empty());
        let projected =
            crate::client::dynamic_entity_view::project_client_dynamic_entity(&world, guid)
                .unwrap();
        let crate::DynamicEntityPlacementView::World {
            pose,
            spatial_membership,
            ..
        } = projected.placement
        else {
            panic!("local player must retain world placement")
        };
        assert_eq!(pose, destination);
        assert!(!spatial_membership.reaches_outdoors);
        assert_eq!(
            spatial_membership.reached_env_cell_ids,
            [destination.landblock_id]
        );
        let body = world.scene.body(SpatialBodyId::LocalPlayer(guid)).unwrap();
        assert_eq!(body.authoritative_pose, Some(initial));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stale_completion_is_discarded_after_residency_replacement() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        world.seed_local_player_entity(guid, "Player", position(0x1234_0001));
        facts(&mut world, guid);
        let source = Arc::new(FakeSource::default());
        let mut coordinator = ClientCollisionCoordinator::new(source);
        coordinator.observe(&world);

        world.entities.get_mut(guid).unwrap().position.landblock_id = Guid(0x1235_0001);
        coordinator.observe(&world);
        wait_for_readiness(&mut coordinator, &mut world, |readiness| {
            matches!(readiness, ClientBodyReadiness::Ready { player } if player.guid == guid)
        })
        .await;
        assert!(
            world
                .scene
                .body(SpatialBodyId::LocalPlayer(guid))
                .unwrap()
                .physical
                .is_some()
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn missing_collision_is_explicit_unavailable_state() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        world.seed_local_player_entity(guid, "Player", position(0x1234_0001));
        facts(&mut world, guid);
        let source = Arc::new(FakeSource::default());
        source.missing.lock().unwrap().push(0x1233_ffff);
        let mut coordinator = ClientCollisionCoordinator::new(source);
        coordinator.observe(&world);
        wait_for_readiness(&mut coordinator, &mut world, |readiness| {
            matches!(readiness, ClientBodyReadiness::Ready { .. })
        })
        .await;
        let snapshot = coordinator.snapshot();
        assert!(matches!(
            snapshot.availability.get(&Guid(0x1233_ffff)),
            Some(crate::SimulationSceneOwnerAvailability::Absent)
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn physical_membership_is_installed_from_the_matching_runtime_pose() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        let runtime_pose = position(0x7c65_0032);
        let authoritative_destination = position(0x01d9_0100);
        world.seed_local_player_entity(guid, "Player", runtime_pose);
        facts(&mut world, guid);
        let _ = world.set_local_player_runtime_pose(runtime_pose);
        let _ = world.set_player_position(authoritative_destination);
        assert_eq!(world.local_player_runtime_pose(), Some(runtime_pose));

        let source = Arc::new(FakeSource::default());
        let mut coordinator = ClientCollisionCoordinator::new(source);
        coordinator.observe(&world);
        wait_for_readiness(&mut coordinator, &mut world, |readiness| {
            matches!(readiness, ClientBodyReadiness::Ready { .. })
        })
        .await;

        let body = world
            .scene
            .body(SpatialBodyId::LocalPlayer(guid))
            .expect("seeded player should retain a runtime body");
        assert_eq!(body.pose, runtime_pose);
        assert_eq!(
            body.spatial_membership(),
            holtburger_world::SpatialMembership::outdoor()
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn invalidation_discards_a_completion_after_disconnect_or_teleport() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        world.seed_local_player_entity(guid, "Player", position(0x1234_0001));
        facts(&mut world, guid);
        let source = Arc::new(FakeSource::default());
        let mut coordinator = ClientCollisionCoordinator::new(source);
        coordinator.observe(&world);
        coordinator.invalidate();
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        let events = coordinator.poll(&mut world, Instant::now());

        assert!(events.is_empty());
        assert_eq!(coordinator.body_readiness(), ClientBodyReadiness::Waiting);
        assert_eq!(coordinator.snapshot().revision, 0);
        assert!(
            world
                .scene
                .body(SpatialBodyId::LocalPlayer(guid))
                .unwrap()
                .physical
                .is_none()
        );
    }

    #[test]
    fn player_body_facts_reject_unhydrated_identity_without_substitution() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        world.seed_local_player_entity(guid, "Player", position(0x1234_0001));
        assert_eq!(
            client_player_body_facts(&world),
            Err(ClientPlayerBodyFactsError::MissingWcid)
        );

        facts(&mut world, guid);
        world
            .entities
            .get_mut(guid)
            .unwrap()
            .properties
            .dids
            .0
            .remove(&PropertyDataId::Setup);
        assert_eq!(
            client_player_body_facts(&world),
            Err(ClientPlayerBodyFactsError::MissingSetup)
        );
    }
}
