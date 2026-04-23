use super::super::common::{
    AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL, RUN_HELD_TURN_SPEED_RAD_PER_SEC,
    TURN_LEFT_MOTION_COMMAND, TURN_RIGHT_MOTION_COMMAND, WALK_FORWARD_MOTION_COMMAND,
    build_autonomous_position, build_motion_state_raw_motion_state, player_run_rate_scalar,
    raw_motion_state_with_motion_style,
};
use super::*;
use crate::client::movement_types::Gait;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_protocol::messages::game_message::{RawMotionFlags, RawMotionState};
use holtburger_protocol::messages::movement::{HoldKey, MotionStance};
use holtburger_session::Session;
use holtburger_world::entity::Entity;
use holtburger_world::stats::{Attribute, AttributeType, Skill, SkillType, TrainingLevel};
use holtburger_world::{
    PlayerMotionTableSource, SelfMovementCapabilities, SelfMovementKinematics, WorldState,
};

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

fn seed_self_movement_capabilities_override(
    world: &mut WorldState,
    run_rate_scalar: f32,
    base_walk_speed: f32,
    base_run_speed: f32,
    turn_speed_rad_per_sec: f32,
) -> SelfMovementCapabilities {
    let capabilities = SelfMovementCapabilities {
        kinematics: SelfMovementKinematics {
            source: PlayerMotionTableSource::DirectProperty {
                motion_table_id: 0x0900_0020,
            },
            motion_table_id: 0x0900_0020,
            stance: MotionStance::NonCombat as u32,
            base_walk_forward_velocity: Vector3::new(base_walk_speed, 0.0, 0.0),
            base_run_forward_velocity: Vector3::new(base_run_speed, 0.0, 0.0),
            base_turn_left_omega: Vector3::new(0.0, 0.0, -turn_speed_rad_per_sec),
            base_turn_right_omega: Vector3::new(0.0, 0.0, turn_speed_rad_per_sec),
        },
        run_rate_scalar,
    };
    world.set_self_movement_capabilities_override(capabilities.clone());
    capabilities
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
    assert_eq!(state.locomotion, Some(Locomotion::Forward));
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
    assert_eq!(state.locomotion, None);
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
        PlayerDriveIntent::Autonomous(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 2.0, 3.0),
            desired_heading: Some(0.75),
            target_hint: Some(WorldPosition {
                landblock_id: Guid(0x1234_0100),
                coords: Vector3::new(5.0, 6.0, 7.0),
                rotation: Quaternion::identity(),
            }),
            gait: Gait::Run,
            force_grounded: true,
        }),
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
        PlayerDriveIntent::Autonomous(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: None,
            target_hint: None,
            gait: Gait::Walk,
            force_grounded: false,
        }),
        now,
    );
    movement.enqueue_drive_intent(
        PlayerDriveIntent::ManualHeld(MotionState::builder().run().forward().build()),
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
        movement.active_drive,
        Some(ActiveDriveState {
            intent: ActiveDriveIntent::Manual(MotionState {
                gait: Gait::Run,
                locomotion: Some(Locomotion::Forward),
                ..
            }),
            ..
        })
    ));
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
        MotionState::builder().run().forward().turn_right().build(),
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
    assert!(raw_motion_state.flags.contains(RawMotionFlags::TURN_SPEED));
    assert_eq!(
        raw_motion_state.turn_command,
        Some(TURN_RIGHT_MOTION_COMMAND)
    );
    assert_eq!(
        raw_motion_state.turn_speed,
        Some(RUN_HELD_TURN_SPEED_RAD_PER_SEC)
    );
}

