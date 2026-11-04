//! Opt-in wall-clock attribution for the client authority loop, independent of presentation FPS.

use holtburger_common::time::phase_profile::PhaseProfile;
use std::fmt;

/// Enable with `RUST_LOG=warn,holtburger_core::client::runtime_profile=debug`.
pub(super) struct RuntimePhaseProfile {
    /// Authority-loop or simulation boundary named by the caller.
    scope: &'static str,
    /// Logging-free clocks shared with the world's contact diagnostics.
    phases: PhaseProfile,
}

impl RuntimePhaseProfile {
    pub(super) fn begin(scope: &'static str) -> Self {
        Self {
            scope,
            phases: PhaseProfile::begin(log::log_enabled!(log::Level::Debug)),
        }
    }

    /// Charge everything since the preceding boundary to this phase, including awaited work.
    pub(super) fn checkpoint(&mut self, phase: &'static str) {
        self.phases.checkpoint(phase);
    }

    /// Emit one diagnostic record after the final measured phase.
    pub(super) fn finish(self, context: fmt::Arguments<'_>) {
        self.phases.finish(|total, phases| {
            log::debug!(
                "scope={} total_ms={:.3} {}{}",
                self.scope,
                total.as_secs_f64() * 1_000.0,
                context,
                phases,
            );
        });
    }
}
