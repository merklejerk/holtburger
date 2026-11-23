//! Explorer-local entity identity allocator, semantic registry, and motion playback state.

use std::collections::{BTreeMap, BTreeSet};

use holtburger_common::Guid;
use holtburger_content::MotionSequenceCatalog;
use holtburger_core::{DynamicEntityDefinition, DynamicEntityLaunchPlan};
use holtburger_world::motion::{
    CharacterMotionPresentation, MotionPlayback, MotionRuntimeRegistry, ObservedCharacterMotion,
};
use holtburger_world::{
    DynamicPhysicalBodyDefinition, LocalPhysicalDemand, PhysicalBodyDefinition,
};

use super::possession::possession_character_presentation;
use super::types::{
    ExplorerEntityInstance, ExplorerEntityRuntimeError, ExplorerPossessionPhysicalStatus,
    ExplorerPreparedEntity, ExplorerSelectionTarget,
};
use crate::explorer_possession_control::ActivePossession;
use crate::host_simulation_runtime::HostDynamicBodyTick;

const EXPLORER_GUID_START: u32 = 0xf000_0001;
const EXPLORER_GUID_END: u32 = 0xffff_fffe;

#[derive(Debug, Clone)]
pub(super) struct ExplorerGuidAllocator {
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

    pub(super) fn allocate(&mut self) -> Result<Guid, ExplorerEntityRuntimeError> {
        let value = self.next.ok_or(ExplorerEntityRuntimeError::GuidExhausted)?;
        self.next = (value < self.end).then_some(value + 1);
        Ok(Guid(value))
    }

    pub(super) fn reset(&mut self) {
        self.next = Some(self.start);
    }
}

/// Explorer's sole semantic authority for live dynamic entities.
///
/// Physical state deliberately does not live here. The outer runtime joins each record with the
/// canonical `HostSimulationRuntime` body only while producing a snapshot or focused outcome.
#[derive(Debug)]
pub struct ExplorerEntityRegistry {
    pub(super) entities: BTreeMap<Guid, ExplorerEntityInstance>,
    allocator: ExplorerGuidAllocator,
    next_generation: Option<u64>,
    /// Authored-motion playback and possession.
    ///
    /// Kept inside the registry rather than beside it so one lock covers both: the collection tick
    /// holds the registry across a whole simulation transaction, and a second lock would invite an
    /// ordering bug for no benefit. This is also the plan's rule — producer registries retain
    /// semantic state — and it is what keeps the Explorer and the client separate authorities over
    /// the same shared contract.
    pub(super) motion: ExplorerMotionState,
    /// Currently selected Explorer entity and its optional active physical-body suspension.
    pub(super) selection: Option<ExplorerSelectionState>,
}

/// Single composite owner for the currently selected entity and its suspension state so target
/// identity and stashed physics can never drift out of sync.
#[derive(Debug, Clone)]
pub(super) struct ExplorerSelectionState {
    pub(super) target: ExplorerSelectionTarget,
    /// Present iff this entity's physical body is currently stashed and disabled in simulation.
    pub(super) suspended_physics: Option<SuspendedSelectionPhysics>,
}

/// Retained physical configuration and optional armed launch for one selection-suspended entity.
#[derive(Debug, Clone)]
pub(super) struct SuspendedSelectionPhysics {
    /// Captured physical body definition restored without DAT re-decoding on resume.
    pub(super) stashed_body_definition: DynamicPhysicalBodyDefinition,
    /// Launch requested while suspended; its physics and kinematics apply only on execution.
    pub(super) pending_launch: Option<DynamicEntityLaunchPlan>,
}

/// Which entity is being driven, what it has been told to do, and where its playback is.
#[derive(Debug, Default)]
pub(super) struct ExplorerMotionState {
    pub(super) playback: MotionRuntimeRegistry,
    /// Exact entity/possession generation and all controller-owned input state.
    pub(super) active: Option<ActivePossession>,
    /// Motion level each body's most recent publication carried, so unchanged state costs no
    /// traffic.
    published: BTreeMap<Guid, MotionPlayback>,
    /// Latest accepted physical result for the active possession, including bounded prefixes.
    pub(super) last_physical_status: Option<ExplorerPossessionPhysicalStatus>,
    /// Planar speed achieved by the latest accepted body tick, for clamp diagnostics.
    pub(super) last_effective_planar_speed: Option<f32>,
}

