//! Client-only host composition.

use std::sync::Arc;

use anyhow::{Result, bail};
use holtburger_core::ClientCommand;
use serde::Deserialize;

use crate::client_host::run_client_task;
use crate::client_projection::client_exit_requested;
use crate::host_event_sink::ClientEventSink;
use crate::host_mode::ClientLaunchConfiguration;
use crate::protocol::{HostResponse, ProtocolError, application_error};
use crate::shared_host_content::SharedHostContent;

/// Commands accepted only by the client authority.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum ClientHostCommand {
    /// Private Electron-main launch command; renderers never receive this inventory entry.
    StartClient {
        startup: ClientLaunchConfiguration,
    },
    RequestClientCurrentState,
    SelectClientCharacter {
        guid: holtburger_common::Guid,
    },
    ReplaceClientDrive {
        request: crate::client_host::ClientDriveRequest,
    },
    QueueClientCharacterMotionEvent {
        request: crate::client_host::ClientCharacterMotionEventRequest,
    },
    SendClientChat {
        message: String,
    },
    StartClientCamera {
        request: holtburger_core::ClientCameraStartRequest,
    },
    SetClientCameraIntent {
        request: holtburger_core::ClientCameraIntentRequest,
    },
    SetClientCameraClearance {
        request: holtburger_core::ClientCameraClearanceRequest,
    },
    /// Renderer acknowledgement after the matching destination has been installed and revealed.
    AcknowledgeClientWorldReveal {
        /// Renderer wire contracts use camelCase; keep the inline enum field explicit.
        #[serde(rename = "worldGeneration")]
        world_generation: u64,
    },
    StopClientCamera {
        request: holtburger_core::ClientCameraIdentity,
    },
    DisconnectClient,
}

/// Exact wire names owned by the client dispatcher.
pub const CLIENT_COMMAND_NAMES: &[&str] = &[
    "start_client",
    "request_client_current_state",
    "select_client_character",
    "replace_client_drive",
    "queue_client_character_motion_event",
    "send_client_chat",
    "start_client_camera",
    "set_client_camera_intent",
    "set_client_camera_clearance",
    "acknowledge_client_world_reveal",
    "stop_client_camera",
    "disconnect_client",
];

struct ClientHostState {
    started: bool,
    accepting: bool,
    command_tx: Option<tokio::sync::mpsc::UnboundedSender<ClientCommand>>,
    task: Option<tokio::task::JoinHandle<()>>,
    shutdown_requested: Arc<std::sync::atomic::AtomicBool>,
}

/// Client composition root. It owns exactly one core runtime/task for the lifetime of one launch.
pub struct ClientHostRuntime {
    /// Static-content discovery and reusable content service shared with Explorer.
    pub content: SharedHostContent,
    event_sink: Arc<dyn ClientEventSink>,
    state: tokio::sync::Mutex<ClientHostState>,
}

