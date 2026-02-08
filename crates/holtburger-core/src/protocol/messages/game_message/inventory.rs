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

pub use crate::protocol::messages::common::SetStackSizeData;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::messages::game_message::GameMessage;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_inventory_remove_object_fixture() {
        // Opcode (0x0024), Obj (0x80000001)
        let hex = "2400000001000080";
        let expected = GameMessage::InventoryRemoveObject(Box::new(InventoryRemoveObjectData {
            object_guid: Guid(0x80000001),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_set_stack_size_fixture() {
        // Opcode (0x0197), Seq (0x20), Obj (0x80000001), Size (50), Value (1000)
        let hex = "97010000200000000100008032000000E8030000";
        let expected = GameMessage::SetStackSize(Box::new(SetStackSizeData {
            sequence: 0x20,
            object_guid: Guid(0x80000001),
            stack_size: 50,
            value: 1000,
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }
}
