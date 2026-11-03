use super::*;
use crate::client::{
    builder::build_test_client,
    equipment_plan::tests::event,
    inventory_plan::{InventoryIntent, InventoryTarget},
};
use holtburger_common::properties::InventoryEntryKind;
use holtburger_protocol::{
    messages::{
        GameEvent, GameMessage, InventoryPutObjInContainerEventData, ViewContentsEventData,
        ViewContentsEventItem,
        inventory::types::{InventoryRemoveObjectData, SetStackSizeData},
    },
    traits::ProtocolPack,
};
use tokio::sync::broadcast;

const PLAYER: Guid = Guid(1);
const BAG: Guid = Guid(2);
const FIRST: Guid = Guid(10);
const SECOND: Guid = Guid(11);
const THIRD: Guid = Guid(12);
const MAXIMUM: i32 = 100;
const POLICY: AutoMergePolicy = AutoMergePolicy {
    step_timeout_ms: 500,
    operation_timeout_ms: 1_200,
};

fn roster(world: &mut WorldState, container: Guid, entries: &[(Guid, InventoryEntryKind)]) {
    event(
        world,
        GameEvent::ViewContents(Box::new(ViewContentsEventData {
            container,
            items: entries
                .iter()
                .map(|&(guid, container_type)| ViewContentsEventItem {
                    guid,
                    container_type,
                })
                .collect(),
        })),
    );
}

fn world(counts: &[i32], container: Guid) -> WorldState {
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(PLAYER, "Player", Default::default());
    world
        .entities
        .get_mut(PLAYER)
        .unwrap()
        .properties
        .ints
        .insert(PropertyInt::ItemsCapacity, MAXIMUM);
    let mut bag = Entity::new(BAG, "Bag".into(), Default::default());
    bag.properties
        .ints
        .insert(PropertyInt::ItemsCapacity, MAXIMUM);
    world.entities.insert(bag);
    let entries: Vec<_> = counts
        .iter()
        .enumerate()
        .map(|(index, &count)| {
            let guid = Guid(FIRST.0 + index as u32);
            let mut entity = Entity::new(guid, "Stack".into(), Default::default());
            entity.wcid = Some(42);
            entity.properties.ints.insert(
                PropertyInt::ItemType,
                holtburger_common::properties::ItemType::MISC.bits() as i32,
            );
            entity.properties.ints.insert(PropertyInt::StackSize, count);
            entity
                .properties
                .ints
                .insert(PropertyInt::MaxStackSize, MAXIMUM);
            world.entities.insert(entity);
            (guid, InventoryEntryKind::Item)
        })
        .collect();
    if container == PLAYER {
        let mut root = entries;
        root.push((BAG, InventoryEntryKind::Container));
        roster(&mut world, PLAYER, &root);
        roster(&mut world, BAG, &[]);
    } else {
        roster(&mut world, PLAYER, &[(BAG, InventoryEntryKind::Container)]);
        roster(&mut world, BAG, &entries);
    }
    world
}

fn count(guid: Guid, stack_size: u32) -> GameMessage {
    GameMessage::SetStackSize(Box::new(SetStackSizeData {
        sequence: 1,
        object_guid: guid,
        stack_size,
        value: 0,
    }))
}

fn remove(guid: Guid) -> GameMessage {
    GameMessage::InventoryRemoveObject(Box::new(InventoryRemoveObjectData { object_guid: guid }))
}

async fn receive(client: &mut ClientRuntime, message: GameMessage) {
    let mut bytes = Vec::new();
    message.pack(&mut bytes);
    client.handle_message(&bytes).await.unwrap();
}

fn results(events: &mut broadcast::Receiver<ClientViewEvent>) -> Vec<AutoMergeResult> {
    let mut results = Vec::new();
    while let Ok(event) = events.try_recv() {
        if let ClientViewEvent::AutoMergeFinished(result) = event {
            results.push(result);
        }
    }
    results
}

