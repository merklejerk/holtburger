//! Shared host projection of collision-placed path points into frontend placement coordinates.

use anyhow::{Result, ensure};
use holtburger_common::position::{
    MAX_OUTDOOR_LANDBLOCK_AXIS, METERS_PER_LANDBLOCK, WorldPosition, outdoor_landblock_owner_at,
};
use holtburger_common::{Guid, Quaternion, Vector3};
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

/// Converts one canonical scene point into an outdoor-anchored world pose.
///
/// The inverse of the presentation projection above, and the boundary every frontend-supplied
/// position crosses: canonical scene axes are Y-up with +Z south, while AC authors Z-up with +Y
/// north. The returned landblock carries an outdoor selector so normalization may derive the exact
/// terrain cell.
pub fn scene_point_to_pose(scene_point: [f32; 3]) -> Result<WorldPosition> {
    ensure!(
        scene_point.iter().all(|component| component.is_finite()),
        "scene point must be finite"
    );
    let ac_world_x = scene_point[0];
    let ac_world_y = -scene_point[2];
    let block_x = (ac_world_x / METERS_PER_LANDBLOCK).floor() as i32;
    let block_y = (ac_world_y / METERS_PER_LANDBLOCK).floor() as i32;
    ensure!(
        (0..=i32::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&block_x)
            && (0..=i32::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&block_y),
        "scene point is outside AC's authored landscape"
    );
    Ok(WorldPosition {
        landblock_id: Guid(((block_x as u32) << 24) | ((block_y as u32) << 16)),
        coords: Vector3::new(
            ac_world_x - block_x as f32 * METERS_PER_LANDBLOCK,
            ac_world_y - block_y as f32 * METERS_PER_LANDBLOCK,
            scene_point[1],
        ),
        rotation: Quaternion::identity(),
    })
}

/// Rotates one canonical scene direction into AC authored axes.
///
/// A direction has no origin, so it needs the axis swap without the landblock arithmetic.
pub fn scene_direction_to_ac(direction: [f32; 3]) -> Result<Vector3> {
    ensure!(
        direction.iter().all(|component| component.is_finite()),
        "scene direction must be finite"
    );
    Ok(Vector3::new(direction[0], -direction[2], direction[1]))
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
