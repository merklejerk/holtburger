//! Sends standalone inventory requests and sequences dependent pack exchanges.

use super::{
    ClientRuntime,
    inventory_plan::{InventoryIntent, InventoryMove, InventoryPlan},
    types::{ActionResultReason, ActionResultSource},
};
use anyhow::Result;
use holtburger_common::Guid;
use holtburger_protocol::messages::game_action::{
    DropItemActionData, GameAction, GiveObjectRequestActionData, PutItemInContainerActionData,
    StackableMergeActionData, StackableSplitToContainerActionData,
};
use holtburger_world::state::storage::{StorageLocation, StorageSlot};
use std::time::{Duration, Instant};

/// Abandons the unsent continuation; the first request can still complete later.
const PACK_EXCHANGE_TIMEOUT: Duration = Duration::from_secs(10);

/// Second insertion and the target location required before sending it.
#[derive(Debug)]
struct RemainingPackMove {
    /// Exact second insertion resolved by the planner.
    step: InventoryMove,
    /// Target position after the first insertion shifts native indices.
    expected_location: StorageLocation,
}

/// Only a dependent pack exchange owns an inventory interaction lock.
#[derive(Debug)]
pub(super) struct PackExchange {
    /// First insertion whose authoritative result permits the second request.
    awaiting: InventoryMove,
    /// Unsent insertion, revalidated after the first completes.
    remaining: RemainingPackMove,
    /// Deadline for abandoning the continuation without canceling server work.
    deadline: Instant,
}

fn move_action(step: InventoryMove) -> GameAction {
    GameAction::PutItemInContainer(Box::new(PutItemInContainerActionData {
        item_guid: step.item,
        container_guid: step.container,
        placement: step.placement,
    }))
}

