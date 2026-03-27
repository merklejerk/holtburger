pub mod approach_target;
pub mod combat;
pub mod maintain_range;

pub use approach_target::{
    ApproachTargetController, ApproachTargetEffect, ApproachTargetIntent,
    ApproachTargetFinishReason, ApproachTargetInput,
};
pub use combat::{
    CombatAutomationController, CombatAutomationEffect, CombatAutomationInput,
    CombatFacingController, CombatFacingEffect, CombatFacingInput, DesiredAttackController,
    DesiredAttackEffect, DesiredAttackInput, DesiredAttackProfile, TargetedAttackRequest,
};
pub use maintain_range::{
    MaintainRangeConfig, MaintainRangeController, MaintainRangeEffect, MaintainRangeFinishReason,
    MaintainRangeInput,
};

/// Shared controller kernel for reusable client-side behaviors.
///
/// After landing real movement and combat controllers, the proven common kernel
/// is intentionally small:
/// - a controller trait shape
/// - coarse lifecycle status
/// - a structured update carrying status plus controller-defined effects
///
/// Concrete controllers still define their own input and effect vocabularies.
/// Scheduler, claims, and other orchestrator-facing concepts remain outside the
/// kernel until real composition needs justify them.
pub trait Controller {
    type Input;
    type Effect;

    fn handle(&mut self, input: &Self::Input) -> ControllerUpdate<Self::Effect>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControllerStatus {
    /// The controller has no work to do for this input and is not blocked.
    Idle,
    /// The controller is actively driving behavior or wants to keep ownership.
    Active,
    /// The controller cannot proceed because prerequisites are currently unmet.
    Blocked,
    /// The controller is intentionally quiescent but may resume later.
    Paused,
    /// The controller is waiting for a bounded retry or refresh interval.
    CoolingDown,
    /// The controller reached a terminal state for its current goal.
    Completed,
}

impl ControllerStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed)
    }
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

    pub fn with_effects<I>(mut self, effects: I) -> Self
    where
        I: IntoIterator<Item = E>,
    {
        self.effects.extend(effects);
        self
    }

    pub fn push_effect(&mut self, effect: E) {
        self.effects.push(effect);
    }

    pub fn is_terminal(&self) -> bool {
        self.status.is_terminal()
    }

    pub fn map_effects<U, F>(self, mut map: F) -> ControllerUpdate<U>
    where
        F: FnMut(E) -> U,
    {
        ControllerUpdate {
            status: self.status,
            effects: self.effects.into_iter().map(&mut map).collect(),
        }
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
    fn controller_status_reports_terminal_state() {
        assert!(ControllerStatus::Completed.is_terminal());
        assert!(!ControllerStatus::Paused.is_terminal());
    }

    #[test]
    fn controller_update_can_map_effect_vocabulary() {
        let result = ControllerUpdate::new(ControllerStatus::Active)
            .with_effects([ThresholdEffect::Started, ThresholdEffect::EnteredThreshold])
            .map_effects(|effect| match effect {
                ThresholdEffect::Started => "started",
                ThresholdEffect::EnteredThreshold => "entered",
                ThresholdEffect::ExitedThreshold => "exited",
                ThresholdEffect::LostThreshold => "lost",
            });

        assert_eq!(result.status, ControllerStatus::Active);
        assert_eq!(result.effects, vec!["started", "entered"]);
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
            vec![ThresholdEffect::Started, ThresholdEffect::EnteredThreshold,]
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
