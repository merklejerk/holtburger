//! Explorer-local dynamic-entity identity, semantic lifetime, and ordered body orchestration.

mod possession;
mod registry;
#[cfg(test)]
mod tests;
pub mod types;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use anyhow::Context;
use holtburger_common::Guid;
use holtburger_content::MotionSequenceCatalog;
use holtburger_core::{
    DynamicEntityDefinition, DynamicEntityInitialState, DynamicEntityLaunchPlan,
    dynamic_entity_projection_input_from_body,
};
use holtburger_world::motion::{BodyMotionRuntime, MotionOrder};
use holtburger_world::{
    DynamicPhysicalBodyConfiguration, DynamicPhysicalBodyDefinition, EffectiveEntityPhysicsState,
    EntityPlacement, LocalPhysicalDemand, PhysicalBodyDefinition, SpatialBodyId,
    gate_authored_offset, resolve_effective_entity_physics_state,
};

use self::possession::propose_possession_tick;
use self::registry::ExplorerEntityRegistry;
pub use self::types::*;
use crate::ExplorerPhysicalMode;
use crate::explorer_entity_driver::explorer_physical_demand;
use crate::explorer_possession_control::ExplorerPossessionControlProfile;
use crate::host_simulation_runtime::{HostDynamicBodyTick, HostSimulationRuntime};

/// Ordered Explorer composition joining its semantic registry to its distinct host body scene.
pub struct ExplorerEntityRuntime {
    // Every operation acquires this registry lock before entering the simulation runtime. The
    // collection tick holds it across one simulation transaction, so instance generations cannot
    // retire between solve acceptance and projection and no callback inverts the lock order.
    pub(super) registry: Mutex<ExplorerEntityRegistry>,
    pub(super) simulation: Arc<HostSimulationRuntime>,
    /// Shared motion contract, projected once at startup and read by every possession.
    pub(super) motion_catalog: Arc<MotionSequenceCatalog>,
    /// App-owned resolved numeric policy injected once and copied into fixed-tick decisions.
    pub(super) possession_profile: ExplorerPossessionControlProfile,
}

