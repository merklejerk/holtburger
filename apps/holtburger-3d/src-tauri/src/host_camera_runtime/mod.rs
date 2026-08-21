//! App-local runtime adapter for the Explorer's collision-aware camera modes.
//!
//! The world crate owns collision queries and mode-specific solving. This module owns the concrete
//! Explorer policy: fixed fly and human grounded controls, mode handoff, and the placed-motion
//! transport consumed between host ticks. The shared host scheduler owns fixed-step cadence.

mod contract;
mod control;
mod presentation;

pub use contract::*;
use contract::{ValidatedPhysicalCameraControl, camera_mode_matches_response};
use control::{
    CameraInputControl, GroundedCameraControl, PendingGroundedEvent, PhysicalFlyCameraControl,
    RevisionedGroundedInput, bounded_pending_displacement, grounded_camera_actuation,
    grounded_heading, resolve_grounded_event,
};
use presentation::{
    PreparedCameraPresentation, PresentedViewer, grounded_viewer_offset, normalized_view_direction,
    parse_registration_residency, pose_with_cell, prepare_camera_presentation, resolve_viewer_cell,
    scene_point_to_residency_pose,
};

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, ensure};
use holtburger_common::Vector3;
use holtburger_world::{PhysicalBodyActuation, SpatialBodyId, resolve_physical_body_cell};
use tauri::{AppHandle, Emitter};

use crate::host_fixed_tick_runtime::{
    HostFixedTickDisposition, HostFixedTickParticipant, HostFixedTickRegistration,
    HostFixedTickRuntime, HostFixedTickSlot,
};
use crate::host_simulation_runtime::HostSimulationRuntime;

#[cfg(test)]
use crate::host_simulation_runtime::CollisionSource;

#[cfg(test)]
use crate::placed_motion_presentation::landblock_key;
#[cfg(test)]
use crate::placed_motion_presentation::scene_point_to_pose;
#[cfg(test)]
use presentation::transit_presented_viewer_path;

#[cfg(test)]
use crate::host_fixed_tick_runtime::HOST_FIXED_TICK_HZ as HOST_TICK_HZ;

/// Event carrying one authoritative fixed-tick placed-motion path.
pub const CAMERA_MOTION_EVENT: &str = "host://physical-camera-motion";

/// Event terminating one camera generation after a host-side fixed-tick failure.
pub const CAMERA_FAILURE_EVENT: &str = "host://physical-camera-failure";

/// Collision body and render viewer committed as one physical-camera state.
#[derive(Debug, Clone)]
struct ActiveCamera {
    /// Generic simulation body controlled by this app-local camera session.
    body_id: SpatialBodyId,
    viewer: PresentedViewer,
    input: CameraInputControl,
    /// Exact shared-scheduler installation for this camera generation.
    tick_registration: Option<HostFixedTickRegistration>,
}

#[derive(Debug, Default)]
struct CameraRuntimeState {
    active: Option<ActiveCamera>,
    sequence: u64,
}

/// One physical camera runtime shared by narrow Tauri commands and its tick task.
pub struct HostCameraRuntime {
    simulation: Arc<HostSimulationRuntime>,
    scheduler: Arc<HostFixedTickRuntime>,
    scheduler_slot: HostFixedTickSlot,
    state: Mutex<CameraRuntimeState>,
    /// Incrementing this token invalidates an old tick task without racing a new start.
    generation: AtomicU64,
}

impl HostCameraRuntime {
    /// Attaches the camera adapter to app-owned simulation and fixed-tick services.
    pub fn new(
        simulation: Arc<HostSimulationRuntime>,
        scheduler: Arc<HostFixedTickRuntime>,
    ) -> Self {
        let scheduler_slot = scheduler.reserve_slot();
        Self {
            simulation,
            scheduler,
            scheduler_slot,
            state: Mutex::new(CameraRuntimeState::default()),
            generation: AtomicU64::new(0),
        }
    }

