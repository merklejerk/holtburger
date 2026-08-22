//! Bounded static-collision movement for unregistered spheres and collinear sphere casts.

use anyhow::{Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};

use super::PhysicalCollisionFilter;
use super::collision::{
    CellTransitRequest, CollisionPlacement, CollisionScene, MotionWaypoint,
    MovementObstructionRequest, MovementRestrictionRequest, PlacementRequest,
    PlacementRestrictionRequest, SphereSweep, StaticContact, anchor_point_to_outdoor_position,
    landblock_key, separating_displacement,
};

/// Explicit safety budgets for one free-sphere displacement solve.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FreeSphereConfig {
    /// Maximum world-meter length of one collision substep.
    pub maximum_substep_distance: f32,
    /// Maximum number of substeps accepted for one requested displacement.
    pub maximum_substeps: usize,
    /// Maximum separation passes per substep.
    pub maximum_contact_passes: usize,
    /// Small outward displacement added after contact separation.
    pub separation_epsilon: f32,
}

/// Finite work and surface-clearance policy for one collinear static sphere cast.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StaticSphereCastConfig {
    /// Maximum world-meter length of one anti-tunneling probe.
    pub maximum_substep_distance: f32,
    /// Maximum number of probes accepted for one requested cast.
    pub maximum_substeps: usize,
    /// Distance retained before the first obstructed point after refinement.
    pub surface_clearance: f32,
}

/// One sphere cast that may transit portals but may never slide away from its authored ray.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StaticSphereCastRequest {
    /// Start pose carrying the outdoor landblock frame for the cast.
    pub origin: WorldPosition,
    /// Prior interior cell used to seed portal traversal around `origin`, or `None` outdoors.
    pub cell: Option<Guid>,
    /// Cast direction; normalized internally.
    pub direction: Vector3,
    /// Maximum distance to test along `direction`.
    pub distance: f32,
    /// Positive sphere radius.
    pub radius: f32,
    /// Optional collision-domain exclusions owned by the querying sphere.
    pub filter: PhysicalCollisionFilter,
}

/// Farthest collision-safe point reached on one cast ray and its authoritative placement.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StaticSphereCastOutcome {
    /// Interior cell containing the cast's origin sphere after portal transit.
    pub origin_cell: Option<Guid>,
    /// Collision-safe pose, normalized to its final outdoor owner.
    pub pose: WorldPosition,
    /// Interior cell committed by portal transit, or `None` while outdoors.
    pub cell: Option<Guid>,
    /// Distance from the requested origin to `pose` along the cast ray.
    pub distance: f32,
    /// Whether static geometry shortened the requested cast.
    pub obstructed: bool,
}

/// One unregistered free sphere and its atomically committed cell context.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FreeSphereState {
    /// Current solved pose.
    pub pose: WorldPosition,
    /// Current interior cell, or `None` while outdoors.
    pub cell: Option<Guid>,
    /// Positive fixed radius in meters.
    pub radius: f32,
}

/// One desired free-sphere displacement.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FreeSphereRequest {
    /// Last safely committed body state.
    pub body: FreeSphereState,
    /// World-space displacement requested for this solve.
    pub displacement: Vector3,
    /// Body-owned optional collision-domain exclusions.
    pub filter: PhysicalCollisionFilter,
}

/// Which finite solver budget refused a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FreeSphereBudget {
    /// The displacement requires more anti-tunneling substeps than configured.
    Substeps,
    /// Contact separation did not converge inside one substep's pass budget.
    Contacts,
}

/// Observable result of one free-sphere solve.
#[derive(Debug, Clone, PartialEq)]
pub enum FreeSphereOutcome {
    /// The requested displacement completed, possibly after collision separation and sliding.
    Solved {
        /// Atomically committed body state.
        body: FreeSphereState,
        /// Actual world-space displacement from the request's starting pose.
        achieved_displacement: Vector3,
        /// Strongest unit contact normal opposing the requested displacement, if any.
        collision_normal: Option<Vector3>,
        /// Ordered accepted substep endpoints spanning the normalized solve interval.
        motion: Vec<MotionWaypoint>,
        /// Anti-tunneling substeps evaluated.
        substeps: usize,
        /// Contact passes evaluated across all substeps.
        contact_passes: usize,
    },
    /// A finite safety budget was reached; the last safe state is held.
    BudgetExceeded {
        /// Last safely committed body state.
        body: FreeSphereState,
        /// Budget that stopped the solve.
        budget: FreeSphereBudget,
        /// Completed substeps before the stop.
        substeps: usize,
        /// Contact passes evaluated before the stop.
        contact_passes: usize,
    },
}

