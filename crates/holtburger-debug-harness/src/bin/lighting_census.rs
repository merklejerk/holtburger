//! Phase 0 evidence censuses for the scene lighting plan.
//!
//! Temporary harness (see docs/plans/holtburger-3d-scene-lighting-plan.md Phase 0).
//! Findings belong in the plan; this tool does not need to survive the investigation.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_dat::file_type::region::{LandSurfType, SkyTimeOfDay};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE};

#[derive(Parser)]
#[command(about = "Scene lighting plan Phase 0 censuses")]
struct Args {
    /// Explicit content path; defaults to standard discovery.
    #[arg(long)]
    content: Option<std::path::PathBuf>,
    #[command(subcommand)]
    census: Census,
}

#[derive(Subcommand)]
enum Census {
    /// Per-EnvCell authored static light counts and light property ranges.
    Lights,
    /// Per-EnvCell resident counts and within-cell setup duplication.
    Residents,
    /// Zero/degenerate authored vertex normals across all GfxObjs.
    Normals,
    /// Region SkyDesc dump: day groups, interpolated samples, terrain variation bounds.
    Sky,
}

fn main() -> Result<()> {
    env_logger::init();
    let args = Args::parse();
    let content = ContentRepository::discover(args.content)
        .context("content discovery failed; pass --content")?;
    println!(
        "content source: {}",
        content.source_description().unwrap_or("<unknown>")
    );
    let cache = ContentDecodeCache::new();
    match args.census {
        Census::Lights => census_lights(&content, &cache),
        Census::Residents => census_residents(&content, &cache),
        Census::Normals => census_normals(&content, &cache),
        Census::Sky => census_sky(&content, &cache),
    }
}

/// All EnvCell ids in the cell namespace (0x0100..=0xFFFD within each landblock).
fn env_cell_ids(content: &ContentRepository) -> Vec<u32> {
    let mut ids: Vec<u32> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_CELL_NAMESPACE)
        .map(|entry| entry.file_id)
        .filter(|id| {
            let cell = id & 0xffff;
            (0x0100..0xfffe).contains(&cell)
        })
        .collect();
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn is_setup_id(stab_id: u32) -> bool {
    stab_id >> 24 == 0x02
}

