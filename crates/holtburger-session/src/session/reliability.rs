use super::types::{
    ACK_INTERVAL, CONTROL_TIMER_TICK, CachedPacket, MAX_CACHED_PACKETS, MAX_OUTGOING_SEQUENCE_IDS,
    MAX_PENDING_PACKETS, MAX_RETRANSMIT_SEQUENCE_IDS, MAX_RETRANSMIT_SEQUENCE_WINDOW,
    NormalControl, PendingPacket, PendingPacketData, REQUEST_RETRANSMIT_INTERVAL, ReceiveProgress,
    Session,
};
use crate::optional_header::OptionalHeaderCursor;
use anyhow::{Result, anyhow, ensure};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::sequence::is_newer_u32;
use holtburger_protocol::messages::transport::{self, packet_flags};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};
use tokio::time::Instant;

impl Session {
    /// Derive the accepted span without confusing read-ahead with delivered game content.
    pub(crate) fn receive_progress(&self) -> ReceiveProgress {
        let highest = self
            .pending_server_packets
            .keys()
            .copied()
            .max_by_key(|sequence| sequence.wrapping_sub(self.last_server_seq))
            .unwrap_or(self.last_server_seq);
        let mut missing = Vec::new();
        let mut sequence = self.last_server_seq.wrapping_add(1);
        for _ in 0..highest.wrapping_sub(self.last_server_seq) {
            if !self.pending_server_packets.contains_key(&sequence)
                && !self.rejected_server_sequences.contains(&sequence)
            {
                missing.push(sequence);
            }
            sequence = sequence.wrapping_add(1);
        }
        ReceiveProgress { highest, missing }
    }

    /// Admission bounds apply immediately, rather than only when a recovery timer is due.
    pub(crate) fn validate_server_sequence(&self, sequence: u32) -> Result<()> {
        ensure!(
            !is_newer_u32(sequence, self.last_server_seq)
                || sequence.wrapping_sub(self.last_server_seq) <= MAX_RETRANSMIT_SEQUENCE_WINDOW,
            "Abnormal server packet sequence received: expected around {}, got {}",
            self.last_server_seq.wrapping_add(1),
            sequence
        );
        Ok(())
    }

    /// Retail SharedNet::HandleEmptyAck (acclient.c:356127) keeps the connection receiving.
    pub(crate) fn accept_retransmit_rejections(&mut self, sequences: &[u32]) -> Result<()> {
        for &sequence in sequences {
            self.validate_server_sequence(sequence)?;
        }
        log::warn!(
            "Server rejected retransmit for S2C sequences: {:?}; continuing past unavailable packets",
            sequences
        );
        self.rejected_server_sequences
            .extend(sequences.iter().copied().filter(|sequence| {
                is_newer_u32(*sequence, self.last_server_seq)
                    && !self.pending_server_packets.contains_key(sequence)
            }));
        Ok(())
    }

    /// Reserve retention before allocating a new reliable identity or consuming a checksum key.
    pub(crate) fn admit_reliable_send(&self) -> Result<()> {
        ensure!(
            self.pending_packets.len() < MAX_PENDING_PACKETS,
            "Outgoing packet queue capacity exhausted ({MAX_PENDING_PACKETS} packets)"
        );
        let reserved = self
            .pending_packets
            .iter()
            .filter(|packet| matches!(packet.data, PendingPacketData::Reliable(_)))
            .count();
        // RETAIL DIVERGENCE: acclient.c:362032 retains originals until ACK eviction (:362149).
        // We bound retention and fail before losing unacknowledged content instead of growing
        // without limit. Correcting this removes the memory bound. Synthetic census covers
        // MAX_CACHED_PACKETS originals plus one; the live capture did not measure cache pressure.
        ensure!(
            self.cached_packets.len() + reserved < MAX_CACHED_PACKETS,
            "Reliable packet cache capacity exhausted ({MAX_CACHED_PACKETS} retained or reserved originals)"
        );
        Ok(())
    }

    pub(crate) fn acknowledge_sequence(&mut self, sequence: u32) -> Result<()> {
        ensure!(
            !is_newer_u32(sequence, self.last_sent_client_sequence),
            "Server acknowledged unsent C2S sequence {} (last sent {})",
            sequence,
            self.last_sent_client_sequence
        );
        // Retail SentPacketStore::Flush (acclient.c:362149) retains the boundary packet.
        self.cached_packets
            .retain(|cached, _| !is_newer_u32(sequence, *cached));
        Ok(())
    }

