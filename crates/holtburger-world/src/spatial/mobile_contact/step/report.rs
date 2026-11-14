//! Observational authored-shape reporting over accepted sphere paths and frozen peer poses.

use anyhow::{Context, Result};
use holtburger_common::{Guid, Vector3};
use holtburger_content::PlacedCollisionShape;

use super::ContactBodyUpdate;
use super::collection::SceneContactReportOverride;
use crate::spatial::collision::{PlacedMotionPath, sphere_path_touches_shape};
use crate::spatial::collision_report::{dynamic_report_touch, dynamic_report_touch_from_flags};
use crate::spatial::dynamic_index::{
    DynamicShadowIndex, EntityCollisionSnapshot, dynamic_target_is_indexed, placed_target_shapes,
    reanchor_placed_shapes_into,
};
use crate::spatial::physical_body::DynamicBodyRuntimeState;
use crate::spatial::{
    CollisionReportTouch, PhysicalSphereSet, SpatialBody, SpatialBodyId, SpatialMembership,
};

/// Reusable scratch buffers for collection-level collision reporting.
#[derive(Debug, Default)]
pub(super) struct ReportScratch {
    index: DynamicShadowIndex,
    candidates: Vec<SpatialBodyId>,
    segments: Vec<ReportSegment>,
    reanchored_shapes: Vec<PlacedCollisionShape>,
    temp_shapes: Vec<PlacedCollisionShape>,
    override_peers: Vec<PreparedOverridePeer>,
    masked_ids: Vec<SpatialBodyId>,
    standalone_targets: Vec<PreparedStandaloneTarget>,
}

#[derive(Debug)]
struct PreparedOverridePeer {
    id: SpatialBodyId,
    override_idx: usize,
    reanchored_range: Option<(usize, usize)>,
    minimum: Vector3,
    maximum: Vector3,
}

#[derive(Debug)]
struct PreparedStandaloneTarget {
    id: SpatialBodyId,
    body_idx: usize,
    shape_range: (usize, usize),
    minimum: Vector3,
    maximum: Vector3,
}

fn body_report_parts(body: &SpatialBody) -> Option<(&DynamicBodyRuntimeState, PhysicalSphereSet)> {
    let physical = body.physical.as_ref()?;
    let dynamic = physical.dynamic.as_ref()?;
    Some((dynamic, physical.definition.spheres()))
}

/// One accepted sphere segment, including zero-length initial-overlap observations.
#[derive(Debug)]
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

fn shapes_bounds(shapes: &[PlacedCollisionShape]) -> Option<(Vector3, Vector3)> {
    let first = shapes.first()?;
    let mut minimum = first.bounds.minimum();
    let mut maximum = first.bounds.maximum();
    for shape in &shapes[1..] {
        let smin = shape.bounds.minimum();
        let smax = shape.bounds.maximum();
        minimum.x = minimum.x.min(smin.x);
        minimum.y = minimum.y.min(smin.y);
        minimum.z = minimum.z.min(smin.z);
        maximum.x = maximum.x.max(smax.x);
        maximum.y = maximum.y.max(smax.y);
        maximum.z = maximum.z.max(smax.z);
    }
    Some((minimum, maximum))
}

fn mover_path_envelope_into(
    mover: &SpatialBody,
    dynamic: &DynamicBodyRuntimeState,
    spheres: PhysicalSphereSet,
    update: &ContactBodyUpdate,
    anchor: Guid,
    segments: &mut Vec<ReportSegment>,
) -> Result<(Vector3, Vector3, SpatialMembership)> {
    let pose = mover.pose.reanchor_to_landblock_owner(anchor)?;
    segments.clear();
    for sphere in spheres.iter() {
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
        for (sphere, trace) in spheres
            .iter()
            .zip(std::iter::once(&path.primary).chain(path.upper.iter()))
        {
            segments.extend(report_path_segments(trace, sphere.radius));
        }
    }
    let mut minimum = pose.coords;
    let mut maximum = pose.coords;
    let mut membership = dynamic.placement.clone();
    for segment in segments.iter() {
        minimum.x = minimum.x.min(segment.extent.0.x);
        minimum.y = minimum.y.min(segment.extent.0.y);
        minimum.z = minimum.z.min(segment.extent.0.z);
        maximum.x = maximum.x.max(segment.extent.1.x);
        maximum.y = maximum.y.max(segment.extent.1.y);
        maximum.z = maximum.z.max(segment.extent.1.z);
        membership.merge_reached_ref(&segment.membership);
    }
    Ok((minimum, maximum, membership))
}

