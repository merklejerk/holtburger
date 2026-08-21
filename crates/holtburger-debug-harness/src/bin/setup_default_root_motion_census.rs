//! Which catalog templates play a setup-default animation carrying root frames, and can any of
//! them collide?
//!
//! The `RETAIL DIVERGENCE` on unapplied position frames justifies itself by saying a correction
//! "would route frontend animation back into collision authority". That is only true for an entity
//! whose root a solver actually owns. This sizes the population and reports each carrier's
//! collision participation, so the justification can be checked rather than assumed.

use anyhow::{Context, Result};
use clap::Parser;
use holtburger_common::properties::PhysicsState;
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{Animation, SetupModel};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_weenie_catalog::{WeenieCatalog, WeenieTemplate};
use holtburger_world::{EntityCollisionParticipation, resolve_effective_entity_physics_state};
use std::collections::HashMap;
use std::io::Cursor;

#[derive(Parser)]
#[command(about = "Census setup-default animations that carry root motion, by collidability")]
struct Args {
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: std::path::PathBuf,
    #[arg(long)]
    content: Option<std::path::PathBuf>,
}

/// What a setup-default animation's position frames actually author.
#[derive(Clone, Copy, PartialEq)]
struct RootFrameFacts {
    max_translation: f32,
    max_tilt: f32,
    max_yaw: f32,
}

impl RootFrameFacts {
    fn is_inert(self) -> bool {
        self.max_translation == 0.0 && self.max_tilt == 0.0 && self.max_yaw == 0.0
    }
}

/// Effective semantic mask, applying the property-bool overrides over the base bits.
fn semantic_mask(template: &WeenieTemplate) -> PhysicsState {
    let mut bits = template.physics.base_mask.unwrap_or(0);
    let mut apply = |flag: PhysicsState, value: Option<bool>| {
        if let Some(value) = value {
            if value {
                bits |= flag.bits();
            } else {
                bits &= !flag.bits();
            }
        }
    };
    let overrides = &template.physics.overrides;
    apply(PhysicsState::ETHEREAL, overrides.ethereal);
    apply(PhysicsState::IGNORE_COLLISIONS, overrides.ignore_collisions);
    apply(PhysicsState::REPORT_COLLISIONS, overrides.report_collisions);
    apply(PhysicsState::NO_DRAW, overrides.no_draw);
    apply(PhysicsState::GRAVITY, overrides.gravity);
    PhysicsState::from_bits_truncate(bits)
}

