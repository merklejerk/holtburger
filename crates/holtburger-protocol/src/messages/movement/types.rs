use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use crate::messages::utils::{align_offset, pad_to_4};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use serde::{Deserialize, Serialize};
use strum_macros::FromRepr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, FromRepr)]
#[repr(u32)]
pub enum HoldKey {
    Invalid = 0,
    None = 1,
    Run = 2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, FromRepr)]
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
