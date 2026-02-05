use crate::protocol::messages::traits::{MessagePack, MessageUnpack};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct PingResponseData;

impl MessageUnpack for PingResponseData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(PingResponseData)
    }
}

impl MessagePack for PingResponseData {
    fn pack(&self, _buf: &mut Vec<u8>) {
        // No payload
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::game_event::{GameEvent, GameEventData};

    #[test]
    fn test_ping_response_unpack() {
        let mut offset = 0;
        // PING_RESPONSE fixture has [Opcode(4)][Header(12)]
        let event = GameEvent::unpack(&fixtures::PING_RESPONSE[4..], &mut offset).unwrap();
        if let GameEventData::PingResponse(_) = event.event {
            // success
        } else {
            panic!("Expected PingResponse variant");
        }
        assert_eq!(offset, fixtures::PING_RESPONSE.len() - 4);
    }

    #[test]
    fn test_ping_response_pack() {
        let data = PingResponseData;
        let mut buf = Vec::new();
        data.pack(&mut buf);

        // PingResponse has no payload, so the buffer should be empty
        // In the full fixture, the payload starts after the 16-byte header
        assert!(buf.is_empty());
        assert_eq!(buf, &fixtures::PING_RESPONSE[16..]);
    }
}
