//! One authority for equipment command ordering and server-confirmed progress.

use super::{
    ClientRuntime, ClientState,
    equipment_plan::{EquipmentPlan, plan_equipment_change},
    types::{ActionResultReason, ActionResultSource, TargetSlot},
};
use anyhow::Result;
use holtburger_common::{Guid, properties::EquipMask};
use holtburger_protocol::messages::{
    combat::CombatMode,
    game_action::{
        ChangeCombatModeActionData, GameAction, GetAndWieldItemActionData,
        PutItemInContainerActionData,
    },
};
use holtburger_world::{
    WorldState,
    context::{WorldContext, WorldContextExt},
    equipment::MAIN_HAND_LOCATIONS,
    state::storage::{StorageLocation, StorageSlot},
};
use std::time::{Duration, Instant};

/// Deadline applies to each server-confirmed step, not total outfit size.
pub(super) const EQUIPMENT_STEP_TIMEOUT: Duration = Duration::from_secs(10);

/// The current request awaiting an authoritative world consequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EquipmentStage {
    Ready,
    Peace,
    Unequip,
    Wield,
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
}

/// Advance either waits, sends a dependent step, or sends the final request.
enum EquipmentAdvance {
    Waiting,
    Send(GameAction),
    /// Release ownership when sending; no later request depends on this result.
    SendFinal(GameAction),
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
        world
            .player_equipment()
            .any(|(guid, mask)| guid == self.plan.item && mask == self.plan.target)
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
                let mode = world.get_suggested_combat_mode();
                return Ok(EquipmentAdvance::SendFinal(GameAction::ChangeCombatMode(
                    Box::new(ChangeCombatModeActionData { mode }),
                )));
            }
            _ => {}
        }
        if self.stage != EquipmentStage::Ready {
            if now >= self.deadline {
                return Err("Timed out waiting for the server; the last equipment request may still complete".into());
            }
            return Ok(EquipmentAdvance::Waiting);
        }
        let current = plan_equipment_change(
            world,
            self.plan.item,
            Some(TargetSlot::EquipMask(self.plan.target)),
            self.plan.insertion,
            &self.plan.storage,
        )
        .map_err(|error| error.to_string())?;
        // Conflict removals can prepend into the source pack and shift its index.
        // Wielding depends on the ownership relationship, not its position in that pack.
        let source_unchanged = match (current.source, self.plan.source) {
            (
                StorageLocation::Contained {
                    parent: current, ..
                },
                StorageLocation::Contained {
                    parent: original, ..
                },
            ) => current == original,
            (current, original) => current == original,
        };
        if !source_unchanged
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
        let action = GameAction::GetAndWieldItem(Box::new(GetAndWieldItemActionData {
            item_guid: self.plan.item,
            equip_mask: self.plan.target,
        }));
        Ok(if self.resume_combat {
            EquipmentAdvance::Send(action)
        } else {
            EquipmentAdvance::SendFinal(action)
        })
    }
}

