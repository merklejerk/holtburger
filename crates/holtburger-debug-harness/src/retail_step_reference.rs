//! Source-translated retail BSP stair admission and placement, independent of production queries.
//! This is diagnostic reference code, not a second movement implementation.

use anyhow::{Context, Result};
use holtburger_common::{Sphere, Vector3};
use holtburger_content::BspSolid;
use holtburger_dat::physics::BspNode;

/// Retail PhysicsGlobals epsilon (acclient.c:344680-344737).
pub const RETAIL_EPSILON: f32 = 0.000_2;

/// A BSP-selected retail standing candidate; this does not imply cell/placement acceptance.
pub struct SelectedPolygon {
    /// Corrected sphere in the collider's local frame.
    pub sphere: Sphere,
    /// Last admitted polygon in authored BSP traversal order.
    pub polygon: u16,
    /// Remaining source interpolation, including the admitted negative-half range.
    pub walk_interp: f32,
}

/// One StepUp-entry BSP search, starting with the interpolation established by step_down.
pub fn select_walkable(
    solid: &BspSolid,
    sphere: Sphere,
    movement: Vector3,
    up: Vector3,
    allowance: f32,
) -> Result<Option<SelectedPolygon>> {
    let mut selection = Selection {
        sphere,
        movement,
        up,
        allowance,
        walk_interp: 1.0,
        polygon: None,
    };
    selection.visit(&solid.bsp, solid)?;
    Ok(selection.polygon.map(|polygon| SelectedPolygon {
        sphere: selection.sphere,
        polygon,
        walk_interp: selection.walk_interp,
    }))
}

/// One BSP walkable search's mutable retail state, scoped to a single placed collider.
struct Selection {
    /// Candidate sphere adjusted in leaf/polygon traversal order.
    sphere: Sphere,
    /// Downward query movement computed at entry to this BSP search.
    movement: Vector3,
    /// World-up direction transformed into the collider's local axes.
    up: Vector3,
    /// Strict retail slope allowance.
    allowance: f32,
    /// Decreasing interpolation initialized by CTransition::step_down.
    walk_interp: f32,
    /// Last polygon whose adjustment was admitted by this search.
    polygon: Option<u16>,
}

impl Selection {
    /// BSPNODE/BSPLEAF::find_walkable (acclient.c:348532-348567,349100-349129),
    /// corroborated by ACE Physics/BSP/BSPNode.cs and BSPLeaf.cs.
    fn visit(&mut self, node: &BspNode, solid: &BspSolid) -> Result<()> {
        if let BspNode::Leaf(leaf) = node
            && leaf.poly_ids.is_empty()
        {
            return Ok(());
        }
        let bound = match node {
            BspNode::Leaf(node) => node.sphere,
            BspNode::Internal(node) => node.sphere,
            BspNode::Port(node) => node.sphere,
        }
        .context("retail BSP search requires the authored node sphere")?;
        if (bound.center - self.sphere.center).length_squared()
            > (bound.radius + self.sphere.radius).powi(2)
        {
            return Ok(());
        }
        match node {
            BspNode::Leaf(leaf) => {
                for id in &leaf.poly_ids {
                    let polygon = solid
                        .polygons
                        .get(id)
                        .context("BSP leaf polygon is absent")?;
                    // walkable_hits_sphere is strict, not >= (acclient.c:345595-345620).
                    if polygon.normal.dot(&self.up) <= self.allowance
                        || !finite_face_intersects(
                            &polygon.vertices,
                            polygon.normal,
                            polygon.d,
                            self.sphere,
                        )
                    {
                        continue;
                    }
                    if adjust_to_plane(
                        &mut self.sphere,
                        polygon.normal,
                        polygon.d,
                        self.movement,
                        &mut self.walk_interp,
                    ) {
                        self.polygon = Some(*id);
                    }
                }
            }
            BspNode::Internal(node) => {
                self.visit_split(node.plane, node.pos.as_deref(), node.neg.as_deref(), solid)?
            }
            // BSPPortal inherits the same collision traversal in ACE Physics/BSP/BSPPortal.cs.
            BspNode::Port(node) => {
                self.visit_split(node.plane, Some(&node.pos), Some(&node.neg), solid)?
            }
        }
        Ok(())
    }

