//! What a body is currently doing: the style it is in, the substate playing under that style, and
//! the modifiers layered on top.
//!
//! Retail's `MotionState` (`acclient.c:327700-327730`). Actions are deliberately absent: retail
//! queues them on the same struct, but nothing in this codebase issues an action yet, and a queue
//! with no producer would be a field nothing fills.

use crate::entity::{EntityMotionSnapshot, OrderedMotionScalar};
use crate::spatial::ContactState;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;

/// Inclusive interpreted-index runs sharing one retail command prefix.
///
/// Retail's exact 412-entry `dword_7C8190` expansion table (`acclient.c:39406`) has the interpreted
/// index in the low 16 bits of every entry. Compressing equal high halves yields these 66 runs
/// without losing information; exhaustive tests use an independent per-index fixture.
const INTERPRETED_COMMAND_PREFIX_RUNS: &[(u16, u16, u16)] = &[
    (0, 0, 0x8000),
    (1, 2, 0x8500),
    (3, 3, 0x4100),
    (4, 4, 0x4000),
    (5, 6, 0x4500),
    (7, 7, 0x4400),
    (8, 12, 0x4000),
    (13, 16, 0x6500),
    (17, 17, 0x4000),
    (18, 20, 0x4100),
    (21, 57, 0x4000),
    (58, 58, 0x2000),
    (59, 59, 0x2500),
    (60, 73, 0x8000),
    (74, 75, 0x1000),
    (76, 76, 0x1300),
    (77, 120, 0x1000),
    (121, 154, 0x1300),
    (155, 155, 0x1200),
    (156, 161, 0x1000),
    (162, 162, 0x0800),
    (163, 168, 0x0900),
    (169, 169, 0x0800),
    (170, 177, 0x0900),
    (178, 180, 0x0D00),
    (181, 183, 0x0800),
    (184, 185, 0x0900),
    (186, 191, 0x0D00),
    (192, 192, 0x0900),
    (193, 193, 0x0C00),
    (194, 196, 0x0900),
    (197, 197, 0x0D00),
    (198, 201, 0x0900),
    (202, 204, 0x1300),
    (205, 210, 0x1000),
    (211, 211, 0x4000),
    (212, 212, 0x1200),
    (213, 222, 0x0900),
    (223, 223, 0x1200),
    (224, 225, 0x4000),
    (226, 227, 0x1000),
    (228, 230, 0x4000),
    (231, 231, 0x0900),
    (232, 233, 0x8000),
    (234, 248, 0x4300),
    (249, 249, 0x4200),
    (250, 253, 0x4300),
    (254, 269, 0x0900),
    (270, 273, 0x1000),
    (274, 279, 0x0900),
    (280, 280, 0x4300),
    (281, 281, 0x1300),
    (282, 284, 0x4300),
    (285, 285, 0x0900),
    (286, 308, 0x1000),
    (309, 309, 0x1300),
    (310, 313, 0x4000),
    (314, 314, 0x1000),
    (315, 316, 0x8000),
    (317, 329, 0x4300),
    (330, 338, 0x1300),
    (339, 339, 0x1000),
    (340, 356, 0x0900),
    (357, 359, 0x1000),
    (360, 368, 0x0900),
    (369, 411, 0x1000),
];

/// A 32-bit motion-table command.
///
/// The high bits classify the command and the low bits identify it. Selection branches on the class,
/// so it is worth a type rather than bit tests scattered across the resolver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct MotionCommand(pub u32);

impl MotionCommand {
    const STYLE: u32 = 0x8000_0000;
    const SUBSTATE: u32 = 0x4000_0000;
    const MODIFIER: u32 = 0x2000_0000;
    const ACTION: u32 = 0x1000_0000;

    pub const fn raw(self) -> u32 {
        self.0
    }

    /// A stance: what the body is holding and how it stands.
    pub const fn is_style(self) -> bool {
        self.0 & Self::STYLE != 0
    }

    /// A looping substate under the current style, such as walking or turning.
    pub const fn is_substate(self) -> bool {
        self.0 & Self::SUBSTATE != 0
    }

    /// An additive layer that plays alongside the substate.
    pub const fn is_modifier(self) -> bool {
        self.0 & Self::MODIFIER != 0
    }

