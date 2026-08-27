//! Measures how shipped EnvCell geometry relates to its authored landblock's outdoor square.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_common::Vector3;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockAssetAssembler,
    LandblockInteriorSystemAssembler, LandblockSceneClass,
};
use holtburger_dat::EOR_CELL_NAMESPACE;

const LANDBLOCK_SIZE: f32 = 192.0;
/// Ignores sub-millimetre rotation noise at an exactly authored owner-square edge.
const BOUNDARY_EPSILON: f32 = 0.001;

#[derive(Debug, Parser)]
#[command(about = "Census EnvCell extents outside their authored owner's 192-metre square")]
struct Args {
    /// Optional HBA file or directory; normal content discovery is used when omitted.
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

/// Aggregate counts and extrema for one owner traversal class or the complete archive.
#[derive(Debug, Default)]
struct Census {
    /// Landblocks with at least one authored EnvCell.
    owners: usize,
    /// EnvCells inspected.
    cells: usize,
    /// EnvCells whose authored origin is strictly outside the owner square.
    crossing_origins: usize,
    /// EnvCells whose transformed geometry extends strictly outside the owner square.
    crossing_bounds: usize,
    /// EnvCells whose CellStruct has no vertices from which to derive bounds.
    empty_bounds: usize,
    /// Smallest transformed geometry coordinate observed on X.
    minimum_x: f32,
    /// Largest transformed geometry coordinate observed on X.
    maximum_x: f32,
    /// Smallest transformed geometry coordinate observed on Y.
    minimum_y: f32,
    /// Largest transformed geometry coordinate observed on Y.
    maximum_y: f32,
    /// Largest number of complete nominal owner squares crossed by any bound.
    maximum_grid_displacement: u32,
    /// Number of cells at each maximum per-cell grid displacement.
    displacement_counts: BTreeMap<u32, usize>,
    /// Representative cells for each boundary-crossing direction.
    examples: BoundaryExamples,
}

/// First deterministic representative observed for each boundary condition.
#[derive(Debug, Default)]
struct BoundaryExamples {
    /// Geometry below owner-local X zero.
    negative_x: Option<Example>,
    /// Geometry below owner-local Y zero.
    negative_y: Option<Example>,
    /// Geometry above owner-local X 192.
    above_x: Option<Example>,
    /// Geometry above owner-local Y 192.
    above_y: Option<Example>,
    /// Geometry crossing edges on both axes.
    corner: Option<Example>,
    /// Geometry displaced by more than one nominal owner square.
    beyond_adjacent: Option<Example>,
}

/// One EnvCell and its placed geometry bounds.
#[derive(Debug, Clone, Copy)]
struct Example {
    /// Full authored EnvCell DID.
    cell_id: u32,
    /// Minimum placed geometry coordinate.
    minimum: Vector3,
    /// Maximum placed geometry coordinate.
    maximum: Vector3,
}

impl Census {
    fn new() -> Self {
        Self {
            minimum_x: f32::INFINITY,
            maximum_x: f32::NEG_INFINITY,
            minimum_y: f32::INFINITY,
            maximum_y: f32::NEG_INFINITY,
            ..Self::default()
        }
    }

    fn observe_origin(&mut self, origin: Vector3) {
        if outside_owner(origin.x) || outside_owner(origin.y) {
            self.crossing_origins += 1;
        }
    }

    fn observe_bounds(&mut self, example: Example) {
        self.minimum_x = self.minimum_x.min(example.minimum.x);
        self.maximum_x = self.maximum_x.max(example.maximum.x);
        self.minimum_y = self.minimum_y.min(example.minimum.y);
        self.maximum_y = self.maximum_y.max(example.maximum.y);

        let negative_x = example.minimum.x < -BOUNDARY_EPSILON;
        let negative_y = example.minimum.y < -BOUNDARY_EPSILON;
        let above_x = example.maximum.x > LANDBLOCK_SIZE + BOUNDARY_EPSILON;
        let above_y = example.maximum.y > LANDBLOCK_SIZE + BOUNDARY_EPSILON;
        if negative_x || negative_y || above_x || above_y {
            self.crossing_bounds += 1;
        }

        let displacement = grid_displacement(example.minimum, example.maximum);
        self.maximum_grid_displacement = self.maximum_grid_displacement.max(displacement);
        *self.displacement_counts.entry(displacement).or_default() += 1;
        if negative_x {
            replace_if(
                &mut self.examples.negative_x,
                example,
                |candidate, current| candidate.minimum.x < current.minimum.x,
            );
        }
        if negative_y {
            replace_if(
                &mut self.examples.negative_y,
                example,
                |candidate, current| candidate.minimum.y < current.minimum.y,
            );
        }
        if above_x {
            replace_if(&mut self.examples.above_x, example, |candidate, current| {
                candidate.maximum.x > current.maximum.x
            });
        }
        if above_y {
            replace_if(&mut self.examples.above_y, example, |candidate, current| {
                candidate.maximum.y > current.maximum.y
            });
        }
        if (negative_x || above_x) && (negative_y || above_y) {
            self.examples.corner.get_or_insert(example);
        }
        if displacement > 1 {
            replace_if(
                &mut self.examples.beyond_adjacent,
                example,
                |candidate, current| {
                    grid_displacement(candidate.minimum, candidate.maximum)
                        > grid_displacement(current.minimum, current.maximum)
                },
            );
        }
    }
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let cache = ContentDecodeCache::new();
    let active_region = cache
        .active_region_data(&content)
        .context("active region decode failed")?;
    let landblock_ids = content
        .resource_index()
        .iter()
        .filter(|entry| {
            entry.namespace == EOR_CELL_NAMESPACE
                && entry.file_id & 0xffff == 0xffff
                && !entry.is_pruned
        })
        .map(|entry| entry.file_id)
        .collect::<Vec<_>>();

