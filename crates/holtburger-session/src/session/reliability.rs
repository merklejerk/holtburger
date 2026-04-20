use super::types::{
    CachedPacket, MAX_CACHED_PACKETS, MAX_RETRANSMIT_SEQUENCE_IDS, MAX_RETRANSMIT_SEQUENCE_WINDOW,
    REQUEST_RETRANSMIT_INTERVAL, Session,
};
use crate::optional_header::OptionalHeaderCursor;
use anyhow::{Result, anyhow};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::sequence::is_newer_u32;
use holtburger_protocol::messages::transport::{self, packet_flags};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::{ProtocolPack, ProtocolUnpack};
use std::time::Instant;

impl Session {
    pub(crate) fn maybe_cache_packet(
        &mut self,
        header: &PacketHeader,
        packet: &[u8],
        addr: std::net::SocketAddr,
    ) {
        if header.sequence < 2 || (header.flags & packet_flags::REQUEST_RETRANSMIT) != 0 {
            return;
        }

        self.cached_packets
            .entry(header.sequence)
            .or_insert(CachedPacket {
                addr,
                bytes: packet.to_vec(),
            });

        while self.cached_packets.len() > MAX_CACHED_PACKETS {
            let Some((&oldest_sequence, _)) = self.cached_packets.first_key_value() else {
                break;
            };
            self.cached_packets.remove(&oldest_sequence);
        }
    }

    pub(crate) fn acknowledge_sequence(&mut self, sequence: u32) {
        self.cached_packets
            .retain(|cached_sequence, _| *cached_sequence >= sequence);
    }

    pub(crate) fn current_client_sequence(&self) -> u32 {
        self.packet_sequence.saturating_sub(1)
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
        for sequence in sequences {
            let Some(cached_packet) = self.cached_packets.get(sequence).cloned() else {
                log::warn!(
                    "Server requested retransmit for uncached C2S packet {}",
                    sequence
                );
                continue;
            };

            log::debug!("Retransmitting cached C2S packet {}", sequence);
            let retransmission_packet = self.build_retransmission_packet(&cached_packet.bytes)?;
            self.queue_prebuilt_control_packet(
                retransmission_packet,
                cached_packet.addr,
                Instant::now(),
            );
        }

        Ok(())
    }

    pub(crate) fn build_retransmission_packet(&self, packet: &[u8]) -> Result<Vec<u8>> {
        let mut offset = 0;
        let mut header = PacketHeader::unpack(packet, &mut offset)
            .ok_or_else(|| anyhow!("Failed to unpack cached packet header"))?;
        let payload = &packet[transport::HEADER_SIZE..];
        let was_encrypted = (header.flags & packet_flags::ENCRYPTED_CHECKSUM) != 0;
        let original_header_hash = header.calculate_checksum();
        let payload_hash = self.calculate_payload_hash(header.flags, payload)?;
        let isaac_key = if was_encrypted {
            Some(payload_hash ^ header.checksum.wrapping_sub(original_header_hash))
        } else {
            None
        };

        header.flags |= packet_flags::RETRANSMISSION;
        let new_header_hash = header.calculate_checksum();
        header.checksum = if let Some(isaac_key) = isaac_key {
            new_header_hash.wrapping_add(payload_hash ^ isaac_key)
        } else {
            new_header_hash.wrapping_add(payload_hash)
        };

        let mut retransmission_packet = Vec::with_capacity(packet.len());
        header.pack(&mut retransmission_packet);
        retransmission_packet.extend_from_slice(payload);
        Ok(retransmission_packet)
    }

    pub(crate) fn send_request_retransmit(&mut self, received_sequence: u32) -> Result<()> {
        let desired_sequence = self.last_server_seq.wrapping_add(1);
        let bottom = desired_sequence.wrapping_add(1);
        let missing_span = received_sequence.wrapping_sub(desired_sequence);

        if !is_newer_u32(received_sequence, desired_sequence)
            || missing_span > MAX_RETRANSMIT_SEQUENCE_WINDOW + 1
        {
            return Err(anyhow!(
                "Abnormal server packet sequence received: expected around {}, got {}",
                desired_sequence,
                received_sequence
            ));
        }

        let mut needed_sequences = Vec::with_capacity(MAX_RETRANSMIT_SEQUENCE_IDS);
        needed_sequences.push(desired_sequence);
        let mut sequence = bottom;
        while sequence != received_sequence {
            if !self.pending_server_packets.contains_key(&sequence) {
                needed_sequences.push(sequence);
                if needed_sequences.len() >= MAX_RETRANSMIT_SEQUENCE_IDS {
                    break;
                }
            }
            sequence = sequence.wrapping_add(1);
        }

        let mut payload = Vec::with_capacity(4 + (needed_sequences.len() * 4));
        payload.extend_from_slice(&(needed_sequences.len() as u32).to_le_bytes());
        for sequence in &needed_sequences {
            payload.extend_from_slice(&sequence.to_le_bytes());
        }

        log::debug!(
            "Requesting retransmit of S2C packets {:?}",
            needed_sequences
        );
        self.queue_deferred_cleartext_control_packet(
            PacketHeader {
                flags: packet_flags::REQUEST_RETRANSMIT,
                id: self.client_id,
                ..Default::default()
            },
            &payload,
            self.server_addr,
            Instant::now(),
            true,
        )?;
        self.last_request_retransmit_time = Some(Instant::now());
        Ok(())
    }

    pub(crate) fn should_request_retransmit(&self, expected: u32, received_sequence: u32) -> bool {
        is_newer_u32(received_sequence, expected)
            && self
                .last_request_retransmit_time
                .is_none_or(|last_request| {
                    Instant::now().duration_since(last_request) > REQUEST_RETRANSMIT_INTERVAL
                })
    }
}
