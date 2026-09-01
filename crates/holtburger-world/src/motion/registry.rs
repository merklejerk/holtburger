//! Per-body authored-motion playback, owned by the authority that spawned the body.
//!
//! Sequence resolution is stateless, but playback is not: a cursor has to survive between ticks or
//! every tick would restart the animation. That state lives here rather than on the entity, so a
//! client `WorldState` and an Explorer registry can each own their own playback without sharing a
//! table — which is what keeps them separate semantic authorities.

use crate::entity::EntityMotionAction;
use holtburger_common::{Guid, RigidTransform};
use holtburger_content::MotionSequenceTable;
use std::collections::HashMap;
use std::collections::VecDeque;

use super::selection::{
    ActionSelectionOutcome, select_action, select_modifier, select_motion, set_default_state,
    stop_motion,
};
use super::sequence::{CurrentSequenceClip, MotionClipCompletion};
use super::sequence::{MotionSequenceRuntime, SequenceTick};
use super::state::{MotionCommand, MotionOrder, MotionState};

/// Retail `RunForward` state velocity used by `CMotionInterp::get_adjusted_max_speed`
/// (`acclient.c:329811-329837,329866-329872`).
pub(super) const RETAIL_RUN_FORWARD_BASE_SPEED_MPS: f32 = 4.0;

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
    /// Last valid `RunForward` multiplier, matching retail's persistent `my_run_rate` fact.
    retained_run_rate_multiplier: Option<f32>,
    /// Explicit ordered channels the current table could not model, retained to deduplicate the
    /// producer diagnostic until the order changes.
    unmodelled: UnmodelledMotionChannels,
    /// Latest steady destination retained while a transient action owns playback.
    steady_order: MotionOrder,
    /// FIFO transient edges awaiting installation after the active action.
    action_queue: VecDeque<EntityMotionAction>,
    /// Action whose exact selector-owned boundary has not completed yet.
    active_action: Option<EntityMotionAction>,
    /// Fresh selector rejections awaiting body-context reporting by the registry owner.
    rejected_actions: Vec<EntityMotionAction>,
}

/// Result of offering one transient edge to retail's six-action runtime bound.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionActionEnqueueOutcome {
    /// Edge entered the FIFO and will start through ordinary selector advancement.
    Queued,
    /// Active plus pending actions already reached retail's bound of six.
    Overflow,
}

/// Explicit order channels rejected by motion-table selection on the latest drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct UnmodelledMotionChannels {
    /// Requested style that could not be selected.
    style: Option<MotionCommand>,
    /// Requested forward/substate command that could not be selected.
    forward: Option<MotionCommand>,
    /// Requested sidestep command that could not be selected.
    sidestep: Option<MotionCommand>,
    /// Requested turn command that could not be selected.
    turn: Option<MotionCommand>,
}

impl UnmodelledMotionChannels {
    fn newly_present_since(
        self,
        previous: Self,
    ) -> impl Iterator<Item = (&'static str, MotionCommand)> {
        [
            ("style", self.style, previous.style),
            ("forward", self.forward, previous.forward),
            ("sidestep", self.sidestep, previous.sidestep),
            ("turn", self.turn, previous.turn),
        ]
        .into_iter()
        .filter_map(|(channel, current, prior)| (current != prior).then_some((channel, current?)))
    }
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

/// One authored animation held at an exact host-owned frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SettledMotionPose {
    /// Animation whose pose should be sampled.
    pub animation_id: u32,
    /// Integral frame at which the authoritative cursor is resting.
    pub frame: i32,
}

/// Current presentation level derived from the authoritative motion cursor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MotionPresentation {
    /// An advancing clip whose phase remains presentation-owned.
    Playing(PlayingMotionClip),
    /// A stationary pose whose exact frame must survive late realization.
    Settled(SettledMotionPose),
}

