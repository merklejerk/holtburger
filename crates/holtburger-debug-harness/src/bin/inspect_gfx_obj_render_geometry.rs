use std::collections::{BTreeMap, BTreeSet};
use std::io::Cursor;

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::build_gfx_obj_render_geometry;
use holtburger_dat::file_type::{CSurface, CSurfaceSource, GfxObj};
use holtburger_dat::graphics::Polygon;
use holtburger_dat::physics::BspNode;
use holtburger_dat::{EOR_PORTAL_NAMESPACE, HbaReader};

const STIPPLING_NO_POS: u8 = 0x04;
const STIPPLING_NO_NEG: u8 = 0x08;
const STIPPLING_REPEAT_POS: u8 = 0x01;
const STIPPLING_REPEAT_NEG: u8 = 0x02;
const CULL_MODE_NONE: i32 = 1;
const CULL_MODE_CLOCKWISE: i32 = 2;

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
    #[arg(long)]
    gfx_obj: String,
    #[arg(long)]
    surface_slot: Option<i16>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let gfx_obj_id = parse_gfx_obj_id(&args.gfx_obj)?;
    let archive = HbaReader::open(&args.dats)
        .with_context(|| format!("failed to open HBA archive {}", args.dats))?;
    let bytes = archive
        .get_file_in_namespace(EOR_PORTAL_NAMESPACE, gfx_obj_id)
        .with_context(|| format!("failed to read gfx-obj 0x{gfx_obj_id:08X}"))?;
    let gfx_obj = GfxObj::unpack(&mut Cursor::new(bytes))
        .with_context(|| format!("failed to decode gfx-obj 0x{gfx_obj_id:08X}"))?;
    let render_geometry = build_gfx_obj_render_geometry(&gfx_obj);
    let drawing_bsp_polygon_ids = gfx_obj
        .drawing_bsp
        .as_ref()
        .map(collect_bsp_polygon_ids)
        .unwrap_or_default();
    let rendered_polygon_ids = render_geometry
        .triangles
        .iter()
        .map(|triangle| triangle.polygon_id)
        .collect::<BTreeSet<_>>();

    println!("gfxObj=0x{gfx_obj_id:08X}");
    println!(
        "surfaces={} vertices={} physicsPolygons={} drawingPolygons={} drawingBspPolygons={}",
        gfx_obj.surfaces.len(),
        gfx_obj.vertex_array.vertices.len(),
        gfx_obj.physics_polygons.len(),
        gfx_obj.polygons.len(),
        drawing_bsp_polygon_ids.len(),
    );
    for (slot_index, surface_id) in gfx_obj.surfaces.iter().enumerate() {
        println!(
            "  surfaceSlot={slot_index} material=0x{surface_id:08X} {}",
            describe_c_surface(&archive, *surface_id),
        );
    }
    println!(
        "prepared vertices={} triangles={} surfaces={:?} skippedPolygons={} invalidPolygons={}",
        render_geometry.vertex_count,
        render_geometry.triangle_count,
        render_geometry.surface_ids,
        render_geometry.skipped_polygon_count,
        render_geometry.invalid_polygons.len(),
    );
    print_triangle_counts(&render_geometry.triangles);
    print_raw_polygon_counts(&gfx_obj.polygons);
    print_policy_sensitive_polygons(&gfx_obj, &drawing_bsp_polygon_ids);
    print_polygon_side_details(&gfx_obj, args.surface_slot);
    print_unrendered_polygons(&gfx_obj, &drawing_bsp_polygon_ids, &rendered_polygon_ids);

    Ok(())
}

fn parse_gfx_obj_id(value: &str) -> Result<u32> {
    let hex = value
        .trim()
        .trim_start_matches("gfx-obj/")
        .trim_start_matches("0x")
        .trim_start_matches("0X");
    u32::from_str_radix(hex, 16).with_context(|| format!("invalid gfx object id {value}"))
}

fn describe_c_surface(archive: &HbaReader, surface_id: u32) -> String {
    let Ok(bytes) = archive.get_file_in_namespace(EOR_PORTAL_NAMESPACE, surface_id) else {
        return "surface=<missing>".to_string();
    };
    let Ok(surface) = CSurface::unpack(&mut Cursor::new(bytes)) else {
        return "surface=<decode-error>".to_string();
    };
    let source = match surface.source {
        CSurfaceSource::SolidColor(color) => format!("solidColor=0x{color:08X}"),
        CSurfaceSource::Texture {
            orig_texture_id,
            orig_palette_id,
        } => format!("texture=0x{orig_texture_id:08X} palette=0x{orig_palette_id:08X}"),
    };
    format!(
        "surfaceType={:?} {source} translucency={:.3} luminosity={:.3} diffuse={:.3}",
        surface.surface_type, surface.translucency, surface.luminosity, surface.diffuse,
    )
}