fn pending(client: &ClientRuntime) -> &AwaitingMerge {
    let Some(InventoryOperation::AutoMerge(operation)) = &client.inventory_operation else {
        panic!("auto-merge must be active")
    };
    let MergeStage::Awaiting(pending) = &operation.stage else {
        panic!("request must be awaiting confirmation")
    };
    pending
}

fn expect_dispatch(
    operation: &mut ContainerAutoMerge,
    world: &WorldState,
    now: Instant,
) -> MergeDispatch {
    match operation.advance(world, now).unwrap() {
        MergeAdvance::Send(dispatch) => dispatch,
        decision => panic!("expected a merge request, got {decision:?}"),
    }
}

#[tokio::test]
async fn consolidates_in_native_order_and_counts_only_confirmed_consumption() {
    for container in [PLAYER, BAG] {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = world(&[20, 70, 60], container);
        let mut events = client.subscribe_client_view_events();
        let before = client.session.game_action_sequence;
        client.start_auto_merge(container, POLICY).await.unwrap();
        assert_eq!(
            (
                pending(&client).step.source,
                pending(&client).step.destination,
                pending(&client).step.amount
            ),
            (SECOND, FIRST, 70)
        );
        assert_eq!(
            pending(&client).step.source_after,
            MergeSourceAfter::Removed
        );
        receive(&mut client, remove(SECOND)).await;
        assert!(
            client.world.entities.get(SECOND).is_some(),
            "raw retained entity is not removal evidence"
        );
        client
            .advance_inventory_operation(Instant::now())
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, before + 1);
        receive(&mut client, count(FIRST, 90)).await;
        client
            .advance_inventory_operation(Instant::now())
            .await
            .unwrap();
        assert_eq!(
            (
                pending(&client).step.source,
                pending(&client).step.destination,
                pending(&client).step.amount
            ),
            (THIRD, FIRST, 10)
        );
        assert_eq!(
            pending(&client).step.source_after,
            MergeSourceAfter::Remaining { count: 50 }
        );
        receive(&mut client, count(FIRST, 100)).await;
        client
            .advance_inventory_operation(Instant::now())
            .await
            .unwrap();
        assert!(results(&mut events).is_empty());
        receive(&mut client, count(THIRD, 50)).await;
        client
            .advance_inventory_operation(Instant::now())
            .await
            .unwrap();
        client
            .advance_inventory_operation(Instant::now())
            .await
            .unwrap();
        assert!(!client.inventory_operation_pending());
        assert_eq!(client.session.game_action_sequence, before + 2);
        assert_eq!(
            results(&mut events),
            [AutoMergeResult {
                slots_freed: 1,
                outcome: AutoMergeOutcome::Completed { changed: true }
            }]
        );
    }
}

#[tokio::test]
async fn partial_transfer_waits_for_both_orders_and_is_not_a_noop() {
    for destination_first in [false, true] {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = world(&[20, 90], PLAYER);
        let mut events = client.subscribe_client_view_events();
        client.start_auto_merge(PLAYER, POLICY).await.unwrap();
        let messages = if destination_first {
            [count(FIRST, 100), count(SECOND, 10)]
        } else {
            [count(SECOND, 10), count(FIRST, 100)]
        };
        for (index, message) in messages.into_iter().enumerate() {
            receive(&mut client, message).await;
            client
                .advance_inventory_operation(Instant::now())
                .await
                .unwrap();
            if index == 0 {
                assert!(client.inventory_operation_pending());
            }
        }
        assert_eq!(
            results(&mut events),
            [AutoMergeResult {
                slots_freed: 0,
                outcome: AutoMergeOutcome::Completed { changed: true }
            }]
        );
    }
}

