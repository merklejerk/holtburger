use crate::messages::ChatChannelId;
use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct TalkActionData {
    pub message: String,
}

impl ProtocolUnpack for TalkActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        Some(TalkActionData { message })
    }
}

impl ProtocolPack for TalkActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct TellActionData {
    pub message: String,
    pub target: String,
}

impl ProtocolUnpack for TellActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        let target = read_string16(data, offset)?;
        Some(TellActionData { message, target })
    }
}

impl ProtocolPack for TellActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
        write_string16(buf, &self.target);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EmoteActionData {
    pub message: String,
}

impl ProtocolUnpack for EmoteActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        Some(Self { message })
    }
}

impl ProtocolPack for EmoteActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SoulEmoteActionData {
    pub message: String,
}

impl ProtocolUnpack for SoulEmoteActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let message = read_string16(data, offset)?;
        Some(Self { message })
    }
}

impl ProtocolPack for SoulEmoteActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.message);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChatChannelActionData {
    pub channel: ChatChannelId,
    pub message: String,
}

impl ProtocolUnpack for ChatChannelActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let channel = ChatChannelId::from_raw(u32::from_le_bytes(
            data[*offset..*offset + 4].try_into().ok()?,
        ));
        *offset += 4;
        let message = read_string16(data, offset)?;
        Some(Self { channel, message })
    }
}

impl ProtocolPack for ChatChannelActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.channel.raw().to_le_bytes());
        write_string16(buf, &self.message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::ChatChannel;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_talk_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 1,
            action: GameAction::Talk(Box::new(TalkActionData {
                message: "Hello World".to_string(),
            })),
        }));
        assert_pack_unpack_parity(test_fixtures::ACTION_TALK, &action);
    }

    #[test]
    fn test_tell_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 2,
            action: GameAction::Tell(Box::new(TellActionData {
                message: "Rizzler".to_string(),
                target: "Bestie".to_string(),
            })),
        }));
        assert_pack_unpack_parity(test_fixtures::ACTION_TELL, &action);
    }

    #[test]
    fn test_emote_fixture() {
        let action = GameActionMessage {
            sequence: 0x01020304,
            action: GameAction::Emote(Box::new(EmoteActionData {
                message: "waves enthusiastically".to_string(),
            })),
        };

        // Generated from ACE: SyntheticProtocolTests.GenerateChatAndRecallActionFixtures
        let fixture =
            hex::decode("04030201DF0100001600776176657320656E74687573696173746963616C6C79")
                .unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_soul_emote_fixture() {
        let action = GameActionMessage {
            sequence: 0x05060708,
            action: GameAction::SoulEmote(Box::new(SoulEmoteActionData {
                message: "*wave*".to_string(),
            })),
        };

        // Generated from ACE: SyntheticProtocolTests.GenerateChatAndRecallActionFixtures
        let fixture = hex::decode("08070605E101000006002A776176652A").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_chat_channel_fellow_fixture() {
        let action = GameActionMessage {
            sequence: 0xA1B2C3D4,
            action: GameAction::ChatChannel(Box::new(ChatChannelActionData {
                channel: ChatChannel::Fellow.into(),
                message: "party check".to_string(),
            })),
        };

        // Generated from ACE: SyntheticProtocolTests.GenerateChatAndRecallActionFixtures
        let fixture =
            hex::decode("D4C3B2A147010000000800000B00706172747920636865636B000000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }

    #[test]
    fn test_chat_channel_allegiance_broadcast_fixture() {
        let action = GameActionMessage {
            sequence: 0x10203040,
            action: GameAction::ChatChannel(Box::new(ChatChannelActionData {
                channel: ChatChannel::AllegianceBroadcast.into(),
                message: "guild check".to_string(),
            })),
        };

        // Generated from ACE: SyntheticProtocolTests.GenerateChatAndRecallActionFixtures
        let fixture =
            hex::decode("4030201047010000000000020B006775696C6420636865636B000000").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }
}
