use std::collections::{BTreeMap, BTreeSet};
use std::io::Cursor;

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_dat::file_type::{DatFileType, EnvCell, Environment, GfxObj};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader};

const STIPPLING_NO_POS: u8 = 0x04;
const STIPPLING_NO_NEG: u8 = 0x08;
const CULL_MODE_NONE: i32 = 1;
const CULL_MODE_CLOCKWISE: i32 = 2;
const CULL_MODE_COUNTER_CLOCKWISE: i32 = 3;
const SAMPLE_LIMIT: usize = 12;

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
}

#[derive(Default)]
struct PolygonSideAudit {
    total_polygons: usize,
    sides_type_counts: BTreeMap<i32, usize>,
    stippling_counts: BTreeMap<u8, usize>,
    no_pos_count: usize,
    no_neg_count: usize,
    malformed_positive_uv_count: usize,
    malformed_negative_uv_count: usize,
    counter_clockwise_samples: Vec<String>,
    no_pos_samples: Vec<String>,
    malformed_samples: Vec<String>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let archive = HbaReader::open(&args.dats)
        .with_context(|| format!("failed to open HBA archive {}", args.dats))?;
    let mut gfx_obj_audit = PolygonSideAudit::default();
    let mut env_cell_audit = PolygonSideAudit::default();
    let mut visited_cell_structures = BTreeSet::new();

    for entry in archive.entries() {
        let entry = entry?;
        let namespace = entry.namespace_id()?;
        if namespace.as_str() == EOR_PORTAL_NAMESPACE
            && DatFileType::from_id(entry.file_id) == DatFileType::Model
        {
            let bytes = archive.get_file_in_namespace(EOR_PORTAL_NAMESPACE, entry.file_id)?;
            let gfx_obj = GfxObj::unpack(&mut Cursor::new(bytes))
                .with_context(|| format!("failed to decode GfxObj 0x{:08X}", entry.file_id))?;
            for (polygon_id, polygon) in &gfx_obj.polygons {
                gfx_obj_audit.record(
                    format!("gfx-obj/0x{:08X}:polygon/{}", entry.file_id, polygon_id),
                    polygon,
                );
            }
            continue;
        }

        if namespace.as_str() == EOR_CELL_NAMESPACE
            && DatFileType::from_id(entry.file_id) == DatFileType::IndoorCell
        {
            let bytes = archive.get_file_in_namespace(EOR_CELL_NAMESPACE, entry.file_id)?;
            let env_cell = EnvCell::unpack(&mut Cursor::new(bytes))
                .with_context(|| format!("failed to decode EnvCell 0x{:08X}", entry.file_id))?;
            if env_cell.environment_id == 0 {
                continue;
            }
            let environment_id = 0x0D00_0000 | u32::from(env_cell.environment_id);
            let cell_structure_id = u32::from(env_cell.cell_structure);
            if !visited_cell_structures.insert((environment_id, cell_structure_id)) {
                continue;
            }
            let environment_bytes =
                archive.get_file_in_namespace(EOR_PORTAL_NAMESPACE, environment_id)?;
            let environment = Environment::unpack(&mut Cursor::new(environment_bytes))
                .with_context(|| format!("failed to decode Environment 0x{environment_id:08X}"))?;
            let Some(cell_structure) = environment.cells.get(&cell_structure_id) else {
                continue;
            };
            for (polygon_id, polygon) in &cell_structure.polygons {
                env_cell_audit.record(
                    format!(
                        "env-cell/0x{:08X}:environment/0x{:08X}:cell-structure/0x{:04X}:polygon/{}",
                        entry.file_id, environment_id, cell_structure_id, polygon_id
                    ),
                    polygon,
                );
            }
        }
    }

    print_audit("gfx-obj constructed mesh polygons", &gfx_obj_audit);
    print_audit("env-cell shell polygons", &env_cell_audit);
    Ok(())
}

impl PolygonSideAudit {
    fn record(&mut self, sample_key: String, polygon: &holtburger_dat::graphics::Polygon) {
        self.total_polygons += 1;
        *self
            .sides_type_counts
            .entry(polygon.sides_type)
            .or_default() += 1;
        *self.stippling_counts.entry(polygon.stippling).or_default() += 1;
        if (polygon.stippling & STIPPLING_NO_POS) != 0 {
            self.no_pos_count += 1;
            push_sample(&mut self.no_pos_samples, sample_key.clone());
        }
        if (polygon.stippling & STIPPLING_NO_NEG) != 0 {
            self.no_neg_count += 1;
        }
        if polygon.sides_type == CULL_MODE_COUNTER_CLOCKWISE {
            push_sample(&mut self.counter_clockwise_samples, sample_key.clone());
        }
        if (polygon.stippling & STIPPLING_NO_POS) == 0
            && polygon.pos_uv_indices.len() != polygon.vertex_ids.len()
        {
            self.malformed_positive_uv_count += 1;
            push_sample(
                &mut self.malformed_samples,
                format!("{sample_key}:malformed-positive-uv"),
            );
        }
        if polygon.sides_type == CULL_MODE_CLOCKWISE
            && (polygon.stippling & STIPPLING_NO_NEG) == 0
            && polygon.neg_uv_indices.len() != polygon.vertex_ids.len()
        {
            self.malformed_negative_uv_count += 1;
            push_sample(
                &mut self.malformed_samples,
                format!("{sample_key}:malformed-negative-uv"),
            );
        }
    }
}

fn print_audit(label: &str, audit: &PolygonSideAudit) {
    println!("{label}");
    println!("  totalPolygons={}", audit.total_polygons);
    println!(
        "  sidesType none={} clockwise={} counterClockwise={} other={}",
        audit.sides_type_count(CULL_MODE_NONE),
        audit.sides_type_count(CULL_MODE_CLOCKWISE),
        audit.sides_type_count(CULL_MODE_COUNTER_CLOCKWISE),
        audit.other_sides_type_count()
    );
    println!("  sidesTypeRaw={:?}", audit.sides_type_counts);
    println!("  stipplingRaw={:?}", audit.stippling_counts);
    println!(
        "  noPos={} noNeg={} malformedPositiveUv={} malformedNegativeUv={}",
        audit.no_pos_count,
        audit.no_neg_count,
        audit.malformed_positive_uv_count,
        audit.malformed_negative_uv_count
    );
    print_samples("counterClockwiseSamples", &audit.counter_clockwise_samples);
    print_samples("noPosSamples", &audit.no_pos_samples);
    print_samples("malformedSamples", &audit.malformed_samples);
}

impl PolygonSideAudit {
    fn sides_type_count(&self, sides_type: i32) -> usize {
        self.sides_type_counts
            .get(&sides_type)
            .copied()
            .unwrap_or(0)
    }

    fn other_sides_type_count(&self) -> usize {
        self.sides_type_counts
            .iter()
            .filter(|(sides_type, _)| {
                !matches!(
                    **sides_type,
                    CULL_MODE_NONE | CULL_MODE_CLOCKWISE | CULL_MODE_COUNTER_CLOCKWISE
                )
            })
            .map(|(_, count)| count)
            .sum()
    }
}

fn print_samples(label: &str, samples: &[String]) {
    if samples.is_empty() {
        return;
    }
    println!("  {label}:");
    for sample in samples {
        println!("    {sample}");
    }
}

fn push_sample(samples: &mut Vec<String>, sample: String) {
    if samples.len() < SAMPLE_LIMIT {
        samples.push(sample);
    }
}