#[test]
fn selector_excludes_full_stacks_and_respects_individual_limits_and_initial_scope() {
    let now = Instant::now();
    let mut world = world(&[20, MAXIMUM, 60], PLAYER);
    let mut operation = ContainerAutoMerge::new(&world, PLAYER, POLICY, now).unwrap();
    world
        .entities
        .get_mut(FIRST)
        .unwrap()
        .properties
        .ints
        .insert(PropertyInt::MaxStackSize, 50);
    let step = expect_dispatch(&mut operation, &world, now).step;
    assert_eq!(
        (
            step.source,
            step.destination,
            step.amount,
            step.destination_after
        ),
        (THIRD, FIRST, 30, 50)
    );
    // A newly arriving stack does not become another admitted candidate.
    let mut arrival = Entity::new(Guid(19), "Arrival".into(), Default::default());
    arrival.wcid = Some(42);
    arrival.properties.ints.insert(
        PropertyInt::ItemType,
        holtburger_common::properties::ItemType::MISC.bits() as i32,
    );
    arrival.properties.ints.insert(PropertyInt::StackSize, 10);
    arrival
        .properties
        .ints
        .insert(PropertyInt::MaxStackSize, MAXIMUM);
    world.entities.insert(arrival);
    event(
        &mut world,
        GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
            item_guid: Guid(19),
            container_guid: PLAYER,
            slot: 0,
            container_type: InventoryEntryKind::Item,
        })),
    );
    world.handle_message(&count(step.destination, step.destination_after));
    let MergeSourceAfter::Remaining { count: remainder } = step.source_after else {
        panic!("fixture must retain a source remainder")
    };
    world.handle_message(&count(step.source, remainder));
    assert!(matches!(
        operation.advance(&world, now).unwrap(),
        MergeAdvance::Finished(AutoMergeOutcome::Completed { changed: true })
    ));
    assert_eq!(
        stack_count(world.entities.get(Guid(19)).unwrap()).unwrap(),
        10
    );
}

#[tokio::test]
async fn noop_and_incomplete_input_never_send_a_request() {
    for quantities in [&[][..], &[MAXIMUM, 20][..]] {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = world(quantities, PLAYER);
        let mut events = client.subscribe_client_view_events();
        let before = client.session.game_action_sequence;
        client.start_auto_merge(PLAYER, POLICY).await.unwrap();
        assert_eq!(client.session.game_action_sequence, before);
        assert_eq!(
            results(&mut events)[0].outcome,
            AutoMergeOutcome::Completed { changed: false }
        );
    }
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 70], PLAYER);
    client
        .world
        .entities
        .get_mut(SECOND)
        .unwrap()
        .properties
        .ints
        .0
        .remove(&PropertyInt::StackSize);
    let mut events = client.subscribe_client_view_events();
    let before = client.session.game_action_sequence;
    client.start_auto_merge(PLAYER, POLICY).await.unwrap();
    assert_eq!(client.session.game_action_sequence, before);
    assert!(matches!(
        results(&mut events)[0].outcome,
        AutoMergeOutcome::Rejected(_)
    ));
}

#[tokio::test]
async fn fixed_deadline_releases_on_missing_or_partial_reply_and_late_updates_do_not_restart() {
    for partial in [false, true] {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = world(&[20, 90], PLAYER);
        let mut events = client.subscribe_client_view_events();
        client.start_auto_merge(PLAYER, POLICY).await.unwrap();
        let deadline = pending(&client).deadline;
        if partial {
            receive(&mut client, count(FIRST, 100)).await;
        }
        client.poll_busy_timeout(deadline - Duration::from_millis(1));
        assert_eq!(pending(&client).deadline, deadline);
        client.poll_busy_timeout(deadline);
        assert!(!client.inventory_operation_pending());
        assert!(matches!(
            results(&mut events)[0].outcome,
            AutoMergeOutcome::Stopped(_)
        ));
        receive(&mut client, count(FIRST, 100)).await;
        receive(&mut client, count(SECOND, 10)).await;
        client.advance_inventory_operation(deadline).await.unwrap();
        assert!(!client.inventory_operation_pending());
        assert!(results(&mut events).is_empty());
        let before = client.session.game_action_sequence;
        client
            .handle_command(ClientCommand::Drop(SECOND))
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, before + 1);
    }
}

