use crate::messages::utils::{read_string16, write_string16};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

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

#[cfg(test)]
mod tests {
    use super::*;
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
}
