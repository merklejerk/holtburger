//! Focused conformance scenarios for the bounded local contact step.

use crate::DynamicEntityBodyOutcome;

use super::*;
use crate::spatial::bsp_query::CONTACT_EPSILON;
use crate::spatial::{
    ContactBodyUpdate, ContactStepActuation, MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO,
    MOBILE_CONTACT_TICK_SECONDS, PlacedMotionPath, advance_body_contacts,
};

fn contact_stair_scene(step_height: f32, ceiling: bool) -> CollisionScene {
    let mut collision = flat_collision_scene();
    let mut asset = flat_collision_asset(0);
    let mut colliders = Vec::new();
    for (source_index, low, radius, height) in [
        (0, Vector3::new(91.5, 96.0, 0.0), 1.0, step_height),
        (1, Vector3::new(91.5, 96.0, 2.0), 4.0, 1.0),
    ] {
        if source_index == 1 && !ceiling {
            continue;
        }
        colliders.push(
            PlacedCollider::new(
                Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                    low_point: low,
                    radius,
                    height,
                })),
                LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                ColliderScale::uniform(1.0).unwrap(),
                StaticColliderPlacement::OutdoorExplicit { source_index },
            )
            .unwrap(),
        );
    }
    asset.static_geometry = LandblockColliders::new(colliders, Vec::new());
    collision.insert(asset).unwrap();
    collision
}

#[test]
fn upper_sphere_blocker_limits_both_spheres_coverage() {
    let owner = Guid(0xda55_ffff);
    let origin = Vector3::new(180.0, 96.0, 10.0);
    let primary = Sphere {
        center: Vector3::zero(),
        radius: 0.5,
    };
    let upper = Sphere {
        center: Vector3::new(0.0, 0.0, 2.0),
        radius: 0.5,
    };
    let blocker = PlacedCollider::new(
        Arc::new(CollisionShape::Ball(CollisionBall {
            center: Vector3::zero(),
            radius: 0.5,
        })),
        LandblockPlacement {
            origin: origin + upper.center + Vector3::new(4.0, 0.0, 0.0),
            orientation: Quaternion::identity(),
        },
        ColliderScale::uniform(1.0).unwrap(),
        StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
    )
    .unwrap();
    let mut collision = CollisionScene::new();
    collision
        .insert(LandblockCollisionAsset {
            landblock_id: owner.0,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::new(vec![blocker], Vec::new()),
        })
        .unwrap();
    for constraint in [None, Some(upper)] {
        let definition = PhysicalBodyDefinition::grounded(
            PhysicalSphereSet::new(primary, constraint).unwrap(),
            GROUNDED_CONFIG,
        )
        .unwrap();
        let id = SpatialBodyId::LocalPlayer(Guid(1));
        let mut body = SpatialBody::new(id, pose(origin), Instant::now());
        body.retained.velocity = Vector3::new(20.0 / MOBILE_CONTACT_TICK_SECONDS, 0.0, 0.0);
        body.physical = Some(PhysicalBodyState::new_dynamic(
            dynamic_definition(definition, false),
            PhysicalCollisionFilter::ALL,
            None,
        ));
        let result = advance_body_contacts(
            &collision,
            &[body],
            owner,
            MOBILE_CONTACT_TICK_SECONDS,
            |_, _| ContactStepActuation::ballistic(Vector3::zero()),
        )
        .unwrap();
        let update = &result[0];
        if constraint.is_some() {
            assert_eq!(update.unavailable_owner, None);
            assert!(update.displacement.x > 0.0 && update.displacement.x < 4.0);
            assert_eq!(update.membership.committed_cell(), None);
        } else {
            assert_eq!(update.unavailable_owner, Some(Guid(0xdb55_ffff)));
            assert_eq!(update.displacement, Vector3::zero());
        }
    }
}

#[test]
fn published_root_path_does_not_turn_offset_sphere_rotation_into_translation() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let mut body = SpatialBody::new(id, pose(Vector3::new(90.0, 96.0, 4.0)), now);
    body.retained.velocity = Vector3::new(2.0, 0.0, 0.0);
    body.retained.omega = Vector3::new(0.0, 0.0, std::f32::consts::PI);
    scene.register_body(body);
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(
                free_definition(Vector3::new(1.0, 0.0, 0.0), 0.25),
                false,
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    scene
        .refresh_dynamic_body_placement(id, &collision)
        .unwrap();
    let previous = scene.body(id).unwrap().clone();
    let result = crate::spatial::advance_body_contact_collection(
        &collision,
        std::slice::from_ref(&previous),
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |_, _, _| ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    let update = result.bodies.into_iter().next().unwrap();
    let mut current = previous.clone();
    update.apply_physical_state(&mut current).unwrap();
    assert_ne!(previous.pose.rotation, current.pose.rotation);
    let path = PlacedMotionPath::from_contact_motion(&previous, &current, &update.motion).unwrap();
    assert_eq!(path.initial().center(), previous.pose.coords);
    assert_eq!(path.final_point().center(), current.pose.coords);
    for leg in path.legs() {
        assert!((leg.end().center().y - previous.pose.coords.y).abs() < 0.00001);
        assert!((leg.end().center().z - previous.pose.coords.z).abs() < 0.00001);
        assert!(leg.end().center().x >= previous.pose.coords.x);
        assert!(leg.end().center().x <= current.pose.coords.x);
    }
}

#[test]
fn contact_advance_steps_without_launching_and_respects_upper_clearance() {
    for ceiling in [false, true] {
        let now = Instant::now();
        let step_height = 0.3;
        let collision = contact_stair_scene(step_height, ceiling);
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::LocalPlayer(Guid(1));
        let definition = grounded_definition();
        let primary = definition.spheres().primary();
        let floor_z = primary.radius - primary.center.z;
        let mut body = SpatialBody::new(id, pose(Vector3::new(90.0, 96.0, floor_z)), now);
        body.retained.velocity = Vector3::new(5.0, 0.0, 0.0);
        scene.register_body(body);
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let mut lifted = false;
        let mut descended = false;
        for _ in 0..96 {
            let updates = crate::spatial::advance_body_contacts(
                &collision,
                &[scene.body(id).unwrap().clone()],
                Guid(0xda55_ffff),
                crate::spatial::MOBILE_CONTACT_TICK_SECONDS,
                |body, ground| {
                    grounded_step_input(
                        body,
                        ground,
                        &GroundedBodyActuation::drive(Vector3::new(5.0, 0.0, 0.0)).unwrap(),
                    )
                },
            )
            .unwrap();
            let update = updates.into_iter().next().unwrap();
            assert!(update.unavailable_owner.is_none());
            let stair_travel =
                primary.radius * crate::spatial::MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO;
            if update.displacement.z.abs() > stair_travel {
                lifted |= update.displacement.z > 0.0;
                descended |= update.displacement.z < 0.0;
                assert_eq!(update.velocity.z, 0.0, "stair adjustment became velocity");
                assert_eq!(
                    update.accepted_motion.velocity.z, 0.0,
                    "stair lift became observed travel"
                );
                assert_eq!(
                    update.supported_velocity.z, 0.0,
                    "stair lift became locomotion"
                );
            }
            let body = scene.body_mut(id).unwrap();
            body.pose.coords = body.pose.coords + update.displacement;
            body.retained.velocity = update.velocity;
            body.physical
                .as_mut()
                .unwrap()
                .dynamic
                .as_mut()
                .unwrap()
                .placement = update.membership;
        }
        if ceiling {
            assert!(!lifted, "upper sphere passed through the low ceiling");
            assert!(scene.body(id).unwrap().pose.coords.z < floor_z + step_height);
        } else {
            assert!(lifted, "fixture never exercised stair ascent");
            assert!(
                descended,
                "fixture never exercised stair descent: {:?}",
                scene.body(id).unwrap()
            );
            assert!(
                (scene.body(id).unwrap().pose.coords.z - floor_z).abs() < 0.0001,
                "final pose {:?}, velocity {:?}",
                scene.body(id).unwrap().pose.coords,
                scene.body(id).unwrap().retained.velocity
            );
        }
    }
}

#[test]
fn contact_correction_preserves_protected_ledge_footing() {
    let now = Instant::now();
    let height = GROUNDED_CONFIG.step_down_height + 0.3;
    let collision = contact_stair_scene(height, false);
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let mob = SpatialBodyId::Entity(Guid(2));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let floor_z = primary.radius - primary.center.z;
    let mut scene = SpatialScene::new();
    for (id, coords, movement) in [
        (
            player,
            Vector3::new(92.97, 96.0, height + floor_z),
            definition,
        ),
        (
            mob,
            Vector3::new(92.5, 96.0, height + primary.radius),
            free_definition(Vector3::zero(), primary.radius),
        ),
    ] {
        scene.register_body(SpatialBody::new(id, pose(coords), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(movement, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    for _ in 0..2 {
        let bodies = [
            scene.body(player).unwrap().clone(),
            scene.body(mob).unwrap().clone(),
        ];
        let updates = advance_body_contacts(
            &collision,
            &bodies,
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |_, _| ContactStepActuation::ballistic(Vector3::zero()),
        )
        .unwrap();
        let update = updates
            .iter()
            .find(|update| update.body_id == player)
            .unwrap();
        assert!(update.unavailable_owner.is_none());
        assert!(update.ground.walkable_support().is_some());
        // Small weighted corrections can remain on the ledge instead of being rejected.
        assert!(update.displacement.z.abs() < CONTACT_EPSILON);
        assert!(
            update.displacement.length()
                <= primary.radius * MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO + CONTACT_EPSILON
        );
        assert_eq!(update.velocity, Vector3::zero());
        publish_contact_updates(&mut scene, updates);
    }
}

#[test]
fn contact_advance_keeps_projectile_speed_and_sweeps_small_mobile_targets() {
    for hit_target in [false, true] {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let projectile = SpatialBodyId::Entity(Guid(1));
        let target = SpatialBodyId::LocalPlayer(Guid(2));
        let radius = 0.05;
        let speed = 50.0;
        for (id, x, velocity) in [
            (projectile, 90.0, Vector3::new(speed, 0.0, 0.0)),
            (
                target,
                if hit_target { 90.25 } else { 92.0 },
                Vector3::zero(),
            ),
        ] {
            install_free_dynamic_with_radius(
                &mut scene,
                id,
                Vector3::new(x, 96.0, 1.0),
                velocity,
                radius,
                fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                    center: Vector3::zero(),
                    radius,
                }))),
                now,
            );
        }
        let physical = scene
            .body_mut(projectile)
            .unwrap()
            .physical
            .as_mut()
            .unwrap();
        physical
            .dynamic
            .as_mut()
            .unwrap()
            .collision
            .dynamic_collision
            .missile = true;
        physical.response_policy.restitution = PhysicalRestitution::Inelastic;
        physical.response_policy.align_path = true;
        let bodies = scene
            .body_store
            .bodies
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let duration = crate::spatial::MOBILE_CONTACT_TICK_SECONDS;
        let updates = crate::spatial::advance_body_contacts(
            &collision,
            &bodies,
            Guid(0xda55_ffff),
            duration,
            |_, _| crate::spatial::ContactStepActuation::ballistic(Vector3::zero()),
        )
        .unwrap();
        let shot = updates
            .iter()
            .find(|update| update.body_id == projectile)
            .unwrap();
        let direction = Vector3::new(1.0, 0.0, 0.0);
        let expected = Quaternion::from_heading(Vector3::zero().heading_to(&direction));
        assert!(
            (shot.rotation.rotate_vector(direction) - expected.rotate_vector(direction)).length()
                < 0.0001
        );

        let target_update = updates
            .iter()
            .find(|update| update.body_id == target)
            .unwrap();
        assert_eq!(target_update.displacement, Vector3::zero());
        assert_eq!(target_update.velocity, Vector3::zero());
        assert!(shot.unavailable_owner.is_none());
        let travel = shot
            .motion
            .iter()
            .filter(|segment| {
                matches!(segment, crate::spatial::ContactMotionSegment::Travel { .. })
            })
            .collect::<Vec<_>>();
        assert_eq!(travel.len(), 1);
        assert_eq!(
            shot.motion.iter().any(|segment| matches!(
                segment,
                crate::spatial::ContactMotionSegment::Impact { .. }
            )),
            hit_target
        );
        if hit_target {
            assert!(matches!(shot.projectile_impact,
                Some(crate::spatial::HardSphereSweepHit::Entity { body_id, .. }) if body_id == target));
            assert!((shot.displacement.x - (0.25 - 2.0 * radius + CONTACT_EPSILON)).abs() < 0.0001);
            assert_eq!(shot.velocity, Vector3::zero());
            assert!(travel[0].end_fraction() < 1.0);
        } else {
            assert!(shot.projectile_impact.is_none());
            assert!((shot.displacement.x - speed * duration).abs() < 0.0001);
            assert_eq!(shot.velocity, Vector3::new(speed, 0.0, 0.0));
            assert_eq!(travel[0].end_fraction(), 1.0);
        }
    }
}

#[test]
fn contact_advance_keeps_pinned_mobile_body_out_of_hard_geometry() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let mob = SpatialBodyId::Entity(Guid(2));
    let hard = SpatialBodyId::Entity(Guid(3));
    let radius = 0.5;
    for (id, x) in [(player, 90.0), (mob, 90.9), (hard, 91.9)] {
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(x, 96.0, radius)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), radius),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    scene
        .body_mut(hard)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .demand
        .integration = LocalIntegrationDemand::Excluded;
    let steps = 128;
    let target_speed = 2.0;
    let mut sampled = 0;
    for _ in 0..steps {
        let bodies = scene
            .body_store
            .bodies
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let updates = crate::spatial::advance_body_contacts(
            &collision,
            &bodies,
            Guid(0xda55_ffff),
            crate::spatial::MOBILE_CONTACT_TICK_SECONDS,
            |body, _| {
                sampled += 1;
                if body.id == player {
                    crate::spatial::ContactStepActuation::driven(
                        Vector3::zero(),
                        Vector3::new(target_speed, 0.0, 0.0),
                        Vector3::new(0.0, 0.0, 1.0),
                    )
                } else {
                    crate::spatial::ContactStepActuation::ballistic(Vector3::zero())
                }
            },
        )
        .unwrap();
        for update in updates {
            assert!(update.unavailable_owner.is_none());
            let body = scene.body_mut(update.body_id).unwrap();
            let mut center = body.pose.coords;
            let mut elapsed = 0.0;
            for segment in &update.motion {
                let Some(path) = segment.path() else {
                    continue;
                };
                assert!((path.primary().initial().center() - center).length() < 0.0001);
                assert!(segment.start_fraction() >= elapsed);
                assert!(segment.end_fraction() >= segment.start_fraction());
                assert!(segment.end_fraction() <= 1.0);
                center = path.primary().final_point().center();
                elapsed = segment.end_fraction();
            }
            assert!((center - body.pose.coords - update.displacement).length() < 0.0001);
            body.pose.coords = body.pose.coords + update.displacement;
            body.retained.velocity = update.velocity;
            body.physical
                .as_mut()
                .unwrap()
                .dynamic
                .as_mut()
                .unwrap()
                .placement = update.membership;
        }
        assert!((scene.body(mob).unwrap().pose.coords.x - (90.9 + CONTACT_EPSILON)).abs() < 0.0001);
        for id in [player, mob] {
            assert!(
                scene
                    .body(id)
                    .unwrap()
                    .pose
                    .distance_to(&scene.body(hard).unwrap().pose)
                    >= 2.0 * radius - 2.0 * CONTACT_EPSILON
            );
        }
    }
    assert_eq!(
        sampled,
        steps * 2,
        "forces must not be replayed per contact pass"
    );
    let player_velocity = scene.body(player).unwrap().retained.velocity;
    assert!(player_velocity.x.abs() <= target_speed + CONTACT_EPSILON);
    assert_eq!(player_velocity.z, 0.0);
    assert_eq!(scene.body(mob).unwrap().retained.velocity, Vector3::zero());
}

#[test]
fn contact_advance_slides_ordinary_velocity_along_a_hard_entity() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let hard = SpatialBodyId::Entity(Guid(2));
    for (id, x) in [(player, 90.0), (hard, 91.0)] {
        scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 0.5)), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), 0.5),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    // Zero elasticity retains tangent motion; inelastic response would stop it too.
    scene
        .body_mut(player)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .response_policy
        .restitution = PhysicalRestitution::Elastic(PhysicalElasticity::ZERO);
    scene.body_mut(player).unwrap().retained.velocity = Vector3::new(2.0, 3.0, 0.0);
    scene
        .body_mut(hard)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .demand
        .integration = LocalIntegrationDemand::Excluded;
    let bodies = scene
        .body_store
        .bodies
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let updates = crate::spatial::advance_body_contacts(
        &collision,
        &bodies,
        Guid(0xda55_ffff),
        crate::spatial::MOBILE_CONTACT_TICK_SECONDS,
        |_, _| crate::spatial::ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    assert_eq!(updates.len(), 1);
    let update = &updates[0];
    assert!(update.unavailable_owner.is_none());
    assert!((update.displacement.x - CONTACT_EPSILON).abs() < 0.0001);
    assert!(
        (update.displacement.y - 3.0 * crate::spatial::MOBILE_CONTACT_TICK_SECONDS).abs() < 0.0001
    );
    let normal = update
        .motion
        .iter()
        .find_map(|segment| match segment {
            crate::spatial::ContactMotionSegment::Impact { hit, .. } => Some(hit.contact().normal),
            _ => None,
        })
        .unwrap();
    // The permitted band gives tangential travel a small head start around the curved target.
    // Response must remove velocity along the actual contact normal, not its initial radial axis.
    assert!(normal.x < -0.99);
    let incoming = Vector3::new(2.0, 3.0, 0.0);
    let expected = incoming - normal * incoming.dot(&normal);
    assert!((update.velocity - expected).length() < 0.0001);
    let travel = update
        .motion
        .iter()
        .filter(|segment| matches!(segment, crate::spatial::ContactMotionSegment::Travel { .. }))
        .collect::<Vec<_>>();
    assert!(!travel.is_empty());
    assert_eq!(travel.first().unwrap().start_fraction(), 0.0);
    assert_eq!(travel.last().unwrap().end_fraction(), 1.0);
    assert!(
        travel
            .windows(2)
            .all(|pair| pair[0].end_fraction() == pair[1].start_fraction())
    );
    assert!(update.motion.iter().any(|segment| matches!(segment,
        crate::spatial::ContactMotionSegment::Impact {
            hit: crate::spatial::HardSphereSweepHit::Entity { body_id, .. }, fraction, ..
        } if *body_id == hard && *fraction > 0.0 && *fraction < 1.0)));
    let collected = crate::spatial::advance_body_contact_collection(
        &collision,
        &bodies,
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |_, _, _| ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    assert_eq!(collected.report_touches.len(), 2);
    for (recipient, peer) in [(player, hard), (hard, player)] {
        assert!(collected.report_touches.iter().any(|touch| {
            touch.contact.recipient == recipient && matches!(touch.contact.source,
                crate::spatial::CollisionReportSource::DynamicBody { peer: observed, .. } if observed == peer)
        }));
    }
    let mut lifetimes = crate::spatial::collision_report::CollisionReportLifetimes::default();
    assert_eq!(
        lifetimes
            .preview_touches(&collected.report_touches, now)
            .unwrap()
            .len(),
        2
    );
    lifetimes.commit_touches(&collected.report_touches, now);
    assert!(
        lifetimes
            .preview_touches(&collected.report_touches, now)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn contact_advance_preserves_unopposed_velocity_and_stops_at_unavailable_coverage() {
    for missing_coverage in [false, true] {
        let now = Instant::now();
        let mut collision = CollisionScene::new();
        collision.insert(flat_collision_asset(0)).unwrap();
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::LocalPlayer(Guid(1));
        let x = if missing_coverage { 191.89 } else { 90.0 };
        let radius = 0.1;
        scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 1.0)), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), radius),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let duration = crate::spatial::MOBILE_CONTACT_TICK_SECONDS;
        // Running-jump-scale velocity must survive even for a small mobile body.
        let velocity = Vector3::new(18.0, 0.0, 13.0);
        scene.body_mut(id).unwrap().retained.velocity = velocity;
        let updates = crate::spatial::advance_body_contacts(
            &collision,
            &[scene.body(id).unwrap().clone()],
            Guid(0xda55_ffff),
            duration,
            |_, _| {
                crate::spatial::ContactStepActuation::ballistic(if missing_coverage {
                    Vector3::new(0.0, 0.0, -9.8)
                } else {
                    Vector3::zero()
                })
            },
        )
        .unwrap();
        let update = &updates[0];
        if missing_coverage {
            assert!(update.unavailable_owner.is_some());
            assert_eq!(update.displacement, Vector3::zero());
            assert_eq!(update.velocity, Vector3::zero());
            assert!(update.motion.is_empty());
        } else {
            assert!(update.unavailable_owner.is_none());
            assert!((update.displacement - velocity * duration).length() < 0.0001);
            assert_eq!(update.velocity, velocity);
            assert_eq!(update.motion.len(), 1);
        }
    }
}

#[test]
fn prepared_local_player_separates_without_inheriting_incoming_mob_velocity() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let mob = SpatialBodyId::Entity(Guid(2));
    for (id, x, speed) in [(player, 90.0, 0.0), (mob, 90.9, -3.0)] {
        scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 0.5)), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), 0.5),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        scene.body_mut(id).unwrap().retained.velocity = Vector3::new(speed, 0.0, 0.0);
    }
    let bodies = [
        scene.body(player).unwrap().clone(),
        scene.body(mob).unwrap().clone(),
    ];
    let updates = advance_body_contacts(
        &collision,
        &bodies,
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |_, _| ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    let player_update = updates
        .iter()
        .find(|update| update.body_id == player)
        .unwrap();
    assert!(player_update.displacement.x < 0.0);
    assert_eq!(player_update.velocity, Vector3::zero());
    assert_eq!(player_update.accepted_motion.velocity, Vector3::zero());
    assert_eq!(
        updates
            .iter()
            .find(|update| update.body_id == mob)
            .unwrap()
            .velocity,
        Vector3::zero()
    );
}

