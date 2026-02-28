use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct Attribute2ndData {
    pub current: u32,
    pub max: u32,
    pub base: u32,
    pub attr_id: u32,
}

impl ProtocolUnpack for Attribute2ndData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 16 > data.len() {
            return None;
        }
        let current = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let max = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let base = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let attr_id = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        *offset += 16;

        Some(Attribute2ndData {
            current,
            max,
            base,
            attr_id,
        })
    }
}

impl ProtocolPack for Attribute2ndData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.current).unwrap();
        buf.write_u32::<LittleEndian>(self.max).unwrap();
        buf.write_u32::<LittleEndian>(self.base).unwrap();
        buf.write_u32::<LittleEndian>(self.attr_id).unwrap();
    }
}
