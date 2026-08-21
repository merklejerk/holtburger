//! Phase 1 acceptance evidence for the `MotionSequence` contract, run against real content.
//!
//! Checks that the projection covers the whole archive, that the standard character walk
//! reconstructs as an authored sequence rather than a mean velocity, and that the simulation hooks
//! the contract promises to preserve survive the projection.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::{ContentRepository, MotionHookEffect};
use holtburger_dat::file_type::MotionTable;
use std::time::Instant;

/// Standard character motion table, its default style, and walk-forward, from the plan's evidence.
const STANDARD_TABLE: u32 = 0x0900_0001;
const STANDARD_STYLE: u32 = 0x8000_003D;

#[derive(Parser)]
#[command(about = "Verify the motion contract against the mounted archive")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;

    let started = Instant::now();
    let catalog = content
        .read_motion_sequence_catalog()
        .context("motion contract projection failed")?;
    let elapsed = started.elapsed();

    let tables: Vec<_> = catalog.tables().collect();
    let cycles: usize = tables.iter().map(|table| table.cycle_count()).sum();
    println!(
        "projected {} tables ({cycles} cycles) and {} setup defaults in {:.0} ms",
        tables.len(),
        catalog.setup_default_tables().count(),
        elapsed.as_secs_f64() * 1000.0
    );

    let table = catalog
        .table(STANDARD_TABLE)
        .context("standard character motion table is absent")?;
    println!(
        "\nstandard table 0x{STANDARD_TABLE:08X}: default style 0x{:08X}",
        table.default_style
    );

    let walk = table
        .cycle(STANDARD_STYLE, MotionTable::WALK_FORWARD_COMMAND)
        .context("standard walk-forward cycle is absent")?;
    println!(
        "  walk-forward: {} clip(s), velocity {:?}, omega {:?}",
        walk.clips.len(),
        walk.velocity,
        walk.omega
    );
    for clip in &walk.clips {
        let composed = clip
            .animation
            .root
            .composed_over(clip.low_frame, clip.high_frame);
        println!(
            "    animation 0x{:08X}: frames {}..={} of {} at {} fps",
            clip.animation.id,
            clip.low_frame,
            clip.high_frame,
            clip.animation.frame_count,
            clip.framerate
        );
        println!(
            "      root track: {} frames, composed translation {:?}",
            clip.animation.root.frames().len(),
            composed.translation
        );
        let magnitude = (composed.translation.x.powi(2)
            + composed.translation.y.powi(2)
            + composed.translation.z.powi(2))
        .sqrt();
        println!(
            "      composed distance {magnitude:.4} m; reduced mean speed would be {:.4} m/s",
            magnitude / clip.animation.root.frames().len().max(1) as f32 * clip.framerate
        );
    }

    let mut attack = 0usize;
    let mut ethereal = 0usize;
    let mut replace = 0usize;
    let mut animations_with_root = 0usize;
    let mut distinct_animations = std::collections::HashSet::new();
    for table in &tables {
        for (_, sequence) in table.cycles() {
            for clip in &sequence.clips {
                if !distinct_animations.insert(clip.animation.id) {
                    continue;
                }
                if !clip.animation.root.is_stationary() {
                    animations_with_root += 1;
                }
                for hook in clip.animation.hooks.hooks() {
                    match hook.effect {
                        MotionHookEffect::Attack(_) => attack += 1,
                        MotionHookEffect::Ethereal { .. } => ethereal += 1,
                        MotionHookEffect::ReplaceObject(_) => replace += 1,
                    }
                }
            }
        }
    }

    println!(
        "\ncycle-reachable animations: {}",
        distinct_animations.len()
    );
    println!("  authoring root motion:    {animations_with_root}");
    println!("  attack hooks:             {attack}");
    println!("  ethereal hooks:           {ethereal}");
    println!("  replace-object hooks:     {replace}");

    Ok(())
}