fn peer_report_directions(
    mover: &DynamicBodyRuntimeState,
    peer_policy: crate::EntityDynamicCollisionPolicy,
    peer_player_collision: Option<crate::PlayerCollisionStatus>,
    peer_reporting_enabled: bool,
) -> Option<(bool, bool)> {
    if mover.collision.dynamic_collision.contact_with(
        peer_policy,
        mover.collision.player_collision,
        peer_player_collision,
    ) == crate::EntityContactInteraction::Ignored
    {
        return None;
    }
    let to_mover = mover.collision.reporting.enabled && peer_policy.accepts_peer_reports;
    let to_peer = peer_reporting_enabled && mover.collision.dynamic_collision.accepts_peer_reports;
    (to_mover || to_peer).then_some((to_mover, to_peer))
}

struct MoverReportContext<'a> {
    id: SpatialBodyId,
    dynamic: &'a DynamicBodyRuntimeState,
    minimum: Vector3,
    maximum: Vector3,
    membership: SpatialMembership,
    anchor: Guid,
}

struct PeerReportCandidate<'a> {
    id: SpatialBodyId,
    policy: crate::EntityDynamicCollisionPolicy,
    player_collision: Option<crate::PlayerCollisionStatus>,
    reporting_enabled: bool,
    as_environment: bool,
    membership: &'a SpatialMembership,
    shapes: &'a [PlacedCollisionShape],
}

fn check_mover_against_peer(
    mover: &MoverReportContext<'_>,
    segments: &[ReportSegment],
    peer: PeerReportCandidate<'_>,
    touches: &mut Vec<CollisionReportTouch>,
) -> Result<()> {
    let Some((to_mover, to_peer)) = peer_report_directions(
        mover.dynamic,
        peer.policy,
        peer.player_collision,
        peer.reporting_enabled,
    ) else {
        return Ok(());
    };
    if !peer.shapes.iter().any(|shape| {
        extents_intersect(
            (mover.minimum, mover.maximum),
            (shape.bounds.minimum(), shape.bounds.maximum()),
        )
    }) {
        return Ok(());
    }
    for segment in segments {
        if segment.touches(peer.membership, peer.shapes, mover.anchor)? {
            if to_mover {
                touches.push(dynamic_report_touch_from_flags(
                    mover.id,
                    peer.id,
                    peer.as_environment,
                    peer.policy.target == crate::EntityCollisionParticipation::Ethereal,
                ));
            }
            if to_peer {
                touches.push(dynamic_report_touch(peer.id, mover.id, mover.dynamic));
            }
            // Reporting is a union: further segments cannot add another report for this
            // directed pair and frozen source classification within the tick.
            break;
        }
    }
    Ok(())
}

