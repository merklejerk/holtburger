//! Independent retail polygon StepUp admission diagnostic over canonical authored geometry.
//!
//! This audits BSP selection and both-sphere final placement for supplied object candidates.
//! It does not reconstruct retail cell/object visitation or whole-transition retries. A selected
//! polygon alone is never reported as a complete retail crossing verdict.

use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use clap::Parser;
use holtburger_common::{Sphere, Vector3};
use holtburger_content::{ContentDecodeCache, ContentRepository, LandblockCollisionAsset};
use holtburger_core::ContentAssetService;
use holtburger_debug_harness::retail_step_reference::{
    RETAIL_EPSILON, intersects_solid, select_walkable,
};
use serde_json::json;

#[derive(Parser)]
#[command(about = "Audit retail BSP StepUp candidate admission; not a full transition oracle")]
struct Args {
    /// Full outdoor owner DID as hexadecimal, with or without 0x.
    #[arg(long, default_value = "356fffff", value_parser = parse_hex)]
    landblock: u32,
    /// Optional content archive or directory; normal discovery applies when omitted.
    #[arg(long)]
    content: Option<std::path::PathBuf>,
    /// Supported root at the observed blocking point, formatted X,Y,Z.
    #[arg(long, default_value = "155.9990234,71.520203,37.760868", value_parser = parse_vector)]
    start: Vector3,
    /// Requested lower-sphere travel tangent, formatted X,Y,Z.
    #[arg(long, value_parser = parse_vector)]
    travel: Vector3,
    /// Authored lower-sphere offset at identity orientation, formatted X,Y,Z.
    #[arg(long, default_value = "0,0,0.475", value_parser = parse_vector)]
    sphere_offset: Vector3,
    /// Authored upper-sphere offset at identity orientation, formatted X,Y,Z.
    #[arg(long, default_value = "0,0,1.35", value_parser = parse_vector)]
    upper_offset: Vector3,
    /// Audit only the lower sphere when the fixture has no upper constraint.
    #[arg(long)]
    lower_only: bool,
    /// Authored lower sphere radius in world meters.
    #[arg(long, default_value_t = 0.48)]
    radius: f32,
    /// Authored supported StepUp amount in world meters.
    #[arg(long, default_value_t = 0.6)]
    step: f32,
    /// Incoming retail walkable allowance, independent of production constants.
    #[arg(long, default_value_t = 0.664_174_14)]
    walkable_allowance: f32,
}

/// Audit both sphere roles against final placed geometry, without using active collision queries.
/// Both center-check policies are reported because building interior reach controls that bit.
fn placement_audit(
    asset: &LandblockCollisionAsset,
    root: Vector3,
    args: &Args,
) -> serde_json::Value {
    let spheres = [
        ("lower", root + args.sphere_offset),
        ("upper", root + args.upper_offset),
    ];
    let mut blocked = Vec::new();
    let mut unresolved = Vec::new();
    for (role, center) in spheres
        .into_iter()
        .take(if args.lower_only { 1 } else { 2 })
    {
        for (index, collider) in asset.static_geometry.colliders.iter().enumerate() {
            let Some(solid) = collider.shape.as_bsp() else {
                if collider.bounds.intersects_sphere(center, args.radius) {
                    unresolved.push(
                        json!({"role":role,"collider":index,"reason":"non-polygon placement"}),
                    );
                }
                continue;
            };
            // Use the authored BSP root sphere, not production's tighter polygon AABB.
            // This retains the reference's center-solid leaf behavior at its broad boundary.
            let components = collider.scale.components();
            let broad_radius =
                solid.bounds.radius * components.x.max(components.y).max(components.z);
            let broad_center = collider.point_to_landblock_space(solid.bounds.center);
            if (broad_center - center).length_squared() > (broad_radius + args.radius).powi(2) {
                continue;
            }
            let Some(scale) = collider.scale.as_uniform() else {
                unresolved.push(
                    json!({"role":role,"collider":index,"reason":"nonuniform placement transform"}),
                );
                continue;
            };
            let sphere = Sphere {
                center: collider.placement.to_local_space(center) / scale,
                radius: args.radius / scale,
            };
            for center_check in [false, true] {
                match intersects_solid(&solid.bsp,solid,sphere,center_check) {
                    Ok(true) => blocked.push(json!({"role":role,"collider":index,"center_check":center_check})),
                    Ok(false) => {},
                    Err(error) => unresolved.push(json!({"role":role,"collider":index,"center_check":center_check,"reason":error.to_string()})),
                }
            }
        }
        // A conservative geometric proof is enough here: exclude XY-disjoint triangles,
        // then require the sphere's bottom above all vertices of every remaining triangle.
        // More complicated terrain placement states remain outside this reference envelope.
        let terrain_may_intersect = asset
            .terrain
            .cells
            .iter()
            .flat_map(|cell| &cell.triangles)
            .any(|triangle| {
                let minimum_x = triangle
                    .vertices
                    .iter()
                    .map(|v| v.x)
                    .fold(f32::INFINITY, f32::min);
                let maximum_x = triangle
                    .vertices
                    .iter()
                    .map(|v| v.x)
                    .fold(f32::NEG_INFINITY, f32::max);
                let minimum_y = triangle
                    .vertices
                    .iter()
                    .map(|v| v.y)
                    .fold(f32::INFINITY, f32::min);
                let maximum_y = triangle
                    .vertices
                    .iter()
                    .map(|v| v.y)
                    .fold(f32::NEG_INFINITY, f32::max);
                center.x + args.radius >= minimum_x
                    && center.x - args.radius <= maximum_x
                    && center.y + args.radius >= minimum_y
                    && center.y - args.radius <= maximum_y
                    && triangle
                        .vertices
                        .iter()
                        .any(|vertex| vertex.z >= center.z - args.radius)
            });
        if terrain_may_intersect {
            unresolved.push(json!({"role":role,"reason":"nearby terrain requires a finite triangle placement audit at this height"}));
        }
    }
    json!({"clear_for_both_center_policies":blocked.is_empty() && unresolved.is_empty(),"blocked":blocked,"unresolved":unresolved})
}

