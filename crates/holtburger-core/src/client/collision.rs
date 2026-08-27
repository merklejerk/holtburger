//! Client-owned collision products and local-player body preparation.
//!
//! The client has one authoritative [`WorldState`](holtburger_world::WorldState), but static
//! collision is a content product that may take substantially longer to decode than a network
//! turn.  This module keeps those concerns separate: a coordinator stages a complete immutable
//! [`CollisionScene`](holtburger_world::CollisionScene) and a validated local-player physical
//! definition off the simulation clock, then commits both only when the same player instance and
//! authoritative residency are still current.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Instant;

use crate::{
    DynamicEntityContent, DynamicEntityDefinition, DynamicEntityDefinitionInput,
    DynamicEntityInitialState, DynamicEntityRadarFacts,
};
use anyhow::{Context, Result, anyhow};
use holtburger_common::Guid;
use holtburger_common::position::{MAX_OUTDOOR_LANDBLOCK_AXIS, WorldPosition};
use holtburger_common::properties::{
    ItemType, PropertyDataId, PropertyFloat, PropertyInt, PropertyString, WeenieType,
    WorldObjectPropertyAccessors as _,
};
use holtburger_content::{ContentRepository, LandblockCollisionAsset, normalize_landblock_id};
use holtburger_world::{
    CollisionScene, DynamicPhysicalBodyDefinition, EffectiveEntityPhysicsState, EntityAppearance,
    EntityPlacement, PhysicalCollisionFilter, SpatialBodyId, WorldEvent, WorldState,
};
use thiserror::Error;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

/// One landblock of collision coverage on either side of the authoritative owner.
pub const CLIENT_COLLISION_OWNER_RADIUS: i8 = 1;

/// Complete normalized collision-owner demand for one authoritative player residency.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientCollisionInterest {
    owners: Vec<Guid>,
}

impl ClientCollisionInterest {
    /// Derives the bounded 3×3 owner set from the authority's landblock frame.
    ///
    /// The local coordinates are deliberately not consulted.  For indoor positions the high
    /// bytes still identify the owning CellLandblock and the same owner is retained as the center;
    /// neighboring owners are harmlessly bounded by the authored outdoor lattice.  A null
    /// position has no collision demand and returns `None` rather than inventing an origin.
    pub fn from_position(position: WorldPosition) -> Option<Self> {
        if position.landblock_id == Guid::NULL {
            return None;
        }

        let (x, y) = position.landblock_coords();
        let mut owners = BTreeSet::new();
        for offset_x in -CLIENT_COLLISION_OWNER_RADIUS..=CLIENT_COLLISION_OWNER_RADIUS {
            for offset_y in -CLIENT_COLLISION_OWNER_RADIUS..=CLIENT_COLLISION_OWNER_RADIUS {
                let owner_x = i16::from(x) + i16::from(offset_x);
                let owner_y = i16::from(y) + i16::from(offset_y);
                if !(0..=i16::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&owner_x)
                    || !(0..=i16::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&owner_y)
                {
                    continue;
                }
                let raw = ((owner_x as u32) << 24) | ((owner_y as u32) << 16);
                owners.insert(Guid(normalize_landblock_id(raw)));
            }
        }

        Some(Self {
            owners: owners.into_iter().collect(),
        })
    }

    /// Returns owners in deterministic ascending order.
    pub fn owners(&self) -> &[Guid] {
        &self.owners
    }
}

/// Exact authoritative player identity used to guard asynchronous completion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClientPlayerInstance {
    /// Server-assigned local-player object identity.
    pub guid: Guid,
    /// Server instance sequence guarding reuse of the object identity.
    pub instance_sequence: u16,
    /// Full authoritative cell/landblock selector, not a renderer-derived approximation.
    pub residency: Guid,
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
    /// Authority-provided display name retained by the dynamic definition.
    pub name: String,
    /// Authoritative pose captured when preparation starts.
    pub position: WorldPosition,
    /// Authoritative linear velocity captured when preparation starts.
    pub velocity: holtburger_common::Vector3,
    /// Authoritative linear acceleration captured when preparation starts.
    pub acceleration: holtburger_common::Vector3,
    /// Authoritative angular velocity captured when preparation starts.
    pub omega: holtburger_common::Vector3,
    /// Lossless appearance facts needed by dynamic definition preparation.
    pub appearance: EntityAppearance,
    /// Effective semantic physics flags controlling solver participation.
    pub physics: EffectiveEntityPhysicsState,
    /// Setup resource defining physical geometry.
    pub setup_did: u32,
    /// Optional authored motion-table resource.
    pub motion_table_did: Option<u32>,
    /// Optional authored sound-table resource.
    pub sound_table_did: Option<u32>,
    /// Optional authored physics-effect-table resource.
    pub physics_effect_table_did: Option<u32>,
    /// Authored object scale applied to prepared geometry.
    pub object_scale: f32,
    /// Optional authored surface friction.
    pub friction: Option<f32>,
    /// Optional authored elasticity.
    pub elasticity: Option<f32>,
    /// Optional authored maximum linear velocity.
    pub maximum_velocity: Option<f32>,
    /// Optional authored rotation speed.
    pub rotation_speed: Option<f32>,
    /// Resolved radar semantics retained by the dynamic definition.
    pub radar: DynamicEntityRadarFacts,
}

