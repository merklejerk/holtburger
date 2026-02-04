use byteorder::{ByteOrder, LittleEndian};
use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
pub use crate::world::position::WorldPosition;

#[derive(Debug, Clone, PartialEq)]
pub struct UpdatePositionData {
    pub guid: u32,
    pub pos: WorldPosition,
}

impl MessageUnpack for UpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() { return None; }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let pos = WorldPosition::unpack(data, offset)?;
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
    pub pos: WorldPosition,
}

impl MessageUnpack for MovementEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() { return None; }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let event_type = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        let pos = WorldPosition::unpack(data, offset)?;
        Some(MovementEventData { guid, event_type, pos })
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
        let msg = UpdatePositionData {
            guid: 0x50000001,
            pos: WorldPosition {
                landblock_id: 0x12340000,
                ..Default::default()
            },
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);

        let mut offset = 0;
        let unpacked = UpdatePositionData::unpack(&buf, &mut offset).unwrap();
        assert_eq!(unpacked, msg);
    }

    #[test]
    fn test_update_position_pack() {
        let msg = UpdatePositionData {
            guid: 0x50000001,
            pos: WorldPosition {
                landblock_id: 0x12340000,
                ..Default::default()
            },
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        assert_eq!(buf.len(), 36);
    }

    #[test]
    fn test_movement_event_unpack() {
        let msg = MovementEventData {
            guid: 0x50000001,
            event_type: 1,
            pos: WorldPosition {
                landblock_id: 0x12340000,
                ..Default::default()
            },
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);

        let mut offset = 0;
        let unpacked = MovementEventData::unpack(&buf, &mut offset).unwrap();
        assert_eq!(unpacked, msg);
    }

    #[test]
    fn test_movement_event_pack() {
        let msg = MovementEventData {
            guid: 0x50000001,
            event_type: 1,
            pos: WorldPosition {
                landblock_id: 0x12340000,
                ..Default::default()
            },
        };
        let mut buf = Vec::new();
        msg.pack(&mut buf);
        assert_eq!(buf.len(), 40);
    }
}
