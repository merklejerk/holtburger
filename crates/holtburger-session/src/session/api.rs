use super::types::{MockTransport, Session};
use anyhow::Result;
use socket2::SockRef;
use std::collections::{BTreeMap, HashMap, VecDeque};

const UDP_RECV_BUFFER_SIZE_BYTES: usize = 2 * 1024 * 1024;

impl Session {
    pub async fn new(server_addr: std::net::SocketAddr) -> Result<Self> {
        let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await?;
        if let Err(err) = SockRef::from(&socket).set_recv_buffer_size(UDP_RECV_BUFFER_SIZE_BYTES) {
            log::warn!(
                "failed to set UDP receive buffer size to {} bytes: {}",
                UDP_RECV_BUFFER_SIZE_BYTES,
                err
            );
        }
        Ok(Self::with_transport(server_addr, Box::new(socket), 0))
    }

    /// Recovery facts come from the same accepted span used by control scheduling.
    pub fn reliability(&self) -> super::TransportReliability {
        super::TransportReliability {
            received: self.received_packets,
            sent: self.sent_packets,
            receive_gap: !self.receive_progress().missing.is_empty(),
        }
    }

    pub fn set_capture(&mut self, path: &str) -> Result<()> {
        self.capture = Some(crate::capture::CaptureWriter::create(path)?);
        Ok(())
    }

    pub fn new_test() -> Self {
        Self::with_transport(
            "127.0.0.1:9000".parse().unwrap(),
            Box::new(MockTransport),
            1,
        )
    }

    fn with_transport(
        server_addr: std::net::SocketAddr,
        transport: Box<dyn super::Transport>,
        packet_sequence: u32,
    ) -> Self {
        Self {
            transport,
            server_addr,
            server_source_addr: server_addr,
            pending_server_source_addr: None,
            isaac_c2s: None,
            isaac_s2c: None,
            packet_sequence,
            fragment_sequence: 1,
            fragment_id: 1,
            connection_cookie: 0,
            client_id: 0,
            last_server_seq: 1,
            has_server_seq: false,
            fragment_reassembler: HashMap::new(),
            pending_server_packets: BTreeMap::new(),
            rejected_server_sequences: Default::default(),
            pending_packets: VecDeque::new(),
            last_control_scheduled: None,
            last_sent_client_sequence: 0,
            pending_transport_events: VecDeque::new(),
            cached_packets: BTreeMap::new(),
            capture: None,
            game_action_sequence: 0,
            received_packets: Default::default(),
            sent_packets: Default::default(),
            bytes_in: 0,
            bytes_out: 0,
            last_recv_time: std::time::Instant::now(),
            last_send_time: std::time::Instant::now(),
        }
    }
}
