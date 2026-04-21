use super::*;
use crate::WorldEvent;
use crate::WorldState;
use crate::entity::{Entity, EntityMotionDirective, EntityMotionSnapshot, OrderedMotionSpeed};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    EnchantmentTypeFlags, PropertyFloat, PropertyInt, WorldObjectPropertyAccessorsMut,
};
use holtburger_common::{CharacterOption, CharacterOptions1, CharacterOptions2};
use holtburger_protocol::messages::movement::VectorUpdateData;
use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
use holtburger_protocol::messages::{
    GameMessage, InterpretedMotionState, MovementEventData, MovementInvalid, MovementStateFlags,
    MovementType, MovementTypeData,
};

fn set_attr(player: &mut PlayerState, attr: stats::AttributeType, val: u32) {
    player.attributes.insert(
        attr,
        stats::Attribute {
            attr_type: attr,
            ranks: 0,
            start: val,
            spent_xp: 0,
            next_rank_xp: None,
            base: val,
            current: val,
        },
    );
}

#[test]
fn test_stat_calculations() {
    let mut player = PlayerState::new();

    // Setup attributes
    set_attr(&mut player, stats::AttributeType::StrengthAttr, 100);
    set_attr(&mut player, stats::AttributeType::EnduranceAttr, 100);
    set_attr(&mut player, stats::AttributeType::QuicknessAttr, 100);
    set_attr(&mut player, stats::AttributeType::CoordinationAttr, 100);
    set_attr(&mut player, stats::AttributeType::FocusAttr, 100);
    set_attr(&mut player, stats::AttributeType::SelfAttr, 100);

    // Test Vital Bonuses
    assert_eq!(
        player.calculate_vital_attribute_contribution(stats::VitalType::Health, false),
        50
    );
    assert_eq!(
        player.calculate_vital_attribute_contribution(stats::VitalType::Stamina, false),
        100
    );
    assert_eq!(
        player.calculate_vital_attribute_contribution(stats::VitalType::Mana, false),
        100
    );

    // Test Vital Base Calculation
    player.vital_bases.insert(
        stats::VitalType::Health,
        VitalBase {
            ranks: 50,
            start: 0,
        },
    );
    assert_eq!(player.calculate_vital_base(stats::VitalType::Health), 100);

    // Test Skill Math
    assert_eq!(
        player.derive_skill_value(stats::SkillType::MeleeDefense, 10, 4, false),
        81
    );
    assert_eq!(
        player.derive_skill_value(stats::SkillType::Run, 5, 0, false),
        105
    );
}

#[test]
fn test_resistance_derivation_matches_ace_player_rules() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000001);
    state.seed_local_player_entity(player_guid, "Player", WorldPosition::default());

    set_attr(&mut state.player, stats::AttributeType::StrengthAttr, 200);
    set_attr(&mut state.player, stats::AttributeType::EnduranceAttr, 200);
    state
        .player_entity_mut()
        .expect("local player entity should exist")
        .properties
        .set_float_prop(PropertyFloat::ResistFire, 1.0);
    state
        .player_entity_mut()
        .expect("local player entity should exist")
        .properties
        .set_int_prop(PropertyInt::AugmentationResistanceFire, 1);

    state.player.enchantments.push(Enchantment {
        spell_category: 10,
        power_level: 100,
        stat_mod_type: (EnchantmentTypeFlags::FLOAT
            | EnchantmentTypeFlags::SINGLE_STAT
            | EnchantmentTypeFlags::MULTIPLICATIVE)
            .bits(),
        stat_mod_key: PropertyFloat::ResistFire as u32,
        stat_mod_value: 0.8,
        ..Default::default()
    });

    state.player.enchantments.push(Enchantment {
        spell_category: 20,
        power_level: 100,
        stat_mod_type: (EnchantmentTypeFlags::FLOAT
            | EnchantmentTypeFlags::SINGLE_STAT
            | EnchantmentTypeFlags::MULTIPLICATIVE)
            .bits(),
        stat_mod_key: PropertyFloat::ResistFire as u32,
        stat_mod_value: 1.2,
        ..Default::default()
    });

    state.player.enchantments.push(Enchantment {
        spell_category: 30,
        power_level: 100,
        stat_mod_type: (EnchantmentTypeFlags::FLOAT
            | EnchantmentTypeFlags::SINGLE_STAT
            | EnchantmentTypeFlags::ADDITIVE)
            .bits(),
        stat_mod_key: PropertyFloat::ResistFire as u32,
        stat_mod_value: 0.67,
        ..Default::default()
    });

    let resistance = state.player_resistance_current(PropertyFloat::ResistFire);

    assert!((resistance - 0.72).abs() < 0.0001);
}

