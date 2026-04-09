use crate::client::controllers::{Controller, ControllerStatus, ControllerUpdate};
use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
use std::f32::consts::{PI, TAU};
use std::time::{Duration, Instant};

const ATTACK_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(1);
const FACING_REISSUE_INTERVAL: Duration = Duration::from_millis(150);
const MELEE_STICKY_DISTANCE: f32 = 4.0;
const MELEE_FACING_THRESHOLD: f32 = 0.5_f32.to_radians();
const MISSILE_FACING_THRESHOLD: f32 = 5.0_f32.to_radians();

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
    fn to_attack_request(self, target: Guid) -> Option<TargetedAttackRequest> {
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DesiredAttackInput {
    Tick {
        now: Instant,
        target_guid: Guid,
        target_available: bool,
        attack_profile: DesiredAttackProfile,
        attack_armed: bool,
        attack_sequence_active: bool,
        force_attack: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DesiredAttackEffect {
    Attack(TargetedAttackRequest),
}

#[derive(Debug, Clone, Default)]
pub struct DesiredAttackController {
    last_attack_attempt_at: Option<Instant>,
}

impl Controller for DesiredAttackController {
    type Input = DesiredAttackInput;
    type Effect = DesiredAttackEffect;

    fn handle(&mut self, input: &Self::Input) -> ControllerUpdate<Self::Effect> {
        let DesiredAttackInput::Tick {
            now,
            target_guid,
            target_available,
            attack_profile,
            attack_armed,
            attack_sequence_active,
            force_attack,
        } = *input;

        if attack_profile.to_attack_request(target_guid).is_none() {
            return ControllerUpdate::new(ControllerStatus::Paused);
        }

        if !target_available {
            return ControllerUpdate::new(ControllerStatus::Blocked);
        }

        if attack_sequence_active {
            return ControllerUpdate::new(ControllerStatus::Active);
        }

        if !attack_armed {
            return ControllerUpdate::new(ControllerStatus::Idle);
        }

        if !force_attack
            && self.last_attack_attempt_at.is_some_and(|last_attempt| {
                now.duration_since(last_attempt) < ATTACK_HEARTBEAT_INTERVAL
            })
        {
            return ControllerUpdate::new(ControllerStatus::CoolingDown);
        }

        self.last_attack_attempt_at = Some(now);

        ControllerUpdate::new(ControllerStatus::Active).with_effect(DesiredAttackEffect::Attack(
            attack_profile
                .to_attack_request(target_guid)
                .expect("combat mode already validated"),
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CombatFacingInput {
    Tick {
        now: Instant,
        mode: CombatMode,
        player_position: Option<WorldPosition>,
        target_position: Option<WorldPosition>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CombatFacingEffect {
    TurnTo { heading: f32 },
}

#[derive(Debug, Clone, Default)]
pub struct CombatFacingController {
    last_turn_at: Option<Instant>,
}

impl Controller for CombatFacingController {
    type Input = CombatFacingInput;
    type Effect = CombatFacingEffect;

    fn handle(&mut self, input: &Self::Input) -> ControllerUpdate<Self::Effect> {
        let CombatFacingInput::Tick {
            now,
            mode,
            player_position,
            target_position,
        } = *input;

        let Some(player_position) = player_position else {
            return ControllerUpdate::new(ControllerStatus::Idle);
        };

        let Some(target_position) = target_position else {
            return ControllerUpdate::new(ControllerStatus::Idle);
        };

        let distance = player_position.distance_to(&target_position);
        let Some(threshold) = facing_threshold(mode, distance) else {
            return ControllerUpdate::new(match mode {
                CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic => {
                    ControllerStatus::Paused
                }
                CombatMode::Melee | CombatMode::Missile => ControllerStatus::Idle,
            });
        };

        let desired_heading = player_position.coords.heading_to(&target_position.coords);
        let current_heading = player_position.rotation.to_heading();
        let heading_delta = shortest_heading_delta(current_heading, desired_heading);

        if heading_delta <= threshold {
            return ControllerUpdate::new(ControllerStatus::Idle);
        }

        if self
            .last_turn_at
            .is_some_and(|last_turn| now.duration_since(last_turn) < FACING_REISSUE_INTERVAL)
        {
            return ControllerUpdate::new(ControllerStatus::CoolingDown);
        }

        self.last_turn_at = Some(now);

        ControllerUpdate::new(ControllerStatus::Active).with_effect(CombatFacingEffect::TurnTo {
            heading: desired_heading,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CombatAutomationInput {
    Tick {
        now: Instant,
        target_guid: Guid,
        target_available: bool,
        player_position: Option<WorldPosition>,
        target_position: Option<WorldPosition>,
        attack_profile: DesiredAttackProfile,
        attack_armed: bool,
        attack_sequence_active: bool,
        force_attack: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CombatAutomationEffect {
    TurnTo { heading: f32 },
    Attack(TargetedAttackRequest),
}

#[derive(Debug, Clone, Default)]
pub struct CombatAutomationController {
    current_target: Option<Guid>,
    current_mode: Option<CombatMode>,
    facing: CombatFacingController,
    desired_attack: DesiredAttackController,
}

impl Controller for CombatAutomationController {
    type Input = CombatAutomationInput;
    type Effect = CombatAutomationEffect;

    fn handle(&mut self, input: &Self::Input) -> ControllerUpdate<Self::Effect> {
        let CombatAutomationInput::Tick {
            now,
            target_guid,
            target_available,
            player_position,
            target_position,
            attack_profile,
            attack_armed,
            attack_sequence_active,
            force_attack,
        } = *input;

        if self.current_target != Some(target_guid)
            || self.current_mode != Some(attack_profile.mode)
        {
            self.current_target = Some(target_guid);
            self.current_mode = Some(attack_profile.mode);
            self.facing = CombatFacingController::default();
            self.desired_attack = DesiredAttackController::default();
        }

        let facing_update = self.facing.handle(&CombatFacingInput::Tick {
            now,
            mode: attack_profile.mode,
            player_position,
            target_position,
        });

        if matches!(
            facing_update.status,
            ControllerStatus::Active | ControllerStatus::CoolingDown
        ) {
            return facing_update.map_effects(|effect| match effect {
                CombatFacingEffect::TurnTo { heading } => {
                    CombatAutomationEffect::TurnTo { heading }
                }
            });
        }

        let desired_attack_update = self.desired_attack.handle(&DesiredAttackInput::Tick {
            now,
            target_guid,
            target_available,
            attack_profile,
            attack_armed,
            attack_sequence_active,
            force_attack,
        });

        desired_attack_update.map_effects(|effect| match effect {
            DesiredAttackEffect::Attack(request) => CombatAutomationEffect::Attack(request),
        })
    }
}

fn facing_threshold(mode: CombatMode, distance: f32) -> Option<f32> {
    match mode {
        CombatMode::Melee if distance <= MELEE_STICKY_DISTANCE => Some(MELEE_FACING_THRESHOLD),
        CombatMode::Missile => Some(MISSILE_FACING_THRESHOLD),
        CombatMode::Undef | CombatMode::NonCombat | CombatMode::Magic | CombatMode::Melee => None,
    }
}

fn shortest_heading_delta(a: f32, b: f32) -> f32 {
    let mut delta = (a - b).abs() % TAU;
    if delta > PI {
        delta = TAU - delta;
    }
    delta
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Vector3;
    use holtburger_common::{Guid, Quaternion};

    fn position(x: f32, y: f32, heading: f32) -> WorldPosition {
        WorldPosition {
            coords: Vector3::new(x, y, 0.0),
            rotation: Quaternion::from_heading(heading),
            ..Default::default()
        }
    }

    #[test]
    fn desired_attack_controller_reissues_after_cooldown() {
        let now = Instant::now();
        let mut controller = DesiredAttackController::default();
        let input = DesiredAttackInput::Tick {
            now,
            target_guid: Guid(0x1234),
            target_available: true,
            attack_profile: DesiredAttackProfile {
                mode: CombatMode::Melee,
                attack_height: AttackHeight::Medium,
                charge_level: 0.5,
            },
            attack_armed: true,
            attack_sequence_active: false,
            force_attack: false,
        };

        let first = controller.handle(&input);
        assert_eq!(first.status, ControllerStatus::Active);
        assert_eq!(first.effects.len(), 1);

        let cooling = controller.handle(&DesiredAttackInput::Tick {
            now: now + Duration::from_millis(250),
            target_guid: Guid(0x1234),
            target_available: true,
            attack_profile: DesiredAttackProfile {
                mode: CombatMode::Melee,
                attack_height: AttackHeight::Medium,
                charge_level: 0.5,
            },
            attack_armed: true,
            attack_sequence_active: false,
            force_attack: false,
        });
        assert_eq!(cooling.status, ControllerStatus::CoolingDown);
        assert!(cooling.effects.is_empty());

        let refreshed = controller.handle(&DesiredAttackInput::Tick {
            now: now + ATTACK_HEARTBEAT_INTERVAL + Duration::from_millis(1),
            target_guid: Guid(0x1234),
            target_available: true,
            attack_profile: DesiredAttackProfile {
                mode: CombatMode::Melee,
                attack_height: AttackHeight::Medium,
                charge_level: 0.5,
            },
            attack_armed: true,
            attack_sequence_active: false,
            force_attack: false,
        });
        assert_eq!(refreshed.status, ControllerStatus::Active);
        assert_eq!(refreshed.effects.len(), 1);
    }

    #[test]
    fn desired_attack_controller_stays_idle_until_armed() {
        let now = Instant::now();
        let mut controller = DesiredAttackController::default();

        let update = controller.handle(&DesiredAttackInput::Tick {
            now,
            target_guid: Guid(0x1234),
            target_available: true,
            attack_profile: DesiredAttackProfile {
                mode: CombatMode::Melee,
                attack_height: AttackHeight::Medium,
                charge_level: 0.5,
            },
            attack_armed: false,
            attack_sequence_active: false,
            force_attack: false,
        });

        assert_eq!(update.status, ControllerStatus::Idle);
        assert!(update.effects.is_empty());
    }

    #[test]
    fn desired_attack_controller_blocks_when_target_is_invalid() {
        let now = Instant::now();
        let mut controller = DesiredAttackController::default();

        let update = controller.handle(&DesiredAttackInput::Tick {
            now,
            target_guid: Guid(0x1234),
            target_available: false,
            attack_profile: DesiredAttackProfile {
                mode: CombatMode::Missile,
                attack_height: AttackHeight::Medium,
                charge_level: 0.5,
            },
            attack_armed: true,
            attack_sequence_active: false,
            force_attack: true,
        });

        assert_eq!(update.status, ControllerStatus::Blocked);
        assert!(update.effects.is_empty());
    }

    #[test]
    fn combat_facing_controller_turns_for_missile_attacks() {
        let now = Instant::now();
        let mut controller = CombatFacingController::default();

        let update = controller.handle(&CombatFacingInput::Tick {
            now,
            mode: CombatMode::Missile,
            player_position: Some(position(0.0, 0.0, 0.0)),
            target_position: Some(position(0.0, 10.0, 0.0)),
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert_eq!(
            update.effects,
            vec![CombatFacingEffect::TurnTo {
                heading: 90.0_f32.to_radians(),
            }]
        );
    }

    #[test]
    fn combat_facing_controller_does_not_turn_for_far_melee_targets() {
        let now = Instant::now();
        let mut controller = CombatFacingController::default();

        let update = controller.handle(&CombatFacingInput::Tick {
            now,
            mode: CombatMode::Melee,
            player_position: Some(position(0.0, 0.0, 0.0)),
            target_position: Some(position(0.0, 10.0, 0.0)),
        });

        assert_eq!(update.status, ControllerStatus::Idle);
        assert!(update.effects.is_empty());
    }

    #[test]
    fn combat_automation_turns_before_issuing_missile_attack() {
        let now = Instant::now();
        let mut controller = CombatAutomationController::default();
        let input = CombatAutomationInput::Tick {
            now,
            target_guid: Guid(0x1234),
            target_available: true,
            player_position: Some(position(0.0, 0.0, 0.0)),
            target_position: Some(position(0.0, 10.0, 0.0)),
            attack_profile: DesiredAttackProfile {
                mode: CombatMode::Missile,
                attack_height: AttackHeight::Medium,
                charge_level: 0.5,
            },
            attack_armed: true,
            attack_sequence_active: false,
            force_attack: true,
        };

        let turn = controller.handle(&input);
        assert_eq!(turn.status, ControllerStatus::Active);
        assert_eq!(
            turn.effects,
            vec![CombatAutomationEffect::TurnTo {
                heading: 90.0_f32.to_radians(),
            }]
        );

        let attack = controller.handle(&CombatAutomationInput::Tick {
            now: now + FACING_REISSUE_INTERVAL + Duration::from_millis(1),
            target_guid: Guid(0x1234),
            target_available: true,
            player_position: Some(position(0.0, 0.0, 90.0_f32.to_radians())),
            target_position: Some(position(0.0, 10.0, 0.0)),
            attack_profile: DesiredAttackProfile {
                mode: CombatMode::Missile,
                attack_height: AttackHeight::Medium,
                charge_level: 0.5,
            },
            attack_armed: true,
            attack_sequence_active: false,
            force_attack: true,
        });

        assert_eq!(attack.status, ControllerStatus::Active);
        assert_eq!(
            attack.effects,
            vec![CombatAutomationEffect::Attack(
                TargetedAttackRequest::Missile {
                    target: Guid(0x1234),
                    attack_height: AttackHeight::Medium,
                    accuracy_level: 0.5,
                }
            )]
        );
    }
}
