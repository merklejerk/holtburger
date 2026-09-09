//! Observational authored-shape reporting over accepted sphere paths and frozen peer poses.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_content::PlacedCollisionShape;

use super::ContactBodyUpdate;
use crate::EntityCollisionParticipation;
use crate::spatial::collision::{PlacedMotionPath, sphere_path_touches_shape};
use crate::spatial::collision_report::dynamic_report_touch;
use crate::spatial::dynamic_index::{
    DynamicShadowIndex, dynamic_target_is_indexed, placed_target_shapes,
};
use crate::spatial::physical_body::DynamicBodyRuntimeState;
use crate::spatial::{CollisionReportTouch, PhysicalSphereSet, SpatialBodyId, SpatialMembership};

/// Tick-start facts consumed by reporting, independent of canonical body storage.
pub(super) struct ReportBody<'a> {
    /// Identity shared by the accepted motion and report recipients.
    pub id: SpatialBodyId,
    /// Root pose before this tick's accepted segments.
    pub pose: WorldPosition,
    /// Body-local movement spheres supplying swept report probes.
    pub spheres: PhysicalSphereSet,
    /// Frozen reporting policy, target geometry and membership at tick start.
    pub dynamic: &'a DynamicBodyRuntimeState,
}

/// One admitted report target; geometry and policy are recovered once during preparation.
struct ReportTarget<'a> {
    /// Proven dynamic policy for both report directions and reached-domain filtering.
    dynamic: &'a DynamicBodyRuntimeState,
    /// Authored target geometry in the collection frame.
    shapes: Vec<PlacedCollisionShape>,
}

/// One accepted sphere segment, including zero-length initial-overlap observations.
struct ReportSegment {
    /// Domains reached by this segment, retained separately from the aggregate query extent.
    membership: SpatialMembership,
    /// Sphere-center endpoints in the collection frame.
    endpoints: (Vector3, Vector3),
    /// Moving sphere radius.
    radius: f32,
    /// Swept minimum and maximum, shared by candidate selection and shape rejection.
    extent: (Vector3, Vector3),
}

impl ReportSegment {
    fn new(membership: SpatialMembership, start: Vector3, end: Vector3, radius: f32) -> Self {
        Self {
            membership,
            endpoints: (start, end),
            radius,
            extent: (
                Vector3::new(
                    start.x.min(end.x) - radius,
                    start.y.min(end.y) - radius,
                    start.z.min(end.z) - radius,
                ),
                Vector3::new(
                    start.x.max(end.x) + radius,
                    start.y.max(end.y) + radius,
                    start.z.max(end.z) + radius,
                ),
            ),
        }
    }

