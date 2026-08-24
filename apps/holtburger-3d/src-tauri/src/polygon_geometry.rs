use anyhow::{Result, ensure};
use holtburger_dat::graphics::{CVertexArray, Polygon};

const STIPPLING_REPEAT_POS: u8 = 0x01;
const STIPPLING_REPEAT_NEG: u8 = 0x02;
const STIPPLING_NO_POS: u8 = 0x04;
const STIPPLING_NO_NEG: u8 = 0x08;
pub const CULL_MODE_LANDBLOCK: i32 = 0;
pub const CULL_MODE_NONE: i32 = 1;
const CULL_MODE_CLOCKWISE: i32 = 2;
pub const CULL_MODE_COUNTER_CLOCKWISE: i32 = 3;

/// Renderer-neutral geometry expanded from one explicitly selected polygon set.
#[derive(Debug)]
pub struct PolygonSetGeometry {
    pub vertex_count: usize,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub texture_coordinates: Vec<f32>,
    pub triangles: Vec<PolygonSetTriangle>,
    pub rejected_degenerate_triangles: Vec<RejectedDegenerateTriangle>,
    pub bounds: Option<RenderAabb>,
}

/// Authored fan triangle rejected because it contributes no renderable area.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RejectedDegenerateTriangle {
    pub polygon_id: u16,
    pub side_kind: PolygonSideKind,
    pub fan_triangle_index: usize,
}

/// Per-triangle authored material and polygon-side facts.
#[derive(Debug, Clone, Copy)]
pub struct PolygonSetTriangle {
    pub polygon_id: u16,
    /// Raw authored side surface index; the source adapter owns its slot semantics.
    pub authored_surface_index: i16,
    pub side_kind: PolygonSideKind,
    pub sides_type: i32,
    pub stippling: u8,
    pub sampler_wrap: SamplerWrapMode,
    pub first_vertex: usize,
}

/// Polygon side expanded into an explicit render triangle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolygonSideKind {
    Positive,
    PositiveReversed,
    Negative,
}

/// Texture-addressing behavior selected by the authored side stippling bit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SamplerWrapMode {
    Clamp,
    Repeat,
}

/// Axis-aligned bounds in Three.js render coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderAabb {
    pub min: RenderVec3,
    pub max: RenderVec3,
}

/// Vector in Three.js render coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RenderVec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

/// Expand selected authored polygons into validated explicit triangle-side geometry.
pub fn build_polygon_set_geometry<'a>(
    vertex_array: &CVertexArray,
    polygons: impl IntoIterator<Item = (u16, &'a Polygon)>,
    mut include_side: impl FnMut(u16, PolygonSideKind, i16) -> Result<bool>,
) -> Result<PolygonSetGeometry> {
    let mut geometry = PolygonSetGeometry {
        vertex_count: 0,
        positions: Vec::new(),
        normals: Vec::new(),
        texture_coordinates: Vec::new(),
        triangles: Vec::new(),
        rejected_degenerate_triangles: Vec::new(),
        bounds: None,
    };
    for (polygon_id, polygon) in polygons {
        validate_polygon(polygon_id, polygon, vertex_array)?;
        for side in render_sides(polygon) {
            if include_side(polygon_id, side.kind, side.authored_surface_index)? {
                append_side(polygon_id, polygon, vertex_array, side, &mut geometry)?;
            }
        }
    }
    geometry.vertex_count = geometry.positions.len() / 3;
    Ok(geometry)
}

