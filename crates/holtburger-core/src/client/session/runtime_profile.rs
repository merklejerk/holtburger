//! Opt-in elapsed totals for the client authority's independent workloads and `physics_tick` phases.

use std::{
    collections::BTreeMap,
    fmt,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

/// Independent actor workloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RuntimeProfileScope {
    /// Dispatch of one bounded network batch.
    NetworkBatch,
    /// Dispatch of one bounded command batch.
    CommandBatch,
    /// Complete authority update, including simulation and awaited work.
    PhysicsTick,
}
impl RuntimeProfileScope {
    /// Stable vocabulary projected by diagnostic consumers.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NetworkBatch => "network_batch",
            Self::CommandBatch => "command_batch",
            Self::PhysicsTick => "physics_tick",
        }
    }
}

/// Non-overlapping sub-phases partitioning one `RuntimeProfileScope::PhysicsTick` observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PhysicsTickPhase {
    CommandDrain,
    PreTick,
    WorldTick,
    CollisionCoordinator,
    Simulation,
    PostSimulation,
    DynamicEntityDiff,
    Camera,
}

impl PhysicsTickPhase {
    /// Fixed variant count backing zero-allocation stack accumulation.
    pub const COUNT: usize = 8;

    /// Canonical emission order across telemetry and logs.
    pub const ALL: [Self; Self::COUNT] = [
        Self::CommandDrain,
        Self::PreTick,
        Self::WorldTick,
        Self::CollisionCoordinator,
        Self::Simulation,
        Self::PostSimulation,
        Self::DynamicEntityDiff,
        Self::Camera,
    ];

    /// Stable vocabulary projected by diagnostic consumers.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CommandDrain => "command_drain",
            Self::PreTick => "pre_tick",
            Self::WorldTick => "world_tick",
            Self::CollisionCoordinator => "collision_coordinator",
            Self::Simulation => "simulation",
            Self::PostSimulation => "post_simulation",
            Self::DynamicEntityDiff => "dynamic_entity_diff",
            Self::Camera => "camera",
        }
    }

    const fn index(self) -> usize {
        self as usize
    }
}

/// Bounded elapsed totals for one independent workload.
#[derive(Debug, Clone, Default)]
pub struct RuntimeScopeTotals {
    /// Completed observations represented by the total.
    pub sample_count: u64,
    /// Elapsed workload time, including waits.
    pub total: Duration,
}

/// Frozen or active capture state; observation counts need not match render frames.
#[derive(Debug, Clone, Default)]
pub struct RuntimeProfileSnapshot {
    /// Caller generation; only increasing generations are admitted.
    pub generation: u64,
    /// Whether new scopes may enter this capture.
    pub recording: bool,
    /// Unfinished scopes excluded if the capture is stopped.
    pub pending_scopes: u64,
    /// One total per independent actor workload.
    pub scopes: BTreeMap<RuntimeProfileScope, RuntimeScopeTotals>,
    /// Exhaustive sub-phase totals sharing the completed `PhysicsTick` window.
    pub physics_phases: BTreeMap<PhysicsTickPhase, RuntimeScopeTotals>,
}

#[derive(Default)]
struct ProfileState {
    /// Disabled probes skip the mutex and clock entirely.
    enabled: AtomicBool,
    /// Capture state is locked only for active admission, completion or cold control/read.
    capture: Mutex<RuntimeProfileSnapshot>,
}

