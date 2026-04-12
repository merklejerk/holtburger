use super::test_support::*;
use super::*;
use crate::scripting::DeferredScriptSource;

fn script_tick_log_count(actions: &[AppAction]) -> usize {
    actions
        .iter()
        .filter(|action| {
            matches!(
                action,
                AppAction::Log { message, .. } if message.starts_with("tick:")
            )
        })
        .count()
}

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

#[test]
fn scripted_ticks_run_at_ten_hz() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.entities.insert(
        player_guid,
        creature_entity(player_guid, "Player", WorldPosition::default()),
    );
    state.script.pending_source = Some(DeferredScriptSource::Inline(
        holtburger_scripting::ScriptSource::new(
            "tick-cadence",
            r#"
Holtburger.onEvent((event) => {
  if (event.kind === "Lifecycle" && event.data.kind === "Tick") {
    Holtburger.log("info", `tick:${event.data.data.elapsed_seconds}`);
  }
});
"#,
        ),
    ));

    let first_tick = state.handle_tick(0.05);
    assert!(state.script.host.is_some());
    assert_eq!(script_tick_log_count(&first_tick.actions), 0);

    let second_tick = state.handle_tick(0.05);
    assert_eq!(script_tick_log_count(&second_tick.actions), 1);
    assert!(second_tick.actions.iter().any(|action| {
        matches!(
            action,
            AppAction::Log { message, .. } if message == "tick:0.1"
        )
    }));

    let third_tick = state.handle_tick(0.09);
    assert_eq!(script_tick_log_count(&third_tick.actions), 0);

    let fourth_tick = state.handle_tick(0.01);
    assert_eq!(script_tick_log_count(&fourth_tick.actions), 1);
}
