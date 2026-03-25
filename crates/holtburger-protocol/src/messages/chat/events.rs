use crate::messages::ChatChannelId;
use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian};

#[derive(Debug, Clone, PartialEq)]
pub struct TellEventData {
    pub message: String,
    pub sender_name: String,
    pub sender_id: u32,
    pub target_id: u32,
    pub chat_type: u32,
}

impl ProtocolUnpack for TellEventData {
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
        Some(TellEventData {
            message,
            sender_name,
            sender_id,
            target_id,
            chat_type,
        })
    }
}

impl ProtocolPack for TellEventData {
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
pub struct ChannelBroadcastEventData {
    pub channel: ChatChannelId,
    pub sender_name: String,
    pub message: String,
}

impl ProtocolUnpack for ChannelBroadcastEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let channel = ChatChannelId::from_raw(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;
        let sender_name = read_string16(data, offset)?;
        let message = read_string16(data, offset)?;
        Some(ChannelBroadcastEventData {
            channel,
            sender_name,
            message,
        })
    }
}

impl ProtocolPack for ChannelBroadcastEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.channel.raw().to_le_bytes());
        write_string16(buf, &self.sender_name);
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CommunicationTransientStringEventData {
    pub message: String,
}

impl ProtocolUnpack for CommunicationTransientStringEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        Some(CommunicationTransientStringEventData { message })
    }
}

impl ProtocolPack for CommunicationTransientStringEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PopupStringEventData {
    pub message: String,
}

impl ProtocolUnpack for PopupStringEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        Some(PopupStringEventData { message })
    }
}

impl ProtocolPack for PopupStringEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::chat::types::{
        EmoteTextData, HearRangedSpeechData, HearSpeechData, ServerMessageData, SoulEmoteData,
    };
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures as fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use crate::traits::ProtocolUnpack;

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

        let GameMessage::HearSpeech(msg) =
            GameMessage::unpack(fixtures::HEAR_SPEECH, &mut 0).unwrap()
        else {
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

        let GameMessage::EmoteText(msg) =
            GameMessage::unpack(fixtures::EMOTE_TEXT, &mut 0).unwrap()
        else {
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

        let GameMessage::SoulEmote(msg) =
            GameMessage::unpack(fixtures::SOUL_EMOTE, &mut 0).unwrap()
        else {
            panic!("Expected SoulEmote");
        };
        assert_eq!(*msg, expected);
    }

    #[test]
    fn test_communication_transient_string_parity() {
        let expected = CommunicationTransientStringEventData {
            message: "Fixed casting state".to_string(),
        };
        // 13 00 46 69 78 65 64 20 63 61 73 74 69 6E 67 20 73 74 61 74 65 00 00 00
        let hex = "13 00 46 69 78 65 64 20 63 61 73 74 69 6E 67 20 73 74 61 74 65 00 00 00";
        let data: Vec<u8> = hex
            .split_whitespace()
            .map(|s| u8::from_str_radix(s, 16).unwrap())
            .collect();

        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_popup_string_parity() {
        let expected = PopupStringEventData {
            message: "Welcome to Asheron's Call!".to_string(),
        };
        // 1A 00 57 65 6C 63 6F 6D 65 20 74 6F 20 41 73 68 65 72 6F 6E 27 73 20 43 61 6C 6C 21
        let hex =
            "1A 00 57 65 6C 63 6F 6D 65 20 74 6F 20 41 73 68 65 72 6F 6E 27 73 20 43 61 6C 6C 21";
        let data: Vec<u8> = hex
            .split_whitespace()
            .map(|s| u8::from_str_radix(s, 16).unwrap())
            .collect();

        assert_pack_unpack_parity(&data, &expected);
    }
}
