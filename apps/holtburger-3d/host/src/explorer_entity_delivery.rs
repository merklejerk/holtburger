//! Narrow Explorer adapter from current registry/body facts to the shared focused view feed.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::Instant;

use anyhow::{Result, anyhow, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion};
use holtburger_core::{
    DynamicEntityAdvance, DynamicEntityAdvanceBatch, DynamicEntityEvent, DynamicEntityHostTime,
    DynamicEntityPathLeg, DynamicEntityPathPoint, DynamicEntityPlacedPath,
    DynamicEntityPlacementAdvanceKind, DynamicEntitySnapshot, DynamicEntitySpatialMembership,
    DynamicEntityView, DynamicEntityViewSource, project_dynamic_entity_view,
};
use holtburger_world::{PlacedMotionPath, PlacedMotionPoint};
use serde::Serialize;

use crate::explorer_entity_runtime::{
    ExplorerEntityPhysicalTick, ExplorerEntityRuntime, ExplorerEntityRuntimeError,
};
use crate::host_kinematic_boom_runtime::HostKinematicBoomTick;
use crate::placed_motion_presentation::{interpolate_rotation, present_placed_motion_pose};

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
    next_fixed_tick_epoch: AtomicU64,
}

impl ExplorerEntityDelivery {
    /// Binds delivery to the Explorer's sole semantic registry and canonical body runtime.
    pub fn new(entities: Arc<ExplorerEntityRuntime>) -> Self {
        Self {
            origin: Instant::now(),
            entities,
            publication: Mutex::new(()),
            next_fixed_tick_epoch: AtomicU64::new(1),
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
                projection.input,
                projection.playing_clip,
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
                    projection.input,
                    projection.playing_clip,
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

    /// Builds a complete replacement event for startup, reload, or explicit reset.
    pub fn snapshot_event(&self) -> Result<DynamicEntityEvent, ExplorerEntityRuntimeError> {
        Ok(DynamicEntityEvent::Snapshot {
            snapshot: self.snapshot()?,
        })
    }

    /// Builds one atomic app-local delivery seam for entity and boom presentation.
    pub fn fixed_tick_envelope(
        &self,
        ticks: Vec<ExplorerEntityPhysicalTick>,
        boom: Option<HostKinematicBoomTick>,
        duration: Duration,
    ) -> Result<Option<ExplorerFixedTickEnvelope>> {
        ensure!(
            duration.as_secs_f64().is_finite() && !duration.is_zero(),
            "Explorer fixed-tick duration must be positive and finite"
        );
        let epoch = self
            .next_fixed_tick_epoch
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |next| {
                next.checked_add(1)
            })
            .map_err(|_| anyhow!("Explorer fixed-tick epoch exhausted"))?;
        let entity_advances = project_entity_advances(ticks)?;
        if entity_advances.is_empty() && boom.is_none() {
            return Ok(None);
        }
        Ok(Some(ExplorerFixedTickEnvelope {
            epoch,
            host_time: self.host_time(),
            duration_ms: duration.as_secs_f64() * 1_000.0,
            entity_advances,
            boom,
        }))
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
        Ok(DynamicEntityEvent::Advanced {
            batch: DynamicEntityAdvanceBatch::new(
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
            ),
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
            let path = serialize_entity_path(
                &tick.solved.result.motion.path,
                tick.solved.previous.pose,
                tick.solved.current.pose,
            )?;
            Ok(DynamicEntityAdvance {
                entity: Box::new(project_dynamic_entity_view(
                    DynamicEntityViewSource::from_projection(
                        tick.generation,
                        tick.input,
                        tick.playing_clip,
                    ),
                )),
                kind: DynamicEntityPlacementAdvanceKind::Integrated,
                path,
            })
        })
        .collect()
}

fn serialize_entity_path(
    path: &PlacedMotionPath,
    previous: WorldPosition,
    current: WorldPosition,
) -> Result<DynamicEntityPlacedPath> {
    Ok(DynamicEntityPlacedPath {
        initial: serialize_entity_path_point(path, path.initial(), previous.rotation)?,
        legs: path
            .legs()
            .iter()
            .map(|leg| {
                Ok(DynamicEntityPathLeg {
                    end_fraction: leg.end_fraction(),
                    end: serialize_entity_path_point(
                        path,
                        leg.end(),
                        interpolate_rotation(
                            previous.rotation,
                            current.rotation,
                            leg.end_fraction(),
                        )?,
                    )?,
                })
            })
            .collect::<Result<Vec<_>>>()?,
    })
}

fn serialize_entity_path_point(
    path: &PlacedMotionPath,
    point: &PlacedMotionPoint,
    rotation: Quaternion,
) -> Result<DynamicEntityPathPoint> {
    Ok(DynamicEntityPathPoint {
        pose: present_placed_motion_pose(path, point, rotation)?,
        spatial_membership: DynamicEntitySpatialMembership::from(point.placement()),
    })
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
