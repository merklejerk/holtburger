//! Read-only camera collision over one coherent environment/entity publication.

use super::{
    CollisionQueryPolicy, CollisionScene, EntityCollisionSnapshot, SpatialBodyId,
    SpatialMembership, StaticContact, StaticSphereSweepHit, StaticSphereSweepRequest,
    UncoveredCollisionQuery,
};
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};

/// Collision operations required by unregistered sphere motion and camera clearance.
/// Environment-only callers and cameras share the solver while supplying explicit obstacles.
pub trait SphereCollisionQuery {
    /// Immutable topology and authored world surfaces for this query.
    fn environment(&self) -> &CollisionScene;
    /// Entity penetration contacts admitted for the supplied placement.
    fn entity_contacts(
        &self,
        anchor: Guid,
        center: Vector3,
        radius: f32,
        placement: &SpatialMembership,
    ) -> Result<Vec<StaticContact>>;
    /// Earliest obstruction under the caller's explicit coverage policy.
    fn sweep_sphere(
        &self,
        request: StaticSphereSweepRequest,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<Option<StaticSphereSweepHit>>>;
}

impl SphereCollisionQuery for CollisionScene {
    fn environment(&self) -> &CollisionScene {
        self
    }
    fn entity_contacts(
        &self,
        _: Guid,
        _: Vector3,
        _: f32,
        _: &SpatialMembership,
    ) -> Result<Vec<StaticContact>> {
        Ok(Vec::new())
    }
    fn sweep_sphere(
        &self,
        request: StaticSphereSweepRequest,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<Option<StaticSphereSweepHit>>> {
        Ok(self.sweep_static_sphere_with_policy(request, policy)?)
    }
}

/// Borrowed camera query: geometry is shared; target exclusion belongs to this camera instance.
pub struct CameraCollisionQuery<'a> {
    /// Immutable world collision paired with the entity capture.
    pub environment: &'a CollisionScene,
    /// Collision-only entity publication, including current authored part poses.
    pub entities: &'a EntityCollisionSnapshot,
    /// Followed body never obstructs its own camera.
    pub target: SpatialBodyId,
}

impl SphereCollisionQuery for CameraCollisionQuery<'_> {
    fn environment(&self) -> &CollisionScene {
        self.environment
    }
    fn entity_contacts(
        &self,
        anchor: Guid,
        center: Vector3,
        radius: f32,
        placement: &SpatialMembership,
    ) -> Result<Vec<StaticContact>> {
        let extent = Vector3::new(radius, radius, radius);
        let mut contacts = Vec::new();
        for id in self.entities.index.candidates(
            Some(self.target),
            anchor,
            center - extent,
            center + extent,
            placement,
        ) {
            let target = &self.entities.targets[&id];
            if !target.camera_solid {
                continue;
            }
            let local = WorldPosition {
                landblock_id: anchor,
                coords: center,
                rotation: holtburger_common::Quaternion::identity(),
            }
            .reanchor_to_landblock_owner(target.anchor)?
            .coords;
            for shape in target
                .shapes
                .iter()
                .filter(|shape| shape.bounds.intersects_sphere(local, radius))
            {
                contacts.extend(
                    super::volume_query::placed_shape_contacts(shape, local, radius)
                        .into_iter()
                        .map(|contact| StaticContact {
                            normal: contact.normal,
                            depth: contact.depth,
                        }),
                );
            }
        }
        Ok(contacts)
    }
    fn sweep_sphere(
        &self,
        request: StaticSphereSweepRequest,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<Option<StaticSphereSweepHit>>> {
        self.environment
            .sweep_camera_sphere(self.entities, self.target, request, policy)
    }
}
