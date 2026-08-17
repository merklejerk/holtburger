//! One fixed-tick participant for the complete Explorer dynamic-entity collection.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use anyhow::Error;
use holtburger_core::DynamicEntityEvent;
use tauri::{AppHandle, Emitter};

use crate::explorer_entity_delivery::{EXPLORER_DYNAMIC_ENTITY_EVENT, ExplorerEntityDelivery};
use crate::explorer_entity_runtime::ExplorerEntityRuntime;
use crate::host_fixed_tick_runtime::{HostFixedTickDisposition, HostFixedTickParticipant};

/// Injectable publication boundary; tests need no Tauri application or retained event history.
pub trait DynamicEntityEventSink: Send + Sync {
    /// Publishes one current focused event to interested frontend listeners.
    fn publish(&self, event: DynamicEntityEvent) -> anyhow::Result<()>;
}

/// Production sink over the application-wide focused dynamic-entity event name.
pub struct TauriDynamicEntityEventSink {
    app: AppHandle,
}

impl TauriDynamicEntityEventSink {
    /// Binds publication to the running Tauri application handle.
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl DynamicEntityEventSink for TauriDynamicEntityEventSink {
    fn publish(&self, event: DynamicEntityEvent) -> anyhow::Result<()> {
        self.app.emit(EXPLORER_DYNAMIC_ENTITY_EVENT, event)?;
        Ok(())
    }
}

/// Scheduler-boundary control over collection integration time.
///
/// Pausing skips whole fixed ticks, so no integration time elapses; it never mutates entity,
/// body, or collision-report state and never unregisters the participant. A queued step permits
/// exactly one ordinary fixed-delta tick while paused, which keeps stepping deterministic: every
/// integrated tick uses the same cadence the running scheduler would.
#[derive(Default)]
pub struct ExplorerSimulationControl {
    paused: AtomicBool,
    pending_steps: AtomicU32,
}

impl ExplorerSimulationControl {
    /// Pauses or resumes collection integration; resuming discards no state.
    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::Relaxed);
        if !paused {
            self.pending_steps.store(0, Ordering::Relaxed);
        }
    }

    /// Queues exactly one fixed-delta integration step; only observed while paused.
    pub fn request_step(&self) {
        self.pending_steps.fetch_add(1, Ordering::Relaxed);
    }

    /// Whether the next fixed tick should integrate, consuming one queued step while paused.
    fn take_tick(&self) -> bool {
        if !self.paused.load(Ordering::Relaxed) {
            return true;
        }
        self.pending_steps
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |pending| {
                pending.checked_sub(1)
            })
            .is_ok()
    }
}

/// Collection-owned simulation adapter installed in exactly one stable scheduler slot.
pub struct ExplorerEntitySimulation {
    entities: Arc<ExplorerEntityRuntime>,
    delivery: Arc<ExplorerEntityDelivery>,
    sink: Arc<dyn DynamicEntityEventSink>,
    control: Arc<ExplorerSimulationControl>,
    /// Injected host clock so pause/step and report-expiry tests never sleep.
    clock: Box<dyn Fn() -> Instant + Send + Sync>,
}

impl ExplorerEntitySimulation {
    /// Composes the participant without introducing another registry or event relay.
    pub fn new(
        entities: Arc<ExplorerEntityRuntime>,
        delivery: Arc<ExplorerEntityDelivery>,
        sink: Arc<dyn DynamicEntityEventSink>,
        control: Arc<ExplorerSimulationControl>,
    ) -> Self {
        Self::with_clock(entities, delivery, sink, control, Box::new(Instant::now))
    }

    /// Composes the participant over an explicit host clock.
    pub fn with_clock(
        entities: Arc<ExplorerEntityRuntime>,
        delivery: Arc<ExplorerEntityDelivery>,
        sink: Arc<dyn DynamicEntityEventSink>,
        control: Arc<ExplorerSimulationControl>,
        clock: Box<dyn Fn() -> Instant + Send + Sync>,
    ) -> Self {
        Self {
            entities,
            delivery,
            sink,
            control,
            clock,
        }
    }
}

