//! Explorer-local dynamic-entity identity, semantic lifetime, and ordered body orchestration.

use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::{Arc, Mutex};

use anyhow::Context;
use holtburger_common::Guid;
use holtburger_content::MotionSequenceCatalog;
use holtburger_core::{
    DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError,
    DynamicEntityBodyRemovalOutcome, DynamicEntityBodyReplacementOutcome, DynamicEntityDefinition,
    DynamicEntityInitialState, DynamicEntityLaunchPlan, DynamicEntityProjectionInput,
    dynamic_entity_projection_input_from_body,
};
use holtburger_world::motion::{
    MotionOrder, MotionRuntimeRegistry, PlayingMotionClip, authored_grounded_actuation,
};
use holtburger_world::{
    CollisionReportOutcome, DynamicPhysicalBodyDefinition, RuntimeSpatialBodyView, SpatialBody,
    SpatialBodyId,
};
use holtburger_world::{
    EffectiveEntityPhysicsState, EntityPhysicalIntent, EntityPhysicsTransitionContext,
    EntityPhysicsTransitionDecision, EntityPlacement, decide_entity_physics_state_transition,
    resolve_effective_entity_physics_state,
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
    /// A world-motion operation targeted an attached child at the untyped GUID boundary.
    AttachedOperation {
        guid: Guid,
        parent: Guid,
        /// Noun phrase naming the refused operation, e.g. `"independent despawn"`.
        operation: &'static str,
    },
    /// A published child's own attachment named a wearer other than the group it arrived in.
    ChildWearerMismatch {
        guid: Guid,
        /// Wearer whose group the child was published under.
        expected_parent: Guid,
        /// Wearer the child's own attachment names.
        declared_parent: Guid,
    },
    /// A published child carried world placement where the group requires an attachment.
    ChildNotAttached { guid: Guid, parent: Guid },
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
            Self::AttachedOperation {
                guid,
                parent,
                operation,
            } => write!(
                formatter,
                "{operation} is not available for Explorer entity 0x{:08X}; it is attached to wearer 0x{:08X}",
                guid.0, parent.0
            ),
            Self::ChildWearerMismatch {
                guid,
                expected_parent,
                declared_parent,
            } => write!(
                formatter,
                "Explorer child 0x{:08X} declares wearer 0x{:08X}, but was published under wearer 0x{:08X}",
                guid.0, declared_parent.0, expected_parent.0
            ),
            Self::ChildNotAttached { guid, parent } => write!(
                formatter,
                "Explorer child 0x{:08X} published under wearer 0x{:08X} carries world placement instead of an attachment",
                guid.0, parent.0
            ),
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
    /// Attached child generations published in the same registry transaction.
    pub children: Vec<ExplorerEntityInstance>,
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
    /// Attached child generations retired with the old wearer.
    pub removed_children: Vec<ExplorerEntityInstance>,
    /// Attached child generations published with the successor wearer.
    pub installed_children: Vec<ExplorerEntityInstance>,
}

/// Semantic/body facts returned after one exact generation is despawned.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityDespawnOutcome {
    /// Semantic generation removed from the registry.
    pub instance: ExplorerEntityInstance,
    /// Canonical body facts retired from the host scene.
    pub body: DynamicEntityBodyRemovalOutcome,
    /// Attached child generations retired in the same registry transaction.
    pub children: Vec<ExplorerEntityInstance>,
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
    /// Clip this entity started playing on this tick, present only when it changed.
    pub clip: Option<holtburger_world::motion::PlayingMotionClip>,
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

/// Current semantic/body facts after one exact-generation launch commits.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityLaunchOutcome {
    /// Updated current semantic instance; launch does not replace its generation.
    pub instance: ExplorerEntityInstance,
    /// Canonical body view after live kinematics and response memory were replaced.
    pub body: RuntimeSpatialBodyView,
}

/// Current semantic/body facts after one discontinuous exact-generation relocation.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerEntityRelocationOutcome {
    /// Unchanged current semantic generation.
    pub instance: ExplorerEntityInstance,
    /// Canonical relocated body with pose-dependent state cleared.
    pub body: RuntimeSpatialBodyView,
    /// Forced report ends returned to the composition but never relayed to the Explorer frontend.
    pub collision_reports: Vec<CollisionReportOutcome>,
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
    /// Authored-motion playback and possession.
    ///
    /// Kept inside the registry rather than beside it so one lock covers both: the collection tick
    /// holds the registry across a whole simulation transaction, and a second lock would invite an
    /// ordering bug for no benefit. This is also the plan's rule — producer registries retain
    /// semantic state — and it is what keeps the Explorer and the client separate authorities over
    /// the same shared contract.
    motion: ExplorerMotionState,
}

/// Which entity is being driven, what it has been told to do, and where its playback is.
#[derive(Debug, Default)]
struct ExplorerMotionState {
    playback: MotionRuntimeRegistry,
    /// Entity currently receiving commands, if any. One at a time: the Explorer possesses, it does
    /// not command a fleet.
    possessed: Option<Guid>,
    /// Newest order the frontend issued. Reapplied every tick, which is what makes it idempotent —
    /// re-issuing the motion already running is a no-op selection.
    order: MotionOrder,
    /// Clip each body was last published as playing, so only changes are republished.
    playing: BTreeMap<Guid, PlayingMotionClip>,
}

impl ExplorerMotionState {
    /// Clips that changed since the previous call, drained so each change publishes once.
    ///
    /// Tracking the previous clip here rather than making the receiver diff keeps "a projection
    /// arrived" and "the clip changed" the same event.
    fn take_changed_clips(&mut self, live: &BTreeSet<Guid>) -> BTreeMap<Guid, PlayingMotionClip> {
        self.playing.retain(|guid, _| live.contains(guid));
        let mut changed = BTreeMap::new();
        for guid in live {
            let Some(clip) = self.playback.playing_clip(*guid) else {
                self.playing.remove(guid);
                continue;
            };
            if self.playing.insert(*guid, clip) != Some(clip) {
                changed.insert(*guid, clip);
            }
        }
        changed
    }

    fn release(&mut self) {
        if let Some(guid) = self.possessed.take() {
            self.playback.forget(guid);
        }
        self.order = MotionOrder::default();
    }
}

/// What possessing an entity told the caller about it.
#[derive(Debug, Clone, PartialEq)]
pub struct ExplorerPossession {
    pub guid: Guid,
    /// Table the entity animates from, absent when neither it nor its setup declares one.
    pub motion_table_id: Option<u32>,
    /// Locomotion commands this entity's table actually models, in a stable order.
    ///
    /// Read from the contract rather than assumed, because a door and a creature model different
    /// sets and the UX should refuse what the table cannot do before the command is issued.
    pub modelled_commands: Vec<u32>,
}

