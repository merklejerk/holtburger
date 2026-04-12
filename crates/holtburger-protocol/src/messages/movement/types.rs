use crate::messages::utils::{align_offset, pad_to_4};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian};
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
pub enum MotionStance {
    Invalid = 0x8000_0000,
    HandCombat = 0x8000_003c,
    NonCombat = 0x8000_003d,
    SwordCombat = 0x8000_003e,
    BowCombat = 0x8000_003f,
    SwordShieldCombat = 0x8000_0040,
    CrossbowCombat = 0x8000_0041,
    UnusedCombat = 0x8000_0042,
    SlingCombat = 0x8000_0043,
    TwoHandedSwordCombat = 0x8000_0044,
    TwoHandedStaffCombat = 0x8000_0045,
    DualWieldCombat = 0x8000_0046,
    ThrownWeaponCombat = 0x8000_0047,
    Graze = 0x8000_0048,
    Magic = 0x8000_0049,
    BowNoAmmo = 0x8000_00e8,
    CrossbowNoAmmo = 0x8000_00e9,
    AtlatlCombat = 0x8000_013b,
    ThrownShieldCombat = 0x8000_013c,
}

impl MotionStance {
    const RAW_PREFIX: u32 = 0x8000_0000;

    pub fn from_interpreted(style: u16) -> Option<Self> {
        Self::from_repr(Self::RAW_PREFIX | u32::from(style))
    }

    pub const fn interpreted(self) -> u16 {
        (self as u32 & 0xFFFF) as u16
    }
}

/// Low 16-bit interpreted motion command value derived from ACE MotionCommand.
///
/// This remains an open wrapper instead of a closed enum because ACE's command
/// space is large and not all values carried through interpreted motion are
/// modeled here. Named constants below cover the high-signal commands we
/// currently care about while preserving unknown values losslessly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct InterpretedMotionCommand(pub u16);

impl InterpretedMotionCommand {
    pub const STOP: Self = Self(0x0004);
    pub const WALK_FORWARD: Self = Self(0x0005);
    pub const WALK_BACKWARDS: Self = Self(0x0006);
    pub const RUN_FORWARD: Self = Self(0x0007);
    pub const TURN_RIGHT: Self = Self(0x000d);
    pub const TURN_LEFT: Self = Self(0x000e);
    pub const SIDESTEP_RIGHT: Self = Self(0x000f);
    pub const SIDESTEP_LEFT: Self = Self(0x0010);
    pub const DEAD: Self = Self(0x0011);

    pub fn raw(self) -> u16 {
        self.0
    }

    pub fn is_dead(self) -> bool {
        self.0 == Self::DEAD.0
    }

    pub fn is_forward_locomotion(self) -> bool {
        self.0 == Self::WALK_FORWARD.0 || self.0 == Self::RUN_FORWARD.0
    }

    pub fn is_locomotion(self) -> bool {
        self.0 == Self::WALK_FORWARD.0
            || self.0 == Self::WALK_BACKWARDS.0
            || self.0 == Self::RUN_FORWARD.0
            || self.0 == Self::TURN_RIGHT.0
            || self.0 == Self::TURN_LEFT.0
            || self.0 == Self::SIDESTEP_RIGHT.0
            || self.0 == Self::SIDESTEP_LEFT.0
    }
}

impl From<u16> for InterpretedMotionCommand {
    fn from(value: u16) -> Self {
        Self(value)
    }
}

