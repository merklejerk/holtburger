use anyhow::Result;
use clap::Parser;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockEnvCellsAssetAssembler, PreparedAabb,
    PreparedBvhKindMask, PreparedEnvCellLocalBvhItem, PreparedVec3, normalize_landblock_id,
};
use holtburger_dat::physics::BspNode;

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
    #[arg(long, default_value = "da55ffff")]
    landblock: String,
    #[arg(long)]
    point: Option<String>,
    #[arg(long, default_value_t = 20)]
    limit: usize,
    #[arg(long)]
    detail_cell: Option<String>,
    #[arg(long)]
    bsp_bounds: bool,
    #[arg(long)]
    bsp_bounds_summary_only: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let landblock_id = normalize_landblock_id(u32::from_str_radix(
        args.landblock.trim_start_matches("0x"),
        16,
    )?);
    let probe_point = args.point.as_deref().map(parse_point).transpose()?;
    let content = ContentRepository::from_hba_path(args.dats)?;
    let cache = ContentDecodeCache::new();
    let asset = LandblockEnvCellsAssetAssembler::new().assemble_landblock_with_cache(
        &content,
        &cache,
        landblock_id,
    )?;

    println!("landblock=0x{landblock_id:08x}");
    println!(
        "envCells={} bvhItems={} bvhNodes={}",
        asset.env_cells.len(),
        asset.landblock_bvh_items.len(),
        asset
            .landblock_bvh
            .as_ref()
            .map(|bvh| bvh.nodes.len())
            .unwrap_or(0)
    );

    let items = &asset.landblock_bvh_items;
    let overlapping_pairs = count_overlapping_pairs(items);
    println!("overlappingPairs={overlapping_pairs}");
    if let Some(root) = asset
        .landblock_bvh
        .as_ref()
        .and_then(|bvh| bvh.nodes.first())
    {
        println!("rootBounds={}", format_bounds(&root.bounds));
    }

    if let Some(point) = probe_point {
        let containing = items
            .iter()
            .filter(|item| contains_point(&item.bounds, point))
            .collect::<Vec<_>>();
        println!(
            "point=({:.3},{:.3},{:.3}) containingItems={}",
            point.x,
            point.y,
            point.z,
            containing.len()
        );
        for item in containing.iter().take(args.limit) {
            println!(
                "  contains envCell=0x{:08x} center={} volume={:.3} bounds={}",
                item.env_cell_id,
                format_point(center(&item.bounds)),
                volume(&item.bounds),
                format_bounds(&item.bounds)
            );
        }
    }

    for cell in asset.env_cells.iter().take(args.limit) {
        let bounds_text = cell
            .landblock_bounds
            .as_ref()
            .map(format_bounds)
            .unwrap_or_else(|| "none".to_string());
        println!(
            "cell=0x{:08x} placementOrigin=({:.3},{:.3},{:.3}) localBvhItems={} landblockBounds={}",
            cell.env_cell.env_cell_id,
            cell.env_cell.local_placement.origin.x,
            cell.env_cell.local_placement.origin.y,
            cell.env_cell.local_placement.origin.z,
            cell.local_bvh_items.len(),
            bounds_text
        );
    }

    if args.bsp_bounds {
        let mut cells_with_bounds = 0usize;
        let mut cells_without_bounds = 0usize;
        let mut cells_with_suspicious_bounds = 0usize;
        let mut cells_with_render_bounds = 0usize;
        let mut cells_without_render_bounds = 0usize;
        let mut cells_matching_render_bounds = 0usize;
        let mut cells_not_containing_render_bounds = 0usize;
        if !args.bsp_bounds_summary_only {
            println!("cellBspPlaneTripleBounds:");
        }
        for cell in &asset.env_cells {
            let plane_count = count_bsp_planes(&cell.prepared_cell.cell_bsp);
            let bsp_bounds = derive_cell_bsp_render_bounds_by_plane_triples(
                &cell.prepared_cell.cell_bsp,
            );
            match bsp_bounds {
                Some(bounds) => {
                    cells_with_bounds += 1;
                    if let Some(render_bounds) = &cell.prepared_cell.render_geometry.bounds {
                        cells_with_render_bounds += 1;
                        if approx_same_bounds(&bounds, render_bounds, 0.002) {
                            cells_matching_render_bounds += 1;
                        }
                        if !contains_bounds(&bounds, render_bounds, 0.002) {
                            cells_not_containing_render_bounds += 1;
                        }
                    } else {
                        cells_without_render_bounds += 1;
                    }
                    let suspicious = is_suspicious_bounds(&bounds);
                    if suspicious {
                        cells_with_suspicious_bounds += 1;
                    }
                    if !args.bsp_bounds_summary_only {
                        let render_text = cell
                            .prepared_cell
                            .render_geometry
                            .bounds
                            .as_ref()
                            .map(format_bounds)
                            .unwrap_or_else(|| "none".to_string());
                        println!(
                            "  cell=0x{:08x} planes={} bspBounds={} renderBounds={} suspicious={}",
                            cell.env_cell.env_cell_id,
                            plane_count,
                            format_bounds(&bounds),
                            render_text,
                            suspicious
                        );
                    }
                }
                None => {
                    cells_without_bounds += 1;
                    if !args.bsp_bounds_summary_only {
                        println!(
                            "  cell=0x{:08x} planes={} bspBounds=none renderBounds={}",
                            cell.env_cell.env_cell_id,
                            plane_count,
                            cell.prepared_cell
                                .render_geometry
                                .bounds
                                .as_ref()
                                .map(format_bounds)
                                .unwrap_or_else(|| "none".to_string())
                        );
                    }
                }
            }
        }
        println!(
            "cellBspPlaneTripleSummary cells={} withBounds={} withoutBounds={} suspicious={} withRenderBounds={} withoutRenderBounds={} matchingRenderBounds={} notContainingRenderBounds={}",
            asset.env_cells.len(),
            cells_with_bounds,
            cells_without_bounds,
            cells_with_suspicious_bounds,
            cells_with_render_bounds,
            cells_without_render_bounds,
            cells_matching_render_bounds,
            cells_not_containing_render_bounds
        );
    }

    if let Some(detail_cell) = args.detail_cell.as_deref() {
        let env_cell_id = parse_hex_u32(detail_cell)?;
        let Some(cell) = asset
            .env_cells
            .iter()
            .find(|cell| cell.env_cell.env_cell_id == env_cell_id)
        else {
            anyhow::bail!("env cell 0x{env_cell_id:08x} not found");
        };
        println!("detailCell=0x{env_cell_id:08x}");
        if let Some(bounds) = &cell.prepared_cell.render_geometry.bounds {
            println!("  renderGeometryBounds={}", format_bounds(bounds));
        } else {
            println!("  renderGeometryBounds=none");
        }
        if let Some(root) = cell.local_bvh.as_ref().and_then(|bvh| bvh.nodes.first()) {
            println!("  localBvhRoot={}", format_bounds(&root.bounds));
        } else {
            println!("  localBvhRoot=none");
        }
        if let Some(bounds) = &cell.landblock_bounds {
            println!("  landblockBounds={}", format_bounds(bounds));
        } else {
            println!("  landblockBounds=none");
        }
        if let Some(local_bvh) = &cell.local_bvh {
            for (index, node) in local_bvh.nodes.iter().enumerate() {
                if node.item_indices.is_empty() {
                    continue;
                }
                println!(
                    "  localLeafNode[{index}] items={:?} kindMask={} bounds={}",
                    node.item_indices,
                    format_kind_mask(node.kind_mask),
                    format_bounds(&node.bounds)
                );
            }
        }
        for (index, item) in cell.local_bvh_items.iter().enumerate() {
            println!("  localItem[{index}] kind={}", format_local_bvh_item(item));
        }
        for mesh in &cell.static_meshes {
            let bounds_text = mesh
                .instance_bounds
                .as_ref()
                .map(format_bounds)
                .unwrap_or_else(|| "none".to_string());
            println!(
                "  static instance={} source=0x{:08x} part={} placementOrigin=({:.3},{:.3},{:.3}) instanceBounds={}",
                mesh.instance_id,
                mesh.source_did,
                mesh.part_index,
                mesh.local_placement.origin.x,
                mesh.local_placement.origin.y,
                mesh.local_placement.origin.z,
                bounds_text
            );
        }
    }

    Ok(())
}

