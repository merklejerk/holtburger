use super::super::common::{
    TURN_LEFT_MOTION_COMMAND, TURN_RIGHT_MOTION_COMMAND, WALK_FORWARD_MOTION_COMMAND,
    build_autonomous_position, build_motion_state_raw_motion_state, player_run_rate_scalar,
    raw_motion_state_with_motion_style,
};
use super::*;
use crate::client::movement_types::{Gait, LongitudinalMotion};
use byteorder::{LittleEndian, ReadBytesExt};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{PropertyDataId, WorldObjectPropertyAccessorsMut};
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_dat::file_type::MotionTable;
use holtburger_protocol::messages::game_message::{GameMessage, RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::movement::{
    HoldKey, MotionStance, MovementEventData, MovementInvalid, MovementType, MovementTypeData,
};
use holtburger_protocol::messages::transport::{FragmentHeader, PacketHeader, packet_flags};
use holtburger_protocol::traits::ProtocolUnpack;
use holtburger_session::Session;
use holtburger_world::entity::{
    Entity, EntityMotionAdmission, EntityMotionDirective, EntityMotionSnapshot,
    EntityMoveToParameters, EntityNetworkMotion, OrderedMotionPosition, OrderedMotionScalar,
};
use holtburger_world::motion::begin_server_directed_motion;
use holtburger_world::state::motion_resolution::test_support::{
    FIXTURE_STAND_COMMAND, FixtureCycle, explicit_motion_catalog,
};
use holtburger_world::stats::{Attribute, AttributeType, Skill, SkillType, TrainingLevel};
use holtburger_world::{AuthoritativePoseEffect, WorldState};
use std::io::{Cursor, Read};

const FIXTURE_MOTION_TABLE_ID: u32 = 0x0900_0020;

#[test]
fn dead_authority_advances_once_despite_held_manual_drive() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x7000_0001);
    let pose = WorldPosition::default();
    world.seed_local_player_entity(guid, "Death fixture", pose);
    let velocity = Vector3::new(2.0, 0.0, 0.0);
    world.set_motion_sequences(explicit_motion_catalog(
        FIXTURE_MOTION_TABLE_ID,
        MotionStance::NonCombat as u32,
        [FixtureCycle::moving(MotionCommand::DEAD.raw(), velocity)],
        [],
    ));
    let entity = world.player_entity_mut().unwrap();
    entity.set_did_prop(PropertyDataId::MotionTable, Guid(FIXTURE_MOTION_TABLE_ID));
    entity.network_motion = EntityNetworkMotion::Initialized(EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        forward_command: Some(InterpretedMotionCommand::DEAD),
        ..Default::default()
    });
    let mut movement = MovementSystem::new();
    movement.acquire_manual_control(None);
    assert!(movement.drives_local_authored_playback_this_tick());
    let dt = Duration::from_millis(30);
    crate::client::simulation::tick(Instant::now(), dt, &mut world, &mut movement, None).unwrap();
    let runtime = world.motion_runtimes.get(guid).unwrap();
    assert_eq!(runtime.state().substate, MotionCommand::DEAD);
    assert!((runtime.tick().offset.translation.x - velocity.x * dt.as_secs_f32()).abs() < 0.0001);
    assert_eq!(world.local_player_runtime_pose(), Some(pose));
}

fn seed_player_run_rate_scalar(world: &mut WorldState, run_skill: u32) -> f32 {
    world.player.attributes.insert(
        AttributeType::StrengthAttr,
        Attribute {
            attr_type: AttributeType::StrengthAttr,
            ranks: 0,
            start: 100,
            spent_xp: 0,
            next_rank_xp: None,
            base: 100,
            current: 100,
        },
    );
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

    player_run_rate_scalar(world)
}

fn seed_local_player(world: &mut WorldState, guid: Guid, position: WorldPosition) {
    world.seed_local_player_entity(guid, "Player", position);
}

fn install_manual_drive(
    movement: &mut MovementSystem,
    drive: CharacterDrive,
    until: Option<Instant>,
) {
    movement.character_motion.replace_drive(drive);
    movement.active_movement = Some(ActiveMovement::Manual { until });
}

#[test]
fn stale_character_motion_edges_do_not_mutate_outer_drive_state() {
    let mut world = WorldState::synthetic();
    let mut movement = MovementSystem::new();
    let drive = CharacterDrive::builder().run().forward().build();

    movement.enqueue_character_motion_event(SequencedCharacterMotionEvent {
        sequence: CharacterMotionSequence(2),
        event: CharacterMotionEvent::BeginJump { drive },
    });
    movement.process_control_commands(Instant::now(), &mut world);
    assert!(matches!(
        movement.active_movement,
        Some(ActiveMovement::Manual { .. })
    ));
    movement.take_character_motion_feedback();

    movement.enqueue_character_motion_event(SequencedCharacterMotionEvent {
        sequence: CharacterMotionSequence(1),
        event: CharacterMotionEvent::Reset,
    });
    movement.process_control_commands(Instant::now(), &mut world);
    assert!(matches!(
        movement.active_movement,
        Some(ActiveMovement::Manual { .. })
    ));
    assert!(movement.take_character_motion_feedback().is_empty());

    movement.enqueue_character_motion_event(SequencedCharacterMotionEvent {
        sequence: CharacterMotionSequence(3),
        event: CharacterMotionEvent::Reset,
    });
    movement.process_control_commands(Instant::now(), &mut world);
    assert!(movement.active_movement.is_none());
    movement.take_character_motion_feedback();

    movement.enqueue_character_motion_event(SequencedCharacterMotionEvent {
        sequence: CharacterMotionSequence(2),
        event: CharacterMotionEvent::BeginJump { drive },
    });
    movement.process_control_commands(Instant::now(), &mut world);
    assert!(movement.active_movement.is_none());
    assert!(movement.take_character_motion_feedback().is_empty());
}

fn seed_authored_manual_motion_world(world: &mut WorldState, guid: Guid) {
    let style = MotionStance::NonCombat as u32;
    world.set_motion_sequences(explicit_motion_catalog(
        FIXTURE_MOTION_TABLE_ID,
        style,
        [
            FixtureCycle::moving(
                MotionTable::WALK_FORWARD_COMMAND,
                Vector3::new(1.0, 0.0, 0.0),
            ),
            FixtureCycle::moving(
                MotionTable::RUN_FORWARD_COMMAND,
                Vector3::new(2.0, 0.0, 0.0),
            ),
            FixtureCycle::moving(0x6500_000f, Vector3::new(0.0, 1.0, 0.0)),
            FixtureCycle::moving(0x6500_0010, Vector3::new(0.0, -1.0, 0.0)),
            FixtureCycle::turning(MotionTable::TURN_LEFT_COMMAND, Vector3::new(0.0, 0.0, -1.0)),
            FixtureCycle::turning(MotionTable::TURN_RIGHT_COMMAND, Vector3::new(0.0, 0.0, 1.0)),
            FixtureCycle::moving(MotionCommand::READY.raw(), Vector3::zero()),
            FixtureCycle::moving(MotionCommand::FALLING.raw(), Vector3::zero()),
        ],
        [],
    ));
    world
        .entities
        .get_mut(guid)
        .expect("seeded player should exist")
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(FIXTURE_MOTION_TABLE_ID));
    seed_player_run_rate_scalar(world, 100);
    assert!(
        world
            .scene
            .apply_runtime_body_contact(SpatialBodyId::LocalPlayer(guid), ContactState::Grounded)
    );
}

