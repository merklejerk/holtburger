//! Stationary sphere settlement and bounded solid-placement recovery for camera queries.

use anyhow::{Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};

use super::collision::{
    CellTransitRequest, CollisionQueryPolicy, PlacementRequest, PlacementRestrictionRequest,
    SolidPlacementRecovery, SpatialMembership, StaticContact, StaticSphereSweepRequest,
    anchor_point_to_cell_position, anchor_point_to_outdoor_position, landblock_key,
    separating_displacement,
};
use super::{PhysicalCollisionFilter, SphereCollisionQuery};

/// Work and separation policy for a stationary sphere; no movement substeps are performed.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FreeSphereSettleConfig {
    /// Maximum contact-separation passes before returning the exhausted-budget outcome.
    pub maximum_contact_passes: usize,
    /// Outward displacement added after contact separation.
    pub separation_epsilon: f32,
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

/// Result of bounded directionless separation for one stationary free sphere.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FreeSphereSettleOutcome {
    /// The complete requested sphere is overlap-free at the returned authoritative placement.
    Settled {
        /// Separated sphere state; its radius is the requested radius.
        body: FreeSphereState,
        /// World-space offset from the requested starting center.
        separation: Vector3,
        /// Placement-contact passes evaluated.
        contact_passes: usize,
        /// First unavailable owner crossed by an explicitly uncovered query.
        unavailable_owner: Option<Guid>,
    },
    /// No safe placement was proven within the configured contact-pass budget.
    BudgetExceeded {
        /// Placement-contact passes evaluated before refusing the request.
        contact_passes: usize,
        /// First unavailable owner crossed by an explicitly uncovered query.
        unavailable_owner: Option<Guid>,
    },
    /// BSP occupancy could not be resolved by the bounded correction search.
    /// This is a bounded-search failure, not proof that no placement exists anywhere.
    RecoveryUnavailable {
        /// Contact-separation passes evaluated before the unsuccessful recovery search.
        contact_passes: usize,
        /// First unavailable owner crossed by an explicitly uncovered query.
        unavailable_owner: Option<Guid>,
    },
}

/// Separates a stationary sphere without authoring a transit path.
/// Callers needing motion must use the scene/contact movement pipeline.
pub fn settle_free_sphere(
    scene: &dyn SphereCollisionQuery,
    config: FreeSphereSettleConfig,
    body: FreeSphereState,
    filter: PhysicalCollisionFilter,
) -> Result<FreeSphereSettleOutcome> {
    settle_free_sphere_with_policy(
        scene,
        config,
        body,
        filter,
        CollisionQueryPolicy::RequireCollisionCoverage,
    )
}

/// Separates a stationary sphere under one explicit collision-coverage policy.
pub fn settle_free_sphere_with_policy(
    scene: &dyn SphereCollisionQuery,
    config: FreeSphereSettleConfig,
    body: FreeSphereState,
    filter: PhysicalCollisionFilter,
    query_policy: CollisionQueryPolicy,
) -> Result<FreeSphereSettleOutcome> {
    validate_settlement(config, body.radius)?;
    let anchor = landblock_key(body.pose.landblock_id);
    let start = body.pose.coords;
    let mut center = start;
    let mut unavailable_owner = None;
    let mut placement = transit(
        scene,
        anchor,
        body,
        center,
        query_policy,
        &mut unavailable_owner,
    )?;

    for contact_passes in 0..=config.maximum_contact_passes {
        let request = PlacementRequest {
            anchor,
            center,
            radius: body.radius,
            placement: &placement,
        };
        let recovery = scene
            .environment()
            .solid_recovery_candidates(request, config.separation_epsilon);
        if contact_passes == config.maximum_contact_passes
            && !matches!(recovery, SolidPlacementRecovery::Outside)
        {
            return Ok(FreeSphereSettleOutcome::BudgetExceeded {
                contact_passes,
                unavailable_owner,
            });
        }
        match recover_solid_placement(
            scene,
            request,
            recovery,
            config.separation_epsilon,
            filter,
            query_policy,
            &mut unavailable_owner,
        )? {
            SolidRecoveryResult::SurfaceOnly => {}
            SolidRecoveryResult::Recovered {
                center: recovered,
                placement: recovered_placement,
            } => {
                let cell = recovered_placement.committed_cell();
                return Ok(FreeSphereSettleOutcome::Settled {
                    body: FreeSphereState {
                        pose: pose_for_commit(anchor, recovered, body.pose, cell),
                        cell,
                        radius: body.radius,
                    },
                    separation: recovered - start,
                    contact_passes: contact_passes + 1,
                    unavailable_owner,
                });
            }
            SolidRecoveryResult::Unavailable => {
                return Ok(FreeSphereSettleOutcome::RecoveryUnavailable {
                    contact_passes,
                    unavailable_owner,
                });
            }
        }
        let contacts =
            placement_contacts(scene, request, filter, query_policy, &mut unavailable_owner)?;
        if contacts.is_empty() {
            let cell = placement.committed_cell();
            return Ok(FreeSphereSettleOutcome::Settled {
                body: FreeSphereState {
                    pose: pose_for_commit(anchor, center, body.pose, cell),
                    cell,
                    radius: body.radius,
                },
                separation: center - start,
                contact_passes,
                unavailable_owner,
            });
        }
        if contact_passes == config.maximum_contact_passes {
            return Ok(FreeSphereSettleOutcome::BudgetExceeded {
                contact_passes,
                unavailable_owner,
            });
        }
        center = center + separating_displacement(&contacts, config.separation_epsilon);
        placement = transit(
            scene,
            anchor,
            body,
            center,
            query_policy,
            &mut unavailable_owner,
        )?;
    }

    unreachable!("the inclusive contact-pass loop always settles or exhausts its budget")
}