fn format_kind_mask(kind_mask: PreparedBvhKindMask) -> &'static str {
    match kind_mask {
        PreparedBvhKindMask::OutdoorTerrain { .. } => "outdoor-terrain",
        PreparedBvhKindMask::OutdoorStatic { .. } => "outdoor-static",
        PreparedBvhKindMask::LandblockEnvCells { .. } => "landblock-env-cells",
        PreparedBvhKindMask::EnvCellLocal {
            cell_structure_geometry,
            static_object,
            portal,
        } => match (cell_structure_geometry, static_object, portal) {
            (true, false, false) => "cell-structure",
            (false, true, false) => "static",
            (false, false, true) => "portal",
            _ => "mixed",
        },
    }
}

fn parse_hex_u32(input: &str) -> Result<u32> {
    Ok(u32::from_str_radix(input.trim_start_matches("0x"), 16)?)
}

fn format_local_bvh_item(item: &PreparedEnvCellLocalBvhItem) -> String {
    match item {
        PreparedEnvCellLocalBvhItem::CellStructureGeometry { triangle_count } => {
            format!("cell-structure triangles={triangle_count}")
        }
        PreparedEnvCellLocalBvhItem::Static { instance_id } => {
            format!("static instance={instance_id}")
        }
        PreparedEnvCellLocalBvhItem::Portal { portal_id } => {
            format!("portal id={portal_id}")
        }
    }
}