#[test]
fn equivalent_local_remote_player_and_creature_directives_share_one_runtime_contract() {
    let local_guid = Guid(0x5100_1001);
    let remote_player_guid = Guid(0x5100_1002);
    let creature_guid = Guid(0x5100_1003);
    let target = WorldPosition {
        landblock_id: Guid(0x1234_0001),
        coords: Vector3::new(20.0, 0.0, 0.0),
        rotation: Quaternion::identity(),
    };
    let mut start = WorldPosition {
        coords: Vector3::zero(),
        ..target
    };
    start.rotation = Quaternion::from_heading(start.heading_to(&target));
    let scalar = |value| OrderedMotionScalar::from_f32(value).unwrap();
    let directive_for = |movement_sequence| EntityMotionDirective::MoveToPosition {
        admission: EntityMotionAdmission {
            object_instance_sequence: 1,
            movement_sequence,
            server_control_sequence: 3,
            is_autonomous: false,
        },
        target: OrderedMotionPosition {
            cell_id: target.landblock_id,
            x: scalar(target.coords.x),
            y: scalar(target.coords.y),
            z: scalar(target.coords.z),
        },
        params: EntityMoveToParameters {
            flags: 0x0000_0203,
            distance_to_object: scalar(1.0),
            min_distance: scalar(0.0),
            fail_distance: scalar(100.0),
            speed: scalar(1.0),
            walk_run_threshold: scalar(5.0),
            desired_heading_degrees: scalar(0.0),
        },
        run_rate: scalar(1.25),
    };
    let snapshot_for = |movement_sequence| EntityMotionSnapshot {
        current_style: Some(MotionStance::NonCombat),
        directive: Some(directive_for(movement_sequence)),
        ..EntityMotionSnapshot::default()
    };

    let mut world = WorldState::synthetic();
    world.player.guid = local_guid;
    seed_local_player(&mut world, local_guid, start);
    seed_authored_manual_motion_world(&mut world, local_guid);
    for (guid, name, sequence) in [
        (remote_player_guid, "Remote Player", 20),
        (creature_guid, "Drudge", 21),
    ] {
        let mut entity = Entity::new(guid, name.to_string(), start);
        entity
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(FIXTURE_MOTION_TABLE_ID));
        entity.network_motion = EntityNetworkMotion::Initialized(snapshot_for(sequence));
        world.add_entity(entity);
        assert!(
            world
                .scene
                .apply_runtime_body_contact(SpatialBodyId::Entity(guid), ContactState::Grounded,)
        );
    }
    let local_directive = directive_for(19);
    let mut movement = MovementSystem::new();
    install_manual_drive(
        &mut movement,
        CharacterDrive::builder().run().forward().build(),
        None,
    );
    movement.select_server_directive(Some(begin_server_directed_motion(
        local_directive,
        start,
        None,
    )));
    let quantum = Duration::from_millis(100);

    world.advance_authored_motion_except(quantum, Some(local_guid));
    let local_offset = movement
        .advance_local_authored_motion(&mut world, quantum)
        .unwrap()
        .expect("local directive should contribute authored root")
        .offset;
    let remote_player_offset = world
        .resolve_body_projection_input(SpatialBodyId::Entity(remote_player_guid))
        .and_then(|input| input.authored_offset)
        .unwrap();
    let creature_offset = world
        .resolve_body_projection_input(SpatialBodyId::Entity(creature_guid))
        .and_then(|input| input.authored_offset)
        .unwrap();

    assert_eq!(local_offset, remote_player_offset);
    assert_eq!(local_offset, creature_offset);
    let expected_substate = MotionCommand::RUN_FORWARD;
    for guid in [local_guid, remote_player_guid, creature_guid] {
        assert_eq!(
            world.motion_runtimes.state(guid).unwrap().substate,
            expected_substate
        );
    }
    let projected_local = start.coords + start.rotation.rotate_vector(local_offset.translation);
    let projected_remote = start.coords
        + start
            .rotation
            .rotate_vector(remote_player_offset.translation);
    let projected_creature =
        start.coords + start.rotation.rotate_vector(creature_offset.translation);
    assert_eq!(projected_local, projected_remote);
    assert_eq!(projected_local, projected_creature);

    assert!(world.scene.apply_runtime_body_pose(
        SpatialBodyId::LocalPlayer(local_guid),
        target,
        holtburger_world::SpatialSampleMode::SimulatingMotionState,
    ));
    for guid in [remote_player_guid, creature_guid] {
        assert!(world.scene.apply_runtime_body_pose(
            SpatialBodyId::Entity(guid),
            target,
            holtburger_world::SpatialSampleMode::SimulatingMotionState,
        ));
    }
    world.advance_authored_motion_except(quantum, Some(local_guid));
    assert!(
        movement
            .advance_local_authored_motion(&mut world, quantum)
            .unwrap()
            .is_some(),
        "local completion must advance the authored return-to-default transition",
    );
    assert!(!movement.has_server_controlled_motion());
    assert!(
        movement.active_movement.is_none(),
        "completion must not resume displaced held input"
    );
    for guid in [local_guid, remote_player_guid, creature_guid] {
        assert_eq!(
            world.motion_runtimes.state(guid).unwrap().substate,
            MotionCommand(FIXTURE_STAND_COMMAND),
        );
    }
}

#[test]
fn manual_playback_selects_ready_falling_and_grounded_from_shared_support_state() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_3308);
    let pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    };
    world.player.guid = guid;
    seed_local_player(&mut world, guid, pose);
    seed_authored_manual_motion_world(&mut world, guid);
    world.handle_message(&GameMessage::UpdateMotion(Box::new(MovementEventData {
        guid,
        object_instance_sequence: 1,
        movement_sequence: 2,
        server_control_sequence: 3,
        is_autonomous: true,
        movement_type: MovementType::Invalid,
        motion_flags: 0,
        current_style: 0,
        data: MovementTypeData::Invalid(MovementInvalid::default()),
    })));
    assert_eq!(
        world
            .player_entity()
            .and_then(|entity| entity.network_motion.snapshot()),
        Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            ..EntityMotionSnapshot::default()
        }),
        "the self authority adapter and generic body runtime must consume one admitted packet",
    );
    let body_id = SpatialBodyId::LocalPlayer(guid);
    assert!(
        world
            .scene
            .apply_runtime_body_contact(body_id, ContactState::Grounded)
    );

    let mut movement = MovementSystem::new();
    let drive = CharacterDrive::default();
    install_manual_drive(&mut movement, drive, None);
    assert_eq!(
        movement.character_motion.apply_event(
            SequencedCharacterMotionEvent {
                sequence: CharacterMotionSequence(1),
                event: CharacterMotionEvent::BeginJump { drive },
            },
            CharacterMotionReadiness::Ready,
        ),
        CharacterMotionEventResult::ChargeAccepted
    );

    movement
        .advance_local_authored_motion(&mut world, Duration::from_millis(30))
        .expect("standing charge playback should resolve");
    assert_eq!(
        world.motion_runtimes.state(guid).unwrap().substate,
        MotionCommand::READY
    );

    assert!(
        world
            .scene
            .apply_runtime_body_contact(body_id, ContactState::Airborne)
    );
    movement
        .advance_local_authored_motion(&mut world, Duration::from_millis(30))
        .expect("airborne playback should resolve");
    assert_eq!(
        world.motion_runtimes.state(guid).unwrap().substate,
        MotionCommand::FALLING
    );

    movement.character_motion.clear();
    assert!(
        world
            .scene
            .apply_runtime_body_contact(body_id, ContactState::Grounded)
    );
    movement
        .advance_local_authored_motion(&mut world, Duration::ZERO)
        .expect("landing playback should reconcile without advancing twice");
    assert_eq!(
        world.motion_runtimes.state(guid).unwrap().substate,
        MotionCommand(FIXTURE_STAND_COMMAND)
    );
}

#[test]
fn playable_jump_presentation_fails_loudly_when_required_cycle_is_missing() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_3309);
    let pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    };
    world.player.guid = guid;
    seed_local_player(&mut world, guid, pose);
    const MOTION_TABLE_ID: u32 = 0x0900_0021;
    world.set_motion_sequences(explicit_motion_catalog(
        MOTION_TABLE_ID,
        MotionStance::NonCombat as u32,
        [FixtureCycle::moving(
            MotionTable::RUN_FORWARD_COMMAND,
            Vector3::new(2.0, 0.0, 0.0),
        )],
        [],
    ));
    world
        .entities
        .get_mut(guid)
        .unwrap()
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(MOTION_TABLE_ID));
    seed_player_run_rate_scalar(&mut world, 100);
    assert!(
        world
            .scene
            .apply_runtime_body_contact(SpatialBodyId::LocalPlayer(guid), ContactState::Grounded,)
    );

    let mut movement = MovementSystem::new();
    let drive = CharacterDrive::default();
    install_manual_drive(&mut movement, drive, None);
    movement.character_motion.apply_event(
        SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(1),
            event: CharacterMotionEvent::BeginJump { drive },
        },
        CharacterMotionReadiness::Ready,
    );
    assert!(
        world
            .scene
            .apply_runtime_body_contact(SpatialBodyId::LocalPlayer(guid), ContactState::Airborne,)
    );

    let error = movement
        .advance_local_authored_motion(&mut world, Duration::from_millis(30))
        .expect_err("a playable player table missing Falling must fail loudly");
    assert!(
        error
            .to_string()
            .contains("manual local jump presentation unavailable")
    );
    assert!(world.motion_runtimes.get(guid).is_none());
}

