//! Narrow Explorer adapter from current registry/body facts to the shared focused view feed.

use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::Instant;

use anyhow::{Result, anyhow, ensure};
use holtburger_common::Guid;
use holtburger_core::{
    DynamicEntityAdvance, DynamicEntityEvent, DynamicEntityHostTime, DynamicEntityPathLeg,
    DynamicEntityPathPoint, DynamicEntityPlacedPath, DynamicEntityPlacementAdvanceKind,
    DynamicEntitySnapshot, DynamicEntityTickBatch, DynamicEntityView, DynamicEntityViewSource,
    project_dynamic_entity_view,
};
use serde::Serialize;

use crate::explorer_entity_runtime::{
    ExplorerEntityPhysicalTick, ExplorerEntityRuntime, ExplorerEntityRuntimeError,
};
use crate::host_kinematic_boom_runtime::HostKinematicBoomTick;

/// One host event name for snapshots and incremental entity changes.
pub const EXPLORER_DYNAMIC_ENTITY_EVENT: &str = "explorer-dynamic-entity";

/// One app-local fixed epoch carrying phase-aligned entity and camera paths.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerFixedTickEnvelope {
    /// Monotonic app-host fixed-tick epoch, including epochs with no entity presentation delta.
    pub epoch: u64,
    /// Host monotonic time sampled once for this envelope.
    pub host_time: DynamicEntityHostTime,
    /// Positive authored duration shared by every path in this envelope.
    pub duration_ms: f64,
    /// Frontend-relevant entity advances; stable host-follow targets are omitted here only.
    pub entity_advances: Vec<DynamicEntityAdvance>,
    /// Optional continuous or recoverable boom path for this exact epoch.
    pub boom: Option<HostKinematicBoomTick>,
}

/// App-local timeline and projection adapter; it retains no delivery or diagnostic history.
pub struct ExplorerEntityDelivery {
    origin: Instant,
    entities: Arc<ExplorerEntityRuntime>,
    // Snapshot capture and mutation publication share this gate so a delta cannot overtake the
    // snapshot that is supposed to establish its baseline. It retains no event or recovery state.
    publication: Mutex<()>,
    /// Serializes epoch issuance through actual fixed-tick delivery, independently of physics.
    next_fixed_tick_epoch: Mutex<u64>,
}

impl ExplorerEntityDelivery {
    /// Binds delivery to the Explorer's sole semantic registry and canonical body runtime.
    pub fn new(entities: Arc<ExplorerEntityRuntime>) -> Self {
        Self {
            origin: Instant::now(),
            entities,
            publication: Mutex::new(()),
            next_fixed_tick_epoch: Mutex::new(1),
        }
    }

    /// Orders one source mutation/snapshot capture through its actual boundary publication.
    pub fn with_ordered_publication<T>(&self, operation: impl FnOnce() -> T) -> T {
        let _publication = self
            .publication
            .lock()
            .expect("Explorer entity publication lock poisoned");
        operation()
    }

    /// Projects one current entity generation.
    pub fn entity(&self, guid: Guid) -> Result<DynamicEntityView, ExplorerEntityRuntimeError> {
        let projection = self.entities.project(guid)?;
        Ok(project_dynamic_entity_view(
            DynamicEntityViewSource::from_projection(
                projection.generation,
                projection.presentation_class,
                projection.input,
                projection.motion,
            ),
        ))
    }

    /// Reconstructs the complete current population in stable GUID order.
    pub fn snapshot(&self) -> Result<DynamicEntitySnapshot, ExplorerEntityRuntimeError> {
        let entities = self
            .entities
            .snapshot()?
            .into_iter()
            .map(|projection| {
                project_dynamic_entity_view(DynamicEntityViewSource::from_projection(
                    projection.generation,
                    projection.presentation_class,
                    projection.input,
                    projection.motion,
                ))
            })
            .collect();
        Ok(DynamicEntitySnapshot::new(self.host_time(), entities))
    }

    /// Builds one current upsert event after a committed lifecycle or state mutation.
    pub fn upserted(&self, guid: Guid) -> Result<DynamicEntityEvent, ExplorerEntityRuntimeError> {
        Ok(DynamicEntityEvent::Upserted {
            entity: Box::new(self.entity(guid)?),
        })
    }

    /// Builds a complete replacement event for startup or explicit reset.
    pub fn snapshot_event(&self) -> Result<DynamicEntityEvent, ExplorerEntityRuntimeError> {
        Ok(DynamicEntityEvent::Snapshot {
            snapshot: self.snapshot()?,
        })
    }

