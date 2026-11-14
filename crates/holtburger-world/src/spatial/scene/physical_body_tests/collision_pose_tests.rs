//! Collision-pose publication, retained surfaces, replacement, and residency regressions.

use super::*;
use crate::motion::AuthoredCollisionPose;
use crate::spatial::{
    CameraCollisionQuery, FreeSphereSettleOutcome, FreeSphereState, settle_free_sphere,
};
use holtburger_content::collision_pose::CollisionPoseLibrary;
use holtburger_dat::file_type::{
    Animation, animation::AnimationFlags, setup_model::AnimationFrame,
};
use holtburger_dat::graphics::Frame;
use holtburger_dat::physics::InternalNode;

/// Explicit stationary camera-query work budget, independent of body movement.
const CAMERA_SETTLE_CONFIG: crate::FreeSphereSettleConfig = crate::FreeSphereSettleConfig {
    maximum_contact_passes: 8,
    separation_epsilon: 0.0001,
};

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
        setup_height: 1.0,
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
fn stationary_camera_recovery_checks_entity_paths_endpoints_and_target_exclusion() {
    let surface = polygon_wall_shape();
    let solid = surface.as_bsp().unwrap();
    let bounds = Sphere {
        center: Vector3::zero(),
        radius: 5.0,
    };
    let leaf = |index, solid| {
        BspNode::Leaf(BspLeaf {
            index,
            solid,
            sphere: Some(bounds),
            poly_ids: vec![1],
        })
    };
    let static_shape = Arc::new(CollisionShape::Bsp(BspSolid {
        bsp: BspNode::Internal(InternalNode {
            tag: *b"BPnn",
            plane: Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: 0.0,
            },
            pos: Some(Box::new(leaf(1, 1))),
            neg: Some(Box::new(leaf(0, 0))),
            sphere: Some(bounds),
            poly_ids: Vec::new(),
        }),
        bounds,
        box_bounds: CollisionBox::from_points([
            bounds.center - Vector3::new(5.0, 5.0, 5.0),
            bounds.center + Vector3::new(5.0, 5.0, 5.0),
        ])
        .unwrap(),
        polygons: solid.polygons.clone(),
    }));
    let collider = PlacedCollider::new(
        static_shape,
        LandblockPlacement {
            origin: Vector3::new(97.0, 96.0, 1.0),
            orientation: Quaternion::from_axis_angle(
                Vector3::new(0.0, 0.0, 1.0),
                std::f32::consts::PI,
            )
            .unwrap(),
        },
        ColliderScale::uniform(1.0).unwrap(),
        StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
    )
    .unwrap();
    let mut asset = flat_collision_asset(0);
    asset.static_geometry = LandblockColliders::new(vec![collider], Vec::new());
    let mut environment = flat_collision_scene();
    environment.insert(asset).unwrap();
    let original = FreeSphereState {
        pose: pose(Vector3::new(95.5, 96.0, 1.0)),
        cell: None,
        radius: 0.3,
    };
    assert!(matches!(
        settle_free_sphere(
            &environment,
            CAMERA_SETTLE_CONFIG,
            original,
            PhysicalCollisionFilter::ALL
        )
        .unwrap(),
        FreeSphereSettleOutcome::Settled { .. }
    ));

    // The first panel blocks only the correction path; the second overlaps its endpoint.
    for panel_x in [96.0, 97.5] {
        let id = SpatialBodyId::Entity(Guid(12));
        let mut scene = SpatialScene::new();
        let (_, config) = animated_panel_configuration();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(panel_x, 96.0, 1.0)),
            Instant::now(),
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
        let entities = scene.entity_collision_snapshot().unwrap();
        let query = CameraCollisionQuery {
            environment: &environment,
            entities: Some(&entities),
            excluded: &std::collections::BTreeSet::from([SpatialBodyId::LocalPlayer(Guid(99))]),
        };
        let outcome = settle_free_sphere(
            &query,
            CAMERA_SETTLE_CONFIG,
            original,
            PhysicalCollisionFilter::ALL,
        )
        .unwrap();
        assert!(
            matches!(outcome, FreeSphereSettleOutcome::RecoveryUnavailable { .. }),
            "panel X={panel_x}: {outcome:?}"
        );
        let excluded = CameraCollisionQuery {
            excluded: &std::collections::BTreeSet::from([id]),
            ..query
        };
        assert!(matches!(
            settle_free_sphere(
                &excluded,
                CAMERA_SETTLE_CONFIG,
                original,
                PhysicalCollisionFilter::ALL
            )
            .unwrap(),
            FreeSphereSettleOutcome::Settled { .. }
        ));
    }
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
        CameraCollisionQuery, CollisionQueryPolicy, SphereCollisionQuery, StaticSphereSweepRequest,
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
        entities: Some(&before),
        excluded: &std::collections::BTreeSet::from([camera_target]),
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
    assert_eq!(query.entity_sweep_sphere(request).unwrap(), Some(hit));
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
        entities: Some(&after),
        excluded: &std::collections::BTreeSet::from([camera_target]),
    };
    let overlap = crate::spatial::settle_free_sphere_with_policy(
        &moved_query,
        CAMERA_SETTLE_CONFIG,
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
    assert_eq!(
        moved_query.entity_sweep_sphere(request).unwrap(),
        Some(moved_hit)
    );
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
        entities: Some(&after),
        excluded: &std::collections::BTreeSet::from([id]),
    };
    assert!(excluded.entity_sweep_sphere(request).unwrap().is_none());
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
            entities: Some(&ethereal),
            excluded: &std::collections::BTreeSet::from([camera_target]),
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
            entities: Some(&creature),
            excluded: &std::collections::BTreeSet::from([camera_target]),
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

