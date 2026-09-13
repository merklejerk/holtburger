//! Serializes native inventory requests and waits for their authoritative consequences.

use super::{
    ClientRuntime,
    inventory_plan::{InventoryIntent, InventoryMove, InventoryPlan},
    types::{ActionResultReason, ActionResultSource},
};
use anyhow::Result;
use holtburger_common::{Guid, properties::WorldObjectExt};
use holtburger_protocol::messages::game_action::{
    GameAction, PutItemInContainerActionData, StackableMergeActionData,
    StackableSplitToContainerActionData,
};
use holtburger_world::{
    WorldState,
    state::storage::{StorageLocation, StorageSlot},
};
use std::time::{Duration, Instant};

/// Each request gets its own deadline; a timeout cannot prove that the server rejected it.
const INVENTORY_STEP_TIMEOUT: Duration = Duration::from_secs(10);

/// The exact fact which acknowledges the one request currently in flight.
#[derive(Debug)]
enum InventoryConfirmation {
    Move(InventoryMove),
    Split {
        step: InventoryMove,
        amount: u32,
        source_remaining: u32,
        wcid: u32,
        previous_items: Vec<Guid>,
    },
    Merge {
        source: Guid,
        destination: Guid,
        source_remaining: u32,
        destination_quantity: u32,
    },
}

/// Only pack exchanges have a second native request.
#[derive(Debug)]
struct RemainingPackMove {
    step: InventoryMove,
    /// Expected target position after the first insertion removes and shifts its source.
    expected_location: StorageLocation,
}

/// One admitted move/merge/split/exchange, mutually exclusive with equipment orchestration.
#[derive(Debug)]
pub(super) struct InventoryOperation {
    awaiting: InventoryConfirmation,
    remaining: Option<RemainingPackMove>,
    deadline: Instant,
    /// Report partial pack exchanges honestly on cancellation or rejection.
    completed: usize,
}

fn move_action(step: InventoryMove) -> GameAction {
    GameAction::PutItemInContainer(Box::new(PutItemInContainerActionData {
        item_guid: step.item,
        container_guid: step.container,
        placement: step.placement,
    }))
}

impl InventoryConfirmation {
    fn item(&self) -> Guid {
        match self {
            Self::Move(step) | Self::Split { step, .. } => step.item,
            Self::Merge { source, .. } => *source,
        }
    }

    fn confirmed(&self, world: &WorldState) -> bool {
        match self {
            Self::Split { step, amount, source_remaining, wcid, previous_items } => {
                world.entities.get(step.item).is_some_and(|entity| entity.stack_size() == *source_remaining)
                    && world.container_contents(step.container).any(|(guid, slot)| {
                        guid != step.item && !previous_items.contains(&guid)
                            && matches!(slot, StorageSlot::Item { index } | StorageSlot::Pack { index, .. } if index == step.placement)
                            && world.entities.get(guid).is_some_and(|entity| entity.wcid == Some(*wcid) && entity.stack_size() == *amount)
                    })
            }
            Self::Move(step) => matches!(world.storage_location(step.item),
                Some(StorageLocation::Contained { parent, slot: StorageSlot::Item { index } | StorageSlot::Pack { index, .. } })
                if parent == step.container && index == step.placement),
            Self::Merge {
                source,
                destination,
                source_remaining,
                destination_quantity,
            } => {
                let source_confirmed = if *source_remaining == 0 {
                    world.storage_location(*source).is_none()
                } else {
                    world
                        .entities
                        .get(*source)
                        .is_some_and(|entity| entity.stack_size() == *source_remaining)
                };
                source_confirmed
                    && world
                        .entities
                        .get(*destination)
                        .is_some_and(|entity| entity.stack_size() == *destination_quantity)
            }
        }
    }
}

