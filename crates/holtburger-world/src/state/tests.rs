use super::*;
use std::sync::Arc;

use crate::state::liveness::EntityUpsertKind;

use holtburger_common::position::WorldPosition;
use holtburger_common::properties::WorldObjectProperties;

#[test]
fn test_player_mirror_invariant_on_set_position() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000123);
    state.player.guid = player_guid;

    let initial_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    // Register player as an entity too
    let player_entity = Entity::new(player_guid, "Player".to_string(), initial_pos);
    state.entities.insert(player_entity);

    let new_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(10.0, 20.0, 30.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.set_player_position(new_pos);

    assert_eq!(state.player.position, new_pos);
    assert_eq!(state.entities.get(player_guid).unwrap().position, new_pos);
}

#[test]
fn test_player_mirror_invariant_on_set_velocity() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000123);
    state.player.guid = player_guid;

    let initial_pos = WorldPosition::default();
    let player_entity = Entity::new(player_guid, "Player".to_string(), initial_pos);
    state.entities.insert(player_entity);

    let new_vel = Vector3::new(1.0, 2.0, 3.0);
    state.set_player_velocity(new_vel);

    assert_eq!(state.entities.get(player_guid).unwrap().velocity, new_vel);
}

#[test]
fn test_set_player_position_sanitizes_nan_rotation() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000123);
    state.player.guid = player_guid;

    let initial_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    state.player.position = initial_pos;

    let player_entity = Entity::new(player_guid, "Player".to_string(), initial_pos);
    state.entities.insert(player_entity);

    let nan_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(10.0, 20.0, 30.0),
        rotation: holtburger_common::math::Quaternion {
            w: f32::NAN,
            x: 0.0,
            y: 0.0,
            z: 0.0,
        },
    };

    state.set_player_position(nan_pos);

    assert_eq!(
        state.player.position.rotation,
        holtburger_common::math::Quaternion::identity()
    );
    assert_eq!(
        state.entities.get(player_guid).unwrap().position.rotation,
        holtburger_common::math::Quaternion::identity()
    );
}

#[test]
fn test_spell_name_resolution() {
    use holtburger_dat::file_type::spell_table::{SpellBase, SpellTable};

    let mut state = WorldState::new(None, None);
    let mut spells = std::collections::HashMap::new();
    spells.insert(
        1337,
        SpellBase {
            name: "L33t Spell".to_string(),
            ..Default::default()
        },
    );

    state.spell_table = Some(Arc::new(SpellTable {
        id: SpellTable::FILE_ID,
        spells,
        spell_sets: std::collections::HashMap::new(),
    }));

    assert_eq!(state.resolve_spell_name(1337).unwrap(), "L33t Spell");
    assert!(state.resolve_spell_name(999).is_none());
}

#[test]
fn test_load_deferred_tables_noop_without_portal_dat() {
    let mut state = WorldState::new(None, None);
    assert!(state.xp_table.is_none());
    assert!(state.spell_table.is_none());

    // Calling load_deferred_tables with no provider should be a clean no-op
    state.load_deferred_tables();

    assert!(state.xp_table.is_none());
    assert!(state.spell_table.is_none());
}

#[test]
fn test_load_deferred_tables_gracefully_handles_read_failure() {
    struct MockFailedProvider;
    impl holtburger_dat::ResourceProvider for MockFailedProvider {
        fn get_file(&self, id: u32) -> Result<Vec<u8>, holtburger_dat::error::DatError> {
            Err(holtburger_dat::error::DatError::NotFound(id))
        }
        fn get_metadata(&self, _id: u32) -> Option<holtburger_dat::FileMetadata> {
            None
        }
    }

    let mut state = WorldState::new(Some(Arc::new(MockFailedProvider)), None);

    // This shouldn't panic or error out the whole thing if reading fails
    state.load_deferred_tables();

    assert!(state.xp_table.is_none());
    assert!(state.spell_table.is_none());
}