    fn visit_split(
        &mut self,
        plane: holtburger_common::Plane,
        positive: Option<&BspNode>,
        negative: Option<&BspNode>,
        solid: &BspSolid,
    ) -> Result<()> {
        let distance = plane.distance_to_point(&self.sphere.center);
        let reach = self.sphere.radius - RETAIL_EPSILON;
        if distance > -reach {
            self.visit(
                positive.context("positive walkable branch is absent")?,
                solid,
            )?;
        }
        if distance < reach {
            self.visit(
                negative.context("negative walkable branch is absent")?,
                solid,
            )?;
        }
        Ok(())
    }
}

/// CPolygon::polygon_hits_sphere_slow_but_sure (acclient.c:345135-345254),
/// with the decompile's undefined flag comparison corroborated by ACE Polygon.cs:331-385.
pub fn finite_face_intersects(
    vertices: &[Vector3],
    normal: Vector3,
    d: f32,
    sphere: Sphere,
) -> bool {
    let distance = normal.dot(&sphere.center) + d;
    let radius = sphere.radius - RETAIL_EPSILON;
    if distance.abs() > radius {
        return false;
    }
    let disk_squared = radius * radius - distance * distance;
    let projected = sphere.center - normal * distance;
    let edges = || {
        vertices
            .iter()
            .zip(vertices.iter().cycle().skip(1))
            .take(vertices.len())
    };
    if edges().all(|(start, end)| (projected - *start).dot(&normal.cross(&(*end - *start))) >= 0.0)
    {
        return true;
    }
    for (start, end) in edges() {
        let edge = *end - *start;
        let displacement = projected - *start;
        let cross = normal.cross(&edge);
        let outside = displacement.dot(&cross);
        if outside < 0.0 {
            if cross.length_squared() * disk_squared < outside * outside {
                return false;
            }
            let along = displacement.dot(&edge);
            if along >= 0.0 && along <= edge.length_squared() {
                return true;
            }
        }
        if displacement.length_squared() <= disk_squared {
            return true;
        }
    }
    false
}

/// CPolygon::adjust_sphere_to_plane (acclient.c:344680-344737), ACE Polygon.cs:73-99.
/// Keep the interpolation decision intact; a global step-height multiplier loses this state.
fn adjust_to_plane(
    sphere: &mut Sphere,
    normal: Vector3,
    d: f32,
    movement: Vector3,
    interp: &mut f32,
) -> bool {
    let distance = normal.dot(&sphere.center) + d;
    let direction = normal.dot(&movement);
    let numerator = if direction <= RETAIL_EPSILON {
        if direction >= -RETAIL_EPSILON {
            return false;
        }
        distance - sphere.radius
    } else {
        -sphere.radius - distance
    };
    let correction_fraction = numerator / direction;
    let next = (1.0 - correction_fraction) * *interp;
    if next >= *interp || next < -0.5 {
        return false;
    }
    sphere.center = sphere.center - movement * correction_fraction;
    *interp = next;
    true
}

