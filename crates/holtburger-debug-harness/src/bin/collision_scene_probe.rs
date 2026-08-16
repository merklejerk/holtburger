//! Exercises the canonical collision assembly path for one representative landblock.

use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use clap::{Parser, ValueEnum};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockInteriorSystemAsset, LandblockPortalEndpoint,
};
use holtburger_core::ContentAssetService;
use holtburger_dat::physics::BspNode;
use holtburger_world::{
    CellTransitRequest, CollisionPlacement, CollisionScene, EdgeProtection, GroundedBody,
    GroundedBodySpheres, GroundedConfig, GroundedObstructionRequest, GroundedOutcome,
    GroundedRequest, GroundedSphere, MotionWaypoint, MotionWaypointPlacement,
    PhysicalCollisionFilter, PhysicalFlyBody, PhysicalFlyConfig, PhysicalFlyOutcome,
    PhysicalFlyRequest, PlacedMotionPathRequest, PlacementRequest, RETAIL_WALKABLE_NORMAL_Z,
    SphereSweep, SupportRequest, solve_grounded, solve_physical_fly,
};

const HOST_TICK_SECONDS: f32 = 1.0 / 30.0;
const WALK_SPEED: f32 = 4.0;
const PHYSICAL_FLY_RADIUS: f32 = 0.25;
/// Retail first-person pivot height (`acclient.c:138168-138196`).
const FIRST_PERSON_EYE_HEIGHT: f32 = 1.5;
/// Retail in-head forward offset (`acclient.c:142853-142880`).
const FIRST_PERSON_FORWARD_OFFSET: f32 = 0.18;
/// Retail render-viewer sphere radius (`acclient.c:139301-139305`).
const VIEWER_SPHERE_RADIUS: f32 = 0.3;
const SUPPORT_CENTER_Z: f32 = 0.475;
const UPPER_CENTER_Z: f32 = 1.350;
const HUMAN_RADIUS: f32 = 0.480;
const FOOT_CLEARANCE: f32 = HUMAN_RADIUS - SUPPORT_CENTER_Z;
/// Mirrors Explorer's radius-two application simulation-interest policy.
const SIMULATION_INTEREST_RADIUS: i32 = 2;
const PHYSICAL_FLY_CONFIG: PhysicalFlyConfig = PhysicalFlyConfig {
    maximum_substep_distance: PHYSICAL_FLY_RADIUS,
    maximum_substeps: 32,
    maximum_contact_passes: 8,
    separation_epsilon: 0.000_5,
};
const GROUNDED_CONFIG: GroundedConfig = GroundedConfig {
    gravity: -9.8,
    walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
    step_up_height: 0.6,
    step_down_height: 1.5,
    edge_protection: EdgeProtection::Creature,
    maximum_substep_distance: HUMAN_RADIUS * 0.5,
    maximum_substeps: 32,
    maximum_contact_passes: 8,
    separation_epsilon: 0.000_5,
};

/// Grounded collider roles exercised by one explicit diagnostic route.
#[derive(Clone, Copy, Debug, ValueEnum)]
enum GroundedRouteBody {
    /// Use only the authored lower/support sphere.
    Lower,
    /// Use the production lower/support and upper/constraint pair.
    Pair,
}

#[derive(Debug, Parser)]
#[command(about = "Probe canonical landblock collision assembly")]
struct Args {
    /// Normalized or cell-qualified landblock DID.
    #[arg(long, default_value = "0xda55ffff", value_parser = parse_did)]
    landblock: u32,
    /// Optional HBA file or directory; normal content discovery is used when omitted.
    #[arg(long)]
    content: Option<std::path::PathBuf>,
    /// Restrict physical-fly and grounded portal traces to one full EnvCell DID.
    #[arg(long, value_parser = parse_did)]
    portal_cell: Option<u32>,
    /// Restrict physical-fly and grounded portal traces to one source portal index.
    #[arg(long)]
    portal_index: Option<usize>,
    /// Print the source identity for a zero-based collider index in the assembled artifact.
    #[arg(long = "describe-collider")]
    describe_colliders: Vec<usize>,
    /// Run one grounded route from anchor-local body-reference coordinates formatted as X,Y,Z.
    #[arg(long, value_parser = parse_vector3, requires = "grounded_drive")]
    grounded_start: Option<Vector3>,
    /// Horizontal grounded velocity formatted as X,Y in meters per second.
    #[arg(long, value_parser = parse_horizontal_vector, requires = "grounded_start")]
    grounded_drive: Option<Vector3>,
    /// Exact starting EnvCell DID; omit only for an explicitly outdoor start.
    #[arg(long, value_parser = parse_did, requires = "grounded_start")]
    grounded_cell: Option<u32>,
    /// Number of zero-drive ticks used to acquire authored support before the route.
    #[arg(long, default_value_t = 4)]
    grounded_settle_ticks: usize,
    /// Number of driven 30 Hz ticks emitted by the explicit route.
    #[arg(long, default_value_t = 60)]
    grounded_ticks: usize,
    /// Grounded sphere roles used by the explicit route.
    #[arg(long, value_enum, default_value_t = GroundedRouteBody::Pair)]
    grounded_body: GroundedRouteBody,
    /// Time this many grounded-obstruction and support query pairs across the assembled scene.
    #[arg(long, default_value_t = 0)]
    query_benchmark: usize,
}

/// One fully validated, deterministic grounded product-route replay.
#[derive(Clone, Copy, Debug)]
struct GroundedRouteSpec {
    /// Body-reference start in the selected outdoor owner's local frame.
    start: Vector3,
    /// Horizontal requested velocity in meters per second.
    drive_velocity: Vector3,
    /// Authoritative starting EnvCell, or `None` for an explicitly outdoor body.
    cell: Option<Guid>,
    /// Zero-drive ticks used to acquire support before movement.
    settle_ticks: usize,
    /// Driven ticks emitted after support acquisition.
    drive_ticks: usize,
    /// Ordered grounded collider roles submitted to the production solver.
    spheres: GroundedBodySpheres,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let explicit_grounded_route = grounded_route_spec(&args, args.landblock)?;
    let repository =
        Arc::new(ContentRepository::discover(args.content).context("content discovery failed")?);
    let decode_cache = Arc::new(ContentDecodeCache::new());
    let service = ContentAssetService::new(Arc::clone(&repository), Arc::clone(&decode_cache));
    let landblock = service
        .load_landblock(args.landblock)?
        .with_context(|| format!("CellLandblock 0x{:08X} is absent", args.landblock))?;
    let scenery = service.resolve_generated_scenery(&landblock)?;
    let interior = service.resolve_interior_system(&landblock)?;
    let collision = service.resolve_collision(&landblock)?;
    let collider_provenance =
        collider_provenance(&repository, &decode_cache, &landblock, &scenery, &interior)?;
    ensure!(
        collider_provenance.len() == collision.static_geometry.colliders.len(),
        "collider provenance accounts for {}, but product assembly emitted {}",
        collider_provenance.len(),
        collision.static_geometry.colliders.len()
    );

    let mut placements = PlacementCensus::default();
    for source_did in landblock
        .explicit_objects
        .iter()
        .map(|object| object.source_did)
        .chain(scenery.objects.iter().map(|object| object.source_did))
        .chain(
            landblock
                .buildings
                .iter()
                .map(|building| building.source_did),
        )
        .chain(
            interior
                .cells
                .iter()
                .flat_map(|cell| cell.static_objects.iter())
                .map(|object| object.source_did),
        )
    {
        placements.observe(&repository, &decode_cache, source_did)?;
    }
    let mut collidable_cell_structures = 0usize;
    let mut unbounded_cell_structures = 0usize;
    for cell in &interior.cells {
        let environment = decode_cache.environment(&repository, cell.structure.environment_id)?;
        let structure = environment
            .cells
            .get(&cell.structure.local_selector)
            .with_context(|| {
                format!(
                    "Environment 0x{:08X} has no CellStruct 0x{:08X}",
                    cell.structure.environment_id, cell.structure.local_selector
                )
            })?;
        if bsp_has_root_sphere(&structure.physics_bsp) {
            collidable_cell_structures += 1;
        } else {
            unbounded_cell_structures += 1;
        }
    }
    let expected_colliders = placements.emitted_colliders + collidable_cell_structures;
    ensure!(
        collision.static_geometry.colliders.len() == expected_colliders,
        "canonical artifact emitted {} colliders; source census accounts for {expected_colliders}",
        collision.static_geometry.colliders.len()
    );

