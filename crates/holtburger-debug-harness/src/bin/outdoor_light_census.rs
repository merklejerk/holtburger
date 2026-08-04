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

    // A bare zero is only trustworthy if the ids being checked are the kind that can carry
    // lights at all. Break every reference down by DAT family: 0x01 GfxObj cannot hold lights
    // by construction, 0x02 Setup can.
    let family = |label: &str, ids: &[u32]| {
        let mut counts: BTreeMap<u32, usize> = BTreeMap::new();
        for id in ids {
            *counts.entry(id >> 24).or_default() += 1;
        }
        println!("  {label} id families: {counts:?}");
    };
    let mut object_ids = Vec::new();
    let mut building_ids = Vec::new();
    for &id in &landblock_ids {
        let Ok(info) = cache.landblock_info(&content, id) else {
            continue;
        };
        object_ids.extend(info.objects.iter().map(|stab| stab.id));
        building_ids.extend(info.buildings.iter().map(|building| building.model_id));
    }
    let mut template_ids = Vec::new();
    for &scene_id in &scene_ids {
        if let Ok(scene) = cache.scene(&content, scene_id) {
            template_ids.extend(
                scene
                    .object_templates
                    .iter()
                    .map(|template| template.object_id),
            );
        }
    }
    println!("reference breakdown (0x01 = GfxObj, 0x02 = Setup):");
    family("explicit objects", &object_ids);
    family("buildings", &building_ids);
    family("scenery templates", &template_ids);

    // Which setups actually carry lights, and are any of them referenced outdoors at all?
    let mut lit_setups_outdoors: BTreeMap<u32, usize> = BTreeMap::new();
    for id in object_ids.iter().chain(&building_ids).chain(&template_ids) {
        if light_count(*id) > 0 {
            *lit_setups_outdoors.entry(*id).or_default() += 1;
        }
    }
    println!(
        "distinct light-bearing setups referenced outdoors: {}",
        lit_setups_outdoors.len()
    );
    let mut ranked: Vec<_> = lit_setups_outdoors.into_iter().collect();
    ranked.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    for (setup, count) in ranked.iter().take(8) {
        let lights = light_count(*setup);
        println!("  setup 0x{setup:08X} placed {count}x, {lights} light(s) each");
    }
    // What will these actually look like? The hardware path is diffuse = color * intensity with
    // 1/d attenuation and no per-channel clamp, so the authored intensity scale decides whether an
    // outdoor lamp reads as a gentle pool or a saturated blob.
    let mut intensities: Vec<f32> = Vec::new();
    let mut falloffs: Vec<f32> = Vec::new();
    let mut colors: BTreeMap<u32, usize> = BTreeMap::new();
    for id in object_ids.iter().chain(&building_ids).chain(&template_ids) {
        if !is_setup(*id) {
            continue;
        }
        let Ok(setup) = cache.setup_model(&content, *id) else {
            continue;
        };
        for light in &setup.lights {
            intensities.push(light.intensity);
            falloffs.push(light.falloff);
            *colors.entry(light.color).or_default() += 1;
        }
    }
    intensities.sort_by(|a, b| a.partial_cmp(b).unwrap());
    falloffs.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let pick = |v: &[f32], f: f64| -> f32 {
        if v.is_empty() {
            return 0.0;
        }
        v[(((v.len() - 1) as f64) * f).round() as usize]
    };
    println!(
        "outdoor intensity: n={} min={:.1} p50={:.1} p90={:.1} max={:.1}",
        intensities.len(),
        pick(&intensities, 0.0),
        pick(&intensities, 0.5),
        pick(&intensities, 0.9),
        pick(&intensities, 1.0)
    );
    println!(
        "outdoor falloff: min={:.1} p50={:.1} p90={:.1} max={:.1} (reach = falloff * 1.5)",
        pick(&falloffs, 0.0),
        pick(&falloffs, 0.5),
        pick(&falloffs, 0.9),
        pick(&falloffs, 1.0)
    );
    let mut ranked_colors: Vec<_> = colors.into_iter().collect();
    ranked_colors.sort_by_key(|&(_, n)| std::cmp::Reverse(n));
    for (color, n) in ranked_colors.iter().take(5) {
        println!("  outdoor color 0x{color:08X} x{n}");
    }
    // Exact placements in one landblock, to aim a camera at a real lamp.
    if let Ok(target) = std::env::var("CENSUS_LANDBLOCK") {
        let requested = u32::from_str_radix(target.trim_start_matches("0x"), 16)?;
        // LandblockInfo records live at 0xXXXXFFFE, not the 0xXXXXFFFF cell id.
        let landblock = (requested & 0xffff_0000) | 0xfffe;
        let info = cache.landblock_info(&content, landblock)?;
        let coords = ((landblock >> 24) & 0xff, (landblock >> 16) & 0xff);
        let origin_x = coords.0 as f32 * 192.0;
        let origin_z = -(coords.1 as f32) * 192.0;
        println!(
            "\nlandblock 0x{landblock:08X} world origin x={origin_x} z={origin_z}"
        );
        for stab in &info.objects {
            if !is_setup(stab.id) {
                continue;
            }
            let Ok(setup) = cache.setup_model(&content, stab.id) else {
                continue;
            };
            for light in &setup.lights {
                // AC authors Z-up; render space is Y-up with -Z north.
                let o = stab.frame.origin;
                let l = light.viewer_space_location.origin;
                println!(
                    "  lamp 0x{:08X} world=({:.1}, {:.1}, {:.1}) offset=({:.1}, {:.1}, {:.1}) \
                     falloff={:.1} reach={:.1}",
                    stab.id,
                    origin_x + o.x + l.x,
                    o.z + l.z,
                    origin_z - o.y - l.y,
                    l.x,
                    l.z,
                    -l.y,
                    light.falloff,
                    light.falloff * 1.5
                );
            }
        }
    }
    Ok(())
}
