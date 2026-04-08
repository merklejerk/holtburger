use super::test_support::*;
use super::*;

#[test]
fn entering_world_quiet_period_suppresses_initial_owned_spawns() {
    let player_guid = Guid(0x50000001);
    let item_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let status = state.handle_view_event(ClientViewEvent::StatusUpdate {
        state: holtburger_core::client::types::ClientState::InWorld,
    });

    let result = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
    });

    assert!(!status.redraw_requested());
    assert!(!result.redraw_requested());
    assert!(state.chat.messages.is_empty());
    assert!(matches!(
        state.runtime.inventory_notifications,
        InventoryNotificationState::QuietUntil(_)
    ));
}

#[test]
fn newly_owned_item_logs_to_chat() {
    let player_guid = Guid(0x50000001);
    let item_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
        state: holtburger_core::client::types::ClientState::InWorld,
    });

    state.runtime.inventory_notifications =
        InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
    let _ = state.handle_tick(0.0);

    let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(Entity::new(
            item_guid,
            "Pyreal".to_string(),
            WorldPosition::default(),
        )),
    });

    let result = state.handle_view_event(ClientViewEvent::EntityReplaced {
        entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
    });

    assert!(result.redraw_requested());
    assert_eq!(state.chat.messages.len(), 1);
    assert_eq!(state.chat.messages[0].text, "Added to inventory: Pyreal");
}

#[test]
fn newly_owned_stacked_item_logs_stack_size() {
    let player_guid = Guid(0x50000001);
    let item_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
        state: holtburger_core::client::types::ClientState::InWorld,
    });

    state.runtime.inventory_notifications =
        InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
    let _ = state.handle_tick(0.0);

    let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(Entity::new(
            item_guid,
            "Pyreal".to_string(),
            WorldPosition::default(),
        )),
    });

    let result = state.handle_view_event(ClientViewEvent::EntityReplaced {
        entity: Box::new(stacked_inventory_item_entity(
            item_guid,
            "Pyreal",
            player_guid,
            7,
        )),
    });

    assert!(result.redraw_requested());
    assert_eq!(state.chat.messages.len(), 1);
    assert_eq!(
        state.chat.messages[0].text,
        "Added to inventory: Pyreal (7x)"
    );
}

#[test]
fn newly_unowned_item_logs_to_chat() {
    let player_guid = Guid(0x50000001);
    let item_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
        state: holtburger_core::client::types::ClientState::InWorld,
    });

    let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
    });

    state.chat.messages.clear();
    state.runtime.inventory_notifications =
        InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
    let _ = state.handle_tick(0.0);

    let result = state.handle_view_event(ClientViewEvent::EntityReplaced {
        entity: Box::new(Entity::new(
            item_guid,
            "Pyreal".to_string(),
            WorldPosition::default(),
        )),
    });

    assert!(result.redraw_requested());
    assert_eq!(state.chat.messages.len(), 1);
    assert_eq!(
        state.chat.messages[0].text,
        "Removed from inventory: Pyreal"
    );
}

#[test]
fn moving_item_within_inventory_does_not_log_addition() {
    let player_guid = Guid(0x50000001);
    let pack_guid = Guid(0x60000001);
    let item_guid = Guid(0x60000002);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
        state: holtburger_core::client::types::ClientState::InWorld,
    });

    let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(pack_guid, "Pack", player_guid)),
    });
    let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
    });

    let result = state.handle_view_event(ClientViewEvent::EntityReplaced {
        entity: Box::new(inventory_item_entity(item_guid, "Pyreal", pack_guid)),
    });

    assert!(!result.redraw_requested());
    assert!(state.chat.messages.is_empty());
}

