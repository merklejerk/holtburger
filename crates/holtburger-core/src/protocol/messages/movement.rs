use crate::protocol::messages::traits::{MessagePack, MessageUnpack};
pub use crate::world::position::{PositionPack, WorldPosition};
use byteorder::{ByteOrder, LittleEndian};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MovementType {
    Invalid = 0,
    RawCommand = 1,
    InterpretedCommand = 2,
    StopRawCommand = 3,
    StopInterpretedCommand = 4,
    StopCompletely = 5,
    MoveToObject = 6,
    MoveToPosition = 7,
    TurnToObject = 8,
    TurnToHeading = 9,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MotionFlags(pub u8);

impl MotionFlags {
    pub const NONE: u8 = 0x00;
    pub const STICK_TO_OBJECT: u8 = 0x01;
    pub const STANDING_LONG_JUMP: u8 = 0x02;
}

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct MovementStateFlags: u32 {
        const INVALID = 0x0;
        const CURRENT_STYLE = 0x1;
        const FORWARD_COMMAND = 0x2;
        const FORWARD_SPEED = 0x4;
        const SIDE_STEP_COMMAND = 0x8;
        const SIDE_STEP_SPEED = 0x10;
        const TURN_COMMAND = 0x20;
        const TURN_SPEED = 0x40;
    }
}

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct RawMotionFlags: u32 {
        const INVALID = 0x0;
        const CURRENT_HOLD_KEY = 0x1;
        const CURRENT_STYLE = 0x2;
        const FORWARD_COMMAND = 0x4;
        const FORWARD_HOLD_KEY = 0x8;
        const FORWARD_SPEED = 0x10;
        const SIDE_STEP_COMMAND = 0x20;
        const SIDE_STEP_HOLD_KEY = 0x40;
        const SIDE_STEP_SPEED = 0x80;
        const TURN_COMMAND = 0x100;
        const TURN_HOLD_KEY = 0x200;
        const TURN_SPEED = 0x400;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u32)]
pub enum PositionType {
    Undef = 0,
    Location = 1,
    Destination = 2,
    Instantiation = 3,
    Sanctuary = 4,
    Home = 5,
    ActivationMove = 6,
    Target = 7,
    LinkedPortalOne = 8,
    LastPortal = 9,
    PortalStorm = 10,
    CrashAndTurn = 11,
    PortalSummonLoc = 12,
    HouseBoot = 13,
    LastOutsideDeath = 14,
    LinkedLifestone = 15,
    LinkedPortalTwo = 16,
    Save1 = 17,
    Save2 = 18,
    Save3 = 19,
    Save4 = 20,
    Save5 = 21,
    Save6 = 22,
    Save7 = 23,
    Save8 = 24,
    Save9 = 25,
    RelativeDestination = 26,
    TeleportedCharacter = 27,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PrivateUpdatePositionData {
    pub sequence: u8,
    pub position_type: PositionType,
    pub pos: WorldPosition,
}

#[derive(Debug, Clone, PartialEq)]
pub struct VectorUpdateData {
    pub guid: u32,
    pub velocity: crate::math::Vector3,
    pub omega: crate::math::Vector3,
    pub instance_sequence: u16,
    pub vector_sequence: u16,
}

impl MessageUnpack for VectorUpdateData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 32 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
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

impl MessagePack for VectorUpdateData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.guid.to_le_bytes());
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

impl MessageUnpack for AutonomousPositionData {
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
        *offset = (*offset + 3) & !3;

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

impl MessagePack for AutonomousPositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.position.pack(buf);
        buf.extend_from_slice(&self.instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        buf.extend_from_slice(&self.force_position_sequence.to_le_bytes());
        buf.push(self.last_contact);
        // Align
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }
    }
}

