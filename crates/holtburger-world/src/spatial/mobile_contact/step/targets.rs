//! Tick-local spatial selection over prepared hard geometry, independent of portal membership.

use anyhow::{Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use parry3d::bounding_volume::Aabb;
use parry3d::math::Vector;
use parry3d::partitioning::{Bvh, BvhBuildStrategy};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use super::SweepTarget;
use crate::spatial::bsp_query::CONTACT_EPSILON;
use crate::spatial::dynamic_index::{EntityCollisionTarget, reanchor_placed_shapes};
use crate::spatial::{CollisionQueryError, SpatialBodyId};

/// Owns target geometry and its index together so accepted pose changes update both.
/// Leaf IDs are stable vector slots; query results restore body identity order for hit ties.
#[derive(Debug, Clone)]
pub(super) struct HardTargets {
    /// Prepared geometry; existing slots never move when projectile targets are appended.
    bodies: Vec<HardTarget>,
    /// Identity lookup for accepted hard-target replacement, independent of append order.
    slots: BTreeMap<SpatialBodyId, usize>,
    /// Spatial bounds only. Exact queries retain collision-domain and response filtering.
    index: Bvh,
}

/// Ordinary ticks own resolved geometry; immutable predictions resolve selected leaves only.
#[derive(Debug, Clone)]
enum HardTarget {
    Prepared(SweepTarget),
    Frozen(FrozenHardTarget),
}

/// Deferred leaf retains its original membership and shapes, independently of cell traversal.
#[derive(Debug, Clone)]
struct FrozenHardTarget {
    anchor: Guid,
    /// Original frame and shared posed shapes; selection does not copy target proofs.
    source_anchor: Guid,
    shapes: Arc<[holtburger_content::PlacedCollisionShape]>,
    /// Collision participation and membership retained for exact filtering.
    contact: super::ContactParticipant,
    prepared: OnceLock<Result<SweepTarget, CollisionQueryError>>,
}

impl HardTarget {
    fn body_id(&self) -> SpatialBodyId {
        match self {
            Self::Prepared(target) => target.contact.body_id,
            Self::Frozen(target) => target.contact.body_id,
        }
    }

    fn resolve(&self) -> Result<&SweepTarget, CollisionQueryError> {
        match self {
            Self::Prepared(target) => Ok(target),
            Self::Frozen(target) => target
                .prepared
                .get_or_init(|| {
                    reanchor_placed_shapes(target.source_anchor, &target.shapes, target.anchor)
                        .map(|shapes| SweepTarget {
                            contact: target.contact.clone(),
                            shapes,
                        })
                        .map_err(|error| {
                            log::error!(
                                "frozen peer {:?} preparation failed: {error:#}",
                                target.contact.body_id
                            );
                            CollisionQueryError::InvalidPeerPlacement
                        })
                })
                .as_ref()
                .map_err(|error| *error),
        }
    }
}

impl HardTargets {
    pub(super) fn new(bodies: Vec<SweepTarget>) -> Result<Self> {
        ensure!(
            bodies.len() < u32::MAX as usize,
            "too many hard targets for spatial index"
        );
        let leaves = bodies
            .iter()
            .enumerate()
            .filter_map(|(slot, body)| bounds(body).map(|bounds| (slot, bounds)))
            .collect::<Vec<_>>();
        // Parry 0.30.2's bulk constructor indexes slots 0/1 for one/two leaves,
        // even when filtering empty geometry left different IDs. Incremental insertion
        // preserves sparse IDs; keep the binned bulk builder for larger target sets.
        let index = build_index(leaves);
        let slots = bodies
            .iter()
            .enumerate()
            .map(|(slot, body)| (body.contact.body_id, slot))
            .collect();
        Ok(Self {
            bodies: bodies.into_iter().map(HardTarget::Prepared).collect(),
            slots,
            index,
        })
    }

    /// Builds a bounds tree without transforming exact geometry. Each actual solver
    /// segment/support query recursively rejects disjoint subtrees before preparing leaves.
    pub(super) fn frozen<'a>(
        anchor: Guid,
        targets: impl IntoIterator<Item = &'a EntityCollisionTarget>,
    ) -> Result<Self> {
        let targets = targets.into_iter();
        let mut bodies = Vec::with_capacity(targets.size_hint().0);
        let mut leaves = Vec::with_capacity(targets.size_hint().0);
        for target in targets {
            let slot = bodies.len();
            ensure!(
                slot < u32::MAX as usize,
                "too many hard targets for spatial index"
            );
            if let Some(bounds) = frozen_bounds(target, anchor)? {
                leaves.push((slot, bounds));
            }
            bodies.push(HardTarget::Frozen(FrozenHardTarget {
                anchor,
                source_anchor: target.anchor,
                shapes: Arc::clone(&target.shapes),
                contact: target.contact.clone(),
                prepared: OnceLock::new(),
            }));
        }
        let slots = bodies
            .iter()
            .enumerate()
            .map(|(slot, target)| (target.body_id(), slot))
            .collect();
        Ok(Self {
            bodies,
            slots,
            index: build_index(leaves),
        })
    }

    /// Publishes accepted nonyielding movement without rebuilding unrelated target bounds.
    pub(super) fn replace(&mut self, target: SweepTarget) -> Result<()> {
        let slot = *self
            .slots
            .get(&target.contact.body_id)
            .ok_or_else(|| anyhow::anyhow!("prepared nonyielding body lost its hard target"))?;
        self.update_bounds(slot, &target);
        self.bodies[slot] = HardTarget::Prepared(target);
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
        self.bodies.push(HardTarget::Prepared(target));
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

    pub(super) fn iter(&self) -> Result<impl Iterator<Item = &SweepTarget>, CollisionQueryError> {
        Ok(self
            .bodies
            .iter()
            .map(HardTarget::resolve)
            .collect::<Result<Vec<_>, _>>()?
            .into_iter())
    }

    pub(super) fn sphere_candidates(
        &self,
        center: Vector3,
        radius: f32,
    ) -> Result<impl Iterator<Item = &SweepTarget>, CollisionQueryError> {
        let center = vector(center);
        let extent = Vector::splat(radius);
        self.candidates(Aabb::new(center - extent, center + extent))
    }

    pub(super) fn support_candidates(
        &self,
        center: Vector3,
        radius: f32,
    ) -> Result<impl Iterator<Item = &SweepTarget>, CollisionQueryError> {
        let reach = radius + CONTACT_EPSILON;
        // Match the existing support primitive's XY column rejection. Height admission
        // remains shape-owned, including BSP slopes and expanded volume cap corners.
        self.candidates(Aabb::new(
            Vector::new(center.x - reach, center.y - reach, -f32::MAX),
            Vector::new(center.x + reach, center.y + reach, f32::MAX),
        ))
    }

    fn candidates(
        &self,
        query: Aabb,
    ) -> Result<impl Iterator<Item = &SweepTarget>, CollisionQueryError> {
        let mut slots = self.index.intersect_aabb(&query).collect::<Vec<_>>();
        slots.sort_unstable_by_key(|slot| self.bodies[*slot as usize].body_id());
        Ok(slots
            .into_iter()
            .map(|slot| self.bodies[slot as usize].resolve())
            .collect::<Result<Vec<_>, _>>()?
            .into_iter())
    }
}

/// Preserve sparse slot IDs for the small-population Parry bulk-builder edge case.
fn build_index(leaves: Vec<(usize, Aabb)>) -> Bvh {
    if leaves.len() <= 2 {
        let mut index = Bvh::new();
        for (slot, bounds) in leaves {
            index.insert(bounds, slot as u32);
        }
        index
    } else {
        Bvh::from_iter(BvhBuildStrategy::Binned, leaves)
    }
}

/// Translation is the only frame change. Expand by a rounding band covering
/// the original bounds, translated bounds, and recomputed exact placement.
/// Membership never removes a leaf: the exact sweep discovers its portal route.
fn frozen_bounds(target: &EntityCollisionTarget, anchor: Guid) -> Result<Option<Aabb>> {
    if target.anchor == anchor {
        // Cloned same-frame leaves retain exactly these bounds. No rounding
        // expansion or cross-frame placement work is needed for the common case.
        let mut bounds: Option<Aabb> = None;
        for shape in target.shapes.iter() {
            let shape_bounds = Aabb::new(
                vector(shape.bounds.minimum()),
                vector(shape.bounds.maximum()),
            );
            bounds = Some(match bounds {
                Some(bounds) => Aabb::new(
                    bounds.mins.min(shape_bounds.mins),
                    bounds.maxs.max(shape_bounds.maxs),
                ),
                None => shape_bounds,
            });
        }
        return Ok(bounds);
    }

    let offset = WorldPosition {
        landblock_id: target.anchor,
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    }
    .reanchor_to_landblock_owner(anchor)?
    .coords;
    let mut bounds: Option<Aabb> = None;
    for shape in target.shapes.iter() {
        let original_min = vector(shape.bounds.minimum());
        let original_max = vector(shape.bounds.maximum());
        let translated_min = original_min + vector(offset);
        let translated_max = original_max + vector(offset);
        let magnitude = original_min
            .abs()
            .max(original_max.abs())
            .max(translated_min.abs())
            .max(translated_max.abs())
            .max(vector(shape.placement.origin).abs())
            .max(vector(offset).abs());
        let band = (magnitude + Vector::splat(1.0)) * (8.0 * f32::EPSILON);
        let shape_bounds = Aabb::new(translated_min - band, translated_max + band);
        ensure!(
            shape_bounds.mins.is_finite() && shape_bounds.maxs.is_finite(),
            "frozen peer bounds must be finite"
        );
        bounds = Some(match bounds {
            Some(bounds) => Aabb::new(
                bounds.mins.min(shape_bounds.mins),
                bounds.maxs.max(shape_bounds.maxs),
            ),
            None => shape_bounds,
        });
    }
    Ok(bounds)
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
                player_collision: None,
                body_id: SpatialBodyId::Entity(Guid(id)),
                target_demand: LocalTargetDemand::Retained,
                policy: EntityDynamicCollisionPolicy {
                    is_static: false,
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
    fn sparse_targets_preserve_identity_through_construction_motion_and_append() {
        for occupied in [vec![], vec![1], vec![0, 2], vec![1, 3], vec![0, 2, 3]] {
            let bodies = (0..4)
                .map(|slot| {
                    let mut body = target(4 - slot, Vector3::zero());
                    if !occupied.contains(&slot) {
                        body.shapes.clear();
                    }
                    body
                })
                .collect();
            let mut targets = HardTargets::new(bodies).unwrap();
            let mut expected = occupied
                .iter()
                .map(|slot| SpatialBodyId::Entity(Guid(4 - slot)))
                .collect::<Vec<_>>();
            expected.sort_unstable();
            assert_candidates(&targets, Vector3::zero(), &expected);

            // Populate a previously empty slot, then move it without changing its identity.
            targets.replace(target(3, Vector3::zero())).unwrap();
            let moved = Vector3::new(10.0, 0.0, 0.0);
            targets.replace(target(3, moved)).unwrap();
            expected.retain(|id| *id != SpatialBodyId::Entity(Guid(3)));
            assert_candidates(&targets, Vector3::zero(), &expected);
            assert_candidates(&targets, moved, &[SpatialBodyId::Entity(Guid(3))]);

            // Appending a lower identity must preserve query ordering and existing slots.
            targets.push(target(0, moved)).unwrap();
            assert_candidates(
                &targets,
                moved,
                &[
                    SpatialBodyId::Entity(Guid(0)),
                    SpatialBodyId::Entity(Guid(3)),
                ],
            );
            targets.replace(target(3, Vector3::zero())).unwrap();
            expected.push(SpatialBodyId::Entity(Guid(3)));
            expected.sort_unstable();
            assert_candidates(&targets, Vector3::zero(), &expected);
            assert_candidates(&targets, moved, &[SpatialBodyId::Entity(Guid(0))]);
        }
        assert_candidates(&HardTargets::new(vec![]).unwrap(), Vector3::zero(), &[]);
    }

    #[test]
    fn deferred_tree_preserves_cross_cell_and_cross_frame_candidates_without_preparing_distant_peers()
     {
        let source_anchor = Guid(0xda55_ffff);
        let mut sources = (1..=64)
            .map(|id| {
                let prepared = target(
                    id,
                    Vector3::new((id % 8) as f32 * 12.0, (id / 8) as f32 * 12.0, id as f32),
                );
                EntityCollisionTarget::for_test(source_anchor, prepared.contact, prepared.shapes)
            })
            .collect::<Vec<_>>();
        let high = target(65, Vector3::new(12.0, 0.0, 100.0));
        sources.push(EntityCollisionTarget::for_test(
            source_anchor,
            high.contact,
            high.shapes,
        ));
        for anchor in [source_anchor, Guid(0xdb54_ffff), Guid(0x0055_ffff)] {
            let deferred = HardTargets::frozen(anchor, &sources).unwrap();
            let exhaustive = HardTargets::new(
                sources
                    .iter()
                    .map(|source| SweepTarget {
                        contact: source.contact.clone(),
                        shapes: reanchor_placed_shapes(source.anchor, &source.shapes, anchor)
                            .unwrap(),
                    })
                    .collect(),
            )
            .unwrap();
            let shifted = WorldPosition {
                landblock_id: source_anchor,
                coords: Vector3::new(12.0, 0.0, 1.0),
                rotation: Quaternion::identity(),
            }
            .reanchor_to_landblock_owner(anchor)
            .unwrap()
            .coords;
            let ids = |query: Vec<&SweepTarget>| {
                query
                    .into_iter()
                    .map(|target| target.contact.body_id)
                    .collect::<Vec<_>>()
            };
            for radius in [0.5, 12.0, 100.0] {
                // Rounded deferred bounds may over-select; compare after the same exact
                // geometry rejection used by the ordinary sweep and support primitives.
                let spheres = |targets: &HardTargets| {
                    ids(targets
                        .sphere_candidates(shifted, radius)
                        .unwrap()
                        .filter(|target| {
                            target
                                .shapes
                                .iter()
                                .any(|shape| shape.bounds.intersects_sphere(shifted, radius))
                        })
                        .collect())
                };
                assert_eq!(spheres(&deferred), spheres(&exhaustive));
                let supports = |targets: &HardTargets| {
                    ids(targets
                        .support_candidates(shifted, radius)
                        .unwrap()
                        .filter(|target| {
                            target.shapes.iter().any(|shape| {
                                !crate::spatial::volume_query::placed_shape_supports(
                                    shape, shifted, radius, 100.0, 100.0,
                                )
                                .is_empty()
                            })
                        })
                        .collect())
                };
                assert_eq!(supports(&deferred), supports(&exhaustive));
            }
            let fresh = HardTargets::frozen(anchor, &sources).unwrap();
            assert!(fresh.bodies.iter().all(|target| matches!(target, HardTarget::Frozen(target) if target.prepared.get().is_none())));
            let near = fresh.sphere_candidates(shifted, 0.5).unwrap().count();
            assert_eq!(near, 1);
            assert_eq!(fresh.bodies.iter().filter(|target| matches!(target, HardTarget::Frozen(target) if target.prepared.get().is_some())).count(), near);
            // A high-altitude peer in the support column must remain selectable even
            // though a short sphere sweep cannot reach it.
            let column = fresh.support_candidates(shifted, 0.5).unwrap().count();
            assert!(column > near);
        }
    }

    #[test]
    fn selected_peer_preparation_failure_is_not_treated_as_empty_space() {
        let source_anchor = Guid(0xda55_ffff);
        let query_anchor = Guid(0xdb55_ffff);
        let mut malformed = target(1, Vector3::zero());
        malformed.shapes[0].scale =
            ColliderScale::from_components(Vector3::new(1.0, 2.0, 1.0)).unwrap();
        let source =
            EntityCollisionTarget::for_test(source_anchor, malformed.contact, malformed.shapes);
        let deferred = HardTargets::frozen(query_anchor, [&source]).unwrap();
        let center = WorldPosition {
            landblock_id: source_anchor,
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        }
        .reanchor_to_landblock_owner(query_anchor)
        .unwrap()
        .coords;
        assert!(matches!(
            deferred.sphere_candidates(center, 0.5),
            Err(CollisionQueryError::InvalidPeerPlacement)
        ));
    }

    fn assert_candidates(targets: &HardTargets, center: Vector3, expected: &[SpatialBodyId]) {
        let identities = |body: &SweepTarget| body.contact.body_id;
        assert_eq!(
            targets
                .sphere_candidates(center, 0.5)
                .unwrap()
                .map(identities)
                .collect::<Vec<_>>(),
            expected
        );
        assert_eq!(
            targets
                .support_candidates(center, 0.5)
                .unwrap()
                .map(identities)
                .collect::<Vec<_>>(),
            expected
        );
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
                    .unwrap()
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
                    .unwrap()
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
                    .unwrap()
                    .filter(|target| exact_supports(target))
                    .map(|target| target.contact.body_id)
                    .collect::<Vec<_>>();
                exhaustive.sort_unstable();
                let indexed = targets
                    .support_candidates(center, radius)
                    .unwrap()
                    .filter(|target| exact_supports(target))
                    .map(|target| target.contact.body_id)
                    .collect::<Vec<_>>();
                assert_eq!(indexed, exhaustive);
            }
        }
        assert!(
            targets
                .sphere_candidates(Vector3::zero(), 0.5)
                .unwrap()
                .count()
                < targets.bodies.len()
        );
    }
}
