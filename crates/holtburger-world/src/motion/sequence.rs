//! The running sequence: which clips are installed, where the cursor is, and what one tick of
//! elapsed time contributes.
//!
//! This is retail's `CSequence` (`acclient.c:326110-327216`), ported as a value the caller owns
//! rather than a service. Advancement is a method on that value and returns what the tick produced;
//! nothing here caches, records history, or reaches back into content.

use holtburger_common::{RigidTransform, Vector3};
use holtburger_content::{MotionClip, MotionHook, MotionHookDirection};
use std::sync::Arc;

use super::{MotionAnimationRef, MotionCommand};

/// Smallest framerate retail treats as advancing the cursor (`acclient.c:327122`).
///
/// Below it, a clip holds its frame instead of contributing a per-frame physics slice. Real content
/// authors an exactly-zero rate 11,182 times, so this is a reachable case rather than a guard.
const FRAMERATE_EPSILON: f32 = 0.000_2;

/// One clip installed in a running sequence, retail's `AnimSequenceNode`.
///
/// The traversal window is copied from the contract's resolved clip and then owned here, because a
/// negative rate change swaps its bounds (`AnimSequenceNode::multiply_framerate`,
/// `acclient.c:327394-327405`). That is why the bounds are signed here and unsigned in the contract.
#[derive(Debug, Clone)]
pub struct SequenceNode {
    animation: MotionAnimationRef,
    low_frame: i32,
    high_frame: i32,
    framerate: f32,
    /// Same-style substate selection that installed this live clip, when one exists.
    substate_selection: Option<SubstateSelection>,
}

impl SequenceNode {
    /// Installs a contract clip at a speed multiplier.
    ///
    /// Retail scales only the rate here and leaves the window alone
    /// (`MotionTable.add_motion` building an `AnimData` at `speed`); a negative speed therefore
    /// plays the same window backwards rather than inverting it.
    pub fn install(clip: &MotionClip, speed: f32) -> Self {
        Self {
            animation: Arc::clone(&clip.animation),
            low_frame: clip.low_frame as i32,
            high_frame: clip.high_frame as i32,
            framerate: clip.framerate * speed,
            substate_selection: None,
        }
    }

    pub fn animation(&self) -> &MotionAnimationRef {
        &self.animation
    }

    pub fn framerate(&self) -> f32 {
        self.framerate
    }

    pub fn low_frame(&self) -> i32 {
        self.low_frame
    }

    pub fn high_frame(&self) -> i32 {
        self.high_frame
    }

    /// Frame the cursor enters this clip at, given its rate's direction.
    ///
    /// The reverse case starts just inside the high frame rather than on it, so the first departure
    /// leaves the high frame rather than skipping it (`AnimSequenceNode::get_starting_frame`).
    fn starting_frame(&self) -> f32 {
        if self.framerate >= 0.0 {
            self.low_frame as f32
        } else {
            self.high_frame as f32 + 1.0 - FRAMERATE_EPSILON
        }
    }

    /// Frame the cursor enters this clip at when it is entered backwards.
    fn ending_frame(&self) -> f32 {
        if self.framerate >= 0.0 {
            self.high_frame as f32 + 1.0 - FRAMERATE_EPSILON
        } else {
            self.low_frame as f32
        }
    }

    /// Scales the rate, swapping the window when the direction flips.
    fn multiply_framerate(&mut self, multiplier: f32) {
        if multiplier < 0.0 {
            std::mem::swap(&mut self.low_frame, &mut self.high_frame);
        }
        self.framerate *= multiplier;
    }

    fn root_offset(&self, frame: i32) -> Option<RigidTransform> {
        u32::try_from(frame)
            .ok()
            .and_then(|frame| self.animation.root.offset(frame))
    }

    fn hooks_at(&self, frame: i32, direction: MotionHookDirection) -> Vec<FiredMotionHook> {
        let Ok(frame) = u32::try_from(frame) else {
            return Vec::new();
        };
        self.animation
            .hooks
            .at(frame, direction)
            .map(|hook| FiredMotionHook {
                animation_id: self.animation.id,
                hook: hook.clone(),
            })
            .collect()
    }
}

