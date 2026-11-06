use super::*;
use crate::pages::game::state::SalvagingPhase;
use holtburger_common::properties::MaterialType;
use holtburger_core::client::entity_facts::ClientEntityDelta;
use holtburger_core::client::salvage::{
    SalvagePreviewResult, SalvageSubmitOutcome, SalvageSubmitResult,
};
use holtburger_protocol::messages::IdentifyObjectResponseEventData;
use holtburger_protocol::messages::object::IdentifyResponseFlags;
use holtburger_world::WorldEvent;
use holtburger_world::crafting::salvage::{
    SalvageContext, SalvageEvaluation, SalvageTool, UST_WCID, find_salvage_tool,
};

use holtburger_protocol::messages::{
    GameEvent, GameEventMessage, GameMessage, InventoryPutObjInContainerEventData,
};
use holtburger_world::WorldState;
use holtburger_world::inspection::{ObjectInspectionOutcome, ObjectInspectionResult};

const PLAYER: Guid = Guid(1);
const TOOL: Guid = Guid(2);
const ITEM: Guid = Guid(3);
const ITEM_UNITS: i32 = 10;

fn draft() -> GameState {
    let mut state = GameState::new(PLAYER, "Player".into(), "World".into());
    state.view.active_interaction = Some(Interaction::Salvaging);
    state.view.salvaging = Some(SalvagingState {
        ust_guid: TOOL,
        queued_items: vec![ITEM],
        sequence: 0,
        phase: SalvagingPhase::Loading,
        assessments: std::collections::HashMap::new(),
    });
    state
}

fn refresh(state: &mut GameState) -> u32 {
    let result = state.handle_view_event(ClientViewEvent::EntityFactsChanged(ClientEntityDelta {
        salvage: Some(SalvageContext::default()),
        ..Default::default()
    }));
    let [ClientCommand::PreviewSalvage(request)] = result.commands.as_slice() else {
        panic!("expected a correlated preview request");
    };
    assert_eq!(request.player, PLAYER);
    assert_eq!(request.items, [ITEM]);
    request.sequence
}

fn preview(state: &mut GameState, sequence: u32, evaluation: SalvageEvaluation) -> UpdateResult {
    state.handle_view_event(ClientViewEvent::SalvagePreview(SalvagePreviewResult {
        sequence,
        evaluation,
    }))
}

fn pending() -> SalvageEvaluation {
    SalvageEvaluation::PendingDetails {
        tool: SalvageTool {
            guid: TOOL,
            instance: 0,
        },
        items: vec![ITEM],
    }
}

fn world() -> WorldState {
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(PLAYER, "Player", Default::default());
    for (guid, name, wcid, kind) in [
        (TOOL, "Ust", UST_WCID, ItemType::TINKERING_TOOL),
        (ITEM, "Iron", 42, ItemType::TINKERING_MATERIAL),
    ] {
        let mut entity = Entity::new(guid, name.into(), Default::default());
        entity.wcid = Some(wcid);
        entity.set_int_prop(PropertyInt::ItemType, kind.bits() as i32);
        entity.set_int_prop(PropertyInt::MaterialType, MaterialType::Iron as i32);
        entity.set_int_prop(PropertyInt::Structure, ITEM_UNITS);
        entity.set_int_prop(PropertyInt::ItemWorkmanship, 5);
        entity.set_int_prop(PropertyInt::NumItemsInMaterial, 1);
        world.add_entity(entity);
        world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 0,
            event: GameEvent::InventoryPutObjInContainer(Box::new(
                InventoryPutObjInContainerEventData {
                    item_guid: guid,
                    container_guid: PLAYER,
                    slot: guid.0,
                    container_type: holtburger_common::properties::InventoryEntryKind::Item,
                },
            )),
        })));
    }
    world
}

fn ready() -> SalvageEvaluation {
    let world = world();
    world.evaluate_salvage(find_salvage_tool(&world, None).unwrap(), &[ITEM])
}

