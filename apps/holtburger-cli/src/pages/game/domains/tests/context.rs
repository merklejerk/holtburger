use super::test_support::context_buffer_contains;
use super::*;

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