#[tokio::test]
async fn conflict_stops_continuation_without_queuing_or_extending_wait() {
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 70, 60], PLAYER);
    let mut events = client.subscribe_client_view_events();
    client.start_auto_merge(PLAYER, POLICY).await.unwrap();
    let deadline = pending(&client).deadline;
    let before = client.session.game_action_sequence;
    let intent = InventoryIntent {
        item: FIRST,
        target: InventoryTarget::Ground,
    };
    client
        .handle_command(ClientCommand::PreviewInventory(
            crate::client::inventory_plan::InventoryPreviewRequest {
                sequence: 1,
                intent,
            },
        ))
        .await
        .unwrap();
    assert!(matches!(
        pending(&client).continuation,
        Continuation::Continue
    ));
    client
        .handle_command(ClientCommand::SubmitInventory(intent))
        .await
        .unwrap();
    client
        .handle_command(ClientCommand::SubmitInventory(intent))
        .await
        .unwrap();
    assert_eq!(pending(&client).deadline, deadline);
    assert!(matches!(
        pending(&client).continuation,
        Continuation::StopRequested
    ));
    assert_eq!(client.session.game_action_sequence, before);
    receive(&mut client, count(FIRST, 90)).await;
    receive(&mut client, remove(SECOND)).await;
    client
        .advance_inventory_operation(Instant::now())
        .await
        .unwrap();
    assert!(!client.inventory_operation_pending());
    assert_eq!(client.session.game_action_sequence, before);
    let result = results(&mut events).pop().unwrap();
    assert_eq!(result.slots_freed, 1);
    assert!(matches!(result.outcome, AutoMergeOutcome::Stopped(_)));
}

#[tokio::test]
async fn expired_owner_is_cleared_before_admitting_a_conflicting_command() {
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 90], PLAYER);
    client.start_auto_merge(PLAYER, POLICY).await.unwrap();
    let Some(InventoryOperation::AutoMerge(operation)) = &mut client.inventory_operation else {
        panic!()
    };
    let MergeStage::Awaiting(pending) = &mut operation.stage else {
        panic!()
    };
    pending.deadline = Instant::now();
    let before = client.session.game_action_sequence;
    client
        .handle_command(ClientCommand::Drop(SECOND))
        .await
        .unwrap();
    assert!(!client.inventory_operation_pending());
    assert_eq!(client.session.game_action_sequence, before + 1);
}

#[test]
fn operation_deadline_caps_a_fresh_step_and_progress_cannot_extend_it() {
    let now = Instant::now();
    let world = world(&[20, 70, 60], PLAYER);
    let mut operation = ContainerAutoMerge::new(&world, PLAYER, POLICY, now).unwrap();
    let started = operation.deadline - Duration::from_millis(1);
    expect_dispatch(&mut operation, &world, started);
    let MergeStage::Awaiting(pending) = &operation.stage else {
        panic!()
    };
    assert_eq!(pending.deadline, operation.deadline);
    assert!(matches!(
        operation.poll(&world, operation.deadline).unwrap(),
        Some(AutoMergeOutcome::Stopped(_))
    ));
}

#[test]
fn rejects_focus_targets_unannounced_contents_and_replaced_candidates() {
    let now = Instant::now();
    let mut world = world(&[20, 70], BAG);
    let mut operation = ContainerAutoMerge::new(&world, BAG, POLICY, now).unwrap();
    world.entities.get_mut(SECOND).unwrap().sequences.fill(1);
    assert!(operation.advance(&world, now).is_err());
    roster(&mut world, PLAYER, &[(BAG, InventoryEntryKind::Foci)]);
    assert!(ContainerAutoMerge::new(&world, BAG, POLICY, now).is_err());
    let unopened = Guid(18);
    let mut bag = Entity::new(unopened, "Unannounced bag".into(), Default::default());
    bag.wcid = Some(43);
    bag.properties.ints.insert(
        PropertyInt::ItemType,
        holtburger_common::properties::ItemType::CONTAINER.bits() as i32,
    );
    bag.properties
        .ints
        .insert(PropertyInt::ItemsCapacity, MAXIMUM);
    world.entities.insert(bag);
    event(
        &mut world,
        GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
            item_guid: unopened,
            container_guid: PLAYER,
            slot: 1,
            container_type: InventoryEntryKind::Container,
        })),
    );
    assert_eq!(
        ContainerAutoMerge::new(&world, unopened, POLICY, now).unwrap_err(),
        "Container contents are incomplete"
    );
}