impl ClientRuntime {
    pub(super) fn stop_inventory_change(&mut self, reason: &str) {
        if let Some(operation) = self.inventory_operation.take() {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(format!(
                    "Inventory change stopped after {} confirmed step(s): {reason}",
                    operation.completed
                )),
            );
        }
    }

    pub(super) fn reject_inventory_item(&mut self, item: Guid) {
        if self
            .inventory_operation
            .as_ref()
            .is_some_and(|operation| operation.awaiting.item() == item)
        {
            self.stop_inventory_change("Server rejected the inventory request");
        }
    }

    pub(super) async fn submit_inventory_intent(&mut self, intent: InventoryIntent) -> Result<()> {
        let plan = match self.evaluate_inventory_intent(intent) {
            Ok(plan) => plan,
            Err(reason) => {
                self.emit_action_result(
                    ActionResultSource::Client,
                    ActionResultReason::General(reason),
                );
                return Ok(());
            }
        };
        let (action, awaiting, remaining) = match plan {
            InventoryPlan::Split {
                step,
                amount,
                source_remaining,
                wcid,
                ..
            } => (
                GameAction::StackableSplitToContainer(Box::new(
                    StackableSplitToContainerActionData {
                        stack_guid: step.item,
                        container_guid: step.container,
                        place: step.placement as i32,
                        amount: amount as i32,
                    },
                )),
                InventoryConfirmation::Split {
                    step,
                    amount,
                    source_remaining,
                    wcid,
                    previous_items: self
                        .world
                        .container_contents(step.container)
                        .map(|(guid, _)| guid)
                        .collect(),
                },
                None,
            ),
            InventoryPlan::Noop => return Ok(()),
            InventoryPlan::Equip(plan) => {
                return self.start_planned_equipment_change(plan, None).await;
            }
            InventoryPlan::Move(step) => {
                (move_action(step), InventoryConfirmation::Move(step), None)
            }
            InventoryPlan::Merge {
                source,
                destination,
                amount,
            } => {
                let quantities = self
                    .world
                    .entities
                    .get(source)
                    .zip(self.world.entities.get(destination));
                let Some((source_entity, destination_entity)) = quantities else {
                    anyhow::bail!("Resolved merge entities disappeared without a world mutation");
                };
                (
                    GameAction::StackableMerge(Box::new(StackableMergeActionData {
                        merge_from_guid: source,
                        merge_to_guid: destination,
                        amount: amount as i32,
                    })),
                    InventoryConfirmation::Merge {
                        source,
                        destination,
                        source_remaining: source_entity.stack_size() - amount,
                        destination_quantity: destination_entity.stack_size() + amount,
                    },
                    None,
                )
            }
            InventoryPlan::Swap { first, second } => {
                let Some(StorageLocation::Contained {
                    parent,
                    slot: StorageSlot::Pack { index, kind },
                }) = self.world.storage_location(second.item)
                else {
                    anyhow::bail!("Resolved pack target disappeared without a world mutation");
                };
                let expected_index = if second.placement < first.placement {
                    index - 1
                } else {
                    index + 1
                };
                (
                    move_action(first),
                    InventoryConfirmation::Move(first),
                    Some(RemainingPackMove {
                        step: second,
                        expected_location: StorageLocation::Contained {
                            parent,
                            slot: StorageSlot::Pack {
                                index: expected_index,
                                kind,
                            },
                        },
                    }),
                )
            }
        };
        self.inventory_operation = Some(InventoryOperation {
            awaiting,
            remaining,
            deadline: Instant::now() + INVENTORY_STEP_TIMEOUT,
            completed: 0,
        });
        self.send_game_action(action).await
    }

    pub(super) async fn advance_inventory_change(&mut self, now: Instant) -> Result<()> {
        let Some(operation) = self.inventory_operation.as_mut() else {
            return Ok(());
        };
        if !operation.awaiting.confirmed(&self.world) {
            if now >= operation.deadline {
                self.stop_inventory_change(
                    "Timed out waiting for the server; the last request may still complete",
                );
            }
            return Ok(());
        }
        operation.completed += 1;
        let Some(remaining) = operation.remaining.take() else {
            self.inventory_operation = None;
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General("Inventory change completed".into()),
            );
            return Ok(());
        };
        if self.world.storage_location(remaining.step.item) != Some(remaining.expected_location) {
            self.stop_inventory_change("Pack positions changed during the exchange");
            return Ok(());
        }
        operation.awaiting = InventoryConfirmation::Move(remaining.step);
        operation.deadline = now + INVENTORY_STEP_TIMEOUT;
        self.send_game_action(move_action(remaining.step)).await
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        ClientState,
        builder::build_test_client,
        equipment_plan::tests::{event, outfit},
    };
    use super::*;
    use holtburger_common::properties::InventoryEntryKind;
    use holtburger_protocol::messages::{GameEvent, InventoryPutObjInContainerEventData};

    const PLAYER: Guid = Guid(1);
    const SOURCE: Guid = Guid(2);
    const TARGET: Guid = Guid(9);

    fn place(world: &mut WorldState, item: Guid, index: u32) {
        event(
            world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: item,
                container_guid: PLAYER,
                slot: index,
                container_type: InventoryEntryKind::Container,
            })),
        );
    }

    fn pending_swap(client: &mut ClientRuntime, now: Instant) {
        client.world = outfit(2, 1);
        place(&mut client.world, TARGET, 4);
        client.inventory_operation = Some(InventoryOperation {
            awaiting: InventoryConfirmation::Move(InventoryMove {
                item: SOURCE,
                container: PLAYER,
                placement: 4,
            }),
            remaining: Some(RemainingPackMove {
                step: InventoryMove {
                    item: TARGET,
                    container: PLAYER,
                    placement: 0,
                },
                expected_location: StorageLocation::Contained {
                    parent: PLAYER,
                    slot: StorageSlot::Pack {
                        index: 3,
                        kind: holtburger_world::state::storage::PackEntryKind::Container,
                    },
                },
            }),
            deadline: now + INVENTORY_STEP_TIMEOUT,
            completed: 0,
        });
    }

    #[tokio::test]
    async fn pack_exchange_waits_and_timeout_does_not_release_its_second_move() {
        let mut client = build_test_client(ClientState::InWorld);
        let now = Instant::now();
        pending_swap(&mut client, now);
        client.advance_inventory_change(now).await.expect("waiting");
        let pending = client.inventory_operation.as_ref().expect("still waiting");
        assert_eq!(pending.completed, 0);
        assert!(pending.remaining.is_some());
        client
            .advance_inventory_change(now + INVENTORY_STEP_TIMEOUT)
            .await
            .expect("timeout");
        assert!(client.inventory_operation.is_none());
    }

    #[tokio::test]
    async fn pack_exchange_confirms_both_moves_and_ignores_duplicate_first_confirmation() {
        let mut client = build_test_client(ClientState::InWorld);
        let now = Instant::now();
        pending_swap(&mut client, now);
        place(&mut client.world, SOURCE, 4);
        client
            .advance_inventory_change(now)
            .await
            .expect("second request");
        assert_eq!(
            client
                .inventory_operation
                .as_ref()
                .expect("second move pending")
                .completed,
            1
        );
        place(&mut client.world, SOURCE, 4);
        client
            .advance_inventory_change(now)
            .await
            .expect("duplicate update");
        assert!(client.inventory_operation.is_some());
        place(&mut client.world, TARGET, 0);
        client
            .advance_inventory_change(now)
            .await
            .expect("exchange complete");
        assert!(client.inventory_operation.is_none());
        assert!(matches!(
            client.world.storage_location(SOURCE),
            Some(StorageLocation::Contained {
                slot: StorageSlot::Pack { index: 4, .. },
                ..
            })
        ));
        assert!(matches!(
            client.world.storage_location(TARGET),
            Some(StorageLocation::Contained {
                slot: StorageSlot::Pack { index: 0, .. },
                ..
            })
        ));
    }

    #[tokio::test]
    async fn changed_pack_target_stops_after_first_confirmed_move() {
        let mut client = build_test_client(ClientState::InWorld);
        let now = Instant::now();
        pending_swap(&mut client, now);
        place(&mut client.world, SOURCE, 4);
        // A different actor moves the target after the first request succeeded.
        place(&mut client.world, TARGET, 1);
        client
            .advance_inventory_change(now)
            .await
            .expect("local rejection");
        assert!(client.inventory_operation.is_none());
    }

    #[test]
    fn moving_the_original_half_stack_cannot_confirm_a_new_split_identity() {
        use holtburger_common::properties::PropertyInt;
        let mut world = outfit(2, 1);
        let source = world.entities.get_mut(Guid(3)).expect("source");
        source.wcid = Some(99);
        source.properties.ints.insert(PropertyInt::StackSize, 7);
        let confirmation = InventoryConfirmation::Split {
            step: InventoryMove {
                item: Guid(3),
                container: PLAYER,
                placement: 0,
            },
            amount: 7,
            source_remaining: 7,
            wcid: 99,
            previous_items: Vec::new(),
        };
        event(
            &mut world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: Guid(3),
                container_guid: PLAYER,
                slot: 0,
                container_type: InventoryEntryKind::Item,
            })),
        );
        assert!(!confirmation.confirmed(&world));
    }

    #[test]
    fn split_confirmation_requires_new_identity_and_source_remainder() {
        use holtburger_common::properties::PropertyInt;
        let mut world = outfit(2, 1);
        let step = InventoryMove {
            item: Guid(3),
            container: PLAYER,
            placement: 0,
        };
        let confirmation = InventoryConfirmation::Split {
            step,
            amount: 7,
            source_remaining: 13,
            wcid: 99,
            previous_items: vec![Guid(4)],
        };
        let mut new_stack =
            holtburger_world::entity::Entity::new(Guid(99), "New stack".into(), Default::default());
        new_stack.wcid = Some(99);
        new_stack.properties.ints.insert(PropertyInt::StackSize, 7);
        world.entities.insert(new_stack);
        event(
            &mut world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: Guid(99),
                container_guid: PLAYER,
                slot: 0,
                container_type: InventoryEntryKind::Item,
            })),
        );
        assert!(!confirmation.confirmed(&world));
        world
            .entities
            .get_mut(Guid(3))
            .expect("source")
            .properties
            .ints
            .insert(PropertyInt::StackSize, 13);
        assert!(confirmation.confirmed(&world));
        let old_identity = InventoryConfirmation::Split {
            step,
            amount: 7,
            source_remaining: 13,
            wcid: 99,
            previous_items: vec![Guid(99)],
        };
        assert!(!old_identity.confirmed(&world));
    }

    #[test]
    fn merge_confirmation_requires_both_quantity_consequences() {
        use holtburger_common::properties::PropertyInt;
        let mut world = outfit(2, 1);
        const STACK: Guid = Guid(3);
        const DESTINATION: Guid = Guid(4);
        let confirmation = InventoryConfirmation::Merge {
            source: STACK,
            destination: DESTINATION,
            source_remaining: 5,
            destination_quantity: 100,
        };
        world
            .entities
            .get_mut(DESTINATION)
            .expect("destination")
            .properties
            .ints
            .insert(PropertyInt::StackSize, 100);
        assert!(!confirmation.confirmed(&world));
        world
            .entities
            .get_mut(STACK)
            .expect("source")
            .properties
            .ints
            .insert(PropertyInt::StackSize, 5);
        assert!(confirmation.confirmed(&world));
    }
}