/// A rejected candidate never masquerades as ordinary overlap-free placement.
enum SolidRecoveryResult {
    /// No center-solid occupancy; finite polygon and volume contacts retain ordinary settlement.
    SurfaceOnly,
    /// Endpoint and complete path have been checked against the querying sphere's obstacles.
    Recovered {
        /// Clear endpoint in the request frame.
        center: Vector3,
        /// Membership evaluated at that endpoint.
        placement: SpatialMembership,
    },
    /// The bounded candidate set supplies no proven correction.
    Unavailable,
}

fn recover_solid_placement(
    scene: &dyn SphereCollisionQuery,
    request: PlacementRequest<'_>,
    recovery: SolidPlacementRecovery,
    epsilon: f32,
    filter: PhysicalCollisionFilter,
    policy: CollisionQueryPolicy,
    unavailable_owner: &mut Option<Guid>,
) -> Result<SolidRecoveryResult> {
    let candidates = match recovery {
        SolidPlacementRecovery::Outside => return Ok(SolidRecoveryResult::SurfaceOnly),
        SolidPlacementRecovery::LimitExceeded => return Ok(SolidRecoveryResult::Unavailable),
        SolidPlacementRecovery::Occupied(candidates) => candidates,
    };
    for center in &candidates.centers {
        let placement = transit_placement(
            scene,
            CellTransitRequest {
                previous_cell: request.placement.committed_cell(),
                anchor: request.anchor,
                center: *center,
                radius: request.radius,
            },
            policy,
            unavailable_owner,
        )?;
        let endpoint = PlacementRequest {
            anchor: request.anchor,
            center: *center,
            radius: request.radius,
            placement: &placement,
        };
        // Contact directions do not encode every occupied region (e.g. a solid root leaf).
        // Establish center clearance independently before trusting an empty contact list.
        if !matches!(
            scene
                .environment()
                .solid_recovery_candidates(endpoint, epsilon),
            SolidPlacementRecovery::Outside
        ) || !placement_contacts(scene, endpoint, filter, policy, unavailable_owner)?.is_empty()
        {
            continue;
        }
        let sweep = StaticSphereSweepRequest {
            anchor: request.anchor,
            start: request.center,
            displacement: *center - request.center,
            previous_cell: request.placement.committed_cell(),
            radius: request.radius,
            filter,
        };
        let path = scene
            .environment()
            .sweep_solid_recovery(sweep, &candidates, policy)?;
        remember_unavailable_owner(unavailable_owner, path.unavailable_owner);
        if path.value.is_some() || scene.entity_sweep_sphere(sweep)?.is_some() {
            continue;
        }
        return Ok(SolidRecoveryResult::Recovered {
            center: *center,
            placement,
        });
    }
    Ok(SolidRecoveryResult::Unavailable)
}