#[test]
fn test_player_mirror_invariant_on_autonomous_sync() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000123);
    state.player.guid = player_guid;

    let initial_pos = WorldPosition::default();
    let player_entity = Entity::new(player_guid, "Player".to_string(), initial_pos);
    state.entities.insert(player_entity);

    let sync_data = ServerAutonomousPositionData {
        guid: player_guid,
        position: WorldPosition {
            landblock_id: Guid(0x56780000),
            coords: Vector3::new(1.0, 1.0, 1.0),
            rotation: holtburger_common::math::Quaternion::identity(),
        },
        instance_sequence: 10,
        server_control_sequence: 20,
        teleport_sequence: 30,
        force_position_sequence: 40,
        contact_flags: 0,
    };

    state.apply_player_autonomous_position(&sync_data);

    assert_eq!(state.player.position, sync_data.position);
    assert_eq!(
        state.entities.get(player_guid).unwrap().position,
        sync_data.position
    );
    assert_eq!(state.player.instance_sequence, 10);
    assert_eq!(state.player.server_control_sequence, 20);
}

#[test]
fn test_inventory_put_obj_in_container() {
    let mut state = WorldState::new(None, None);
    let item_guid = Guid(0x1);
    let container_guid = Guid(0x2);

    // Add the item to entities
    state.entities.insert(Entity::new(
        item_guid,
        "Item".to_string(),
        WorldPosition::default(),
    ));

    let data = InventoryPutObjInContainerEventData {
        item_guid,
        container_guid,
        slot: 0,
        container_type: 0,
    };
    let event = GameEvent::InventoryPutObjInContainer(Box::new(data));
    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 0,
        event,
    }));

    let events = state.handle_message(&msg);

    let entity = state.entities.get(item_guid).unwrap();
    assert_eq!(entity.container_id(), Some(container_guid));
    assert_eq!(entity.position.landblock_id, Guid::NULL);

    // Check for StateEvent::PropertiesUpdated
    assert!(events.iter().any(|e| {
        if let StateEvent::PropertiesUpdated { guid, updates } = e {
            *guid == item_guid
                && updates.iter().any(|u| {
                    matches!(u, PropertyUpdate::InstanceId(PropertyInstanceId::Container, val) if *val == container_guid)
                })
        } else {
            false
        }
    }));
}

#[test]
fn test_inventory_put_object_in_3d() {
    let mut state = WorldState::new(None, None);
    let obj_guid = Guid(0x1);

    let mut item = Entity::new(obj_guid, "Item".to_string(), WorldPosition::default());
    item.set_container_id(Some(Guid(0x2)));
    item.set_wielder_id(Some(Guid(0x3)));
    state.entities.insert(item);

    let data = InventoryPutObjectIn3DEventData {
        object_guid: obj_guid,
    };
    let event = GameEvent::InventoryPutObjectIn3D(Box::new(data));
    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 0,
        event,
    }));

    let events = state.handle_message(&msg);

    let entity = state.entities.get(obj_guid).unwrap();
    assert_eq!(entity.container_id(), None);
    assert_eq!(entity.wielder_id(), None);

    assert!(events.iter().any(|e| {
        if let StateEvent::PropertiesUpdated { guid, updates } = e {
            *guid == obj_guid
                && updates.iter().any(|u| {
                    matches!(
                        u,
                        PropertyUpdate::InstanceId(PropertyInstanceId::Container, Guid::NULL)
                    )
                })
        } else {
            false
        }
    }));
}

#[test]
fn test_wield_object() {
    let mut state = WorldState::new(None, None);
    let obj_guid = Guid(0x1);
    let wielder_guid = Guid(0x50000001);

    state.entities.insert(Entity::new(
        obj_guid,
        "Weapon".to_string(),
        WorldPosition::default(),
    ));

    let data = WieldObjectEventData {
        object_guid: obj_guid,
        equip_mask: EquipMask::from_bits_truncate(0),
    };
    let event = GameEvent::WieldObject(Box::new(data));
    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: wielder_guid,
        sequence: 0,
        event,
    }));

    let events = state.handle_message(&msg);

    let entity = state.entities.get(obj_guid).unwrap();
    assert_eq!(entity.wielder_id(), Some(wielder_guid));
    assert_eq!(entity.container_id(), None);

    assert!(events.iter().any(|e| {
        if let StateEvent::PropertiesUpdated { guid, updates } = e {
            *guid == obj_guid
                && updates.iter().any(|u| {
                    matches!(u, PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, val) if *val == wielder_guid)
                })
        } else {
            false
        }
    }));
}

#[test]
fn test_inventory_remove_object() {
    let mut state = WorldState::new(None, None);
    let obj_guid = Guid(0x1);

    state.entities.insert(Entity::new(
        obj_guid,
        "Item".to_string(),
        WorldPosition::default(),
    ));

    let data = InventoryRemoveObjectData {
        object_guid: obj_guid,
    };
    let msg = GameMessage::InventoryRemoveObject(Box::new(data));

    let events = state.handle_message(&msg);

    assert!(state.entities.get(obj_guid).is_none());
    assert!(
        events
            .iter()
            .any(|e| matches!(e, StateEvent::EntityDespawned(guid) if *guid == obj_guid))
    );
}

