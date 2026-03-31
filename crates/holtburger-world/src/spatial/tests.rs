use super::*;
use crate::entity::{EntityMotionDirective, EntityMotionSnapshot};
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_common::position::WorldPosition;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use holtburger_protocol::messages::movement::MotionStance;
use std::f32::consts::{PI, TAU};
use std::time::{Duration, Instant};

fn make_position(x: f32, y: f32, heading_rad: f32) -> WorldPosition {
    WorldPosition {
        landblock_id: Guid(0x0102_0000),
        coords: Vector3::new(x, y, 0.0),
        rotation: Quaternion::from_heading(heading_rad),
    }
}

#[test]
fn test_spatial_neighbors() {
    let mut scene = SpatialScene::new();
    let guid_a = Guid(0x11223344);
    let guid_b = Guid(0x55667788);

    let lb_a = (10 << 24) | (10 << 16) | 0xFFFF;
    let lb_b = (11 << 24) | (10 << 16) | 0xFFFF;

    scene.update_entity(
        guid_a,
        Guid(lb_a),
        WorldPosition {
            landblock_id: Guid(lb_a),
            ..Default::default()
        },
    );
    scene.update_entity(
        guid_b,
        Guid(lb_b),
        WorldPosition {
            landblock_id: Guid(lb_b),
            ..Default::default()
        },
    );

    let nearby_a = scene.get_nearby_entities(Guid(lb_a));
    assert!(nearby_a.contains(&guid_a));
    assert!(
        nearby_a.contains(&guid_b),
        "Should find neighbor in adjacent landblock"
    );

    let lb_far = (50 << 24) | (50 << 16) | 0xFFFF;
    let nearby_far = scene.get_nearby_entities(Guid(lb_far));
    assert!(nearby_far.is_empty());
}

#[test]
fn get_entities_in_range_uses_pose_index() {
    let mut scene = SpatialScene::new();
    let center_guid = Guid(0x1000_0001);
    let near_guid = Guid(0x1000_0002);
    let far_guid = Guid(0x1000_0003);
    let landblock = Guid(0x0A0A_FFFF);
    let center = WorldPosition {
        landblock_id: landblock,
        coords: Vector3::new(10.0, 10.0, 0.0),
        ..Default::default()
    };

    scene.update_entity(center_guid, landblock, center);
    scene.update_entity(
        near_guid,
        landblock,
        WorldPosition {
            landblock_id: landblock,
            coords: Vector3::new(13.0, 14.0, 0.0),
            ..Default::default()
        },
    );
    scene.update_entity(
        far_guid,
        landblock,
        WorldPosition {
            landblock_id: landblock,
            coords: Vector3::new(40.0, 40.0, 0.0),
            ..Default::default()
        },
    );

    let in_range = scene.get_entities_in_range(&center, 6.0);

    assert!(in_range.contains(&center_guid));
    assert!(in_range.contains(&near_guid));
    assert!(!in_range.contains(&far_guid));
}

#[test]
fn project_pose_by_velocity_keeps_indoor_landblock_stable() {
    let authoritative = WorldPosition {
        landblock_id: Guid(0x016C_0155),
        coords: Vector3::new(12.108355, -60.660404, 0.004999995),
        rotation: Quaternion::identity(),
    };

    let projected = project_pose_by_velocity(
        authoritative,
        Vector3::new(8.345838, 15.9404335, 0.0),
        1.0,
    );

    assert_eq!(projected.landblock_id, authoritative.landblock_id);
    assert_eq!(
        projected.coords,
        Vector3::new(20.454193, -44.71997, 0.004999995)
    );
}