    pub(crate) fn current_client_sequence(&self) -> u32 {
        self.last_sent_client_sequence
    }

    fn has_pending_normal_control(&self) -> bool {
        self.pending_packets
            .iter()
            .any(|packet| matches!(packet.data, PendingPacketData::Normal(_)))
    }

    /// Reception and scheduling share eligibility; idle timer rounding must not delay ingress.
    fn due_normal_control(&self, now: Instant) -> Option<NormalControl> {
        let last = self.last_control_scheduled?;
        if self.has_pending_normal_control() {
            return None;
        }
        let progress = self.receive_progress();
        if !progress.missing.is_empty() {
            (now.duration_since(last) > REQUEST_RETRANSMIT_INTERVAL).then_some(NormalControl::Nak)
        } else {
            (self.has_server_seq && now.duration_since(last) >= ACK_INTERVAL)
                .then_some(NormalControl::Ack(progress.highest))
        }
    }

    /// One clock chooses either NAKs or PAKs, after the bounded ingress pass.
    pub(crate) fn schedule_normal_control(&mut self, now: Instant) -> Result<()> {
        if let Some(control) = self.due_normal_control(now) {
            self.enqueue_packet(PendingPacket {
                addr: self.server_addr,
                ready_at: now,
                data: PendingPacketData::Normal(control),
            })?;
            self.last_control_scheduled = Some(now);
        }
        Ok(())
    }

    pub(crate) fn next_reliability_deadline(&self) -> Option<Instant> {
        let last = self.last_control_scheduled?;
        if self.has_pending_normal_control() {
            return None;
        }
        if !self.receive_progress().missing.is_empty() {
            // Strict retail > comparison: waking at equality must not spin on the same deadline.
            Some(last + REQUEST_RETRANSMIT_INTERVAL + CONTROL_TIMER_TICK)
        } else if self.has_server_seq {
            Some(last + ACK_INTERVAL)
        } else {
            None
        }
    }

    /// Read before scheduling or retrying control work, even when delivery has a ready backlog.
    pub(crate) fn normal_control_needs_ingress(&self, now: Instant) -> bool {
        self.has_pending_normal_control() || self.due_normal_control(now).is_some()
    }
    pub(crate) fn read_ack_sequence(&self, flags: u32, data: &[u8]) -> Option<u32> {
        let offset =
            OptionalHeaderCursor::new(data, flags).find_flag_offset(packet_flags::ACK_SEQUENCE)?;
        (offset + transport::ACK_SEQUENCE_SIZE <= data.len())
            .then(|| LittleEndian::read_u32(&data[offset..offset + transport::ACK_SEQUENCE_SIZE]))
    }

    pub(crate) fn read_sequence_list(
        &self,
        flags: u32,
        data: &[u8],
        flag: u32,
    ) -> Option<Vec<u32>> {
        let offset = OptionalHeaderCursor::new(data, flags).find_flag_offset(flag)?;
        if offset + 4 > data.len() {
            return None;
        }

        let count = LittleEndian::read_u32(&data[offset..offset + 4]) as usize;
        if count > MAX_RETRANSMIT_SEQUENCE_IDS {
            return None;
        }
        let values_offset = offset + 4;
        let values_len = count.checked_mul(4)?;
        if values_offset + values_len > data.len() {
            return None;
        }

        let mut sequences = Vec::with_capacity(count);
        for index in 0..count {
            let start = values_offset + (index * 4);
            sequences.push(LittleEndian::read_u32(&data[start..start + 4]));
        }
        Some(sequences)
    }

    pub(crate) fn retransmit_sequences(&mut self, sequences: &[u32]) -> Result<()> {
        let mut unavailable = Vec::new();
        let mut seen = std::collections::BTreeSet::new();
        for &sequence in sequences {
            if !seen.insert(sequence) {
                continue;
            }
            if self.pending_packets.iter().any(|packet| {
                matches!(&packet.data,
                PendingPacketData::Prebuilt(bytes) if LittleEndian::read_u32(bytes) == sequence
                    && LittleEndian::read_u32(&bytes[4..8]) & packet_flags::RETRANSMISSION != 0)
            }) {
                continue;
            }
            if let Some(cached) = self.cached_packets.get(&sequence) {
                let bytes = self.build_retransmission_packet(&cached.bytes)?;
                self.enqueue_packet(PendingPacket {
                    addr: cached.addr,
                    ready_at: Instant::now(),
                    data: PendingPacketData::Prebuilt(bytes),
                })?;
            } else if !self.pending_packets.iter().any(|packet| {
                matches!(&packet.data, PendingPacketData::Reliable(bytes)
                    if LittleEndian::read_u32(bytes) == sequence)
            }) {
                unavailable.push(sequence);
            }
        }
        for chunk in unavailable.chunks(MAX_OUTGOING_SEQUENCE_IDS) {
            log::warn!(
                "Server requested unavailable C2S sequences {:?}; responding with rejection",
                chunk
            );
            // Retail TransmitNaks (acclient.c:359526) sends disposable, cleartext rejections.
            // ACE parses these but has no consumer that releases its C2S delivery hole.
            self.queue_cleartext_control(
                packet_flags::REJECT_RETRANSMIT,
                Self::pack_sequence_list(chunk),
            )?;
        }
        Ok(())
    }

