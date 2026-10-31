//! Narrow differential oracle for retail grounded polygon response.
//!
//! This module intentionally transliterates only the retail decisions needed at a stair crest. It
//! must remain independent from production collision helpers so shared mistakes cannot manufacture
//! parity.

use std::collections::HashMap;
use std::sync::Arc;

use holtburger_common::{Guid, Plane, Quaternion, Sphere, Vector3};
use holtburger_content::{
    BspSolid, CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale,
    CollisionBox, CollisionPolygon, CollisionShape, LandblockColliders, LandblockCollisionAsset,
    LandblockPlacement, PlacedCollider, StaticColliderPlacement, TerrainCollisionCell,
    TerrainCollisionSurface, TerrainCollisionTriangle,
};
use holtburger_dat::physics::{BspLeaf, BspNode};

use crate::spatial::collision::CollisionScene;
use crate::spatial::differential_fixtures::{
    grounded_movement_body, movement_ground, movement_tick,
};
use crate::{
    CellTransitRequest, EdgeProtection, GroundState, GroundedBodyActuation, GroundedBodySpheres,
    GroundedConfig, GroundedObstructionRequest, GroundedSphere, PhysicalBodyActuation,
    PhysicalBodyInput, RETAIL_AIRBORNE_STEP_DOWN_HEIGHT, RETAIL_LANDING_NORMAL_Z,
    RETAIL_WALKABLE_NORMAL_Z, SpatialBody, SpatialMembership, SphereSweep, SupportRequest,
};
use holtburger_common::position::WorldPosition;

const LANDBLOCK: u32 = 0xda55_ffff;
const RETAIL_EPSILON: f32 = 0.000_2;
const TEST_EPSILON: f32 = 0.000_01;

#[derive(Debug, Clone, Copy)]
struct RetailPolygon<'a> {
    vertices: &'a [Vector3],
    normal: Vector3,
    d: f32,
}

/// Literal `CPolygon::polygon_hits_sphere_precise` decision (`acclient.c:345135-345254`).
fn retail_polygon_hits_sphere_precise(
    polygon: RetailPolygon<'_>,
    center: Vector3,
    radius: f32,
) -> bool {
    let plane_distance = polygon.normal.dot(&center) + polygon.d;
    let radius = radius - RETAIL_EPSILON;
    if plane_distance.abs() > radius {
        return false;
    }
    if polygon.vertices.is_empty() {
        return true;
    }
    let radial_squared = radius * radius - plane_distance * plane_distance;
    let projected = center - polygon.normal * plane_distance;
    let mut previous = polygon.vertices.len() - 1;
    for index in 0..polygon.vertices.len() {
        let start = polygon.vertices[previous];
        let end = polygon.vertices[index];
        previous = index;
        let edge = end - start;
        let displacement = projected - start;
        let cross = polygon.normal.cross(&edge);
        if displacement.dot(&cross) >= 0.0 {
            continue;
        }

        previous = polygon.vertices.len() - 1;
        for inner in 0..polygon.vertices.len() {
            let inner_start = polygon.vertices[previous];
            let inner_end = polygon.vertices[inner];
            previous = inner;
            let inner_edge = inner_end - inner_start;
            let inner_displacement = projected - inner_start;
            let inner_cross = polygon.normal.cross(&inner_edge);
            let outside = inner_displacement.dot(&inner_cross);
            if outside < 0.0 {
                if inner_cross.length_squared() * radial_squared < outside * outside {
                    return false;
                }
                let along = inner_displacement.dot(&inner_edge);
                if along >= 0.0 && along <= inner_edge.length_squared() {
                    return true;
                }
            }
            if inner_displacement.length_squared() <= radial_squared {
                return true;
            }
        }
        return false;
    }
    true
}

/// Literal `COLLISIONINFO::set_sliding_normal` projection (`acclient.c:300478-300493`).
fn retail_sliding_normal(collision_normal: Vector3) -> Option<Vector3> {
    let horizontal = Vector3::new(collision_normal.x, collision_normal.y, 0.0);
    (horizontal.length() >= RETAIL_EPSILON).then(|| horizontal.normalize())
}

