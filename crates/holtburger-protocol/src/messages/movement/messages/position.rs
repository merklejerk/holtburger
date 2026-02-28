use crate::messages::movement::types::*;
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian};
use holtburger_common::Guid;
pub use holtburger_common::position::WorldPosition;
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

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct UpdatePositionFlag: u32 {
        const NONE = 0x00;
        const HAS_VELOCITY = 0x01;
        const HAS_PLACEMENT_ID = 0x02;
        const IS_GROUNDED = 0x04;
        const ORIENTATION_HAS_NO_W = 0x08;
        const ORIENTATION_HAS_NO_X = 0x10;
        const ORIENTATION_HAS_NO_Y = 0x20;
        const ORIENTATION_HAS_NO_Z = 0x40;
    }
}

/// A variable-length position structure used in movement updates (PositionPack in ACE)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct PositionPack {
    pub flags: UpdatePositionFlag,
    pub pos: WorldPosition,
    pub velocity: Option<holtburger_common::math::Vector3>,
    pub placement_id: Option<u32>,
    pub instance_sequence: u16,
    pub position_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
}

impl ProtocolUnpack for PositionPack {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if data.len() < *offset + 8 {
            return None;
        }
        let raw_flags = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let flags = UpdatePositionFlag::from_bits_retain(raw_flags);
        *offset += 4;
        let landblock_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        // Origin position (always present)
        if data.len() < *offset + 12 {
            return None;
        }
        let x = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let y = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let z = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        let mut qw = 0.0;
        let mut qx = 0.0;
        let mut qy = 0.0;
        let mut qz = 0.0;

        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_W) {
            if *offset + 4 > data.len() {
                return None;
            }
            qw = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }
        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_X) {
            if *offset + 4 > data.len() {
                return None;
            }
            qx = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }
        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Y) {
            if *offset + 4 > data.len() {
                return None;
            }
            qy = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }
        if !flags.contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Z) {
            if *offset + 4 > data.len() {
                return None;
            }
            qz = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            *offset += 4;
        }

        let mut velocity = None;
        if flags.contains(UpdatePositionFlag::HAS_VELOCITY) {
            if *offset + 12 > data.len() {
                return None;
            }
            let vx = LittleEndian::read_f32(&data[*offset..*offset + 4]);
            let vy = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
            let vz = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
            *offset += 12;
            velocity = Some(holtburger_common::math::Vector3::new(vx, vy, vz));
        }

        let mut placement_id = None;
        if flags.contains(UpdatePositionFlag::HAS_PLACEMENT_ID) {
            if *offset + 4 > data.len() {
                return None;
            }
            placement_id = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        if *offset + 8 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let position_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        *offset += 8;

        Some(Self {
            flags,
            pos: WorldPosition {
                landblock_id: holtburger_common::guid::Guid(landblock_id),
                coords: holtburger_common::math::Vector3::new(x, y, z),
                rotation: holtburger_common::math::Quaternion {
                    w: qw,
                    x: qx,
                    y: qy,
                    z: qz,
                },
            },
            velocity,
            placement_id,
            instance_sequence,
            position_sequence,
            teleport_sequence,
            force_position_sequence,
        })
    }
}

impl ProtocolPack for PositionPack {
    fn pack(&self, writer: &mut Vec<u8>) {
        use byteorder::WriteBytesExt;
        writer.write_u32::<LittleEndian>(self.flags.bits()).unwrap();
        writer
            .write_u32::<LittleEndian>(self.pos.landblock_id.into())
            .unwrap();
        writer.write_f32::<LittleEndian>(self.pos.coords.x).unwrap();
        writer.write_f32::<LittleEndian>(self.pos.coords.y).unwrap();
        writer.write_f32::<LittleEndian>(self.pos.coords.z).unwrap();

        if !self
            .flags
            .contains(UpdatePositionFlag::ORIENTATION_HAS_NO_W)
        {
            writer
                .write_f32::<LittleEndian>(self.pos.rotation.w)
                .unwrap();
        }
        if !self
            .flags
            .contains(UpdatePositionFlag::ORIENTATION_HAS_NO_X)
        {
            writer
                .write_f32::<LittleEndian>(self.pos.rotation.x)
                .unwrap();
        }
        if !self
            .flags
            .contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Y)
        {
            writer
                .write_f32::<LittleEndian>(self.pos.rotation.y)
                .unwrap();
        }
        if !self
            .flags
            .contains(UpdatePositionFlag::ORIENTATION_HAS_NO_Z)
        {
            writer
                .write_f32::<LittleEndian>(self.pos.rotation.z)
                .unwrap();
        }

        if self.flags.contains(UpdatePositionFlag::HAS_VELOCITY) {
            if let Some(v) = &self.velocity {
                writer.write_f32::<LittleEndian>(v.x).unwrap();
                writer.write_f32::<LittleEndian>(v.y).unwrap();
                writer.write_f32::<LittleEndian>(v.z).unwrap();
            } else {
                writer.write_f32::<LittleEndian>(0.0).unwrap();
                writer.write_f32::<LittleEndian>(0.0).unwrap();
                writer.write_f32::<LittleEndian>(0.0).unwrap();
            }
        }

        if self.flags.contains(UpdatePositionFlag::HAS_PLACEMENT_ID) {
            if let Some(pid) = self.placement_id {
                writer.write_u32::<LittleEndian>(pid).unwrap();
            } else {
                writer.write_u32::<LittleEndian>(0).unwrap();
            }
        }

        writer
            .write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        writer
            .write_u16::<LittleEndian>(self.position_sequence)
            .unwrap();
        writer
            .write_u16::<LittleEndian>(self.teleport_sequence)
            .unwrap();
        writer
            .write_u16::<LittleEndian>(self.force_position_sequence)
            .unwrap();
    }
}
