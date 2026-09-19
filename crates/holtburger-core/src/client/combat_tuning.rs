//! Validated policy values for shared targeted-combat behavior.

use thiserror::Error;

/// Default separation at which melee pursuit abandons its target.
///
/// ACE creatures use the same 96-meter bound before selecting another target.
pub const DEFAULT_MELEE_MAX_CHASE_DISTANCE: f32 = 96.0;

/// Shared combat policy supplied when constructing a client runtime.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClientCombatTuning {
    melee_max_chase_distance: f32,
}

impl ClientCombatTuning {
    /// Creates combat tuning with a finite, positive melee pursuit leash.
    pub fn new(melee_max_chase_distance: f32) -> Result<Self, ClientCombatTuningError> {
        if !melee_max_chase_distance.is_finite() || melee_max_chase_distance <= 0.0 {
            return Err(ClientCombatTuningError::InvalidMeleeMaxChaseDistance);
        }
        Ok(Self {
            melee_max_chase_distance,
        })
    }

    /// Current physical separation at which melee engagement is cancelled.
    pub const fn melee_max_chase_distance(self) -> f32 {
        self.melee_max_chase_distance
    }
}

impl Default for ClientCombatTuning {
    fn default() -> Self {
        Self {
            melee_max_chase_distance: DEFAULT_MELEE_MAX_CHASE_DISTANCE,
        }
    }
}

/// Invalid shared combat tuning supplied by a runtime composition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum ClientCombatTuningError {
    #[error("melee maximum chase distance must be finite and positive")]
    InvalidMeleeMaxChaseDistance,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn melee_chase_distance_requires_a_finite_positive_value() {
        for invalid in [f32::NEG_INFINITY, -1.0, 0.0, f32::INFINITY, f32::NAN] {
            assert_eq!(
                ClientCombatTuning::new(invalid),
                Err(ClientCombatTuningError::InvalidMeleeMaxChaseDistance)
            );
        }
        assert_eq!(
            ClientCombatTuning::new(24.0)
                .unwrap()
                .melee_max_chase_distance(),
            24.0
        );
    }
}
