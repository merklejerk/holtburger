//! Deterministic, asset-free stair transaction characterization through the current scene path.
//! Reference admission uses source-translated BSP logic, never production support helpers.

use std::{
    collections::HashMap,
    io::{self, Write},
    sync::Arc,
};

use anyhow::{Result, ensure};
use clap::Parser;
use holtburger_common::{Guid, Quaternion, Sphere, Vector3, position::WorldPosition};
use holtburger_content::{
    BspSolid, ColliderScale, CollisionBox, CollisionPolygon, CollisionShape, LandblockColliders,
    LandblockCollisionAsset, LandblockPlacement, PlacedCollider, StaticColliderPlacement,
    TerrainCollisionSurface,
};
use holtburger_dat::physics::{BspLeaf, BspNode};
use holtburger_debug_harness::{
    movement_probe::{ProbeBodyView, advance_probe_body, body_with_profile},
    retail_step_reference::{RETAIL_EPSILON, intersects_solid, select_walkable},
};
use holtburger_world::{
    CollisionScene, GroundedBodyActuation, GroundedBodySpheres, GroundedSphere,
    MOBILE_CONTACT_TICK_SECONDS, PhysicalBodyActuation, PhysicalBodyDefinition, PhysicalSphereSet,
    RETAIL_WALKABLE_NORMAL_Z,
};
use serde_json::json;

const OWNER: u32 = 0xda55ffff;
const JOIN_X: f32 = 96.0;
const EDGE_X: f32 = 95.5;
const EDGE_Z: f32 = 4.0;
const LOWER: GroundedSphere = GroundedSphere {
    center: Vector3 {
        x: 0.0,
        y: 0.0,
        z: 0.475,
    },
    radius: 0.48,
};
const UPPER: GroundedSphere = GroundedSphere {
    center: Vector3 {
        x: 0.0,
        y: 0.0,
        z: 1.35,
    },
    radius: 0.48,
};

#[derive(Parser)]
struct Args {
    /// Report label only; execution always uses the current runtime implementation.
    #[arg(long)]
    label: String,
    /// Uniform geometry/body scale; authored step heights scale with the fixture body.
    #[arg(long, default_value_t = 1.0)]
    scale: f32,
    /// Independent sphere-radius multiplier at the authored center offsets.
    #[arg(long, default_value_t = 1.0)]
    radius_factor: f32,
}

/// Fixture parameters, serialized in every row so each disagreement is independently reproducible.
#[derive(Clone, Copy, serde::Serialize)]
struct Case {
    /// Uniform body and geometry scale; authored step heights scale with it.
    scale: f32,
    /// Sphere-radius multiplier independent of authored center offsets.
    radius_factor: f32,
    /// Rise/run of the incoming support face.
    slope: f32,
    /// Landing height above the end of the incoming middle ramp, before scale.
    floor_delta: f32,
    /// Landing wall offset from the final ramp edge, before scale.
    seam: f32,
    /// Horizontal drive magnitude in meters/second before uniform scale.
    speed: f32,
    /// Additional safe distance from the first wall contact, before scale.
    retreat: f32,
    /// Drive angle relative to the source-edge normal in radians.
    angle: f32,
    /// Whether the body includes its authored upper constraint sphere.
    upper: bool,
    /// Whether a low ceiling limits the private lift route.
    ceiling: bool,
    /// Offset from the face center toward its finite side edge, before scale.
    lateral: f32,
}

fn polygon(vertices: Vec<Vector3>, normal: Vector3) -> CollisionPolygon {
    CollisionPolygon {
        d: -normal.dot(&vertices[0]),
        vertices,
        normal,
    }
}

fn ramp(x0: f32, x1: f32, z0: f32, slope: f32) -> CollisionPolygon {
    polygon(
        vec![
            Vector3::new(x0, 92.0, z0),
            Vector3::new(x1, 92.0, z0 + (x1 - x0) * slope),
            Vector3::new(x1, 100.0, z0 + (x1 - x0) * slope),
            Vector3::new(x0, 100.0, z0),
        ],
        Vector3::new(-slope, 0.0, 1.0).normalize(),
    )
}

fn solid(polygons: Vec<CollisionPolygon>) -> Arc<CollisionShape> {
    let polygons = polygons
        .into_iter()
        .enumerate()
        .map(|(index, polygon)| (index as u16, polygon))
        .collect::<HashMap<_, _>>();
    let box_bounds =
        CollisionBox::from_points(polygons.values().flat_map(|p| p.vertices.iter().copied()))
            .unwrap();
    let bounds = Sphere {
        center: box_bounds.center(),
        radius: box_bounds.circumradius(),
    };
    let mut poly_ids = polygons.keys().copied().collect::<Vec<_>>();
    poly_ids.sort_unstable();
    Arc::new(CollisionShape::Bsp(BspSolid {
        bsp: BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: Some(bounds),
            poly_ids,
        }),
        bounds,
        box_bounds,
        polygons,
    }))
}

