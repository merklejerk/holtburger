//! Client-mode lifecycle task and command adapter.
//!
//! `ClientRuntime` remains the sole network/world authority. This module owns only the sidecar
//! lifetime and its typed command seam; client wire projection lives in `client_projection`.

use std::sync::Arc;

use holtburger_core::client::movement_types::{
    CharacterDrive, Gait, LateralMotion, LongitudinalMotion, PlayerDriveIntent, Turn,
};
use holtburger_core::{
    CharacterMotionEvent, CharacterMotionSequence, ClientExitCause, ClientLifecycleState,
    ClientViewEvent, JumpExtent, SequencedCharacterMotionEvent,
};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};

use crate::client_projection::{ClientHostEvent, client_exit_requested, project_client_event};

/// Character gait accepted by the renderer's held-drive controller.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientDriveGait {
    Walk,
    Run,
}

/// Signed longitudinal axis accepted at the renderer boundary.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientDriveLongitudinal {
    Forward,
    Backward,
}

/// Signed lateral axis accepted at the renderer boundary.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientDriveLateral {
    Left,
    Right,
}

/// Signed facing turn accepted at the renderer boundary.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientDriveTurning {
    Left,
    Right,
}

/// Minimal client drive replacement. Protocol cadence, sequence numbers, and movement caps stay
/// inside core's `MovementSystem`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientDriveRequest {
    /// Walk/run gait retained even while both movement axes are neutral.
    pub gait: ClientDriveGait,
    /// Optional forward/backward held axis.
    pub longitudinal: Option<ClientDriveLongitudinal>,
    /// Optional left/right sidestep axis.
    pub lateral: Option<ClientDriveLateral>,
    /// Optional left/right held turn axis.
    pub turning: Option<ClientDriveTurning>,
}

impl ClientDriveRequest {
    fn into_drive(self) -> CharacterDrive {
        CharacterDrive {
            gait: match self.gait {
                ClientDriveGait::Walk => Gait::Walk,
                ClientDriveGait::Run => Gait::Run,
            },
            longitudinal: self.longitudinal.map(|motion| match motion {
                ClientDriveLongitudinal::Forward => LongitudinalMotion::Forward,
                ClientDriveLongitudinal::Backward => LongitudinalMotion::Backward,
            }),
            lateral: self.lateral.map(|motion| match motion {
                ClientDriveLateral::Left => LateralMotion::Left,
                ClientDriveLateral::Right => LateralMotion::Right,
            }),
            turning: self.turning.map(|turn| match turn {
                ClientDriveTurning::Left => Turn::Left,
                ClientDriveTurning::Right => Turn::Right,
            }),
            turn_rate_scalar: None,
        }
    }

    pub fn into_intent(self) -> PlayerDriveIntent {
        PlayerDriveIntent::ManualHeld(self.into_drive())
    }
}

/// Ordered jump lifecycle edge accepted at the renderer boundary.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ClientCharacterMotionEventRequest {
    BeginJump {
        sequence: u64,
        drive: ClientDriveRequest,
    },
    ReleaseJump {
        sequence: u64,
        drive: ClientDriveRequest,
        extent: f32,
    },
    Reset {
        sequence: u64,
    },
}

impl ClientCharacterMotionEventRequest {
    pub fn into_event(self) -> anyhow::Result<SequencedCharacterMotionEvent> {
        let (sequence, event) = match self {
            Self::BeginJump { sequence, drive } => (
                sequence,
                CharacterMotionEvent::BeginJump {
                    drive: drive.into_drive(),
                },
            ),
            Self::ReleaseJump {
                sequence,
                drive,
                extent,
            } => (
                sequence,
                CharacterMotionEvent::ReleaseJump {
                    drive: drive.into_drive(),
                    extent: JumpExtent::new(extent)
                        .map_err(|error| anyhow::anyhow!("invalid jump extent: {error:?}"))?,
                },
            ),
            Self::Reset { sequence } => (sequence, CharacterMotionEvent::Reset),
        };
        Ok(SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(sequence),
            event,
        })
    }
}

