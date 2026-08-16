//! Narrow differential oracle for retail setup-volume collision.
//!
//! The oracle functions transliterate retail's volume predicates directly from the decompile and
//! deliberately share no code with `volume_query`, so a mistake ported into production cannot
//! manufacture parity here.

use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::{
    ColliderScale, CollisionBall, CollisionCylinder, CollisionShape,
    LandblockColliders, LandblockCollisionAsset, LandblockPlacement, LandblockTerrain,
    PlacedCollider, StaticColliderPlacement, TerrainCollisionSurface,
};
use std::sync::Arc;

use super::{
    placed_ball_contact, placed_ball_support, placed_cylinder_contact, placed_cylinder_support,
};
use crate::spatial::collision::CollisionScene;
use crate::{
    EdgeProtection, GroundSupport, GroundedBody, GroundedBodySpheres, GroundedConfig,
    GroundedOutcome, GroundedRequest, GroundedSphere, PhysicalCollisionFilter,
    RETAIL_WALKABLE_NORMAL_Z, solve_grounded,
};

const LANDBLOCK: u32 = 0xe63e_ffff;
/// Retail's contact epsilon; the decompile's `0.00019999999` is this same f32 (0x3951B717).
const RETAIL_EPSILON: f32 = 0.000_2;
const TEST_EPSILON: f32 = 0.000_1;

/// `CCylSphere::collides_with_sphere`, transliterated from `acclient.c:346572-346580`.
///
/// `disp` is the sphere center minus the cylinder low point; `radsum` is the caller-shrunk
/// radius sum, exactly as `intersects_sphere` passes it (`acclient.c:347138`).
fn retail_cylsphere_collides(
    cylinder_height: f32,
    sphere_radius: f32,
    disp: Vector3,
    radsum: f32,
) -> bool {
    radsum * radsum >= disp.x * disp.x + disp.y * disp.y
        && sphere_radius - RETAIL_EPSILON + cylinder_height * 0.5
            >= (cylinder_height * 0.5 - disp.z).abs()
}

/// `CSphere` overlap as `CSphere::intersects_sphere` computes it (`acclient.c:344345-344350`):
/// 3D distance against the shrunk radius sum.
fn retail_ball_collides(disp: Vector3, radsum: f32) -> bool {
    radsum * radsum >= disp.x * disp.x + disp.y * disp.y + disp.z * disp.z
}

/// Cylinder rest height from `CCylSphere::step_sphere_down` (`acclient.c:346646`): the contact
/// plane sits at the authored top, tangent sphere center one radius above.
fn retail_cylinder_rest_z(low_z: f32, height: f32, sphere_radius: f32) -> f32 {
    low_z + height + sphere_radius
}

/// Ball rest height from `CSphere::step_sphere_down` (`acclient.c:343736`): the shrunk radius sum
/// is un-shrunk (`radsuma = radsum + ε`) before solving the vertical tangency.
fn retail_ball_rest_z(ball_center: Vector3, ball_radius: f32, sphere_radius: f32, center: Vector3) -> f32 {
    let radsum = (ball_radius + sphere_radius - RETAIL_EPSILON) + RETAIL_EPSILON;
    let dx = center.x - ball_center.x;
    let dy = center.y - ball_center.y;
    ball_center.z + (radsum * radsum - (dx * dx + dy * dy)).sqrt()
}

/// Dispatch over the production variant entry points; fixtures only build volume shapes.
fn volume_contact(
    collider: &PlacedCollider,
    center: Vector3,
    radius: f32,
) -> Option<super::super::bsp_query::ShapeContact> {
    match &*collider.shape {
        CollisionShape::Cylinder(cylinder) => {
            placed_cylinder_contact(collider, cylinder, center, radius)
        }
        CollisionShape::Ball(ball) => placed_ball_contact(collider, ball, center, radius),
        CollisionShape::Bsp(_) => unreachable!("volume fixtures never build BSP shapes"),
    }
}

fn volume_support(
    collider: &PlacedCollider,
    center: Vector3,
    radius: f32,
    maximum_drop: f32,
    maximum_rise: f32,
) -> Option<super::super::bsp_query::ShapeSupport> {
    match &*collider.shape {
        CollisionShape::Cylinder(cylinder) => {
            placed_cylinder_support(collider, cylinder, center, radius, maximum_drop, maximum_rise)
        }
        CollisionShape::Ball(ball) => {
            placed_ball_support(collider, ball, center, radius, maximum_drop, maximum_rise)
        }
        CollisionShape::Bsp(_) => unreachable!("volume fixtures never build BSP shapes"),
    }
}

