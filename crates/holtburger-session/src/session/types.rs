use crate::capture::CaptureWriter;
use anyhow::{Result, anyhow};
pub use async_trait::async_trait;
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::messages::*;
use std::collections::{BTreeMap, HashMap};
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::net::UdpSocket;

pub(crate) const MAX_CACHED_PACKETS: usize = 512;
pub(crate) const MAX_RETRANSMIT_SEQUENCE_IDS: usize = 115;
pub(crate) const MAX_RETRANSMIT_SEQUENCE_WINDOW: u32 = 256;
pub(crate) const REQUEST_RETRANSMIT_INTERVAL: Duration = Duration::from_secs(1);
pub(crate) const DEFAULT_LOGIN_PROTOCOL_VERSION: &str = "1802";

#[async_trait]
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
    async fn send_to(&self, _buf: &[u8], _addr: SocketAddr) -> Result<usize> {
        Ok(0)
    }

    async fn recv_from(&self, _buf: &mut [u8]) -> Result<(usize, SocketAddr)> {
        Err(anyhow!("Mock transport"))
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
pub(crate) enum PendingControlPacketData {
    Prebuilt(Vec<u8>),
    DeferredCleartext {
        header: PacketHeader,
        payload: Vec<u8>,
        use_current_sequence: bool,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct PendingControlPacket {
    pub(crate) addr: SocketAddr,
    pub(crate) ready_at: Instant,
    pub(crate) data: PendingControlPacketData,
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
    pub(crate) pending_control_packets: Vec<PendingControlPacket>,
    pub(crate) last_request_retransmit_time: Option<Instant>,
    pub(crate) cached_packets: BTreeMap<u32, CachedPacket>,
    pub capture: Option<CaptureWriter>,
    pub game_action_sequence: u32,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub last_recv_time: Instant,
    pub last_send_time: Instant,
}