#[test]
fn collection_collision_pose_updates_hard_targets_and_masks_stale_snapshot_reports() {
    let animation_id = 0x0300_0099;
    let animation = Animation {
        id: animation_id,
        flags: AnimationFlags::empty(),
        num_parts: 1,
        num_frames: 2,
        pos_frames: Vec::new(),
        part_frames: [0.0, 20.0]
            .into_iter()
            .map(|y| AnimationFrame {
                frames: vec![Frame {
                    origin: Vector3::new(0.0, y, 0.0),
                    orientation: Quaternion::identity(),
                }],
                hooks: Vec::new(),
            })
            .collect(),
    };
    let geometry = PreparedEntityTargetGeometry {
        setup_radius: 2.0,
        setup_height: 2.0,
        collision_animations: CollisionPoseLibrary::project([Arc::new(animation)], &[0]).unwrap(),
        physics_bsp_parts: vec![crate::PreparedEntityBspPart {
            part_index: 0,
            gfx_obj_did: 0x0100_0001,
            local_origin: Vector3::zero(),
            local_orientation: Quaternion::identity(),
            scale: ColliderScale::uniform(1.0).unwrap(),
            shape: polygon_wall_shape(),
        }],
        fallback_setup_did: 0x0200_0001,
        fallback_shapes: Vec::new(),
        fallback_scale: ColliderScale::uniform(1.0).unwrap(),
    };
    let mut door_def = dynamic_definition_with_geometry(
        free_definition(Vector3::zero(), 0.25),
        false,
        geometry.clone(),
        true,
    )
    .definition()
    .clone();
    door_def.entity_collision.contact_response = crate::spatial::EntityContactResponse::Obstacle;
    let closed_pose = AuthoredCollisionPose::Animation {
        animation_id,
        frame: 0,
    };
    let open_pose = AuthoredCollisionPose::Animation {
        animation_id,
        frame: 1,
    };
    let door_config = DynamicPhysicalBodyConfiguration::new(
        door_def,
        LocalPhysicalDemand {
            target: LocalTargetDemand::Retained,
            integration: LocalIntegrationDemand::Eligible,
        },
    )
    .unwrap()
    .with_collision_pose(closed_pose, None)
    .unwrap();

    let mut bystander_def = dynamic_definition_with_geometry(
        PhysicalBodyDefinition::fixed_position(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::zero(),
                    radius: 0.25,
                },
                None,
            )
            .unwrap(),
        )
        .unwrap(),
        false,
        PreparedEntityTargetGeometry {
            setup_radius: 0.5,
            setup_height: 1.0,
            collision_animations: CollisionPoseLibrary::default(),
            physics_bsp_parts: Vec::new(),
            fallback_setup_did: 0x0200_0002,
            fallback_shapes: vec![bsp_shape(Vector3::zero(), 0.5)],
            fallback_scale: ColliderScale::uniform(1.0).unwrap(),
        },
        false,
    )
    .definition()
    .clone();
    bystander_def.entity_collision.contact_response =
        crate::spatial::EntityContactResponse::Obstacle;
    let bystander_config = DynamicPhysicalBodyConfiguration::new(
        bystander_def,
        LocalPhysicalDemand {
            target: LocalTargetDemand::Retained,
            integration: LocalIntegrationDemand::Excluded,
        },
    )
    .unwrap();

    let mover_config = dynamic_definition_with_geometry(
        free_definition(Vector3::zero(), 0.25),
        false,
        PreparedEntityTargetGeometry {
            setup_radius: 0.25,
            setup_height: 0.5,
            collision_animations: CollisionPoseLibrary::default(),
            physics_bsp_parts: Vec::new(),
            fallback_setup_did: 0x0200_0003,
            fallback_shapes: vec![bsp_shape(Vector3::zero(), 0.25)],
            fallback_scale: ColliderScale::uniform(1.0).unwrap(),
        },
        false,
    );

    let collision = flat_collision_scene();
    let now = Instant::now();
    let door_id = SpatialBodyId::Entity(Guid(0x6100_0001));
    let bystander_id = SpatialBodyId::Entity(Guid(0x6100_0002));
    let mover_id = SpatialBodyId::Entity(Guid(0x6100_0003));
    let mut scene = SpatialScene::new();

    scene.register_body(SpatialBody::new(
        door_id,
        pose(Vector3::new(96.0, 96.0, 1.0)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            door_id,
            Some(door_config),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    scene.register_body(SpatialBody::new(
        bystander_id,
        pose(Vector3::new(140.0, 140.0, 1.0)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            bystander_id,
            Some(bystander_config),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    scene.register_body(SpatialBody::new(
        mover_id,
        pose(Vector3::new(95.0, 96.0, 1.0)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            mover_id,
            Some(mover_config),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();

    // Settle all bodies first and warm the shared snapshot + hard-target caches.
    let step_dt = Duration::from_secs_f32(CONTACT_INTERVAL);
    scene
        .advance_dynamic_entity_collection(&collision, CONTACT_INTERVAL, now + step_dt, |_| {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::free_flight(Vector3::zero())?,
            ))
        })
        .unwrap();
    let _ = scene.entity_collision_snapshot().unwrap();

    // Tick 1: Door opens via `input_for` in the same tick the mover sweeps across x = 96.0.
    scene.wake_dynamic_body(mover_id);
    let open_tick = scene
        .advance_dynamic_entity_collection(
            &collision,
            CONTACT_INTERVAL,
            now + step_dt * 2,
            |body| {
                if body.id == door_id {
                    Ok(
                        PhysicalBodyInput::autonomous(PhysicalBodyActuation::free_flight(
                            Vector3::zero(),
                        )?)
                        .with_collision_pose(open_pose),
                    )
                } else if body.id == mover_id {
                    Ok(PhysicalBodyInput::autonomous(
                        PhysicalBodyActuation::free_flight(Vector3::new(60.0, 0.0, 0.0))?,
                    ))
                } else {
                    collection_input(body)
                }
            },
        )
        .unwrap();
    assert!(
        scene.body(mover_id).unwrap().pose.coords.x > 96.5,
        "mover should pass through opened door: {:?}",
        scene.body(mover_id).unwrap().pose.coords
    );
    assert!(
        open_tick.collision_reports.is_empty(),
        "stale closed-door snapshot must not emit ghost reports: {:?}",
        open_tick.collision_reports
    );

    // Reset mover to x = 95.0, settle, then close the door in the same tick the mover sweeps in.
    scene
        .relocate_dynamic_body(
            mover_id,
            pose(Vector3::new(95.0, 96.0, 1.0)),
            now + step_dt * 3,
        )
        .unwrap();
    scene
        .advance_dynamic_entity_collection(&collision, CONTACT_INTERVAL, now + step_dt * 4, |_| {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::free_flight(Vector3::zero())?,
            ))
        })
        .unwrap();
    let _ = scene.entity_collision_snapshot().unwrap();

    scene.wake_dynamic_body(mover_id);
    let close_tick = scene
        .advance_dynamic_entity_collection(
            &collision,
            CONTACT_INTERVAL,
            now + step_dt * 5,
            |body| {
                if body.id == door_id {
                    Ok(
                        PhysicalBodyInput::autonomous(PhysicalBodyActuation::free_flight(
                            Vector3::zero(),
                        )?)
                        .with_collision_pose(closed_pose),
                    )
                } else if body.id == mover_id {
                    Ok(PhysicalBodyInput::autonomous(
                        PhysicalBodyActuation::free_flight(Vector3::new(60.0, 0.0, 0.0))?,
                    ))
                } else {
                    collection_input(body)
                }
            },
        )
        .unwrap();
    assert!(
        scene.body(mover_id).unwrap().pose.coords.x <= 95.76,
        "mover should be blocked by newly closed door: {:?}",
        scene.body(mover_id).unwrap().pose.coords
    );
    assert_eq!(close_tick.collision_reports.len(), 2);
}

#[test]
fn projectile_hits_settled_local_player_target_shape_above_movement_sphere() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let step_dt = Duration::from_secs_f32(CONTACT_INTERVAL);
    let player_id = SpatialBodyId::LocalPlayer(Guid(0x6200_0001));
    let missile_id = SpatialBodyId::Entity(Guid(0x6200_0002));

    let player_config = dynamic_definition_with_geometry(
        PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::new(0.0, 0.0, 0.4),
                    radius: 0.35,
                },
                None,
            )
            .unwrap(),
        )
        .unwrap(),
        false,
        PreparedEntityTargetGeometry {
            setup_radius: 0.5,
            setup_height: 3.0,
            collision_animations: CollisionPoseLibrary::default(),
            physics_bsp_parts: Vec::new(),
            fallback_setup_did: 0x0200_0010,
            fallback_shapes: vec![Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::new(0.0, 0.0, 2.5),
                radius: 0.4,
            }))],
            fallback_scale: ColliderScale::uniform(1.0).unwrap(),
        },
        false,
    );

    let mut missile_def = dynamic_definition_with_geometry(
        free_definition(Vector3::zero(), 0.15),
        true,
        PreparedEntityTargetGeometry {
            setup_radius: 0.15,
            setup_height: 0.3,
            collision_animations: CollisionPoseLibrary::default(),
            physics_bsp_parts: Vec::new(),
            fallback_setup_did: 0x0200_0011,
            fallback_shapes: Vec::new(),
            fallback_scale: ColliderScale::uniform(1.0).unwrap(),
        },
        false,
    )
    .definition()
    .clone();
    missile_def.entity_collision.dynamic_collision.missile = true;
    missile_def.entity_collision.dynamic_collision.path_clipped = true;
    let missile_config = DynamicPhysicalBodyConfiguration::new(
        missile_def,
        LocalPhysicalDemand {
            target: LocalTargetDemand::Absent,
            integration: LocalIntegrationDemand::Eligible,
        },
    )
    .unwrap();

    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(
        player_id,
        pose(Vector3::new(96.0, 96.0, 0.5)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            player_id,
            Some(player_config),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    // Settle `LocalPlayer` first so its movement sphere (z in [0.55, 1.25]) sleeps far below z = 3.0.
    scene
        .advance_dynamic_entity_collection(&collision, CONTACT_INTERVAL, now + step_dt, |_| {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::free_flight(Vector3::zero())?,
            ))
        })
        .unwrap();
    assert_eq!(
        dynamic_activity(&scene, player_id),
        DynamicBodyActivity::Settled
    );

    // Register an active missile at z = 3.0 (hitting the tall target shape at z = 0.5 + 2.5 = 3.0).
    scene.register_body(SpatialBody::new(
        missile_id,
        pose(Vector3::new(94.8, 96.0, 3.0)),
        now + step_dt,
    ));
    scene
        .set_dynamic_physical_body(
            missile_id,
            Some(missile_config),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();

    let tick = scene
        .advance_dynamic_entity_collection(
            &collision,
            CONTACT_INTERVAL,
            now + step_dt * 2,
            |body| {
                if body.id == missile_id {
                    Ok(PhysicalBodyInput::autonomous(
                        PhysicalBodyActuation::free_flight(Vector3::new(60.0, 0.0, 0.0))?,
                    ))
                } else {
                    Ok(PhysicalBodyInput::autonomous(
                        PhysicalBodyActuation::free_flight(Vector3::zero())?,
                    ))
                }
            },
        )
        .unwrap();
    assert!(
        scene.body(missile_id).unwrap().pose.coords.x < 96.0,
        "projectile missed settled LocalPlayer tall target shape: {:?}",
        scene.body(missile_id).unwrap().pose.coords
    );
    let missile_outcome = tick
        .outcomes
        .iter()
        .find_map(|outcome| match outcome {
            DynamicEntityBodyOutcome::Integrated(accepted) if accepted.body_id == missile_id => {
                Some(accepted)
            }
            _ => None,
        })
        .expect("missile should produce an integrated outcome");
    assert!(missile_outcome.dynamic_state_change.is_some());
}

