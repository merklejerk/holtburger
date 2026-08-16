//! Sphere contacts against one placed setup collision volume.
//!
//! Retail's volume solids are square-edged Minkowski approximations, not rounded ones: a cylsphere
//! obstructs exactly the region `xy_distance <= R + r - ε` and `z ∈ [-(r - ε), H + r - ε]` around
//! its low point (`CCylSphere::collides_with_sphere`, `acclient.c:346572-346580`), and a collision
//! sphere obstructs the ball of radius `R + r - ε` (`CSphere::intersects_sphere`,
//! `acclient.c:344292-344350`). A body dropping past a cylinder rim misses it entirely rather
//! than grazing a rounded lip, so no edge support feature exists for volumes.
//!
//! Retail resolves collision responses inside its transition machine using the pre-move center
//! (`CCylSphere::normal_of_collision`, `acclient.c:346715`: radial wall normal when that center is
//! outside the expanded radius, otherwise a pure ±Z cap normal). Our solver substeps and separates
//! penetration contacts instead, so this module maps that discrimination onto the static query
//! center by shallowest penetration axis: the same binary radial-or-cap normal structure, chosen
//! by the side the body is closest to leaving. Cone normals at rims are deliberately never
//! produced, matching retail's binary structure.

use holtburger_common::Vector3;
use holtburger_content::{CollisionBall, CollisionCylinder, PlacedCollider};

use super::bsp_query::{CONTACT_EPSILON, ShapeContact, ShapeSupport, ShapeSupportFeature};

/// One placed cylsphere in landblock space.
///
/// The axis is landblock +Z regardless of placement orientation — retail transforms only the low
/// point into the object frame (`acclient.c:347305-347338`).
#[derive(Debug, Clone, Copy)]
struct PlacedCylinder {
    low: Vector3,
    radius: f32,
    height: f32,
}

/// One placed collision ball in landblock space.
#[derive(Debug, Clone, Copy)]
struct PlacedBall {
    center: Vector3,
    radius: f32,
}

/// Uniform scale of a volume collider; `PlacedCollider::new` is the sole construction door and
/// rejects non-uniform volume scales, so this cannot fail on a constructed collider.
fn uniform_scale(collider: &PlacedCollider) -> f32 {
    collider
        .scale
        .as_uniform()
        .expect("volume colliders are constructed with uniform scale")
}

fn placed_cylinder(collider: &PlacedCollider, cylinder: &CollisionCylinder) -> PlacedCylinder {
    let scale = uniform_scale(collider);
    PlacedCylinder {
        low: collider.point_to_landblock_space(cylinder.low_point),
        radius: cylinder.radius * scale,
        height: cylinder.height * scale,
    }
}

fn placed_ball(collider: &PlacedCollider, ball: &CollisionBall) -> PlacedBall {
    let scale = uniform_scale(collider);
    PlacedBall {
        center: collider.point_to_landblock_space(ball.center),
        radius: ball.radius * scale,
    }
}

/// Returns the separating contact with one placed cylinder, when the sphere overlaps it.
pub(super) fn placed_cylinder_contact(
    collider: &PlacedCollider,
    cylinder: &CollisionCylinder,
    center: Vector3,
    radius: f32,
) -> Option<ShapeContact> {
    cylinder_contact(placed_cylinder(collider, cylinder), center, radius)
}

/// Returns the separating contact with one placed ball, when the sphere overlaps it.
pub(super) fn placed_ball_contact(
    collider: &PlacedCollider,
    ball: &CollisionBall,
    center: Vector3,
    radius: f32,
) -> Option<ShapeContact> {
    ball_contact(placed_ball(collider, ball), center, radius)
}

