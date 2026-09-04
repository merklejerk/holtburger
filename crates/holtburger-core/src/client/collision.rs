//! Client-owned collision products and local-player body preparation.
//!
//! The client has one authoritative [`WorldState`](holtburger_world::WorldState), but static
//! collision is a content product that may take substantially longer to decode than a network
//! turn.  This module keeps those concerns separate: a coordinator stages a complete immutable
//! [`CollisionScene`](holtburger_world::CollisionScene) and validated authoritative-entity
//! physical definitions in independent jobs off the simulation clock. Static publication is
//! body-neutral; body completion is joined with live authoritative placement only on the
//! simulation thread.

use std::collections::{BTreeMap, BTreeSet};
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
    PropertyDataId, PropertyFloat, WorldObjectPropertyAccessors as _,
};
use holtburger_content::{ContentRepository, LandblockCollisionAsset};
use holtburger_world::{
    DynamicPhysicalBodyConfiguration, DynamicPhysicalBodyDefinition, EffectiveEntityPhysicsState,
    EntityAppearance, EntityCollisionParticipation, EntityIntegrationEligibility,
    LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand, PhysicalCollisionFilter,
    SpatialBodyId, WorldEvent, WorldState,
};
use thiserror::Error;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

/// One landblock of collision coverage on either side of the authoritative owner.
pub const CLIENT_COLLISION_OWNER_RADIUS: i8 = 1;

/// Keep acquired collision owners for one extra landblock beyond the nominal radius.
const CLIENT_COLLISION_EXIT_MARGIN: i8 = 1;

/// Exact authoritative player identity used to guard asynchronous completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientPlayerIdentity {
    /// Server-assigned local-player object identity.
    pub guid: Guid,
    /// Server instance sequence guarding reuse of the object identity.
    pub instance_sequence: u16,
}

/// Reusable entity facts captured before content preparation leaves the simulation thread.
#[derive(Debug, Clone, PartialEq)]
pub struct ClientEntityBodyFacts {
    /// Server-assigned entity identity.
    pub guid: Guid,
    /// Server instance sequence captured with the definition facts.
    pub instance_sequence: u16,
    /// Weenie class identity used for content preparation.
    pub wcid: u32,
    /// Lossless appearance facts needed by dynamic definition preparation.
    pub appearance: EntityAppearance,
    /// Effective semantic physics flags consumed when deriving local physical demand.
    pub physics: EffectiveEntityPhysicsState,
    /// Setup resource defining physical geometry.
    pub setup_did: u32,
    /// Current world-owned scale joined only when the prepared unit body is installed.
    pub object_scale: f32,
    /// Optional authored surface friction.
    pub friction: Option<f32>,
    /// Optional authored elasticity.
    pub elasticity: Option<f32>,
}

impl ClientEntityBodyFacts {
    /// Exact completion equality intentionally ignores live pose and kinematics.
    ///
    /// Physics remains part of completion currentness even though a compatible state-only change
    /// can rebuild configuration from already prepared content without restarting a DAT job.
    fn definition_eq(&self, other: &Self) -> bool {
        self.preparation_eq(other) && self.physics == other.physics
    }

    /// Equality of content-backed facts, excluding live semantic physics state.
    fn preparation_eq(&self, other: &Self) -> bool {
        self.guid == other.guid
            && self.instance_sequence == other.instance_sequence
            && self.wcid == other.wcid
            && self.appearance == other.appearance
            && self.setup_did == other.setup_did
            && option_f32_eq(self.friction, other.friction)
            && option_f32_eq(self.elasticity, other.elasticity)
    }
}

fn option_f32_eq(left: Option<f32>, right: Option<f32>) -> bool {
    left.map(f32::to_bits) == right.map(f32::to_bits)
}

/// Rejections reached before an entity can request content-backed body preparation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ClientEntityBodyFactsError {
    #[error("entity is not hydrated")]
    MissingEntity,
    #[error("entity has no WCID")]
    MissingWcid,
    #[error("entity has no setup DID")]
    MissingSetup,
}

/// Extracts complete body-preparation facts from one authoritative entity.
pub fn client_entity_body_facts(
    world: &WorldState,
    guid: Guid,
) -> std::result::Result<ClientEntityBodyFacts, ClientEntityBodyFactsError> {
    let entity = world
        .entities
        .get(guid)
        .ok_or(ClientEntityBodyFactsError::MissingEntity)?;
    let wcid = entity.wcid.ok_or(ClientEntityBodyFactsError::MissingWcid)?;
    let setup_did = entity
        .properties
        .get_data_prop(PropertyDataId::Setup)
        .map(|did| did.0)
        .ok_or(ClientEntityBodyFactsError::MissingSetup)?;

    Ok(ClientEntityBodyFacts {
        guid: entity.guid,
        instance_sequence: entity.instance_sequence(),
        wcid,
        appearance: entity.appearance.clone(),
        physics: entity.physics.effective(),
        setup_did,
        object_scale: entity.scale.effective(),
        friction: property_f32(&entity.properties, PropertyFloat::Friction),
        elasticity: property_f32(&entity.properties, PropertyFloat::Elasticity),
    })
}

