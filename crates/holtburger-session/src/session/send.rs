use super::types::{PendingControlPacket, PendingControlPacketData, PendingMessage, Session};
use crate::capture::Direction;
use crate::optional_header::OptionalHeaderCursor;
use anyhow::{Result, anyhow};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_protocol::messages::transport::{self, packet_flags, queues};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};
use std::time::Instant;

impl Session {
    fn unpack_packet_header(packet: &[u8]) -> Result<PacketHeader> {
        let mut offset = 0;
        PacketHeader::unpack(packet, &mut offset)
            .ok_or_else(|| anyhow!("Failed to unpack packet header"))
    }

    pub(crate) fn calculate_payload_hash(&self, flags: u32, payload: &[u8]) -> Result<u32> {
        let mut total_payload_checksum: u32 = 0;

        let cursor = OptionalHeaderCursor::new(payload, flags);
        let header_optional_bytes = cursor.hash_bytes();

        if !header_optional_bytes.is_empty() {
            let h = holtburger_protocol::crypto::Hash32::compute(&header_optional_bytes);
            total_payload_checksum = total_payload_checksum.wrapping_add(h);
        }

        if flags & packet_flags::BLOB_FRAGMENTS != 0 {
            let mut offset = cursor.payload_offset();
            while offset < payload.len() {
                if offset + transport::FRAGMENT_HEADER_SIZE > payload.len() {
                    break;
                }
                let h_start = offset;
                let frag_header = FragmentHeader::unpack(payload, &mut offset)
                    .ok_or_else(|| anyhow!("Failed to unpack fragment header"))?;
                let hh = holtburger_protocol::crypto::Hash32::compute(&payload[h_start..offset]);
                total_payload_checksum = total_payload_checksum.wrapping_add(hh);

                let frag_data_size =
                    (frag_header.size as usize).saturating_sub(transport::FRAGMENT_HEADER_SIZE);

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
            }
        }

        Ok(total_payload_checksum)
    }

    fn build_packet_bytes(&mut self, mut header: PacketHeader, payload: &[u8]) -> Result<Vec<u8>> {
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
        if full_payload.len() > u16::MAX as usize {
            return Err(anyhow!(
                "packet payload too large: {} bytes exceeds u16::MAX",
                full_payload.len()
            ));
        }
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

        let mut packet = Vec::with_capacity(transport::HEADER_SIZE + full_payload.len());
        header.pack(&mut packet);
        packet.extend_from_slice(&full_payload);
        Ok(packet)
    }

    fn build_cleartext_control_packet_bytes(
        &self,
        mut header: PacketHeader,
        payload: &[u8],
    ) -> Result<Vec<u8>> {
        if payload.len() > u16::MAX as usize {
            return Err(anyhow!(
                "packet payload too large: {} bytes exceeds u16::MAX",
                payload.len()
            ));
        }
        header.size = payload.len() as u16;
        let payload_hash = self.calculate_payload_hash(header.flags, payload)?;
        header.checksum = header.calculate_checksum().wrapping_add(payload_hash);

        let mut packet = Vec::with_capacity(transport::HEADER_SIZE + payload.len());
        header.pack(&mut packet);
        packet.extend_from_slice(payload);
        Ok(packet)
    }

    pub(crate) fn queue_prebuilt_control_packet(
        &mut self,
        packet: Vec<u8>,
        addr: std::net::SocketAddr,
        ready_at: Instant,
    ) {
        self.pending_control_packets.push(PendingControlPacket {
            addr,
            ready_at,
            data: PendingControlPacketData::Prebuilt(packet),
        });
    }

    pub(crate) fn queue_deferred_cleartext_control_packet(
        &mut self,
        header: PacketHeader,
        payload: &[u8],
        addr: std::net::SocketAddr,
        ready_at: Instant,
        use_current_sequence: bool,
    ) -> Result<()> {
        if payload.len() > u16::MAX as usize {
            return Err(anyhow!(
                "packet payload too large: {} bytes exceeds u16::MAX",
                payload.len()
            ));
        }

        self.pending_control_packets.push(PendingControlPacket {
            addr,
            ready_at,
            data: PendingControlPacketData::DeferredCleartext {
                header,
                payload: payload.to_vec(),
                use_current_sequence,
            },
        });

        Ok(())
    }

    pub(crate) fn queue_packet_to_addr(
        &mut self,
        header: PacketHeader,
        payload: &[u8],
        addr: std::net::SocketAddr,
        ready_at: Instant,
    ) -> Result<()> {
        let packet = self.build_packet_bytes(header, payload)?;
        self.queue_prebuilt_control_packet(packet, addr, ready_at);
        Ok(())
    }

