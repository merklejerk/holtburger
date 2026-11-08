//! Discontinuous body placement must separate complete bodies or preserve the original state.

use super::*;
use crate::spatial::mobile_contact::BODY_ARRIVAL_MAXIMUM_CORRECTION_RADIUS_RATIO;

fn register_arrival(scene: &mut SpatialScene, id: SpatialBodyId, initial: WorldPosition) {
    scene.register_body(SpatialBody::new(id, initial, Instant::now()));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(grounded_definition(), false)),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
}

fn assert_world_clear(collision: &CollisionScene, body: &SpatialBody) {
    let spheres = body.physical.as_ref().unwrap().definition.spheres();
    for sphere in spheres.iter() {
        let contacts = collision
            .placement_contacts(crate::PlacementRequest {
                anchor: Guid(body.pose.landblock_id.0 | 0xffff),
                center: body.pose.coords + sphere.center,
                radius: sphere.radius,
                placement: &body.spatial_membership(),
            })
            .unwrap();
        assert!(
            contacts
                .iter()
                .all(|contact| contact.depth <= CONTACT_EPSILON),
            "arrival left a sphere overlapping geometry: {contacts:?}"
        );
    }
}

/// A steep flared building base reproduces the map arrival without depending on runtime assets.
#[test]
fn arrival_separates_from_a_steep_building_face_without_replacing_authority() {
    let normal = Vector3::new(0.0, 1.25, 1.0).normalize();
    let vertices = vec![
        Vector3::new(88.0, 94.0, 2.5),
        Vector3::new(92.0, 94.0, 2.5),
        Vector3::new(93.0, 96.0, 0.0),
        Vector3::new(87.0, 96.0, 0.0),
    ];
    let face = CollisionPolygon {
        d: -normal.dot(&vertices[0]),
        normal,
        vertices,
    };
    let collision = collision_with_polygons(HashMap::from([(0, face)]));
    let sphere = grounded_definition().spheres().primary();
    for depth in [0.0, sphere.radius * 0.1] {
        let initial = pose(Vector3::new(
            90.0,
            96.0 - CONTACT_EPSILON,
            sphere.radius - sphere.center.z - depth,
        ));
        let id = SpatialBodyId::LocalPlayer(Guid(1));
        let mut scene = SpatialScene::new();
        register_arrival(&mut scene, id, initial);
        let before = scene.body(id).unwrap().clone();
        scene.settle_dynamic_body_placement(id, &collision).unwrap();
        let body = scene.body(id).unwrap();
        assert_world_clear(&collision, body);
        assert!(body.pose.coords.y > initial.coords.y);
        assert!(
            (body.pose.coords - initial.coords).length()
                <= sphere.radius * BODY_ARRIVAL_MAXIMUM_CORRECTION_RADIUS_RATIO
        );
        assert_eq!(body.authoritative_pose(), Some(initial));
        assert_eq!(body.retained, before.retained);
        let placed = body.pose;
        scene.settle_dynamic_body_placement(id, &collision).unwrap();
        assert_eq!(scene.body(id).unwrap().pose, placed);
    }
}

/// Upper-sphere-only blockers must translate the root and lower sphere together.
#[test]
fn arrival_separates_the_whole_body_from_an_upper_sphere_blocker() {
    let spheres = grounded_definition().spheres();
    let lower = spheres.primary();
    let upper = spheres.upper_constraint().unwrap();
    let floor = lower.radius - lower.center.z;
    let wall_x = 90.0 + upper.radius * 0.5;
    let normal = Vector3::new(-1.0, 0.0, 0.0);
    let vertices = vec![
        Vector3::new(
            wall_x,
            94.0,
            floor + lower.center.z + lower.radius + CONTACT_EPSILON,
        ),
        Vector3::new(wall_x, 94.0, floor + upper.center.z + upper.radius),
        Vector3::new(wall_x, 98.0, floor + upper.center.z + upper.radius),
        Vector3::new(
            wall_x,
            98.0,
            floor + lower.center.z + lower.radius + CONTACT_EPSILON,
        ),
    ];
    let face = CollisionPolygon {
        d: wall_x,
        normal,
        vertices,
    };
    let collision = collision_with_polygons(HashMap::from([(0, face)]));
    let initial = pose(Vector3::new(90.0, 96.0, floor));
    let id = SpatialBodyId::LocalPlayer(Guid(1));
    let mut scene = SpatialScene::new();
    register_arrival(&mut scene, id, initial);
    scene.settle_dynamic_body_placement(id, &collision).unwrap();
    let body = scene.body(id).unwrap();
    assert!(body.pose.coords.x < initial.coords.x);
    assert_world_clear(&collision, body);
}

