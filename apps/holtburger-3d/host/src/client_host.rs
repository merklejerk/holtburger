//! Client-mode lifecycle task and command adapter.
//!
//! `ClientRuntime` remains the sole network/world authority. This module owns only the sidecar
//! lifetime and its typed command seam; client wire projection lives in `client_projection`.

use std::sync::Arc;

use holtburger_core::client::movement_types::{
    CharacterDrive, Gait, LongitudinalMotion, PlayerDriveIntent, Turn,
};
use holtburger_core::{ClientExitCause, ClientLifecycleState, ClientViewEvent};
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};

use crate::client_projection::project_client_event;

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
    /// Optional left/right held turn axis.
    pub turning: Option<ClientDriveTurning>,
}

impl ClientDriveRequest {
    pub fn into_intent(self) -> PlayerDriveIntent {
        PlayerDriveIntent::ManualHeld(CharacterDrive {
            gait: match self.gait {
                ClientDriveGait::Walk => Gait::Walk,
                ClientDriveGait::Run => Gait::Run,
            },
            longitudinal: self.longitudinal.map(|motion| match motion {
                ClientDriveLongitudinal::Forward => LongitudinalMotion::Forward,
                ClientDriveLongitudinal::Backward => LongitudinalMotion::Backward,
            }),
            lateral: None,
            turning: self.turning.map(|turn| match turn {
                ClientDriveTurning::Left => Turn::Left,
                ClientDriveTurning::Right => Turn::Right,
            }),
            turn_rate_scalar: None,
        })
    }
}

/// Drains one core runtime and its broadcast receiver. A lagged receiver enters replacement mode
/// and suppresses deltas until the requested application snapshot arrives.
pub async fn run_client_task(
    mut client: holtburger_core::ClientRuntime,
    mut events: broadcast::Receiver<ClientViewEvent>,
    command_tx: mpsc::UnboundedSender<holtburger_core::ClientCommand>,
    sink: Arc<dyn crate::host_event_sink::ClientEventSink>,
    shutdown_requested: Arc<std::sync::atomic::AtomicBool>,
) {
    let mut run = Box::pin(client.run());
    // Core emits a few broad compatibility events while constructing its replacement level. The
    // client host publishes only the atomic application snapshot for the initial baseline.
    let mut awaiting_snapshot = true;
    let mut snapshot_request_pending = false;

    loop {
        tokio::select! {
            result = &mut run => {
                drop(run);
                let (cause, diagnostic) = match result {
                    Ok(()) => {
                        if shutdown_requested.load(std::sync::atomic::Ordering::Acquire) {
                            (ClientExitCause::HostShutdown, "client host shutdown".to_string())
                        } else {
                            let lifecycle = client.lifecycle();
                            let cause = match lifecycle {
                                ClientLifecycleState::Exiting { cause } => cause,
                                _ => ClientExitCause::ServerDisconnect,
                            };
                            (cause, "client session ended".to_string())
                        }
                    }
                    Err(error) => (ClientExitCause::RuntimeFailure, error.to_string()),
                };
                let _ = sink.publish_client_event(crate::client_projection::client_exit_requested(cause, diagnostic));
                break;
            }
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        if awaiting_snapshot && !matches!(event, ClientViewEvent::ApplicationSnapshot(_)) {
                            continue;
                        }
                        if matches!(event, ClientViewEvent::ApplicationSnapshot(_)) {
                            awaiting_snapshot = false;
                            snapshot_request_pending = false;
                        }
                        if let Some(projected) = project_client_event(event) {
                            let _ = sink.publish_client_event(projected);
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
                                let _ = sink.publish_client_event(crate::client_projection::client_exit_requested(
                                    ClientExitCause::RuntimeFailure,
                                    "client task stopped while requesting current state",
                                ));
                                break;
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        let _ = sink.publish_client_event(crate::client_projection::client_exit_requested(
                            ClientExitCause::RuntimeFailure,
                            "client event publication closed",
                        ));
                        break;
                    }
                }
            }
        }
    }
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

    #[test]
    fn drive_request_maps_only_renderer_axes_into_core_intent() {
        let request: ClientDriveRequest = serde_json::from_value(serde_json::json!({
            "gait": "run",
            "longitudinal": "backward",
            "turning": "left",
        }))
        .expect("drive request should decode");

        assert_eq!(
            request.into_intent(),
            PlayerDriveIntent::ManualHeld(CharacterDrive {
                gait: Gait::Run,
                longitudinal: Some(LongitudinalMotion::Backward),
                lateral: None,
                turning: Some(Turn::Left),
                turn_rate_scalar: None,
            })
        );
        assert!(
            serde_json::from_value::<ClientDriveRequest>(serde_json::json!({
                "gait": "run",
                "longitudinal": null,
                "turning": null,
                "extra": true,
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
