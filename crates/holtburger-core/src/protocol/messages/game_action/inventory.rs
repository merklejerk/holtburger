use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::types::inventory::EquipMask;
use crate::world::Guid;
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
    pub slot: u32,
}

impl ProtocolUnpack for PutItemInContainerData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        let container_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let slot = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(PutItemInContainerData {
            item_guid,
            container_guid,
            slot,
        })
    }
}

impl ProtocolPack for PutItemInContainerData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        self.container_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.slot).unwrap();
    }
}
