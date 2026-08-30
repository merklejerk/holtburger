//! Versioned, bounded MessagePack protocol for the Electron sidecar.

use std::io;
use std::sync::{Arc, mpsc};
use std::thread;

use anyhow::Context;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::client_runtime::{CLIENT_COMMAND_NAMES, ClientHostCommand, dispatch_client};
use crate::explorer_entity_delivery::ExplorerFixedTickEnvelope;
use crate::explorer_entity_runtime::PossessionEventOutcome;
use crate::explorer_host::{EXPLORER_COMMAND_NAMES, ExplorerHostCommand, dispatch_explorer};
use crate::host_event_sink::{ClientEventSink, ExplorerEventSink};
use crate::host_physical_fly_runtime::{PhysicalFlyFailure, PhysicalFlyMotionPath};
use crate::runtime::{HostMode, HostRuntime};
use crate::shared_host_content::{
    SHARED_CONTENT_COMMAND_NAMES, SharedContentCommand, dispatch_shared_content,
};

/// Current sidecar protocol version.
pub const PROTOCOL_VERSION: u16 = 1;
/// Maximum encoded MessagePack payload, excluding the four-byte length prefix.
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
/// Bounded writer queue. Producers block at capacity; no event is silently discarded.
pub const WRITER_QUEUE_CAPACITY: usize = 256;

/// A closed command set composed from the shared, Explorer, and client inventories.
#[derive(Debug, Clone)]
pub enum HostCommand {
    Shared(SharedContentCommand),
    Explorer(ExplorerHostCommand),
    Client(ClientHostCommand),
}

impl HostCommand {
    /// Returns the mode required by a command. `None` denotes shared content/status capability.
    pub fn required_mode(&self) -> Option<HostMode> {
        match self {
            Self::Shared(_) => None,
            Self::Explorer(_) => Some(HostMode::Explorer),
            Self::Client(_) => Some(HostMode::Client),
        }
    }
}

impl<'de> Deserialize<'de> for HostCommand {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error as _;

        let value = Value::deserialize(deserializer)?;
        let command = value
            .get("command")
            .and_then(Value::as_str)
            .ok_or_else(|| D::Error::custom("host command is missing its string command field"))?;
        if SHARED_CONTENT_COMMAND_NAMES.contains(&command) {
            return serde_json::from_value(value)
                .map(HostCommand::Shared)
                .map_err(D::Error::custom);
        }
        if EXPLORER_COMMAND_NAMES.contains(&command) {
            return serde_json::from_value(value)
                .map(HostCommand::Explorer)
                .map_err(D::Error::custom);
        }
        if CLIENT_COMMAND_NAMES.contains(&command) {
            return serde_json::from_value(value)
                .map(HostCommand::Client)
                .map_err(D::Error::custom);
        }
        Err(D::Error::custom(format!(
            "unknown host command {command:?}"
        )))
    }
}

/// Events emitted by host-owned simulation and command publication.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "payload", rename_all = "kebab-case")]
pub enum HostEvent {
    ExplorerDynamicEntity(holtburger_core::DynamicEntityEvent),
    ClientCurrentState(crate::client_projection::ClientCurrentState),
    ClientLifecycleChanged(crate::client_projection::ClientLifecycleWire),
    ClientCharacterMotionCapabilitiesUpdated(
        Option<crate::client_projection::ClientCharacterMotionCapabilitiesWire>,
    ),
    ClientCharacterMotionFeedback(crate::client_projection::ClientCharacterMotionFeedbackWire),
    ClientLocalPlayerEstablished {
        #[serde(rename = "playerGuid")]
        player_guid: holtburger_common::Guid,
    },
    ClientServerTimeUpdated {
        time: f64,
    },
    ClientWorldNameUpdated {
        name: String,
    },
    ClientPlayerEntered {
        #[serde(rename = "playerGuid")]
        player_guid: holtburger_common::Guid,
        name: String,
    },
    ClientPlayerVitalsUpdated {
        vitals: Vec<crate::client_projection::ClientVitalWire>,
    },
    ClientChatMessage(crate::client_projection::ClientChatMessageWire),
    ClientDynamicEntity(holtburger_core::DynamicEntityEvent),
    ClientCamera(holtburger_core::ClientCameraTick),
    ClientCameraStarted(holtburger_core::ClientCameraStartReceipt),
    ClientPresentationDiscontinuity(crate::client_projection::ClientPresentationDiscontinuity),
    ClientExitRequested(crate::client_projection::ClientExitRequested),
    ExplorerFixedTick(ExplorerFixedTickEnvelope),
    ExplorerPossessionEventOutcomes(Vec<PossessionEventOutcome>),
    ExplorerPhysicalFlyMotion(PhysicalFlyMotionPath),
    ExplorerPhysicalFlyFailure(PhysicalFlyFailure),
}