fn validate_polygon(polygon_id: u16, polygon: &Polygon, vertex_array: &CVertexArray) -> Result<()> {
    ensure!(
        matches!(
            polygon.sides_type,
            CULL_MODE_LANDBLOCK
                | CULL_MODE_NONE
                | CULL_MODE_CLOCKWISE
                | CULL_MODE_COUNTER_CLOCKWISE
        ),
        "polygon {polygon_id} has unsupported cull mode {}",
        polygon.sides_type
    );
    ensure!(
        polygon.vertex_ids.len() >= 3,
        "polygon {polygon_id} has fewer than three vertices"
    );
    ensure!(
        usize::from(polygon.num_pts) == polygon.vertex_ids.len(),
        "polygon {polygon_id} declares {} points but contains {} vertex ids",
        polygon.num_pts,
        polygon.vertex_ids.len()
    );
    for vertex_id in &polygon.vertex_ids {
        let vertex = vertex_array.vertices.get(vertex_id).ok_or_else(|| {
            anyhow::anyhow!("polygon {polygon_id} references missing vertex {vertex_id}")
        })?;
        ensure!(
            [vertex.origin.x, vertex.origin.y, vertex.origin.z]
                .into_iter()
                .all(f32::is_finite),
            "polygon {polygon_id} vertex {vertex_id} has a non-finite position"
        );
        ensure!(
            [vertex.normal.x, vertex.normal.y, vertex.normal.z]
                .into_iter()
                .all(f32::is_finite),
            "polygon {polygon_id} vertex {vertex_id} has a non-finite normal"
        );
    }
    validate_side_uvs(polygon_id, polygon, vertex_array, AuthoredSide::Positive)?;
    if polygon.sides_type == CULL_MODE_CLOCKWISE {
        validate_side_uvs(polygon_id, polygon, vertex_array, AuthoredSide::Negative)?;
    }
    Ok(())
}

fn validate_side_uvs(
    polygon_id: u16,
    polygon: &Polygon,
    vertex_array: &CVertexArray,
    side: AuthoredSide,
) -> Result<()> {
    let (omit_uv_bit, indices) = authored_side_uvs(polygon, side);
    if (polygon.stippling & omit_uv_bit) != 0 {
        return Ok(());
    }
    ensure!(
        indices.len() == polygon.vertex_ids.len(),
        "polygon {polygon_id} {side:?} side has {} UV indices for {} vertices",
        indices.len(),
        polygon.vertex_ids.len()
    );
    for (offset, uv_index) in indices.iter().copied().enumerate() {
        let vertex_id = polygon.vertex_ids[offset];
        let vertex = &vertex_array.vertices[&vertex_id];
        let uv = vertex.uvs.get(usize::from(uv_index)).ok_or_else(|| {
            anyhow::anyhow!(
                "polygon {polygon_id} {side:?} side references missing UV {uv_index} on vertex {vertex_id}"
            )
        })?;
        ensure!(
            uv.u.is_finite() && uv.v.is_finite(),
            "polygon {polygon_id} {side:?} side has a non-finite UV on vertex {vertex_id}"
        );
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Winding {
    Source,
    Reversed,
}

#[derive(Debug, Clone, Copy)]
struct RenderSide<'a> {
    kind: PolygonSideKind,
    authored_surface_index: i16,
    sampler_wrap: SamplerWrapMode,
    uv_indices: Option<&'a [u8]>,
    winding: Winding,
    normal_scale: f32,
}

fn render_sides(polygon: &Polygon) -> Vec<RenderSide<'_>> {
    // Retail aliases CullMode.None's negative side to the positive side, then expands None and
    // Clockwise into explicit geometry. CounterClockwise remains positive-only.
    let mut sides = Vec::with_capacity(2);
    if positive_side_is_renderable(polygon) {
        sides.push(RenderSide {
            kind: PolygonSideKind::Positive,
            authored_surface_index: polygon.pos_surface,
            sampler_wrap: sampler_wrap((polygon.stippling & STIPPLING_REPEAT_POS) != 0),
            uv_indices: side_uv_indices(polygon, AuthoredSide::Positive),
            winding: Winding::Source,
            normal_scale: 1.0,
        });
    }

    match polygon.sides_type {
        CULL_MODE_NONE if positive_side_is_renderable(polygon) => {
            sides.push(RenderSide {
                kind: PolygonSideKind::PositiveReversed,
                authored_surface_index: polygon.pos_surface,
                sampler_wrap: sampler_wrap((polygon.stippling & STIPPLING_REPEAT_POS) != 0),
                uv_indices: side_uv_indices(polygon, AuthoredSide::Positive),
                winding: Winding::Reversed,
                normal_scale: -1.0,
            });
        }
        CULL_MODE_CLOCKWISE if negative_side_is_renderable(polygon) => {
            sides.push(RenderSide {
                kind: PolygonSideKind::Negative,
                authored_surface_index: polygon.neg_surface,
                sampler_wrap: sampler_wrap((polygon.stippling & STIPPLING_REPEAT_NEG) != 0),
                uv_indices: side_uv_indices(polygon, AuthoredSide::Negative),
                winding: Winding::Reversed,
                normal_scale: -1.0,
            });
        }
        CULL_MODE_LANDBLOCK | CULL_MODE_COUNTER_CLOCKWISE => {}
        _ => {}
    }
    sides
}

