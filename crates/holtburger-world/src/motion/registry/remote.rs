//! Remote command progress and its frame belong to the same owner as authored playback.

use super::{BodyMotionRuntime, MotionRuntimeRegistry};
use crate::entity::{EntityMotionAction, EntityMotionDirective, EntityMotionSnapshot};
use crate::motion::{
    CharacterMotionPresentation, MotionContact, MotionGesture, MotionOrder, SequenceTick,
    ServerDirectedMotionResolution, ServerDirectedMotionState, ServerDirectedTarget,
    begin_server_directed_motion, resolve_server_directed_motion,
};
use crate::spatial::{AuthoritativePoseEffect, integrate_angular_velocity};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, RigidTransform, Vector3};
use holtburger_content::MotionSequenceTable;

/// Source facts sampled once by the world before the remote command is interpreted.
pub(crate) struct RemoteMotionInput {
    /// Current admitted wire command snapshot.
    pub snapshot: EntityMotionSnapshot,
    /// Actual position; rotation seeds command frames and refreshes body-following sources.
    pub pose: WorldPosition,
    /// Physical contact and world-resolved animation eligibility.
    pub contact: MotionContact,
    /// Current target lookup, with absence retaining retail's admission/failure rules.
    pub target: Option<ServerDirectedTarget>,
    /// Supported character commands retain their ordinary source frame.
    pub frame_policy: RemoteFramePolicy,
    /// Nominal angular velocity, independent of collision-clipped actual continuation.
    pub omega: Vector3,
}

/// Only simulated character commands need an orientation independent of the actual body.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteFramePolicy {
    /// Fixed, passive, free-flight, and pose-only sources retain their prior body-frame reduction.
    Body,
    /// Character source turns persist independently of collision-clipped body orientation.
    Command,
}

/// One remote source contribution, including command orientation during motionless playback.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RemoteMotionSample {
    /// An installed moving sequence supplies its offset, including stationary individual samples.
    pub offset: Option<RigidTransform>,
    /// Source orientation at interval start, sampled alongside this exact offset.
    pub rotation: Quaternion,
}

/// Retain terminal identity so an unchanged terminated directive cannot restart after displacement.
#[derive(Debug, Clone, Copy, PartialEq)]
struct RemoteDirective {
    /// Wire admission identity retained after completion or failure.
    directive: EntityMotionDirective,
    /// Active reducer successor or the order retained after local/remote termination.
    progress: RemoteDirectiveProgress,
}

/// Terminal playback belongs to the directive identity, so unchanged wire state cannot restart it.
#[derive(Debug, Clone, Copy, PartialEq)]
enum RemoteDirectiveProgress {
    /// Pure-reducer successor for the next movement sample.
    Active(ServerDirectedMotionState),
    /// Return order before support presentation; failures stop all movement channels.
    Terminal(MotionOrder),
}

/// Entity-owned source timeline, preserved across content rebinding and physical return completion.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct RemoteMotionState {
    /// Next source orientation; character commands advance it independently of body corrections.
    rotation: Quaternion,
    /// Current remote directive lifetime, when the wire supplied a directive.
    directive: Option<RemoteDirective>,
    /// The completed sample's starting frame, consumed after the source orientation advances.
    sample: RemoteMotionSample,
    /// Angular source for the current admitted sample, supplied alongside its body facts.
    omega: Vector3,
}

impl RemoteMotionState {
    fn new(rotation: Quaternion) -> Self {
        Self {
            rotation,
            directive: None,
            sample: RemoteMotionSample {
                offset: None,
                rotation,
            },
            omega: Vector3::zero(),
        }
    }

    pub fn sample(&mut self, offset: RigidTransform, contributes_motion: bool, quantum: f32) {
        self.sample = RemoteMotionSample {
            offset: contributes_motion.then_some(offset),
            rotation: self.rotation,
        };
        self.rotation = integrate_angular_velocity(
            self.rotation.multiply(&offset.rotation),
            self.omega,
            quantum,
        );
    }

