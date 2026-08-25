//! Shell-neutral composition root for the Explorer host.

use std::sync::Arc;

use anyhow::{Context, Result, bail};

use crate::explorer_entity_delivery::ExplorerEntityDelivery;
use crate::explorer_entity_driver::{
    DatExplorerEntityContentPreparer, ExplorerEntityDriver, SystemExplorerEntityClock,
};
use crate::explorer_entity_runtime::ExplorerEntityRuntime;
use crate::explorer_possession_control::ExplorerPossessionControlProfile;
use crate::explorer_weenie_catalog::ExplorerWeenieCatalog;
use crate::host_event_sink::{
    DynamicEntityEventSinkAdapter, HostEventSink, PhysicalFlyEventSinkAdapter,
};
use crate::host_fixed_tick_runtime::HostFixedTickRuntime;
use crate::host_kinematic_boom_runtime::HostKinematicBoomRuntime;
use crate::host_physical_fly_runtime::{
    HostPhysicalFlyRuntime, PhysicalFlyRegistration, PhysicalFlyStartReceipt,
};
use crate::host_simulation_runtime::{CollisionSource, HostSimulationRuntime};
use crate::{HostContentState, HostStatus};

/// Complete app-local host state shared by every shell adapter.
pub struct HostRuntime {
    /// Static-content discovery and synchronous collision service.
    pub content: HostContentState,
    /// Authoritative collision/body runtime.
    pub simulation: Arc<HostSimulationRuntime>,
    /// Projected motion contract used by Explorer possession.
    pub motion_catalog: Arc<holtburger_content::MotionSequenceCatalog>,
    /// Explorer semantic registry.
    pub explorer_entities: Arc<ExplorerEntityRuntime>,
    /// Explorer mutation/content driver.
    pub explorer_entity_driver: Arc<ExplorerEntityDriver>,
    /// Ordered focused entity delivery projection.
    pub explorer_entity_delivery: Arc<ExplorerEntityDelivery>,
    /// Host-owned camera boom runtime.
    pub kinematic_boom_runtime: Arc<HostKinematicBoomRuntime>,
    /// Shared fixed-tick scheduler.
    pub fixed_tick_runtime: Arc<HostFixedTickRuntime>,
    /// Host-owned physical-flight runtime.
    pub physical_fly_runtime: Arc<HostPhysicalFlyRuntime>,
    pub(crate) event_sink: Arc<dyn HostEventSink>,
    pub(crate) physical_event_sink: Arc<dyn crate::host_physical_fly_runtime::PhysicalFlyEventSink>,
}

impl HostRuntime {
    /// Discovers configured content and composes one shell-neutral host.
    pub fn discover(event_sink: Arc<dyn HostEventSink>) -> Result<Self> {
        let content = HostContentState::discover()?;
        Self::from_content(content, event_sink)
    }

    /// Composes a host from an injected content state, which keeps tests and diagnostics explicit.
    pub fn from_content(
        content: HostContentState,
        event_sink: Arc<dyn HostEventSink>,
    ) -> Result<Self> {
        let collision_source: Arc<dyn CollisionSource> = content.service.clone();
        let simulation = Arc::new(HostSimulationRuntime::new(collision_source));
        let motion_catalog = Arc::new(
            content
                .repository
                .read_motion_sequence_catalog()
                .context("failed to project the motion contract from configured content")?,
        );
        let explorer_entities = Arc::new(ExplorerEntityRuntime::new(
            Arc::clone(&simulation),
            Arc::clone(&motion_catalog),
            ExplorerPossessionControlProfile::standard()
                .context("failed to construct standard Explorer possession control profile")?,
        ));
        let catalog = Arc::new(ExplorerWeenieCatalog::discover_from_environment(
            content
                .repository
                .source_description()
                .map(std::path::Path::new),
        ));
        let explorer_entity_driver = Arc::new(ExplorerEntityDriver::new(
            catalog,
            Arc::new(DatExplorerEntityContentPreparer::new(Arc::clone(
                &content.repository,
            ))),
            Arc::new(SystemExplorerEntityClock),
            Arc::clone(&explorer_entities),
            Arc::clone(&simulation),
        ));
        let explorer_entity_delivery =
            Arc::new(ExplorerEntityDelivery::new(Arc::clone(&explorer_entities)));
        let kinematic_boom_runtime = Arc::new(
            HostKinematicBoomRuntime::new(Arc::clone(&explorer_entities), Arc::clone(&simulation))
                .context("failed to construct standard host kinematic boom profile")?,
        );
        let fixed_tick_runtime = Arc::new(HostFixedTickRuntime::new());
        let explorer_entity_tick_slot = fixed_tick_runtime.reserve_slot();
        let physical_fly_runtime = Arc::new(HostPhysicalFlyRuntime::new(
            Arc::clone(&simulation),
            Arc::clone(&fixed_tick_runtime),
        ));
        let dynamic_event_sink: Arc<dyn crate::explorer_entity_simulation::DynamicEntityEventSink> =
            Arc::new(DynamicEntityEventSinkAdapter::new(Arc::clone(&event_sink)));
        let physical_event_sink: Arc<dyn crate::host_physical_fly_runtime::PhysicalFlyEventSink> =
            Arc::new(PhysicalFlyEventSinkAdapter::new(Arc::clone(&event_sink)));
        fixed_tick_runtime.install(
            explorer_entity_tick_slot,
            Arc::new(
                crate::explorer_entity_simulation::ExplorerEntitySimulation::new(
                    Arc::clone(&explorer_entities),
                    Arc::clone(&explorer_entity_delivery),
                    Arc::clone(&kinematic_boom_runtime),
                    Arc::clone(&dynamic_event_sink),
                ),
            ),
        );
        fixed_tick_runtime.spawn();
        Ok(Self {
            content,
            simulation,
            motion_catalog,
            explorer_entities,
            explorer_entity_driver,
            explorer_entity_delivery,
            kinematic_boom_runtime,
            fixed_tick_runtime,
            physical_fly_runtime,
            event_sink,
            physical_event_sink,
        })
    }

    /// Stable status response shared by every shell.
    pub fn status(&self) -> HostStatus {
        HostStatus {
            app_name: "holtburger-3d",
            status: "landblock-source-batch-host-ready",
        }
    }

    /// Registers a physical-flight session and attaches it to the host scheduler.
    pub fn start_physical_fly(
        &self,
        registration: PhysicalFlyRegistration,
    ) -> Result<PhysicalFlyStartReceipt> {
        let session = self.physical_fly_runtime.start(registration)?;
        if !self
            .physical_fly_runtime
            .schedule(Arc::clone(&self.physical_event_sink), session)
        {
            bail!("physical camera registration was superseded before scheduling");
        }
        Ok(PhysicalFlyStartReceipt::new(session))
    }

    /// Stops host-owned background work before the sidecar closes its protocol writer.
    pub fn shutdown(&self) {
        self.fixed_tick_runtime.stop();
    }
}
