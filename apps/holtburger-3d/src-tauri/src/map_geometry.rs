//! Derived overhead-map geometry: walkable floors and blocker silhouettes.
//!
//! The overhead map renders walkability, not scenery, so this module reduces authored physics
//! polygons to two shapes: up-facing walkable floor triangles (interior cells) and whole-object
//! silhouette triangles (outdoor building blockers). Raw physics polygons and physics BSPs never
//! cross the host boundary; these derived triangle lists are the only map-collision contract.

use std::collections::{HashMap, HashSet};

use anyhow::{Result, ensure};
use holtburger_common::Vector3;
use holtburger_dat::graphics::{CVertexArray, Polygon};
use holtburger_world::RETAIL_WALKABLE_NORMAL_Z;

use crate::polygon_geometry::{CULL_MODE_COUNTER_CLOCKWISE, CULL_MODE_LANDBLOCK};

/// Positions-and-indices mesh in structure/object-local render coordinates.
///
/// Deliberately carries no normals, UVs, or materials: the map shader flat-colors it and derives
/// slope shading from position gradients.
#[derive(Debug, Default, PartialEq)]
pub struct MapMeshGeometry {
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
}

impl MapMeshGeometry {
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }
}

/// Select the up-facing walkable subset of a physics polygon set.
///
/// Retail walkability is `normal.z >= PhysicsGlobals::floor_z` in the gravity frame
/// (`acclient.c:304992-304995`); [`RETAIL_WALKABLE_NORMAL_Z`] carries that constant. The filter
/// runs on AC-frame face normals in object-local space, so every consuming placement must preserve
/// the up axis — the record serializer enforces that per placement.
pub fn build_walkable_floor_geometry(
    vertex_array: &CVertexArray,
    physics_polygons: &HashMap<u16, Polygon>,
) -> Result<MapMeshGeometry> {
    build_map_mesh(vertex_array, physics_polygons, |_, polygon, normal| {
        let mut windings = Vec::with_capacity(2);
        if normal.z >= RETAIL_WALKABLE_NORMAL_Z {
            windings.push(FanWinding::Source);
        }
        // A double-sided polygon whose underside faces up is walkable from above.
        if polygon_is_double_sided(polygon) && -normal.z >= RETAIL_WALKABLE_NORMAL_Z {
            windings.push(FanWinding::Reversed);
        }
        windings
    })
}