    /// A one-shot motion that interrupts and then returns to the substate.
    pub const fn is_action(self) -> bool {
        self.0 & Self::ACTION != 0
    }
}

impl MotionCommand {
    /// The motion-table command a server-reported interpreted command names.
    ///
    /// The wire carries only the low 16 bits; the table keys on the full 32-bit value whose high
    /// half classifies the command. The mapping is an explicit table rather than a mask because the
    /// class differs per command: forward locomotion is a substate, while turning and sidestepping
    /// are modifiers that layer on top of it.
    ///
    /// The exact mapping is retail's `dword_7C8190` (`acclient.c:39406`). Values above the retail
    /// table remain lossless in `InterpretedMotionCommand`, but are explicitly unsupported here.
    pub fn from_interpreted(command: InterpretedMotionCommand) -> Option<Self> {
        let index = command.raw();
        let (_, _, prefix) = INTERPRETED_COMMAND_PREFIX_RUNS
            .iter()
            .find(|(start, end, _)| (*start..=*end).contains(&index))?;
        Some(Self((u32::from(*prefix) << 16) | u32::from(index)))
    }

    /// Canonical forward substate selected for walking and reversed for backward movement.
    pub const WALK_FORWARD: Self = Self(0x4500_0005);
    /// Canonical backwards-walking substate.
    pub const WALK_BACKWARDS: Self = Self(0x4500_0006);
    /// Canonical forward substate selected for running.
    pub const RUN_FORWARD: Self = Self(0x4400_0007);
    /// Standing/default jump-charge presentation selected by retail (`Motion_Ready`,
    /// `acclient.c:40605`; ACE `MotionCommand.Ready`).
    pub const READY: Self = Self(0x4100_0003);
    /// Airborne presentation selected when contact disallows grounded locomotion.
    pub const FALLING: Self = Self(0x4000_0015);
    /// Turning is a modifier, so stopping it names the command retail stops: `TurnRight`.
    pub const TURN: Self = Self(0x6500_000D);
    /// Clockwise turn command selected by retail's heading reducer.
    pub const TURN_RIGHT: Self = Self(0x6500_000D);
    /// Counter-clockwise turn command selected by retail's heading reducer.
    pub const TURN_LEFT: Self = Self(0x6500_000E);
    /// Sidestepping is likewise one modifier, stopped by naming `SideStepRight`.
    pub const SIDESTEP: Self = Self(0x6500_000F);
}

impl From<u32> for MotionCommand {
    fn from(value: u32) -> Self {
        Self(value)
    }
}

/// What a body has been ordered to perform this tick, independent of who ordered it.
///
/// Retail applies these in a fixed order — style, then forward locomotion, then sidestep, then turn
/// — with each one a separate motion selection (`MotionInterp::apply_interpreted_movement`, ACE
/// `MotionInterp.cs:440-503`). Forward is a substate; sidestep and turn are modifiers that layer on
/// it, which is why a body can walk and turn at the same time.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct MotionOrder {
    /// Stance to be in. `None` leaves the current one alone.
    pub style: Option<MotionCommand>,
    /// Locomotion substate and its speed multiplier. `None` stops locomotion.
    pub forward: Option<(MotionCommand, f32)>,
    pub sidestep: Option<(MotionCommand, f32)>,
    pub turn: Option<(MotionCommand, f32)>,
}

/// Authored character presentation selected from physical support and jump lifecycle state.
///
/// Physics owns support, while an actor adapter owns whether a supported character is performing a
/// standing charge. Keeping the resolved state composite prevents physics and presentation from
/// independently interpreting the same transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharacterMotionPresentation {
    /// Preserve the actor's current grounded locomotion order.
    Grounded,
    /// Select the stance's supported standing-charge substate.
    Ready,
    /// Select the stance's unsupported travel substate.
    Falling,
    /// Stop planar presentation at the stance default when content lacks a requested jump row.
    StanceDefault,
}

impl CharacterMotionPresentation {
    /// Resolves retail's support-driven character presentation for one tick.
    ///
    /// `Unknown` preserves current movement until collision classifies the body. Explorer and the
    /// client otherwise agree that sliding is unsupported for authored planar locomotion.
    pub const fn resolve(contact: ContactState, launching: bool, standing_charge: bool) -> Self {
        if launching || matches!(contact, ContactState::Airborne | ContactState::Sliding) {
            Self::Falling
        } else if matches!(contact, ContactState::Grounded) && standing_charge {
            Self::Ready
        } else {
            Self::Grounded
        }
    }
}

