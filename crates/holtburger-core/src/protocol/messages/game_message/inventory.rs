use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::world::Guid;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InventoryRemoveObjectData {
    pub object_guid: Guid,
}

impl ProtocolUnpack for InventoryRemoveObjectData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let object_guid = Guid::unpack(data, offset)?;
        Some(InventoryRemoveObjectData { object_guid })
    }
}

impl ProtocolPack for InventoryRemoveObjectData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.object_guid.pack(buf);
    }
}

pub use crate::protocol::messages::types::common::SetStackSizeData;
