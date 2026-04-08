use super::test_support::*;
use super::*;

#[test]
fn set_combat_mode_with_valid_target_queues_melee_attack() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };

    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let result = state
        .handle_action(AppAction::SetCombatMode {
            mode: CombatMode::Melee,
        })
        .unwrap();

    assert!(matches!(
        result.commands.first(),
        Some(ClientCommand::SetCombatMode(CombatMode::Melee))
    ));
    assert!(matches!(
        result.commands.get(1),
        Some(ClientCommand::TargetedMeleeAttack {
            target,
            attack_height: AttackHeight::Medium,
            power_level,
        }) if *target == target_guid && (*power_level - 0.5).abs() < f32::EPSILON
    ));
}

#[test]
fn combat_feedback_updates_auto_attack_runtime_state() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let commenced = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackCommenced,
    ));

    assert!(commenced.redraw_requested());
    assert!(!state.data.combat_runtime.attack_queued);
    assert!(state.data.combat_runtime.attack_sequence_active);

    let done = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::None,
        },
    ));

    assert!(done.redraw_requested());
    assert!(state.data.combat_runtime.attack_queued);
    assert!(!state.data.combat_runtime.attack_sequence_active);

    let cancelled = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::ActionCancelled,
        },
    ));

    assert!(cancelled.redraw_requested());
    assert!(!state.data.combat_runtime.attack_queued);
    assert!(!state.data.combat_runtime.attack_sequence_active);
}

#[test]
fn begin_targeting_in_missile_mode_queues_missile_attack() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Missile;
    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };

    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Tusker", target_position),
    );

    let result = state
        .handle_action(AppAction::BeginInteraction {
            interaction: Interaction::Targeting { target_guid },
        })
        .unwrap();

    assert!(state.data.combat_runtime.attack_queued);

    assert!(result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::TargetedMissileAttack {
                target,
                attack_height: AttackHeight::Medium,
                accuracy_level,
            } if *target == target_guid && (*accuracy_level - 0.5).abs() < f32::EPSILON
        )
    }));
}

#[test]
fn combat_control_actions_cycle_defaults() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    assert_eq!(state.data.combat_controls.profile_level.wire_value(), 0.5);
    assert_eq!(state.data.combat_controls.attack_height, AttackHeight::Medium);

    state
        .handle_action(AppAction::CycleCombatProfileLevel)
        .unwrap();
    state
        .handle_action(AppAction::CycleCombatAttackHeight)
        .unwrap();

    assert_eq!(state.data.combat_controls.profile_level.wire_value(), 1.0);
    assert_eq!(state.data.combat_controls.attack_height, AttackHeight::High);
}

#[test]
fn cycling_profile_while_targeting_resends_melee_attack_with_new_power() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let result = state
        .handle_action(AppAction::CycleCombatProfileLevel)
        .unwrap();

    assert!(state.data.combat_runtime.attack_queued);

    assert!(result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::TargetedMeleeAttack {
                target,
                attack_height: AttackHeight::Medium,
                power_level,
            } if *target == target_guid && (*power_level - 1.0).abs() < f32::EPSILON
        )
    }));
}

#[test]
fn cycling_height_while_targeting_resends_missile_attack_with_new_height() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Missile;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Tusker", target_position),
    );

    let result = state
        .handle_action(AppAction::CycleCombatAttackHeight)
        .unwrap();

    assert!(state.data.combat_runtime.attack_queued);

    assert!(result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::TargetedMissileAttack {
                target,
                attack_height: AttackHeight::High,
                accuracy_level,
            } if *target == target_guid && (*accuracy_level - 0.5).abs() < f32::EPSILON
        )
    }));
}

#[test]
fn switching_from_targeting_to_non_targeting_cancels_attack() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Missile;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let result = state
        .handle_action(AppAction::BeginInteraction {
            interaction: Interaction::Combining {
                item_guid: Guid(0x70000001),
            },
        })
        .unwrap();

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack))
    );
    assert!(matches!(
        state.view.active_interaction,
        Some(Interaction::Combining { item_guid }) if item_guid == Guid(0x70000001)
    ));
}

#[test]
fn switching_to_targeting_in_combat_mode_resumes_attack() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let result = state
        .handle_action(AppAction::BeginInteraction {
            interaction: Interaction::Targeting { target_guid },
        })
        .unwrap();

    assert!(result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::TargetedMeleeAttack {
                target,
                attack_height: AttackHeight::Medium,
                power_level,
            } if *target == target_guid && (*power_level - 0.5).abs() < f32::EPSILON
        )
    }));
}

