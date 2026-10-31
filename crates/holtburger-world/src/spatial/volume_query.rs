//! Sphere contacts against placed authored collision geometry.
//!
//! Retail's volume solids are square-edged Minkowski approximations, not rounded ones: a cylsphere
//! obstructs exactly the region `xy_distance <= R + r - ε` and `z ∈ [-(r - ε), H + r - ε]` around
//! its low point (`CCylSphere::collides_with_sphere`, `acclient.c:346572-346580`), and a collision
//! sphere obstructs the ball of radius `R + r - ε` (`CSphere::intersects_sphere`,
//! `acclient.c:344292-344350`). A body dropping past a cylinder rim misses it entirely rather
//! than grazing a rounded lip, so volume support uses the authored cap rather than rounded rim tangency.
//!
//! Retail resolves collision responses inside its transition machine using the pre-move center
//! (`CCylSphere::normal_of_collision`, `acclient.c:346715`: radial wall normal when that center is
//! outside the expanded radius, otherwise a pure ±Z cap normal). Our solver substeps and separates
//! penetration contacts instead, so this module maps that discrimination onto the static query
//! center by shallowest penetration axis: the same binary radial-or-cap normal structure, chosen
//! by the side the body is closest to leaving. Cone normals at rims are deliberately never
//! produced, matching retail's binary structure.

use super::SupportFeature;
use holtburger_common::Vector3;
use holtburger_content::{
    CollisionBall, CollisionBox, CollisionCylinder, CollisionShape, PlacedCollisionShape,
};

use super::bsp_query::{
    CONTACT_EPSILON, PreparedBspSupport, ShapeContact, ShapeSupport, SupportProbe,
    placed_polygon_contacts, placed_solid_contacts,
};

/// Static support geometry owned by the same immutable resident product as its authored source.
#[derive(Debug)]
pub(super) struct PreparedStaticSupport {
    /// Validated source bounds retain the existing horizontal broad-phase admission.
    bounds: CollisionBox,
    /// Placed geometry; static queries never reconstruct or rediscriminate the authored shape.
    shape: StaticSupportShape,
}

/// One complete static query kernel; volume placement constants share the resident lifetime.
#[derive(Debug)]
enum StaticSupportShape {
    Bsp(PreparedBspSupport),
    Cylinder(PlacedCylinder),
    Ball(PlacedBall),
}

impl PreparedStaticSupport {
    pub(super) fn new(collider: &PlacedCollisionShape) -> Self {
        let shape = match &*collider.shape {
            CollisionShape::Bsp(solid) => {
                StaticSupportShape::Bsp(PreparedBspSupport::new(collider, solid))
            }
            CollisionShape::Cylinder(cylinder) => {
                StaticSupportShape::Cylinder(placed_cylinder(collider, cylinder))
            }
            CollisionShape::Ball(ball) => StaticSupportShape::Ball(placed_ball(collider, ball)),
        };
        Self {
            bounds: collider.bounds,
            shape,
        }
    }

    pub(super) fn visit(
        &self,
        center: Vector3,
        radius: f32,
        probe: SupportProbe,
        found: &mut impl FnMut(ShapeSupport),
    ) {
        if !support_bounds_reach(self.bounds, center, radius) {
            return;
        }
        match &self.shape {
            StaticSupportShape::Bsp(bsp) => bsp.visit(center, radius, probe, found),
            StaticSupportShape::Cylinder(cylinder) => {
                if let Some(support) = cylinder_support(*cylinder, center, radius, probe) {
                    found(support);
                }
            }
            StaticSupportShape::Ball(ball) => {
                if let Some(support) = ball_support(*ball, center, radius, probe) {
                    found(support);
                }
            }
        }
    }
}

/// Footing is a vertical column; height admission remains with the exact shape query.
fn support_bounds_reach(bounds: CollisionBox, center: Vector3, radius: f32) -> bool {
    let minimum = bounds.minimum();
    let maximum = bounds.maximum();
    let reach = radius + CONTACT_EPSILON;
    !(center.x + reach < minimum.x
        || center.x - reach > maximum.x
        || center.y + reach < minimum.y
        || center.y - reach > maximum.y)
}