fn cylinder_contact(cylinder: PlacedCylinder, center: Vector3, radius: f32) -> Option<ShapeContact> {
    let epsilon = CONTACT_EPSILON;
    let displacement = center - cylinder.low;
    // Retail's XY gate: `radsum² >= dx² + dy²` with the shrunk radius sum (`acclient.c:346578`).
    let radsum = cylinder.radius + radius - epsilon;
    let xy_squared = displacement.x * displacement.x + displacement.y * displacement.y;
    if xy_squared > radsum * radsum {
        return None;
    }
    // Retail's Z gate: `r - ε + H/2 >= |H/2 - dz|` (`acclient.c:346579`), i.e.
    // `dz ∈ [-(r - ε), H + r - ε]`.
    let half_height = cylinder.height * 0.5;
    if radius - epsilon + half_height < (half_height - displacement.z).abs() {
        return None;
    }

    // Penetration along each square edge of the expanded solid.
    let xy_distance = xy_squared.sqrt();
    let side_depth = radsum - xy_distance;
    let top_depth = (cylinder.height + radius - epsilon) - displacement.z;
    let bottom_depth = displacement.z + radius - epsilon;
    let cap_depth = top_depth.min(bottom_depth);

    // Shallowest-axis stand-in for retail's pre-move-center discrimination: radial when the wall
    // is nearest, pure ±Z otherwise. A center on the axis has no radial direction and always
    // separates through a cap, mirroring retail's small-normal rejection
    // (`AC1Legacy::Vector3::normalize_check_small`).
    if side_depth < cap_depth && xy_distance > epsilon {
        Some(ShapeContact {
            normal: Vector3::new(displacement.x / xy_distance, displacement.y / xy_distance, 0.0),
            depth: side_depth,
        })
    } else {
        let normal_z = if top_depth <= bottom_depth { 1.0 } else { -1.0 };
        Some(ShapeContact {
            normal: Vector3::new(0.0, 0.0, normal_z),
            depth: cap_depth,
        })
    }
}

fn ball_contact(ball: PlacedBall, center: Vector3, radius: f32) -> Option<ShapeContact> {
    let epsilon = CONTACT_EPSILON;
    // Retail's overlap: 3D distance below the shrunk radius sum (`acclient.c:344345-344350`).
    let radsum = ball.radius + radius - epsilon;
    let displacement = center - ball.center;
    let distance_squared = displacement.length_squared();
    if distance_squared > radsum * radsum {
        return None;
    }
    let distance = distance_squared.sqrt();
    // A center coincident with the ball's has no radial direction; separate straight up, the same
    // fallback the polygon query uses at zero separation.
    let normal = if distance > epsilon {
        displacement / distance
    } else {
        Vector3::new(0.0, 0.0, 1.0)
    };
    Some(ShapeContact {
        normal,
        depth: radsum - distance,
    })
}

/// Returns the surface reached by settling a sphere vertically onto one placed cylinder.
pub(super) fn placed_cylinder_support(
    collider: &PlacedCollider,
    cylinder: &CollisionCylinder,
    center: Vector3,
    radius: f32,
    maximum_drop: f32,
    maximum_rise: f32,
) -> Option<ShapeSupport> {
    cylinder_support(
        placed_cylinder(collider, cylinder),
        center,
        radius,
        maximum_drop,
        maximum_rise,
    )
}

/// Returns the surface reached by settling a sphere vertically onto one placed ball.
pub(super) fn placed_ball_support(
    collider: &PlacedCollider,
    ball: &CollisionBall,
    center: Vector3,
    radius: f32,
    maximum_drop: f32,
    maximum_rise: f32,
) -> Option<ShapeSupport> {
    ball_support(
        placed_ball(collider, ball),
        center,
        radius,
        maximum_drop,
        maximum_rise,
    )
}

fn cylinder_support(
    cylinder: PlacedCylinder,
    center: Vector3,
    radius: f32,
    maximum_drop: f32,
    maximum_rise: f32,
) -> Option<ShapeSupport> {
    let epsilon = CONTACT_EPSILON;
    let displacement = center - cylinder.low;
    // Retail's step-down gate is the same shrunk XY radius test as its overlap
    // (`CCylSphere::step_sphere_down`, `acclient.c:346646` via `collides_with_sphere`); a drop
    // missing it falls clean past the rim — no edge feature exists for volumes.
    let radsum = cylinder.radius + radius - epsilon;
    let xy_squared = displacement.x * displacement.x + displacement.y * displacement.y;
    if xy_squared > radsum * radsum {
        return None;
    }
    // Rest height: the contact plane is the authored top (`acclient.c:346646` builds it at
    // `low.z + H`), tangent sphere center one radius above.
    let height_delta = (cylinder.low.z + cylinder.height + radius) - center.z;
    if height_delta < -maximum_drop - epsilon || height_delta > maximum_rise + epsilon {
        return None;
    }
    Some(ShapeSupport {
        normal: Vector3::new(0.0, 0.0, 1.0),
        height_delta,
        feature: ShapeSupportFeature::Surface,
    })
}

