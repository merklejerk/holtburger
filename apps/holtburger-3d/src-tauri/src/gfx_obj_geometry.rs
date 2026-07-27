use std::collections::HashSet;

use holtburger_dat::file_type::GfxObj;
use holtburger_dat::graphics::{CVertexArray, Polygon};
use holtburger_dat::physics::BspNode;

const STIPPLING_REPEAT_POS: u8 = 0x01;
const STIPPLING_REPEAT_NEG: u8 = 0x02;
const STIPPLING_NO_POS: u8 = 0x04;
const STIPPLING_NO_NEG: u8 = 0x08;
const CULL_MODE_NONE: i32 = 1;
const CULL_MODE_CLOCKWISE: i32 = 2;
const CULL_MODE_COUNTER_CLOCKWISE: i32 = 3;

/// App-local render geometry expanded from one GfxObj drawing polygon set.
#[derive(Debug)]
pub(crate) struct GfxObjGeometry {
    pub(crate) vertex_count: usize,
    pub(crate) positions: Vec<f32>,
    pub(crate) normals: Vec<f32>,
    pub(crate) texture_coordinates: Vec<f32>,
    pub(crate) triangles: Vec<GfxObjTriangle>,
    pub(crate) bounds: Option<RenderAabb>,
}

/// Per-triangle authored material and polygon-side facts.
#[derive(Debug, Clone, Copy)]
pub(crate) struct GfxObjTriangle {
    pub(crate) polygon_id: u16,
    pub(crate) surface_slot: Option<i16>,
    pub(crate) side_kind: PolygonSideKind,
    pub(crate) sides_type: i32,
    pub(crate) stippling: u8,
    pub(crate) sampler_wrap: SamplerWrapMode,
    pub(crate) first_vertex: usize,
}

/// Polygon side expanded into an explicit render triangle.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PolygonSideKind {
    Positive,
    PositiveReversed,
    Negative,
}

/// Texture-addressing behavior selected by the authored side stippling bit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SamplerWrapMode {
    Clamp,
    Repeat,
}

/// Axis-aligned bounds in Three.js render coordinates.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RenderAabb {
    pub(crate) min: RenderVec3,
    pub(crate) max: RenderVec3,
}

/// Vector in Three.js render coordinates.
#[derive(Debug, Clone, Copy)]
pub(crate) struct RenderVec3 {
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) z: f32,
}

/// Expands retail drawing sides, winding, normals, UVs, and fan triangles for one GfxObj.
pub(crate) fn build_gfx_obj_geometry(gfx_obj: &GfxObj) -> GfxObjGeometry {
    let render_polygon_ids = gfx_obj
        .drawing_bsp
        .as_ref()
        .map(collect_drawing_bsp_renderable_polygon_ids);
    let mut polygon_entries = gfx_obj.polygons.iter().collect::<Vec<_>>();
    polygon_entries.sort_by_key(|(polygon_id, _)| **polygon_id);

    let mut geometry = GfxObjGeometry {
        vertex_count: 0,
        positions: Vec::new(),
        normals: Vec::new(),
        texture_coordinates: Vec::new(),
        triangles: Vec::new(),
        bounds: None,
    };
    for (polygon_id, polygon) in polygon_entries {
        if render_polygon_ids
            .as_ref()
            .is_some_and(|ids| !ids.contains(polygon_id))
            || polygon.vertex_ids.len() < 3
            || polygon.num_pts as usize != polygon.vertex_ids.len()
            || polygon
                .vertex_ids
                .iter()
                .any(|vertex_id| !gfx_obj.vertex_array.vertices.contains_key(vertex_id))
        {
            continue;
        }

        for side in render_sides(polygon) {
            append_side(
                *polygon_id,
                polygon,
                &gfx_obj.vertex_array,
                side,
                &mut geometry,
            );
        }
    }
    geometry.vertex_count = geometry.positions.len() / 3;
    geometry
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Winding {
    Source,
    Reversed,
}

#[derive(Debug, Clone, Copy)]
struct RenderSide<'a> {
    kind: PolygonSideKind,
    surface_slot: Option<i16>,
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
            surface_slot: normalize_surface_slot(polygon.pos_surface),
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
                surface_slot: normalize_surface_slot(polygon.pos_surface),
                sampler_wrap: sampler_wrap((polygon.stippling & STIPPLING_REPEAT_POS) != 0),
                uv_indices: side_uv_indices(polygon, AuthoredSide::Positive),
                winding: Winding::Reversed,
                normal_scale: -1.0,
            });
        }
        CULL_MODE_CLOCKWISE if negative_side_is_renderable(polygon) => {
            sides.push(RenderSide {
                kind: PolygonSideKind::Negative,
                surface_slot: normalize_surface_slot(polygon.neg_surface),
                sampler_wrap: sampler_wrap((polygon.stippling & STIPPLING_REPEAT_NEG) != 0),
                uv_indices: side_uv_indices(polygon, AuthoredSide::Negative),
                winding: Winding::Reversed,
                normal_scale: -1.0,
            });
        }
        CULL_MODE_COUNTER_CLOCKWISE => {}
        _ => {}
    }
    sides
}