/// Emits supports directly to the consumer under shared footing and stair admission rules.
pub(super) fn visit_placed_shape_supports(
    shape: &PlacedCollisionShape,
    center: Vector3,
    radius: f32,
    probe: SupportProbe,
    found: &mut impl FnMut(ShapeSupport),
) {
    // Footing is a vertical column. The shape query owns height admission; sphere/box
    // distance would incorrectly reject sloped rims and expanded cap corners.
    if !support_bounds_reach(shape.bounds, center, radius) {
        return;
    }
    match &*shape.shape {
        CollisionShape::Bsp(solid) => {
            super::bsp_query::visit_placed_supports(shape, solid, center, radius, probe, found);
        }
        CollisionShape::Cylinder(cylinder) => {
            if let Some(support) =
                cylinder_support(placed_cylinder(shape, cylinder), center, radius, probe)
            {
                found(support);
            }
        }
        CollisionShape::Ball(ball) => {
            if let Some(support) = ball_support(placed_ball(shape, ball), center, radius, probe) {
                found(support);
            }
        }
    }
}

/// Source-neutral sphere contact against authored BSP or setup-volume geometry.
pub(crate) fn placed_shape_contacts(
    shape: &PlacedCollisionShape,
    center: Vector3,
    radius: f32,
) -> Vec<ShapeContact> {
    super::physics_work::record_shape_query();
    match &*shape.shape {
        CollisionShape::Bsp(solid) => placed_solid_contacts(shape, solid, center, radius, true)
            .into_iter()
            .chain(placed_polygon_contacts(shape, solid, center, radius))
            .collect(),
        CollisionShape::Cylinder(cylinder) => {
            placed_cylinder_contact(shape, cylinder, center, radius)
                .into_iter()
                .collect()
        }
        CollisionShape::Ball(ball) => placed_ball_contact(shape, ball, center, radius)
            .into_iter()
            .collect(),
    }
}

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

/// Uniform scale of placed volume geometry; construction rejects non-uniform volume scales, so this
/// rejects non-uniform volume scales, so this cannot fail on a constructed collider.
fn uniform_scale(collider: &PlacedCollisionShape) -> f32 {
    collider
        .scale
        .as_uniform()
        .expect("volume colliders are constructed with uniform scale")
}

fn placed_cylinder(
    collider: &PlacedCollisionShape,
    cylinder: &CollisionCylinder,
) -> PlacedCylinder {
    let scale = uniform_scale(collider);
    PlacedCylinder {
        low: collider.point_to_landblock_space(cylinder.low_point),
        radius: cylinder.radius * scale,
        height: cylinder.height * scale,
    }
}

fn placed_ball(collider: &PlacedCollisionShape, ball: &CollisionBall) -> PlacedBall {
    let scale = uniform_scale(collider);
    PlacedBall {
        center: collider.point_to_landblock_space(ball.center),
        radius: ball.radius * scale,
    }
}

/// Returns the separating contact with one placed cylinder, when the sphere overlaps it.
pub(super) fn placed_cylinder_contact(
    collider: &PlacedCollisionShape,
    cylinder: &CollisionCylinder,
    center: Vector3,
    radius: f32,
) -> Option<ShapeContact> {
    cylinder_contact(placed_cylinder(collider, cylinder), center, radius)
}

/// Returns the separating contact with one placed ball, when the sphere overlaps it.
pub(super) fn placed_ball_contact(
    collider: &PlacedCollisionShape,
    ball: &CollisionBall,
    center: Vector3,
    radius: f32,
) -> Option<ShapeContact> {
    ball_contact(placed_ball(collider, ball), center, radius)
}

