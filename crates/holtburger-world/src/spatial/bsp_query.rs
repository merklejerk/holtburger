//! Sphere contacts against one placed authored physics BSP.
//!
//! Queries stay in landblock space. Transforming the sphere into a non-uniformly scaled setup part
//! would turn it into an ellipsoid; transforming planes and polygons instead preserves exact sphere
//! distances and normals.
//!
//! The `Shape*` result types are shared with `volume_query`: both narrow phases report the same
//! contact and support vocabulary to the scene's dispatch.

use holtburger_common::{Plane, Sphere, Vector3};
use holtburger_content::{BspSolid, CollisionPolygon, PlacedCollisionShape};
use holtburger_dat::physics::BspNode;

use super::SupportFeature;

/// Retail's contact epsilon, shared by the BSP and volume narrow phases. The decompile prints it
/// as `0.00019999999`, the shortest decimal form of the same f32 bit pattern (0x3951B717) this
/// literal produces — they are one constant (`acclient.c:346579`, `:344345`, `:347138`).
pub(super) const CONTACT_EPSILON: f32 = 0.000_2;

/// One separating contact in landblock-local space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShapeContact {
    /// Outward-facing unit normal.
    pub normal: Vector3,
    /// Positive displacement required along `normal` to separate the sphere.
    pub depth: f32,
}

/// One polygon surface reachable by lowering a sphere vertically.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShapeSupport {
    /// Authored outward-facing unit normal.
    pub normal: Vector3,
    /// Signed vertical correction from the requested center to tangency; positive rises.
    pub height_delta: f32,
    /// Authored feature reached by the bounded vertical probe.
    pub feature: SupportFeature,
}

/// Two-sided polygon obstruction used only by grounded response routing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BspPolygonObstruction {
    /// Radial sphere-to-polygon contact used only to separate overlapping geometry.
    pub separation: ShapeContact,
    /// Authored polygon normal; grounded response decides which side faces the body.
    pub polygon_normal: Vector3,
}

/// Returns contacts with solid BSP regions reached by a placed sphere.
pub fn placed_solid_contacts(
    collider: &PlacedCollisionShape,
    solid: &BspSolid,
    center: Vector3,
    radius: f32,
    center_solid: bool,
) -> Vec<ShapeContact> {
    let mut contacts = Vec::new();
    descend(
        &solid.bsp,
        collider,
        center,
        radius,
        center_solid,
        &mut Vec::new(),
        &mut contacts,
    );
    contacts
}

/// Returns contacts with authored BSP polygons reached by a placed sphere.
pub fn placed_polygon_contacts(
    collider: &PlacedCollisionShape,
    solid: &BspSolid,
    center: Vector3,
    radius: f32,
) -> Vec<ShapeContact> {
    let mut contacts = Vec::new();
    visit_polygon_leaves(
        &solid.bsp,
        solid,
        &|node| node_bounds_reach(node, collider, center, radius),
        &mut |_, polygon| {
            let vertices = polygon
                .vertices
                .iter()
                .map(|vertex| collider.point_to_landblock_space(*vertex))
                .collect::<Vec<_>>();
            let plane = transform_plane(
                Plane {
                    normal: polygon.normal,
                    d: polygon.d,
                },
                collider,
            );
            let normal = plane.normal;
            let plane_d = plane.d;
            if let Some(contact) =
                polygon_sphere_contact(&vertices, normal, plane_d, center, radius)
                && normal.dot(&contact.normal) > 0.0
            {
                contacts.push(contact);
            }
        },
    );
    contacts
}

/// Returns two-sided authored polygon contacts without discarding back-face identity.
pub fn placed_polygon_obstructions(
    collider: &PlacedCollisionShape,
    solid: &BspSolid,
    center: Vector3,
    radius: f32,
) -> Vec<BspPolygonObstruction> {
    let mut contacts = Vec::new();
    visit_polygon_leaves(
        &solid.bsp,
        solid,
        &|node| node_bounds_reach(node, collider, center, radius),
        &mut |_, polygon| {
            let vertices = polygon
                .vertices
                .iter()
                .map(|vertex| collider.point_to_landblock_space(*vertex))
                .collect::<Vec<_>>();
            let plane = transform_plane(
                Plane {
                    normal: polygon.normal,
                    d: polygon.d,
                },
                collider,
            );
            if let Some(contact) =
                polygon_sphere_contact(&vertices, plane.normal, plane.d, center, radius)
            {
                contacts.push(BspPolygonObstruction {
                    separation: contact,
                    polygon_normal: plane.normal,
                });
            }
        },
    );
    contacts
}

