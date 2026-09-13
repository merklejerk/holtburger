//! One authority for equipment command ordering and server-confirmed progress.

use super::{
    ClientRuntime, ClientState,
    equipment_plan::{EquipmentPlan, plan_equipment_change},
    types::{ActionResultReason, ActionResultSource, TargetSlot},
};
use anyhow::Result;
use holtburger_common::{
    Guid,
    properties::{EquipMask, WorldObjectExt},
};
use holtburger_protocol::messages::{
    combat::CombatMode,
    game_action::{
        ChangeCombatModeActionData, GameAction, GetAndWieldItemActionData,
        PutItemInContainerActionData, StackableSplitToWieldActionData,
    },
};
use holtburger_world::{
    WorldState,
    context::{WorldContext, WorldContextExt},
    equipment::MAIN_HAND_LOCATIONS,
    state::storage::{StorageLocation, StorageSlot},
};
use std::{
    collections::BTreeSet,
    time::{Duration, Instant},
};

/// Deadline applies to each server-confirmed step, not total outfit size.
const EQUIPMENT_STEP_TIMEOUT: Duration = Duration::from_secs(10);

/// The current request awaiting an authoritative world consequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EquipmentStage {
    Ready,
    Peace,
    Unequip,
    Wield,
    Restore(CombatMode),
}

/// Whole-item wield and split-to-wield have different completion identities.
#[derive(Debug)]
enum WieldRequest {
    Whole,
    Split {
        /// Quantity requested on the existing source stack.
        amount: u32,
        /// Source template to recognize the newly created equipped entity.
        wcid: u32,
        /// Expected remainder; a newly equipped matching item alone cannot confirm a split.
        source_remaining: u32,
        /// Original equipped identities cannot acknowledge a newly split item.
        previous_equipment: BTreeSet<Guid>,
    },
}

/// A single local replacement; unrelated server mutations may invalidate its plan.
#[derive(Debug)]
pub(super) struct EquipmentOperation {
    /// Resolved destinations and original incoming location.
    plan: EquipmentPlan,
    /// Number of authoritative unequip confirmations accepted.
    completed: usize,
    /// Exactly one request may be in flight.
    stage: EquipmentStage,
    /// Absolute deadline for the current request.
    deadline: Instant,
    /// Restore combat only when this operation first requested peace.
    resume_combat: bool,
    /// Final wire request and its corresponding completion rule.
    wield: WieldRequest,
}

/// An advance is either waiting, one wire request, or terminal success.
enum EquipmentAdvance {
    Waiting,
    Send(GameAction),
    Complete,
}

impl EquipmentOperation {
    fn awaiting_item(&self) -> Guid {
        if self.stage == EquipmentStage::Unequip {
            self.plan.unequips[self.completed].item
        } else {
            self.plan.item
        }
    }

    fn wielded(&self, world: &WorldState) -> bool {
        match &self.wield {
            WieldRequest::Whole => world
                .player_equipment()
                .any(|(guid, mask)| guid == self.plan.item && mask == self.plan.target),
            WieldRequest::Split {
                amount,
                wcid,
                previous_equipment,
                source_remaining,
            } => {
                world
                    .entities
                    .get(self.plan.item)
                    .is_some_and(|entity| entity.stack_size() == *source_remaining)
                    && world.player_equipment().any(|(guid, mask)| {
                        !previous_equipment.contains(&guid)
                            && guid != self.plan.item
                            && mask == self.plan.target
                            && world.entities.get(guid).is_some_and(|entity| {
                                entity.wcid == Some(*wcid) && entity.stack_size() == *amount
                            })
                    })
            }
        }
    }

