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
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_ping_response_fixture() {
        let expected = PingResponseData;
        // PingResponse has no payload. In the fixture, it's [Opcode(4)][Target(4)][Seq(4)][EventOpcode(4)]
        // So payload starts at offset 16.
        assert_pack_unpack_parity(&fixtures::PING_RESPONSE[16..], &expected);
    }
}
