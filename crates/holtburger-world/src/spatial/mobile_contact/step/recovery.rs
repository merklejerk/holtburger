//! Checked endpoint placement for arrivals and stalled bodies, without traversing the old route.

use std::fmt;

use super::*;
use crate::spatial::{
    GroundSupport, PlacementRequest, PlacementRestrictionRequest, SupportFeature, SupportSource,
    bsp_query::CONTACT_EPSILON,
    collision::{StaticContact, separating_displacement},
    volume_query::placed_shape_contacts,
};

/// RETAIL QUIRK: Retail behavior is to stop velocity on the second consecutive stationary
/// falling tick and create horizontal support beneath the lower sphere on the third. Geometry
/// need not supply a walkable floor. Removing this recovery can leave bodies permanently
/// airborne between blocking contacts, disabling grounded controls. Evidence covers one
/// captured dungeon corner and synthetic blocked-fall, departure and coverage cases; no
/// full-content census has been performed.
pub(super) fn recover_stationary_fall(
    collision: &CollisionScene,
    body: &mut WorkingBody<'_>,
) -> Result<()> {
    let Some(grounded) = &mut body.grounded else {
        return Ok(());
    };
    if body.unavailable_owner.is_some()
        || body.root != body.initial_root
        || body.rotation != body.source.body.pose.rotation
        || body.launch_admitted
        || grounded.config.gravity >= 0.0
    {
        grounded.stationary_fall_frames = 0;
        return Ok(());
    }
    if let Some(support) = grounded.ground.walkable_support() {
        if !matches!(support.source, SupportSource::StationaryFall(_)) {
            grounded.stationary_fall_frames = 0;
        }
        return Ok(());
    }
    if !body.integrate_ordinary
        || !body
            .motion
            .iter()
            .any(|segment| matches!(segment, ContactMotionSegment::Impact { .. }))
    {
        grounded.stationary_fall_frames = 0;
        return Ok(());
    }
    grounded.stationary_fall_frames = grounded
        .stationary_fall_frames
        .saturating_add(1)
        .min(STATIONARY_FALL_SUPPORT_FRAMES);
    if grounded.stationary_fall_frames >= STATIONARY_FALL_STOP_FRAMES {
        body.mobile.velocity = Vector3::zero();
    }
    if grounded.stationary_fall_frames == STATIONARY_FALL_SUPPORT_FRAMES {
        grounded.ground = GroundState::Supported(GroundSupport {
            normal: Vector3::new(0.0, 0.0, 1.0),
            feature: SupportFeature::Surface,
            source: SupportSource::StationaryFall(
                collision
                    .owner_proof(Guid(body.source.body.pose.landblock_id.0 | 0xffff))
                    .context("stationary-fall recovery lost collision ownership")?,
            ),
        });
    }
    Ok(())
}

/// Full-body clearance with one correction computed from the observed contacts.
#[derive(Debug)]
pub(super) enum PlacementClearance {
    /// Every queried sphere, domain, restriction, and peer is clear.
    Clear,
    /// A geometric domain or restriction cannot be repaired by contact separation.
    Blocked(String),
    /// Finite overlaps supply a proposed common translation for the entire body.
    Overlapping {
        /// Shared separation primitive's correction, consumed only by arrival placement.
        correction: Vector3,
        /// First observed blocker retained for a rejected-candidate diagnostic.
        diagnostic: String,
        /// Whether at least one blocking mobile peer overlapped the candidate.
        has_mobile_overlap: bool,
    },
}

/// Complete remote recovery destination classification, distinguishing mobile-peer occupancy
/// from static/hard/unsupported blockage so callers never park on top of a live peer.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum RecoveryDestinationCheck {
    /// Exact endpoint is clear of all blockers and (for gravity-bearing grounded bodies) supported.
    Clear {
        pose: WorldPosition,
        membership: SpatialMembership,
    },
    /// At least one blocking mobile peer overlaps the destination; never park here.
    BlockedByMobilePeer,
    /// Clear of all blocking mobile peers, but blocked by static geometry, domain restriction,
    /// hard obstacle, or missing walkable support; eligible for `AuthoritativeParked`.
    BlockedByStaticOrUnsupported,
}

/// Prepared single-body destination validation context shared by exact recovery evaluation and
/// bounded arrival contact separation.
struct PreparedDestination<'a> {
    anchor: Guid,
    hard: super::HardTargets,
    mobiles: Vec<(ContactParticipant, MobileContactBody)>,
    working: WorkingBody<'a>,
}

