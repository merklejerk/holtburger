//! Mobile solver rejection preserves committed state and permits subsequent fresh input.

use super::*;
use crate::spatial::bsp_query::CONTACT_EPSILON;
use holtburger_common::position::METERS_PER_LANDBLOCK;

#[test]
fn mobile_fault_preserves_fixed_work_and_does_not_replay_input() {
    let collision = flat_collision_scene();
    let now = Instant::now();
    let moving = SpatialBodyId::Entity(Guid(1));
    let faulty = SpatialBodyId::Entity(Guid(2));
    let fixed = SpatialBodyId::Entity(Guid(3));
    let definition = free_definition(Vector3::zero(), 0.5);
    let velocity = Vector3::new(1.0, 0.0, 0.0);
    let fixed_translation = velocity * MOBILE_CONTACT_TICK_SECONDS;
    for invalid in [
        // Mismatched input fails after an earlier body's velocity was privately integrated.
        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
        // Raw malformed input must never leak non-finite state into committed bodies.
        PhysicalBodyActuation::FreeFlight {
            retained_velocity: Vector3::new(f32::NAN, 0.0, 0.0),
            kinematic_velocity: Vector3::zero(),
        },
    ] {
        let mut scene = SpatialScene::new();
        for (id, x) in [(moving, 90.0), (faulty, 96.0), (fixed, 102.0)] {
            scene.register_body(SpatialBody::new(id, pose(Vector3::new(x, 96.0, 10.0)), now));
            scene
                .set_dynamic_physical_body(
                    id,
                    Some(dynamic_definition(
                        if id == fixed {
                            PhysicalBodyDefinition::fixed_position(definition.spheres()).unwrap()
                        } else {
                            definition
                        },
                        false,
                    )),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
            scene
                .refresh_dynamic_body_placement(id, &collision)
                .unwrap();
        }
        let before = [moving, faulty].map(|id| scene.body(id).unwrap().clone());
        let fixed_start = scene.body(fixed).unwrap().pose.coords;
        for failed_tick in 1..=2 {
            let mut samples = BTreeMap::new();
            let result = scene
                .advance_dynamic_entity_collection(
                    &collision,
                    MOBILE_CONTACT_TICK_SECONDS,
                    now,
                    |body| {
                        *samples.entry(body.id).or_insert(0) += 1;
                        Ok(PhysicalBodyInput::autonomous(if body.id == fixed {
                            PhysicalBodyActuation::FixedPosition {
                                translation: fixed_translation,
                                rotation: body.pose.rotation,
                            }
                        } else if body.id == faulty {
                            invalid.clone()
                        } else {
                            PhysicalBodyActuation::free_flight(velocity)?
                        }))
                    },
                )
                .unwrap();
            assert_eq!(
                samples,
                BTreeMap::from([(moving, 1), (faulty, 1), (fixed, 1)])
            );
            assert_eq!(result.outcomes.len(), 1);
            assert_eq!(result.outcomes[0].body_id(), fixed);
            for body in &before {
                assert_eq!(scene.body(body.id).unwrap(), body);
            }
            let expected = fixed_start + fixed_translation * failed_tick as f32;
            assert!((scene.body(fixed).unwrap().pose.coords - expected).length() < CONTACT_EPSILON);
        }

        let resumed = scene
            .advance_dynamic_entity_collection(
                &collision,
                MOBILE_CONTACT_TICK_SECONDS,
                now,
                |body| {
                    Ok(PhysicalBodyInput::autonomous(if body.id == fixed {
                        PhysicalBodyActuation::FixedPosition {
                            translation: Vector3::zero(),
                            rotation: body.pose.rotation,
                        }
                    } else {
                        PhysicalBodyActuation::free_flight(velocity)?
                    }))
                },
            )
            .unwrap();
        assert_eq!(resumed.outcomes.len(), 3);
        for body in before {
            let accepted = scene.body(body.id).unwrap();
            let expected = body.pose.coords + velocity * MOBILE_CONTACT_TICK_SECONDS;
            assert!((accepted.pose.coords - expected).length() < CONTACT_EPSILON);
            assert_eq!(accepted.retained.velocity, velocity);
        }
    }
}

#[test]
fn angular_coverage_hold_keeps_translation_and_resumes_when_owner_arrives() {
    let now = Instant::now();
    let mut collision = CollisionScene::new();
    collision.insert(flat_collision_asset(0)).unwrap();
    let mut scene = SpatialScene::new();
    let id = SpatialBodyId::Entity(Guid(1));
    let radius = 0.1;
    let initial = pose(Vector3::new(
        METERS_PER_LANDBLOCK - radius - CONTACT_EPSILON * 2.0,
        96.0,
        10.0,
    ));
    scene.register_body(SpatialBody::new(id, initial, now));
    scene
        .set_dynamic_physical_body(
            id,
            Some(dynamic_definition(
                free_definition(Vector3::new(0.0, radius * 2.0, 0.0), radius),
                false,
            )),
            PhysicalCollisionFilter::ALL,
            None,
        )
        .unwrap();
    scene.body_mut(id).unwrap().retained.omega = Vector3::new(
        0.0,
        0.0,
        -std::f32::consts::TAU / MOBILE_CONTACT_TICK_SECONDS,
    );
    let velocity = Vector3::new(0.0, 1.0, 0.0);
    let held = scene
        .advance_dynamic_entity_collection(&collision, MOBILE_CONTACT_TICK_SECONDS, now, |_| {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::free_flight(velocity)?,
            ))
        })
        .unwrap();
    let neighbor = Guid(0xdb55_ffff);
    assert_eq!(held.outcomes.len(), 1);
    assert_eq!(
        held.coverage_rejections,
        [DynamicEntityCollectionCoverageRejection {
            body_id: id,
            owner: neighbor,
        }]
    );
    let body = scene.body(id).unwrap();
    let expected = initial.coords + velocity * MOBILE_CONTACT_TICK_SECONDS;
    assert!((body.pose.coords - expected).length() < CONTACT_EPSILON);
    assert_eq!(body.pose.rotation, initial.rotation);
    assert_eq!(body.retained.velocity, Vector3::zero());

    let mut asset = flat_collision_asset(0);
    asset.landblock_id = neighbor.0;
    collision.insert(asset).unwrap();
    let resumed = scene
        .advance_dynamic_entity_collection(&collision, MOBILE_CONTACT_TICK_SECONDS, now, |_| {
            Ok(PhysicalBodyInput::autonomous(
                PhysicalBodyActuation::free_flight(Vector3::zero())?,
            ))
        })
        .unwrap();
    assert!(resumed.coverage_rejections.is_empty());
    assert_eq!(scene.body(id).unwrap().pose.coords, expected);
    assert_ne!(scene.body(id).unwrap().pose.rotation, initial.rotation);
}
