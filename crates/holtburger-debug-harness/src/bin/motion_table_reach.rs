//! How much would warming a whole motion table at spawn actually cost?
//!
//! A frontend prepares an animation as frame-major part transforms, so its cost is
//! `frames * parts * 64` bytes. Warming a table means preparing everything it can reach, which is
//! only affordable if per-table reach is small — and the answer differs enormously between a door
//! and a player character.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{Animation, MotionTable, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::Cursor;

const MAT4_BYTES: u64 = 64;
const SETUP_MODEL_TYPE: u32 = 0x02;
const ANIMATION_TYPE: u32 = 0x03;
const MOTION_TABLE_TYPE: u32 = 0x09;

#[derive(Parser)]
#[command(about = "Size what warming a whole motion table would cost a frontend")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: std::path::PathBuf,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let index: Vec<_> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE)
        .cloned()
        .collect();
    let read = |file_id: u32| -> Result<Vec<u8>> {
        Ok(content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, file_id))?
            .bytes)
    };

    // Prepared cost of one animation, as the frontend would hold it.
    let mut animation_bytes: HashMap<u32, u64> = HashMap::new();
    for entry in index.iter().filter(|e| e.type_id == ANIMATION_TYPE) {
        let animation = Animation::read(&mut Cursor::new(read(entry.file_id)?))
            .with_context(|| format!("decode animation 0x{:08X}", entry.file_id))?;
        animation_bytes.insert(
            animation.id,
            u64::from(animation.num_frames) * u64::from(animation.num_parts) * MAT4_BYTES,
        );
    }

    let mut all_referenced: HashSet<u32> = HashSet::new();
    let mut per_table: Vec<(u32, usize, u64)> = Vec::new();
    let mut setups_by_table: BTreeMap<u32, usize> = BTreeMap::new();
    for entry in index.iter().filter(|e| e.type_id == MOTION_TABLE_TYPE) {
        let table = MotionTable::read(&mut Cursor::new(read(entry.file_id)?))
            .with_context(|| format!("decode motion table 0x{:08X}", entry.file_id))?;
        let linked = table.links.values().flat_map(|links| links.values());
        let mut reachable: HashSet<u32> = HashSet::new();
        for motion_data in table
            .cycles
            .values()
            .chain(table.modifiers.values())
            .chain(linked)
        {
            reachable.extend(motion_data.anims.iter().map(|anim| anim.anim_id));
        }
        all_referenced.extend(reachable.iter().copied());
        let bytes: u64 = reachable
            .iter()
            .filter_map(|id| animation_bytes.get(id))
            .sum();
        per_table.push((table.id, reachable.len(), bytes));
        setups_by_table.entry(table.id).or_insert(0);
    }

    // Which tables real content actually installs, so the distribution is weighted by use.
    for entry in index.iter().filter(|e| e.type_id == SETUP_MODEL_TYPE) {
        let setup = SetupModel::read(&mut Cursor::new(read(entry.file_id)?))
            .with_context(|| format!("decode setup 0x{:08X}", entry.file_id))?;
        if let Some(table) = setup.default_motion_table {
            *setups_by_table.entry(table).or_insert(0) += 1;
        }
    }

    per_table.sort_by_key(|(_, count, _)| *count);
    let total: u64 = per_table.iter().map(|(_, _, bytes)| bytes).sum();
    let percentile = |p: usize| per_table[per_table.len() * p / 100];

    println!("motion tables: {}", per_table.len());
    println!("reachable animations per table (count, prepared MB):");
    for (label, (id, count, bytes)) in [
        ("  min   ", per_table[0]),
        ("  p50   ", percentile(50)),
        ("  p90   ", percentile(90)),
        ("  p99   ", percentile(99)),
        ("  max   ", per_table[per_table.len() - 1]),
    ] {
        println!(
            "{label} table 0x{id:08X}: {count:>4} animations, {:.2} MB prepared",
            bytes as f64 / 1_048_576.0
        );
    }
    println!(
        "\nsum over all tables (double-counting shared animations): {:.2} MB",
        total as f64 / 1_048_576.0
    );

    let distinct: u64 = all_referenced
        .iter()
        .filter_map(|id| animation_bytes.get(id))
        .sum();
    println!(
        "every distinct table-reachable animation, prepared once: {} animations, {:.2} MB",
        all_referenced.len(),
        distinct as f64 / 1_048_576.0
    );
    println!(
        "  sharing factor across tables: {:.1}x",
        total as f64 / distinct as f64
    );

    let standard = per_table
        .iter()
        .find(|(id, _, _)| *id == 0x0900_0001)
        .copied();
    if let Some((id, count, bytes)) = standard {
        println!(
            "standard character table 0x{id:08X}: {count} animations, {:.2} MB prepared",
            bytes as f64 / 1_048_576.0
        );
    }

    let mut heaviest: Vec<_> = per_table.iter().rev().take(5).collect();
    heaviest.reverse();
    println!("\nheaviest five tables and how many setups install them:");
    for (id, count, bytes) in heaviest {
        println!(
            "  0x{id:08X}: {count:>4} animations, {:.2} MB, installed by {} setups",
            *bytes as f64 / 1_048_576.0,
            setups_by_table.get(id).copied().unwrap_or(0)
        );
    }

    Ok(())
}
