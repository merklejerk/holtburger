//! Production horizontal-footing and hard-clearance regression fixtures.

use super::*;
use crate::spatial::bsp_query::CONTACT_EPSILON;
use crate::spatial::{
    ContactMotionSegment, ContactStepActuation, MOBILE_CONTACT_TICK_SECONDS,
    StaticSphereSweepRequest, advance_body_contacts,
};

/// Query production geometry with a fixture-owned vertical search envelope.
fn support(
    face: &CollisionPolygon,
    center: Vector3,
    radius: f32,
) -> Option<crate::spatial::bsp_query::ShapeSupport> {
    crate::spatial::bsp_query::support_on_polygon(
        &face.vertices,
        face.normal,
        face.d,
        center,
        radius,
        10.0,
        10.0,
    )
}

/// Apply a production candidate's vertical adjustment without altering horizontal input.
fn resting_center(face: &CollisionPolygon, center: Vector3, radius: f32) -> Option<Vector3> {
    support(face, center, radius).map(|s| center + Vector3::new(0.0, 0.0, s.height_delta))
}

/// Read the query-owned edge direction rather than independently deriving it in the consumer.
fn inward_normal(face: &CollisionPolygon, center: Vector3, radius: f32) -> Vector3 {
    support(face, center, radius)
        .unwrap()
        .feature
        .inward_normal()
        .unwrap()
}

/// Finite ramp beginning at the first riser of the existing asset-free stair fixture.
fn tread(slope: f32) -> CollisionPolygon {
    let normal = Vector3::new(-slope, 0.0, 1.0).normalize();
    let vertices = vec![
        Vector3::new(90.5, 94.0, 0.3),
        Vector3::new(95.0, 94.0, 0.3 + 4.5 * slope),
        Vector3::new(95.0, 98.0, 0.3 + 4.5 * slope),
        Vector3::new(90.5, 98.0, 0.3),
    ];
    CollisionPolygon {
        d: -normal.dot(&vertices[0]),
        normal,
        vertices,
    }
}

/// One tread and its riser, with the production fixture's ordinary flat ground underneath.
fn stair_collision(face: &CollisionPolygon) -> CollisionScene {
    let riser = CollisionPolygon {
        vertices: vec![
            Vector3::new(90.5, 94.0, 0.0),
            Vector3::new(90.5, 94.0, 0.3),
            Vector3::new(90.5, 98.0, 0.3),
            Vector3::new(90.5, 98.0, 0.0),
        ],
        normal: Vector3::new(-1.0, 0.0, 0.0),
        d: 90.5,
    };
    collision_with_polygons(HashMap::from([(0, riser), (1, face.clone())]))
}

/// Exact production hard query used by ordinary movement and stair paths.
fn hit(
    scene: &CollisionScene,
    start: Vector3,
    end: Vector3,
    radius: f32,
) -> Option<crate::spatial::StaticSphereSweepHit> {
    scene
        .sweep_static_sphere(StaticSphereSweepRequest {
            anchor: Guid(0xda55_ffff),
            start,
            end,
            radius,
            previous_cell: None,
            filter: PhysicalCollisionFilter::ALL,
        })
        .unwrap()
}

#[test]
fn footing_resting_query_is_idempotent_on_faces_slopes_edges_and_corners() {
    let radius = grounded_definition().spheres().primary().radius;
    let mut admitted = 0;
    let mut rejected = 0;
    for slope in [0.0, 0.25, 0.5] {
        let face = tread(slope);
        for x in [90.0, 90.25, 90.5, 90.75, 92.0] {
            for y in [93.5, 93.75, 94.0, 96.0] {
                let mut classification = None;
                for z in [-0.1, 0.3, 0.8, 2.0] {
                    let center = Vector3::new(x, y, z);
                    let candidate = resting_center(&face, center, radius);
                    if let Some(previous) = classification {
                        assert_eq!(previous, candidate.is_some());
                    }
                    classification = Some(candidate.is_some());
                    if let Some(rest) = candidate {
                        admitted += 1;
                        let next =
                            resting_center(&face, rest, radius).expect("rest lost its footprint");
                        assert!((next - rest).length() <= CONTACT_EPSILON);
                        assert!(
                            (face.normal.dot(&rest) + face.d - radius).abs() <= CONTACT_EPSILON
                        );
                    } else {
                        rejected += 1;
                    }
                }
            }
        }
    }
    assert!(admitted > 0 && rejected > 0);
}

#[test]
fn footing_shared_triangle_seam_does_not_remove_support() {
    let face = tread(0.25);
    let first = CollisionPolygon {
        vertices: vec![face.vertices[0], face.vertices[1], face.vertices[2]],
        ..face.clone()
    };
    let second = CollisionPolygon {
        vertices: vec![face.vertices[0], face.vertices[2], face.vertices[3]],
        ..face.clone()
    };
    let radius = grounded_definition().spheres().primary().radius;
    for fraction in [0.0, 0.25, 0.5, 0.75, 1.0] {
        let center = face.vertices[0]
            + (face.vertices[2] - face.vertices[0]) * fraction
            + Vector3::new(0.0, 0.0, 1.0);
        let a = resting_center(&first, center, radius).unwrap();
        let b = resting_center(&second, center, radius).unwrap();
        assert!((a - b).length() <= CONTACT_EPSILON);
    }
}

