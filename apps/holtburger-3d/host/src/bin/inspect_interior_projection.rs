use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Cursor;

use anyhow::{Context, Result, ensure};
use holtburger_3d_host::cell_struct_projection::{
    CellStructProjection, CellStructProjectionContext, project_cell_struct,
};
use holtburger_3d_host::gfx_obj_geometry::build_gfx_obj_portal_apertures;
use holtburger_3d_host::interior_seam::{IndoorSeamEvidence, classify_indoor_seam};
use holtburger_3d_host::portal_geometry::{
    PORTAL_PLANE_EPSILON, PortalAperture, accepted_plane_side, plane_distance,
    portal_planarity_deviation, transform_aperture, transform_render_bounds,
    transform_render_point,
};
use holtburger_3d_host::portal_visibility::intersect_visibility_apertures;
use holtburger_content::LandblockPlacement;
use holtburger_dat::file_type::{DatFileType, EnvCell, Environment, GfxObj};
use holtburger_dat::physics::BspNode;
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader};

const SELECTED_ENV_CELLS: [u32; 6] = [
    0x0001_0100,
    0x0002_0104,
    0x00d1_0100,
    0xec0e_010b,
    0x6444_0248,
    0x1134_0139,
];

fn main() -> Result<()> {
    let archive_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "dats/assets.hba".to_owned());
    let archive = HbaReader::open(&archive_path)
        .with_context(|| format!("failed to open HBA archive {archive_path}"))?;
    let mut environments = HashMap::new();
    let mut selected = HashMap::new();

    for env_cell_id in SELECTED_ENV_CELLS {
        let (cell, environment) =
            load_cell_and_environment(&archive, &mut environments, env_cell_id)?;
        let projection = project(&cell, environment)?;
        for (portal_index, portal) in cell.portals.iter().enumerate() {
            ensure!(
                projection
                    .apertures
                    .iter()
                    .any(|aperture| aperture.polygon_id == portal.polygon_id),
                "EnvCell 0x{env_cell_id:08X} portal {portal_index} does not match its CellStruct aperture"
            );
        }
        let bounds = projection
            .shell
            .bounds
            .context("selected CellStruct shell has no bounds")?;
        let ac_center = holtburger_common::Vector3::new(
            (bounds.min.x + bounds.max.x) * 0.5,
            -(bounds.min.z + bounds.max.z) * 0.5,
            (bounds.min.y + bounds.max.y) * 0.5,
        );
        let render_center = transform_render_point(
            holtburger_3d_host::polygon_geometry::RenderVec3 {
                x: (bounds.min.x + bounds.max.x) * 0.5,
                y: (bounds.min.y + bounds.max.y) * 0.5,
                z: (bounds.min.z + bounds.max.z) * 0.5,
            },
            placement(&cell),
        );
        println!(
            "EnvCell 0x{env_cell_id:08X}: shellTriangles={} rejectedDegenerate={} apertures={} containmentPlanes={} boundsCenterContained={} renderOrigin=[{:.6},{:.6},{:.6}] renderBoundsCenter=[{:.6},{:.6},{:.6}]",
            projection.shell.triangles.len(),
            projection.shell.rejected_degenerate_triangles.len(),
            projection.apertures.len(),
            projection.containment_hull.planes.len(),
            projection.containment_hull.contains(ac_center),
            cell.position.origin.x,
            cell.position.origin.z,
            -cell.position.origin.y,
            render_center.x,
            render_center.y,
            render_center.z,
        );
        if env_cell_id == 0x00d1_0100
            && let Some(portal) = cell.portals.first()
        {
            let aperture = transform_aperture(
                &projection
                    .apertures
                    .iter()
                    .find(|aperture| aperture.polygon_id == portal.polygon_id)
                    .context("selected dense fixture portal has no projected aperture")?
                    .aperture,
                placement(&cell),
            )?;
            let center = aperture_center(&aperture);
            println!(
                "dense render fixture: center=[{:.6},{:.6},{:.6}] normal=[{:.6},{:.6},{:.6}] d={:.6} sourceSide={:?}",
                center.x,
                center.y,
                center.z,
                aperture.plane.normal.x,
                aperture.plane.normal.y,
                aperture.plane.normal.z,
                aperture.plane.d,
                accepted_plane_side(portal.flags),
            );
        }
        selected.insert(env_cell_id, (cell, projection));
    }

    inspect_selected_reciprocal(&archive, &mut environments, &mut selected)?;
    inspect_non_exact_reciprocal_planes(&archive)?;
    inspect_gfx_obj_portals(&archive)?;
    Ok(())
}

