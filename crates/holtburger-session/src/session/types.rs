use crate::capture::CaptureWriter;
use anyhow::{Result, anyhow};
pub use async_trait::async_trait;
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::messages::*;
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;

pub(crate) const MAX_CACHED_PACKETS: usize = 512;
/// Bound retained originals plus repair/control work even if the socket remains unwritable.
pub(crate) const MAX_PENDING_PACKETS: usize = MAX_CACHED_PACKETS * 2;
pub(crate) const MAX_RETRANSMIT_SEQUENCE_IDS: usize = 115;
pub(crate) const MAX_RETRANSMIT_SEQUENCE_WINDOW: u32 = 256;
/// Retail EnqueueNaks (acclient.c:355428) uses a strict greater-than comparison.
pub(crate) const REQUEST_RETRANSMIT_INTERVAL: Duration = Duration::from_millis(600);
/// Retail EnqueuePak (acclient.c:355386) shares the NAK clock and uses >= 2 seconds.
pub(crate) const ACK_INTERVAL: Duration = Duration::from_secs(2);
/// Tokio's timer wheel has millisecond granularity; avoid a strict-boundary busy wake.
pub(crate) const CONTROL_TIMER_TICK: Duration = Duration::from_millis(1);
/// Retail GetNaks (acclient.c:360346) serializes at most 114 of its 115 buffer slots.
pub(crate) const MAX_OUTGOING_SEQUENCE_IDS: usize = 114;
/// Bound each socket pass, including rejected datagrams, independently of core's dispatch budget.
pub(crate) const RECEIVE_BATCH_LIMIT: usize = 64;
/// Read-ahead shares the existing recovery window; full ready buffers are delivered before reading.
pub(crate) const MAX_BUFFERED_PACKETS: usize = MAX_RETRANSMIT_SEQUENCE_WINDOW as usize;
pub(crate) const DEFAULT_LOGIN_PROTOCOL_VERSION: &str = "1802";

#[async_trait]
/// Cancellation-safe datagram I/O: Pending commits no packet and registers readiness wakeups.
pub trait Transport: Send + Sync {
    async fn send_to(&self, buf: &[u8], addr: SocketAddr) -> Result<usize>;
    async fn recv_from(&self, buf: &mut [u8]) -> Result<(usize, SocketAddr)>;
}

#[async_trait]
impl Transport for UdpSocket {
    async fn send_to(&self, buf: &[u8], addr: SocketAddr) -> Result<usize> {
        self.send_to(buf, addr).await.map_err(|e| anyhow!(e))
    }

    async fn recv_from(&self, buf: &mut [u8]) -> Result<(usize, SocketAddr)> {
        self.recv_from(buf).await.map_err(|e| anyhow!(e))
    }
}

pub struct MockTransport;

#[async_trait]
impl Transport for MockTransport {
    async fn send_to(&self, buf: &[u8], _addr: SocketAddr) -> Result<usize> {
        Ok(buf.len())
    }

    async fn recv_from(&self, _buf: &mut [u8]) -> Result<(usize, SocketAddr)> {
        std::future::pending().await
    }
}

#[derive(Debug)]
pub struct PendingMessage {
    pub count: u16,
    pub fragments: Vec<Option<Vec<u8>>>,
    pub received_count: u16,
}

#[derive(Clone, Debug)]
pub(crate) struct CachedPacket {
    pub(crate) addr: SocketAddr,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) struct ReceivedPacket {
    pub(crate) header: PacketHeader,
    pub(crate) data: Vec<u8>,
}

#[derive(Clone, Debug)]
pub(crate) enum PendingPacketData {
    /// An original reliable datagram reserves one cache slot until successfully sent.
    Reliable(Vec<u8>),
    /// Handshake datagrams and repairs do not allocate another reliable identity or cache slot.
    Prebuilt(Vec<u8>),
    /// Disposable responses receive the current successfully sent control sequence at transmission.
    Cleartext {
        header: PacketHeader,
        payload: Vec<u8>,
    },
    /// Normal recovery intent is rebuilt from current reception facts before each write attempt.
    Normal(NormalControl),
}

/// A safe ACK boundary is frozen; NAK contents remain live until serialization.
#[derive(Clone, Copy, Debug)]
pub(crate) enum NormalControl {
    Ack(u32),
    Nak,
}

#[derive(Clone, Debug)]
pub(crate) struct PendingPacket {
    /// Destination belongs to the packet, including activation-port handshake responses.
    pub(crate) addr: SocketAddr,
    /// Internal monotonic deadline, never compared against core's traffic-age clock.
    pub(crate) ready_at: tokio::time::Instant,
    /// Owns retained bytes or deferred disposable intent across I/O cancellation.
    pub(crate) data: PendingPacketData,
}

/// Current accepted receive span, derived once for a scheduler/observation decision.
pub(crate) struct ReceiveProgress {
    /// Highest accepted sequence; an ACK is eligible only when the missing list is empty.
    pub(crate) highest: u32,
    /// Unreceived, non-rejected IDs in delivery order within the bounded receive window.
    pub(crate) missing: Vec<u32>,
}

#[derive(Debug)]
pub enum SessionEvent {
    Message(Vec<u8>),
    TimeSync(f64),
}

pub struct Session {
    pub(crate) transport: Box<dyn Transport>,
    pub server_addr: SocketAddr,
    pub(crate) server_source_addr: SocketAddr,
    pub(crate) pending_server_source_addr: Option<SocketAddr>,
    pub isaac_c2s: Option<Isaac>,
    pub isaac_s2c: Option<Isaac>,
    pub packet_sequence: u32,
    pub fragment_sequence: u32,
    pub(crate) fragment_id: u32,
    pub(crate) connection_cookie: u64,
    pub client_id: u16,
    pub last_server_seq: u32,
    pub has_server_seq: bool,
    pub fragment_reassembler: HashMap<u32, PendingMessage>,
    pub(crate) pending_server_packets: BTreeMap<u32, ReceivedPacket>,
    /// Server-confirmed unavailable packets; ordered receive skips only these missing stamps.
    pub(crate) rejected_server_sequences: BTreeSet<u32>,
    /// All writes survive receive/send-future cancellation; reliable originals retain FIFO order.
    pub(crate) pending_packets: VecDeque<PendingPacket>,
    /// Active connection's shared ACK/NAK scheduling clock; absent before connect setup.
    pub(crate) last_control_scheduled: Option<tokio::time::Instant>,
    /// Successfully transmitted original sequence, excluding queued originals and repairs.
    pub(crate) last_sent_client_sequence: u32,
    /// Handshake and unsequenced time notifications retained when ingress is serviced by a send.
    pub(crate) pending_transport_events: VecDeque<SessionEvent>,
    pub(crate) cached_packets: BTreeMap<u32, CachedPacket>,
    pub capture: Option<CaptureWriter>,
    pub game_action_sequence: u32,
    /// Accepted incoming sequenced traffic used by shared connection observations.
    pub(crate) received_packets: super::PacketDeliveryCounters,
    /// Successfully sent sequenced traffic used by shared connection observations.
    pub(crate) sent_packets: super::PacketDeliveryCounters,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub last_recv_time: Instant,
    pub last_send_time: Instant,
}
