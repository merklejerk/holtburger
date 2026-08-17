//! Explorer-local dynamic-entity identity, semantic lifetime, and ordered body orchestration.

use std::collections::BTreeMap;
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::{Arc, Mutex};

use anyhow::Context;
use holtburger_common::Guid;
use holtburger_core::{
    DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError,
    DynamicEntityBodyRemovalOutcome, DynamicEntityBodyReplacementOutcome, DynamicEntityDefinition,
    DynamicEntityProjectionInput, dynamic_entity_projection_input_from_body,
};
use holtburger_world::{DynamicPhysicalBodyDefinition, SpatialBodyId};
use holtburger_world::{
    EffectiveEntityPhysicsState, EntityPhysicalIntent, EntityPhysicsTransitionContext,
    EntityPhysicsTransitionDecision, decide_entity_physics_state_transition,
};

use crate::host_simulation_runtime::{HostPhysicalBodyTick, HostSimulationRuntime};

const EXPLORER_GUID_START: u32 = 0xf000_0001;
const EXPLORER_GUID_END: u32 = 0xffff_fffe;

/// Typed rejection from Explorer identity or instance-generation policy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExplorerEntityRuntimeError {
    /// The app-local GUID range has no unallocated identity remaining.
    GuidExhausted,
    /// The monotonic instance-generation counter cannot advance.
    GenerationExhausted,
    /// A new spawn attempted to publish an already-live identity.
    AlreadyRegistered { guid: Guid },
    /// A lifecycle operation named an identity absent from the registry.
    NotRegistered { guid: Guid },
    /// Late work targeted a retired generation of a live identity.
    StaleGeneration {
        guid: Guid,
        expected: u64,
        actual: u64,
    },
    /// The canonical host scene rejected the corresponding body operation.
    Body(DynamicEntityBodyOperationError),
    /// Simulated intent reached publication without a prepared physical definition.
    MissingPreparedPhysics,
    /// Pose-only intent incorrectly carried a physical definition.
    UnexpectedPreparedPhysics,
}

impl Display for ExplorerEntityRuntimeError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::GuidExhausted => {
                formatter.write_str("Explorer dynamic-entity GUID range exhausted")
            }
            Self::GenerationExhausted => {
                formatter.write_str("Explorer dynamic-entity generation counter exhausted")
            }
            Self::AlreadyRegistered { guid } => {
                write!(
                    formatter,
                    "Explorer entity 0x{:08X} is already registered",
                    guid.0
                )
            }
            Self::NotRegistered { guid } => {
                write!(
                    formatter,
                    "Explorer entity 0x{:08X} is not registered",
                    guid.0
                )
            }
            Self::StaleGeneration {
                guid,
                expected,
                actual,
            } => write!(
                formatter,
                "Explorer entity 0x{:08X} generation {expected} is retired; current generation is {actual}",
                guid.0
            ),
            Self::Body(source) => Display::fmt(source, formatter),
            Self::MissingPreparedPhysics => {
                formatter.write_str("simulated Explorer entity requires prepared physics")
            }
            Self::UnexpectedPreparedPhysics => {
                formatter.write_str("pose-only Explorer entity cannot install prepared physics")
            }
        }
    }
}

impl Error for ExplorerEntityRuntimeError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Body(source) => Some(source),
            _ => None,
        }
    }
}

impl From<DynamicEntityBodyOperationError> for ExplorerEntityRuntimeError {
    fn from(value: DynamicEntityBodyOperationError) -> Self {
        Self::Body(value)
    }
}

/// One live Explorer-owned semantic instance generation.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityInstance {
    /// Monotonic composition-local generation guarding late outcomes.
    pub generation: u64,
    /// Producer policy retained independently from current solver participation.
    pub physical_intent: EntityPhysicalIntent,
    /// Current complete source-neutral semantic definition.
    pub definition: DynamicEntityDefinition,
}