fn derive_cell_bsp_render_bounds_by_plane_triples(node: &BspNode) -> Option<PreparedAabb> {
    let mut planes = Vec::new();
    collect_bsp_planes(node, &mut planes);
    let mut bounds = None;
    for first_index in 0..planes.len() {
        for second_index in (first_index + 1)..planes.len() {
            for third_index in (second_index + 1)..planes.len() {
                let Some(point) = intersect_planes(
                    planes[first_index],
                    planes[second_index],
                    planes[third_index],
                ) else {
                    continue;
                };
                if !point_inside_cell_bsp(node, point) {
                    continue;
                }
                bounds = Some(expand_bounds(bounds, ac_to_render_point(point)));
            }
        }
    }
    bounds
}

fn count_bsp_planes(node: &BspNode) -> usize {
    let mut planes = Vec::new();
    collect_bsp_planes(node, &mut planes);
    planes.len()
}

fn collect_bsp_planes(node: &BspNode, planes: &mut Vec<holtburger_common::Plane>) {
    match node {
        BspNode::Port(portal) => {
            planes.push(portal.plane);
            collect_bsp_planes(&portal.pos, planes);
            collect_bsp_planes(&portal.neg, planes);
        }
        BspNode::Leaf(_) => {}
        BspNode::Internal(internal) => {
            planes.push(internal.plane);
            if let Some(pos) = &internal.pos {
                collect_bsp_planes(pos, planes);
            }
            if let Some(neg) = &internal.neg {
                collect_bsp_planes(neg, planes);
            }
        }
    }
}

fn intersect_planes(
    first: holtburger_common::Plane,
    second: holtburger_common::Plane,
    third: holtburger_common::Plane,
) -> Option<holtburger_common::Vector3> {
    let second_cross_third = second.normal.cross(&third.normal);
    let third_cross_first = third.normal.cross(&first.normal);
    let first_cross_second = first.normal.cross(&second.normal);
    let denominator = first.normal.dot(&second_cross_third);
    if denominator.abs() < 0.00001 {
        return None;
    }
    Some(
        (second_cross_third * -first.d
            + third_cross_first * -second.d
            + first_cross_second * -third.d)
            * (1.0 / denominator),
    )
}

