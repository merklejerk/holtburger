use super::send::WireSend;
use super::types::{
    MAX_BUFFERED_PACKETS, RECEIVE_BATCH_LIMIT, ReceivedPacket, Session, SessionEvent,
};
use crate::capture::Direction;
use crate::optional_header::OptionalHeaderCursor;
use anyhow::{Result, anyhow, ensure};
use byteorder::{ByteOrder, LittleEndian};
use futures::FutureExt;
use holtburger_common::sequence::is_newer_u32;
use holtburger_protocol::messages::transport::{self, packet_flags};
use holtburger_protocol::messages::*;
use holtburger_protocol::traits::ProtocolUnpack;
use tokio::time::Instant;

/// Transport I/O commits exactly one read, write, or timer wake before any further await.
enum Activity {
    Read(usize, std::net::SocketAddr),
    Written(WireSend, usize),
    Deadline,
}

impl Session {
    fn has_ingress_capacity(&self) -> bool {
        self.pending_server_packets.len() + self.pending_transport_events.len()
            < MAX_BUFFERED_PACKETS
    }

    /// One datagram is one budget unit, even if its source or checksum is rejected.
    pub(crate) async fn drain_ready_datagrams(&mut self) -> Result<()> {
        // Connect setup ends this pass before subsequent encrypted datagrams are read.
        for _ in 0..RECEIVE_BATCH_LIMIT {
            if !self.has_ingress_capacity() {
                break;
            }
            let mut buf = [0; transport::MAX_PACKET_SIZE + 1];
            let Some(result) = self.transport.recv_from(&mut buf).now_or_never() else {
                break;
            };
            let (len, addr) = result?;
            if self.accept_datagram(&buf[..len], addr)? {
                break;
            }
        }
        Ok(())
    }

    /// Readiness waits share the transport without holding mutable state in either socket future.
    pub(crate) async fn wait_for_activity(&mut self) -> Result<()> {
        let now = Instant::now();
        let outgoing = self.next_wire_send(now)?;
        let deadline = self.next_session_deadline(now);
        let capacity = self.has_ingress_capacity();
        let mut buf = [0; transport::MAX_PACKET_SIZE + 1];
        let activity = tokio::select! {
            // If read and write readiness arrive together, observe a late original before
            // attempting a request compiled while the socket was blocked.
            biased;
            result = self.transport.recv_from(&mut buf), if capacity => {
                let (len, addr) = result?;
                Activity::Read(len, addr)
            }
            result = async {
                match outgoing {
                    Some(wire) => {
                        let len = self.transport.send_to(&wire.bytes, wire.addr).await?;
                        Ok::<_, anyhow::Error>(Activity::Written(wire, len))
                    }
                    None => std::future::pending().await,
                }
            } => result?,
            _ = async {
                match deadline {
                    Some(deadline) => tokio::time::sleep_until(deadline).await,
                    None => std::future::pending().await,
                }
            } => Activity::Deadline,
        };
        match activity {
            Activity::Read(len, addr) => {
                self.accept_datagram(&buf[..len], addr)?;
            }
            Activity::Written(wire, len) => self.commit_wire_send(wire, len)?,
            Activity::Deadline => {}
        }
        Ok(())
    }