/// Semantic destination shared by every clip installed for one substate selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct SubstateSelection {
    /// Style in which the target substate was selected.
    pub style: MotionCommand,
    /// Selected locomotion substate.
    pub target: MotionCommand,
}

/// One simulation hook a departed frame fired, with the clip it came from.
#[derive(Debug, Clone, PartialEq)]
pub struct FiredMotionHook {
    pub animation_id: u32,
    pub hook: MotionHook,
}

/// What one tick of sequence advancement produced.
#[derive(Debug, Clone, PartialEq)]
pub struct SequenceTick {
    /// The tick's authored contribution as one exactly-composed rigid offset.
    ///
    /// Retail composes every departed frame plus the motion-data physics slice into a single
    /// `Frame` before applying it once (`acclient.c:308262-308298`), so this is the whole authored
    /// contribution rather than a sample of it.
    pub offset: RigidTransform,
    /// Simulation hooks the departed frames fired, in departure order.
    ///
    /// Retail also synthesises an `AnimDoneHook` when a one-shot clip finishes. It is not modelled:
    /// nothing consumes it, and "the transition finished" is observable as the projected clip
    /// changing. Add it when something needs it, with that consumer named.
    pub hooks: Vec<FiredMotionHook>,
}

impl SequenceTick {
    /// A tick that contributed nothing, which is also what a body's playback starts at.
    pub fn identity() -> Self {
        Self::empty()
    }

    fn empty() -> Self {
        Self {
            offset: RigidTransform::identity(),
            hooks: Vec::new(),
        }
    }
}

/// The clips a motion selection installed, plus the cursor into them.
///
/// Retail keeps this as a doubly-linked list with a `first_cyclic` marker splitting one-shot
/// transition clips from the looping tail. The list is a `Vec` here and the markers are indices;
/// every retail list operation is a front or back range operation, so nothing needs the links.
#[derive(Debug, Clone, Default)]
pub struct MotionSequenceRuntime {
    nodes: Vec<SequenceNode>,
    /// First clip of the looping tail. Clips before it are one-shot transitions.
    first_cyclic: Option<usize>,
    current: Option<usize>,
    frame_number: f32,
    /// Motion-data velocity of the installed motion, applied per departed frame rather than
    /// retained as momentum.
    velocity: Vector3,
    /// Motion-data omega, applied as a *local* rotation of the accumulating offset.
    omega: Vector3,
}

/// How presentation should behave when the current clip reaches its traversal boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MotionClipCompletion {
    /// Hold the terminal pose while the authoritative sequence advances to its successor.
    Hold,
    /// Re-enter the clip because it belongs to the sequence's looping tail.
    Loop,
}

/// Current node paired with the cyclic-tail fact only the authoritative sequence owns.
pub(super) struct CurrentSequenceClip<'a> {
    pub node: &'a SequenceNode,
    pub completion: MotionClipCompletion,
}

