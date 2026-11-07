//! Directionless terrain correction followed by complete endpoint placement validation.

use super::*;
use crate::spatial::{CellTransitRequest, PlacementRequest};

/// The candidate remains private until both spheres clear world and hard-entity geometry.
pub(super) fn recover(
    collision: &CollisionScene,
    hard: &HardTargets,
    anchor: Guid,
    body: &mut WorkingBody<'_>,
) -> Result<()> {
    let primary = body.mobile.spheres.primary();
    let Some(height_delta) = collision.terrain_penetration(PlacementRequest {
        anchor,
        center: primary.center,
        radius: primary.radius,
        placement: &body.contact.membership,
    })?
    else {
        return Ok(());
    };
    let displacement = Vector3::new(0.0, 0.0, height_delta);
    let spheres = translated_spheres(body.mobile.spheres, displacement)?;
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
    if !super::recovery::placement_clear(
        collision,
        hard,
        anchor,
        &body.contact,
        spheres,
        path.membership(),
    )? {
        return Err(CollisionQueryError::TerrainPlacementBlocked.into());
    }
    body.root = body.root + displacement;
    body.mobile.spheres = spheres;
    body.contact.membership = path.membership().clone();
    body.motion.push(ContactMotionSegment::Adjustment {
        path,
        fraction: 0.0,
    });
    Ok(())
}
