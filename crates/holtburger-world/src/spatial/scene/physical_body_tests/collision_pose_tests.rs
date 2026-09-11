//! Collision-pose publication, retained surfaces, replacement, and residency regressions.

use super::*;
use crate::motion::AuthoredCollisionPose;
use holtburger_content::collision_pose::CollisionPoseLibrary;
use holtburger_dat::file_type::{
    Animation, animation::AnimationFlags, setup_model::AnimationFrame,
};
use holtburger_dat::graphics::Frame;

fn animated_panel_configuration() -> (u32, DynamicPhysicalBodyConfiguration) {
    let animation_id = 0x03000001;
    let animation = Animation {
        id: animation_id,
        flags: AnimationFlags::empty(),
        num_parts: 1,
        num_frames: 2,
        pos_frames: Vec::new(),
        part_frames: [0.0, 1.0]
            .into_iter()
            .map(|x| AnimationFrame {
                frames: vec![Frame {
                    origin: Vector3::new(x, 0.0, 0.0),
                    orientation: Quaternion::identity(),
                }],
                hooks: Vec::new(),
            })
            .collect(),
    };
    let geometry = PreparedEntityTargetGeometry {
        setup_radius: 2.0,
        collision_animations: CollisionPoseLibrary::project([Arc::new(animation)], &[0]).unwrap(),
        physics_bsp_parts: vec![crate::PreparedEntityBspPart {
            part_index: 0,
            gfx_obj_did: 0x01000001,
            local_origin: Vector3::zero(),
            local_orientation: Quaternion::identity(),
            scale: ColliderScale::uniform(1.0).unwrap(),
            shape: polygon_wall_shape(),
        }],
        fallback_setup_did: 0x02000001,
        fallback_shapes: Vec::new(),
        fallback_scale: ColliderScale::uniform(1.0).unwrap(),
    };
    let config = dynamic_definition_with_geometry(
        free_definition(Vector3::zero(), 0.25),
        false,
        geometry,
        true,
    );
    (animation_id, config)
}

#[test]
fn animated_target_retains_pose_while_collision_residency_is_absent() {
    let (animation_id, config) = animated_panel_configuration();
    let id = SpatialBodyId::Entity(Guid(12));
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(96.0, 96.0, 1.0)),
        Instant::now(),
    ));
    scene
        .set_dynamic_physical_body(id, Some(config), PhysicalCollisionFilter::ALL, None)
        .unwrap();
    let sample = AuthoredCollisionPose::Animation {
        animation_id,
        frame: 1,
    };
    assert!(
        scene
            .publish_collision_pose(id, sample, &CollisionScene::new())
            .unwrap()
    );
    assert_eq!(dynamic_activity(&scene, id), DynamicBodyActivity::Suspended);
    let dynamic = scene
        .body(id)
        .unwrap()
        .physical
        .as_ref()
        .unwrap()
        .dynamic
        .as_ref()
        .unwrap();
    assert!(!crate::spatial::dynamic_index::dynamic_target_is_indexed(
        id, dynamic
    ));

    scene
        .advance_dynamic_entity_collection(
            &flat_collision_scene(),
            CONTACT_INTERVAL,
            Instant::now(),
            collection_input,
        )
        .unwrap();
    assert_ne!(dynamic_activity(&scene, id), DynamicBodyActivity::Suspended);
    let body = scene.body(id).unwrap();
    let dynamic = body.physical.as_ref().unwrap().dynamic.as_ref().unwrap();
    assert_eq!(dynamic.collision_poses.sample, Some(sample));
    assert_eq!(dynamic.collision_poses.poses[0].translation.x, 1.0);
}

