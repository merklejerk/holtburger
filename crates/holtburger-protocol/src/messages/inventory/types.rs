use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
pub use holtburger_common::properties::EquipMask;
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SetStackSizeData {
    pub sequence: u32,
    pub object_guid: Guid,
    pub stack_size: u32,
    pub value: u32,
}

impl ProtocolUnpack for SetStackSizeData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let object_guid = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let stack_size = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let value = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
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
        buf.write_u32::<LittleEndian>(self.sequence).unwrap();
        self.object_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.stack_size).unwrap();
        buf.write_u32::<LittleEndian>(self.value).unwrap();
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
        // Opcode (0x0197), Seq (0x20), Obj (0x80000001), Size (50), Value (1000)
        let hex = "97010000200000000100008032000000E8030000";
        let fixture = hex::decode(hex).unwrap();
        let mut offset = 0;
        let msg = GameMessage::unpack(&fixture, &mut offset).expect("failed to unpack GameMessage");

        if let GameMessage::SetStackSize(data) = &msg {
            assert_eq!(data.sequence, 0x20);
            assert_eq!(data.object_guid, Guid(0x80000001));
            assert_eq!(data.stack_size, 50);
            assert_eq!(data.value, 1000);
        } else {
            panic!("expected GameMessage::SetStackSize, got {:?}", msg);
        }

        assert_pack_unpack_parity(&fixture, &msg);
    }
}
