//! Compares retail and exactly-once root sampling at directly-authored clip boundaries.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_common::RigidTransform;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::motion_table::AnimData;
use holtburger_dat::file_type::{Animation, MotionTable};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::collections::HashMap;
use std::io::Cursor;

const ANIMATION_TYPE: u32 = 0x03;
const MOTION_TABLE_TYPE: u32 = 0x09;

#[derive(Parser)]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn frame(animation: &Animation, authored: i32) -> Option<RigidTransform> {
    if animation.pos_frames.is_empty() {
        return None;
    }
    let last = animation.num_frames.saturating_sub(1) as i32;
    let index = authored.clamp(0, last) as usize;
    animation.pos_frames.get(index).map(|value| RigidTransform {
        translation: value.origin,
        rotation: value.orientation,
    })
}

fn resolved_window(animation: &Animation, clip: &AnimData) -> (i32, i32) {
    let last = animation.num_frames.saturating_sub(1) as i32;
    let low = clip.low_frame.clamp(0, last);
    let high = if clip.high_frame < 0 {
        last
    } else {
        clip.high_frame.clamp(0, last)
    };
    (low, high.max(low))
}

fn retail_boundary(
    leaving: &AnimData,
    entered: &AnimData,
    animations: &HashMap<u32, Animation>,
) -> RigidTransform {
    let mut result = RigidTransform::identity();
    if leaving.framerate < 0.0
        && let Some(terminal) = animations.get(&leaving.anim_id).and_then(|animation| {
            let (low, _) = resolved_window(animation, leaving);
            frame(animation, low)
        })
    {
        result = result.subtract(&terminal);
    }
    if entered.framerate > 0.0
        && let Some(entry) = animations.get(&entered.anim_id).and_then(|animation| {
            let (low, _) = resolved_window(animation, entered);
            frame(animation, low)
        })
    {
        result = result.combine(&entry);
    }
    result
}

fn exact_boundary(leaving: &AnimData, animations: &HashMap<u32, Animation>) -> RigidTransform {
    let Some(animation) = animations.get(&leaving.anim_id) else {
        return RigidTransform::identity();
    };
    let (low, high) = resolved_window(animation, leaving);
    if leaving.framerate > 0.0 {
        frame(animation, high).unwrap_or_else(RigidTransform::identity)
    } else if leaving.framerate < 0.0 {
        frame(animation, low).map_or_else(RigidTransform::identity, |terminal| {
            RigidTransform::identity().subtract(&terminal)
        })
    } else {
        RigidTransform::identity()
    }
}

fn main() -> Result<()> {
    let content =
        ContentRepository::discover(Args::parse().content).context("content discovery failed")?;
    let read = |id: u32| -> Result<Vec<u8>> {
        Ok(content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, id))?
            .bytes)
    };

    let mut animations = HashMap::new();
    for entry in content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE && entry.type_id == ANIMATION_TYPE)
    {
        let animation = Animation::read(&mut Cursor::new(read(entry.file_id)?))?;
        animations.insert(animation.id, animation);
    }

    let mut boundaries = Vec::new();
    for entry in content.resource_index().iter().filter(|entry| {
        entry.namespace == EOR_PORTAL_NAMESPACE && entry.type_id == MOTION_TABLE_TYPE
    }) {
        let table = MotionTable::read(&mut Cursor::new(read(entry.file_id)?))?;
        for (key, sequence) in &table.cycles {
            boundaries.extend(
                sequence
                    .anims
                    .windows(2)
                    .map(|pair| (table.id, "cycle", *key, pair[0].clone(), pair[1].clone())),
            );
            if let Some(last) = sequence.anims.last() {
                boundaries.push((table.id, "cycle-loop", *key, last.clone(), last.clone()));
            }
        }
        for (from, targets) in &table.links {
            for (to, sequence) in targets {
                boundaries.extend(sequence.anims.windows(2).map(|pair| {
                    (
                        table.id,
                        "link",
                        *from ^ *to,
                        pair[0].clone(),
                        pair[1].clone(),
                    )
                }));
            }
        }
    }

    let mut translation_deltas = Vec::new();
    let mut rotation_deltas = Vec::new();
    let mut largest = Vec::new();
    for (table, kind, key, leaving, entered) in &boundaries {
        if leaving.framerate.abs() < 0.000_2 {
            continue;
        }
        let retail = retail_boundary(leaving, entered, &animations);
        let exact = exact_boundary(leaving, &animations);
        let translation_delta = (retail.translation - exact.translation).length();
        translation_deltas.push(translation_delta);
        let dot = (retail.rotation.w * exact.rotation.w
            + retail.rotation.x * exact.rotation.x
            + retail.rotation.y * exact.rotation.y
            + retail.rotation.z * exact.rotation.z)
            .abs()
            .clamp(0.0, 1.0);
        let rotation_delta = 2.0 * dot.acos().to_degrees();
        rotation_deltas.push(rotation_delta);
        largest.push((
            translation_delta,
            rotation_delta,
            *table,
            *kind,
            *key,
            leaving.clone(),
            entered.clone(),
        ));
    }
    translation_deltas.sort_by(f32::total_cmp);
    rotation_deltas.sort_by(f32::total_cmp);
    let percentile =
        |values: &[f32], percent: usize| values[(values.len().saturating_sub(1) * percent) / 100];
    let changed_translation = translation_deltas
        .iter()
        .filter(|value| **value > 1e-5)
        .count();
    let changed_rotation = rotation_deltas
        .iter()
        .filter(|value| **value > 1e-3)
        .count();

    println!("sampled boundaries: {}", translation_deltas.len());
    println!(
        "translation changed: {changed_translation}; p50 {:.6} m; p95 {:.6} m; p99 {:.6} m; max {:.6} m",
        percentile(&translation_deltas, 50),
        percentile(&translation_deltas, 95),
        percentile(&translation_deltas, 99),
        translation_deltas.last().copied().unwrap_or_default(),
    );
    largest.sort_by(|left, right| right.0.total_cmp(&left.0));
    println!("largest translation deltas:");
    for (translation, rotation, table, kind, key, leaving, entered) in largest.iter().take(12) {
        println!(
            "  {translation:.6} m / {rotation:.6} deg: table 0x{table:08X} {kind} 0x{key:08X}: 0x{:08X} [{}..{}] @ {} -> 0x{:08X} [{}..{}] @ {}",
            leaving.anim_id,
            leaving.low_frame,
            leaving.high_frame,
            leaving.framerate,
            entered.anim_id,
            entered.low_frame,
            entered.high_frame,
            entered.framerate,
        );
    }
    println!(
        "rotation changed: {changed_rotation}; p50 {:.6} deg; p95 {:.6} deg; p99 {:.6} deg; max {:.6} deg",
        percentile(&rotation_deltas, 50),
        percentile(&rotation_deltas, 95),
        percentile(&rotation_deltas, 99),
        rotation_deltas.last().copied().unwrap_or_default(),
    );
    Ok(())
}
