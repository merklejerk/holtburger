//! What would small archive profiles pay to carry raw motion content instead of a derived asset?
//!
//! Motion resolution needs animation position frames and frame counts; it never reads the part
//! frames and hooks that dominate a raw animation record. This sizes the difference so the
//! authored-root-motion cutover can decide between filtered raw records and a derived reduction.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::setup_model::{
    AnimationHook, AnimationHookPayload, ReplaceObjectHookPayload,
};
use holtburger_dat::file_type::{Animation, MotionTable};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use std::collections::{HashMap, HashSet};
use std::io::Cursor;

const ANIMATION_TYPE: u32 = 0x03;
const MOTION_TABLE_TYPE: u32 = 0x09;

/// Bytes of a `Frame` on the wire: position (3 f32) plus quaternion (4 f32).
const FRAME_BYTES: u64 = 28;
/// Animation header: id, flags, num_parts, num_frames.
const ANIMATION_HEADER_BYTES: u64 = 16;
/// Per-frame `num_hooks` count retained by a filtered record with no parts and no hooks.
const EMPTY_PART_FRAME_BYTES: u64 = 4;

/// Hook types a host simulation reads, not presentation: attack timing, collision passthrough,
/// object scale, angular velocity, object replacement, and sequence completion. Verified against
/// ACE, which walks `PartFrames[].Hooks` server-side for attack frames and door ethereality.
const SIMULATION_HOOK_TYPES: [u32; 6] = [3, 4, 5, 6, 12, 22];

/// Hook header on the wire: type then direction.
const HOOK_HEADER_BYTES: u64 = 8;
/// `ScaleHookPayload`: end scale and ramp duration.
const SCALE_PAYLOAD_BYTES: u64 = 8;
/// `SetOmegaHookPayload`: one `Vector3`.
const SET_OMEGA_PAYLOAD_BYTES: u64 = 12;

/// Bytes a replace-object payload occupies, matching the encoding the decoder accepts: a bare
/// 15-bit id offset, or a 30-bit offset split across two words.
fn replace_object_payload_bytes(payload: &ReplaceObjectHookPayload) -> u64 {
    const GFX_OBJ_KNOWN_TYPE: u32 = 0x0100_0000;
    let relative = payload.gfx_obj_id.wrapping_sub(GFX_OBJ_KNOWN_TYPE);
    2 + if relative < 0x8000 { 0 } else { 2 }
}

/// Wire size of one retained hook. Raw and replace-object payloads keep their exact source bytes,
/// so their length is authoritative; the two structured simulation payloads are fixed width.
fn simulation_hook_bytes(hook: &AnimationHook) -> u64 {
    let payload = match &hook.payload {
        AnimationHookPayload::NoPayload => 0,
        AnimationHookPayload::Raw(bytes) => bytes.len() as u64,
        AnimationHookPayload::Attack(_) => 28,
        AnimationHookPayload::Ethereal(_) => 4,
        AnimationHookPayload::ReplaceObject(payload) => replace_object_payload_bytes(payload),
        AnimationHookPayload::Scale(_) => SCALE_PAYLOAD_BYTES,
        AnimationHookPayload::SetOmega(_) => SET_OMEGA_PAYLOAD_BYTES,
        // Every other payload is presentation and is never retained.
        _ => 0,
    };
    HOOK_HEADER_BYTES + payload
}

/// Bytes a filtered record costs: header, position frames, and per-frame hook counts plus whatever
/// simulation hooks that frame retains. Part frames and presentation hooks are dropped.
fn filtered_animation_bytes(animation: &Animation, retain_hooks: bool) -> u64 {
    let hooks: u64 = if retain_hooks {
        animation
            .part_frames
            .iter()
            .flat_map(|frame| frame.hooks.iter())
            .filter(|hook| SIMULATION_HOOK_TYPES.contains(&hook.hook_type))
            .map(simulation_hook_bytes)
            .sum()
    } else {
        0
    };

    ANIMATION_HEADER_BYTES
        + animation.pos_frames.len() as u64 * FRAME_BYTES
        + u64::from(animation.num_frames) * EMPTY_PART_FRAME_BYTES
        + hooks
}

