//! Sphere contacts against one placed authored physics BSP.
//!
//! Queries stay in landblock space. Transforming the sphere into a non-uniformly scaled setup part
//! would turn it into an ellipsoid; transforming planes and polygons instead preserves exact sphere
//! distances and normals.

use holtburger_common::{Plane, Sphere, Vector3};
use holtburger_content::{CollisionPolygon, PlacedCollider};
use holtburger_dat::physics::BspNode;

const CONTACT_EPSILON: f32 = 0.000_2;

/// One separating contact in landblock-local space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BspContact {
    /// Outward-facing unit normal.
    pub normal: Vector3,
    /// Positive displacement required along `normal` to separate the sphere.
    pub depth: f32,
}

/// One polygon surface reachable by lowering a sphere vertically.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BspSupport {
    /// Authored outward-facing unit normal.
    pub normal: Vector3,
    /// Non-negative vertical distance from the requested center to tangency.
    pub drop: f32,
    /// Horizontal inward normal while support comes from a finite polygon edge.
    pub boundary_normal: Option<Vector3>,
}

/// Two-sided polygon obstruction used only by grounded response routing.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BspPolygonObstruction {
    /// Normal facing the sphere's approach side.
    pub normal: Vector3,
    /// Positive displacement required along `normal` to clear the polygon.
    pub depth: f32,
}

/// Returns contacts with solid BSP regions reached by a placed sphere.
pub fn placed_solid_contacts(
    collider: &PlacedCollider,
    center: Vector3,
    radius: f32,
) -> Vec<BspContact> {
    let mut contacts = Vec::new();
    descend(
        &collider.shape.bsp,
        collider,
        center,
        radius,
        true,
        &mut Vec::new(),
        &mut contacts,
    );
    contacts
}

/// Returns contacts with authored BSP polygons reached by a placed sphere.
pub fn placed_polygon_contacts(
    collider: &PlacedCollider,
    center: Vector3,
    radius: f32,
) -> Vec<BspContact> {
    let mut contacts = Vec::new();
    visit_polygon_leaves(
        &collider.shape.bsp,
        collider,
        center,
        radius,
        &mut |polygon| {
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
    collider: &PlacedCollider,
    center: Vector3,
    radius: f32,
) -> Vec<BspPolygonObstruction> {
    let mut contacts = Vec::new();
    visit_polygon_leaves(
        &collider.shape.bsp,
        collider,
        center,
        radius,
        &mut |polygon| {
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
                    normal: contact.normal,
                    depth: contact.depth,
                });
            }
        },
    );
    contacts
}

/// Returns authored polygon surfaces reached by one bounded vertical settle probe.
pub fn placed_supports(
    collider: &PlacedCollider,
    center: Vector3,
    radius: f32,
    maximum_drop: f32,
) -> Vec<BspSupport> {
    let mut supports = Vec::new();
    visit_polygon_leaves(
        &collider.shape.bsp,
        collider,
        center,
        radius + maximum_drop,
        &mut |polygon| {
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
            ) {
                supports.push(support);
            }
        },
    );
    supports
}