#[test]
fn autonomous_wire_motion_state_uses_forward_without_turn_when_moving() {
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(
        Guid(0x5000_0123),
        "Player",
        WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::from_heading(0.0),
        },
    );

    let state = MovementSystem::autonomous_wire_motion_state(
        &world,
        AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: Some(90.0_f32.to_radians()),
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        },
    )
    .expect("moving autonomous drive should emit a wire motion state");

    assert_eq!(state.gait, Gait::Run);
    assert_eq!(state.longitudinal, Some(LongitudinalMotion::Forward));
    assert_eq!(state.lateral, None);
    assert_eq!(state.turning, None);
}

#[test]
fn autonomous_wire_motion_state_can_turn_in_place() {
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(
        Guid(0x5000_0123),
        "Player",
        WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::from_heading(0.0),
        },
    );

    let state = MovementSystem::autonomous_wire_motion_state(
        &world,
        AutonomousDriveIntent {
            desired_world_delta: Vector3::zero(),
            desired_heading: Some(90.0_f32.to_radians()),
            target_hint: None,
            gait: Gait::Walk,
            force_grounded: false,
        },
    )
    .expect("heading-only autonomous drive should still emit a turn edge");

    assert_eq!(state.gait, Gait::Walk);
    assert_eq!(state.longitudinal, None);
    assert_eq!(state.lateral, None);
    assert_eq!(state.turning, Some(Turn::Right));
}

#[test]
fn autonomous_wire_motion_state_skips_idle_aligned_requests() {
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(
        Guid(0x5000_0123),
        "Player",
        WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::new(10.0, 20.0, 0.0),
            rotation: Quaternion::from_heading(0.0),
        },
    );

    let state = MovementSystem::autonomous_wire_motion_state(
        &world,
        AutonomousDriveIntent {
            desired_world_delta: Vector3::zero(),
            desired_heading: Some(0.0),
            target_hint: None,
            gait: Gait::Walk,
            force_grounded: false,
        },
    );

    assert_eq!(state, None);
}

#[tokio::test]
async fn enqueue_drive_intent_exposes_autonomous_drive_for_current_tick_only() {
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(
        Guid(0x5000_0123),
        "Player",
        WorldPosition {
            landblock_id: Guid(0x1234_0000),
            ..Default::default()
        },
    );

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let now = Instant::now();
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 2.0, 3.0),
            desired_heading: Some(0.75),
            target_hint: Some(WorldPosition {
                landblock_id: Guid(0x1234_0100),
                coords: Vector3::new(5.0, 6.0, 7.0),
                rotation: Quaternion::identity(),
            }),
            gait: Gait::Run,
            force_grounded: true,
        })),
        now,
    );

    assert_eq!(
        movement.current_local_drive_control(&world, Duration::from_millis(33)),
        None
    );

    movement
        .tick(now, &mut world, &mut session)
        .await
        .expect("autonomous drive should activate on movement tick");

    let drive = movement
        .current_local_drive_control(&world, Duration::from_millis(33))
        .expect("autonomous drive should be exposed to simulation");

    assert_eq!(drive.body_id, SpatialBodyId::LocalPlayer(world.player.guid));
    assert_eq!(drive.desired_world_delta, Vector3::new(1.0, 2.0, 3.0));
    assert_eq!(drive.desired_heading, Some(0.75));
    assert_eq!(
        drive.target_hint,
        Some(WorldPosition {
            landblock_id: Guid(0x1234_0100),
            coords: Vector3::new(5.0, 6.0, 7.0),
            rotation: Quaternion::identity(),
        })
    );
    assert_eq!(drive.gait, holtburger_world::spatial::LocalDriveGait::Run);
    assert!(drive.force_grounded);

    movement
        .tick(now + Duration::from_millis(30), &mut world, &mut session)
        .await
        .expect("tick-scoped autonomous drive should expire when not resent");

    assert_eq!(
        movement.current_local_drive_control(&world, Duration::from_millis(33)),
        None
    );
}

#[tokio::test]
async fn later_manual_drive_wins_over_queued_autonomous_drive() {
    let mut world = WorldState::synthetic();
    world.seed_local_player_entity(
        Guid(0x5000_0123),
        "Player",
        WorldPosition {
            landblock_id: Guid(0x1234_0000),
            ..Default::default()
        },
    );

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let now = Instant::now();
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: None,
            target_hint: None,
            gait: Gait::Walk,
            force_grounded: false,
        })),
        now,
    );
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ManualHeld(CharacterDrive::builder().run().forward().build()),
        now,
    );

    movement
        .tick(now, &mut world, &mut session)
        .await
        .expect("movement tick should arbitrate queued drive intents");

    assert_eq!(
        movement.current_local_drive_control(&world, Duration::from_millis(33)),
        None
    );
    assert!(matches!(
        movement.active_movement,
        Some(ActiveMovement::Manual { .. })
    ));
    assert_eq!(movement.character_motion.effective_drive().gait, Gait::Run);
    assert_eq!(
        movement.character_motion.effective_drive().longitudinal,
        Some(LongitudinalMotion::Forward)
    );
}

#[test]
fn test_raw_motion_state_preserves_cached_server_style_by_default() {
    let mut world = WorldState::synthetic();
    world.player.last_server_motion_style = Some(MotionStance::SwordCombat);

    let raw_motion_state = raw_motion_state_with_motion_style(
        &world,
        RawMotionState {
            flags: RawMotionFlags::CURRENT_HOLD_KEY
                | RawMotionFlags::FORWARD_COMMAND
                | RawMotionFlags::FORWARD_SPEED,
            current_hold_key: Some(HoldKey::Run as u32),
            forward_command: Some(WALK_FORWARD_MOTION_COMMAND),
            forward_speed: Some(7.0),
            ..Default::default()
        },
        MotionStyle::PreserveServer,
    );

    assert!(
        raw_motion_state
            .flags
            .contains(RawMotionFlags::CURRENT_STYLE)
    );
    assert!(
        raw_motion_state
            .flags
            .contains(RawMotionFlags::FORWARD_COMMAND)
    );
    assert_eq!(
        raw_motion_state.current_stance(),
        Some(MotionStance::SwordCombat)
    );
    assert_eq!(raw_motion_state.current_hold_key, Some(HoldKey::Run as u32));
    assert_eq!(
        raw_motion_state.forward_command,
        Some(WALK_FORWARD_MOTION_COMMAND)
    );
    assert_eq!(raw_motion_state.forward_speed, Some(7.0));
}

#[test]
fn test_raw_motion_state_can_override_cached_server_style() {
    let mut world = WorldState::synthetic();
    world.player.last_server_motion_style = Some(MotionStance::SwordCombat);

    let raw_motion_state = raw_motion_state_with_motion_style(
        &world,
        RawMotionState::default(),
        MotionStyle::Explicit(MotionStance::Magic),
    );

    assert!(
        raw_motion_state
            .flags
            .contains(RawMotionFlags::CURRENT_STYLE)
    );
    assert_eq!(raw_motion_state.current_stance(), Some(MotionStance::Magic));
}

#[test]
fn test_raw_motion_state_can_omit_cached_server_style() {
    let mut world = WorldState::synthetic();
    world.player.last_server_motion_style = Some(MotionStance::SwordCombat);

    let raw_motion_state = raw_motion_state_with_motion_style(
        &world,
        RawMotionState {
            flags: RawMotionFlags::CURRENT_STYLE,
            current_style: Some(MotionStance::Magic as u32),
            ..Default::default()
        },
        MotionStyle::Omit,
    );

    assert!(
        !raw_motion_state
            .flags
            .contains(RawMotionFlags::CURRENT_STYLE)
    );
    assert_eq!(raw_motion_state.current_style, None);
}

#[test]
fn motion_state_raw_motion_state_adds_right_turn_when_requested() {
    let world = WorldState::synthetic();

    let raw_motion_state = build_motion_state_raw_motion_state(
        &world,
        CharacterDrive::builder()
            .run()
            .forward()
            .turn_right()
            .build(),
        MotionStyle::PreserveServer,
    );

    assert!(
        raw_motion_state
            .flags
            .contains(RawMotionFlags::FORWARD_COMMAND)
    );
    assert!(
        raw_motion_state
            .flags
            .contains(RawMotionFlags::TURN_COMMAND)
    );
    assert!(!raw_motion_state.flags.contains(RawMotionFlags::TURN_SPEED));
    assert_eq!(
        raw_motion_state.turn_command,
        Some(TURN_RIGHT_MOTION_COMMAND)
    );
    assert_eq!(raw_motion_state.turn_speed, None);
}

