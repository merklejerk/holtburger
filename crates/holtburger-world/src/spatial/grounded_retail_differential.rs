//! Narrow differential oracle for retail grounded polygon response.
//!
//! This module intentionally transliterates only the retail decisions needed at a stair crest. It
//! must remain independent from production collision helpers so shared mistakes cannot manufacture
//! parity.

use std::collections::HashMap;
use std::sync::Arc;

use holtburger_common::{Guid, Plane, Quaternion, Sphere, Vector3};
use holtburger_content::{
    CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale, CollisionBox,
    CollisionPolygon, CollisionShape, LandblockColliders, LandblockCollisionAsset,
    LandblockPlacement, PlacedCollider, StaticColliderPlacement, TerrainCollisionCell,
    TerrainCollisionSurface, TerrainCollisionTriangle,
};
use holtburger_dat::physics::{BspLeaf, BspNode};

use super::{
    GroundSupport, GroundedBody, GroundedBodySpheres, GroundedConfig, GroundedObstruction,
    GroundedOutcome, GroundedRequest, GroundedSolveContext, GroundedSphere, RoleContacts,
    SettleResult, SphereRole, horizontal_response_normal, remember_next_sliding_normal,
    settle_candidate, solve_grounded, step_up_candidate,
};
use crate::spatial::collision::CollisionScene;
use crate::{
    CollisionPlacement, CollisionQuery, CoverageRequest, EdgeProtection,
    GroundedObstructionRequest, SupportRequest,
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

/// Literal `CPolygon::polygon_hits_sphere_precise` decision (`acclient.c:345595-345674`).
fn retail_polygon_hits_sphere_precise(
    polygon: RetailPolygon<'_>,
    center: Vector3,
    radius: f32,
) -> bool {
    if polygon.vertices.is_empty() {
        return true;
    }
    let plane_distance = polygon.normal.dot(&center) + polygon.d;
    let radius = radius - RETAIL_EPSILON;
    if plane_distance.abs() > radius {
        return false;
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

/// Relevant no-contact-plane branch of `CTransition::adjust_offset` (`acclient.c:300589-300730`).
fn retail_adjust_offset(offset: Vector3, sliding_normal: Option<Vector3>) -> Vector3 {
    let Some(normal) = sliding_normal else {
        return offset;
    };
    let angle = offset.dot(&normal);
    if angle < 0.0 {
        offset - normal * angle
    } else {
        offset
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RetailCollisionDisposition {
    LowerStep,
    UpperSlide,
    LowerBackFace,
    UpperBackFaceSlide,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct RetailCollisionSemantic {
    disposition: RetailCollisionDisposition,
    response_normal: Vector3,
    next_offset: Vector3,
}

/// Semantic projection of retail's lower/upper polygon routing and next-offset adjustment
/// (`acclient.c:346436-346559`, `:300478-300493`, `:300589-300630`).
fn retail_polygon_collision_semantic(
    role: SphereRole,
    polygon_normal: Vector3,
    separation_normal: Vector3,
    offset: Vector3,
) -> RetailCollisionSemantic {
    let same_side = polygon_normal.dot(&separation_normal) >= 0.0;
    let response_normal = if same_side {
        polygon_normal
    } else {
        polygon_normal * -1.0
    };
    let disposition = match (role, same_side) {
        (SphereRole::Support, true) => RetailCollisionDisposition::LowerStep,
        (SphereRole::Upper, true) => RetailCollisionDisposition::UpperSlide,
        (SphereRole::Support, false) => RetailCollisionDisposition::LowerBackFace,
        (SphereRole::Upper, false) => RetailCollisionDisposition::UpperBackFaceSlide,
    };
    let sliding_normal = retail_sliding_normal(response_normal);
    RetailCollisionSemantic {
        disposition,
        response_normal,
        next_offset: retail_adjust_offset(offset, sliding_normal),
    }
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

/// Semantic projection of `CPolygon::find_crossed_edge`: return the inward normal of the first
/// finite edge crossed by the sphere's plane-projected center (`acclient.c:345503-345573`).
fn retail_crossed_edge_normal(polygon: RetailPolygon<'_>, center: Vector3) -> Option<Vector3> {
    let plane_distance = polygon.normal.dot(&center) + polygon.d;
    let projected = center - polygon.normal * plane_distance;
    (0..polygon.vertices.len()).find_map(|index| {
        let start = polygon.vertices[index];
        let end = polygon.vertices[(index + 1) % polygon.vertices.len()];
        let inward = polygon.normal.cross(&(end - start));
        ((projected - start).dot(&inward) < 0.0).then(|| inward.normalize())
    })
}

#[test]
fn retail_sliding_response_matches_production_across_edge_normal_matrix() {
    let collision_normals = [
        Vector3::new(-1.0, 0.0, 0.0),
        Vector3::new(-0.8, 0.2, 0.56).normalize(),
        Vector3::new(-0.2, -0.8, 0.56).normalize(),
        Vector3::new(0.0, 0.0, 1.0),
        Vector3::new(RETAIL_EPSILON * 0.5, 0.0, 1.0).normalize(),
    ];
    let offsets = [
        Vector3::new(0.24, 0.0, 0.0),
        Vector3::new(0.20, 0.12, 0.0),
        Vector3::new(-0.12, 0.20, 0.0),
    ];

    for collision_normal in collision_normals {
        for offset in offsets {
            let expected_normal = retail_sliding_normal(collision_normal);
            assert_vector_option_close(
                horizontal_response_normal(collision_normal),
                expected_normal,
                "sliding normal",
            );

            let contacts = [RoleContacts {
                role: SphereRole::Upper,
                contacts: vec![GroundedObstruction {
                    separation_normal: collision_normal,
                    response_normal: collision_normal,
                    depth: 0.01,
                }],
            }];
            let mut actual_normal = None;
            remember_next_sliding_normal(&mut actual_normal, &contacts, 0.7, offset);
            let expected_active = expected_normal.filter(|normal| offset.dot(normal) <= 0.0);
            assert_vector_option_close(actual_normal, expected_active, "active normal");

            let actual_offset = super::apply_sliding_normal(offset, actual_normal);
            let expected_offset = retail_adjust_offset(offset, expected_active);
            assert_vector_close(actual_offset, expected_offset, "adjusted offset");
        }
    }
}

#[test]
fn single_polygon_role_and_back_face_routing_match_retail_semantics() {
    let authored = Vector3::new(-1.0, 0.0, 0.0);
    let offset = Vector3::new(0.2, 0.4, 0.0);
    let cases = [
        (
            SphereRole::Support,
            authored,
            RetailCollisionDisposition::LowerStep,
        ),
        (
            SphereRole::Upper,
            authored,
            RetailCollisionDisposition::UpperSlide,
        ),
        (
            SphereRole::Support,
            authored * -1.0,
            RetailCollisionDisposition::LowerBackFace,
        ),
        (
            SphereRole::Upper,
            authored * -1.0,
            RetailCollisionDisposition::UpperBackFaceSlide,
        ),
    ];

    for (role, separation_normal, expected_disposition) in cases {
        let expected = retail_polygon_collision_semantic(role, authored, separation_normal, offset);
        assert_eq!(expected.disposition, expected_disposition);
        let contacts = [RoleContacts {
            role,
            contacts: vec![GroundedObstruction {
                separation_normal,
                response_normal: expected.response_normal,
                depth: 0.01,
            }],
        }];
        let mut actual_normal = None;
        remember_next_sliding_normal(&mut actual_normal, &contacts, 0.7, offset);
        let actual = super::apply_sliding_normal(offset, actual_normal);
        assert_vector_close(actual, expected.next_offset, "single-producer next offset");
    }
}

#[test]
fn aggregate_contact_selection_is_order_independent_when_opposition_has_a_unique_winner() {
    let offset = Vector3::new(0.5, 4.0, 0.0);
    let contacts = [
        GroundedObstruction {
            separation_normal: Vector3::new(-1.0, 0.0, 0.0),
            response_normal: Vector3::new(-1.0, 0.0, 0.0),
            depth: 0.01,
        },
        GroundedObstruction {
            separation_normal: Vector3::new(-0.98, -0.2, 0.0).normalize(),
            response_normal: Vector3::new(-0.98, -0.2, 0.0).normalize(),
            depth: 0.01,
        },
    ];
    let mut selected = Vec::new();
    for ordered in [contacts.to_vec(), contacts.into_iter().rev().collect()] {
        let mut normal = None;
        remember_next_sliding_normal(
            &mut normal,
            &[RoleContacts {
                role: SphereRole::Upper,
                contacts: ordered,
            }],
            0.7,
            offset,
        );
        selected.push(normal.expect("unique opposing contact was not selected"));
    }
    assert_vector_close(selected[0], selected[1], "unique aggregate winner");
    assert_vector_close(
        selected[0],
        contacts[1].response_normal,
        "most opposing aggregate plane",
    );
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
    let contacts = match scene
        .grounded_obstructions(GroundedObstructionRequest {
            sweep: CoverageRequest {
                anchor: Guid(LANDBLOCK),
                start: center - movement,
                end: center,
                radius: 0.5,
            },
            placement: &crate::CollisionPlacement::outdoor(),
        })
        .unwrap()
    {
        CollisionQuery::Complete(contacts) => contacts,
        CollisionQuery::MissingCoverage(missing) => {
            panic!("crest fixture unexpectedly lacks coverage: {missing:?}")
        }
    };
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

    let role_contacts = [RoleContacts {
        role: SphereRole::Support,
        contacts: vec![*contact],
    }];
    let mut sliding = None;
    remember_next_sliding_normal(&mut sliding, &role_contacts, 0.7, movement);
    assert_eq!(
        sliding,
        retail_sliding_normal(polygon.normal),
        "walkable crest edge manufactured a horizontal sliding constraint"
    );
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
            },
            static_geometry: LandblockColliders {
                colliders: vec![ramp],
                cell_volumes: vec![volume],
            },
        })
        .unwrap();

    let candidate = Vector3::new(15.0, 15.0, 0.0);
    let body = GroundedBody {
        pose: WorldPosition {
            landblock_id: Guid(LANDBLOCK),
            coords: candidate,
            rotation: Quaternion::identity(),
        },
        cell: Some(Guid(CELL)),
        fall_velocity: 0.0,
        support: Some(GroundSupport {
            normal: Vector3::new(0.0, 0.0, 1.0),
        }),
    };
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
    let settled = settle_candidate(
        GroundedSolveContext {
            scene: &scene,
            config,
            anchor: Guid(LANDBLOCK),
            pose: body.pose,
            spheres,
        },
        &body,
        candidate,
        config.step_down_height,
    )
    .unwrap();
    let CollisionQuery::Complete(SettleResult::Supported(settled)) = settled else {
        panic!("portal-visible terrain lip vetoed the walkable transaction: {settled:?}");
    };
    assert!((expected_lift - TERRAIN_HEIGHT).abs() < TEST_EPSILON);
    assert!(
        (settled.body_center.z - expected_lift).abs() < TEST_EPSILON,
        "production lift diverged from retail: expected={expected_lift} settled={settled:?}"
    );
}

#[test]
fn portal_straddling_building_keeps_walkable_polygons_after_center_solid_is_disabled() {
    const CELL: u32 = 0xda55_01e8;

    let mut ramp = placed_polygon(1, horizontal_quad(10.0, 20.0, 0.0));
    ramp.source_placement = StaticColliderPlacement::BuildingShell { source_index: 0 };
    let scene = scene(vec![ramp]);
    let placement =
        CollisionPlacement::outdoor().merge_reached(CollisionPlacement::interior(Guid(CELL)));
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
    let CollisionQuery::Complete(supports) = supports else {
        panic!("building-ramp fixture unexpectedly lacks collision coverage: {supports:?}");
    };
    assert_eq!(supports.len(), 1, "portal reach removed the building ramp");
    assert!(supports[0].height_delta.abs() < TEST_EPSILON);
    assert_vector_close(
        supports[0].normal,
        Vector3::new(0.0, 0.0, 1.0),
        "retained building support",
    );
}

#[test]
fn zero_adjustment_edge_routes_to_retail_precipice_slide_instead_of_ratcheting_down() {
    const PORCH_HEIGHT: f32 = 1.6;
    let porch_vertices = horizontal_quad(10.0, 20.0, PORCH_HEIGHT);
    let porch = RetailPolygon {
        vertices: &porch_vertices,
        normal: Vector3::new(0.0, 0.0, 1.0),
        d: -PORCH_HEIGHT,
    };
    let scene = scene(vec![
        placed_polygon(1, horizontal_quad(0.0, 30.0, 0.0)),
        placed_polygon(2, porch_vertices.clone()),
    ]);
    let start = Vector3::new(10.5, 20.0, PORCH_HEIGHT);
    let requested_velocity = Vector3::new(-1.0, 0.4, 0.0);
    let expected_edge = retail_crossed_edge_normal(
        porch,
        start + grounded_pair().support.center + requested_velocity,
    )
    .expect("retail oracle did not find the crossed porch edge");
    let expected_displacement = retail_adjust_offset(requested_velocity, Some(expected_edge));
    assert_vector_close(
        expected_displacement,
        Vector3::new(0.0, 0.4, 0.0),
        "retail precipice displacement",
    );

    let mut config = grounded_config();
    config.edge_protection = EdgeProtection::Creature;
    config.step_down_height = 1.5;
    config.maximum_substep_distance = 2.0;
    let outcome = solve_grounded(
        &scene,
        config,
        GroundedRequest {
            body: GroundedBody {
                pose: WorldPosition {
                    landblock_id: Guid(LANDBLOCK),
                    coords: start,
                    rotation: Quaternion::identity(),
                }
                .normalize_outdoor_cell(),
                cell: None,
                fall_velocity: 0.0,
                support: Some(GroundSupport {
                    normal: Vector3::new(0.0, 0.0, 1.0),
                }),
            },
            spheres: grounded_pair(),
            drive_velocity: requested_velocity,
            delta_seconds: 1.0,
        },
    )
    .unwrap();
    let GroundedOutcome::Solved { body, .. } = outcome else {
        panic!("protected porch route did not solve: {outcome:?}");
    };
    assert_vector_close(
        body.pose.coords - start,
        expected_displacement,
        "production precipice displacement",
    );
    assert!(body.support.is_some());
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
        let body = GroundedBody {
            pose: WorldPosition {
                landblock_id: Guid(LANDBLOCK),
                coords: candidate,
                rotation: Quaternion::identity(),
            }
            .normalize_outdoor_cell(),
            cell: None,
            fall_velocity: 0.0,
            support: Some(GroundSupport {
                normal: Vector3::new(0.0, 0.0, 1.0),
            }),
        };
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
        let settled = settle_candidate(
            GroundedSolveContext {
                scene: &scene,
                config,
                anchor: Guid(LANDBLOCK),
                pose: body.pose,
                spheres,
            },
            &body,
            candidate,
            config.step_down_height,
        )
        .unwrap();
        let CollisionQuery::Complete(SettleResult::Supported(settled)) = settled else {
            panic!("overlapping supports did not settle: order={order:?} result={settled:?}");
        };
        assert!(
            (settled.body_center.z - (expected.adjusted_center.z - spheres.support.center.z)).abs()
                < TEST_EPSILON,
            "support selection diverged from retail time-of-impact winner: order={order:?} expected={expected:?} settled={settled:?}"
        );
        assert_eq!(order[expected.selected_surface], UPPER_HEIGHT);
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
    let support = GroundSupport {
        normal: Vector3::new(0.0, 0.0, 1.0),
    };
    let body = GroundedBody {
        pose: WorldPosition {
            landblock_id: Guid(LANDBLOCK),
            coords: start,
            rotation: Quaternion::identity(),
        }
        .normalize_outdoor_cell(),
        cell: None,
        fall_velocity: 0.0,
        support: Some(support),
    };
    let blocked = solve_grounded(
        &scene,
        grounded_config(),
        GroundedRequest {
            body: body.clone(),
            spheres: grounded_pair(),
            drive_velocity: Vector3::new(1.0, 0.0, 0.0),
            delta_seconds: 0.5,
        },
    )
    .unwrap();
    let GroundedOutcome::Solved { body: blocked, .. } = blocked else {
        panic!("failed step did not produce a safe solved pose: {blocked:?}");
    };
    assert!(
        blocked.pose.coords.z.abs() < TEST_EPSILON,
        "failed step leaked its raised trial pose: {blocked:?}"
    );
    assert_eq!(blocked.support, Some(support));

    let retreated = solve_grounded(
        &scene,
        grounded_config(),
        GroundedRequest {
            body: blocked,
            spheres: grounded_pair(),
            drive_velocity: Vector3::new(-1.0, 0.0, 0.0),
            delta_seconds: 0.5,
        },
    )
    .unwrap();
    let GroundedOutcome::Solved {
        body: retreated, ..
    } = retreated
    else {
        panic!("retreat after restored step did not solve: {retreated:?}");
    };
    assert!(retreated.pose.coords.x < start.x - 0.3);
    assert!(retreated.pose.coords.z.abs() < TEST_EPSILON);
}

#[test]
fn upper_sphere_independently_vetoes_an_otherwise_valid_lower_step() {
    let mut step_geometry = vec![placed_polygon(1, horizontal_quad(0.0, 30.0, 0.0))];
    step_geometry.push(placed_polygon(2, horizontal_quad(10.0, 14.0, 0.4)));
    step_geometry.push(placed_polygon_with_normal(
        3,
        vertical_quad_x(10.0, 0.0, 0.4),
        Vector3::new(-1.0, 0.0, 0.0),
    ));
    let start = Vector3::new(9.4, 20.0, 0.0);
    let candidate = Vector3::new(10.1, 20.0, 0.0);
    let supported = GroundedBody {
        pose: WorldPosition {
            landblock_id: Guid(LANDBLOCK),
            coords: start,
            rotation: Quaternion::identity(),
        }
        .normalize_outdoor_cell(),
        cell: None,
        fall_velocity: 0.0,
        support: Some(GroundSupport {
            normal: Vector3::new(0.0, 0.0, 1.0),
        }),
    };
    let lower_scene = scene(step_geometry.clone());
    let lower_step = step_up_candidate(
        GroundedSolveContext {
            scene: &lower_scene,
            config: grounded_config(),
            anchor: Guid(LANDBLOCK),
            pose: supported.pose,
            spheres: GroundedBodySpheres {
                support: grounded_pair().support,
                upper: None,
            },
        },
        &supported,
        start,
        candidate,
    )
    .unwrap();
    let CollisionQuery::Complete(Some(lower_step)) = lower_step else {
        panic!("lower-only step did not produce a candidate: {lower_step:?}");
    };
    assert!(
        (lower_step.body_center.z - 0.4).abs() < TEST_EPSILON,
        "lower step selected the wrong support: {lower_step:?}"
    );

    let mut ceiling = horizontal_quad(8.0, 15.0, 2.75);
    ceiling.reverse();
    step_geometry.push(placed_polygon_with_normal(
        4,
        ceiling,
        Vector3::new(0.0, 0.0, -1.0),
    ));
    let pair_scene = scene(step_geometry);
    let paired_step = step_up_candidate(
        GroundedSolveContext {
            scene: &pair_scene,
            config: grounded_config(),
            anchor: Guid(LANDBLOCK),
            pose: supported.pose,
            spheres: grounded_pair(),
        },
        &supported,
        start,
        candidate,
    )
    .unwrap();
    assert!(
        matches!(paired_step, CollisionQuery::Complete(None)),
        "upper sphere failed to veto the otherwise valid raised placement: {paired_step:?}"
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
                    let body = GroundedBody {
                        pose: WorldPosition {
                            landblock_id: Guid(LANDBLOCK),
                            coords: start,
                            rotation: Quaternion::identity(),
                        }
                        .normalize_outdoor_cell(),
                        cell: None,
                        fall_velocity: 0.0,
                        support: Some(GroundSupport {
                            normal: Vector3::new(0.0, 0.0, 1.0),
                        }),
                    };
                    let outcome = solve_grounded(
                        &scene,
                        grounded_config(),
                        GroundedRequest {
                            body,
                            spheres: grounded_pair(),
                            drive_velocity: Vector3::new(1.0, lateral_velocity, 0.0),
                            delta_seconds: 0.5,
                        },
                    )
                    .unwrap();
                    let GroundedOutcome::Solved {
                        body,
                        achieved_velocity,
                        ..
                    } = outcome
                    else {
                        panic!(
                            "crest matrix did not solve: seam={seam} height={height_delta} start={start_x} lateral={lateral_velocity}: {outcome:?}"
                        );
                    };
                    assert!(
                        body.pose.coords.x > start_x + 0.35 && achieved_velocity.x > 0.7,
                        "crest consumed forward motion: seam={seam} height={height_delta} start={start_x} lateral={lateral_velocity}: body={body:?} velocity={achieved_velocity:?}"
                    );
                }
            }
        }
    }
}

fn grounded_config() -> GroundedConfig {
    GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: 0.7,
        step_up_height: 0.6,
        step_down_height: 0.2,
        edge_protection: EdgeProtection::None,
        maximum_substep_distance: 0.24,
        maximum_substeps: 32,
        maximum_contact_passes: 8,
        separation_epsilon: 0.000_5,
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
    let mut minimum = vertices[0];
    let mut maximum = vertices[0];
    for vertex in vertices.iter().copied().skip(1) {
        minimum.x = minimum.x.min(vertex.x);
        minimum.y = minimum.y.min(vertex.y);
        minimum.z = minimum.z.min(vertex.z);
        maximum.x = maximum.x.max(vertex.x);
        maximum.y = maximum.y.max(vertex.y);
        maximum.z = maximum.z.max(vertex.z);
    }
    let bounds_center = (minimum + maximum) * 0.5;
    let bounds = Sphere {
        center: bounds_center,
        radius: vertices
            .iter()
            .map(|vertex| (*vertex - bounds_center).length())
            .fold(0.0, f32::max),
    };
    PlacedCollider {
        shape: Arc::new(CollisionShape {
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
        }),
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
    scene.insert(artifact(LANDBLOCK, colliders)).unwrap();
    scene
}

fn artifact(landblock_id: u32, colliders: Vec<PlacedCollider>) -> LandblockCollisionAsset {
    LandblockCollisionAsset {
        landblock_id,
        terrain: TerrainCollisionSurface { cells: Vec::new() },
        static_geometry: LandblockColliders {
            colliders,
            cell_volumes: Vec::new(),
        },
    }
}

fn assert_vector_option_close(actual: Option<Vector3>, expected: Option<Vector3>, context: &str) {
    match (actual, expected) {
        (Some(actual), Some(expected)) => assert_vector_close(actual, expected, context),
        (None, None) => {}
        _ => panic!("{context} differs: actual={actual:?} expected={expected:?}"),
    }
}

fn assert_vector_close(actual: Vector3, expected: Vector3, context: &str) {
    assert!(
        (actual - expected).length() <= TEST_EPSILON,
        "{context} differs: actual={actual:?} expected={expected:?}"
    );
}