#[test]
fn authored_panel_pose_changes_shared_collision_and_retires_old_surface_proofs() {
    let (animation_id, config) = animated_panel_configuration();
    let id = SpatialBodyId::Entity(Guid(12));
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(96.0, 96.0, 1.0)),
        Instant::now(),
    ));
    scene
        .set_dynamic_physical_body(
            id,
            Some(
                config
                    .clone()
                    .with_collision_pose(
                        AuthoredCollisionPose::Animation {
                            animation_id,
                            frame: 0,
                        },
                        None,
                    )
                    .unwrap(),
            ),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    scene
        .body_mut(id)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .activity = DynamicBodyActivity::Settled;
    let before = scene.entity_collision_snapshot().unwrap();
    assert!(std::sync::Arc::ptr_eq(
        &before,
        &scene.entity_collision_snapshot().unwrap()
    ));
    let proof = before.proof(id).unwrap();
    let collision = flat_collision_scene();
    let sample = AuthoredCollisionPose::Animation {
        animation_id,
        frame: 1,
    };
    assert!(
        scene
            .publish_collision_pose(id, sample, &collision)
            .unwrap()
    );
    assert!(
        !scene
            .publish_collision_pose(id, sample, &collision)
            .unwrap()
    );
    let after = scene.entity_collision_snapshot().unwrap();
    assert!(!std::sync::Arc::ptr_eq(&before, &after));
    assert!(before.proves(&proof));
    assert!(!after.proves(&proof));
    let target_x = |body: &SpatialBody| {
        let dynamic = body.physical.as_ref().unwrap().dynamic.as_ref().unwrap();
        placed_target_shapes(dynamic, body.pose, Guid(0xda55ffff)).unwrap()[0]
            .point_to_landblock_space(Vector3::zero())
            .x
    };
    assert_eq!(
        before.target(id).unwrap().shapes[0]
            .point_to_landblock_space(Vector3::zero())
            .x,
        96.0
    );
    assert_eq!(
        after.target(id).unwrap().shapes[0]
            .point_to_landblock_space(Vector3::zero())
            .x,
        97.0
    );
    // State/demand reconfiguration must preserve the instance's current local pose.
    scene
        .set_dynamic_physical_body(id, Some(config.clone()), PhysicalCollisionFilter::ALL, None)
        .unwrap();
    assert_eq!(target_x(scene.body(id).unwrap()), 97.0);
    // A producer proposal commits its pose with the accepted body transaction.
    scene
        .advance_dynamic_entity_collection(&collision, CONTACT_INTERVAL, Instant::now(), |body| {
            Ok(
                collection_input(body)?.with_collision_pose(AuthoredCollisionPose::Animation {
                    animation_id,
                    frame: 0,
                }),
            )
        })
        .unwrap();
    assert_eq!(target_x(scene.body(id).unwrap()), 96.0);
    // Invalid frames and missing prepared animations must both preserve the accepted surface.
    for invalid in [
        AuthoredCollisionPose::Animation {
            animation_id,
            frame: 2,
        },
        AuthoredCollisionPose::Animation {
            animation_id: animation_id + 1,
            frame: 0,
        },
    ] {
        assert!(
            scene
                .advance_dynamic_entity_collection(
                    &collision,
                    CONTACT_INTERVAL,
                    Instant::now(),
                    |body| Ok(collection_input(body)?.with_collision_pose(invalid)),
                )
                .is_err()
        );
        assert_eq!(target_x(scene.body(id).unwrap()), 96.0);
    }
    // Replacing a table with a shorter clip retains an omitted part's last accepted pose.
    scene
        .publish_collision_pose(id, sample, &collision)
        .unwrap();
    let shorter_animation_id = animation_id + 1;
    let shorter = Animation {
        id: shorter_animation_id,
        flags: AnimationFlags::empty(),
        num_parts: 0,
        num_frames: 1,
        pos_frames: Vec::new(),
        part_frames: vec![AnimationFrame {
            frames: Vec::new(),
            hooks: Vec::new(),
        }],
    };
    let mut replacement_definition = config.definition().clone();
    let mut geometry = (*replacement_definition.entity_collision.target_geometry).clone();
    geometry.collision_animations =
        CollisionPoseLibrary::project([Arc::new(shorter)], &[0]).unwrap();
    replacement_definition.entity_collision.target_geometry = Arc::new(geometry);
    let replacement =
        DynamicPhysicalBodyConfiguration::new(replacement_definition, config.demand())
            .unwrap()
            .with_collision_pose(
                AuthoredCollisionPose::Animation {
                    animation_id: shorter_animation_id,
                    frame: 0,
                },
                scene.body(id),
            )
            .unwrap();
    scene
        .set_dynamic_physical_body(id, Some(replacement), PhysicalCollisionFilter::ALL, None)
        .unwrap();
    assert_eq!(target_x(scene.body(id).unwrap()), 97.0);
}

