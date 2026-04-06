use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian};
use strum_macros::FromRepr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Hash)]
#[repr(u32)]
pub enum ChatChannel {
    Abuse = 0x00000001,
    Admin = 0x00000002,
    Audit = 0x00000004,
    Advocate1 = 0x00000008,
    Advocate2 = 0x00000010,
    Advocate3 = 0x00000020,
    Sentinel = 0x00000200,
    Help = 0x00000400,
    Fellow = 0x00000800,
    Vassals = 0x00001000,
    Patron = 0x00002000,
    Monarch = 0x00004000,
    CoVassals = 0x01000000,
    AllegianceBroadcast = 0x02000000,
    FellowBroadcast = 0x04000000,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChatChannelId {
    Known(ChatChannel),
    Unknown(u32),
}

impl ChatChannelId {
    pub fn from_raw(raw: u32) -> Self {
        match ChatChannel::from_repr(raw) {
            Some(channel) => Self::Known(channel),
            None => Self::Unknown(raw),
        }
    }

    pub fn raw(self) -> u32 {
        match self {
            Self::Known(channel) => channel as u32,
            Self::Unknown(raw) => raw,
        }
    }

    pub fn known(self) -> Option<ChatChannel> {
        match self {
            Self::Known(channel) => Some(channel),
            Self::Unknown(_) => None,
        }
    }
}

impl From<ChatChannel> for ChatChannelId {
    fn from(value: ChatChannel) -> Self {
        Self::Known(value)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Hash)]
#[repr(u32)]
#[allow(non_camel_case_types)]
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
    ChannelSend = 0x09,
    Social = 0x0A,
    SocialSend = 0x0B,
    Emote = 0x0C,
    Advancement = 0x0D,
    Abuse = 0x0E,
    Help = 0x0F,
    Appraisal = 0x10,
    Spellcasting = 0x11,
    Allegiance = 0x12,
    Fellowship = 0x13,
    WorldBroadcast = 0x14,
    CombatEnemy = 0x15,
    CombatSelf = 0x16,
    Recall = 0x17,
    Craft = 0x18,
    Salvaging = 0x19,
    x1A = 0x1A,
    x1B = 0x1B,
    x1C = 0x1C,
    x1D = 0x1D,
    x1E = 0x1E,
    AdminTell = 0x1F,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ChatMessageTypeId {
    Known(ChatMessageType),
    Unknown(u32),
}

impl ChatMessageTypeId {
    pub fn from_raw(raw: u32) -> Self {
        match ChatMessageType::from_repr(raw) {
            Some(chat_message_type) => Self::Known(chat_message_type),
            None => Self::Unknown(raw),
        }
    }

    pub fn raw(self) -> u32 {
        match self {
            Self::Known(chat_message_type) => chat_message_type as u32,
            Self::Unknown(raw) => raw,
        }
    }

    pub fn known(self) -> Option<ChatMessageType> {
        match self {
            Self::Known(chat_message_type) => Some(chat_message_type),
            Self::Unknown(_) => None,
        }
    }
}

impl From<ChatMessageType> for ChatMessageTypeId {
    fn from(value: ChatMessageType) -> Self {
        Self::Known(value)
    }
}

impl From<u32> for ChatMessageTypeId {
    fn from(value: u32) -> Self {
        Self::from_raw(value)
    }
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