#[test]
fn test_character_option_helpers_read_and_update_both_masks() {
    let mut player = PlayerState::new();

    assert!(!player.character_option_enabled(CharacterOption::UseCraftingChanceOfSuccessDialog,));
    assert!(!player.character_option_enabled(CharacterOption::ShowYourHelmOrHeadGear));

    player.set_character_option_enabled(CharacterOption::UseCraftingChanceOfSuccessDialog, true);
    player.set_character_option_enabled(CharacterOption::ShowYourHelmOrHeadGear, true);

    assert!(player.character_option_enabled(CharacterOption::UseCraftingChanceOfSuccessDialog,));
    assert!(player.character_option_enabled(CharacterOption::ShowYourHelmOrHeadGear));
    assert!(
        player
            .options1
            .contains(CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG)
    );
    assert!(player.options2.contains(CharacterOptions2::SHOW_HELM));

    player.set_character_option_enabled(CharacterOption::UseCraftingChanceOfSuccessDialog, false);

    assert!(!player.character_option_enabled(CharacterOption::UseCraftingChanceOfSuccessDialog,));
    assert!(
        !player
            .options1
            .contains(CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG)
    );
    assert!(player.options2.contains(CharacterOptions2::SHOW_HELM));
}

#[test]
fn test_stat_floors() {
    let mut player = PlayerState::new();

    // 1. Attribute floor check
    // Base 100, debuff by 200 -> should floor at 10 (since base >= 10)
    set_attr(&mut player, stats::AttributeType::StrengthAttr, 100);
    player.enchantments.push(Enchantment {
        spell_id: 1,
        layer: 1,
        spell_category: 1,
        has_spell_set_id: 0,
        power_level: 1,
        start_time: 0.0,
        duration: 1000.0,
        caster_guid: Guid(50000001),
        degrade_modifier: 0.0,
        degrade_limit: -666.0,
        last_time_degraded: 0.0,
        stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE).bits(),
        stat_mod_key: stats::AttributeType::StrengthAttr as u32,
        stat_mod_value: -200.0,
        spell_set_id: None,
    });
    assert_eq!(
        player.get_attribute_current(stats::AttributeType::StrengthAttr),
        10
    );

    // Attribute base 5, debuff by 10 -> should floor at 1
    set_attr(&mut player, stats::AttributeType::EnduranceAttr, 5);
    player.enchantments.push(Enchantment {
        spell_id: 2,
        layer: 1,
        spell_category: 2,
        has_spell_set_id: 0,
        power_level: 1,
        start_time: 0.0,
        duration: 1000.0,
        caster_guid: Guid(50000001),
        degrade_modifier: 0.0,
        degrade_limit: -666.0,
        last_time_degraded: 0.0,
        stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE).bits(),
        stat_mod_key: stats::AttributeType::EnduranceAttr as u32,
        stat_mod_value: -100.0,
        spell_set_id: None,
    });
    assert_eq!(
        player.get_attribute_current(stats::AttributeType::EnduranceAttr),
        1
    );

    // 2. Vital floor check
    // Base 100, debuff by 200 -> should floor at 5
    player.vital_bases.insert(
        stats::VitalType::Health,
        VitalBase {
            ranks: 0,
            start: 100,
        },
    );
    // Attribute contribution for health is Str/2. Str is 10 (buffed)
    // Total base = 100 (base) + 5 (attr bonus) = 105.
    // Debuff by 200.
    player.enchantments.push(Enchantment {
        spell_id: 3,
        layer: 1,
        spell_category: 3,
        has_spell_set_id: 0,
        power_level: 1,
        start_time: 0.0,
        duration: 1000.0,
        caster_guid: Guid(50000001),
        degrade_modifier: 0.0,
        degrade_limit: -666.0,
        last_time_degraded: 0.0,
        stat_mod_type: (EnchantmentTypeFlags::SECOND_ATT | EnchantmentTypeFlags::ADDITIVE).bits(),
        stat_mod_key: stats::VitalType::Health as u32,
        stat_mod_value: -200.0,
        spell_set_id: None,
    });
    assert_eq!(player.calculate_vital_current(stats::VitalType::Health), 5);

    // 3. Skill floor check (0)
    player.skill_bases.insert(
        stats::SkillType::MeleeDefense,
        SkillBase {
            ranks: 100,
            init: 0,
        },
    );
    // Skill formula for MeleeDefense is (Quick + Coord) / 3.
    // Str is 10, End is 1. (These are unrelated but Quick/Coord are default 0 if not set)
    set_attr(&mut player, stats::AttributeType::QuicknessAttr, 10);
    set_attr(&mut player, stats::AttributeType::CoordinationAttr, 10);
    // (10+10)/3 = 7. Total base = 7 + 100 = 107.
    player.enchantments.push(Enchantment {
        spell_id: 4,
        layer: 1,
        spell_category: 4,
        has_spell_set_id: 0,
        power_level: 1,
        start_time: 0.0,
        duration: 1000.0,
        caster_guid: Guid(50000001),
        degrade_modifier: 0.0,
        degrade_limit: -666.0,
        last_time_degraded: 0.0,
        stat_mod_type: (EnchantmentTypeFlags::SKILL | EnchantmentTypeFlags::ADDITIVE).bits(),
        stat_mod_key: stats::SkillType::MeleeDefense as u32,
        stat_mod_value: -200.0,
        spell_set_id: None,
    });
    assert_eq!(
        player.derive_skill_value(stats::SkillType::MeleeDefense, 100, 0, true),
        0
    );

    // 4. Armor level check (can stay negative for Armor Self / Imperil logic)
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000001);
    state.seed_local_player_entity(player_guid, "Player", WorldPosition::default());
    state
        .player_entity_mut()
        .expect("local player entity should exist")
        .properties
        .set_int_prop(PropertyInt::ArmorLevel, 10);
    state.player.enchantments.push(Enchantment {
        spell_id: 5,
        layer: 1,
        spell_category: 5,
        has_spell_set_id: 0,
        power_level: 1,
        start_time: 0.0,
        duration: 1000.0,
        caster_guid: Guid(50000001),
        degrade_modifier: 0.0,
        degrade_limit: -666.0,
        last_time_degraded: 0.0,
        stat_mod_type: (EnchantmentTypeFlags::BODY_ARMOR_VALUE | EnchantmentTypeFlags::ADDITIVE)
            .bits(),
        stat_mod_key: 0,
        stat_mod_value: -20.0,
        spell_set_id: None,
    });
    state.emit_player_derived_stats(&mut Vec::new());
    // 10 - 20 = -10.
    assert_eq!(state.player_armor(), -10);
}

