use anyhow::{Result, ensure};
use holtburger_common::{Plane, Quaternion, Vector3};
use holtburger_content::LandblockPlacement;
use holtburger_dat::graphics::{CVertexArray, Polygon};

use crate::polygon_geometry::{RenderAabb, RenderVec3, ac_to_render};

/// Retail's portal-plane side tolerance, shared by projection and later portal queries.
pub const PORTAL_PLANE_EPSILON: f32 = 0.0002;

/// Budget for authored slop between a portal polygon's vertices and its own averaged plane.
///
/// Retail never validates this: `CPolygon::make_plane` (`acclient.c:344776`) builds the averaged
/// plane and clips against it unconditionally. We validate anyway so a malformed decode fails
/// loudly rather than producing a silently wrong aperture, which means the budget has to admit
/// every polygon the shipped archive actually authors.
///
/// Sized against the complete authored population rather than a sample. Across all 772
/// Environments in the unpruned portal namespace, 7,997 CellStruct portal polygons deviate by at
/// most `0.0025`; 7,993 of them stay under `0.0005`. The four outliers are all in Environment
/// `0x0D000573`, whose two diagonal apertures place one quad corner at `x = -8.15` while the other
/// three sit at `x = -8.14` — a one-centimetre authoring typo in cells roughly ten metres across.
/// The separate 910-piece GfxObj building aperture census peaks at `0.00039577`. This value leaves
/// roughly 2x headroom over the worst authored case and still sits far below any deviation a
/// player could observe.
///
/// An earlier `0.0005` was sized from the building census alone and then applied to CellStruct
/// portals, which rejected every cell of Environment `0x0D000573` outright.
pub const PORTAL_SOURCE_PLANARITY_EPSILON: f32 = 0.005;

/// Float rounding a rigid placement can accumulate on a plane-distance evaluation.
///
/// Landblock-space coordinates reach the low hundreds, where one f32 ulp is about `3.05e-5`, and a
/// rotate-translate-then-dot chain accumulates a handful of them. Measured across all 1,353,166
/// placed portal instances in the archive's 542,275 indoor cells, the worst deviation an authored
/// aperture gained by being placed was `0.00012207` — exactly four of those ulps. Only 33 instances
/// exceeded `0.0001` and none reached `0.0002`. This budget keeps roughly 4x headroom over that
/// worst case while staying an order of magnitude under the authored budget, so transform drift can
/// never mask a genuinely malformed polygon.
const PORTAL_TRANSFORM_ROUNDING_EPSILON: f32 = 0.0005;

/// Budget for a placed aperture's vertices against its transformed plane.
///
/// A rigid placement preserves planar deviation, so an aperture carries its authored slop through
/// the transform and may exceed it only by rounding. Deriving the total keeps this check from
/// silently re-litigating the authored budget.
pub const PORTAL_TRANSFORM_COPLANARITY_EPSILON: f32 =
    PORTAL_SOURCE_PLANARITY_EPSILON + PORTAL_TRANSFORM_ROUNDING_EPSILON;

/// One material-free authored portal aperture in renderer coordinates.
#[derive(Debug, Clone, PartialEq)]
pub struct PortalAperture {
    pub positions: Vec<RenderVec3>,
    pub triangle_indices: Vec<u32>,
    pub plane: RenderPlane,
    pub bounds: RenderAabb,
}

/// Normalized plane in renderer coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderPlane {
    pub normal: RenderVec3,
    pub d: f32,
}

/// Authored plane side from which a directed portal accepts traversal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcceptedPlaneSide {
    Positive,
    Negative,
}

/// Decode the retail `PortalSide` convention without changing the authored plane.
pub fn accepted_plane_side(flags: u16) -> AcceptedPlaneSide {
    if (flags & 0x02) != 0 {
        AcceptedPlaneSide::Positive
    } else {
        AcceptedPlaneSide::Negative
    }
}

/// Project an authored polygon as material-free aperture geometry.
pub fn build_portal_aperture(
    vertex_array: &CVertexArray,
    polygon_id: u16,
    polygon: &Polygon,
) -> Result<PortalAperture> {
    let (ac_positions, ac_plane, maximum_planar_deviation) =
        portal_source_geometry(vertex_array, polygon_id, polygon)?;
    ensure!(
        maximum_planar_deviation <= PORTAL_SOURCE_PLANARITY_EPSILON,
        "portal polygon {polygon_id} maximum planar deviation {maximum_planar_deviation} exceeds {PORTAL_SOURCE_PLANARITY_EPSILON}"
    );
    let positions = ac_positions
        .iter()
        .copied()
        .map(ac_to_render)
        .collect::<Vec<_>>();
    let mut triangle_indices = Vec::with_capacity((positions.len() - 2) * 3);
    for offset in 1..(positions.len() - 1) {
        ensure!(
            triangle_area_squared([positions[0], positions[offset], positions[offset + 1]]) > 0.0,
            "portal polygon {polygon_id} fan triangle {} has zero area",
            offset - 1
        );
        triangle_indices.extend([0, u32::try_from(offset)?, u32::try_from(offset + 1)?]);
    }
    let bounds = bounds_for_positions(&positions)
        .expect("validated portal aperture must contain at least three positions");
    Ok(PortalAperture {
        positions,
        triangle_indices,
        plane: RenderPlane {
            normal: ac_to_render(ac_plane.normal),
            d: ac_plane.d,
        },
        bounds,
    })
}