fn prepare_destination<'a>(
    candidate: &'a SpatialBody,
    peers: &'a [SpatialBody],
) -> Result<std::result::Result<PreparedDestination<'a>, &'static str>> {
    let anchor = Guid(candidate.pose.landblock_id.0 | 0xffff);
    let Some(actor) = PreparedBodyContact::from_body(candidate, anchor)? else {
        return Ok(Err("body has no prepared collision participant"));
    };
    let PreparedContactRole::Mover {
        body: mobile,
        grounded,
        policy,
    } = actor.role
    else {
        return Ok(Err("prepared collision participant is not a mover"));
    };
    let mut hard = Vec::new();
    let mut mobiles = Vec::new();
    for peer in peers.iter().filter(|peer| peer.id != candidate.id) {
        let Some(contact) = PreparedBodyContact::from_body(peer, anchor)? else {
            continue;
        };
        if !actor
            .participant
            .receives_response_from(&contact.participant)
        {
            continue;
        }
        if let PreparedContactTarget::Hard(geometry) = contact.source.target {
            hard.push(SweepTarget {
                contact: contact.participant,
                geometry_stamp: 0,
                shapes: placed_target_shapes(geometry, peer.pose, anchor)?.into(),
            });
        } else if let PreparedContactRole::Mover { body, .. } = contact.role {
            mobiles.push((contact.participant, body));
        }
    }
    let hard = super::HardTargets::new(hard)?;
    let working = WorkingBody::new(
        actor.source,
        actor.participant,
        mobile,
        grounded,
        policy,
        anchor,
    )?;
    Ok(Ok(PreparedDestination {
        anchor,
        hard,
        mobiles,
        working,
    }))
}

/// Evaluate an exact remote recovery endpoint, separating mobile-peer occupancy from static/hard
/// or unsupported blockage without searching for a displaced position.
pub(crate) fn evaluate_recovery_destination(
    collision: &CollisionScene,
    candidate: &SpatialBody,
    peers: &[SpatialBody],
) -> Result<RecoveryDestinationCheck> {
    let Ok(PreparedDestination {
        anchor,
        hard,
        mobiles,
        mut working,
    }) = prepare_destination(candidate, peers)?
    else {
        return Ok(RecoveryDestinationCheck::BlockedByStaticOrUnsupported);
    };
    let grounded_config = working.grounded.map(|grounded| grounded.config);
    let prepared_ground = if let Some(config) = grounded_config {
        Some(stairs::prepare_support(
            collision,
            &hard,
            anchor,
            &mut working,
            config,
        )?)
    } else {
        None
    };
    match placement_clearance(
        collision,
        &hard,
        &mobiles,
        anchor,
        &working.contact,
        working.mobile.spheres,
        &working.contact.membership,
    )? {
        PlacementClearance::Clear => {
            if let Some(config) = grounded_config
                && config.gravity < 0.0
                && prepared_ground.is_some_and(|g| g.walkable_support().is_none())
                && !stairs::has_walkable_support_within_drop(
                    collision,
                    &hard,
                    anchor,
                    working.mobile,
                    &working.contact,
                    config,
                    crate::spatial::pose_reconciliation::PHYSICAL_RETURN_START_THRESHOLD_M,
                )?
            {
                return Ok(RecoveryDestinationCheck::BlockedByStaticOrUnsupported);
            }
            let mut pose = candidate.pose;
            pose.coords = working.root;
            let pose = crate::spatial::physical_body::place_body_pose(
                pose,
                working.contact.membership.committed_cell(),
            )?;
            Ok(RecoveryDestinationCheck::Clear {
                pose,
                membership: working.contact.membership,
            })
        }
        PlacementClearance::Overlapping {
            has_mobile_overlap: true,
            ..
        } => Ok(RecoveryDestinationCheck::BlockedByMobilePeer),
        PlacementClearance::Overlapping {
            has_mobile_overlap: false,
            ..
        } => Ok(RecoveryDestinationCheck::BlockedByStaticOrUnsupported),
        PlacementClearance::Blocked(_) => {
            if has_blocking_mobile_overlap(
                &mobiles,
                working.mobile.spheres,
                &working.contact.membership,
            ) {
                Ok(RecoveryDestinationCheck::BlockedByMobilePeer)
            } else {
                Ok(RecoveryDestinationCheck::BlockedByStaticOrUnsupported)
            }
        }
    }
}