fn append_side(
    polygon_id: u16,
    polygon: &Polygon,
    vertex_array: &CVertexArray,
    side: RenderSide<'_>,
    geometry: &mut GfxObjGeometry,
) {
    for vertex_index in 1..(polygon.vertex_ids.len() - 1) {
        let offsets = match side.winding {
            Winding::Source => [0, vertex_index, vertex_index + 1],
            Winding::Reversed => [0, vertex_index + 1, vertex_index],
        };
        geometry.triangles.push(GfxObjTriangle {
            polygon_id,
            surface_slot: side.surface_slot,
            side_kind: side.kind,
            sides_type: polygon.sides_type,
            stippling: polygon.stippling,
            sampler_wrap: side.sampler_wrap,
            first_vertex: geometry.positions.len() / 3,
        });

        for offset in offsets {
            let vertex = vertex_array
                .vertices
                .get(&polygon.vertex_ids[offset])
                .expect("missing vertices were filtered before triangulation");
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
                .and_then(|indices| indices.get(offset))
                .and_then(|index| vertex.uvs.get(usize::from(*index)));
            geometry
                .texture_coordinates
                .extend([uv.map_or(0.0, |uv| uv.u), uv.map_or(0.0, |uv| uv.v)]);
            geometry.bounds = Some(expand_bounds(geometry.bounds, position));
        }
    }
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
    let (omit_uv_bit, uv_indices) = match side {
        AuthoredSide::Positive => (STIPPLING_NO_POS, polygon.pos_uv_indices.as_slice()),
        AuthoredSide::Negative => (STIPPLING_NO_NEG, polygon.neg_uv_indices.as_slice()),
    };
    if (polygon.stippling & omit_uv_bit) != 0 {
        return None;
    }
    (uv_indices.len() == polygon.vertex_ids.len()).then_some(uv_indices)
}

fn collect_drawing_bsp_renderable_polygon_ids(node: &BspNode) -> HashSet<u16> {
    let mut polygon_ids = HashSet::new();
    collect_drawing_bsp_node_polygon_ids(node, &mut polygon_ids);
    polygon_ids
}

fn collect_drawing_bsp_node_polygon_ids(node: &BspNode, polygon_ids: &mut HashSet<u16>) {
    match node {
        BspNode::Port(portal) => {
            polygon_ids.extend(portal.poly_ids.iter().copied());
            collect_drawing_bsp_node_polygon_ids(&portal.pos, polygon_ids);
            collect_drawing_bsp_node_polygon_ids(&portal.neg, polygon_ids);
        }
        BspNode::Leaf(leaf) => {
            polygon_ids.extend(leaf.poly_ids.iter().copied());
        }
        BspNode::Internal(internal) => {
            polygon_ids.extend(internal.poly_ids.iter().copied());
            if let Some(pos) = &internal.pos {
                collect_drawing_bsp_node_polygon_ids(pos, polygon_ids);
            }
            if let Some(neg) = &internal.neg {
                collect_drawing_bsp_node_polygon_ids(neg, polygon_ids);
            }
        }
    }
}

fn sampler_wrap(repeats: bool) -> SamplerWrapMode {
    if repeats {
        SamplerWrapMode::Repeat
    } else {
        SamplerWrapMode::Clamp
    }
}

fn normalize_surface_slot(surface_id: i16) -> Option<i16> {
    (surface_id >= 0).then_some(surface_id)
}

fn ac_to_render(vector: holtburger_common::Vector3) -> RenderVec3 {
    RenderVec3 {
        x: vector.x,
        y: vector.z,
        z: if vector.y == 0.0 { 0.0 } else { -vector.y },
    }
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
    use holtburger_common::Vector3;
    use holtburger_common::properties::GfxObjFlags;
    use std::collections::HashMap;

    use holtburger_dat::graphics::{CVertexArray, Polygon, SWVertex, Vec2Duv};

    use super::*;

    #[test]
    fn cull_none_expands_both_windings_with_typed_sampler_facts() {
        let gfx_obj = triangle_gfx_obj(CULL_MODE_NONE, STIPPLING_REPEAT_POS);

        let geometry = build_gfx_obj_geometry(&gfx_obj);

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
    fn malformed_missing_vertices_are_skipped_without_partial_geometry() {
        let mut gfx_obj = triangle_gfx_obj(CULL_MODE_COUNTER_CLOCKWISE, 0);
        gfx_obj.polygons.get_mut(&7).unwrap().vertex_ids[2] = 99;

        let geometry = build_gfx_obj_geometry(&gfx_obj);

        assert_eq!(geometry.vertex_count, 0);
        assert!(geometry.triangles.is_empty());
        assert!(geometry.bounds.is_none());
    }

    fn triangle_gfx_obj(sides_type: i32, stippling: u8) -> GfxObj {
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
        GfxObj {
            id: 0x0100_0001,
            flags: GfxObjFlags::HAS_DRAWING,
            surfaces: vec![0x0800_0001],
            vertex_array: CVertexArray {
                vertex_type: 1,
                vertices,
            },
            physics_polygons: HashMap::new(),
            physics_bsp: None,
            sort_center: Vector3::zero(),
            polygons: HashMap::from([(
                7,
                Polygon {
                    num_pts: 3,
                    stippling,
                    sides_type,
                    pos_surface: 0,
                    neg_surface: 0,
                    vertex_ids: vec![0, 1, 2],
                    pos_uv_indices: vec![0, 0, 0],
                    neg_uv_indices: vec![0, 0, 0],
                },
            )]),
            drawing_bsp: None,
            did_degrade: None,
        }
    }
}