fn main() -> Result<()> {
    let args = Args::parse();
    ensure!(
        args.radius.is_finite() && args.radius > RETAIL_EPSILON,
        "radius must exceed retail epsilon"
    );
    ensure!(
        args.step.is_finite() && args.step > 0.0,
        "step must be finite and positive"
    );
    ensure!(
        args.walkable_allowance.is_finite() && (0.0..=1.0).contains(&args.walkable_allowance),
        "allowance must be in 0..=1"
    );
    let repository = Arc::new(ContentRepository::discover(args.content.clone())?);
    let cache = Arc::new(ContentDecodeCache::new());
    let service = ContentAssetService::new(Arc::clone(&repository), cache);
    let landblock = service
        .load_landblock(args.landblock)?
        .context("landblock is absent")?;
    let collision = service.resolve_collision(&landblock)?;
    let attempted = args.start + args.travel + args.sphere_offset;
    let mut candidates = Vec::new();
    let mut excluded = Vec::new();
    for (index, collider) in collision.static_geometry.colliders.iter().enumerate() {
        if !collider.bounds.intersects_sphere(attempted, args.radius) {
            continue;
        }
        let Some(solid) = collider.shape.as_bsp() else {
            excluded.push(json!({"collider":index,"reason":"non-polygon shape"}));
            continue;
        };
        let Some(scale) = collider.scale.as_uniform() else {
            excluded.push(json!({"collider":index,"reason":"nonuniform scale requires separate sphere-transform audit"}));
            continue;
        };
        let local = collider.placement.to_local_space(attempted) / scale;
        let local_up = collider
            .placement
            .orientation
            .conjugate()
            .rotate_vector(Vector3::new(0.0, 0.0, 1.0));
        let selection = match select_walkable(
            solid,
            Sphere {
                center: local,
                radius: args.radius / scale,
            },
            local_up * (-args.step / scale),
            local_up,
            args.walkable_allowance,
        ) {
            Ok(Some(selection)) => selection,
            Ok(None) => continue,
            Err(error) => {
                excluded.push(json!({"collider":index,"reason":error.to_string()}));
                continue;
            }
        };
        let polygon = selection.polygon;
        {
            candidates.push(json!({
                "collider":index,"domain":format!("{:?}",collider.source_placement),
                "polygon":polygon,"walk_interp":selection.walk_interp,
                "correction":collider.point_to_landblock_space(selection.sphere.center)-attempted,
                "candidate_root":collider.point_to_landblock_space(selection.sphere.center)-args.sphere_offset,
                "final_placement":placement_audit(&collision,collider.point_to_landblock_space(selection.sphere.center)-args.sphere_offset,&args),
            }));
        }
    }
    let mounted_sources = repository
        .mounted_sources()
        .iter()
        .map(|source| {
            let modified = source
                .modified
                .duration_since(std::time::UNIX_EPOCH)
                .context("mounted archive revision predates Unix epoch")?;
            Ok(json!({"path":source.path,"bytes":source.size,
            "modified_seconds":modified.as_secs(),"modified_nanoseconds":modified.subsec_nanos()}))
        })
        .collect::<Result<Vec<_>>>()?;
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "scope":"independent per-collider BSP admission and final placement; no cell/object visit ordering or full-transition verdict",
            "content":repository.source_description(),"mounted_sources":mounted_sources,"landblock":args.landblock,
            "attempted_lower_center":attempted,"placed_collider_denominator":collision.static_geometry.colliders.len(),
            "candidates":candidates,"exclusions":excluded,
        }))?
    );
    Ok(())
}

fn parse_hex(value: &str) -> std::result::Result<u32, String> {
    u32::from_str_radix(value.trim_start_matches("0x"), 16).map_err(|error| error.to_string())
}

fn parse_vector(value: &str) -> std::result::Result<Vector3, String> {
    let components = value
        .split(',')
        .map(str::parse::<f32>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    match components.as_slice() {
        [x, y, z] if components.iter().all(|v| v.is_finite()) => Ok(Vector3::new(*x, *y, *z)),
        _ => Err("expected three finite comma-separated components".into()),
    }
}
