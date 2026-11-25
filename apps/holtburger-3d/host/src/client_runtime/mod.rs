//! Client-only host composition.

pub mod commands;
pub mod dispatch;
#[cfg(test)]
mod tests;

use std::sync::Arc;

use anyhow::{Result, bail};
use holtburger_core::ClientCommand;
use holtburger_core::client::inventory_storage::{InventoryInsertion, InventoryPlacementPolicy};
use holtburger_live_api::hooks::StaticReferenceCatalogs;
use holtburger_live_api::server::{LiveApiServerConfig, LiveApiServerHandle, start_server};
use holtburger_world::spell::SpellCatalog;

use crate::client_api::{
    ClientApiStateWire, H3dFrontendMirror, H3dHudHook, H3dScreenshotBroker, H3dUiHook,
    waypoint_from_scene_point,
};
use crate::client_host::run_client_task;
use crate::client_projection::{ClientHostEvent, client_exit_requested};
use crate::host_event_sink::ClientEventSink;
use crate::host_mode::ClientLaunchConfiguration;
use crate::shared_host_content::SharedHostContent;

pub use commands::{
    CLIENT_COMMAND_NAMES, ClientAppearanceOption, ClientCameraIdentityRequest, ClientChatRequest,
    ClientEntitySelectionQueryRequest, ClientHostCommand, ClientMapPosition,
    ClientNavigationWaypointReport, ClientPreciseJumpAimRequest, ClientPreciseJumpCommitRequest,
    RequestedCombatMode,
};
pub use dispatch::dispatch_client;

pub(super) struct ClientHostState {
    pub(super) started: bool,
    pub(super) accepting: bool,
    handle: Option<holtburger_core::ClientRuntimeHandle>,
    /// Direct orbit/projection endpoint, independent of the world command queue.
    camera_input: Option<holtburger_core::ClientCameraInputHandle>,
    pub(super) task: Option<tokio::task::JoinHandle<()>>,
    shutdown_requested: Arc<std::sync::atomic::AtomicBool>,
    frontend_mirror: H3dFrontendMirror,
    screenshots: H3dScreenshotBroker,
    pub(super) live_api: Arc<std::sync::Mutex<Option<LiveApiServerHandle>>>,
}

/// Client composition root. Its supervisor owns authority and forwarding for one launch.
pub struct ClientHostRuntime {
    /// Diagnostic ownership follows this one client authority attempt.
    pub(super) performance: crate::client_performance::ClientPerformance,
    /// Static-content discovery and reusable content service shared with Explorer.
    pub content: SharedHostContent,
    event_sink: Arc<dyn ClientEventSink>,
    pub(super) state: tokio::sync::Mutex<ClientHostState>,
    /// Retained cancellation permit also covers disconnect before socket construction finishes.
    stop_startup: tokio::sync::Notify,
}

impl ClientHostRuntime {
    /// Composes the client shell without constructing any Explorer authority or scheduler.
    pub fn from_content(content: SharedHostContent, event_sink: Arc<dyn ClientEventSink>) -> Self {
        Self {
            performance: Default::default(),
            content,
            event_sink,
            stop_startup: tokio::sync::Notify::new(),
            state: tokio::sync::Mutex::new(ClientHostState {
                started: false,
                accepting: true,
                handle: None,
                camera_input: None,
                task: None,
                shutdown_requested: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                frontend_mirror: H3dFrontendMirror::default(),
                screenshots: H3dScreenshotBroker::default(),
                live_api: Arc::new(std::sync::Mutex::new(None)),
            }),
        }
    }

