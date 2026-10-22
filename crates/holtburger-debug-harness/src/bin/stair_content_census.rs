//! Enumerates authored stair-join candidates and replays a deterministic placement sample.
//! Shallow owner census is exhaustive over mounted, non-pruned CellLandblocks. Geometry and
//! movement sampling are explicitly bounded; no asset-level deduplication erases placements.

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_common::{
    Guid, Quaternion, Vector3,
    position::{METERS_PER_LANDBLOCK, WorldPosition},
};
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockCollisionAsset, LandblockSceneClass,
    StaticColliderPlacement,
};
use holtburger_core::{ContentAssetService, retail_player_grounded_profile};
use holtburger_dat::EOR_CELL_NAMESPACE;
use holtburger_debug_harness::movement_probe::{
    ProbeBodyView, advance_probe_body, collision_neighborhood, grounded_body,
};
use holtburger_world::{
    CollisionScene, GroundedBodyActuation, GroundedBodySpheres, GroundedSphere,
    PhysicalBodyActuation, PhysicalBodyDefinition, PlacementRequest, RETAIL_WALKABLE_NORMAL_Z,
    SpatialBody,
};
use serde_json::json;
use std::{
    collections::BTreeSet,
    io::{self, Write},
    sync::Arc,
};

#[derive(Parser)]
struct Args {
    /// Opened content archive/directory; canonical discovery is used when omitted.
    #[arg(long)]
    content: Option<std::path::PathBuf>,
    /// Output provenance label; movement always executes the compiled current solver.
    #[arg(long)]
    label: String,
    /// Maximum sampled geometry owners, including the reported owner and DA55 control.
    #[arg(long, default_value_t = 16)]
    owner_limit: usize,
    /// Maximum distinct source-edge routes replayed per selected owner.
    #[arg(long, default_value_t = 12)]
    routes_per_owner: usize,
    /// Exact number of driven fixed ticks in each placement replay.
    #[arg(long, default_value_t = 45)]
    ticks: usize,
}

/// One placed walkable face in the sampled owner's anchor frame.
struct Face {
    /// Authored owner DID before conversion into the sampled anchor frame.
    owner: u32,
    /// Stable collider ordinal in canonical assembly.
    collider: usize,
    /// Authored polygon selector in that placed BSP.
    polygon: u16,
    /// Placement record/cell identity retained across repeated assets.
    domain: StaticColliderPlacement,
    /// Upward unit normal in the sampled owner frame.
    normal: Vector3,
    /// Plane offset in that same frame.
    d: f32,
    /// Finite placed face vertices, preserving authored order.
    vertices: Vec<Vector3>,
}

/// One source edge with nearby higher authored faces, preserving object and cell identity.
struct Route {
    /// Source face ordinal in the placed-face census.
    face: usize,
    /// Source edge ordinal in authored polygon order.
    edge: usize,
    /// Source-derived standing root seed in the sampled owner frame.
    start: Vector3,
    /// Horizontal unit travel direction leaving the source edge.
    direction: Vector3,
    /// All higher placed faces admitted by the broad candidate envelope.
    targets: Vec<usize>,
}

fn anchor_point(point: Vector3, from: u32, to: u32) -> Vector3 {
    point
        + Vector3::new(
            (((from >> 24) & 255) as i32 - ((to >> 24) & 255) as i32) as f32 * METERS_PER_LANDBLOCK,
            (((from >> 16) & 255) as i32 - ((to >> 16) & 255) as i32) as f32 * METERS_PER_LANDBLOCK,
            0.0,
        )
}

fn faces(assets: &[LandblockCollisionAsset], anchor: u32) -> Vec<Face> {
    let mut result = Vec::new();
    for asset in assets {
        for (collider_index, collider) in asset.static_geometry.colliders.iter().enumerate() {
            let Some(solid) = collider.shape.as_bsp() else {
                continue;
            };
            let mut polygons = solid.polygons.iter().collect::<Vec<_>>();
            polygons.sort_by_key(|(id, _)| **id);
            for (id, polygon) in polygons {
                let normal = collider.normal_to_landblock_space(polygon.normal);
                if normal.z < RETAIL_WALKABLE_NORMAL_Z || polygon.vertices.len() < 3 {
                    continue;
                }
                let vertices = polygon
                    .vertices
                    .iter()
                    .map(|v| {
                        anchor_point(
                            collider.point_to_landblock_space(*v),
                            asset.landblock_id,
                            anchor,
                        )
                    })
                    .collect::<Vec<_>>();
                result.push(Face {
                    owner: asset.landblock_id,
                    collider: collider_index,
                    polygon: *id,
                    domain: collider.source_placement,
                    normal,
                    d: -normal.dot(&vertices[0]),
                    vertices,
                });
            }
        }
    }
    result
}