#[test]
fn arrival_separates_coincident_mobile_bodies_without_moving_the_peer() {
    let collision = flat_collision_scene();
    let lower = grounded_definition().spheres().primary();
    let initial = pose(Vector3::new(90.0, 96.0, lower.radius - lower.center.z));
    let id = SpatialBodyId::LocalPlayer(Guid(1));
    let peer = SpatialBodyId::Entity(Guid(2));
    let mut scene = SpatialScene::new();
    register_arrival(&mut scene, id, initial);
    register_arrival(&mut scene, peer, initial);
    scene.settle_dynamic_body_placement(id, &collision).unwrap();
    assert_eq!(scene.body(peer).unwrap().pose, initial);
    assert!(
        (scene.body(id).unwrap().pose.coords - initial.coords).length()
            >= lower.radius * 2.0 - CONTACT_EPSILON
    );
    assert_world_clear(&collision, scene.body(id).unwrap());
}

#[test]
fn arrival_rejects_corrections_beyond_the_travel_limit_atomically() {
    let lower = grounded_definition().spheres().primary();
    let initial = pose(Vector3::new(90.0, 96.0, lower.radius - lower.center.z));
    let maximum_travel = lower.radius * BODY_ARRIVAL_MAXIMUM_CORRECTION_RADIUS_RATIO;
    let mut asset = flat_collision_asset(0);
    asset.static_geometry = LandblockColliders::new(
        vec![
            PlacedCollider::new(
                Arc::new(CollisionShape::Ball(CollisionBall {
                    center: initial.coords + lower.center + Vector3::new(lower.radius, 0.0, 0.0),
                    radius: maximum_travel + lower.radius,
                })),
                LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                ColliderScale::uniform(1.0).unwrap(),
                StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
            )
            .unwrap(),
        ],
        Vec::new(),
    );
    let mut collision = CollisionScene::new();
    collision.insert(asset).unwrap();
    let id = SpatialBodyId::LocalPlayer(Guid(1));
    let mut scene = SpatialScene::new();
    register_arrival(&mut scene, id, initial);
    let before = scene.body(id).unwrap().runtime_view();
    assert!(scene.settle_dynamic_body_placement(id, &collision).is_err());
    assert_eq!(scene.body(id).unwrap().runtime_view(), before);
}

#[test]
fn arrival_preserves_missing_coverage_as_a_query_error() {
    let mut collision = CollisionScene::new();
    collision.insert(flat_collision_asset(0)).unwrap();
    let lower = grounded_definition().spheres().primary();
    let initial = pose(Vector3::new(
        lower.radius * 0.5,
        96.0,
        lower.radius - lower.center.z,
    ));
    let id = SpatialBodyId::LocalPlayer(Guid(1));
    let mut scene = SpatialScene::new();
    register_arrival(&mut scene, id, initial);
    let error = scene
        .settle_dynamic_body_placement(id, &collision)
        .unwrap_err();
    assert!(matches!(
        error.downcast_ref::<crate::CollisionQueryError>(),
        Some(crate::CollisionQueryError::UnavailableOwner { .. })
    ));
    assert_eq!(scene.body(id).unwrap().pose, initial);
}

/// Opposing upper-body walls have no common separating translation; rejection stays atomic.
#[test]
fn arrival_rejects_a_body_wedged_between_opposing_upper_walls() {
    let spheres = grounded_definition().spheres();
    let lower = spheres.primary();
    let upper = spheres.upper_constraint().unwrap();
    let floor = lower.radius - lower.center.z;
    let mut polygons = HashMap::new();
    for (id, side) in [(0, -1.0), (1, 1.0)] {
        let x = 90.0 + side * upper.radius * 0.5;
        let normal = Vector3::new(-side, 0.0, 0.0);
        let mut vertices = vec![
            Vector3::new(
                x,
                94.0,
                floor + lower.center.z + lower.radius + CONTACT_EPSILON,
            ),
            Vector3::new(x, 94.0, floor + upper.center.z + upper.radius),
            Vector3::new(x, 98.0, floor + upper.center.z + upper.radius),
            Vector3::new(
                x,
                98.0,
                floor + lower.center.z + lower.radius + CONTACT_EPSILON,
            ),
        ];
        if side < 0.0 {
            vertices.reverse();
        }
        polygons.insert(
            id,
            CollisionPolygon {
                d: -normal.dot(&vertices[0]),
                normal,
                vertices,
            },
        );
    }
    let collision = collision_with_polygons(polygons);
    let initial = pose(Vector3::new(90.0, 96.0, floor));
    let id = SpatialBodyId::LocalPlayer(Guid(1));
    let mut scene = SpatialScene::new();
    register_arrival(&mut scene, id, initial);
    let before = scene.body(id).unwrap().runtime_view();
    assert!(scene.settle_dynamic_body_placement(id, &collision).is_err());
    assert_eq!(scene.body(id).unwrap().runtime_view(), before);
}