fn placed(solid: Arc<CollisionShape>, index: usize, scale: f32) -> PlacedCollider {
    PlacedCollider::new(
        solid,
        LandblockPlacement {
            origin: fixture_origin(scale),
            orientation: Quaternion::identity(),
        },
        ColliderScale::uniform(scale).unwrap(),
        StaticColliderPlacement::OutdoorExplicit {
            source_index: index,
        },
    )
    .unwrap()
}

fn fixture_origin(scale: f32) -> Vector3 {
    Vector3::new(JOIN_X * (1.0 - scale), 96.0 * (1.0 - scale), 0.0)
}

fn fixture(case: Case) -> (CollisionScene, Vec<Arc<CollisionShape>>, Vector3) {
    let normal = Vector3::new(-case.slope, 0.0, 1.0).normalize();
    let radius = LOWER.radius * case.radius_factor;
    let x = JOIN_X - radius + RETAIL_EPSILON - case.retreat;
    let z = EDGE_Z + (x - EDGE_X) * case.slope + radius / normal.z - LOWER.center.z;
    let start = Vector3::new(x, 96.0 + case.lateral, z);
    let front = JOIN_X + case.seam;
    let floor = EDGE_Z + case.floor_delta;
    let mut geometry = vec![
        solid(vec![ramp(
            90.0,
            EDGE_X,
            EDGE_Z - (EDGE_X - 90.0) * case.slope,
            case.slope,
        )]),
        solid(vec![ramp(EDGE_X, JOIN_X, EDGE_Z, 0.5)]),
        solid(vec![
            polygon(
                vec![
                    Vector3::new(front, 92.0, floor - 1.0),
                    Vector3::new(front, 92.0, floor),
                    Vector3::new(front, 100.0, floor),
                    Vector3::new(front, 100.0, floor - 1.0),
                ],
                Vector3::new(-1.0, 0.0, 0.0),
            ),
            ramp(front, 104.0, floor, 0.0),
        ]),
    ];
    if case.ceiling {
        let top = if case.upper { UPPER } else { LOWER };
        let ceiling_z = start.z + top.center.z + top.radius * case.radius_factor + 0.2;
        geometry.push(solid(vec![polygon(
            vec![
                Vector3::new(90.0, 92.0, ceiling_z),
                Vector3::new(90.0, 100.0, ceiling_z),
                Vector3::new(104.0, 100.0, ceiling_z),
                Vector3::new(104.0, 92.0, ceiling_z),
            ],
            Vector3::new(0.0, 0.0, -1.0),
        )]));
    }
    let mut scene = CollisionScene::new();
    for dx in -1..=1 {
        for dy in -1..=1 {
            let owner =
                (((0xda_i32 + dx) as u32) << 24) | (((0x55_i32 + dy) as u32) << 16) | 0xffff;
            scene
                .insert(LandblockCollisionAsset {
                    landblock_id: owner,
                    terrain: TerrainCollisionSurface::empty(),
                    static_geometry: LandblockColliders::default(),
                })
                .unwrap();
        }
    }
    scene
        .insert(LandblockCollisionAsset {
            landblock_id: OWNER,
            terrain: TerrainCollisionSurface::empty(),
            static_geometry: LandblockColliders::new(
                geometry
                    .iter()
                    .cloned()
                    .enumerate()
                    .map(|(i, s)| placed(s, i, case.scale))
                    .collect(),
                Vec::new(),
            ),
        })
        .unwrap();
    (
        scene,
        geometry,
        fixture_origin(case.scale) + start * case.scale,
    )
}

