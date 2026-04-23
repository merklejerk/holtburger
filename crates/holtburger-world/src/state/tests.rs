use super::*;
use binrw::BinRead;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use crate::entity::Entity;
use crate::state::liveness::EntityUpsertKind;
use crate::{
    ContactState, RuntimeBodyResetCause, SolveProjectionBasis, SolvedBodyKinematics,
    SpatialBodyEvent, SpatialBodyId, SpatialSampleMode, WorldBootstrap,
};

use crate::stats::{Skill, SkillType, TrainingLevel};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    PhysicsState, PropertyBool, PropertyInt, PropertyInt64, WorldObjectExt as _,
    WorldObjectProperties, WorldObjectPropertyAccessors, WorldObjectPropertyAccessorsMut,
};
use holtburger_common::{CharacterOption, CharacterOptions1, CharacterOptions2};
use holtburger_content::SoulEmoteCatalog;
use holtburger_dat::file_type::{
    MotionCommandKinematics, MotionKinematics, MotionKinematicsTable, MotionTable, SkillTable,
    SpellTable, XpTable,
};
use holtburger_dat::{
    DatFileType, EOR_PORTAL_NAMESPACE, HOLTBURGER_CORE_NAMESPACE, HbaReader, HbaWriter,
};
use holtburger_protocol::messages::game_event::{GameEvent, GameEventMessage};
use holtburger_protocol::messages::movement::{
    InterpretedMotionCommand, InterpretedMotionState, MotionStance, MovementStateFlags,
};
use holtburger_protocol::messages::object::events::UpdateHealthEventData;
use holtburger_protocol::messages::{
    BookDataResponseEventData, BookPageData, BookPageDataResponseEventData, FellowUpdateType,
    FellowshipFullUpdateEventData, FellowshipMemberData, FellowshipQuitEventData,
    FellowshipUpdateFellowEventData, GameMessage, PlayerTeleportData,
};
use holtburger_protocol::traits::ProtocolPack;
use tempfile::tempdir;

fn repo_assets_hba_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dats/assets.hba")
}

fn test_motion_kinematics_bytes() -> Vec<u8> {
    let mut bytes = std::io::Cursor::new(Vec::new());
    MotionKinematics::new()
        .write(&mut bytes)
        .expect("test motion kinematics asset should write");
    bytes.into_inner()
}

fn write_micro_portal_hba(path: &Path) -> bool {
    let source_path = repo_assets_hba_path();
    if !source_path.is_file() {
        eprintln!(
            "skipping assets fixture test; missing repo-local {}",
            source_path.display()
        );
        return false;
    }
    let source = match HbaReader::open(&source_path) {
        Ok(source) => source,
        Err(error) => panic!(
            "repo-local {} must be a valid HBA v2 fixture for this test: {}",
            source_path.display(),
            error
        ),
    };

    let mut writer = HbaWriter::new();
    writer.set_compression(false);

    for id in [SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID] {
        let data = source
            .get_file_in_namespace(EOR_PORTAL_NAMESPACE, id)
            .unwrap_or_else(|_| panic!("repo assets.hba should contain eor/portal:0x{id:08X}"));
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                id,
                DatFileType::from_id(id) as u32,
                data,
            )
            .expect("micro table should be added to test HBA");
    }

    writer
        .add(
            HOLTBURGER_CORE_NAMESPACE,
            MotionKinematics::FILE_ID,
            DatFileType::MotionKinematics as u32,
            test_motion_kinematics_bytes(),
        )
        .expect("motion kinematics table should be added to test HBA");

    writer
        .write(path)
        .expect("micro portal.hba should be written");

    true
}

fn motion_kinematics_asset_with_table(
    motion_table_id: u32,
    default_style: u32,
    walk_velocity: Option<Vector3>,
    run_velocity: Option<Vector3>,
    turn_left_omega: Option<Vector3>,
    turn_right_omega: Option<Vector3>,
) -> MotionKinematics {
    let mut asset = MotionKinematics::new();
    let mut table = MotionKinematicsTable::new(motion_table_id, default_style);

    if let Some(velocity) = walk_velocity {
        table.insert_cycle_kinematics(
            default_style,
            MotionTable::WALK_FORWARD_COMMAND,
            MotionCommandKinematics {
                velocity: Some(velocity),
                omega: None,
            },
        );
    }

    if let Some(velocity) = run_velocity {
        table.insert_cycle_kinematics(
            default_style,
            MotionTable::RUN_FORWARD_COMMAND,
            MotionCommandKinematics {
                velocity: Some(velocity),
                omega: None,
            },
        );
    }

    if let Some(omega) = turn_left_omega {
        table.insert_cycle_kinematics(
            default_style,
            MotionTable::TURN_LEFT_COMMAND,
            MotionCommandKinematics {
                velocity: None,
                omega: Some(omega),
            },
        );
    }

    if let Some(omega) = turn_right_omega {
        table.insert_cycle_kinematics(
            default_style,
            MotionTable::TURN_RIGHT_COMMAND,
            MotionCommandKinematics {
                velocity: None,
                omega: Some(omega),
            },
        );
    }

    asset.motion_tables.insert(motion_table_id, table);
    asset
}

fn test_motion_kinematics_asset(motion_table_id: u32) -> MotionKinematics {
    motion_kinematics_asset_with_table(
        motion_table_id,
        MotionStance::NonCombat as u32,
        Some(Vector3::new(1.0, 0.0, 0.0)),
        Some(Vector3::new(2.5, 0.0, 0.0)),
        Some(Vector3::new(0.0, 0.0, -1.5)),
        Some(Vector3::new(0.0, 0.0, 1.5)),
    )
}

fn seed_player_run_skill(world: &mut WorldState, run_skill: u32) {
    world.player.skills.insert(
        SkillType::Run,
        Skill {
            skill_type: SkillType::Run,
            ranks: 0,
            init: run_skill,
            spent_xp: 0,
            next_rank_xp: None,
            base: run_skill,
            current: run_skill,
            training: TrainingLevel::Trained,
            trained_cost: 0,
            specialized_cost: 0,
        },
    );
}

#[test]
fn resolve_player_motion_table_profile_prefers_direct_motion_table_property() {
    let motion_table_id = 0x0900_0020;

    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0001);
    state.set_motion_kinematics(test_motion_kinematics_asset(motion_table_id));
    state.player.guid = player_guid;

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::MotionTable,
        Guid(motion_table_id),
    );
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::Setup,
        Guid(0x0200_0010),
    );
    state.entities.insert(player);

    let resolved = state
        .resolve_player_motion_table_profile()
        .expect("direct motion table should resolve");

    assert_eq!(
        resolved.source,
        PlayerMotionTableSource::DirectProperty { motion_table_id }
    );
    assert_eq!(
        resolved
            .movement_profile
            .run_forward
            .and_then(|entry| entry.velocity),
        Some(Vector3::new(2.5, 0.0, 0.0))
    );
}

#[test]
fn resolve_player_motion_table_profile_falls_back_to_setup_model_default() {
    let motion_table_id = 0x0900_0020;
    let setup_model_id = 0x0200_0010;

    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0002);
    let mut motion_kinematics = test_motion_kinematics_asset(motion_table_id);
    motion_kinematics
        .setup_model_defaults
        .insert(setup_model_id, motion_table_id);
    state.set_motion_kinematics(motion_kinematics);
    state.player.guid = player_guid;

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::Setup,
        Guid(setup_model_id),
    );
    state.entities.insert(player);

    let resolved = state
        .resolve_player_motion_table_profile()
        .expect("setup-model fallback should resolve");

    assert_eq!(
        resolved.source,
        PlayerMotionTableSource::SetupModelDefault {
            setup_model_id,
            motion_table_id,
        }
    );
    assert_eq!(
        resolved
            .movement_profile
            .turn_right
            .and_then(|entry| entry.omega),
        Some(Vector3::new(0.0, 0.0, 1.5))
    );
}

#[test]
fn resolve_player_motion_table_profile_reads_run_speed_from_required_motion_kinematics_asset() {
    let motion_table_id = 0x0900_0023;

    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0004);
    state.set_motion_kinematics(test_motion_kinematics_asset(motion_table_id));
    state.player.guid = player_guid;

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::MotionTable,
        Guid(motion_table_id),
    );
    state.entities.insert(player);

    let resolved = state
        .resolve_player_motion_table_profile()
        .expect("run speed should derive from animation position frames");

    assert_eq!(resolved.movement_profile.motion_table_id, motion_table_id);
    assert_eq!(
        resolved
            .movement_profile
            .run_forward
            .and_then(|entry| entry.velocity),
        Some(Vector3::new(2.5, 0.0, 0.0))
    );
}

#[test]
fn resolve_player_motion_table_profile_reports_missing_setup_default_motion_table() {
    let setup_model_id = 0x0200_0011;

    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0003);
    state.player.guid = player_guid;

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::Setup,
        Guid(setup_model_id),
    );
    state.entities.insert(player);

    let error = state
        .resolve_player_motion_table_profile()
        .expect_err("missing setup default motion table should be explicit");

    assert!(matches!(
        error,
        PlayerMotionTableLookupError::SetupModelMissingDefaultMotionTable { setup_model_id: id }
            if id == setup_model_id
    ));
}

#[test]
fn resolve_self_movement_capabilities_combines_run_rate_and_motion_table_kinematics() {
    let motion_table_id = 0x0900_0020;

    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0100);
    state.set_motion_kinematics(test_motion_kinematics_asset(motion_table_id));
    state.player.guid = player_guid;
    seed_player_run_skill(&mut state, 800);

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::MotionTable,
        Guid(motion_table_id),
    );
    state.entities.insert(player);

    let capabilities = state
        .resolve_self_movement_capabilities()
        .expect("self-movement capabilities should resolve");

    assert_eq!(capabilities.motion_table_id(), motion_table_id);
    assert_eq!(capabilities.run_rate_scalar, 4.5);
    assert_eq!(capabilities.base_walk_forward_speed(), 1.0);
    assert_eq!(capabilities.base_run_forward_speed(), 2.5);
    assert_eq!(capabilities.resolved_manual_run_speed(), 11.25);
    assert_eq!(capabilities.resolved_autonomous_run_speed(1.0), 11.25);
    assert_eq!(capabilities.resolved_autonomous_run_speed(1.5), 16.875);
    assert_eq!(capabilities.base_turn_left_speed_rad_per_sec(), 1.5);
    assert_eq!(capabilities.base_turn_right_speed_rad_per_sec(), 1.5);
    assert_eq!(
        capabilities.resolved_manual_run_velocity(),
        Vector3::new(11.25, 0.0, 0.0)
    );
}

#[test]
fn resolve_self_movement_capabilities_prefers_synthetic_override() {
    let mut state = WorldState::synthetic();
    let override_capabilities = SelfMovementCapabilities {
        kinematics: crate::state::SelfMovementKinematics {
            source: PlayerMotionTableSource::DirectProperty {
                motion_table_id: 0x0900_00AA,
            },
            motion_table_id: 0x0900_00AA,
            stance: MotionStance::NonCombat as u32,
            base_walk_forward_velocity: Vector3::new(0.75, 0.0, 0.0),
            base_run_forward_velocity: Vector3::new(2.0, 0.0, 0.0),
            base_turn_left_omega: Vector3::new(0.0, 0.0, -1.25),
            base_turn_right_omega: Vector3::new(0.0, 0.0, 1.25),
        },
        run_rate_scalar: 3.25,
    };
    state.set_self_movement_capabilities_override(override_capabilities.clone());

    let resolved = state
        .resolve_self_movement_capabilities()
        .expect("synthetic override should bypass resource lookup");

    assert_eq!(resolved, override_capabilities);
}

#[test]
fn resolve_self_movement_capabilities_reports_missing_required_kinematics() {
    let motion_table_id = 0x0900_0021;

    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0101);
    state.set_motion_kinematics(motion_kinematics_asset_with_table(
        motion_table_id,
        MotionStance::NonCombat as u32,
        Some(Vector3::new(1.0, 0.0, 0.0)),
        None,
        Some(Vector3::new(0.0, 0.0, -1.5)),
        Some(Vector3::new(0.0, 0.0, 1.5)),
    ));
    state.player.guid = player_guid;
    seed_player_run_skill(&mut state, 800);

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::MotionTable,
        Guid(motion_table_id),
    );
    state.entities.insert(player);

    let error = state
        .resolve_self_movement_capabilities()
        .expect_err("missing run velocity should be explicit");

    assert!(matches!(
        error,
        SelfMovementCapabilitiesError::Kinematics(
            crate::state::SelfMovementKinematicsError::MissingRequiredKinematics {
                motion_table_id: id,
                kind: RequiredSelfMovementKinematics::RunForwardVelocity,
                ..
            }
        ) if id == motion_table_id
    ));
}

#[test]
fn resolve_self_movement_capabilities_falls_back_when_walk_velocity_is_missing() {
    let motion_table_id = 0x0900_0022;

    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0102);
    state.set_motion_kinematics(motion_kinematics_asset_with_table(
        motion_table_id,
        MotionStance::NonCombat as u32,
        None,
        Some(Vector3::new(2.5, 0.0, 0.0)),
        Some(Vector3::new(0.0, 0.0, -1.5)),
        Some(Vector3::new(0.0, 0.0, 1.5)),
    ));
    state.player.guid = player_guid;
    seed_player_run_skill(&mut state, 800);

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::MotionTable,
        Guid(motion_table_id),
    );
    state.entities.insert(player);

    let capabilities = state
        .resolve_self_movement_capabilities()
        .expect("missing walk velocity should fall back to run-forward data");

    assert_eq!(capabilities.base_walk_forward_speed(), 2.5);
    assert_eq!(capabilities.base_run_forward_speed(), 2.5);
}