#[test]
fn test_buff_calculations() {
    use holtburger_common::properties::EnchantmentTypeFlags;

    let mut player = PlayerState::new();
    set_attr(&mut player, stats::AttributeType::StrengthAttr, 100);
    set_attr(&mut player, stats::AttributeType::CoordinationAttr, 100);

    // Add a Strength Buff (+20 additive)
    player.enchantments.push(Enchantment {
        spell_category: 1, // strength group
        power_level: 100,
        stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE).bits(),
        stat_mod_key: stats::AttributeType::StrengthAttr as u32,
        stat_mod_value: 20.0,
        ..Default::default()
    });

    // Add a Skill Multiplier (1.10x)
    player.enchantments.push(Enchantment {
        spell_category: 2, // axe group
        power_level: 100,
        stat_mod_type: (EnchantmentTypeFlags::SKILL | EnchantmentTypeFlags::MULTIPLICATIVE).bits(),
        stat_mod_key: stats::SkillType::Axe as u32,
        stat_mod_value: 1.10,
        ..Default::default()
    });

    // Strength should be 120
    assert_eq!(
        player.get_attribute_current(stats::AttributeType::StrengthAttr),
        120
    );

    // Heavy Weapons skill: (Str + Coord) / 3 + Ranks + Init
    // (120 + 100) / 3 = 73.33 -> 73
    // Base was (100 + 100) / 3 = 66.66 -> 67
    player.skill_bases.insert(
        stats::SkillType::HeavyWeapons,
        SkillBase { ranks: 10, init: 0 },
    );

    let val = player.derive_skill_value(stats::SkillType::HeavyWeapons, 10, 0, true);
    assert_eq!(val, 73 + 10); // 83

    // Test Stacking: Add a weaker Strength buff
    player.enchantments.push(Enchantment {
        spell_category: 1, // same strength group
        power_level: 50,   // Lower power
        stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE).bits(),
        stat_mod_key: stats::AttributeType::StrengthAttr as u32,
        stat_mod_value: 10.0,
        ..Default::default()
    });

    // Should still be 120
    assert_eq!(
        player.get_attribute_current(stats::AttributeType::StrengthAttr),
        120
    );

    // Add a STRONGER Strength buff
    player.enchantments.push(Enchantment {
        spell_category: 1, // same group
        power_level: 200,  // Higher power
        stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE).bits(),
        stat_mod_key: stats::AttributeType::StrengthAttr as u32,
        stat_mod_value: 30.0,
        ..Default::default()
    });

    // Should now be 130
    assert_eq!(
        player.get_attribute_current(stats::AttributeType::StrengthAttr),
        130
    );
}