impl From<InterpretedMotionCommand> for u16 {
    fn from(value: InterpretedMotionCommand) -> Self {
        value.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, FromRepr)]
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
    pub forward_command: Option<InterpretedMotionCommand>,
    pub sidestep_command: Option<InterpretedMotionCommand>,
    pub turn_command: Option<InterpretedMotionCommand>,
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
            forward_command = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]).into());
            *offset += 2;
        }

        let mut sidestep_command = None;
        if flags.contains(MovementStateFlags::SIDE_STEP_COMMAND) {
            if *offset + 2 > data.len() {
                return None;
            }
            sidestep_command = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]).into());
            *offset += 2;
        }

        let mut turn_command = None;
        if flags.contains(MovementStateFlags::TURN_COMMAND) {
            if *offset + 2 > data.len() {
                return None;
            }
            turn_command = Some(LittleEndian::read_u16(&data[*offset..*offset + 2]).into());
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
            buf.extend_from_slice(&u16::from(cmd).to_le_bytes());
        }

        if let Some(cmd) = self.sidestep_command {
            buf.extend_from_slice(&u16::from(cmd).to_le_bytes());
        }

        if let Some(cmd) = self.turn_command {
            buf.extend_from_slice(&u16::from(cmd).to_le_bytes());
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
    pub command: InterpretedMotionCommand,
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

    pub fn new(
        command: impl Into<InterpretedMotionCommand>,
        sequence: u16,
        is_autonomous: bool,
        speed: f32,
    ) -> Self {
        let packed_sequence = (sequence & 0x7FFF) | (if is_autonomous { 1 << 15 } else { 0 });
        Self {
            command: command.into(),
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
        let command = LittleEndian::read_u16(&data[*offset..*offset + 2]).into();
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
        writer
            .write_u16::<LittleEndian>(u16::from(self.command))
            .unwrap();
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

impl RawMotionState {
    pub fn current_stance(&self) -> Option<MotionStance> {
        self.current_style.and_then(MotionStance::from_repr)
    }

    pub fn set_current_stance(&mut self, stance: MotionStance) {
        self.flags |= RawMotionFlags::CURRENT_STYLE;
        self.current_style = Some(stance as u32);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn motion_stance_round_trips_interpreted_style() {
        let stance = MotionStance::from_interpreted(0x003e);

        assert_eq!(stance, Some(MotionStance::SwordCombat));
        assert_eq!(MotionStance::SwordCombat.interpreted(), 0x003e);
    }

    #[test]
    fn raw_motion_state_can_set_typed_current_stance() {
        let mut state = RawMotionState::default();
        state.set_current_stance(MotionStance::Magic);

        assert!(state.flags.contains(RawMotionFlags::CURRENT_STYLE));
        assert_eq!(state.current_style, Some(MotionStance::Magic as u32));
        assert_eq!(state.current_stance(), Some(MotionStance::Magic));
    }

    #[test]
    fn interpreted_motion_command_constants_match_ace_low_bits() {
        assert_eq!(InterpretedMotionCommand::STOP.raw(), 0x0004);
        assert_eq!(InterpretedMotionCommand::WALK_FORWARD.raw(), 0x0005);
        assert_eq!(InterpretedMotionCommand::WALK_BACKWARDS.raw(), 0x0006);
        assert_eq!(InterpretedMotionCommand::RUN_FORWARD.raw(), 0x0007);
        assert_eq!(InterpretedMotionCommand::TURN_RIGHT.raw(), 0x000d);
        assert_eq!(InterpretedMotionCommand::TURN_LEFT.raw(), 0x000e);
        assert_eq!(InterpretedMotionCommand::SIDESTEP_RIGHT.raw(), 0x000f);
        assert_eq!(InterpretedMotionCommand::SIDESTEP_LEFT.raw(), 0x0010);
        assert_eq!(InterpretedMotionCommand::DEAD.raw(), 0x0011);
    }

    #[test]
    fn interpreted_motion_command_predicates_match_expected_commands() {
        assert!(InterpretedMotionCommand::WALK_FORWARD.is_forward_locomotion());
        assert!(InterpretedMotionCommand::RUN_FORWARD.is_forward_locomotion());
        assert!(!InterpretedMotionCommand::WALK_BACKWARDS.is_forward_locomotion());

        assert!(InterpretedMotionCommand::WALK_FORWARD.is_locomotion());
        assert!(InterpretedMotionCommand::WALK_BACKWARDS.is_locomotion());
        assert!(InterpretedMotionCommand::RUN_FORWARD.is_locomotion());
        assert!(InterpretedMotionCommand::TURN_RIGHT.is_locomotion());
        assert!(InterpretedMotionCommand::TURN_LEFT.is_locomotion());
        assert!(InterpretedMotionCommand::SIDESTEP_RIGHT.is_locomotion());
        assert!(InterpretedMotionCommand::SIDESTEP_LEFT.is_locomotion());
        assert!(!InterpretedMotionCommand::DEAD.is_locomotion());
        assert!(InterpretedMotionCommand::DEAD.is_dead());
    }
}
