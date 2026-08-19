//! How closed-form is the authored particle emitter corpus?
//!
//! Sizes the GPU-emission design in `docs/plans/holtburger-3d-particle-cpu-reduction-plan.md`:
//! that design replaces per-frame CPU emission with `birth(k) = phase + k * birthrate` and a
//! fixed per-emitter alive window of `ceil(max_lifespan / birthrate)` instances, which is exact
//! only when the authored `max_particles` cap never binds and emission cadence is not
//! frame-coupled. This census measures both preconditions and the populations that must stay on
//! the CPU path (finite, parent-following, per-meter).
//!
//! Retail context: `birthrate` is a minimum interval with at most one emission per update
//! (acclient.c:312447-312476), so cadence below a frame interval is already rate-limited by frame
//! rate in retail — the divergence the plan must size.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{ParticleEmitterInfo, ParticleMotion};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use std::io::Cursor;

/// 0x32 `ParticleEmitterInfo` resource type prefix.
const PARTICLE_EMITTER_TYPE_PREFIX: u32 = 0x32;
/// Retail's nominal frame interval; cadences below it are frame-rate-limited in retail.
const RETAIL_FRAME_SECONDS: f64 = 1.0 / 60.0;

#[derive(Parser)]
#[command(about = "Census authored particle emitter definitions for the GPU-emission design")]
struct Args {
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

/// Derived closed-form facts for one interval-driven emitter.
struct EmitterFacts {
    persistent: bool,
    follows_parent: bool,
    /// `ceil((lifespan + |lifespan_rand|) / birthrate)`, the fixed instance count the GPU design
    /// allocates; `None` when birthrate is zero (interval-driven but degenerate).
    alive_window_bound: Option<u32>,
    /// Authored cap is smaller than the alive window, so retail would delay births where the
    /// closed form clamps.
    cap_binds: bool,
    /// Cadence faster than one retail frame, where retail's one-per-update quirk already
    /// rate-limits emission.
    sub_frame_cadence: bool,
    birthrate: f64,
    max_particles: i32,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;

    let mut total = 0u32;
    let mut decode_failures = 0u32;
    let mut per_meter_only = 0u32;
    let mut unshipped_motion = 0u32;
    let mut motion_counts: std::collections::BTreeMap<i32, u32> = Default::default();
    let mut facts: Vec<EmitterFacts> = Vec::new();

    for entry in content.resource_index() {
        if entry.namespace != EOR_PORTAL_NAMESPACE
            || entry.file_id >> 24 != PARTICLE_EMITTER_TYPE_PREFIX
        {
            continue;
        }
        total += 1;
        let resource = content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, entry.file_id))
            .with_context(|| format!("read 0x{:08X}", entry.file_id))?;
        let Ok(info) = ParticleEmitterInfo::read(&mut Cursor::new(resource.bytes)) else {
            decode_failures += 1;
            continue;
        };
        match info.motion {
            ParticleMotion::Shipped(motion) => {
                *motion_counts.entry(i32::from(motion)).or_default() += 1;
            }
            ParticleMotion::Unshipped(_) => unshipped_motion += 1,
        }
        if !info.trigger.per_second() {
            per_meter_only += 1;
            continue;
        }
        let max_lifespan = info.lifespan + info.lifespan_rand.abs();
        let alive_window_bound =
            (info.birthrate > 0.0).then(|| (max_lifespan / info.birthrate).ceil().max(1.0) as u32);
        facts.push(EmitterFacts {
            persistent: info.is_persistent(),
            follows_parent: info.is_parent_local != 0,
            cap_binds: alive_window_bound.is_some_and(|bound| (info.max_particles as u32) < bound)
                || info.initial_particles > info.max_particles,
            sub_frame_cadence: info.birthrate > 0.0 && info.birthrate < RETAIL_FRAME_SECONDS,
            alive_window_bound,
            birthrate: info.birthrate,
            max_particles: info.max_particles,
        });
    }

    println!("total ParticleEmitterInfo records: {total}");
    println!("decode failures: {decode_failures}");
    println!("per-meter-only (never emit today, CPU-path forever): {per_meter_only}");
    println!("unshipped motion types: {unshipped_motion}");
    println!("motion type counts: {motion_counts:?}");

    let interval = &facts;
    let count =
        |predicate: fn(&EmitterFacts) -> bool| interval.iter().filter(|f| predicate(f)).count();
    println!("\ninterval-driven emitters: {}", interval.len());
    println!("  persistent: {}", count(|f| f.persistent));
    println!("  finite: {}", count(|f| !f.persistent));
    println!("  follows-parent: {}", count(|f| f.follows_parent));
    println!(
        "  GPU-eligible shape (persistent, not follows-parent): {}",
        count(|f| f.persistent && !f.follows_parent)
    );
    println!(
        "  cap binds (clamp divergence observable): {}",
        count(|f| f.cap_binds)
    );
    println!(
        "  cap binds among GPU-eligible: {}",
        count(|f| f.cap_binds && f.persistent && !f.follows_parent)
    );
    println!(
        "  sub-frame cadence (< {RETAIL_FRAME_SECONDS:.4}s, cadence divergence observable): {}",
        count(|f| f.sub_frame_cadence)
    );
    println!(
        "  zero birthrate: {}",
        count(|f| f.alive_window_bound.is_none())
    );

    let mut bounds: Vec<u32> = interval
        .iter()
        .filter(|f| f.persistent && !f.follows_parent)
        .filter_map(|f| f.alive_window_bound)
        .collect();
    bounds.sort_unstable();
    if !bounds.is_empty() {
        let pct = |p: f64| bounds[((bounds.len() - 1) as f64 * p) as usize];
        println!("\nalive-window bound per GPU-eligible emitter (instances):");
        println!(
            "  min {} / p50 {} / p90 {} / p99 {} / max {}",
            bounds[0],
            pct(0.5),
            pct(0.9),
            pct(0.99),
            bounds[bounds.len() - 1]
        );
        let total_instances: u64 = bounds.iter().map(|&b| u64::from(b)).sum();
        println!("  sum over all eligible emitters: {total_instances}");
    }

    let mut caps: Vec<i32> = interval.iter().map(|f| f.max_particles).collect();
    caps.sort_unstable();
    if !caps.is_empty() {
        let pct = |p: f64| caps[((caps.len() - 1) as f64 * p) as usize];
        println!(
            "\nmax_particles: min {} / p50 {} / p90 {} / p99 {} / max {}",
            caps[0],
            pct(0.5),
            pct(0.9),
            pct(0.99),
            caps[caps.len() - 1]
        );
        let total: i64 = caps.iter().map(|&c| i64::from(c)).sum();
        println!("  sum over interval-driven emitters: {total}");
    }

    let mut birthrates: Vec<f64> = interval
        .iter()
        .filter(|f| f.birthrate > 0.0)
        .map(|f| f.birthrate)
        .collect();
    birthrates.sort_unstable_by(f64::total_cmp);
    if !birthrates.is_empty() {
        let pct = |p: f64| birthrates[((birthrates.len() - 1) as f64 * p) as usize];
        println!(
            "\nbirthrate seconds: min {:.4} / p50 {:.3} / p90 {:.3} / max {:.1}",
            birthrates[0],
            pct(0.5),
            pct(0.9),
            birthrates[birthrates.len() - 1]
        );
    }
    Ok(())
}
