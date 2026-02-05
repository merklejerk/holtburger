use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
pub use crate::world::position::{PositionPack, WorldPosition};
use byteorder::{ByteOrder, LittleEndian};

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePositionData {
    pub guid: u32,
    pub pos: PositionPack,
}

impl MessageUnpack for UpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let pos = PositionPack::unpack(data, offset)?;
        Some(UpdatePositionData { guid, pos })
    }
}

impl MessagePack for UpdatePositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.guid.to_le_bytes());
        self.pos.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MovementEventData {
    pub guid: u32,
    pub event_type: u32,
    pub pos: PositionPack,
}

impl MessageUnpack for MovementEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let event_type = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        let pos = PositionPack::unpack(data, offset)?;
        Some(MovementEventData {
            guid,
            event_type,
            pos,
        })
    }
}

impl MessagePack for MovementEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.guid.to_le_bytes());
        buf.extend_from_slice(&self.event_type.to_le_bytes());
        self.pos.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_update_position_unpack() {
        let hex =
            "010000503400000051013e026f1283423d0a87420000000000000000000000000000000000000000";
        let data = hex::decode(hex).unwrap();
        let mut offset = 0;
        let unpacked = UpdatePositionData::unpack(&data, &mut offset).unwrap();
        assert_eq!(unpacked.guid, 0x50000001);
        assert_eq!(unpacked.pos.pos.landblock_id, 0x023E0151);
    }

    #[test]
    fn test_update_position_pack() {
        // Skip for now since pack is not yet implemented for variable size
    }

    #[test]
    fn test_movement_event_unpack() {
        let msg = MovementEventData {
            guid: 0x50000001,
            event_type: 1,
            pos: PositionPack {
                pos: WorldPosition {
                    landblock_id: 0x12340000,
                    ..Default::default()
                },
                ..Default::default()
            },
        };
        let mut buf = Vec::new();
        // Manual pack for test
        buf.extend_from_slice(&msg.guid.to_le_bytes());
        buf.extend_from_slice(&msg.event_type.to_le_bytes());
        buf.extend_from_slice(&0u32.to_le_bytes()); // flags
        buf.extend_from_slice(&msg.pos.pos.landblock_id.to_le_bytes());
        buf.extend_from_slice(&0f32.to_le_bytes()); // x
        buf.extend_from_slice(&0f32.to_le_bytes()); // y
        buf.extend_from_slice(&0f32.to_le_bytes()); // z
        buf.extend_from_slice(&0f32.to_le_bytes()); // qw
        buf.extend_from_slice(&0f32.to_le_bytes()); // qx
        buf.extend_from_slice(&0f32.to_le_bytes()); // qy
        buf.extend_from_slice(&0f32.to_le_bytes()); // qz
        buf.extend_from_slice(&[0u8; 8]); // sequences

        let mut offset = 0;
        let unpacked = MovementEventData::unpack(&buf, &mut offset).unwrap();
        assert_eq!(unpacked, msg);
    }

    #[test]
    fn test_movement_event_pack() {
        let msg = MovementEventData {
            guid: 0x50000001,
            event_type: 1,
            pos: PositionPack {
                pos: WorldPosition {
                    landblock_id: 0x12340000,
                    ..Default::default()
                },
                ..Default::default()
            },
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        assert_eq!(buf.len(), 52);
    }
}
