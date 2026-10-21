//! Opt-in contact attribution; no timing state enters the world or simulation products.

use holtburger_common::time::phase_profile::PhaseProfile;
use std::fmt;

/// Enable with `RUST_LOG=warn,holtburger_world::spatial::contact_profile=debug`.
pub(super) struct ContactPhaseProfile {
    /// Scene collection, integration, or reporting boundary named by its owner.
    scope: &'static str,
    /// Disabled probes allocate nothing and never read the clock.
    phases: PhaseProfile,
}

impl ContactPhaseProfile {
    pub(super) fn begin(scope: &'static str) -> Self {
        Self {
            scope,
            phases: PhaseProfile::begin(log::log_enabled!(log::Level::Debug)),
        }
    }

    /// End a non-overlapping phase at the owning subsystem's existing boundary.
    pub(super) fn checkpoint(&mut self, phase: &'static str) {
        self.phases.checkpoint(phase);
    }

    /// Write one record after the last phase; logging is outside its measured total.
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
