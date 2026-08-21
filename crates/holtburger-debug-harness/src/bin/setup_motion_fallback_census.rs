//! How much traffic does the setup-model motion-table fallback actually carry?
//!
//! Motion resolution falls back from an entity's own motion-table property to the default motion
//! table declared by its setup model. That fallback is the only reason a runtime motion contract
//! would need a setup-to-table index at all, so its size decides whether the index earns its keep.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::SetupModel;
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_weenie_catalog::WeenieCatalog;
use std::collections::{HashMap, HashSet};
use std::io::Cursor;

const SETUP_MODEL_TYPE: u32 = 0x02;

#[derive(Parser)]
#[command(about = "Census the setup-model motion-table fallback across the weenie catalog")]
struct Args {
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: std::path::PathBuf,
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let catalog = WeenieCatalog::open(&args.catalog).context("catalog open failed")?;

    let mut default_table_by_setup: HashMap<u32, u32> = HashMap::new();
    let mut setups_seen = 0usize;
    for entry in content.resource_index().iter().filter(|entry| {
        entry.namespace == EOR_PORTAL_NAMESPACE && entry.type_id == SETUP_MODEL_TYPE
    }) {
        setups_seen += 1;
        let bytes = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))?
            .bytes;
        let setup = SetupModel::read(&mut Cursor::new(bytes))
            .with_context(|| format!("decode setup 0x{:08X}", entry.file_id))?;
        if let Some(table) = setup.default_motion_table {
            default_table_by_setup.insert(setup.id, table);
        }
    }

    let mut templates = 0usize;
    let mut with_own_table = 0usize;
    let mut no_table_no_setup = 0usize;
    let mut fallback_resolves = 0usize;
    let mut fallback_misses = 0usize;
    let mut disagreements = 0usize;
    let mut fallback_setups: HashSet<u32> = HashSet::new();

    let wcids: Vec<u32> = catalog.records().map(|record| record.wcid).collect();
    for wcid in wcids {
        let Some(template) = catalog.lookup(wcid)? else {
            continue;
        };
        templates += 1;

        match (template.motion_table_did, template.setup_did) {
            (Some(own), setup) => {
                with_own_table += 1;
                // A setup default that disagrees with the entity's own property proves the
                // property wins rather than the two being redundant.
                if let Some(setup_default) = setup.and_then(|id| default_table_by_setup.get(&id))
                    && *setup_default != own
                {
                    disagreements += 1;
                }
            }
            (None, Some(setup_id)) => {
                if let Some(table) = default_table_by_setup.get(&setup_id) {
                    fallback_resolves += 1;
                    fallback_setups.insert(setup_id);
                    let _ = table;
                } else {
                    fallback_misses += 1;
                }
            }
            (None, None) => no_table_no_setup += 1,
        }
    }

    println!("setup models in archive:                 {setups_seen}");
    println!(
        "  declaring a default motion table:      {}",
        default_table_by_setup.len()
    );
    println!("catalog templates:                       {templates}");
    println!("  with their own motion-table property:  {with_own_table}");
    println!("    whose setup default disagrees:       {disagreements}");
    println!("  no property, setup default resolves:   {fallback_resolves}");
    println!("  no property, setup declares none:      {fallback_misses}");
    println!("  no property and no setup at all:       {no_table_no_setup}");
    println!(
        "  distinct setups the fallback reaches:  {}",
        fallback_setups.len()
    );

    Ok(())
}
