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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hear_speech_unpack() {
        let msg = HearSpeechData {
            message: "Hello world".to_string(),
            sender: 0x50000001,
            sender_name: "Alice".to_string(),
            chat_type: 2,
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);

        let mut offset = 0;
        let unpacked = HearSpeechData::unpack(&buf, &mut offset).unwrap();
        assert_eq!(unpacked, msg);
    }

    #[test]
    fn test_hear_speech_pack() {
        let msg = HearSpeechData {
            message: "Hello world".to_string(),
            sender: 0x50000001,
            sender_name: "Alice".to_string(),
            chat_type: 2,
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        // message: 2+11+3=16, sender_name: 2+5+1=8, sender: 4, chat_type: 4. Total: 32.
        assert_eq!(buf.len(), 32);
    }

    #[test]
    fn test_soul_emote_unpack() {
        let msg = SoulEmoteData {
            sender: 0x50000001,
            sender_name: "Alice".to_string(),
            text: "Alice waves at you.".to_string(),
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);

        let mut offset = 0;
        let unpacked = SoulEmoteData::unpack(&buf, &mut offset).unwrap();
        assert_eq!(unpacked, msg);
    }

    #[test]
    fn test_soul_emote_pack() {
        let msg = SoulEmoteData {
            sender: 0x50000001,
            sender_name: "Alice".to_string(),
            text: "Alice waves at you.".to_string(),
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        // sender: 4, sender_name: 2+5+1=8, text: 2+19+3=24. Total: 36.
        assert_eq!(buf.len(), 36);
    }
}
