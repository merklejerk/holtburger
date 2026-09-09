//! Repeated asset-free crowd workloads with packet arrivals and actual solver-work counters.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::{
    ColliderScale, CollisionCylinder, CollisionShape, LandblockColliders, LandblockCollisionAsset,
    LandblockTerrain, TerrainCellDiagonals, TerrainCollisionSurface,
};
use holtburger_core::retail_player_grounded_profile;
use holtburger_world::{
    AuthoritativeBodyVectors, AuthoritativePoseEffect, CollisionScene, ContactState,
    DynamicBodyCollisionDefinition, DynamicPhysicalBodyConfiguration,
    DynamicPhysicalBodyDefinition, EdgeProtection, EntityCollisionParticipation,
    EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, GroundedBodyActuation,
    LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand, PhysicalBodyActuation,
    PhysicalCollisionFilter, PhysicalElasticity, PreparedEntityTargetGeometry, SpatialBody,
    SpatialBodyId, SpatialScene, take_physics_work,
};

const OWNER: u32 = 0xda55_ffff;
const DT: f32 = 1.0 / 30.0;
const SPACING: f32 = 1.05;
const CONTACT_DISTANCE: f32 = 0.48 + 0.5;

#[derive(Parser)]
struct Args {
    /// Remote body count; each run also includes one player.
    #[arg(long, default_value_t = 100)]
    bodies: usize,
    /// Fixed 30 Hz ticks in each identical workload.
    #[arg(long, default_value_t = 180)]
    ticks: usize,
    /// Timed repetitions after one untimed warmup.
    #[arg(long, default_value_t = 5)]
    repeats: usize,
}

/// Work totals plus observed body progress; timing excludes fixture setup and overlap auditing.
#[derive(Default)]
struct Measurements {
    elapsed_ns: u128,
    maximum_tick_ns: u128,
    body_preparations: u64,
    /// Actual geometry steps performed by admitted contact collections.
    environment_steps: u64,
    shape_queries: u64,
    stationary_bodies: usize,
    /// Sum of per-body net root displacement magnitudes, including positional correction.
    accepted_displacement_m: f64,
    /// Source progress is separate so remote motion cannot hide a stationary player.
    player_displacement_m: f64,
    maximum_penetration: f32,
}

fn main() -> Result<()> {
    let args = Args::parse();
    ensure!(
        (1..=400).contains(&args.bodies),
        "body count must be 1..=400"
    );
    ensure!(
        args.ticks > 0 && args.repeats > 0,
        "ticks and repeats must be positive"
    );
    let collision = collision_scene()?;
    let (initial, authority, player_id) = crowd(&collision, args.bodies)?;
    let _ = run(
        &args,
        &collision,
        initial.clone(),
        authority.clone(),
        player_id,
    )?;
    println!(
        "bodies,ticks,run,total_ms,mean_tick_ms,max_tick_ms,body_preparations,environment_steps,shape_queries,stationary_bodies,accepted_displacement_m,player_displacement_m,max_penetration_m"
    );
    for repeat in 1..=args.repeats {
        let result = run(
            &args,
            &collision,
            initial.clone(),
            authority.clone(),
            player_id,
        )?;
        println!(
            "{},{},{},{:.3},{:.3},{:.3},{},{},{},{},{:.6},{:.6},{:.6}",
            args.bodies + 1,
            args.ticks,
            repeat,
            result.elapsed_ns as f64 / 1e6,
            result.elapsed_ns as f64 / args.ticks as f64 / 1e6,
            result.maximum_tick_ns as f64 / 1e6,
            result.body_preparations,
            result.environment_steps,
            result.shape_queries,
            result.stationary_bodies,
            result.accepted_displacement_m,
            result.player_displacement_m,
            result.maximum_penetration
        );
    }
    Ok(())
}

