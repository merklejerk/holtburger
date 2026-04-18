use super::*;
use crate::entity::EntityMotionSnapshot;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
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
        None,
    );

    assert_eq!(projected.landblock_id, authoritative.landblock_id);
    assert!((projected.coords.x - 20.454193).abs() < 1e-4);
    assert!((projected.coords.y - (-44.71997)).abs() < 2e-3);
    assert!((projected.coords.z - 0.004999995).abs() < 1e-6);
}

#[test]
fn project_pose_by_velocity_uses_indoor_target_hint_landblock() {
    let authoritative = WorldPosition {
        landblock_id: Guid(0x016C_0000),
        coords: Vector3::new(180.0, 188.0, 0.0),
        rotation: Quaternion::identity(),
    };
    let target_hint = WorldPosition {
        landblock_id: Guid(0x016D_0100),
        coords: Vector3::new(2.0, -3.0, 0.0),
        rotation: Quaternion::identity(),
    };

    let projected = project_pose_by_velocity(
        authoritative,
        Vector3::new(20.0, 10.0, 0.0),
        1.0,
        Some(target_hint),
    );

    assert_eq!(projected.landblock_id, target_hint.landblock_id);
    assert_eq!(projected.coords, Vector3::new(200.0, 6.0, 0.0));
}

#[test]
fn project_pose_forward_distance_projects_outdoor_heading() {
    let authoritative = WorldPosition {
        landblock_id: Guid((0x016C_u32 << 24) | (0x0171_u32 << 16)),
        coords: Vector3::new(84.0, 108.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    let projected = project_pose_forward_distance(authoritative, 5.0);

    assert_eq!(
        projected.landblock_id,
        Guid((0x016C_u32 << 24) | (0x0171_u32 << 16) | 0x001D)
    );
    assert!((projected.coords.x - 84.0).abs() < 1e-4);
    assert!((projected.coords.y - 113.0).abs() < 1e-4);
    assert!((projected.coords.z - 1.5).abs() < 1e-4);
}

#[test]
fn project_pose_by_velocity_normalizes_outdoor_cell_after_projection() {
    let authoritative = WorldPosition {
        landblock_id: Guid(0x3419_0039),
        coords: Vector3::new(6.0, 57.93994, 12.770115),
        rotation: Quaternion::identity(),
    };

    let projected = project_pose_by_velocity(authoritative, Vector3::new(1.0, 0.0, 0.0), 1.0, None);

    assert_eq!(projected.landblock_id, Guid(0x3419_0003));
    assert!((projected.coords.x - 7.0).abs() < 1e-4);
    assert!((projected.coords.y - 57.93994).abs() < 1e-4);
    assert!((projected.coords.z - 12.770115).abs() < 1e-4);
}

#[test]
fn project_pose_forward_distance_ignores_non_finite_distance() {
    let authoritative = WorldPosition {
        landblock_id: Guid((0x016C_u32 << 24) | (0x0171_u32 << 16)),
        coords: Vector3::new(84.0, 108.0, 1.5),
        rotation: Quaternion::from_heading(90.0_f32.to_radians()),
    };

    let projected = project_pose_forward_distance(authoritative, f32::INFINITY);

    assert_eq!(projected, authoritative);
}

#[test]
fn advance_body_kinematics_rotates_velocity_with_turn_rate() {
    let input = SolveBodyInput::velocity(
        SpatialBodyId::Entity(Guid(0x5000_0001)),
        WorldPosition {
            landblock_id: Guid(0x1234_0000),
            coords: Vector3::zero(),
            rotation: Quaternion::from_heading(90.0f32.to_radians()),
        },
        ContactState::Unknown,
        Vector3::new(0.0, 18.0, 0.0),
        Vector3::new(0.0, 0.0, 90.0f32.to_radians()),
    );

    let solved = advance_body_kinematics(&input, Duration::from_secs(1));

    assert!((solved.pose.rotation.to_heading().to_degrees() - 180.0).abs() < 1e-4);
    assert!((solved.velocity.x - 18.0).abs() < 1e-4);
    assert!(solved.velocity.y.abs() < 1e-4);
    assert!((solved.pose.coords.x - 18.0).abs() < 1e-4);
    assert!(solved.pose.coords.y.abs() < 1e-4);
    assert_eq!(solved.contact, ContactState::Unknown);
}

#[test]
fn basic_spatial_physics_realizes_local_grounded_direct_drive() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x5000_0001);
    let body_id = SpatialBodyId::LocalPlayer(guid);
    let pose = make_position(10.0, 20.0, 0.0);

    scene.upsert_runtime_body_snapshot(body_id, pose, Vector3::zero(), Vector3::zero(), None, now);

    let request = SpatialSolveRequest {
        dt: Duration::from_millis(100),
        bodies: vec![SolveBodyInput::velocity(
            body_id,
            pose,
            ContactState::Grounded,
            Vector3::zero(),
            Vector3::zero(),
        )],
        local_drive: Some(LocalDriveControl {
            body_id,
            desired_world_delta: Vector3::new(0.0, 4.5, 1.0),
            desired_heading: Some(90.0_f32.to_radians()),
            target_hint: None,
            gait: LocalDriveGait::Run,
            force_grounded: true,
        }),
    };

    let solved = BasicSpatialPhysics.solve(&request, &mut scene);
    assert_eq!(solved.solved.len(), 1);
    let body = solved.solved[0];
    assert_eq!(body.body_id, body_id);
    assert!((body.pose.coords.y - 24.5).abs() < 1e-4);
    assert!((body.pose.coords.z - 1.0).abs() < 1e-4);
    assert_eq!(body.contact, ContactState::Grounded);
    assert_eq!(
        body.projection_state,
        Some(SelfPlayerDriveProjectionState::LocalGroundedDirectDrive)
    );
}