/// Solves one bounded free-sphere displacement without grounded behavior.
pub fn solve_free_sphere(
    scene: &CollisionScene,
    config: FreeSphereConfig,
    request: FreeSphereRequest,
) -> Result<FreeSphereOutcome> {
    validate(config, request.body.radius, request.displacement)?;
    let anchor = landblock_key(request.body.pose.landblock_id);
    let start = request.body.pose.coords;
    let distance = request.displacement.length();
    let required_substeps = if distance <= f32::EPSILON {
        1
    } else {
        (distance / config.maximum_substep_distance).ceil() as usize
    };
    if required_substeps > config.maximum_substeps {
        return Ok(FreeSphereOutcome::BudgetExceeded {
            body: request.body,
            budget: FreeSphereBudget::Substeps,
            substeps: 0,
            contact_passes: 0,
        });
    }

    let substep = request.displacement / required_substeps as f32;
    let mut body = request.body;
    let mut current = start;
    let mut motion = Vec::with_capacity(required_substeps);
    let mut contact_passes = 0usize;
    let mut collision_normal = None;
    for completed_substeps in 0..required_substeps {
        let mut candidate = current + substep;
        let mut candidate_placement = transit(scene, anchor, body, candidate)?;
        let mut converged = false;
        let sweep = SphereSweep {
            anchor,
            start: current,
            end: candidate,
            radius: body.radius,
        };
        let mut contacts = movement_contacts(scene, sweep, &candidate_placement, request.filter)?;

        for _ in 0..config.maximum_contact_passes {
            contact_passes += 1;
            if contacts.is_empty() {
                converged = true;
                break;
            }

            remember_collision_normal(&mut collision_normal, &contacts, request.displacement);

            candidate = candidate + separating_displacement(&contacts, config.separation_epsilon);
            candidate_placement = transit(scene, anchor, body, candidate)?;
            contacts = placement_contacts(
                scene,
                anchor,
                candidate,
                body.radius,
                &candidate_placement,
                request.filter,
            )?;
            if contacts.is_empty() {
                converged = true;
                break;
            }
        }

        if !converged {
            return Ok(FreeSphereOutcome::BudgetExceeded {
                body,
                budget: FreeSphereBudget::Contacts,
                substeps: completed_substeps,
                contact_passes,
            });
        }

        current = candidate;
        body.cell = candidate_placement.committed_cell();
        body.pose = pose_for_commit(
            anchor,
            current,
            request.body.pose,
            candidate_placement.committed_cell(),
        );
        motion.push(MotionWaypoint {
            center: current,
            end_fraction: (completed_substeps + 1) as f32 / required_substeps as f32,
            placement: super::collision::MotionWaypointPlacement::Committed(body.cell),
        });
    }

    Ok(FreeSphereOutcome::Solved {
        body,
        achieved_displacement: current - start,
        collision_normal,
        motion,
        substeps: required_substeps,
        contact_passes,
    })
}

/// Cast one sphere strictly along a ray, stopping before the first static obstruction.
///
/// This deliberately does not reuse free-flight's solved displacement: free flight separates and
/// then continues tangentially after contact, while a boom-style clearance query must answer only
/// how much of its original ray is collision-free. Portal transit remains authoritative and is
/// returned beside the final point so callers never have to infer residency from containment.
pub fn cast_static_sphere(
    scene: &CollisionScene,
    config: StaticSphereCastConfig,
    request: StaticSphereCastRequest,
) -> Result<StaticSphereCastOutcome> {
    validate_static_sphere_cast(config, request)?;
    let direction = request.direction / request.direction.length();
    let anchor = landblock_key(request.origin.landblock_id);
    let start = request.origin.coords;
    let mut current_distance = 0.0;
    let mut current = start;
    let mut current_cell = request.cell;
    let initial_placement = transit_sphere(scene, anchor, current_cell, current, request.radius)?;

    ensure!(
        placement_contacts(
            scene,
            anchor,
            current,
            request.radius,
            &initial_placement,
            request.filter,
        )?
        .is_empty(),
        "static sphere cast origin overlaps collision geometry"
    );
    let origin_cell = initial_placement.committed_cell();
    current_cell = origin_cell;

    while current_distance < request.distance {
        let next_distance =
            (current_distance + config.maximum_substep_distance).min(request.distance);
        let next = start + direction * next_distance;
        let next_placement = transit_sphere(scene, anchor, current_cell, next, request.radius)?;
        if sphere_cast_segment_is_clear(
            scene,
            anchor,
            current,
            next,
            request.radius,
            &next_placement,
            request.filter,
        )? {
            current = next;
            current_distance = next_distance;
            current_cell = next_placement.committed_cell();
            continue;
        }

        let mut clear_distance = current_distance;
        let mut blocked_distance = next_distance;
        while blocked_distance - clear_distance > config.surface_clearance {
            let candidate_distance = (clear_distance + blocked_distance) * 0.5;
            let candidate = start + direction * candidate_distance;
            let candidate_placement =
                transit_sphere(scene, anchor, current_cell, candidate, request.radius)?;
            if sphere_cast_segment_is_clear(
                scene,
                anchor,
                current,
                candidate,
                request.radius,
                &candidate_placement,
                request.filter,
            )? {
                clear_distance = candidate_distance;
            } else {
                blocked_distance = candidate_distance;
            }
        }

        let safe_distance = (clear_distance - config.surface_clearance).max(current_distance);
        let safe = start + direction * safe_distance;
        let safe_placement = transit_sphere(scene, anchor, current_cell, safe, request.radius)?;
        return Ok(static_sphere_cast_outcome(
            anchor,
            request.origin,
            origin_cell,
            safe,
            safe_placement,
            safe_distance,
            true,
        ));
    }

    let placement = transit_sphere(scene, anchor, current_cell, current, request.radius)?;
    Ok(static_sphere_cast_outcome(
        anchor,
        request.origin,
        origin_cell,
        current,
        placement,
        current_distance,
        false,
    ))
}