/// Resolve a discontinuous arrival with bounded whole-body contact separation.
/// RETAIL DIVERGENCE: retail sliding placement can search radial candidates up to four meters
/// away. Contact-driven correction instead follows observed overlaps within a body-scaled travel
/// budget. It may select a different clear endpoint or reject a position retail's search finds;
/// it never accepts an overlapping endpoint. The checked census is one captured building-base
/// arrival and synthetic slope, upper-body, peer, obstruction, budget and coverage cases, not a
/// full-content survey. Arrival safety and bounded correction are preserved without duplicating
/// retail's candidate ordering.
pub(crate) fn settle_arrival_destination(
    collision: &CollisionScene,
    candidate: &SpatialBody,
    peers: &[SpatialBody],
) -> Result<Option<(WorldPosition, SpatialMembership)>> {
    // Emit once when a local arrival ultimately fails; successful correction passes remain silent.
    let reject = |reason: String| {
        if matches!(candidate.id, SpatialBodyId::LocalPlayer(_)) {
            log::warn!(
                "body arrival rejected: body={:?} destination={:#010X} position={:?}: {reason}",
                candidate.id,
                candidate.pose.landblock_id.0,
                candidate.pose.coords,
            );
        }
        Ok(None)
    };
    let PreparedDestination {
        anchor,
        hard,
        mobiles,
        mut working,
    } = match prepare_destination(candidate, peers)? {
        Ok(prepared) => prepared,
        Err(reason) => return reject(reason.to_owned()),
    };
    if working.grounded.is_some() {
        // Arrival placement separates geometry without borrowing walking slope or step policy.
        terrain::reinsert_arrival(collision, anchor, &mut working)?;
    }
    if let Some(reason) = separate_destination_contacts(
        collision,
        &hard,
        &mobiles,
        anchor,
        &mut working,
        BODY_ARRIVAL_MAXIMUM_CONTACT_PASSES,
    )? {
        return reject(reason);
    }
    let mut pose = candidate.pose;
    pose.coords = working.root;
    let pose = crate::spatial::physical_body::place_body_pose(
        pose,
        working.contact.membership.committed_cell(),
    )?;
    Ok(Some((pose, working.contact.membership)))
}

/// Correct a private candidate through hard geometry, or return the observed rejection reason.
/// A zero pass budget validates an exact reference endpoint without permitting repositioning.
fn separate_destination_contacts(
    collision: &CollisionScene,
    hard: &HardTargets,
    mobiles: &[(ContactParticipant, MobileContactBody)],
    anchor: Guid,
    working: &mut WorkingBody<'_>,
    maximum_passes: usize,
) -> Result<Option<String>> {
    let maximum_travel =
        working.mobile.spheres.primary().radius * BODY_ARRIVAL_MAXIMUM_CORRECTION_RADIUS_RATIO;
    let mut correction_travel = 0.0;
    for pass in 0..=maximum_passes {
        match placement_clearance(
            collision,
            hard,
            mobiles,
            anchor,
            &working.contact,
            working.mobile.spheres,
            &working.contact.membership,
        )? {
            PlacementClearance::Clear => return Ok(None),
            PlacementClearance::Blocked(reason) => return Ok(Some(reason)),
            PlacementClearance::Overlapping {
                correction,
                diagnostic,
                ..
            } => {
                if pass == maximum_passes {
                    return Ok(Some(format!(
                        "placement contact-pass limit reached: {diagnostic}"
                    )));
                }
                let travel = correction.length();
                if !travel.is_finite() || travel <= CONTACT_EPSILON {
                    return Ok(Some(format!(
                        "placement has no finite separating direction: {diagnostic}"
                    )));
                }
                if correction_travel + travel > maximum_travel {
                    return Ok(Some(format!(
                        "placement correction exceeds travel limit {maximum_travel}: {diagnostic}"
                    )));
                }
                // Both sphere chords share the earliest hard hit. This allows escape from
                // the initial surface while preventing a correction through another wall.
                let swept = sweep_body_motion(
                    collision,
                    hard,
                    anchor,
                    &working.contact,
                    working.mobile.spheres,
                    correction,
                )?;
                let accepted = swept.path.primary().final_point().center()
                    - working.mobile.spheres.primary().center;
                let accepted_travel = accepted.length();
                if accepted_travel <= CONTACT_EPSILON {
                    return Ok(Some(format!(
                        "placement correction is blocked: {diagnostic}"
                    )));
                }
                correction_travel += accepted_travel;
                working.root = working.root + accepted;
                working.mobile.spheres = translated_spheres(working.mobile.spheres, accepted)?;
                working.contact.membership = swept.path.membership().clone();
            }
        }
    }
    unreachable!("inclusive placement loop always clears or rejects on its final pass")
}