/// Motion table header: id and default style.
const MOTION_TABLE_HEADER_BYTES: u64 = 8;
/// Each serialized map is prefixed with a u32 entry count.
const MAP_COUNT_BYTES: u64 = 4;
/// A `style_defaults` entry is a u32 key and a u32 value.
const MAP_ENTRY_BYTES: u64 = 8;
/// A cycle map entry's u32 key.
const MAP_KEY_BYTES: u64 = 4;
/// `MotionData` header: num_anims, bitfield, flags, then alignment to a 4-byte boundary.
const MOTION_DATA_HEADER_BYTES: u64 = 4;
/// An `AnimData` record: anim id, low frame, high frame, framerate.
const ANIM_DATA_BYTES: u64 = 16;
/// A `Vector3` velocity or omega payload.
const VECTOR3_BYTES: u64 = 12;

/// The movement cycles motion resolution consumes today.
const MOVEMENT_COMMANDS: [u32; 4] = [
    MotionTable::WALK_FORWARD_COMMAND,
    MotionTable::RUN_FORWARD_COMMAND,
    MotionTable::TURN_LEFT_COMMAND,
    MotionTable::TURN_RIGHT_COMMAND,
];

/// Every command the protocol classifies as locomotion — the set a server can report for any
/// entity, which is wider than the four resolution acts on. A motion table's cycle key masks the
/// command to its low bits, so the protocol's raw value is the key's command half directly.
const LOCOMOTION_COMMANDS: [u32; 7] = [
    InterpretedMotionCommand::WALK_FORWARD.0 as u32,
    InterpretedMotionCommand::WALK_BACKWARDS.0 as u32,
    InterpretedMotionCommand::RUN_FORWARD.0 as u32,
    InterpretedMotionCommand::TURN_RIGHT.0 as u32,
    InterpretedMotionCommand::TURN_LEFT.0 as u32,
    InterpretedMotionCommand::SIDESTEP_RIGHT.0 as u32,
    InterpretedMotionCommand::SIDESTEP_LEFT.0 as u32,
];

/// Cycle keys pack a stance in the high half and a command in the low half. The command mask
/// overlaps the stance shift, so keys are reconstructed rather than decomposed.
///
/// Mirrors the private `cycle_key` in `holtburger_dat::file_type::motion_table`; that duplication
/// should collapse when the motion cutover lands.
const MOTION_KEY_MASK: u32 = 0x000F_FFFF;

fn cycle_key(stance: u32, command: u32) -> u32 {
    ((stance & 0xFFFF) << 16) | (command & MOTION_KEY_MASK)
}

/// Predicted wire size of a complete motion table, used to validate the byte model against the
/// archive's real record sizes before trusting any filtered estimate derived from it.
fn predicted_table_bytes(table: &MotionTable) -> u64 {
    let mut bytes = MOTION_TABLE_HEADER_BYTES
        + MAP_COUNT_BYTES
        + table.style_defaults.len() as u64 * MAP_ENTRY_BYTES;

    bytes += MAP_COUNT_BYTES;
    for motion_data in table.cycles.values() {
        bytes += MAP_KEY_BYTES + motion_data_bytes(motion_data);
    }
    bytes += MAP_COUNT_BYTES;
    for motion_data in table.modifiers.values() {
        bytes += MAP_KEY_BYTES + motion_data_bytes(motion_data);
    }
    bytes += MAP_COUNT_BYTES;
    for links in table.links.values() {
        bytes += MAP_KEY_BYTES + MAP_COUNT_BYTES;
        for motion_data in links.values() {
            bytes += MAP_KEY_BYTES + motion_data_bytes(motion_data);
        }
    }
    bytes
}