fn point_inside_cell_bsp(node: &BspNode, point: holtburger_common::Vector3) -> bool {
    const EPSILON: f32 = 0.0002;
    let mut current = Some(node);
    while let Some(node) = current {
        match node {
            BspNode::Leaf(_) => return true,
            BspNode::Port(portal) => {
                if portal.plane.distance_to_point(&point) < -EPSILON {
                    return false;
                }
                current = Some(&portal.pos);
            }
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

fn ac_to_render_point(point: holtburger_common::Vector3) -> PreparedVec3 {
    PreparedVec3 {
        x: point.x,
        y: point.z,
        z: if point.y == 0.0 { 0.0 } else { -point.y },
    }
}

fn expand_bounds(bounds: Option<PreparedAabb>, point: PreparedVec3) -> PreparedAabb {
    match bounds {
        Some(bounds) => PreparedAabb {
            max: PreparedVec3 {
                x: bounds.max.x.max(point.x),
                y: bounds.max.y.max(point.y),
                z: bounds.max.z.max(point.z),
            },
            min: PreparedVec3 {
                x: bounds.min.x.min(point.x),
                y: bounds.min.y.min(point.y),
                z: bounds.min.z.min(point.z),
            },
        },
        None => PreparedAabb {
            max: point,
            min: point,
        },
    }
}

fn is_suspicious_bounds(bounds: &PreparedAabb) -> bool {
    let x = bounds.max.x - bounds.min.x;
    let y = bounds.max.y - bounds.min.y;
    let z = bounds.max.z - bounds.min.z;
    !x.is_finite()
        || !y.is_finite()
        || !z.is_finite()
        || x <= 0.001
        || y <= 0.001
        || z <= 0.001
        || x > 200.0
        || y > 200.0
        || z > 200.0
}

fn approx_same_bounds(left: &PreparedAabb, right: &PreparedAabb, epsilon: f32) -> bool {
    (left.min.x - right.min.x).abs() <= epsilon
        && (left.min.y - right.min.y).abs() <= epsilon
        && (left.min.z - right.min.z).abs() <= epsilon
        && (left.max.x - right.max.x).abs() <= epsilon
        && (left.max.y - right.max.y).abs() <= epsilon
        && (left.max.z - right.max.z).abs() <= epsilon
}

fn contains_bounds(outer: &PreparedAabb, inner: &PreparedAabb, epsilon: f32) -> bool {
    outer.min.x <= inner.min.x + epsilon
        && outer.min.y <= inner.min.y + epsilon
        && outer.min.z <= inner.min.z + epsilon
        && outer.max.x + epsilon >= inner.max.x
        && outer.max.y + epsilon >= inner.max.y
        && outer.max.z + epsilon >= inner.max.z
}

fn parse_point(input: &str) -> Result<PreparedVec3> {
    let parts = input
        .split(',')
        .map(str::trim)
        .map(str::parse::<f32>)
        .collect::<Result<Vec<_>, _>>()?;
    anyhow::ensure!(parts.len() == 3, "point must be x,y,z, got {input:?}");
    Ok(PreparedVec3 {
        x: parts[0],
        y: parts[1],
        z: parts[2],
    })
}

fn count_overlapping_pairs(items: &[holtburger_content::LandblockEnvCellBvhItem]) -> usize {
    let mut count = 0;
    for left_index in 0..items.len() {
        for right in items.iter().skip(left_index + 1) {
            if bounds_overlap(&items[left_index].bounds, &right.bounds) {
                count += 1;
            }
        }
    }
    count
}

fn bounds_overlap(left: &PreparedAabb, right: &PreparedAabb) -> bool {
    left.min.x <= right.max.x
        && left.max.x >= right.min.x
        && left.min.y <= right.max.y
        && left.max.y >= right.min.y
        && left.min.z <= right.max.z
        && left.max.z >= right.min.z
}

fn contains_point(bounds: &PreparedAabb, point: PreparedVec3) -> bool {
    point.x >= bounds.min.x
        && point.x <= bounds.max.x
        && point.y >= bounds.min.y
        && point.y <= bounds.max.y
        && point.z >= bounds.min.z
        && point.z <= bounds.max.z
}

fn center(bounds: &PreparedAabb) -> PreparedVec3 {
    PreparedVec3 {
        x: (bounds.min.x + bounds.max.x) * 0.5,
        y: (bounds.min.y + bounds.max.y) * 0.5,
        z: (bounds.min.z + bounds.max.z) * 0.5,
    }
}

fn volume(bounds: &PreparedAabb) -> f32 {
    (bounds.max.x - bounds.min.x).max(0.0)
        * (bounds.max.y - bounds.min.y).max(0.0)
        * (bounds.max.z - bounds.min.z).max(0.0)
}

fn format_bounds(bounds: &PreparedAabb) -> String {
    format!(
        "min={} max={} size=({:.3},{:.3},{:.3})",
        format_point(bounds.min),
        format_point(bounds.max),
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z
    )
}

fn format_point(point: PreparedVec3) -> String {
    format!("({:.3},{:.3},{:.3})", point.x, point.y, point.z)
}
