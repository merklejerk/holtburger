use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, HashMap};
use std::io::Cursor;

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_common::Vector3;
use holtburger_dat::file_type::{DatFileType, EnvCell, Environment};
use holtburger_dat::physics::BspNode;
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader};

const PORTAL_EXACT_MATCH: u16 = 0x01;
const PORTAL_SIDE: u16 = 0x02;
const PORTAL_OUTSIDE: u16 = 0x04;

#[derive(Parser, Debug)]
/// Inputs for the opt-in local archive census.
struct Args {
    /// HBA archive whose EnvCell records should be inspected.
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
}

#[derive(Default)]
/// Aggregate facts and risk-oriented fixture candidates discovered in one archive.
struct Census {
    /// Number of decoded EnvCells with a selected Environment.
    cell_count: usize,
    /// Total authored directed portals.
    portal_count: usize,
    /// Portals whose raw flags declare an exact reciprocal match.
    exact_match_count: usize,
    /// Portals whose raw `PortalSide` flag is set.
    portal_side_flag_count: usize,
    /// Portals whose raw flags identify an outside transition.
    outside_count: usize,
    /// Directed portals whose indexed target links back to the source cell.
    reciprocal_count: usize,
    /// Internal portal links that could not be resolved as reciprocal in this archive.
    unresolved_internal_reciprocal_count: usize,
    /// Portal polygons whose authored vertex count is not four.
    non_quad_count: usize,
    /// Portal polygons whose plane is not parallel to a principal axis.
    non_axis_aligned_count: usize,
    /// Total static-object placements authored by EnvCells.
    static_resident_count: usize,
    /// Total potentially-visible-cell references.
    visible_cell_reference_count: usize,
    /// Maximum positive-child containment-chain depth and its EnvCell.
    deepest_containment_chain: (usize, u32),
    /// Maximum directed portal count and its EnvCell.
    densest_portal_cell: (usize, u32),
    /// Maximum authored resident count and its EnvCell.
    largest_resident_cell: (usize, u32),
    /// First small cell with at least one resolved reciprocal portal.
    small_reciprocal_sample: Option<u32>,
    /// First non-quad sample as cell, polygon, and vertex count.
    non_quad_sample: Option<(u32, u16, usize)>,
    /// First non-axis-aligned sample as cell and polygon.
    non_axis_aligned_sample: Option<(u32, u16)>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let archive = HbaReader::open(&args.dats)
        .with_context(|| format!("failed to open HBA archive {}", args.dats))?;
    let mut cells = BTreeMap::new();

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

    let mut environments = HashMap::new();
    let mut census = Census::default();
    for (&cell_id, cell) in &cells {
        let environment_id = 0x0D00_0000 | u32::from(cell.environment_id);
        let environment = load_environment(&archive, &mut environments, environment_id)?;
        let structure = environment
            .cells
            .get(&u32::from(cell.cell_structure))
            .with_context(|| {
                format!(
                    "EnvCell 0x{cell_id:08X} selects missing CellStruct 0x{:04X}",
                    cell.cell_structure
                )
            })?;

        census.cell_count += 1;
        census.portal_count += cell.portals.len();
        census.static_resident_count += cell.static_objects.len();
        census.visible_cell_reference_count += cell.visible_cells.len();
        update_max(&mut census.densest_portal_cell, cell.portals.len(), cell_id);
        update_max(
            &mut census.largest_resident_cell,
            cell.static_objects.len(),
            cell_id,
        );
        update_max(
            &mut census.deepest_containment_chain,
            positive_chain_depth(&structure.cell_bsp),
            cell_id,
        );

        let mut has_reciprocal = false;
        for portal in &cell.portals {
            census.exact_match_count += usize::from((portal.flags & PORTAL_EXACT_MATCH) != 0);
            census.portal_side_flag_count += usize::from((portal.flags & PORTAL_SIDE) != 0);
            census.outside_count += usize::from((portal.flags & PORTAL_OUTSIDE) != 0);

            let other_cell_id = (cell_id & 0xFFFF_0000) | u32::from(portal.other_cell_id);
            let reciprocal = cells
                .get(&other_cell_id)
                .and_then(|other| other.portals.get(usize::from(portal.other_portal_id)));
            if reciprocal.is_some_and(|other| {
                ((other_cell_id & 0xFFFF_0000) | u32::from(other.other_cell_id)) == cell_id
            }) {
                census.reciprocal_count += 1;
                has_reciprocal = true;
            } else if (portal.flags & PORTAL_OUTSIDE) == 0 {
                census.unresolved_internal_reciprocal_count += 1;
            }

            let Some(polygon) = structure.polygons.get(&portal.polygon_id) else {
                continue;
            };
            if polygon.vertex_ids.len() != 4 {
                census.non_quad_count += 1;
                census.non_quad_sample.get_or_insert((
                    cell_id,
                    portal.polygon_id,
                    polygon.vertex_ids.len(),
                ));
            }
            if polygon_normal(structure, polygon).is_some_and(is_non_axis_aligned) {
                census.non_axis_aligned_count += 1;
                census
                    .non_axis_aligned_sample
                    .get_or_insert((cell_id, portal.polygon_id));
            }
        }
        if has_reciprocal && (1..=2).contains(&cell.portals.len()) {
            census.small_reciprocal_sample.get_or_insert(cell_id);
        }
    }