/// Semantic/body facts returned only after a new instance is fully publishable.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntitySpawnOutcome {
    /// Newly published semantic instance generation.
    pub instance: ExplorerEntityInstance,
    /// Body facts read after canonical scene installation committed.
    pub body: DynamicEntityBodyCommitOutcome,
}

/// Old/new facts returned after a same-GUID complete replacement commits.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityReplacementOutcome {
    /// Retired semantic generation.
    pub removed: ExplorerEntityInstance,
    /// Newly published semantic generation.
    pub installed: ExplorerEntityInstance,
    /// Canonical old/new body replacement facts.
    pub body: DynamicEntityBodyReplacementOutcome,
}

/// Semantic/body facts returned after one exact generation is despawned.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityDespawnOutcome {
    /// Semantic generation removed from the registry.
    pub instance: ExplorerEntityInstance,
    /// Canonical body facts retired from the host scene.
    pub body: DynamicEntityBodyRemovalOutcome,
}

/// Current semantic/solver join built without copying physical state into the registry.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityProjection {
    /// Current semantic generation guarding consumers against stale work.
    pub generation: u64,
    /// Source-neutral semantic facts joined with the current canonical body view.
    pub input: DynamicEntityProjectionInput,
}

/// One accepted fixed-tick body path paired with its still-current semantic generation.
pub struct ExplorerEntityPhysicalTick {
    /// Current instance generation held stable across the collection transaction.
    pub generation: u64,
    /// Source-neutral semantic/body projection read from the committed body without relocking.
    pub input: DynamicEntityProjectionInput,
    /// Complete accepted solver path and immutable collision snapshot used by the solve.
    pub solved: HostPhysicalBodyTick,
}

/// Committed semantic/body facts from one complete effective-state replacement.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityPhysicsStateOutcome {
    /// Updated current semantic instance; identity generation is unchanged.
    pub instance: ExplorerEntityInstance,
    /// Pure shared transition decision applied to the canonical body.
    pub decision: EntityPhysicsTransitionDecision,
    /// Canonical body facts read after the transition committed.
    pub body: DynamicEntityBodyCommitOutcome,
}

#[derive(Debug, Clone)]
struct ExplorerGuidAllocator {
    start: u32,
    end: u32,
    next: Option<u32>,
}

impl ExplorerGuidAllocator {
    fn new(start: u32, end: u32) -> Self {
        assert!(
            start != 0 && start <= end,
            "Explorer GUID range must be nonempty"
        );
        Self {
            start,
            end,
            next: Some(start),
        }
    }

    fn allocate(&mut self) -> Result<Guid, ExplorerEntityRuntimeError> {
        let value = self.next.ok_or(ExplorerEntityRuntimeError::GuidExhausted)?;
        self.next = (value < self.end).then_some(value + 1);
        Ok(Guid(value))
    }

    fn reset(&mut self) {
        self.next = Some(self.start);
    }
}

/// Explorer's sole semantic authority for live dynamic entities.
///
/// Physical state deliberately does not live here. The outer runtime joins each record with the
/// canonical `HostSimulationRuntime` body only while producing a snapshot or focused outcome.
#[derive(Debug)]
pub struct ExplorerEntityRegistry {
    entities: BTreeMap<Guid, ExplorerEntityInstance>,
    allocator: ExplorerGuidAllocator,
    next_generation: Option<u64>,
}

impl Default for ExplorerEntityRegistry {
    fn default() -> Self {
        Self::with_guid_range(EXPLORER_GUID_START, EXPLORER_GUID_END)
    }
}

impl ExplorerEntityRegistry {
    fn with_guid_range(start: u32, end: u32) -> Self {
        Self {
            entities: BTreeMap::new(),
            allocator: ExplorerGuidAllocator::new(start, end),
            next_generation: Some(1),
        }
    }

    fn allocate_guid(&mut self) -> Result<Guid, ExplorerEntityRuntimeError> {
        self.allocator.allocate()
    }