#[test]
fn test_player_description_initialization() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000001);
    let player_name = "TestingPlayer".to_string();

    let data = PlayerDescriptionEventData {
        guid: player_guid,
        sequence: 1,
        name: player_name.clone(),
        wee_type: 1,
        pos: Some(WorldPosition::default()),
        properties: WorldObjectProperties::default(),
        positions: std::collections::BTreeMap::new(),
        attributes: std::collections::BTreeMap::new(),
        skills: std::collections::BTreeMap::new(),
        enchantments: Vec::new(),
        spells: std::collections::BTreeMap::new(),
        has_health: true,
        options1: 0,
        options2: 0,
        shortcuts: Vec::new(),
        hotbar_spells: Vec::new(),
        desired_comps: Vec::new(),
        spellbook_filters: 0,
        gameplay_options: Vec::new(),
        inventory: Vec::new(),
        equipped_objects: Vec::new(),
    };

    let event = GameEvent::PlayerDescription(Box::new(data));
    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: player_guid,
        sequence: 1,
        event,
    }));

    state.handle_message(&msg);

    assert_eq!(state.player.guid, player_guid);
    assert_eq!(state.player.name(), player_name);
}

#[test]
fn test_parent_event_does_not_null_player_landblock() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000001);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0xDA55001C),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.player.guid = player_guid;
    state.player.position = initial_pos;
    state
        .entities
        .insert(Entity::new(player_guid, "Player".to_string(), initial_pos));

    let msg = GameMessage::ParentEvent(Box::new(ParentEventData {
        parent_guid: Guid(0x8000031B),
        child_guid: player_guid,
        location: 1,
        placement: 1,
        parent_instance_sequence: 0,
        child_position_sequence: 0,
    }));

    state.handle_message(&msg);

    assert_eq!(state.player.position.landblock_id, initial_pos.landblock_id);
    assert_eq!(
        state
            .entities
            .get(player_guid)
            .unwrap()
            .position
            .landblock_id,
        initial_pos.landblock_id
    );
}

#[test]
fn test_player_wielder_iid_update_keeps_position() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000001);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0xDA55001C),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.player.guid = player_guid;
    state.player.position = initial_pos;
    state
        .entities
        .insert(Entity::new(player_guid, "Player".to_string(), initial_pos));

    let msg = GameMessage::PublicUpdatePropertyInstanceId(Box::new(UpdatePropertyInstanceId {
        sequence: 0,
        guid: player_guid,
        property: PropertyInstanceId::Wielder as u32,
        value: Guid(0x8000031B),
    }));

    state.handle_message(&msg);

    assert_eq!(state.player.position.landblock_id, initial_pos.landblock_id);
    assert_eq!(
        state
            .entities
            .get(player_guid)
            .unwrap()
            .position
            .landblock_id,
        initial_pos.landblock_id
    );
    assert_eq!(
        state.entities.get(player_guid).unwrap().wielder_id(),
        Some(Guid(0x8000031B))
    );
}

#[test]
fn test_explicit_delete_hides_entity_from_filtered_access() {
    let mut state = WorldState::new(None, None);
    let guid = Guid(0xABC);

    state.entities.insert(Entity::new(
        guid,
        "HiddenSoon".to_string(),
        WorldPosition::default(),
    ));

    state.mark_entity_explicit_delete(guid);

    assert!(state.entities.get(guid).is_some());
    assert!(state.get_visible_entity(guid).is_none());
    assert_eq!(state.iter_visible_entities().count(), 0);
}

#[test]
fn test_retention_snapshot_reflects_lifecycle_metadata() {
    let mut state = WorldState::new(None, None);
    let guid = Guid(0xDEF);
    let mut entity = Entity::new(guid, "Preview".to_string(), WorldPosition::default());
    entity.position.landblock_id = Guid::NULL;
    state.entities.insert(entity);

    state.mark_trade_preview(guid);
    state.mark_container_preview(guid);
    state.mark_entity_explicit_delete(guid);
    state.set_entity_prune_deadline(guid, 5.0);

    let snapshot = state.retention_snapshot(guid, 10.0).unwrap();
    assert!(!snapshot.in_world);
    assert!(snapshot.trade_preview);
    assert!(snapshot.container_preview);
    assert!(snapshot.explicit_delete_requested);
    assert!(snapshot.prune_deadline_expired);
}