/// Successful command payload. Binary responses use MessagePack's native bin type.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum HostResponse {
    Unit,
    Json(Value),
    Binary(#[serde(with = "serde_bytes")] Vec<u8>),
}

/// Structured application/protocol failure returned without flattening to a shell string.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolError {
    pub code: String,
    pub message: String,
}

/// One framed wire message.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProtocolFrame {
    Handshake {
        protocol_version: u16,
        host_name: String,
        host_version: String,
        host_mode: HostMode,
    },
    Response {
        id: u64,
        result: Result<HostResponse, ProtocolError>,
    },
    Event {
        event: HostEvent,
    },
    ShutdownAck {
        id: u64,
    },
    Rejected {
        error: ProtocolError,
    },
}

/// Frames accepted from Electron. Outbound-only payloads are intentionally not deserializable.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InboundFrame {
    HandshakeAck { protocol_version: u16 },
    Request { id: u64, command: HostCommand },
    Shutdown { id: u64 },
}

/// Errors raised while framing or decoding a protocol payload.
#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    #[error("protocol input ended before a complete frame")]
    UnexpectedEof,
    #[error(
        "protocol frame announced {announced} bytes, exceeding the {MAX_FRAME_BYTES}-byte limit"
    )]
    Oversize { announced: usize },
    #[error("protocol frame length does not fit in memory: {0}")]
    Length(#[from] std::num::TryFromIntError),
    #[error("protocol MessagePack encoding failed: {0}")]
    Encode(#[from] rmp_serde::encode::Error),
    #[error("protocol MessagePack decoding failed: {0}")]
    Decode(#[from] rmp_serde::decode::Error),
    #[error("protocol I/O failed: {0}")]
    Io(#[from] io::Error),
}

/// Encodes one frame with a little-endian u32 length prefix.
pub fn encode_frame(frame: &ProtocolFrame) -> Result<Vec<u8>, FrameError> {
    let payload = rmp_serde::to_vec_named(frame)?;
    validate_payload_length(payload.len())?;
    let length = u32::try_from(payload.len())?;
    let mut framed = Vec::with_capacity(4 + payload.len());
    framed.extend(length.to_le_bytes());
    framed.extend(payload);
    Ok(framed)
}

/// Writes one complete frame to a synchronous stream.
pub fn write_frame<W: io::Write>(writer: &mut W, frame: &ProtocolFrame) -> Result<(), FrameError> {
    writer.write_all(&encode_frame(frame)?)?;
    writer.flush()?;
    Ok(())
}

/// Reads one complete frame from a synchronous stream.
pub fn read_frame<R: io::Read>(reader: &mut R) -> Result<Option<InboundFrame>, FrameError> {
    let mut length_bytes = [0_u8; 4];
    match reader.read(&mut length_bytes[..1])? {
        0 => return Ok(None),
        1 => {}
        _ => unreachable!("a one-byte read cannot return more than one byte"),
    }
    reader.read_exact(&mut length_bytes[1..])?;
    let length = usize::try_from(u32::from_le_bytes(length_bytes))?;
    validate_payload_length(length)?;
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(rmp_serde::from_slice(&payload)?))
}

/// Reads one complete frame from an asynchronous stream.
pub async fn read_frame_async<R: AsyncRead + Unpin>(
    reader: &mut R,
) -> Result<Option<InboundFrame>, FrameError> {
    let mut length_bytes = [0_u8; 4];
    match reader.read(&mut length_bytes[..1]).await? {
        0 => return Ok(None),
        1 => {}
        _ => unreachable!("a one-byte read cannot return more than one byte"),
    }
    reader.read_exact(&mut length_bytes[1..]).await?;
    let length = usize::try_from(u32::from_le_bytes(length_bytes))?;
    validate_payload_length(length)?;
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload).await?;
    Ok(Some(rmp_serde::from_slice(&payload)?))
}

/// Writes one complete frame to an asynchronous stream.
pub async fn write_frame_async<W: AsyncWrite + Unpin>(
    writer: &mut W,
    frame: &ProtocolFrame,
) -> Result<(), FrameError> {
    writer.write_all(&encode_frame(frame)?).await?;
    writer.flush().await?;
    Ok(())
}

fn validate_payload_length(length: usize) -> Result<(), FrameError> {
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::Oversize { announced: length });
    }
    Ok(())
}