fn inspect_non_exact_reciprocal_planes(archive: &HbaReader) -> Result<()> {
    let mut cells = HashMap::<u32, EnvCell>::new();
    for entry in archive.entries() {
        let entry = entry?;
        if entry.namespace_id()?.as_str() != EOR_CELL_NAMESPACE
            || DatFileType::from_id(entry.file_id) != DatFileType::IndoorCell
        {
            continue;
        }
        let bytes = archive.get_file_in_namespace(EOR_CELL_NAMESPACE, entry.file_id)?;
        let cell = EnvCell::unpack(&mut Cursor::new(bytes))
            .with_context(|| format!("failed to decode EnvCell 0x{:08X}", entry.file_id))?;
        if cell.environment_id != 0 {
            cells.insert(entry.file_id, cell);
        }
    }

    let mut environments = HashMap::<u32, Environment>::new();
    let mut projections = HashMap::<u32, CellStructProjection>::new();
    let mut exact_directed = 0usize;
    let mut non_exact_directed = 0usize;
    let mut non_exact_outside = 0usize;
    let mut reciprocal_internal = 0usize;
    let mut maximum_deviations = Vec::<f32>::new();
    let mut minimum_normal_alignment = 1.0f32;
    let mut synthesized_pairs = HashSet::<(u32, usize, u32, usize)>::new();
    let mut empty_intersections = 0usize;
    let mut malformed_intersections = 0usize;
    let mut malformed_by_message = BTreeMap::<String, (usize, Option<String>)>::new();
    let mut multipart_intersections = 0usize;
    let mut maximum_component_count = 0usize;
    for source in cells.values() {
        for (source_portal_index, portal) in source.portals.iter().enumerate() {
            if (portal.flags & 0x01) != 0 {
                exact_directed += 1;
                continue;
            }
            non_exact_directed += 1;
            if (portal.flags & 0x04) != 0 {
                non_exact_outside += 1;
                continue;
            }
            let target_id = (source.id & 0xffff_0000) | u32::from(portal.other_cell_id);
            let Some(target) = cells.get(&target_id) else {
                continue;
            };
            let Some(target_portal) = target.portals.get(usize::from(portal.other_portal_id))
            else {
                continue;
            };
            let target_portal_index = usize::from(portal.other_portal_id);
            if ((target_id & 0xffff_0000) | u32::from(target_portal.other_cell_id)) != source.id {
                continue;
            }
            reciprocal_internal += 1;
            let source_aperture = project_landblock_aperture(
                archive,
                &mut environments,
                &mut projections,
                source,
                portal.polygon_id,
            )?;
            let target_aperture = project_landblock_aperture(
                archive,
                &mut environments,
                &mut projections,
                target,
                target_portal.polygon_id,
            )?;
            maximum_deviations.push(reciprocal_plane_deviation(
                &source_aperture,
                &target_aperture,
            ));
            let pair = if (source.id, source_portal_index) < (target_id, target_portal_index) {
                (
                    source.id,
                    source_portal_index,
                    target_id,
                    target_portal_index,
                )
            } else {
                (
                    target_id,
                    target_portal_index,
                    source.id,
                    source_portal_index,
                )
            };
            if synthesized_pairs.insert(pair) {
                match intersect_visibility_apertures(&source_aperture, &target_aperture) {
                    Ok(intersection) => {
                        minimum_normal_alignment =
                            minimum_normal_alignment.min(intersection.evidence.absolute_normal_dot);
                        maximum_component_count =
                            maximum_component_count.max(intersection.evidence.component_count);
                        if intersection.evidence.component_count > 1 {
                            multipart_intersections += 1;
                        }
                    }
                    Err(error) if error.to_string().contains("intersection is empty") => {
                        empty_intersections += 1;
                    }
                    Err(error) => {
                        malformed_intersections += 1;
                        let message = error.to_string();
                        let evidence = malformed_by_message.entry(message).or_insert((0, None));
                        evidence.0 += 1;
                        evidence.1.get_or_insert_with(|| {
                            format!(
                                "0x{:08X}/{} <-> 0x{target_id:08X}/{target_portal_index}",
                                source.id, source_portal_index
                            )
                        });
                    }
                }
            }
        }
    }

    maximum_deviations.sort_by(f32::total_cmp);
    let count_at = |epsilon: f32| {
        maximum_deviations
            .iter()
            .filter(|deviation| **deviation <= epsilon)
            .count()
    };
    let unresolved_non_exact = non_exact_directed - reciprocal_internal;
    let over_threshold = reciprocal_internal - count_at(0.001);
    let synthesized = synthesized_pairs.len() - empty_intersections - malformed_intersections;
    let authored_source_directed = exact_directed + unresolved_non_exact;
    println!(
        "non-exact reciprocal planes: directed={non_exact_directed} outside={non_exact_outside} reciprocalInternal={reciprocal_internal} coplanarAtRetailEpsilon={} coplanarAt0.001={} coplanarAt0.01={} maximumDeviation={} minimumAbsoluteNormalDot={minimum_normal_alignment}",
        count_at(PORTAL_PLANE_EPSILON),
        count_at(0.001),
        count_at(0.01),
        maximum_deviations.last().copied().unwrap_or(0.0),
    );
    println!(
        "effective aperture provenance: authoredSourceDirected={authored_source_directed} exactDirected={exact_directed} unresolvedNonExact={unresolved_non_exact} reciprocalIntersectionDirected={reciprocal_internal} uniquePairs={} synthesized={synthesized} empty={empty_intersections} overThreshold={over_threshold} malformed={malformed_intersections} multipart={multipart_intersections} maximumComponents={maximum_component_count}",
        synthesized_pairs.len(),
    );
    for (message, (count, sample)) in malformed_by_message {
        println!(
            "non-exact effective aperture failure: count={count} message={message} sample={}",
            sample.unwrap_or_default()
        );
    }
    Ok(())
}