#[tokio::test]
async fn only_matching_failures_are_claimed_and_lifecycle_releases_ownership() {
    use holtburger_protocol::errors::WeenieError;
    for guid in [FIRST, SECOND] {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = world(&[20, 90], PLAYER);
        let mut events = client.subscribe_client_view_events();
        client.start_auto_merge(PLAYER, POLICY).await.unwrap();
        assert!(!client.reject_inventory_operation_item(THIRD, WeenieError::None));
        assert!(client.inventory_operation_pending());
        assert!(client.reject_inventory_operation_item(guid, WeenieError::None));
        assert!(!client.inventory_operation_pending());
        assert_eq!(results(&mut events).len(), 1);
    }
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 90], PLAYER);
    client.start_auto_merge(PLAYER, POLICY).await.unwrap();
    client.stop_character_actions();
    assert!(!client.inventory_operation_pending());
}

#[test]
fn policy_requires_positive_budgets_and_allows_an_overall_limit_shorter_than_a_step() {
    let now = Instant::now();
    for policy in [
        AutoMergePolicy {
            step_timeout_ms: 0,
            ..POLICY
        },
        AutoMergePolicy {
            operation_timeout_ms: 0,
            ..POLICY
        },
    ] {
        assert!(policy.deadlines(now).is_err());
    }
    let policy = AutoMergePolicy {
        step_timeout_ms: 200,
        operation_timeout_ms: 100,
    };
    assert_eq!(
        policy.deadlines(now).unwrap().1,
        now + Duration::from_millis(policy.operation_timeout_ms)
    );
}

#[tokio::test]
async fn pending_active_and_retiring_combat_reject_admission_without_changing_stance() {
    use crate::client::types::ClientAttackProfile;
    use holtburger_protocol::messages::combat::AttackHeight;
    for phase in [
        ClientCombatControlState::Charging,
        ClientCombatControlState::Active,
        ClientCombatControlState::Retiring,
    ] {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = world(&[20, 70], PLAYER);
        let now = Instant::now();
        client.combat_engagement.begin(
            Guid(99),
            ClientAttackProfile::Missile {
                height: AttackHeight::Medium,
                accuracy: 0.0,
            },
            now,
            Duration::ZERO,
        );
        if phase != ClientCombatControlState::Charging {
            assert!(client.combat_engagement.next_effect(now, true).is_some());
        }
        if phase == ClientCombatControlState::Retiring {
            client.combat_engagement.stop();
        }
        let before = client.session.game_action_sequence;
        let mut events = client.subscribe_client_view_events();
        client.start_auto_merge(PLAYER, POLICY).await.unwrap();
        assert!(!client.inventory_operation_pending());
        assert_eq!(client.session.game_action_sequence, before);
        assert_eq!(
            results(&mut events)[0].outcome,
            AutoMergeOutcome::Rejected("Stop attacking before auto-merging".into())
        );
    }
}

#[tokio::test]
async fn repeat_invocation_cannot_replace_policy_deadlines_or_candidate_scope() {
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 70], PLAYER);
    client.start_auto_merge(PLAYER, POLICY).await.unwrap();
    let deadline = pending(&client).deadline;
    let before = client.session.game_action_sequence;
    let other_policy = AutoMergePolicy {
        step_timeout_ms: POLICY.step_timeout_ms * 2,
        operation_timeout_ms: POLICY.operation_timeout_ms * 2,
    };
    client
        .handle_command(ClientCommand::AutoMergeContainer {
            container: BAG,
            policy: other_policy,
        })
        .await
        .unwrap();
    assert_eq!(pending(&client).deadline, deadline);
    assert_eq!(client.session.game_action_sequence, before);
    assert!(matches!(
        pending(&client).continuation,
        Continuation::Continue
    ));
}

