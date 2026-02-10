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