/// Returns authored polygon surfaces reached by one bounded vertical settle probe.
pub fn placed_supports(
    collider: &PlacedCollisionShape,
    solid: &BspSolid,
    center: Vector3,
    radius: f32,
    maximum_drop: f32,
    maximum_rise: f32,
) -> Vec<ShapeSupport> {
    let mut supports = Vec::new();
    visit_polygon_leaves(
        &solid.bsp,
        solid,
        &|node| {
            node_bounds(node).is_none_or(|bounds| {
                let bounds = transformed_sphere(bounds, collider);
                let delta = bounds.center - center;
                delta.x * delta.x + delta.y * delta.y
                    <= (bounds.radius + radius + CONTACT_EPSILON).powi(2)
            })
        },
        &mut |_, polygon| {
            let vertices = polygon
                .vertices
                .iter()
                .map(|vertex| collider.point_to_landblock_space(*vertex))
                .collect::<Vec<_>>();
            let plane = transform_plane(
                Plane {
                    normal: polygon.normal,
                    d: polygon.d,
                },
                collider,
            );
            if let Some(support) = support_on_polygon(
                &vertices,
                plane.normal,
                plane.d,
                center,
                radius,
                maximum_drop,
                maximum_rise,
            ) {
                supports.push(support);
            }
        },
    );
    supports
}

fn descend(
    node: &BspNode,
    collider: &PlacedCollisionShape,
    center: Vector3,
    radius: f32,
    center_check: bool,
    bounding_planes: &mut Vec<BoundingPlane>,
    contacts: &mut Vec<ShapeContact>,
) {
    if !node_bounds_reach(node, collider, center, radius) {
        return;
    }
    match node {
        BspNode::Leaf(leaf) => {
            // Retail threads this same center-side discriminator through `sphere_intersects_solid`
            // (`acclient.c:348462-348490`, leaf handling at `:349055`). A radius-only branch checks
            // its authored polygons instead of treating the whole solid leaf as penetration. Our
            // separate polygon query already owns those finite contacts; preserving only the
            // center-containing solid classification here avoids false contacts at BSP partitions.
            // Correcting the old unconditional leaf hit removes phantom wedges where a sphere
            // reached a solid leaf's bounds without reaching any authored surface. The focused
            // 0xDA55FFFF census found this at the two equivalent 0x13E/0x14D and 0x14E/0x15D seams.
            if center_check
                && leaf.solid == 1
                && let Some(contact) = shallowest_contact(bounding_planes, center, radius)
            {
                contacts.push(contact);
            }
        }
        BspNode::Port(portal) => {
            let plane = transform_plane(portal.plane, collider);
            let distance = plane.distance_to_point(&center);
            if distance > -radius {
                bounding_planes.push(BoundingPlane::positive(plane));
                descend(
                    &portal.pos,
                    collider,
                    center,
                    radius,
                    center_check && distance >= 0.0,
                    bounding_planes,
                    contacts,
                );
                bounding_planes.pop();
            }
            if distance < radius {
                bounding_planes.push(BoundingPlane::negative(plane));
                descend(
                    &portal.neg,
                    collider,
                    center,
                    radius,
                    center_check && distance < 0.0,
                    bounding_planes,
                    contacts,
                );
                bounding_planes.pop();
            }
        }
        BspNode::Internal(internal) => {
            let plane = transform_plane(internal.plane, collider);
            let distance = plane.distance_to_point(&center);
            if distance > -radius
                && let Some(positive) = &internal.pos
            {
                bounding_planes.push(BoundingPlane::positive(plane));
                descend(
                    positive,
                    collider,
                    center,
                    radius,
                    center_check && distance >= 0.0,
                    bounding_planes,
                    contacts,
                );
                bounding_planes.pop();
            }
            if distance < radius
                && let Some(negative) = &internal.neg
            {
                bounding_planes.push(BoundingPlane::negative(plane));
                descend(
                    negative,
                    collider,
                    center,
                    radius,
                    center_check && distance < 0.0,
                    bounding_planes,
                    contacts,
                );
                bounding_planes.pop();
            }
        }
    }
}

