//! Per-body authored playback and visual locomotion, owned by the authority that spawned the body.
//!
//! Sequence resolution is stateless, but playback is not: a cursor has to survive between ticks or
//! every tick would restart the animation. That state lives here rather than on the entity, so a
//! client `WorldState` and an Explorer registry can each own their own playback without sharing a
//! table — which is what keeps them separate semantic authorities.

mod remote;
mod sticky;
pub use remote::RemoteMotionSample;
use remote::RemoteMotionState;
pub(crate) use remote::{RemoteFramePolicy, RemoteMotionInput};
use std::time::Instant;
use sticky::StickyMotion;

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

/// One body's ordinary playback and effects, with optional independent locomotion presentation.
#[derive(Debug, Clone)]
pub struct BodyMotionRuntime {
    /// Table this playback was built against. A body that changes tables starts over, because its
    /// substate and cursor mean nothing in a table that does not define them.
    motion_table_id: u32,
    /// Remote directive progress shares the body lifetime with command playback.
    remote_motion: Option<RemoteMotionState>,
    /// Explicit target lifetime shared by local and remote authored playback.
    sticky: StickyMotion,
    state: MotionState,
    sequence: MotionSequenceRuntime,
    /// Optional visual locomotion; it cannot own actions or contribute physics/hooks.
    locomotion: Option<LocomotionPlayback>,
    /// Whether the selected ordinary state permits locomotion presentation.
    allows_locomotion_presentation: bool,
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

/// Presentation-only selection and cursor; action ownership remains in `BodyMotionRuntime`.
#[derive(Debug, Clone)]
struct LocomotionPlayback {
    /// Selected locomotion channels, independent of the ordinary command state.
    state: MotionState,
    /// Visual cursor advanced without authored contributions.
    sequence: MotionSequenceRuntime,
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

/// Current presentation level selected from host-owned authored or locomotion playback.
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
    /// Establishes an already-existing state without playing its entry transitions.
    pub fn establish(table: &MotionSequenceTable, order: MotionOrder) -> Self {
        let mut runtime = Self::new(table);
        runtime.select_order(table, order, false);
        runtime.sequence.remove_transition_prefix();
        runtime
    }

    /// Applies a fresh accepted state before its action batch, without advancing time.
    /// Unlike continuous selection, every accepted Dead command interrupts pending playback.
    pub fn accept_order(&mut self, table: &MotionSequenceTable, order: MotionOrder) {
        self.bind_table(table);
        self.select_order(table, order, true);
    }

    /// Selects style before interruption, matching CMotionInterp::apply_interpreted_movement.
    fn select_order(&mut self, table: &MotionSequenceTable, order: MotionOrder, admitted: bool) {
        let style = select_order_style(table, &mut self.state, &mut self.sequence, order);
        if admitted
            && order
                .forward
                .is_some_and(|(command, _)| command == MotionCommand::DEAD)
        {
            // acclient.c:330249 clears links before Dead; HandleEnterWorld (317294) drains
            // all pending actions without executing skipped frames. MotionDone (329942)
            // also retires the associated sticky target.
            self.sequence.remove_transition_prefix();
            if self.action_count() != 0 {
                self.sticky.complete_action();
            }
            self.active_action = None;
            self.action_queue.clear();
        }
        self.steady_order = order;
        self.unmodelled = apply_order_channels(table, &mut self.state, &mut self.sequence, order);
        self.unmodelled.style = style;
        self.resolve_locomotion_policy(table);
    }

