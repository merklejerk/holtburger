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