#[test]
fn advance_actor_kinematics_rotates_velocity_with_turn_rate() {
    let input = SolveActorInput {
        actor_id: Guid(0x5000_0001),
        pose: WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::zero(),
            rotation: Quaternion::from_heading(90.0f32.to_radians()),
        },
        velocity: Vector3::new(0.0, 18.0, 0.0),
        omega: Vector3::new(0.0, 0.0, 90.0f32.to_radians()),
    };

    let solved = advance_actor_kinematics(&input, Duration::from_secs(1));

    assert!((solved.pose.rotation.to_heading().to_degrees() - 180.0).abs() < 1e-4);
    assert!((solved.velocity.x - 18.0).abs() < 1e-4);
    assert!(solved.velocity.y.abs() < 1e-4);
    assert!((solved.pose.coords.x - 18.0).abs() < 1e-4);
    assert!(solved.pose.coords.y.abs() < 1e-4);
    assert_eq!(solved.contact, ContactState::Unknown);
}

#[test]
fn spatial_scene_tracks_body_registration_update_and_removal() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let body_id = SpatialBodyId::Entity(Guid(0x7000_0001));
    let initial_pose = WorldPosition {
        landblock_id: Guid(0x1234_0000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        ..Default::default()
    };

    let body = SpatialBody::new(body_id, initial_pose, now);
    assert!(scene.register_body(body.clone()).is_none());

    let stored = scene.body(body_id).expect("body should be registered");
    assert_eq!(stored.pose, initial_pose);
    assert_eq!(stored.authoritative_pose, Some(initial_pose));
    assert_eq!(stored.sampling.mode, SpatialSampleMode::AuthoritativeOnly);

    let mut updated = body;
    updated.pose.coords = Vector3::new(4.0, 5.0, 6.0);
    updated.velocity = Vector3::new(7.0, 8.0, 0.0);
    updated.sampling.mode = SpatialSampleMode::SimulatingVelocity;

    let previous = scene
        .update_body(updated.clone())
        .expect("registered body should update");
    assert_eq!(previous.pose, initial_pose);

    let stored = scene.body(body_id).expect("updated body should remain present");
    assert_eq!(stored.pose.coords, Vector3::new(4.0, 5.0, 6.0));
    assert_eq!(stored.velocity, Vector3::new(7.0, 8.0, 0.0));
    assert_eq!(stored.sampling.mode, SpatialSampleMode::SimulatingVelocity);

    let removed = scene
        .remove_body(body_id)
        .expect("registered body should remove cleanly");
    assert_eq!(removed, updated);
    assert!(scene.body(body_id).is_none());
}

#[test]
fn spatial_scene_allocates_ephemeral_bodies_monotonically() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let pose = WorldPosition {
        landblock_id: Guid(0x4321_0000),
        coords: Vector3::new(9.0, 8.0, 7.0),
        ..Default::default()
    };

    let first = scene.register_ephemeral_body(pose, now);
    let second = scene.register_ephemeral_body(pose, now);

    assert_eq!(first, SpatialBodyId::Ephemeral(1));
    assert_eq!(second, SpatialBodyId::Ephemeral(2));
    assert_eq!(scene.body(first).and_then(|body| body.authoritative_pose), None);
    assert_eq!(scene.body(second).map(|body| body.pose), Some(pose));
}

#[test]
fn body_solver_bridge_supports_guid_backed_inputs_and_rejects_ephemeral_events() {
    let pose = WorldPosition {
        landblock_id: Guid(0x9876_0000),
        coords: Vector3::new(1.0, 1.0, 1.0),
        ..Default::default()
    };

    let entity_body_input = SolveBodyInput {
        body_id: SpatialBodyId::Entity(Guid(0x7000_0001)),
        pose,
        velocity: Vector3::new(2.0, 0.0, 0.0),
        omega: Vector3::new(0.0, 0.0, 3.0),
    };

    let entity_actor_input = entity_body_input
        .into_actor_input()
        .expect("entity body should bridge to Guid-backed actor input");
    assert_eq!(SolveBodyInput::from_actor_input(entity_actor_input), entity_body_input);

    let body_input = SolveBodyInput {
        body_id: SpatialBodyId::LocalPlayer(Guid(0x7000_0002)),
        pose,
        velocity: Vector3::new(2.0, 0.0, 0.0),
        omega: Vector3::new(0.0, 0.0, 3.0),
    };

    let actor_input = body_input
        .into_actor_input()
        .expect("local player should bridge to Guid-backed actor input");
    assert_eq!(actor_input.actor_id, Guid(0x7000_0002));
    assert_eq!(
        SolveBodyInput::from_actor_input(actor_input).body_id,
        SpatialBodyId::Entity(Guid(0x7000_0002))
    );

    let event = SpatialBodyEvent::ForcedReposition {
        body_id: SpatialBodyId::Ephemeral(99),
        pose,
    };
    assert!(event.into_spatial_event().is_none());
}