    fn reserve_generation(&mut self) -> Result<u64, ExplorerEntityRuntimeError> {
        let generation = self
            .next_generation
            .ok_or(ExplorerEntityRuntimeError::GenerationExhausted)?;
        self.next_generation = generation.checked_add(1);
        Ok(generation)
    }

    fn require_absent(&self, guid: Guid) -> Result<(), ExplorerEntityRuntimeError> {
        if self.entities.contains_key(&guid) {
            return Err(ExplorerEntityRuntimeError::AlreadyRegistered { guid });
        }
        Ok(())
    }

    fn require_generation(
        &self,
        guid: Guid,
        expected: u64,
    ) -> Result<&ExplorerEntityInstance, ExplorerEntityRuntimeError> {
        let instance = self
            .entities
            .get(&guid)
            .ok_or(ExplorerEntityRuntimeError::NotRegistered { guid })?;
        if instance.generation != expected {
            return Err(ExplorerEntityRuntimeError::StaleGeneration {
                guid,
                expected,
                actual: instance.generation,
            });
        }
        Ok(instance)
    }

    fn publish(
        &mut self,
        definition: DynamicEntityDefinition,
        physical_intent: EntityPhysicalIntent,
        generation: u64,
    ) -> ExplorerEntityInstance {
        let instance = ExplorerEntityInstance {
            generation,
            physical_intent,
            definition,
        };
        let displaced = self
            .entities
            .insert(instance.definition.identity.guid, instance.clone());
        debug_assert!(
            displaced.is_none(),
            "prevalidated new entity displaced a live record"
        );
        instance
    }

    fn replace(
        &mut self,
        definition: DynamicEntityDefinition,
        physical_intent: EntityPhysicalIntent,
        generation: u64,
    ) -> (ExplorerEntityInstance, ExplorerEntityInstance) {
        let guid = definition.identity.guid;
        let installed = ExplorerEntityInstance {
            generation,
            physical_intent,
            definition,
        };
        let removed = self
            .entities
            .insert(guid, installed.clone())
            .expect("prevalidated replacement entity vanished while registry lock was held");
        (removed, installed)
    }

    fn remove(&mut self, guid: Guid) -> ExplorerEntityInstance {
        self.entities
            .remove(&guid)
            .expect("prevalidated entity vanished while registry lock was held")
    }

    fn reset(&mut self) -> Vec<ExplorerEntityInstance> {
        let removed = std::mem::take(&mut self.entities).into_values().collect();
        self.allocator.reset();
        removed
    }
}

/// Ordered Explorer composition joining its semantic registry to its distinct host body scene.
pub struct ExplorerEntityRuntime {
    // Every operation acquires this registry lock before entering the simulation runtime. The
    // collection tick holds it across one simulation transaction, so instance generations cannot
    // retire between solve acceptance and projection and no callback inverts the lock order.
    registry: Mutex<ExplorerEntityRegistry>,
    simulation: Arc<HostSimulationRuntime>,
}

impl ExplorerEntityRuntime {
    /// Composes an empty Explorer registry over the app's canonical host simulation runtime.
    pub fn new(simulation: Arc<HostSimulationRuntime>) -> Self {
        Self {
            registry: Mutex::new(ExplorerEntityRegistry::default()),
            simulation,
        }
    }

    #[cfg(test)]
    fn with_guid_range(simulation: Arc<HostSimulationRuntime>, start: u32, end: u32) -> Self {
        Self {
            registry: Mutex::new(ExplorerEntityRegistry::with_guid_range(start, end)),
            simulation,
        }
    }

    /// Reserves one producer identity before content/definition preparation begins.
    ///
    /// Failed preparation may leave a harmless identity gap; it never publishes semantic state.
    pub fn reserve_guid(&self) -> Result<Guid, ExplorerEntityRuntimeError> {
        self.registry
            .lock()
            .expect("Explorer entity registry lock poisoned")
            .allocate_guid()
    }

