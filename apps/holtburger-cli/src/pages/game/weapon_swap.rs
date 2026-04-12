use holtburger_common::Guid;
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

#[derive(Debug, Clone, Default)]
pub(crate) struct WeaponSwapState {
    pending: Option<PendingWeaponSwap>,
}

impl WeaponSwapState {
    pub(crate) fn is_active(&self) -> bool {
        self.pending.is_some()
    }

    pub(crate) fn tracked_item_guid(&self) -> Option<Guid> {
        self.pending.map(|pending| pending.item_guid)
    }

    fn resume_mode_after_timeout(
        fallback_mode: CombatMode,
        suggested_mode: CombatMode,
    ) -> CombatMode {
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
    pub(crate) fn advance(&mut self, input: WeaponSwapInput) -> Vec<ClientCommand> {
        match input {
            WeaponSwapInput::Start {
                now,
                item_guid,
                slot,
                current_mode,
                item_mask,
            } => {
                let Some(item_mask) = item_mask else {
                    self.pending = None;
                    return vec![ClientCommand::GetAndWield {
                        item: item_guid,
                        slot,
                    }];
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
                            vec![ClientCommand::SetCombatMode(CombatMode::NonCombat)]
                        }
                        PendingWeaponSwapStage::AwaitEquip => {
                            vec![ClientCommand::GetAndWield {
                                item: item_guid,
                                slot,
                            }]
                        }
                    };
                }

                if current_mode == CombatMode::NonCombat
                    || !should_stage_weapon_swap(current_mode, item_mask, slot)
                {
                    return vec![ClientCommand::GetAndWield {
                        item: item_guid,
                        slot,
                    }];
                }

                self.pending = Some(PendingWeaponSwap {
                    item_guid,
                    slot,
                    fallback_mode,
                    target_mask,
                    started_at: now,
                    stage: PendingWeaponSwapStage::AwaitPeace,
                });

                vec![ClientCommand::SetCombatMode(CombatMode::NonCombat)]
            }
            WeaponSwapInput::Tick {
                now,
                combat_mode,
                equipped_mask,
                suggested_mode,
            } => {
                let Some(mut pending) = self.pending else {
                    return Vec::new();
                };

                if now.duration_since(pending.started_at) >= WEAPON_SWAP_TIMEOUT {
                    self.pending = None;

                    let resume_mode =
                        Self::resume_mode_after_timeout(pending.fallback_mode, suggested_mode);
                    if combat_mode == CombatMode::NonCombat && resume_mode != CombatMode::NonCombat
                    {
                        return vec![ClientCommand::SetCombatMode(resume_mode)];
                    }

                    return Vec::new();
                }

                match pending.stage {
                    PendingWeaponSwapStage::AwaitPeace => {
                        if combat_mode != CombatMode::NonCombat {
                            return Vec::new();
                        }

                        pending.stage = PendingWeaponSwapStage::AwaitEquip;
                        self.pending = Some(pending);

                        vec![ClientCommand::GetAndWield {
                            item: pending.item_guid,
                            slot: pending.slot,
                        }]
                    }
                    PendingWeaponSwapStage::AwaitEquip => {
                        if !equipped_mask.intersects(pending.target_mask) {
                            self.pending = Some(pending);
                            return Vec::new();
                        }

                        self.pending = None;

                        if suggested_mode != CombatMode::NonCombat {
                            vec![ClientCommand::SetCombatMode(suggested_mode)]
                        } else {
                            Vec::new()
                        }
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
        let mut weapon_swap = WeaponSwapState::default();
        let now = Instant::now();

        let commands = weapon_swap.advance(WeaponSwapInput::Start {
            now,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });

        assert!(weapon_swap.is_active());
        assert!(matches!(
            commands.as_slice(),
            [ClientCommand::SetCombatMode(CombatMode::NonCombat)]
        ));
    }

    #[test]
    fn peace_then_equip_reenters_suggested_mode() {
        let mut weapon_swap = WeaponSwapState::default();
        let now = Instant::now();
        let item_guid = Guid(0x60000001);

        let _ = weapon_swap.advance(WeaponSwapInput::Start {
            now,
            item_guid,
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });

        let equip = weapon_swap.advance(WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::Melee,
        });

        assert!(weapon_swap.is_active());
        assert!(matches!(
            equip.as_slice(),
            [ClientCommand::GetAndWield { item, slot: None }]
                if *item == item_guid
        ));

        let resume = weapon_swap.advance(WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::MELEE_WEAPON,
            suggested_mode: CombatMode::Melee,
        });

        assert!(!weapon_swap.is_active());
        assert!(matches!(
            resume.as_slice(),
            [ClientCommand::SetCombatMode(CombatMode::Melee)]
        ));
    }

    #[test]
    fn timeout_restores_fallback_mode_when_stuck_in_peace() {
        let mut weapon_swap = WeaponSwapState::default();
        let started_at = Instant::now();

        let _ = weapon_swap.advance(WeaponSwapInput::Start {
            now: started_at,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Missile,
            item_mask: Some(EquipMask::MISSILE_WEAPON),
        });

        let timeout = weapon_swap.advance(WeaponSwapInput::Tick {
            now: started_at + Duration::from_secs(4),
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::NonCombat,
        });

        assert!(!weapon_swap.is_active());
        assert!(matches!(
            timeout.as_slice(),
            [ClientCommand::SetCombatMode(CombatMode::Missile)]
        ));
    }

    #[test]
    fn timeout_prefers_newly_suggested_mode_over_fallback_mode() {
        let mut weapon_swap = WeaponSwapState::default();
        let started_at = Instant::now();

        let _ = weapon_swap.advance(WeaponSwapInput::Start {
            now: started_at,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::CASTER),
        });

        let timeout = weapon_swap.advance(WeaponSwapInput::Tick {
            now: started_at + Duration::from_secs(4),
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::Magic,
        });

        assert!(!weapon_swap.is_active());
        assert!(matches!(
            timeout.as_slice(),
            [ClientCommand::SetCombatMode(CombatMode::Magic)]
        ));
    }

