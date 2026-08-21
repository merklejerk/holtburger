//! What a body is currently doing: the style it is in, the substate playing under that style, and
//! the modifiers layered on top.
//!
//! Retail's `MotionState` (`acclient.c:327700-327730`). Actions are deliberately absent: retail
//! queues them on the same struct, but nothing in this codebase issues an action yet, and a queue
//! with no producer would be a field nothing fills.

use crate::entity::{EntityMotionSnapshot, OrderedMotionSpeed};
use holtburger_protocol::messages::movement::InterpretedMotionCommand;

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
    /// Values from ACE `MotionCommand`, cross-checked against
    /// `holtburger_dat::file_type::MotionTable`'s own constants.
    pub fn from_interpreted(command: InterpretedMotionCommand) -> Option<Self> {
        Some(Self(match command {
            InterpretedMotionCommand::WALK_FORWARD => 0x4500_0005,
            InterpretedMotionCommand::WALK_BACKWARDS => 0x4500_0006,
            InterpretedMotionCommand::RUN_FORWARD => 0x4400_0007,
            InterpretedMotionCommand::TURN_RIGHT => 0x6500_000D,
            InterpretedMotionCommand::TURN_LEFT => 0x6500_000E,
            InterpretedMotionCommand::SIDESTEP_RIGHT => 0x6500_000F,
            InterpretedMotionCommand::SIDESTEP_LEFT => 0x6500_0010,
            _ => return None,
        }))
    }

    /// Canonical forward substate selected for walking and reversed for backward movement.
    pub const WALK_FORWARD: Self = Self(0x4500_0005);
    /// Canonical forward substate selected for running.
    pub const RUN_FORWARD: Self = Self(0x4400_0007);
    /// Standing/default jump-charge presentation selected by retail.
    pub const READY: Self = Self(0x4000_003C);
    /// Airborne presentation selected when contact disallows grounded locomotion.
    pub const FALLING: Self = Self(0x4000_0015);
    /// Turning is a modifier, so stopping it names the command retail stops: `TurnRight`.
    pub const TURN: Self = Self(0x6500_000D);
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

impl MotionOrder {
    /// Reads one server-reported motion snapshot as an order.
    ///
    /// Speeds on the wire are multipliers applied to the selected motion, defaulting to 1.0 — ACE
    /// passes `InterpretedState.ForwardSpeed` straight into `movementParams.Speed`
    /// (`MotionInterp.cs:460`). An earlier reduction treated them as absolute metres per second.
    pub fn from_snapshot(snapshot: EntityMotionSnapshot) -> Self {
        let ordered = |command: Option<InterpretedMotionCommand>,
                       speed: Option<OrderedMotionSpeed>| {
            let command = MotionCommand::from_interpreted(command?)?;
            Some((command, speed.map_or(1.0, OrderedMotionSpeed::to_f32)))
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
