//! Nearest finite surface rays across installed environment and sealed entity targets.

use anyhow::{Context, Result};
use holtburger_common::Vector3;
use parry3d::query::Ray;

use super::static_sphere_sweep::parry_vector;
use super::static_surface_ray::{SurfaceCandidate, cast_placed_collision_shape};
use super::{
    CollisionQueryPolicy, CollisionScene, SpatialMembership, StaticSurfaceRayHit,
    StaticSurfaceRayRequest,
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

/// Provenance selected by a single domain-scoped narrow phase.
enum RayCandidate {
    Environment(SurfaceCandidate),
    Entity(EntityCandidate),
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
        let trace = self.traverse_surface_ray(
            request,
            CollisionQueryPolicy::RequireCollisionCoverage,
            |interval, placement| {
                let environment = self.cast_static_ray_in_domain(interval, placement);
                let entity_request = StaticSurfaceRayRequest {
                    maximum_distance: environment
                        .as_ref()
                        .map_or(interval.maximum_distance, |hit| hit.distance),
                    ..interval
                };
                let entity = self.cast_entity_ray_in_domain(
                    entities,
                    entity_request,
                    placement,
                    &targetable,
                )?;
                Ok::<_, anyhow::Error>(match (environment, entity) {
                    (Some(environment), Some(entity)) if entity.distance < environment.distance => {
                        Some((entity.distance, RayCandidate::Entity(entity)))
                    }
                    (Some(environment), _) => {
                        Some((environment.distance, RayCandidate::Environment(environment)))
                    }
                    (None, Some(entity)) => Some((entity.distance, RayCandidate::Entity(entity))),
                    (None, None) => None,
                })
            },
        )?;
        Ok(trace.value.hit.map(|hit| match hit.candidate {
            RayCandidate::Environment(candidate) => {
                CollisionSurfaceRayHit::Environment(StaticSurfaceRayHit {
                    point: hit.point,
                    distance: hit.distance,
                    normal: candidate.normal,
                    placement: hit.placement,
                    proof: self
                        .owner_proof(candidate.owner)
                        .expect("installed candidate retains its owner proof"),
                })
            }
            RayCandidate::Entity(candidate) => {
                CollisionSurfaceRayHit::Entity(EntitySurfaceRayHit {
                    point: hit.point,
                    distance: hit.distance,
                    normal: candidate.normal,
                    placement: hit.placement,
                    proof: candidate.proof,
                })
            }
        }))
    }

    /// Entity candidates share the environment ray's exact current domain and distance limit.
    fn cast_entity_ray_in_domain(
        &self,
        entities: &EntityCollisionSnapshot,
        request: StaticSurfaceRayRequest,
        placement: &SpatialMembership,
        targetable: &impl Fn(SpatialBodyId) -> bool,
    ) -> Result<Option<EntityCandidate>> {
        let end = request.start + request.direction * request.maximum_distance;
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
        for body_id in entities
            .index
            .candidates(None, request.anchor, minimum, maximum, placement)
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
            for shape in placed_target_shapes(
                body.physical
                    .as_ref()
                    .and_then(|physical| physical.dynamic.as_ref())
                    .context("prepared target lost dynamic physics")?,
                body.pose,
                request.anchor,
            )? {
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

        Ok(earliest)
    }
}
