//! Phase 1 acceptance evidence for the `MotionSequence` contract, run against real content.
//!
//! Checks that the projection covers the whole archive, that the standard character walk
//! reconstructs as an authored sequence rather than a mean velocity, and that the simulation hooks
//! the contract promises to preserve survive the projection.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::{ContentRepository, MotionHookEffect};
use holtburger_dat::file_type::MotionTable;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use holtburger_world::motion::{
    ActionSelectionOutcome, MotionCommand, MotionSelectionOutcome, MotionSequenceRuntime,
    MotionState, select_action, select_motion, set_default_state,
};
use std::time::Instant;

/// Standard character motion table, its default style, and walk-forward, from the plan's evidence.
const STANDARD_TABLE: u32 = 0x0900_0001;
const STANDARD_STYLE: u32 = 0x8000_003D;

#[derive(Parser)]
#[command(about = "Verify the motion contract against the mounted archive")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;

    let started = Instant::now();
    let catalog = content
        .read_motion_sequence_catalog()
        .context("motion contract projection failed")?;
    let elapsed = started.elapsed();

    let tables: Vec<_> = catalog.tables().collect();
    let cycles: usize = tables.iter().map(|table| table.cycle_count()).sum();
    println!(
        "projected {} tables ({cycles} cycles) and {} setup defaults in {:.0} ms",
        tables.len(),
        catalog.setup_default_tables().count(),
        elapsed.as_secs_f64() * 1000.0
    );

    let table = catalog
        .table(STANDARD_TABLE)
        .context("standard character motion table is absent")?;
    println!(
        "\nstandard table 0x{STANDARD_TABLE:08X}: default style 0x{:08X}",
        table.default_style
    );

    let walk = table
        .cycle(STANDARD_STYLE, MotionTable::WALK_FORWARD_COMMAND)
        .context("standard walk-forward cycle is absent")?;
    println!(
        "  walk-forward: {} clip(s), velocity {:?}, omega {:?}",
        walk.clips.len(),
        walk.velocity,
        walk.omega
    );
    for clip in &walk.clips {
        let composed = clip
            .animation
            .root
            .composed_over(clip.low_frame, clip.high_frame);
        println!(
            "    animation 0x{:08X}: frames {}..={} of {} at {} fps",
            clip.animation.id,
            clip.low_frame,
            clip.high_frame,
            clip.animation.frame_count,
            clip.framerate
        );
        println!(
            "      root track: {} frames, composed translation {:?}",
            clip.animation.root.frames().len(),
            composed.translation
        );
        let magnitude = (composed.translation.x.powi(2)
            + composed.translation.y.powi(2)
            + composed.translation.z.powi(2))
        .sqrt();
        println!(
            "      composed distance {magnitude:.4} m; reduced mean speed would be {:.4} m/s",
            magnitude / clip.animation.root.frames().len().max(1) as f32 * clip.framerate
        );
    }

    for (label, command) in [
        ("ready", MotionCommand::READY),
        ("falling", MotionCommand::FALLING),
    ] {
        let presentation = table
            .cycle(STANDARD_STYLE, command.raw())
            .with_context(|| format!("standard {label} cycle 0x{:08X} is absent", command.raw()))?;
        println!(
            "  {label}: {} clip(s): {}",
            presentation.clips.len(),
            presentation
                .clips
                .iter()
                .map(|clip| format!("0x{:08X}", clip.animation.id))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    let mut attack = 0usize;
    let mut ethereal = 0usize;
    let mut replace = 0usize;
    let mut animations_with_root = 0usize;
    let mut distinct_animations = std::collections::HashSet::new();
    for table in &tables {
        for (_, sequence) in table.cycles() {
            for clip in &sequence.clips {
                if !distinct_animations.insert(clip.animation.id) {
                    continue;
                }
                if !clip.animation.root.is_stationary() {
                    animations_with_root += 1;
                }
                for hook in clip.animation.hooks.hooks() {
                    match hook.effect {
                        MotionHookEffect::Attack(_) => attack += 1,
                        MotionHookEffect::Ethereal { .. } => ethereal += 1,
                        MotionHookEffect::ReplaceObject(_) => replace += 1,
                    }
                }
            }
        }
    }

    println!(
        "\ncycle-reachable animations: {}",
        distinct_animations.len()
    );
    println!("  authoring root motion:    {animations_with_root}");
    println!("  attack hooks:             {attack}");
    println!("  ethereal hooks:           {ethereal}");
    println!("  replace-object hooks:     {replace}");

    let action_commands: Vec<_> = (0..=411)
        .filter_map(|index| {
            MotionCommand::from_interpreted(InterpretedMotionCommand(index))
                .filter(|command| command.is_action())
        })
        .collect();
    let mut default_states = 0usize;
    let mut ready_routes = 0usize;
    let mut falling_routes = 0usize;
    let mut action_routes = 0usize;
    let mut completed_action_routes = 0usize;
    let mut held_action_routes = 0usize;
    let mut immediate_actions = 0usize;
    for table in &tables {
        let mut default_state = MotionState::default();
        let mut default_sequence = MotionSequenceRuntime::new();
        if set_default_state(table, &mut default_state, &mut default_sequence)
            == MotionSelectionOutcome::Unmodelled
        {
            continue;
        }
        default_states += 1;
        for (command, count) in [
            (MotionCommand::READY, &mut ready_routes),
            (MotionCommand::FALLING, &mut falling_routes),
        ] {
            let mut state = default_state.clone();
            let mut sequence = default_sequence.clone();
            if select_motion(table, &mut state, &mut sequence, command, 1.0).is_modelled() {
                *count += 1;
            }
        }
        for command in &action_commands {
            let mut state = default_state.clone();
            let mut sequence = default_sequence.clone();
            match select_action(table, &mut state, &mut sequence, *command, 1.0) {
                ActionSelectionOutcome::Unmodelled => {}
                ActionSelectionOutcome::CompletedWithoutClips => immediate_actions += 1,
                ActionSelectionOutcome::Selected => {
                    action_routes += 1;
                    let has_zero_rate = sequence.clips().iter().any(|node| node.framerate() == 0.0);
                    let route = sequence
                        .clips()
                        .iter()
                        .map(|node| {
                            format!(
                                "0x{:08X}[{}..={} @ {}]",
                                node.animation().id,
                                node.low_frame(),
                                node.high_frame(),
                                node.framerate(),
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(" -> ");
                    let completed = (0..4096).any(|_| sequence.advance(0.25).action_completed);
                    if completed {
                        completed_action_routes += 1;
                    } else if has_zero_rate {
                        // A zero-rate authored action is an intentional held pose under retail's
                        // sequence clock. It remains active because no frame boundary can produce
                        // AnimationDone; do not manufacture a timeout.
                        held_action_routes += 1;
                    } else {
                        anyhow::bail!(
                            "table 0x{:08X} action 0x{:08X} selected from its default state but did not reach its exact completion boundary: {route}",
                            table.id,
                            command.raw(),
                        );
                    }
                }
            }
        }
    }
    anyhow::ensure!(
        default_states == tables.len(),
        "only {default_states} of {} motion tables install their authored default state",
        tables.len(),
    );
    anyhow::ensure!(
        action_routes + immediate_actions != 0,
        "no action route was reachable from any table default",
    );
    println!("\nselector/runtime acceptance from every table default:");
    println!("  defaults installed:       {default_states}");
    println!("  Ready routes:             {ready_routes}");
    println!("  Falling routes:           {falling_routes}");
    println!("  action routes selected:   {action_routes}");
    println!("  action routes completed:  {completed_action_routes}");
    println!("  authored held actions:    {held_action_routes}");
    println!("  zero-clip actions:        {immediate_actions}");

    Ok(())
}
