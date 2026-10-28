//! Exercise production local playback against every mounted table and export native pose levels.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_common::Guid;
use holtburger_common::properties::{PropertyDataId, WorldObjectPropertyAccessorsMut};
use holtburger_content::{ContentRepository, SoulEmoteCatalog};
use holtburger_core::DynamicEntityMotion;
use holtburger_weenie_catalog::WeenieCatalog;
use holtburger_world::entity::Entity;
use holtburger_world::motion::{
    AuthoredCollisionPose, CharacterMotionPresentation, MotionCommand, MotionOrder,
};
use holtburger_world::{WorldBootstrap, WorldState};
use serde::Serialize;

const REPORTED_TABLE: u32 = 0x0900_000C;

#[derive(Parser)]
struct Args {
    /// Mounted retail DAT or HBA content directory.
    #[arg(long)]
    content: Option<PathBuf>,
    /// Offline template catalog used to find a matching browser model.
    #[arg(long, default_value = "dats/weenies.hwc")]
    catalog: PathBuf,
    /// Optional MessagePack levels for the browser harness's motion-playback fixture.
    #[arg(long)]
    output: Option<PathBuf>,
}

/// Native motion levels applied to a catalog-backed model, including delayed realization.
#[derive(Serialize)]
struct Sample {
    /// Scenario label for the browser evidence artifacts.
    label: &'static str,
    /// Production-world entity identity applied to the catalog-backed model.
    guid: u32,
    /// Native-only projection produced by the world motion owner.
    motion: DynamicEntityMotion,
    /// Time allowed for the browser's presentation cursor to advance.
    wait_ms: u32,
    /// Re-realize the model to exercise delayed presentation initialization.
    fresh: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let content = ContentRepository::discover(args.content)?;
    let motion_reference = content.read_motion_reference_data()?;
    let motions = Arc::new(motion_reference.motion_sequences);
    let bootstrap = WorldBootstrap {
        weenie_types: None,
        skill_table: Arc::new(content.read_asset("skills")?),
        secondary_attribute_table: Arc::new(content.read_asset("secondary attributes")?),
        spell_table: Arc::new(content.read_asset("spells")?),
        xp_table: Arc::new(content.read_asset("xp")?),
        character_titles: Arc::new(content.read_character_title_catalog()?),
        contracts: Arc::new(content.read_contract_catalog()?),
        motion_sequences: Arc::clone(&motions),
        setup_dimensions: Arc::new(motion_reference.setup_dimensions),
        soul_emote_catalog: Arc::new(SoulEmoteCatalog::default()),
    };
    let mut world = WorldState::new(Arc::new(bootstrap));
    let guid = Guid(0x7000_0001);
    world.player.guid = guid;
    world.entities.insert(Entity::new(
        guid,
        "Playback probe".into(),
        Default::default(),
    ));
    let mut ids: Vec<_> = motions.tables().map(|table| table.id).collect();
    ids.sort_unstable();
    let mut intervals = 0;
    let mut samples = Vec::new();
    for id in &ids {
        let table = motions.table(*id).context("enumerated table disappeared")?;
        let native_animations: BTreeSet<_> = table.reachable_animation_ids().collect();
        world
            .player_entity_mut()
            .context("probe player disappeared")?
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(*id));
        let inputs = [
            (
                "native-run",
                MotionOrder {
                    forward: Some((MotionCommand::RUN_FORWARD, 1.0)),
                    ..MotionOrder::default()
                },
                CharacterMotionPresentation::Grounded,
            ),
            (
                "walk-turn",
                MotionOrder {
                    forward: Some((MotionCommand::WALK_FORWARD, 1.0)),
                    turn: Some((MotionCommand::TURN, 1.0)),
                    ..MotionOrder::default()
                },
                CharacterMotionPresentation::Grounded,
            ),
            (
                "reverse-strafe",
                MotionOrder {
                    forward: Some((MotionCommand::WALK_FORWARD, -0.65)),
                    sidestep: Some((MotionCommand::SIDESTEP, 1.0)),
                    ..MotionOrder::default()
                },
                CharacterMotionPresentation::Grounded,
            ),
            (
                "falling",
                MotionOrder::default(),
                CharacterMotionPresentation::Falling,
            ),
            (
                "standing-charge",
                MotionOrder::default(),
                CharacterMotionPresentation::Ready,
            ),
            (
                "stopped",
                MotionOrder::default(),
                CharacterMotionPresentation::Grounded,
            ),
        ];
        for (label, order, presentation) in inputs {
            for elapsed in [
                Duration::ZERO,
                Duration::from_millis(30),
                Duration::from_millis(30),
            ] {
                let tick =
                    world.drive_manual_motion_for_body(guid, order, presentation, elapsed)?;
                ensure!(
                    tick.offset.translation.length_squared().is_finite(),
                    "table 0x{id:08X} produced nonfinite movement"
                );
                ensure!(
                    tick.hooks
                        .iter()
                        .all(|hook| native_animations.contains(&hook.animation_id)),
                    "table 0x{id:08X} executed a non-native hook"
                );
                let runtime = world
                    .motion_runtimes
                    .get(guid)
                    .context("local playback was not installed")?;
                if let Some(playback) = runtime.motion_playback() {
                    for layer in [playback.ordinary, playback.locomotion]
                        .into_iter()
                        .flatten()
                    {
                        ensure!(
                            native_animations.contains(&layer.clip.animation_id()),
                            "table 0x{id:08X} published a non-native animation"
                        );
                    }
                }
                if let AuthoredCollisionPose::Animation { animation_id, .. } =
                    runtime.collision_pose()
                {
                    ensure!(
                        native_animations.contains(&animation_id),
                        "table 0x{id:08X} published a non-native collision pose"
                    );
                }
                intervals += 1;
            }
            if *id == REPORTED_TABLE
                && let Some(playback) = world.motion_runtimes.motion_playback(guid)
            {
                samples.push(Sample {
                    label,
                    guid: guid.0,
                    motion: playback.into(),
                    wait_ms: 150,
                    fresh: label == "falling",
                });
            }
        }
        world.motion_runtimes.forget(guid);
    }
    println!(
        "{} tables, {intervals} local intervals: finite movement, native-only hooks and poses",
        ids.len()
    );
    if let Some(path) = args.output {
        ensure!(
            !samples.is_empty(),
            "reported body produced no browser levels"
        );
        let catalog = WeenieCatalog::open(args.catalog)?;
        let mut matching = None;
        for record in catalog.records() {
            let template = catalog
                .lookup(record.wcid)?
                .context("catalog record disappeared")?;
            if template.motion_table_did == Some(REPORTED_TABLE) {
                matching = Some((template.wcid, template.name));
                break;
            }
        }
        let (wcid, name) = matching.context("no catalog model uses the reported table")?;
        std::fs::write(&path, rmp_serde::to_vec_named(&samples)?)?;
        println!(
            "browser fixture: {} levels, --spawn-wcid {wcid}, {name:?}, {}",
            samples.len(),
            path.display()
        );
    }
    Ok(())
}
