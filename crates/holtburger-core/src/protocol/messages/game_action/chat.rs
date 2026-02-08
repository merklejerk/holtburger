use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16};

#[derive(Debug, Clone, PartialEq)]
pub struct TalkData {
    pub message: String,
}

impl ProtocolUnpack for TalkData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        Some(TalkData { message })
    }
}

impl ProtocolPack for TalkData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TellActionData {
    pub target_name: String,
    pub message: String,
}

impl ProtocolUnpack for TellActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target_name = read_string16(data, offset)?;
        let message = read_string16(data, offset)?;
        Some(TellActionData { target_name, message })
    }
}

impl ProtocolPack for TellActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.target_name);
        write_string16(buf, &self.message);
    }
}