/// Optional observer injected by a diagnostic frontend; no locks span measured work or awaits.
#[derive(Clone, Default)]
pub struct RuntimeProfileHandle(Arc<ProfileState>);
impl RuntimeProfileHandle {
    pub fn start(&self, generation: u64) -> anyhow::Result<()> {
        let mut state = self
            .0
            .capture
            .lock()
            .expect("runtime profile lock poisoned");
        anyhow::ensure!(
            generation > state.generation,
            "Performance start generation is stale"
        );
        *state = RuntimeProfileSnapshot {
            generation,
            recording: true,
            ..RuntimeProfileSnapshot::default()
        };
        self.0.enabled.store(true, Ordering::Release);
        Ok(())
    }
    pub fn stop(&self) -> RuntimeProfileSnapshot {
        let mut state = self
            .0
            .capture
            .lock()
            .expect("runtime profile lock poisoned");
        self.0.enabled.store(false, Ordering::Release);
        state.recording = false;
        state.clone()
    }
    pub fn snapshot(&self) -> RuntimeProfileSnapshot {
        self.0
            .capture
            .lock()
            .expect("runtime profile lock poisoned")
            .clone()
    }
    /// Shared fast gate for the composing host's paired forwarding capture.
    pub fn is_recording(&self) -> bool {
        self.0.enabled.load(Ordering::Acquire)
    }
    fn admit(&self) -> Option<u64> {
        if !self.is_recording() {
            return None;
        }
        let mut state = self
            .0
            .capture
            .lock()
            .expect("runtime profile lock poisoned");
        if !state.recording {
            return None;
        }
        state.pending_scopes += 1;
        Some(state.generation)
    }
}

/// Admission outlives awaits, but owns no mutex guard. Early returns release unfinished work.
struct RuntimeObservation {
    handle: RuntimeProfileHandle,
    generation: u64,
    /// Completion and pending-count release publish together when this guard is consumed.
    completed: Option<(
        RuntimeProfileScope,
        Duration,
        Option<[Duration; PhysicsTickPhase::COUNT]>,
    )>,
}
impl RuntimeObservation {
    fn finish(
        mut self,
        scope: RuntimeProfileScope,
        elapsed: Duration,
        phase_totals: Option<[Duration; PhysicsTickPhase::COUNT]>,
    ) {
        self.completed = Some((scope, elapsed, phase_totals));
    }
}
impl Drop for RuntimeObservation {
    fn drop(&mut self) {
        let mut state = self
            .handle
            .0
            .capture
            .lock()
            .expect("runtime profile lock poisoned");
        if state.recording && state.generation == self.generation {
            state.pending_scopes -= 1;
            if let Some((scope, elapsed, phase_totals)) = self.completed {
                let aggregate = state.scopes.entry(scope).or_default();
                aggregate.sample_count += 1;
                aggregate.total += elapsed;
                if let Some(phase_totals) = phase_totals {
                    for phase in PhysicsTickPhase::ALL {
                        let entry = state.physics_phases.entry(phase).or_default();
                        entry.sample_count += 1;
                        entry.total += phase_totals[phase.index()];
                    }
                }
            }
        }
    }
}

struct ScopeMeasurement {
    started: Instant,
    phase_boundary: Instant,
    phase_totals: Option<[Duration; PhysicsTickPhase::COUNT]>,
    observation: Option<RuntimeObservation>,
}

/// Two clock reads around one actor workload, shared by logging and diagnostic consumers.
pub(in crate::client) struct RuntimeScopeProfile {
    scope: RuntimeProfileScope,
    measurement: Option<ScopeMeasurement>,
}
impl RuntimeScopeProfile {
    pub(in crate::client) fn begin(
        scope: RuntimeProfileScope,
        handle: Option<&RuntimeProfileHandle>,
    ) -> Self {
        let observation = handle.and_then(|handle| {
            handle.admit().map(|generation| RuntimeObservation {
                handle: handle.clone(),
                generation,
                completed: None,
            })
        });
        let enabled = observation.is_some() || log::log_enabled!(log::Level::Debug);
        Self {
            scope,
            measurement: enabled.then(|| {
                let started = Instant::now();
                ScopeMeasurement {
                    started,
                    phase_boundary: started,
                    phase_totals: (scope == RuntimeProfileScope::PhysicsTick)
                        .then_some([Duration::ZERO; PhysicsTickPhase::COUNT]),
                    observation,
                }
            }),
        }
    }

    pub(in crate::client) fn checkpoint(&mut self, phase: PhysicsTickPhase) {
        let Some(measured) = self.measurement.as_mut() else {
            return;
        };
        let Some(totals) = measured.phase_totals.as_mut() else {
            return;
        };
        let now = Instant::now();
        totals[phase.index()] += now.duration_since(measured.phase_boundary);
        measured.phase_boundary = now;
    }

