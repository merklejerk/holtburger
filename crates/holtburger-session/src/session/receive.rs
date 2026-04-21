use super::types::{ReceivedPacket, Session, SessionEvent};
use crate::capture::Direction;
use crate::optional_header::OptionalHeaderCursor;
use anyhow::{Result, anyhow};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::sequence::is_newer_u32;
use holtburger_protocol::messages::transport::{self, packet_flags};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::ProtocolUnpack;
use std::time::Instant;

impl Session {
    async fn recv_raw_packet_with_addr(
        &mut self,
        buf: &mut [u8],
    ) -> Result<(PacketHeader, Vec<u8>, std::net::SocketAddr)> {
        loop {
            let (len, addr) = self.transport.recv_from(buf).await?;

            let expected_addr = self.server_source_addr;
            let pending_addr = self.pending_server_source_addr;
            let addr_allowed =
                addr == expected_addr || pending_addr.is_some_and(|candidate| addr == candidate);

            if !addr_allowed {
                if let Some(candidate) = pending_addr {
                    log::warn!(
                        "Ignoring inbound packet from unexpected source {}; expected {} or {}",
                        addr,
                        expected_addr,
                        candidate
                    );
                } else {
                    log::warn!(
                        "Ignoring inbound packet from unexpected source {}; expected {}",
                        addr,
                        expected_addr
                    );
                }
                continue;
            }

            if pending_addr.is_some_and(|candidate| addr == candidate) {
                log::debug!(
                    "Inbound packet confirmed activation source {}; switching expected source from {}",
                    addr,
                    expected_addr
                );
                self.server_source_addr = addr;
                self.pending_server_source_addr = None;
            }

            if len < transport::HEADER_SIZE {
                return Err(anyhow!("Packet too short"));
            }

            self.bytes_in = self.bytes_in.wrapping_add(len as u64);
            self.last_recv_time = std::time::Instant::now();

            if let Some(ref mut capture) = self.capture {
                let _ = capture.write_entry(Direction::Inbound, addr, &buf[..len]);
            }

            let mut offset = 0;
            let header = PacketHeader::unpack(&buf[..transport::HEADER_SIZE], &mut offset)
                .ok_or_else(|| anyhow!("Failed to unpack packet header"))?;
            let data = buf[transport::HEADER_SIZE..len].to_vec();

            log::trace!(
                "<<< Inbound from {}: Seq={} ID={} Flags={:X} Size={} Hex: {:02X?}",
                addr,
                header.sequence,
                header.id,
                header.flags,
                len,
                &buf[..len]
            );

            return Ok((header, data, addr));
        }
    }

    async fn recv_packet_with_addr(
        &mut self,
        buf: &mut [u8],
    ) -> Result<(PacketHeader, Vec<u8>, std::net::SocketAddr)> {
        let (header, data, addr) = self.recv_raw_packet_with_addr(buf).await?;

        if (header.flags & packet_flags::ACK_SEQUENCE) != 0
            && let Some(sequence) = self.read_ack_sequence(header.flags, &data)
        {
            self.acknowledge_sequence(sequence);
        }

        if (header.flags & packet_flags::REQUEST_RETRANSMIT) != 0
            && let Some(sequences) =
                self.read_sequence_list(header.flags, &data, packet_flags::REQUEST_RETRANSMIT)
        {
            self.retransmit_sequences(&sequences)?;
        }

        if (header.flags & packet_flags::REJECT_RETRANSMIT) != 0
            && let Some(sequences) =
                self.read_sequence_list(header.flags, &data, packet_flags::REJECT_RETRANSMIT)
        {
            log::warn!(
                "Server rejected retransmit for S2C sequences: {:?}",
                sequences
            );
        }

        if header.flags & packet_flags::ENCRYPTED_CHECKSUM != 0
            && let Some(isaac) = self.isaac_s2c.as_mut()
        {
            isaac.consume_key();
        }

        Ok((header, data, addr))
    }

    fn process_received_packet_metadata(
        &mut self,
        header: &PacketHeader,
        data: &[u8],
    ) -> Result<()> {
        if (header.flags & packet_flags::ACK_SEQUENCE) != 0
            && let Some(sequence) = self.read_ack_sequence(header.flags, data)
        {
            self.acknowledge_sequence(sequence);
        }

        if (header.flags & packet_flags::REQUEST_RETRANSMIT) != 0
            && let Some(sequences) =
                self.read_sequence_list(header.flags, data, packet_flags::REQUEST_RETRANSMIT)
        {
            self.retransmit_sequences(&sequences)?;
        }

        if (header.flags & packet_flags::REJECT_RETRANSMIT) != 0
            && let Some(sequences) =
                self.read_sequence_list(header.flags, data, packet_flags::REJECT_RETRANSMIT)
        {
            log::warn!(
                "Server rejected retransmit for S2C sequences: {:?}",
                sequences
            );
        }

        Ok(())
    }

