use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, EnvCellAssetAssembler, PreparedAabb,
    PreparedInteriorCell,
};
use holtburger_dat::{
    EOR_PORTAL_NAMESPACE, ResourceKey,
    file_type::{CSurface, CSurfaceSource, CellStruct, Environment},
    physics::BspNode,
};
use holtburger_common::Vector3;
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Cursor,
};

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
    #[arg(long, default_value = "da55010b")]
    env_cell: String,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let env_cell_id = u32::from_str_radix(args.env_cell.trim_start_matches("0x"), 16)?;
    let content = ContentRepository::from_hba_path(args.dats)?;
    let cache = ContentDecodeCache::new();
    let asset = EnvCellAssetAssembler::new().try_assemble_env_cell_with_cache(
        &content,
        &cache,
        env_cell_id,
    )?;

    println!("envCell=0x{:08x}", asset.env_cell.env_cell_id);
    println!(
        "environment=0x{:08x} cellStructure=0x{:08x}",
        asset.prepared_cell.environment_id, asset.prepared_cell.cell_structure_id
    );
    println!(
        "rawStatics={} preparedStaticMeshes={} renderTriangles={} surfaces={} portals={} apertures={} visibleCells={} seenOutside={:?} restriction={:?}",
        asset.env_cell.static_objects.len(),
        asset.static_meshes.len(),
        asset.prepared_cell.render_geometry.triangles.len(),
        asset.prepared_cell.surface_ids.len(),
        asset.prepared_cell.portals.len(),
        asset.prepared_cell.portal_apertures.len(),
        asset.env_cell.visible_cell_ids.len(),
        asset.env_cell.seen_outside,
        asset.env_cell.restriction_object_id,
    );
    if !asset.env_cell.visible_cell_ids.is_empty() {
        println!(
            "visible cells: {}",
            asset
                .env_cell
                .visible_cell_ids
                .iter()
                .map(|id| format!("0x{id:08x}"))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    println!("surface table:");
    for (index, surface_id) in asset.prepared_cell.surface_ids.iter().enumerate() {
        println!(
            "  slot={} raw=0x{:04x} did=0x{:08x} {}",
            index,
            surface_id & 0xffff,
            surface_id,
            describe_surface(&content, *surface_id),
        );
    }
    print_prepared_geometry(&asset.prepared_cell);
    if let Some(cell_structure) = load_cell_structure(&content, &asset.prepared_cell)? {
        print_cell_structure(cell_structure);
    }
    println!("raw static objects:");
    for static_object in &asset.env_cell.static_objects {
        println!(
            "  index={} did=0x{:08x} asset={} origin=({:.3},{:.3},{:.3})",
            static_object.source_index,
            static_object.source_did,
            static_object.source_asset_id,
            static_object.local_placement.origin.x,
            static_object.local_placement.origin.y,
            static_object.local_placement.origin.z,
        );
    }
    println!("prepared static meshes:");
    for mesh in &asset.static_meshes {
        println!(
            "  index={} part={} did=0x{:08x} gfx=0x{:08x} asset={} partPlacements={} bounds={} origin=({:.3},{:.3},{:.3})",
            mesh.source_index,
            mesh.part_index,
            mesh.source_did,
            mesh.gfx_obj_id,
            mesh.source_asset_id,
            mesh.part_placements.len(),
            mesh.instance_bounds.is_some(),
            mesh.local_placement.origin.x,
            mesh.local_placement.origin.y,
            mesh.local_placement.origin.z,
        );
    }
    println!("portals:");
    for portal in &asset.prepared_cell.portals {
        println!(
            "  id={} index={} flags=0x{:04x} polygon={} otherCell=0x{:04x} otherPortal=0x{:04x} target={} outsideTransition={}",
            portal.portal_id,
            portal.source_index,
            portal.flags,
            portal.polygon_id,
            portal.other_cell_id,
            portal.other_portal_id,
            portal
                .target_env_cell_id
                .map(|id| format!("0x{id:08x}"))
                .unwrap_or_else(|| "none".to_string()),
            portal.is_outside_transition,
        );
    }
    println!("portal apertures:");
    for aperture in &asset.prepared_cell.portal_apertures {
        println!(
            "  portal={} index={} polygon={} points={} plane={}",
            aperture.portal_id,
            aperture.source_index,
            aperture.polygon_id,
            aperture.points.len(),
            aperture
                .plane
                .map(|plane| {
                    format!(
                        "n=({:.6},{:.6},{:.6}) c={:.6} source={:?}",
                        plane.normal.x, plane.normal.y, plane.normal.z, plane.constant, plane.source
                    )
                })
                .unwrap_or_else(|| "none".to_string()),
        );
        for (point_index, point) in aperture.points.iter().enumerate() {
            println!(
                "    p{}=({:.6},{:.6},{:.6})",
                point_index, point.x, point.y, point.z
            );
        }
    }
    if !asset.diagnostics.errors.is_empty() {
        println!("errors:");
        for error in &asset.diagnostics.errors {
            println!(
                "  {} 0x{:08x} {} {} {}",
                error.namespace, error.file_id, error.role, error.error_code, error.detail
            );
        }
    }
    Ok(())
}

fn load_cell_structure<'a>(
    content: &ContentRepository,
    prepared_cell: &PreparedInteriorCell,
) -> Result<Option<CellStruct>> {
    let resource = content
        .read_resource(ResourceKey::new(
            EOR_PORTAL_NAMESPACE,
            prepared_cell.environment_id,
        ))
        .with_context(|| {
            format!(
                "failed to load environment 0x{:08x}",
                prepared_cell.environment_id
            )
        })?;
    let environment = Environment::unpack(&mut Cursor::new(resource.bytes)).with_context(|| {
        format!(
            "failed to decode environment 0x{:08x}",
            prepared_cell.environment_id
        )
    })?;
    Ok(environment
        .cells
        .get(&prepared_cell.cell_structure_id)
        .cloned())
}

