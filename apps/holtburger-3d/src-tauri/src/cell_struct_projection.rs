use anyhow::{Context, Result, ensure};
use holtburger_common::{Plane, Vector3};
use holtburger_dat::file_type::environment::CellStruct;
use holtburger_dat::physics::BspNode;

use crate::polygon_geometry::{PolygonSetGeometry, PolygonSideKind, build_polygon_set_geometry};
use crate::portal_geometry::{PORTAL_PLANE_EPSILON, PortalAperture, build_portal_aperture};

/// Complete source identity needed to diagnose one EnvCell-selected CellStruct projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellStructProjectionContext {
    pub landblock_id: u32,
    pub env_cell_id: u32,
    pub environment_id: u32,
    pub cell_structure_id: u32,
    pub surface_count: usize,
}

/// Renderer-neutral local geometry and containment facts selected for one EnvCell.
#[derive(Debug)]
pub struct CellStructProjection {
    pub shell: PolygonSetGeometry,
    pub apertures: Vec<CellStructPortalAperture>,
    pub containment_hull: CellContainmentHull,
}

/// One CellStruct portal polygon projected independently from visible shell ranges.
#[derive(Debug, Clone, PartialEq)]
pub struct CellStructPortalAperture {
    pub cell_struct_portal_index: usize,
    pub polygon_id: u16,
    pub aperture: PortalAperture,
}

/// Normalized positive-child plane chain used by retail point containment.
#[derive(Debug, Clone)]
pub struct CellContainmentHull {
    pub planes: Vec<Plane>,
}

impl CellContainmentHull {
    /// Apply the retail `0.0002` positive-side tolerance in CellStruct-local AC coordinates.
    pub fn contains(&self, point: Vector3) -> bool {
        self.planes
            .iter()
            .all(|plane| plane.distance_to_point(&point) >= -PORTAL_PLANE_EPSILON)
    }
}

