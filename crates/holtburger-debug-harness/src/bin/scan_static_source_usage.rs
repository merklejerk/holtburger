use anyhow::{Context, Result};
use clap::Parser;
use holtburger_dat::file_type::EnvCell;
use holtburger_dat::landblock::LandblockInfo;
use holtburger_dat::{EOR_CELL_NAMESPACE, HbaReader};
use std::collections::BTreeMap;
use std::io::Cursor;

#[derive(Parser, Debug)]
struct Args {
    #[arg(long, default_value = "dats/assets.hba")]
    dats: String,
    #[arg(long)]
    did: Vec<String>,
    #[arg(long, default_value_t = 20)]
    limit: usize,
}

#[derive(Default)]
struct UsageReport {
    outdoor_objects: Vec<UsageSample>,
    buildings: Vec<UsageSample>,
    env_cell_statics: Vec<UsageSample>,
}

struct UsageSample {
    file_id: u32,
    index: usize,
    origin: (f32, f32, f32),
}

fn main() -> Result<()> {
    let args = Args::parse();
    let source_ids = args
        .did
        .iter()
        .map(|value| parse_hex_u32(value))
        .collect::<Result<Vec<_>>>()?;
    let mut reports = source_ids
        .iter()
        .copied()
        .map(|source_id| (source_id, UsageReport::default()))
        .collect::<BTreeMap<_, _>>();

    let hba =
        HbaReader::open(&args.dats).with_context(|| format!("failed to open {}", args.dats))?;
    for entry in hba.entries() {
        let entry = entry?;
        if entry.namespace_id()?.as_str() != EOR_CELL_NAMESPACE {
            continue;
        }
        let low = entry.file_id & 0xffff;
        if low == 0xfffe {
            let bytes = hba.get_file_in_namespace(EOR_CELL_NAMESPACE, entry.file_id)?;
            let info = LandblockInfo::unpack(&bytes).with_context(|| {
                format!("failed to parse LandblockInfo 0x{:08X}", entry.file_id)
            })?;
            for (index, object) in info.objects.iter().enumerate() {
                if let Some(report) = reports.get_mut(&object.id) {
                    report.outdoor_objects.push(UsageSample {
                        file_id: entry.file_id,
                        index,
                        origin: (
                            object.frame.origin.x,
                            object.frame.origin.y,
                            object.frame.origin.z,
                        ),
                    });
                }
            }
            for (index, building) in info.buildings.iter().enumerate() {
                if let Some(report) = reports.get_mut(&building.model_id) {
                    report.buildings.push(UsageSample {
                        file_id: entry.file_id,
                        index,
                        origin: (
                            building.frame.origin.x,
                            building.frame.origin.y,
                            building.frame.origin.z,
                        ),
                    });
                }
            }
        } else if (0x0100..=0xfffd).contains(&low) {
            let bytes = hba.get_file_in_namespace(EOR_CELL_NAMESPACE, entry.file_id)?;
            let env_cell = EnvCell::unpack(&mut Cursor::new(bytes))
                .with_context(|| format!("failed to parse EnvCell 0x{:08X}", entry.file_id))?;
            for (index, object) in env_cell.static_objects.iter().enumerate() {
                if let Some(report) = reports.get_mut(&object.stab_id) {
                    report.env_cell_statics.push(UsageSample {
                        file_id: entry.file_id,
                        index,
                        origin: (
                            object.position.origin.x,
                            object.position.origin.y,
                            object.position.origin.z,
                        ),
                    });
                }
            }
        }
    }

    for (source_id, report) in reports {
        println!("source=0x{source_id:08x}");
        print_group("outdoorObjects", &report.outdoor_objects, args.limit);
        print_group("buildings", &report.buildings, args.limit);
        print_group("envCellStatics", &report.env_cell_statics, args.limit);
    }

    Ok(())
}

fn print_group(label: &str, samples: &[UsageSample], limit: usize) {
    println!("  {label} count={}", samples.len());
    for sample in samples.iter().take(limit) {
        println!(
            "    file=0x{:08x} index={} origin=({:.3},{:.3},{:.3})",
            sample.file_id, sample.index, sample.origin.0, sample.origin.1, sample.origin.2,
        );
    }
}

fn parse_hex_u32(value: &str) -> Result<u32> {
    Ok(u32::from_str_radix(value.trim_start_matches("0x"), 16)?)
}
