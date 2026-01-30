use crate::crypto::Isaac;
use crate::protocol::*;
use anyhow::{Result, anyhow};
use byteorder::{ByteOrder, LittleEndian};
use std::collections::HashMap;
use std::net::SocketAddr;
use tokio::net::UdpSocket;

#[derive(Debug)]
pub struct PendingMessage {
    pub count: u16,
    pub fragments: Vec<Option<Vec<u8>>>,
    pub received_count: u16,
}

pub struct Session {
    socket: UdpSocket,
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
}

impl Session {
    pub async fn new(server_addr: SocketAddr) -> Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0").await?;
        Ok(Self {
            socket,
            server_addr,
            isaac_c2s: None,
            isaac_s2c: None,
            packet_sequence: 0,
            fragment_sequence: 1,
            fragment_id: 1,
            client_id: 0,
            last_server_seq: 0,
            fragment_reassembler: HashMap::new(),
        })
    }

    /// Calculates the payload checksum used by ACE: Sum of hashes for each component.
    /// No cap, this is very different from a single hash of the whole payload.
    fn calculate_payload_hash(&self, flags: u32, payload: &[u8]) -> u32 {
        let mut total_payload_checksum: u32 = 0;
        let mut offset = 0;

        // 1. Optional Headers Section (Follows ACE PacketHeaderOptional sequence)
        let mut header_optional_bytes = Vec::new();

        if flags & flags::SERVER_SWITCH != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if flags & flags::REQUEST_RETRANSMIT != 0 {
            let count = LittleEndian::read_u32(&payload[offset..offset + 4]) as usize;
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4 + (count * 4)]);
            offset += 4 + (count * 4);
        }
        if flags & flags::REJECT_RETRANSMIT != 0 {
            let count = LittleEndian::read_u32(&payload[offset..offset + 4]) as usize;
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4 + (count * 4)]);
            offset += 4 + (count * 4);
        }
        if flags & flags::ACK_SEQUENCE != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4]);
            offset += 4;
        }
        if flags & flags::LOGIN_REQUEST != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..]);
            offset = payload.len();
        }
        if flags & flags::CONNECT_RESPONSE != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if flags & flags::CICMD != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if flags & flags::TIME_SYNC != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if flags & flags::ECHO_REQUEST != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4]);
            offset += 4;
        }
        if flags & flags::ECHO_RESPONSE != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4]);
            offset += 4;
        }
        if flags & flags::FLOW != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 6]);
            offset += 6;
        }

        if !header_optional_bytes.is_empty() {
            let h = crate::crypto::Hash32::compute(&header_optional_bytes);
            total_payload_checksum = total_payload_checksum.wrapping_add(h);
        }

        // 2. Fragments Section
        if flags & flags::BLOB_FRAGMENTS != 0 {
            while offset < payload.len() {
                if offset + FRAGMENT_HEADER_SIZE > payload.len() {
                    break;
                }
                // Fragment Header
                let hh =
                    crate::crypto::Hash32::compute(&payload[offset..offset + FRAGMENT_HEADER_SIZE]);
                total_payload_checksum = total_payload_checksum.wrapping_add(hh);

                let frag_header =
                    FragmentHeader::unpack(&payload[offset..offset + FRAGMENT_HEADER_SIZE]);
                let frag_data_size =
                    (frag_header.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);
                offset += FRAGMENT_HEADER_SIZE;

                // Fragment Data
                if frag_data_size > 0 {
                    if offset + frag_data_size > payload.len() {
                        // This shouldn't happen with correct packing, but safeguard.
                        break;
                    }
                    let dh =
                        crate::crypto::Hash32::compute(&payload[offset..offset + frag_data_size]);
                    total_payload_checksum = total_payload_checksum.wrapping_add(dh);
                    offset += frag_data_size;
                }

                // ACE alignment: fragments ARE padded to 4-byte boundaries in the raw payload,
                // BUT the padding bytes are NOT hashed.
                // We need to skip the padding to get to the next fragment header.
                let aligned_offset = (offset + 3) & !3;
                offset = aligned_offset;
            }
        }

        total_payload_checksum
    }

    pub async fn send_packet(&mut self, header: PacketHeader, payload: &[u8]) -> Result<()> {
        self.send_packet_to_addr(header, payload, self.server_addr).await
    }

    /// Sends a raw packet to a specific address. If ISAAC is initialized, it automatically applies the encrypted checksum.
    pub async fn send_packet_to_addr(&mut self, mut header: PacketHeader, payload: &[u8], addr: SocketAddr) -> Result<()> {
        let mut full_payload = Vec::new();

        // Automatically append ACK if we have a sequence to acknowledge
        if self.last_server_seq > 0
            && (header.flags & flags::CONNECT_REQUEST == 0)
            && (header.flags & flags::CONNECT_RESPONSE == 0)
            && (header.flags & flags::LOGIN_REQUEST == 0)
        {
            header.flags |= flags::ACK_SEQUENCE;
        }

        if (header.flags & flags::ACK_SEQUENCE) != 0 {
            full_payload.extend_from_slice(&self.last_server_seq.to_le_bytes());
        }

        full_payload.extend_from_slice(payload);
        header.size = full_payload.len() as u16;

        let is_handshake = (header.flags
            & (flags::LOGIN_REQUEST | flags::CONNECT_REQUEST | flags::CONNECT_RESPONSE))
            != 0;

        if let (Some(_), false) = (&mut self.isaac_c2s, is_handshake) {
            header.flags |= flags::ENCRYPTED_CHECKSUM;
        }

        let header_hash = header.calculate_checksum();
        let payload_hash = self.calculate_payload_hash(header.flags, &full_payload);

        if let (Some(isaac), false) = (&mut self.isaac_c2s, is_handshake) {
            let key = isaac.current_key;
            isaac.consume_key();

            // ACE Encrypted CRC: header_hash + (payload_hash ^ key)
            header.checksum = header_hash.wrapping_add(payload_hash ^ key);
            log::debug!(
                ">>> Encrypted Send to {}: Seq={} ID={} Flags={:08X} HeaderHash={:08X} PayloadHash={:08X} Mask={:08X} FinalCRC={:08X}",
                addr,
                header.sequence,
                header.id,
                header.flags,
                header_hash,
                payload_hash,
                key,
                header.checksum
            );
        } else {
            header.checksum = header_hash.wrapping_add(payload_hash);
            log::debug!(
                ">>> Cleartext Send to {}: Seq={} ID={} Flags={:08X} Checksum={:08X}",
                addr,
                header.sequence,
                header.id,
                header.flags,
                header.checksum
            );
        }

        let mut packet = vec![0u8; HEADER_SIZE];
        header.pack(&mut packet);
        packet.extend_from_slice(&full_payload);

        self.socket.send_to(&packet, addr).await?;
        Ok(())
    }

    /// Processes a single fragment and returns the full message if reassembly is complete.
    /// No cap, this is where the magic happens.
    pub fn process_fragment(&mut self, header: &FragmentHeader, data: &[u8]) -> Option<Vec<u8>> {
        if header.count == 1 {
            return Some(data.to_vec());
        }

        let entry = self
            .fragment_reassembler
            .entry(header.id)
            .or_insert_with(|| PendingMessage {
                count: header.count,
                fragments: vec![None; header.count as usize],
                received_count: 0,
            });

        if header.index >= entry.count {
            log::warn!(
                "Received fragment index {} out of bounds for message ID {}",
                header.index,
                header.id
            );
            return None;
        }

        if entry.fragments[header.index as usize].is_none() {
            entry.fragments[header.index as usize] = Some(data.to_vec());
            entry.received_count += 1;
        }

        if entry.received_count == entry.count {
            let mut full_message = Vec::new();
            let pending = self.fragment_reassembler.remove(&header.id)?;
            for f in pending.fragments.into_iter().flatten() {
                full_message.extend_from_slice(&f);
            }
            Some(full_message)
        } else {
            None
        }
    }

    /// Wraps a GameMessage into a Fragment and sends it via send_packet.
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
        frag_header.pack(&mut body);
        body.extend_from_slice(&payload);

        // Packet sequence is same as fragment sequence for simple messages
        let header = PacketHeader {
            flags: flags::BLOB_FRAGMENTS,
            sequence: self.packet_sequence,
            id: self.client_id,
            ..Default::default()
        };
        self.packet_sequence += 1;

        self.send_packet(header, &body).await
    }

    pub async fn send_ack(&mut self, sequence: u32) -> Result<()> {
        let header = PacketHeader {
            flags: flags::ACK_SEQUENCE,
            sequence: 0, // ACKs are non-sequenced
            id: self.client_id,
            ..Default::default()
        };
        
        // AckSequence is in the optional header area
        let mut payload = vec![0u8; 4];
        LittleEndian::write_u32(&mut payload[0..4], sequence);

        self.send_packet(header, &payload).await
    }

    pub async fn recv_packet(
        &mut self,
        buf: &mut [u8],
    ) -> Result<(PacketHeader, Vec<u8>, SocketAddr)> {
        let (len, addr) = self.socket.recv_from(buf).await?;
        if len < HEADER_SIZE {
            return Err(anyhow!("Packet too short"));
        }

        log::trace!("Raw packet ({} bytes): {:02X?}", len, &buf[..len]);

        let header = PacketHeader::unpack(&buf[..HEADER_SIZE]);
        let payload = buf[HEADER_SIZE..len].to_vec();

        // Track sequence (ignore 0 which is usually handshake/non-sequenced)
        if header.sequence > self.last_server_seq {
            self.last_server_seq = header.sequence;
        }

        // Update ISAAC if encrypted checksum is present (S2C direction)
        if (header.flags & flags::ENCRYPTED_CHECKSUM != 0) && self.isaac_s2c.is_some() {
            let isaac = self.isaac_s2c.as_mut().unwrap();
            let key = isaac.current_key;
            isaac.consume_key();
            log::debug!("ISAAC Sync (S2C): Consumed word {:08X}", key);
        }

        Ok((header, payload, addr))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::FragmentHeader;

    #[tokio::test]
    async fn test_fragment_reassembly() {
        let addr = "127.0.0.1:0".parse().unwrap();
        let mut session = Session::new(addr).await.unwrap();

        let frag1 = FragmentHeader {
            id: 101,
            count: 2,
            index: 0,
            size: 20, // 16 header + 4 data
            ..Default::default()
        };
        let data1 = vec![1, 2, 3, 4];

        let frag2 = FragmentHeader {
            id: 101,
            count: 2,
            index: 1,
            size: 20,
            ..Default::default()
        };
        let data2 = vec![5, 6, 7, 8];

        // Process first fragment
        let res1 = session.process_fragment(&frag1, &data1);
        assert!(res1.is_none());
        assert_eq!(session.fragment_reassembler.len(), 1);

        // Process second fragment (out of order test follows in next test)
        let res2 = session.process_fragment(&frag2, &data2);
        assert!(res2.is_some());
        let full = res2.unwrap();
        assert_eq!(full, vec![1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(session.fragment_reassembler.len(), 0);
    }

    #[tokio::test]
    async fn test_out_of_order_fragments() {
        let addr = "127.0.0.1:0".parse().unwrap();
        let mut session = Session::new(addr).await.unwrap();

        let frag1 = FragmentHeader {
            id: 200,
            count: 2,
            index: 1,
            ..Default::default()
        };
        let data1 = vec![3, 4];

        let frag2 = FragmentHeader {
            id: 200,
            count: 2,
            index: 0,
            ..Default::default()
        };
        let data2 = vec![1, 2];

        assert!(session.process_fragment(&frag1, &data1).is_none());
        let full = session.process_fragment(&frag2, &data2).unwrap();
        assert_eq!(full, vec![1, 2, 3, 4]);
    }
}