    /// Orders epoch issuance and delivery together. Projection happens before the short send gate;
    /// camera-only callers never take the entity mutation/snapshot gate.
    /// The callback must finish delivery before returning and must not reenter this method.
    pub fn publish_fixed_tick<T>(
        &self,
        ticks: Vec<ExplorerEntityPhysicalTick>,
        boom: Option<HostKinematicBoomTick>,
        duration: Duration,
        publish: impl FnOnce(ExplorerFixedTickEnvelope) -> Result<T>,
    ) -> Result<Option<T>> {
        ensure!(
            duration.as_secs_f64().is_finite() && !duration.is_zero(),
            "Explorer fixed-tick duration must be positive and finite"
        );
        let entity_advances = project_entity_advances(ticks)?;
        if entity_advances.is_empty() && boom.is_none() {
            return Ok(None);
        }
        let mut next_epoch = self
            .next_fixed_tick_epoch
            .lock()
            .expect("Explorer fixed-tick publication lock poisoned");
        let epoch = *next_epoch;
        *next_epoch = epoch
            .checked_add(1)
            .ok_or_else(|| anyhow!("Explorer fixed-tick epoch exhausted"))?;
        publish(ExplorerFixedTickEnvelope {
            epoch,
            host_time: self.host_time(),
            duration_ms: duration.as_secs_f64() * 1_000.0,
            entity_advances,
            boom,
        })
        .map(Some)
    }

    /// Builds one correction-only snap batch after a discontinuous relocation commits.
    pub fn corrected(
        &self,
        guid: Guid,
        kind: DynamicEntityPlacementAdvanceKind,
    ) -> Result<DynamicEntityEvent, ExplorerEntityRuntimeError> {
        assert!(
            !matches!(kind, DynamicEntityPlacementAdvanceKind::Integrated),
            "correction publication cannot masquerade as integrated motion"
        );
        let entity = self.entity(guid)?;
        let point = match &entity.placement {
            holtburger_core::DynamicEntityPlacementView::World {
                pose,
                spatial_membership,
                ..
            } => DynamicEntityPathPoint {
                pose: *pose,
                spatial_membership: spatial_membership.clone(),
            },
            holtburger_core::DynamicEntityPlacementView::Attached { parent, .. } => {
                return Err(ExplorerEntityRuntimeError::AttachedOperation {
                    guid,
                    parent: *parent,
                    operation: "correction publication",
                });
            }
        };
        Ok(DynamicEntityEvent::Ticked {
            batch: DynamicEntityTickBatch::new(
                self.host_time(),
                0.0,
                vec![DynamicEntityAdvance {
                    entity: Box::new(entity),
                    kind,
                    path: DynamicEntityPlacedPath {
                        initial: point.clone(),
                        legs: vec![DynamicEntityPathLeg {
                            end_fraction: 1.0,
                            end: point,
                        }],
                    },
                }],
                Vec::new(),
            )
            .expect("one correction advance must produce a dynamic tick"),
        })
    }

    fn host_time(&self) -> DynamicEntityHostTime {
        DynamicEntityHostTime::new(self.origin.elapsed().as_secs_f64())
            .expect("monotonic elapsed time must be finite and nonnegative")
    }
}

