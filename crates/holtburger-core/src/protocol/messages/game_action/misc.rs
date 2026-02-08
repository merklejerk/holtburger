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