#[test]
fn footing_incremental_stair_entry_remains_supported_on_flat_and_sloped_treads() {
    let definition = grounded_definition();
    let radius = definition.spheres().primary().radius;
    // A two-centimetre endpoint probe isolates incremental tread entry from motor policy.
    let forward_distance = 0.02;
    for slope in [0.0, 0.25, 0.5] {
        let face = tread(slope);
        let scene = stair_collision(&face);
        let start = Vector3::new(89.5, 96.0, radius);
        let approach = Vector3::new(1.0, 0.0, 0.0);
        let first_hit =
            hit(&scene, start, start + approach, radius).expect("fixture must encounter the stair");
        let contact = start + approach * first_hit.time_of_impact;
        let lifted = contact + Vector3::new(0.0, 0.0, GROUNDED_CONFIG.step_up_height);
        let advanced = lifted + Vector3::new(forward_distance, 0.0, 0.0);
        assert!(
            hit(&scene, contact, lifted, radius).is_none(),
            "lift blocked: slope={slope}"
        );
        assert!(
            hit(&scene, lifted, advanced, radius).is_none(),
            "forward blocked: slope={slope}"
        );
        let rest = resting_center(&face, advanced, radius).unwrap_or_else(|| {
            panic!(
                "small stair advance cannot reach proposed footprint: slope={slope} radius={radius}"
            )
        });
        assert!(rest.z > contact.z && rest.z <= lifted.z + CONTACT_EPSILON);
        if let Some(obstruction) = hit(&scene, advanced, rest, radius) {
            assert!(
                (rest - advanced).length() * (1.0 - obstruction.time_of_impact) <= CONTACT_EPSILON,
                "descent blocked before support: slope={slope} {obstruction:?}"
            );
        }
        assert!((resting_center(&face, rest, radius).unwrap() - rest).length() <= CONTACT_EPSILON);
    }
}

#[test]
fn footing_short_drop_becomes_clear_when_upper_footprint_ends() {
    let radius = grounded_definition().spheres().primary().radius;
    let upper = tread(0.0);
    let mut lower = upper.clone();
    for v in &mut lower.vertices {
        v.z = 0.0;
        v.x -= 5.0;
    }
    lower.d = 0.0;
    let scene = stair_collision(&upper);
    let inside = Vector3::new(90.5 - radius + CONTACT_EPSILON * 2.0, 96.0, 0.3 + radius);
    let outside = Vector3::new(90.5 - radius - CONTACT_EPSILON * 2.0, 96.0, 0.3 + radius);
    assert!(resting_center(&upper, inside, radius).is_some());
    assert!(resting_center(&upper, outside, radius).is_none());
    let rest = resting_center(&lower, outside, radius).unwrap();
    assert!(outside.z - rest.z <= GROUNDED_CONFIG.step_down_height);
    if let Some(obstruction) = hit(&scene, outside, rest, radius) {
        assert!((outside - rest).length() * (1.0 - obstruction.time_of_impact) <= CONTACT_EPSILON);
    }
    assert!((resting_center(&lower, rest, radius).unwrap() - rest).length() <= CONTACT_EPSILON);
    // A deeper floor is geometrically a candidate but outside permitted walking descent.
    for v in &mut lower.vertices {
        v.z -= GROUNDED_CONFIG.step_down_height;
    }
    lower.d = GROUNDED_CONFIG.step_down_height;
    let deep = resting_center(&lower, outside, radius).unwrap();
    assert!(outside.z - deep.z > GROUNDED_CONFIG.step_down_height);
}

#[test]
fn footing_edge_guidance_preserves_tangent_motion_on_slopes() {
    let radius = grounded_definition().spheres().primary().radius;
    for slope in [0.0, 0.25, 0.5] {
        let face = tread(slope);
        let center = Vector3::new(90.5 - radius, 96.0, 2.0);
        let inward = inward_normal(&face, center, radius);
        let requested = Vector3::new(-0.01, 0.02, 0.0);
        let tangent = requested - inward * requested.dot(&inward).min(0.0);
        assert!(tangent.x.abs() <= CONTACT_EPSILON);
        assert!((tangent.y - requested.y).abs() <= CONTACT_EPSILON);
        assert!(resting_center(&face, center + tangent, radius).is_some());
        assert!(resting_center(&face, center + requested, radius).is_none());
    }
    // Rounded corner: its tangent departs the disk at second order. It must still be
    // checked, not declared supported merely because the first-order normal was removed.
    let face = tread(0.0);
    let corner = face.vertices[0];
    let center = corner + Vector3::new(-1.0, -1.0, 0.0).normalize() * radius;
    let inward = inward_normal(&face, center, radius);
    let tangent = Vector3::new(-inward.y, inward.x, 0.0) * 0.05;
    assert!(resting_center(&face, center + tangent, radius).is_none());
}