fn sphere_cast_segment_is_clear(
    scene: &CollisionScene,
    anchor: Guid,
    start: Vector3,
    end: Vector3,
    radius: f32,
    placement: &CollisionPlacement,
    filter: PhysicalCollisionFilter,
) -> Result<bool> {
    let sweep = SphereSweep {
        anchor,
        start,
        end,
        radius,
    };
    Ok(
        movement_contacts(scene, sweep, placement, filter)?.is_empty()
            && placement_contacts(scene, anchor, end, radius, placement, filter)?.is_empty(),
    )
}

fn transit_sphere(
    scene: &CollisionScene,
    anchor: Guid,
    previous_cell: Option<Guid>,
    center: Vector3,
    radius: f32,
) -> Result<CollisionPlacement> {
    Ok(scene.transit_cell(CellTransitRequest {
        previous_cell,
        anchor,
        center,
        radius,
    })?)
}

fn static_sphere_cast_outcome(
    anchor: Guid,
    original: WorldPosition,
    origin_cell: Option<Guid>,
    point: Vector3,
    placement: CollisionPlacement,
    distance: f32,
    obstructed: bool,
) -> StaticSphereCastOutcome {
    let cell = placement.committed_cell();
    StaticSphereCastOutcome {
        origin_cell,
        pose: pose_for_commit(anchor, point, original, cell),
        cell,
        distance,
        obstructed,
    }
}

fn movement_contacts(
    scene: &CollisionScene,
    sweep: SphereSweep,
    placement: &CollisionPlacement,
    filter: PhysicalCollisionFilter,
) -> Result<Vec<StaticContact>> {
    let mut contacts =
        scene.movement_obstructions(MovementObstructionRequest { sweep, placement })?;
    contacts.extend(scene.movement_restrictions(MovementRestrictionRequest {
        sweep,
        placement,
        filter,
    })?);
    Ok(contacts)
}

fn placement_contacts(
    scene: &CollisionScene,
    anchor: Guid,
    center: Vector3,
    radius: f32,
    placement: &CollisionPlacement,
    filter: PhysicalCollisionFilter,
) -> Result<Vec<StaticContact>> {
    let mut contacts = scene.placement_contacts(PlacementRequest {
        anchor,
        center,
        radius,
        placement,
    })?;
    contacts.extend(scene.placement_restrictions(PlacementRestrictionRequest {
        anchor,
        center,
        radius,
        placement,
        filter,
    })?);
    Ok(contacts)
}

fn remember_collision_normal(
    selected: &mut Option<Vector3>,
    contacts: &[super::StaticContact],
    requested_displacement: Vector3,
) {
    for contact in contacts {
        let length_squared = contact.normal.length_squared();
        if length_squared <= f32::EPSILON || !length_squared.is_finite() {
            continue;
        }
        let normal = contact.normal / length_squared.sqrt();
        let opposition = requested_displacement.dot(&normal);
        if opposition >= 0.0 {
            continue;
        }
        if selected.is_none_or(|current| opposition < requested_displacement.dot(&current)) {
            *selected = Some(normal);
        }
    }
}

fn transit(
    scene: &CollisionScene,
    anchor: Guid,
    body: FreeSphereState,
    center: Vector3,
) -> Result<CollisionPlacement> {
    Ok(scene.transit_cell(CellTransitRequest {
        previous_cell: body.cell,
        anchor,
        center,
        radius: body.radius,
    })?)
}

fn pose_for_commit(
    anchor: Guid,
    point: Vector3,
    original: WorldPosition,
    cell: Option<Guid>,
) -> WorldPosition {
    let mut pose = anchor_point_to_outdoor_position(anchor, point, original.rotation);
    if let Some(cell) = cell {
        pose.landblock_id = cell;
    }
    pose
}

fn validate(config: FreeSphereConfig, radius: f32, displacement: Vector3) -> Result<()> {
    ensure!(
        radius.is_finite() && radius > 0.0,
        "physical-fly radius must be finite and positive"
    );
    ensure!(
        displacement.x.is_finite() && displacement.y.is_finite() && displacement.z.is_finite(),
        "free-sphere displacement must be finite"
    );
    ensure!(
        config.maximum_substep_distance.is_finite() && config.maximum_substep_distance > 0.0,
        "physical-fly maximum substep distance must be finite and positive"
    );
    ensure!(
        config.maximum_substeps > 0,
        "physical-fly requires at least one substep"
    );
    ensure!(
        config.maximum_contact_passes > 0,
        "physical-fly requires at least one contact pass"
    );
    ensure!(
        config.separation_epsilon.is_finite() && config.separation_epsilon > 0.0,
        "physical-fly separation epsilon must be finite and positive"
    );
    Ok(())
}