fn plane_height(face: &Face, point: Vector3) -> f32 {
    (-face.d - face.normal.x * point.x - face.normal.y * point.y) / face.normal.z
}

/// Broad candidate generation, deliberately independent of production support admission.
/// The XY box is only an inclusion envelope; full movement/reachability is measured by replay.
fn routes(faces: &[Face], anchor: u32, primary: GroundedSphere, step: f32) -> Vec<Route> {
    let mut routes = Vec::new();
    for (index, face) in faces.iter().enumerate().filter(|(_, f)| f.owner == anchor) {
        for edge in 0..face.vertices.len() {
            let a = face.vertices[edge];
            let b = face.vertices[(edge + 1) % face.vertices.len()];
            let delta = b - a;
            let outward = Vector3::new(delta.y, -delta.x, 0.0);
            if outward.length_squared() < 0.01 {
                continue;
            }
            let direction = outward.normalize();
            let midpoint = (a + b) * 0.5;
            let targets = faces
                .iter()
                .enumerate()
                .filter(|(target_index, target)| {
                    if *target_index == index {
                        return false;
                    }
                    let rise = plane_height(target, midpoint) - midpoint.z;
                    if !(0.02..=step + primary.radius * 2.0).contains(&rise) {
                        return false;
                    }
                    let reach = primary.radius + step;
                    let min_x = target
                        .vertices
                        .iter()
                        .map(|v| v.x)
                        .fold(f32::INFINITY, f32::min);
                    let max_x = target
                        .vertices
                        .iter()
                        .map(|v| v.x)
                        .fold(f32::NEG_INFINITY, f32::max);
                    let min_y = target
                        .vertices
                        .iter()
                        .map(|v| v.y)
                        .fold(f32::INFINITY, f32::min);
                    let max_y = target
                        .vertices
                        .iter()
                        .map(|v| v.y)
                        .fold(f32::NEG_INFINITY, f32::max);
                    midpoint.x + reach >= min_x
                        && midpoint.x - reach <= max_x
                        && midpoint.y + reach >= min_y
                        && midpoint.y - reach <= max_y
                })
                .map(|(i, _)| i)
                .collect::<Vec<_>>();
            if targets.is_empty() {
                continue;
            }
            let mut start = midpoint - direction * (primary.radius + 0.03);
            start.z = plane_height(face, start) + primary.radius / face.normal.z - primary.center.z;
            routes.push(Route {
                face: index,
                edge,
                start,
                direction,
                targets,
            });
        }
    }
    // Prioritize uphill ramp edges, then preserve deterministic placed-source enumeration.
    routes.sort_by_key(|r| {
        (
            (faces[r.face].normal.dot(&r.direction) >= -0.01) as u8,
            r.face,
            r.edge,
        )
    });
    routes
}

fn cell(domain: StaticColliderPlacement) -> Option<Guid> {
    match domain {
        StaticColliderPlacement::EnvCellShell { cell_id } => Some(Guid(cell_id)),
        StaticColliderPlacement::IndoorStatic { source_cell_id, .. } => Some(Guid(source_cell_id)),
        StaticColliderPlacement::OutdoorExplicit { .. }
        | StaticColliderPlacement::OutdoorGenerated { .. }
        | StaticColliderPlacement::BuildingShell { .. } => None,
    }
}

/// Audit the complete published sphere set in its owner-produced spatial membership.
fn placement_depth(scene: &CollisionScene, body: &SpatialBody, owner: u32) -> Result<f32> {
    let after = anchor_point(body.pose.coords, body.pose.landblock_id.0, owner);
    let physical = body
        .physical
        .as_ref()
        .context("census body lost installed physics")?;
    let membership = body.spatial_membership();
    let mut maximum_final_penetration = 0.0_f32;
    for sphere in physical.definition.spheres().iter() {
        let center = after + body.pose.rotation.rotate_vector(sphere.center);
        for contact in scene.placement_contacts(PlacementRequest {
            anchor: Guid(owner),
            center,
            radius: sphere.radius,
            placement: &membership,
        })? {
            maximum_final_penetration = maximum_final_penetration.max(contact.depth);
        }
    }
    Ok(maximum_final_penetration)
}

