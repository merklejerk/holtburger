//! Shell-neutral publication boundaries for host-owned events.

use std::sync::Arc;

use crate::explorer_entity_delivery::ExplorerFixedTickEnvelope;
use crate::explorer_entity_runtime::PossessionEventOutcome;
use crate::host_physical_fly_runtime::{PhysicalFlyFailure, PhysicalFlyMotionPath};
use holtburger_core::DynamicEntityEvent;

/// Complete event surface produced by the app-local host runtime.
pub trait HostEventSink: Send + Sync {
    /// Publishes a command/snapshot-driven dynamic-entity change.
    fn publish_dynamic_entity(&self, event: DynamicEntityEvent) -> anyhow::Result<()>;

    /// Publishes one fixed-tick entity/boom envelope.
    fn publish_fixed_tick(&self, envelope: ExplorerFixedTickEnvelope) -> anyhow::Result<()>;

    /// Publishes lifecycle outcomes committed with the fixed-tick body transaction.
    fn publish_possession_outcomes(
        &self,
        outcomes: Vec<PossessionEventOutcome>,
    ) -> anyhow::Result<()>;

    /// Publishes one authoritative physical-flight path.
    fn publish_physical_fly_motion(&self, path: PhysicalFlyMotionPath) -> anyhow::Result<()>;

    /// Publishes the terminal failure for one physical-flight generation.
    fn publish_physical_fly_failure(&self, failure: PhysicalFlyFailure) -> anyhow::Result<()>;
}

/// Adapter from the complete host sink to the dynamic-entity participant contract.
pub struct DynamicEntityEventSinkAdapter {
    sink: Arc<dyn HostEventSink>,
}

impl DynamicEntityEventSinkAdapter {
    /// Binds the adapter to one shell-owned publication sink.
    pub fn new(sink: Arc<dyn HostEventSink>) -> Self {
        Self { sink }
    }
}

impl crate::explorer_entity_simulation::DynamicEntityEventSink for DynamicEntityEventSinkAdapter {
    fn publish(&self, envelope: ExplorerFixedTickEnvelope) -> anyhow::Result<()> {
        self.sink.publish_fixed_tick(envelope)
    }

    fn publish_possession_outcomes(
        &self,
        outcomes: Vec<PossessionEventOutcome>,
    ) -> anyhow::Result<()> {
        self.sink.publish_possession_outcomes(outcomes)
    }
}

/// Adapter from the complete host sink to the physical-flight participant contract.
pub struct PhysicalFlyEventSinkAdapter {
    sink: Arc<dyn HostEventSink>,
}

impl PhysicalFlyEventSinkAdapter {
    /// Binds the adapter to one shell-owned publication sink.
    pub fn new(sink: Arc<dyn HostEventSink>) -> Self {
        Self { sink }
    }
}

impl crate::host_physical_fly_runtime::PhysicalFlyEventSink for PhysicalFlyEventSinkAdapter {
    fn publish_motion(&self, path: PhysicalFlyMotionPath) -> anyhow::Result<()> {
        self.sink.publish_physical_fly_motion(path)
    }

    fn publish_failure(&self, failure: PhysicalFlyFailure) -> anyhow::Result<()> {
        self.sink.publish_physical_fly_failure(failure)
    }
}