#[test]
fn mover_hard_impact_reports_against_stationary_excluded_indexed_entity() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let step_dt = Duration::from_secs_f32(CONTACT_INTERVAL);
    let obstacle_id = SpatialBodyId::Entity(Guid(0x6300_0001));
    let mover_id = SpatialBodyId::Entity(Guid(0x6300_0002));

    let mut obstacle_def = dynamic_definition_with_geometry(
        PhysicalBodyDefinition::fixed_position(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::zero(),
                    radius: 0.25,
                },
                None,
            )
            .unwrap(),
        )
        .unwrap(),
        false,
        PreparedEntityTargetGeometry {
            setup_radius: 1.0,
            setup_height: 2.0,
            collision_animations: CollisionPoseLibrary::default(),
            physics_bsp_parts: Vec::new(),
            fallback_setup_did: 0x0200_0020,
            fallback_shapes: vec![polygon_wall_shape()],
            fallback_scale: ColliderScale::uniform(1.0).unwrap(),
        },
        false,
    )
    .definition()
    .clone();
    obstacle_def.entity_collision.contact_response =
        crate::spatial::EntityContactResponse::Obstacle;
    let obstacle_config = DynamicPhysicalBodyConfiguration::new(
        obstacle_def,
        LocalPhysicalDemand {
            target: LocalTargetDemand::Retained,
            integration: LocalIntegrationDemand::Excluded,
        },
    )
    .unwrap();

    let mover_config = dynamic_definition_with_geometry(
        free_definition(Vector3::zero(), 0.25),
        false,
        PreparedEntityTargetGeometry {
            setup_radius: 0.25,
            setup_height: 0.5,
            collision_animations: CollisionPoseLibrary::default(),
            physics_bsp_parts: Vec::new(),
            fallback_setup_did: 0x0200_0021,
            fallback_shapes: vec![bsp_shape(Vector3::zero(), 0.25)],
            fallback_scale: ColliderScale::uniform(1.0).unwrap(),
        },
        false,
    );

    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(
        obstacle_id,
        pose(Vector3::new(96.0, 96.0, 1.0)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            obstacle_id,
            Some(obstacle_config),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    scene.register_body(SpatialBody::new(
        mover_id,
        pose(Vector3::new(95.0, 96.0, 1.0)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            mover_id,
            Some(mover_config),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();

    // Refresh stationary obstacle placement once so the second tick takes the stationary fast path.
    scene
        .advance_dynamic_entity_collection(&collision, CONTACT_INTERVAL, now + step_dt, |_| {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::free_flight(Vector3::zero())?,
            ))
        })
        .unwrap();

    scene.wake_dynamic_body(mover_id);
    let tick = scene
        .advance_dynamic_entity_collection(
            &collision,
            CONTACT_INTERVAL,
            now + step_dt * 2,
            |body| {
                if body.id == mover_id {
                    Ok(PhysicalBodyInput::autonomous(
                        PhysicalBodyActuation::free_flight(Vector3::new(60.0, 0.0, 0.0))?,
                    ))
                } else {
                    collection_input(body)
                }
            },
        )
        .unwrap();
    assert!(scene.body(mover_id).unwrap().pose.coords.x <= 95.76);
    assert_eq!(tick.collision_reports.len(), 2);
}
