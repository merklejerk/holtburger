//! Pure lifecycle owner for one desired targeted-attack engagement.

use super::types::{
    ClientAttackProfile, ClientCombatControlState, ClientCombatEngagement,
    ClientCombatRefillEstimate, ClientCombatStatus,
};
use holtburger_common::Guid;
use holtburger_protocol::errors::WeenieError;
use std::time::{Duration, Instant};

const STANDARD_REFILL_DURATION: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum CombatControlEffect {
    Attack(ClientCombatEngagement),
    Cancel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RestartGate {
    Immediate,
    ReadinessTransition,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum CombatPhase {
    Idle,
    Charging {
        ready_at: Instant,
    },
    Waiting {
        gate: RestartGate,
        observed_not_ready: bool,
    },
    Active,
    Retiring {
        cancel_sent: bool,
        observed_not_ready: bool,
    },
}

/// Owns request cardinality separately from presentation feedback and physical readiness.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct CombatEngagementRuntime {
    desired: Option<ClientCombatEngagement>,
    sent: Option<ClientCombatEngagement>,
    phase: CombatPhase,
    profile_dirty: bool,
    profile_update_ready: bool,
    refill: Option<ClientCombatRefillEstimate>,
    pending_error: Option<WeenieError>,
}

impl Default for CombatEngagementRuntime {
    fn default() -> Self {
        Self {
            desired: None,
            sent: None,
            phase: CombatPhase::Idle,
            profile_dirty: false,
            profile_update_ready: false,
            refill: None,
            pending_error: None,
        }
    }
}

impl CombatEngagementRuntime {
    pub(super) fn has_sent_sequence(self) -> bool {
        self.sent.is_some()
    }

    /// Server sequence currently owning attack repetition, if one has been sent.
    pub(super) fn sent_engagement(self) -> Option<ClientCombatEngagement> {
        self.sent
    }

    pub(super) fn status(self) -> ClientCombatStatus {
        ClientCombatStatus {
            desired: self.desired,
            state: match self.phase {
                CombatPhase::Idle => ClientCombatControlState::Idle,
                CombatPhase::Charging { .. } => ClientCombatControlState::Charging,
                CombatPhase::Waiting { .. } => ClientCombatControlState::WaitingForReadiness,
                CombatPhase::Active => ClientCombatControlState::Active,
                CombatPhase::Retiring { .. } => ClientCombatControlState::Retiring,
            },
            refill: self.refill,
        }
    }

    pub(super) fn begin(
        &mut self,
        target: Guid,
        profile: ClientAttackProfile,
        now: Instant,
        refill_duration: Duration,
    ) {
        let desired = ClientCombatEngagement {
            target,
            profile: profile.normalized(),
        };
        let replacing_sent = self.sent.is_some_and(|sent| {
            sent.target != target || sent.profile.combat_mode() != profile.combat_mode()
        });
        self.desired = Some(desired);
        self.refill = None;
        self.pending_error = None;

        if replacing_sent {
            self.profile_dirty = false;
            self.profile_update_ready = false;
            self.phase = CombatPhase::Retiring {
                cancel_sent: false,
                observed_not_ready: false,
            };
            return;
        }
        if self.sent.is_some() {
            self.profile_dirty = self.sent != Some(desired);
            self.profile_update_ready = false;
            return;
        }

        self.profile_dirty = false;
        self.profile_update_ready = false;
        let charge = refill_duration.mul_f32(desired.profile.initial_charge_fraction());
        self.refill = Some(ClientCombatRefillEstimate {
            started_at: now,
            duration: charge,
        });
        self.phase = CombatPhase::Charging {
            ready_at: now + charge,
        };
    }

    pub(super) fn update_profile(&mut self, profile: ClientAttackProfile) {
        let Some(mut desired) = self.desired else {
            return;
        };
        let profile = profile.normalized();
        if desired.profile.combat_mode() != profile.combat_mode() && self.sent.is_some() {
            desired.profile = profile;
            self.desired = Some(desired);
            self.profile_dirty = false;
            self.profile_update_ready = false;
            self.refill = None;
            self.phase = CombatPhase::Retiring {
                cancel_sent: false,
                observed_not_ready: false,
            };
            return;
        }
        desired.profile = profile;
        self.desired = Some(desired);
        self.profile_dirty = self.sent.is_some_and(|sent| sent != desired);
        self.profile_update_ready = false;
    }

    pub(super) fn stop(&mut self) {
        self.desired = None;
        self.profile_dirty = false;
        self.profile_update_ready = false;
        self.refill = None;
        self.pending_error = None;
        self.phase = if self.sent.is_some() {
            CombatPhase::Retiring {
                cancel_sent: false,
                observed_not_ready: false,
            }
        } else {
            CombatPhase::Idle
        };
    }

    pub(super) fn reset(&mut self) {
        *self = Self::default();
    }

    pub(super) fn next_effect(&mut self, now: Instant, ready: bool) -> Option<CombatControlEffect> {
        match self.phase {
            CombatPhase::Idle => None,
            CombatPhase::Charging { ready_at } => {
                if now < ready_at {
                    return None;
                }
                if !ready {
                    self.phase = CombatPhase::Waiting {
                        gate: RestartGate::Immediate,
                        observed_not_ready: true,
                    };
                    return None;
                }
                self.issue_desired_attack()
            }
            CombatPhase::Waiting {
                gate,
                mut observed_not_ready,
            } => {
                observed_not_ready |= !ready;
                self.phase = CombatPhase::Waiting {
                    gate,
                    observed_not_ready,
                };
                if ready && (gate == RestartGate::Immediate || observed_not_ready) {
                    self.issue_desired_attack()
                } else {
                    None
                }
            }
            CombatPhase::Active if self.profile_update_ready && ready => {
                self.issue_desired_attack()
            }
            CombatPhase::Active => None,
            CombatPhase::Retiring {
                cancel_sent,
                mut observed_not_ready,
            } => {
                observed_not_ready |= !ready;
                self.phase = CombatPhase::Retiring {
                    cancel_sent: true,
                    observed_not_ready,
                };
                (!cancel_sent).then_some(CombatControlEffect::Cancel)
            }
        }
    }

    fn issue_desired_attack(&mut self) -> Option<CombatControlEffect> {
        let desired = self.desired?;
        self.sent = Some(desired);
        self.phase = CombatPhase::Active;
        self.profile_dirty = false;
        self.profile_update_ready = false;
        self.refill = None;
        Some(CombatControlEffect::Attack(desired))
    }

    pub(super) fn attack_commenced(&mut self) {
        if self.sent.is_some() && !matches!(self.phase, CombatPhase::Retiring { .. }) {
            self.phase = CombatPhase::Active;
        }
    }

    pub(super) fn note_weenie_error(&mut self, error: WeenieError) {
        if self.sent.is_some()
            && matches!(
                error,
                WeenieError::YouChargedTooFar
                    | WeenieError::MissileOutOfRange
                    | WeenieError::ObjectGone
                    | WeenieError::NoObject
            )
        {
            self.pending_error = Some(error);
        }
    }

    pub(super) fn attack_done(&mut self, error: WeenieError, now: Instant) {
        let error = self.pending_error.take().unwrap_or(error);
        if error == WeenieError::None {
            if matches!(self.phase, CombatPhase::Active) {
                self.refill = Some(ClientCombatRefillEstimate {
                    started_at: now,
                    duration: STANDARD_REFILL_DURATION,
                });
                self.profile_update_ready = self.profile_dirty;
            }
            return;
        }

        let previous_sent = self.sent;
        let retired_after_not_ready = matches!(
            self.phase,
            CombatPhase::Retiring {
                observed_not_ready: true,
                ..
            }
        );
        self.sent = None;
        self.refill = None;
        self.profile_dirty = false;
        self.profile_update_ready = false;
        let recoverable = matches!(
            error,
            WeenieError::ActionCancelled | WeenieError::YouChargedTooFar
        );
        self.phase = match (self.desired, recoverable) {
            (Some(desired), true) => {
                let replacement = previous_sent.is_some_and(|sent| {
                    sent.target != desired.target
                        || sent.profile.combat_mode() != desired.profile.combat_mode()
                });
                CombatPhase::Waiting {
                    gate: if replacement {
                        RestartGate::Immediate
                    } else {
                        RestartGate::ReadinessTransition
                    },
                    observed_not_ready: retired_after_not_ready,
                }
            }
            (Some(_), false) | (None, _) => {
                self.desired = None;
                CombatPhase::Idle
            }
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::combat::AttackHeight;

    fn melee(power: f32) -> ClientAttackProfile {
        ClientAttackProfile::Melee {
            height: AttackHeight::Medium,
            power,
        }
    }

    #[test]
    fn repeat_completion_does_not_emit_a_cadence_request() {
        let start = Instant::now();
        let mut runtime = CombatEngagementRuntime::default();
        runtime.begin(Guid(2), melee(0.5), start, STANDARD_REFILL_DURATION);
        assert_eq!(runtime.next_effect(start, true), None);
        assert!(matches!(
            runtime.next_effect(start + Duration::from_millis(500), true),
            Some(CombatControlEffect::Attack(_))
        ));

        runtime.attack_done(WeenieError::None, start + Duration::from_secs(1));
        assert_eq!(
            runtime.next_effect(start + Duration::from_secs(2), true),
            None
        );
    }

    #[test]
    fn control_update_is_coalesced_to_one_completion_edge() {
        let start = Instant::now();
        let mut runtime = CombatEngagementRuntime::default();
        runtime.begin(Guid(2), melee(0.0), start, STANDARD_REFILL_DURATION);
        runtime.next_effect(start, true).unwrap();
        runtime.update_profile(melee(0.2));
        runtime.update_profile(melee(0.8));
        assert_eq!(runtime.next_effect(start, true), None);
        runtime.attack_done(WeenieError::None, start);
        let Some(CombatControlEffect::Attack(update)) = runtime.next_effect(start, true) else {
            panic!("completion should release the latest controls");
        };
        assert_eq!(update.profile, melee(0.8));
        assert_eq!(runtime.next_effect(start, true), None);
    }

    #[test]
    fn control_update_waits_for_request_readiness_without_retiring_the_sequence() {
        let start = Instant::now();
        let mut runtime = CombatEngagementRuntime::default();
        runtime.begin(Guid(2), melee(0.0), start, STANDARD_REFILL_DURATION);
        runtime.next_effect(start, true).unwrap();
        runtime.update_profile(melee(0.8));
        runtime.attack_done(WeenieError::None, start);

        assert_eq!(runtime.next_effect(start, false), None);
        assert!(runtime.has_sent_sequence());
        assert_eq!(runtime.status().state, ClientCombatControlState::Active);
        let Some(CombatControlEffect::Attack(update)) = runtime.next_effect(start, true) else {
            panic!("request readiness should release the pending control update");
        };
        assert_eq!(update.profile, melee(0.8));
    }

    #[test]
    fn stop_cancels_once_and_late_feedback_cannot_rearm() {
        let start = Instant::now();
        let mut runtime = CombatEngagementRuntime::default();
        runtime.begin(Guid(2), melee(0.0), start, STANDARD_REFILL_DURATION);
        runtime.next_effect(start, true).unwrap();
        runtime.stop();
        assert_eq!(
            runtime.next_effect(start, true),
            Some(CombatControlEffect::Cancel)
        );
        assert_eq!(runtime.next_effect(start, true), None);
        runtime.attack_done(WeenieError::ActionCancelled, start);
        assert_eq!(runtime.status(), ClientCombatStatus::default());
    }

    #[test]
    fn recoverable_failure_requires_a_readiness_transition() {
        let start = Instant::now();
        let mut runtime = CombatEngagementRuntime::default();
        runtime.begin(Guid(2), melee(0.0), start, STANDARD_REFILL_DURATION);
        runtime.next_effect(start, true).unwrap();
        runtime.attack_done(WeenieError::ActionCancelled, start);
        assert_eq!(runtime.next_effect(start, true), None);
        assert_eq!(runtime.next_effect(start, false), None);
        assert!(matches!(
            runtime.next_effect(start, true),
            Some(CombatControlEffect::Attack(_))
        ));
    }

    #[test]
    fn active_sequence_remains_server_owned_until_cancellation_feedback() {
        let start = Instant::now();
        let mut runtime = CombatEngagementRuntime::default();
        runtime.begin(Guid(2), melee(0.0), start, STANDARD_REFILL_DURATION);
        runtime.next_effect(start, true).unwrap();

        assert_eq!(runtime.next_effect(start, false), None);
        assert!(runtime.has_sent_sequence());
        assert_eq!(runtime.status().state, ClientCombatControlState::Active);
        assert_eq!(
            runtime.status().desired.map(|engagement| engagement.target),
            Some(Guid(2))
        );

        runtime.attack_done(WeenieError::ActionCancelled, start);
        assert!(!runtime.has_sent_sequence());
        assert_eq!(runtime.next_effect(start, false), None);
        assert!(matches!(
            runtime.next_effect(start, true),
            Some(CombatControlEffect::Attack(_))
        ));
    }

    #[test]
    fn elapsed_charge_reports_waiting_until_attack_is_ready() {
        let start = Instant::now();
        let mut runtime = CombatEngagementRuntime::default();
        runtime.begin(Guid(2), melee(0.5), start, STANDARD_REFILL_DURATION);

        assert_eq!(
            runtime.next_effect(start + Duration::from_millis(500), false),
            None
        );
        assert_eq!(
            runtime.status().state,
            ClientCombatControlState::WaitingForReadiness
        );
        assert!(matches!(
            runtime.next_effect(start + Duration::from_millis(501), true),
            Some(CombatControlEffect::Attack(_))
        ));
    }
}