    /// Connects and starts the one private client attempt. A second launch is rejected rather than
    /// replacing a potentially active task.
    pub async fn start(&self, startup: ClientLaunchConfiguration) -> Result<()> {
        let shutdown_requested = {
            let mut state = self.state.lock().await;
            if state.started {
                bail!("client startup has already been supplied");
            }
            if !state.accepting {
                bail!("client startup is unavailable after session retirement");
            }
            state.started = true;
            Arc::clone(&state.shutdown_requested)
        };

        let bootstrap = match self
            .content
            .failures
            .required(self.content.client_world_bootstrap())
        {
            Ok(bootstrap) => bootstrap,
            Err(error) => {
                let _ = self.event_sink.publish_client_event(client_exit_requested(
                    holtburger_core::ClientExitCause::StartupFailure,
                    format!("{error:#}"),
                ));
                return Err(error);
            }
        };

        let physical_source = Arc::new(
            crate::reporting_content_source::ReportingContentSource::new(
                holtburger_core::ContentClientPhysicsSource::new(
                    Arc::clone(&self.content.service),
                    Arc::clone(&self.content.repository),
                ),
                self.content.failures.clone(),
            ),
        );
        let mut builder = holtburger_core::ClientRuntimeBuilder::new(startup.account.clone())
            .runtime_profile(self.performance.authority.clone())
            .inventory_placement(InventoryPlacementPolicy {
                automatic: InventoryInsertion::Prepend,
                split_after_source: true,
            })
            .server(startup.host.clone(), startup.port)
            .world_bootstrap(Arc::clone(&bootstrap))
            .barber_source(Arc::new(
                holtburger_core::client::barber::ContentClientBarberSource::new(Arc::clone(
                    &self.content.repository,
                )),
            ))
            .require_external_world_reveal()
            .physical_movement_source(physical_source.clone(), physical_source.clone())
            .dynamic_script_source(Arc::new(
                crate::reporting_content_source::ReportingContentSource::new(
                    holtburger_core::ContentClientDynamicScriptSource::new(Arc::clone(
                        &self.content.service,
                    )),
                    self.content.failures.clone(),
                ),
            ))
            .selection_envelope_source(Arc::new(
                crate::reporting_content_source::ReportingContentSource::new(
                    holtburger_core::ContentClientSelectionEnvelopeSource::new(Arc::clone(
                        &self.content.service,
                    )),
                    self.content.failures.clone(),
                ),
            ));
        if let Some(distance) = startup.melee_max_chase_distance {
            builder = builder.combat_tuning(holtburger_core::ClientCombatTuning::new(distance)?);
        }
        if let Some(appraisal) = startup.appraisal_tuning {
            builder = builder
                .appraisal_tuning(holtburger_core::ClientAppraisalTuning::try_from(appraisal)?);
        }
        let connection = tokio::select! {
            result = builder.connect() => result,
            () = self.stop_startup.notified() => {
                self.event_sink.publish_client_event(client_exit_requested(
                    holtburger_core::ClientExitCause::ExplicitDisconnect,
                    "Disconnected during startup.",
                ))?;
                bail!("Client startup was cancelled.");
            }
        };
        let mut client = match connection {
            Ok(client) => client,
            Err(error) => {
                let _ = self.event_sink.publish_client_event(client_exit_requested(
                    holtburger_core::ClientExitCause::StartupFailure,
                    format!("{error:#}"),
                ));
                return Err(error);
            }
        };

        // Subscribe before either startup command is queued so no status, snapshot, or login
        // transition can be lost between core construction and task publication.
        let handle = client.create_handle();
        let events = handle.subscribe();
        let camera_input = client.camera_input_handle();
        let (frontend_mirror, screenshots) = {
            let state = self.state.lock().await;
            (state.frontend_mirror.clone(), state.screenshots.clone())
        };
        let live_api_server = if let Some(api_cfg) = startup.live_api {
            let catalogs = StaticReferenceCatalogs {
                spells: Arc::new(SpellCatalog::from(bootstrap.spell_table.as_ref().clone())),
                skills: Arc::clone(&bootstrap.skill_table),
            };
            let server = match start_server(
                handle.clone(),
                LiveApiServerConfig {
                    client_kind: "h3d",
                    port: api_cfg.port,
                    catalogs: Some(catalogs),
                    ui: Some(Arc::new(H3dUiHook::new(
                        frontend_mirror.clone(),
                        Arc::clone(&self.event_sink),
                    ))),
                    hud: Some(Arc::new(H3dHudHook::new(
                        frontend_mirror,
                        Arc::clone(&self.event_sink),
                        screenshots,
                    ))),
                    discovery_dir: None,
                    write_discovery: true,
                },
            )
            .await
            {
                Ok(server) => server,
                Err(error) => {
                    self.event_sink.publish_client_event(client_exit_requested(
                        holtburger_core::ClientExitCause::StartupFailure,
                        format!("{error:#}"),
                    ))?;
                    return Err(error);
                }
            };
            Some(server)
        } else {
            None
        };
        let initial_api_state = live_api_server.as_ref().map(|server| ClientApiStateWire {
            active: true,
            paused: handle.is_automation_paused(),
            endpoint: Some(server.base_url()),
        });
        {
            let mut state = self.state.lock().await;
            if !state.accepting {
                drop(live_api_server);
                self.event_sink.publish_client_event(client_exit_requested(
                    holtburger_core::ClientExitCause::ExplicitDisconnect,
                    "Disconnected during startup.",
                ))?;
                bail!("Client startup was cancelled.");
            }
            // Construct the authority future only after the last startup suspension point.
            // Holding it across the lock wait embeds the full client loop in startup state.
            let supervisor = run_client_task(
                client,
                events,
                handle.clone(),
                Arc::clone(&self.event_sink),
                shutdown_requested,
                self.performance.clone(),
            );
            if let Some(server) = live_api_server {
                *state.live_api.lock().expect("live_api mutex poisoned") = Some(server);
            }
            let cleanup_live_api = Arc::clone(&state.live_api);
            let cleanup_screenshots = state.screenshots.clone();
            state.task = Some(tokio::spawn(async move {
                if let Err(error) = supervisor.await {
                    log::error!("client supervisor stopped: {error:#}");
                }
                // Retire the Live API listener, discovery file, and pending screenshots even when
                // the game session ends naturally via server disconnect rather than explicit retire.
                let live_api = cleanup_live_api
                    .lock()
                    .expect("live_api mutex poisoned")
                    .take();
                cleanup_screenshots.cancel_all();
                drop(live_api);
            }));
            state.handle = Some(handle.clone());
            state.camera_input = Some(camera_input);
        }
        if let Some(api_state) = initial_api_state {
            let _ = self
                .event_sink
                .publish_client_event(ClientHostEvent::ApiState(api_state));
        }

        handle
            .send_user(ClientCommand::RequestCurrentApplicationState)
            .map_err(|_| anyhow::anyhow!("client task stopped before current-state request"))?;
        // Move, rather than clone, the password into the one login command. No host state retains
        // the credential after this send succeeds.
        handle
            .send_user(ClientCommand::Login(startup.password))
            .map_err(|_| anyhow::anyhow!("client task stopped before login request"))?;
        Ok(())
    }

