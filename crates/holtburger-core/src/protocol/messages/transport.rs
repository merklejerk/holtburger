use byteorder::{ByteOrder, LittleEndian};

pub const HEADER_SIZE: usize = 20;
pub const FRAGMENT_HEADER_SIZE: usize = 16;
pub const MAX_PACKET_SIZE: usize = 1024;

// Protocol Magic Numbers
pub const CHECKSUM_SEED: u32 = 0xBADD70DD;
pub const ACE_HANDSHAKE_RACE_DELAY_MS: u64 = 200;

// Handshake Offsets (ConnectRequest) - Relative to payload
pub const OFF_CONNECT_TIME: usize = 0;
pub const OFF_CONNECT_COOKIE: usize = 8;
pub const OFF_CONNECT_CLIENT_ID: usize = 16;
pub const OFF_CONNECT_SERVER_SEED: usize = 20;
pub const OFF_CONNECT_CLIENT_SEED: usize = 24;

#[derive(Debug, Clone)]
pub struct ConnectRequestData {
    pub time: u64,
    pub cookie: u64,
    pub client_id: u16,
    pub server_seed: u32,
    pub client_seed: u32,
}

impl ConnectRequestData {
    pub fn unpack(data: &[u8]) -> Self {
        ConnectRequestData {
            time: LittleEndian::read_u64(&data[0..8]),
            cookie: LittleEndian::read_u64(&data[8..16]),
            client_id: LittleEndian::read_u32(&data[16..20]) as u16,
            server_seed: LittleEndian::read_u32(&data[20..24]), // Note: ACE skip 2 bytes? or is it 16+4?
            client_seed: LittleEndian::read_u32(&data[24..28]),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct PacketHeader {
    pub sequence: u32,
    pub flags: u32,
    pub checksum: u32,
    pub id: u16,
    pub time: u16,
    pub size: u16,
    pub iteration: u16,
}

impl PacketHeader {
    pub fn unpack(data: &[u8]) -> Self {
        PacketHeader {
            sequence: LittleEndian::read_u32(&data[0..4]),
            flags: LittleEndian::read_u32(&data[4..8]),
            checksum: LittleEndian::read_u32(&data[8..12]),
            id: LittleEndian::read_u16(&data[12..14]),
            time: LittleEndian::read_u16(&data[14..16]),
            size: LittleEndian::read_u16(&data[16..18]),
            iteration: LittleEndian::read_u16(&data[18..20]),
        }
    }

    pub fn pack(&self, data: &mut [u8]) {
        LittleEndian::write_u32(&mut data[0..4], self.sequence);
        LittleEndian::write_u32(&mut data[4..8], self.flags);
        LittleEndian::write_u32(&mut data[8..12], self.checksum);
        LittleEndian::write_u16(&mut data[12..14], self.id);
        LittleEndian::write_u16(&mut data[14..16], self.time);
        LittleEndian::write_u16(&mut data[16..18], self.size);
        LittleEndian::write_u16(&mut data[18..20], self.iteration);
    }

    pub fn calculate_checksum(&self) -> u32 {
        let mut header_data = [0u8; HEADER_SIZE];
        let mut header_copy = self.clone();
        header_copy.checksum = CHECKSUM_SEED;
        header_copy.pack(&mut header_data);

        crate::protocol::crypto::Hash32::compute(&header_data)
    }
}

#[derive(Debug, Clone, Default)]
pub struct FragmentHeader {
    pub sequence: u32,
    pub id: u32,
    pub count: u16,
    pub size: u16,
    pub index: u16,
    pub queue: u16,
}

impl FragmentHeader {
    pub fn unpack(data: &[u8]) -> Self {
        FragmentHeader {
            sequence: LittleEndian::read_u32(&data[0..4]),
            id: LittleEndian::read_u32(&data[4..8]),
            count: LittleEndian::read_u16(&data[8..10]),
            size: LittleEndian::read_u16(&data[10..12]),
            index: LittleEndian::read_u16(&data[12..14]),
            queue: LittleEndian::read_u16(&data[14..16]),
        }
    }

    pub fn pack(&self, data: &mut [u8]) {
        LittleEndian::write_u32(&mut data[0..4], self.sequence);
        LittleEndian::write_u32(&mut data[4..8], self.id);
        LittleEndian::write_u16(&mut data[8..10], self.count);
        LittleEndian::write_u16(&mut data[10..12], self.size);
        LittleEndian::write_u16(&mut data[12..14], self.index);
        LittleEndian::write_u16(&mut data[14..16], self.queue);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_packet_header_unpack() {
        let mut buf = [0u8; HEADER_SIZE];
        LittleEndian::write_u32(&mut buf[0..4], 1234);
        LittleEndian::write_u32(&mut buf[4..8], 0xABCD);
        LittleEndian::write_u16(&mut buf[16..18], 100);

        let unpacked = PacketHeader::unpack(&buf);
        assert_eq!(unpacked.sequence, 1234);
        assert_eq!(unpacked.flags, 0xABCD);
        assert_eq!(unpacked.size, 100);
    }

    #[test]
    fn test_packet_header_pack() {
        let header = PacketHeader {
            sequence: 1234,
            flags: 0xABCD,
            size: 100,
            ..Default::default()
        };

        let mut buf = [0u8; HEADER_SIZE];
        header.pack(&mut buf);

        let unpacked = PacketHeader::unpack(&buf);
        assert_eq!(header.sequence, unpacked.sequence);
        assert_eq!(header.flags, unpacked.flags);
        assert_eq!(header.size, unpacked.size);
    }

    #[test]
    fn test_fragment_header_unpack() {
        let mut buf = [0u8; FRAGMENT_HEADER_SIZE];
        LittleEndian::write_u32(&mut buf[0..4], 1); // sequence
        LittleEndian::write_u32(&mut buf[4..8], 0x11223344);
        LittleEndian::write_u16(&mut buf[8..10], 2); // count
        LittleEndian::write_u16(&mut buf[10..12], 500); // size
        LittleEndian::write_u16(&mut buf[12..14], 1); // index

        let unpacked = FragmentHeader::unpack(&buf);
        assert_eq!(unpacked.id, 0x11223344);
        assert_eq!(unpacked.size, 500);
        assert_eq!(unpacked.index, 1);
        assert_eq!(unpacked.count, 2);
    }

    #[test]
    fn test_fragment_header_pack() {
        let header = FragmentHeader {
            id: 0x11223344,
            size: 500,
            index: 1,
            count: 2,
            ..Default::default()
        };

        let mut buf = [0u8; FRAGMENT_HEADER_SIZE];
        header.pack(&mut buf);

        let unpacked = FragmentHeader::unpack(&buf);
        assert_eq!(header.id, unpacked.id);
        assert_eq!(header.size, unpacked.size);
        assert_eq!(header.index, unpacked.index);
        assert_eq!(header.count, unpacked.count);
    }

    #[test]
    fn test_fragment_header_packing_layout() {
        let frag_header = FragmentHeader {
            sequence: 100,
            id: 200,
            count: 1,
            size: 20, // 16 header + 4 payload
            index: 0,
            queue: 1, // General
        };

        let mut frag_packed = vec![0u8; 16];
        frag_header.pack(&mut frag_packed);

        // Seq: 64 00 00 00
        // Id:  C8 00 00 00
        // Count: 01 00
        // Size:  14 00 (20)
        // Index: 00 00
        // Queue: 01 00
        assert_eq!(
            frag_packed,
            vec![
                0x64, 0x00, 0x00, 0x00, 0xC8, 0x00, 0x00, 0x00, 0x01, 0x00, 0x14, 0x00, 0x00, 0x00,
                0x01, 0x00
            ]
        );
    }
}

pub mod packet_flags {
    pub const RETRANSMISSION: u32 = 0x00000001;
    pub const ENCRYPTED_CHECKSUM: u32 = 0x00000002;
    pub const BLOB_FRAGMENTS: u32 = 0x00000004;
    pub const SERVER_SWITCH: u32 = 0x00000100;
    pub const REQUEST_RETRANSMIT: u32 = 0x00001000;
    pub const REJECT_RETRANSMIT: u32 = 0x00002000;
    pub const ACK_SEQUENCE: u32 = 0x00004000;
    pub const DISCONNECT: u32 = 0x00008000;
    pub const LOGIN_REQUEST: u32 = 0x00010000;
    pub const WORLD_LOGIN_REQUEST: u32 = 0x00020000;
    pub const CONNECT_REQUEST: u32 = 0x00040000;
    pub const CONNECT_RESPONSE: u32 = 0x00080000;
    pub const CICMD: u32 = 0x00400000;
    pub const TIME_SYNC: u32 = 0x01000000;
    pub const ECHO_REQUEST: u32 = 0x02000000;
    pub const ECHO_RESPONSE: u32 = 0x04000000;
    pub const FLOW: u32 = 0x08000000;
}

pub mod queues {
    pub const GENERAL: u16 = 0x0001;
}