    /// Registers one physical response after validating the renderer's placement-history seed.
    pub fn start(&self, registration: PhysicalCameraRegistration) -> Result<u64> {
        let (owner, initial_viewer_cell) = parse_registration_residency(&registration.residency)?;
        let mut presented_pose =
            scene_point_to_residency_pose(registration.scene_position, owner, initial_viewer_cell)?;
        let view_direction = normalized_view_direction(registration.view_direction)?;
        let mode = registration.control.mode();
        let control = registration.control.validate()?;
        if mode == PhysicalCameraMode::GroundedWalk {
            grounded_heading(view_direction)?;
        }
        let scene = self.simulation.snapshot();
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        let mut body_pose = presented_pose;
        if mode == PhysicalCameraMode::GroundedWalk {
            body_pose.coords = body_pose.coords - grounded_viewer_offset(view_direction);
        }
        let body_registration = registration.body.resolve()?;
        ensure!(
            camera_mode_matches_response(mode, body_registration.definition),
            "physical camera mode does not match its resolved body response"
        );
        let maximum_displacement_per_tick = match body_registration.definition {
            holtburger_world::PhysicalBodyDefinition::FreeSphere { config, .. } => {
                config.maximum_substep_distance * config.maximum_substeps as f32
            }
            holtburger_world::PhysicalBodyDefinition::Grounded { .. } => 0.0,
        };
        ensure!(
            maximum_displacement_per_tick.is_finite(),
            "physical camera displacement budget must be finite"
        );
        let body_cell = resolve_physical_body_cell(
            &scene,
            body_pose,
            body_registration.definition,
            initial_viewer_cell,
        )?;
        body_pose = pose_with_cell(body_pose, body_cell)?;
        let viewer_cell = resolve_viewer_cell(&scene, presented_pose, initial_viewer_cell)?;
        presented_pose = pose_with_cell(presented_pose, viewer_cell)?;
        let body_id = self.simulation.register_resolved_physical_body(
            body_pose,
            body_cell,
            body_registration,
            Instant::now(),
        )?;
        let viewer = PresentedViewer {
            pose: presented_pose,
            cell: viewer_cell,
            direction: view_direction,
        };
        // Invalidate the prior task while holding the body lock, immediately before replacement.
        let session = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let input = match control {
            ValidatedPhysicalCameraControl::PhysicalFly { speed_envelope } => {
                CameraInputControl::PhysicalFly(PhysicalFlyCameraControl {
                    intent: PhysicalFlyCameraIntent {
                        session,
                        view_direction: [view_direction.x, view_direction.y, view_direction.z],
                        ..PhysicalFlyCameraIntent::default()
                    },
                    last_intent_sequence: None,
                    speed_envelope,
                    movement_elapsed_seconds: 0.0,
                    movement_epoch: 0,
                    maximum_displacement_per_tick,
                    applied_world_displacement_total: Vector3::zero(),
                })
            }
            ValidatedPhysicalCameraControl::GroundedCharacter { kinematics } => {
                CameraInputControl::Grounded(GroundedCameraControl::new(kinematics, view_direction))
            }
        };
        if let Some(previous) = state.active.replace(ActiveCamera {
            body_id,
            viewer,
            input,
            tick_registration: None,
        }) {
            if let Some(registration) = previous.tick_registration {
                self.scheduler.remove(registration);
            }
            self.simulation.remove_body(previous.body_id);
        }
        state.sequence = 0;
        Ok(session)
    }

    /// Attaches one successfully started generation to the shared host clock.
    pub fn schedule(self: &Arc<Self>, app: AppHandle, session: u64) -> bool {
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        if !self.is_current(session) {
            return false;
        }
        let Some(active) = state.active.as_mut() else {
            return false;
        };
        let registration = self.scheduler.install(
            self.scheduler_slot,
            Arc::new(CameraTickParticipant {
                app,
                runtime: Arc::clone(self),
                session,
            }),
        );
        if let Some(previous) = active.tick_registration.replace(registration) {
            self.scheduler.remove(previous);
        }
        true
    }