#[test]
fn footing_upper_sphere_blocks_assisted_step_under_low_ceiling() {
    let definition = grounded_definition();
    let spheres = definition.spheres();
    let lower = spheres.primary();
    let upper = spheres.upper_constraint().unwrap();
    let floor_root = lower.radius - lower.center.z;
    let ceiling_z =
        floor_root + upper.center.z + upper.radius + GROUNDED_CONFIG.step_up_height * 0.5;
    let ceiling = CollisionPolygon {
        vertices: vec![
            Vector3::new(85.0, 90.0, ceiling_z),
            Vector3::new(85.0, 100.0, ceiling_z),
            Vector3::new(95.0, 100.0, ceiling_z),
            Vector3::new(95.0, 90.0, ceiling_z),
        ],
        normal: Vector3::new(0.0, 0.0, -1.0),
        d: ceiling_z,
    };
    let scene = collision_with_polygons(HashMap::from([(0, ceiling)]));
    let center = Vector3::new(90.0, 96.0, floor_root + upper.center.z);
    let raised = center + Vector3::new(0.0, 0.0, GROUNDED_CONFIG.step_up_height);
    let obstruction = hit(&scene, center, raised, upper.radius).unwrap();
    assert!(obstruction.time_of_impact > 0.0 && obstruction.time_of_impact < 1.0);
}

#[test]
fn footing_query_bounds_include_support_beyond_sphere_overlap() {
    let face = CollisionPolygon {
        vertices: vec![
            Vector3::new(90.0, 96.0, 0.3),
            Vector3::new(90.1, 96.0, 0.3),
            Vector3::new(90.1, 96.1, 0.3),
            Vector3::new(90.0, 96.1, 0.3),
        ],
        normal: Vector3::new(0.0, 0.0, 1.0),
        d: -0.3,
    };
    let radius = grounded_definition().spheres().primary().radius;
    let center = Vector3::new(89.7, 96.05, 0.3 + radius);
    let expected = support(&face, center, radius).unwrap();
    let scene = collision_with_polygons(HashMap::from([(0, face)]));
    let contacts = scene
        .support_contacts(crate::spatial::SupportRequest {
            anchor: Guid(0xda55_ffff),
            center,
            radius,
            maximum_drop: CONTACT_EPSILON,
            maximum_rise: CONTACT_EPSILON,
            placement: &SpatialMembership::outdoor(),
        })
        .unwrap();
    assert!(
        contacts
            .iter()
            .any(|contact| contact.feature == expected.feature
                && (contact.height_delta - expected.height_delta).abs() <= CONTACT_EPSILON)
    );
}

/// A standing creature above a retained hard cap, with no world floor at cap height.
fn hard_top_fixture(now: Instant) -> (SpatialScene, CollisionScene, SpatialBodyId, SpatialBodyId) {
    let collision = flat_collision_scene();
    let mut scene = SpatialScene::new();
    let rider = SpatialBodyId::LocalPlayer(Guid(1));
    let platform = SpatialBodyId::Entity(Guid(2));
    let definition = grounded_definition();
    let primary = definition.spheres().primary();
    for (id, z) in [
        (rider, 1.0 + primary.radius - primary.center.z),
        (platform, 0.0),
    ] {
        scene.register_body(SpatialBody::new(id, pose(Vector3::new(90.0, 96.0, z)), now));
        let mut configuration = dynamic_definition_with_geometry(
            definition,
            false,
            fallback_target(Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                low_point: Vector3::zero(),
                radius: 1.0,
                height: 1.0,
            }))),
            false,
        );
        if id == platform {
            configuration = dynamic_configuration_with_demand(
                configuration.definition().clone(),
                LocalPhysicalDemand {
                    target: LocalTargetDemand::Retained,
                    integration: LocalIntegrationDemand::Excluded,
                },
            );
        }
        scene
            .set_dynamic_physical_body(id, Some(configuration), PhysicalCollisionFilter::ALL, None)
            .unwrap();
    }
    tick_collection(&mut scene, &collision, MOBILE_CONTACT_TICK_SECONDS, now);
    (scene, collision, rider, platform)
}

#[test]
fn hard_entity_top_support_is_stable_and_revalidated_after_removal_or_movement() {
    let now = Instant::now();
    let (scene, collision, rider, platform) = hard_top_fixture(now);
    let standing = scene.body(rider).unwrap();
    let support = standing
        .physical
        .as_ref()
        .unwrap()
        .response
        .ground()
        .walkable_support()
        .unwrap();
    assert_eq!(
        support.source,
        crate::spatial::SupportSource::Entity(platform)
    );
    let initial = standing.pose;
    let mut resting = scene.clone();
    for tick in 1..=30 {
        tick_collection(
            &mut resting,
            &collision,
            MOBILE_CONTACT_TICK_SECONDS,
            now + Duration::from_millis(tick * 10),
        );
        assert_eq!(resting.body(rider).unwrap().pose, initial);
    }
    for moved in [false, true] {
        let mut changed = resting.clone();
        if moved {
            let mut destination = changed.body(platform).unwrap().pose;
            destination.coords.x += 10.0;
            changed
                .relocate_dynamic_body(platform, destination, now)
                .unwrap();
        } else {
            changed.remove_body(platform).unwrap();
        }
        tick_collection(
            &mut changed,
            &collision,
            MOBILE_CONTACT_TICK_SECONDS,
            now + Duration::from_secs(1),
        );
        let falling = changed.body(rider).unwrap();
        assert_eq!(falling.contact, ContactState::Airborne);
        assert!(falling.pose.coords.z < initial.coords.z);
        assert_eq!(falling.pose.coords.x, initial.coords.x);
        assert!(falling.retained.velocity.z < 0.0);
    }
}