#[test]
fn resolve_self_movement_capabilities_derives_left_turn_from_right_turn_omega() {
    let motion_table_id: u32 = 0x0900_0024;
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0103);
    state.set_motion_kinematics(motion_kinematics_asset_with_table(
        motion_table_id,
        MotionStance::NonCombat as u32,
        Some(Vector3::new(1.0, 0.0, 0.0)),
        Some(Vector3::new(2.5, 0.0, 0.0)),
        None,
        Some(Vector3::new(0.0, 0.0, -1.5)),
    ));
    state.player.guid = player_guid;
    seed_player_run_skill(&mut state, 800);

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::MotionTable,
        Guid(motion_table_id),
    );
    state.entities.insert(player);

    let capabilities = state
        .resolve_self_movement_capabilities()
        .expect("single-turn motion tables should still resolve turn capabilities");

    assert_eq!(
        capabilities.kinematics().base_turn_right_omega,
        Vector3::new(0.0, 0.0, -1.5)
    );
    assert_eq!(
        capabilities.kinematics().base_turn_left_omega,
        Vector3::new(0.0, 0.0, 1.5)
    );
}

#[test]
fn resolve_body_projection_input_uses_grounded_motion_snapshot_without_vector_update() {
    let motion_table_id = 0x0900_0040;
    let guid = Guid(0x7000_0100);
    let pose = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(10.0, 20.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    let mut state = WorldState::synthetic();
    state.set_motion_kinematics(test_motion_kinematics_asset(motion_table_id));

    let mut entity = Entity::new(guid, "Remote".to_string(), pose);
    entity.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::MotionTable,
        Guid(motion_table_id),
    );
    entity.motion_snapshot = Some(crate::entity::EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
        sidestep_command: None,
        turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
        forward_speed: crate::entity::OrderedMotionSpeed::from_f32(3.5),
        sidestep_speed: None,
        turn_speed: crate::entity::OrderedMotionSpeed::from_f32(0.75),
        directive: None,
    });
    state.entities.insert(entity);

    state.scene.reconcile_authoritative_body(
        SpatialBodyId::Entity(guid),
        pose,
        Vector3::zero(),
        Vector3::zero(),
        crate::AuthoritativeBodySync::Snapshot,
        Instant::now(),
    );
    assert!(
        state
            .scene
            .apply_runtime_body_contact(SpatialBodyId::Entity(guid), ContactState::Grounded)
    );

    let input = state
        .resolve_body_projection_input(SpatialBodyId::Entity(guid))
        .expect("guid-backed remote body should resolve projection input");

    assert_eq!(input.contact, ContactState::Grounded);
    assert!(matches!(
        input.basis,
        Some(SolveProjectionBasis::GroundedMotion {
            desired_local_velocity,
            desired_local_omega,
        }) if desired_local_velocity == Vector3::new(3.5, 0.0, 0.0)
            && desired_local_omega == Vector3::new(0.0, 0.0, 0.75)
    ));
}

#[test]
fn resolve_body_projection_input_falls_back_to_velocity_for_airborne_body() {
    let guid = Guid(0x7000_0101);
    let pose = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    let mut state = WorldState::synthetic();
    let mut entity = Entity::new(guid, "Remote".to_string(), pose);
    entity.velocity = Vector3::new(0.0, 0.0, 4.0);
    entity.omega = Vector3::new(0.0, 0.0, 0.5);
    entity.motion_snapshot = Some(crate::entity::EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
        sidestep_command: None,
        turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
        forward_speed: None,
        sidestep_speed: None,
        turn_speed: None,
        directive: None,
    });
    state.entities.insert(entity);

    state.scene.reconcile_authoritative_body(
        SpatialBodyId::Entity(guid),
        pose,
        Vector3::new(0.0, 0.0, 4.0),
        Vector3::new(0.0, 0.0, 0.5),
        crate::AuthoritativeBodySync::Snapshot,
        Instant::now(),
    );
    assert!(
        state
            .scene
            .apply_runtime_body_contact(SpatialBodyId::Entity(guid), ContactState::Airborne)
    );

    let input = state
        .resolve_body_projection_input(SpatialBodyId::Entity(guid))
        .expect("airborne guid-backed body should resolve projection input");

    assert!(matches!(
        input.basis,
        Some(SolveProjectionBasis::Velocity { velocity, omega })
            if velocity == Vector3::new(0.0, 0.0, 4.0)
                && omega == Vector3::new(0.0, 0.0, 0.5)
    ));
}

#[test]
fn test_set_player_vector_updates_authoritative_player_entity() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    state.player.guid = player_guid;

    let initial_pos = WorldPosition::default();
    let player_entity = Entity::new(player_guid, "Player".to_string(), initial_pos);
    state.entities.insert(player_entity);

    let new_vel = Vector3::new(1.0, 2.0, 3.0);
    let new_omega = Vector3::new(0.0, 0.0, 4.0);
    let events = state.set_player_vector(new_vel, new_omega);

    assert_eq!(state.entities.get(player_guid).unwrap().velocity, new_vel);
    assert_eq!(state.entities.get(player_guid).unwrap().omega, new_omega);
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityVectorUpdated { guid, velocity, omega }
            if *guid == player_guid && *velocity == new_vel && *omega == new_omega
    )));
}

#[test]
fn set_local_player_runtime_pose_only_emits_runtime_body_change() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0123);
    let start_pos = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.seed_local_player_entity(player_guid, "Player", start_pos);

    let events = state.set_local_player_runtime_pose(WorldPosition {
        coords: Vector3::new(4.0, 5.0, 6.0),
        ..start_pos
    });

    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodyChanged {
            body_id: SpatialBodyId::LocalPlayer(guid)
        } if *guid == player_guid
    )));
    assert!(!events.iter().any(
        |event| matches!(event, WorldEvent::EntityMoved { guid, .. } if *guid == player_guid)
    ));
}

#[test]
fn solved_remote_runtime_body_only_emits_runtime_body_change() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x5000_0222);
    let pose = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(2.0, 3.0, 4.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.add_entity(Entity::new(guid, "Remote".to_string(), pose));

    let events = state.apply_solved_body_kinematics(&SolvedBodyKinematics {
        body_id: SpatialBodyId::Entity(guid),
        pose: WorldPosition {
            coords: Vector3::new(5.0, 6.0, 4.0),
            ..pose
        },
        velocity: Vector3::new(1.0, 0.0, 0.0),
        omega: Vector3::zero(),
        contact: ContactState::Grounded,
        projection_state: None,
    });

    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodyChanged {
            body_id: SpatialBodyId::Entity(event_guid)
        } if *event_guid == guid
    )));
    assert!(!events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMoved { guid: event_guid, .. } if *event_guid == guid
    )));
    assert!(!events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityVectorUpdated { guid: event_guid, .. } if *event_guid == guid
    )));
}

#[test]
fn authoritative_player_snapshots_do_not_clobber_active_local_runtime_motion() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0125);
    let authoritative_pose = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let runtime_pose = WorldPosition {
        coords: Vector3::new(10.0, 20.0, 3.0),
        ..authoritative_pose
    };

    state.seed_local_player_entity(player_guid, "Player", authoritative_pose);

    let runtime_events = state.apply_solved_body_kinematics(&SolvedBodyKinematics {
        body_id: SpatialBodyId::LocalPlayer(player_guid),
        pose: runtime_pose,
        velocity: Vector3::new(1.0, 0.0, 0.0),
        omega: Vector3::new(0.0, 0.0, 0.5),
        contact: ContactState::Grounded,
        projection_state: Some(crate::SelfPlayerDriveProjectionState::LocalGroundedDirectDrive),
    });
    assert!(!runtime_events.is_empty());

    let authoritative_update = WorldPosition {
        coords: Vector3::new(2.0, 3.0, 3.0),
        ..authoritative_pose
    };
    state.set_player_position(authoritative_update);

    let body = state
        .scene
        .body(SpatialBodyId::LocalPlayer(player_guid))
        .expect("local player runtime body should exist");
    assert_eq!(body.pose, runtime_pose);
    assert_eq!(body.authoritative_pose, Some(authoritative_update));
    assert_eq!(body.sampling.mode, SpatialSampleMode::SimulatingMotionState);
}

#[test]
fn local_forced_reposition_uses_single_reset_reconcile_path() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0999);
    let start_pos = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let forced_pos = WorldPosition {
        coords: Vector3::new(9.0, 8.0, 3.0),
        ..start_pos
    };

    state.seed_local_player_entity(player_guid, "Player", start_pos);

    let events = state.apply_spatial_body_event(&crate::SpatialBodyEvent::ForcedReposition {
        body_id: SpatialBodyId::LocalPlayer(player_guid),
        pose: forced_pos,
    });

    assert_eq!(state.player_position(), Some(start_pos));
    assert_eq!(state.entities.get(player_guid).unwrap().position, start_pos);
    assert_eq!(
        state
            .scene
            .body(SpatialBodyId::LocalPlayer(player_guid))
            .expect("local player runtime body should exist after forced reposition")
            .pose,
        forced_pos
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(
                event,
                WorldEvent::RuntimeBodyChanged {
                    body_id: SpatialBodyId::LocalPlayer(guid)
                } if *guid == player_guid
            ))
            .count(),
        1
    );
    assert!(!events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMoved { guid, .. } if *guid == player_guid
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::ForcedReposition {
            guid,
            pos,
            sequence: 0,
        } if *guid == player_guid && *pos == forced_pos
    )));
}

#[test]
fn test_set_player_position_sanitizes_nan_rotation() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    state.player.guid = player_guid;

    let initial_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    state.seed_local_player_entity(player_guid, "Player", initial_pos);

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
        state
            .player_position()
            .expect("player entity should exist")
            .rotation,
        holtburger_common::math::Quaternion::identity()
    );
    assert_eq!(
        state.entities.get(player_guid).unwrap().position.rotation,
        holtburger_common::math::Quaternion::identity()
    );
}

#[test]
fn apply_solved_body_kinematics_updates_local_runtime_body_and_grounded_state() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    let start_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.seed_local_player_entity(player_guid, "Player", start_pos);

    let solved = SolvedBodyKinematics {
        body_id: SpatialBodyId::LocalPlayer(player_guid),
        pose: WorldPosition {
            landblock_id: Guid(0x12340000),
            coords: Vector3::new(10.0, 20.0, 30.0),
            rotation: holtburger_common::math::Quaternion::identity(),
        },
        velocity: Vector3::new(1.0, 2.0, 3.0),
        omega: Vector3::new(0.0, 0.0, 4.0),
        contact: ContactState::Grounded,
        projection_state: None,
    };

    let events = state.apply_solved_body_kinematics(&solved);

    assert_eq!(state.player_position(), Some(start_pos));
    let entity = state
        .entities
        .get(player_guid)
        .expect("authoritative player entity should still exist");
    assert_eq!(entity.position, start_pos);
    assert_eq!(entity.velocity, Vector3::zero());
    assert_eq!(entity.omega, Vector3::zero());
    let runtime_body = state
        .scene
        .body(SpatialBodyId::LocalPlayer(player_guid))
        .expect("local player runtime body should exist");
    assert_eq!(runtime_body.pose, solved.pose);
    assert_eq!(runtime_body.velocity, solved.velocity);
    assert_eq!(runtime_body.omega, solved.omega);
    assert_eq!(state.player.last_server_grounded, Some(true));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodyChanged {
            body_id: SpatialBodyId::LocalPlayer(guid)
        } if *guid == player_guid
    )));
    assert!(
        events
            .iter()
            .any(|event| matches!(event, WorldEvent::PlayerGroundedUpdated { grounded: true }))
    );
}

#[test]
fn apply_solved_body_kinematics_preserves_player_grounded_cache_when_contact_unknown() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    let start_pos = WorldPosition::default();

    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", start_pos);
    state.player.last_server_grounded = Some(true);

    let solved = SolvedBodyKinematics {
        body_id: SpatialBodyId::LocalPlayer(player_guid),
        pose: WorldPosition {
            coords: Vector3::new(1.0, 2.0, 3.0),
            ..start_pos
        },
        velocity: Vector3::zero(),
        omega: Vector3::zero(),
        contact: ContactState::Unknown,
        projection_state: None,
    };

    let events = state.apply_solved_body_kinematics(&solved);

    assert_eq!(state.player.last_server_grounded, Some(true));
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, WorldEvent::PlayerGroundedUpdated { .. }))
    );
}

#[test]
fn apply_spatial_body_event_emits_runtime_body_changed_for_remote_contact() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x5000_0200);
    let position = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.add_entity(Entity::new(guid, "Drudge".to_string(), position));

    let events = state.apply_spatial_body_event(&SpatialBodyEvent::ContactChanged {
        body_id: SpatialBodyId::Entity(guid),
        contact: ContactState::Grounded,
    });

    assert_eq!(
        state
            .scene
            .body(SpatialBodyId::Entity(guid))
            .expect("runtime body should exist")
            .contact,
        ContactState::Grounded
    );
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodyChanged { body_id }
            if *body_id == SpatialBodyId::Entity(guid)
    )));
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, WorldEvent::PlayerGroundedUpdated { .. }))
    );
}

