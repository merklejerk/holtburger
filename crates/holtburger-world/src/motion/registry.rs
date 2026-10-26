//! Per-body authored playback and independent locomotion, owned by the body's authority.
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

use crate::entity::{
    EntityMotionAction, EntityMotionAdmission, EntityMotionCommandSource, OrderedMotionScalar,
};
use holtburger_common::{Guid, RigidTransform};
use holtburger_content::MotionSequenceTable;
use std::collections::HashMap;
use std::collections::VecDeque;

use super::rates::{MotionRates, baseline_row, is_locomotion};
use super::selection::{
    ActionSelectionOutcome, MotionSelectionOutcome, NativeSelection, select_action, select_motion,
    select_native, set_default_state, stop_motion,
};
use super::sequence::{CurrentSequenceClip, MotionClipCompletion};
use super::sequence::{MotionSequenceRuntime, SequenceTick};
use super::state::{MotionCommand, MotionOrder, MotionState};

/// Retail bounds active plus pending authored actions to six (acclient.c:330865).
pub const MAX_AUTHORED_ACTIONS: usize = 6;

/// Retail `RunForward` state velocity used by `CMotionInterp::get_adjusted_max_speed`
/// (`acclient.c:329811-329837,329866-329872`).
pub const RETAIL_RUN_FORWARD_BASE_SPEED_MPS: f32 = 4.0;

/// Collision pose selected by the authored motion owner; carries no independent timing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthoredCollisionPose {
    /// No commanded animation is installed; retain the body's prepared placement pose.
    Placement,
    /// Whole-frame authored part pose from the authoritative command/action sequence.
    Animation { animation_id: u32, frame: usize },
}

/// One body's ordinary playback and effects, with optional manual or observed locomotion.
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
    /// Independent locomotion; only manual ownership contributes physical motion.
    locomotion: Option<LocomotionPlayback>,
    /// Whether the resolved ordinary substate describes standing or ordinary travel.
    ordinary_is_locomotion: bool,
    /// Contribution the most recent tick produced, held for the solver to read the way a body holds
    /// the velocity its last tick achieved.
    tick: SequenceTick,
    /// Last valid `RunForward` multiplier, matching retail's persistent `my_run_rate` fact.
    retained_run_rate_multiplier: Option<f32>,
    /// Ordinary selection failures, consumed by gesture admission and native-drive diagnostics.
    /// Local locomotion coverage belongs to its own playback and cannot revoke an active gesture.
    ordinary_resolution: MotionOrderResolution,
    /// Latest steady destination retained while a transient action owns playback.
    steady_order: MotionOrder,
    /// Local command admission owns this retained order until completion or a new movement source.
    local_command_owned: bool,
    /// Accepted substate gesture retained through its authored return transition.
    pending_gesture: Option<MotionCommand>,
    /// FIFO transient edges awaiting installation after the active action.
    action_queue: VecDeque<EntityMotionAction>,
    /// Action whose exact selector-owned boundary has not completed yet.
    active_action: Option<EntityMotionAction>,
    /// Fresh selector rejections awaiting body-context reporting by the registry owner.
    rejected_actions: Vec<EntityMotionAction>,
}

/// Independent selection and cursor; action ownership remains in `BodyMotionRuntime`.
#[derive(Debug, Clone)]
struct LocomotionPlayback {
    /// A forward, sidestep, or turn command is currently requested, excluding retained idle/stop playback.
    command_active: bool,
    /// Selected locomotion channels, independent of the ordinary command state.
    state: MotionState,
    /// Cursor advanced by its owner, preserving physical transitions for manual movement.
    sequence: MotionSequenceRuntime,
    /// Selects pre-solve physical advancement versus post-solve observation.
    authority: LocomotionAuthority,
    /// Coverage of this track's order, consumed by local diagnostics and post-solve presentation.
    resolution: MotionOrderResolution,
}

/// Exactly one caller advances the independent locomotion sequence each simulation interval.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LocomotionAuthority {
    /// Local input produces collision-solved movement before the physical solve.
    Manual {
        /// This interval uses locomotion displacement rather than gesture/sticky movement.
        displacing: bool,
    },
    /// Accepted travel only selects a visual description after the physical solve.
    Presentation,
}

impl LocomotionPlayback {
    fn new(
        table: &MotionSequenceTable,
        style: MotionCommand,
        authority: LocomotionAuthority,
    ) -> Self {
        let mut state = MotionState::default();
        let mut sequence = MotionSequenceRuntime::new();
        set_default_state(table, &mut state, &mut sequence);
        // A new independent track inherits the body's stance, not its gesture or transition
        // cursor. Establish that baseline before selecting any newly requested movement.
        select_motion(table, &mut state, &mut sequence, style, 1.0);
        sequence.remove_transition_prefix();
        Self {
            state,
            sequence,
            authority,
            command_active: false,
            resolution: MotionOrderResolution::default(),
        }
    }
}

