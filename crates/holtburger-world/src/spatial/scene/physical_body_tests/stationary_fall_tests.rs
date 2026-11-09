//! Stationary-fall recovery through the production collection and response publication.

use super::*;
use crate::spatial::SupportSource;
use crate::spatial::grounded_types::{STATIONARY_FALL_STOP_FRAMES, STATIONARY_FALL_SUPPORT_FRAMES};

const PLAYER: SpatialBodyId = SpatialBodyId::LocalPlayer(Guid(1));

/// Two contacting faces trap downward motion above the real floor. Alternating impact response
/// cannot advance the body, while a horizontal direction along the corner remains clear.
fn trapped_fall() -> (SpatialScene, CollisionScene) {
    let definition = grounded_definition();
    let root = Vector3::new(96.0, 96.0, 10.0);
    let sphere = definition.spheres().primary();
    let center = root + sphere.center;
    let normal = Vector3::new(0.86, 0.0, 0.51).normalize();
    // Start inside the query's contact band so the fixture tests a stationary transition,
    // rather than the tiny initial travel allowed when approaching exact tangency.
    let contact_distance = sphere.radius - CONTACT_EPSILON * 2.0;
    let tangent = center - normal * contact_distance;
    let vertices = [(-3.0, -3.0), (3.0, -3.0), (3.0, 3.0), (-3.0, 3.0)]
        .map(|(x, y)| tangent + Vector3::new(x, y, -normal.x * x / normal.z));
    let wall_x = center.x + contact_distance;
    let collision = collision_with_polygons(HashMap::from([
        (
            0,
            CollisionPolygon {
                vertices: vertices.to_vec(),
                normal,
                d: -normal.dot(&tangent),
            },
        ),
        (
            1,
            CollisionPolygon {
                vertices: vec![
                    Vector3::new(wall_x, center.y - 3.0, center.z - 3.0),
                    Vector3::new(wall_x, center.y - 3.0, center.z + 3.0),
                    Vector3::new(wall_x, center.y + 3.0, center.z + 3.0),
                    Vector3::new(wall_x, center.y + 3.0, center.z - 3.0),
                ],
                normal: Vector3::new(-1.0, 0.0, 0.0),
                d: wall_x,
            },
        ),
    ]));
    let mut scene = SpatialScene::new();
    let mut body = SpatialBody::new(PLAYER, pose(root), Instant::now());
    body.physical = Some(PhysicalBodyState::new_dynamic(
        dynamic_definition(definition, false),
        PhysicalCollisionFilter::ALL,
        None,
    ));
    scene.register_body(body);
    (scene, collision)
}

fn tick(
    scene: &mut SpatialScene,
    collision: &CollisionScene,
    drive: Vector3,
) -> DynamicEntityCollectionTick {
    scene.wake_dynamic_body(PLAYER);
    scene
        .advance_dynamic_entity_collection(collision, CONTACT_INTERVAL, Instant::now(), |_| {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::grounded_drive(drive)?,
            ))
        })
        .unwrap()
}

fn stage(scene: &SpatialScene) -> u8 {
    let PhysicalBodyResponseState::Grounded {
        stationary_fall_frames,
        ..
    } = scene
        .body(PLAYER)
        .unwrap()
        .physical
        .as_ref()
        .unwrap()
        .response
    else {
        panic!("fixture must retain grounded response")
    };
    stationary_fall_frames
}

fn is_recovered(scene: &SpatialScene) -> bool {
    scene
        .body(PLAYER)
        .unwrap()
        .physical
        .as_ref()
        .unwrap()
        .response
        .ground()
        .walkable_support()
        .is_some_and(|support| matches!(support.source, SupportSource::StationaryFall(_)))
}

#[test]
fn stationary_fall_stops_then_recovers_and_allows_departure() {
    let (mut scene, collision) = trapped_fall();
    let initial = scene.body(PLAYER).unwrap().pose;
    for expected in 1..=STATIONARY_FALL_SUPPORT_FRAMES {
        let result = tick(&mut scene, &collision, Vector3::zero());
        assert!(result.coverage_rejections.is_empty());
        assert_eq!(scene.body(PLAYER).unwrap().pose.coords, initial.coords);
        assert_eq!(stage(&scene), expected);
        if expected >= STATIONARY_FALL_STOP_FRAMES {
            assert_eq!(
                scene.body(PLAYER).unwrap().retained.velocity,
                Vector3::zero()
            );
        }
    }
    assert!(is_recovered(&scene));
    assert_eq!(scene.body(PLAYER).unwrap().contact, ContactState::Grounded);
    tick(&mut scene, &collision, Vector3::zero());
    assert!(is_recovered(&scene));

    tick(&mut scene, &collision, Vector3::new(0.0, 2.0, 0.0));
    assert!(scene.body(PLAYER).unwrap().pose.coords.y > initial.coords.y);
    assert!(!is_recovered(&scene));
    assert_eq!(stage(&scene), 0);
}

