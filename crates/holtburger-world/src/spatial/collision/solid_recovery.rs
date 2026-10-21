//! Stationary BSP recovery candidates and paths through their originating solids.

use holtburger_common::Vector3;
use holtburger_content::CollisionShape;

use crate::spatial::bsp_query::{
    SOLID_RECOVERY_CANDIDATE_LIMIT, SolidRegionRecovery, placed_solid_recovery_candidates,
};

use super::{
    ColliderReference, CollisionQueryError, CollisionQueryPolicy, CollisionScene, GlobalCellRange,
    PlacementRequest, StaticSphereSweepHit, StaticSphereSweepRequest, UncoveredCollisionQuery,
    anchor_to_landblock, point_between_landblocks,
};

/// Occupancy must remain explicit when the bounded search supplies no candidate.
pub(in crate::spatial) enum SolidPlacementRecovery {
    /// Ordinary surface settlement owns any remaining overlaps.
    Outside,
    /// Endpoints proposed by initially occupied BSP geometry.
    Occupied(SolidPlacementCandidates),
    /// Too many partition planes or scene candidates to classify safely in this search.
    LimitExceeded,
}

/// Proposed endpoints paired with exactly the starting solids a recovery path may leave.
pub(in crate::spatial) struct SolidPlacementCandidates {
    /// Owner-frame endpoints sorted from shortest to longest correction.
    pub(in crate::spatial) centers: Vec<Vector3>,
    /// Only these initially occupied statics may be crossed during correction.
    containing_colliders: Vec<ColliderReference>,
}

impl CollisionScene {
    /// Reuses scene admission and retail's interior building-shell center-solid exclusion.
    pub(in crate::spatial) fn solid_recovery_candidates(
        &self,
        request: PlacementRequest<'_>,
        epsilon: f32,
    ) -> SolidPlacementRecovery {
        let cells = GlobalCellRange::from_sphere(request.anchor, request.center, request.radius);
        let mut centers = Vec::new();
        let mut containing_colliders = Vec::new();
        for selected in self.selected_colliders(cells, request.placement) {
            if !selected.center_solid {
                continue;
            }
            let reference = selected.reference;
            let collider = selected.collider;
            let center = anchor_to_landblock(request.center, request.anchor, reference.owner);
            if !collider.bounds.intersects_sphere(center, request.radius) {
                continue;
            }
            let CollisionShape::Bsp(solid) = &*collider.shape else {
                continue;
            };
            match placed_solid_recovery_candidates(collider, solid, center, request.radius, epsilon)
            {
                SolidRegionRecovery::Outside => {}
                SolidRegionRecovery::LimitExceeded => return SolidPlacementRecovery::LimitExceeded,
                SolidRegionRecovery::Occupied(candidates) => {
                    // Bounding this list too prevents many empty-root solids from evading the cap.
                    if containing_colliders.len() == SOLID_RECOVERY_CANDIDATE_LIMIT
                        || centers.len() + candidates.len() > SOLID_RECOVERY_CANDIDATE_LIMIT
                    {
                        return SolidPlacementRecovery::LimitExceeded;
                    }
                    containing_colliders.push(reference);
                    centers.extend(candidates.into_iter().map(|point| {
                        point_between_landblocks(point, reference.owner.0, request.anchor.0)
                    }));
                }
            }
        }
        if containing_colliders.is_empty() {
            return SolidPlacementRecovery::Outside;
        }
        centers.sort_by(|left, right| {
            (*left - request.center)
                .length_squared()
                .total_cmp(&(*right - request.center).length_squared())
        });
        SolidPlacementRecovery::Occupied(SolidPlacementCandidates {
            centers,
            containing_colliders,
        })
    }

    /// Exempts only the starting solid objects, while retaining terrain and movement restrictions.
    /// Endpoint placement queries still test those objects at the destination.
    pub(in crate::spatial) fn sweep_solid_recovery(
        &self,
        request: StaticSphereSweepRequest,
        candidates: &SolidPlacementCandidates,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<Option<StaticSphereSweepHit>>, CollisionQueryError> {
        let traced =
            self.trace_static_sphere_excluding(request, &candidates.containing_colliders)?;
        // Coverage is required over the whole proposed path, even when a blocker rejects it.
        let coverage = self.finish_sphere_path(request, 1.0, policy)?;
        Ok(UncoveredCollisionQuery {
            value: traced.hit,
            unavailable_owner: coverage.unavailable_owner,
        })
    }
}