    #[test]
    fn start_outside_combat_directly_equips_without_pending_swap() {
        let mut weapon_swap = WeaponSwapState::default();

        let commands = weapon_swap.advance(WeaponSwapInput::Start {
            now: Instant::now(),
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::NonCombat,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });

        assert!(!weapon_swap.is_active());
        assert!(matches!(
            commands.as_slice(),
            [ClientCommand::GetAndWield { item, slot: None }]
                if *item == Guid(0x60000001)
        ));
    }

    #[test]
    fn non_weapon_items_directly_equip_without_pending_swap() {
        let mut weapon_swap = WeaponSwapState::default();

        let commands = weapon_swap.advance(WeaponSwapInput::Start {
            now: Instant::now(),
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::HEAD_WEAR),
        });

        assert!(!weapon_swap.is_active());
        assert!(matches!(
            commands.as_slice(),
            [ClientCommand::GetAndWield { item, slot: None }]
                if *item == Guid(0x60000001)
        ));
    }

    #[test]
    fn replacement_while_waiting_for_peace_retargets_pending_swap() {
        let mut weapon_swap = WeaponSwapState::default();
        let now = Instant::now();
        let replacement_guid = Guid(0x60000002);

        let _ = weapon_swap.advance(WeaponSwapInput::Start {
            now,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });

        let replacement = weapon_swap.advance(WeaponSwapInput::Start {
            now,
            item_guid: replacement_guid,
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MISSILE_WEAPON),
        });

        assert!(weapon_swap.is_active());
        assert!(matches!(
            replacement.as_slice(),
            [ClientCommand::SetCombatMode(CombatMode::NonCombat)]
        ));

        let equip = weapon_swap.advance(WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::Missile,
        });

        assert!(matches!(
            equip.as_slice(),
            [ClientCommand::GetAndWield { item, slot: None }]
                if *item == replacement_guid
        ));
    }

    #[test]
    fn replacement_while_waiting_for_equip_reissues_new_target() {
        let mut weapon_swap = WeaponSwapState::default();
        let now = Instant::now();
        let replacement_guid = Guid(0x60000002);

        let _ = weapon_swap.advance(WeaponSwapInput::Start {
            now,
            item_guid: Guid(0x60000001),
            slot: None,
            current_mode: CombatMode::Melee,
            item_mask: Some(EquipMask::MELEE_WEAPON),
        });
        let _ = weapon_swap.advance(WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::NONE,
            suggested_mode: CombatMode::Melee,
        });

        let replacement = weapon_swap.advance(WeaponSwapInput::Start {
            now,
            item_guid: replacement_guid,
            slot: None,
            current_mode: CombatMode::NonCombat,
            item_mask: Some(EquipMask::CASTER),
        });

        assert!(weapon_swap.is_active());
        assert!(matches!(
            replacement.as_slice(),
            [ClientCommand::GetAndWield { item, slot: None }]
                if *item == replacement_guid
        ));

        let finish = weapon_swap.advance(WeaponSwapInput::Tick {
            now,
            combat_mode: CombatMode::NonCombat,
            equipped_mask: EquipMask::CASTER,
            suggested_mode: CombatMode::Magic,
        });

        assert!(matches!(
            finish.as_slice(),
            [ClientCommand::SetCombatMode(CombatMode::Magic)]
        ));
        assert!(!weapon_swap.is_active());
    }
}
