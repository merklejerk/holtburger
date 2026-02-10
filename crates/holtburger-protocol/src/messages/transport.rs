use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

pub const HEADER_SIZE: usize = 20;
pub const FRAGMENT_HEADER_SIZE: usize = 16;
pub const MAX_PACKET_SIZE: usize = 1024;

// Protocol Magic Numbers
pub const CHECKSUM_SEED: u32 = 0xBADD70DD;
pub const ACE_HANDSHAKE_RACE_DELAY_MS: u64 = 200;

// Handshake Offsets (ConnectRequest) - Relative to payload
pub const CONNECT_REQUEST_SIZE: usize = 32;
pub const CONNECT_RESPONSE_SIZE: usize = 8;
pub const TIME_SYNC_SIZE: usize = 8;
pub const ECHO_REQUEST_SIZE: usize = 4;
pub const ECHO_RESPONSE_SIZE: usize = 8;
pub const FLOW_SIZE: usize = 6;
pub const CICMD_SIZE: usize = 8;
pub const SERVER_SWITCH_SIZE: usize = 8;
pub const ACK_SEQUENCE_SIZE: usize = 4;

#[derive(Debug, Clone)]
pub struct ConnectRequestData {
    pub time: f64,
    pub cookie: u64,
    pub client_id: u16,
    pub server_seed: u32,
    pub client_seed: u32,
}

impl ProtocolUnpack for ConnectRequestData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if data.len() < *offset + CONNECT_REQUEST_SIZE {
            return None;
        }
        let time = LittleEndian::read_f64(&data[*offset..*offset + 8]);
        *offset += 8;
        let cookie = LittleEndian::read_u64(&data[*offset..*offset + 8]);
        *offset += 8;
        let client_id = LittleEndian::read_u32(&data[*offset..*offset + 4]) as u16;
        *offset += 4;
        let server_seed = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let client_seed = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        *offset += 4; // padding

        Some(ConnectRequestData {
            time,
            cookie,
            client_id,
            server_seed,
            client_seed,
        })
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

impl ProtocolUnpack for PacketHeader {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if data.len() < *offset + HEADER_SIZE {
            return None;
        }

        let sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let flags = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let checksum = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let id = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let time = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let size = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let iteration = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        Some(PacketHeader {
            sequence,
            flags,
            checksum,
            id,
            time,
            size,
            iteration,
        })
    }
}

impl ProtocolPack for PacketHeader {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.sequence).unwrap();
        writer.write_u32::<LittleEndian>(self.flags).unwrap();
        writer.write_u32::<LittleEndian>(self.checksum).unwrap();
        writer.write_u16::<LittleEndian>(self.id).unwrap();
        writer.write_u16::<LittleEndian>(self.time).unwrap();
        writer.write_u16::<LittleEndian>(self.size).unwrap();
        writer.write_u16::<LittleEndian>(self.iteration).unwrap();
    }
}

impl PacketHeader {
    pub fn calculate_checksum(&self) -> u32 {
        let mut header_copy = self.clone();
        header_copy.checksum = CHECKSUM_SEED;
        let mut header_data = Vec::with_capacity(HEADER_SIZE);
        header_copy.pack(&mut header_data);

        crate::crypto::Hash32::compute(&header_data)
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

impl ProtocolUnpack for FragmentHeader {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if data.len() < *offset + FRAGMENT_HEADER_SIZE {
            return None;
        }

        let sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let count = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let size = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let index = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;
        let queue = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        Some(FragmentHeader {
            sequence,
            id,
            count,
            size,
            index,
            queue,
        })
    }
}

impl ProtocolPack for FragmentHeader {
    fn pack(&self, writer: &mut Vec<u8>) {
        writer.write_u32::<LittleEndian>(self.sequence).unwrap();
        writer.write_u32::<LittleEndian>(self.id).unwrap();
        writer.write_u16::<LittleEndian>(self.count).unwrap();
        writer.write_u16::<LittleEndian>(self.size).unwrap();
        writer.write_u16::<LittleEndian>(self.index).unwrap();
        writer.write_u16::<LittleEndian>(self.queue).unwrap();
    }
}