/// One tick's authored drive for the possessed entity.
struct PossessedDrive {
    guid: Guid,
    offset: holtburger_common::RigidTransform,
    object_scale: f32,
}

impl PossessedDrive {
    /// Builds the actuation, falling back to coasting for a body the authored path cannot drive.
    ///
    /// Only grounded bodies take authored drive: a free-sphere body is ballistic and has no support
    /// to gate translation against, which is retail's own rule rather than a simplification.
    fn actuation(
        &self,
        body: &SpatialBody,
        delta_seconds: f32,
    ) -> anyhow::Result<holtburger_world::PhysicalBodyActuation> {
        let grounded = body.physical.as_ref().is_some_and(|physical| {
            matches!(
                physical.definition,
                holtburger_world::PhysicalBodyDefinition::Grounded { .. }
            )
        });
        if !grounded {
            return crate::host_simulation_runtime::dynamic_entity_coasting_actuation(
                body,
                delta_seconds,
            );
        }
        Ok(authored_grounded_actuation(
            self.offset,
            body.pose,
            body.contact,
            self.object_scale,
            delta_seconds,
        )?)
    }
}

/// Locomotion commands a table models, in a stable order for a UX to render.
fn modelled_commands(table: &holtburger_content::MotionSequenceTable) -> Vec<u32> {
    const LOCOMOTION: [u32; 7] = [
        0x4500_0005, // walk forward
        0x4500_0006, // walk backwards
        0x4400_0007, // run forward
        0x6500_000D, // turn right
        0x6500_000E, // turn left
        0x6500_000F, // sidestep right
        0x6500_0010, // sidestep left
    ];
    let style = table.default_style;
    LOCOMOTION
        .into_iter()
        .filter(|command| {
            table.cycle(style, *command).is_some() || table.modifier(style, *command).is_some()
        })
        .collect()
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
            motion: ExplorerMotionState::default(),
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
    /// Shared motion contract, projected once at startup and read by every possession.
    motion_catalog: Arc<MotionSequenceCatalog>,
}

impl ExplorerEntityRuntime {
    /// Composes an empty Explorer registry over the app's canonical host simulation runtime.
    pub fn new(
        simulation: Arc<HostSimulationRuntime>,
        motion_catalog: Arc<MotionSequenceCatalog>,
    ) -> Self {
        Self {
            registry: Mutex::new(ExplorerEntityRegistry::default()),
            simulation,
            motion_catalog,
        }
    }

    #[cfg(test)]
    fn with_guid_range(simulation: Arc<HostSimulationRuntime>, start: u32, end: u32) -> Self {
        Self::with_guid_range_and_motion(simulation, start, end, Default::default())
    }