fn cylinder_collider(low: Vector3, radius: f32, height: f32) -> PlacedCollider {
    placed(Arc::new(CollisionShape::Cylinder(CollisionCylinder {
        low_point: low,
        radius,
        height,
    })))
}

fn ball_collider(center: Vector3, radius: f32) -> PlacedCollider {
    placed(Arc::new(CollisionShape::Ball(CollisionBall {
        center,
        radius,
    })))
}

fn placed(shape: Arc<CollisionShape>) -> PlacedCollider {
    PlacedCollider::new(
        shape,
        LandblockPlacement {
            origin: Vector3::zero(),
            orientation: Quaternion::identity(),
        },
        ColliderScale::uniform(1.0).unwrap(),
        StaticColliderPlacement::OutdoorGenerated { source_index: 0 },
    )
    .unwrap()
}

/// Deterministic sweep: production contact presence must equal retail's overlap predicate at
/// every sampled center, including just inside and outside the ε-shrunk boundaries.
#[test]
fn cylinder_contact_presence_matches_the_retail_overlap_predicate() {
    let low = Vector3::new(50.0, 50.0, 10.0);
    let (cyl_radius, cyl_height) = (0.85, 3.334);
    let sphere_radius = 0.48;
    let collider = cylinder_collider(low, cyl_radius, cyl_height);
    let radsum = cyl_radius - RETAIL_EPSILON + sphere_radius;

    let mut checked = 0usize;
    let mut boundary_disagreements = Vec::new();
    for x_step in -30i32..=30 {
        for z_step in -12i32..=52 {
            let center = low + Vector3::new(x_step as f32 * 0.05, 0.0, z_step as f32 * 0.1);
            let retail =
                retail_cylsphere_collides(cyl_height, sphere_radius, center - low, radsum);
            let ours = volume_contact(&collider, center, sphere_radius).is_some();
            if retail != ours {
                boundary_disagreements.push((center, retail, ours));
            }
            checked += 1;
        }
    }
    assert!(
        boundary_disagreements.is_empty(),
        "{} of {checked} samples disagree with retail: {:?}",
        boundary_disagreements.len(),
        &boundary_disagreements[..boundary_disagreements.len().min(5)]
    );
}

#[test]
fn ball_contact_presence_matches_the_retail_overlap_predicate() {
    let ball_center = Vector3::new(50.0, 50.0, 10.0);
    let ball_radius = 1.0;
    let sphere_radius = 0.48;
    let collider = ball_collider(ball_center, ball_radius);
    let radsum = ball_radius + sphere_radius - RETAIL_EPSILON;

    let mut disagreements = 0usize;
    for x_step in -35i32..=35 {
        for z_step in -35i32..=35 {
            let center =
                ball_center + Vector3::new(x_step as f32 * 0.05, 0.02, z_step as f32 * 0.05);
            let retail = retail_ball_collides(center - ball_center, radsum);
            let ours = volume_contact(&collider, center, sphere_radius).is_some();
            if retail != ours {
                disagreements += 1;
            }
        }
    }
    assert_eq!(disagreements, 0);
}

/// The production settle height must equal retail's step-down rest plane wherever a support
/// exists, and supports must cut off sharply at the shrunk radius sum with no edge feature.
#[test]
fn cylinder_support_rest_height_and_cutoff_match_retail() {
    let low = Vector3::new(50.0, 50.0, 10.0);
    let (cyl_radius, cyl_height) = (1.09, 23.02);
    let sphere_radius = 0.48;
    let collider = cylinder_collider(low, cyl_radius, cyl_height);
    let radsum = cyl_radius + sphere_radius - RETAIL_EPSILON;
    let rest_z = retail_cylinder_rest_z(low.z, cyl_height, sphere_radius);

    for x_step in 0i32..=40 {
        let dxy = x_step as f32 * 0.05;
        let center = Vector3::new(low.x + dxy, low.y, rest_z + 0.4);
        let support = volume_support(&collider, center, sphere_radius, 1.5, 0.6);
        if dxy <= radsum {
            let support = support.unwrap_or_else(|| panic!("no support at dxy {dxy}"));
            assert!(
                (support.height_delta - (rest_z - center.z)).abs() < TEST_EPSILON,
                "rest height diverged at dxy {dxy}: {}",
                support.height_delta
            );
            assert_eq!(support.normal, Vector3::new(0.0, 0.0, 1.0));
        } else {
            assert!(
                support.is_none(),
                "retail's square-edged solid admits no rim support at dxy {dxy}"
            );
        }
    }
}

