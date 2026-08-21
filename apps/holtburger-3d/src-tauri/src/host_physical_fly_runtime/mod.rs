//! App-local runtime adapter for Explorer collision-aware physical fly.
//!
//! The world crate owns collision queries and body solving. This module owns the concrete Explorer
//! policy: fly input, ownership handoff, and the placed-motion
//! transport consumed between host ticks. The shared host scheduler owns fixed-step cadence.

mod contract;
mod input;
mod viewer_projection;

pub use contract::*;
use input::{PhysicalFlyInputAccumulator, bounded_pending_displacement};
use viewer_projection::{
    PreparedPhysicalFlyPresentation, PresentedViewer, parse_registration_residency, pose_with_cell,
    prepare_physical_fly_presentation, resolve_viewer_cell, scene_point_to_residency_pose,
};

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, ensure};
use holtburger_common::Vector3;
use holtburger_world::{
    PhysicalBodyActuation, PhysicalCollisionExclusions, PhysicalCollisionFilter, SpatialBodyId,
    resolve_physical_body_cell,
};
use tauri::{AppHandle, Emitter};

use crate::host_fixed_tick_runtime::{
    HostFixedTickDisposition, HostFixedTickParticipant, HostFixedTickRegistration,
    HostFixedTickRuntime, HostFixedTickSlot,
};
use crate::host_simulation_runtime::{HostSimulationRuntime, ResolvedPhysicalBodyRegistration};

#[cfg(test)]
use crate::host_simulation_runtime::CollisionSource;

#[cfg(test)]
use crate::host_fixed_tick_runtime::HOST_FIXED_TICK_HZ as HOST_TICK_HZ;
#[cfg(test)]
use crate::placed_motion_presentation::landblock_key;
#[cfg(test)]
use crate::placed_motion_presentation::scene_point_to_pose;

/// Event carrying one authoritative fixed-tick placed-motion path.
pub const PHYSICAL_FLY_MOTION_EVENT: &str = "host://physical-fly-motion";

/// Event terminating one camera generation after a host-side fixed-tick failure.
pub const PHYSICAL_FLY_FAILURE_EVENT: &str = "host://physical-fly-failure";

/// Collision body and render viewer committed as one physical-fly state.
#[derive(Debug, Clone)]
struct ActivePhysicalFly {
    /// Generic simulation body controlled by this app-local camera session.
    body_id: SpatialBodyId,
    viewer: PresentedViewer,
    input: PhysicalFlyInputAccumulator,
    /// Exact shared-scheduler installation for this camera generation.
    tick_registration: Option<HostFixedTickRegistration>,
}

#[derive(Debug, Default)]
struct PhysicalFlyRuntimeState {
    active: Option<ActivePhysicalFly>,
    sequence: u64,
}

/// One physical fly runtime shared by narrow Tauri commands and its tick task.
pub struct HostPhysicalFlyRuntime {
    simulation: Arc<HostSimulationRuntime>,
    scheduler: Arc<HostFixedTickRuntime>,
    scheduler_slot: HostFixedTickSlot,
    state: Mutex<PhysicalFlyRuntimeState>,
    /// Incrementing this token invalidates an old tick task without racing a new start.
    generation: AtomicU64,
}