    /// Installs a fully prepared body and publishes semantics only after installation succeeds.
    pub fn spawn_prepared(
        &self,
        definition: DynamicEntityDefinition,
        physical_intent: EntityPhysicalIntent,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntitySpawnOutcome, ExplorerEntityRuntimeError> {
        validate_prepared_intent(physical_intent, physical.is_some())?;
        let guid = definition.identity.guid;
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.require_absent(guid)?;
        let generation = registry.reserve_generation()?;
        let body = self
            .simulation
            .install_dynamic_entity(&definition, physical)?;
        let instance = registry.publish(definition, physical_intent, generation);
        Ok(ExplorerEntitySpawnOutcome { instance, body })
    }

    /// Replaces one exact live generation and rejects late work before touching its body.
    pub fn replace_prepared(
        &self,
        definition: DynamicEntityDefinition,
        expected_generation: u64,
        physical_intent: EntityPhysicalIntent,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntityReplacementOutcome, ExplorerEntityRuntimeError> {
        validate_prepared_intent(physical_intent, physical.is_some())?;
        let guid = definition.identity.guid;
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.require_generation(guid, expected_generation)?;
        let generation = registry.reserve_generation()?;
        let body = self
            .simulation
            .replace_dynamic_entity(&definition, physical)?;
        let (removed, installed) = registry.replace(definition, physical_intent, generation);
        Ok(ExplorerEntityReplacementOutcome {
            removed,
            installed,
            body,
        })
    }

    /// Removes one exact live generation from body and semantic authority exactly once.
    pub fn despawn(
        &self,
        guid: Guid,
        expected_generation: u64,
    ) -> Result<ExplorerEntityDespawnOutcome, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.require_generation(guid, expected_generation)?;
        let body = self
            .simulation
            .remove_dynamic_entity(SpatialBodyId::Entity(guid))?;
        let instance = registry.remove(guid);
        Ok(ExplorerEntityDespawnOutcome { instance, body })
    }

    /// Applies a complete effective-state replacement without replacing semantic identity.
    pub fn replace_physics_state(
        &self,
        guid: Guid,
        expected_generation: u64,
        next: EffectiveEntityPhysicsState,
        next_intent: EntityPhysicalIntent,
        replacement: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntityPhysicsStateOutcome, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        let decision = transition_decision(
            &self.simulation,
            instance,
            next,
            next_intent,
            replacement.is_some(),
        )?;
        validate_transition_replacement(decision.action, replacement.is_some())?;
        let outcome = self.simulation.apply_dynamic_entity_physics(
            SpatialBodyId::Entity(guid),
            decision,
            replacement,
        )?;
        let current = registry
            .entities
            .get_mut(&guid)
            .expect("prevalidated entity vanished while registry lock was held");
        current.definition.physics = next;
        current.physical_intent = next_intent;
        Ok(ExplorerEntityPhysicsStateOutcome {
            instance: current.clone(),
            decision,
            body: outcome,
        })
    }

    /// Preflights the exact shared state-transition action before content preparation.
    pub fn plan_physics_state(
        &self,
        guid: Guid,
        expected_generation: u64,
        next: EffectiveEntityPhysicsState,
        next_intent: EntityPhysicalIntent,
    ) -> Result<EntityPhysicsTransitionDecision, ExplorerEntityRuntimeError> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        transition_decision(&self.simulation, instance, next, next_intent, true)
    }

    /// Returns one exact semantic generation without joining or copying solver state.
    pub fn instance(
        &self,
        guid: Guid,
        expected_generation: u64,
    ) -> Result<ExplorerEntityInstance, ExplorerEntityRuntimeError> {
        self.registry
            .lock()
            .expect("Explorer entity registry lock poisoned")
            .require_generation(guid, expected_generation)
            .cloned()
    }

