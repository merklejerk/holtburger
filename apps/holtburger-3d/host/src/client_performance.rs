//! App-local aggregation and wire projection for client authority and forwarding diagnostics.

use holtburger_core::client::runtime_profile::{RuntimeProfileHandle, RuntimeProfileSnapshot};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

/// Explicit cold control; generation identifies a browser-owned capture, never a wall clock.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientPerformanceRequest {
    /// Requested start/reset, snapshot, or stop operation.
    pub action: PerformanceAction,
    /// Safe-integer capture identity; stale read/stop commands are rejected.
    pub generation: u64,
}

/// One bounded capture operation; start also resets the prior window.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PerformanceAction {
    Start,
    Snapshot,
    Stop,
}

/// Whole authority workload projected using its core-owned scope name.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScopeMean {
    /// Core scope spelling, not arbitrary application data.
    scope: &'static str,
    /// Completed scopes represented by this mean.
    sample_count: u64,
    /// Includes awaited work.
    mean_ms: f64,
}

/// Completed forwarding work; retained only while explicitly capturing.
#[derive(Debug, Clone, Default)]
struct ForwardingTotals {
    sample_count: u64,
    elapsed: Duration,
}

/// Coarse elapsed event-delivery boundary, independent of authority-loop samples.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardingProfile {
    sample_count: u64,
    mean_ms: Option<f64>,
}

/// Typed native response; sample coverage is independent of browser/GPU frame counts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPerformanceSnapshot {
    generation: u64,
    recording: bool,
    /// Native elapsed window, measured entirely with the native monotonic clock.
    elapsed_ms: f64,
    /// Unfinished authority workloads excluded on stop.
    pending_scopes: u64,
    authority: Vec<NativeScopeMean>,
    forwarding: ForwardingProfile,
}

/// Native window state keeps the running clock and frozen duration mutually exclusive.
#[derive(Default, Clone, Copy)]
enum ForwardingWindow {
    /// No capture has been admitted for this authority lifetime.
    #[default]
    Idle,
    /// Start instant on the native monotonic clock.
    Recording(Instant),
    /// Final elapsed span retained after collector shutdown.
    Stopped(Duration),
}

#[derive(Default)]
struct ForwardingState {
    /// Last admitted browser capture, retained to reject stale commands after stopping.
    generation: u64,
    /// Clock ownership follows the capture state rather than an independent enabled flag.
    window: ForwardingWindow,
    /// Completed event projection/enqueue observations in this generation.
    totals: ForwardingTotals,
}

/// Diagnostic handle shared by host control, authority composition and event forwarding.
#[derive(Clone, Default)]
pub struct ClientPerformance {
    /// Core owns authority observations; host owns serialization and forwarding policy.
    pub authority: RuntimeProfileHandle,
    forwarding: Arc<Mutex<ForwardingState>>,
}

impl ClientPerformance {
    /// All operations are short local snapshots; no authority/world lock or queue is involved.
    pub fn control(
        &self,
        request: ClientPerformanceRequest,
    ) -> anyhow::Result<ClientPerformanceSnapshot> {
        anyhow::ensure!(
            request.generation > 0 && request.generation <= 9_007_199_254_740_991,
            "Performance generation must be a positive safe integer"
        );
        let mut forwarding = self
            .forwarding
            .lock()
            .expect("forwarding profile lock poisoned");
        match request.action {
            PerformanceAction::Start => {
                self.authority.start(request.generation)?;
                *forwarding = ForwardingState {
                    generation: request.generation,
                    window: ForwardingWindow::Recording(Instant::now()),
                    totals: ForwardingTotals::default(),
                };
            }
            PerformanceAction::Snapshot | PerformanceAction::Stop => {
                anyhow::ensure!(
                    request.generation == forwarding.generation,
                    "Performance capture generation does not match"
                );
                if matches!(request.action, PerformanceAction::Stop) {
                    Self::freeze(&mut forwarding);
                    self.authority.stop();
                }
            }
        }
        let authority = self.authority.snapshot();
        Ok(Self::project(&forwarding, authority))
    }

