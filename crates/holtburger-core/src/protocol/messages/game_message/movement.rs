use crate::protocol::messages::traits::{ProtocolPack, ProtocolUnpack};
use crate::protocol::messages::utils::{align_offset, pad_to_4};
use crate::world::Guid;
pub use crate::world::position::{PositionPack, WorldPosition};
use byteorder::{ByteOrder, LittleEndian};
use serde::{Deserialize, Serialize};

use crate::protocol::messages::types::movement::*;

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VectorUpdateData {
    pub guid: Guid,
    pub velocity: crate::math::Vector3,
    pub omega: crate::math::Vector3,
    pub instance_sequence: u16,
    pub vector_sequence: u16,
}

impl ProtocolUnpack for VectorUpdateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        if *offset + 28 > data.len() {
            return None;
        }
        let velocity = crate::math::Vector3 {
            x: LittleEndian::read_f32(&data[*offset..*offset + 4]),
            y: LittleEndian::read_f32(&data[*offset + 4..*offset + 8]),
            z: LittleEndian::read_f32(&data[*offset + 8..*offset + 12]),
        };
        *offset += 12;
        let omega = crate::math::Vector3 {
            x: LittleEndian::read_f32(&data[*offset..*offset + 4]),
            y: LittleEndian::read_f32(&data[*offset + 4..*offset + 8]),
            z: LittleEndian::read_f32(&data[*offset + 8..*offset + 12]),
        };
        *offset += 12;
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let vector_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        *offset += 4;

        Some(VectorUpdateData {
            guid,
            velocity,
            omega,
            instance_sequence,
            vector_sequence,
        })
    }
}

impl ProtocolPack for VectorUpdateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.extend_from_slice(&self.velocity.x.to_le_bytes());
        buf.extend_from_slice(&self.velocity.y.to_le_bytes());
        buf.extend_from_slice(&self.velocity.z.to_le_bytes());
        buf.extend_from_slice(&self.omega.x.to_le_bytes());
        buf.extend_from_slice(&self.omega.y.to_le_bytes());
        buf.extend_from_slice(&self.omega.z.to_le_bytes());
        buf.extend_from_slice(&self.instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.vector_sequence.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutonomousPositionData {
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub last_contact: u8,
}

impl ProtocolUnpack for AutonomousPositionData {
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

        // Alignment
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

impl ProtocolPack for AutonomousPositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.position.pack(buf);
        buf.extend_from_slice(&self.instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        buf.extend_from_slice(&self.force_position_sequence.to_le_bytes());
        buf.push(self.last_contact);
        // Align
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServerAutonomousPositionData {
    pub guid: Guid,
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub contact_flags: u32,
}

impl ProtocolUnpack for ServerAutonomousPositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let position = WorldPosition::unpack(data, offset)?;
        if *offset + 12 > data.len() {
            return None;
        }
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let server_control_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        let contact_flags = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        // Alignment
        align_offset(offset, 4);

        Some(Self {
            guid,
            position,
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
            contact_flags,
        })
    }
}

impl ProtocolPack for ServerAutonomousPositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.position.pack(buf);
        buf.extend_from_slice(&self.instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        buf.extend_from_slice(&self.force_position_sequence.to_le_bytes());
        buf.extend_from_slice(&self.contact_flags.to_le_bytes());

        // Alignment
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutonomyLevelData {
    pub level: u32,
}

impl ProtocolUnpack for AutonomyLevelData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let level = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(AutonomyLevelData { level })
    }
}

impl ProtocolPack for AutonomyLevelData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.level.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerTeleportData {
    pub teleport_sequence: u16,
}

impl ProtocolUnpack for PlayerTeleportData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 2 > data.len() {
            return None;
        }
        let teleport_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        // Alignment (Writer.Align() in ACE)
        align_offset(offset, 4);

        Some(PlayerTeleportData { teleport_sequence })
    }
}

impl ProtocolPack for PlayerTeleportData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        // Align to 4 bytes
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MovementEventData {
    pub guid: Guid,
    pub object_instance_sequence: u16,
    pub movement_sequence: u16,
    pub server_control_sequence: u16,
    pub is_autonomous: bool,
    pub movement_type: MovementType,
    pub motion_flags: u8,
    pub current_style: u16,
    pub data: MovementTypeData,
}