/// Predicted wire size of a complete animation, same purpose. `None` when the animation carries a
/// hook payload this census does not model, so it is excluded from the sample rather than counted
/// wrong.
fn predicted_animation_bytes(animation: &Animation) -> Option<u64> {
    let mut hooks = 0u64;
    for frame in &animation.part_frames {
        for hook in &frame.hooks {
            hooks += HOOK_HEADER_BYTES + hook_payload_bytes(hook)?;
        }
    }

    Some(
        ANIMATION_HEADER_BYTES
            + animation.pos_frames.len() as u64 * FRAME_BYTES
            + u64::from(animation.num_frames) * EMPTY_PART_FRAME_BYTES
            + u64::from(animation.num_frames) * u64::from(animation.num_parts) * FRAME_BYTES
            + hooks,
    )
}

/// Payload size for any hook, not just the simulation subset. `None` for payloads not modelled here.
fn hook_payload_bytes(hook: &AnimationHook) -> Option<u64> {
    match &hook.payload {
        AnimationHookPayload::NoPayload => Some(0),
        AnimationHookPayload::Raw(bytes) => Some(bytes.len() as u64),
        AnimationHookPayload::Attack(_) => Some(28),
        AnimationHookPayload::Ethereal(_) => Some(4),
        AnimationHookPayload::ReplaceObject(payload) => Some(replace_object_payload_bytes(payload)),
        AnimationHookPayload::Scale(_) => Some(SCALE_PAYLOAD_BYTES),
        AnimationHookPayload::SetOmega(_) => Some(SET_OMEGA_PAYLOAD_BYTES),
        _ => None,
    }
}

fn motion_data_bytes(data: &holtburger_dat::file_type::motion_table::MotionData) -> u64 {
    MOTION_DATA_HEADER_BYTES
        + data.anims.len() as u64 * ANIM_DATA_BYTES
        + data.velocity.map_or(0, |_| VECTOR3_BYTES)
        + data.omega.map_or(0, |_| VECTOR3_BYTES)
}