#[test]
fn entering_world_quiet_period_suppresses_initial_side_pack_contents() {
    let player_guid = Guid(0x50000001);
    let pack_guid = Guid(0x60000001);
    let initial_item_guid = Guid(0x60000002);
    let later_item_guid = Guid(0x60000003);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
        state: holtburger_core::client::types::ClientState::InWorld,
    });

    let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(pack_guid, "Pack", player_guid)),
    });
    let initial = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(initial_item_guid, "Apple", pack_guid)),
    });

    assert!(!initial.redraw_requested());
    assert!(state.chat.messages.is_empty());

    state.runtime.inventory_notifications =
        InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
    let _ = state.handle_tick(0.0);
    assert!(state.runtime.inventory_notifications.is_armed());

    let later = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(later_item_guid, "Pear", pack_guid)),
    });

    assert!(later.redraw_requested());
    assert_eq!(state.chat.messages.len(), 1);
    assert_eq!(state.chat.messages[0].text, "Added to inventory: Pear");
}

#[test]
fn despawning_owned_item_logs_removal_to_chat() {
    let player_guid = Guid(0x50000001);
    let item_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
        state: holtburger_core::client::types::ClientState::InWorld,
    });
    let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(item_guid, "Pyreal", player_guid)),
    });

    state.chat.messages.clear();
    state.runtime.inventory_notifications =
        InventoryNotificationState::QuietUntil(Instant::now() - Duration::from_millis(1));
    let _ = state.handle_tick(0.0);

    let result = state.handle_view_event(ClientViewEvent::EntityDespawned { guid: item_guid });

    assert!(result.redraw_requested());
    assert_eq!(state.chat.messages.len(), 1);
    assert_eq!(
        state.chat.messages[0].text,
        "Removed from inventory: Pyreal"
    );
}

#[test]
fn acquiring_pack_recursively_tracks_known_contents() {
    let player_guid = Guid(0x50000001);
    let pack_guid = Guid(0x60000001);
    let item_guid = Guid(0x60000002);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());

    let _ = state.handle_view_event(ClientViewEvent::StatusUpdate {
        state: holtburger_core::client::types::ClientState::InWorld,
    });

    let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(item_guid, "Apple", pack_guid)),
    });

    assert!(!state.data.is_in_player_inventory(item_guid));

    let _ = state.handle_view_event(ClientViewEvent::EntitySpawned {
        entity: Box::new(inventory_item_entity(pack_guid, "Pack", player_guid)),
    });

    assert!(state.data.is_in_player_inventory(pack_guid));
    assert!(state.data.is_in_player_inventory(item_guid));
}

#[test]
fn equip_weapon_in_combat_exits_peace_then_reenters() {
    let player_guid = Guid(0x50000001);
    let weapon_guid = Guid(0x60000001);
    let mut state = GameState::new(player_guid, "Player".to_string(), "World".to_string());
    state.data.combat_mode = CombatMode::Melee;

    let mut weapon = Entity::new(weapon_guid, "Sword".to_string(), WorldPosition::default());
    weapon.set_int_prop(
        PropertyInt::ValidLocations,
        holtburger_protocol::messages::EquipMask::MELEE_WEAPON.bits() as i32,
    );
    state.data.entities.insert(weapon_guid, weapon.clone());

    let start = state
        .handle_action(AppAction::Equip { guid: weapon_guid })
        .unwrap();
    assert!(matches!(
        start.commands.first(),
        Some(ClientCommand::SetCombatMode(CombatMode::NonCombat))
    ));
    assert!(is_weapon_swap_active(&state));

    let peace = state.handle_view_event(ClientViewEvent::CombatModeUpdated {
        mode: CombatMode::NonCombat,
    });
    assert!(matches!(
        peace.commands.first(),
        Some(ClientCommand::GetAndWield { item, slot: None }) if *item == weapon_guid
    ));

    weapon.set_iid_prop(
        holtburger_common::properties::PropertyInstanceId::Wielder,
        player_guid,
    );
    weapon.set_int_prop(
        PropertyInt::CurrentWieldedLocation,
        holtburger_protocol::messages::EquipMask::MELEE_WEAPON.bits() as i32,
    );
    let finish = state.handle_view_event(ClientViewEvent::EntityReplaced {
        entity: Box::new(weapon),
    });

    assert!(matches!(
        finish.commands.first(),
        Some(ClientCommand::SetCombatMode(CombatMode::Melee))
    ));
    assert!(!is_weapon_swap_active(&state));
}