fn print_prepared_geometry(cell: &PreparedInteriorCell) {
    let geometry = &cell.render_geometry;
    println!("prepared render geometry:");
    println!(
        "  source=0x{:08x} vertices={} triangles={} skipped={} invalid={} bounds={}",
        geometry.source_id,
        geometry.vertex_count,
        geometry.triangle_count,
        geometry.skipped_polygon_count,
        geometry.invalid_polygons.len(),
        geometry
            .bounds
            .map(format_bounds)
            .unwrap_or_else(|| "none".to_string()),
    );
    let mut polygon_triangles = BTreeMap::<u16, (usize, BTreeSet<Option<i16>>)>::new();
    for triangle in &geometry.triangles {
        let entry = polygon_triangles
            .entry(triangle.polygon_id)
            .or_insert_with(|| (0, BTreeSet::new()));
        entry.0 += 1;
        entry.1.insert(triangle.surface_id);
    }
    for (polygon_id, (triangle_count, surfaces)) in polygon_triangles {
        println!(
            "  polygon={} triangles={} surfaces={:?}",
            polygon_id, triangle_count, surfaces
        );
    }
    for invalid in &geometry.invalid_polygons {
        println!(
            "  invalid polygon={} reason={} vertices={:?} missing={:?}",
            invalid.polygon_id, invalid.reason, invalid.vertex_ids, invalid.missing_vertex_ids,
        );
    }
}

fn print_cell_structure(cell_structure: CellStruct) {
    println!("raw cell structure:");
    println!(
        "  id=0x{:08x} vertices={} polygons={} physicsPolygons={} portals={:?} drawingBsp={}",
        cell_structure.id,
        cell_structure.vertex_array.vertices.len(),
        cell_structure.polygons.len(),
        cell_structure.physics_polygons.len(),
        cell_structure.portals,
        cell_structure.drawing_bsp.is_some(),
    );
    let mut polygons = cell_structure.polygons.iter().collect::<Vec<_>>();
    polygons.sort_by_key(|(polygon_id, _)| **polygon_id);
    for (polygon_id, polygon) in polygons {
        println!(
            "  polygon={} pts={} sides={} stippling=0x{:02x} posSurface={} negSurface={} {} bounds={} vertices={:?}",
            polygon_id,
            polygon.num_pts,
            polygon.sides_type,
            polygon.stippling,
            polygon.pos_surface,
            polygon.neg_surface,
            polygon_bsp_membership(&cell_structure, polygon),
            polygon_bounds(&cell_structure, polygon)
                .map(format_bounds)
                .unwrap_or_else(|| "missing-vertices".to_string()),
            polygon.vertex_ids,
        );
    }
}

