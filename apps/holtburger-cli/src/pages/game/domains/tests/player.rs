use super::*;
use holtburger_core::{
    ClientApplicationSnapshot, ClientCharacterSheet, ClientLifecycleState, DynamicEntityHostTime,
    DynamicEntitySnapshot,
};
use holtburger_world::stat_breakdown::AttributeBreakdown;
use holtburger_world::stats::{Attribute, AttributeType, CharacterLevelInfo, Resistances};

fn character_sheet(guid: Guid) -> ClientCharacterSheet {
    ClientCharacterSheet {
        character: guid,
        name: Some("Player".into()),
        title: None,
        maximum_luminance: None,
        level: CharacterLevelInfo {
            level: 10,
            unspent_xp: 1000,
            unspent_skill_points: 2,
            ..Default::default()
        },
        attributes: vec![Attribute {
            attr_type: AttributeType::StrengthAttr,
            ranks: 1,
            start: 10,
            spent_xp: 100,
            next_rank_xp: Some(200),
            base: 11,
            current: 11,
            breakdown: AttributeBreakdown::default(),
        }],
        vitals: vec![],
        skills: vec![],
        armor: 20,
        resistances: Resistances {
            slash: 0.8,
            ..Default::default()
        },
        vitae: 0.9,
        guarded_targets: vec![],
    }
}

#[test]
fn character_sheet_replaces_tui_facts_and_requotes_only_purchase_inputs() {
    let guid = Guid(0x50000001);
    let mut state = GameState::new(guid, "Player".to_string(), "World".to_string());
    let sheet = character_sheet(guid);
    let first = state.handle_view_event(ClientViewEvent::CharacterSheetUpdated(Some(Box::new(
        sheet.clone(),
    ))));
    assert!(
        first
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::EvaluateProgression { .. }))
    );
    assert_eq!(state.data.armor, 20);
    assert_eq!(state.data.resistances.slash, 0.8);
    assert_eq!(state.data.vitae, 0.9);

    let mut effects_only = sheet.clone();
    effects_only.attributes[0].current = 14;
    effects_only.armor = 30;
    let second = state.handle_view_event(ClientViewEvent::CharacterSheetUpdated(Some(Box::new(
        effects_only.clone(),
    ))));
    assert!(second.commands.is_empty());
    assert_eq!(
        state.data.attributes[&AttributeType::StrengthAttr].current,
        14
    );

    let mut old_character = effects_only.clone();
    old_character.character = Guid(0x50000002);
    old_character.armor = 99;
    state.handle_view_event(ClientViewEvent::CharacterSheetUpdated(Some(Box::new(
        old_character,
    ))));
    assert_eq!(state.data.armor, 30);

    effects_only.level.unspent_xp -= 1;
    let third = state.handle_view_event(ClientViewEvent::CharacterSheetUpdated(Some(Box::new(
        effects_only,
    ))));
    assert!(
        third
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::EvaluateProgression { .. }))
    );

    state.handle_view_event(ClientViewEvent::CharacterSheetUpdated(None));
    assert!(state.data.level_info.is_none());
    assert!(state.data.attributes.is_empty());
}

