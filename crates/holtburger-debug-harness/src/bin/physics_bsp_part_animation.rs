//! Does animated physics-BSP collision actually need per-part poses, or only the root?
//!
//! The retail client collides physics-BSP objects per part against poses `CPartArray::UpdateParts`
//! writes from the current animation frame (`acclient.c:313270-313287`, `:303185-303200`,
//! `:314107-314132`). Holtburger places those parts from the setup's static transform instead.
//!
//! The divergence only matters if BSP-carrying setups are multi-part *and* their animations move
//! parts relative to each other. A single-part BSP object's "part pose" is its root pose, which the
//! solver's accepted path already carries, so that population needs no part frames at all.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{Animation, GfxObj, MotionTable, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::collections::{HashMap, HashSet};
use std::io::Cursor;

const GFX_OBJ_TYPE: u32 = 0x01;
const SETUP_MODEL_TYPE: u32 = 0x02;
const ANIMATION_TYPE: u32 = 0x03;
const MOTION_TABLE_TYPE: u32 = 0x09;

#[derive(Parser)]
#[command(about = "Size the animated physics-BSP part population")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;

    let index: Vec<_> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE)
        .cloned()
        .collect();

    let ids_of = |type_id: u32| -> HashSet<u32> {
        index
            .iter()
            .filter(|entry| entry.type_id == type_id)
            .map(|entry| entry.file_id)
            .collect()
    };
    let gfx_obj_ids = ids_of(GFX_OBJ_TYPE);
    let animation_ids = ids_of(ANIMATION_TYPE);

    // Which GfxObjs carry a physics BSP. Decoded once and cached, since setups share parts heavily.
    let mut bsp_by_gfx_obj: HashMap<u32, bool> = HashMap::new();
    let mut has_physics_bsp = |gfx_obj_id: u32| -> Result<bool> {
        if let Some(known) = bsp_by_gfx_obj.get(&gfx_obj_id) {
            return Ok(*known);
        }
        if !gfx_obj_ids.contains(&gfx_obj_id) {
            bsp_by_gfx_obj.insert(gfx_obj_id, false);
            return Ok(false);
        }
        let bytes = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_id))
            .with_context(|| format!("read gfx obj 0x{gfx_obj_id:08X}"))?
            .bytes;
        let gfx_obj = GfxObj::unpack(&mut Cursor::new(&bytes))
            .with_context(|| format!("decode gfx obj 0x{gfx_obj_id:08X}"))?;
        let carries = gfx_obj.physics_bsp.is_some();
        bsp_by_gfx_obj.insert(gfx_obj_id, carries);
        Ok(carries)
    };

    // Animations a motion table can select, so a setup's animation reach can be resolved.
    let mut animations_by_table: HashMap<u32, HashSet<u32>> = HashMap::new();
    for entry in index.iter().filter(|e| e.type_id == MOTION_TABLE_TYPE) {
        let bytes = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))
            .with_context(|| format!("read motion table 0x{:08X}", entry.file_id))?
            .bytes;
        let table = MotionTable::read(&mut Cursor::new(&bytes))
            .with_context(|| format!("decode motion table 0x{:08X}", entry.file_id))?;

        let mut reachable = HashSet::new();
        let linked = table.links.values().flat_map(|links| links.values());
        for motion_data in table
            .cycles
            .values()
            .chain(table.modifiers.values())
            .chain(linked)
        {
            for anim in &motion_data.anims {
                reachable.insert(anim.anim_id);
            }
        }
        animations_by_table.insert(entry.file_id, reachable);
    }

    let mut animation_cache: HashMap<u32, Option<AnimationShape>> = HashMap::new();

    let mut bsp_setups = 0usize;
    let mut single_part_bsp = 0usize;
    let mut multi_part_bsp = 0usize;
    let mut bsp_with_motion_source = 0usize;
    let mut bsp_multi_part_with_motion_source = 0usize;
    let mut bsp_multi_part_with_moving_parts = 0usize;
    let mut part_count_histogram: HashMap<usize, usize> = HashMap::new();
    // The exact divergent population, small enough to enumerate in a retail-divergence census.
    let mut moving_part_setups: Vec<(u32, usize)> = Vec::new();

    for entry in index.iter().filter(|e| e.type_id == SETUP_MODEL_TYPE) {
        let bytes = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))
            .with_context(|| format!("read setup 0x{:08X}", entry.file_id))?
            .bytes;
        let setup = SetupModel::read(&mut Cursor::new(&bytes))
            .with_context(|| format!("decode setup 0x{:08X}", entry.file_id))?;

        let mut carries_bsp = false;
        for part in &setup.parts {
            if has_physics_bsp(*part)? {
                carries_bsp = true;
                break;
            }
        }
        if !carries_bsp {
            continue;
        }

        bsp_setups += 1;
        let part_count = setup.parts.len();
        *part_count_histogram.entry(part_count).or_insert(0) += 1;
        if part_count <= 1 {
            single_part_bsp += 1;
        } else {
            multi_part_bsp += 1;
        }

        // Everything this setup can animate: its default animation plus whatever its default
        // motion table can select.
        let mut reachable: HashSet<u32> = HashSet::new();
        reachable.extend(setup.default_animation);
        if let Some(table_id) = setup.default_motion_table
            && let Some(from_table) = animations_by_table.get(&table_id)
        {
            reachable.extend(from_table.iter().copied());
        }
        if reachable.is_empty() {
            continue;
        }

        bsp_with_motion_source += 1;
        if part_count <= 1 {
            continue;
        }
        bsp_multi_part_with_motion_source += 1;

        // Parts move relative to each other only if some reachable animation carries more than one
        // part track and those tracks differ across frames.
        let mut moves_parts = false;
        for animation_id in reachable {
            if !animation_ids.contains(&animation_id) {
                continue;
            }
            let shape = match animation_cache.get(&animation_id) {
                Some(cached) => *cached,
                None => {
                    let bytes = content
                        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, animation_id))
                        .with_context(|| format!("read animation 0x{animation_id:08X}"))?
                        .bytes;
                    let animation = Animation::read(&mut Cursor::new(&bytes))
                        .with_context(|| format!("decode animation 0x{animation_id:08X}"))?;
                    let shape = Some(AnimationShape::of(&animation));
                    animation_cache.insert(animation_id, shape);
                    shape
                }
            };
            if shape.is_some_and(|shape| shape.moves_parts) {
                moves_parts = true;
                break;
            }
        }
        if moves_parts {
            bsp_multi_part_with_moving_parts += 1;
            moving_part_setups.push((entry.file_id, part_count));
        }
    }

    println!("setups carrying a physics-BSP part: {bsp_setups}");
    println!("  single-part (root-equivalent):    {single_part_bsp}");
    println!("  multi-part:                       {multi_part_bsp}");
    println!("  with any animation source:        {bsp_with_motion_source}");
    println!("  multi-part AND animated:          {bsp_multi_part_with_motion_source}");
    println!("  multi-part AND parts actually move: {bsp_multi_part_with_moving_parts}");

    if !moving_part_setups.is_empty() {
        moving_part_setups.sort_unstable();
        println!("\ndivergent setups (multi-part BSP with moving parts):");
        for (setup_id, part_count) in &moving_part_setups {
            println!("  0x{setup_id:08X}  {part_count} parts");
        }
    }

    let mut counts: Vec<(usize, usize)> = part_count_histogram.into_iter().collect();
    counts.sort_unstable();
    println!("\npart-count distribution for BSP setups:");
    for (part_count, setups) in counts.iter().take(12) {
        println!("  {part_count:>3} parts: {setups}");
    }
    if counts.len() > 12 {
        let tail: usize = counts.iter().skip(12).map(|(_, setups)| setups).sum();
        println!("  (+{} more buckets, {tail} setups)", counts.len() - 12);
    }

    Ok(())
}

/// Whether one animation moves parts relative to each other, which is the only case that needs
/// per-part collision poses rather than a root pose.
#[derive(Clone, Copy)]
struct AnimationShape {
    moves_parts: bool,
}

impl AnimationShape {
    fn of(animation: &Animation) -> Self {
        if animation.num_parts <= 1 || animation.part_frames.len() < 2 {
            return Self { moves_parts: false };
        }
        let first = &animation.part_frames[0].frames;
        let moves_parts = animation
            .part_frames
            .iter()
            .any(|frame| frame.frames != *first);
        Self { moves_parts }
    }
}
