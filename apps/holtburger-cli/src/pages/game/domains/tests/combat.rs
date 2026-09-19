use super::test_support::*;
use super::*;

fn attackable_target(state: &mut GameState, target_guid: Guid) {
    let target_position = WorldPosition {
        landblock_id: Guid(0x0100_0000),
        ..WorldPosition::default()
    };
    let mut target = creature_entity(target_guid, "Drudge", target_position);
    target.set_bool_prop(PropertyBool::Attackable, true);
    state.data.entities.insert(target_guid, target);
}

#[test]
fn explicit_attack_delegates_one_engagement_to_core() {
    let target_guid = Guid(0x6000_0001);
    let mut state = GameState::new(Guid(0x5000_0001), "Player".to_string(), "World".to_string());
    attackable_target(&mut state, target_guid);

    let result = state
        .handle_action(AppAction::Attack { guid: target_guid })
        .unwrap();

    assert!(result.commands.iter().any(|command| matches!(
        command,
        ClientCommand::BeginCombatEngagement {
            target,
            profile: holtburger_core::ClientAttackProfile::Melee {
                height: AttackHeight::Medium,
                power,
            },
        } if *target == target_guid && (*power - 0.5).abs() < f32::EPSILON
    )));
    assert_eq!(
        state.view.active_interaction,
        Some(Interaction::Targeting { target_guid })
    );
    assert!(state.handle_tick(0.016).commands.is_empty());
}

#[test]
fn active_profile_change_updates_the_shared_owner() {
    let mut state = GameState::new(Guid(0x5000_0001), "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.data.combat_status.desired = Some(holtburger_core::ClientCombatEngagement {
        target: Guid(0x6000_0001),
        profile: holtburger_core::ClientAttackProfile::Melee {
            height: AttackHeight::Medium,
            power: 0.5,
        },
    });

    let result = state
        .handle_action(AppAction::CycleCombatProfileLevel)
        .unwrap();

    assert!(result.commands.iter().any(|command| matches!(
        command,
        ClientCommand::UpdateCombatProfile(holtburger_core::ClientAttackProfile::Melee {
            height: AttackHeight::Medium,
            power,
        }) if (*power - 1.0).abs() < f32::EPSILON
    )));
}

#[test]
fn leaving_targeting_stops_the_shared_engagement() {
    let target_guid = Guid(0x6000_0001);
    let mut state = GameState::new(Guid(0x5000_0001), "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;
    state.view.active_interaction = Some(Interaction::Targeting { target_guid });

    let result = state.handle_action(AppAction::CancelInteraction).unwrap();

    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::StopCombatEngagement))
    );
    assert_eq!(state.view.active_interaction, None);
}

#[test]
fn explicit_attack_rejects_a_non_creature() {
    let target_guid = Guid(0x7000_0001);
    let mut state = GameState::new(Guid(0x5000_0001), "Player".to_string(), "World".to_string());
    state.data.entities.insert(
        target_guid,
        Entity::new(target_guid, "Chest".to_string(), WorldPosition::default()),
    );

    let result = state
        .handle_action(AppAction::Attack { guid: target_guid })
        .unwrap();

    assert!(
        !result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::BeginCombatEngagement { .. }))
    );
}
