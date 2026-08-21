//! Narrow Explorer adapter from current registry/body facts to the shared focused view feed.

use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::Instant;

use anyhow::{Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion};
use holtburger_core::{
    DynamicEntityAdvance, DynamicEntityAdvanceBatch, DynamicEntityClipCompletion,
    DynamicEntityEvent, DynamicEntityHostTime, DynamicEntityPathLeg, DynamicEntityPathPoint,
    DynamicEntityPlacedPath, DynamicEntityPlacementAdvanceKind, DynamicEntitySnapshot,
    DynamicEntityView, DynamicEntityViewSource, project_dynamic_entity_view,
};
use holtburger_world::{PlacedMotionPath, PlacedMotionPoint};

use crate::explorer_entity_runtime::{
    ExplorerEntityPhysicalTick, ExplorerEntityRuntime, ExplorerEntityRuntimeError,
};
use crate::placed_motion_presentation::present_placed_motion_point;

/// Projects the host's playing clip into the frontend transport shape.
fn project_playing_clip(
    clip: holtburger_world::motion::PlayingMotionClip,
) -> holtburger_core::DynamicEntityPlayingClip {
    holtburger_core::DynamicEntityPlayingClip {
        animation_id: clip.animation_id,
        framerate: clip.framerate,
        low_frame: clip.low_frame,
        high_frame: clip.high_frame,
        completion: project_clip_completion(clip.completion),
    }
}

/// Maps the authoritative sequence fact into the transport-owned enum without reinterpretation.
pub(crate) fn project_clip_completion(
    completion: holtburger_world::motion::MotionClipCompletion,
) -> DynamicEntityClipCompletion {
    match completion {
        holtburger_world::motion::MotionClipCompletion::Hold => DynamicEntityClipCompletion::Hold,
        holtburger_world::motion::MotionClipCompletion::Loop => DynamicEntityClipCompletion::Loop,
    }
}

/// One Tauri event name for snapshots and incremental entity changes.
pub const EXPLORER_DYNAMIC_ENTITY_EVENT: &str = "explorer-dynamic-entity";

/// App-local timeline and projection adapter; it retains no delivery or diagnostic history.
pub struct ExplorerEntityDelivery {
    origin: Instant,
    entities: Arc<ExplorerEntityRuntime>,
    // Snapshot capture and mutation publication share this gate so a delta cannot overtake the
    // snapshot that is supposed to establish its baseline. It retains no event or recovery state.
    publication: Mutex<()>,
}

impl ExplorerEntityDelivery {
    /// Binds delivery to the Explorer's sole semantic registry and canonical body runtime.
    pub fn new(entities: Arc<ExplorerEntityRuntime>) -> Self {
        Self {
            origin: Instant::now(),
            entities,
            publication: Mutex::new(()),
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
            DynamicEntityViewSource::from_projection(projection.generation, projection.input),
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

    /// Builds the sole changed-entity batch for one accepted fixed-tick collection epoch.
    pub fn advanced(
        &self,
        ticks: Vec<ExplorerEntityPhysicalTick>,
        duration: Duration,
    ) -> Result<Option<DynamicEntityEvent>> {
        if ticks.is_empty() {
            return Ok(None);
        }
        ensure!(
            duration.as_secs_f64().is_finite() && !duration.is_zero(),
            "dynamic-entity path duration must be positive and finite"
        );
        let advances = ticks
            .into_iter()
            .map(|tick| {
                let path = serialize_entity_path(
                    &tick.solved.result.motion.path,
                    tick.solved.previous.pose,
                    tick.solved.current.pose,
                )?;
                Ok(DynamicEntityAdvance {
                    clip: tick.clip.map(project_playing_clip),
                    entity: Box::new(project_dynamic_entity_view(
                        DynamicEntityViewSource::from_projection(tick.generation, tick.input),
                    )),
                    kind: DynamicEntityPlacementAdvanceKind::Integrated,
                    path,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(Some(DynamicEntityEvent::Advanced {
            batch: DynamicEntityAdvanceBatch::new(
                self.host_time(),
                duration.as_secs_f64() * 1_000.0,
                advances,
            ),
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
        let pose = match entity.placement {
            holtburger_core::DynamicEntityPlacementView::World { pose, .. } => pose,
            holtburger_core::DynamicEntityPlacementView::Attached { parent, .. } => {
                return Err(ExplorerEntityRuntimeError::AttachedOperation {
                    guid,
                    parent,
                    operation: "correction publication",
                });
            }
        };
        let point = DynamicEntityPathPoint { pose };
        Ok(DynamicEntityEvent::Advanced {
            batch: DynamicEntityAdvanceBatch::new(
                self.host_time(),
                0.0,
                vec![DynamicEntityAdvance {
                    // A correction moves the body; it does not change which clip is playing, and
                    // the receiver keeps whatever projection it already holds.
                    clip: None,
                    entity: Box::new(entity),
                    kind,
                    path: DynamicEntityPlacedPath {
                        initial: point,
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
    let presented = present_placed_motion_point(path.anchor(), point)?;
    let mut pose = WorldPosition {
        landblock_id: Guid(presented.owner.0 & 0xffff_0000),
        coords: presented.coords,
        rotation,
    }
    .normalize_outdoor_cell();
    if let Some(cell) = presented.cell {
        pose.landblock_id = cell;
    }
    Ok(DynamicEntityPathPoint { pose })
}

/// Shortest-arc normalized interpolation keeps authored quaternion signs from causing a long flip.
fn interpolate_rotation(
    start: Quaternion,
    mut end: Quaternion,
    fraction: f32,
) -> Result<Quaternion> {
    ensure!(
        fraction.is_finite() && (0.0..=1.0).contains(&fraction),
        "dynamic-entity path rotation fraction must be finite and normalized"
    );
    let dot = start.w * end.w + start.x * end.x + start.y * end.y + start.z * end.z;
    if dot < 0.0 {
        end = Quaternion {
            w: -end.w,
            x: -end.x,
            y: -end.y,
            z: -end.z,
        };
    }
    let candidate = Quaternion {
        w: start.w + (end.w - start.w) * fraction,
        x: start.x + (end.x - start.x) * fraction,
        y: start.y + (end.y - start.y) * fraction,
        z: start.z + (end.z - start.z) * fraction,
    };
    let length = (candidate.w * candidate.w
        + candidate.x * candidate.x
        + candidate.y * candidate.y
        + candidate.z * candidate.z)
        .sqrt();
    ensure!(
        length.is_finite() && length > f32::EPSILON,
        "dynamic-entity path rotation must be finite and nonzero"
    );
    Ok(Quaternion {
        w: candidate.w / length,
        x: candidate.x / length,
        y: candidate.y / length,
        z: candidate.z / length,
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