/// Flatten a physics polygon set into one silhouette mesh, skipping excluded polygon ids.
///
/// The exclusion set names doorway/portal polygons so building entrances stay open on the map.
/// Winding is irrelevant to the top-down silhouette stamp, so each polygon is emitted once.
pub fn build_blocker_silhouette_geometry(
    vertex_array: &CVertexArray,
    physics_polygons: &HashMap<u16, Polygon>,
    excluded_polygon_ids: &HashSet<u16>,
) -> Result<MapMeshGeometry> {
    build_map_mesh(vertex_array, physics_polygons, |polygon_id, _, _| {
        if excluded_polygon_ids.contains(&polygon_id) {
            Vec::new()
        } else {
            vec![FanWinding::Source]
        }
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FanWinding {
    Source,
    Reversed,
}

fn build_map_mesh(
    vertex_array: &CVertexArray,
    physics_polygons: &HashMap<u16, Polygon>,
    mut select_windings: impl FnMut(u16, &Polygon, Vector3) -> Vec<FanWinding>,
) -> Result<MapMeshGeometry> {
    let mut geometry = MapMeshGeometry::default();
    let mut polygons = physics_polygons.iter().collect::<Vec<_>>();
    polygons.sort_by_key(|(polygon_id, _)| **polygon_id);
    for (polygon_id, polygon) in polygons {
        ensure!(
            polygon.vertex_ids.len() >= 3,
            "physics polygon {polygon_id} has fewer than three vertices"
        );
        let corners = polygon
            .vertex_ids
            .iter()
            .map(|vertex_id| {
                let vertex = vertex_array.vertices.get(vertex_id).ok_or_else(|| {
                    anyhow::anyhow!(
                        "physics polygon {polygon_id} references missing vertex {vertex_id}"
                    )
                })?;
                ensure!(
                    [vertex.origin.x, vertex.origin.y, vertex.origin.z]
                        .into_iter()
                        .all(f32::is_finite),
                    "physics polygon {polygon_id} vertex {vertex_id} has a non-finite position"
                );
                Ok(vertex.origin)
            })
            .collect::<Result<Vec<_>>>()?;
        let Some(normal) = newell_face_normal(&corners) else {
            // A zero-area physics polygon contributes nothing to the map.
            continue;
        };
        for winding in select_windings(*polygon_id, polygon, normal) {
            append_fan(&corners, winding, &mut geometry);
        }
    }
    Ok(geometry)
}

/// Newell's method: robust polygon face normal in the AC (Z-up) frame, or `None` for zero area.
fn newell_face_normal(corners: &[Vector3]) -> Option<Vector3> {
    let mut normal = Vector3::new(0.0, 0.0, 0.0);
    for (index, current) in corners.iter().enumerate() {
        let next = &corners[(index + 1) % corners.len()];
        normal.x += (current.y - next.y) * (current.z + next.z);
        normal.y += (current.z - next.z) * (current.x + next.x);
        normal.z += (current.x - next.x) * (current.y + next.y);
    }
    let length = normal.length();
    (length > 0.0 && length.is_finite()).then(|| normal / length)
}

fn append_fan(corners: &[Vector3], winding: FanWinding, geometry: &mut MapMeshGeometry) {
    let base = u32::try_from(geometry.vertex_count()).expect("map mesh exceeds u32 vertex space");
    for corner in corners {
        let render = crate::polygon_geometry::ac_to_render(*corner);
        geometry.positions.extend([render.x, render.y, render.z]);
    }
    for fan_index in 1..(corners.len() - 1) {
        let fan_index = u32::try_from(fan_index).expect("polygon corner count fits u32");
        let (second, third) = match winding {
            FanWinding::Source => (fan_index, fan_index + 1),
            FanWinding::Reversed => (fan_index + 1, fan_index),
        };
        geometry.indices.extend([base, base + second, base + third]);
    }
}

/// Whether a physics polygon collides from both sides, mirroring the drawing-side expansion:
/// `None` and `Clockwise` polygons own a second side; `Landblock` and `CounterClockwise` do not.
fn polygon_is_double_sided(polygon: &Polygon) -> bool {
    !matches!(
        polygon.sides_type,
        CULL_MODE_LANDBLOCK | CULL_MODE_COUNTER_CLOCKWISE
    )
}

#[cfg(test)]
mod tests {
    use holtburger_dat::graphics::SWVertex;

    use super::*;

    const WALKABLE_EPSILON: f32 = 1.0e-3;

    fn vertex(origin: Vector3) -> SWVertex {
        SWVertex {
            num_uvs: 0,
            origin,
            normal: Vector3::new(0.0, 0.0, 1.0),
            uvs: Vec::new(),
        }
    }

    fn vertex_array(origins: &[Vector3]) -> CVertexArray {
        CVertexArray {
            vertex_type: 1,
            vertices: origins
                .iter()
                .enumerate()
                .map(|(index, origin)| (index as u16, vertex(*origin)))
                .collect(),
        }
    }

    fn polygon(vertex_ids: Vec<u16>, sides_type: i32) -> Polygon {
        Polygon {
            num_pts: vertex_ids.len() as u8,
            stippling: 0,
            sides_type,
            pos_surface: -1,
            neg_surface: -1,
            vertex_ids,
            pos_uv_indices: Vec::new(),
            neg_uv_indices: Vec::new(),
        }
    }

    /// Unit right triangle in the AC XY plane, up-facing with counter-clockwise winding.
    fn flat_floor_corners() -> [Vector3; 3] {
        [
            Vector3::new(0.0, 0.0, 1.0),
            Vector3::new(1.0, 0.0, 1.0),
            Vector3::new(0.0, 1.0, 1.0),
        ]
    }

    /// Tilt whose face normal z sits just below or above the retail walkable threshold.
    fn ramp_corners(normal_z: f32) -> [Vector3; 3] {
        // Rotate the flat floor about the AC X axis until the normal has the requested z.
        let angle = normal_z.acos();
        let (sin, cos) = angle.sin_cos();
        [
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, cos, sin),
        ]
    }

    #[test]
    fn keeps_up_facing_floor_and_drops_walls_and_ceilings() {
        let corners = flat_floor_corners();
        let wall = [
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 1.0),
        ];
        let array = vertex_array(&[
            corners[0], corners[1], corners[2], wall[0], wall[1], wall[2],
        ]);
        let polygons = HashMap::from([
            (0, polygon(vec![0, 1, 2], CULL_MODE_COUNTER_CLOCKWISE)),
            // Same floor reversed: a down-facing single-sided ceiling.
            (1, polygon(vec![2, 1, 0], CULL_MODE_COUNTER_CLOCKWISE)),
            (2, polygon(vec![3, 4, 5], CULL_MODE_COUNTER_CLOCKWISE)),
        ]);

        let floor = build_walkable_floor_geometry(&array, &polygons).unwrap();

        assert_eq!(floor.vertex_count(), 3);
        assert_eq!(floor.indices, vec![0, 1, 2]);
        // The kept triangle is the up-facing floor at z=1, converted to render coordinates (y-up).
        assert_eq!(floor.positions[1], 1.0);
    }

    #[test]
    fn walkable_threshold_matches_retail_floor_z_exactly() {
        let barely_walkable = ramp_corners(RETAIL_WALKABLE_NORMAL_Z + WALKABLE_EPSILON);
        let too_steep = ramp_corners(RETAIL_WALKABLE_NORMAL_Z - WALKABLE_EPSILON);
        for (corners, expected_triangles) in [(barely_walkable, 1), (too_steep, 0)] {
            let array = vertex_array(&corners);
            let polygons =
                HashMap::from([(0, polygon(vec![0, 1, 2], CULL_MODE_COUNTER_CLOCKWISE))]);
            let floor = build_walkable_floor_geometry(&array, &polygons).unwrap();
            assert_eq!(floor.indices.len() / 3, expected_triangles);
        }
    }

    #[test]
    fn double_sided_underside_is_walkable_with_reversed_winding() {
        // Down-facing winding, but double-sided: its underside faces up and is walkable.
        let corners = flat_floor_corners();
        let array = vertex_array(&corners);
        let polygons = HashMap::from([(
            0,
            polygon(vec![2, 1, 0], crate::polygon_geometry::CULL_MODE_NONE),
        )]);

        let floor = build_walkable_floor_geometry(&array, &polygons).unwrap();

        assert_eq!(floor.indices, vec![0, 2, 1]);
    }

    #[test]
    fn blocker_silhouette_excludes_portal_polygons() {
        let corners = flat_floor_corners();
        let wall = [
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 1.0),
        ];
        let array = vertex_array(&[
            corners[0], corners[1], corners[2], wall[0], wall[1], wall[2],
        ]);
        let polygons = HashMap::from([
            (7, polygon(vec![0, 1, 2], CULL_MODE_COUNTER_CLOCKWISE)),
            (9, polygon(vec![3, 4, 5], CULL_MODE_COUNTER_CLOCKWISE)),
        ]);

        let blockers =
            build_blocker_silhouette_geometry(&array, &polygons, &HashSet::from([9])).unwrap();

        assert_eq!(blockers.indices.len() / 3, 1);
        assert_eq!(blockers.vertex_count(), 3);
    }

    #[test]
    fn quads_fan_triangulate() {
        let array = vertex_array(&[
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(1.0, 1.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
        ]);
        let polygons = HashMap::from([(0, polygon(vec![0, 1, 2, 3], CULL_MODE_COUNTER_CLOCKWISE))]);

        let floor = build_walkable_floor_geometry(&array, &polygons).unwrap();

        assert_eq!(floor.indices, vec![0, 1, 2, 0, 2, 3]);
    }
}