fn descend(
    node: &BspNode,
    collider: &PlacedCollider,
    center: Vector3,
    radius: f32,
    center_check: bool,
    bounding_planes: &mut Vec<BoundingPlane>,
    contacts: &mut Vec<BspContact>,
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

fn visit_polygon_leaves(
    node: &BspNode,
    collider: &PlacedCollider,
    center: Vector3,
    radius: f32,
    found: &mut impl FnMut(&CollisionPolygon),
) {
    if !node_bounds_reach(node, collider, center, radius) {
        return;
    }
    match node {
        BspNode::Leaf(leaf) => {
            for polygon in leaf
                .poly_ids
                .iter()
                .filter_map(|polygon_id| collider.shape.polygons.get(polygon_id))
            {
                found(polygon);
            }
        }
        BspNode::Port(portal) => {
            visit_polygon_leaves(&portal.pos, collider, center, radius, found);
            visit_polygon_leaves(&portal.neg, collider, center, radius, found);
        }
        BspNode::Internal(internal) => {
            for branch in [&internal.pos, &internal.neg].into_iter().flatten() {
                visit_polygon_leaves(branch, collider, center, radius, found);
            }
        }
    }
}

fn node_bounds_reach(
    node: &BspNode,
    collider: &PlacedCollider,
    center: Vector3,
    radius: f32,
) -> bool {
    let bounds = match node {
        BspNode::Port(portal) => portal.sphere,
        BspNode::Leaf(leaf) => leaf.sphere,
        BspNode::Internal(internal) => internal.sphere,
    };
    bounds.is_none_or(|bounds| transformed_sphere(bounds, collider).intersects(&center, radius))
}

fn transformed_sphere(bounds: Sphere, collider: &PlacedCollider) -> Sphere {
    let scale = collider.scale.components();
    Sphere {
        center: collider.point_to_landblock_space(bounds.center),
        radius: bounds.radius * scale.x.max(scale.y).max(scale.z),
    }
}

fn transform_plane(plane: Plane, collider: &PlacedCollider) -> Plane {
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
) -> Option<BspContact> {
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
    Some(BspContact {
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
) -> Option<BspSupport> {
    if vertices.len() < 3 || normal.z <= CONTACT_EPSILON {
        return None;
    }
    let distance = normal.dot(&center) + plane_d;
    let face_drop = (distance - radius) / normal.z;
    let mut minimum_support = None;
    if face_drop >= -CONTACT_EPSILON && face_drop <= maximum_drop + CONTACT_EPSILON {
        let tangent_center = center - Vector3::new(0.0, 0.0, face_drop.max(0.0));
        let contact_point = tangent_center - normal * radius;
        if (0..vertices.len()).all(|index| {
            let start = vertices[index];
            let end = vertices[(index + 1) % vertices.len()];
            (contact_point - start).dot(&normal.cross(&(end - start))) >= -CONTACT_EPSILON
        }) {
            minimum_support = Some((face_drop.max(0.0), None));
        }
    }

    for index in 0..vertices.len() {
        let start = vertices[index];
        let end = vertices[(index + 1) % vertices.len()];
        if let Some(drop) = vertical_capsule_hit(center, start, end, radius, maximum_drop) {
            let hit_center = center - Vector3::new(0.0, 0.0, drop);
            if normal.dot(&hit_center) + plane_d >= -CONTACT_EPSILON {
                let closest = closest_point_on_segment(hit_center, start, end);
                let outward = Vector3::new(hit_center.x - closest.x, hit_center.y - closest.y, 0.0);
                let boundary_normal = (outward.length_squared() > CONTACT_EPSILON.powi(2))
                    .then(|| outward.normalize() * -1.0);
                if minimum_support.is_none_or(|(current, _)| drop < current) {
                    minimum_support = Some((drop, boundary_normal));
                }
            }
        }
    }

    let (drop, boundary_normal) = minimum_support?;
    Some(BspSupport {
        normal,
        drop,
        boundary_normal,
    })
}

fn vertical_capsule_hit(
    center: Vector3,
    start: Vector3,
    end: Vector3,
    radius: f32,
    maximum_drop: f32,
) -> Option<f32> {
    let edge = end - start;
    let edge_length_squared = edge.length_squared();
    if edge_length_squared <= f32::EPSILON {
        return vertical_sphere_hit(center, start, radius, maximum_drop);
    }
    let velocity = Vector3::new(0.0, 0.0, -1.0);
    let relative = center - start;
    let along_start = relative.dot(&edge) / edge_length_squared;
    let along_velocity = velocity.dot(&edge) / edge_length_squared;
    let perpendicular_start = relative - edge * along_start;
    let perpendicular_velocity = velocity - edge * along_velocity;
    let mut earliest = quadratic_first_hit(
        perpendicular_velocity.length_squared(),
        2.0 * perpendicular_start.dot(&perpendicular_velocity),
        perpendicular_start.length_squared() - radius * radius,
        maximum_drop,
    )
    .filter(|drop| {
        let along = along_start + along_velocity * *drop;
        (-CONTACT_EPSILON..=1.0 + CONTACT_EPSILON).contains(&along)
    });
    for endpoint in [start, end] {
        if let Some(drop) = vertical_sphere_hit(center, endpoint, radius, maximum_drop) {
            earliest = Some(earliest.map_or(drop, |current| current.min(drop)));
        }
    }
    earliest
}

fn vertical_sphere_hit(
    center: Vector3,
    point: Vector3,
    radius: f32,
    maximum_drop: f32,
) -> Option<f32> {
    let relative = center - point;
    quadratic_first_hit(
        1.0,
        -2.0 * relative.z,
        relative.length_squared() - radius * radius,
        maximum_drop,
    )
}

fn quadratic_first_hit(a: f32, b: f32, c: f32, maximum: f32) -> Option<f32> {
    if a <= f32::EPSILON {
        return None;
    }
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return None;
    }
    let root = discriminant.sqrt();
    [(-b - root) / (2.0 * a), (-b + root) / (2.0 * a)]
        .into_iter()
        .filter(|value| *value >= -CONTACT_EPSILON && *value <= maximum + CONTACT_EPSILON)
        .map(|value| value.max(0.0))
        .min_by(f32::total_cmp)
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
) -> Option<BspContact> {
    let mut shallowest: Option<BspContact> = None;
    for plane in bounding_planes {
        let distance = plane.normal.dot(&center) + plane.d;
        if distance > radius {
            return None;
        }
        let depth = radius - distance;
        if shallowest.is_none_or(|current| depth < current.depth) {
            shallowest = Some(BspContact {
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
        PlacedCollider {
            shape: Arc::new(CollisionShape {
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
                box_bounds: CollisionBox::from_points([
                    Vector3::new(-10.0, -10.0, -10.0),
                    Vector3::new(10.0, 10.0, 10.0),
                ])
                .unwrap(),
                polygons: HashMap::new(),
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

    #[test]
    fn radius_only_solid_leaf_reach_is_not_center_penetration() {
        let collider = split_solid();
        assert!(
            placed_solid_contacts(&collider, Vector3::new(0.75, 0.0, 0.0), 1.0).is_empty(),
            "radius-only traversal classified the empty-side center as solid"
        );

        let inside = placed_solid_contacts(&collider, Vector3::new(-0.25, 0.0, 0.0), 1.0);
        assert_eq!(inside.len(), 1, "solid-side center lost its contact");
        assert_eq!(inside[0].normal, Vector3::new(1.0, 0.0, 0.0));
    }
}
