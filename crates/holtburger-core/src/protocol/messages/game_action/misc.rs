use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct PingRequestData;

impl ProtocolUnpack for PingRequestData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for PingRequestData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct LoginCompleteData;

impl ProtocolUnpack for LoginCompleteData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for LoginCompleteData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::game_action::{GameAction, GameActionMessage};
    use crate::protocol::messages::game_message::GameMessage;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_ping_request_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 3,
            action: GameAction::PingRequest(Box::new(PingRequestData)),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_PING_REQUEST, &action);
    }

    #[test]
    fn test_login_complete_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 8,
            action: GameAction::LoginComplete(Box::new(LoginCompleteData)),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_LOGIN_COMPLETE, &action);
    }
}