pub(crate) fn application_error(error: impl std::fmt::Display) -> ProtocolError {
    ProtocolError {
        code: "application_error".to_string(),
        message: error.to_string(),
    }
}

pub(crate) fn encode_json<T: Serialize>(value: T) -> Result<HostResponse, ProtocolError> {
    serde_json::to_value(value)
        .map(HostResponse::Json)
        .map_err(application_error)
}

/// Dispatches one typed command against the selected host composition.
pub async fn dispatch(
    runtime: &HostRuntime,
    command: HostCommand,
) -> Result<HostResponse, ProtocolError> {
    match command {
        HostCommand::Shared(command) => dispatch_shared_content(runtime, command).await,
        HostCommand::Explorer(command) => {
            if runtime.mode() != HostMode::Explorer {
                return Err(mode_command_error(runtime.mode(), HostMode::Explorer));
            }
            dispatch_explorer(runtime.explorer().map_err(application_error)?, command).await
        }
        HostCommand::Client(command) => {
            if runtime.mode() != HostMode::Client {
                return Err(mode_command_error(runtime.mode(), HostMode::Client));
            }
            dispatch_client(runtime.client().map_err(application_error)?, command).await
        }
    }
}

fn mode_command_error(actual: HostMode, required: HostMode) -> ProtocolError {
    ProtocolError {
        code: "mode_command_unavailable".to_string(),
        message: format!(
            "command is unavailable in {} mode; it requires {} mode",
            actual.as_str(),
            required.as_str(),
        ),
    }
}

/// MessagePack event sink used by the stdio process.
pub struct StdioEventSink {
    sender: mpsc::SyncSender<ProtocolFrame>,
}

impl StdioEventSink {
    /// Creates a bounded sink that blocks producers when Electron is not draining output.
    pub fn new(sender: mpsc::SyncSender<ProtocolFrame>) -> Self {
        Self { sender }
    }

    fn send(&self, event: HostEvent) -> anyhow::Result<()> {
        self.sender
            .send(ProtocolFrame::Event { event })
            .context("sidecar writer stopped while publishing host event")
    }
}