#[test]
fn reconcile_authoritative_body_resets_sampling_on_forced_reposition() {
    let mut scene = SpatialScene::new();
    let body_id = SpatialBodyId::Entity(Guid(0x7000_0010));
    let start = Instant::now();
    let start_pose = WorldPosition {
        landblock_id: Guid(0x1111_0000),
        coords: Vector3::new(1.0, 2.0, 3.0),
        ..Default::default()
    };
    let reset_pose = WorldPosition {
        landblock_id: Guid(0x2222_0000),
        coords: Vector3::new(9.0, 8.0, 7.0),
        ..Default::default()
    };

    scene.register_body(SpatialBody::new(body_id, start_pose, start));
    scene.reconcile_authoritative_body(
        body_id,
        reset_pose,
        Vector3::new(4.0, 5.0, 6.0),
        Vector3::new(0.0, 0.0, 1.0),
        AuthoritativeBodySync::Reset,
        start + Duration::from_secs(1),
    );

    let body = scene.body(body_id).expect("body should exist after reconcile");
    assert_eq!(body.authoritative_pose, Some(reset_pose));
    assert_eq!(body.pose, reset_pose);
    assert_eq!(body.velocity, Vector3::new(4.0, 5.0, 6.0));
    assert_eq!(body.omega, Vector3::new(0.0, 0.0, 1.0));
    assert_eq!(body.motion_state, None);
    assert_eq!(body.sampling.mode, SpatialSampleMode::Suspended);
    assert_eq!(body.sampling.last_derived_at, start + Duration::from_secs(1));
    assert_eq!(body.sampling.interpolation, None);
}

#[test]
fn spatial_scene_interpolates_authoritative_corrections() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0001);
    let start_pose = WorldPosition {
        landblock_id: Guid(0x0102_0000),
        coords: Vector3::new(0.0, 0.0, 0.0),
        rotation: Quaternion::from_heading(0.0),
    };
    let target_pose = WorldPosition {
        landblock_id: Guid(0x0102_0000),
        coords: Vector3::new(2.0, 0.0, 0.0),
        rotation: Quaternion::from_heading(0.5),
    };

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        start_pose,
        Vector3::zero(),
        Vector3::zero(),
        None,
        now,
    );
    scene.update_authoritative_body_pose(SpatialBodyId::Entity(guid), target_pose, false, now);
    scene.tick_runtime_bodies(now + Duration::from_millis(75));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::InterpolatingPosition);
    assert!((projected.projected_pose.coords.x - 1.0).abs() < 1e-4);
    assert!((projected.projected_pose.rotation.to_heading() - 0.25).abs() < 1e-4);
}