    fn order(
        &mut self,
        guid: Guid,
        input: RemoteMotionInput,
        sticky: &mut super::StickyMotion,
    ) -> MotionOrder {
        self.omega = input.omega;
        if input.frame_policy == RemoteFramePolicy::Body {
            self.rotation = input.pose.rotation;
        }
        let pose = WorldPosition {
            rotation: self.rotation,
            ..input.pose
        };
        let steady = MotionOrder::from_snapshot(input.snapshot);
        let terminal = steady.with_character_presentation(
            input
                .contact
                .presentation(CharacterMotionPresentation::Grounded),
        );
        let Some(directive) = input.snapshot.directive else {
            self.directive = None;
            return terminal;
        };
        let state = match self.directive {
            Some(retained) if retained.directive == directive => match retained.progress {
                RemoteDirectiveProgress::Active(state) => state,
                RemoteDirectiveProgress::Terminal(order) => {
                    return order.with_character_presentation(
                        input
                            .contact
                            .presentation(CharacterMotionPresentation::Grounded),
                    );
                }
            },
            _ => begin_server_directed_motion(directive, pose, input.target),
        };
        let (progress, order) = match resolve_server_directed_motion(
            state,
            steady,
            pose,
            crate::motion::DirectedMotionSupport::Physical(input.contact),
            input.target,
        ) {
            ServerDirectedMotionResolution::Active(step) => {
                (RemoteDirectiveProgress::Active(step.state), step.order)
            }
            ServerDirectedMotionResolution::Complete { sticky_target } => {
                if let Some(target) = sticky_target {
                    sticky.admit(Some(target), std::time::Instant::now());
                }
                (RemoteDirectiveProgress::Terminal(steady), terminal)
            }
            ServerDirectedMotionResolution::Failed(failure) => {
                log::log!(
                    failure.log_level(),
                    "entity 0x{guid:08X} server-directed motion failed: {failure:?}"
                );
                let stopped = MotionOrder {
                    style: steady.style,
                    ..MotionOrder::default()
                };
                (
                    RemoteDirectiveProgress::Terminal(stopped),
                    stopped.with_character_presentation(
                        input
                            .contact
                            .presentation(CharacterMotionPresentation::Grounded),
                    ),
                )
            }
        };
        self.directive = Some(RemoteDirective {
            directive,
            progress,
        });
        order
    }
}

impl MotionRuntimeRegistry {
    /// Transfers a locally resolved terminal directive to ordinary world playback.
    /// The wire snapshot stays authoritative; its unchanged directive cannot acquire playback again.
    /// Returns false when the body has no playback runtime to receive the handoff.
    pub fn retain_terminal_directive(
        &mut self,
        guid: Guid,
        directive: EntityMotionDirective,
        rotation: Quaternion,
        order: MotionOrder,
    ) -> bool {
        let Some(runtime) = self.bodies.get_mut(&guid) else {
            return false;
        };
        let remote = runtime
            .remote_motion
            .get_or_insert_with(|| RemoteMotionState::new(rotation));
        remote.directive = Some(RemoteDirective {
            directive,
            progress: RemoteDirectiveProgress::Terminal(order),
        });
        true
    }

    /// Applies one accepted packet in order, before any later packet or positive-duration tick.
    pub(crate) fn accept_remote(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        input: RemoteMotionInput,
        actions: impl IntoIterator<Item = EntityMotionAction>,
        sticky_target: Option<Guid>,
    ) {
        let runtime = self
            .bodies
            .entry(guid)
            .or_insert_with(|| BodyMotionRuntime::new(table));
        runtime.bind_table(table);
        runtime.local_command_owned = false;
        let actions: Vec<_> = actions.into_iter().collect();
        let incoming_windups = !actions.is_empty()
            && actions.iter().all(|action| {
                action.command.movement_override_gesture() == Some(MotionGesture::Windup)
            });
        let order = runtime.remote_order(table, guid, input, incoming_windups);
        let previous_resolution = runtime.ordinary_resolution;
        runtime.accept_order(table, order);
        for action in actions {
            if runtime.enqueue_action(action) == super::MotionActionEnqueueOutcome::Overflow {
                log::warn!(
                    "body 0x{guid:08X} rejected action 0x{:08X}: retail six-action queue is full",
                    action.command.raw()
                );
            }
        }
        // Packet admission updates ordinary playback without taking ownership of displacement.
        // The local controller decides whether this is a gesture or an actual source takeover;
        // retaining manual playback here preserves its cursor across windup/release packets.
        runtime.advance_authored(table, order, 0.0);
        runtime.report_selection(
            table,
            guid,
            previous_resolution,
            runtime.ordinary_resolution,
        );
        // Retail move_to_interpreted_state applies motion before re-establishing packet sticky.
        runtime
            .sticky
            .admit(sticky_target, std::time::Instant::now());
    }

