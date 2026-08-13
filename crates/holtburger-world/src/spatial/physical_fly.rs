//! Bounded collision-aware free flight for one spherical body.

use anyhow::{Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};

use super::collision::{
    CellTransitRequest, CollisionPlacement, CollisionQuery, CollisionScene, CoverageRequest,
    MissingCoverage, MotionWaypoint, MovementObstructionRequest, PlacementRequest,
    anchor_point_to_outdoor_position, landblock_key, separating_displacement,
};

/// Explicit safety budgets for one physical-fly solve.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalFlyConfig {
    /// Maximum world-meter length of one collision substep.
    pub maximum_substep_distance: f32,
    /// Maximum number of substeps accepted for one requested displacement.
    pub maximum_substeps: usize,
    /// Maximum separation passes per substep.
    pub maximum_contact_passes: usize,
    /// Small outward displacement added after contact separation.
    pub separation_epsilon: f32,
}

/// One registered physical-fly sphere and its atomically committed cell context.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalFlyBody {
    /// Current solved pose.
    pub pose: WorldPosition,
    /// Current interior cell, or `None` while outdoors.
    pub cell: Option<Guid>,
    /// Positive fixed radius in meters.
    pub radius: f32,
}

/// One desired physical-fly displacement.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PhysicalFlyRequest {
    /// Last safely committed body state.
    pub body: PhysicalFlyBody,
    /// World-space displacement requested for this solve.
    pub displacement: Vector3,
}

/// Which finite solver budget refused a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicalFlyBudget {
    /// The displacement requires more anti-tunneling substeps than configured.
    Substeps,
    /// Contact separation did not converge inside one substep's pass budget.
    Contacts,
}

/// Observable result of one physical-fly solve.
#[derive(Debug, Clone, PartialEq)]
pub enum PhysicalFlyOutcome {
    /// The requested displacement completed, possibly after collision separation and sliding.
    Solved {
        /// Atomically committed body state.
        body: PhysicalFlyBody,
        /// Actual world-space displacement from the request's starting pose.
        achieved_displacement: Vector3,
        /// Ordered accepted substep endpoints spanning the normalized solve interval.
        motion: Vec<MotionWaypoint>,
        /// Anti-tunneling substeps evaluated.
        substeps: usize,
        /// Contact passes evaluated across all substeps.
        contact_passes: usize,
    },
    /// Collision coverage was incomplete; the last safe state is held.
    MissingCoverage {
        /// Last safely committed body state.
        body: PhysicalFlyBody,
        /// Exact missing coverage reason.
        missing: MissingCoverage,
    },
    /// A finite safety budget was reached; the last safe state is held.
    BudgetExceeded {
        /// Last safely committed body state.
        body: PhysicalFlyBody,
        /// Budget that stopped the solve.
        budget: PhysicalFlyBudget,
        /// Completed substeps before the stop.
        substeps: usize,
        /// Contact passes evaluated before the stop.
        contact_passes: usize,
    },
}