impl ClientPlayerBodyFacts {
    /// Body-definition equality intentionally ignores live pose and kinematics.  A server motion
    /// update must not restart a DAT preparation job; a setup/appearance/physics replacement must.
    fn definition_eq(&self, other: &Self) -> bool {
        self.guid == other.guid
            && self.instance_sequence == other.instance_sequence
            && self.wcid == other.wcid
            && self.name == other.name
            && self.appearance == other.appearance
            && self.physics == other.physics
            && self.setup_did == other.setup_did
            && self.motion_table_did == other.motion_table_did
            && self.sound_table_did == other.sound_table_did
            && self.physics_effect_table_did == other.physics_effect_table_did
            && self.object_scale.to_bits() == other.object_scale.to_bits()
            && option_f32_eq(self.friction, other.friction)
            && option_f32_eq(self.elasticity, other.elasticity)
            && option_f32_eq(self.maximum_velocity, other.maximum_velocity)
            && option_f32_eq(self.rotation_speed, other.rotation_speed)
            && self.radar == other.radar
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
    #[error("local player has no display name")]
    MissingName,
    #[error("local player display name is empty")]
    EmptyName,
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
    let name = entity
        .properties
        .get_string_prop(PropertyString::Name)
        .ok_or(ClientPlayerBodyFactsError::MissingName)?
        .to_owned();
    if name.is_empty() {
        return Err(ClientPlayerBodyFactsError::EmptyName);
    }
    let setup_did = entity
        .properties
        .get_data_prop(PropertyDataId::Setup)
        .map(|did| did.0)
        .ok_or(ClientPlayerBodyFactsError::MissingSetup)?;

    let item_type = entity
        .properties
        .get_int_prop(PropertyInt::ItemType)
        .map(|value| ItemType::from_bits_retain(value as u32));
    let radar = DynamicEntityRadarFacts::from_authored(
        format_args!("client player 0x{:08X}", entity.guid.0),
        entity.properties.get_int_prop(PropertyInt::RadarBlipColor),
        crate::semantic_radar_blip_color(entity.flags, item_type),
        entity.properties.get_int_prop(PropertyInt::ShowableOnRadar),
        entity
            .properties
            .get_float_prop(PropertyFloat::ObviousRadarRange),
    );

    Ok(ClientPlayerBodyFacts {
        guid: entity.guid,
        instance_sequence: entity.instance_sequence(),
        wcid,
        name,
        position: entity.position,
        velocity: entity.velocity,
        acceleration: entity.acceleration,
        omega: entity.omega,
        appearance: entity.appearance.clone(),
        physics: entity.physics,
        setup_did,
        motion_table_did: entity
            .properties
            .get_data_prop(PropertyDataId::MotionTable)
            .map(|did| did.0),
        sound_table_did: entity
            .properties
            .get_data_prop(PropertyDataId::SoundTable)
            .map(|did| did.0),
        physics_effect_table_did: entity
            .properties
            .get_data_prop(PropertyDataId::PhysicsEffectTable)
            .map(|did| did.0),
        object_scale: entity
            .properties
            .get_float_prop(PropertyFloat::DefaultScale)
            .map(|value| value as f32)
            .unwrap_or(1.0),
        friction: property_f32(&entity.properties, PropertyFloat::Friction),
        elasticity: property_f32(&entity.properties, PropertyFloat::Elasticity),
        maximum_velocity: property_f32(&entity.properties, PropertyFloat::MaximumVelocity),
        rotation_speed: property_f32(&entity.properties, PropertyFloat::RotationSpeed),
        radar,
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
        // The selected local player is a Creature in ACE's client object path; the server's
        // CharacterHandler creates the same creature object before PlayerCreate.  This is an
        // authority classification, not a renderer guess.
        let setup = crate::prepare_dynamic_entity_setup(
            facts.wcid,
            facts.setup_did,
            facts.object_scale,
            &self.content,
        )
        .with_context(|| {
            format!(
                "could not prepare local-player setup 0x{:08X} for WCID {}",
                facts.setup_did, facts.wcid
            )
        })?;
        let definition = DynamicEntityDefinition::prepare(DynamicEntityDefinitionInput {
            identity: crate::DynamicEntityIdentity {
                guid: facts.guid,
                wcid: facts.wcid,
                name: facts.name,
                weenie_type: WeenieType::Creature,
            },
            content: DynamicEntityContent {
                setup_did: facts.setup_did,
                motion_table_did: facts.motion_table_did,
                sound_table_did: facts.sound_table_did,
                physics_effect_table_did: facts.physics_effect_table_did,
            },
            appearance: facts.appearance,
            placement: EntityPlacement::World(DynamicEntityInitialState {
                pose: facts.position,
                velocity: facts.velocity,
                acceleration: facts.acceleration,
                omega: facts.omega,
                created_at: Instant::now(),
            }),
            object_scale: facts.object_scale,
            friction: facts.friction,
            elasticity: facts.elasticity,
            maximum_velocity: facts.maximum_velocity,
            rotation_speed: facts.rotation_speed,
            radar: facts.radar,
            body_height: setup.body_height,
            physics: facts.physics,
        })
        .context("could not validate local-player dynamic definition")?;

        crate::prepare_dynamic_entity_physics(&definition, &self.content)
            .context("could not prepare local-player collision geometry")
    }
}

/// Atomic static-collision snapshot paired with its owner demand and revision.
#[derive(Clone)]
pub struct ClientCollisionSnapshot {
    /// Authority identity whose body definition was prepared with this scene revision.
    pub player: ClientPlayerInstance,
    /// Monotonic immutable collision-product revision.
    pub revision: u64,
    /// Exact normalized owner demand loaded into this scene.
    pub interest: ClientCollisionInterest,
    /// Complete immutable static-collision product.
    pub scene: Arc<CollisionScene>,
}

impl std::fmt::Debug for ClientCollisionSnapshot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ClientCollisionSnapshot")
            .field("revision", &self.revision)
            .field("interest", &self.interest)
            .finish_non_exhaustive()
    }
}

