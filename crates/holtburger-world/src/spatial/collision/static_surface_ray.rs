//! Finite rays against resident static collision geometry.

use holtburger_common::{Guid, Vector3};
use holtburger_content::{CollisionPolygon, CollisionShape, PlacedCollisionShape};
use parry3d::math::Pose;
use parry3d::query::{Ray, RayCast};
use parry3d::shape::{Ball, Cylinder, Triangle};

use super::static_sphere_sweep::{
    landblock_entry_hit, parry_vector, placed_anchor_point, swept_query_cells, world_vector,
};
use super::{
    CollisionOwnerProof, CollisionQueryError, CollisionQueryPolicy, CollisionScene, MotionWaypoint,
    MotionWaypointPlacement, PhysicalCollisionExclusions, PhysicalCollisionFilter,
    PlacedMotionPathRequest, SpatialMembership, SphereSweep, UncoveredCollisionQuery,
    anchor_to_landblock, touched_landblocks, validate_point_sweep,
};

const DIRECTION_LENGTH_TOLERANCE: f32 = 0.000_1;

/// One finite ray against resident static collision geometry.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StaticSurfaceRayRequest {
    /// Normalized outdoor landblock frame containing the ray origin.
    pub anchor: Guid,
    /// Ray origin in `anchor`-local coordinates.
    pub start: Vector3,
    /// Finite unit direction in world axes.
    pub direction: Vector3,
    /// Non-negative maximum distance in meters.
    pub maximum_distance: f32,
    /// Previously committed EnvCell, or `None` outdoors.
    pub previous_cell: Option<Guid>,
    /// Optional collision-domain exclusions owned by the querying body.
    pub filter: PhysicalCollisionFilter,
}

/// Earliest collidable static surface reached by a finite ray.
#[derive(Debug, Clone, PartialEq)]
pub struct StaticSurfaceRayHit {
    /// Hit point in the request's anchor-local coordinates.
    pub point: Vector3,
    /// Distance from the ray origin in meters.
    pub distance: f32,
    /// Authored or primitive outward-facing unit normal.
    pub normal: Vector3,
    /// Exact spatial domains reached at the hit point.
    pub placement: SpatialMembership,
    /// Exact installed collision product that supplied the surface.
    pub proof: CollisionOwnerProof,
}

/// Portal traversal and static clipping shared by selection without changing nearest-surface API.
#[derive(Debug, Clone)]
pub(crate) struct StaticSelectionRayTrace {
    pub(crate) static_hit: Option<StaticSurfaceRayHit>,
    pub(crate) reached: SpatialMembership,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SurfaceCandidate {
    pub(super) distance: f32,
    pub(super) normal: Vector3,
    pub(super) owner: Guid,
}

impl CollisionScene {
    /// Returns the earliest static surface along a completely covered finite ray.
    pub fn cast_static_surface_ray(
        &self,
        request: StaticSurfaceRayRequest,
    ) -> Result<Option<StaticSurfaceRayHit>, CollisionQueryError> {
        Ok(self
            .trace_static_surface_ray_with_policy(
                request,
                CollisionQueryPolicy::RequireCollisionCoverage,
            )?
            .value
            .static_hit)
    }

