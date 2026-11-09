//! Directionless terrain correction followed by complete endpoint placement validation.

use super::*;
use crate::spatial::{CellTransitRequest, PlacementRequest};

/// One terrain endpoint proposal; geometric facts are resolved together before validation.
struct TerrainReinsertion {
    /// Actual represented root translation in the solve anchor's frame.
    displacement: Vector3,
    /// Both translated spheres, shared by validation and candidate acceptance.
    spheres: PhysicalSphereSet,
    /// Primary-owned endpoint membership merged with the upper sphere's reached domains.
    path: ContactBodyPath,
}

/// Apply a terrain lift only when both spheres clear world and hard-entity geometry.
/// An obstructed lift leaves the body unchanged for ordinary support and movement to resolve;
/// later ticks can retry after the body or its obstruction moves.
pub(super) fn recover(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
) -> Result<()> {
    let Some(candidate) = reinsertion_candidate(collision, anchor, body)? else {
        return Ok(());
    };
    let clearance = super::recovery::placement_clearance(
        collision,
        hard,
        &[],
        anchor,
        &body.contact,
        candidate.spheres,
        candidate.path.membership(),
    )?;
    if matches!(clearance, super::recovery::PlacementClearance::Clear) {
        accept_reinsertion(body, candidate);
    }
    Ok(())
}

/// Prepare only a private arrival candidate. Its caller must prove whole-body clearance before
/// publishing; a terrain lift may need subsequent bounded separation from endpoint geometry.
pub(super) fn reinsert_arrival(
    collision: &CollisionScene,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
) -> Result<()> {
    if let Some(candidate) = reinsertion_candidate(collision, anchor, body)? {
        accept_reinsertion(body, candidate);
    }
    Ok(())
}

/// Resolve both endpoint domains together without validating or publishing the candidate.
fn reinsertion_candidate(
    collision: &CollisionScene,
    anchor: Guid,
    body: &WorkingBody<'_>,
) -> Result<Option<TerrainReinsertion>> {
    let primary = body.mobile.spheres.primary();
    let Some(height_delta) = collision.terrain_penetration(PlacementRequest {
        anchor,
        center: primary.center,
        radius: primary.radius,
        placement: &body.contact.membership,
    })?
    else {
        return Ok(None);
    };
    let spheres = translated_spheres(body.mobile.spheres, Vector3::new(0.0, 0.0, height_delta))?;
    let path_for = |end: GroundedSphere| -> Result<PlacedMotionPath> {
        let placement = collision.transit_cell(CellTransitRequest {
            anchor,
            previous_cell: body.contact.membership.committed_cell(),
            center: end.center,
            radius: end.radius,
        })?;
        Ok(PlacedMotionPath::placed_endpoint(
            anchor, end.center, placement,
        ))
    };
    let primary_path = path_for(spheres.primary())?;
    let upper = spheres.upper_constraint().map(path_for).transpose()?;
    let path = ContactBodyPath::new(primary_path, upper);
    Ok(Some(TerrainReinsertion {
        displacement: path.primary().final_point().center() - primary.center,
        spheres,
        path,
    }))
}

/// Update a private candidate's root, spheres, domains and adjustment provenance atomically.
fn accept_reinsertion(body: &mut WorkingBody<'_>, candidate: TerrainReinsertion) {
    body.root = body.root + candidate.displacement;
    body.mobile.spheres = candidate.spheres;
    body.contact.membership = candidate.path.membership().clone();
    body.motion.push(ContactMotionSegment::Adjustment {
        path: candidate.path,
        fraction: 0.0,
    });
}
