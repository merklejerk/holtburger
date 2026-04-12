use super::*;

#[test]
fn projected_active_confirmation_updates_view_state() {
    let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());

    let result = state.handle_view_event(ClientViewEvent::ActiveCharacterConfirmationUpdated {
        confirmation: Some(ActiveCharacterConfirmation {
            confirmation_type: holtburger_common::ConfirmationType::CraftInteraction,
            context: 7,
            text: "Apply the tinkering attempt?".to_string(),
        }),
    });

    assert!(result.redraw_requested());
    assert!(matches!(
        state.view.active_confirmation,
        Some(ActiveCharacterConfirmation {
            confirmation_type: holtburger_common::ConfirmationType::CraftInteraction,
            context: 7,
            ref text,
        }) if text == "Apply the tinkering attempt?"
    ));
}
