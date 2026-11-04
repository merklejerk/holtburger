//! One host-owned fixed cadence shared by locally simulated systems.

use anyhow::Error;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Current host simulation cadence. Presentation interpolates between these fixed epochs.
pub const HOST_FIXED_TICK_HZ: f64 = 30.0;

/// Whether a participant remains registered after its latest fixed tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostFixedTickDisposition {
    Continue,
    Finished,
}

/// One stateful host system advanced by the shared fixed cadence.
pub trait HostFixedTickParticipant: Send + Sync {
    /// Advances exactly one fixed epoch.
    fn fixed_tick(&self, delta: Duration) -> anyhow::Result<HostFixedTickDisposition>;

    /// Handles a terminal participant failure after the scheduler removes its registration.
    fn fixed_tick_failed(&self, error: &Error);
}

/// Stable scheduler slot reserved by one owning subsystem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct HostFixedTickSlot(u64);

/// Exact installation generation used to remove a participant without racing its replacement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HostFixedTickRegistration {
    slot: HostFixedTickSlot,
    generation: u64,
}

struct InstalledParticipant {
    generation: u64,
    participant: Arc<dyn HostFixedTickParticipant>,
}

/// Registry and single fixed-step clock for host-local simulation participants.
pub struct HostFixedTickRuntime {
    next_slot: AtomicU64,
    next_generation: AtomicU64,
    stopped: std::sync::atomic::AtomicBool,
    participants: Mutex<BTreeMap<HostFixedTickSlot, InstalledParticipant>>,
}

impl Default for HostFixedTickRuntime {
    fn default() -> Self {
        Self {
            next_slot: AtomicU64::new(1),
            next_generation: AtomicU64::new(1),
            stopped: std::sync::atomic::AtomicBool::new(false),
            participants: Mutex::new(BTreeMap::new()),
        }
    }
}

impl HostFixedTickRuntime {
    pub fn new() -> Self {
        Self::default()
    }

    /// Reserves one stable ordering position for a subsystem's replaceable participant.
    pub fn reserve_slot(&self) -> HostFixedTickSlot {
        HostFixedTickSlot(self.next_slot.fetch_add(1, Ordering::Relaxed))
    }

    /// Installs or replaces one participant in its stable scheduler slot.
    pub fn install(
        &self,
        slot: HostFixedTickSlot,
        participant: Arc<dyn HostFixedTickParticipant>,
    ) -> HostFixedTickRegistration {
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        self.participants
            .lock()
            .expect("fixed-tick participant lock poisoned")
            .insert(
                slot,
                InstalledParticipant {
                    generation,
                    participant,
                },
            );
        HostFixedTickRegistration { slot, generation }
    }

    /// Removes exactly one installed generation; a replacement in the same slot survives.
    pub fn remove(&self, registration: HostFixedTickRegistration) -> bool {
        let mut participants = self
            .participants
            .lock()
            .expect("fixed-tick participant lock poisoned");
        let current = participants
            .get(&registration.slot)
            .is_some_and(|entry| entry.generation == registration.generation);
        if current {
            participants.remove(&registration.slot);
        }
        current
    }

    /// Starts the sole host fixed-step task. Call exactly once during application setup.
    pub fn spawn(self: &Arc<Self>) {
        let runtime = Arc::clone(self);
        tokio::spawn(async move {
            let period = Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ);
            let mut interval = tokio::time::interval(period);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            while !runtime.stopped.load(Ordering::Acquire) {
                interval.tick().await;
                if runtime.stopped.load(Ordering::Acquire) {
                    break;
                }
                runtime.tick_participants(period);
            }
        });
    }

    /// Stops the background clock after its current tick, allowing shell shutdown to drain.
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
    }

    fn tick_participants(&self, delta: Duration) {
        let participants = self
            .participants
            .lock()
            .expect("fixed-tick participant lock poisoned")
            .iter()
            .map(|(slot, entry)| {
                (
                    HostFixedTickRegistration {
                        slot: *slot,
                        generation: entry.generation,
                    },
                    Arc::clone(&entry.participant),
                )
            })
            .collect::<Vec<_>>();

        for (registration, participant) in participants {
            match participant.fixed_tick(delta) {
                Ok(HostFixedTickDisposition::Continue) => {}
                Ok(HostFixedTickDisposition::Finished) => {
                    self.remove(registration);
                }
                Err(error) => {
                    if self.remove(registration) {
                        participant.fixed_tick_failed(&error);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct CountingParticipant {
        ticks: AtomicUsize,
        finish_after: usize,
    }

    impl HostFixedTickParticipant for CountingParticipant {
        fn fixed_tick(&self, _delta: Duration) -> anyhow::Result<HostFixedTickDisposition> {
            let ticks = self.ticks.fetch_add(1, Ordering::Relaxed) + 1;
            Ok(if ticks >= self.finish_after {
                HostFixedTickDisposition::Finished
            } else {
                HostFixedTickDisposition::Continue
            })
        }

        fn fixed_tick_failed(&self, _error: &Error) {
            panic!("counting participant did not fail")
        }
    }

    #[test]
    fn replacement_survives_removal_of_an_older_slot_generation() {
        let runtime = HostFixedTickRuntime::new();
        let slot = runtime.reserve_slot();
        let old = runtime.install(
            slot,
            Arc::new(CountingParticipant {
                ticks: AtomicUsize::new(0),
                finish_after: 1,
            }),
        );
        let replacement = Arc::new(CountingParticipant {
            ticks: AtomicUsize::new(0),
            finish_after: 2,
        });
        runtime.install(slot, replacement.clone());

        assert!(!runtime.remove(old));
        runtime.tick_participants(Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ));
        assert_eq!(replacement.ticks.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn finished_participant_is_removed_after_its_tick() {
        let runtime = HostFixedTickRuntime::new();
        let slot = runtime.reserve_slot();
        let participant = Arc::new(CountingParticipant {
            ticks: AtomicUsize::new(0),
            finish_after: 1,
        });
        runtime.install(slot, participant.clone());

        runtime.tick_participants(Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ));
        runtime.tick_participants(Duration::from_secs_f64(1.0 / HOST_FIXED_TICK_HZ));

        assert_eq!(participant.ticks.load(Ordering::Relaxed), 1);
    }
}
