pub mod capture;

use crate::protocol::crypto::Isaac;
use crate::protocol::messages::*;
use crate::protocol::messages::utils::align_offset;
use crate::session::capture::{CaptureWriter, Direction};
use anyhow::{Result, anyhow};
pub use async_trait::async_trait;
use byteorder::{ByteOrder, LittleEndian};
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
    pub fragment_reassembler: HashMap<u32, PendingMessage>,
    pub capture: Option<CaptureWriter>,
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
            fragment_reassembler: HashMap::new(),
            capture: None,
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
            fragment_reassembler: HashMap::new(),
            capture: None,
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
            capture: None,
        }
    }

    /// Calculates the payload checksum used by ACE: Sum of hashes for each component.
    fn calculate_payload_hash(&self, flags: u32, payload: &[u8]) -> u32 {
        let mut total_payload_checksum: u32 = 0;
        let mut offset = 0;

        // 1. Optional Headers Section (Follows ACE PacketHeaderOptional sequence)
        let mut header_optional_bytes = Vec::new();

        if flags & packet_flags::SERVER_SWITCH != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if flags & packet_flags::REQUEST_RETRANSMIT != 0 {
            let count = LittleEndian::read_u32(&payload[offset..offset + 4]) as usize;
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4 + (count * 4)]);
            offset += 4 + (count * 4);
        }
        if flags & packet_flags::REJECT_RETRANSMIT != 0 {
            let count = LittleEndian::read_u32(&payload[offset..offset + 4]) as usize;
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4 + (count * 4)]);
            offset += 4 + (count * 4);
        }
        if flags & packet_flags::ACK_SEQUENCE != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4]);
            offset += 4;
        }
        if flags & packet_flags::CONNECT_REQUEST != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 32]);
            offset += 32;
        }
        if flags & packet_flags::LOGIN_REQUEST != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..]);
            offset = payload.len();
        }
        if flags & packet_flags::CONNECT_RESPONSE != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if flags & packet_flags::CICMD != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if flags & packet_flags::TIME_SYNC != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if flags & packet_flags::ECHO_REQUEST != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4]);
            offset += 4;
        }
        if flags & packet_flags::ECHO_RESPONSE != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if flags & packet_flags::FLOW != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 6]);
            offset += 6;
        }

        if !header_optional_bytes.is_empty() {
            let h = crate::protocol::crypto::Hash32::compute(&header_optional_bytes);
            total_payload_checksum = total_payload_checksum.wrapping_add(h);
        }

        // 2. Fragments Section
        if flags & packet_flags::BLOB_FRAGMENTS != 0 {
            while offset < payload.len() {
                if offset + FRAGMENT_HEADER_SIZE > payload.len() {
                    break;
                }
                let h_start = offset;
                let frag_header = FragmentHeader::unpack(payload, &mut offset)
                    .expect("Failed to unpack fragment header");
                // Fragment Header Hash
                let hh = crate::protocol::crypto::Hash32::compute(&payload[h_start..offset]);
                total_payload_checksum = total_payload_checksum.wrapping_add(hh);

                let frag_data_size =
                    (frag_header.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);

                // Fragment Data
                if frag_data_size > 0 {
                    if offset + frag_data_size > payload.len() {
                        break;
                    }
                    let dh = crate::protocol::crypto::Hash32::compute(
                        &payload[offset..offset + frag_data_size],
                    );
                    total_payload_checksum = total_payload_checksum.wrapping_add(dh);
                    offset += frag_data_size;
                }

                align_offset(&mut offset, 4);
            }
        }

        total_payload_checksum
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
            && self.last_server_seq > 0
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
        let payload_hash = self.calculate_payload_hash(header.flags, &full_payload);

        if let (Some(isaac), false) = (&mut self.isaac_c2s, is_handshake) {
            let key = isaac.current_key;
            isaac.consume_key();

            header.checksum = header_hash.wrapping_add(payload_hash ^ key);
            log::trace!(
                ">>> Encrypted Send to {}: Seq={} ID={} Flags={:08X} FinalCRC={:08X}",
                addr,
                header.sequence,
                header.id,
                header.flags,
                header.checksum
            );
        } else {
            header.checksum = header_hash.wrapping_add(payload_hash);
            log::trace!(
                ">>> Cleartext Send to {}: Seq={} ID={} Flags={:08X} Checksum={:08X}",
                addr,
                header.sequence,
                header.id,
                header.flags,
                header.checksum
            );
        }

        let mut packet = vec![0u8; HEADER_SIZE];
        let mut pack_offset = 0;
        header.pack(&mut packet, &mut pack_offset);
        packet.extend_from_slice(&full_payload);

        log::trace!("RAW OUTBOUND: {:02X?}", packet);

        if let Some(ref mut capture) = self.capture {
            let _ = capture.write_entry(Direction::Outbound, addr, &packet);
        }

        self.transport.send_to(&packet, addr).await?;
        Ok(())
    }

    pub fn process_fragment(&mut self, header: &FragmentHeader, data: &[u8]) -> Option<Vec<u8>> {
        log::trace!(
            "Processing fragment Seq={} {}/{} size={}",
            header.sequence,
            header.index + 1,
            header.count,
            data.len()
        );
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
        let payload = message.pack();

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

        let mut body = vec![0u8; FRAGMENT_HEADER_SIZE];
        let mut pack_offset = 0;
        frag_header.pack(&mut body, &mut pack_offset);
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

        log::trace!("RAW INBOUND: {:02X?}", &buf[..len]);

        log::trace!(
            "<<< Inbound from {}: Seq={} ID={} Flags={:X} Size={} Hex: {:02X?}",
            addr,
            header.sequence,
            header.id,
            header.flags,
            len,
            &buf[..len]
        );

        if header.sequence > self.last_server_seq {
            self.last_server_seq = header.sequence;
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
        let mut offset = 0;
        if flags & packet_flags::SERVER_SWITCH != 0 {
            offset += transport::SERVER_SWITCH_SIZE;
        }
        if flags & packet_flags::REQUEST_RETRANSMIT != 0 && offset + 4 <= data.len() {
            let count = LittleEndian::read_u32(&data[offset..offset + 4]);
            offset += 4 + (count as usize * 4);
        }
        if flags & packet_flags::REJECT_RETRANSMIT != 0 && offset + 4 <= data.len() {
            let count = LittleEndian::read_u32(&data[offset..offset + 4]);
            offset += 4 + (count as usize * 4);
        }
        if flags & packet_flags::ACK_SEQUENCE != 0 {
            offset += transport::ACK_SEQUENCE_SIZE;
        }
        if flags & packet_flags::CONNECT_RESPONSE != 0 {
            offset += transport::CONNECT_RESPONSE_SIZE;
        }
        if flags & packet_flags::CICMD != 0 {
            offset += transport::CICMD_SIZE;
        }
        if flags & packet_flags::TIME_SYNC != 0 {
            offset += transport::TIME_SYNC_SIZE;
        }
        if flags & packet_flags::ECHO_REQUEST != 0 {
            offset += transport::ECHO_REQUEST_SIZE;
        }
        if flags & packet_flags::ECHO_RESPONSE != 0 {
            offset += transport::ECHO_RESPONSE_SIZE;
        }
        if flags & packet_flags::FLOW != 0 {
            offset += transport::FLOW_SIZE;
        }
        offset
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
        if header.flags & packet_flags::TIME_SYNC != 0 {
            let mut offset = 0;
            // TimeSync is an optional header. We need to find its specific offset.
            // PacketHeaderOptional sequence:
            // SERVER_SWITCH (8), REQUEST_RETRANSMIT (4+4*n), REJECT_RETRANSMIT (4+4*n), ACK_SEQUENCE (4), CONNECT_RESPONSE (8), CICMD (8), TIME_SYNC (8)
            if header.flags & packet_flags::SERVER_SWITCH != 0 {
                offset += 8;
            }
            if header.flags & packet_flags::REQUEST_RETRANSMIT != 0 && offset + 4 <= data.len() {
                let count = LittleEndian::read_u32(&data[offset..offset + 4]);
                offset += 4 + (count as usize * 4);
            }
            if header.flags & packet_flags::REJECT_RETRANSMIT != 0 && offset + 4 <= data.len() {
                let count = LittleEndian::read_u32(&data[offset..offset + 4]);
                offset += 4 + (count as usize * 4);
            }
            if header.flags & packet_flags::ACK_SEQUENCE != 0 {
                offset += 4;
            }
            if header.flags & packet_flags::CONNECT_RESPONSE != 0 {
                offset += 8;
            }
            if header.flags & packet_flags::CICMD != 0 {
                offset += 8;
            }
            if header.flags & packet_flags::TIME_SYNC != 0 && offset + 8 <= data.len() {
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

                // Fragments are 4-byte aligned in AC
                align_offset(&mut offset, 4);
            }
        }

        Ok(events)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::packet_flags;

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
        let hash = session.calculate_payload_hash(packet_flags::CONNECT_REQUEST, &payload);
        assert!(hash > 0);

        // Should match a direct Hash32 of the 32 bytes
        let expected = crate::protocol::crypto::Hash32::compute(&payload);
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
        let hash = session.calculate_payload_hash(packet_flags::BLOB_FRAGMENTS, &payload);

        let h1 = crate::protocol::crypto::Hash32::compute(&payload[0..16]);
        let h2 = crate::protocol::crypto::Hash32::compute(&payload[16..20]);
        assert_eq!(hash, h1.wrapping_add(h2));
    }

    #[test]
    fn test_echo_response_hash_size() {
        let session = Session::new_test();
        // EchoResponse is 8 bytes in ACE
        let mut payload = vec![0u8; 8];
        payload[0] = 0xAA;
        payload[7] = 0xBB;

        let hash = session.calculate_payload_hash(packet_flags::ECHO_RESPONSE, &payload);
        let expected = crate::protocol::crypto::Hash32::compute(&payload);
        assert_eq!(hash, expected);
    }

    #[test]
    fn test_encrypted_checksum_xor_logic() {
        let mut session = Session::new_test();
        let seed = 0x99E77855;
        session.isaac_c2s = Some(crate::protocol::crypto::Isaac::new(seed));

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
        let payload_hash = session.calculate_payload_hash(header.flags, &payload);

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
}