#[test]
fn player_teleport_suspends_runtime_bodies_and_emits_reset_signal() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0201);
    let position = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(10.0, 20.0, 30.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", position);

    let events = state.handle_message(&GameMessage::PlayerTeleport(Box::new(PlayerTeleportData {
        teleport_sequence: 7,
    })));

    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::RuntimeBodiesReset {
            cause: RuntimeBodyResetCause::TeleportOrWorldReset
        }
    )));
    assert!(
        events
            .iter()
            .any(|event| matches!(event, WorldEvent::TeleportStarted { sequence: 7 }))
    );
    assert_eq!(
        state
            .scene
            .body(SpatialBodyId::LocalPlayer(player_guid))
            .expect("local player runtime body should exist")
            .sampling
            .mode,
        SpatialSampleMode::Suspended
    );
}

#[test]
fn test_spell_name_resolution() {
    use crate::spell::{SpellCatalog, SpellInfo};

    let mut state = WorldState::synthetic();
    let mut spells = std::collections::HashMap::new();
    spells.insert(
        1337,
        SpellInfo {
            name: "L33t Spell".to_string(),
            description: String::new(),
            school: crate::spell::MagicSchool::None,
            icon_id: 0,
            category: 0,
            bitfield: 0,
            base_mana: 0,
            base_range_constant: 0.0,
            base_range_mod: 0.0,
            power: 0,
            spell_economy_mod: 0.0,
            formula_version: 0,
            component_loss: 0.0,
            meta_spell_type: 0,
            meta_spell_id: 0,
            extras: crate::spell::SpellExtrasInfo::None,
            components: [0; 8],
            caster_effect: 0,
            target_effect: 0,
            fizzle_effect: 0,
            recovery_interval: 0.0,
            recovery_amount: 0.0,
            display_order: 0,
            non_component_target_type: 0,
            mana_mod: 0,
        },
    );

    state.spell_catalog = Arc::new(SpellCatalog {
        spells,
        ..Default::default()
    });

    assert_eq!(state.resolve_spell_name(1337).unwrap(), "L33t Spell");
    assert!(state.resolve_spell_name(999).is_none());
}

#[test]
fn test_empty_world_uses_synthetic_reference_data() {
    let state = WorldState::synthetic();
    assert_eq!(state.xp_table.character_level_xp_list, vec![0]);
    assert!(state.skill_table.skill_base_hash.is_empty());
    assert!(state.spell_catalog.spells.is_empty());
    assert!(state.soul_emote_catalog.tokens.is_empty());
}

#[test]
fn test_micro_portal_bundle_supports_runtime_table_lookups() {
    let dir = tempdir().expect("tempdir should be created");
    let portal_path = dir.path().join("bundle.hba");
    if !write_micro_portal_hba(&portal_path) {
        return;
    }

    let archive = HbaReader::open(&portal_path).expect("micro portal.hba should open");
    let skill_table = SkillTable::read(&mut std::io::Cursor::new(
        archive
            .get_file_in_namespace(EOR_PORTAL_NAMESPACE, SkillTable::FILE_ID)
            .expect("micro bundle should contain skill table"),
    ))
    .expect("skill table should parse");
    let spell_table = SpellTable::read(&mut std::io::Cursor::new(
        archive
            .get_file_in_namespace(EOR_PORTAL_NAMESPACE, SpellTable::FILE_ID)
            .expect("micro bundle should contain spell table"),
    ))
    .expect("spell table should parse");
    let xp_table = XpTable::read(&mut std::io::Cursor::new(
        archive
            .get_file_in_namespace(EOR_PORTAL_NAMESPACE, XpTable::FILE_ID)
            .expect("micro bundle should contain XP table"),
    ))
    .expect("XP table should parse");
    let motion_kinematics = MotionKinematics::read(&mut std::io::Cursor::new(
        archive
            .get_file_in_namespace(HOLTBURGER_CORE_NAMESPACE, MotionKinematics::FILE_ID)
            .expect("micro bundle should contain motion kinematics"),
    ))
    .expect("motion kinematics should parse");

    let mut state = WorldState::new(Arc::new(WorldBootstrap::new(
        skill_table,
        spell_table,
        xp_table,
        motion_kinematics,
        SoulEmoteCatalog::default(),
    )));

    assert!(!state.skill_table.skill_base_hash.is_empty());
    assert!(!state.xp_table.character_level_xp_list.is_empty());
    assert!(!state.spell_catalog.spells.is_empty());

    let player_guid = Guid(0x5000_0101);
    state.seed_local_player_entity(player_guid, "Player", WorldPosition::default());
    let player_entity = state
        .player_entity_mut()
        .expect("local player entity should exist");
    player_entity.properties.set_int_prop(PropertyInt::Level, 1);
    player_entity
        .properties
        .set_int64_prop(PropertyInt64::TotalExperience, 0);
    player_entity
        .properties
        .set_int64_prop(PropertyInt64::AvailableExperience, 1234);
    player_entity
        .properties
        .set_int_prop(PropertyInt::AvailableSkillCredits, 5);
    player_entity
        .properties
        .set_int64_prop(PropertyInt64::AvailableLuminance, 42);

    let level_info = state.get_level_info();
    assert_eq!(level_info.level, 1);
    assert_eq!(level_info.current_xp, 0);
    assert_eq!(level_info.unspent_xp, 1234);
    assert_eq!(level_info.unspent_skill_points, 5);
    assert_eq!(level_info.available_luminance, 42);
    assert!(level_info.xp_for_next_level > 0);

    let (spell_id, expected_name) = state
        .spell_catalog
        .spells
        .iter()
        .find(|(_, info)| {
            !info.name.is_empty()
                && (!info.description.is_empty() || info.base_mana > 0 || info.power > 0)
        })
        .map(|(id, info)| (*id, info.name.clone()))
        .expect("micro spell catalog should expose at least one detailed spell");

    let resolved_name = state
        .resolve_spell_name(spell_id)
        .expect("spell name should resolve from the micro bundle");
    let resolved_info = state
        .resolve_spell_info(spell_id)
        .expect("spell details should resolve from the micro bundle");

    assert_eq!(resolved_name, expected_name);
    assert_eq!(resolved_info.name, expected_name);
    assert!(
        !resolved_info.description.is_empty()
            || resolved_info.base_mana > 0
            || resolved_info.power > 0
    );

    let (skill_id, expected_costs) = state
        .skill_table
        .skill_base_hash
        .iter()
        .find_map(|(id, base)| {
            crate::stats::SkillType::from_repr(*id)
                .filter(|_| base.trained_cost > 0 || base.specialized_cost > 0)
                .map(|skill| {
                    (
                        skill as u32,
                        (base.trained_cost as u32, base.specialized_cost as u32),
                    )
                })
        })
        .expect("micro skill table should expose a trainable skill");

    let mut events = Vec::new();
    state.player.update_skill(
        crate::player::mutations::SkillUpdateParams {
            skill_id,
            ranks: 0,
            status: 2,
            init: 10,
            xp: 0,
            xp_table: &state.xp_table,
            skill_table: &state.skill_table,
        },
        &mut events,
    );

    let updated_skill = events
        .into_iter()
        .find_map(|event| match event {
            WorldEvent::SkillUpdated(skill) if skill.skill_type as u32 == skill_id => Some(skill),
            _ => None,
        })
        .expect("skill update should emit a SkillUpdated event");

    assert_eq!(
        (updated_skill.trained_cost, updated_skill.specialized_cost),
        expected_costs
    );
    assert!(updated_skill.trained_cost > 0 || updated_skill.specialized_cost > 0);
}

#[test]
fn repo_portal_bundle_supports_default_player_motion_table_profile() {
    let portal_path = repo_assets_hba_path();
    if !portal_path.is_file() {
        eprintln!(
            "skipping motion-table integration probe; missing repo-local {}",
            portal_path.display()
        );
        return;
    }

    let provider = match HbaReader::open(&portal_path) {
        Ok(provider) => Arc::new(provider),
        Err(error) => {
            eprintln!(
                "skipping motion-table integration probe; repo-local {} is not an HBA v2 fixture yet: {}",
                portal_path.display(),
                error
            );
            return;
        }
    };
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0200);
    let motion_kinematics_bytes = match provider
        .get_file_in_namespace(HOLTBURGER_CORE_NAMESPACE, MotionKinematics::FILE_ID)
    {
        Ok(bytes) => bytes,
        Err(_) => {
            eprintln!(
                "skipping motion-table integration probe; repo-local {} does not yet contain holtburger/core motion kinematics",
                portal_path.display()
            );
            return;
        }
    };
    state.set_motion_kinematics(
        MotionKinematics::read(&mut std::io::Cursor::new(motion_kinematics_bytes))
            .expect("repo motion kinematics asset should parse"),
    );
    state.player.guid = player_guid;

    let mut player = Entity::new(player_guid, "Player".to_string(), WorldPosition::default());
    player.properties.set_did_prop(
        holtburger_common::properties::PropertyDataId::MotionTable,
        Guid(0x0900_0001),
    );
    state.entities.insert(player);

    let resolved = state.resolve_player_motion_table_profile();
    match resolved {
        Ok(profile) => {
            eprintln!(
                "resolved repo motion-table profile: run={:?} walk={:?} turn_right={:?}",
                profile.movement_profile.run_forward,
                profile.movement_profile.walk_forward,
                profile.movement_profile.turn_right,
            );
        }
        Err(error) => {
            panic!(
                "repo assets bundle failed to resolve eor/portal motion table 0x09000001: {error}"
            )
        }
    }
}

#[test]
fn test_tick_does_not_integrate_player_velocity() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000124);
    let player_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(10.0, 20.0, 30.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.player.guid = player_guid;
    let mut player_entity = Entity::new(player_guid, "Player".to_string(), player_pos);
    player_entity.velocity = Vector3::new(3.0, 4.0, 0.0);
    state.add_entity(player_entity);

    let events = state.tick();

    assert!(events.is_empty());
    assert_eq!(state.player_position(), Some(player_pos));
    assert_eq!(
        state.entities.get(player_guid).unwrap().position,
        player_pos
    );
    assert_eq!(
        state.entities.get(player_guid).unwrap().velocity,
        Vector3::new(3.0, 4.0, 0.0)
    );
}

#[test]
fn test_tick_does_not_require_runtime_resource_access() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000125);
    let player_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.player.guid = player_guid;
    let mut player_entity = Entity::new(player_guid, "Player".to_string(), player_pos);
    player_entity.velocity = Vector3::new(1.0, 0.0, 0.0);
    state.add_entity(player_entity);

    let events = state.tick();

    assert!(events.is_empty());
    assert_eq!(state.player_position(), Some(player_pos));
}

#[test]
fn test_player_autonomous_sync_updates_authoritative_player_entity() {
    let mut state = WorldState::synthetic();
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

    let events = state.apply_player_autonomous_position(&sync_data);

    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::SelfAutonomousPosition {
            teleport_sequence: 30,
            force_position_sequence: 40,
            server_control_sequence: 20,
        }
    )));

    assert_eq!(state.player_position(), Some(sync_data.position));
    assert_eq!(
        state.entities.get(player_guid).unwrap().position,
        sync_data.position
    );
    assert_eq!(state.player.instance_sequence, 10);
    assert_eq!(state.player.server_control_sequence, 20);
}

#[test]
fn test_stale_player_autonomous_sync_is_ignored() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    state.player.guid = player_guid;
    state.player.teleport_sequence = 30;
    state.player.force_position_sequence = 40;

    let initial_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(5.0, 5.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    state.seed_local_player_entity(player_guid, "Player", initial_pos);

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
        force_position_sequence: 39,
        contact_flags: 0,
    };

    let events = state.apply_player_autonomous_position(&sync_data);

    assert!(events.is_empty());
    assert_eq!(state.player_position(), Some(initial_pos));
    assert_eq!(
        state.entities.get(player_guid).unwrap().position,
        initial_pos
    );
    assert_eq!(state.player.teleport_sequence, 30);
    assert_eq!(state.player.force_position_sequence, 40);
}

#[test]
fn test_remote_update_position_emits_forced_reposition_when_force_sequence_advances() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x6000_0001);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let mut entity = Entity::new(guid, "Target".to_string(), initial_pos);
    entity.sequences[4] = 30;
    entity.sequences[6] = 40;
    state.entities.insert(entity);

    let msg = GameMessage::UpdatePosition(Box::new(UpdatePositionData {
        guid,
        pos: PositionPack {
            pos: WorldPosition {
                landblock_id: Guid(0x01000000),
                coords: Vector3::new(10.0, 20.0, 0.5),
                rotation: holtburger_common::math::Quaternion::identity(),
            },
            instance_sequence: 8,
            position_sequence: 9,
            teleport_sequence: 30,
            force_position_sequence: 41,
            ..PositionPack::default()
        },
    }));

    let events = state.handle_message(&msg);

    assert_eq!(state.entities.get(guid).unwrap().position.coords.x, 10.0);
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::ForcedReposition {
            guid: event_guid,
            pos,
            sequence: 41,
        } if *event_guid == guid && (pos.coords.x - 10.0).abs() < 1e-5
    )));
}

#[test]
fn test_stale_remote_update_position_is_ignored_when_force_sequence_regresses() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0002);
    let guid = Guid(0x6000_0002);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0x0A0AFFFF),
        coords: Vector3::new(4.0, 5.0, 6.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", initial_pos);

    let mut entity = Entity::new(guid, "Target".to_string(), initial_pos);
    entity.sequences[4] = 30;
    entity.sequences[6] = 40;
    state.add_entity(entity);

    let msg = GameMessage::UpdatePosition(Box::new(UpdatePositionData {
        guid,
        pos: PositionPack {
            pos: WorldPosition {
                landblock_id: Guid(0x2020FFFF),
                coords: Vector3::new(40.0, 50.0, 60.0),
                rotation: holtburger_common::math::Quaternion::identity(),
            },
            instance_sequence: 8,
            position_sequence: 9,
            teleport_sequence: 30,
            force_position_sequence: 39,
            ..PositionPack::default()
        },
    }));

    let events = state.handle_message(&msg);

    assert!(events.is_empty());
    assert_eq!(state.entities.get(guid).unwrap().position, initial_pos);

    let nearby: std::collections::HashSet<_> = state
        .get_nearby_world_entities()
        .into_iter()
        .map(|entity| entity.guid)
        .collect();
    assert!(nearby.contains(&guid));
}