    #[cfg(test)]
    fn with_guid_range_and_motion(
        simulation: Arc<HostSimulationRuntime>,
        start: u32,
        end: u32,
        motion_catalog: Arc<MotionSequenceCatalog>,
    ) -> Self {
        Self {
            registry: Mutex::new(ExplorerEntityRegistry::with_guid_range(start, end)),
            simulation,
            motion_catalog,
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
        self.spawn_prepared_group(definition, physical_intent, physical, Vec::new())
    }

    /// Installs one world-placed wearer and publishes its bodyless attached children atomically.
    pub fn spawn_prepared_group(
        &self,
        definition: DynamicEntityDefinition,
        physical_intent: EntityPhysicalIntent,
        physical: Option<DynamicPhysicalBodyDefinition>,
        children: Vec<DynamicEntityDefinition>,
    ) -> Result<ExplorerEntitySpawnOutcome, ExplorerEntityRuntimeError> {
        validate_prepared_intent(physical_intent, physical.is_some())?;
        let guid = definition.identity.guid;
        validate_attached_children(guid, &children)?;
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.require_absent(guid)?;
        for child in &children {
            registry.require_absent(child.identity.guid)?;
        }
        let generation = registry.reserve_generation()?;
        let child_generations = children
            .iter()
            .map(|_| registry.reserve_generation())
            .collect::<Result<Vec<_>, _>>()?;
        let initial = require_world_initial(&definition, "spawn")?;
        let body = self
            .simulation
            .install_dynamic_entity(&definition, initial, physical)?;
        let instance = registry.publish(definition, physical_intent, generation);
        let children = children
            .into_iter()
            .zip(child_generations)
            .map(|(child, generation)| {
                registry.publish(child, EntityPhysicalIntent::PoseOnly, generation)
            })
            .collect();
        Ok(ExplorerEntitySpawnOutcome {
            instance,
            body,
            children,
        })
    }

    /// Replaces one exact live generation and rejects late work before touching its body.
    pub fn replace_prepared(
        &self,
        definition: DynamicEntityDefinition,
        expected_generation: u64,
        physical_intent: EntityPhysicalIntent,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntityReplacementOutcome, ExplorerEntityRuntimeError> {
        self.replace_prepared_group(
            definition,
            expected_generation,
            physical_intent,
            physical,
            Vec::new(),
        )
    }

    /// Replaces one wearer and cleanly cuts over its complete attached-child set.
    pub fn replace_prepared_group(
        &self,
        definition: DynamicEntityDefinition,
        expected_generation: u64,
        physical_intent: EntityPhysicalIntent,
        physical: Option<DynamicPhysicalBodyDefinition>,
        children: Vec<DynamicEntityDefinition>,
    ) -> Result<ExplorerEntityReplacementOutcome, ExplorerEntityRuntimeError> {
        validate_prepared_intent(physical_intent, physical.is_some())?;
        let guid = definition.identity.guid;
        validate_attached_children(guid, &children)?;
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.require_generation(guid, expected_generation)?;
        for child in &children {
            registry.require_absent(child.identity.guid)?;
        }
        let removed_child_guids = child_guids(&registry, guid);
        let generation = registry.reserve_generation()?;
        let child_generations = children
            .iter()
            .map(|_| registry.reserve_generation())
            .collect::<Result<Vec<_>, _>>()?;
        let initial = require_world_initial(&definition, "replacement")?;
        let body = self
            .simulation
            .replace_dynamic_entity(&definition, initial, physical)?;
        let (removed, installed) = registry.replace(definition, physical_intent, generation);
        let removed_children = removed_child_guids
            .into_iter()
            .map(|child| registry.remove(child))
            .collect();
        let installed_children = children
            .into_iter()
            .zip(child_generations)
            .map(|(child, generation)| {
                registry.publish(child, EntityPhysicalIntent::PoseOnly, generation)
            })
            .collect();
        Ok(ExplorerEntityReplacementOutcome {
            removed,
            installed,
            body,
            removed_children,
            installed_children,
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
        let current = registry.require_generation(guid, expected_generation)?;
        require_world_initial(&current.definition, "independent despawn")?;
        let children = child_guids(&registry, guid);
        let body = self
            .simulation
            .remove_dynamic_entity(SpatialBodyId::Entity(guid))?;
        let children = children
            .into_iter()
            .map(|child| registry.remove(child))
            .collect();
        let instance = registry.remove(guid);
        Ok(ExplorerEntityDespawnOutcome {
            instance,
            body,
            children,
        })
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
            "physics-state replacement",
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

    /// Applies one resolved launch while the exact semantic generation remains stable.
    pub fn launch(
        &self,
        guid: Guid,
        expected_generation: u64,
        launch: DynamicEntityLaunchPlan,
        now: std::time::Instant,
    ) -> Result<ExplorerEntityLaunchOutcome, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        require_world_initial(&instance.definition, "launch")?;
        let body = self.simulation.apply_dynamic_entity_kinematics(
            SpatialBodyId::Entity(guid),
            launch.kinematics,
            now,
        )?;
        let current = registry
            .entities
            .get_mut(&guid)
            .expect("prevalidated entity vanished while registry lock was held");
        current.definition.physics = launch.physics;
        Ok(ExplorerEntityLaunchOutcome {
            instance: current.clone(),
            body,
        })
    }

    /// Relocates one exact semantic generation without replacing its identity.
    pub fn relocate(
        &self,
        guid: Guid,
        expected_generation: u64,
        pose: holtburger_common::position::WorldPosition,
        now: std::time::Instant,
    ) -> Result<ExplorerEntityRelocationOutcome, ExplorerEntityRuntimeError> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        require_world_initial(&instance.definition, "relocation")?;
        let relocation =
            self.simulation
                .relocate_dynamic_entity(SpatialBodyId::Entity(guid), pose, now)?;
        Ok(ExplorerEntityRelocationOutcome {
            instance: instance.clone(),
            body: relocation.body,
            collision_reports: relocation.collision_reports,
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
        transition_decision(
            &self.simulation,
            instance,
            next,
            next_intent,
            true,
            "physics-state planning",
        )
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
            .values()
            .filter(|instance| instance.definition.placement.world().is_some())
            .map(|instance| SpatialBodyId::Entity(instance.definition.identity.guid))
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
    /// Possesses one spawned entity, so commands and the follow camera target it.
    ///
    /// Possession is exclusive: taking a new entity releases the previous one and discards its
    /// playback, because a cursor means nothing once nothing is driving it.
    pub fn possess(&self, guid: Guid) -> Result<ExplorerPossession, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry
            .entities
            .get(&guid)
            .ok_or(ExplorerEntityRuntimeError::NotRegistered { guid })?;
        let motion_table_id = self.motion_table_for(&instance.definition);

        registry.motion.release();
        registry.motion.possessed = Some(guid);

        Ok(ExplorerPossession {
            guid,
            motion_table_id,
            modelled_commands: motion_table_id
                .and_then(|id| self.motion_catalog.table(id))
                .map(modelled_commands)
                .unwrap_or_default(),
        })
    }

    /// Releases whatever is possessed, leaving the entity in the world under its own physics.
    ///
    /// The released entity's planar velocity is cleared. Authored drive is per-tick and is not
    /// momentum, so once authorship ends there is nothing for the horizontal motion to have come
    /// from; leaving it would let a walk cycle coast on after the command that produced it. Vertical
    /// velocity survives, because falling is real physical momentum the authored path never wrote.
    pub fn release_possession(&self, now: std::time::Instant) -> Option<Guid> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let released = registry.motion.possessed;
        registry.motion.release();

        if let Some(guid) = released {
            self.clear_authored_momentum(SpatialBodyId::Entity(guid), now);
        }
        released
    }

    fn clear_authored_momentum(&self, body_id: SpatialBodyId, now: std::time::Instant) {
        let Some(body) = self.simulation.physical_body_view(body_id) else {
            return;
        };
        // Align-path facing is a response policy, not a kinematic fact; the entity keeps whatever it
        // had, so this replacement carries the same answer the body already holds.
        let align_path = self
            .simulation
            .physical_body_align_path(body_id)
            .unwrap_or(false);
        let Some(kinematics) = holtburger_world::DynamicBodyKinematics::new(
            holtburger_common::Vector3::new(0.0, 0.0, body.velocity.z),
            body.acceleration,
            body.omega,
            align_path,
        ) else {
            return;
        };
        let _ = self
            .simulation
            .apply_dynamic_entity_kinematics(body_id, kinematics, now);
    }

    /// Replaces the order the possessed entity performs from the next tick onward.
    pub fn set_motion_order(&self, order: MotionOrder) -> Option<Guid> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.motion.order = order;
        registry.motion.possessed
    }

    /// The motion table an entity animates from: its own property, or the default its setup installs.
    fn motion_table_for(&self, definition: &DynamicEntityDefinition) -> Option<u32> {
        definition.content.motion_table_did.or_else(|| {
            self.motion_catalog
                .default_motion_table_for_setup(definition.content.setup_did)
        })
    }

    /// Advances every entity's authored playback by one tick and returns the possessed drive.
    ///
    /// Every entity plays, not only the possessed one: an unpossessed entity idles from its motion
    /// table's default style and substate, which is what retail installs for any non-static object
    /// (`CPhysicsObj::InitDefaults`, `acclient.c:309099-309103`). Only the possessed entity receives
    /// a command; the rest hold their idle.
    ///
    /// An entity whose table is absent from the contract, or which declares none, simply has no
    /// playback. That is not a failure — it is an object that does not animate.
    fn advance_entity_motion(
        &self,
        registry: &mut ExplorerEntityRegistry,
        delta_seconds: f32,
    ) -> Option<PossessedDrive> {
        let possessed = registry.motion.possessed;
        if possessed.is_some_and(|guid| !registry.entities.contains_key(&guid)) {
            // The possessed entity retired underneath us; drop the possession with it.
            registry.motion.release();
        }
        let possessed = registry.motion.possessed;
        let order = registry.motion.order;

        let driving: Vec<(Guid, u32, f32, MotionOrder)> = registry
            .entities
            .iter()
            .filter_map(|(guid, instance)| {
                Some((
                    *guid,
                    self.motion_table_for(&instance.definition)?,
                    instance.definition.object_scale,
                    if possessed == Some(*guid) {
                        order
                    } else {
                        MotionOrder::default()
                    },
                ))
            })
            .collect();

        let live: BTreeSet<Guid> = driving.iter().map(|(guid, _, _, _)| *guid).collect();
        registry
            .motion
            .playback
            .retain_bodies(|guid| live.contains(&guid));

        let mut drive = None;
        for (guid, motion_table_id, object_scale, order) in driving {
            let Some(table) = self.motion_catalog.table(motion_table_id) else {
                continue;
            };
            let offset = registry
                .motion
                .playback
                .drive(table, guid, order, delta_seconds)
                .offset;

            // A body that proved stable support has dropped out of the collection scan. Whether it
            // should be back in is a property of what its playback installed, not of how large this
            // tick's offset came out — the same distinction Phase 3 settled for the client basis.
            let moving = registry
                .motion
                .playback
                .get(guid)
                .is_some_and(|runtime| runtime.sequence().contributes_motion());
            if moving {
                self.simulation
                    .wake_dynamic_body(SpatialBodyId::Entity(guid));
            }

            if possessed == Some(guid) {
                drive = Some(PossessedDrive {
                    guid,
                    offset,
                    object_scale,
                });
            }
        }
        drive
    }

    pub fn tick_physical_collection(
        &self,
        delta_seconds: f32,
        now: std::time::Instant,
    ) -> anyhow::Result<Vec<ExplorerEntityPhysicalTick>> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        // Authored playback advances once, before the solve reads anything from it.
        let authored = self.advance_entity_motion(&mut registry, delta_seconds);
        // Sampled after the advance, because the advance is what changes the clip. Only entities
        // whose clip actually changed are published: a receiver swaps on arrival rather than
        // diffing, so an unchanged clip must not be resent.
        let live: BTreeSet<Guid> = registry.entities.keys().copied().collect();
        // A clip change is a change worth publishing even when the body did not move: an entity can
        // transition between idles standing still, and the receiver would otherwise never hear.
        let changed_clips = registry.motion.take_changed_clips(&live);
        self.simulation
            .tick_dynamic_entity_collection(delta_seconds, now, |body| match &authored {
                Some(drive) if body.id == SpatialBodyId::Entity(drive.guid) => {
                    drive.actuation(body, delta_seconds)
                }
                _ => crate::host_simulation_runtime::dynamic_entity_coasting_actuation(
                    body,
                    delta_seconds,
                ),
            })?
            .bodies
            .into_iter()
            .filter(|solved| {
                physical_tick_changed(solved)
                    || solved
                        .current
                        .id
                        .authoritative_guid()
                        .is_some_and(|guid| changed_clips.contains_key(&guid))
            })
            .map(|solved| {
                let changed_clips = &changed_clips;
                let SpatialBodyId::Entity(guid) = solved.current.id else {
                    anyhow::bail!("dynamic-entity collection returned a non-entity body")
                };
                let instance = registry.entities.get_mut(&guid).with_context(|| {
                    format!(
                        "dynamic-entity body 0x{:08X} has no Explorer semantic instance",
                        guid.0
                    )
                })?;
                if let Some(change) = solved.result.dynamic_state_change {
                    instance.definition.physics = resolve_effective_entity_physics_state(
                        instance.definition.physics.semantic & !change.cleared,
                    );
                }
                let input = dynamic_entity_projection_input_from_body(
                    &instance.definition,
                    &solved.current,
                )?;
                Ok(ExplorerEntityPhysicalTick {
                    clip: changed_clips.get(&guid).copied(),
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
    tick.result.dynamic_state_change.is_some()
        || tick.previous.runtime_view() != tick.current.runtime_view()
        || tick
            .result
            .motion
            .path
            .legs()
            .iter()
            .any(|leg| leg.end() != tick.result.motion.path.initial())
}

fn child_guids(registry: &ExplorerEntityRegistry, parent: Guid) -> Vec<Guid> {
    registry
        .entities
        .values()
        .filter_map(|instance| {
            instance
                .definition
                .placement
                .attachment()
                .filter(|attachment| attachment.parent == parent)
                .map(|_| instance.definition.identity.guid)
        })
        .collect()
}

fn validate_attached_children(
    parent: Guid,
    children: &[DynamicEntityDefinition],
) -> Result<(), ExplorerEntityRuntimeError> {
    let mut identities = BTreeSet::new();
    for child in children {
        if !identities.insert(child.identity.guid) {
            return Err(ExplorerEntityRuntimeError::AlreadyRegistered {
                guid: child.identity.guid,
            });
        }
        match child.placement.attachment().copied() {
            Some(attachment) if attachment.parent == parent => {}
            Some(attachment) => {
                return Err(ExplorerEntityRuntimeError::ChildWearerMismatch {
                    guid: child.identity.guid,
                    expected_parent: parent,
                    declared_parent: attachment.parent,
                });
            }
            None => {
                return Err(ExplorerEntityRuntimeError::ChildNotAttached {
                    guid: child.identity.guid,
                    parent,
                });
            }
        }
    }
    Ok(())
}

fn require_world_initial(
    definition: &DynamicEntityDefinition,
    operation: &'static str,
) -> Result<DynamicEntityInitialState, ExplorerEntityRuntimeError> {
    match definition.placement {
        EntityPlacement::World(initial) => Ok(initial),
        EntityPlacement::Attached(attachment) => {
            Err(ExplorerEntityRuntimeError::AttachedOperation {
                guid: definition.identity.guid,
                parent: attachment.parent,
                operation,
            })
        }
    }
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
    operation: &'static str,
) -> Result<EntityPhysicsTransitionDecision, ExplorerEntityRuntimeError> {
    let projection = simulation.project_dynamic_entity(&instance.definition)?;
    let world = match projection.placement {
        EntityPlacement::World(world) => world,
        EntityPlacement::Attached(attachment) => {
            return Err(ExplorerEntityRuntimeError::AttachedOperation {
                guid: instance.definition.identity.guid,
                parent: attachment.parent,
                operation,
            });
        }
    };
    let solver_participation_enabled = matches!(
        world.participation,
        holtburger_world::PhysicalBodyParticipation::Physical
    );
    Ok(decide_entity_physics_state_transition(
        Some(instance.definition.physics),
        next,
        EntityPhysicsTransitionContext {
            intent: next_intent,
            prepared_physics_available: prepared_physics_available || solver_participation_enabled,
            solver_participation_enabled,
            prepared_definition_changed: false,
        },
    ))
}

fn validate_transition_replacement(
    action: holtburger_world::EntityPhysicalTransitionAction,
    has_replacement: bool,
) -> Result<(), ExplorerEntityRuntimeError> {
    use holtburger_world::EntityPhysicalTransitionAction::{
        EnableSolverParticipation, Reconfigure,
    };
    match (
        matches!(action, EnableSolverParticipation | Reconfigure),
        has_replacement,
    ) {
        (true, false) => Err(ExplorerEntityRuntimeError::MissingPreparedPhysics),
        (false, true) => Err(ExplorerEntityRuntimeError::UnexpectedPreparedPhysics),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    /// Every scheduled body coasts, for tests that do not care about drive.
    fn coasting(
        delta_seconds: f32,
    ) -> impl Fn(&SpatialBody) -> anyhow::Result<holtburger_world::PhysicalBodyActuation> {
        move |body| {
            crate::host_simulation_runtime::dynamic_entity_coasting_actuation(body, delta_seconds)
        }
    }

    use super::*;
    use anyhow::Result;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PhysicsState, WeenieType};
    use holtburger_common::{ParentLocation, Placement, Quaternion, Sphere, Vector3};
    use holtburger_content::{
        ColliderScale, CollisionBall, CollisionShape, LandblockCollisionAsset,
    };
    use holtburger_core::{
        DynamicEntityContent, DynamicEntityDefinitionInput, DynamicEntityIdentity,
        DynamicEntityInitialState,
    };
    use holtburger_world::{
        DynamicBodyCollisionDefinition, EdgeProtection, EntityAppearance,
        EntityCollisionParticipation, EntityCollisionReportPolicy, EntityDynamicCollisionPolicy,
        EntityPhysicsScheduling, PhysicalBodyDefinition, PhysicalBodyParticipation,
        PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFlyConfig, PhysicalFriction,
        PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, PhysicsAttachment,
        PreparedEntityTargetGeometry, resolve_effective_entity_physics_state,
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
                motion_table_did: None,
                setup_did: 0x0200_0001,
                sound_table_did: None,
                physics_effect_table_did: None,
            },
            appearance: EntityAppearance::default(),
            placement: EntityPlacement::World(DynamicEntityInitialState {
                pose: WorldPosition {
                    landblock_id: Guid(0xda55_0001),
                    coords: Vector3::new(x, 0.0, 0.0),
                    rotation: Quaternion::identity(),
                },
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
                created_at: Instant::now(),
            }),
            object_scale: 1.0,
            friction: None,
            elasticity: None,
            maximum_velocity: None,
            rotation_speed: None,
            physics: resolve_effective_entity_physics_state(PhysicsState::GRAVITY),
        })
        .unwrap()
    }

    /// Child definition whose transform is wholly owned by `parent`; it intentionally has no
    /// world-motion state or host body to accidentally keep alive.
    fn attached_definition(guid: Guid, wcid: u32, parent: Guid) -> DynamicEntityDefinition {
        let mut child = definition(guid, wcid, 0.0);
        child.placement = EntityPlacement::Attached(PhysicsAttachment {
            parent,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        });
        child
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
        }
    }

    fn physical_with_ball_target() -> DynamicPhysicalBodyDefinition {
        let mut physical = physical();
        physical.entity_collision.target_geometry.fallback_shapes =
            vec![Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.5,
            }))];
        physical
    }