    println!("landblock=0x{:08X}", landblock.landblock_id);
    println!(
        "sources explicit={} generated={} buildings={} env_cells={} indoor_objects={}",
        landblock.explicit_objects.len(),
        scenery.objects.len(),
        landblock.buildings.len(),
        interior.cells.len(),
        interior
            .cells
            .iter()
            .map(|cell| cell.static_objects.len())
            .sum::<usize>()
    );
    println!(
        "artifact terrain_cells={} terrain_triangles={} placed_colliders={} cell_volumes={}",
        collision.terrain.cells.len(),
        collision.terrain.cells.len() * 2,
        collision.static_geometry.colliders.len(),
        collision.static_geometry.cell_volumes.len()
    );
    println!(
        "placement_records total={} consumed={} inert_unsupported_family={} inert_no_physics={}",
        placements.records,
        placements.consumed_records,
        placements.unsupported_records,
        placements.no_physics_records
    );
    println!(
        "setup_parts total={} collidable={} inert_no_physics={}",
        placements.setup_parts,
        placements.collidable_setup_parts,
        placements.setup_parts - placements.collidable_setup_parts
    );
    println!(
        "setup_volumes fallback_records={} emitted_volume_colliders={}",
        placements.volume_records, placements.emitted_volumes
    );
    println!(
        "cell_structures collidable={} inert_missing_root_bounds={} volumes={}",
        collidable_cell_structures,
        unbounded_cell_structures,
        collision.static_geometry.cell_volumes.len()
    );
    for collider_index in &args.describe_colliders {
        let provenance = collider_provenance
            .get(*collider_index)
            .with_context(|| format!("collider index {collider_index} is out of range"))?;
        let collider = &collision.static_geometry.colliders[*collider_index];
        let shape_kind = match &*collider.shape {
            holtburger_content::CollisionShape::Bsp(_) => "bsp",
            holtburger_content::CollisionShape::Cylinder(_) => "cylinder",
            holtburger_content::CollisionShape::Ball(_) => "ball",
        };
        println!(
            "collider[{collider_index}]={provenance} shape={shape_kind} origin=({:.6},{:.6},{:.6}) rotation=({:.6},{:.6},{:.6},{:.6}) bounds=({:.6},{:.6},{:.6})..({:.6},{:.6},{:.6}) domain={:?}",
            collider.placement.origin.x,
            collider.placement.origin.y,
            collider.placement.origin.z,
            collider.placement.orientation.w,
            collider.placement.orientation.x,
            collider.placement.orientation.y,
            collider.placement.orientation.z,
            collider.bounds.minimum().x,
            collider.bounds.minimum().y,
            collider.bounds.minimum().z,
            collider.bounds.maximum().x,
            collider.bounds.maximum().y,
            collider.bounds.maximum().z,
            collider.source_placement,
        );
        match &*collider.shape {
            holtburger_content::CollisionShape::Bsp(solid) => {
                let mut polygons = solid.polygons.iter().collect::<Vec<_>>();
                polygons.sort_by_key(|(polygon_id, _)| **polygon_id);
                for (polygon_id, polygon) in polygons {
                    let normal = collider.normal_to_landblock_space(polygon.normal);
                    let vertices = polygon
                        .vertices
                        .iter()
                        .map(|vertex| collider.point_to_landblock_space(*vertex))
                        .collect::<Vec<_>>();
                    println!(
                        "collider[{collider_index}].polygon[{polygon_id}] normal=({:.6},{:.6},{:.6}) vertices={vertices:?}",
                        normal.x, normal.y, normal.z
                    );
                }
                describe_bsp(*collider_index, collider, &solid.bsp, "root");
            }
            holtburger_content::CollisionShape::Cylinder(cylinder) => {
                let low = collider.point_to_landblock_space(cylinder.low_point);
                println!(
                    "collider[{collider_index}].cylinder low=({:.6},{:.6},{:.6}) radius={:.6} height={:.6}",
                    low.x, low.y, low.z, cylinder.radius, cylinder.height
                );
            }
            holtburger_content::CollisionShape::Ball(ball) => {
                let center = collider.point_to_landblock_space(ball.center);
                println!(
                    "collider[{collider_index}].ball center=({:.6},{:.6},{:.6}) radius={:.6}",
                    center.x, center.y, center.z, ball.radius
                );
            }
        }
    }
    if let Some(portal_cell) = args.portal_cell {
        for portal in interior
            .topology
            .portals
            .iter()
            .filter(|portal| portal.source.env_cell_id == portal_cell)
        {
            println!(
                "portal_topology cell=0x{portal_cell:08X} portal={} flags=0x{:04X} polygon={} endpoint={:?}",
                portal.source.portal_index, portal.flags, portal.polygon_id, portal.endpoint
            );
        }
    }
    let mut scene = CollisionScene::new();
    insert_simulation_interest_neighborhood(&service, collision, &mut scene)?;
    let high_altitude_contacts = scene.placement_contacts(PlacementRequest {
        anchor: Guid(landblock.landblock_id),
        center: Vector3::new(96.0, 96.0, 600.0),
        radius: 0.5,
        placement: &CollisionPlacement::outdoor(),
    })?;
    println!(
        "world_query high_altitude_placement_contacts={}",
        high_altitude_contacts.len()
    );
    if args.query_benchmark > 0 {
        benchmark_static_queries(&scene, landblock.landblock_id, args.query_benchmark)?;
    }
    if let Some(route) = explicit_grounded_route {
        probe_explicit_grounded_route(&scene, landblock.landblock_id, route)?;
    } else {
        probe_physical_fly_outside_portals(
            &scene,
            landblock.landblock_id,
            &interior,
            args.portal_cell,
            args.portal_index,
        )?;
        probe_grounded_outside_portals(
            &scene,
            landblock.landblock_id,
            &interior,
            args.portal_cell,
            args.portal_index,
        )?;
    }
    Ok(())
}

fn describe_bsp(
    collider_index: usize,
    collider: &holtburger_content::PlacedCollider,
    node: &BspNode,
    path: &str,
) {
    match node {
        BspNode::Leaf(leaf) => println!(
            "collider[{collider_index}].bsp[{path}] leaf index={} solid={} sphere={:?} polygons={:?}",
            leaf.index, leaf.solid, leaf.sphere, leaf.poly_ids
        ),
        BspNode::Port(portal) => {
            let (normal, plane_d) = placed_plane(collider, portal.plane);
            println!(
                "collider[{collider_index}].bsp[{path}] port normal=({:.6},{:.6},{:.6}) d={:.6} sphere={:?} polygons={:?}",
                normal.x, normal.y, normal.z, plane_d, portal.sphere, portal.poly_ids
            );
            describe_bsp(collider_index, collider, &portal.pos, &format!("{path}+"));
            describe_bsp(collider_index, collider, &portal.neg, &format!("{path}-"));
        }
        BspNode::Internal(internal) => {
            let (normal, plane_d) = placed_plane(collider, internal.plane);
            println!(
                "collider[{collider_index}].bsp[{path}] internal tag={:?} normal=({:.6},{:.6},{:.6}) d={:.6} sphere={:?} polygons={:?}",
                internal.tag,
                normal.x,
                normal.y,
                normal.z,
                plane_d,
                internal.sphere,
                internal.poly_ids
            );
            if let Some(positive) = &internal.pos {
                describe_bsp(collider_index, collider, positive, &format!("{path}+"));
            }
            if let Some(negative) = &internal.neg {
                describe_bsp(collider_index, collider, negative, &format!("{path}-"));
            }
        }
    }
}

fn placed_plane(
    collider: &holtburger_content::PlacedCollider,
    plane: holtburger_common::Plane,
) -> (Vector3, f32) {
    let normal = collider.normal_to_landblock_space(plane.normal);
    let local_point = plane.normal * (-plane.d / plane.normal.length_squared());
    let point = collider.point_to_landblock_space(local_point);
    (normal, -normal.dot(&point))
}

fn collider_provenance(
    repository: &ContentRepository,
    decode_cache: &ContentDecodeCache,
    landblock: &holtburger_content::LandblockAsset,
    scenery: &holtburger_content::GeneratedSceneryAsset,
    interior: &LandblockInteriorSystemAsset,
) -> Result<Vec<String>> {
    let mut provenance = Vec::new();
    for (index, object) in landblock.explicit_objects.iter().enumerate() {
        append_source_provenance(
            repository,
            decode_cache,
            &mut provenance,
            object.source_did,
            format!("explicit[{index}]"),
        )?;
    }
    for (index, object) in scenery.objects.iter().enumerate() {
        append_source_provenance(
            repository,
            decode_cache,
            &mut provenance,
            object.source_did,
            format!("generated[{index}]"),
        )?;
    }
    for (index, building) in landblock.buildings.iter().enumerate() {
        append_source_provenance(
            repository,
            decode_cache,
            &mut provenance,
            building.source_did,
            format!("building[{index}]"),
        )?;
    }
    for cell in &interior.cells {
        let environment = decode_cache.environment(repository, cell.structure.environment_id)?;
        let structure = environment
            .cells
            .get(&cell.structure.local_selector)
            .with_context(|| {
                format!(
                    "Environment 0x{:08X} has no CellStruct 0x{:04X}",
                    cell.structure.environment_id, cell.structure.local_selector
                )
            })?;
        if bsp_has_root_sphere(&structure.physics_bsp) {
            provenance.push(format!(
                "env-cell=0x{:08X} environment=0x{:08X} cell-struct=0x{:04X} shell",
                cell.env_cell_id, cell.structure.environment_id, cell.structure.local_selector
            ));
        }
        for object in &cell.static_objects {
            append_source_provenance(
                repository,
                decode_cache,
                &mut provenance,
                object.source_did,
                format!(
                    "env-cell=0x{:08X} static[{}]",
                    cell.env_cell_id, object.source_index
                ),
            )?;
        }
    }
    Ok(provenance)
}