#[test]
fn test_remote_autonomous_position_emits_forced_reposition_even_without_sequence_change() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x6000_0003);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0x01000000),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let mut entity = Entity::new(guid, "Target".to_string(), initial_pos);
    entity.sequences[4] = 30;
    entity.sequences[6] = 40;
    state.entities.insert(entity);

    let msg = GameMessage::AutonomousPosition(Box::new(ServerAutonomousPositionData {
        guid,
        position: WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: Vector3::new(7.0, 8.0, 9.0),
            rotation: holtburger_common::math::Quaternion::identity(),
        },
        instance_sequence: 12,
        server_control_sequence: 13,
        teleport_sequence: 30,
        force_position_sequence: 40,
        contact_flags: 0,
    }));

    let events = state.handle_message(&msg);

    assert_eq!(state.entities.get(guid).unwrap().position.coords.x, 7.0);
    assert_eq!(state.entities.get(guid).unwrap().sequences[5], 13);
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::ForcedReposition {
            guid: event_guid,
            pos,
            sequence: 40,
        } if *event_guid == guid && (pos.coords.x - 7.0).abs() < 1e-5
    )));
}

#[test]
fn test_update_health_updates_target_entity_fraction_and_emits_replace() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x60000001);
    state.add_entity(Entity::new(
        guid,
        "Drudge".to_string(),
        WorldPosition::default(),
    ));

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: guid,
        sequence: 1,
        event: GameEvent::UpdateHealth(Box::new(UpdateHealthEventData {
            target: guid,
            health: 0.5,
        })),
    }));

    let events = state.handle_message(&msg);

    assert_eq!(
        state
            .entities
            .get(guid)
            .and_then(|entity| entity.health_fraction),
        Some(0.5)
    );
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityHealthUpdated {
            guid: event_guid,
            health_fraction,
        } if *event_guid == guid && *health_fraction == 0.5
    )));
}

#[test]
fn test_fellowship_full_update_populates_world_state_and_emits_projection() {
    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x5000_0001);

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: state.player.guid,
        sequence: 1,
        event: GameEvent::FellowshipFullUpdate(Box::new(FellowshipFullUpdateEventData {
            fellows: vec![
                FellowshipMemberData {
                    guid: Guid(0x5000_0001),
                    cached_cp: 0,
                    cached_luminance: 0,
                    level: 12,
                    max_health: 180,
                    max_stamina: 150,
                    max_mana: 120,
                    current_health: 170,
                    current_stamina: 140,
                    current_mana: 110,
                    share_loot: 1,
                    name: "Player".to_string(),
                },
                FellowshipMemberData {
                    guid: Guid(0x5000_0032),
                    cached_cp: 0,
                    cached_luminance: 0,
                    level: 18,
                    max_health: 220,
                    max_stamina: 160,
                    max_mana: 140,
                    current_health: 215,
                    current_stamina: 150,
                    current_mana: 130,
                    share_loot: 1,
                    name: "Bravo".to_string(),
                },
            ],
            fellowship_name: "Raid Bus".to_string(),
            leader_guid: Guid(0x5000_0001),
            share_xp: true,
            even_share: false,
            open: true,
            is_locked: true,
            departed_members: Vec::new(),
            fellowship_locks: Vec::new(),
        })),
    }));

    let events = state.handle_message(&msg);

    assert!(matches!(
        state.fellowship.as_ref(),
        Some(fellowship)
            if fellowship.name == "Raid Bus"
                && fellowship.members.len() == 2
                && fellowship.leader_guid == Guid(0x5000_0001)
    ));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::FellowshipStateUpdated(Some(fellowship))
            if fellowship.name == "Raid Bus" && fellowship.members.len() == 2
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::FellowshipActivity(crate::FellowshipActivity::YouJoined { fellowship_name })
            if fellowship_name == "Raid Bus"
    )));
}

#[test]
fn test_fellowship_update_fellow_creates_placeholder_state_when_snapshot_missing() {
    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x5000_0001);

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 1,
        event: GameEvent::FellowshipUpdateFellow(Box::new(FellowshipUpdateFellowEventData {
            fellow: FellowshipMemberData {
                guid: Guid(0x5000_0001),
                cached_cp: 0,
                cached_luminance: 0,
                level: 12,
                max_health: 180,
                max_stamina: 150,
                max_mana: 120,
                current_health: 170,
                current_stamina: 140,
                current_mana: 110,
                share_loot: 1,
                name: "Player".to_string(),
            },
            update_type: FellowUpdateType::Vitals,
        })),
    }));

    let events = state.handle_message(&msg);

    assert!(matches!(
        state.fellowship.as_ref(),
        Some(fellowship)
            if fellowship.name.is_empty()
                && fellowship.members.len() == 1
                && fellowship.members[0].name == "Player"
    ));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::FellowshipStateUpdated(Some(fellowship))
            if fellowship.members.len() == 1 && fellowship.members[0].name == "Player"
    )));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::FellowshipActivity(crate::FellowshipActivity::YouJoined { .. })
    )));
}

#[test]
fn test_fellowship_quit_for_local_player_clears_state() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0001);
    state.player.guid = player_guid;
    state.fellowship = Some(FellowshipState {
        name: "Raid Bus".to_string(),
        leader_guid: player_guid,
        share_xp: true,
        even_share: false,
        open: true,
        is_locked: false,
        members: vec![FellowshipMemberState {
            guid: player_guid,
            name: "Player".to_string(),
            level: 12,
            cached_cp: 0,
            cached_luminance: 0,
            max_health: 180,
            max_stamina: 150,
            max_mana: 120,
            current_health: 170,
            current_stamina: 140,
            current_mana: 110,
            share_loot: true,
        }],
        departed_members: Vec::new(),
        locks: Vec::new(),
    });

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 1,
        event: GameEvent::FellowshipQuit(Box::new(FellowshipQuitEventData { player_guid })),
    }));

    let events = state.handle_message(&msg);

    assert!(state.fellowship.is_none());
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::FellowshipActivity(crate::FellowshipActivity::YouLeft)
    )));
    assert!(
        events
            .iter()
            .any(|event| matches!(event, WorldEvent::FellowshipStateUpdated(None)))
    );
}

#[test]
fn test_fellowship_quit_for_leader_reassigns_remaining_leader() {
    let mut state = WorldState::synthetic();
    let leader_guid = Guid(0x5000_0001);
    let member_guid = Guid(0x5000_0002);

    state.player.guid = Guid(0x5000_00FF);
    state.fellowship = Some(FellowshipState {
        name: "Raid Bus".to_string(),
        leader_guid,
        share_xp: true,
        even_share: false,
        open: true,
        is_locked: false,
        members: vec![
            FellowshipMemberState {
                guid: leader_guid,
                name: "Leader".to_string(),
                level: 12,
                cached_cp: 0,
                cached_luminance: 0,
                max_health: 180,
                max_stamina: 150,
                max_mana: 120,
                current_health: 170,
                current_stamina: 140,
                current_mana: 110,
                share_loot: true,
            },
            FellowshipMemberState {
                guid: member_guid,
                name: "Bravo".to_string(),
                level: 18,
                cached_cp: 0,
                cached_luminance: 0,
                max_health: 220,
                max_stamina: 160,
                max_mana: 140,
                current_health: 215,
                current_stamina: 150,
                current_mana: 130,
                share_loot: true,
            },
        ],
        departed_members: Vec::new(),
        locks: Vec::new(),
    });

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 1,
        event: GameEvent::FellowshipQuit(Box::new(FellowshipQuitEventData {
            player_guid: leader_guid,
        })),
    }));

    let events = state.handle_message(&msg);

    let fellowship = state.fellowship.as_ref().expect("fellowship should remain");
    assert_eq!(fellowship.members.len(), 1);
    assert_eq!(fellowship.members[0].guid, member_guid);
    assert_eq!(fellowship.leader_guid, member_guid);
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::FellowshipStateUpdated(Some(fellowship))
            if fellowship.leader_guid == member_guid && fellowship.members.len() == 1
    )));
}

#[test]
fn test_fellowship_update_fellow_for_new_remote_member_emits_join_activity() {
    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x5000_0001);
    state.fellowship = Some(FellowshipState {
        name: "Raid Bus".to_string(),
        leader_guid: Guid(0x5000_0001),
        share_xp: true,
        even_share: false,
        open: true,
        is_locked: false,
        members: vec![FellowshipMemberState {
            guid: Guid(0x5000_0001),
            name: "Player".to_string(),
            level: 12,
            cached_cp: 0,
            cached_luminance: 0,
            max_health: 180,
            max_stamina: 150,
            max_mana: 120,
            current_health: 170,
            current_stamina: 140,
            current_mana: 110,
            share_loot: true,
        }],
        departed_members: Vec::new(),
        locks: Vec::new(),
    });

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 1,
        event: GameEvent::FellowshipUpdateFellow(Box::new(FellowshipUpdateFellowEventData {
            fellow: FellowshipMemberData {
                guid: Guid(0x5000_0032),
                cached_cp: 0,
                cached_luminance: 0,
                level: 18,
                max_health: 220,
                max_stamina: 160,
                max_mana: 140,
                current_health: 215,
                current_stamina: 150,
                current_mana: 130,
                share_loot: 1,
                name: "Bravo".to_string(),
            },
            update_type: FellowUpdateType::Full,
        })),
    }));

    let events = state.handle_message(&msg);

    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::FellowshipActivity(crate::FellowshipActivity::MemberJoined { member_name })
            if member_name == "Bravo"
    )));
}

