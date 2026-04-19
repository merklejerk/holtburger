use super::test_support::*;
use super::*;
use crate::pages::game::combat::{CombatIssueState, DesiredCombatEngagement};
use holtburger_core::client::movement_types::PlayerDriveIntent;
use holtburger_core::client::types::CombatFeedback;
use holtburger_protocol::messages::movement::messages::motion::{
    MoveToObject, MoveToParameters, Origin,
};
use holtburger_protocol::messages::{
    MotionStance, MovementEventData, MovementType, MovementTypeData,
};

#[test]
fn explicit_attack_from_peace_acquires_targeting_before_the_first_melee_swing() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };

    state.data.entities.insert(target_guid, {
        let mut target = creature_entity(target_guid, "Drudge", target_position);
        target.set_bool_prop(PropertyBool::Attackable, true);
        target
    });

    let result = state
        .handle_action(AppAction::Attack { guid: target_guid })
        .unwrap();

    assert!(
        result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::SetCombatMode(CombatMode::Melee)) })
    );
    assert!(
        !result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMeleeAttack { .. }) })
    );
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Targeting { target_guid })
    );
    assert_eq!(
        state.data.combat_runtime.desired_engagement(),
        Some(DesiredCombatEngagement {
            target_guid,
            mode: CombatMode::Melee,
        })
    );
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Ready
    );

    state.data.combat_mode = CombatMode::Melee;

    let mut tick_result = UpdateResult::new();
    crate::pages::game::combat::advance_combat_drive(&mut state, Instant::now(), &mut tick_result);

    assert!(tick_result.commands.iter().any(|command| {
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
fn targeted_spell_cast_snaps_facing_before_casting() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Magic;

    let player_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: Quaternion::identity(),
    };
    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(12.0, 0.0, 0.0),
        rotation: Quaternion::identity(),
    };

    state.data.player_pos = Some(player_position);
    state.data.entities.insert(
        target_guid,
        creature_entity(target_guid, "Drudge", target_position),
    );

    let result = state
        .handle_action(AppAction::CastSpell {
            spell_id: 42,
            target: Some(target_guid),
        })
        .unwrap();

    assert_eq!(result.commands.len(), 2);
    assert!(matches!(
        result.commands[0],
        ClientCommand::DriveSelf(PlayerDriveIntent::SnapFacing { heading })
            if (heading - player_position.heading_to(&target_position)).abs() < f32::EPSILON
    ));
    assert!(matches!(
        result.commands[1],
        ClientCommand::CastTargetedSpell { target, spell_id }
            if target == target_guid && spell_id == 42
    ));
}

#[test]
fn passive_targeting_does_not_create_engagement_intent() {
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
        matches!(command, ClientCommand::QueryHealth(guid) if *guid == target_guid)
    }));
    assert_eq!(state.data.combat_runtime.desired_engagement(), None);
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Idle
    );
    assert!(!state.data.combat_runtime.in_flight());
}

#[test]
fn explicit_attack_clears_preexisting_follow_navigation() {
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

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(5.0, 0.0, 0.0),
        ..WorldPosition::default()
    };
    state.data.entities.insert(target_guid, {
        let mut target = creature_entity(target_guid, "Drudge", target_position);
        target.set_bool_prop(PropertyBool::Attackable, true);
        target
    });

    let _ = state
        .handle_action(AppAction::Follow { guid: target_guid })
        .unwrap();
    let driving_tick = state.handle_tick(0.1);

    assert!(has_autonomous_navigation_command(&driving_tick));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Following { target_guid })
    );
    assert!(state.runtime.navigation.navigation_mode().is_some());

    let result = state
        .handle_action(AppAction::Attack { guid: target_guid })
        .unwrap();

    assert!(has_stop_navigation_command(&result));
    assert_eq!(state.runtime.navigation.navigation_mode(), None);
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Targeting { target_guid })
    );
}

#[test]
fn attack_feedback_updates_only_the_current_attack_drive_state() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state
        .data
        .combat_runtime
        .begin_explicit_engagement(Guid(0x60000001), CombatMode::Melee);
    state.data.combat_runtime.arm_attack_drive();

    let commenced = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackCommenced,
    ));

    assert!(commenced.redraw_requested());
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::InFlight
    );

    let done = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::None,
        },
    ));

    assert!(done.redraw_requested());
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Ready
    );

    let cancelled = state.handle_view_event(ClientViewEvent::CombatFeedback(
        CombatFeedback::AttackDone {
            error: holtburger_protocol::errors::WeenieError::ActionCancelled,
        },
    ));

    assert!(cancelled.redraw_requested());
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Idle
    );
}