#[test]
fn test_health_rounding() {
    use holtburger_common::properties::EnchantmentTypeFlags;

    let mut player = PlayerState::new();
    // Endurance 101 / 2 = 50.5 -> should be 51
    set_attr(&mut player, stats::AttributeType::EnduranceAttr, 101);
    player.vital_bases.insert(
        stats::VitalType::Health,
        VitalBase {
            ranks: 0,
            start: 100,
        },
    );

    let health_base = player.calculate_vital_base(stats::VitalType::Health);
    assert_eq!(
        health_base, 151,
        "Base Health contribution from 101 Endurance should be 51 (rounded)"
    );

    // Add an Endurance buff of +10 (Total 111)
    player.enchantments.push(Enchantment {
        spell_category: 3, // endurance group
        stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE).bits(),
        stat_mod_key: stats::AttributeType::EnduranceAttr as u32,
        stat_mod_value: 10.0,
        power_level: 100,
        ..Default::default()
    });

    // Current Endurance should be 111. 111 / 2 = 55.5 -> 56.
    // Total health should be 100 (start) + 56 (bonus) = 156.
    let health_current = player.calculate_vital_current(stats::VitalType::Health);
    assert_eq!(
        health_current, 156,
        "Current Health with 111 Endurance should be 156 (111/2=55.5 rounded to 56)"
    );
}

#[test]
fn test_vector_update_routing() {
    use crate::WorldEvent;
    use crate::entity::Entity;
    use crate::state::WorldState;
    use holtburger_common::Vector3;
    use holtburger_protocol::messages::GameMessage;
    use holtburger_protocol::messages::VectorUpdateData;

    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x50000001);
    state.entities.insert(Entity::new(
        state.player.guid,
        "Player".to_string(),
        WorldPosition::default(),
    ));

    let data = VectorUpdateData {
        guid: Guid(0x50000001),
        velocity: Vector3::new(1.0, 2.0, 3.0),
        omega: Vector3::new(0.1, 0.2, 0.3),
        instance_sequence: 123,
        vector_sequence: 456,
    };

    let msg = GameMessage::VectorUpdate(Box::new(data));
    let events = state.handle_message(&msg);

    assert_eq!(events.len(), 2);
    assert_eq!(state.player.instance_sequence, 123);
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodyChanged { body_id }
            if *body_id == crate::SpatialBodyId::LocalPlayer(Guid(0x50000001))
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityVectorUpdated { guid, velocity, omega }
            if *guid == Guid(0x50000001) && velocity.x == 1.0 && omega.x == 0.1
    )));
}

#[test]
fn test_magic_purge_bad_enchantments_preserves_vitae() {
    use crate::WorldEvent;
    use crate::state::WorldState;
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, MagicPurgeBadEnchantmentsEventData,
    };

    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x50000001);

    // Beneficial buff: should remain after bad-enchantment purge.
    state.player.enchantments.push(Enchantment {
        spell_id: 100,
        layer: 1,
        spell_category: 100,
        stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE
            | EnchantmentTypeFlags::ADDITIVE
            | EnchantmentTypeFlags::BENEFICIAL)
            .bits(),
        stat_mod_key: stats::AttributeType::StrengthAttr as u32,
        stat_mod_value: 10.0,
        ..Default::default()
    });

    // Harmful debuff: should be removed by bad-enchantment purge.
    state.player.enchantments.push(Enchantment {
        spell_id: 200,
        layer: 1,
        spell_category: 200,
        stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE | EnchantmentTypeFlags::ADDITIVE).bits(),
        stat_mod_key: stats::AttributeType::StrengthAttr as u32,
        stat_mod_value: -10.0,
        ..Default::default()
    });

    // Vitae penalty: must be preserved even though it's not BENEFICIAL.
    state.player.enchantments.push(Enchantment {
        spell_id: 300,
        layer: 1,
        spell_category: 300,
        stat_mod_type: (EnchantmentTypeFlags::VITAE | EnchantmentTypeFlags::MULTIPLICATIVE).bits(),
        stat_mod_key: 0,
        stat_mod_value: 0.95,
        ..Default::default()
    });

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: state.player.guid,
        sequence: 1,
        event: GameEvent::MagicPurgeBadEnchantments(Box::new(MagicPurgeBadEnchantmentsEventData {
            target: state.player.guid,
            sequence: 1,
        })),
    }));

    let events = state.handle_message(&msg);

    assert!(state.player.enchantments.iter().any(|e| e.spell_id == 100));
    assert!(!state.player.enchantments.iter().any(|e| e.spell_id == 200));
    assert!(state.player.enchantments.iter().any(|e| e.spell_id == 300));
    assert_eq!(state.player_vitae(), 0.95);

    assert!(
        events
            .iter()
            .any(|e| matches!(e, WorldEvent::PlayerEnchantmentsUpdated { .. }))
    );
    let derived_vitae = events.iter().find_map(|e| match e {
        WorldEvent::DerivedStatsUpdated(data) => Some(data.vitae),
        _ => None,
    });
    assert_eq!(derived_vitae, Some(0.95));
}