/// Measure authored deviation from the same averaged plane retail constructs for the polygon.
pub fn portal_planarity_deviation(
    vertex_array: &CVertexArray,
    polygon_id: u16,
    polygon: &Polygon,
) -> Result<f32> {
    Ok(portal_source_geometry(vertex_array, polygon_id, polygon)?.2)
}

fn portal_source_geometry(
    vertex_array: &CVertexArray,
    polygon_id: u16,
    polygon: &Polygon,
) -> Result<(Vec<Vector3>, Plane, f32)> {
    ensure!(
        usize::from(polygon.num_pts) == polygon.vertex_ids.len(),
        "portal polygon {polygon_id} declares {} points but contains {} vertex ids",
        polygon.num_pts,
        polygon.vertex_ids.len()
    );
    ensure!(
        polygon.vertex_ids.len() >= 3,
        "portal polygon {polygon_id} has fewer than three vertices"
    );
    let ac_positions = polygon
        .vertex_ids
        .iter()
        .map(|vertex_id| {
            let position = vertex_array
                .vertices
                .get(vertex_id)
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "portal polygon {polygon_id} references missing vertex {vertex_id}"
                    )
                })?
                .origin;
            ensure!(
                vector_is_finite(position),
                "portal polygon {polygon_id} vertex {vertex_id} is non-finite"
            );
            Ok(position)
        })
        .collect::<Result<Vec<_>>>()?;
    let ac_plane = retail_polygon_plane(polygon_id, &ac_positions)?;
    let maximum_planar_deviation = ac_positions
        .iter()
        .map(|position| ac_plane.distance_to_point(position).abs())
        .fold(0.0f32, f32::max);
    Ok((ac_positions, ac_plane, maximum_planar_deviation))
}

/// Transform a local aperture into landblock space while preserving plane-side semantics.
pub fn transform_aperture(
    aperture: &PortalAperture,
    placement: LandblockPlacement,
) -> Result<PortalAperture> {
    ensure!(
        vector_is_finite(placement.origin) && quaternion_is_finite(placement.orientation),
        "portal placement contains non-finite values"
    );
    let positions = aperture
        .positions
        .iter()
        .copied()
        .map(|point| transform_render_point(point, placement))
        .collect::<Vec<_>>();
    let local_normal_ac = render_to_ac(aperture.plane.normal);
    let normal_ac = rotate_vector(placement.orientation, local_normal_ac);
    let plane = RenderPlane {
        normal: ac_to_render(normal_ac),
        d: aperture.plane.d - normal_ac.dot(&placement.origin),
    };
    for (offset, position) in positions.iter().copied().enumerate() {
        ensure!(
            plane_distance(plane, position).abs() <= PORTAL_TRANSFORM_COPLANARITY_EPSILON,
            "transformed portal vertex {offset} is not coplanar within {PORTAL_TRANSFORM_COPLANARITY_EPSILON}"
        );
    }
    Ok(PortalAperture {
        bounds: bounds_for_positions(&positions)
            .expect("source aperture must contain validated positions"),
        positions,
        triangle_indices: aperture.triangle_indices.clone(),
        plane,
    })
}

/// Transform one renderer-coordinate local point through an authored AC placement.
pub fn transform_render_point(point: RenderVec3, placement: LandblockPlacement) -> RenderVec3 {
    ac_to_render(rotate_vector(placement.orientation, render_to_ac(point)) + placement.origin)
}

/// Conservatively transform all eight corners of a renderer-coordinate AABB.
pub fn transform_render_bounds(bounds: RenderAabb, placement: LandblockPlacement) -> RenderAabb {
    let positions = [bounds.min.x, bounds.max.x]
        .into_iter()
        .flat_map(|x| {
            [bounds.min.y, bounds.max.y].into_iter().flat_map(move |y| {
                [bounds.min.z, bounds.max.z]
                    .into_iter()
                    .map(move |z| RenderVec3 { x, y, z })
            })
        })
        .map(|point| transform_render_point(point, placement))
        .collect::<Vec<_>>();
    bounds_for_positions(&positions).expect("an AABB must produce eight transformed corners")
}

