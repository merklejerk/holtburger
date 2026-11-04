use super::test_support::context_buffer_contains;
use super::*;

#[test]
fn visible_appraisal_refreshes_without_overlapping_requests_and_stops_on_close() {
    use super::super::object_interaction::{
        INSPECTION_REFRESH_INTERVAL, InspectionRefresh, apply_tick,
    };
    use holtburger_world::inspection::{
        InspectionContext, ObjectInspection, ObjectInspectionOutcome, ObjectInspectionResult,
    };
    let target = Guid(0x60000001);
    let mut state = GameState::new(Guid(0x50000001), "Player".into(), "World".into());
    let entity = Entity::new(target, "Cloak".into(), WorldPosition::default());
    let titles = holtburger_content::CharacterTitleCatalog::default();
    let inspection =
        ObjectInspection::from_entity(&entity, InspectionContext::new(&titles)).unwrap();
    state.handle_action(AppAction::Assess {
        target: InspectTarget::Entity(target),
    });
    let duplicate = state
        .handle_action(AppAction::Assess {
            target: InspectTarget::Entity(target),
        })
        .unwrap();
    assert!(duplicate.commands.is_empty());
    let mut result = UpdateResult::new();
    apply_tick(
        &mut state,
        Instant::now() + INSPECTION_REFRESH_INTERVAL,
        &mut result,
    );
    assert!(result.commands.is_empty());
    state.handle_view_event(ClientViewEvent::ObjectInspectionResult(
        ObjectInspectionResult {
            guid: target,
            outcome: ObjectInspectionOutcome::Ready {
                inspection: Box::new(inspection.clone()),
            },
        },
    ));
    let Some(InspectionRefresh::Scheduled { at, .. }) = state.runtime.inspection_refresh else {
        panic!("ready appraisal must schedule refresh")
    };
    apply_tick(&mut state, at - Duration::from_nanos(1), &mut result);
    assert!(result.commands.is_empty());
    apply_tick(&mut state, at, &mut result);
    assert!(
        matches!(result.commands.as_slice(), [ClientCommand::Identify(guid)] if *guid == target)
    );
    assert_eq!(
        state.view.object_inspection.as_ref().unwrap().outcome,
        ObjectInspectionOutcome::Ready {
            inspection: Box::new(inspection.clone())
        }
    );
    result.commands.clear();
    apply_tick(&mut state, at + INSPECTION_REFRESH_INTERVAL, &mut result);
    assert!(result.commands.is_empty());
    state.handle_view_event(ClientViewEvent::ObjectInspectionResult(
        ObjectInspectionResult {
            guid: target,
            outcome: ObjectInspectionOutcome::Rejected,
        },
    ));
    assert!(state.runtime.inspection_refresh.is_none());
    // Closing a successfully refreshed pane also cancels its next scheduled request.
    state.handle_action(AppAction::Assess {
        target: InspectTarget::Entity(target),
    });
    state.handle_view_event(ClientViewEvent::ObjectInspectionResult(
        ObjectInspectionResult {
            guid: target,
            outcome: ObjectInspectionOutcome::Ready {
                inspection: Box::new(inspection),
            },
        },
    ));
    assert!(matches!(
        state.runtime.inspection_refresh,
        Some(InspectionRefresh::Scheduled { .. })
    ));
    state.handle_action(AppAction::ViewDetails {
        view: ContextView::Default,
    });
    assert!(state.runtime.inspection_refresh.is_none());
    apply_tick(&mut state, at + INSPECTION_REFRESH_INTERVAL, &mut result);
    assert!(result.commands.is_empty());
}

#[test]
fn read_action_uses_generic_use_command_for_books() {
    let player_guid = Guid(0x50000001);
    let book_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let result = state
        .handle_action(AppAction::Read { guid: book_guid })
        .expect("read action should produce an update result");

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::Use { guid, unrestricted: false } if *guid == book_guid))
    );
    assert_eq!(state.view.context_view, ContextView::Book(book_guid));
}

#[test]
fn assess_action_enters_pending_and_distinguishes_terminal_outcomes() {
    let player_guid = Guid(0x50000001);
    let target = Guid(0x60000002);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let result = state
        .handle_action(AppAction::Assess {
            target: InspectTarget::Entity(target),
        })
        .expect("assessment action should be handled");

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::Identify(guid) if *guid == target))
    );
    assert!(context_buffer_contains(
        super::super::object_interaction::context_buffer(&state),
        "Awaiting appraisal details"
    ));

    state.handle_view_event(ClientViewEvent::ObjectInspectionResult(
        holtburger_world::inspection::ObjectInspectionResult {
            guid: target,
            outcome: holtburger_world::inspection::ObjectInspectionOutcome::Rejected,
        },
    ));
    assert!(context_buffer_contains(
        super::super::object_interaction::context_buffer(&state),
        "could not appraise"
    ));

    state.handle_action(AppAction::Assess {
        target: InspectTarget::Entity(target),
    });
    state.handle_view_event(ClientViewEvent::ObjectInspectionResult(
        holtburger_world::inspection::ObjectInspectionResult {
            guid: target,
            outcome: holtburger_world::inspection::ObjectInspectionOutcome::Missing,
        },
    ));
    assert!(context_buffer_contains(
        super::super::object_interaction::context_buffer(&state),
        "no longer available"
    ));
    state.handle_action(AppAction::Assess {
        target: InspectTarget::Entity(target),
    });
    state.handle_view_event(ClientViewEvent::ObjectInspectionResult(
        holtburger_world::inspection::ObjectInspectionResult {
            guid: target,
            outcome: holtburger_world::inspection::ObjectInspectionOutcome::Unavailable {
                reason: "unsupported item XP style: 3".into(),
            },
        },
    ));
    assert!(context_buffer_contains(
        super::super::object_interaction::context_buffer(&state),
        "Appraisal unavailable: unsupported item XP style: 3"
    ));
    assert!(state.runtime.inspection_refresh.is_none());
}

#[test]
fn stale_inspection_result_does_not_replace_the_pending_target() {
    let player_guid = Guid(0x50000001);
    let requested = Guid(0x60000003);
    let stale = Guid(0x60000004);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.handle_action(AppAction::Assess {
        target: InspectTarget::Entity(requested),
    });

    let result = state.handle_view_event(ClientViewEvent::ObjectInspectionResult(
        holtburger_world::inspection::ObjectInspectionResult {
            guid: stale,
            outcome: holtburger_world::inspection::ObjectInspectionOutcome::Missing,
        },
    ));

    assert!(!result.redraw_requested());
    assert!(state.view.object_inspection.is_none());
    assert!(context_buffer_contains(
        super::super::object_interaction::context_buffer(&state),
        "Awaiting appraisal details"
    ));
}