#[test]
fn camera_queries_share_animated_solids_and_refresh_participation() {
    use crate::spatial::{
        CameraCollisionQuery, CollisionQueryPolicy, FreeSphereConfig, FreeSphereOutcome,
        FreeSphereRequest, FreeSphereState, SphereCollisionQuery, StaticSphereSweepRequest,
        solve_free_sphere,
    };
    let now = Instant::now();
    let (animation_id, config) = animated_panel_configuration();
    let id = SpatialBodyId::Entity(Guid(12));
    let camera_target = SpatialBodyId::LocalPlayer(Guid(99));
    let owner = Guid(0xda55ffff);
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(96.0, 96.0, 1.0)),
        now,
    ));
    scene
        .set_dynamic_physical_body(id, Some(config), PhysicalCollisionFilter::ALL, None)
        .unwrap();
    scene
        .body_mut(id)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .collision
        .contact_response = crate::spatial::EntityContactResponse::Obstacle;
    let environment = flat_collision_scene();
    let before = scene.entity_collision_snapshot().unwrap();
    let query = CameraCollisionQuery {
        environment: &environment,
        entities: &before,
        target: camera_target,
    };
    let request = StaticSphereSweepRequest {
        anchor: owner,
        start: Vector3::new(94.0, 96.0, 1.0),
        displacement: Vector3::new(5.0, 0.0, 0.0),
        previous_cell: None,
        radius: 0.3,
        filter: PhysicalCollisionFilter::ALL,
    };
    let hit = query
        .sweep_sphere(request, CollisionQueryPolicy::RequireCollisionCoverage)
        .unwrap()
        .value
        .unwrap();
    assert!(hit.time_of_impact < 0.4);
    let config = FreeSphereConfig {
        maximum_substep_distance: 0.1,
        maximum_substeps: 64,
        maximum_contact_passes: 8,
        separation_epsilon: 0.0001,
    };
    let outcome = solve_free_sphere(
        &query,
        config,
        FreeSphereRequest {
            body: FreeSphereState {
                pose: pose(request.start),
                cell: None,
                radius: request.radius,
            },
            displacement: request.displacement,
            filter: request.filter,
            query_policy: CollisionQueryPolicy::RequireCollisionCoverage,
        },
    )
    .unwrap();
    let FreeSphereOutcome::Solved { body, .. } = outcome else {
        panic!("camera movement should converge");
    };
    assert!(body.pose.coords.x < 96.0 - request.radius + 0.001);
    // An authored pose changes even when the root is stationary and the target is active.
    scene
        .publish_collision_pose(
            id,
            AuthoredCollisionPose::Animation {
                animation_id,
                frame: 1,
            },
            &environment,
        )
        .unwrap();
    let after = scene.entity_collision_snapshot().unwrap();
    let moved_query = CameraCollisionQuery {
        environment: &environment,
        entities: &after,
        target: camera_target,
    };
    let overlap = crate::spatial::settle_free_sphere_with_policy(
        &moved_query,
        config.into(),
        FreeSphereState {
            pose: pose(Vector3::new(96.9, 96.0, 1.0)),
            cell: None,
            radius: request.radius,
        },
        request.filter,
        CollisionQueryPolicy::RequireCollisionCoverage,
    )
    .unwrap();
    let crate::spatial::FreeSphereSettleOutcome::Settled { body, .. } = overlap else {
        panic!("camera overlap should separate");
    };
    assert!(body.pose.coords.x <= 97.0 - request.radius + 0.001);
    let moved_hit = moved_query
        .sweep_sphere(request, CollisionQueryPolicy::RequireCollisionCoverage)
        .unwrap()
        .value
        .unwrap();
    assert!(
        (moved_hit.time_of_impact - hit.time_of_impact - 1.0 / request.displacement.x).abs()
            < 0.001
    );
    // Old publications remain internally consistent and never observe later mutations.
    assert_eq!(
        query
            .sweep_sphere(request, CollisionQueryPolicy::RequireCollisionCoverage)
            .unwrap()
            .value,
        Some(hit)
    );
    let excluded = CameraCollisionQuery {
        environment: &environment,
        entities: &after,
        target: id,
    };
    assert!(
        excluded
            .sweep_sphere(request, CollisionQueryPolicy::RequireCollisionCoverage)
            .unwrap()
            .value
            .is_none()
    );
    scene
        .body_mut(id)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .collision
        .dynamic_collision
        .target = EntityCollisionParticipation::Ethereal;
    let ethereal = scene.entity_collision_snapshot().unwrap();
    assert!(
        CameraCollisionQuery {
            environment: &environment,
            entities: &ethereal,
            target: camera_target
        }
        .sweep_sphere(request, CollisionQueryPolicy::RequireCollisionCoverage)
        .unwrap()
        .value
        .is_none()
    );
    let dynamic = scene
        .body_mut(id)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap();
    dynamic.collision.dynamic_collision.target = EntityCollisionParticipation::Solid;
    dynamic.collision.contact_response = crate::spatial::EntityContactResponse::Character(
        crate::EntityIntegrationEligibility::Frozen,
    );
    let creature = scene.entity_collision_snapshot().unwrap();
    assert!(
        CameraCollisionQuery {
            environment: &environment,
            entities: &creature,
            target: camera_target
        }
        .sweep_sphere(request, CollisionQueryPolicy::RequireCollisionCoverage)
        .unwrap()
        .value
        .is_none()
    );
    scene.remove_body(id).unwrap();
    assert!(
        scene
            .entity_collision_snapshot()
            .unwrap()
            .target(id)
            .is_none()
    );
}
