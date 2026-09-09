//! Tick-local spatial selection over prepared hard geometry, independent of portal membership.

use anyhow::{Result, ensure};
use holtburger_common::Vector3;
use parry3d::bounding_volume::Aabb;
use parry3d::math::Vector;
use parry3d::partitioning::{Bvh, BvhBuildStrategy};
use std::collections::BTreeMap;

use super::SweepTarget;
use crate::spatial::SpatialBodyId;
use crate::spatial::bsp_query::CONTACT_EPSILON;

/// Owns target geometry and its index together so accepted pose changes update both.
/// Leaf IDs are stable vector slots; query results restore body identity order for hit ties.
pub(super) struct HardTargets {
    /// Prepared geometry; existing slots never move when projectile targets are appended.
    bodies: Vec<SweepTarget>,
    /// Identity lookup for accepted hard-target replacement, independent of append order.
    slots: BTreeMap<SpatialBodyId, usize>,
    /// Spatial bounds only. Exact queries retain collision-domain and response filtering.
    index: Bvh,
}

impl HardTargets {
    pub(super) fn new(bodies: Vec<SweepTarget>) -> Result<Self> {
        ensure!(
            bodies.len() < u32::MAX as usize,
            "too many hard targets for spatial index"
        );
        let index = Bvh::from_iter(
            BvhBuildStrategy::Binned,
            bodies
                .iter()
                .enumerate()
                .filter_map(|(slot, body)| bounds(body).map(|bounds| (slot, bounds))),
        );
        let slots = bodies
            .iter()
            .enumerate()
            .map(|(slot, body)| (body.contact.body_id, slot))
            .collect();
        Ok(Self {
            bodies,
            slots,
            index,
        })
    }

    /// Publishes accepted nonyielding movement without rebuilding unrelated target bounds.
    pub(super) fn replace(&mut self, target: SweepTarget) -> Result<()> {
        let slot = *self
            .slots
            .get(&target.contact.body_id)
            .ok_or_else(|| anyhow::anyhow!("prepared nonyielding body lost its hard target"))?;
        self.update_bounds(slot, &target);
        self.bodies[slot] = target;
        Ok(())
    }

    /// Adds accepted mobile endpoints for projectile queries without reordering existing slots.
    pub(super) fn push(&mut self, target: SweepTarget) -> Result<()> {
        ensure!(
            self.bodies.len() < u32::MAX as usize,
            "too many hard targets for spatial index"
        );
        self.update_bounds(self.bodies.len(), &target);
        self.slots.insert(target.contact.body_id, self.bodies.len());
        self.bodies.push(target);
        Ok(())
    }

    fn update_bounds(&mut self, slot: usize, target: &SweepTarget) {
        if let Some(bounds) = bounds(target) {
            self.index
                .reinsert_or_update_with_change_detection(bounds, slot as u32, 0.0);
        }
        // An empty replacement can retain a conservative old leaf: it has no exact shapes
        // to hit. This avoids adding a separate removal lifecycle for tick-local geometry.
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = &SweepTarget> {
        self.bodies.iter()
    }

    pub(super) fn sphere_candidates(
        &self,
        center: Vector3,
        radius: f32,
    ) -> impl Iterator<Item = &SweepTarget> {
        let center = vector(center);
        let extent = Vector::splat(radius);
        self.candidates(Aabb::new(center - extent, center + extent))
    }

    pub(super) fn support_candidates(
        &self,
        center: Vector3,
        radius: f32,
    ) -> impl Iterator<Item = &SweepTarget> {
        let reach = radius + CONTACT_EPSILON;
        // Match the existing support primitive's XY column rejection. Height admission
        // remains shape-owned, including BSP slopes and expanded volume cap corners.
        self.candidates(Aabb::new(
            Vector::new(center.x - reach, center.y - reach, -f32::MAX),
            Vector::new(center.x + reach, center.y + reach, f32::MAX),
        ))
    }

    fn candidates(&self, query: Aabb) -> impl Iterator<Item = &SweepTarget> {
        let mut slots = self.index.intersect_aabb(&query).collect::<Vec<_>>();
        slots.sort_unstable_by_key(|slot| self.bodies[*slot as usize].contact.body_id);
        slots.into_iter().map(|slot| &self.bodies[slot as usize])
    }
}

fn vector(value: Vector3) -> Vector {
    Vector::new(value.x, value.y, value.z)
}

/// One leaf bounds every authored shape of its body; empty targets need no leaf.
fn bounds(target: &SweepTarget) -> Option<Aabb> {
    let mut shapes = target.shapes.iter();
    let first = shapes.next()?;
    let mut minimum = vector(first.bounds.minimum());
    let mut maximum = vector(first.bounds.maximum());
    for shape in shapes {
        minimum = minimum.min(vector(shape.bounds.minimum()));
        maximum = maximum.max(vector(shape.bounds.maximum()));
    }
    Some(Aabb::new(minimum, maximum))
}

#[cfg(test)]
mod tests {
    use super::super::ContactParticipant;
    use super::*;
    use crate::spatial::{PhysicalCollisionFilter, SpatialMembership};
    use crate::{EntityCollisionParticipation, EntityDynamicCollisionPolicy, LocalTargetDemand};
    use holtburger_common::{Guid, Quaternion};
    use holtburger_content::{
        ColliderScale, CollisionBall, CollisionShape, LandblockPlacement, PlacedCollisionShape,
    };
    use std::sync::Arc;