fn project_landblock_aperture(
    archive: &HbaReader,
    environments: &mut HashMap<u32, Environment>,
    projections: &mut HashMap<u32, CellStructProjection>,
    cell: &EnvCell,
    polygon_id: u16,
) -> Result<PortalAperture> {
    if let Entry::Vacant(entry) = projections.entry(cell.id) {
        let environment_id = 0x0d00_0000 | u32::from(cell.environment_id);
        if let Entry::Vacant(environment_entry) = environments.entry(environment_id) {
            let bytes = archive.get_file_in_namespace(EOR_PORTAL_NAMESPACE, environment_id)?;
            let environment = Environment::unpack(&mut Cursor::new(bytes))
                .with_context(|| format!("failed to decode Environment 0x{environment_id:08X}"))?;
            environment_entry.insert(environment);
        }
        let projection = project(
            cell,
            environments
                .get(&environment_id)
                .expect("environment was inserted above"),
        )?;
        entry.insert(projection);
    }
    let aperture = projections[&cell.id]
        .apertures
        .iter()
        .find(|aperture| aperture.polygon_id == polygon_id)
        .with_context(|| {
            format!(
                "EnvCell 0x{:08X} portal polygon {polygon_id} has no projected aperture",
                cell.id
            )
        })?;
    transform_aperture(&aperture.aperture, placement(cell))
}

fn reciprocal_plane_deviation(source: &PortalAperture, target: &PortalAperture) -> f32 {
    source
        .positions
        .iter()
        .map(|position| plane_distance(target.plane, *position).abs())
        .chain(
            target
                .positions
                .iter()
                .map(|position| plane_distance(source.plane, *position).abs()),
        )
        .fold(0.0, f32::max)
}

