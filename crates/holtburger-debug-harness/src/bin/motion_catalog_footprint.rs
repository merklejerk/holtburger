//! What does the host actually hold in memory for the motion contract, and what did it cost to
//! build?
//!
//! The plan's 0.65 MB is the *wire* size of filtered animation records. The host holds a projection
//! with a different shape: per-table hash maps of motion sequences, one clip struct per authored
//! anim entry, and root tracks only for animations that author one. Those are different numbers and
//! conflating them would size the wrong thing.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_common::RigidTransform;
use holtburger_content::{ContentRepository, MotionHook};
use std::collections::HashSet;
use std::mem::size_of;
use std::time::Instant;

#[derive(Parser)]
#[command(about = "Measure the in-memory footprint and build cost of the motion contract")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

/// Sizes what the projection holds for *every* motion-data record, not just the cycle-reachable
/// ones, by reading the raw tables the projection is built from.
fn whole_catalog_estimate(content: &ContentRepository) -> Result<()> {
    use holtburger_dat::file_type::{Animation, MotionTable};
    use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
    use std::io::Cursor;

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

    let mut records = 0usize;
    let mut clip_entries = 0usize;
    let mut referenced: HashSet<u32> = HashSet::new();
    for entry in index.iter().filter(|e| e.type_id == 0x09) {
        let table = MotionTable::read(&mut Cursor::new(read(entry.file_id)?))
            .with_context(|| format!("decode motion table 0x{:08X}", entry.file_id))?;
        let linked = table.links.values().flat_map(|links| links.values());
        for data in table
            .cycles
            .values()
            .chain(table.modifiers.values())
            .chain(linked)
        {
            records += 1;
            clip_entries += data.anims.len();
            referenced.extend(data.anims.iter().map(|anim| anim.anim_id));
        }
    }

    let mut root_transforms = 0usize;
    let mut sim_hooks = 0usize;
    for id in &referenced {
        let animation = Animation::read(&mut Cursor::new(read(*id)?))
            .with_context(|| format!("decode animation 0x{id:08X}"))?;
        root_transforms += animation.pos_frames.len();
        sim_hooks += animation
            .part_frames
            .iter()
            .flat_map(|frame| frame.hooks.iter())
            .filter(|hook| hook.is_simulation_relevant())
            .count();
    }

    let bytes = records * size_of::<holtburger_content::MotionSequence>()
        + clip_entries * 32
        + root_transforms * size_of::<RigidTransform>()
        + sim_hooks * size_of::<MotionHook>();

    println!("\nwhole catalog, computed from the raw records the projection reads:");
    println!("  motion-data records:       {records}");
    println!("  clip entries:              {clip_entries}");
    println!("  distinct animations:       {}", referenced.len());
    println!(
        "  root transforms:           {root_transforms} ({:.2} MB)",
        (root_transforms * size_of::<RigidTransform>()) as f64 / 1_048_576.0
    );
    println!("  simulation hooks:          {sim_hooks}");
    println!(
        "  total:                     {:.2} MB (excludes hash-map overhead)",
        bytes as f64 / 1_048_576.0
    );
    Ok(())
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;

    let started = Instant::now();
    let catalog = content
        .read_motion_sequence_catalog()
        .context("motion contract projection failed")?;
    let build = started.elapsed();

    let mut tables = 0usize;
    let mut sequences = 0usize;
    let mut clips = 0usize;
    let mut animations: HashSet<u32> = HashSet::new();
    let mut root_frames = 0usize;
    let mut hooks = 0usize;
    let mut animations_with_root = 0usize;

    for table in catalog.tables() {
        tables += 1;
        // Cycles are the only map the projection exposes by iteration; modifiers and links are
        // reached through the same clips, so this walks what it can and reports the shortfall.
        for (_, sequence) in table.cycles() {
            sequences += 1;
            for clip in &sequence.clips {
                clips += 1;
                if animations.insert(clip.animation.id) {
                    let track = clip.animation.root.frames().len();
                    root_frames += track;
                    if track > 0 {
                        animations_with_root += 1;
                    }
                    hooks += clip.animation.hooks.hooks().len();
                }
            }
        }
    }

    let clip_bytes = clips * 32; // Arc pointer plus two bounds and a rate.
    let root_bytes = root_frames * size_of::<RigidTransform>();
    let hook_bytes = hooks * size_of::<MotionHook>();
    let sequence_bytes = sequences * size_of::<holtburger_content::MotionSequence>();

    println!("build time: {:.0} ms", build.as_secs_f64() * 1000.0);
    println!();
    println!("cycle-reachable structure the host holds:");
    println!("  tables:                    {tables}");
    println!(
        "  motion sequences:          {sequences} ({:.2} MB of headers)",
        sequence_bytes as f64 / 1_048_576.0
    );
    println!(
        "  clip entries:              {clips} ({:.2} MB)",
        clip_bytes as f64 / 1_048_576.0
    );
    println!("  distinct animations:       {}", animations.len());
    println!("    authoring a root track:  {animations_with_root}");
    println!(
        "  root transforms:           {root_frames} ({:.2} MB)",
        root_bytes as f64 / 1_048_576.0
    );
    println!(
        "  simulation hooks:          {hooks} ({:.2} MB)",
        hook_bytes as f64 / 1_048_576.0
    );
    println!(
        "\n  cycle-reachable subtotal:  {:.2} MB (excludes hash-map overhead)",
        (clip_bytes + root_bytes + hook_bytes + sequence_bytes) as f64 / 1_048_576.0
    );
    // The contract exposes only cycles by iteration, so the whole-catalog figure is computed from
    // the raw records the projection is built from rather than by walking what it holds.
    whole_catalog_estimate(&content)?;

    Ok(())
}