#[test]
fn missing_collision_coverage_interrupts_stationary_fall_progression() {
    let (mut scene, collision) = trapped_fall();
    tick(&mut scene, &collision, Vector3::zero());
    assert!(stage(&scene) > 0);
    let result = tick(&mut scene, &CollisionScene::new(), Vector3::zero());
    assert!(!result.coverage_rejections.is_empty());
    assert_eq!(stage(&scene), 0);
    assert!(!is_recovered(&scene));
    tick(&mut scene, &collision, Vector3::zero());
    assert_eq!(stage(&scene), 1);
    assert!(!is_recovered(&scene));
}

#[test]
fn collision_replacement_releases_recovered_support_and_resumes_falling() {
    let (mut scene, mut collision) = trapped_fall();
    for _ in 0..STATIONARY_FALL_SUPPORT_FRAMES {
        tick(&mut scene, &collision, Vector3::zero());
    }
    assert!(is_recovered(&scene));
    let initial = scene.body(PLAYER).unwrap().pose;
    collision.insert(flat_collision_asset(0)).unwrap();
    tick(&mut scene, &collision, Vector3::zero());
    assert!(!is_recovered(&scene));
    assert_eq!(stage(&scene), 0);
    assert_eq!(scene.body(PLAYER).unwrap().contact, ContactState::Airborne);
    assert!(scene.body(PLAYER).unwrap().pose.coords.z < initial.coords.z);
}

#[test]
fn unobstructed_falling_does_not_manufacture_support() {
    let (mut scene, _) = trapped_fall();
    let collision = flat_collision_scene();
    let initial = scene.body(PLAYER).unwrap().pose;
    for _ in 0..=STATIONARY_FALL_SUPPORT_FRAMES {
        tick(&mut scene, &collision, Vector3::zero());
        assert_eq!(stage(&scene), 0);
        assert!(!is_recovered(&scene));
        assert_eq!(scene.body(PLAYER).unwrap().contact, ContactState::Airborne);
    }
    assert!(scene.body(PLAYER).unwrap().pose.coords.z < initial.coords.z);
}

#[test]
fn launch_releases_stationary_fall_support() {
    let (mut scene, collision) = trapped_fall();
    for _ in 0..STATIONARY_FALL_SUPPORT_FRAMES {
        tick(&mut scene, &collision, Vector3::zero());
    }
    assert!(is_recovered(&scene));
    let initial = scene.body(PLAYER).unwrap().pose;
    let result = scene
        .advance_dynamic_entity_collection(&collision, CONTACT_INTERVAL, Instant::now(), |_| {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast()
                        .with_launch(GroundedLaunch::new(Vector3::new(0.0, 0.0, 5.0))?),
                ),
            ))
        })
        .unwrap();
    assert!(result.coverage_rejections.is_empty());
    assert!(!is_recovered(&scene));
    assert_eq!(stage(&scene), 0);
    assert_eq!(scene.body(PLAYER).unwrap().contact, ContactState::Airborne);
    assert!(scene.body(PLAYER).unwrap().pose.coords.z > initial.coords.z);
}

#[test]
fn gravity_free_blocked_motion_does_not_manufacture_support() {
    let (mut scene, collision) = trapped_fall();
    let body = scene.body_mut(PLAYER).unwrap();
    let physical = body.physical.as_mut().unwrap();
    let PhysicalBodyDefinition::Grounded { config, .. } = &mut physical.definition else {
        panic!("fixture requires grounded geometry");
    };
    config.gravity = 0.0;
    body.retained.velocity = Vector3::new(0.0, 0.0, -1.0);
    for _ in 0..=STATIONARY_FALL_SUPPORT_FRAMES {
        tick(&mut scene, &collision, Vector3::zero());
        assert_eq!(stage(&scene), 0);
        assert!(!is_recovered(&scene));
    }
}