fn collect_bsp_polygon_ids(node: &BspNode) -> BTreeSet<u16> {
    let mut polygon_ids = BTreeSet::new();
    collect_bsp_node_polygon_ids(node, &mut polygon_ids);
    polygon_ids
}

fn collect_bsp_node_polygon_ids(node: &BspNode, polygon_ids: &mut BTreeSet<u16>) {
    match node {
        BspNode::Port(portal) => {
            polygon_ids.extend(portal.poly_ids.iter().copied());
            collect_bsp_node_polygon_ids(&portal.pos, polygon_ids);
            collect_bsp_node_polygon_ids(&portal.neg, polygon_ids);
        }
        BspNode::Leaf(leaf) => {
            polygon_ids.extend(leaf.poly_ids.iter().copied());
        }
        BspNode::Internal(internal) => {
            polygon_ids.extend(internal.poly_ids.iter().copied());
            if let Some(pos) = &internal.pos {
                collect_bsp_node_polygon_ids(pos, polygon_ids);
            }
            if let Some(neg) = &internal.neg {
                collect_bsp_node_polygon_ids(neg, polygon_ids);
            }
        }
    }
}

fn print_triangle_counts(triangles: &[holtburger_content::PreparedPolygonSetRenderTriangle]) {
    let mut by_surface_and_variant = BTreeMap::<String, usize>::new();
    for triangle in triangles {
        let variant = triangle.material_variant_signature.as_str();
        let surface = triangle
            .surface_id
            .map(|surface_id| surface_id.to_string())
            .unwrap_or_else(|| "none".to_string());
        *by_surface_and_variant
            .entry(format!("surface={surface}:variant={variant}"))
            .or_default() += 1;
    }
    println!("prepared triangle counts by geometry surface/variant:");
    for (key, count) in by_surface_and_variant {
        println!("  {key} triangles={count}");
    }
}

fn print_raw_polygon_counts(polygons: &std::collections::HashMap<u16, Polygon>) {
    let mut by_side_type = BTreeMap::<i32, usize>::new();
    let mut by_stippling = BTreeMap::<u8, usize>::new();
    let mut by_pos_surface = BTreeMap::<i16, usize>::new();
    for polygon in polygons.values() {
        *by_side_type.entry(polygon.sides_type).or_default() += 1;
        *by_stippling.entry(polygon.stippling).or_default() += 1;
        *by_pos_surface.entry(polygon.pos_surface).or_default() += 1;
    }
    println!("raw drawing polygon counts:");
    println!("  sideTypes={by_side_type:?}");
    println!("  stippling={by_stippling:?}");
    println!("  posSurfaces={by_pos_surface:?}");
}

fn print_policy_sensitive_polygons(gfx_obj: &GfxObj, drawing_bsp_polygon_ids: &BTreeSet<u16>) {
    let mut rows = Vec::new();
    for (polygon_id, polygon) in BTreeMap::from_iter(gfx_obj.polygons.clone()) {
        let no_pos = (polygon.stippling & STIPPLING_NO_POS) != 0;
        let outside_drawing_bsp =
            !drawing_bsp_polygon_ids.is_empty() && !drawing_bsp_polygon_ids.contains(&polygon_id);
        if !no_pos && !outside_drawing_bsp {
            continue;
        }
        rows.push(format!(
            "polygon={polygon_id} outsideDrawingBsp={outside_drawing_bsp} noPos={no_pos} stippling=0x{:02X} sidesType={} posSurface={} negSurface={} points={} posUvs={} negUvs={} vertexIds={:?} {}",
            polygon.stippling,
            polygon.sides_type,
            polygon.pos_surface,
            polygon.neg_surface,
            polygon.vertex_ids.len(),
            polygon.pos_uv_indices.len(),
            polygon.neg_uv_indices.len(),
            polygon.vertex_ids,
            format_polygon_vertices(gfx_obj, &polygon),
        ));
    }
    println!("policy-sensitive drawing polygons={}", rows.len());
    for line in rows {
        println!("  {line}");
    }
}

