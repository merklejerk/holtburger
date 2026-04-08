use super::*;

#[test]
fn combat_mode_update_requests_redraw() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let result = state.handle_view_event(ClientViewEvent::CombatModeUpdated {
        mode: CombatMode::Melee,
    });

    assert!(result.redraw_requested());
    assert_eq!(state.data.combat_mode, CombatMode::Melee);
}

#[test]
fn projected_player_options_update_game_data() {
    let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());

    let result = state.handle_view_event(ClientViewEvent::PlayerOptionsUpdated {
        options: holtburger_core::PlayerCharacterOptions {
            options1: holtburger_common::CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG,
            options2: holtburger_common::CharacterOptions2::HEAR_GENERAL_CHAT,
        },
    });

    assert!(result.redraw_requested());
    assert!(matches!(
        state.data.player_options,
        Some(holtburger_core::PlayerCharacterOptions {
            options1: holtburger_common::CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG,
            options2: holtburger_common::CharacterOptions2::HEAR_GENERAL_CHAT,
        })
    ));
}