#[test]
fn test_private_update_position_non_location_is_stored_without_moving_player() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    state.player.guid = player_guid;

    let live_position = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(5.0, 5.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    state.seed_local_player_entity(player_guid, "Player", live_position);

    let saved_position = WorldPosition {
        landblock_id: Guid(0x56780000),
        coords: Vector3::new(42.0, 24.0, 9.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    let events = state.handle_message(&GameMessage::PrivateUpdatePosition(Box::new(
        PrivateUpdatePositionData {
            sequence: 1,
            position_type: PositionType::LastOutsideDeath,
            pos: saved_position,
        },
    )));

    assert!(events.is_empty());
    assert_eq!(state.player_position(), Some(live_position));
    assert_eq!(
        state.entities.get(player_guid).unwrap().position,
        live_position
    );
    assert_eq!(
        state
            .player
            .local_position_overlay(PositionType::LastOutsideDeath),
        Some(saved_position)
    );
}

#[test]
fn test_public_update_position_non_location_for_player_is_stored_without_moving_player() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    state.player.guid = player_guid;

    let live_position = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    state.seed_local_player_entity(player_guid, "Player", live_position);

    let sanctuary_position = WorldPosition {
        landblock_id: Guid(0x9ABC0000),
        coords: Vector3::new(11.0, 12.0, 13.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    let events = state.handle_message(&GameMessage::PublicUpdatePosition(Box::new(
        PublicUpdatePositionData {
            sequence: 2,
            guid: player_guid,
            position_type: PositionType::Sanctuary,
            pos: sanctuary_position,
        },
    )));

    assert!(events.is_empty());
    assert_eq!(state.player_position(), Some(live_position));
    assert_eq!(
        state.entities.get(player_guid).unwrap().position,
        live_position
    );
    assert_eq!(
        state.player.local_position_overlay(PositionType::Sanctuary),
        Some(sanctuary_position)
    );
}

#[test]
fn test_public_update_position_non_location_for_other_entity_does_not_move_it() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    let other_guid = Guid(0x50000999);
    state.player.guid = player_guid;

    state.entities.insert(Entity::new(
        player_guid,
        "Player".to_string(),
        WorldPosition::default(),
    ));

    let live_position = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(3.0, 4.0, 5.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    state
        .entities
        .insert(Entity::new(other_guid, "Other".to_string(), live_position));

    let non_live_position = WorldPosition {
        landblock_id: Guid(0x56780000),
        coords: Vector3::new(30.0, 40.0, 50.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    let events = state.handle_message(&GameMessage::PublicUpdatePosition(Box::new(
        PublicUpdatePositionData {
            sequence: 3,
            guid: other_guid,
            position_type: PositionType::LinkedPortalOne,
            pos: non_live_position,
        },
    )));

    assert!(events.is_empty());
    assert_eq!(
        state.entities.get(other_guid).unwrap().position,
        live_position
    );
    assert_eq!(
        state
            .player
            .local_position_overlay(PositionType::LinkedPortalOne),
        None
    );
}

#[test]
fn test_inventory_put_obj_in_container() {
    let mut state = WorldState::synthetic();
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

    // Check for WorldEvent::PropertiesUpdated
    assert!(events.iter().any(|e| {
        if let WorldEvent::PropertiesUpdated { guid, updates } = e {
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
    let mut state = WorldState::synthetic();
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
        if let WorldEvent::PropertiesUpdated { guid, updates } = e {
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
fn test_inventory_put_obj_in_container_emits_entity_moved_when_item_leaves_world() {
    let mut state = WorldState::synthetic();
    let container_guid = Guid(0x2);
    let item_guid = Guid(0x3);

    let mut item = Entity::new(
        item_guid,
        "Item".to_string(),
        WorldPosition {
            landblock_id: Guid(0x1234),
            ..WorldPosition::default()
        },
    );
    item.set_wielder_id(Some(Guid(0x9)));
    state.entities.insert(item);

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
    assert_eq!(entity.position.landblock_id, Guid::NULL);
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMoved {
            guid,
            pos,
        } if *guid == item_guid && pos.landblock_id == Guid::NULL
    )));
}

#[test]
fn test_wield_object() {
    let mut state = WorldState::synthetic();
    let obj_guid = Guid(0x1);
    let wielder_guid = Guid(0x50000001);

    state.entities.insert(Entity::new(
        obj_guid,
        "Weapon".to_string(),
        WorldPosition {
            landblock_id: Guid(0x1234),
            ..WorldPosition::default()
        },
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
        if let WorldEvent::PropertiesUpdated { guid, updates } = e {
            *guid == obj_guid
                && updates.iter().any(|u| {
                    matches!(u, PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, val) if *val == wielder_guid)
                })
        } else {
            false
        }
    }));
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMoved {
            guid,
            pos,
        } if *guid == obj_guid && pos.landblock_id == Guid::NULL
    )));
}

#[test]
fn test_inventory_remove_object() {
    let mut state = WorldState::synthetic();
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

    assert!(state.entities.get(obj_guid).is_some());
    assert!(
        state
            .entity_lifecycle_state(obj_guid)
            .is_some_and(|state| state.explicit_delete_requested)
    );
    assert!(
        !events
            .iter()
            .any(|e| matches!(e, WorldEvent::EntityDespawned(guid) if *guid == obj_guid))
    );
}

#[test]
fn test_player_description_initialization() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000001);
    let player_name = "TestingPlayer".to_string();
    let bootstrap_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(12.0, 34.0, 56.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let options1 =
        CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG | CharacterOptions1::HEAR_ALLEGIANCE_CHAT;
    let options2 = CharacterOptions2::SHOW_HELM | CharacterOptions2::HEAR_GENERAL_CHAT;
    let hotbar_spells = vec![vec![111, 222], vec![333]];
    let desired_comps = vec![(42, 7), (99, 12)];
    let spellbook_filters = 0xA5A5_5A5A;
    let gameplay_options = vec![0x10, 0x20, 0x30];
    let mut properties = WorldObjectProperties::default();
    properties.set_int_prop(PropertyInt::Level, 17);
    properties.set_int64_prop(PropertyInt64::AvailableExperience, 12345);

    let data = PlayerDescriptionEventData {
        guid: player_guid,
        sequence: 1,
        name: player_name.clone(),
        wee_type: 1,
        pos: Some(bootstrap_pos),
        properties,
        positions: std::collections::BTreeMap::new(),
        attributes: std::collections::BTreeMap::new(),
        skills: std::collections::BTreeMap::new(),
        enchantments: Vec::new(),
        spells: std::collections::BTreeMap::new(),
        has_health: true,
        options1,
        options2,
        shortcuts: Vec::new(),
        hotbar_spells: hotbar_spells.clone(),
        desired_comps: desired_comps.clone(),
        spellbook_filters,
        gameplay_options: gameplay_options.clone(),
        inventory: Vec::new(),
        equipped_objects: Vec::new(),
    };

    let event = GameEvent::PlayerDescription(Box::new(data));
    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: player_guid,
        sequence: 1,
        event,
    }));

    let events = state.handle_message(&msg);

    assert_eq!(state.player.guid, player_guid);
    assert_eq!(state.player_name(), player_name);
    assert_eq!(state.player_position(), Some(bootstrap_pos));
    assert_eq!(state.player.options1, options1);
    assert_eq!(state.player.options2, options2);
    assert_eq!(state.player.hotbar_spells, hotbar_spells);
    assert_eq!(state.player.desired_comps, desired_comps);
    assert_eq!(state.player.spellbook_filters, spellbook_filters);
    assert_eq!(state.player.gameplay_options, gameplay_options);
    let player_entity = state
        .entities
        .get(player_guid)
        .expect("player description should eagerly materialize the player entity");
    assert_eq!(player_entity.name(), player_name);
    assert_eq!(player_entity.position, bootstrap_pos);
    assert_eq!(player_entity.get_int_prop(PropertyInt::Level), Some(17));
    assert_eq!(
        player_entity.get_int64_prop(PropertyInt64::AvailableExperience),
        Some(12345)
    );
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::PlayerInfo(data)
            if data.entity.guid == player_guid
                && data.entity.name() == player_name
                && data.entity.position == bootstrap_pos
                && data.level_info.level == 17
    )));
    assert!(events.iter().any(
        |event| matches!(event, WorldEvent::LevelInfoUpdated(level_info) if level_info.level == 17)
    ));
    assert!(
        state
            .player
            .character_option_enabled(CharacterOption::UseCraftingChanceOfSuccessDialog,)
    );
    assert!(
        state
            .player
            .character_option_enabled(CharacterOption::ShowYourHelmOrHeadGear)
    );
    assert!(
        !state
            .player
            .character_option_enabled(CharacterOption::ListenToTradeChat)
    );
}

#[test]
fn test_parent_event_does_not_null_player_landblock() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000001);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0xDA55001C),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", initial_pos);

    let msg = GameMessage::ParentEvent(Box::new(ParentEventData {
        parent_guid: Guid(0x8000031B),
        child_guid: player_guid,
        location: 1,
        placement: 1,
        parent_instance_sequence: 0,
        child_position_sequence: 0,
    }));

    state.handle_message(&msg);

    assert_eq!(
        state
            .player_position()
            .expect("player entity should exist")
            .landblock_id,
        initial_pos.landblock_id
    );
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
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000001);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0xDA55001C),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", initial_pos);

    let msg = GameMessage::PublicUpdatePropertyInstanceId(Box::new(UpdatePropertyInstanceId {
        sequence: 0,
        guid: player_guid,
        property: PropertyInstanceId::Wielder as u32,
        value: Guid(0x8000031B),
    }));

    state.handle_message(&msg);

    assert_eq!(
        state
            .player_position()
            .expect("player entity should exist")
            .landblock_id,
        initial_pos.landblock_id
    );
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
fn test_object_create_reuses_upsert_path_and_clears_explicit_delete() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x90000001);

    state.entities.insert(Entity::new(
        guid,
        "Original".to_string(),
        WorldPosition::default(),
    ));
    state.mark_entity_explicit_delete(guid);

    let mut data = ObjectDescriptionData::with_guid(guid);
    data.public_weenie_desc.name = Some("Replacement".to_string());
    let msg = GameMessage::ObjectCreate(Box::new(data));

    let events = state.handle_message(&msg);

    assert!(
        matches!(events.first(), Some(WorldEvent::EntityReplaced(entity)) if entity.name() == "Replacement")
    );
    assert_eq!(state.entities.get(guid).unwrap().name(), "Replacement");
    assert!(state.entity_lifecycle_state(guid).is_none());
}

#[test]
fn test_self_object_create_bootstraps_player_position() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000042);

    let initial_pos = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let player_description = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: player_guid,
        sequence: 1,
        event: GameEvent::PlayerDescription(Box::new(PlayerDescriptionEventData {
            guid: player_guid,
            sequence: 1,
            name: "Player".to_string(),
            wee_type: 1,
            pos: Some(initial_pos),
            properties: WorldObjectProperties::default(),
            positions: std::collections::BTreeMap::new(),
            attributes: std::collections::BTreeMap::new(),
            skills: std::collections::BTreeMap::new(),
            enchantments: Vec::new(),
            spells: std::collections::BTreeMap::new(),
            has_health: true,
            options1: CharacterOptions1::empty(),
            options2: CharacterOptions2::empty(),
            shortcuts: Vec::new(),
            hotbar_spells: Vec::new(),
            desired_comps: Vec::new(),
            spellbook_filters: 0,
            gameplay_options: Vec::new(),
            inventory: Vec::new(),
            equipped_objects: Vec::new(),
        })),
    }));
    let _ = state.handle_message(&player_description);

    let bootstrap_pos = WorldPosition {
        landblock_id: Guid(0x12340010),
        coords: Vector3::new(11.0, 22.0, 33.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    let mut data = ObjectDescriptionData::with_guid(player_guid);
    data.public_weenie_desc.name = Some("Player".to_string());
    data.pos = Some(bootstrap_pos);
    data.movement_data = Some(spawn_invalid_motion_data(
        MotionStance::NonCombat,
        InterpretedMotionCommand::RUN_FORWARD,
        4.5,
    ));
    data.autonomous_movement = Some(true);

    let msg = GameMessage::ObjectCreate(Box::new(data));
    let events = state.handle_message(&msg);

    assert_eq!(state.player_position(), Some(bootstrap_pos));
    assert_eq!(
        state.entities.get(player_guid).unwrap().position,
        bootstrap_pos
    );
    assert_eq!(
        state.player.last_server_motion_style,
        Some(MotionStance::NonCombat)
    );
    let motion_snapshot = state
        .entities
        .get(player_guid)
        .unwrap()
        .motion_snapshot
        .expect("self object create should hydrate motion snapshot from spawn movement data");
    assert_eq!(motion_snapshot.current_style, Some(MotionStance::NonCombat));
    assert_eq!(
        motion_snapshot.forward_command,
        Some(InterpretedMotionCommand::RUN_FORWARD)
    );
    assert_eq!(
        motion_snapshot.forward_speed.map(|speed| speed.to_f32()),
        Some(4.5)
    );
    assert!(state.entity_lifecycle_state(player_guid).is_none());
    assert!(!events.is_empty());
}

fn spawn_invalid_motion_data(
    style: MotionStance,
    forward_command: InterpretedMotionCommand,
    forward_speed: f32,
) -> Vec<u8> {
    let mut data = Vec::new();
    (MovementType::Invalid as u8).pack(&mut data);
    0u8.pack(&mut data);
    style.interpreted().pack(&mut data);
    InterpretedMotionState {
        flags: MovementStateFlags::CURRENT_STYLE
            | MovementStateFlags::FORWARD_COMMAND
            | MovementStateFlags::FORWARD_SPEED,
        num_commands: 0,
        current_style: Some(style.interpreted()),
        forward_command: Some(forward_command),
        sidestep_command: None,
        turn_command: None,
        forward_speed: Some(forward_speed),
        sidestep_speed: None,
        turn_speed: None,
        commands: Vec::new(),
    }
    .pack(&mut data);
    data
}

#[test]
fn test_object_delete_marks_explicit_delete_without_inline_despawn() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x90000002);

    state.entities.insert(Entity::new(
        guid,
        "DeleteMe".to_string(),
        WorldPosition::default(),
    ));

    let msg = GameMessage::ObjectDelete(Box::new(ObjectDeleteData { guid }));

    let events = state.handle_message(&msg);

    assert!(state.entities.get(guid).is_some());
    assert!(
        state
            .entity_lifecycle_state(guid)
            .is_some_and(|state| state.explicit_delete_requested)
    );
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, WorldEvent::EntityDespawned(target) if *target == guid))
    );
}

#[test]
fn test_container_iid_update_tracks_player_inventory_and_clears_deadline() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000001);
    let guid = Guid(0x90000003);

    state.player.guid = player_guid;
    state.entities.insert(Entity::new(
        player_guid,
        "Player".to_string(),
        WorldPosition::default(),
    ));

    let mut item = Entity::new(guid, "Item".to_string(), WorldPosition::default());
    item.position.landblock_id = Guid::NULL;
    state.entities.insert(item);
    state.set_entity_prune_deadline(guid, state.current_server_time() - 1.0);

    let msg = GameMessage::PublicUpdatePropertyInstanceId(Box::new(UpdatePropertyInstanceId {
        sequence: 0,
        guid,
        property: PropertyInstanceId::Container as u32,
        value: player_guid,
    }));

    let _ = state.handle_message(&msg);

    assert!(state.player.inventory.contains(&guid));
    assert!(state.entity_lifecycle_state(guid).is_none());
    assert_eq!(
        state.entities.get(guid).unwrap().position.landblock_id,
        Guid::NULL
    );
}

#[test]
fn test_pickup_event_marks_unretained_entity_for_sweep() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x90000004);

    state.entities.insert(Entity::new(
        guid,
        "GroundLoot".to_string(),
        WorldPosition {
            landblock_id: Guid(0x1234),
            ..WorldPosition::default()
        },
    ));

    let msg = GameMessage::PickupEvent(Box::new(PickupEventData {
        guid,
        success: true,
    }));

    let events = state.handle_message(&msg);

    assert!(state.entities.get(guid).is_some());
    assert_eq!(
        state.entities.get(guid).unwrap().position.landblock_id,
        Guid::NULL
    );
    assert!(
        state
            .entity_lifecycle_state(guid)
            .is_some_and(|state| state.explicit_delete_requested)
    );
    assert!(events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityMoved {
            guid: event_guid,
            pos,
        } if *event_guid == guid && pos.landblock_id == Guid::NULL
    )));
}

#[test]
fn test_explicit_delete_hides_entity_from_filtered_access() {
    let mut state = WorldState::synthetic();
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
    let mut state = WorldState::synthetic();
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
    let mut state = WorldState::synthetic();
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
    let mut state = WorldState::synthetic();
    let guid = Guid(0x4321);
    let mut events = Vec::new();

    let original = Entity::new(guid, "Original".to_string(), WorldPosition::default());
    state.upsert_entity_from_create(original, &mut events);
    assert!(matches!(events.first(), Some(WorldEvent::EntitySpawned(_))));

    state.mark_entity_explicit_delete(guid);
    events.clear();

    let replacement = Entity::new(guid, "Replacement".to_string(), WorldPosition::default());
    let outcome = state.upsert_entity_from_create(replacement, &mut events);

    assert!(matches!(outcome, EntityUpsertKind::Replaced));
    assert!(matches!(
        events.first(),
        Some(WorldEvent::EntityReplaced(_))
    ));
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, WorldEvent::EntitySpawned(entity) if entity.guid == guid))
    );
    assert!(state.entity_lifecycle_state(guid).is_none());
    assert_eq!(state.entities.get(guid).unwrap().name(), "Replacement");
}