#[test]
fn test_update_motion_caches_last_non_zero_server_style() {
    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x50000001);

    let first = GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid: state.player.guid,
        object_instance_sequence: 7,
        movement_sequence: 8,
        server_control_sequence: 9,
        is_autonomous: false,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: 62,
        data: MovementTypeData::Invalid(MovementInvalid::default()),
    }));

    let events = state.handle_message(&first);

    assert_eq!(state.player.instance_sequence, 7);
    assert_eq!(state.player.movement_sequence, 8);
    assert_eq!(state.player.server_control_sequence, 9);
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::SelfServerControlledMotion(data)
            if data.server_control_sequence == 9 && data.movement_sequence == 8
    )));
    assert_eq!(
        state.player.last_server_motion_style,
        Some(MotionStance::SwordCombat)
    );

    let second = GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid: state.player.guid,
        object_instance_sequence: 10,
        movement_sequence: 11,
        server_control_sequence: 12,
        is_autonomous: false,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: 0,
        data: MovementTypeData::Invalid(MovementInvalid::default()),
    }));

    let events = state.handle_message(&second);

    assert_eq!(state.player.instance_sequence, 10);
    assert_eq!(state.player.movement_sequence, 11);
    assert_eq!(state.player.server_control_sequence, 12);
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::SelfServerControlledMotion(data)
            if data.server_control_sequence == 12 && data.movement_sequence == 11
    )));
    assert_eq!(
        state.player.last_server_motion_style,
        Some(MotionStance::SwordCombat)
    );
}

#[test]
fn test_stale_non_autonomous_update_motion_is_ignored_for_self() {
    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x50000001);
    state.player.instance_sequence = 10;
    state.player.movement_sequence = 20;
    state.player.server_control_sequence = 30;
    state.player.last_server_motion_style = Some(MotionStance::SwordCombat);

    let msg = GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid: state.player.guid,
        object_instance_sequence: 11,
        movement_sequence: 21,
        server_control_sequence: 29,
        is_autonomous: false,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: MotionStance::Magic.interpreted(),
        data: MovementTypeData::Invalid(MovementInvalid::default()),
    }));

    let events = state.handle_message(&msg);

    assert!(events.is_empty());
    assert_eq!(state.player.instance_sequence, 10);
    assert_eq!(state.player.movement_sequence, 20);
    assert_eq!(state.player.server_control_sequence, 30);
    assert_eq!(
        state.player.last_server_motion_style,
        Some(MotionStance::SwordCombat)
    );
}

#[test]
fn test_update_motion_caches_remote_entity_motion_snapshot_and_emits_event() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x60000001);

    let mut entity = Entity::new(guid, "Drudge".to_string(), WorldPosition::default());
    entity.health_fraction = Some(0.42);
    state.add_entity(entity);

    let msg = GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid,
        object_instance_sequence: 7,
        movement_sequence: 8,
        server_control_sequence: 9,
        is_autonomous: false,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: MotionStance::NonCombat.interpreted(),
        data: MovementTypeData::Invalid(MovementInvalid {
            state: InterpretedMotionState {
                flags: MovementStateFlags::CURRENT_STYLE | MovementStateFlags::FORWARD_COMMAND,
                num_commands: 0,
                current_style: Some(MotionStance::NonCombat.interpreted()),
                forward_command: Some(InterpretedMotionCommand::DEAD),
                ..Default::default()
            },
            sticky_object: None,
        }),
    }));

    let events = state.handle_message(&msg);

    let snapshot = state
        .entities
        .get(guid)
        .and_then(|entity| entity.motion_snapshot)
        .expect("expected motion snapshot to be cached");

    assert_eq!(snapshot.current_style, Some(MotionStance::NonCombat));
    assert_eq!(
        snapshot.forward_command,
        Some(InterpretedMotionCommand::DEAD)
    );
    assert_eq!(snapshot.forward_speed, None);
    assert_eq!(
        state
            .entities
            .get(guid)
            .and_then(|entity| entity.health_fraction),
        Some(0.0)
    );
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMotionUpdated { guid: target, snapshot }
            if *target == guid
            && snapshot.as_ref().is_some_and(|snapshot| snapshot.current_style == Some(MotionStance::NonCombat))
            && snapshot.as_ref().is_some_and(|snapshot| snapshot.motion_command() == Some(InterpretedMotionCommand::DEAD))
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityHealthUpdated {
            guid: event_guid,
            health_fraction,
        } if *event_guid == guid && *health_fraction == 0.0
    )));
}