#[test]
fn motion_state_raw_motion_state_uses_player_run_rate_scalar_for_forward_speed() {
    let mut world = WorldState::synthetic();
    let expected_run_rate_scalar = seed_player_run_rate_scalar(&mut world, 300);

    let raw_motion_state = build_motion_state_raw_motion_state(
        &world,
        CharacterDrive::builder().run().forward().build(),
        MotionStyle::PreserveServer,
    );

    assert_eq!(
        raw_motion_state.forward_command,
        Some(WALK_FORWARD_MOTION_COMMAND)
    );
    assert_eq!(raw_motion_state.forward_hold_key, Some(HoldKey::Run as u32));
    assert_eq!(
        raw_motion_state.forward_speed,
        Some(expected_run_rate_scalar)
    );
    assert!(
        raw_motion_state
            .flags
            .contains(RawMotionFlags::FORWARD_HOLD_KEY)
    );
}

#[test]
fn motion_state_raw_motion_state_adds_left_turn_when_requested() {
    let world = WorldState::synthetic();

    let raw_motion_state = build_motion_state_raw_motion_state(
        &world,
        CharacterDrive::builder()
            .run()
            .forward()
            .turn_left()
            .build(),
        MotionStyle::PreserveServer,
    );

    assert!(
        raw_motion_state
            .flags
            .contains(RawMotionFlags::TURN_COMMAND)
    );
    assert_eq!(
        raw_motion_state.turn_command,
        Some(TURN_LEFT_MOTION_COMMAND)
    );
    assert_eq!(raw_motion_state.turn_speed, None);
    assert_eq!(raw_motion_state.turn_hold_key, Some(HoldKey::Run as u32));
    assert!(
        raw_motion_state
            .flags
            .contains(RawMotionFlags::TURN_HOLD_KEY)
    );
}

#[test]
fn motion_state_raw_motion_state_encodes_explicit_turn_rate_before_run_adjustment() {
    let world = WorldState::synthetic();

    let raw_motion_state = build_motion_state_raw_motion_state(
        &world,
        CharacterDrive::builder()
            .run()
            .turn_right()
            .with_turn_rate_scalar(0.75)
            .build(),
        MotionStyle::PreserveServer,
    );

    assert!(raw_motion_state.flags.contains(RawMotionFlags::TURN_SPEED));
    assert_eq!(raw_motion_state.turn_speed, Some(0.5));
    assert_eq!(raw_motion_state.turn_hold_key, Some(HoldKey::Run as u32));
}

#[test]
fn motion_state_raw_motion_state_omits_turn_when_not_requested() {
    let world = WorldState::synthetic();

    let raw_motion_state = build_motion_state_raw_motion_state(
        &world,
        CharacterDrive::builder().run().forward().build(),
        MotionStyle::PreserveServer,
    );

    assert!(
        !raw_motion_state
            .flags
            .contains(RawMotionFlags::TURN_COMMAND)
    );
    assert!(!raw_motion_state.flags.contains(RawMotionFlags::TURN_SPEED));
    assert_eq!(raw_motion_state.turn_command, None);
    assert_eq!(raw_motion_state.turn_speed, None);
}

#[test]
fn manual_motion_resolves_one_authored_offset_for_diagonal_and_turning_axes() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x5000_0124);
    let position = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(10.0, 20.0, 0.0),
        rotation: Quaternion::identity(),
    };
    seed_local_player(&mut world, guid, position);
    seed_authored_manual_motion_world(&mut world, guid);

    let mut movement = MovementSystem::new();
    let state = CharacterDrive::builder()
        .run()
        .forward()
        .strafe_left()
        .build();
    install_manual_drive(&mut movement, state, None);

    let offset = movement
        .advance_local_authored_motion(&mut world, Duration::from_millis(100))
        .expect("authored manual motion should resolve")
        .expect("active drive should produce one offset");
    assert!(offset.offset.translation.length_squared() > 0.0);
    assert_eq!(
        world.motion_runtimes.authored_offset(guid),
        Some(offset.offset)
    );

    install_manual_drive(
        &mut movement,
        CharacterDrive::builder().run().turn_right().build(),
        None,
    );
    let turn = movement
        .advance_local_authored_motion(&mut world, Duration::from_millis(100))
        .expect("turn-only motion should resolve")
        .expect("turn-only drive should produce an offset");
    assert!(turn.offset.rotation.to_heading().abs() > 0.0);
    assert_eq!(
        world.motion_runtimes.authored_offset(guid),
        Some(turn.offset)
    );
    assert_eq!(
        world.motion_runtimes.state(guid).unwrap().substate,
        holtburger_world::motion::MotionCommand(MotionTable::TURN_RIGHT_COMMAND)
    );
}

#[test]
fn manual_motion_reversal_uses_the_same_table_without_a_fixed_backwards_speed() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x5000_0125);
    let position = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(10.0, 20.0, 0.0),
        rotation: Quaternion::identity(),
    };
    seed_local_player(&mut world, guid, position);
    seed_authored_manual_motion_world(&mut world, guid);

    let mut movement = MovementSystem::new();
    install_manual_drive(
        &mut movement,
        CharacterDrive::builder().run().forward().build(),
        None,
    );
    let forward = movement
        .advance_local_authored_motion(&mut world, Duration::from_millis(100))
        .expect("forward motion should resolve")
        .expect("forward drive should produce an offset");

    install_manual_drive(
        &mut movement,
        CharacterDrive::builder().run().backstep().build(),
        None,
    );
    let backward = movement
        .advance_local_authored_motion(&mut world, Duration::from_millis(100))
        .expect("backward motion should resolve")
        .expect("backward drive should produce an offset");

    assert!(forward.offset.translation.length_squared() > 0.0);
    assert!(backward.offset.translation.length_squared() > 0.0);
    assert!(forward.offset.translation.x.signum() != backward.offset.translation.x.signum());
}

#[test]
fn stop_pulse_is_still_required_when_server_motion_is_active() {
    let mut movement = MovementSystem::new();
    movement.note_drive_published(published_drive(
        CharacterDrive::builder()
            .run()
            .forward()
            .turn_right()
            .build(),
        MotionStyle::PreserveServer,
    ));

    assert!(movement.should_send_stop_pulse());
}

#[test]
fn note_stop_published_resets_drive_tracking() {
    let mut movement = MovementSystem::new();
    movement.note_drive_published(published_drive(
        CharacterDrive::builder()
            .run()
            .forward()
            .turn_right()
            .build(),
        MotionStyle::PreserveServer,
    ));

    movement.note_stop_published();

    assert!(movement.published_motion.is_none());
}

#[test]
fn unchanged_motion_intent_does_not_require_server_refresh() {
    let mut movement = MovementSystem::new();
    movement.note_drive_published(published_drive(
        CharacterDrive::builder()
            .run()
            .forward()
            .turn_right()
            .build(),
        MotionStyle::PreserveServer,
    ));

    assert!(
        !movement.should_send_motion_state_pulse(
            CharacterDrive::builder()
                .run()
                .forward()
                .turn_right()
                .build(),
            MotionStyle::PreserveServer,
        )
    );
}

#[test]
fn autonomous_position_defaults_to_contact_when_unresolved() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };
    let mut entity = Entity::new(guid, "Player".to_string(), position);
    entity.velocity = Vector3::new(2.0, 0.0, 0.0);

    world.player.guid = guid;
    world.player.instance_sequence = 11;
    world.player.server_control_sequence = 22;
    world.player.teleport_sequence = 33;
    world.player.force_position_sequence = 44;
    seed_local_player(&mut world, guid, position);
    world.entities.insert(entity);

    let (position_action, _) = build_autonomous_position(&world, MovementPacketMetadata::default())
        .expect("moving player should emit autonomous position action");

    assert_eq!(position_action.position, position);
    assert_eq!(position_action.instance_sequence, 11);
    assert_eq!(position_action.server_control_sequence, 22);
    assert_eq!(position_action.teleport_sequence, 33);
    assert_eq!(position_action.force_position_sequence, 44);
    assert_eq!(position_action.last_contact, 1);
}

