//! Does outdoor content author static lights, and where?
//!
//! Temporary harness for the outdoor-lighting design decision. Delete once the finding is
//! recorded in the plan it informs.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE};

#[derive(Parser)]
#[command(about = "Census authored lights on outdoor statics, buildings, and scenery")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn is_setup(id: u32) -> bool {
    id >> 24 == 0x02
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let cache = ContentDecodeCache::new();

    // How many lights does one placed source contribute?
    let light_count = |did: u32| -> usize {
        if !is_setup(did) {
            return 0;
        }
        cache
            .setup_model(&content, did)
            .map(|setup| setup.lights.len())
            .unwrap_or(0)
    };

    let mut landblock_ids: Vec<u32> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_CELL_NAMESPACE)
        .map(|entry| entry.file_id)
        .filter(|id| id & 0xffff == 0xfffe)
        .collect();
    landblock_ids.sort_unstable();
    landblock_ids.dedup();
    println!("landblocks with info records: {}", landblock_ids.len());

    let mut object_placements = 0usize;
    let mut object_lights = 0usize;
    let mut building_placements = 0usize;
    let mut building_lights = 0usize;
    let mut lit_landblocks: BTreeMap<u32, usize> = BTreeMap::new();

    for &id in &landblock_ids {
        let Ok(info) = cache.landblock_info(&content, id) else {
            continue;
        };
        let mut here = 0usize;
        for stab in &info.objects {
            object_placements += 1;
            let count = light_count(stab.id);
            object_lights += count;
            here += count;
        }
        for building in &info.buildings {
            building_placements += 1;
            let count = light_count(building.model_id);
            building_lights += count;
            here += count;
        }
        if here > 0 {
            lit_landblocks.insert(id >> 16, here);
        }
    }

    println!("explicit outdoor objects: {object_placements} placements, {object_lights} lights");
    println!("buildings: {building_placements} placements, {building_lights} lights");
    println!(
        "landblocks with any outdoor light: {} of {}",
        lit_landblocks.len(),
        landblock_ids.len()
    );
    let mut ranked: Vec<_> = lit_landblocks.iter().collect();
    ranked.sort_by_key(|(_, count)| std::cmp::Reverse(**count));
    for (landblock, count) in ranked.iter().take(6) {
        println!("  0x{landblock:04X}FFFF outdoor lights={count}");
    }

    // Generated scenery: templates are shared, so count light-bearing templates per scene.
    let mut scene_ids: Vec<u32> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE && entry.file_id >> 24 == 0x12)
        .map(|entry| entry.file_id)
        .collect();
    scene_ids.sort_unstable();
    scene_ids.dedup();
    let mut templates = 0usize;
    let mut lit_templates = 0usize;
    let mut scenes_with_lights = 0usize;
    for &scene_id in &scene_ids {
        let Ok(scene) = cache.scene(&content, scene_id) else {
            continue;
        };
        let mut any = false;
        for template in &scene.object_templates {
            templates += 1;
            if light_count(template.object_id) > 0 {
                lit_templates += 1;
                any = true;
            }
        }
        if any {
            scenes_with_lights += 1;
        }
    }
    println!(
        "generated scenery: {} scenes, {templates} templates, {lit_templates} light-bearing \
         templates across {scenes_with_lights} scenes",
        scene_ids.len()
    );
    Ok(())
}