#[test]
fn test_add_entity_seeds_remote_body_sidecar() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x6200_0001);
    let position = WorldPosition {
        landblock_id: Guid(0x0101_FFFF),
        coords: Vector3::new(3.0, 4.0, 5.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let mut entity = Entity::new(guid, "Remote".to_string(), position);
    entity.velocity = Vector3::new(1.0, 2.0, 0.0);
    entity.omega = Vector3::new(0.0, 0.0, 0.5);

    state.add_entity(entity);

    let body = state
        .scene
        .body(SpatialBodyId::Entity(guid))
        .expect("remote entity body should be seeded");
    assert_eq!(body.authoritative_pose, Some(position));
    assert_eq!(body.pose, position);
    assert_eq!(body.velocity, Vector3::new(1.0, 2.0, 0.0));
    assert_eq!(body.omega, Vector3::new(0.0, 0.0, 0.5));
    assert_eq!(body.sampling.mode, SpatialSampleMode::AuthoritativeOnly);
}

#[test]
fn test_player_authoritative_updates_seed_local_player_body() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x5000_0100);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0x1111_FFFF),
        coords: Vector3::new(1.0, 1.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", initial_pos);

    let moved = WorldPosition {
        landblock_id: Guid(0x2222_FFFF),
        coords: Vector3::new(9.0, 8.0, 7.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.set_player_position(moved);
    state.set_player_vector(Vector3::new(4.0, 5.0, 0.0), Vector3::new(0.0, 0.0, 2.0));

    let body = state
        .scene
        .body(SpatialBodyId::LocalPlayer(player_guid))
        .expect("local player body should be reconciled from authoritative entity state");
    assert_eq!(body.authoritative_pose, Some(moved));
    assert_eq!(body.pose, moved);
    assert_eq!(body.velocity, Vector3::new(4.0, 5.0, 0.0));
    assert_eq!(body.omega, Vector3::new(0.0, 0.0, 2.0));
    assert_eq!(body.sampling.mode, SpatialSampleMode::AuthoritativeOnly);
}

#[test]
fn test_remote_position_reset_suspends_body_sampling() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x6200_0002);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0x0100_0000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let mut entity = Entity::new(guid, "Target".to_string(), initial_pos);
    entity.sequences[4] = 30;
    entity.sequences[6] = 40;
    state.add_entity(entity);

    let accepted = state.apply_entity_position_pack(
        guid,
        &PositionPack {
            pos: WorldPosition {
                landblock_id: Guid(0x0200_0000),
                coords: Vector3::new(10.0, 20.0, 30.0),
                rotation: holtburger_common::math::Quaternion::identity(),
            },
            instance_sequence: 2,
            position_sequence: 3,
            teleport_sequence: 30,
            force_position_sequence: 41,
            ..PositionPack::default()
        },
        &mut Vec::new(),
    );

    assert!(accepted);
    let body = state
        .scene
        .body(SpatialBodyId::Entity(guid))
        .expect("remote body should remain present after correction");
    assert_eq!(body.pose.coords, Vector3::new(10.0, 20.0, 30.0));
    assert_eq!(
        body.authoritative_pose.map(|pose| pose.coords),
        Some(Vector3::new(10.0, 20.0, 30.0))
    );
    assert_eq!(body.sampling.mode, SpatialSampleMode::Suspended);
}

#[test]
fn test_remote_position_pack_updates_and_clears_linear_velocity() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x6200_0005);
    let initial_pos = WorldPosition {
        landblock_id: Guid(0x0100_0000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let mut entity = Entity::new(guid, "Target".to_string(), initial_pos);
    entity.velocity = Vector3::new(0.0, 0.0, 20.046_688);
    state.add_entity(entity);

    let mut falling_events = Vec::new();
    let applied = state.apply_entity_position_pack(
        guid,
        &PositionPack {
            pos: WorldPosition {
                landblock_id: Guid(0x0100_0000),
                coords: Vector3::new(9.745_981, -58.954_994, 0.004_999_995),
                rotation: holtburger_common::math::Quaternion::identity(),
            },
            velocity: Some(Vector3::new(-1.327_315_8, 5.460_433_5, -18.468_733)),
            instance_sequence: 88,
            position_sequence: 285,
            teleport_sequence: 0,
            force_position_sequence: 0,
            flags: UpdatePositionFlag::HAS_VELOCITY,
            ..PositionPack::default()
        },
        &mut falling_events,
    );

    assert!(applied);
    assert_eq!(
        state
            .entities
            .get(guid)
            .expect("entity should exist")
            .velocity,
        Vector3::new(-1.327_315_8, 5.460_433_5, -18.468_733)
    );
    assert!(falling_events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityVectorUpdated {
            guid: event_guid,
            velocity,
            ..
        } if *event_guid == guid
            && *velocity == Vector3::new(-1.327_315_8, 5.460_433_5, -18.468_733)
    )));

    let mut grounded_events = Vec::new();
    let applied = state.apply_entity_position_pack(
        guid,
        &PositionPack {
            pos: WorldPosition {
                landblock_id: Guid(0x0100_0000),
                coords: Vector3::new(9.745_981, -58.954_994, 0.004_999_995),
                rotation: holtburger_common::math::Quaternion::identity(),
            },
            instance_sequence: 88,
            position_sequence: 286,
            teleport_sequence: 0,
            force_position_sequence: 0,
            flags: UpdatePositionFlag::IS_GROUNDED,
            ..PositionPack::default()
        },
        &mut grounded_events,
    );

    assert!(applied);
    assert_eq!(
        state
            .entities
            .get(guid)
            .expect("entity should exist")
            .velocity,
        Vector3::zero()
    );
    let body = state
        .scene
        .body(SpatialBodyId::Entity(guid))
        .expect("remote body should remain present after grounded snap");
    assert_eq!(body.velocity, Vector3::zero());
    assert!(grounded_events.iter().any(|event| matches!(
        event,
        WorldEvent::EntityVectorUpdated {
            guid: event_guid,
            velocity,
            ..
        } if *event_guid == guid && *velocity == Vector3::zero()
    )));
}

#[test]
fn test_remove_entity_retires_body_sidecar() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x6200_0003);
    state.add_entity(Entity::new(
        guid,
        "Disposable".to_string(),
        WorldPosition {
            landblock_id: Guid(0x0303_FFFF),
            ..Default::default()
        },
    ));

    let removed = state.remove_entity(guid);

    assert!(removed.is_some());
    assert!(state.scene.body(SpatialBodyId::Entity(guid)).is_none());
}

#[test]
fn test_clear_world_presence_retires_body_sidecar() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x6200_0004);
    state.add_entity(Entity::new(
        guid,
        "Contained".to_string(),
        WorldPosition {
            landblock_id: Guid(0x0404_FFFF),
            ..Default::default()
        },
    ));

    let cleared = state.clear_entity_world_presence(guid);

    assert!(cleared.is_some());
    assert!(state.scene.body(SpatialBodyId::Entity(guid)).is_none());
}

#[test]
fn test_tick_sweeps_explicit_delete_without_movement() {
    let mut state = WorldState::synthetic();
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

    let events = state.tick();

    assert!(state.entities.get(target_guid).is_none());
    assert!(
        events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == target_guid)
        )
    );
}

#[test]
fn test_tick_sweeps_expired_deadline_without_movement() {
    let mut state = WorldState::synthetic();
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

    let events = state.tick();

    assert!(state.entities.get(target_guid).is_none());
    assert!(
        events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == target_guid)
        )
    );
}

#[test]
fn apply_set_state_updates_local_player_instance_sequence_and_entity_physics_state() {
    let mut state = WorldState::synthetic();
    state.player.guid = Guid(0x5000_0001);
    state.player.instance_sequence = 0;
    state.seed_local_player_entity(state.player.guid, "Player", WorldPosition::default());
    let mut events = Vec::new();

    let handled = state.apply_set_state_update(
        &SetStateData {
            guid: state.player.guid,
            physics_state: PhysicsState::REPORT_COLLISIONS | PhysicsState::IGNORE_COLLISIONS,
            instance_sequence: 1649,
            state_sequence: 1,
        },
        &mut events,
    );

    assert!(handled);
    assert_eq!(state.player.instance_sequence, 1649);
    let player_entity = state
        .player_entity()
        .expect("local player entity should exist");
    assert_eq!(
        player_entity.physics_state,
        PhysicsState::REPORT_COLLISIONS | PhysicsState::IGNORE_COLLISIONS
    );
    assert_eq!(
        player_entity
            .properties
            .get_int_prop(PropertyInt::PhysicsState),
        Some((PhysicsState::REPORT_COLLISIONS | PhysicsState::IGNORE_COLLISIONS).bits() as i32)
    );
    assert!(
        player_entity
            .properties
            .get_bool_prop(PropertyBool::IgnoreCollisions)
    );
    assert!(matches!(
        events.as_slice(),
        [WorldEvent::EntityStateUpdated {
            guid,
            physics_state,
        }] if *guid == state.player.guid
            && *physics_state
                == (PhysicsState::REPORT_COLLISIONS | PhysicsState::IGNORE_COLLISIONS)
    ));
}

#[test]
fn test_tick_does_not_sweep_unexpired_deadline() {
    let mut state = WorldState::synthetic();
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

    let events = state.tick();

    assert!(state.entities.get(target_guid).is_some());
    assert!(events.is_empty());
}

#[test]
fn test_tick_runs_sweep_without_player_guid() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x70000123);

    state.entities.insert(Entity::new(
        guid,
        "Orphan".to_string(),
        WorldPosition::default(),
    ));
    state.mark_entity_explicit_delete(guid);

    let events = state.tick();

    assert!(state.entities.get(guid).is_none());
    assert!(
        events
            .iter()
            .any(|event| matches!(event, WorldEvent::EntityDespawned(target) if *target == guid))
    );
}

#[test]
fn test_stationary_tick_starts_visibility_prune_deadline() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000130);
    let player_pos = WorldPosition {
        landblock_id: Guid(0x0A0AFFFF),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let far_pos = WorldPosition {
        landblock_id: Guid(0x2020FFFF),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });
    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", player_pos);

    let target_guid = Guid(0x60000130);
    state.add_entity(Entity::new(target_guid, "Distant".to_string(), far_pos));

    let events = state.tick();
    let deadline = state
        .entity_lifecycle_state(target_guid)
        .and_then(|lifecycle| lifecycle.prune_deadline)
        .expect("expected a destruction deadline to be assigned");

    assert!(events.is_empty());
    assert!(deadline >= 125.0);
    assert!(state.entities.get(target_guid).is_some());
}

#[test]
fn test_visibility_timeout_sweeps_world_entity_after_25_seconds() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000131);
    let player_pos = WorldPosition {
        landblock_id: Guid(0x0A0AFFFF),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let far_pos = WorldPosition {
        landblock_id: Guid(0x2020FFFF),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });
    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", player_pos);

    let target_guid = Guid(0x60000131);
    state.add_entity(Entity::new(target_guid, "Distant".to_string(), far_pos));

    let _ = state.tick();
    let deadline = state
        .entity_lifecycle_state(target_guid)
        .and_then(|lifecycle| lifecycle.prune_deadline)
        .expect("expected a destruction deadline to be assigned");

    state.server_time = Some(ServerTimeSync {
        server_time: deadline + 1.0,
        local_time: Instant::now(),
    });

    let events = state.tick();

    assert!(state.entities.get(target_guid).is_none());
    assert!(
        events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == target_guid)
        )
    );
}

#[test]
fn test_reentry_before_timeout_clears_visibility_prune_deadline() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000132);
    let player_pos = WorldPosition {
        landblock_id: Guid(0x0A0AFFFF),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let far_pos = WorldPosition {
        landblock_id: Guid(0x2020FFFF),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });
    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", player_pos);

    let target_guid = Guid(0x60000132);
    state.add_entity(Entity::new(target_guid, "Traveler".to_string(), far_pos));

    let _ = state.tick();
    assert!(
        state
            .entity_lifecycle_state(target_guid)
            .and_then(|lifecycle| lifecycle.prune_deadline)
            .is_some()
    );

    state.server_time = Some(ServerTimeSync {
        server_time: 110.0,
        local_time: Instant::now(),
    });

    let mut events = Vec::new();
    let _ = state.apply_public_position_update(
        target_guid,
        PositionType::Location,
        player_pos,
        &mut events,
    );
    let tick_events = state.tick();

    assert!(state.entities.get(target_guid).is_some());
    assert!(state.entity_lifecycle_state(target_guid).is_none());
    assert!(
        !tick_events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == target_guid)
        )
    );
}