impl ClientRuntime {
    pub(super) fn stop_pack_exchange(&mut self, reason: &str) {
        if self.pack_exchange.take().is_some() {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(format!("Pack exchange stopped: {reason}")),
            );
        }
    }

    pub(super) fn reject_pack_exchange_item(&mut self, item: Guid) {
        if self
            .pack_exchange
            .as_ref()
            .is_some_and(|operation| operation.awaiting.item == item)
        {
            self.stop_pack_exchange("Server rejected the first pack move");
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
        let action = match plan {
            InventoryPlan::Split { step, amount, .. } => GameAction::StackableSplitToContainer(
                Box::new(StackableSplitToContainerActionData {
                    stack_guid: step.item,
                    container_guid: step.container,
                    place: step.placement as i32,
                    amount: amount as i32,
                }),
            ),
            InventoryPlan::Noop => return Ok(()),
            InventoryPlan::Equip(plan) => {
                return self.start_planned_equipment_change(plan, None).await;
            }
            InventoryPlan::Move(step) => move_action(step),
            InventoryPlan::Give {
                item,
                recipient,
                amount,
            } => GameAction::GiveObjectRequest(Box::new(GiveObjectRequestActionData {
                target_guid: recipient,
                item_guid: item,
                amount,
            })),
            InventoryPlan::Drop { item } => {
                GameAction::DropItem(Box::new(DropItemActionData { item_guid: item }))
            }
            InventoryPlan::Merge {
                source,
                destination,
                amount,
            } => GameAction::StackableMerge(Box::new(StackableMergeActionData {
                merge_from_guid: source,
                merge_to_guid: destination,
                amount: amount as i32,
            })),
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
                self.pack_exchange = Some(PackExchange {
                    awaiting: first,
                    remaining: RemainingPackMove {
                        step: second,
                        expected_location: StorageLocation::Contained {
                            parent,
                            slot: StorageSlot::Pack {
                                index: expected_index,
                                kind,
                            },
                        },
                    },
                    deadline: Instant::now() + PACK_EXCHANGE_TIMEOUT,
                });
                move_action(first)
            }
        };
        self.send_game_action(action).await
    }

    pub(super) async fn advance_pack_exchange(&mut self, now: Instant) -> Result<()> {
        let Some(operation) = self.pack_exchange.as_ref() else {
            return Ok(());
        };
        let step = operation.awaiting;
        let confirmed = matches!(self.world.storage_location(step.item), Some(StorageLocation::Contained { parent, slot: StorageSlot::Pack { index, .. } }) if parent == step.container && index == step.placement);
        if !confirmed {
            if now >= operation.deadline {
                self.stop_pack_exchange(
                    "Timed out waiting for the server; the first request may still complete",
                );
            }
            return Ok(());
        }
        if self.world.storage_location(operation.remaining.step.item)
            != Some(operation.remaining.expected_location)
        {
            self.stop_pack_exchange("Pack positions changed during the exchange");
            return Ok(());
        }
        let action = move_action(operation.remaining.step);
        // Nothing depends on acknowledgment of the final request.
        self.pack_exchange = None;
        self.send_game_action(action).await
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
    use holtburger_common::Vector3;
    use holtburger_common::properties::{
        InventoryEntryKind, PropertyDataId, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::messages::{GameEvent, InventoryPutObjInContainerEventData};
    use holtburger_world::motion::{
        BodyMotionRuntime, CharacterMotionPresentation, MotionCommand, MotionOrder,
    };
    use holtburger_world::state::motion_resolution::test_support::{
        FixtureCycle, explicit_motion_catalog,
    };
    use holtburger_world::{WorldState, context::WorldContext};

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
        client.pack_exchange = Some(PackExchange {
            awaiting: InventoryMove {
                item: SOURCE,
                container: PLAYER,
                placement: 4,
            },
            remaining: RemainingPackMove {
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
            },
            deadline: now + PACK_EXCHANGE_TIMEOUT,
        });
    }

    /// Move during a retained reach through production world arbitration.
    fn move_during_reach(world: &mut WorldState) {
        const TABLE: u32 = 0x0900_0020;
        const REACH: u32 = 0x4000_0018;
        let catalog = explicit_motion_catalog(
            TABLE,
            0x8000_003d,
            [
                FixtureCycle::moving(REACH, Vector3::zero()),
                FixtureCycle::moving(
                    MotionCommand::WALK_FORWARD.raw(),
                    Vector3::new(1.0, 0.0, 0.0),
                ),
            ],
            [],
        );
        let table = catalog.table(TABLE).unwrap();
        let mut runtime = BodyMotionRuntime::new(table);
        runtime.accept_order(
            table,
            MotionOrder {
                forward: Some((MotionCommand(REACH), 1.0)),
                ..Default::default()
            },
        );
        world.set_motion_sequences(catalog);
        world
            .player_entity_mut()
            .unwrap()
            .set_did_prop(PropertyDataId::MotionTable, Guid(TABLE));
        world.motion_runtimes.replace_body(PLAYER, runtime);
        let order = MotionOrder {
            forward: Some((MotionCommand::WALK_FORWARD, 1.0)),
            ..Default::default()
        };
        for _ in 0..3 {
            world
                .drive_manual_motion_for_body(
                    PLAYER,
                    order,
                    CharacterMotionPresentation::Grounded,
                    std::time::Duration::from_millis(100),
                )
                .unwrap();
        }
        assert_eq!(
            world.motion_runtimes.state(PLAYER).unwrap().substate,
            MotionCommand(REACH)
        );
    }

    #[tokio::test]
    async fn pickup_equipped_drop_and_give_emit_the_exact_native_actions() {
        use super::super::inventory_plan::InventoryTarget;
        use byteorder::{LittleEndian, ReadBytesExt};
        use holtburger_common::properties::{ItemType, PropertyInt};
        use holtburger_protocol::{
            messages::{GameMessage, transport},
            traits::ProtocolUnpack,
        };
        use std::io::{Cursor, Read};
        let mut client = build_test_client(ClientState::InWorld);
        client.world = outfit(0, 2);
        let ground = Guid(0x8000_0042);
        let mut entity =
            holtburger_world::entity::Entity::new(ground, "Loose item".into(), Default::default());
        entity.position.landblock_id = Guid(0x1234_0001);
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::FOOD.bits() as i32);
        client.world.add_entity(entity);
        let equipped = client.world.player_equipment().next().expect("armor").0;
        let capture = tempfile::NamedTempFile::new().expect("capture file");
        client
            .session
            .set_capture(capture.path().to_str().expect("capture path"))
            .expect("capture");
        client
            .submit_inventory_intent(InventoryIntent {
                item: ground,
                target: InventoryTarget::Pickup,
            })
            .await
            .expect("pickup");
        client
            .submit_inventory_intent(InventoryIntent {
                item: equipped,
                target: InventoryTarget::Ground,
            })
            .await
            .expect("drop equipped");
        let recipient = Guid(0x8000_0050);
        let mut entity = holtburger_world::entity::Entity::new(
            recipient,
            "Recipient".into(),
            Default::default(),
        );
        entity.position.landblock_id = Guid(0x1234_0001);
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        client.world.add_entity(entity);
        client
            .submit_inventory_intent(InventoryIntent {
                item: equipped,
                target: InventoryTarget::Give { guid: recipient },
            })
            .await
            .expect("give equipped");
        let bytes = std::fs::read(capture.path()).expect("captured packets");
        let mut reader = Cursor::new(bytes.as_slice());
        let mut actions = Vec::new();
        while (reader.position() as usize) < bytes.len() {
            assert_eq!(
                reader.read_u8().expect("direction"),
                holtburger_session::capture::Direction::Outbound as u8
            );
            let _timestamp = reader.read_u64::<LittleEndian>().expect("timestamp");
            let address_length = reader.read_u16::<LittleEndian>().expect("address length");
            let mut address = vec![0; usize::from(address_length)];
            reader.read_exact(&mut address).expect("address");
            let packet_length = reader.read_u32::<LittleEndian>().expect("packet length");
            let mut packet = vec![0; packet_length as usize];
            reader.read_exact(&mut packet).expect("packet");
            let mut offset = transport::HEADER_SIZE + transport::FRAGMENT_HEADER_SIZE;
            let Some(GameMessage::GameAction(message)) = GameMessage::unpack(&packet, &mut offset)
            else {
                panic!("expected action packet");
            };
            assert_eq!(offset, packet.len());
            actions.push(message.action);
        }
        assert_eq!(actions.len(), 3);
        assert!(
            matches!(&actions[0], GameAction::PutItemInContainer(data) if data.item_guid == ground && data.container_guid == Guid(2) && data.placement == 1)
        );
        assert!(matches!(&actions[1], GameAction::DropItem(data) if data.item_guid == equipped));
        assert!(
            matches!(&actions[2], GameAction::GiveObjectRequest(data) if data.item_guid == equipped && data.target_guid == recipient && data.amount == 1)
        );
        assert!(client.pack_exchange.is_none());
        assert!(client.equipment_operation.is_none());
    }

    #[tokio::test]
    async fn standalone_drop_and_move_send_once_without_blocking_next_request() {
        use super::super::{inventory_plan::InventoryTarget, types::ClientCommand};
        let mut client = build_test_client(ClientState::InWorld);
        client.world = outfit(2, 2);
        let equipped = client.world.player_equipment().next().expect("armor").0;
        let before = client.session.game_action_sequence;
        client
            .submit_inventory_intent(InventoryIntent {
                item: equipped,
                target: InventoryTarget::Ground,
            })
            .await
            .expect("drop");
        move_during_reach(&mut client.world);
        assert_eq!(client.session.game_action_sequence, before + 1);
        assert!(client.pack_exchange.is_none());
        assert!(
            client.world.equipment_mask(equipped).is_some(),
            "no optimistic removal"
        );
        event(
            &mut client.world,
            GameEvent::InventoryPutObjectIn3D(Box::new(
                holtburger_protocol::messages::InventoryPutObjectIn3DEventData {
                    object_guid: equipped,
                },
            )),
        );
        assert!(client.world.equipment_mask(equipped).is_none());
        assert_eq!(client.session.game_action_sequence, before + 1);
        client
            .submit_inventory_intent(InventoryIntent {
                item: Guid(3),
                target: InventoryTarget::Container { guid: PLAYER },
            })
            .await
            .expect("move");
        assert_eq!(client.session.game_action_sequence, before + 2);
        assert!(client.pack_exchange.is_none());
        client
            .handle_command(ClientCommand::Use {
                guid: Guid(3),
                unrestricted: true,
            })
            .await
            .expect("use");
        assert_eq!(client.session.game_action_sequence, before + 3);
    }

    #[tokio::test]
    async fn exchange_waits_for_first_move_then_releases_after_sending_second() {
        let mut client = build_test_client(ClientState::InWorld);
        let now = Instant::now();
        pending_swap(&mut client, now);
        move_during_reach(&mut client.world);
        client.advance_pack_exchange(now).await.expect("waiting");
        assert!(client.pack_exchange.is_some());
        place(&mut client.world, SOURCE, 4);
        client
            .advance_pack_exchange(now)
            .await
            .expect("second request");
        assert!(client.pack_exchange.is_none());
        assert_eq!(client.session.game_action_sequence, 1);
    }

    #[tokio::test]
    async fn timeout_retires_unsent_continuation_but_late_updates_still_apply() {
        let mut client = build_test_client(ClientState::InWorld);
        let now = Instant::now();
        pending_swap(&mut client, now);
        client
            .advance_pack_exchange(now + PACK_EXCHANGE_TIMEOUT)
            .await
            .expect("timeout");
        assert!(client.pack_exchange.is_none());
        assert_eq!(client.session.game_action_sequence, 0);
        place(&mut client.world, SOURCE, 4);
        client
            .advance_pack_exchange(now + PACK_EXCHANGE_TIMEOUT)
            .await
            .expect("late update");
        assert!(matches!(
            client.world.storage_location(SOURCE),
            Some(StorageLocation::Contained {
                slot: StorageSlot::Pack { index: 4, .. },
                ..
            })
        ));
    }

    #[tokio::test]
    async fn exchange_protects_its_continuation_and_server_rejection_retires_it() {
        use super::super::types::ClientCommand;
        let mut client = build_test_client(ClientState::InWorld);
        let now = Instant::now();
        pending_swap(&mut client, now);
        client
            .handle_command(ClientCommand::Use {
                guid: Guid(3),
                unrestricted: true,
            })
            .await
            .expect("blocked use");
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(client.pack_exchange.is_some());
        move_during_reach(&mut client.world);
        assert!(client.pack_exchange.is_some());
        client.reject_pack_exchange_item(SOURCE);
        place(&mut client.world, SOURCE, 4);
        client
            .advance_pack_exchange(now)
            .await
            .expect("late first move");
        assert!(client.pack_exchange.is_none());
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[tokio::test]
    async fn changed_target_retires_exchange_without_second_move() {
        let mut client = build_test_client(ClientState::InWorld);
        let now = Instant::now();
        pending_swap(&mut client, now);
        place(&mut client.world, SOURCE, 4);
        place(&mut client.world, TARGET, 1);
        client
            .advance_pack_exchange(now)
            .await
            .expect("changed target");
        assert!(client.pack_exchange.is_none());
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[tokio::test]
    async fn item_disappearance_during_moving_reach_times_out_without_sending_continuation() {
        let mut client = build_test_client(ClientState::InWorld);
        let now = Instant::now();
        pending_swap(&mut client, now);
        move_during_reach(&mut client.world);
        place(&mut client.world, SOURCE, 4);
        client.world.handle_message(
            &holtburger_protocol::messages::GameMessage::InventoryRemoveObject(Box::new(
                holtburger_protocol::messages::InventoryRemoveObjectData {
                    object_guid: TARGET,
                },
            )),
        );
        // Removal compacts pack slots, so the first move is no longer confirmed at its
        // requested index. Existing timeout policy retires the unsent continuation.
        client
            .advance_pack_exchange(now + PACK_EXCHANGE_TIMEOUT)
            .await
            .unwrap();
        assert!(client.pack_exchange.is_none());
        assert_eq!(client.session.game_action_sequence, 0);
        assert_eq!(
            client.world.motion_runtimes.state(PLAYER).unwrap().substate,
            MotionCommand(0x4000_0018)
        );
    }
}
