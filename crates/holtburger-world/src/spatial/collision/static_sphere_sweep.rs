//! Continuous static swept-sphere collision over resident AC geometry.

use holtburger_common::{Guid, Vector3};
use holtburger_content::{CollisionPolygon, CollisionShape, PlacedCollisionShape};
use parry3d::math::{Pose, Vector as ParryVector};
use parry3d::query::{ShapeCastOptions, cast_shapes};
use parry3d::shape::{Ball, Cylinder, Triangle};

use super::{
    CollisionQueryError, CollisionQueryPolicy, CollisionScene, GlobalCellRange, MotionWaypoint,
    MotionWaypointPlacement, PhysicalCollisionExclusions, PhysicalCollisionFilter,
    PlacedMotionPathRequest, SphereSweep, UncoveredCollisionQuery, anchor_to_landblock,
    landblock_key, point_between_landblocks, touched_landblocks, validate_sweep,
};

/// One continuous sphere displacement against resident static collision geometry.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StaticSphereSweepRequest {
    /// Outdoor landblock frame containing both endpoints.
    pub anchor: Guid,
    /// Sphere center at normalized time zero.
    pub start: Vector3,
    /// Sphere center at normalized time one.
    pub end: Vector3,
    /// Previously committed EnvCell, or `None` outdoors.
    pub previous_cell: Option<Guid>,
    /// Positive sphere radius.
    pub radius: f32,
    /// Optional collision-domain exclusions owned by the querying body.
    pub filter: PhysicalCollisionFilter,
}

/// Earliest static obstruction reached by one continuous sphere displacement.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StaticSphereSweepHit {
    /// Normalized time of impact in `[0, 1]`.
    pub time_of_impact: f32,
    /// Unit normal pointing away from the obstructing surface.
    pub normal: Vector3,
}

impl CollisionScene {
    /// Returns the earliest continuous static obstruction along the complete requested segment.
    pub fn sweep_static_sphere(
        &self,
        request: StaticSphereSweepRequest,
    ) -> Result<Option<StaticSphereSweepHit>, CollisionQueryError> {
        Ok(self
            .sweep_static_sphere_with_policy(
                request,
                CollisionQueryPolicy::RequireCollisionCoverage,
            )?
            .value)
    }