#[test]
fn ball_support_rest_height_matches_retail_and_leans_radially() {
    let ball_center = Vector3::new(50.0, 50.0, 10.0);
    let ball_radius = 2.299;
    let sphere_radius = 0.48;
    let collider = ball_collider(ball_center, ball_radius);

    for x_step in 0i32..=25 {
        let dxy = x_step as f32 * 0.1;
        let probe = Vector3::new(ball_center.x + dxy, ball_center.y, ball_center.z + 4.0);
        let Some(support) = volume_support(&collider, probe, sphere_radius, 3.0, 0.6) else {
            assert!(
                dxy > ball_radius + sphere_radius - RETAIL_EPSILON,
                "support vanished inside the cap at dxy {dxy}"
            );
            continue;
        };
        let rest_z = retail_ball_rest_z(ball_center, ball_radius, sphere_radius, probe);
        assert!(
            (support.height_delta - (rest_z - probe.z)).abs() < TEST_EPSILON,
            "ball rest height diverged at dxy {dxy}"
        );
        // Retail's contact plane normal is the displacement over the un-shrunk radius sum.
        let expected_normal_z = (rest_z - ball_center.z) / (ball_radius + sphere_radius);
        assert!((support.normal.z - expected_normal_z).abs() < TEST_EPSILON);
    }
}

// --- Production grounded solver scenarios over volume colliders ---

fn scene(colliders: Vec<PlacedCollider>) -> CollisionScene {
    let mut scene = CollisionScene::new();
    scene
        .insert(LandblockCollisionAsset {
            landblock_id: LANDBLOCK,
            terrain: flat_terrain(),
            static_geometry: LandblockColliders {
                colliders,
                cell_volumes: Vec::new(),
            },
        })
        .unwrap();
    scene
}

fn flat_terrain() -> TerrainCollisionSurface {
    TerrainCollisionSurface::from_terrain(&LandblockTerrain {
        grid_size: 9,
        tile_size: 24.0,
        height_indices: vec![0; 81],
        heights: vec![0.0; 81],
        terrain_samples: vec![0; 81],
        cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(LANDBLOCK),
    })
    .unwrap()
}

fn grounded_config() -> GroundedConfig {
    GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        step_up_height: 0.6,
        step_down_height: 1.5,
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
            center: Vector3::new(0.0, 0.0, 0.475),
            radius: 0.48,
        },
        upper: Some(GroundedSphere {
            center: Vector3::new(0.0, 0.0, 1.35),
            radius: 0.48,
        }),
    }
}

fn drive(
    scene: &CollisionScene,
    start: Vector3,
    velocity: Vector3,
    ticks: usize,
) -> GroundedBody {
    drive_body(scene, start, velocity, ticks, true)
}

fn drive_body(
    scene: &CollisionScene,
    start: Vector3,
    velocity: Vector3,
    ticks: usize,
    supported: bool,
) -> GroundedBody {
    let mut body = GroundedBody {
        pose: WorldPosition {
            landblock_id: Guid(LANDBLOCK),
            coords: start,
            rotation: Quaternion::identity(),
        }
        .normalize_outdoor_cell(),
        cell: None,
        velocity: Vector3::zero(),
        support: supported.then_some(GroundSupport {
            normal: Vector3::new(0.0, 0.0, 1.0),
        }),
    };
    for _ in 0..ticks {
        let outcome = solve_grounded(
            scene,
            grounded_config(),
            GroundedRequest {
                filter: PhysicalCollisionFilter::ALL,
                body: body.clone(),
                spheres: grounded_pair(),
                supported_velocity: velocity,
                may_step_down: true,
                retain_supported_gravity: false,
                delta_seconds: 1.0 / 30.0,
            },
        )
        .unwrap();
        let GroundedOutcome::Solved { body: solved, .. } = outcome else {
            panic!("grounded solve failed: {outcome:?}");
        };
        body = solved;
    }
    body
}

