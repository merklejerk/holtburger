//! Measures bounded precise-jump prediction against canonical collision content.

use std::hint::black_box;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::{ContentDecodeCache, ContentRepository};
use holtburger_core::{
    CharacterJumpReadiness, ContentAssetService, PreciseJumpCandidateBudget,
    PreciseJumpPredictionBudget, PreciseJumpPredictionRequest, PreciseJumpTarget,
    PreciseJumpWorldDisplacement, diagnose_precise_jump, generate_precise_jump_candidates,
    retail_player_grounded_profile,
};
use holtburger_protocol::messages::movement::MotionStance;
use holtburger_world::state::{
    PlayerMotionTableSource, SelfJumpCapabilities, SelfMovementCapabilities, SelfMovementKinematics,
};
use holtburger_world::{
    CollisionScene, ContactState, EdgeProtection, GroundState, GroundSupport,
    PhysicalBodyDefinition, PhysicalBodyResponseState, PhysicalBodyState, PhysicalCollisionFilter,
    SpatialBody, SpatialScene, StaticSurfaceRayRequest,
};

const SIMULATION_INTEREST_RADIUS: i32 = 2;

#[derive(Debug, Parser)]
#[command(about = "Benchmark static precise-jump prediction against canonical content")]
struct Args {
    /// Normalized outdoor owner containing the benchmark start.
    #[arg(long, default_value = "0xda55ffff", value_parser = parse_did)]
    landblock: u32,
    /// Optional HBA file or directory; normal content discovery is used when omitted.
    #[arg(long)]
    content: Option<PathBuf>,
    /// Body-reference start coordinates formatted as X,Y,Z.
    #[arg(long, value_parser = parse_vector3)]
    start: Vector3,
    /// Cursor sample formatted as X,Y,Z; the target ray begins five meters above it.
    #[arg(long, value_parser = parse_vector3)]
    target: Vector3,
    /// Retained starting EnvCell; omit for an outdoor benchmark.
    #[arg(long, value_parser = parse_did)]
    cell: Option<u32>,
    /// Timed predictor evaluations after one untimed warmup.
    #[arg(long, default_value_t = 10_000)]
    iterations: usize,
    /// Maximum analytic arcs evaluated per target.
    #[arg(long, default_value_t = 6)]
    candidates: usize,
    /// Maximum ordinary 30 Hz body ticks evaluated per candidate.
    #[arg(long, default_value_t = 160)]
    ticks: usize,
}

