use crate::messages::movement::types::*;
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::Guid;
pub use holtburger_common::position::{PositionPack, WorldPosition};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PrivateUpdatePositionData {
    pub sequence: u8,
    pub position_type: PositionType,
    pub pos: WorldPosition,
}

impl ProtocolUnpack for PrivateUpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 5 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;
        let position_type_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let position_type = PositionType::from_repr(position_type_raw)?;
        let pos = WorldPosition::unpack(data, offset)?;
        Some(PrivateUpdatePositionData {
            sequence,
            position_type,
            pos,
        })
    }
}

impl ProtocolPack for PrivateUpdatePositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        buf.extend_from_slice(&(self.position_type as u32).to_le_bytes());
        self.pos.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublicUpdatePositionData {
    pub sequence: u8,
    pub guid: Guid,
    pub position_type: PositionType,
    pub pos: WorldPosition,
}

impl ProtocolUnpack for PublicUpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 1 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;
        let guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let position_type_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let position_type = PositionType::from_repr(position_type_raw)?;
        let pos = WorldPosition::unpack(data, offset)?;
        Some(PublicUpdatePositionData {
            sequence,
            guid,
            position_type,
            pos,
        })
    }
}

impl ProtocolPack for PublicUpdatePositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        self.guid.pack(buf);
        buf.extend_from_slice(&(self.position_type as u32).to_le_bytes());
        self.pos.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpdatePositionData {
    pub guid: Guid,
    pub pos: PositionPack,
}

impl ProtocolUnpack for UpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let pos = PositionPack::unpack(data, offset)?;
        Some(UpdatePositionData { guid, pos })
    }
}

impl ProtocolPack for UpdatePositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.pos.pack(buf);
    }
}
