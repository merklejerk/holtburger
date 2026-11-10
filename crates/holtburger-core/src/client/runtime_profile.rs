//! Opt-in elapsed totals for the client authority's three independent workloads.

use std::{
    collections::BTreeMap,
    fmt,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

/// Independent actor workloads; no per-phase or nested simulation probes are retained.
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
    completed: Option<(RuntimeProfileScope, Duration)>,
}
impl RuntimeObservation {
    fn finish(mut self, scope: RuntimeProfileScope, elapsed: Duration) {
        self.completed = Some((scope, elapsed));
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
            if let Some((scope, elapsed)) = self.completed {
                let aggregate = state.scopes.entry(scope).or_default();
                aggregate.sample_count += 1;
                aggregate.total += elapsed;
            }
        }
    }
}

struct ScopeMeasurement {
    started: Instant,
    observation: Option<RuntimeObservation>,
}

/// Two clock reads around one actor workload, shared by logging and diagnostic consumers.
pub(super) struct RuntimeScopeProfile {
    scope: RuntimeProfileScope,
    measurement: Option<ScopeMeasurement>,
}
impl RuntimeScopeProfile {
    pub(super) fn begin(scope: RuntimeProfileScope, handle: Option<&RuntimeProfileHandle>) -> Self {
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
            measurement: enabled.then(|| ScopeMeasurement {
                started: Instant::now(),
                observation,
            }),
        }
    }
    pub(super) fn finish(self, context: fmt::Arguments<'_>) {
        if let Some(measured) = self.measurement {
            let elapsed = measured.started.elapsed();
            if let Some(observation) = measured.observation {
                observation.finish(self.scope, elapsed);
            }
            log::debug!(
                "scope={} total_ms={:.3} {}",
                self.scope.as_str(),
                elapsed.as_secs_f64() * 1000.0,
                context
            );
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
        RuntimeScopeProfile::begin(RuntimeProfileScope::PhysicsTick, Some(&handle))
            .finish(format_args!(""));
        assert_eq!(
            handle.snapshot().scopes[&RuntimeProfileScope::PhysicsTick].sample_count,
            1
        );
        assert_eq!(handle.snapshot().pending_scopes, 0);
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