fn append_source_provenance(
    repository: &ContentRepository,
    decode_cache: &ContentDecodeCache,
    provenance: &mut Vec<String>,
    source_did: u32,
    placement: String,
) -> Result<()> {
    match (source_did >> 24) as u8 {
        0x01 if decode_cache
            .gfx_obj(repository, source_did)?
            .physics_bsp
            .is_some() =>
        {
            provenance.push(format!(
                "{placement} source=0x{source_did:08X} gfx=0x{source_did:08X}"
            ));
        }
        0x01 => {}
        0x02 => {
            let setup = decode_cache.setup_model(repository, source_did)?;
            let mut any_part_bsp = false;
            for (part_index, part_id) in setup.parts.iter().enumerate() {
                if decode_cache
                    .gfx_obj(repository, *part_id)?
                    .physics_bsp
                    .is_some()
                {
                    any_part_bsp = true;
                    provenance.push(format!(
                        "{placement} source=0x{source_did:08X} part[{part_index}]=0x{part_id:08X}"
                    ));
                }
            }
            // Mirror assembly's retail precedence: setup volumes participate only when no part
            // carries a physics BSP, and cylspheres suppress spheres. Recomputed from source on
            // purpose — this census is the independent oracle the collider-count parity check
            // compares assembly against.
            if !any_part_bsp {
                let (label, count) = if setup.cyl_spheres.is_empty() {
                    ("sphere", setup.spheres.len())
                } else {
                    ("cylsphere", setup.cyl_spheres.len())
                };
                for volume_index in 0..count {
                    provenance.push(format!(
                        "{placement} source=0x{source_did:08X} {label}[{volume_index}]"
                    ));
                }
            }
        }
        _ => {}
    }
    Ok(())
}

/// Times static queries at deterministic scattered positions over the installed 5x5 scene.
///
/// This measures broad-phase selection plus narrow phase for the current per-landblock scan, so
/// the Phase 5 cell index change can be sized against the same command.
fn benchmark_static_queries(
    scene: &CollisionScene,
    landblock_id: u32,
    query_count: usize,
) -> Result<()> {
    let anchor = Guid(landblock_id);
    let placement = CollisionPlacement::outdoor();
    // Deterministic low-discrepancy walk over the landblock interior at a plausible body height.
    let position = |index: usize| {
        let golden = 0.618_034_f32;
        let x = 4.0 + ((index as f32 * golden) % 1.0) * 184.0;
        let y = 4.0 + ((index as f32 * golden * golden) % 1.0) * 184.0;
        Vector3::new(x, y, 40.0)
    };
    let start = std::time::Instant::now();
    let mut total_obstructions = 0usize;
    for index in 0..query_count {
        let center = position(index);
        total_obstructions += scene
            .grounded_obstructions(GroundedObstructionRequest {
                sweep: SphereSweep {
                    anchor,
                    start: center,
                    end: center + Vector3::new(0.13, 0.0, 0.0),
                    radius: 0.48,
                },
                placement: &placement,
            })?
            .len();
    }
    let obstruction_elapsed = start.elapsed();
    let start = std::time::Instant::now();
    let mut total_supports = 0usize;
    for index in 0..query_count {
        let center = position(index);
        total_supports += scene
            .support_contacts(SupportRequest {
                anchor,
                center,
                radius: 0.48,
                maximum_drop: 1.5,
                maximum_rise: 0.6,
                placement: &placement,
            })?
            .len();
    }
    let support_elapsed = start.elapsed();
    println!(
        "query_benchmark count={query_count} obstruction_us_per_query={:.2} support_us_per_query={:.2} obstructions={total_obstructions} supports={total_supports}",
        obstruction_elapsed.as_secs_f64() * 1e6 / query_count as f64,
        support_elapsed.as_secs_f64() * 1e6 / query_count as f64,
    );
    Ok(())
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
            let owner = ((x as u32) << 24) | ((y as u32) << 16) | 0xffff;
            let Some(landblock) = service.load_landblock(owner)? else {
                continue;
            };
            insertions.push(service.resolve_collision(&landblock)?);
        }
    }
    scene.apply_residency_change(insertions, &[])?;
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct OutsidePortalWaypoint {
    cell: u32,
    portal_index: usize,
    center: Vector3,
    horizontal_normal: Vector3,
    floor_z: f32,
}

/// One valid physical-fly drive from a clear portal-side seed.
#[derive(Debug)]
struct PhysicalFlyPortalTrace {
    /// Last atomically committed physical-fly body.
    body: PhysicalFlyBody,
    /// First EnvCell committed during the drive, when entry occurred.
    entered_cell: Option<Guid>,
    /// Final camera-viewer cell from continuous placed-motion traversal.
    viewer_cell: Option<Guid>,
    /// Ticks where endpoint body classification and continuous viewer placement differ.
    viewer_mismatch_ticks: usize,
    /// Initial camera-sphere elevation used to detect grounded-policy leakage.
    start_z: f32,
    /// Total bounded collision substeps used across the drive.
    substeps: usize,
    /// Total contact-separation passes used across the drive.
    contact_passes: usize,
    /// Ordered placement changes emitted by the shared placed-motion primitive.
    placement_transitions: Vec<PlacementLegTransition>,
}

/// One authoritative placement change inside a solved fixed tick.
#[derive(Clone, Debug)]
struct PlacementLegTransition {
    tick: usize,
    end_fraction: f32,
    from: Option<Guid>,
    to: Option<Guid>,
}

fn append_placed_motion_transitions(
    scene: &CollisionScene,
    tick: usize,
    request: PlacedMotionPathRequest<'_>,
    transitions: &mut Vec<PlacementLegTransition>,
) -> Result<Option<Guid>> {
    let previous_cell = request.previous_cell;
    let path = scene.transit_motion_path(request)?;
    ensure!(
        !path.has_recovery(),
        "ordinary placed-motion probe unexpectedly required placement recovery"
    );
    let initial_cell = path.initial().placement().committed_cell();
    ensure!(
        initial_cell == previous_cell,
        "placed-motion trace changed its initial committed cell"
    );
    let mut cell = initial_cell;
    for leg in path.legs() {
        let next = leg.end().placement().committed_cell();
        if next != cell {
            transitions.push(PlacementLegTransition {
                tick,
                end_fraction: leg.end_fraction(),
                from: cell,
                to: next,
            });
        }
        cell = next;
    }
    Ok(cell)
}

fn append_physical_fly_viewer_transitions(
    scene: &CollisionScene,
    tick: usize,
    previous_cell: Option<Guid>,
    anchor: Guid,
    start: Vector3,
    body_motion: &[MotionWaypoint],
    transitions: &mut Vec<PlacementLegTransition>,
) -> Result<Option<Guid>> {
    let body_path = scene.transit_motion_path(PlacedMotionPathRequest {
        previous_cell,
        anchor,
        start,
        radius: PHYSICAL_FLY_RADIUS,
        waypoints: body_motion,
    })?;
    let viewer_motion = body_path
        .legs()
        .iter()
        .map(|leg| MotionWaypoint {
            center: leg.end().center(),
            end_fraction: leg.end_fraction(),
            placement: MotionWaypointPlacement::Traverse,
        })
        .collect::<Vec<_>>();
    append_placed_motion_transitions(
        scene,
        tick,
        PlacedMotionPathRequest {
            previous_cell,
            anchor,
            start,
            radius: VIEWER_SPHERE_RADIUS,
            waypoints: &viewer_motion,
        },
        transitions,
    )
}

