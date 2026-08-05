//! Which outdoor landblocks carry the most authored lights?
//!
//! Terrain evaluates authored point lights per pixel, so the cost of that loop is set by the
//! landblocks at the tail of this distribution rather than by the median. This ranks them so a
//! profile can target the worst case deliberately instead of hoping to stumble into it.
//!
//! Deliberately narrower than the census it replaces: no placement breakdown, no generated
//! scenery, no id-family accounting. Those findings are already recorded in the runtime light
//! system plan.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::{ContentDecodeCache, ContentRepository};

/// Landblock info records live at `0xXXXXFFFE`, one per outdoor landblock coordinate.
const LANDBLOCK_INFO_SUFFIX: u32 = 0xFFFE;

/// Only Setup models (DAT family 0x02) can carry authored lights; GfxObjs cannot by construction.
fn is_setup(id: u32) -> bool {
    id >> 24 == 0x02
}

#[derive(Parser)]
#[command(about = "Rank outdoor landblocks by authored static light count")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
    /// How many of the most-lit landblocks to print.
    #[arg(long, default_value_t = 10)]
    top: usize,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let cache = ContentDecodeCache::new();

    let light_count = |did: u32| -> usize {
        if !is_setup(did) {
            return 0;
        }
        cache
            .setup_model(&content, did)
            .map(|setup| setup.lights.len())
            .unwrap_or(0)
    };

    // Enumerate the coordinate space directly rather than through an archive-wide index: the
    // landblock id encodes x and y in its high bytes, so every candidate is derivable, and
    // missing records simply fail to decode.
    let mut ranked: Vec<(u32, usize)> = Vec::new();
    let mut lit = 0usize;
    let mut total_lights = 0usize;
    let mut present = 0usize;
    for x in 0u32..256 {
        for y in 0u32..256 {
            let id = (x << 24) | (y << 16) | LANDBLOCK_INFO_SUFFIX;
            let Ok(info) = cache.landblock_info(&content, id) else {
                continue;
            };
            present += 1;
            let here: usize = info
                .objects
                .iter()
                .map(|stab| light_count(stab.id))
                .chain(info.buildings.iter().map(|b| light_count(b.model_id)))
                .sum();
            if here > 0 {
                lit += 1;
                total_lights += here;
                ranked.push((id >> 16, here));
            }
        }
    }

    ranked.sort_by_key(|(landblock, count)| (std::cmp::Reverse(*count), *landblock));
    println!("landblocks present: {present}, with any authored light: {lit}");
    println!(
        "mean lights per lit landblock: {:.1}",
        if lit == 0 {
            0.0
        } else {
            total_lights as f64 / lit as f64
        }
    );
    for (landblock, count) in ranked.iter().take(args.top) {
        println!("  0x{landblock:04X}FFFF lights={count}");
    }
    Ok(())
}
