//! Per-body authored-motion playback, owned by the authority that spawned the body.
//!
//! Sequence resolution is stateless, but playback is not: a cursor has to survive between ticks or
//! every tick would restart the animation. That state lives here rather than on the entity, so a
//! client `WorldState` and an Explorer registry can each own their own playback without sharing a
//! table — which is what keeps them separate semantic authorities.

use holtburger_common::{Guid, RigidTransform};
use holtburger_content::MotionSequenceTable;
use std::collections::HashMap;

use super::selection::{select_motion, set_default_state, stop_motion};
use super::sequence::{CurrentSequenceClip, MotionClipCompletion};
use super::sequence::{MotionSequenceRuntime, SequenceTick};
use super::state::{MotionCommand, MotionOrder, MotionState};

/// One body's playback: what it is doing, where the cursor is, and what the last tick contributed.
#[derive(Debug, Clone)]
pub struct BodyMotionRuntime {
    /// Table this playback was built against. A body that changes tables starts over, because its
    /// substate and cursor mean nothing in a table that does not define them.
    motion_table_id: u32,
    state: MotionState,
    sequence: MotionSequenceRuntime,
    /// Contribution the most recent tick produced, held for the solver to read the way a body holds
    /// the velocity its last tick achieved.
    tick: SequenceTick,
}

/// Which clip the host has a body playing, and how to play it.
///
/// Deliberately a distinct type from the host's own sequence state, which carries the installed clip
/// list, pending links, and leftover time — none of which a frontend may see or act on. Which clip
/// follows is link resolution against host state, so a clip change arrives only as a new projection.
///
/// It carries no frame number. Host and frontend both advance by `framerate x dt`, so a phase
/// offset between them never accumulates, and entering a clip re-anchors both at the same frame
/// anyway. The window and the rate are not optional: a negative rate is entered at `high_frame` and
/// played backwards, a zero rate holds, and a window can be narrower than its animation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlayingMotionClip {
    /// Animation currently playing.
    pub animation_id: u32,
    /// Rate to advance at. Negative plays the window backwards.
    pub framerate: f32,
    /// Inclusive traversal bounds, already resolved against the animation's frame count.
    pub low_frame: i32,
    pub high_frame: i32,
    /// Whether presentation loops this clip or holds its terminal pose for the successor.
    pub completion: MotionClipCompletion,
}

impl PlayingMotionClip {
    fn of(current: CurrentSequenceClip<'_>) -> Self {
        Self {
            animation_id: current.node.animation().id,
            framerate: current.node.framerate(),
            low_frame: current.node.low_frame(),
            high_frame: current.node.high_frame(),
            completion: current.completion,
        }
    }
}

impl BodyMotionRuntime {
    /// Starts one isolated body at the table's authored default state.
    pub fn new(table: &MotionSequenceTable) -> Self {
        let mut runtime = Self {
            motion_table_id: table.id,
            state: MotionState::default(),
            sequence: MotionSequenceRuntime::new(),
            tick: SequenceTick::identity(),
        };
        set_default_state(table, &mut runtime.state, &mut runtime.sequence);
        runtime
    }

    /// The clip this body is playing, for a frontend to render.
    ///
    /// `None` means the body has no clip installed at all, which is a body that does not animate
    /// rather than one whose animation is unknown.
    pub fn playing_clip(&self) -> Option<PlayingMotionClip> {
        self.sequence.current_clip().map(PlayingMotionClip::of)
    }

    pub fn state(&self) -> &MotionState {
        &self.state
    }

    pub fn sequence(&self) -> &MotionSequenceRuntime {
        &self.sequence
    }

    pub fn tick(&self) -> &SequenceTick {
        &self.tick
    }

    /// Applies one order and advances this isolated body's provisional playback.
    pub fn drive(
        &mut self,
        table: &MotionSequenceTable,
        order: MotionOrder,
        quantum: f32,
    ) -> &SequenceTick {
        if self.motion_table_id != table.id {
            *self = Self::new(table);
        }
        apply_order(table, &mut self.state, &mut self.sequence, order);
        self.tick = self.sequence.advance(quantum);
        &self.tick
    }
}

