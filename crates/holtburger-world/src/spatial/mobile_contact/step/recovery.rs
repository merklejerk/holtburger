//! Checked endpoint placement for arrivals and stalled bodies, without traversing the old route.

use super::*;
use crate::spatial::{
    PlacementRequest, PlacementRestrictionRequest, bsp_query::CONTACT_EPSILON,
    volume_query::placed_shape_contacts,
};

/// Candidate must already have destination membership. Callers own kinematic resets; only
/// corrected pose and membership are returned. Support recovery repairs terrain penetration
/// before bounded object support; final directionless clearance wins.
pub(crate) fn checked_recovery_destination(
    collision: &CollisionScene,
    candidate: &SpatialBody,
    peers: &[SpatialBody],
) -> Result<Option<(WorldPosition, SpatialMembership)>> {
    let anchor = Guid(candidate.pose.landblock_id.0 | 0xffff);
    let Some(actor) = PreparedBodyContact::from_body(candidate, anchor)? else {
        return Ok(None);
    };
    let PreparedContactRole::Mover {
        body: mobile,
        grounded,
        policy,
    } = actor.role
    else {
        return Ok(None);
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
                shapes: placed_target_shapes(geometry, peer.pose, anchor)?,
            });
        } else if let PreparedContactRole::Mover { body, .. } = contact.role {
            mobiles.push((contact.participant, body));
        }
    }
    let hard = super::HardTargets::new(hard)?;
    let mut working = WorkingBody::new(
        actor.source,
        actor.participant,
        mobile,
        grounded,
        policy,
        anchor,
    )?;
    if let Some(grounded) = grounded {
        match stairs::prepare_support(collision, &hard, anchor, &mut working, grounded.config) {
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.downcast_ref::<CollisionQueryError>(),
                    Some(CollisionQueryError::TerrainPlacementBlocked)
                ) =>
            {
                return Ok(None);
            }
            Err(error) => return Err(error),
        }
    }
    if !placement_clear(
        collision,
        &hard,
        anchor,
        &working.contact,
        working.mobile.spheres,
        &working.contact.membership,
    )? {
        return Ok(None);
    }
    for sphere in working.mobile.spheres.iter() {
        // Recovery skips the old route, but its supported endpoint must clear every blocking
        // mobile body. Current player contact does not make a clear destination unsafe.
        for (participant, mobile) in &mobiles {
            if working
                .contact
                .membership
                .intersects_reached(&participant.membership)
                && mobile.spheres.iter().any(|other| {
                    sphere.radius + other.radius - (sphere.center - other.center).length()
                        > CONTACT_EPSILON
                })
            {
                return Ok(None);
            }
        }
    }
    let mut pose = candidate.pose;
    pose.coords = working.root;
    let pose = crate::spatial::physical_body::place_body_pose(
        pose,
        working.contact.membership.committed_cell(),
    )?;
    Ok(Some((pose, working.contact.membership)))
}

/// Final overlap checks are shared by terrain recovery and checked destination placement.
pub(super) fn placement_clear(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    contact: &ContactParticipant,
    spheres: PhysicalSphereSet,
    membership: &SpatialMembership,
) -> Result<bool> {
    if membership.center_domain_is_unresolved() {
        return Ok(false);
    }
    let primary = spheres.primary();
    if !collision
        .placement_restrictions(PlacementRestrictionRequest {
            anchor,
            center: primary.center,
            radius: primary.radius,
            placement: membership,
            filter: contact.filter,
        })?
        .is_empty()
    {
        return Ok(false);
    }
    for sphere in spheres.iter() {
        if collision
            .placement_contacts(PlacementRequest {
                anchor,
                center: sphere.center,
                radius: sphere.radius,
                placement: membership,
            })?
            .iter()
            .any(|overlap| overlap.depth > CONTACT_EPSILON)
        {
            return Ok(false);
        }
        for target in hard.iter()? {
            if contact.receives_response_from(&target.contact)
                && membership.intersects_reached(&target.contact.membership)
                && target.shapes.iter().any(|shape| {
                    placed_shape_contacts(shape, sphere.center, sphere.radius)
                        .iter()
                        .any(|overlap| overlap.depth > CONTACT_EPSILON)
                })
            {
                return Ok(false);
            }
        }
    }
    Ok(true)
}