fn census_lights(content: &ContentRepository, cache: &ContentDecodeCache) -> Result<()> {
    let cell_ids = env_cell_ids(content);
    println!("env cells: {}", cell_ids.len());

    // Light count per cell, and property ranges over every light instance placed in any cell.
    let mut per_cell_counts = Vec::with_capacity(cell_ids.len());
    let mut cells_failed = 0usize;
    let mut setups_with_lights: BTreeMap<u32, usize> = BTreeMap::new();
    let mut intensity = RangeStat::default();
    let mut falloff = RangeStat::default();
    let mut cone_angle = RangeStat::default();
    let mut color_counts: BTreeMap<u32, usize> = BTreeMap::new();
    let mut light_instances = 0usize;
    let mut key_counts: BTreeMap<i32, usize> = BTreeMap::new();

    for &cell_id in &cell_ids {
        let cell = match cache.env_cell(content, cell_id) {
            Ok(cell) => cell,
            Err(_) => {
                cells_failed += 1;
                continue;
            }
        };
        let mut count = 0usize;
        for stab in &cell.static_objects {
            if !is_setup_id(stab.stab_id) {
                continue;
            }
            let Ok(setup) = cache.setup_model(content, stab.stab_id) else {
                continue;
            };
            if setup.lights.is_empty() {
                continue;
            }
            count += setup.lights.len();
            *setups_with_lights.entry(stab.stab_id).or_default() += 1;
            for light in &setup.lights {
                *key_counts.entry(light.light_type).or_default() += 1;
                light_instances += 1;
                intensity.add(light.intensity);
                falloff.add(light.falloff);
                cone_angle.add(light.cone_angle);
                *color_counts.entry(light.color).or_default() += 1;
            }
        }
        per_cell_counts.push(count);
    }

    per_cell_counts.sort_unstable();
    let lit_cells = per_cell_counts.iter().filter(|&&c| c > 0).count();
    println!(
        "cells decoded: {} (failed: {cells_failed})",
        per_cell_counts.len()
    );
    println!("cells with >=1 authored light: {lit_cells}");
    println!("light instances placed in cells: {light_instances}");
    println!(
        "distinct light-bearing setups: {}",
        setups_with_lights.len()
    );
    if let (Some(&max), Some(p99), Some(p50)) = (
        per_cell_counts.last(),
        percentile(&per_cell_counts, 0.99),
        percentile(&per_cell_counts, 0.50),
    ) {
        println!("lights per cell: max={max} p99={p99} p50={p50}");
    }
    let lit_counts: Vec<usize> = per_cell_counts.iter().copied().filter(|&c| c > 0).collect();
    if let (Some(&max), Some(p99), Some(p50)) = (
        lit_counts.last(),
        percentile(&lit_counts, 0.99),
        percentile(&lit_counts, 0.50),
    ) {
        println!("lights per LIT cell: max={max} p99={p99} p50={p50}");
    }
    let mut histogram: BTreeMap<usize, usize> = BTreeMap::new();
    for &count in &lit_counts {
        *histogram.entry(count).or_default() += 1;
    }
    println!("lit-cell histogram (lights -> cells): {histogram:?}");
    println!("intensity: {intensity}");
    println!("falloff: {falloff}");
    println!("cone_angle: {cone_angle}");
    println!("distinct colors: {}", color_counts.len());
    let mut colors: Vec<(u32, usize)> = color_counts.into_iter().collect();
    colors.sort_by_key(|&(_, count)| std::cmp::Reverse(count));
    for (color, count) in colors.iter().take(10) {
        println!("  color 0x{color:08X} x{count}");
    }
    println!("light_type values (0=point 1=distant 2=spot): {key_counts:?}");
    Ok(())
}

fn census_residents(content: &ContentRepository, cache: &ContentDecodeCache) -> Result<()> {
    let cell_ids = env_cell_ids(content);
    let mut per_cell_residents = Vec::new();
    let mut setup_stabs = 0usize;
    let mut gfx_stabs = 0usize;
    let mut other_stabs = 0usize;
    let mut cells_with_duplicates = 0usize;
    let mut duplicate_instances = 0usize;

    for &cell_id in &cell_ids {
        let Ok(cell) = cache.env_cell(content, cell_id) else {
            continue;
        };
        let mut within: BTreeMap<u32, usize> = BTreeMap::new();
        for stab in &cell.static_objects {
            match stab.stab_id >> 24 {
                0x02 => setup_stabs += 1,
                0x01 => gfx_stabs += 1,
                _ => other_stabs += 1,
            }
            *within.entry(stab.stab_id).or_default() += 1;
        }
        per_cell_residents.push(cell.static_objects.len());
        let dupes: usize = within.values().filter(|&&n| n > 1).map(|&n| n - 1).sum();
        if dupes > 0 {
            cells_with_duplicates += 1;
            duplicate_instances += dupes;
        }
    }

    per_cell_residents.sort_unstable();
    println!("cells decoded: {}", per_cell_residents.len());
    println!("stab kinds: setup={setup_stabs} gfx={gfx_stabs} other={other_stabs}");
    if let (Some(&max), Some(p99), Some(p50)) = (
        per_cell_residents.last(),
        percentile(&per_cell_residents, 0.99),
        percentile(&per_cell_residents, 0.50),
    ) {
        println!("residents per cell: max={max} p99={p99} p50={p50}");
    }
    println!(
        "within-cell duplicated stab ids: {duplicate_instances} extra instances across \
         {cells_with_duplicates} cells"
    );
    println!(
        "note: stab placements are rigid frames (origin + quaternion, env_cell.rs Stab); \
         instance eligibility depends only on setup part transforms"
    );

    // Shell geometry is shared per (environment, cell-struct) across cells, so this ratio is
    // the memory multiplier a per-cell vertex-color bake would cost.
    let mut structure_uses: BTreeMap<(u16, u16), usize> = BTreeMap::new();
    for &cell_id in &cell_ids {
        let Ok(cell) = cache.env_cell(content, cell_id) else {
            continue;
        };
        *structure_uses
            .entry((cell.environment_id, cell.cell_structure))
            .or_default() += 1;
    }
    let total_uses: usize = structure_uses.values().sum();
    let mut reuse: Vec<usize> = structure_uses.values().copied().collect();
    reuse.sort_unstable();
    println!(
        "distinct shell structures: {} across {total_uses} cells (mean reuse {:.1}x, max {})",
        structure_uses.len(),
        total_uses as f64 / structure_uses.len().max(1) as f64,
        reuse.last().copied().unwrap_or(0)
    );
    Ok(())
}