    print_census(&census);
    Ok(())
}

fn load_environment<'a>(
    archive: &HbaReader,
    environments: &'a mut HashMap<u32, Environment>,
    environment_id: u32,
) -> Result<&'a Environment> {
    let environment = match environments.entry(environment_id) {
        Entry::Occupied(entry) => entry.into_mut(),
        Entry::Vacant(entry) => {
            let bytes = archive.get_file_in_namespace(EOR_PORTAL_NAMESPACE, environment_id)?;
            let environment = Environment::unpack(&mut Cursor::new(bytes))
                .with_context(|| format!("failed to decode Environment 0x{environment_id:08X}"))?;
            entry.insert(environment)
        }
    };
    Ok(environment)
}

fn positive_chain_depth(node: &BspNode) -> usize {
    match node {
        BspNode::Port(portal) => 1 + positive_chain_depth(&portal.pos),
        BspNode::Internal(internal) => {
            1 + internal
                .pos
                .as_deref()
                .map(positive_chain_depth)
                .unwrap_or(0)
        }
        BspNode::Leaf(_) => 1,
    }
}

fn polygon_normal(
    structure: &holtburger_dat::file_type::environment::CellStruct,
    polygon: &holtburger_dat::graphics::Polygon,
) -> Option<Vector3> {
    let [a_id, b_id, c_id, ..] = polygon.vertex_ids.as_slice() else {
        return None;
    };
    let a = structure.vertex_array.vertices.get(a_id)?.origin;
    let b = structure.vertex_array.vertices.get(b_id)?.origin;
    let c = structure.vertex_array.vertices.get(c_id)?.origin;
    let normal = (b - a).cross(&(c - a)).normalize();
    (normal.length_squared() > 0.0).then_some(normal)
}

fn is_non_axis_aligned(normal: Vector3) -> bool {
    normal.x.abs().max(normal.y.abs()).max(normal.z.abs()) < 0.999
}

fn update_max(current: &mut (usize, u32), count: usize, cell_id: u32) {
    if count > current.0 {
        *current = (count, cell_id);
    }
}

fn print_census(census: &Census) {
    println!("env-cell integration census");
    println!(
        "  cells={} portals={} reciprocalDirected={} unresolvedInternalReciprocal={}",
        census.cell_count,
        census.portal_count,
        census.reciprocal_count,
        census.unresolved_internal_reciprocal_count
    );
    println!(
        "  exactMatch={} portalSideFlag={} outside={} nonQuad={} nonAxisAligned={}",
        census.exact_match_count,
        census.portal_side_flag_count,
        census.outside_count,
        census.non_quad_count,
        census.non_axis_aligned_count
    );
    println!(
        "  staticResidents={} visibleCellReferences={}",
        census.static_resident_count, census.visible_cell_reference_count
    );
    print_ranked("deepestContainmentChain", census.deepest_containment_chain);
    print_ranked("densestPortalCell", census.densest_portal_cell);
    print_ranked("largestResidentCell", census.largest_resident_cell);
    if let Some(cell_id) = census.small_reciprocal_sample {
        println!("  smallReciprocalSample=0x{cell_id:08X}");
    }
    if let Some((cell_id, polygon_id, vertex_count)) = census.non_quad_sample {
        println!(
            "  nonQuadSample=cell/0x{cell_id:08X}:polygon/{polygon_id}:vertices/{vertex_count}"
        );
    }
    if let Some((cell_id, polygon_id)) = census.non_axis_aligned_sample {
        println!("  nonAxisAlignedSample=cell/0x{cell_id:08X}:polygon/{polygon_id}");
    }
}

fn print_ranked(label: &str, (count, cell_id): (usize, u32)) {
    println!("  {label}=cell/0x{cell_id:08X}:count/{count}");
}
