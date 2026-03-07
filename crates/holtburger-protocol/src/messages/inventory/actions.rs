use super::types::EquipMask;
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct GetAndWieldItemActionData {
    pub item_guid: Guid,
    pub equip_mask: EquipMask,
}

impl ProtocolUnpack for GetAndWieldItemActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let equip_mask =
            EquipMask::from_bits_truncate(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;
        Some(GetAndWieldItemActionData {
            item_guid,
            equip_mask,
        })
    }
}

impl ProtocolPack for GetAndWieldItemActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.equip_mask.bits())
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct StackableSplitToWieldActionData {
    pub stack_guid: Guid,
    pub equip_mask: EquipMask,
    pub amount: i32,
}

impl ProtocolUnpack for StackableSplitToWieldActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let stack_guid = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let equip_mask =
            EquipMask::from_bits_truncate(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        let amount = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(StackableSplitToWieldActionData {
            stack_guid,
            equip_mask,
            amount,
        })
    }
}

impl ProtocolPack for StackableSplitToWieldActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.stack_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.equip_mask.bits())
            .unwrap();
        buf.write_i32::<LittleEndian>(self.amount).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct StackableMergeActionData {
    pub merge_from_guid: Guid,
    pub merge_to_guid: Guid,
    pub amount: i32,
}

impl ProtocolUnpack for StackableMergeActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let merge_from_guid = Guid::unpack(data, offset)?;
        let merge_to_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let amount = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(StackableMergeActionData {
            merge_from_guid,
            merge_to_guid,
            amount,
        })
    }
}

impl ProtocolPack for StackableMergeActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.merge_from_guid.pack(buf);
        self.merge_to_guid.pack(buf);
        buf.write_i32::<LittleEndian>(self.amount).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct StackableSplitToContainerActionData {
    pub stack_guid: Guid,
    pub container_guid: Guid,
    pub place: i32,
    pub amount: i32,
}

impl ProtocolUnpack for StackableSplitToContainerActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let stack_guid = Guid::unpack(data, offset)?;
        let container_guid = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let place = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        let amount = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(StackableSplitToContainerActionData {
            stack_guid,
            container_guid,
            place,
            amount,
        })
    }
}

impl ProtocolPack for StackableSplitToContainerActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.stack_guid.pack(buf);
        self.container_guid.pack(buf);
        buf.write_i32::<LittleEndian>(self.place).unwrap();
        buf.write_i32::<LittleEndian>(self.amount).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DropItemActionData {
    pub item_guid: Guid,
}

impl ProtocolUnpack for DropItemActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        Some(DropItemActionData { item_guid })
    }
}

impl ProtocolPack for DropItemActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct PutItemInContainerActionData {
    pub item_guid: Guid,
    pub container_guid: Guid,
    pub placement: u32,
}

impl ProtocolUnpack for PutItemInContainerActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        let container_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let placement = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(PutItemInContainerActionData {
            item_guid,
            container_guid,
            placement,
        })
    }
}

impl ProtocolPack for PutItemInContainerActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        self.container_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.placement).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct GiveObjectRequestActionData {
    pub target_guid: Guid,
    pub item_guid: Guid,
    pub amount: i32,
}

impl ProtocolUnpack for GiveObjectRequestActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target_guid = Guid::unpack(data, offset)?;
        let item_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let amount = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(GiveObjectRequestActionData {
            target_guid,
            item_guid,
            amount,
        })
    }
}

impl ProtocolPack for GiveObjectRequestActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target_guid.pack(buf);
        self.item_guid.pack(buf);
        buf.write_i32::<LittleEndian>(self.amount).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct StackableSplitTo3DActionData {
    pub stack_guid: Guid,
    pub amount: i32,
}

impl ProtocolUnpack for StackableSplitTo3DActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let stack_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let amount = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(StackableSplitTo3DActionData { stack_guid, amount })
    }
}

impl ProtocolPack for StackableSplitTo3DActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.stack_guid.pack(buf);
        buf.write_i32::<LittleEndian>(self.amount).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct SalvageItemsWithActionData {
    pub tool_guid: Guid,
    pub items: Vec<Guid>,
}

impl ProtocolUnpack for SalvageItemsWithActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let tool_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let item_count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut items = Vec::with_capacity(item_count);
        for _ in 0..item_count {
            items.push(Guid::unpack(data, offset)?);
        }
        Some(SalvageItemsWithActionData { tool_guid, items })
    }
}