#[test]
fn autonomous_position_uses_packet_contact_when_runtime_contact_is_unknown() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };
    let mut entity = Entity::new(guid, "Player".to_string(), position);
    entity.velocity = Vector3::new(2.0, 0.0, 0.0);

    world.player.guid = guid;
    world.player.last_server_contact = Some(true);
    seed_local_player(&mut world, guid, position);
    world.entities.insert(entity);

    let (position_action, _) = build_autonomous_position(&world, MovementPacketMetadata::default())
        .expect("moving player should emit autonomous position action");

    assert_eq!(position_action.last_contact, 1);
}

#[test]
fn autonomous_position_uses_typed_runtime_contact_before_packet_fallback() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::identity(),
    };
    world.player.guid = guid;
    world.player.last_server_contact = Some(false);
    seed_local_player(&mut world, guid, position);
    assert!(
        world
            .scene
            .apply_runtime_body_contact(SpatialBodyId::LocalPlayer(guid), ContactState::Sliding,)
    );

    let (position_action, _) = build_autonomous_position(&world, MovementPacketMetadata::default())
        .expect("placed player should emit autonomous position action");

    assert_eq!(position_action.last_contact, 1);
}

#[test]
fn autonomous_position_can_be_built_for_turn_only_motion() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };
    let mut entity = Entity::new(guid, "Player".to_string(), position);
    entity.omega = Vector3::new(0.0, 0.0, 1.0);

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);
    seed_authored_manual_motion_world(&mut world, guid);
    world.entities.insert(entity);

    let (position_action, _) = build_autonomous_position(&world, MovementPacketMetadata::default())
        .expect("turning player should emit autonomous position action");

    assert_eq!(position_action.position, position);
}

#[test]
fn autonomous_position_can_be_built_for_stationary_player() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    world.player.instance_sequence = 11;
    world.player.server_control_sequence = 22;
    world.player.teleport_sequence = 33;
    world.player.force_position_sequence = 44;
    seed_local_player(&mut world, guid, position);

    let (position_action, _) = build_autonomous_position(&world, MovementPacketMetadata::default())
        .expect("autonomous position action should emit even when stationary");

    assert_eq!(position_action.position, position);
    assert_eq!(position_action.instance_sequence, 11);
    assert_eq!(position_action.server_control_sequence, 22);
    assert_eq!(position_action.teleport_sequence, 33);
    assert_eq!(position_action.force_position_sequence, 44);
}

#[tokio::test]
async fn stop_after_active_movement_sends_stop_pulse_then_final_position_sync() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };
    let mut entity = Entity::new(guid, "Player".to_string(), position);

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);
    world.entities.insert(entity.clone());

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();

    movement
        .execute_motion_state_at(
            CharacterDrive::builder().run().forward().build(),
            &mut world,
            &mut session,
            Instant::now(),
        )
        .await
        .expect("drive request should succeed");

    entity.velocity = Vector3::new(0.0, 4.0, 0.0);
    world.entities.insert(entity);

    movement
        .execute_stop_at(
            Instant::now(),
            &mut world,
            &mut session,
            MovementPacketMetadata::default(),
            true,
        )
        .await
        .expect("stop request should succeed");

    assert_eq!(session.packet_sequence, 4);
}

#[tokio::test]
async fn stop_without_active_movement_does_not_send_final_position_sync() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    movement.note_drive_published(published_drive(
        CharacterDrive::builder()
            .run()
            .forward()
            .turn_right()
            .build(),
        MotionStyle::PreserveServer,
    ));

    movement
        .execute_stop_at(
            Instant::now(),
            &mut world,
            &mut session,
            MovementPacketMetadata::default(),
            false,
        )
        .await
        .expect("stop request should succeed");

    assert_eq!(session.packet_sequence, 2);
}

#[tokio::test]
async fn unchanged_motion_state_requests_do_not_resend_motion_pulses() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();
    let state = CharacterDrive::builder()
        .run()
        .forward()
        .turn_right()
        .build();

    movement
        .execute_motion_state_with_metadata_at(
            state,
            MovementPacketMetadata::default(),
            &mut world,
            &mut session,
            start,
        )
        .await
        .expect("initial motion request should send a motion pulse");
    assert_eq!(session.packet_sequence, 2);

    movement
        .execute_motion_state_with_metadata_at(
            state,
            MovementPacketMetadata::default(),
            &mut world,
            &mut session,
            start + Duration::from_millis(100),
        )
        .await
        .expect("unchanged motion request should be deduplicated");
    assert_eq!(session.packet_sequence, 2);
}

#[tokio::test]
async fn held_run_input_ticks_once_for_wire_without_reconstructing_local_vectors() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ManualHeld(CharacterDrive::builder().run().forward().build()),
        start,
    );

    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("held run input should start moving");

    assert_eq!(session.packet_sequence, 2);

    movement
        .tick(start + Duration::from_millis(30), &mut world, &mut session)
        .await
        .expect("steady held run should not resend unchanged motion intent");

    assert_eq!(session.packet_sequence, 2);
}

#[tokio::test]
async fn pulsed_run_input_expires_on_tick_and_sends_stop_transition() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ManualPulse {
            state: CharacterDrive::builder().run().forward().build(),
            duration: Duration::from_millis(50),
        },
        start,
    );

    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("pulse should start movement");
    assert_eq!(session.packet_sequence, 2);

    movement
        .tick(start + Duration::from_millis(60), &mut world, &mut session)
        .await
        .expect("expired pulse should stop movement on the next tick");

    let player = world
        .entities
        .get(guid)
        .expect("synthetic player entity should exist");
    assert!(player.velocity.length_squared() <= 1e-6);
    assert!(player.omega.length_squared() <= 1e-6);
    assert_eq!(session.packet_sequence, 4);
}

#[test]
fn admitted_server_control_supersedes_queued_manual_work() {
    let mut world = WorldState::synthetic();
    let mut movement = MovementSystem::new();
    let now = Instant::now();
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ManualHeld(CharacterDrive::builder().run().forward().build()),
        now,
    );
    movement.enqueue_character_motion_event(SequencedCharacterMotionEvent {
        sequence: CharacterMotionSequence(1),
        event: CharacterMotionEvent::BeginJump {
            drive: CharacterDrive::default(),
        },
    });
    movement.admit_server_controlled_motion(None, now, &mut world);
    assert!(!movement.has_active_manual_drive());
    assert!(!movement.character_motion.is_charging());
    assert!(movement.queued_control_commands.is_empty());

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ManualHeld(CharacterDrive::builder().run().forward().build()),
        now,
    );
    movement.process_control_commands(now, &mut world);
    assert!(movement.has_active_manual_drive());
}

#[tokio::test]
async fn stop_input_clears_held_run_and_sends_stop_transition() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ManualHeld(CharacterDrive::builder().run().forward().build()),
        start,
    );
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("held run should start");

    movement.enqueue_drive_intent(PlayerDriveIntent::Stop, start + Duration::from_millis(30));
    movement
        .tick(start + Duration::from_millis(30), &mut world, &mut session)
        .await
        .expect("stop input should end held movement");

    let player = world
        .entities
        .get(guid)
        .expect("synthetic player entity should exist");
    assert!(player.velocity.length_squared() <= 1e-6);
    assert!(player.omega.length_squared() <= 1e-6);
    assert_eq!(session.packet_sequence, 4);
}

#[tokio::test]
async fn autonomous_drive_gap_does_not_send_stop_pulse_without_explicit_stop() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: None,
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        })),
        start,
    );
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("autonomous drive should emit a motion pulse");

    assert_eq!(session.packet_sequence, 2);

    movement
        .tick(start + Duration::from_millis(30), &mut world, &mut session)
        .await
        .expect("autonomous drive gap should not synthesize a stop pulse");

    assert_eq!(session.packet_sequence, 2);
}

#[tokio::test]
async fn explicit_stop_after_autonomous_drive_sends_stop_pulse() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: None,
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        })),
        start,
    );
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("autonomous drive should emit a motion pulse");

    movement.enqueue_drive_intent(PlayerDriveIntent::Stop, start + Duration::from_millis(30));
    movement
        .tick(start + Duration::from_millis(30), &mut world, &mut session)
        .await
        .expect("explicit stop should still emit a stop pulse");

    assert_eq!(session.packet_sequence, 4);
}