/// An airborne body dropped over a stump lands on its top at retail's rest height — the
/// `land_on_cylinder` case (`acclient.c:347025` region).
#[test]
fn body_settles_grounded_on_a_stump_top() {
    let low = Vector3::new(50.0, 50.0, 0.0);
    let (radius, height) = (1.5, 0.9);
    let scene = scene(vec![cylinder_collider(low, radius, height)]);
    // Body reference is the foot point: support-sphere center 0.475 above it, radius 0.48.
    // Rest: support center at top + 0.48 → reference z = low.z + H + 0.48 - 0.475.
    let expected_z = retail_cylinder_rest_z(low.z, height, 0.48) - 0.475;
    let settled = drive_body(
        &scene,
        Vector3::new(50.0, 50.0, expected_z + 0.3),
        Vector3::zero(),
        30,
        false,
    );
    assert!(settled.support.is_some(), "body never acquired stump support");
    assert!(
        (settled.pose.coords.z - expected_z).abs() < 0.01,
        "settled at {} instead of retail's {expected_z}",
        settled.pose.coords.z
    );
}

/// A body walking into a trunk stops at the Minkowski wall and keeps its ground support.
#[test]
fn body_walking_into_a_trunk_stops_at_the_radial_wall() {
    let low = Vector3::new(50.0, 50.0, -1.0);
    let (radius, height) = (1.09, 23.0);
    let scene = scene(vec![cylinder_collider(low, radius, height)]);
    let stopped = drive(
        &scene,
        Vector3::new(56.0, 50.0, 0.0),
        Vector3::new(-4.0, 0.0, 0.0),
        90,
    );
    // The support sphere (r 0.48) stops where its center reaches the shrunk radius sum, plus the
    // solver's substep quantization and separation epsilon.
    let minimum_x = low.x + radius + 0.48 - RETAIL_EPSILON;
    assert!(
        stopped.pose.coords.x >= minimum_x - 0.001,
        "body penetrated the trunk: {} < {minimum_x}",
        stopped.pose.coords.x
    );
    assert!(
        stopped.pose.coords.x < minimum_x + 0.3,
        "body stopped implausibly far from the trunk: {}",
        stopped.pose.coords.x
    );
    assert!(stopped.support.is_some(), "body lost ground support at the trunk");
}

/// A low stump within the step-up budget is mounted like any low walkable step.
#[test]
fn body_steps_up_onto_a_low_stump() {
    let low = Vector3::new(50.0, 50.0, 0.0);
    let (radius, height) = (1.5, 0.4);
    let scene = scene(vec![cylinder_collider(low, radius, height)]);
    let mounted = drive(
        &scene,
        Vector3::new(53.0, 50.0, 0.0),
        Vector3::new(-2.0, 0.0, 0.0),
        60,
    );
    let expected_z = retail_cylinder_rest_z(low.z, height, 0.48) - 0.475;
    assert!(
        (mounted.pose.coords.z - expected_z).abs() < 0.01,
        "body did not mount the stump: z {}",
        mounted.pose.coords.z
    );
    assert!(mounted.support.is_some());
    assert!(
        (mounted.pose.coords.x - 50.0).abs() < 1.0,
        "body did not advance onto the stump: x {}",
        mounted.pose.coords.x
    );
}

/// Walking off the stump finds terrain below through ordinary step-down — the square-edged solid
/// offers no rim support to cling to.
#[test]
fn body_walks_off_a_stump_onto_the_terrain_below() {
    let low = Vector3::new(50.0, 50.0, 0.0);
    let (radius, height) = (1.5, 0.9);
    let scene = scene(vec![cylinder_collider(low, radius, height)]);
    let top_z = retail_cylinder_rest_z(low.z, height, 0.48) - 0.475;
    let departed = drive(
        &scene,
        Vector3::new(50.0, 50.0, top_z),
        Vector3::new(2.0, 0.0, 0.0),
        90,
    );
    assert!(
        departed.pose.coords.z < 0.01,
        "body failed to step down off the stump: z {}",
        departed.pose.coords.z
    );
    assert!(departed.support.is_some(), "body lost terrain support after departure");
}