#[test]
fn explicit_attack_rejects_targets_already_in_death_motion() {
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::EntityMotionSnapshot;

    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    let mut target = creature_entity(target_guid, "Drudge", target_position);
    target.set_bool_prop(PropertyBool::Attackable, true);
    target.motion_snapshot = Some(EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::DEAD),
        sidestep_command: None,
        turn_command: None,
        ..Default::default()
    });
    state.data.entities.insert(target_guid, target);

    let result = state
        .handle_action(AppAction::Attack { guid: target_guid })
        .unwrap();

    assert!(result.commands.is_empty());
    assert_eq!(state.view.active_interaction, None);
    assert_eq!(state.data.combat_runtime.desired_engagement(), None);
    assert!(result.actions.iter().any(|action| {
        matches!(
            action,
            AppAction::Log { message, .. }
                if message.contains("death animation")
        )
    }));
}

#[test]
fn targeting_in_missile_mode_does_not_fire_without_explicit_attack_intent() {
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

    assert!(!result.commands.iter().any(|command| {
        matches!(
            command,
            ClientCommand::TargetedMissileAttack {
                target,
                attack_height: AttackHeight::Medium,
                accuracy_level,
            } if *target == target_guid && (*accuracy_level - 0.5).abs() < f32::EPSILON
        )
    }));

    let mut tick_result = UpdateResult::new();
    crate::pages::game::combat::advance_combat_drive(&mut state, Instant::now(), &mut tick_result);

    assert!(
        !tick_result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMissileAttack { .. }) })
    );
}

#[test]
fn combat_control_actions_cycle_defaults() {
    let player_guid = Guid(0x50000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    assert_eq!(state.data.combat_controls.profile_level.wire_value(), 0.5);
    assert_eq!(
        state.data.combat_controls.attack_height,
        AttackHeight::Medium
    );

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
fn changing_melee_profile_while_engaged_waits_for_tick_reissue() {
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
    state
        .data
        .combat_runtime
        .begin_explicit_engagement(target_guid, CombatMode::Melee);
    state.data.combat_runtime.arm_attack_drive();

    let result = state
        .handle_action(AppAction::CycleCombatProfileLevel)
        .unwrap();

    assert!(
        !result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMeleeAttack { .. }) })
    );

    let mut tick_result = UpdateResult::new();
    crate::pages::game::combat::advance_combat_drive(&mut state, Instant::now(), &mut tick_result);

    assert!(tick_result.commands.iter().any(|command| {
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
fn changing_missile_height_while_engaged_waits_for_tick_reissue() {
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
    state
        .data
        .combat_runtime
        .begin_explicit_engagement(target_guid, CombatMode::Missile);
    state.data.combat_runtime.arm_attack_drive();

    let result = state
        .handle_action(AppAction::CycleCombatAttackHeight)
        .unwrap();

    assert!(
        !result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMissileAttack { .. }) })
    );

    let mut tick_result = UpdateResult::new();
    crate::pages::game::combat::advance_combat_drive(&mut state, Instant::now(), &mut tick_result);

    assert!(tick_result.commands.iter().any(|command| {
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
fn leaving_targeting_cancels_the_current_attack_drive() {
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
fn targeting_in_melee_mode_does_not_attack_until_explicitly_armed() {
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

    assert!(
        !result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMeleeAttack { .. }) })
    );

    let mut tick_result = UpdateResult::new();
    crate::pages::game::combat::advance_combat_drive(&mut state, Instant::now(), &mut tick_result);

    assert!(
        !tick_result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMeleeAttack { .. }) })
    );
}

#[test]
fn retargeting_cancels_the_current_attack_drive_until_rearmed() {
    let player_guid = Guid(0x50000001);
    let first_target_guid = Guid(0x60000001);
    let second_target_guid = Guid(0x60000002);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.issue_state = CombatIssueState::InFlight;
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
    assert!(
        result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::CancelAttack) })
    );
    assert!(
        !result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMeleeAttack { .. }) })
    );
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Idle
    );

    let mut tick_result = UpdateResult::new();
    crate::pages::game::combat::advance_combat_drive(&mut state, Instant::now(), &mut tick_result);

    assert!(
        !tick_result
            .commands
            .iter()
            .any(|command| { matches!(command, ClientCommand::TargetedMeleeAttack { .. }) })
    );
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Idle
    );
}

#[test]
fn explicit_attack_in_melee_mode_arms_a_followup_melee_swing_for_the_next_tick() {
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
        .handle_action(AppAction::Attack { guid: target_guid })
        .unwrap();

    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Targeting { target_guid })
    );
    assert!(!result.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
    }));

    let tick_result = state.handle_tick(0.016);
    assert!(tick_result.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
    }));
}