    pub(in crate::client) fn finish(self, context: fmt::Arguments<'_>) {
        if let Some(measured) = self.measurement {
            let elapsed = measured.started.elapsed();
            if let Some(observation) = measured.observation {
                observation.finish(self.scope, elapsed, measured.phase_totals);
            }
            if let Some(totals) = measured.phase_totals {
                log::debug!(
                    "scope={} total_ms={:.3} command_drain_ms={:.3} pre_tick_ms={:.3} world_tick_ms={:.3} collision_coordinator_ms={:.3} simulation_ms={:.3} post_simulation_ms={:.3} dynamic_entity_diff_ms={:.3} camera_ms={:.3} {}",
                    self.scope.as_str(),
                    elapsed.as_secs_f64() * 1000.0,
                    totals[PhysicsTickPhase::CommandDrain.index()].as_secs_f64() * 1000.0,
                    totals[PhysicsTickPhase::PreTick.index()].as_secs_f64() * 1000.0,
                    totals[PhysicsTickPhase::WorldTick.index()].as_secs_f64() * 1000.0,
                    totals[PhysicsTickPhase::CollisionCoordinator.index()].as_secs_f64() * 1000.0,
                    totals[PhysicsTickPhase::Simulation.index()].as_secs_f64() * 1000.0,
                    totals[PhysicsTickPhase::PostSimulation.index()].as_secs_f64() * 1000.0,
                    totals[PhysicsTickPhase::DynamicEntityDiff.index()].as_secs_f64() * 1000.0,
                    totals[PhysicsTickPhase::Camera.index()].as_secs_f64() * 1000.0,
                    context
                );
            } else {
                log::debug!(
                    "scope={} total_ms={:.3} {}",
                    self.scope.as_str(),
                    elapsed.as_secs_f64() * 1000.0,
                    context
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reset_and_stop_exclude_old_completions() {
        let handle = RuntimeProfileHandle::default();
        handle.start(1).unwrap();
        let old = RuntimeScopeProfile::begin(RuntimeProfileScope::PhysicsTick, Some(&handle));
        assert!(handle.start(1).is_err());
        handle.start(2).unwrap();
        old.finish(format_args!(""));
        assert!(handle.snapshot().scopes.is_empty());
        assert!(handle.snapshot().physics_phases.is_empty());
        let mut physics =
            RuntimeScopeProfile::begin(RuntimeProfileScope::PhysicsTick, Some(&handle));
        assert_eq!(handle.snapshot().pending_scopes, 1);
        physics.checkpoint(PhysicsTickPhase::CommandDrain);
        assert_eq!(handle.snapshot().pending_scopes, 1);
        physics.checkpoint(PhysicsTickPhase::Simulation);
        assert_eq!(handle.snapshot().pending_scopes, 1);
        physics.finish(format_args!(""));
        let snapshot = handle.snapshot();
        assert_eq!(
            snapshot.scopes[&RuntimeProfileScope::PhysicsTick].sample_count,
            1
        );
        assert_eq!(snapshot.pending_scopes, 0);
        for phase in PhysicsTickPhase::ALL {
            assert_eq!(snapshot.physics_phases[&phase].sample_count, 1);
        }
        let unfinished =
            RuntimeScopeProfile::begin(RuntimeProfileScope::NetworkBatch, Some(&handle));
        assert_eq!(handle.stop().pending_scopes, 1);
        unfinished.finish(format_args!(""));
        assert_eq!(handle.snapshot().scopes.len(), 1);
    }
    #[test]
    fn disabled_and_abandoned_work_does_not_accumulate() {
        let handle = RuntimeProfileHandle::default();
        assert!(handle.admit().is_none());
        handle.start(1).unwrap();
        drop(RuntimeScopeProfile::begin(
            RuntimeProfileScope::NetworkBatch,
            Some(&handle),
        ));
        assert_eq!(handle.snapshot().pending_scopes, 0);
        handle.stop();
        assert!(!handle.is_recording());
        assert!(handle.admit().is_none());
    }
}