#[tokio::test]
async fn interruption_between_steps_admits_the_action_without_replaying_it() {
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 70, 60], PLAYER);
    client.start_auto_merge(PLAYER, POLICY).await.unwrap();
    receive(&mut client, remove(SECOND)).await;
    receive(&mut client, count(FIRST, 90)).await;
    client.poll_auto_merge(Instant::now());
    let before = client.session.game_action_sequence;
    client
        .handle_command(ClientCommand::Drop(THIRD))
        .await
        .unwrap();
    assert!(!client.inventory_operation_pending());
    assert_eq!(client.session.game_action_sequence, before + 1);
    client
        .advance_inventory_operation(Instant::now())
        .await
        .unwrap();
    assert_eq!(client.session.game_action_sequence, before + 1);
}

#[tokio::test]
async fn a_real_send_failure_releases_inventory_ownership_without_retrying() {
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 70], PLAYER);
    // The session binds IPv4; an IPv6 destination exercises the existing transport failure seam.
    client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
        .await
        .unwrap();
    let mut events = client.subscribe_client_view_events();
    assert!(client.start_auto_merge(PLAYER, POLICY).await.is_err());
    assert!(!client.inventory_operation_pending());
    assert!(matches!(
        results(&mut events)[0].outcome,
        AutoMergeOutcome::Stopped(_)
    ));
    client
        .advance_inventory_operation(Instant::now())
        .await
        .unwrap();
    assert!(results(&mut events).is_empty());
}

#[tokio::test]
async fn conflicting_workflows_receive_their_correlated_rejection_and_combat_acknowledgment() {
    use crate::client::{
        item_use::{ItemUseOutcome, ItemUseRequest},
        salvage::{SalvageSubmitOutcome, SalvageSubmitRequest},
        types::ClientAttackProfile,
    };
    use holtburger_protocol::messages::combat::AttackHeight;
    use holtburger_world::{
        crafting::salvage::{SalvageReview, SalvageTool},
        item_use::{ItemUseConsequence, ItemUseIntent},
    };
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 90], PLAYER);
    client.start_auto_merge(PLAYER, POLICY).await.unwrap();
    let deadline = pending(&client).deadline;
    let before = client.session.game_action_sequence;
    let mut events = client.subscribe_client_view_events();
    client
        .handle_command(ClientCommand::SubmitItemUse(ItemUseRequest {
            sequence: 71,
            player: PLAYER,
            source_owned: true,
            intent: ItemUseIntent::Direct {
                source: FIRST,
                unrestricted: false,
            },
            expected: ItemUseConsequence::Ordinary,
        }))
        .await
        .unwrap();
    assert!(
        matches!(events.try_recv().unwrap(), ClientViewEvent::ItemUseResult(result) if result.sequence == 71 && matches!(result.outcome, ItemUseOutcome::Rejected { .. }))
    );
    client
        .handle_command(ClientCommand::SubmitSalvage(SalvageSubmitRequest {
            sequence: 72,
            review: SalvageReview {
                player: PLAYER,
                tool: SalvageTool {
                    guid: FIRST,
                    instance: 0,
                },
                sources: vec![],
                skills: Default::default(),
            },
        }))
        .await
        .unwrap();
    assert!(
        matches!(events.try_recv().unwrap(), ClientViewEvent::SalvageSubmitted(result) if result.sequence == 72 && matches!(result.outcome, SalvageSubmitOutcome::Rejected { .. }))
    );
    client
        .handle_command(ClientCommand::BeginCombatEngagement {
            intent_sequence: 73,
            target: THIRD,
            profile: ClientAttackProfile::Missile {
                height: AttackHeight::Medium,
                accuracy: 0.0,
            },
        })
        .await
        .unwrap();
    assert!(
        matches!(events.try_recv().unwrap(), ClientViewEvent::CombatStatusUpdated(status) if status.processed_intent_sequence == 73 && status.desired.is_none())
    );
    assert_eq!(pending(&client).deadline, deadline);
    assert_eq!(client.session.game_action_sequence, before);
}