fn validate_static_sphere_cast(
    config: StaticSphereCastConfig,
    request: StaticSphereCastRequest,
) -> Result<()> {
    ensure!(
        request.direction.x.is_finite()
            && request.direction.y.is_finite()
            && request.direction.z.is_finite()
            && request.direction.length() > f32::EPSILON,
        "static sphere cast direction must be non-zero and finite"
    );
    ensure!(
        request.distance.is_finite() && request.distance >= 0.0,
        "static sphere cast distance must be finite and non-negative"
    );
    ensure!(
        request.radius.is_finite() && request.radius > 0.0,
        "static sphere cast radius must be finite and positive"
    );
    ensure!(
        config.maximum_substep_distance.is_finite() && config.maximum_substep_distance > 0.0,
        "static sphere cast maximum substep distance must be finite and positive"
    );
    ensure!(
        config.maximum_substeps > 0,
        "static sphere cast requires at least one substep"
    );
    ensure!(
        config.surface_clearance.is_finite() && config.surface_clearance > 0.0,
        "static sphere cast surface clearance must be finite and positive"
    );
    ensure!(
        request.distance <= config.maximum_substep_distance * config.maximum_substeps as f32,
        "static sphere cast distance {} exceeds the configured budget {}",
        request.distance,
        config.maximum_substep_distance * config.maximum_substeps as f32
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use holtburger_common::{Plane, Quaternion, Sphere};
    use holtburger_content::{
        BspSolid, CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale,
        CollisionBox, CollisionPolygon, CollisionShape, LandblockColliders,
        LandblockCollisionAsset, LandblockPlacement, LandblockTerrain, PlacedCollider,
        StaticColliderPlacement, TERRAIN_WATER_COLLISION_DEPTH, TerrainCellDiagonals,
        TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode, InternalNode};

    use super::*;

    const LANDBLOCK: u32 = 0xda55_ffff;
    const EAST: u32 = 0xdb55_ffff;
    const WATER_TERRAIN_SAMPLE: u16 = 0x10 << 2;

    fn config() -> FreeSphereConfig {
        FreeSphereConfig {
            maximum_substep_distance: 0.5,
            maximum_substeps: 64,
            maximum_contact_passes: 8,
            separation_epsilon: 0.000_5,
        }
    }

    fn cast_config() -> StaticSphereCastConfig {
        StaticSphereCastConfig {
            maximum_substep_distance: 0.5,
            maximum_substeps: 64,
            surface_clearance: 0.000_5,
        }
    }

    fn pose(landblock: u32, local: Vector3) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(landblock),
            coords: local,
            rotation: Quaternion::identity(),
        }
        .normalize_outdoor_cell()
    }

    fn body(local: Vector3) -> FreeSphereState {
        FreeSphereState {
            pose: pose(LANDBLOCK, local),
            cell: None,
            radius: 1.0,
        }
    }

    fn flat_terrain(landblock: u32) -> TerrainCollisionSurface {
        terrain_with_sample(landblock, 0)
    }

    fn terrain_with_sample(landblock: u32, terrain_sample: u16) -> TerrainCollisionSurface {
        TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![0.0; 81],
            terrain_samples: vec![terrain_sample; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(landblock),
        })
        .unwrap()
    }

    fn artifact(
        landblock: u32,
        colliders: Vec<PlacedCollider>,
        cell_volumes: Vec<CellVolume>,
    ) -> LandblockCollisionAsset {
        LandblockCollisionAsset {
            landblock_id: landblock,
            terrain: flat_terrain(landblock),
            static_geometry: LandblockColliders {
                colliders,
                cell_volumes,
            },
        }
    }

    fn half_space(plane: Plane, positive_is_solid: bool, is_building: bool) -> PlacedCollider {
        let surface_point = plane.normal * (-plane.d / plane.normal.length_squared());
        let outward = if positive_is_solid {
            plane.normal.normalize() * -1.0
        } else {
            plane.normal.normalize()
        };
        let tangent = if outward.z.abs() < 0.9 {
            outward.cross(&Vector3::new(0.0, 0.0, 1.0)).normalize()
        } else {
            outward.cross(&Vector3::new(1.0, 0.0, 0.0)).normalize()
        };
        let bitangent = outward.cross(&tangent);
        let extent = 200.0;
        let polygon = CollisionPolygon {
            vertices: vec![
                surface_point - tangent * extent - bitangent * extent,
                surface_point + tangent * extent - bitangent * extent,
                surface_point + tangent * extent + bitangent * extent,
                surface_point - tangent * extent + bitangent * extent,
            ],
            normal: outward,
            d: -outward.dot(&surface_point),
        };
        let box_bounds = CollisionBox::from_points(polygon.vertices.iter().copied()).unwrap();
        let solid = BspNode::Leaf(BspLeaf {
            index: 1,
            solid: 1,
            sphere: None,
            poly_ids: vec![1],
        });
        let empty = BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: None,
            poly_ids: Vec::new(),
        });
        let (positive, negative) = if positive_is_solid {
            (solid, empty)
        } else {
            (empty, solid)
        };
        let bounds = Sphere {
            center: Vector3::new(96.0, 96.0, 20.0),
            radius: 200.0,
        };
        let shape = Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: BspNode::Internal(InternalNode {
                tag: *b"BPnn",
                plane,
                pos: Some(Box::new(positive)),
                neg: Some(Box::new(negative)),
                sphere: Some(bounds),
                poly_ids: Vec::new(),
            }),
            bounds,
            box_bounds,
            polygons: HashMap::from([(1, polygon)]),
        }));
        PlacedCollider {
            geometry: holtburger_content::PlacedCollisionShape {
                shape,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                scale: ColliderScale::uniform(1.0).unwrap(),
                // The synthetic solid fills the half-space, not just its boundary polygon, so its
                // broad-phase box covers the whole authored bounding sphere.
                bounds: CollisionBox::from_points([
                    bounds.center - Vector3::new(bounds.radius, bounds.radius, bounds.radius),
                    bounds.center + Vector3::new(bounds.radius, bounds.radius, bounds.radius),
                ])
                .unwrap(),
            },
            source_placement: if is_building {
                StaticColliderPlacement::BuildingShell { source_index: 0 }
            } else {
                StaticColliderPlacement::OutdoorExplicit { source_index: 0 }
            },
        }
    }

    fn wall_x(x: f32) -> PlacedCollider {
        half_space(
            Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -x,
            },
            true,
            false,
        )
    }

    fn polygon_wall_x(x: f32) -> PlacedCollider {
        let bounds = Sphere {
            center: Vector3::new(x, 20.0, 10.0),
            radius: 30.0,
        };
        let shape = Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: BspNode::Leaf(BspLeaf {
                index: 0,
                solid: 0,
                sphere: Some(bounds),
                poly_ids: vec![1],
            }),
            bounds,
            box_bounds: CollisionBox::from_points([
                Vector3::new(x, 0.0, 0.0),
                Vector3::new(x, 40.0, 20.0),
            ])
            .unwrap(),
            polygons: HashMap::from([(
                1,
                holtburger_content::CollisionPolygon {
                    vertices: vec![
                        Vector3::new(x, 0.0, 0.0),
                        Vector3::new(x, 0.0, 20.0),
                        Vector3::new(x, 40.0, 20.0),
                        Vector3::new(x, 40.0, 0.0),
                    ],
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: x,
                },
            )]),
        }));
        PlacedCollider {
            geometry: holtburger_content::PlacedCollisionShape {
                shape,
                placement: LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                scale: ColliderScale::uniform(1.0).unwrap(),
                bounds: CollisionBox::from_points([
                    Vector3::new(x, 0.0, 0.0),
                    Vector3::new(x, 40.0, 20.0),
                ])
                .unwrap(),
            },
            source_placement: StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        }
    }

    fn scene(colliders: Vec<PlacedCollider>) -> CollisionScene {
        let mut scene = CollisionScene::new();
        insert_test_halo(&mut scene, &[LANDBLOCK]);
        scene
            .insert(artifact(LANDBLOCK, colliders, Vec::new()))
            .unwrap();
        scene
    }

    fn test_halo_owners(touched: &[u32]) -> Vec<u32> {
        let mut owners = Vec::new();
        for owner in touched {
            let x = ((owner >> 24) & 0xff) as i32;
            let y = ((owner >> 16) & 0xff) as i32;
            for offset_x in -1..=1 {
                for offset_y in -1..=1 {
                    owners.push(
                        (((x + offset_x) as u32) << 24) | (((y + offset_y) as u32) << 16) | 0xffff,
                    );
                }
            }
        }
        owners.sort_unstable();
        owners.dedup();
        owners
    }

    fn insert_test_halo(scene: &mut CollisionScene, touched: &[u32]) {
        for owner in test_halo_owners(touched) {
            scene
                .insert(artifact(owner, Vec::new(), Vec::new()))
                .unwrap();
        }
    }

    fn solve(
        scene: &CollisionScene,
        body: FreeSphereState,
        displacement: Vector3,
    ) -> FreeSphereOutcome {
        solve_free_sphere(
            scene,
            config(),
            FreeSphereRequest {
                body,
                displacement,
                filter: PhysicalCollisionFilter::ALL,
            },
        )
        .unwrap()
    }

    fn cast(
        scene: &CollisionScene,
        body: FreeSphereState,
        direction: Vector3,
        distance: f32,
    ) -> StaticSphereCastOutcome {
        cast_static_sphere(
            scene,
            cast_config(),
            StaticSphereCastRequest {
                origin: body.pose,
                cell: body.cell,
                direction,
                distance,
                radius: body.radius,
                filter: PhysicalCollisionFilter::ALL,
            },
        )
        .unwrap()
    }

    fn water_boundary_scene() -> CollisionScene {
        let mut scene = CollisionScene::new();
        insert_test_halo(&mut scene, &[LANDBLOCK, EAST]);
        scene
            .insert(artifact(LANDBLOCK, Vec::new(), Vec::new()))
            .unwrap();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: EAST,
                // Terrain type 0x10 is one of retail's water surface classes.
                terrain: terrain_with_sample(EAST, WATER_TERRAIN_SAMPLE),
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();
        scene
    }

    fn solved(outcome: FreeSphereOutcome) -> FreeSphereState {
        match outcome {
            FreeSphereOutcome::Solved { body, .. } => body,
            other => panic!("expected solved physical fly, got {other:?}"),
        }
    }

    #[test]
    fn whole_water_landblock_blocks_ordinary_body_but_not_viewer_exemption() {
        // Retail returns collision before terrain response for an entirely-water landblock, except
        // for viewer and missile physics states (`CLandCell::find_env_collisions`,
        // `acclient.c:340351-340399`).
        let scene = water_boundary_scene();
        let original = body(Vector3::new(191.5, 96.0, 50.0));
        let blocked = solved(solve(&scene, original, Vector3::new(1.0, 0.0, 0.0)));
        assert_eq!(landblock_key(blocked.pose.landblock_id), Guid(LANDBLOCK));

        let exempt = solve_free_sphere(
            &scene,
            config(),
            FreeSphereRequest {
                body: original,
                displacement: Vector3::new(1.0, 0.0, 0.0),
                filter: PhysicalCollisionFilter::excluding(
                    crate::PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER,
                ),
            },
        )
        .unwrap();
        assert_eq!(landblock_key(solved(exempt).pose.landblock_id), Guid(EAST));
    }

    #[test]
    fn open_motion_preserves_full_three_dimensional_intent() {
        let displacement = Vector3::new(2.0, -3.0, 4.0);
        let FreeSphereOutcome::Solved { body, motion, .. } = solve(
            &scene(Vec::new()),
            body(Vector3::new(50.0, 50.0, 10.0)),
            displacement,
        ) else {
            panic!("expected solved physical fly");
        };
        assert!(
            (body.pose.coords - Vector3::new(52.0, 47.0, 14.0)).length() < 1e-4,
            "{body:?}"
        );
        let expected_substeps =
            (displacement.length() / config().maximum_substep_distance).ceil() as usize;
        assert_eq!(motion.len(), expected_substeps);
        assert!(
            motion
                .windows(2)
                .all(|pair| pair[0].end_fraction < pair[1].end_fraction),
            "accepted path fractions were not strictly ordered: {motion:?}"
        );
        let final_waypoint = motion.last().expect("solved motion path was empty");
        assert_eq!(final_waypoint.end_fraction, 1.0);
        assert!((final_waypoint.center - body.pose.coords).length() < 1e-4);
    }

    #[test]
    fn wall_impact_stops_normal_motion_and_preserves_oblique_slide() {
        let scene = scene(vec![wall_x(10.0)]);
        let FreeSphereOutcome::Solved {
            body,
            collision_normal,
            ..
        } = solve(
            &scene,
            body(Vector3::new(7.0, 20.0, 5.0)),
            Vector3::new(6.0, 4.0, 0.0),
        )
        else {
            panic!("wall solve did not complete")
        };
        assert!((body.pose.coords.x - 9.0).abs() < 0.002, "{body:?}");
        assert!((body.pose.coords.y - 24.0).abs() < 0.002, "{body:?}");
        assert_eq!(collision_normal, Some(Vector3::new(-1.0, 0.0, 0.0)));
    }

    #[test]
    fn static_sphere_cast_stops_on_its_ray_instead_of_reprojecting_slide_distance() {
        let scene = scene(vec![wall_x(10.0)]);
        let direction = Vector3::new(6.0, 4.0, 0.0);

        let outcome = cast(
            &scene,
            body(Vector3::new(7.0, 20.0, 5.0)),
            direction,
            direction.length(),
        );

        assert!(outcome.obstructed);
        assert!((outcome.pose.coords.x - 9.0).abs() < 0.002, "{outcome:?}");
        assert!((outcome.pose.coords.y - (20.0 + 4.0 / 3.0)).abs() < 0.002);
        assert!(outcome.distance < 2.405);
    }

    #[test]
    fn static_sphere_cast_may_stop_closer_than_a_frontend_boom_minimum() {
        let outcome = cast(
            &scene(vec![wall_x(8.5)]),
            body(Vector3::new(7.0, 20.0, 5.0)),
            Vector3::new(1.0, 0.0, 0.0),
            6.0,
        );

        assert!(outcome.obstructed);
        assert!((outcome.distance - 0.5).abs() < 0.002, "{outcome:?}");
        assert!(outcome.pose.coords.x < 7.501);
    }

    #[test]
    fn static_sphere_cast_rejects_an_origin_that_is_already_inside_geometry() {
        let result = cast_static_sphere(
            &scene(vec![wall_x(10.0)]),
            cast_config(),
            StaticSphereCastRequest {
                origin: pose(LANDBLOCK, Vector3::new(10.5, 20.0, 5.0)),
                cell: None,
                direction: Vector3::new(-1.0, 0.0, 0.0),
                distance: 2.0,
                radius: 1.0,
                filter: PhysicalCollisionFilter::ALL,
            },
        );

        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("origin overlaps collision geometry")
        );
    }

    #[test]
    fn retreat_from_a_blocking_contact_is_immediate() {
        let scene = scene(vec![wall_x(10.0)]);
        let body = solved(solve(
            &scene,
            body(Vector3::new(9.0, 20.0, 5.0)),
            Vector3::new(-2.0, 0.0, 0.0),
        ));
        assert!((body.pose.coords.x - 7.0).abs() < 1e-4);
    }

    #[test]
    fn polygon_only_interior_shell_blocks_and_allows_retreat() {
        let scene = scene(vec![polygon_wall_x(10.0)]);
        let blocked = solved(solve(
            &scene,
            body(Vector3::new(7.0, 20.0, 5.0)),
            Vector3::new(6.0, 0.0, 0.0),
        ));
        assert!((blocked.pose.coords.x - 9.0).abs() < 0.002);
        let retreated = solved(solve(&scene, blocked, Vector3::new(-2.0, 0.0, 0.0)));
        assert!((retreated.pose.coords.x - 7.0).abs() < 0.003);
    }

    #[test]
    fn non_uniformly_scaled_bsp_plane_keeps_world_space_sphere_math_exact() {
        let wall = wall_x(5.0);
        let wall = PlacedCollider::new(
            wall.shape.clone(),
            wall.placement,
            ColliderScale::from_components(Vector3::new(2.0, 3.0, 4.0)).unwrap(),
            wall.source_placement,
        )
        .unwrap();
        let body = solved(solve(
            &scene(vec![wall]),
            body(Vector3::new(7.0, 20.0, 5.0)),
            Vector3::new(6.0, 0.0, 0.0),
        ));
        assert!((body.pose.coords.x - 9.0).abs() < 0.002, "{body:?}");
    }

    #[test]
    fn intersecting_wall_constraints_stop_at_the_corner() {
        let wall_y = half_space(
            Plane {
                normal: Vector3::new(0.0, 1.0, 0.0),
                d: -10.0,
            },
            true,
            false,
        );
        let body = solved(solve(
            &scene(vec![wall_x(10.0), wall_y]),
            body(Vector3::new(7.0, 7.0, 5.0)),
            Vector3::new(6.0, 6.0, 0.0),
        ));
        assert!((body.pose.coords.x - 9.0).abs() < 0.002);
        assert!((body.pose.coords.y - 9.0).abs() < 0.002);
    }

    #[test]
    fn terrain_and_ceiling_constrain_vertical_flight() {
        let ceiling = half_space(
            Plane {
                normal: Vector3::new(0.0, 0.0, 1.0),
                d: -10.0,
            },
            true,
            false,
        );
        let scene = scene(vec![ceiling]);
        let floor = solved(solve(
            &scene,
            body(Vector3::new(50.0, 50.0, 5.0)),
            Vector3::new(0.0, 0.0, -8.0),
        ));
        assert!((floor.pose.coords.z - 1.0).abs() < 0.002);
        let FreeSphereOutcome::Solved {
            body: ceiling,
            collision_normal,
            ..
        } = solve(
            &scene,
            body(Vector3::new(50.0, 50.0, 5.0)),
            Vector3::new(0.0, 0.0, 8.0),
        )
        else {
            panic!("ceiling solve did not complete")
        };
        assert!((ceiling.pose.coords.z - 9.0).abs() < 0.002);
        assert_eq!(collision_normal, Some(Vector3::new(0.0, 0.0, -1.0)));
    }

    #[test]
    fn water_barrier_exempt_free_sphere_uses_the_adjusted_collision_mesh() {
        let mut collision = scene(Vec::new());
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: LANDBLOCK,
                terrain: terrain_with_sample(LANDBLOCK, WATER_TERRAIN_SAMPLE),
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();

        let floor = solved(
            solve_free_sphere(
                &collision,
                config(),
                FreeSphereRequest {
                    body: body(Vector3::new(50.0, 50.0, 5.0)),
                    displacement: Vector3::new(0.0, 0.0, -8.0),
                    filter: PhysicalCollisionFilter::excluding(
                        crate::PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER,
                    ),
                },
            )
            .unwrap(),
        );
        let expected_center = 1.0 - TERRAIN_WATER_COLLISION_DEPTH;
        assert!((floor.pose.coords.z - expected_center).abs() < 0.002);
    }

    #[test]
    fn free_sphere_crosses_a_missing_owner_as_open_space() {
        let original = body(Vector3::new(50.0, 50.0, 5.0));
        let mut scene = CollisionScene::new();
        for owner in test_halo_owners(&[LANDBLOCK]) {
            if owner != LANDBLOCK {
                scene
                    .insert(artifact(owner, Vec::new(), Vec::new()))
                    .unwrap();
            }
        }
        let outcome = solve(&scene, original, Vector3::new(1.0, 0.0, 0.0));
        let moved = solved(outcome);
        assert_eq!(moved.pose.coords, Vector3::new(51.0, 50.0, 5.0));
    }

    #[test]
    fn anti_tunneling_budget_is_finite_and_observable() {
        let original = body(Vector3::new(5.0, 20.0, 5.0));
        let mut limited = config();
        limited.maximum_substeps = 2;
        let outcome = solve_free_sphere(
            &scene(vec![wall_x(10.0)]),
            limited,
            FreeSphereRequest {
                body: original,
                displacement: Vector3::new(20.0, 0.0, 0.0),
                filter: PhysicalCollisionFilter::ALL,
            },
        )
        .unwrap();
        assert_eq!(
            outcome,
            FreeSphereOutcome::BudgetExceeded {
                body: original,
                budget: FreeSphereBudget::Substeps,
                substeps: 0,
                contact_passes: 0,
            }
        );
    }

    #[test]
    fn impossible_placement_exhausts_the_contact_budget_without_recursion() {
        let left = wall_x(10.0);
        let right = half_space(
            Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -10.5,
            },
            false,
            false,
        );
        let original = body(Vector3::new(10.25, 20.0, 5.0));
        let mut limited = config();
        limited.maximum_contact_passes = 2;
        let outcome = solve_free_sphere(
            &scene(vec![left, right]),
            limited,
            FreeSphereRequest {
                body: original,
                displacement: Vector3::new(0.1, 0.0, 0.0),
                filter: PhysicalCollisionFilter::ALL,
            },
        )
        .unwrap();
        assert!(matches!(
            outcome,
            FreeSphereOutcome::BudgetExceeded {
                budget: FreeSphereBudget::Contacts,
                contact_passes: 2,
                ..
            }
        ));
    }

    #[test]
    fn crossing_a_landblock_commits_the_neighbor_pose() {
        let mut scene = CollisionScene::new();
        insert_test_halo(&mut scene, &[LANDBLOCK, EAST]);
        scene
            .insert(artifact(LANDBLOCK, Vec::new(), Vec::new()))
            .unwrap();
        scene
            .insert(artifact(EAST, Vec::new(), Vec::new()))
            .unwrap();
        let body = solved(solve(
            &scene,
            body(Vector3::new(190.0, 50.0, 5.0)),
            Vector3::new(4.0, 0.0, 0.0),
        ));
        assert_eq!(body.pose.landblock_id.0 & 0xffff_0000, EAST & 0xffff_0000);
        assert!((body.pose.coords.x - 2.0).abs() < 1e-4);
    }

    #[test]
    fn candidate_placement_disables_building_center_solid_and_commits_through_an_opening() {
        let mut building = wall_x(10.0);
        building.source_placement = StaticColliderPlacement::BuildingShell { source_index: 0 };
        let opening_vertices = vec![
            Vector3::new(10.0, 0.0, 0.0),
            Vector3::new(10.0, 0.0, 20.0),
            Vector3::new(10.0, 5.0, 20.0),
            Vector3::new(10.0, 5.0, 0.0),
        ];
        let building_solid = building
            .shape
            .as_bsp()
            .expect("synthetic wall is a BSP solid");
        building.shape = Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: building_solid.bsp.clone(),
            bounds: building_solid.bounds,
            box_bounds: CollisionBox::from_points(opening_vertices.iter().copied())
                .expect("synthetic boundary polygon has finite bounds"),
            polygons: HashMap::from([(
                1,
                CollisionPolygon {
                    vertices: opening_vertices,
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 10.0,
                },
            )]),
        }));
        let volume = CellVolume {
            cell_selector: 0x0100,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -10.0,
            }],
            portals: vec![CellCollisionPortal {
                plane: Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -10.0,
                },
                positive_side: true,
                target: CellCollisionPortalTarget::Outdoor,
                outdoor_building: None,
            }],
        };
        let mut scene = CollisionScene::new();
        insert_test_halo(&mut scene, &[LANDBLOCK]);
        scene
            .insert(artifact(LANDBLOCK, vec![building], vec![volume]))
            .unwrap();
        let body = solved(solve(
            &scene,
            body(Vector3::new(8.0, 20.0, 5.0)),
            Vector3::new(4.0, 0.0, 0.0),
        ));
        assert_eq!(body.cell, Some(Guid(0xda55_0100)));
        assert_eq!(body.pose.landblock_id, Guid(0xda55_0100));
        assert!((body.pose.coords.x - 12.0).abs() < 1e-4);
    }

    #[test]
    fn prior_cell_transits_to_its_neighbor_then_back_outdoors() {
        let first = CellVolume {
            cell_selector: 0x0100,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: vec![
                Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: 0.0,
                },
                Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 10.0,
                },
            ],
            portals: vec![CellCollisionPortal {
                plane: Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -10.0,
                },
                positive_side: true,
                target: CellCollisionPortalTarget::EnvCell(0x0101),
                outdoor_building: None,
            }],
        };
        let second = CellVolume {
            cell_selector: 0x0101,
            placement: first.placement,
            planes: vec![
                Plane {
                    normal: Vector3::new(1.0, 0.0, 0.0),
                    d: -10.0,
                },
                Plane {
                    normal: Vector3::new(-1.0, 0.0, 0.0),
                    d: 20.0,
                },
            ],
            portals: vec![
                CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(-1.0, 0.0, 0.0),
                        d: 10.0,
                    },
                    positive_side: true,
                    target: CellCollisionPortalTarget::EnvCell(0x0100),
                    outdoor_building: None,
                },
                CellCollisionPortal {
                    plane: Plane {
                        normal: Vector3::new(1.0, 0.0, 0.0),
                        d: -20.0,
                    },
                    positive_side: true,
                    target: CellCollisionPortalTarget::Outdoor,
                    outdoor_building: None,
                },
            ],
        };
        let mut scene = CollisionScene::new();
        insert_test_halo(&mut scene, &[LANDBLOCK]);
        scene
            .insert(artifact(LANDBLOCK, Vec::new(), vec![first, second]))
            .unwrap();
        let mut inside = body(Vector3::new(9.0, 20.0, 5.0));
        inside.cell = Some(Guid(0xda55_0100));
        inside.pose.landblock_id = Guid(0xda55_0100);
        let neighbor = solved(solve(&scene, inside, Vector3::new(4.0, 0.0, 0.0)));
        assert_eq!(neighbor.cell, Some(Guid(0xda55_0101)));
        assert_eq!(neighbor.pose.landblock_id, Guid(0xda55_0101));

        let outdoors = solved(solve(&scene, neighbor, Vector3::new(10.0, 0.0, 0.0)));
        assert_eq!(outdoors.cell, None);
        assert!(!outdoors.pose.is_indoors(), "{outdoors:?}");

        let cast_neighbor = cast(&scene, inside, Vector3::new(1.0, 0.0, 0.0), 4.0);
        assert!(!cast_neighbor.obstructed);
        assert_eq!(cast_neighbor.origin_cell, Some(Guid(0xda55_0100)));
        assert_eq!(cast_neighbor.cell, Some(Guid(0xda55_0101)));
        assert_eq!(cast_neighbor.pose.landblock_id, Guid(0xda55_0101));

        let mut adjacent_hint = body(Vector3::new(11.0, 20.0, 5.0));
        adjacent_hint.cell = Some(Guid(0xda55_0100));
        adjacent_hint.pose.landblock_id = Guid(0xda55_0100);
        let cast_inside_neighbor = cast(&scene, adjacent_hint, Vector3::new(1.0, 0.0, 0.0), 4.0);
        assert_eq!(cast_inside_neighbor.origin_cell, Some(Guid(0xda55_0101)));
        assert_eq!(cast_inside_neighbor.cell, Some(Guid(0xda55_0101)));
    }
}