#[test]
fn spatial_scene_dead_reckons_and_turns_from_motion_state() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0002);
    let pose = WorldPosition {
        landblock_id: Guid(0x0102_0000),
        coords: Vector3::new(10.0, 20.0, 0.0),
        rotation: Quaternion::from_heading(0.0),
    };

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        pose,
        Vector3::new(2.0, 0.0, 0.0),
        Vector3::zero(),
        Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            turn_speed: Some(
                crate::entity::OrderedMotionSpeed::from_f32(1.0)
                    .expect("speed should encode"),
            ),
            ..Default::default()
        }),
        now,
    );
    scene.tick_runtime_bodies(now + Duration::from_millis(250));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
    assert!((projected.projected_pose.coords.x - 10.5).abs() < 1e-4);
    assert!((projected.projected_pose.rotation.to_heading() - 0.25).abs() < 1e-4);
}

#[test]
fn spatial_scene_projects_forward_motion_state_without_velocity() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0002);

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        make_position(10.0, 20.0, PI),
        Vector3::zero(),
        Vector3::zero(),
        Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
            forward_speed: Some(
                crate::entity::OrderedMotionSpeed::from_f32(4.5)
                    .expect("speed should encode"),
            ),
            ..Default::default()
        }),
        now,
    );

    scene.tick_runtime_bodies(now + Duration::from_secs(1));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
    assert!((projected.projected_pose.coords.x - 14.5).abs() < 1e-4);
    assert!((projected.projected_pose.coords.y - 20.0).abs() < 1e-4);
}

#[test]
fn spatial_scene_preserves_projected_translation_across_turn_only_update() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0102);

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        make_position(10.0, 20.0, PI),
        Vector3::zero(),
        Vector3::zero(),
        Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
            forward_speed: Some(
                crate::entity::OrderedMotionSpeed::from_f32(4.5)
                    .expect("speed should encode"),
            ),
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            turn_speed: Some(
                crate::entity::OrderedMotionSpeed::from_f32(1.0)
                    .expect("speed should encode"),
            ),
            ..Default::default()
        }),
        now,
    );

    let projected_at_run = now + Duration::from_millis(800);
    scene.tick_runtime_bodies(projected_at_run);
    let projected_before_turn_only = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert!(projected_before_turn_only.projected_pose.coords.x > 13.0);

    scene.update_runtime_body_motion_state(
        SpatialBodyId::Entity(guid),
        Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            turn_speed: Some(
                crate::entity::OrderedMotionSpeed::from_f32(1.0)
                    .expect("speed should encode"),
            ),
            ..Default::default()
        }),
    );

    scene.tick_runtime_bodies(projected_at_run + Duration::from_millis(30));

    let projected_after_turn_only = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(
        projected_after_turn_only.projection_mode,
        SpatialSampleMode::SimulatingMotionState
    );
    assert!(
        projected_after_turn_only.projected_pose.coords.x > 13.0,
        "turn-only updates should not snap projected translation back to authority"
    );
    assert!(
        projected_after_turn_only.projected_pose.coords.x
            >= projected_before_turn_only.projected_pose.coords.x - 0.2
    );
    assert!(
        projected_after_turn_only.projected_pose.rotation.to_heading()
            > projected_before_turn_only.projected_pose.rotation.to_heading()
    );
}

#[test]
fn spatial_scene_velocity_updates_drive_dead_reckoning_between_authoritative_moves() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0003);

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        make_position(10.0, 20.0, 0.0),
        Vector3::zero(),
        Vector3::zero(),
        None,
        now,
    );
    scene.set_body_kinematics(
        SpatialBodyId::Entity(guid),
        Vector3::new(2.0, 0.0, 0.0),
        Vector3::zero(),
    );

    scene.tick_runtime_bodies(now + Duration::from_millis(250));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingVelocity);
    assert!((projected.projected_pose.coords.x - 10.5).abs() < 1e-4);
}