fn replay(
    scene: &CollisionScene,
    owner: u32,
    face: &Face,
    route: &Route,
    speed: f32,
    ticks: usize,
    spheres: GroundedBodySpheres,
) -> Result<serde_json::Value> {
    let cell = cell(face.domain);
    let pose = match cell {
        Some(cell) => WorldPosition {
            landblock_id: cell,
            coords: route.start,
            rotation: Quaternion::identity(),
        },
        None => WorldPosition::from_outdoor_frame(Guid(owner), route.start, Quaternion::identity()),
    };
    let mut body = grounded_body(pose, spheres, cell)?;
    for _ in 0..3 {
        body = advance_probe_body(
            scene,
            body,
            PhysicalBodyActuation::Grounded(GroundedBodyActuation::drive(Vector3::zero())?),
        )?
        .body;
    }
    let before = anchor_point(body.pose.coords, body.pose.landblock_id.0, owner);
    let initially_supported = body.ground().walkable_support().is_some();
    let initial_maximum_penetration = placement_depth(scene, &body, owner)?;
    let mut minimum_progress = f32::INFINITY;
    let mut path_legs = 0;
    for _ in 0..ticks {
        let previous = anchor_point(body.pose.coords, body.pose.landblock_id.0, owner);
        let movement = advance_probe_body(
            scene,
            body,
            PhysicalBodyActuation::Grounded(GroundedBodyActuation::drive(route.direction * speed)?),
        )?;
        body = movement.body;
        path_legs += movement.motion.len();
        let current = anchor_point(body.pose.coords, body.pose.landblock_id.0, owner);
        minimum_progress = minimum_progress.min((current - previous).dot(&route.direction));
    }
    let after = anchor_point(body.pose.coords, body.pose.landblock_id.0, owner);
    let maximum_final_penetration = placement_depth(scene, &body, owner)?;
    Ok(
        json!({"initially_supported":initially_supported,"initial_maximum_penetration":initial_maximum_penetration,"before":before,"after":after,
        "forward":(after-before).dot(&route.direction),"minimum_tick_progress":minimum_progress,
        "final_pose":body.pose,"cell":body.cell(),"support_normal":body.ground().walkable_support().map(|s|s.normal),
        "retained_velocity":body.retained.velocity,"path_legs":path_legs,"maximum_final_penetration":maximum_final_penetration}),
    )
}