impl MotionSequenceRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn has_clips(&self) -> bool {
        !self.nodes.is_empty()
    }

    /// Whether this playback can move the body at all.
    ///
    /// A property of what is installed, not of how much the last tick happened to produce: a slow
    /// turn contributes a rotation too small to distinguish from identity at 30 Hz, so testing the
    /// per-tick offset would make a body's participation depend on the tick rate.
    pub fn contributes_motion(&self) -> bool {
        self.velocity.length_squared() > FRAMERATE_EPSILON
            || self.omega.length_squared() > FRAMERATE_EPSILON
            || self
                .nodes
                .iter()
                .any(|node| !node.animation.root.is_stationary())
    }

    pub fn frame_number(&self) -> f32 {
        self.frame_number
    }

    /// Frame index the cursor currently rests on, which is the frame a departure would fire.
    pub fn current_frame(&self) -> i32 {
        self.frame_number.floor() as i32
    }

    pub(super) fn current_clip(&self) -> Option<CurrentSequenceClip<'_>> {
        let index = self.current?;
        let node = self.nodes.get(index)?;
        let first_cyclic = self
            .first_cyclic
            .expect("a sequence with a current clip must have a cyclic-tail marker");
        Some(CurrentSequenceClip {
            node,
            completion: if index < first_cyclic {
                MotionClipCompletion::Hold
            } else {
                MotionClipCompletion::Loop
            },
        })
    }

    pub fn clips(&self) -> &[SequenceNode] {
        &self.nodes
    }

    /// Whether the cursor is on the looping tail rather than on a transition clip.
    pub fn is_cyclic(&self) -> bool {
        match (self.current, self.first_cyclic) {
            (Some(current), Some(first_cyclic)) => current >= first_cyclic,
            _ => true,
        }
    }

    pub fn velocity(&self) -> Vector3 {
        self.velocity
    }

    pub fn omega(&self) -> Vector3 {
        self.omega
    }

    /// Replaces the sequence's motion-data velocity and omega, retail's `set_velocity`/`set_omega`.
    ///
    /// Retail *assigns* here rather than accumulating: installing a motion overwrites whatever the
    /// previous one contributed, and only modifiers combine and subtract.
    pub fn set_physics(&mut self, velocity: Vector3, omega: Vector3) {
        self.velocity = velocity;
        self.omega = omega;
    }

    pub fn combine_physics(&mut self, velocity: Vector3, omega: Vector3) {
        self.velocity = self.velocity + velocity;
        self.omega = self.omega + omega;
    }

    pub fn subtract_physics(&mut self, velocity: Vector3, omega: Vector3) {
        self.velocity = self.velocity - velocity;
        self.omega = self.omega - omega;
    }

    pub fn clear_physics(&mut self) {
        self.velocity = Vector3::zero();
        self.omega = Vector3::zero();
    }

    pub fn clear_animations(&mut self) {
        self.nodes.clear();
        self.first_cyclic = None;
        self.current = None;
        self.frame_number = 0.0;
    }

    /// Appends a clip and makes it the start of the looping tail.
    pub fn append(&mut self, node: SequenceNode) {
        self.nodes.push(node);
        self.first_cyclic = Some(self.nodes.len() - 1);

        if self.current.is_none() {
            self.current = Some(0);
            self.frame_number = self.nodes[0].starting_frame();
        }
    }

    /// Appends one clip owned by an exact same-style substate selection.
    pub(super) fn append_for_substate(
        &mut self,
        mut node: SequenceNode,
        selection: SubstateSelection,
    ) {
        node.substate_selection = Some(selection);
        self.append(node);
    }

    /// Number of clips currently retained, used to delimit one newly appended selection.
    pub(super) fn clip_count(&self) -> usize {
        self.nodes.len()
    }

    /// Prevents a later return to a style from collapsing through the intervening style change.
    pub(super) fn forget_substate_selections(&mut self) {
        for node in &mut self.nodes {
            node.substate_selection = None;
        }
    }

    /// Removes the redundant transition suffix between an earlier and newly repeated substate.
    ///
    /// Retail performs the equivalent reduction after appending a motion
    /// (`MotionTableManager::remove_redundant_links`, `acclient.c:317225-317290`). Keeping the
    /// selection on each live clip lets the sequence remove the exact range without a parallel
    /// command queue or per-command animation counts.
    pub(super) fn collapse_redundant_substate_suffix(
        &mut self,
        selection: SubstateSelection,
        appended_from: usize,
    ) {
        let Some(first_cyclic) = self.first_cyclic else {
            return;
        };
        let Some(retain_through) = self.nodes[..appended_from]
            .iter()
            .rposition(|node| node.substate_selection == Some(selection))
        else {
            return;
        };
        let remove_start = retain_through + 1;
        if remove_start >= first_cyclic {
            return;
        }

        let removed = first_cyclic - remove_start;
        let current = self.current;
        self.nodes.drain(remove_start..first_cyclic);
        let first_cyclic = first_cyclic - removed;
        self.first_cyclic = Some(first_cyclic);
        self.current = current.map(|current| {
            if current < remove_start {
                current
            } else if current < remove_start + removed {
                first_cyclic
            } else {
                current - removed
            }
        });
        if current
            .is_some_and(|current| current >= remove_start && current < remove_start + removed)
        {
            self.frame_number = self.nodes[first_cyclic].starting_frame();
        }
    }

    /// Scales the rate of every looping clip, swapping windows when the direction flips.
    pub fn multiply_cyclic_framerate(&mut self, multiplier: f32) {
        let Some(first_cyclic) = self.first_cyclic else {
            return;
        };
        for node in &mut self.nodes[first_cyclic..] {
            node.multiply_framerate(multiplier);
        }
    }

    /// Drops transition clips the cursor has already left behind, retail's `apricot`.
    fn drop_departed_transitions(&mut self) {
        let (Some(current), Some(first_cyclic)) = (self.current, self.first_cyclic) else {
            return;
        };
        let drop = current.min(first_cyclic);
        if drop == 0 {
            return;
        }
        self.nodes.drain(..drop);
        self.current = Some(current - drop);
        self.first_cyclic = Some(first_cyclic - drop);
    }

    /// Removes the looping tail, leaving only transition clips.
    ///
    /// If the cursor was inside the tail it falls back to the last surviving transition clip at that
    /// clip's exit frame, so a replacement selection continues from where playback actually was.
    pub fn remove_cyclic_clips(&mut self) {
        let Some(first_cyclic) = self.first_cyclic else {
            return;
        };
        if self.current.is_some_and(|current| current >= first_cyclic) {
            if first_cyclic == 0 {
                self.current = None;
                self.frame_number = 0.0;
            } else {
                self.current = Some(first_cyclic - 1);
                self.frame_number = self.nodes[first_cyclic - 1].ending_frame();
            }
        }
        self.nodes.truncate(first_cyclic);
        self.first_cyclic = self.nodes.len().checked_sub(1);
    }

    /// Advances the cursor by one tick of elapsed time and returns the tick's contribution.
    ///
    /// With no clips installed the motion-data velocity and omega still contribute for the whole
    /// quantum, which is how a purely explicit cycle moves at all (`CSequence::update`,
    /// `acclient.c:326310-326330`).
    pub fn advance(&mut self, quantum: f32) -> SequenceTick {
        let mut tick = SequenceTick::empty();
        if self.nodes.is_empty() {
            tick.offset = self.apply_physics(tick.offset, quantum, quantum);
            return tick;
        }

        self.advance_within_clip(quantum, &mut tick);
        self.drop_departed_transitions();
        tick
    }

    /// Retail's `CSequence::update_internal` (`acclient.c:327102-327215`), iterated rather than
    /// recursed: crossing a clip boundary carries proportional leftover time into the next clip.
    fn advance_within_clip(&mut self, mut quantum: f32, tick: &mut SequenceTick) {
        // Retail recurses once per boundary crossed. The bound exists because a zero-length window
        // at a nonzero rate would otherwise carry leftover time forever.
        const MAX_BOUNDARIES_PER_TICK: usize = 64;

        for _ in 0..MAX_BOUNDARIES_PER_TICK {
            let Some(current) = self.current else {
                return;
            };
            let node = self.nodes[current].clone();
            let framerate = node.framerate;
            let frametime = framerate * quantum;
            let mut last_frame = self.frame_number.floor() as i32;
            self.frame_number += frametime;

            let mut leftover = 0.0f32;
            let mut clip_done = false;

            if frametime > 0.0 {
                if (node.high_frame as f32) < self.frame_number.floor() {
                    let overshoot = (self.frame_number - node.high_frame as f32 - 1.0).max(0.0);
                    if framerate.abs() > FRAMERATE_EPSILON {
                        leftover = overshoot / framerate;
                    }
                    self.frame_number = node.high_frame as f32;
                    clip_done = true;
                }
                while self.frame_number.floor() > last_frame as f32 {
                    self.depart_frame(&node, last_frame, quantum, tick, true);
                    last_frame += 1;
                }
            } else if frametime < 0.0 {
                if (node.low_frame as f32) > self.frame_number.floor() {
                    let overshoot = (self.frame_number - node.low_frame as f32).min(0.0);
                    if framerate.abs() > FRAMERATE_EPSILON {
                        leftover = overshoot / framerate;
                    }
                    self.frame_number = node.low_frame as f32;
                    clip_done = true;
                }
                while self.frame_number.floor() < last_frame as f32 {
                    self.depart_frame(&node, last_frame, quantum, tick, false);
                    last_frame -= 1;
                }
            } else if quantum.abs() > FRAMERATE_EPSILON {
                tick.offset = self.apply_physics(tick.offset, quantum, quantum);
            }

            if !clip_done {
                return;
            }
            self.advance_to_next_clip(quantum, tick);
            quantum = leftover;
        }
    }

    /// Composes one departed frame's authored offset and its share of the motion-data physics.
    ///
    /// The physics slice is one frame's worth of time — `1/framerate` — signed by the tick's
    /// direction, so an entity moving under explicit velocity travels the same distance whether the
    /// clip is fast or slow.
    fn depart_frame(
        &self,
        node: &SequenceNode,
        frame: i32,
        quantum: f32,
        tick: &mut SequenceTick,
        forward: bool,
    ) {
        if let Some(authored) = node.root_offset(frame) {
            tick.offset = if forward {
                tick.offset.combine(&authored)
            } else {
                tick.offset.subtract(&authored)
            };
        }
        if node.framerate.abs() > FRAMERATE_EPSILON {
            tick.offset = self.apply_physics(tick.offset, 1.0 / node.framerate, quantum);
        }

        let direction = if forward {
            MotionHookDirection::Forward
        } else {
            MotionHookDirection::Backward
        };
        tick.hooks.extend(node.hooks_at(frame, direction));
    }

    /// Retail's `advance_to_next_animation` (`acclient.c:326935-327033`).
    ///
    /// RETAIL DIVERGENCE: retail conditionally removes the leaving clip's current frame, then
    /// conditionally composes the successor's entry frame (`acclient.c:326991-327021`). On ordinary
    /// forward playback that skips the leaving clip's terminal frame and composes the successor's
    /// entry frame both here and again when it departs (`:327150-327160`). We instead depart the
    /// terminal frame exactly once and merely position the cursor on entry. Besides making every
    /// root frame contribute once, this fires terminal-frame hooks instead of silently skipping
    /// them. A 2026-08-21 archive census of 26,421 directly-authored internal and cyclic boundaries
    /// found no translation change at half, at most 1.54 cm at p95 and 5.10 cm at p99, with a 2.01 m
    /// maximum; 77 boundaries changed rotation, with a 3.90-degree maximum. The larger outliers are
    /// authored terminal strides that retail replaces with the next entry frame, so preserving the
    /// defect is less natural than honoring the complete root track.
    fn advance_to_next_clip(&mut self, quantum: f32, tick: &mut SequenceTick) {
        let Some(current) = self.current else {
            return;
        };
        let leaving = self.nodes[current].clone();
        let forward = quantum >= 0.0;
        let frame_forward = leaving.framerate * quantum > 0.0;
        self.depart_frame(
            &leaving,
            self.frame_number.floor() as i32,
            quantum,
            tick,
            frame_forward,
        );

        let next = if forward {
            if current + 1 < self.nodes.len() {
                current + 1
            } else {
                self.first_cyclic.unwrap_or(current)
            }
        } else if current > 0 {
            current - 1
        } else {
            self.nodes.len() - 1
        };
        self.current = Some(next);

        let entered = &self.nodes[next];
        self.frame_number = if forward {
            entered.starting_frame()
        } else {
            entered.ending_frame()
        };
    }

    /// Retail's `CSequence::apply_physics` (`acclient.c:326355-326382`).
    ///
    /// The omega term rotates the offset about its *own* axis. Physical omega is the opposite case
    /// and rotates the world frame globally; conflating them is wrong.
    fn apply_physics(&self, offset: RigidTransform, quantum: f32, sign: f32) -> RigidTransform {
        let quantum = if sign >= 0.0 {
            quantum.abs()
        } else {
            -quantum.abs()
        };

        RigidTransform {
            translation: offset.translation + self.velocity * quantum,
            rotation: offset.rotation,
        }
        .rotate(self.omega * quantum)
    }
}
