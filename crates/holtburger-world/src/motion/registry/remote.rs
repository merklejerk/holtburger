//! Remote command progress and its frame belong to the same owner as authored playback.

use super::{BodyMotionRuntime, MotionRuntimeRegistry};
use crate::entity::{EntityMotionAction, EntityMotionDirective, EntityMotionSnapshot};
use crate::motion::{
    CharacterMotionPresentation, MotionOrder, SequenceTick, ServerDirectedMotionResolution,
    ServerDirectedMotionState, ServerDirectedTarget, begin_server_directed_motion,
    resolve_server_directed_motion,
};
use crate::spatial::{AuthoritativePoseEffect, ContactState, integrate_angular_velocity};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, RigidTransform, Vector3};
use holtburger_content::MotionSequenceTable;

/// Source facts sampled once by the world before the remote command is interpreted.
pub(crate) struct RemoteMotionInput {
    /// Current admitted wire command snapshot.
    pub snapshot: EntityMotionSnapshot,
    /// Actual position; rotation seeds command frames and refreshes body-following sources.
    pub pose: WorldPosition,
    /// Current support classification used by command reduction.
    pub contact: ContactState,
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

/// Retain terminal identity so an unchanged completed directive cannot restart after displacement.
#[derive(Debug, Clone, Copy, PartialEq)]
struct RemoteDirective {
    /// Wire admission identity retained even after completion.
    directive: EntityMotionDirective,
    /// Active pure-reducer successor, or terminal completion/failure.
    state: Option<ServerDirectedMotionState>,
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
        let terminal = steady.with_character_presentation(CharacterMotionPresentation::resolve(
            input.contact,
            false,
            false,
        ));
        let Some(directive) = input.snapshot.directive else {
            self.directive = None;
            return terminal;
        };
        let state = match self.directive {
            Some(retained) if retained.directive == directive => retained.state,
            _ => Some(begin_server_directed_motion(directive, pose, input.target)),
        };
        let Some(state) = state else {
            return terminal;
        };
        let (state, order) = match resolve_server_directed_motion(
            state,
            steady,
            pose,
            input.contact,
            input.target,
        ) {
            ServerDirectedMotionResolution::Active(step) => (Some(step.state), step.order),
            ServerDirectedMotionResolution::Complete { sticky_target } => {
                if let Some(target) = sticky_target {
                    sticky.admit(Some(target), std::time::Instant::now());
                }
                (None, terminal)
            }
            ServerDirectedMotionResolution::Failed(failure) => {
                log::warn!("entity 0x{guid:08X} server-directed motion failed: {failure:?}");
                (None, terminal)
            }
        };
        self.directive = Some(RemoteDirective { directive, state });
        order
    }
}

impl MotionRuntimeRegistry {
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
        let remote = runtime
            .remote_motion
            .get_or_insert_with(|| RemoteMotionState::new(input.pose.rotation));
        let order = remote.order(guid, input, &mut runtime.sticky);
        let previous_unmodelled = runtime.unmodelled;
        runtime.accept_order(table, order);
        for action in actions {
            if runtime.enqueue_action(action) == super::MotionActionEnqueueOutcome::Overflow {
                log::warn!(
                    "body 0x{guid:08X} rejected action 0x{:08X}: retail six-action queue is full",
                    action.command.raw()
                );
            }
        }
        runtime.drive(table, order, 0.0);
        runtime.report_selection(table, guid, previous_unmodelled);
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
        let remote = runtime
            .remote_motion
            .get_or_insert_with(|| RemoteMotionState::new(input.pose.rotation));
        let order = remote.order(guid, input, &mut runtime.sticky);
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
            AuthoritativePoseEffect::Confirm { .. }
            | AuthoritativePoseEffect::Interpolate {
                keep_heading: true, ..
            } => {}
        }
    }
}

impl BodyMotionRuntime {
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
