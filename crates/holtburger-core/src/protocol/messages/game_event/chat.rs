use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16};
use byteorder::{ByteOrder, LittleEndian};

#[derive(Debug, Clone, PartialEq)]
pub struct TellData {
    pub message: String,
    pub sender_name: String,
    pub sender_id: u32,
    pub target_id: u32,
    pub chat_type: u32,
}

impl ProtocolUnpack for TellData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        let sender_name = read_string16(data, offset)?;
        if *offset + 16 > data.len() {
            return None;
        }
        let sender_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let target_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let chat_type = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 16;
        Some(TellData {
            message,
            sender_name,
            sender_id,
            target_id,
            chat_type,
        })
    }
}

impl ProtocolPack for TellData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
        write_string16(buf, &self.sender_name);
        buf.extend_from_slice(&self.sender_id.to_le_bytes());
        buf.extend_from_slice(&self.target_id.to_le_bytes());
        buf.extend_from_slice(&self.chat_type.to_le_bytes());
        buf.extend_from_slice(&0u32.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChannelBroadcastData {
    pub channel_id: u32,
    pub sender_name: String,
    pub message: String,
}

impl ProtocolUnpack for ChannelBroadcastData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let channel_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let sender_name = read_string16(data, offset)?;
        let message = read_string16(data, offset)?;
        Some(ChannelBroadcastData {
            channel_id,
            sender_name,
            message,
        })
    }
}

impl ProtocolPack for ChannelBroadcastData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.channel_id.to_le_bytes());
        write_string16(buf, &self.sender_name);
        write_string16(buf, &self.message);
    }
}