fn placement_contacts(
    scene: &dyn SphereCollisionQuery,
    request: PlacementRequest<'_>,
    filter: PhysicalCollisionFilter,
    query_policy: CollisionQueryPolicy,
    unavailable_owner: &mut Option<Guid>,
) -> Result<Vec<StaticContact>> {
    let placement_contacts = scene
        .environment()
        .placement_contacts_with_policy(request, query_policy)?;
    remember_unavailable_owner(unavailable_owner, placement_contacts.unavailable_owner);
    let mut contacts = placement_contacts.value;
    let restrictions = scene.environment().placement_restrictions_with_policy(
        PlacementRestrictionRequest {
            anchor: request.anchor,
            center: request.center,
            radius: request.radius,
            placement: request.placement,
            filter,
        },
        query_policy,
    )?;
    remember_unavailable_owner(unavailable_owner, restrictions.unavailable_owner);
    contacts.extend(restrictions.value);
    contacts.extend(scene.entity_contacts(
        request.anchor,
        request.center,
        request.radius,
        request.placement,
    )?);
    Ok(contacts)
}

fn transit(
    scene: &dyn SphereCollisionQuery,
    anchor: Guid,
    body: FreeSphereState,
    center: Vector3,
    query_policy: CollisionQueryPolicy,
    unavailable_owner: &mut Option<Guid>,
) -> Result<SpatialMembership> {
    transit_placement(
        scene,
        CellTransitRequest {
            previous_cell: body.cell,
            anchor,
            center,
            radius: body.radius,
        },
        query_policy,
        unavailable_owner,
    )
}

fn transit_placement(
    scene: &dyn SphereCollisionQuery,
    request: CellTransitRequest,
    query_policy: CollisionQueryPolicy,
    unavailable_owner: &mut Option<Guid>,
) -> Result<SpatialMembership> {
    let query = scene.environment().transit_cell_allow_uncovered(request)?;
    if query_policy == CollisionQueryPolicy::RequireCollisionCoverage
        && let Some(owner) = query.unavailable_owner
    {
        return Err(
            super::collision::CollisionQueryError::UnavailableOwner { owner: owner.0 }.into(),
        );
    }
    remember_unavailable_owner(unavailable_owner, query.unavailable_owner);
    Ok(query.value)
}

fn remember_unavailable_owner(selected: &mut Option<Guid>, candidate: Option<Guid>) {
    if let Some(candidate) = candidate
        && selected.is_none_or(|current| candidate < current)
    {
        *selected = Some(candidate);
    }
}

fn pose_for_commit(
    anchor: Guid,
    point: Vector3,
    original: WorldPosition,
    cell: Option<Guid>,
) -> WorldPosition {
    cell.map_or_else(
        || anchor_point_to_outdoor_position(anchor, point, original.rotation),
        |cell| anchor_point_to_cell_position(anchor, point, cell, original.rotation),
    )
}