#[test]
fn test_remove_entity_clears_lifecycle_metadata() {
    let mut state = WorldState::new(None, None);
    let guid = Guid(0x1234);

    state.entities.insert(Entity::new(
        guid,
        "Disposable".to_string(),
        WorldPosition::default(),
    ));
    state.mark_entity_explicit_delete(guid);

    state.remove_entity(guid);

    assert!(state.entity_lifecycle_state(guid).is_none());
}

#[test]
fn test_upsert_entity_from_create_replaces_in_place() {
    let mut state = WorldState::new(None, None);
    let guid = Guid(0x4321);
    let mut events = Vec::new();

    let original = Entity::new(guid, "Original".to_string(), WorldPosition::default());
    state.upsert_entity_from_create(original, &mut events);
    assert!(matches!(events.first(), Some(StateEvent::EntitySpawned(_))));

    state.mark_entity_explicit_delete(guid);
    events.clear();

    let replacement = Entity::new(guid, "Replacement".to_string(), WorldPosition::default());
    let outcome = state.upsert_entity_from_create(replacement, &mut events);

    assert!(matches!(outcome, EntityUpsertKind::Replaced));
    assert!(matches!(events.first(), Some(StateEvent::EntityReplaced(_))));
    assert!(state.entity_lifecycle_state(guid).is_none());
    assert_eq!(state.entities.get(guid).unwrap().name(), "Replacement");
}

#[test]
fn test_tick_sweeps_explicit_delete_without_movement() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000123);
    let target_guid = Guid(0x60000123);

    state.player.guid = player_guid;
    state.entities.insert(Entity::new(
        player_guid,
        "Player".to_string(),
        WorldPosition::default(),
    ));
    state.entities.insert(Entity::new(
        target_guid,
        "Target".to_string(),
        WorldPosition::default(),
    ));
    state.mark_entity_explicit_delete(target_guid);

    let events = state.tick(0.016, 0.35);

    assert!(state.entities.get(target_guid).is_none());
    assert!(events
        .iter()
        .any(|event| matches!(event, StateEvent::EntityDespawned(guid) if *guid == target_guid)));
}

#[test]
fn test_tick_sweeps_expired_deadline_without_movement() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000123);
    let target_guid = Guid(0x60000124);

    state.player.guid = player_guid;
    state.entities.insert(Entity::new(
        player_guid,
        "Player".to_string(),
        WorldPosition::default(),
    ));

    let mut target = Entity::new(target_guid, "Target".to_string(), WorldPosition::default());
    target.position.landblock_id = Guid::NULL;
    state.entities.insert(target);
    state.set_entity_prune_deadline(target_guid, state.current_server_time() - 1.0);

    let events = state.tick(0.016, 0.35);

    assert!(state.entities.get(target_guid).is_none());
    assert!(events
        .iter()
        .any(|event| matches!(event, StateEvent::EntityDespawned(guid) if *guid == target_guid)));
}

#[test]
fn test_tick_does_not_sweep_unexpired_deadline() {
    let mut state = WorldState::new(None, None);
    let player_guid = Guid(0x50000123);
    let target_guid = Guid(0x60000125);

    state.player.guid = player_guid;
    state.entities.insert(Entity::new(
        player_guid,
        "Player".to_string(),
        WorldPosition::default(),
    ));

    let mut target = Entity::new(target_guid, "Target".to_string(), WorldPosition::default());
    target.position.landblock_id = Guid::NULL;
    state.entities.insert(target);
    state.set_entity_prune_deadline(target_guid, state.current_server_time() + 60.0);

    let events = state.tick(0.016, 0.35);

    assert!(state.entities.get(target_guid).is_some());
    assert!(events.is_empty());
}

#[test]
fn test_tick_runs_sweep_without_player_guid() {
    let mut state = WorldState::new(None, None);
    let guid = Guid(0x70000123);

    state.entities.insert(Entity::new(
        guid,
        "Orphan".to_string(),
        WorldPosition::default(),
    ));
    state.mark_entity_explicit_delete(guid);

    let events = state.tick(0.016, 0.35);

    assert!(state.entities.get(guid).is_none());
    assert!(events
        .iter()
        .any(|event| matches!(event, StateEvent::EntityDespawned(target) if *target == guid)));
}