/// Result of offering one transient edge to retail's six-action runtime bound.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionActionEnqueueOutcome {
    /// Edge entered the FIFO and will start through ordinary selector advancement.
    Queued,
    /// Active plus pending actions already reached retail's bound of six.
    Overflow,
}

/// Result of admitting a locally authored command, independent of its playback class.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MotionCommandAdmissionOutcome {
    /// Command was accepted by its action or retained-state owner.
    Accepted,
    /// Retail's active-plus-pending action bound rejected the command.
    QueueFull,
    /// This local command boundary accepts action and substate commands, not styles or modifiers.
    Unsupported,
}

/// Selection failure or active physical compatibility rate, retained for diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MotionChannelResolution {
    /// Native playback could not select this command.
    Unmodelled {
        /// Requested channel command that could not be selected.
        command: MotionCommand,
    },
    /// A native-absent locomotion component uses the standard player's mean rate.
    RateFallback {
        /// Requested component absent from native content.
        command: MotionCommand,
        /// Baseline table identity consumed by change-based diagnostics.
        table_id: u32,
    },
}

impl MotionChannelResolution {
    fn from_selection(command: MotionCommand, outcome: MotionSelectionOutcome) -> Option<Self> {
        (!outcome.is_modelled()).then_some(Self::Unmodelled { command })
    }
}

/// One selector-owned result per ordered channel, consumed by arbitration and diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct MotionOrderResolution {
    /// Style requests never substitute a player stance.
    style: Option<MotionChannelResolution>,
    /// Forward/substate selection and its physical source.
    forward: Option<MotionChannelResolution>,
    /// Sidestep selection and its physical source.
    sidestep: Option<MotionChannelResolution>,
    /// Turn selection and its physical source.
    turn: Option<MotionChannelResolution>,
}

impl MotionOrderResolution {
    fn channels(self) -> [(&'static str, Option<MotionChannelResolution>); 4] {
        [
            ("style", self.style),
            ("forward", self.forward),
            ("sidestep", self.sidestep),
            ("turn", self.turn),
        ]
    }

    fn has_unmodelled(self) -> bool {
        self.channels().iter().any(|(_, resolution)| {
            matches!(resolution, Some(MotionChannelResolution::Unmodelled { .. }))
        })
    }

    fn newly_present_since(
        self,
        previous: Self,
    ) -> impl Iterator<Item = (&'static str, MotionChannelResolution)> {
        self.channels()
            .into_iter()
            .zip(previous.channels())
            .filter_map(|((channel, current), (_, prior))| {
                (current != prior).then_some((channel, current?))
            })
    }
}

/// Which clip the host has a body playing, and how to play it.
///
/// Deliberately a distinct type from the host's own sequence state, which carries the installed clip
/// list, pending links, and leftover time — none of which a frontend may see or act on. Which clip
/// follows is link resolution against host state, so a clip change arrives only as a new projection.
///
/// It carries no advancing frame number. The frontend enters at the clip boundary when received
/// and owns its visual cursor; transport delay and missed clips can leave it out of phase with
/// simulation. The window and the rate are not optional: a negative rate is entered at `high_frame` and
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

/// One resolved clip or pose from an independently owned playback track.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MotionPresentation {
    /// An advancing clip whose phase remains presentation-owned.
    Playing(PlayingMotionClip),
    /// A stationary pose whose exact frame must survive late realization.
    Settled(SettledMotionPose),
}

/// Why ordinary playback is active; presentation applies its own priority to these semantics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrdinaryMotionActivity {
    /// Standing or travelling playback that can be represented by independent locomotion.
    Locomotion,
    /// Recognized spell, reach, and missile gesture, including entry and return transitions.
    Gesture,
    /// Other actions, explicit poses, or noncyclic transitions, including contact/death.
    Explicit,
}

/// One installed clip occurrence. Its phase remains receiver-owned.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionPlaybackLayer {
    /// Distinguishes a fresh installation from confirmation or rate adjustment.
    pub playback_id: u64,
    /// Resolved clip or settled pose.
    pub clip: MotionPresentation,
}

/// Both available playback descriptions; this contract does not choose the displayed layer.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionPlayback {
    /// Active independent movement intent; retained idle and stop clips do not imply a command.
    pub locomotion_command_active: bool,
    /// Current accepted command/action playback, if it has animation content.
    pub ordinary: Option<MotionPlaybackLayer>,
    /// Independent manual or observed locomotion, even while an action is active.
    pub locomotion: Option<MotionPlaybackLayer>,
    /// Source-owned meaning of ordinary playback; the frontend owns visual priority.
    pub activity: OrdinaryMotionActivity,
}