    fn touches(
        &self,
        membership: &SpatialMembership,
        shapes: &[PlacedCollisionShape],
        anchor: Guid,
    ) -> Result<bool> {
        if !self.membership.intersects_reached(membership) {
            return Ok(false);
        }
        for shape in shapes {
            if extents_intersect(
                self.extent,
                (shape.bounds.minimum(), shape.bounds.maximum()),
            ) && sphere_path_touches_shape(
                shape,
                self.endpoints.0,
                self.endpoints.1,
                self.radius,
                anchor,
            )? {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// Endpoint reach includes portal-boundary neighbors, without admitting later path domains.
fn report_path_segments(
    path: &PlacedMotionPath,
    radius: f32,
) -> impl Iterator<Item = ReportSegment> + '_ {
    let mut start = path.initial();
    path.legs().iter().map(move |leg| {
        let end = leg.end();
        let segment = ReportSegment::new(
            start
                .placement()
                .clone()
                .merge_reached(end.placement().clone()),
            start.center(),
            end.center(),
            radius,
        );
        start = end;
        segment
    })
}

fn extents_intersect(
    (a_min, a_max): (Vector3, Vector3),
    (b_min, b_max): (Vector3, Vector3),
) -> bool {
    a_min.x <= b_max.x
        && b_min.x <= a_max.x
        && a_min.y <= b_max.y
        && b_min.y <= a_max.y
        && a_min.z <= b_max.z
        && b_min.z <= a_max.z
}

/// Collects both report directions without participating in movement response or publication.
/// Each mover selects peers once for its complete tick; each segment retains its own domain
/// proof. Moving peers remain frozen at tick start and stationary triggers retain swept tests.
pub(super) fn collect_traversal_report_touches(
    bodies: &[ReportBody<'_>],
    updates: &[ContactBodyUpdate],
    anchor: Guid,
    touches: &mut BTreeSet<CollisionReportTouch>,
) -> Result<()> {
    let prepared = bodies
        .iter()
        .filter(|body| dynamic_target_is_indexed(body.id, body.dynamic))
        .map(|body| {
            Ok((
                body.id,
                ReportTarget {
                    dynamic: body.dynamic,
                    shapes: placed_target_shapes(body.dynamic, body.pose, anchor)?,
                },
            ))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    let index = DynamicShadowIndex::compile_prepared(prepared.iter().map(|(id, target)| {
        (
            *id,
            &target.dynamic.placement,
            anchor,
            target.shapes.as_slice(),
        )
    }));
    for mover in bodies {
        let Ok(position) = updates.binary_search_by_key(&mover.id, |update| update.body_id) else {
            // A stationary target has no accepted mover path in this tick.
            continue;
        };
        let update = &updates[position];
        let dynamic = mover.dynamic;
        let pose = mover.pose.reanchor_to_landblock_owner(anchor)?;
        let mut segments = Vec::new();
        for sphere in mover.spheres.iter() {
            let center = pose.coords + pose.rotation.rotate_vector(sphere.center);
            segments.push(ReportSegment::new(
                dynamic.placement.clone(),
                center,
                center,
                sphere.radius,
            ));
        }
        for path in update
            .motion
            .iter()
            .filter_map(super::ContactMotionSegment::path)
        {
            for (sphere, trace) in mover
                .spheres
                .iter()
                .zip(std::iter::once(&path.primary).chain(path.upper.iter()))
            {
                segments.extend(report_path_segments(trace, sphere.radius));
            }
        }
        let mut minimum = pose.coords;
        let mut maximum = pose.coords;
        let mut membership = dynamic.placement.clone();
        for segment in &segments {
            minimum.x = minimum.x.min(segment.extent.0.x);
            minimum.y = minimum.y.min(segment.extent.0.y);
            minimum.z = minimum.z.min(segment.extent.0.z);
            maximum.x = maximum.x.max(segment.extent.1.x);
            maximum.y = maximum.y.max(segment.extent.1.y);
            maximum.z = maximum.z.max(segment.extent.1.z);
            membership = membership.merge_reached(segment.membership.clone());
        }
        for peer_id in index.candidates(Some(mover.id), anchor, minimum, maximum, &membership) {
            let peer = prepared
                .get(&peer_id)
                .context("report index returned an unprepared target")?;
            if dynamic.collision.dynamic_collision.missile
                && peer.dynamic.collision.dynamic_collision.target
                    == EntityCollisionParticipation::Ethereal
            {
                continue;
            }
            let to_mover = dynamic.collision.reporting.enabled
                && peer
                    .dynamic
                    .collision
                    .dynamic_collision
                    .accepts_peer_reports;
            let to_peer = peer.dynamic.collision.reporting.enabled
                && dynamic.collision.dynamic_collision.accepts_peer_reports;
            if (!to_mover && !to_peer)
                || !peer.shapes.iter().any(|shape| {
                    extents_intersect(
                        (minimum, maximum),
                        (shape.bounds.minimum(), shape.bounds.maximum()),
                    )
                })
            {
                continue;
            }
            for segment in &segments {
                if segment.touches(&peer.dynamic.placement, &peer.shapes, anchor)? {
                    if to_mover {
                        touches.insert(dynamic_report_touch(mover.id, peer_id, peer.dynamic));
                    }
                    if to_peer {
                        touches.insert(dynamic_report_touch(peer_id, mover.id, dynamic));
                    }
                    // Reporting is a union: further segments cannot add another report for this
                    // directed pair and frozen source classification within the tick.
                    break;
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Quaternion;
    use holtburger_content::{ColliderScale, CollisionBall, CollisionShape, LandblockPlacement};
    use std::sync::Arc;

    use crate::spatial::collision::{
        CollisionScene, MotionWaypoint, MotionWaypointPlacement, PlacedMotionPathRequest,
    };
    use holtburger_common::Plane;
    use holtburger_content::{
        CellCollisionPortal, CellCollisionPortalTarget, CellVolume, LandblockColliders,
        LandblockCollisionAsset, TerrainCollisionSurface,
    };

    #[test]
    fn production_path_segments_do_not_inherit_future_cell_reach() {
        let anchor = Guid(0xda55_ffff);
        let cell = Guid(0xda55_0100);
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: anchor.0,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::new(
                    Vec::new(),
                    vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: vec![
                            Plane {
                                normal: Vector3::new(1.0, 0.0, 0.0),
                                d: -100.0,
                            },
                            Plane {
                                normal: Vector3::new(-1.0, 0.0, 0.0),
                                d: 100.2,
                            },
                        ],
                        portals: [(-1.0, 100.0), (1.0, -100.2)]
                            .into_iter()
                            .map(|(x, d)| CellCollisionPortal {
                                plane: Plane {
                                    normal: Vector3::new(x, 0.0, 0.0),
                                    d,
                                },
                                positive_side: true,
                                target: CellCollisionPortalTarget::Outdoor,
                                outdoor_building: None,
                            })
                            .collect(),
                    }],
                ),
            })
            .unwrap();
        let radius = 0.1;
        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: None,
                anchor,
                start: Vector3::new(96.0, 96.0, 20.0),
                radius,
                waypoints: &[
                    MotionWaypoint {
                        center: Vector3::new(98.0, 96.0, 20.0),
                        end_fraction: 0.5,
                        placement: MotionWaypointPlacement::Traverse,
                    },
                    MotionWaypoint {
                        center: Vector3::new(100.4, 96.0, 20.0),
                        end_fraction: 1.0,
                        placement: MotionWaypointPlacement::Traverse,
                    },
                ],
            })
            .unwrap();
        let segments: Vec<_> = report_path_segments(&path, radius).collect();
        let target = SpatialMembership::interior(cell);
        assert!(!segments[0].membership.intersects_reached(&target));
        assert!(
            segments
                .iter()
                .skip(1)
                .any(|segment| segment.membership.intersects_reached(&target))
        );
        assert!(
            segments
                .iter()
                .all(|segment| segment.membership.reaches_outdoors())
        );
    }

    #[test]
    fn aggregate_domains_do_not_grant_a_segment_contact_in_an_unrelated_cell() {
        let first = SpatialMembership::interior(Guid(0xda55_0100));
        let second = SpatialMembership::interior(Guid(0xda55_0101));
        let shape = PlacedCollisionShape::new(
            Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 0.2,
            })),
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
        )
        .unwrap();
        let shapes = [shape];
        let anchor = Guid(0xda55_ffff);
        let crossing = ReportSegment::new(
            first.clone(),
            Vector3::new(-1.0, 0.0, 0.0),
            Vector3::new(1.0, 0.0, 0.0),
            0.1,
        );
        let separate = ReportSegment::new(
            second.clone(),
            Vector3::new(-1.0, 2.0, 0.0),
            Vector3::new(1.0, 2.0, 0.0),
            0.1,
        );
        assert!(
            first
                .clone()
                .merge_reached(second.clone())
                .intersects_reached(&second)
        );
        assert!(!crossing.touches(&second, &shapes, anchor).unwrap());
        assert!(!separate.touches(&second, &shapes, anchor).unwrap());
        assert!(crossing.touches(&first, &shapes, anchor).unwrap());
    }
}