impl MotionOrder {
    /// Reads one server-reported motion snapshot as an order.
    ///
    /// Speeds on the wire are multipliers applied to the selected motion, defaulting to 1.0 — ACE
    /// passes `InterpretedState.ForwardSpeed` straight into `movementParams.Speed`
    /// (`MotionInterp.cs:460`). An earlier reduction treated them as absolute metres per second.
    pub fn from_snapshot(snapshot: EntityMotionSnapshot) -> Self {
        let ordered = |command: Option<InterpretedMotionCommand>,
                       speed: Option<OrderedMotionScalar>| {
            let command = MotionCommand::from_interpreted(command?)?;
            Some((command, speed.map_or(1.0, OrderedMotionScalar::to_f32)))
        };

        Self {
            style: snapshot
                .current_style
                .map(|style| MotionCommand(style as u32)),
            forward: ordered(snapshot.forward_command, snapshot.forward_speed),
            sidestep: ordered(snapshot.sidestep_command, snapshot.sidestep_speed),
            turn: ordered(snapshot.turn_command, snapshot.turn_speed),
        }
    }

    /// Applies one already-resolved support presentation without changing stance or turn.
    pub const fn with_character_presentation(
        mut self,
        presentation: CharacterMotionPresentation,
    ) -> Self {
        match presentation {
            CharacterMotionPresentation::Grounded => {}
            CharacterMotionPresentation::Ready => {
                self.forward = Some((MotionCommand::READY, 1.0));
                self.sidestep = None;
            }
            CharacterMotionPresentation::Falling => {
                self.forward = Some((MotionCommand::FALLING, 1.0));
                self.sidestep = None;
            }
            CharacterMotionPresentation::StanceDefault => {
                self.forward = None;
                self.sidestep = None;
            }
        }
        self
    }
}

/// One motion active on a body, with the speed it was started at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ActiveMotion {
    pub command: MotionCommand,
    pub speed_mod: f32,
}

/// A body's current motion state.
#[derive(Debug, Clone, PartialEq)]
pub struct MotionState {
    pub style: MotionCommand,
    pub substate: MotionCommand,
    /// Speed multiplier the substate is playing at. Negative plays it backwards.
    pub substate_mod: f32,
    /// Modifiers layered on the substate, most recently added first — retail adds at the head.
    modifiers: Vec<ActiveMotion>,
}

impl Default for MotionState {
    fn default() -> Self {
        Self {
            style: MotionCommand(0),
            substate: MotionCommand(0),
            substate_mod: 1.0,
            modifiers: Vec::new(),
        }
    }
}

impl MotionState {
    pub fn modifiers(&self) -> &[ActiveMotion] {
        &self.modifiers
    }

    /// Adds a modifier unless it is already active or is the current substate.
    ///
    /// Returns whether it was added; retail's caller stops the conflicting motion and retries once
    /// on a refusal.
    pub fn add_modifier(&mut self, command: MotionCommand, speed_mod: f32) -> bool {
        if self.substate == command
            || self
                .modifiers
                .iter()
                .any(|modifier| modifier.command == command)
        {
            return false;
        }
        self.add_modifier_unchecked(command, speed_mod);
        true
    }

    /// Adds a modifier without the conflict check, retail's `add_modifier_no_check`.
    ///
    /// Used when a substate is displaced by a new one and has to keep playing as a modifier, where
    /// the conflict check would reject the very motion being preserved.
    pub fn add_modifier_unchecked(&mut self, command: MotionCommand, speed_mod: f32) {
        self.modifiers
            .insert(0, ActiveMotion { command, speed_mod });
    }

    pub fn remove_modifier(&mut self, command: MotionCommand) -> Option<ActiveMotion> {
        let index = self
            .modifiers
            .iter()
            .position(|modifier| modifier.command == command)?;
        Some(self.modifiers.remove(index))
    }

    pub fn clear_modifiers(&mut self) {
        self.modifiers.clear();
    }
}