impl ExplorerMotionState {
    /// Forgets publication history for bodies that no longer exist.
    pub(super) fn retain_published(&mut self, live: &BTreeSet<Guid>) {
        self.published.retain(|guid, _| live.contains(guid));
    }

    /// Whether one body's current motion presentation has yet to reach a consumer.
    ///
    /// Read before the collection scan so a body whose only news is a clip change can be woken
    /// into it. Playback alone does not schedule a body: an idle contributes no motion, so a
    /// settled entity would otherwise have no tick to carry its level on.
    pub(super) fn motion_awaits_publication(&self, guid: Guid) -> bool {
        self.playback.motion_playback(guid) != self.published.get(&guid).copied()
    }

    /// Commits the motion presentation one body's publication carries, reporting whether it changed.
    ///
    /// Only a body that actually produced a tick commits. A body with no tick this epoch has
    /// nothing to carry its level, so it stays pending and re-offers the change on its next one.
    pub(super) fn commit_published_motion(&mut self, guid: Guid) -> (Option<MotionPlayback>, bool) {
        let motion = self.playback.motion_playback(guid);
        let changed = match motion {
            Some(motion) => self.published.insert(guid, motion) != Some(motion),
            None => self.published.remove(&guid).is_some(),
        };
        (motion, changed)
    }

    /// Observes the accepted body without changing authored root motion or action ownership.
    pub(super) fn observe_body(
        &mut self,
        catalog: &MotionSequenceCatalog,
        definition: &DynamicEntityDefinition,
        solved: &HostDynamicBodyTick,
        delta_seconds: f32,
    ) -> anyhow::Result<()> {
        let guid = definition.identity.guid;
        if definition.physics.dynamic_collision.missile
            || !solved.current.physical.as_ref().is_some_and(|physical| {
                matches!(physical.definition, PhysicalBodyDefinition::Grounded { .. })
            })
        {
            self.playback.clear_locomotion(guid);
            return Ok(());
        }
        let Some(table) = definition
            .content
            .motion_table_did
            .and_then(|id| catalog.table(id))
        else {
            return Ok(());
        };
        let presentation = match self.active.as_ref().filter(|active| active.guid == guid) {
            Some(active) => {
                let effective =
                    active.resolve_effective_intent(active.controller.effective_drive())?;
                possession_character_presentation(
                    active,
                    effective.stance,
                    solved.current.contact,
                    false,
                )
            }
            None => CharacterMotionPresentation::resolve(solved.current.contact, false, false),
        };
        self.playback.observe_locomotion(
            table,
            guid,
            ObservedCharacterMotion {
                motion: solved.supported_motion,
                orientation: solved.current.pose.rotation,
                presentation,
                object_scale: definition.object_scale,
            },
            delta_seconds,
        )
    }

    pub(super) fn release(&mut self) -> Option<Guid> {
        self.last_physical_status = None;
        self.last_effective_planar_speed = None;
        let active = self.active.take()?;
        active.lifetime.retire();
        self.playback.forget(active.guid);
        Some(active.guid)
    }

    pub(super) fn retire_target(&mut self, guid: Guid, entity_generation: u64) -> bool {
        if self.active.as_ref().is_some_and(|active| {
            active.guid == guid && active.entity_generation == entity_generation
        }) {
            self.release();
            true
        } else {
            false
        }
    }
}

impl Default for ExplorerEntityRegistry {
    fn default() -> Self {
        Self::with_guid_range(EXPLORER_GUID_START, EXPLORER_GUID_END)
    }
}

impl ExplorerEntityRegistry {
    #[cfg_attr(not(test), allow(dead_code))]
    pub(super) fn with_guid_range(start: u32, end: u32) -> Self {
        Self {
            entities: BTreeMap::new(),
            allocator: ExplorerGuidAllocator::new(start, end),
            next_generation: Some(1),
            motion: ExplorerMotionState::default(),
            selection: None,
        }
    }

    pub(super) fn selected_target(&self) -> Option<ExplorerSelectionTarget> {
        self.selection.as_ref().map(|selection| selection.target)
    }

