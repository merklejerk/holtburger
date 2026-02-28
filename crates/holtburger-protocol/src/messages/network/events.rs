use crate::traits::{ProtocolPack, ProtocolUnpack};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct PingResponseEventData;

impl ProtocolUnpack for PingResponseEventData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(PingResponseEventData)
    }
}

impl ProtocolPack for PingResponseEventData {
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
    use crate::test_helpers::assert_pack_unpack_parity;
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

        assert_pack_unpack_parity(fixture, &msg);
    }
}