#[test]
fn spatial_scene_velocity_dead_reckoning_crosses_landblock_boundaries_in_global_space() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0004);

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        WorldPosition {
            landblock_id: Guid(0x0102_0000),
            coords: Vector3::new(191.8, 20.0, 0.0),
            rotation: Quaternion::identity(),
        },
        Vector3::zero(),
        Vector3::zero(),
        None,
        now,
    );
    scene.set_body_kinematics(
        SpatialBodyId::Entity(guid),
        Vector3::new(2.0, 0.0, 0.0),
        Vector3::zero(),
    );

    scene.tick_runtime_bodies(now + Duration::from_millis(250));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingVelocity);
    assert_eq!(projected.projected_pose.landblock_id, Guid(0x0202_0000));
    assert!((projected.projected_pose.coords.x - 0.3).abs() < 1e-4);
    assert!((projected.projected_pose.coords.y - 20.0).abs() < 1e-4);
}

#[test]
fn spatial_scene_continuous_turn_commands_advance_heading_over_time() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0005);

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        make_position(0.0, 0.0, 0.0),
        Vector3::zero(),
        Vector3::zero(),
        Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            turn_speed: Some(
                crate::entity::OrderedMotionSpeed::from_f32(1.0)
                    .expect("speed should encode"),
            ),
            ..Default::default()
        }),
        now,
    );

    scene.tick_runtime_bodies(now + Duration::from_secs(1));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
    assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);
}

#[test]
fn spatial_scene_negative_turn_speed_rotates_left_from_canonical_turn_command() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0007);

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        make_position(0.0, 0.0, 0.0),
        Vector3::zero(),
        Vector3::zero(),
        Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            turn_speed: Some(
                crate::entity::OrderedMotionSpeed::from_f32(-1.0)
                    .expect("speed should encode"),
            ),
            ..Default::default()
        }),
        now,
    );

    scene.tick_runtime_bodies(now + Duration::from_secs(1));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
    assert!(
        (projected.projected_pose.rotation.to_heading() - (TAU - 1.0).rem_euclid(TAU)).abs()
            < 1e-4
    );
}

#[test]
fn spatial_scene_turn_to_heading_rotates_toward_target_without_snapping() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0006);

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        make_position(0.0, 0.0, 0.0),
        Vector3::zero(),
        Vector3::zero(),
        Some(EntityMotionSnapshot {
            directive: Some(EntityMotionDirective::TurnToHeading {
                desired_heading: crate::entity::OrderedMotionSpeed::from_f32(2.0)
                    .expect("heading should encode"),
                speed: crate::entity::OrderedMotionSpeed::from_f32(1.0)
                    .expect("speed should encode"),
            }),
            ..Default::default()
        }),
        now,
    );

    scene.tick_runtime_bodies(now + Duration::from_secs(1));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
    assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);
}

#[test]
fn spatial_scene_completed_turn_keeps_authoritative_directive_visible() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x7100_0007);
    let directive = EntityMotionDirective::TurnToHeading {
        desired_heading: crate::entity::OrderedMotionSpeed::from_f32(1.0)
            .expect("heading should encode"),
        speed: crate::entity::OrderedMotionSpeed::from_f32(1.0)
            .expect("speed should encode"),
    };

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        make_position(0.0, 0.0, 0.0),
        Vector3::zero(),
        Vector3::zero(),
        Some(EntityMotionSnapshot {
            directive: Some(directive),
            ..Default::default()
        }),
        now,
    );

    scene.tick_runtime_bodies(now + Duration::from_secs(1));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(
        projected.motion_state.and_then(|snapshot| snapshot.directive),
        Some(directive)
    );
    assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);

    scene.tick_runtime_bodies(now + Duration::from_secs(2));

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(
        projected.motion_state.and_then(|snapshot| snapshot.directive),
        Some(directive)
    );
    assert_eq!(projected.projection_mode, SpatialSampleMode::SimulatingMotionState);
    assert!((projected.projected_pose.rotation.to_heading() - 1.0).abs() < 1e-4);
}