/// Stable initial contact at the caller-selected query radius; this does not add a tolerance.
/// A tangent cast's iterative penetration normal can be poorly conditioned; the volume's
/// analytic closest point supplies a stable normal before attempting future impact geometry.
pub(super) fn placed_volume_sweep_contact(
    collider: &PlacedCollisionShape,
    center: Vector3,
    radius: f32,
) -> Option<ShapeContact> {
    match &*collider.shape {
        CollisionShape::Bsp(_) => None, // BSP polygons have their own oriented-plane admission.
        CollisionShape::Ball(ball) => {
            // The caller owns the query radius (hard admission or report geometry). Cancel
            // the overlap query's shrink without adding another initial-contact band.
            ball_contact(
                placed_ball(collider, ball),
                center,
                radius + CONTACT_EPSILON,
            )
        }
        CollisionShape::Cylinder(cylinder) => {
            let cylinder = placed_cylinder(collider, cylinder);
            let relative = center - cylinder.low;
            let radial = Vector3::new(relative.x, relative.y, 0.0);
            let radial_distance = radial.length();
            let closest_radial = if radial_distance > cylinder.radius {
                radial * (cylinder.radius / radial_distance)
            } else {
                radial
            };
            let closest =
                closest_radial + Vector3::new(0.0, 0.0, relative.z.clamp(0.0, cylinder.height));
            let outward = relative - closest;
            let distance = outward.length();
            if distance > radius {
                None
            } else if distance > CONTACT_EPSILON {
                Some(ShapeContact {
                    normal: outward / distance,
                    depth: (radius - distance).max(0.0),
                })
            } else {
                // Inside the cylinder, choose its nearest exit face using the existing volume
                // contact rule. Outside it, the closest point above preserves rounded sweep rims.
                cylinder_contact(cylinder, center, radius + CONTACT_EPSILON)
            }
        }
    }
}