/// Returns `(any_emits, any_accepts)` over indexed override bodies.
pub(super) fn override_report_capabilities(
    overrides: &[SceneContactReportOverride<'_>],
) -> (bool, bool) {
    let mut any_emits = false;
    let mut any_accepts = false;
    for peer in overrides {
        if dynamic_target_is_indexed(peer.id, peer.dynamic) {
            any_emits |= peer.dynamic.collision.reporting.enabled;
            any_accepts |= peer
                .dynamic
                .collision
                .dynamic_collision
                .accepts_peer_reports;
        }
    }
    (any_emits, any_accepts)
}

/// Collects both report directions without participating in movement response or publication.
/// Each mover selects peers once for its complete tick; each segment retains its own domain
/// proof. Moving peers remain frozen at tick start and stationary triggers retain swept tests.
pub(super) fn collect_traversal_report_touches(
    bodies: &[SpatialBody],
    updates: &[ContactBodyUpdate],
    anchor: Guid,
    touches: &mut Vec<CollisionReportTouch>,
    scratch: &mut ReportScratch,
) -> Result<()> {
    let mut any_mover_emits = false;
    let mut any_mover_accepts = false;
    let mut any_peer_emits = false;
    let mut any_peer_accepts = false;
    for body in bodies {
        let Some((dynamic, _)) = body_report_parts(body) else {
            continue;
        };
        let emits = dynamic.collision.reporting.enabled;
        let accepts = dynamic.collision.dynamic_collision.accepts_peer_reports;
        if dynamic_target_is_indexed(body.id, dynamic) {
            any_peer_emits |= emits;
            any_peer_accepts |= accepts;
        }
        if updates
            .binary_search_by_key(&body.id, |update| update.body_id)
            .is_ok()
        {
            any_mover_emits |= emits;
            any_mover_accepts |= accepts;
        }
    }
    if !(any_mover_emits && any_peer_accepts || any_mover_accepts && any_peer_emits) {
        return Ok(());
    }

    scratch.standalone_targets.clear();
    scratch.reanchored_shapes.clear();
    for (body_idx, body) in bodies.iter().enumerate() {
        let Some((dynamic, _)) = body_report_parts(body) else {
            continue;
        };
        if !dynamic_target_is_indexed(body.id, dynamic) {
            continue;
        }
        let placed = placed_target_shapes(dynamic, body.pose, anchor)?;
        let Some((minimum, maximum)) = shapes_bounds(&placed) else {
            continue;
        };
        let start = scratch.reanchored_shapes.len();
        scratch.reanchored_shapes.extend(placed);
        let end = scratch.reanchored_shapes.len();
        scratch.standalone_targets.push(PreparedStandaloneTarget {
            id: body.id,
            body_idx,
            shape_range: (start, end),
            minimum,
            maximum,
        });
    }
    scratch
        .standalone_targets
        .sort_unstable_by_key(|target| target.id);
    scratch
        .index
        .rebuild_prepared(scratch.standalone_targets.iter().filter_map(|target| {
            let (dynamic, _) = body_report_parts(&bodies[target.body_idx])?;
            Some((
                target.id,
                &dynamic.placement,
                anchor,
                &scratch.reanchored_shapes[target.shape_range.0..target.shape_range.1],
            ))
        }));

    for mover in bodies {
        let Some((mover_dynamic, mover_spheres)) = body_report_parts(mover) else {
            continue;
        };
        let mover_can_emit = mover_dynamic.collision.reporting.enabled && any_peer_accepts;
        let mover_can_accept = mover_dynamic
            .collision
            .dynamic_collision
            .accepts_peer_reports
            && any_peer_emits;
        if !mover_can_emit && !mover_can_accept {
            continue;
        }
        let Ok(position) = updates.binary_search_by_key(&mover.id, |update| update.body_id) else {
            // A stationary target has no accepted mover path in this tick.
            continue;
        };
        let update = &updates[position];
        let (minimum, maximum, membership) = mover_path_envelope_into(
            mover,
            mover_dynamic,
            mover_spheres,
            update,
            anchor,
            &mut scratch.segments,
        )?;
        let mover_ctx = MoverReportContext {
            id: mover.id,
            dynamic: mover_dynamic,
            minimum,
            maximum,
            membership,
            anchor,
        };
        scratch.index.candidates_into(
            Some(mover_ctx.id),
            anchor,
            mover_ctx.minimum,
            mover_ctx.maximum,
            &mover_ctx.membership,
            &mut scratch.candidates,
        );
        for &peer_id in &scratch.candidates {
            let Ok(pos) = scratch
                .standalone_targets
                .binary_search_by_key(&peer_id, |target| target.id)
            else {
                anyhow::bail!("report index returned an unprepared target");
            };
            let entry = &scratch.standalone_targets[pos];
            if !extents_intersect(
                (mover_ctx.minimum, mover_ctx.maximum),
                (entry.minimum, entry.maximum),
            ) {
                continue;
            }
            let Some((peer_dynamic, _)) = body_report_parts(&bodies[entry.body_idx]) else {
                continue;
            };
            check_mover_against_peer(
                &mover_ctx,
                &scratch.segments,
                PeerReportCandidate {
                    id: peer_id,
                    policy: peer_dynamic.collision.dynamic_collision,
                    player_collision: peer_dynamic.collision.player_collision,
                    reporting_enabled: peer_dynamic.collision.reporting.enabled,
                    as_environment: peer_dynamic.collision.reporting.as_environment,
                    membership: &peer_dynamic.placement,
                    shapes: &scratch.reanchored_shapes[entry.shape_range.0..entry.shape_range.1],
                },
                touches,
            )?;
        }
    }
    Ok(())
}

fn override_peer_shapes<'a>(
    entry: &PreparedOverridePeer,
    overrides: &'a [SceneContactReportOverride<'_>],
    reanchored: &'a [PlacedCollisionShape],
) -> &'a [PlacedCollisionShape] {
    match entry.reanchored_range {
        None => &overrides[entry.override_idx].shapes,
        Some((start, end)) => &reanchored[start..end],
    }
}