fn main() -> Result<()> {
    let args = Args::parse();
    ensure!(
        args.landblock & 0xffff == 0xffff,
        "landblock must be an outdoor owner DID"
    );
    ensure!(args.iterations > 0, "iterations must be positive");
    let owner = Guid(args.landblock);
    let cell = args.cell.map(Guid);
    if let Some(cell) = cell {
        ensure!(
            cell.0 & 0xffff_0000 == owner.0 & 0xffff_0000,
            "EnvCell must belong to the selected landblock"
        );
    }

    let repository =
        Arc::new(ContentRepository::discover(args.content).context("content discovery failed")?);
    let service =
        ContentAssetService::new(Arc::clone(&repository), Arc::new(ContentDecodeCache::new()));
    let landblock = service
        .load_landblock(owner.0)?
        .with_context(|| format!("CellLandblock 0x{:08X} is absent", owner.0))?;
    let center_collision = service.resolve_collision(&landblock)?;
    let center_colliders = center_collision.static_geometry.colliders.len();
    let center_cells = center_collision.static_geometry.cell_volumes().len();
    let mut collision = CollisionScene::new();
    insert_simulation_interest_neighborhood(&service, center_collision, &mut collision)?;

    let target_hit = collision
        .cast_static_surface_ray(StaticSurfaceRayRequest {
            anchor: owner,
            start: args.target + Vector3::new(0.0, 0.0, 5.0),
            direction: Vector3::new(0.0, 0.0, -1.0),
            maximum_distance: 10.0,
            previous_cell: cell,
            filter: PhysicalCollisionFilter::ALL,
        })?
        .context("target ray reached no authored static surface")?;
    let target = PreciseJumpTarget::new(
        owner,
        holtburger_world::CollisionSurfaceRayHit::Environment(target_hit),
    )?;
    let now = Instant::now();
    let (scene, body_id) = player_scene(&collision, owner, cell, args.start, now)?;
    let capabilities = representative_capabilities();
    let budget = PreciseJumpPredictionBudget::new(
        PreciseJumpCandidateBudget::new(args.candidates)?,
        args.ticks,
    )?;
    let profile = retail_player_grounded_profile(EdgeProtection::None)?;
    let PhysicalBodyDefinition::Grounded { spheres, .. } = profile.definition else {
        unreachable!("retail player profile must be grounded")
    };
    let desired_body_point = target.hit().point() + target.hit().normal() * spheres.support.radius
        - Quaternion::from_heading(0.0).rotate_vector(spheres.support.center);
    let displacement = PreciseJumpWorldDisplacement::new(desired_body_point - args.start)?;
    let analytic_timer = Instant::now();
    for _ in 0..args.iterations {
        black_box(generate_precise_jump_candidates(
            &capabilities,
            profile.definition,
            0.0,
            CharacterJumpReadiness::Supported,
            black_box(displacement),
            budget.candidate_budget(),
        )?);
    }
    let analytic_elapsed = analytic_timer.elapsed();
    let entity_collision = scene.entity_collision_snapshot()?;
    let request = PreciseJumpPredictionRequest {
        spatial_scene: &scene,
        collision_scene: &collision,
        entity_collision: &entity_collision,
        body_id,
        capabilities: &capabilities,
        target: &target,
        budget,
        start_time: now,
    };
    let warmup = diagnose_precise_jump(request)?;
    let timer = Instant::now();
    for _ in 0..args.iterations {
        black_box(diagnose_precise_jump(black_box(request))?);
    }
    let elapsed = timer.elapsed();
    let diagnostics = warmup.diagnostics();
    println!(
        "precise_jump_benchmark owner=0x{:08X} cell={} center_colliders={center_colliders} center_env_cells={center_cells}",
        owner.0,
        cell.map_or_else(
            || "outdoor".to_owned(),
            |value| format!("0x{:08X}", value.0)
        ),
    );
    println!(
        "target point={:?} normal={:?} placement={:?}",
        target.hit().point(),
        target.hit().normal(),
        target.hit().placement(),
    );
    println!(
        "outcome={:?} generated_candidates={} evaluated_candidates={} solver_ticks={}",
        warmup.outcome(),
        diagnostics.generated_candidates(),
        diagnostics.evaluated_candidates(),
        diagnostics.solver_ticks(),
    );
    println!(
        "timing iterations={} analytic_mean_ns={:.1} prediction_total_ms={:.3} prediction_mean_us={:.3} evaluations_per_30hz_tick={:.1}",
        args.iterations,
        analytic_elapsed.as_secs_f64() * 1_000_000_000.0 / args.iterations as f64,
        elapsed.as_secs_f64() * 1_000.0,
        elapsed.as_secs_f64() * 1_000_000.0 / args.iterations as f64,
        (1.0 / 30.0) / (elapsed.as_secs_f64() / args.iterations as f64),
    );
    Ok(())
}