#[test]
fn basic_spatial_physics_freezes_local_drive_when_body_is_authority_frozen() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x5000_0002);
    let body_id = SpatialBodyId::LocalPlayer(guid);
    let pose = make_position(10.0, 20.0, 0.0);

    scene.upsert_runtime_body_snapshot(body_id, pose, Vector3::zero(), Vector3::zero(), None, now);
    scene.apply_forced_reposition_reset(body_id, pose, now);

    let request = SpatialSolveRequest {
        dt: Duration::from_millis(100),
        bodies: vec![SolveBodyInput::velocity(
            body_id,
            pose,
            ContactState::Grounded,
            Vector3::zero(),
            Vector3::zero(),
        )],
        local_drive: Some(LocalDriveControl {
            body_id,
            desired_world_delta: Vector3::new(0.0, 4.5, 0.0),
            desired_heading: Some(90.0_f32.to_radians()),
            target_hint: None,
            gait: LocalDriveGait::Run,
            force_grounded: true,
        }),
    };

    let solved = BasicSpatialPhysics.solve(&request, &mut scene);
    assert_eq!(solved.solved.len(), 1);
    let body = solved.solved[0];
    assert_eq!(body.pose, pose);
    assert!(body.velocity.length_squared() <= 1e-6);
    assert_eq!(
        body.projection_state,
        Some(SelfPlayerDriveProjectionState::AuthorityFrozen)
    );
}

#[test]
fn basic_spatial_physics_uses_target_hint_for_indoor_destination_landblock() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let guid = Guid(0x5000_0003);
    let body_id = SpatialBodyId::LocalPlayer(guid);
    let pose = WorldPosition {
        landblock_id: Guid(0x016C_0000),
        coords: Vector3::new(180.0, 188.0, 0.0),
        rotation: Quaternion::identity(),
    };
    let target_hint = WorldPosition {
        landblock_id: Guid(0x016D_0100),
        coords: Vector3::new(2.0, -3.0, 0.0),
        rotation: Quaternion::identity(),
    };

    scene.upsert_runtime_body_snapshot(body_id, pose, Vector3::zero(), Vector3::zero(), None, now);

    let request = SpatialSolveRequest {
        dt: Duration::from_secs(1),
        bodies: vec![SolveBodyInput::velocity(
            body_id,
            pose,
            ContactState::Grounded,
            Vector3::zero(),
            Vector3::zero(),
        )],
        local_drive: Some(LocalDriveControl {
            body_id,
            desired_world_delta: Vector3::new(20.0, 10.0, 0.0),
            desired_heading: None,
            target_hint: Some(target_hint),
            gait: LocalDriveGait::Run,
            force_grounded: true,
        }),
    };

    let solved = BasicSpatialPhysics.solve(&request, &mut scene);
    let body = solved.solved[0];

    assert_eq!(body.pose.landblock_id, target_hint.landblock_id);
    assert_eq!(body.pose.coords, Vector3::new(200.0, 6.0, 0.0));
}