fn check_mover_against_override_peer(
    mover: &MoverReportContext<'_>,
    segments: &[ReportSegment],
    entry: &PreparedOverridePeer,
    overrides: &[SceneContactReportOverride<'_>],
    reanchored: &[PlacedCollisionShape],
    touches: &mut Vec<CollisionReportTouch>,
) -> Result<()> {
    if !extents_intersect(
        (mover.minimum, mover.maximum),
        (entry.minimum, entry.maximum),
    ) {
        return Ok(());
    }
    let peer = &overrides[entry.override_idx];
    check_mover_against_peer(
        mover,
        segments,
        PeerReportCandidate {
            id: peer.id,
            policy: peer.dynamic.collision.dynamic_collision,
            player_collision: peer.dynamic.collision.player_collision,
            reporting_enabled: peer.dynamic.collision.reporting.enabled,
            as_environment: peer.dynamic.collision.reporting.as_environment,
            membership: &peer.dynamic.placement,
            shapes: override_peer_shapes(entry, overrides, reanchored),
        },
        touches,
    )
}

/// Fast path sharing prepared `EntityCollisionSnapshot` and/or scene overrides with pooled scratch.
pub(super) fn collect_traversal_report_touches_with_prepared(
    bodies: &[SpatialBody],
    updates: &[ContactBodyUpdate],
    anchor: Guid,
    entity_snapshot: Option<&EntityCollisionSnapshot>,
    overrides: &[SceneContactReportOverride<'_>],
    touches: &mut Vec<CollisionReportTouch>,
    scratch: &mut ReportScratch,
) -> Result<()> {
    let (override_emits, override_accepts) = override_report_capabilities(overrides);
    let (snap_emits, snap_accepts) = entity_snapshot.map_or((false, false), |snapshot| {
        (
            snapshot.any_reporting_enabled(),
            snapshot.any_accepts_peer_reports(),
        )
    });
    let any_peer_emits = snap_emits || override_emits;
    let any_peer_accepts = snap_accepts || override_accepts;
    if !any_peer_emits && !any_peer_accepts {
        return Ok(());
    }

    scratch.override_peers.clear();
    scratch.masked_ids.clear();
    scratch.reanchored_shapes.clear();
    for (override_idx, peer) in overrides.iter().enumerate() {
        scratch.masked_ids.push(peer.id);
        if !dynamic_target_is_indexed(peer.id, peer.dynamic) {
            continue;
        }
        if peer.shapes_anchor == anchor {
            let Some((minimum, maximum)) = shapes_bounds(&peer.shapes) else {
                continue;
            };
            scratch.override_peers.push(PreparedOverridePeer {
                id: peer.id,
                override_idx,
                reanchored_range: None,
                minimum,
                maximum,
            });
        } else {
            reanchor_placed_shapes_into(
                peer.shapes_anchor,
                &peer.shapes,
                anchor,
                &mut scratch.temp_shapes,
            )?;
            let Some((minimum, maximum)) = shapes_bounds(&scratch.temp_shapes) else {
                continue;
            };
            let start = scratch.reanchored_shapes.len();
            scratch.reanchored_shapes.append(&mut scratch.temp_shapes);
            let end = scratch.reanchored_shapes.len();
            scratch.override_peers.push(PreparedOverridePeer {
                id: peer.id,
                override_idx,
                reanchored_range: Some((start, end)),
                minimum,
                maximum,
            });
        }
    }
    if !scratch.override_peers.is_sorted_by_key(|peer| peer.id) {
        scratch.override_peers.sort_unstable_by_key(|peer| peer.id);
    }
    if !scratch.masked_ids.is_sorted() {
        scratch.masked_ids.sort_unstable();
    }

    let use_override_index = !scratch.override_peers.is_empty()
        && (entity_snapshot.is_none() || scratch.override_peers.len() >= 8);
    if use_override_index {
        scratch
            .index
            .rebuild_prepared(scratch.override_peers.iter().map(|entry| {
                let peer = &overrides[entry.override_idx];
                (
                    entry.id,
                    &peer.dynamic.placement,
                    anchor,
                    override_peer_shapes(entry, overrides, &scratch.reanchored_shapes),
                )
            }));
    }

    for mover in bodies {
        let Some((mover_dynamic, mover_spheres)) = body_report_parts(mover) else {
            continue;
        };
        let mover_can_emit = mover_dynamic.collision.reporting.enabled && any_peer_accepts;
        let mover_can_accept = mover_dynamic
            .collision
            .dynamic_collision
            .accepts_peer_reports
            && any_peer_emits;
        if !mover_can_emit && !mover_can_accept {
            continue;
        }
        let Ok(position) = updates.binary_search_by_key(&mover.id, |update| update.body_id) else {
            continue;
        };
        let update = &updates[position];
        let (minimum, maximum, membership) = mover_path_envelope_into(
            mover,
            mover_dynamic,
            mover_spheres,
            update,
            anchor,
            &mut scratch.segments,
        )?;
        let mover_ctx = MoverReportContext {
            id: mover.id,
            dynamic: mover_dynamic,
            minimum,
            maximum,
            membership,
            anchor,
        };

        if let Some(snapshot) = entity_snapshot
            && ((mover_dynamic.collision.reporting.enabled && snap_accepts)
                || (mover_dynamic
                    .collision
                    .dynamic_collision
                    .accepts_peer_reports
                    && snap_emits))
        {
            snapshot.index.candidates_into(
                Some(mover_ctx.id),
                anchor,
                mover_ctx.minimum,
                mover_ctx.maximum,
                &mover_ctx.membership,
                &mut scratch.candidates,
            );
            for &peer_id in &scratch.candidates {
                if scratch.masked_ids.binary_search(&peer_id).is_ok() {
                    continue;
                }
                let target = snapshot
                    .target(peer_id)
                    .context("report snapshot index returned an absent target")?;
                let shapes: &[PlacedCollisionShape] = if target.anchor == anchor {
                    target.shapes.as_ref()
                } else {
                    reanchor_placed_shapes_into(
                        target.anchor,
                        &target.shapes,
                        anchor,
                        &mut scratch.temp_shapes,
                    )?;
                    &scratch.temp_shapes
                };
                check_mover_against_peer(
                    &mover_ctx,
                    &scratch.segments,
                    PeerReportCandidate {
                        id: peer_id,
                        policy: target.contact.policy,
                        player_collision: target.contact.player_collision,
                        reporting_enabled: target.reporting_enabled,
                        as_environment: target.report_as_environment,
                        membership: &target.contact.membership,
                        shapes,
                    },
                    touches,
                )?;
            }
        }

        if !scratch.override_peers.is_empty()
            && ((mover_dynamic.collision.reporting.enabled && override_accepts)
                || (mover_dynamic
                    .collision
                    .dynamic_collision
                    .accepts_peer_reports
                    && override_emits))
        {
            if use_override_index {
                scratch.index.candidates_into(
                    Some(mover_ctx.id),
                    anchor,
                    mover_ctx.minimum,
                    mover_ctx.maximum,
                    &mover_ctx.membership,
                    &mut scratch.candidates,
                );
                for &peer_id in &scratch.candidates {
                    let Ok(pos) = scratch
                        .override_peers
                        .binary_search_by_key(&peer_id, |peer| peer.id)
                    else {
                        continue;
                    };
                    check_mover_against_override_peer(
                        &mover_ctx,
                        &scratch.segments,
                        &scratch.override_peers[pos],
                        overrides,
                        &scratch.reanchored_shapes,
                        touches,
                    )?;
                }
            } else {
                for entry in &scratch.override_peers {
                    if entry.id == mover_ctx.id {
                        continue;
                    }
                    check_mover_against_override_peer(
                        &mover_ctx,
                        &scratch.segments,
                        entry,
                        overrides,
                        &scratch.reanchored_shapes,
                        touches,
                    )?;
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
                        visibility: holtburger_content::CellVisibility {
                            visible_cell_selectors: Vec::new(),
                            seen_outside: false,
                        },
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
                                aperture_vertices: Vec::new(),
                                reciprocal_visibility_vertices: None,
                                positive_side: true,
                                target: CellCollisionPortalTarget::Outdoor,
                                outdoor_building: Some(
                                    holtburger_content::OutdoorBuildingTransit {
                                        building_index: 0,
                                        building_origin: Vector3::new(100.0, 96.0, 0.0),
                                    },
                                ),
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