pub fn plane_distance(plane: RenderPlane, point: RenderVec3) -> f32 {
    plane.normal.x * point.x + plane.normal.y * point.y + plane.normal.z * point.z + plane.d
}

fn retail_polygon_plane(polygon_id: u16, positions: &[Vector3]) -> Result<Plane> {
    let origin = positions[0];
    let mut normal = Vector3::zero();
    for offset in 1..(positions.len() - 1) {
        normal = normal + (positions[offset] - origin).cross(&(positions[offset + 1] - origin));
    }
    let length = normal.length();
    ensure!(
        length.is_finite() && length > 0.0,
        "portal polygon {polygon_id} has a degenerate plane"
    );
    normal = normal / length;
    let average_distance =
        positions.iter().map(|point| normal.dot(point)).sum::<f32>() / positions.len() as f32;
    ensure!(
        average_distance.is_finite(),
        "portal polygon {polygon_id} plane distance is non-finite"
    );
    Ok(Plane {
        normal,
        d: -average_distance,
    })
}

fn rotate_vector(rotation: Quaternion, vector: Vector3) -> Vector3 {
    let quaternion_vector = Vector3::new(rotation.x, rotation.y, rotation.z);
    let twice_cross = quaternion_vector.cross(&vector) * 2.0;
    vector + twice_cross * rotation.w + quaternion_vector.cross(&twice_cross)
}

fn render_to_ac(vector: RenderVec3) -> Vector3 {
    Vector3::new(vector.x, -vector.z, vector.y)
}

fn vector_is_finite(vector: Vector3) -> bool {
    [vector.x, vector.y, vector.z]
        .into_iter()
        .all(f32::is_finite)
}

fn quaternion_is_finite(quaternion: Quaternion) -> bool {
    [quaternion.w, quaternion.x, quaternion.y, quaternion.z]
        .into_iter()
        .all(f32::is_finite)
}

/// Compute exact renderer-coordinate bounds for a non-empty position collection.
pub(crate) fn bounds_for_positions(positions: &[RenderVec3]) -> Option<RenderAabb> {
    positions
        .iter()
        .copied()
        .fold(None::<RenderAabb>, |bounds, point| match bounds {
            Some(bounds) => Some(RenderAabb {
                min: RenderVec3 {
                    x: bounds.min.x.min(point.x),
                    y: bounds.min.y.min(point.y),
                    z: bounds.min.z.min(point.z),
                },
                max: RenderVec3 {
                    x: bounds.max.x.max(point.x),
                    y: bounds.max.y.max(point.y),
                    z: bounds.max.z.max(point.z),
                },
            }),
            None => Some(RenderAabb {
                min: point,
                max: point,
            }),
        })
}