fn inspect_selected_reciprocal(
    archive: &HbaReader,
    environments: &mut HashMap<u32, Environment>,
    selected: &mut HashMap<u32, (EnvCell, CellStructProjection)>,
) -> Result<()> {
    let source_id = 0x0001_0100;
    let target_id = {
        let (source_cell, _) = selected
            .get(&source_id)
            .context("selected reciprocal source projection is missing")?;
        let (_, source_portal) = source_cell
            .portals
            .iter()
            .enumerate()
            .find(|(_, portal)| (portal.flags & 0x04) == 0)
            .context("selected reciprocal source has no internal portal")?;
        (source_id & 0xffff_0000) | u32::from(source_portal.other_cell_id)
    };
    if let Entry::Vacant(entry) = selected.entry(target_id) {
        let (target_cell, target_environment) =
            load_cell_and_environment(archive, environments, target_id)?;
        let target_projection = project(&target_cell, target_environment)?;
        entry.insert((target_cell, target_projection));
    }
    let (source_cell, source_projection) = selected
        .get(&source_id)
        .context("selected reciprocal source projection is missing")?;
    let (source_portal_index, source_portal) = source_cell
        .portals
        .iter()
        .enumerate()
        .find(|(_, portal)| (portal.flags & 0x04) == 0)
        .context("selected reciprocal source has no internal portal")?;
    let (target_cell, target_projection) = &selected[&target_id];
    let target_portal_index = usize::from(source_portal.other_portal_id);
    let target_portal = target_cell
        .portals
        .get(target_portal_index)
        .with_context(|| {
            format!("EnvCell 0x{target_id:08X} has no reciprocal portal {target_portal_index}")
        })?;
    ensure!(
        ((target_id & 0xffff_0000) | u32::from(target_portal.other_cell_id)) == source_id
            && usize::from(target_portal.other_portal_id) == source_portal_index,
        "selected reciprocal portal does not link back"
    );
    let source_aperture = transform_aperture(
        &source_projection
            .apertures
            .iter()
            .find(|aperture| aperture.polygon_id == source_portal.polygon_id)
            .context("source portal polygon has no projected aperture")?
            .aperture,
        placement(source_cell),
    )?;
    let target_aperture = transform_aperture(
        &target_projection
            .apertures
            .iter()
            .find(|aperture| aperture.polygon_id == target_portal.polygon_id)
            .context("target portal polygon has no projected aperture")?
            .aperture,
        placement(target_cell),
    )?;
    let classification = classify_indoor_seam(IndoorSeamEvidence {
        reciprocal_identity_proven: true,
        source_exact_match: (source_portal.flags & 0x01) != 0,
        target_exact_match: (target_portal.flags & 0x01) != 0,
        source_aperture: &source_aperture,
        target_aperture: &target_aperture,
        source_accepted_side: accepted_plane_side(source_portal.flags),
        target_accepted_side: accepted_plane_side(target_portal.flags),
        source_cell_bounds: source_projection
            .shell
            .bounds
            .map(|bounds| transform_render_bounds(bounds, placement(source_cell))),
        target_cell_bounds: target_projection
            .shell
            .bounds
            .map(|bounds| transform_render_bounds(bounds, placement(target_cell))),
    });
    println!(
        "reciprocal 0x{source_id:08X}/{source_portal_index} -> 0x{target_id:08X}/{target_portal_index}: {classification:?}"
    );
    let center = aperture_center(&source_aperture);
    println!(
        "reciprocal trace fixture: center=[{:.6},{:.6},{:.6}] normal=[{:.6},{:.6},{:.6}] d={:.6} sourceSide={:?} targetSide={:?}",
        center.x,
        center.y,
        center.z,
        source_aperture.plane.normal.x,
        source_aperture.plane.normal.y,
        source_aperture.plane.normal.z,
        source_aperture.plane.d,
        accepted_plane_side(source_portal.flags),
        accepted_plane_side(target_portal.flags),
    );
    Ok(())
}