#[test]
fn test_indoor_player_keeps_nearby_outdoor_entity_visible_under_conservative_heuristic() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000132);
    let player_pos = WorldPosition {
        landblock_id: Guid(0x0A0A0100),
        coords: Vector3::new(96.0, 96.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let nearby_outdoor_pos = WorldPosition {
        landblock_id: Guid(0x0A0AFFFF),
        coords: Vector3::new(100.0, 100.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });
    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", player_pos);

    let target_guid = Guid(0x60000136);
    state.add_entity(Entity::new(
        target_guid,
        "SeenOutside-ish".to_string(),
        nearby_outdoor_pos,
    ));

    let events = state.tick();

    assert!(events.is_empty());
    assert!(state.entities.get(target_guid).is_some());
    assert!(
        state
            .entity_lifecycle_state(target_guid)
            .is_none_or(|lifecycle| lifecycle.prune_deadline.is_none())
    );
}

#[test]
fn test_nearby_entities_omit_explicit_delete_and_null_landblock() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000133);
    let player_pos = WorldPosition {
        landblock_id: Guid(0x0A0AFFFF),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };

    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", player_pos);

    let visible_guid = Guid(0x60000133);
    state.add_entity(Entity::new(visible_guid, "Visible".to_string(), player_pos));

    let deleted_guid = Guid(0x60000134);
    state.add_entity(Entity::new(deleted_guid, "Deleted".to_string(), player_pos));
    state.mark_entity_explicit_delete(deleted_guid);

    let null_guid = Guid(0x60000135);
    let mut null_entity = Entity::new(null_guid, "NullLandblock".to_string(), player_pos);
    null_entity.position.landblock_id = Guid::NULL;
    state.add_entity(null_entity);

    let nearby: std::collections::HashSet<_> = state
        .get_nearby_world_entities()
        .into_iter()
        .map(|entity| entity.guid)
        .collect();

    assert!(nearby.contains(&visible_guid));
    assert!(!nearby.contains(&deleted_guid));
    assert!(!nearby.contains(&null_guid));
}

#[test]
fn test_add_to_trade_marks_preview_only_for_non_authoritative_entities() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000140);
    let preview_guid = Guid(0x60000140);
    let owned_guid = Guid(0x60000141);

    state.player.guid = player_guid;
    state.register_trade(player_guid, Guid(0x5000BEEF), &mut Vec::new());

    let mut preview_entity = Entity::new(
        preview_guid,
        "Preview".to_string(),
        WorldPosition::default(),
    );
    preview_entity.position.landblock_id = Guid::NULL;
    state.entities.insert(preview_entity);

    state.entities.insert(Entity::new(
        owned_guid,
        "Owned".to_string(),
        WorldPosition::default(),
    ));
    state.player.add_to_inventory(owned_guid);

    state.add_trade_item(0x02, preview_guid, &mut Vec::new());
    state.add_trade_item(0x01, owned_guid, &mut Vec::new());

    assert!(
        state
            .entity_lifecycle_state(preview_guid)
            .is_some_and(|state| state.trade_preview)
    );
    assert!(
        !state
            .entity_lifecycle_state(owned_guid)
            .is_some_and(|state| state.trade_preview)
    );
}

#[test]
fn test_reset_trade_sweeps_preview_only_entities() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000141);
    let preview_guid = Guid(0x60000142);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });

    state.player.guid = player_guid;
    state.register_trade(player_guid, Guid(0x5000BEEF), &mut Vec::new());

    let mut preview_entity = Entity::new(
        preview_guid,
        "Preview".to_string(),
        WorldPosition::default(),
    );
    preview_entity.position.landblock_id = Guid::NULL;
    state.entities.insert(preview_entity);
    state.mark_trade_preview(preview_guid);

    if let Some(trade) = state.trade.as_mut() {
        trade.partner_side.items.push(preview_guid);
    }

    let mut events = Vec::new();
    state.reset_trade(&mut events);

    let deadline = state
        .entity_lifecycle_state(preview_guid)
        .and_then(|state| state.prune_deadline)
        .expect("expected immediate prune eligibility after trade reset");

    assert!(state.entities.get(preview_guid).is_some());
    assert!(
        !events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == preview_guid)
        )
    );
    assert!(
        state
            .trade
            .as_ref()
            .is_some_and(|trade| trade.partner_side.items.is_empty())
    );

    state.server_time = Some(ServerTimeSync {
        server_time: deadline + 1.0,
        local_time: Instant::now(),
    });

    let tick_events = state.tick();
    assert!(state.entities.get(preview_guid).is_none());
    assert!(
        tick_events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == preview_guid)
        )
    );
}

#[test]
fn test_clear_trade_acceptance_does_not_sweep_preview_entities() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000142);
    let preview_guid = Guid(0x60000143);

    state.player.guid = player_guid;
    state.register_trade(player_guid, Guid(0x5000BEEF), &mut Vec::new());

    let mut preview_entity = Entity::new(
        preview_guid,
        "Preview".to_string(),
        WorldPosition::default(),
    );
    preview_entity.position.landblock_id = Guid::NULL;
    state.entities.insert(preview_entity);
    state.mark_trade_preview(preview_guid);

    if let Some(trade) = state.trade.as_mut() {
        trade.self_side.items.push(preview_guid);
        trade.self_side.accepted = true;
        trade.partner_side.accepted = true;
    }

    let mut events = Vec::new();
    state.clear_trade_acceptance(&mut events);

    assert!(state.entities.get(preview_guid).is_some());
    assert!(
        state
            .entity_lifecycle_state(preview_guid)
            .is_some_and(|state| state.trade_preview)
    );
    assert!(
        state
            .trade
            .as_ref()
            .is_some_and(|trade| trade.self_side.items == vec![preview_guid])
    );
    assert!(
        events
            .iter()
            .any(|event| matches!(event, WorldEvent::TradeStateUpdated(Some(_))))
    );
}

#[test]
fn test_close_trade_sweeps_preview_only_entities() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000152);
    let preview_guid = Guid(0x60000152);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });

    state.player.guid = player_guid;
    state.register_trade(player_guid, Guid(0x5000BEEF), &mut Vec::new());

    let mut preview_entity = Entity::new(
        preview_guid,
        "Preview".to_string(),
        WorldPosition::default(),
    );
    preview_entity.position.landblock_id = Guid::NULL;
    state.entities.insert(preview_entity);
    state.mark_trade_preview(preview_guid);

    if let Some(trade) = state.trade.as_mut() {
        trade.partner_side.items.push(preview_guid);
    }

    let mut events = Vec::new();
    state.close_trade(&mut events);

    let deadline = state
        .entity_lifecycle_state(preview_guid)
        .and_then(|state| state.prune_deadline)
        .expect("expected preview-only trade entity to become sweep-eligible");

    assert!(state.trade.is_none());
    assert!(state.entities.get(preview_guid).is_some());
    assert!(
        events
            .iter()
            .any(|event| matches!(event, WorldEvent::TradeStateUpdated(None)))
    );
    assert!(
        !events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == preview_guid)
        )
    );

    state.server_time = Some(ServerTimeSync {
        server_time: deadline + 1.0,
        local_time: Instant::now(),
    });

    let tick_events = state.tick();
    assert!(state.entities.get(preview_guid).is_none());
    assert!(
        tick_events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == preview_guid)
        )
    );
}

#[test]
fn test_trade_complete_preserves_real_owned_entity_while_pruning_preview_only_entity() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000143);
    let preview_guid = Guid(0x60000144);
    let owned_guid = Guid(0x60000145);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });

    state.player.guid = player_guid;
    state.register_trade(player_guid, Guid(0x5000BEEF), &mut Vec::new());

    let mut preview_entity = Entity::new(
        preview_guid,
        "Preview".to_string(),
        WorldPosition::default(),
    );
    preview_entity.position.landblock_id = Guid::NULL;
    state.entities.insert(preview_entity);
    state.mark_trade_preview(preview_guid);

    let mut owned_entity = Entity::new(owned_guid, "Owned".to_string(), WorldPosition::default());
    owned_entity.position.landblock_id = Guid::NULL;
    state.entities.insert(owned_entity);
    state.mark_trade_preview(owned_guid);
    state.player.add_to_inventory(owned_guid);

    if let Some(trade) = state.trade.as_mut() {
        trade.self_side.items.push(owned_guid);
        trade.partner_side.items.push(preview_guid);
        trade.self_side.accepted = true;
        trade.partner_side.accepted = true;
    }

    let mut events = Vec::new();
    state.handle_trade_complete(&mut events);

    let deadline = state
        .entity_lifecycle_state(preview_guid)
        .and_then(|state| state.prune_deadline)
        .expect("expected preview-only trade entity to become sweep-eligible");

    assert!(state.entities.get(preview_guid).is_some());
    assert!(state.entities.get(owned_guid).is_some());
    assert!(
        !state
            .entity_lifecycle_state(owned_guid)
            .is_some_and(|state| state.trade_preview)
    );
    assert!(
        !events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == preview_guid)
        )
    );

    state.server_time = Some(ServerTimeSync {
        server_time: deadline + 1.0,
        local_time: Instant::now(),
    });

    let tick_events = state.tick();
    assert!(state.entities.get(preview_guid).is_none());
    assert!(
        tick_events.iter().any(
            |event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == preview_guid)
        )
    );
}

#[test]
fn test_view_contents_ignores_unknown_guid_without_synthesizing_entity() {
    let mut state = WorldState::synthetic();
    let container_guid = Guid(0x70000150);
    let item_guid = Guid(0x60000150);

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 0,
        event: GameEvent::ViewContents(Box::new(ViewContentsEventData {
            container: container_guid,
            items: vec![ViewContentsEventItem {
                guid: item_guid,
                container_type: 0,
            }],
        })),
    }));

    let events = state.handle_message(&msg);

    assert!(state.open_containers.contains(&container_guid));
    assert!(state.entities.get(item_guid).is_none());
    assert!(state.entity_lifecycle_state(item_guid).is_none());
    assert!(events.iter().any(
        |event| matches!(event, WorldEvent::ContainerOpened(guid) if *guid == container_guid)
    ));
    assert!(!events.iter().any(
        |event| matches!(event, WorldEvent::EntitySpawned(entity) if entity.guid == item_guid)
    ));
}

#[test]
fn test_view_contents_marks_existing_entity_as_container_preview() {
    let mut state = WorldState::synthetic();
    let container_guid = Guid(0x70000157);
    let item_guid = Guid(0x60000157);

    state.entities.insert(Entity::new(
        item_guid,
        "Known Item".to_string(),
        WorldPosition::default(),
    ));

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 0,
        event: GameEvent::ViewContents(Box::new(ViewContentsEventData {
            container: container_guid,
            items: vec![ViewContentsEventItem {
                guid: item_guid,
                container_type: 0,
            }],
        })),
    }));

    let events = state.handle_message(&msg);

    assert!(state.open_containers.contains(&container_guid));
    assert_eq!(
        state
            .entities
            .get(item_guid)
            .and_then(|entity| entity.container_id()),
        Some(container_guid)
    );
    assert!(
        state
            .entity_lifecycle_state(item_guid)
            .is_some_and(|state| state.container_preview)
    );
    assert!(events.iter().any(
        |event| matches!(event, WorldEvent::ContainerOpened(guid) if *guid == container_guid)
    ));
}

#[test]
fn test_close_ground_container_marks_preview_only_entity_for_deferred_prune() {
    let mut state = WorldState::synthetic();
    let container_guid = Guid(0x70000151);
    let item_guid = Guid(0x60000151);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });
    state.open_containers.insert(container_guid);

    let mut entity = Entity::new(
        item_guid,
        "PreviewItem".to_string(),
        WorldPosition::default(),
    );
    entity.set_container_id(Some(container_guid));
    entity.position.landblock_id = Guid::NULL;
    state.entities.insert(entity);
    state.mark_container_preview(item_guid);

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 0,
        event: GameEvent::CloseGroundContainer(Box::new(CloseGroundContainerEventData {
            container_guid,
        })),
    }));

    let events = state.handle_message(&msg);
    let deadline = state
        .entity_lifecycle_state(item_guid)
        .and_then(|state| state.prune_deadline)
        .expect("expected preview-only container entity to become sweep-eligible");

    assert!(!state.open_containers.contains(&container_guid));
    assert!(state.entities.get(item_guid).is_some());
    assert_eq!(
        state
            .entities
            .get(item_guid)
            .and_then(|entity| entity.container_id()),
        None
    );
    assert!(
        state
            .entity_lifecycle_state(item_guid)
            .is_some_and(|state| state.prune_deadline.is_some())
    );
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == item_guid))
    );

    state.server_time = Some(ServerTimeSync {
        server_time: deadline + 1.0,
        local_time: Instant::now(),
    });

    let tick_events = state.tick();
    assert!(state.entities.get(item_guid).is_none());
    assert!(
        tick_events
            .iter()
            .any(|event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == item_guid))
    );
}

#[test]
fn test_reopening_container_does_not_reactivate_stale_preview_contents() {
    let mut state = WorldState::synthetic();
    let container_guid = Guid(0x70000158);
    let old_item_guid = Guid(0x60000159);
    let new_item_guid = Guid(0x6000015A);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });
    state.open_containers.insert(container_guid);

    let mut old_item = Entity::new(
        old_item_guid,
        "Old Preview Item".to_string(),
        WorldPosition::default(),
    );
    old_item.position.landblock_id = Guid::NULL;
    old_item.set_container_id(Some(container_guid));
    state.entities.insert(old_item);
    state.mark_container_preview(old_item_guid);

    let close_msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 0,
        event: GameEvent::CloseGroundContainer(Box::new(CloseGroundContainerEventData {
            container_guid,
        })),
    }));

    let _ = state.handle_message(&close_msg);

    assert_eq!(
        state
            .entities
            .get(old_item_guid)
            .and_then(|entity| entity.container_id()),
        None
    );

    state.entities.insert(Entity::new(
        new_item_guid,
        "New Preview Item".to_string(),
        WorldPosition::default(),
    ));

    let reopen_msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 0,
        event: GameEvent::ViewContents(Box::new(ViewContentsEventData {
            container: container_guid,
            items: vec![ViewContentsEventItem {
                guid: new_item_guid,
                container_type: 0,
            }],
        })),
    }));

    let _ = state.handle_message(&reopen_msg);

    assert_eq!(
        state
            .entities
            .get(old_item_guid)
            .and_then(|entity| entity.container_id()),
        None
    );
    assert!(
        !state
            .entity_lifecycle_state(old_item_guid)
            .is_some_and(|state| state.container_preview)
    );
    assert_eq!(
        state
            .entities
            .get(new_item_guid)
            .and_then(|entity| entity.container_id()),
        Some(container_guid)
    );
    assert!(
        state
            .entity_lifecycle_state(new_item_guid)
            .is_some_and(|state| state.container_preview)
    );
}