#[test]
fn test_update_motion_clears_remote_entity_motion_snapshot_and_emits_event() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x60000001);

    let mut entity = Entity::new(guid, "Drudge".to_string(), WorldPosition::default());
    entity.motion_snapshot = Some(EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::WALK_FORWARD),
        sidestep_command: None,
        turn_command: None,
        ..Default::default()
    });
    state.add_entity(entity);

    let msg = GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid,
        object_instance_sequence: 1,
        movement_sequence: 2,
        server_control_sequence: 3,
        is_autonomous: true,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: 1,
        data: MovementTypeData::Invalid(MovementInvalid::default()),
    }));

    let events = state.handle_message(&msg);

    assert_eq!(
        state
            .entities
            .get(guid)
            .and_then(|entity| entity.motion_snapshot),
        None
    );
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMotionUpdated { guid: target, snapshot }
            if *target == guid && snapshot.is_none()
    )));
}

#[test]
fn test_update_motion_retains_interpreted_motion_speeds() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x60000001);

    state.add_entity(Entity::new(
        guid,
        "Drudge".to_string(),
        WorldPosition::default(),
    ));

    let msg = GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid,
        object_instance_sequence: 7,
        movement_sequence: 8,
        server_control_sequence: 9,
        is_autonomous: false,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: MotionStance::NonCombat.interpreted(),
        data: MovementTypeData::Invalid(MovementInvalid {
            state: InterpretedMotionState {
                flags: MovementStateFlags::FORWARD_COMMAND
                    | MovementStateFlags::FORWARD_SPEED
                    | MovementStateFlags::TURN_COMMAND
                    | MovementStateFlags::TURN_SPEED,
                num_commands: 0,
                forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
                forward_speed: Some(3.5),
                turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
                turn_speed: Some(1.25),
                ..Default::default()
            },
            sticky_object: None,
        }),
    }));

    let events = state.handle_message(&msg);

    let snapshot = state
        .entities
        .get(guid)
        .and_then(|entity| entity.motion_snapshot)
        .expect("expected motion snapshot to be cached");

    assert_eq!(
        snapshot.forward_command,
        Some(InterpretedMotionCommand::RUN_FORWARD)
    );
    assert_eq!(snapshot.forward_speed, OrderedMotionSpeed::from_f32(3.5));
    assert_eq!(
        snapshot.turn_command,
        Some(InterpretedMotionCommand::TURN_RIGHT)
    );
    assert_eq!(snapshot.turn_speed, OrderedMotionSpeed::from_f32(1.25));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMotionUpdated { guid: target, snapshot }
            if *target == guid
            && snapshot.as_ref().is_some_and(|snapshot| snapshot.forward_speed == OrderedMotionSpeed::from_f32(3.5))
            && snapshot.as_ref().is_some_and(|snapshot| snapshot.turn_speed == OrderedMotionSpeed::from_f32(1.25))
    )));
}

#[test]
fn test_update_motion_retains_turn_to_heading_directive() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x60000001);

    state.add_entity(Entity::new(
        guid,
        "Drudge".to_string(),
        WorldPosition::default(),
    ));

    let msg = GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid,
        object_instance_sequence: 7,
        movement_sequence: 8,
        server_control_sequence: 9,
        is_autonomous: false,
        movement_type: MovementType::TurnToHeading,
        motion_flags: 0,
        current_style: MotionStance::NonCombat.interpreted(),
        data: MovementTypeData::TurnToHeading(
            holtburger_protocol::messages::movement::messages::motion::TurnToHeading {
                params:
                    holtburger_protocol::messages::movement::messages::motion::TurnToParameters {
                        movement_parameters: 0,
                        speed: 1.5,
                        desired_heading: 0.75,
                    },
            },
        ),
    }));

    let _events = state.handle_message(&msg);

    let snapshot = state
        .entities
        .get(guid)
        .and_then(|entity| entity.motion_snapshot)
        .expect("expected motion snapshot to be cached");

    assert_eq!(
        snapshot.directive,
        Some(EntityMotionDirective::TurnToHeading {
            desired_heading: OrderedMotionSpeed::from_f32(0.75).expect("finite desired heading"),
            speed: OrderedMotionSpeed::from_f32(1.5).expect("finite speed"),
        })
    );
}