#[test]
fn motion_state_raw_motion_state_uses_player_run_rate_scalar_for_forward_speed() {
    let mut world = WorldState::synthetic();
    let expected_run_rate_scalar = seed_player_run_rate_scalar(&mut world, 300);

    let raw_motion_state = build_motion_state_raw_motion_state(
        &world,
        MotionState::builder().run().forward().build(),
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
        MotionState::builder().run().forward().turn_left().build(),
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
    assert_eq!(
        raw_motion_state.turn_speed,
        Some(RUN_HELD_TURN_SPEED_RAD_PER_SEC)
    );
    assert_eq!(raw_motion_state.turn_hold_key, Some(HoldKey::Run as u32));
    assert!(
        raw_motion_state
            .flags
            .contains(RawMotionFlags::TURN_HOLD_KEY)
    );
}

#[test]
fn motion_state_raw_motion_state_omits_turn_when_not_requested() {
    let world = WorldState::synthetic();

    let raw_motion_state = build_motion_state_raw_motion_state(
        &world,
        MotionState::builder().run().forward().build(),
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
fn current_local_solve_body_input_uses_shared_resolved_manual_run_speed() {
    let mut world = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    world.player.guid = player_guid;
    let capabilities = seed_self_movement_capabilities_override(&mut world, 3.25, 1.0, 2.0, 1.25);
    let expected_local_run_speed = capabilities.resolved_manual_run_speed();
    let mut position = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(10.0, 20.0, 0.0),
        rotation: Quaternion::identity(),
    };
    seed_local_player(&mut world, player_guid, position);

    position.rotation = Quaternion::from_heading(90.0_f32.to_radians());
    let _ = world.set_player_position(position);

    let mut movement = MovementSystem::new();
    movement.active_drive = Some(ActiveDriveState::manual(
        MotionState::builder().run().forward().build(),
        None,
    ));

    let body = movement
        .current_local_solve_body_input(&world)
        .expect("active manual drive should produce local solve input");
    assert_eq!(body.body_id, SpatialBodyId::LocalPlayer(player_guid));
    assert!(matches!(
        body.basis,
        Some(holtburger_world::SolveProjectionBasis::Velocity { velocity, omega })
            if velocity.x.abs() < 1e-5
                && (velocity.y - expected_local_run_speed).abs() < 1e-5
                && omega == Vector3::zero()
    ));
}

#[test]
fn current_local_solve_body_input_uses_shared_turn_omega_for_turn_in_place() {
    let mut world = WorldState::synthetic();
    let player_guid = Guid(0x50000123);
    world.player.guid = player_guid;
    let capabilities = seed_self_movement_capabilities_override(&mut world, 3.25, 1.0, 2.0, 1.25);
    let position = WorldPosition {
        landblock_id: Guid(0x12340000),
        coords: Vector3::new(10.0, 20.0, 0.0),
        rotation: Quaternion::identity(),
    };
    seed_local_player(&mut world, player_guid, position);

    let mut movement = MovementSystem::new();
    movement.active_drive = Some(ActiveDriveState::manual(
        MotionState::builder().walk().turn_left().build(),
        None,
    ));

    let body = movement
        .current_local_solve_body_input(&world)
        .expect("turn-in-place manual drive should produce local solve input");
    assert!(matches!(
        body.basis,
        Some(holtburger_world::SolveProjectionBasis::Velocity { velocity, omega })
            if velocity.length_squared() <= 1e-6
                && omega == capabilities.kinematics().base_turn_left_omega
    ));
}

#[test]
fn current_local_solve_body_input_requires_authoritative_spawn_pose() {
    let mut world = WorldState::synthetic();
    world.player.guid = Guid(0x50000123);

    let movement = MovementSystem::new();

    assert!(movement.current_local_solve_body_input(&world).is_none());
}

#[test]
fn stop_pulse_is_still_required_when_server_motion_is_active() {
    let mut movement = MovementSystem::new();
    movement.note_server_motion_sent(server_motion_intent(
        MotionState::builder().run().forward().turn_right().build(),
        MotionStyle::PreserveServer,
    ));

    assert!(movement.should_send_stop_pulse());
}

#[test]
fn note_server_motion_cleared_resets_drive_tracking() {
    let mut movement = MovementSystem::new();
    movement.note_server_motion_sent(server_motion_intent(
        MotionState::builder().run().forward().turn_right().build(),
        MotionStyle::PreserveServer,
    ));

    movement.note_server_motion_cleared();

    assert!(!movement.server_motion_active);
    assert!(movement.last_server_motion_intent.is_none());
}

#[test]
fn unchanged_motion_intent_does_not_require_server_refresh() {
    let mut movement = MovementSystem::new();
    movement.note_server_motion_sent(server_motion_intent(
        MotionState::builder().run().forward().turn_right().build(),
        MotionStyle::PreserveServer,
    ));

    assert!(!movement.should_send_motion_state_pulse(
        MotionState::builder().run().forward().turn_right().build(),
        MotionStyle::PreserveServer,
    ));
}

#[test]
fn autonomous_position_heartbeat_defaults_to_grounded_when_contact_unknown() {
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

    let position_action = build_autonomous_position(&world, MovementPacketMetadata::default())
        .expect("moving player should emit autonomous position action");

    assert_eq!(position_action.position, position);
    assert_eq!(position_action.instance_sequence, 11);
    assert_eq!(position_action.server_control_sequence, 22);
    assert_eq!(position_action.teleport_sequence, 33);
    assert_eq!(position_action.force_position_sequence, 44);
    assert_eq!(position_action.last_contact, 1);
}

#[test]
fn autonomous_position_uses_server_grounded_when_contact_unspecified() {
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
    world.player.last_server_grounded = Some(true);
    seed_local_player(&mut world, guid, position);
    world.entities.insert(entity);

    let position_action = build_autonomous_position(&world, MovementPacketMetadata::default())
        .expect("moving player should emit autonomous position action");

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
    world.entities.insert(entity);

    let position_action = build_autonomous_position(&world, MovementPacketMetadata::default())
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

    let position_action = build_autonomous_position(&world, MovementPacketMetadata::default())
        .expect("autonomous position action should emit even when stationary");

    assert_eq!(position_action.position, position);
    assert_eq!(position_action.instance_sequence, 11);
    assert_eq!(position_action.server_control_sequence, 22);
    assert_eq!(position_action.teleport_sequence, 33);
    assert_eq!(position_action.force_position_sequence, 44);
}

#[tokio::test]
async fn stop_after_active_drive_sends_stop_pulse_then_final_position_sync() {
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
            MotionState::builder().run().forward().build(),
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
async fn stop_without_active_drive_does_not_send_final_position_sync() {
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
    movement.note_server_motion_sent(server_motion_intent(
        MotionState::builder().run().forward().turn_right().build(),
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
    let state = MotionState::builder().run().forward().turn_right().build();

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
async fn held_run_input_ticks_once_for_wire_and_keeps_local_vectors_consistent() {
    let mut world = WorldState::synthetic();
    seed_self_movement_capabilities_override(&mut world, 2.25, 1.0, 2.0, 1.5);
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
        PlayerDriveIntent::ManualHeld(MotionState::builder().run().forward().build()),
        start,
    );

    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("held run input should start moving");

    let player = movement
        .current_local_solve_body_input(&world)
        .expect("held run input should produce local solve input");
    assert!(matches!(
        player.basis,
        Some(holtburger_world::SolveProjectionBasis::Velocity { velocity, .. })
            if velocity.x.abs() < 1e-5 && (velocity.y - 4.5).abs() < 1e-5
    ));
    assert_eq!(session.packet_sequence, 2);

    movement
        .tick(start + Duration::from_millis(30), &mut world, &mut session)
        .await
        .expect("steady held run should not resend unchanged motion intent");

    let player = movement
        .current_local_solve_body_input(&world)
        .expect("steady held run should keep solve input active");
    assert!(matches!(
        player.basis,
        Some(holtburger_world::SolveProjectionBasis::Velocity { velocity, .. })
            if velocity.x.abs() < 1e-5 && (velocity.y - 4.5).abs() < 1e-5
    ));
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
            state: MotionState::builder().run().forward().build(),
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

#[tokio::test]
async fn server_controlled_movement_suppresses_next_frontend_autonomous_wire_pulse() {
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
    let now = Instant::now();

    movement.note_server_controlled_movement_started();
    movement.enqueue_drive_intent(
        PlayerDriveIntent::Autonomous(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: Some(0.0),
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        }),
        now,
    );

    movement
        .tick(now, &mut world, &mut session)
        .await
        .expect("server-controlled suppression tick should succeed");

    assert!(movement.active_drive.is_none());
    assert!(!movement.server_motion_active);
}

#[test]
fn server_controlled_projection_uses_landblock_aware_global_delta() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let current_pose = WorldPosition {
        landblock_id: Guid(0x1234_0001),
        coords: Vector3::new(191.0, 64.0, 0.0),
        rotation: Quaternion::from_heading(0.0),
    };
    let target_pose = WorldPosition {
        landblock_id: Guid(0x1334_0001),
        coords: Vector3::new(1.0, 64.0, 0.0),
        rotation: Quaternion::from_heading(0.0),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, current_pose);

    let mut movement = MovementSystem::new();
    movement.set_server_controlled_projection(ServerControlledProjection {
        target_pose,
        speed_mps: 2.0,
    });

    let drive = movement
        .current_local_drive_control(&world, Duration::from_secs(1))
        .expect("server-controlled projection should expose a local drive");

    assert_eq!(drive.desired_world_delta, Vector3::new(2.0, 0.0, 0.0));
    assert_eq!(
        drive.desired_heading,
        Some(current_pose.heading_to(&target_pose))
    );
    assert_eq!(drive.target_hint, Some(target_pose));
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
        PlayerDriveIntent::ManualHeld(MotionState::builder().run().forward().build()),
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
        PlayerDriveIntent::Autonomous(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: None,
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        }),
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
        PlayerDriveIntent::Autonomous(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: None,
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        }),
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

    movement.enqueue_drive_intent(PlayerDriveIntent::Autonomous(autonomous_intent), start);
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("autonomous drive should emit a locomotion pulse");

    assert_eq!(session.game_action_sequence, 1);

    movement.enqueue_drive_intent(
        PlayerDriveIntent::Autonomous(autonomous_intent),
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
    assert!(movement.server_motion_active);
    assert!(movement.last_server_motion_intent.is_none());

    assert_eq!(session.game_action_sequence, 2);

    movement.enqueue_drive_intent(
        PlayerDriveIntent::Autonomous(autonomous_intent),
        start + Duration::from_millis(60),
    );
    movement
        .tick(start + Duration::from_millis(60), &mut world, &mut session)
        .await
        .expect("locomotion should be reasserted after the transient motion clears");

    assert_eq!(
        movement.last_server_motion_intent,
        MovementSystem::autonomous_wire_motion_state(&world, autonomous_intent)
            .map(|state| server_motion_intent(state, MotionStyle::PreserveServer))
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
    let state = MotionState::builder().run().forward().build();

    movement.enqueue_drive_intent(PlayerDriveIntent::ManualHeld(state), start);
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("manual locomotion should update server motion tracking");

    assert!(movement.server_motion_active);
    assert_eq!(
        movement.last_server_motion_intent,
        Some(server_motion_intent(state, MotionStyle::PreserveServer))
    );
}

#[tokio::test]
async fn server_controlled_projection_becomes_current_local_drive_control() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_2304);
    let current_pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(0.0),
    };
    let target_pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(16.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(0.0),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, current_pose);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();

    movement.set_server_controlled_projection(ServerControlledProjection {
        target_pose,
        speed_mps: 2.0,
    });
    movement.note_server_controlled_movement_started();
    movement.enqueue_drive_intent(
        PlayerDriveIntent::Autonomous(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: Some(0.0),
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        }),
        start,
    );

    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("server-controlled tick should expose a projected local drive");

    assert_eq!(
        movement.current_local_drive_control(&world, Duration::from_secs(1)),
        Some(LocalDriveControl {
            body_id: SpatialBodyId::LocalPlayer(guid),
            desired_world_delta: Vector3::new(2.0, 0.0, 0.0),
            desired_heading: Some(current_pose.heading_to(&target_pose)),
            target_hint: Some(target_pose),
            gait: holtburger_world::spatial::LocalDriveGait::Run,
            force_grounded: true,
        })
    );
    assert!(!movement.server_motion_active);
}

