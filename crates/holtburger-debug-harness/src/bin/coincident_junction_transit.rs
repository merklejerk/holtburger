//! Does the collision solver transit a zero-thickness portal junction?
//!
//! `collision.rs:2010` requires each successive plane crossing to advance:
//!
//! ```ignore
//! if fraction <= cursor + minimum_advance { return None; }
//! ```
//!
//! with `CELL_PLANE_TOLERANCE = 0.000_2` — structurally the same rule, and numerically the same
//! constant, as the renderer's `PORTAL_QUERY_EPSILON` entry-plane test that fails at coincident
//! portal junctions. This probe builds the degenerate topology the archive actually contains and
//! reports what `transit_motion_path` produces, so the question is answered by execution rather
//! than by reading.
//!
//! Two synthetic landblocks are compared:
//!
//! - `coincident`: cells A and B touch at x = 10 and each own only an **Outdoor** portal on that
//!   plane, exactly like two adjacent buildings whose transition apertures coincide.
//! - `direct`: the same geometry joined by a reciprocal EnvCell-to-EnvCell portal, the ordinary
//!   case, as a control.

use holtburger_common::{Guid, Plane, Quaternion, Vector3};
use holtburger_content::{
    CellCollisionPortal, CellCollisionPortalTarget, CellVolume, LandblockCollisionAsset,
    LandblockColliders, LandblockPlacement, TerrainCollisionSurface,
};
use holtburger_world::spatial::{
    CellTransitRequest, CollisionQuery, CollisionScene, MotionWaypoint, PlacedMotionPathRequest,
};

const LANDBLOCK: u32 = 0xda55_ffff;
const CELL_A: u32 = 0xda55_0100;
const CELL_B: u32 = 0xda55_0101;
/// Shared boundary plane; both cells' portals sit exactly here in the coincident case.
const JUNCTION_X: f32 = 10.0;

fn main() {
    report("coincident outdoor junction", build_scene(false));
    println!();
    report("direct reciprocal portal (control)", build_scene(true));
    println!();
    // Isolates traversal from containment: if a mover that never crosses the junction still fails
    // to commit cell B, the miss is in placement rather than in the advance rule.
    report_inside_b("placement while already inside cell B", build_scene(false));
    println!();
    probe_transit_cell("transit_cell at x=15, seeded from cell A", Some(Guid(CELL_A)), 15.0);
    for x in [10.5, 11.0, 12.0, 13.0, 14.0, 15.0, 19.0] {
        probe_transit_cell(&format!("transit_cell seeded outdoors at x={x}"), None, x);
    }
}

/// Direct placement probe so the reached-cell set is visible instead of only its committed result.
fn probe_transit_cell(label: &str, previous_cell: Option<Guid>, x: f32) {
    let scene = build_scene(false);
    match scene.transit_cell(CellTransitRequest {
        previous_cell,
        anchor: Guid(LANDBLOCK),
        center: Vector3::new(x, 1.0, 0.0),
        radius: 0.5,
    }) {
        Ok(CollisionQuery::Complete(placement)) => println!(
            "== {label}\n  committed={:?} reachesOutdoors={} reached={:?}",
            cell_label(placement.committed_cell()),
            placement.reaches_outdoors(),
            placement
                .reached_interior_cells()
                .iter()
                .filter_map(|cell| cell_label(Some(*cell)))
                .collect::<Vec<_>>(),
        ),
        Ok(CollisionQuery::MissingCoverage(missing)) => {
            println!("== {label}\n  missing coverage: {missing:?}")
        }
        Err(error) => println!("== {label}\n  error: {error:?}"),
    }
}

fn report_inside_b(label: &str, scene: CollisionScene) {
    println!("== {label}");
    let waypoints = [MotionWaypoint {
        center: Vector3::new(15.0, 1.0, 0.0),
        end_fraction: 1.0,
    }];
    let request = PlacedMotionPathRequest {
        anchor: Guid(LANDBLOCK),
        previous_cell: None,
        radius: 0.5,
        start: Vector3::new(14.0, 1.0, 0.0),
        waypoints: &waypoints,
    };
    match scene.transit_motion_path(request) {
        Ok(CollisionQuery::Complete(path)) => {
            println!(
                "  initial cell={:?} (start x=14)",
                cell_label(path.initial().placement().committed_cell())
            );
            for (index, leg) in path.legs().iter().enumerate() {
                println!(
                    "  leg {index} fraction={:.4} x={:.4} cell={:?}",
                    leg.end_fraction(),
                    leg.end().center().x,
                    cell_label(leg.end().placement().committed_cell())
                );
            }
            let final_cell = path.final_point().placement().committed_cell();
            println!(
                "  final cell={:?} recovery={:?} reachesOutdoors={}",
                cell_label(final_cell),
                path.final_point().recovery(),
                path.final_point().placement().reaches_outdoors(),
            );
        }
        Ok(CollisionQuery::MissingCoverage(missing)) => println!("  missing coverage: {missing:?}"),
        Err(error) => println!("  error: {error:?}"),
    }
}

