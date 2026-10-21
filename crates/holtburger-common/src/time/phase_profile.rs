//! Optional sequential wall-clock attribution without a logging or gameplay dependency.

use std::fmt::Write;
use std::time::{Duration, Instant};

/// A disabled probe allocates nothing and never reads the clock.
pub struct PhaseProfile(Option<ActiveProfile>);

/// Clock state exists only while a caller has explicitly enabled attribution.
struct ActiveProfile {
    /// Whole-scope origin for total wall-clock duration.
    started: Instant,
    /// End of the last charged phase.
    boundary: Instant,
    /// Sequential durations formatted for the diagnostic consumer.
    phases: String,
}

impl PhaseProfile {
    /// Begin attribution only when the owning diagnostic consumer is enabled.
    pub fn begin(enabled: bool) -> Self {
        Self(enabled.then(|| {
            let started = Instant::now();
            ActiveProfile {
                started,
                boundary: started,
                phases: String::new(),
            }
        }))
    }

    /// Charge all time since the preceding boundary, including waits, to this phase.
    pub fn checkpoint(&mut self, phase: &'static str) {
        let Some(active) = self.0.as_mut() else {
            return;
        };
        let now = Instant::now();
        write!(
            active.phases,
            " {phase}_ms={:.3}",
            now.duration_since(active.boundary).as_secs_f64() * 1_000.0
        )
        .expect("formatting phase timings into a String cannot fail");
        active.boundary = now;
    }

    /// Report the completed scope only when enabled; reporting is outside the measured total.
    pub fn finish(mut self, report: impl FnOnce(Duration, &str)) {
        self.checkpoint("finalization");
        if let Some(active) = self.0 {
            report(
                active.boundary.duration_since(active.started),
                &active.phases,
            );
        }
    }
}