/// Closed readiness state consumed by the later transactional client solver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientSpatialReadiness {
    Waiting,
    Preparing {
        player: ClientPlayerInstance,
        interest: ClientCollisionInterest,
        request: u64,
    },
    Ready {
        player: ClientPlayerInstance,
        interest: ClientCollisionInterest,
        collision_revision: u64,
    },
    Unavailable {
        player: ClientPlayerInstance,
        interest: ClientCollisionInterest,
        cause: String,
    },
}

#[derive(Clone)]
struct ClientCollisionTarget {
    player: ClientPlayerInstance,
    interest: ClientCollisionInterest,
    facts: ClientPlayerBodyFacts,
}

struct ClientCollisionProducts {
    scene: CollisionScene,
    physical: DynamicPhysicalBodyDefinition,
}

struct ClientCollisionCompletion {
    generation: u64,
    request: u64,
    target: ClientCollisionTarget,
    result: std::result::Result<ClientCollisionProducts, String>,
}

/// Core-owned coordinator shared by desktop and TUI client compositions.
pub struct ClientCollisionCoordinator {
    source: Arc<dyn ClientCollisionSource>,
    completion_tx: UnboundedSender<ClientCollisionCompletion>,
    completion_rx: UnboundedReceiver<ClientCollisionCompletion>,
    worker: Option<tokio::task::JoinHandle<()>>,
    target: Option<ClientCollisionTarget>,
    snapshot: Option<ClientCollisionSnapshot>,
    readiness: ClientSpatialReadiness,
    next_request: u64,
    next_generation: u64,
    next_revision: u64,
}

