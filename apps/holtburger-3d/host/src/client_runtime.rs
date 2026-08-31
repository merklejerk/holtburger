//! Client-only host composition.

use std::sync::Arc;

use anyhow::{Result, bail, ensure};
use holtburger_core::ClientCommand;
use serde::Deserialize;

use crate::client_host::run_client_task;
use crate::client_projection::client_exit_requested;
use crate::host_event_sink::ClientEventSink;
use crate::host_mode::ClientLaunchConfiguration;
use crate::protocol::{HostResponse, ProtocolError, application_error};
use crate::shared_host_content::SharedHostContent;

/// Strict renderer-owned camera identity reused by precise-jump commands.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientPreciseJumpCameraIdentity {
    pub camera_generation: u64,
    pub player_guid: holtburger_common::Guid,
    pub entity_generation: u64,
}

impl From<ClientPreciseJumpCameraIdentity> for holtburger_core::ClientCameraIdentity {
    fn from(identity: ClientPreciseJumpCameraIdentity) -> Self {
        Self {
            camera_generation: identity.camera_generation,
            player_guid: identity.player_guid,
            entity_generation: identity.entity_generation,
        }
    }
}

/// Strict renderer camera-ray request; authority and launch facts are intentionally absent.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientPreciseJumpAimRequest {
    pub camera: ClientPreciseJumpCameraIdentity,
    pub sequence: u64,
    pub anchor: holtburger_common::Guid,
    pub start: [f32; 3],
    pub direction: [f32; 3],
    pub maximum_distance: f32,
    pub previous_cell: Option<holtburger_common::Guid>,
}

impl ClientPreciseJumpAimRequest {
    fn into_core(self) -> Result<holtburger_core::PreciseJumpAimRequest> {
        let finite = |vector: [f32; 3]| vector.into_iter().all(f32::is_finite);
        ensure!(finite(self.start), "precise-jump ray start must be finite");
        ensure!(
            finite(self.direction),
            "precise-jump ray direction must be finite"
        );
        ensure!(
            self.maximum_distance.is_finite() && self.maximum_distance >= 0.0,
            "precise-jump ray distance must be finite and non-negative"
        );
        Ok(holtburger_core::PreciseJumpAimRequest {
            camera: self.camera.into(),
            sequence: holtburger_core::PreciseJumpAimSequence(self.sequence),
            anchor: self.anchor,
            start: holtburger_common::Vector3::new(self.start[0], self.start[1], self.start[2]),
            direction: holtburger_common::Vector3::new(
                self.direction[0],
                self.direction[1],
                self.direction[2],
            ),
            maximum_distance: self.maximum_distance,
            previous_cell: self.previous_cell,
        })
    }
}

/// Strict opaque commit identity returned by one earlier evaluation event.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientPreciseJumpCommitRequest {
    pub sequence: u64,
    pub evaluation_id: u64,
}

/// Strict ordered cancellation edge.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientPreciseJumpCancelRequest {
    pub sequence: u64,
}

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
    SetClientPreciseJumpAim {
        request: ClientPreciseJumpAimRequest,
    },
    CommitClientPreciseJump {
        request: ClientPreciseJumpCommitRequest,
    },
    CancelClientPreciseJump {
        request: ClientPreciseJumpCancelRequest,
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
    "set_client_precise_jump_aim",
    "commit_client_precise_jump",
    "cancel_client_precise_jump",
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

    pub async fn set_precise_jump_aim(&self, request: ClientPreciseJumpAimRequest) -> Result<()> {
        self.send_command(ClientCommand::SetPreciseJumpAim(request.into_core()?))
            .await
    }

    pub async fn commit_precise_jump(&self, request: ClientPreciseJumpCommitRequest) -> Result<()> {
        self.send_command(ClientCommand::CommitPreciseJump(
            holtburger_core::PreciseJumpCommitRequest {
                sequence: holtburger_core::PreciseJumpActionSequence(request.sequence),
                evaluation: holtburger_core::PreciseJumpEvaluationId::from_wire(
                    request.evaluation_id,
                ),
            },
        ))
        .await
    }

    pub async fn cancel_precise_jump(&self, request: ClientPreciseJumpCancelRequest) -> Result<()> {
        self.send_command(ClientCommand::CancelPreciseJump(
            holtburger_core::PreciseJumpCancelRequest {
                sequence: holtburger_core::PreciseJumpActionSequence(request.sequence),
            },
        ))
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
        SetClientPreciseJumpAim { request } => runtime
            .set_precise_jump_aim(request)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        CommitClientPreciseJump { request } => runtime
            .commit_precise_jump(request)
            .await
            .map(|()| HostResponse::Unit)
            .map_err(application_error),
        CancelClientPreciseJump { request } => runtime
            .cancel_precise_jump(request)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn aim_json() -> serde_json::Value {
        serde_json::json!({
            "camera": {
                "cameraGeneration": 2,
                "playerGuid": 0x5000_0001_u32,
                "entityGeneration": 7
            },
            "sequence": 9,
            "anchor": 0xda55_ffff_u32,
            "start": [10.0, 20.0, 4.0],
            "direction": [0.0, 1.0, 0.0],
            "maximumDistance": 80.0,
            "previousCell": null
        })
    }

    #[test]
    fn precise_jump_aim_rejects_unknown_and_non_finite_renderer_fields() {
        let mut unknown = aim_json();
        unknown["extent"] = serde_json::json!(1.0);
        assert!(serde_json::from_value::<ClientPreciseJumpAimRequest>(unknown).is_err());

        let mut nested_unknown = aim_json();
        nested_unknown["camera"]["velocity"] = serde_json::json!([1, 2, 3]);
        assert!(serde_json::from_value::<ClientPreciseJumpAimRequest>(nested_unknown).is_err());

        let mut non_finite = serde_json::from_value::<ClientPreciseJumpAimRequest>(aim_json())
            .expect("finite strict aim request");
        non_finite.start[0] = f32::NAN;
        assert!(non_finite.into_core().is_err());
    }

    #[test]
    fn precise_jump_commit_and_cancel_reject_unknown_fields() {
        assert!(
            serde_json::from_value::<ClientPreciseJumpCommitRequest>(serde_json::json!({
                "sequence": 3,
                "evaluationId": 11,
                "velocity": [1, 2, 3]
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ClientPreciseJumpCancelRequest>(serde_json::json!({
                "sequence": 4,
                "evaluationId": 11
            }))
            .is_err()
        );
    }
}
