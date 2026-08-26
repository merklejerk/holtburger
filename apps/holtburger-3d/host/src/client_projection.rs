//! Client-specific projection from core view events to the renderer contract.

use holtburger_common::Guid;
use holtburger_core::{
    ClientApplicationSnapshot, ClientCameraStartReceipt, ClientCameraTick, ClientExitCause,
    ClientLifecycleState, ClientViewEvent, DynamicEntityEvent,
};
use serde::Serialize;

/// Renderer-safe lifecycle state. Core's broad state and protocol packet values stop here.
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ClientLifecycleWire {
    Connecting,
    Authenticating,
    CharacterSelection {
        characters: Vec<ClientCharacterWire>,
    },
    EnteringWorld {
        character_guid: Guid,
    },
    InWorld {
        player_guid: Guid,
    },
    Exiting {
        cause: ClientExitCauseWire,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCharacterWire {
    /// Server-assigned character identity used by the entry command.
    pub guid: Guid,
    /// Server-provided display name.
    pub name: String,
    /// Stable ordinal in the server-provided character list.
    pub slot: u32,
    /// Server deletion timestamp; zero denotes an active character.
    pub delete_time: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientExitCauseWire {
    ExplicitDisconnect,
    ServerDisconnect,
    StartupFailure,
    RuntimeFailure,
    HostShutdown,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientWorldDiscontinuityWire {
    Teleport,
    ForcedReposition,
    Reset,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCurrentState {
    /// Complete renderer-facing lifecycle level.
    pub lifecycle: ClientLifecycleWire,
    /// Synchronized server time, absent until a server time-sync arrives.
    pub server_time: Option<f64>,
    /// Monotonic generation invalidating presentation history across discontinuities.
    pub world_generation: u64,
    /// Complete focused dynamic-entity replacement level.
    pub dynamic: holtburger_core::DynamicEntitySnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientWorldDiscontinuity {
    /// Generation that becomes current after this edge.
    pub world_generation: u64,
    /// Authority-classified discontinuity kind.
    pub kind: ClientWorldDiscontinuityWire,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientExitRequested {
    /// Typed terminal cause used by Electron exit policy.
    pub cause: ClientExitCauseWire,
    /// Redacted diagnostic suitable for the main-process error surface.
    pub diagnostic: String,
}

/// Narrow event vocabulary emitted by the client host. It is converted into the outer sidecar
/// frame only at the protocol writer, so core `ClientViewEvent` never becomes a wire contract.
#[derive(Debug, Clone)]
pub enum ClientHostEvent {
    CurrentState(ClientCurrentState),
    LifecycleChanged(ClientLifecycleWire),
    ServerTimeUpdated { time: f64 },
    DynamicEntity(DynamicEntityEvent),
    Camera(ClientCameraTick),
    CameraStarted(ClientCameraStartReceipt),
    WorldDiscontinuity(ClientWorldDiscontinuity),
    ExitRequested(ClientExitRequested),
}

impl From<&ClientLifecycleState> for ClientLifecycleWire {
    fn from(state: &ClientLifecycleState) -> Self {
        match state {
            ClientLifecycleState::Connecting => Self::Connecting,
            ClientLifecycleState::Authenticating => Self::Authenticating,
            ClientLifecycleState::CharacterSelection { characters } => Self::CharacterSelection {
                characters: characters
                    .iter()
                    .map(|character| ClientCharacterWire {
                        guid: character.guid,
                        name: character.name.clone(),
                        slot: character.slot,
                        delete_time: character.delete_time,
                    })
                    .collect(),
            },
            ClientLifecycleState::EnteringWorld { character_guid } => Self::EnteringWorld {
                character_guid: *character_guid,
            },
            ClientLifecycleState::InWorld { player_guid } => Self::InWorld {
                player_guid: *player_guid,
            },
            ClientLifecycleState::Exiting { cause } => Self::Exiting {
                cause: (*cause).into(),
            },
        }
    }
}

impl From<ClientExitCause> for ClientExitCauseWire {
    fn from(cause: ClientExitCause) -> Self {
        match cause {
            ClientExitCause::ExplicitDisconnect => Self::ExplicitDisconnect,
            ClientExitCause::ServerDisconnect => Self::ServerDisconnect,
            ClientExitCause::StartupFailure => Self::StartupFailure,
            ClientExitCause::RuntimeFailure => Self::RuntimeFailure,
            ClientExitCause::HostShutdown => Self::HostShutdown,
        }
    }
}

impl From<holtburger_core::ClientWorldDiscontinuityKind> for ClientWorldDiscontinuityWire {
    fn from(kind: holtburger_core::ClientWorldDiscontinuityKind) -> Self {
        match kind {
            holtburger_core::ClientWorldDiscontinuityKind::Teleport => Self::Teleport,
            holtburger_core::ClientWorldDiscontinuityKind::ForcedReposition => {
                Self::ForcedReposition
            }
            holtburger_core::ClientWorldDiscontinuityKind::Reset => Self::Reset,
        }
    }
}

impl From<&ClientApplicationSnapshot> for ClientCurrentState {
    fn from(snapshot: &ClientApplicationSnapshot) -> Self {
        Self {
            lifecycle: (&snapshot.lifecycle).into(),
            server_time: snapshot.server_time,
            world_generation: snapshot.world_generation,
            dynamic: snapshot.dynamic.clone(),
        }
    }
}

/// Projects one broad core event into the renderer-safe client event surface.
pub fn project_client_event(event: ClientViewEvent) -> Option<ClientHostEvent> {
    match event {
        ClientViewEvent::ApplicationSnapshot(snapshot) => {
            Some(ClientHostEvent::CurrentState((&snapshot).into()))
        }
        ClientViewEvent::LifecycleChanged(lifecycle) => {
            Some(ClientHostEvent::LifecycleChanged((&lifecycle).into()))
        }
        ClientViewEvent::ServerTimeUpdated { time } => {
            Some(ClientHostEvent::ServerTimeUpdated { time })
        }
        ClientViewEvent::DynamicEntity(event) => Some(ClientHostEvent::DynamicEntity(event)),
        ClientViewEvent::Camera(tick) => Some(ClientHostEvent::Camera(tick)),
        ClientViewEvent::CameraStarted(receipt) => Some(ClientHostEvent::CameraStarted(receipt)),
        ClientViewEvent::WorldDiscontinuity {
            world_generation,
            kind,
        } => Some(ClientHostEvent::WorldDiscontinuity(
            ClientWorldDiscontinuity {
                world_generation,
                kind: kind.into(),
            },
        )),
        _ => None,
    }
}

/// Converts an explicit task result into a redacted diagnostic without preserving credentials.
pub fn client_exit_requested(
    cause: ClientExitCause,
    diagnostic: impl Into<String>,
) -> ClientHostEvent {
    ClientHostEvent::ExitRequested(ClientExitRequested {
        cause: cause.into(),
        diagnostic: diagnostic.into(),
    })
}