/// Solves one bounded physical-fly displacement without grounded behavior.
pub fn solve_physical_fly(
    scene: &CollisionScene,
    config: PhysicalFlyConfig,
    request: PhysicalFlyRequest,
) -> Result<PhysicalFlyOutcome> {
    validate(config, request.body.radius, request.displacement)?;
    let anchor = landblock_key(request.body.pose.landblock_id);
    let start = request.body.pose.coords;
    let end = start + request.displacement;
    let full_sweep = CoverageRequest {
        anchor,
        start,
        end,
        radius: request.body.radius,
    };
    if let CollisionQuery::MissingCoverage(missing) = scene.coverage(full_sweep)? {
        return Ok(PhysicalFlyOutcome::MissingCoverage {
            body: request.body,
            missing,
        });
    }

    let distance = request.displacement.length();
    let required_substeps = if distance <= f32::EPSILON {
        1
    } else {
        (distance / config.maximum_substep_distance).ceil() as usize
    };
    if required_substeps > config.maximum_substeps {
        return Ok(PhysicalFlyOutcome::BudgetExceeded {
            body: request.body,
            budget: PhysicalFlyBudget::Substeps,
            substeps: 0,
            contact_passes: 0,
        });
    }

    let substep = request.displacement / required_substeps as f32;
    let mut body = request.body;
    let mut current = start;
    let mut motion = Vec::with_capacity(required_substeps);
    let mut contact_passes = 0usize;
    for completed_substeps in 0..required_substeps {
        let mut candidate = current + substep;
        let mut candidate_placement = transit(scene, anchor, body, candidate)?;
        let mut converged = false;
        let mut contacts = match scene.movement_obstructions(MovementObstructionRequest {
            sweep: CoverageRequest {
                anchor,
                start: current,
                end: candidate,
                radius: body.radius,
            },
            placement: &candidate_placement,
        })? {
            CollisionQuery::Complete(contacts) => contacts,
            CollisionQuery::MissingCoverage(missing) => {
                return Ok(PhysicalFlyOutcome::MissingCoverage { body, missing });
            }
        };

        for _ in 0..config.maximum_contact_passes {
            contact_passes += 1;
            if contacts.is_empty() {
                converged = true;
                break;
            }

            candidate = candidate + separating_displacement(&contacts, config.separation_epsilon);
            candidate_placement = transit(scene, anchor, body, candidate)?;
            contacts = match scene.placement_contacts(PlacementRequest {
                anchor,
                center: candidate,
                radius: body.radius,
                placement: &candidate_placement,
            })? {
                CollisionQuery::Complete(contacts) => contacts,
                CollisionQuery::MissingCoverage(missing) => {
                    return Ok(PhysicalFlyOutcome::MissingCoverage { body, missing });
                }
            };
            if contacts.is_empty() {
                converged = true;
                break;
            }
        }

        if !converged {
            return Ok(PhysicalFlyOutcome::BudgetExceeded {
                body,
                budget: PhysicalFlyBudget::Contacts,
                substeps: completed_substeps,
                contact_passes,
            });
        }

        current = candidate;
        body.cell = candidate_placement.committed_cell();
        body.pose = pose_for_commit(
            anchor,
            current,
            request.body.pose,
            candidate_placement.committed_cell(),
        );
        motion.push(MotionWaypoint {
            center: current,
            end_fraction: (completed_substeps + 1) as f32 / required_substeps as f32,
        });
    }

    Ok(PhysicalFlyOutcome::Solved {
        body,
        achieved_displacement: current - start,
        motion,
        substeps: required_substeps,
        contact_passes,
    })
}

fn transit(
    scene: &CollisionScene,
    anchor: Guid,
    body: PhysicalFlyBody,
    center: Vector3,
) -> Result<CollisionPlacement> {
    match scene.transit_cell(CellTransitRequest {
        previous_cell: body.cell,
        anchor,
        center,
        radius: body.radius,
    })? {
        CollisionQuery::Complete(placement) => Ok(placement),
        CollisionQuery::MissingCoverage(missing) => {
            anyhow::bail!("collision coverage changed during a preflighted solve: {missing:?}")
        }
    }
}

fn pose_for_commit(
    anchor: Guid,
    point: Vector3,
    original: WorldPosition,
    cell: Option<Guid>,
) -> WorldPosition {
    let mut pose = anchor_point_to_outdoor_position(anchor, point, original.rotation);
    if let Some(cell) = cell {
        pose.landblock_id = cell;
    }
    pose
}