fn player_scene(
    collision: &CollisionScene,
    owner: Guid,
    cell: Option<Guid>,
    coords: Vector3,
    now: Instant,
) -> Result<(SpatialScene, holtburger_world::SpatialBodyId)> {
    let profile = retail_player_grounded_profile(EdgeProtection::None)?;
    let mut scene = SpatialScene::new();
    let body_id = scene.allocate_ephemeral_body_id();
    let mut body = SpatialBody::new_ephemeral(
        body_id,
        WorldPosition {
            landblock_id: cell.unwrap_or(owner),
            coords,
            rotation: Quaternion::from_heading(0.0),
        },
        now,
    );
    body.contact = ContactState::Grounded;
    body.physical = Some(PhysicalBodyState::new(
        profile.definition,
        PhysicalCollisionFilter::ALL,
        profile.response_policy,
        cell,
    ));
    let PhysicalBodyDefinition::Grounded { .. } = profile.definition else {
        unreachable!("retail player profile must be grounded")
    };
    let PhysicalBodyResponseState::Grounded { ground, .. } = &mut body
        .physical
        .as_mut()
        .expect("installed physical body")
        .response
    else {
        unreachable!("grounded definition must own grounded response")
    };
    *ground = GroundState::Supported(GroundSupport {
        normal: Vector3::new(0.0, 0.0, 1.0),
        proof: collision
            .owner_proof(owner)
            .context("benchmark owner has no collision proof")?,
    });
    scene.register_body(body);
    Ok((scene, body_id))
}

fn representative_capabilities() -> SelfJumpCapabilities {
    SelfJumpCapabilities {
        movement: SelfMovementCapabilities {
            kinematics: SelfMovementKinematics {
                source: PlayerMotionTableSource::DirectProperty {
                    motion_table_id: 0x0900_0020,
                },
                motion_table_id: 0x0900_0020,
                stance: MotionStance::NonCombat as u32,
                base_walk_forward_velocity: Vector3::new(3.12, 0.0, 0.0),
                base_run_forward_velocity: Vector3::new(4.0, 0.0, 0.0),
                base_turn_left_omega: Vector3::new(0.0, 0.0, -1.0),
                base_turn_right_omega: Vector3::new(0.0, 0.0, 1.0),
            },
            run_rate_scalar: 1.0,
        },
        full_extent_jump_height: 4.2125,
        burden: 0.0,
    }
}

fn insert_simulation_interest_neighborhood(
    service: &ContentAssetService,
    center_asset: holtburger_content::LandblockCollisionAsset,
    scene: &mut CollisionScene,
) -> Result<()> {
    let center = center_asset.landblock_id;
    let center_x = ((center >> 24) & 0xff) as i32;
    let center_y = ((center >> 16) & 0xff) as i32;
    let mut insertions = vec![center_asset];
    for offset_x in -SIMULATION_INTEREST_RADIUS..=SIMULATION_INTEREST_RADIUS {
        for offset_y in -SIMULATION_INTEREST_RADIUS..=SIMULATION_INTEREST_RADIUS {
            if offset_x == 0 && offset_y == 0 {
                continue;
            }
            let x = center_x + offset_x;
            let y = center_y + offset_y;
            if !(0..=255).contains(&x) || !(0..=255).contains(&y) {
                continue;
            }
            let neighbor = ((x as u32) << 24) | ((y as u32) << 16) | 0xffff;
            let Some(landblock) = service.load_landblock(neighbor)? else {
                continue;
            };
            insertions.push(service.resolve_collision(&landblock)?);
        }
    }
    scene.apply_residency_change(insertions, &[])?;
    Ok(())
}

fn parse_vector3(value: &str) -> std::result::Result<Vector3, String> {
    let components = value
        .split(',')
        .map(str::trim)
        .map(str::parse::<f32>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let [x, y, z] = components.as_slice() else {
        return Err("expected X,Y,Z".to_owned());
    };
    if !x.is_finite() || !y.is_finite() || !z.is_finite() {
        return Err("coordinates must be finite".to_owned());
    }
    Ok(Vector3::new(*x, *y, *z))
}

fn parse_did(value: &str) -> std::result::Result<u32, String> {
    let value = value.trim();
    u32::from_str_radix(value.strip_prefix("0x").unwrap_or(value), 16)
        .map_err(|error| error.to_string())
}
