use super::test_support::*;
use super::*;
use holtburger_core::client::movement_types::PlayerDriveIntent;

#[test]
fn player_movement_event_does_not_immediately_redrive_approach() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let start_pos = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    state.data.player_pos = Some(start_pos);
    state.data.entities.insert(
        player_guid,
        Entity::new(player_guid, "Player".to_string(), start_pos),
    );

    let target_pos = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_pos),
    );
    let _ = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();

    let moved_pos = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(0.2, 0.0, 0.0),
        ..WorldPosition::default()
    };
    let result = state.handle_view_event(ClientViewEvent::EntityMoved {
        guid: player_guid,
        pos: moved_pos,
    });

    assert!(result.commands.is_empty());
    assert_eq!(state.data.player_pos, Some(moved_pos));
    assert!(has_active_approach(&state));
}

#[test]
fn navigation_sync_input_prefers_runtime_body_mirror_for_player_and_keeps_target_poses() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let authoritative_player = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    let authoritative_target = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(20.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    let runtime_player = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(4.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    let runtime_target = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };

    state.data.player_pos = Some(authoritative_player);
    state.data.entities.insert(
        player_guid,
        Entity::new(player_guid, "Player".to_string(), authoritative_player),
    );
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", authoritative_target),
    );

    let _ = state.handle_view_event(ClientViewEvent::RuntimeBodyUpserted {
        body: Box::new(runtime_body_view(
            SpatialBodyId::LocalPlayer(player_guid),
            authoritative_player,
            runtime_player,
        )),
    });
    let _ = state.handle_view_event(ClientViewEvent::RuntimeBodyUpserted {
        body: Box::new(runtime_body_view(
            SpatialBodyId::Entity(target_guid),
            authoritative_target,
            runtime_target,
        )),
    });

    let snapshot =
        super::super::navigation::navigation_snapshot_for_tests(&state, Some(target_guid));
    let input = NavigationSyncInput {
        now: Instant::now(),
        player_position: snapshot.player_position,
        target: snapshot.tracked_target,
        self_movement_kinematics: snapshot.self_movement_kinematics,
        run_rate_scalar: snapshot.run_rate_scalar,
    };
    let target = input.target.expect("target sample should exist");

    assert_eq!(input.player_position, Some(runtime_player));
    assert_eq!(target.sample.authoritative_pose, authoritative_target);
    assert_eq!(target.sample.projected_pose, runtime_target);
}

#[test]
fn navigation_snapshot_includes_projected_self_movement_kinematics() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    let kinematics = SelfMovementKinematics {
        source: PlayerMotionTableSource::DirectProperty {
            motion_table_id: 0x0900_0020,
        },
        motion_table_id: 0x0900_0020,
        stance: 0x8000_003D,
        base_walk_forward_velocity: Vector3::new(1.0, 0.0, 0.0),
        base_run_forward_velocity: Vector3::new(2.0, 0.0, 0.0),
        base_turn_left_omega: Vector3::new(0.0, 0.0, -1.5),
        base_turn_right_omega: Vector3::new(0.0, 0.0, 1.5),
    };

    let result = state.handle_view_event(ClientViewEvent::SelfMovementKinematicsUpdated {
        kinematics: Some(kinematics.clone()),
    });

    assert!(result.commands.is_empty());
    let snapshot = super::super::navigation::navigation_snapshot_for_tests(&state, None);
    assert_eq!(snapshot.self_movement_kinematics, Some(kinematics));
}

#[test]
fn sticky_melee_pursuit_survives_transient_attack_drive_cancellation_when_engagement_remains_desired()
 {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.combat_mode = CombatMode::Melee;
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });
    state
        .data
        .combat_runtime
        .begin_explicit_engagement(target_guid, CombatMode::Melee);
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(1.5, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let result = state.handle_tick(0.016);

    assert!(has_autonomous_navigation_command(&result));
    assert!(!has_active_approach(&state));
    assert!(matches!(
        state.runtime.navigation.navigation_mode(),
        Some(NavigationMode::StickyMelee { target }) if target == target_guid
    ));
}

#[test]
fn handle_tick_emits_autonomous_drive_for_active_approach() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let _ = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();

    let result = state.handle_tick(0.1);

    assert!(result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::DriveSelf(PlayerDriveIntent::Autonomous(intent))
                if intent.force_grounded
                    && intent.desired_heading == Some(180.0f32.to_radians())
                    && intent.desired_world_delta.x > 0.0
        )
    }));
}