impl ProtocolPack for SalvageItemsWithActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.tool_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.items.len() as u32)
            .unwrap();
        for item in &self.items {
            item.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct NoLongerViewingContentsActionData {
    pub container_guid: Guid,
}

impl ProtocolUnpack for NoLongerViewingContentsActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let container_guid = Guid::unpack(data, offset)?;
        Some(NoLongerViewingContentsActionData { container_guid })
    }
}

impl ProtocolPack for NoLongerViewingContentsActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.container_guid.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures as fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_get_and_wield_item_fixture() {
        let hex_str = "B1F700002A0000001A0000000100005000001000";
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 42,
            action: GameAction::GetAndWieldItem(Box::new(GetAndWieldItemActionData {
                item_guid: Guid(0x50000001),
                equip_mask: EquipMask::MELEE_WEAPON,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex_str).unwrap(), &expected);
    }

    #[test]
    fn test_stackable_split_to_wield_fixture() {
        let hex_str = "B1F700002B0000009B010000020000500000800032000000";
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 43,
            action: GameAction::StackableSplitToWield(Box::new(StackableSplitToWieldActionData {
                stack_guid: Guid(0x50000002),
                equip_mask: EquipMask::MISSILE_AMMO,
                amount: 50,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex_str).unwrap(), &expected);
    }

    #[test]
    fn test_drop_item_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 4,
            action: GameAction::DropItem(Box::new(DropItemActionData {
                item_guid: Guid(0x12345678),
            })),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_DROP_ITEM, &action);
    }

    #[test]
    fn test_put_item_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 5,
            action: GameAction::PutItemInContainer(Box::new(PutItemInContainerActionData {
                item_guid: Guid(0x11111111),
                container_guid: Guid(0x22222222),
                placement: 0,
            })),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_PUT_ITEM, &action);
    }

    #[test]
    fn test_salvage_items_with_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 1,
            action: GameAction::SalvageItemsWith(Box::new(SalvageItemsWithActionData {
                tool_guid: Guid(0x50000201),
                items: vec![Guid(0x50000100)],
            })),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_CREATE_TINKERING_TOOL, &action);
    }

    #[test]
    fn test_give_object_request_parity() {
        let hex_str = "B1F7000078560000CD00000001000050020000507B000000";
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 0x5678,
            action: GameAction::GiveObjectRequest(Box::new(GiveObjectRequestActionData {
                target_guid: Guid(0x50000001),
                item_guid: Guid(0x50000002),
                amount: 123,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex_str).unwrap(), &expected);
    }

    #[test]
    fn test_stackable_merge_fixture() {
        // StackableMerge hex from ACE: 01 00 00 50 02 00 00 50 0A 00 00 00
        // Header: B1F70000 Sequence: 01000000 ActionOpcode: 54000000
        let hex_str = "B1F70000010000005400000001000050020000500A000000";
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 1,
            action: GameAction::StackableMerge(Box::new(StackableMergeActionData {
                merge_from_guid: Guid(0x50000001),
                merge_to_guid: Guid(0x50000002),
                amount: 10,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex_str).unwrap(), &expected);
    }

    #[test]
    fn test_stackable_split_to_container_fixture() {
        // StackableSplitToContainer hex from ACE: 01 00 00 50 03 00 00 50 05 00 00 00 0A 00 00 00
        // Header: B1F70000 Sequence: 02000000 ActionOpcode: 55000000
        let hex_str = "B1F7000002000000550000000100005003000050050000000A000000";
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 2,
            action: GameAction::StackableSplitToContainer(Box::new(
                StackableSplitToContainerActionData {
                    stack_guid: Guid(0x50000001),
                    container_guid: Guid(0x50000003),
                    place: 5,
                    amount: 10,
                },
            )),
        }));
        assert_pack_unpack_parity(&hex::decode(hex_str).unwrap(), &expected);
    }

    #[test]
    fn test_stackable_split_to_3d_fixture() {
        let hex_str = "B1F700000100000056000000785634120A000000";
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 1,
            action: GameAction::StackableSplitTo3D(Box::new(StackableSplitTo3DActionData {
                stack_guid: Guid(0x12345678),
                amount: 10,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex_str).unwrap(), &expected);
    }

    #[test]
    fn test_no_longer_viewing_contents_fixture() {
        let hex_str = "B1F70000020000009501000021436587";
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 2,
            action: GameAction::NoLongerViewingContents(Box::new(
                NoLongerViewingContentsActionData {
                    container_guid: Guid(0x87654321),
                },
            )),
        }));
        assert_pack_unpack_parity(&hex::decode(hex_str).unwrap(), &expected);
    }
}