    /// Returns the earliest installed obstruction under one explicit coverage policy.
    pub fn sweep_static_sphere_with_policy(
        &self,
        request: StaticSphereSweepRequest,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<Option<StaticSphereSweepHit>>, CollisionQueryError> {
        let sweep = SphereSweep {
            anchor: request.anchor,
            start: request.start,
            end: request.end,
            radius: request.radius,
        };
        validate_sweep(sweep)?;
        let displacement = request.end - request.start;

        let placement_path = self.transit_motion_path(PlacedMotionPathRequest {
            previous_cell: request.previous_cell,
            anchor: request.anchor,
            start: request.start,
            radius: request.radius,
            waypoints: &[MotionWaypoint {
                center: request.end,
                end_fraction: 1.0,
                placement: MotionWaypointPlacement::Traverse,
            }],
        })?;
        let mut swept_placement = placement_path.initial().placement().clone();
        for leg in placement_path.legs() {
            swept_placement = swept_placement.merge_reached(leg.end().placement().clone());
        }

        let touched = touched_landblocks(sweep);
        if displacement.length_squared() <= f32::EPSILON {
            return self.complete_query(policy, &touched, &swept_placement, None);
        }

        let moving_ball = Ball::new(request.radius);
        let narrow_phase = MovingSphereCast {
            ball: &moving_ball,
            pose: Pose::from_translation(parry_vector(request.start)),
            velocity: parry_vector(displacement),
            displacement,
        };
        let mut earliest = None;

        if swept_placement.reaches_outdoors() {
            for owner in &touched {
                let Some(asset) = self.landblocks.get(owner) else {
                    continue;
                };
                for cell in &asset.terrain.cells {
                    for triangle in &cell.triangles {
                        let vertices = triangle.vertices.map(|vertex| {
                            point_between_landblocks(vertex, owner.0, request.anchor.0)
                        });
                        narrow_phase.update_triangle_hit(
                            vertices,
                            triangle.normal,
                            &mut earliest,
                        )?;
                    }
                }
            }
        }

        let query_cells = swept_query_cells(sweep);
        for selected in self.selected_colliders(query_cells, &swept_placement) {
            let collider = &self.landblocks[&selected.reference.owner]
                .static_geometry
                .colliders[selected.reference.collider_index];
            match &*collider.shape {
                CollisionShape::Bsp(solid) => {
                    let mut polygon_ids = solid.polygons.keys().copied().collect::<Vec<_>>();
                    polygon_ids.sort_unstable();
                    for polygon_id in polygon_ids {
                        sweep_polygon(
                            &narrow_phase,
                            collider,
                            selected.reference.owner,
                            request.anchor,
                            &solid.polygons[&polygon_id],
                            &mut earliest,
                        )?;
                    }
                }
                CollisionShape::Ball(ball) => {
                    let scale = collider
                        .scale
                        .as_uniform()
                        .expect("placed collision balls have validated uniform scale");
                    let center = collider.point_to_landblock_space(ball.center);
                    let center = point_between_landblocks(
                        center,
                        selected.reference.owner.0,
                        request.anchor.0,
                    );
                    let target = Ball::new(ball.radius * scale);
                    narrow_phase.update_shape_hit(
                        &target,
                        Pose::from_translation(parry_vector(center)),
                        &mut earliest,
                    )?;
                }
                CollisionShape::Cylinder(cylinder) => {
                    let scale = collider
                        .scale
                        .as_uniform()
                        .expect("placed collision cylinders have validated uniform scale");
                    let height = cylinder.height * scale;
                    let low = collider.point_to_landblock_space(cylinder.low_point);
                    let center = point_between_landblocks(
                        low + Vector3::new(0.0, 0.0, height * 0.5),
                        selected.reference.owner.0,
                        request.anchor.0,
                    );
                    let target = Cylinder::new(height * 0.5, cylinder.radius * scale);
                    let target_pose = Pose::from_parts(
                        parry_vector(center),
                        parry3d::math::Rotation::from_rotation_x(std::f32::consts::FRAC_PI_2),
                    );
                    narrow_phase.update_shape_hit(&target, target_pose, &mut earliest)?;
                }
            }
        }

        if swept_placement.reaches_outdoors()
            && !request
                .filter
                .excludes(PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER)
        {
            update_water_restriction_hit(self, sweep, &touched, &mut earliest);
        }

        self.complete_query(policy, &touched, &swept_placement, earliest)
    }
}

/// Immutable moving-shape facts shared by every static narrow-phase pairing.
struct MovingSphereCast<'a> {
    ball: &'a Ball,
    pose: Pose,
    velocity: ParryVector,
    displacement: Vector3,
}

fn sweep_polygon(
    moving: &MovingSphereCast<'_>,
    collider: &PlacedCollisionShape,
    owner: Guid,
    anchor: Guid,
    polygon: &CollisionPolygon,
    earliest: &mut Option<StaticSphereSweepHit>,
) -> Result<(), CollisionQueryError> {
    if polygon.vertices.len() < 3 {
        return Ok(());
    }
    let normal = collider.normal_to_landblock_space(polygon.normal);
    if moving.displacement.dot(&normal) >= 0.0 {
        return Ok(());
    }
    let first = placed_anchor_point(collider, polygon.vertices[0], owner, anchor);
    for edge in polygon.vertices[1..].windows(2) {
        let vertices = [
            first,
            placed_anchor_point(collider, edge[0], owner, anchor),
            placed_anchor_point(collider, edge[1], owner, anchor),
        ];
        moving.update_triangle_hit(vertices, normal, earliest)?;
    }
    Ok(())
}

impl MovingSphereCast<'_> {
    fn update_triangle_hit(
        &self,
        vertices: [Vector3; 3],
        normal: Vector3,
        earliest: &mut Option<StaticSphereSweepHit>,
    ) -> Result<(), CollisionQueryError> {
        if self.displacement.dot(&normal) >= 0.0 {
            return Ok(());
        }
        let triangle = Triangle::new(
            parry_vector(vertices[0]),
            parry_vector(vertices[1]),
            parry_vector(vertices[2]),
        );
        let Some(hit) = cast_shapes(
            &self.pose,
            self.velocity,
            self.ball,
            &Pose::IDENTITY,
            ParryVector::ZERO,
            &triangle,
            cast_options(),
        )
        .map_err(|_| CollisionQueryError::UnsupportedSphereSweep)?
        else {
            return Ok(());
        };
        update_earliest(
            earliest,
            StaticSphereSweepHit {
                time_of_impact: hit.time_of_impact,
                normal,
            },
        );
        Ok(())
    }

    fn update_shape_hit(
        &self,
        target: &dyn parry3d::shape::Shape,
        target_pose: Pose,
        earliest: &mut Option<StaticSphereSweepHit>,
    ) -> Result<(), CollisionQueryError> {
        let Some(hit) = cast_shapes(
            &self.pose,
            self.velocity,
            self.ball,
            &target_pose,
            ParryVector::ZERO,
            target,
            cast_options(),
        )
        .map_err(|_| CollisionQueryError::UnsupportedSphereSweep)?
        else {
            return Ok(());
        };
        update_earliest(
            earliest,
            StaticSphereSweepHit {
                time_of_impact: hit.time_of_impact,
                normal: world_vector(hit.normal1),
            },
        );
        Ok(())
    }
}