fn submit(state: &mut GameState) -> u32 {
    let sequence = refresh(state);
    preview(state, sequence, ready());
    let result = state.handle_action(AppAction::ConfirmSalvage).unwrap();
    let [ClientCommand::SubmitSalvage(request)] = result.commands.as_slice() else {
        panic!("expected guarded submission");
    };
    assert_eq!(request.sequence, sequence);
    let SalvageEvaluation::Ready { review, .. } = ready() else {
        unreachable!();
    };
    assert_eq!(request.review, review);
    assert!(matches!(
        state.view.salvaging.as_ref().unwrap().phase,
        SalvagingPhase::Submitting
    ));
    sequence
}

#[test]
fn salvage_assesses_pending_items_once_and_waits_for_current_review() {
    let mut state = draft();
    let old_sequence = refresh(&mut state);
    let sequence = refresh(&mut state);
    assert!(
        preview(&mut state, old_sequence, pending())
            .commands
            .is_empty()
    );
    let result = preview(&mut state, sequence, pending());
    assert!(matches!(
        result.commands.as_slice(),
        [ClientCommand::Identify(ITEM)]
    ));
    assert!(
        state
            .handle_action(AppAction::ConfirmSalvage)
            .unwrap()
            .commands
            .is_empty()
    );

    let sequence = refresh(&mut state);
    assert!(preview(&mut state, sequence, pending()).commands.is_empty());

    let sequence = refresh(&mut state);
    preview(&mut state, sequence, ready());
    assert!(matches!(
        state.view.salvaging.as_ref().unwrap().phase,
        SalvagingPhase::Reviewed(SalvageEvaluation::Ready { .. })
    ));
}

#[test]
fn salvage_rejection_preserves_batch_and_refreshes_review() {
    let mut state = draft();
    let sequence = submit(&mut state);
    let result = state.handle_view_event(ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
        sequence,
        outcome: SalvageSubmitOutcome::Rejected {
            reason: "Your character is busy.".into(),
        },
    }));
    assert_eq!(state.view.salvaging.as_ref().unwrap().queued_items, [ITEM]);
    assert_eq!(state.view.active_interaction, Some(Interaction::Salvaging));
    assert!(matches!(
        result.commands.as_slice(),
        [ClientCommand::PreviewSalvage(_)]
    ));
    assert!(result.actions.iter().any(|action| matches!(action,
        AppAction::Log { message, .. } if message == "Your character is busy.")));
}

#[test]
fn salvage_changed_review_requires_another_confirmation() {
    let mut state = draft();
    let sequence = submit(&mut state);
    let result = state.handle_view_event(ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
        sequence,
        outcome: SalvageSubmitOutcome::Changed {
            evaluation: ready(),
        },
    }));
    assert!(result.commands.is_empty());
    assert_eq!(state.view.salvaging.as_ref().unwrap().queued_items, [ITEM]);
    assert!(matches!(
        state
            .handle_action(AppAction::ConfirmSalvage)
            .unwrap()
            .commands
            .as_slice(),
        [ClientCommand::SubmitSalvage(_)]
    ));
}

#[test]
fn salvage_waits_for_dispatch_and_prevents_duplicate_submissions() {
    let mut state = draft();
    let sequence = submit(&mut state);
    for action in [
        AppAction::ConfirmSalvage,
        AppAction::QueueSalvageItem { guid: Guid(4) },
        AppAction::UnqueueSalvageItem { guid: ITEM },
    ] {
        assert!(state.handle_action(action).unwrap().commands.is_empty());
        assert_eq!(state.view.salvaging.as_ref().unwrap().queued_items, [ITEM]);
    }
    state.handle_view_event(ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
        sequence,
        outcome: SalvageSubmitOutcome::Dispatched,
    }));
    assert!(state.view.salvaging.is_none());
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn salvage_cancelled_draft_replies_cannot_close_a_new_draft() {
    let mut state = draft();
    let sequence = submit(&mut state);
    state.handle_action(AppAction::CancelInteraction);
    assert!(state.view.salvaging.is_none());
    state.view.active_interaction = Some(Interaction::Salvaging);
    state.view.salvaging = draft().view.salvaging;
    let new_sequence = refresh(&mut state);
    assert_ne!(sequence, new_sequence);
    state.handle_view_event(ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
        sequence,
        outcome: SalvageSubmitOutcome::Dispatched,
    }));
    assert_eq!(
        state.view.salvaging.as_ref().unwrap().sequence,
        new_sequence
    );
}