#[test]
fn spatial_scene_large_authoritative_corrections_snap_instead_of_interpolating() {
    let mut scene = SpatialScene::new();
    scene.set_runtime_sampling_config(SpatialSamplingConfig {
        snap_distance_m: 1,
        ..SpatialSamplingConfig::default()
    });
    let now = Instant::now();
    let guid = Guid(0x7100_0008);

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        make_position(0.0, 0.0, 0.0),
        Vector3::zero(),
        Vector3::zero(),
        None,
        now,
    );
    scene.update_authoritative_body_pose(
        SpatialBodyId::Entity(guid),
        make_position(10.0, 0.0, 0.0),
        false,
        now,
    );

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::AuthoritativeOnly);
    assert_eq!(projected.projected_pose.coords.x, 10.0);
}

#[test]
fn spatial_scene_authoritative_move_interpolates_from_current_simulated_pose() {
    let mut scene = SpatialScene::new();
    scene.set_runtime_sampling_config(SpatialSamplingConfig {
        max_position_interp: Duration::from_millis(200),
        ..SpatialSamplingConfig::default()
    });
    let start = Instant::now();
    let guid = Guid(0x7100_000A);

    scene.upsert_runtime_body_snapshot(
        SpatialBodyId::Entity(guid),
        make_position(0.0, 0.0, 0.0),
        Vector3::zero(),
        Vector3::zero(),
        None,
        start,
    );
    scene.set_body_kinematics(
        SpatialBodyId::Entity(guid),
        Vector3::new(2.0, 0.0, 0.0),
        Vector3::zero(),
    );
    scene.update_authoritative_body_pose(
        SpatialBodyId::Entity(guid),
        make_position(1.0, 0.0, 0.0),
        false,
        start + Duration::from_millis(100),
    );

    let projected = scene
        .projected_entity_state(guid)
        .expect("entity should have projected state");
    assert_eq!(projected.projection_mode, SpatialSampleMode::InterpolatingPosition);
    assert!((projected.projected_pose.coords.x - 0.2).abs() < 1e-4);
}

#[test]
fn spatial_scene_runtime_body_views_include_entity_local_player_and_ephemeral_bodies() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let entity_id = SpatialBodyId::Entity(Guid(0x7100_0010));
    let player_id = SpatialBodyId::LocalPlayer(Guid(0x7100_0011));

    scene.register_body(SpatialBody::new(entity_id, make_position(1.0, 2.0, 0.0), now));
    scene.register_body(SpatialBody::new(player_id, make_position(3.0, 4.0, 0.5), now));
    let ephemeral_id = scene.register_ephemeral_body(make_position(5.0, 6.0, 1.0), now);

    let views: Vec<_> = scene.iter_runtime_body_views().collect();

    assert_eq!(views.len(), 3);
    assert!(views.iter().any(|view| view.body_id == entity_id));
    assert!(views.iter().any(|view| view.body_id == player_id));
    assert!(views.iter().any(|view| view.body_id == ephemeral_id));
}

#[test]
fn spatial_scene_forced_reposition_reset_clears_runtime_motion_and_suspends_body() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let body_id = SpatialBodyId::Entity(Guid(0x7100_0012));

    scene.seed_authoritative_body_snapshot(
        body_id,
        make_position(1.0, 2.0, 0.0),
        Vector3::new(3.0, 0.0, 0.0),
        Vector3::new(0.0, 0.0, 1.0),
        Some(EntityMotionSnapshot {
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            ..Default::default()
        }),
        now,
    );

    scene.apply_forced_reposition_reset(body_id, make_position(8.0, 9.0, 0.25), now);

    let body = scene.body(body_id).expect("body should remain tracked");
    assert_eq!(body.pose, make_position(8.0, 9.0, 0.25));
    assert_eq!(body.authoritative_pose, Some(make_position(8.0, 9.0, 0.25)));
    assert_eq!(body.velocity, Vector3::zero());
    assert_eq!(body.omega, Vector3::zero());
    assert_eq!(body.motion_state, None);
    assert_eq!(body.sampling.mode, SpatialSampleMode::Suspended);
}