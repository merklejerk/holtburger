//! Census authored death destinations and entry links without assuming a final-frame pose.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_world::motion::{BodyMotionRuntime, MotionCommand, MotionOrder};

/// Archive discovery is diagnostic policy, not a runtime dependency of tests.
#[derive(Parser)]
struct Args {
    /// Directory containing the mounted client archives.
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

/// ACE MotionCommand.Dead and MotionStance.NonCombat.
const DEAD: u32 = 0x4000_0011;
const NONCOMBAT: u32 = 0x8000_003d;

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content)?;
    let catalog = content.read_motion_sequence_catalog()?;
    let mut tables: Vec<_> = catalog.tables().collect();
    tables.sort_by_key(|table| table.id);
    let mut destinations = 0;
    let mut links = 0;
    let mut atypical = 0;
    let mut differing_animation = 0;
    let mut multiple_clips = 0;
    let mut moving_destinations = 0;
    let mut reversed_destinations = 0;
    for table in &tables {
        let Some(destination) = table.cycle(NONCOMBAT, DEAD) else {
            continue;
        };
        destinations += 1;
        multiple_clips += usize::from(destination.clips.len() > 1);
        moving_destinations +=
            usize::from(destination.clips.iter().any(|clip| clip.framerate != 0.0));
        reversed_destinations +=
            usize::from(destination.clips.iter().any(|clip| clip.framerate < 0.0));
        let link = table.link(NONCOMBAT, MotionCommand::READY.raw(), DEAD);
        links += usize::from(link.is_some());
        let ordinary = destination.clips.len() == 1
            && destination.clips[0].framerate == 0.0
            && destination.clips[0].low_frame == destination.clips[0].high_frame;
        atypical += usize::from(!ordinary);
        if let (Some(entry), Some(rest)) =
            (link.and_then(|s| s.clips.last()), destination.clips.first())
        {
            differing_animation += usize::from(entry.animation.id != rest.animation.id);
        }
        if !ordinary || link.is_none() {
            println!(
                "exception table={:#010x} ready_link={}",
                table.id,
                link.is_some()
            );
            for clip in &destination.clips {
                println!(
                    "  destination animation={:#010x} frames={}..={} rate={}",
                    clip.animation.id, clip.low_frame, clip.high_frame, clip.framerate
                );
            }
        }
    }
    println!(
        "tables={} noncombat_dead={} without_noncombat_dead={} direct_ready_links={} atypical_destinations={} different_entry_destination_animation={}",
        tables.len(),
        destinations,
        tables.len() - destinations,
        links,
        atypical,
        differing_animation
    );
    println!(
        "multiple_clips={multiple_clips} nonzero_rate_destinations={moving_destinations} negative_rate_destinations={reversed_destinations}"
    );
    for id in [
        0x0900_0001,
        0x0900_0008,
        0x0900_000b,
        0x0900_0230,
        0x0900_0229,
    ] {
        let table = catalog.table(id).context("representative table absent")?;
        let mut runtime = BodyMotionRuntime::new(table);
        let order = MotionOrder {
            style: Some(MotionCommand(NONCOMBAT)),
            forward: Some((MotionCommand(DEAD), 1.0)),
            ..Default::default()
        };
        let established = BodyMotionRuntime::establish(table, order);
        println!(
            "sample {id:#010x} established={:?}",
            established.motion_presentation()
        );
        runtime.accept_order(table, order);
        println!(
            "sample {id:#010x} start={:?}",
            runtime.motion_presentation()
        );
        runtime.drive(table, order, 30.0);
        println!("sample {id:#010x} end={:?}", runtime.motion_presentation());
    }
    Ok(())
}
