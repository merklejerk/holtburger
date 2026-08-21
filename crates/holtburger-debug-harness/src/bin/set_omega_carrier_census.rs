//! Who carries a `SetOmega` hook, and does any of them have a body to spin?
//!
//! Routing `SetOmega` to a body's angular velocity instead of the visual root is only possible for
//! carriers that *have* a body. Authored landblock scenery does not: its collision is static
//! landblock geometry, not a registered spatial body. This reports which setups carry the hook and
//! whether any catalog template reaches them.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{Animation, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_weenie_catalog::WeenieCatalog;
use std::collections::{HashMap, HashSet};
use std::io::Cursor;

/// Retail's `SetOmega` animation hook type.
const SET_OMEGA_HOOK: u32 = 22;

#[derive(Parser)]
#[command(about = "Census SetOmega hook carriers and whether any is a spawnable body")]
struct Args {
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: std::path::PathBuf,
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let read = |id: u32| -> Result<Vec<u8>> {
        Ok(content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, id))
            .with_context(|| format!("read 0x{id:08X}"))?
            .bytes)
    };
    let index: Vec<_> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE)
        .cloned()
        .collect();

    // Every animation carrying the hook, archive-wide.
    let mut omega_animations: HashSet<u32> = HashSet::new();
    let mut hook_count = 0usize;
    for entry in index.iter().filter(|e| e.type_id == 0x03) {
        let Ok(bytes) = read(entry.file_id) else {
            continue;
        };
        let Ok(animation) = Animation::read(&mut Cursor::new(&bytes)) else {
            continue;
        };
        let hooks: usize = animation
            .part_frames
            .iter()
            .map(|frame| {
                frame
                    .hooks
                    .iter()
                    .filter(|hook| hook.hook_type == SET_OMEGA_HOOK)
                    .count()
            })
            .sum();
        if hooks > 0 {
            hook_count += hooks;
            omega_animations.insert(entry.file_id);
        }
    }
    println!("animations carrying SetOmega: {}", omega_animations.len());
    println!("total SetOmega hooks:         {hook_count}");

    // Which setups reach one through their bare default animation.
    let mut carrier_setups: HashMap<u32, u32> = HashMap::new();
    for entry in index.iter().filter(|e| e.type_id == 0x02) {
        let Ok(bytes) = read(entry.file_id) else {
            continue;
        };
        let Ok(setup) = SetupModel::read(&mut Cursor::new(&bytes)) else {
            continue;
        };
        if let Some(animation_id) = setup
            .default_animation
            .filter(|id| omega_animations.contains(id))
        {
            carrier_setups.insert(entry.file_id, animation_id);
        }
    }
    println!(
        "setups whose default animation carries it: {}",
        carrier_setups.len()
    );
    for (setup_id, animation_id) in &carrier_setups {
        println!("  setup 0x{setup_id:08X}  anim 0x{animation_id:08X}");
    }

    // And whether any spawnable template reaches those setups — a template has a body, scenery
    // does not.
    let catalog = WeenieCatalog::open(&args.catalog).context("catalog open failed")?;
    let mut spawnable = 0usize;
    let wcids: Vec<u32> = catalog.records().map(|record| record.wcid).collect();
    for wcid in wcids {
        let Some(template) = catalog.lookup(wcid)? else {
            continue;
        };
        let Some(setup_did) = template.setup_did else {
            continue;
        };
        if carrier_setups.contains_key(&setup_did) {
            spawnable += 1;
            println!(
                "  SPAWNABLE  wcid {wcid:>6}  setup 0x{setup_did:08X}  {:?}",
                template.name
            );
        }
    }
    println!();
    println!("catalog templates reaching a SetOmega carrier: {spawnable}");
    println!(
        "  (zero means every carrier is authored scenery, which owns no spatial body to spin)"
    );
    Ok(())
}