    /// Returns true at a connect barrier: crypto/source setup must precede the next socket read.
    fn accept_datagram(&mut self, packet: &[u8], addr: std::net::SocketAddr) -> Result<bool> {
        let addr_allowed =
            addr == self.server_source_addr || self.pending_server_source_addr == Some(addr);
        if !addr_allowed {
            log::warn!(
                "Ignoring inbound packet from unexpected source {}; expected {} or {:?}",
                addr,
                self.server_source_addr,
                self.pending_server_source_addr
            );
            return Ok(false);
        }
        ensure!(packet.len() >= transport::HEADER_SIZE, "Packet too short");
        ensure!(
            packet.len() <= transport::MAX_PACKET_SIZE,
            "Inbound packet exceeds transport size limit"
        );
        self.bytes_in = self.bytes_in.wrapping_add(packet.len() as u64);
        self.last_recv_time = std::time::Instant::now();
        if let Some(capture) = &mut self.capture {
            capture.write_entry(Direction::Inbound, addr, packet)?;
        }
        let mut offset = 0;
        let header = PacketHeader::unpack(packet, &mut offset)
            .ok_or_else(|| anyhow!("Failed to unpack packet header"))?;
        ensure!(
            transport::HEADER_SIZE + usize::from(header.size) == packet.len(),
            "Inbound packet payload size does not match its header"
        );
        log::trace!(
            "<<< Inbound from {}: Seq={} ID={} Flags={:X} Size={} Hex: {:02X?}",
            addr,
            header.sequence,
            header.id,
            header.flags,
            packet.len(),
            packet
        );
        let encrypted = header.flags & packet_flags::ENCRYPTED_CHECKSUM != 0;
        if encrypted {
            ensure!(
                header.sequence != 0,
                "Encrypted server packet has sequence zero"
            );
            // Retail ProcessNewSeqNum (acclient.c:356038) drops accepted encrypted duplicates
            // before key processing, including originals buffered behind an earlier hole.
            if !is_newer_u32(header.sequence, self.last_server_seq)
                || self.pending_server_packets.contains_key(&header.sequence)
            {
                return Ok(false);
            }
        }
        let ordered = Self::should_order_server_packet(&header);
        if ordered {
            self.validate_server_sequence(header.sequence)?;
        }
        let data = &packet[transport::HEADER_SIZE..];
        if !self.validate_received_packet_checksum(&header, data)? {
            return Ok(false);
        }
        if self.pending_server_source_addr == Some(addr) {
            self.server_source_addr = addr;
            self.pending_server_source_addr = None;
        }
        self.process_received_packet_metadata(&header, data)?;
        if header.flags & packet_flags::CONNECT_REQUEST != 0 {
            let mut offset = self.get_payload_offset(header.flags, data);
            let request = ConnectRequestData::unpack(data, &mut offset)
                .ok_or_else(|| anyhow!("Failed to unpack connect request"))?;
            if let Some(time) = self.handle_handshake_request(request)? {
                self.pending_transport_events
                    .push_back(SessionEvent::TimeSync(time));
            }
            return Ok(true);
        }
        if header.flags & packet_flags::CONNECT_RESPONSE != 0 {
            let offset = OptionalHeaderCursor::new(data, header.flags)
                .find_flag_offset(packet_flags::CONNECT_RESPONSE)
                .ok_or_else(|| anyhow!("Missing connect response header"))?;
            ensure!(
                offset + transport::CONNECT_RESPONSE_SIZE <= data.len(),
                "Truncated connect response"
            );
            self.handle_handshake_response(
                LittleEndian::read_u64(&data[offset..offset + transport::CONNECT_RESPONSE_SIZE]),
                header.id,
            );
        }
        if !ordered {
            if header.flags & packet_flags::TIME_SYNC != 0 {
                let time = self.read_time_sync(header.flags, data)?;
                self.pending_transport_events
                    .push_back(SessionEvent::TimeSync(time));
            }
            return Ok(false);
        }
        if is_newer_u32(header.sequence, self.last_server_seq) {
            self.rejected_server_sequences.remove(&header.sequence);
            self.pending_server_packets
                .entry(header.sequence)
                .or_insert_with(|| ReceivedPacket {
                    header,
                    data: data.to_vec(),
                });
            self.has_server_seq = true;
        }
        Ok(false)
    }

    fn process_received_packet_metadata(
        &mut self,
        header: &PacketHeader,
        data: &[u8],
    ) -> Result<()> {
        if header.flags & packet_flags::ACK_SEQUENCE != 0 {
            let sequence = self
                .read_ack_sequence(header.flags, data)
                .ok_or_else(|| anyhow!("Truncated server ACK sequence"))?;
            self.acknowledge_sequence(sequence)?;
        }
        if header.flags & packet_flags::REQUEST_RETRANSMIT != 0 {
            let sequences = self
                .read_sequence_list(header.flags, data, packet_flags::REQUEST_RETRANSMIT)
                .ok_or_else(|| anyhow!("Invalid server retransmit list"))?;
            self.retransmit_sequences(&sequences)?;
        }
        if header.flags & packet_flags::REJECT_RETRANSMIT != 0 {
            let sequences = self
                .read_sequence_list(header.flags, data, packet_flags::REJECT_RETRANSMIT)
                .ok_or_else(|| anyhow!("Invalid server rejection list"))?;
            self.accept_retransmit_rejections(&sequences)?;
        }
        if header.flags & packet_flags::ECHO_REQUEST != 0 {
            let offset = OptionalHeaderCursor::new(data, header.flags)
                .find_flag_offset(packet_flags::ECHO_REQUEST)
                .ok_or_else(|| anyhow!("Missing echo request header"))?;
            ensure!(
                offset + transport::ECHO_REQUEST_SIZE <= data.len(),
                "Truncated echo request"
            );
            // Retail CEchoResponseHeader (acclient.c:354416) echoes the request's float
            // followed by holding time, initially zero at response construction.
            let mut response = data[offset..offset + transport::ECHO_REQUEST_SIZE].to_vec();
            response.extend_from_slice(&0_f32.to_le_bytes());
            self.prepare_reliable(packet_flags::ECHO_RESPONSE, &response)?;
        }
        self.received_packets.record(header);
        Ok(())
    }

