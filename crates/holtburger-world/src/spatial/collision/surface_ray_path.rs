//! Ordered query-domain traversal for finite rays, without body endpoint recovery.

use holtburger_common::Vector3;

use super::static_surface_ray::{ray_sweep, validate_ray};
use super::{
    CELL_PLANE_TOLERANCE, CollisionQueryError, CollisionQueryPolicy, CollisionScene,
    PlacementMotionSegment, SpatialMembership, StaticSurfaceRayRequest, UncoveredCollisionQuery,
    touched_landblocks,
};

/// A nearest candidate placed back into the original ray frame.
pub(super) struct TraversedRayHit<T> {
    /// Narrow-phase provenance and surface facts.
    pub candidate: T,
    /// Original-anchor hit point.
    pub point: Vector3,
    /// Distance from the original ray origin.
    pub distance: f32,
    /// Domain in which this surface was admitted.
    pub placement: SpatialMembership,
}

/// The accepted ray prefix shared by targeting and selection.
pub(super) struct TraversedRay<T> {
    /// First admissible surface, if any.
    pub hit: Option<TraversedRayHit<T>>,
    /// Domains actually traversed before the hit or finite endpoint.
    pub reached: SpatialMembership,
}

impl CollisionScene {
    /// Queries the current domain first, then looks for portals only before its nearest hit.
    /// This prevents both speculative endpoint recovery and missing data beyond a wall
    /// from changing the accepted prefix. Each new domain casts from its own entry point,
    /// so an ineligible earlier intersection cannot hide a later eligible surface.
    pub(super) fn traverse_surface_ray<T, E: From<CollisionQueryError>>(
        &self,
        request: StaticSurfaceRayRequest,
        policy: CollisionQueryPolicy,
        mut cast: impl FnMut(StaticSurfaceRayRequest, &SpatialMembership) -> Result<Option<(f32, T)>, E>,
    ) -> Result<UncoveredCollisionQuery<TraversedRay<T>>, E> {
        validate_ray(request)?;
        let (initial, _) = self.infer_placement_from_cell(
            request.anchor,
            request.start,
            0.0,
            request.previous_cell,
            true,
        )?;
        let mut current_cell = initial.committed_cell();
        let mut reached = initial;
        let mut distance = 0.0;
        let mut unavailable_owner = None;
        for _ in 0..=self.motion_transition_limit {
            let placement =
                current_cell.map_or_else(SpatialMembership::outdoor, SpatialMembership::interior);
            let segment_request = StaticSurfaceRayRequest {
                start: request.start + request.direction * distance,
                maximum_distance: request.maximum_distance - distance,
                previous_cell: current_cell,
                ..request
            };
            let candidate = cast(segment_request, &placement)?;
            let limit = candidate
                .as_ref()
                .map_or(segment_request.maximum_distance, |(distance, _)| *distance);
            let end = segment_request.start + request.direction * limit;
            let touched = touched_landblocks(ray_sweep(segment_request, end));
            // Unlike a motion cursor that already consumed its starting boundary,
            // each query interval must admit a directed crossing at its origin. Back
            // the search cursor up by the existing portal tolerance; direction and
            // target containment still determine whether that boundary is traversable.
            let start_cursor = if limit > f32::EPSILON {
                -2.0 * CELL_PLANE_TOLERANCE / limit
            } else {
                0.0
            };
            let transition = self.next_placement_transition(
                PlacementMotionSegment {
                    anchor: request.anchor,
                    start: segment_request.start,
                    end,
                    radius: 0.0,
                    touched: &touched,
                },
                start_cursor,
                current_cell,
            )?;
            // A coincident surface wins the boundary tie in its source domain.
            let transition = transition.filter(|transition| transition.fraction < 1.0);
            let accepted_distance = transition
                .as_ref()
                .map_or(limit, |transition| limit * transition.fraction);
            let accepted_end = segment_request.start + request.direction * accepted_distance;
            let touched = touched_landblocks(ray_sweep(segment_request, accepted_end));
            let coverage = self.complete_query(policy, &touched, &placement, ())?;
            unavailable_owner = unavailable_owner.or(coverage.unavailable_owner);
            reached = reached.merge_reached(placement.clone());
            if let Some(transition) = transition {
                distance += accepted_distance;
                current_cell = transition.target_cell;
                continue;
            }
            return Ok(UncoveredCollisionQuery {
                value: TraversedRay {
                    hit: candidate.map(|(_, candidate)| TraversedRayHit {
                        candidate,
                        point: accepted_end,
                        distance: distance + accepted_distance,
                        placement,
                    }),
                    reached,
                },
                unavailable_owner,
            });
        }
        Err(CollisionQueryError::MotionTransitionLimitExceeded.into())
    }
}