#[tokio::test]
async fn transient_motion_reasserts_autonomous_locomotion_on_next_tick() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);
    seed_authored_manual_motion_world(&mut world, guid);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();

    let autonomous_intent = AutonomousDriveIntent {
        desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
        desired_heading: None,
        target_hint: None,
        gait: Gait::Run,
        force_grounded: true,
    };

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(autonomous_intent)),
        start,
    );
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("autonomous drive should emit a locomotion pulse");

    assert_eq!(session.game_action_sequence, 1);

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(autonomous_intent)),
        start + Duration::from_millis(30),
    );
    movement.enqueue_transient_motion(
        holtburger_protocol::messages::movement::InterpretedMotionCommand(0x0087),
        MotionStyle::Explicit(MotionStance::NonCombat),
    );
    movement
        .tick(start + Duration::from_millis(30), &mut world, &mut session)
        .await
        .expect("transient motion should replace the locomotion pulse for this tick");

    assert_eq!(
        movement.current_local_drive_control(&world, Duration::from_millis(33)),
        Some(LocalDriveControl {
            body_id: SpatialBodyId::LocalPlayer(guid),
            desired_world_delta: autonomous_intent.desired_world_delta,
            desired_heading: autonomous_intent.desired_heading,
            target_hint: autonomous_intent.target_hint,
            gait: holtburger_world::spatial::LocalDriveGait::Run,
            force_grounded: true,
        })
    );
    assert_eq!(movement.published_motion, Some(PublishedMotion::Transient));

    assert_eq!(session.game_action_sequence, 2);

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(autonomous_intent)),
        start + Duration::from_millis(60),
    );
    movement
        .tick(start + Duration::from_millis(60), &mut world, &mut session)
        .await
        .expect("locomotion should be reasserted after the transient motion clears");

    assert_eq!(
        movement.published_motion,
        MovementSystem::autonomous_wire_motion_state(&world, autonomous_intent).map(|state| {
            PublishedMotion::Drive(published_drive(state, MotionStyle::PreserveServer))
        })
    );

    assert_eq!(session.game_action_sequence, 3);
}

#[tokio::test]
async fn manual_motion_updates_server_motion_tracking_state() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_1304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();
    let state = CharacterDrive::builder().run().forward().build();

    movement.enqueue_drive_intent(PlayerDriveIntent::ManualHeld(state), start);
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("manual locomotion should update server motion tracking");

    assert!(movement.published_motion.is_some());
    assert_eq!(
        movement.published_motion,
        Some(PublishedMotion::Drive(published_drive(
            state,
            MotionStyle::PreserveServer
        )))
    );
}

#[test]
fn sequential_position_confirmations_preserve_manual_playback_cursor() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_3306);
    let pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    };
    world.player.guid = guid;
    seed_local_player(&mut world, guid, pose);
    seed_authored_manual_motion_world(&mut world, guid);

    let mut movement = MovementSystem::new();
    install_manual_drive(
        &mut movement,
        CharacterDrive::builder().run().forward().build(),
        None,
    );
    let quantum = Duration::from_millis(100);
    let first = movement
        .advance_local_authored_motion(&mut world, quantum)
        .expect("initial authored playback should resolve")
        .expect("held forward input should produce an offset");
    assert!(first.offset.translation.x > 0.0);
    assert_eq!(
        world
            .motion_runtimes
            .state(guid)
            .expect("local root motion must install presentation-visible playback")
            .substate,
        holtburger_world::motion::MotionCommand::RUN_FORWARD
    );

    for sample in 1..=5 {
        let confirmed = WorldPosition {
            coords: Vector3::new(sample as f32 * 0.1, 0.0, 0.0),
            ..pose
        };
        let _ =
            world.apply_player_pose_effect(AuthoritativePoseEffect::Confirm { pose: confirmed });

        assert!(movement.has_active_manual_drive());
        assert!(world.motion_runtimes.get(guid).is_some());
        let offset = movement
            .advance_local_authored_motion(&mut world, quantum)
            .expect("confirmation must not invalidate authored playback")
            .expect("held forward input should continue after confirmation");
        assert!(offset.offset.translation.x > 0.0);
    }
}

#[test]
fn manual_stop_drives_the_same_world_cursor_to_authored_idle() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_3307);
    let pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    };
    world.player.guid = guid;
    seed_local_player(&mut world, guid, pose);
    seed_authored_manual_motion_world(&mut world, guid);

    let mut movement = MovementSystem::new();
    install_manual_drive(
        &mut movement,
        CharacterDrive::builder().run().forward().build(),
        None,
    );
    let quantum = Duration::from_millis(100);
    movement
        .advance_local_authored_motion(&mut world, quantum)
        .unwrap()
        .expect("held drive should advance authored playback");

    movement.ingest_drive_intent(PlayerDriveIntent::Stop, Instant::now());
    assert!(movement.drives_local_authored_playback_this_tick());
    world.advance_authored_motion_except(quantum, Some(guid));
    movement
        .advance_local_authored_motion(&mut world, quantum)
        .unwrap()
        .expect("stop should advance the authored transition to idle");
    assert_eq!(
        world.motion_runtimes.state(guid).unwrap().substate,
        holtburger_world::motion::MotionCommand(FIXTURE_STAND_COMMAND)
    );

    world.advance_authored_motion(quantum);
    assert_eq!(
        world.motion_runtimes.state(guid).unwrap().substate,
        holtburger_world::motion::MotionCommand(FIXTURE_STAND_COMMAND),
        "an absent server snapshot must not delete the locally installed idle cursor"
    );
}

#[tokio::test]
async fn snap_facing_sends_autonomous_position_sync_with_updated_rotation() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(0.0),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();

    let events = movement
        .execute_snap_facing(
            Instant::now(),
            90.0_f32.to_radians(),
            &mut world,
            &mut session,
            MovementPacketMetadata::default(),
        )
        .await
        .expect("snap facing should succeed");

    let _ = events;
    let body = world
        .scene
        .body(SpatialBodyId::LocalPlayer(guid))
        .expect("local player runtime body should exist");
    assert!((body.pose.rotation.to_heading() - 90.0_f32.to_radians()).abs() < 1e-5);
    assert_eq!(session.packet_sequence, 2);
}

#[tokio::test]
async fn arrival_pose_sync_updates_runtime_pose_and_clears_server_motion() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(0.0),
    };
    let arrival_pose = WorldPosition {
        landblock_id: Guid(0x1000_0100),
        coords: Vector3::new(12.0, -4.0, 7.25),
        rotation: Quaternion::from_heading(0.0),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: None,
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        })),
        start,
    );
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("autonomous drive should emit a motion pulse");

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Settle {
            pose: Some(arrival_pose),
        }),
        start + Duration::from_millis(30),
    );
    movement
        .tick(start + Duration::from_millis(30), &mut world, &mut session)
        .await
        .expect("arrival pose should sync and stop motion");

    let body = world
        .scene
        .body(SpatialBodyId::LocalPlayer(guid))
        .expect("local player runtime body should exist");
    assert_eq!(body.pose, arrival_pose);
    assert_eq!(session.packet_sequence, 4);
    assert!(!movement.should_send_stop_pulse());
}