/// Retail final BSP placement check (acclient.c:348462-348505,349055-349074).
/// The leaf's center-solid decision deliberately precedes its bound test; this is
/// distinct from the active solver's documented solid-leaf recovery policy.
pub fn intersects_solid(
    node: &BspNode,
    solid: &BspSolid,
    sphere: Sphere,
    center_check: bool,
) -> Result<bool> {
    if let BspNode::Leaf(leaf) = node {
        if leaf.poly_ids.is_empty() {
            return Ok(false);
        }
        if center_check && leaf.solid == 1 {
            return Ok(true);
        }
    }
    let bound = match node {
        BspNode::Leaf(node) => node.sphere,
        BspNode::Internal(node) => node.sphere,
        BspNode::Port(node) => node.sphere,
    }
    .context("retail placement requires an authored node sphere")?;
    if (bound.center - sphere.center).length_squared() > (bound.radius + sphere.radius).powi(2) {
        return Ok(false);
    }
    let (plane, positive, negative) = match node {
        BspNode::Leaf(leaf) => {
            for id in &leaf.poly_ids {
                let polygon = solid
                    .polygons
                    .get(id)
                    .context("placement BSP polygon is absent")?;
                if finite_face_intersects(&polygon.vertices, polygon.normal, polygon.d, sphere) {
                    return Ok(true);
                }
            }
            return Ok(false);
        }
        BspNode::Internal(node) => (node.plane, node.pos.as_deref(), node.neg.as_deref()),
        // ACE BSPPortal inherits BSPNode's collision methods without overrides.
        BspNode::Port(node) => (node.plane, Some(&*node.pos), Some(&*node.neg)),
    };
    let distance = plane.distance_to_point(&sphere.center);
    let reach = sphere.radius - RETAIL_EPSILON;
    if distance >= reach {
        return intersects_solid(
            positive.context("positive placement branch is absent")?,
            solid,
            sphere,
            center_check,
        );
    }
    if distance <= -reach {
        return intersects_solid(
            negative.context("negative placement branch is absent")?,
            solid,
            sphere,
            center_check,
        );
    }
    Ok(intersects_solid(
        positive.context("positive placement branch is absent")?,
        solid,
        sphere,
        center_check && distance >= 0.0,
    )? || intersects_solid(
        negative.context("negative placement branch is absent")?,
        solid,
        sphere,
        center_check && distance < 0.0,
    )?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::{CollisionBox, CollisionPolygon};
    use holtburger_dat::physics::BspLeaf;
    use std::collections::HashMap;

    fn plane_solid(normal: Vector3, heights: &[f32], solid: bool) -> BspSolid {
        let tangent = Vector3::new(0.0, 1.0, 0.0) * 4.0;
        let bitangent = normal.cross(&tangent);
        let polygons = heights
            .iter()
            .enumerate()
            .map(|(id, height)| {
                let center = normal * *height;
                let vertices = vec![
                    center - tangent - bitangent,
                    center + tangent - bitangent,
                    center + tangent + bitangent,
                    center - tangent + bitangent,
                ];
                (
                    id as u16,
                    CollisionPolygon {
                        d: -normal.dot(&vertices[0]),
                        vertices,
                        normal,
                    },
                )
            })
            .collect::<HashMap<_, _>>();
        let box_bounds =
            CollisionBox::from_points(polygons.values().flat_map(|p| p.vertices.iter().copied()))
                .unwrap();
        let bounds = Sphere {
            center: box_bounds.center(),
            radius: box_bounds.circumradius(),
        };
        BspSolid {
            bsp: BspNode::Leaf(BspLeaf {
                index: 0,
                solid: solid as i32,
                sphere: Some(bounds),
                poly_ids: (0..heights.len() as u16).collect(),
            }),
            bounds,
            box_bounds,
            polygons,
        }
    }

    #[test]
    fn interpolation_admission_preserves_the_retail_negative_half_boundary() {
        for (rise, accepted) in [(0.5, true), (1.0, true), (1.5, true), (1.501, false)] {
            let mut sphere = Sphere {
                center: Vector3::new(0.0, 0.0, 1.0 - rise),
                radius: 1.0,
            };
            let mut interp = 1.0;
            assert_eq!(
                adjust_to_plane(
                    &mut sphere,
                    Vector3::new(0.0, 0.0, 1.0),
                    0.0,
                    Vector3::new(0.0, 0.0, -1.0),
                    &mut interp
                ),
                accepted
            );
        }
    }

    #[test]
    fn finite_face_admission_uses_the_intersection_disk_at_the_attempted_height() {
        let vertices = [
            Vector3::new(-2.0, 0.0, 0.0),
            Vector3::new(2.0, 0.0, 0.0),
            Vector3::new(2.0, 2.0, 0.0),
            Vector3::new(-2.0, 2.0, 0.0),
        ];
        let normal = Vector3::new(0.0, 0.0, 1.0);
        // Both centers are within the full horizontal radius of the face. Only the second
        // reaches its finite edge with the smaller disk cut by the polygon's plane.
        for (y, expected) in [(-0.9, false), (-0.7, true)] {
            assert_eq!(
                finite_face_intersects(
                    &vertices,
                    normal,
                    0.0,
                    Sphere {
                        center: Vector3::new(0.0, y, 0.6),
                        radius: 1.0
                    }
                ),
                expected
            );
        }
    }
    /// Captured 0x356F building polygon 183 and active-path attempted poses. This proves
    /// admission to the polygon stage only, not an entire retail motion transaction.
    #[test]
    fn reported_floor_rejects_the_slow_attempt_before_height_interpolation() {
        let floor = [
            Vector3::new(152.4149, 72.538, 38.4),
            Vector3::new(152.0, 72.0, 38.4),
            Vector3::new(160.0, 72.0, 38.4),
            Vector3::new(159.57031, 72.538, 38.4),
        ];
        for (center, expected) in [
            (Vector3::new(155.99902, 71.54053, 38.25213), false),
            (Vector3::new(155.99902, 71.6015, 38.300907), true),
            (Vector3::new(155.99902, 71.68281, 38.365948), true),
        ] {
            assert_eq!(
                finite_face_intersects(
                    &floor,
                    Vector3::new(0.0, 0.0, 1.0),
                    -38.4,
                    Sphere {
                        center,
                        radius: 0.48
                    }
                ),
                expected
            );
        }
    }
    #[test]
    fn interpolation_boundary_uses_neighboring_float_values_and_remaining_history() {
        let boundary = 1.5_f32;
        for (rise, expected) in [
            (f32::from_bits(boundary.to_bits() - 1), true),
            (boundary, true),
            (f32::from_bits(boundary.to_bits() + 1), false),
        ] {
            let mut sphere = Sphere {
                center: Vector3::new(0.0, 0.0, 1.0 - rise),
                radius: 1.0,
            };
            assert_eq!(
                adjust_to_plane(
                    &mut sphere,
                    Vector3::new(0.0, 0.0, 1.0),
                    0.0,
                    Vector3::new(0.0, 0.0, -1.0),
                    &mut 1.0
                ),
                expected
            );
        }
        let mut sphere = Sphere {
            center: Vector3::new(0.0, 0.0, -0.2),
            radius: 1.0,
        };
        assert!(!adjust_to_plane(
            &mut sphere,
            Vector3::new(0.0, 0.0, 1.0),
            0.0,
            Vector3::new(0.0, 0.0, -0.5),
            &mut 0.5
        ));
    }

    #[test]
    fn walkable_allowance_is_strict_at_neighboring_float_values() {
        let allowance = 0.664_174_14_f32;
        for (z, expected) in [
            (f32::from_bits(allowance.to_bits() - 1), false),
            (allowance, false),
            (f32::from_bits(allowance.to_bits() + 1), true),
        ] {
            let normal = Vector3::new((1.0 - z * z).sqrt(), 0.0, z);
            let solid = plane_solid(normal, &[0.0], false);
            let selected = select_walkable(
                &solid,
                Sphere {
                    center: normal * 0.9,
                    radius: 1.0,
                },
                Vector3::new(0.0, 0.0, -1.0),
                Vector3::new(0.0, 0.0, 1.0),
                allowance,
            )
            .unwrap();
            assert_eq!(selected.is_some(), expected);
        }
    }

    #[test]
    fn authored_polygon_order_preserves_the_interpolation_history() {
        let mut histories = Vec::new();
        for heights in [[0.2, 0.4], [0.4, 0.2]] {
            let solid = plane_solid(Vector3::new(0.0, 0.0, 1.0), &heights, false);
            let selected = select_walkable(
                &solid,
                Sphere {
                    center: Vector3::new(0.0, 0.0, 0.9),
                    radius: 1.0,
                },
                Vector3::new(0.0, 0.0, -1.0),
                Vector3::new(0.0, 0.0, 1.0),
                0.6,
            )
            .unwrap()
            .unwrap();
            assert!((selected.sphere.center.z - 1.4).abs() < RETAIL_EPSILON);
            assert_eq!(heights[selected.polygon as usize], 0.4);
            histories.push(selected.walk_interp);
        }
        assert_ne!(histories[0], histories[1]);
    }

    #[test]
    fn final_placement_checks_the_upper_sphere_independently() {
        let solid = plane_solid(Vector3::new(0.0, 0.0, -1.0), &[-2.3], false);
        for (center, radius, blocked) in [(0.5, 0.5, false), (1.9, 0.5, true)] {
            assert_eq!(
                intersects_solid(
                    &solid.bsp,
                    &solid,
                    Sphere {
                        center: Vector3::new(0.0, 0.0, center),
                        radius
                    },
                    true
                )
                .unwrap(),
                blocked
            );
        }
    }
}