    /// Starts one isolated body at the table's authored default state.
    pub fn new(table: &MotionSequenceTable) -> Self {
        let mut runtime = Self {
            motion_table_id: table.id,
            remote_motion: None,
            sticky: StickyMotion::default(),
            state: MotionState::default(),
            sequence: MotionSequenceRuntime::new(),
            locomotion: None,
            allows_locomotion_presentation: true,
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

    /// Advance one source order and report selection failures with its registry identity.
    fn drive_for_guid(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        order: MotionOrder,
        quantum: f32,
    ) -> &SequenceTick {
        let previous_unmodelled = self.unmodelled;
        self.drive(table, order, quantum);
        self.report_selection(table, guid, previous_unmodelled);
        &self.tick
    }

    /// Receipt and continuous resolution share one diagnostic path without masking receipt failures.
    fn report_selection(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        previous_unmodelled: UnmodelledMotionChannels,
    ) {
        for action in std::mem::take(&mut self.rejected_actions) {
            log::warn!(
                "body 0x{guid:08X} motion table 0x{:08X} cannot route admitted action 0x{:08X} in style 0x{:08X} from substate 0x{:08X} (source {:?}, action sequence {})",
                table.id,
                action.command.raw(),
                self.state.style.raw(),
                self.state.substate.raw(),
                action.source,
                action.action_sequence,
            );
        }
        for (channel, command) in self.unmodelled.newly_present_since(previous_unmodelled) {
            log::warn!(
                "body 0x{guid:08X} motion table 0x{:08X} cannot play admitted {channel} command 0x{:08X} in style 0x{:08X}",
                table.id,
                command.raw(),
                self.state.style.raw(),
            );
        }
    }

    /// Table selection resets playback, but an admitted directive belongs to the entity.
    fn bind_table(&mut self, table: &MotionSequenceTable) {
        if self.motion_table_id != table.id {
            let remote = self.remote_motion;
            let sticky = self.sticky;
            *self = Self::establish(table, self.steady_order);
            self.remote_motion = remote;
            self.sticky = sticky;
        }
    }

    /// The clip this body is playing, for a frontend to render.
    ///
    /// `None` means the body has no clip installed at all, which is a body that does not animate
    /// rather than one whose animation is unknown.
    pub fn playing_clip(&self) -> Option<PlayingMotionClip> {
        self.presentation_sequence()
            .current_clip()
            .map(PlayingMotionClip::of)
    }

    /// Current lossless presentation level, with active actions taking priority over locomotion.
    pub fn motion_presentation(&self) -> Option<MotionPresentation> {
        let sequence = self.presentation_sequence();
        let current = sequence.current_clip()?;
        if current.node.is_advancing() {
            Some(MotionPresentation::Playing(PlayingMotionClip::of(current)))
        } else {
            Some(MotionPresentation::Settled(SettledMotionPose {
                animation_id: current.node.animation().id,
                frame: sequence.current_frame(),
            }))
        }
    }

    /// Actions, authored one-shot transitions, and explicit poses take priority over locomotion.
    fn presentation_sequence(&self) -> &MotionSequenceRuntime {
        match (&self.active_action, &self.locomotion) {
            (None, Some(locomotion))
                if self.allows_locomotion_presentation
                    && (!self.sequence.has_clips() || self.sequence.is_cyclic()) =>
            {
                &locomotion.sequence
            }
            _ => &self.sequence,
        }
    }

    /// Advances visual locomotion without changing commanded playback or its last tick.
    /// Returns whether every requested channel was modelled by the table. Active actions remain
    /// visible until their selector-owned boundary completes; explicit non-locomotion commands
    /// likewise retain authored presentation. The caller owns support/charge selection.
    pub fn present_locomotion(
        &mut self,
        table: &MotionSequenceTable,
        order: MotionOrder,
        quantum: f32,
    ) -> bool {
        self.bind_table(table);
        let locomotion = self.locomotion.get_or_insert_with(|| {
            let mut state = MotionState::default();
            let mut sequence = MotionSequenceRuntime::new();
            set_default_state(table, &mut state, &mut sequence);
            LocomotionPlayback { state, sequence }
        });
        let unmodelled = apply_order(
            table,
            &mut locomotion.state,
            &mut locomotion.sequence,
            order,
        );
        locomotion.sequence.remove_transition_prefix();
        locomotion.sequence.advance_presentation(quantum);
        unmodelled == UnmodelledMotionChannels::default()
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

    /// Explicit target contributing to the last positive-duration source interval.
    pub fn sticky_target(&self) -> Option<Guid> {
        self.sticky.sampled_target()
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

    /// Sticky uses unadjusted run capacity, not an attack/current playback speed.
    /// Retail starts my_run_rate at one and uses it when actor skill data is unavailable
    /// (acclient.c:329792-329808; ACE MotionInterp constructor and get_max_speed).
    pub(crate) fn sticky_speed_mps(&self) -> f32 {
        self.retained_run_rate_multiplier.unwrap_or(1.0) * RETAIL_RUN_FORWARD_BASE_SPEED_MPS * 5.0
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
        self.bind_table(table);
        if let Some((MotionCommand::RUN_FORWARD, speed)) = order.forward
            && valid_speed_multiplier(speed)
        {
            self.retained_run_rate_multiplier = Some(speed);
        }
        // Retail applies steady commands to the same sequence even while an action owns its
        // non-cyclic prefix. Selection replaces only the cyclic return suffix, so a stance or
        // locomotion update retargets the action's authored return without restarting it
        // (`CMotionTable::GetObjectSequence`, `acclient.c:324230-324400`).
        self.select_order(table, order, false);
        if self.active_action.is_none() {
            self.start_next_action(table);
        }
        if quantum > 0.0 {
            self.sticky.begin_interval(Instant::now());
        }
        let contributes_motion = self.sequence.contributes_motion();
        self.tick = self.sequence.advance(quantum);
        if self.tick.action_completed {
            self.sticky.complete_action();
            self.active_action = None;
            self.unmodelled = apply_order(
                table,
                &mut self.state,
                &mut self.sequence,
                self.steady_order,
            );
            self.resolve_locomotion_policy(table);
            self.start_next_action(table);
        }
        let contributes_motion = contributes_motion || self.sequence.contributes_motion();
        if let Some(remote) = &mut self.remote_motion {
            remote.sample(self.tick.offset, contributes_motion, quantum);
        }
        &self.tick
    }

    /// Presentation permission comes from resolved content, never root-offset magnitude.
    fn resolve_locomotion_policy(&mut self, table: &MotionSequenceTable) {
        self.allows_locomotion_presentation = table
            .is_default_cycle(self.state.style.raw(), self.state.substate.raw())
            || matches!(
                self.state.substate,
                MotionCommand::WALK_FORWARD
                    | MotionCommand::WALK_BACKWARDS
                    | MotionCommand::RUN_FORWARD
                    | MotionCommand::SIDESTEP
                    | MotionCommand::TURN_LEFT
                    | MotionCommand::TURN_RIGHT
            );
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
    /// Apply one admitted command's sticky target independently of visible motion changes.
    pub fn admit_sticky_target(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        target: Option<Guid>,
        now: Instant,
    ) {
        let runtime = self
            .bodies
            .entry(guid)
            .or_insert_with(|| BodyMotionRuntime::new(table));
        runtime.bind_table(table);
        runtime.sticky.admit(target, now);
    }

    /// Preserve explicit target-facing source intent beyond the interval's sticky lifetime.
    pub(crate) fn retain_sticky_heading(&mut self, guid: Guid, heading: f32) {
        if let Some(runtime) = self.bodies.get_mut(&guid) {
            runtime.retain_sticky_heading(heading);
        }
    }

    /// Explicit command cancellation also invalidates a sample not yet consumed by physics.
    pub fn cancel_sticky_target(&mut self, guid: Guid) {
        if let Some(runtime) = self.bodies.get_mut(&guid) {
            runtime.sticky = StickyMotion::default();
        }
    }

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

    /// Ordinary command playback state for diagnostics, independent of visual locomotion.
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

    /// Relinquishes visual locomotion ownership without resetting ordinary playback or actions.
    /// Authorities retain observations only while their local physical presentation is active.
    pub fn retain_locomotion_presentation(&mut self, keep: impl Fn(Guid) -> bool) {
        for (guid, runtime) in &mut self.bodies {
            if runtime.locomotion.is_some() && !keep(*guid) {
                runtime.locomotion = None;
            }
        }
    }

    /// Retires one locomotion presentation while preserving commanded playback and actions.
    pub fn clear_locomotion_presentation(&mut self, guid: Guid) {
        if let Some(runtime) = self.bodies.get_mut(&guid) {
            runtime.locomotion = None;
        }
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
        runtime.bind_table(table);
        runtime.enqueue_action(action)
    }

    /// Updates the independent visual locomotion cursor after physical motion has been published.
    /// Returns channel-modelling completeness for callers that need it. Best-effort visual
    /// adapters may ignore it: an unmodelled channel does not undo supported playback.
    pub fn present_locomotion(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        order: MotionOrder,
        quantum: f32,
    ) -> bool {
        self.bodies
            .entry(guid)
            .or_insert_with(|| BodyMotionRuntime::new(table))
            .present_locomotion(table, order, quantum)
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
        runtime.remote_motion = None;
        runtime.drive_for_guid(table, guid, order, quantum)
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
    let style = select_order_style(table, state, sequence, order);
    let mut unmodelled = apply_order_channels(table, state, sequence, order);
    unmodelled.style = style;
    unmodelled
}

fn select_order_style(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    order: MotionOrder,
) -> Option<MotionCommand> {
    if let Some(style) = order.style
        && !select_motion(table, state, sequence, style, 1.0).is_modelled()
    {
        return Some(style);
    }
    None
}

fn apply_order_channels(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    order: MotionOrder,
) -> UnmodelledMotionChannels {
    let mut unmodelled = UnmodelledMotionChannels::default();
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
