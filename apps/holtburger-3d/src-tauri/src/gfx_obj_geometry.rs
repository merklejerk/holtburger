use std::collections::HashSet;

use anyhow::{Context, Result, ensure};
use holtburger_dat::file_type::GfxObj;
use holtburger_dat::physics::BspNode;

use crate::polygon_geometry::{
    PolygonSetGeometry, RenderAabb, RenderVec3, build_polygon_set_geometry,
};
use crate::portal_geometry::{
    PORTAL_SOURCE_PLANARITY_EPSILON, PortalAperture, RenderPlane, build_portal_aperture,
};

/// One drawing-BSP building aperture selected by its authored building-portal index.
#[derive(Debug, Clone, PartialEq)]
pub struct GfxObjPortalAperture {
    pub portal_index: usize,
    pub polygon_ids: Vec<u16>,
    pub aperture: PortalAperture,
}

/// Select GfxObj drawing-BSP polygons, then delegate polygon emission to the shared mechanic.
pub fn build_gfx_obj_geometry(gfx_obj: &GfxObj) -> Result<PolygonSetGeometry> {
    let render_polygon_ids = gfx_obj
        .drawing_bsp
        .as_ref()
        .map(collect_drawing_bsp_renderable_polygon_ids);
    let mut polygon_entries = gfx_obj
        .polygons
        .iter()
        .filter(|(polygon_id, _)| {
            render_polygon_ids
                .as_ref()
                .is_none_or(|ids| ids.contains(polygon_id))
        })
        .map(|(polygon_id, polygon)| (*polygon_id, polygon))
        .collect::<Vec<_>>();
    polygon_entries.sort_by_key(|(polygon_id, _)| *polygon_id);
    build_polygon_set_geometry(
        &gfx_obj.vertex_array,
        polygon_entries,
        |polygon_id, _side, surface_index| {
            let slot = usize::try_from(surface_index).map_err(|_| {
                anyhow::anyhow!(
                    "GfxObj 0x{:08X} polygon {polygon_id} has negative render surface {surface_index}",
                    gfx_obj.id
                )
            })?;
            ensure!(
                slot < gfx_obj.surfaces.len(),
                "GfxObj 0x{:08X} polygon {polygon_id} references material slot {slot}, but only {} slots exist",
                gfx_obj.id,
                gfx_obj.surfaces.len()
            );
            Ok(true)
        },
    )
}

/// Select material-free building apertures from drawing-BSP `CPortalPoly` records.
pub fn build_gfx_obj_portal_apertures(gfx_obj: &GfxObj) -> Result<Vec<GfxObjPortalAperture>> {
    let Some(drawing_bsp) = &gfx_obj.drawing_bsp else {
        return Ok(Vec::new());
    };
    let mut pairs = Vec::new();
    collect_drawing_bsp_portal_pairs(drawing_bsp, &mut pairs)
        .with_context(|| format!("Could not decode GfxObj 0x{:08X} portal pairs", gfx_obj.id))?;
    pairs.sort_unstable();
    pairs.dedup();
    let mut apertures = Vec::new();
    let mut cursor = 0;
    while cursor < pairs.len() {
        let portal_index = pairs[cursor].0;
        let end = pairs[cursor..]
            .iter()
            .position(|(candidate, _)| *candidate != portal_index)
            .map_or(pairs.len(), |offset| cursor + offset);
        let polygon_ids = pairs[cursor..end]
            .iter()
            .map(|(_, polygon_id)| *polygon_id)
            .collect::<Vec<_>>();
        let pieces = polygon_ids
            .iter()
            .map(|polygon_id| {
                let polygon = gfx_obj.polygons.get(polygon_id).ok_or_else(|| {
                    anyhow::anyhow!(
                        "GfxObj 0x{:08X} building portal {portal_index} references missing polygon {polygon_id}",
                        gfx_obj.id
                    )
                })?;
                build_portal_aperture(&gfx_obj.vertex_array, *polygon_id, polygon).with_context(
                    || {
                        format!(
                            "Could not project GfxObj 0x{:08X} building portal {portal_index} polygon {polygon_id}",
                            gfx_obj.id
                        )
                    },
                )
            })
            .collect::<Result<Vec<_>>>()?;
        apertures.push(GfxObjPortalAperture {
            portal_index,
            polygon_ids,
            aperture: merge_coplanar_apertures(gfx_obj.id, portal_index, pieces)?,
        });
        cursor = end;
    }
    Ok(apertures)
}