#[test]
fn basic_spatial_physics_integrates_grounded_remote_basis_using_local_motion_semantics() {
    let mut scene = SpatialScene::new();
    let guid = Guid(0x5000_0004);
    let pose = make_position(10.0, 20.0, 90.0_f32.to_radians());

    let request = SpatialSolveRequest {
        dt: Duration::from_secs(1),
        bodies: vec![SolveBodyInput {
            body_id: SpatialBodyId::Entity(guid),
            pose,
            contact: ContactState::Grounded,
            basis: Some(SolveProjectionBasis::GroundedMotion {
                desired_local_velocity: Vector3::new(2.0, 0.0, 0.0),
                desired_local_omega: Vector3::new(0.0, 0.0, 1.0),
            }),
        }],
        local_drive: None,
    };

    let solved = BasicSpatialPhysics.solve(&request, &mut scene);
    let body = solved.solved[0];

    assert!(body.velocity.x.abs() < 1e-4);
    assert!((body.velocity.y - 2.0).abs() < 1e-4);
    assert!((body.pose.coords.x - 10.0).abs() < 1e-4);
    assert!((body.pose.coords.y - 22.0).abs() < 1e-4);
    assert!((body.pose.rotation.to_heading() - (90.0_f32.to_radians() + 1.0)).abs() < 1e-4);
    assert_eq!(body.contact, ContactState::Grounded);
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

    let stored = scene
        .body(body_id)
        .expect("updated body should remain present");
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
    assert_eq!(
        scene.body(first).and_then(|body| body.authoritative_pose),
        None
    );
    assert_eq!(scene.body(second).map(|body| body.pose), Some(pose));
}

#[test]
fn body_solver_types_preserve_body_identity_and_support_ephemeral_events() {
    let pose = WorldPosition {
        landblock_id: Guid(0x9876_0000),
        coords: Vector3::new(1.0, 1.0, 1.0),
        ..Default::default()
    };

    let entity_body_input = SolveBodyInput {
        body_id: SpatialBodyId::Entity(Guid(0x7000_0001)),
        pose,
        contact: ContactState::Unknown,
        basis: Some(SolveProjectionBasis::velocity(
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 3.0),
        )),
    };

    assert_eq!(
        entity_body_input.body_id,
        SpatialBodyId::Entity(Guid(0x7000_0001))
    );

    let body_input = SolveBodyInput {
        body_id: SpatialBodyId::LocalPlayer(Guid(0x7000_0002)),
        pose,
        contact: ContactState::Unknown,
        basis: Some(SolveProjectionBasis::velocity(
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::new(0.0, 0.0, 3.0),
        )),
    };

    assert_eq!(
        body_input.body_id,
        SpatialBodyId::LocalPlayer(Guid(0x7000_0002))
    );

    let event = SpatialBodyEvent::ForcedReposition {
        body_id: SpatialBodyId::Ephemeral(99),
        pose,
    };
    assert!(matches!(
        event,
        SpatialBodyEvent::ForcedReposition {
            body_id: SpatialBodyId::Ephemeral(99),
            pose: event_pose,
        } if event_pose == pose
    ));
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

    let body = scene
        .body(body_id)
        .expect("body should exist after reconcile");
    assert_eq!(body.authoritative_pose, Some(reset_pose));
    assert_eq!(body.pose, reset_pose);
    assert_eq!(body.velocity, Vector3::new(4.0, 5.0, 6.0));
    assert_eq!(body.omega, Vector3::new(0.0, 0.0, 1.0));
    assert_eq!(body.motion_state, None);
    assert_eq!(body.sampling.mode, SpatialSampleMode::Suspended);
    assert_eq!(
        body.sampling.last_derived_at,
        start + Duration::from_secs(1)
    );
}

#[test]
fn spatial_scene_runtime_body_views_include_entity_local_player_and_ephemeral_bodies() {
    let mut scene = SpatialScene::new();
    let now = Instant::now();
    let entity_id = SpatialBodyId::Entity(Guid(0x7100_0010));
    let player_id = SpatialBodyId::LocalPlayer(Guid(0x7100_0011));

    scene.register_body(SpatialBody::new(
        entity_id,
        make_position(1.0, 2.0, 0.0),
        now,
    ));
    scene.register_body(SpatialBody::new(
        player_id,
        make_position(3.0, 4.0, 0.5),
        now,
    ));
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
