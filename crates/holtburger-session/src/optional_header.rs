use byteorder::{ByteOrder, LittleEndian};
use holtburger_protocol::messages::transport::{self, packet_flags};

/// A helper to navigate the optional header section of an Asheron's Call transport packet.
///
/// The optional headers follow a specific sequence defined by the `packet_flags`.
/// Some headers have fixed sizes, while others (like retransmission requests) have variable sizes.
pub struct OptionalHeaderCursor<'a> {
    data: &'a [u8],
    flags: u32,
}

impl<'a> OptionalHeaderCursor<'a> {
    pub fn new(data: &'a [u8], flags: u32) -> Self {
        Self { data, flags }
    }

    /// Returns the offset to the actual payload (fragments or handshake data)
    /// by skipping all optional headers.
    pub fn payload_offset(&self) -> usize {
        let mut offset = 0;
        self.iterate(|flag, size, _| {
            // We skip all optional headers EXCEPT those that are considered the primary payload
            // (CONNECT_REQUEST and LOGIN_REQUEST).
            if flag != packet_flags::CONNECT_REQUEST && flag != packet_flags::LOGIN_REQUEST {
                offset += size;
            }
            true // Continue
        });
        offset
    }

    /// Returns the bytes that should be included in the header hash.
    pub fn hash_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        self.iterate(|_, size, current_offset| {
            if current_offset + size <= self.data.len() {
                bytes.extend_from_slice(&self.data[current_offset..current_offset + size]);
            }
            true
        });
        bytes
    }

    /// Finds the offset of a specific optional header.
    pub fn find_flag_offset(&self, target_flag: u32) -> Option<usize> {
        let mut result = None;
        self.iterate(|flag, _, current_offset| {
            if flag == target_flag {
                result = Some(current_offset);
                return false; // Stop
            }
            true
        });
        result
    }

    /// Internal iterator that obeys the canonical PacketHeaderOptional sequence.
    fn iterate<F>(&self, mut f: F)
    where
        F: FnMut(u32, usize, usize) -> bool,
    {
        let mut offset = 0;

        macro_rules! check_flag {
            ($flag:expr, $size:expr) => {
                if self.flags & $flag != 0 {
                    if !f($flag, $size, offset) {
                        return;
                    }
                    offset += $size;
                }
            };
        }

        // --- Sequence Start ---

        // 1. Server Switch (8 bytes)
        check_flag!(packet_flags::SERVER_SWITCH, transport::SERVER_SWITCH_SIZE);

        // 2. Request Retransmit (4 + n*4 bytes)
        if self.flags & packet_flags::REQUEST_RETRANSMIT != 0 && offset + 4 <= self.data.len() {
            let count = LittleEndian::read_u32(&self.data[offset..offset + 4]) as usize;
            let size = 4 + (count * 4);
            if !f(packet_flags::REQUEST_RETRANSMIT, size, offset) {
                return;
            }
            offset += size;
        }

        // 3. Reject Retransmit (4 + n*4 bytes)
        if self.flags & packet_flags::REJECT_RETRANSMIT != 0 && offset + 4 <= self.data.len() {
            let count = LittleEndian::read_u32(&self.data[offset..offset + 4]) as usize;
            let size = 4 + (count * 4);
            if !f(packet_flags::REJECT_RETRANSMIT, size, offset) {
                return;
            }
            offset += size;
        }

        // 4. Ack Sequence (4 bytes)
        check_flag!(packet_flags::ACK_SEQUENCE, transport::ACK_SEQUENCE_SIZE);

        // 5. Connect Request (32 bytes)
        check_flag!(
            packet_flags::CONNECT_REQUEST,
            transport::CONNECT_REQUEST_SIZE
        );

        // 6. Login Request (rest of packet)
        if self.flags & packet_flags::LOGIN_REQUEST != 0 {
            let size = self.data.len().saturating_sub(offset);
            if !f(packet_flags::LOGIN_REQUEST, size, offset) {
                return;
            }
            offset += size;
        }

        // 7. Connect Response (8 bytes)
        check_flag!(
            packet_flags::CONNECT_RESPONSE,
            transport::CONNECT_RESPONSE_SIZE
        );

        // 8. CICMD (8 bytes)
        check_flag!(packet_flags::CICMD, transport::CICMD_SIZE);

        // 9. Time Sync (8 bytes)
        check_flag!(packet_flags::TIME_SYNC, transport::TIME_SYNC_SIZE);

        // 10. Echo Request (4 bytes)
        check_flag!(packet_flags::ECHO_REQUEST, transport::ECHO_REQUEST_SIZE);

        // 11. Echo Response (8 bytes)
        check_flag!(packet_flags::ECHO_RESPONSE, transport::ECHO_RESPONSE_SIZE);

        // 12. Flow (6 bytes)
        check_flag!(packet_flags::FLOW, transport::FLOW_SIZE);

        let _ = offset;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::transport::packet_flags;

    #[test]
    fn test_payload_offset_with_multiple_headers() {
        let mut data = vec![0u8; 100];
        // RequestRetransmit (4 + 2*4) = 12 bytes
        LittleEndian::write_u32(&mut data[0..4], 2);

        let flags =
            packet_flags::REQUEST_RETRANSMIT | packet_flags::ACK_SEQUENCE | packet_flags::TIME_SYNC;
        let cursor = OptionalHeaderCursor::new(&data, flags);

        // REQUEST_RETRANSMIT (12) + ACK_SEQUENCE (4) + TIME_SYNC (8) = 24
        assert_eq!(cursor.payload_offset(), 24);
    }

    #[test]
    fn test_payload_offset_skips_connect_request() {
        let data = vec![0u8; 100];
        let flags = packet_flags::SERVER_SWITCH | packet_flags::CONNECT_REQUEST;
        let cursor = OptionalHeaderCursor::new(&data, flags);

        // Only SERVER_SWITCH (8) should be skipped, CONNECT_REQUEST (32) starts the payload.
        assert_eq!(cursor.payload_offset(), 8);
    }

    #[test]
    fn test_find_time_sync_offset() {
        let data = vec![0u8; 100];
        let flags = packet_flags::SERVER_SWITCH | packet_flags::TIME_SYNC;
        let cursor = OptionalHeaderCursor::new(&data, flags);

        assert_eq!(cursor.find_flag_offset(packet_flags::TIME_SYNC), Some(8));
        assert_eq!(
            cursor.find_flag_offset(packet_flags::SERVER_SWITCH),
            Some(0)
        );
        assert_eq!(cursor.find_flag_offset(packet_flags::FLOW), None);
    }
}
