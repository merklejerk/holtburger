use super::*;

#[test]
fn swear_allegiance_action_dispatches_client_command() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let result = state
        .handle_action(AppAction::SwearAllegiance {
            target: Guid(0x50000042),
        })
        .unwrap();

    assert!(matches!(
        result.commands.first(),
        Some(ClientCommand::SwearAllegiance { target }) if *target == Guid(0x50000042)
    ));
}

#[test]
fn unswear_action_dispatches_client_command() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let result = state
        .handle_action(AppAction::Unswear {
            target: Guid(0x50000042),
        })
        .unwrap();

    assert!(matches!(
        result.commands.first(),
        Some(ClientCommand::Unswear { target }) if *target == Guid(0x50000042)
    ));
}

#[test]
fn invite_to_party_action_dispatches_client_command() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let result = state
        .handle_action(AppAction::InviteToParty {
            target: Guid(0x50000042),
        })
        .unwrap();

    assert!(matches!(
        result.commands.first(),
        Some(ClientCommand::InviteToParty { target }) if *target == Guid(0x50000042)
    ));
}

#[test]
fn uninvite_from_party_action_dispatches_client_command() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let result = state
        .handle_action(AppAction::UninviteFromParty {
            target: Guid(0x50000042),
        })
        .unwrap();

    assert!(matches!(
        result.commands.first(),
        Some(ClientCommand::UninviteFromParty { target }) if *target == Guid(0x50000042)
    ));
}

#[test]
fn projected_fellowship_state_updates_game_data() {
    let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
    let fellowship = holtburger_world::state::FellowshipState {
        name: "Raid Bus".to_string(),
        leader_guid: Guid(0x50000001),
        share_xp: true,
        even_share: false,
        open: true,
        is_locked: false,
        members: vec![holtburger_world::state::FellowshipMemberState {
            guid: Guid(0x50000001),
            name: "Player".to_string(),
            level: 42,
            cached_cp: 0,
            cached_luminance: 0,
            max_health: 200,
            max_stamina: 180,
            max_mana: 160,
            current_health: 190,
            current_stamina: 170,
            current_mana: 150,
            share_loot: true,
        }],
        departed_members: Vec::new(),
        locks: Vec::new(),
    };

    let result = state.handle_view_event(ClientViewEvent::FellowshipStateUpdated {
        fellowship: Some(fellowship.clone()),
    });

    assert!(result.redraw_requested());
    assert!(result.actions.is_empty());
    assert_eq!(state.data.party, Some(fellowship));
}

#[test]
fn accepted_fellowship_invite_opens_party_tab_on_next_state_update() {
    let mut state = GameState::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
    state.view.active_confirmation = Some(ActiveCharacterConfirmation {
        confirmation_type: ConfirmationType::Fellowship,
        context: 42,
        text: "Leader".to_string(),
    });
    state.update_layout(ratatui::layout::Rect::new(0, 0, 120, 80));

    let accept_result = state.handle_input(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));

    assert!(accept_result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::RespondToConfirmation { accepted: true }
        )
    }));

    let fellowship = holtburger_world::state::FellowshipState {
        name: "Raid Bus".to_string(),
        leader_guid: Guid(0x50000002),
        share_xp: true,
        even_share: false,
        open: true,
        is_locked: false,
        members: vec![holtburger_world::state::FellowshipMemberState {
            guid: Guid(0x50000001),
            name: "Player".to_string(),
            level: 42,
            cached_cp: 0,
            cached_luminance: 0,
            max_health: 200,
            max_stamina: 180,
            max_mana: 160,
            current_health: 190,
            current_stamina: 170,
            current_mana: 150,
            share_loot: true,
        }],
        departed_members: Vec::new(),
        locks: Vec::new(),
    };

    let result = state.handle_view_event(ClientViewEvent::FellowshipStateUpdated {
        fellowship: Some(fellowship.clone()),
    });

    assert!(result.redraw_requested());
    assert!(result.actions.iter().any(|action| {
        matches!(
            action,
            AppAction::UiAction {
                action: AppUiAction::SetDashboardActiveTab(DashboardTab::Party)
            }
        )
    }));
    assert_eq!(state.data.party, Some(fellowship));
    assert!(!state.runtime.open_party_tab_on_next_fellowship_update);
}