    fn validate_received_packet_checksum(
        &mut self,
        header: &PacketHeader,
        data: &[u8],
    ) -> Result<bool> {
        let header_checksum = header.calculate_checksum();
        let payload_checksum = match self.calculate_payload_hash(header.flags, data) {
            Ok(checksum) => checksum,
            Err(err) => {
                log::debug!(
                    "Inbound packet checksum failed while hashing payload: Seq={} ID={} Flags={:X}: {}",
                    header.sequence,
                    header.id,
                    header.flags,
                    err
                );
                return Ok(false);
            }
        };

        if header.flags & packet_flags::ENCRYPTED_CHECKSUM != 0 {
            let Some(isaac) = self.isaac_s2c.as_mut() else {
                log::warn!(
                    "Inbound encrypted packet received before S2C ISAAC was initialized: Seq={} ID={} Flags={:X}",
                    header.sequence,
                    header.id,
                    header.flags
                );
                return Ok(false);
            };

            let key = header.checksum.wrapping_sub(header_checksum) ^ payload_checksum;
            if isaac.search(key) {
                isaac.consume_key_value(key);
                return Ok(true);
            }
        } else if header_checksum.wrapping_add(payload_checksum) == header.checksum {
            return Ok(true);
        }

        log::debug!(
            "Inbound packet checksum failed: Seq={} ID={} Flags={:X} Checksum={:08X}",
            header.sequence,
            header.id,
            header.flags,
            header.checksum,
        );
        Ok(false)
    }

    pub async fn recv_packet(&mut self, buf: &mut [u8]) -> Result<(PacketHeader, Vec<u8>)> {
        let (header, data, _) = self.recv_packet_with_addr(buf).await?;
        Ok((header, data))
    }

    fn should_order_server_packet(&self, header: &PacketHeader) -> bool {
        header.flags != packet_flags::ACK_SEQUENCE
            && (header.sequence != 0 || (header.flags & packet_flags::BLOB_FRAGMENTS) != 0)
    }

    fn next_expected_server_sequence(&self) -> u32 {
        self.last_server_seq.wrapping_add(1)
    }

    fn take_pending_server_packet(&mut self) -> Option<ReceivedPacket> {
        let expected = self.next_expected_server_sequence();
        self.pending_server_packets.remove(&expected)
    }

    fn finalize_ordered_server_packet(&mut self, packet: &ReceivedPacket) -> Result<()> {
        if self.should_order_server_packet(&packet.header) {
            self.last_server_seq = packet.header.sequence;
            self.has_server_seq = true;
        }

        if packet.header.sequence > 0 && packet.header.flags != packet_flags::ACK_SEQUENCE {
            self.queue_ack(packet.header.sequence)?;
        }

        if packet.header.flags & packet_flags::ECHO_REQUEST != 0 {
            let mut resp = packet.header.clone();
            resp.flags = packet_flags::ECHO_RESPONSE;
            self.queue_packet_to_addr(resp, &[], self.server_addr, Instant::now())?;
        }

        Ok(())
    }