    let mut all = Census::new();
    let mut dungeon = Census::new();
    let mut outdoor_with_env_cells = Census::new();
    for landblock_id in landblock_ids {
        let Some(landblock) = LandblockAssetAssembler
            .assemble(&content, &cache, &active_region, landblock_id)
            .with_context(|| format!("landblock 0x{landblock_id:08X} assembly failed"))?
        else {
            continue;
        };
        if landblock.env_cell_refs.is_empty() {
            continue;
        }
        let interior = LandblockInteriorSystemAssembler
            .assemble(&content, &cache, &landblock)
            .with_context(|| format!("interior 0x{landblock_id:08X} assembly failed"))?;
        let class = match landblock.scene_class {
            LandblockSceneClass::DungeonOnly => &mut dungeon,
            LandblockSceneClass::OutdoorWithEnvCells => &mut outdoor_with_env_cells,
            LandblockSceneClass::OutdoorOnly => continue,
        };
        all.owners += 1;
        class.owners += 1;

        for cell in &interior.cells {
            all.cells += 1;
            class.cells += 1;
            all.observe_origin(cell.placement.origin);
            class.observe_origin(cell.placement.origin);

            let environment = interior
                .environments
                .get(&cell.structure.environment_id)
                .with_context(|| {
                    format!(
                        "interior 0x{landblock_id:08X} omitted Environment 0x{:08X}",
                        cell.structure.environment_id
                    )
                })?;
            let structure = environment
                .cells
                .get(&cell.structure.local_selector)
                .with_context(|| {
                    format!(
                        "Environment 0x{:08X} omitted CellStruct 0x{:08X}",
                        cell.structure.environment_id, cell.structure.local_selector
                    )
                })?;
            let Some((minimum, maximum)) = placed_bounds(
                structure
                    .vertex_array
                    .vertices
                    .values()
                    .map(|vertex| vertex.origin),
                cell.placement,
            ) else {
                all.empty_bounds += 1;
                class.empty_bounds += 1;
                continue;
            };
            let example = Example {
                cell_id: cell.env_cell_id,
                minimum,
                maximum,
            };
            all.observe_bounds(example);
            class.observe_bounds(example);
        }
    }

    report("all", &all);
    report("dungeon-only", &dungeon);
    report("outdoor-with-env-cells", &outdoor_with_env_cells);
    Ok(())
}

fn placed_bounds(
    points: impl Iterator<Item = Vector3>,
    placement: holtburger_content::LandblockPlacement,
) -> Option<(Vector3, Vector3)> {
    let mut minimum = Vector3::new(f32::INFINITY, f32::INFINITY, f32::INFINITY);
    let mut maximum = Vector3::new(f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
    let mut populated = false;
    for point in points {
        let placed = placement.orientation.rotate_vector(point) + placement.origin;
        minimum.x = minimum.x.min(placed.x);
        minimum.y = minimum.y.min(placed.y);
        minimum.z = minimum.z.min(placed.z);
        maximum.x = maximum.x.max(placed.x);
        maximum.y = maximum.y.max(placed.y);
        maximum.z = maximum.z.max(placed.z);
        populated = true;
    }
    populated.then_some((minimum, maximum))
}

fn outside_owner(value: f32) -> bool {
    !(-BOUNDARY_EPSILON..=LANDBLOCK_SIZE + BOUNDARY_EPSILON).contains(&value)
}

fn grid_displacement(minimum: Vector3, maximum: Vector3) -> u32 {
    [minimum.x, minimum.y, maximum.x, maximum.y]
        .into_iter()
        .map(|value| {
            if value < -BOUNDARY_EPSILON {
                (-value / LANDBLOCK_SIZE).ceil() as u32
            } else if value > LANDBLOCK_SIZE + BOUNDARY_EPSILON {
                (value / LANDBLOCK_SIZE).ceil() as u32 - 1
            } else {
                0
            }
        })
        .max()
        .unwrap_or(0)
}

fn report(label: &str, census: &Census) {
    println!(
        "{label}: owners={} cells={} crossing_origins={} crossing_bounds={} empty_bounds={} x=[{:.3},{:.3}] y=[{:.3},{:.3}] max_grid_displacement={}",
        census.owners,
        census.cells,
        census.crossing_origins,
        census.crossing_bounds,
        census.empty_bounds,
        census.minimum_x,
        census.maximum_x,
        census.minimum_y,
        census.maximum_y,
        census.maximum_grid_displacement,
    );
    println!(
        "{label}.grid_displacements: {:?}",
        census.displacement_counts
    );
    report_example(label, "negative_x", census.examples.negative_x);
    report_example(label, "negative_y", census.examples.negative_y);
    report_example(label, "above_x", census.examples.above_x);
    report_example(label, "above_y", census.examples.above_y);
    report_example(label, "corner", census.examples.corner);
    report_example(label, "beyond_adjacent", census.examples.beyond_adjacent);
}

fn replace_if(
    current: &mut Option<Example>,
    candidate: Example,
    predicate: impl FnOnce(Example, Example) -> bool,
) {
    if current.is_none_or(|value| predicate(candidate, value)) {
        *current = Some(candidate);
    }
}

fn report_example(label: &str, kind: &str, example: Option<Example>) {
    match example {
        Some(example) => println!(
            "{label}.{kind}: cell=0x{:08X} min=[{:.3},{:.3},{:.3}] max=[{:.3},{:.3},{:.3}]",
            example.cell_id,
            example.minimum.x,
            example.minimum.y,
            example.minimum.z,
            example.maximum.x,
            example.maximum.y,
            example.maximum.z,
        ),
        None => println!("{label}.{kind}: none"),
    }
}
