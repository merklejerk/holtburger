//! Optional per-thread work counters for focused synthetic physics benchmarks.

/// Prepared inputs and actual geometric work, including provisional and rejected paths.
#[cfg(feature = "physics-profiling")]
#[derive(Debug, Clone, Copy, Default)]
pub struct PhysicsWork {
    /// Physical contact preparations, including fixed peers prepared for mobile sweeps.
    pub body_preparations: u64,
    /// Free/grounded environment steps, including optional stair candidates.
    pub environment_steps: u64,
    /// Entity narrow-phase shape queries, including observational report tests.
    pub shape_queries: u64,
}

#[cfg(feature = "physics-profiling")]
thread_local! {
    static WORK: std::cell::Cell<PhysicsWork> = const {
        std::cell::Cell::new(PhysicsWork { body_preparations: 0, environment_steps: 0, shape_queries: 0 })
    };
}

/// Returns and clears this thread's measured work since the previous read.
#[cfg(feature = "physics-profiling")]
pub fn take_physics_work() -> PhysicsWork {
    WORK.with(|work| work.replace(PhysicsWork::default()))
}

#[inline]
pub(super) fn record_body_preparation() {
    #[cfg(feature = "physics-profiling")]
    WORK.with(|work| {
        let mut value = work.get();
        value.body_preparations += 1;
        work.set(value);
    });
}

#[inline]
pub(super) fn record_environment_step() {
    #[cfg(feature = "physics-profiling")]
    WORK.with(|work| {
        let mut value = work.get();
        value.environment_steps += 1;
        work.set(value);
    });
}

#[inline]
pub(super) fn record_shape_query() {
    #[cfg(feature = "physics-profiling")]
    WORK.with(|work| {
        let mut value = work.get();
        value.shape_queries += 1;
        work.set(value);
    });
}
