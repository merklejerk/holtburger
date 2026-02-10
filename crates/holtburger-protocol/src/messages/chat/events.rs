use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use crate::messages::utils::{read_string16, write_string16};
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures as fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use crate::messages::game_message::GameMessage;
    use holtburger_common::traits::ProtocolUnpack;
    use crate::messages::chat::types::{ServerMessageData, HearSpeechData, HearRangedSpeechData, EmoteTextData, SoulEmoteData};

    #[test]
    fn test_server_message_parity() {
        let expected = ServerMessageData {
            message: "Welcome to Asheron's Call!".to_string(),
            chat_type: 0,
        };
        let mut buf = Vec::new();
        expected.pack(&mut buf);
        // String16 length (2) + "Welcome to Asheron's Call!" (26) + chat_type (4) = 32
        assert_eq!(buf.len(), 32);
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

        let GameMessage::HearSpeech(msg) = GameMessage::unpack(fixtures::HEAR_SPEECH, &mut 0).unwrap() else {
            panic!("Expected HearSpeech");
        };
        assert_eq!(*msg, expected);
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

        let GameMessage::HearRangedSpeech(msg) =
            GameMessage::unpack(fixtures::HEAR_RANGED_SPEECH, &mut 0).unwrap()
        else {
            panic!("Expected HearRangedSpeech");
        };
        assert_eq!(*msg, expected);
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

        let GameMessage::EmoteText(msg) = GameMessage::unpack(fixtures::EMOTE_TEXT, &mut 0).unwrap() else {
            panic!("Expected EmoteText");
        };
        assert_eq!(*msg, expected);
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

        let GameMessage::SoulEmote(msg) = GameMessage::unpack(fixtures::SOUL_EMOTE, &mut 0).unwrap() else {
            panic!("Expected SoulEmote");
        };
        assert_eq!(*msg, expected);
    }
}