    /// Retirement freezes current completed observations before the authority is dropped.
    pub fn retire(&self) {
        let mut state = self
            .forwarding
            .lock()
            .expect("forwarding profile lock poisoned");
        Self::freeze(&mut state);
        self.authority.stop();
    }

    fn freeze(state: &mut ForwardingState) {
        if let ForwardingWindow::Recording(started) = state.window {
            state.window = ForwardingWindow::Stopped(started.elapsed());
        }
    }

    fn project(
        state: &ForwardingState,
        authority: RuntimeProfileSnapshot,
    ) -> ClientPerformanceSnapshot {
        ClientPerformanceSnapshot {
            generation: state.generation,
            recording: matches!(state.window, ForwardingWindow::Recording(_)),
            elapsed_ms: match state.window {
                ForwardingWindow::Idle => Duration::ZERO,
                ForwardingWindow::Recording(started) => started.elapsed(),
                ForwardingWindow::Stopped(elapsed) => elapsed,
            }
            .as_secs_f64()
                * 1000.0,
            pending_scopes: authority.pending_scopes,
            authority: authority
                .scopes
                .into_iter()
                .map(|(scope, totals)| NativeScopeMean {
                    scope: scope.as_str(),
                    sample_count: totals.sample_count,
                    mean_ms: totals.total.as_secs_f64() * 1000.0 / totals.sample_count as f64,
                })
                .collect(),
            forwarding: ForwardingProfile {
                sample_count: state.totals.sample_count,
                mean_ms: (state.totals.sample_count > 0).then(|| {
                    state.totals.elapsed.as_secs_f64() * 1000.0 / state.totals.sample_count as f64
                }),
            },
        }
    }

    /// Admit one synchronous forwarding observation without allocating when disabled.
    pub fn forwarding_generation(&self) -> Option<u64> {
        if !self.authority.is_recording() {
            return None;
        }
        let state = self
            .forwarding
            .lock()
            .expect("forwarding profile lock poisoned");
        matches!(state.window, ForwardingWindow::Recording(_)).then_some(state.generation)
    }

    /// The forwarder supplies one elapsed span for projection and enqueue.
    pub fn record_forwarding(&self, generation: u64, elapsed: Duration) {
        let mut state = self
            .forwarding
            .lock()
            .expect("forwarding profile lock poisoned");
        if !matches!(state.window, ForwardingWindow::Recording(_)) || state.generation != generation
        {
            return;
        }
        state.totals.sample_count += 1;
        state.totals.elapsed += elapsed;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(action: PerformanceAction, generation: u64) -> ClientPerformanceRequest {
        ClientPerformanceRequest { action, generation }
    }

    #[test]
    fn reset_rejects_stale_commands_and_forwarding_observations() {
        let profile = ClientPerformance::default();
        profile
            .control(request(PerformanceAction::Start, 1))
            .unwrap();
        let old_generation = profile.forwarding_generation().unwrap();
        profile
            .control(request(PerformanceAction::Start, 2))
            .unwrap();
        profile.record_forwarding(old_generation, Duration::from_millis(7));
        profile.record_forwarding(2, Duration::from_millis(3));
        let snapshot = profile
            .control(request(PerformanceAction::Stop, 2))
            .unwrap();
        assert!(!snapshot.recording);
        assert_eq!(snapshot.forwarding.sample_count, 1);
        assert_eq!(snapshot.forwarding.mean_ms, Some(3.0));
        assert!(
            profile
                .control(request(PerformanceAction::Stop, 1))
                .is_err()
        );
        assert!(
            profile
                .control(request(PerformanceAction::Start, 1))
                .is_err()
        );
        assert!(profile.forwarding_generation().is_none());
    }
}