fn merge_coplanar_apertures(
    gfx_obj_id: u32,
    portal_index: usize,
    pieces: Vec<PortalAperture>,
) -> Result<PortalAperture> {
    let mut pieces = pieces.into_iter();
    let first = pieces
        .next()
        .context("building portal aperture has no polygon pieces")?;
    let mut merged = first;
    for piece in pieces {
        ensure!(
            planes_are_equivalent(merged.plane, piece.plane),
            "GfxObj 0x{gfx_obj_id:08X} building portal {portal_index} contains non-coplanar polygon pieces"
        );
        let vertex_offset = u32::try_from(merged.positions.len())?;
        merged.triangle_indices.extend(
            piece
                .triangle_indices
                .iter()
                .map(|index| index + vertex_offset),
        );
        merged.positions.extend(piece.positions);
        merged.bounds = union_bounds(merged.bounds, piece.bounds);
    }
    Ok(merged)
}

fn planes_are_equivalent(left: RenderPlane, right: RenderPlane) -> bool {
    let delta = RenderVec3 {
        x: left.normal.x - right.normal.x,
        y: left.normal.y - right.normal.y,
        z: left.normal.z - right.normal.z,
    };
    delta.x * delta.x + delta.y * delta.y + delta.z * delta.z
        <= PORTAL_SOURCE_PLANARITY_EPSILON * PORTAL_SOURCE_PLANARITY_EPSILON
        && (left.d - right.d).abs() <= PORTAL_SOURCE_PLANARITY_EPSILON
}

fn union_bounds(left: RenderAabb, right: RenderAabb) -> RenderAabb {
    RenderAabb {
        min: RenderVec3 {
            x: left.min.x.min(right.min.x),
            y: left.min.y.min(right.min.y),
            z: left.min.z.min(right.min.z),
        },
        max: RenderVec3 {
            x: left.max.x.max(right.max.x),
            y: left.max.y.max(right.max.y),
            z: left.max.z.max(right.max.z),
        },
    }
}

fn collect_drawing_bsp_renderable_polygon_ids(node: &BspNode) -> HashSet<u16> {
    let mut polygon_ids = HashSet::new();
    collect_drawing_bsp_node_polygon_ids(node, &mut polygon_ids);
    polygon_ids
}