/// Stable polygon candidates for a sphere enclosing a query's complete swept volume.
/// Shared leaf references are deduplicated before expensive shape casts.
pub(super) fn sphere_polygon_candidates(
    solid: &BspSolid,
    collider: &PlacedCollisionShape,
    center: Vector3,
    radius: f32,
) -> Vec<u16> {
    let mut ids = Vec::new();
    visit_polygon_leaves(
        &solid.bsp,
        solid,
        &|node| node_bounds_reach(node, collider, center, radius),
        &mut |id, _| ids.push(id),
    );
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn visit_polygon_leaves(
    node: &BspNode,
    solid: &BspSolid,
    intersects: &impl Fn(&BspNode) -> bool,
    found: &mut impl FnMut(u16, &CollisionPolygon),
) {
    if !intersects(node) {
        return;
    }
    match node {
        BspNode::Leaf(leaf) => {
            for id in &leaf.poly_ids {
                if let Some(polygon) = solid.polygons.get(id) {
                    found(*id, polygon);
                }
            }
        }
        BspNode::Port(portal) => {
            visit_polygon_leaves(&portal.pos, solid, intersects, found);
            visit_polygon_leaves(&portal.neg, solid, intersects, found);
        }
        BspNode::Internal(internal) => {
            for branch in [&internal.pos, &internal.neg].into_iter().flatten() {
                visit_polygon_leaves(branch, solid, intersects, found);
            }
        }
    }
}

fn node_bounds_reach(
    node: &BspNode,
    collider: &PlacedCollisionShape,
    center: Vector3,
    radius: f32,
) -> bool {
    node_bounds(node)
        .is_none_or(|bounds| transformed_sphere(bounds, collider).intersects(&center, radius))
}

/// Optional authored bounds; absence requires visiting the branch.
fn node_bounds(node: &BspNode) -> Option<Sphere> {
    match node {
        BspNode::Port(portal) => portal.sphere,
        BspNode::Leaf(leaf) => leaf.sphere,
        BspNode::Internal(internal) => internal.sphere,
    }
}

fn transformed_sphere(bounds: Sphere, collider: &PlacedCollisionShape) -> Sphere {
    let scale = collider.scale.components();
    Sphere {
        center: collider.point_to_landblock_space(bounds.center),
        radius: bounds.radius * scale.x.max(scale.y).max(scale.z),
    }
}

fn transform_plane(plane: Plane, collider: &PlacedCollisionShape) -> Plane {
    let normal = collider.normal_to_landblock_space(plane.normal);
    let local_point = plane.normal * (-plane.d / plane.normal.length_squared());
    let point = collider.point_to_landblock_space(local_point);
    Plane {
        normal,
        d: -normal.dot(&point),
    }
}

fn polygon_sphere_contact(
    vertices: &[Vector3],
    normal: Vector3,
    plane_d: f32,
    center: Vector3,
    radius: f32,
) -> Option<ShapeContact> {
    if vertices.len() < 3 {
        return None;
    }
    let distance = normal.dot(&center) + plane_d;
    let reach = radius - CONTACT_EPSILON;
    if distance.abs() > reach {
        return None;
    }
    let projected = center - normal * distance;
    let mut outside = false;
    let mut nearest = projected;
    let mut nearest_squared = f32::INFINITY;
    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        let edge = end - start;
        if (projected - start).dot(&normal.cross(&edge)) < 0.0 {
            outside = true;
        }
        let candidate = closest_point_on_segment(projected, start, end);
        let candidate_squared = (projected - candidate).length_squared();
        if candidate_squared < nearest_squared {
            nearest = candidate;
            nearest_squared = candidate_squared;
        }
    }
    let closest = if outside { nearest } else { projected };
    let separation = center - closest;
    let separation_length = separation.length();
    if separation_length >= reach {
        return None;
    }
    let contact_normal = if separation_length > CONTACT_EPSILON {
        separation / separation_length
    } else if distance >= 0.0 {
        normal
    } else {
        normal * -1.0
    };
    Some(ShapeContact {
        normal: contact_normal,
        depth: radius - separation_length,
    })
}

pub(super) fn support_on_polygon(
    vertices: &[Vector3],
    normal: Vector3,
    plane_d: f32,
    center: Vector3,
    radius: f32,
    maximum_drop: f32,
    maximum_rise: f32,
) -> Option<ShapeSupport> {
    if vertices.len() < 3 || normal.z <= CONTACT_EPSILON {
        return None;
    }
    let height_delta = (radius - normal.dot(&center) - plane_d) / normal.z;
    if height_delta < -maximum_drop - CONTACT_EPSILON
        || height_delta > maximum_rise + CONTACT_EPSILON
    {
        return None;
    }
    let feature = polygon_footprint(vertices, center, radius)?;
    Some(ShapeSupport {
        normal,
        height_delta,
        feature,
    })
}

