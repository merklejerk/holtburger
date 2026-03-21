use holtburger_common::Guid;
use holtburger_core::client::controllers::{Controller, ControllerStatus, ControllerUpdate};
use holtburger_core::client::types::{ClientCommand, TargetSlot};
use holtburger_protocol::messages::EquipMask;
use holtburger_protocol::messages::combat::CombatMode;
use std::time::{Duration, Instant};

const WEAPON_SWAP_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PendingWeaponSwapStage {
    AwaitPeace,
    AwaitEquip,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PendingWeaponSwap {
    item_guid: Guid,
    slot: Option<TargetSlot>,
    fallback_mode: CombatMode,
    target_mask: EquipMask,
    started_at: Instant,
    stage: PendingWeaponSwapStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WeaponSwapInput {
    Start {
        now: Instant,
        item_guid: Guid,
        slot: Option<TargetSlot>,
        current_mode: CombatMode,
        item_mask: Option<EquipMask>,
    },
    Tick {
        now: Instant,
        combat_mode: CombatMode,
        equipped_mask: EquipMask,
        suggested_mode: CombatMode,
    },
}

#[derive(Debug, Clone)]
pub(crate) enum WeaponSwapEffect {
    Command(ClientCommand),
}

#[derive(Debug, Clone, Default)]
pub(crate) struct WeaponSwapController {
    pending: Option<PendingWeaponSwap>,
}

impl WeaponSwapController {
    pub(crate) fn is_active(&self) -> bool {
        self.pending.is_some()
    }

    pub(crate) fn tracked_item_guid(&self) -> Option<Guid> {
        self.pending.map(|pending| pending.item_guid)
    }

    fn resume_mode_after_timeout(fallback_mode: CombatMode, suggested_mode: CombatMode) -> CombatMode {
        if suggested_mode != CombatMode::NonCombat {
            suggested_mode
        } else {
            fallback_mode
        }
    }

    fn effective_fallback_mode(&self, current_mode: CombatMode) -> CombatMode {
        if current_mode != CombatMode::NonCombat {
            current_mode
        } else {
            self.pending
                .map(|pending| pending.fallback_mode)
                .unwrap_or(current_mode)
        }
    }
}

impl Controller for WeaponSwapController {
    type Input = WeaponSwapInput;
    type Effect = WeaponSwapEffect;

    fn handle(&mut self, input: &Self::Input) -> ControllerUpdate<Self::Effect> {
        match *input {
            WeaponSwapInput::Start {
                now,
                item_guid,
                slot,
                current_mode,
                item_mask,
            } => {
                let Some(item_mask) = item_mask else {
                    self.pending = None;
                    return ControllerUpdate::new(ControllerStatus::Completed).with_effect(
                        WeaponSwapEffect::Command(ClientCommand::GetAndWield {
                            item: item_guid,
                            slot,
                        }),
                    );
                };

                let fallback_mode = self.effective_fallback_mode(current_mode);
                let target_mask = weapon_swap_target_mask(item_mask, slot);

                if self.pending.is_some() {
                    let stage = if current_mode == CombatMode::NonCombat {
                        PendingWeaponSwapStage::AwaitEquip
                    } else {
                        PendingWeaponSwapStage::AwaitPeace
                    };
                    self.pending = Some(PendingWeaponSwap {
                        item_guid,
                        slot,
                        fallback_mode,
                        target_mask,
                        started_at: now,
                        stage,
                    });

                    return match stage {
                        PendingWeaponSwapStage::AwaitPeace => {
                            ControllerUpdate::new(ControllerStatus::Active).with_effect(
                                WeaponSwapEffect::Command(ClientCommand::SetCombatMode(
                                    CombatMode::NonCombat,
                                )),
                            )
                        }
                        PendingWeaponSwapStage::AwaitEquip => {
                            ControllerUpdate::new(ControllerStatus::Active).with_effect(
                                WeaponSwapEffect::Command(ClientCommand::GetAndWield {
                                    item: item_guid,
                                    slot,
                                }),
                            )
                        }
                    };
                }

                if current_mode == CombatMode::NonCombat
                    || !should_stage_weapon_swap(current_mode, item_mask, slot)
                {
                    return ControllerUpdate::new(ControllerStatus::Completed).with_effect(
                        WeaponSwapEffect::Command(ClientCommand::GetAndWield {
                            item: item_guid,
                            slot,
                        }),
                    );
                }

                self.pending = Some(PendingWeaponSwap {
                    item_guid,
                    slot,
                    fallback_mode,
                    target_mask,
                    started_at: now,
                    stage: PendingWeaponSwapStage::AwaitPeace,
                });

                ControllerUpdate::new(ControllerStatus::Active).with_effect(
                    WeaponSwapEffect::Command(ClientCommand::SetCombatMode(CombatMode::NonCombat)),
                )
            }
            WeaponSwapInput::Tick {
                now,
                combat_mode,
                equipped_mask,
                suggested_mode,
            } => {
                let Some(mut pending) = self.pending else {
                    return ControllerUpdate::new(ControllerStatus::Idle);
                };

                if now.duration_since(pending.started_at) >= WEAPON_SWAP_TIMEOUT {
                    self.pending = None;

                    let mut update = ControllerUpdate::new(ControllerStatus::Completed);
                    let resume_mode = Self::resume_mode_after_timeout(
                        pending.fallback_mode,
                        suggested_mode,
                    );
                    if combat_mode == CombatMode::NonCombat && resume_mode != CombatMode::NonCombat {
                        update.push_effect(WeaponSwapEffect::Command(
                            ClientCommand::SetCombatMode(resume_mode),
                        ));
                    }
                    return update;
                }

                match pending.stage {
                    PendingWeaponSwapStage::AwaitPeace => {
                        if combat_mode != CombatMode::NonCombat {
                            return ControllerUpdate::new(ControllerStatus::Active);
                        }

                        pending.stage = PendingWeaponSwapStage::AwaitEquip;
                        self.pending = Some(pending);

                        ControllerUpdate::new(ControllerStatus::Active).with_effect(
                            WeaponSwapEffect::Command(ClientCommand::GetAndWield {
                                item: pending.item_guid,
                                slot: pending.slot,
                            }),
                        )
                    }
                    PendingWeaponSwapStage::AwaitEquip => {
                        if !equipped_mask.intersects(pending.target_mask) {
                            self.pending = Some(pending);
                            return ControllerUpdate::new(ControllerStatus::Active);
                        }

                        self.pending = None;

                        let mut update = ControllerUpdate::new(ControllerStatus::Completed);
                        if suggested_mode != CombatMode::NonCombat {
                            update.push_effect(WeaponSwapEffect::Command(
                                ClientCommand::SetCombatMode(suggested_mode),
                            ));
                        }
                        update
                    }
                }
            }
        }
    }
}

fn should_stage_weapon_swap(
    combat_mode: CombatMode,
    item_mask: EquipMask,
    slot: Option<TargetSlot>,
) -> bool {
    if combat_mode == CombatMode::NonCombat {
        return false;
    }

    item_mask.intersects(
        EquipMask::MELEE_WEAPON | EquipMask::MISSILE_WEAPON | EquipMask::CASTER | EquipMask::SHIELD,
    ) || matches!(slot, Some(TargetSlot::MainHand) | Some(TargetSlot::OffHand))
}

fn weapon_swap_target_mask(item_mask: EquipMask, slot: Option<TargetSlot>) -> EquipMask {
    match slot {
        Some(TargetSlot::EquipMask(mask)) => mask,
        Some(TargetSlot::MainHand) => {
            if item_mask.intersects(EquipMask::MELEE_WEAPON) {
                EquipMask::MELEE_WEAPON
            } else if item_mask.intersects(EquipMask::MISSILE_WEAPON) {
                EquipMask::MISSILE_WEAPON
            } else if item_mask.intersects(EquipMask::CASTER) {
                EquipMask::CASTER
            } else {
                item_mask
            }
        }
        Some(TargetSlot::OffHand) => EquipMask::SHIELD,
        Some(TargetSlot::TopClothes) | Some(TargetSlot::BottomClothes) | None => item_mask,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_requests_peace_mode_and_tracks_pending_swap() {
        let mut controller = WeaponSwapController::default();
        let now = Instant::now();

        let update = controller.handle(&WeaponSwapInput::Start {
            now,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });

        assert_eq!(update.status, ControllerStatus::Active);
        assert!(controller.is_active());
        assert!(matches!(
            update.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::SetCombatMode(CombatMode::NonCombat))]
        ));
    }

    #[test]
    fn peace_then_equip_reenters_suggested_mode() {
        let mut controller = WeaponSwapController::default();
        let now = Instant::now();
        let item_guid = Guid(0x60000001);

        let _ = controller.handle(&WeaponSwapInput::Start {
            now,
            item_guid,
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });

        let equip = controller.handle(&WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::Melee,
        });

        assert_eq!(equip.status, ControllerStatus::Active);
        assert!(matches!(
            equip.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::GetAndWield { item, slot: None })]
                if *item == item_guid
        ));
        assert!(controller.is_active());

        let resume = controller.handle(&WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::MELEE_WEAPON,
            suggested_mode: CombatMode::Melee,
        });

        assert_eq!(resume.status, ControllerStatus::Completed);
        assert!(matches!(
            resume.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::SetCombatMode(CombatMode::Melee))]
        ));
        assert!(!controller.is_active());
    }

    #[test]
    fn timeout_restores_fallback_mode_when_stuck_in_peace() {
        let mut controller = WeaponSwapController::default();
        let started_at = Instant::now();

        let _ = controller.handle(&WeaponSwapInput::Start {
            now: started_at,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Missile,
            item_mask: Some(EquipMask::MISSILE_WEAPON),
        });

        let timeout = controller.handle(&WeaponSwapInput::Tick {
            now: started_at + Duration::from_secs(4),
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::NonCombat,
        });

        assert_eq!(timeout.status, ControllerStatus::Completed);
        assert!(matches!(
            timeout.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::SetCombatMode(CombatMode::Missile))]
        ));
        assert!(!controller.is_active());
    }

    #[test]
    fn timeout_prefers_newly_suggested_mode_over_fallback_mode() {
        let mut controller = WeaponSwapController::default();
        let started_at = Instant::now();

        let _ = controller.handle(&WeaponSwapInput::Start {
            now: started_at,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::CASTER),
        });

        let timeout = controller.handle(&WeaponSwapInput::Tick {
            now: started_at + Duration::from_secs(4),
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::Magic,
        });

        assert_eq!(timeout.status, ControllerStatus::Completed);
        assert!(matches!(
            timeout.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::SetCombatMode(CombatMode::Magic))]
        ));
        assert!(!controller.is_active());
    }

    #[test]
    fn start_outside_combat_directly_equips_without_pending_swap() {
        let mut controller = WeaponSwapController::default();

        let update = controller.handle(&WeaponSwapInput::Start {
            now: Instant::now(),
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::NonCombat,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert!(matches!(
            update.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::GetAndWield { item, slot: None })]
                if *item == Guid(0x60000001)
        ));
        assert!(!controller.is_active());
    }

    #[test]
    fn non_weapon_items_directly_equip_without_pending_swap() {
        let mut controller = WeaponSwapController::default();

        let update = controller.handle(&WeaponSwapInput::Start {
            now: Instant::now(),
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::HEAD_WEAR),
        });

        assert_eq!(update.status, ControllerStatus::Completed);
        assert!(matches!(
            update.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::GetAndWield { item, slot: None })]
                if *item == Guid(0x60000001)
        ));
        assert!(!controller.is_active());
    }

    #[test]
    fn replacement_while_waiting_for_peace_retargets_pending_swap() {
        let mut controller = WeaponSwapController::default();
        let now = Instant::now();
        let replacement_guid = Guid(0x60000002);

        let _ = controller.handle(&WeaponSwapInput::Start {
            now,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });

        let replacement = controller.handle(&WeaponSwapInput::Start {
            now,
            item_guid: replacement_guid,
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MISSILE_WEAPON),
        });

        assert_eq!(replacement.status, ControllerStatus::Active);
        assert!(matches!(
            replacement.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::SetCombatMode(CombatMode::NonCombat))]
        ));

        let equip = controller.handle(&WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::Missile,
        });

        assert!(matches!(
            equip.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::GetAndWield { item, slot: None })]
                if *item == replacement_guid
        ));
    }

    #[test]
    fn replacement_while_waiting_for_equip_reissues_new_target() {
        let mut controller = WeaponSwapController::default();
        let now = Instant::now();
        let replacement_guid = Guid(0x60000002);

        let _ = controller.handle(&WeaponSwapInput::Start {
            now,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });
        let _ = controller.handle(&WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::Melee,
        });

        let replacement = controller.handle(&WeaponSwapInput::Start {
            now,
            item_guid: replacement_guid,
            slot: None,
            current_mode: CombatMode::NonCombat,
            item_mask: Some(EquipMask::CASTER),
        });

        assert_eq!(replacement.status, ControllerStatus::Active);
        assert!(matches!(
            replacement.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::GetAndWield { item, slot: None })]
                if *item == replacement_guid
        ));

        let finish = controller.handle(&WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::CASTER,
            suggested_mode: CombatMode::Magic,
        });

        assert!(matches!(
            finish.effects.as_slice(),
            [WeaponSwapEffect::Command(ClientCommand::SetCombatMode(CombatMode::Magic))]
        ));
        assert!(!controller.is_active());
    }
}