impl ClientEventSink for StdioEventSink {
    fn publish_client_event(
        &self,
        event: crate::client_projection::ClientHostEvent,
    ) -> anyhow::Result<()> {
        let event = match event {
            crate::client_projection::ClientHostEvent::CurrentState(state) => {
                HostEvent::ClientCurrentState(state)
            }
            crate::client_projection::ClientHostEvent::LifecycleChanged(lifecycle) => {
                HostEvent::ClientLifecycleChanged(lifecycle)
            }
            crate::client_projection::ClientHostEvent::CharacterMotionCapabilitiesUpdated(
                capabilities,
            ) => HostEvent::ClientCharacterMotionCapabilitiesUpdated(capabilities),
            crate::client_projection::ClientHostEvent::CharacterMotionFeedback(feedback) => {
                HostEvent::ClientCharacterMotionFeedback(feedback)
            }
            crate::client_projection::ClientHostEvent::LocalPlayerEstablished { player_guid } => {
                HostEvent::ClientLocalPlayerEstablished { player_guid }
            }
            crate::client_projection::ClientHostEvent::ServerTimeUpdated { time } => {
                HostEvent::ClientServerTimeUpdated { time }
            }
            crate::client_projection::ClientHostEvent::WorldNameUpdated { name } => {
                HostEvent::ClientWorldNameUpdated { name }
            }
            crate::client_projection::ClientHostEvent::PlayerEntered { player_guid, name } => {
                HostEvent::ClientPlayerEntered { player_guid, name }
            }
            crate::client_projection::ClientHostEvent::PlayerVitalsUpdated { vitals } => {
                HostEvent::ClientPlayerVitalsUpdated { vitals }
            }
            crate::client_projection::ClientHostEvent::ChatMessage(message) => {
                HostEvent::ClientChatMessage(message)
            }
            crate::client_projection::ClientHostEvent::DynamicEntity(event) => {
                HostEvent::ClientDynamicEntity(event)
            }
            crate::client_projection::ClientHostEvent::Camera(tick) => {
                HostEvent::ClientCamera(tick)
            }
            crate::client_projection::ClientHostEvent::CameraStarted(receipt) => {
                HostEvent::ClientCameraStarted(receipt)
            }
            crate::client_projection::ClientHostEvent::PresentationDiscontinuity(discontinuity) => {
                HostEvent::ClientPresentationDiscontinuity(discontinuity)
            }
            crate::client_projection::ClientHostEvent::ExitRequested(exit) => {
                HostEvent::ClientExitRequested(exit)
            }
        };
        self.send(event)
    }
}

impl ExplorerEventSink for StdioEventSink {
    fn publish_dynamic_entity(
        &self,
        event: holtburger_core::DynamicEntityEvent,
    ) -> anyhow::Result<()> {
        self.send(HostEvent::ExplorerDynamicEntity(event))
    }

    fn publish_fixed_tick(&self, envelope: ExplorerFixedTickEnvelope) -> anyhow::Result<()> {
        self.send(HostEvent::ExplorerFixedTick(envelope))
    }

    fn publish_possession_outcomes(
        &self,
        outcomes: Vec<PossessionEventOutcome>,
    ) -> anyhow::Result<()> {
        self.send(HostEvent::ExplorerPossessionEventOutcomes(outcomes))
    }

    fn publish_physical_fly_motion(&self, path: PhysicalFlyMotionPath) -> anyhow::Result<()> {
        self.send(HostEvent::ExplorerPhysicalFlyMotion(path))
    }

    fn publish_physical_fly_failure(&self, failure: PhysicalFlyFailure) -> anyhow::Result<()> {
        self.send(HostEvent::ExplorerPhysicalFlyFailure(failure))
    }
}

