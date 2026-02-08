use crate::protocol::errors::WeenieError;
use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::types::inventory::EquipMask;
use crate::world::Guid;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq)]
pub struct ViewContentsItem {
    pub guid: Guid,
    pub container_type: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ViewContentsData {
    pub container: Guid,
    pub items: Vec<ViewContentsItem>,
}

impl ProtocolUnpack for ViewContentsData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let container = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut items = Vec::with_capacity(count);
        for _ in 0..count {
            let guid = Guid::unpack(data, offset)?;
            if *offset + 4 > data.len() {
                return None;
            }
            let container_type = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            items.push(ViewContentsItem {
                guid,
                container_type,
            });
        }
        Some(ViewContentsData { container, items })
    }
}

impl ProtocolPack for ViewContentsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.container.pack(buf);
        buf.write_u32::<LittleEndian>(self.items.len() as u32)
            .unwrap();
        for item in &self.items {
            item.guid.pack(buf);
            buf.write_u32::<LittleEndian>(item.container_type).unwrap();
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InventoryPutObjInContainerData {
    pub item_guid: Guid,
    pub container_guid: Guid,
    pub slot: u32,
    pub container_type: u32,
}

impl ProtocolUnpack for InventoryPutObjInContainerData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        let container_guid = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let slot = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let container_type = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(InventoryPutObjInContainerData {
            item_guid,
            container_guid,
            slot,
            container_type,
        })
    }
}

impl ProtocolPack for InventoryPutObjInContainerData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        self.container_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.slot).unwrap();
        buf.write_u32::<LittleEndian>(self.container_type).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InventoryPutObjectIn3DData {
    pub object_guid: Guid,
}

impl ProtocolUnpack for InventoryPutObjectIn3DData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let object_guid = Guid::unpack(data, offset)?;
        Some(InventoryPutObjectIn3DData { object_guid })
    }
}

impl ProtocolPack for InventoryPutObjectIn3DData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.object_guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WieldObjectData {
    pub object_guid: Guid,
    pub equip_mask: EquipMask,
}

impl ProtocolUnpack for WieldObjectData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let object_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let equip_mask =
            EquipMask::from_bits_truncate(LittleEndian::read_u32(&data[*offset..*offset + 4]));
        *offset += 4;
        Some(WieldObjectData {
            object_guid,
            equip_mask,
        })
    }
}

impl ProtocolPack for WieldObjectData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.object_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.equip_mask.bits())
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct InventoryServerSaveFailedData {
    pub item_guid: Guid,
    pub error: WeenieError,
}

impl ProtocolUnpack for InventoryServerSaveFailedData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let error_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let error = WeenieError::from_repr(error_raw).unwrap_or(WeenieError::None);
        Some(InventoryServerSaveFailedData { item_guid, error })
    }
}

impl ProtocolPack for InventoryServerSaveFailedData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.error as u32).unwrap();
    }
}
