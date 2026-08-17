//! Shared host projection of collision-placed path points into frontend placement coordinates.

use anyhow::{Result, ensure};
use holtburger_common::position::{METERS_PER_LANDBLOCK, outdoor_landblock_owner_at};
use holtburger_common::{Guid, Vector3};
use holtburger_world::PlacedMotionPoint;

/// One placed point expressed in the local coordinates of its authoritative outdoor owner.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PresentedPlacedMotionPoint {
    /// Normalized outdoor landblock owner of `coords`.
    pub owner: Guid,
    /// Exact committed EnvCell, or `None` while outdoors.
    pub cell: Option<Guid>,
    /// Point reanchored from the path frame into `owner`'s local AC axes.
    pub coords: Vector3,
}

/// Projects one collision-placed point without re-running portal traversal in a presentation adapter.
pub fn present_placed_motion_point(
    anchor: Guid,
    point: &PlacedMotionPoint,
) -> Result<PresentedPlacedMotionPoint> {
    ensure!(
        point.center().x.is_finite()
            && point.center().y.is_finite()
            && point.center().z.is_finite(),
        "placed-motion point position must be finite"
    );
    let cell = point.placement().committed_cell();
    let owner = cell
        .map(landblock_key)
        .or_else(|| outdoor_landblock_owner_at(landblock_key(anchor), point.center()))
        .unwrap_or_else(|| landblock_key(anchor));
    Ok(PresentedPlacedMotionPoint {
        owner,
        cell,
        coords: reanchor_point(point.center(), landblock_key(anchor), owner),
    })
}

/// Reanchors one landblock-local point without changing its AC axes.
pub fn reanchor_point(point: Vector3, source_owner: Guid, target_owner: Guid) -> Vector3 {
    let source_x = ((source_owner.0 >> 24) & 0xff) as i32;
    let source_y = ((source_owner.0 >> 16) & 0xff) as i32;
    let target_x = ((target_owner.0 >> 24) & 0xff) as i32;
    let target_y = ((target_owner.0 >> 16) & 0xff) as i32;
    Vector3::new(
        point.x + (source_x - target_x) as f32 * METERS_PER_LANDBLOCK,
        point.y + (source_y - target_y) as f32 * METERS_PER_LANDBLOCK,
        point.z,
    )
}

/// Normalizes any outdoor-cell or EnvCell selector to its collision-product owner.
pub const fn landblock_key(id: Guid) -> Guid {
    Guid((id.0 & 0xffff_0000) | 0xffff)
}
