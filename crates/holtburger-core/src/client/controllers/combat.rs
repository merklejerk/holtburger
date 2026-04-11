use holtburger_common::Guid;
use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DesiredAttackProfile {
    pub mode: CombatMode,
    pub attack_height: AttackHeight,
    pub charge_level: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum TargetedAttackRequest {
    Melee {
        target: Guid,
        attack_height: AttackHeight,
        power_level: f32,
    },
    Missile {
        target: Guid,
        attack_height: AttackHeight,
        accuracy_level: f32,
    },
}

impl DesiredAttackProfile {
    pub fn to_targeted_attack_request(self, target: Guid) -> Option<TargetedAttackRequest> {
        match self.mode {
            CombatMode::Melee => Some(TargetedAttackRequest::Melee {
                target,
                attack_height: self.attack_height,
                power_level: self.charge_level,
            }),
            CombatMode::Missile => Some(TargetedAttackRequest::Missile {
                target,
                attack_height: self.attack_height,
                accuracy_level: self.charge_level,
            }),
            CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desired_attack_profile_emits_melee_request() {
        let request = DesiredAttackProfile {
            mode: CombatMode::Melee,
            attack_height: AttackHeight::Medium,
            charge_level: 0.5,
        }
        .to_targeted_attack_request(Guid(0x1234));

        assert_eq!(
            request,
            Some(TargetedAttackRequest::Melee {
                target: Guid(0x1234),
                attack_height: AttackHeight::Medium,
                power_level: 0.5,
            })
        );
    }

    #[test]
    fn desired_attack_profile_rejects_non_attack_modes() {
        let request = DesiredAttackProfile {
            mode: CombatMode::Magic,
            attack_height: AttackHeight::Medium,
            charge_level: 0.5,
        }
        .to_targeted_attack_request(Guid(0x1234));

        assert_eq!(request, None);
    }
}