/// Literal non-water correction selected by `OBJECTINFO::validate_walkable`
/// (`acclient.c:302784-302835`).
fn retail_walkable_height_delta(plane: RetailPolygon<'_>, center: Vector3, radius: f32) -> f32 {
    let low_point_distance = plane.normal.dot(&center) + plane.d - radius * plane.normal.z;
    if low_point_distance.abs() <= RETAIL_EPSILON {
        0.0
    } else {
        -low_point_distance / plane.normal.z
    }
}

/// Literal retail floor classification (`PhysicsGlobals::floor_z` initialization and
/// `CPhysicsObj::is_valid_walkable`, `acclient.c:765983-765986`, `:304992-304995`).
fn retail_is_valid_walkable(normal: Vector3) -> bool {
    normal.z >= (3_437.746_770_784_939_f64.cos() as f32)
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct RetailStepSemantic {
    selected_surface: usize,
    adjusted_center: Vector3,
}

/// Semantic projection of retail's decreasing `walk_interp` winner during a vertical step-down
/// transaction (`acclient.c:302813-302835`, `:344458-344510`).
fn retail_step_down_semantic(
    polygons: &[RetailPolygon<'_>],
    center: Vector3,
    radius: f32,
    maximum_drop: f32,
) -> Option<RetailStepSemantic> {
    polygons
        .iter()
        .copied()
        .enumerate()
        .filter_map(|(selected_surface, polygon)| {
            let height_delta = retail_walkable_height_delta(polygon, center, radius);
            (height_delta >= -maximum_drop - RETAIL_EPSILON
                && height_delta <= maximum_drop * 0.1 + RETAIL_EPSILON)
                .then_some((selected_surface, height_delta))
        })
        .max_by(|left, right| left.1.total_cmp(&right.1))
        .map(|(selected_surface, height_delta)| RetailStepSemantic {
            selected_surface,
            adjusted_center: center + Vector3::new(0.0, 0.0, height_delta),
        })
}

#[test]
fn retail_floor_threshold_accepts_shallow_mound_face_but_rejects_steep_face() {
    const SHALLOW_NORMAL_Z: f32 = 0.682_300;
    const STEEP_NORMAL_Z: f32 = 0.613_462;

    let retail_threshold = 3_437.746_770_784_939_f64.cos() as f32;
    assert_eq!(RETAIL_WALKABLE_NORMAL_Z, retail_threshold);

    for (polygon_id, normal_z, expected_walkable) in
        [(1, SHALLOW_NORMAL_Z, true), (2, STEEP_NORMAL_Z, false)]
    {
        let horizontal = (1.0 - normal_z * normal_z).sqrt();
        let normal = Vector3::new(-horizontal, 0.0, normal_z);
        assert_eq!(retail_is_valid_walkable(normal), expected_walkable);

        let collider = placed_polygon_with_normal(
            polygon_id,
            inclined_quad(10.0, 20.0, horizontal / normal_z),
            normal,
        );
        let scene = scene(vec![collider]);
        let candidate = Vector3::new(
            15.0,
            20.0,
            5.0 * horizontal / normal_z + grounded_pair().support.radius / normal_z
                - grounded_pair().support.center.z,
        );

        let mut config = grounded_config();
        config.walkable_normal_z = RETAIL_WALKABLE_NORMAL_Z;
        let body = settle(&scene, candidate, None, config);
        assert_eq!(
            movement_ground(&body).walkable_support().is_some(),
            expected_walkable,
            "floor classification diverged at normal.z={normal_z}: {body:?}"
        );
    }
}

#[test]
fn authored_crest_plane_not_radial_edge_normal_controls_grounded_response() {
    let vertices = horizontal_quad(10.0, 20.0, 0.0);
    let polygon = RetailPolygon {
        vertices: &vertices,
        normal: Vector3::new(0.0, 0.0, 1.0),
        d: 0.0,
    };
    let center = Vector3::new(9.98, 20.0, 0.48);
    let movement = Vector3::new(0.24, 0.0, 0.0);
    assert!(
        retail_polygon_hits_sphere_precise(polygon, center, 0.5),
        "matrix point must exercise retail's finite polygon edge"
    );

    let scene = scene(vec![placed_polygon(1, vertices.clone())]);
    let contacts = scene
        .grounded_obstructions(GroundedObstructionRequest {
            sweep: SphereSweep {
                anchor: Guid(LANDBLOCK),
                start: center - movement,
                end: center,
                radius: 0.5,
            },
            placement: &crate::SpatialMembership::outdoor(),
        })
        .unwrap();
    let contact = contacts
        .iter()
        .find(|contact| contact.separation_normal.x.abs() > 0.01)
        .expect("crest fixture did not produce a radial polygon-edge contact");
    assert!(
        contact.separation_normal.z > 0.9,
        "fixture did not reach the intended diagonal edge normal: {contact:?}"
    );
    assert_vector_close(
        contact.response_normal,
        polygon.normal,
        "authored response normal",
    );

    assert_eq!(retail_sliding_normal(contact.response_normal), None);
}

#[test]
fn portal_visible_terrain_lip_is_a_walkable_lift_not_a_placement_veto() {
    const CELL: u32 = 0xda55_01e8;
    const TERRAIN_HEIGHT: f32 = 0.03;

    let mut ramp = placed_polygon(1, horizontal_quad(10.0, 20.0, 0.0));
    ramp.source_placement = StaticColliderPlacement::EnvCellShell { cell_id: CELL };
    let terrain = TerrainCollisionTriangle {
        vertices: [
            Vector3::new(10.0, 10.0, TERRAIN_HEIGHT),
            Vector3::new(30.0, 10.0, TERRAIN_HEIGHT),
            Vector3::new(10.0, 30.0, TERRAIN_HEIGHT),
        ],
        normal: Vector3::new(0.0, 0.0, 1.0),
    };
    let remote = TerrainCollisionTriangle {
        vertices: [
            Vector3::new(30.0, 10.0, TERRAIN_HEIGHT),
            Vector3::new(30.0, 30.0, TERRAIN_HEIGHT),
            Vector3::new(10.0, 30.0, TERRAIN_HEIGHT),
        ],
        normal: Vector3::new(0.0, 0.0, 1.0),
    };
    let volume = CellVolume {
        cell_selector: CELL as u16,
        placement: LandblockPlacement {
            origin: Vector3::zero(),
            orientation: Quaternion::identity(),
        },
        planes: Vec::new(),
        portals: vec![CellCollisionPortal {
            // The upper sphere reaches this outside portal while the lower sphere remains on the
            // interior ramp, reproducing the body-wide retail cell-array transition at DA55 01E8.
            plane: Plane {
                normal: Vector3::new(0.0, 0.0, 1.0),
                d: -2.0,
            },
            aperture_vertices: Vec::new(),
            reciprocal_visibility_vertices: None,
            positive_side: true,
            target: CellCollisionPortalTarget::Outdoor,
            outdoor_building: None,
        }],
    };
    let mut scene = scene(Vec::new());
    scene
        .insert(LandblockCollisionAsset {
            landblock_id: LANDBLOCK,
            terrain: TerrainCollisionSurface {
                cells: vec![TerrainCollisionCell {
                    triangles: [terrain.clone(), remote],
                }],
                ..TerrainCollisionSurface::empty()
            },
            static_geometry: LandblockColliders::new(vec![ramp], vec![volume]),
        })
        .unwrap();

    let candidate = Vector3::new(15.0, 15.0, 0.0);

    let spheres = grounded_pair();
    let expected_lift = retail_walkable_height_delta(
        RetailPolygon {
            vertices: &terrain.vertices,
            normal: terrain.normal,
            d: -terrain.normal.dot(&terrain.vertices[0]),
        },
        candidate + spheres.support.center,
        spheres.support.radius,
    );
    let mut config = grounded_config();
    config.step_down_height = 1.5;
    let body = settle(&scene, candidate, Some(Guid(CELL)), config);
    assert!((expected_lift - TERRAIN_HEIGHT).abs() < TEST_EPSILON);
    assert!(
        (body.pose.coords.z - expected_lift).abs() < TEST_EPSILON,
        "portal-visible terrain correction diverged: {body:?}"
    );
    assert!(movement_ground(&body).walkable_support().is_some());
}

#[test]
fn lowered_step_down_rebuild_reaches_horizontal_portal_support() {
    const CELL: u32 = 0xda55_01e8;
    const PORTAL_HEIGHT: f32 = -0.06;
    const RAMP_HEIGHT: f32 = -0.10;

    let ramp_vertices = horizontal_quad(10.0, 20.0, RAMP_HEIGHT);
    let mut ramp = placed_polygon(1, ramp_vertices.clone());
    ramp.source_placement = StaticColliderPlacement::EnvCellShell { cell_id: CELL };
    let portal_plane = Plane {
        normal: Vector3::new(0.0, 0.0, -1.0),
        d: PORTAL_HEIGHT,
    };
    let volume = CellVolume {
        cell_selector: CELL as u16,
        placement: LandblockPlacement {
            origin: Vector3::zero(),
            orientation: Quaternion::identity(),
        },
        planes: vec![portal_plane],
        portals: vec![CellCollisionPortal {
            plane: portal_plane,
            aperture_vertices: Vec::new(),
            reciprocal_visibility_vertices: None,
            positive_side: true,
            target: CellCollisionPortalTarget::Outdoor,
            outdoor_building: Some(holtburger_content::OutdoorBuildingTransit {
                building_index: 0,
                building_origin: Vector3::new(15.0, 20.0, 0.0),
            }),
        }],
    };
    let mut scene = scene(Vec::new());
    scene
        .insert(LandblockCollisionAsset {
            landblock_id: LANDBLOCK,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::new(vec![ramp], vec![volume]),
        })
        .unwrap();

    let candidate = Vector3::new(15.0, 20.0, 0.0);

    let spheres = grounded_pair();
    let mut config = grounded_config();
    config.step_down_height = 1.5;
    config.edge_protection = EdgeProtection::Creature;

    let candidate_center = candidate + spheres.support.center;
    let candidate_placement = scene
        .transit_cell(CellTransitRequest {
            previous_cell: None,
            anchor: Guid(LANDBLOCK),
            center: candidate_center,
            radius: spheres.support.radius,
        })
        .unwrap();
    assert!(
        candidate_placement.reached_env_cells().is_empty(),
        "fixture candidate already reached the destination cell"
    );

    let lowered_placement = scene
        .transit_cell(CellTransitRequest {
            previous_cell: None,
            anchor: Guid(LANDBLOCK),
            center: candidate_center - Vector3::new(0.0, 0.0, config.step_down_height),
            radius: spheres.support.radius,
        })
        .unwrap();
    assert_eq!(
        lowered_placement.reached_env_cells(),
        &[Guid(CELL)],
        "lowering the retail step-down transaction did not expose the destination cell"
    );

    let expected = retail_step_down_semantic(
        &[RetailPolygon {
            vertices: &ramp_vertices,
            normal: Vector3::new(0.0, 0.0, 1.0),
            d: -RAMP_HEIGHT,
        }],
        candidate_center,
        spheres.support.radius,
        config.step_down_height,
    )
    .expect("retail oracle found no portal ramp support");
    let body = settle(&scene, candidate, None, config);
    assert!(
        (body.pose.coords.z - (expected.adjusted_center.z - spheres.support.center.z)).abs()
            < TEST_EPSILON,
        "portal step-down diverged: expected={expected:?} body={body:?}"
    );
    assert!(movement_ground(&body).walkable_support().is_some());
}

#[test]
fn portal_straddling_building_keeps_walkable_polygons_after_center_solid_is_disabled() {
    const CELL: u32 = 0xda55_01e8;

    let mut ramp = placed_polygon(1, horizontal_quad(10.0, 20.0, 0.0));
    ramp.source_placement = StaticColliderPlacement::BuildingShell { source_index: 0 };
    let scene = scene(vec![ramp]);
    let placement =
        SpatialMembership::outdoor().merge_reached(SpatialMembership::interior(Guid(CELL)));
    let supports = scene
        .support_contacts(SupportRequest {
            anchor: Guid(LANDBLOCK),
            center: Vector3::new(15.0, 20.0, 0.5),
            radius: 0.5,
            maximum_drop: 0.2,
            maximum_rise: 0.02,
            placement: &placement,
        })
        .unwrap();
    assert_eq!(supports.len(), 1, "portal reach removed the building ramp");
    assert!(supports[0].height_delta.abs() < TEST_EPSILON);
    assert_vector_close(
        supports[0].normal,
        Vector3::new(0.0, 0.0, 1.0),
        "retained building support",
    );
}

#[test]
fn overlapping_walkable_planes_select_retails_highest_reached_surface_in_any_authored_order() {
    const LOWER_HEIGHT: f32 = 0.02;
    const UPPER_HEIGHT: f32 = 0.08;
    let candidate = Vector3::new(15.0, 20.0, 0.0);

    for order in [[LOWER_HEIGHT, UPPER_HEIGHT], [UPPER_HEIGHT, LOWER_HEIGHT]] {
        let vertices = order.map(|height| horizontal_quad(10.0, 20.0, height));
        let retail_polygons = vertices.each_ref().map(|vertices| RetailPolygon {
            vertices,
            normal: Vector3::new(0.0, 0.0, 1.0),
            d: -vertices[0].z,
        });
        let scene = scene(vec![
            placed_polygon(1, vertices[0].clone()),
            placed_polygon(2, vertices[1].clone()),
        ]);

        let spheres = grounded_pair();
        let mut config = grounded_config();
        config.step_down_height = 1.5;
        let expected = retail_step_down_semantic(
            &retail_polygons,
            candidate + spheres.support.center,
            spheres.support.radius,
            config.step_down_height,
        )
        .expect("retail oracle found no overlapping support");
        let body = settle(&scene, candidate, None, config);
        assert!(
            (body.pose.coords.z - (expected.adjusted_center.z - spheres.support.center.z)).abs()
                < TEST_EPSILON,
            "support selection diverged: order={order:?} expected={expected:?} body={body:?}"
        );
        assert_eq!(order[expected.selected_surface], UPPER_HEIGHT);
        assert!(movement_ground(&body).walkable_support().is_some());
    }
}

#[test]
fn failed_step_restores_the_exact_pose_and_support_before_retreat() {
    let scene = scene(vec![
        placed_polygon(1, horizontal_quad(0.0, 30.0, 0.0)),
        placed_polygon_with_normal(
            2,
            vertical_quad_x(10.0, 0.0, 1.0),
            Vector3::new(-1.0, 0.0, 0.0),
        ),
    ]);
    let start = Vector3::new(9.4, 20.0, 0.0);
    let mut body = settle(&scene, start, None, grounded_config());
    let support = movement_ground(&body).walkable_support().unwrap();
    for _ in 0..15 {
        body = drive(&scene, body, Vector3::new(1.0, 0.0, 0.0));
    }
    assert!(
        body.pose.coords.z.abs() < TEST_EPSILON,
        "failed step leaked lift: {body:?}"
    );
    assert_eq!(movement_ground(&body).walkable_support(), Some(support));
    for _ in 0..15 {
        body = drive(&scene, body, Vector3::new(-1.0, 0.0, 0.0));
    }
    assert!(body.pose.coords.x < start.x - 0.3);
    assert!(body.pose.coords.z.abs() < TEST_EPSILON);
}

#[test]
fn upper_sphere_independently_vetoes_an_otherwise_valid_lower_step() {
    let mut geometry = vec![
        placed_polygon(1, horizontal_quad(0.0, 30.0, 0.0)),
        placed_polygon(2, horizontal_quad(10.0, 14.0, 0.4)),
        placed_polygon_with_normal(
            3,
            vertical_quad_x(10.0, 0.0, 0.4),
            Vector3::new(-1.0, 0.0, 0.0),
        ),
    ];
    let mut ceiling = horizontal_quad(8.0, 15.0, 2.75);
    ceiling.reverse();
    geometry.push(placed_polygon_with_normal(
        4,
        ceiling,
        Vector3::new(0.0, 0.0, -1.0),
    ));
    let scene = scene(geometry);
    let mut final_positions = Vec::new();
    for upper in [None, grounded_pair().upper] {
        let mut spheres = grounded_pair();
        spheres.upper = upper;
        let mut body = grounded_movement_body(
            WorldPosition::from_outdoor_frame(
                Guid(LANDBLOCK),
                Vector3::new(9.4, 20.0, 0.0),
                Quaternion::identity(),
            ),
            spheres,
            grounded_config(),
            Vector3::zero(),
            GroundState::Airborne,
        );
        for _ in 0..30 {
            body = drive(&scene, body, Vector3::zero());
        }
        for _ in 0..30 {
            body = drive(&scene, body, Vector3::new(1.0, 0.0, 0.0));
        }
        final_positions.push(body.pose.coords);
    }
    assert!(
        (final_positions[0].z - 0.4).abs() < TEST_EPSILON,
        "lower-only step failed: {final_positions:?}"
    );
    assert!(
        final_positions[1].x < 10.0 && final_positions[1].z <= TEST_EPSILON,
        "upper sphere did not veto the step: {final_positions:?}"
    );
}

#[test]
fn separate_stair_and_landing_polygons_cross_crest_matrix_without_zero_progress() {
    for height_delta in [-0.02, -0.001, 0.0, 0.001, 0.02] {
        for seam in [-0.05, -0.01, 0.0, 0.01, 0.05] {
            for start_x in [9.51, 9.75, 9.95] {
                for lateral_velocity in [-0.08, 0.0, 0.08] {
                    let scene = scene(vec![
                        placed_polygon(1, horizontal_quad(0.0, 10.0, 0.0)),
                        placed_polygon(2, horizontal_quad(10.0 + seam, 20.0, height_delta)),
                        placed_polygon_with_normal(
                            3,
                            vertical_quad_x(10.0, -0.6, 0.0),
                            Vector3::new(1.0, 0.0, 0.0),
                        ),
                        placed_polygon_with_normal(
                            4,
                            vertical_quad_x(10.0 + seam, -0.6, height_delta),
                            Vector3::new(-1.0, 0.0, 0.0),
                        ),
                    ]);
                    let start = Vector3::new(start_x, 20.0, 0.0);
                    let mut body = settle(&scene, start, None, grounded_config());
                    for _ in 0..15 {
                        body = drive(&scene, body, Vector3::new(1.0, lateral_velocity, 0.0));
                    }
                    assert!(
                        body.pose.coords.x > start_x + 0.35,
                        "crest consumed forward motion: seam={seam} height={height_delta} start={start_x} lateral={lateral_velocity}: body={body:?}"
                    );
                }
            }
        }
    }
}

fn grounded_config() -> GroundedConfig {
    GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        landing_normal_z: RETAIL_LANDING_NORMAL_Z,
        airborne_step_down_height: RETAIL_AIRBORNE_STEP_DOWN_HEIGHT,
        step_up_height: 0.6,
        step_down_height: 0.2,
        edge_protection: EdgeProtection::None,
        minimum_stair_rise: 0.000_5,
    }
}

fn grounded_pair() -> GroundedBodySpheres {
    GroundedBodySpheres {
        support: GroundedSphere {
            center: Vector3::new(0.0, 0.0, 0.5),
            radius: 0.5,
        },
        upper: Some(GroundedSphere {
            center: Vector3::new(0.0, 0.0, 2.0),
            radius: 0.5,
        }),
    }
}

fn horizontal_quad(minimum_x: f32, maximum_x: f32, z: f32) -> Vec<Vector3> {
    vec![
        Vector3::new(minimum_x, 10.0, z),
        Vector3::new(maximum_x, 10.0, z),
        Vector3::new(maximum_x, 30.0, z),
        Vector3::new(minimum_x, 30.0, z),
    ]
}

fn inclined_quad(minimum_x: f32, maximum_x: f32, rise_per_x: f32) -> Vec<Vector3> {
    vec![
        Vector3::new(minimum_x, 10.0, 0.0),
        Vector3::new(maximum_x, 10.0, rise_per_x * (maximum_x - minimum_x)),
        Vector3::new(maximum_x, 30.0, rise_per_x * (maximum_x - minimum_x)),
        Vector3::new(minimum_x, 30.0, 0.0),
    ]
}

fn vertical_quad_x(x: f32, minimum_z: f32, maximum_z: f32) -> Vec<Vector3> {
    vec![
        Vector3::new(x, 10.0, minimum_z),
        Vector3::new(x, 10.0, maximum_z),
        Vector3::new(x, 30.0, maximum_z),
        Vector3::new(x, 30.0, minimum_z),
    ]
}

fn placed_polygon(id: u16, vertices: Vec<Vector3>) -> PlacedCollider {
    placed_polygon_with_normal(id, vertices, Vector3::new(0.0, 0.0, 1.0))
}

fn placed_polygon_with_normal(id: u16, vertices: Vec<Vector3>, normal: Vector3) -> PlacedCollider {
    let d = -normal.dot(&vertices[0]);
    let box_bounds = CollisionBox::from_points(vertices.iter().copied()).unwrap();
    let bounds_center = box_bounds.center();
    let bounds = Sphere {
        center: bounds_center,
        radius: vertices
            .iter()
            .map(|vertex| (*vertex - bounds_center).length())
            .fold(0.0, f32::max),
    };
    PlacedCollider {
        geometry: holtburger_content::PlacedCollisionShape {
            shape: Arc::new(CollisionShape::Bsp(BspSolid {
                bsp: BspNode::Leaf(BspLeaf {
                    index: 0,
                    solid: 0,
                    sphere: Some(bounds),
                    poly_ids: vec![id],
                }),
                bounds,
                box_bounds,
                polygons: HashMap::from([(
                    id,
                    CollisionPolygon {
                        vertices,
                        normal,
                        d,
                    },
                )]),
            })),
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            scale: ColliderScale::uniform(1.0).unwrap(),
            bounds: box_bounds,
        },
        source_placement: StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
    }
}

fn scene(colliders: Vec<PlacedCollider>) -> CollisionScene {
    scene_with_volumes(colliders, Vec::new())
}

fn scene_with_volumes(
    colliders: Vec<PlacedCollider>,
    cell_volumes: Vec<CellVolume>,
) -> CollisionScene {
    let mut scene = CollisionScene::new();
    let anchor_x = ((LANDBLOCK >> 24) & 0xff) as i32;
    let anchor_y = ((LANDBLOCK >> 16) & 0xff) as i32;
    for offset_x in -1..=1 {
        for offset_y in -1..=1 {
            let owner = ((anchor_x + offset_x) as u32) << 24
                | ((anchor_y + offset_y) as u32) << 16
                | 0xffff;
            scene.insert(artifact(owner, Vec::new())).unwrap();
        }
    }
    scene
        .insert(LandblockCollisionAsset {
            landblock_id: LANDBLOCK,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::new(colliders, cell_volumes),
        })
        .unwrap();
    scene
}

fn artifact(landblock_id: u32, colliders: Vec<PlacedCollider>) -> LandblockCollisionAsset {
    LandblockCollisionAsset {
        landblock_id,
        terrain: TerrainCollisionSurface::empty(),
        static_geometry: LandblockColliders::new(colliders, Vec::new()),
    }
}

fn assert_vector_close(actual: Vector3, expected: Vector3, context: &str) {
    assert!(
        (actual - expected).length() <= TEST_EPSILON,
        "{context} differs: actual={actual:?} expected={expected:?}"
    );
}

/// Current scene execution with an explicit controller drive, never a diagnostic solver.
fn drive(scene: &CollisionScene, body: SpatialBody, velocity: Vector3) -> SpatialBody {
    movement_tick(
        scene,
        body,
        PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
            GroundedBodyActuation::drive(velocity).unwrap(),
        )),
    )
}

/// Establishes support through current navigation and placement recovery.
fn settle(
    scene: &CollisionScene,
    start: Vector3,
    cell: Option<Guid>,
    config: GroundedConfig,
) -> SpatialBody {
    let pose = match cell {
        Some(cell) => WorldPosition {
            landblock_id: cell,
            coords: start,
            rotation: Quaternion::identity(),
        },
        None => WorldPosition::from_outdoor_frame(Guid(LANDBLOCK), start, Quaternion::identity()),
    };
    let mut body = grounded_movement_body(
        pose,
        grounded_pair(),
        config,
        Vector3::zero(),
        GroundState::Airborne,
    );
    for _ in 0..30 {
        body = drive(scene, body, Vector3::zero());
    }
    body
}