impl ClientHostRuntime {
    /// Composes the client shell without constructing any Explorer authority or scheduler.
    pub fn from_content(content: SharedHostContent, event_sink: Arc<dyn ClientEventSink>) -> Self {
        Self {
            content,
            event_sink,
            state: tokio::sync::Mutex::new(ClientHostState {
                started: false,
                accepting: true,
                command_tx: None,
                task: None,
                shutdown_requested: Arc::new(std::sync::atomic::AtomicBool::new(false)),
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
            state.started = true;
            state.accepting = true;
            Arc::clone(&state.shutdown_requested)
        };

        let bootstrap = match self.content.client_world_bootstrap() {
            Ok(bootstrap) => bootstrap,
            Err(error) => {
                let _ = self.event_sink.publish_client_event(client_exit_requested(
                    holtburger_core::ClientExitCause::StartupFailure,
                    error.to_string(),
                ));
                return Err(error);
            }
        };

        let builder = holtburger_core::ClientRuntimeBuilder::new(startup.account.clone())
            .server(startup.host.clone(), startup.port)
            .world_bootstrap(bootstrap)
            .require_external_world_reveal()
            .collision_source(Arc::new(
                holtburger_core::ContentClientCollisionSource::new(
                    Arc::clone(&self.content.service),
                    Arc::clone(&self.content.repository),
                ),
            ));
        let mut client = match builder.connect().await {
            Ok(client) => client,
            Err(error) => {
                let _ = self.event_sink.publish_client_event(client_exit_requested(
                    holtburger_core::ClientExitCause::StartupFailure,
                    error.to_string(),
                ));
                return Err(error);
            }
        };

        // Subscribe before either startup command is queued so no status, snapshot, or login
        // transition can be lost between core construction and task publication.
        let events = client.subscribe_client_view_events();
        let (command_tx, command_rx) = tokio::sync::mpsc::unbounded_channel();
        client.set_command_rx(command_rx);
        let task = tokio::spawn(run_client_task(
            client,
            events,
            command_tx.clone(),
            Arc::clone(&self.event_sink),
            shutdown_requested,
        ));

        {
            let mut state = self.state.lock().await;
            state.command_tx = Some(command_tx.clone());
            state.task = Some(task);
        }

        command_tx
            .send(ClientCommand::RequestCurrentApplicationState)
            .map_err(|_| anyhow::anyhow!("client task stopped before current-state request"))?;
        // Move, rather than clone, the password into the one login command. No host state retains
        // the credential after this send succeeds.
        command_tx
            .send(ClientCommand::Login(startup.password))
            .map_err(|_| anyhow::anyhow!("client task stopped before login request"))?;
        Ok(())
    }

    async fn send_command(&self, command: ClientCommand) -> Result<()> {
        let state = self.state.lock().await;
        if !state.accepting {
            bail!("client host is shutting down");
        }
        let sender = state
            .command_tx
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("client has not been started"))?;
        sender
            .send(command)
            .map_err(|_| anyhow::anyhow!("client task is no longer accepting commands"))
    }

    pub async fn request_current_state(&self) -> Result<()> {
        self.send_command(ClientCommand::RequestCurrentApplicationState)
            .await
    }

    pub async fn select_character(&self, guid: holtburger_common::Guid) -> Result<()> {
        self.send_command(ClientCommand::SelectCharacter(guid))
            .await
    }

    pub async fn replace_drive(
        &self,
        request: crate::client_host::ClientDriveRequest,
    ) -> Result<()> {
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
        self.send_command(ClientCommand::SetClientCameraIntent(request))
            .await
            .map(|_| ())
    }

    pub async fn set_camera_clearance(
        &self,
        request: holtburger_core::ClientCameraClearanceRequest,
    ) -> Result<()> {
        self.send_command(ClientCommand::SetClientCameraClearance(request))
            .await
            .map(|_| ())
    }

    pub async fn acknowledge_world_reveal(&self, world_generation: u64) -> Result<()> {
        self.send_command(ClientCommand::AcknowledgeClientWorldReveal { world_generation })
            .await
    }

    pub async fn stop_camera(&self, identity: holtburger_core::ClientCameraIdentity) -> Result<()> {
        self.send_command(ClientCommand::StopClientCamera(identity))
            .await
            .map(|_| ())
    }

    pub async fn disconnect(&self) -> Result<()> {
        self.send_command(ClientCommand::Disconnect).await
    }

    /// Send one ordinary local-speech message through core's existing chat command path.
    pub async fn send_chat(&self, message: String) -> Result<()> {
        if message.trim().is_empty() {
            bail!("client chat message must contain visible text");
        }
        self.send_command(ClientCommand::Talk(message)).await
    }

    /// Stops command intake, asks core to disconnect, and bounds the owned task lifetime.
    pub async fn shutdown(&self) {
        let (sender, task) = {
            let mut state = self.state.lock().await;
            state.accepting = false;
            state
                .shutdown_requested
                .store(true, std::sync::atomic::Ordering::Release);
            (state.command_tx.take(), state.task.take())
        };
        if let Some(sender) = sender {
            let _ = sender.send(ClientCommand::Disconnect);
        }
        if let Some(mut task) = task {
            let completed = tokio::time::timeout(std::time::Duration::from_secs(2), &mut task)
                .await
                .is_ok();
            if !completed {
                task.abort();
                let _ = task.await;
            }
        }
    }
}

/// Dispatches one client-only command against the client authority.
pub async fn dispatch_client(
    runtime: &ClientHostRuntime,
    command: ClientHostCommand,
) -> Result<HostResponse, ProtocolError> {
    use ClientHostCommand::*;

    match command {
        StartClient { startup } => runtime
            .start(startup)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        RequestClientCurrentState => runtime
            .request_current_state()
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        SelectClientCharacter { guid } => runtime
            .select_character(guid)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        ReplaceClientDrive { request } => runtime
            .replace_drive(request)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        QueueClientCharacterMotionEvent { request } => runtime
            .queue_character_motion_event(request)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        SendClientChat { message } => runtime
            .send_chat(message)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        StartClientCamera { request } => runtime
            .start_camera(request)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        SetClientCameraIntent { request } => runtime
            .set_camera_intent(request)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        SetClientCameraClearance { request } => runtime
            .set_camera_clearance(request)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        AcknowledgeClientWorldReveal { world_generation } => runtime
            .acknowledge_world_reveal(world_generation)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        StopClientCamera { request } => runtime
            .stop_camera(request)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        DisconnectClient => runtime
            .disconnect()
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
    }
}