fn main() -> Result<()> {
    let args = Args::parse();
    ensure!(
        args.owner_limit >= 2,
        "owner limit must include both fixed controls"
    );
    ensure!(args.routes_per_owner > 0, "route limit must be positive");
    ensure!(args.ticks > 0, "tick count must be positive");
    let repository = Arc::new(ContentRepository::discover(args.content)?);
    let service =
        ContentAssetService::new(Arc::clone(&repository), Arc::new(ContentDecodeCache::new()));
    let owners = repository
        .resource_index()
        .iter()
        .filter(|e| {
            e.namespace == EOR_CELL_NAMESPACE && e.file_id & 0xffff == 0xffff && !e.is_pruned
        })
        .map(|e| e.file_id)
        .collect::<BTreeSet<_>>();
    let mut building_owners = Vec::new();
    let mut buildings = 0;
    let mut explicit = 0;
    let mut dungeon_owners = 0;
    for owner in &owners {
        let landblock = service
            .load_landblock(*owner)?
            .with_context(|| format!("indexed owner {owner:08X} is absent"))?;
        buildings += landblock.buildings.len();
        explicit += landblock.explicit_objects.len();
        if landblock.scene_class == LandblockSceneClass::DungeonOnly {
            dungeon_owners += 1;
            continue;
        }
        if !landblock.buildings.is_empty() {
            building_owners.push(*owner);
        }
    }
    ensure!(
        !building_owners.is_empty(),
        "mounted content has no outdoor building owners"
    );
    let mut selected = BTreeSet::from([0x356fffff, 0xda55ffff]);
    for index in 0..args.owner_limit - 2 {
        selected.insert(building_owners[index * building_owners.len() / (args.owner_limit - 2)]);
    }
    let profile = retail_player_grounded_profile(holtburger_world::EdgeProtection::Creature)?;
    let PhysicalBodyDefinition::Grounded { spheres, config } = profile.definition else {
        anyhow::bail!("retail player profile must be grounded")
    };
    let revisions = repository
        .mounted_sources()
        .iter()
        .map(|s| json!({"path":s.path,"bytes":s.size,"modified":format!("{:?}",s.modified)}))
        .collect::<Vec<_>>();
    let mut output = io::BufWriter::new(io::stdout().lock());
    writeln!(
        output,
        "{}",
        json!({"record":"census","label":args.label,"workload":"authored-stair-joins-v1",
        "indexed_owner_denominator":owners.len(),"outdoor_building_owners":building_owners.len(),"dungeon_owners_excluded_from_geometry_sample":dungeon_owners,
        "building_instances":buildings,"explicit_instances":explicit,"sampled_owners":selected,"routes_per_owner_limit":args.routes_per_owner,"driven_ticks":args.ticks,
        "speeds":[1.0,4.0,8.0],"mounted_sources":revisions,"scope":"all shallow owner metadata; deterministic sample of placed static joins with 3x3 collision neighborhoods; no dynamic peers or universal pose coverage"})
    )?;
    for owner in selected {
        let center = service
            .load_landblock(owner)?
            .with_context(|| format!("sampled owner {owner:08X} is absent"))?;
        let neighborhood =
            collision_neighborhood(&service, service.resolve_collision(&center)?, 1)?;
        let assets = neighborhood.assets;
        let missing = neighborhood.unavailable_owners;
        let placed_faces = faces(&assets, owner);
        let routes = routes(&placed_faces, owner, spheres.support, config.step_up_height);
        let mut scene = CollisionScene::new();
        let collider_count = assets
            .iter()
            .map(|a| a.static_geometry.colliders.len())
            .sum::<usize>();
        let cell_count = assets
            .iter()
            .map(|a| a.static_geometry.cell_volumes().len())
            .sum::<usize>();
        for asset in assets {
            scene.insert(asset)?;
        }
        let count = routes.len().min(args.routes_per_owner);
        let cross_placement_edges = routes
            .iter()
            .filter(|r| {
                r.targets.iter().any(|i| {
                    placed_faces[*i].owner != placed_faces[r.face].owner
                        || placed_faces[*i].domain != placed_faces[r.face].domain
                })
            })
            .count();
        let cross_cell_edges = routes
            .iter()
            .filter(|r| {
                r.targets
                    .iter()
                    .any(|i| cell(placed_faces[*i].domain) != cell(placed_faces[r.face].domain))
            })
            .count();
        let cross_owner_edges = routes
            .iter()
            .filter(|r| {
                r.targets
                    .iter()
                    .any(|i| placed_faces[*i].owner != placed_faces[r.face].owner)
            })
            .count();
        writeln!(
            output,
            "{}",
            json!({"record":"owner","owner":owner,"neighbor_colliders":collider_count,"neighbor_cells":cell_count,"walkable_placed_faces":placed_faces.len(),
            "candidate_edges":routes.len(),"cross_placement_edges":cross_placement_edges,"cross_cell_edges":cross_cell_edges,"cross_owner_edges":cross_owner_edges,"replayed_edges":count,"excluded_by_route_sample":routes.len()-count,"unavailable_owners":missing})
        )?;
        for route in routes.iter().take(count) {
            let source = &placed_faces[route.face];
            for speed in [1.0, 4.0, 8.0] {
                let outcome = match replay(&scene, owner, source, route, speed, args.ticks, spheres)
                {
                    Ok(value) => json!({"solved":value}),
                    Err(error) => json!({"unresolved":format!("{error:#}")}),
                };
                let targets=route.targets.iter().map(|i|{let f=&placed_faces[*i];json!({"owner":f.owner,"collider":f.collider,"polygon":f.polygon,"domain":format!("{:?}",f.domain)})}).collect::<Vec<_>>();
                writeln!(
                    output,
                    "{}",
                    json!({"record":"route","owner":owner,"collider":source.collider,"polygon":source.polygon,"edge":route.edge,"domain":format!("{:?}",source.domain),
                    "start":route.start,"direction":route.direction,"speed":speed,"targets":targets,"outcome":outcome})
                )?;
            }
        }
        output.flush()?;
    }
    output.flush()?;
    Ok(())
}