fn run(case: Case) -> Result<serde_json::Value> {
    let (collision, geometry, start) = fixture(case);
    let scale_sphere = |sphere: GroundedSphere| GroundedSphere {
        center: sphere.center * case.scale,
        radius: sphere.radius * case.scale * case.radius_factor,
    };
    let spheres = GroundedBodySpheres {
        support: scale_sphere(LOWER),
        upper: case.upper.then(|| scale_sphere(UPPER)),
    };
    let mut profile = holtburger_core::retail_player_grounded_profile(
        holtburger_world::EdgeProtection::Creature,
    )?;
    let PhysicalBodyDefinition::Grounded { mut config, .. } = profile.definition else {
        anyhow::bail!("retail player must be grounded")
    };
    config.step_up_height *= case.scale;
    config.step_down_height *= case.scale;
    let step = config.step_up_height;
    let shape = |sphere: GroundedSphere| Sphere {
        center: sphere.center,
        radius: sphere.radius,
    };
    profile.definition = PhysicalBodyDefinition::grounded(
        PhysicalSphereSet::new(shape(spheres.support), spheres.upper.map(shape))?,
        config,
    )?;
    let body = body_with_profile(
        WorldPosition::from_outdoor_frame(Guid(OWNER), start, Quaternion::identity()),
        profile,
        None,
    )?;
    let settled = advance_probe_body(
        &collision,
        body,
        PhysicalBodyActuation::Grounded(GroundedBodyActuation::drive(Vector3::zero())?),
    )?
    .body;
    let target = Vector3::new(
        case.scale * case.speed * case.angle.cos(),
        case.scale * case.speed * case.angle.sin(),
        0.0,
    );
    let before = settled.pose.coords;
    let support = settled.ground().walkable_support();
    let requested = support
        .map(|s| target - s.normal * target.dot(&s.normal))
        .unwrap_or(Vector3::zero())
        * MOBILE_CONTACT_TICK_SECONDS;
    let attempted = before + requested;
    let reference = select_walkable(
        geometry[2].as_bsp().unwrap(),
        Sphere {
            center: (attempted + spheres.support.center - fixture_origin(case.scale)) / case.scale,
            radius: spheres.support.radius / case.scale,
        },
        Vector3::new(0.0, 0.0, -step / case.scale),
        Vector3::new(0.0, 0.0, 1.0),
        RETAIL_WALKABLE_NORMAL_Z,
    )?;
    let reference = match reference {
        None => json!({"admitted":false}),
        Some(selected) => {
            let root = fixture_origin(case.scale) + selected.sphere.center * case.scale
                - spheres.support.center;
            let mut blocked = false;
            for sphere in [Some(spheres.support), spheres.upper].into_iter().flatten() {
                for shape in &geometry {
                    let solid = shape.as_bsp().unwrap();
                    blocked |= intersects_solid(
                        &solid.bsp,
                        solid,
                        Sphere {
                            center: (root + sphere.center - fixture_origin(case.scale))
                                / case.scale,
                            radius: sphere.radius / case.scale,
                        },
                        true,
                    )?;
                }
            }
            json!({"admitted":true,"root":root,"walk_interp":selected.walk_interp,"placement_clear":!blocked})
        }
    };
    let movement = advance_probe_body(
        &collision,
        settled,
        PhysicalBodyActuation::Grounded(GroundedBodyActuation::drive(target)?),
    )?;
    let body = movement.body;
    Ok(
        json!({"case":case,"step_up_height":step,"before":before,"had_support":support.is_some(),"requested":requested,"reference":reference,
        "after":body.pose.coords,"cell":body.cell(),"support_normal":body.ground().walkable_support().map(|s|s.normal),
        "retained_velocity":body.retained.velocity,"path_legs":movement.motion.len()}),
    )
}

fn main() -> Result<()> {
    let args = Args::parse();
    ensure!(
        args.scale.is_finite() && args.scale > 0.0,
        "scale must be finite and positive"
    );
    ensure!(
        args.radius_factor.is_finite() && args.radius_factor > 0.0,
        "radius factor must be finite and positive"
    );
    let mut output = io::BufWriter::new(io::stdout().lock());
    writeln!(
        output,
        "{}",
        json!({"label":args.label,"workload":"stair-joins-v2","scale":args.scale,"radius_factor":args.radius_factor,"scope":"single-tick synthetic characterization; reference is polygon selection plus final placement, not full retail trajectory","dimensions":{"slope":[0.0,0.5,0.8],"floor_delta":[0.3,0.6,0.795,0.9],"seam":[-0.05,0.0,0.05],"speed":[1.0,2.0,4.0,8.0],"retreat":[0.0,0.01,0.03],"angle":[0.0,0.2],"upper":[false,true],"ceiling":[false,true],"lateral":[0.0,3.7]}})
    )?;
    for slope in [0.0, 0.5, 0.8] {
        for floor_delta in [0.3, 0.6, 0.795, 0.9] {
            for seam in [-0.05, 0.0, 0.05] {
                for speed in [1.0, 2.0, 4.0, 8.0] {
                    for retreat in [0.0, 0.01, 0.03] {
                        for angle in [0.0, 0.2] {
                            for upper in [false, true] {
                                for ceiling in [false, true] {
                                    for lateral in [0.0, 3.7] {
                                        writeln!(
                                            output,
                                            "{}",
                                            run(Case {
                                                scale: args.scale,
                                                radius_factor: args.radius_factor,
                                                slope,
                                                floor_delta,
                                                seam,
                                                speed,
                                                retreat,
                                                angle,
                                                upper,
                                                ceiling,
                                                lateral
                                            })?
                                        )?;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    output.flush()?;
    Ok(())
}