impl ClientCollisionCoordinator {
    pub fn new(source: Arc<dyn ClientCollisionSource>) -> Self {
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        Self {
            source,
            completion_tx,
            completion_rx,
            worker: None,
            target: None,
            snapshot: None,
            readiness: ClientSpatialReadiness::Waiting,
            next_request: 0,
            next_generation: 0,
            next_revision: 0,
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

    pub fn readiness(&self) -> ClientSpatialReadiness {
        self.readiness.clone()
    }

    pub fn snapshot(&self) -> Option<ClientCollisionSnapshot> {
        self.snapshot.clone()
    }

    /// Starts one staged request when the authoritative player target changed.
    pub fn observe(&mut self, world: &WorldState) {
        let Some(target) = Self::target_from_world(world) else {
            self.clear();
            return;
        };

        let same_target = self.target.as_ref().is_some_and(|current| {
            current.player == target.player
                && current.interest == target.interest
                && current.facts.definition_eq(&target.facts)
        });
        if !same_target {
            self.start_loading(target);
        }
    }

    /// Commits only a completion that still names the current player/residency/body definition.
    pub fn poll(&mut self, world: &mut WorldState, _now: Instant) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        while let Ok(completion) = self.completion_rx.try_recv() {
            if completion.generation != self.next_generation
                || !matches!(
                    self.readiness,
                    ClientSpatialReadiness::Preparing { request, .. } if request == completion.request
                )
                || self.target.as_ref().is_none_or(|target| {
                    target.player != completion.target.player
                        || target.interest != completion.target.interest
                        || !target.facts.definition_eq(&completion.target.facts)
                })
            {
                continue;
            }

            self.worker = None;
            let current = Self::target_from_world(world);
            if current.as_ref().is_none_or(|target| {
                target.player != completion.target.player
                    || target.interest != completion.target.interest
                    || !target.facts.definition_eq(&completion.target.facts)
            }) {
                self.readiness = ClientSpatialReadiness::Waiting;
                self.target = None;
                self.snapshot = None;
                continue;
            }

            match completion.result {
                Ok(products) => {
                    let body_id = SpatialBodyId::LocalPlayer(completion.target.player.guid);
                    let Some(body) = world.scene.body(body_id) else {
                        self.readiness = ClientSpatialReadiness::Waiting;
                        self.target = None;
                        self.snapshot = None;
                        continue;
                    };
                    if body.authoritative_pose.is_none() {
                        self.readiness = ClientSpatialReadiness::Waiting;
                        continue;
                    }

                    let initial_cell = residency_is_indoors(completion.target.player.residency)
                        .then_some(completion.target.player.residency);
                    let Some(_outcome) = world.scene.set_dynamic_physical_body(
                        body_id,
                        Some(products.physical),
                        PhysicalCollisionFilter::ALL,
                        initial_cell,
                    ) else {
                        self.readiness = ClientSpatialReadiness::Waiting;
                        self.target = None;
                        self.snapshot = None;
                        continue;
                    };

                    // Body preparation and destination placement are one authority product. A
                    // prepared definition must not inherit response/membership from the scene
                    // the player just left, especially when the destination is an EnvCell.
                    if world
                        .relocate_local_player_runtime_body(completion.target.facts.position, _now)
                        .is_empty()
                    {
                        self.readiness = ClientSpatialReadiness::Waiting;
                        self.target = None;
                        self.snapshot = None;
                        continue;
                    }

                    self.next_revision = self.next_revision.saturating_add(1);
                    let collision = Arc::new(products.scene);
                    self.snapshot = Some(ClientCollisionSnapshot {
                        player: completion.target.player,
                        revision: self.next_revision,
                        interest: completion.target.interest.clone(),
                        scene: collision,
                    });
                    self.readiness = ClientSpatialReadiness::Ready {
                        player: completion.target.player,
                        interest: completion.target.interest,
                        collision_revision: self.next_revision,
                    };
                    events.push(WorldEvent::RuntimeBodyChanged { body_id });
                }
                Err(cause) => {
                    self.snapshot = None;
                    self.readiness = ClientSpatialReadiness::Unavailable {
                        player: completion.target.player,
                        interest: completion.target.interest,
                        cause,
                    };
                }
            }
        }
        events
    }

    /// Invalidates both products after a teleport/reset or explicit authority replacement.
    pub fn invalidate(&mut self) {
        self.next_generation = self.next_generation.saturating_add(1);
        self.worker.take().inspect(|worker| worker.abort());
        self.target = None;
        self.snapshot = None;
        self.readiness = ClientSpatialReadiness::Waiting;
    }

    pub fn clear(&mut self) {
        if self.target.is_some()
            || self.snapshot.is_some()
            || !matches!(self.readiness, ClientSpatialReadiness::Waiting)
        {
            self.invalidate();
        }
    }

    fn target_from_world(world: &WorldState) -> Option<ClientCollisionTarget> {
        let guid = world.player.guid;
        if guid == Guid::NULL {
            return None;
        }
        let facts = client_player_body_facts(world).ok()?;
        let interest = ClientCollisionInterest::from_position(facts.position)?;
        Some(ClientCollisionTarget {
            player: ClientPlayerInstance {
                guid,
                instance_sequence: facts.instance_sequence,
                residency: facts.position.landblock_id,
            },
            interest,
            facts,
        })
    }

    fn start_loading(&mut self, target: ClientCollisionTarget) {
        self.worker.take().inspect(|worker| worker.abort());
        self.next_generation = self.next_generation.saturating_add(1);
        self.next_request = self.next_request.saturating_add(1);
        let generation = self.next_generation;
        let request = self.next_request;
        let source = Arc::clone(&self.source);
        let completion_tx = self.completion_tx.clone();
        let completion_target = target.clone();
        let worker_target = completion_target.clone();
        self.target = Some(target.clone());
        self.snapshot = None;
        self.readiness = ClientSpatialReadiness::Preparing {
            player: target.player,
            interest: target.interest.clone(),
            request,
        };

        self.worker = Some(tokio::spawn(async move {
            let result = tokio::task::spawn_blocking(move || {
                let mut assets = Vec::with_capacity(worker_target.interest.owners().len());
                for owner in worker_target.interest.owners() {
                    let asset = source
                        .load_collision(owner.0)
                        .with_context(|| format!("could not load collision owner {owner:?}"))?
                        .ok_or_else(|| anyhow!("collision owner {owner:?} is unavailable"))?;
                    assets.push(asset);
                }
                let scene = CollisionScene::new()
                    .staged_residency_change(assets, &[])
                    .context("could not stage client collision scene")?;
                let physical = source
                    .prepare_local_player(worker_target.facts.clone())
                    .context("could not prepare local-player physical body")?;
                Ok::<_, anyhow::Error>(ClientCollisionProducts { scene, physical })
            })
            .await
            .map_err(|error| anyhow!("client collision worker failed: {error}"))
            .and_then(|result| result)
            .map_err(|error| format!("{error:#}"));
            let _ = completion_tx.send(ClientCollisionCompletion {
                generation,
                request,
                target: completion_target,
                result,
            });
        }));
    }
}

fn residency_is_indoors(residency: Guid) -> bool {
    residency.0 & 0xffff >= 0x0100
}

impl Drop for ClientCollisionCoordinator {
    fn drop(&mut self) {
        if let Some(worker) = self.worker.take() {
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

    #[derive(Default)]
    struct FakeSource {
        loaded: Mutex<Vec<u32>>,
        missing: Mutex<Vec<u32>>,
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
        let interest = ClientCollisionInterest::from_position(position(0x0000_0001)).unwrap();
        assert_eq!(
            interest.owners(),
            &[
                Guid(0x0000_ffff),
                Guid(0x0001_ffff),
                Guid(0x0100_ffff),
                Guid(0x0101_ffff),
            ]
        );

        let center = ClientCollisionInterest::from_position(position(0x1234_0100)).unwrap();
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
        predicate: impl Fn(&ClientSpatialReadiness) -> bool,
    ) {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                let _ = coordinator.poll(world, Instant::now());
                if predicate(&coordinator.readiness()) {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("client collision worker did not publish readiness within one second");
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
            matches!(readiness, ClientSpatialReadiness::Ready { player, .. } if player.residency == Guid(0x1235_0001))
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
            matches!(readiness, ClientSpatialReadiness::Unavailable { .. })
        })
        .await;
        assert!(coordinator.snapshot().is_none());
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
        assert_eq!(coordinator.readiness(), ClientSpatialReadiness::Waiting);
        assert!(coordinator.snapshot().is_none());
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
            .strings
            .0
            .remove(&PropertyString::Name);
        assert_eq!(
            client_player_body_facts(&world),
            Err(ClientPlayerBodyFactsError::MissingName)
        );
    }
}