fn format_placement_transitions(transitions: &[PlacementLegTransition]) -> String {
    if transitions.is_empty() {
        return "none".to_owned();
    }
    transitions
        .iter()
        .map(|transition| {
            format!(
                "{}@{:.6}:{}>{}",
                transition.tick,
                transition.end_fraction,
                format_cell(transition.from),
                format_cell(transition.to),
            )
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn format_cell(cell: Option<Guid>) -> String {
    cell.map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0))
}

/// Separates invalid diagnostic setup from a valid physical-fly solver trace.
enum PhysicalFlyPortalAttempt {
    /// The synthetic seed overlaps authored collision before any request is solved.
    InvalidStart { contacts: usize },
    /// A valid seed completed every bounded solve request.
    Trace(PhysicalFlyPortalTrace),
}

fn probe_physical_fly_outside_portals(
    scene: &CollisionScene,
    landblock_id: u32,
    interior: &LandblockInteriorSystemAsset,
    portal_cell: Option<u32>,
    portal_index: Option<usize>,
) -> Result<()> {
    let waypoints = outside_portal_waypoints(interior)?
        .into_iter()
        .filter(|waypoint| portal_cell.is_none_or(|cell| waypoint.cell == cell))
        .filter(|waypoint| portal_index.is_none_or(|index| waypoint.portal_index == index))
        .collect::<Vec<_>>();
    let mut traversals = Vec::new();
    let mut invalid_starts = Vec::new();
    let mut rejected_traces = Vec::new();
    for waypoint in &waypoints {
        for direction_sign in [-1.0, 1.0] {
            let direction = waypoint.horizontal_normal * direction_sign;
            match traverse_physical_fly_portal(scene, landblock_id, *waypoint, direction) {
                Ok(PhysicalFlyPortalAttempt::InvalidStart { contacts }) => {
                    invalid_starts.push(format!(
                        "cell=0x{:08X} portal={} center=({:.3},{:.3},{:.3}) direction=({:.3},{:.3}) contacts={contacts}",
                        waypoint.cell,
                        waypoint.portal_index,
                        waypoint.center.x,
                        waypoint.center.y,
                        waypoint.center.z,
                        direction.x,
                        direction.y,
                    ));
                }
                Ok(PhysicalFlyPortalAttempt::Trace(trace)) => {
                    if trace.entered_cell.is_some() && trace.body.cell.is_some() {
                        traversals.push((*waypoint, direction, trace));
                    }
                }
                Err(error) => rejected_traces.push(format!(
                    "cell=0x{:08X} portal={} center=({:.3},{:.3},{:.3}) direction=({:.3},{:.3}): {error:#}",
                    waypoint.cell,
                    waypoint.portal_index,
                    waypoint.center.x,
                    waypoint.center.y,
                    waypoint.center.z,
                    direction.x,
                    direction.y,
                )),
            }
        }
    }

    println!(
        "physical_fly_portals authored_outside={} traversals={} invalid_starts={} rejected_traces={}",
        waypoints.len(),
        traversals.len(),
        invalid_starts.len(),
        rejected_traces.len(),
    );
    if portal_cell.is_some() {
        for invalid_start in &invalid_starts {
            println!("physical_fly_route invalid_start={invalid_start}");
        }
    }
    for rejection in &rejected_traces {
        println!("physical_fly_route rejection={rejection}");
    }

    let canonical = traversals.iter().find(|(waypoint, direction, _)| {
        waypoint.cell == 0xda55_0100 && waypoint.portal_index == 1 && direction.x < -0.9
    });
    let selected = canonical.or_else(|| traversals.first());
    if let Some((waypoint, direction, trace)) = selected {
        let (exited, exited_viewer_cell, reverse_mismatch_ticks, reverse_transitions) =
            exit_physical_fly_portal(scene, trace.body, trace.viewer_cell, *direction)?;
        ensure!(
            exited.cell.is_none(),
            "selected physical-fly route did not reverse outdoors"
        );
        ensure!(
            exited_viewer_cell.is_none(),
            "selected physical-fly viewer path did not reverse outdoors"
        );
        if waypoint.cell == 0xda55_0100 && waypoint.portal_index == 1 && direction.x < -0.9 {
            ensure!(
                trace.body.cell == Some(Guid(0xda55_0103)),
                "DA55 canonical physical-fly route did not finish in linked EnvCell 0xDA550103"
            );
        }
        println!(
            "physical_fly_route cell=0x{:08X} portal={} direction=({:.3},{:.3}) start_z={:.3} entered=0x{:08X} final_cell={} viewer_cell={} viewer_mismatch_ticks={} final=({:.3},{:.3},{:.3}) vertical_drift={:.4} substeps={} contact_passes={} placement_legs={} reverse_cell={} reverse_viewer_cell={} reverse_viewer_mismatch_ticks={} reverse_final=({:.3},{:.3},{:.3}) reverse_placement_legs={}",
            waypoint.cell,
            waypoint.portal_index,
            direction.x,
            direction.y,
            trace.start_z,
            trace.entered_cell.expect("selected trace entered a cell").0,
            trace
                .body
                .cell
                .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
            format_cell(trace.viewer_cell),
            trace.viewer_mismatch_ticks,
            trace.body.pose.coords.x,
            trace.body.pose.coords.y,
            trace.body.pose.coords.z,
            trace.body.pose.coords.z - trace.start_z,
            trace.substeps,
            trace.contact_passes,
            format_placement_transitions(&trace.placement_transitions),
            exited
                .cell
                .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
            format_cell(exited_viewer_cell),
            reverse_mismatch_ticks,
            exited.pose.coords.x,
            exited.pose.coords.y,
            exited.pose.coords.z,
            format_placement_transitions(&reverse_transitions),
        );
    }
    if landblock_id == 0xda55_ffff && portal_cell.is_none() && portal_index.is_none() {
        ensure!(
            canonical.is_some(),
            "DA55 canonical physical-fly route 0xDA550100 portal 1 did not traverse"
        );
    }
    ensure!(
        rejected_traces.is_empty(),
        "{} physical-fly portal traces failed after valid setup",
        rejected_traces.len()
    );
    Ok(())
}

fn traverse_physical_fly_portal(
    scene: &CollisionScene,
    landblock_id: u32,
    waypoint: OutsidePortalWaypoint,
    direction: Vector3,
) -> Result<PhysicalFlyPortalAttempt> {
    let start = waypoint.center - direction * 1.25;
    let mut body = PhysicalFlyBody {
        pose: WorldPosition {
            landblock_id: Guid(landblock_id),
            coords: start,
            rotation: Quaternion::identity(),
        }
        .normalize_outdoor_cell(),
        cell: None,
        radius: PHYSICAL_FLY_RADIUS,
    };
    let placement = scene.transit_cell(CellTransitRequest {
        previous_cell: None,
        anchor: Guid(landblock_id),
        center: body.pose.coords,
        radius: body.radius,
    })?;
    let contacts = scene.placement_contacts(PlacementRequest {
        anchor: Guid(landblock_id),
        center: body.pose.coords,
        radius: body.radius,
        placement: &placement,
    })?;
    if !contacts.is_empty() {
        return Ok(PhysicalFlyPortalAttempt::InvalidStart {
            contacts: contacts.len(),
        });
    }
    body.cell = placement.committed_cell();
    if let Some(cell) = body.cell {
        body.pose.landblock_id = cell;
    }
    let start_z = body.pose.coords.z;
    if body.cell.is_some() {
        return Ok(PhysicalFlyPortalAttempt::Trace(PhysicalFlyPortalTrace {
            body,
            entered_cell: None,
            viewer_cell: body.cell,
            viewer_mismatch_ticks: 0,
            start_z,
            substeps: 0,
            contact_passes: 0,
            placement_transitions: Vec::new(),
        }));
    }

    let mut entered_cell = None;
    let mut substeps = 0;
    let mut contact_passes = 0;
    let mut viewer_cell = body.cell;
    let mut viewer_mismatch_ticks = 0;
    let mut placement_transitions = Vec::new();
    for tick in 0..30 {
        let previous = body;
        let solved = solved_physical_fly(solve_physical_fly(
            scene,
            PHYSICAL_FLY_CONFIG,
            PhysicalFlyRequest {
                body,
                displacement: direction * WALK_SPEED * HOST_TICK_SECONDS,
                filter: PhysicalCollisionFilter::ALL,
            },
        )?)
        .with_context(|| format!("drive tick {tick}"))?;
        let path_cell = append_physical_fly_viewer_transitions(
            scene,
            tick,
            viewer_cell,
            Guid(landblock_id),
            previous.pose.coords,
            &solved.motion,
            &mut placement_transitions,
        )?;
        viewer_cell = path_cell;
        viewer_mismatch_ticks += usize::from(viewer_cell != solved.body.cell);
        body = solved.body;
        substeps += solved.substeps;
        contact_passes += solved.contact_passes;
        entered_cell = entered_cell.or(body.cell);
    }
    Ok(PhysicalFlyPortalAttempt::Trace(PhysicalFlyPortalTrace {
        body,
        entered_cell,
        viewer_cell,
        viewer_mismatch_ticks,
        start_z,
        substeps,
        contact_passes,
        placement_transitions,
    }))
}

/// Physical-fly facts needed after one successful bounded solve.
struct SolvedPhysicalFly {
    /// Atomically committed body.
    body: PhysicalFlyBody,
    /// Collision substeps consumed by the solve.
    substeps: usize,
    /// Contact-separation passes consumed by the solve.
    contact_passes: usize,
    /// Ordered collision-accepted endpoints produced by the solver.
    motion: Vec<MotionWaypoint>,
}

fn solved_physical_fly(outcome: PhysicalFlyOutcome) -> Result<SolvedPhysicalFly> {
    match outcome {
        PhysicalFlyOutcome::Solved {
            body,
            motion,
            substeps,
            contact_passes,
            ..
        } => Ok(SolvedPhysicalFly {
            body,
            substeps,
            contact_passes,
            motion,
        }),
        PhysicalFlyOutcome::BudgetExceeded {
            body,
            budget,
            substeps,
            contact_passes,
        } => anyhow::bail!(
            "physical-fly portal trace exceeded its {budget:?} budget at ({:.3},{:.3},{:.3}) cell={} after {substeps} substeps/{contact_passes} passes",
            body.pose.coords.x,
            body.pose.coords.y,
            body.pose.coords.z,
            body.cell
                .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
        ),
    }
}

fn exit_physical_fly_portal(
    scene: &CollisionScene,
    mut body: PhysicalFlyBody,
    mut viewer_cell: Option<Guid>,
    entry_direction: Vector3,
) -> Result<(
    PhysicalFlyBody,
    Option<Guid>,
    usize,
    Vec<PlacementLegTransition>,
)> {
    let anchor = Guid(body.pose.landblock_id.0 & 0xffff_0000 | 0x0000_ffff);
    let mut viewer_mismatch_ticks = 0;
    let mut placement_transitions = Vec::new();
    for tick in 0..60 {
        let previous = body;
        let solved = solved_physical_fly(solve_physical_fly(
            scene,
            PHYSICAL_FLY_CONFIG,
            PhysicalFlyRequest {
                body,
                displacement: entry_direction * -WALK_SPEED * HOST_TICK_SECONDS,
                filter: PhysicalCollisionFilter::ALL,
            },
        )?)
        .with_context(|| format!("reverse tick {tick}"))?;
        let path_cell = append_physical_fly_viewer_transitions(
            scene,
            tick,
            viewer_cell,
            anchor,
            previous.pose.coords,
            &solved.motion,
            &mut placement_transitions,
        )?;
        viewer_cell = path_cell;
        viewer_mismatch_ticks += usize::from(viewer_cell != solved.body.cell);
        body = solved.body;
    }
    Ok((
        body,
        viewer_cell,
        viewer_mismatch_ticks,
        placement_transitions,
    ))
}

/// Whether one explicit route tick may feed the next tick.
enum GroundedRouteTick {
    /// The solver committed a body that may continue the replay.
    Solved(GroundedBody),
    /// Coverage or a finite solver budget stopped the replay at its last safe state.
    Stopped,
}

/// Correlated inputs for one explicit grounded replay tick.
struct GroundedRouteTickRequest {
    /// Stable replay phase label.
    phase: &'static str,
    /// Zero-based tick within `phase`.
    tick: usize,
    /// Last safely committed body supplied to the production solver.
    body: GroundedBody,
    /// Velocity submitted for this tick.
    requested_velocity: Vector3,
    /// Axis used only to report signed forward progress.
    progress_axis: Vector3,
}

fn probe_explicit_grounded_route(
    scene: &CollisionScene,
    landblock_id: u32,
    route: GroundedRouteSpec,
) -> Result<()> {
    let anchor = Guid(landblock_id);
    let mut body = GroundedBody {
        pose: WorldPosition {
            landblock_id: route.cell.unwrap_or(anchor),
            coords: route.start,
            rotation: Quaternion::identity(),
        },
        cell: route.cell,
        velocity: Vector3::zero(),
        support: None,
    };
    let support_center = route.start + route.spheres.support.center;
    let placement = scene.transit_cell(CellTransitRequest {
        previous_cell: route.cell,
        anchor,
        center: support_center,
        radius: route.spheres.support.radius,
    })?;
    ensure!(
        placement.committed_cell() == route.cell,
        "explicit grounded start requested cell {}, but portal traversal selected {}; pass --grounded-cell for an indoor start",
        format_cell(route.cell),
        format_cell(placement.committed_cell()),
    );
    let initial_contacts = initial_placement_contacts(scene, &body, route.spheres)?;
    println!(
        "grounded_explicit start=({:.6},{:.6},{:.6}) cell={} drive=({:.6},{:.6}) settle_ticks={} drive_ticks={} spheres={} initial_contacts={initial_contacts}",
        route.start.x,
        route.start.y,
        route.start.z,
        format_cell(route.cell),
        route.drive_velocity.x,
        route.drive_velocity.y,
        route.settle_ticks,
        route.drive_ticks,
        usize::from(route.spheres.upper.is_some()) + 1,
    );
    for tick in 0..route.settle_ticks {
        match emit_grounded_route_tick(
            scene,
            route.spheres,
            GroundedRouteTickRequest {
                phase: "settle",
                tick,
                body,
                requested_velocity: Vector3::zero(),
                progress_axis: route.drive_velocity,
            },
        )? {
            GroundedRouteTick::Solved(solved) => body = solved,
            GroundedRouteTick::Stopped => return Ok(()),
        }
    }
    for tick in 0..route.drive_ticks {
        match emit_grounded_route_tick(
            scene,
            route.spheres,
            GroundedRouteTickRequest {
                phase: "drive",
                tick,
                body,
                requested_velocity: route.drive_velocity,
                progress_axis: route.drive_velocity,
            },
        )? {
            GroundedRouteTick::Solved(solved) => body = solved,
            GroundedRouteTick::Stopped => return Ok(()),
        }
    }
    Ok(())
}

fn emit_grounded_route_tick(
    scene: &CollisionScene,
    spheres: GroundedBodySpheres,
    request: GroundedRouteTickRequest,
) -> Result<GroundedRouteTick> {
    let phase = request.phase;
    let tick = request.tick;
    let start = request.body.pose.coords;
    let outcome = solve_grounded(
        scene,
        GROUNDED_CONFIG,
        GroundedRequest {
            body: request.body,
            spheres,
            supported_velocity: request.requested_velocity,
            may_step_down: true,
            retain_supported_gravity: false,
            delta_seconds: HOST_TICK_SECONDS,
            filter: PhysicalCollisionFilter::ALL,
        },
    )?;
    match outcome {
        GroundedOutcome::Solved {
            body,
            achieved_velocity,
            substeps,
            contact_passes,
            constraint_count,
            ..
        } => {
            let displacement = body.pose.coords - start;
            let forward = if request.progress_axis.length_squared() > f32::EPSILON {
                displacement.dot(&request.progress_axis.normalize())
            } else {
                0.0
            };
            let support_normal = format_ground_support(&body);
            println!(
                "grounded_explicit phase={phase} tick={tick} status=solved start=({:.6},{:.6},{:.6}) final=({:.6},{:.6},{:.6}) displacement=({:.6},{:.6},{:.6}) forward={forward:.6} achieved=({:.6},{:.6},{:.6}) cell={} grounded={} support_normal={support_normal} body_velocity=({:.6},{:.6},{:.6}) constraints={constraint_count} substeps={substeps} contact_passes={contact_passes}",
                start.x,
                start.y,
                start.z,
                body.pose.coords.x,
                body.pose.coords.y,
                body.pose.coords.z,
                displacement.x,
                displacement.y,
                displacement.z,
                achieved_velocity.x,
                achieved_velocity.y,
                achieved_velocity.z,
                format_cell(body.cell),
                body.support.is_some(),
                body.velocity.x,
                body.velocity.y,
                body.velocity.z,
            );
            Ok(GroundedRouteTick::Solved(body))
        }
        GroundedOutcome::BudgetExceeded {
            body,
            budget,
            substeps,
            contact_passes,
            constraint_count,
        } => {
            println!(
                "grounded_explicit phase={phase} tick={tick} status=budget_exceeded budget={budget:?} final=({:.6},{:.6},{:.6}) cell={} grounded={} body_velocity=({:.6},{:.6},{:.6}) constraints={constraint_count} substeps={substeps} contact_passes={contact_passes}",
                body.pose.coords.x,
                body.pose.coords.y,
                body.pose.coords.z,
                format_cell(body.cell),
                body.support.is_some(),
                body.velocity.x,
                body.velocity.y,
                body.velocity.z,
            );
            Ok(GroundedRouteTick::Stopped)
        }
    }
}

fn format_ground_support(body: &GroundedBody) -> String {
    let Some(support) = body.support else {
        return "none".to_owned();
    };
    format!(
        "({:.6},{:.6},{:.6})",
        support.normal.x, support.normal.y, support.normal.z
    )
}

fn probe_grounded_outside_portals(
    scene: &CollisionScene,
    landblock_id: u32,
    interior: &LandblockInteriorSystemAsset,
    portal_cell: Option<u32>,
    portal_index: Option<usize>,
) -> Result<()> {
    let waypoints = outside_portal_waypoints(interior)?
        .into_iter()
        .filter(|waypoint| portal_cell.is_none_or(|cell| waypoint.cell == cell))
        .filter(|waypoint| portal_index.is_none_or(|index| waypoint.portal_index == index))
        .collect::<Vec<_>>();
    let mut traversable_pair = Vec::new();
    let mut lower_only = Vec::new();
    let mut pair_vetoes = Vec::new();
    let mut invalid_starts = Vec::new();
    let mut rejected_traces = Vec::new();
    for waypoint in &waypoints {
        for direction_sign in [-1.0, 1.0] {
            let direction = waypoint.horizontal_normal * direction_sign;
            let lower = traverse_outside_portal(
                scene,
                landblock_id,
                *waypoint,
                direction,
                GroundedBodySpheres {
                    support: support_sphere(),
                    upper: None,
                },
            );
            let pair = traverse_outside_portal(
                scene,
                landblock_id,
                *waypoint,
                direction,
                production_pair(),
            );
            for (shape, trace) in [("lower", &lower), ("pair", &pair)] {
                match trace {
                    Ok(GroundedPortalAttempt::InvalidStart { contacts }) => {
                        invalid_starts.push(format!(
                            "{shape} cell=0x{:08X} portal={} center=({:.3},{:.3},{:.3}) direction=({:.3},{:.3}) contacts={contacts}",
                            waypoint.cell,
                            waypoint.portal_index,
                            waypoint.center.x,
                            waypoint.center.y,
                            waypoint.floor_z,
                            direction.x,
                            direction.y
                        ));
                    }
                    Err(error) => {
                        rejected_traces.push(format!(
                            "{shape} cell=0x{:08X} portal={} center=({:.3},{:.3},{:.3}) direction=({:.3},{:.3}): {error:#}",
                            waypoint.cell,
                            waypoint.portal_index,
                            waypoint.center.x,
                            waypoint.center.y,
                            waypoint.floor_z,
                            direction.x,
                            direction.y
                        ));
                    }
                    Ok(GroundedPortalAttempt::Trace(_)) => {}
                }
            }
            if let Ok(GroundedPortalAttempt::Trace(lower)) = lower
                && lower.entered_cell.is_some()
            {
                if let Ok(GroundedPortalAttempt::Trace(pair)) = &pair
                    && pair.entered_cell.is_none()
                {
                    pair_vetoes.push((
                        *waypoint,
                        direction,
                        lower.body.clone(),
                        pair.body.clone(),
                        pair.constraint_count,
                    ));
                }
                lower_only.push((*waypoint, direction, lower));
            }
            if let Ok(GroundedPortalAttempt::Trace(pair)) = pair
                && pair.entered_cell.is_some()
                && pair.body.cell.is_some()
            {
                traversable_pair.push((*waypoint, direction, pair));
            }
        }
    }

    println!(
        "grounded_portals authored_outside={} lower_traversals={} pair_traversals={} invalid_starts={} rejected_traces={}",
        waypoints.len(),
        lower_only.len(),
        traversable_pair.len(),
        invalid_starts.len(),
        rejected_traces.len()
    );
    if portal_cell.is_some() {
        for invalid_start in &invalid_starts {
            println!("grounded_route invalid_start={invalid_start}");
        }
    }
    for rejection in &rejected_traces {
        println!("grounded_route rejection={rejection}");
    }
    let mut recessed_candidates = traversable_pair
        .iter()
        .filter_map(|(waypoint, direction, trace)| {
            let drop = waypoint.floor_z + FOOT_CLEARANCE - trace.body.pose.coords.z;
            (drop > 0.1).then_some((*waypoint, *direction, trace, drop))
        })
        .collect::<Vec<_>>();
    recessed_candidates.sort_by(|left, right| right.3.total_cmp(&left.3));
    for (waypoint, direction, trace, drop) in recessed_candidates.iter().take(10) {
        println!(
            "grounded_route recessed_candidate cell=0x{:08X} portal={} direction=({:.3},{:.3}) threshold_z={:.3} final_cell={} final_z={:.3} drop={drop:.3}",
            waypoint.cell,
            waypoint.portal_index,
            direction.x,
            direction.y,
            waypoint.floor_z,
            trace
                .body
                .cell
                .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
            trace.body.pose.coords.z,
        );
    }
    if let Some((waypoint, direction, trace)) = traversable_pair
        .iter()
        .find(|(_, _, trace)| trace.body.support.is_some())
    {
        let exited = exit_outside_portal(scene, trace.body.clone(), *direction, production_pair())?;
        println!(
            "grounded_route pair cell=0x{:08X} portal={} center=({:.3},{:.3},{:.3}) direction=({:.3},{:.3}) entered=0x{:08X} final_cell={} viewer_cell={} viewer_heading={} viewer_mismatch_ticks={} viewer_placement_legs={} final=({:.3},{:.3},{:.3}) grounded={} constraints={} reverse_cell={} reverse_final=({:.3},{:.3},{:.3}) reverse_grounded={}",
            waypoint.cell,
            waypoint.portal_index,
            waypoint.center.x,
            waypoint.center.y,
            waypoint.floor_z,
            direction.x,
            direction.y,
            trace.entered_cell.expect("selected trace entered a cell").0,
            trace
                .body
                .cell
                .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
            trace
                .viewer_cell
                .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
            trace.viewer_heading,
            trace.viewer_mismatch_ticks,
            format_placement_transitions(&trace.viewer_placement_transitions),
            trace.body.pose.coords.x,
            trace.body.pose.coords.y,
            trace.body.pose.coords.z,
            trace.body.support.is_some(),
            trace.constraint_count,
            exited
                .body
                .cell
                .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
            exited.body.pose.coords.x,
            exited.body.pose.coords.y,
            exited.body.pose.coords.z,
            exited.body.support.is_some(),
        );
    } else {
        if let Some((waypoint, direction, trace)) = traversable_pair.first() {
            println!(
                "grounded_route pair_unsettled cell=0x{:08X} portal={} direction=({:.3},{:.3}) final_cell={} final=({:.3},{:.3},{:.3}) body_velocity=({:.3},{:.3},{:.3}) constraints={}",
                waypoint.cell,
                waypoint.portal_index,
                direction.x,
                direction.y,
                trace
                    .body
                    .cell
                    .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
                trace.body.pose.coords.x,
                trace.body.pose.coords.y,
                trace.body.pose.coords.z,
                trace.body.velocity.x,
                trace.body.velocity.y,
                trace.body.velocity.z,
                trace.constraint_count,
            );
        } else {
            println!("grounded_route pair=none");
        }
    }
    if let Some((waypoint, direction, lower, pair, pair_constraint_count)) = pair_vetoes.first() {
        println!(
            "grounded_route pair_veto cell=0x{:08X} portal={} center=({:.3},{:.3},{:.3}) direction=({:.3},{:.3}) lower_final_cell={} pair_final_cell={} pair_final=({:.3},{:.3},{:.3}) pair_grounded={} pair_constraints={}",
            waypoint.cell,
            waypoint.portal_index,
            waypoint.center.x,
            waypoint.center.y,
            waypoint.floor_z,
            direction.x,
            direction.y,
            lower
                .cell
                .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
            pair.cell
                .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
            pair.pose.coords.x,
            pair.pose.coords.y,
            pair.pose.coords.z,
            pair.support.is_some(),
            pair_constraint_count,
        );
    }
    ensure!(
        rejected_traces.is_empty(),
        "{} grounded portal traces failed after valid setup",
        rejected_traces.len()
    );
    Ok(())
}

fn exit_outside_portal(
    scene: &CollisionScene,
    mut body: GroundedBody,
    entry_direction: Vector3,
    spheres: GroundedBodySpheres,
) -> Result<SolvedGrounded> {
    let mut constraint_count = 0;
    let mut motion = Vec::new();
    for _ in 0..60 {
        let solved = solved_grounded(solve_grounded(
            scene,
            GROUNDED_CONFIG,
            GroundedRequest {
                body,
                spheres,
                supported_velocity: entry_direction * -WALK_SPEED,
                may_step_down: true,
                retain_supported_gravity: false,
                delta_seconds: HOST_TICK_SECONDS,
                filter: PhysicalCollisionFilter::ALL,
            },
        )?)?;
        body = solved.body;
        constraint_count = solved.constraint_count;
        motion = solved.motion;
    }
    Ok(SolvedGrounded {
        body,
        constraint_count,
        motion,
    })
}

fn outside_portal_waypoints(
    interior: &LandblockInteriorSystemAsset,
) -> Result<Vec<OutsidePortalWaypoint>> {
    let mut waypoints = Vec::new();
    for portal in &interior.topology.portals {
        if !matches!(portal.endpoint, LandblockPortalEndpoint::Outside { .. }) {
            continue;
        }
        let cell = interior
            .cells
            .iter()
            .find(|cell| cell.env_cell_id == portal.source.env_cell_id)
            .with_context(|| {
                format!(
                    "outside portal source cell 0x{:08X} is absent",
                    portal.source.env_cell_id
                )
            })?;
        let environment = interior
            .environments
            .get(&cell.structure.environment_id)
            .with_context(|| {
                format!(
                    "outside portal cell 0x{:08X} lost environment 0x{:08X}",
                    cell.env_cell_id, cell.structure.environment_id
                )
            })?;
        let structure = environment
            .cells
            .get(&cell.structure.local_selector)
            .with_context(|| {
                format!(
                    "environment 0x{:08X} lost CellStruct 0x{:04X}",
                    cell.structure.environment_id, cell.structure.local_selector
                )
            })?;
        let polygon = structure
            .polygons
            .get(&portal.polygon_id)
            .with_context(|| format!("outside portal lost polygon {}", portal.polygon_id))?;
        let vertices = polygon
            .vertex_ids
            .iter()
            .map(|vertex_id| {
                structure
                    .vertex_array
                    .vertices
                    .get(vertex_id)
                    .map(|vertex| {
                        cell.placement.orientation.rotate_vector(vertex.origin)
                            + cell.placement.origin
                    })
                    .with_context(|| format!("outside portal lost vertex {vertex_id}"))
            })
            .collect::<Result<Vec<_>>>()?;
        if vertices.len() < 3 {
            continue;
        }
        let center = vertices
            .iter()
            .copied()
            .fold(Vector3::zero(), |sum, vertex| sum + vertex)
            / vertices.len() as f32;
        let normal = cross(vertices[1] - vertices[0], vertices[2] - vertices[0]);
        let horizontal = Vector3::new(normal.x, normal.y, 0.0);
        if horizontal.length() <= f32::EPSILON {
            continue;
        }
        waypoints.push(OutsidePortalWaypoint {
            cell: cell.env_cell_id,
            portal_index: portal.source.portal_index,
            center,
            horizontal_normal: horizontal.normalize(),
            floor_z: vertices
                .iter()
                .map(|vertex| vertex.z)
                .fold(f32::INFINITY, f32::min),
        });
    }
    Ok(waypoints)
}

#[derive(Debug)]
struct GroundedPortalTrace {
    body: GroundedBody,
    entered_cell: Option<Guid>,
    viewer_cell: Option<Guid>,
    viewer_heading: &'static str,
    viewer_mismatch_ticks: usize,
    viewer_placement_transitions: Vec<PlacementLegTransition>,
    constraint_count: usize,
}

#[derive(Clone, Debug)]
struct GroundedViewerTrace {
    label: &'static str,
    direction: Vector3,
    cell: Option<Guid>,
    mismatch_ticks: usize,
    placement_transitions: Vec<PlacementLegTransition>,
}

enum GroundedPortalAttempt {
    InvalidStart { contacts: usize },
    Trace(GroundedPortalTrace),
}

struct SolvedGrounded {
    body: GroundedBody,
    constraint_count: usize,
    motion: Vec<MotionWaypoint>,
}

fn traverse_outside_portal(
    scene: &CollisionScene,
    landblock_id: u32,
    waypoint: OutsidePortalWaypoint,
    direction: Vector3,
    spheres: GroundedBodySpheres,
) -> Result<GroundedPortalAttempt> {
    let start = waypoint.center - direction * 1.25;
    let mut body = GroundedBody {
        pose: WorldPosition {
            landblock_id: Guid(landblock_id),
            coords: Vector3::new(start.x, start.y, waypoint.floor_z + FOOT_CLEARANCE),
            rotation: Quaternion::identity(),
        }
        .normalize_outdoor_cell(),
        cell: None,
        velocity: Vector3::zero(),
        support: None,
    };
    let registration = scene.transit_cell(CellTransitRequest {
        previous_cell: None,
        anchor: Guid(landblock_id),
        center: body.pose.coords + body.pose.rotation.rotate_vector(spheres.support.center),
        radius: spheres.support.radius,
    })?;
    body.cell = registration.committed_cell();
    if let Some(cell) = body.cell {
        body.pose.landblock_id = cell;
    }
    let initial_contacts = initial_placement_contacts(scene, &body, spheres)?;
    if initial_contacts > 0 {
        return Ok(GroundedPortalAttempt::InvalidStart {
            contacts: initial_contacts,
        });
    }
    let mut constraint_count = 0;
    let mut viewer_traces = grounded_viewer_traces(direction);
    for tick in 0..4 {
        let previous = body.clone();
        let solved = solved_grounded(solve_grounded(
            scene,
            GROUNDED_CONFIG,
            GroundedRequest {
                body,
                spheres,
                supported_velocity: Vector3::zero(),
                may_step_down: true,
                retain_supported_gravity: false,
                delta_seconds: HOST_TICK_SECONDS,
                filter: PhysicalCollisionFilter::ALL,
            },
        )?)
        .with_context(|| format!("settle tick {tick}"))?;
        body = solved.body;
        constraint_count = solved.constraint_count;
        transit_grounded_viewers(
            scene,
            landblock_id,
            tick,
            &previous,
            &solved.motion,
            &body,
            &mut viewer_traces,
        )?;
    }
    if body.cell.is_some() {
        let viewer = most_divergent_viewer(viewer_traces);
        return Ok(GroundedPortalAttempt::Trace(GroundedPortalTrace {
            entered_cell: None,
            body,
            viewer_cell: viewer.cell,
            viewer_heading: viewer.label,
            viewer_mismatch_ticks: viewer.mismatch_ticks,
            viewer_placement_transitions: viewer.placement_transitions,
            constraint_count,
        }));
    }

    let mut entered_cell = None;
    for tick in 0..30 {
        let previous = body.clone();
        let solved = solved_grounded(solve_grounded(
            scene,
            GROUNDED_CONFIG,
            GroundedRequest {
                body,
                spheres,
                supported_velocity: direction * WALK_SPEED,
                may_step_down: true,
                retain_supported_gravity: false,
                delta_seconds: HOST_TICK_SECONDS,
                filter: PhysicalCollisionFilter::ALL,
            },
        )?)
        .with_context(|| format!("drive tick {tick}"))?;
        body = solved.body;
        constraint_count = solved.constraint_count;
        entered_cell = entered_cell.or(body.cell);
        transit_grounded_viewers(
            scene,
            landblock_id,
            tick + 4,
            &previous,
            &solved.motion,
            &body,
            &mut viewer_traces,
        )?;
    }
    let viewer = most_divergent_viewer(viewer_traces);
    Ok(GroundedPortalAttempt::Trace(GroundedPortalTrace {
        body,
        entered_cell,
        viewer_cell: viewer.cell,
        viewer_heading: viewer.label,
        viewer_mismatch_ticks: viewer.mismatch_ticks,
        viewer_placement_transitions: viewer.placement_transitions,
        constraint_count,
    }))
}

fn grounded_viewer_traces(travel_direction: Vector3) -> [GroundedViewerTrace; 4] {
    let left = Vector3::new(-travel_direction.y, travel_direction.x, 0.0);
    [
        GroundedViewerTrace {
            label: "travel",
            direction: travel_direction,
            cell: None,
            mismatch_ticks: 0,
            placement_transitions: Vec::new(),
        },
        GroundedViewerTrace {
            label: "opposite",
            direction: travel_direction * -1.0,
            cell: None,
            mismatch_ticks: 0,
            placement_transitions: Vec::new(),
        },
        GroundedViewerTrace {
            label: "left",
            direction: left,
            cell: None,
            mismatch_ticks: 0,
            placement_transitions: Vec::new(),
        },
        GroundedViewerTrace {
            label: "right",
            direction: left * -1.0,
            cell: None,
            mismatch_ticks: 0,
            placement_transitions: Vec::new(),
        },
    ]
}

fn transit_grounded_viewers(
    scene: &CollisionScene,
    landblock_id: u32,
    tick: usize,
    previous_body: &GroundedBody,
    motion: &[MotionWaypoint],
    body: &GroundedBody,
    traces: &mut [GroundedViewerTrace],
) -> Result<()> {
    for trace in traces {
        let offset = Vector3::new(0.0, 0.0, FIRST_PERSON_EYE_HEIGHT)
            + trace.direction * FIRST_PERSON_FORWARD_OFFSET;
        let viewer_waypoints = motion
            .iter()
            .map(|waypoint| MotionWaypoint {
                center: waypoint.center + offset,
                end_fraction: waypoint.end_fraction,
                placement: MotionWaypointPlacement::Traverse,
            })
            .collect::<Vec<_>>();
        trace.cell = append_placed_motion_transitions(
            scene,
            tick,
            PlacedMotionPathRequest {
                previous_cell: trace.cell,
                anchor: Guid(landblock_id),
                start: previous_body.pose.coords + offset,
                radius: VIEWER_SPHERE_RADIUS,
                waypoints: &viewer_waypoints,
            },
            &mut trace.placement_transitions,
        )?;
        trace.mismatch_ticks += usize::from(body.cell != trace.cell);
    }
    Ok(())
}

fn most_divergent_viewer(traces: [GroundedViewerTrace; 4]) -> GroundedViewerTrace {
    traces
        .into_iter()
        .max_by_key(|trace| trace.mismatch_ticks)
        .expect("four canonical viewer headings")
}

fn initial_placement_contacts(
    scene: &CollisionScene,
    body: &GroundedBody,
    spheres: GroundedBodySpheres,
) -> Result<usize> {
    let mut contact_count = 0;
    for sphere in [Some(spheres.support), spheres.upper].into_iter().flatten() {
        let center = body.pose.coords + body.pose.rotation.rotate_vector(sphere.center);
        let placement = scene.transit_cell(CellTransitRequest {
            previous_cell: body.cell,
            anchor: body.pose.landblock_id,
            center,
            radius: sphere.radius,
        })?;
        contact_count += scene
            .placement_contacts(PlacementRequest {
                anchor: body.pose.landblock_id,
                center,
                radius: sphere.radius,
                placement: &placement,
            })?
            .len();
    }
    Ok(contact_count)
}

fn solved_grounded(outcome: GroundedOutcome) -> Result<SolvedGrounded> {
    match outcome {
        GroundedOutcome::Solved {
            body,
            constraint_count,
            motion,
            ..
        } => Ok(SolvedGrounded {
            body,
            constraint_count,
            motion,
        }),
        GroundedOutcome::BudgetExceeded {
            body,
            budget,
            substeps,
            contact_passes,
            constraint_count,
        } => {
            anyhow::bail!(
                "grounded portal trace exceeded its {budget:?} budget at ({:.3},{:.3},{:.3}) cell={} grounded={} constraints={} after {substeps} substeps/{contact_passes} passes",
                body.pose.coords.x,
                body.pose.coords.y,
                body.pose.coords.z,
                body.cell
                    .map_or_else(|| "outdoor".to_owned(), |cell| format!("0x{:08X}", cell.0)),
                body.support.is_some(),
                constraint_count,
            )
        }
    }
}

fn support_sphere() -> GroundedSphere {
    GroundedSphere {
        center: Vector3::new(0.0, 0.0, SUPPORT_CENTER_Z),
        radius: HUMAN_RADIUS,
    }
}

fn production_pair() -> GroundedBodySpheres {
    GroundedBodySpheres {
        support: support_sphere(),
        upper: Some(GroundedSphere {
            center: Vector3::new(0.0, 0.0, UPPER_CENTER_Z),
            radius: HUMAN_RADIUS,
        }),
    }
}

fn cross(left: Vector3, right: Vector3) -> Vector3 {
    Vector3::new(
        left.y * right.z - left.z * right.y,
        left.z * right.x - left.x * right.z,
        left.x * right.y - left.y * right.x,
    )
}

#[derive(Debug, Default)]
struct PlacementCensus {
    records: usize,
    consumed_records: usize,
    emitted_colliders: usize,
    unsupported_records: usize,
    no_physics_records: usize,
    setup_parts: usize,
    collidable_setup_parts: usize,
    /// Records collidable only through the setup volume fallback.
    volume_records: usize,
    /// Cylinder and ball colliders those records emit.
    emitted_volumes: usize,
}

impl PlacementCensus {
    fn observe(
        &mut self,
        repository: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        source_did: u32,
    ) -> Result<()> {
        self.records += 1;
        let emitted = match (source_did >> 24) as u8 {
            0x01 => usize::from(
                decode_cache
                    .gfx_obj(repository, source_did)?
                    .physics_bsp
                    .is_some(),
            ),
            0x02 => {
                let setup = decode_cache.setup_model(repository, source_did)?;
                self.setup_parts += setup.parts.len();
                let mut collidable_parts = 0usize;
                for part_id in &setup.parts {
                    if decode_cache
                        .gfx_obj(repository, *part_id)?
                        .physics_bsp
                        .is_some()
                    {
                        collidable_parts += 1;
                    }
                }
                self.collidable_setup_parts += collidable_parts;
                if collidable_parts > 0 {
                    collidable_parts
                } else {
                    // Assembly's retail volume fallback: cylspheres, else spheres, only when no
                    // part carries a physics BSP. Independently recomputed as the parity oracle.
                    let volumes = if setup.cyl_spheres.is_empty() {
                        setup.spheres.len()
                    } else {
                        setup.cyl_spheres.len()
                    };
                    if volumes > 0 {
                        self.volume_records += 1;
                        self.emitted_volumes += volumes;
                    }
                    volumes
                }
            }
            _ => {
                self.unsupported_records += 1;
                return Ok(());
            }
        };
        if emitted == 0 {
            self.no_physics_records += 1;
        } else {
            self.consumed_records += 1;
            self.emitted_colliders += emitted;
        }
        Ok(())
    }
}

fn bsp_has_root_sphere(node: &BspNode) -> bool {
    match node {
        BspNode::Port(portal) => portal.sphere.is_some(),
        BspNode::Leaf(leaf) => leaf.sphere.is_some(),
        BspNode::Internal(internal) => internal.sphere.is_some(),
    }
}

fn grounded_route_spec(args: &Args, landblock_id: u32) -> Result<Option<GroundedRouteSpec>> {
    let Some(start) = args.grounded_start else {
        ensure!(
            args.grounded_drive.is_none() && args.grounded_cell.is_none(),
            "explicit grounded route options require --grounded-start"
        );
        return Ok(None);
    };
    let drive_velocity = args
        .grounded_drive
        .context("--grounded-start requires --grounded-drive")?;
    ensure!(
        drive_velocity.length_squared() > f32::EPSILON,
        "explicit grounded drive must be non-zero"
    );
    ensure!(
        args.grounded_ticks > 0,
        "explicit grounded route requires at least one driven tick"
    );
    let cell = args.grounded_cell.map(Guid);
    if let Some(cell) = cell {
        ensure!(
            cell.0 & 0xffff >= 0x0100,
            "--grounded-cell must name a full EnvCell DID"
        );
        ensure!(
            cell.0 & 0xffff_0000 == landblock_id & 0xffff_0000,
            "--grounded-cell must belong to the selected route landblock"
        );
    }
    let spheres = match args.grounded_body {
        GroundedRouteBody::Lower => GroundedBodySpheres {
            support: support_sphere(),
            upper: None,
        },
        GroundedRouteBody::Pair => production_pair(),
    };
    Ok(Some(GroundedRouteSpec {
        start,
        drive_velocity,
        cell,
        settle_ticks: args.grounded_settle_ticks,
        drive_ticks: args.grounded_ticks,
        spheres,
    }))
}

fn parse_vector3(value: &str) -> std::result::Result<Vector3, String> {
    let components = parse_finite_components(value, 3)?;
    Ok(Vector3::new(components[0], components[1], components[2]))
}

fn parse_horizontal_vector(value: &str) -> std::result::Result<Vector3, String> {
    let components = parse_finite_components(value, 2)?;
    Ok(Vector3::new(components[0], components[1], 0.0))
}

fn parse_finite_components(value: &str, expected: usize) -> std::result::Result<Vec<f32>, String> {
    let components = value
        .split(',')
        .map(|component| {
            component
                .trim()
                .parse::<f32>()
                .map_err(|error| format!("invalid vector component: {error}"))
        })
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if components.len() != expected {
        return Err(format!(
            "expected {expected} comma-separated components, received {}",
            components.len()
        ));
    }
    if components.iter().any(|component| !component.is_finite()) {
        return Err("vector components must be finite".to_owned());
    }
    Ok(components)
}

fn parse_did(value: &str) -> std::result::Result<u32, String> {
    let value = value.strip_prefix("0x").unwrap_or(value);
    u32::from_str_radix(value, 16).map_err(|error| format!("invalid hexadecimal DID: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_probe_does_not_require_an_explicit_grounded_route() {
        let args = Args::try_parse_from(["collision_scene_probe"]).unwrap();

        assert!(args.grounded_start.is_none());
        assert!(args.grounded_drive.is_none());
        assert_eq!(args.grounded_settle_ticks, 4);
        assert_eq!(args.grounded_ticks, 60);
    }

    #[test]
    fn explicit_grounded_route_parses_composite_geometry_and_policy() {
        let args = Args::try_parse_from([
            "collision_scene_probe",
            "--grounded-start",
            "129.0,180.355,21.6",
            "--grounded-drive=-4.0,-0.008",
            "--grounded-cell",
            "0xda550100",
            "--grounded-settle-ticks",
            "2",
            "--grounded-ticks",
            "10",
            "--grounded-body",
            "lower",
        ])
        .unwrap();
        let route = grounded_route_spec(&args, 0xda55_ffff).unwrap().unwrap();

        assert_eq!(route.start, Vector3::new(129.0, 180.355, 21.6));
        assert_eq!(route.drive_velocity, Vector3::new(-4.0, -0.008, 0.0));
        assert_eq!(route.cell, Some(Guid(0xda55_0100)));
        assert_eq!(route.settle_ticks, 2);
        assert_eq!(route.drive_ticks, 10);
        assert!(route.spheres.upper.is_none());
    }

    #[test]
    fn explicit_grounded_start_requires_a_drive_vector() {
        let error = Args::try_parse_from([
            "collision_scene_probe",
            "--grounded-start",
            "129.0,180.355,21.6",
        ])
        .unwrap_err();

        assert_eq!(
            error.kind(),
            clap::error::ErrorKind::MissingRequiredArgument
        );
    }
}