fn project_entity_advances(
    ticks: Vec<ExplorerEntityPhysicalTick>,
) -> Result<Vec<DynamicEntityAdvance>> {
    ticks
        .into_iter()
        .filter(|tick| tick.publish)
        .map(|tick| {
            let path = DynamicEntityPlacedPath::from_motion(
                &tick.solved.path,
                tick.solved.previous.pose.rotation,
                tick.solved.current.pose.rotation,
            )?;
            Ok(DynamicEntityAdvance {
                entity: Box::new(project_dynamic_entity_view(
                    DynamicEntityViewSource::from_projection(
                        tick.generation,
                        tick.presentation_class,
                        tick.input,
                        tick.motion,
                    ),
                )),
                kind: DynamicEntityPlacementAdvanceKind::Integrated,
                path,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;

    use holtburger_content::LandblockCollisionAsset;

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

    fn delivery() -> Arc<ExplorerEntityDelivery> {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        Arc::new(ExplorerEntityDelivery::new(Arc::new(
            ExplorerEntityRuntime::new(
                simulation,
                Default::default(),
                crate::explorer_possession_control::ExplorerPossessionControlProfile::standard()
                    .expect("standard Explorer possession profile is valid"),
            ),
        )))
    }

    /// A valid stationary camera-only payload for exercising delivery without simulation assets.
    fn camera_tick() -> HostKinematicBoomTick {
        use crate::host_kinematic_boom_runtime::{
            HostKinematicBoomFailureReason, HostKinematicBoomIdentity, HostKinematicBoomPathLeg,
            HostKinematicBoomPathPoint, HostKinematicBoomPlacedPath,
            HostKinematicBoomTargetSphereRole, HostKinematicBoomWorldPoint,
        };
        let point = HostKinematicBoomWorldPoint {
            landblock_id: Guid(0xda55_0001),
            coords: holtburger_common::Vector3::zero(),
        };
        let point = HostKinematicBoomPathPoint {
            position: point,
            visual_pivot: point,
        };
        HostKinematicBoomTick::Fallback {
            identity: HostKinematicBoomIdentity {
                guid: Guid(1),
                entity_generation: 1,
                possession_generation: 1,
                boom_generation: 1,
            },
            sequence: 1,
            target_sphere_role: HostKinematicBoomTargetSphereRole::Primary,
            desired_reach: 1.0,
            path: HostKinematicBoomPlacedPath {
                initial: point,
                legs: vec![HostKinematicBoomPathLeg {
                    end_fraction: 1.0,
                    end: point,
                }],
            },
            reason: HostKinematicBoomFailureReason::TargetContract,
            diagnostics: holtburger_core::KinematicBoomDiagnostics::default().into(),
        }
    }

    #[test]
    fn camera_delivery_progresses_while_entity_work_holds_its_gate() {
        let delivery = delivery();
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (sent_tx, sent_rx) = mpsc::channel();
        let entity_delivery = Arc::clone(&delivery);
        let delayed = thread::spawn(move || {
            entity_delivery.with_ordered_publication(|| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
            });
        });
        entered_rx.recv().unwrap();
        let camera = thread::spawn(move || {
            delivery
                .publish_fixed_tick(
                    Vec::new(),
                    Some(camera_tick()),
                    Duration::from_millis(16),
                    |envelope| {
                        sent_tx.send(envelope.epoch).unwrap();
                        Ok(())
                    },
                )
                .unwrap();
        });
        let result = sent_rx.recv_timeout(Duration::from_secs(2));
        // Release even on failure so a lock regression cannot leave either test thread blocked.
        release_tx.send(()).unwrap();
        delayed.join().unwrap();
        camera.join().unwrap();
        assert_eq!(result.unwrap(), 1);
    }

    #[test]
    fn a_delayed_sink_cannot_be_overtaken_by_a_later_epoch() {
        let delivery = delivery();
        let order = Arc::new(Mutex::new(Vec::new()));
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let first_delivery = Arc::clone(&delivery);
        let first_order = Arc::clone(&order);
        let first = thread::spawn(move || {
            first_delivery
                .publish_fixed_tick(
                    Vec::new(),
                    Some(camera_tick()),
                    Duration::from_millis(16),
                    |envelope| {
                        entered_tx.send(()).unwrap();
                        release_rx.recv().unwrap();
                        first_order.lock().unwrap().push(envelope.epoch);
                        Ok(())
                    },
                )
                .unwrap();
        });
        entered_rx.recv().unwrap();
        let (attempted_tx, attempted_rx) = mpsc::channel();
        let (sent_tx, sent_rx) = mpsc::channel();
        let second_order = Arc::clone(&order);
        let second = thread::spawn(move || {
            attempted_tx.send(()).unwrap();
            delivery
                .publish_fixed_tick(
                    Vec::new(),
                    Some(camera_tick()),
                    Duration::from_millis(16),
                    |envelope| {
                        second_order.lock().unwrap().push(envelope.epoch);
                        sent_tx.send(()).unwrap();
                        Ok(())
                    },
                )
                .unwrap();
        });
        attempted_rx.recv().unwrap();
        let overtook = sent_rx.recv_timeout(Duration::from_millis(50)).is_ok();
        release_tx.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();
        assert!(
            !overtook,
            "a later epoch reached the sink while the first send was pending"
        );
        assert_eq!(*order.lock().unwrap(), [1, 2]);
    }

    #[test]
    fn publication_gate_keeps_a_captured_snapshot_ahead_of_a_later_delta() {
        let delivery = delivery();
        let order = Arc::new(Mutex::new(Vec::new()));
        let (snapshot_captured_tx, snapshot_captured_rx) = mpsc::channel();
        let (release_snapshot_tx, release_snapshot_rx) = mpsc::channel();
        let first_delivery = Arc::clone(&delivery);
        let first_order = Arc::clone(&order);
        let first = thread::spawn(move || {
            first_delivery.with_ordered_publication(|| {
                snapshot_captured_tx.send(()).unwrap();
                release_snapshot_rx.recv().unwrap();
                first_order.lock().unwrap().push("snapshot");
            });
        });

        snapshot_captured_rx.recv().unwrap();
        let (delta_attempted_tx, delta_attempted_rx) = mpsc::channel();
        let second_delivery = Arc::clone(&delivery);
        let second_order = Arc::clone(&order);
        let second = thread::spawn(move || {
            delta_attempted_tx.send(()).unwrap();
            second_delivery.with_ordered_publication(|| {
                second_order.lock().unwrap().push("delta");
            });
        });
        delta_attempted_rx.recv().unwrap();
        release_snapshot_tx.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();

        assert_eq!(*order.lock().unwrap(), ["snapshot", "delta"]);
    }
}
