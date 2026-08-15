use std::collections::BTreeMap;

use anyhow::{Result, ensure};
use holtburger_common::Vector3;
use holtburger_core::client::movement_types::MotionState;
use holtburger_core::{
    CharacterJumpKinematics, CharacterJumpReadiness, CharacterJumpRejection,
    CharacterMotionContact, CharacterMotionController, CharacterMotionEvent,
    CharacterMotionEventResult, CharacterMotionRejection, CharacterMotionSequence, JumpExtent,
    SequencedCharacterMotionEvent, resolve_character_drive, resolve_character_jump,
};
use holtburger_world::{
    ContactState, GroundedBodyActuation, GroundedLaunch, PhysicalBodyActuation, SpatialBody,
};

use super::{
    GroundedCameraEventKind, GroundedCameraEventOutcome, GroundedCameraEventOutcomeKind,
    GroundedCameraRejection, PhysicalCameraMode, PhysicalCameraSpeedEnvelope,
    PhysicalFlyCameraIntent,
};

/// Physical-fly input and acceleration retained for one ownership epoch.
#[derive(Debug, Clone, Copy)]
pub(super) struct PhysicalFlyCameraControl {
    /// Latest concrete fly intent accepted from the frontend.
    pub(super) intent: PhysicalFlyCameraIntent,
    /// Latest applied intent sequence.
    pub(super) last_intent_sequence: Option<u64>,
    /// Translation response selected by the registering application.
    pub(super) speed_envelope: PhysicalCameraSpeedEnvelope,
    /// Elapsed uninterrupted nonzero movement input, saturated at the ramp duration.
    pub(super) movement_elapsed_seconds: f32,
    /// Latest frontend movement generation applied to this controller.
    pub(super) movement_epoch: u64,
    /// Maximum displacement that the registered free-sphere response can subdivide in one tick.
    pub(super) maximum_displacement_per_tick: f32,
    /// Portion of cumulative wheel displacement already submitted to simulation.
    pub(super) applied_world_displacement_total: Vector3,
}

impl PhysicalFlyCameraControl {
    pub(super) fn requested_velocity_for_tick(
        &mut self,
        target_velocity: Vector3,
        delta_seconds: f32,
    ) -> Vector3 {
        if target_velocity.length_squared() <= f32::EPSILON {
            self.movement_elapsed_seconds = 0.0;
            return Vector3::zero();
        }
        let PhysicalCameraSpeedEnvelope::LinearRamp {
            acceleration_seconds,
            initial_speed_multiplier,
        } = self.speed_envelope
        else {
            return target_velocity;
        };
        let start = self.movement_elapsed_seconds;
        let end = start + delta_seconds;
        self.movement_elapsed_seconds = end.min(acceleration_seconds);
        let average_progress = (linear_ramp_area(end, acceleration_seconds)
            - linear_ramp_area(start, acceleration_seconds))
            / delta_seconds;
        let multiplier =
            initial_speed_multiplier + (1.0 - initial_speed_multiplier) * average_progress;
        target_velocity * multiplier
    }
}