fn validate_settlement(config: FreeSphereSettleConfig, radius: f32) -> Result<()> {
    ensure!(
        radius.is_finite() && radius > 0.0,
        "free-sphere radius must be finite and positive"
    );
    ensure!(
        config.maximum_contact_passes > 0,
        "free-sphere requires at least one contact pass"
    );
    ensure!(
        config.separation_epsilon.is_finite() && config.separation_epsilon > 0.0,
        "free-sphere separation epsilon must be finite and positive"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::spatial::CollisionScene;
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

    fn config() -> FreeSphereSettleConfig {
        FreeSphereSettleConfig {
            maximum_contact_passes: 8,
            separation_epsilon: 0.000_5,
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
            static_geometry: LandblockColliders::new(colliders, cell_volumes),
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
        polygon_wall_face(x, -1.0)
    }

    fn polygon_wall_face(x: f32, normal_x: f32) -> PlacedCollider {
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
                    vertices: {
                        let mut vertices = vec![
                            Vector3::new(x, 0.0, 0.0),
                            Vector3::new(x, 0.0, 20.0),
                            Vector3::new(x, 40.0, 20.0),
                            Vector3::new(x, 40.0, 0.0),
                        ];
                        if normal_x > 0.0 {
                            vertices.reverse();
                        }
                        vertices
                    },
                    normal: Vector3::new(normal_x, 0.0, 0.0),
                    d: -normal_x * x,
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

    /// Two solid leaves share an internal Y partition; only the X planes exit the slab.
    fn partitioned_slab() -> PlacedCollider {
        let bounds = Sphere {
            center: Vector3::new(10.0, 20.0, 5.0),
            radius: 30.0,
        };
        let leaf = |index, solid| {
            BspNode::Leaf(BspLeaf {
                index,
                solid,
                sphere: Some(bounds),
                poly_ids: vec![1, 2],
            })
        };
        let split = |plane, positive, negative| {
            BspNode::Internal(InternalNode {
                tag: *b"BPnn",
                plane,
                pos: Some(Box::new(positive)),
                neg: Some(Box::new(negative)),
                sphere: Some(bounds),
                poly_ids: Vec::new(),
            })
        };
        let partition = split(
            Plane {
                normal: Vector3::new(0.0, 1.0, 0.0),
                d: -20.0,
            },
            leaf(1, 1),
            leaf(2, 1),
        );
        let lower = split(
            Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -8.0,
            },
            partition,
            leaf(3, 0),
        );
        let root = split(
            Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -12.0,
            },
            leaf(4, 0),
            lower,
        );
        let box_bounds = CollisionBox::from_points([
            Vector3::new(8.0, 0.0, 0.0),
            Vector3::new(12.0, 40.0, 10.0),
        ])
        .unwrap();
        let face = |x, direction| {
            let point = Vector3::new(x, 20.0, 5.0);
            let tangent = Vector3::new(0.0, direction * 20.0, 0.0);
            let bitangent = Vector3::new(0.0, 0.0, 5.0);
            let normal = Vector3::new(direction, 0.0, 0.0);
            CollisionPolygon {
                vertices: vec![
                    point - tangent - bitangent,
                    point + tangent - bitangent,
                    point + tangent + bitangent,
                    point - tangent + bitangent,
                ],
                normal,
                d: -normal.dot(&point),
            }
        };
        PlacedCollider::new(
            Arc::new(CollisionShape::Bsp(BspSolid {
                bsp: root,
                bounds,
                box_bounds,
                polygons: HashMap::from([(1, face(8.0, -1.0)), (2, face(12.0, 1.0))]),
            })),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        )
        .unwrap()
    }

    fn assert_clear(scene: &CollisionScene, result: FreeSphereState) {
        let anchor = landblock_key(result.pose.landblock_id);
        let placement = scene
            .transit_cell(CellTransitRequest {
                previous_cell: result.cell,
                anchor,
                center: result.pose.coords,
                radius: result.radius,
            })
            .unwrap();
        assert!(
            scene
                .placement_contacts(PlacementRequest {
                    anchor,
                    center: result.pose.coords,
                    radius: result.radius,
                    placement: &placement,
                })
                .unwrap()
                .is_empty(),
            "{result:?}"
        );
    }

    #[test]
    fn stationary_settle_exits_adjacent_solid_leaves_at_the_requested_radius() {
        let scene = scene(vec![partitioned_slab()]);
        let original = body(Vector3::new(10.0, 20.05, 5.0));
        let result = settled(
            settle_free_sphere(&scene, config(), original, PhysicalCollisionFilter::ALL).unwrap(),
        );
        assert!(
            result.pose.coords.x < 8.0 || result.pose.coords.x > 12.0,
            "{result:?}"
        );
        assert_eq!(result.radius, original.radius);
        assert_eq!(result.pose.coords.y, original.pose.coords.y);
        assert_clear(&scene, result);
    }

    #[test]
    fn stationary_settle_preserves_radius_only_surface_recovery() {
        let scene = scene(vec![partitioned_slab()]);
        let original = body(Vector3::new(12.5, 20.05, 5.0));
        let result = settled(
            settle_free_sphere(&scene, config(), original, PhysicalCollisionFilter::ALL).unwrap(),
        );
        assert!(result.pose.coords.x > original.pose.coords.x);
        assert_eq!(result.radius, original.radius);
        assert_clear(&scene, result);
    }

    #[test]
    fn stationary_settle_recovers_rotated_nonuniform_geometry() {
        let source = partitioned_slab();
        let collider = PlacedCollider::new(
            source.shape.clone(),
            LandblockPlacement {
                origin: Vector3::new(40.0, 40.0, 0.0),
                orientation: Quaternion::from_axis_angle(
                    Vector3::new(0.0, 0.0, 1.0),
                    std::f32::consts::FRAC_PI_3,
                )
                .unwrap(),
            },
            ColliderScale::from_components(Vector3::new(2.0, 0.5, 1.0)).unwrap(),
            source.source_placement,
        )
        .unwrap();
        let original = body(collider.point_to_landblock_space(Vector3::new(10.0, 20.05, 5.0)));
        let scene = scene(vec![collider]);
        let result = settled(
            settle_free_sphere(&scene, config(), original, PhysicalCollisionFilter::ALL).unwrap(),
        );
        assert_eq!(result.radius, original.radius);
        assert_clear(&scene, result);
    }

    #[test]
    fn stationary_settle_exits_all_overlapping_starting_solids() {
        let inner = partitioned_slab();
        let outer = PlacedCollider::new(
            inner.shape.clone(),
            LandblockPlacement {
                origin: Vector3::new(-10.0, 0.0, 0.0),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(2.0).unwrap(),
            inner.source_placement,
        )
        .unwrap();
        let scene = scene(vec![inner, outer]);
        let original = body(Vector3::new(10.0, 20.05, 5.0));
        let result = settled(
            settle_free_sphere(&scene, config(), original, PhysicalCollisionFilter::ALL).unwrap(),
        );
        assert!(
            result.pose.coords.x < 6.0 || result.pose.coords.x > 14.0,
            "{result:?}"
        );
        assert_clear(&scene, result);
    }

    /// Adds irrelevant ancestors beyond the escape budget without changing the slab's solid.
    fn deeply_partitioned_slab() -> PlacedCollider {
        let mut collider = partitioned_slab();
        let original = collider.shape.as_bsp().unwrap();
        let mut bsp = original.bsp.clone();
        for _ in 0..crate::spatial::bsp_query::SOLID_RECOVERY_CANDIDATE_LIMIT {
            bsp = BspNode::Internal(InternalNode {
                tag: *b"BPnn",
                plane: Plane {
                    normal: Vector3::new(0.0, 0.0, 1.0),
                    d: -100.0,
                },
                pos: None,
                neg: Some(Box::new(bsp)),
                sphere: Some(original.bounds),
                poly_ids: Vec::new(),
            });
        }
        collider.geometry.shape = Arc::new(CollisionShape::Bsp(BspSolid {
            bsp,
            bounds: original.bounds,
            box_bounds: original.box_bounds,
            polygons: original.polygons.clone(),
        }));
        collider
    }

    #[test]
    fn stationary_settle_reports_recovery_unavailable_at_the_escape_candidate_limit() {
        assert!(matches!(
            settle_free_sphere(
                &scene(vec![deeply_partitioned_slab()]),
                config(),
                body(Vector3::new(10.0, 20.05, 5.0)),
                PhysicalCollisionFilter::ALL
            )
            .unwrap(),
            FreeSphereSettleOutcome::RecoveryUnavailable { .. }
        ));
    }

    #[test]
    fn stationary_settle_classifies_clear_centers_beyond_the_escape_candidate_limit() {
        let scene = scene(vec![deeply_partitioned_slab()]);
        // The center is outside the slab, but the sphere overlaps its face. Classification must
        // finish through the deep BSP before ordinary surface settlement separates the sphere.
        let original = body(Vector3::new(12.5, 20.05, 5.0));
        let result = settled(
            settle_free_sphere(&scene, config(), original, PhysicalCollisionFilter::ALL).unwrap(),
        );
        assert!(result.pose.coords.x > original.pose.coords.x);
        assert_clear(&scene, result);
    }

    #[test]
    fn stationary_settle_rejects_clear_endpoints_across_unrelated_walls() {
        let scene = scene(vec![
            partitioned_slab(),
            polygon_wall_x(11.5),
            polygon_wall_face(8.5, 1.0),
        ]);
        let original = body(Vector3::new(10.0, 20.05, 5.0));
        // Both exterior endpoints are clear. Their paths cross distinct, non-containing faces.
        let separation = original.radius + config().separation_epsilon;
        for x in [8.0 - separation, 12.0 + separation] {
            assert_clear(
                &scene,
                body(Vector3::new(
                    x,
                    original.pose.coords.y,
                    original.pose.coords.z,
                )),
            );
        }
        assert!(matches!(
            settle_free_sphere(&scene, config(), original, PhysicalCollisionFilter::ALL).unwrap(),
            FreeSphereSettleOutcome::RecoveryUnavailable { .. }
        ));
    }

    #[test]
    fn stationary_settle_does_not_clear_a_solid_region_without_exit_candidates() {
        let mut collider = partitioned_slab();
        let original = collider.shape.as_bsp().unwrap();
        let bsp = BspNode::Leaf(BspLeaf {
            index: 1,
            solid: 1,
            sphere: Some(original.bounds),
            poly_ids: vec![1, 2],
        });
        collider.geometry.shape = Arc::new(CollisionShape::Bsp(BspSolid {
            bsp,
            bounds: original.bounds,
            box_bounds: original.box_bounds,
            polygons: original.polygons.clone(),
        }));
        let scene = scene(vec![collider]);
        assert!(matches!(
            settle_free_sphere(
                &scene,
                config(),
                body(Vector3::new(10.0, 20.05, 5.0)),
                PhysicalCollisionFilter::ALL
            )
            .unwrap(),
            FreeSphereSettleOutcome::RecoveryUnavailable { .. }
        ));
    }

    fn scene(colliders: Vec<PlacedCollider>) -> CollisionScene {
        let mut scene = CollisionScene::new();
        insert_test_coverage_neighborhood(&mut scene, &[LANDBLOCK]);
        scene
            .insert(artifact(LANDBLOCK, colliders, Vec::new()))
            .unwrap();
        scene
    }

    fn test_coverage_neighborhood_owners(touched: &[u32]) -> Vec<u32> {
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

    fn insert_test_coverage_neighborhood(scene: &mut CollisionScene, touched: &[u32]) {
        for owner in test_coverage_neighborhood_owners(touched) {
            scene
                .insert(artifact(owner, Vec::new(), Vec::new()))
                .unwrap();
        }
    }

    fn water_boundary_scene() -> CollisionScene {
        let mut scene = CollisionScene::new();
        insert_test_coverage_neighborhood(&mut scene, &[LANDBLOCK, EAST]);
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

    fn settled(outcome: FreeSphereSettleOutcome) -> FreeSphereState {
        match outcome {
            FreeSphereSettleOutcome::Settled { body, .. } => body,
            other => panic!("expected settled free sphere, got {other:?}"),
        }
    }

    #[test]
    fn stationary_settle_preserves_an_open_placement() {
        let original = body(Vector3::new(20.0, 20.0, 5.0));
        let outcome = settle_free_sphere(
            &scene(Vec::new()),
            config(),
            original,
            PhysicalCollisionFilter::ALL,
        )
        .unwrap();

        let result = settled(outcome);
        assert_eq!(result.pose.coords, original.pose.coords);
        assert_eq!(result.cell, original.cell);
        assert_eq!(result.radius, original.radius);
    }

    #[test]
    fn stationary_settle_separates_from_a_wall_and_corner() {
        let wall_y = half_space(
            Plane {
                normal: Vector3::new(0.0, 1.0, 0.0),
                d: -10.0,
            },
            true,
            false,
        );
        let original = body(Vector3::new(9.8, 9.8, 5.0));
        let result = settled(
            settle_free_sphere(
                &scene(vec![wall_x(10.0), wall_y]),
                config(),
                original,
                PhysicalCollisionFilter::ALL,
            )
            .unwrap(),
        );

        assert!((result.pose.coords.x - 8.999_5).abs() < 0.002, "{result:?}");
        assert!((result.pose.coords.y - 8.999_5).abs() < 0.002, "{result:?}");
    }

    #[test]
    fn stationary_settle_refuses_to_publish_an_impossible_corridor_placement() {
        let west_wall = half_space(
            Plane {
                normal: Vector3::new(1.0, 0.0, 0.0),
                d: -9.6,
            },
            false,
            false,
        );
        let outcome = settle_free_sphere(
            &scene(vec![west_wall, wall_x(10.0)]),
            config(),
            body(Vector3::new(9.8, 20.0, 5.0)),
            PhysicalCollisionFilter::ALL,
        )
        .unwrap();

        assert_eq!(
            outcome,
            FreeSphereSettleOutcome::BudgetExceeded {
                contact_passes: config().maximum_contact_passes,
                unavailable_owner: None,
            }
        );
    }

    /// Current contact-collection flight scenarios, sharing geometry with settlement tests.
    mod flight {
        use super::*;
        use crate::spatial::differential_fixtures::{movement_body, movement_tick};
        use crate::{
            GroundState, MOBILE_CONTACT_TICK_SECONDS, PhysicalBodyActuation,
            PhysicalBodyDefinition, PhysicalBodyInput, PhysicalElasticity, PhysicalRestitution,
            PhysicalSphereSet, SpatialBody,
        };

        fn flight_body(local: Vector3) -> SpatialBody {
            let definition = PhysicalBodyDefinition::free_sphere(
                PhysicalSphereSet::new(
                    Sphere {
                        center: Vector3::zero(),
                        radius: 1.0,
                    },
                    None,
                )
                .unwrap(),
            )
            .unwrap();
            let mut body = movement_body(
                WorldPosition::from_outdoor_frame(Guid(LANDBLOCK), local, Quaternion::identity()),
                definition,
                Vector3::zero(),
                GroundState::Airborne,
            );
            // Viewer-style zero restitution preserves tangent travel at hard surfaces.
            body.physical.as_mut().unwrap().response_policy.restitution =
                PhysicalRestitution::Elastic(PhysicalElasticity::ZERO);
            body
        }

        fn travel(scene: &CollisionScene, body: SpatialBody, displacement: Vector3) -> SpatialBody {
            movement_tick(
                scene,
                body,
                PhysicalBodyInput::autonomous(
                    PhysicalBodyActuation::free_flight(displacement / MOBILE_CONTACT_TICK_SECONDS)
                        .unwrap(),
                ),
            )
        }
        #[test]
        fn whole_water_landblock_blocks_ordinary_body_but_not_viewer_exemption() {
            let scene = water_boundary_scene();
            let original = flight_body(Vector3::new(191.5, 96.0, 50.0));
            let blocked = travel(&scene, original.clone(), Vector3::new(1.0, 0.0, 0.0));
            // Swept movement accepts the exact boundary, which normalizes into the east
            // owner at x=0. Legacy separation instead nudged the center west of it.
            assert_eq!(blocked.pose.coords.x, 0.0);
            assert_eq!(landblock_key(blocked.pose.landblock_id), Guid(EAST));
            assert_eq!(blocked.retained.velocity.x, 0.0);
            let mut viewer = original;
            viewer.physical.as_mut().unwrap().collision_filter = PhysicalCollisionFilter::excluding(
                crate::PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER,
            );
            let exempt = travel(&scene, viewer, Vector3::new(1.0, 0.0, 0.0));
            assert_eq!(landblock_key(exempt.pose.landblock_id), Guid(EAST));
        }

        #[test]
        fn open_motion_preserves_full_three_dimensional_intent() {
            let body = travel(
                &scene(Vec::new()),
                flight_body(Vector3::new(50.0, 50.0, 10.0)),
                Vector3::new(2.0, -3.0, 4.0),
            );
            assert!(
                (body.pose.coords - Vector3::new(52.0, 47.0, 14.0)).length() < 1e-4,
                "{body:?}"
            );
        }

        #[test]
        fn wall_impact_stops_normal_motion_and_preserves_oblique_slide() {
            let body = travel(
                &scene(vec![wall_x(10.0)]),
                flight_body(Vector3::new(7.0, 20.0, 5.0)),
                Vector3::new(6.0, 4.0, 0.0),
            );
            assert!((body.pose.coords.x - 9.0).abs() < 0.002, "{body:?}");
            assert!((body.pose.coords.y - 24.0).abs() < 0.002, "{body:?}");
            assert_eq!(body.retained.velocity.x, 0.0);
        }

        #[test]
        fn retreat_from_a_blocking_contact_is_immediate() {
            let scene = scene(vec![wall_x(10.0)]);
            let body = travel(
                &scene,
                flight_body(Vector3::new(9.0, 20.0, 5.0)),
                Vector3::new(-2.0, 0.0, 0.0),
            );
            assert!((body.pose.coords.x - 7.0).abs() < 1e-4);
        }

        #[test]
        fn polygon_only_interior_shell_blocks_and_allows_retreat() {
            let scene = scene(vec![polygon_wall_x(10.0)]);
            let blocked = travel(
                &scene,
                flight_body(Vector3::new(7.0, 20.0, 5.0)),
                Vector3::new(6.0, 0.0, 0.0),
            );
            assert!((blocked.pose.coords.x - 9.0).abs() < 0.002);
            let retreated = travel(&scene, blocked, Vector3::new(-2.0, 0.0, 0.0));
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
            let body = travel(
                &scene(vec![wall]),
                flight_body(Vector3::new(7.0, 20.0, 5.0)),
                Vector3::new(6.0, 0.0, 0.0),
            );
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
            let body = travel(
                &scene(vec![wall_x(10.0), wall_y]),
                flight_body(Vector3::new(7.0, 7.0, 5.0)),
                Vector3::new(6.0, 6.0, 0.0),
            );
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
            for (travel_z, expected_z) in [(-8.0, 1.0), (8.0, 9.0)] {
                let body = travel(
                    &scene,
                    flight_body(Vector3::new(50.0, 50.0, 5.0)),
                    Vector3::new(0.0, 0.0, travel_z),
                );
                assert!((body.pose.coords.z - expected_z).abs() < 0.002, "{body:?}");
                assert_eq!(body.retained.velocity.z, 0.0);
            }
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
            let mut viewer = flight_body(Vector3::new(50.0, 50.0, 5.0));
            viewer.physical.as_mut().unwrap().collision_filter = PhysicalCollisionFilter::excluding(
                crate::PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER,
            );
            let floor = travel(&collision, viewer, Vector3::new(0.0, 0.0, -8.0));
            let expected_center = 1.0 - TERRAIN_WATER_COLLISION_DEPTH;
            assert!((floor.pose.coords.z - expected_center).abs() < 0.002);
        }

        #[test]
        fn crossing_a_landblock_commits_the_neighbor_pose() {
            let mut scene = CollisionScene::new();
            insert_test_coverage_neighborhood(&mut scene, &[LANDBLOCK, EAST]);
            scene
                .insert(artifact(LANDBLOCK, Vec::new(), Vec::new()))
                .unwrap();
            scene
                .insert(artifact(EAST, Vec::new(), Vec::new()))
                .unwrap();
            let body = travel(
                &scene,
                flight_body(Vector3::new(190.0, 50.0, 5.0)),
                Vector3::new(4.0, 0.0, 0.0),
            );
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
                    aperture_vertices: Vec::new(),
                    reciprocal_visibility_vertices: None,
                    // The room is x >= 10: exiting travels toward the negative side.
                    // The legacy endpoint-placement runner never checked this direction.
                    positive_side: false,
                    target: CellCollisionPortalTarget::Outdoor,
                    outdoor_building: None,
                }],
            };
            let mut scene = CollisionScene::new();
            insert_test_coverage_neighborhood(&mut scene, &[LANDBLOCK]);
            scene
                .insert(artifact(LANDBLOCK, vec![building], vec![volume]))
                .unwrap();
            let body = travel(
                &scene,
                flight_body(Vector3::new(8.0, 20.0, 5.0)),
                Vector3::new(4.0, 0.0, 0.0),
            );
            assert_eq!(
                body.physical.as_ref().unwrap().response.cell(),
                Some(Guid(0xda55_0100)),
                "pose={:?} velocity={:?}",
                body.pose,
                body.retained.velocity
            );
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
                    aperture_vertices: Vec::new(),
                    reciprocal_visibility_vertices: None,
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
                        aperture_vertices: Vec::new(),
                        reciprocal_visibility_vertices: None,
                        positive_side: true,
                        target: CellCollisionPortalTarget::EnvCell(0x0100),
                        outdoor_building: None,
                    },
                    CellCollisionPortal {
                        plane: Plane {
                            normal: Vector3::new(1.0, 0.0, 0.0),
                            d: -20.0,
                        },
                        aperture_vertices: Vec::new(),
                        reciprocal_visibility_vertices: None,
                        positive_side: true,
                        target: CellCollisionPortalTarget::Outdoor,
                        outdoor_building: None,
                    },
                ],
            };
            let mut scene = CollisionScene::new();
            insert_test_coverage_neighborhood(&mut scene, &[LANDBLOCK]);
            scene
                .insert(artifact(LANDBLOCK, Vec::new(), vec![first, second]))
                .unwrap();
            let mut inside = flight_body(Vector3::new(9.0, 20.0, 5.0));
            inside.pose.landblock_id = Guid(0xda55_0100);
            inside
                .physical
                .as_mut()
                .unwrap()
                .reset_placement(Some(Guid(0xda55_0100)));
            let neighbor = travel(&scene, inside, Vector3::new(4.0, 0.0, 0.0));
            assert_eq!(
                neighbor.physical.as_ref().unwrap().response.cell(),
                Some(Guid(0xda55_0101))
            );
            assert_eq!(neighbor.pose.landblock_id, Guid(0xda55_0101));

            let outdoors = travel(&scene, neighbor, Vector3::new(10.0, 0.0, 0.0));
            assert_eq!(outdoors.physical.as_ref().unwrap().response.cell(), None);
            assert!(!outdoors.pose.is_indoors(), "{outdoors:?}");
        }
    }
}