    /// Removes every live generation and resets GUID allocation without reusing generations.
    pub fn reset(&self) -> Result<Vec<ExplorerEntityInstance>, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let body_ids = registry
            .entities
            .keys()
            .copied()
            .map(SpatialBodyId::Entity)
            .collect::<Vec<_>>();
        self.simulation.remove_dynamic_entities(&body_ids)?;
        Ok(registry.reset())
    }

    /// Builds one current semantic/body join while the instance generation remains stable.
    pub fn project(
        &self,
        guid: Guid,
    ) -> Result<ExplorerEntityProjection, ExplorerEntityRuntimeError> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry
            .entities
            .get(&guid)
            .ok_or(ExplorerEntityRuntimeError::NotRegistered { guid })?;
        let input = self
            .simulation
            .project_dynamic_entity(&instance.definition)?;
        Ok(ExplorerEntityProjection {
            generation: instance.generation,
            input,
        })
    }

    /// Builds a deterministic current snapshot without retaining solver state in the registry.
    pub fn snapshot(&self) -> Result<Vec<ExplorerEntityProjection>, ExplorerEntityRuntimeError> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry
            .entities
            .values()
            .map(|instance| {
                Ok(ExplorerEntityProjection {
                    generation: instance.generation,
                    input: self
                        .simulation
                        .project_dynamic_entity(&instance.definition)?,
                })
            })
            .collect()
    }

    /// Advances every eligible physical instance in one generation-stable collection transaction.
    ///
    /// Only frontend-relevant body/path changes leave this boundary. Stable entities still remain
    /// in the scene-owned scan; Phase 5A may skip their integration without a second active set.
    pub fn tick_physical_collection(
        &self,
        delta_seconds: f32,
        now: std::time::Instant,
    ) -> anyhow::Result<Vec<ExplorerEntityPhysicalTick>> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        self.simulation
            .tick_dynamic_entity_collection(delta_seconds, now)?
            .into_iter()
            .filter(physical_tick_changed)
            .map(|solved| {
                let SpatialBodyId::Entity(guid) = solved.current.id else {
                    anyhow::bail!("dynamic-entity collection returned a non-entity body")
                };
                let instance = registry.entities.get(&guid).with_context(|| {
                    format!(
                        "dynamic-entity body 0x{:08X} has no Explorer semantic instance",
                        guid.0
                    )
                })?;
                let input = dynamic_entity_projection_input_from_body(
                    &instance.definition,
                    &solved.current,
                )?;
                Ok(ExplorerEntityPhysicalTick {
                    generation: instance.generation,
                    input,
                    solved,
                })
            })
            .collect()
    }

    /// Tests whether an asynchronous outcome still targets the current live generation.
    pub fn is_current(&self, guid: Guid, generation: u64) -> bool {
        self.registry
            .lock()
            .expect("Explorer entity registry lock poisoned")
            .entities
            .get(&guid)
            .is_some_and(|instance| instance.generation == generation)
    }
}

fn physical_tick_changed(tick: &HostPhysicalBodyTick) -> bool {
    tick.previous.runtime_view() != tick.current.runtime_view()
        || tick
            .result
            .motion
            .path
            .legs()
            .iter()
            .any(|leg| leg.end() != tick.result.motion.path.initial())
}

fn validate_prepared_intent(
    intent: EntityPhysicalIntent,
    has_physical: bool,
) -> Result<(), ExplorerEntityRuntimeError> {
    match (intent, has_physical) {
        (EntityPhysicalIntent::Simulated, false) => {
            Err(ExplorerEntityRuntimeError::MissingPreparedPhysics)
        }
        (EntityPhysicalIntent::PoseOnly, true) => {
            Err(ExplorerEntityRuntimeError::UnexpectedPreparedPhysics)
        }
        _ => Ok(()),
    }
}