    /// Returns the earliest installed surface under one explicit coverage policy.
    pub fn cast_static_surface_ray_with_policy(
        &self,
        request: StaticSurfaceRayRequest,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<Option<StaticSurfaceRayHit>>, CollisionQueryError> {
        let traced = self.trace_static_surface_ray_with_policy(request, policy)?;
        Ok(UncoveredCollisionQuery {
            value: traced.value.static_hit,
            unavailable_owner: traced.unavailable_owner,
        })
    }

    /// Traces the exact portal domains reached before the first covered static obstruction.
    pub(crate) fn trace_selection_ray(
        &self,
        request: StaticSurfaceRayRequest,
    ) -> Result<StaticSelectionRayTrace, CollisionQueryError> {
        Ok(self
            .trace_static_surface_ray_with_policy(
                request,
                CollisionQueryPolicy::RequireCollisionCoverage,
            )?
            .value)
    }

    fn trace_static_surface_ray_with_policy(
        &self,
        request: StaticSurfaceRayRequest,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<StaticSelectionRayTrace>, CollisionQueryError> {
        validate_ray(request)?;
        let end = request.start + request.direction * request.maximum_distance;
        let full_path = self.transit_surface_ray_path(request, end)?;
        let mut swept_placement = full_path.initial().placement().clone();
        for leg in full_path.legs() {
            swept_placement = swept_placement.merge_reached(leg.end().placement().clone());
        }

        let full_sweep = ray_sweep(request, end);
        let full_touched = touched_landblocks(full_sweep);
        let ray = Ray::new(parry_vector(request.start), parry_vector(request.direction));
        let mut earliest = None;

        if swept_placement.reaches_outdoors() {
            for owner in &full_touched {
                let Some(asset) = self.landblocks.get(owner) else {
                    continue;
                };
                for cell in &asset.terrain.cells {
                    for triangle in &cell.triangles {
                        let vertices = triangle.vertices.map(|vertex| {
                            super::point_between_landblocks(vertex, owner.0, request.anchor.0)
                        });
                        update_triangle_hit(
                            &ray,
                            request.maximum_distance,
                            vertices,
                            triangle.normal,
                            *owner,
                            &mut earliest,
                        );
                    }
                }
            }
        }

        for selected in self.selected_colliders(swept_query_cells(full_sweep), &swept_placement) {
            let collider = &self.landblocks[&selected.reference.owner]
                .static_geometry
                .colliders[selected.reference.collider_index];
            if let Some(candidate) = cast_placed_collision_shape(
                &ray,
                request.maximum_distance,
                collider,
                selected.reference.owner,
                request.anchor,
            ) {
                update_earliest(&mut earliest, candidate);
            }
        }

        if swept_placement.reaches_outdoors()
            && !request
                .filter
                .excludes(PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER)
        {
            for owner in &full_touched {
                let Some(asset) = self.landblocks.get(owner) else {
                    continue;
                };
                if !asset.terrain.entirely_water {
                    continue;
                }
                let local_start = anchor_to_landblock(request.start, request.anchor, *owner);
                if (0.0..holtburger_common::position::METERS_PER_LANDBLOCK).contains(&local_start.x)
                    && (0.0..holtburger_common::position::METERS_PER_LANDBLOCK)
                        .contains(&local_start.y)
                {
                    continue;
                }
                if let Some(hit) =
                    landblock_entry_hit(local_start, request.direction * request.maximum_distance)
                {
                    update_earliest(
                        &mut earliest,
                        SurfaceCandidate {
                            distance: hit.time_of_impact * request.maximum_distance,
                            normal: hit.normal,
                            owner: *owner,
                        },
                    );
                }
            }
        }

        let clipped_end =
            earliest.map_or(end, |hit| request.start + request.direction * hit.distance);
        let clipped_path = self.transit_surface_ray_path(request, clipped_end)?;
        let mut clipped_placement = clipped_path.initial().placement().clone();
        for leg in clipped_path.legs() {
            clipped_placement = clipped_placement.merge_reached(leg.end().placement().clone());
        }
        let touched = touched_landblocks(ray_sweep(request, clipped_end));
        let unavailable_owner = self
            .complete_query(policy, &touched, &clipped_placement, ())?
            .unavailable_owner;
        let hit = earliest.map(|candidate| StaticSurfaceRayHit {
            point: clipped_end,
            distance: candidate.distance,
            normal: candidate.normal,
            placement: clipped_path.final_point().placement().clone(),
            proof: self
                .owner_proof(candidate.owner)
                .expect("an installed collision candidate retains its owner proof"),
        });
        Ok(UncoveredCollisionQuery {
            value: StaticSelectionRayTrace {
                static_hit: hit,
                reached: clipped_placement,
            },
            unavailable_owner,
        })
    }

    pub(super) fn transit_surface_ray_path(
        &self,
        request: StaticSurfaceRayRequest,
        end: Vector3,
    ) -> Result<super::PlacedMotionPath, CollisionQueryError> {
        self.transit_motion_path_allowing_point_radius(PlacedMotionPathRequest {
            previous_cell: request.previous_cell,
            anchor: request.anchor,
            start: request.start,
            radius: 0.0,
            waypoints: &[MotionWaypoint {
                center: end,
                end_fraction: 1.0,
                placement: MotionWaypointPlacement::Traverse,
            }],
        })
    }
}

pub(super) fn validate_ray(request: StaticSurfaceRayRequest) -> Result<(), CollisionQueryError> {
    if !request.direction.x.is_finite()
        || !request.direction.y.is_finite()
        || !request.direction.z.is_finite()
    {
        return Err(CollisionQueryError::NonFiniteDirection);
    }
    if (request.direction.length_squared() - 1.0).abs() > DIRECTION_LENGTH_TOLERANCE {
        return Err(CollisionQueryError::UnnormalizedDirection);
    }
    if !request.maximum_distance.is_finite() || request.maximum_distance < 0.0 {
        return Err(CollisionQueryError::InvalidDistance);
    }
    let end = request.start + request.direction * request.maximum_distance;
    validate_point_sweep(ray_sweep(request, end))
}

pub(super) fn ray_sweep(request: StaticSurfaceRayRequest, end: Vector3) -> SphereSweep {
    SphereSweep {
        anchor: request.anchor,
        start: request.start,
        end,
        radius: 0.0,
    }
}

fn cast_polygon(
    ray: &Ray,
    maximum_distance: f32,
    collider: &PlacedCollisionShape,
    owner: Guid,
    anchor: Guid,
    polygon: &CollisionPolygon,
    earliest: &mut Option<SurfaceCandidate>,
) {
    if polygon.vertices.len() < 3 {
        return;
    }
    let normal = collider.normal_to_landblock_space(polygon.normal);
    if world_vector(ray.dir).dot(&normal) >= 0.0 {
        return;
    }
    let first = placed_anchor_point(collider, polygon.vertices[0], owner, anchor);
    for edge in polygon.vertices[1..].windows(2) {
        update_triangle_hit(
            ray,
            maximum_distance,
            [
                first,
                placed_anchor_point(collider, edge[0], owner, anchor),
                placed_anchor_point(collider, edge[1], owner, anchor),
            ],
            normal,
            owner,
            earliest,
        );
    }
}

/// Casts one already-placed authored or primitive shape in the caller's anchor frame.
pub(super) fn cast_placed_collision_shape(
    ray: &Ray,
    maximum_distance: f32,
    collider: &PlacedCollisionShape,
    owner: Guid,
    anchor: Guid,
) -> Option<SurfaceCandidate> {
    let mut earliest = None;
    match &*collider.shape {
        CollisionShape::Bsp(solid) => {
            let mut polygon_ids = solid.polygons.keys().copied().collect::<Vec<_>>();
            polygon_ids.sort_unstable();
            for polygon_id in polygon_ids {
                cast_polygon(
                    ray,
                    maximum_distance,
                    collider,
                    owner,
                    anchor,
                    &solid.polygons[&polygon_id],
                    &mut earliest,
                );
            }
        }
        CollisionShape::Ball(ball) => {
            let scale = collider
                .scale
                .as_uniform()
                .expect("placed collision balls have validated uniform scale");
            let center = collider.point_to_landblock_space(ball.center);
            let center = super::point_between_landblocks(center, owner.0, anchor.0);
            update_shape_hit(
                ray,
                maximum_distance,
                &Ball::new(ball.radius * scale),
                Pose::from_translation(parry_vector(center)),
                owner,
                &mut earliest,
            );
        }
        CollisionShape::Cylinder(cylinder) => {
            let scale = collider
                .scale
                .as_uniform()
                .expect("placed collision cylinders have validated uniform scale");
            let height = cylinder.height * scale;
            let low = collider.point_to_landblock_space(cylinder.low_point);
            let center = super::point_between_landblocks(
                low + Vector3::new(0.0, 0.0, height * 0.5),
                owner.0,
                anchor.0,
            );
            let pose = Pose::from_parts(
                parry_vector(center),
                parry3d::math::Rotation::from_rotation_x(std::f32::consts::FRAC_PI_2),
            );
            update_shape_hit(
                ray,
                maximum_distance,
                &Cylinder::new(height * 0.5, cylinder.radius * scale),
                pose,
                owner,
                &mut earliest,
            );
        }
    }
    earliest
}

fn update_triangle_hit(
    ray: &Ray,
    maximum_distance: f32,
    vertices: [Vector3; 3],
    normal: Vector3,
    owner: Guid,
    earliest: &mut Option<SurfaceCandidate>,
) {
    if world_vector(ray.dir).dot(&normal) >= 0.0 {
        return;
    }
    let triangle = Triangle::new(
        parry_vector(vertices[0]),
        parry_vector(vertices[1]),
        parry_vector(vertices[2]),
    );
    if let Some(hit) =
        triangle.cast_ray_and_get_normal(&Pose::IDENTITY, ray, maximum_distance, false)
    {
        update_earliest(
            earliest,
            SurfaceCandidate {
                distance: hit.time_of_impact,
                normal,
                owner,
            },
        );
    }
}

fn update_shape_hit(
    ray: &Ray,
    maximum_distance: f32,
    shape: &dyn parry3d::shape::Shape,
    pose: Pose,
    owner: Guid,
    earliest: &mut Option<SurfaceCandidate>,
) {
    if let Some(hit) = shape.cast_ray_and_get_normal(&pose, ray, maximum_distance, false) {
        update_earliest(
            earliest,
            SurfaceCandidate {
                distance: hit.time_of_impact,
                normal: world_vector(hit.normal),
                owner,
            },
        );
    }
}

fn update_earliest(earliest: &mut Option<SurfaceCandidate>, candidate: SurfaceCandidate) {
    if earliest.is_none_or(|current| {
        candidate.distance < current.distance
            || (candidate.distance == current.distance && candidate.owner < current.owner)
    }) {
        *earliest = Some(candidate);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use holtburger_common::{Plane, Quaternion};
    use holtburger_content::{
        BspSolid, CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale,
        CollisionBall, CollisionBox, CollisionCylinder, CollisionPolygon, LandblockColliders,
        LandblockCollisionAsset, LandblockPlacement, PlacedCollider, StaticColliderPlacement,
        TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode};

    use super::*;

    const OWNER: Guid = Guid(0xda55_ffff);

    fn request(
        start: Vector3,
        direction: Vector3,
        maximum_distance: f32,
    ) -> StaticSurfaceRayRequest {
        StaticSurfaceRayRequest {
            anchor: OWNER,
            start,
            direction,
            maximum_distance,
            previous_cell: None,
            filter: PhysicalCollisionFilter::ALL,
        }
    }

    fn asset(
        owner: Guid,
        terrain: TerrainCollisionSurface,
        colliders: Vec<PlacedCollider>,
        cell_volumes: Vec<CellVolume>,
    ) -> LandblockCollisionAsset {
        LandblockCollisionAsset {
            landblock_id: owner.0,
            terrain,
            static_geometry: LandblockColliders::new(colliders, cell_volumes),
        }
    }

    fn ball_collider(
        origin: Vector3,
        radius: f32,
        source_placement: StaticColliderPlacement,
    ) -> PlacedCollider {
        PlacedCollider::new(
            Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius,
            })),
            LandblockPlacement {
                origin,
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            source_placement,
        )
        .unwrap()
    }

    fn outdoor_ball(origin: Vector3, radius: f32, source_index: usize) -> PlacedCollider {
        ball_collider(
            origin,
            radius,
            StaticColliderPlacement::OutdoorExplicit { source_index },
        )
    }

    fn volume(selector: u16, portals: Vec<CellCollisionPortal>) -> CellVolume {
        CellVolume {
            cell_selector: selector,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: Vec::new(),
            portals,
        }
    }

    #[test]
    fn ray_selects_the_nearest_installed_surface_and_retains_its_proof() {
        let mut scene = CollisionScene::new();
        scene
            .insert(asset(
                OWNER,
                TerrainCollisionSurface::empty(),
                vec![
                    outdoor_ball(Vector3::new(8.0, 10.0, 10.0), 1.0, 0),
                    outdoor_ball(Vector3::new(4.0, 10.0, 10.0), 1.0, 1),
                ],
                Vec::new(),
            ))
            .unwrap();

        let hit = scene
            .cast_static_surface_ray(request(
                Vector3::new(0.0, 10.0, 10.0),
                Vector3::new(1.0, 0.0, 0.0),
                10.0,
            ))
            .unwrap()
            .unwrap();

        assert!((hit.distance - 3.0).abs() < 0.000_1, "{hit:?}");
        assert_eq!(hit.point, Vector3::new(3.0, 10.0, 10.0));
        assert_eq!(hit.normal, Vector3::new(-1.0, 0.0, 0.0));
        assert!(scene.proves(hit.proof));
    }

    #[test]
    fn ray_hits_each_authored_static_shape_family() {
        let primitive_placement = StaticColliderPlacement::OutdoorExplicit { source_index: 0 };
        for shape in [
            Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 1.0,
            })),
            Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                low_point: Vector3::new(0.0, 0.0, -2.0),
                radius: 1.0,
                height: 4.0,
            })),
        ] {
            let collider = PlacedCollider::new(
                shape,
                LandblockPlacement {
                    origin: Vector3::new(5.0, 10.0, 10.0),
                    orientation: Quaternion::identity(),
                },
                ColliderScale::uniform(1.0).unwrap(),
                primitive_placement,
            )
            .unwrap();
            let mut scene = CollisionScene::new();
            scene
                .insert(asset(
                    OWNER,
                    TerrainCollisionSurface::empty(),
                    vec![collider],
                    Vec::new(),
                ))
                .unwrap();

            let hit = scene
                .cast_static_surface_ray(request(
                    Vector3::new(0.0, 10.0, 10.0),
                    Vector3::new(1.0, 0.0, 0.0),
                    10.0,
                ))
                .unwrap()
                .unwrap();
            assert!((hit.distance - 4.0).abs() < 0.000_1, "{hit:?}");
            assert!(
                hit.normal.distance(&Vector3::new(-1.0, 0.0, 0.0)) < 0.000_1,
                "{hit:?}"
            );
        }

        let vertices = vec![
            Vector3::new(5.0, 8.0, 8.0),
            Vector3::new(5.0, 8.0, 12.0),
            Vector3::new(5.0, 12.0, 12.0),
            Vector3::new(5.0, 12.0, 8.0),
        ];
        let bounds = holtburger_common::Sphere {
            center: Vector3::new(5.0, 10.0, 10.0),
            radius: 3.0,
        };
        let bsp = PlacedCollider::new(
            Arc::new(CollisionShape::Bsp(BspSolid {
                bsp: BspNode::Leaf(BspLeaf {
                    index: 0,
                    solid: 0,
                    sphere: Some(bounds),
                    poly_ids: vec![1],
                }),
                bounds,
                box_bounds: CollisionBox::from_points(vertices.iter().copied()).unwrap(),
                polygons: std::collections::HashMap::from([(
                    1,
                    CollisionPolygon {
                        vertices,
                        normal: Vector3::new(-1.0, 0.0, 0.0),
                        d: 5.0,
                    },
                )]),
            })),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        )
        .unwrap();
        let mut scene = CollisionScene::new();
        scene
            .insert(asset(
                OWNER,
                TerrainCollisionSurface::empty(),
                vec![bsp],
                Vec::new(),
            ))
            .unwrap();
        let hit = scene
            .cast_static_surface_ray(request(
                Vector3::new(0.0, 10.0, 10.0),
                Vector3::new(1.0, 0.0, 0.0),
                10.0,
            ))
            .unwrap()
            .unwrap();
        assert!((hit.distance - 5.0).abs() < 0.000_1, "{hit:?}");
        assert_eq!(hit.normal, Vector3::new(-1.0, 0.0, 0.0));
    }

    #[test]
    fn ray_hits_terrain_and_preserves_a_non_walkable_surface_normal() {
        let terrain =
            TerrainCollisionSurface::from_terrain(&holtburger_content::LandblockTerrain {
                grid_size: 9,
                tile_size: 24.0,
                height_indices: vec![0; 81],
                heights: vec![0.0; 81],
                terrain_samples: vec![0; 81],
                cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(OWNER.0),
            })
            .unwrap();
        let mut scene = CollisionScene::new();
        scene
            .insert(asset(OWNER, terrain, Vec::new(), Vec::new()))
            .unwrap();

        let hit = scene
            .cast_static_surface_ray(request(
                Vector3::new(96.0, 96.0, 5.0),
                Vector3::new(0.0, 0.0, -1.0),
                10.0,
            ))
            .unwrap()
            .unwrap();

        assert!((hit.distance - 5.0).abs() < 0.000_1, "{hit:?}");
        assert_eq!(hit.normal, Vector3::new(0.0, 0.0, 1.0));

        let mut vertical_scene = CollisionScene::new();
        vertical_scene
            .insert(asset(
                OWNER,
                TerrainCollisionSurface::empty(),
                vec![outdoor_ball(Vector3::new(5.0, 10.0, 10.0), 1.0, 0)],
                Vec::new(),
            ))
            .unwrap();
        let vertical = vertical_scene
            .cast_static_surface_ray(request(
                Vector3::new(0.0, 10.0, 10.0),
                Vector3::new(1.0, 0.0, 0.0),
                10.0,
            ))
            .unwrap()
            .unwrap();
        assert_eq!(vertical.normal.z, 0.0, "{vertical:?}");
    }

    #[test]
    fn early_hit_does_not_require_unloaded_coverage_behind_it() {
        let mut scene = CollisionScene::new();
        scene
            .insert(asset(
                OWNER,
                TerrainCollisionSurface::empty(),
                vec![outdoor_ball(Vector3::new(188.0, 96.0, 10.0), 1.0, 0)],
                Vec::new(),
            ))
            .unwrap();

        let hit = scene
            .cast_static_surface_ray(request(
                Vector3::new(180.0, 96.0, 10.0),
                Vector3::new(1.0, 0.0, 0.0),
                30.0,
            ))
            .unwrap()
            .unwrap();

        assert!((hit.distance - 7.0).abs() < 0.000_1, "{hit:?}");
    }

    #[test]
    fn clear_ray_reports_missing_coverage_under_the_selected_policy() {
        let scene = CollisionScene::new();
        let ray = request(
            Vector3::new(20.0, 20.0, 10.0),
            Vector3::new(1.0, 0.0, 0.0),
            10.0,
        );

        assert_eq!(
            scene.cast_static_surface_ray(ray),
            Err(CollisionQueryError::UnavailableOwner { owner: OWNER.0 })
        );
        assert_eq!(
            scene
                .cast_static_surface_ray_with_policy(
                    ray,
                    CollisionQueryPolicy::AllowUncoveredQuery,
                )
                .unwrap(),
            UncoveredCollisionQuery {
                value: None,
                unavailable_owner: Some(OWNER),
            }
        );
    }

    #[test]
    fn ray_crosses_landblock_frames_before_hitting_neighbor_geometry() {
        let east = Guid(0xdb55_ffff);
        let mut scene = CollisionScene::new();
        scene
            .insert(asset(
                OWNER,
                TerrainCollisionSurface::empty(),
                Vec::new(),
                Vec::new(),
            ))
            .unwrap();
        scene
            .insert(asset(
                east,
                TerrainCollisionSurface::empty(),
                vec![outdoor_ball(Vector3::new(2.0, 96.0, 10.0), 1.0, 0)],
                Vec::new(),
            ))
            .unwrap();

        let hit = scene
            .cast_static_surface_ray(request(
                Vector3::new(190.0, 96.0, 10.0),
                Vector3::new(1.0, 0.0, 0.0),
                10.0,
            ))
            .unwrap()
            .unwrap();

        assert!((hit.distance - 3.0).abs() < 0.000_1, "{hit:?}");
        assert_eq!(hit.proof.owner(), east);
    }

    #[test]
    fn ray_observes_water_barrier_exclusions() {
        let east = Guid(0xdb55_ffff);
        let mut scene = CollisionScene::new();
        scene
            .insert(asset(
                OWNER,
                TerrainCollisionSurface::empty(),
                Vec::new(),
                Vec::new(),
            ))
            .unwrap();
        scene
            .insert(asset(
                east,
                TerrainCollisionSurface {
                    entirely_water: true,
                    ..TerrainCollisionSurface::empty()
                },
                Vec::new(),
                Vec::new(),
            ))
            .unwrap();
        let ray = request(
            Vector3::new(190.0, 96.0, 10.0),
            Vector3::new(1.0, 0.0, 0.0),
            4.0,
        );

        let hit = scene.cast_static_surface_ray(ray).unwrap().unwrap();
        assert!((hit.distance - 2.0).abs() < f32::EPSILON, "{hit:?}");
        assert_eq!(hit.normal, Vector3::new(-1.0, 0.0, 0.0));

        let excluded = StaticSurfaceRayRequest {
            filter: PhysicalCollisionFilter::excluding(
                PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER,
            ),
            ..ray
        };
        assert_eq!(scene.cast_static_surface_ray(excluded).unwrap(), None);
    }

    #[test]
    fn ray_traverses_only_authored_env_cell_portals() {
        let source = Guid(0xda55_010a);
        let target = Guid(0xda55_010b);
        let target_collider = || {
            ball_collider(
                Vector3::new(13.0, 10.0, 10.0),
                1.0,
                StaticColliderPlacement::IndoorStatic {
                    source_cell_id: target.0,
                    source_index: 0,
                },
            )
        };
        let target_volume = volume(0x010b, Vec::new());
        let mut open_scene = CollisionScene::new();
        open_scene
            .insert(asset(
                OWNER,
                TerrainCollisionSurface::empty(),
                vec![target_collider()],
                vec![
                    volume(
                        0x010a,
                        vec![CellCollisionPortal {
                            plane: Plane {
                                normal: Vector3::new(1.0, 0.0, 0.0),
                                d: -10.0,
                            },
                            positive_side: true,
                            target: CellCollisionPortalTarget::EnvCell(0x010b),
                            outdoor_building: None,
                        }],
                    ),
                    target_volume.clone(),
                ],
            ))
            .unwrap();
        let indoor_ray = StaticSurfaceRayRequest {
            previous_cell: Some(source),
            ..request(
                Vector3::new(5.0, 10.0, 10.0),
                Vector3::new(1.0, 0.0, 0.0),
                10.0,
            )
        };

        let hit = open_scene
            .cast_static_surface_ray(indoor_ray)
            .unwrap()
            .unwrap();
        assert!((hit.distance - 7.0).abs() < 0.000_1, "{hit:?}");
        assert_eq!(hit.placement.committed_cell(), Some(target));

        let mut sealed_scene = CollisionScene::new();
        sealed_scene
            .insert(asset(
                OWNER,
                TerrainCollisionSurface::empty(),
                vec![target_collider()],
                vec![volume(0x010a, Vec::new()), target_volume],
            ))
            .unwrap();
        assert_eq!(
            sealed_scene.cast_static_surface_ray(indoor_ray).unwrap(),
            None
        );
    }

    #[test]
    fn ray_rejects_non_finite_or_non_normalized_inputs() {
        let scene = CollisionScene::new();
        assert_eq!(
            scene.cast_static_surface_ray(request(
                Vector3::zero(),
                Vector3::new(f32::NAN, 0.0, 0.0),
                1.0,
            )),
            Err(CollisionQueryError::NonFiniteDirection)
        );
        assert_eq!(
            scene.cast_static_surface_ray(request(
                Vector3::zero(),
                Vector3::new(2.0, 0.0, 0.0),
                1.0,
            )),
            Err(CollisionQueryError::UnnormalizedDirection)
        );
        assert_eq!(
            scene.cast_static_surface_ray(request(
                Vector3::zero(),
                Vector3::new(1.0, 0.0, 0.0),
                f32::INFINITY,
            )),
            Err(CollisionQueryError::InvalidDistance)
        );
        assert_eq!(
            scene.cast_static_surface_ray(request(
                Vector3::new(f32::NAN, 0.0, 0.0),
                Vector3::new(1.0, 0.0, 0.0),
                1.0,
            )),
            Err(CollisionQueryError::NonFiniteCenter)
        );
    }
}
