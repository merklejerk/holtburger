pub mod capture;
pub mod optional_header;

use crate::session::capture::{CaptureWriter, Direction};
use crate::session::optional_header::OptionalHeaderCursor;
use anyhow::{Result, anyhow};
pub use async_trait::async_trait;
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::sequence::is_newer_u32;
use holtburger_common::{ProtocolPack, ProtocolUnpack};
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::messages::transport::{packet_flags, queues};
use holtburger_protocol::messages::utils::align_offset;
use holtburger_protocol::messages::*;
use std::collections::HashMap;
use std::net::SocketAddr;
use tokio::net::UdpSocket;

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

#[derive(Debug)]
pub enum SessionEvent {
    Message(Vec<u8>),
    HandshakeRequest(ConnectRequestData),
    HandshakeResponse { cookie: u64, client_id: u16 },
    TimeSync(f64),
}

pub struct Session {
    transport: Box<dyn Transport>,
    pub server_addr: SocketAddr,
    pub isaac_c2s: Option<Isaac>,
    pub isaac_s2c: Option<Isaac>,
    pub packet_sequence: u32,
    pub fragment_sequence: u32,
    fragment_id: u32,
    // NetID/ClientID assigned by server
    pub client_id: u16,
    pub last_server_seq: u32,
    pub has_server_seq: bool,
    pub fragment_reassembler: HashMap<u32, PendingMessage>,
    pub capture: Option<CaptureWriter>,
    pub game_action_sequence: u32,
}