impl MotionPresentation {
    /// Animation shared by either the moving or settled presentation state.
    pub const fn animation_id(self) -> u32 {
        match self {
            Self::Playing(clip) => clip.animation_id,
            Self::Settled(pose) => pose.animation_id,
        }
    }
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
            retained_run_rate_multiplier: None,
            unmodelled: UnmodelledMotionChannels::default(),
            steady_order: MotionOrder::default(),
            action_queue: VecDeque::new(),
            active_action: None,
            rejected_actions: Vec::new(),
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

    /// Current lossless presentation level without projecting a hot cursor for moving clips.
    pub fn motion_presentation(&self) -> Option<MotionPresentation> {
        let current = self.sequence.current_clip()?;
        if current.node.is_advancing() {
            Some(MotionPresentation::Playing(PlayingMotionClip::of(current)))
        } else {
            Some(MotionPresentation::Settled(SettledMotionPose {
                animation_id: current.node.animation().id,
                frame: self.sequence.current_frame(),
            }))
        }
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

    /// Currently playing transient edge, if one owns the sequence.
    pub const fn active_action(&self) -> Option<EntityMotionAction> {
        self.active_action
    }

    /// Number of active plus pending transient actions.
    pub fn action_count(&self) -> usize {
        self.action_queue.len() + usize::from(self.active_action.is_some())
    }

    /// Offers one edge to retail's bounded FIFO without selecting content yet.
    pub fn enqueue_action(&mut self, action: EntityMotionAction) -> MotionActionEnqueueOutcome {
        const MAX_ACTIONS: usize = 6;
        if self.action_count() >= MAX_ACTIONS {
            return MotionActionEnqueueOutcome::Overflow;
        }
        self.action_queue.push_back(action);
        MotionActionEnqueueOutcome::Queued
    }

    /// Returns retail's adjusted maximum interpolation speed for this playback, when usable.
    pub fn adjusted_max_speed_mps(&self) -> Option<f32> {
        let multiplier = if self.state.substate == MotionCommand::RUN_FORWARD
            && valid_speed_multiplier(self.state.substate_mod)
        {
            Some(self.state.substate_mod)
        } else {
            self.retained_run_rate_multiplier
        }?;
        Some(multiplier * RETAIL_RUN_FORWARD_BASE_SPEED_MPS)
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
        if let Some((MotionCommand::RUN_FORWARD, speed)) = order.forward
            && valid_speed_multiplier(speed)
        {
            self.retained_run_rate_multiplier = Some(speed);
        }
        self.steady_order = order;
        // Retail applies steady commands to the same sequence even while an action owns its
        // non-cyclic prefix. Selection replaces only the cyclic return suffix, so a stance or
        // locomotion update retargets the action's authored return without restarting it
        // (`CMotionTable::GetObjectSequence`, `acclient.c:324230-324400`).
        self.unmodelled = apply_order(table, &mut self.state, &mut self.sequence, order);
        if self.active_action.is_none() {
            self.start_next_action(table);
        }
        self.tick = self.sequence.advance(quantum);
        if self.tick.action_completed {
            self.active_action = None;
            self.unmodelled = apply_order(
                table,
                &mut self.state,
                &mut self.sequence,
                self.steady_order,
            );
            self.start_next_action(table);
        }
        &self.tick
    }

    fn start_next_action(&mut self, table: &MotionSequenceTable) {
        while self.active_action.is_none() {
            let Some(action) = self.action_queue.pop_front() else {
                return;
            };
            match select_action(
                table,
                &mut self.state,
                &mut self.sequence,
                action.command,
                action.speed.to_f32(),
            ) {
                ActionSelectionOutcome::Selected => self.active_action = Some(action),
                ActionSelectionOutcome::CompletedWithoutClips => {}
                ActionSelectionOutcome::Unmodelled => self.rejected_actions.push(action),
            }
        }
    }
}

fn valid_speed_multiplier(speed: f32) -> bool {
    speed.is_finite() && speed > f32::EPSILON
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

    /// Current presentation level for one body, including an exact frame when it is stationary.
    pub fn motion_presentation(&self, guid: Guid) -> Option<MotionPresentation> {
        self.bodies
            .get(&guid)
            .and_then(BodyMotionRuntime::motion_presentation)
    }

    /// Current semantic playback state for diagnostics owned by the producer registry.
    pub fn state(&self, guid: Guid) -> Option<&MotionState> {
        self.bodies.get(&guid).map(|runtime| runtime.state())
    }

    /// The authored contribution one body's most recent tick produced.
    pub fn authored_offset(&self, guid: Guid) -> Option<RigidTransform> {
        self.bodies.get(&guid).map(|runtime| runtime.tick.offset)
    }

    /// Whether one body has an active or queued transient action owning future playback.
    pub fn has_actions(&self, guid: Guid) -> bool {
        self.bodies
            .get(&guid)
            .is_some_and(|runtime| runtime.action_count() != 0)
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

    /// Enqueues one transient action on the body runtime selected by its effective table.
    pub fn enqueue_action(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        action: EntityMotionAction,
    ) -> MotionActionEnqueueOutcome {
        let runtime = self
            .bodies
            .entry(guid)
            .or_insert_with(|| BodyMotionRuntime::new(table));
        if runtime.motion_table_id != table.id {
            *runtime = BodyMotionRuntime::new(table);
        }
        runtime.enqueue_action(action)
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
        let runtime = self
            .bodies
            .entry(guid)
            .or_insert_with(|| BodyMotionRuntime::new(table));
        let previous_unmodelled = runtime.unmodelled;
        runtime.drive(table, order, quantum);
        for action in std::mem::take(&mut runtime.rejected_actions) {
            log::warn!(
                "body 0x{guid:08X} motion table 0x{:08X} cannot route admitted action 0x{:08X} in style 0x{:08X} from substate 0x{:08X} (source {:?}, action sequence {})",
                table.id,
                action.command.raw(),
                runtime.state.style.raw(),
                runtime.state.substate.raw(),
                action.source,
                action.action_sequence,
            );
        }
        for (channel, command) in runtime.unmodelled.newly_present_since(previous_unmodelled) {
            log::warn!(
                "body 0x{guid:08X} motion table 0x{:08X} cannot play admitted {channel} command 0x{:08X} in style 0x{:08X}",
                table.id,
                command.raw(),
                runtime.state.style.raw(),
            );
        }
        &runtime.tick
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
) -> UnmodelledMotionChannels {
    let mut unmodelled = UnmodelledMotionChannels::default();
    if let Some(style) = order.style
        && !select_motion(table, state, sequence, style, 1.0).is_modelled()
    {
        unmodelled.style = Some(style);
    }

    match order.forward {
        Some((command, speed)) => {
            if !select_motion(table, state, sequence, command, speed).is_modelled() {
                unmodelled.forward = Some(command);
            }
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

    unmodelled.sidestep = apply_modifier(
        table,
        state,
        sequence,
        order.sidestep,
        MotionCommand::SIDESTEP,
    );
    unmodelled.turn = apply_modifier(table, state, sequence, order.turn, MotionCommand::TURN);
    unmodelled
}

fn apply_modifier(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    ordered: Option<(MotionCommand, f32)>,
    family: MotionCommand,
) -> Option<MotionCommand> {
    match ordered {
        Some((command, speed)) => {
            let outcome = if state
                .modifiers()
                .iter()
                .any(|modifier| modifier.command == command)
            {
                // Retail key releases stop only the released axis; they do not reissue the other
                // held commands (`CommandInterpreter::MovePlayer`, `acclient.c:682360-682540`). A
                // full-order refresh must therefore keep an existing modifier in that role. Going
                // back through generic selection after locomotion stops can promote the same
                // turn/sidestep command into its default-state cycle while its modifier remains,
                // stacking the authored physics twice.
                select_modifier(table, state, sequence, command, speed)
            } else {
                select_motion(table, state, sequence, command, speed)
            };
            (!outcome.is_modelled()).then_some(command)
        }
        None => {
            stop_motion(table, state, sequence, family);
            None
        }
    }
}

fn ordered_command_is(ordered: Option<(MotionCommand, f32)>, command: MotionCommand) -> bool {
    ordered.is_some_and(|(ordered, _)| ordered == command)
}