#[test]
fn switching_targets_retargets_attack_sequence() {
    let player_guid = Guid(0x50000001);
    let first_target_guid = Guid(0x60000001);
    let second_target_guid = Guid(0x60000002);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.attack_sequence_active = true;
    state.view.active_interaction = Some(Interaction::Targeting {
        target_guid: first_target_guid,
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };

    state.data.entities.insert(
        first_target_guid,
        creature_entity(first_target_guid, "Drudge", target_position),
    );
    state.data.entities.insert(
        second_target_guid,
        creature_entity(second_target_guid, "Shreth", target_position),
    );

    let result = state
        .handle_action(AppAction::BeginInteraction {
            interaction: Interaction::Targeting {
                target_guid: second_target_guid,
            },
        })
        .unwrap();

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack))
    );
    assert!(result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::TargetedMeleeAttack { target, .. } if *target == second_target_guid
        )
    }));
    assert!(state.data.combat_runtime.attack_queued);
    assert!(!state.data.combat_runtime.attack_sequence_active);
}

#[test]
fn targeting_creature_item_type_without_profile_still_starts_attack() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };

    let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
    target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    target.set_bool_prop(PropertyBool::Attackable, true);
    state.data.entities.insert(target_guid, target);

    let result = state
        .handle_action(AppAction::BeginInteraction {
            interaction: Interaction::Targeting { target_guid },
        })
        .unwrap();

    assert!(result.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
    }));
}

#[test]
fn handle_tick_refreshes_stale_queued_attack_sequence() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
    target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    target.set_bool_prop(PropertyBool::Attackable, true);
    state.data.entities.insert(target_guid, target);

    let now = Instant::now();
    let mut seeded = UpdateResult::new();
    super::super::combat::sync_combat_automation(
        &mut state,
        now,
        CombatMode::Melee,
        true,
        &mut seeded,
    );
    state.data.combat_runtime.attack_queued = true;
    state.data.combat_runtime.attack_sequence_active = false;

    let mut result = UpdateResult::new();
    super::super::combat::refresh_stale_attack_sequence(
        &mut state,
        now + Duration::from_secs(1) + Duration::from_millis(1),
        &mut result,
    );

    assert!(result.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
    }));
    assert!(state.data.combat_runtime.attack_queued);
}

#[test]
fn handle_tick_retries_cancelled_attack_after_combat_mode_reentry() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::NonCombat;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
    target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    target.set_bool_prop(PropertyBool::Attackable, true);
    state.data.entities.insert(target_guid, target);

    state.data.combat_runtime.queue_attack();

    let cancelled = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::ActionCancelled,
        },
    ));

    assert!(
        !cancelled
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMeleeAttack { .. }) })
    );
    assert!(!state.data.combat_runtime.attack_queued);

    state.data.combat_mode = CombatMode::Melee;

    let mut retry = UpdateResult::new();
    super::super::combat::refresh_stale_attack_sequence(&mut state, Instant::now(), &mut retry);

    assert!(retry.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
    }));
    assert!(state.data.combat_runtime.attack_queued);
}

#[test]
fn death_motion_blocks_stale_attack_refresh_for_targeted_creature() {
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::EntityMotionSnapshot;

    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
    target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    target.set_bool_prop(PropertyBool::Attackable, true);
    state.data.entities.insert(target_guid, target);

    let now = Instant::now();
    let mut seeded = UpdateResult::new();
    super::super::combat::sync_combat_automation(
        &mut state,
        now,
        CombatMode::Melee,
        true,
        &mut seeded,
    );
    state.data.combat_runtime.attack_queued = true;
    state.data.combat_runtime.attack_sequence_active = false;

    let _ = state.handle_view_event(ClientViewEvent::EntityMotionUpdated {
        guid: target_guid,
        snapshot: Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::DEAD),
            sidestep_command: None,
            turn_command: None,
            ..Default::default()
        }),
    });

    let mut result = UpdateResult::new();
    super::super::combat::refresh_stale_attack_sequence(
        &mut state,
        now + Duration::from_secs(1) + Duration::from_millis(1),
        &mut result,
    );

    assert!(!result.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
    }));
}

#[test]
fn switching_to_non_creature_target_cancels_attack_sequence() {
    let player_guid = Guid(0x50000001);
    let creature_guid = Guid(0x60000001);
    let non_creature_guid = Guid(0x70000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.attack_sequence_active = true;
    state.view.active_interaction = Some(Interaction::Targeting {
        target_guid: creature_guid,
    });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };

    state.data.entities.insert(
        creature_guid,
        creature_entity(creature_guid, "Drudge", target_position),
    );

    let mut chest = Entity::new(non_creature_guid, "Chest".to_string(), target_position);
    chest.set_bool_prop(PropertyBool::Attackable, true);
    state.data.entities.insert(non_creature_guid, chest);

    let result = state
        .handle_action(AppAction::BeginInteraction {
            interaction: Interaction::Targeting {
                target_guid: non_creature_guid,
            },
        })
        .unwrap();

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack))
    );
    assert!(!result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::TargetedMeleeAttack { .. } | ClientCommand::TargetedMissileAttack { .. }
        )
    }));
    assert!(!state.data.combat_runtime.attack_queued);
    assert!(!state.data.combat_runtime.attack_sequence_active);
}

