//! Explorer-only host composition.

use std::sync::Arc;

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::explorer_entity_delivery::ExplorerEntityDelivery;
use crate::explorer_entity_driver::{
    DatExplorerEntityContentPreparer, ExplorerEntityDriver, SystemExplorerEntityClock,
};
use crate::explorer_entity_driver::{
    ExplorerEntityLaunchRequest, ExplorerEntityRelocationRequest, ExplorerEntitySpawnRequest,
};
use crate::explorer_entity_runtime::ExplorerEntityRuntime;
use crate::explorer_possession_control::ExplorerPossessionControlProfile;
use crate::explorer_weenie_catalog::ExplorerWeenieCatalog;
use crate::explorer_weenie_catalog::ExplorerWeenieSearchRequest;
use crate::host_event_sink::{
    DynamicEntityEventSinkAdapter, ExplorerEventSink, PhysicalFlyEventSinkAdapter,
};
use crate::host_fixed_tick_runtime::HostFixedTickRuntime;
use crate::host_kinematic_boom_runtime::HostKinematicBoomRuntime;
use crate::host_kinematic_boom_runtime::{
    HostKinematicBoomClearanceRequest, HostKinematicBoomIdentity, HostKinematicBoomIntentRequest,
    HostKinematicBoomStartRequest,
};
use crate::host_physical_fly_runtime::{
    HostPhysicalFlyRuntime, PhysicalFlyIntent, PhysicalFlyRegistration, PhysicalFlyStartReceipt,
};
use crate::host_simulation_runtime::SimulationInterestRequest;
use crate::host_simulation_runtime::{CollisionSource, HostSimulationRuntime};
use crate::protocol::{HostResponse, ProtocolError, application_error, encode_json};
use crate::shared_host_content::SharedHostContent;
use crate::{
    ExplorerEntityMutationReceipt, ExplorerPossessionEventWireRequest,
    ExplorerPossessionIntentWireRequest, ExplorerPossessionReceipt, HostStatus,
    PossessExplorerEntityRequest, ReplaceExplorerEntityPhysicsStateRequest,
};

/// Commands accepted only by the Explorer authority.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum ExplorerHostCommand {
    ExplorerCatalogCapability,
    SearchExplorerWeenies {
        request: ExplorerWeenieSearchRequest,
    },
    RequestExplorerDynamicEntitySnapshot,
    ExplorerPossessionMotionProbe,
    SpawnExplorerEntity {
        request: ExplorerEntitySpawnRequest,
    },
    DespawnExplorerEntity {
        guid: holtburger_common::Guid,
        generation: u64,
    },
    ReplaceExplorerEntityPhysicsState {
        request: ReplaceExplorerEntityPhysicsStateRequest,
    },
    LaunchExplorerEntity {
        request: ExplorerEntityLaunchRequest,
    },
    RelocateExplorerEntity {
        request: ExplorerEntityRelocationRequest,
    },
    ResetExplorerEntities,
    PossessExplorerEntity {
        request: PossessExplorerEntityRequest,
    },
    SetExplorerPossessionIntent {
        request: ExplorerPossessionIntentWireRequest,
    },
    QueueExplorerPossessionEvent {
        request: ExplorerPossessionEventWireRequest,
    },
    StartKinematicBoom {
        request: HostKinematicBoomStartRequest,
    },
    SetKinematicBoomIntent {
        request: HostKinematicBoomIntentRequest,
    },
    SetKinematicBoomClearance {
        request: HostKinematicBoomClearanceRequest,
    },
    StopKinematicBoom {
        request: HostKinematicBoomIdentity,
    },
    StartSimulationInterestSession,
    ReplaceSimulationInterest {
        request: SimulationInterestRequest,
    },
    StartPhysicalFly {
        registration: PhysicalFlyRegistration,
    },
    SetPhysicalFlyIntent {
        intent: PhysicalFlyIntent,
    },
    StopPhysicalFly {
        session: u64,
    },
}