    pub(crate) fn pack_sequence_list(sequences: &[u32]) -> Vec<u8> {
        let mut payload = Vec::with_capacity(4 + sequences.len() * 4);
        payload.extend_from_slice(&(sequences.len() as u32).to_le_bytes());
        for sequence in sequences {
            payload.extend_from_slice(&sequence.to_le_bytes());
        }
        payload
    }

    /// Retain reliable content, not disposable controls, with its original checksum key.
    pub(crate) fn retained_packet(&self, packet: &[u8]) -> Result<Vec<u8>> {
        self.rebuild_retained_packet(packet, false)
    }

    pub(crate) fn build_retransmission_packet(&self, packet: &[u8]) -> Result<Vec<u8>> {
        self.rebuild_retained_packet(packet, true)
    }

    fn rebuild_retained_packet(&self, packet: &[u8], retransmission: bool) -> Result<Vec<u8>> {
        let mut offset = 0;
        let mut header = PacketHeader::unpack(packet, &mut offset)
            .ok_or_else(|| anyhow!("Failed to unpack retained packet header"))?;
        let payload = &packet[transport::HEADER_SIZE..];
        let key = if header.flags & packet_flags::ENCRYPTED_CHECKSUM != 0 {
            Some(
                self.calculate_payload_hash(header.flags, payload)?
                    ^ header.checksum.wrapping_sub(header.calculate_checksum()),
            )
        } else {
            None
        };
        let mut ranges = Vec::new();
        let cursor = OptionalHeaderCursor::new(payload, header.flags);
        let disposable = packet_flags::ACK_SEQUENCE
            | packet_flags::REQUEST_RETRANSMIT
            | packet_flags::REJECT_RETRANSMIT;
        for flag in [
            packet_flags::REQUEST_RETRANSMIT,
            packet_flags::REJECT_RETRANSMIT,
            packet_flags::ACK_SEQUENCE,
        ] {
            if header.flags & flag == 0 {
                continue;
            }
            let start = cursor
                .find_flag_offset(flag)
                .ok_or_else(|| anyhow!("Missing disposable optional header offset"))?;
            let size = if flag == packet_flags::ACK_SEQUENCE {
                4
            } else {
                ensure!(
                    start + 4 <= payload.len(),
                    "Truncated retained sequence-list count"
                );
                4 + (LittleEndian::read_u32(&payload[start..start + 4]) as usize) * 4
            };
            ensure!(
                start + size <= payload.len(),
                "Truncated retained optional header"
            );
            ranges.push(start..start + size);
        }
        let mut retained = payload.to_vec();
        for range in ranges.into_iter().rev() {
            retained.drain(range);
        }
        header.flags &= !disposable;
        if retransmission {
            header.flags |= packet_flags::RETRANSMISSION;
        }
        header.size = retained.len() as u16;
        let hash = self.calculate_payload_hash(header.flags, &retained)?;
        header.checksum = header.calculate_checksum().wrapping_add(match key {
            Some(key) => hash ^ key,
            None => hash,
        });
        let mut bytes = Vec::with_capacity(transport::HEADER_SIZE + retained.len());
        header.pack(&mut bytes);
        bytes.extend_from_slice(&retained);
        Ok(bytes)
    }

    pub(crate) fn cache_sent_original(
        &mut self,
        bytes: &[u8],
        addr: std::net::SocketAddr,
    ) -> Result<()> {
        let retained = self.retained_packet(bytes)?;
        self.cached_packets.insert(
            LittleEndian::read_u32(bytes),
            CachedPacket {
                addr,
                bytes: retained,
            },
        );
        Ok(())
    }
}
