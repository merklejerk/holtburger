use crate::protocol::errors::WeenieError;
use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16};
use byteorder::{ByteOrder, LittleEndian};

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorData {
    pub error_id: u32,
}

impl WeenieErrorData {
    pub fn error(&self) -> Option<WeenieError> {
        WeenieError::from_repr(self.error_id)
    }
}

impl ProtocolUnpack for WeenieErrorData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(WeenieErrorData { error_id })
    }
}

impl ProtocolPack for WeenieErrorData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.error_id.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WeenieErrorWithStringData {
    pub error_id: u32,
    pub message: String,
}

impl WeenieErrorWithStringData {
    pub fn error(&self) -> Option<WeenieError> {
        WeenieError::from_repr(self.error_id)
    }
}

impl ProtocolUnpack for WeenieErrorWithStringData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let message = read_string16(data, offset)?;
        Some(WeenieErrorWithStringData { error_id, message })
    }
}

impl ProtocolPack for WeenieErrorWithStringData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.error_id.to_le_bytes());
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct UseDoneData {
    pub error_id: u32,
}

impl ProtocolUnpack for UseDoneData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let error_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(UseDoneData { error_id })
    }
}

impl ProtocolPack for UseDoneData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.error_id.to_le_bytes());
    }
}