impl ExplorerEntityRuntime {
    /// Composes an empty Explorer registry over the app's canonical host simulation runtime.
    pub fn new(
        simulation: Arc<HostSimulationRuntime>,
        motion_catalog: Arc<MotionSequenceCatalog>,
        possession_profile: ExplorerPossessionControlProfile,
    ) -> Self {
        Self {
            registry: Mutex::new(ExplorerEntityRegistry::default()),
            simulation,
            motion_catalog,
            possession_profile,
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
            possession_profile: ExplorerPossessionControlProfile::standard()
                .expect("standard Explorer possession profile is valid"),
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
        prepared: ExplorerPreparedEntity,
        physical_mode: ExplorerPhysicalMode,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntitySpawnOutcome, ExplorerEntityRuntimeError> {
        self.spawn_prepared_group(prepared, physical_mode, physical, Vec::new())
    }

    /// Installs one world-placed wearer and publishes its bodyless attached children atomically.
    pub fn spawn_prepared_group(
        &self,
        prepared: ExplorerPreparedEntity,
        physical_mode: ExplorerPhysicalMode,
        physical: Option<DynamicPhysicalBodyDefinition>,
        children: Vec<ExplorerPreparedEntity>,
    ) -> Result<ExplorerEntitySpawnOutcome, ExplorerEntityRuntimeError> {
        let physical_demand = explorer_physical_demand(physical_mode, prepared.definition.physics);
        validate_prepared_demand(physical_demand, physical.is_some())?;
        let object_scale = prepared.definition.object_scale;
        let physical = physical.map(|physical| {
            DynamicPhysicalBodyConfiguration::with_object_scale(
                physical,
                physical_demand,
                object_scale,
            )
            .expect("prepared Explorer body must have non-empty demand")
        });
        let guid = prepared.definition.identity.guid;
        validate_attached_children(guid, &children)?;
        let (prepared, children) = self.resolve_group_motion_tables(prepared, children);
        let (physical, initial_playback) =
            self.prepare_initial_collision_playback(&prepared.definition, physical)?;
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.require_absent(guid)?;
        for child in &children {
            registry.require_absent(child.definition.identity.guid)?;
        }
        let generation = registry.reserve_generation()?;
        let child_generations = children
            .iter()
            .map(|_| registry.reserve_generation())
            .collect::<Result<Vec<_>, _>>()?;
        let initial = require_world_initial(&prepared.definition, "spawn")?;
        let body =
            self.simulation
                .install_dynamic_entity(&prepared.definition, initial, physical)?;
        if let Some(playback) = initial_playback {
            registry.motion.playback.replace_body(guid, playback);
        }
        let instance = registry.publish(prepared, physical_demand, generation);
        let children = children
            .into_iter()
            .zip(child_generations)
            .map(|(child, generation)| {
                registry.publish(child, LocalPhysicalDemand::NONE, generation)
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
        prepared: ExplorerPreparedEntity,
        expected_generation: u64,
        physical_mode: ExplorerPhysicalMode,
        physical: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntityReplacementOutcome, ExplorerEntityRuntimeError> {
        self.replace_prepared_group(
            prepared,
            expected_generation,
            physical_mode,
            physical,
            Vec::new(),
        )
    }

    /// Replaces one wearer and cleanly cuts over its complete attached-child set.
    pub fn replace_prepared_group(
        &self,
        prepared: ExplorerPreparedEntity,
        expected_generation: u64,
        physical_mode: ExplorerPhysicalMode,
        physical: Option<DynamicPhysicalBodyDefinition>,
        children: Vec<ExplorerPreparedEntity>,
    ) -> Result<ExplorerEntityReplacementOutcome, ExplorerEntityRuntimeError> {
        let physical_demand = explorer_physical_demand(physical_mode, prepared.definition.physics);
        validate_prepared_demand(physical_demand, physical.is_some())?;
        let object_scale = prepared.definition.object_scale;
        let physical = physical.map(|physical| {
            DynamicPhysicalBodyConfiguration::with_object_scale(
                physical,
                physical_demand,
                object_scale,
            )
            .expect("prepared Explorer body must have non-empty demand")
        });
        let guid = prepared.definition.identity.guid;
        validate_attached_children(guid, &children)?;
        let (prepared, children) = self.resolve_group_motion_tables(prepared, children);
        let (physical, initial_playback) =
            self.prepare_initial_collision_playback(&prepared.definition, physical)?;
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        registry.require_generation(guid, expected_generation)?;
        for child in &children {
            registry.require_absent(child.definition.identity.guid)?;
        }
        let removed_child_guids = child_guids(&registry, guid);
        let generation = registry.reserve_generation()?;
        let child_generations = children
            .iter()
            .map(|_| registry.reserve_generation())
            .collect::<Result<Vec<_>, _>>()?;
        let initial = require_world_initial(&prepared.definition, "replacement")?;
        let body =
            self.simulation
                .replace_dynamic_entity(&prepared.definition, initial, physical)?;
        registry.motion.retire_target(guid, expected_generation);
        registry.motion.playback.clear_locomotion(guid);
        if let Some(playback) = initial_playback {
            registry.motion.playback.replace_body(guid, playback);
        }
        let (removed, installed) = registry.replace(prepared, physical_demand, generation);
        let removed_children = removed_child_guids
            .into_iter()
            .map(|child| registry.remove(child))
            .collect();
        let installed_children = children
            .into_iter()
            .zip(child_generations)
            .map(|(child, generation)| {
                registry.publish(child, LocalPhysicalDemand::NONE, generation)
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
        registry.motion.retire_target(guid, expected_generation);
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
        next_demand: LocalPhysicalDemand,
        replacement: Option<DynamicPhysicalBodyDefinition>,
    ) -> Result<ExplorerEntityPhysicsStateOutcome, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        require_world_initial(&instance.definition, "physics-state replacement")?;
        let outcome = self.simulation.reconfigure_dynamic_entity_physics(
            SpatialBodyId::Entity(guid),
            next,
            next_demand,
            instance.definition.object_scale,
            replacement,
        )?;
        let current = registry
            .entities
            .get_mut(&guid)
            .expect("prevalidated entity vanished while registry lock was held");
        current.definition.physics = next;
        current.physical_demand = next_demand;
        Ok(ExplorerEntityPhysicsStateOutcome {
            instance: current.clone(),
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

    /// Reports whether the next demand needs content preparation for the current pose body.
    pub fn physical_preparation_required(
        &self,
        guid: Guid,
        expected_generation: u64,
        next_demand: LocalPhysicalDemand,
    ) -> Result<bool, ExplorerEntityRuntimeError> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry.require_generation(guid, expected_generation)?;
        require_world_initial(&instance.definition, "physics-state planning")?;
        let projection = self
            .simulation
            .project_dynamic_entity(&instance.definition)?;
        Ok(next_demand.requires_physical_body()
            && projection.placement.world().is_some_and(|world| {
                world.participation == holtburger_world::PhysicalBodyParticipation::PoseOnly
            }))
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
            presentation_class: instance.presentation_class,
            input,
            motion: registry.motion.playback.motion_playback(guid),
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
                    presentation_class: instance.presentation_class,
                    input: self
                        .simulation
                        .project_dynamic_entity(&instance.definition)?,
                    motion: registry
                        .motion
                        .playback
                        .motion_playback(instance.definition.identity.guid),
                })
            })
            .collect()
    }

    /// Samples one initial cursor for both collision preparation and installed playback.
    fn prepare_initial_collision_playback(
        &self,
        definition: &DynamicEntityDefinition,
        physical: Option<DynamicPhysicalBodyConfiguration>,
    ) -> Result<
        (
            Option<DynamicPhysicalBodyConfiguration>,
            Option<BodyMotionRuntime>,
        ),
        ExplorerEntityRuntimeError,
    > {
        let guid = definition.identity.guid;
        let needs_collision_pose = physical.as_ref().is_some_and(|configuration| {
            !configuration
                .definition()
                .entity_collision
                .target_geometry
                .physics_bsp_parts
                .is_empty()
        });
        let initial_playback = definition
            .content
            .motion_table_did
            .filter(|_| needs_collision_pose)
            .map(|table_id| {
                self.motion_catalog
                    .table(table_id)
                    .map(BodyMotionRuntime::new)
                    .ok_or(ExplorerEntityRuntimeError::UnprojectedMotionTable {
                        guid,
                        motion_table_id: table_id,
                    })
            })
            .transpose()?;
        let initial_pose = initial_playback.as_ref().map_or(
            holtburger_world::motion::AuthoredCollisionPose::Placement,
            BodyMotionRuntime::collision_pose,
        );
        let physical = physical
            .map(|configuration| {
                configuration
                    .with_collision_pose(initial_pose, None)
                    .map_err(|error| ExplorerEntityRuntimeError::InvalidCollisionPose {
                        guid,
                        cause: error.to_string(),
                    })
            })
            .transpose()?;
        Ok((physical, initial_playback))
    }

    /// Resolves each definition's setup-default motion table before the group becomes contract.
    ///
    /// The entity's own property is the override; absent, the setup's default is the table it
    /// really animates from. Resolving once here is what lets every consumer — including a frontend
    /// that stages a closure for this exact id and has no setup catalog to consult — read the table
    /// an entity animates from rather than repeat the lookup.
    fn resolve_group_motion_tables(
        &self,
        prepared: ExplorerPreparedEntity,
        children: Vec<ExplorerPreparedEntity>,
    ) -> (ExplorerPreparedEntity, Vec<ExplorerPreparedEntity>) {
        let mut resolve = |mut prepared: ExplorerPreparedEntity| {
            prepared.definition.content.motion_table_did =
                prepared.definition.content.motion_table_did.or_else(|| {
                    self.motion_catalog
                        .default_motion_table_for_setup(prepared.definition.content.setup_did)
                });
            prepared
        };
        let children = children.into_iter().map(&mut resolve).collect();
        (resolve(prepared), children)
    }

    /// Advances unpossessed authored playback independently from controller/body acceptance.
    ///
    /// Every entity plays, not only the possessed one: an unpossessed entity idles from its
    /// motion table's default style and substate, which is what retail installs for any
    /// non-static object. Possessed playback is deliberately excluded because its proposal
    /// commits only with the exact body's accepted solve.
    ///
    /// An entity whose table is absent from the contract, or which declares none, simply has no
    /// playback. That is not a failure — it is an object that does not animate.
    fn advance_unpossessed_motion(
        &self,
        registry: &mut ExplorerEntityRegistry,
        delta_seconds: f32,
    ) -> BTreeMap<Guid, holtburger_common::RigidTransform> {
        let mut offsets = BTreeMap::new();
        let target_is_retired = registry.motion.active.as_ref().is_some_and(|active| {
            registry
                .entities
                .get(&active.guid)
                .is_none_or(|instance| instance.generation != active.entity_generation)
        });
        if target_is_retired {
            // The possessed entity retired underneath us; drop the possession with it.
            registry.motion.release();
        }
        let entities = &registry.entities;
        registry.motion.playback.retain_locomotion(|guid| {
            entities.get(&guid).is_some_and(|instance| {
                instance.physical_demand.integration
                    == holtburger_world::LocalIntegrationDemand::Eligible
                    && !instance.definition.physics.dynamic_collision.missile
            })
        });
        let possessed = registry.motion.active.as_ref().map(|active| active.guid);
        let driving: Vec<(Guid, u32)> = registry
            .entities
            .iter()
            .filter_map(|(guid, instance)| {
                if possessed == Some(*guid) {
                    return None;
                }
                Some((*guid, instance.definition.content.motion_table_did?))
            })
            .collect();

        let live: BTreeSet<Guid> = registry
            .entities
            .iter()
            .filter(|(_, instance)| instance.definition.content.motion_table_did.is_some())
            .map(|(guid, _)| *guid)
            .collect();
        registry
            .motion
            .playback
            .retain_bodies(|guid| live.contains(&guid));

        for (guid, motion_table_id) in driving {
            let Some(table) = self.motion_catalog.table(motion_table_id) else {
                continue;
            };
            let offset = registry
                .motion
                .playback
                .drive(table, guid, MotionOrder::default(), delta_seconds)
                .offset;

            // A body that proved stable support has dropped out of the collection scan. Whether it
            // should be back in is a property of what its playback installed, not of how large this
            // tick's offset came out — the same distinction Phase 3 settled for the client basis.
            //
            // An unpublished clip is the other reason to be in it. An idle contributes no motion,
            // so a settled entity would never be scanned again and its level would never reach a
            // consumer — the tick is the only carrier a scheduled body has.
            let moving = registry
                .motion
                .playback
                .get(guid)
                .is_some_and(|runtime| runtime.sequence().contributes_motion());
            if moving {
                offsets.insert(guid, offset);
            }
            if moving || registry.motion.motion_awaits_publication(guid) {
                self.simulation
                    .wake_dynamic_body(SpatialBodyId::Entity(guid));
            }
        }
        offsets
    }

    /// Advances every eligible physical instance in one generation-stable collection transaction.
    ///
    /// Every accepted body tick leaves this host boundary. `publish` records the existing frontend
    /// filter without deleting stable possessed-body evidence needed by same-epoch followers.
    pub fn tick_physical_collection(
        &self,
        delta_seconds: f32,
        now: std::time::Instant,
    ) -> anyhow::Result<ExplorerEntityCollectionTick> {
        anyhow::ensure!(
            delta_seconds.is_finite() && delta_seconds > 0.0,
            "explorer collection interval must be finite and positive"
        );
        // Playback and the motor consume the same admitted time, including after a slow frame.
        let delta_seconds = holtburger_world::admit_physical_duration(
            std::time::Duration::from_secs_f32(delta_seconds),
        )
        .as_secs_f32();
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let offsets = self.advance_unpossessed_motion(&mut registry, delta_seconds);
        let collision_samples = registry
            .entities
            .keys()
            .filter(|guid| {
                registry
                    .motion
                    .active
                    .as_ref()
                    .is_none_or(|active| active.guid != **guid)
            })
            .filter_map(|guid| {
                registry
                    .motion
                    .playback
                    .get(*guid)
                    .map(|runtime| (SpatialBodyId::Entity(*guid), runtime.collision_pose()))
            })
            .collect::<Vec<_>>();
        self.simulation
            .publish_collision_poses(&collision_samples)?;
        let possession = registry.motion.active.clone().and_then(|active| {
            let instance = registry.entities.get(&active.guid)?;
            (instance.generation == active.entity_generation).then_some((
                active,
                instance.definition.object_scale,
                registry
                    .motion
                    .playback
                    .get(instance.definition.identity.guid)
                    .cloned(),
            ))
        });
        if let Some((active, _, _)) = &possession {
            // A possessed target is also a host-follow anchor. It must author a held path every
            // epoch even after ordinary dynamic settling would remove it from the active scan.
            self.simulation
                .wake_dynamic_body(SpatialBodyId::Entity(active.guid));
        }
        let mut proposal = None;
        let collection = self.simulation.tick_dynamic_entity_collection(
            delta_seconds,
            now,
            possession.is_some(),
            |body| match possession.as_ref() {
                Some((active, object_scale, previous_playback))
                    if body.id == SpatialBodyId::Entity(active.guid) =>
                {
                    let table = self
                        .motion_catalog
                        .table(active.motion_table_id)
                        .context("active possession motion table vanished")?;
                    let (next, actuation) = propose_possession_tick(
                        active.clone(),
                        previous_playback.as_ref(),
                        table,
                        body,
                        *object_scale,
                        self.possession_profile,
                        delta_seconds,
                    )?;
                    let collision_pose = next.playback.collision_pose();
                    assert!(
                        proposal.replace(next).is_none(),
                        "possessed body scheduled twice"
                    );
                    Ok(holtburger_world::PhysicalBodyInput::autonomous(actuation)
                        .with_collision_pose(collision_pose))
                }
                _ => {
                    let actuation =
                        crate::host_simulation_runtime::dynamic_entity_coasting_actuation(body)?;
                    let Some(guid) = body.id.authoritative_guid() else {
                        anyhow::bail!("Explorer collection body has no entity identity");
                    };
                    let Some(offset) = offsets.get(&guid) else {
                        return Ok(holtburger_world::PhysicalBodyInput::autonomous(actuation));
                    };
                    let instance = registry
                        .entities
                        .get(&guid)
                        .expect("scheduled entity lost its registry instance");
                    let physical = body
                        .physical
                        .as_ref()
                        .expect("scheduled entity lost its physical definition");
                    let offset =
                        if matches!(physical.definition, PhysicalBodyDefinition::Grounded { .. }) {
                            gate_authored_offset(
                                *offset,
                                body.contact,
                                instance.definition.object_scale,
                            )
                        } else {
                            holtburger_common::RigidTransform {
                                translation: offset.translation * instance.definition.object_scale,
                                ..*offset
                            }
                        };
                    Ok(holtburger_world::PhysicalBodyInput::referenced(
                        actuation,
                        holtburger_world::PhysicalReferenceInput::body(Some(offset)),
                        false,
                    ))
                }
            },
        )?;

        let mut possession_outcomes = BTreeMap::new();
        if let (Some((expected, _, _)), Some(mut accepted)) = (possession.as_ref(), proposal)
            && let Some(solved) = collection
                .bodies
                .iter()
                .find(|tick| tick.current.id == SpatialBodyId::Entity(expected.guid))
            && registry.motion.active.as_ref().is_some_and(|active| {
                active.generation == expected.generation
                    && active.entity_generation == expected.entity_generation
            })
        {
            registry.motion.last_physical_status = Some(ExplorerPossessionPhysicalStatus::Solved);
            registry.motion.last_effective_planar_speed = Some(
                solved
                    .current
                    .accepted_motion
                    .velocity
                    .x
                    .hypot(solved.current.accepted_motion.velocity.y),
            );
            let table = self
                .motion_catalog
                .table(expected.motion_table_id)
                .expect("active possession motion table vanished while registry lock was held");
            accepted.reconcile_playback(table, solved.current.contact)?;
            possession_outcomes.insert(expected.guid, accepted.outcomes);
            registry
                .motion
                .playback
                .replace_body(expected.guid, accepted.playback);
            registry.motion.active = Some(accepted.active);
        }

        // A rejected tick can also have an accepted prefix; coverage retirement wins over it.
        let uncovered: BTreeSet<Guid> = collection
            .coverage_rejections
            .iter()
            .filter_map(|rejection| match rejection.body.id {
                SpatialBodyId::Entity(guid) => Some(guid),
                _ => None,
            })
            .collect();
        for &guid in &uncovered {
            registry.motion.playback.clear_locomotion(guid);
        }
        let live: BTreeSet<Guid> = registry.entities.keys().copied().collect();
        registry.motion.retain_published(&live);
        let outcome_guids: BTreeSet<Guid> = possession_outcomes.keys().copied().collect();
        let registry = &mut *registry;
        let ticks = collection
            .bodies
            .into_iter()
            .map(|solved| {
                let SpatialBodyId::Entity(guid) = solved.current.id else {
                    anyhow::bail!("dynamic-entity collection returned a non-entity body")
                };
                let instance = registry.entities.get_mut(&guid).with_context(|| {
                    format!(
                        "dynamic-entity body 0x{:08X} has no Explorer semantic instance",
                        guid.0
                    )
                })?;
                if let Some(change) = solved.dynamic_state_change {
                    instance.definition.physics = resolve_effective_entity_physics_state(
                        instance.definition.physics.semantic & !change.cleared,
                    );
                }
                let generation = instance.generation;
                let presentation_class = instance.presentation_class;
                let input = dynamic_entity_projection_input_from_body(
                    &instance.definition,
                    &solved.current,
                )?;
                if !uncovered.contains(&guid) {
                    registry.motion.observe_body(
                        &self.motion_catalog,
                        &instance.definition,
                        &solved,
                        delta_seconds,
                    )?;
                }
                // A motion-presentation change is worth publishing even when the body did not
                // move. Possessed playback is sampled only after its accepted proposal commits,
                // so a held solve cannot leak a presentation level.
                let (motion, motion_changed) = registry.motion.commit_published_motion(guid);
                let publish = physical_tick_changed(&solved)
                    || motion_changed
                    || outcome_guids.contains(&guid);
                Ok(ExplorerEntityPhysicalTick {
                    publish,
                    motion,
                    possession_event_outcomes: possession_outcomes
                        .remove(&guid)
                        .unwrap_or_default(),
                    generation,
                    presentation_class,
                    input,
                    solved,
                })
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        let possession = possession.and_then(|(active, _, _)| {
            (ticks
                .iter()
                .any(|tick| tick.solved.current.id == SpatialBodyId::Entity(active.guid))
                || collection
                    .coverage_rejections
                    .iter()
                    .any(|rejection| rejection.body.id == SpatialBodyId::Entity(active.guid)))
            .then_some(ExplorerPossessedBodyEpoch {
                guid: active.guid,
                entity_generation: active.entity_generation,
                possession_generation: active.generation,
            })
        });
        Ok(ExplorerEntityCollectionTick {
            entity_collision: collection.entity_collision,
            ticks,
            coverage_rejections: collection.coverage_rejections,
            possession,
        })
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

fn physical_tick_changed(tick: &HostDynamicBodyTick) -> bool {
    tick.dynamic_state_change.is_some()
        || tick.previous.runtime_view() != tick.current.runtime_view()
        || tick
            .path
            .legs()
            .iter()
            .any(|leg| leg.end() != tick.path.initial())
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
    children: &[ExplorerPreparedEntity],
) -> Result<(), ExplorerEntityRuntimeError> {
    let mut identities = BTreeSet::new();
    for prepared in children {
        let child = &prepared.definition;
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

fn validate_prepared_demand(
    demand: LocalPhysicalDemand,
    has_physical: bool,
) -> Result<(), ExplorerEntityRuntimeError> {
    match (demand.requires_physical_body(), has_physical) {
        (true, false) => Err(ExplorerEntityRuntimeError::MissingPreparedPhysics),
        (false, true) => Err(ExplorerEntityRuntimeError::UnexpectedPreparedPhysics),
        _ => Ok(()),
    }
}
