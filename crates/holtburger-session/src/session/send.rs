use super::types::{
    MAX_OUTGOING_SEQUENCE_IDS, MAX_PENDING_PACKETS, NormalControl, PendingMessage, PendingPacket,
    PendingPacketData, RECEIVE_BATCH_LIMIT, Session,
};
use crate::capture::Direction;
use crate::optional_header::OptionalHeaderCursor;
use anyhow::{Result, anyhow, ensure};
use futures::FutureExt;
use holtburger_protocol::messages::transport::{self, packet_flags, queues};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};
use tokio::time::Instant;

/// A write attempt borrows no mutable session state across the socket await.
pub(crate) struct WireSend {
    /// Outbox slot stays unchanged until this attempt commits or is cancelled by another event.
    pub(crate) index: usize,
    /// Socket peer copied from the retained operation.
    pub(crate) addr: std::net::SocketAddr,
    /// Complete attempt bytes; reliable identity/key allocation happened before this snapshot.
    pub(crate) bytes: Vec<u8>,
}

impl Session {
    pub(crate) fn enqueue_packet(&mut self, packet: PendingPacket) -> Result<()> {
        ensure!(
            self.pending_packets.len() < MAX_PENDING_PACKETS,
            "Outgoing packet queue capacity exhausted ({MAX_PENDING_PACKETS} packets)"
        );
        self.pending_packets.push_back(packet);
        Ok(())
    }
    pub(crate) fn calculate_payload_hash(&self, flags: u32, payload: &[u8]) -> Result<u32> {
        let mut total_payload_checksum: u32 = 0;

        let cursor = OptionalHeaderCursor::new(payload, flags);
        let header_optional_bytes = cursor.hash_bytes()?;

        if !header_optional_bytes.is_empty() {
            let h = holtburger_protocol::crypto::Hash32::compute(&header_optional_bytes);
            total_payload_checksum = total_payload_checksum.wrapping_add(h);
        }

        if flags & packet_flags::BLOB_FRAGMENTS != 0 {
            let mut offset = cursor.payload_offset();
            while offset < payload.len() {
                if offset + transport::FRAGMENT_HEADER_SIZE > payload.len() {
                    return Err(anyhow!("Truncated fragment header while hashing payload"));
                }
                let h_start = offset;
                let frag_header = FragmentHeader::unpack(payload, &mut offset)
                    .ok_or_else(|| anyhow!("Failed to unpack fragment header"))?;
                let hh = holtburger_protocol::crypto::Hash32::compute(&payload[h_start..offset]);
                total_payload_checksum = total_payload_checksum.wrapping_add(hh);

                ensure!(
                    usize::from(frag_header.size) >= transport::FRAGMENT_HEADER_SIZE,
                    "Fragment size is shorter than its header"
                );
                ensure!(frag_header.count > 0, "Fragment count is zero");
                ensure!(
                    frag_header.index < frag_header.count,
                    "Fragment index is outside its declared count"
                );
                let frag_data_size =
                    usize::from(frag_header.size) - transport::FRAGMENT_HEADER_SIZE;

                if frag_data_size > 0 {
                    if offset + frag_data_size > payload.len() {
                        return Err(anyhow!("Truncated fragment data while hashing payload"));
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

    pub(crate) fn build_cleartext_packet(
        &self,
        mut header: PacketHeader,
        payload: &[u8],
    ) -> Result<Vec<u8>> {
        ensure!(
            payload.len() + transport::HEADER_SIZE <= transport::MAX_PACKET_SIZE,
            "Outgoing packet exceeds transport size limit"
        );
        header.size = payload.len() as u16;
        header.checksum = header
            .calculate_checksum()
            .wrapping_add(self.calculate_payload_hash(header.flags, payload)?);
        let mut packet = Vec::with_capacity(transport::HEADER_SIZE + payload.len());
        header.pack(&mut packet);
        packet.extend_from_slice(payload);
        Ok(packet)
    }

    pub(crate) fn queue_cleartext_control(&mut self, flags: u32, payload: Vec<u8>) -> Result<()> {
        self.enqueue_packet(PendingPacket {
            addr: self.server_addr,
            ready_at: Instant::now(),
            data: PendingPacketData::Cleartext {
                header: PacketHeader {
                    flags,
                    id: self.client_id,
                    ..Default::default()
                },
                payload,
            },
        })
    }

    pub(crate) fn queue_handshake(
        &mut self,
        header: PacketHeader,
        payload: &[u8],
        addr: std::net::SocketAddr,
        ready_at: Instant,
    ) -> Result<()> {
        let bytes = self.build_cleartext_packet(header, payload)?;
        self.enqueue_packet(PendingPacket {
            addr,
            ready_at,
            data: PendingPacketData::Prebuilt(bytes),
        })
    }

    /// Compile disposable intent only when attempting a write; cancelled futures retain its owner.
    pub(crate) fn next_wire_send(&mut self, now: Instant) -> Result<Option<WireSend>> {
        loop {
            let Some(index) = self
                .pending_packets
                .iter()
                .position(|packet| packet.ready_at <= now)
            else {
                return Ok(None);
            };
            let pending = &self.pending_packets[index];
            let bytes = match &pending.data {
                PendingPacketData::Reliable(bytes) | PendingPacketData::Prebuilt(bytes) => {
                    bytes.clone()
                }
                PendingPacketData::Cleartext { header, payload } => {
                    let mut header = header.clone();
                    header.sequence = self.current_client_sequence();
                    self.build_cleartext_packet(header, payload)?
                }
                PendingPacketData::Normal(control) => {
                    let (flags, payload) = match control {
                        NormalControl::Ack(sequence) => {
                            (packet_flags::ACK_SEQUENCE, sequence.to_le_bytes().to_vec())
                        }
                        NormalControl::Nak => {
                            let progress = self.receive_progress();
                            if progress.missing.is_empty() {
                                self.pending_packets.remove(index);
                                continue;
                            }
                            let count = progress.missing.len().min(MAX_OUTGOING_SEQUENCE_IDS);
                            log::debug!(
                                "Requesting retransmit of S2C packets {:?}",
                                &progress.missing[..count]
                            );
                            (
                                packet_flags::REQUEST_RETRANSMIT,
                                Self::pack_sequence_list(&progress.missing[..count]),
                            )
                        }
                    };
                    self.build_cleartext_packet(
                        PacketHeader {
                            flags,
                            sequence: self.current_client_sequence(),
                            id: self.client_id,
                            ..Default::default()
                        },
                        &payload,
                    )?
                }
            };
            return Ok(Some(WireSend {
                index,
                addr: pending.addr,
                bytes,
            }));
        }
    }

    /// Commit successful UDP writes synchronously before another cancellation point.
    pub(crate) fn commit_wire_send(&mut self, wire: WireSend, len: usize) -> Result<()> {
        ensure!(
            len == wire.bytes.len(),
            "Short UDP write: sent {} of {} bytes",
            len,
            wire.bytes.len()
        );
        let mut offset = 0;
        let header = PacketHeader::unpack(&wire.bytes, &mut offset)
            .ok_or_else(|| anyhow!("Prepared packet header is invalid"))?;
        let pending = self
            .pending_packets
            .remove(wire.index)
            .ok_or_else(|| anyhow!("Prepared packet disappeared before send commit"))?;
        if matches!(pending.data, PendingPacketData::Reliable(_)) {
            self.cache_sent_original(&wire.bytes, wire.addr)?;
            self.last_sent_client_sequence = header.sequence;
        } else if header.flags & packet_flags::CONNECT_RESPONSE != 0
            && self.last_sent_client_sequence == 0
        {
            // A repeated handshake ACK keeps its stamp 1 without rewinding later game traffic.
            self.last_sent_client_sequence = header.sequence;
        }
        log::trace!(
            ">>> Outbound to {}: Seq={} ID={} Flags={:X} Size={} Hex: {:02X?}",
            wire.addr,
            header.sequence,
            header.id,
            header.flags,
            len,
            wire.bytes
        );
        self.bytes_out = self.bytes_out.wrapping_add(len as u64);
        self.last_send_time = std::time::Instant::now();
        self.sent_packets.record(&header);
        if let Some(capture) = &mut self.capture {
            capture.write_entry(Direction::Outbound, wire.addr, &wire.bytes)?;
        }
        Ok(())
    }

    pub(crate) async fn flush_ready_packets(&mut self) -> Result<()> {
        for _ in 0..RECEIVE_BATCH_LIMIT {
            let Some(wire) = self.next_wire_send(Instant::now())? else {
                break;
            };
            let Some(result) = self
                .transport
                .send_to(&wire.bytes, wire.addr)
                .now_or_never()
            else {
                break;
            };
            self.commit_wire_send(wire, result?)?;
        }
        Ok(())
    }

    pub(crate) fn next_session_deadline(&self, now: Instant) -> Option<Instant> {
        self.pending_packets
            .iter()
            .map(|packet| packet.ready_at)
            .filter(|ready| *ready > now)
            .chain(self.next_reliability_deadline())
            .min()
    }

    async fn flush_outbound(&mut self) -> Result<()> {
        while !self.pending_packets.is_empty() {
            self.drain_ready_datagrams().await?;
            self.schedule_normal_control(Instant::now())?;
            self.flush_ready_packets().await?;
            if !self.pending_packets.is_empty() {
                self.wait_for_activity().await?;
                // Ready read/write traffic must not make a large repair backlog monopolize a task.
                tokio::task::yield_now().await;
            }
        }
        Ok(())
    }

    pub(crate) fn prepare_reliable(&mut self, flags: u32, payload: &[u8]) -> Result<()> {
        self.admit_reliable_send()?;
        ensure!(
            payload.len() + transport::HEADER_SIZE <= transport::MAX_PACKET_SIZE,
            "Outgoing reliable packet exceeds transport size limit"
        );
        let mut header = PacketHeader {
            flags,
            sequence: self.packet_sequence,
            id: self.client_id,
            ..Default::default()
        };
        let mut body = Vec::new();
        if payload.len() + transport::HEADER_SIZE + transport::ACK_SEQUENCE_SIZE
            <= transport::MAX_PACKET_SIZE
            && let Some(index) = self.pending_packets.iter().position(|packet| {
                matches!(
                    packet.data,
                    PendingPacketData::Normal(NormalControl::Ack(_))
                )
            })
            && let Some(PendingPacket {
                data: PendingPacketData::Normal(NormalControl::Ack(sequence)),
                ..
            }) = self.pending_packets.remove(index)
        {
            header.flags |= packet_flags::ACK_SEQUENCE;
            body.extend_from_slice(&sequence.to_le_bytes());
        }
        body.extend_from_slice(payload);
        header.size = body.len() as u16;
        let hash = self.calculate_payload_hash(header.flags, &body)?;
        header.checksum = if let Some(isaac) = &mut self.isaac_c2s {
            header.flags |= packet_flags::ENCRYPTED_CHECKSUM;
            let key = isaac.current_key;
            isaac.consume_key();
            header.calculate_checksum().wrapping_add(hash ^ key)
        } else {
            header.calculate_checksum().wrapping_add(hash)
        };
        let mut bytes = Vec::with_capacity(transport::HEADER_SIZE + body.len());
        header.pack(&mut bytes);
        bytes.extend_from_slice(&body);
        self.packet_sequence = header.sequence.wrapping_add(1).max(1);
        self.enqueue_packet(PendingPacket {
            addr: self.server_addr,
            ready_at: Instant::now(),
            data: PendingPacketData::Reliable(bytes),
        })
    }

    /// Transport owns reliable allocation, including the disconnect requested by core.
    pub async fn send_disconnect(&mut self) -> Result<()> {
        self.drain_ready_datagrams().await?;
        self.schedule_normal_control(Instant::now())?;
        self.prepare_reliable(packet_flags::DISCONNECT, &[])?;
        self.flush_outbound().await
    }

    pub async fn send_message(&mut self, message: &GameMessage) -> Result<()> {
        self.drain_ready_datagrams().await?;
        self.schedule_normal_control(Instant::now())?;
        self.prepare_message(message)?;
        self.flush_outbound().await
    }

    /// Message and fragment identities commit with prepared packet ownership, before any await.
    fn prepare_message(&mut self, message: &GameMessage) -> Result<()> {
        let mut payload = Vec::new();
        message.pack(&mut payload);
        ensure!(
            payload.len() + transport::FRAGMENT_HEADER_SIZE + transport::HEADER_SIZE
                <= transport::MAX_PACKET_SIZE,
            "Outgoing message exceeds single-fragment transport size limit"
        );
        let frag_header = FragmentHeader {
            sequence: self.fragment_sequence,
            id: self.fragment_id,
            count: 1,
            index: 0,
            size: (payload.len() + transport::FRAGMENT_HEADER_SIZE) as u16,
            queue: queues::GENERAL,
        };
        let mut body = Vec::with_capacity(transport::FRAGMENT_HEADER_SIZE + payload.len());
        frag_header.pack(&mut body);
        body.extend_from_slice(&payload);
        self.prepare_reliable(packet_flags::BLOB_FRAGMENTS, &body)?;
        self.fragment_sequence = self.fragment_sequence.wrapping_add(1);
        self.fragment_id = self.fragment_id.wrapping_add(1);
        log::debug!(">>> Outgoing Message: {:?}", message);
        Ok(())
    }

    pub async fn send_action(&mut self, action: GameAction) -> Result<()> {
        self.drain_ready_datagrams().await?;
        self.schedule_normal_control(Instant::now())?;
        let sequence = self.game_action_sequence.wrapping_add(1);
        self.prepare_message(&GameMessage::GameAction(Box::new(GameActionMessage {
            sequence,
            action,
        })))?;
        self.game_action_sequence = sequence;
        self.flush_outbound().await
    }

    pub(crate) async fn send_login_packet(
        &mut self,
        header: PacketHeader,
        payload: &[u8],
    ) -> Result<()> {
        let next_sequence = header.sequence.wrapping_add(1);
        self.queue_handshake(header, payload, self.server_addr, Instant::now())?;
        self.packet_sequence = next_sequence;
        self.flush_outbound().await
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