    pub(super) fn is_selected_unpossessed(&self, guid: Guid, generation: u64) -> bool {
        self.selection.as_ref().is_some_and(|selection| {
            selection.target.guid == guid && selection.target.generation == generation
        }) && !self.is_possessed(guid, generation)
    }

    pub(super) fn is_selection_suspended(&self, guid: Guid, generation: u64) -> bool {
        self.selection.as_ref().is_some_and(|selection| {
            selection.target.guid == guid
                && selection.target.generation == generation
                && selection.suspended_physics.is_some()
        })
    }

    pub(super) fn is_possessed(&self, guid: Guid, generation: u64) -> bool {
        self.motion
            .active
            .as_ref()
            .is_some_and(|active| active.guid == guid && active.entity_generation == generation)
    }

    pub(super) fn selection_status(&self) -> super::types::ExplorerSelectionSuspensionStatus {
        let Some(suspended) = self
            .selection
            .as_ref()
            .and_then(|selection| selection.suspended_physics.as_ref())
        else {
            return super::types::ExplorerSelectionSuspensionStatus::default();
        };
        super::types::ExplorerSelectionSuspensionStatus {
            suspended: true,
            launch_queued: suspended.pending_launch.is_some(),
        }
    }

    pub(super) fn retire_selection(&mut self, guid: Guid, generation: u64) {
        if self.selection.as_ref().is_some_and(|selection| {
            selection.target.guid == guid && selection.target.generation == generation
        }) {
            self.selection = None;
        }
    }

    pub(super) fn allocate_guid(&mut self) -> Result<Guid, ExplorerEntityRuntimeError> {
        self.allocator.allocate()
    }

    pub(super) fn reserve_generation(&mut self) -> Result<u64, ExplorerEntityRuntimeError> {
        let generation = self
            .next_generation
            .ok_or(ExplorerEntityRuntimeError::GenerationExhausted)?;
        self.next_generation = generation.checked_add(1);
        Ok(generation)
    }

    pub(super) fn require_absent(&self, guid: Guid) -> Result<(), ExplorerEntityRuntimeError> {
        if self.entities.contains_key(&guid) {
            return Err(ExplorerEntityRuntimeError::AlreadyRegistered { guid });
        }
        Ok(())
    }

    pub(super) fn require_generation(
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

    pub(super) fn publish(
        &mut self,
        prepared: ExplorerPreparedEntity,
        physical_demand: LocalPhysicalDemand,
        generation: u64,
    ) -> ExplorerEntityInstance {
        let ExplorerPreparedEntity {
            presentation_class,
            primary_movement_sphere,
            definition,
        } = prepared;
        let instance = ExplorerEntityInstance {
            generation,
            physical_demand,
            presentation_class,
            primary_movement_sphere,
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

    pub(super) fn replace(
        &mut self,
        prepared: ExplorerPreparedEntity,
        physical_demand: LocalPhysicalDemand,
        generation: u64,
    ) -> (ExplorerEntityInstance, ExplorerEntityInstance) {
        let ExplorerPreparedEntity {
            presentation_class,
            primary_movement_sphere,
            definition,
        } = prepared;
        let guid = definition.identity.guid;
        let installed = ExplorerEntityInstance {
            generation,
            physical_demand,
            presentation_class,
            primary_movement_sphere,
            definition,
        };
        let removed = self
            .entities
            .insert(guid, installed.clone())
            .expect("prevalidated replacement entity vanished while registry lock was held");
        (removed, installed)
    }

    pub(super) fn remove(&mut self, guid: Guid) -> ExplorerEntityInstance {
        if self
            .selection
            .as_ref()
            .is_some_and(|selection| selection.target.guid == guid)
        {
            self.selection = None;
        }
        self.entities
            .remove(&guid)
            .expect("prevalidated entity vanished while registry lock was held")
    }

    pub(super) fn reset(&mut self) -> Vec<ExplorerEntityInstance> {
        let removed = std::mem::take(&mut self.entities).into_values().collect();
        self.allocator.reset();
        self.motion.release();
        self.motion = ExplorerMotionState::default();
        self.selection = None;
        removed
    }
}
