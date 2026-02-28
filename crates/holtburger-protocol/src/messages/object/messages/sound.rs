use crate::messages::utils::{pad_to_4, read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;

#[derive(Debug, Clone, PartialEq)]
pub struct VisualEffectData {
    pub guid: Guid,
    pub index: u32,
}

impl ProtocolUnpack for VisualEffectData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let index = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        Some(VisualEffectData { guid, index })
    }
}

impl ProtocolPack for VisualEffectData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.index).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HearSoundData {
    pub guid: Guid,
    pub sound_id: u32,
}

impl ProtocolUnpack for HearSoundData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let sound_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        Some(HearSoundData { guid, sound_id })
    }
}

impl ProtocolPack for HearSoundData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.sound_id).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LocalServerConsoleData {
    pub text: String,
}

impl ProtocolUnpack for LocalServerConsoleData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let text = read_string16(data, offset)?;
        Some(LocalServerConsoleData { text })
    }
}

impl ProtocolPack for LocalServerConsoleData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.text);
        pad_to_4(buf);
    }
}