    pub(crate) fn next_pending_control_deadline(&self) -> Option<Instant> {
        self.pending_control_packets
            .iter()
            .map(|packet| packet.ready_at)
            .min()
    }

    pub(crate) async fn flush_pending_control_packets(&mut self) -> Result<bool> {
        let mut flushed_any = false;

        loop {
            let now = Instant::now();
            let Some(index) = self
                .pending_control_packets
                .iter()
                .position(|packet| packet.ready_at <= now)
            else {
                return Ok(flushed_any);
            };

            let pending = self.pending_control_packets[index].clone();
            let packet = match pending.data {
                PendingControlPacketData::Prebuilt(bytes) => bytes,
                PendingControlPacketData::DeferredCleartext {
                    mut header,
                    payload,
                    use_current_sequence,
                } => {
                    if use_current_sequence {
                        header.sequence = self.current_client_sequence();
                    }
                    self.build_cleartext_control_packet_bytes(header, &payload)?
                }
            };

            self.send_raw_packet(&packet, pending.addr).await?;

            let header = Self::unpack_packet_header(&packet)?;
            self.maybe_cache_packet(&header, &packet, pending.addr);
            self.pending_control_packets.remove(index);
            flushed_any = true;
        }
    }

    pub async fn send_packet(&mut self, header: PacketHeader, payload: &[u8]) -> Result<()> {
        self.send_packet_to_addr(header, payload, self.server_addr)
            .await
    }

    pub async fn send_packet_to_addr(
        &mut self,
        header: PacketHeader,
        payload: &[u8],
        addr: std::net::SocketAddr,
    ) -> Result<()> {
        let packet = self.build_packet_bytes(header, payload)?;
        self.send_raw_packet(&packet, addr).await?;
        let header = Self::unpack_packet_header(&packet)?;
        self.maybe_cache_packet(&header, &packet, addr);
        Ok(())
    }

    pub(crate) async fn send_cleartext_control_packet(
        &mut self,
        header: PacketHeader,
        payload: &[u8],
        addr: std::net::SocketAddr,
    ) -> Result<()> {
        let packet = self.build_cleartext_control_packet_bytes(header, payload)?;
        self.send_raw_packet(&packet, addr).await?;
        let header = Self::unpack_packet_header(&packet)?;
        self.maybe_cache_packet(&header, &packet, addr);
        Ok(())
    }

    pub(crate) async fn send_raw_packet(
        &mut self,
        packet: &[u8],
        addr: std::net::SocketAddr,
    ) -> Result<()> {
        let mut offset = 0;
        let header = PacketHeader::unpack(packet, &mut offset);

        log::trace!(
            ">>> Outbound to {}: Seq={} ID={} Flags={:X} Size={} Hex: {:02X?}",
            addr,
            header.as_ref().map_or(0, |header| header.sequence),
            header.as_ref().map_or(0, |header| header.id),
            header.as_ref().map_or(0, |header| header.flags),
            packet.len(),
            packet
        );

        if let Some(ref mut capture) = self.capture {
            let _ = capture.write_entry(Direction::Outbound, addr, packet);
        }

        self.bytes_out = self.bytes_out.wrapping_add(packet.len() as u64);
        self.last_send_time = std::time::Instant::now();
        self.transport.send_to(packet, addr).await?;
        Ok(())
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
            size: (payload.len() + transport::FRAGMENT_HEADER_SIZE) as u16,
            queue: queues::GENERAL,
        };
        self.fragment_sequence += 1;
        self.fragment_id += 1;

        let mut body = Vec::with_capacity(transport::FRAGMENT_HEADER_SIZE + payload.len());
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
        let mut payload = vec![0u8; 4];
        LittleEndian::write_u32(&mut payload[0..4], sequence);

        self.send_cleartext_control_packet(
            PacketHeader {
                flags: packet_flags::ACK_SEQUENCE,
                sequence: self.current_client_sequence(),
                id: self.client_id,
                ..Default::default()
            },
            &payload,
            self.server_addr,
        )
        .await
    }

    pub(crate) fn queue_ack(&mut self, sequence: u32) -> Result<()> {
        let mut payload = vec![0u8; 4];
        LittleEndian::write_u32(&mut payload[0..4], sequence);

        self.queue_deferred_cleartext_control_packet(
            PacketHeader {
                flags: packet_flags::ACK_SEQUENCE,
                id: self.client_id,
                ..Default::default()
            },
            &payload,
            self.server_addr,
            Instant::now(),
            true,
        )
    }

    pub(crate) fn process_fragment(
        &mut self,
        header: &FragmentHeader,
        data: &[u8],
    ) -> Option<Vec<u8>> {
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
            for fragment in pending.fragments.into_iter().flatten() {
                full_message.extend_from_slice(&fragment);
            }
            Some(full_message)
        } else {
            None
        }
    }
}