impl HostFixedTickParticipant for ExplorerEntitySimulation {
    fn fixed_tick(&self, delta: Duration) -> anyhow::Result<HostFixedTickDisposition> {
        if !self.control.take_tick() {
            return Ok(HostFixedTickDisposition::Continue);
        }
        let event = self.delivery.with_ordered_publication(|| {
            let ticks = self
                .entities
                .tick_physical_collection(delta.as_secs_f32(), (self.clock)())?;
            self.delivery.advanced(ticks, delta)
        })?;
        if let Some(event) = event
            && let Err(error) = self.sink.publish(event)
        {
            // Accepted solver state is authoritative even if no listener receives this delta. A
            // later focused snapshot reconstructs it, so publication failure must not unregister
            // the collection participant or manufacture rollback state.
            eprintln!("failed to publish Explorer dynamic-entity advance: {error:#}");
        }
        Ok(HostFixedTickDisposition::Continue)
    }

    fn fixed_tick_failed(&self, error: &Error) {
        eprintln!(
            "Explorer dynamic-entity simulation stopped after a terminal tick error: {error:#}"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PhysicsState, WeenieType};
    use holtburger_common::{Guid, Quaternion, Sphere, Vector3};
    use holtburger_content::{ColliderScale, LandblockCollisionAsset};
    use holtburger_core::{
        DynamicEntityContent, DynamicEntityDefinition, DynamicEntityDefinitionInput,
        DynamicEntityIdentity, DynamicEntityInitialState,
    };
    use holtburger_world::{
        DynamicBodyCollisionDefinition, DynamicPhysicalBodyDefinition, EdgeProtection,
        EntityAppearance, EntityCollisionParticipation, EntityCollisionReportPolicy,
        EntityDynamicCollisionPolicy, EntityPhysicalIntent, EntityPhysicsScheduling,
        PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction, PhysicalRestitution,
        PhysicalSphereSet, PhysicalSurfaceMotion, PreparedEntityTargetGeometry,
        resolve_effective_entity_physics_state,
    };

    use crate::host_fixed_tick_runtime::HOST_FIXED_TICK_HZ;
    use crate::host_simulation_runtime::{CollisionSource, HostSimulationRuntime};

    #[derive(Default)]
    struct EmptyCollisionSource;

    impl CollisionSource for EmptyCollisionSource {
        fn load_collision(
            &self,
            _landblock_id: u32,
        ) -> anyhow::Result<Option<LandblockCollisionAsset>> {
            Ok(None)
        }
    }

    #[derive(Default)]
    struct RecordingSink {
        events: Mutex<Vec<DynamicEntityEvent>>,
    }

    impl DynamicEntityEventSink for RecordingSink {
        fn publish(&self, event: DynamicEntityEvent) -> anyhow::Result<()> {
            self.events.lock().unwrap().push(event);
            Ok(())
        }
    }

    #[test]
    fn empty_collection_keeps_its_one_participant_without_publishing() {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let entities = Arc::new(ExplorerEntityRuntime::new(simulation));
        let delivery = Arc::new(ExplorerEntityDelivery::new(Arc::clone(&entities)));
        let sink = Arc::new(RecordingSink::default());
        let participant = ExplorerEntitySimulation::new(
            entities,
            delivery,
            sink.clone(),
            Arc::new(ExplorerSimulationControl::default()),
        );

        assert_eq!(
            participant
                .fixed_tick(Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ))
                .unwrap(),
            HostFixedTickDisposition::Continue
        );
        assert!(sink.events.lock().unwrap().is_empty());
    }

