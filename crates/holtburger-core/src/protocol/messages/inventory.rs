use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
use bitflags::bitflags;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct GetAndWieldItemData {
    pub sequence: u32,
    pub item_guid: u32,
    pub equip_mask: EquipMask,
}

impl GetAndWieldItemData {
    pub fn unpack(data: &[u8], offset: &mut usize, sequence: u32) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let item_guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let equip_mask =
            EquipMask::from_bits_truncate(LittleEndian::read_u32(&data[*offset + 4..*offset + 8]));
        *offset += 8;
        Some(GetAndWieldItemData {
            sequence,
            item_guid,
            equip_mask,
        })
    }

    pub fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.item_guid).unwrap();
        buf.write_u32::<LittleEndian>(self.equip_mask.bits())
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct StackableSplitToWieldData {
    pub sequence: u32,
    pub stack_guid: u32,
    pub equip_mask: EquipMask,
    pub amount: i32,
}

impl StackableSplitToWieldData {
    pub fn unpack(data: &[u8], offset: &mut usize, sequence: u32) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let stack_guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let equip_mask =
            EquipMask::from_bits_truncate(LittleEndian::read_u32(&data[*offset + 4..*offset + 8]));
        let amount = LittleEndian::read_i32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(StackableSplitToWieldData {
            sequence,
            stack_guid,
            equip_mask,
            amount,
        })
    }

    pub fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.stack_guid).unwrap();
        buf.write_u32::<LittleEndian>(self.equip_mask.bits())
            .unwrap();
        buf.write_i32::<LittleEndian>(self.amount).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ViewContentsItem {
    pub guid: u32,
    pub container_type: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ViewContentsData {
    pub container: u32,
    pub items: Vec<ViewContentsItem>,
}

impl MessageUnpack for ViewContentsData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let container = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let count = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) as usize;
        *offset += 8;

        if *offset + (count * 8) > data.len() {
            return None;
        }

        let mut items = Vec::with_capacity(count);
        for _ in 0..count {
            let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            let container_type = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
            *offset += 8;
            items.push(ViewContentsItem {
                guid,
                container_type,
            });
        }

        Some(ViewContentsData { container, items })
    }
}

impl MessagePack for ViewContentsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.container).unwrap();
        buf.write_u32::<LittleEndian>(self.items.len() as u32)
            .unwrap();
        for item in &self.items {
            buf.write_u32::<LittleEndian>(item.guid).unwrap();
            buf.write_u32::<LittleEndian>(item.container_type).unwrap();
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InventoryPutObjInContainerData {
    pub item_guid: u32,
    pub container_guid: u32,
    pub slot: u32,
    pub container_type: u32,
}

impl MessageUnpack for InventoryPutObjInContainerData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 16 > data.len() {
            return None;
        }
        let item_guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let container_guid = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let slot = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let container_type = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        *offset += 16;
        Some(InventoryPutObjInContainerData {
            item_guid,
            container_guid,
            slot,
            container_type,
        })
    }
}

impl MessagePack for InventoryPutObjInContainerData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.item_guid).unwrap();
        buf.write_u32::<LittleEndian>(self.container_guid).unwrap();
        buf.write_u32::<LittleEndian>(self.slot).unwrap();
        buf.write_u32::<LittleEndian>(self.container_type).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InventoryPutObjectIn3DData {
    pub object_guid: u32,
}

impl MessageUnpack for InventoryPutObjectIn3DData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let object_guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(InventoryPutObjectIn3DData { object_guid })
    }
}

impl MessagePack for InventoryPutObjectIn3DData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.object_guid).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WieldObjectData {
    pub object_guid: u32,
    pub equip_mask: EquipMask,
}

impl MessageUnpack for WieldObjectData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let object_guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let equip_mask =
            EquipMask::from_bits_truncate(LittleEndian::read_u32(&data[*offset + 4..*offset + 8]));
        *offset += 8;
        Some(WieldObjectData {
            object_guid,
            equip_mask,
        })
    }
}

impl MessagePack for WieldObjectData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.object_guid).unwrap();
        buf.write_u32::<LittleEndian>(self.equip_mask.bits())
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InventoryRemoveObjectData {
    pub object_guid: u32,
}

impl MessageUnpack for InventoryRemoveObjectData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let object_guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(InventoryRemoveObjectData { object_guid })
    }
}

impl MessagePack for InventoryRemoveObjectData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.object_guid).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SetStackSizeData {
    pub sequence: u32,
    pub object_guid: u32,
    pub stack_size: u32,
    pub value: u32,
}

impl MessageUnpack for SetStackSizeData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 16 > data.len() {
            return None;
        }
        let sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let object_guid = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let stack_size = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let value = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        *offset += 16;
        Some(SetStackSizeData {
            sequence,
            object_guid,
            stack_size,
            value,
        })
    }
}

impl MessagePack for SetStackSizeData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.sequence).unwrap();
        buf.write_u32::<LittleEndian>(self.object_guid).unwrap();
        buf.write_u32::<LittleEndian>(self.stack_size).unwrap();
        buf.write_u32::<LittleEndian>(self.value).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct DropItemData {
    pub guid: u32,
}

impl MessageUnpack for DropItemData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(DropItemData { guid })
    }
}

impl MessagePack for DropItemData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.guid).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PutItemInContainerData {
    pub item: u32,
    pub container: u32,
    pub placement: u32,
}