#[test]
fn salvage_queue_loads_missing_details_and_submits_world_review() {
    let mut world = world();
    world
        .entities
        .get_mut(ITEM)
        .unwrap()
        .properties
        .ints
        .0
        .remove(&PropertyInt::NumItemsInMaterial);
    let mut state = draft();
    state.view.salvaging.as_mut().unwrap().queued_items.clear();
    state
        .data
        .entity_facts
        .insert(ITEM, world.client_entity_facts(ITEM).unwrap().unwrap());

    let result = state
        .handle_action(AppAction::QueueSalvageItem { guid: ITEM })
        .unwrap();
    let [ClientCommand::PreviewSalvage(request)] = result.commands.as_slice() else {
        panic!("queueing must request a preview");
    };
    let tool = find_salvage_tool(&world, None).unwrap();
    let result = preview(
        &mut state,
        request.sequence,
        world.evaluate_salvage(tool, &request.items),
    );
    assert!(matches!(
        result.commands.as_slice(),
        [ClientCommand::Identify(ITEM)]
    ));

    world
        .entities
        .get_mut(ITEM)
        .unwrap()
        .set_int_prop(PropertyInt::NumItemsInMaterial, 1);
    let result = state.handle_view_event(ClientViewEvent::EntityFactsChanged(ClientEntityDelta {
        upserts: vec![world.client_entity_facts(ITEM).unwrap().unwrap()],
        ..Default::default()
    }));
    let [ClientCommand::PreviewSalvage(request)] = result.commands.as_slice() else {
        panic!("updated evidence must refresh the preview");
    };
    let evaluation = world.evaluate_salvage(tool, &request.items);
    let SalvageEvaluation::Ready { review, bags } = &evaluation else {
        panic!("appraised source must be ready");
    };
    assert_eq!(bags.len(), 1);
    assert_eq!(bags[0].units, ITEM_UNITS as u32);
    let review = review.clone();
    preview(&mut state, request.sequence, evaluation);
    let result = state.handle_action(AppAction::ConfirmSalvage).unwrap();
    let [ClientCommand::SubmitSalvage(request)] = result.commands.as_slice() else {
        panic!("confirmation must submit the displayed review");
    };
    assert_eq!(request.review, review);
}

#[test]
fn salvage_despawn_retires_review_in_either_publication_order() {
    for delta_first in [false, true] {
        let mut state = draft();
        let sequence = refresh(&mut state);
        preview(&mut state, sequence, ready());
        let delta = ClientViewEvent::EntityFactsChanged(ClientEntityDelta {
            removed: vec![ITEM],
            ..Default::default()
        });
        if delta_first {
            state.handle_view_event(delta.clone());
        }
        let result = state.handle_view_event(ClientViewEvent::EntityDespawned { guid: ITEM });
        let [ClientCommand::PreviewSalvage(request)] = result.commands.as_slice() else {
            panic!("pruning a source must retire its review");
        };
        assert!(request.items.is_empty());
        assert_ne!(request.sequence, sequence);
        assert!(
            state
                .handle_action(AppAction::ConfirmSalvage)
                .unwrap()
                .commands
                .is_empty()
        );
        if !delta_first {
            state.handle_view_event(delta);
        }
        assert!(preview(&mut state, sequence, ready()).commands.is_empty());
        assert!(matches!(
            state.view.salvaging.as_ref().unwrap().phase,
            SalvagingPhase::Loading
        ));
    }
}

