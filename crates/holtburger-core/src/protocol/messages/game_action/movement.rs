use crate::protocol::messages::game_message::movement::RawMotionState;
use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::utils::{align_offset, pad_to_4};
use crate::world::Guid;
use crate::world::position::WorldPosition;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToStateData {
    pub raw_motion_state: RawMotionState,
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub contact_long_jump: u8,
}

impl ProtocolUnpack for MoveToStateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let raw_motion_state = RawMotionState::unpack(data, offset)?;
        let position = WorldPosition::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let server_control_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        *offset += 8;
        if *offset >= data.len() {
            return None;
        }
        let contact_long_jump = data[*offset];
        *offset += 1;

        // Align to 4 bytes
        align_offset(offset, 4);

        Some(MoveToStateData {
            raw_motion_state,
            position,
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
            contact_long_jump,
        })
    }
}

impl ProtocolPack for MoveToStateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.raw_motion_state.pack(buf);
        self.position.pack(buf);
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.server_control_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.teleport_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.force_position_sequence)
            .unwrap();
        buf.push(self.contact_long_jump);

        // Align to 4 bytes
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct JumpData {
    pub extent: f32,
    pub velocity: crate::math::Vector3,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub object_guid: Guid,
    pub spell_id: u32,
}

impl ProtocolUnpack for JumpData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 32 > data.len() {
            return None;
        }
        let extent = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let velocity_x = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let velocity_y = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        let velocity_z = LittleEndian::read_f32(&data[*offset + 12..*offset + 16]);
        let instance_sequence = LittleEndian::read_u16(&data[*offset + 16..*offset + 18]);
        let server_control_sequence = LittleEndian::read_u16(&data[*offset + 18..*offset + 20]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 20..*offset + 22]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 22..*offset + 24]);
        let object_guid = Guid::unpack(data, &mut (*offset + 24))?;
        let spell_id = LittleEndian::read_u32(&data[*offset + 28..*offset + 32]);
        *offset += 32;

        Some(JumpData {
            extent,
            velocity: crate::math::Vector3 {
                x: velocity_x,
                y: velocity_y,
                z: velocity_z,
            },
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
            object_guid,
            spell_id,
        })
    }
}

impl ProtocolPack for JumpData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_f32::<LittleEndian>(self.extent).unwrap();
        buf.write_f32::<LittleEndian>(self.velocity.x).unwrap();
        buf.write_f32::<LittleEndian>(self.velocity.y).unwrap();
        buf.write_f32::<LittleEndian>(self.velocity.z).unwrap();
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.server_control_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.teleport_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.force_position_sequence)
            .unwrap();
        self.object_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.spell_id).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AutonomousPositionActionData {
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub last_contact: u8,
}

impl ProtocolUnpack for AutonomousPositionActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let position = WorldPosition::unpack(data, offset)?;
        if *offset + 9 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let server_control_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        let last_contact = data[*offset + 8];
        *offset += 9;
        align_offset(offset, 4);
        Some(Self {
            position,
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
            last_contact,
        })
    }
}

impl ProtocolPack for AutonomousPositionActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.position.pack(buf);
        buf.write_u16::<LittleEndian>(self.instance_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.server_control_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.teleport_sequence)
            .unwrap();
        buf.write_u16::<LittleEndian>(self.force_position_sequence)
            .unwrap();
        buf.push(self.last_contact);
        pad_to_4(buf);
    }
}
