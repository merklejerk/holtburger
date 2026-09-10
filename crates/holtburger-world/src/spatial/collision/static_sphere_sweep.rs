//! Continuous static swept-sphere collision over resident AC geometry.

use holtburger_common::{Guid, Vector3};
use holtburger_content::{
    CellCollisionPortalTarget, CollisionPolygon, CollisionShape, PlacedCollisionShape,
};
use parry3d::math::{Pose, Vector as ParryVector};
use parry3d::query::{PointQuery, ShapeCastOptions, cast_shapes};
use parry3d::shape::{Ball, Cylinder, Triangle};

use crate::spatial::{SpatialBodyId, volume_query::placed_volume_sweep_contact};

use super::{
    CELL_PLANE_TOLERANCE, CollisionQueryError, CollisionQueryPolicy, CollisionScene,
    GlobalCellRange, MotionWaypoint, MotionWaypointPlacement, PhysicalCollisionExclusions,
    PhysicalCollisionFilter, PlacedMotionPath, PlacedMotionPathRequest, SpatialMembership,
    SphereSweep, UncoveredCollisionQuery, anchor_to_landblock, landblock_key,
    overlapped_terrain_cells, point_between_landblocks, touched_landblocks, validate_sweep,
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
    /// Positive nominal sphere radius. Hard admission permits only the fixed contact band;
    /// support and published body geometry retain this full radius.
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

/// Earliest hard obstruction, retaining whether entity collision reporting applies.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum HardSphereSweepHit {
    /// Resident world geometry or a world movement restriction.
    World(StaticSphereSweepHit),
    /// One entity shape treated as non-yielding for this query.
    Entity {
        /// Canonical body supplying this hard surface.
        body_id: SpatialBodyId,
        /// Geometric impact and outward normal in the request frame.
        hit: StaticSphereSweepHit,
    },
}

impl HardSphereSweepHit {
    /// Contact geometry shared by world and entity stop/slide response.
    pub const fn contact(self) -> StaticSphereSweepHit {
        match self {
            Self::World(hit) | Self::Entity { hit, .. } => hit,
        }
    }
}

/// One prepared non-yielding query target, including its contact domains.
#[derive(Debug, Clone, Copy)]
pub struct HardEntityShape<'a> {
    /// Canonical body supplying the authored shape.
    pub body_id: SpatialBodyId,
    /// Shape placed in the sweep request's anchor frame.
    pub shape: &'a PlacedCollisionShape,
    /// Resident domains of the hard body, tested against the entire attempted sweep.
    pub membership: &'a SpatialMembership,
}

/// A hard sweep with the topology traversal already computed by its query owner.
#[derive(Debug, Clone, PartialEq)]
pub struct HardSphereSweep {
    /// Earliest hard obstruction; absence admits the complete requested segment.
    pub hit: Option<HardSphereSweepHit>,
    /// Collision-limited path, normalized to [0, 1]. Hit time remains in the original
    /// requested segment; path fractions describe only the accepted geometric prefix.
    pub path: PlacedMotionPath,
}

/// Resident hit candidates before a composed body establishes its stopping fraction.
/// Coverage is deliberately deferred until all movement spheres and hard targets contribute.
pub(crate) struct PreparedHardSphereSweep {
    /// Original request; final placement is resolved only for accepted travel.
    request: StaticSphereSweepRequest,
    /// Earliest resident blocker in original request fractions.
    pub(crate) hit: Option<HardSphereSweepHit>,
}

/// Resident static candidates and the domains used to select hard-entity candidates.
struct StaticSphereTrace {
    /// Earliest resident static hit in original request fractions.
    hit: Option<StaticSphereSweepHit>,
    /// Candidate domains used when admitting hard-entity geometry.
    membership: SpatialMembership,
}