#[test]
fn contact_relaxation_yields_on_floor_and_respects_hard_entities_over_multiple_steps() {
    for pinned in [false, true] {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let player = SpatialBodyId::LocalPlayer(Guid(1));
        let mob = SpatialBodyId::Entity(Guid(2));
        let hard = SpatialBodyId::Entity(Guid(3));
        for (id, x) in [(player, 90.0), (mob, 90.9), (hard, 91.9)] {
            if id == hard && !pinned {
                continue;
            }
            scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 0.5)), now));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(
                        free_definition(Vector3::zero(), 0.5),
                        false,
                    )),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            if id == hard {
                scene
                    .body_mut(id)
                    .unwrap()
                    .physical
                    .as_mut()
                    .unwrap()
                    .dynamic
                    .as_mut()
                    .unwrap()
                    .demand
                    .integration = LocalIntegrationDemand::Excluded;
            }
        }
        let anchor = Guid(0xda55_ffff);
        // A player biased against displacement relaxes more slowly when the mob is pinned.
        // Observe two seconds of recovery, independent of the configured tick duration.
        let recovery_ticks = (2.0 / crate::spatial::MOBILE_CONTACT_TICK_SECONDS).ceil() as usize;
        for _ in 0..recovery_ticks {
            let bodies = scene
                .body_store
                .bodies
                .values()
                .cloned()
                .collect::<Vec<_>>();
            let updates = crate::spatial::advance_body_contacts(
                &collision,
                &bodies,
                anchor,
                crate::spatial::MOBILE_CONTACT_TICK_SECONDS,
                |_, _| crate::spatial::ContactStepActuation::ballistic(Vector3::zero()),
            )
            .unwrap();
            for update in updates {
                assert!(update.unavailable_owner.is_none());
                assert_eq!(
                    update.velocity,
                    Vector3::zero(),
                    "separation must not launch a body"
                );
                assert!(
                    update
                        .motion
                        .iter()
                        .filter_map(crate::spatial::ContactMotionSegment::path)
                        .all(|path| {
                            (path.primary().final_point().center().z - 0.5).abs() < 1e-6
                        })
                );
                let body = scene.body_mut(update.body_id).unwrap();
                body.pose.coords = body.pose.coords + update.displacement;
                body.retained.velocity = update.velocity;
                body.physical
                    .as_mut()
                    .unwrap()
                    .dynamic
                    .as_mut()
                    .unwrap()
                    .placement = update.membership;
            }
        }
        let player_x = scene.body(player).unwrap().pose.coords.x;
        let mob_x = scene.body(mob).unwrap().pose.coords.x;
        assert!(player_x < 90.0);
        if pinned {
            assert!(
                (mob_x - (90.9 + CONTACT_EPSILON)).abs() < 0.0001,
                "hard target allowed yielding through it"
            );
        } else {
            assert!(
                mob_x - 90.9 + CONTACT_EPSILON >= 90.0 - player_x,
                "mobile body should receive at least the player correction share"
            );
        }
        // Finite-time separation rate depends on the tunable player weight; residual
        // compression is allowed. The hard target and no-momentum checks above remain strict.
        assert!(
            mob_x - player_x > 0.9,
            "relaxation must reduce the initial overlap"
        );
    }
}

#[test]
fn contact_relaxation_bounds_total_travel_across_many_contacts() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let radius = 0.5;
    // Deliberately compressed grid: each body encounters several overlapping neighbors.
    for index in 0..9 {
        let id = if index == 4 {
            SpatialBodyId::LocalPlayer(Guid(index + 1))
        } else {
            SpatialBodyId::Entity(Guid(index + 1))
        };
        let center = Vector3::new(
            90.0 + (index % 3) as f32 * radius,
            96.0 + (index / 3) as f32 * radius,
            radius,
        );
        scene.register_body(SpatialBody::new(id, pose(center), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), radius),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    let bodies = scene
        .body_store
        .bodies
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let updates = crate::spatial::advance_body_contacts(
        &collision,
        &bodies,
        Guid(0xda55_ffff),
        crate::spatial::MOBILE_CONTACT_TICK_SECONDS,
        |_, _| crate::spatial::ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    let allowance = radius * crate::spatial::MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO;
    let rounding_tolerance = 0.0001;
    let mut exhausted = false;
    for update in updates {
        assert!(update.unavailable_owner.is_none());
        assert_eq!(update.velocity, Vector3::zero());
        let mut center = scene.body(update.body_id).unwrap().pose.coords;
        let mut travel = 0.0;
        for path in update
            .motion
            .iter()
            .filter_map(crate::spatial::ContactMotionSegment::path)
        {
            let next = path.primary().final_point().center();
            travel += (next - center).length();
            center = next;
        }
        // Net displacement alone would miss a body spending the allowance repeatedly
        // in opposing directions during the fixed passes.
        assert!(travel <= allowance + rounding_tolerance, "travel={travel}");
        assert!(update.displacement.length() <= travel + rounding_tolerance);
        exhausted |= travel >= allowance - rounding_tolerance;
    }
    assert!(
        exhausted,
        "fixture must exercise an exhausted correction allowance"
    );
}

#[test]
fn contact_relaxation_preserves_other_progress_when_one_correction_lacks_coverage() {
    let now = Instant::now();
    let mut collision = CollisionScene::new();
    collision.insert(flat_collision_asset(0)).unwrap();
    let mut scene = SpatialScene::new();
    let first = SpatialBodyId::LocalPlayer(Guid(1));
    let second = SpatialBodyId::Entity(Guid(2));
    for (id, x) in [(first, 191.74), (second, 191.89)] {
        scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 1.0)), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), 0.1),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    let bodies = scene
        .body_store
        .bodies
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let updates = crate::spatial::advance_body_contacts(
        &collision,
        &bodies,
        Guid(0xda55_ffff),
        crate::spatial::MOBILE_CONTACT_TICK_SECONDS,
        |_, _| crate::spatial::ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    let first_update = updates
        .iter()
        .find(|update| update.body_id == first)
        .unwrap();
    let second_update = updates
        .iter()
        .find(|update| update.body_id == second)
        .unwrap();
    assert!(first_update.displacement.x < 0.0);
    assert!(first_update.unavailable_owner.is_none());
    assert_eq!(second_update.displacement, Vector3::zero());
    assert!(second_update.unavailable_owner.is_some());

    // The public collection preserves ordinary motion even if the later separation cannot
    // prove coverage. Rejection is an observation, not a replacement for the accepted prefix.
    let collection = scene
        .advance_dynamic_entity_collection(&collision, MOBILE_CONTACT_TICK_SECONDS, now, |_| {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::free_flight(Vector3::new(0.0, 1.0, 0.0))?,
            ))
        })
        .unwrap();
    let DynamicEntityBodyOutcome::Integrated(second_result) = collection
        .outcomes
        .iter()
        .find(|outcome| outcome.body_id() == second)
        .unwrap()
    else {
        panic!("partial coverage must retain integrated movement")
    };
    assert!(second_result.displacement.y > 0.0);
    assert!(
        collection
            .coverage_rejections
            .iter()
            .any(|rejection| rejection.body_id == second)
    );
    assert_eq!(
        second_result.current_contact,
        scene.body(second).unwrap().contact
    );
}

fn publish_contact_updates(scene: &mut SpatialScene, updates: Vec<ContactBodyUpdate>) {
    for update in updates {
        assert!(update.unavailable_owner.is_none());
        let mut body = scene.body(update.body_id).unwrap().clone();
        update.apply_physical_state(&mut body).unwrap();
        scene.update_body(body).unwrap();
    }
}

#[test]
fn modest_step_head_on_contact_preserves_order_and_allows_escape() {
    for radii in [[0.5, 0.5], [0.1, 0.5]] {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let player = SpatialBodyId::LocalPlayer(Guid(1));
        let mob = SpatialBodyId::Entity(Guid(2));
        let separation = radii[0] + radii[1];
        for (index, id) in [player, mob].into_iter().enumerate() {
            scene.register_body(SpatialBody::new(
                id,
                pose(Vector3::new(90.0 + index as f32 * separation, 96.0, 1.0)),
                now,
            ));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(
                        free_definition(Vector3::zero(), radii[index]),
                        false,
                    )),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            let speed = radii[index] * MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO
                / MOBILE_CONTACT_TICK_SECONDS;
            scene.body_mut(id).unwrap().retained.velocity =
                Vector3::new(if index == 0 { speed } else { -speed }, 0.0, 0.0);
        }
        for _ in 0..16 {
            let bodies = [
                scene.body(player).unwrap().clone(),
                scene.body(mob).unwrap().clone(),
            ];
            let updates = advance_body_contacts(
                &collision,
                &bodies,
                Guid(0xda55_ffff),
                MOBILE_CONTACT_TICK_SECONDS,
                |_, _| ContactStepActuation::ballistic(Vector3::zero()),
            )
            .unwrap();
            publish_contact_updates(&mut scene, updates);
            assert!(
                scene.body(player).unwrap().pose.coords.x < scene.body(mob).unwrap().pose.coords.x,
                "admitted opposing travel crossed body centers"
            );
            for id in [player, mob] {
                assert_eq!(scene.body(id).unwrap().retained.velocity.z, 0.0);
            }
        }
        let before =
            scene.body(mob).unwrap().pose.coords.x - scene.body(player).unwrap().pose.coords.x;
        // A reverse input must overcome only bounded motor recovery, never an overlap veto.
        for _ in 0..120 {
            let bodies = [
                scene.body(player).unwrap().clone(),
                scene.body(mob).unwrap().clone(),
            ];
            let updates = advance_body_contacts(
                &collision,
                &bodies,
                Guid(0xda55_ffff),
                MOBILE_CONTACT_TICK_SECONDS,
                |body, _| {
                    ContactStepActuation::driven(
                        Vector3::zero(),
                        Vector3::new(if body.id == player { -2.0 } else { 2.0 }, 0.0, 0.0),
                        Vector3::new(0.0, 0.0, 1.0),
                    )
                },
            )
            .unwrap();
            publish_contact_updates(&mut scene, updates);
        }
        let after =
            scene.body(mob).unwrap().pose.coords.x - scene.body(player).unwrap().pose.coords.x;
        assert!(
            after > before + separation,
            "reverse motors did not release contact"
        );
    }
}

#[test]
fn driven_corner_crowd_respects_hard_walls_and_releases_the_player() {
    let now = Instant::now();
    let mut collision = flat_collision_scene();
    let mut asset = flat_collision_asset(0);
    let corner = Vector3::new(92.0, 98.0, 1.0);
    let walls = [
        Quaternion::identity(),
        Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), std::f32::consts::FRAC_PI_2)
            .unwrap(),
    ]
    .into_iter()
    .enumerate()
    .map(|(source_index, orientation)| {
        PlacedCollider::new(
            polygon_wall_shape(),
            LandblockPlacement {
                origin: corner,
                orientation,
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index },
        )
        .unwrap()
    })
    .collect();
    asset.static_geometry = LandblockColliders::new(walls, Vec::new());
    collision.insert(asset).unwrap();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let ids = [
        player,
        SpatialBodyId::Entity(Guid(2)),
        SpatialBodyId::Entity(Guid(3)),
    ];
    let radius = 0.5;
    for (id, (x, y)) in ids
        .into_iter()
        .zip([(90.55, 97.5), (91.5, 97.5), (91.5, 96.55)])
    {
        scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, y, radius)), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    grounded_definition_with_spheres(
                        PhysicalSphereSet::new(
                            Sphere {
                                center: Vector3::zero(),
                                radius,
                            },
                            None,
                        )
                        .unwrap(),
                    ),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    let mut release_origin = Vector3::zero();
    for step in 0..480 {
        if step == 360 {
            release_origin = scene.body(player).unwrap().pose.coords;
        }
        for id in ids {
            scene.wake_dynamic_body(id);
        }
        let update = scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs_f32((step + 1) as f32 * MOBILE_CONTACT_TICK_SECONDS),
                |body| {
                    let direction = if body.id == player && step >= 360 {
                        -1.0
                    } else {
                        1.0
                    };
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::grounded_drive(Vector3::new(
                            direction, direction, 0.0,
                        ))?,
                        PhysicalReferenceInput::body(None),
                        true,
                    ))
                },
            )
            .unwrap();
        assert!(update.coverage_rejections.is_empty());
        for id in ids {
            let body = scene.body(id).unwrap();
            assert!(
                body.pose.coords.x <= corner.x - radius + FLY_CONFIG.separation_epsilon,
                "crossed x wall: {:?}",
                body.pose.coords
            );
            assert!(
                body.pose.coords.y <= corner.y - radius + FLY_CONFIG.separation_epsilon,
                "crossed y wall: {:?}",
                body.pose.coords
            );
            assert_eq!(body.retained.velocity.z, 0.0);
            assert!((body.pose.coords.z - radius).abs() <= GROUNDED_CONFIG.separation_epsilon);
        }
    }
    let escaped = scene.body(player).unwrap().pose.coords;
    assert!(
        escaped.x < release_origin.x - radius && escaped.y < release_origin.y - radius,
        "player could not reverse out of the corner: {release_origin:?} -> {escaped:?}"
    );
}

#[test]
fn clipped_body_paths_retain_only_accepted_upper_sphere_domains() {
    for (start_x, upper_inside) in [(99.49, true), (99.34, false)] {
        let now = Instant::now();
        let collision = thin_cell_collision_scene();
        let player = SpatialBodyId::LocalPlayer(Guid(1));
        let hard = SpatialBodyId::Entity(Guid(2));
        let radius = 0.05;
        let spheres = PhysicalSphereSet::new(
            Sphere {
                center: Vector3::zero(),
                radius,
            },
            Some(Sphere {
                center: Vector3::new(0.6, 0.0, 1.0),
                radius,
            }),
        )
        .unwrap();
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            player,
            pose(Vector3::new(start_x, 96.0, 1.0)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                player,
                Some(dynamic_definition(
                    grounded_definition_with_spheres(spheres),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        scene.body_mut(player).unwrap().retained.velocity = Vector3::new(
            radius * MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO / MOBILE_CONTACT_TICK_SECONDS,
            0.0,
            0.0,
        );
        install_free_dynamic_with_radius(
            &mut scene,
            hard,
            Vector3::new(start_x + 2.0 * radius + 0.003, 96.0, 1.0),
            Vector3::zero(),
            radius,
            fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius,
            }))),
            now,
        );
        scene
            .body_mut(hard)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap()
            .demand
            .integration = LocalIntegrationDemand::Excluded;
        let bodies = [
            scene.body(player).unwrap().clone(),
            scene.body(hard).unwrap().clone(),
        ];
        let updates = advance_body_contacts(
            &collision,
            &bodies,
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |_, _| ContactStepActuation::ballistic(Vector3::zero()),
        )
        .unwrap();
        let update = &updates[0];
        assert!(update.unavailable_owner.is_none());
        assert!(
            update.displacement.x > 0.0 && update.displacement.x < 0.005,
            "fixture did not clip before the upper sphere's portal entry: {:?}",
            update.displacement
        );
        let cell = Guid(0xda55_0100);
        assert_eq!(update.membership.committed_cell(), None);
        assert_eq!(
            update.membership.reached_env_cells().contains(&cell),
            upper_inside
        );
        for segment in &update.motion {
            let Some(path) = segment.path() else {
                continue;
            };
            assert!(
                !path
                    .primary()
                    .final_point()
                    .placement()
                    .reached_env_cells()
                    .contains(&cell)
            );
            assert_eq!(
                path.membership().reached_env_cells().contains(&cell),
                upper_inside
            );
            assert_eq!(
                path.reached_membership()
                    .reached_env_cells()
                    .contains(&cell),
                upper_inside
            );
        }
    }
}

fn bsp_stair_scene() -> CollisionScene {
    let mut polygons = HashMap::new();
    for (index, (front, end, height)) in [(90.5, 91.5, 0.3), (91.5, 100.0, 0.6)]
        .into_iter()
        .enumerate()
    {
        for (face, vertices, normal) in [
            (
                0,
                vec![
                    Vector3::new(front, 94.0, 0.0),
                    Vector3::new(front, 94.0, height),
                    Vector3::new(front, 98.0, height),
                    Vector3::new(front, 98.0, 0.0),
                ],
                Vector3::new(-1.0, 0.0, 0.0),
            ),
            (
                1,
                vec![
                    Vector3::new(front, 94.0, height),
                    Vector3::new(end, 94.0, height),
                    Vector3::new(end, 98.0, height),
                    Vector3::new(front, 98.0, height),
                ],
                Vector3::new(0.0, 0.0, 1.0),
            ),
        ] {
            let id = (index * 2 + face) as u16;
            let d = -normal.dot(&vertices[0]);
            polygons.insert(
                id,
                CollisionPolygon {
                    vertices,
                    normal,
                    d,
                },
            );
        }
    }
    collision_with_polygons(polygons)
}

fn collision_with_polygons(polygons: HashMap<u16, CollisionPolygon>) -> CollisionScene {
    let box_bounds = CollisionBox::from_points(
        polygons
            .values()
            .flat_map(|polygon| polygon.vertices.iter().copied()),
    )
    .unwrap();
    let bounds = Sphere {
        center: box_bounds.center(),
        radius: box_bounds.circumradius(),
    };
    let shape = Arc::new(CollisionShape::Bsp(BspSolid {
        bsp: BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: Some(bounds),
            poly_ids: polygons.keys().copied().collect(),
        }),
        bounds,
        box_bounds,
        polygons,
    }));
    let collider = PlacedCollider::new(
        shape,
        LandblockPlacement {
            origin: Vector3::zero(),
            orientation: Quaternion::identity(),
        },
        ColliderScale::uniform(1.0).unwrap(),
        StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
    )
    .unwrap();
    let mut asset = flat_collision_asset(0);
    asset.static_geometry = LandblockColliders::new(vec![collider], Vec::new());
    let mut collision = flat_collision_scene();
    collision.insert(asset).unwrap();
    collision
}

#[test]
fn crowd_correction_steps_up_without_generating_velocity_or_timed_travel() {
    let now = Instant::now();
    let collision = bsp_stair_scene();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let mob = SpatialBodyId::Entity(Guid(2));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let floor_z = primary.radius - primary.center.z;
    for (id, x) in [(player, 90.4), (mob, 91.05)] {
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(x, 96.0, floor_z + 0.3)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    let bodies = [
        scene.body(player).unwrap().clone(),
        scene.body(mob).unwrap().clone(),
    ];
    let updates = advance_body_contacts(
        &collision,
        &bodies,
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |_, _| ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    let moved = updates.iter().find(|update| update.body_id == mob).unwrap();
    assert!(
        moved.displacement.z > 0.2,
        "correction did not climb: {:?}",
        moved.displacement
    );
    assert!(moved.ground.walkable_support().is_some());
    assert_eq!(moved.velocity, Vector3::zero());
    assert_eq!(moved.accepted_motion.velocity, Vector3::zero());
    assert!(
        moved
            .motion
            .iter()
            .all(|segment| !matches!(segment, crate::spatial::ContactMotionSegment::Travel { .. }))
    );
}

#[test]
fn bsp_stairs_allow_forward_progress_with_a_mobile_body_on_the_steps() {
    for with_mob in [false, true] {
        let now = Instant::now();
        let collision = bsp_stair_scene();
        let mut scene = SpatialScene::new();
        let player = SpatialBodyId::LocalPlayer(Guid(1));
        let mob = SpatialBodyId::Entity(Guid(2));
        let definition = grounded_definition();
        let primary = definition.spheres().primary();
        let floor_z = primary.radius - primary.center.z;
        for (id, x, z) in [(player, 89.5, floor_z), (mob, 91.0, floor_z + 0.3)] {
            if id == mob && !with_mob {
                continue;
            }
            scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, z)), now));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(definition, false)),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
        }
        // Occupied stairs now require sustained slow pushing; hard clearance and eventual
        // top support remain the invariant, not the former near-free-running completion time.
        let seconds = if with_mob {
            4.0 / crate::spatial::mobile_contact::MOBILE_PUSH_THROUGH_SPEED
        } else {
            2.0
        };
        for _ in 0..(seconds / MOBILE_CONTACT_TICK_SECONDS).round() as usize {
            let bodies = scene
                .body_store
                .bodies
                .values()
                .cloned()
                .collect::<Vec<_>>();
            let updates = advance_body_contacts(
                &collision,
                &bodies,
                Guid(0xda55_ffff),
                MOBILE_CONTACT_TICK_SECONDS,
                |body, ground| {
                    let actuation = if body.id == player {
                        GroundedBodyActuation::drive(Vector3::new(5.0, 0.0, 0.0)).unwrap()
                    } else {
                        GroundedBodyActuation::coast()
                    };
                    grounded_step_input(body, ground, &actuation)
                },
            )
            .unwrap();
            for update in &updates {
                if let Some(support) = update.ground.walkable_support() {
                    assert!(
                        update.velocity.dot(&support.normal).abs()
                            <= crate::spatial::bsp_query::CONTACT_EPSILON,
                        "supported stair body retained normal velocity: {:?}",
                        update.velocity
                    );
                }
            }
            publish_contact_updates(&mut scene, updates);
            for body in scene.body_store.bodies.values() {
                assert!(body.pose.coords.z >= floor_z - GROUNDED_CONFIG.separation_epsilon);
            }
        }
        let position = scene.body(player).unwrap().pose.coords;
        assert!(
            position.x > 92.0,
            "stair progress stopped (mob={with_mob}): {position:?}, player {:?}, occupant {:?}",
            scene.body(player).map(|body| (
                body.retained.velocity,
                body.physical.as_ref().unwrap().response
            )),
            scene
                .body(mob)
                .map(|body| (body.pose.coords, body.retained.velocity))
        );
        assert!(
            (position.z - floor_z - 0.6).abs() < GROUNDED_CONFIG.separation_epsilon,
            "player did not retain top support (mob={with_mob}): {position:?}"
        );
        if with_mob {
            assert!(
                scene.body(mob).unwrap().pose.coords.x > 91.5,
                "contact never moved the stair occupant"
            );
            // Mobile ordering is not exhaustive; stair clearance and support above are
            // the invariant, even when a strongly biased player passes the yielding occupant.
        }
    }
}

