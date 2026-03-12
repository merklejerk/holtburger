use holtburger_core::client::types::CombatFeedback;
use holtburger_protocol::messages::combat::CombatMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CombatRuntimeState {
    pub attack_sequence_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttackActivity {
    Ready,
    Active,
}

impl CombatRuntimeState {
    pub fn handle_mode_updated(&mut self, mode: CombatMode) {
        if mode == CombatMode::NonCombat {
            self.attack_sequence_active = false;
        }
    }

    pub fn cancel_attack(&mut self) {
        self.attack_sequence_active = false;
    }

    pub fn handle_feedback(&mut self, feedback: &CombatFeedback) {
        match feedback {
            CombatFeedback::AttackCommenced => {
                self.attack_sequence_active = true;
            }
            CombatFeedback::AttackDone { .. }
            | CombatFeedback::VictimNotification { .. }
            | CombatFeedback::KillerNotification { .. } => {
                self.attack_sequence_active = false;
            }
            CombatFeedback::AttackerNotification { .. }
            | CombatFeedback::DefenderNotification { .. }
            | CombatFeedback::EvasionAttackerNotification { .. }
            | CombatFeedback::EvasionDefenderNotification { .. } => {}
        }
    }

    pub fn attack_activity(self, mode: CombatMode, has_target: bool) -> Option<AttackActivity> {
        match mode {
            CombatMode::Melee | CombatMode::Missile => {
                if self.attack_sequence_active {
                    Some(AttackActivity::Active)
                } else if has_target {
                    Some(AttackActivity::Ready)
                } else {
                    None
                }
            }
            CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
        }
    }
}

pub fn combat_mode_label(mode: CombatMode) -> &'static str {
    match mode {
        CombatMode::Undef => "PEACE",
        CombatMode::NonCombat => "PEACE",
        CombatMode::Melee => "MELEE",
        CombatMode::Missile => "MISSILE",
        CombatMode::Magic => "MAGIC",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attack_feedback_transitions_auto_attack_state() {
        let mut state = CombatRuntimeState::default();

        assert_eq!(
            state.attack_activity(CombatMode::Melee, true),
            Some(AttackActivity::Ready)
        );

        state.handle_feedback(&CombatFeedback::AttackCommenced);
        assert_eq!(
            state.attack_activity(CombatMode::Melee, true),
            Some(AttackActivity::Active)
        );

        state.handle_feedback(&CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::None,
        });
        assert_eq!(
            state.attack_activity(CombatMode::Melee, true),
            Some(AttackActivity::Ready)
        );
    }

    #[test]
    fn noncombat_mode_has_no_attack_activity() {
        let mut state = CombatRuntimeState {
            attack_sequence_active: true,
        };

        state.handle_mode_updated(CombatMode::NonCombat);

        assert_eq!(state.attack_activity(CombatMode::NonCombat, true), None);
    }

    #[test]
    fn magic_mode_has_no_attack_activity() {
        let state = CombatRuntimeState::default();

        assert_eq!(state.attack_activity(CombatMode::Magic, true), None);
    }

    #[test]
    fn combat_mode_without_target_has_no_attack_activity() {
        let state = CombatRuntimeState::default();

        assert_eq!(state.attack_activity(CombatMode::Melee, false), None);
        assert_eq!(state.attack_activity(CombatMode::Missile, false), None);
    }

    #[test]
    fn cancel_attack_clears_attack_activity() {
        let mut state = CombatRuntimeState {
            attack_sequence_active: true,
        };

        state.cancel_attack();

        assert_eq!(state.attack_activity(CombatMode::Melee, true), Some(AttackActivity::Ready));
    }
}