/// Project all CellStruct render polygons, portal apertures, and containment planes.
pub fn project_cell_struct(
    context: CellStructProjectionContext,
    cell_struct: &CellStruct,
) -> Result<CellStructProjection> {
    ensure!(
        cell_struct.id == context.cell_structure_id,
        "{} selected CellStruct 0x{:04X}, but decoded 0x{:04X}",
        source_label(context),
        context.cell_structure_id,
        cell_struct.id
    );
    let mut polygons = cell_struct.polygons.iter().collect::<Vec<_>>();
    polygons.sort_by_key(|(polygon_id, _)| **polygon_id);
    let shell = build_polygon_set_geometry(
        &cell_struct.vertex_array,
        polygons
            .into_iter()
            .map(|(polygon_id, polygon)| (*polygon_id, polygon)),
        |polygon_id, side_kind, surface_index| {
            select_shell_side(context, polygon_id, side_kind, surface_index)
        },
    )
    .with_context(|| format!("Could not project {} shell", source_label(context)))?;

    let apertures = cell_struct
        .portals
        .iter()
        .copied()
        .enumerate()
        .map(|(portal_index, polygon_id)| {
            let polygon = cell_struct.polygons.get(&polygon_id).with_context(|| {
                format!(
                    "{} portal {portal_index} references missing polygon {polygon_id}",
                    source_label(context)
                )
            })?;
            let aperture = build_portal_aperture(&cell_struct.vertex_array, polygon_id, polygon)
                .with_context(|| {
                    format!(
                        "Could not project {} portal {portal_index} polygon {polygon_id}",
                        source_label(context)
                    )
                })?;
            Ok(CellStructPortalAperture {
                cell_struct_portal_index: portal_index,
                polygon_id,
                aperture,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let containment_hull = project_containment_hull(&cell_struct.cell_bsp).with_context(|| {
        format!(
            "Could not project {} containment hull",
            source_label(context)
        )
    })?;

    Ok(CellStructProjection {
        shell,
        apertures,
        containment_hull,
    })
}

fn select_shell_side(
    context: CellStructProjectionContext,
    polygon_id: u16,
    side_kind: PolygonSideKind,
    surface_index: i16,
) -> Result<bool> {
    if surface_index < 0 {
        return Ok(false);
    }
    let slot = usize::try_from(surface_index)
        .expect("non-negative i16 surface index must convert to usize");
    ensure!(
        slot < context.surface_count,
        "{} polygon {polygon_id} {side_kind:?} side references surface slot {slot}, but EnvCell has {} surfaces",
        source_label(context),
        context.surface_count
    );
    Ok(true)
}

fn project_containment_hull(root: &BspNode) -> Result<CellContainmentHull> {
    let mut planes = Vec::new();
    let mut current = root;
    loop {
        match current {
            BspNode::Port(portal) => {
                planes.push(normalized_plane(portal.plane)?);
                current = &portal.pos;
            }
            BspNode::Internal(internal) => {
                planes.push(normalized_plane(internal.plane)?);
                let Some(positive) = internal.pos.as_deref() else {
                    break;
                };
                current = positive;
            }
            BspNode::Leaf(_) => break,
        }
    }
    Ok(CellContainmentHull { planes })
}

fn normalized_plane(plane: Plane) -> Result<Plane> {
    ensure!(
        [plane.normal.x, plane.normal.y, plane.normal.z, plane.d]
            .into_iter()
            .all(f32::is_finite),
        "containment plane contains non-finite values"
    );
    let length = plane.normal.length();
    ensure!(
        length > 0.0 && length.is_finite(),
        "containment plane has a degenerate normal"
    );
    Ok(Plane {
        normal: plane.normal / length,
        d: plane.d / length,
    })
}

fn source_label(context: CellStructProjectionContext) -> String {
    format!(
        "landblock 0x{:08X} EnvCell 0x{:08X} Environment 0x{:08X} CellStruct 0x{:04X}",
        context.landblock_id,
        context.env_cell_id,
        context.environment_id,
        context.cell_structure_id
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use holtburger_dat::graphics::{CVertexArray, Polygon, SWVertex, Vec2Duv};
    use holtburger_dat::physics::{BspLeaf, InternalNode};

    use super::*;

    #[test]
    fn selects_all_shell_polygons_but_omits_material_free_sides() {
        let mut cell = triangle_cell_struct();
        cell.polygons.get_mut(&8).unwrap().pos_surface = -1;

        let projection = project_cell_struct(context(1), &cell).unwrap();

        assert_eq!(projection.shell.triangles.len(), 1);
        assert_eq!(projection.shell.triangles[0].polygon_id, 7);
        assert_eq!(projection.apertures.len(), 1);
        assert_eq!(projection.apertures[0].polygon_id, 8);
        assert!(projection.containment_hull.planes.is_empty());
    }

    #[test]
    fn rejects_out_of_range_env_cell_surface_slot_with_full_identity() {
        let cell = triangle_cell_struct();

        let error = project_cell_struct(context(0), &cell).unwrap_err();
        let message = format!("{error:#}");

        assert!(message.contains("landblock 0x1234FFFF"));
        assert!(message.contains("EnvCell 0x12340100"));
        assert!(message.contains("Environment 0x0D000001"));
        assert!(message.contains("CellStruct 0x0011"));
        assert!(message.contains("surface slot 0"));
    }

    #[test]
    fn compact_hull_matches_synthetic_full_positive_bsp_walk() {
        let bsp = internal(
            Plane {
                normal: Vector3::new(2.0, 0.0, 0.0),
                d: 0.0,
            },
            Some(internal(
                Plane {
                    normal: Vector3::new(0.0, 3.0, 0.0),
                    d: -3.0,
                },
                Some(leaf()),
            )),
        );
        let hull = project_containment_hull(&bsp).unwrap();

        for point in [
            Vector3::new(0.0, 1.0, 0.0),
            Vector3::new(-0.001, 1.0, 0.0),
            Vector3::new(1.0, 0.999, 0.0),
            Vector3::new(1.0, 2.0, 0.0),
        ] {
            assert_eq!(
                hull.contains(point),
                full_positive_walk_contains(&bsp, point),
                "point {point:?}"
            );
        }
        assert_eq!(hull.planes.len(), 2);
    }

    fn full_positive_walk_contains(node: &BspNode, point: Vector3) -> bool {
        match node {
            BspNode::Port(portal) => {
                portal.plane.distance_to_point(&point) >= -PORTAL_PLANE_EPSILON
                    && full_positive_walk_contains(&portal.pos, point)
            }
            BspNode::Internal(internal) => {
                let normalized = normalized_plane(internal.plane).unwrap();
                normalized.distance_to_point(&point) >= -PORTAL_PLANE_EPSILON
                    && internal
                        .pos
                        .as_deref()
                        .is_none_or(|positive| full_positive_walk_contains(positive, point))
            }
            BspNode::Leaf(_) => true,
        }
    }

    fn context(surface_count: usize) -> CellStructProjectionContext {
        CellStructProjectionContext {
            landblock_id: 0x1234_ffff,
            env_cell_id: 0x1234_0100,
            environment_id: 0x0d00_0001,
            cell_structure_id: 0x11,
            surface_count,
        }
    }

    fn triangle_cell_struct() -> CellStruct {
        let vertex_array = CVertexArray {
            vertex_type: 1,
            vertices: [
                (0, Vector3::new(0.0, 0.0, 0.0)),
                (1, Vector3::new(1.0, 0.0, 0.0)),
                (2, Vector3::new(0.0, 1.0, 0.0)),
            ]
            .into_iter()
            .map(|(id, origin)| {
                (
                    id,
                    SWVertex {
                        num_uvs: 1,
                        origin,
                        normal: Vector3::new(0.0, 0.0, 1.0),
                        uvs: vec![Vec2Duv { u: 0.0, v: 0.0 }],
                    },
                )
            })
            .collect(),
        };
        CellStruct {
            id: 0x11,
            vertex_array,
            polygons: HashMap::from([(7, triangle_polygon()), (8, triangle_polygon())]),
            portals: vec![8],
            cell_bsp: leaf(),
            physics_polygons: HashMap::new(),
            physics_bsp: leaf(),
            drawing_bsp: None,
        }
    }

    fn triangle_polygon() -> Polygon {
        Polygon {
            num_pts: 3,
            stippling: 0,
            sides_type: 3,
            pos_surface: 0,
            neg_surface: 0,
            vertex_ids: vec![0, 1, 2],
            pos_uv_indices: vec![0, 0, 0],
            neg_uv_indices: Vec::new(),
        }
    }

    fn internal(plane: Plane, pos: Option<BspNode>) -> BspNode {
        BspNode::Internal(InternalNode {
            tag: *b"BPnn",
            plane,
            pos: pos.map(Box::new),
            neg: None,
            sphere: None,
            poly_ids: Vec::new(),
        })
    }

    fn leaf() -> BspNode {
        BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: None,
            poly_ids: Vec::new(),
        })
    }
}