#[test]
fn retained_support_is_invalidated_by_launch_or_owner_replacement() {
    for replace_owner in [false, true] {
        let now = Instant::now();
        let mut collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let player = SpatialBodyId::LocalPlayer(Guid(1));
        let definition = grounded_definition();
        let primary = definition.spheres().primary();
        scene.register_body(SpatialBody::new(
            player,
            pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                player,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        // Grounded gravity belongs to the response, not an additive server force snapshot.
        scene.body_mut(player).unwrap().retained.acceleration = Vector3::new(99.0, 99.0, 99.0);
        let updates = advance_body_contacts(
            &collision,
            &[scene.body(player).unwrap().clone()],
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |body, ground| {
                assert!(ground.walkable_support().is_some());
                grounded_step_input(body, ground, &GroundedBodyActuation::coast())
            },
        )
        .unwrap();
        publish_contact_updates(&mut scene, updates);
        if replace_owner {
            let mut replacement = flat_collision_asset(0);
            replacement.terrain = TerrainCollisionSurface::empty();
            collision.insert(replacement).unwrap();
        } else {
            scene.body_mut(player).unwrap().retained.velocity.z = 2.0;
        }
        let updates = advance_body_contacts(
            &collision,
            &[scene.body(player).unwrap().clone()],
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |body, ground| {
                assert!(matches!(ground, GroundState::Airborne));
                grounded_step_input(body, ground, &GroundedBodyActuation::coast())
            },
        )
        .unwrap();
        let update = &updates[0];
        assert!(update.unavailable_owner.is_none());
        assert!(matches!(update.ground, GroundState::Airborne));
        assert_eq!(update.velocity.x, 0.0);
        assert_eq!(update.velocity.y, 0.0);
        if replace_owner {
            assert!(update.displacement.z < 0.0 && update.velocity.z < 0.0);
        } else {
            assert!(update.displacement.z > 0.0 && update.velocity.z > 0.0);
        }
    }
}

fn grounded_step_input(
    body: &SpatialBody,
    ground: GroundState,
    actuation: &GroundedBodyActuation,
) -> anyhow::Result<ContactStepActuation> {
    PhysicalBodyActuation::Grounded(actuation.clone()).contact_step_input(
        body.physical
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("contact input requires body physics"))?,
        body.pose.rotation,
        body.retained.acceleration,
        ground,
        None,
        MOBILE_CONTACT_TICK_SECONDS,
    )
}

#[test]
fn confirmation_uses_newly_proved_support_before_movement() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let position = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
    let target = Vector3::new(2.0, 0.0, 0.0);
    let mut body = SpatialBody::new(player, position, now);
    body.retained.velocity = target;
    let mut confirmed = position;
    let (_, maximum) = crate::spatial::pose_reconciliation::retail_constraint_distances(position);
    confirmed.coords.x -= maximum;
    let mut reconciliation = crate::spatial::PoseReconciliationState::default();
    reconciliation.confirm(confirmed, position);
    body.reconciliation = Some(Box::new(reconciliation));
    scene.register_body(body);
    scene
        .set_dynamic_physical_body(
            player,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    assert_eq!(scene.body(player).unwrap().contact, ContactState::Unknown);
    let input = crate::spatial::PhysicalBodyInput::referenced(
        PhysicalBodyActuation::Grounded(GroundedBodyActuation::drive(target).unwrap()),
        crate::spatial::PhysicalReferenceInput::body(None),
        false,
    );
    scene
        .advance_dynamic_entity_collection(&collision, MOBILE_CONTACT_TICK_SECONDS, now, |_| {
            Ok(input.clone())
        })
        .unwrap();
    let body = scene.body(player).unwrap();
    assert_eq!(body.contact, ContactState::Grounded);
    // Exhausted confirmation travel suppresses character drive on the first supported tick.
    assert_eq!(body.retained.velocity, Vector3::zero());
}

#[test]
fn supported_character_bursts_stop_and_reverse_without_reference_lag() {
    for id in [
        SpatialBodyId::LocalPlayer(Guid(1)),
        SpatialBodyId::Entity(Guid(1)),
    ] {
        for speed in [2.0, 8.0, 17.2] {
            let now = Instant::now();
            let collision = flat_collision_scene();
            let mut scene = SpatialScene::new();
            let definition = grounded_definition();
            let sphere = definition.spheres().primary();
            scene.register_body(SpatialBody::new(
                id,
                pose(Vector3::new(90.0, 96.0, sphere.radius - sphere.center.z)),
                now,
            ));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(definition, false)),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            acquire_support(&mut scene, &collision, id, now);
            let forward = Vector3::new(0.0, speed, 0.0);
            let side = Vector3::new(speed, 0.0, 0.0);
            for (tick, command) in [
                forward,
                forward,
                forward,
                Vector3::zero(),
                forward * -1.0,
                forward * -1.0,
                side,
                Vector3::zero(),
            ]
            .into_iter()
            .enumerate()
            {
                let before = scene.body(id).unwrap().pose;
                let interval = MOBILE_CONTACT_TICK_SECONDS;
                let authored_offset =
                    (command != Vector3::zero()).then_some(holtburger_common::RigidTransform {
                        translation: command * interval,
                        rotation: Quaternion::identity(),
                    });
                scene
                    .advance_dynamic_entity_collection(
                        &collision,
                        interval,
                        now + Duration::from_secs_f32(tick as f32 * interval),
                        |_| {
                            Ok(PhysicalBodyInput::referenced(
                                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                                PhysicalReferenceInput::body(authored_offset),
                                true,
                            ))
                        },
                    )
                    .unwrap();
                let body = scene.body(id).unwrap();
                assert!((body.retained.velocity - command).length() < CONTACT_EPSILON);
                assert!((body.nominal.velocity - command).length() < CONTACT_EPSILON);
                assert!(
                    (body.pose.coords - before.coords - command * interval).length()
                        < CONTACT_EPSILON
                );
                assert!(
                    !body.has_pose_reconciliation_work(),
                    "ordinary burst created return lag"
                );
                assert_eq!(body.contact, ContactState::Grounded);
            }
        }
    }
}

#[test]
fn ordinary_free_impacts_apply_authored_bounce_or_inelastic_stop() {
    for restitution in [
        PhysicalRestitution::Elastic(PhysicalElasticity::MAXIMUM),
        PhysicalRestitution::Inelastic,
    ] {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let mover = SpatialBodyId::Entity(Guid(1));
        let hard = SpatialBodyId::Entity(Guid(2));
        for (id, x) in [(mover, 90.0), (hard, 91.0)] {
            scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 1.0)), now));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(
                        free_definition(Vector3::zero(), 0.5),
                        false,
                    )),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
        }
        scene.body_mut(mover).unwrap().retained.velocity = Vector3::new(2.0, 3.0, 0.0);
        scene
            .body_mut(mover)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .response_policy
            .restitution = restitution;
        scene
            .body_mut(hard)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap()
            .demand
            .integration = LocalIntegrationDemand::Excluded;
        let bodies = [
            scene.body(mover).unwrap().clone(),
            scene.body(hard).unwrap().clone(),
        ];
        let updates = advance_body_contacts(
            &collision,
            &bodies,
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |_, _| ContactStepActuation::ballistic(Vector3::zero()),
        )
        .unwrap();
        let update = &updates[0];
        assert!(update.unavailable_owner.is_none());
        let (normal, fraction) = update
            .motion
            .iter()
            .find_map(|segment| match segment {
                crate::spatial::ContactMotionSegment::Impact { hit, fraction, .. } => {
                    Some((hit.contact().normal, *fraction))
                }
                _ => None,
            })
            .unwrap();
        assert!(normal.x < -0.99);
        let incoming = Vector3::new(2.0, 3.0, 0.0);
        let expected = match restitution {
            PhysicalRestitution::Elastic(elasticity) => {
                incoming - normal * ((1.0 + elasticity.get()) * incoming.dot(&normal))
            }
            PhysicalRestitution::Inelastic => Vector3::zero(),
        };
        assert!((update.velocity - expected).length() < 0.0001);
        let travel =
            (incoming * fraction + expected * (1.0 - fraction)) * MOBILE_CONTACT_TICK_SECONDS;
        assert!((update.displacement - travel).length() < 0.0001);
    }
}