fn print_polygon_side_details(gfx_obj: &GfxObj, surface_slot_filter: Option<i16>) {
    let mut rows = Vec::new();
    for (polygon_id, polygon) in BTreeMap::from_iter(gfx_obj.polygons.clone()) {
        for side in polygon_render_sides(&polygon) {
            if surface_slot_filter.is_some_and(|surface_slot| surface_slot != side.surface_slot) {
                continue;
            }
            rows.push(format!(
                "polygon={polygon_id} side={} surfaceSlot={} variant={} stippling=0x{:02X} sidesType={} points={} vertexIds={:?} {} {}",
                side.label,
                side.surface_slot,
                if side.repeats {
                    "sampler=repeat"
                } else {
                    "sampler=clamp"
                },
                polygon.stippling,
                polygon.sides_type,
                polygon.vertex_ids.len(),
                polygon.vertex_ids,
                format_polygon_vertices(gfx_obj, &polygon),
                format_polygon_uvs(gfx_obj, &polygon, side.uv_indices),
            ));
        }
    }

    match surface_slot_filter {
        Some(surface_slot) => {
            println!("polygon side details for surfaceSlot={surface_slot}:");
        }
        None => {
            println!("polygon side details:");
        }
    }
    for line in rows {
        println!("  {line}");
    }
}

struct PolygonRenderSide<'a> {
    label: &'static str,
    surface_slot: i16,
    repeats: bool,
    uv_indices: &'a [u8],
}

fn polygon_render_sides(polygon: &Polygon) -> Vec<PolygonRenderSide<'_>> {
    let mut sides = Vec::with_capacity(2);
    if positive_side_is_renderable(polygon) {
        sides.push(PolygonRenderSide {
            label: "positive",
            repeats: (polygon.stippling & STIPPLING_REPEAT_POS) != 0,
            surface_slot: polygon.pos_surface,
            uv_indices: &polygon.pos_uv_indices,
        });
    }
    if polygon.sides_type == CULL_MODE_CLOCKWISE && negative_side_is_renderable(polygon) {
        sides.push(PolygonRenderSide {
            label: "negative",
            repeats: (polygon.stippling & STIPPLING_REPEAT_NEG) != 0,
            surface_slot: polygon.neg_surface,
            uv_indices: &polygon.neg_uv_indices,
        });
    }
    sides
}

fn format_polygon_vertices(gfx_obj: &GfxObj, polygon: &Polygon) -> String {
    let mut min = None::<(f32, f32, f32)>;
    let mut max = None::<(f32, f32, f32)>;
    let mut points = Vec::new();

    for vertex_id in &polygon.vertex_ids {
        let Some(vertex) = gfx_obj.vertex_array.vertices.get(vertex_id) else {
            points.push(format!("{vertex_id}:<missing>"));
            continue;
        };
        let point = (vertex.origin.x, vertex.origin.y, vertex.origin.z);
        min = Some(expand_min(min.unwrap_or(point), point));
        max = Some(expand_max(max.unwrap_or(point), point));
        points.push(format!(
            "{}:({:.3},{:.3},{:.3})",
            vertex_id, vertex.origin.x, vertex.origin.y, vertex.origin.z
        ));
    }

    let bounds = match (min, max) {
        (Some(min), Some(max)) => format!(
            "bounds=min({:.3},{:.3},{:.3}) max({:.3},{:.3},{:.3})",
            min.0, min.1, min.2, max.0, max.1, max.2
        ),
        _ => "bounds=none".to_string(),
    };
    format!("{bounds} vertices=[{}]", points.join(","))
}

fn format_polygon_uvs(gfx_obj: &GfxObj, polygon: &Polygon, uv_indices: &[u8]) -> String {
    if uv_indices.len() != polygon.vertex_ids.len() {
        return format!("uvs=<malformed:{}>", uv_indices.len());
    }

    let mut min = None::<(f32, f32)>;
    let mut max = None::<(f32, f32)>;
    let mut points = Vec::new();
    for (vertex_id, uv_index) in polygon.vertex_ids.iter().zip(uv_indices) {
        let Some(uv) = gfx_obj
            .vertex_array
            .vertices
            .get(vertex_id)
            .and_then(|vertex| vertex.uvs.get(usize::from(*uv_index)))
        else {
            points.push(format!("{vertex_id}:uv{uv_index}:<missing>"));
            continue;
        };
        let point = (uv.u, uv.v);
        min = Some(expand_uv_min(min.unwrap_or(point), point));
        max = Some(expand_uv_max(max.unwrap_or(point), point));
        points.push(format!(
            "{vertex_id}:uv{uv_index}=({:.6},{:.6})",
            uv.u, uv.v
        ));
    }

    let range = match (min, max) {
        (Some(min), Some(max)) => format!(
            "uvRange=min({:.6},{:.6}) max({:.6},{:.6}) wraps={}",
            min.0,
            min.1,
            max.0,
            max.1,
            min.0 < 0.0 || min.1 < 0.0 || max.0 > 1.0 || max.1 > 1.0
        ),
        _ => "uvRange=none".to_string(),
    };
    format!("{range} uvs=[{}]", points.join(","))
}