#[test]
fn hard_entity_support_is_lost_when_it_becomes_mobile_or_nonblocking() {
    let now = Instant::now();
    let (scene, collision, rider, platform) = hard_top_fixture(now);
    for mobile in [false, true] {
        let mut changed = scene.clone();
        let physical = changed.body(platform).unwrap().physical.as_ref().unwrap();
        let dynamic = physical.dynamic.as_ref().unwrap();
        let mut definition = DynamicPhysicalBodyDefinition {
            movement: physical.definition,
            response_policy: physical.response_policy,
            entity_collision: dynamic.collision.clone(),
        };
        let mut demand = dynamic.demand;
        if mobile {
            demand.integration = LocalIntegrationDemand::Eligible;
        } else {
            definition.entity_collision.dynamic_collision.target =
                EntityCollisionParticipation::Ethereal;
        }
        changed
            .set_dynamic_physical_body(
                platform,
                Some(dynamic_configuration_with_demand(definition, demand)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        tick_collection(
            &mut changed,
            &collision,
            MOBILE_CONTACT_TICK_SECONDS,
            now + Duration::from_secs(1),
        );
        let falling = changed.body(rider).unwrap();
        assert_eq!(falling.contact, ContactState::Airborne);
        if mobile {
            // A mobile peer is not support, but overlap contact may brake the rider's fall.
            assert!(falling.retained.velocity.z <= 0.0);
        } else {
            assert!(falling.retained.velocity.z < 0.0);
        }
    }
}

#[test]
fn falling_body_lands_on_hard_entity_and_reports_that_entity() {
    let now = Instant::now();
    let (mut scene, collision, rider, platform) = hard_top_fixture(now);
    let resting = scene.body(rider).unwrap().pose;
    let mut elevated = resting;
    elevated.coords.z += 1.0;
    scene.relocate_dynamic_body(rider, elevated, now).unwrap();
    let mut reported_platform = false;
    for tick in 1..=120 {
        let reports = tick_collection(
            &mut scene,
            &collision,
            MOBILE_CONTACT_TICK_SECONDS,
            now + Duration::from_millis(tick * 10),
        );
        reported_platform |= reports.iter().any(|report| {
            report.contact.recipient == rider
                && matches!(report.contact.source,
                crate::spatial::CollisionReportSource::DynamicBody { peer, .. } if peer == platform)
        });
        if scene.body(rider).unwrap().contact == ContactState::Grounded {
            break;
        }
    }
    let landed = scene.body(rider).unwrap();
    assert_eq!(landed.contact, ContactState::Grounded);
    assert!((landed.pose.coords.z - resting.coords.z).abs() <= CONTACT_EPSILON);
    assert_eq!(
        landed
            .physical
            .as_ref()
            .unwrap()
            .response
            .ground()
            .walkable_support()
            .unwrap()
            .source,
        crate::spatial::SupportSource::Entity(platform)
    );
    assert!(reported_platform);
}

#[test]
fn hard_top_requires_a_shared_reached_collision_domain() {
    let now = Instant::now();
    let (scene, collision, rider, platform) = hard_top_fixture(now);
    for shared in [true, false] {
        // Exercise the kernel's prepared-membership contract directly: identical placed
        // geometry belongs to either the rider's outdoor domain or a disconnected EnvCell.
        let mut target = scene.body(platform).unwrap().clone();
        if !shared {
            target
                .physical
                .as_mut()
                .unwrap()
                .dynamic
                .as_mut()
                .unwrap()
                .placement = SpatialMembership::interior(Guid(0xda55_0101));
        }
        let updates = advance_body_contacts(
            &collision,
            &[scene.body(rider).unwrap().clone(), target],
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |_, _| ContactStepActuation::ballistic(Vector3::zero()),
        )
        .unwrap();
        let update = updates
            .iter()
            .find(|update| update.body_id == rider)
            .unwrap();
        if shared {
            assert_eq!(
                update.ground.walkable_support().unwrap().source,
                crate::spatial::SupportSource::Entity(platform)
            );
        } else {
            assert_eq!(update.ground, GroundState::Airborne);
        }
    }
}

#[test]
fn crowded_slope_edge_commits_velocity_consistent_with_support() {
    let now = Instant::now();
    let definition = grounded_definition();
    let sphere = definition.spheres().primary();
    let player = SpatialBodyId::LocalPlayer(Guid(1));
    let mob = SpatialBodyId::Entity(Guid(2));
    for slope in [0.25, 0.5] {
        let face = tread(slope);
        let collision = stair_collision(&face);
        for edge_offset in [0.0, sphere.radius * 0.5, sphere.radius * 0.99] {
            let center = resting_center(
                &face,
                Vector3::new(92.0, 94.0 - edge_offset, 2.0),
                sphere.radius,
            )
            .unwrap();
            let mut scene = SpatialScene::new();
            for (id, root, movement, velocity) in [
                (player, center - sphere.center, definition, Vector3::zero()),
                (
                    mob,
                    center + Vector3::new(-sphere.radius, sphere.radius, -sphere.radius * 0.25),
                    free_definition(Vector3::zero(), sphere.radius),
                    Vector3::new(2.0, -2.0, 0.0),
                ),
            ] {
                let mut body = SpatialBody::new(id, pose(root), now);
                body.retained.velocity = velocity;
                scene.register_body(body);
                scene
                    .set_dynamic_physical_body(
                        id,
                        Some(dynamic_definition(movement, false)),
                        PhysicalCollisionFilter::ALL,
                        None,
                    )
                    .unwrap();
            }
            for _ in 0..8 {
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
                let support = update
                    .ground
                    .walkable_support()
                    .expect("protected slope footing");
                assert!(
                    update.velocity.dot(&support.normal).abs() <= CONTACT_EPSILON,
                    "supported crowd body retained normal velocity: {:?}, slope={slope}, edge={edge_offset}",
                    update.velocity
                );
                publish_contact_updates(&mut scene, updates);
            }
        }
    }
}

#[test]
fn repeated_slope_travel_restores_nominal_support_without_stalling() {
    for slope in [0.0, 0.01, 0.2, 0.6] {
        for speed in [-12.0, -8.0, -0.3, 0.3, 8.0, 12.0] {
            let now = Instant::now();
            let mut face = tread(slope);
            for vertex in &mut face.vertices {
                vertex.x = if vertex.x < 93.0 { 20.0 } else { 170.0 };
                vertex.z = 50.3 + (vertex.x - 90.5) * slope;
            }
            face.d = -face.normal.dot(&face.vertices[0]);
            let collision = collision_with_polygons(HashMap::from([(0, face.clone())]));
            let definition = grounded_definition();
            let sphere = definition.spheres().primary();
            let center =
                resting_center(&face, Vector3::new(96.0, 96.0, 52.0), sphere.radius).unwrap();
            let id = SpatialBodyId::LocalPlayer(Guid(1));
            let mut scene = SpatialScene::new();
            scene.register_body(SpatialBody::new(id, pose(center - sphere.center), now));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(definition, false)),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            let input = GroundedBodyActuation::drive(Vector3::new(speed, 0.0, 0.0)).unwrap();
            for step in 0..120 {
                let body = scene.body(id).unwrap().clone();
                let updates = advance_body_contacts(
                    &collision,
                    &[body],
                    Guid(0xda55_ffff),
                    MOBILE_CONTACT_TICK_SECONDS,
                    |body, ground| grounded_step_input(body, ground, &input),
                )
                .unwrap();
                let update = &updates[0];
                assert!(
                    update.ground.walkable_support().is_some(),
                    "lost support: slope={slope} speed={speed} tick={step}"
                );
                if step > 0 {
                    assert!(
                        update.displacement.x * speed > 0.0,
                        "slope stalled: slope={slope} speed={speed} tick={step}"
                    );
                }
                publish_contact_updates(&mut scene, updates);
                let center = scene.body(id).unwrap().pose.coords + sphere.center;
                let resting = resting_center(&face, center, sphere.radius).unwrap();
                assert!(
                    (resting.z - center.z).abs() <= CONTACT_EPSILON,
                    "support error: slope={slope} speed={speed} tick={step} center={center:?}: {:?}",
                    resting - center
                );
            }
        }
    }
}

/// Continuous terrain can change normal at a polygon seam without becoming a ledge.
#[test]
fn walking_crosses_joined_slopes_without_stalling_or_losing_support() {
    for (incoming_slope, outgoing_slope) in [
        (0.0, 0.0),
        (0.4, 0.1),
        (0.1, 0.4),
        (0.4, 0.0),
        (0.0, 0.4),
        (-0.4, -0.1),
        (-0.1, -0.4),
        (0.01, 0.0),
        (0.0, 0.01),
        (-0.01, 0.0),
        (0.0, -0.01),
    ] {
        for angle in [0.0_f32, std::f32::consts::FRAC_PI_4] {
            let (sin, cos) = angle.sin_cos();
            let direction = Vector3::new(cos, sin, 0.0);
            let rotate =
                |v: Vector3| Vector3::new(v.x * cos - v.y * sin, v.x * sin + v.y * cos, v.z);
            let seam = Vector3::new(96.0, 96.0, 0.0);
            let make_face = |low: f32, high: f32, slope: f32| {
                let mut face = tread(slope);
                for vertex in &mut face.vertices {
                    vertex.x = if vertex.x < 93.0 { low } else { high };
                    vertex.z = 50.0 + (vertex.x - 96.0) * slope;
                    *vertex = seam + rotate(*vertex - seam);
                }
                face.normal = rotate(face.normal);
                face.d = -face.normal.dot(&face.vertices[0]);
                face
            };
            let incoming = make_face(20.0, 96.0, incoming_slope);
            let outgoing = make_face(96.0, 170.0, outgoing_slope);
            let collision =
                collision_with_polygons(HashMap::from([(0, incoming.clone()), (1, outgoing)]));
            let definition = grounded_definition();
            let sphere = definition.spheres().primary();
            let center = resting_center(
                &incoming,
                seam + rotate(Vector3::new(-2.0, 0.0, 50.0)),
                sphere.radius,
            )
            .unwrap();
            for speed in [0.3, 3.0, 8.0, 12.0] {
                let id = SpatialBodyId::LocalPlayer(Guid(1));
                let mut scene = SpatialScene::new();
                scene.register_body(SpatialBody::new(
                    id,
                    pose(center - sphere.center),
                    Instant::now(),
                ));
                scene
                    .set_dynamic_physical_body(
                        id,
                        Some(dynamic_definition(definition, false)),
                        PhysicalCollisionFilter::ALL,
                        None,
                    )
                    .unwrap();
                let input = GroundedBodyActuation::drive(direction * speed).unwrap();
                for tick in 0..(8.0 / (speed * MOBILE_CONTACT_TICK_SECONDS)).ceil() as usize {
                    let body = scene.body(id).unwrap().clone();
                    let updates = advance_body_contacts(
                        &collision,
                        &[body],
                        Guid(0xda55_ffff),
                        MOBILE_CONTACT_TICK_SECONDS,
                        |body, ground| grounded_step_input(body, ground, &input),
                    )
                    .unwrap();
                    let update = &updates[0];
                    assert!(
                        update.ground.walkable_support().is_some(),
                        "lost support at seam {incoming_slope}->{outgoing_slope} speed={speed} angle={angle} tick={tick}"
                    );
                    assert!(
                        update.displacement.dot(&direction) > 0.0,
                        "stalled at seam {incoming_slope}->{outgoing_slope} speed={speed} angle={angle} tick={tick}"
                    );
                    publish_contact_updates(&mut scene, updates);
                }
                assert!(
                    (scene.body(id).unwrap().pose.coords - seam).dot(&direction)
                        > sphere.radius * 2.0
                );
            }
        }
    }
}

/// Authority terrain poses rest the vertical bottom point on the slope. Our full-sphere
/// geometry must acquire its higher resting pose before selecting an airborne motor.
#[test]
fn retail_terrain_height_recovers_support_before_actuation() {
    let now = Instant::now();
    let mut face = tread(0.4);
    // Sphere dimensions and terrain normal from the captured Old Bones recurrence.
    face.normal = Vector3::new(0.3123475, -0.15617375, 0.93704253);
    for vertex in &mut face.vertices {
        vertex.x = if vertex.x < 93.0 { 20.0 } else { 170.0 };
        vertex.z = 50.3
            - (face.normal.x * (vertex.x - 90.5) + face.normal.y * (vertex.y - 96.0))
                / face.normal.z;
    }
    face.d = -face.normal.dot(&face.vertices[0]);
    let collision = collision_with_polygons(HashMap::from([(0, face.clone())]));
    let definition = PhysicalBodyDefinition::grounded(
        PhysicalSphereSet::new(
            Sphere {
                center: Vector3::new(0.0, 0.0, 0.410875),
                radius: 0.41419998,
            },
            Some(Sphere {
                center: Vector3::new(0.0, 0.0, 1.0355),
                radius: 0.41419998,
            }),
        )
        .unwrap(),
        GROUNDED_CONFIG,
    )
    .unwrap();
    let sphere = definition.spheres().primary();
    let mut center = Vector3::new(96.0, 96.0, 0.0);
    center.z = -(face.normal.dot(&center) + face.d) / face.normal.z + sphere.radius;
    let expected = resting_center(&face, center, sphere.radius).unwrap();
    assert!(expected.z > center.z + CONTACT_EPSILON);
    let id = SpatialBodyId::Entity(Guid(1));
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(id, pose(center - sphere.center), now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let input = GroundedBodyActuation::drive(Vector3::new(0.3, 0.0, 0.0)).unwrap();
    for _ in 0..12 {
        let body = scene.body(id).unwrap().clone();
        let updates = advance_body_contacts(
            &collision,
            &[body],
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |body, ground| {
                assert!(
                    ground.walkable_support().is_some(),
                    "recovery must precede motor selection"
                );
                grounded_step_input(body, ground, &input)
            },
        )
        .unwrap();
        assert!(updates[0].ground.walkable_support().is_some());
        assert!(updates[0].displacement.x > 0.0);
        publish_contact_updates(&mut scene, updates);
        let actual = scene.body(id).unwrap().pose.coords + sphere.center;
        let expected = resting_center(&face, actual, sphere.radius).unwrap();
        assert!((expected.z - actual.z).abs() <= CONTACT_EPSILON);
    }
}

/// Positive world-Z velocity can still approach an uphill surface. Contact admission
/// follows separation from that surface, while a genuine upward departure stays airborne.
#[test]
fn slope_landing_distinguishes_uphill_approach_from_upward_departure() {
    let face = tread(0.4);
    let collision = collision_with_polygons(HashMap::from([(0, face.clone())]));
    let definition = grounded_definition();
    let sphere = definition.spheres().primary();
    let standing = resting_center(&face, Vector3::new(92.0, 96.0, 1.0), sphere.radius).unwrap();
    for (velocity, lands) in [
        (Vector3::new(2.0, 0.0, 0.4), true),
        (Vector3::new(0.0, 0.0, 2.0), false),
    ] {
        let id = SpatialBodyId::Entity(Guid(1));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            pose(standing + Vector3::new(0.0, 0.0, 0.01) - sphere.center),
            Instant::now(),
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let mut body = scene.body(id).unwrap().clone();
        body.retained.velocity = velocity;
        let updates = advance_body_contacts(
            &collision,
            &[body],
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |body, ground| grounded_step_input(body, ground, &GroundedBodyActuation::coast()),
        )
        .unwrap();
        assert_eq!(
            updates[0].ground.walkable_support().is_some(),
            lands,
            "surface approach misclassified: velocity={velocity:?}"
        );
        if !lands {
            assert!(updates[0].displacement.z > 0.0);
            assert!(updates[0].velocity.z > 0.0);
        }
    }
}

/// Repairing the starting pose does not increase the height of a subsequent obstacle.
#[test]
fn recovered_footing_can_mount_a_step_within_its_authored_height() {
    let face = tread(0.0);
    let collision = stair_collision(&face);
    let definition = grounded_definition();
    let sphere = definition.spheres().primary();
    let recovery = GROUNDED_CONFIG.step_up_height * 0.6;
    let id = SpatialBodyId::Entity(Guid(1));
    let mut scene = SpatialScene::new();
    let start = Vector3::new(90.0, 96.0, sphere.radius - sphere.center.z - recovery);
    scene.register_body(SpatialBody::new(id, pose(start), Instant::now()));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let mut body = scene.body(id).unwrap().clone();
    body.retained.velocity = Vector3::new(20.0, 0.0, 0.0);
    let input = GroundedBodyActuation::drive(body.retained.velocity).unwrap();
    let updates = advance_body_contacts(
        &collision,
        &[body],
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |body, ground| grounded_step_input(body, ground, &input),
    )
    .unwrap();
    let update = &updates[0];
    assert!(update.ground.walkable_support().is_some());
    assert!(
        update.displacement.x > 0.0,
        "displacement={:?} ground={:?}",
        update.displacement,
        update.ground
    );
    let final_center = start + update.displacement + sphere.center;
    let expected = resting_center(&face, final_center, sphere.radius).unwrap();
    assert!((expected.z - final_center.z).abs() <= CONTACT_EPSILON);
    assert!(
        update.displacement.z > GROUNDED_CONFIG.step_up_height,
        "fixture must exercise recovery plus a separately admissible step"
    );
}

/// Recovery publishes the upper sphere's newly reached cell without inventing
/// timed locomotion or landing impacts for the geometric adjustment.
#[test]
fn upward_recovery_preserves_upper_only_cell_reach_and_motion_provenance() {
    let definition = grounded_definition();
    let lower = definition.spheres().primary();
    let upper = definition.spheres().upper_constraint().unwrap();
    let nominal_root = lower.radius - lower.center.z;
    let recovery = GROUNDED_CONFIG.step_up_height * 0.2;
    let entrance = nominal_root + upper.center.z + upper.radius - recovery * 0.5;
    let exit = entrance + recovery * 0.1;
    let cell = Guid(0xda55_0100);
    let mut asset = flat_collision_asset(0);
    asset.static_geometry = LandblockColliders::new(
        Vec::new(),
        vec![CellVolume {
            cell_selector: 0x0100,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![
                Plane {
                    normal: Vector3::new(0.0, 0.0, 1.0),
                    d: -entrance,
                },
                Plane {
                    normal: Vector3::new(0.0, 0.0, -1.0),
                    d: exit,
                },
            ],
            portals: vec![
                CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(0.0, 0.0, -1.0),
                        d: entrance,
                    },
                    positive_side: true,
                    target: CellCollisionPortalTarget::Outdoor,
                    outdoor_building: None,
                },
                CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(0.0, 0.0, 1.0),
                        d: -exit,
                    },
                    positive_side: true,
                    target: CellCollisionPortalTarget::Outdoor,
                    outdoor_building: None,
                },
            ],
        }],
    );
    let mut collision = flat_collision_scene();
    collision.insert(asset).unwrap();
    let id = SpatialBodyId::Entity(Guid(1));
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(96.0, 96.0, nominal_root - recovery)),
        Instant::now(),
    ));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(definition, false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    let body = scene.body(id).unwrap().clone();
    let updates = advance_body_contacts(
        &collision,
        &[body],
        Guid(0xda55_ffff),
        MOBILE_CONTACT_TICK_SECONDS,
        |body, ground| grounded_step_input(body, ground, &GroundedBodyActuation::coast()),
    )
    .unwrap();
    let update = &updates[0];
    assert!((update.displacement.z - recovery).abs() <= CONTACT_EPSILON);
    assert_eq!(update.accepted_motion.velocity, Vector3::zero());
    assert_eq!(update.velocity, Vector3::zero());
    assert_eq!(update.membership.committed_cell(), None);
    assert!(update.membership.reached_env_cells().contains(&cell));
    let Some(ContactMotionSegment::Adjustment { path, fraction }) = update.motion.first() else {
        panic!("recovery must publish its geometric path");
    };
    assert_eq!(*fraction, 0.0);
    assert!(
        !path
            .primary()
            .final_point()
            .placement()
            .reached_env_cells()
            .contains(&cell)
    );
    assert!(path.membership().reached_env_cells().contains(&cell));
    assert!(
        update
            .motion
            .iter()
            .all(|segment| !matches!(segment, ContactMotionSegment::Impact { .. }))
    );
}