/// Owns independently scheduled authority and forwarding, without sharing mutable world state.
pub async fn run_client_task(
    mut client: holtburger_core::ClientRuntime,
    events: broadcast::Receiver<ClientViewEvent>,
    command_tx: mpsc::UnboundedSender<holtburger_core::ClientCommand>,
    sink: Arc<dyn crate::host_event_sink::ClientEventSink>,
    shutdown_requested: Arc<std::sync::atomic::AtomicBool>,
) -> anyhow::Result<()> {
    supervise_client_runtime(
        async move {
            let result = client.run().await;
            let (cause, diagnostic) = match result {
                Ok(()) if shutdown_requested.load(std::sync::atomic::Ordering::Acquire) => (
                    ClientExitCause::HostShutdown,
                    "client host shutdown".to_string(),
                ),
                Ok(()) => {
                    let cause = match client.lifecycle() {
                        ClientLifecycleState::Exiting { cause } => cause,
                        _ => ClientExitCause::ServerDisconnect,
                    };
                    (cause, "client session ended".to_string())
                }
                Err(error) => (ClientExitCause::RuntimeFailure, error.to_string()),
            };
            // Dropping the sole authority also closes its event sender. The forwarder drains
            // that ordered stream before the supervisor publishes the terminal outcome.
            client_exit_requested(cause, diagnostic)
        },
        events,
        command_tx,
        sink,
    )
    .await
}

/// The runtime future owns the event sender; completion or panic must close its stream.
/// JoinSet aborts the authority if forwarding fails or the host cancels this supervisor.
async fn supervise_client_runtime(
    run: impl std::future::Future<Output = ClientHostEvent> + Send + 'static,
    events: broadcast::Receiver<ClientViewEvent>,
    command_tx: mpsc::UnboundedSender<holtburger_core::ClientCommand>,
    sink: Arc<dyn crate::host_event_sink::ClientEventSink>,
) -> anyhow::Result<()> {
    let mut authority = tokio::task::JoinSet::new();
    authority.spawn(run);
    forward_client_events(events, command_tx, sink.as_ref()).await?;
    while let Some(result) = authority.join_next().await {
        let exit = match result {
            Ok(exit) => exit,
            Err(error) => client_exit_requested(ClientExitCause::RuntimeFailure, error.to_string()),
        };
        sink.publish_client_event(exit)?;
    }
    Ok(())
}