#[test]
fn grounded_landing_bounces_then_settles_without_persistent_tiny_rebounds() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let mover = SpatialBodyId::Entity(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let floor_z = primary.radius - primary.center.z;
    scene.register_body(SpatialBody::new(
        mover,
        pose(Vector3::new(90.0, 96.0, floor_z + 0.3)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            mover,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let initial_fall_speed = 2.0;
    scene.body_mut(mover).unwrap().retained.velocity.z = -initial_fall_speed;
    scene
        .body_mut(mover)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .response_policy
        .restitution = PhysicalRestitution::Elastic(PhysicalElasticity::MAXIMUM);
    let mut bounced = false;
    for _ in 0..240 {
        let updates = advance_body_contacts(
            &collision,
            &[scene.body(mover).unwrap().clone()],
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |body, ground| grounded_step_input(body, ground, &GroundedBodyActuation::coast()),
        )
        .unwrap();
        let update = &updates[0];
        let rebound = update.velocity.z > initial_fall_speed * PhysicalElasticity::MAXIMUM.get();
        if !bounced && rebound {
            assert!(matches!(update.ground, GroundState::Airborne));
            assert!(
                update.motion.iter().any(|segment| matches!(
                    segment,
                    crate::spatial::ContactMotionSegment::Impact { .. }
                )),
                "accepted landing lost its impact while rebounding"
            );
        }
        bounced |= rebound;
        assert!(
            scene.body(mover).unwrap().pose.coords.z + update.displacement.z
                >= floor_z - GROUNDED_CONFIG.separation_epsilon
        );
        publish_contact_updates(&mut scene, updates);
    }
    assert!(bounced, "landing did not exercise authored restitution");
    let body = scene.body(mover).unwrap();
    assert_eq!(body.retained.velocity, Vector3::zero());
    let PhysicalBodyResponseState::Grounded { ground, .. } =
        body.physical.as_ref().unwrap().response
    else {
        panic!("grounded fixture lost response");
    };
    assert!(
        ground.walkable_support().is_some(),
        "tiny rebounds prevented stable support"
    );
}

#[test]
fn supported_launch_replaces_velocity_then_continues_ballistically() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    scene.register_body(SpatialBody::new(
        player,
        pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            player,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    // Distinct incoming motion and opposing drive expose accidental addition, friction or braking.
    scene.body_mut(player).unwrap().retained.velocity = Vector3::new(-2.0, 0.0, 0.0);
    let launch = crate::spatial::GroundedLaunch::new(Vector3::new(18.0, 0.0, 13.0)).unwrap();
    let drive = GroundedBodyActuation::drive(Vector3::new(-8.0, 0.0, 0.0)).unwrap();
    for step in 0..3 {
        // A request made while airborne is rejected by support admission, not re-applied.
        let input = if step == 1 {
            drive.clone()
        } else {
            drive.clone().with_launch(launch)
        };
        let updates = advance_body_contacts(
            &collision,
            &[scene.body(player).unwrap().clone()],
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |body, ground| grounded_step_input(body, ground, &input),
        )
        .unwrap();
        let update = &updates[0];
        assert_eq!(update.launch_admitted, step == 0);
        assert!(matches!(update.ground, GroundState::Airborne));
        let expected = launch.velocity()
            + Vector3::new(
                0.0,
                0.0,
                GROUNDED_CONFIG.gravity * MOBILE_CONTACT_TICK_SECONDS * (step + 1) as f32,
            );
        assert!(
            (update.velocity - expected).length() < 0.0001,
            "velocity {:?}, expected {:?}",
            update.velocity,
            expected
        );
        assert!((update.displacement - expected * MOBILE_CONTACT_TICK_SECONDS).length() < 0.0001);
        publish_contact_updates(&mut scene, updates);
    }
}

#[test]
fn ordinary_edge_protection_keeps_footing_and_tangent_motion_but_accepts_short_drops() {
    for (protected, height, wall) in [
        (true, 3.0, false),
        (false, 3.0, false),
        (true, 0.3, false),
        (true, 3.0, true),
    ] {
        let now = Instant::now();
        let mut polygons = HashMap::from([(
            0,
            CollisionPolygon {
                vertices: vec![
                    Vector3::new(90.0, 94.0, height),
                    Vector3::new(92.5, 94.0, height),
                    Vector3::new(92.5, 100.0, height),
                    Vector3::new(90.0, 100.0, height),
                ],
                normal: Vector3::new(0.0, 0.0, 1.0),
                d: -height,
            },
        )]);
        let wall_y = 96.7;
        if wall {
            polygons.insert(
                1,
                CollisionPolygon {
                    vertices: vec![
                        Vector3::new(90.0, wall_y, 0.0),
                        Vector3::new(95.0, wall_y, 0.0),
                        Vector3::new(95.0, wall_y, 6.0),
                        Vector3::new(90.0, wall_y, 6.0),
                    ],
                    normal: Vector3::new(0.0, -1.0, 0.0),
                    d: wall_y,
                },
            );
        }
        let collision = collision_with_polygons(polygons);
        let mut scene = SpatialScene::new();
        let player = SpatialBodyId::LocalPlayer(Guid(1));
        let mut config = GROUNDED_CONFIG;
        config.edge_protection = if protected {
            EdgeProtection::Creature
        } else {
            EdgeProtection::None
        };
        let definition =
            PhysicalBodyDefinition::grounded(grounded_definition().spheres(), config).unwrap();
        let primary = definition.spheres().primary();
        let floor_z = primary.radius - primary.center.z;
        let initial = Vector3::new(92.49, 96.0, height + floor_z);
        scene.register_body(SpatialBody::new(player, pose(initial), now));
        scene
            .set_dynamic_physical_body(
                player,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let drive_velocity = Vector3::new(3.0, 1.0, 0.0);
        let drive = GroundedBodyActuation::drive(drive_velocity).unwrap();
        scene.body_mut(player).unwrap().retained.velocity = drive_velocity;
        for _ in 0..60 {
            let updates = advance_body_contacts(
                &collision,
                &[scene.body(player).unwrap().clone()],
                Guid(0xda55_ffff),
                MOBILE_CONTACT_TICK_SECONDS,
                |body, ground| grounded_step_input(body, ground, &drive),
            )
            .unwrap();
            assert!(updates[0].unavailable_owner.is_none());
            let start_center = scene.body(player).unwrap().pose.coords + primary.center;
            let mut accepted_center = start_center;
            for path in updates[0]
                .motion
                .iter()
                .filter_map(crate::spatial::ContactMotionSegment::path)
            {
                assert!(
                    (path.primary().initial().center() - accepted_center).length()
                        < config.separation_epsilon
                );
                accepted_center = path.primary().final_point().center();
            }
            assert!(
                (accepted_center - start_center - updates[0].displacement).length()
                    < config.separation_epsilon
            );
            if protected && height > config.step_down_height {
                assert!(
                    updates[0].ground.walkable_support().is_some(),
                    "lost protected footing: {:?}",
                    updates[0]
                );
            }
            publish_contact_updates(&mut scene, updates);
        }
        let final_pose = scene.body(player).unwrap().pose.coords;
        if wall {
            assert!(
                final_pose.y <= wall_y - primary.radius + config.separation_epsilon,
                "edge slide crossed hard wall: {final_pose:?}"
            );
        }
        if protected && height > config.step_down_height {
            assert!(
                final_pose.x <= 92.5 + primary.radius + config.separation_epsilon,
                "crossed protected edge: {final_pose:?}"
            );
            assert!(
                final_pose.y > initial.y + 0.1,
                "lost edge tangent motion: {final_pose:?}"
            );
            assert!((final_pose.z - initial.z).abs() < config.separation_epsilon);
        } else {
            assert!(
                final_pose.x > initial.x + 0.5,
                "did not leave edge: {final_pose:?}"
            );
            assert!(
                final_pose.z < initial.z - 0.1,
                "did not descend: {final_pose:?}"
            );
        }
    }
}

#[test]
fn centered_yaw_preserves_footing_without_sphere_traversal() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    scene.register_body(SpatialBody::new(
        player,
        pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            player,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let heading = 0.25;
    let input = GroundedBodyActuation::coast()
        .with_control_heading(heading)
        .unwrap();
    scene.body_mut(player).unwrap().retained.omega = Vector3::new(
        0.0,
        0.0,
        std::f32::consts::TAU / MOBILE_CONTACT_TICK_SECONDS,
    );
    let updates = advance_body_contacts(
        &collision,
        &[scene.body(player).unwrap().clone()],
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |body, ground| grounded_step_input(body, ground, &input),
    )
    .unwrap();
    let update = &updates[0];
    assert!(update.ground.walkable_support().is_some());
    assert!(update.motion.iter().all(|segment| !matches!(
        segment,
        crate::spatial::ContactMotionSegment::Rotation { .. }
    )));
    assert!(update.displacement.length() < GROUNDED_CONFIG.separation_epsilon);
    assert_eq!(update.velocity, Vector3::zero());
    let direction = Vector3::new(1.0, 0.0, 0.0);
    assert!(
        (update.rotation.rotate_vector(direction)
            - Quaternion::from_heading(heading).rotate_vector(direction))
        .length()
            < 0.0001
    );
}

#[test]
fn offset_rotation_preserves_root_and_checks_hard_obstacles_during_full_turns() {
    for projectile in [false, true] {
        for obstruction in 0..3 {
            let now = Instant::now();
            let mut collision = flat_collision_scene();
            let wall_y = 96.15;
            if obstruction == 1 {
                collision = collision_with_polygons(HashMap::from([(
                    0,
                    CollisionPolygon {
                        vertices: vec![
                            Vector3::new(89.0, wall_y, 0.0),
                            Vector3::new(94.0, wall_y, 0.0),
                            Vector3::new(94.0, wall_y, 4.0),
                            Vector3::new(89.0, wall_y, 4.0),
                        ],
                        normal: Vector3::new(0.0, -1.0, 0.0),
                        d: wall_y,
                    },
                )]));
            }
            let mut scene = SpatialScene::new();
            let player = SpatialBodyId::LocalPlayer(Guid(1));
            let root = Vector3::new(90.0, 96.0, 2.0);
            let offset = Vector3::new(1.0, 0.0, 0.0);
            let radius = 0.1;
            scene.register_body(SpatialBody::new(player, pose(root), now));
            scene
                .set_dynamic_physical_body(
                    player,
                    Some(dynamic_definition(free_definition(offset, radius), false)),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            if projectile {
                scene
                    .body_mut(player)
                    .unwrap()
                    .physical
                    .as_mut()
                    .unwrap()
                    .dynamic
                    .as_mut()
                    .unwrap()
                    .collision
                    .dynamic_collision
                    .missile = true;
            }
            scene.body_mut(player).unwrap().retained.omega = Vector3::new(
                0.0,
                0.0,
                std::f32::consts::TAU / MOBILE_CONTACT_TICK_SECONDS,
            );
            let target_center = root + offset + Vector3::new(0.0, 0.25, 0.0);
            if obstruction == 2 {
                let hard = SpatialBodyId::Entity(Guid(2));
                install_free_dynamic_with_radius(
                    &mut scene,
                    hard,
                    target_center,
                    Vector3::zero(),
                    radius,
                    fallback_target(Arc::new(CollisionShape::Ball(CollisionBall {
                        center: Vector3::zero(),
                        radius,
                    }))),
                    now,
                );
                scene
                    .body_mut(hard)
                    .unwrap()
                    .physical
                    .as_mut()
                    .unwrap()
                    .dynamic
                    .as_mut()
                    .unwrap()
                    .demand
                    .integration = LocalIntegrationDemand::Excluded;
            }
            let bodies = scene
                .body_store
                .bodies
                .values()
                .cloned()
                .collect::<Vec<_>>();
            let updates = advance_body_contacts(
                &collision,
                &bodies,
                Guid(0xda55_ffff),
                MOBILE_CONTACT_TICK_SECONDS,
                |_, _| ContactStepActuation::ballistic(Vector3::zero()),
            )
            .unwrap();
            let update = &updates[0];
            assert!(update.unavailable_owner.is_none());
            assert_eq!(
                update.projectile_impact.is_some(),
                projectile && obstruction != 0
            );
            assert!(
                update.displacement.length() < 0.0001,
                "rotation translated root: {:?}",
                update.displacement
            );
            assert_eq!(update.velocity, Vector3::zero());
            let chords = update
                .motion
                .iter()
                .filter(|segment| {
                    matches!(
                        segment,
                        crate::spatial::ContactMotionSegment::Rotation { .. }
                    )
                })
                .count();
            assert!(
                chords > 0,
                "full physical turn was mistaken for stationary geometry"
            );
            assert!(chords <= crate::spatial::MOBILE_CONTACT_ANGULAR_CHORDS);
            let final_center = root + update.rotation.rotate_vector(offset);
            let path_center = update
                .motion
                .iter()
                .filter_map(crate::spatial::ContactMotionSegment::path)
                .next_back()
                .unwrap()
                .primary()
                .final_point()
                .center();
            assert!((path_center - final_center).length() < 0.0001);
            if obstruction == 0 {
                assert_eq!(chords, crate::spatial::MOBILE_CONTACT_ANGULAR_CHORDS);
            } else {
                assert!(chords < crate::spatial::MOBILE_CONTACT_ANGULAR_CHORDS);
                if obstruction == 1 {
                    assert!(final_center.y + radius <= wall_y + GROUNDED_CONFIG.separation_epsilon);
                } else {
                    assert!(
                        (final_center - target_center).length()
                            >= 2.0 * radius - GROUNDED_CONFIG.separation_epsilon
                    );
                }
            }
        }
    }
}

#[test]
fn angular_paths_preserve_upper_only_cell_membership() {
    let now = Instant::now();
    let collision = thin_cell_collision_scene();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let spheres = PhysicalSphereSet::new(
        Sphere {
            center: Vector3::zero(),
            radius: 0.05,
        },
        Some(Sphere {
            center: Vector3::new(0.54, 0.6, 1.0),
            radius: 0.05,
        }),
    )
    .unwrap();
    let definition = PhysicalBodyDefinition::grounded(spheres, GROUNDED_CONFIG).unwrap();
    scene.register_body(SpatialBody::new(
        player,
        pose(Vector3::new(99.4, 96.0, 1.0)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            player,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    scene.body_mut(player).unwrap().retained.omega = Vector3::new(0.0, 0.0, -20.0);
    let updates = advance_body_contacts(
        &collision,
        &[scene.body(player).unwrap().clone()],
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |_, _| ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    let update = &updates[0];
    assert!(update.unavailable_owner.is_none());
    assert!(update.displacement.length() < 0.0001);
    let cell = Guid(0xda55_0100);
    assert_eq!(update.membership.committed_cell(), None);
    assert!(update.membership.reached_env_cells().contains(&cell));
    assert!(!update.motion.is_empty());
    for segment in &update.motion {
        let Some(path) = segment.path() else {
            continue;
        };
        assert!(
            !path
                .primary()
                .final_point()
                .placement()
                .reached_env_cells()
                .contains(&cell)
        );
    }
    assert!(
        update
            .motion
            .iter()
            .filter_map(crate::spatial::ContactMotionSegment::path)
            .next_back()
            .unwrap()
            .membership()
            .reached_env_cells()
            .contains(&cell)
    );
}

#[test]
fn unavailable_angular_coverage_keeps_checked_rotation_and_peer_progress() {
    let now = Instant::now();
    let mut collision = CollisionScene::new();
    collision.insert(flat_collision_asset(0)).unwrap();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let peer = SpatialBodyId::Entity(Guid(2));
    for (id, root, offset) in [
        (
            player,
            Vector3::new(191.3, 96.0, 2.0),
            Vector3::new(0.6, -0.6, 0.0),
        ),
        (peer, Vector3::new(90.0, 96.0, 2.0), Vector3::zero()),
    ] {
        scene.register_body(SpatialBody::new(id, pose(root), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(free_definition(offset, 0.05), false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    scene.body_mut(player).unwrap().retained.omega = Vector3::new(0.0, 0.0, 20.0);
    scene.body_mut(peer).unwrap().retained.velocity = Vector3::new(1.0, 0.0, 0.0);
    let updates = advance_body_contacts(
        &collision,
        &[
            scene.body(player).unwrap().clone(),
            scene.body(peer).unwrap().clone(),
        ],
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |_, _| ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    for update in updates {
        if update.body_id == player {
            assert!(update.unavailable_owner.is_some(), "{update:?}");
            assert!(update.displacement.length() < 0.0001);
            assert!(!update.motion.is_empty(), "lost checked angular prefix");
            assert_ne!(update.rotation, Quaternion::identity());
        } else {
            assert!(update.unavailable_owner.is_none());
            assert!((update.displacement.x - MOBILE_CONTACT_TICK_SECONDS).abs() < 0.0001);
        }
    }
}

#[test]
fn reference_prediction_can_leave_coverage_while_physical_motion_stops() {
    let now = Instant::now();
    let mut collision = CollisionScene::new();
    collision.insert(flat_collision_asset(0)).unwrap();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let start = pose(Vector3::new(191.9, 96.0, 2.0));
    scene.register_body(SpatialBody::new(id, start, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(
                free_definition(Vector3::zero(), 0.05),
                false,
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let velocity = Vector3::new(50.0, 0.0, 0.0);
    scene.body_mut(id).unwrap().retained.velocity = velocity;
    let body = scene.body(id).unwrap();
    let actuation = PhysicalBodyActuation::free_flight(velocity).unwrap();
    let predicted = crate::spatial::physical_body::predict_reference_motion(
        body,
        &actuation,
        MOBILE_CONTACT_TICK_SECONDS,
        AuthoritativeBodyVectors {
            velocity,
            acceleration: Vector3::zero(),
            omega: Vector3::zero(),
        },
        None,
        body.pose,
        body.physical.as_ref().unwrap().response.ground(),
    )
    .unwrap();
    assert!(
        start.coords.x + predicted.displacement.x
            > holtburger_common::position::METERS_PER_LANDBLOCK
    );
    assert_eq!(body.pose, start, "prediction changed canonical placement");
    // The physical body is still travelling at 50 m/s, but a stationary authority sample
    // must predict no travel or rotation. Neither actual continuation nor the flight
    // actuation's retained velocity is a nominal input.
    let stationary = crate::spatial::physical_body::predict_reference_motion(
        body,
        &actuation,
        MOBILE_CONTACT_TICK_SECONDS,
        AuthoritativeBodyVectors {
            velocity: Vector3::zero(),
            acceleration: Vector3::zero(),
            omega: Vector3::zero(),
        },
        None,
        body.pose,
        body.physical.as_ref().unwrap().response.ground(),
    )
    .unwrap();
    assert_eq!(stationary.displacement, Vector3::zero());
    assert_eq!(stationary.flight_rotation, Some(start.rotation));
    let mut reference = start;
    reference.rotation =
        Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), std::f32::consts::FRAC_PI_2)
            .unwrap();
    let offset = holtburger_common::RigidTransform {
        translation: Vector3::new(MOBILE_CONTACT_TICK_SECONDS, 0.0, 0.0),
        rotation: Quaternion::identity(),
    };
    let authored = crate::spatial::physical_body::predict_reference_motion(
        body,
        &actuation,
        MOBILE_CONTACT_TICK_SECONDS,
        AuthoritativeBodyVectors {
            velocity: Vector3::zero(),
            acceleration: Vector3::zero(),
            omega: Vector3::zero(),
        },
        Some(
            crate::spatial::body_movement::ResolvedAuthoredMotion::project(
                offset,
                body.pose.rotation,
                MOBILE_CONTACT_TICK_SECONDS,
            ),
        ),
        reference,
        body.physical.as_ref().unwrap().response.ground(),
    )
    .unwrap();
    let expected = reference.rotation.rotate_vector(offset.translation);
    assert!((authored.displacement - expected).length() < 0.0001);
    assert!(
        (authored.displacement - offset.translation).length() > 0.001,
        "authored reference travel inherited the actual body's heading"
    );

    let updates = advance_body_contacts(
        &collision,
        std::slice::from_ref(body),
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |_, _| ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    assert!(updates[0].unavailable_owner.is_some());
    assert_eq!(updates[0].displacement, Vector3::zero());
    assert_eq!(updates[0].velocity, Vector3::zero());
}

/// Return follows an independent stationary/moving target, including a packet-like replacement.
#[test]
fn character_return_tracks_reference_without_accumulating_nominal_speed() {
    use crate::spatial::{PHYSICAL_RETURN_GAIN, RETAIL_INTERPOLATION_TARGET_THRESHOLD_M};

    for ordinary_speed in [0.0, 2.0] {
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::LocalPlayer(Guid(1));
        let definition = grounded_definition();
        let primary = definition.spheres().primary();
        let start = Vector3::new(90.0, 96.0, primary.radius - primary.center.z);
        let ordinary = Vector3::new(ordinary_speed, 0.0, 0.0);
        let mut body = SpatialBody::new(id, pose(start), Instant::now());
        body.retained.velocity = ordinary;
        scene.register_body(body);
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let h = MOBILE_CONTACT_TICK_SECONDS;
        let sampled = PhysicalBodyInput::referenced(
            PhysicalBodyActuation::grounded_drive(ordinary).unwrap(),
            PhysicalReferenceInput::body(None),
            true,
        );
        let mut reconciliation = PoseReconciliationState::default();
        let mut reference = start + Vector3::new(1.0, 0.0, 0.0);
        // Long enough to expose the rejected accumulating-velocity recurrence, then repeat
        // with a target behind the body to exercise bounded reversal and braking.
        let steps = (6.0 / h).ceil() as usize;
        for epoch in 0..2 {
            if epoch == 1 {
                reference = scene.body(id).unwrap().pose.coords - Vector3::new(1.0, 0.0, 0.0);
            }
            reconciliation.correct(pose(reference), false);
            let initial_error = (reference - scene.body(id).unwrap().pose.coords).length();
            let maximum_drive =
                ordinary.length() + PHYSICAL_RETURN_GAIN * (initial_error + ordinary.length() * h);
            for _ in 0..steps {
                let previous = scene.body(id).unwrap().clone();
                let mut nominal_velocity = ordinary;
                let updates = crate::spatial::advance_body_contact_collection(
                    &collision,
                    std::slice::from_ref(&previous),
                    Guid(0xda55_ffff),
                    h,
                    |body, ground, delta_seconds| {
                        let mut pending = Some(reconciliation);
                        let input = sampled.step(body, ground, delta_seconds, &mut pending)?;
                        reconciliation =
                            pending.expect("step retains the supplied state container");
                        nominal_velocity = input.nominal_velocity;
                        assert!((nominal_velocity - ordinary).length() < 0.0001);
                        Ok(input.actuation)
                    },
                )
                .unwrap()
                .bodies;
                reference = reference + ordinary * h;
                let update = &updates[0];
                // A reversal can spend a tick braking to zero. Bound the full drive by its
                // initial error envelope instead of assuming immediate tracking during braking.
                assert!(update.velocity.length() <= maximum_drive + 0.0001);
                let mut accepted = previous.pose;
                accepted.coords = accepted.coords + update.displacement;
                reconciliation.finish_physical_tick(
                    accepted,
                    update.velocity - nominal_velocity,
                    crate::spatial::PhysicalReferenceDomain::Horizontal,
                );
                publish_contact_updates(&mut scene, updates);
            }
            assert!(
                reconciliation.is_empty(),
                "settled return retained its reference"
            );
            let body = scene.body(id).unwrap();
            assert!(
                (reference - body.pose.coords).length() <= RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
            );
            assert!(
                (body.retained.velocity - ordinary).length()
                    <= PHYSICAL_RETURN_GAIN * RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
            );
        }
    }
}

#[test]
fn contact_collection_discards_excess_time_and_consumes_launch_once() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::LocalPlayer(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    acquire_support(&mut scene, &collision, id, now);
    scene.wake_dynamic_body(id);
    let launch_velocity = Vector3::new(0.0, 0.0, 5.0);
    let gravity = Vector3::new(0.0, 0.0, -9.8);
    let mut intervals = Vec::new();
    let before = scene.body(id).unwrap().clone();
    let updates = crate::spatial::advance_body_contact_collection(
        &collision,
        std::slice::from_ref(&before),
        Guid(0xda55_ffff),
        1.0,
        |body, ground, interval| {
            intervals.push(interval);
            // Exercise launch priority through production movement preparation with a return target.
            let input = PhysicalBodyInput::referenced(
                PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::drive(Vector3::new(-10.0, 0.0, 0.0))?
                        .with_launch(GroundedLaunch::new(launch_velocity)?),
                ),
                PhysicalReferenceInput::body(None),
                true,
            );
            let mut state = PoseReconciliationState::default();
            let mut target = body.pose;
            target.coords.x -= 1.0;
            state.correct(target, true);
            Ok(input
                .step(body, ground, interval, &mut Some(state))?
                .actuation)
        },
    )
    .unwrap()
    .bodies;
    let duration = MOBILE_CONTACT_TICK_SECONDS;
    assert_eq!(intervals.len(), 1);
    assert!(
        intervals
            .iter()
            .all(|step| *step <= MOBILE_CONTACT_TICK_SECONDS)
    );
    assert!(updates[0].launch_admitted);
    assert!((updates[0].velocity - launch_velocity - gravity * duration).length() < 0.00001);
    assert_eq!(
        scene.body(id).unwrap().pose,
        before.pose,
        "private collection mutated live body"
    );
    let mut end = 0.0;
    for segment in &updates[0].motion {
        assert!(segment.start_fraction() >= end - 0.00001);
        assert!(segment.end_fraction() <= 1.0);
        end = segment.end_fraction();
    }
    assert!((end - 1.0).abs() < 0.00001);
}

#[test]
fn report_shape_query_detects_crossing_and_escaping_overlap() {
    let shape = holtburger_content::PlacedCollisionShape::new(
        Arc::new(CollisionShape::Ball(CollisionBall {
            center: Vector3::zero(),
            radius: 0.05,
        })),
        LandblockPlacement {
            origin: Vector3::zero(),
            orientation: Quaternion::identity(),
        },
        ColliderScale::uniform(1.0).unwrap(),
    )
    .unwrap();
    let anchor = Guid(0xda55_ffff);
    for (start, end, expected) in [
        (
            Vector3::new(-1.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            true,
        ),
        (Vector3::zero(), Vector3::new(1.0, 0.0, 0.0), true),
        (
            Vector3::new(-1.0, 1.0, 0.0),
            Vector3::new(1.0, 1.0, 0.0),
            false,
        ),
    ] {
        assert_eq!(
            crate::spatial::collision::sphere_path_touches_shape(&shape, start, end, 0.05, anchor,)
                .unwrap(),
            expected
        );
    }
}

#[test]
fn contact_collection_reports_crossed_ethereal_trigger_without_blocking() {
    for enabled in [true, false] {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let mover = SpatialBodyId::LocalPlayer(Guid(1));
        let trigger = SpatialBodyId::Entity(Guid(2));
        let radius = 0.05;
        for (id, x) in [(mover, 90.0), (trigger, 90.3)] {
            scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 1.0)), now));
            let geometry = PreparedEntityTargetGeometry {
                setup_radius: 0.5,
                collision_animations: Default::default(),
                physics_bsp_parts: Vec::new(),
                fallback_setup_did: 0x0200_0001,
                fallback_shapes: vec![Arc::new(CollisionShape::Ball(CollisionBall {
                    center: Vector3::zero(),
                    radius,
                }))],
                fallback_scale: ColliderScale::uniform(1.0).unwrap(),
            };
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition_with_geometry(
                        free_definition(Vector3::zero(), radius),
                        false,
                        geometry,
                        false,
                    )),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            let dynamic = scene
                .body_mut(id)
                .unwrap()
                .physical
                .as_mut()
                .unwrap()
                .dynamic
                .as_mut()
                .unwrap();
            dynamic.collision.reporting.enabled = enabled;
            if id == trigger {
                dynamic.demand.integration = LocalIntegrationDemand::Excluded;
                dynamic.collision.dynamic_collision.target = EntityCollisionParticipation::Ethereal;
                dynamic.collision.reporting.as_environment = true;
            }
        }
        let travel = 0.6;
        let velocity = Vector3::new(travel / MOBILE_CONTACT_TICK_SECONDS, 0.0, 0.0);
        scene.body_mut(mover).unwrap().retained.velocity = velocity;
        let bodies = scene
            .body_store
            .bodies
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let result = crate::spatial::advance_body_contact_collection(
            &collision,
            &bodies,
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |_, _, _| ContactStepActuation::ballistic(Vector3::zero()),
        )
        .unwrap();
        assert_eq!(result.bodies.len(), 1);
        assert!((result.bodies[0].displacement.x - travel).abs() < 0.0001);
        assert_eq!(result.bodies[0].velocity, velocity);
        assert_eq!(result.report_touches.len(), if enabled { 2 } else { 0 });
        if enabled {
            assert!(result.report_touches.iter().any(|touch| {
                touch.contact.recipient == mover && touch.source_is_ethereal
                    && matches!(touch.contact.source,
                        crate::spatial::CollisionReportSource::DynamicBody {
                            peer, classification: crate::spatial::CollisionReportClassification::Environment,
                        } if peer == trigger)
            }));
        }
    }
}

#[test]
fn contact_publication_preserves_world_point_across_cell_frames() {
    let now = Instant::now();
    let id = SpatialBodyId::Entity(Guid(1));
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(191.0, 96.0, 1.0)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(grounded_definition(), false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    for initial_cell in [Guid(0xda55_003d), Guid(0xda55_0100)] {
        for membership in [
            SpatialMembership::outdoor(),
            SpatialMembership::interior(Guid(0xdb55_0101)),
        ] {
            let mut body = scene.body(id).unwrap().clone();
            body.pose.landblock_id = initial_cell;
            let displacement = Vector3::new(2.0, 0.0, 0.0);
            let expected = body.pose.global_coords() + displacement;
            let update = ContactBodyUpdate {
                body_id: id,
                displacement,
                rotation: body.pose.rotation,
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                accepted_motion: AcceptedBodyMotion::default(),
                supported_velocity: Vector3::zero(),
                ground: GroundState::Airborne,
                membership,
                motion: Vec::new(),
                unavailable_owner: None,
                launch_admitted: false,
                projectile_impact: None,
            };
            update.apply_physical_state(&mut body).unwrap();
            assert!((body.pose.global_coords() - expected).length() < 0.0001);
            assert_eq!(body.pose.landblock_id.0 & 0xffff_0000, 0xdb55_0000);
            assert!((body.pose.coords.x - 1.0).abs() < 0.0001);
            let physical = body.physical.as_ref().unwrap();
            assert_eq!(physical.response.cell(), update.membership.committed_cell());
            assert_eq!(
                physical.dynamic.as_ref().unwrap().placement,
                update.membership
            );
            if let Some(cell) = update.membership.committed_cell() {
                assert_eq!(body.pose.landblock_id, cell);
            } else {
                assert!(!body.pose.is_indoors());
            }
        }
    }
}

#[test]
fn sleeping_mobile_keeps_contact_mobility_and_wakes_on_publication() {
    let mut collision = flat_collision_scene();
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let sleeper = SpatialBodyId::Entity(Guid(2));
    let untouched = SpatialBodyId::Entity(Guid(3));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    for (id, x) in [
        (player, 90.0),
        (sleeper, 90.0 + primary.radius * 1.8),
        (untouched, 100.0),
    ] {
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(x, 96.0, primary.radius - primary.center.z)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, id, now);
        scene
            .body_mut(id)
            .unwrap()
            .physical
            .as_mut()
            .unwrap()
            .dynamic
            .as_mut()
            .unwrap()
            .activity = if id == player {
            DynamicBodyActivity::Active
        } else {
            DynamicBodyActivity::Settled
        };
    }
    let snapshots = [player, sleeper, untouched].map(|id| scene.body(id).unwrap().clone());
    let mut sampled = Vec::new();
    let result = crate::spatial::advance_body_contact_collection(
        &collision,
        &snapshots,
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |body, ground, _| {
            sampled.push(body.id);
            grounded_step_input(body, ground, &GroundedBodyActuation::coast())
        },
    )
    .unwrap();
    assert!(!sampled.contains(&untouched));
    assert!(!sampled.contains(&sleeper));
    for update in result.bodies {
        let mut body = scene.body(update.body_id).unwrap().clone();
        update.apply_physical_state(&mut body).unwrap();
        let activity = body
            .physical
            .as_ref()
            .unwrap()
            .dynamic
            .as_ref()
            .unwrap()
            .activity;
        if body.id == sleeper {
            assert!(update.displacement.x > 0.0);
            assert_eq!(update.accepted_motion.velocity, Vector3::zero());
            assert_eq!(
                update.supported_velocity,
                update.displacement / MOBILE_CONTACT_TICK_SECONDS
            );
            assert_eq!(body.accepted_motion.velocity, Vector3::zero());
            assert_eq!(activity, DynamicBodyActivity::Active);
        } else if body.id == untouched {
            assert_eq!(update.displacement, Vector3::zero());
            assert_eq!(activity, DynamicBodyActivity::Settled);
        }
    }
    // Replacing the owner invalidates retained support even for the untouched sleeper.
    collision.insert(flat_collision_asset(0)).unwrap();
    let mut refreshed = Vec::new();
    advance_body_contacts(
        &collision,
        &snapshots,
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |body, ground| {
            refreshed.push(body.id);
            grounded_step_input(body, ground, &GroundedBodyActuation::coast())
        },
    )
    .unwrap();
    assert!(refreshed.contains(&untouched));
}

#[test]
fn authored_flight_travel_slides_without_becoming_retained_velocity() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let id = SpatialBodyId::Entity(Guid(1));
    let radius = 0.5;
    let start = pose(Vector3::new(90.0, 96.0, radius + 0.1));
    let physical_velocity = Vector3::new(2.0, 0.0, 0.0);
    let authored_velocity = Vector3::new(0.0, 3.0, -24.0);
    let mut scene = SpatialScene::new();
    let mut body = SpatialBody::new(id, start, now);
    body.retained.velocity = physical_velocity;
    scene.register_body(body);
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(
                free_definition(Vector3::zero(), radius),
                false,
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let duration = MOBILE_CONTACT_TICK_SECONDS;
    let mut body = scene.body(id).unwrap().clone();
    for tick in 1..=3 {
        let result = crate::spatial::advance_body_contact_collection(
            &collision,
            std::slice::from_ref(&body),
            Guid(0xda55_ffff),
            duration,
            |body, ground, interval| {
                PhysicalBodyActuation::free_flight_with_kinematic_velocity(
                    physical_velocity,
                    authored_velocity,
                )?
                .contact_step_input(
                    body.physical
                        .as_ref()
                        .ok_or_else(|| anyhow::anyhow!("contact input requires body physics"))?,
                    body.pose.rotation,
                    body.retained.acceleration,
                    ground,
                    None,
                    interval,
                )
            },
        )
        .unwrap();
        let update = &result.bodies[0];
        assert!(update.unavailable_owner.is_none());
        assert_eq!(update.velocity, physical_velocity);
        assert_eq!(update.supported_velocity, Vector3::zero());
        assert!(
            (update.accepted_motion.velocity * duration - update.displacement).length() < 0.0001
        );
        assert!(
            update.motion.iter().any(|segment| matches!(
                segment,
                crate::spatial::ContactMotionSegment::Impact { .. }
            ))
        );
        update.apply_physical_state(&mut body).unwrap();
        let elapsed = duration * tick as f32;
        assert!(
            (body.pose.coords.x - start.coords.x - physical_velocity.x * elapsed).abs() < 0.0001
        );
        assert!(
            (body.pose.coords.y - start.coords.y - authored_velocity.y * elapsed).abs() < 0.0001
        );
        assert!(
            (body.pose.coords.z - (radius - CONTACT_EPSILON)).abs() < 0.0001,
            "floor z: {}",
            body.pose.coords.z
        );
    }
}

#[test]
fn sampled_authored_flight_uses_each_interval_in_the_actual_body_frame() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let id = SpatialBodyId::Entity(Guid(1));
    let mut start = pose(Vector3::new(90.0, 96.0, 2.0));
    start.rotation = Quaternion::from_heading(0.7);
    let offset = holtburger_common::RigidTransform {
        translation: Vector3::new(0.2, 0.1, 0.0),
        rotation: Quaternion::from_heading(0.5),
    };
    let sampled = crate::spatial::PhysicalReferenceInput::body(Some(offset));
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(id, start, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(
                free_definition(Vector3::zero(), 0.5),
                false,
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let actuation = PhysicalBodyActuation::free_flight(Vector3::zero()).unwrap();
    let result = crate::spatial::advance_body_contact_collection(
        &collision,
        &[scene.body(id).unwrap().clone()],
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |body, ground, interval| {
            let input = sampled;
            actuation.contact_step_input(
                body.physical
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("contact input requires body physics"))?,
                body.pose.rotation,
                body.retained.acceleration,
                ground,
                input.authored_offset(),
                interval,
            )
        },
    )
    .unwrap();
    let update = &result.bodies[0];
    assert!(
        (update.displacement - start.rotation.rotate_vector(offset.translation)).length() < 0.0001
    );
    let axis = Vector3::new(1.0, 0.0, 0.0);
    let expected = start
        .rotation
        .multiply(&offset.rotation)
        .rotate_vector(axis);
    assert!((update.rotation.rotate_vector(axis) - expected).length() < 0.0001);
    assert_eq!(update.velocity, Vector3::zero());
}

#[test]
fn observed_collection_speed_includes_time_spent_blocked() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let mover = SpatialBodyId::Entity(Guid(1));
    let hard = SpatialBodyId::Entity(Guid(2));
    let radius = 0.5;
    let speed = 12.0;
    let duration = MOBILE_CONTACT_TICK_SECONDS;
    let clearance = speed * duration * 0.5;
    let mut scene = SpatialScene::new();
    for (id, x) in [(mover, 90.0), (hard, 90.0 + 2.0 * radius + clearance)] {
        scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 1.0)), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), radius),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    scene.body_mut(mover).unwrap().retained.velocity = Vector3::new(speed, 0.0, 0.0);
    scene
        .body_mut(mover)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .response_policy
        .restitution = PhysicalRestitution::Inelastic;
    scene
        .body_mut(hard)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .demand
        .integration = LocalIntegrationDemand::Excluded;
    let result = crate::spatial::advance_body_contact_collection(
        &collision,
        &[
            scene.body(mover).unwrap().clone(),
            scene.body(hard).unwrap().clone(),
        ],
        Guid(0xda55_ffff),
        duration,
        |_, _, _| ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    let update = &result.bodies[0];
    assert_eq!(update.body_id, mover);
    assert!(
        (update.displacement.x - (clearance + CONTACT_EPSILON)).abs() < 0.0001,
        "travel {:?}, velocity {:?}",
        update.displacement,
        update.velocity
    );
    assert_eq!(update.velocity, Vector3::zero());
    assert!(
        (update.accepted_motion.velocity.x - (speed * 0.5 + CONTACT_EPSILON / duration)).abs()
            < 0.001
    );
    assert_eq!(update.supported_velocity, Vector3::zero());
    let body = scene.body_mut(mover).unwrap();
    update.apply_physical_state(body).unwrap();
    assert_eq!(body.accepted_motion, update.accepted_motion);
}

#[test]
fn moving_flight_returns_without_retaining_correction_or_authored_velocity() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let id = SpatialBodyId::Entity(Guid(1));
    let start = pose(Vector3::new(90.0, 96.0, 2.0));
    let authored_velocity = Vector3::new(0.0, 2.0, 0.0);
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(id, start, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(
                free_definition(Vector3::zero(), 0.5),
                false,
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let sample = crate::spatial::PhysicalBodyInput::referenced(
        PhysicalBodyActuation::free_flight_with_kinematic_velocity(
            Vector3::zero(),
            authored_velocity,
        )
        .unwrap(),
        crate::spatial::PhysicalReferenceInput::body(None),
        true,
    );
    let mut body = scene.body(id).unwrap().clone();
    let mut reference = start;
    reference.coords.x += 1.0;
    let mut reconciliation = PoseReconciliationState::default();
    reconciliation.correct(reference, true);
    let duration = MOBILE_CONTACT_TICK_SECONDS;
    for _ in 0..(4.0 / duration).ceil() as usize {
        let mut nominal_velocity = Vector3::zero();
        let result = crate::spatial::advance_body_contact_collection(
            &collision,
            std::slice::from_ref(&body),
            Guid(0xda55_ffff),
            duration,
            |body, ground, interval| {
                let mut pending = Some(reconciliation);
                let input = sample.step(body, ground, interval, &mut pending)?;
                reconciliation = pending.expect("step retains the supplied state container");
                nominal_velocity = input.nominal_velocity;
                Ok(input.actuation)
            },
        )
        .unwrap();
        let update = &result.bodies[0];
        assert_eq!(update.velocity, Vector3::zero());
        assert_eq!(nominal_velocity, Vector3::zero());
        assert_eq!(update.supported_velocity, Vector3::zero());
        assert!(
            update.displacement.x
                <= crate::spatial::PHYSICAL_RETURN_GAIN
                    * (reference.coords - body.pose.coords).length()
                    * duration
                    + 0.0001
        );
        update.apply_physical_state(&mut body).unwrap();
        reconciliation.finish_physical_tick(
            body.pose,
            body.retained.velocity - nominal_velocity,
            crate::spatial::PhysicalReferenceDomain::Spatial,
        );
        reference.coords = reference.coords + authored_velocity * duration;
    }
    assert!(
        reconciliation.is_empty(),
        "kinematic travel prevented return completion"
    );
    assert!(
        body.pose.distance_to(&reference)
            <= crate::spatial::pose_reconciliation::RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
    );
}

#[test]
fn sleeping_body_tolerates_small_contact_displacement_after_the_peer_leaves() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let sleeper = SpatialBodyId::Entity(Guid(2));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    for (id, x) in [(player, 90.0), (sleeper, 90.0 + primary.radius)] {
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(x, 96.0, primary.radius - primary.center.z)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, id, now);
    }
    scene
        .body_mut(sleeper)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .activity = DynamicBodyActivity::Settled;
    let origin = scene.body(sleeper).unwrap().pose;
    let input = crate::spatial::PhysicalBodyInput::referenced(
        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
        crate::spatial::PhysicalReferenceInput::body(None),
        true,
    );
    scene
        .advance_dynamic_entity_collection(&collision, MOBILE_CONTACT_TICK_SECONDS, now, |_| {
            Ok(input.clone())
        })
        .unwrap();
    assert!(scene.body(sleeper).unwrap().pose.coords.x > origin.coords.x);
    assert_eq!(
        scene.body(sleeper).unwrap().accepted_motion.velocity,
        Vector3::zero()
    );
    assert!(scene.body(sleeper).unwrap().has_pose_reconciliation_work());
    scene.remove_body(player);
    let duration = MOBILE_CONTACT_TICK_SECONDS;
    for tick in 1..=(3.0 / duration).ceil() as usize {
        scene
            .advance_dynamic_entity_collection(
                &collision,
                duration,
                now + Duration::from_secs_f32(tick as f32 * duration),
                |_| Ok(input.clone()),
            )
            .unwrap();
        if !scene.body(sleeper).unwrap().has_pose_reconciliation_work() {
            break;
        }
    }
    assert!(
        !scene.body(sleeper).unwrap().has_pose_reconciliation_work(),
        "contact return did not settle"
    );
    assert!(
        scene.body(sleeper).unwrap().pose.distance_to(&origin)
            <= crate::spatial::PHYSICAL_RETURN_START_THRESHOLD_M
    );
    let resting = scene.body(sleeper).unwrap().pose;
    scene
        .advance_dynamic_entity_collection(
            &collision,
            duration,
            now + Duration::from_secs(4),
            |_| Ok(input.clone()),
        )
        .unwrap();
    let body = scene.body(sleeper).unwrap();
    assert_eq!(body.pose, resting);
    assert_eq!(
        body.reconciliation
            .as_deref()
            .unwrap()
            .physical_reference()
            .unwrap(),
        origin
    );
    assert_eq!(
        body.physical
            .as_ref()
            .unwrap()
            .dynamic
            .as_ref()
            .unwrap()
            .activity,
        DynamicBodyActivity::Settled
    );
}

#[test]
fn collection_impact_retires_entity_flight_and_does_not_capture_a_new_return() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let guid = Guid(0x7200_0090);
    let id = SpatialBodyId::Entity(guid);
    let radius = 0.25;
    let start = pose(Vector3::new(90.0, 96.0, 0.6));
    let flight = Vector3::new(0.0, 0.0, -40.0);
    let authored = Vector3::new(2.0, 0.0, 0.0);
    let flags = holtburger_common::properties::PhysicsState::INELASTIC
        | holtburger_common::properties::PhysicsState::MISSILE
        | holtburger_common::properties::PhysicsState::ALIGN_PATH
        | holtburger_common::properties::PhysicsState::PATH_CLIPPED;
    let authoritative = crate::resolve_effective_entity_physics_state(flags);
    let mut world = crate::WorldState::synthetic();
    let mut entity = crate::entity::Entity::new(guid, "Projectile".to_owned(), start);
    entity.physics.reconcile(authoritative);
    world.entities.insert(entity);
    world.scene.register_body(SpatialBody::new(id, start, now));
    world
        .scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(
                free_definition(Vector3::zero(), radius),
                true,
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let body = world.scene.body_mut(id).unwrap();
    // A projectile item remains nonyielding after impact; character fixture defaults would
    // miss the transition from missile advancement to ordinary hard-target participation.
    body.physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .collision
        .contact_response = crate::spatial::EntityContactResponse::Obstacle;
    body.retained.velocity = flight;
    body.physical.as_mut().unwrap().response_policy.restitution = PhysicalRestitution::Inelastic;
    body.physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .collision
        .dynamic_collision = authoritative.dynamic_collision;
    let mut pending = PoseReconciliationState::default();
    let mut target = start;
    target.coords.x += 1.0;
    pending.correct(target, true);
    body.reconciliation = Some(Box::new(pending));
    let duration = MOBILE_CONTACT_TICK_SECONDS;
    let entities = &world.entities;
    let result = world
        .scene
        .advance_dynamic_entity_collection(&collision, duration, now, |body| {
            Ok(crate::spatial::PhysicalBodyInput::referenced(
                PhysicalBodyActuation::free_flight_with_kinematic_velocity(
                    body.retained.velocity,
                    authored,
                )?,
                crate::spatial::PhysicalReferenceInput::body(None),
                !entities
                    .get(guid)
                    .unwrap()
                    .physics
                    .is_authoritative_projectile(),
            ))
        })
        .unwrap();
    let DynamicEntityBodyOutcome::Integrated(update) = &result.outcomes[0] else {
        panic!("expected projectile impact")
    };
    assert!(update.dynamic_state_change.is_some());
    let impact_time = (start.coords.z - radius) / -flight.z;
    let maximum_impact_travel = (authored.x
        + crate::spatial::PHYSICAL_RETURN_GAIN * (target.coords.x - start.coords.x))
        * impact_time;
    assert!(
        update.displacement.x <= maximum_impact_travel + 0.0001,
        "the sampled flight command continued after impact"
    );
    let events = world.apply_integrated_body(update).unwrap();
    assert!(events.iter().any(
        |event| matches!(event, crate::WorldEvent::RuntimeBodyChanged { body_id } if *body_id == id)
    ));
    let entity = world.entities.get(guid).unwrap();
    assert!(entity.physics.is_authoritative_projectile());
    assert!(!entity.physics.effective().dynamic_collision.missile);
    assert!(!entity.physics.effective().dynamic_collision.path_clipped);
    assert!(!entity.physics.effective().response.align_path);
    let stopped = world.scene.body(id).unwrap().pose;
    assert!(!world.scene.body(id).unwrap().has_pose_reconciliation_work());
    assert_eq!(
        world.scene.body(id).unwrap().retained.velocity,
        Vector3::zero()
    );
    for tick in 1..=4 {
        let entities = &world.entities;
        let result = world
            .scene
            .advance_dynamic_entity_collection(
                &collision,
                duration,
                now + Duration::from_secs_f32(tick as f32 * duration),
                |body| {
                    Ok(crate::spatial::PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::free_flight(body.retained.velocity)?,
                        // No server stop vector has arrived; stale flight cannot seed local return.
                        crate::spatial::PhysicalReferenceInput::body(None),
                        !entities
                            .get(guid)
                            .unwrap()
                            .physics
                            .is_authoritative_projectile(),
                    ))
                },
            )
            .unwrap();
        for outcome in result.outcomes {
            let DynamicEntityBodyOutcome::Integrated(update) = outcome else {
                panic!("expected projectile continuation")
            };
            world.apply_integrated_body(&update).unwrap();
        }
        assert_eq!(world.scene.body(id).unwrap().pose, stopped);
        assert!(!world.scene.body(id).unwrap().has_pose_reconciliation_work());
    }
}

#[test]
fn authored_input_survives_settling_and_residency_reactivation() {
    // Residency refresh must restore a suspended body before the collection captures eligibility.
    for activity in [DynamicBodyActivity::Settled, DynamicBodyActivity::Suspended] {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::Entity(Guid(1));
        let definition = grounded_definition();
        let sphere = definition.spheres().primary();
        let start = pose(Vector3::new(90.0, 96.0, sphere.radius - sphere.center.z));
        scene.register_body(SpatialBody::new(id, start, now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        scene
            .refresh_dynamic_body_placement(id, &collision)
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
            .activity = activity;
        let duration = MOBILE_CONTACT_TICK_SECONDS;
        let speed = 2.0;
        let offset = holtburger_common::RigidTransform {
            translation: Vector3::new(0.0, speed * duration, 0.0),
            rotation: Quaternion::identity(),
        };
        let input = PhysicalBodyInput::referenced(
            PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
            PhysicalReferenceInput::body(Some(offset)),
            true,
        );
        let tick = scene
            .advance_dynamic_entity_collection(&collision, duration, now, |_| Ok(input.clone()))
            .unwrap();
        assert_eq!(tick.outcomes.len(), 1);
        let DynamicEntityBodyOutcome::Integrated(update) = &tick.outcomes[0] else {
            panic!("expected integrated body")
        };
        let body = scene.body(id).unwrap();
        assert!(body.pose.coords.y > start.coords.y);
        assert!(update.supported_motion.velocity.y > 0.0);
        assert!(
            (body.pose.coords - (start.coords + offset.translation)).length() < CONTACT_EPSILON
        );
        assert!(!body.has_pose_reconciliation_work());
    }
}

#[path = "footing_tests.rs"]
mod footing_tests;

#[test]
fn supported_character_contacts_brake_incoming_motion_and_allow_escape() {
    for (player_speed, mob_speed) in [(0.0, -2.0), (2.0, 0.0), (2.0, -2.0)] {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let player = SpatialBodyId::LocalPlayer(Guid(1));
        let mob = SpatialBodyId::Entity(Guid(2));
        let separation = 2.0 * grounded_definition().spheres().primary().radius;
        for (id, x) in [(player, 90.0), (mob, 90.0 + separation)] {
            scene.register_body(SpatialBody::new(
                id,
                pose(Vector3::new(x, 96.0, 0.005)),
                now,
            ));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(grounded_definition(), false)),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            acquire_support(&mut scene, &collision, id, now);
        }
        let dt = MOBILE_CONTACT_TICK_SECONDS;
        let mut player_escape_direction = -1.0;
        for tick in 0..60 {
            if tick == 30 {
                // Choose retreat from the actual arrangement, since mobile order may change.
                player_escape_direction = if scene.body(player).unwrap().pose.coords.x
                    <= scene.body(mob).unwrap().pose.coords.x
                {
                    -1.0
                } else {
                    1.0
                };
            }
            for id in [player, mob] {
                scene.wake_dynamic_body(id);
            }
            let update = scene
                .advance_dynamic_entity_collection(
                    &collision,
                    dt,
                    now + Duration::from_secs_f32((tick + 1) as f32 * dt),
                    |body| {
                        let speed = match (tick < 30, body.id == player) {
                            (true, true) => player_speed,
                            (true, false) => mob_speed,
                            (false, true) => 2.0 * player_escape_direction,
                            (false, false) => -2.0 * player_escape_direction,
                        };
                        Ok(PhysicalBodyInput::referenced(
                            PhysicalBodyActuation::grounded_drive(Vector3::new(speed, 0.0, 0.0))?,
                            PhysicalReferenceInput::body(None),
                            true,
                        ))
                    },
                )
                .unwrap();
            assert!(update.coverage_rejections.is_empty());
            for outcome in &update.outcomes {
                let DynamicEntityBodyOutcome::Integrated(body) = outcome else {
                    panic!("expected crowd movement")
                };
                // Presentation follows net supported progress after separation, while
                // the retained physical velocity below keeps its no-incoming-force rule.
                let observed = body.supported_motion.velocity * dt;
                let error = observed - body.displacement;
                assert!(error.x.hypot(error.y) < CONTACT_EPSILON);
            }
            let player_body = scene.body(player).unwrap();
            let mob_body = scene.body(mob).unwrap();
            // Mobile endpoints may exchange order under the accepted approximate-contact policy.
            if tick < 30 {
                // Positional separation may move the player back; an approaching
                // peer must not leave backward momentum in its physical velocity.
                assert!(player_body.retained.velocity.x >= -CONTACT_EPSILON);
            }
            for body in [player_body, mob_body] {
                assert!(
                    body.physical
                        .as_ref()
                        .unwrap()
                        .response
                        .ground()
                        .walkable_support()
                        .is_some()
                );
            }
        }
        assert!(
            (scene.body(mob).unwrap().pose.coords.x - scene.body(player).unwrap().pose.coords.x)
                .abs()
                > separation
        );
    }
}

#[test]
fn character_drive_slides_past_hard_cylinder_corner_without_penetrating() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let source = SpatialBodyId::LocalPlayer(Guid(0x7700_0000));
    let start = Vector3::new(80.0, 79.0, 0.005);
    let target_radius = 0.5;
    let contact_distance = grounded_definition().spheres().primary().radius + target_radius;
    let diagonal = contact_distance * std::f32::consts::FRAC_1_SQRT_2;
    let obstacles = [
        start + Vector3::new(diagonal, diagonal, 0.0),
        start + Vector3::new(0.75, -1.7, 0.0),
    ];
    for (slot, coords) in std::iter::once(start).chain(obstacles).enumerate() {
        let id = if slot == 0 {
            source
        } else {
            SpatialBodyId::Entity(Guid(0x7700_0000 + slot as u32))
        };
        scene.register_body(SpatialBody::new(id, pose(coords), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition_with_geometry(
                    grounded_definition(),
                    false,
                    fallback_target(Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                        low_point: Vector3::zero(),
                        radius: target_radius,
                        height: 2.0,
                    }))),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, id, now);
        if slot != 0 {
            scene
                .body_mut(id)
                .unwrap()
                .physical
                .as_mut()
                .unwrap()
                .dynamic
                .as_mut()
                .unwrap()
                .demand
                .integration = LocalIntegrationDemand::Excluded;
        }
    }
    // Recorded admitted tick length; the rounding failure depends on the chord.
    let dt = 0.03;
    for tick in 0..60 {
        scene.wake_dynamic_body(source);
        let update = scene
            .advance_dynamic_entity_collection(
                &collision,
                dt,
                now + Duration::from_secs_f32((tick + 1) as f32 * dt),
                |_| {
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::grounded_drive(Vector3::new(2.0, 0.5, 0.0))?,
                        PhysicalReferenceInput::body(None),
                        true,
                    ))
                },
            )
            .unwrap();
        assert!(update.coverage_rejections.is_empty());
        let player = scene.body(source).unwrap();
        assert!(
            player
                .physical
                .as_ref()
                .unwrap()
                .response
                .ground()
                .walkable_support()
                .is_some()
        );
        for (index, obstacle) in obstacles.iter().enumerate() {
            let offset = player.pose.coords - *obstacle;
            let separation = (offset.x * offset.x + offset.y * offset.y).sqrt();
            // Coordinate storage and subtraction round at landblock scale.
            let roundoff = f32::EPSILON * (player.pose.coords.length() + obstacle.length());
            assert!(
                separation >= contact_distance - CONTACT_EPSILON - roundoff,
                "hard clearance lost: {separation}"
            );
            let id = SpatialBodyId::Entity(Guid(0x7700_0001 + index as u32));
            assert_eq!(scene.body(id).unwrap().pose.coords, *obstacle);
        }
    }
    // The player has cleared the first cylinder, not merely remained safely stuck
    // on its tangent. This catches the progress failure missed by clearance alone.
    assert!(scene.body(source).unwrap().pose.coords.x > obstacles[0].x + contact_distance);
}

#[test]
fn animated_obstacle_keeps_authored_target_geometry_and_does_not_yield_to_a_character() {
    let now = Instant::now();
    let (mut scene, collision, (player, obstacle)) = grounded_pair_fixture(false, now);
    let mut obstacle_pose = scene.body(obstacle).unwrap().pose;
    obstacle_pose.coords.y = scene.body(player).unwrap().pose.coords.y + 1.5;
    scene
        .relocate_dynamic_body(obstacle, obstacle_pose, now)
        .unwrap();
    let mut definition = dynamic_definition_with_geometry(
        grounded_definition(),
        false,
        fallback_target(Arc::new(CollisionShape::Cylinder(CollisionCylinder {
            low_point: Vector3::zero(),
            radius: 1.0,
            height: 2.0,
        }))),
        false,
    )
    .definition()
    .clone();
    definition.entity_collision.contact_response = crate::spatial::EntityContactResponse::Obstacle;
    scene
        .set_dynamic_physical_body(
            obstacle,
            Some(dynamic_configuration_with_demand(
                definition,
                LocalPhysicalDemand {
                    target: LocalTargetDemand::Retained,
                    integration: LocalIntegrationDemand::Eligible,
                },
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let mut alone = scene.clone();
    alone.remove_body(player).unwrap();
    let duration = MOBILE_CONTACT_TICK_SECONDS;
    let input = |body: &SpatialBody| -> anyhow::Result<PhysicalBodyInput> {
        if body.id == player {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::grounded_drive(Vector3::new(0.0, 4.0, 0.0))?,
            ))
        } else {
            Ok(PhysicalBodyInput::referenced(
                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                PhysicalReferenceInput::body(Some(holtburger_common::RigidTransform {
                    translation: Vector3::new(0.0, duration, 0.0),
                    rotation: Quaternion::identity(),
                })),
                true,
            ))
        }
    };
    for tick in 1..=30 {
        let at = now + Duration::from_secs_f32(duration * tick as f32);
        scene
            .advance_dynamic_entity_collection(&collision, duration, at, input)
            .unwrap();
        alone
            .advance_dynamic_entity_collection(&collision, duration, at, input)
            .unwrap();
        assert_eq!(
            scene.body(obstacle).unwrap().pose,
            alone.body(obstacle).unwrap().pose,
            "character contact changed the obstacle's authored movement"
        );
        let spacing =
            scene.body(obstacle).unwrap().pose.coords.y - scene.body(player).unwrap().pose.coords.y;
        assert!(
            spacing
                >= 1.0 + grounded_definition().spheres().primary().radius
                    - crate::spatial::bsp_query::CONTACT_EPSILON
                    // Subtracting two placed f32 coordinates also incurs their rounding error.
                    - f32::EPSILON * (scene.body(obstacle).unwrap().pose.coords.y.abs()
                        + scene.body(player).unwrap().pose.coords.y.abs()),
            "character entered the authored target: spacing={spacing}"
        );
    }
    assert!(scene.body(obstacle).unwrap().pose.coords.y > obstacle_pose.coords.y);
}

#[test]
fn character_yielding_survives_freeze_and_thaw_without_promoting_obstacles() {
    let now = Instant::now();
    let (mut scene, _, (_, id)) = grounded_pair_fixture(false, now);
    for character in [true, false] {
        if !character {
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
        }
        for frozen in [true, false] {
            let mut state = holtburger_common::properties::PhysicsState::GRAVITY;
            state.set(holtburger_common::properties::PhysicsState::FROZEN, frozen);
            scene
                .reconfigure_dynamic_body_for_state(
                    id,
                    crate::resolve_effective_entity_physics_state(state),
                )
                .unwrap();
            let response = scene
                .body(id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .dynamic
                .as_ref()
                .unwrap()
                .collision
                .contact_response;
            assert_eq!(response.yields(), character && !frozen);
            if !character {
                assert_eq!(response, crate::spatial::EntityContactResponse::Obstacle);
            }
        }
    }
}

#[test]
fn fixed_body_authored_translation_crosses_owner_without_gaining_velocity() {
    let now = Instant::now();
    let mut collision = flat_collision_scene();
    let mut neighbor = flat_collision_asset(0);
    neighbor.landblock_id = 0xdb55_ffff;
    collision.insert(neighbor).unwrap();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let initial = pose(Vector3::new(191.8, 96.0, 5.0));
    scene.register_body(SpatialBody::new(id, initial, now));
    let placement = PhysicalSphereSet::new(
        Sphere {
            center: Vector3::zero(),
            radius: 0.1,
        },
        None,
    )
    .unwrap();
    let mut definition = dynamic_definition(
        PhysicalBodyDefinition::fixed_position(placement).unwrap(),
        false,
    )
    .definition()
    .clone();
    definition.entity_collision.contact_response = crate::spatial::EntityContactResponse::Obstacle;
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_configuration_with_demand(
                definition,
                LocalPhysicalDemand {
                    target: LocalTargetDemand::Retained,
                    integration: LocalIntegrationDemand::Eligible,
                },
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let translation = Vector3::new(0.5, 0.0, 0.0);
    for tick in 1..=3 {
        let result = scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_millis(tick * 10),
                |body| {
                    Ok(PhysicalBodyInput::autonomous(
                        PhysicalBodyActuation::FixedPosition {
                            translation,
                            rotation: body.pose.rotation,
                        },
                    ))
                },
            )
            .unwrap();
        assert_eq!(result.outcomes.len(), 1);
        let body = scene.body(id).unwrap();
        assert!(
            (body.pose.global_coords() - initial.global_coords() - translation * tick as f32)
                .length()
                < 0.01
        );
        assert_eq!(body.pose.landblock_id.0 & 0xffff_0000, 0xdb55_0000);
        assert_eq!(body.retained.velocity, Vector3::zero());
        assert_eq!(body.retained.acceleration, Vector3::zero());
        let DynamicEntityBodyOutcome::Integrated(update) = &result.outcomes[0] else {
            panic!("expected fixed authored integration")
        };
        assert!((update.displacement - translation).length() < 0.0001);
    }
    let target = initial;
    let mut reconciliation = PoseReconciliationState::default();
    reconciliation.schedule_snap(target);
    scene.body_mut(id).unwrap().reconciliation = Some(Box::new(reconciliation));
    scene.wake_dynamic_body(id);
    let snapped = scene
        .advance_dynamic_entity_collection(
            &collision,
            MOBILE_CONTACT_TICK_SECONDS,
            now + Duration::from_secs(1),
            |_| panic!("fixed authority placement must not sample ordinary motion"),
        )
        .unwrap();
    assert!(
        matches!(snapped.outcomes.as_slice(), [DynamicEntityBodyOutcome::FixedPlacement(body_id)] if *body_id == id)
    );
    assert_eq!(scene.body(id).unwrap().pose, target);
}

#[test]
fn idle_characters_stop_external_speed_while_passive_bodies_coast() {
    for speed in [2.0, 8.0, 12.0] {
        for local in [false, true] {
            for character in [false, true] {
                let collision = flat_collision_scene();
                let now = Instant::now();
                let mut scene = SpatialScene::new();
                let id = if local {
                    SpatialBodyId::LocalPlayer(Guid(1))
                } else {
                    SpatialBodyId::Entity(Guid(1))
                };
                let definition = grounded_definition();
                let primary = definition.spheres().primary();
                let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
                scene.register_body(SpatialBody::new(id, start, now));
                scene
                    .set_dynamic_physical_body(
                        id,
                        Some(dynamic_definition(definition, false)),
                        PhysicalCollisionFilter::ALL,
                        None,
                    )
                    .unwrap();
                if !character {
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
                }
                scene.apply_authoritative_body_vectors(
                    id,
                    AuthoritativeBodyVectors {
                        velocity: Vector3::new(speed, 0.0, 0.0),
                        acceleration: Vector3::zero(),
                        omega: Vector3::zero(),
                    },
                    now,
                );
                for tick in 1..=20 {
                    scene
                        .advance_dynamic_entity_collection(
                            &collision,
                            MOBILE_CONTACT_TICK_SECONDS,
                            now + Duration::from_secs_f32(
                                tick as f32 * MOBILE_CONTACT_TICK_SECONDS,
                            ),
                            |_| {
                                Ok(PhysicalBodyInput::autonomous(
                                    PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                                ))
                            },
                        )
                        .unwrap();
                }
                let body = scene.body(id).unwrap();
                assert_eq!(body.contact, ContactState::Grounded);
                if character {
                    assert_eq!(body.retained.velocity, Vector3::zero());
                    assert!((body.pose.coords - start.coords).length() < CONTACT_EPSILON);
                    assert!(body.physical.as_ref().unwrap().is_settled());
                } else {
                    assert!(
                        body.retained.velocity.x > 0.0,
                        "passive body inherited character braking"
                    );
                }
            }
        }
    }
}

#[test]
fn nominal_coast_survives_correction_recapture_and_only_fresh_vectors_restart_it() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
    scene.register_body(SpatialBody::new(id, start, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
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
        .collision
        .contact_response = crate::spatial::EntityContactResponse::Obstacle;
    let vectors = AuthoritativeBodyVectors {
        velocity: Vector3::new(8.0, 0.0, 0.0),
        ..AuthoritativeBodyVectors::default()
    };
    scene.apply_authoritative_body_vectors(id, vectors, now);
    let mut expected = vectors.velocity;
    let mut recapture_observed = false;
    for tick in 1..=120 {
        let touched = now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS);
        if tick == 15 {
            let body = scene.body(id).unwrap();
            let pose = body.pose;
            let before = body.nominal;
            scene.apply_authoritative_body_effect(
                id,
                AuthoritativePoseEffect::Interpolate {
                    pose,
                    keep_heading: true,
                    adjusted_max_speed_mps: None,
                },
                vectors,
                touched,
            );
            assert_eq!(
                scene.body(id).unwrap().nominal,
                before,
                "pose-only sample restarted nominal motion"
            );
        }
        if tick == 30 {
            assert!(expected.x < vectors.velocity.x);
            scene.apply_authoritative_body_vectors(id, vectors, touched);
            assert_eq!(scene.body(id).unwrap().nominal, vectors);
            expected = vectors.velocity;
        }
        expected = crate::spatial::physical_body::surface_friction(
            crate::spatial::physical_body::canonical_retained_velocity(expected),
            Vector3::new(0.0, 0.0, 1.0),
            PhysicalFriction::DEFAULT,
            MOBILE_CONTACT_TICK_SECONDS,
            PhysicalSurfaceMotion::Stable,
        );
        scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                touched,
                |_| {
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                        PhysicalReferenceInput::body(None),
                        true,
                    ))
                },
            )
            .unwrap();
        let body = scene.body(id).unwrap();
        assert!(
            (body.nominal.velocity - expected).length() < 0.00001,
            "nominal decay reset at tick {tick}"
        );
        recapture_observed |= tick < 15 && !body.has_pose_reconciliation_work();
    }
    assert!(
        recapture_observed,
        "fixture did not exercise correction completion before recapture"
    );
    assert_eq!(scene.body(id).unwrap().nominal.velocity, Vector3::zero());
    assert_eq!(scene.body(id).unwrap().retained.velocity, Vector3::zero());
}

#[test]
fn nominal_free_acceleration_accumulates_across_admitted_ticks() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(90.0, 96.0, 10.0)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(
                free_definition(Vector3::zero(), 0.25),
                false,
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let vectors = AuthoritativeBodyVectors {
        acceleration: Vector3::new(2.0, 0.0, 0.0),
        ..AuthoritativeBodyVectors::default()
    };
    scene.apply_authoritative_body_vectors(id, vectors, now);
    for tick in 1..=30 {
        scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS),
                |body| {
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::free_flight(body.retained.velocity)?,
                        PhysicalReferenceInput::body(None),
                        true,
                    ))
                },
            )
            .unwrap();
        let expected = vectors.acceleration * (tick as f32 * MOBILE_CONTACT_TICK_SECONDS);
        assert!((scene.body(id).unwrap().nominal.velocity - expected).length() < 0.00001);
    }
}

