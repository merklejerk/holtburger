//! Shared host projection of collision-placed path points into frontend placement coordinates.

use anyhow::{Result, ensure};
use holtburger_common::position::{
    MAX_OUTDOOR_LANDBLOCK_AXIS, METERS_PER_LANDBLOCK, WorldPosition,
};
use holtburger_common::{Guid, Quaternion, Vector3};

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
