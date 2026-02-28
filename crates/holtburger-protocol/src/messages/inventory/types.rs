use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;
pub use holtburger_common::properties::EquipMask;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SetStackSizeData {
    pub sequence: u8,
    pub object_guid: Guid,
    pub stack_size: u32,
    pub value: u32,
}

impl ProtocolUnpack for SetStackSizeData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let sequence = u8::unpack(data, offset)?;
        let object_guid = Guid::unpack(data, offset)?;
        let stack_size = u32::unpack(data, offset)?;
        let value = u32::unpack(data, offset)?;
        Some(SetStackSizeData {
            sequence,
            object_guid,
            stack_size,
            value,
        })
    }
}

impl ProtocolPack for SetStackSizeData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.sequence.pack(buf);
        self.object_guid.pack(buf);
        self.stack_size.pack(buf);
        self.value.pack(buf);
    }
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_message::GameMessage;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_inventory_remove_object_fixture() {
        // Opcode (0x0024), Obj (0x80000001)
        let hex = "2400000001000080";
        let fixture = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = GameMessage::unpack(&fixture, &mut offset).expect("failed to unpack GameMessage");

        if let GameMessage::InventoryRemoveObject(data) = &msg {
            assert_eq!(data.object_guid, Guid(0x80000001));
        } else {
            panic!("expected GameMessage::InventoryRemoveObject, got {:?}", msg);
        }

        assert_pack_unpack_parity(&fixture, &msg);
    }

    #[test]
    fn test_set_stack_size_fixture() {
        // [Opcode, Sequence (1 byte), Guid, StackSize (u32), Value (u32)] (17 bytes)
        // 97010000 20 01000080 32000000 E8030000
        let hex = "97010000200100008032000000E8030000";
        let fixture = hex::decode(hex).unwrap();
        let expected = GameMessage::SetStackSize(Box::new(SetStackSizeData {
            sequence: 0x20,
            object_guid: Guid(0x80000001),
            stack_size: 50,
            value: 1000,
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }

    #[test]
    fn test_set_stack_size_user_payload_fixture() {
        // Opcode 0x0197, Seq 0x00, Obj 0x800000BE, Stack 7933, Value 7933
        // [97, 01, 00, 00, 00, BE, 00, 00, 80, FD, 1E, 00, 00, FD, 1E, 00, 00]
        let hex = "9701000000BE000080FD1E0000FD1E0000";
        let fixture = hex::decode(hex).unwrap();
        let expected = GameMessage::SetStackSize(Box::new(SetStackSizeData {
            sequence: 0,
            object_guid: Guid(0x800000BE),
            stack_size: 7933,
            value: 7933,
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }
}