/// A near lower plane must not hide the surface actually overlapping the body.
#[test]
fn support_recovery_selects_higher_surface_and_respects_clearance_and_step_cap() {
    let definition = grounded_definition();
    let lower = definition.spheres().primary();
    let upper = definition.spheres().upper_constraint().unwrap();
    let cap = GROUNDED_CONFIG.step_up_height;
    for (rise, ceiling) in [(cap * 0.1, false), (cap * 0.1, true), (cap * 1.1, false)] {
        let mut floor = tread(0.0);
        for vertex in &mut floor.vertices {
            vertex.z = 50.0;
        }
        floor.d = -50.0;
        let mut higher = floor.clone();
        for vertex in &mut higher.vertices {
            vertex.z += rise;
        }
        higher.d = -(50.0 + rise);
        let initial_root = 50.0 + lower.radius - lower.center.z;
        let mut polygons = HashMap::from([(0, floor), (1, higher)]);
        if ceiling {
            let height = initial_root + upper.center.z + upper.radius + rise * 0.5;
            let mut roof = tread(0.0);
            roof.vertices.reverse();
            for vertex in &mut roof.vertices {
                vertex.z = height;
            }
            roof.normal = Vector3::new(0.0, 0.0, -1.0);
            roof.d = height;
            polygons.insert(2, roof);
        }
        let collision = collision_with_polygons(polygons);
        let id = SpatialBodyId::Entity(Guid(1));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(
            id,
            pose(Vector3::new(92.0, 96.0, initial_root)),
            Instant::now(),
        ));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let body = scene.body(id).unwrap().clone();
        let updates = advance_body_contacts(
            &collision,
            &[body],
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |body, ground| grounded_step_input(body, ground, &GroundedBodyActuation::coast()),
        )
        .unwrap();
        let update = &updates[0];
        if rise <= cap && !ceiling {
            assert!(
                (update.displacement.z - rise).abs() <= CONTACT_EPSILON,
                "higher support was not acquired: rise={rise} update={update:?}"
            );
            assert!(update.ground.walkable_support().is_some());
        } else {
            assert!(
                update.displacement.z <= CONTACT_EPSILON,
                "recovery bypassed clearance or the step cap: rise={rise} ceiling={ceiling}"
            );
        }
    }
}