fn validate(config: PhysicalFlyConfig, radius: f32, displacement: Vector3) -> Result<()> {
    ensure!(
        radius.is_finite() && radius > 0.0,
        "physical-fly radius must be finite and positive"
    );
    ensure!(
        displacement.x.is_finite() && displacement.y.is_finite() && displacement.z.is_finite(),
        "physical-fly displacement must be finite"
    );
    ensure!(
        config.maximum_substep_distance.is_finite() && config.maximum_substep_distance > 0.0,
        "physical-fly maximum substep distance must be finite and positive"
    );
    ensure!(
        config.maximum_substeps > 0,
        "physical-fly requires at least one substep"
    );
    ensure!(
        config.maximum_contact_passes > 0,
        "physical-fly requires at least one contact pass"
    );
    ensure!(
        config.separation_epsilon.is_finite() && config.separation_epsilon > 0.0,
        "physical-fly separation epsilon must be finite and positive"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use holtburger_common::{Plane, Quaternion, Sphere};
    use holtburger_content::{
        CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale, CollisionBox,
        CollisionPolygon, CollisionShape, LandblockColliders, LandblockCollisionAsset,
        LandblockPlacement, LandblockTerrain, PlacedCollider, StaticColliderPlacement,
        TerrainCellDiagonals, TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode, InternalNode};

    use super::*;

    const LANDBLOCK: u32 = 0xda55_ffff;
    const EAST: u32 = 0xdb55_ffff;

    fn config() -> PhysicalFlyConfig {
        PhysicalFlyConfig {
            maximum_substep_distance: 0.5,
            maximum_substeps: 64,
            maximum_contact_passes: 8,
            separation_epsilon: 0.000_5,
        }
    }

    fn pose(landblock: u32, local: Vector3) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(landblock),
            coords: local,
            rotation: Quaternion::identity(),
        }
        .normalize_outdoor_cell()
    }

    fn body(local: Vector3) -> PhysicalFlyBody {
        PhysicalFlyBody {
            pose: pose(LANDBLOCK, local),
            cell: None,
            radius: 1.0,
        }
    }

    fn flat_terrain(landblock: u32) -> TerrainCollisionSurface {
        TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![0.0; 81],
            terrain_samples: vec![0; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(landblock),
        })
        .unwrap()
    }

    fn artifact(
        landblock: u32,
        colliders: Vec<PlacedCollider>,
        cell_volumes: Vec<CellVolume>,
    ) -> LandblockCollisionAsset {
        LandblockCollisionAsset {
            landblock_id: landblock,
            terrain: flat_terrain(landblock),
            static_geometry: LandblockColliders {
                colliders,
                cell_volumes,
            },
        }
    }

    fn half_space(plane: Plane, positive_is_solid: bool, is_building: bool) -> PlacedCollider {
        let surface_point = plane.normal * (-plane.d / plane.normal.length_squared());
        let outward = if positive_is_solid {
            plane.normal.normalize() * -1.0
        } else {
            plane.normal.normalize()
        };
        let tangent = if outward.z.abs() < 0.9 {
            outward.cross(&Vector3::new(0.0, 0.0, 1.0)).normalize()
        } else {
            outward.cross(&Vector3::new(1.0, 0.0, 0.0)).normalize()
        };
        let bitangent = outward.cross(&tangent);
        let extent = 200.0;
        let polygon = CollisionPolygon {
            vertices: vec![
                surface_point - tangent * extent - bitangent * extent,
                surface_point + tangent * extent - bitangent * extent,
                surface_point + tangent * extent + bitangent * extent,
                surface_point - tangent * extent + bitangent * extent,
            ],
            normal: outward,
            d: -outward.dot(&surface_point),
        };
        let box_bounds = CollisionBox::from_points(polygon.vertices.iter().copied()).unwrap();
        let solid = BspNode::Leaf(BspLeaf {
            index: 1,
            solid: 1,
            sphere: None,
            poly_ids: vec![1],
        });
        let empty = BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: None,
            poly_ids: Vec::new(),
        });
        let (positive, negative) = if positive_is_solid {
            (solid, empty)
        } else {
            (empty, solid)
        };
        let bounds = Sphere {
            center: Vector3::new(96.0, 96.0, 20.0),
            radius: 200.0,
        };
        let shape = Arc::new(CollisionShape {
            bsp: BspNode::Internal(InternalNode {
                tag: *b"BPnn",
                plane,
                pos: Some(Box::new(positive)),
                neg: Some(Box::new(negative)),
                sphere: Some(bounds),
                poly_ids: Vec::new(),
            }),
            bounds,
            box_bounds,
            polygons: HashMap::from([(1, polygon)]),
        });
        PlacedCollider {
            shape,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            scale: ColliderScale::uniform(1.0).unwrap(),
            bounds_center: bounds.center,
            bounds_radius: bounds.radius,
            source_placement: if is_building {
                StaticColliderPlacement::BuildingShell { source_index: 0 }
            } else {
                StaticColliderPlacement::OutdoorExplicit { source_index: 0 }
            },
        }
    }

    fn wall_x(x: f32) -> PlacedCollider {
        half_space(
            Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -x,
            },
            true,
            false,
        )
    }

    fn polygon_wall_x(x: f32) -> PlacedCollider {
        let bounds = Sphere {
            center: Vector3::new(x, 20.0, 10.0),
            radius: 30.0,
        };
        let shape = Arc::new(CollisionShape {
            bsp: BspNode::Leaf(BspLeaf {
                index: 0,
                solid: 0,
                sphere: Some(bounds),
                poly_ids: vec![1],
            }),
            bounds,
            box_bounds: CollisionBox::from_points([
                Vector3::new(x, 0.0, 0.0),
                Vector3::new(x, 40.0, 20.0),
            ])
            .unwrap(),
            polygons: HashMap::from([(
                1,
                holtburger_content::CollisionPolygon {
                    vertices: vec![
                        Vector3::new(x, 0.0, 0.0),
                        Vector3::new(x, 0.0, 20.0),
                        Vector3::new(x, 40.0, 20.0),
                        Vector3::new(x, 40.0, 0.0),
                    ],
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: x,
                },
            )]),
        });
        PlacedCollider {
            shape,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            scale: ColliderScale::uniform(1.0).unwrap(),
            bounds_center: bounds.center,
            bounds_radius: bounds.radius,
            source_placement: StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        }
    }

    fn scene(colliders: Vec<PlacedCollider>) -> CollisionScene {
        let mut scene = CollisionScene::new();
        insert_test_halo(&mut scene, &[LANDBLOCK]);
        scene
            .insert(artifact(LANDBLOCK, colliders, Vec::new()))
            .unwrap();
        scene
    }

    fn test_halo_owners(touched: &[u32]) -> Vec<u32> {
        let mut owners = Vec::new();
        for owner in touched {
            let x = ((owner >> 24) & 0xff) as i32;
            let y = ((owner >> 16) & 0xff) as i32;
            for offset_x in -1..=1 {
                for offset_y in -1..=1 {
                    owners.push(
                        (((x + offset_x) as u32) << 24) | (((y + offset_y) as u32) << 16) | 0xffff,
                    );
                }
            }
        }
        owners.sort_unstable();
        owners.dedup();
        owners
    }

    fn insert_test_halo(scene: &mut CollisionScene, touched: &[u32]) {
        for owner in test_halo_owners(touched) {
            scene
                .insert(artifact(owner, Vec::new(), Vec::new()))
                .unwrap();
        }
    }

    fn solve(
        scene: &CollisionScene,
        body: PhysicalFlyBody,
        displacement: Vector3,
    ) -> PhysicalFlyOutcome {
        solve_physical_fly(scene, config(), PhysicalFlyRequest { body, displacement }).unwrap()
    }

    fn solved(outcome: PhysicalFlyOutcome) -> PhysicalFlyBody {
        match outcome {
            PhysicalFlyOutcome::Solved { body, .. } => body,
            other => panic!("expected solved physical fly, got {other:?}"),
        }
    }

    #[test]
    fn open_motion_preserves_full_three_dimensional_intent() {
        let displacement = Vector3::new(2.0, -3.0, 4.0);
        let PhysicalFlyOutcome::Solved { body, motion, .. } = solve(
            &scene(Vec::new()),
            body(Vector3::new(50.0, 50.0, 10.0)),
            displacement,
        ) else {
            panic!("expected solved physical fly");
        };
        assert!(
            (body.pose.coords - Vector3::new(52.0, 47.0, 14.0)).length() < 1e-4,
            "{body:?}"
        );
        let expected_substeps =
            (displacement.length() / config().maximum_substep_distance).ceil() as usize;
        assert_eq!(motion.len(), expected_substeps);
        assert!(
            motion
                .windows(2)
                .all(|pair| pair[0].end_fraction < pair[1].end_fraction),
            "accepted path fractions were not strictly ordered: {motion:?}"
        );
        let final_waypoint = motion.last().expect("solved motion path was empty");
        assert_eq!(final_waypoint.end_fraction, 1.0);
        assert!((final_waypoint.center - body.pose.coords).length() < 1e-4);
    }

    #[test]
    fn wall_impact_stops_normal_motion_and_preserves_oblique_slide() {
        let scene = scene(vec![wall_x(10.0)]);
        let body = solved(solve(
            &scene,
            body(Vector3::new(7.0, 20.0, 5.0)),
            Vector3::new(6.0, 4.0, 0.0),
        ));
        assert!((body.pose.coords.x - 9.0).abs() < 0.002, "{body:?}");
        assert!((body.pose.coords.y - 24.0).abs() < 0.002, "{body:?}");
    }

    #[test]
    fn retreat_from_a_blocking_contact_is_immediate() {
        let scene = scene(vec![wall_x(10.0)]);
        let body = solved(solve(
            &scene,
            body(Vector3::new(9.0, 20.0, 5.0)),
            Vector3::new(-2.0, 0.0, 0.0),
        ));
        assert!((body.pose.coords.x - 7.0).abs() < 1e-4);
    }

    #[test]
    fn polygon_only_interior_shell_blocks_and_allows_retreat() {
        let scene = scene(vec![polygon_wall_x(10.0)]);
        let blocked = solved(solve(
            &scene,
            body(Vector3::new(7.0, 20.0, 5.0)),
            Vector3::new(6.0, 0.0, 0.0),
        ));
        assert!((blocked.pose.coords.x - 9.0).abs() < 0.002);
        let retreated = solved(solve(&scene, blocked, Vector3::new(-2.0, 0.0, 0.0)));
        assert!((retreated.pose.coords.x - 7.0).abs() < 0.003);
    }

    #[test]
    fn non_uniformly_scaled_bsp_plane_keeps_world_space_sphere_math_exact() {
        let mut wall = wall_x(5.0);
        wall.scale = ColliderScale::from_components(Vector3::new(2.0, 3.0, 4.0)).unwrap();
        wall.bounds_radius *= 4.0;
        wall.bounds_center = wall.point_to_landblock_space(wall.shape.bounds.center);
        let body = solved(solve(
            &scene(vec![wall]),
            body(Vector3::new(7.0, 20.0, 5.0)),
            Vector3::new(6.0, 0.0, 0.0),
        ));
        assert!((body.pose.coords.x - 9.0).abs() < 0.002, "{body:?}");
    }

    #[test]
    fn intersecting_wall_constraints_stop_at_the_corner() {
        let wall_y = half_space(
            Plane {
                normal: Vector3::new(0.0, 1.0, 0.0),
                d: -10.0,
            },
            true,
            false,
        );
        let body = solved(solve(
            &scene(vec![wall_x(10.0), wall_y]),
            body(Vector3::new(7.0, 7.0, 5.0)),
            Vector3::new(6.0, 6.0, 0.0),
        ));
        assert!((body.pose.coords.x - 9.0).abs() < 0.002);
        assert!((body.pose.coords.y - 9.0).abs() < 0.002);
    }

    #[test]
    fn terrain_and_ceiling_constrain_vertical_flight() {
        let ceiling = half_space(
            Plane {
                normal: Vector3::new(0.0, 0.0, 1.0),
                d: -10.0,
            },
            true,
            false,
        );
        let scene = scene(vec![ceiling]);
        let floor = solved(solve(
            &scene,
            body(Vector3::new(50.0, 50.0, 5.0)),
            Vector3::new(0.0, 0.0, -8.0),
        ));
        assert!((floor.pose.coords.z - 1.0).abs() < 0.002);
        let ceiling = solved(solve(
            &scene,
            body(Vector3::new(50.0, 50.0, 5.0)),
            Vector3::new(0.0, 0.0, 8.0),
        ));
        assert!((ceiling.pose.coords.z - 9.0).abs() < 0.002);
    }

    #[test]
    fn incomplete_coverage_holds_the_original_pose() {
        let original = body(Vector3::new(50.0, 50.0, 5.0));
        let mut scene = CollisionScene::new();
        for owner in test_halo_owners(&[LANDBLOCK]) {
            if owner != LANDBLOCK {
                scene
                    .insert(artifact(owner, Vec::new(), Vec::new()))
                    .unwrap();
            }
        }
        let outcome = solve(&scene, original, Vector3::new(1.0, 0.0, 0.0));
        match outcome {
            PhysicalFlyOutcome::MissingCoverage { body, missing } => {
                assert_eq!(body, original);
                assert_eq!(missing.landblocks, vec![Guid(LANDBLOCK)]);
            }
            other => panic!("expected missing coverage, got {other:?}"),
        }
    }

    #[test]
    fn anti_tunneling_budget_is_finite_and_observable() {
        let original = body(Vector3::new(5.0, 20.0, 5.0));
        let mut limited = config();
        limited.maximum_substeps = 2;
        let outcome = solve_physical_fly(
            &scene(vec![wall_x(10.0)]),
            limited,
            PhysicalFlyRequest {
                body: original,
                displacement: Vector3::new(20.0, 0.0, 0.0),
            },
        )
        .unwrap();
        assert_eq!(
            outcome,
            PhysicalFlyOutcome::BudgetExceeded {
                body: original,
                budget: PhysicalFlyBudget::Substeps,
                substeps: 0,
                contact_passes: 0,
            }
        );
    }

    #[test]
    fn impossible_placement_exhausts_the_contact_budget_without_recursion() {
        let left = wall_x(10.0);
        let right = half_space(
            Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -10.5,
            },
            false,
            false,
        );
        let original = body(Vector3::new(10.25, 20.0, 5.0));
        let mut limited = config();
        limited.maximum_contact_passes = 2;
        let outcome = solve_physical_fly(
            &scene(vec![left, right]),
            limited,
            PhysicalFlyRequest {
                body: original,
                displacement: Vector3::new(0.1, 0.0, 0.0),
            },
        )
        .unwrap();
        assert!(matches!(
            outcome,
            PhysicalFlyOutcome::BudgetExceeded {
                budget: PhysicalFlyBudget::Contacts,
                contact_passes: 2,
                ..
            }
        ));
    }

    #[test]
    fn crossing_a_landblock_commits_the_neighbor_pose() {
        let mut scene = CollisionScene::new();
        insert_test_halo(&mut scene, &[LANDBLOCK, EAST]);
        scene
            .insert(artifact(LANDBLOCK, Vec::new(), Vec::new()))
            .unwrap();
        scene
            .insert(artifact(EAST, Vec::new(), Vec::new()))
            .unwrap();
        let body = solved(solve(
            &scene,
            body(Vector3::new(190.0, 50.0, 5.0)),
            Vector3::new(4.0, 0.0, 0.0),
        ));
        assert_eq!(body.pose.landblock_id.0 & 0xffff_0000, EAST & 0xffff_0000);
        assert!((body.pose.coords.x - 2.0).abs() < 1e-4);
    }

    #[test]
    fn candidate_placement_disables_building_center_solid_and_commits_through_an_opening() {
        let mut building = wall_x(10.0);
        building.source_placement = StaticColliderPlacement::BuildingShell { source_index: 0 };
        let opening_vertices = vec![
            Vector3::new(10.0, 0.0, 0.0),
            Vector3::new(10.0, 0.0, 20.0),
            Vector3::new(10.0, 5.0, 20.0),
            Vector3::new(10.0, 5.0, 0.0),
        ];
        building.shape = Arc::new(CollisionShape {
            bsp: building.shape.bsp.clone(),
            bounds: building.shape.bounds,
            box_bounds: CollisionBox::from_points(opening_vertices.iter().copied())
                .expect("synthetic boundary polygon has finite bounds"),
            polygons: HashMap::from([(
                1,
                CollisionPolygon {
                    vertices: opening_vertices,
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 10.0,
                },
            )]),
        });
        let volume = CellVolume {
            cell_selector: 0x0100,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -10.0,
            }],
            portals: vec![CellCollisionPortal {
                plane: Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -10.0,
                },
                positive_side: true,
                target: CellCollisionPortalTarget::Outdoor,
                outdoor_building: None,
            }],
        };
        let mut scene = CollisionScene::new();
        insert_test_halo(&mut scene, &[LANDBLOCK]);
        scene
            .insert(artifact(LANDBLOCK, vec![building], vec![volume]))
            .unwrap();
        let body = solved(solve(
            &scene,
            body(Vector3::new(8.0, 20.0, 5.0)),
            Vector3::new(4.0, 0.0, 0.0),
        ));
        assert_eq!(body.cell, Some(Guid(0xda55_0100)));
        assert_eq!(body.pose.landblock_id, Guid(0xda55_0100));
        assert!((body.pose.coords.x - 12.0).abs() < 1e-4);
    }

    #[test]
    fn prior_cell_transits_to_its_neighbor_then_back_outdoors() {
        let first = CellVolume {
            cell_selector: 0x0100,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![
                Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: 0.0,
                },
                Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 10.0,
                },
            ],
            portals: vec![CellCollisionPortal {
                plane: Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -10.0,
                },
                positive_side: true,
                target: CellCollisionPortalTarget::EnvCell(0x0101),
                outdoor_building: None,
            }],
        };
        let second = CellVolume {
            cell_selector: 0x0101,
            placement: first.placement,
            planes: vec![
                Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -10.0,
                },
                Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 20.0,
                },
            ],
            portals: vec![
                CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(-1.0, 0.0, 0.0),
                        d: 10.0,
                    },
                    positive_side: true,
                    target: CellCollisionPortalTarget::EnvCell(0x0100),
                    outdoor_building: None,
                },
                CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(1.0, 0.0, 0.0),
                        d: -20.0,
                    },
                    positive_side: true,
                    target: CellCollisionPortalTarget::Outdoor,
                    outdoor_building: None,
                },
            ],
        };
        let mut scene = CollisionScene::new();
        insert_test_halo(&mut scene, &[LANDBLOCK]);
        scene
            .insert(artifact(LANDBLOCK, Vec::new(), vec![first, second]))
            .unwrap();
        let mut inside = body(Vector3::new(9.0, 20.0, 5.0));
        inside.cell = Some(Guid(0xda55_0100));
        inside.pose.landblock_id = Guid(0xda55_0100);
        let neighbor = solved(solve(&scene, inside, Vector3::new(4.0, 0.0, 0.0)));
        assert_eq!(neighbor.cell, Some(Guid(0xda55_0101)));
        assert_eq!(neighbor.pose.landblock_id, Guid(0xda55_0101));

        let outdoors = solved(solve(&scene, neighbor, Vector3::new(10.0, 0.0, 0.0)));
        assert_eq!(outdoors.cell, None);
        assert!(!outdoors.pose.is_indoors(), "{outdoors:?}");
    }
}