fn polygon_bsp_membership(
    cell_structure: &CellStruct,
    polygon: &holtburger_dat::graphics::Polygon,
) -> &'static str {
    let Some(center) = polygon_center(cell_structure, polygon) else {
        return "bsp=missing-vertices";
    };
    if !point_inside_cell_bsp(&cell_structure.cell_bsp, center) {
        return "bsp=center-outside";
    }
    if polygon.vertex_ids.iter().all(|vertex_id| {
        cell_structure
            .vertex_array
            .vertices
            .get(vertex_id)
            .is_some_and(|vertex| point_inside_cell_bsp(&cell_structure.cell_bsp, vertex.origin))
    }) {
        "bsp=inside"
    } else {
        "bsp=center-inside-vertex-outside"
    }
}

fn polygon_center(
    cell_structure: &CellStruct,
    polygon: &holtburger_dat::graphics::Polygon,
) -> Option<Vector3> {
    let mut center = Vector3::zero();
    for vertex_id in &polygon.vertex_ids {
        let vertex = cell_structure.vertex_array.vertices.get(vertex_id)?;
        center = center + vertex.origin;
    }
    Some(center * (1.0 / polygon.vertex_ids.len() as f32))
}

fn point_inside_cell_bsp(node: &BspNode, point: Vector3) -> bool {
    const EPSILON: f32 = 0.0002;
    let mut current = Some(node);
    while let Some(node) = current {
        match node {
            BspNode::Port(portal) => {
                if portal.plane.distance_to_point(&point) < -EPSILON {
                    return false;
                }
                current = Some(&portal.pos);
            }
            BspNode::Leaf(_) => return true,
            BspNode::Internal(internal) => {
                if internal.plane.distance_to_point(&point) < -EPSILON {
                    return false;
                }
                current = internal.pos.as_deref();
                if current.is_none() {
                    return true;
                }
            }
        }
    }
    true
}

fn polygon_bounds(
    cell_structure: &CellStruct,
    polygon: &holtburger_dat::graphics::Polygon,
) -> Option<PreparedAabb> {
    let mut bounds: Option<PreparedAabb> = None;
    for vertex_id in &polygon.vertex_ids {
        let vertex = cell_structure.vertex_array.vertices.get(vertex_id)?;
        let point = holtburger_content::PreparedVec3 {
            x: vertex.origin.x,
            y: vertex.origin.y,
            z: vertex.origin.z,
        };
        bounds = Some(match bounds {
            Some(bounds) => PreparedAabb {
                min: holtburger_content::PreparedVec3 {
                    x: bounds.min.x.min(point.x),
                    y: bounds.min.y.min(point.y),
                    z: bounds.min.z.min(point.z),
                },
                max: holtburger_content::PreparedVec3 {
                    x: bounds.max.x.max(point.x),
                    y: bounds.max.y.max(point.y),
                    z: bounds.max.z.max(point.z),
                },
            },
            None => PreparedAabb {
                min: point,
                max: point,
            },
        });
    }
    bounds
}

fn format_bounds(bounds: PreparedAabb) -> String {
    format!(
        "min=({:.3},{:.3},{:.3}) max=({:.3},{:.3},{:.3})",
        bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z
    )
}

fn describe_surface(content: &ContentRepository, surface_id: u32) -> String {
    let Ok(resource) = content.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, surface_id))
    else {
        return "surface=missing".to_string();
    };
    let Ok(surface) = CSurface::unpack(&mut Cursor::new(resource.bytes)) else {
        return "surface=decode-failed".to_string();
    };
    let source = match surface.source {
        CSurfaceSource::SolidColor(color) => format!("solid=0x{color:08x}"),
        CSurfaceSource::Texture {
            orig_texture_id,
            orig_palette_id,
        } => format!("texture=0x{orig_texture_id:08x} palette=0x{orig_palette_id:08x}"),
    };
    format!(
        "type={:?} translucency={:.3} luminosity={:.3} diffuse={:.3} {}",
        surface.surface_type, surface.translucency, surface.luminosity, surface.diffuse, source
    )
}