#[test]
fn test_vector_update_applies_self_velocity_and_omega() {
    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x50000001);

    let start = WorldPosition::default();
    state.seed_local_player_entity(state.player.guid, "Player", start);

    let msg = GameMessage::VectorUpdate(Box::new(VectorUpdateData {
        guid: state.player.guid,
        velocity: holtburger_common::Vector3::new(0.0, 0.0, 0.0),
        omega: holtburger_common::Vector3::new(0.0, 0.0, 1.25),
        instance_sequence: 11,
        vector_sequence: 12,
    }));

    let events = state.handle_message(&msg);

    assert_eq!(state.player.instance_sequence, 11);
    assert_eq!(
        state
            .entities
            .get(state.player.guid)
            .expect("player entity should exist")
            .velocity,
        holtburger_common::Vector3::new(0.0, 0.0, 0.0)
    );
    assert_eq!(
        state
            .entities
            .get(state.player.guid)
            .expect("player entity should exist")
            .omega,
        holtburger_common::Vector3::new(0.0, 0.0, 1.25)
    );
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityVectorUpdated { guid, velocity, omega }
            if *guid == state.player.guid
            && *velocity == holtburger_common::Vector3::new(0.0, 0.0, 0.0)
            && *omega == holtburger_common::Vector3::new(0.0, 0.0, 1.25)
    )));
}

#[test]
fn test_magic_purge_enchantments_preserves_vitae_only() {
    use crate::state::WorldState;
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, MagicPurgeEnchantmentsEventData,
        MagicUpdateEnchantmentEventData,
    };

    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x50000001);

    // Existing buff should be removed by full purge.
    state.player.enchantments.push(Enchantment {
        spell_id: 100,
        layer: 1,
        spell_category: 100,
        stat_mod_type: (EnchantmentTypeFlags::ATTRIBUTE
            | EnchantmentTypeFlags::ADDITIVE
            | EnchantmentTypeFlags::BENEFICIAL)
            .bits(),
        stat_mod_key: stats::AttributeType::StrengthAttr as u32,
        stat_mod_value: 10.0,
        ..Default::default()
    });

    // Death-like sequence from server: apply vitae, then purge enchantments.
    let vitae_enchant = Enchantment {
        spell_id: 666,
        layer: 0,
        spell_category: 204,
        stat_mod_type: (EnchantmentTypeFlags::VITAE | EnchantmentTypeFlags::MULTIPLICATIVE).bits(),
        stat_mod_key: 0,
        stat_mod_value: 0.88,
        ..Default::default()
    };

    let update_msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: state.player.guid,
        sequence: 16,
        event: GameEvent::MagicUpdateEnchantment(Box::new(MagicUpdateEnchantmentEventData {
            target: state.player.guid,
            sequence: 16,
            enchantment: vitae_enchant,
        })),
    }));

    let purge_msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: state.player.guid,
        sequence: 17,
        event: GameEvent::MagicPurgeEnchantments(Box::new(MagicPurgeEnchantmentsEventData {
            target: state.player.guid,
            sequence: 17,
        })),
    }));

    let mut events = state.handle_message(&update_msg);
    events.extend(state.handle_message(&purge_msg));

    assert!(!state.player.enchantments.iter().any(|e| e.spell_id == 100));
    assert!(state.player.enchantments.iter().any(|e| e.spell_id == 666));
    assert_eq!(state.player_vitae(), 0.88);

    let latest_derived_vitae = events.iter().rev().find_map(|e| match e {
        WorldEvent::DerivedStatsUpdated(data) => Some(data.vitae),
        _ => None,
    });
    assert_eq!(latest_derived_vitae, Some(0.88));
}

#[test]
fn test_update_position_from_server_caches_grounded_state() {
    let mut player = PlayerState::new();
    player.guid = Guid(0x50000001);

    let mut events = Vec::<WorldEvent>::new();
    let pos = WorldPosition::default();

    use holtburger_protocol::messages::movement::messages::position::{
        PositionPack, UpdatePositionFlag,
    };

    player.update_position_from_server(
        &PositionPack {
            pos,
            instance_sequence: 1,
            position_sequence: 2,
            teleport_sequence: 3,
            force_position_sequence: 4,
            flags: UpdatePositionFlag::NONE,
            ..Default::default()
        },
        &mut events,
    );
    assert_eq!(player.last_server_grounded, Some(false));

    player.update_position_from_server(
        &PositionPack {
            pos,
            instance_sequence: 5,
            position_sequence: 6,
            teleport_sequence: 7,
            force_position_sequence: 4,
            flags: UpdatePositionFlag::IS_GROUNDED,
            ..Default::default()
        },
        &mut events,
    );
    assert_eq!(player.last_server_grounded, Some(true));
}

