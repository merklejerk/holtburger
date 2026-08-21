//! Which spawnable templates animate from a motion table?
//!
//! The runtime clip swap only engages for an entity whose template names a motion table, so a
//! browser-harness spawn has to pick one deliberately rather than by guessing a WCID.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_weenie_catalog::WeenieCatalog;

#[derive(Parser)]
#[command(about = "List catalog templates that carry a motion table")]
struct Args {
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: std::path::PathBuf,
    /// Stop after this many matches.
    #[arg(long, default_value_t = 20)]
    limit: usize,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let catalog = WeenieCatalog::open(&args.catalog).context("catalog open failed")?;

    let mut matched = 0usize;
    let wcids: Vec<u32> = catalog.records().map(|record| record.wcid).collect();
    for wcid in wcids {
        let Some(template) = catalog.lookup(wcid).context("catalog lookup failed")? else {
            continue;
        };
        let Some(motion_table_did) = template.motion_table_did else {
            continue;
        };
        matched += 1;
        if matched <= args.limit {
            println!(
                "  wcid {wcid:>6}  motion 0x{motion_table_did:08X}  setup {:?}  name {:?}",
                template.setup_did.map(|did| format!("0x{did:08X}")),
                template.name,
            );
        }
    }

    println!();
    println!("templates on a motion table: {matched}");
    Ok(())
}