fn aperture_center(
    aperture: &holtburger_3d_host::portal_geometry::PortalAperture,
) -> holtburger_3d_host::polygon_geometry::RenderVec3 {
    let count = aperture.positions.len() as f32;
    holtburger_3d_host::polygon_geometry::RenderVec3 {
        x: aperture.positions.iter().map(|point| point.x).sum::<f32>() / count,
        y: aperture.positions.iter().map(|point| point.y).sum::<f32>() / count,
        z: aperture.positions.iter().map(|point| point.z).sum::<f32>() / count,
    }
}

fn inspect_gfx_obj_portals(archive: &HbaReader) -> Result<()> {
    let mut deviations = Vec::new();
    let mut duplicate_groups = 0usize;
    for entry in archive.entries() {
        let entry = entry?;
        if entry.namespace_id()?.as_str() != EOR_PORTAL_NAMESPACE
            || DatFileType::from_id(entry.file_id) != DatFileType::Model
        {
            continue;
        }
        let bytes = archive.get_file_in_namespace(EOR_PORTAL_NAMESPACE, entry.file_id)?;
        let gfx_obj = GfxObj::unpack(&mut Cursor::new(bytes))
            .with_context(|| format!("failed to decode GfxObj 0x{:08X}", entry.file_id))?;
        if let Some(drawing_bsp) = &gfx_obj.drawing_bsp {
            collect_gfx_portal_deviations(drawing_bsp, &gfx_obj, &mut deviations)?;
            let mut pairs = Vec::new();
            collect_gfx_portal_pairs(drawing_bsp, &mut pairs)?;
            let mut by_portal = BTreeMap::<usize, Vec<u16>>::new();
            for (portal_index, polygon_id) in pairs {
                by_portal.entry(portal_index).or_default().push(polygon_id);
            }
            for (portal_index, polygon_ids) in by_portal
                .into_iter()
                .filter(|(_, polygons)| polygons.len() > 1)
            {
                duplicate_groups += 1;
                println!(
                    "building portal multipart: gfx=0x{:08X} portal={} polygons={polygon_ids:?}",
                    gfx_obj.id, portal_index
                );
            }
        }
    }
    deviations.sort_by(f32::total_cmp);
    ensure!(
        !deviations.is_empty(),
        "archive contains no drawing-BSP portal polygons"
    );
    let percentile = |numerator: usize, denominator: usize| {
        deviations[(deviations.len() - 1) * numerator / denominator]
    };
    println!(
        "building aperture planarity: count={} p99={} p999={} max={} above0.0002={} above0.001={} above0.01={}",
        deviations.len(),
        percentile(99, 100),
        percentile(999, 1000),
        deviations.last().copied().unwrap_or(0.0),
        deviations.iter().filter(|value| **value > 0.0002).count(),
        deviations.iter().filter(|value| **value > 0.001).count(),
        deviations.iter().filter(|value| **value > 0.01).count(),
    );
    println!("building portal multipart groups={duplicate_groups}");

    let mut model_count = 0usize;
    let mut aperture_count = 0usize;
    for entry in archive.entries() {
        let entry = entry?;
        if entry.namespace_id()?.as_str() != EOR_PORTAL_NAMESPACE
            || DatFileType::from_id(entry.file_id) != DatFileType::Model
        {
            continue;
        }
        let bytes = archive.get_file_in_namespace(EOR_PORTAL_NAMESPACE, entry.file_id)?;
        let gfx_obj = GfxObj::unpack(&mut Cursor::new(bytes))
            .with_context(|| format!("failed to decode GfxObj 0x{:08X}", entry.file_id))?;
        let apertures = build_gfx_obj_portal_apertures(&gfx_obj)
            .with_context(|| format!("failed to project GfxObj 0x{:08X}", entry.file_id))?;
        if !apertures.is_empty() {
            model_count += 1;
            aperture_count += apertures.len();
        }
    }
    println!("building aperture projection: models={model_count} apertures={aperture_count}");
    Ok(())
}

