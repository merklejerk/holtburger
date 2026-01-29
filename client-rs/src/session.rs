use crate::crypto::Isaac;
use crate::protocol::*;
use anyhow::{Result, anyhow};
use byteorder::{ByteOrder, LittleEndian};
use std::net::SocketAddr;
use tokio::net::UdpSocket;

pub struct Session {
    socket: UdpSocket,
    pub server_addr: SocketAddr,
    pub isaac_c2s: Option<Isaac>,
    pub isaac_s2c: Option<Isaac>,
    pub sequence_num: u32,
    fragment_id: u32,
    // NetID/ClientID assigned by server
    pub client_id: u16,
    pub last_server_seq: u32,
}

impl Session {
    pub async fn new(server_addr: SocketAddr) -> Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0").await?;
        Ok(Self {
            socket,
            server_addr,
            isaac_c2s: None,
            isaac_s2c: None,
            sequence_num: 0,
            fragment_id: 1,
            client_id: 0,
            last_server_seq: 0,
        })
    }

    /// Calculates the composite checksum used by ACE: Sum of hashes for each component.
    fn calculate_composite_checksum(&self, header: &PacketHeader, payload: &[u8]) -> u32 {
        let mut total_payload_checksum: u32 = 0;
        let mut offset = 0;

        // 1. Optional Headers Section (Follows ACE PacketHeaderOptional sequence)
        let mut header_optional_bytes = Vec::new();

        if header.flags & 0x0100 != 0 {
            // ServerSwitch
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if header.flags & 0x1000 != 0 {
            // RequestRetransmit
            let count = LittleEndian::read_u32(&payload[offset..offset + 4]) as usize;
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4 + (count * 4)]);
            offset += 4 + (count * 4);
        }
        if header.flags & 0x2000 != 0 {
            // RejectRetransmit
            let count = LittleEndian::read_u32(&payload[offset..offset + 4]) as usize;
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4 + (count * 4)]);
            offset += 4 + (count * 4);
        }
        if header.flags & flags::ACK_SEQUENCE != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4]);
            offset += 4;
        }
        if header.flags & flags::LOGIN_REQUEST != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..]);
            offset = payload.len();
        }
        if header.flags & 0x00020000 != 0 {
            // WorldLoginRequest
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            // ACE resets position for this, but we'll assume it's just the 8 bytes for now
            offset += 8;
        }
        if header.flags & flags::CONNECT_RESPONSE != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            // ACE resets position for this too
            offset += 8;
        }
        if header.flags & 0x00400000 != 0 {
            // CICMD
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if header.flags & flags::TIME_SYNC != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 8]);
            offset += 8;
        }
        if header.flags & flags::ECHO_REQUEST != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4]);
            offset += 4;
        }
        if header.flags & flags::ECHO_RESPONSE != 0 {
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 4]);
            offset += 4;
        }
        if header.flags & 0x08000000 != 0 {
            // Flow
            header_optional_bytes.extend_from_slice(&payload[offset..offset + 6]);
            offset += 6;
        }

        if !header_optional_bytes.is_empty() {
            let h = crate::crypto::Hash32::compute(&header_optional_bytes);
            log::debug!(
                "Optional Headers Hash: {:08X} (Size: {}) Data: {:02X?}",
                h,
                header_optional_bytes.len(),
                header_optional_bytes
            );
            total_payload_checksum = total_payload_checksum.wrapping_add(h);
        }

        // 2. Fragments Section
        if header.flags & flags::BLOB_FRAGMENTS != 0 {
            while offset + FRAGMENT_HEADER_SIZE <= payload.len() {
                // Fragment Header
                let hh =
                    crate::crypto::Hash32::compute(&payload[offset..offset + FRAGMENT_HEADER_SIZE]);
                log::debug!(
                    "Fragment Header Hash: {:08X} Data: {:02X?}",
                    hh,
                    &payload[offset..offset + FRAGMENT_HEADER_SIZE]
                );
                total_payload_checksum = total_payload_checksum.wrapping_add(hh);

                let frag_header =
                    FragmentHeader::unpack(&payload[offset..offset + FRAGMENT_HEADER_SIZE]);
                let frag_data_size =
                    (frag_header.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);
                offset += FRAGMENT_HEADER_SIZE;

                // Fragment Data
                if frag_data_size > 0 && offset + frag_data_size <= payload.len() {
                    let dh =
                        crate::crypto::Hash32::compute(&payload[offset..offset + frag_data_size]);
                    log::debug!(
                        "Fragment Data Hash: {:08X} (Size: {}) Data: {:02X?}",
                        dh,
                        frag_data_size,
                        &payload[offset..offset + frag_data_size]
                    );
                    total_payload_checksum = total_payload_checksum.wrapping_add(dh);
                    offset += frag_data_size;
                    offset = crate::protocol::align_to_4(offset);
                }
            }
        }

        total_payload_checksum
    }

    /// Sends a raw packet. If ISAAC is initialized, it automatically applies the encrypted checksum.
    /// It also automatically adds an ACK if we have received packets from the server.
    pub async fn send_packet(&mut self, mut header: PacketHeader, payload: &[u8]) -> Result<()> {
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

        if let Some(isaac) = &mut self.isaac_c2s {
            header.flags |= flags::ENCRYPTED_CHECKSUM;
            let key = isaac.next();

            let mut header_data = [0u8; HEADER_SIZE];
            let mut header_copy = header.clone();
            header_copy.checksum = CHECKSUM_SEED;
            header_copy.pack(&mut header_data);

            let header_hash = crate::crypto::Hash32::compute(&header_data);
            let payload_hash = self.calculate_composite_checksum(&header, &full_payload);

            header.checksum = header_hash.wrapping_add(payload_hash ^ key);
            log::debug!(
                ">>> Encrypted Send: Seq={} Flags={:08X} HeaderHash={:08X} PayloadHash={:08X} Mask={:08X} FinalCRC={:08X}",
                header.sequence,
                header.flags,
                header_hash,
                payload_hash,
                key,
                header.checksum
            );
        } else {
            let mut header_data = [0u8; HEADER_SIZE];
            let mut header_copy = header.clone();
            header_copy.checksum = CHECKSUM_SEED;
            header_copy.pack(&mut header_data);

            let header_hash = crate::crypto::Hash32::compute(&header_data);
            let payload_hash = self.calculate_composite_checksum(&header, &full_payload);

            header.checksum = header_hash.wrapping_add(payload_hash);
            log::debug!(
                ">>> Sending packet: Seq:{} Flags:{:08X} Checksum:{:08X}",
                header.sequence,
                header.flags,
                header.checksum
            );
        }

        let mut packet = vec![0u8; HEADER_SIZE];
        header.pack(&mut packet);
        packet.extend_from_slice(&full_payload);

        self.socket.send_to(&packet, self.server_addr).await?;
        Ok(())
    }

    /// Wraps a GameMessage into a Fragment and sends it via send_packet.
    pub async fn send_message(&mut self, message: &GameMessage) -> Result<()> {
        let payload = message.pack();

        let header = PacketHeader {
            flags: flags::BLOB_FRAGMENTS,
            sequence: self.sequence_num,
            id: self.client_id,
            ..Default::default()
        };
        self.sequence_num += 1;

        let frag_header = FragmentHeader {
            sequence: self.sequence_num - 1,
            id: self.fragment_id,
            count: 1,
            index: 0,
            size: (payload.len() + FRAGMENT_HEADER_SIZE) as u16,
            queue: queues::GENERAL,
        };
        self.fragment_id += 1;

        let mut body = vec![0u8; FRAGMENT_HEADER_SIZE];
        frag_header.pack(&mut body);
        body.extend_from_slice(&payload);

        self.send_packet(header, &body).await
    }

    /// Receives a packet and handles the S2C ISAAC synchronization and sequence tracking.
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
        if header.flags & flags::ENCRYPTED_CHECKSUM != 0 {
            if let Some(isaac) = &mut self.isaac_s2c {
                let key = isaac.next();
                log::debug!("ISAAC Sync (S2C): Consumed word {:08X}", key);
            }
        }

        Ok((header, payload, addr))
    }

    /// High-level receiver that handles reassembling fragments into GameMessages.
    pub async fn recv_message(&mut self, buf: &mut [u8]) -> Result<Vec<GameMessage>> {
        let (header, payload, _addr) = self.recv_packet(buf).await?;
        let mut messages = Vec::new();

        if header.flags & flags::BLOB_FRAGMENTS != 0 {
            let mut offset = 0;
            while offset + FRAGMENT_HEADER_SIZE <= payload.len() {
                let frag_header =
                    FragmentHeader::unpack(&payload[offset..offset + FRAGMENT_HEADER_SIZE]);
                let frag_size = frag_header.size as usize;
                offset += FRAGMENT_HEADER_SIZE;

                if offset + frag_size > payload.len() {
                    break;
                }

                // Simplified: Only handling single-packet fragments for now
                if frag_header.count == 1 {
                    let msg_data = &payload[offset..offset + frag_size];
                    messages.push(GameMessage::unpack(msg_data));
                }

                offset += frag_size;
                offset = crate::protocol::align_to_4(offset);
            }
        } else {
            // Check for special header-only or non-fragmented messages
            if header.flags & flags::CONNECT_REQUEST != 0 {
                // Handled as a special case because it carries handshake data
            }
        }

        Ok(messages)
    }
}