/// Exact wire names owned by the Explorer dispatcher.
pub const EXPLORER_COMMAND_NAMES: &[&str] = &[
    "explorer_catalog_capability",
    "search_explorer_weenies",
    "request_explorer_dynamic_entity_snapshot",
    "explorer_possession_motion_probe",
    "spawn_explorer_entity",
    "despawn_explorer_entity",
    "replace_explorer_entity_physics_state",
    "launch_explorer_entity",
    "relocate_explorer_entity",
    "reset_explorer_entities",
    "possess_explorer_entity",
    "set_explorer_possession_intent",
    "queue_explorer_possession_event",
    "start_kinematic_boom",
    "set_kinematic_boom_intent",
    "set_kinematic_boom_clearance",
    "stop_kinematic_boom",
    "start_simulation_interest_session",
    "replace_simulation_interest",
    "start_physical_fly",
    "set_physical_fly_intent",
    "stop_physical_fly",
];

/// Complete app-local host state shared by every shell adapter.
pub struct ExplorerHostRuntime {
    /// Static-content discovery and synchronous collision service.
    pub content: SharedHostContent,
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
    pub(crate) event_sink: Arc<dyn ExplorerEventSink>,
    pub(crate) physical_event_sink: Arc<dyn crate::host_physical_fly_runtime::PhysicalFlyEventSink>,
}

impl ExplorerHostRuntime {
    /// Discovers configured content and composes one shell-neutral host.
    pub fn discover(event_sink: Arc<dyn ExplorerEventSink>) -> Result<Self> {
        let content = SharedHostContent::discover()?;
        Self::from_content(content, event_sink)
    }