#[test]
fn reference_retires_after_stair_travel_and_return_to_lower_floor() {
    let collision = bsp_stair_scene();
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let floor_z = primary.radius - primary.center.z;
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(89.5, 96.0, floor_z)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    for tick in 0..300 {
        let speed = if tick < 45 { 5.0 } else { 0.0 };
        scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS),
                |_| {
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::grounded_drive(Vector3::new(speed, 0.0, 0.0))?,
                        PhysicalReferenceInput::body(None),
                        true,
                    ))
                },
            )
            .unwrap();
    }
    let body = scene.body(id).unwrap();
    assert!(body.pose.coords.x > 92.0);
    assert!((body.pose.coords.z - floor_z - 0.6).abs() < CONTACT_EPSILON);
    assert!(
        !body.has_pose_reconciliation_work(),
        "settled stair body retained reference {:?} at pose {:?}",
        body.reconciliation
            .as_ref()
            .map(|state| state.physical_reference()),
        body.pose
    );

    // Return from the upper landing through ordinary navigation: horizontal steering must
    // descend onto the lower treads, not preserve the upper landing's altitude.
    let target = pose(Vector3::new(89.5, 96.0, floor_z));
    scene.apply_authoritative_body_effect(
        id,
        AuthoritativePoseEffect::Interpolate {
            pose: target,
            keep_heading: true,
            adjusted_max_speed_mps: None,
        },
        AuthoritativeBodyVectors::default(),
        now,
    );
    for tick in 300..900 {
        scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS),
                |_| {
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::grounded_drive(Vector3::zero())?,
                        PhysicalReferenceInput::body(None),
                        true,
                    ))
                },
            )
            .unwrap();
    }
    let body = scene.body(id).unwrap();
    assert!(
        (body.pose.coords.z - floor_z).abs() < CONTACT_EPSILON,
        "return floated above the lower floor: {:?}",
        body.pose
    );
    assert!(
        body.pose.distance_to(&target)
            <= crate::spatial::pose_reconciliation::RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
    );
    assert!(
        body.physical
            .as_ref()
            .unwrap()
            .response
            .ground()
            .walkable_support()
            .is_some()
    );
    assert!(!body.has_pose_reconciliation_work());
}

