use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use crate::protocol::messages::utils::{read_string16, write_string16};
use byteorder::{ByteOrder, LittleEndian};

#[derive(Debug, Clone, PartialEq)]
pub struct HearSpeechData {
    pub message: String,
    pub sender: u32,
    pub sender_name: String,
    pub chat_type: u32,
}

impl MessageUnpack for HearSpeechData {
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

impl MessagePack for HearSpeechData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
        write_string16(buf, &self.sender_name);
        buf.extend_from_slice(&self.sender.to_le_bytes());
        buf.extend_from_slice(&self.chat_type.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TellData {
    pub message: String,
    pub sender_name: String,
    pub sender_id: u32,
    pub target_id: u32,
    pub chat_type: u32,
}

impl MessageUnpack for TellData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        let sender_name = read_string16(data, offset)?;
        if *offset + 16 > data.len() {
            return None;
        }
        let sender_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let target_id = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let chat_type = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        // There's an extra u32 (usually 0) at the end of Tell.
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

impl MessagePack for TellData {
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

impl MessageUnpack for ChannelBroadcastData {
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

impl MessagePack for ChannelBroadcastData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.channel_id.to_le_bytes());
        write_string16(buf, &self.sender_name);
        write_string16(buf, &self.message);
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

impl MessageUnpack for HearRangedSpeechData {
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

impl MessagePack for HearRangedSpeechData {
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

impl MessageUnpack for SoulEmoteData {
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

impl MessagePack for SoulEmoteData {
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

impl MessageUnpack for EmoteTextData {
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

impl MessagePack for EmoteTextData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.sender.to_le_bytes());
        write_string16(buf, &self.sender_name);
        write_string16(buf, &self.text);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServerMessageData {
    pub message: String,
}

impl MessageUnpack for ServerMessageData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        Some(ServerMessageData { message })
    }
}

impl MessagePack for ServerMessageData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::GameMessage;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_server_message_fixture() {
        let expected = ServerMessageData {
            message: "Welcome to Asheron's Call!".to_string(),
        };
        let mut buf = Vec::new();
        expected.pack(&mut buf);
        // String16 length (2) + "Welcome to Asheron's Call!" (26) + pads (0) = 28
        assert_eq!(buf.len(), 28);

        assert_pack_unpack_parity(&buf, &expected);
    }

    #[test]
    fn test_hear_speech_fixture() {
        let expected = HearSpeechData {
            message: "Hello world".to_string(),
            sender_name: "Alice".to_string(),
            sender: 0x50000001,
            chat_type: 2,
        };
        let data = &fixtures::HEAR_SPEECH[4..];
        assert_pack_unpack_parity::<HearSpeechData>(data, &expected);

        match GameMessage::unpack(fixtures::HEAR_SPEECH).unwrap() {
            GameMessage::HearSpeech(msg) => assert_eq!(*msg, expected),
            _ => panic!("Expected HearSpeech"),
        }
    }

    #[test]
    fn test_hear_ranged_speech_fixture() {
        let expected = HearRangedSpeechData {
            message: "I'm within range".to_string(),
            sender_name: "Bob".to_string(),
            sender: 0x50000002,
            range: 10.0,
            chat_type: 2,
        };
        let data = &fixtures::HEAR_RANGED_SPEECH[4..];
        assert_pack_unpack_parity::<HearRangedSpeechData>(data, &expected);

        match GameMessage::unpack(fixtures::HEAR_RANGED_SPEECH).unwrap() {
            GameMessage::HearRangedSpeech(msg) => assert_eq!(*msg, expected),
            _ => panic!("Expected HearRangedSpeech"),
        }
    }

    #[test]
    fn test_emote_text_fixture() {
        let expected = EmoteTextData {
            sender: 0x50000001,
            sender_name: "Alice".to_string(),
            text: "Alice waves at you.".to_string(),
        };
        let data = &fixtures::EMOTE_TEXT[4..];
        assert_pack_unpack_parity::<EmoteTextData>(data, &expected);

        match GameMessage::unpack(fixtures::EMOTE_TEXT).unwrap() {
            GameMessage::EmoteText(msg) => assert_eq!(*msg, expected),
            _ => panic!("Expected EmoteText"),
        }
    }

    #[test]
    fn test_soul_emote_fixture() {
        let expected = SoulEmoteData {
            sender: 0x50000001,
            sender_name: "Alice".to_string(),
            text: "Alice waves at you.".to_string(),
        };
        let data = &fixtures::SOUL_EMOTE[4..];
        assert_pack_unpack_parity::<SoulEmoteData>(data, &expected);

        match GameMessage::unpack(fixtures::SOUL_EMOTE).unwrap() {
            GameMessage::SoulEmote(msg) => assert_eq!(*msg, expected),
            _ => panic!("Expected SoulEmote"),
        }
    }
}
