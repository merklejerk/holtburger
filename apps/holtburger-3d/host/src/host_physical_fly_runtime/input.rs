use holtburger_common::Vector3;

use super::{PhysicalFlyIntent, PhysicalFlySpeedEnvelope};

/// Physical-fly input and acceleration retained for one ownership epoch.
#[derive(Debug, Clone, Copy)]
pub(super) struct PhysicalFlyInputAccumulator {
    /// Latest concrete fly intent accepted from the frontend.
    pub(super) intent: PhysicalFlyIntent,
    /// Latest applied intent sequence.
    pub(super) last_intent_sequence: Option<u64>,
    /// Translation response selected by the registering application.
    pub(super) speed_envelope: PhysicalFlySpeedEnvelope,
    /// Elapsed uninterrupted nonzero movement input, saturated at the ramp duration.
    pub(super) movement_elapsed_seconds: f32,
    /// Latest frontend movement generation applied to this controller.
    pub(super) movement_epoch: u64,
    /// Maximum displacement that the registered free-sphere response can subdivide in one tick.
    pub(super) maximum_displacement_per_tick: f32,
    /// Portion of cumulative wheel displacement already submitted to simulation.
    pub(super) applied_world_displacement_total: Vector3,
}

impl PhysicalFlyInputAccumulator {
    pub(super) fn requested_velocity_for_tick(
        &mut self,
        target_velocity: Vector3,
        delta_seconds: f32,
    ) -> Vector3 {
        if target_velocity.length_squared() <= f32::EPSILON {
            self.movement_elapsed_seconds = 0.0;
            return Vector3::zero();
        }
        let PhysicalFlySpeedEnvelope::LinearRamp {
            acceleration_seconds,
            initial_speed_multiplier,
        } = self.speed_envelope
        else {
            return target_velocity;
        };
        let start = self.movement_elapsed_seconds;
        let end = start + delta_seconds;
        self.movement_elapsed_seconds = end.min(acceleration_seconds);
        let average_progress = (linear_ramp_area(end, acceleration_seconds)
            - linear_ramp_area(start, acceleration_seconds))
            / delta_seconds;
        let multiplier =
            initial_speed_multiplier + (1.0 - initial_speed_multiplier) * average_progress;
        target_velocity * multiplier
    }
}

/// Drains one-shot displacement without exceeding the registered subdivision envelope.
pub(super) fn bounded_pending_displacement(pending: Vector3, available_distance: f32) -> Vector3 {
    if pending.length() <= available_distance {
        pending
    } else if available_distance > 0.0 {
        pending.normalize() * available_distance
    } else {
        Vector3::zero()
    }
}

/// Integral of `min(elapsed / duration, 1)` from zero through `elapsed`.
fn linear_ramp_area(elapsed: f32, duration: f32) -> f32 {
    if elapsed <= duration {
        elapsed * elapsed / (2.0 * duration)
    } else {
        elapsed - duration / 2.0
    }
}
