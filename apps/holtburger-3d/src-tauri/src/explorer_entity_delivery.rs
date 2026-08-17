//! Narrow Explorer adapter from current registry/body facts to the shared focused view feed.

use std::sync::{Arc, Mutex};
use std::time::Instant;

use holtburger_common::Guid;
use holtburger_core::{
    DynamicEntityEvent, DynamicEntityHostTime, DynamicEntitySnapshot, DynamicEntityView,
    DynamicEntityViewSource, project_dynamic_entity_view,
};

use crate::explorer_entity_runtime::{ExplorerEntityRuntime, ExplorerEntityRuntimeError};

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
    pub(crate) fn with_ordered_publication<T>(&self, operation: impl FnOnce() -> T) -> T {
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

    /// Builds one removal event after the exact body and registry generation are gone.
    pub fn removed(&self, guid: Guid, generation: u64) -> DynamicEntityEvent {
        DynamicEntityEvent::Removed { guid, generation }
    }

    /// Builds a complete replacement event for startup, reload, or explicit reset.
    pub fn snapshot_event(&self) -> Result<DynamicEntityEvent, ExplorerEntityRuntimeError> {
        Ok(DynamicEntityEvent::Snapshot {
            snapshot: self.snapshot()?,
        })
    }

    fn host_time(&self) -> DynamicEntityHostTime {
        DynamicEntityHostTime::new(self.origin.elapsed().as_secs_f64())
            .expect("monotonic elapsed time must be finite and nonnegative")
    }
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
            ExplorerEntityRuntime::new(simulation),
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