fn triangle_area_squared([a, b, c]: [RenderVec3; 3]) -> f32 {
    let ab = RenderVec3 {
        x: b.x - a.x,
        y: b.y - a.y,
        z: b.z - a.z,
    };
    let ac = RenderVec3 {
        x: c.x - a.x,
        y: c.y - a.y,
        z: c.z - a.z,
    };
    let cross = RenderVec3 {
        x: ab.y * ac.z - ab.z * ac.y,
        y: ab.z * ac.x - ab.x * ac.z,
        z: ab.x * ac.y - ab.y * ac.x,
    };
    cross.x * cross.x + cross.y * cross.y + cross.z * cross.z
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use holtburger_dat::graphics::{SWVertex, Vec2Duv};

    use super::*;

    #[test]
    fn retains_non_rectangular_non_axis_aligned_aperture() {
        let positions = [
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(2.0, 0.0, 2.0),
            Vector3::new(2.0, 1.0, 1.0),
            Vector3::new(1.0, 2.0, -1.0),
            Vector3::new(0.0, 1.0, -1.0),
        ];
        let vertices = vertex_array(&positions);
        let polygon = polygon(positions.len());

        let aperture = build_portal_aperture(&vertices, 8, &polygon).unwrap();

        assert_eq!(aperture.positions.len(), 5);
        assert_eq!(aperture.triangle_indices, [0, 1, 2, 0, 2, 3, 0, 3, 4]);
        assert!(
            aperture.plane.normal.x.abs() < 0.999
                && aperture.plane.normal.y.abs() < 0.999
                && aperture.plane.normal.z.abs() < 0.999
        );
        assert!(aperture.positions.iter().all(|position| {
            plane_distance(aperture.plane, *position).abs() <= PORTAL_PLANE_EPSILON
        }));
    }

    #[test]
    fn rejects_non_coplanar_aperture() {
        // The averaged plane splits one lifted corner across all four vertices, so the resulting
        // deviation is a quarter of the lift. Scale the lift off the budget itself to keep this
        // test honest if the census ever moves the constant.
        let lift = PORTAL_SOURCE_PLANARITY_EPSILON * 20.0;
        let positions = [
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(1.0, 1.0, 0.0),
            Vector3::new(0.0, 1.0, lift),
        ];

        let error = build_portal_aperture(&vertex_array(&positions), 4, &polygon(positions.len()))
            .unwrap_err();

        assert!(error.to_string().contains("maximum planar deviation"));
    }

    /// Environment `0x0D000573` CellStruct `0x0002` polygon `7`, the worst-deviating portal polygon
    /// in the shipped archive: one quad corner authored at `x = -8.15` against three at `x = -8.14`.
    /// It is the case that sized `PORTAL_SOURCE_PLANARITY_EPSILON`, so it is also the case that
    /// must keep projecting.
    #[test]
    fn accepts_worst_authored_planar_deviation() {
        let positions = [
            Vector3::new(-8.15, -8.07, 3.66),
            Vector3::new(-8.14, -8.07, 1.15484e-9),
            Vector3::new(-8.14, -10.67, -1.53892e-7),
            Vector3::new(-8.14, -10.67, 3.66),
        ];
        let vertices = vertex_array(&positions);

        let deviation =
            portal_planarity_deviation(&vertices, 7, &polygon(positions.len())).unwrap();
        let aperture = build_portal_aperture(&vertices, 7, &polygon(positions.len())).unwrap();

        // Above the tolerance the building-aperture census produced, and inside the archive-wide one.
        assert!(deviation > 0.0005, "unexpected deviation {deviation}");
        assert!(deviation <= PORTAL_SOURCE_PLANARITY_EPSILON);
        assert_eq!(aperture.positions.len(), 4);
    }

    #[test]
    fn transforms_plane_and_vertices_with_placement() {
        let positions = [
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
        ];
        let aperture =
            build_portal_aperture(&vertex_array(&positions), 2, &polygon(positions.len())).unwrap();
        let transformed = transform_aperture(
            &aperture,
            LandblockPlacement {
                origin: Vector3::new(5.0, 6.0, 7.0),
                orientation: Quaternion::from_heading(0.0),
            },
        )
        .unwrap();

        assert!(transformed.positions.iter().all(|position| {
            plane_distance(transformed.plane, *position).abs() <= PORTAL_PLANE_EPSILON
        }));
        assert_eq!(transformed.triangle_indices, aperture.triangle_indices);
    }

    #[test]
    fn decodes_authored_accepted_side() {
        assert_eq!(accepted_plane_side(0x02), AcceptedPlaneSide::Positive);
        assert_eq!(accepted_plane_side(0x00), AcceptedPlaneSide::Negative);
    }

    #[test]
    fn preserves_both_authored_winding_directions() {
        let positions = [
            Vector3::new(0.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
        ];
        let vertices = vertex_array(&positions);
        let forward = build_portal_aperture(&vertices, 1, &polygon(3)).unwrap();
        let mut reversed_polygon = polygon(3);
        reversed_polygon.vertex_ids.reverse();
        reversed_polygon.pos_uv_indices.reverse();
        let reversed = build_portal_aperture(&vertices, 2, &reversed_polygon).unwrap();

        assert!(
            forward.plane.normal.x * reversed.plane.normal.x
                + forward.plane.normal.y * reversed.plane.normal.y
                + forward.plane.normal.z * reversed.plane.normal.z
                < -0.999
        );
    }

    fn vertex_array(positions: &[Vector3]) -> CVertexArray {
        CVertexArray {
            vertex_type: 1,
            vertices: positions
                .iter()
                .copied()
                .enumerate()
                .map(|(index, origin)| {
                    (
                        u16::try_from(index).unwrap(),
                        SWVertex {
                            num_uvs: 1,
                            origin,
                            normal: Vector3::new(0.0, 0.0, 1.0),
                            uvs: vec![Vec2Duv { u: 0.0, v: 0.0 }],
                        },
                    )
                })
                .collect::<HashMap<_, _>>(),
        }
    }

    fn polygon(vertex_count: usize) -> Polygon {
        Polygon {
            num_pts: u8::try_from(vertex_count).unwrap(),
            stippling: 0,
            sides_type: 3,
            pos_surface: 0,
            neg_surface: 0,
            vertex_ids: (0..vertex_count)
                .map(|index| u16::try_from(index).unwrap())
                .collect(),
            pos_uv_indices: vec![0; vertex_count],
            neg_uv_indices: Vec::new(),
        }
    }
}