/// Authored-motion playback for every body one authority simulates.
#[derive(Debug, Clone, Default)]
pub struct MotionRuntimeRegistry {
    bodies: HashMap<Guid, BodyMotionRuntime>,
}

impl MotionRuntimeRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, guid: Guid) -> Option<&BodyMotionRuntime> {
        self.bodies.get(&guid)
    }

    /// The clip one body is playing, if it is playing one.
    pub fn playing_clip(&self, guid: Guid) -> Option<PlayingMotionClip> {
        self.bodies
            .get(&guid)
            .and_then(BodyMotionRuntime::playing_clip)
    }

    /// Current semantic playback state for diagnostics owned by the producer registry.
    pub fn state(&self, guid: Guid) -> Option<&MotionState> {
        self.bodies.get(&guid).map(|runtime| runtime.state())
    }

    /// The authored contribution one body's most recent tick produced.
    pub fn authored_offset(&self, guid: Guid) -> Option<RigidTransform> {
        self.bodies.get(&guid).map(|runtime| runtime.tick.offset)
    }

    pub fn forget(&mut self, guid: Guid) {
        self.bodies.remove(&guid);
    }

    /// Commits one caller-proposed body playback after its enclosing transaction succeeds.
    pub fn replace_body(&mut self, guid: Guid, runtime: BodyMotionRuntime) {
        self.bodies.insert(guid, runtime);
    }

    pub fn retain_bodies(&mut self, keep: impl Fn(Guid) -> bool) {
        self.bodies.retain(|guid, _| keep(*guid));
    }

    pub fn len(&self) -> usize {
        self.bodies.len()
    }

    pub fn is_empty(&self) -> bool {
        self.bodies.is_empty()
    }

    /// Brings one body's playback in line with its order, then advances it by the tick.
    ///
    /// Applying the order every tick is what makes this idempotent: re-issuing the motion already
    /// running is a no-op selection, so a body that is told the same thing forever keeps playing
    /// rather than restarting.
    pub fn drive(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        order: MotionOrder,
        quantum: f32,
    ) -> &SequenceTick {
        self.bodies
            .entry(guid)
            .or_insert_with(|| BodyMotionRuntime::new(table))
            .drive(table, order, quantum)
    }
}

/// Applies one order in retail's fixed order: style, then locomotion, then sidestep, then turn.
///
/// Each layer is stopped explicitly when its command is absent, because retail stops the motion
/// rather than letting it keep running (`MotionInterp::apply_interpreted_movement`).
fn apply_order(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    order: MotionOrder,
) {
    if let Some(style) = order.style {
        select_motion(table, state, sequence, style, 1.0);
    }

    match order.forward {
        Some((command, speed)) => {
            select_motion(table, state, sequence, command, speed);
        }
        None => {
            // Stopping locomotion means returning to the style's default substate, which is what
            // `stop_motion` does for whatever substate is currently running. Sidestep and turn
            // command IDs also carry the substate bit, however, and retail can resolve either one
            // through a cycle before its modifier fallback (`acclient.c:324330-324520`). Preserve
            // that cycle while its own semantic channel remains ordered or re-applying this order
            // every tick would stop and restart it before it advances.
            let running = state.substate;
            if running.is_substate()
                && Some(running.raw()) != table.style_default(state.style.raw())
                && !ordered_command_is(order.sidestep, running)
                && !ordered_command_is(order.turn, running)
            {
                stop_motion(table, state, sequence, running);
            }
        }
    }

    apply_modifier(
        table,
        state,
        sequence,
        order.sidestep,
        MotionCommand::SIDESTEP,
    );
    apply_modifier(table, state, sequence, order.turn, MotionCommand::TURN);
}

fn apply_modifier(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    ordered: Option<(MotionCommand, f32)>,
    family: MotionCommand,
) {
    match ordered {
        Some((command, speed)) => {
            select_motion(table, state, sequence, command, speed);
        }
        None => {
            stop_motion(table, state, sequence, family);
        }
    }
}

fn ordered_command_is(ordered: Option<(MotionCommand, f32)>, command: MotionCommand) -> bool {
    ordered.is_some_and(|(ordered, _)| ordered == command)
}