fn collect_drawing_bsp_portal_pairs(node: &BspNode, pairs: &mut Vec<(usize, u16)>) -> Result<()> {
    match node {
        BspNode::Port(portal) => {
            for pair in &portal.portal_polys {
                let portal_index = usize::try_from(pair.portal_index)
                    .context("drawing-BSP portal index is negative")?;
                let polygon_id = u16::try_from(pair.poly_id)
                    .context("drawing-BSP portal polygon id is negative")?;
                pairs.push((portal_index, polygon_id));
            }
            collect_drawing_bsp_portal_pairs(&portal.pos, pairs)?;
            collect_drawing_bsp_portal_pairs(&portal.neg, pairs)?;
        }
        BspNode::Internal(internal) => {
            if let Some(pos) = &internal.pos {
                collect_drawing_bsp_portal_pairs(pos, pairs)?;
            }
            if let Some(neg) = &internal.neg {
                collect_drawing_bsp_portal_pairs(neg, pairs)?;
            }
        }
        BspNode::Leaf(_) => {}
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use holtburger_common::Vector3;
    use holtburger_common::properties::GfxObjFlags;
    use holtburger_dat::graphics::{CVertexArray, Polygon, SWVertex, Vec2Duv};
    use holtburger_dat::physics::{BspLeaf, BspPortal, PortalPoly};

    use crate::polygon_geometry::CULL_MODE_COUNTER_CLOCKWISE;

    use super::*;

    #[test]
    fn delegates_complete_polygon_side_emission() {
        let gfx_obj = triangle_gfx_obj();

        let geometry = build_gfx_obj_geometry(&gfx_obj).unwrap();

        assert_eq!(geometry.vertex_count, 3);
        assert_eq!(geometry.triangles.len(), 1);
        assert_eq!(geometry.triangles[0].polygon_id, 7);
    }

    #[test]
    fn rejects_malformed_selected_geometry() {
        let mut gfx_obj = triangle_gfx_obj();
        gfx_obj.polygons.get_mut(&7).unwrap().vertex_ids[2] = 99;

        let error = build_gfx_obj_geometry(&gfx_obj).unwrap_err();

        assert!(error.to_string().contains("missing vertex 99"));
    }

    #[test]
    fn selects_building_aperture_by_portal_index_then_polygon_id() {
        let mut gfx_obj = triangle_gfx_obj();
        gfx_obj.drawing_bsp = Some(BspNode::Port(BspPortal {
            plane: holtburger_common::Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: 0.0,
            },
            pos: Box::new(leaf()),
            neg: Box::new(leaf()),
            sphere: None,
            poly_ids: Vec::new(),
            portal_polys: vec![PortalPoly {
                poly_id: 7,
                portal_index: 3,
            }],
        }));

        let apertures = build_gfx_obj_portal_apertures(&gfx_obj).unwrap();

        assert_eq!(apertures.len(), 1);
        assert_eq!(apertures[0].portal_index, 3);
        assert_eq!(apertures[0].polygon_ids, [7]);
        assert_eq!(apertures[0].aperture.triangle_indices, [0, 1, 2]);
    }

    #[test]
    fn merges_coplanar_polygon_pieces_for_one_building_portal() {
        let mut gfx_obj = triangle_gfx_obj();
        gfx_obj.polygons.insert(8, triangle_polygon());
        gfx_obj.drawing_bsp = Some(BspNode::Port(BspPortal {
            plane: holtburger_common::Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: 0.0,
            },
            pos: Box::new(leaf()),
            neg: Box::new(leaf()),
            sphere: None,
            poly_ids: Vec::new(),
            portal_polys: vec![
                PortalPoly {
                    poly_id: 7,
                    portal_index: 3,
                },
                PortalPoly {
                    poly_id: 8,
                    portal_index: 3,
                },
            ],
        }));

        let apertures = build_gfx_obj_portal_apertures(&gfx_obj).unwrap();

        assert_eq!(apertures.len(), 1);
        assert_eq!(apertures[0].polygon_ids, [7, 8]);
        assert_eq!(apertures[0].aperture.triangle_indices, [0, 1, 2, 3, 4, 5]);
    }

    fn triangle_gfx_obj() -> GfxObj {
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
            polygons: HashMap::from([(7, triangle_polygon())]),
            drawing_bsp: None,
            did_degrade: None,
        }
    }

    fn leaf() -> BspNode {
        BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: None,
            poly_ids: Vec::new(),
        })
    }

    fn triangle_polygon() -> Polygon {
        Polygon {
            num_pts: 3,
            stippling: 0,
            sides_type: CULL_MODE_COUNTER_CLOCKWISE,
            pos_surface: 0,
            neg_surface: 0,
            vertex_ids: vec![0, 1, 2],
            pos_uv_indices: vec![0, 0, 0],
            neg_uv_indices: vec![0, 0, 0],
        }
    }
}
