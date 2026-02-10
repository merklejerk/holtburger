use crate::errors::WeenieError;
use super::types::EquipMask;
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;
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

// #[cfg(test)]
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures;
    use crate::messages::game_event::{GameEvent, GameEventMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_view_contents_fixture() {
        let expected = ViewContentsData {
            container: Guid(0x11111111),
            items: vec![
                ViewContentsItem {
                    guid: Guid(0x22222222),
                    container_type: 1,
                },
                ViewContentsItem {
                    guid: Guid(0x33333333),
                    container_type: 0,
                },
            ],
        };

        // Skip Opcode(4), Target(4), Seq(4), IntOp(4) = 16 bytes
        let data = &test_fixtures::VIEW_CONTENTS[16..];
        assert_pack_unpack_parity(data, &expected);
    }

    #[test]
    fn test_inventory_put_obj_in_container_fixture() {
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x10), Event (0x0022), Item (0x80000001), Cont (0x80000002), Slot (3), Type (1)
        let hex = "B0F7000001000050100000002200000001000080020000800300000001000000";
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x10,
            event: GameEvent::InventoryPutObjInContainer(Box::new(
                InventoryPutObjInContainerData {
                    item_guid: Guid(0x80000001),
                    container_guid: Guid(0x80000002),
                    slot: 3,
                    container_type: 1,
                },
            )),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_inventory_put_object_in_3d_fixture() {
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x11), Event (0x019A), Obj (0x80000001)
        let hex = "B0F7000001000050110000009A01000001000080";
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x11,
            event: GameEvent::InventoryPutObjectIn3D(Box::new(InventoryPutObjectIn3DData {
                object_guid: Guid(0x80000001),
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_wield_object_fixture() {
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x12), Event (0x0023), Obj (0x80000001), Mask (MELEE_WEAPON=0x00100000)
        let hex = "B0F700000100005012000000230000000100008000001000";
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x12,
            event: GameEvent::WieldObject(Box::new(WieldObjectData {
                object_guid: Guid(0x80000001),
                equip_mask: EquipMask::MELEE_WEAPON,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }

    #[test]
    fn test_inventory_server_save_failed_fixture() {
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x12), Event (0x00A0), Obj (0x80000001), Error (0x03EE)
        let hex = "B0F700000100005012000000A000000001000080EE030000";
        let expected = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: Guid(0x50000001),
            sequence: 0x12,
            event: GameEvent::InventoryServerSaveFailed(Box::new(InventoryServerSaveFailedData {
                item_guid: Guid(0x80000001),
                error: WeenieError::TheContainerIsClosed,
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &expected);
    }
}
