//! Are the animated physics-BSP setups actually solid for any spawnable object?
//!
//! A setup carrying a physics BSP only produces per-part collision if some object using it is
//! actually collidable. `PhysicsState::HasPhysicsBSP` is derived from the parts, so it follows
//! automatically — but `Ethereal` and `IgnoreCollisions` gate collision before the BSP path is ever
//! reached (`acclient.c` via ACE `PhysicsObj.FindObjCollisions:385-395`).
//!
//! This checks the catalog for every weenie whose setup is one of the divergent ones, and reports
//! whether it resolves solid, ethereal, or collision-ignoring.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_common::properties::PhysicsState;
use holtburger_weenie_catalog::WeenieCatalog;

/// Multi-part physics-BSP setups whose animations move parts relative to each other, from
/// `physics_bsp_part_animation`.
const DIVERGENT_SETUPS: [u32; 10] = [
    0x0200_0F30,
    0x0200_1091,
    0x0200_1215,
    0x0200_161D,
    0x0200_18F7,
    0x0200_1905,
    0x0200_1940,
    0x0200_1A97,
    0x0200_1B92,
    0x0200_1BF2,
];

#[derive(Parser)]
#[command(about = "Report whether animated physics-BSP setups are collidable in the catalog")]
struct Args {
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: std::path::PathBuf,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let catalog = WeenieCatalog::open(&args.catalog).context("catalog open failed")?;

    let mut matched = 0usize;
    let mut solid = 0usize;
    let mut ethereal = 0usize;
    let mut ignoring = 0usize;

    println!("catalog: {} records", catalog.len());
    println!();

    let wcids: Vec<u32> = catalog.records().map(|record| record.wcid).collect();
    for wcid in wcids {
        let Some(template) = catalog.lookup(wcid).context("catalog lookup failed")? else {
            continue;
        };
        let Some(setup_did) = template.setup_did else {
            continue;
        };
        if !DIVERGENT_SETUPS.contains(&setup_did) {
            continue;
        }
        matched += 1;

        // Absence is not false: an unset override leaves the base mask's bit in force.
        let overrides = &template.physics.overrides;
        let base = template.physics.base_mask.unwrap_or(0);
        let base_ethereal = base & PhysicsState::ETHEREAL.bits() != 0;
        let is_ethereal = overrides.ethereal.unwrap_or(base_ethereal);
        let base_ignores = base & PhysicsState::IGNORE_COLLISIONS.bits() != 0;
        let ignores = overrides.ignore_collisions.unwrap_or(base_ignores);

        let verdict = if ignores {
            ignoring += 1;
            "ignores collisions"
        } else if is_ethereal {
            ethereal += 1;
            "ethereal"
        } else {
            solid += 1;
            "SOLID"
        };

        println!(
            "  wcid {wcid:>6}  setup 0x{setup_did:08X}  base 0x{base:08X}  \
             ethereal={:?} ignore={:?}  -> {verdict}",
            overrides.ethereal, overrides.ignore_collisions
        );
    }

    println!();
    println!("templates on a divergent setup: {matched}");
    println!("  solid (collide per animated part): {solid}");
    println!("  ethereal:                          {ethereal}");
    println!("  ignore collisions:                 {ignoring}");

    Ok(())
}