#[test]
fn observer_vector_departure_is_published_and_survives_a_vetoed_tick() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let definition = grounded_definition();
    let sphere = definition.spheres().primary();
    let start = pose(Vector3::new(90.0, 96.0, sphere.radius - sphere.center.z));
    scene.register_body(SpatialBody::new(id, start, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    acquire_support(&mut scene, &collision, id, now);
    let vectors = AuthoritativeBodyVectors {
        velocity: Vector3::new(0.0, 0.0, 4.0),
        ..AuthoritativeBodyVectors::default()
    };
    scene.apply_authoritative_body_vectors(id, vectors, now);
    assert_eq!(
        scene.body(id).unwrap().contact,
        ContactState::Grounded,
        "packet published an unsolved contact transition"
    );
    let input = PhysicalBodyInput::referenced(
        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
        PhysicalReferenceInput::body(None),
        true,
    );
    let before = scene.body(id).unwrap().clone();
    let veto = scene.tick_physical_body_transaction(
        id,
        &collision,
        input.clone(),
        MOBILE_CONTACT_TICK_SECONDS,
        now,
        |_, _| -> anyhow::Result<()> { anyhow::bail!("fixture veto") },
    );
    assert_eq!(veto.unwrap_err().to_string(), "fixture veto");
    assert_eq!(scene.body(id).unwrap(), &before);
    for tick in 0..120 {
        let result = scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS),
                |_| Ok(input.clone()),
            )
            .unwrap();
        if tick == 0 {
            let DynamicEntityBodyOutcome::Integrated(update) = &result.outcomes[0] else {
                panic!("expected integrated support")
            };
            assert_eq!(update.previous_contact, ContactState::Grounded);
            let body = scene.body(id).unwrap();
            assert_eq!(body.contact, ContactState::Airborne);
            assert!(body.pose.coords.z > start.coords.z);
            assert!(body.retained.velocity.z > 0.0);
        }
    }
    assert_eq!(scene.body(id).unwrap().contact, ContactState::Grounded);
    assert_eq!(scene.body(id).unwrap().retained.velocity, Vector3::zero());
    // A newer stop vector cancels the upward sample before a tick runs.
    let later = now + Duration::from_secs_f32(120.0 * MOBILE_CONTACT_TICK_SECONDS);
    scene.apply_authoritative_body_vectors(id, vectors, later);
    scene.apply_authoritative_body_vectors(id, AuthoritativeBodyVectors::default(), later);
    scene
        .advance_dynamic_entity_collection(&collision, MOBILE_CONTACT_TICK_SECONDS, later, |_| {
            Ok(input.clone())
        })
        .unwrap();
    let body = scene.body(id).unwrap();
    assert_eq!(body.contact, ContactState::Grounded);
    assert_eq!(body.retained.velocity, Vector3::zero());
    assert!((body.pose.coords.z - start.coords.z).abs() < CONTACT_EPSILON);
}

#[test]
fn sustained_authored_turning_keeps_nominal_and_actual_motion_aligned() {
    let now = Instant::now();
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let definition = grounded_definition();
    let sphere = definition.spheres().primary();
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(90.0, 96.0, sphere.radius - sphere.center.z)),
        now,
    ));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    acquire_support(&mut scene, &collision, id, now);
    scene.apply_authoritative_body_vectors(
        id,
        AuthoritativeBodyVectors {
            velocity: Vector3::new(0.0, 2.0, 0.0),
            ..AuthoritativeBodyVectors::default()
        },
        now,
    );
    for tick in 0..240 {
        let offset = (tick < 180).then_some(holtburger_common::RigidTransform {
            translation: Vector3::new(0.0, 2.0 * MOBILE_CONTACT_TICK_SECONDS, 0.0),
            rotation: Quaternion::from_axis_angle(
                Vector3::new(0.0, 0.0, 1.0),
                0.8 * MOBILE_CONTACT_TICK_SECONDS,
            )
            .unwrap(),
        });
        scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS),
                |_| {
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                        PhysicalReferenceInput::body(offset),
                        true,
                    ))
                },
            )
            .unwrap();
        let body = scene.body(id).unwrap();
        assert_eq!(body.contact, ContactState::Grounded);
        assert!((body.nominal.velocity - body.retained.velocity).length() < CONTACT_EPSILON);
        assert!(
            !body.has_pose_reconciliation_work(),
            "unobstructed authored turn accumulated reference error at tick {tick}"
        );
    }
    assert_eq!(scene.body(id).unwrap().retained.velocity, Vector3::zero());
    assert!(
        scene
            .body(id)
            .unwrap()
            .physical
            .as_ref()
            .unwrap()
            .is_settled()
    );
}

#[test]
fn grounded_reference_uses_body_frame_across_conflicting_heading_updates() {
    for (keep_heading, moving) in [(true, true), (false, true), (true, false), (false, false)] {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::Entity(Guid(1));
        let definition = grounded_definition();
        let sphere = definition.spheres().primary();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(90.0, 96.0, sphere.radius - sphere.center.z)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, id, now);
        let omega = Vector3::new(0.0, 0.0, 0.4);
        scene.apply_authoritative_body_vectors(
            id,
            AuthoritativeBodyVectors {
                velocity: Vector3::new(0.0, 2.0, 0.0),
                omega,
                ..AuthoritativeBodyVectors::default()
            },
            now,
        );
        let interval = MOBILE_CONTACT_TICK_SECONDS;
        let offset = holtburger_common::RigidTransform {
            translation: Vector3::new(0.0, 2.0 * interval, 0.0),
            rotation: Quaternion::from_heading(0.8 * interval),
        };
        let mut target_heading = Quaternion::identity();
        for tick in 0..if moving { 180 } else { 1 } {
            let time = now + Duration::from_secs_f32(tick as f32 * interval);
            let before = scene.body(id).unwrap().pose;
            if tick % 15 == 0 {
                let mut reference = before;
                reference.rotation = before
                    .rotation
                    .multiply(&Quaternion::from_heading(std::f32::consts::PI));
                // A real positional error keeps correction active through later turns.
                if moving {
                    reference.coords.x += 0.5;
                }
                target_heading = reference.rotation;
                scene.apply_authoritative_body_effect(
                    id,
                    AuthoritativePoseEffect::Interpolate {
                        pose: reference,
                        keep_heading,
                        adjusted_max_speed_mps: None,
                    },
                    AuthoritativeBodyVectors::default(),
                    time,
                );
            }
            scene
                .advance_dynamic_entity_collection(&collision, interval, time, |_| {
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                        PhysicalReferenceInput::body(moving.then_some(offset)),
                        true,
                    ))
                })
                .unwrap();
            let body = scene.body(id).unwrap();
            let expected_velocity = if moving {
                before.rotation.rotate_vector(offset.translation) / interval
            } else {
                Vector3::zero()
            };
            assert!(
                (body.nominal.velocity - expected_velocity).length() < CONTACT_EPSILON,
                "packet heading redirected ordinary travel at tick {tick}, keep_heading={keep_heading}"
            );
            // A fresh authority heading wins its admitted tick. Position return
            // remains active afterward, but must not override later authored turns.
            let intended_heading = if keep_heading || tick % 15 != 0 {
                if moving {
                    before.rotation.multiply(&offset.rotation)
                } else {
                    before.rotation
                }
            } else {
                target_heading
            };
            let expected_heading = crate::spatial::scene::integrate_angular_velocity(
                intended_heading,
                omega,
                interval,
            );
            let forward = Vector3::new(0.0, 1.0, 0.0);
            assert!(
                (body.pose.rotation.rotate_vector(forward)
                    - expected_heading.rotate_vector(forward))
                .length()
                    < CONTACT_EPSILON,
                "authority or ordinary turning lost heading ownership at tick {tick}, keep_heading={keep_heading}"
            );
            assert_eq!(body.contact, ContactState::Grounded);
            if !moving {
                assert!(!body.has_pose_reconciliation_work());
            }
        }
        // Let the last displaced reference retire, then recapture from the accepted body.
        for tick in 180..360 {
            scene
                .advance_dynamic_entity_collection(
                    &collision,
                    interval,
                    now + Duration::from_secs_f32(tick as f32 * interval),
                    |_| {
                        Ok(PhysicalBodyInput::referenced(
                            PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                            PhysicalReferenceInput::body(None),
                            true,
                        ))
                    },
                )
                .unwrap();
        }
        assert!(!scene.body(id).unwrap().has_pose_reconciliation_work());
        let before = scene.body(id).unwrap().pose;
        scene
            .advance_dynamic_entity_collection(
                &collision,
                interval,
                now + Duration::from_secs_f32(360.0 * interval),
                |_| {
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                        PhysicalReferenceInput::body(Some(offset)),
                        true,
                    ))
                },
            )
            .unwrap();
        assert!(
            (scene.body(id).unwrap().nominal.velocity
                - before.rotation.rotate_vector(offset.translation) / interval)
                .length()
                < CONTACT_EPSILON
        );
    }
}