/// Horizontal footing is invariant under applying a candidate's vertical adjustment.
/// RETAIL DIVERGENCE: `acclient.c:345329–345510,302082–302090` checks a projected
/// polygon footprint, ordinarily with half-radius. We use a full-radius horizontal disk
/// consistently for standing and stair entry; restoring the narrower/transient rules can
/// strand the first bounded stair step. The asset-free footing gate covers seams, corners,
/// slopes and a 0.3m stair. The template/setup census covers preparation, not every authored
/// stair or ledge; full support-geometry coverage is not claimed.
fn polygon_footprint(vertices: &[Vector3], center: Vector3, radius: f32) -> Option<SupportFeature> {
    let horizontal = |v: Vector3| Vector3::new(v.x, v.y, 0.0);
    let point = horizontal(center);
    let mut inside = true;
    let mut nearest = None::<Vector3>;
    for (index, start) in vertices.iter().enumerate() {
        let start = horizontal(*start);
        let end = horizontal(vertices[(index + 1) % vertices.len()]);
        let edge = end - start;
        let length = edge.length();
        if length <= CONTACT_EPSILON {
            continue;
        }
        let inward = Vector3::new(-edge.y, edge.x, 0.0) / length;
        inside &= (point - start).dot(&inward) >= -CONTACT_EPSILON;
        let offset = closest_point_on_segment(point, start, end) - point;
        if nearest.is_none_or(|old| offset.length_squared() < old.length_squared()) {
            nearest = Some(offset);
        }
    }
    let offset = nearest?;
    if inside {
        return Some(SupportFeature::Surface);
    }
    let distance = offset.length();
    (distance <= radius + CONTACT_EPSILON).then(|| SupportFeature::Overhang {
        inward_normal: offset / distance,
    })
}

fn closest_point_on_segment(point: Vector3, start: Vector3, end: Vector3) -> Vector3 {
    let segment = end - start;
    let length_squared = segment.length_squared();
    if length_squared <= f32::EPSILON {
        return start;
    }
    let along = ((point - start).dot(&segment) / length_squared).clamp(0.0, 1.0);
    start + segment * along
}

#[derive(Debug, Clone, Copy)]
struct BoundingPlane {
    normal: Vector3,
    d: f32,
}

impl BoundingPlane {
    fn positive(plane: Plane) -> Self {
        Self {
            normal: plane.normal * -1.0,
            d: -plane.d,
        }
    }

    fn negative(plane: Plane) -> Self {
        Self {
            normal: plane.normal,
            d: plane.d,
        }
    }
}

fn shallowest_contact(
    bounding_planes: &[BoundingPlane],
    center: Vector3,
    radius: f32,
) -> Option<ShapeContact> {
    let mut shallowest: Option<ShapeContact> = None;
    for plane in bounding_planes {
        let distance = plane.normal.dot(&center) + plane.d;
        if distance > radius {
            return None;
        }
        let depth = radius - distance;
        if shallowest.is_none_or(|current| depth < current.depth) {
            shallowest = Some(ShapeContact {
                normal: plane.normal,
                depth,
            });
        }
    }
    shallowest
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use holtburger_common::{Quaternion, Sphere};
    use holtburger_content::{
        ColliderScale, CollisionBox, CollisionShape, LandblockPlacement, PlacedCollider,
        StaticColliderPlacement,
    };
    use holtburger_dat::physics::{BspLeaf, InternalNode};

    use super::*;

    fn split_solid() -> PlacedCollider {
        let bounds = Sphere {
            center: Vector3::zero(),
            radius: 10.0,
        };
        let empty = BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: None,
            poly_ids: Vec::new(),
        });
        let solid = BspNode::Leaf(BspLeaf {
            index: 1,
            solid: 1,
            sphere: None,
            poly_ids: vec![1],
        });
        let box_bounds = CollisionBox::from_points([
            Vector3::new(-10.0, -10.0, -10.0),
            Vector3::new(10.0, 10.0, 10.0),
        ])
        .unwrap();
        PlacedCollider {
            geometry: holtburger_content::PlacedCollisionShape {
                shape: Arc::new(CollisionShape::Bsp(BspSolid {
                    bsp: BspNode::Internal(InternalNode {
                        tag: *b"BPnn",
                        plane: Plane {
                            normal: Vector3::new(1.0, 0.0, 0.0),
                            d: 0.0,
                        },
                        pos: Some(Box::new(empty)),
                        neg: Some(Box::new(solid)),
                        sphere: Some(bounds),
                        poly_ids: Vec::new(),
                    }),
                    bounds,
                    box_bounds,
                    polygons: HashMap::new(),
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

    #[test]
    fn radius_only_solid_leaf_reach_is_not_center_penetration() {
        let collider = split_solid();
        let solid = collider.shape.as_bsp().unwrap();
        assert!(
            placed_solid_contacts(&collider, solid, Vector3::new(0.75, 0.0, 0.0), 1.0, true)
                .is_empty(),
            "radius-only traversal classified the empty-side center as solid"
        );

        let inside =
            placed_solid_contacts(&collider, solid, Vector3::new(-0.25, 0.0, 0.0), 1.0, true);
        assert_eq!(inside.len(), 1, "solid-side center lost its contact");
        assert_eq!(inside[0].normal, Vector3::new(1.0, 0.0, 0.0));
        assert!(
            placed_solid_contacts(&collider, solid, Vector3::new(-0.25, 0.0, 0.0), 1.0, false)
                .is_empty(),
            "disabled center-solid classification still treated the leaf interior as obstruction"
        );
    }
}