#[test]
fn cancelled_attack_stays_idle_across_combat_mode_reentry_until_rearmed() {
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

    state.data.combat_runtime.issue_state = CombatIssueState::Ready;

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
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Idle
    );

    state.data.combat_mode = CombatMode::Melee;

    let mut retry = UpdateResult::new();
    crate::pages::game::combat::advance_combat_drive(&mut state, Instant::now(), &mut retry);

    assert!(!retry.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
    }));
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Idle
    );
}

#[test]
fn retargeting_to_a_non_creature_cancels_engagement_without_reissue() {
    let player_guid = Guid(0x50000001);
    let creature_guid = Guid(0x60000001);
    let non_creature_guid = Guid(0x70000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.issue_state = CombatIssueState::InFlight;
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
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Idle
    );
}

#[test]
fn explicit_player_cancel_prevents_sticky_rearm() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.issue_state = CombatIssueState::InFlight;
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
        matches!(command, ClientCommand::TargetedMeleeAttack { .. })
            || is_run_movement_command(command)
    }));
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn pending_server_controlled_melee_move_suppresses_reissued_attack() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let attempted_at = Instant::now();
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let player_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        ..WorldPosition::default()
    };
    let target_position = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(3.0, 0.0, 0.0),
        ..WorldPosition::default()
    };

    state.data.player_pos = Some(player_position);
    state.data.entities.insert(
        player_guid,
        Entity::new(player_guid, "Player".to_string(), player_position),
    );
    state.data.entities.insert(target_guid, {
        let mut target = creature_entity(target_guid, "Drudge", target_position);
        target.set_bool_prop(PropertyBool::Attackable, true);
        target
    });
    state
        .data
        .combat_runtime
        .begin_explicit_engagement(target_guid, CombatMode::Melee);
    state.data.combat_runtime.arm_attack_drive();
    state.data.combat_runtime.note_attack_attempt(attempted_at);

    let _ = state.handle_view_event(ClientViewEvent::SelfServerControlledMotion {
        data: Box::new(MovementEventData {
            guid: player_guid,
            object_instance_sequence: 1,
            movement_sequence: 10,
            server_control_sequence: 2,
            is_autonomous: false,
            movement_type: MovementType::MoveToObject,
            motion_flags: 0,
            current_style: MotionStance::SwordCombat.interpreted(),
            data: MovementTypeData::MoveToObject(MoveToObject {
                target: target_guid,
                origin: Origin {
                    cell_id: target_position.landblock_id,
                    position: target_position.coords,
                },
                params: MoveToParameters {
                    distance_to_object: 0.6,
                    ..Default::default()
                },
                run_rate: 1.0,
            }),
        }),
    });

    let mut result = UpdateResult::new();
    crate::pages::game::combat::advance_combat_drive(
        &mut state,
        attempted_at + Duration::from_secs(2),
        &mut result,
    );

    assert!(!result.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { target, .. } if *target == target_guid)
    }));
}

#[test]
fn target_death_motion_prevents_sticky_rearm_after_cancel() {
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::EntityMotionSnapshot;

    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.issue_state = CombatIssueState::InFlight;
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
        matches!(command, ClientCommand::TargetedMeleeAttack { .. })
            || is_run_movement_command(command)
    }));

    let mut stale = UpdateResult::new();
    crate::pages::game::combat::advance_combat_drive(
        &mut state,
        Instant::now() + Duration::from_secs(2),
        &mut stale,
    );

    assert!(!stale.commands.iter().any(|command| {
        matches!(command, ClientCommand::TargetedMeleeAttack { .. })
            || is_run_movement_command(command)
    }));
}

#[test]
fn player_death_motion_prevents_sticky_rearm_after_cancel() {
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::entity::EntityMotionSnapshot;

    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.issue_state = CombatIssueState::InFlight;
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
        matches!(command, ClientCommand::TargetedMeleeAttack { .. })
            || is_run_movement_command(command)
    }));
}

#[test]
fn despawning_target_clears_targeting() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    state.view.active_interaction = Some(Interaction::Targeting { target_guid });
    let _ = state.handle_view_event(ClientViewEvent::EntityDespawned { guid: target_guid });

    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn despawning_target_cancels_attack_drive() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.issue_state = CombatIssueState::InFlight;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let result = state.handle_view_event(ClientViewEvent::EntityDespawned { guid: target_guid });

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack))
    );
    assert_eq!(state.view.active_interaction, None);
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Idle
    );
}

#[test]
fn cancel_interaction_leaves_targeting_and_cancels_attack_drive() {
    let player_guid = Guid(0x50000001);
    let target_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_runtime.issue_state = CombatIssueState::InFlight;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let result = state.handle_action(AppAction::CancelInteraction).unwrap();

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::CancelAttack))
    );
    assert_eq!(state.view.active_interaction, None);
    assert_eq!(
        state.data.combat_runtime.issue_state,
        CombatIssueState::Idle
    );
}