#[test]
fn test_stale_update_position_is_ignored_when_teleport_sequence_regresses() {
    use holtburger_common::Vector3;
    use holtburger_protocol::messages::movement::messages::position::{
        PositionPack, UpdatePositionFlag,
    };

    let mut player = PlayerState::new();
    player.guid = Guid(0x50000001);
    player.teleport_sequence = 10;
    player.force_position_sequence = 4;

    let mut events = Vec::<WorldEvent>::new();
    let applied = player.apply_position_from_server(
        &PositionPack {
            pos: WorldPosition {
                landblock_id: Guid(0x02000000),
                coords: Vector3::new(9.0, 9.0, 9.0),
                ..Default::default()
            },
            instance_sequence: 1,
            position_sequence: 2,
            teleport_sequence: 9,
            force_position_sequence: 99,
            flags: UpdatePositionFlag::NONE,
            ..Default::default()
        },
        &mut events,
    );

    assert!(!applied);
    assert_eq!(player.teleport_sequence, 10);
    assert_eq!(player.force_position_sequence, 4);
    assert!(events.is_empty());
}

#[test]
fn test_stale_update_position_is_ignored_when_force_sequence_regresses() {
    use holtburger_common::Vector3;
    use holtburger_protocol::messages::movement::messages::position::{
        PositionPack, UpdatePositionFlag,
    };

    let mut player = PlayerState::new();
    player.guid = Guid(0x50000001);
    player.teleport_sequence = 10;
    player.force_position_sequence = 7;

    let mut events = Vec::<WorldEvent>::new();
    let applied = player.apply_position_from_server(
        &PositionPack {
            pos: WorldPosition {
                landblock_id: Guid(0x02000000),
                coords: Vector3::new(9.0, 9.0, 9.0),
                ..Default::default()
            },
            instance_sequence: 1,
            position_sequence: 2,
            teleport_sequence: 10,
            force_position_sequence: 6,
            flags: UpdatePositionFlag::NONE,
            ..Default::default()
        },
        &mut events,
    );

    assert!(!applied);
    assert_eq!(player.teleport_sequence, 10);
    assert_eq!(player.force_position_sequence, 7);
    assert!(events.is_empty());
}

#[test]
fn test_heal_command_updates() {
    use crate::state::WorldState;
    use holtburger_protocol::messages::{
        GameMessage, PrivateUpdateVitalCurrentData, PrivateUpdateVitalData,
    };

    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x50000001);

    // 1. Initial login: PrivateUpdateVital for Health (ID 1), Stamina (ID 3), Mana (ID 5)
    let vitals_to_init = [(1, "Health"), (3, "Stamina"), (5, "Mana")];
    for (id, _name) in vitals_to_init {
        let msg = GameMessage::PrivateUpdateVital(Box::new(PrivateUpdateVitalData {
            sequence: 1,
            object_guid: None,
            vital: id,
            ranks: 0,
            start: 100,
            xp: 0,
            current: 50,
        }));
        let _ = state.handle_message(&msg);
    }

    // Verify they are in the map
    assert!(state.player.vitals.contains_key(&stats::VitalType::Health));
    assert!(state.player.vitals.contains_key(&stats::VitalType::Stamina));
    assert!(state.player.vitals.contains_key(&stats::VitalType::Mana));

    // 2. Simulate @heal: PrivateUpdateVitalCurrent for Health (ID 2), Stamina (ID 4), Mana (ID 6)
    let heal_updates = [(2, 100), (4, 100), (6, 100)];
    for (id, val) in heal_updates {
        let msg = GameMessage::PrivateUpdateVitalCurrent(Box::new(PrivateUpdateVitalCurrentData {
            sequence: 2,
            object_guid: None,
            vital: id,
            current: val,
        }));
        let events = state.handle_message(&msg);
        assert_eq!(events.len(), 1);
    }

    // 3. Verify final state
    assert_eq!(
        state
            .player
            .vitals
            .get(&stats::VitalType::Health)
            .unwrap()
            .current,
        100
    );
    assert_eq!(
        state
            .player
            .vitals
            .get(&stats::VitalType::Stamina)
            .unwrap()
            .current,
        100
    );
    assert_eq!(
        state
            .player
            .vitals
            .get(&stats::VitalType::Mana)
            .unwrap()
            .current,
        100
    );
}