#[test]
fn application_snapshot_restores_the_character_after_event_lag() {
    let guid = Guid(0x50000001);
    let mut state = GameState::new(guid, "Player".to_string(), "World".to_string());
    let effect_flags = (holtburger_common::properties::EnchantmentTypeFlags::BODY_ARMOR_VALUE
        | holtburger_common::properties::EnchantmentTypeFlags::ADDITIVE
        | holtburger_common::properties::EnchantmentTypeFlags::BENEFICIAL)
        .bits();
    let snapshot = ClientApplicationSnapshot {
        connection: None,
        trade: Default::default(),
        known_spells: None,
        enchantments: Some(
            holtburger_core::client::types::ClientPlayerEnchantmentsSnapshot {
                records: vec![holtburger_protocol::messages::magic::Enchantment {
                    spell_id: 123,
                    layer: 0,
                    spell_category: 7,
                    power_level: 5,
                    duration: -1.0,
                    stat_mod_type: effect_flags,
                    stat_mod_value: 2.0,
                    ..Default::default()
                }],
                resolved: holtburger_world::enchantments::ResolvedEnchantments {
                    instances: vec![holtburger_world::enchantments::ResolvedEnchantment {
                        key: holtburger_world::enchantments::EnchantmentKey {
                            spell_id: 123,
                            layer: 0,
                        },
                        spell_category: 7,
                        power_level: 5,
                        kind: holtburger_world::enchantments::EnchantmentKind::Beneficial,
                        remaining_seconds: None,
                        stat_mod_type: effect_flags,
                        stat_mod_key: 0,
                        stat_mod_value: 2.0,
                    }],
                    groups: vec![holtburger_world::enchantments::EnchantmentLayerGroup {
                        affected_stat: holtburger_world::enchantments::AffectedStat::Armor,
                        stat_name: None,
                        operation: holtburger_world::enchantments::EnchantmentOperation::Additive,
                        channel: holtburger_world::enchantments::EnchantmentChannel::Ordinary,
                        spell_category: 7,
                        effective: holtburger_world::enchantments::EnchantmentKey {
                            spell_id: 123,
                            layer: 0,
                        },
                        overridden: Vec::new(),
                    }],
                },
            },
        ),
        character_options: None,
        combat_mode: CombatMode::NonCombat,
        combat: Default::default(),
        lifecycle: ClientLifecycleState::InWorld,
        entity_collision_disabled: false,
        can_teleport_from_map: false,
        local_player_guid: Some(guid),
        server_time: None,
        world_generation: 1,
        world_name: None,
        player_name: Some("Player".to_string()),
        vitals: Default::default(),
        character_sheet: Some(Box::new(character_sheet(guid))),
        character_motion: None,
        active_confirmation: None,
        dynamic: DynamicEntitySnapshot::new(DynamicEntityHostTime::new(0.0).unwrap(), Vec::new()),
        entities: Default::default(),
        runtime_bodies: Vec::new().into(),
    };
    let recovery = ClientViewEvent::ApplicationSnapshot(Box::new(snapshot.clone()));
    assert!(crate::scripting::script_event_from_view_event(&recovery).is_none());
    assert!(matches!(
        crate::scripting::script_event_from_view_event(&ClientViewEvent::PlayerVitalsUpdated {
            vitals: Default::default(),
        }),
        Some(holtburger_scripting::ScriptEvent::SelfVitalsChanged)
    ));
    let result = state.handle_view_event(recovery);
    assert_eq!(state.data.level_info.as_ref().unwrap().level, 10);
    assert_eq!(state.data.armor, 20);
    assert!(state.data.resolved_enchantments.is_some());
    assert_eq!(state.data.player_enchantments[0].spell_id, 123);
    let lines = crate::pages::game::panels::dashboard::tabs::character::render::get_char_tab_lines(
        &state.data,
    );
    let effect_index = lines
        .iter()
        .position(|line| matches!(line, crate::pages::game::panels::dashboard::tabs::character::render::CharTabLine::Enchantment(_)))
        .expect("restored effect is visible in the Character tab");
    let tab = crate::pages::game::panels::dashboard::tabs::character::CharacterTab {
        selected_index: effect_index,
        ..Default::default()
    };
    let verbs = crate::types::TabController::get_verbs(&tab, &state.data, &state.view, &None);
    assert!(verbs.iter().any(|verb| verb.label == "Details"));
    let mut stale = snapshot;
    stale.character_sheet = Some(Box::new(character_sheet(Guid(0x50000002))));
    stale.enchantments = None;
    state.handle_view_event(ClientViewEvent::ApplicationSnapshot(Box::new(stale)));
    assert!(state.data.resolved_enchantments.is_some());
    assert_eq!(state.data.player_enchantments[0].spell_id, 123);
    assert_eq!(state.data.armor, 20);
    state.handle_view_event(ClientViewEvent::CharacterSheetUpdated(None));
    assert!(state.data.resolved_enchantments.is_none());
    assert!(state.data.player_enchantments.is_empty());
    assert!(
        result
            .commands
            .iter()
            .any(|command| matches!(command, ClientCommand::EvaluateProgression { .. }))
    );
}

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