    /// Replaces the desired world velocity and view direction consumed by the next fixed tick.
    pub fn set_physical_fly_intent(&self, mut intent: PhysicalFlyCameraIntent) -> Result<()> {
        ensure!(
            intent
                .world_velocity
                .iter()
                .all(|component| component.is_finite()),
            "physical camera intent must be finite"
        );
        ensure!(
            intent
                .world_displacement_total
                .iter()
                .all(|component| component.is_finite()),
            "physical camera displacement total must be finite"
        );
        let direction = normalized_view_direction(intent.view_direction)?;
        intent.view_direction = [direction.x, direction.y, direction.z];
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        if !self.is_current(intent.session) {
            return Ok(());
        }
        let active = state
            .active
            .as_mut()
            .context("physical camera is not registered")?;
        let CameraInputControl::PhysicalFly(control) = &mut active.input else {
            anyhow::bail!("concrete world-velocity intent is valid only for physical fly")
        };
        if control
            .last_intent_sequence
            .is_some_and(|sequence| intent.sequence <= sequence)
        {
            return Ok(());
        }
        ensure!(
            intent.movement_epoch >= control.movement_epoch,
            "physical camera movement epoch must not regress"
        );
        if intent.movement_epoch != control.movement_epoch
            || intent
                .world_velocity
                .iter()
                .all(|component| component.abs() <= f32::EPSILON)
        {
            // A release followed by a press may arrive between fixed ticks. Reset at command time
            // so the held-input envelope cannot miss that responsive stop/start boundary.
            control.movement_elapsed_seconds = 0.0;
            control.movement_epoch = intent.movement_epoch;
        }
        control.intent = intent;
        control.last_intent_sequence = Some(intent.sequence);
        Ok(())
    }

    /// Replaces semantic grounded drive and view state by monotonic frontend revision.
    pub fn set_grounded_drive(&self, mut intent: GroundedCameraDriveIntent) -> Result<()> {
        let direction = normalized_view_direction(intent.view_direction)?;
        grounded_heading(direction)?;
        intent.view_direction = [direction.x, direction.y, direction.z];
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        if !self.is_current(intent.session) {
            return Ok(());
        }
        let active = state
            .active
            .as_mut()
            .context("physical camera is not registered")?;
        let CameraInputControl::Grounded(control) = &mut active.input else {
            anyhow::bail!("semantic grounded drive is valid only for grounded walk")
        };
        if control
            .applied_revision
            .is_some_and(|revision| intent.revision <= revision)
            || control
                .latest_input
                .is_some_and(|input| intent.revision <= input.revision)
        {
            return Ok(());
        }
        control.latest_input = Some(RevisionedGroundedInput {
            revision: intent.revision,
            drive: intent.drive.resolve(),
            view_direction: direction,
        });
        Ok(())
    }

    /// Queues one lifecycle edge without allowing async command delivery to reorder it.
    pub fn queue_grounded_event(
        &self,
        request: GroundedCameraEventRequest,
    ) -> Result<GroundedCameraQueueResult> {
        if !self.is_current(request.session) {
            return Ok(GroundedCameraQueueResult::IgnoredStaleSession);
        }
        let event = resolve_grounded_event(request.event)?;
        let view_direction = normalized_view_direction(request.view_direction)?;
        grounded_heading(view_direction)?;
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        if !self.is_current(request.session) {
            return Ok(GroundedCameraQueueResult::IgnoredStaleSession);
        }
        let active = state
            .active
            .as_mut()
            .context("physical camera is not registered")?;
        let CameraInputControl::Grounded(control) = &mut active.input else {
            return Ok(GroundedCameraQueueResult::RejectedWrongMode);
        };
        if request.sequence < control.next_event_sequence
            || control.pending_events.contains_key(&request.sequence)
        {
            return Ok(GroundedCameraQueueResult::IgnoredDuplicate);
        }
        control.pending_events.insert(
            request.sequence,
            PendingGroundedEvent {
                revision: request.revision,
                event,
                view_direction,
            },
        );
        Ok(GroundedCameraQueueResult::Queued)
    }

    /// Invalidates the active task and clears input without inventing a replacement pose.
    pub fn stop(&self, session: u64) {
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        if !self.is_current(session) {
            return;
        }
        self.generation.store(session + 1, Ordering::SeqCst);
        if let Some(active) = state.active.take() {
            if let Some(registration) = active.tick_registration {
                self.scheduler.remove(registration);
            }
            self.simulation.remove_body(active.body_id);
        }
    }

    fn is_current(&self, session: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == session
    }