impl MessageUnpack for PrivateUpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 5 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;
        let position_type_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let position_type = match position_type_raw {
            0 => PositionType::Undef,
            1 => PositionType::Location,
            2 => PositionType::Destination,
            3 => PositionType::Instantiation,
            4 => PositionType::Sanctuary,
            5 => PositionType::Home,
            6 => PositionType::ActivationMove,
            7 => PositionType::Target,
            8 => PositionType::LinkedPortalOne,
            9 => PositionType::LastPortal,
            10 => PositionType::PortalStorm,
            11 => PositionType::CrashAndTurn,
            12 => PositionType::PortalSummonLoc,
            13 => PositionType::HouseBoot,
            14 => PositionType::LastOutsideDeath,
            15 => PositionType::LinkedLifestone,
            16 => PositionType::LinkedPortalTwo,
            17 => PositionType::Save1,
            18 => PositionType::Save2,
            19 => PositionType::Save3,
            20 => PositionType::Save4,
            21 => PositionType::Save5,
            22 => PositionType::Save6,
            23 => PositionType::Save7,
            24 => PositionType::Save8,
            25 => PositionType::Save9,
            26 => PositionType::RelativeDestination,
            27 => PositionType::TeleportedCharacter,
            _ => return None,
        };
        let pos = WorldPosition::unpack(data, offset)?;
        Some(PrivateUpdatePositionData {
            sequence,
            position_type,
            pos,
        })
    }
}

impl MessagePack for PrivateUpdatePositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        buf.extend_from_slice(&(self.position_type as u32).to_le_bytes());
        self.pos.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PublicUpdatePositionData {
    pub sequence: u8,
    pub guid: u32,
    pub position_type: PositionType,
    pub pos: WorldPosition,
}

impl MessageUnpack for PublicUpdatePositionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 9 > data.len() {
            return None;
        }
        let sequence = data[*offset];
        *offset += 1;
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let position_type_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let position_type = match position_type_raw {
            0 => PositionType::Undef,
            1 => PositionType::Location,
            2 => PositionType::Destination,
            3 => PositionType::Instantiation,
            4 => PositionType::Sanctuary,
            5 => PositionType::Home,
            6 => PositionType::ActivationMove,
            7 => PositionType::Target,
            8 => PositionType::LinkedPortalOne,
            9 => PositionType::LastPortal,
            10 => PositionType::PortalStorm,
            11 => PositionType::CrashAndTurn,
            12 => PositionType::PortalSummonLoc,
            13 => PositionType::HouseBoot,
            14 => PositionType::LastOutsideDeath,
            15 => PositionType::LinkedLifestone,
            16 => PositionType::LinkedPortalTwo,
            17 => PositionType::Save1,
            18 => PositionType::Save2,
            19 => PositionType::Save3,
            20 => PositionType::Save4,
            21 => PositionType::Save5,
            22 => PositionType::Save6,
            23 => PositionType::Save7,
            24 => PositionType::Save8,
            25 => PositionType::Save9,
            26 => PositionType::RelativeDestination,
            27 => PositionType::TeleportedCharacter,
            _ => return None,
        };
        let pos = WorldPosition::unpack(data, offset)?;
        Some(PublicUpdatePositionData {
            sequence,
            guid,
            position_type,
            pos,
        })
    }
}

impl MessagePack for PublicUpdatePositionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.push(self.sequence);
        buf.extend_from_slice(&self.guid.to_le_bytes());
        buf.extend_from_slice(&(self.position_type as u32).to_le_bytes());
        self.pos.pack(buf);
    }
}

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
    pub object_instance_sequence: u16,
    pub movement_sequence: u16,
    pub server_control_sequence: u16,
    pub is_autonomous: bool,
    pub movement_type: MovementType,
    pub motion_flags: u8,
    pub current_style: u16,
    pub data: MovementTypeData,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerTeleportData {
    pub teleport_sequence: u16,
}

impl MessageUnpack for PlayerTeleportData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 2 > data.len() {
            return None;
        }
        let teleport_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        *offset += 2;

        // Alignment (Writer.Align() in ACE)
        *offset = (*offset + 3) & !3;

        Some(PlayerTeleportData { teleport_sequence })
    }
}

