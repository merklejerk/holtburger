use super::*;
use holtburger_core::client::motion::steering::{
    LocalNavigationFinished, LocalNavigationOutcome, LocalSteeringGoal,
};

#[test]
fn approach_action_delegates_to_core_local_steering_and_sets_interaction() {
    let player_guid = Guid(0x5000_0001);
    let target_guid = Guid(0x6000_0001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let result = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();

    assert!(result.commands.iter().any(|command| matches!(
        command,
        ClientCommand::StartLocalSteering(req)
            if matches!(req.goal, LocalSteeringGoal::Approach { target, .. } if target == target_guid)
    )));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Approaching { target_guid })
    );
}

#[test]
fn follow_action_delegates_to_core_local_steering_and_cancel_stops_it() {
    let player_guid = Guid(0x5000_0001);
    let target_guid = Guid(0x6000_0001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let started = state
        .handle_action(AppAction::Follow { guid: target_guid })
        .unwrap();
    assert!(started.commands.iter().any(|command| matches!(
        command,
        ClientCommand::StartLocalSteering(req)
            if matches!(req.goal, LocalSteeringGoal::Follow { target, .. } if target == target_guid)
    )));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Following { target_guid })
    );

    let cancelled = state.handle_action(AppAction::CancelInteraction).unwrap();
    let stop_count = cancelled
        .commands
        .iter()
        .filter(|command| matches!(command, ClientCommand::StopLocalSteering))
        .count();
    assert_eq!(
        stop_count, 1,
        "CancelInteraction should emit exactly one StopLocalSteering"
    );
    assert_eq!(state.view.active_interaction, None);

    // Terminal LocalNavigationFinished should clear interaction without emitting a spurious StopLocalSteering.
    let _ = state
        .handle_action(AppAction::Follow { guid: target_guid })
        .unwrap();
    let finished =
        state.handle_view_event(holtburger_core::ClientViewEvent::LocalNavigationFinished(
            holtburger_core::client::steering::LocalNavigationFinished {
                correlation_id: 1,
                outcome: holtburger_core::client::steering::LocalNavigationOutcome::Arrived,
            },
        ));
    assert!(
        !finished
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::StopLocalSteering))
    );
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn scoot_action_projects_forward_destination_to_core_move_to() {
    let player_guid = Guid(0x5000_0001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    let start = WorldPosition {
        landblock_id: Guid(0x0100_0000),
        coords: Vector3::new(10.0, 20.0, 0.0),
        rotation: Quaternion::from_heading(0.0),
    };
    state.data.player_pos = Some(start);
    let expected = holtburger_world::project_pose_forward_distance(start, 4.0);

    let result = state
        .handle_action(AppAction::Scoot { distance_m: 4.0 })
        .unwrap();

    assert!(result.commands.iter().any(|command| matches!(
        command,
        ClientCommand::StartLocalSteering(req)
            if matches!(req.goal, LocalSteeringGoal::MoveTo { destination, .. }
                if destination.distance_to(&expected) < 0.01)
    )));
}

#[test]
fn local_navigation_finished_event_clears_steering_interaction() {
    let player_guid = Guid(0x5000_0001);
    let target_guid = Guid(0x6000_0001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let _ = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Approaching { target_guid })
    );

    let _ = state.handle_view_event(ClientViewEvent::LocalNavigationFinished(
        LocalNavigationFinished {
            correlation_id: 1,
            outcome: LocalNavigationOutcome::Arrived,
        },
    ));
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn teleport_start_clears_targeting_and_retires_attack() {
    let player_guid = Guid(0x5000_0001);
    let target_guid = Guid(0x6000_0001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let result = state.handle_view_event(ClientViewEvent::TeleportStarted { sequence: 8 });

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::StopCombatEngagement { .. }))
    );
    assert_eq!(state.view.active_interaction, None);
}