/// Drains one-shot displacement without exceeding the registered subdivision envelope.
pub(super) fn bounded_pending_displacement(pending: Vector3, available_distance: f32) -> Vector3 {
    if pending.length() <= available_distance {
        pending
    } else if available_distance > 0.0 {
        pending.normalize() * available_distance
    } else {
        Vector3::zero()
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct RevisionedGroundedInput {
    pub(super) revision: u64,
    pub(super) drive: MotionState,
    pub(super) view_direction: Vector3,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct PendingGroundedEvent {
    pub(super) revision: u64,
    pub(super) event: CharacterMotionEvent,
    pub(super) view_direction: Vector3,
}

/// Character semantics retained only for the grounded camera regime.
#[derive(Debug, Clone)]
pub(super) struct GroundedCameraControl {
    interpreter: CharacterMotionController,
    /// App adapter inputs consumed only after the interpreter emits a jump attempt.
    kinematics: CharacterJumpKinematics,
    pub(super) latest_input: Option<RevisionedGroundedInput>,
    pub(super) applied_revision: Option<u64>,
    pub(super) next_event_sequence: u64,
    pub(super) pending_events: BTreeMap<u64, PendingGroundedEvent>,
    /// Latest normalized view direction paired with semantic drive.
    pub(super) view_direction: Vector3,
}

impl GroundedCameraControl {
    pub(super) fn new(kinematics: CharacterJumpKinematics, view_direction: Vector3) -> Self {
        Self {
            interpreter: CharacterMotionController::new(),
            kinematics,
            latest_input: None,
            applied_revision: None,
            next_event_sequence: 0,
            pending_events: BTreeMap::new(),
            view_direction,
        }
    }
}

#[derive(Debug, Clone)]
pub(super) enum CameraInputControl {
    PhysicalFly(PhysicalFlyCameraControl),
    Grounded(GroundedCameraControl),
}

impl CameraInputControl {
    pub(super) fn mode(&self) -> PhysicalCameraMode {
        match self {
            Self::PhysicalFly(_) => PhysicalCameraMode::PhysicalFly,
            Self::Grounded(_) => PhysicalCameraMode::GroundedWalk,
        }
    }
}

pub(super) fn grounded_camera_actuation(
    control: &mut GroundedCameraControl,
    body: &SpatialBody,
    outcomes: &mut Vec<GroundedCameraEventOutcome>,
) -> Result<PhysicalBodyActuation> {
    let mut launch = None;
    while let Some(pending) = control.pending_events.remove(&control.next_event_sequence) {
        let sequence = control.next_event_sequence;
        control.next_event_sequence += 1;
        let contact = if launch.is_some() {
            CharacterMotionContact::Unsupported
        } else {
            character_motion_contact(body)
        };
        let result = control.interpreter.apply_event(
            SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(sequence),
                event: pending.event,
            },
            contact,
        );
        control.view_direction = pending.view_direction;
        control.applied_revision = Some(
            control
                .applied_revision
                .map_or(pending.revision, |revision| revision.max(pending.revision)),
        );
        let outcome = match result {
            CharacterMotionEventResult::ChargeAccepted => {
                GroundedCameraEventOutcomeKind::ChargeAccepted
            }
            CharacterMotionEventResult::ChargeContinues => {
                GroundedCameraEventOutcomeKind::ChargeContinues
            }
            CharacterMotionEventResult::Reset => GroundedCameraEventOutcomeKind::Reset,
            CharacterMotionEventResult::IgnoredStale { .. } => {
                GroundedCameraEventOutcomeKind::IgnoredStale
            }
            CharacterMotionEventResult::Rejected(reason) => {
                GroundedCameraEventOutcomeKind::Rejected {
                    reason: match reason {
                        CharacterMotionRejection::ChargeNotActive => {
                            GroundedCameraRejection::ChargeNotActive
                        }
                        CharacterMotionRejection::Unsupported => {
                            GroundedCameraRejection::Unsupported
                        }
                    },
                }
            }
            CharacterMotionEventResult::JumpReleased(attempt) => {
                let heading = grounded_heading(control.view_direction)?;
                let readiness = if launch.is_some() {
                    // Two release cycles can arrive inside one 30 Hz interval, but only the first
                    // can atomically leave the support observed at this tick's start.
                    CharacterJumpReadiness::Airborne
                } else {
                    character_jump_readiness(body)
                };
                match resolve_character_jump(control.kinematics, attempt, heading, readiness) {
                    Ok(resolved) => {
                        launch = Some(GroundedLaunch::new(resolved.world_velocity())?);
                        GroundedCameraEventOutcomeKind::JumpReleased
                    }
                    Err(reason) => GroundedCameraEventOutcomeKind::Rejected {
                        reason: jump_rejection(reason),
                    },
                }
            }
        };
        outcomes.push(GroundedCameraEventOutcome {
            sequence,
            result: outcome,
        });
    }

    if let Some(latest_input) = control.latest_input
        && control
            .applied_revision
            .is_none_or(|revision| latest_input.revision > revision)
    {
        control.interpreter.replace_drive(latest_input.drive);
        control.view_direction = latest_input.view_direction;
        control.applied_revision = Some(latest_input.revision);
    }
    let heading = grounded_heading(control.view_direction)?;
    let drive = resolve_character_drive(
        control.kinematics.movement(),
        control.interpreter.effective_drive(),
        heading,
    )?;
    let actuation = GroundedBodyActuation::drive(drive)?.with_control_heading(heading)?;
    Ok(PhysicalBodyActuation::Grounded(match launch {
        Some(launch) => actuation.with_launch(launch),
        None => actuation,
    }))
}

fn character_motion_contact(body: &SpatialBody) -> CharacterMotionContact {
    if body.contact == ContactState::Grounded {
        CharacterMotionContact::Walkable
    } else {
        CharacterMotionContact::Unsupported
    }
}

fn character_jump_readiness(body: &SpatialBody) -> CharacterJumpReadiness {
    match body.contact {
        ContactState::Grounded => CharacterJumpReadiness::Supported,
        ContactState::Airborne => CharacterJumpReadiness::Airborne,
        ContactState::Unknown => CharacterJumpReadiness::Unsupported,
    }
}

fn jump_rejection(reason: CharacterJumpRejection) -> GroundedCameraRejection {
    match reason {
        CharacterJumpRejection::Airborne => GroundedCameraRejection::Airborne,
        CharacterJumpRejection::Unsupported => GroundedCameraRejection::Unsupported,
        CharacterJumpRejection::Constrained => GroundedCameraRejection::Constrained,
        CharacterJumpRejection::InvalidHeading => GroundedCameraRejection::InvalidHeading,
    }
}

pub(super) fn grounded_heading(view_direction: Vector3) -> Result<f32> {
    ensure!(
        view_direction.x.hypot(view_direction.y) > f32::EPSILON,
        "grounded camera view direction must have a horizontal component"
    );
    Ok(view_direction.y.atan2(-view_direction.x))
}

pub(super) fn resolve_grounded_event(
    request: GroundedCameraEventKind,
) -> Result<CharacterMotionEvent> {
    Ok(match request {
        GroundedCameraEventKind::BeginJump { drive } => CharacterMotionEvent::BeginJump {
            drive: drive.resolve(),
        },
        GroundedCameraEventKind::ReleaseJump { drive, extent } => {
            let extent = JumpExtent::new(extent)
                .map_err(|error| anyhow::anyhow!("invalid grounded jump extent: {error:?}"))?;
            CharacterMotionEvent::ReleaseJump {
                drive: drive.resolve(),
                extent,
            }
        }
        GroundedCameraEventKind::Reset => CharacterMotionEvent::Reset,
    })
}

/// Integral of `min(elapsed / duration, 1)` from zero through `elapsed`.
fn linear_ramp_area(elapsed: f32, duration: f32) -> f32 {
    if elapsed <= duration {
        elapsed * elapsed / (2.0 * duration)
    } else {
        elapsed - duration / 2.0
    }
}
