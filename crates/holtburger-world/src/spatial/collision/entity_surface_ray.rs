//! Nearest finite surface rays across installed environment and sealed entity targets.

use anyhow::{Context, Result};
use holtburger_common::Vector3;
use parry3d::query::Ray;

use super::static_sphere_sweep::parry_vector;
use super::static_surface_ray::{cast_placed_collision_shape, ray_sweep, validate_ray};
use super::{
    CollisionQueryPolicy, CollisionScene, SpatialMembership, StaticSurfaceRayHit,
    StaticSurfaceRayRequest, touched_landblocks,
};
use crate::spatial::SpatialBodyId;
use crate::spatial::dynamic_index::{
    EntityCollisionProof, EntityCollisionSnapshot, placed_target_shapes,
};

/// Earliest selectable entity surface reached by a finite collision-backed ray.
#[derive(Debug, Clone, PartialEq)]
pub struct EntitySurfaceRayHit {
    /// Hit point in the request's normalized outdoor anchor frame.
    pub point: Vector3,
    /// Distance from the ray origin in metres.
    pub distance: f32,
    /// Outward-facing unit normal of the selected entity surface.
    pub normal: Vector3,
    /// Exact spatial domains reached at the entity contact point.
    pub placement: SpatialMembership,
    /// Collision-relevant entity identity used for preview freshness and commit revalidation.
    pub proof: EntityCollisionProof,
}

/// One nearest surface selected without leaking its authority source into presentation.
#[derive(Debug, Clone, PartialEq)]
pub enum CollisionSurfaceRayHit {
    /// Installed terrain or authored static landblock geometry.
    Environment(StaticSurfaceRayHit),
    /// One selectable solid body from the sealed entity target snapshot.
    Entity(EntitySurfaceRayHit),
}

impl CollisionSurfaceRayHit {
    pub const fn point(&self) -> Vector3 {
        match self {
            Self::Environment(hit) => hit.point,
            Self::Entity(hit) => hit.point,
        }
    }

    pub const fn distance(&self) -> f32 {
        match self {
            Self::Environment(hit) => hit.distance,
            Self::Entity(hit) => hit.distance,
        }
    }

    pub const fn normal(&self) -> Vector3 {
        match self {
            Self::Environment(hit) => hit.normal,
            Self::Entity(hit) => hit.normal,
        }
    }

    pub fn placement(&self) -> &SpatialMembership {
        match self {
            Self::Environment(hit) => &hit.placement,
            Self::Entity(hit) => &hit.placement,
        }
    }
}

#[derive(Debug)]
struct EntityCandidate {
    body_id: SpatialBodyId,
    distance: f32,
    normal: Vector3,
    proof: EntityCollisionProof,
}

impl CollisionScene {
    /// Returns the nearest installed environment or selectable entity surface.
    ///
    /// Environment wins an exact-distance tie so coincident authored geometry retains its existing
    /// stable target identity.
    pub fn cast_surface_ray(
        &self,
        entities: &EntityCollisionSnapshot,
        request: StaticSurfaceRayRequest,
        targetable: impl Fn(SpatialBodyId) -> bool,
    ) -> Result<Option<CollisionSurfaceRayHit>> {
        let environment = self.cast_static_surface_ray(request)?;
        let mut entity_request = request;
        if let Some(hit) = &environment {
            entity_request.maximum_distance = hit.distance;
        }
        let entity = self.cast_entity_surface_ray(entities, entity_request, targetable)?;
        Ok(match (environment, entity) {
            (Some(environment), Some(entity)) if entity.distance < environment.distance => {
                Some(CollisionSurfaceRayHit::Entity(entity))
            }
            (Some(environment), _) => Some(CollisionSurfaceRayHit::Environment(environment)),
            (None, Some(entity)) => Some(CollisionSurfaceRayHit::Entity(entity)),
            (None, None) => None,
        })
    }

    fn cast_entity_surface_ray(
        &self,
        entities: &EntityCollisionSnapshot,
        request: StaticSurfaceRayRequest,
        targetable: impl Fn(SpatialBodyId) -> bool,
    ) -> Result<Option<EntitySurfaceRayHit>> {
        validate_ray(request)?;
        let end = request.start + request.direction * request.maximum_distance;
        let full_path = self.transit_surface_ray_path(request, end)?;
        let mut swept_placement = full_path.initial().placement().clone();
        for leg in full_path.legs() {
            swept_placement = swept_placement.merge_reached(leg.end().placement().clone());
        }
        let minimum = Vector3::new(
            request.start.x.min(end.x),
            request.start.y.min(end.y),
            request.start.z.min(end.z),
        );
        let maximum = Vector3::new(
            request.start.x.max(end.x),
            request.start.y.max(end.y),
            request.start.z.max(end.z),
        );
        let ray = Ray::new(parry_vector(request.start), parry_vector(request.direction));
        let mut earliest = None::<EntityCandidate>;
        for body_id in
            entities
                .index
                .candidates(None, request.anchor, minimum, maximum, &swept_placement)
        {
            if !targetable(body_id) {
                continue;
            }
            // Active, suspended, ethereal, and missile bodies remain broad-phase obstructions but
            // cannot become a frozen landing target merely because semantic policy selected them.
            let Some(proof) = entities.proof(body_id) else {
                continue;
            };
            let body = entities
                .body(body_id)
                .context("dynamic target index returned a missing entity")?;
            for shape in placed_target_shapes(body, body.pose, request.anchor)? {
                let Some(hit) = cast_placed_collision_shape(
                    &ray,
                    request.maximum_distance,
                    &shape,
                    request.anchor,
                    request.anchor,
                ) else {
                    continue;
                };
                let candidate = EntityCandidate {
                    body_id,
                    distance: hit.distance,
                    normal: hit.normal,
                    proof: proof.clone(),
                };
                if earliest.as_ref().is_none_or(|current| {
                    candidate.distance < current.distance
                        || (candidate.distance == current.distance
                            && candidate.body_id < current.body_id)
                }) {
                    earliest = Some(candidate);
                }
            }
        }

        let clipped_end = earliest.as_ref().map_or(end, |candidate| {
            request.start + request.direction * candidate.distance
        });
        let clipped_path = self.transit_surface_ray_path(request, clipped_end)?;
        let mut clipped_placement = clipped_path.initial().placement().clone();
        for leg in clipped_path.legs() {
            clipped_placement = clipped_placement.merge_reached(leg.end().placement().clone());
        }
        let sweep = ray_sweep(request, clipped_end);
        self.complete_query(
            CollisionQueryPolicy::RequireCollisionCoverage,
            &touched_landblocks(sweep),
            &clipped_placement,
            (),
        )?;
        Ok(earliest.map(|candidate| EntitySurfaceRayHit {
            point: clipped_end,
            distance: candidate.distance,
            normal: candidate.normal,
            placement: clipped_path.final_point().placement().clone(),
            proof: candidate.proof,
        }))
    }
}