#[test]
fn handle_tick_emits_stop_when_navigation_drive_goes_idle() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let _ = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();

    let first_tick = state.handle_tick(0.1);
    assert!(has_autonomous_navigation_command(&first_tick));

    let _ = state.handle_view_event(ClientViewEvent::EntityMoved {
        guid: target_guid,
        pos: WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(0.2, 0.0, 0.0),
            ..WorldPosition::default()
        },
    });

    let result = state.handle_tick(0.1);

    assert!(has_arrival_navigation_command(&result));
}

#[test]
fn forced_reposition_cancels_frontend_owned_approach_controller() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let started = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();
    assert!(!started.commands.iter().any(is_navigation_drive_command));
    assert!(has_active_approach(&state));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Approaching { target_guid })
    );

    let driving_tick = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&driving_tick));

    let result = state.handle_view_event(ClientViewEvent::ForcedReposition {
        guid: player_guid,
        pos: WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(10.0, 0.0, 0.0),
            ..WorldPosition::default()
        },
        sequence: 42,
    });

    assert!(has_stop_navigation_command(&result));
    assert!(!has_active_approach(&state));
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn forced_reposition_keeps_follow_interaction_while_follow_is_paused() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let _ = state
        .handle_action(AppAction::Follow { guid: target_guid })
        .unwrap();

    let driving_tick = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&driving_tick));

    let result = state.handle_view_event(ClientViewEvent::ForcedReposition {
        guid: player_guid,
        pos: WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(10.0, 0.0, 0.0),
            ..WorldPosition::default()
        },
        sequence: 42,
    });

    assert!(has_stop_navigation_command(&result));
    assert!(matches!(
        state.runtime.navigation.navigation_mode(),
        Some(NavigationMode::Follow { .. })
    ));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Following { target_guid })
    );
}

#[test]
fn remote_forced_reposition_updates_target_position_and_restarts_follow_when_out_of_range() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    state.data.entities.insert(
        target_guid,
        creature_entity(
            target_guid,
            "Drudge",
            WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: Vector3::new(0.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
        ),
    );

    let _ = state
        .handle_action(AppAction::Follow { guid: target_guid })
        .unwrap();

    let event_result = state.handle_view_event(ClientViewEvent::ForcedReposition {
        guid: target_guid,
        pos: WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(6.0, 0.0, 0.0),
            ..WorldPosition::default()
        },
        sequence: 42,
    });

    assert!(event_result.redraw_requested());

    assert_eq!(
        state
            .data
            .entities
            .get(&target_guid)
            .unwrap()
            .position
            .coords
            .x,
        6.0
    );

    let tick_result = state.handle_tick(0.016);

    assert!(has_autonomous_navigation_command(&tick_result));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Following { target_guid })
    );
}

#[test]
fn follow_keeps_interaction_after_arrival_and_restarts_when_target_moves() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let started = state
        .handle_action(AppAction::Follow { guid: target_guid })
        .unwrap();

    assert!(!started.commands.iter().any(is_navigation_movement_command));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Following { target_guid })
    );

    let first_tick = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&first_tick));

    let in_range_event = state.handle_view_event(ClientViewEvent::EntityMoved {
        guid: target_guid,
        pos: WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(0.0, 0.0, 0.0),
            ..WorldPosition::default()
        },
    });

    assert!(in_range_event.redraw_requested());

    let in_range_tick = state.handle_tick(0.016);

    assert!(has_arrival_navigation_command(&in_range_tick));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Following { target_guid })
    );

    let slipped_event = state.handle_view_event(ClientViewEvent::EntityMoved {
        guid: target_guid,
        pos: WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(6.0, 0.0, 0.0),
            ..WorldPosition::default()
        },
    });

    assert!(slipped_event.redraw_requested());

    let slipped_tick = state.handle_tick(0.016);

    assert!(has_autonomous_navigation_command(&slipped_tick));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Following { target_guid })
    );
}

