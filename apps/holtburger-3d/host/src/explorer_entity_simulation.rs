//! One fixed-tick participant for the complete Explorer dynamic-entity collection.

use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::explorer_entity_delivery::{ExplorerEntityDelivery, ExplorerFixedTickEnvelope};
use crate::explorer_entity_runtime::{ExplorerEntityRuntime, PossessionEventOutcome};
use crate::host_fixed_tick_runtime::{HostFixedTickDisposition, HostFixedTickParticipant};
use crate::host_kinematic_boom_runtime::HostKinematicBoomRuntime;
use anyhow::Error;

/// Injectable publication boundary; tests need no desktop application or retained event history.
pub trait DynamicEntityEventSink: Send + Sync {
    /// Publishes one current focused event to interested frontend listeners.
    fn publish(&self, envelope: ExplorerFixedTickEnvelope) -> anyhow::Result<()>;

    /// Publishes lifecycle outcomes committed with the same fixed-tick body transaction.
    fn publish_possession_outcomes(
        &self,
        outcomes: Vec<PossessionEventOutcome>,
    ) -> anyhow::Result<()>;
}

/// Collection-owned simulation adapter installed in exactly one stable scheduler slot.
pub struct ExplorerEntitySimulation {
    entities: Arc<ExplorerEntityRuntime>,
    delivery: Arc<ExplorerEntityDelivery>,
    boom: Arc<HostKinematicBoomRuntime>,
    sink: Arc<dyn DynamicEntityEventSink>,
}

impl ExplorerEntitySimulation {
    /// Composes the participant without introducing another registry or event relay.
    pub fn new(
        entities: Arc<ExplorerEntityRuntime>,
        delivery: Arc<ExplorerEntityDelivery>,
        boom: Arc<HostKinematicBoomRuntime>,
        sink: Arc<dyn DynamicEntityEventSink>,
    ) -> Self {
        Self {
            entities,
            delivery,
            boom,
            sink,
        }
    }
}

impl HostFixedTickParticipant for ExplorerEntitySimulation {
    fn fixed_tick(&self, delta: Duration) -> anyhow::Result<HostFixedTickDisposition> {
        let (envelope, outcomes) = self.delivery.with_ordered_publication(|| {
            let collection = self
                .entities
                .tick_physical_collection(delta.as_secs_f32(), Instant::now())?;
            let outcomes: Vec<PossessionEventOutcome> = collection
                .ticks
                .iter()
                .flat_map(|tick| tick.possession_event_outcomes.iter().copied())
                .collect();
            let boom = self.boom.advance(&collection, delta.as_secs_f32())?;
            Ok::<_, anyhow::Error>((
                self.delivery
                    .fixed_tick_envelope(collection.ticks, boom, delta)?,
                outcomes,
            ))
        })?;
        if let Some(envelope) = envelope
            && let Err(error) = self.sink.publish(envelope)
        {
            // Accepted solver state is authoritative even if no listener receives this delta. A
            // later focused snapshot reconstructs it, so publication failure must not unregister
            // the collection participant or manufacture rollback state.
            eprintln!("failed to publish Explorer fixed-tick envelope: {error:#}");
        }
        if !outcomes.is_empty()
            && let Err(error) = self.sink.publish_possession_outcomes(outcomes)
        {
            eprintln!("failed to publish Explorer possession outcomes: {error:#}");
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
        EntityPlacement, PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction,
        PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion,
        PreparedEntityTargetGeometry, resolve_effective_entity_physics_state,
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

    struct EmptySpaceCollisionSource;

    impl CollisionSource for EmptySpaceCollisionSource {
        fn load_collision(
            &self,
            landblock_id: u32,
        ) -> anyhow::Result<Option<LandblockCollisionAsset>> {
            Ok(Some(LandblockCollisionAsset {
                landblock_id,
                terrain: holtburger_content::TerrainCollisionSurface::empty(),
                static_geometry: holtburger_content::LandblockColliders::default(),
            }))
        }
    }

    fn empty_space_simulation() -> Arc<HostSimulationRuntime> {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(
            EmptySpaceCollisionSource,
        )));
        let session = simulation.reserve_interest_session();
        let landblock_ids = (0xd9..=0xdb)
            .flat_map(|x| (0x54..=0x56).map(move |y| format!("0x{x:02x}{y:02x}ffff")))
            .collect();
        let receipt = simulation
            .replace_interest(crate::host_simulation_runtime::SimulationInterestRequest {
                session,
                revision: 1,
                landblock_ids,
            })
            .unwrap();
        assert!(receipt.committed);
        assert!(receipt.unavailable_landblock_ids.is_empty());
        simulation
    }

    #[derive(Default)]
    struct RecordingSink {
        events: Mutex<Vec<ExplorerFixedTickEnvelope>>,
        possession_outcomes: Mutex<Vec<PossessionEventOutcome>>,
    }