#[tokio::test]
async fn position_publication_uses_accepted_pose_and_survives_stationary_ticks() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    world.player.guid = guid;
    let pose = WorldPosition {
        landblock_id: Guid(0x1000_0100),
        ..WorldPosition::default()
    };
    seed_local_player(&mut world, guid, pose);
    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let now = Instant::now();
    assert!(
        movement
            .publish_position_after_simulation(now, &world, &mut session)
            .await
            .unwrap()
    );
    assert!(
        !movement
            .publish_position_after_simulation(now, &world, &mut session)
            .await
            .unwrap()
    );
    let mut accepted = pose;
    accepted.landblock_id = Guid(0x1000_0101);
    world.set_local_player_runtime_pose(accepted);
    assert!(
        movement
            .publish_position_after_simulation(now, &world, &mut session)
            .await
            .unwrap()
    );
    let deadline = now + super::super::position_publication::POSITION_HEARTBEAT_INTERVAL;
    assert!(
        movement
            .publish_position_after_simulation(deadline, &world, &mut session)
            .await
            .unwrap()
    );
    assert_eq!(session.game_action_sequence, 3);
    movement.retire_movement_epoch();
    assert!(
        movement
            .publish_position_after_simulation(deadline, &world, &mut session)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn position_publication_requires_a_valid_player_and_resets_after_absence() {
    let mut world = WorldState::synthetic();
    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let now = Instant::now();
    assert!(
        !movement
            .publish_position_after_simulation(now, &world, &mut session)
            .await
            .unwrap()
    );
    let guid = Guid(0x0102_0304);
    world.player.guid = guid;
    seed_local_player(
        &mut world,
        guid,
        WorldPosition {
            landblock_id: Guid(0x1000_0100),
            ..WorldPosition::default()
        },
    );
    assert!(
        movement
            .publish_position_after_simulation(now, &world, &mut session)
            .await
            .unwrap()
    );
    world.player.guid = Guid::NULL;
    assert!(
        !movement
            .publish_position_after_simulation(now, &world, &mut session)
            .await
            .unwrap()
    );
    world.player.guid = guid;
    assert!(
        movement
            .publish_position_after_simulation(now, &world, &mut session)
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn motion_packet_and_explicit_sync_share_the_routine_publication_baseline() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    world.player.guid = guid;
    seed_local_player(
        &mut world,
        guid,
        WorldPosition {
            landblock_id: Guid(0x1000_0100),
            ..WorldPosition::default()
        },
    );
    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let now = Instant::now();
    movement
        .execute_motion_state_at(
            CharacterDrive::builder().run().forward().build(),
            &mut world,
            &mut session,
            now,
        )
        .await
        .unwrap();
    assert_eq!(session.game_action_sequence, 1);
    assert!(
        !movement
            .publish_position_after_simulation(now, &world, &mut session)
            .await
            .unwrap()
    );
    let later = now + super::super::position_publication::POSITION_HEARTBEAT_INTERVAL;
    movement
        .send_autonomous_position_sync(
            later,
            &world,
            &mut session,
            MovementPacketMetadata::default(),
        )
        .await
        .unwrap();
    assert!(
        !movement
            .publish_position_after_simulation(later, &world, &mut session)
            .await
            .unwrap()
    );
    assert_eq!(session.game_action_sequence, 2);
}

#[test]
fn local_visual_intent_preserves_channels_and_ends_on_stop_or_expiry() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_3390);
    world.player.guid = guid;
    seed_local_player(
        &mut world,
        guid,
        WorldPosition {
            landblock_id: Guid(0x1000_0001),
            ..WorldPosition::default()
        },
    );
    seed_authored_manual_motion_world(&mut world, guid);
    let mut movement = MovementSystem::new();
    let now = Instant::now();
    for drive in [
        CharacterDrive::builder().run().forward().build(),
        CharacterDrive::builder()
            .walk()
            .backstep()
            .strafe_left()
            .turn_right()
            .build(),
    ] {
        install_manual_drive(&mut movement, drive, Some(now));
        let order = movement.local_locomotion_order(&world).unwrap().unwrap();
        let expected = crate::motion_order_for_drive(
            drive,
            world.player_run_rate().unwrap(),
            MotionCommand(MotionStance::NonCombat as u32),
        )
        .unwrap();
        assert_eq!(order, expected);
        movement.expire_active_movement(now);
        assert!(movement.local_locomotion_order(&world).unwrap().is_none());
    }
    movement.ingest_drive_intent(
        PlayerDriveIntent::ClientDirected(ClientDirectedCommand::Acquire(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: None,
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        })),
        now,
    );
    assert_eq!(
        movement
            .local_locomotion_order(&world)
            .unwrap()
            .unwrap()
            .forward
            .unwrap()
            .0,
        MotionCommand::RUN_FORWARD
    );
    movement.ingest_drive_intent(PlayerDriveIntent::Stop, now);
    assert!(movement.local_locomotion_order(&world).unwrap().is_none());
    install_manual_drive(&mut movement, CharacterDrive::default(), None);
    assert!(movement.local_locomotion_order(&world).unwrap().is_none());
}

#[test]
fn reset_and_drive_preserve_admission_order() {
    let now = Instant::now();
    let drive = CharacterDrive::builder().run().forward().build();
    for reset_first in [true, false] {
        let mut world = WorldState::synthetic();
        let mut movement = MovementSystem::new();
        let reset = QueuedControlCommand::CharacterMotion(SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(1),
            event: CharacterMotionEvent::Reset,
        });
        let drive = QueuedControlCommand::Drive(PlayerDriveIntent::ManualHeld(drive));
        movement.queued_control_commands.extend(if reset_first {
            [reset, drive]
        } else {
            [drive, reset]
        });
        movement.process_control_commands(now, &mut world);
        assert_eq!(movement.has_active_manual_drive(), reset_first);
        assert_eq!(
            movement.character_motion.effective_drive().is_stationary(),
            !reset_first
        );
    }
}

#[test]
fn jump_and_stop_preserve_admission_order() {
    let now = Instant::now();
    for stop_first in [true, false] {
        let mut world = WorldState::synthetic();
        let mut movement = MovementSystem::new();
        let jump = QueuedControlCommand::CharacterMotion(SequencedCharacterMotionEvent {
            sequence: CharacterMotionSequence(1),
            event: CharacterMotionEvent::BeginJump {
                drive: CharacterDrive::default(),
            },
        });
        let stop = QueuedControlCommand::Drive(PlayerDriveIntent::Stop);
        movement.queued_control_commands.extend(if stop_first {
            [stop, jump]
        } else {
            [jump, stop]
        });
        movement.process_control_commands(now, &mut world);
        assert_eq!(movement.has_active_manual_drive(), stop_first);
        assert_eq!(
            movement.character_motion.is_standing_long_jump(),
            stop_first
        );
    }
}

/// Receipt-time approach state; the target remains distant throughout cancellation tests.
fn test_server_approach(start: WorldPosition) -> ServerDirectedMotionState {
    let scalar = |value| OrderedMotionScalar::from_f32(value).unwrap();
    begin_server_directed_motion(
        EntityMotionDirective::MoveToPosition {
            admission: EntityMotionAdmission {
                object_instance_sequence: 1,
                movement_sequence: 1,
                server_control_sequence: 1,
                is_autonomous: false,
            },
            target: OrderedMotionPosition {
                cell_id: start.landblock_id,
                x: scalar(start.coords.x + 20.0),
                y: scalar(start.coords.y),
                z: scalar(start.coords.z),
            },
            params: EntityMoveToParameters {
                flags: 0x0000_0203,
                distance_to_object: scalar(1.0),
                min_distance: scalar(0.0),
                fail_distance: scalar(100.0),
                speed: scalar(1.0),
                walk_run_threshold: scalar(5.0),
                desired_heading_degrees: scalar(0.0),
            },
            run_rate: scalar(1.0),
        },
        start,
        None,
    )
}

#[tokio::test]
async fn server_approach_manual_takeover_bypasses_matching_publication_history() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        ..WorldPosition::default()
    };
    seed_local_player(&mut world, guid, pose);
    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let now = Instant::now();
    let drive = CharacterDrive::builder().run().forward().build();
    movement.note_drive_published(published_drive(drive, MotionStyle::PreserveServer));
    movement.admit_server_controlled_motion(Some(test_server_approach(pose)), now, &mut world);
    let before = session.packet_sequence;
    movement.enqueue_drive_intent(PlayerDriveIntent::ManualHeld(drive), now);
    movement.tick(now, &mut world, &mut session).await.unwrap();
    assert!(movement.has_active_manual_drive());
    assert!(!movement.has_server_controlled_motion());
    assert!(session.packet_sequence > before);
    assert!(!movement.movement_publication_required);
    let after = session.packet_sequence;
    movement.tick(now, &mut world, &mut session).await.unwrap();
    assert_eq!(session.packet_sequence, after);
}

#[tokio::test]
async fn server_only_approach_stop_publishes_cancellation() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        ..WorldPosition::default()
    };
    seed_local_player(&mut world, guid, pose);
    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let now = Instant::now();
    movement.admit_server_controlled_motion(Some(test_server_approach(pose)), now, &mut world);
    assert!(movement.published_motion.is_none());
    let before = session.packet_sequence;
    movement.enqueue_drive_intent(PlayerDriveIntent::Stop, now);
    movement.tick(now, &mut world, &mut session).await.unwrap();
    assert!(movement.active_movement.is_none());
    assert!(movement.pending_manual_playback_stop);
    assert!(session.packet_sequence > before);
    assert!(!movement.movement_publication_required);
}