fn census_normals(content: &ContentRepository, cache: &ContentDecodeCache) -> Result<()> {
    let mut gfx_ids: Vec<u32> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE && entry.file_id >> 24 == 0x01)
        .map(|entry| entry.file_id)
        .collect();
    gfx_ids.sort_unstable();
    gfx_ids.dedup();
    println!("gfx objects in archive: {}", gfx_ids.len());

    let mut objects_decoded = 0usize;
    let mut objects_failed = 0usize;
    let mut total_vertices = 0usize;
    let mut zero_normal_vertices = 0usize;
    let mut non_unit_vertices = 0usize;
    let mut objects_with_zero: Vec<u32> = Vec::new();

    for &gfx_id in &gfx_ids {
        let obj = match cache.gfx_obj(content, gfx_id) {
            Ok(obj) => obj,
            Err(_) => {
                objects_failed += 1;
                continue;
            }
        };
        objects_decoded += 1;
        let mut zero_here = 0usize;
        for vertex in obj.vertex_array.vertices.values() {
            total_vertices += 1;
            let n = &vertex.normal;
            let len_sq = n.x * n.x + n.y * n.y + n.z * n.z;
            if len_sq < 1e-6 {
                zero_here += 1;
            } else if (len_sq.sqrt() - 1.0).abs() > 0.01 {
                non_unit_vertices += 1;
            }
        }
        if zero_here > 0 {
            zero_normal_vertices += zero_here;
            objects_with_zero.push(gfx_id);
        }
    }

    println!("decoded: {objects_decoded} (failed: {objects_failed})");
    println!("vertices: {total_vertices}");
    println!(
        "zero normals: {zero_normal_vertices} vertices across {} objects",
        objects_with_zero.len()
    );
    println!("non-unit (>1% off) normals: {non_unit_vertices}");
    for gfx_id in objects_with_zero.iter().take(20) {
        println!("  zero-normal object: 0x{gfx_id:08X}");
    }
    Ok(())
}