#[test]
fn remote_return_preserves_command_heading_for_sideways_and_backward_travel() {
    use crate::spatial::{PHYSICAL_RETURN_GAIN, RETAIL_INTERPOLATION_TARGET_THRESHOLD_M};
    for direction in [Vector3::new(1.0, 0.0, 0.0), Vector3::new(0.0, -1.0, 0.0)] {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::Entity(Guid(1));
        let definition = grounded_definition();
        let primary = definition.spheres().primary();
        let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
        scene.register_body(SpatialBody::new(id, start, now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, id, now);
        let mut target = start;
        target.coords = target.coords + direction * 2.0;
        scene.apply_authoritative_body_effect(
            id,
            AuthoritativePoseEffect::Interpolate {
                pose: target,
                keep_heading: true,
                adjusted_max_speed_mps: None,
            },
            AuthoritativeBodyVectors::default(),
            now,
        );
        let sample = PhysicalBodyInput::referenced(
            PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
            PhysicalReferenceInput::remote(None, start.rotation),
            true,
        );
        let before = scene.body(id).unwrap().clone();
        let veto = scene.tick_physical_body_transaction(
            id,
            &collision,
            sample.clone(),
            MOBILE_CONTACT_TICK_SECONDS,
            now,
            |_, _| -> anyhow::Result<()> { anyhow::bail!("reject proposed return") },
        );
        assert_eq!(veto.unwrap_err().to_string(), "reject proposed return");
        assert_eq!(scene.body(id).unwrap(), &before);
        for tick in 0..240 {
            let previous = scene.body(id).unwrap().pose;
            scene
                .advance_dynamic_entity_collection(
                    &collision,
                    MOBILE_CONTACT_TICK_SECONDS,
                    now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS),
                    |_| Ok(sample.clone()),
                )
                .unwrap();
            let body = scene.body(id).unwrap();
            assert_eq!(body.contact, ContactState::Grounded);
            assert!(
                body.retained.velocity.length()
                    <= PHYSICAL_RETURN_GAIN * (target.coords - previous.coords).length()
                        + CONTACT_EPSILON
            );
            assert!((body.pose.coords - previous.coords).dot(&direction) >= -CONTACT_EPSILON);
            assert_eq!(body.nominal.velocity, Vector3::zero());
            assert_eq!(body.pose.rotation, start.rotation);
        }
        let body = scene.body(id).unwrap();
        assert!(
            (body.pose.coords - target.coords).length() <= RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
        );
        assert_eq!(body.pose.rotation, start.rotation);
        // Ordinary forward motion resumes in the unchanged command frame.
        let speed = 2.0;
        let resumed = PhysicalBodyInput::referenced(
            PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
            PhysicalReferenceInput::remote(
                Some(holtburger_common::RigidTransform {
                    translation: Vector3::new(0.0, speed * MOBILE_CONTACT_TICK_SECONDS, 0.0),
                    rotation: Quaternion::identity(),
                }),
                start.rotation,
            ),
            true,
        );
        scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs(9),
                |_| Ok(resumed.clone()),
            )
            .unwrap();
        let body = scene.body(id).unwrap();
        assert!((body.nominal.velocity - Vector3::new(0.0, speed, 0.0)).length() < CONTACT_EPSILON);
        assert!((body.retained.velocity.y - speed).abs() < CONTACT_EPSILON);
        assert!(
            body.pose
                .rotation
                .rotate_vector(Vector3::new(0.0, 1.0, 0.0))
                .y
                > 0.99
        );
    }
}

#[test]
fn remote_command_sampling_and_physics_share_the_frame_after_return_and_authority_turn() {
    use crate::entity::{Entity, EntityMotionSnapshot, EntityNetworkMotion};
    use crate::motion::MotionCommand;
    use crate::state::motion_resolution::{
        BodyProjectionResolver,
        test_support::{FixtureCycle, explicit_motion_catalog},
    };
    use holtburger_common::properties::{PropertyDataId, WorldObjectPropertyAccessorsMut as _};
    use holtburger_protocol::messages::movement::InterpretedMotionCommand;
    let now = Instant::now();
    let collision = flat_collision_scene();
    let guid = Guid(1);
    let id = SpatialBodyId::Entity(guid);
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
    let mut world = crate::WorldState::synthetic();
    let table_id = 0x0900_0041;
    world.set_motion_sequences(explicit_motion_catalog(
        table_id,
        0x8000_003d,
        [FixtureCycle {
            command: MotionCommand::WALK_FORWARD.raw(),
            velocity: Some(Vector3::new(0.0, 2.0, 0.0)),
            omega: Some(Vector3::new(0.0, 0.0, 0.4)),
        }],
        [],
    ));
    let mut entity = Entity::new(guid, "Remote character".to_string(), start);
    entity
        .properties
        .set_did_prop(PropertyDataId::MotionTable, Guid(table_id));
    entity.network_motion = EntityNetworkMotion::Initialized(EntityMotionSnapshot::default());
    world.add_entity(entity);
    world
        .scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    acquire_support(&mut world.scene, &collision, id, now);
    let mut reference = start;
    reference.coords.x += 2.0;
    assert!(world.apply_authoritative_pose_effect(
        guid,
        Vector3::zero(),
        Vector3::zero(),
        AuthoritativePoseEffect::Interpolate {
            pose: reference,
            keep_heading: true,
            adjusted_max_speed_mps: None,
        }
    ));
    let duration = Duration::from_secs_f32(MOBILE_CONTACT_TICK_SECONDS);
    let advance = |world: &mut crate::WorldState, tick: u32| {
        let authored = world.advance_authored_motion(duration);
        world.apply_authored_motion_physics(&authored).unwrap();
        let projection = BodyProjectionResolver::new(&world.entities, &world.motion_runtimes);
        world
            .scene
            .advance_dynamic_entity_collection(
                &collision,
                duration.as_secs_f32(),
                now + duration * tick,
                |_| {
                    let sample = projection
                        .remote_motion_sample(guid)
                        .expect("remote source must be interpreted before physics");
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                        PhysicalReferenceInput::remote(sample.offset, sample.rotation),
                        true,
                    ))
                },
            )
            .unwrap();
    };
    for tick in 0..240 {
        advance(&mut world, tick);
    }
    let body = world.scene.body(id).unwrap();
    assert!(
        (body.pose.coords - reference.coords).length()
            <= crate::spatial::RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
    );
    assert_eq!(body.pose.rotation, start.rotation);
    world.entities.get_mut(guid).unwrap().network_motion =
        EntityNetworkMotion::Initialized(EntityMotionSnapshot {
            forward_command: Some(InterpretedMotionCommand::WALK_FORWARD),
            ..EntityMotionSnapshot::default()
        });
    for tick in 240..480 {
        if tick == 330 {
            let mut authority = world.scene.body(id).unwrap().pose;
            authority.rotation = Quaternion::from_axis_angle(
                Vector3::new(0.0, 0.0, 1.0),
                std::f32::consts::FRAC_PI_3,
            )
            .unwrap();
            assert!(world.apply_authoritative_pose_effect(
                guid,
                Vector3::zero(),
                Vector3::zero(),
                AuthoritativePoseEffect::Interpolate {
                    pose: authority,
                    keep_heading: false,
                    adjusted_max_speed_mps: None,
                }
            ));
        }
        advance(&mut world, tick);
        let body = world.scene.body(id).unwrap();
        assert_eq!(body.contact, ContactState::Grounded);
        assert!(
            (body.retained.velocity - body.nominal.velocity).length() < 0.001,
            "ordinary source and actual travel diverged at tick {tick}"
        );
        assert!(
            !body.has_pose_reconciliation_work(),
            "ordinary turning manufactured return work at tick {tick}"
        );
    }
    world.entities.get_mut(guid).unwrap().network_motion =
        EntityNetworkMotion::Initialized(EntityMotionSnapshot::default());
    let stopped = world.scene.body(id).unwrap().pose.coords;
    for tick in 480..540 {
        advance(&mut world, tick);
    }
    let body = world.scene.body(id).unwrap();
    assert_eq!(body.retained.velocity, Vector3::zero());
    assert!((body.pose.coords - stopped).length() < CONTACT_EPSILON);
}

#[test]
fn sticky_pursuit_moves_and_faces_target_over_pending_authority_heading() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
    scene.register_body(SpatialBody::new(id, start, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    acquire_support(&mut scene, &collision, id, now);
    let mut authority = start;
    authority.rotation = Quaternion::from_heading(0.7);
    scene.apply_authoritative_body_effect(
        id,
        AuthoritativePoseEffect::Interpolate {
            pose: authority,
            keep_heading: false,
            adjusted_max_speed_mps: None,
        },
        AuthoritativeBodyVectors::default(),
        now,
    );
    let mut target = start;
    target.coords.x += 5.0;
    let pursuit = crate::spatial::StickyBodyTarget {
        position: target,
        clearance: 1.3,
        speed_mps: 5.0,
        heading: start.heading_to(&target),
    };
    scene
        .advance_dynamic_entity_collection(&collision, MOBILE_CONTACT_TICK_SECONDS, now, |_| {
            Ok(PhysicalBodyInput::referenced(
                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                PhysicalReferenceInput::Sticky(pursuit),
                true,
            ))
        })
        .unwrap();
    let body = scene.body(id).unwrap();
    assert_eq!(body.contact, ContactState::Grounded);
    assert!(
        (body.pose.coords.x - start.coords.x - pursuit.speed_mps * MOBILE_CONTACT_TICK_SECONDS)
            .abs()
            < CONTACT_EPSILON
    );
    let facing = body
        .pose
        .rotation
        .rotate_vector(Vector3::new(0.0, 1.0, 0.0));
    let expected = Quaternion::from_heading(start.heading_to(&target))
        .rotate_vector(Vector3::new(0.0, 1.0, 0.0));
    assert!((facing - expected).length() < CONTACT_EPSILON);
    assert!((body.nominal.velocity.x - pursuit.speed_mps).abs() < CONTACT_EPSILON);
}

#[test]
fn sticky_reference_cannot_replace_launch_or_airborne_continuation() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::LocalPlayer(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
    scene.register_body(SpatialBody::new(id, start, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    acquire_support(&mut scene, &collision, id, now);
    let launch_velocity = Vector3::new(0.0, 0.0, 5.0);
    let mut target = start;
    target.coords.x += 10.0;
    let pursuit = crate::spatial::StickyBodyTarget {
        position: target,
        clearance: 1.3,
        speed_mps: 5.0,
        heading: start.heading_to(&target),
    };
    for tick in 0..3 {
        let input = PhysicalBodyInput::referenced(
            PhysicalBodyActuation::Grounded(if tick == 0 {
                GroundedBodyActuation::coast()
                    .with_launch(GroundedLaunch::new(launch_velocity).unwrap())
            } else {
                GroundedBodyActuation::coast()
            }),
            // Deliberately retain an old sample, stronger than core's launch/airborne filtering.
            PhysicalReferenceInput::Sticky(pursuit),
            true,
        );
        let result = scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS),
                |_| Ok(input.clone()),
            )
            .unwrap();
        let DynamicEntityBodyOutcome::Integrated(update) = &result.outcomes[0] else {
            panic!("expected integrated launch")
        };
        assert_eq!(update.launch_admitted, tick == 0);
        let body = scene.body(id).unwrap();
        assert_eq!(body.contact, ContactState::Airborne);
        let expected = launch_velocity
            + Vector3::new(
                0.0,
                0.0,
                GROUNDED_CONFIG.gravity * MOBILE_CONTACT_TICK_SECONDS * (tick + 1) as f32,
            );
        assert!((body.retained.velocity - expected).length() < CONTACT_EPSILON);
        assert!((body.pose.coords.x - start.coords.x).abs() < CONTACT_EPSILON);
    }
}

#[test]
fn blocked_sticky_pursuit_keeps_reference_at_moving_target_clearance() {
    let collision = contact_stair_scene(2.0, false);
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
    scene.register_body(SpatialBody::new(id, start, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    acquire_support(&mut scene, &collision, id, now);
    scene.apply_authoritative_body_effect(
        id,
        AuthoritativePoseEffect::Interpolate {
            pose: start,
            keep_heading: true,
            adjusted_max_speed_mps: None,
        },
        AuthoritativeBodyVectors::default(),
        now,
    );
    let mut target = start;
    target.coords.x += 10.0;
    let clearance = 1.3;
    for tick in 0..900 {
        if tick == 120 {
            target.coords.x += 2.0;
        }
        let actual = scene.body(id).unwrap().pose;
        let sample = PhysicalBodyInput::referenced(
            PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
            PhysicalReferenceInput::Sticky(crate::spatial::StickyBodyTarget {
                position: target,
                clearance,
                speed_mps: 5.0,
                heading: actual.heading_to(&target),
            }),
            true,
        );
        scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS),
                |_| Ok(sample.clone()),
            )
            .unwrap();
        let body = scene.body(id).unwrap();
        assert_eq!(body.contact, ContactState::Grounded);
        assert!(
            body.pose.coords.x < 91.0,
            "hard obstacle must block actual pursuit"
        );
        let reference = body
            .reconciliation
            .as_ref()
            .unwrap()
            .physical_reference()
            .unwrap();
        assert!(reference.coords.x <= target.coords.x - clearance + CONTACT_EPSILON);
    }
    let body = scene.body(id).unwrap();
    let reference = body
        .reconciliation
        .as_ref()
        .unwrap()
        .physical_reference()
        .unwrap();
    assert!((reference.coords.x - (target.coords.x - clearance)).abs() < CONTACT_EPSILON);
    assert!(body.nominal.velocity.length() < CONTACT_EPSILON);
}

#[test]
fn sticky_attack_keeps_its_hook_and_replaces_root_travel_in_collection() {
    use crate::entity::{
        EntityMotionAction, EntityMotionActionSource, EntityMotionAdmission, EntityMotionSnapshot,
        OrderedMotionScalar,
    };
    use crate::motion::{
        MotionCommand, MotionRuntimeRegistry, RemoteFramePolicy, RemoteMotionInput,
    };
    use holtburger_content::MotionSequenceCatalog;
    use holtburger_dat::file_type::animation::AnimationFlags;
    use holtburger_dat::file_type::motion_table::{AnimData, MotionData, MotionDataFlags};
    use holtburger_dat::file_type::setup_model::{
        AnimationFrame, AnimationHook, AnimationHookPayload, EtherealHookPayload,
    };
    use holtburger_dat::file_type::{Animation, MotionTable};
    use holtburger_dat::graphics::Frame;
    use std::collections::HashMap;

    let style = 0x8000_003d;
    let ready = 0x4500_0003;
    let attack = 0x1000_004a;
    let animation_id = 0x0300_0001;
    let motion = |anims| MotionData {
        bitfield: 0,
        flags: MotionDataFlags::empty(),
        anims,
        velocity: None,
        omega: None,
    };
    let animation = Animation {
        id: animation_id,
        flags: AnimationFlags::POS_FRAMES,
        num_parts: 0,
        num_frames: 4,
        pos_frames: vec![
            Frame {
                origin: Vector3::new(0.0, 1.0, 0.0),
                orientation: Quaternion::identity()
            };
            4
        ],
        part_frames: (0..4)
            .map(|index| AnimationFrame {
                frames: Vec::new(),
                hooks: if index == 1 {
                    vec![AnimationHook {
                        hook_type: 6,
                        direction: 1,
                        payload: AnimationHookPayload::Ethereal(EtherealHookPayload {
                            ethereal: true,
                        }),
                    }]
                } else {
                    Vec::new()
                },
            })
            .collect(),
    };
    let mut resting = animation.clone();
    resting.id = animation_id + 1;
    for frame in &mut resting.pos_frames {
        frame.origin = Vector3::zero();
    }
    for frame in &mut resting.part_frames {
        frame.hooks.clear();
    }
    let catalog = MotionSequenceCatalog::assemble(
        [MotionTable {
            id: 0x0900_0001,
            default_style: style,
            style_defaults: HashMap::from([(style, ready)]),
            cycles: HashMap::from([(
                MotionTable::cycle_key(style, ready),
                motion(vec![AnimData {
                    anim_id: resting.id,
                    low_frame: 0,
                    high_frame: -1,
                    framerate: 8.0,
                }]),
            )]),
            modifiers: HashMap::new(),
            links: HashMap::from([(
                MotionTable::cycle_key(style, ready),
                HashMap::from([(
                    attack,
                    motion(vec![AnimData {
                        anim_id: animation_id,
                        low_frame: 0,
                        high_frame: -1,
                        framerate: 8.0,
                    }]),
                )]),
            )]),
        }],
        [animation, resting],
        [],
    )
    .unwrap();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = Guid(1);
    let id = SpatialBodyId::Entity(guid);
    let now = Instant::now();
    let mut registry = MotionRuntimeRegistry::new();
    registry.enqueue_action(
        table,
        guid,
        EntityMotionAction {
            command: MotionCommand(attack),
            speed: OrderedMotionScalar::from_f32(1.0).unwrap(),
            action_sequence: 1,
            is_autonomous: false,
            admission: EntityMotionAdmission {
                object_instance_sequence: 1,
                movement_sequence: 1,
                server_control_sequence: 1,
                is_autonomous: false,
            },
            source: EntityMotionActionSource::CommandList,
        },
    );
    registry.admit_sticky_target(table, guid, Some(Guid(2)), now);
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
    scene.register_body(SpatialBody::new(id, start, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    acquire_support(&mut scene, &collision, id, now);
    let mut hooks = 0;
    let mut completed = false;
    for step in 0..30 {
        let before = scene.body(id).unwrap().pose;
        let tick = registry
            .drive_remote(
                table,
                guid,
                RemoteMotionInput {
                    snapshot: EntityMotionSnapshot::default(),
                    pose: before,
                    contact: ContactState::Grounded,
                    target: None,
                    frame_policy: RemoteFramePolicy::Command,
                    omega: Vector3::zero(),
                },
                MOBILE_CONTACT_TICK_SECONDS,
            )
            .clone();
        hooks += tick.hooks.len();
        let sticky = registry.get(guid).unwrap().sticky_target().is_some();
        if sticky && !tick.action_completed {
            assert_eq!(
                registry.get(guid).unwrap().active_action().unwrap().command,
                MotionCommand(attack)
            );
        }
        if sticky {
            assert!(
                tick.offset.translation.length() > 0.0,
                "fixture must offer competing attack root travel"
            );
        }
        let mut target = start;
        target.coords.x += 10.0 + step as f32 * MOBILE_CONTACT_TICK_SECONDS;
        let source = registry.get(guid).unwrap().remote_motion_sample().unwrap();
        let reference = if sticky {
            PhysicalReferenceInput::Sticky(crate::spatial::StickyBodyTarget {
                position: target,
                clearance: 1.3,
                speed_mps: 5.0,
                heading: before.heading_to(&target),
            })
        } else {
            PhysicalReferenceInput::remote(source.offset, source.rotation)
        };
        scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now + Duration::from_secs_f32(step as f32 * MOBILE_CONTACT_TICK_SECONDS),
                |_| {
                    Ok(PhysicalBodyInput::referenced(
                        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                        reference,
                        true,
                    ))
                },
            )
            .unwrap();
        let after = scene.body(id).unwrap().pose;
        if sticky {
            assert!(
                (after.coords.x - before.coords.x - 5.0 * MOBILE_CONTACT_TICK_SECONDS).abs()
                    < CONTACT_EPSILON
            );
            assert!((after.coords.y - before.coords.y).abs() < CONTACT_EPSILON);
        }
        completed |= tick.action_completed;
    }
    assert!(completed);
    assert_eq!(hooks, 1);
    assert_eq!(registry.get(guid).unwrap().sticky_target(), None);
}

#[test]
fn incoming_mobile_motion_does_not_propagate_velocity_through_a_cluster() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let mut scene = SpatialScene::new();
    let radius = 0.5;
    let speed = 20.0;
    let ids = [
        SpatialBodyId::Entity(Guid(1)),
        SpatialBodyId::LocalPlayer(Guid(2)),
        SpatialBodyId::Entity(Guid(3)),
        SpatialBodyId::Entity(Guid(4)),
    ];
    for (index, id) in ids.into_iter().enumerate() {
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(90.0 + index as f32 * 0.8, 96.0, 3.0)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(
                    free_definition(Vector3::zero(), radius),
                    false,
                )),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
    }
    scene.body_mut(ids[0]).unwrap().retained.velocity = Vector3::new(speed, 0.0, 0.0);
    let bodies: Vec<_> = ids
        .iter()
        .map(|id| scene.body(*id).unwrap().clone())
        .collect();
    let result = crate::spatial::advance_body_contact_collection(
        &collision,
        &bodies,
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |_, _, _| ContactStepActuation::ballistic(Vector3::zero()),
    )
    .unwrap();
    let mut separated = false;
    for body in &bodies {
        let update = result
            .bodies
            .iter()
            .find(|update| update.body_id == body.id)
            .unwrap();
        assert_eq!(
            update.velocity,
            Vector3::zero(),
            "incoming velocity must brake, not propagate to resting peers"
        );
        let ordinary = body.retained.velocity * MOBILE_CONTACT_TICK_SECONDS;
        let separation = update.displacement - ordinary;
        assert!(
            separation.length()
                <= radius * MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO + CONTACT_EPSILON
        );
        separated |= separation.length() > CONTACT_EPSILON;
    }
    assert!(
        separated,
        "positional separation must still resolve crowd overlap"
    );
}

