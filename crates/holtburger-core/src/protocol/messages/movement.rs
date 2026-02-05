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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;

    #[test]
    fn test_movement_event_turn_to_obj_parity() {
        let fixture = fixtures::MOVEMENT_TURN_TO_OBJ;
        let mut offset = 0;
        let unpacked = MovementEventData::unpack(fixture, &mut offset).unwrap();

        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(fixture, packed);

        // Verify the values from the Gold Standard fixture
        assert_eq!(unpacked.guid, 0x50000002);
        assert_eq!(unpacked.movement_type, MovementType::TurnToObject);
        if let MovementTypeData::TurnToObject(data) = unpacked.data {
            assert_eq!(data.target, 0x8000038A);
            assert_eq!(data.desired_heading, 0.0);
            assert_eq!(data.params.speed, 0.0);
        } else {
            panic!("Expected TurnToObject data");
        }
    }

    #[test]
    fn test_movement_event_move_to_pos_parity() {
        let fixture = fixtures::MOVEMENT_MOVE_TO_POS;
        let mut offset = 0;
        let unpacked = MovementEventData::unpack(fixture, &mut offset).unwrap();

        let mut packed = Vec::new();
        unpacked.pack(&mut packed);
        assert_eq!(fixture, packed);

        // Verify the values
        assert_eq!(unpacked.guid, 0x50000002);
        assert_eq!(unpacked.movement_type, MovementType::MoveToPosition);
        if let MovementTypeData::MoveToPosition(data) = unpacked.data {
            assert_eq!(data.origin.cell_id, 0x12345678);
            assert_eq!(data.run_rate, 1.0);
        } else {
            panic!("Expected MoveToPosition data");
        }
    }

    #[test]
    fn test_move_to_parameters_default_size() {
        let params = MoveToParameters::default();
        let mut buf = Vec::new();
        params.pack(&mut buf);
        assert_eq!(buf.len(), 28);
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
}