#[test]
fn cancel_interaction_stops_active_follow_and_clears_mode() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let _ = state
        .handle_action(AppAction::Follow { guid: target_guid })
        .unwrap();

    let driving_tick = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&driving_tick));

    let result = state.handle_action(AppAction::CancelInteraction).unwrap();

    assert!(has_stop_navigation_command(&result));
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn switching_from_follow_to_approach_stops_follow_before_new_drive() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let _ = state
        .handle_action(AppAction::Follow { guid: target_guid })
        .unwrap();

    let result = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();

    assert!(!result.commands.iter().any(is_navigation_movement_command));
    assert!(has_active_approach(&state));
    assert!(!matches!(
        state.runtime.navigation.navigation_mode(),
        Some(NavigationMode::Follow { .. })
    ));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Approaching { target_guid })
    );

    let tick_result = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&tick_result));
}

#[test]
fn teleport_start_cancels_frontend_owned_approach_controller() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let started = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();
    assert!(!started.commands.iter().any(is_navigation_movement_command));
    assert!(has_active_approach(&state));

    let driving_tick = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&driving_tick));

    let result = state.handle_view_event(ClientViewEvent::TeleportStarted { sequence: 7 });

    assert!(has_stop_navigation_command(&result));
    assert!(!has_active_approach(&state));
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn teleport_start_clears_sticky_melee_targeting_and_attack() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.issue_state = crate::pages::game::combat::CombatIssueState::InFlight;
    state
        .data
        .combat_runtime
        .begin_explicit_engagement(target_guid, CombatMode::Melee);

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(1.5, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let initial = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&initial));

    let result = state.handle_view_event(ClientViewEvent::TeleportStarted { sequence: 8 });

    assert!(has_stop_navigation_command(&result));
    assert!(
        result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::CancelAttack) })
    );
    assert_eq!(state.view.active_interaction, None);
    assert_ne!(
        state.data.combat_runtime.issue_state,
        crate::pages::game::combat::CombatIssueState::InFlight
    );
    assert_eq!(state.data.combat_runtime.sticky_melee_target(), None);

    let post_teleport_tick = state.handle_tick(0.016);
    assert!(!has_autonomous_navigation_command(&post_teleport_tick));
}

#[test]
fn cancel_interaction_stops_active_approach_and_clears_mode() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let _ = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();

    let driving_tick = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&driving_tick));

    assert!(has_active_approach(&state));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Approaching { target_guid })
    );

    let result = state.handle_action(AppAction::CancelInteraction).unwrap();

    assert!(has_stop_navigation_command(&result));
    assert!(!has_active_approach(&state));
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn target_moving_beyond_tracking_distance_cancels_active_approach() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let started = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();
    assert!(!started.commands.iter().any(is_navigation_movement_command));
    assert!(has_active_approach(&state));

    let first_tick = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&first_tick));

    let event_result = state.handle_view_event(ClientViewEvent::EntityMoved {
        guid: target_guid,
        pos: WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(385.0, 0.0, 0.0),
            ..WorldPosition::default()
        },
    });

    assert!(event_result.redraw_requested());
    assert!(has_active_approach(&state));

    let tick_result = state.handle_tick(0.016);

    assert!(has_stop_navigation_command(&tick_result));
    assert!(!has_active_approach(&state));
}

#[test]
fn ordinary_navigation_world_churn_reconciles_on_next_tick() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    state.data.entities.insert(
        target_guid,
        creature_entity(
            target_guid,
            "Drudge",
            WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: Vector3::new(5.0, 0.0, 0.0),
                ..WorldPosition::default()
            },
        ),
    );

    let _ = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();

    let moved = state.handle_view_event(ClientViewEvent::EntityMoved {
        guid: target_guid,
        pos: WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(385.0, 0.0, 0.0),
            ..WorldPosition::default()
        },
    });

    assert!(moved.redraw_requested());
    assert!(has_active_approach(&state));

    let _ = state.handle_tick(0.016);

    assert!(!has_active_approach(&state));
}

#[test]
fn repeated_start_approach_reuses_existing_controller_for_same_target() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    seed_navigation_motion_model(&mut state);
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(180.0f32.to_radians()),
        ..WorldPosition::default()
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let first = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();

    assert!(first.commands.is_empty());

    let first_tick = state.handle_tick(0.016);
    assert!(has_autonomous_navigation_command(&first_tick));

    let second = state
        .handle_action(AppAction::Approach { guid: target_guid })
        .unwrap();

    assert!(second.commands.is_empty());
    assert!(has_active_approach(&state));
}