fn ball_support(
    ball: PlacedBall,
    center: Vector3,
    radius: f32,
    maximum_drop: f32,
    maximum_rise: f32,
) -> Option<ShapeSupport> {
    let epsilon = CONTACT_EPSILON;
    // Retail's step-down un-shrinks the radius sum before computing the rest height
    // (`CSphere::step_sphere_down`, `acclient.c:343736`: `radsuma = radsum + ε`), so the sphere
    // settles at the exact authored contact distance.
    let rest_distance = ball.radius + radius;
    let dx = center.x - ball.center.x;
    let dy = center.y - ball.center.y;
    let xy_squared = dx * dx + dy * dy;
    let gate = rest_distance - epsilon;
    if xy_squared > gate * gate {
        return None;
    }
    let rest_z = ball.center.z + (rest_distance * rest_distance - xy_squared).sqrt();
    let height_delta = rest_z - center.z;
    if height_delta < -maximum_drop - epsilon || height_delta > maximum_rise + epsilon {
        return None;
    }
    let rest_center = Vector3::new(center.x, center.y, rest_z);
    Some(ShapeSupport {
        // Radial support normal at the rest pose, exactly retail's contact plane normal
        // (`acclient.c:343736` normalizes `disp` by the un-shrunk radius sum).
        normal: (rest_center - ball.center) / rest_distance,
        height_delta,
        feature: ShapeSupportFeature::Surface,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use holtburger_common::Quaternion;
    use holtburger_content::{
        ColliderScale, CollisionBall, CollisionCylinder, CollisionShape, LandblockPlacement,
        StaticColliderPlacement,
    };

    use super::*;

    /// Test-only dispatcher over the variant entry points; fixtures only build volume shapes.
    fn volume_contact(
        collider: &PlacedCollider,
        center: Vector3,
        radius: f32,
    ) -> Option<ShapeContact> {
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
    ) -> Option<ShapeSupport> {
        match &*collider.shape {
            CollisionShape::Cylinder(cylinder) => placed_cylinder_support(
                collider,
                cylinder,
                center,
                radius,
                maximum_drop,
                maximum_rise,
            ),
            CollisionShape::Ball(ball) => {
                placed_ball_support(collider, ball, center, radius, maximum_drop, maximum_rise)
            }
            CollisionShape::Bsp(_) => unreachable!("volume fixtures never build BSP shapes"),
        }
    }

    fn cylinder_collider(low: Vector3, radius: f32, height: f32, scale: f32) -> PlacedCollider {
        let shape = Arc::new(CollisionShape::Cylinder(CollisionCylinder {
            low_point: low,
            radius,
            height,
        }));
        placed(shape, scale)
    }

    fn ball_collider(center: Vector3, radius: f32, scale: f32) -> PlacedCollider {
        let shape = Arc::new(CollisionShape::Ball(CollisionBall { center, radius }));
        placed(shape, scale)
    }

    fn placed(shape: Arc<CollisionShape>, scale: f32) -> PlacedCollider {
        PlacedCollider::new(
            shape,
            LandblockPlacement {
                origin: Vector3::new(100.0, 100.0, 10.0),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(scale).unwrap(),
            StaticColliderPlacement::OutdoorGenerated { source_index: 0 },
        )
        .unwrap()
    }

    /// A tree-like cylsphere: head-on wall contact yields a radial, z-free normal.
    #[test]
    fn cylinder_wall_contact_is_radial() {
        let collider = cylinder_collider(Vector3::zero(), 0.85, 3.334, 1.0);
        let contact = volume_contact(&collider, Vector3::new(101.0, 100.0, 11.0), 0.5).unwrap();
        assert!((contact.normal - Vector3::new(1.0, 0.0, 0.0)).length() < 1e-6);
        let expected_depth = (0.85 + 0.5 - CONTACT_EPSILON) - 1.0;
        assert!((contact.depth - expected_depth).abs() < 1e-6);
    }

    #[test]
    fn cylinder_miss_outside_the_shrunk_radius_sum() {
        let collider = cylinder_collider(Vector3::zero(), 0.85, 3.334, 1.0);
        // Exactly at the un-shrunk radius sum: retail's ε shrink makes this a miss.
        assert!(volume_contact(&collider, Vector3::new(101.35, 100.0, 11.0), 0.5).is_none());
        // Above the expanded top: a miss regardless of XY overlap.
        assert!(volume_contact(&collider, Vector3::new(100.0, 100.0, 13.9), 0.5).is_none());
    }

    #[test]
    fn cylinder_top_contact_is_a_pure_cap_normal() {
        let collider = cylinder_collider(Vector3::zero(), 0.85, 3.334, 1.0);
        // Near the rim but shallowest through the top: retail produces ±Z, never a cone normal.
        let contact = volume_contact(&collider, Vector3::new(100.8, 100.0, 13.7), 0.5).unwrap();
        assert_eq!(contact.normal, Vector3::new(0.0, 0.0, 1.0));
    }

    #[test]
    fn cylinder_scale_applies_to_radius_height_and_low_point() {
        let collider = cylinder_collider(Vector3::new(1.0, 0.0, 0.0), 0.5, 2.0, 2.0);
        // Placed low point (102, 100, 10); scaled radius 1, height 4.
        assert!(volume_contact(&collider, Vector3::new(103.2, 100.0, 12.0), 0.5).is_some());
        assert!(volume_contact(&collider, Vector3::new(103.2, 100.0, 14.6), 0.5).is_none());
    }

    #[test]
    fn cylinder_support_rests_one_radius_above_the_top() {
        let collider = cylinder_collider(Vector3::zero(), 0.85, 3.0, 1.0);
        let support =
            volume_support(&collider, Vector3::new(100.2, 100.0, 14.0), 0.5, 1.5, 0.6).unwrap();
        assert_eq!(support.normal, Vector3::new(0.0, 0.0, 1.0));
        assert!((support.height_delta - (13.5 - 14.0)).abs() < 1e-6);
        assert!(matches!(support.feature, ShapeSupportFeature::Surface));
    }

    /// Retail's square-edged solid: a drop just outside the shrunk radius sum finds nothing —
    /// no rim support, no edge feature (`acclient.c:346578`).
    #[test]
    fn cylinder_support_cuts_off_sharply_at_the_radius_sum() {
        let collider = cylinder_collider(Vector3::zero(), 0.85, 3.0, 1.0);
        assert!(volume_support(&collider, Vector3::new(101.36, 100.0, 14.0), 0.5, 1.5, 0.6).is_none());
    }

    #[test]
    fn ball_contact_is_radial_with_the_shrunk_radius_sum() {
        let collider = ball_collider(Vector3::zero(), 1.0, 1.0);
        let contact = volume_contact(&collider, Vector3::new(101.2, 100.0, 10.0), 0.5).unwrap();
        assert!((contact.normal - Vector3::new(1.0, 0.0, 0.0)).length() < 1e-6);
        assert!(volume_contact(&collider, Vector3::new(101.5, 100.0, 10.0), 0.5).is_none());
    }

    #[test]
    fn ball_support_settles_on_the_spherical_cap_with_a_radial_normal() {
        let collider = ball_collider(Vector3::zero(), 1.0, 1.0);
        let support =
            volume_support(&collider, Vector3::new(100.9, 100.0, 12.0), 0.5, 1.5, 0.6).unwrap();
        // Rest distance 1.5; at dxy 0.9 the rest height is 10 + sqrt(1.5² - 0.9²) = 11.2.
        assert!((support.height_delta - (11.2 - 12.0)).abs() < 1e-5);
        // Normal leans outward on the flank; z-component is 1.2 / 1.5.
        assert!((support.normal.z - 0.8).abs() < 1e-5);
        assert!(matches!(support.feature, ShapeSupportFeature::Surface));
    }

    #[test]
    fn ball_support_misses_outside_the_cap() {
        let collider = ball_collider(Vector3::zero(), 1.0, 1.0);
        assert!(volume_support(&collider, Vector3::new(101.6, 100.0, 12.0), 0.5, 1.5, 0.6).is_none());
    }
}

#[cfg(test)]
#[path = "volume_retail_differential.rs"]
mod retail_differential;