#[test]
fn test_late_container_item_arrival_is_marked_preview_and_pruned_on_close() {
    let mut state = WorldState::synthetic();
    let container_guid = Guid(0x7000015B);
    let item_guid = Guid(0x6000015B);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });
    state.open_containers.insert(container_guid);

    state.entities.insert(Entity::new(
        item_guid,
        "Late Chest Item".to_string(),
        WorldPosition::default(),
    ));

    let update_msg =
        GameMessage::PublicUpdatePropertyInstanceId(Box::new(UpdatePropertyInstanceId {
            sequence: 0,
            guid: item_guid,
            property: PropertyInstanceId::Container as u32,
            value: container_guid,
        }));

    let _ = state.handle_message(&update_msg);

    assert!(
        state
            .entity_lifecycle_state(item_guid)
            .is_some_and(|state| state.container_preview)
    );

    let close_msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 0,
        event: GameEvent::CloseGroundContainer(Box::new(CloseGroundContainerEventData {
            container_guid,
        })),
    }));

    let _ = state.handle_message(&close_msg);

    assert_eq!(
        state
            .entities
            .get(item_guid)
            .and_then(|entity| entity.container_id()),
        None
    );
    assert!(
        state
            .entity_lifecycle_state(item_guid)
            .and_then(|state| state.prune_deadline)
            .is_some()
    );
}

#[test]
fn test_closed_container_update_preserves_preview_provenance_and_prune_deadline() {
    let mut state = WorldState::synthetic();
    let container_guid = Guid(0x7000015C);
    let item_guid = Guid(0x6000015C);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });

    let mut item = Entity::new(
        item_guid,
        "Late Closed Chest Item".to_string(),
        WorldPosition::default(),
    );
    item.position.landblock_id = Guid::NULL;
    item.set_container_id(Some(container_guid));
    state.entities.insert(item);
    state.mark_container_preview(item_guid);
    state.set_entity_prune_deadline(item_guid, 125.0);

    let update_msg =
        GameMessage::PublicUpdatePropertyInstanceId(Box::new(UpdatePropertyInstanceId {
            sequence: 0,
            guid: item_guid,
            property: PropertyInstanceId::Container as u32,
            value: container_guid,
        }));

    let _ = state.handle_message(&update_msg);

    assert!(
        state
            .entity_lifecycle_state(item_guid)
            .is_some_and(|state| state.container_preview)
    );
    assert!(
        state
            .entity_lifecycle_state(item_guid)
            .and_then(|state| state.prune_deadline)
            .is_some()
    );
}

#[test]
fn test_close_ground_container_preserves_entity_with_other_retention() {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000153);
    let container_guid = Guid(0x70000153);
    let item_guid = Guid(0x60000153);

    state.player.guid = player_guid;
    state.open_containers.insert(container_guid);

    let mut entity = Entity::new(
        item_guid,
        "RetainedItem".to_string(),
        WorldPosition::default(),
    );
    entity.set_container_id(Some(container_guid));
    entity.position.landblock_id = Guid::NULL;
    state.entities.insert(entity);
    state.mark_container_preview(item_guid);
    state.player.add_to_inventory(item_guid);

    let msg = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid::NULL,
        sequence: 0,
        event: GameEvent::CloseGroundContainer(Box::new(CloseGroundContainerEventData {
            container_guid,
        })),
    }));

    let events = state.handle_message(&msg);

    assert!(state.entities.get(item_guid).is_some());
    assert!(state.entity_lifecycle_state(item_guid).is_none());
    assert!(state.player.inventory.contains(&item_guid));
    assert!(
        !events
            .iter()
            .any(|event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == item_guid))
    );
}

#[test]
fn test_tick_does_not_prune_off_world_entities_with_inventory_equipment_or_open_container_retention()
 {
    let mut state = WorldState::synthetic();
    let player_guid = Guid(0x50000154);
    let player_pos = WorldPosition {
        landblock_id: Guid(0x0A0AFFFF),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: holtburger_common::math::Quaternion::identity(),
    };
    let inventory_guid = Guid(0x60000154);
    let equipped_guid = Guid(0x60000155);
    let container_guid = Guid(0x70000154);
    let preview_guid = Guid(0x60000156);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });
    state.player.guid = player_guid;
    state.seed_local_player_entity(player_guid, "Player", player_pos);

    let mut inventory_entity = Entity::new(
        inventory_guid,
        "InventoryItem".to_string(),
        WorldPosition::default(),
    );
    inventory_entity.position.landblock_id = Guid::NULL;
    inventory_entity.set_container_id(Some(player_guid));
    state.add_entity(inventory_entity);
    state.player.add_to_inventory(inventory_guid);

    let mut equipped_entity = Entity::new(
        equipped_guid,
        "EquippedItem".to_string(),
        WorldPosition::default(),
    );
    equipped_entity.position.landblock_id = Guid::NULL;
    equipped_entity.set_wielder_id(Some(player_guid));
    state.add_entity(equipped_entity);
    state
        .player
        .wield_item(equipped_guid, EquipMask::MELEE_WEAPON);

    let mut preview_entity = Entity::new(
        preview_guid,
        "PreviewItem".to_string(),
        WorldPosition::default(),
    );
    preview_entity.position.landblock_id = Guid::NULL;
    preview_entity.set_container_id(Some(container_guid));
    state.add_entity(preview_entity);
    state.open_containers.insert(container_guid);
    state.mark_container_preview(preview_guid);

    let events = state.tick();

    assert!(events.is_empty());
    assert!(state.entities.get(inventory_guid).is_some());
    assert!(state.entities.get(equipped_guid).is_some());
    assert!(state.entities.get(preview_guid).is_some());
    assert!(
        state
            .entity_lifecycle_state(inventory_guid)
            .is_none_or(|state| state.prune_deadline.is_none())
    );
    assert!(
        state
            .entity_lifecycle_state(equipped_guid)
            .is_none_or(|state| state.prune_deadline.is_none())
    );
    assert!(
        state
            .entity_lifecycle_state(preview_guid)
            .is_some_and(|state| state.prune_deadline.is_none() && state.container_preview)
    );
}

#[test]
fn test_book_data_response_updates_entity_book_state() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x11223344);
    state.entities.insert(Entity::new(
        guid,
        "Book".to_string(),
        WorldPosition::default(),
    ));

    let message = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid(0x50000001),
        sequence: 0x21,
        event: GameEvent::BookDataResponse(Box::new(BookDataResponseEventData {
            object_guid: guid,
            max_num_pages: 3,
            num_pages: 3,
            max_num_chars_per_page: 1000,
            pages: vec![BookPageData {
                author_id: 0x01020304,
                author_name: "Scribe One".to_string(),
                author_account: "beer good".to_string(),
                flags: 0xFFFF0002,
                text_included: false,
                ignore_author: true,
                page_text: None,
            }],
            inscription: "Signed and sealed".to_string(),
            author_id: 0xAABBCCDD,
            author_name: "Archivist".to_string(),
        })),
    }));

    let events = state.handle_message(&message);

    assert!(matches!(
        events.first(),
        Some(WorldEvent::EntityBookUpdated {
            guid: event_guid,
            book,
        }) if *event_guid == guid && book.inscription.as_deref() == Some("Signed and sealed")
    ));

    let entity = state.entities.get(guid).expect("entity should still exist");
    let book = entity.book.as_ref().expect("book data should be populated");
    assert_eq!(book.max_num_pages, Some(3));
    assert_eq!(book.pages.len(), 1);
    assert_eq!(book.pages[0].author_name, "Scribe One");
    assert_eq!(book.inscription.as_deref(), Some("Signed and sealed"));
}

#[test]
fn test_book_page_data_response_merges_into_existing_book_state() {
    let mut state = WorldState::synthetic();
    let guid = Guid(0x11223344);
    let mut entity = Entity::new(guid, "Book".to_string(), WorldPosition::default());
    entity.book = Some(crate::book::BookData {
        pages: vec![crate::book::BookPage {
            index: 0,
            author_id: 1,
            author_name: "Page Zero".to_string(),
            author_account: "old".to_string(),
            flags: 0xFFFF0002,
            text_included: false,
            ignore_author: false,
            page_text: None,
        }],
        ..crate::book::BookData::default()
    });
    state.entities.insert(entity);

    let message = GameMessage::GameEvent(Box::new(GameEventMessage {
        target: Guid(0x50000001),
        sequence: 0x22,
        event: GameEvent::BookPageDataResponse(Box::new(BookPageDataResponseEventData {
            object_guid: guid,
            page_index: 1,
            page: BookPageData {
                author_id: 0x05060708,
                author_name: "Scribe Two".to_string(),
                author_account: "Password is cheese".to_string(),
                flags: 0xFFFF0002,
                text_included: true,
                ignore_author: false,
                page_text: Some("The second page has text.".to_string()),
            },
        })),
    }));

    let events = state.handle_message(&message);

    assert!(matches!(
        events.first(),
        Some(WorldEvent::EntityBookUpdated {
            guid: event_guid,
            book,
        }) if *event_guid == guid && book.pages.len() == 2
    ));

    let entity = state.entities.get(guid).expect("entity should still exist");
    let book = entity.book.as_ref().expect("book data should be populated");
    assert_eq!(book.pages.len(), 2);
    assert_eq!(book.pages[1].index, 1);
    assert_eq!(
        book.pages[1].page_text.as_deref(),
        Some("The second page has text.")
    );
}

#[test]
fn test_remove_entity_marks_wielded_dependents_for_prune() {
    let mut state = WorldState::synthetic();
    let wielder_guid = Guid(0x60000157);
    let item_guid = Guid(0x60000158);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });

    state.add_entity(Entity::new(
        wielder_guid,
        "Wielder".to_string(),
        WorldPosition::default(),
    ));

    let mut item = Entity::new(
        item_guid,
        "Wielded Item".to_string(),
        WorldPosition {
            landblock_id: Guid(0x0404_FFFF),
            ..WorldPosition::default()
        },
    );
    item.set_wielder_id(Some(wielder_guid));
    item.set_int_prop(
        PropertyInt::CurrentWieldedLocation,
        EquipMask::MELEE_WEAPON.bits() as i32,
    );
    state.add_entity(item);

    let removed = state.remove_entity(wielder_guid);

    assert!(removed.is_some());
    assert_eq!(state.entities.get(item_guid).unwrap().wielder_id(), None);
    assert_eq!(
        state.entities.get(item_guid).unwrap().position.landblock_id,
        Guid::NULL
    );
    assert!(
        state
            .entity_lifecycle_state(item_guid)
            .and_then(|state| state.prune_deadline)
            .is_some()
    );

    let events = state.tick();

    assert!(state.entities.get(item_guid).is_none());
    assert!(
        events
            .iter()
            .any(|event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == item_guid))
    );
}

#[test]
fn test_orphaned_wielded_item_is_not_retained() {
    let mut state = WorldState::synthetic();
    let item_guid = Guid(0x6000015B);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });

    let mut item = Entity::new(
        item_guid,
        "Orphaned Wielded Item".to_string(),
        WorldPosition::default(),
    );
    item.position.landblock_id = Guid::NULL;
    item.set_wielder_id(Some(Guid(0xDEAD_BEEF)));
    item.set_int_prop(
        PropertyInt::CurrentWieldedLocation,
        EquipMask::MELEE_WEAPON.bits() as i32,
    );
    state.add_entity(item);

    assert!(state.mark_entity_immediately_eligible_for_pruning_if_unretained(item_guid));
    assert!(
        state
            .entity_lifecycle_state(item_guid)
            .and_then(|state| state.prune_deadline)
            .is_some()
    );
}

#[test]
fn test_remove_entity_marks_contained_dependents_for_prune() {
    let mut state = WorldState::synthetic();
    let container_guid = Guid(0x60000159);
    let item_guid = Guid(0x6000015A);

    state.server_time = Some(ServerTimeSync {
        server_time: 100.0,
        local_time: Instant::now(),
    });

    state.add_entity(Entity::new(
        container_guid,
        "Container".to_string(),
        WorldPosition::default(),
    ));

    let mut item = Entity::new(
        item_guid,
        "Contained Item".to_string(),
        WorldPosition::default(),
    );
    item.position.landblock_id = Guid::NULL;
    item.set_container_id(Some(container_guid));
    state.add_entity(item);

    let removed = state.remove_entity(container_guid);

    assert!(removed.is_some());
    assert_eq!(state.entities.get(item_guid).unwrap().container_id(), None);
    assert!(
        state
            .entity_lifecycle_state(item_guid)
            .and_then(|state| state.prune_deadline)
            .is_some()
    );

    let events = state.tick();

    assert!(state.entities.get(item_guid).is_none());
    assert!(
        events
            .iter()
            .any(|event| matches!(event, WorldEvent::EntityDespawned(guid) if *guid == item_guid))
    );
}