fn census_sky(content: &ContentRepository, cache: &ContentDecodeCache) -> Result<()> {
    let region = cache.region_desc(content)?;
    println!("region: {} (0x{:08X})", region.region_name, region.id);

    let Some(sky) = &region.sky_info else {
        println!("no sky_info present");
        return Ok(());
    };
    println!(
        "tick_size={} light_tick_size={} day_groups={}",
        sky.tick_size,
        sky.light_tick_size,
        sky.day_groups.len()
    );
    for (group_index, group) in sky.day_groups.iter().enumerate() {
        println!(
            "\nday group {group_index}: '{}' chance={} sky_objects={} sky_times={}",
            group.day_name,
            group.chance_of_occur,
            group.sky_objects.len(),
            group.sky_times.len()
        );
        for time in &group.sky_times {
            println!(
                "  begin={:.4} dir(bright={:.3} heading={:.1} pitch={:.1} color=0x{:08X}) \
                 amb(bright={:.3} color=0x{:08X}) fog(on={} min={:.4} max={:.4} color=0x{:08X}) \
                 replacements={}",
                time.begin,
                time.dir_bright,
                time.dir_heading,
                time.dir_pitch,
                time.dir_color,
                time.amb_bright,
                time.amb_color,
                time.world_fog,
                time.min_world_fog,
                time.max_world_fog,
                time.world_fog_color,
                time.sky_object_replacements.len()
            );
        }
        for fraction in [0.0f32, 0.25, 0.5, 0.75] {
            if let Some(sample) = interpolate_lighting(&group.sky_times, fraction) {
                println!("  t={fraction:.2} -> {sample}");
            }
        }
    }

    if let Some(terrain) = &region.terrain_info {
        let LandSurfType::TextureMerge(merge) = &terrain.land_surfaces.surface_type else {
            println!("\nterrain surface type is PaletteShift; no variation bounds");
            return Ok(());
        };
        println!("\nterrain vertex variation bounds (per terrain desc):");
        for desc in &merge.terrain_desc {
            let tex = &desc.terrain_tex;
            println!(
                "  terrain_type={} bright=[{}..{}] saturate=[{}..{}] hue=[{}..{}]",
                desc.terrain_type,
                tex.min_vert_bright,
                tex.max_vert_bright,
                tex.min_vert_saturate,
                tex.max_vert_saturate,
                tex.min_vert_hue,
                tex.max_vert_hue
            );
        }
    }
    Ok(())
}

/// Retail `SkyDesc::GetLighting` bracket interpolation, reproduced for data validation only.
fn interpolate_lighting(times: &[SkyTimeOfDay], fraction: f32) -> Option<String> {
    if times.is_empty() {
        return None;
    }
    let before_index = times
        .iter()
        .rposition(|time| time.begin <= fraction)
        .unwrap_or(times.len() - 1);
    let after_index = (before_index + 1) % times.len();
    let before = &times[before_index];
    let after = &times[after_index];
    let span = if after_index == 0 {
        1.0 - before.begin
    } else {
        after.begin - before.begin
    };
    let ratio = if span > 0.0 {
        ((fraction - before.begin) / span).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let lerp = |a: f32, b: f32| a + (b - a) * ratio;
    let ambient = lerp(before.amb_bright, after.amb_bright);
    let bright = lerp(before.dir_bright, after.dir_bright);
    let heading = lerp(before.dir_heading, after.dir_heading).to_radians();
    let pitch = lerp(before.dir_pitch, after.dir_pitch).to_radians();
    let sun = [
        heading.sin() * pitch.cos() * bright,
        heading.cos() * pitch.cos() * bright,
        pitch.sin() * bright,
    ];
    Some(format!(
        "ambient={ambient:.3} sun=({:.3}, {:.3}, {:.3}) |sun|={bright:.3}",
        sun[0], sun[1], sun[2]
    ))
}

#[derive(Default)]
struct RangeStat {
    count: usize,
    min: f32,
    max: f32,
    sum: f64,
}

impl RangeStat {
    fn add(&mut self, value: f32) {
        if self.count == 0 {
            self.min = value;
            self.max = value;
        } else {
            self.min = self.min.min(value);
            self.max = self.max.max(value);
        }
        self.count += 1;
        self.sum += f64::from(value);
    }
}

impl std::fmt::Display for RangeStat {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.count == 0 {
            return write!(formatter, "n=0");
        }
        write!(
            formatter,
            "n={} min={:.4} max={:.4} mean={:.4}",
            self.count,
            self.min,
            self.max,
            self.sum / self.count as f64
        )
    }
}

fn percentile(sorted: &[usize], fraction: f64) -> Option<usize> {
    if sorted.is_empty() {
        return None;
    }
    let index = ((sorted.len() as f64 - 1.0) * fraction).round() as usize;
    sorted.get(index).copied()
}
