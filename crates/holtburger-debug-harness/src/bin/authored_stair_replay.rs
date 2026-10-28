//! Replay actual standard-character walk/run root tracks over the reported authored stairs.
//! Tests phase-dependent source motion through the client input boundary without logging in.

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_common::{Guid, Quaternion, Vector3, position::WorldPosition};
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_core::{ContentAssetService, retail_player_grounded_profile};
use holtburger_debug_harness::movement_probe::{
    ProbeBodyView, advance_probe_body, advance_probe_input, body_with_profile,
    collision_neighborhood,
};
use holtburger_world::motion::{
    MotionCommand, MotionSequenceRuntime, MotionState, select_motion, set_default_state,
};
use holtburger_world::{
    CollisionScene, EdgeProtection, GroundedBodyActuation, MOBILE_CONTACT_TICK_SECONDS,
    PhysicalBodyActuation, PhysicalBodyInput, PhysicalReferenceInput, gate_authored_offset,
};
use serde_json::json;
use std::sync::Arc;

const OWNER: u32 = 0x356fffff;
const TABLE: u32 = 0x09000001;

#[derive(Parser)]
struct Args {
    /// Number of starting fixed-tick phases per gait.
    #[arg(long, default_value_t = 36)]
    phases: usize,
    /// Driven fixed ticks after support preparation.
    #[arg(long, default_value_t = 240)]
    ticks: usize,
}

fn main() -> Result<()> {
    let args = Args::parse();
    ensure!(
        args.phases > 0 && args.ticks > 0,
        "phase and tick counts must be positive"
    );
    let repository = Arc::new(ContentRepository::discover(None)?);
    let service =
        ContentAssetService::new(Arc::clone(&repository), Arc::new(ContentDecodeCache::new()));
    let center = service
        .load_landblock(OWNER)?
        .context("reported owner is absent")?;
    let neighborhood = collision_neighborhood(&service, service.resolve_collision(&center)?, 2)?;
    let mut scene = CollisionScene::new();
    for asset in neighborhood.assets {
        scene.insert(asset)?;
    }
    let catalog = repository.read_motion_reference_data()?.motion_sequences;
    let table = catalog
        .table(TABLE)
        .context("standard character table is absent")?;
    println!(
        "{}",
        json!({"record":"workload","owner":OWNER,"motion_table":TABLE,"phases":args.phases,"ticks":args.ticks,
        "unavailable_owners":neighborhood.unavailable_owners,"scope":"actual authored standard walk and rate-one run through local-player input; no network or peer entities"})
    );
    for (name, command) in [
        ("walk", MotionCommand::WALK_FORWARD),
        ("run", MotionCommand::RUN_FORWARD),
    ] {
        let mut state = MotionState::default();
        let mut selected = MotionSequenceRuntime::new();
        ensure!(
            set_default_state(table, &mut state, &mut selected).is_modelled(),
            "default state is unmodelled"
        );
        ensure!(
            select_motion(table, &mut state, &mut selected, command, 1.0).is_modelled(),
            "gait is unmodelled"
        );
        for phase in 0..args.phases {
            let mut sequence = selected.clone();
            sequence.advance(phase as f32 * MOBILE_CONTACT_TICK_SECONDS);
            let profile = retail_player_grounded_profile(EdgeProtection::Creature)?;
            let start = WorldPosition::from_outdoor_frame(
                Guid(OWNER),
                Vector3::new(155.999_02, 69.771_065, 36.361557),
                Quaternion::identity(),
            );
            let mut body = body_with_profile(start, profile, None)?;
            for _ in 0..10 {
                body = advance_probe_body(
                    &scene,
                    body,
                    PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                )?
                .body;
            }
            let mut maximum_source_speed = 0.0_f32;
            let mut crossed = false;
            for _ in 0..args.ticks {
                let source = sequence.advance(MOBILE_CONTACT_TICK_SECONDS).offset;
                maximum_source_speed = maximum_source_speed
                    .max(source.translation.length() / MOBILE_CONTACT_TICK_SECONDS);
                let source = gate_authored_offset(source, body.contact, 1.0);
                let input = PhysicalBodyInput::referenced(
                    PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                    PhysicalReferenceInput::body(Some(source)),
                    false,
                );
                body = advance_probe_input(&scene, body, input)?.body;
                crossed |= body.pose.coords.y > 74.0 && body.pose.coords.z > 38.4;
            }
            println!(
                "{}",
                json!({"record":"route","gait":name,"phase":phase,"maximum_source_speed":maximum_source_speed,
                "crossed":crossed,"final_pose":body.pose,"cell":body.cell(),"support_normal":body.ground().walkable_support().map(|s|s.normal),"retained_velocity":body.retained.velocity})
            );
        }
    }
    Ok(())
}