    pub(super) async fn send_command(&self, command: ClientCommand) -> Result<()> {
        let state = self.state.lock().await;
        if !state.accepting {
            bail!("client host is shutting down");
        }
        let handle = state
            .handle
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("client has not been started"))?;
        handle
            .send_user(command)
            .map_err(|_| anyhow::anyhow!("client task is no longer accepting commands"))
    }

    pub async fn request_current_state(&self) -> Result<()> {
        let api_state = {
            let state = self.state.lock().await;
            let live_api = state.live_api.lock().expect("live_api mutex poisoned");
            live_api.as_ref().map(|server| ClientApiStateWire {
                active: true,
                paused: state
                    .handle
                    .as_ref()
                    .is_some_and(holtburger_core::ClientRuntimeHandle::is_automation_paused),
                endpoint: Some(server.base_url()),
            })
        };
        if let Some(api_state) = api_state {
            let _ = self
                .event_sink
                .publish_client_event(ClientHostEvent::ApiState(api_state));
        }
        self.send_command(ClientCommand::RequestCurrentApplicationState)
            .await
    }

    /// Mirrors renderer target selection into `H3dFrontendMirror` and the Live API event log.
    pub async fn report_selected_entity(&self, guid: Option<holtburger_common::Guid>) {
        let state = self.state.lock().await;
        if state.frontend_mirror.set_selection(guid)
            && let Some(server) = state
                .live_api
                .lock()
                .expect("live_api mutex poisoned")
                .as_ref()
        {
            server.engine().notify_selection_changed(guid);
        }
    }

    /// Mirrors renderer outdoor navigation waypoint into `H3dFrontendMirror` and the Live API event log.
    pub async fn report_navigation_waypoint(
        &self,
        waypoint: Option<ClientNavigationWaypointReport>,
    ) {
        let projected =
            waypoint.and_then(|wp| waypoint_from_scene_point(wp.scene_x, wp.scene_z, &wp.label));
        let state = self.state.lock().await;
        if state.frontend_mirror.set_waypoint(projected.clone())
            && let Some(server) = state
                .live_api
                .lock()
                .expect("live_api mutex poisoned")
                .as_ref()
        {
            server.engine().notify_waypoint_changed(projected);
        }
    }

    /// Completes a pending Live API `GET /v1/screenshot` request from the renderer.
    pub async fn submit_api_screenshot(
        &self,
        request_id: &str,
        content_type: Option<String>,
        base64_data: Option<String>,
        error: Option<String>,
    ) {
        let screenshots = self.state.lock().await.screenshots.clone();
        screenshots.resolve(request_id, content_type, base64_data, error);
    }

    /// Pauses or resumes Live API automation, immediately cancelling active automation actions.
    pub async fn set_automation_paused(&self, paused: bool) -> Result<()> {
        let (handle, api_state) = {
            let state = self.state.lock().await;
            if !state.accepting {
                bail!("client host is shutting down");
            }
            let handle = state
                .handle
                .clone()
                .ok_or_else(|| anyhow::anyhow!("client has not been started"))?;
            let api_state = state
                .live_api
                .lock()
                .expect("live_api mutex poisoned")
                .as_ref()
                .map(|server| ClientApiStateWire {
                    active: true,
                    paused,
                    endpoint: Some(server.base_url()),
                });
            (handle, api_state)
        };
        handle
            .set_automation_paused(paused)
            .map_err(|_| anyhow::anyhow!("client task is no longer accepting commands"))?;
        if let Some(api_state) = api_state {
            let _ = self
                .event_sink
                .publish_client_event(ClientHostEvent::ApiState(api_state));
        }
        Ok(())
    }

    /// Emits a local user message into the Live API `automation` event stream.
    pub async fn send_api_message(&self, text: String) -> Result<()> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            bail!("message text must not be empty");
        }
        let state = self.state.lock().await;
        if !state.accepting {
            bail!("client host is shutting down");
        }
        let live_api = state.live_api.lock().expect("live_api mutex poisoned");
        let server = live_api
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Live API is not active for this launch"))?;
        server.engine().emit_user_message(trimmed.to_string());
        Ok(())
    }

    pub async fn select_character(&self, guid: holtburger_common::Guid) -> Result<()> {
        self.send_command(ClientCommand::SelectCharacter(guid))
            .await
    }

    pub async fn replace_drive(
        &self,
        request: crate::client_host::ClientDriveRequest,
    ) -> Result<()> {
        if let crate::client_host::ClientDriveRequest::RotateFacing { delta_radians } = &request {
            anyhow::ensure!(
                delta_radians.is_finite(),
                "Facing displacement must be finite."
            );
        }
        self.send_command(ClientCommand::DriveSelf(request.into_intent()))
            .await
    }

    pub async fn queue_character_motion_event(
        &self,
        request: crate::client_host::ClientCharacterMotionEventRequest,
    ) -> Result<()> {
        self.send_command(ClientCommand::ControlCharacter(request.into_event()?))
            .await
    }

    async fn camera_input(&self) -> Result<holtburger_core::ClientCameraInputHandle> {
        let state = self.state.lock().await;
        if !state.accepting {
            bail!("client host is shutting down");
        }
        state
            .camera_input
            .clone()
            .ok_or_else(|| anyhow::anyhow!("client has not been started"))
    }

    pub async fn start_camera(
        &self,
        request: holtburger_core::ClientCameraStartRequest,
    ) -> Result<()> {
        self.send_command(ClientCommand::StartClientCamera(request))
            .await
            .map(|_| ())
    }

    pub async fn set_camera_intent(
        &self,
        request: holtburger_core::ClientCameraIntentRequest,
    ) -> Result<()> {
        self.camera_input().await?.set_intent(request).map(|_| ())
    }

    pub async fn set_camera_clearance(
        &self,
        request: holtburger_core::ClientCameraClearanceRequest,
    ) -> Result<()> {
        self.camera_input()
            .await?
            .set_clearance(request)
            .map(|_| ())
    }

    pub async fn acknowledge_world_reveal(&self, world_generation: u64) -> Result<()> {
        self.send_command(ClientCommand::AcknowledgeClientWorldReveal { world_generation })
            .await
    }

    pub async fn set_precise_jump_aim(&self, request: ClientPreciseJumpAimRequest) -> Result<()> {
        self.send_command(ClientCommand::SetPreciseJumpAim(request.into_core()?))
            .await
    }

    pub async fn query_entity_selection_candidates(
        &self,
        request: ClientEntitySelectionQueryRequest,
    ) -> Result<()> {
        self.send_command(ClientCommand::QueryEntitySelectionCandidates(
            request.into_core()?,
        ))
        .await
    }

    pub async fn commit_precise_jump(&self, request: ClientPreciseJumpCommitRequest) -> Result<()> {
        self.send_command(ClientCommand::CommitPreciseJump(request.into_core()?))
            .await
    }

    pub async fn cancel_precise_jump(
        &self,
        request: holtburger_core::PreciseJumpCancelRequest,
    ) -> Result<()> {
        self.send_command(ClientCommand::CancelPreciseJump(request))
            .await
    }

    pub async fn stop_camera(&self, identity: holtburger_core::ClientCameraIdentity) -> Result<()> {
        self.send_command(ClientCommand::StopClientCamera(identity))
            .await
            .map(|_| ())
    }

    pub async fn disconnect(&self) -> Result<()> {
        self.retire(false).await
    }

    /// Enqueue one validated chat intent; this does not acknowledge server delivery.
    pub async fn send_chat(&self, request: ClientChatRequest) -> Result<()> {
        self.send_command(request.into_command()?).await
    }

    /// Application shutdown shares bounded authority retirement with explicit disconnect.
    pub async fn shutdown(&self) {
        if let Err(error) = self.retire(true).await {
            log::error!("client shutdown failed: {error:#}");
        }
    }

    async fn retire(&self, host_shutdown: bool) -> Result<()> {
        let (handle, task, live_api, screenshots, frontend_mirror) = {
            let mut state = self.state.lock().await;
            state.accepting = false;
            state
                .shutdown_requested
                .store(host_shutdown, std::sync::atomic::Ordering::Release);
            state.camera_input = None;
            (
                state.handle.take(),
                state.task.take(),
                state
                    .live_api
                    .lock()
                    .expect("live_api mutex poisoned")
                    .take(),
                state.screenshots.clone(),
                state.frontend_mirror.clone(),
            )
        };
        frontend_mirror.clear();
        screenshots.cancel_all();
        drop(live_api);
        self.stop_startup.notify_one();
        if let Some(handle) = handle {
            // A closed channel already means the authority finished; still join its forwarder.
            let _ = handle.send_user(ClientCommand::Disconnect);
        }
        if let Some(mut task) = task {
            match tokio::time::timeout(std::time::Duration::from_secs(2), &mut task).await {
                Ok(result) => result?,
                Err(_) => {
                    task.abort();
                    match task.await {
                        Err(error) if error.is_cancelled() => {}
                        result => result?,
                    }
                    self.event_sink.publish_client_event(client_exit_requested(
                        if host_shutdown {
                            holtburger_core::ClientExitCause::HostShutdown
                        } else {
                            holtburger_core::ClientExitCause::ExplicitDisconnect
                        },
                        "Disconnected; local session stopped after the shutdown deadline.",
                    ))?;
                }
            }
        }
        Ok(())
    }
}
