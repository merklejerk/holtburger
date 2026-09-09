//! Checked destination placement for a stalled remote body, without traversing the old route.

use super::*;
use crate::spatial::{
    PlacementRequest, bsp_query::CONTACT_EPSILON, volume_query::placed_shape_contacts,
};

/// Tests direct player contact using the same prepared response permissions and body spheres.
pub(crate) fn has_player_contact(body: &SpatialBody, player: Option<&SpatialBody>) -> Result<bool> {
    let Some(player) = player else {
        return Ok(false);
    };
    let anchor = Guid(body.pose.landblock_id.0 | 0xffff);
    let Some(actor) = PreparedBodyContact::from_body(body, anchor)? else {
        return Ok(false);
    };
    let PreparedContactRole::Mover { body: mobile, .. } = actor.role else {
        return Ok(false);
    };
    let Some(player) = PreparedBodyContact::from_body(player, anchor)? else {
        return Ok(false);
    };
    if !actor
        .participant
        .receives_response_from(&player.participant)
    {
        return Ok(false);
    }
    let PreparedContactRole::Mover { body: player, .. } = player.role else {
        return Ok(false);
    };
    Ok(mobile.spheres.iter().any(|first| {
        player.spheres.iter().any(|second| {
            (first.center - second.center).length()
                <= first.radius + second.radius + MOBILE_CONTACT_TOLERANCE_METERS
        })
    }))
}

/// Candidate must already have destination membership and reset kinematics. Support recovery
/// may lift it by the existing step allowance; final directionless clearance has the last word.
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
        grounded: Some(grounded),
        policy,
    } = actor.role
    else {
        return Ok(None);
    };
    let mut hard = Vec::new();
    for peer in peers.iter().filter(|peer| peer.id != candidate.id) {
        let Some(contact) = PreparedBodyContact::from_body(peer, anchor)? else {
            continue;
        };
        let PreparedContactTarget::Hard(geometry) = contact.source.target else {
            continue;
        };
        if !actor
            .participant
            .receives_response_from(&contact.participant)
        {
            continue;
        }
        hard.push(SweepTarget {
            contact: contact.participant,
            shapes: placed_target_shapes(geometry, peer.pose, anchor)?,
        });
    }
    let hard = super::HardTargets::new(hard)?;
    let mut working = WorkingBody::new(
        actor.source,
        actor.participant,
        mobile,
        Some(grounded),
        policy,
        anchor,
    )?;
    stairs::prepare_support(collision, &hard, anchor, &mut working, grounded.config)?;
    for sphere in working.mobile.spheres.iter() {
        let contacts = collision.placement_contacts(PlacementRequest {
            anchor,
            center: sphere.center,
            radius: sphere.radius,
            placement: &working.contact.membership,
        })?;
        if contacts
            .iter()
            .any(|contact| contact.depth > CONTACT_EPSILON)
        {
            return Ok(None);
        }
        for target in hard.iter() {
            if !working
                .contact
                .membership
                .intersects_reached(&target.contact.membership)
            {
                continue;
            }
            if target.shapes.iter().any(|shape| {
                placed_shape_contacts(shape, sphere.center, sphere.radius)
                    .iter()
                    .any(|contact| contact.depth > CONTACT_EPSILON)
            }) {
                return Ok(None);
            }
        }
    }
    let mut pose = candidate.pose;
    pose.coords = working.root;
    if let Some(cell) = working.contact.membership.committed_cell() {
        pose.landblock_id = cell;
    }
    Ok(Some((pose, working.contact.membership)))
}
