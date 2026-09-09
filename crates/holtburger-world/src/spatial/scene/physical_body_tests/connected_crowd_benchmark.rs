//! Manual asset-free debug workload against the current scene collection boundary.
//! Includes compliant contact and body publication; excludes authoritative samples and runtime
//! scheduling. Re-run with the `physics-profiling` feature and the ignored benchmark test filter.

use super::*;

/// Keeps the same connected workload available while the runtime collection implementation changes.
#[test]
#[ignore = "manual debug connected-crowd measurement"]
fn connected_crowd_benchmark() {
    const BODY_COUNT: usize = 45;
    const TICKS: usize = 60;
    const DT: f32 = 0.03;
    let target_radius = 0.5;
    let contact_distance = grounded_definition().spheres().primary().radius + target_radius;
    println!(
        "scenario,run,mean_ms,p95_ms,max_ms,body_preparations,shape_queries,stationary_body_steps,player_distance,player_forward,remote_distance,max_penetration,max_speed,max_vertical_speed,max_hard_penetration"
    );
    for scenario in ["swarm", "pinned", "tight_corner"] {
        let now = Instant::now();
        let collision = flat_collision_scene();
        let source = SpatialBodyId::LocalPlayer(Guid(0x7700_0000));
        let mut initial = SpatialScene::new();
        let source_position = Vector3::new(80.0, 79.0, 0.005);
        for slot in 0..BODY_COUNT {
            let id = if slot == 0 {
                source
            } else {
                SpatialBodyId::Entity(Guid(0x7700_0000 + slot as u32))
            };
            let coords = if slot == 0 {
                source_position
            } else if scenario == "tight_corner" && slot <= 2 {
                let offset = if slot == 1 {
                    let diagonal = contact_distance * std::f32::consts::FRAC_1_SQRT_2;
                    Vector3::new(diagonal, diagonal, 0.0)
                } else {
                    Vector3::new(0.75, -1.7, 0.0)
                };
                source_position + offset
            } else {
                let cell = if scenario == "tight_corner" {
                    slot - 3
                } else {
                    slot - 1
                };
                Vector3::new(
                    80.0 + (cell % 7) as f32 * 1.02 - 3.06,
                    80.0 + (cell / 7) as f32 * 1.02
                        + if scenario == "tight_corner" { 2.0 } else { 0.0 },
                    0.005,
                )
            };
            initial.register_body(SpatialBody::new(id, pose(coords), now));
            initial
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
            acquire_support(&mut initial, &collision, id, now);
            // Corner neighbors are hard authored targets; the other crowds remain mobile.
            if slot != 0 && scenario == "tight_corner" {
                initial
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
        let drive = if scenario == "tight_corner" {
            Vector3::new(2.0, 0.5, 0.0)
        } else {
            Vector3::new(0.0, 2.0, 0.0)
        };
        // Run zero warms the exact workload; each measured repeat starts from identical state.
        for repeat in 0..=3 {
            let mut scene = initial.clone();
            let mut durations = Vec::new();
            let mut preparations = 0;
            let mut shapes = 0;
            let mut stationary = 0;
            let mut player_distance = 0.0;
            let mut remote_distance = 0.0;
            let mut maximum_penetration = 0.0_f32;
            let mut maximum_speed = 0.0_f32;
            let mut maximum_vertical_speed = 0.0_f32;
            let mut maximum_hard_penetration = 0.0_f32;
            for tick in 0..TICKS {
                // Capture measurement inputs and force admission outside the timed solver work.
                // All bodies are scheduled deliberately; this workload does not measure sleeping.
                let before = scene
                    .body_store
                    .bodies
                    .iter()
                    .map(|(&id, body)| (id, body.pose))
                    .collect::<BTreeMap<_, _>>();
                for &id in before.keys() {
                    scene.wake_dynamic_body(id);
                }
                crate::spatial::physics_work::take_physics_work();
                let start = Instant::now();
                let time = now + Duration::from_secs_f32((tick + 1) as f32 * DT);
                let collection = scene
                    .advance_dynamic_entity_collection(&collision, DT, time, |body| {
                        let requested = if body.id == source {
                            drive
                        } else if scenario == "swarm" {
                            let towards = before[&source].coords - body.pose.coords;
                            Vector3::new(towards.x, towards.y, 0.0).normalize() * 0.6
                        } else {
                            Vector3::zero()
                        };
                        Ok(PhysicalBodyInput::referenced(
                            PhysicalBodyActuation::grounded_drive(requested)?,
                            PhysicalReferenceInput::body(None),
                            true,
                        ))
                    })
                    .unwrap();
                assert!(collection.coverage_rejections.is_empty());
                for outcome in collection.outcomes {
                    let crate::DynamicEntityBodyOutcome::Integrated(update) = outcome else {
                        panic!("crowd benchmark unexpectedly repositioned a body")
                    };
                    let displacement = update.displacement.length();
                    stationary += usize::from(displacement == 0.0);
                    if update.body_id == source {
                        player_distance += displacement;
                    } else {
                        remote_distance += displacement;
                    }
                }
                durations.push(start.elapsed().as_secs_f64() * 1000.0);
                let work = crate::spatial::physics_work::take_physics_work();
                preparations += work.body_preparations;
                shapes += work.shape_queries;
                // Penetration auditing is excluded from solver/publication time.
                let bodies = scene.body_store.bodies.values().collect::<Vec<_>>();
                for (index, left) in bodies.iter().enumerate() {
                    let speed = left.retained.velocity.length();
                    assert!(speed.is_finite(), "non-finite body velocity");
                    maximum_speed = maximum_speed.max(speed);
                    maximum_vertical_speed =
                        maximum_vertical_speed.max(left.retained.velocity.z.abs());
                    if scenario == "tight_corner" && left.id != source {
                        assert_eq!(left.pose, initial.body(left.id).unwrap().pose);
                    }
                    for right in &bodies[index + 1..] {
                        let offset = left.pose.coords - right.pose.coords;
                        let separation = (offset.x * offset.x + offset.y * offset.y).sqrt();
                        let penetration = contact_distance - separation;
                        maximum_penetration = maximum_penetration.max(penetration);
                        // This fixture's fixed targets are upright cylinders overlapping the
                        // player's height; radial separation measures their blocking boundary.
                        if scenario == "tight_corner" && (left.id == source || right.id == source) {
                            maximum_hard_penetration = maximum_hard_penetration.max(penetration);
                        }
                    }
                }
            }
            assert!(
                maximum_vertical_speed <= crate::spatial::bsp_query::CONTACT_EPSILON,
                "horizontal crowd contact created vertical velocity: {maximum_vertical_speed}"
            );
            assert!(
                maximum_hard_penetration <= FLY_CONFIG.separation_epsilon,
                "player penetrated a fixed target: {maximum_hard_penetration}"
            );
            let forward = (scene.body(source).unwrap().pose.coords
                - initial.body(source).unwrap().pose.coords)
                .dot(&drive.normalize());
            durations.sort_by(f64::total_cmp);
            if repeat != 0 {
                println!(
                    "{scenario},{repeat},{:.3},{:.3},{:.3},{preparations},{shapes},{stationary},{player_distance:.6},{forward:.6},{remote_distance:.6},{maximum_penetration:.6},{maximum_speed:.6},{maximum_vertical_speed:.6},{maximum_hard_penetration:.6}",
                    durations.iter().sum::<f64>() / TICKS as f64,
                    durations[(TICKS * 95).div_ceil(100) - 1],
                    durations[TICKS - 1]
                );
            }
        }
    }
}
