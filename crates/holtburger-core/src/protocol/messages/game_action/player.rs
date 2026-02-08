use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian};

#[derive(Debug, Clone, PartialEq)]
pub struct JumpData {
    pub extent: f32,
    pub heading: f32,
}

impl ProtocolUnpack for JumpData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() { return None; }
        let extent = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let heading = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(JumpData { extent, heading })
    }
}

impl ProtocolPack for JumpData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.extent.to_le_bytes());
        buf.extend_from_slice(&self.heading.to_le_bytes());
    }
}