fn expand_min(left: (f32, f32, f32), right: (f32, f32, f32)) -> (f32, f32, f32) {
    (
        left.0.min(right.0),
        left.1.min(right.1),
        left.2.min(right.2),
    )
}

fn expand_max(left: (f32, f32, f32), right: (f32, f32, f32)) -> (f32, f32, f32) {
    (
        left.0.max(right.0),
        left.1.max(right.1),
        left.2.max(right.2),
    )
}

fn expand_uv_min(left: (f32, f32), right: (f32, f32)) -> (f32, f32) {
    (left.0.min(right.0), left.1.min(right.1))
}

fn expand_uv_max(left: (f32, f32), right: (f32, f32)) -> (f32, f32) {
    (left.0.max(right.0), left.1.max(right.1))
}

fn print_unrendered_polygons(
    gfx_obj: &GfxObj,
    drawing_bsp_polygon_ids: &BTreeSet<u16>,
    rendered_polygon_ids: &BTreeSet<u16>,
) {
    let mut unrendered = Vec::new();
    for (polygon_id, polygon) in BTreeMap::from_iter(gfx_obj.polygons.clone()) {
        if rendered_polygon_ids.contains(&polygon_id) {
            continue;
        }
        unrendered.push(format!(
            "polygon={polygon_id} reason={} stippling=0x{:02X} sidesType={} posSurface={} negSurface={} points={} posUvs={} negUvs={}",
            classify_unrendered_polygon(
                polygon_id,
                &polygon,
                drawing_bsp_polygon_ids,
                &gfx_obj.vertex_array.vertices,
            ),
            polygon.stippling,
            polygon.sides_type,
            polygon.pos_surface,
            polygon.neg_surface,
            polygon.vertex_ids.len(),
            polygon.pos_uv_indices.len(),
            polygon.neg_uv_indices.len(),
        ));
    }
    println!("unrendered drawing polygons={}", unrendered.len());
    for line in unrendered {
        println!("  {line}");
    }
}

fn classify_unrendered_polygon(
    polygon_id: u16,
    polygon: &Polygon,
    drawing_bsp_polygon_ids: &BTreeSet<u16>,
    vertices: &std::collections::HashMap<u16, holtburger_dat::graphics::SWVertex>,
) -> String {
    if !drawing_bsp_polygon_ids.is_empty() && !drawing_bsp_polygon_ids.contains(&polygon_id) {
        return "not-in-drawing-bsp".to_string();
    }
    if polygon.vertex_ids.len() < 3 {
        return "too-few-vertices".to_string();
    }
    if polygon.num_pts as usize != polygon.vertex_ids.len() {
        return "num-pts-mismatch".to_string();
    }
    if polygon
        .vertex_ids
        .iter()
        .any(|vertex_id| !vertices.contains_key(vertex_id))
    {
        return "missing-vertex".to_string();
    }
    if derive_renderable_side_count(polygon) == 0 {
        return "no-renderable-side".to_string();
    }
    "unknown".to_string()
}

fn derive_renderable_side_count(polygon: &Polygon) -> usize {
    let mut count = usize::from(positive_side_is_renderable(polygon));
    match polygon.sides_type {
        CULL_MODE_NONE if positive_side_is_renderable(polygon) => {
            count += 1;
        }
        CULL_MODE_CLOCKWISE if negative_side_is_renderable(polygon) => {
            count += 1;
        }
        _ => {}
    }
    count
}

fn positive_side_is_renderable(polygon: &Polygon) -> bool {
    (polygon.stippling & STIPPLING_NO_POS) != 0
        || polygon.pos_uv_indices.len() == polygon.vertex_ids.len()
}

fn negative_side_is_renderable(polygon: &Polygon) -> bool {
    polygon.sides_type == CULL_MODE_CLOCKWISE
        && (polygon.stippling & STIPPLING_NO_NEG) == 0
        && polygon.neg_uv_indices.len() == polygon.vertex_ids.len()
}