    fn target(id: u32, center: Vector3) -> SweepTarget {
        SweepTarget {
            contact: ContactParticipant {
                body_id: SpatialBodyId::Entity(Guid(id)),
                target_demand: LocalTargetDemand::Retained,
                policy: EntityDynamicCollisionPolicy {
                    target: EntityCollisionParticipation::Solid,
                    mover_accepts_response: true,
                    accepts_peer_reports: true,
                    missile: false,
                    path_clipped: false,
                },
                // Different domains must not remove spatial candidates before a sweep
                // has discovered the complete portal route.
                membership: SpatialMembership::interior(Guid(0xda55_0100 + id)),
                filter: PhysicalCollisionFilter::ALL,
            },
            shapes: vec![
                PlacedCollisionShape::new(
                    Arc::new(CollisionShape::Ball(CollisionBall {
                        center: Vector3::zero(),
                        radius: 0.5,
                    })),
                    LandblockPlacement {
                        origin: center,
                        orientation: Quaternion::identity(),
                    },
                    ColliderScale::uniform(1.0).unwrap(),
                )
                .unwrap(),
            ],
        }
    }

    #[test]
    fn indexed_selection_preserves_exhaustive_candidates_after_motion_and_append() {
        let mut targets = HardTargets::new(
            (1..=64)
                .map(|id| {
                    target(
                        id,
                        Vector3::new((id % 8) as f32 * 12.0, (id / 8) as f32 * 12.0, id as f32),
                    )
                })
                .collect(),
        )
        .unwrap();
        targets
            .replace(target(12, Vector3::new(-24.0, 0.0, 0.0)))
            .unwrap();
        targets.push(target(0, Vector3::zero())).unwrap();
        // Replacement must remain valid after an out-of-order projectile append.
        targets.replace(target(12, Vector3::zero())).unwrap();
        for center in [
            Vector3::zero(),
            Vector3::new(24.0, 24.0, 20.0),
            Vector3::new(96.0, 96.0, 40.0),
        ] {
            for radius in [0.5, 12.0, 100.0] {
                let mut exhaustive = targets
                    .iter()
                    .filter(|target| {
                        target
                            .shapes
                            .iter()
                            .any(|shape| shape.bounds.intersects_sphere(center, radius))
                    })
                    .map(|target| target.contact.body_id)
                    .collect::<Vec<_>>();
                exhaustive.sort_unstable();
                let indexed = targets
                    .sphere_candidates(center, radius)
                    .filter(|target| {
                        target
                            .shapes
                            .iter()
                            .any(|shape| shape.bounds.intersects_sphere(center, radius))
                    })
                    .map(|target| target.contact.body_id)
                    .collect::<Vec<_>>();
                assert_eq!(indexed, exhaustive);

                let exact_supports = |target: &SweepTarget| {
                    target.shapes.iter().any(|shape| {
                        !crate::spatial::volume_query::placed_shape_supports(
                            shape, center, radius, 100.0, 100.0,
                        )
                        .is_empty()
                    })
                };
                let mut exhaustive = targets
                    .iter()
                    .filter(|target| exact_supports(target))
                    .map(|target| target.contact.body_id)
                    .collect::<Vec<_>>();
                exhaustive.sort_unstable();
                let indexed = targets
                    .support_candidates(center, radius)
                    .filter(|target| exact_supports(target))
                    .map(|target| target.contact.body_id)
                    .collect::<Vec<_>>();
                assert_eq!(indexed, exhaustive);
            }
        }
        assert!(targets.sphere_candidates(Vector3::zero(), 0.5).count() < targets.bodies.len());
    }
}