impl MessagePack for PlayerTeleportData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        // Align to 4 bytes
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
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
    pub sticky_object: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToObject {
    pub target: u32,
    pub origin: Origin,
    pub params: MoveToParameters,
    pub run_rate: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToPosition {
    pub origin: Origin,
    pub params: MoveToParameters,
    pub run_rate: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TurnToObject {
    pub target: u32,
    pub desired_heading: f32,
    pub params: TurnToParameters,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TurnToHeading {
    pub params: TurnToParameters,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct Origin {
    pub cell_id: u32,
    pub position: crate::math::Vector3,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TurnToParameters {
    pub movement_parameters: u32,
    pub speed: f32,
    pub desired_heading: f32,
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

use serde::{Deserialize, Serialize};

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

impl MessageUnpack for MotionItem {
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

impl MessagePack for MotionItem {
    fn pack(&self, writer: &mut Vec<u8>) {
        use byteorder::{LittleEndian, WriteBytesExt};
        writer.write_u16::<LittleEndian>(self.command).unwrap();
        writer
            .write_u16::<LittleEndian>(self.packed_sequence)
            .unwrap();
        writer.write_f32::<LittleEndian>(self.speed).unwrap();
    }
}

impl MessageUnpack for MovementEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

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
        *offset = (*offset + 3) & !3;

        if *offset + 1 > data.len() {
            return None;
        }
        let movement_type_raw = data[*offset];
        let movement_type = match movement_type_raw {
            1 => MovementType::RawCommand,
            2 => MovementType::InterpretedCommand,
            3 => MovementType::StopRawCommand,
            4 => MovementType::StopInterpretedCommand,
            5 => MovementType::StopCompletely,
            6 => MovementType::MoveToObject,
            7 => MovementType::MoveToPosition,
            8 => MovementType::TurnToObject,
            9 => MovementType::TurnToHeading,
            _ => MovementType::Invalid,
        };
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
            _ => MovementTypeData::Invalid(MovementInvalid::unpack(data, offset, motion_flags)?),
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

impl MessagePack for MovementEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.guid.to_le_bytes());
        buf.extend_from_slice(&self.object_instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.movement_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.push(self.is_autonomous as u8);

        // Alignment
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }

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

impl MessageUnpack for Origin {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 16 > data.len() {
            return None;
        }
        let cell_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
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

impl MessagePack for Origin {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.cell_id.to_le_bytes());
        buf.extend_from_slice(&self.position.x.to_le_bytes());
        buf.extend_from_slice(&self.position.y.to_le_bytes());
        buf.extend_from_slice(&self.position.z.to_le_bytes());
    }
}

impl MessageUnpack for MoveToParameters {
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

impl MessagePack for MoveToParameters {
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

impl MessageUnpack for TurnToParameters {
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

impl MessagePack for TurnToParameters {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.movement_parameters.to_le_bytes());
        buf.extend_from_slice(&self.speed.to_le_bytes());
        buf.extend_from_slice(&self.desired_heading.to_le_bytes());
    }
}

impl MovementInvalid {
    fn unpack(data: &[u8], offset: &mut usize, flags: u8) -> Option<Self> {
        let state = InterpretedMotionState::unpack(data, offset)?;
        let sticky_object = if (flags & 0x01) != 0 {
            if *offset + 4 > data.len() {
                return None;
            }
            let guid = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            Some(guid)
        } else {
            None
        };
        Some(MovementInvalid {
            state,
            sticky_object,
        })
    }
}

impl MessagePack for MovementInvalid {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.state.pack(buf);
        if let Some(guid) = self.sticky_object {
            buf.extend_from_slice(&guid.to_le_bytes());
        }
    }
}

impl MessageUnpack for MoveToObject {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let target = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
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

impl MessagePack for MoveToObject {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.target.to_le_bytes());
        self.origin.pack(buf);
        self.params.pack(buf);
        buf.extend_from_slice(&self.run_rate.to_le_bytes());
    }
}

impl MessageUnpack for MoveToPosition {
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

impl MessagePack for MoveToPosition {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.origin.pack(buf);
        self.params.pack(buf);
        buf.extend_from_slice(&self.run_rate.to_le_bytes());
    }
}

impl MessageUnpack for TurnToObject {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let target = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
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

impl MessagePack for TurnToObject {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.target.to_le_bytes());
        buf.extend_from_slice(&self.desired_heading.to_le_bytes());
        self.params.pack(buf);
    }
}

impl MessageUnpack for TurnToHeading {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let params = TurnToParameters::unpack(data, offset)?;
        Some(TurnToHeading { params })
    }
}

impl MessagePack for TurnToHeading {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.params.pack(buf);
    }
}

impl MessageUnpack for InterpretedMotionState {
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
        *offset = (*offset + 3) & !3;

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

impl MessagePack for InterpretedMotionState {
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
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }
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

impl MessageUnpack for RawMotionState {
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

impl MessagePack for RawMotionState {
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct MoveToStateData {
    pub sequence: u32,
    pub raw_motion_state: RawMotionState,
    pub position: WorldPosition,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub contact_long_jump: u8,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct JumpData {
    pub sequence: u32,
    pub extent: f32,
    pub velocity: crate::math::Vector3,
    pub instance_sequence: u16,
    pub server_control_sequence: u16,
    pub teleport_sequence: u16,
    pub force_position_sequence: u16,
    pub object_guid: u32,
    pub spell_id: u32,
}

impl JumpData {
    pub fn unpack(data: &[u8], offset: &mut usize, sequence: u32) -> Option<Self> {
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
        let object_guid = LittleEndian::read_u32(&data[*offset + 24..*offset + 28]);
        let spell_id = LittleEndian::read_u32(&data[*offset + 28..*offset + 32]);
        *offset += 32;

        Some(JumpData {
            sequence,
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

    pub fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.extent.to_le_bytes());
        buf.extend_from_slice(&self.velocity.x.to_le_bytes());
        buf.extend_from_slice(&self.velocity.y.to_le_bytes());
        buf.extend_from_slice(&self.velocity.z.to_le_bytes());
        buf.extend_from_slice(&self.instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        buf.extend_from_slice(&self.force_position_sequence.to_le_bytes());
        buf.extend_from_slice(&self.object_guid.to_le_bytes());
        buf.extend_from_slice(&self.spell_id.to_le_bytes());
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AutonomyLevelData {
    pub level: u32,
}

impl MessageUnpack for AutonomyLevelData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let level = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(AutonomyLevelData { level })
    }
}

impl MessagePack for AutonomyLevelData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.extend_from_slice(&self.level.to_le_bytes());
    }
}

impl MoveToStateData {
    pub fn unpack(data: &[u8], offset: &mut usize, sequence: u32) -> Option<Self> {
        let raw_motion_state = RawMotionState::unpack(data, offset)?;
        let position = WorldPosition::unpack(data, offset)?;
        let instance_sequence = LittleEndian::read_u16(&data[*offset..*offset + 2]);
        let server_control_sequence = LittleEndian::read_u16(&data[*offset + 2..*offset + 4]);
        let teleport_sequence = LittleEndian::read_u16(&data[*offset + 4..*offset + 6]);
        let force_position_sequence = LittleEndian::read_u16(&data[*offset + 6..*offset + 8]);
        *offset += 8;
        let contact_long_jump = data[*offset];
        *offset += 1;

        // Align to 4 bytes
        while !(*offset).is_multiple_of(4) {
            *offset += 1;
        }

        Some(MoveToStateData {
            sequence,
            raw_motion_state,
            position,
            instance_sequence,
            server_control_sequence,
            teleport_sequence,
            force_position_sequence,
            contact_long_jump,
        })
    }

    pub fn pack(&self, buf: &mut Vec<u8>) {
        self.raw_motion_state.pack(buf);
        self.position.pack(buf);
        buf.extend_from_slice(&self.instance_sequence.to_le_bytes());
        buf.extend_from_slice(&self.server_control_sequence.to_le_bytes());
        buf.extend_from_slice(&self.teleport_sequence.to_le_bytes());
        buf.extend_from_slice(&self.force_position_sequence.to_le_bytes());
        buf.push(self.contact_long_jump);

        // Align to 4 bytes
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;
    use crate::protocol::messages::{GameMessage, constants::actions, game_action::GameActionData};

    #[test]
    fn test_public_update_position_fixture() {
        let expected = GameMessage::PublicUpdatePosition(Box::new(PublicUpdatePositionData {
            sequence: 12,
            guid: 0x50000001,
            position_type: PositionType::Location,
            pos: WorldPosition {
                landblock_id: 0x12345678,
                coords: crate::math::Vector3 {
                    x: 10.0,
                    y: 20.0,
                    z: 30.0,
                },
                rotation: crate::math::Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
        }));
        assert_pack_unpack_parity(fixtures::PUBLIC_UPDATE_POSITION, &expected);
    }

    #[test]
    fn test_private_update_position_fixture() {
        let expected = GameMessage::PrivateUpdatePosition(Box::new(PrivateUpdatePositionData {
            sequence: 12,
            position_type: PositionType::Location,
            pos: WorldPosition {
                landblock_id: 0x12345678,
                coords: crate::math::Vector3 {
                    x: 10.0,
                    y: 20.0,
                    z: 30.0,
                },
                rotation: crate::math::Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
        }));
        assert_pack_unpack_parity(fixtures::PRIVATE_UPDATE_POSITION, &expected);
    }

    #[test]
    fn test_movement_event_turn_to_obj_fixture() {
        let fixture = fixtures::MOVEMENT_TURN_TO_OBJ;
        let expected = MovementEventData {
            guid: 0x50000002,
            object_instance_sequence: 14,
            movement_sequence: 85,
            server_control_sequence: 15,
            is_autonomous: false,
            movement_type: MovementType::TurnToObject,
            motion_flags: 0,
            current_style: 73,
            data: MovementTypeData::TurnToObject(TurnToObject {
                target: 0x8000038A,
                desired_heading: 0.0,
                params: TurnToParameters {
                    movement_parameters: 0,
                    speed: 0.0,
                    desired_heading: 0.0,
                },
            }),
        };
        assert_pack_unpack_parity(fixture, &expected);
    }

    #[test]
    fn test_movement_event_move_to_pos_fixture() {
        let fixture = fixtures::MOVEMENT_MOVE_TO_POS;
        let expected = MovementEventData {
            guid: 0x50000002,
            object_instance_sequence: 14,
            movement_sequence: 86,
            server_control_sequence: 16,
            is_autonomous: true,
            movement_type: MovementType::MoveToPosition,
            motion_flags: 0,
            current_style: 74,
            data: MovementTypeData::MoveToPosition(MoveToPosition {
                origin: Origin {
                    cell_id: 0x12345678,
                    position: crate::math::Vector3 {
                        x: 100.0,
                        y: 200.0,
                        z: 300.0,
                    },
                },
                params: MoveToParameters {
                    movement_parameters: 0,
                    distance_to_object: 0.0,
                    min_distance: 0.0,
                    fail_distance: 100.0,
                    speed: 1.0,
                    walk_run_threshold: 5.0,
                    desired_heading: 0.0,
                },
                run_rate: 1.0,
            }),
        };
        assert_pack_unpack_parity(fixture, &expected);
    }

    #[test]
    fn test_move_to_parameters_default_size() {
        let params = MoveToParameters::default();
        let mut buf = Vec::new();
        params.pack(&mut buf);
        assert_eq!(buf.len(), 28);
    }

    #[test]
    fn test_player_teleport_parity() {
        let expected = PlayerTeleportData {
            teleport_sequence: 0x1234,
        };
        // Skip opcode (4 bytes)
        crate::protocol::messages::test_helpers::assert_pack_unpack_parity(
            &fixtures::PLAYER_TELEPORT[4..],
            &expected,
        );

        // Also verify dispatcher integration
        use crate::protocol::messages::GameMessage;
        let msg = GameMessage::unpack(fixtures::PLAYER_TELEPORT).unwrap();
        assert!(matches!(msg, GameMessage::PlayerTeleport(_)));
    }

    #[test]
    fn test_move_to_state_fixture() {
        use crate::protocol::messages::GameAction;
        let fixture = fixtures::MOVE_TO_STATE;
        let expected = GameMessage::GameAction(Box::new(GameAction {
            sequence: 0x5678,
            action_type: actions::MOVE_TO_STATE,
            data: GameActionData::MoveToState(Box::new(MoveToStateData {
                sequence: 0x5678,
                raw_motion_state: RawMotionState {
                    flags: RawMotionFlags::CURRENT_HOLD_KEY | RawMotionFlags::FORWARD_SPEED,
                    current_hold_key: Some(2),
                    forward_speed: Some(5.0),
                    commands: vec![MotionItem::new(1, 5, true, 1.0)],
                    ..Default::default()
                },
                position: WorldPosition {
                    landblock_id: 0x12345678,
                    coords: crate::math::Vector3 {
                        x: 10.0,
                        y: 20.0,
                        z: 30.0,
                    },
                    rotation: crate::math::Quaternion {
                        w: 1.0,
                        x: 0.0,
                        y: 0.0,
                        z: 0.0,
                    },
                },
                instance_sequence: 0xFF01,
                server_control_sequence: 0xFF02,
                teleport_sequence: 0xFF03,
                force_position_sequence: 0xFF04,
                contact_long_jump: 0x03,
            })),
        }));
        assert_pack_unpack_parity(fixture, &expected);
    }

    #[test]
    fn test_turn_to_parameters_default_size() {
        let params = TurnToParameters {
            movement_parameters: 0,
            speed: 0.0,
            desired_heading: 0.0,
        };
        let mut buf = Vec::new();
        params.pack(&mut buf);
        assert_eq!(buf.len(), 12);
    }

    #[test]
    fn test_vector_update_fixture() {
        // Opcode(4) + GUID(4) + Vel(12) + Omega(12) + Seq(2) + Seq(2) = 36 bytes
        let hex = "4EF70000010000500000803F0000004000004040CDCCCC3DCDCC4C3E9A99993E7B00C801";
        let expected = GameMessage::VectorUpdate(Box::new(VectorUpdateData {
            guid: 0x50000001,
            velocity: crate::math::Vector3 {
                x: 1.0,
                y: 2.0,
                z: 3.0,
            },
            omega: crate::math::Vector3 {
                x: 0.1,
                y: 0.2,
                z: 0.3,
            },
            instance_sequence: 123,
            vector_sequence: 456,
        }));
        crate::protocol::messages::test_helpers::assert_pack_unpack_parity(
            &hex::decode(hex).unwrap(),
            &expected,
        );
    }

    #[test]
    fn test_player_teleport_fixture() {
        let expected = GameMessage::PlayerTeleport(Box::new(PlayerTeleportData {
            teleport_sequence: 0,
        }));
        let hex = "51F7000000000000";
        let data = hex::decode(hex).unwrap();
        assert_pack_unpack_parity(&data, &expected);
    }

    #[test]
    fn test_gamemessage_routing_update_position() {
        use crate::protocol::messages::GameMessage;
        // UPDATE_POSITION (0xF748)
        // Opcode(4) + GUID(4) + Flags(4) + LB(4) + Pos(12) + Rot(16) + Sequences(8) = 52 bytes
        let pos_hex = "48F7000015000000000000005C8F1E120000000000000000000000000000803F0000000000000000000000000100020003000400";
        let pos_data = hex::decode(pos_hex).unwrap();
        let pos_msg = GameMessage::unpack(&pos_data).unwrap();
        assert!(matches!(pos_msg, GameMessage::UpdatePosition(_)));
    }

    #[test]
    fn test_jump_data_fixture() {
        use crate::protocol::messages::GameAction;
        // Opcode(4) + Sequence(4) + ActionType(4) + Payload(32) = 44 bytes
        // ACE Dump: 1BF60000 00002041 0000803F 00000040 00004040 0100 0200 0300 0400 78563412 00000000
        let hex = "B1F700002A0000001BF60000000020410000803F000000400000404001000200030004007856341200000000";
        let expected = GameMessage::GameAction(Box::new(GameAction {
            sequence: 0x2A,
            action_type: actions::JUMP,
            data: GameActionData::Jump(Box::new(JumpData {
                sequence: 0x2A,
                extent: 10.0,
                velocity: crate::math::Vector3 {
                    x: 1.0,
                    y: 2.0,
                    z: 3.0,
                },
                instance_sequence: 1,
                server_control_sequence: 2,
                teleport_sequence: 3,
                force_position_sequence: 4,
                object_guid: 0x12345678,
                spell_id: 0,
            })),
        }));
        crate::protocol::messages::test_helpers::assert_pack_unpack_parity(
            &hex::decode(hex).unwrap(),
            &expected,
        );
    }

    #[test]
    fn test_autonomy_level_fixture() {
        // Opcode(4) + Level(4) = 8 bytes
        let hex = "52F7000002000000";
        let expected = GameMessage::AutonomyLevel(Box::new(AutonomyLevelData { level: 2 }));
        crate::protocol::messages::test_helpers::assert_pack_unpack_parity(
            &hex::decode(hex).unwrap(),
            &expected,
        );
    }

    #[test]
    fn test_autonomous_position_fixture() {
        // Opcode(4) + Position(32) + Sequences(8) + Contact(1) + Align(3) = 48 bytes
        let hex = "53F7000078563412000020410000A0410000F0410000803F000000000000000000000000010002000300040001000000";
        let expected = GameMessage::AutonomousPosition(Box::new(AutonomousPositionData {
            position: WorldPosition {
                landblock_id: 0x12345678,
                coords: crate::math::Vector3 {
                    x: 10.0,
                    y: 20.0,
                    z: 30.0,
                },
                rotation: crate::math::Quaternion {
                    w: 1.0,
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
            instance_sequence: 1,
            server_control_sequence: 2,
            teleport_sequence: 3,
            force_position_sequence: 4,
            last_contact: 1,
        }));
        crate::protocol::messages::test_helpers::assert_pack_unpack_parity(
            &hex::decode(hex).unwrap(),
            &expected,
        );
    }
}
