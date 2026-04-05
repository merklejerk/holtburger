use holtburger_core::client::types::CombatFeedback;
use holtburger_protocol::errors::WeenieError;
use holtburger_protocol::messages::combat::CombatMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CombatRuntimeState {
    pub attack_queued: bool,
    pub attack_sequence_active: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttackActivity {
    Ready,
    Active,
}

impl CombatRuntimeState {
    pub fn handle_mode_updated(&mut self, mode: CombatMode) {
        if matches!(
            mode,
            CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic
        ) {
            self.attack_queued = false;
            self.attack_sequence_active = false;
        }
    }

    pub fn queue_attack(&mut self) {
        self.attack_queued = true;
    }

    pub fn cancel_attack(&mut self) {
        self.attack_queued = false;
        self.attack_sequence_active = false;
    }

    pub fn handle_feedback(&mut self, feedback: &CombatFeedback) {
        match feedback {
            CombatFeedback::AttackCommenced => {
                self.attack_queued = false;
                self.attack_sequence_active = true;
            }
            CombatFeedback::AttackDone {
                error: WeenieError::None,
            } => {
                self.attack_queued = true;
                self.attack_sequence_active = false;
            }
            CombatFeedback::AttackDone { .. }
            | CombatFeedback::VictimNotification { .. }
            | CombatFeedback::KillerNotification { .. } => {
                self.attack_queued = false;
                self.attack_sequence_active = false;
            }
            // PlayerKilled notifies when any nearby player is killed, so it may
            // not affect our own attack state.
            CombatFeedback::PlayerKilled { .. } => {}
            CombatFeedback::AttackerNotification { .. }
            | CombatFeedback::DefenderNotification { .. }
            | CombatFeedback::EvasionAttackerNotification { .. }
            | CombatFeedback::EvasionDefenderNotification { .. } => {}
        }
    }

    pub fn attack_activity(self, mode: CombatMode) -> Option<AttackActivity> {
        match mode {
            CombatMode::Melee | CombatMode::Missile => {
                if self.attack_sequence_active {
                    Some(AttackActivity::Active)
                } else if self.attack_queued {
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
        CombatMode::NonCombat => "🕊️ PEACE",
        CombatMode::Melee => "🔪 MELEE",
        CombatMode::Missile => "🏹 MISSILE",
        CombatMode::Magic => "✨ MAGIC",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attack_feedback_transitions_auto_attack_state() {
        let mut state = CombatRuntimeState::default();

        state.queue_attack();

        assert_eq!(
            state.attack_activity(CombatMode::Melee),
            Some(AttackActivity::Ready)
        );

        state.handle_feedback(&CombatFeedback::AttackCommenced);
        assert_eq!(
            state.attack_activity(CombatMode::Melee),
            Some(AttackActivity::Active)
        );

        state.handle_feedback(&CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::None,
        });
        assert_eq!(
            state.attack_activity(CombatMode::Melee),
            Some(AttackActivity::Ready)
        );
    }

    #[test]
    fn noncombat_mode_has_no_attack_activity() {
        let mut state = CombatRuntimeState {
            attack_queued: true,
            attack_sequence_active: true,
        };

        state.handle_mode_updated(CombatMode::NonCombat);

        assert_eq!(state.attack_activity(CombatMode::NonCombat), None);
    }

    #[test]
    fn magic_mode_has_no_attack_activity() {
        let state = CombatRuntimeState::default();

        assert_eq!(state.attack_activity(CombatMode::Magic), None);
    }

    #[test]
    fn combat_mode_without_queued_attack_has_no_attack_activity() {
        let state = CombatRuntimeState::default();

        assert_eq!(state.attack_activity(CombatMode::Melee), None);
        assert_eq!(state.attack_activity(CombatMode::Missile), None);
    }

    #[test]
    fn cancel_attack_clears_attack_activity() {
        let mut state = CombatRuntimeState {
            attack_queued: true,
            attack_sequence_active: true,
        };

        state.cancel_attack();

        assert_eq!(state.attack_activity(CombatMode::Melee), None);
    }

    #[test]
    fn queued_attack_shows_ready_state_without_becoming_active() {
        let mut state = CombatRuntimeState::default();

        state.queue_attack();

        assert_eq!(
            state.attack_activity(CombatMode::Missile),
            Some(AttackActivity::Ready)
        );
    }

    #[test]
    fn action_cancelled_attack_done_clears_attack_activity() {
        let mut state = CombatRuntimeState {
            attack_queued: false,
            attack_sequence_active: true,
        };

        state.handle_feedback(&CombatFeedback::AttackDone {
            error: WeenieError::ActionCancelled,
        });

        assert_eq!(state.attack_activity(CombatMode::Melee), None);
    }
}