fn collision_scene() -> Result<CollisionScene> {
    let mut scene = CollisionScene::new();
    scene.insert(LandblockCollisionAsset {
        landblock_id: OWNER,
        terrain: TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![0.0; 81],
            terrain_samples: vec![0; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(OWNER),
        })?,
        static_geometry: LandblockColliders::default(),
    })?;
    Ok(scene)
}

fn crowd(
    collision: &CollisionScene,
    count: usize,
) -> Result<(
    SpatialScene,
    BTreeMap<SpatialBodyId, WorldPosition>,
    SpatialBodyId,
)> {
    let now = Instant::now();
    let player_id = SpatialBodyId::LocalPlayer(Guid(1));
    let profile = retail_player_grounded_profile(EdgeProtection::Creature)?;
    let geometry = Arc::new(PreparedEntityTargetGeometry {
        setup_radius: 0.5,
        physics_bsp_parts: Vec::new(),
        fallback_setup_did: 0x0200_0001,
        fallback_shapes: vec![Arc::new(CollisionShape::Cylinder(CollisionCylinder {
            low_point: Vector3::zero(),
            radius: 0.5,
            height: 2.0,
        }))],
        fallback_scale: ColliderScale::uniform(1.0)?,
    });
    let configuration = DynamicPhysicalBodyConfiguration::new(
        DynamicPhysicalBodyDefinition {
            movement: profile.definition,
            response_policy: profile.response_policy,
            entity_collision: DynamicBodyCollisionDefinition {
                player_collision: None,
                contact_response: holtburger_world::EntityContactResponse::Character(
                    holtburger_world::EntityIntegrationEligibility::Eligible,
                ),
                target_geometry: geometry,
                dynamic_collision: EntityDynamicCollisionPolicy {
                    is_static: false,
                    target: EntityCollisionParticipation::Solid,
                    mover_accepts_response: true,
                    accepts_peer_reports: true,
                    missile: false,
                    path_clipped: false,
                },
                reporting: EntityCollisionReportPolicy {
                    enabled: true,
                    as_environment: false,
                },
                uses_physics_bsp: false,
                elasticity: PhysicalElasticity::DEFAULT,
                default_animation_available: false,
                default_script_available: false,
            },
        },
        LocalPhysicalDemand {
            target: LocalTargetDemand::Retained,
            integration: LocalIntegrationDemand::Eligible,
        },
    )?;
    let width = (count as f32).sqrt().ceil() as usize;
    let mut scene = SpatialScene::new();
    let mut authority = BTreeMap::new();
    for index in 0..=count {
        let (id, coords) = if index == 0 {
            (player_id, Vector3::new(90.0, 90.0 - SPACING, 0.005))
        } else {
            let slot = index - 1;
            (
                SpatialBodyId::Entity(Guid(index as u32 + 1)),
                Vector3::new(
                    90.0 + ((slot % width) as f32 - (width / 2) as f32) * SPACING,
                    90.0 + (slot / width) as f32 * SPACING,
                    0.005,
                ),
            )
        };
        let pose = WorldPosition {
            landblock_id: Guid(OWNER),
            coords,
            rotation: Quaternion::identity(),
        };
        scene.register_body(SpatialBody::new(id, pose, now));
        scene
            .set_dynamic_physical_body(
                id,
                Some(configuration.clone()),
                PhysicalCollisionFilter::ALL,
                None,
            )
            .context("fixture body disappeared during installation")?;
        for _ in 0..30 {
            scene.tick_physical_body(
                id,
                collision,
                holtburger_world::PhysicalBodyInput::autonomous(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast(),
                )),
                DT,
                now,
            )?;
            if scene.body(id).context("fixture body disappeared")?.contact == ContactState::Grounded
            {
                break;
            }
        }
        let body = scene.body(id).context("fixture body disappeared")?;
        ensure!(
            body.contact == ContactState::Grounded,
            "fixture failed to acquire support"
        );
        if id != player_id {
            authority.insert(id, body.pose);
        }
    }
    Ok((scene, authority, player_id))
}