/// Runs the framed sidecar protocol over stdin/stdout.
pub async fn run_stdio(mode: HostMode) -> anyhow::Result<()> {
    let (sender, receiver) = mpsc::sync_channel(WRITER_QUEUE_CAPACITY);
    let writer_thread = thread::spawn(move || -> anyhow::Result<()> {
        let stdout = io::stdout();
        let mut stdout = io::BufWriter::new(stdout.lock());
        for frame in receiver {
            write_frame(&mut stdout, &frame).context("sidecar stdout writer failed")?;
        }
        Ok(())
    });
    let event_sink = Arc::new(StdioEventSink::new(sender.clone()));
    let runtime = Arc::new(HostRuntime::discover(
        mode,
        Arc::clone(&event_sink) as Arc<dyn ClientEventSink>,
        event_sink as Arc<dyn ExplorerEventSink>,
    )?);
    sender
        .send(ProtocolFrame::Handshake {
            protocol_version: PROTOCOL_VERSION,
            host_name: "holtburger-3d-host".to_string(),
            host_version: env!("CARGO_PKG_VERSION").to_string(),
            host_mode: mode,
        })
        .context("sidecar writer stopped before handshake")?;

    let mut stdin = tokio::io::stdin();
    let Some(first) = read_frame_async(&mut stdin).await? else {
        drop(runtime);
        drop(sender);
        writer_thread
            .join()
            .map_err(|_| anyhow::anyhow!("sidecar writer thread panicked"))??;
        return Ok(());
    };
    match first {
        InboundFrame::HandshakeAck { protocol_version } if protocol_version == PROTOCOL_VERSION => {
        }
        InboundFrame::HandshakeAck { protocol_version } => {
            sender
                .send(ProtocolFrame::Rejected {
                    error: ProtocolError {
                        code: "incompatible_protocol".to_string(),
                        message: format!(
                            "host protocol {PROTOCOL_VERSION} cannot communicate with {protocol_version}"
                        ),
                    },
                })
                .ok();
            drop(sender);
            drop(runtime);
            writer_thread
                .join()
                .map_err(|_| anyhow::anyhow!("sidecar writer thread panicked"))??;
            return Ok(());
        }
        _ => {
            sender
                .send(ProtocolFrame::Rejected {
                    error: ProtocolError {
                        code: "handshake_required".to_string(),
                        message: "the first frame must acknowledge the host handshake".to_string(),
                    },
                })
                .ok();
            drop(sender);
            drop(runtime);
            writer_thread
                .join()
                .map_err(|_| anyhow::anyhow!("sidecar writer thread panicked"))??;
            return Ok(());
        }
    }

    let mut pending = tokio::task::JoinSet::new();
    let shutdown_id = loop {
        let Some(frame) = read_frame_async(&mut stdin).await? else {
            break None;
        };
        match frame {
            InboundFrame::Request { id, command } => {
                let runtime = Arc::clone(&runtime);
                let sender = sender.clone();
                pending.spawn(async move {
                    let result = dispatch(&runtime, command).await;
                    sender
                        .send(ProtocolFrame::Response { id, result })
                        .context("sidecar writer stopped while publishing response")
                });
            }
            InboundFrame::Shutdown { id } => {
                break Some(id);
            }
            other => {
                sender
                    .send(ProtocolFrame::Rejected {
                        error: ProtocolError {
                            code: "unexpected_frame".to_string(),
                            message: format!("frame {other:?} is not valid after handshake"),
                        },
                    })
                    .context("sidecar writer stopped while rejecting frame")?;
            }
        }
        // Completed joins are consumed continuously so a long-lived host retains only active work.
        while let Some(result) = pending.try_join_next() {
            result??;
        }
    };
    while let Some(result) = pending.join_next().await {
        result??;
    }
    if let Some(id) = shutdown_id {
        sender
            .send(ProtocolFrame::ShutdownAck { id })
            .context("sidecar writer stopped while acknowledging shutdown")?;
    }
    runtime.shutdown().await;
    drop(runtime);
    drop(sender);
    writer_thread
        .join()
        .map_err(|_| anyhow::anyhow!("sidecar writer thread panicked"))??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host_mode::ClientLaunchConfiguration;
    use std::io::Cursor;

    #[test]
    fn fragmented_and_coalesced_frames_round_trip() {
        let first_payload = rmp_serde::to_vec_named(&serde_json::json!({
            "kind": "handshake_ack",
            "protocol_version": PROTOCOL_VERSION,
        }))
        .unwrap();
        let second_payload = rmp_serde::to_vec_named(&serde_json::json!({
            "kind": "shutdown",
            "id": 7,
        }))
        .unwrap();
        let first = framed_payload(first_payload);
        let second = framed_payload(second_payload);
        let mut bytes = first.clone();
        bytes.extend(second);
        let mut reader = Cursor::new(bytes);
        assert!(matches!(
            read_frame(&mut reader).unwrap(),
            Some(InboundFrame::HandshakeAck { .. })
        ));
        assert!(matches!(
            read_frame(&mut reader).unwrap(),
            Some(InboundFrame::Shutdown { id: 7 })
        ));
    }

    #[test]
    fn binary_response_uses_messagepack_bin_without_json_number_expansion() {
        let encoded = encode_frame(&ProtocolFrame::Response {
            id: 7,
            result: Ok(HostResponse::Binary(vec![0, 1, 255, 254])),
        })
        .unwrap();
        #[derive(Deserialize)]
        #[serde(tag = "kind", rename_all = "snake_case")]
        enum DecodedFrame {
            Response {
                id: u64,
                result: Result<DecodedResponse, ProtocolError>,
            },
        }
        #[derive(Deserialize)]
        #[serde(tag = "kind", content = "value", rename_all = "snake_case")]
        enum DecodedResponse {
            Binary(#[serde(with = "serde_bytes")] Vec<u8>),
        }
        let decoded: DecodedFrame = rmp_serde::from_slice(&encoded[4..]).unwrap();
        assert!(matches!(
            decoded,
            DecodedFrame::Response {
                id: 7,
                result: Ok(DecodedResponse::Binary(payload))
            } if payload == vec![0, 1, 255, 254]
        ));
    }

    #[test]
    fn event_content_has_exactly_one_payload_layer() {
        let encoded = encode_frame(&ProtocolFrame::Event {
            event: HostEvent::ExplorerPhysicalFlyFailure(PhysicalFlyFailure {
                session: 7,
                message: "stopped".to_string(),
            }),
        })
        .unwrap();
        let decoded: Value = rmp_serde::from_slice(&encoded[4..]).unwrap();
        assert_eq!(
            decoded,
            serde_json::json!({
                "kind": "event",
                "event": {
                    "event": "explorer-physical-fly-failure",
                    "payload": {
                        "session": 7,
                        "message": "stopped",
                    },
                },
            })
        );
    }

    #[test]
    fn encoded_local_player_event_retains_authority_identity() {
        let encoded = encode_frame(&ProtocolFrame::Event {
            event: HostEvent::ClientLocalPlayerEstablished {
                player_guid: holtburger_common::Guid(0x5000_0008),
            },
        })
        .unwrap();
        let decoded: Value = rmp_serde::from_slice(&encoded[4..]).unwrap();
        assert_eq!(
            decoded,
            serde_json::json!({
                "kind": "event",
                "event": {
                    "event": "client-local-player-established",
                    "payload": {
                        "playerGuid": 0x5000_0008u64,
                    },
                },
            })
        );
    }

    #[test]
    fn exact_frame_limit_is_accepted_and_one_byte_over_is_rejected() {
        assert!(validate_payload_length(MAX_FRAME_BYTES).is_ok());
        assert!(matches!(
            validate_payload_length(MAX_FRAME_BYTES + 1),
            Err(FrameError::Oversize { announced }) if announced == MAX_FRAME_BYTES + 1
        ));
    }

    #[test]
    fn command_inventory_declares_shared_and_mode_specific_capabilities() {
        assert_eq!(
            HostCommand::Shared(SharedContentCommand::HostStatus).required_mode(),
            None,
            "status is available through both mode roots"
        );
        assert_eq!(
            HostCommand::Shared(SharedContentCommand::LoadSkySource).required_mode(),
            None,
            "static content is available through both mode roots"
        );
        assert_eq!(
            HostCommand::Explorer(ExplorerHostCommand::ExplorerCatalogCapability).required_mode(),
            Some(HostMode::Explorer)
        );
        assert_eq!(
            HostCommand::Client(ClientHostCommand::StartClient {
                startup: ClientLaunchConfiguration {
                    host: "127.0.0.1".to_string(),
                    port: 9000,
                    account: "test".to_string(),
                    password: "secret".to_string(),
                },
            })
            .required_mode(),
            Some(HostMode::Client)
        );
        assert_eq!(
            HostCommand::Client(ClientHostCommand::RequestClientCurrentState).required_mode(),
            Some(HostMode::Client)
        );
        assert_eq!(
            HostCommand::Client(ClientHostCommand::SelectClientCharacter {
                guid: holtburger_common::Guid(7),
            })
            .required_mode(),
            Some(HostMode::Client)
        );
        assert_eq!(
            HostCommand::Client(ClientHostCommand::DisconnectClient).required_mode(),
            Some(HostMode::Client)
        );
    }

    #[test]
    fn messagepack_requests_decode_into_their_mode_owned_inventory() {
        let request = rmp_serde::to_vec_named(&serde_json::json!({
            "kind": "request",
            "id": 1,
            "command": { "command": "request_client_current_state" },
        }))
        .unwrap();
        let mut reader = Cursor::new(framed_payload(request));
        let Some(InboundFrame::Request {
            command: HostCommand::Client(ClientHostCommand::RequestClientCurrentState),
            ..
        }) = read_frame(&mut reader).unwrap()
        else {
            panic!("client request did not decode into the client inventory");
        };

        let reveal = rmp_serde::to_vec_named(&serde_json::json!({
            "kind": "request",
            "id": 2,
            "command": {
                "command": "acknowledge_client_world_reveal",
                "worldGeneration": 7,
            },
        }))
        .unwrap();
        let mut reader = Cursor::new(framed_payload(reveal));
        let Some(InboundFrame::Request {
            command:
                HostCommand::Client(ClientHostCommand::AcknowledgeClientWorldReveal {
                    world_generation: 7,
                }),
            ..
        }) = read_frame(&mut reader).unwrap()
        else {
            panic!("client reveal acknowledgement did not preserve its world generation");
        };

        let chat = rmp_serde::to_vec_named(&serde_json::json!({
            "kind": "request",
            "id": 3,
            "command": {
                "command": "send_client_chat",
                "message": "Hello world",
            },
        }))
        .unwrap();
        let mut reader = Cursor::new(framed_payload(chat));
        let Some(InboundFrame::Request {
            command: HostCommand::Client(ClientHostCommand::SendClientChat { message }),
            ..
        }) = read_frame(&mut reader).unwrap()
        else {
            panic!("client chat did not decode into the client inventory");
        };
        assert_eq!(message, "Hello world");
    }

    #[test]
    fn unknown_command_diagnostic_names_the_command() {
        let request = rmp_serde::to_vec_named(&serde_json::json!({
            "kind": "request",
            "id": 1,
            "command": { "command": "future_command" },
        }))
        .unwrap();
        let mut reader = Cursor::new(framed_payload(request));
        let error = read_frame(&mut reader).expect_err("unknown commands must be rejected");
        assert!(
            error
                .to_string()
                .contains("unknown host command \"future_command\"")
        );
    }

    #[test]
    fn malformed_and_truncated_input_fails_loudly() {
        let mut truncated = Cursor::new(vec![4, 0, 0]);
        assert!(matches!(read_frame(&mut truncated), Err(FrameError::Io(_))));
        let mut malformed = Cursor::new(vec![1, 0, 0, 0, 0xc1]);
        assert!(matches!(
            read_frame(&mut malformed),
            Err(FrameError::Decode(_))
        ));
    }

    fn framed_payload(payload: Vec<u8>) -> Vec<u8> {
        let mut framed = Vec::with_capacity(4 + payload.len());
        framed.extend(u32::try_from(payload.len()).unwrap().to_le_bytes());
        framed.extend(payload);
        framed
    }
}