    fn report_only_physical() -> DynamicPhysicalBodyDefinition {
        let mut physical = physical_with_ball_target();
        physical.movement = PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::zero(),
                    radius: 0.5,
                },
                None,
            )
            .unwrap(),
            PhysicalFlyConfig {
                maximum_substep_distance: 0.25,
                maximum_substeps: 32,
                maximum_contact_passes: 8,
                separation_epsilon: 0.000_5,
            },
        )
        .unwrap();
        physical.entity_collision.reporting.enabled = true;
        physical
            .entity_collision
            .dynamic_collision
            .mover_accepts_response = false;
        physical
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
    fn missile_contact_updates_solver_and_explorer_semantics_in_one_collection_transaction() {
        let (_simulation, runtime) = runtime(0xf000_0110, 0xf000_0111);
        let mover_guid = runtime.reserve_guid().unwrap();
        let target_guid = runtime.reserve_guid().unwrap();
        let mut mover_definition = definition(mover_guid, 1499, 0.0);
        mover_definition.placement.world_mut().unwrap().velocity = Vector3::new(10.0, 0.0, 0.0);
        mover_definition.physics = resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY
                | PhysicsState::MISSILE
                | PhysicsState::ALIGN_PATH
                | PhysicsState::PATH_CLIPPED
                | PhysicsState::INELASTIC,
        );
        let mut mover_physical = physical_with_ball_target();
        mover_physical.response_policy.restitution = PhysicalRestitution::Inelastic;
        mover_physical.response_policy.align_path = true;
        mover_physical.entity_collision.dynamic_collision.missile = true;
        mover_physical
            .entity_collision
            .dynamic_collision
            .path_clipped = true;
        let mover = runtime
            .spawn_prepared(
                mover_definition,
                EntityPhysicalIntent::Simulated,
                Some(mover_physical),
            )
            .unwrap();
        runtime
            .spawn_prepared(
                definition(target_guid, 1, 1.2),
                EntityPhysicalIntent::Simulated,
                Some(physical_with_ball_target()),
            )
            .unwrap();

        let ticks = runtime
            .tick_physical_collection(0.1, Instant::now())
            .unwrap();
        let mover_tick = ticks
            .iter()
            .find(|tick| tick.input.identity.guid == mover_guid)
            .unwrap();
        assert!(mover_tick.solved.result.dynamic_state_change.is_some());
        assert_eq!(mover_tick.generation, mover.instance.generation);
        let physics = runtime.project(mover_guid).unwrap().input.physics;
        assert!(!physics.semantic.contains(PhysicsState::MISSILE));
        assert!(!physics.semantic.contains(PhysicsState::ALIGN_PATH));
        assert!(!physics.semantic.contains(PhysicsState::PATH_CLIPPED));
        assert!(physics.semantic.contains(PhysicsState::INELASTIC));
    }

    #[test]
    fn report_only_collection_outcomes_do_not_become_explorer_projection_ticks() {
        let (simulation, runtime) = runtime(0xf000_0120, 0xf000_0121);
        let mut guids = Vec::new();
        for (index, wcid) in [1, 2].into_iter().enumerate() {
            let guid = runtime.reserve_guid().unwrap();
            guids.push(guid);
            let mut definition = definition(guid, wcid, index as f32 * 2.0);
            definition.physics = resolve_effective_entity_physics_state(
                PhysicsState::GRAVITY | PhysicsState::REPORT_COLLISIONS,
            );
            runtime
                .spawn_prepared(
                    definition,
                    EntityPhysicalIntent::Simulated,
                    Some(report_only_physical()),
                )
                .unwrap();
        }

        let baseline_at = Instant::now();
        let baseline = simulation
            .tick_dynamic_entity_collection(0.1, baseline_at, coasting(0.1))
            .unwrap();
        assert!(baseline.collision_reports.is_empty());
        simulation
            .relocate_dynamic_entity(
                SpatialBodyId::Entity(guids[1]),
                WorldPosition {
                    landblock_id: Guid(0xda55_0001),
                    coords: Vector3::zero(),
                    rotation: Quaternion::identity(),
                },
                baseline_at + std::time::Duration::from_millis(100),
            )
            .unwrap();
        let collection = simulation
            .tick_dynamic_entity_collection(
                0.1,
                baseline_at + std::time::Duration::from_millis(200),
                coasting(0.1),
            )
            .unwrap();
        assert_eq!(collection.collision_reports.len(), 2);
        assert_eq!(collection.bodies.len(), 2);
        assert!(
            collection
                .bodies
                .iter()
                .all(|tick| !physical_tick_changed(tick))
        );
        assert_eq!(runtime.snapshot().unwrap().len(), 2);
    }

    #[test]
    fn failed_body_install_publishes_no_semantic_record() {
        let (simulation, runtime) = runtime(0xf000_0020, 0xf000_0020);
        let guid = runtime.reserve_guid().unwrap();
        let definition = definition(guid, 7, 0.0);
        simulation
            .install_dynamic_entity(
                &definition,
                require_world_initial(&definition, "test install").unwrap(),
                None,
            )
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
                .placement
                .world()
                .unwrap()
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

    /// Both malformed-child-set clauses are reachable and name every wearer involved, so a
    /// miswired producer learns which group it published under, not only what the child claims.
    #[test]
    fn a_malformed_child_set_is_refused_before_any_body_is_installed() {
        let (_simulation, runtime) = runtime(0xf000_0090, 0xf000_0095);
        let wearer_guid = runtime.reserve_guid().unwrap();
        let other_wearer_guid = runtime.reserve_guid().unwrap();
        let child_guid = runtime.reserve_guid().unwrap();

        assert_eq!(
            runtime
                .spawn_prepared_group(
                    definition(wearer_guid, 10, 0.0),
                    EntityPhysicalIntent::PoseOnly,
                    None,
                    vec![attached_definition(child_guid, 20, other_wearer_guid)],
                )
                .unwrap_err(),
            ExplorerEntityRuntimeError::ChildWearerMismatch {
                guid: child_guid,
                expected_parent: wearer_guid,
                declared_parent: other_wearer_guid,
            }
        );
        assert_eq!(
            runtime
                .spawn_prepared_group(
                    definition(wearer_guid, 10, 0.0),
                    EntityPhysicalIntent::PoseOnly,
                    None,
                    vec![definition(child_guid, 20, 0.0)],
                )
                .unwrap_err(),
            ExplorerEntityRuntimeError::ChildNotAttached {
                guid: child_guid,
                parent: wearer_guid,
            }
        );
        // A refused group leaves no wearer, no child, and no host body behind.
        assert!(runtime.snapshot().unwrap().is_empty());
    }

    #[test]
    fn attached_children_cut_over_with_their_wearer_and_reject_independent_despawn() {
        let (_simulation, runtime) = runtime(0xf000_0050, 0xf000_0055);
        let wearer_guid = runtime.reserve_guid().unwrap();
        let first_child_guid = runtime.reserve_guid().unwrap();
        let first = runtime
            .spawn_prepared_group(
                definition(wearer_guid, 10, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
                vec![attached_definition(first_child_guid, 20, wearer_guid)],
            )
            .unwrap();

        assert_eq!(first.children.len(), 1);
        let independent_error = runtime
            .despawn(first_child_guid, first.children[0].generation)
            .unwrap_err();
        assert_eq!(
            independent_error,
            ExplorerEntityRuntimeError::AttachedOperation {
                guid: first_child_guid,
                parent: wearer_guid,
                operation: "independent despawn",
            }
        );
        assert_eq!(
            runtime
                .plan_physics_state(
                    first_child_guid,
                    first.children[0].generation,
                    resolve_effective_entity_physics_state(PhysicsState::GRAVITY),
                    EntityPhysicalIntent::PoseOnly,
                )
                .unwrap_err(),
            ExplorerEntityRuntimeError::AttachedOperation {
                guid: first_child_guid,
                parent: wearer_guid,
                operation: "physics-state planning",
            }
        );

        let second_child_guid = runtime.reserve_guid().unwrap();
        let replacement = runtime
            .replace_prepared_group(
                definition(wearer_guid, 11, 1.0),
                first.instance.generation,
                EntityPhysicalIntent::PoseOnly,
                None,
                vec![attached_definition(second_child_guid, 21, wearer_guid)],
            )
            .unwrap();
        assert_eq!(replacement.removed_children, first.children);
        assert_eq!(replacement.installed_children.len(), 1);
        assert_eq!(
            runtime
                .snapshot()
                .unwrap()
                .into_iter()
                .map(|projection| projection.input.identity.guid)
                .collect::<Vec<_>>(),
            vec![wearer_guid, second_child_guid]
        );

        let removed = runtime
            .despawn(wearer_guid, replacement.installed.generation)
            .unwrap();
        assert_eq!(removed.children, replacement.installed_children);
        assert!(runtime.snapshot().unwrap().is_empty());

        let reset_wearer_guid = runtime.reserve_guid().unwrap();
        let reset_child_guid = runtime.reserve_guid().unwrap();
        runtime
            .spawn_prepared_group(
                definition(reset_wearer_guid, 12, 0.0),
                EntityPhysicalIntent::PoseOnly,
                None,
                vec![attached_definition(reset_child_guid, 22, reset_wearer_guid)],
            )
            .unwrap();
        let reset = runtime.reset().unwrap();
        assert_eq!(reset.len(), 2);
        assert!(runtime.snapshot().unwrap().is_empty());
    }

    /// Both producer compositions must derive the same operation from one pair of masks. This
    /// walks the exact sequence the client `SetState` path asserts in
    /// `holtburger_world::state::tests::set_state_reconfigures_then_disables_dynamic_client_physics_without_losing_semantic_truth`
    /// (GRAVITY, then FROZEN, then PUSHABLE). If either producer's context construction drifts,
    /// one of the two tests fails rather than both silently agreeing on a new answer.
    #[test]
    fn explorer_derives_the_same_transition_actions_as_the_client_set_state_path() {
        let (_simulation, runtime) = runtime(0xf000_0070, 0xf000_0080);
        let guid = runtime.reserve_guid().unwrap();
        let spawned = runtime
            .spawn_prepared(
                definition(guid, 1, 0.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let generation = spawned.instance.generation;

        // FROZEN keeps a simulated body but changes scheduling: reconfigure, never retire.
        let frozen = runtime
            .plan_physics_state(
                guid,
                generation,
                resolve_effective_entity_physics_state(PhysicsState::FROZEN),
                EntityPhysicalIntent::Simulated,
            )
            .unwrap();
        assert_eq!(
            frozen.action,
            holtburger_world::EntityPhysicalTransitionAction::Reconfigure
        );

        // PUSHABLE has no reachable local simulation, so both producers disable participation
        // while the semantic mask survives.
        let pushable = runtime
            .plan_physics_state(
                guid,
                generation,
                resolve_effective_entity_physics_state(PhysicsState::PUSHABLE),
                EntityPhysicalIntent::Simulated,
            )
            .unwrap();
        assert_eq!(
            pushable.action,
            holtburger_world::EntityPhysicalTransitionAction::DisableSolverParticipation
        );
        assert!(
            matches!(
                pushable.disposition,
                holtburger_world::EntityPhysicalDisposition::UnsupportedState { .. }
            ),
            "the unsupported reason must stay typed rather than collapsing to pose-only"
        );
    }

    /// Serves flat ground so a fixture body can prove stable support.
    struct FlatGround;

    impl crate::host_simulation_runtime::CollisionSource for FlatGround {
        fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: holtburger_content::TerrainCollisionSurface::from_terrain(
                    &holtburger_content::LandblockTerrain {
                        grid_size: 9,
                        tile_size: 24.0,
                        height_indices: vec![0; 81],
                        heights: vec![0.0; 81],
                        terrain_samples: vec![0; 81],
                        cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(
                            landblock_id,
                        ),
                    },
                )?,
                static_geometry: holtburger_content::LandblockColliders::default(),
            }))
        }
    }

    const WALK_TABLE: u32 = 0x0900_0001;
    const WALK_STYLE: u32 = 0x8000_003D;
    const WALK_STAND: u32 = 0x4500_0003;
    const WALK_FORWARD: u32 = 0x4500_0005;
    const WALK_ANIM: u32 = 0x0300_0002;

    /// A table whose walk cycle authors root motion along local Y, which is what a real walk does.
    fn walking_catalog() -> Arc<MotionSequenceCatalog> {
        use holtburger_dat::file_type::animation::AnimationFlags;
        use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
        use holtburger_dat::file_type::setup_model::AnimationFrame;
        use holtburger_dat::file_type::{Animation, MotionTable};
        use holtburger_dat::graphics::Frame;

        let clip = |anim_id: u32| MotionData {
            bitfield: 0,
            flags: MotionDataFlags::empty(),
            anims: vec![AnimData {
                anim_id,
                low_frame: 0,
                high_frame: -1,
                framerate: 4.0,
            }],
            velocity: None,
            omega: None,
        };
        let animation = |id: u32, step: f32| Animation {
            id,
            flags: AnimationFlags::POS_FRAMES,
            num_parts: 0,
            num_frames: 4,
            pos_frames: (0..4)
                .map(|_| Frame {
                    origin: Vector3::new(0.0, step, 0.0),
                    orientation: Quaternion::identity(),
                })
                .collect(),
            part_frames: (0..4)
                .map(|_| AnimationFrame {
                    frames: Vec::new(),
                    hooks: Vec::new(),
                })
                .collect(),
        };

        let mut cycles = std::collections::HashMap::new();
        cycles.insert(
            MotionTable::cycle_key(WALK_STYLE, WALK_STAND),
            clip(0x0300_0001),
        );
        cycles.insert(
            MotionTable::cycle_key(WALK_STYLE, WALK_FORWARD),
            clip(WALK_ANIM),
        );

        Arc::new(
            MotionSequenceCatalog::assemble(
                [MotionTable {
                    id: WALK_TABLE,
                    default_style: WALK_STYLE,
                    style_defaults: std::collections::HashMap::from([(WALK_STYLE, WALK_STAND)]),
                    cycles,
                    modifiers: std::collections::HashMap::new(),
                    links: std::collections::HashMap::new(),
                }],
                [animation(0x0300_0001, 0.0), animation(WALK_ANIM, 1.0)],
                [],
            )
            .expect("walking fixture should assemble"),
        )
    }

    fn walking_runtime() -> (Arc<HostSimulationRuntime>, ExplorerEntityRuntime, Guid) {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGround)));
        let runtime = ExplorerEntityRuntime::with_guid_range_and_motion(
            Arc::clone(&simulation),
            0xf000_0090,
            0xf000_00a0,
            walking_catalog(),
        );
        let session = simulation.reserve_interest_session();
        simulation
            .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
                session,
                revision: 1,
                landblock_ids: vec!["0xda55ffff".to_owned()],
            })
            .unwrap();

        let guid = runtime.reserve_guid().unwrap();
        let mut definition = definition(guid, 1, 0.0);
        definition.content.motion_table_did = Some(WALK_TABLE);
        runtime
            .spawn_prepared(
                definition,
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        (simulation, runtime, guid)
    }

    use std::time::Duration;

    fn settle(simulation: &HostSimulationRuntime, start: Instant) -> Instant {
        for step in 0..240 {
            let now = start + std::time::Duration::from_millis(step * 33);
            if simulation
                .tick_dynamic_entity_collection(1.0 / 30.0, now, coasting(1.0 / 30.0))
                .unwrap()
                .bodies
                .is_empty()
            {
                return now;
            }
        }
        panic!("the grounded fixture body must settle before possession");
    }

    fn walk_order() -> MotionOrder {
        MotionOrder {
            style: Some(holtburger_world::motion::MotionCommand(WALK_STYLE)),
            forward: Some((holtburger_world::motion::MotionCommand(WALK_FORWARD), 1.0)),
            sidestep: None,
            turn: None,
        }
    }

    /// The payoff of the whole plan, at the Explorer boundary: a possessed entity commanded to walk
    /// travels under its animation's authored root motion, with no velocity stored anywhere.
    #[test]
    fn a_possessed_entity_walks_on_its_authored_root_motion() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        let before = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("the possessed body must exist")
            .pose
            .coords;

        let possession = runtime.possess(guid).unwrap();
        assert_eq!(possession.motion_table_id, Some(WALK_TABLE));
        assert!(possession.modelled_commands.contains(&WALK_FORWARD));
        runtime.set_motion_order(walk_order());

        for step in 1..=15 {
            runtime
                .tick_physical_collection(
                    1.0 / 30.0,
                    settled_at + std::time::Duration::from_millis(step * 33),
                )
                .unwrap();
        }

        let after = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .expect("the possessed body must still exist")
            .pose
            .coords;
        assert!(
            (after - before).length() > 0.5,
            "a possessed entity ordered to walk must travel: {before:?} -> {after:?}"
        );
    }

    /// The clip is published when it changes and not otherwise, because a receiver swaps on arrival
    /// rather than diffing. Resending an unchanged clip would restart it every tick.
    #[test]
    fn a_playing_clip_publishes_on_change_and_not_again() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        runtime.possess(guid).unwrap();

        // The first tick after spawn announces the idle the entity is already playing.
        let first = runtime
            .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(33))
            .unwrap();
        assert!(
            first.iter().any(|tick| tick.clip.is_some()),
            "the first tick announces the clip"
        );

        runtime.set_motion_order(walk_order());
        let mut announcements = 0usize;
        let mut animations = Vec::new();
        for step in 2..=20 {
            for tick in runtime
                .tick_physical_collection(1.0 / 30.0, settled_at + Duration::from_millis(step * 33))
                .unwrap()
            {
                if let Some(clip) = tick.clip {
                    announcements += 1;
                    animations.push(clip.animation_id);
                }
            }
        }

        assert!(
            announcements >= 1,
            "commanding a walk changes the clip at least once"
        );
        assert!(
            announcements <= 4,
            "only transitions announce, not every tick: {announcements} announcements over 19 ticks"
        );
        assert!(
            animations.windows(2).all(|pair| pair[0] != pair[1]),
            "the same clip is never announced twice in a row: {animations:?}"
        );
    }

    /// Releasing possession stops the entity: authored drive is per-tick, so nothing survives it.
    #[test]
    fn releasing_possession_stops_authored_travel() {
        let (simulation, runtime, guid) = walking_runtime();
        let settled_at = settle(&simulation, Instant::now());
        runtime.possess(guid).unwrap();
        runtime.set_motion_order(walk_order());
        for step in 1..=15 {
            runtime
                .tick_physical_collection(
                    1.0 / 30.0,
                    settled_at + std::time::Duration::from_millis(step * 33),
                )
                .unwrap();
        }

        let released_at = settled_at + std::time::Duration::from_millis(600);
        assert_eq!(runtime.release_possession(released_at), Some(guid));
        let before = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .coords;
        for step in 1..=15 {
            runtime
                .tick_physical_collection(
                    1.0 / 30.0,
                    released_at + std::time::Duration::from_millis(step * 33),
                )
                .unwrap();
        }
        let after = simulation
            .physical_body_snapshot(SpatialBodyId::Entity(guid))
            .unwrap()
            .pose
            .coords;

        assert!(
            (after - before).length() < 0.05,
            "a released entity keeps no authored momentum: {before:?} -> {after:?}"
        );
    }

    /// The UX must be able to refuse what a table cannot do, so the modelled set is read from the
    /// contract rather than assumed from the command vocabulary.
    #[test]
    fn possession_reports_only_the_commands_the_table_models() {
        let (_simulation, runtime, guid) = walking_runtime();

        let possession = runtime.possess(guid).unwrap();

        assert_eq!(possession.modelled_commands, vec![WALK_FORWARD]);
    }

    /// A settled body stops integrating, so a change to the loaded static world would otherwise
    /// leave it resting on collision geometry that no longer exists. The host wakes the whole
    /// settled population conservatively; this proves that wiring, not just the scene primitive.
    #[test]
    fn loaded_collision_change_wakes_settled_dynamic_entities() {
        /// Serves flat ground so the fixture body can prove stable support and settle.
        struct FlatGroundSource;

        impl crate::host_simulation_runtime::CollisionSource for FlatGroundSource {
            fn load_collision(&self, landblock_id: u32) -> Result<Option<LandblockCollisionAsset>> {
                Ok(Some(LandblockCollisionAsset {
                    landblock_id,
                    terrain: holtburger_content::TerrainCollisionSurface::from_terrain(
                        &holtburger_content::LandblockTerrain {
                            grid_size: 9,
                            tile_size: 24.0,
                            height_indices: vec![0; 81],
                            heights: vec![0.0; 81],
                            terrain_samples: vec![0; 81],
                            cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(
                                landblock_id,
                            ),
                        },
                    )?,
                    static_geometry: holtburger_content::LandblockColliders::default(),
                }))
            }
        }

        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(FlatGroundSource)));
        let runtime = ExplorerEntityRuntime::with_guid_range(
            Arc::clone(&simulation),
            0xf000_0050,
            0xf000_0060,
        );
        let session = simulation.reserve_interest_session();
        simulation
            .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
                session,
                revision: 1,
                landblock_ids: vec!["0xda55ffff".to_owned()],
            })
            .unwrap();

        let guid = runtime.reserve_guid().unwrap();
        runtime
            .spawn_prepared(
                definition(guid, 1, 0.0),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();

        // Integrate until the body proves stable support and settles out of the scan.
        let start = Instant::now();
        let mut settled_at = None;
        for step in 0..240 {
            let now = start + std::time::Duration::from_millis(step * 33);
            let tick = simulation
                .tick_dynamic_entity_collection(1.0 / 30.0, now, coasting(1.0 / 30.0))
                .unwrap();
            if tick.bodies.is_empty() {
                settled_at = Some(now);
                break;
            }
        }
        let settled_at = settled_at.expect("the grounded fixture body must settle");
        assert!(
            simulation
                .tick_dynamic_entity_collection(1.0 / 30.0, settled_at, coasting(1.0 / 30.0))
                .unwrap()
                .bodies
                .is_empty(),
            "a settled body must stay out of the integration scan"
        );

        // Replacing interest with a different owner changes loaded collision.
        simulation
            .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
                session,
                revision: 2,
                landblock_ids: vec!["0xdb55ffff".to_owned()],
            })
            .unwrap();

        assert!(
            !simulation
                .tick_dynamic_entity_collection(1.0 / 30.0, settled_at, coasting(1.0 / 30.0))
                .unwrap()
                .bodies
                .is_empty(),
            "a loaded static-world collision change must wake settled bodies before the next solve"
        );
    }
}