impl ProtocolUnpack for MovementEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;

        if *offset + 2 > data.len() {
            return None;
        }
        let object_instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        if *offset + 2 > data.len() {
            return None;
        }
        let movement_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        if *offset + 2 > data.len() {
            return None;
        }
        let server_control_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        if *offset + 1 > data.len() {
            return None;
        }
        let is_autonomous = data[*offset] != 0;
        *offset += 1;

        // Alignment (ACE uses Writer.Align() which aligns to 4 bytes)
        align_offset(offset, 4);

        if *offset + 1 > data.len() {
            return None;
        }
        let movement_type_raw = data[*offset];
        let movement_type =
            MovementType::from_repr(movement_type_raw).unwrap_or(MovementType::Invalid);
        *offset += 1;

        if *offset + 1 > data.len() {
            return None;
        }
        let motion_flags = data[*offset];
        *offset += 1;

        if *offset + 2 > data.len() {
            return None;
        }
        let current_style = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        let data_payload = match movement_type {
            MovementType::MoveToObject => {
                MovementTypeData::MoveToObject(MoveToObject::unpack(data, offset)?)
            }
            MovementType::MoveToPosition => {
                MovementTypeData::MoveToPosition(MoveToPosition::unpack(data, offset)?)
            }
            MovementType::TurnToObject => {
                MovementTypeData::TurnToObject(TurnToObject::unpack(data, offset)?)
            }
            MovementType::TurnToHeading => {
                MovementTypeData::TurnToHeading(TurnToHeading::unpack(data, offset)?)
            }
            MovementType::Invalid
            | MovementType::RawCommand
            | MovementType::InterpretedCommand
            | MovementType::StopRawCommand
            | MovementType::StopInterpretedCommand
            | MovementType::StopCompletely => {
                MovementTypeData::Invalid(MovementInvalid::unpack_ext(data, offset, motion_flags)?)
            }
        };

        Some(MovementEventData {
            guid,
            object_instance_sequence,
            movement_sequence,
            server_control_sequence,
            is_autonomous,
            movement_type,
            motion_flags,
            current_style,
            data: data_payload,
        })
    }
}