impl CollisionScene {
    /// Sweeps against resident world geometry and prepared hard-entity candidates together.
    ///
    /// The caller supplies only nearby, pair-eligible hard entities, with shapes placed in the
    /// request's anchor frame and in stable identity/shape order. Character movement admits only
    /// hard entities here; one-way projectile sweeps may also admit snapshots of mobile targets.
    /// This query never changes an entity's pose or mobility.
    pub fn sweep_hard_sphere<'a>(
        &self,
        request: StaticSphereSweepRequest,
        entities: impl IntoIterator<Item = HardEntityShape<'a>>,
    ) -> Result<HardSphereSweep, CollisionQueryError> {
        let prepared = self.prepare_hard_sphere(request, entities)?;
        let fraction = prepared.hit.map_or(1.0, |hit| hit.contact().time_of_impact);
        let hit = prepared.hit;
        let path = self.finish_hard_sphere_path(prepared, fraction)?;
        Ok(HardSphereSweep { hit, path })
    }

    /// Collects resident hits without making a coverage claim about the attempted suffix.
    pub(crate) fn prepare_hard_sphere<'a>(
        &self,
        request: StaticSphereSweepRequest,
        entities: impl IntoIterator<Item = HardEntityShape<'a>>,
    ) -> Result<PreparedHardSphereSweep, CollisionQueryError> {
        let traced = self.trace_static_sphere(request)?;
        let mut earliest = traced.hit.map(HardSphereSweepHit::World);
        let ball = Ball::new(request.radius);
        let moving = MovingSphereCast::new(&ball, request.start, request.end);
        for HardEntityShape {
            body_id,
            shape,
            membership,
        } in entities
        {
            if !traced.membership.intersects_reached(membership) {
                continue;
            }
            let mut hit = None;
            moving.update_collider_hit(shape, request.anchor, request.anchor, &mut hit)?;
            if let Some(hit) = hit
                && earliest
                    .is_none_or(|current| hit.time_of_impact < current.contact().time_of_impact)
            {
                earliest = Some(HardSphereSweepHit::Entity { body_id, hit });
            }
        }
        Ok(PreparedHardSphereSweep {
            request,
            hit: earliest,
        })
    }

    /// Validates coverage and placement through the shared body's stopping fraction.
    pub(crate) fn finish_hard_sphere_path(
        &self,
        prepared: PreparedHardSphereSweep,
        fraction: f32,
    ) -> Result<PlacedMotionPath, CollisionQueryError> {
        Ok(self
            .finish_sphere_path(
                prepared.request,
                fraction,
                CollisionQueryPolicy::RequireCollisionCoverage,
            )?
            .value)
    }

    fn finish_sphere_path(
        &self,
        request: StaticSphereSweepRequest,
        fraction: f32,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<PlacedMotionPath>, CollisionQueryError> {
        let end = request.start + (request.end - request.start) * fraction;
        let path = self.transit_motion_path(PlacedMotionPathRequest {
            anchor: request.anchor,
            previous_cell: request.previous_cell,
            start: request.start,
            radius: request.radius,
            waypoints: &[MotionWaypoint {
                center: end,
                end_fraction: 1.0,
                placement: MotionWaypointPlacement::Traverse,
            }],
        })?;
        let mut start = path.initial();
        let mut unavailable_owner = None;
        for leg in path.legs() {
            let end = leg.end();
            let membership = start
                .placement()
                .clone()
                .merge_reached(end.placement().clone());
            let sweep = SphereSweep {
                anchor: request.anchor,
                start: start.center(),
                end: end.center(),
                radius: request.radius,
            };
            // Interior owners are independent of nominal terrain coordinates. Outdoor
            // coverage applies only while this accepted leg actually reaches outside.
            let coverage = self.complete_query(policy, &[], &membership, ())?;
            unavailable_owner = unavailable_owner.or(coverage.unavailable_owner);
            // Recovery into outdoors supplies no portal crossing to bound the interval,
            // so conservatively validate the whole accepted leg in that exceptional case.
            let intervals = if start.placement().committed_cell().is_none()
                || (end.placement().committed_cell().is_none() && end.recovery().is_some())
            {
                vec![(0.0, 1.0)]
            } else {
                self.outdoor_portal_overlap_intervals(sweep, &membership)?
            };
            for (low, high) in intervals {
                let displacement = sweep.end - sweep.start;
                let touched = touched_landblocks(SphereSweep {
                    start: sweep.start + displacement * low,
                    end: sweep.start + displacement * high,
                    ..sweep
                });
                let coverage =
                    self.complete_query(policy, &touched, &SpatialMembership::outdoor(), ())?;
                unavailable_owner = unavailable_owner.or(coverage.unavailable_owner);
            }
            start = end;
        }
        Ok(UncoveredCollisionQuery {
            value: path,
            unavailable_owner,
        })
    }

    /// Restricts terrain coverage to sphere overlap with authored outside portal planes.
    /// This uses the same plane band as cell reach, including overlap before a center crossing.
    /// The path already splits at center crossings; a leg starting outdoors is handled in full.
    fn outdoor_portal_overlap_intervals(
        &self,
        sweep: SphereSweep,
        membership: &SpatialMembership,
    ) -> Result<Vec<(f32, f32)>, CollisionQueryError> {
        let mut intervals = Vec::new();
        for cell in membership.reached_env_cells() {
            let owner = landblock_key(*cell);
            let asset = self
                .landblocks
                .get(&owner)
                .ok_or(CollisionQueryError::UnavailableOwner { owner: owner.0 })?;
            let volume = asset
                .static_geometry
                .cell_volume((cell.0 & 0xffff) as u16)
                .ok_or(CollisionQueryError::UnknownMotionCell { cell: cell.0 })?;
            let start = volume.placement.to_local_space(anchor_to_landblock(
                sweep.start,
                sweep.anchor,
                owner,
            ));
            let end = volume.placement.to_local_space(anchor_to_landblock(
                sweep.end,
                sweep.anchor,
                owner,
            ));
            for portal in &volume.portals {
                if portal.target != CellCollisionPortalTarget::Outdoor {
                    continue;
                }
                let start_distance = portal.plane.distance_to_point(&start);
                let delta = portal.plane.distance_to_point(&end) - start_distance;
                let reach = sweep.radius + CELL_PLANE_TOLERANCE;
                if delta == 0.0 {
                    if start_distance.abs() < reach {
                        intervals.push((0.0, 1.0));
                    }
                    continue;
                }
                let first = (-reach - start_distance) / delta;
                let last = (reach - start_distance) / delta;
                let low = first.min(last).max(0.0);
                let high = first.max(last).min(1.0);
                if low < high {
                    intervals.push((low, high));
                }
            }
        }
        intervals.sort_by(|a, b| a.0.total_cmp(&b.0));
        Ok(intervals)
    }

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
        let traced = self.trace_static_sphere(request)?;
        let fraction = traced.hit.map_or(1.0, |hit| hit.time_of_impact);
        let accepted = self.finish_sphere_path(request, fraction, policy)?;
        Ok(UncoveredCollisionQuery {
            value: traced.hit,
            unavailable_owner: accepted.unavailable_owner,
        })
    }

    fn trace_static_sphere(
        &self,
        request: StaticSphereSweepRequest,
    ) -> Result<StaticSphereTrace, CollisionQueryError> {
        let sweep = SphereSweep {
            anchor: request.anchor,
            start: request.start,
            end: request.end,
            radius: request.radius,
        };
        validate_sweep(sweep)?;
        let displacement = request.end - request.start;

        let swept_placement = self.sweep_candidate_membership(sweep, request.previous_cell)?;

        let touched = touched_landblocks(sweep);
        // Every representable nonzero move needs collision admission. Treating small
        // travel as stationary lets repeated contact corrections creep through hard walls.
        if displacement.length_squared() == 0.0 {
            return Ok(StaticSphereTrace {
                hit: None,
                membership: swept_placement,
            });
        }

        let moving_ball = Ball::new(request.radius);
        let narrow_phase = MovingSphereCast::new(&moving_ball, request.start, request.end);
        let mut earliest = None;

        if swept_placement.reaches_outdoors() {
            for owner in &touched {
                let Some(asset) = self.landblocks.get(owner) else {
                    continue;
                };
                let center = point_between_landblocks(
                    (request.start + request.end) * 0.5,
                    request.anchor.0,
                    owner.0,
                );
                let reach = request.radius + displacement.length() * 0.5;
                for cell in overlapped_terrain_cells(&asset.terrain, center, reach) {
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
            narrow_phase.update_collider_hit(
                collider,
                selected.reference.owner,
                request.anchor,
                &mut earliest,
            )?;
        }

        if swept_placement.reaches_outdoors()
            && !request
                .filter
                .excludes(PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER)
        {
            update_water_restriction_hit(self, sweep, &touched, &mut earliest);
        }

        Ok(StaticSphereTrace {
            hit: earliest,
            membership: swept_placement,
        })
    }
}

/// Immutable moving-shape facts shared by every static narrow-phase pairing.
struct MovingSphereCast {
    /// Narrow-phase radius defining the fixed permitted-overlap boundary. Published geometry
    /// and support keep the original radius; this band is never replenished per movement.
    ball: Ball,
    pose: Pose,
    velocity: ParryVector,
    displacement: Vector3,
}

fn sweep_polygon(
    moving: &MovingSphereCast,
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

/// Observes a placed entity shape along accepted travel, without topology or movement solving.
/// Initial overlap reports even while escaping; hard-response sweeps deliberately suppress it.
/// The shape and endpoints must already be expressed in the supplied common anchor frame.
pub(crate) fn sphere_path_touches_shape(
    shape: &PlacedCollisionShape,
    start: Vector3,
    end: Vector3,
    radius: f32,
    anchor: Guid,
) -> Result<bool, CollisionQueryError> {
    if shape.bounds.intersects_sphere(start, radius)
        && !crate::spatial::volume_query::placed_shape_contacts(shape, start, radius).is_empty()
    {
        return Ok(true);
    }
    if start == end {
        return Ok(false);
    }
    let ball = Ball::new(radius);
    let mut hit = None;
    if let CollisionShape::Cylinder(cylinder) = &*shape.shape {
        let scale = shape
            .scale
            .as_uniform()
            .expect("placed collision cylinders have validated uniform scale");
        let low = shape.point_to_landblock_space(cylinder.low_point);
        let top = low.z + cylinder.height * scale;
        if start.z >= low.z && start.z <= top && end.z >= low.z && end.z <= top {
            // Within the cylinder's height, the closest surface throughout the chord is
            // radial. Report the horizontal circle sweep without iterative cylinder GJK.
            // Preserve the movement query's initial tolerance and separating-path rule.
            if let Some(contact) = placed_volume_sweep_contact(shape, start, radius) {
                return Ok((end - start).dot(&contact.normal) < 0.0);
            }
            let horizontal_end = Vector3::new(end.x, end.y, start.z);
            MovingSphereCast::new(&ball, start, horizontal_end).update_shape_hit(
                &Ball::new(cylinder.radius * scale),
                Pose::from_translation(parry_vector(Vector3::new(low.x, low.y, start.z))),
                &mut hit,
            )?;
            return Ok(hit.is_some());
        }
    }
    let cast = MovingSphereCast::new(&ball, start, end);
    cast.update_collider_hit(shape, anchor, anchor, &mut hit)?;
    Ok(hit.is_some())
}

impl MovingSphereCast {
    fn new(ball: &Ball, start: Vector3, end: Vector3) -> Self {
        let displacement = end - start;
        Self {
            ball: Ball::new(hard_contact_radius(ball.radius)),
            pose: Pose::from_translation(parry_vector(start)),
            velocity: parry_vector(displacement),
            displacement,
        }
    }

    /// Shared narrow phase for resident world colliders and prepared hard entity shapes.
    fn update_collider_hit(
        &self,
        collider: &PlacedCollisionShape,
        owner: Guid,
        anchor: Guid,
        earliest: &mut Option<StaticSphereSweepHit>,
    ) -> Result<(), CollisionQueryError> {
        let start =
            point_between_landblocks(world_vector(self.pose.translation), anchor.0, owner.0);
        if let CollisionShape::Cylinder(cylinder) = &*collider.shape {
            let scale = collider
                .scale
                .as_uniform()
                .expect("placed collision cylinders have validated uniform scale");
            let low = collider.point_to_landblock_space(cylinder.low_point);
            let top = low.z + cylinder.height * scale;
            // A cap-interior entry has an exact plane time. Before that time the sphere
            // is wholly above/below the cylinder, so a rim or side cannot precede it.
            // Generic cylinder casts can miss short approaches at this flat boundary.
            for (height, normal_z) in [(top, 1.0), (low.z, -1.0)] {
                let approach = self.displacement.z * normal_z;
                let distance = (start.z - height) * normal_z;
                if approach < 0.0 && distance >= self.ball.radius {
                    let time = (self.ball.radius - distance) / approach;
                    if (0.0..=1.0).contains(&time) {
                        let point = start + self.displacement * time - low;
                        if point.x * point.x + point.y * point.y
                            <= (cylinder.radius * scale).powi(2)
                        {
                            update_earliest(
                                earliest,
                                StaticSphereSweepHit {
                                    time_of_impact: time,
                                    normal: Vector3::new(0.0, 0.0, normal_z),
                                },
                            );
                            return Ok(());
                        }
                    }
                }
            }
            // Prove cap-tangent paths clear before either initial-contact normals or
            // iterative future casts can introduce a spurious tilted rim response.
            if (self.displacement.z >= 0.0 && start.z >= top + self.ball.radius)
                || (self.displacement.z <= 0.0 && start.z <= low.z - self.ball.radius)
            {
                return Ok(());
            }
        }
        if let Some(contact) = placed_volume_sweep_contact(collider, start, self.ball.radius) {
            let inward = -self.displacement.dot(&contact.normal);
            // A projected tangent can round inward when its endpoint is stored in the
            // landblock frame. Bound the entire chord against the original supporting
            // plane, including existing depth: this numerical allowance cannot be
            // replenished by repeatedly moving inward. It is coordinate precision,
            // not another CONTACT_EPSILON band or a velocity-dependent angular slop.
            let roundoff = f32::EPSILON
                * ((start.x * contact.normal.x).abs()
                    + (start.y * contact.normal.y).abs()
                    + (start.z * contact.normal.z).abs()
                    + self.ball.radius);
            if inward > 0.0 && contact.depth + inward > roundoff {
                update_earliest(
                    earliest,
                    StaticSphereSweepHit {
                        time_of_impact: 0.0,
                        normal: contact.normal,
                    },
                );
            }
            // A straight tangent/separating path cannot re-enter this convex volume. Known
            // contact is resolved here instead of asking a zero-time cast to rediscover it.
            return Ok(());
        }
        match &*collider.shape {
            CollisionShape::Bsp(solid) => {
                let center = point_between_landblocks(
                    world_vector(self.pose.translation) + self.displacement * 0.5,
                    anchor.0,
                    owner.0,
                );
                let polygon_ids = crate::spatial::bsp_query::sphere_polygon_candidates(
                    solid,
                    collider,
                    center,
                    self.ball.radius + self.displacement.length() * 0.5,
                );
                for polygon_id in polygon_ids {
                    sweep_polygon(
                        self,
                        collider,
                        owner,
                        anchor,
                        &solid.polygons[&polygon_id],
                        earliest,
                    )?;
                }
            }
            CollisionShape::Ball(ball) => {
                let scale = collider
                    .scale
                    .as_uniform()
                    .expect("placed collision balls have validated uniform scale");
                let center = collider.point_to_landblock_space(ball.center);
                let center = point_between_landblocks(center, owner.0, anchor.0);
                let target = Ball::new(ball.radius * scale);
                self.update_shape_hit(
                    &target,
                    Pose::from_translation(parry_vector(center)),
                    earliest,
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
                    owner.0,
                    anchor.0,
                );
                let target = Cylinder::new(height * 0.5, cylinder.radius * scale);
                let target_pose = Pose::from_parts(
                    parry_vector(center),
                    parry3d::math::Rotation::from_rotation_x(std::f32::consts::FRAC_PI_2),
                );
                self.update_shape_hit(&target, target_pose, earliest)?;
            }
        }
        Ok(())
    }

    fn update_triangle_hit(
        &self,
        vertices: [Vector3; 3],
        normal: Vector3,
        earliest: &mut Option<StaticSphereSweepHit>,
    ) -> Result<(), CollisionQueryError> {
        // Time zero is already the earliest possible obstruction. Later triangles cannot
        // replace it (ties retain the first hit), so avoid another narrow-phase solve.
        if earliest.is_some_and(|hit| hit.time_of_impact == 0.0) {
            return Ok(());
        }
        let approach = self.displacement.dot(&normal);
        if approach >= 0.0 {
            return Ok(());
        }
        // Solve around the sphere origin so closest-feature normals do not inherit
        // cancellation error from large landblock coordinates.
        let start = world_vector(self.pose.translation);
        let distance = (start - vertices[0]).dot(&normal);
        // A triangle (including a slightly warped authored face's fan triangle) lies
        // inside its vertex projection interval. A sphere that cannot reach that interval
        // cannot hit a face, edge or vertex; avoid constructing/querying its narrow phase.
        let (minimum, maximum) =
            vertices[1..]
                .iter()
                .fold((0.0_f32, 0.0_f32), |(low, high), vertex| {
                    let projected = (*vertex - vertices[0]).dot(&normal);
                    (low.min(projected), high.max(projected))
                });
        // Use the same query radius as the cast. Adding the contact band back here admits
        // tangent floors to GJK, whose convergence tolerance can invent a zero-time impact.
        let reach = self.ball.radius;
        // Approach is negative: distance decreases monotonically throughout this sweep.
        if distance < minimum - reach || distance + approach > maximum + reach {
            return Ok(());
        }
        let triangle = Triangle::new(
            parry_vector(vertices[0] - start),
            parry_vector(vertices[1] - start),
            parry_vector(vertices[2] - start),
        );
        // A sphere approaching the finite face has an exact plane hit. Generic GJK casts
        // can converge late even on flat terrain; use them only when face containment
        // does not prove the hit (edges, vertices, or an initially penetrating sphere).
        let time = (self.ball.radius - distance) / approach;
        if (0.0..=1.0).contains(&time) {
            let point = parry_vector(self.displacement * time - normal * self.ball.radius);
            let closest = triangle.project_local_point(point, true).point;
            if (closest - point).length_squared()
                <= crate::spatial::bsp_query::CONTACT_EPSILON.powi(2)
            {
                update_earliest(
                    earliest,
                    StaticSphereSweepHit {
                        time_of_impact: time,
                        normal,
                    },
                );
                return Ok(());
            }
        }
        let Some(hit) = cast_shapes(
            &Pose::IDENTITY,
            self.velocity,
            &self.ball,
            &Pose::IDENTITY,
            ParryVector::ZERO,
            &triangle,
            cast_options(),
        )
        .map_err(|_| CollisionQueryError::UnsupportedSphereSweep)?
        else {
            return Ok(());
        };
        // RETAIL DIVERGENCE: BSP collision response selects the polygon plane normal
        // (acclient.c:346190-346215). Finite edge/vertex contacts use their closest-feature
        // direction here; restoring the plane normal reproduces the supported riser-edge
        // stall. Scope: synthetic wall, stair, corner and thin-obstacle fixtures; installed
        // collision meshes have not received a full edge-feature census.
        // Edge and vertex contacts have their own separating direction. The authored
        // face normal above still owns one-sided admission, but cannot replace that direction.
        let center = parry_vector(self.displacement * hit.time_of_impact);
        let closest = triangle.project_local_point(center, true).point;
        let separation = world_vector(center - closest);
        // At coincident center/face positions there is no radial direction; the admitted
        // one-sided face supplies the outward direction for this deep initial overlap.
        let face_distance = distance + approach * hit.time_of_impact;
        let face_point = center - parry_vector(normal * face_distance);
        let on_face = triangle.project_local_point(face_point, true).point;
        let normal = if (on_face - face_point).length_squared()
            <= crate::spatial::bsp_query::CONTACT_EPSILON.powi(2)
            || separation.length_squared() == 0.0
        {
            normal
        } else {
            separation.normalize()
        };
        if self.displacement.dot(&normal) < 0.0 {
            update_earliest(
                earliest,
                StaticSphereSweepHit {
                    time_of_impact: hit.time_of_impact,
                    normal,
                },
            );
        }
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
            &self.ball,
            &target_pose,
            ParryVector::ZERO,
            target,
            cast_options(),
        )
        .map_err(|_| CollisionQueryError::UnsupportedSphereSweep)?
        else {
            return Ok(());
        };
        // Parry normals are outward from each shape in its own local frame. Response needs
        // the target's outward normal; the moving ball's normal points into the obstacle.
        let normal = world_vector(target_pose.rotation * hit.normal2);
        if self.displacement.dot(&normal) < 0.0 {
            update_earliest(
                earliest,
                StaticSphereSweepHit {
                    time_of_impact: hit.time_of_impact,
                    normal,
                },
            );
        }
        Ok(())
    }
}

/// All hard sweeps admit the same absolute contact band. Cap it for sub-tolerance
/// query spheres so their continuous cast remains nondegenerate; ordinary body radii
/// use CONTACT_EPSILON. This changes query clearance, never the registered body size.
fn hard_contact_radius(radius: f32) -> f32 {
    radius - crate::spatial::bsp_query::CONTACT_EPSILON.min(radius * 0.5)
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

pub(super) fn placed_anchor_point(
    collider: &PlacedCollisionShape,
    point: Vector3,
    owner: Guid,
    anchor: Guid,
) -> Vector3 {
    point_between_landblocks(collider.point_to_landblock_space(point), owner.0, anchor.0)
}

pub(super) fn swept_query_cells(sweep: SphereSweep) -> GlobalCellRange {
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

pub(super) fn landblock_entry_hit(
    start: Vector3,
    displacement: Vector3,
) -> Option<StaticSphereSweepHit> {
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

pub(super) fn parry_vector(value: Vector3) -> ParryVector {
    ParryVector::new(value.x, value.y, value.z)
}

pub(super) fn world_vector(value: ParryVector) -> Vector3 {
    Vector3::new(value.x, value.y, value.z)
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Quaternion;
    use holtburger_content::{ColliderScale, CollisionBall, CollisionCylinder, LandblockPlacement};
    use std::sync::Arc;

    #[test]
    fn tolerated_floor_tangency_does_not_hide_a_crossed_wall() {
        let radius = 0.5;
        let ball = Ball::new(radius);
        let start = Vector3::new(0.0, 0.0, radius);
        let end = Vector3::new(
            2.0,
            0.0,
            radius - crate::spatial::bsp_query::CONTACT_EPSILON * 0.5,
        );
        let moving = MovingSphereCast::new(&ball, start, end);
        let mut hit = None;
        moving
            .update_triangle_hit(
                [
                    Vector3::new(-10.0, -10.0, 0.0),
                    Vector3::new(10.0, -10.0, 0.0),
                    Vector3::new(0.0, 10.0, 0.0),
                ],
                Vector3::new(0.0, 0.0, 1.0),
                &mut hit,
            )
            .unwrap();
        assert!(hit.is_none());
        let normal = Vector3::new(-1.0, 0.0, 0.0);
        moving
            .update_triangle_hit(
                [
                    Vector3::new(1.0, -10.0, -10.0),
                    Vector3::new(1.0, 0.0, 10.0),
                    Vector3::new(1.0, 10.0, -10.0),
                ],
                normal,
                &mut hit,
            )
            .unwrap();
        let hit = hit.expect("crossed wall must block even with both endpoints clear");
        assert_eq!(hit.normal, normal);
        assert!(
            (hit.time_of_impact * 2.0 - (1.0 - hard_contact_radius(radius))).abs() <= f32::EPSILON
        );
    }

    #[test]
    fn repeated_inward_casts_cannot_replenish_the_contact_band() {
        let radius = 0.5;
        let ball = Ball::new(radius);
        let normal = Vector3::new(0.0, 0.0, 1.0);
        let vertices = [
            Vector3::new(-10.0, -10.0, 0.0),
            Vector3::new(10.0, -10.0, 0.0),
            Vector3::new(0.0, 10.0, 0.0),
        ];
        let mut center = Vector3::new(0.0, 0.0, radius);
        let movement = Vector3::new(0.0, 0.0, -crate::spatial::bsp_query::CONTACT_EPSILON * 0.25);
        let limit = hard_contact_radius(radius);
        let mut contacts = 0;
        for _ in 0..1024 {
            let mut hit = None;
            MovingSphereCast::new(&ball, center, center + movement)
                .update_triangle_hit(vertices, normal, &mut hit)
                .unwrap();
            contacts += usize::from(hit.is_some());
            center = center + movement * hit.map_or(1.0, |hit| hit.time_of_impact);
            assert!(
                center.z >= limit - radius * f32::EPSILON,
                "small moves accumulated penetration: {}",
                center.z
            );
        }
        assert!(contacts > 1000);
    }

    #[test]
    fn hard_volumes_share_the_fixed_contact_band() {
        let radius = 0.5;
        let ball = Ball::new(radius);
        let anchor = Guid(0xda55_ffff);
        for (shape, top) in [
            (
                CollisionShape::Ball(CollisionBall {
                    center: Vector3::zero(),
                    radius,
                }),
                radius,
            ),
            (
                CollisionShape::Cylinder(CollisionCylinder {
                    low_point: Vector3::zero(),
                    radius,
                    height: 1.0,
                }),
                1.0,
            ),
        ] {
            let shape = PlacedCollisionShape::new(
                Arc::new(shape),
                LandblockPlacement {
                    origin: Vector3::zero(),
                    orientation: Quaternion::identity(),
                },
                ColliderScale::uniform(1.0).unwrap(),
            )
            .unwrap();
            let mut center = Vector3::new(0.0, 0.0, top + radius);
            let movement =
                Vector3::new(0.0, 0.0, -crate::spatial::bsp_query::CONTACT_EPSILON * 0.25);
            for _ in 0..1024 {
                let mut hit = None;
                MovingSphereCast::new(&ball, center, center + movement)
                    .update_collider_hit(&shape, anchor, anchor, &mut hit)
                    .unwrap();
                center = center + movement * hit.map_or(1.0, |hit| hit.time_of_impact);
                assert!(
                    center.z >= top + hard_contact_radius(radius) - (top + radius) * f32::EPSILON,
                    "volume penetration accumulated: {center:?}"
                );
            }
            let side_height = match &*shape.shape {
                CollisionShape::Ball(_) => 0.0,
                CollisionShape::Cylinder(cylinder) => cylinder.height * 0.5,
                CollisionShape::Bsp(_) => unreachable!("volume fixture"),
            };
            let mut side = Vector3::new(radius * 2.0, 0.0, side_height);
            let inward = Vector3::new(-crate::spatial::bsp_query::CONTACT_EPSILON * 0.25, 0.0, 0.0);
            for _ in 0..1024 {
                let mut hit = None;
                MovingSphereCast::new(&ball, side, side + inward)
                    .update_collider_hit(&shape, anchor, anchor, &mut hit)
                    .unwrap();
                side = side + inward * hit.map_or(1.0, |hit| hit.time_of_impact);
                assert!(
                    side.x >= radius + hard_contact_radius(radius) - radius * 2.0 * f32::EPSILON,
                    "radial penetration accumulated: {side:?}"
                );
            }
            let start = Vector3::new(0.0, 0.0, top + radius);
            let mut hit = None;
            MovingSphereCast::new(&ball, start, start + Vector3::new(1.0, 0.0, 0.0))
                .update_collider_hit(&shape, anchor, anchor, &mut hit)
                .unwrap();
            assert!(hit.is_none(), "nominal tangent was blocked: {hit:?}");
        }
    }

    #[test]
    fn triangle_cast_preserves_contacts_across_the_vertex_projection_interval() {
        // The authored polygon normal need not exactly match every fan triangle.
        // Near its raised vertices, a plane-only rejection would discard a real hit.
        let normal = Vector3::new(0.0, 0.0, 1.0);
        let vertices = [
            Vector3::new(-1.0, -1.0, 0.0),
            Vector3::new(1.0, -1.0, 0.1),
            Vector3::new(0.0, 1.0, 0.1),
        ];
        let ball = Ball::new(0.05);
        for (start_height, end_height, expected) in
            [(0.2, 0.08, true), (0.3, 0.2, false), (-0.1, -0.2, false)]
        {
            let start = Vector3::new(0.0, 0.5, start_height);
            let end = Vector3::new(0.0, 0.5, end_height);
            let mut hit = None;
            MovingSphereCast::new(&ball, start, end)
                .update_triangle_hit(vertices, normal, &mut hit)
                .unwrap();
            assert_eq!(
                hit.is_some(),
                expected,
                "sweep {start_height} to {end_height}"
            );
        }
    }

    #[test]
    fn rounded_inward_volume_steps_remain_at_original_boundary() {
        let radius = 0.48;
        let target_radius = 0.5;
        let origin = Vector3::new(80.0, 79.0, 0.005);
        let anchor = Guid(0xda55_ffff);
        for (shape, center_z) in [
            (
                CollisionShape::Ball(CollisionBall {
                    center: Vector3::zero(),
                    radius: target_radius,
                }),
                origin.z,
            ),
            (
                CollisionShape::Cylinder(CollisionCylinder {
                    low_point: Vector3::zero(),
                    radius: target_radius,
                    height: 2.0,
                }),
                origin.z + 1.0,
            ),
        ] {
            let shape = PlacedCollisionShape::new(
                Arc::new(shape),
                LandblockPlacement {
                    origin,
                    orientation: Quaternion::identity(),
                },
                ColliderScale::uniform(1.0).unwrap(),
            )
            .unwrap();
            let boundary = origin.x + target_radius + hard_contact_radius(radius);
            let mut center = Vector3::new(origin.x + target_radius + radius, origin.y, center_z);
            let mut blocked = 0;
            for _ in 0..1024 {
                // One representable coordinate increment is smaller than the numerical
                // admission allowance. Repetition must not refill that allowance.
                let end = Vector3::new(center.x.next_down(), center.y, center.z);
                let mut hit = None;
                MovingSphereCast::new(&Ball::new(radius), center, end)
                    .update_collider_hit(&shape, anchor, anchor, &mut hit)
                    .unwrap();
                blocked += usize::from(hit.is_some());
                center = center + (end - center) * hit.map_or(1.0, |hit| hit.time_of_impact);
                let coordinate_precision = f32::EPSILON * (boundary.abs() + radius);
                assert!(
                    center.x >= boundary - coordinate_precision,
                    "inward creep: {center:?}"
                );
            }
            assert!(blocked > 0, "repeated inward motion did not stop");
        }
    }

    #[test]
    fn cylinder_projected_slide_survives_endpoint_rounding() {
        let offset = 0.98 / 2.0_f32.sqrt();
        let shape = PlacedCollisionShape::new(
            Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                low_point: Vector3::zero(),
                radius: 0.5,
                height: 2.0,
            })),
            LandblockPlacement {
                origin: Vector3::new(80.0 + offset, 79.0 + offset, 0.005),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
        )
        .unwrap();
        let start = Vector3::new(80.05399, 78.95018, 0.485);
        let contact =
            placed_volume_sweep_contact(&shape, start, hard_contact_radius(0.48)).unwrap();
        let request = Vector3::new(0.06, 0.015, 0.0);
        let tangent = request - contact.normal * request.dot(&contact.normal);
        let end = start + tangent;
        let moving = MovingSphereCast::new(&Ball::new(0.48), start, end);
        // This is the stalled production corner: endpoint rounding turns the
        // projected tangent slightly inward, despite a clear route around the side.
        assert!(moving.displacement.dot(&contact.normal) < 0.0);
        let mut hit = None;
        moving
            .update_collider_hit(&shape, Guid(0xda55_ffff), Guid(0xda55_ffff), &mut hit)
            .unwrap();
        assert!(hit.is_none(), "projected slide was blocked: {hit:?}");
    }

    #[test]
    fn cylinder_reports_preserve_side_cap_and_initial_contact_rules() {
        let shape = PlacedCollisionShape::new(
            Arc::new(CollisionShape::Cylinder(CollisionCylinder {
                low_point: Vector3::zero(),
                radius: 0.5,
                height: 2.0,
            })),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
        )
        .unwrap();
        let ball = Ball::new(0.25);
        let anchor = Guid(0xda55_ffff);
        for (start, end, expected_time, expected_normal) in [
            (
                Vector3::new(-2.0, 0.0, 0.5),
                Vector3::new(2.0, 0.0, 1.5),
                (2.0 - 0.5 - hard_contact_radius(ball.radius)) / 4.0,
                Vector3::new(-1.0, 0.0, 0.0),
            ),
            (
                Vector3::new(0.0, 0.0, 3.0),
                Vector3::new(0.0, 0.0, 1.0),
                (3.0 - 2.0 - hard_contact_radius(ball.radius)) / 2.0,
                Vector3::new(0.0, 0.0, 1.0),
            ),
        ] {
            assert!(sphere_path_touches_shape(&shape, start, end, ball.radius, anchor).unwrap());
            let mut hit = None;
            MovingSphereCast::new(&ball, start, end)
                .update_collider_hit(&shape, anchor, anchor, &mut hit)
                .unwrap();
            let hit = hit.expect("the path crosses the cylinder surface");
            assert!((hit.time_of_impact - expected_time).abs() < 0.0001);
            assert!((hit.normal - expected_normal).length() < 0.0001);
        }
        let tolerance = crate::spatial::bsp_query::CONTACT_EPSILON;
        let touching = Vector3::new(0.5 + ball.radius, 0.0, 1.0);
        for (start, end, expected) in [
            (
                Vector3::new(0.5, 0.0, 1.0),
                Vector3::new(2.0, 0.0, 1.5),
                true,
            ),
            (
                touching,
                touching + Vector3::new(tolerance, 0.0, 0.0),
                false,
            ),
            (
                touching,
                touching - Vector3::new(tolerance * 2.0, 0.0, 0.0),
                true,
            ),
            (
                Vector3::new(-2.0, 1.0, 0.5),
                Vector3::new(2.0, 1.0, 1.5),
                false,
            ),
        ] {
            assert_eq!(
                sphere_path_touches_shape(&shape, start, end, ball.radius, anchor).unwrap(),
                expected,
            );
        }
    }
}