    async fn recv_ordered_packet(&mut self) -> Result<ReceivedPacket> {
        loop {
            if let Some(packet) = self.take_pending_server_packet() {
                self.finalize_ordered_server_packet(&packet)?;
                return Ok(packet);
            }

            if self.flush_pending_control_packets().await? {
                continue;
            }

            if let Some(deadline) = self.next_pending_control_deadline() {
                tokio::select! {
                    _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => {
                        continue;
                    }
                    result = async {
                        let mut buf = [0u8; 1024 * 128];
                        self.recv_raw_packet_with_addr(&mut buf).await
                    } => {
                        let (header, data, _) = result?;

                        if !self.validate_received_packet_checksum(&header, &data)? {
                            continue;
                        }

                        self.process_received_packet_metadata(&header, &data)?;

                        let packet = ReceivedPacket { header, data };

                        if !self.should_order_server_packet(&packet.header) {
                            self.finalize_ordered_server_packet(&packet)?;
                            return Ok(packet);
                        }

                        let received_sequence = packet.header.sequence;
                        let expected = self.next_expected_server_sequence();
                        if !is_newer_u32(received_sequence, self.last_server_seq) {
                            log::debug!(
                                "Server packet {} received again; last ordered sequence is {}",
                                received_sequence,
                                self.last_server_seq
                            );
                            continue;
                        }

                        if received_sequence != expected {
                            if !is_newer_u32(received_sequence, expected) {
                                log::debug!(
                                    "Server packet {} is newer than {} but not the expected sequence {}",
                                    received_sequence,
                                    self.last_server_seq,
                                    expected
                                );
                                continue;
                            }

                            self.pending_server_packets
                                .entry(received_sequence)
                                .or_insert(packet);

                            if self.should_request_retransmit(expected, received_sequence) {
                                self.send_request_retransmit(received_sequence)?;
                            }
                            continue;
                        }

                        self.finalize_ordered_server_packet(&packet)?;
                        return Ok(packet);
                    }
                }
            }

            let mut buf = [0u8; 1024 * 128];
            let (header, data, _) = self.recv_raw_packet_with_addr(&mut buf).await?;

            if !self.validate_received_packet_checksum(&header, &data)? {
                continue;
            }

            self.process_received_packet_metadata(&header, &data)?;

            let packet = ReceivedPacket { header, data };

            if !self.should_order_server_packet(&packet.header) {
                self.finalize_ordered_server_packet(&packet)?;
                return Ok(packet);
            }

            let received_sequence = packet.header.sequence;
            let expected = self.next_expected_server_sequence();
            if !is_newer_u32(received_sequence, self.last_server_seq) {
                log::debug!(
                    "Server packet {} received again; last ordered sequence is {}",
                    received_sequence,
                    self.last_server_seq
                );
                continue;
            }

            if received_sequence != expected {
                if !is_newer_u32(received_sequence, expected) {
                    log::debug!(
                        "Server packet {} is newer than {} but not the expected sequence {}",
                        received_sequence,
                        self.last_server_seq,
                        expected
                    );
                    continue;
                }

                self.pending_server_packets
                    .entry(received_sequence)
                    .or_insert(packet);

                if self.should_request_retransmit(expected, received_sequence) {
                    self.send_request_retransmit(received_sequence)?;
                }
                continue;
            }

            self.finalize_ordered_server_packet(&packet)?;
            return Ok(packet);
        }
    }

    pub fn get_payload_offset(&self, flags: u32, data: &[u8]) -> usize {
        OptionalHeaderCursor::new(data, flags).payload_offset()
    }

    pub async fn recv_message(&mut self) -> Result<Vec<SessionEvent>> {
        let packet = self.recv_ordered_packet().await?;
        let header = packet.header;
        let data = packet.data;
        let mut events = Vec::new();

        if header.flags & packet_flags::CONNECT_REQUEST != 0 {
            let mut offset = self.get_payload_offset(header.flags, &data);
            if offset + transport::CONNECT_REQUEST_SIZE <= data.len() {
                let crd = ConnectRequestData::unpack(&data, &mut offset)
                    .ok_or_else(|| anyhow!("Failed to unpack connect request"))?;
                let server_time = self.handle_handshake_request(crd)?;
                events.push(SessionEvent::TimeSync(server_time));
            }
        }

        if header.flags & packet_flags::CONNECT_RESPONSE != 0
            && let Some(offset) = OptionalHeaderCursor::new(&data, header.flags)
                .find_flag_offset(packet_flags::CONNECT_RESPONSE)
                .filter(|&offset| offset + transport::CONNECT_RESPONSE_SIZE <= data.len())
        {
            let cookie =
                LittleEndian::read_u64(&data[offset..offset + transport::CONNECT_RESPONSE_SIZE]);
            self.handle_handshake_response(cookie, header.id);
        }

        if header.flags & packet_flags::TIME_SYNC != 0
            && let Some(offset) = OptionalHeaderCursor::new(&data, header.flags)
                .find_flag_offset(packet_flags::TIME_SYNC)
                .filter(|&offset| offset + 8 <= data.len())
        {
            let server_time = LittleEndian::read_f64(&data[offset..offset + 8]);
            events.push(SessionEvent::TimeSync(server_time));
        }

        if header.flags & packet_flags::BLOB_FRAGMENTS != 0 {
            let mut offset = self.get_payload_offset(header.flags, &data);
            while offset + transport::FRAGMENT_HEADER_SIZE <= data.len() {
                let frag_header = FragmentHeader::unpack(&data, &mut offset)
                    .ok_or_else(|| anyhow!("Failed to unpack fragment header"))?;
                let frag_data_size =
                    (frag_header.size as usize).saturating_sub(transport::FRAGMENT_HEADER_SIZE);

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