#[derive(Parser)]
#[command(about = "Size the raw motion content every archive profile carries")]
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

    // Every animation the motion tables can actually select, across cycles, modifiers, and links.
    // Motion resolution never reads an animation no table references.
    let mut referenced: HashSet<u32> = HashSet::new();
    let mut motion_table_bytes = 0u64;
    let mut motion_table_count = 0usize;
    // A capability-filtered table keeps every cycle but drops modifiers and links.
    let mut filtered_table_bytes = 0u64;
    let mut cycle_referenced: HashSet<u32> = HashSet::new();
    // The narrower "only commands a controller issues" boundary, kept for comparison.
    let mut movement_table_bytes = 0u64;
    let mut movement_referenced: HashSet<u32> = HashSet::new();
    // The protocol's locomotion set: wider than what resolution consumes, narrower than all cycles.
    let mut locomotion_table_bytes = 0u64;
    let mut locomotion_referenced: HashSet<u32> = HashSet::new();
    // How many cycles a tier without animations could still serve, across all cycles and again
    // restricted to the four commands resolution acts on today.
    let mut link_total = 0usize;
    let mut links_with_anims = 0usize;
    let mut links_with_kinematics = 0usize;
    let mut link_anim_ids: HashSet<u32> = HashSet::new();
    let mut locomotion_link_total = 0usize;
    let mut modifier_total = 0usize;
    let mut table_model_checked = 0usize;
    let mut table_model_exact = 0usize;
    let mut table_model_delta = 0i64;
    let mut table_model_examples: Vec<(u32, u64, u64)> = Vec::new();
    let mut anim_model_checked = 0usize;
    let mut anim_model_exact = 0usize;
    let mut cycle_total = 0usize;
    let mut cycles_with_explicit_kinematics = 0usize;
    let mut cycles_needing_animation = 0usize;
    let mut cycles_inert = 0usize;
    let mut movement_cycle_total = 0usize;
    let mut movement_cycles_with_explicit_kinematics = 0usize;
    let mut movement_cycles_needing_animation = 0usize;

    for entry in index.iter().filter(|e| e.type_id == MOTION_TABLE_TYPE) {
        motion_table_bytes += u64::from(entry.size);
        motion_table_count += 1;

        let bytes = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))
            .with_context(|| format!("read motion table 0x{:08X}", entry.file_id))?
            .bytes;
        let table = MotionTable::read(&mut Cursor::new(&bytes))
            .with_context(|| format!("decode motion table 0x{:08X}", entry.file_id))?;

        for motion_data in table.cycles.values().chain(table.modifiers.values()) {
            for anim in &motion_data.anims {
                referenced.insert(anim.anim_id);
            }
        }
        for (from_key, links) in &table.links {
            for motion_data in links.values() {
                for anim in &motion_data.anims {
                    referenced.insert(anim.anim_id);
                }
                link_total += 1;
                if !motion_data.anims.is_empty() {
                    links_with_anims += 1;
                }
                if motion_data.velocity.is_some() || motion_data.omega.is_some() {
                    links_with_kinematics += 1;
                }
                for anim in &motion_data.anims {
                    link_anim_ids.insert(anim.anim_id);
                }
                // A link whose source is a locomotion cycle is a transition the TUI could observe,
                // so it measures what dropping links costs beyond raw byte savings.
                if LOCOMOTION_COMMANDS
                    .iter()
                    .any(|command| cycle_key(from_key >> 16, *command) == *from_key)
                {
                    locomotion_link_total += 1;
                }
            }
        }
        modifier_total += table.modifiers.len();

        // Validate the byte model: predicted complete size versus the archive's real record size.
        let predicted = predicted_table_bytes(&table);
        table_model_checked += 1;
        if predicted == u64::from(entry.size) {
            table_model_exact += 1;
        } else {
            table_model_delta += predicted as i64 - i64::from(entry.size);
            if table_model_examples.len() < 3 {
                table_model_examples.push((entry.file_id, predicted, u64::from(entry.size)));
            }
        }

        // Table header plus the style-default map, which a filtered table still needs to resolve
        // a stance before it can select a movement cycle.
        filtered_table_bytes += MOTION_TABLE_HEADER_BYTES
            + MAP_COUNT_BYTES
            + table.style_defaults.len() as u64 * MAP_ENTRY_BYTES
            + MAP_COUNT_BYTES * 3;

        // A client interpolates whatever command the server reports for any entity, so the tier
        // keeps every cycle in every stance. Only modifiers and links — which need sequence
        // composition a velocity-grade client never performs — are dropped.
        for motion_data in table.cycles.values() {
            filtered_table_bytes += MAP_KEY_BYTES + motion_data_bytes(motion_data);
            for anim in &motion_data.anims {
                cycle_referenced.insert(anim.anim_id);
            }

            // A tier that drops animations can still serve cycles carrying explicit motion-data
            // velocity or omega. Cycles with neither are only movable by reading position frames,
            // so they measure what dropping animations would actually cost.
            cycle_total += 1;
            if motion_data.velocity.is_some() || motion_data.omega.is_some() {
                cycles_with_explicit_kinematics += 1;
            } else if !motion_data.anims.is_empty() {
                cycles_needing_animation += 1;
            } else {
                cycles_inert += 1;
            }
        }

        // The narrower boundary this census originally assumed: only the commands a controller
        // issues itself. Retained to size what scoping by issued command would have saved.
        let stances: HashSet<u32> = table
            .cycles
            .keys()
            .map(|key| key >> 16)
            .chain(std::iter::once(table.default_style & 0xFFFF))
            .collect();

        for stance in stances {
            for command in MOVEMENT_COMMANDS {
                let Some(motion_data) = table.cycles.get(&cycle_key(stance, command)) else {
                    continue;
                };
                movement_table_bytes += MAP_KEY_BYTES + motion_data_bytes(motion_data);
                for anim in &motion_data.anims {
                    movement_referenced.insert(anim.anim_id);
                }

                // The same question restricted to the commands the TUI can act on today: how many
                // of them would stop moving if the tier carried no animations.
                movement_cycle_total += 1;
                if motion_data.velocity.is_some() || motion_data.omega.is_some() {
                    movement_cycles_with_explicit_kinematics += 1;
                } else if !motion_data.anims.is_empty() {
                    movement_cycles_needing_animation += 1;
                }
            }

            // The protocol's own locomotion set: what a server can report for any entity, and the
            // honest tier boundary if the TUI is ever to act on everything it already decodes.
            for command in LOCOMOTION_COMMANDS {
                let Some(motion_data) = table.cycles.get(&cycle_key(stance, command)) else {
                    continue;
                };
                locomotion_table_bytes += MAP_KEY_BYTES + motion_data_bytes(motion_data);
                for anim in &motion_data.anims {
                    locomotion_referenced.insert(anim.anim_id);
                }
            }
        }
    }

    let mut raw_total = 0u64;
    let mut raw_referenced = 0u64;
    let mut filtered_referenced = 0u64;
    let mut with_pos_frames = 0usize;
    let mut referenced_present = 0usize;
    let mut animation_count = 0usize;
    let mut sizes_by_id: HashMap<u32, u32> = HashMap::new();
    // Most referenced animations carry no root motion at all, so a filtered set that ships only
    // the ones with position frames is the tightest raw option a small profile could take.
    let mut filtered_pos_frame_only = 0u64;
    // Animations reachable from any cycle: the tier a client that interpolates every entity needs.
    let mut filtered_cycle_only = 0u64;
    let mut filtered_cycle_hooked = 0u64;
    let mut cycle_animation_count = 0usize;
    // Animations reachable from only the four controller-issued commands.
    let mut filtered_movement_only = 0u64;
    let mut filtered_movement_hooked = 0u64;
    let mut movement_animation_count = 0usize;
    // Animations reachable from the protocol's full locomotion set.
    let mut filtered_locomotion_only = 0u64;
    let mut filtered_locomotion_hooked = 0u64;
    let mut locomotion_animation_count = 0usize;
    // Simulation-relevant hooks live inside part frames, so a filtered record that drops part
    // frames drops them too. Size what preserving them across cycle-reachable animations costs.
    let mut simulation_hook_count = 0usize;
    let mut presentation_hook_count = 0usize;
    let mut animations_with_simulation_hooks = 0usize;
    let mut hooks_by_type: HashMap<u32, usize> = HashMap::new();
    let mut referenced_hooks_by_type: HashMap<u32, usize> = HashMap::new();
    // Hooks in animations no motion table references, so absence claims cover the whole archive.
    let mut archive_hooks_by_type: HashMap<u32, usize> = HashMap::new();
    let mut locomotion_hooks_by_type: HashMap<u32, usize> = HashMap::new();

    for entry in index.iter().filter(|e| e.type_id == ANIMATION_TYPE) {
        animation_count += 1;
        raw_total += u64::from(entry.size);
        sizes_by_id.insert(entry.file_id, entry.size);

        if !referenced.contains(&entry.file_id) {
            // Still scan hooks: a type absent from referenced content may exist elsewhere, and the
            // contract should not declare a type unreachable on partial evidence.
            let unreferenced = content
                .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))
                .with_context(|| format!("read animation 0x{:08X}", entry.file_id))?
                .bytes;
            let unreferenced = Animation::read(&mut Cursor::new(&unreferenced))
                .with_context(|| format!("decode animation 0x{:08X}", entry.file_id))?;
            for frame in &unreferenced.part_frames {
                for hook in &frame.hooks {
                    if SIMULATION_HOOK_TYPES.contains(&hook.hook_type) {
                        *archive_hooks_by_type.entry(hook.hook_type).or_insert(0) += 1;
                    }
                }
            }
            continue;
        }
        referenced_present += 1;
        raw_referenced += u64::from(entry.size);

        let bytes = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))
            .with_context(|| format!("read animation 0x{:08X}", entry.file_id))?
            .bytes;
        let animation = Animation::read(&mut Cursor::new(&bytes))
            .with_context(|| format!("decode animation 0x{:08X}", entry.file_id))?;

        if let Some(predicted_anim) = predicted_animation_bytes(&animation) {
            anim_model_checked += 1;
            if predicted_anim == u64::from(entry.size) {
                anim_model_exact += 1;
            }
        }

        // A filtered record keeps the header and position frames, drops every part frame, and
        // still decodes with the existing reader because num_parts becomes zero. Simulation hooks
        // are retained because they live in part frames and are not presentation.
        let filtered = filtered_animation_bytes(&animation, false);
        let filtered_hooked = filtered_animation_bytes(&animation, true);
        filtered_referenced += filtered;

        if !animation.pos_frames.is_empty() {
            with_pos_frames += 1;
            filtered_pos_frame_only += filtered;
        }

        // Scan hooks across every referenced animation, including those reachable only through
        // modifiers and links, so hook types absent from cycles are still accounted for.
        for frame in &animation.part_frames {
            for hook in &frame.hooks {
                if SIMULATION_HOOK_TYPES.contains(&hook.hook_type) {
                    *referenced_hooks_by_type.entry(hook.hook_type).or_insert(0) += 1;
                }
            }
        }

        if cycle_referenced.contains(&entry.file_id) {
            cycle_animation_count += 1;
            filtered_cycle_only += filtered;
            filtered_cycle_hooked += filtered_hooked;

            let mut has_simulation_hook = false;
            for frame in &animation.part_frames {
                for hook in &frame.hooks {
                    if SIMULATION_HOOK_TYPES.contains(&hook.hook_type) {
                        simulation_hook_count += 1;
                        has_simulation_hook = true;
                        *hooks_by_type.entry(hook.hook_type).or_insert(0) += 1;
                        // A narrower tier only preserves a hook if it also keeps the animation
                        // carrying it, so count reachability per tier rather than per hook.
                        if locomotion_referenced.contains(&entry.file_id) {
                            *locomotion_hooks_by_type.entry(hook.hook_type).or_insert(0) += 1;
                        }
                    } else {
                        presentation_hook_count += 1;
                    }
                }
            }
            if has_simulation_hook {
                animations_with_simulation_hooks += 1;
            }
        }

        if movement_referenced.contains(&entry.file_id) {
            movement_animation_count += 1;
            filtered_movement_only += filtered;
            filtered_movement_hooked += filtered_hooked;
        }

        if locomotion_referenced.contains(&entry.file_id) {
            locomotion_animation_count += 1;
            filtered_locomotion_only += filtered;
            filtered_locomotion_hooked += filtered_hooked;
        }
    }

    let missing: Vec<u32> = referenced
        .iter()
        .copied()
        .filter(|id| !sizes_by_id.contains_key(id))
        .collect();

    println!(
        "motion tables:            {motion_table_count} files, {}",
        mb(motion_table_bytes)
    );
    println!(
        "animations (all):         {animation_count} files, {}",
        mb(raw_total)
    );
    println!(
        "animations (referenced):  {referenced_present} files, {}",
        mb(raw_referenced)
    );
    println!("  of those, w/ pos frames: {with_pos_frames}");
    println!("referenced but absent:    {}", missing.len());
    println!();
    println!(
        "filtered referenced animations: {}",
        mb(filtered_referenced)
    );
    println!(
        "filtered, pos-frame carriers:   {}",
        mb(filtered_pos_frame_only)
    );
    println!();
    println!(
        "small-profile budget (all referenced):     {}",
        mb(motion_table_bytes + filtered_referenced)
    );
    println!(
        "small-profile budget (pos-frame carriers): {}",
        mb(motion_table_bytes + filtered_pos_frame_only)
    );
    println!();
    println!("--- capability-filtered raw: all cycles, no modifiers/links ---");
    println!(
        "motion tables:                  {}",
        mb(filtered_table_bytes)
    );
    println!(
        "animations reachable from cycles: {cycle_animation_count} files, {}",
        mb(filtered_cycle_only)
    );
    println!(
        "budget (no hooks):                {}",
        mb(filtered_table_bytes + filtered_cycle_only)
    );
    println!(
        "budget (simulation hooks kept):   {}",
        mb(filtered_table_bytes + filtered_cycle_hooked)
    );
    println!();
    println!("--- what a tier without animations could still serve ---");
    println!("all cycles:                     {cycle_total}");
    println!("  explicit velocity or omega:   {cycles_with_explicit_kinematics}");
    println!("  need animation position frames: {cycles_needing_animation}");
    println!("  no anims and no kinematics:   {cycles_inert}");
    println!("four TUI commands:              {movement_cycle_total}");
    println!("  explicit velocity or omega:   {movement_cycles_with_explicit_kinematics}");
    println!("  need animation position frames: {movement_cycles_needing_animation}");
    println!();
    println!("--- byte-model validation (predicted complete size vs archive size) ---");
    println!("motion tables exact: {table_model_exact}/{table_model_checked}");
    if table_model_exact != table_model_checked {
        println!("  net delta over mismatches: {table_model_delta} bytes");
        for (id, predicted, actual) in &table_model_examples {
            println!("  0x{id:08X}: predicted {predicted}, actual {actual}");
        }
    }
    println!(
        "animations exact:    {anim_model_exact}/{anim_model_checked} (modelled payloads only)"
    );
    println!();
    println!("--- what dropping modifiers and links removes ---");
    let link_only_anims = link_anim_ids.difference(&cycle_referenced).count();
    println!("modifier records:               {modifier_total}");
    println!("link records:                   {link_total}");
    println!("  carrying transition animations: {links_with_anims}");
    println!("  carrying explicit velocity/omega: {links_with_kinematics}");
    println!("  distinct animations only links reach: {link_only_anims}");
    println!("  whose source is a locomotion cycle: {locomotion_link_total}");
    println!();
    println!("--- hooks in cycle-reachable animations ---");
    println!("simulation-relevant hooks:      {simulation_hook_count}");
    println!("presentation hooks:             {presentation_hook_count}");
    println!(
        "animations carrying sim hooks:  {animations_with_simulation_hooks} of {cycle_animation_count}"
    );
    let mut hook_types: Vec<u32> = referenced_hooks_by_type
        .keys()
        .chain(archive_hooks_by_type.keys())
        .copied()
        .collect::<HashSet<u32>>()
        .into_iter()
        .collect();
    hook_types.sort_unstable();
    println!("  by type (archive-only -> all referenced -> cycles -> locomotion tier):");
    for hook_type in hook_types {
        let all = hooks_by_type.get(&hook_type).copied().unwrap_or(0);
        let loco = locomotion_hooks_by_type
            .get(&hook_type)
            .copied()
            .unwrap_or(0);
        let referenced_count = referenced_hooks_by_type
            .get(&hook_type)
            .copied()
            .unwrap_or(0);
        let unreferenced = archive_hooks_by_type.get(&hook_type).copied().unwrap_or(0);
        println!(
            "    {:<14} {unreferenced:>4} -> {referenced_count:>4} -> {all:>4} -> {loco:>4}",
            hook_type_name(hook_type)
        );
    }
    println!();
    println!("--- protocol locomotion set (7 commands) ---");
    println!(
        "motion tables:                  {}",
        mb(locomotion_table_bytes)
    );
    println!(
        "animations reachable:             {locomotion_animation_count} files, {}",
        mb(filtered_locomotion_only)
    );
    println!(
        "budget (no hooks):                {}",
        mb(locomotion_table_bytes + filtered_locomotion_only)
    );
    println!(
        "budget (simulation hooks kept):   {}",
        mb(locomotion_table_bytes + filtered_locomotion_hooked)
    );
    println!();
    println!("--- narrower: only the four commands resolution consumes today ---");
    println!(
        "motion tables:                  {}",
        mb(movement_table_bytes)
    );
    println!(
        "animations reachable:             {movement_animation_count} files, {}",
        mb(filtered_movement_only)
    );
    println!(
        "budget (no hooks):                {}",
        mb(movement_table_bytes + filtered_movement_only)
    );
    println!(
        "budget (simulation hooks kept):   {}",
        mb(movement_table_bytes + filtered_movement_hooked)
    );

    Ok(())
}

fn hook_type_name(hook_type: u32) -> &'static str {
    match hook_type {
        3 => "Attack",
        4 => "AnimationDone",
        5 => "ReplaceObject",
        6 => "Ethereal",
        12 => "Scale",
        22 => "SetOmega",
        _ => "unknown",
    }
}

fn mb(bytes: u64) -> String {
    format!("{:.2} MB ({bytes} bytes)", bytes as f64 / (1024.0 * 1024.0))
}