fn transition_decision(
    simulation: &HostSimulationRuntime,
    instance: &ExplorerEntityInstance,
    next: EffectiveEntityPhysicsState,
    next_intent: EntityPhysicalIntent,
    prepared_physics_available: bool,
) -> Result<EntityPhysicsTransitionDecision, ExplorerEntityRuntimeError> {
    let projection = simulation.project_dynamic_entity(&instance.definition)?;
    let physical_body_attached = matches!(
        projection.participation,
        holtburger_world::PhysicalBodyParticipation::Physical
    );
    Ok(decide_entity_physics_state_transition(
        Some(instance.definition.physics),
        next,
        EntityPhysicsTransitionContext {
            intent: next_intent,
            prepared_physics_available: prepared_physics_available || physical_body_attached,
            physical_body_attached,
            prepared_definition_changed: false,
        },
    ))
}

fn validate_transition_replacement(
    action: holtburger_world::EntityPhysicalTransitionAction,
    has_replacement: bool,
) -> Result<(), ExplorerEntityRuntimeError> {
    use holtburger_world::EntityPhysicalTransitionAction::{Attach, Reconfigure};
    match (matches!(action, Attach | Reconfigure), has_replacement) {
        (true, false) => Err(ExplorerEntityRuntimeError::MissingPreparedPhysics),
        (false, true) => Err(ExplorerEntityRuntimeError::UnexpectedPreparedPhysics),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Result;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PhysicsState, WeenieType};
    use holtburger_common::{Quaternion, Sphere, Vector3};
    use holtburger_content::{ColliderScale, LandblockCollisionAsset};
    use holtburger_core::{
        DynamicEntityContent, DynamicEntityDefinitionInput, DynamicEntityIdentity,
        DynamicEntityInitialState,
    };
    use holtburger_world::{
        DynamicBodyCollisionDefinition, EdgeProtection, EntityAppearance,
        EntityCollisionParticipation, EntityCollisionReportPolicy, EntityDynamicCollisionPolicy,
        EntityPhysicsScheduling, PhysicalBodyParticipation, PhysicalBodyResponsePolicy,
        PhysicalElasticity, PhysicalFriction, PhysicalRestitution, PhysicalSphereSet,
        PhysicalSurfaceMotion, PreparedEntityTargetGeometry,
        resolve_effective_entity_physics_state,
    };
    use std::time::Instant;

    #[derive(Default)]
    struct EmptyCollisionSource;

    impl crate::host_simulation_runtime::CollisionSource for EmptyCollisionSource {
        fn load_collision(&self, _landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            Ok(None)
        }
    }

    fn runtime(start: u32, end: u32) -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime) {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let runtime = ExplorerEntityRuntime::with_guid_range(Arc::clone(&simulation), start, end);
        (simulation, runtime)
    }

    fn definition(guid: Guid, wcid: u32, x: f32) -> DynamicEntityDefinition {
        DynamicEntityDefinition::prepare(DynamicEntityDefinitionInput {
            identity: DynamicEntityIdentity {
                guid,
                wcid,
                name: format!("WCID {wcid}"),
                weenie_type: WeenieType::Creature,
            },
            content: DynamicEntityContent {
                setup_did: 0x0200_0001,
                motion_table_did: None,
                sound_table_did: None,
                physics_effect_table_did: None,
            },
            appearance: EntityAppearance::default(),
            initial: DynamicEntityInitialState {
                pose: WorldPosition {
                    landblock_id: Guid(0xda55_0001),
                    coords: Vector3::new(x, 0.0, 0.0),
                    rotation: Quaternion::identity(),
                },
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
                created_at: Instant::now(),
            },
            object_scale: 1.0,
            friction: None,
            elasticity: None,
            maximum_velocity: None,
            rotation_speed: None,
            physics: resolve_effective_entity_physics_state(PhysicsState::GRAVITY),
        })
        .unwrap()
    }

    fn physical() -> DynamicPhysicalBodyDefinition {
        let response_policy = PhysicalBodyResponsePolicy {
            restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
            friction: PhysicalFriction::DEFAULT,
            surface_motion: PhysicalSurfaceMotion::Stable,
            align_path: false,
        };
        let movement = holtburger_core::retail_grounded_body_with_policy(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::new(0.0, 0.0, 0.5),
                    radius: 0.5,
                },
                None,
            )
            .unwrap(),
            EdgeProtection::Creature,
            -9.8,
            response_policy,
        )
        .unwrap()
        .definition;
        DynamicPhysicalBodyDefinition {
            movement,
            response_policy,
            entity_collision: DynamicBodyCollisionDefinition {
                target_geometry: PreparedEntityTargetGeometry {
                    physics_bsp_parts: Vec::new(),
                    fallback_setup_did: 0x0200_0001,
                    fallback_shapes: Vec::new(),
                    fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                },
                scheduling: EntityPhysicsScheduling::Eligible,
                dynamic_collision: EntityDynamicCollisionPolicy {
                    target: EntityCollisionParticipation::Solid,
                    mover_accepts_response: true,
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
        }
    }

    #[test]
    fn guid_allocator_is_bounded_and_resettable() {
        let (_simulation, runtime) = runtime(0xf000_0001, 0xf000_0002);
        assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0001));
        assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0002));
        assert_eq!(
            runtime.reserve_guid(),
            Err(ExplorerEntityRuntimeError::GuidExhausted)
        );
        runtime.reset().unwrap();
        assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0001));
    }

    #[test]
    fn repeated_same_wcid_spawns_have_independent_identity_and_optional_physics() {
        let (_simulation, runtime) = runtime(0xf000_0010, 0xf000_0011);
        let first_guid = runtime.reserve_guid().unwrap();
        let second_guid = runtime.reserve_guid().unwrap();
        let first = runtime
            .spawn_prepared(
                definition(first_guid, 42, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();
        let second = runtime
            .spawn_prepared(
                definition(second_guid, 42, 2.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();

        assert_ne!(
            first.instance.definition.identity.guid,
            second.instance.definition.identity.guid
        );
        assert_eq!(
            first.instance.definition.identity.wcid,
            second.instance.definition.identity.wcid
        );
        assert_eq!(
            first.body.participation,
            PhysicalBodyParticipation::PoseOnly
        );
        assert_eq!(
            second.body.participation,
            PhysicalBodyParticipation::Physical
        );
        assert_eq!(runtime.snapshot().unwrap().len(), 2);
    }

    #[test]
    fn collection_tick_visits_only_eligible_physical_instances_in_guid_order() {
        let (_simulation, runtime) = runtime(0xf000_0100, 0xf000_0103);
        let pose_only_guid = runtime.reserve_guid().unwrap();
        let frozen_guid = runtime.reserve_guid().unwrap();
        let first_active_guid = runtime.reserve_guid().unwrap();
        let second_active_guid = runtime.reserve_guid().unwrap();
        runtime
            .spawn_prepared(
                definition(pose_only_guid, 1, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();

        let mut frozen_definition = definition(frozen_guid, 2, 1.0);
        frozen_definition.physics =
            resolve_effective_entity_physics_state(PhysicsState::GRAVITY | PhysicsState::FROZEN);
        let mut frozen_physical = physical();
        frozen_physical.entity_collision.scheduling = EntityPhysicsScheduling::Frozen;
        runtime
            .spawn_prepared(
                frozen_definition,
                EntityPhysicalIntent::Simulated,
                Some(frozen_physical),
            )
            .unwrap();
        let first = runtime
            .spawn_prepared(
                definition(first_active_guid, 3, 2.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let second = runtime
            .spawn_prepared(
                definition(second_active_guid, 4, 3.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();

        let ticks = runtime
            .tick_physical_collection(1.0 / 30.0, Instant::now())
            .unwrap();

        assert_eq!(
            ticks
                .iter()
                .map(|tick| (tick.input.identity.guid, tick.generation))
                .collect::<Vec<_>>(),
            [
                (first_active_guid, first.instance.generation),
                (second_active_guid, second.instance.generation),
            ]
        );
        assert!(ticks.iter().all(|tick| {
            tick.solved.result.motion.path.anchor() == Guid(0xda55_ffff)
                && tick.solved.result.motion.path.legs().last().is_some()
        }));
    }

    #[test]
    fn failed_body_install_publishes_no_semantic_record() {
        let (simulation, runtime) = runtime(0xf000_0020, 0xf000_0020);
        let guid = runtime.reserve_guid().unwrap();
        let definition = definition(guid, 7, 0.0);
        simulation
            .install_dynamic_entity(&definition, None)
            .unwrap();

        assert_eq!(
            runtime.spawn_prepared(definition, EntityPhysicalIntent::PoseOnly, None),
            Err(ExplorerEntityRuntimeError::Body(
                DynamicEntityBodyOperationError::AlreadyRegistered {
                    body_id: SpatialBodyId::Entity(guid)
                }
            ))
        );
        assert_eq!(
            runtime.project(guid),
            Err(ExplorerEntityRuntimeError::NotRegistered { guid })
        );
    }

    #[test]
    fn replacement_retires_one_generation_and_late_work_cannot_touch_the_successor() {
        let (_simulation, runtime) = runtime(0xf000_0030, 0xf000_0030);
        let guid = runtime.reserve_guid().unwrap();
        let first = runtime
            .spawn_prepared(
                definition(guid, 8, 0.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let replacement = runtime
            .replace_prepared(
                definition(guid, 9, 5.0),
                first.instance.generation,
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();

        assert_eq!(replacement.removed, first.instance);
        assert!(replacement.installed.generation > replacement.removed.generation);
        assert_eq!(
            replacement.body.installed.participation,
            PhysicalBodyParticipation::PoseOnly
        );
        assert!(!runtime.is_current(guid, first.instance.generation));
        assert_eq!(
            runtime
                .project(guid)
                .unwrap()
                .input
                .body
                .runtime_pose
                .coords
                .x,
            5.0
        );

        let stale = runtime
            .replace_prepared(
                definition(guid, 10, 9.0),
                first.instance.generation,
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap_err();
        assert_eq!(
            stale,
            ExplorerEntityRuntimeError::StaleGeneration {
                guid,
                expected: first.instance.generation,
                actual: replacement.installed.generation,
            }
        );
        assert_eq!(runtime.project(guid).unwrap().input.identity.wcid, 9);
    }

    #[test]
    fn despawn_and_reset_remove_each_body_once_without_reusing_generations() {
        let (_simulation, runtime) = runtime(0xf000_0040, 0xf000_0041);
        let first_guid = runtime.reserve_guid().unwrap();
        let first = runtime
            .spawn_prepared(
                definition(first_guid, 11, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();
        let despawned = runtime
            .despawn(first_guid, first.instance.generation)
            .unwrap();
        assert_eq!(despawned.instance, first.instance);
        assert_eq!(
            runtime.despawn(first_guid, first.instance.generation),
            Err(ExplorerEntityRuntimeError::NotRegistered { guid: first_guid })
        );

        let second_guid = runtime.reserve_guid().unwrap();
        let second = runtime
            .spawn_prepared(
                definition(second_guid, 12, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();
        assert_eq!(runtime.reset().unwrap(), vec![second.instance.clone()]);
        assert!(runtime.snapshot().unwrap().is_empty());
        assert_eq!(runtime.reserve_guid().unwrap(), Guid(0xf000_0040));
        let after_reset = runtime
            .spawn_prepared(
                definition(Guid(0xf000_0040), 13, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
            )
            .unwrap();
        assert!(after_reset.instance.generation > second.instance.generation);
    }
}