impl HostPhysicalFlyRuntime {
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
            state: Mutex::new(PhysicalFlyRuntimeState::default()),
            generation: AtomicU64::new(0),
        }
    }

    /// Registers one physical response after validating the renderer's placement-history seed.
    pub fn start(&self, registration: PhysicalFlyRegistration) -> Result<u64> {
        let (owner, initial_viewer_cell) = parse_registration_residency(&registration.residency)?;
        let mut presented_pose =
            scene_point_to_residency_pose(registration.scene_position, owner, initial_viewer_cell)?;
        let speed_envelope = registration.speed_envelope.validate()?;
        let scene = self.simulation.snapshot();
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        let mut body_pose = presented_pose;
        let profile = holtburger_core::physical_fly_viewer_profile()?;
        let body_registration = ResolvedPhysicalBodyRegistration {
            definition: profile.definition,
            collision_filter: PhysicalCollisionFilter::excluding(
                PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER,
            ),
            response_policy: profile.response_policy,
        };
        let maximum_displacement_per_tick = match body_registration.definition {
            holtburger_world::PhysicalBodyDefinition::FreeSphere { config, .. } => {
                config.maximum_substep_distance * config.maximum_substeps as f32
            }
            holtburger_world::PhysicalBodyDefinition::Grounded { .. } => {
                anyhow::bail!("physical-fly camera requires a free-sphere body response")
            }
        };
        ensure!(
            maximum_displacement_per_tick.is_finite(),
            "physical fly displacement budget must be finite"
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
        };
        // Invalidate the prior task while holding the body lock, immediately before replacement.
        let session = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let input = PhysicalFlyInputAccumulator {
            intent: PhysicalFlyIntent {
                session,
                ..PhysicalFlyIntent::default()
            },
            last_intent_sequence: None,
            speed_envelope,
            movement_elapsed_seconds: 0.0,
            movement_epoch: 0,
            maximum_displacement_per_tick,
            applied_world_displacement_total: Vector3::zero(),
        };
        if let Some(previous) = state.active.replace(ActivePhysicalFly {
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
            Arc::new(PhysicalFlyTickParticipant {
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

    /// Replaces the desired world velocity consumed by the next fixed tick.
    pub fn set_intent(&self, intent: PhysicalFlyIntent) -> Result<()> {
        ensure!(
            intent
                .world_velocity
                .iter()
                .all(|component| component.is_finite()),
            "physical fly intent must be finite"
        );
        ensure!(
            intent
                .world_displacement_total
                .iter()
                .all(|component| component.is_finite()),
            "physical fly displacement total must be finite"
        );
        let mut state = self.state.lock().expect("camera runtime lock poisoned");
        if !self.is_current(intent.session) {
            return Ok(());
        }
        let active = state
            .active
            .as_mut()
            .context("physical fly is not registered")?;
        let control = &mut active.input;
        if control
            .last_intent_sequence
            .is_some_and(|sequence| intent.sequence <= sequence)
        {
            return Ok(());
        }
        ensure!(
            intent.movement_epoch >= control.movement_epoch,
            "physical fly movement epoch must not regress"
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

    fn tick(&self, session: u64, dt: Duration) -> Result<Option<PhysicalFlyMotionPath>> {
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
        let mut input = previous.input;
        let (presentation, fly_displacement) = {
            let control = &mut input;
            let target_velocity = Vector3::new(
                control.intent.world_velocity[0],
                control.intent.world_velocity[1],
                control.intent.world_velocity[2],
            );
            let velocity = control.requested_velocity_for_tick(target_velocity, dt.as_secs_f32());
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
            let (solved, presentation) = self.simulation.tick_physical_body_transaction_with(
                previous.body_id,
                dt.as_secs_f32(),
                Instant::now(),
                |_| Ok(PhysicalBodyActuation::free_flight(velocity)?),
                |solved| prepare_physical_fly_presentation(&previous, solved),
            )?;
            let _ = solved;
            (presentation, (requested_total, consumed, consumes_all))
        };
        {
            let control = &mut input;
            let (requested_total, consumed, consumes_all) = fly_displacement;
            control.applied_world_displacement_total = if consumes_all {
                // Exact assignment prevents a floating-point subtraction tail from becoming a
                // second microscopic displacement on the next tick.
                requested_total
            } else {
                control.applied_world_displacement_total + consumed
            };
        }
        let solve_duration_ms = solve_started_at.elapsed().as_secs_f64() * 1_000.0;
        let PreparedPhysicalFlyPresentation {
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
        state.active = Some(ActivePhysicalFly {
            body_id: previous.body_id,
            viewer,
            input,
            tick_registration: previous.tick_registration,
        });
        let sequence = state.sequence;
        state.sequence += 1;
        let path = PhysicalFlyMotionPath {
            session,
            sequence,
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
        };
        Ok(Some(path))
    }
}

struct PhysicalFlyTickParticipant {
    app: AppHandle,
    runtime: Arc<HostPhysicalFlyRuntime>,
    session: u64,
}

impl HostFixedTickParticipant for PhysicalFlyTickParticipant {
    fn fixed_tick(&self, delta: Duration) -> Result<HostFixedTickDisposition> {
        let Some(tick) = self.runtime.tick(self.session, delta)? else {
            return Ok(HostFixedTickDisposition::Finished);
        };
        self.app.emit(PHYSICAL_FLY_MOTION_EVENT, tick)?;
        Ok(HostFixedTickDisposition::Continue)
    }

    fn fixed_tick_failed(&self, error: &anyhow::Error) {
        eprintln!("physical fly tick failed: {error:#}");
        self.runtime.stop(self.session);
        let _ = self.app.emit(
            PHYSICAL_FLY_FAILURE_EVENT,
            PhysicalFlyFailure {
                session: self.session,
                message: format!("{error:#}"),
            },
        );
    }
}

#[cfg(test)]
mod tests;