    /// Interpret and advance remote intent through the same playback owner as local commands.
    pub(crate) fn drive_remote(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        input: RemoteMotionInput,
        quantum: f32,
    ) -> &SequenceTick {
        let runtime = self
            .bodies
            .entry(guid)
            .or_insert_with(|| BodyMotionRuntime::new(table));
        runtime.bind_table(table);
        if runtime.local_command_owned {
            return runtime.advance_local_command(table, quantum);
        }
        let order = runtime.remote_order(table, guid, input, false);
        runtime.drive_for_guid(table, guid, order, quantum)
    }

    /// Authority updates source heading once when the event is admitted, independently of the
    /// physical body's pending correction. A rejected physical transaction cannot replay it here.
    pub(crate) fn apply_remote_pose_effect(&mut self, guid: Guid, effect: AuthoritativePoseEffect) {
        let Some(runtime) = self.bodies.get_mut(&guid) else {
            return;
        };
        match effect {
            AuthoritativePoseEffect::Initialize { .. } | AuthoritativePoseEffect::Reset { .. } => {
                runtime.remote_motion = None;
                runtime.sticky = super::StickyMotion::default();
            }
            AuthoritativePoseEffect::Interpolate {
                pose,
                keep_heading: false,
                ..
            }
            | AuthoritativePoseEffect::Snap { pose } => {
                runtime
                    .remote_motion
                    .get_or_insert_with(|| RemoteMotionState::new(pose.rotation))
                    .rotation = pose.rotation;
            }
            AuthoritativePoseEffect::Observe { .. }
            | AuthoritativePoseEffect::Confirm { .. }
            | AuthoritativePoseEffect::Interpolate {
                keep_heading: true, ..
            } => {}
        }
    }
}

impl BodyMotionRuntime {
    /// Resolve physical remote intent while retaining eligible gestures on ordinary playback.
    /// Incoming windups matter before packet admission has populated the action queue.
    fn remote_order(
        &mut self,
        table: &MotionSequenceTable,
        guid: Guid,
        input: RemoteMotionInput,
        incoming_windups: bool,
    ) -> MotionOrder {
        let unsupported = input
            .contact
            .presentation(CharacterMotionPresentation::Grounded)
            == CharacterMotionPresentation::Falling;
        let snapshot = input.snapshot;
        let commanded = MotionOrder::from_snapshot(snapshot);
        let remote = self
            .remote_motion
            .get_or_insert_with(|| RemoteMotionState::new(input.pose.rotation));
        let resolved = remote.order(guid, input, &mut self.sticky);
        if snapshot.directive.is_some() {
            return resolved;
        }
        // RETAIL DIVERGENCE: support replaces ordinary commands with Falling in retail.
        // Retaining accepted gestures permits remote airborne composition; reverting this
        // erases gestures at admission or next tick. Scope is the explicit spell/reach/missile
        // allowlist and 22 humanoid CharGen layouts.
        // Physical support still selects the lower-body pose.
        let style = commanded.style.unwrap_or(self.state.style);
        // Eligibility is based on executable content, not just a recognized command number.
        // An unsupported gesture must not discard the observer's current takeoff transition.
        let gesture_command = commanded.forward.is_some_and(|(command, _)| {
            command.movement_override_gesture().is_some()
                && table.cycle(style.raw(), command.raw()).is_some()
        });
        let gesture_return = commanded.forward.is_none_or(|(command, _)| {
            command == super::MotionCommand::READY
                || table.is_default_cycle(style.raw(), command.raw())
        });
        let ongoing_gesture = self.has_layerable_gesture(table);
        let preserve_gesture = self.gesture_actions_allow_locomotion()
            && (gesture_command || (gesture_return && (incoming_windups || ongoing_gesture)));
        if self.has_manual_locomotion() || preserve_gesture {
            // A gesture received during takeoff must not sit behind the old locomotion entry.
            // Existing gesture entries and queued windups retain their clocks and hooks.
            if unsupported && preserve_gesture && !ongoing_gesture {
                self.sequence.remove_transition_prefix();
            }
            commanded
        } else {
            resolved
        }
    }

    pub(super) fn retain_sticky_heading(&mut self, heading: f32) {
        if let Some(remote) = &mut self.remote_motion {
            remote.rotation = Quaternion::from_heading(heading);
        }
    }

    /// The last interpreted remote interval; observed animation cannot change this source sample.
    pub fn remote_motion_sample(&self) -> Option<RemoteMotionSample> {
        self.remote_motion.map(|remote| remote.sample)
    }
}