    fn advance(
        &mut self,
        world: &WorldState,
        now: Instant,
    ) -> std::result::Result<EquipmentAdvance, String> {
        match self.stage {
            EquipmentStage::Peace if world.player_combat_mode() == CombatMode::NonCombat => {
                self.stage = EquipmentStage::Ready
            }
            EquipmentStage::Unequip => {
                let step = &self.plan.unequips[self.completed];
                let confirmed = matches!(world.storage_location(step.item), Some(StorageLocation::Contained { parent, slot: StorageSlot::Item { index } | StorageSlot::Pack { index, .. } }) if parent == step.container && index == step.placement);
                if confirmed {
                    self.completed += 1;
                    self.stage = EquipmentStage::Ready;
                }
            }
            EquipmentStage::Wield if self.wielded(world) => {
                if !self.resume_combat {
                    return Ok(EquipmentAdvance::Complete);
                }
                let mode = world.get_suggested_combat_mode();
                self.stage = EquipmentStage::Restore(mode);
                self.deadline = now + EQUIPMENT_STEP_TIMEOUT;
                return Ok(EquipmentAdvance::Send(GameAction::ChangeCombatMode(
                    Box::new(ChangeCombatModeActionData { mode }),
                )));
            }
            EquipmentStage::Restore(mode) if world.player_combat_mode() == mode => {
                return Ok(EquipmentAdvance::Complete);
            }
            _ => {}
        }
        if self.stage != EquipmentStage::Ready {
            if now >= self.deadline {
                return Err("Timed out waiting for the server; the last equipment request may still complete".into());
            }
            return Ok(EquipmentAdvance::Waiting);
        }
        if let WieldRequest::Split {
            amount,
            source_remaining,
            ..
        } = self.wield
            && world
                .entities
                .get(self.plan.item)
                .is_none_or(|entity| entity.stack_size() != amount + source_remaining)
        {
            return Err("Source stack changed while preparing split-to-wield".into());
        }
        let current = plan_equipment_change(
            world,
            self.plan.item,
            Some(TargetSlot::EquipMask(self.plan.target)),
        )
        .map_err(|error| error.to_string())?;
        if current.source != self.plan.source
            || current.target != self.plan.target
            || current.unequips != self.plan.unequips[self.completed..]
        {
            return Err("Inventory changed while replacing equipment".into());
        }
        self.deadline = now + EQUIPMENT_STEP_TIMEOUT;
        if let Some(step) = self.plan.unequips.get(self.completed) {
            self.stage = EquipmentStage::Unequip;
            return Ok(EquipmentAdvance::Send(GameAction::PutItemInContainer(
                Box::new(PutItemInContainerActionData {
                    item_guid: step.item,
                    container_guid: step.container,
                    placement: step.placement,
                }),
            )));
        }
        self.stage = EquipmentStage::Wield;
        Ok(EquipmentAdvance::Send(match self.wield {
            WieldRequest::Whole => {
                GameAction::GetAndWieldItem(Box::new(GetAndWieldItemActionData {
                    item_guid: self.plan.item,
                    equip_mask: self.plan.target,
                }))
            }
            WieldRequest::Split { amount, .. } => {
                GameAction::StackableSplitToWield(Box::new(StackableSplitToWieldActionData {
                    stack_guid: self.plan.item,
                    equip_mask: self.plan.target,
                    amount: amount as i32,
                }))
            }
        }))
    }
}

