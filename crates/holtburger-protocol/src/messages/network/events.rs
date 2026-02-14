use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct PingResponseData;

impl ProtocolUnpack for PingResponseData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(PingResponseData)
    }
}

impl ProtocolPack for PingResponseData {
    fn pack(&self, _buf: &mut Vec<u8>) {
        // No payload
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_event::GameEvent;
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;
    use holtburger_common::Guid;

    #[test]
    fn test_ping_response_parity() {
        let fixture = test_fixtures::PING_RESPONSE;
        let mut offset = 0;
        let msg = GameMessage::unpack(fixture, &mut offset).expect("failed to unpack GameMessage");

        if let GameMessage::GameEvent(event_msg) = &msg {
            assert_eq!(event_msg.target, Guid(0));
            assert_eq!(event_msg.sequence, 1);
            assert!(matches!(event_msg.event, GameEvent::PingResponse(_)));
        } else {
            panic!("expected GameMessage::GameEvent, got {:?}", msg);
        }

        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(packed, fixture);
    }
}
