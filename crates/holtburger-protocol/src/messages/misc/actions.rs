use crate::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct PingRequestActionData;

impl ProtocolUnpack for PingRequestActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for PingRequestActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq)]
pub struct LoginCompleteActionData;

impl ProtocolUnpack for LoginCompleteActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self)
    }
}

impl ProtocolPack for LoginCompleteActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}
