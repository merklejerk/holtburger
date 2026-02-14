use bitflags::bitflags;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use serde::{Deserialize, Serialize};

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
    pub struct EquipMask: u32 {
        const NONE = 0x00000000;
        const HEAD_WEAR = 0x00000001;
        const CHEST_WEAR = 0x00000002;
        const ABDOMEN_WEAR = 0x00000004;
        const UPPER_ARM_WEAR = 0x00000008;
        const LOWER_ARM_WEAR = 0x00000010;
        const HAND_WEAR = 0x00000020;
        const UPPER_LEG_WEAR = 0x00000040;
        const LOWER_LEG_WEAR = 0x00000080;
        const FOOT_WEAR = 0x00000100;
        const CHEST_ARMOR = 0x00000200;
        const ABDOMEN_ARMOR = 0x00000400;
        const UPPER_ARM_ARMOR = 0x00000800;
        const LOWER_ARM_ARMOR = 0x00001000;
        const UPPER_LEG_ARMOR = 0x00002000;
        const LOWER_LEG_ARMOR = 0x00004000;
        const NECK_WEAR = 0x00008000;
        const WRIST_WEAR_LEFT = 0x00010000;
        const WRIST_WEAR_RIGHT = 0x00020000;
        const FINGER_WEAR_LEFT = 0x00040000;
        const FINGER_WEAR_RIGHT = 0x00080000;
        const MELEE_WEAPON = 0x00100000;
        const SHIELD = 0x00200000;
        const MISSILE_WEAPON = 0x00400000;
        const MISSILE_AMMO = 0x00800000;
        const HELD = 0x01000000;
        const TWO_HANDED = 0x02000000;
        const TRINKET_ONE = 0x04000000;
        const CLOAK = 0x08000000;
        const SIGIL_ONE = 0x10000000;
        const SIGIL_TWO = 0x20000000;
        const SIGIL_THREE = 0x40000000;
    }
}

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
