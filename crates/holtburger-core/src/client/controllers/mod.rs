mod approach_target;

pub(crate) use approach_target::{
    ApproachTargetController, ApproachTargetEffect, ApproachTargetFinishReason,
    ApproachTargetInput,
};

/// Provisional shared controller kernel for reusable client-side behaviors.
///
/// This module intentionally standardizes only the broad lifecycle shape.
/// Concrete controllers are expected to define their own input and effect
/// vocabularies, and this kernel will be refined after more real controllers
/// exist in the codebase.
pub trait Controller {
    type Input;
    type Effect;

    fn handle(&mut self, input: &Self::Input) -> ControllerUpdate<Self::Effect>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControllerStatus {
    Idle,
    Active,
    Blocked,
    Paused,
    CoolingDown,
    Completed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ControllerUpdate<E> {
    pub status: ControllerStatus,
    pub effects: Vec<E>,
}

impl<E> ControllerUpdate<E> {
    pub fn new(status: ControllerStatus) -> Self {
        Self {
            status,
            effects: Vec::new(),
        }
    }

    pub fn with_effect(mut self, effect: E) -> Self {
        self.effects.push(effect);
        self
    }

    pub fn push_effect(&mut self, effect: E) {
        self.effects.push(effect);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, Copy)]
    enum ThresholdInput {
        Sample { value: f32, threshold: f32 },
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum ThresholdEffect {
        EnteredThreshold,
        ExitedThreshold,
        Started,
        LostThreshold,
    }

    #[derive(Debug, Default, Clone, Copy)]
    struct ThresholdController {
        was_within: bool,
    }

    impl Controller for ThresholdController {
        type Input = ThresholdInput;
        type Effect = ThresholdEffect;

        fn handle(&mut self, input: &Self::Input) -> ControllerUpdate<Self::Effect> {
            let ThresholdInput::Sample { value, threshold } = *input;
            let is_within = value <= threshold;
            let mut result = ControllerUpdate::new(if is_within {
                ControllerStatus::Active
            } else {
                ControllerStatus::Idle
            });

            if !self.was_within && is_within {
                result.push_effect(ThresholdEffect::Started);
                result.push_effect(ThresholdEffect::EnteredThreshold);
            } else if self.was_within && !is_within {
                result.push_effect(ThresholdEffect::LostThreshold);
                result.push_effect(ThresholdEffect::ExitedThreshold);
            }

            self.was_within = is_within;
            result
        }
    }

    #[test]
    fn controller_update_collects_effects() {
        let result = ControllerUpdate::new(ControllerStatus::Active)
            .with_effect(ThresholdEffect::EnteredThreshold);

        assert_eq!(result.status, ControllerStatus::Active);
        assert_eq!(result.effects, vec![ThresholdEffect::EnteredThreshold]);
    }

    #[test]
    fn threshold_controller_can_emit_lifecycle_and_domain_effects() {
        let mut controller = ThresholdController::default();

        let idle = controller.handle(&ThresholdInput::Sample {
            value: 10.0,
            threshold: 5.0,
        });

        assert_eq!(idle.status, ControllerStatus::Idle);
        assert!(idle.effects.is_empty());

        let entered = controller.handle(&ThresholdInput::Sample {
            value: 4.0,
            threshold: 5.0,
        });

        assert_eq!(entered.status, ControllerStatus::Active);
        assert_eq!(
            entered.effects,
            vec![
                ThresholdEffect::Started,
                ThresholdEffect::EnteredThreshold,
            ]
        );
    }

    #[test]
    fn threshold_controller_can_emit_custom_effect_vocabulary() {
        let mut controller = ThresholdController { was_within: true };

        let exited = controller.handle(&ThresholdInput::Sample {
            value: 6.0,
            threshold: 5.0,
        });

        assert_eq!(exited.status, ControllerStatus::Idle);
        assert_eq!(
            exited.effects,
            vec![
                ThresholdEffect::LostThreshold,
                ThresholdEffect::ExitedThreshold,
            ]
        );
    }
}