/// Query the complete body once, retaining its shared correction and first blocker.
/// Terrain recovery excludes mobiles because ordinary collection owns their later separation.
pub(super) fn placement_clearance(
    collision: &CollisionScene,
    hard: &HardTargets,
    mobiles: &[(ContactParticipant, MobileContactBody)],
    anchor: Guid,
    contact: &ContactParticipant,
    spheres: PhysicalSphereSet,
    membership: &SpatialMembership,
) -> Result<PlacementClearance> {
    if membership.center_domain_is_unresolved() {
        return Ok(PlacementClearance::Blocked(
            "unresolved collision domain".to_owned(),
        ));
    }
    let primary = spheres.primary();
    let restrictions = collision.placement_restrictions(PlacementRestrictionRequest {
        anchor,
        center: primary.center,
        radius: primary.radius,
        placement: membership,
        filter: contact.filter,
    })?;
    if let Some(restriction) = restrictions.first() {
        return Ok(PlacementClearance::Blocked(format!(
            "placement restriction: normal={:?} depth={}",
            restriction.normal, restriction.depth,
        )));
    }
    // All contacts constrain separation; only the first blocker needs diagnostic provenance.
    let mut overlaps: Option<(Vec<StaticContact>, String)> = None;
    let mut has_mobile_overlap = false;
    let mut record = |contact: StaticContact, diagnostic: fmt::Arguments<'_>| match &mut overlaps {
        Some((contacts, _)) => contacts.push(contact),
        None => overlaps = Some((vec![contact], diagnostic.to_string())),
    };
    for (sphere_index, sphere) in spheres.iter().enumerate() {
        for overlap in collision
            .placement_contacts(PlacementRequest {
                anchor,
                center: sphere.center,
                radius: sphere.radius,
                placement: membership,
            })?
            .into_iter()
            .filter(|overlap| overlap.depth > CONTACT_EPSILON)
        {
            record(
                overlap,
                format_args!(
                    "world overlap: sphere={sphere_index} normal={:?} depth={}",
                    overlap.normal, overlap.depth,
                ),
            );
        }
        for target in hard.iter()? {
            if contact.receives_response_from(&target.contact)
                && membership.intersects_reached(&target.contact.membership)
            {
                for (shape_index, shape) in target.shapes.iter().enumerate() {
                    for overlap in placed_shape_contacts(shape, sphere.center, sphere.radius)
                        .into_iter()
                        .filter(|overlap| overlap.depth > CONTACT_EPSILON)
                    {
                        record(
                            StaticContact {
                                normal: overlap.normal,
                                depth: overlap.depth,
                            },
                            format_args!(
                                "hard entity overlap: peer={:?} shape={shape_index} sphere={sphere_index} normal={:?} depth={}",
                                target.contact.body_id, overlap.normal, overlap.depth
                            ),
                        );
                    }
                }
            }
        }
        for (participant, mobile) in mobiles {
            if !membership.intersects_reached(&participant.membership) {
                continue;
            }
            for other in mobile.spheres.iter() {
                let separation = sphere.center - other.center;
                let distance = separation.length();
                let depth = sphere.radius + other.radius - distance;
                if depth <= CONTACT_EPSILON {
                    continue;
                }
                has_mobile_overlap = true;
                let normal = if distance > f32::EPSILON {
                    separation / distance
                } else {
                    // Arrival correction moves only this body; peers remain stationary.
                    coincident_contact_normal(Vector3::zero())
                };
                let overlap = StaticContact { normal, depth };
                record(
                    overlap,
                    format_args!(
                        "mobile overlap: peer={:?} sphere={sphere_index} normal={normal:?} depth={depth}",
                        participant.body_id,
                    ),
                );
            }
        }
    }
    let Some((contacts, diagnostic)) = overlaps else {
        return Ok(PlacementClearance::Clear);
    };
    Ok(PlacementClearance::Overlapping {
        correction: separating_displacement(&contacts, CONTACT_EPSILON),
        diagnostic,
        has_mobile_overlap,
    })
}

fn has_blocking_mobile_overlap(
    mobiles: &[(ContactParticipant, MobileContactBody)],
    spheres: PhysicalSphereSet,
    membership: &SpatialMembership,
) -> bool {
    for sphere in spheres.iter() {
        for (participant, mobile) in mobiles {
            if !membership.intersects_reached(&participant.membership) {
                continue;
            }
            for other in mobile.spheres.iter() {
                let distance = (sphere.center - other.center).length();
                if sphere.radius + other.radius - distance > CONTACT_EPSILON {
                    return true;
                }
            }
        }
    }
    false
}
