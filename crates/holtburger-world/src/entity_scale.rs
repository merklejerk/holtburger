//! World-owned whole-object scale state for dynamic entities.

/// Retail schedules an interpolated hook only above this duration.
const MINIMUM_SCALE_RAMP_SECONDS: f64 = 0.0002;

/// Invalid whole-object scale input rejected before world or collision state changes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum EntityScaleError {
    #[error("whole-object scale must be finite and positive")]
    InvalidScale,
    #[error("whole-object scale duration must be finite and authority time finite and nonnegative")]
    InvalidTime,
    #[error("whole-object scale authority time moved backwards")]
    ClockMovedBackwards,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct EntityScaleRamp {
    start: f32,
    end: f32,
    started_at_seconds: f64,
    duration_seconds: f64,
}

/// Current absolute object scale plus at most one active retail-linear ramp.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EntityScaleState {
    effective: f32,
    ramp: Option<EntityScaleRamp>,
    advanced_to_seconds: f64,
}

/// Result of one world scale mutation, including whether it needs another clock sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityScaleUpdate {
    /// Whether geometry and presentation must consume a new scalar now.
    pub effective_changed: bool,
    /// Whether this entity needs another authority-clock sample.
    pub ramp_active: bool,
}

impl Default for EntityScaleState {
    fn default() -> Self {
        Self {
            effective: 1.0,
            ramp: None,
            advanced_to_seconds: 0.0,
        }
    }
}

impl EntityScaleState {
    pub fn new(scale: f32) -> Result<Self, EntityScaleError> {
        validate_scale(scale)?;
        Ok(Self {
            effective: scale,
            ..Self::default()
        })
    }

    /// Current scalar consumed by presentation, geometry placement, and authored motion.
    pub const fn effective(self) -> f32 {
        self.effective
    }

    /// Whether the authority clock must sample this state again.
    pub(crate) const fn is_ramping(self) -> bool {
        self.ramp.is_some()
    }

    /// Replaces server authority and retires any predicted script ramp.
    pub fn reconcile(&mut self, scale: f32) -> Result<bool, EntityScaleError> {
        validate_scale(scale)?;
        let changed = self.effective.to_bits() != scale.to_bits() || self.ramp.is_some();
        self.effective = scale;
        self.ramp = None;
        Ok(changed)
    }

    /// Applies an absolute script target, sampling an existing ramp before retargeting it.
    pub fn apply_script_target(
        &mut self,
        end: f32,
        duration_seconds: f32,
        now_seconds: f64,
    ) -> Result<bool, EntityScaleError> {
        validate_scale(end)?;
        if !duration_seconds.is_finite() || !now_seconds.is_finite() || now_seconds < 0.0 {
            return Err(EntityScaleError::InvalidTime);
        }
        self.advance(now_seconds)?;
        if f64::from(duration_seconds) < MINIMUM_SCALE_RAMP_SECONDS {
            let changed = self.effective.to_bits() != end.to_bits() || self.ramp.is_some();
            self.effective = end;
            self.ramp = None;
            return Ok(changed);
        }
        self.ramp = Some(EntityScaleRamp {
            start: self.effective,
            end,
            started_at_seconds: now_seconds,
            duration_seconds: f64::from(duration_seconds),
        });
        Ok(true)
    }

    /// Samples the current ramp at one monotonically increasing authority-clock edge.
    pub fn advance(&mut self, now_seconds: f64) -> Result<bool, EntityScaleError> {
        if !now_seconds.is_finite() || now_seconds < 0.0 {
            return Err(EntityScaleError::InvalidTime);
        }
        if now_seconds < self.advanced_to_seconds {
            return Err(EntityScaleError::ClockMovedBackwards);
        }
        self.advanced_to_seconds = now_seconds;
        let Some(ramp) = self.ramp else {
            return Ok(false);
        };
        let elapsed = (now_seconds - ramp.started_at_seconds).max(0.0);
        let progress = (elapsed / ramp.duration_seconds).clamp(0.0, 1.0) as f32;
        let next = ramp.start + (ramp.end - ramp.start) * progress;
        let changed = next.to_bits() != self.effective.to_bits();
        self.effective = next;
        if progress >= 1.0 {
            self.effective = ramp.end;
            self.ramp = None;
        }
        Ok(changed)
    }
}

fn validate_scale(scale: f32) -> Result<(), EntityScaleError> {
    if !scale.is_finite() || scale <= 0.0 {
        return Err(EntityScaleError::InvalidScale);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn immediate_timed_and_mid_ramp_targets_are_absolute() {
        let mut scale = EntityScaleState::new(2.0).unwrap();
        scale.apply_script_target(3.0, 0.0, 1.0).unwrap();
        assert_eq!(scale.effective(), 3.0);

        scale.apply_script_target(5.0, 4.0, 2.0).unwrap();
        scale.advance(4.0).unwrap();
        assert_eq!(scale.effective(), 4.0);

        scale.apply_script_target(2.0, 2.0, 4.0).unwrap();
        scale.advance(5.0).unwrap();
        assert_eq!(scale.effective(), 3.0);
        scale.advance(6.0).unwrap();
        assert_eq!(scale.effective(), 2.0);
    }

    #[test]
    fn invalid_targets_cannot_poison_current_state() {
        let mut scale = EntityScaleState::new(2.0).unwrap();
        for invalid in [0.0, -1.0, f32::NAN, f32::INFINITY] {
            assert_eq!(
                scale.apply_script_target(invalid, 0.0, 0.0),
                Err(EntityScaleError::InvalidScale)
            );
            assert_eq!(scale.effective(), 2.0);
        }
    }

    #[test]
    fn negative_duration_uses_retails_immediate_scale_branch() {
        let mut scale = EntityScaleState::new(2.0).unwrap();

        assert!(scale.apply_script_target(3.0, -1.0, 1.0).unwrap());
        assert_eq!(scale.effective(), 3.0);
        assert!(!scale.is_ramping());
    }
}