fn collect_gfx_portal_pairs(node: &BspNode, pairs: &mut Vec<(usize, u16)>) -> Result<()> {
    match node {
        BspNode::Port(portal) => {
            for pair in &portal.portal_polys {
                pairs.push((
                    usize::try_from(pair.portal_index)
                        .context("drawing-BSP portal index is negative")?,
                    u16::try_from(pair.poly_id)
                        .context("drawing-BSP portal polygon id is negative")?,
                ));
            }
            collect_gfx_portal_pairs(&portal.pos, pairs)?;
            collect_gfx_portal_pairs(&portal.neg, pairs)?;
        }
        BspNode::Internal(internal) => {
            if let Some(pos) = &internal.pos {
                collect_gfx_portal_pairs(pos, pairs)?;
            }
            if let Some(neg) = &internal.neg {
                collect_gfx_portal_pairs(neg, pairs)?;
            }
        }
        BspNode::Leaf(_) => {}
    }
    Ok(())
}

fn collect_gfx_portal_deviations(
    node: &BspNode,
    gfx_obj: &GfxObj,
    deviations: &mut Vec<f32>,
) -> Result<()> {
    match node {
        BspNode::Port(portal) => {
            for pair in &portal.portal_polys {
                let polygon_id = u16::try_from(pair.poly_id)
                    .context("drawing-BSP portal polygon id is negative")?;
                let polygon = gfx_obj.polygons.get(&polygon_id).with_context(|| {
                    format!(
                        "GfxObj 0x{:08X} references missing portal polygon {polygon_id}",
                        gfx_obj.id
                    )
                })?;
                deviations.push(portal_planarity_deviation(
                    &gfx_obj.vertex_array,
                    polygon_id,
                    polygon,
                )?);
            }
            collect_gfx_portal_deviations(&portal.pos, gfx_obj, deviations)?;
            collect_gfx_portal_deviations(&portal.neg, gfx_obj, deviations)?;
        }
        BspNode::Internal(internal) => {
            if let Some(pos) = &internal.pos {
                collect_gfx_portal_deviations(pos, gfx_obj, deviations)?;
            }
            if let Some(neg) = &internal.neg {
                collect_gfx_portal_deviations(neg, gfx_obj, deviations)?;
            }
        }
        BspNode::Leaf(_) => {}
    }
    Ok(())
}

fn load_cell_and_environment<'a>(
    archive: &HbaReader,
    environments: &'a mut HashMap<u32, Environment>,
    env_cell_id: u32,
) -> Result<(EnvCell, &'a Environment)> {
    let bytes = archive
        .get_file_in_namespace(EOR_CELL_NAMESPACE, env_cell_id)
        .with_context(|| format!("failed to load EnvCell 0x{env_cell_id:08X}"))?;
    let cell = EnvCell::unpack(&mut Cursor::new(bytes))
        .with_context(|| format!("failed to decode EnvCell 0x{env_cell_id:08X}"))?;
    let environment_id = 0x0d00_0000 | u32::from(cell.environment_id);
    let environment = match environments.entry(environment_id) {
        Entry::Occupied(entry) => entry.into_mut(),
        Entry::Vacant(entry) => {
            let bytes = archive.get_file_in_namespace(EOR_PORTAL_NAMESPACE, environment_id)?;
            let environment = Environment::unpack(&mut Cursor::new(bytes))
                .with_context(|| format!("failed to decode Environment 0x{environment_id:08X}"))?;
            entry.insert(environment)
        }
    };
    Ok((cell, environment))
}

fn project(cell: &EnvCell, environment: &Environment) -> Result<CellStructProjection> {
    let cell_structure_id = u32::from(cell.cell_structure);
    let cell_struct = environment.cells.get(&cell_structure_id).with_context(|| {
        format!(
            "Environment 0x{:08X} has no CellStruct 0x{cell_structure_id:04X}",
            environment.id
        )
    })?;
    project_cell_struct(
        CellStructProjectionContext {
            landblock_id: (cell.id & 0xffff_0000) | 0xffff,
            env_cell_id: cell.id,
            environment_id: environment.id,
            cell_structure_id,
            surface_count: cell.surfaces.len(),
            excluded_shell_polygon_ids: &[],
        },
        cell_struct,
    )
}

fn placement(cell: &EnvCell) -> LandblockPlacement {
    LandblockPlacement {
        origin: cell.position.origin,
        orientation: cell.position.orientation,
    }
}