impl ProtocolPack for MovementEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        buf.extend_from_slice(&self.object_instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.movement_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.push(self.is_autonomous as u8);

        // Alignment
        pad_to_4(buf);

        buf.push(self.movement_type as u8);
        buf.push(self.motion_flags);
        buf.extend_from_slice(&self.current_style.to_le_bytes());

        match &self.data {
            MovementTypeData::Invalid(d) => d.pack(buf),
            MovementTypeData::MoveToObject(d) => d.pack(buf),
            MovementTypeData::MoveToPosition(d) => d.pack(buf),
            MovementTypeData::TurnToObject(d) => d.pack(buf),
            MovementTypeData::TurnToHeading(d) => d.pack(buf),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum MovementTypeData {
    Invalid(MovementInvalid),
    MoveToObject(MoveToObject),
    MoveToPosition(MoveToPosition),
    TurnToObject(TurnToObject),
    TurnToHeading(TurnToHeading),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MovementInvalid {
    pub state: InterpretedMotionState,
    pub sticky_object: Option<Guid>,
}

impl MovementInvalid {
    pub fn unpack_ext(data: &[u8], offset: &mut usize, flags: u8) -> Option<Self> {
        let state = InterpretedMotionState::unpack(data, offset)?;
        let sticky_object = if (flags & 0x01) != 0 {
            Guid::unpack(data, offset)
        } else {
            None
        };
        Some(MovementInvalid {
            state,
            sticky_object,
        })
    }
}

impl ProtocolUnpack for MovementInvalid {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Self::unpack_ext(data, offset, 0)
    }
}

impl ProtocolPack for MovementInvalid {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.state.pack(buf);
        if let Some(guid) = self.sticky_object {
            guid.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToObject {
    pub target: Guid,
    pub origin: Origin,
    pub params: MoveToParameters,
    pub run_rate: f32,
}

impl ProtocolUnpack for MoveToObject {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target = Guid::unpack(data, offset)?;
        let origin = Origin::unpack(data, offset)?;
        let params = MoveToParameters::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let run_rate = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(MoveToObject {
            target,
            origin,
            params,
            run_rate,
        })
    }
}

impl ProtocolPack for MoveToObject {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target.pack(buf);
        self.origin.pack(buf);
        self.params.pack(buf);
        buf.extend_from_slice(&self.run_rate.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToPosition {
    pub origin: Origin,
    pub params: MoveToParameters,
    pub run_rate: f32,
}

impl ProtocolUnpack for MoveToPosition {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let origin = Origin::unpack(data, offset)?;
        let params = MoveToParameters::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let run_rate = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(MoveToPosition {
            origin,
            params,
            run_rate,
        })
    }
}

impl ProtocolPack for MoveToPosition {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.origin.pack(buf);
        self.params.pack(buf);
        buf.extend_from_slice(&self.run_rate.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TurnToObject {
    pub target: Guid,
    pub desired_heading: f32,
    pub params: TurnToParameters,
}

impl ProtocolUnpack for TurnToObject {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let desired_heading = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        *offset += 4;
        let params = TurnToParameters::unpack(data, offset)?;
        Some(TurnToObject {
            target,
            desired_heading,
            params,
        })
    }
}

impl ProtocolPack for TurnToObject {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.target.pack(buf);
        buf.extend_from_slice(&self.desired_heading.to_le_bytes());
        self.params.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TurnToHeading {
    pub params: TurnToParameters,
}

impl ProtocolUnpack for TurnToHeading {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let params = TurnToParameters::unpack(data, offset)?;
        Some(TurnToHeading { params })
    }
}

impl ProtocolPack for TurnToHeading {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.params.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Origin {
    pub cell_id: Guid,
    pub position: crate::math::Vector3,
}

impl ProtocolUnpack for Origin {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 16 > data.len() {
            return None;
        }
        let cell_id = LittleEndian::read_u32(&data[*offset..*offset + 4]).into();
        *offset += 4;
        let x = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let y = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let z = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(Origin {
            cell_id,
            position: crate::math::Vector3 { x, y, z },
        })
    }
}

impl ProtocolPack for Origin {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&<Guid as Into<u32>>::into(self.cell_id).to_le_bytes());
        buf.extend_from_slice(&self.position.x.to_le_bytes());
        buf.extend_from_slice(&self.position.y.to_le_bytes());
        buf.extend_from_slice(&self.position.z.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToParameters {
    pub movement_parameters: u32,
    pub distance_to_object: f32,
    pub min_distance: f32,
    pub fail_distance: f32,
    pub speed: f32,
    pub walk_run_threshold: f32,
    pub desired_heading: f32,
}

impl ProtocolUnpack for MoveToParameters {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 28 > data.len() {
            return None;
        }
        let movement_parameters = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let distance_to_object = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let min_distance = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        let fail_distance = LittleEndian::read_f32(&data[*offset + 12..*offset + 16]);
        let speed = LittleEndian::read_f32(&data[*offset + 16..*offset + 20]);
        let walk_run_threshold = LittleEndian::read_f32(&data[*offset + 20..*offset + 24]);
        let desired_heading = LittleEndian::read_f32(&data[*offset + 24..*offset + 28]);
        *offset += 28;
        Some(MoveToParameters {
            movement_parameters,
            distance_to_object,
            min_distance,
            fail_distance,
            speed,
            walk_run_threshold,
            desired_heading,
        })
    }
}

impl ProtocolPack for MoveToParameters {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.movement_parameters.to_le_bytes());
        buf.extend_from_slice(&self.distance_to_object.to_le_bytes());
        buf.extend_from_slice(&self.min_distance.to_le_bytes());
        buf.extend_from_slice(&self.fail_distance.to_le_bytes());
        buf.extend_from_slice(&self.speed.to_le_bytes());
        buf.extend_from_slice(&self.walk_run_threshold.to_le_bytes());
        buf.extend_from_slice(&self.desired_heading.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TurnToParameters {
    pub movement_parameters: u32,
    pub speed: f32,
    pub desired_heading: f32,
}

impl ProtocolUnpack for TurnToParameters {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 12 > data.len() {
            return None;
        }
        let movement_parameters = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let speed = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        let desired_heading = LittleEndian::read_f32(&data[*offset + 8..*offset + 12]);
        *offset += 12;
        Some(TurnToParameters {
            movement_parameters,
            speed,
            desired_heading,
        })
    }
}

impl ProtocolPack for TurnToParameters {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.movement_parameters.to_le_bytes());
        buf.extend_from_slice(&self.speed.to_le_bytes());
        buf.extend_from_slice(&self.desired_heading.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct InterpretedMotionState {
    pub flags: MovementStateFlags,
    pub num_commands: u32,
    pub current_style: Option<u16>,
    pub forward_command: Option<u16>,
    pub sidestep_command: Option<u16>,
    pub turn_command: Option<u16>,
    pub forward_speed: Option<f32>,
    pub sidestep_speed: Option<f32>,
    pub turn_speed: Option<f32>,
    pub commands: Vec<MotionItem>,
}

impl ProtocolUnpack for InterpretedMotionState {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let raw_flags = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let flags = MovementStateFlags::from_bits_truncate(raw_flags & 0x7F);
        let num_commands = (raw_flags >> 7) as usize;

        let mut current_style = None;
        if flags.contains(MovementStateFlags::CURRENT_STYLE) {
            if *offset + 2 > data.len() {
                return None;
            }
            current_style = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]));
            *offset += 2;
        }

        let mut forward_command = None;
        if flags.contains(MovementStateFlags::FORWARD_COMMAND) {
            if *offset + 2 > data.len() {
                return None;
            }
            forward_command = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]));
            *offset += 2;
        }

        let mut sidestep_command = None;
        if flags.contains(MovementStateFlags::SIDE_STEP_COMMAND) {
            if *offset + 2 > data.len() {
                return None;
            }
            sidestep_command = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]));
            *offset += 2;
        }

        let mut turn_command = None;
        if flags.contains(MovementStateFlags::TURN_COMMAND) {
            if *offset + 2 > data.len() {
                return None;
            }
            turn_command = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]));
            *offset += 2;
        }

        let mut forward_speed = None;
        if flags.contains(MovementStateFlags::FORWARD_SPEED) {
            if *offset + 4 > data.len() {
                return None;
            }
            forward_speed = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut sidestep_speed = None;
        if flags.contains(MovementStateFlags::SIDE_STEP_SPEED) {
            if *offset + 4 > data.len() {
                return None;
            }
            sidestep_speed = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut turn_speed = None;
        if flags.contains(MovementStateFlags::TURN_SPEED) {
            if *offset + 4 > data.len() {
                return None;
            }
            turn_speed = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        let mut commands = Vec::new();
        for _ in 0..num_commands {
            if let Some(cmd) = MotionItem::unpack(data, offset) {
                commands.push(cmd);
            } else {
                return None;
            }
        }

        // Align
        align_offset(offset, 4);

        Some(InterpretedMotionState {
            flags,
            num_commands: num_commands as u32,
            current_style,
            forward_command,
            sidestep_command,
            turn_command,
            forward_speed,
            sidestep_speed,
            turn_speed,
            commands,
        })
    }
}

impl ProtocolPack for InterpretedMotionState {
    fn pack(&self, buf: &mut Vec<u8>) {
        let num_commands = self.commands.len() as u32;
        let raw_flags = self.flags.bits() | (num_commands << 7);
        buf.extend_from_slice(&raw_flags.to_le_bytes());

        if let Some(style) = self.current_style {
            buf.extend_from_slice(&style.to_le_bytes());
        }

        if let Some(cmd) = self.forward_command {
            buf.extend_from_slice(&cmd.to_le_bytes());
        }

        if let Some(cmd) = self.sidestep_command {
            buf.extend_from_slice(&cmd.to_le_bytes());
        }

        if let Some(cmd) = self.turn_command {
            buf.extend_from_slice(&cmd.to_le_bytes());
        }

        if let Some(speed) = self.forward_speed {
            buf.extend_from_slice(&speed.to_le_bytes());
        }

        if let Some(speed) = self.sidestep_speed {
            buf.extend_from_slice(&speed.to_le_bytes());
        }

        if let Some(speed) = self.turn_speed {
            buf.extend_from_slice(&speed.to_le_bytes());
        }

        for item in &self.commands {
            item.pack(buf);
        }

        // Align
        pad_to_4(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MotionItem {
    pub command: u16,
    pub packed_sequence: u16, // bit 15: is_autonomous, bits 0-14: sequence
    pub speed: f32,
}

impl MotionItem {
    pub fn sequence(&self) -> u16 {
        self.packed_sequence & 0x7FFF
    }

    pub fn is_autonomous(&self) -> bool {
        (self.packed_sequence >> 15) == 1
    }

    pub fn new(command: u16, sequence: u16, is_autonomous: bool, speed: f32) -> Self {
        let packed_sequence = (sequence & 0x7FFF) | (if is_autonomous { 1 << 15 } else { 0 });
        Self {
            command,
            packed_sequence,
            speed,
        }
    }
}

impl ProtocolUnpack for MotionItem {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if data.len() < *offset + 8 {
            return None;
        }
        let command = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let packed_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let speed = LittleEndian::read_f32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(Self {
            command,
            packed_sequence,
            speed,
        })
    }
}

impl ProtocolPack for MotionItem {
    fn pack(&self, writer: &mut Vec<u8>) {
        use byteorder::{LittleEndian, WriteBytesExt};
        writer.write_u16::<LittleEndian>(self.command).unwrap();
        writer
            .write_u16::<LittleEndian>(self.packed_sequence)
            .unwrap();
        writer.write_f32::<LittleEndian>(self.speed).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct RawMotionState {
    pub flags: RawMotionFlags,
    pub current_hold_key: Option<u32>,
    pub current_style: Option<u32>,
    pub forward_command: Option<u32>,
    pub forward_hold_key: Option<u32>,
    pub forward_speed: Option<f32>,
    pub sidestep_command: Option<u32>,
    pub sidestep_hold_key: Option<u32>,
    pub sidestep_speed: Option<f32>,
    pub turn_command: Option<u32>,
    pub turn_hold_key: Option<u32>,
    pub turn_speed: Option<f32>,
    pub commands: Vec<MotionItem>,
}

impl ProtocolUnpack for RawMotionState {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let packed_flags = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let flags = RawMotionFlags::from_bits_truncate(packed_flags & 0x7FF);
        let command_list_length = (packed_flags >> 11) as u16;

        let mut state = RawMotionState {
            flags,
            ..Default::default()
        };

        if flags.contains(RawMotionFlags::CURRENT_HOLD_KEY) {
            state.current_hold_key = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::CURRENT_STYLE) {
            state.current_style = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::FORWARD_COMMAND) {
            state.forward_command = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::FORWARD_HOLD_KEY) {
            state.forward_hold_key = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::FORWARD_SPEED) {
            state.forward_speed = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::SIDE_STEP_COMMAND) {
            state.sidestep_command = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::SIDE_STEP_HOLD_KEY) {
            state.sidestep_hold_key = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::SIDE_STEP_SPEED) {
            state.sidestep_speed = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::TURN_COMMAND) {
            state.turn_command = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::TURN_HOLD_KEY) {
            state.turn_hold_key = Some(LittleEndian::read_u32(&data[*offset..*offset + 4]));
            *offset += 4;
        }
        if flags.contains(RawMotionFlags::TURN_SPEED) {
            state.turn_speed = Some(LittleEndian::read_f32(&data[*offset..*offset + 4]));
            *offset += 4;
        }

        for _ in 0..command_list_length {
            state.commands.push(MotionItem::unpack(data, offset)?);
        }

        Some(state)
    }
}

impl ProtocolPack for RawMotionState {
    fn pack(&self, buf: &mut Vec<u8>) {
        let mut packed_flags = self.flags.bits() & 0x7FF;
        packed_flags |= (self.commands.len() as u32) << 11;
        buf.extend_from_slice(&packed_flags.to_le_bytes());

        if let Some(val) = self.current_hold_key {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.current_style {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.forward_command {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.forward_hold_key {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.forward_speed {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.sidestep_command {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.sidestep_hold_key {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.sidestep_speed {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.turn_command {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.turn_hold_key {
            buf.extend_from_slice(&val.to_le_bytes());
        }
        if let Some(val) = self.turn_speed {
            buf.extend_from_slice(&val.to_le_bytes());
        }

        for command in &self.commands {
            command.pack(buf);
        }
    }
}