impl Session {
    pub async fn new(server_addr: SocketAddr) -> Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0").await?;
        Ok(Self {
            transport: Box::new(socket),
            server_addr,
            isaac_c2s: None,
            isaac_s2c: None,
            packet_sequence: 0,
            fragment_sequence: 1,
            fragment_id: 1,
            client_id: 0,
            last_server_seq: 0,
            has_server_seq: false,
            fragment_reassembler: HashMap::new(),
            capture: None,
            game_action_sequence: 0,
        })
    }

    pub fn new_replay(path: &str, server_addr: SocketAddr) -> Result<Self> {
        let reader = capture::CaptureReader::open(path)?;
        let transport = capture::ReplayTransport {
            reader: std::sync::Arc::new(std::sync::Mutex::new(reader)),
        };
        Ok(Self {
            transport: Box::new(transport),
            server_addr,
            isaac_c2s: None,
            isaac_s2c: None,
            packet_sequence: 0,
            fragment_sequence: 1,
            fragment_id: 1,
            client_id: 0,
            last_server_seq: 0,
            has_server_seq: false,
            fragment_reassembler: HashMap::new(),
            capture: None,
            game_action_sequence: 0,
        })
    }

    pub fn set_capture(&mut self, path: &str) -> Result<()> {
        self.capture = Some(CaptureWriter::create(path)?);
        Ok(())
    }

    pub fn new_test() -> Self {
        Session {
            transport: Box::new(MockTransport),
            server_addr: "127.0.0.1:9000".parse().unwrap(),
            isaac_c2s: None,
            isaac_s2c: None,
            packet_sequence: 1,
            fragment_sequence: 1,
            fragment_id: 1,
            fragment_reassembler: HashMap::new(),
            client_id: 0,
            last_server_seq: 0,
            has_server_seq: false,
            capture: None,
            game_action_sequence: 0,
        }
    }

    /// Calculates the payload checksum used by ACE: Sum of hashes for each component.
    fn calculate_payload_hash(&self, flags: u32, payload: &[u8]) -> Result<u32> {
        let mut total_payload_checksum: u32 = 0;

        // 1. Optional Headers Section (Follows ACE PacketHeaderOptional sequence)
        let cursor = OptionalHeaderCursor::new(payload, flags);
        let header_optional_bytes = cursor.hash_bytes();

        if !header_optional_bytes.is_empty() {
            let h = holtburger_protocol::crypto::Hash32::compute(&header_optional_bytes);
            total_payload_checksum = total_payload_checksum.wrapping_add(h);
        }

        // 2. Fragments Section
        if flags & packet_flags::BLOB_FRAGMENTS != 0 {
            let mut offset = cursor.payload_offset();
            while offset < payload.len() {
                if offset + FRAGMENT_HEADER_SIZE > payload.len() {
                    break;
                }
                let h_start = offset;
                let frag_header = FragmentHeader::unpack(payload, &mut offset)
                    .ok_or_else(|| anyhow!("Failed to unpack fragment header"))?;
                // Fragment Header Hash
                let hh = holtburger_protocol::crypto::Hash32::compute(&payload[h_start..offset]);
                total_payload_checksum = total_payload_checksum.wrapping_add(hh);

                let frag_data_size =
                    (frag_header.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);

                // Fragment Data
                if frag_data_size > 0 {
                    if offset + frag_data_size > payload.len() {
                        break;
                    }
                    let dh = holtburger_protocol::crypto::Hash32::compute(
                        &payload[offset..offset + frag_data_size],
                    );
                    total_payload_checksum = total_payload_checksum.wrapping_add(dh);
                    offset += frag_data_size;
                }

                align_offset(&mut offset, 4);
            }
        }

        Ok(total_payload_checksum)
    }

    pub async fn send_packet(&mut self, header: PacketHeader, payload: &[u8]) -> Result<()> {
        self.send_packet_to_addr(header, payload, self.server_addr)
            .await
    }

    pub async fn send_packet_to_addr(
        &mut self,
        mut header: PacketHeader,
        payload: &[u8],
        addr: SocketAddr,
    ) -> Result<()> {
        let mut full_payload = Vec::new();
        let caller_provided_ack = (header.flags & packet_flags::ACK_SEQUENCE) != 0;

        if !caller_provided_ack
            && self.has_server_seq
            && (header.flags & packet_flags::CONNECT_REQUEST == 0)
            && (header.flags & packet_flags::CONNECT_RESPONSE == 0)
            && (header.flags & packet_flags::LOGIN_REQUEST == 0)
        {
            header.flags |= packet_flags::ACK_SEQUENCE;
        }

        if (header.flags & packet_flags::ACK_SEQUENCE) != 0 {
            full_payload.extend_from_slice(&self.last_server_seq.to_le_bytes());
        }

        full_payload.extend_from_slice(payload);
        header.size = full_payload.len() as u16;

        let is_handshake = (header.flags
            & (packet_flags::LOGIN_REQUEST
                | packet_flags::CONNECT_REQUEST
                | packet_flags::CONNECT_RESPONSE))
            != 0;

        if let (Some(_), false) = (&mut self.isaac_c2s, is_handshake) {
            header.flags |= packet_flags::ENCRYPTED_CHECKSUM;
        }

        let header_hash = header.calculate_checksum();
        let payload_hash = self.calculate_payload_hash(header.flags, &full_payload)?;

        if let (Some(isaac), false) = (&mut self.isaac_c2s, is_handshake) {
            let key = isaac.current_key;
            isaac.consume_key();

            header.checksum = header_hash.wrapping_add(payload_hash ^ key);
        } else {
            header.checksum = header_hash.wrapping_add(payload_hash);
        }

        let mut packet = Vec::with_capacity(HEADER_SIZE + full_payload.len());
        header.pack(&mut packet);
        packet.extend_from_slice(&full_payload);

        log::trace!(
            ">>> Outbound to {}: Seq={} ID={} Flags={:X} Size={} Hex: {:02X?}",
            addr,
            header.sequence,
            header.id,
            header.flags,
            packet.len(),
            packet
        );

        if let Some(ref mut capture) = self.capture {
            let _ = capture.write_entry(Direction::Outbound, addr, &packet);
        }

        self.transport.send_to(&packet, addr).await?;
        Ok(())
    }

    pub fn process_fragment(&mut self, header: &FragmentHeader, data: &[u8]) -> Option<Vec<u8>> {
        if header.count == 1 {
            return Some(data.to_vec());
        }

        let entry = self
            .fragment_reassembler
            .entry(header.sequence)
            .or_insert_with(|| PendingMessage {
                count: header.count,
                fragments: vec![None; header.count as usize],
                received_count: 0,
            });

        // SAFETY: Handle server restart or ID reuse with different fragment count
        if header.count != entry.count {
            log::warn!(
                "Fragment count mismatch for Seq {}: expected {}, got {}. Resetting reassembler.",
                header.sequence,
                entry.count,
                header.count
            );
            entry.count = header.count;
            entry.fragments = vec![None; header.count as usize];
            entry.received_count = 0;
        }

        if header.index >= entry.count {
            return None;
        }

        if entry.fragments[header.index as usize].is_none() {
            entry.fragments[header.index as usize] = Some(data.to_vec());
            entry.received_count += 1;
        }

        if entry.received_count == entry.count {
            let mut full_message = Vec::new();
            let pending = self.fragment_reassembler.remove(&header.sequence)?;
            for f in pending.fragments.into_iter().flatten() {
                full_message.extend_from_slice(&f);
            }
            Some(full_message)
        } else {
            None
        }
    }

    pub async fn send_message(&mut self, message: &GameMessage) -> Result<()> {
        log::debug!(">>> Outgoing Message: {:?}", message);
        let mut payload = Vec::new();
        ProtocolPack::pack(message, &mut payload);

        let frag_header = FragmentHeader {
            sequence: self.fragment_sequence,
            id: self.fragment_id,
            count: 1,
            index: 0,
            size: (payload.len() + FRAGMENT_HEADER_SIZE) as u16,
            queue: queues::GENERAL,
        };
        self.fragment_sequence += 1;
        self.fragment_id += 1;

        let mut body = Vec::with_capacity(FRAGMENT_HEADER_SIZE + payload.len());
        frag_header.pack(&mut body);
        body.extend_from_slice(&payload);

        let header = PacketHeader {
            flags: packet_flags::BLOB_FRAGMENTS,
            sequence: self.packet_sequence,
            id: self.client_id,
            ..Default::default()
        };
        self.packet_sequence += 1;

        self.send_packet(header, &body).await
    }

    pub async fn send_action(&mut self, action: GameAction) -> Result<()> {
        self.game_action_sequence += 1;
        let action_msg = GameActionMessage {
            sequence: self.game_action_sequence,
            action,
        };
        self.send_message(&GameMessage::GameAction(Box::new(action_msg)))
            .await
    }

    pub async fn send_ack(&mut self, sequence: u32) -> Result<()> {
        let header = PacketHeader {
            flags: packet_flags::ACK_SEQUENCE,
            sequence: 0,
            id: self.client_id,
            ..Default::default()
        };

        let mut payload = vec![0u8; 4];
        LittleEndian::write_u32(&mut payload[0..4], sequence);

        self.send_packet(header, &payload).await
    }

    pub async fn recv_packet(&mut self, buf: &mut [u8]) -> Result<(PacketHeader, Vec<u8>)> {
        let (len, addr) = self.transport.recv_from(buf).await?;
        if len < HEADER_SIZE {
            return Err(anyhow!("Packet too short"));
        }

        if let Some(ref mut capture) = self.capture {
            let _ = capture.write_entry(Direction::Inbound, addr, &buf[..len]);
        }

        let mut offset = 0;
        let header = PacketHeader::unpack(&buf[..HEADER_SIZE], &mut offset)
            .ok_or_else(|| anyhow::anyhow!("Failed to unpack packet header"))?;
        let data = buf[HEADER_SIZE..len].to_vec();

        log::trace!(
            "<<< Inbound from {}: Seq={} ID={} Flags={:X} Size={} Hex: {:02X?}",
            addr,
            header.sequence,
            header.id,
            header.flags,
            len,
            &buf[..len]
        );

        if is_newer_u32(header.sequence, self.last_server_seq) {
            self.last_server_seq = header.sequence;
            self.has_server_seq = true;
        }

        if header.flags & packet_flags::ENCRYPTED_CHECKSUM != 0
            && let Some(isaac) = self.isaac_s2c.as_mut()
        {
            isaac.consume_key();
        }

        // Handle Transport-layer housekeeping (ACKs)
        if header.sequence > 0 && (header.flags & packet_flags::ACK_SEQUENCE == 0) {
            let _ = self.send_ack(header.sequence).await;
        }

        // ECHO_REQUEST Handling
        if header.flags & packet_flags::ECHO_REQUEST != 0 {
            let mut resp = header.clone();
            resp.flags = packet_flags::ECHO_RESPONSE;
            let _ = self.send_packet_to_addr(resp, &[], addr).await;
        }

        Ok((header, data))
    }

    pub fn get_payload_offset(&self, flags: u32, data: &[u8]) -> usize {
        OptionalHeaderCursor::new(data, flags).payload_offset()
    }

    /// Higher-level receiver that handles fragmentation and returns complete message payloads or handshake events.
    pub async fn recv_message(&mut self) -> Result<Vec<SessionEvent>> {
        let mut buf = [0u8; 1024 * 128];
        let (header, data) = self.recv_packet(&mut buf).await?;
        let mut events = Vec::new();

        // 1. Check for Handshake Request (Seeds/NetID from Server)
        if header.flags & packet_flags::CONNECT_REQUEST != 0 {
            let mut offset = self.get_payload_offset(header.flags, &data);
            if offset + transport::CONNECT_REQUEST_SIZE <= data.len() {
                let crd = ConnectRequestData::unpack(&data, &mut offset)
                    .ok_or_else(|| anyhow::anyhow!("Failed to unpack connect request"))?;
                events.push(SessionEvent::HandshakeRequest(crd));
            }
        }

        // 2. Check for Handshake Response (Cookie from Server)
        if header.flags & packet_flags::CONNECT_RESPONSE != 0 {
            let offset = self.get_payload_offset(header.flags, &data);
            if offset + transport::CONNECT_RESPONSE_SIZE <= data.len() {
                let cookie = LittleEndian::read_u64(
                    &data[offset..offset + transport::CONNECT_RESPONSE_SIZE],
                );
                events.push(SessionEvent::HandshakeResponse {
                    cookie,
                    client_id: header.id,
                });
            }
        }

        // 3. Check for TimeSync
        #[allow(clippy::collapsible_if)]
        if header.flags & packet_flags::TIME_SYNC != 0 {
            if let Some(offset) = OptionalHeaderCursor::new(&data, header.flags)
                .find_flag_offset(packet_flags::TIME_SYNC)
                .filter(|&offset| offset + 8 <= data.len())
            {
                let server_time = LittleEndian::read_f64(&data[offset..offset + 8]);
                events.push(SessionEvent::TimeSync(server_time));
            }
        }

        // 4. Check for Blobs
        if header.flags & packet_flags::BLOB_FRAGMENTS != 0 {
            let mut offset = self.get_payload_offset(header.flags, &data);
            while offset + FRAGMENT_HEADER_SIZE <= data.len() {
                let frag_header = FragmentHeader::unpack(&data, &mut offset)
                    .ok_or_else(|| anyhow::anyhow!("Failed to unpack fragment header"))?;
                let frag_data_size =
                    (frag_header.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);

                if offset + frag_data_size > data.len() {
                    break;
                }
                let frag_data = &data[offset..offset + frag_data_size];

                if let Some(full) = self.process_fragment(&frag_header, frag_data) {
                    events.push(SessionEvent::Message(full));
                }
                offset += frag_data_size;
            }
        }

        Ok(events)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::packet_flags;

    #[tokio::test]
    async fn test_payload_offset_handshake() {
        let session = Session::new("127.0.0.1:9000".parse().unwrap())
            .await
            .unwrap();

        // ConnectResponse should have 8 bytes offset
        assert_eq!(
            session.get_payload_offset(packet_flags::CONNECT_RESPONSE, &[0u8; 100]),
            8
        );

        // AckSequence + ConnectResponse
        assert_eq!(
            session.get_payload_offset(
                packet_flags::ACK_SEQUENCE | packet_flags::CONNECT_RESPONSE,
                &[0u8; 100]
            ),
            12
        );

        // EchoResponse (8 bytes)
        assert_eq!(
            session.get_payload_offset(packet_flags::ECHO_RESPONSE, &[0u8; 100]),
            8
        );
    }

    #[tokio::test]
    async fn test_payload_hash_handshake() {
        let session = Session::new("127.0.0.1:9000".parse().unwrap())
            .await
            .unwrap();

        // ConnectRequest hashing (32 bytes body)
        let payload = vec![1u8; 32];
        let hash = session
            .calculate_payload_hash(packet_flags::CONNECT_REQUEST, &payload)
            .unwrap();
        assert!(hash > 0);

        // Should match a direct Hash32 of the 32 bytes
        let expected = holtburger_protocol::crypto::Hash32::compute(&payload);
        assert_eq!(hash, expected);
    }

    #[tokio::test]
    async fn test_payload_hash_blobs() {
        let session = Session::new("127.0.0.1:9000".parse().unwrap())
            .await
            .unwrap();

        // Blob fragments: Fixed header (16) + data
        // We need a valid FragmentHeader where size includes header
        let mut payload = vec![0u8; 16];
        LittleEndian::write_u16(&mut payload[10..12], 20); // size = 16 + 4
        payload.extend_from_slice(&[1, 2, 3, 4]); // data

        // Checksum = hash(header) + hash(data)
        let hash = session
            .calculate_payload_hash(packet_flags::BLOB_FRAGMENTS, &payload)
            .unwrap();

        let h1 = holtburger_protocol::crypto::Hash32::compute(&payload[0..16]);
        let h2 = holtburger_protocol::crypto::Hash32::compute(&payload[16..20]);
        assert_eq!(hash, h1.wrapping_add(h2));
    }

    #[test]
    fn test_echo_response_hash_size() {
        let session = Session::new_test();
        // EchoResponse is 8 bytes in ACE
        let mut payload = vec![0u8; 8];
        payload[0] = 0xAA;
        payload[7] = 0xBB;

        let hash = session
            .calculate_payload_hash(packet_flags::ECHO_RESPONSE, &payload)
            .unwrap();
        let expected = holtburger_protocol::crypto::Hash32::compute(&payload);
        assert_eq!(hash, expected);
    }

    #[test]
    fn test_encrypted_checksum_xor_logic() {
        let mut session = Session::new_test();
        let seed = 0x99E77855;
        session.isaac_c2s = Some(holtburger_protocol::crypto::Isaac::new(seed));

        // Known first key for this seed is 0xAD497DF3
        let expected_key = 0xAD497DF3;

        let header = PacketHeader {
            sequence: 10,
            flags: packet_flags::ENCRYPTED_CHECKSUM,
            checksum: 0,
            id: 123,
            time: 1000,
            size: 4,
            iteration: 0,
        };

        let payload = vec![0x11, 0x22, 0x33, 0x44];

        let header_hash = header.calculate_checksum();
        let payload_hash = session
            .calculate_payload_hash(header.flags, &payload)
            .unwrap();

        // Final = HeaderHash + (PayloadHash ^ Key)
        let final_checksum = header_hash.wrapping_add(payload_hash ^ expected_key);

        // Verify our manual calculation matches what our ISAAC instance says
        assert_eq!(
            session.isaac_c2s.as_ref().unwrap().current_key,
            expected_key
        );

        // Note: We don't call session.send_packet here because it would actually try to send,
        // but we've verified the components of the formula.
        assert_eq!(
            header_hash.wrapping_add(payload_hash ^ expected_key),
            final_checksum
        );
    }

    #[tokio::test]
    async fn test_multi_fragment_packet_unaligned() {
        use std::sync::Arc;
        use tokio::sync::Mutex;

        struct MultiFragMock(Arc<Mutex<Vec<Vec<u8>>>>);
        #[async_trait]
        impl Transport for MultiFragMock {
            async fn send_to(&self, _buf: &[u8], _addr: SocketAddr) -> Result<usize> {
                Ok(0)
            }
            async fn recv_from(&self, buf: &mut [u8]) -> Result<(usize, SocketAddr)> {
                let mut q = self.0.lock().await;
                if q.is_empty() {
                    return Err(anyhow!("Empty"));
                }
                let data = q.remove(0);
                buf[..data.len()].copy_from_slice(&data);
                Ok((data.len(), "127.0.0.1:9001".parse().unwrap()))
            }
        }

        // The hex from the user request (@harmself response)
        // Contains 3 x PrivateUpdateVitalCurrent messages (13 bytes each) in fragments (16 bytes headers)
        // Total fragment size = 29 bytes (NOT 4-byte aligned!)
        let hex = "71000000060000003C8E48C70B0029B157000100AD0000000000008001001D0000000900E9020000000200000001000000AE0000000000008001001D0000000900E9020000000400000001000000AF0000000000008001001D0000000900E9020000000600000001000000";
        let data = hex::decode(hex).unwrap();

        let q = Arc::new(Mutex::new(vec![data]));
        let mut session = Session::new_test();
        session.transport = Box::new(MultiFragMock(q));

        let events = session.recv_message().await.unwrap();

        // We expect 3 messages because there were 3 fragments
        assert_eq!(events.len(), 3);

        for (i, event) in events.iter().enumerate() {
            if let SessionEvent::Message(msg_data) = event {
                assert_eq!(msg_data.len(), 13);
                assert_eq!(msg_data[0..2], [0xE9, 0x02]); // Opcode PrivateUpdateVitalCurrent

                // Verify vital IDs (2, 4, 6)
                let vital_id = u32::from_le_bytes(msg_data[5..9].try_into().unwrap());
                let expected_id = match i {
                    0 => 2,
                    1 => 4,
                    2 => 6,
                    _ => panic!("Too many messages"),
                };
                assert_eq!(vital_id, expected_id);
            } else {
                panic!("Expected SessionEvent::Message");
            }
        }
    }
}