impl ClientRuntime {
    pub(super) fn stop_equipment_change(&mut self, reason: &str) {
        if let Some(operation) = self.equipment_operation.take() {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(format!(
                    "Equipment change stopped after {} confirmed unequip(s): {reason}",
                    operation.completed
                )),
            );
        }
    }

    pub(super) fn reject_equipment_item(&mut self, item: Guid) {
        if self
            .equipment_operation
            .as_ref()
            .is_some_and(|operation| operation.awaiting_item() == item)
        {
            self.stop_equipment_change("Server rejected the equipment request");
        }
    }

    pub(super) async fn start_equipment_change(
        &mut self,
        item: Guid,
        slot: Option<TargetSlot>,
        split: Option<u32>,
    ) -> Result<()> {
        if self.equipment_operation.is_some()
            || self.inventory_operation.is_some()
            || self.active_busy_operation.is_some()
        {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General("Another inventory operation is still pending".into()),
            );
            return Ok(());
        }
        if !matches!(self.state, ClientState::InWorld) || self.activation.is_some() {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General("Equipment changes require an active world".into()),
            );
            return Ok(());
        }
        let plan = match plan_equipment_change(&self.world, item, slot) {
            Ok(plan) => plan,
            Err(error) => {
                self.emit_action_result(
                    ActionResultSource::Client,
                    ActionResultReason::General(error.to_string()),
                );
                return Ok(());
            }
        };
        self.start_planned_equipment_change(plan, split).await
    }

    /// Consumes the admitted plan without discarding its resolved destinations.
    /// Callers must perform lifecycle/busy admission before entering this path.
    pub(super) async fn start_planned_equipment_change(
        &mut self,
        plan: EquipmentPlan,
        split: Option<u32>,
    ) -> Result<()> {
        let item = plan.item;
        let wield = if let Some(amount) = split {
            let template = self.world.entities.get(item).and_then(|entity| {
                (entity.is_stackable()
                    && amount > 0
                    && amount < entity.stack_size()
                    && i32::try_from(amount).is_ok())
                .then(|| entity.wcid.map(|wcid| (wcid, entity.stack_size() - amount)))
                .flatten()
            });
            let Some((wcid, source_remaining)) = template else {
                self.emit_action_result(
                    ActionResultSource::Client,
                    ActionResultReason::General("Invalid quantity for split-to-wield".into()),
                );
                return Ok(());
            };
            WieldRequest::Split {
                amount,
                wcid,
                source_remaining,
                previous_equipment: self.world.iter_equipment().collect(),
            }
        } else {
            if self.world.equipment_mask(item) == Some(plan.target) {
                return Ok(());
            }
            WieldRequest::Whole
        };
        let now = Instant::now();
        // Undefined (including an absent property) is not evidence of active combat.
        let resume_combat = matches!(
            self.world.player_combat_mode(),
            CombatMode::Melee | CombatMode::Missile | CombatMode::Magic
        ) && plan
            .target
            .intersects(MAIN_HAND_LOCATIONS | EquipMask::SHIELD | EquipMask::MISSILE_AMMO);
        self.equipment_operation = Some(EquipmentOperation {
            plan,
            completed: 0,
            stage: if resume_combat {
                EquipmentStage::Peace
            } else {
                EquipmentStage::Ready
            },
            deadline: now + EQUIPMENT_STEP_TIMEOUT,
            resume_combat,
            wield,
        });
        if resume_combat {
            self.send_game_action(GameAction::ChangeCombatMode(Box::new(
                ChangeCombatModeActionData {
                    mode: CombatMode::NonCombat,
                },
            )))
            .await?;
        } else {
            self.advance_equipment_change(now).await?;
        }
        Ok(())
    }

    pub(super) async fn advance_equipment_change(&mut self, now: Instant) -> Result<()> {
        if !matches!(self.state, ClientState::InWorld) || self.activation.is_some() {
            self.stop_equipment_change("World lifecycle changed");
            return Ok(());
        }
        let Some(operation) = self.equipment_operation.as_mut() else {
            return Ok(());
        };
        match operation.advance(&self.world, now) {
            Ok(EquipmentAdvance::Waiting) => {}
            Ok(EquipmentAdvance::Send(action)) => self.send_game_action(action).await?,
            Ok(EquipmentAdvance::Complete) => {
                self.equipment_operation = None;
                self.emit_action_result(
                    ActionResultSource::Client,
                    ActionResultReason::General("Equipment change completed".into()),
                );
            }
            Err(reason) => self.stop_equipment_change(&reason),
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::equipment_plan::tests::{event, outfit};
    use super::*;
    use holtburger_common::properties::{InventoryEntryKind, PropertyInt};
    use holtburger_protocol::messages::{
        GameEvent, InventoryPutObjInContainerEventData, WieldObjectEventData,
    };

    const PLAYER: Guid = Guid(1);
    const INCOMING: Guid = Guid(3);

    fn operation(world: &WorldState, now: Instant) -> EquipmentOperation {
        EquipmentOperation {
            plan: plan_equipment_change(world, INCOMING, None).expect("complete outfit plan"),
            completed: 0,
            stage: EquipmentStage::Ready,
            deadline: now + EQUIPMENT_STEP_TIMEOUT,
            resume_combat: false,
            wield: WieldRequest::Whole,
        }
    }

    fn confirm_unequip(world: &mut WorldState, item: Guid, placement: u32) {
        event(
            world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: item,
                container_guid: PLAYER,
                slot: placement,
                container_type: InventoryEntryKind::Item,
            })),
        );
    }

    #[test]
    fn each_unequip_requires_authoritative_confirmation_before_wield() {
        let mut world = outfit(2, 1);
        let now = Instant::now();
        let mut operation = operation(&world, now);
        let mut next = operation.advance(&world, now);
        for step in operation.plan.unequips.clone() {
            assert!(
                matches!(next, Ok(EquipmentAdvance::Send(GameAction::PutItemInContainer(data))) if data.item_guid == step.item && data.placement == step.placement)
            );
            assert!(matches!(
                operation.advance(&world, now),
                Ok(EquipmentAdvance::Waiting)
            ));
            confirm_unequip(&mut world, step.item, step.placement);
            next = operation.advance(&world, now);
        }
        assert!(
            matches!(next, Ok(EquipmentAdvance::Send(GameAction::GetAndWieldItem(data))) if data.item_guid == INCOMING)
        );
        assert!(matches!(
            operation.advance(&world, now),
            Ok(EquipmentAdvance::Waiting)
        ));
        event(
            &mut world,
            GameEvent::WieldObject(Box::new(WieldObjectEventData {
                object_guid: INCOMING,
                equip_mask: operation.plan.target,
            })),
        );
        assert!(matches!(
            operation.advance(&world, now),
            Ok(EquipmentAdvance::Complete)
        ));
    }

    #[test]
    fn split_completion_waits_for_source_remainder_and_new_equipped_identity() {
        use holtburger_common::properties::PropertyInt;
        use holtburger_world::entity::Entity;
        let mut world = outfit(2, 1);
        let now = Instant::now();
        let mut pending = operation(&world, now);
        const TEMPLATE: u32 = 123;
        const SPLIT_AMOUNT: u32 = 4;
        const REMAINDER: u32 = 6;
        const NEW_ITEM: Guid = Guid(20);
        pending.wield = WieldRequest::Split {
            amount: SPLIT_AMOUNT,
            wcid: TEMPLATE,
            source_remaining: REMAINDER,
            previous_equipment: world.iter_equipment().collect(),
        };
        let source = world.entities.get_mut(INCOMING).expect("source stack");
        source
            .properties
            .ints
            .insert(PropertyInt::StackSize, (SPLIT_AMOUNT + REMAINDER) as i32);
        let mut split = Entity::new(NEW_ITEM, "Split item".into(), Default::default());
        split.wcid = Some(TEMPLATE);
        split
            .properties
            .ints
            .insert(PropertyInt::StackSize, SPLIT_AMOUNT as i32);
        world.entities.insert(split);
        event(
            &mut world,
            GameEvent::WieldObject(Box::new(WieldObjectEventData {
                object_guid: NEW_ITEM,
                equip_mask: pending.plan.target,
            })),
        );
        assert!(!pending.wielded(&world));
        world
            .entities
            .get_mut(INCOMING)
            .expect("source stack")
            .properties
            .ints
            .insert(PropertyInt::StackSize, REMAINDER as i32);
        assert!(pending.wielded(&world));
    }

    #[test]
    fn timeout_is_uncertain_and_does_not_send_the_next_step() {
        let world = outfit(2, 1);
        let now = Instant::now();
        let mut operation = operation(&world, now);
        assert!(matches!(
            operation.advance(&world, now),
            Ok(EquipmentAdvance::Send(_))
        ));
        let error = match operation.advance(&world, now + EQUIPMENT_STEP_TIMEOUT) {
            Err(error) => error,
            _ => panic!("unconfirmed operation should time out"),
        };
        assert!(error.contains("may still complete"));
        assert_eq!(operation.completed, 0);
    }

    #[test]
    fn external_capacity_change_invalidates_the_remaining_plan() {
        let mut world = outfit(2, 1);
        let now = Instant::now();
        let mut operation = operation(&world, now);
        confirm_unequip(&mut world, Guid(9), 0);
        assert!(operation.advance(&world, now).is_err());
        assert_eq!(operation.completed, 0);
    }
    #[test]
    fn rejection_only_retires_the_request_currently_awaiting_confirmation() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        let now = Instant::now();
        let mut pending = operation(&client.world, now);
        assert!(matches!(
            pending.advance(&client.world, now),
            Ok(EquipmentAdvance::Send(_))
        ));
        let awaiting = pending.awaiting_item();
        client.equipment_operation = Some(pending);
        client.reject_equipment_item(Guid(99));
        assert!(client.equipment_operation.is_some());
        client.reject_equipment_item(awaiting);
        assert!(client.equipment_operation.is_none());
    }

    #[test]
    fn rejection_after_one_unequip_preserves_the_confirmed_world_change() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        let now = Instant::now();
        let mut pending = operation(&client.world, now);
        let first = pending.plan.unequips[0].clone();
        assert!(matches!(
            pending.advance(&client.world, now),
            Ok(EquipmentAdvance::Send(_))
        ));
        confirm_unequip(&mut client.world, first.item, first.placement);
        assert!(matches!(
            pending.advance(&client.world, now),
            Ok(EquipmentAdvance::Send(_))
        ));
        let rejected = pending.awaiting_item();
        client.equipment_operation = Some(pending);
        client.reject_equipment_item(rejected);
        assert!(client.equipment_operation.is_none());
        assert!(matches!(
            client.world.storage_location(first.item),
            Some(StorageLocation::Contained { parent: PLAYER, .. })
        ));
    }

    #[tokio::test]
    async fn another_equipment_request_cannot_replace_the_pending_owner() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        client.equipment_operation = Some(operation(&client.world, Instant::now()));
        client
            .start_equipment_change(Guid(99), None, None)
            .await
            .expect("busy rejection");
        assert_eq!(
            client
                .equipment_operation
                .as_ref()
                .expect("original request")
                .plan
                .item,
            INCOMING
        );
    }

    #[tokio::test]
    async fn weapon_change_restores_only_explicit_active_combat_modes() {
        for mode in [
            None,
            Some(CombatMode::Undef),
            Some(CombatMode::NonCombat),
            Some(CombatMode::Melee),
            Some(CombatMode::Missile),
            Some(CombatMode::Magic),
        ] {
            let mut client = super::super::builder::build_test_client(ClientState::InWorld);
            client.world = outfit(2, 1);
            if let Some(mode) = mode {
                client
                    .world
                    .entities
                    .get_mut(PLAYER)
                    .expect("player")
                    .properties
                    .ints
                    .insert(PropertyInt::CombatMode, mode as i32);
            }
            let item = client
                .world
                .entities
                .get_mut(INCOMING)
                .expect("incoming weapon");
            item.properties.ints.insert(
                PropertyInt::ValidLocations,
                EquipMask::MELEE_WEAPON.bits() as i32,
            );
            item.properties.ints.insert(
                PropertyInt::ItemType,
                holtburger_common::properties::ItemType::MELEE_WEAPON.bits() as i32,
            );
            client
                .start_equipment_change(INCOMING, None, None)
                .await
                .expect("weapon change");
            let operation = client
                .equipment_operation
                .as_ref()
                .expect("pending weapon change");
            let active = matches!(
                mode,
                Some(CombatMode::Melee | CombatMode::Missile | CombatMode::Magic)
            );
            assert_eq!(operation.resume_combat, active, "initial mode: {mode:?}");
            assert_eq!(
                matches!(operation.stage, EquipmentStage::Peace),
                active,
                "initial mode: {mode:?}"
            );
        }
    }

    #[tokio::test]
    async fn manual_combat_change_retires_pending_restoration() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        let mut pending = operation(&client.world, Instant::now());
        pending.stage = EquipmentStage::Restore(CombatMode::Melee);
        client.equipment_operation = Some(pending);
        client
            .handle_command(super::super::ClientCommand::SetCombatMode(
                CombatMode::NonCombat,
            ))
            .await
            .expect("manual combat request");
        assert!(client.equipment_operation.is_none());
    }

    #[test]
    fn disconnect_retires_the_owner_before_late_equipment_updates() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        let pending = operation(&client.world, Instant::now());
        let mask = pending.plan.target;
        client.equipment_operation = Some(pending);
        client.set_exit_cause(super::super::types::ClientExitCause::ExplicitDisconnect);
        event(
            &mut client.world,
            GameEvent::WieldObject(Box::new(WieldObjectEventData {
                object_guid: INCOMING,
                equip_mask: mask,
            })),
        );
        assert!(client.equipment_operation.is_none());
        assert_eq!(client.world.equipment_mask(INCOMING), Some(mask));
    }

    #[test]
    fn peace_is_confirmed_before_the_first_inventory_mutation() {
        use holtburger_common::properties::PropertyInt;
        let mut world = outfit(2, 1);
        world
            .entities
            .get_mut(PLAYER)
            .expect("player")
            .properties
            .ints
            .insert(PropertyInt::CombatMode, CombatMode::Melee as i32);
        let now = Instant::now();
        let mut pending = operation(&world, now);
        pending.stage = EquipmentStage::Peace;
        assert!(matches!(
            pending.advance(&world, now),
            Ok(EquipmentAdvance::Waiting)
        ));
        world
            .entities
            .get_mut(PLAYER)
            .expect("player")
            .properties
            .ints
            .insert(PropertyInt::CombatMode, CombatMode::NonCombat as i32);
        assert!(matches!(
            pending.advance(&world, now),
            Ok(EquipmentAdvance::Send(GameAction::PutItemInContainer(_)))
        ));
    }
}