/// Preserve snapshot recovery and event order independently of the authority's tick polling.
async fn forward_client_events(
    mut events: broadcast::Receiver<ClientViewEvent>,
    command_tx: mpsc::UnboundedSender<holtburger_core::ClientCommand>,
    sink: &dyn crate::host_event_sink::ClientEventSink,
) -> anyhow::Result<()> {
    // Core emits a few broad compatibility events while constructing its replacement level. The
    // client host publishes only the atomic application snapshot for the initial baseline.
    let mut awaiting_snapshot = true;
    let mut snapshot_request_pending = false;

    loop {
        match events.recv().await {
            Ok(event) => {
                if awaiting_snapshot && !matches!(event, ClientViewEvent::ApplicationSnapshot(_)) {
                    continue;
                }
                if matches!(event, ClientViewEvent::ApplicationSnapshot(_)) {
                    awaiting_snapshot = false;
                    snapshot_request_pending = false;
                }
                if let Some(projected) = project_client_event(event) {
                    sink.publish_client_event(projected)?;
                }
            }
            Err(broadcast::error::RecvError::Lagged(_)) => {
                awaiting_snapshot = true;
                if !snapshot_request_pending {
                    snapshot_request_pending = true;
                    if command_tx
                        .send(holtburger_core::ClientCommand::RequestCurrentApplicationState)
                        .is_err()
                    {
                        // Authority ended before recovery could be requested. The
                        // supervisor owns its real terminal cause, not a second exit.
                        break;
                    }
                }
            }
            Err(broadcast::error::RecvError::Closed) => {
                break;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client_projection::{
        ClientCurrentState, ClientHostEvent, ClientLifecycleWire, project_client_event,
    };
    use holtburger_common::Guid;
    use holtburger_core::{
        ClientApplicationSnapshot, ClientCameraIdentity, ClientCameraStartReceipt,
        ClientLifecycleState, ClientViewEvent, DynamicEntityHostTime, DynamicEntitySnapshot,
    };

    /// Test-owned synchronous publication behavior, including output failure and coordination.
    struct TestSink<F>(F);

    impl<F> crate::host_event_sink::ClientEventSink for TestSink<F>
    where
        F: Fn(ClientHostEvent) -> anyhow::Result<()> + Send + Sync,
    {
        fn publish_client_event(&self, event: ClientHostEvent) -> anyhow::Result<()> {
            (self.0)(event)
        }
    }

    fn snapshot_event() -> ClientViewEvent {
        ClientViewEvent::ApplicationSnapshot(ClientApplicationSnapshot {
            lifecycle: ClientLifecycleState::InWorld,
            local_player_guid: None,
            server_time: None,
            world_generation: 1,
            world_name: None,
            player_name: None,
            vitals: Default::default(),
            character_motion: None,
            dynamic: DynamicEntitySnapshot::new(
                DynamicEntityHostTime::new(0.0).unwrap(),
                Vec::new(),
            ),
            runtime_bodies: Vec::new().into(),
        })
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn forwards_during_a_busy_authority_turn_and_drains_before_exit() {
        let (event_tx, events) = broadcast::channel(8);
        let (command_tx, _commands) = mpsc::unbounded_channel();
        let (forwarded_tx, mut forwarded) = mpsc::unbounded_channel();
        let (progress_tx, progress) = std::sync::mpsc::channel();
        let sink = Arc::new(TestSink(move |event| {
            if matches!(event, ClientHostEvent::CurrentState(_)) {
                progress_tx.send(())?;
            }
            forwarded_tx.send(event)?;
            Ok(())
        }));
        supervise_client_runtime(
            async move {
                event_tx.send(snapshot_event()).unwrap();
                // Deliberately occupy the authority worker until forwarding makes progress.
                // The timeout is a deadlock guard, not a performance assertion.
                progress
                    .recv_timeout(std::time::Duration::from_secs(2))
                    .unwrap();
                event_tx
                    .send(ClientViewEvent::LocalPlayerEstablished {
                        player_guid: Guid(7),
                    })
                    .unwrap();
                client_exit_requested(ClientExitCause::HostShutdown, "test shutdown")
            },
            events,
            command_tx,
            sink,
        )
        .await
        .unwrap();
        assert!(matches!(
            forwarded.recv().await,
            Some(ClientHostEvent::CurrentState(_))
        ));
        assert!(matches!(
            forwarded.recv().await,
            Some(ClientHostEvent::LocalPlayerEstablished {
                player_guid: Guid(7)
            })
        ));
        let Some(ClientHostEvent::ExitRequested(exit)) = forwarded.recv().await else {
            panic!("missing terminal exit");
        };
        assert!(matches!(
            exit.cause,
            crate::client_projection::ClientExitCauseWire::HostShutdown
        ));
        assert!(forwarded.recv().await.is_none());
    }

    #[tokio::test]
    async fn lag_requests_one_snapshot_and_suppresses_deltas_until_replacement() {
        let (event_tx, events) = broadcast::channel(2);
        let (command_tx, mut commands) = mpsc::unbounded_channel();
        let (forwarded_tx, mut forwarded) = mpsc::unbounded_channel();
        let sink = Arc::new(TestSink(move |event| {
            forwarded_tx.send(event)?;
            Ok(())
        }));
        for _ in 0..4 {
            event_tx
                .send(ClientViewEvent::LocalPlayerEstablished {
                    player_guid: Guid(1),
                })
                .unwrap();
        }
        let forwarder =
            tokio::spawn(
                async move { forward_client_events(events, command_tx, sink.as_ref()).await },
            );
        assert!(matches!(
            commands.recv().await,
            Some(holtburger_core::ClientCommand::RequestCurrentApplicationState)
        ));
        event_tx.send(snapshot_event()).unwrap();
        assert!(matches!(
            forwarded.recv().await,
            Some(ClientHostEvent::CurrentState(_))
        ));
        event_tx
            .send(ClientViewEvent::LocalPlayerEstablished {
                player_guid: Guid(2),
            })
            .unwrap();
        assert!(matches!(
            forwarded.recv().await,
            Some(ClientHostEvent::LocalPlayerEstablished {
                player_guid: Guid(2)
            })
        ));
        assert!(commands.try_recv().is_err());
        drop(event_tx);
        forwarder.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn sink_failure_cancels_the_owned_authority() {
        let (event_tx, events) = broadcast::channel(2);
        let (command_tx, _commands) = mpsc::unbounded_channel();
        let (lifetime, dropped) = tokio::sync::oneshot::channel::<()>();
        let sink = Arc::new(TestSink(|_| anyhow::bail!("output closed")));
        let error = supervise_client_runtime(
            async move {
                let _lifetime = lifetime;
                event_tx.send(snapshot_event()).unwrap();
                std::future::pending::<()>().await;
                drop(event_tx);
                client_exit_requested(ClientExitCause::HostShutdown, "unreachable")
            },
            events,
            command_tx,
            sink,
        )
        .await
        .unwrap_err();
        assert_eq!(error.to_string(), "output closed");
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(2), dropped)
                .await
                .unwrap()
                .is_err()
        );
    }

    #[tokio::test]
    async fn cancelling_the_supervisor_does_not_detach_authority() {
        let (event_tx, events) = broadcast::channel(2);
        let (command_tx, _commands) = mpsc::unbounded_channel();
        let (started_tx, started) = tokio::sync::oneshot::channel();
        let (lifetime, dropped) = tokio::sync::oneshot::channel::<()>();
        let task = tokio::spawn(supervise_client_runtime(
            async move {
                let _lifetime = lifetime;
                started_tx.send(()).unwrap();
                std::future::pending::<()>().await;
                drop(event_tx);
                client_exit_requested(ClientExitCause::HostShutdown, "unreachable")
            },
            events,
            command_tx,
            Arc::new(TestSink(|_| Ok(()))),
        ));
        started.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(2), dropped)
                .await
                .unwrap()
                .is_err()
        );
    }

    #[tokio::test]
    async fn authority_panic_publishes_one_terminal_failure() {
        let (event_tx, events) = broadcast::channel(2);
        let (command_tx, _commands) = mpsc::unbounded_channel();
        let (forwarded_tx, mut forwarded) = mpsc::unbounded_channel();
        supervise_client_runtime(
            async move {
                let _events = event_tx;
                panic!("authority test failure");
            },
            events,
            command_tx,
            Arc::new(TestSink(move |event| {
                forwarded_tx.send(event)?;
                Ok(())
            })),
        )
        .await
        .unwrap();
        let Some(ClientHostEvent::ExitRequested(exit)) = forwarded.recv().await else {
            panic!("missing terminal failure");
        };
        assert!(exit.diagnostic.contains("authority test failure"));
        assert!(matches!(
            exit.cause,
            crate::client_projection::ClientExitCauseWire::RuntimeFailure
        ));
        assert!(forwarded.recv().await.is_none());
    }

    #[test]
    fn drive_request_maps_only_renderer_axes_into_core_intent() {
        let request: ClientDriveRequest = serde_json::from_value(serde_json::json!({
            "gait": "run",
            "longitudinal": "backward",
            "lateral": "right",
            "turning": "left",
        }))
        .expect("drive request should decode");

        assert_eq!(
            request.into_intent(),
            PlayerDriveIntent::ManualHeld(CharacterDrive {
                gait: Gait::Run,
                longitudinal: Some(LongitudinalMotion::Backward),
                lateral: Some(LateralMotion::Right),
                turning: Some(Turn::Left),
                turn_rate_scalar: None,
            })
        );
        assert!(
            serde_json::from_value::<ClientDriveRequest>(serde_json::json!({
                "gait": "run",
                "longitudinal": null,
                "lateral": null,
                "turning": null,
                "extra": true,
            }))
            .is_err()
        );
    }

    #[test]
    fn character_motion_requests_preserve_ordered_edges_and_release_drive() {
        let begin: ClientCharacterMotionEventRequest = serde_json::from_value(serde_json::json!({
            "kind": "begin-jump",
            "sequence": 41,
            "drive": {
                "gait": "walk",
                "longitudinal": null,
                "lateral": null,
                "turning": "right"
            }
        }))
        .expect("begin request should decode");
        assert_eq!(
            begin.into_event().expect("begin edge should convert"),
            SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(41),
                event: CharacterMotionEvent::BeginJump {
                    drive: CharacterDrive {
                        gait: Gait::Walk,
                        longitudinal: None,
                        lateral: None,
                        turning: Some(Turn::Right),
                        turn_rate_scalar: None,
                    },
                },
            }
        );

        let release: ClientCharacterMotionEventRequest =
            serde_json::from_value(serde_json::json!({
                "kind": "release-jump",
                "sequence": 42,
                "drive": {
                    "gait": "run",
                    "longitudinal": "forward",
                    "lateral": "left",
                    "turning": null
                },
                "extent": 0.75
            }))
            .expect("release request should decode");
        assert_eq!(
            release.into_event().expect("release edge should convert"),
            SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(42),
                event: CharacterMotionEvent::ReleaseJump {
                    drive: CharacterDrive {
                        gait: Gait::Run,
                        longitudinal: Some(LongitudinalMotion::Forward),
                        lateral: Some(LateralMotion::Left),
                        turning: None,
                        turn_rate_scalar: None,
                    },
                    extent: JumpExtent::new(0.75).unwrap(),
                },
            }
        );
    }

    #[test]
    fn character_motion_request_rejects_invalid_extent_and_unknown_fields() {
        let invalid_extent: ClientCharacterMotionEventRequest =
            serde_json::from_value(serde_json::json!({
                "kind": "release-jump",
                "sequence": 2,
                "drive": {
                    "gait": "run",
                    "longitudinal": null,
                    "lateral": null,
                    "turning": null
                },
                "extent": 1.1
            }))
            .expect("finite extent is decoded before semantic validation");
        assert!(invalid_extent.into_event().is_err());
        assert!(
            serde_json::from_value::<ClientCharacterMotionEventRequest>(serde_json::json!({
                "kind": "reset",
                "sequence": 3,
                "extra": true
            }))
            .is_err()
        );
    }

    #[test]
    fn lifecycle_projects_character_selection_while_snapshot_owns_local_identity() {
        let lifecycle = ClientLifecycleWire::from(&ClientLifecycleState::CharacterSelection {
            characters: vec![holtburger_core::ClientCharacterSummary {
                guid: Guid(0x5000_0007),
                name: "Mira".to_string(),
                slot: 3,
                delete_time: 0,
            }],
        });
        assert_eq!(
            serde_json::to_value(lifecycle).expect("wire lifecycle should serialize"),
            serde_json::json!({
                "kind": "character-selection",
                "characters": [{
                    "guid": 0x5000_0007u64,
                    "name": "Mira",
                    "slot": 3,
                    "deleteTime": 0,
                }],
            })
        );

        let snapshot = ClientApplicationSnapshot {
            lifecycle: ClientLifecycleState::InWorld,
            local_player_guid: Some(Guid(0x5000_0008)),
            server_time: Some(22.0),
            world_generation: 4,
            world_name: Some("Leafcull".to_string()),
            player_name: Some("Mira".to_string()),
            vitals: std::collections::HashMap::new(),
            character_motion: None,
            dynamic: DynamicEntitySnapshot::new(
                DynamicEntityHostTime::new(22.0).unwrap(),
                Vec::new(),
            ),
            runtime_bodies: Vec::new().into(),
        };
        let current = ClientCurrentState::from(&snapshot);
        assert_eq!(
            serde_json::to_value(&current)
                .expect("current state should serialize")
                .get("localPlayerGuid"),
            Some(&serde_json::json!(0x5000_0008u64))
        );
        assert!(matches!(current.lifecycle, ClientLifecycleWire::InWorld));
        assert_eq!(current.local_player_guid, Some(Guid(0x5000_0008)));
        assert_eq!(current.world_generation, 4);
    }

    #[test]
    fn broad_core_events_stop_at_the_client_host_boundary() {
        assert!(project_client_event(ClientViewEvent::Disconnected).is_none());
    }

    #[test]
    fn local_player_identity_crosses_independently_of_lifecycle() {
        let player_guid = Guid(0x5000_0009);
        assert!(matches!(
            project_client_event(ClientViewEvent::LocalPlayerEstablished { player_guid }),
            Some(ClientHostEvent::LocalPlayerEstablished {
                player_guid: projected
            }) if projected == player_guid
        ));
    }

    #[test]
    fn camera_generation_receipts_cross_only_the_client_host_surface() {
        let identity = ClientCameraIdentity {
            camera_generation: 3,
            player_guid: Guid(0x5000_0009),
            entity_generation: 7,
        };
        let projected =
            project_client_event(ClientViewEvent::CameraStarted(ClientCameraStartReceipt {
                identity,
            }));
        assert!(matches!(
            projected,
            Some(ClientHostEvent::CameraStarted(receipt)) if receipt.identity == identity
        ));
    }
}