fn cast_options() -> ShapeCastOptions {
    ShapeCastOptions {
        max_time_of_impact: 1.0,
        target_distance: 0.0,
        stop_at_penetration: true,
        compute_impact_geometry_on_penetration: true,
    }
}

fn update_earliest(earliest: &mut Option<StaticSphereSweepHit>, candidate: StaticSphereSweepHit) {
    if earliest.is_none_or(|current| candidate.time_of_impact < current.time_of_impact) {
        *earliest = Some(candidate);
    }
}

fn placed_anchor_point(
    collider: &PlacedCollisionShape,
    point: Vector3,
    owner: Guid,
    anchor: Guid,
) -> Vector3 {
    point_between_landblocks(collider.point_to_landblock_space(point), owner.0, anchor.0)
}

fn swept_query_cells(sweep: SphereSweep) -> GlobalCellRange {
    let minimum = Vector3::new(
        sweep.start.x.min(sweep.end.x) - sweep.radius,
        sweep.start.y.min(sweep.end.y) - sweep.radius,
        sweep.start.z.min(sweep.end.z) - sweep.radius,
    );
    let maximum = Vector3::new(
        sweep.start.x.max(sweep.end.x) + sweep.radius,
        sweep.start.y.max(sweep.end.y) + sweep.radius,
        sweep.start.z.max(sweep.end.z) + sweep.radius,
    );
    GlobalCellRange::from_local_extent(landblock_key(sweep.anchor), minimum, maximum)
}

fn update_water_restriction_hit(
    scene: &CollisionScene,
    sweep: SphereSweep,
    touched: &[Guid],
    earliest: &mut Option<StaticSphereSweepHit>,
) {
    for owner in touched {
        let Some(asset) = scene.landblocks.get(owner) else {
            continue;
        };
        if !asset.terrain.entirely_water {
            continue;
        }
        let local_start = anchor_to_landblock(sweep.start, sweep.anchor, *owner);
        if (0.0..holtburger_common::position::METERS_PER_LANDBLOCK).contains(&local_start.x)
            && (0.0..holtburger_common::position::METERS_PER_LANDBLOCK).contains(&local_start.y)
        {
            continue;
        }
        if let Some(hit) = landblock_entry_hit(local_start, sweep.end - sweep.start) {
            update_earliest(earliest, hit);
        }
    }
}

fn landblock_entry_hit(start: Vector3, displacement: Vector3) -> Option<StaticSphereSweepHit> {
    let extent = holtburger_common::position::METERS_PER_LANDBLOCK;
    let mut enter = 0.0_f32;
    let mut exit = 1.0_f32;
    let mut normal = Vector3::zero();
    for (start, delta, low_normal, high_normal) in [
        (
            start.x,
            displacement.x,
            Vector3::new(-1.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
        ),
        (
            start.y,
            displacement.y,
            Vector3::new(0.0, -1.0, 0.0),
            Vector3::new(0.0, 1.0, 0.0),
        ),
    ] {
        if delta.abs() <= f32::EPSILON {
            if !(0.0..extent).contains(&start) {
                return None;
            }
            continue;
        }
        let low = (0.0 - start) / delta;
        let high = (extent - start) / delta;
        let (axis_enter, axis_exit, axis_normal) = if low <= high {
            (low, high, low_normal)
        } else {
            (high, low, high_normal)
        };
        if axis_enter > enter {
            enter = axis_enter;
            normal = axis_normal;
        }
        exit = exit.min(axis_exit);
        if enter > exit {
            return None;
        }
    }
    (0.0..=1.0)
        .contains(&enter)
        .then_some(StaticSphereSweepHit {
            time_of_impact: enter,
            normal,
        })
}

fn parry_vector(value: Vector3) -> ParryVector {
    ParryVector::new(value.x, value.y, value.z)
}

fn world_vector(value: ParryVector) -> Vector3 {
    Vector3::new(value.x, value.y, value.z)
}