impl MessageUnpack for PutItemInContainerData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let item = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let container = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let placement = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(PutItemInContainerData {
            item,
            container,
            placement,
        })
    }
}

impl MessagePack for PutItemInContainerData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.item).unwrap();
        buf.write_u32::<LittleEndian>(self.container).unwrap();
        buf.write_u32::<LittleEndian>(self.placement).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_view_contents_fixture() {
        let expected = ViewContentsData {
            container: 0x11111111,
            items: vec![
                ViewContentsItem {
                    guid: 0x22222222,
                    container_type: 1,
                },
                ViewContentsItem {
                    guid: 0x33333333,
                    container_type: 0,
                },
            ],
        };

        // Skip Opcode(4), Target(4), Seq(4), IntOp(4) = 16 bytes
        let data = &fixtures::VIEW_CONTENTS[16..];
        assert_pack_unpack_parity(data, &expected);
    }

    #[test]
    fn test_get_and_wield_item_fixture() {
        use crate::protocol::messages::{GameAction, GameActionData, GameMessage};
        let hex = "B1F700002A0000001A0000000100005000001000";
        let expected = GameMessage::GameAction(Box::new(GameAction {
            sequence: 42,

            data: GameActionData::GetAndWieldItem(Box::new(GetAndWieldItemData {
                sequence: 42,
                item_guid: 0x50000001,
                equip_mask: EquipMask::MELEE_WEAPON,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_stackable_split_to_wield_fixture() {
        use crate::protocol::messages::{GameAction, GameActionData, GameMessage};
        let hex = "B1F700002B0000009B010000020000500000800032000000";
        let expected = GameMessage::GameAction(Box::new(GameAction {
            sequence: 43,

            data: GameActionData::StackableSplitToWield(Box::new(StackableSplitToWieldData {
                sequence: 43,
                stack_guid: 0x50000002,
                equip_mask: EquipMask::MISSILE_AMMO,
                amount: 50,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_inventory_put_obj_in_container_fixture() {
        use crate::protocol::messages::{GameEvent, GameEventData, GameMessage};
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x10), Event (0x0022), Item (0x80000001), Cont (0x80000002), Slot (3), Type (1)
        let hex = "B0F7000001000050100000002200000001000080020000800300000001000000";
        let expected = GameMessage::GameEvent(Box::new(GameEvent {
            target: 0x50000001,
            sequence: 0x10,
            event: GameEventData::InventoryPutObjInContainer(Box::new(
                InventoryPutObjInContainerData {
                    item_guid: 0x80000001,
                    container_guid: 0x80000002,
                    slot: 3,
                    container_type: 1,
                },
            )),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_inventory_put_object_in_3d_fixture() {
        use crate::protocol::messages::{GameEvent, GameEventData, GameMessage};
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x11), Event (0x019A), Obj (0x80000001)
        let hex = "B0F7000001000050110000009A01000001000080";
        let expected = GameMessage::GameEvent(Box::new(GameEvent {
            target: 0x50000001,
            sequence: 0x11,
            event: GameEventData::InventoryPutObjectIn3D(Box::new(InventoryPutObjectIn3DData {
                object_guid: 0x80000001,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_inventory_remove_object_fixture() {
        use crate::protocol::messages::GameMessage;
        // Opcode (0x0024), Obj (0x80000001)
        let hex = "2400000001000080";
        let expected = GameMessage::InventoryRemoveObject(Box::new(InventoryRemoveObjectData {
            object_guid: 0x80000001,
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_set_stack_size_fixture() {
        use crate::protocol::messages::GameMessage;
        // Opcode (0x0197), Seq (0x20), Obj (0x80000001), Size (50), Value (1000)
        let hex = "97010000200000000100008032000000E8030000";
        let expected = GameMessage::SetStackSize(Box::new(SetStackSizeData {
            sequence: 0x20,
            object_guid: 0x80000001,
            stack_size: 50,
            value: 1000,
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_wield_object_fixture() {
        use crate::protocol::messages::{GameEvent, GameEventData, GameMessage};
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x12), Event (0x0023), Obj (0x80000001), Mask (MELEE_WEAPON=0x00100000)
        let hex = "B0F700000100005012000000230000000100008000001000";
        let expected = GameMessage::GameEvent(Box::new(GameEvent {
            target: 0x50000001,
            sequence: 0x12,
            event: GameEventData::WieldObject(Box::new(WieldObjectData {
                object_guid: 0x80000001,
                equip_mask: EquipMask::MELEE_WEAPON,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_drop_item_parity() {
        use crate::protocol::messages::{GameAction, GameActionData, GameMessage};
        let action = GameMessage::GameAction(Box::new(GameAction {
            sequence: 4,
            data: GameActionData::DropItem(Box::new(DropItemData { guid: 0x12345678 })),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_DROP_ITEM, &action);
    }

    #[test]
    fn test_put_item_parity() {
        use crate::protocol::messages::{GameAction, GameActionData, GameMessage};
        let action = GameMessage::GameAction(Box::new(GameAction {
            sequence: 5,
            data: GameActionData::PutItemInContainer(Box::new(PutItemInContainerData {
                item: 0x11111111,
                container: 0x22222222,
                placement: 0,
            })),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_PUT_ITEM, &action);
    }
}