fn playback_layer(sequence: &MotionSequenceRuntime) -> Option<MotionPlaybackLayer> {
    let current = sequence.current_clip()?;
    Some(MotionPlaybackLayer {
        playback_id: current.node.playback_id(),
        clip: if current.node.is_advancing() {
            MotionPresentation::Playing(PlayingMotionClip::of(current))
        } else {
            MotionPresentation::Settled(SettledMotionPose {
                animation_id: current.node.animation().id,
                frame: sequence.current_frame(),
            })
        },
    })
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
    /// Admit an authored command using the same class bits as retail DoInterpretedMotion
    /// (acclient.c:330233). Command-list transport does not imply action-class playback:
    /// ACE Player_Networking.cs promotes substate entries to retained forward motion.
    fn submit_local_command(
        &mut self,
        table: &MotionSequenceTable,
        command: MotionCommand,
        speed: OrderedMotionScalar,
        admission: EntityMotionAdmission,
    ) -> MotionCommandAdmissionOutcome {
        self.bind_table(table);
        let outcome = if command.is_action() {
            let outcome = self.enqueue_action(EntityMotionAction {
                command,
                speed,
                action_sequence: admission.movement_sequence,
                is_autonomous: true,
                admission,
                source: EntityMotionCommandSource::CommandList,
            });
            match outcome {
                MotionActionEnqueueOutcome::Queued => MotionCommandAdmissionOutcome::Accepted,
                MotionActionEnqueueOutcome::Overflow => MotionCommandAdmissionOutcome::QueueFull,
            }
        } else if command.is_substate() {
            let mut order = self.steady_order;
            order.forward = Some((command, speed.to_f32()));
            self.locomotion = None;
            self.accept_order(table, order);
            MotionCommandAdmissionOutcome::Accepted
        } else {
            MotionCommandAdmissionOutcome::Unsupported
        };
        if outcome == MotionCommandAdmissionOutcome::Accepted {
            self.local_command_owned = true;
            self.remote_motion = None;
        }
        outcome
    }

    /// Whether accepted local playback owns the retained order rather than the last server snapshot.
    pub fn has_local_command(&self) -> bool {
        self.local_command_owned
    }

    fn advance_local_command(
        &mut self,
        table: &MotionSequenceTable,
        quantum: f32,
    ) -> &SequenceTick {
        self.advance_authored(table, self.steady_order, quantum);
        if self.action_count() == 0 && self.ordinary_is_locomotion && self.sequence.is_cyclic() {
            self.local_command_owned = false;
        }
        &self.tick
    }

    /// Establishes an already-existing state without playing its entry transitions.
    pub fn establish(table: &MotionSequenceTable, order: MotionOrder) -> Self {
        let mut runtime = Self::new(table);
        runtime.select_order(table, order, false);
        runtime.sequence.remove_transition_prefix();
        runtime.pending_gesture = runtime
            .state
            .substate
            .movement_override_gesture()
            .filter(|gesture| {
                matches!(
                    gesture,
                    super::MotionGesture::Release
                        | super::MotionGesture::Reach
                        | super::MotionGesture::MissileAim
                        | super::MotionGesture::MissileReload
                )
            })
            .map(|_| runtime.state.substate);
        runtime
    }

    /// Retire unfinished animation work without traversing skipped hooks or reporting success.
    /// Retail HandleEnterWorld (acclient.c:317294) drains pending animations with failure;
    /// MotionDone (:329942) also retires action-owned sticky state.
    fn interrupt_transitions(&mut self) {
        self.pending_gesture = None;
        self.sequence.remove_transition_prefix();
        if self.action_count() != 0 {
            self.sticky.complete_action();
        }
        self.active_action = None;
        self.action_queue.clear();
    }

    /// Applies a fresh accepted state before its action batch, without advancing time.
    /// Unlike continuous selection, every accepted Dead command interrupts pending playback.
    pub fn accept_order(&mut self, table: &MotionSequenceTable, order: MotionOrder) {
        self.bind_table(table);
        self.select_order(table, order, true);
        if matches!(
            self.state.substate.movement_override_gesture(),
            Some(
                super::MotionGesture::Release
                    | super::MotionGesture::Reach
                    | super::MotionGesture::MissileAim
                    | super::MotionGesture::MissileReload
            )
        ) {
            self.pending_gesture = Some(self.state.substate);
        } else if self.sequence.is_cyclic()
            || (!table.is_default_cycle(self.state.style.raw(), self.state.substate.raw())
                && self.state.substate != MotionCommand::READY)
        {
            self.pending_gesture = None;
        }
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
            self.interrupt_transitions();
        }
        self.steady_order = order;
        self.ordinary_resolution =
            apply_order_channels(table, &mut self.state, &mut self.sequence, order);
        self.ordinary_resolution.style = style;
        self.classify_ordinary_motion(table);
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
            ordinary_is_locomotion: true,
            tick: SequenceTick::identity(),
            retained_run_rate_multiplier: None,
            ordinary_resolution: MotionOrderResolution::default(),
            steady_order: MotionOrder::default(),
            local_command_owned: false,
            pending_gesture: None,
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
        let previous_resolution = self.ordinary_resolution;
        self.drive(table, order, quantum);
        self.report_selection(table, guid, previous_resolution, self.ordinary_resolution);
        &self.tick
    }

    /// Diagnostics follow the current drive owner. Ordinary admission retains its independent
    /// result even when local animation coverage is incomplete.
    fn reported_resolution(&self) -> MotionOrderResolution {
        match &self.locomotion {
            Some(track) if matches!(track.authority, LocomotionAuthority::Manual { .. }) => {
                track.resolution
            }
            _ => self.ordinary_resolution,
        }
    }

    /// Receipt and continuous resolution share one diagnostic path without masking receipt failures.
    fn report_selection(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        previous_resolution: MotionOrderResolution,
        current_resolution: MotionOrderResolution,
    ) {
        for action in std::mem::take(&mut self.rejected_actions) {
            // Missing action routes are normal: ACE can request human NPC twitches absent
            // from their table. Retail also rejects these (`acclient.c:324405-324438`).
            log::debug!(
                "body 0x{guid:08X} motion table 0x{:08X} cannot route admitted action 0x{:08X} in style 0x{:08X} from substate 0x{:08X} (source {:?}, action sequence {})",
                table.id,
                action.command.raw(),
                self.state.style.raw(),
                self.state.substate.raw(),
                action.source,
                action.action_sequence,
            );
        }
        for (channel, resolution) in current_resolution.newly_present_since(previous_resolution) {
            match resolution {
                MotionChannelResolution::Unmodelled { command } => log::warn!(
                    "body 0x{guid:08X} motion table 0x{:08X} cannot play admitted {channel} command 0x{:08X} in style 0x{:08X}",
                    table.id,
                    command.raw(),
                    self.state.style.raw(),
                ),
                MotionChannelResolution::RateFallback { command, table_id } => log::warn!(
                    "body 0x{guid:08X} motion table 0x{:08X} uses mean movement rates from table 0x{table_id:08X} for native-absent {channel} command 0x{:08X} in style 0x{:08X}",
                    table.id,
                    command.raw(),
                    self.state.style.raw(),
                ),
            }
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

    /// Effective table bound to this cursor, used when prepared collision content is replaced.
    pub fn motion_table_id(&self) -> u32 {
        self.motion_table_id
    }

    /// Samples simulation-owned parts: gestures retain their body semantics while manual
    /// locomotion supplies idle physical poses. Observed presentation never changes collisions.
    pub fn collision_pose(&self) -> AuthoredCollisionPose {
        let sequence = match &self.locomotion {
            Some(locomotion)
                if self.has_manual_locomotion() && !self.ordinary_owns_body_semantics() =>
            {
                &locomotion.sequence
            }
            _ => &self.sequence,
        };
        match sequence.current_clip() {
            Some(current) => AuthoredCollisionPose::Animation {
                animation_id: current.node.animation().id,
                frame: usize::try_from(sequence.current_frame())
                    .expect("installed authored sequence has a nonnegative frame"),
            },
            None => AuthoredCollisionPose::Placement,
        }
    }

    /// Exposes both playback descriptions without selecting frontend visibility or phase.
    pub fn motion_playback(&self) -> Option<MotionPlayback> {
        let ordinary = playback_layer(&self.sequence);
        let locomotion = self
            .locomotion
            .as_ref()
            .and_then(|locomotion| playback_layer(&locomotion.sequence));
        if ordinary.is_none() && locomotion.is_none() {
            return None;
        }
        let activity = if self.pending_gesture.is_some()
            || self
                .active_action
                .is_some_and(|action| action.command.movement_override_gesture().is_some())
        {
            OrdinaryMotionActivity::Gesture
        } else if self.ordinary_owns_body_semantics() {
            OrdinaryMotionActivity::Explicit
        } else {
            OrdinaryMotionActivity::Locomotion
        };
        Some(MotionPlayback {
            locomotion_command_active: self
                .locomotion
                .as_ref()
                .is_some_and(|track| track.command_active),
            ordinary,
            locomotion,
            activity,
        })
    }

    /// Advances visual locomotion without changing commanded playback or its last tick.
    /// Returns whether every requested channel was modelled by the table. Ordinary playback and
    /// its semantic activity remain independent; the frontend chooses visibility. The caller
    /// owns support/charge selection.
    pub fn present_locomotion(
        &mut self,
        table: &MotionSequenceTable,
        order: MotionOrder,
        quantum: f32,
    ) -> bool {
        self.bind_table(table);
        if let Some(track) = &self.locomotion
            && matches!(track.authority, LocomotionAuthority::Manual { .. })
        {
            return !track.resolution.has_unmodelled();
        }
        let locomotion = self.locomotion.get_or_insert_with(|| {
            LocomotionPlayback::new(table, self.state.style, LocomotionAuthority::Presentation)
        });
        locomotion.authority = LocomotionAuthority::Presentation;
        locomotion.command_active =
            order.forward.is_some() || order.sidestep.is_some() || order.turn.is_some();
        let resolution = apply_order(
            table,
            &mut locomotion.state,
            &mut locomotion.sequence,
            order,
        );
        locomotion.sequence.remove_transition_prefix();
        locomotion.sequence.advance_presentation(quantum);
        !resolution.has_unmodelled()
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
        if self.action_count() >= MAX_AUTHORED_ACTIONS {
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

    /// Recognized gestures and their idle return may coexist with independent locomotion.
    /// Unmodelled channels and unrelated actions keep their existing server-control policy.
    pub fn permits_gesture_locomotion(&self, table: &MotionSequenceTable) -> bool {
        self.gesture_actions_allow_locomotion()
            && (self.pending_gesture.is_some()
                || self.state.substate.movement_override_gesture().is_some()
                || table.is_default_cycle(self.state.style.raw(), self.state.substate.raw())
                || self.state.substate == MotionCommand::READY)
    }

    /// A recognized gesture currently owns playback, rather than only an eligible idle state.
    pub fn has_layerable_gesture(&self, table: &MotionSequenceTable) -> bool {
        self.permits_gesture_locomotion(table)
            && (self.pending_gesture.is_some()
                || self.action_count() != 0
                || self.state.substate.movement_override_gesture().is_some())
    }

    /// Unrelated queued actions and unsupported playback retain exclusive body ownership.
    fn gesture_actions_allow_locomotion(&self) -> bool {
        !self.ordinary_resolution.has_unmodelled()
            && self
                .active_action
                .iter()
                .chain(self.action_queue.iter())
                .all(|action| {
                    action.command.movement_override_gesture() == Some(super::MotionGesture::Windup)
                })
    }

    /// Whether an accepted substate gesture still owns its entry, hold, or return playback.
    pub fn has_pending_gesture(&self) -> bool {
        self.pending_gesture.is_some()
    }

    /// Body semantics follow active actions/explicit substates and their authored boundaries.
    /// Locomotion owns body hooks and collision parts only when ordinary playback is idle.
    fn ordinary_owns_body_semantics(&self) -> bool {
        self.active_action.is_some()
            || !self.action_queue.is_empty()
            || self.pending_gesture.is_some()
            || !self.ordinary_is_locomotion
            || (self.sequence.has_clips() && !self.sequence.is_cyclic())
    }

    /// Whether local physical advancement owns a retained locomotion sequence, including idle.
    /// The core keeps advancing this owner through complete stop transitions and gesture returns.
    pub fn has_manual_locomotion(&self) -> bool {
        self.locomotion.as_ref().is_some_and(|locomotion| {
            matches!(locomotion.authority, LocomotionAuthority::Manual { .. })
        })
    }

    /// Whether manual movement owns this interval's physical reference, including a stop link.
    /// The physical solver uses this to suspend sticky displacement without erasing target intent.
    pub fn manual_displacement(&self) -> bool {
        self.locomotion.as_ref().is_some_and(|locomotion| {
            matches!(
                locomotion.authority,
                LocomotionAuthority::Manual { displacing: true }
            )
        })
    }

    /// Advances accepted gestures independently of manual displacement. Visible-layer selection
    /// does not participate in this physical composition; the frontend owns its own visual clocks.
    pub fn drive_manual(
        &mut self,
        table: &MotionSequenceTable,
        order: MotionOrder,
        presentation: super::CharacterMotionPresentation,
        quantum: f32,
    ) -> &SequenceTick {
        self.drive_manual_with_fallback(table, None, order, presentation, quantum)
    }

    pub(crate) fn drive_manual_with_fallback(
        &mut self,
        table: &MotionSequenceTable,
        baseline: Option<&MotionSequenceTable>,
        order: MotionOrder,
        presentation: super::CharacterMotionPresentation,
        quantum: f32,
    ) -> &SequenceTick {
        self.bind_table(table);
        let established_style = self.state.style;
        let grounded = matches!(
            presentation,
            super::CharacterMotionPresentation::Grounded
                | super::CharacterMotionPresentation::StanceDefault
        );
        let moving = order.forward.is_some() || order.sidestep.is_some() || order.turn.is_some();
        let order = order.with_character_presentation(presentation);
        if self.local_command_owned && !moving && grounded {
            return self.advance_local_command(table, quantum);
        }
        self.local_command_owned = false;
        if !grounded {
            // RETAIL DIVERGENCE: retail contact arbitration replaces unsupported forward
            // motion (acclient.c:330148-330178,330390-330453). Preserve already accepted
            // gestures on their independent clock; restoring interruption would cancel casting
            // or missile playback on takeoff. Support still owns locomotion displacement, and
            // other actions retain interruption priority. The visual layout census covers 22
            // humanoid CharGen entries (docs/animation_composition.md); command admission remains
            // the explicit gesture allowlist.
            if !(self.permits_gesture_locomotion(table) && self.ordinary_owns_body_semantics()) {
                self.interrupt_transitions();
                self.select_order(table, order, false);
            }
        } else if self.has_manual_locomotion()
            && matches!(
                self.state.substate,
                MotionCommand::FALLING | MotionCommand::READY
            )
        {
            self.select_order(
                table,
                MotionOrder {
                    style: order.style,
                    ..MotionOrder::default()
                },
                false,
            );
        } else if !self.permits_gesture_locomotion(table) && self.ordinary_owns_body_semantics() {
            // Unknown/custom actions keep ordinary authored arbitration.
            return self.drive(table, order, quantum);
        }
        if let Some((MotionCommand::RUN_FORWARD, speed)) = order.forward
            && valid_speed_multiplier(speed)
        {
            self.retained_run_rate_multiplier = Some(speed);
        }
        let locomotion = self.locomotion.get_or_insert_with(|| {
            LocomotionPlayback::new(
                table,
                established_style,
                LocomotionAuthority::Manual { displacing: false },
            )
        });
        let previous_style = locomotion.state.style;
        let selected = select_order_channels(
            table,
            &mut locomotion.state,
            &mut locomotion.sequence,
            order,
        );
        let (resolution, fallback_rates) = selected.resolve_local(baseline);
        if presentation == super::CharacterMotionPresentation::Falling
            && locomotion.state.style != previous_style
            && locomotion.state.substate == MotionCommand::FALLING
        {
            // RETAIL DIVERGENCE: style selection routes through the default substate
            // (acclient.c:324245-324330). Player table 0x09000001 contains landing and magic
            // stance links on that route (docs/animation_composition.md). Keeping them would
            // play grounded poses in flight; retain the successfully selected Falling cycle.
            // Same-style takeoff still traverses its authored transition normally.
            locomotion.sequence.remove_transition_prefix();
        }
        locomotion.command_active = moving;
        // Inspect the transition before advancing: its final moving interval still belongs to
        // locomotion even if advancement reaches the idle cycle in this tick.
        let manual_displacement = moving
            || !grounded
            || (locomotion.sequence.has_clips() && !locomotion.sequence.is_cyclic());
        locomotion.authority = LocomotionAuthority::Manual {
            displacing: manual_displacement,
        };
        let mut locomotion_tick = locomotion.sequence.advance(quantum);
        if let Some(rates) = fallback_rates {
            // One whole-interval physical source: never add rates to a retained native root tick.
            // Native playback still owns poses, collision frames, and gameplay hooks.
            locomotion_tick.offset = rates.offset(quantum);
        }
        if presentation == super::CharacterMotionPresentation::Ready
            && resolution.forward
                == Some(MotionChannelResolution::Unmodelled {
                    command: MotionCommand::READY,
                })
        {
            // A creature may lack Ready. Retaining its native pose must not retain a running
            // cycle's travel while charging a standing jump (acclient.c:330397-330404).
            locomotion_tick.offset.translation = holtburger_common::Vector3::zero();
        }
        locomotion.resolution = resolution;
        let ordinary_hooks = self.ordinary_owns_body_semantics();
        self.advance_authored(table, self.steady_order, quantum);
        if manual_displacement || !ordinary_hooks {
            self.tick.offset = locomotion_tick.offset;
        }
        // Ethereal/solid and other authored body semantics belong to an active gesture, even
        // while its root displacement is overridden. Without a gesture, locomotion owns them.
        // Never apply both streams to the same body in one interval.
        if !ordinary_hooks {
            self.tick.hooks = locomotion_tick.hooks;
        }
        &self.tick
    }

    /// Applies one order and advances this isolated body's provisional playback.
    pub fn drive(
        &mut self,
        table: &MotionSequenceTable,
        order: MotionOrder,
        quantum: f32,
    ) -> &SequenceTick {
        self.local_command_owned = false;
        if self.has_manual_locomotion() {
            self.locomotion = None;
        }
        self.advance_authored(table, order, quantum)
    }

    /// Advances only accepted ordinary playback; callers compose any locomotion contribution.
    fn advance_authored(
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
            // A release/reach admitted after this action owns any newer target lease.
            if self.pending_gesture.is_none() {
                self.sticky.complete_action();
            }
            self.active_action = None;
            self.ordinary_resolution = apply_order(
                table,
                &mut self.state,
                &mut self.sequence,
                self.steady_order,
            );
            self.classify_ordinary_motion(table);
            self.start_next_action(table);
        }
        if self.pending_gesture != Some(self.state.substate) && self.sequence.is_cyclic() {
            self.pending_gesture = None;
        }
        let contributes_motion = contributes_motion || self.sequence.contributes_motion();
        if let Some(remote) = &mut self.remote_motion {
            remote.sample(self.tick.offset, contributes_motion, quantum);
        }
        &self.tick
    }

    /// Ordinary activity comes from resolved content, never root-offset magnitude.
    fn classify_ordinary_motion(&mut self, table: &MotionSequenceTable) {
        self.ordinary_is_locomotion = table
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

    /// Interrupt an existing body's pending animation work; never instantiate playback here.
    pub(crate) fn interrupt_transitions(&mut self, guid: Guid) {
        if let Some(runtime) = self.bodies.get_mut(&guid) {
            runtime.interrupt_transitions();
        }
    }

    pub fn get(&self, guid: Guid) -> Option<&BodyMotionRuntime> {
        self.bodies.get(&guid)
    }

    /// Current independent playback descriptions for the host projection.
    pub fn motion_playback(&self, guid: Guid) -> Option<MotionPlayback> {
        self.bodies
            .get(&guid)
            .and_then(BodyMotionRuntime::motion_playback)
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

    /// Relinquishes independent locomotion without resetting ordinary playback or actions.
    /// Authorities retain observations only while their local physical presentation is active.
    pub fn retain_locomotion(&mut self, keep: impl Fn(Guid) -> bool) {
        for (guid, runtime) in &mut self.bodies {
            if runtime.locomotion.is_some() && !keep(*guid) {
                runtime.locomotion = None;
            }
        }
    }

    /// Retires one locomotion owner while preserving commanded playback and actions.
    pub fn clear_locomotion(&mut self, guid: Guid) {
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

    /// Submit one validated command; the body runtime owns action versus retained-state selection.
    pub(crate) fn submit_local_command(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        command: MotionCommand,
        speed: OrderedMotionScalar,
        admission: EntityMotionAdmission,
    ) -> MotionCommandAdmissionOutcome {
        self.bodies
            .entry(guid)
            .or_insert_with(|| BodyMotionRuntime::new(table))
            .submit_local_command(table, command, speed, admission)
    }

    /// Advance the retained order only while it is still owned by local command admission.
    pub(crate) fn advance_local_command(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        quantum: f32,
    ) -> Option<&SequenceTick> {
        let runtime = self.bodies.get_mut(&guid)?;
        runtime
            .local_command_owned
            .then(|| runtime.advance_local_command(table, quantum))
    }

    /// A fresh source supersedes the local order while preserving its cursor for normal transition selection.
    pub fn release_local_command(&mut self, guid: Guid) {
        if let Some(runtime) = self.bodies.get_mut(&guid) {
            runtime.local_command_owned = false;
        }
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

    /// Local manual arbitration uses the same resident cursor and diagnostics as other drives.
    pub fn drive_manual(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        order: MotionOrder,
        presentation: super::CharacterMotionPresentation,
        quantum: f32,
    ) -> &SequenceTick {
        self.drive_manual_with_fallback(table, None, guid, order, presentation, quantum)
    }

    pub(crate) fn drive_manual_with_fallback(
        &mut self,
        table: &MotionSequenceTable,
        baseline: Option<&MotionSequenceTable>,
        guid: Guid,
        order: MotionOrder,
        presentation: super::CharacterMotionPresentation,
        quantum: f32,
    ) -> &SequenceTick {
        let runtime = self
            .bodies
            .entry(guid)
            .or_insert_with(|| BodyMotionRuntime::new(table));
        runtime.remote_motion = None;
        let previous_resolution = runtime.reported_resolution();
        runtime.drive_manual_with_fallback(table, baseline, order, presentation, quantum);
        runtime.report_selection(
            table,
            guid,
            previous_resolution,
            runtime.reported_resolution(),
        );
        &runtime.tick
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

/// Transient native selection facts. Only the diagnostic summary survives this call.
struct SelectedOrder<'a> {
    /// Existing per-channel diagnostic lifetime, shared by native and manual playback.
    resolution: MotionOrderResolution,
    /// Actual selector results in forward, sidestep, turn order; consumed by rate resolution.
    channels: [Option<(MotionCommand, f32, NativeSelection<'a>)>; 3],
}

impl SelectedOrder<'_> {
    fn resolve_local(
        mut self,
        baseline: Option<&MotionSequenceTable>,
    ) -> (MotionOrderResolution, Option<MotionRates>) {
        if !self
            .channels
            .iter()
            .flatten()
            .any(|(command, _, selection)| {
                is_locomotion(*command) && matches!(selection, NativeSelection::Missing)
            })
        {
            return (self.resolution, None);
        }
        let mut rates = MotionRates::default();
        for (channel, diagnostic) in self.channels.iter().zip([
            &mut self.resolution.forward,
            &mut self.resolution.sidestep,
            &mut self.resolution.turn,
        ]) {
            let Some((command, speed, selection)) = *channel else {
                continue;
            };
            let row = match selection {
                NativeSelection::Selected(row) => Some(row),
                NativeSelection::Missing => baseline.and_then(|table| {
                    let row = baseline_row(table, command)?;
                    *diagnostic = Some(MotionChannelResolution::RateFallback {
                        command,
                        table_id: table.id,
                    });
                    Some(row)
                }),
                NativeSelection::AlreadyActive | NativeSelection::Prohibited => None,
            };
            if let Some(row) = row {
                rates.add(row.rates(), speed);
            }
        }
        (self.resolution, Some(rates))
    }
}

/// Applies retail's fixed order: style, forward, sidestep, turn. An absent channel is explicitly
/// stopped rather than retaining its previous movement (`MotionInterp::apply_interpreted_movement`).
fn apply_order(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    order: MotionOrder,
) -> MotionOrderResolution {
    select_order_channels(table, state, sequence, order).resolution
}

fn select_order_channels<'a>(
    table: &'a MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    order: MotionOrder,
) -> SelectedOrder<'a> {
    let style = select_order_style(table, state, sequence, order);
    let mut selected = select_channels(table, state, sequence, order);
    selected.resolution.style = style;
    selected
}

fn select_order_style(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    order: MotionOrder,
) -> Option<MotionChannelResolution> {
    order.style.and_then(|style| {
        MotionChannelResolution::from_selection(
            style,
            select_motion(table, state, sequence, style, 1.0),
        )
    })
}

fn apply_order_channels(
    table: &MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    order: MotionOrder,
) -> MotionOrderResolution {
    select_channels(table, state, sequence, order).resolution
}

fn select_channels<'a>(
    table: &'a MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    order: MotionOrder,
) -> SelectedOrder<'a> {
    let forward = match order.forward {
        Some((command, speed)) => Some((
            command,
            speed,
            select_native(table, state, sequence, command, speed),
        )),
        None => {
            // Dual-class side/turn commands can own the cycle. Do not stop and restart their
            // phase merely because the separate forward channel is absent.
            let running = state.substate;
            if running.is_substate()
                && Some(running.raw()) != table.style_default(state.style.raw())
                && !ordered_command_is(order.sidestep, running)
                && !ordered_command_is(order.turn, running)
            {
                stop_motion(table, state, sequence, running);
            }
            None
        }
    };
    let sidestep = apply_modifier(
        table,
        state,
        sequence,
        order.sidestep,
        MotionCommand::SIDESTEP,
    );
    let turn = apply_modifier(table, state, sequence, order.turn, MotionCommand::TURN);
    let channels = [forward, sidestep, turn];
    let [forward, sidestep, turn] = channels.map(|channel| {
        channel.and_then(|(command, _, selection)| {
            MotionChannelResolution::from_selection(command, selection.outcome())
        })
    });
    SelectedOrder {
        resolution: MotionOrderResolution {
            forward,
            sidestep,
            turn,
            ..Default::default()
        },
        channels,
    }
}

fn apply_modifier<'a>(
    table: &'a MotionSequenceTable,
    state: &mut MotionState,
    sequence: &mut MotionSequenceRuntime,
    ordered: Option<(MotionCommand, f32)>,
    family: MotionCommand,
) -> Option<(MotionCommand, f32, NativeSelection<'a>)> {
    match ordered {
        Some((command, speed)) => Some((
            command,
            speed,
            select_native(table, state, sequence, command, speed),
        )),
        None => {
            stop_motion(table, state, sequence, family);
            None
        }
    }
}

fn ordered_command_is(ordered: Option<(MotionCommand, f32)>, command: MotionCommand) -> bool {
    ordered.is_some_and(|(ordered, _)| ordered == command)
}