#[test]
fn slow_successive_steps_do_not_extend_the_invocation_deadline() {
    let admitted = Instant::now();
    let mut world = world(&[10, 10, 10, 10, 10], PLAYER);
    let mut operation = ContainerAutoMerge::new(&world, PLAYER, POLICY, admitted).unwrap();
    let original_deadline = operation.deadline;
    let mut now = admitted;
    for _ in 0..2 {
        let dispatch = expect_dispatch(&mut operation, &world, now);
        world.handle_message(&count(
            dispatch.step.destination,
            dispatch.step.destination_after,
        ));
        world.handle_message(&remove(dispatch.step.source));
        operation.observe_removal(dispatch.step.source);
        now = dispatch.deadline - Duration::from_millis(1);
        assert_eq!(operation.poll(&world, now).unwrap(), None);
    }
    assert_eq!(operation.slots_freed, 2);
    let dispatch = expect_dispatch(&mut operation, &world, now);
    assert_eq!(dispatch.deadline, original_deadline);
    assert!(matches!(
        operation.poll(&world, original_deadline).unwrap(),
        Some(AutoMergeOutcome::Stopped(_))
    ));
    assert_eq!(operation.slots_freed, 2);
}

#[tokio::test]
async fn moved_endpoint_and_invalid_policy_release_or_never_acquire_admission() {
    for source in [FIRST, SECOND] {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = world(&[20, 90], PLAYER);
        client.start_auto_merge(PLAYER, POLICY).await.unwrap();
        event(
            &mut client.world,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: source,
                container_guid: BAG,
                slot: 0,
                container_type: InventoryEntryKind::Item,
            })),
        );
        client.poll_auto_merge(Instant::now());
        assert!(!client.inventory_operation_pending());
    }
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 90], PLAYER);
    let before = client.session.game_action_sequence;
    client
        .start_auto_merge(
            PLAYER,
            AutoMergePolicy {
                step_timeout_ms: 0,
                ..POLICY
            },
        )
        .await
        .unwrap();
    assert!(!client.inventory_operation_pending());
    assert_eq!(client.session.game_action_sequence, before);
}

#[tokio::test]
async fn explicit_disconnect_retires_the_operation_before_the_session_ends() {
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 90], PLAYER);
    client.start_auto_merge(PLAYER, POLICY).await.unwrap();
    client
        .handle_command(ClientCommand::Disconnect)
        .await
        .unwrap();
    assert_eq!(client.state, ClientState::Disconnected);
    assert!(!client.inventory_operation_pending());
}

#[tokio::test]
async fn delayed_physics_timestamp_cannot_dispatch_past_the_operation_deadline() {
    let mut client = build_test_client(ClientState::InWorld);
    client.world = world(&[20, 70, 60], PLAYER);
    client.start_auto_merge(PLAYER, POLICY).await.unwrap();
    receive(&mut client, remove(SECOND)).await;
    receive(&mut client, count(FIRST, 90)).await;
    client.poll_auto_merge(Instant::now());
    let Some(InventoryOperation::AutoMerge(operation)) = &mut client.inventory_operation else {
        panic!("confirmed step must retain the unsent continuation");
    };
    let expired = Instant::now() - Duration::from_millis(1);
    operation.deadline = expired;
    let stale_tick = expired - Duration::from_millis(1);
    let before = client.session.game_action_sequence;
    client
        .advance_inventory_operation(stale_tick)
        .await
        .unwrap();
    assert_eq!(
        client.session.game_action_sequence, before,
        "a stale physics clock must not authorize another request"
    );
    assert!(!client.inventory_operation_pending());
}