#[test]
fn passive_input_preserves_server_approach() {
    let mut world = WorldState::synthetic();
    let mut movement = MovementSystem::new();
    let now = Instant::now();
    movement.admit_server_controlled_motion(
        Some(test_server_approach(WorldPosition::default())),
        now,
        &mut world,
    );
    movement.enqueue_drive_intent(
        PlayerDriveIntent::SynchronizeHeld(CharacterDrive::default()),
        now,
    );
    movement.enqueue_character_motion_event(SequencedCharacterMotionEvent {
        sequence: CharacterMotionSequence(1),
        event: CharacterMotionEvent::Reset,
    });
    movement.process_control_commands(now, &mut world);
    assert!(movement.has_server_controlled_motion());
    assert!(!movement.movement_publication_required);
    assert!(!movement.pending_manual_playback_stop);
}

#[test]
fn displaced_controller_cannot_steer_settle_or_release_the_new_source() {
    let now = Instant::now();
    let drive = AutonomousDriveIntent {
        desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
        desired_heading: None,
        target_hint: None,
        gait: Gait::Run,
        force_grounded: true,
    };
    for server_takes_control in [false, true] {
        let mut world = WorldState::synthetic();
        let mut movement = MovementSystem::new();
        movement.ingest_client_directed_command(ClientDirectedCommand::Acquire(drive));
        if server_takes_control {
            movement.admit_server_controlled_motion(
                Some(test_server_approach(WorldPosition::default())),
                now,
                &mut world,
            );
        } else {
            movement.ingest_drive_intent(
                PlayerDriveIntent::ManualHeld(CharacterDrive::builder().run().forward().build()),
                now,
            );
        }
        let selected = movement.active_movement;
        for command in [
            ClientDirectedCommand::Update(drive),
            ClientDirectedCommand::Settle {
                pose: Some(WorldPosition::default()),
            },
            ClientDirectedCommand::Release,
        ] {
            movement.ingest_client_directed_command(command);
            assert_eq!(movement.active_movement, selected);
            assert!(movement.pending_arrival_pose.is_none());
        }
    }
}

#[test]
fn controller_retains_ownership_without_repeating_displacement() {
    let now = Instant::now();
    let mut movement = MovementSystem::new();
    let drive = AutonomousDriveIntent {
        desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
        desired_heading: None,
        target_hint: None,
        gait: Gait::Run,
        force_grounded: true,
    };
    movement.ingest_client_directed_command(ClientDirectedCommand::Acquire(drive));
    movement.expire_active_movement(now);
    assert_eq!(
        movement.active_movement,
        Some(ActiveMovement::ClientDirected(None))
    );
    movement.ingest_client_directed_command(ClientDirectedCommand::Update(drive));
    assert_eq!(
        movement.active_movement,
        Some(ActiveMovement::ClientDirected(Some(drive)))
    );
    movement.ingest_client_directed_command(ClientDirectedCommand::Settle { pose: None });
    assert_eq!(
        movement.active_movement,
        Some(ActiveMovement::ClientDirected(None))
    );
    movement.ingest_client_directed_command(ClientDirectedCommand::Update(drive));
    assert_eq!(
        movement.active_movement,
        Some(ActiveMovement::ClientDirected(Some(drive)))
    );
}

/// Decode actual session output from the unencrypted, unfragmented packets this fixture emits.
fn captured_actions(file: &tempfile::NamedTempFile) -> Vec<GameAction> {
    let bytes = std::fs::read(file.path()).unwrap();
    let mut capture = Cursor::new(bytes.as_slice());
    let mut actions = Vec::new();
    while (capture.position() as usize) < bytes.len() {
        assert_eq!(
            capture.read_u8().unwrap(),
            holtburger_session::capture::Direction::Outbound as u8
        );
        capture.read_u64::<LittleEndian>().unwrap();
        let address_len = capture.read_u16::<LittleEndian>().unwrap();
        capture.set_position(capture.position() + u64::from(address_len));
        let packet_len = capture.read_u32::<LittleEndian>().unwrap();
        let mut packet = vec![0; packet_len as usize];
        capture.read_exact(&mut packet).unwrap();
        let mut offset = 0;
        let header = PacketHeader::unpack(&packet, &mut offset).unwrap();
        assert_eq!(header.flags, packet_flags::BLOB_FRAGMENTS);
        let fragment = FragmentHeader::unpack(&packet, &mut offset).unwrap();
        assert_eq!(fragment.count, 1);
        let GameMessage::GameAction(message) = GameMessage::unpack(&packet, &mut offset).unwrap()
        else {
            panic!("movement fixture emitted a non-action message");
        };
        assert_eq!(offset, packet.len());
        actions.push(message.action);
    }
    actions
}

#[tokio::test]
async fn approach_cancellation_packet_preserves_current_pose_and_authority_sequences() {
    for stop in [true, false] {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x0102_0304);
        let pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(12.0, 14.0, 3.0),
            rotation: Quaternion::identity(),
        };
        seed_local_player(&mut world, guid, pose);
        world.player.instance_sequence = 7;
        world.player.server_control_sequence = 11;
        world.player.teleport_sequence = 13;
        world.player.force_position_sequence = 17;
        let mut movement = MovementSystem::new();
        let mut session = Session::new_test();
        let capture = tempfile::NamedTempFile::new().unwrap();
        session
            .set_capture(capture.path().to_str().unwrap())
            .unwrap();
        let now = Instant::now();
        movement.admit_server_controlled_motion(Some(test_server_approach(pose)), now, &mut world);
        let drive = CharacterDrive::builder().walk().turn_left().build();
        movement.enqueue_drive_intent(
            if stop {
                PlayerDriveIntent::Stop
            } else {
                PlayerDriveIntent::ManualHeld(drive)
            },
            now,
        );
        movement.tick(now, &mut world, &mut session).await.unwrap();
        let actions = captured_actions(&capture);
        let GameAction::MoveToState(packet) = &actions[0] else {
            panic!("first takeover packet must be MoveToState");
        };
        assert_eq!(packet.position, pose);
        assert_eq!(packet.instance_sequence, world.player.instance_sequence);
        assert_eq!(
            packet.server_control_sequence,
            world.player.server_control_sequence
        );
        assert_eq!(packet.teleport_sequence, world.player.teleport_sequence);
        assert_eq!(
            packet.force_position_sequence,
            world.player.force_position_sequence
        );
        if stop {
            assert_eq!(packet.raw_motion_state.forward_command, None);
            assert_eq!(packet.raw_motion_state.turn_command, None);
        } else {
            assert!(packet.raw_motion_state.turn_command.is_some());
        }
    }
}

#[test]
fn stop_preserves_jump_sequence_history_until_epoch_retirement() {
    let now = Instant::now();
    let mut world = WorldState::synthetic();
    let mut movement = MovementSystem::new();
    let begin = SequencedCharacterMotionEvent {
        sequence: CharacterMotionSequence(4),
        event: CharacterMotionEvent::BeginJump {
            drive: CharacterDrive::default(),
        },
    };
    movement.enqueue_character_motion_event(begin);
    movement.enqueue_drive_intent(PlayerDriveIntent::Stop, now);
    movement.enqueue_character_motion_event(begin);
    movement.process_control_commands(now, &mut world);
    assert!(movement.active_movement.is_none());
    assert!(!movement.character_motion.is_charging());
    assert_eq!(movement.take_character_motion_feedback().len(), 1);
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ManualHeld(CharacterDrive::builder().run().forward().build()),
        now,
    );
    movement.retire_movement_epoch();
    movement.process_control_commands(now, &mut world);
    assert!(movement.active_movement.is_none());
    movement.enqueue_character_motion_event(begin);
    movement.process_control_commands(now, &mut world);
    assert!(movement.character_motion.is_charging());
}

#[test]
fn manual_acquisition_retires_pending_controller_arrival() {
    let now = Instant::now();
    let mut movement = MovementSystem::new();
    movement.ingest_client_directed_command(ClientDirectedCommand::AcquireFacing { heading: 1.0 });
    movement.ingest_client_directed_command(ClientDirectedCommand::Settle {
        pose: Some(WorldPosition::default()),
    });
    movement.ingest_drive_intent(
        PlayerDriveIntent::ManualHeld(CharacterDrive::builder().run().forward().build()),
        now,
    );
    assert!(movement.pending_arrival_pose.is_none());
    assert!(movement.pending_snap_facing.is_none());
    assert!(movement.has_active_manual_drive());
}
