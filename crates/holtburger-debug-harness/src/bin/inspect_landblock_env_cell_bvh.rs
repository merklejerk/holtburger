use anyhow::Result;
use clap::Parser;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockEnvCellsAssetAssembler, PreparedAabb,
    PreparedVec3, normalize_landblock_id,
};
use holtburger_dat::graphics::Frame;
use holtburger_dat::physics::BspNode;
use std::collections::{BTreeMap, BTreeSet};

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
    #[arg(long)]
    portal_duplicates: bool,
    #[arg(long)]
    portal_clusters: bool,
    #[arg(long, default_value_t = 2)]
    portal_cluster_min_size: usize,
    #[arg(long)]
    portal_reachability_root: Option<String>,
    #[arg(long, default_value_t = 16)]
    portal_reachability_max_depth: usize,
    #[arg(long)]
    portal_reference_cell: Option<String>,
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
            "cell=0x{:08x} placementOrigin=({:.3},{:.3},{:.3}) landblockBounds={}",
            cell.env_cell.env_cell_id,
            cell.env_cell.local_placement.origin.x,
            cell.env_cell.local_placement.origin.y,
            cell.env_cell.local_placement.origin.z,
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
            let bsp_bounds =
                derive_cell_bsp_render_bounds_by_plane_triples(&cell.prepared_cell.cell_bsp);
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

    if args.portal_duplicates {
        report_duplicate_transition_portals(&asset.env_cells);
    }
    if args.portal_clusters {
        report_portal_clusters(&asset.env_cells, args.portal_cluster_min_size);
    }
    if let Some(root) = args.portal_reachability_root.as_deref() {
        report_portal_reachability_layers(
            &asset.env_cells,
            parse_hex_u32(root)?,
            args.portal_reachability_max_depth,
        );
    }
    if let Some(reference_cell) = args.portal_reference_cell.as_deref() {
        report_portal_reference_cell(&asset.env_cells, parse_hex_u32(reference_cell)?);
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
        if let Some(bounds) = &cell.landblock_bounds {
            println!("  landblockBounds={}", format_bounds(bounds));
        } else {
            println!("  landblockBounds=none");
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

#[derive(Debug, Clone)]
struct TransitionPortalApertureDump {
    env_cell_id: u32,
    portal_id: String,
    source_index: usize,
    flags: u16,
    polygon_id: u16,
    other_cell_id: u16,
    other_portal_id: u16,
    target_env_cell_id: Option<u32>,
    is_outside_transition: bool,
    point_count: usize,
    world_points: Vec<PreparedVec3>,
}

#[derive(Debug, Clone)]
struct PortalClusterDump {
    env_cell_id: u32,
    portal_id: String,
    source_index: usize,
    flags: u16,
    polygon_id: u16,
    other_cell_id: u16,
    other_portal_id: u16,
    target_env_cell_id: Option<u32>,
    is_outside_transition: bool,
    incoming_reference_count: usize,
    reciprocal: bool,
    point_count: usize,
    world_points: Vec<PreparedVec3>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct PortalKey {
    env_cell_id: u32,
    source_index: usize,
}

#[derive(Debug, Clone, Copy)]
struct PortalRelationship {
    incoming_reference_count: usize,
    reciprocal: bool,
}

fn report_duplicate_transition_portals(cells: &[holtburger_content::LandblockEnvCellBundleCell]) {
    let mut groups = BTreeMap::<String, Vec<TransitionPortalApertureDump>>::new();
    let mut total_transition_apertures = 0usize;
    for cell in cells {
        let apertures_by_portal = cell
            .prepared_cell
            .portal_apertures
            .iter()
            .map(|aperture| (aperture.portal_id.as_str(), aperture))
            .collect::<BTreeMap<_, _>>();
        for portal in &cell.prepared_cell.portals {
            if !portal.is_outside_transition {
                continue;
            }
            let Some(aperture) = apertures_by_portal.get(portal.portal_id.as_str()) else {
                continue;
            };
            total_transition_apertures += 1;
            let world_points = aperture
                .points
                .iter()
                .map(|point| {
                    transform_render_local_point(*point, &cell.prepared_cell.local_placement)
                })
                .collect::<Vec<_>>();
            let key = canonical_point_set_key(&world_points);
            groups
                .entry(key)
                .or_default()
                .push(TransitionPortalApertureDump {
                    env_cell_id: cell.env_cell.env_cell_id,
                    flags: portal.flags,
                    is_outside_transition: portal.is_outside_transition,
                    other_cell_id: portal.other_cell_id,
                    other_portal_id: portal.other_portal_id,
                    point_count: aperture.points.len(),
                    polygon_id: portal.polygon_id,
                    portal_id: portal.portal_id.clone(),
                    source_index: portal.source_index,
                    target_env_cell_id: portal.target_env_cell_id,
                    world_points,
                });
        }
    }

    let duplicate_groups = groups.values().filter(|group| group.len() > 1).count();
    println!(
        "transitionPortalDuplicateSummary transitionApertures={} duplicateGroups={}",
        total_transition_apertures, duplicate_groups
    );
    for group in groups.values().filter(|group| group.len() > 1) {
        println!("duplicateTransitionPortalGroup members={}", group.len());
        for member in group {
            println!(
                "  envCell=0x{:08x} portal={} index={} flags=0x{:04x} polygon={} otherCell=0x{:04x} otherPortal=0x{:04x} target={} outside={} points={}",
                member.env_cell_id,
                member.portal_id,
                member.source_index,
                member.flags,
                member.polygon_id,
                member.other_cell_id,
                member.other_portal_id,
                member
                    .target_env_cell_id
                    .map(|id| format!("0x{id:08x}"))
                    .unwrap_or_else(|| "none".to_string()),
                member.is_outside_transition,
                member.point_count
            );
        }
        for (index, point) in group[0].world_points.iter().enumerate() {
            println!("    p{}={}", index, format_point(*point));
        }
    }
}

fn report_portal_clusters(
    cells: &[holtburger_content::LandblockEnvCellBundleCell],
    min_size: usize,
) {
    let mut groups = BTreeMap::<String, Vec<PortalClusterDump>>::new();
    let mut total_apertures = 0usize;
    let relationships = build_portal_relationships(cells);
    for cell in cells {
        let apertures_by_portal = cell
            .prepared_cell
            .portal_apertures
            .iter()
            .map(|aperture| (aperture.portal_id.as_str(), aperture))
            .collect::<BTreeMap<_, _>>();
        for portal in &cell.prepared_cell.portals {
            let Some(aperture) = apertures_by_portal.get(portal.portal_id.as_str()) else {
                continue;
            };
            total_apertures += 1;
            let world_points = aperture
                .points
                .iter()
                .map(|point| {
                    transform_render_local_point(*point, &cell.prepared_cell.local_placement)
                })
                .collect::<Vec<_>>();
            let key = canonical_point_set_key(&world_points);
            let relationship = relationships
                .get(&PortalKey {
                    env_cell_id: cell.env_cell.env_cell_id,
                    source_index: portal.source_index,
                })
                .copied()
                .unwrap_or(PortalRelationship {
                    incoming_reference_count: 0,
                    reciprocal: false,
                });
            groups.entry(key).or_default().push(PortalClusterDump {
                env_cell_id: cell.env_cell.env_cell_id,
                flags: portal.flags,
                incoming_reference_count: relationship.incoming_reference_count,
                is_outside_transition: portal.is_outside_transition,
                other_cell_id: portal.other_cell_id,
                other_portal_id: portal.other_portal_id,
                point_count: aperture.points.len(),
                polygon_id: portal.polygon_id,
                portal_id: portal.portal_id.clone(),
                reciprocal: relationship.reciprocal,
                source_index: portal.source_index,
                target_env_cell_id: portal.target_env_cell_id,
                world_points,
            });
        }
    }

    let duplicate_groups = groups.values().filter(|group| group.len() > 1).count();
    let mut group_size_counts = BTreeMap::<usize, usize>::new();
    for group in groups.values() {
        *group_size_counts.entry(group.len()).or_default() += 1;
    }
    println!(
        "portalClusterSummary portals={} groups={} duplicateGroups={} groupSizes={}",
        total_apertures,
        groups.len(),
        duplicate_groups,
        group_size_counts
            .iter()
            .map(|(size, count)| format!("{size}:{count}"))
            .collect::<Vec<_>>()
            .join(",")
    );
    for group in groups
        .values()
        .filter(|group| group.len() >= min_size)
        .collect::<Vec<_>>()
    {
        print_portal_cluster_group(group);
    }
}

fn print_portal_cluster_group(group: &[PortalClusterDump]) {
    let plane_text = group
        .first()
        .and_then(|member| derive_render_plane(&member.world_points))
        .map(|plane| {
            format!(
                "n=({:.6},{:.6},{:.6}) c={:.6}",
                plane.normal.x, plane.normal.y, plane.normal.z, plane.constant
            )
        })
        .unwrap_or_else(|| "none".to_string());
    let bounds = group
        .first()
        .map(|member| bounds_for_points(&member.world_points))
        .map(|bounds| format_bounds(&bounds))
        .unwrap_or_else(|| "none".to_string());
    println!(
        "portalClusterGroup members={} plane={} bounds={}",
        group.len(),
        plane_text,
        bounds
    );
    for member in group {
        println!(
            "  envCell=0x{:08x} portal={} index={} flags=0x{:04x} polygon={} otherCell=0x{:04x} otherPortal=0x{:04x} target={} outside={} reciprocal={} incomingRefs={} points={}",
            member.env_cell_id,
            member.portal_id,
            member.source_index,
            member.flags,
            member.polygon_id,
            member.other_cell_id,
            member.other_portal_id,
            member
                .target_env_cell_id
                .map(|id| format!("0x{id:08x}"))
                .unwrap_or_else(|| "none".to_string()),
            member.is_outside_transition,
            member.reciprocal,
            member.incoming_reference_count,
            member.point_count
        );
    }
}

fn build_portal_relationships(
    cells: &[holtburger_content::LandblockEnvCellBundleCell],
) -> BTreeMap<PortalKey, PortalRelationship> {
    let mut portal_targets = BTreeMap::<PortalKey, Option<PortalKey>>::new();
    let mut incoming_counts = BTreeMap::<PortalKey, usize>::new();
    for cell in cells {
        for portal in &cell.prepared_cell.portals {
            let key = PortalKey {
                env_cell_id: cell.env_cell.env_cell_id,
                source_index: portal.source_index,
            };
            let target_key = portal.target_env_cell_id.and_then(|target_env_cell_id| {
                normalize_portal_index(portal.other_portal_id).map(|source_index| PortalKey {
                    env_cell_id: target_env_cell_id,
                    source_index,
                })
            });
            portal_targets.insert(key, target_key);
            if let Some(target_key) = target_key {
                *incoming_counts.entry(target_key).or_default() += 1;
            }
        }
    }

    portal_targets
        .iter()
        .map(|(key, target_key)| {
            let reciprocal = target_key
                .and_then(|target_key| portal_targets.get(&target_key).copied().flatten())
                == Some(*key);
            (
                *key,
                PortalRelationship {
                    incoming_reference_count: *incoming_counts.get(key).unwrap_or(&0),
                    reciprocal,
                },
            )
        })
        .collect()
}

fn normalize_portal_index(portal_id: u16) -> Option<usize> {
    if portal_id == 0xffff {
        None
    } else {
        Some(usize::from(portal_id))
    }
}

fn report_portal_reachability_layers(
    cells: &[holtburger_content::LandblockEnvCellBundleCell],
    root_env_cell_id: u32,
    max_depth: usize,
) {
    let env_cell_ids = cells
        .iter()
        .map(|cell| cell.env_cell.env_cell_id)
        .collect::<BTreeSet<_>>();
    if !env_cell_ids.contains(&root_env_cell_id) {
        println!("portalReachability root=0x{root_env_cell_id:08x} missingRoot=true");
        return;
    }

    let edges = cells
        .iter()
        .flat_map(|cell| {
            cell.prepared_cell.portals.iter().filter_map(|portal| {
                let target_env_cell_id = portal.target_env_cell_id?;
                if portal.is_outside_transition || !env_cell_ids.contains(&target_env_cell_id) {
                    return None;
                }
                Some((cell.env_cell.env_cell_id, target_env_cell_id))
            })
        })
        .collect::<Vec<_>>();
    let reciprocal_edges = edges
        .iter()
        .filter(|(source, target)| edges.contains(&(*target, *source)))
        .count();
    let mut render_layer_by_env_cell_id = BTreeMap::<u32, usize>::new();
    render_layer_by_env_cell_id.insert(root_env_cell_id, 0);

    let mut changed = true;
    while changed {
        changed = false;
        for (source_env_cell_id, target_env_cell_id) in &edges {
            if *target_env_cell_id == root_env_cell_id {
                continue;
            }
            let Some(source_layer) = render_layer_by_env_cell_id.get(source_env_cell_id).copied()
            else {
                continue;
            };
            let existing_target_layer =
                render_layer_by_env_cell_id.get(target_env_cell_id).copied();
            if existing_target_layer.is_some_and(|layer| layer <= source_layer) {
                continue;
            }
            let target_layer = source_layer + 1;
            if existing_target_layer.is_some_and(|layer| layer >= target_layer) {
                continue;
            }
            render_layer_by_env_cell_id.insert(*target_env_cell_id, target_layer);
            changed = true;
        }
    }

    let mut layer_counts = BTreeMap::<usize, usize>::new();
    for render_layer in render_layer_by_env_cell_id.values() {
        *layer_counts.entry(*render_layer).or_default() += 1;
    }
    let selected_non_root_cells = render_layer_by_env_cell_id
        .iter()
        .filter(|(env_cell_id, render_layer)| {
            **env_cell_id != root_env_cell_id && **render_layer <= max_depth
        })
        .count();
    let skipped_by_depth = render_layer_by_env_cell_id
        .iter()
        .filter(|(env_cell_id, render_layer)| {
            **env_cell_id != root_env_cell_id && **render_layer > max_depth
        })
        .count();
    println!(
        "portalReachability root=0x{root_env_cell_id:08x} cells={} directedEdges={} reciprocalEdges={} reached={} maxLayer={} maxDepth={} selectedNonRoot={} skippedByDepth={} layerCounts={}",
        cells.len(),
        edges.len(),
        reciprocal_edges,
        render_layer_by_env_cell_id.len(),
        render_layer_by_env_cell_id
            .values()
            .max()
            .copied()
            .unwrap_or(0),
        max_depth,
        selected_non_root_cells,
        skipped_by_depth,
        layer_counts
            .iter()
            .map(|(layer, count)| format!("{layer}:{count}"))
            .collect::<Vec<_>>()
            .join(",")
    );
}

fn report_portal_reference_cell(
    cells: &[holtburger_content::LandblockEnvCellBundleCell],
    focus_env_cell_id: u32,
) {
    let Some(focus_cell) = cells
        .iter()
        .find(|cell| cell.env_cell.env_cell_id == focus_env_cell_id)
    else {
        println!("portalReferenceCell cell=0x{focus_env_cell_id:08x} missingCell=true");
        return;
    };

    let portal_targets = cells
        .iter()
        .flat_map(|cell| {
            cell.prepared_cell.portals.iter().map(|portal| {
                let key = PortalKey {
                    env_cell_id: cell.env_cell.env_cell_id,
                    source_index: portal.source_index,
                };
                let target_key = portal.target_env_cell_id.and_then(|target_env_cell_id| {
                    normalize_portal_index(portal.other_portal_id).map(|source_index| PortalKey {
                        env_cell_id: target_env_cell_id,
                        source_index,
                    })
                });
                (key, target_key)
            })
        })
        .collect::<BTreeMap<_, _>>();

    let incoming_portal_refs = cells
        .iter()
        .flat_map(|cell| {
            cell.prepared_cell
                .portals
                .iter()
                .filter(move |portal| portal.target_env_cell_id == Some(focus_env_cell_id))
                .map(move |portal| (cell.env_cell.env_cell_id, portal))
        })
        .collect::<Vec<_>>();
    let visible_list_refs = cells
        .iter()
        .filter(|cell| cell.env_cell.visible_cell_ids.contains(&focus_env_cell_id))
        .map(|cell| cell.env_cell.env_cell_id)
        .collect::<Vec<_>>();
    println!(
        "portalReferenceCell cell=0x{focus_env_cell_id:08x} portals={} incomingPortalRefs={} visibleListRefs={} seenOutside={:?}",
        focus_cell.prepared_cell.portals.len(),
        incoming_portal_refs.len(),
        visible_list_refs.len(),
        focus_cell.env_cell.seen_outside
    );

    for portal in &focus_cell.prepared_cell.portals {
        let key = PortalKey {
            env_cell_id: focus_env_cell_id,
            source_index: portal.source_index,
        };
        let target_key = portal_targets.get(&key).copied().flatten();
        let reverse_target = target_key.and_then(|target_key| {
            portal_targets
                .get(&target_key)
                .copied()
                .flatten()
                .map(|reverse| (target_key, reverse))
        });
        let reciprocal = reverse_target.is_some_and(|(_, reverse_key)| reverse_key == key);
        println!(
            "  outgoing portal={} index={} flags=0x{:04x} otherCell=0x{:04x} otherPortal=0x{:04x} target={} outside={} reciprocal={} targetReverse={}",
            portal.portal_id,
            portal.source_index,
            portal.flags,
            portal.other_cell_id,
            portal.other_portal_id,
            portal
                .target_env_cell_id
                .map(|id| format!("0x{id:08x}"))
                .unwrap_or_else(|| "none".to_string()),
            portal.is_outside_transition,
            reciprocal,
            reverse_target
                .map(|(target_key, reverse_key)| {
                    format!(
                        "0x{:08x}/{}->0x{:08x}/{}",
                        target_key.env_cell_id,
                        target_key.source_index,
                        reverse_key.env_cell_id,
                        reverse_key.source_index
                    )
                })
                .unwrap_or_else(|| "none".to_string())
        );
    }

    for (source_env_cell_id, portal) in incoming_portal_refs {
        println!(
            "  incoming from=0x{source_env_cell_id:08x} portal={} index={} flags=0x{:04x} otherPortal=0x{:04x} outside={}",
            portal.portal_id,
            portal.source_index,
            portal.flags,
            portal.other_portal_id,
            portal.is_outside_transition
        );
    }
    if !visible_list_refs.is_empty() {
        println!(
            "  visibleListReferencedBy={}",
            visible_list_refs
                .iter()
                .map(|id| format!("0x{id:08x}"))
                .collect::<Vec<_>>()
                .join(",")
        );
    }
}

#[derive(Debug, Clone, Copy)]
struct RenderPlane {
    normal: PreparedVec3,
    constant: f32,
}

fn derive_render_plane(points: &[PreparedVec3]) -> Option<RenderPlane> {
    if points.len() < 3 {
        return None;
    }
    for first_index in 0..points.len() {
        for second_index in (first_index + 1)..points.len() {
            for third_index in (second_index + 1)..points.len() {
                let edge_a = subtract_prepared(points[second_index], points[first_index]);
                let edge_b = subtract_prepared(points[third_index], points[first_index]);
                let normal = cross_prepared(edge_a, edge_b);
                let length =
                    (normal.x * normal.x + normal.y * normal.y + normal.z * normal.z).sqrt();
                if length < 0.0001 {
                    continue;
                }
                let normal = PreparedVec3 {
                    x: normal.x / length,
                    y: normal.y / length,
                    z: normal.z / length,
                };
                return Some(RenderPlane {
                    normal,
                    constant: -dot_prepared(normal, points[first_index]),
                });
            }
        }
    }
    None
}

fn subtract_prepared(left: PreparedVec3, right: PreparedVec3) -> PreparedVec3 {
    PreparedVec3 {
        x: left.x - right.x,
        y: left.y - right.y,
        z: left.z - right.z,
    }
}

fn cross_prepared(left: PreparedVec3, right: PreparedVec3) -> PreparedVec3 {
    PreparedVec3 {
        x: left.y * right.z - left.z * right.y,
        y: left.z * right.x - left.x * right.z,
        z: left.x * right.y - left.y * right.x,
    }
}

fn dot_prepared(left: PreparedVec3, right: PreparedVec3) -> f32 {
    left.x * right.x + left.y * right.y + left.z * right.z
}

fn bounds_for_points(points: &[PreparedVec3]) -> PreparedAabb {
    points
        .iter()
        .copied()
        .fold(None, |bounds, point| Some(expand_bounds(bounds, point)))
        .expect("portal cluster group should contain at least one point")
}

fn canonical_point_set_key(points: &[PreparedVec3]) -> String {
    let mut point_keys = points.iter().map(canonical_point_key).collect::<Vec<_>>();
    point_keys.sort();
    point_keys.join("|")
}

fn canonical_point_key(point: &PreparedVec3) -> String {
    format!(
        "{},{},{}",
        quantize_coord(point.x),
        quantize_coord(point.y),
        quantize_coord(point.z)
    )
}

fn quantize_coord(value: f32) -> i32 {
    (value * 1000.0).round() as i32
}

fn transform_render_local_point(point: PreparedVec3, ac_frame: &Frame) -> PreparedVec3 {
    ac_to_render_point(
        ac_frame.origin + rotate_ac_vector(render_to_ac_point(point), ac_frame.orientation),
    )
}

fn render_to_ac_point(point: PreparedVec3) -> holtburger_common::Vector3 {
    holtburger_common::Vector3 {
        x: point.x,
        y: if point.z == 0.0 { 0.0 } else { -point.z },
        z: point.y,
    }
}

fn rotate_ac_vector(
    vector: holtburger_common::Vector3,
    rotation: holtburger_common::Quaternion,
) -> holtburger_common::Vector3 {
    let q_vector = holtburger_common::Vector3 {
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
    };
    let uv = q_vector.cross(&vector);
    let uuv = q_vector.cross(&uv);
    vector + uv * (2.0 * rotation.w) + uuv * 2.0
}

fn parse_hex_u32(input: &str) -> Result<u32> {
    Ok(u32::from_str_radix(input.trim_start_matches("0x"), 16)?)
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