    fn validate_received_packet_checksum(
        &mut self,
        header: &PacketHeader,
        data: &[u8],
    ) -> Result<bool> {
        let payload_hash = match self.calculate_payload_hash(header.flags, data) {
            Ok(hash) => hash,
            Err(error) => {
                log::debug!(
                    "Inbound payload validation failed: Seq={}: {}",
                    header.sequence,
                    error
                );
                return Ok(false);
            }
        };
        let checksum = header.checksum.wrapping_sub(header.calculate_checksum());
        let valid = if header.flags & packet_flags::ENCRYPTED_CHECKSUM != 0 {
            let Some(isaac) = &mut self.isaac_s2c else {
                log::warn!(
                    "Inbound encrypted packet received before S2C ISAAC was initialized: Seq={}",
                    header.sequence
                );
                return Ok(false);
            };
            let key = checksum ^ payload_hash;
            if isaac.search(key) {
                isaac.consume_key_value(key);
                true
            } else {
                false
            }
        } else {
            checksum == payload_hash
        };
        if !valid {
            log::debug!(
                "Inbound packet checksum failed: Seq={} Flags={:X}",
                header.sequence,
                header.flags
            );
        }
        Ok(valid)
    }

    fn should_order_server_packet(header: &PacketHeader) -> bool {
        let flags = header.flags & !packet_flags::RETRANSMISSION;
        flags != packet_flags::ACK_SEQUENCE
            && flags != packet_flags::REQUEST_RETRANSMIT
            && header.flags & (packet_flags::CONNECT_REQUEST | packet_flags::CONNECT_RESPONSE) == 0
            && (header.sequence != 0 || header.flags & packet_flags::BLOB_FRAGMENTS != 0)
    }

    pub(super) fn next_expected_server_sequence(&self) -> u32 {
        self.last_server_seq.wrapping_add(1)
    }

    fn take_pending_server_packet(&mut self) -> Option<ReceivedPacket> {
        loop {
            let expected = self.next_expected_server_sequence();
            if let Some(packet) = self.pending_server_packets.remove(&expected) {
                self.rejected_server_sequences.remove(&expected);
                self.last_server_seq = expected;
                return Some(packet);
            }
            if !self.rejected_server_sequences.remove(&expected) {
                return None;
            }
            self.last_server_seq = expected;
        }
    }

    pub fn get_payload_offset(&self, flags: u32, data: &[u8]) -> usize {
        OptionalHeaderCursor::new(data, flags).payload_offset()
    }

    fn read_time_sync(&self, flags: u32, data: &[u8]) -> Result<f64> {
        let offset = OptionalHeaderCursor::new(data, flags)
            .find_flag_offset(packet_flags::TIME_SYNC)
            .ok_or_else(|| anyhow!("Missing time synchronization header"))?;
        ensure!(
            offset + transport::TIME_SYNC_SIZE <= data.len(),
            "Truncated time synchronization header"
        );
        Ok(LittleEndian::read_f64(
            &data[offset..offset + transport::TIME_SYNC_SIZE],
        ))
    }

    /// Core receives one ordered packet's messages; read-ahead never expands its dispatch batch.
    pub async fn recv_message(&mut self) -> Result<Vec<SessionEvent>> {
        loop {
            let ready = !self.pending_transport_events.is_empty()
                || self
                    .pending_server_packets
                    .contains_key(&self.next_expected_server_sequence())
                || self
                    .rejected_server_sequences
                    .contains(&self.next_expected_server_sequence());
            if !ready || self.normal_control_needs_ingress(Instant::now()) {
                self.drain_ready_datagrams().await?;
            }
            self.schedule_normal_control(Instant::now())?;
            self.flush_ready_packets().await?;
            if let Some(event) = self.pending_transport_events.pop_front() {
                return Ok(vec![event]);
            }
            if let Some(packet) = self.take_pending_server_packet() {
                return self.packet_events(packet);
            }
            self.wait_for_activity().await?;
            // Prevent immediately ready invalid/control-only traffic from monopolizing the executor.
            tokio::task::yield_now().await;
        }
    }

    fn packet_events(&mut self, packet: ReceivedPacket) -> Result<Vec<SessionEvent>> {
        let header = packet.header;
        let data = packet.data;
        let mut events = Vec::new();
        if header.flags & packet_flags::TIME_SYNC != 0 {
            events.push(SessionEvent::TimeSync(
                self.read_time_sync(header.flags, &data)?,
            ));
        }
        if header.flags & packet_flags::BLOB_FRAGMENTS != 0 {
            let mut offset = self.get_payload_offset(header.flags, &data);
            while offset + transport::FRAGMENT_HEADER_SIZE <= data.len() {
                let fragment = FragmentHeader::unpack(&data, &mut offset)
                    .ok_or_else(|| anyhow!("Failed to unpack fragment header"))?;
                ensure!(
                    usize::from(fragment.size) >= transport::FRAGMENT_HEADER_SIZE,
                    "Fragment size is shorter than its header"
                );
                let size = usize::from(fragment.size) - transport::FRAGMENT_HEADER_SIZE;
                ensure!(offset + size <= data.len(), "Truncated fragment data");
                if let Some(message) =
                    self.process_fragment(&fragment, &data[offset..offset + size])
                {
                    events.push(SessionEvent::Message(message));
                }
                offset += size;
            }
        }
        Ok(events)
    }
}
