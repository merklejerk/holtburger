use super::types::EquipMask;
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct GetAndWieldItemData {
    pub item_guid: Guid,
    pub equip_mask: EquipMask,
}

impl ProtocolUnpack for GetAndWieldItemData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let equip_mask =
            EquipMask::from_bits_truncate(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;
        Some(GetAndWieldItemData {
            item_guid,
            equip_mask,
        })
    }
}

impl ProtocolPack for GetAndWieldItemData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.equip_mask.bits())
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct StackableSplitToWieldData {
    pub stack_guid: Guid,
    pub equip_mask: EquipMask,
    pub amount: i32,
}

impl ProtocolUnpack for StackableSplitToWieldData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let stack_guid = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let equip_mask =
            EquipMask::from_bits_truncate(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        let amount = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(StackableSplitToWieldData {
            stack_guid,
            equip_mask,
            amount,
        })
    }
}

impl ProtocolPack for StackableSplitToWieldData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.stack_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.equip_mask.bits())
            .unwrap();
        buf.write_i32::<LittleEndian>(self.amount).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DropItemData {
    pub item_guid: Guid,
}

impl ProtocolUnpack for DropItemData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        Some(DropItemData { item_guid })
    }
}

impl ProtocolPack for DropItemData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct PutItemInContainerData {
    pub item_guid: Guid,
    pub container_guid: Guid,
    pub placement: u32,
}

impl ProtocolUnpack for PutItemInContainerData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        let container_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let placement = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(PutItemInContainerData {
            item_guid,
            container_guid,
            placement,
        })
    }
}

impl ProtocolPack for PutItemInContainerData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        self.container_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.placement).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures as fixtures;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_get_and_wield_item_fixture() {
        let hex_str = "B1F700002A0000001A0000000100005000001000";
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 42,
            action: GameAction::GetAndWieldItem(Box::new(GetAndWieldItemData {
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
            action: GameAction::StackableSplitToWield(Box::new(StackableSplitToWieldData {
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
            action: GameAction::DropItem(Box::new(DropItemData {
                item_guid: Guid(0x12345678),
            })),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_DROP_ITEM, &action);
    }

    #[test]
    fn test_put_item_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 5,
            action: GameAction::PutItemInContainer(Box::new(PutItemInContainerData {
                item_guid: Guid(0x11111111),
                container_guid: Guid(0x22222222),
                placement: 0,
            })),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_PUT_ITEM, &action);
    }
}
