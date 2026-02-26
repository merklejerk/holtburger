use crate::messages::utils::{read_string16, write_string16};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use strum_macros::FromRepr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr)]
#[repr(u32)]
pub enum ChatMessageType {
    Broadcast = 0x00,
    AllChannels = 0x01,
    Speech = 0x02,
    Tell = 0x03,
    OutgoingTell = 0x04,
    System = 0x05,
    Combat = 0x06,
    Magic = 0x07,
    Channel = 0x08,
    SocialGroup = 0x09,
    Officer = 0x0A,
    Allegiance = 0x0B,
    DirectSpeech = 0x0C,
    Appraisal = 0x0D,
    WorldBroadcast = 0x0E,
    AdminBroadcast = 0x0F,
    Error = 0x10,
    Warning = 0x11,
    Filter = 0x12,
    Tinker = 0x13,
    Vendor = 0x14,
    Help = 0x15,
    Contract = 0x16,
    AllegianceBroadcast = 0x17,
    GeneralBroadcast = 0x18,
    MaybeScroll = 0x19,
    MaybeMerchant = 0x1A,
    MaybeAppraisal = 0x1B,
}

#[derive(Debug, Clone, PartialEq)]
pub struct HearSpeechData {
    pub message: String,
    pub sender: u32,
    pub sender_name: String,
    pub chat_type: u32,
}

impl ProtocolUnpack for HearSpeechData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        let sender_name = read_string16(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let sender = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let chat_type = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(HearSpeechData {
            message,
            sender,
            sender_name,
            chat_type,
        })
    }
}

impl ProtocolPack for HearSpeechData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
        write_string16(buf, &self.sender_name);
        buf.extend_from_slice(&self.sender.to_le_bytes());
        buf.extend_from_slice(&self.chat_type.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HearRangedSpeechData {
    pub message: String,
    pub sender_name: String,
    pub sender: u32,
    pub range: f32,
    pub chat_type: u32,
}

impl ProtocolUnpack for HearRangedSpeechData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        let sender_name = read_string16(data, offset)?;
        if *offset + 12 > data.len() {
            return None;
        }
        let sender = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let range = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let chat_type = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(HearRangedSpeechData {
            message,
            sender_name,
            sender,
            range,
            chat_type,
        })
    }
}

impl ProtocolPack for HearRangedSpeechData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
        write_string16(buf, &self.sender_name);
        buf.extend_from_slice(&self.sender.to_le_bytes());
        buf.extend_from_slice(&self.range.to_le_bytes());
        buf.extend_from_slice(&self.chat_type.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SoulEmoteData {
    pub sender: u32,
    pub sender_name: String,
    pub text: String,
}

impl ProtocolUnpack for SoulEmoteData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let sender = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let sender_name = read_string16(data, offset)?;
        let text = read_string16(data, offset)?;
        Some(SoulEmoteData {
            sender,
            sender_name,
            text,
        })
    }
}

impl ProtocolPack for SoulEmoteData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.sender.to_le_bytes());
        write_string16(buf, &self.sender_name);
        write_string16(buf, &self.text);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EmoteTextData {
    pub sender: u32,
    pub sender_name: String,
    pub text: String,
}

impl ProtocolUnpack for EmoteTextData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let sender = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let sender_name = read_string16(data, offset)?;
        let text = read_string16(data, offset)?;
        Some(EmoteTextData {
            sender,
            sender_name,
            text,
        })
    }
}

impl ProtocolPack for EmoteTextData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.sender.to_le_bytes());
        write_string16(buf, &self.sender_name);
        write_string16(buf, &self.text);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServerMessageData {
    pub message: String,
    pub chat_type: u32,
}

impl ProtocolUnpack for ServerMessageData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let chat_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(ServerMessageData { message, chat_type })
    }
}

impl ProtocolPack for ServerMessageData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
        buf.extend_from_slice(&self.chat_type.to_le_bytes());
    }
}