    impl DynamicEntityEventSink for RecordingSink {
        fn publish(&self, envelope: ExplorerFixedTickEnvelope) -> anyhow::Result<()> {
            self.events.lock().unwrap().push(envelope);
            Ok(())
        }

        fn publish_possession_outcomes(
            &self,
            outcomes: Vec<PossessionEventOutcome>,
        ) -> anyhow::Result<()> {
            self.possession_outcomes.lock().unwrap().extend(outcomes);
            Ok(())
        }
    }

    #[test]
    fn empty_collection_keeps_its_one_participant_without_publishing() {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let entities = Arc::new(ExplorerEntityRuntime::new(
            Arc::clone(&simulation),
            Default::default(),
            crate::explorer_possession_control::ExplorerPossessionControlProfile::standard()
                .expect("standard Explorer possession profile is valid"),
        ));
        let delivery = Arc::new(ExplorerEntityDelivery::new(Arc::clone(&entities)));
        let boom =
            Arc::new(HostKinematicBoomRuntime::new(Arc::clone(&entities), simulation).unwrap());
        let sink = Arc::new(RecordingSink::default());
        let participant = ExplorerEntitySimulation::new(entities, delivery, boom, sink.clone());

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
        let simulation = empty_space_simulation();
        let entities = Arc::new(ExplorerEntityRuntime::new(
            Arc::clone(&simulation),
            Default::default(),
            crate::explorer_possession_control::ExplorerPossessionControlProfile::standard()
                .expect("standard Explorer possession profile is valid"),
        ));
        let guid = entities.reserve_guid().unwrap();
        let spawned = entities
            .spawn_prepared(
                definition(guid),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let delivery = Arc::new(ExplorerEntityDelivery::new(Arc::clone(&entities)));
        let boom =
            Arc::new(HostKinematicBoomRuntime::new(Arc::clone(&entities), simulation).unwrap());
        let sink = Arc::new(RecordingSink::default());
        let participant = ExplorerEntitySimulation::new(entities, delivery, boom, sink.clone());

        participant
            .fixed_tick(Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ))
            .unwrap();

        let events = sink.events.lock().unwrap();
        let [envelope] = events.as_slice() else {
            panic!("one changed collection tick must publish one advance batch")
        };
        assert_eq!(envelope.entity_advances.len(), 1);
        assert_eq!(envelope.entity_advances[0].entity.identity.guid, guid);
        assert_eq!(
            envelope.entity_advances[0].entity.generation,
            spawned.instance.generation
        );
        assert_eq!(
            envelope.entity_advances[0]
                .path
                .legs
                .last()
                .unwrap()
                .end_fraction,
            1.0
        );
        assert!(envelope.duration_ms > 0.0);
    }

    #[test]
    fn evicted_indoor_body_does_not_poison_ordered_publication() {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let entities = Arc::new(ExplorerEntityRuntime::new(
            Arc::clone(&simulation),
            Default::default(),
            crate::explorer_possession_control::ExplorerPossessionControlProfile::standard()
                .expect("standard Explorer possession profile is valid"),
        ));
        let guid = entities.reserve_guid().unwrap();
        entities
            .spawn_prepared(
                definition_at(guid, Guid(0xda55_0100)),
                EntityPhysicalIntent::Simulated,
                Some(physical()),
            )
            .unwrap();
        let delivery = Arc::new(ExplorerEntityDelivery::new(Arc::clone(&entities)));
        let boom = Arc::new(
            HostKinematicBoomRuntime::new(Arc::clone(&entities), Arc::clone(&simulation)).unwrap(),
        );
        let sink = Arc::new(RecordingSink::default());
        let participant = ExplorerEntitySimulation::new(entities, delivery, boom, sink.clone());
        let tick = Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ);

        // The body still names an indoor cell, but the current scene has already evicted it.
        // The first tick must suspend that body rather than panic while holding publication.
        assert_eq!(
            participant.fixed_tick(tick).unwrap(),
            HostFixedTickDisposition::Continue
        );
        assert_eq!(
            participant.fixed_tick(tick).unwrap(),
            HostFixedTickDisposition::Continue
        );
        assert!(sink.events.lock().unwrap().is_empty());
    }

    fn definition(guid: Guid) -> DynamicEntityDefinition {
        definition_at(guid, Guid(0xda55_0001))
    }

    fn definition_at(guid: Guid, landblock_id: Guid) -> DynamicEntityDefinition {
        DynamicEntityDefinition::prepare(DynamicEntityDefinitionInput {
            identity: DynamicEntityIdentity {
                guid,
                wcid: 1,
                name: "Test Entity".to_owned(),
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
                    landblock_id,
                    coords: Vector3::new(96.0, 96.0, 10.0),
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
            radar: holtburger_core::DynamicEntityRadarFacts::default(),
            body_height: 2.05,
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
                elasticity: PhysicalElasticity::DEFAULT,
                default_animation_available: false,
                default_script_available: false,
            },
        }
    }
}