/// Extracts body facts for the selected player without duplicating entity hydration rules.
pub fn client_player_body_facts(
    world: &WorldState,
) -> std::result::Result<ClientEntityBodyFacts, ClientEntityBodyFactsError> {
    client_entity_body_facts(world, world.player.guid)
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

    /// Prepares one complete physical definition from captured entity facts.
    fn prepare_body(&self, facts: ClientEntityBodyFacts) -> Result<DynamicPhysicalBodyDefinition>;
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

    fn prepare_body(&self, facts: ClientEntityBodyFacts) -> Result<DynamicPhysicalBodyDefinition> {
        crate::prepare_dynamic_entity_physical_definition(
            crate::DynamicEntityPhysicalPreparationInput {
                wcid: facts.wcid,
                setup_did: facts.setup_did,
                appearance: facts.appearance,
                friction: facts.friction,
                elasticity: facts.elasticity,
                physics: facts.physics,
            },
            &self.content,
        )
        .context("could not prepare dynamic-entity collision geometry")
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
    facts: ClientEntityBodyFacts,
}

#[derive(Clone)]
struct ClientBodyTarget {
    player: ClientPlayerIdentity,
    facts: ClientEntityBodyFacts,
    demand: LocalPhysicalDemand,
}

/// Immutable remote-body demand guarded by server identity and complete definition facts.
#[derive(Debug, Clone, PartialEq)]
struct ClientRemoteBodyTarget {
    body_id: SpatialBodyId,
    facts: ClientEntityBodyFacts,
    demand: LocalPhysicalDemand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClientRemoteBodyStatus {
    Pending,
    Preparing,
    Prepared,
    Unavailable,
}

/// One remote body's definition demand and mutually exclusive preparation state.
struct ClientRemoteBodyDemand {
    facts: ClientEntityBodyFacts,
    demand: LocalPhysicalDemand,
    status: ClientRemoteBodyStatus,
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

struct ClientRemoteBodyCompletion {
    generation: u64,
    targets: Vec<(
        ClientRemoteBodyTarget,
        std::result::Result<DynamicPhysicalBodyDefinition, String>,
    )>,
}

enum ClientSpatialCompletion {
    Scene(ClientSceneCompletion),
    Body(Box<ClientBodyCompletion>),
    RemoteBodies(ClientRemoteBodyCompletion),
}

/// Core-owned coordinator shared by desktop and TUI client compositions.
pub struct ClientCollisionCoordinator {
    source: Arc<dyn ClientCollisionSource>,
    completion_tx: UnboundedSender<ClientSpatialCompletion>,
    completion_rx: UnboundedReceiver<ClientSpatialCompletion>,
    scene_worker: Option<tokio::task::JoinHandle<()>>,
    body_worker: Option<tokio::task::JoinHandle<()>>,
    remote_body_worker: Option<tokio::task::JoinHandle<()>>,
    residency: SimulationSceneResidency,
    body_target: Option<ClientBodyTarget>,
    body_readiness: ClientBodyReadiness,
    next_body_request: u64,
    body_generation: u64,
    remote_body_generation: u64,
    remote_bodies: BTreeMap<SpatialBodyId, ClientRemoteBodyDemand>,
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
            remote_body_worker: None,
            residency: SimulationSceneResidency::default(),
            body_target: None,
            body_readiness: ClientBodyReadiness::Waiting,
            next_body_request: 0,
            body_generation: 0,
            remote_body_generation: 0,
            remote_bodies: BTreeMap::new(),
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

    /// Whether the installed immutable scene contains the exact authoritative destination.
    pub fn destination_scene_ready(&self, residency: Guid) -> bool {
        let snapshot = self.residency.snapshot();
        if residency_is_indoors(residency) {
            snapshot.scene.contains_env_cell(residency)
        } else {
            snapshot.scene.contains_landblock(residency)
        }
    }

    /// Independently refreshes scene interest and immutable authoritative-body definition demand.
    pub fn observe(&mut self, world: &mut WorldState) -> Vec<WorldEvent> {
        let mut events = self.observe_remote_bodies(world);
        let Some(target) = Self::target_from_world(world, self.residency.desired_interest()) else {
            self.clear();
            return events;
        };
        if let Some(request) = self.residency.request_interest(target.interest) {
            self.start_scene_loading(request);
        }
        let body_target = ClientBodyTarget {
            player: target.player,
            demand: local_player_physical_demand(target.facts.physics),
            facts: target.facts,
        };
        let same_body = self.body_target.as_ref().is_some_and(|current| {
            current.player == body_target.player
                && current.facts.definition_eq(&body_target.facts)
                && current.demand == body_target.demand
        });
        if !same_body {
            let can_reuse = self.body_target.as_ref().is_some_and(|current| {
                current.player == body_target.player
                    && current.facts.preparation_eq(&body_target.facts)
            });
            if can_reuse && reconfigure_local_player_body(world, &body_target, &mut events) {
                self.body_worker.take().inspect(|worker| worker.abort());
                self.body_generation = self.body_generation.saturating_add(1);
                self.body_readiness = ClientBodyReadiness::Ready {
                    player: body_target.player,
                };
                self.body_target = Some(body_target);
            } else {
                remove_local_player_physical_body(world, body_target.player, &mut events);
                self.start_body_loading(body_target);
            }
        }
        events
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
                                || target.demand != completion.target.demand
                        })
                    {
                        continue;
                    }
                    self.body_worker = None;
                    let Some(current) =
                        Self::target_from_world(world, self.residency.desired_interest())
                    else {
                        self.body_target = None;
                        self.body_readiness = ClientBodyReadiness::Waiting;
                        continue;
                    };
                    if current.player != completion.target.player
                        || !current.facts.definition_eq(&completion.target.facts)
                        || local_player_physical_demand(current.facts.physics)
                            != completion.target.demand
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
                        Some(
                            DynamicPhysicalBodyConfiguration::with_object_scale(
                                physical,
                                completion.target.demand,
                                current.facts.object_scale,
                            )
                            .expect("local-player completion carries integration demand"),
                        ),
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
                ClientSpatialCompletion::RemoteBodies(completion) => {
                    if completion.generation != self.remote_body_generation {
                        continue;
                    }
                    self.remote_body_worker = None;
                    for (target, result) in completion.targets {
                        if self
                            .remote_bodies
                            .get(&target.body_id)
                            .is_none_or(|demand| {
                                !demand.facts.definition_eq(&target.facts)
                                    || demand.demand != target.demand
                            })
                        {
                            continue;
                        }
                        let Some(guid) = target.body_id.authoritative_guid() else {
                            continue;
                        };
                        let Ok(current) = client_entity_body_facts(world, guid) else {
                            continue;
                        };
                        if !current.definition_eq(&target.facts) {
                            continue;
                        }
                        let physical = match result {
                            Ok(physical) => physical,
                            Err(cause) => {
                                log::warn!(
                                    "client remote body {:?} is unavailable: {cause}",
                                    target.body_id
                                );
                                self.remote_bodies
                                    .get_mut(&target.body_id)
                                    .expect("matching remote demand vanished during completion")
                                    .status = ClientRemoteBodyStatus::Unavailable;
                                continue;
                            }
                        };
                        let Some(body) = world.scene.body(target.body_id) else {
                            continue;
                        };
                        let initial_cell = body.pose.is_indoors().then_some(body.pose.landblock_id);
                        let Some(outcome) = world.scene.set_dynamic_physical_body(
                            target.body_id,
                            Some(
                                DynamicPhysicalBodyConfiguration::with_object_scale(
                                    physical,
                                    target.demand,
                                    current.object_scale,
                                )
                                .expect("remote completion carries valid non-empty demand"),
                            ),
                            PhysicalCollisionFilter::ALL,
                            initial_cell,
                        ) else {
                            continue;
                        };
                        self.remote_bodies
                            .get_mut(&target.body_id)
                            .expect("matching remote demand vanished during installation")
                            .status = ClientRemoteBodyStatus::Prepared;
                        if outcome.change
                            != holtburger_world::PhysicalBodyReconfiguration::Unchanged
                        {
                            events.push(WorldEvent::RuntimeBodyChanged {
                                body_id: target.body_id,
                            });
                        }
                    }
                }
            }
        }
        self.start_pending_remote_body_loading();
        events
    }

    /// Retires in-flight work after a teleport/reset while retaining installed static topology.
    pub fn invalidate(&mut self) {
        self.scene_generation = self.scene_generation.saturating_add(1);
        self.body_generation = self.body_generation.saturating_add(1);
        self.remote_body_generation = self.remote_body_generation.saturating_add(1);
        self.scene_worker.take().inspect(|worker| worker.abort());
        self.body_worker.take().inspect(|worker| worker.abort());
        self.remote_body_worker
            .take()
            .inspect(|worker| worker.abort());
        self.residency.retire_pending();
        self.body_target = None;
        self.body_readiness = ClientBodyReadiness::Waiting;
        self.remote_bodies.clear();
    }

    pub fn clear(&mut self) {
        if self.body_target.is_some()
            || !self.remote_bodies.is_empty()
            || self.residency.snapshot().revision != 0
            || !matches!(self.body_readiness, ClientBodyReadiness::Waiting)
        {
            self.invalidate();
            self.residency = SimulationSceneResidency::default();
        }
    }

    fn target_from_world(
        world: &WorldState,
        previous_interest: &SimulationSceneInterest,
    ) -> Option<ClientSpatialTarget> {
        let guid = world.player.guid;
        if guid == Guid::NULL {
            return None;
        }
        let entity = world.player_entity()?;
        let position = entity.position;
        let facts = client_player_body_facts(world).ok()?;
        let interest = SimulationSceneInterest::follow_neighborhood(
            position,
            CLIENT_COLLISION_OWNER_RADIUS,
            CLIENT_COLLISION_EXIT_MARGIN,
            previous_interest,
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
                    .prepare_body(worker_target.facts)
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

    fn observe_remote_bodies(&mut self, world: &mut WorldState) -> Vec<WorldEvent> {
        let desired = world
            .entities
            .iter()
            .filter_map(|entity| {
                client_remote_body_target(world, entity.guid).map(|target| (target.body_id, target))
            })
            .collect::<BTreeMap<_, _>>();
        if remote_body_demands_match(&self.remote_bodies, &desired) {
            self.start_pending_remote_body_loading();
            return Vec::new();
        }

        let mut events = Vec::new();
        let mut reconfigured = BTreeSet::new();
        for (&body_id, demand) in &self.remote_bodies {
            if desired.get(&body_id).is_some_and(|target| {
                target.facts.definition_eq(&demand.facts) && target.demand == demand.demand
            }) {
                continue;
            }
            if desired.get(&body_id).is_some_and(|target| {
                demand.facts.preparation_eq(&target.facts)
                    && reconfigure_physical_body(world, target, &mut events)
            }) {
                reconfigured.insert(body_id);
                continue;
            }
            remove_physical_body(world, body_id, &mut events);
        }
        self.remote_bodies = desired
            .into_iter()
            .map(|(body_id, target)| {
                let status = if reconfigured.contains(&body_id) {
                    ClientRemoteBodyStatus::Prepared
                } else {
                    self.remote_bodies
                        .get(&body_id)
                        .filter(|demand| {
                            demand.facts.definition_eq(&target.facts)
                                && demand.demand == target.demand
                        })
                        .map_or(ClientRemoteBodyStatus::Pending, |demand| {
                            match demand.status {
                                ClientRemoteBodyStatus::Prepared => {
                                    ClientRemoteBodyStatus::Prepared
                                }
                                ClientRemoteBodyStatus::Unavailable => {
                                    ClientRemoteBodyStatus::Unavailable
                                }
                                ClientRemoteBodyStatus::Preparing
                                    if self.remote_body_worker.is_some() =>
                                {
                                    ClientRemoteBodyStatus::Preparing
                                }
                                ClientRemoteBodyStatus::Pending
                                | ClientRemoteBodyStatus::Preparing => {
                                    ClientRemoteBodyStatus::Pending
                                }
                            }
                        })
                };
                (
                    body_id,
                    ClientRemoteBodyDemand {
                        facts: target.facts,
                        demand: target.demand,
                        status,
                    },
                )
            })
            .collect();

        self.start_pending_remote_body_loading();
        events
    }

    fn start_pending_remote_body_loading(&mut self) {
        if self.remote_body_worker.is_some() {
            return;
        }
        let pending = self
            .remote_bodies
            .iter_mut()
            .filter(|(_, demand)| demand.status == ClientRemoteBodyStatus::Pending)
            .map(|(&body_id, demand)| {
                demand.status = ClientRemoteBodyStatus::Preparing;
                ClientRemoteBodyTarget {
                    body_id,
                    facts: demand.facts.clone(),
                    demand: demand.demand,
                }
            })
            .collect::<Vec<_>>();
        if !pending.is_empty() {
            self.start_remote_body_loading(pending);
        }
    }

    fn start_remote_body_loading(&mut self, targets: Vec<ClientRemoteBodyTarget>) {
        let generation = self.remote_body_generation;
        let source = Arc::clone(&self.source);
        let completion_tx = self.completion_tx.clone();
        self.remote_body_worker = Some(tokio::spawn(async move {
            let failed_targets = targets.clone();
            let prepared = tokio::task::spawn_blocking(move || {
                targets
                    .into_iter()
                    .map(|target| {
                        let result = source
                            .prepare_body(target.facts.clone())
                            .map_err(|error| format!("{error:#}"));
                        (target, result)
                    })
                    .collect::<Vec<_>>()
            })
            .await;
            let targets = match prepared {
                Ok(targets) => targets,
                Err(error) => {
                    let cause = format!("client remote body worker failed: {error}");
                    failed_targets
                        .into_iter()
                        .map(|target| (target, Err(cause.clone())))
                        .collect()
                }
            };
            let _ = completion_tx.send(ClientSpatialCompletion::RemoteBodies(
                ClientRemoteBodyCompletion {
                    generation,
                    targets,
                },
            ));
        }));
    }
}

fn remote_body_demands_match(
    current: &BTreeMap<SpatialBodyId, ClientRemoteBodyDemand>,
    desired: &BTreeMap<SpatialBodyId, ClientRemoteBodyTarget>,
) -> bool {
    current.len() == desired.len()
        && current.iter().all(|(body_id, demand)| {
            desired.get(body_id).is_some_and(|target| {
                target.facts.definition_eq(&demand.facts) && target.demand == demand.demand
            })
        })
}

fn local_player_physical_demand(physics: EffectiveEntityPhysicsState) -> LocalPhysicalDemand {
    LocalPhysicalDemand {
        target: if physics.dynamic_collision.target != EntityCollisionParticipation::Suppressed
            && !physics.dynamic_collision.missile
        {
            LocalTargetDemand::Retained
        } else {
            LocalTargetDemand::Absent
        },
        integration: LocalIntegrationDemand::Eligible,
    }
}

/// Resolves complete positive physical demand from current authoritative client facts.
fn client_remote_body_target(world: &WorldState, guid: Guid) -> Option<ClientRemoteBodyTarget> {
    let entity = world.entities.get(guid)?;
    let body_id = SpatialBodyId::Entity(guid);
    if guid == world.player.guid
        || entity.attachment.is_some()
        || !entity.physics.effective().supports_local_simulation()
    {
        return None;
    }
    let body = world.scene.body(body_id)?;
    body.authoritative_pose?;
    let facts = client_entity_body_facts(world, guid).ok()?;
    let target = if facts.physics.dynamic_collision.target
        != EntityCollisionParticipation::Suppressed
        && !facts.physics.dynamic_collision.missile
    {
        LocalTargetDemand::Retained
    } else {
        LocalTargetDemand::Absent
    };
    let has_integration_work = facts.physics.response.gravity
        || facts.physics.dynamic_collision.missile
        || world.body_has_simulatable_projection_basis(body_id)
        || body.has_pose_reconciliation_work();
    let integration = if facts.physics.integration_eligibility
        == EntityIntegrationEligibility::Eligible
        && has_integration_work
    {
        LocalIntegrationDemand::Eligible
    } else {
        LocalIntegrationDemand::Excluded
    };
    let demand = LocalPhysicalDemand {
        target,
        integration,
    };
    demand
        .requires_physical_body()
        .then_some(ClientRemoteBodyTarget {
            body_id,
            facts,
            demand,
        })
}

fn remove_physical_body(
    world: &mut WorldState,
    body_id: SpatialBodyId,
    events: &mut Vec<WorldEvent>,
) {
    let initial_cell = world
        .scene
        .body(body_id)
        .and_then(|body| body.pose.is_indoors().then_some(body.pose.landblock_id));
    if let Some(outcome) = world.scene.set_dynamic_physical_body(
        body_id,
        None,
        PhysicalCollisionFilter::ALL,
        initial_cell,
    ) && outcome.change != holtburger_world::PhysicalBodyReconfiguration::Unchanged
    {
        events.push(WorldEvent::RuntimeBodyChanged { body_id });
    }
}

fn remove_local_player_physical_body(
    world: &mut WorldState,
    player: ClientPlayerIdentity,
    events: &mut Vec<WorldEvent>,
) {
    remove_physical_body(world, SpatialBodyId::LocalPlayer(player.guid), events);
}

fn reconfigure_local_player_body(
    world: &mut WorldState,
    target: &ClientBodyTarget,
    events: &mut Vec<WorldEvent>,
) -> bool {
    let physical_target = ClientRemoteBodyTarget {
        body_id: SpatialBodyId::LocalPlayer(target.player.guid),
        facts: target.facts.clone(),
        demand: target.demand,
    };
    reconfigure_physical_body(world, &physical_target, events)
}

fn reconfigure_physical_body(
    world: &mut WorldState,
    target: &ClientRemoteBodyTarget,
    events: &mut Vec<WorldEvent>,
) -> bool {
    let Some((configuration, initial_cell)) = world.scene.body(target.body_id).and_then(|body| {
        let configuration = body
            .physical
            .as_ref()?
            .dynamic_configuration_for_state(target.facts.physics, target.demand)?;
        let initial_cell = body.pose.is_indoors().then_some(body.pose.landblock_id);
        Some((configuration, initial_cell))
    }) else {
        return false;
    };
    let Some(outcome) = world.scene.set_dynamic_physical_body(
        target.body_id,
        Some(configuration),
        PhysicalCollisionFilter::ALL,
        initial_cell,
    ) else {
        return false;
    };
    if outcome.change != holtburger_world::PhysicalBodyReconfiguration::Unchanged {
        events.push(WorldEvent::RuntimeBodyChanged {
            body_id: target.body_id,
        });
    }
    true
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
        if let Some(worker) = self.remote_body_worker.take() {
            worker.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::{PhysicsState, WorldObjectPropertyAccessorsMut};
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_content::{LandblockCollisionAsset, TerrainCollisionSurface};
    use holtburger_world::{
        AuthoritativeBodyVectors, AuthoritativePoseEffect, DynamicBodyCollisionDefinition,
        DynamicPhysicalBodyDefinition, EntityCollisionReportPolicy, EntityDynamicCollisionPolicy,
        PhysicalBodyDefinition, PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction,
        PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, SpatialBodyId,
    };
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc::{Receiver, SyncSender};

    /// Deterministic preparation pause scoped to one test entity.
    struct BodyGate {
        guid: Guid,
        started: SyncSender<()>,
        release: Receiver<()>,
    }

    #[derive(Default)]
    struct FakeSource {
        loaded: Mutex<Vec<u32>>,
        missing: Mutex<Vec<u32>>,
        prepared: AtomicUsize,
        body_gate: Mutex<Option<BodyGate>>,
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

        fn prepare_body(
            &self,
            facts: ClientEntityBodyFacts,
        ) -> Result<DynamicPhysicalBodyDefinition> {
            self.prepared.fetch_add(1, Ordering::SeqCst);
            if let Some(gate) = self
                .body_gate
                .lock()
                .unwrap()
                .as_ref()
                .filter(|gate| gate.guid == facts.guid)
            {
                gate.started.send(()).unwrap();
                gate.release.recv().unwrap();
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
                    target_geometry: Arc::new(holtburger_world::PreparedEntityTargetGeometry {
                        physics_bsp_parts: Vec::new(),
                        fallback_setup_did: 0,
                        fallback_shapes: Vec::new(),
                        fallback_scale: holtburger_content::ColliderScale::uniform(1.0).unwrap(),
                    }),
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

    fn remote_demand_for_state(
        state: PhysicsState,
        velocity: Vector3,
    ) -> Option<LocalPhysicalDemand> {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x7000_0042);
        world.add_entity(holtburger_world::entity::Entity::new(
            guid,
            "Remote".to_owned(),
            position(0x1234_0002),
        ));
        facts(&mut world, guid);
        let entity = world.entities.get_mut(guid).unwrap();
        entity
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                state,
            ));
        entity.velocity = velocity;
        client_remote_body_target(&world, guid).map(|target| target.demand)
    }

    #[test]
    fn remote_demand_requires_positive_target_or_integration_work() {
        assert_eq!(
            remote_demand_for_state(
                PhysicsState::ETHEREAL | PhysicsState::IGNORE_COLLISIONS,
                Vector3::zero(),
            ),
            None,
            "suppressed zero-gravity zero-work entities remain pose-only"
        );
        assert_eq!(
            remote_demand_for_state(PhysicsState::empty(), Vector3::zero()),
            Some(LocalPhysicalDemand {
                target: LocalTargetDemand::Retained,
                integration: LocalIntegrationDemand::Excluded,
            }),
            "solid zero-work entities retain target geometry without becoming movers"
        );
        assert_eq!(
            remote_demand_for_state(PhysicsState::GRAVITY, Vector3::zero()),
            Some(LocalPhysicalDemand {
                target: LocalTargetDemand::Retained,
                integration: LocalIntegrationDemand::Eligible,
            }),
        );
        assert_eq!(
            remote_demand_for_state(PhysicsState::MISSILE, Vector3::zero()),
            Some(LocalPhysicalDemand {
                target: LocalTargetDemand::Absent,
                integration: LocalIntegrationDemand::Eligible,
            }),
        );
        assert_eq!(
            remote_demand_for_state(
                PhysicsState::ETHEREAL | PhysicsState::IGNORE_COLLISIONS,
                Vector3::new(1.0, 0.0, 0.0),
            ),
            Some(LocalPhysicalDemand {
                target: LocalTargetDemand::Absent,
                integration: LocalIntegrationDemand::Eligible,
            }),
            "retained vectors promote an otherwise pose-only body"
        );
        assert_eq!(
            remote_demand_for_state(PhysicsState::STATIC, Vector3::new(1.0, 0.0, 0.0),),
            None,
            "unsupported state remains a validation gate after positive work"
        );
    }

    #[test]
    fn pending_reconciliation_is_positive_integration_work() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x7000_0042);
        let initial = position(0x1234_0002);
        world.add_entity(holtburger_world::entity::Entity::new(
            guid,
            "Remote".to_owned(),
            initial,
        ));
        facts(&mut world, guid);
        world.entities.get_mut(guid).unwrap().physics.reconcile(
            holtburger_world::resolve_effective_entity_physics_state(
                PhysicsState::ETHEREAL | PhysicsState::IGNORE_COLLISIONS,
            ),
        );
        let target = WorldPosition {
            coords: initial.coords + Vector3::new(1.0, 0.0, 0.0),
            ..initial
        };
        assert!(world.scene.apply_authoritative_body_effect(
            SpatialBodyId::Entity(guid),
            AuthoritativePoseEffect::Interpolate {
                pose: target,
                keep_heading: false,
                adjusted_max_speed_mps: None,
            },
            AuthoritativeBodyVectors {
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
            },
            Instant::now(),
        ));

        assert_eq!(
            client_remote_body_target(&world, guid).map(|target| target.demand),
            Some(LocalPhysicalDemand {
                target: LocalTargetDemand::Absent,
                integration: LocalIntegrationDemand::Eligible,
            })
        );
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

    async fn wait_for_physical_body(
        coordinator: &mut ClientCollisionCoordinator,
        world: &mut WorldState,
        body_id: SpatialBodyId,
    ) {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                let _ = coordinator.poll(world, Instant::now());
                if world
                    .scene
                    .body(body_id)
                    .is_some_and(|body| body.physical.is_some())
                {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("client collision worker did not install the expected physical body");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn exact_cell_motion_and_repeated_seam_crossing_avoid_reloading_collision() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        world.seed_local_player_entity(guid, "Player", position(0x1234_0001));
        facts(&mut world, guid);
        let source = Arc::new(FakeSource::default());
        let mut coordinator = ClientCollisionCoordinator::new(source.clone());
        coordinator.observe(&mut world);
        assert!(!coordinator.destination_scene_ready(Guid(0x1234_0001)));
        wait_for_readiness(&mut coordinator, &mut world, |readiness| {
            matches!(readiness, ClientBodyReadiness::Ready { .. })
        })
        .await;
        wait_for_scene_revision(&mut coordinator, &mut world, 1).await;
        assert!(coordinator.destination_scene_ready(Guid(0x1234_0001)));
        assert_eq!(source.loaded.lock().unwrap().len(), 9);
        assert_eq!(source.prepared.load(Ordering::SeqCst), 1);

        world.entities.get_mut(guid).unwrap().position.landblock_id = Guid(0x1234_0002);
        coordinator.observe(&mut world);
        let same_owner = coordinator.snapshot();
        assert_eq!(same_owner.revision, 1);
        assert_eq!(source.loaded.lock().unwrap().len(), 9);
        assert_eq!(source.prepared.load(Ordering::SeqCst), 1);

        world.entities.get_mut(guid).unwrap().position.landblock_id = Guid(0x1334_0001);
        coordinator.observe(&mut world);
        assert!(Arc::ptr_eq(&same_owner, &coordinator.snapshot()));
        wait_for_scene_revision(&mut coordinator, &mut world, 2).await;
        assert_eq!(source.loaded.lock().unwrap().len(), 12);
        assert_eq!(source.prepared.load(Ordering::SeqCst), 1);

        for owner in [0x1234_0001, 0x1334_0001, 0x1234_0001] {
            world.entities.get_mut(guid).unwrap().position.landblock_id = Guid(owner);
            coordinator.observe(&mut world);
            assert!(
                coordinator.scene_worker.is_none(),
                "a retained seam crossing must not schedule collision loading"
            );
        }
        assert_eq!(coordinator.snapshot().revision, 2);
        assert_eq!(source.loaded.lock().unwrap().len(), 12);
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
            body_gate: Mutex::new(Some(BodyGate {
                guid,
                started: started_tx,
                release: release_rx,
            })),
            ..FakeSource::default()
        });
        let mut coordinator = ClientCollisionCoordinator::new(source);
        coordinator.observe(&mut world);
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
    async fn hydrated_zero_work_remote_becomes_target_only() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        let remote_guid = Guid(0x7000_0001);
        world.seed_local_player_entity(player_guid, "Player", position(0x1234_0001));
        facts(&mut world, player_guid);
        world.add_entity(holtburger_world::entity::Entity::new(
            remote_guid,
            "Remote".to_owned(),
            position(0x1234_0002),
        ));
        facts(&mut world, remote_guid);

        let source = Arc::new(FakeSource::default());
        let mut coordinator = ClientCollisionCoordinator::new(source.clone());
        let _ = coordinator.observe(&mut world);
        wait_for_physical_body(
            &mut coordinator,
            &mut world,
            SpatialBodyId::LocalPlayer(player_guid),
        )
        .await;
        let body_id = SpatialBodyId::Entity(remote_guid);
        wait_for_physical_body(&mut coordinator, &mut world, body_id).await;

        assert_eq!(source.prepared.load(Ordering::SeqCst), 2);
        assert!(
            !world
                .scene
                .scheduled_dynamic_entity_ids()
                .contains(&body_id)
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn suppressed_zero_work_remote_never_requests_physical_preparation() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        let remote_guid = Guid(0x7000_0001);
        world.seed_local_player_entity(player_guid, "Player", position(0x1234_0001));
        facts(&mut world, player_guid);
        world.add_entity(holtburger_world::entity::Entity::new(
            remote_guid,
            "Remote".to_owned(),
            position(0x1234_0002),
        ));
        facts(&mut world, remote_guid);
        world
            .entities
            .get_mut(remote_guid)
            .unwrap()
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                PhysicsState::ETHEREAL | PhysicsState::IGNORE_COLLISIONS,
            ));

        let source = Arc::new(FakeSource::default());
        let mut coordinator = ClientCollisionCoordinator::new(source.clone());
        let _ = coordinator.observe(&mut world);
        wait_for_physical_body(
            &mut coordinator,
            &mut world,
            SpatialBodyId::LocalPlayer(player_guid),
        )
        .await;

        assert_eq!(source.prepared.load(Ordering::SeqCst), 1);
        assert!(
            world
                .scene
                .body(SpatialBodyId::Entity(remote_guid))
                .is_some_and(|body| body.physical.is_none())
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn vector_demand_promotes_and_demotes_with_no_content_reload() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        let remote_guid = Guid(0x7000_0001);
        world.seed_local_player_entity(player_guid, "Player", position(0x1234_0001));
        facts(&mut world, player_guid);
        world.add_entity(holtburger_world::entity::Entity::new(
            remote_guid,
            "Remote".to_owned(),
            position(0x1234_0002),
        ));
        facts(&mut world, remote_guid);

        let source = Arc::new(FakeSource::default());
        let mut coordinator = ClientCollisionCoordinator::new(source.clone());
        let _ = coordinator.observe(&mut world);
        let body_id = SpatialBodyId::Entity(remote_guid);
        wait_for_physical_body(
            &mut coordinator,
            &mut world,
            SpatialBodyId::LocalPlayer(player_guid),
        )
        .await;
        wait_for_physical_body(&mut coordinator, &mut world, body_id).await;
        assert!(
            !world
                .scene
                .scheduled_dynamic_entity_ids()
                .contains(&body_id)
        );
        let preparations = source.prepared.load(Ordering::SeqCst);

        world.entities.get_mut(remote_guid).unwrap().velocity = Vector3::new(1.0, 0.0, 0.0);
        let promoted = coordinator.observe(&mut world);
        assert!(
            world
                .scene
                .scheduled_dynamic_entity_ids()
                .contains(&body_id)
        );
        assert!(promoted.iter().any(
            |event| matches!(event, WorldEvent::RuntimeBodyChanged { body_id: changed } if *changed == body_id)
        ));
        assert_eq!(source.prepared.load(Ordering::SeqCst), preparations);

        world.entities.get_mut(remote_guid).unwrap().velocity = Vector3::zero();
        let _ = coordinator.observe(&mut world);
        assert!(
            !world
                .scene
                .scheduled_dynamic_entity_ids()
                .contains(&body_id)
        );
        assert!(world.scene.body(body_id).unwrap().physical.is_some());
        assert_eq!(source.prepared.load(Ordering::SeqCst), preparations);
    }

    #[tokio::test]
    async fn remote_completion_is_rejected_when_positive_demand_changed() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x7000_0001);
        world.add_entity(holtburger_world::entity::Entity::new(
            guid,
            "Remote".to_owned(),
            position(0x1234_0002),
        ));
        facts(&mut world, guid);
        let current = client_remote_body_target(&world, guid).unwrap();
        let stale = ClientRemoteBodyTarget {
            demand: LocalPhysicalDemand {
                target: LocalTargetDemand::Retained,
                integration: LocalIntegrationDemand::Eligible,
            },
            ..current.clone()
        };
        let source = Arc::new(FakeSource::default());
        let physical = source.prepare_body(stale.facts.clone()).unwrap();
        let mut coordinator = ClientCollisionCoordinator::new(source);
        coordinator.remote_bodies.insert(
            current.body_id,
            ClientRemoteBodyDemand {
                facts: current.facts,
                demand: current.demand,
                status: ClientRemoteBodyStatus::Unavailable,
            },
        );
        coordinator
            .completion_tx
            .send(ClientSpatialCompletion::RemoteBodies(
                ClientRemoteBodyCompletion {
                    generation: coordinator.remote_body_generation,
                    targets: vec![(stale, Ok(physical))],
                },
            ))
            .unwrap();

        let events = coordinator.poll(&mut world, Instant::now());

        assert!(events.is_empty());
        assert!(
            world
                .scene
                .body(SpatialBodyId::Entity(guid))
                .is_some_and(|body| body.physical.is_none())
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn incompatible_content_change_removes_stale_body_before_preparation() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        let remote_guid = Guid(0x7000_0001);
        world.seed_local_player_entity(player_guid, "Player", position(0x1234_0001));
        facts(&mut world, player_guid);
        world.add_entity(holtburger_world::entity::Entity::new(
            remote_guid,
            "Remote".to_owned(),
            position(0x1234_0002),
        ));
        facts(&mut world, remote_guid);

        let source = Arc::new(FakeSource::default());
        let mut coordinator = ClientCollisionCoordinator::new(source.clone());
        let _ = coordinator.observe(&mut world);
        let body_id = SpatialBodyId::Entity(remote_guid);
        wait_for_physical_body(&mut coordinator, &mut world, body_id).await;

        let (started_tx, started_rx) = std::sync::mpsc::sync_channel(0);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
        *source.body_gate.lock().unwrap() = Some(BodyGate {
            guid: remote_guid,
            started: started_tx,
            release: release_rx,
        });
        world
            .entities
            .get_mut(remote_guid)
            .unwrap()
            .properties
            .set_did_prop(PropertyDataId::Setup, Guid(0x0200_0002));

        let events = coordinator.observe(&mut world);
        started_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("replacement preparation did not reach the test gate");
        assert!(world.scene.body(body_id).unwrap().physical.is_none());
        assert!(events.iter().any(
            |event| matches!(event, WorldEvent::RuntimeBodyChanged { body_id: changed } if *changed == body_id)
        ));

        release_tx.send(()).unwrap();
        wait_for_physical_body(&mut coordinator, &mut world, body_id).await;
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 3)]
    async fn new_remote_demand_does_not_restart_in_flight_body_preparation() {
        let mut world = WorldState::synthetic();
        let player_guid = Guid(0x5000_0001);
        let first_guid = Guid(0x7000_0001);
        let second_guid = Guid(0x7000_0002);
        world.seed_local_player_entity(player_guid, "Player", position(0x1234_0001));
        facts(&mut world, player_guid);
        world.add_entity(holtburger_world::entity::Entity::new(
            first_guid,
            "First".to_owned(),
            position(0x1234_0002),
        ));
        facts(&mut world, first_guid);

        let (started_tx, started_rx) = std::sync::mpsc::sync_channel(0);
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);
        let source = Arc::new(FakeSource {
            body_gate: Mutex::new(Some(BodyGate {
                guid: first_guid,
                started: started_tx,
                release: release_rx,
            })),
            ..FakeSource::default()
        });
        let mut coordinator = ClientCollisionCoordinator::new(source.clone());
        let _ = coordinator.observe(&mut world);
        started_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("first remote preparation did not reach the test gate");

        world.add_entity(holtburger_world::entity::Entity::new(
            second_guid,
            "Second".to_owned(),
            position(0x1234_0003),
        ));
        facts(&mut world, second_guid);
        let _ = coordinator.observe(&mut world);
        release_tx.send(()).unwrap();

        wait_for_physical_body(
            &mut coordinator,
            &mut world,
            SpatialBodyId::Entity(first_guid),
        )
        .await;
        wait_for_physical_body(
            &mut coordinator,
            &mut world,
            SpatialBodyId::Entity(second_guid),
        )
        .await;
        wait_for_physical_body(
            &mut coordinator,
            &mut world,
            SpatialBodyId::LocalPlayer(player_guid),
        )
        .await;
        assert_eq!(source.prepared.load(Ordering::SeqCst), 3);
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn runtime_env_cell_change_projects_membership_for_the_new_resident_cell() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x5000_0001);
        let initial = position(0x1234_0101);
        world.seed_local_player_entity(guid, "Player", initial);
        facts(&mut world, guid);
        let mut coordinator = ClientCollisionCoordinator::new(Arc::new(FakeSource::default()));
        coordinator.observe(&mut world);
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
        coordinator.observe(&mut world);

        world.entities.get_mut(guid).unwrap().position.landblock_id = Guid(0x1235_0001);
        coordinator.observe(&mut world);
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
        coordinator.observe(&mut world);
        wait_for_readiness(&mut coordinator, &mut world, |readiness| {
            matches!(readiness, ClientBodyReadiness::Ready { .. })
        })
        .await;
        wait_for_scene_revision(&mut coordinator, &mut world, 1).await;
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
        coordinator.observe(&mut world);
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
        coordinator.observe(&mut world);
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
            Err(ClientEntityBodyFactsError::MissingWcid)
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
            Err(ClientEntityBodyFactsError::MissingSetup)
        );
    }
}