#[test]
fn far_target_does_not_start_attack_automation() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    });
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(385.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let mut result = UpdateResult::new();
    super::super::combat::sync_combat_automation(
        &mut state,
        Instant::now(),
        CombatMode::Melee,
        true,
        &mut result,
    );

    assert!(!result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::TargetedMeleeAttack { .. } | ClientCommand::TargetedMissileAttack { .. }
        ) || is_snap_facing_command(command)
    }));
    assert!(!state.data.combat_runtime.attack_queued);
}

#[test]
fn cancelled_attack_does_not_rearm_after_explicit_cancel() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.attack_sequence_active = true;
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

    let _ = state.handle_action(AppAction::CancelInteraction).unwrap();

    let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::ActionCancelled,
        },
    ));

    assert!(!result.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { .. }) || is_run_movement_command(command)
    }));
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn cancelled_attack_does_not_rearm_after_target_death_motion() {
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::EntityMotionSnapshot;

    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.attack_sequence_active = true;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(1.5, 0.0, 0.0),
        ..WorldPosition::default()
    };
    let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
    target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    target.set_bool_prop(PropertyBool::Attackable, true);
    target.motion_snapshot = Some(EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::DEAD),
        sidestep_command: None,
        turn_command: None,
        ..Default::default()
    });
    state.data.entities.insert(target_guid, target);

    let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::ActionCancelled,
        },
    ));

    assert!(!result.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { .. }) || is_run_movement_command(command)
    }));

    let mut stale = UpdateResult::new();
    super::super::combat::refresh_stale_attack_sequence(
        &mut state,
        Instant::now() + Duration::from_secs(2),
        &mut stale,
    );

    assert!(!stale.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { .. }) || is_run_movement_command(command)
    }));
}

#[test]
fn cancelled_attack_does_not_rearm_after_player_death_motion() {
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::EntityMotionSnapshot;

    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.attack_sequence_active = true;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(1.5, 0.0, 0.0),
        ..WorldPosition::default()
    };
    let mut target = Entity::new(target_guid, "Drudge".to_string(), target_position);
    target.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    target.set_bool_prop(PropertyBool::Attackable, true);
    state.data.entities.insert(target_guid, target);

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.motion_snapshot = Some(EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::DEAD),
        sidestep_command: None,
        turn_command: None,
        ..Default::default()
    });
    state.data.entities.insert(player_guid, player);

    let result = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::ActionCancelled,
        },
    ));

    assert!(!result.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { .. }) || is_run_movement_command(command)
    }));
}

#[test]
fn despawning_target_clears_targeting_interaction() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    state.view.active_interaction = Some(Interaction::Targeting { target_guid });
    let _ = state.handle_view_event(ClientViewEvent::EntityDespawned { guid: target_guid });

    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn despawning_target_sends_cancel_attack_when_targeting_it() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.attack_queued = true;
    state.data.combat_runtime.attack_sequence_active = true;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let result = state.handle_view_event(ClientViewEvent::EntityDespawned { guid: target_guid });

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack))
    );
    assert_eq!(state.view.active_interaction, None);
    assert!(!state.data.combat_runtime.attack_queued);
    assert!(!state.data.combat_runtime.attack_sequence_active);
}

#[test]
fn cancel_interaction_sends_cancel_attack_when_leaving_targeting() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.attack_queued = true;
    state.data.combat_runtime.attack_sequence_active = true;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let result = state.handle_action(AppAction::CancelInteraction).unwrap();

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack))
    );
    assert_eq!(state.view.active_interaction, None);
    assert!(!state.data.combat_runtime.attack_queued);
    assert!(!state.data.combat_runtime.attack_sequence_active);
}

#[test]
fn missile_targeting_turns_before_reissuing_attack_when_not_facing() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Missile;
    state.data.player_pos = Some(WorldPosition {
        landblock_id: Guid(0x01000000),
        rotation: Quaternion::from_heading(0.0),
        ..WorldPosition::default()
    });
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(0.0, 10.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Tusker", target_position),
    );

    let now = Instant::now();
    let mut turn = UpdateResult::new();
    super::super::combat::sync_combat_automation(
        &mut state,
        now,
        CombatMode::Missile,
        true,
        &mut turn,
    );

    assert!(turn.commands.iter().any(is_snap_facing_command));
    assert!(
        !turn
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMissileAttack { .. }) })
    );
}