    /// Composes a host from an injected content state, which keeps tests and diagnostics explicit.
    pub fn from_content(
        content: SharedHostContent,
        event_sink: Arc<dyn ExplorerEventSink>,
    ) -> Result<Self> {
        let collision_source: Arc<dyn CollisionSource> = content.service.clone();
        let simulation = Arc::new(HostSimulationRuntime::new(collision_source));
        let motion_catalog = Arc::clone(&content.motion_catalog);
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

    /// Publishes an Explorer-owned dynamic projection through the shell sink.
    pub(crate) fn publish_dynamic_entity(
        &self,
        event: holtburger_core::DynamicEntityEvent,
    ) -> anyhow::Result<()> {
        self.event_sink.publish_dynamic_entity(event)
    }
}

/// Dispatches one Explorer-only command against the Explorer authority.
pub async fn dispatch_explorer(
    runtime: &ExplorerHostRuntime,
    command: ExplorerHostCommand,
) -> Result<HostResponse, ProtocolError> {
    use ExplorerHostCommand::*;

    match command {
        ExplorerCatalogCapability => {
            encode_json(runtime.explorer_entity_driver.catalog_capability())
        }
        SearchExplorerWeenies { request } => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            tokio::task::spawn_blocking(move || driver.search_weenies(&request))
                .await
                .map_err(application_error)?
                .map_err(application_error)
                .and_then(encode_json)
        }
        RequestExplorerDynamicEntitySnapshot => {
            let event = runtime
                .explorer_entity_delivery
                .with_ordered_publication(|| runtime.explorer_entity_delivery.snapshot_event())
                .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            Ok(HostResponse::Unit)
        }
        ExplorerPossessionMotionProbe => {
            encode_json(runtime.explorer_entities.possession_motion_probe())
        }
        SpawnExplorerEntity { request } => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let receipt = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let outcome = driver.spawn_by_wcid(request)?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid: outcome.instance.definition.identity.guid,
                        generation: outcome.instance.generation,
                    };
                    let event = delivery.snapshot_event()?;
                    Ok::<_, anyhow::Error>((receipt, event))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(receipt.1)
                .map_err(application_error)?;
            encode_json(receipt.0)
        }
        DespawnExplorerEntity { guid, generation } => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let (receipt, event) = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let outcome = driver.despawn(guid, generation)?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid,
                        generation: outcome.instance.generation,
                    };
                    Ok::<_, anyhow::Error>((receipt, delivery.snapshot_event()?))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            encode_json(receipt)
        }
        ReplaceExplorerEntityPhysicsState { request } => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let (receipt, event) = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let outcome = driver.replace_physics_state(
                        request.guid,
                        request.generation,
                        holtburger_common::properties::PhysicsState::from_bits_retain(
                            request.semantic_mask,
                        ),
                        request.physical_mode,
                    )?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid: request.guid,
                        generation: outcome.instance.generation,
                    };
                    Ok::<_, anyhow::Error>((receipt, delivery.upserted(receipt.guid)?))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            encode_json(receipt)
        }
        LaunchExplorerEntity { request } => {
            let guid = request.guid;
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let (receipt, event) = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let outcome = driver.launch(request)?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid,
                        generation: outcome.instance.generation,
                    };
                    Ok::<_, anyhow::Error>((receipt, delivery.upserted(receipt.guid)?))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            encode_json(receipt)
        }
        RelocateExplorerEntity { request } => {
            let guid = request.guid;
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let (receipt, event) = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    let kind = request.kind.advance_kind();
                    let outcome = driver.relocate(request)?;
                    let receipt = ExplorerEntityMutationReceipt {
                        guid,
                        generation: outcome.instance.generation,
                    };
                    Ok::<_, anyhow::Error>((receipt, delivery.corrected(receipt.guid, kind)?))
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            encode_json(receipt)
        }
        ResetExplorerEntities => {
            let driver = Arc::clone(&runtime.explorer_entity_driver);
            let delivery = Arc::clone(&runtime.explorer_entity_delivery);
            let event = tokio::task::spawn_blocking(move || {
                delivery.with_ordered_publication(|| {
                    driver.reset().map_err(|error| anyhow::anyhow!("{error}"))?;
                    Ok::<_, anyhow::Error>(delivery.snapshot_event()?)
                })
            })
            .await
            .map_err(application_error)?
            .map_err(application_error)?;
            runtime
                .publish_dynamic_entity(event)
                .map_err(application_error)?;
            Ok(HostResponse::Unit)
        }
        PossessExplorerEntity { request } => {
            let Some(guid) = request.guid else {
                let release = runtime
                    .explorer_entities
                    .release_possession(std::time::Instant::now())
                    .map_err(application_error)?;
                return encode_json(ExplorerPossessionReceipt::released(
                    release.possession_generation,
                ));
            };
            encode_json(ExplorerPossessionReceipt::active(
                runtime
                    .explorer_entities
                    .possess(guid)
                    .map_err(application_error)?,
            ))
        }
        SetExplorerPossessionIntent { request } => encode_json(
            runtime
                .explorer_entities
                .replace_possession_intent(request.resolve().map_err(application_error)?)
                .map_err(application_error)?,
        ),
        QueueExplorerPossessionEvent { request } => encode_json(
            runtime
                .explorer_entities
                .queue_possession_event(request.resolve().map_err(application_error)?)
                .map_err(application_error)?,
        ),
        StartKinematicBoom { request } => encode_json(
            runtime
                .kinematic_boom_runtime
                .start(request)
                .map_err(application_error)?,
        ),
        SetKinematicBoomIntent { request } => encode_json(
            runtime
                .kinematic_boom_runtime
                .set_intent(request)
                .map_err(application_error)?,
        ),
        SetKinematicBoomClearance { request } => encode_json(
            runtime
                .kinematic_boom_runtime
                .set_clearance(request)
                .map_err(application_error)?,
        ),
        StopKinematicBoom { request } => encode_json(runtime.kinematic_boom_runtime.stop(request)),
        StartSimulationInterestSession => {
            encode_json(runtime.simulation.reserve_interest_session())
        }
        ReplaceSimulationInterest { request } => {
            let simulation = Arc::clone(&runtime.simulation);
            let receipt = tokio::task::spawn_blocking(move || simulation.replace_interest(request))
                .await
                .map_err(application_error)?
                .map_err(application_error)?;
            encode_json(receipt)
        }
        StartPhysicalFly { registration } => {
            let session = runtime
                .start_physical_fly(registration)
                .map_err(application_error)?;
            encode_json(session)
        }
        SetPhysicalFlyIntent { intent } => {
            runtime
                .physical_fly_runtime
                .set_intent(intent)
                .map_err(application_error)?;
            Ok(HostResponse::Unit)
        }
        StopPhysicalFly { session } => {
            runtime.physical_fly_runtime.stop(session);
            Ok(HostResponse::Unit)
        }
    }
}