#[test]
fn proportional_return_scales_with_distance_and_converges_without_overshoot() {
    use crate::spatial::{
        PHYSICAL_RETURN_GAIN, PHYSICAL_RETURN_START_THRESHOLD_M,
        RETAIL_INTERPOLATION_TARGET_THRESHOLD_M,
    };
    for distance in [PHYSICAL_RETURN_START_THRESHOLD_M * 2.0, 2.0, 5.0, 10.0] {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::Entity(Guid(1));
        let definition = grounded_definition();
        let primary = definition.spheres().primary();
        let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
        scene.register_body(SpatialBody::new(id, start, now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, id, now);
        let mut target = start;
        target.coords.x += distance;
        scene.apply_authoritative_body_effect(
            id,
            AuthoritativePoseEffect::Interpolate {
                pose: target,
                keep_heading: true,
                adjusted_max_speed_mps: None,
            },
            AuthoritativeBodyVectors::default(),
            now,
        );
        let duration = MOBILE_CONTACT_TICK_SECONDS;
        let ticks = ((distance / RETAIL_INTERPOLATION_TARGET_THRESHOLD_M).ln()
            / -(1.0 - PHYSICAL_RETURN_GAIN * duration).ln())
        .ceil() as usize
            + 30;
        let mut previous = start.coords.x;
        for tick in 0..ticks {
            scene
                .advance_dynamic_entity_collection(
                    &collision,
                    duration,
                    now + Duration::from_secs_f32(tick as f32 * duration),
                    |_| {
                        Ok(PhysicalBodyInput::referenced(
                            PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                            PhysicalReferenceInput::remote(None, start.rotation),
                            true,
                        ))
                    },
                )
                .unwrap();
            let body = scene.body(id).unwrap();
            if tick == 0 {
                assert!(
                    (body.retained.velocity.x - distance * PHYSICAL_RETURN_GAIN).abs()
                        < CONTACT_EPSILON
                );
            }
            assert!(body.pose.coords.x >= previous - CONTACT_EPSILON);
            assert!(body.pose.coords.x <= target.coords.x + CONTACT_EPSILON);
            assert_eq!(body.pose.rotation, start.rotation);
            assert_eq!(body.contact, ContactState::Grounded);
            assert_eq!(body.nominal.velocity, Vector3::zero());
            previous = body.pose.coords.x;
        }
        assert!(target.coords.x - previous <= RETAIL_INTERPOLATION_TARGET_THRESHOLD_M);
    }
}

/// A server home placement can arrive as ordinary interpolation, without a teleport epoch.
#[test]
fn stalled_remote_return_recovers_across_wall_but_rejects_occupied_destination() {
    use crate::spatial::pose_reconciliation::recovery::RECOVERY_WINDOW_SECONDS;
    #[derive(Debug, Clone, Copy, PartialEq)]
    enum Case {
        Clear,
        PredictedInsideWall,
        Occupied,
        MissingCell,
        ControlledPlayer,
        Sticky,
        UnpreparedSticky,
    }
    for case in [
        Case::Clear,
        Case::PredictedInsideWall,
        Case::Occupied,
        Case::MissingCell,
        Case::ControlledPlayer,
        Case::Sticky,
        Case::UnpreparedSticky,
    ] {
        let occupied = case == Case::Occupied;
        let now = Instant::now();
        let mut collision = flat_collision_scene();
        let mut asset = flat_collision_asset(0);
        asset.static_geometry = LandblockColliders::new(
            vec![
                PlacedCollider::new(
                    polygon_wall_shape(),
                    LandblockPlacement {
                        origin: Vector3::new(92.0, 96.0, 1.0),
                        orientation: Quaternion::identity(),
                    },
                    ColliderScale::uniform(1.0).unwrap(),
                    StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
                )
                .unwrap(),
            ],
            Vec::new(),
        );
        collision.insert(asset).unwrap();
        let id = if case == Case::ControlledPlayer {
            SpatialBodyId::LocalPlayer(Guid(1))
        } else {
            SpatialBodyId::Entity(Guid(1))
        };
        let definition = grounded_definition();
        let primary = definition.spheres().primary();
        let start = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
        let mut target = pose(Vector3::new(
            if occupied { 92.0 } else { 94.0 },
            96.0,
            start.coords.z,
        ));
        if case == Case::MissingCell {
            target.landblock_id = Guid(target.landblock_id.0 & 0xffff_0000 | 0x100);
        }
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(id, start, now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, id, now);
        let input = PhysicalBodyInput::referenced(
            PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
            if case == Case::Sticky {
                PhysicalReferenceInput::Sticky(crate::spatial::StickyBodyTarget {
                    position: target,
                    clearance: 0.0,
                    speed_mps: 2.0,
                    heading: start.rotation.to_heading(),
                })
            } else {
                PhysicalReferenceInput::remote(None, start.rotation)
            },
            true,
        );
        let input = if case == Case::UnpreparedSticky {
            input.suspend_recovery()
        } else {
            input
        };
        let ticks = (RECOVERY_WINDOW_SECONDS * 3.0 / MOBILE_CONTACT_TICK_SECONDS).ceil() as usize;
        let mut world = crate::WorldState::synthetic();
        world.add_entity(crate::entity::Entity::new(
            Guid(1),
            "Returning mob".to_owned(),
            start,
        ));
        world.scene = scene;
        let mut recovered = false;
        for index in 0..ticks {
            // Repeated identical authority must not postpone recovery forever.
            if case == Case::Clear {
                let mut events = Vec::new();
                assert!(world.apply_entity_position_pack(Guid(1), &holtburger_protocol::messages::movement::PositionPack {
                    pos: target,
                    position_sequence: (index + 1) as u16,
                    flags: holtburger_protocol::messages::movement::UpdatePositionFlag::HAS_CONTACT,
                    ..Default::default()
                }, &mut events));
                assert!(
                    events
                        .iter()
                        .all(|event| !matches!(event, crate::WorldEvent::ForcedReposition { .. }))
                );
            } else {
                world.scene.apply_authoritative_body_effect(
                    id,
                    AuthoritativePoseEffect::Interpolate {
                        pose: target,
                        keep_heading: true,
                        adjusted_max_speed_mps: None,
                    },
                    AuthoritativeBodyVectors::default(),
                    now,
                );
            }
            if case == Case::PredictedInsideWall {
                let mut predicted = target;
                predicted.coords.x = 92.0;
                world
                    .scene
                    .body_mut(id)
                    .unwrap()
                    .reconciliation
                    .as_mut()
                    .unwrap()
                    .correct(predicted, true);
            }
            let scene = &mut world.scene;
            let tick = scene
                .advance_dynamic_entity_collection(
                    &collision,
                    MOBILE_CONTACT_TICK_SECONDS,
                    now + Duration::from_secs_f32(index as f32 * MOBILE_CONTACT_TICK_SECONDS),
                    |_| Ok(input.clone()),
                )
                .unwrap();
            if tick.outcomes.iter().any(|outcome| matches!(outcome, DynamicEntityBodyOutcome::RecoveredPlacement(body_id) if *body_id == id)) {
                assert!(matches!(case, Case::Clear | Case::PredictedInsideWall));
                assert_eq!(tick.outcomes.iter().filter(|outcome| outcome.body_id() == id).count(), 1);
                let body = scene.body(id).unwrap();
                assert!((body.pose.coords - target.coords).length() < 0.001);
                assert!(body.reconciliation.is_none());
                assert_eq!(body.retained.velocity, Vector3::zero());
                assert_eq!(body.nominal.velocity, Vector3::zero());
                recovered = true;
                break;
            }
        }
        assert_eq!(
            recovered,
            matches!(case, Case::Clear | Case::PredictedInsideWall),
            "{case:?}"
        );
        if occupied {
            assert!(world.scene.body(id).unwrap().pose.coords.x < 92.0);
        }
    }
}

#[test]
fn recovery_placement_checks_hard_entities_and_accommodates_support() {
    use crate::spatial::mobile_contact::checked_recovery_destination;
    let collision = flat_collision_scene();
    let now = Instant::now();
    let id = SpatialBodyId::Entity(Guid(1));
    let hard = SpatialBodyId::Entity(Guid(2));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let standing = pose(Vector3::new(90.0, 96.0, primary.radius - primary.center.z));
    let mut scene = SpatialScene::new();
    let mut obstruction = standing;
    obstruction.coords.z += 1.0;
    for (body_id, position) in [(id, standing), (hard, obstruction)] {
        scene.register_body(SpatialBody::new(body_id, position, now));
        scene
            .set_dynamic_physical_body(
                body_id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        scene
            .refresh_dynamic_body_placement(body_id, &collision)
            .unwrap();
    }
    scene
        .body_mut(hard)
        .unwrap()
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .demand
        .integration = LocalIntegrationDemand::Excluded;
    let candidate = scene.body(id).unwrap().clone();
    assert!(
        checked_recovery_destination(&collision, &candidate, &[scene.body(hard).unwrap().clone()])
            .unwrap()
            .is_none()
    );
    let mut below_floor = standing;
    below_floor.coords.z -= 0.05;
    let mut candidate = relocated_dynamic_body(&candidate, below_floor, now).unwrap();
    let membership = resolve_dynamic_body_placement(&collision, &candidate, None).unwrap();
    candidate
        .physical
        .as_mut()
        .unwrap()
        .dynamic
        .as_mut()
        .unwrap()
        .placement = membership;
    let recovered = checked_recovery_destination(&collision, &candidate, &[])
        .unwrap()
        .unwrap();
    assert!((recovered.0.coords.z - standing.coords.z).abs() < 0.001);
}

#[test]
fn player_contact_suspends_recovery_without_preserving_an_expired_window() {
    use crate::spatial::{
        mobile_contact::has_player_contact, pose_reconciliation::recovery::RECOVERY_WINDOW_SECONDS,
    };
    let collision = flat_collision_scene();
    let now = Instant::now();
    let mob = SpatialBodyId::Entity(Guid(1));
    let player = SpatialBodyId::LocalPlayer(Guid(2));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    let mut scene = SpatialScene::new();
    for (id, x) in [(mob, 90.0), (player, 90.0 + primary.radius * 2.0)] {
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(x, 96.0, primary.radius - primary.center.z)),
            now,
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        scene
            .refresh_dynamic_body_placement(id, &collision)
            .unwrap();
    }
    let mob = scene.body(mob).unwrap();
    let contact = has_player_contact(mob, scene.body(player)).unwrap();
    assert!(contact);
    let target = pose(mob.pose.coords + Vector3::new(10.0, 0.0, 0.0));
    let mut state = PoseReconciliationState::default();
    state.correct(target, false);
    assert!(!state.observe_recovery(mob.pose, target, RECOVERY_WINDOW_SECONDS * 0.75, true));
    assert!(!state.observe_recovery(mob.pose, target, RECOVERY_WINDOW_SECONDS, !contact));
    assert!(!state.observe_recovery(mob.pose, target, RECOVERY_WINDOW_SECONDS * 0.5, true));
    assert!(state.observe_recovery(mob.pose, target, RECOVERY_WINDOW_SECONDS * 0.5, true));
}

#[test]
fn sustained_mobile_resistance_is_slow_and_stable_across_tick_rates() {
    use crate::spatial::mobile_contact::MOBILE_PUSH_THROUGH_SPEED;
    let mut advances = Vec::new();
    for hz in [30, 60, 144] {
        for approaching in [false, true] {
            let now = Instant::now();
            let collision = flat_collision_scene();
            let mut scene = SpatialScene::new();
            let player = SpatialBodyId::LocalPlayer(Guid(1));
            let mob = SpatialBodyId::Entity(Guid(2));
            let definition = grounded_definition();
            let primary = definition.spheres().primary();
            let floor_z = primary.radius - primary.center.z;
            let spacing = 2.0 * primary.radius;
            for (id, x) in [(player, 90.0), (mob, 90.0 + spacing)] {
                scene.register_body(SpatialBody::new(
                    id,
                    pose(Vector3::new(x, 96.0, floor_z)),
                    now,
                ));
                scene
                    .set_dynamic_physical_body(
                        id,
                        Some(dynamic_definition(definition, false)),
                        PhysicalCollisionFilter::ALL,
                        None,
                    )
                    .unwrap();
                acquire_support(&mut scene, &collision, id, now);
            }
            let seconds = 4.0;
            let dt = 1.0 / hz as f32;
            for _ in 0..(seconds / dt).round() as usize {
                let bodies = [
                    scene.body(player).unwrap().clone(),
                    scene.body(mob).unwrap().clone(),
                ];
                let updates = advance_body_contacts(
                    &collision,
                    &bodies,
                    Guid(0xda55_ffff),
                    dt,
                    |body, ground| {
                        let speed = match (body.id == player, approaching) {
                            (true, false) => 2.0,
                            (false, true) => -2.0,
                            _ => 0.0,
                        };
                        grounded_step_input(
                            body,
                            ground,
                            &GroundedBodyActuation::drive(Vector3::new(speed, 0.0, 0.0)).unwrap(),
                        )
                    },
                )
                .unwrap();
                publish_contact_updates(&mut scene, updates);
            }
            let advance = scene.body(player).unwrap().pose.coords.x - 90.0;
            if approaching {
                // The same separation bias now acts on minute admitted overlap, not a full
                // running tick. A stationary player must not be carried along by the mob.
                assert!(
                    advance.abs() < MOBILE_PUSH_THROUGH_SPEED * seconds * 0.05,
                    "stationary player moved {advance} at {hz} Hz"
                );
            } else {
                let expected = MOBILE_PUSH_THROUGH_SPEED * seconds;
                assert!(
                    advance > expected * 0.7 && advance < expected * 1.1,
                    "pushing advanced {advance}, expected near {expected} at {hz} Hz"
                );
                assert!(scene.body(mob).unwrap().pose.coords.x > 90.0 + spacing + expected * 0.6);
                advances.push(advance);
            }
        }
    }
    assert!(
        advances.iter().copied().fold(f32::NEG_INFINITY, f32::max)
            - advances.iter().copied().fold(f32::INFINITY, f32::min)
            < crate::spatial::mobile_contact::MOBILE_CONTACT_TOLERANCE_METERS * 2.0
    );
}

#[test]
fn player_exemptions_remove_physical_resistance_and_report_touches() {
    use holtburger_common::properties::ObjectDescriptionFlag as Flags;
    for hard_peer in [false, true] {
        for pk in [false, true] {
            let collision = flat_collision_scene();
            let now = Instant::now();
            let mut scene = SpatialScene::new();
            let player = SpatialBodyId::LocalPlayer(Guid(1));
            let peer = SpatialBodyId::Entity(Guid(2));
            let speed = 1.0;
            for (id, x) in [(player, 90.0), (peer, 90.9)] {
                scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 2.0)), now));
                scene
                    .set_dynamic_physical_body(
                        id,
                        Some(dynamic_definition(
                            free_definition(Vector3::zero(), 0.5),
                            false,
                        )),
                        PhysicalCollisionFilter::ALL,
                        None,
                    )
                    .unwrap();
                let flags = Flags::PLAYER
                    | if pk {
                        Flags::PLAYER_KILLER
                    } else {
                        Flags::empty()
                    };
                scene.set_player_collision_status(
                    id,
                    crate::PlayerCollisionStatus::from_description(flags),
                );
                let body = scene.body_mut(id).unwrap();
                if id == player {
                    body.retained.velocity = Vector3::new(speed, 0.0, 0.0);
                }
                let dynamic = body.physical.as_mut().unwrap().dynamic.as_mut().unwrap();
                dynamic.collision.reporting.enabled = true;
                if hard_peer && id == peer {
                    dynamic.demand.integration = LocalIntegrationDemand::Excluded;
                }
            }
            let bodies = [
                scene.body(player).unwrap().clone(),
                scene.body(peer).unwrap().clone(),
            ];
            let result = crate::spatial::advance_body_contact_collection(
                &collision,
                &bodies,
                Guid(0xda55_ffff),
                MOBILE_CONTACT_TICK_SECONDS,
                |_, _, _| ContactStepActuation::ballistic(Vector3::zero()),
            )
            .unwrap();
            let moved = result
                .bodies
                .iter()
                .find(|body| body.body_id == player)
                .unwrap();
            if pk {
                assert!(moved.displacement.x < speed * MOBILE_CONTACT_TICK_SECONDS);
                assert!(!result.report_touches.is_empty());
                scene
                    .collision_reports
                    .commit_touches(&result.report_touches, now);
                for id in [player, peer] {
                    scene.set_player_collision_status(
                        id,
                        crate::PlayerCollisionStatus::from_description(Flags::PLAYER),
                    );
                }
                let exempt = [
                    scene.body(player).unwrap().clone(),
                    scene.body(peer).unwrap().clone(),
                ];
                let next = crate::spatial::advance_body_contact_collection(
                    &collision,
                    &exempt,
                    Guid(0xda55_ffff),
                    MOBILE_CONTACT_TICK_SECONDS,
                    |_, _, _| ContactStepActuation::ballistic(Vector3::zero()),
                )
                .unwrap();
                assert!(next.report_touches.is_empty());
                let expired = scene
                    .collision_reports
                    .expire(
                        now + crate::spatial::collision_report::COLLISION_REPORT_EXPIRY
                            + Duration::from_nanos(1),
                    )
                    .unwrap();
                assert_eq!(expired.len(), result.report_touches.len());
                assert!(
                    expired
                        .iter()
                        .all(|report| report.phase == crate::CollisionReportPhase::Ended)
                );
            } else {
                assert!(
                    (moved.displacement.x - speed * MOBILE_CONTACT_TICK_SECONDS).abs()
                        < CONTACT_EPSILON
                );
                assert_eq!(moved.velocity, Vector3::new(speed, 0.0, 0.0));
                assert!(result.report_touches.is_empty());
                if !hard_peer {
                    let peer = result
                        .bodies
                        .iter()
                        .find(|body| body.body_id == peer)
                        .unwrap();
                    assert_eq!(peer.displacement, Vector3::zero());
                }
            }
        }
    }
}

/// Stable characters must not lift off a flared wall and have ledge protection undo every move.
#[test]
fn ledge_protected_character_slides_flared_walls_without_losing_support() {
    for yaw in [0.0_f32, 30.0] {
        let now = Instant::now();
        let mut collision = flat_collision_scene();
        let mut asset = flat_collision_asset(0);
        let facing =
            Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), yaw.to_radians()).unwrap();
        let flare = Quaternion::from_axis_angle(Vector3::new(0.0, 1.0, 0.0), 10.0_f32.to_radians())
            .unwrap();
        let origin = Vector3::new(96.0, 96.0, 1.0);
        asset.static_geometry = LandblockColliders::new(
            vec![
                PlacedCollider::new(
                    polygon_wall_shape(),
                    LandblockPlacement {
                        origin,
                        orientation: facing.multiply(&flare),
                    },
                    ColliderScale::uniform(1.0).unwrap(),
                    StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
                )
                .unwrap(),
            ],
            Vec::new(),
        );
        collision.insert(asset).unwrap();
        let mut scene = SpatialScene::new();
        let id = SpatialBodyId::LocalPlayer(Guid(1));
        let definition = grounded_definition();
        let PhysicalBodyDefinition::Grounded { config, .. } = definition else {
            unreachable!()
        };
        assert_eq!(config.edge_protection, EdgeProtection::Creature);
        let primary = definition.spheres().primary();
        let start = Vector3::new(96.0, 96.0, primary.radius - primary.center.z)
            + facing.rotate_vector(Vector3::new(-0.6, -0.5, 0.0));
        scene.register_body(SpatialBody::new(id, pose(start), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        acquire_support(&mut scene, &collision, id, now);
        let tangent = facing.rotate_vector(Vector3::new(0.0, 1.0, 0.0));
        let mut direction = 1.0;
        let mut travel = 0.0;
        for tick in 0..180 {
            let before = scene.body(id).unwrap().pose.coords;
            let along = (before - start).dot(&tangent);
            if along > 1.0 {
                direction = -1.0;
            } else if along < 0.0 {
                direction = 1.0;
            }
            let drive = facing.rotate_vector(Vector3::new(2.0, direction, 0.0));
            scene.wake_dynamic_body(id);
            scene
                .advance_dynamic_entity_collection(
                    &collision,
                    CONTACT_INTERVAL,
                    now + Duration::from_secs_f32((tick + 1) as f32 * CONTACT_INTERVAL),
                    |_| {
                        Ok(PhysicalBodyInput::referenced(
                            PhysicalBodyActuation::grounded_drive(drive)?,
                            PhysicalReferenceInput::body(None),
                            true,
                        ))
                    },
                )
                .unwrap();
            let after = scene.body(id).unwrap();
            travel += (after.pose.coords - before).dot(&tangent).abs();
            assert_eq!(
                after.contact,
                ContactState::Grounded,
                "yaw={yaw} tick={tick}"
            );
            assert!((after.pose.coords.z - start.z).abs() < 0.0001);
        }
        assert!(
            travel > 180.0 * CONTACT_INTERVAL * 0.9,
            "yaw={yaw} travel={travel}"
        );
    }
}