impl ClientRuntime {
    pub(super) fn stop_equipment_change(&mut self, reason: &str) {
        if let Some(operation) = self.portal.equipment_operation.take() {
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
            .portal
            .equipment_operation
            .as_ref()
            .is_some_and(|operation| operation.awaiting_item() == item)
        {
            self.stop_equipment_change("Server rejected the equipment request");
        }
    }

    /// Consumes the admitted plan without discarding its resolved destinations.
    /// Callers must perform lifecycle/busy admission before entering this path.
    pub(super) async fn start_planned_equipment_change(
        &mut self,
        plan: EquipmentPlan,
    ) -> Result<()> {
        if self.world.equipment_mask(plan.item) == Some(plan.target) {
            return Ok(());
        }
        let now = Instant::now();
        // Only explicit active modes need restoration; an absent login property means peace.
        let resume_combat = matches!(
            self.world.player_combat_mode(),
            CombatMode::Melee | CombatMode::Missile | CombatMode::Magic
        ) && plan
            .target
            .intersects(MAIN_HAND_LOCATIONS | EquipMask::SHIELD | EquipMask::MISSILE_AMMO);
        self.portal.equipment_operation = Some(EquipmentOperation {
            plan,
            completed: 0,
            stage: if resume_combat {
                EquipmentStage::Peace
            } else {
                EquipmentStage::Ready
            },
            deadline: now + EQUIPMENT_STEP_TIMEOUT,
            resume_combat,
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
        if !matches!(self.conn.state, ClientState::InWorld) || self.portal.activation.is_some() {
            self.stop_equipment_change("World lifecycle changed");
            return Ok(());
        }
        let Some(operation) = self.portal.equipment_operation.as_mut() else {
            return Ok(());
        };
        match operation.advance(&self.world, now) {
            Ok(EquipmentAdvance::Waiting) => {}
            Ok(EquipmentAdvance::Send(action)) => self.send_game_action(action).await?,
            Ok(EquipmentAdvance::SendFinal(action)) => {
                self.portal.equipment_operation = None;
                self.send_game_action(action).await?;
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
    use crate::client::equipment_plan::tests::storage_policy;
    use crate::client::inventory_storage::InventoryInsertion;
    use holtburger_common::properties::{InventoryEntryKind, PropertyInt};
    use holtburger_protocol::messages::{
        GameEvent, InventoryPutObjInContainerEventData, WieldObjectEventData,
    };

    const PLAYER: Guid = Guid(1);
    const INCOMING: Guid = Guid(3);

    fn operation(world: &WorldState, now: Instant) -> EquipmentOperation {
        EquipmentOperation {
            plan: plan_equipment_change(
                world,
                INCOMING,
                None,
                InventoryInsertion::Append,
                &storage_policy(world),
            )
            .expect("complete outfit plan"),
            completed: 0,
            stage: EquipmentStage::Ready,
            deadline: now + EQUIPMENT_STEP_TIMEOUT,
            resume_combat: false,
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
        for insertion in [InventoryInsertion::Append, InventoryInsertion::Prepend] {
            let mut world = outfit(2, 1);
            let now = Instant::now();
            let mut operation = operation(&world, now);
            operation.plan =
                plan_equipment_change(&world, INCOMING, None, insertion, &storage_policy(&world))
                    .unwrap();
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
                matches!(next, Ok(EquipmentAdvance::SendFinal(GameAction::GetAndWieldItem(data))) if data.item_guid == INCOMING)
            );
        }
    }

    #[test]
    fn prepending_to_preferred_pack_retains_policy_during_revalidation() {
        let mut world = outfit(2, 3);
        let now = Instant::now();
        let mut pending = operation(&world, now);
        let mut storage = storage_policy(&world);
        let source_parent = pending.plan.source.parent();
        storage.preferred = world
            .player_equipment()
            .map(|(item, _)| (item, source_parent))
            .collect();
        pending.plan = plan_equipment_change(
            &world,
            INCOMING,
            None,
            InventoryInsertion::Prepend,
            &storage,
        )
        .unwrap();
        let source_parent = pending.plan.source.parent();
        for step in pending.plan.unequips.clone() {
            assert_eq!(step.container, source_parent);
            assert_eq!(step.placement, 0);
            assert!(matches!(
                pending.advance(&world, now),
                Ok(EquipmentAdvance::Send(_))
            ));
            event(
                &mut world,
                GameEvent::InventoryPutObjInContainer(Box::new(
                    InventoryPutObjInContainerEventData {
                        item_guid: step.item,
                        container_guid: step.container,
                        slot: step.placement,
                        container_type: InventoryEntryKind::Item,
                    },
                )),
            );
        }
        assert!(matches!(
            pending.advance(&world, now),
            Ok(EquipmentAdvance::SendFinal(GameAction::GetAndWieldItem(_)))
        ));
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
        client.portal.equipment_operation = Some(pending);
        client.reject_equipment_item(Guid(99));
        assert!(client.portal.equipment_operation.is_some());
        client.reject_equipment_item(awaiting);
        assert!(client.portal.equipment_operation.is_none());
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
        client.portal.equipment_operation = Some(pending);
        client.reject_equipment_item(rejected);
        assert!(client.portal.equipment_operation.is_none());
        assert!(matches!(
            client.world.storage_location(first.item),
            Some(StorageLocation::Contained { parent: PLAYER, .. })
        ));
    }

    #[tokio::test]
    async fn salvage_during_equipment_change_gets_its_correlated_rejection() {
        use super::super::{
            salvage::{
                SalvagePreviewEvaluation, SalvagePreviewRequest, SalvageSubmitOutcome,
                SalvageSubmitRequest, SalvageToolSelection,
            },
            types::{ClientCommand, ClientViewEvent},
        };
        use holtburger_common::properties::{MaterialType, WorldObjectPropertyAccessorsMut};
        use holtburger_world::{crafting::salvage::UST_WCID, entity::Entity};
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(4, 1);
        let item = client.world.entities.get_mut(INCOMING).unwrap();
        item.set_int_prop(PropertyInt::MaterialType, MaterialType::Steel as i32);
        item.set_int_prop(PropertyInt::ItemWorkmanship, 7);
        item.set_int_prop(PropertyInt::NumItemsInMaterial, 1);
        let mut ust = Entity::new(Guid(900), "Ust".into(), Default::default());
        ust.wcid = Some(UST_WCID);
        client.world.add_entity(ust);
        confirm_unequip(&mut client.world, Guid(900), 3);
        let mut replies = client.client_view_event_tx.subscribe();
        client
            .handle_command(ClientCommand::PreviewSalvage(SalvagePreviewRequest {
                sequence: 1,
                player: PLAYER,
                tool: SalvageToolSelection::Discover { preferred: None },
                items: vec![INCOMING],
            }))
            .await
            .unwrap();
        let ClientViewEvent::SalvagePreview(preview) = replies.try_recv().unwrap() else {
            panic!("expected salvage preview");
        };
        let SalvagePreviewEvaluation::Ready { revision, .. } = preview.evaluation else {
            panic!("expected ready source");
        };
        client.portal.equipment_operation = Some(operation(&client.world, Instant::now()));
        client
            .handle_command(ClientCommand::SubmitSalvage(SalvageSubmitRequest {
                sequence: 1,
                revision,
            }))
            .await
            .unwrap();
        let ClientViewEvent::SalvageSubmitted(result) = replies.try_recv().unwrap() else {
            panic!("expected correlated salvage result");
        };
        assert!(
            matches!(result.outcome, SalvageSubmitOutcome::Rejected { reason } if reason == "An inventory change is still pending.")
        );
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[tokio::test]
    async fn another_equipment_request_cannot_replace_the_pending_owner() {
        use super::super::inventory_plan::{InventoryIntent, InventoryTarget};
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        client.portal.equipment_operation = Some(operation(&client.world, Instant::now()));
        client
            .submit_inventory_intent(
                InventoryIntent {
                    item: Guid(99),
                    target: InventoryTarget::EquipPreferred { alternate: false },
                },
                &storage_policy(&client.world),
            )
            .await
            .expect("busy rejection");
        assert_eq!(
            client
                .portal
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
        use super::super::inventory_plan::{InventoryIntent, InventoryTarget};
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
                .submit_inventory_intent(
                    InventoryIntent {
                        item: INCOMING,
                        target: InventoryTarget::EquipPreferred { alternate: false },
                    },
                    &storage_policy(&client.world),
                )
                .await
                .expect("weapon change");
            let active = matches!(
                mode,
                Some(CombatMode::Melee | CombatMode::Missile | CombatMode::Magic)
            );
            if active {
                let operation = client
                    .portal
                    .equipment_operation
                    .as_ref()
                    .expect("peace before wield");
                assert!(operation.resume_combat);
                assert_eq!(operation.stage, EquipmentStage::Peace);
            } else {
                assert!(
                    client.portal.equipment_operation.is_none(),
                    "single wield needs no continuation: {mode:?}"
                );
            }
        }
    }

    #[tokio::test]
    async fn combat_toggle_preserves_pending_equipment_restoration() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        let mut pending = operation(&client.world, Instant::now());
        pending.stage = EquipmentStage::Wield;
        pending.resume_combat = true;
        client.portal.equipment_operation = Some(pending);
        client
            .handle_command(super::super::ClientCommand::ToggleCombatMode)
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(
            client
                .portal
                .equipment_operation
                .as_ref()
                .unwrap()
                .resume_combat
        );
    }

    #[tokio::test]
    async fn manual_combat_change_retires_pending_restoration() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        let mut pending = operation(&client.world, Instant::now());
        pending.stage = EquipmentStage::Wield;
        pending.resume_combat = true;
        client.portal.equipment_operation = Some(pending);
        client
            .handle_command(super::super::ClientCommand::SetCombatMode(
                CombatMode::NonCombat,
            ))
            .await
            .expect("manual combat request");
        assert!(client.portal.equipment_operation.is_none());
    }

    #[test]
    fn disconnect_retires_the_owner_before_late_equipment_updates() {
        let mut client = super::super::builder::build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        let pending = operation(&client.world, Instant::now());
        let mask = pending.plan.target;
        client.portal.equipment_operation = Some(pending);
        client.set_exit_cause(super::super::types::ClientExitCause::ExplicitDisconnect);
        event(
            &mut client.world,
            GameEvent::WieldObject(Box::new(WieldObjectEventData {
                object_guid: INCOMING,
                equip_mask: mask,
            })),
        );
        assert!(client.portal.equipment_operation.is_none());
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
