//! Field-shape census for the `MotionSequence` contract.
//!
//! Answers the questions that decide type shapes rather than sizes: which hook directions real
//! content authors, whether clip windows stay inside their animation's frame count, how often
//! framerates are negative, and whether `low_frame`/`high_frame` are ever out of order.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::setup_model::AnimationHookPayload;
use holtburger_dat::file_type::{Animation, MotionTable, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::io::Cursor;

const SETUP_MODEL_TYPE: u32 = 0x02;
const ANIMATION_TYPE: u32 = 0x03;
const MOTION_TABLE_TYPE: u32 = 0x09;
const SIMULATION_HOOK_TYPES: [u32; 3] = [3, 5, 6];

#[derive(Parser)]
#[command(about = "Census the field shapes the MotionSequence contract must model")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

/// Which signed local axis a vector mostly points along.
fn dominant_axis(vector: holtburger_common::Vector3) -> &'static str {
    let (x, y, z) = (vector.x.abs(), vector.y.abs(), vector.z.abs());
    if x >= y && x >= z {
        if vector.x >= 0.0 { "+X" } else { "-X" }
    } else if y >= z {
        if vector.y >= 0.0 { "+Y" } else { "-Y" }
    } else if vector.z >= 0.0 {
        "+Z"
    } else {
        "-Z"
    }
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
    let ids_of = |type_id: u32| -> Vec<u32> {
        index
            .iter()
            .filter(|entry| entry.type_id == type_id)
            .map(|entry| entry.file_id)
            .collect()
    };
    let read = |file_id: u32| -> Result<Vec<u8>> {
        Ok(content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, file_id))?
            .bytes)
    };

    // Every animation a motion table can select, with the clip windows that select it.
    let mut clip_windows: HashMap<u32, Vec<(i32, i32, f32)>> = HashMap::new();
    let mut tables_by_animation: BTreeMap<u32, BTreeSet<u32>> = BTreeMap::new();
    let mut records = 0usize;
    let mut records_with_velocity = 0usize;
    let mut records_with_omega = 0usize;
    let mut empty_records = 0usize;
    let mut multi_clip_records = 0usize;
    let mut max_clips = 0usize;
    let mut bitfields: BTreeMap<u8, usize> = BTreeMap::new();
    // Which local axis explicit motion-data velocity points along, and which axis authored root
    // translation points along. Both are expressed in the object's own frame, so they must agree or
    // one of them is being interpreted with the wrong convention.
    let mut velocity_dominant_axis: BTreeMap<&'static str, usize> = BTreeMap::new();
    let mut translation_dominant_axis: BTreeMap<&'static str, usize> = BTreeMap::new();
    // Turn and sidestep commands carry both the substate and modifier class bits, and retail tries
    // the substate branch first. Which map really holds them decides how they compose with walking.
    let mut cycle_modifier_class = 0usize;
    let mut cycle_turn_keys = 0usize;
    let mut modifier_turn_keys = 0usize;
    let mut tables_turn_in_cycles = 0usize;
    let mut tables_turn_in_modifiers = 0usize;
    const TURN_ORDINALS: [u32; 4] = [0x0D, 0x0E, 0x0F, 0x10];

    let motion_table_ids = ids_of(MOTION_TABLE_TYPE);
    for id in &motion_table_ids {
        let table = MotionTable::read(&mut Cursor::new(read(*id)?))
            .with_context(|| format!("decode motion table 0x{id:08X}"))?;
        let turn_in_cycles = table
            .cycles
            .keys()
            .any(|key| TURN_ORDINALS.contains(&(key & 0xFFFF)));
        let turn_in_modifiers = table
            .modifiers
            .keys()
            .any(|key| TURN_ORDINALS.contains(&(key & 0xFFFF)));
        if turn_in_cycles {
            tables_turn_in_cycles += 1;
        }
        if turn_in_modifiers {
            tables_turn_in_modifiers += 1;
        }
        for key in table.cycles.keys() {
            if TURN_ORDINALS.contains(&(key & 0xFFFF)) {
                cycle_turn_keys += 1;
            }
        }
        for key in table.modifiers.keys() {
            if TURN_ORDINALS.contains(&(key & 0xFFFF)) {
                modifier_turn_keys += 1;
            }
        }
        cycle_modifier_class += table.cycles.len();

        let linked = table.links.values().flat_map(|links| links.values());
        for motion_data in table
            .cycles
            .values()
            .chain(table.modifiers.values())
            .chain(linked)
        {
            records += 1;
            *bitfields.entry(motion_data.bitfield).or_insert(0) += 1;
            if let Some(velocity) = motion_data.velocity {
                records_with_velocity += 1;
                *velocity_dominant_axis
                    .entry(dominant_axis(velocity))
                    .or_insert(0) += 1;
            }
            if motion_data.omega.is_some() {
                records_with_omega += 1;
            }
            if motion_data.anims.is_empty() {
                empty_records += 1;
            }
            if motion_data.anims.len() > 1 {
                multi_clip_records += 1;
            }
            max_clips = max_clips.max(motion_data.anims.len());
            for anim in &motion_data.anims {
                tables_by_animation
                    .entry(anim.anim_id)
                    .or_default()
                    .insert(*id);
                clip_windows.entry(anim.anim_id).or_default().push((
                    anim.low_frame,
                    anim.high_frame,
                    anim.framerate,
                ));
            }
        }
    }

    // Setup defaults: the fallback motion table an object installs when it declares none itself.
    let mut setups_with_default_table = 0usize;
    let mut setups_with_default_animation = 0usize;
    for id in ids_of(SETUP_MODEL_TYPE) {
        let setup = SetupModel::read(&mut Cursor::new(read(id)?))
            .with_context(|| format!("decode setup 0x{id:08X}"))?;
        if setup.default_motion_table.is_some() {
            setups_with_default_table += 1;
        }
        if setup.default_animation.is_some() {
            setups_with_default_animation += 1;
        }
    }

    let animation_ids: HashSet<u32> = ids_of(ANIMATION_TYPE).into_iter().collect();
    let mut hook_directions: BTreeMap<(u32, i32), usize> = BTreeMap::new();
    let mut missing_animations = 0usize;
    let mut window_low_negative = 0usize;
    let mut window_high_past_end = 0usize;
    let mut window_reversed = 0usize;
    let mut negative_framerate = 0usize;
    let mut zero_framerate = 0usize;
    let mut pos_frame_count_mismatch = 0usize;
    let mut animations_without_pos_frames = 0usize;
    let mut attack_part_indices: BTreeMap<i32, usize> = BTreeMap::new();
    let mut replaced_gfx_objs: BTreeMap<u32, usize> = BTreeMap::new();
    let mut ethereal_values: BTreeMap<bool, usize> = BTreeMap::new();
    // Carrier identity keeps the collision-hook implementation scoped to content that motion
    // tables can actually select, instead of every orphaned animation present in the archive.
    let mut ethereal_carriers: BTreeMap<u32, BTreeMap<(i32, bool), usize>> = BTreeMap::new();
    // Whether the solver's velocity-and-heading actuation can express authored root motion at all
    // depends on these: a vertical translation is not planar drive, and a tilting rotation is not a
    // heading.
    let mut translating_animations = 0usize;
    let mut vertical_translation_animations = 0usize;
    let mut max_vertical_step = 0.0f32;
    let mut rotating_animations = 0usize;
    let mut yaw_only_rotation_animations = 0usize;
    let mut tilting_rotation_animations = 0usize;
    let mut max_tilt_component = 0.0f32;
    const SHAPE_EPSILON: f32 = 1e-5;

    let mut referenced: Vec<u32> = clip_windows.keys().copied().collect();
    referenced.sort_unstable();
    for animation_id in referenced {
        if !animation_ids.contains(&animation_id) {
            missing_animations += 1;
            continue;
        }
        let animation = Animation::read(&mut Cursor::new(read(animation_id)?))
            .with_context(|| format!("decode animation 0x{animation_id:08X}"))?;

        if animation.pos_frames.is_empty() {
            animations_without_pos_frames += 1;
        } else if animation.pos_frames.len() != animation.num_frames as usize {
            pos_frame_count_mismatch += 1;
        }

        if let Some(frame) = animation
            .pos_frames
            .iter()
            .max_by(|a, b| a.origin.length().total_cmp(&b.origin.length()))
            && frame.origin.length() > 1e-5
        {
            *translation_dominant_axis
                .entry(dominant_axis(frame.origin))
                .or_insert(0) += 1;
        }

        let mut translates = false;
        let mut vertical = false;
        let mut rotates = false;
        let mut tilts = false;
        for frame in &animation.pos_frames {
            if frame.origin.length() > SHAPE_EPSILON {
                translates = true;
            }
            if frame.origin.z.abs() > SHAPE_EPSILON {
                vertical = true;
                max_vertical_step = max_vertical_step.max(frame.origin.z.abs());
            }
            // A yaw-only rotation stores its axis purely in Z, so any X or Y term is a tilt.
            let tilt = frame.orientation.x.abs().max(frame.orientation.y.abs());
            if (frame.orientation.w.abs() - 1.0).abs() > SHAPE_EPSILON {
                rotates = true;
            }
            if tilt > SHAPE_EPSILON {
                tilts = true;
                max_tilt_component = max_tilt_component.max(tilt);
            }
        }
        if translates {
            translating_animations += 1;
        }
        if vertical {
            vertical_translation_animations += 1;
        }
        if rotates {
            rotating_animations += 1;
            if tilts {
                tilting_rotation_animations += 1;
            } else {
                yaw_only_rotation_animations += 1;
            }
        }

        for (index, part_frame) in animation.part_frames.iter().enumerate() {
            for hook in &part_frame.hooks {
                if !SIMULATION_HOOK_TYPES.contains(&hook.hook_type) {
                    continue;
                }
                *hook_directions
                    .entry((hook.hook_type, hook.direction))
                    .or_insert(0) += 1;
                let _ = index;
                match (&hook.payload, hook.hook_type) {
                    (AnimationHookPayload::Attack(cone), _) => {
                        *attack_part_indices.entry(cone.part_index).or_insert(0) += 1;
                    }
                    (AnimationHookPayload::ReplaceObject(payload), _) => {
                        *replaced_gfx_objs.entry(payload.gfx_obj_id).or_insert(0) += 1;
                    }
                    (AnimationHookPayload::Ethereal(payload), _) => {
                        *ethereal_values.entry(payload.ethereal).or_insert(0) += 1;
                        *ethereal_carriers
                            .entry(animation_id)
                            .or_default()
                            .entry((hook.direction, payload.ethereal))
                            .or_insert(0) += 1;
                    }
                    _ => {}
                }
            }
        }

        for (low, high, framerate) in &clip_windows[&animation_id] {
            if *low < 0 {
                window_low_negative += 1;
            }
            if *high >= animation.num_frames as i32 {
                window_high_past_end += 1;
            }
            if high < low {
                window_reversed += 1;
            }
            if *framerate < 0.0 {
                negative_framerate += 1;
            }
            if *framerate == 0.0 {
                zero_framerate += 1;
            }
        }
    }

    println!("motion tables:                 {}", motion_table_ids.len());
    println!("motion-data records:           {records}");
    println!("  with explicit velocity:      {records_with_velocity}");
    println!("  with explicit omega:         {records_with_omega}");
    println!("  with no clips at all:        {empty_records}");
    println!("  with more than one clip:     {multi_clip_records} (max {max_clips})");
    println!("  bitfield values:             {bitfields:?}");
    println!("setups declaring a motion table: {setups_with_default_table}");
    println!("setups declaring an animation:   {setups_with_default_animation}");
    println!();
    println!("distinct referenced animations: {}", clip_windows.len());
    println!("  absent from the archive:      {missing_animations}");
    println!("  authoring no root track:      {animations_without_pos_frames}");
    println!("  pos_frames != num_frames:     {pos_frame_count_mismatch}");
    println!();
    println!("clip windows:");
    println!("  low_frame < 0:                {window_low_negative}");
    println!("  high_frame >= num_frames:     {window_high_past_end}");
    println!("  high_frame < low_frame:       {window_reversed}");
    println!("  framerate < 0:                {negative_framerate}");
    println!("  framerate == 0:               {zero_framerate}");
    println!();
    println!("command classes by map:");
    println!("  cycle keys whose command has the modifier bit:    {cycle_modifier_class}");
    println!("  cycle keys for turn/sidestep commands:            {cycle_turn_keys}");
    println!("  modifier keys for turn/sidestep commands:         {modifier_turn_keys}");
    println!("  tables defining turn-right in cycles:             {tables_turn_in_cycles}");
    println!("  tables defining turn-right in modifiers:          {tables_turn_in_modifiers}");
    println!();
    println!("local-frame axis conventions:");
    println!("  explicit motion-data velocity: {velocity_dominant_axis:?}");
    println!("  authored root translation:     {translation_dominant_axis:?}");
    println!();
    println!("root-motion shape across referenced animations:");
    println!("  with any root translation:     {translating_animations}");
    println!("  whose translation has Z:       {vertical_translation_animations}");
    println!("    max |Z| per frame:           {max_vertical_step:.6} m");
    println!("  with any root rotation:        {rotating_animations}");
    println!("  whose rotation is yaw only:    {yaw_only_rotation_animations}");
    println!("  whose rotation tilts:          {tilting_rotation_animations}");
    println!("    max tilt axis component:     {max_tilt_component:.6}");
    println!();
    println!("simulation hook (type, direction) counts: {hook_directions:?}");
    println!("attack cone part indices:      {attack_part_indices:?}");
    println!("replaced gfx objs:             {replaced_gfx_objs:?}");
    println!("ethereal payload values:       {ethereal_values:?}");
    println!("ethereal carrier animations:");
    for (animation_id, hooks) in ethereal_carriers {
        let motion_tables = tables_by_animation[&animation_id]
            .iter()
            .map(|table_id| format!("0x{table_id:08X}"))
            .collect::<Vec<_>>()
            .join(", ");
        println!("  0x{animation_id:08X}: hooks={hooks:?}, motion_tables=[{motion_tables}]");
    }

    Ok(())
}