#[tokio::test]
async fn clearing_server_controlled_projection_reasserts_autonomous_motion_intent() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_3304);
    let current_pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(0.0),
    };
    let target_pose = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(16.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(0.0),
    };

    world.player.guid = guid;
    seed_local_player(&mut world, guid, current_pose);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();
    let autonomous_intent = AutonomousDriveIntent {
        desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
        desired_heading: Some(0.0),
        target_hint: None,
        gait: Gait::Run,
        force_grounded: true,
    };

    movement.set_server_controlled_projection(ServerControlledProjection {
        target_pose,
        speed_mps: 2.0,
    });
    movement.note_server_controlled_movement_started();
    movement.enqueue_drive_intent(PlayerDriveIntent::Autonomous(autonomous_intent), start);
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("server-controlled takeover should succeed");

    movement.clear_server_controlled_projection();
    movement.enqueue_drive_intent(
        PlayerDriveIntent::Autonomous(autonomous_intent),
        start + Duration::from_millis(30),
    );
    movement
        .tick(start + Duration::from_millis(30), &mut world, &mut session)
        .await
        .expect("autonomous handoff should restore locomotion emission");

    assert_eq!(
        movement.last_server_motion_intent,
        MovementSystem::autonomous_wire_motion_state(&world, autonomous_intent)
            .map(|state| server_motion_intent(state, MotionStyle::PreserveServer))
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
        PlayerDriveIntent::Autonomous(AutonomousDriveIntent {
            desired_world_delta: Vector3::new(1.0, 0.0, 0.0),
            desired_heading: None,
            target_hint: None,
            gait: Gait::Run,
            force_grounded: true,
        }),
        start,
    );
    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("autonomous drive should emit a motion pulse");

    movement.enqueue_drive_intent(
        PlayerDriveIntent::ArriveAtPose { pose: arrival_pose },
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
async fn movement_heartbeat_arms_then_sends_for_stationary_player_with_valid_pose() {
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
    let now = Instant::now();

    let sent = movement
        .maybe_send_autonomous_position_heartbeat(
            now,
            &world,
            &mut session,
            MovementPacketMetadata::default(),
        )
        .await
        .expect("movement heartbeat should arm successfully");

    assert!(!sent);
    assert_eq!(session.game_action_sequence, 0);

    let sent = movement
        .maybe_send_autonomous_position_heartbeat(
            now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL + Duration::from_millis(1),
            &world,
            &mut session,
            MovementPacketMetadata::default(),
        )
        .await
        .expect("movement heartbeat should send once armed");

    assert!(sent);
    assert_eq!(session.game_action_sequence, 1);
    assert!(session.bytes_out > 0);
}

#[tokio::test]
async fn movement_heartbeat_skips_players_without_valid_runtime_pose() {
    let world = WorldState::synthetic();
    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();

    let sent = movement
        .maybe_send_autonomous_position_heartbeat(
            Instant::now(),
            &world,
            &mut session,
            MovementPacketMetadata::default(),
        )
        .await
        .expect("stationary heartbeat check should succeed");

    assert!(!sent);
    assert_eq!(session.game_action_sequence, 0);
    assert!(movement.next_autonomous_position_heartbeat_at.is_none());
}

#[tokio::test]
async fn armed_movement_heartbeat_stays_armed_when_player_stops_moving() {
    let mut world = WorldState::synthetic();
    let guid = Guid(0x0102_0304);
    let position = WorldPosition {
        landblock_id: Guid(0x1000_0001),
        coords: Vector3::new(12.0, -4.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };
    let mut entity = Entity::new(guid, "Player".to_string(), position);
    entity.velocity = Vector3::new(1.0, 0.0, 0.0);

    world.player.guid = guid;
    seed_local_player(&mut world, guid, position);
    world.entities.insert(entity);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let now = Instant::now();

    let sent = movement
        .maybe_send_autonomous_position_heartbeat(
            now,
            &world,
            &mut session,
            MovementPacketMetadata::default(),
        )
        .await
        .expect("moving heartbeat check should arm successfully");

    assert!(!sent);
    assert!(movement.next_autonomous_position_heartbeat_at.is_some());

    let stationary_entity = world
        .entities
        .get_mut(guid)
        .expect("synthetic player entity should exist");
    stationary_entity.velocity = Vector3::zero();
    stationary_entity.omega = Vector3::zero();

    let sent = movement
        .maybe_send_autonomous_position_heartbeat(
            now + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL + Duration::from_millis(1),
            &world,
            &mut session,
            MovementPacketMetadata::default(),
        )
        .await
        .expect("armed heartbeat should send one final stationary sync");

    assert!(sent);
    assert_eq!(session.game_action_sequence, 1);
    assert!(movement.next_autonomous_position_heartbeat_at.is_some());
}

#[tokio::test]
async fn movement_tick_emits_autonomous_position_heartbeat_when_due() {
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
    seed_local_player(&mut world, guid, position);
    world.entities.insert(entity);

    let mut movement = MovementSystem::new();
    let mut session = Session::new_test();
    let start = Instant::now();

    movement
        .tick(start, &mut world, &mut session)
        .await
        .expect("first movement tick should arm the heartbeat");

    assert_eq!(session.game_action_sequence, 0);

    movement
        .tick(
            start + AUTONOMOUS_POSITION_HEARTBEAT_INTERVAL + Duration::from_millis(1),
            &mut world,
            &mut session,
        )
        .await
        .expect("second movement tick should emit the heartbeat");

    assert_eq!(session.game_action_sequence, 1);
}

#[tokio::test]
async fn stop_without_active_drive_keeps_autonomous_position_heartbeat_armed() {
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
    let now = Instant::now();
    movement.note_server_motion_sent(server_motion_intent(
        MotionState::builder().run().forward().turn_right().build(),
        MotionStyle::PreserveServer,
    ));
    movement.refresh_autonomous_position_heartbeat_schedule(now, &world);

    movement
        .execute_stop_at(
            now,
            &mut world,
            &mut session,
            MovementPacketMetadata::default(),
            false,
        )
        .await
        .expect("stop request should succeed");

    assert!(movement.next_autonomous_position_heartbeat_at.is_some());
}