    fn tick(&self, session: u64, dt: Duration) -> Result<Option<PhysicalCameraMotionPath>> {
        if !self.is_current(session) {
            return Ok(None);
        }
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        // A prior task may have passed the first check and then waited behind a new registration.
        if !self.is_current(session) {
            return Ok(None);
        }
        let Some(previous) = state.active.clone() else {
            return Ok(None);
        };
        let solve_started_at = Instant::now();
        let mut input = previous.input.clone();
        let mut character_event_outcomes = Vec::new();
        let (_solved, presentation, fly_displacement) = match &mut input {
            CameraInputControl::PhysicalFly(control) => {
                let target_velocity = Vector3::new(
                    control.intent.world_velocity[0],
                    control.intent.world_velocity[1],
                    control.intent.world_velocity[2],
                );
                let velocity =
                    control.requested_velocity_for_tick(target_velocity, dt.as_secs_f32());
                let requested_total = Vector3::new(
                    control.intent.world_displacement_total[0],
                    control.intent.world_displacement_total[1],
                    control.intent.world_displacement_total[2],
                );
                let pending = requested_total - control.applied_world_displacement_total;
                let available = (control.maximum_displacement_per_tick
                    - velocity.length() * dt.as_secs_f32())
                .max(0.0);
                let consumes_all = pending.length() <= available;
                let consumed = bounded_pending_displacement(pending, available);
                let velocity = velocity + consumed / dt.as_secs_f32();
                let direction = normalized_view_direction(control.intent.view_direction)?;
                let (solved, presentation) = self.simulation.tick_physical_body_transaction_with(
                    previous.body_id,
                    dt.as_secs_f32(),
                    Instant::now(),
                    |_| Ok(PhysicalBodyActuation::free_flight(velocity)?),
                    |solved| prepare_camera_presentation(&previous, solved, direction),
                )?;
                (
                    solved,
                    presentation,
                    Some((requested_total, consumed, consumes_all)),
                )
            }
            CameraInputControl::Grounded(control) => {
                let resolved_direction = std::cell::Cell::new(control.view_direction);
                let (solved, presentation) = self.simulation.tick_physical_body_transaction_with(
                    previous.body_id,
                    dt.as_secs_f32(),
                    Instant::now(),
                    |body| {
                        let actuation = grounded_camera_actuation(
                            control,
                            body,
                            &mut character_event_outcomes,
                        )?;
                        resolved_direction.set(control.view_direction);
                        Ok(actuation)
                    },
                    |solved| {
                        prepare_camera_presentation(&previous, solved, resolved_direction.get())
                    },
                )?;
                (solved, presentation, None)
            }
        };
        if let (
            CameraInputControl::PhysicalFly(control),
            Some((requested_total, consumed, consumes_all)),
        ) = (&mut input, fly_displacement)
        {
            control.applied_world_displacement_total = if consumes_all {
                // Exact assignment prevents a floating-point subtraction tail from becoming a
                // second microscopic displacement on the next tick.
                requested_total
            } else {
                control.applied_world_displacement_total + consumed
            };
        }
        let solve_duration_ms = solve_started_at.elapsed().as_secs_f64() * 1_000.0;
        let PreparedCameraPresentation {
            initial,
            legs,
            viewer,
            status,
            scene_residency,
            ground_state,
            constraint_count,
            substeps,
            contact_passes,
        } = presentation;
        state.active = Some(ActiveCamera {
            body_id: previous.body_id,
            viewer,
            input,
            tick_registration: previous.tick_registration,
        });
        let sequence = state.sequence;
        state.sequence += 1;
        let path = PhysicalCameraMotionPath {
            session,
            sequence,
            mode: previous.input.mode(),
            duration_ms: dt.as_secs_f64() * 1_000.0,
            initial,
            legs,
            status,
            scene_residency,
            ground_state,
            constraint_count,
            substeps,
            contact_passes,
            solve_duration_ms,
            character_event_outcomes,
        };
        Ok(Some(path))
    }
}

struct CameraTickParticipant {
    app: AppHandle,
    runtime: Arc<HostCameraRuntime>,
    session: u64,
}

impl HostFixedTickParticipant for CameraTickParticipant {
    fn fixed_tick(&self, delta: Duration) -> Result<HostFixedTickDisposition> {
        let Some(tick) = self.runtime.tick(self.session, delta)? else {
            return Ok(HostFixedTickDisposition::Finished);
        };
        self.app.emit(CAMERA_MOTION_EVENT, tick)?;
        Ok(HostFixedTickDisposition::Continue)
    }

    fn fixed_tick_failed(&self, error: &anyhow::Error) {
        eprintln!("physical camera tick failed: {error:#}");
        self.runtime.stop(self.session);
        let _ = self.app.emit(
            CAMERA_FAILURE_EVENT,
            PhysicalCameraFailure {
                session: self.session,
                message: format!("{error:#}"),
            },
        );
    }
}

#[cfg(test)]
mod tests;