fn report(label: &str, scene: CollisionScene) {
    println!("== {label}");
    let waypoints = [MotionWaypoint {
        // End well inside cell B so containment is unambiguous at the destination.
        center: Vector3::new(15.0, 1.0, 0.0),
        end_fraction: 1.0,
    }];
    let request = PlacedMotionPathRequest {
        anchor: Guid(LANDBLOCK),
        previous_cell: Some(Guid(CELL_A)),
        radius: 0.5,
        // Start well inside cell A.
        start: Vector3::new(5.0, 1.0, 0.0),
        waypoints: &waypoints,
    };
    match scene.transit_motion_path(request) {
        Ok(CollisionQuery::Complete(path)) => {
            println!(
                "  initial   cell={:?} recovery={:?}",
                cell_label(path.initial().placement().committed_cell()),
                path.initial().recovery()
            );
            for (index, leg) in path.legs().iter().enumerate() {
                println!(
                    "  leg {index}     fraction={:.4} center.x={:.4} cell={:?} recovery={:?}",
                    leg.end_fraction(),
                    leg.end().center().x,
                    cell_label(leg.end().placement().committed_cell()),
                    leg.end().recovery(),
                );
            }
            let final_cell = path.final_point().placement().committed_cell();
            println!("  final     cell={:?}", cell_label(final_cell));
            println!(
                "  VERDICT   {}",
                if final_cell == Some(Guid(CELL_B)) {
                    "reached cell B"
                } else {
                    "DID NOT reach cell B"
                }
            );
        }
        Ok(CollisionQuery::MissingCoverage(missing)) => {
            println!("  missing coverage: {missing:?}");
        }
        Err(error) => println!("  error: {error:?}"),
    }
}

fn cell_label(cell: Option<Guid>) -> Option<String> {
    cell.map(|cell| format!("0x{:08X}", cell.0))
}

/// Two abutting convex cells; `direct` selects an ordinary reciprocal seam instead of the junction.
fn build_scene(direct: bool) -> CollisionScene {
    let placement = LandblockPlacement {
        origin: Vector3::zero(),
        orientation: Quaternion::identity(),
    };
    let (a_target, b_target) = if direct {
        (
            CellCollisionPortalTarget::EnvCell(0x0101),
            CellCollisionPortalTarget::EnvCell(0x0100),
        )
    } else {
        (
            CellCollisionPortalTarget::Outdoor,
            CellCollisionPortalTarget::Outdoor,
        )
    };
    let cell_a = CellVolume {
        cell_selector: 0x0100,
        placement,
        planes: vec![
            Plane { normal: Vector3::new(1.0, 0.0, 0.0), d: 0.0 },
            Plane { normal: Vector3::new(-1.0, 0.0, 0.0), d: JUNCTION_X },
        ],
        portals: vec![CellCollisionPortal {
            plane: Plane { normal: Vector3::new(1.0, 0.0, 0.0), d: -JUNCTION_X },
            positive_side: true,
            target: a_target,
            outdoor_building: None,
        }],
    };
    let cell_b = CellVolume {
        cell_selector: 0x0101,
        placement,
        planes: vec![
            Plane { normal: Vector3::new(1.0, 0.0, 0.0), d: -JUNCTION_X },
            Plane { normal: Vector3::new(-1.0, 0.0, 0.0), d: 20.0 },
        ],
        portals: vec![CellCollisionPortal {
            // The same plane, oriented back toward cell A.
            plane: Plane { normal: Vector3::new(-1.0, 0.0, 0.0), d: JUNCTION_X },
            positive_side: true,
            target: b_target,
            outdoor_building: None,
        }],
    };
    let mut scene = CollisionScene::new();
    scene
        .insert(LandblockCollisionAsset {
            landblock_id: LANDBLOCK,
            terrain: TerrainCollisionSurface { cells: Vec::new() },
            static_geometry: LandblockColliders {
                colliders: Vec::new(),
                cell_volumes: vec![cell_a, cell_b],
            },
        })
        .expect("synthetic collision asset must insert");
    // Coverage refuses to answer while any landblock the swept sphere touches is absent, so the
    // eight neighbours are inserted empty.
    let x = (LANDBLOCK >> 24) & 0xff;
    let y = (LANDBLOCK >> 16) & 0xff;
    for dx in -1i32..=1 {
        for dy in -1i32..=1 {
            if dx == 0 && dy == 0 {
                continue;
            }
            let neighbour = ((((x as i32 + dx) as u32) & 0xff) << 24)
                | ((((y as i32 + dy) as u32) & 0xff) << 16)
                | 0xffff;
            scene
                .insert(LandblockCollisionAsset {
                    landblock_id: neighbour,
                    terrain: TerrainCollisionSurface { cells: Vec::new() },
                    static_geometry: LandblockColliders {
                        colliders: Vec::new(),
                        cell_volumes: Vec::new(),
                    },
                })
                .expect("synthetic neighbour must insert");
        }
    }
    scene
}