fn append_side(
    polygon_id: u16,
    polygon: &Polygon,
    vertex_array: &CVertexArray,
    side: RenderSide<'_>,
    geometry: &mut PolygonSetGeometry,
) -> Result<()> {
    for vertex_index in 1..(polygon.vertex_ids.len() - 1) {
        let offsets = match side.winding {
            Winding::Source => [0, vertex_index, vertex_index + 1],
            Winding::Reversed => [0, vertex_index + 1, vertex_index],
        };
        let positions = offsets
            .map(|offset| ac_to_render(vertex_array.vertices[&polygon.vertex_ids[offset]].origin));
        if triangle_area_squared(positions) == 0.0 {
            geometry
                .rejected_degenerate_triangles
                .push(RejectedDegenerateTriangle {
                    polygon_id,
                    side_kind: side.kind,
                    fan_triangle_index: vertex_index - 1,
                });
            continue;
        }
        geometry.triangles.push(PolygonSetTriangle {
            polygon_id,
            authored_surface_index: side.authored_surface_index,
            side_kind: side.kind,
            sides_type: polygon.sides_type,
            stippling: polygon.stippling,
            sampler_wrap: side.sampler_wrap,
            first_vertex: geometry.positions.len() / 3,
        });

        for offset in offsets {
            let vertex = &vertex_array.vertices[&polygon.vertex_ids[offset]];
            let position = ac_to_render(vertex.origin);
            let normal = ac_to_render(vertex.normal);
            geometry
                .positions
                .extend([position.x, position.y, position.z]);
            geometry.normals.extend([
                scaled_normal(normal.x, side.normal_scale),
                scaled_normal(normal.y, side.normal_scale),
                scaled_normal(normal.z, side.normal_scale),
            ]);
            let uv = side
                .uv_indices
                .map(|indices| &vertex.uvs[usize::from(indices[offset])]);
            geometry
                .texture_coordinates
                .extend([uv.map_or(0.0, |uv| uv.u), uv.map_or(0.0, |uv| uv.v)]);
            geometry.bounds = Some(expand_bounds(geometry.bounds, position));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum AuthoredSide {
    Positive,
    Negative,
}

fn positive_side_is_renderable(polygon: &Polygon) -> bool {
    side_uv_indices(polygon, AuthoredSide::Positive).is_some()
        || (polygon.stippling & STIPPLING_NO_POS) != 0
}

fn negative_side_is_renderable(polygon: &Polygon) -> bool {
    polygon.sides_type == CULL_MODE_CLOCKWISE
        && side_uv_indices(polygon, AuthoredSide::Negative).is_some()
}

fn side_uv_indices(polygon: &Polygon, side: AuthoredSide) -> Option<&[u8]> {
    let (omit_uv_bit, uv_indices) = authored_side_uvs(polygon, side);
    if (polygon.stippling & omit_uv_bit) != 0 {
        return None;
    }
    (uv_indices.len() == polygon.vertex_ids.len()).then_some(uv_indices)
}

fn authored_side_uvs(polygon: &Polygon, side: AuthoredSide) -> (u8, &[u8]) {
    match side {
        AuthoredSide::Positive => (STIPPLING_NO_POS, polygon.pos_uv_indices.as_slice()),
        AuthoredSide::Negative => (STIPPLING_NO_NEG, polygon.neg_uv_indices.as_slice()),
    }
}

fn sampler_wrap(repeats: bool) -> SamplerWrapMode {
    if repeats {
        SamplerWrapMode::Repeat
    } else {
        SamplerWrapMode::Clamp
    }
}

pub fn ac_to_render(vector: holtburger_common::Vector3) -> RenderVec3 {
    RenderVec3 {
        x: vector.x,
        y: vector.z,
        z: if vector.y == 0.0 { 0.0 } else { -vector.y },
    }
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

fn scaled_normal(value: f32, scale: f32) -> f32 {
    let scaled = value * scale;
    if scaled == 0.0 { 0.0 } else { scaled }
}

fn expand_bounds(bounds: Option<RenderAabb>, point: RenderVec3) -> RenderAabb {
    match bounds {
        Some(bounds) => RenderAabb {
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
        },
        None => RenderAabb {
            min: point,
            max: point,
        },
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use holtburger_common::Vector3;
    use holtburger_dat::graphics::{SWVertex, Vec2Duv};

    use super::*;

    #[test]
    fn expands_cull_none_into_both_windings() {
        let vertices = triangle_vertices();
        let polygon = triangle_polygon(CULL_MODE_NONE, STIPPLING_REPEAT_POS);

        let geometry =
            build_polygon_set_geometry(&vertices, [(7, &polygon)], include_every_side).unwrap();

        assert_eq!(geometry.vertex_count, 6);
        assert_eq!(geometry.triangles.len(), 2);
        assert_eq!(geometry.triangles[0].side_kind, PolygonSideKind::Positive);
        assert_eq!(
            geometry.triangles[1].side_kind,
            PolygonSideKind::PositiveReversed
        );
        assert_eq!(geometry.triangles[0].sampler_wrap, SamplerWrapMode::Repeat);
    }

    #[test]
    fn rejects_missing_vertices_without_partial_output() {
        let vertices = triangle_vertices();
        let mut polygon = triangle_polygon(CULL_MODE_COUNTER_CLOCKWISE, 0);
        polygon.vertex_ids[2] = 99;

        let error =
            build_polygon_set_geometry(&vertices, [(7, &polygon)], include_every_side).unwrap_err();

        assert!(error.to_string().contains("missing vertex 99"));
    }

    #[test]
    fn rejects_zero_area_triangles_from_output_with_provenance() {
        let vertices = triangle_vertices();
        let mut polygon = triangle_polygon(CULL_MODE_COUNTER_CLOCKWISE, 0);
        polygon.vertex_ids[2] = 1;

        let geometry =
            build_polygon_set_geometry(&vertices, [(7, &polygon)], include_every_side).unwrap();

        assert!(geometry.triangles.is_empty());
        assert_eq!(
            geometry.rejected_degenerate_triangles,
            [RejectedDegenerateTriangle {
                fan_triangle_index: 0,
                polygon_id: 7,
                side_kind: PolygonSideKind::Positive,
            }]
        );
    }

    #[test]
    fn emits_landblock_cull_mode_as_positive_side() {
        let vertices = triangle_vertices();
        let polygon = triangle_polygon(CULL_MODE_LANDBLOCK, 0);

        let geometry =
            build_polygon_set_geometry(&vertices, [(7, &polygon)], include_every_side).unwrap();

        assert_eq!(geometry.triangles.len(), 1);
        assert_eq!(geometry.triangles[0].side_kind, PolygonSideKind::Positive);
        assert_eq!(geometry.triangles[0].sides_type, CULL_MODE_LANDBLOCK);
    }

    #[test]
    fn rejects_incomplete_authored_uv_lists() {
        let vertices = triangle_vertices();
        let mut polygon = triangle_polygon(CULL_MODE_COUNTER_CLOCKWISE, 0);
        polygon.pos_uv_indices.pop();

        let error =
            build_polygon_set_geometry(&vertices, [(7, &polygon)], include_every_side).unwrap_err();

        assert!(error.to_string().contains("2 UV indices for 3 vertices"));
    }

    fn triangle_vertices() -> CVertexArray {
        let mut vertices = HashMap::new();
        for (id, origin, uv) in [
            (0, Vector3::new(0.0, 0.0, 0.0), (0.0, 0.0)),
            (1, Vector3::new(1.0, 0.0, 0.0), (1.0, 0.0)),
            (2, Vector3::new(0.0, 1.0, 0.0), (0.0, 1.0)),
        ] {
            vertices.insert(
                id,
                SWVertex {
                    num_uvs: 1,
                    origin,
                    normal: Vector3::new(0.0, 0.0, 1.0),
                    uvs: vec![Vec2Duv { u: uv.0, v: uv.1 }],
                },
            );
        }
        CVertexArray {
            vertex_type: 1,
            vertices,
        }
    }

    fn triangle_polygon(sides_type: i32, stippling: u8) -> Polygon {
        Polygon {
            num_pts: 3,
            stippling,
            sides_type,
            pos_surface: 0,
            neg_surface: 0,
            vertex_ids: vec![0, 1, 2],
            pos_uv_indices: vec![0, 0, 0],
            neg_uv_indices: vec![0, 0, 0],
        }
    }

    fn include_every_side(
        _polygon_id: u16,
        _side_kind: PolygonSideKind,
        _surface_index: i16,
    ) -> Result<bool> {
        Ok(true)
    }
}