fn main() -> Result<()> {
    let args = Args::parse();
    let catalog = WeenieCatalog::open(&args.catalog).context("catalog open failed")?;
    let content = ContentRepository::discover(args.content).context("content discovery failed")?;
    let read = |id: u32| -> Result<Vec<u8>> {
        Ok(content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, id))
            .with_context(|| format!("read 0x{id:08X}"))?
            .bytes)
    };

    // Setup and animation reads are shared: thousands of templates reuse a few hundred setups.
    let mut setup_defaults: HashMap<u32, Option<u32>> = HashMap::new();
    let mut animation_facts: HashMap<u32, Option<RootFrameFacts>> = HashMap::new();

    let mut carriers = 0usize;
    let mut inert_carriers = 0usize;
    let mut by_participation: HashMap<&'static str, usize> = HashMap::new();
    let mut solid_examples: Vec<String> = Vec::new();

    let wcids: Vec<u32> = catalog.records().map(|record| record.wcid).collect();
    let total = wcids.len();
    for wcid in wcids {
        let Some(template) = catalog.lookup(wcid)? else {
            continue;
        };
        // A template naming its own motion table never reaches the setup default.
        if template.motion_table_did.is_some() {
            continue;
        }
        let Some(setup_did) = template.setup_did else {
            continue;
        };

        let default_animation = match setup_defaults.get(&setup_did) {
            Some(cached) => *cached,
            None => {
                let resolved = match read(setup_did) {
                    Ok(bytes) => {
                        SetupModel::read(&mut Cursor::new(&bytes))
                            .ok()
                            .and_then(|setup| {
                                // A setup naming a default motion table also never reaches the
                                // bare-animation path.
                                if setup.default_motion_table.is_some() {
                                    None
                                } else {
                                    setup.default_animation
                                }
                            })
                    }
                    Err(_) => None,
                };
                setup_defaults.insert(setup_did, resolved);
                resolved
            }
        };
        let Some(animation_id) = default_animation else {
            continue;
        };

        let facts = match animation_facts.get(&animation_id) {
            Some(cached) => *cached,
            None => {
                let resolved = read(animation_id)
                    .ok()
                    .and_then(|bytes| Animation::read(&mut Cursor::new(&bytes)).ok())
                    .filter(|animation| !animation.pos_frames.is_empty())
                    .map(|animation| {
                        let mut facts = RootFrameFacts {
                            max_translation: 0.0,
                            max_tilt: 0.0,
                            max_yaw: 0.0,
                        };
                        for frame in &animation.pos_frames {
                            facts.max_translation =
                                facts.max_translation.max(frame.origin.length());
                            let q = frame.orientation;
                            facts.max_tilt = facts.max_tilt.max(q.x.abs().max(q.y.abs()));
                            facts.max_yaw = facts.max_yaw.max(q.z.abs());
                        }
                        facts
                    });
                animation_facts.insert(animation_id, resolved);
                resolved
            }
        };
        let Some(facts) = facts else {
            continue;
        };

        carriers += 1;
        if facts.is_inert() {
            inert_carriers += 1;
            continue;
        }

        let resolved = resolve_effective_entity_physics_state(semantic_mask(&template));
        let label = match resolved.dynamic_collision.target {
            EntityCollisionParticipation::Solid => "SOLID",
            EntityCollisionParticipation::Ethereal => "ethereal",
            EntityCollisionParticipation::Suppressed => "suppressed",
        };
        *by_participation.entry(label).or_default() += 1;
        if label == "SOLID" && solid_examples.len() < 20 {
            solid_examples.push(format!(
                "  wcid {wcid:>6}  anim 0x{animation_id:08X}  \
                 translation {:.4}  tilt {:.4}  yaw {:.4}  {:?}",
                facts.max_translation, facts.max_tilt, facts.max_yaw, template.name
            ));
        }
    }

    println!("catalog templates scanned:            {total}");
    println!("carrying setup-default root frames:   {carriers}");
    println!("  of those, entirely inert (no-ops):  {inert_carriers}");
    println!(
        "  of those, authoring real motion:    {}",
        carriers - inert_carriers
    );
    println!();
    println!("real carriers by collision participation:");
    let mut labels: Vec<_> = by_participation.into_iter().collect();
    labels.sort_unstable();
    for (label, count) in labels {
        println!("  {label:<12} {count}");
    }
    // The catalog covers spawnable weenies. Authored scenery placed in landblocks reaches setup
    // defaults too and is a separate population, so size every setup in the archive as well.
    let index: Vec<_> = content
        .resource_index()
        .iter()
        .filter(|entry| entry.namespace == EOR_PORTAL_NAMESPACE && entry.type_id == 0x02)
        .cloned()
        .collect();
    let mut archive_setups = 0usize;
    let mut archive_with_default_anim = 0usize;
    let mut archive_carriers: Vec<(u32, u32, RootFrameFacts)> = Vec::new();
    for entry in &index {
        archive_setups += 1;
        let Ok(bytes) = read(entry.file_id) else {
            continue;
        };
        let Ok(setup) = SetupModel::read(&mut Cursor::new(&bytes)) else {
            continue;
        };
        if setup.default_motion_table.is_some() {
            continue;
        }
        let Some(animation_id) = setup.default_animation else {
            continue;
        };
        archive_with_default_anim += 1;
        let facts = match animation_facts.get(&animation_id) {
            Some(cached) => *cached,
            None => {
                let resolved = read(animation_id)
                    .ok()
                    .and_then(|bytes| Animation::read(&mut Cursor::new(&bytes)).ok())
                    .filter(|animation| !animation.pos_frames.is_empty())
                    .map(|animation| {
                        let mut facts = RootFrameFacts {
                            max_translation: 0.0,
                            max_tilt: 0.0,
                            max_yaw: 0.0,
                        };
                        for frame in &animation.pos_frames {
                            facts.max_translation =
                                facts.max_translation.max(frame.origin.length());
                            let q = frame.orientation;
                            facts.max_tilt = facts.max_tilt.max(q.x.abs().max(q.y.abs()));
                            facts.max_yaw = facts.max_yaw.max(q.z.abs());
                        }
                        facts
                    });
                animation_facts.insert(animation_id, resolved);
                resolved
            }
        };
        if let Some(facts) = facts.filter(|facts| !facts.is_inert()) {
            archive_carriers.push((entry.file_id, animation_id, facts));
        }
    }
    println!();
    println!("every setup in the archive, not just catalog-reachable:");
    println!("  setups                              {archive_setups}");
    println!("  declaring a bare default animation  {archive_with_default_anim}");
    println!(
        "  whose animation authors root motion {}",
        archive_carriers.len()
    );
    for (setup_id, animation_id, facts) in archive_carriers.iter().take(20) {
        println!(
            "    setup 0x{setup_id:08X}  anim 0x{animation_id:08X}               translation {:.4}  tilt {:.4}  yaw {:.4}",
            facts.max_translation, facts.max_tilt, facts.max_yaw
        );
    }

    if !solid_examples.is_empty() {
        println!();
        println!("collidable carriers (the case the divergence's justification describes):");
        for line in &solid_examples {
            println!("{line}");
        }
    }
    Ok(())
}