fn cylinder_contact(
    cylinder: PlacedCylinder,
    center: Vector3,
    radius: f32,
) -> Option<ShapeContact> {
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
            normal: Vector3::new(
                displacement.x / xy_distance,
                displacement.y / xy_distance,
                0.0,
            ),
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

fn cylinder_support(
    cylinder: PlacedCylinder,
    center: Vector3,
    radius: f32,
    probe: SupportProbe,
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
    // The contact plane is the authored top, tangent sphere center one radius above.
    // Use retail's relative displacement arithmetic for both step admission and correction
    // (`acclient.c:347058`, `:346685`); world-height cancellation changes exact-limit admission.
    let height_delta = radius + cylinder.height - displacement.z;
    if !probe.admits_volume(height_delta, height_delta) {
        return None;
    }
    Some(ShapeSupport {
        normal: Vector3::new(0.0, 0.0, 1.0),
        height_delta,
        feature: radial_support_feature(displacement, cylinder.radius),
    })
}

fn ball_support(
    ball: PlacedBall,
    center: Vector3,
    radius: f32,
    probe: SupportProbe,
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
    let top_delta = rest_distance - (center.z - ball.center.z);
    if !probe.admits_volume(height_delta, top_delta) {
        return None;
    }
    let rest_center = Vector3::new(center.x, center.y, rest_z);
    Some(ShapeSupport {
        // Radial support normal at the rest pose, exactly retail's contact plane normal
        // (`acclient.c:343736` normalizes `disp` by the un-shrunk radius sum).
        normal: (rest_center - ball.center) / rest_distance,
        height_delta,
        feature: radial_support_feature(center - ball.center, ball.radius),
    })
}

/// Preserve radial edge guidance with accepted volume support, as for polygon overhangs.
fn radial_support_feature(displacement: Vector3, radius: f32) -> SupportFeature {
    let horizontal = Vector3::new(displacement.x, displacement.y, 0.0);
    if horizontal.length_squared() <= radius * radius {
        SupportFeature::Surface
    } else {
        SupportFeature::Overhang {
            inward_normal: horizontal.normalize() * -1.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use holtburger_common::Quaternion;
    use holtburger_content::{
        ColliderScale, CollisionBall, CollisionCylinder, CollisionShape, LandblockPlacement,
        PlacedCollider, StaticColliderPlacement,
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
        let mut support = None;
        visit_placed_shape_supports(
            collider,
            center,
            radius,
            SupportProbe::Column {
                maximum_drop,
                maximum_rise,
            },
            &mut |found| {
                assert!(support.is_none(), "volume has one upper support surface");
                support = Some(found);
            },
        );
        support
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
        assert!(matches!(support.feature, SupportFeature::Surface));
    }

    /// Retail's square-edged solid: a drop just outside the shrunk radius sum finds nothing —
    /// no rim support, no edge feature (`acclient.c:346578`).
    #[test]
    fn cylinder_support_cuts_off_sharply_at_the_radius_sum() {
        let collider = cylinder_collider(Vector3::zero(), 0.85, 3.0, 1.0);
        assert!(
            volume_support(&collider, Vector3::new(101.36, 100.0, 14.0), 0.5, 1.5, 0.6).is_none()
        );
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
        assert!(matches!(support.feature, SupportFeature::Surface));
    }

    #[test]
    fn ball_support_misses_outside_the_cap() {
        let collider = ball_collider(Vector3::zero(), 1.0, 1.0);
        assert!(
            volume_support(&collider, Vector3::new(101.6, 100.0, 12.0), 0.5, 1.5, 0.6).is_none()
        );
    }

    /// Both resident scenery and entity queries must preserve stair admission through scaling.
    #[test]
    fn volume_step_and_recovery_require_full_top_clearance() {
        let chest_radius = crate::spatial::differential_fixtures::PATHWARDEN_CHEST_RADIUS;
        for scale in [0.5, 1.0, 2.0] {
            let radius = 0.48 * scale;
            let origin = Vector3::new(100.0, 100.0, 10.0);
            let center = origin + Vector3::new(0.58, 0.0, 0.48) * scale;
            let shapes = [
                ball_collider(Vector3::new(0.0, 0.0, chest_radius), chest_radius, scale),
                cylinder_collider(Vector3::zero(), chest_radius, 2.0 * chest_radius, scale),
            ];
            for collider in shapes {
                let prepared = PreparedStaticSupport::new(&collider);
                // The 0.636m authored top exceeds the human's 0.6m budget. The
                // curved ball flank is reachable but must not bypass that admission.
                for (height, admitted) in [(0.6, false), (0.7, true)] {
                    for probe in [
                        SupportProbe::Stair {
                            height: height * scale,
                        },
                        SupportProbe::Standing {
                            maximum_rise: height * scale,
                        },
                    ] {
                        let mut direct = Vec::new();
                        visit_placed_shape_supports(&collider, center, radius, probe, &mut |s| {
                            direct.push(s);
                        });
                        let mut resident = Vec::new();
                        prepared.visit(center, radius, probe, &mut |s| resident.push(s));
                        assert_eq!(direct.len(), usize::from(admitted), "{probe:?}, {scale}");
                        assert_eq!(resident.len(), direct.len());
                        if let (Some(direct), Some(resident)) = (direct.first(), resident.first()) {
                            assert_eq!(resident.height_delta, direct.height_delta);
                            assert_eq!(resident.normal, direct.normal);
                        }
                    }
                }
            }
        }
    }

    /// A high sphere's walkable flank remains support even if its full top is out of reach.
    #[test]
    fn standing_on_a_ball_does_not_require_mounting_its_full_top_again() {
        let collider = ball_collider(Vector3::zero(), 2.0, 1.0);
        let radius = 0.48;
        let x = 1.8;
        let rest_z = 10.0 + ((2.0_f32 + radius).powi(2) - x * x).sqrt();
        let prepared = PreparedStaticSupport::new(&collider);
        for drop in [0.0, CONTACT_EPSILON, 0.25] {
            let center = Vector3::new(100.0 + x, 100.0, rest_z + drop);
            let mut supports = Vec::new();
            prepared.visit(
                center,
                radius,
                if drop > CONTACT_EPSILON {
                    SupportProbe::Column {
                        maximum_drop: drop,
                        maximum_rise: 0.0,
                    }
                } else {
                    SupportProbe::Standing { maximum_rise: 0.6 }
                },
                &mut |support| supports.push(support),
            );
            assert_eq!(supports.len(), 1);
            assert!(supports[0].normal.z > crate::RETAIL_WALKABLE_NORMAL_Z);
            assert!((supports[0].height_delta + drop).abs() < CONTACT_EPSILON);
        }
    }
}

#[cfg(test)]
#[path = "volume_retail_differential.rs"]
mod retail_differential;