#[test]
fn salvage_assessment_failures_preserve_batch_and_recover_with_new_evidence() {
    for outcome in [
        ObjectInspectionOutcome::Rejected,
        ObjectInspectionOutcome::Missing,
        ObjectInspectionOutcome::Unavailable {
            reason: "Unsupported appraisal details.".into(),
        },
    ] {
        let mut state = draft();
        let sequence = refresh(&mut state);
        preview(&mut state, sequence, pending());
        let result = state.handle_view_event(ClientViewEvent::ObjectInspectionResult(
            ObjectInspectionResult {
                guid: ITEM,
                outcome,
            },
        ));
        let [ClientCommand::PreviewSalvage(request)] = result.commands.as_slice() else {
            panic!("completed assessments must reevaluate current world evidence");
        };
        assert!(
            preview(&mut state, request.sequence, pending())
                .commands
                .is_empty()
        );
        assert!(matches!(
            state.view.salvaging.as_ref().unwrap().phase,
            SalvagingPhase::AssessmentFailed { .. }
        ));
        assert_eq!(state.view.salvaging.as_ref().unwrap().queued_items, [ITEM]);

        // New world evidence supersedes the earlier assessment failure.
        let sequence = refresh(&mut state);
        preview(&mut state, sequence, ready());
        assert!(matches!(
            state
                .handle_action(AppAction::ConfirmSalvage)
                .unwrap()
                .commands
                .as_slice(),
            [ClientCommand::SubmitSalvage(_)]
        ));
    }
}

#[test]
fn salvage_successful_assessment_without_required_details_stops_waiting() {
    let mut world = world();
    world
        .entities
        .get_mut(ITEM)
        .unwrap()
        .properties
        .ints
        .0
        .remove(&PropertyInt::Structure);
    let tool = find_salvage_tool(&world, None).unwrap();
    let mut state = draft();
    let sequence = refresh(&mut state);
    preview(&mut state, sequence, world.evaluate_salvage(tool, &[ITEM]));
    let events = world.handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
        target: PLAYER,
        sequence: 0,
        event: GameEvent::IdentifyObjectResponse(Box::new(IdentifyObjectResponseEventData {
            object_guid: ITEM,
            flags: IdentifyResponseFlags::INT_STATS_TABLE,
            success: true,
            properties: world.entities.get(ITEM).unwrap().properties.clone(),
            ..Default::default()
        })),
    })));
    let inspection = events
        .into_iter()
        .find_map(|event| match event {
            WorldEvent::ObjectInspectionResult(result) => Some(result),
            _ => None,
        })
        .expect("identify response must produce an inspection outcome");
    assert!(matches!(
        inspection.outcome,
        ObjectInspectionOutcome::Ready { .. }
    ));
    let result = state.handle_view_event(ClientViewEvent::ObjectInspectionResult(inspection));
    let [ClientCommand::PreviewSalvage(request)] = result.commands.as_slice() else {
        panic!("received appraisal must trigger reevaluation");
    };
    let result = preview(
        &mut state,
        request.sequence,
        world.evaluate_salvage(tool, &[ITEM]),
    );
    assert!(result.commands.is_empty());
    assert!(matches!(
        state.view.salvaging.as_ref().unwrap().phase,
        SalvagingPhase::AssessmentFailed { .. }
    ));
}

#[test]
fn salvage_leaving_world_retires_the_draft() {
    let mut state = draft();
    let sequence = submit(&mut state);
    state.handle_view_event(ClientViewEvent::StatusUpdate {
        state: holtburger_core::ClientState::Disconnected,
    });
    assert!(state.view.salvaging.is_none());
    assert_eq!(state.view.active_interaction, None);
    state.handle_view_event(ClientViewEvent::SalvageSubmitted(SalvageSubmitResult {
        sequence,
        outcome: SalvageSubmitOutcome::Rejected {
            reason: "Disconnected.".into(),
        },
    }));
    assert!(state.view.salvaging.is_none());
}