fn remote_drive(id: SpatialBodyId, tick: usize) -> Vector3 {
    let direction = if (tick / 30
        + id.authoritative_guid()
            .expect("fixture entity has a guid")
            .0 as usize)
        .is_multiple_of(2)
    {
        1.0
    } else {
        -1.0
    };
    Vector3::new(0.25 * direction, 0.15, 0.0)
}

fn run(
    args: &Args,
    collision: &CollisionScene,
    mut scene: SpatialScene,
    mut authority: BTreeMap<SpatialBodyId, WorldPosition>,
    player_id: SpatialBodyId,
) -> Result<Measurements> {
    let origin = Instant::now();
    let mut measured = Measurements::default();
    let _ = take_physics_work();
    for tick in 0..args.ticks {
        let now = origin + Duration::from_secs_f32(tick as f32 * DT);
        let start = Instant::now();
        for (&id, pose) in &mut authority {
            pose.coords = pose.coords + remote_drive(id, tick) * DT;
            scene.wake_dynamic_body(id);
            if tick % 6 == 0 {
                scene.apply_authoritative_body_effect(
                    id,
                    AuthoritativePoseEffect::Interpolate {
                        pose: *pose,
                        keep_heading: true,
                        adjusted_max_speed_mps: None,
                    },
                    AuthoritativeBodyVectors {
                        velocity: Vector3::zero(),
                        acceleration: Vector3::zero(),
                        omega: Vector3::zero(),
                    },
                    now,
                );
            }
        }
        scene.wake_dynamic_body(player_id);
        let actuation = |body: &SpatialBody| -> Result<PhysicalBodyActuation> {
            let drive = if body.id == player_id {
                Vector3::new(0.0, if tick < args.ticks * 2 / 3 { 2.0 } else { -2.0 }, 0.0)
            } else {
                remote_drive(body.id, tick)
            };
            Ok(PhysicalBodyActuation::grounded_drive(drive)?)
        };
        let collection = scene
            .advance_dynamic_entity_collection(collision, DT, now, |body| {
                // This fixture authors all ordinary travel through the drive callback.
                Ok(holtburger_world::PhysicalBodyInput::referenced(
                    actuation(body)?,
                    holtburger_world::PhysicalReferenceInput::body(None),
                    true,
                ))
            })
            .with_context(|| format!("collection failed at tick {tick}"))?;
        ensure!(
            collection.coverage_rejections.is_empty(),
            "fixture left collision coverage"
        );
        for outcome in collection.outcomes {
            let holtburger_world::DynamicEntityBodyOutcome::Integrated(update) = outcome else {
                panic!("crowd benchmark unexpectedly repositioned a body")
            };
            let id = update.body_id;
            measured.stationary_bodies += usize::from(update.displacement == Vector3::zero());
            let displacement = f64::from(update.displacement.length());
            measured.accepted_displacement_m += displacement;
            if id == player_id {
                measured.player_displacement_m += displacement;
            }
        }
        let elapsed = start.elapsed().as_nanos();
        measured.elapsed_ns += elapsed;
        measured.maximum_tick_ns = measured.maximum_tick_ns.max(elapsed);
        let work = take_physics_work();
        measured.body_preparations += work.body_preparations;
        measured.environment_steps += work.environment_steps;
        measured.shape_queries += work.shape_queries;
        let bodies = scene.iter_runtime_body_views().collect::<Vec<_>>();
        for (index, left) in bodies.iter().enumerate() {
            for right in &bodies[index + 1..] {
                let delta = left.runtime_pose.coords - right.runtime_pose.coords;
                let penetration = CONTACT_DISTANCE - (delta.x * delta.x + delta.y * delta.y).sqrt();
                measured.maximum_penetration = measured.maximum_penetration.max(penetration);
            }
        }
    }
    Ok(measured)
}
