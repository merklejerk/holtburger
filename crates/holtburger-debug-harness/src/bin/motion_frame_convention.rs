//! Which local axis is "forward" for authored root translation and for explicit motion-data
//! velocity?
//!
//! Retail adds motion-data velocity straight into the same offset that authored position frames are
//! composed into, so both are expressed in the object's own frame and must agree about which axis
//! points forward. The census says explicit velocity is entirely X-dominant and authored translation
//! is mostly Y-dominant, so one of those readings is wrong. Cycles that carry both settle it.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_common::{RigidTransform, Vector3};
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{Animation, MotionTable};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::collections::{BTreeMap, HashMap};
use std::io::Cursor;

const ANIMATION_TYPE: u32 = 0x03;
const MOTION_TABLE_TYPE: u32 = 0x09;

#[derive(Parser)]
#[command(about = "Compare explicit motion-data velocity against authored root translation")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

fn dominant_axis(vector: Vector3) -> &'static str {
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
    let read = |file_id: u32| -> Result<Vec<u8>> {
        Ok(content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, file_id))?
            .bytes)
    };

    let mut animations: HashMap<u32, Animation> = HashMap::new();
    for entry in index.iter().filter(|e| e.type_id == ANIMATION_TYPE) {
        let animation = Animation::read(&mut Cursor::new(read(entry.file_id)?))
            .with_context(|| format!("decode animation 0x{:08X}", entry.file_id))?;
        animations.insert(animation.id, animation);
    }

    let mut pairs: BTreeMap<(&'static str, &'static str), usize> = BTreeMap::new();
    let mut ratios: Vec<(f32, u32, u32)> = Vec::new();
    let mut velocity_only = 0usize;
    let mut translation_only = 0usize;

    for entry in index.iter().filter(|e| e.type_id == MOTION_TABLE_TYPE) {
        let table = MotionTable::read(&mut Cursor::new(read(entry.file_id)?))
            .with_context(|| format!("decode motion table 0x{:08X}", entry.file_id))?;
        let linked = table.links.values().flat_map(|links| links.values());
        for motion_data in table
            .cycles
            .values()
            .chain(table.modifiers.values())
            .chain(linked)
        {
            // Compose the clips the way the runtime does, so the comparison is against the same
            // quantity the solver would receive.
            let mut composed = RigidTransform::identity();
            let mut frames = 0u32;
            let mut framerate = 0.0f32;
            for anim in &motion_data.anims {
                let Some(animation) = animations.get(&anim.anim_id) else {
                    continue;
                };
                if framerate == 0.0 {
                    framerate = anim.framerate;
                }
                for frame in &animation.pos_frames {
                    composed = composed.combine(&RigidTransform {
                        translation: frame.origin,
                        rotation: frame.orientation,
                    });
                    frames += 1;
                }
            }

            let translates = composed.translation.length() > 1e-4;
            match (motion_data.velocity, translates) {
                (Some(velocity), true) => {
                    *pairs
                        .entry((dominant_axis(velocity), dominant_axis(composed.translation)))
                        .or_insert(0) += 1;
                    if frames > 0 && framerate.abs() > 1e-4 {
                        let authored_speed =
                            composed.translation.length() / frames as f32 * framerate.abs();
                        if velocity.length() > 1e-4 {
                            ratios.push((
                                authored_speed / velocity.length(),
                                entry.file_id,
                                motion_data.anims[0].anim_id,
                            ));
                        }
                    }
                }
                (Some(_), false) => velocity_only += 1,
                (None, true) => translation_only += 1,
                (None, false) => {}
            }
        }
    }

    println!(
        "records carrying explicit velocity AND authored translation: {}",
        ratios.len()
    );
    println!("  (velocity axis, translation axis) counts: {pairs:?}");
    println!("records with explicit velocity and no authored translation: {velocity_only}");
    println!("records with authored translation and no explicit velocity: {translation_only}");

    if !ratios.is_empty() {
        ratios.sort_by(|a, b| a.0.total_cmp(&b.0));
        let median = ratios[ratios.len() / 2];
        println!(
            "\nauthored speed / explicit speed: min {:.3}, median {:.3}, max {:.3}",
            ratios[0].0,
            median.0,
            ratios[ratios.len() - 1].0
        );
        println!(
            "  median sample: table 0x{:08X}, animation 0x{:08X}",
            median.1, median.2
        );
    }

    Ok(())
}