#[test]
fn support_confirmation_does_not_move_through_a_low_ceiling() {
    let now = Instant::now();
    let definition = grounded_definition();
    let lower = definition.spheres().primary();
    let upper = definition.spheres().upper_constraint().unwrap();
    let nominal_root = lower.radius - lower.center.z;
    let ceiling_z = nominal_root + upper.center.z + upper.radius - CONTACT_EPSILON * 1.5;
    let ceiling = CollisionPolygon {
        vertices: vec![
            Vector3::new(85.0, 90.0, ceiling_z),
            Vector3::new(85.0, 100.0, ceiling_z),
            Vector3::new(95.0, 100.0, ceiling_z),
            Vector3::new(95.0, 90.0, ceiling_z),
        ],
        normal: Vector3::new(0.0, 0.0, -1.0),
        d: ceiling_z,
    };
    let collision = collision_with_polygons(HashMap::from([(0, ceiling)]));
    let id = SpatialBodyId::LocalPlayer(Guid(1));
    let mut scene = SpatialScene::new();
    scene.register_body(SpatialBody::new(
        id,
        pose(Vector3::new(
            90.0,
            96.0,
            nominal_root - CONTACT_EPSILON * 0.75,
        )),
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
    for _ in 0..16 {
        let body = scene.body(id).unwrap().clone();
        let updates = advance_body_contacts(
            &collision,
            &[body],
            Guid(0xda55_ffff),
            MOBILE_CONTACT_TICK_SECONDS,
            |body, ground| grounded_step_input(body, ground, &GroundedBodyActuation::coast()),
        )
        .unwrap();
        let update = &updates[0];
        assert!(update.ground.walkable_support().is_some());
        assert_eq!(
            update.displacement,
            Vector3::zero(),
            "nominal support recovery crossed the ceiling"
        );
        publish_contact_updates(&mut scene, updates);
    }
}

#[test]
fn nominal_slope_drive_matches_unobstructed_supported_travel() {
    for slope in [-0.6, 0.0, 0.6] {
        let now = Instant::now();
        let mut face = tread(slope);
        for vertex in &mut face.vertices {
            vertex.x = if vertex.x < 93.0 { 20.0 } else { 170.0 };
            vertex.z = 50.3 + (vertex.x - 90.5) * slope;
        }
        face.d = -face.normal.dot(&face.vertices[0]);
        let collision = collision_with_polygons(HashMap::from([(0, face.clone())]));
        let definition = grounded_definition();
        let sphere = definition.spheres().primary();
        let center = resting_center(&face, Vector3::new(96.0, 96.0, 52.0), sphere.radius).unwrap();
        let id = SpatialBodyId::Entity(Guid(1));
        let mut scene = SpatialScene::new();
        scene.register_body(SpatialBody::new(id, pose(center - sphere.center), now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(dynamic_definition(definition, false)),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .unwrap();
        let requested = Vector3::new(8.0, 0.0, 0.0);
        let supported = requested - face.normal * requested.dot(&face.normal);
        scene.apply_authoritative_body_vectors(
            id,
            AuthoritativeBodyVectors {
                velocity: supported,
                ..AuthoritativeBodyVectors::default()
            },
            now,
        );
        for tick in 1..=120 {
            scene
                .advance_dynamic_entity_collection(
                    &collision,
                    MOBILE_CONTACT_TICK_SECONDS,
                    now + Duration::from_secs_f32(tick as f32 * MOBILE_CONTACT_TICK_SECONDS),
                    |_| {
                        Ok(PhysicalBodyInput::referenced(
                            PhysicalBodyActuation::grounded_drive(requested)?,
                            PhysicalReferenceInput::body(None),
                            true,
                        ))
                    },
                )
                .unwrap();
            let body = scene.body(id).unwrap();
            assert!(
                body.physical
                    .as_ref()
                    .unwrap()
                    .response
                    .ground()
                    .walkable_support()
                    .is_some()
            );
            assert!(
                (body.nominal.velocity - body.retained.velocity).length() < 0.001,
                "reference manufactured steering on an unobstructed slope {slope} at tick {tick}: nominal {:?}, actual {:?}",
                body.nominal.velocity,
                body.retained.velocity
            );
            assert!(
                !body.has_pose_reconciliation_work(),
                "unobstructed slope travel accumulated reference error"
            );
        }
    }
}
