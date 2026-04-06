use super::types::{MockTransport, Session};
use anyhow::Result;
use std::collections::{BTreeMap, HashMap};

impl Session {
    pub async fn new(server_addr: std::net::SocketAddr) -> Result<Self> {
        let socket = tokio::net::UdpSocket::bind("0.0.0.0:0").await?;
        Ok(Self {
            transport: Box::new(socket),
            server_addr,
            isaac_c2s: None,
            isaac_s2c: None,
            packet_sequence: 0,
            fragment_sequence: 1,
            fragment_id: 1,
            connection_cookie: 0,
            client_id: 0,
            last_server_seq: 1,
            has_server_seq: false,
            fragment_reassembler: HashMap::new(),
            pending_server_packets: BTreeMap::new(),
            pending_handshake_response: None,
            last_request_retransmit_time: None,
            cached_packets: BTreeMap::new(),
            capture: None,
            game_action_sequence: 0,
            bytes_in: 0,
            bytes_out: 0,
            last_recv_time: std::time::Instant::now(),
            last_send_time: std::time::Instant::now(),
        })
    }

    pub fn set_capture(&mut self, path: &str) -> Result<()> {
        self.capture = Some(crate::capture::CaptureWriter::create(path)?);
        Ok(())
    }

    pub fn new_test() -> Self {
        Self {
            transport: Box::new(MockTransport),
            server_addr: "127.0.0.1:9000".parse().unwrap(),
            isaac_c2s: None,
            isaac_s2c: None,
            packet_sequence: 1,
            fragment_sequence: 1,
            fragment_id: 1,
            connection_cookie: 0,
            client_id: 0,
            last_server_seq: 1,
            has_server_seq: false,
            fragment_reassembler: HashMap::new(),
            pending_server_packets: BTreeMap::new(),
            pending_handshake_response: None,
            last_request_retransmit_time: None,
            cached_packets: BTreeMap::new(),
            capture: None,
            game_action_sequence: 0,
            bytes_in: 0,
            bytes_out: 0,
            last_recv_time: std::time::Instant::now(),
            last_send_time: std::time::Instant::now(),
        }
    }
}