    #[test]
    fn one_collection_tick_publishes_one_changed_entity_batch() {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let entities = Arc::new(ExplorerEntityRuntime::new(simulation));
        let guid = entities.reserve_guid().unwrap();
        let spawned = entities
            .spawn_prepared(
                definition(guid),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let delivery = Arc::new(ExplorerEntityDelivery::new(Arc::clone(&entities)));
        let sink = Arc::new(RecordingSink::default());
        let participant = ExplorerEntitySimulation::new(
            entities,
            delivery,
            sink.clone(),
            Arc::new(ExplorerSimulationControl::default()),
        );

        participant
            .fixed_tick(Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ))
            .unwrap();

        let events = sink.events.lock().unwrap();
        let [DynamicEntityEvent::Advanced { batch }] = events.as_slice() else {
            panic!("one changed collection tick must publish one advance batch")
        };
        assert_eq!(batch.advances.len(), 1);
        assert_eq!(batch.advances[0].entity.identity.guid, guid);
        assert_eq!(
            batch.advances[0].entity.generation,
            spawned.instance.generation
        );
        assert_eq!(
            batch.advances[0].path.legs.last().unwrap().end_fraction,
            1.0
        );
    }

    #[test]
    fn paused_collection_skips_integration_and_resume_continues_from_retained_state() {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let entities = Arc::new(ExplorerEntityRuntime::new(simulation));
        let guid = entities.reserve_guid().unwrap();
        entities
            .spawn_prepared(
                definition(guid),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let delivery = Arc::new(ExplorerEntityDelivery::new(Arc::clone(&entities)));
        let sink = Arc::new(RecordingSink::default());
        let control = Arc::new(ExplorerSimulationControl::default());
        let origin = Instant::now();
        let participant = ExplorerEntitySimulation::with_clock(
            entities,
            delivery,
            sink.clone(),
            Arc::clone(&control),
            Box::new(move || origin),
        );
        let delta = Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ);

        control.set_paused(true);
        for _ in 0..3 {
            assert_eq!(
                participant.fixed_tick(delta).unwrap(),
                HostFixedTickDisposition::Continue,
                "paused ticks keep the participant registered"
            );
        }
        assert!(
            sink.events.lock().unwrap().is_empty(),
            "paused ticks integrate nothing and publish nothing"
        );

        control.set_paused(false);
        participant.fixed_tick(delta).unwrap();
        let events = sink.events.lock().unwrap();
        assert!(
            matches!(events.as_slice(), [DynamicEntityEvent::Advanced { .. }]),
            "resume integrates the retained falling body on the next ordinary tick"
        );
    }

    #[test]
    fn queued_steps_integrate_exactly_once_per_request_while_paused() {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let entities = Arc::new(ExplorerEntityRuntime::new(simulation));
        let guid = entities.reserve_guid().unwrap();
        entities
            .spawn_prepared(
                definition(guid),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let delivery = Arc::new(ExplorerEntityDelivery::new(Arc::clone(&entities)));
        let sink = Arc::new(RecordingSink::default());
        let control = Arc::new(ExplorerSimulationControl::default());
        let origin = Instant::now();
        let participant = ExplorerEntitySimulation::with_clock(
            entities,
            delivery,
            sink.clone(),
            Arc::clone(&control),
            Box::new(move || origin),
        );
        let delta = Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ);

        control.set_paused(true);
        control.request_step();
        participant.fixed_tick(delta).unwrap();
        participant.fixed_tick(delta).unwrap();
        assert_eq!(
            sink.events.lock().unwrap().len(),
            1,
            "one queued step permits exactly one integrated fixed tick"
        );

        // Resuming discards queued steps: pause again and confirm no stale step leaks through.
        control.request_step();
        control.set_paused(false);
        control.set_paused(true);
        participant.fixed_tick(delta).unwrap();
        assert_eq!(
            sink.events.lock().unwrap().len(),
            1,
            "resume clears queued steps instead of banking them"
        );
    }

    fn definition(guid: Guid) -> DynamicEntityDefinition {
        DynamicEntityDefinition::prepare(DynamicEntityDefinitionInput {
            identity: DynamicEntityIdentity {
                guid,
                wcid: 1,
                name: "Test Entity".to_owned(),
                weenie_type: WeenieType::Creature,
            },
            content: DynamicEntityContent {
                setup_did: 0x0200_0001,
                sound_table_did: None,
                physics_effect_table_did: None,
            },
            appearance: EntityAppearance::default(),
            initial: DynamicEntityInitialState {
                pose: WorldPosition {
                    landblock_id: Guid(0xda55_0001),
                    coords: Vector3::new(96.0, 96.0, 10.0),
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
}
